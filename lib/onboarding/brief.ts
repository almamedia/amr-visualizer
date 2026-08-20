/**
 * The creative brief package (PRD Appendix B). This object is the agreed
 * contract between the onboarding microsite and the asset creation flow —
 * change it only alongside the studio team.
 *
 * The editorial context of the recommended channel travels with it. That is
 * the field that makes generated copy feel targeted: the studio learns not
 * only who to reach, but what mindset they are in when they see the ad.
 */

import { formatRequirements, getAudienceTypeOption, getBudgetTier } from "./catalog";
import { goalLabel, targetPlace } from "./recommend";
import type {
  ConfirmedBusiness,
  CreativeBrief,
  FlowAnswers,
  Recommendation,
} from "./types";
import type { BrandCard } from "../types";

/** sessionStorage key the asset studio reads on load. */
export const BRIEF_STORAGE_KEY = "ams.creativeBrief.v1";

export function buildCreativeBrief(
  answers: FlowAnswers,
  business: ConfirmedBusiness,
  recommendation: Recommendation,
  brand: BrandCard | null
): CreativeBrief {
  return {
    version: 1,
    businessName: business.businessName,
    industry: business.contentType || business.industry,
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
    brand: brand
      ? {
          ...brand,
          contentType: business.contentType || brand.contentType,
          contentTypeAlternatives:
            business.contentTypeAlternatives.length > 0
              ? business.contentTypeAlternatives
              : brand.contentTypeAlternatives,
        }
      : null,
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
