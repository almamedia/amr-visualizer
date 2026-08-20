/**
 * Rule-based recommendation engine (PRD §8). Deliberately not ML: the same
 * answers must always produce the same recommendation, and every rule here
 * has to be explainable to an SME in one sentence.
 *
 * The AI layer only adds weight. It never removes a channel the user's own
 * answers put on the table (PRD §8: "The AI layer never overrides a user's
 * explicit answer").
 */

import {
  cityFallbackShare,
  getAudienceTypeOption,
  getBudgetTier,
  getChannel,
  getDurationOption,
  getFormatOption,
  getGoalOption,
  getRegion,
} from "./catalog";
import type {
  BusinessSignals,
  DurationId,
  FlowAnswers,
  GoalId,
  Recommendation,
  RecommendedChannel,
  RecommendedFormat,
  ReachEstimate,
} from "./types";

/** Below this the analysis is discarded silently (PRD §7 step 1). */
export const CONFIDENCE_FLOOR = 0.5;

/** Reach is shown as a range, never a single number (PRD §8). */
const RANGE_SPREAD = 0.2;

/**
 * Narrow targeting does not cut delivery in proportion to population — the
 * budget is unchanged, the inventory is just scarcer and priced higher. This
 * maps a region's audience share onto a delivery modifier that stays well
 * above the raw share. Replace with real per-region factors from ad ops.
 */
function regionModifier(share: number): number {
  if (share >= 1) return 1;
  return 0.55 + 0.45 * share;
}

/** Which goals reward which format (PRD §7 6d "Recommendation logic"). */
const FORMATS_BY_GOAL: Record<GoalId, string[]> = {
  traffic: ["performance-display"],
  awareness: ["paraati", "pystyparaati"],
  event: ["paraati", "boksi"],
  local: ["performance-display"],
  "online-sales": ["performance-display"],
};

const FORMAT_RATIONALE: Record<GoalId, string> = {
  traffic: "You pay per click, so every euro goes to someone who actually visited.",
  awareness: "A large, visible placement at the top of the page builds recognition fast.",
  event: "Reach and repeat exposure together — people see it, then see it again.",
  local: "Pay-per-click keeps a local budget accountable: no click, no cost.",
  "online-sales": "Clicks land people straight on the product they saw.",
};

/** When the user says "I'll decide later", the goal picks the duration. */
const DURATION_BY_GOAL: Record<GoalId, DurationId> = {
  traffic: "1-month",
  awareness: "3-months",
  event: "2-weeks",
  local: "1-month",
  "online-sales": "1-month",
};

export function resolvedDuration(answers: FlowAnswers): DurationId {
  const chosen = answers.timeline.duration;
  if (chosen !== "undecided") return chosen;
  return answers.goal ? DURATION_BY_GOAL[answers.goal] : "1-month";
}

/** Monthly euros the maths runs on. Tier midpoint, or the custom number. */
export function monthlyBudget(answers: FlowAnswers): number {
  const tier = getBudgetTier(answers.budget.tier);
  if (tier.id === "custom") {
    const entered = answers.budget.customEur;
    return entered && entered > 0 ? entered : fallbackMonthly();
  }
  return Math.round(((tier.minEur ?? 0) + (tier.maxEur ?? 0)) / 2);
}

function fallbackMonthly(): number {
  const small = getBudgetTier("small");
  return Math.round(((small.minEur ?? 0) + (small.maxEur ?? 0)) / 2);
}

/** How many channels this budget can carry without spreading too thin. */
function channelBudgetCap(answers: FlowAnswers): number {
  const medium = getBudgetTier("medium");
  const mediumFloor = medium.minEur ?? 0;
  if (answers.budget.tier === "small") return 1;
  if (answers.budget.tier === "medium") return 2;
  return monthlyBudget(answers) >= mediumFloor ? 2 : 1;
}

/** Usable signals, or null when analysis failed or scored too low. */
export function usableSignals(
  signals: BusinessSignals | null
): BusinessSignals | null {
  if (!signals) return null;
  return signals.confidence >= CONFIDENCE_FLOOR ? signals : null;
}

/**
 * The goal the website hints at, so step 2 can highlight it. Highlight only —
 * never pre-selected, the user still chooses (PRD §7 step 2).
 */
export function suggestedGoal(signals: BusinessSignals | null): GoalId | null {
  const s = usableSignals(signals);
  if (!s) return null;
  if (s.ecommerce || s.category === "ecommerce") return "online-sales";
  if (s.category === "b2b-professional") return "awareness";
  if (s.geographicSignal && !s.national) return "local";
  return null;
}

/** The region the website hints at, so step 4 can pre-select it. */
export function suggestedRegionId(
  signals: BusinessSignals | null
): string | null {
  const s = usableSignals(signals);
  if (!s?.geographicSignal || s.national) return null;
  const needle = s.geographicSignal.toLowerCase();
  const match = getRegionByHint(needle);
  return match ?? null;
}

