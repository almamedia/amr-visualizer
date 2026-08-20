import { specs, getFormat, getHtml5Format } from "./specs";
import type {
  CopyVariant,
  ValidationCheck,
  ValidationResult,
} from "./types";

const KB = 1024;

function check(
  id: string,
  label: string,
  pass: boolean,
  detail?: string
): ValidationCheck {
  return { id, label, pass, detail };
}

interface StaticInput {
  formatId: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  fileType: string;
  copy: CopyVariant;
  /** Näkyykö AI Act -merkintä renderöidyssä aineistossa. */
  hasAiActLabel: boolean;
  /** Aineiston todelliset värit kontrastitarkistusta varten. */
  contrast?: ContrastInput;
}

export interface ContrastInput {
  ground: string;
  text: string;
  ctaBg: string;
  ctaText: string;
}

/** WCAG AA pienelle tekstille. Bannerin otsikko on isoa, mutta leipäteksti
 *  ei ole, ja sama raja pitää mainoksen luettavana myös pienessä koossa. */
const MIN_TEXT_CONTRAST = 4.5;
/** Painike saa erottua pohjasta pienemmällä erolla kuin teksti, mutta
 *  sen pitää erottua — muuten CTA sulautuu pintaan. */
const MIN_CTA_SEPARATION = 1.8;

