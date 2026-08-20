/**
 * POST /profile — the targeting object the line item points at.
 *
 * v1 targets channels only, through the placement and publisher ids in
 * ./data/targeting.json. Those ids are still placeholders, so a channel that
 * resolves to nothing produces a warning: an empty profile is not "no
 * targeting we care about", it is a campaign that runs across all inventory.
 *
 * Geography and audience segments are deliberately absent. Xandr segment ids
 * for the onboarding regions and audience types have not been supplied, and
 * inventing them would be worse than leaving the gap visible.
 */

import { advertiserId as configuredAdvertiserId } from "./config";
import { request } from "./client";
import targetingRaw from "./data/targeting.json";
import type {
  BookingTargeting,
  PlacementTarget,
  ProfileBody,
  ProfileCreatedResponse,
  ProfileInput,
  PublisherTarget,
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

export function buildProfile(
  targeting: BookingTargeting,
  code?: string
): BuiltProfile {
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

  if (placements.length === 0 && publishers.length === 0) {
    warnings.push(
      "The profile targets no inventory, so the line item would run across everything. Fill in lib/xandr/data/targeting.json before booking for real."
    );
  }

  if (targeting.regionId) {
    warnings.push(
      `Geographic targeting for "${targeting.regionId}" is not applied — Xandr region ids are not mapped yet.`
    );
  }
  if (targeting.audienceTypes?.length) {
    warnings.push(
      `Audience targeting (${targeting.audienceTypes.join(", ")}) is not applied — Xandr segment ids are not mapped yet.`
    );
  }

  const profile: ProfileBody = {
    ...(code && { code }),
    ...(placements.length > 0 && { placement_targets: placements }),
    ...(publishers.length > 0 && { publisher_targets: publishers }),
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
