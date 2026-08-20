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
 *  sen pitää erottua, tai CTA sulautuu pintaan. */
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
      "Teksti erottuu taustasta",
      textRatio >= MIN_TEXT_CONTRAST,
      `kontrasti ${textRatio.toFixed(1)}:1, vaaditaan ${MIN_TEXT_CONTRAST}:1`
    ),
    check(
      "contrast-cta",
      "Painike erottuu taustasta",
      ctaRatio >= MIN_CTA_SEPARATION && ctaTextRatio >= MIN_TEXT_CONTRAST,
      `painike ${ctaRatio.toFixed(
        1
      )}:1, teksti painikkeen päällä ${ctaTextRatio.toFixed(1)}:1`
    ),
  ];
}

/**
 * Validoi staattisen display-aineiston speksikirjastoa vasten.
 * Puhdasta Node-koodia: ei AI:ta, ei verkkokutsuja.
 */
export function validateStatic(input: StaticInput): ValidationResult {
  const fmt = getFormat(input.formatId);
  const checks: ValidationCheck[] = [];

  checks.push(
    check(
      "dimensions",
      "Oikea koko Alman mainospaikkaan",
      input.width === fmt.width && input.height === fmt.height,
      `${input.width}×${input.height} px, vaaditaan ${fmt.width}×${fmt.height}`
    )
  );

  const maxBytes = fmt.maxFileSizeKb * KB;
  checks.push(
    check(
      "filesize",
      "Tiedosto tarpeeksi kevyt",
      input.fileSizeBytes <= maxBytes,
      `${Math.round(input.fileSizeBytes / KB)} kt, enintään ${
        fmt.maxFileSizeKb
      } kt`
    )
  );

  checks.push(
    check(
      "filetype",
      "Alman hyväksymä tiedostomuoto",
      fmt.acceptedTypes.includes(input.fileType),
      `${input.fileType.toUpperCase()}, hyväksytään ${fmt.acceptedTypes
        .filter((t) => specs.global.acceptedStaticFormats.includes(t))
        .join(", ")
        .toUpperCase()}`
    )
  );

  checks.push(...textChecks(input.copy, fmt.textLimits));
  if (input.contrast) checks.push(...contrastChecks(input.contrast));

  if (specs.global.requireAiActLabel) {
    checks.push(
      check(
        "aiact",
        "Tekoälymerkintä mainoksessa",
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
      "Oikea koko Alman mainospaikkaan",
      input.width === base.width && input.height === base.height,
      `${input.width}×${input.height} px, vaaditaan ${base.width}×${base.height}`
    )
  );

  const maxBytes = h5.maxFileSizeKb * KB;
  checks.push(
    check(
      "filesize",
      "Tiedosto tarpeeksi kevyt",
      input.fileSizeBytes <= maxBytes,
      `${Math.round(input.fileSizeBytes / KB)} kt, enintään ${
        h5.maxFileSizeKb
      } kt`
    )
  );

  checks.push(
    check(
      "animation",
      "Liike tarpeeksi lyhyt",
      input.animationSeconds <= h5.maxAnimationSeconds,
      `${input.animationSeconds} s, enintään ${h5.maxAnimationSeconds} s`
    )
  );

  // Alma vaatii, että kaikki ulkoiset resurssit ladataan HTTPS:n yli.
  const insecure = input.html.match(/(?:src|href)\s*=\s*["']http:\/\/[^"']+/gi);
  checks.push(
    check(
      "https",
      "Turvallinen yhteys",
      !insecure,
      insecure
        ? `${insecure.length} suojaamatonta latausta`
        : "Kaikki ladataan suojatusti"
    )
  );

  // jQuery on Alman ohjeissa erikseen kielletty tiedostopainon vuoksi.
  checks.push(
    check(
      "nojquery",
      "Tekniikka Alman ohjeiden mukainen",
      !/jquery/i.test(input.html),
      "Ei raskaita ulkoisia kirjastoja"
    )
  );

  checks.push(...textChecks(input.copy, base.textLimits));

  if (specs.global.requireAiActLabel) {
    checks.push(
      check(
        "aiact",
        "Tekoälymerkintä mainoksessa",
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
      "Otsikko mahtuu",
      copy.headline.length <= limits.headline,
      `${copy.headline.length} / ${limits.headline} merkkiä`
    ),
    check(
      "body",
      "Leipäteksti mahtuu",
      copy.body.length <= limits.body,
      `${copy.body.length} / ${limits.body} merkkiä`
    ),
    check(
      "cta",
      "Painikkeen teksti mahtuu",
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
    "Teksti on oikeaa suomea",
    found.length === 0,
    found.length
      ? `Tekstissä on vieraita kirjaimia: ${found.join(
          " "
        )}. Korjaa ne tai kirjoita tekstit uudelleen.`
      : "Ei vieraita kirjaimia"
  );
}

/**
 * Poistaa pitkät viivat (U+2014 ja U+2013) mainostekstistä. Malli kirjoittaa
 * niitä englannin tapaan, mutta suomalaisessa mainoksessa ne näyttävät
 * vierailta, katkaisevat lukemisen ja kuluttavat merkkirajaa.
 *
 * Ajetaan renderöintipolussa fitCopyToLimits-funktiossa, joten yksikään
 * valmis aineisto ei voi sisältää pitkää viivaa riippumatta siitä, tuliko
 * teksti mallilta, varapohjista vai käyttäjän kynästä.
 */
export function stripLongDashes(s: string): string {
  return (s ?? "")
    // Lukuväli säilyy välinä, mutta yhdysmerkillä: "10 - 15" muuttuu "10-15".
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, "$1-$2")
    .replace(/^\s*[\u2013\u2014]\s*/, "")
    .replace(/\s*[\u2013\u2014]\s*$/, "")
    // Muualla viiva korvautuu pilkulla, joka on suomen luonteva vastine.
    .replace(/\s*[\u2013\u2014]\s*/g, ", ")
    .replace(/\s+([,.:;!?])/g, "$1")
    .replace(/,\s*,/g, ",")
    .trim();
}

/** Leikkaa copyn speksin rajoihin ennen renderöintiä. */
export function fitCopyToLimits(
  copy: CopyVariant,
  limits: { headline: number; body: number; cta: number }
): CopyVariant {
  return {
    id: copy.id,
    headline: truncate(stripLongDashes(copy.headline), limits.headline),
    body: truncate(stripLongDashes(copy.body), limits.body),
    cta: truncate(stripLongDashes(copy.cta), limits.cta),
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
