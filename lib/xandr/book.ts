/**
 * Booking a finished campaign into Xandr.
 *
 * The sequence, and why it is this order:
 *
 *   1. POST /creative-upload   host each static image, get a CDN url
 *   2. POST /creative          one creative per asset, referencing that url
 *   3. POST /profile           the targeting the line item will point at
 *   4. POST /line-item         the booking itself, carrying profile + creatives
 *
 * Advertisers and insertion orders are not created here — they come from
 * configuration, the same division the internal gateway settled on.
 *
 * Nothing in this module is wired to a route yet. `dryRun` assembles every
 * payload and returns it without issuing a single write, which is how this
 * gets reviewed before credentials exist.
 */

import { mapLimit } from "../concurrency";
import type { GeneratedAsset } from "../types";
import { advertiserId as configuredAdvertiserId, insertionOrderId as configuredInsertionOrderId, isBookingConfigured, isTestMember } from "./config";
import {
  TAG_SIZE_WARN_BYTES,
  buildBannerCreative,
  buildTagCreative,
  createCreative,
} from "./creative";
import { buildLineItem, createLineItem } from "./line-item";
import { decodeDataUri, uploadImage } from "./media";
import { buildProfile, createProfile, deleteProfile, hasProvisionalTargeting } from "./profile";
import type {
  BookingPayloads,
  BookingRequest,
  BookingResult,
  CreativeInput,
  MediaAsset,
} from "./types";

/** Playwright rendering aside, Xandr's write rate limit is the reason to cap this. */
const UPLOAD_CONCURRENCY = 4;

/**
 * Codes stamped on every object a booking creates. Xandr requires them to be
 * unique per advertiser per service, so the tag is suffixed per object type.
 */
export function bookingCodes(tag: string): {
  creative: (index: number) => string;
  profile: string;
  lineItem: string;
} {
  return {
    creative: (index) => `${tag}-cr-${index + 1}`,
    profile: `${tag}-pr`,
    lineItem: `${tag}-li`,
  };
}

/** Stand-ins used while assembling payloads on a dry run with no config. */
const DRY_RUN_MEDIA: MediaAsset = {
  id: 0,
  cdn_secure_url: "https://acdn.adnxs.com/dry-run/placeholder.png",
};
const DRY_RUN_ID = 0;

export interface BookOptions {
  /** Assemble and return every payload without sending anything. */
  dryRun?: boolean;
  /**
   * Creative ids that already exist in Xandr. Given these, the media upload
   * and creative steps are skipped entirely. A booking that fails at the line
   * item has already created its creatives, so a retry should reuse them
   * rather than leave a second set orphaned.
   */
  reuseCreativeIds?: number[];
  /**
   * Create the line item running rather than paused. Off by default: an
   * untargeted profile is eligible for every piece of inventory the member
   * can reach, so a line item should not start delivering until someone has
   * confirmed the targeting.
   */
  activate?: boolean;
}

function emptyPayloads(): BookingPayloads {
  return { creatives: [], profile: null, lineItem: null };
}

function validate(req: BookingRequest): string[] {
  const problems: string[] = [];
  if (!req.campaignName.trim()) problems.push("campaignName is empty.");
  if (!req.clickUrl.startsWith("https://")) {
    problems.push("clickUrl must be https — Alma serves ads over HTTPS only.");
  }
  if (!req.assets.length) problems.push("There are no assets to book.");
  if (!(req.lifetimeBudgetEur > 0)) problems.push("lifetimeBudgetEur must be positive.");
  if (!(req.revenueValue > 0)) problems.push("revenueValue must be positive.");
  if (req.endDate <= req.startDate) problems.push("endDate must be after startDate.");
  return problems;
}

interface PreparedCreative {
  asset: GeneratedAsset;
  input: CreativeInput;
}

/**
 * Upload media where needed and build one creative payload per asset. An asset
 * that cannot be booked is dropped with a warning rather than failing the
 * campaign — eleven creatives booked beats nothing booked.
 */
