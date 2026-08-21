/**
 * Book a real set of studio assets into Xandr under the test member.
 *
 * The assets come from the studio's own template and renderer — the same code
 * path api/generate uses — with the brand and copy supplied by hand so the run
 * needs no Anthropic key. What reaches Xandr is what the flow really produces.
 *
 *   npm run xandr:live-test              assemble only, send nothing
 *   npm run xandr:live-test -- --book    create the objects (line item paused)
 */

import { renderBannerHtml } from "../lib/templates/banner";
import { renderToImage, closeBrowser } from "../lib/render";
import { getFormat, getHtml5Format } from "../lib/specs";
import { bookCampaign, bookingConfigSummary } from "../lib/xandr/book";
import { XANDR_CLICK_MACRO } from "../lib/xandr/creative";
import type { BrandCard, CopyVariant, GeneratedAsset } from "../lib/types";

const book = process.argv.includes("--book");
/** --reuse=1,2,3 retries the line item against creatives that already exist. */
const reuseArg = process.argv.find((a) => a.startsWith("--reuse="));
const reuseCreativeIds = reuseArg
  ? reuseArg.slice("--reuse=".length).split(",").map(Number).filter(Number.isFinite)
  : [];

const brand: BrandCard = {
  sourceUrl: "https://www.almamedia.fi",
  companyName: "Alma Test & Development",
  description: "A test advertiser used to rehearse the booking path.",
  tone: "Plain and direct",
  contentType: "Media and Entertainment",
  contentTypeAlternatives: [],
  logoUrl: null,
  colors: {
    primary: "#0b3d91",
    secondary: "#1769d1",
    accent: "#ffb703",
    background: "#ffffff",
    text: "#101820",
  },
  fonts: { heading: "Archivo", body: "Archivo" },
  images: [],
};

const copy: CopyVariant = {
  id: "a",
  headline: "A test campaign",
  body: "Booked automatically from the asset studio.",
  cta: "Read more",
};

/** One static per primary format, plus one HTML5, exactly as generate.ts does. */
async function buildAssets(): Promise<GeneratedAsset[]> {
  const assets: GeneratedAsset[] = [];

  for (const formatId of ["boksi", "performance-display"]) {
    const fmt = getFormat(formatId);
    const html = renderBannerHtml({
      width: fmt.width,
      height: fmt.height,
      brand,
      copy,
      imageDataUri: null,
      logoDataUri: null,
      animated: false,
    });
    const rendered = await renderToImage(
      html,
      fmt.width,
      fmt.height,
      fmt.maxFileSizeKb * 1024
    );
    assets.push({
      id: `${fmt.id}-a`,
      formatId: fmt.id,
      formatName: fmt.name,
      kind: "static",
      width: fmt.width,
      height: fmt.height,
      dataUri: `data:image/${rendered.fileType === "jpg" ? "jpeg" : "png"};base64,${rendered.buffer.toString("base64")}`,
      fileName: `alma-test_${fmt.id}_${fmt.width}x${fmt.height}_a.${rendered.fileType}`,
      fileSizeBytes: rendered.bytes,
      copy,
      validation: { pass: true, checks: [] },
    });
  }

  const h5 = getHtml5Format("performance-display-html5");
  const base = getFormat(h5.baseFormat);
  const html = renderBannerHtml({
    width: base.width,
    height: base.height,
    brand,
    copy,
    imageDataUri: null,
    logoDataUri: null,
    animated: true,
    clickUrl: "https://www.almamedia.fi/",
    clickMacro: XANDR_CLICK_MACRO,
  });
  const anchor = /<a class="ad" href="([^"]+)"/.exec(html);
  console.log("html5 click-through:", anchor ? anchor[1] : "MISSING");
  assets.push({
    id: `${h5.id}-a`,
    formatId: h5.id,
    formatName: h5.name,
    kind: "html5",
    width: base.width,
    height: base.height,
    html,
    fileName: `alma-test_${h5.id}_${base.width}x${base.height}_a.html`,
    fileSizeBytes: Buffer.byteLength(html, "utf8"),
    copy,
    validation: { pass: true, checks: [] },
  });

  return assets;
}

const assets = reuseCreativeIds.length > 0 ? [] : await buildAssets();
if (reuseCreativeIds.length === 0) await closeBrowser();

console.log("=== config ===");
console.log(bookingConfigSummary());

console.log("\n=== assets from the studio pipeline ===");
for (const a of assets) {
  console.log(
    ` ${a.kind.padEnd(6)} ${a.formatId.padEnd(28)} ${a.width}x${String(a.height).padEnd(5)} ${Math.round(a.fileSizeBytes / 1024)} kB`
  );
}

/** Stands in for the asset list on a --reuse run, which uploads nothing. */
const PLACEHOLDER_ASSETS: GeneratedAsset[] = [
  {
    id: "reused",
    formatId: "reused",
    formatName: "Reused",
    kind: "static",
    width: 1,
    height: 1,
    fileName: "reused",
    fileSizeBytes: 0,
    copy: { id: "a", headline: "", body: "", cta: "" },
    validation: { pass: true, checks: [] },
  },
];

const today = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const end = new Date(today);
end.setMonth(end.getMonth() + 1);

const result = await bookCampaign(
  {
    // Stamped on every object created, so this run can be found and removed
    // later with: npm run xandr:cleanup -- --tag=<tag> --delete
    tag: `amr-demo-${day(today)}-${pad(today.getHours())}${pad(today.getMinutes())}`,
    campaignName: `AMR Asset Studio smoke test ${day(today)}`,
    clickUrl: "https://www.almamedia.fi/",
    startDate: `${day(today)} 00:00:00`,
    endDate: `${day(end)} 23:59:59`,
    lifetimeBudgetEur: 100,
    // Xandr bills standard_v2 on impressions; the per-click price rides along
    // as an optimisation goal.
    revenueType: "cpm",
    revenueValue: 5,
    goal: { type: "cpc", value: 0.6 },
    // A reuse run has no local assets; validation still needs a non-empty list.
    assets: reuseCreativeIds.length > 0 ? PLACEHOLDER_ASSETS : assets,
    targeting: { channelIds: ["iltalehti"] },
  },
  { dryRun: !book, reuseCreativeIds }
);

console.log("\n=== result ===");
console.log({
  dryRun: result.dryRun,
  lineItemId: result.lineItemId,
  profileId: result.profileId,
  creativeIds: result.creativeIds,
  mediaAssetIds: result.mediaAssetIds,
});

console.log("\n=== warnings ===");
for (const w of result.warnings) console.log(` - ${w}`);
