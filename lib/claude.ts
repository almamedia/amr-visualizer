import Anthropic from "@anthropic-ai/sdk";
import type { ScrapeResult } from "./scrape";
import type { BrandCard, CopyVariant, GoalId, TextLimits } from "./types";
import { getGoal } from "./specs";

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
- colors: valitse VAIN annetuista väriehdokkaista. Älä keksi uusia hex-arvoja: ehdokaslista on poimittu sivun omista tyyleistä, ja listan ulkopuolinen väri ei ole yrityksen väri, vaikka se tuntuisi sopivalta.
  Tunnistettavin brändiväri on lähes aina kylläinen ja keskisävyinen. Valkoinen, musta ja harmaat eivät ole brändivärejä, vaikka ne esiintyisivät sivulla ylivoimaisesti useimmin — ne ovat pohja ja teksti.
  Vaalea pastelli tai lähes valkoinen sävy ei ole brändiväri silloin kun listalla on kylläisempiä vaihtoehtoja.
  Jos listan kylläiset värit ovat saman sävyn eri kirkkauksia (esim. useita vihreitä), se sävy ON yrityksen brändiväri. Valitse siitä keskisävyinen versio primaryksi ja selvästi tummempi accentiksi.
  Roolit kertovat, mihin väri päätyy valmiissa mainoksessa:
  - primary: tunnistettavin brändiväri. Näkyy yrityksen nimen värinä, ja pohjavärinä silloin kun mainos tehdään ilman kuvaa.
  - accent: painikkeen väri. Sen on erotuttava pohjasta ja kannettava luettavaa tekstiä.
  - secondary: toinen brändiväri. Käytetään pohjan varavärinä.
  - background: vaalea pohja, jolle kuvallinen mainos rakentuu. Yleensä valkoinen tai lähes valkoinen.
  - text: otsikon ja leipätekstin väri. Kontrasti backgroundia vasten vähintään 4.5:1.
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
${describeCandidates(s.colorCandidates) || "(ei löytynyt)"}
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

/**
 * Suurin etäisyys, jolla mallin palauttama väri katsotaan samaksi kuin
 * sivulta löytynyt ehdokas. Ilman kiinnitystä pelkkä hex-syntaksin tarkistus
 * päästää läpi minkä tahansa värin: kotipizza.fi tuotti korostusväriksi
 * laivastonsinisen #001e54:n, jota ei ollut ehdokaslistalla lainkaan.
 */
const SNAP_MAX_DISTANCE = 42;

/** Euklidinen etäisyys RGB-avaruudessa. Vastaa kysymykseen "onko tämä sama
 *  väri kuin jokin ehdokas" — ei yritä mallintaa havaintoa tarkemmin. */
