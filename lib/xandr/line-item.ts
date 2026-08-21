/**
 * POST /line-item — what actually books the campaign.
 *
 * A non-guaranteed ALI (line_item_type standard_v2, subtype standard_buying)
 * budgeted in euros. The onboarding flow asks for a monthly budget and a
 * duration, which turns into one lifetime budget interval with pacing on;
 * expressing the goal in impressions instead would mean converting through a
 * CPM we only hold as a placeholder.
 */

import { advertiserId as configuredAdvertiserId, insertionOrderId as configuredInsertionOrderId } from "./config";
import { request } from "./client";
import {
  LINE_ITEM_SUBTYPE_STANDARD,
  LINE_ITEM_TYPE_ALI,
  type BookingRequest,
  type LineItemBody,
  type LineItemCreatedResponse,
  type LineItemInput,
} from "./types";

/** Xandr pauses a line item that overshoots; 105% lets pacing catch up. */
const LIFETIME_PACING_PCT = 105;

export function buildLineItem(
  req: BookingRequest,
  profileId: number,
  creativeIds: number[],
  /** Paused unless the caller explicitly asks for a running line item. */
  activate = false,
  code?: string
): LineItemInput {
  const lineItem: LineItemBody = {
    name: req.campaignName,
    ...(code && { code }),
    insertion_orders: [
      { id: req.insertionOrderId ?? configuredInsertionOrderId() },
    ],
    state: activate ? "active" : "inactive",
    profile_id: profileId,
    // Each element must carry `id` or `code` or Xandr answers SYNTAX.
    creatives: creativeIds.map((id) => ({ id })),
    // Xandr requires this true when the line item selects its own creatives.
    manage_creative: true,
    ad_types: ["banner"],
    revenue_type: req.revenueType,
    revenue_value: req.revenueValue,
    // CPC formats are billed on CPM and optimised towards a cost per click;
    // Xandr will not accept cpc as a revenue type on this line item type.
    ...(req.goal && {
      goal_type: req.goal.type,
      goal_value: req.goal.value,
      valuation: { goal_threshold: req.goal.threshold ?? req.goal.value },
    }),
    creative_distribution_type: "ctr-optimized",
    line_item_type: LINE_ITEM_TYPE_ALI,
    line_item_subtype: LINE_ITEM_SUBTYPE_STANDARD,
    budget_intervals: [
      {
        start_date: req.startDate,
        end_date: req.endDate,
        lifetime_budget: req.lifetimeBudgetEur,
        lifetime_pacing: true,
        enable_pacing: true,
        lifetime_pacing_pct: LIFETIME_PACING_PCT,
      },
    ],
    comments: "Created automatically by AMR Asset Studio.",
  };

  return { "line-item": lineItem };
}

export async function createLineItem(
  input: LineItemInput,
  advertiser?: number
): Promise<number> {
  const response = await request<LineItemCreatedResponse>({
    method: "POST",
    service: "line-item",
    params: { advertiser_id: advertiser ?? configuredAdvertiserId() },
    body: input,
  });

  const id = response["line-item"]?.id;
  if (!id) throw new Error("Xandr created no line item.");
  return id;
}