function getRegionByHint(needle: string): string | null {
  const hints: Record<string, string> = {
    helsinki: "helsinki-uusimaa",
    espoo: "helsinki-uusimaa",
    vantaa: "helsinki-uusimaa",
    uusimaa: "helsinki-uusimaa",
    tampere: "pirkanmaa",
    pirkanmaa: "pirkanmaa",
    turku: "varsinais-suomi",
    "varsinais-suomi": "varsinais-suomi",
  };
  const key = Object.keys(hints).find((k) => needle.includes(k));
  return key ? hints[key] : null;
}

// ------------------------------------------------------------- channels

function channelWeights(
  answers: FlowAnswers,
  signals: BusinessSignals | null
): Map<string, number> {
  const weights = new Map<string, number>();
  const add = (id: string, w: number) =>
    weights.set(id, (weights.get(id) ?? 0) + w);

  // 1. The user's own audience answers. Primary outranks secondary.
  for (const typeId of answers.audience.types) {
    const type = getAudienceTypeOption(typeId);
    type.channelIds.forEach((id, i) => add(id, i === 0 ? 10 : 4));
  }

  // Nothing selected is a valid state — fall back to the broadest channel.
  if (weights.size === 0) add("iltalehti", 10);

  // 2. Goal modifier (PRD §8).
  if (answers.goal === "online-sales") add("iltalehti", 3);
  if (answers.goal === "awareness") add("iltalehti", 1);

  // 3. AI layer — additive only, so it can reorder but never eliminate.
  const s = usableSignals(signals);
  if (s) {
    if (s.category === "real-estate") add("etuovi", 8);
    if (s.category === "b2b-professional") add("kauppalehti", 6);
    if (s.ecommerce) add("iltalehti", 3);
    const hints = s.audienceSignals.join(" ").toLowerCase();
    if (/famil|home|parent/.test(hints)) add("etuovi", 2);
    if (/professional|business|manager/.test(hints)) add("kauppalehti", 2);
  }

  return weights;
}

function pickChannels(
  answers: FlowAnswers,
  signals: BusinessSignals | null
): RecommendedChannel[] {
  const weights = channelWeights(answers, signals);
  const ranked = [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => getChannel(id));

  // An event or offer runs on one channel: the same budget spread over two
  // buys the same people fewer times, and frequency is the whole point.
  const cap = answers.goal === "event" ? 1 : channelBudgetCap(answers);
  const picked = ranked.slice(0, Math.max(1, cap));

  if (picked.length === 1) {
    return [{ channel: picked[0], budgetShare: 1, role: "primary" }];
  }
  return [
    { channel: picked[0], budgetShare: 0.6, role: "primary" },
    { channel: picked[1], budgetShare: 0.4, role: "secondary" },
  ];
}

// -------------------------------------------------------------- formats

function pickFormats(
  answers: FlowAnswers,
  channels: RecommendedChannel[]
): RecommendedFormat[] {
  const goal = answers.goal ?? "awareness";
  const ids = [...FORMATS_BY_GOAL[goal]];

  // A business audience gets the business version of the click format.
  const businessLed = channels[0]?.channel.id === "kauppalehti";
  if (businessLed) {
    const i = ids.indexOf("performance-display");
    if (i >= 0) ids[i] = "performance-display-business";
    else if (!ids.includes("performance-display-business"))
      ids.unshift("performance-display-business");
  }

  // Budget modifier (PRD §7 6d): a small budget stays on pay-per-click, where
  // a first-time advertiser only pays for results.
  const smallBudget = channelBudgetCap(answers) === 1 &&
    answers.budget.tier !== "medium";
  const filtered = smallBudget
    ? ids.filter((id) => getFormatOption(id).pricingModel === "cpc")
    : ids;

  const finalIds = filtered.length
    ? filtered
    : [businessLed ? "performance-display-business" : "performance-display"];

  return finalIds.slice(0, 2).map((id) => ({
    format: getFormatOption(id),
    rationale: FORMAT_RATIONALE[goal],
  }));
}

// ---------------------------------------------------------------- reach

function estimateReach(
  answers: FlowAnswers,
  formats: RecommendedFormat[],
  signals: BusinessSignals | null
): ReachEstimate {
  const budget = monthlyBudget(answers);
  const lead = formats[0]?.format;
  const unit: ReachEstimate["unit"] =
    lead?.pricingModel === "cpc" ? "clicks" : "impressions";

  // The estimate runs on the lead format's price. With two channels the split
  // shifts this a little either way — acceptable while the output is a range,
  // and worth revisiting once real per-channel prices land.
  const base =
    !lead || lead.priceEur <= 0
      ? 0
      : lead.pricingModel === "cpc"
      ? budget / lead.priceEur
      : (budget / lead.priceEur) * 1000;

  // A business that operates nationally keeps the full estimate even if the
  // user picked a region — the site says the reach is there (PRD §8).
  const s = usableSignals(signals);
  const national = s?.national ?? false;
  const share = audienceShare(answers);
  const capped = share < 1 && !national;
  const modifier = capped ? regionModifier(share) : 1;

  const mid = base * modifier;
  const round = unit === "clicks" ? 10 : 1000;

  return {
    low: roundTo(mid * (1 - RANGE_SPREAD), round),
    high: roundTo(mid * (1 + RANGE_SPREAD), round),
    unit,
    regionCapped: capped,
  };
}

