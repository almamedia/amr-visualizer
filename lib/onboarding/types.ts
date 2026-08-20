/**
 * Onboarding microsite — types.
 *
 * PRD: "AMS Advertising Onboarding Tool" v0.1. This flow is English only
 * (PRD §3 non-goals); the existing Finnish asset studio is a separate flow
 * that this one hands off to.
 */

import type { BrandCard } from "../types";

// ------------------------------------------------------------ step answers

export type GoalId =
  | "traffic"
  | "awareness"
  | "event"
  | "local"
  | "online-sales";

export type StartMode = "asap" | "date";

export type DurationId = "2-weeks" | "1-month" | "3-months" | "undecided";

export type GeographyMode = "finland" | "region" | "city";

export type AudienceTypeId =
  | "general-consumers"
  | "business-decision-makers"
  | "homeowners-families"
  | "young-adults"
  | "high-income";

export type BudgetTierId = "small" | "medium" | "custom";

export interface TimelineAnswer {
  startMode: StartMode;
  /** ISO date (YYYY-MM-DD). Only meaningful when startMode is "date". */
  startDate: string;
  duration: DurationId;
}

export interface AudienceAnswer {
  geography: GeographyMode;
  /** Region id when geography is "region". */
  regionId: string;
  /** Free-text city when geography is "city". */
  city: string;
  /** Max 2 (PRD §7 step 4). */
  types: AudienceTypeId[];
}

export interface BudgetAnswer {
  tier: BudgetTierId;
  /** EUR per month. Only meaningful when tier is "custom". */
  customEur: number | null;
}

/** Everything the user told us across steps 2–5. */
export interface FlowAnswers {
  url: string;
  /** True when the user took "Skip — I'll answer manually". */
  urlSkipped: boolean;
  goal: GoalId | null;
  timeline: TimelineAnswer;
  audience: AudienceAnswer;
  budget: BudgetAnswer;
}

// --------------------------------------------------------- website signals

/**
 * What the AI reads off the scraped site (PRD §7 step 1). Every field is
 * optional: the flow must work when analysis fails, is sparse, or is
 * discarded for low confidence.
 */
export interface BusinessSignals {
  businessName: string;
  /** Free-form industry label, e.g. "dental clinic". */
  industry: string;
  /** Coarse bucket the recommendation engine can branch on. */
  category:
    | "real-estate"
    | "b2b-professional"
    | "ecommerce"
    | "local-services"
    | "other";
  /** One plain-language sentence about the business. */
  summary: string;
  productsOrServices: string;
  /** City or region name found on the site, "" when none. */
  geographicSignal: string;
  /** Site sells online (cart, shop, product pages). */
  ecommerce: boolean;
  /** True when the site presents itself as serving all of Finland. */
  national: boolean;
  /** Audience hints found in the copy, e.g. ["families"]. */
  audienceSignals: string[];
  /** 0–1. Below CONFIDENCE_FLOOR the analysis is discarded silently. */
  confidence: number;
}

/** Fields on the confirmation card the user can correct (PRD §7 6a). */
export interface ConfirmedBusiness {
  businessName: string;
  industry: string;
  productsOrServices: string;
  location: string;
}

export type AnalysisStatus = "idle" | "running" | "ready" | "failed";

export interface AnalysisState {
  status: AnalysisStatus;
  signals: BusinessSignals | null;
  /** Kept for the handoff into the asset studio, not shown in onboarding. */
  brand: BrandCard | null;
}

// ------------------------------------------------------------ catalog data

export interface GoalOption {
  id: GoalId;
  label: string;
  hint: string;
}

export interface DurationOption {
  id: DurationId;
  label: string;
  hint: string;
  /** Months used in budget and reach maths. Null when undecided. */
  months: number | null;
}

export interface AudienceTypeOption {
  id: AudienceTypeId;
  label: string;
  hint: string;
  /** Channel ids this audience maps to, primary first (PRD §8). */
  channelIds: string[];
}

export interface BudgetTierOption {
  id: BudgetTierId;
  label: string;
  name: string;
  hint: string;
  /** EUR/month. Null on the custom tier. Placeholder until Pricing signs off. */
  minEur: number | null;
  maxEur: number | null;
  /** Ranges are unconfirmed — surfaced as such in the UI. */
  provisional: boolean;
}

