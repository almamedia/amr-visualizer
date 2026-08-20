/**
 * The creative brief package (PRD Appendix B). This object is the agreed
 * contract between the onboarding microsite and the asset creation flow —
 * change it only alongside the studio team.
 *
 * The editorial context of the recommended channel travels with it. That is
 * the field that makes generated copy feel targeted: the studio learns not
 * only who to reach, but what mindset they are in when they see the ad.
 */

import {
  durationOptions,
  formatRequirements,
  getAudienceTypeOption,
  getBudgetTier,
} from "./catalog";
import { goalLabel, resolvedDuration, targetPlace } from "./recommend";
import type {
  ConfirmedBusiness,
  CreativeBrief,
  FlowAnswers,
  Recommendation,
} from "./types";
import type { BrandCard } from "../types";

/** sessionStorage key the asset studio reads on load. Bumped with the shape,
 *  so a brief written by an older build is ignored rather than half-read. */
export const BRIEF_STORAGE_KEY = "ams.creativeBrief.v2";

/** Fallback when even the resolved duration carries no month count. */
const FALLBACK_MONTHS = 1;

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function buildCreativeBrief(
  answers: FlowAnswers,
  business: ConfirmedBusiness,
  recommendation: Recommendation,
  brand: BrandCard | null
): CreativeBrief {
  // The booking half of the brief. Everything here was previously dropped at
  // the handoff, which left the adserver step with no dates, no budget and no
  // region to work from.
  const duration = resolvedDuration(answers);
  const months =
    durationOptions.find((d) => d.id === duration)?.months ?? FALLBACK_MONTHS;
  const monthlyBudgetEur = recommendation.budget.monthlyEur;
  const primaryFormat = recommendation.formats[0]?.format;

  return {
    version: 2,
    businessName: business.businessName,
    industry: business.industry,
    productsOrServices: business.productsOrServices,
    goal: { id: answers.goal ?? "awareness", label: goalLabel(answers.goal) },
    targetRegion: business.location || targetPlace(answers),
    audienceTypes: answers.audience.types.map(
      (t) => getAudienceTypeOption(t).label
    ),
    channels: recommendation.channels.map((c) => ({
      id: c.channel.id,
      name: c.channel.name,
      editorialContext: c.channel.editorialContext,
    })),
    formats: recommendation.formats.map((f) => ({
      id: f.format.id,
      smeName: f.format.smeName,
      dimensions: f.format.dimensions,
      maxFileSizeKb: f.format.maxFileSizeKb,
      requirements: formatRequirements,
      specFormatId: f.format.specFormatId,
    })),
    budgetTier: getBudgetTier(answers.budget.tier).name,
    booking: {
      startDate:
        answers.timeline.startMode === "date" && answers.timeline.startDate
          ? answers.timeline.startDate
          : todayIso(),
      months,
      monthlyBudgetEur,
      lifetimeBudgetEur: Math.round(monthlyBudgetEur * months * 100) / 100,
      pricingModel: primaryFormat?.pricingModel ?? "cpm",
      priceEur: primaryFormat?.priceEur ?? 0,
      regionId:
        answers.audience.geography === "region" ? answers.audience.regionId : "",
      channelIds: recommendation.channels.map((c) => c.channel.id),
      // The address the user typed on the URL step — the same one the brand
      // analysis ran against. Empty when they skipped that step, in which case
      // the site the brand was eventually read from is the next best thing.
      clickUrl: answers.url || brand?.sourceUrl || "",
    },
    brand,
  };
}

/** Plain-text version for the "send this to my email" option (PRD §7 6h). */
export function briefAsText(
  business: ConfirmedBusiness,
  recommendation: Recommendation
): string {
  const lines = [
    `Advertising recommendation for ${business.businessName || "your business"}`,
    "",
    recommendation.summary,
    "",
    "Recommended channels:",
    ...recommendation.channels.map(
      (c) =>
        `  - ${c.channel.name} (${Math.round(c.budgetShare * 100)}% of budget) — ${c.channel.whyItFits}`
    ),
    "",
    "Recommended ad formats:",
    ...recommendation.formats.map(
      (f) => `  - ${f.format.smeName}, ${f.format.dimensions} — ${f.format.pricingCopy}`
    ),
    "",
    `Estimated monthly ${recommendation.reach.unit}: ${recommendation.reach.low.toLocaleString(
      "en-GB"
    )}–${recommendation.reach.high.toLocaleString("en-GB")}`,
    `Budget: ${recommendation.budget.display}`,
    "",
    "Estimates only — actual results vary with final targeting and creative.",
  ];
  return lines.join("\n");
}
