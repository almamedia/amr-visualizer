/**
 * POST /creative — one creative object per finished asset.
 *
 * Two shapes, chosen by GeneratedAsset.kind:
 *   static -> a hosted image banner (template 4) pointing at the media asset
 *             we uploaded first.
 *   html5  -> a third-party tag (template 6) whose markup we inline ourselves.
 *
 * advertiser_id is a query parameter on this call, not a body field.
 */

import type { GeneratedAsset } from "../types";
import { advertiserId as configuredAdvertiserId } from "./config";
import { request } from "./client";
import {
  TEMPLATE_IMAGE_BANNER,
  TEMPLATE_TAG_CONTENT,
  type BannerCreative,
  type CreativeCreatedResponse,
  type CreativeInput,
  type MediaAsset,
  type TagCreative,
} from "./types";

/**
 * A tag creative is written into the ad slot by the page, so the markup has to
 * survive being a JavaScript string literal inside a <script> block: quotes,
 * backslashes, newlines, and the closing tag itself all need escaping.
 */
export function wrapAsTag(html: string): string {
  const escaped = html
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, "\\n")
    .replace(/<\/script/gi, "<\\/script");
  return `document.write('${escaped}');`;
}

/** A readable name in the Xandr UI: campaign, format, then copy variant. */
export function creativeName(campaignName: string, asset: GeneratedAsset): string {
  return `${campaignName} — ${asset.formatName} — ${asset.copy.id}`.slice(0, 190);
}

export function buildBannerCreative(
  campaignName: string,
  asset: GeneratedAsset,
  clickUrl: string,
  media: MediaAsset,
  code?: string
): CreativeInput {
  const creative: BannerCreative = {
    name: creativeName(campaignName, asset),
    ...(code && { code }),
    width: asset.width || media.media_asset_image?.width || 0,
    height: asset.height || media.media_asset_image?.height || 0,
    template: { id: TEMPLATE_IMAGE_BANNER },
    click_url: clickUrl,
    allow_audit: false,
    state: "active",
    ad_type: "banner",
    media_url: media.cdn_secure_url,
    media_url_secure: media.cdn_secure_url,
  };
  return { creative };
}

export function buildTagCreative(
  campaignName: string,
  asset: GeneratedAsset,
  clickUrl: string,
  code?: string
): CreativeInput {
  if (!asset.html) {
    throw new Error(`HTML5 asset ${asset.id} has no markup to serve.`);
  }

  const tag = wrapAsTag(asset.html);
  const creative: TagCreative = {
    name: creativeName(campaignName, asset),
    ...(code && { code }),
    width: asset.width,
    height: asset.height,
    template: { id: TEMPLATE_TAG_CONTENT },
    click_url: clickUrl,
    allow_audit: false,
    state: "active",
    ad_type: "banner",
    // The studio inlines everything and emits https-only markup, so the
    // secure and non-secure variants are the same document.
    content: tag,
    content_secure: tag,
    original_content: asset.html,
    original_content_secure: asset.html,
  };
  return { creative };
}

/**
 * Roughly how large the tag will be once served. The studio inlines images and
 * CSS into its HTML5 assets, so a tag can be far heavier than a normal
 * third-party tag; past this we warn rather than fail, because only Xandr can
 * say for certain.
 *
 * TODO: the durable answer is to host the HTML5 bundle ourselves and serve an
 * iframe tag pointing at it, rather than carrying the whole document inline.
 */
export const TAG_SIZE_WARN_BYTES = 200 * 1024;

export async function createCreative(
  input: CreativeInput,
  advertiser?: number
): Promise<number> {
  const response = await request<CreativeCreatedResponse>({
    method: "POST",
    service: "creative",
    params: { advertiser_id: advertiser ?? configuredAdvertiserId() },
    body: input,
  });

  const id = response.creative?.id;
  if (!id) {
    throw new Error(`Xandr created no creative for "${input.creative.name}".`);
  }
  return id;
}
