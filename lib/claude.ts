import Anthropic from "@anthropic-ai/sdk";
import type { ScrapeResult } from "./scrape";
import type { BrandCard, CopyVariant, GoalId, TextLimits } from "./types";
import { getGoal } from "./specs";
import type { BusinessSignals } from "./onboarding/types";

const DEFAULT_MODEL = "claude-sonnet-4-6";

/** Kuinka monta kuvaehdokasta näytetään mallille. Jokainen kuva maksaa
 *  tokeneita, joten katselmoidaan kärki eikä koko sivun kuvastoa. */
const MAX_VISION_IMAGES = 6;

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function client(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function model(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * Kutsu Claudea ja palauta jäsennelty JSON. Jos malli ei tue effort-parametria,
 * yritetään uudelleen ilman sitä, jotta mallin voi vaihtaa vapaasti.
 */
type UserContent = string | Anthropic.ContentBlockParam[];

async function askJson<T>(
  system: string,
  user: UserContent,
  maxTokens: number,
  effort: "low" | "medium" | "high"
): Promise<T> {
  const c = client();
  const base = {
    model: model(),
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user" as const, content: user }],
  };

  let text: string;
  try {
    const res = await c.messages.create({
      ...base,
      output_config: { effort },
    });
    text = firstText(res);
  } catch (e) {
    if (!isBadRequest(e)) throw e;
    // Malli ei tue effortia — aja ilman.
    const res = await c.messages.create(base);
    text = firstText(res);
  }

  return parseJson<T>(text);
}

function isBadRequest(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    (e as { status?: number }).status === 400
  );
}

function firstText(res: Anthropic.Message): string {
  for (const block of res.content) {
    if (block.type === "text") return block.text;
  }
  throw new Error("Claude ei palauttanut tekstisisältöä.");
}

/** Kestävä JSON-jäsennys: sietää koodiaidat ja selittävän tekstin ympärillä. */
function parseJson<T>(raw: string): T {
  let s = raw.trim();

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();

  try {
    return JSON.parse(s) as T;
  } catch {
    // Etsi ensimmäinen tasapainoinen objekti tai taulukko.
  }

  const start = s.search(/[[{]/);
  if (start === -1) throw new Error("Claude ei palauttanut JSONia.");
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        return JSON.parse(s.slice(start, i + 1)) as T;
      }
    }
  }
  throw new Error("Claude palautti vaillinaisen JSONin.");
}

// ---------------------------------------------------------------- brändi

