import { bookCampaign, bookingConfigSummary } from "@/lib/xandr/book";
import type { BookingRequest } from "@/lib/xandr/types";
import type { GeneratedAsset } from "@/lib/types";
import type { CreativeBrief } from "@/lib/onboarding/types";

import type { Route } from "./+types/api.book";

/** Xandr wants "YYYY-MM-DD HH:MM:SS", not ISO 8601. */
function xandrDate(iso: string, endOfDay = false): string {
  return `${iso} ${endOfDay ? "23:59:59" : "00:00:00"}`;
}

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setMonth(date.getMonth() + months);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Tells a booking's objects apart from everything else in the advertiser. */
function bookingTag(brief: CreativeBrief): string {
  const slug = brief.businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return `ams-${slug || "advertiser"}-${Date.now()}`;
}

export function loader() {
  // The UI asks before offering the button, so it can say why it is unavailable
  // rather than failing on click.
  return Response.json(bookingConfigSummary());
}

export async function action({ request }: Route.ActionArgs) {
  let brief: CreativeBrief;
  let assets: GeneratedAsset[];
  let dryRun: boolean;

  try {
    const body = await request.json();
    brief = body?.brief;
    assets = Array.isArray(body?.assets) ? body.assets : [];
    dryRun = Boolean(body?.dryRun);
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const booking = brief?.booking;
  if (!booking) {
    return Response.json(
      {
        error:
          "This ad was made without an onboarding brief, so there are no dates, budget or targeting to book with.",
      },
      { status: 400 }
    );
  }
  if (assets.length === 0) {
    return Response.json({ error: "There are no assets to book." }, { status: 400 });
  }
  if (!booking.clickUrl) {
    return Response.json(
      { error: "The campaign has no landing page to click through to." },
      { status: 400 }
    );
  }

  // Xandr bills this line item type on impressions and rejects a cpc revenue
  // type outright, so a per-click format is booked at a CPM and optimised
  // towards the click price. The CPM is a real billing figure with no home in
  // the data yet, so a per-click campaign cannot be booked until Ad Ops set one.
  const perClick = booking.pricingModel === "cpc";
  const cpmEur = Number(process.env.XANDR_DEFAULT_CPM_EUR ?? 0);
  if (perClick && !(cpmEur > 0)) {
    return Response.json(
      {
        error:
          "This format is sold per click, but the adserver bills on impressions. Set XANDR_DEFAULT_CPM_EUR once Ad Ops confirm the rate.",
      },
      { status: 400 }
    );
  }

  const req: BookingRequest = {
    campaignName: `${brief.businessName} — ${brief.goal.label}`.slice(0, 190),
    clickUrl: booking.clickUrl,
    startDate: xandrDate(booking.startDate),
    endDate: xandrDate(addMonths(booking.startDate, booking.months), true),
    lifetimeBudgetEur: booking.lifetimeBudgetEur,
    revenueType: "cpm",
    revenueValue: perClick ? cpmEur : booking.priceEur,
    ...(perClick && { goal: { type: "cpc" as const, value: booking.priceEur } }),
    assets,
    targeting: {
      channelIds: booking.channelIds,
      regionId: booking.regionId || undefined,
      audienceTypes: brief.audienceTypes,
    },
    tag: bookingTag(brief),
  };

  try {
    // Line items are created paused: the channel targeting ids are still
    // placeholders, and an untargeted line item is eligible for everything.
    const result = await bookCampaign(req, { dryRun });
    return Response.json(result);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "The adserver rejected the booking.";
    return Response.json({ error: message }, { status: 502 });
  }
}
