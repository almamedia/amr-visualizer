import {
  getFormat,
  getHtml5Format,
  requireAiActLabel,
  specs,
} from "./specs";
import { generateCopy } from "./claude";
import { toDataUri } from "./assets";
import { compressImage, measureLuminance, renderToImage } from "./render";
import {
  renderBannerHtml,
  resolveBannerColors,
  ANIMATION_DURATION_SECONDS,
} from "./templates/banner";
import { fitCopyToLimits, validateStatic, validateHtml5 } from "./validate";
import { mapLimit } from "./concurrency";
import type {
  BrandCard,
  CopyVariant,
  GeneratedAsset,
  GoalId,
  TextLimits,
} from "./types";

const KB = 1024;
const RENDER_CONCURRENCY = 3;
const MAX_LOGO_BYTES = 80 * KB;
/** Below this the logo disappears into the ground and is not worth using. */
const MIN_LOGO_CONTRAST = 1.6;

/** In an HTML5 package the image shares its weight budget with the markup. */
const IMAGE_BUDGET_RATIO = 0.5;

export interface GenerateOptions {
  brand: BrandCard;
  goalId: GoalId;
  /** Defaults to the primary formats in the spec library. */
  formatIds?: string[];
  /** Defaults to the first HTML5 format. */
  html5FormatId?: string;
  /** Copy the user has edited. When given, Claude is not called — the assets
   *  are rendered straight from this text. */
  copyVariants?: CopyVariant[];
  /**
   * Landing page for the HTML5 assets. Defaults to the site the brand was read
   * from. Static assets do not need it — the adserver makes those clickable —
   * but an HTML5 tag carries its own link or the ad is dead on arrival.
   */
  clickUrl?: string;
  /** Adserver click macro placed before the landing page, e.g. "${CLICK_URL}". */
  clickMacro?: string;
}

export interface GenerateResult {
  assets: GeneratedAsset[];
  copyVariants: CopyVariant[];
  /** The tightest character limits, shown by the UI in its edit fields. */
  limits: TextLimits;
  warnings: string[];
}

/** The tightest limits across the chosen formats — so the copy fits every size. */
function tightestLimits(formatIds: string[]): TextLimits {
  return formatIds
    .map((id) => getFormat(id).textLimits)
    .reduce((acc, l) => ({
      headline: Math.min(acc.headline, l.headline),
      body: Math.min(acc.body, l.body),
      cta: Math.min(acc.cta, l.cta),
    }));
}

