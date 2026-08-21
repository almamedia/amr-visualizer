/**
 * POST /profile — the targeting object the line item points at.
 *
 * Three kinds of targeting go in here:
 *
 *   - Channels, through the placement and publisher ids in
 *     ./data/targeting.json. Those ids are still placeholders, so a channel
 *     that resolves to nothing produces a warning: an empty profile is not
 *     "no targeting we care about", it is a campaign running across all
 *     inventory.
 *   - Audience, from the cohorts the user picked. Alma's cohorts exist in
 *     Xandr as segments, so these resolve without a mapping table (./segments).
 *   - Geography, from the regions and cities chosen on the audience step,
 *     matched against Xandr's own names (./geo).
 */

import { advertiserId as configuredAdvertiserId } from "./config";
import { request } from "./client";
import { resolveCities, resolveRegions } from "./geo";
import { resolveCohortSegments } from "./segments";
import targetingRaw from "./data/targeting.json";
import type {
  BookingTargeting,
  PlacementTarget,
  ProfileBody,
  ProfileCreatedResponse,
  ProfileInput,
  PublisherTarget,
  SegmentGroupTarget,
} from "./types";

interface ChannelTargeting {
  id: string;
  publisherId: number | null;
  placementIds: number[];
}

/** The only place the Xandr targeting map is read from. */
export const channelTargeting = targetingRaw.channels as ChannelTargeting[];

/** True while the ids above are still placeholders. */
export const hasProvisionalTargeting = targetingRaw.provisional;

export function getChannelTargeting(id: string): ChannelTargeting | undefined {
  return channelTargeting.find((c) => c.id === id);
}

export interface BuiltProfile {
  input: ProfileInput;
  warnings: string[];
}

/**
 * Assemble the profile. Async because segments, regions and cities are looked
 * up against Xandr by name — resolving them here rather than keeping a mapping
 * table means nothing silently rots when Xandr renames something.
 *
 * `resolve: false` skips every lookup, for assembling a payload with no
 * credentials configured.
 */
export async function buildProfile(
  targeting: BookingTargeting,
  code?: string,
  resolve = true
): Promise<BuiltProfile> {
  const warnings: string[] = [];
  const placements: PlacementTarget[] = [];
  const publishers: PublisherTarget[] = [];

  for (const channelId of targeting.channelIds) {
    const mapping = getChannelTargeting(channelId);
    if (!mapping) {
      warnings.push(`No Xandr targeting is mapped for channel "${channelId}".`);
      continue;
    }
    for (const placementId of mapping.placementIds) {
      placements.push({ id: placementId, action: "include" });
    }
    if (mapping.publisherId !== null) {
      publishers.push({ id: mapping.publisherId, action: "include" });
    }
    if (mapping.placementIds.length === 0 && mapping.publisherId === null) {
      warnings.push(
        `Channel "${channelId}" has no Xandr ids yet (lib/xandr/data/targeting.json is provisional).`
      );
    }
  }

  // ------------------------------------------------------------- audience
  let segmentGroups: SegmentGroupTarget[] = [];
  const cohortIds = targeting.cohortIds ?? [];
  if (cohortIds.length > 0 && resolve) {
    const segments = await resolveCohortSegments(cohortIds);
    warnings.push(...segments.warnings);
    if (segments.ids.length > 0) {
      // One group, OR inside it: the user picked alternative audiences, not
      // people who must belong to every cohort at once.
      segmentGroups = [
        {
          boolean_operator: "or",
          segments: segments.ids.map((id) => ({ id, action: "include" as const })),
        },
      ];
    }
  } else if (cohortIds.length > 0) {
    warnings.push("Audience segments were not resolved (lookups disabled).");
  } else if (targeting.audienceTypes?.length) {
    warnings.push(
      `Audience targeting (${targeting.audienceTypes.join(", ")}) is not applied — the flow produced no cohorts to target on.`
    );
  }

  // ------------------------------------------------------------ geography
  const regionTargets: { id: number }[] = [];
  const cityTargets: { id: number }[] = [];
  if (resolve) {
    const regions = await resolveRegions(targeting.regionIds ?? []);
    warnings.push(...regions.warnings);
    regionTargets.push(...regions.ids.map((id) => ({ id })));

    const cities = await resolveCities(targeting.cities ?? []);
    warnings.push(...cities.warnings);
    cityTargets.push(...cities.ids.map((id) => ({ id })));
  } else if (targeting.regionIds?.length || targeting.cities?.length) {
    warnings.push("Geographic targeting was not resolved (lookups disabled).");
  }

  if (placements.length === 0 && publishers.length === 0) {
    const otherwiseTargeted =
      segmentGroups.length > 0 || regionTargets.length > 0 || cityTargets.length > 0;
    warnings.push(
      otherwiseTargeted
        ? "No channel targeting: the line item can serve on any inventory the member reaches, narrowed only by audience and geography. Fill in lib/xandr/data/targeting.json to hold it to the recommended channels."
        : "The profile targets nothing at all, so the line item would run across everything. Fill in lib/xandr/data/targeting.json before booking for real."
    );
  }

  const profile: ProfileBody = {
    ...(code && { code }),
    ...(placements.length > 0 && { placement_targets: placements }),
    ...(publishers.length > 0 && { publisher_targets: publishers }),
    ...(segmentGroups.length > 0 && {
      segment_group_targets: segmentGroups,
      segment_boolean_operator: "and" as const,
    }),
    // The action must be set alongside the list: Xandr's default is
    // "exclude" with an empty list, which targets everywhere.
    ...(regionTargets.length > 0 && {
      region_targets: regionTargets,
      region_action: "include" as const,
    }),
    ...(cityTargets.length > 0 && {
      city_targets: cityTargets,
      city_action: "include" as const,
    }),
    require_cookie_for_freq_cap: true,
  };

  return { input: { profile }, warnings };
}

export async function createProfile(
  input: ProfileInput,
  advertiser?: number
): Promise<number> {
  const response = await request<ProfileCreatedResponse>({
    method: "POST",
    service: "profile",
    params: { advertiser_id: advertiser ?? configuredAdvertiserId() },
    body: input,
  });

  // The id sits at the top level of the response, not nested under `profile`.
  if (!response.id) throw new Error("Xandr created no profile.");
  return response.id;
}

/**
 * Remove a profile. Used to undo a profile whose line item then failed —
 * without this, every failed booking leaves one behind, and an orphan is
 * invisible in the UI because nothing references it.
 */
export async function deleteProfile(
  id: number,
  advertiser?: number
): Promise<void> {
  await request({
    method: "DELETE",
    service: "profile",
    params: { id, advertiser_id: advertiser ?? configuredAdvertiserId() },
  });
}