function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/** Lähin ehdokas, tai null jos yksikään ei ole riittävän lähellä. */
function snapToCandidates(hex: string, cands: string[]): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const c of cands) {
    const d = colorDistance(hex, c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best !== null && bestDist <= SNAP_MAX_DISTANCE ? best : null;
}

/**
 * Kuinka hyvin väri kelpaa tunnistettavaksi brändiväriksi. Kylläisyys painaa
 * eniten, keskisävyisyys tuo bonuksen, ja yleisyys sivulla ratkaisee tasapelit.
 * Sama funktio ohjaa sekä heuristista palettia että mallin valinnan
 * järkevyystarkistusta, jotta molemmat päätyvät samaan käsitykseen siitä,
 * mikä sivun väreistä on brändiväri.
 */
function brandScore(hex: string, rankIndex: number): number {
  const l = lum(hex);
  return sat(hex) * 2 + (l > 0.06 && l < 0.72 ? 0.8 : 0) - rankIndex * 0.02;
}

/** Mallin pääväri hyväksytään, jos se saavuttaa tämän osuuden parhaasta
 *  ehdokkaasta. Selvästi alle jäävä valinta on poimintavirhe. */
const PRIMARY_SCORE_FLOOR = 0.6;

function contrast(a: string, b: string): number {
  const la = lum(a);
  const lb = lum(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Luettavin tekstiväri annetun värin päälle. */
function readableOnColor(bg: string): string {
  return contrast("#ffffff", bg) >= contrast("#141821", bg)
    ? "#ffffff"
    : "#141821";
}

function sanitizeColors(
  c: Partial<BrandCard["colors"]> | undefined,
  s: ScrapeResult
): BrandCard["colors"] {
  const guess = guessPalette(s);
  const cands = s.colorCandidates
    .map((x) => x.color)
    .filter((x) => HEX.test(x));

  // Kiinnitä mallin väri sivulta löytyneisiin. Ilman ehdokkaita ei ole mihin
  // kiinnittää, joten silloin luotetaan malliin sellaisenaan.
  const pick = (v: unknown, fb: string): string => {
    if (typeof v !== "string" || !HEX.test(v.trim())) return fb;
    const hex = v.trim().toLowerCase();
    if (!cands.length) return hex;
    return snapToCandidates(hex, cands) ?? fb;
  };

  const picked = pick(c?.primary, guess.primary);

  // Malli valitsee toisinaan sivulta kyllä löytyvän mutta merkityksettömän
  // sävyn: kotipizza.fi:llä se otti kertaalleen esiintyneen vaalean keltaisen
  // ohi seitsemästä vihreästä, jotka ovat yrityksen todellinen väri.
  // Verrataan valinta parhaaseen ehdokkaaseen ja korjataan selvä ohitus.
  const bestScore = cands.length
    ? Math.max(...cands.map((x, i) => brandScore(x, i)))
    : 0;
  const rank = cands.indexOf(picked);
  const pickedScore = brandScore(picked, rank === -1 ? cands.length : rank);
  const primary =
    bestScore > 0 && pickedScore < bestScore * PRIMARY_SCORE_FLOOR
      ? guess.primary
      : picked;

  return {
    primary,
    secondary: pick(c?.secondary, guess.secondary),
    accent: pick(c?.accent, guess.accent),
    background: pick(c?.background, guess.background),
    text: pick(c?.text, guess.text),
  };
}

/**
 * Kuvaa väriehdokkaat mallille niin, että kylläisyys ja kirkkaus näkyvät.
 * Pelkkä hex ja esiintymismäärä johtaa harhaan: sivun yleisin väri on lähes
 * aina valkoinen, eikä esiintymismäärä kerro mikä väreistä on brändiväri.
 */
function describeCandidates(cands: { color: string; count: number }[]): string {
  return cands
    .map((c) => {
      const s = sat(c.color);
      const l = lum(c.color);
      const kind =
        s < 0.15
          ? "neutraali"
          : l > 0.82
          ? "vaalea pastelli"
          : l < 0.06
          ? "lähes musta"
          : "kylläinen";
      return `${c.color} — ${c.count}× · ${kind} · ${hueName(c.color)}`;
    })
    .join("\n");
}

/** Sävyn nimi suomeksi. Auttaa mallia näkemään, että sivun kylläiset värit
 *  ovat saman sävyn eri kirkkauksia — silloin se sävy on brändiväri. */
function hueName(hex: string): string {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.04) return "harmaasävy";
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return "punainen";
  if (h < 45) return "oranssi";
  if (h < 70) return "keltainen";
  if (h < 165) return "vihreä";
  if (h < 200) return "turkoosi";
  if (h < 260) return "sininen";
  if (h < 290) return "violetti";
  return "magenta";
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

/** Arvaa paletti pelkistä väriehdokkaista. Tämä on sekä varapaletti ilman
 *  Claudea että vertailukohta, jota vasten mallin valinta tarkistetaan. */
function guessPalette(s: ScrapeResult): BrandCard["colors"] {
  const cands = s.colorCandidates.map((c) => c.color).filter((c) => HEX.test(c));

  // Brändiväri: kylläisin, ei liian vaalea eikä liian tumma, painotettuna yleisyydellä.
  const scored = cands
    .map((c, i) => ({ c, score: brandScore(c, i) }))
    .filter((x) => sat(x.c) > 0.25)
    .sort((a, b) => b.score - a.score);

  const primary = scored[0]?.c ?? "#1f4fd8";

  const distinct = (a: string, b: string) =>
    colorDistance(a, b) > SNAP_MAX_DISTANCE;

  // Korostusväri on painikkeen väri, joten ei riitä että se on eri kuin
  // pääväri: sen on erotuttava vaaleasta pohjasta ja kannettava luettavaa
  // tekstiä. Saman sävyn tummempi versio on tähän usein paras vaihtoehto,
  // ja brändeillä sellainen yleensä on — aiemmin tähän valikoitui vain
  // "jokin muu kuin primary", joka saattoi olla lukukelvoton painikkeena.
  const usableCta = (c: string) =>
    distinct(c, primary) &&
    contrast(c, "#ffffff") >= 3 &&
    contrast(readableOnColor(c), c) >= 4.5;

  const accent =
    scored.find((x) => usableCta(x.c))?.c ??
    scored.find((x) => distinct(x.c, primary))?.c ??
    primary;

  const secondary =
    scored.find((x) => distinct(x.c, primary) && distinct(x.c, accent))?.c ??
    accent;

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