function audienceShare(answers: FlowAnswers): number {
  const { geography, regionId } = answers.audience;
  if (geography === "finland") return 1;
  if (geography === "city") return cityFallbackShare;
  return getRegion(regionId)?.audienceShare ?? 1;
}

function roundTo(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}

// -------------------------------------------------------------- summary

export function targetPlace(answers: FlowAnswers): string {
  const { geography, regionId, city } = answers.audience;
  if (geography === "city") return city.trim() || "your city";
  if (geography === "region")
    return getRegion(regionId)?.name ?? "your region";
  return "Finland";
}

const GOAL_PHRASE: Record<GoalId, string> = {
  traffic: "bring more people to your website",
  awareness: "grow awareness for your business",
  event: "promote your event or offer",
  local: "grow your local customer base",
  "online-sales": "drive online sales",
};

function buildSummary(answers: FlowAnswers): string {
  const goal = answers.goal ? GOAL_PHRASE[answers.goal] : "grow your business";
  const place = targetPlace(answers);
  const types = answers.audience.types
    .map((t) => getAudienceTypeOption(t).label.toLowerCase())
    .join(" and ");
  const who = types ? `, targeting ${types}` : "";
  const duration = getDurationOption(resolvedDuration(answers)).label.toLowerCase();
  const tier = getBudgetTier(answers.budget.tier);
  // The custom tier has no name that reads as a budget size, so it states the
  // number instead: "a i have a specific budget budget" is not a sentence.
  const money =
    tier.id === "custom"
      ? `a budget of ${budgetDisplay(answers)}`
      : `a ${tier.name.toLowerCase()} budget`;
  return `You want to ${goal} in ${place}${who}, over ${duration}, with ${money}.`;
}

function budgetDisplay(answers: FlowAnswers): string {
  const tier = getBudgetTier(answers.budget.tier);
  if (tier.id === "custom") {
    return `${formatEur(monthlyBudget(answers))} / month`;
  }
  return `${formatEur(tier.minEur ?? 0)}–${formatEur(tier.maxEur ?? 0)} / month`;
}

export function formatEur(n: number): string {
  return `${Math.round(n).toLocaleString("en-GB")} €`;
}

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}

// ------------------------------------------------------------------ main

export function recommend(
  answers: FlowAnswers,
  signals: BusinessSignals | null
): Recommendation {
  const s = usableSignals(signals);
  const channels = pickChannels(answers, s);
  const formats = pickFormats(answers, channels);
  const reach = estimateReach(answers, formats, s);
  const tier = getBudgetTier(answers.budget.tier);

  const notes: string[] = [];

  if (answers.goal === "local" || answers.audience.geography !== "finland") {
    notes.push(
      `Your ad will only be shown to people in ${targetPlace(
        answers
      )}, so none of your budget is spent outside your service area.`
    );
  }
  if (answers.goal === "event") {
    notes.push(
      "We kept this on a single channel. For a time-limited message, showing the same people your ad more often beats reaching more people once."
    );
  }
  if (answers.timeline.duration === "undecided") {
    notes.push(
      `You hadn't picked a length, so we planned for ${getDurationOption(
        resolvedDuration(answers)
      ).label.toLowerCase()} — the run that usually suits this goal.`
    );
  }
  if (s?.category === "real-estate") {
    notes.push(
      "Your website looks property-related, so we gave Etuovi more weight — its readers are already in a moving mindset."
    );
  }
  if (s?.category === "b2b-professional") {
    notes.push(
      "Your website reads as business-to-business, so we weighted Kauppalehti's professional audience more heavily."
    );
  }
  if (s?.national && answers.audience.geography !== "finland") {
    notes.push(
      "Your website says you serve customers across Finland, so we haven't capped the estimate to one area."
    );
  }

  return {
    summary: buildSummary(answers),
    channels,
    formats,
    reach,
    budget: {
      tier,
      monthlyEur: monthlyBudget(answers),
      display: budgetDisplay(answers),
    },
    notes,
    usedAnalysis: Boolean(s),
  };
}

/** Convenience for the summary card: the goal's own label. */
export function goalLabel(id: GoalId | null): string {
  return id ? getGoalOption(id)?.label ?? "" : "";
}
