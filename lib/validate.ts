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
  /** Whether the AI Act label is visible in the rendered asset. */
  hasAiActLabel: boolean;
  /** The asset's actual colours, for the contrast check. */
  contrast?: ContrastInput;
}

export interface ContrastInput {
  ground: string;
  text: string;
  ctaBg: string;
  ctaText: string;
}

/** WCAG AA for small text. A banner headline is large but the body copy is
 *  not, and the same floor keeps the ad readable at small sizes too. */
const MIN_TEXT_CONTRAST = 4.5;
/** The button may separate from the ground by less than text does, but it
 *  must separate — otherwise the CTA melts into the surface. */
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

/** The baseline for banner advertising: the text reads and the CTA stands out. */
function contrastChecks(c: ContrastInput): ValidationCheck[] {
  const textRatio = ratio(c.text, c.ground);
  const ctaRatio = ratio(c.ctaBg, c.ground);
  const ctaTextRatio = ratio(c.ctaText, c.ctaBg);

  return [
    check(
      "contrast-text",
      "Text contrast",
      textRatio >= MIN_TEXT_CONTRAST,
      `${textRatio.toFixed(1)}:1 (required ${MIN_TEXT_CONTRAST}:1)`
    ),
    check(
      "contrast-cta",
      "CTA stands out from the ground",
      ctaRatio >= MIN_CTA_SEPARATION && ctaTextRatio >= MIN_TEXT_CONTRAST,
      `button ${ctaRatio.toFixed(1)}:1 · text on button ${ctaTextRatio.toFixed(
        1
      )}:1`
    ),
  ];
}

/**
 * Validate a static display asset against the spec library.
 * Plain Node code — no AI, no network calls.
 */
export function validateStatic(input: StaticInput): ValidationResult {
  const fmt = getFormat(input.formatId);
  const checks: ValidationCheck[] = [];

  checks.push(
    check(
      "dimensions",
      "Dimensions",
      input.width === fmt.width && input.height === fmt.height,
      `${input.width}×${input.height} px (required ${fmt.width}×${fmt.height})`
    )
  );

  const maxBytes = fmt.maxFileSizeKb * KB;
  checks.push(
    check(
      "filesize",
      "File size",
      input.fileSizeBytes <= maxBytes,
      `${Math.round(input.fileSizeBytes / KB)} kB / max ${fmt.maxFileSizeKb} kB`
    )
  );

  checks.push(
    check(
      "filetype",
      "File type",
      fmt.acceptedTypes.includes(input.fileType),
      `${input.fileType.toUpperCase()} (allowed: ${fmt.acceptedTypes
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
        "AI Act label",
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
  /** The size of the zipped package, or of the HTML, in bytes. */
  fileSizeBytes: number;
  animationSeconds: number;
  copy: CopyVariant;
  hasAiActLabel: boolean;
  html: string;
}

/** Validate an animated HTML5 asset. */
export function validateHtml5(input: Html5Input): ValidationResult {
  const h5 = getHtml5Format(input.html5FormatId);
  const base = getFormat(h5.baseFormat);
  const checks: ValidationCheck[] = [];

  checks.push(
    check(
      "dimensions",
      "Dimensions",
      input.width === base.width && input.height === base.height,
      `${input.width}×${input.height} px (required ${base.width}×${base.height})`
    )
  );

  const maxBytes = h5.maxFileSizeKb * KB;
  checks.push(
    check(
      "filesize",
      "Initial load size",
      input.fileSizeBytes <= maxBytes,
      `${Math.round(input.fileSizeBytes / KB)} kB / max ${h5.maxFileSizeKb} kB`
    )
  );

  checks.push(
    check(
      "animation",
      "Animation length",
      input.animationSeconds <= h5.maxAnimationSeconds,
      `${input.animationSeconds} s / max ${h5.maxAnimationSeconds} s`
    )
  );

  // Alma requires every external resource to load over HTTPS.
  const insecure = input.html.match(/(?:src|href)\s*=\s*["']http:\/\/[^"']+/gi);
  checks.push(
    check(
      "https",
      "HTTPS resources",
      !insecure,
      insecure
        ? `${insecure.length} http resources`
        : "No http resources"
    )
  );

  // Alma's guidelines forbid jQuery outright, because of its file weight.
  checks.push(
    check(
      "nojquery",
      "No jQuery",
      !/jquery/i.test(input.html),
      "Alma: avoid jQuery because of file weight"
    )
  );

  checks.push(...textChecks(input.copy, base.textLimits));

  if (specs.global.requireAiActLabel) {
    checks.push(
      check(
        "aiact",
        "AI Act label",
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
      "Headline length",
      copy.headline.length <= limits.headline,
      `${copy.headline.length} / ${limits.headline} characters`
    ),
    check(
      "body",
      "Body length",
      copy.body.length <= limits.body,
      `${copy.body.length} / ${limits.body} characters`
    ),
    check(
      "cta",
      "CTA length",
      copy.cta.length <= limits.cta,
      `${copy.cta.length} / ${limits.cta} characters`
    ),
    charsetCheck(copy),
  ];
}

/** Cyrillic homoglyphs ("piцца") look right at a glance but are broken text.
 *  Generation already filters them out; this check makes any slip visible to
 *  the user. */
const NON_LATIN = /[Ѐ-ӿͰ-Ͽ]/g;

function charsetCheck(copy: CopyVariant): ValidationCheck {
  const all = `${copy.headline} ${copy.body} ${copy.cta}`;
  const found = [...new Set(all.match(NON_LATIN) ?? [])];
  return check(
    "charset",
    "Character set",
    found.length === 0,
    found.length
      ? `Foreign characters: ${found.join(" ")}`
      : "Latin characters only"
  );
}

/** Trim the copy to the spec limits before rendering. */
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
  // Cut at a word boundary, not mid-word.
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + "…";
}
