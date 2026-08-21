/**
 * Xandr (AppNexus) API shapes.
 *
 * Ported from what xandr-api-gateway-v2 proved works against the live API,
 * with its mistyped fields widened: that repo pins `service` to "profile" and
 * `method` to "POST" on the shared envelope, which is only true for one call.
 */

import type { GeneratedAsset } from "../types";

// ------------------------------------------------------------- the envelope

/**
 * Every Xandr response (except /creative-upload and /budget-splitter) is
 * wrapped in this. Note that an error can arrive with HTTP 200 — the body is
 * the source of truth, not the status code.
 */
export interface XandrResponseMeta {
  status?: string;
  count?: number;
  start_element?: number;
  num_elements?: number;
  error_id?: string;
  error?: string;
  error_code?: string | null;
  error_description?: string | null;
  service?: string;
  method?: string;
  dbg_info?: { output_term?: string; version?: string; warnings?: unknown[] };
}

export interface XandrEnvelope<T> {
  response: T & XandrResponseMeta;
}

/** The /auth response. */
export interface AuthResponse {
  token: string;
}

// ------------------------------------------------------------- media upload

export interface MediaAsset {
  id: number;
  cdn_secure_url: string;
  media_asset_image?: { width: number; height: number };
}

export interface MediaUploadResponse {
  "media-asset": MediaAsset[];
}

// ---------------------------------------------------------------- creatives

/** Xandr's ad_type values. Both banners and HTML5 tags are "banner". */
export type AdType = "banner" | "native" | "video";

/**
 * Creative template ids, from the gateway's creativeRequest.ts.
 * 4 = hosted image banner, 6 = third-party tag content.
 */
export const TEMPLATE_IMAGE_BANNER = 4;
export const TEMPLATE_TAG_CONTENT = 6;

interface CreativeCommon {
  name: string;
  /**
   * Our own identifier, stored on the Xandr object and searchable with
   * `?code=`. This is how a booking's objects are found again later.
   */
  code?: string;
  width: number;
  height: number;
  template: { id: number };
  click_url: string;
  /** These creatives are ours and are not sent to Xandr's audit queue. */
  allow_audit: boolean;
  state: "active" | "inactive";
  ad_type: AdType;
}

export interface BannerCreative extends CreativeCommon {
  media_url: string;
  media_url_secure: string;
}

export interface TagCreative extends CreativeCommon {
  content: string;
  /**
   * Alma serves over HTTPS only, and Xandr picks the secure variant on secure
   * pages — without it an HTML5 creative simply does not render there.
   */
  content_secure: string;
  /** The unwrapped markup, kept so the tag is readable in the Xandr UI. */
  original_content: string;
  original_content_secure: string;
}

export type CreativeBody = BannerCreative | TagCreative;

export interface CreativeInput {
  creative: CreativeBody;
}

export interface CreativeCreatedResponse {
  creative: { id: number };
}

// ------------------------------------------------------------------ profile

export interface PlacementTarget {
  id: number;
  action: "include" | "exclude";
}

export interface PublisherTarget {
  id: number;
  action: "include" | "exclude";
}

/** One audience group. Segments inside a group combine with its operator. */
export interface SegmentGroupTarget {
  boolean_operator: "and" | "or";
  segments: { id: number; action: "include" | "exclude" }[];
}

export interface ProfileBody {
  code?: string;
  placement_targets?: PlacementTarget[];
  publisher_targets?: PublisherTarget[];
  segment_group_targets?: SegmentGroupTarget[];
  /** How the groups above combine with each other. */
  segment_boolean_operator?: "and" | "or";
  region_targets?: { id: number }[];
  /**
   * Xandr defaults every geography action to "exclude" with empty targets,
   * which means "exclude nothing" — i.e. run everywhere. An include list is
   * only honoured when the action says include.
   */
  region_action?: "include" | "exclude";
  city_targets?: { id: number }[];
  city_action?: "include" | "exclude";
  /**
   * Xandr rejects a frequency cap that cannot be counted, so this stays true
   * whenever caps are set — the gateway hardcodes it for the same reason.
   */
  require_cookie_for_freq_cap?: boolean;
  max_lifetime_imps?: number | null;
  max_day_imps?: number | null;
  min_minutes_per_imp?: number | null;
  max_page_imps?: number;
}

export interface ProfileInput {
  profile: ProfileBody;
}

/** Note the id is at the top level of the response, not nested under `profile`. */
export interface ProfileCreatedResponse {
  id: number;
}

// ---------------------------------------------------------------- line item