const BRAND_SYSTEM = `Olet brändianalyytikko, joka tiivistää suomalaisen pk-yrityksen verkkosivun mainoskäyttöön sopivaksi brändikortiksi.

Vastaa VAIN JSONilla, ilman selityksiä tai koodiaitoja. Käytä täsmälleen tätä rakennetta:
{
  "companyName": string,
  "description": string,
  "tone": string,
  "toimiala": string,
  "logoUrl": string | null,
  "colors": { "primary": "#rrggbb", "secondary": "#rrggbb", "accent": "#rrggbb", "background": "#rrggbb", "text": "#rrggbb" },
  "fonts": { "heading": string, "body": string },
  "imageUrls": string[]
}

Ohjeet:
- companyName: yrityksen nimi sellaisena kuin se esiintyy sivulla. Ei slogania, ei domainia.
- description: 1–2 lausetta suomeksi siitä, mitä yritys tekee ja kenelle. Konkreettinen, ei markkinointikliseitä.
- tone: äänensävy 2–4 sanalla, esim. "Lämmin ja asiantunteva".
- toimiala: yksi tai kaksi sanaa, esim. "Parturi-kampaamo".
- logoUrl: valitse ehdokkaista todennäköisin logo, tai null jos yksikään ei vakuuta. Suosi kuvaa, jonka polussa tai altissa lukee logo, ennen faviconia. Mainos rakentuu vaalealle pohjalle, joten vältä negaversioita: jos tiedostonimessä on white, valko, nega, invert tai light, valitse jokin muu ehdokas silloin kun sellainen on tarjolla.
- colors: valitse väriehdokkaista aidot brändivärit. primary on tunnistettavin brändiväri. background on vaalea tai tumma pohja, jolle mainos rakentuu. text erottuu backgroundista selvästi (kontrasti vähintään 4.5:1). accent käytetään CTA-napissa, ja sen on erotuttava backgroundista. Jos ehdokkaista ei löydy järkevää väriä, valitse toimialaan sopiva neutraali väri.
- fonts: valitse fonttiehdokkaista. Jos ei löydy, ehdota toimialaan sopivat.
- imageUrls: valitse 2–4 mainoskäyttöön sopivaa kuvaa. Kuvat on liitetty mukaan, joten katso ne. Palauta URLit täsmälleen sellaisina kuin ne annettiin, ja käytä numerointia kuvien tunnistamiseen.

  Hylkää ehdottomasti kuva, jossa on:
  - tekstiä, otsikoita, iskulauseita tai verkko-osoitteita kuvan päällä
  - CTA-painike tai muu toimintakehotus
  - logo hallitsevana elementtinä
  Tällainen kuva on jo valmis mainos. Sitä ei voi käyttää uuden mainoksen kuvana: siinä on oma otsikkonsa ja oma toimintakehotuksensa, jotka kilpailevat uuden mainoksen kanssa, ja rajaus katkaisee tekstin kesken.

  Hylkää myös kollaasit, ruutukaappaukset, kaaviot, taulukot ja tyhjät kuvituskuviot.

  Valitse valokuvia: ihmisiä, tuotteita, tiloja tai työn tekemistä. Jos yksikään kuva ei kelpaa, palauta tyhjä lista — mainos rakentuu silloin typografialla ja väreillä, mikä on parempi kuin huono kuva.`;

interface BrandResponse {
  companyName: string;
  description: string;
  tone: string;
  toimiala: string;
  logoUrl: string | null;
  colors: BrandCard["colors"];
  fonts: BrandCard["fonts"];
  imageUrls: string[];
}