function ratio(a: string, b: string): number {
  const la = rel(a);
  const lb = rel(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function rel(hex: string): number {
  const s = (hex || "#ffffff").replace("#", "");
  const ch = (i: number) => {
    const c = parseInt(s.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

/** Bannerimainonnan perusvaatimus: teksti on luettava ja CTA erottuu. */
function contrastChecks(c: ContrastInput): ValidationCheck[] {
  const textRatio = ratio(c.text, c.ground);
  const ctaRatio = ratio(c.ctaBg, c.ground);
  const ctaTextRatio = ratio(c.ctaText, c.ctaBg);

  return [
    check(
      "contrast-text",
      "Tekstin kontrasti",
      textRatio >= MIN_TEXT_CONTRAST,
      `${textRatio.toFixed(1)}:1 (vaadittu ${MIN_TEXT_CONTRAST}:1)`
    ),
    check(
      "contrast-cta",
      "CTA erottuu pohjasta",
      ctaRatio >= MIN_CTA_SEPARATION && ctaTextRatio >= MIN_TEXT_CONTRAST,
      `nappi ${ctaRatio.toFixed(1)}:1 · teksti napissa ${ctaTextRatio.toFixed(
        1
      )}:1`
    ),
  ];
}

/**
 * Validoi staattisen display-aineiston speksikirjastoa vasten.
 * Puhdasta Node-koodia — ei AI:ta, ei verkkokutsuja.
 */
export function validateStatic(input: StaticInput): ValidationResult {
  const fmt = getFormat(input.formatId);
  const checks: ValidationCheck[] = [];

  checks.push(
    check(
      "dimensions",
      "Mitat",
      input.width === fmt.width && input.height === fmt.height,
      `${input.width}×${input.height} px (vaadittu ${fmt.width}×${fmt.height})`
    )
  );

  const maxBytes = fmt.maxFileSizeKb * KB;
  checks.push(
    check(
      "filesize",
      "Tiedostokoko",
      input.fileSizeBytes <= maxBytes,
      `${Math.round(input.fileSizeBytes / KB)} kt / max ${fmt.maxFileSizeKb} kt`
    )
  );

  checks.push(
    check(
      "filetype",
      "Tiedostomuoto",
      fmt.acceptedTypes.includes(input.fileType),
      `${input.fileType.toUpperCase()} (sallitut: ${fmt.acceptedTypes
        .filter((t) => specs.global.acceptedStaticFormats.includes(t))
        .join(", ")
        .toUpperCase()})`
    )
  );

  checks.push(...textChecks(input.copy, fmt.textLimits));
  if (input.contrast) checks.push(...contrastChecks(input.contrast));

  if (specs.global.requireAiActLabel) {
    checks.push(
      check(
        "aiact",
        "AI Act -merkintä",
        input.hasAiActLabel,
        `"${specs.global.aiActLabel}"`
      )
    );
  }

  return { pass: checks.every((c) => c.pass), checks };
}

interface Html5Input {
  html5FormatId: string;
  width: number;
  height: number;
  /** Pakatun zip-paketin koko tai HTML:n koko tavuina. */
  fileSizeBytes: number;
  animationSeconds: number;
  copy: CopyVariant;
  hasAiActLabel: boolean;
  html: string;
}

/** Validoi HTML5-animaatioaineiston. */
export function validateHtml5(input: Html5Input): ValidationResult {
  const h5 = getHtml5Format(input.html5FormatId);
  const base = getFormat(h5.baseFormat);
  const checks: ValidationCheck[] = [];

  checks.push(
    check(
      "dimensions",
      "Mitat",
      input.width === base.width && input.height === base.height,
      `${input.width}×${input.height} px (vaadittu ${base.width}×${base.height})`
    )
  );

  const maxBytes = h5.maxFileSizeKb * KB;
  checks.push(
    check(
      "filesize",
      "Alkulatauksen koko",
      input.fileSizeBytes <= maxBytes,
      `${Math.round(input.fileSizeBytes / KB)} kt / max ${h5.maxFileSizeKb} kt`
    )
  );

  checks.push(
    check(
      "animation",
      "Animaation kesto",
      input.animationSeconds <= h5.maxAnimationSeconds,
      `${input.animationSeconds} s / max ${h5.maxAnimationSeconds} s`
    )
  );

  // Alma vaatii, että kaikki ulkoiset resurssit ladataan HTTPS:n yli.
  const insecure = input.html.match(/(?:src|href)\s*=\s*["']http:\/\/[^"']+/gi);
  checks.push(
    check(
      "https",
      "HTTPS-resurssit",
      !insecure,
      insecure
        ? `${insecure.length} http-resurssia`
        : "Ei http-resursseja"
    )
  );

  // jQuery on Alman ohjeissa erikseen kielletty tiedostopainon vuoksi.
  checks.push(
    check(
      "nojquery",
      "Ei jQueryä",
      !/jquery/i.test(input.html),
      "Alma: vältä jQueryä tiedostopainon vuoksi"
    )
  );

  checks.push(...textChecks(input.copy, base.textLimits));

  if (specs.global.requireAiActLabel) {
    checks.push(
      check(
        "aiact",
        "AI Act -merkintä",
        input.hasAiActLabel,
        `"${specs.global.aiActLabel}"`
      )
    );
  }

  return { pass: checks.every((c) => c.pass), checks };
}

function textChecks(
  copy: CopyVariant,
  limits: { headline: number; body: number; cta: number }
): ValidationCheck[] {
  return [
    check(
      "headline",
      "Otsikon pituus",
      copy.headline.length <= limits.headline,
      `${copy.headline.length} / ${limits.headline} merkkiä`
    ),
    check(
      "body",
      "Leipätekstin pituus",
      copy.body.length <= limits.body,
      `${copy.body.length} / ${limits.body} merkkiä`
    ),
    check(
      "cta",
      "CTA:n pituus",
      copy.cta.length <= limits.cta,
      `${copy.cta.length} / ${limits.cta} merkkiä`
    ),
    charsetCheck(copy),
  ];
}

/** Kyrilliset homoglyyfit ("lempipiццasi") näyttävät oikealta vilkaisulla,
 *  mutta ovat rikkinäistä suomea. Generointi suodattaa ne jo, mutta
 *  tarkistus tekee lipsahduksen näkyväksi käyttäjälle. */
const NON_LATIN = /[Ѐ-ӿͰ-Ͽ]/g;

function charsetCheck(copy: CopyVariant): ValidationCheck {
  const all = `${copy.headline} ${copy.body} ${copy.cta}`;
  const found = [...new Set(all.match(NON_LATIN) ?? [])];
  return check(
    "charset",
    "Merkistö",
    found.length === 0,
    found.length
      ? `Vieraita merkkejä: ${found.join(" ")}`
      : "Vain latinalaisia merkkejä"
  );
}

/** Leikkaa copyn speksin rajoihin ennen renderöintiä. */
export function fitCopyToLimits(
  copy: CopyVariant,
  limits: { headline: number; body: number; cta: number }
): CopyVariant {
  return {
    id: copy.id,
    headline: truncate(copy.headline, limits.headline),
    body: truncate(copy.body, limits.body),
    cta: truncate(copy.cta, limits.cta),
  };
}

function truncate(s: string, max: number): string {
  const t = (s ?? "").trim();
  if (t.length <= max) return t;
  // Katkaise sanarajalta, ei keskeltä sanaa.
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + "…";
}