/**
 * What the advertiser is billed on. Xandr restricts standard_v2 (ALI) line
 * items to these four — `cpc` is rejected outright with INVALID_REVENUE_TYPE:
 * "revenue type must be cpm, vcpm, cost_plus_cpm, or cost_plus_margin for
 * line item type standard_v2". Pay-per-click is expressed as an optimisation
 * goal on top of CPM revenue instead, not as a revenue type.
 */
export type RevenueType = "cpm" | "vcpm" | "cost_plus_cpm" | "cost_plus_margin";

/** How the onboarding formats are sold to the SME. */
export type PricingModel = "cpm" | "cpc";

export const LINE_ITEM_TYPE_ALI = "standard_v2";
export const LINE_ITEM_SUBTYPE_STANDARD = "standard_buying";

export type CreativeDistribution = "even" | "weighted" | "ctr-optimized";

export interface BudgetInterval {
  /** "YYYY-MM-DD HH:MM:SS" — Xandr's format, not ISO 8601. */
  start_date: string;
  end_date: string;
  /** Lifetime budget in the advertiser's currency (EUR here). */
  lifetime_budget: number;
  lifetime_pacing: boolean;
  enable_pacing: boolean;
  lifetime_pacing_pct?: number;
}

export interface LineItemBody {
  name: string;
  code?: string;
  insertion_orders: { id: number }[];
  state: "active" | "inactive";
  profile_id: number;
  /** Each element must include `id` or `code`, or Xandr returns a SYNTAX error. */
  creatives: { id: number }[];
  manage_creative: boolean;
  ad_types: AdType[];
  revenue_type: RevenueType;
  revenue_value: number;
  creative_distribution_type: CreativeDistribution;
  line_item_type: typeof LINE_ITEM_TYPE_ALI;
  line_item_subtype: typeof LINE_ITEM_SUBTYPE_STANDARD;
  goal_type?: "cpc";
  goal_value?: number;
  /**
   * Xandr rejects a goal_type with no threshold (MUST_SPECIFY_GOAL_THRESHOLD),
   * and the threshold lives on the valuation object, not the line item itself.
   */
  valuation?: { goal_threshold: number; goal_target?: number };
  budget_intervals: BudgetInterval[];
  comments?: string;
}

export interface LineItemInput {
  "line-item": LineItemBody;
}

export interface LineItemCreatedResponse {
  "line-item": { id: number };
}

// ------------------------------------------------------ this layer's own IO

export interface BookingTargeting {
  /** Onboarding channel ids, e.g. ["iltalehti"]. */
  channelIds: string[];
  /** Onboarding region ids, e.g. ["uusimaa"]. */
  regionIds?: string[];
  cities?: string[];
  /** Alma cohort ids from the audience step, resolved to Xandr segments. */
  cohortIds?: string[];
  /** Labels only, for warnings — targeting runs off cohortIds. */
  audienceTypes?: string[];
}

/**
 * Everything the booking needs, already resolved. Built by mapping.ts from the
 * onboarding answers, or assembled by hand.
 */
export interface BookingRequest {
  campaignName: string;
  /** Where the ad clicks through to. Must be https. */
  clickUrl: string;
  /** "YYYY-MM-DD HH:MM:SS". */
  startDate: string;
  endDate: string;
  lifetimeBudgetEur: number;
  revenueType: RevenueType;
  /** EUR per 1000 impressions billed to the advertiser. */
  revenueValue: number;
  /**
   * Optimisation goal, set for formats sold per click. Xandr optimises
   * delivery towards this cost per click while still billing on CPM.
   * `threshold` is the highest cost per click still acceptable; Xandr
   * requires it whenever a goal type is set, and defaults to `value`.
   */
  goal?: { type: "cpc"; value: number; threshold?: number };
  assets: GeneratedAsset[];
  targeting: BookingTargeting;
  /**
   * Stamped onto every object created for this booking as its `code`, so the
   * whole set can be found and removed later. Demo and test runs should
   * always set one.
   */
  tag?: string;
  /** Overrides XANDR_ADVERTISER_ID. */
  advertiserId?: number;
  /** Overrides XANDR_INSERTION_ORDER_ID. */
  insertionOrderId?: number;
}

export interface BookingPayloads {
  creatives: CreativeInput[];
  profile: ProfileInput | null;
  lineItem: LineItemInput | null;
}

export interface BookingResult {
  lineItemId: number | null;
  profileId: number | null;
  creativeIds: number[];
  mediaAssetIds: number[];
  /** Non-fatal problems: a dropped asset, an unmapped channel, a provisional id. */
  warnings: string[];
  /** Always populated, including on a dry run — this is what would be sent. */
  payloads: BookingPayloads;
  dryRun: boolean;
}