export async function analyzeBrand(s: ScrapeResult): Promise<BrandCard> {
  if (!hasApiKey()) return mockBrand(s);

  const user = `Verkkosivu: ${s.finalUrl}

<title>${s.title}</title>
<og:site_name>${s.ogSiteName}</og:site_name>
<og:title>${s.ogTitle}</og:title>
<meta-description>${s.metaDescription}</meta-description>
<og:description>${s.ogDescription}</og:description>

<logo-ehdokkaat>
${s.logoCandidates.map((u, i) => `${i + 1}. ${u}`).join("\n") || "(ei löytynyt)"}
</logo-ehdokkaat>

<kuva-ehdokkaat>
${
  s.imageCandidates
    .map((im, i) => `${i + 1}. ${im.url}${im.alt ? ` — alt: ${im.alt}` : ""}`)
    .join("\n") || "(ei löytynyt)"
}
</kuva-ehdokkaat>

<vari-ehdokkaat esiintymismaaran-mukaan>
${
  s.colorCandidates.map((c) => `${c.color} (${c.count})`).join(", ") ||
  "(ei löytynyt)"
}
</vari-ehdokkaat>

<fontti-ehdokkaat>
${s.fontCandidates.join(", ") || "(ei löytynyt)"}
</fontti-ehdokkaat>

<sivun-teksti>
${s.text.slice(0, 5000)}
</sivun-teksti>`;

  // Liitä kuvaehdokkaat mukaan kuvina, jotta malli näkee ne. Pelkän
  // URLin ja alt-tekstin perusteella valmis mainos menee helposti läpi.
  const visionContent: Anthropic.ContentBlockParam[] = [];
  const shown = s.imageCandidates.slice(0, MAX_VISION_IMAGES);
  for (const [i, img] of shown.entries()) {
    visionContent.push({ type: "text", text: `Kuva ${i + 1}: ${img.url}` });
    visionContent.push({
      type: "image",
      source: { type: "url", url: img.url },
    });
  }
  visionContent.push({ type: "text", text: user });

  try {
    let r: BrandResponse;
    try {
      r = await askJson<BrandResponse>(
        BRAND_SYSTEM,
        shown.length ? visionContent : user,
        2000,
        "low"
      );
    } catch (visionError) {
      // Kuvat voivat olla mallin ulottumattomissa (kirjautumisen takana,
      // liian isoja, tuntematon muoto). Aja tekstipohjainen analyysi.
      if (!shown.length) throw visionError;
      r = await askJson<BrandResponse>(BRAND_SYSTEM, user, 2000, "low");
    }

    const known = new Map(s.imageCandidates.map((i) => [i.url, i.alt]));
    const images = (r.imageUrls ?? [])
      .filter((u) => typeof u === "string" && u.startsWith("http"))
      .slice(0, 4)
      .map((url) => ({ url, alt: known.get(url) ?? "", enabled: true }));

    return {
      sourceUrl: s.finalUrl,
      companyName: clean(r.companyName) || fallbackName(s),
      description: clean(r.description) || s.metaDescription || "",
      tone: clean(r.tone) || "Selkeä ja asiallinen",
      toimiala: clean(r.toimiala) || "",
      logoUrl: r.logoUrl && r.logoUrl.startsWith("http") ? r.logoUrl : null,
      colors: sanitizeColors(r.colors, s),
      fonts: {
        heading: clean(r.fonts?.heading) || "Helvetica Neue",
        body: clean(r.fonts?.body) || "Helvetica Neue",
      },
      // Tyhjä lista on mallin tietoinen valinta, kun yksikään kuva ei kelpaa
      // (valmiita mainoksia, ruutukaappauksia). Sitä ei ohiteta raakalistalla
      // — typografialla rakennettu mainos on parempi kuin väärä kuva.
      images,
      warnings: s.warnings,
    };
  } catch (e) {
    const brand = mockBrand(s);
    brand.warnings = [
      ...(brand.warnings ?? []),
      `Claude-analyysi epäonnistui (${
        e instanceof Error ? e.message : "tuntematon virhe"
      }). Käytössä on sivulta poimittu arvio.`,
    ];
    return brand;
  }
}

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function fallbackName(s: ScrapeResult): string {
  if (s.ogSiteName) return s.ogSiteName;
  const t = s.ogTitle || s.title;
  if (t) return t.split(/[|–—-]/)[0].trim().slice(0, 60);
  try {
    // Verkkotunnuksesta nimeksi: www ja päätteet pois, alkukirjain isoksi.
    const host = new URL(s.finalUrl).hostname
      .replace(/^www\./, "")
      .replace(/\.(fi|com|net|org|eu|se|io|co\.uk)$/i, "")
      .split(".")[0];
    return host ? host.charAt(0).toUpperCase() + host.slice(1) : "Yritys";
  } catch {
    return "Yritys";
  }
}

const HEX = /^#[0-9a-f]{6}$/i;

function sanitizeColors(
  c: Partial<BrandCard["colors"]> | undefined,
  s: ScrapeResult
): BrandCard["colors"] {
  const guess = guessPalette(s);
  const pick = (v: unknown, fb: string) =>
    typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : fb;

  return {
    primary: pick(c?.primary, guess.primary),
    secondary: pick(c?.secondary, guess.secondary),
    accent: pick(c?.accent, guess.accent),
    background: pick(c?.background, guess.background),
    text: pick(c?.text, guess.text),
  };
}

// ------------------------------------------------- heuristinen varapaletti