export interface RegionOption {
  id: string;
  name: string;
  /** Share of a national audience reachable in this region, 0–1. */
  audienceShare: number;
}

export interface ChannelProfile {
  id: string;
  name: string;
  /** One sentence for the recommendation card. */
  whyItFits: string;
  ageRange: string;
  genderSkew: string;
  incomeProfile: string;
  /** Reader mindset — the field that sharpens generated ad copy. */
  editorialContext: string;
  geographicConcentration: string;
  audienceTag: string;
  /** Monthly reach claim shown on the card, "" until AMS confirms. */
  monthlyReach: string;
}

export type PricingModel = "cpc" | "cpm";

export interface FormatOption {
  id: string;
  /** SME-facing name — never the Finnish internal name (PRD §7 6d). */
  smeName: string;
  internalName: string;
  dimensions: string;
  devices: string;
  pricingModel: PricingModel;
  /** Plain-language explanation of the pricing model. */
  pricingCopy: string;
  bestFor: string;
  maxFileSizeKb: number;
  /** EUR per 1000 impressions, or per click for CPC formats. Placeholder. */
  priceEur: number;
  /** Format id in lib/specs/display.json, when the asset studio can make it. */
  specFormatId: string | null;
}

// ---------------------------------------------------------- recommendation

export interface RecommendedChannel {
  channel: ChannelProfile;
  /** Share of budget, 0–1. Sums to 1 across recommended channels. */
  budgetShare: number;
  role: "primary" | "secondary";
}

export interface RecommendedFormat {
  format: FormatOption;
  /** Why this format fits this user's goal, one sentence. */
  rationale: string;
}

export interface ReachEstimate {
  /** Impressions or clicks per month, depending on the pricing model. */
  low: number;
  high: number;
  unit: "impressions" | "clicks";
  /** True when a region or city narrowed the estimate. */
  regionCapped: boolean;
}

export interface Recommendation {
  /** Plain-language recap of the user's answers (PRD §7 6b). */
  summary: string;
  channels: RecommendedChannel[];
  formats: RecommendedFormat[];
  reach: ReachEstimate;
  budget: {
    tier: BudgetTierOption;
    /** EUR/month actually used in the maths. */
    monthlyEur: number;
    /** Human-readable, e.g. "500–1,500 € / month". */
    display: string;
  };
  /** Notes worth showing, e.g. that a signal shaped the result. */
  notes: string[];
  /** True when website analysis contributed. */
  usedAnalysis: boolean;
}

// ------------------------------------------------------- handoff to studio

/**
 * The creative brief package (PRD Appendix B). This is the contract between
 * the onboarding microsite and the asset creation flow.
 */
export interface CreativeBrief {
  /** Bumped to 2 when the booking fields below were added. */
  version: 2;
  businessName: string;
  industry: string;
  productsOrServices: string;
  goal: { id: GoalId; label: string };
  targetRegion: string;
  audienceTypes: string[];
  channels: { id: string; name: string; editorialContext: string }[];
  formats: {
    id: string;
    smeName: string;
    dimensions: string;
    maxFileSizeKb: number;
    requirements: string[];
    specFormatId: string | null;
  }[];
  budgetTier: string;
  /**
   * What the adserver needs and the rest of the brief does not carry. Kept in
   * one block so it is obvious this is booking data, not creative direction.
   */
  booking: {
    /** ISO date the campaign starts (YYYY-MM-DD). */
    startDate: string;
    /** Months it runs. Resolved, so "undecided" is already turned into a number. */
    months: number;
    /** EUR per month the recommendation was calculated on. */
    monthlyBudgetEur: number;
    /** EUR for the whole flight. */
    lifetimeBudgetEur: number;
    /** How the primary format is sold to the SME. */
    pricingModel: PricingModel;
    /** Per click for cpc formats, per 1000 impressions for cpm. */
    priceEur: number;
    /** Region id when the user narrowed to one, else "". */
    regionId: string;
    /** Onboarding channel ids, for targeting lookup. */
    channelIds: string[];
    /** Where the ad clicks through to — the site onboarding started from. */
    clickUrl: string;
  };
  /** Carried straight through so the studio need not re-scrape. */
  brand: BrandCard | null;
}