async function prepareCreatives(
  req: BookingRequest,
  warnings: string[],
  mediaAssetIds: number[],
  dryRun: boolean
): Promise<PreparedCreative[]> {
  const codes = req.tag ? bookingCodes(req.tag) : null;

  const prepared = await mapLimit(req.assets, UPLOAD_CONCURRENCY, async (asset, index) => {
    const code = codes?.creative(index);
    try {
      if (asset.kind === "html5") {
        const input = buildTagCreative(req.campaignName, asset, req.clickUrl, code);
        const bytes = Buffer.byteLength(
          (input.creative as { content: string }).content,
          "utf8"
        );
        if (bytes > TAG_SIZE_WARN_BYTES) {
          warnings.push(
            `${asset.fileName} is ${Math.round(bytes / 1024)} KB as an inline tag; Xandr may reject it. Hosting the HTML5 bundle and serving an iframe tag is the durable fix.`
          );
        }
        return { asset, input };
      }

      if (!asset.dataUri) {
        warnings.push(`${asset.fileName} has no image data and was skipped.`);
        return null;
      }

      const image = decodeDataUri(asset.dataUri);
      if (!image) {
        warnings.push(
          `${asset.fileName} is not a JPEG, PNG or GIF, which is all Xandr will host. Skipped.`
        );
        return null;
      }

      const media = dryRun
        ? DRY_RUN_MEDIA
        : await uploadImage(image, `${asset.id}.${image.ext}`, req.advertiserId);
      if (!dryRun) mediaAssetIds.push(media.id);

      return {
        asset,
        input: buildBannerCreative(req.campaignName, asset, req.clickUrl, media, code),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      warnings.push(`${asset.fileName} could not be prepared: ${message}`);
      return null;
    }
  });

  return prepared.filter((p): p is PreparedCreative => p !== null);
}

export async function bookCampaign(
  req: BookingRequest,
  opts: BookOptions = {}
): Promise<BookingResult> {
  const dryRun = opts.dryRun ?? false;
  const activate = opts.activate ?? false;
  const warnings: string[] = [];
  const mediaAssetIds: number[] = [];
  const payloads = emptyPayloads();

  const problems = validate(req);
  if (problems.length > 0) {
    throw new Error(`Cannot book this campaign: ${problems.join(" ")}`);
  }

  const configured = isBookingConfigured();
  if (!dryRun && !configured) {
    throw new Error(
      "Xandr is not configured. Set XANDR_USERNAME, XANDR_PASSWORD, XANDR_ADVERTISER_ID and XANDR_INSERTION_ORDER_ID."
    );
  }

  // Resolved once, so a dry run can assemble complete payloads on a machine
  // that has no credentials at all — placeholder ids, but every other field real.
  const usePlaceholders = dryRun && !configured;
  if (usePlaceholders) {
    warnings.push(
      "Xandr is not configured, so advertiser and insertion order appear as 0 in these payloads."
    );
  }
  const resolved: BookingRequest = {
    ...req,
    advertiserId:
      req.advertiserId ?? (usePlaceholders ? DRY_RUN_ID : configuredAdvertiserId()),
    insertionOrderId:
      req.insertionOrderId ??
      (usePlaceholders ? DRY_RUN_ID : configuredInsertionOrderId()),
  };

  if (!resolved.tag) {
    warnings.push(
      "No tag was set, so the objects this creates cannot be found again as a set. Pass `tag` on demo and test bookings."
    );
  }

  if (hasProvisionalTargeting) {
    warnings.push(
      "Channel targeting ids in lib/xandr/data/targeting.json are still placeholders."
    );
  }
  if (!dryRun && !isTestMember()) {
    warnings.push(
      "This booking was made under the live Xandr member, not the test member."
    );
  }

  const reuse = opts.reuseCreativeIds ?? [];
  let prepared: PreparedCreative[] = [];

  if (reuse.length > 0) {
    warnings.push(
      `Reusing ${reuse.length} existing creative(s); no assets were uploaded.`
    );
  } else {
    prepared = await prepareCreatives(resolved, warnings, mediaAssetIds, dryRun);
    payloads.creatives = prepared.map((p) => p.input);

    if (prepared.length === 0) {
      throw new Error("None of the assets could be turned into Xandr creatives.");
    }
    if (prepared.length < resolved.assets.length) {
      warnings.push(
        `${resolved.assets.length - prepared.length} of ${resolved.assets.length} assets were skipped.`
      );
    }
  }

  const codes = resolved.tag ? bookingCodes(resolved.tag) : null;
  // Lookups need credentials; a dry run without them assembles what it can.
  const profile = await buildProfile(
    resolved.targeting,
    codes?.profile,
    !usePlaceholders
  );
  payloads.profile = profile.input;
  warnings.push(...profile.warnings);

  if (dryRun) {
    // Ids the real run would produce, so the line item payload is complete.
    payloads.lineItem = buildLineItem(
      resolved,
      DRY_RUN_ID,
      reuse.length > 0 ? reuse : prepared.map((_, i) => i + 1),
      activate,
      codes?.lineItem
    );
    return {
      lineItemId: null,
      profileId: null,
      creativeIds: [],
      mediaAssetIds: [],
      warnings,
      payloads,
      dryRun: true,
    };
  }

  const creativeIds: number[] = [...reuse];
  const created = await mapLimit(prepared, UPLOAD_CONCURRENCY, async (p) => {
    try {
      return await createCreative(p.input, resolved.advertiserId);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      warnings.push(`Creative for ${p.asset.fileName} failed: ${message}`);
      return null;
    }
  });
  for (const id of created) if (id !== null) creativeIds.push(id);

  if (creativeIds.length === 0) {
    throw new Error("Xandr rejected every creative, so there is nothing to book.");
  }

  const profileId = await createProfile(profile.input, resolved.advertiserId);

  const lineItemInput = buildLineItem(
    resolved,
    profileId,
    creativeIds,
    activate,
    codes?.lineItem
  );
  payloads.lineItem = lineItemInput;

  let lineItemId: number;
  try {
    lineItemId = await createLineItem(lineItemInput, resolved.advertiserId);
  } catch (e) {
    // The profile exists only to serve this line item, so roll it back rather
    // than strand it. Creatives are kept deliberately: they are reusable on a
    // retry via reuseCreativeIds, and re-uploading media is the expensive part.
    try {
      await deleteProfile(profileId, resolved.advertiserId);
    } catch {
      // Reported alongside the original failure, which is the more useful one.
    }
    throw e;
  }

  if (!activate) {
    warnings.push(
      "The line item was created paused. Set it active in Xandr once the targeting is confirmed."
    );
  }

  return {
    lineItemId,
    profileId,
    creativeIds,
    mediaAssetIds,
    warnings,
    payloads,
    dryRun: false,
  };
}

/** What a caller needs to show before offering the button. */
export function bookingConfigSummary(): {
  configured: boolean;
  testMember: boolean;
  advertiserId: number | null;
  insertionOrderId: number | null;
} {
  const configured = isBookingConfigured();
  return {
    configured,
    testMember: isTestMember(),
    advertiserId: configured ? configuredAdvertiserId() : null,
    insertionOrderId: configured ? configuredInsertionOrderId() : null,
  };
}
