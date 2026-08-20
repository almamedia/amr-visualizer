/**
 * Turning what onboarding collected into a Xandr booking.
 *
 * A note on where the input comes from. The asset studio receives a
 * CreativeBrief (lib/onboarding/brief.ts), and that object deliberately drops
 * flight dates, the numeric budget, the duration, the region id and the
 * per-channel budget shares — the exact fields a line item needs. So this
 * module takes FlowAnswers and Recommendation directly, which is what the
 * onboarding page still holds. Widening CreativeBrief to carry them belongs
 * with the work that wires this into the flow.
 */

import { durationOptions } from "../onboarding/catalog";
import { resolvedDuration } from "../onboarding/recommend";
import type {
  DurationId,
  FlowAnswers,
  Recommendation,
} from "../onboarding/types";
import type { GeneratedAsset } from "../types";
import type { BookingRequest } from "./types";

/** Last resort if even the resolved duration has no month count. */
const FALLBACK_MONTHS = 1;

export interface BookingMapping {
  request: BookingRequest;
  warnings: string[];
}

/** Xandr wants "YYYY-MM-DD HH:MM:SS" in the member's timezone, not ISO 8601. */
export function toXandrDate(date: Date, endOfDay = false): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${endOfDay ? "23:59:59" : "00:00:00"}`;
}

export function monthsForDuration(id: DurationId): number | null {
  return durationOptions.find((d) => d.id === id)?.months ?? null;
}

function addMonths(date: Date, months: number): Date {
  const out = new Date(date);
  out.setMonth(out.getMonth() + months);
  return out;
}

/** Parse a YYYY-MM-DD answer as a local date. Returns null when unusable. */
function parseStartDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildBookingRequest(params: {
  answers: FlowAnswers;
  recommendation: Recommendation;
  assets: GeneratedAsset[];
  /** Where the ad clicks through to — the advertiser's own site. */
  clickUrl: string;
  businessName: string;
  /**
   * EUR per 1000 impressions to bill. Required when the recommended format is
   * sold per click, because Xandr bills those line items on CPM and
   * formats.json only carries the per-click price.
   */
  cpmEur?: number;
  /** Injected so the result is deterministic and testable. */
  now?: Date;
}): BookingMapping {
  const { answers, recommendation, assets, clickUrl, businessName } = params;
  const warnings: string[] = [];
  const now = params.now ?? new Date();

  // ------------------------------------------------------------ flight dates
  let start = now;
  if (answers.timeline.startMode === "date") {
    const parsed = parseStartDate(answers.timeline.startDate);
    if (parsed) {
      start = parsed;
    } else {
      warnings.push(
        `Start date "${answers.timeline.startDate}" could not be read; the campaign starts today.`
      );
    }
  }

  // resolvedDuration turns "undecided" into the duration the goal implies —
  // the same value the recommendation's own budget maths used, so the booked
  // budget matches the figure the user was shown.
  const duration = resolvedDuration(answers);
  const months = monthsForDuration(duration);
  if (answers.timeline.duration === "undecided") {
    warnings.push(
      `Duration was left undecided; booked for ${months ?? FALLBACK_MONTHS} month(s) based on the campaign goal. Confirm before this goes live.`
    );
  }
  const runMonths = months ?? FALLBACK_MONTHS;
  const end = addMonths(start, runMonths);

  // ---------------------------------------------------------------- budget
  const lifetimeBudgetEur =
    Math.round(recommendation.budget.monthlyEur * runMonths * 100) / 100;
  if (recommendation.budget.tier.provisional) {
    warnings.push(
      "Budget tiers are still placeholders (lib/onboarding/data/flow.json), so this figure is provisional."
    );
  }

  // --------------------------------------------------------------- pricing
  // One line item covers the whole booking, so it needs a single revenue type.
  // The primary recommended format sets it; a mixed CPM/CPC recommendation is
  // flagged rather than silently averaged.
  const primary = recommendation.formats[0]?.format;
  if (!primary) {
    throw new Error("The recommendation contains no format to price against.");
  }
  const mixed = recommendation.formats.some(
    (f) => f.format.pricingModel !== primary.pricingModel
  );
  if (mixed) {
    warnings.push(
      `The recommendation mixes CPM and CPC formats; the line item follows "${primary.smeName}" (${primary.pricingModel.toUpperCase()}). Splitting into one line item per pricing model is the correct fix.`
    );
  }

  // Xandr bills every standard_v2 line item on impressions — it rejects a cpc
  // revenue type outright. A format sold to the SME per click is therefore
  // booked at a CPM and optimised towards the per-click price as a goal. The
  // CPM is a real billing figure and there is nowhere to derive it from, so a
  // missing one is an error rather than a guess.
  const perClick = primary.pricingModel === "cpc";
  if (perClick && !(params.cpmEur && params.cpmEur > 0)) {
    throw new Error(
      `"${primary.smeName}" is sold per click, but Xandr bills this line item type on CPM. Pass cpmEur — formats.json carries only the ${primary.priceEur} € click price (docs/task-fanout.md T1).`
    );
  }
  const revenueValue = perClick ? (params.cpmEur as number) : primary.priceEur;
  if (perClick) {
    warnings.push(
      `"${primary.smeName}" is sold per click: the line item bills at ${revenueValue} € CPM and optimises towards ${primary.priceEur} € per click. Confirm the CPM with Ad Ops.`
    );
  }

  // ------------------------------------------------------------- targeting
  const channelIds = recommendation.channels.map((c) => c.channel.id);
  if (recommendation.channels.length > 1) {
    warnings.push(
      "One line item covers every recommended channel; the per-channel budget shares from the recommendation are not applied."
    );
  }

  const request: BookingRequest = {
    campaignName: campaignName(businessName, recommendation),
    clickUrl,
    startDate: toXandrDate(start),
    endDate: toXandrDate(end, true),
    lifetimeBudgetEur,
    revenueType: "cpm",
    revenueValue,
    ...(perClick && { goal: { type: "cpc" as const, value: primary.priceEur } }),
    assets,
    targeting: {
      channelIds,
      regionId:
        answers.audience.geography === "region"
          ? answers.audience.regionId
          : undefined,
      audienceTypes: answers.audience.types,
    },
  };

  return { request, warnings };
}

/** Something an Ad Ops person can recognise in the Xandr UI. */
function campaignName(businessName: string, recommendation: Recommendation): string {
  const goal = recommendation.channels[0]?.channel.name ?? "Display";
  const name = businessName.trim() || "Unnamed advertiser";
  return `${name} — ${goal} — AMR Asset Studio`.slice(0, 190);
}
