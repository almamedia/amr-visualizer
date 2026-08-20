/**
 * The only place onboarding data is read from. Channel profiles, pricing,
 * regional splits and question copy all live in ./data as JSON so that the
 * teams who own them (data, ad ops, content) can edit one file each without
 * touching the flow.
 */

import channelsRaw from "./data/channels.json";
import formatsRaw from "./data/formats.json";
import regionsRaw from "./data/regions.json";
import flowRaw from "./data/flow.json";
import type {
  AudienceTypeOption,
  BudgetTierOption,
  ChannelProfile,
  DurationOption,
  FormatOption,
  GoalOption,
  RegionOption,
} from "./types";

export const channels = channelsRaw.channels as ChannelProfile[];
export const formats = formatsRaw.formats as FormatOption[];
export const formatRequirements = formatsRaw.requirements as string[];
export const specsUrl = formatsRaw.specsUrl;
export const regions = regionsRaw.regions as RegionOption[];
export const cities = regionsRaw.cities as string[];
export const cityFallbackShare = regionsRaw.cityFallbackShare;
export const flow = flowRaw;

export const goalOptions = flowRaw.goalStep.options as GoalOption[];
export const durationOptions = flowRaw.timelineStep
  .durationOptions as DurationOption[];
export const audienceTypeOptions = flowRaw.audienceStep
  .typeOptions as AudienceTypeOption[];
export const budgetTiers = flowRaw.budgetStep.tiers as BudgetTierOption[];

/** True when any figure feeding the recommendation is still a placeholder. */
export const hasProvisionalData =
  channelsRaw.provisional || formatsRaw.provisional || regionsRaw.provisional;

export function getChannel(id: string): ChannelProfile {
  const c = channels.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown channel: ${id}`);
  return c;
}

export function getFormatOption(id: string): FormatOption {
  const f = formats.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown format: ${id}`);
  return f;
}

export function getRegion(id: string): RegionOption | undefined {
  return regions.find((x) => x.id === id);
}

export function getGoalOption(id: string): GoalOption | undefined {
  return goalOptions.find((g) => g.id === id);
}

export function getDurationOption(id: string): DurationOption {
  const d = durationOptions.find((x) => x.id === id);
  if (!d) throw new Error(`Unknown duration: ${id}`);
  return d;
}

export function getAudienceTypeOption(id: string): AudienceTypeOption {
  const a = audienceTypeOptions.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown audience type: ${id}`);
  return a;
}

export function getBudgetTier(id: string): BudgetTierOption {
  const t = budgetTiers.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown budget tier: ${id}`);
  return t;
}