function rgb(hex: string): [number, number, number] {
  const s = hex.replace("#", "");
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

function lum(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function sat(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** Arvaa paletti pelkistä väriehdokkaista, kun Claudea ei ole käytettävissä. */
function guessPalette(s: ScrapeResult): BrandCard["colors"] {
  const cands = s.colorCandidates.map((c) => c.color).filter((c) => HEX.test(c));

  // Brändiväri: kylläisin, ei liian vaalea eikä liian tumma, painotettuna yleisyydellä.
  const scored = cands
    .map((c, i) => ({
      c,
      score:
        sat(c) * 2 +
        (lum(c) > 0.06 && lum(c) < 0.72 ? 0.8 : 0) -
        i * 0.02,
    }))
    .filter((x) => sat(x.c) > 0.25)
    .sort((a, b) => b.score - a.score);

  const primary = scored[0]?.c ?? "#1f4fd8";
  const secondary = scored[1]?.c ?? primary;
  const accent = scored.find((x) => x.c !== primary)?.c ?? primary;

  const lights = cands.filter((c) => lum(c) > 0.82);
  const darks = cands.filter((c) => lum(c) < 0.12);

  return {
    primary,
    secondary,
    accent,
    background: lights[0] ?? "#ffffff",
    text: darks[0] ?? "#14181f",
  };
}

function mockBrand(s: ScrapeResult): BrandCard {
  // Puuttuvasta API-avaimesta ei varoiteta täällä — käyttöliittymä näyttää
  // siitä oman pysyvän huomautuksensa, eikä sitä kannata kertoa kahdesti.
  const warnings = [...s.warnings];
  return {
    sourceUrl: s.finalUrl,
    companyName: fallbackName(s),
    description:
      s.metaDescription ||
      s.ogDescription ||
      s.text.slice(0, 180).trim() ||
      "Kuvaus puuttuu — täydennä käsin.",
    tone: "Selkeä ja asiallinen",
    toimiala: "",
    logoUrl: s.logoCandidates[0] ?? null,
    colors: guessPalette(s),
    fonts: {
      heading: s.fontCandidates[0] ?? "Helvetica Neue",
      body: s.fontCandidates[1] ?? s.fontCandidates[0] ?? "Helvetica Neue",
    },
    images: s.imageCandidates.slice(0, 4).map((i) => ({ ...i, enabled: true })),
    isMock: true,
    warnings,
  };
}

// ------------------------------------------------------------------ copy

const COPY_SYSTEM = `Olet suomalainen mainostoimittaja. Kirjoitat display-mainosten tekstit pk-yrityksille.

Vastaa VAIN JSONilla, ilman selityksiä tai koodiaitoja:
{ "variants": [ { "headline": string, "body": string, "cta": string }, ... ] }

Kirjoita täsmälleen 3 variaatiota, jotka eroavat toisistaan kulmaltaan — älä kirjoita samaa asiaa kolmella tavalla.

Ohjeet:
- Kirjoita moitteetonta suomea. Yhdyssanat oikein, ei anglismeja, ei turhia isoja alkukirjaimia.
- Otsikko myy hyödyn, ei ominaisuutta. Ei huutomerkkejä, ei kaikkia versaaleja.
- Leipäteksti tukee otsikkoa yhdellä konkreettisella asialla.
- CTA on lyhyt toimintakehotus, esim. "Varaa aika" tai "Katso valikoima". Ei pistettä lopussa.
- Älä keksi hintoja, lukuja, takuita tai väitteitä, joita lähdemateriaalissa ei ole.
- Pysy merkkirajoissa. Ne ovat ehdottomia.`;

interface CopyResponse {
  variants: { headline: string; body: string; cta: string }[];
}

export async function generateCopy(
  brand: BrandCard,
  goalId: GoalId,
  limits: TextLimits
): Promise<CopyVariant[]> {
  if (!hasApiKey()) return mockCopy(brand, goalId, limits);

  const goal = getGoal(goalId);
  const user = `Yritys: ${brand.companyName}
Toimiala: ${brand.toimiala || "ei tiedossa"}
Mitä yritys tekee: ${brand.description}
Äänensävy: ${brand.tone}

Kampanjatavoite: ${goal.name} — ${goal.description}
CTA-tyyli: ${goal.ctaHint}

Merkkirajat (ehdottomat):
- headline: enintään ${limits.headline} merkkiä
- body: enintään ${limits.body} merkkiä
- cta: enintään ${limits.cta} merkkiä

Kirjoita 3 variaatiota.`;

  const askVariants = async (): Promise<CopyVariant[]> => {
    const r = await askJson<CopyResponse>(COPY_SYSTEM, user, 1500, "medium");
    return (r.variants ?? [])
      .filter((v) => v && typeof v.headline === "string")
      .map((v, i) => ({
        id: `v${i + 1}`,
        headline: clean(v.headline),
        body: clean(v.body),
        cta: clean(v.cta) || "Lue lisää",
      }));
  };

  try {
    let usable = (await askVariants()).filter(isLatinOnly);

    // Malli sekoittaa satunnaisesti kyrillisiä homoglyyfejä latinalaisten
    // sekaan ("lempipiццasi"). Ne näyttävät oikealta vilkaisulla mutta ovat
    // rikkinäistä suomea valmiissa mainoksessa, joten pyydetään uudet.
    if (usable.length < 3) {
      const retry = (await askVariants()).filter(isLatinOnly);
      usable = [...usable, ...retry];
    }

    if (usable.length === 0) return mockCopy(brand, goalId, limits);
    while (usable.length < 3) usable.push({ ...usable[0] });

    return usable.slice(0, 3).map((v, i) => ({ ...v, id: `v${i + 1}` }));
  } catch {
    return mockCopy(brand, goalId, limits);
  }
}

/** Kyrilliset ja kreikkalaiset merkit suomenkielisessä mainostekstissä ovat
 *  aina mallin lipsahdus, eivät tarkoituksellisia. */
const NON_LATIN = /[Ѐ-ӿͰ-Ͽ]/;

export function isLatinOnly(v: CopyVariant): boolean {
  return !NON_LATIN.test(`${v.headline} ${v.body} ${v.cta}`);
}

function mockCopy(
  brand: BrandCard,
  goalId: GoalId,
  limits: TextLimits
): CopyVariant[] {
  const name = brand.companyName;
  const ala = brand.toimiala || "palvelumme";

  const byGoal: Record<GoalId, CopyVariant[]> = {
    tunnettuus: [
      {
        id: "v1",
        headline: `${name} — lähelläsi`,
        body: `Tutustu siihen, mitä teemme ja miksi asiakkaamme palaavat.`,
        cta: "Tutustu meihin",
      },
      {
        id: "v2",
        headline: `Tunnetko jo ${name}?`,
        body: `${ala} ammattitaidolla ja ilman kiirettä.`,
        cta: "Katso lisää",
      },
      {
        id: "v3",
        headline: `Tässä olemme`,
        body: `${name} palvelee arkena ja viikonloppuisin.`,
        cta: "Käy sivuillamme",
      },
    ],
    tarjous: [
      {
        id: "v1",
        headline: `Nyt kannattaa tulla käymään`,
        body: `${name} tarjoaa etua uusille asiakkaille. Kysy lisää.`,
        cta: "Katso tarjous",
      },
      {
        id: "v2",
        headline: `Etu voimassa rajoitetun ajan`,
        body: `Varaa paikkasi ennen kuin tarjous päättyy.`,
        cta: "Varaa nyt",
      },
      {
        id: "v3",
        headline: `Säästä ensimmäisellä käynnillä`,
        body: `Mainitse mainos, niin hoidamme loput.`,
        cta: "Lunasta etu",
      },
    ],
    rekrytointi: [
      {
        id: "v1",
        headline: `Tule töihin meille`,
        body: `${name} etsii tekijää joukkoonsa. Katso avoimet paikat.`,
        cta: "Hae paikkaa",
      },
      {
        id: "v2",
        headline: `Etsimme uutta osaajaa`,
        body: `Hyvä porukka, selkeät työvuorot ja reilu palkka.`,
        cta: "Lue lisää",
      },
      {
        id: "v3",
        headline: `Olisitko sinä seuraava?`,
        body: `Kerro itsestäsi, niin jutellaan lisää.`,
        cta: "Ota yhteyttä",
      },
    ],
  };

  return byGoal[goalId].map((v) => ({
    id: v.id,
    headline: v.headline.slice(0, limits.headline),
    body: v.body.slice(0, limits.body),
    cta: v.cta.slice(0, limits.cta),
  }));
}

// ------------------------------------------- onboarding: business signals

/**
 * Onboarding microsite (PRD §7 step 1): read business intelligence off the
 * scraped site so the recommendation can be sharpened. Returns null whenever
 * the answer would be guesswork — no key, sparse page, or a bad response —
 * and the flow falls back to rule-based logic without telling the user.
 */

/** Below this much visible text the page is a splash or login wall. */
const MIN_SIGNAL_TEXT = 200;

const SIGNALS_SYSTEM = `You read a scraped Finnish business website and extract structured facts about the business for an advertising recommendation engine.

Return ONLY JSON:
{
  "businessName": string,
  "industry": string,
  "category": "real-estate" | "b2b-professional" | "ecommerce" | "local-services" | "other",
  "summary": string,
  "productsOrServices": string,
  "geographicSignal": string,
  "ecommerce": boolean,
  "national": boolean,
  "audienceSignals": string[],
  "confidence": number
}

Rules:
- Write every string in English, even though the site is likely Finnish.
- "summary" is one plain sentence a business owner would recognise as their own.
- "geographicSignal" is the city or region the site says it serves, or "" if the site does not say.
- "national" is true only if the site claims to serve customers across Finland.
- "ecommerce" is true only if you see a cart, a shop, or product pages with prices.
- "audienceSignals" are short phrases the site uses about who it serves, e.g. ["families", "professionals"]. Empty array if none.
- "confidence" is 0 to 1: how sure you are the above is right. Score low when the page is thin, generic, or mostly navigation.
- Never invent a business name, a location, or a claim that is not on the page.`;

export async function extractSignals(
  s: ScrapeResult
): Promise<BusinessSignals | null> {
  if (!hasApiKey()) return null;
  if ((s.text?.trim().length ?? 0) < MIN_SIGNAL_TEXT) return null;

  const user = `Website: ${s.finalUrl}

<title>${s.title}</title>
<og-site-name>${s.ogSiteName}</og-site-name>
<meta-description>${s.metaDescription}</meta-description>
<og-description>${s.ogDescription}</og-description>

<page-text>
${s.text.slice(0, 6000)}
</page-text>`;

  try {
    const r = await askJson<Partial<BusinessSignals>>(
      SIGNALS_SYSTEM,
      user,
      1200,
      "low"
    );
    return normalizeSignals(r);
  } catch {
    return null;
  }
}

const CATEGORIES = new Set([
  "real-estate",
  "b2b-professional",
  "ecommerce",
  "local-services",
  "other",
]);

function normalizeSignals(r: Partial<BusinessSignals>): BusinessSignals | null {
  const businessName = clean(r.businessName);
  if (!businessName) return null;

  const category = CATEGORIES.has(String(r.category))
    ? (r.category as BusinessSignals["category"])
    : "other";

  const confidence = Number(r.confidence);

  return {
    businessName,
    industry: clean(r.industry),
    category,
    summary: clean(r.summary),
    productsOrServices: clean(r.productsOrServices),
    geographicSignal: clean(r.geographicSignal),
    ecommerce: Boolean(r.ecommerce),
    national: Boolean(r.national),
    audienceSignals: Array.isArray(r.audienceSignals)
      ? r.audienceSignals.map(clean).filter(Boolean).slice(0, 6)
      : [],
    confidence: Number.isFinite(confidence)
      ? Math.min(1, Math.max(0, confidence))
      : 0,
  };
}