export async function generateAssets(
  opts: GenerateOptions
): Promise<GenerateResult> {
  const warnings: string[] = [];
  const formatIds =
    opts.formatIds?.length
      ? opts.formatIds
      : specs.formats.filter((f) => f.primary).map((f) => f.id);
  const html5FormatId = opts.html5FormatId ?? specs.html5Formats[0].id;

  const limits = tightestLimits(formatIds);
  const copyVariants = opts.copyVariants?.length
    ? opts.copyVariants.map((v, i) => ({ ...v, id: `v${i + 1}` }))
    : await generateCopy(opts.brand, opts.goalId, limits);

  // The logo and the main image are fetched once and shared by every asset.
  const activeImage = opts.brand.images.find((i) => i.enabled) ?? null;

  const [logoRaw, imageRaw] = await Promise.all([
    opts.brand.logoUrl ? toDataUri(opts.brand.logoUrl) : Promise.resolve(null),
    activeImage ? toDataUri(activeImage.url) : Promise.resolve(null),
  ]);

  let logoDataUri = logoRaw;
  if (logoRaw && approxBytes(logoRaw) > MAX_LOGO_BYTES) {
    logoDataUri = null;
    warnings.push(
      "The logo was too heavy for the weight limit — the assets use the company name as text instead."
    );
  }
  if (opts.brand.logoUrl && !logoRaw) {
    warnings.push("The logo could not be fetched — using the company name as text instead.");
  }

  // A logo can load perfectly and still vanish into the ground (a reversed-out
  // version on a light background). Measure the pixels and drop the logo if it
  // does not separate. The comparison is against the banner's real ground: in
  // colour mode that is the brand colour, not the brand card's background.
  const bannerColors = resolveBannerColors(opts.brand, Boolean(imageRaw));

  if (logoDataUri) {
    const logoLum = await measureLuminance(logoDataUri);
    if (logoLum !== null) {
      const bgLum = relativeLuminance(bannerColors.ground);
      const contrast =
        (Math.max(logoLum, bgLum) + 0.05) / (Math.min(logoLum, bgLum) + 0.05);
      if (contrast < MIN_LOGO_CONTRAST) {
        logoDataUri = null;
        warnings.push(
          "The logo does not separate from the background (likely a reversed-out version) — the assets use the company name as text instead. You can change the background colour or remove the logo on the brand card."
        );
      }
    }
  }
  if (activeImage && !imageRaw) {
    warnings.push(
      "The selected image could not be fetched — the assets were built without it."
    );
  }

  // Compress the image once per format, since the aspect ratio differs.
  const imagesByFormat = new Map<string, string | null>();
  if (imageRaw) {
    const compressed = await mapLimit(formatIds, RENDER_CONCURRENCY, async (id) => {
      const f = getFormat(id);
      const budget = Math.round(f.maxFileSizeKb * KB * IMAGE_BUDGET_RATIO);
      return [id, await compressImage(imageRaw, f.width, f.height, budget)] as const;
    });
    for (const [id, uri] of compressed) imagesByFormat.set(id, uri);
  }

  // Every static combination: format × copy variant.
  type Job = { formatId: string; variant: CopyVariant };
  const jobs: Job[] = [];
  for (const variant of copyVariants) {
    for (const formatId of formatIds) jobs.push({ formatId, variant });
  }

  const statics = await mapLimit(jobs, RENDER_CONCURRENCY, async (job) => {
    const fmt = getFormat(job.formatId);
    const copy = fitCopyToLimits(job.variant, fmt.textLimits);
    const fmtImage = imagesByFormat.get(job.formatId) ?? null;
    // Colours are resolved per format: if the image did not fit this size,
    // the banner falls into colour mode and contrast is measured from that.
    const formatColors = resolveBannerColors(opts.brand, Boolean(fmtImage));
    const html = renderBannerHtml({
      width: fmt.width,
      height: fmt.height,
      brand: opts.brand,
      copy,
      imageDataUri: fmtImage,
      logoDataUri,
      animated: false,
    });

    const maxBytes = fmt.maxFileSizeKb * KB;
    const rendered = await renderToImage(html, fmt.width, fmt.height, maxBytes);

    const fileName = `${slug(opts.brand.companyName)}_${fmt.id}_${fmt.width}x${
      fmt.height
    }_${job.variant.id}.${rendered.fileType}`;

    const asset: GeneratedAsset = {
      id: `${fmt.id}-${job.variant.id}`,
      formatId: fmt.id,
      formatName: fmt.name,
      kind: "static",
      width: fmt.width,
      height: fmt.height,
      dataUri: `data:image/${
        rendered.fileType === "jpg" ? "jpeg" : "png"
      };base64,${rendered.buffer.toString("base64")}`,
      fileName,
      fileSizeBytes: rendered.bytes,
      copy,
      validation: validateStatic({
        formatId: fmt.id,
        width: fmt.width,
        height: fmt.height,
        fileSizeBytes: rendered.bytes,
        fileType: rendered.fileType,
        copy,
        hasAiActLabel: requireAiActLabel,
        contrast: {
          ground: formatColors.ground,
          text: formatColors.text,
          ctaBg: formatColors.ctaBg,
          ctaText: formatColors.ctaText,
        },
      }),
    };
    return asset;
  });

  // One HTML5 animation per copy variant.
  const h5 = getHtml5Format(html5FormatId);
  const h5Base = getFormat(h5.baseFormat);

  const html5Assets: GeneratedAsset[] = copyVariants.map((variant) => {
    const copy = fitCopyToLimits(variant, h5Base.textLimits);
    const html = renderBannerHtml({
      width: h5Base.width,
      height: h5Base.height,
      brand: opts.brand,
      copy,
      imageDataUri: imagesByFormat.get(h5Base.id) ?? null,
      logoDataUri,
      animated: true,
      clickUrl: opts.clickUrl ?? opts.brand.sourceUrl ?? null,
      clickMacro: opts.clickMacro,
    });
    const bytes = Buffer.byteLength(html, "utf8");

    return {
      id: `${h5.id}-${variant.id}`,
      formatId: h5.id,
      formatName: h5.name,
      kind: "html5",
      width: h5Base.width,
      height: h5Base.height,
      html,
      fileName: `${slug(opts.brand.companyName)}_${h5.id}_${h5Base.width}x${
        h5Base.height
      }_${variant.id}.html`,
      fileSizeBytes: bytes,
      copy,
      validation: validateHtml5({
        html5FormatId: h5.id,
        width: h5Base.width,
        height: h5Base.height,
        fileSizeBytes: bytes,
        animationSeconds: ANIMATION_DURATION_SECONDS,
        copy,
        hasAiActLabel: requireAiActLabel,
        html,
      }),
    };
  });

  const assets = [...statics, ...html5Assets];

  const failed = assets.filter((a) => !a.validation.pass);
  if (failed.length) {
    warnings.push(
      `${failed.length} assets did not pass validation. See the flagged checks on the asset cards.`
    );
  }

  return { assets, copyVariants, limits, warnings };
}

function relativeLuminance(hex: string): number {
  const s = (hex || "#ffffff").replace("#", "");
  const ch = (i: number) => {
    const c = parseInt(s.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

function approxBytes(dataUri: string): number {
  const i = dataUri.indexOf(",");
  const b64 = i === -1 ? dataUri : dataUri.slice(i + 1);
  return Math.floor((b64.length * 3) / 4);
}

/** Filename-safe slug. Nordic vowels are transliterated rather than stripped:
 *  the company names this runs on are largely Finnish, and dropping the vowel
 *  turns "Hämeen" into "Hmeen". */
export function slug(s: string): string {
  return (
    (s || "asset")
      .toLowerCase()
      .replace(/[äå]/g, "a")
      .replace(/ö/g, "o")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "asset"
  );
}
