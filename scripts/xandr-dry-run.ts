/**
 * Assemble a Xandr booking and print it, without sending anything.
 *
 *   npm run xandr:dry-run
 *   npm run xandr:dry-run -- --live      (needs a filled-in .env.local)
 *
 * The dry run needs no credentials: it is how the payloads get reviewed
 * against what Xandr expects before anything is booked for real. --live
 * actually creates the objects and requires a filled-in .env.local.
 */

import { bookCampaign, bookingConfigSummary } from "../lib/xandr/book";
import { buildBookingRequest } from "../lib/xandr/mapping";
import { recommend } from "../lib/onboarding/recommend";
import type { FlowAnswers } from "../lib/onboarding/types";
import type { GeneratedAsset } from "../lib/types";

const live = process.argv.includes("--live");

// A 1x1 PNG stands in for a rendered banner; the studio produces the real ones.
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function asset(over: Partial<GeneratedAsset> & Pick<GeneratedAsset, "id">): GeneratedAsset {
  return {
    formatId: "paraati",
    formatName: "Paraati",
    kind: "static",
    width: 980,
    height: 400,
    dataUri: PNG_1X1,
    fileName: `${over.id}.png`,
    fileSizeBytes: 1024,
    copy: { id: "a", headline: "Headline", body: "Body", cta: "Read more" },
    validation: { pass: true, checks: [] },
    ...over,
  };
}

const assets: GeneratedAsset[] = [
  asset({ id: "paraati-a" }),
  asset({ id: "paraati-b", copy: { id: "b", headline: "Second", body: "Body", cta: "Read more" } }),
  asset({
    id: "paraati-html5-a",
    kind: "html5",
    dataUri: undefined,
    html: "<html><body><div id='ad'>Hello</div><script>console.log('run')</script></body></html>",
    fileName: "paraati-html5-a.html",
  }),
];

const answers: FlowAnswers = {
  url: "https://example.fi",
  urlSkipped: false,
  goal: "conversion",
  timeline: { startMode: "date", startDate: "2026-09-01", duration: "1-month" },
  audience: {
    geography: "region",
    regionIds: ["uusimaa"],
    cities: [],
    types: ["general-consumers"],
    cohorts: [],
    enrichment: "",
  },
  budget: { tier: "medium", customEur: null },
};

const recommendation = recommend(answers, null);

const { request, warnings } = buildBookingRequest({
  answers,
  recommendation,
  assets,
  clickUrl: "https://example.fi/offer",
  businessName: "Example Oy",
  // The traffic goal recommends a per-click format, and Xandr bills this line
  // item type on impressions, so a CPM has to come from somewhere. Placeholder
  // until Ad Ops supplies one (docs/task-fanout.md T1).
  cpmEur: 5,
  now: new Date("2026-08-20T09:00:00Z"),
});

console.log("=== config ===");
console.log(bookingConfigSummary());

console.log("\n=== mapping warnings ===");
for (const w of warnings) console.log(` - ${w}`);

console.log("\n=== booking request ===");
console.log(JSON.stringify({ ...request, assets: `${assets.length} assets` }, null, 2));

const result = await bookCampaign(
  { ...request, tag: "amr-dry-run" },
  { dryRun: !live }
);

console.log("\n=== payloads ===");
console.log(JSON.stringify(result.payloads, null, 2));

console.log("\n=== booking warnings ===");
for (const w of result.warnings) console.log(` - ${w}`);

if (live) {
  console.log("\n=== created ===");
  console.log({
    lineItemId: result.lineItemId,
    profileId: result.profileId,
    creativeIds: result.creativeIds,
    mediaAssetIds: result.mediaAssetIds,
  });
}
