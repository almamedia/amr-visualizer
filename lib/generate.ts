import {
  getFormat,
  getHtml5Format,
  requireAiActLabel,
  specs,
} from "./specs";
import { generateCopy } from "./claude";
import { toDataUri } from "./assets";
import { compressImage, measureLogoVisibility, renderToImage } from "./render";
import {
  renderBannerHtml,
  resolveBannerColors,
  ANIMATION_DURATION_SECONDS,
} from "./templates/banner";
import {
  fitCopyToLimits,
  stripLongDashes,
  validateStatic,
  validateHtml5,
} from "./validate";
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
/**
 * Kuinka suuren osan logon näkyvistä pikseleistä on erotuttava pohjasta.
 * Logo on usein piirretty valkoisen levyn päälle, jolloin suurin osa
 * pinnasta on pohjan väriä ja vain teksti erottuu. 5 % riittää siihen,
 * että logo on tunnistettavissa, ja pudottaa silti aidon negaversion,
 * jossa erottuvia pikseleitä ei ole lainkaan.
 */
const MIN_LOGO_VISIBLE_RATIO = 0.05;

/** HTML5-paketissa kuva jakaa painobudjetin merkkauksen kanssa. */
const IMAGE_BUDGET_RATIO = 0.5;

export interface GenerateOptions {
  brand: BrandCard;
  goalId: GoalId;
  /** Oletuksena speksikirjaston ensisijaiset formaatit. */
  formatIds?: string[];
  /** Oletuksena ensimmäinen HTML5-formaatti. */
  html5FormatId?: string;
  /** Käyttäjän muokkaamat tekstit. Kun nämä annetaan, Claudea ei kutsuta,
   *  vaan aineistot renderöidään suoraan annetuilla teksteillä. */
  copyVariants?: CopyVariant[];
}

export interface GenerateResult {
  assets: GeneratedAsset[];
  copyVariants: CopyVariant[];
  /** Tiukimmat merkkirajat, joita UI näyttää muokkauskentissä. */
  limits: TextLimits;
  warnings: string[];
}

/** Tiukimmat merkkirajat valituista formaateista, jotta copy mahtuu joka kokoon. */
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
  // Käyttäjän kirjoittamat tekstit siivotaan jo tässä, jotta muokkauskentät
  // näyttävät saman tekstin kuin valmis mainos.
  const copyVariants = opts.copyVariants?.length
    ? opts.copyVariants.map((v, i) => ({
        id: `v${i + 1}`,
        headline: stripLongDashes(v.headline),
        body: stripLongDashes(v.body),
        cta: stripLongDashes(v.cta),
      }))
    : await generateCopy(opts.brand, opts.goalId, limits);

  // Logo ja pääkuva ladataan kerran ja jaetaan kaikille aineistoille.
  const activeImage = opts.brand.images.find((i) => i.enabled) ?? null;

  const [logoRaw, imageRaw] = await Promise.all([
    opts.brand.logoUrl ? toDataUri(opts.brand.logoUrl) : Promise.resolve(null),
    activeImage ? toDataUri(activeImage.url) : Promise.resolve(null),
  ]);

  let logoDataUri = logoRaw;
  if (logoRaw && approxBytes(logoRaw) > MAX_LOGO_BYTES) {
    logoDataUri = null;
    warnings.push(
      "Logo on liian suuri, joten mainoksissa näkyy yrityksen nimi tekstinä. Voit ladata kevyemmän logon."
    );
  }
  if (opts.brand.logoUrl && !logoRaw) {
    warnings.push(
      "Logoa ei saatu ladattua, joten mainoksissa näkyy yrityksen nimi tekstinä. Voit ladata logon itse."
    );
  }

  // Logo voi latautua moitteettomasti ja silti kadota taustaan (negaversio
  // vaalealla pohjalla). Mitataan pikselit ja pudotetaan logo, jos se ei erotu.
  // Vertailu tehdään bannerin todellista pohjaa vasten: värillisessä moodissa
  // pohja on brändiväri, ei brändikortin taustaväri.
  const bannerColors = resolveBannerColors(opts.brand, Boolean(imageRaw));

  if (logoDataUri) {
    const visible = await measureLogoVisibility(
      logoDataUri,
      bannerColors.ground
    );
    if (visible !== null && visible < MIN_LOGO_VISIBLE_RATIO) {
      logoDataUri = null;
      // Yleisin syy on vaalea logo vaalealla pohjalla. "Negaversio" on
      // painoalan sana, jota pk-yrittäjän ei tarvitse tuntea.
      warnings.push(
        "Logo on liian vaalea erottumaan mainoksen pohjasta, joten mainoksissa näkyy yrityksen nimi tekstinä. Lataa tummempi logo, jos sinulla on."
      );
    }
  }
  if (activeImage && !imageRaw) {
    warnings.push(
      "Kuvaa ei saatu ladattua, joten mainokset tehtiin ilman sitä. Voit ladata oman kuvan."
    );
  }

  // Pakkaa kuva kertaalleen kutakin formaattia kohden (kokosuhde vaihtelee).
  const imagesByFormat = new Map<string, string | null>();
  if (imageRaw) {
    const compressed = await mapLimit(formatIds, RENDER_CONCURRENCY, async (id) => {
      const f = getFormat(id);
      const budget = Math.round(f.maxFileSizeKb * KB * IMAGE_BUDGET_RATIO);
      return [id, await compressImage(imageRaw, f.width, f.height, budget)] as const;
    });
    for (const [id, uri] of compressed) imagesByFormat.set(id, uri);
  }

  // Kaikki staattiset yhdistelmät: formaatti × copy-variaatio.
  type Job = { formatId: string; variant: CopyVariant };
  const jobs: Job[] = [];
  for (const variant of copyVariants) {
    for (const formatId of formatIds) jobs.push({ formatId, variant });
  }

  const statics = await mapLimit(jobs, RENDER_CONCURRENCY, async (job) => {
    const fmt = getFormat(job.formatId);
    const copy = fitCopyToLimits(job.variant, fmt.textLimits);
    const fmtImage = imagesByFormat.get(job.formatId) ?? null;
    // Värit ratkaistaan formaattikohtaisesti: jos kuva ei mahtunut tähän
    // kokoon, banneri menee värilliseen moodiin ja kontrasti mitataan siitä.
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
      formatPlainName: fmt.plainName,
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

  // HTML5-animaatio kustakin copy-variaatiosta.
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
    });
    const bytes = Buffer.byteLength(html, "utf8");

    return {
      id: `${h5.id}-${variant.id}`,
      formatId: h5.id,
      formatName: h5.name,
      formatPlainName: h5.plainName,
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
      `${failed.length} mainos${
        failed.length === 1 ? "" : "ta"
      } vaatii huomiota. Katso merkinnät mainosten kohdalta.`
    );
  }

  return { assets, copyVariants, limits, warnings };
}

function approxBytes(dataUri: string): number {
  const i = dataUri.indexOf(",");
  const b64 = i === -1 ? dataUri : dataUri.slice(i + 1);
  return Math.floor((b64.length * 3) / 4);
}

export function slug(s: string): string {
  return (
    (s || "aineisto")
      .toLowerCase()
      .replace(/[äå]/g, "a")
      .replace(/ö/g, "o")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "aineisto"
  );
}
