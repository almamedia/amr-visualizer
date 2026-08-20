import Anthropic from "@anthropic-ai/sdk";
import type { ScrapeResult } from "./scrape";
import type { BrandCard, CopyVariant, GoalId, TextLimits } from "./types";
import { getGoal } from "./specs";
import type { BusinessSignals } from "./onboarding/types";
import {
  inferContentTypeFromText,
  resolveContentTypePicks,
} from "./content-taxonomy";

const DEFAULT_MODEL = "claude-sonnet-4-6";

/** How many image candidates the model is shown. Every image costs tokens,
 *  so it reviews the top of the list rather than the whole page. */
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
 * Call Claude and return parsed JSON. If the model does not support the effort
 * parameter, retry without it so the model stays freely swappable.
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
    // The model does not support effort — run without it.
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
  throw new Error("Claude returned no text content.");
}

/** Tolerant JSON parsing: survives code fences and prose around the object. */
function parseJson<T>(raw: string): T {
  let s = raw.trim();

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();

  try {
    return JSON.parse(s) as T;
  } catch {
    // Find the first balanced object or array.
  }

  const start = s.search(/[[{]/);
  if (start === -1) throw new Error("Claude returned no JSON.");
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
  throw new Error("Claude returned incomplete JSON.");
}

// ----------------------------------------------------------------- brand

const BRAND_SYSTEM = `You are a brand analyst. You read a small business's website and condense it into a brand card an ad can be built from.

Reply with JSON ONLY, no explanation and no code fences. Use exactly this shape:
{
  "companyName": string,
  "description": string,
  "tone": string,
  "contentType": string,
  "contentTypeAlternatives": [string, string, string, string],
  "logoUrl": string | null,
  "colors": { "primary": "#rrggbb", "secondary": "#rrggbb", "accent": "#rrggbb", "background": "#rrggbb", "text": "#rrggbb" },
  "fonts": { "heading": string, "body": string },
  "imageUrls": string[]
}

Instructions:
- Write every string in English, even when the site is in another language.
- companyName: the company's name as it appears on the page. Not the slogan, not the domain.
- description: one or two sentences on what the company does and who for. Concrete, no marketing cliché.
- tone: tone of voice in two to four words, e.g. "Warm and expert".
- contentType: the single best IAB Content Taxonomy 3.1 Name for this website (copy an official Name, e.g. "Bars & Restaurants"). Prefer the most specific matching category. Never invent a label.
- contentTypeAlternatives: exactly four other official IAB Names — the next-closest matches, ordered closest first. No duplicates, and none equal to contentType.
- logoUrl: pick the likeliest logo from the candidates, or null if none convinces. Prefer an image whose path or alt text says logo over a favicon. The ad is built on a light ground, so avoid reversed-out versions: if the filename contains white, nega, invert or light, choose another candidate when one is available.
- colors: pick the real brand colours from the candidates. primary is the most recognisable brand colour. background is the light or dark ground the ad is built on. text stands clearly apart from background (contrast at least 4.5:1). accent is used on the CTA button and must stand apart from background. If no sensible colour is among the candidates, choose a neutral that suits the content type.
- fonts: pick from the font candidates. If none fit, suggest fonts that suit the content type.
- imageUrls: pick two to four images suitable for advertising. The images are attached, so look at them. Return the URLs exactly as given, and use the numbering to identify them.

  Always reject an image that has:
  - text, headlines, slogans or web addresses over it
  - a CTA button or any other call to action
  - a logo as the dominant element
  An image like that is already an ad. It cannot be the image inside a new ad: it carries its own headline and its own call to action, both competing with the new ad, and cropping cuts its text mid-word.

  Also reject collages, screenshots, charts, tables and empty decorative patterns.

  Choose photographs: people, products, spaces, or work being done. If no image is usable, return an empty list — an ad built from type and colour beats an ad built on the wrong photo.`;

interface BrandResponse {
  companyName: string;
  description: string;
  tone: string;
  contentType: string;
  contentTypeAlternatives: string[];
  logoUrl: string | null;
  colors: BrandCard["colors"];
  fonts: BrandCard["fonts"];
  imageUrls: string[];
}

export async function analyzeBrand(s: ScrapeResult): Promise<BrandCard> {
  if (!hasApiKey()) return mockBrand(s);

  const user = `Website: ${s.finalUrl}

<title>${s.title}</title>
<og:site_name>${s.ogSiteName}</og:site_name>
<og:title>${s.ogTitle}</og:title>
<meta-description>${s.metaDescription}</meta-description>
<og:description>${s.ogDescription}</og:description>

<logo-candidates>
${s.logoCandidates.map((u, i) => `${i + 1}. ${u}`).join("\n") || "(none found)"}
</logo-candidates>

<image-candidates>
${
  s.imageCandidates
    .map((im, i) => `${i + 1}. ${im.url}${im.alt ? ` — alt: ${im.alt}` : ""}`)
    .join("\n") || "(none found)"
}
</image-candidates>

<colour-candidates by-frequency>
${
  s.colorCandidates.map((c) => `${c.color} (${c.count})`).join(", ") ||
  "(none found)"
}
</colour-candidates>

<font-candidates>
${s.fontCandidates.join(", ") || "(none found)"}
</font-candidates>

<page-text>
${s.text.slice(0, 5000)}
</page-text>`;

  // Attach the image candidates as images so the model can see them. Judged
  // on URL and alt text alone, a finished ad slips through easily.
  const visionContent: Anthropic.ContentBlockParam[] = [];
  const shown = s.imageCandidates.slice(0, MAX_VISION_IMAGES);
  for (const [i, img] of shown.entries()) {
    visionContent.push({ type: "text", text: `Image ${i + 1}: ${img.url}` });
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
      // The images may be out of the model's reach: behind a login, too
      // large, an unknown format. Fall back to the text-only analysis.
      if (!shown.length) throw visionError;
      r = await askJson<BrandResponse>(BRAND_SYSTEM, user, 2000, "low");
    }

    const known = new Map(s.imageCandidates.map((i) => [i.url, i.alt]));
    const images = (r.imageUrls ?? [])
      .filter((u) => typeof u === "string" && u.startsWith("http"))
      .slice(0, 4)
      .map((url) => ({ url, alt: known.get(url) ?? "", enabled: true }));

    const content = resolveContentTypePicks(
      clean(r.contentType),
      Array.isArray(r.contentTypeAlternatives)
        ? r.contentTypeAlternatives.map(clean)
        : []
    );

    return {
      sourceUrl: s.finalUrl,
      companyName: clean(r.companyName) || fallbackName(s),
      description: clean(r.description) || s.metaDescription || "",
      tone: clean(r.tone) || "Clear and straightforward",
      contentType: content.contentType,
      contentTypeAlternatives: content.contentTypeAlternatives,
      logoUrl: r.logoUrl && r.logoUrl.startsWith("http") ? r.logoUrl : null,
      colors: sanitizeColors(r.colors, s),
      fonts: {
        heading: clean(r.fonts?.heading) || "Helvetica Neue",
        body: clean(r.fonts?.body) || "Helvetica Neue",
      },
      // An empty list is the model's deliberate choice when no image is
      // usable (finished ads, screenshots). It is not overridden with the raw
      // list — an ad built from type beats an ad built on the wrong photo.
      images,
      warnings: s.warnings,
    };
  } catch (e) {
    const brand = mockBrand(s);
    brand.warnings = [
      ...(brand.warnings ?? []),
      `Claude analysis failed (${
        e instanceof Error ? e.message : "unknown error"
      }). Using the estimate read straight off the page.`,
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
    // Domain to name: strip www and the TLD, capitalise the first letter.
    const host = new URL(s.finalUrl).hostname
      .replace(/^www\./, "")
      .replace(/\.(fi|com|net|org|eu|se|io|co\.uk)$/i, "")
      .split(".")[0];
    return host ? host.charAt(0).toUpperCase() + host.slice(1) : "The company";
  } catch {
    return "The company";
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

// ----------------------------------------------- heuristic fallback palette

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

/** Guess a palette from the colour candidates alone, when Claude is absent. */
function guessPalette(s: ScrapeResult): BrandCard["colors"] {
  const cands = s.colorCandidates.map((c) => c.color).filter((c) => HEX.test(c));

  // Brand colour: the most saturated, neither too light nor too dark, weighted by frequency.
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
  // A missing API key is not warned about here — the UI shows its own
  // standing notice, and saying it twice helps nobody.
  const warnings = [...s.warnings];
  const content = inferContentTypeFromText(
    [s.title, s.ogTitle, s.metaDescription, s.ogDescription, s.text.slice(0, 4000)]
      .filter(Boolean)
      .join("\n")
  );
  return {
    sourceUrl: s.finalUrl,
    companyName: fallbackName(s),
    description:
      s.metaDescription ||
      s.ogDescription ||
      s.text.slice(0, 180).trim() ||
      "Description missing — fill this in by hand.",
    tone: "Clear and straightforward",
    contentType: content.contentType,
    contentTypeAlternatives: content.contentTypeAlternatives,
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

/**
 * The language the ads themselves are written in.
 *
 * This is a product decision, not a translation detail. The tool is English,
 * but the ads it makes run in Alma's titles, which are read in Finnish. Change
 * this one constant to put the creative back into Finnish; the prompt, the mock
 * copy fallback and the character-set check all follow it.
 */
export const COPY_LANGUAGE = "English";

const COPY_SYSTEM = `You are an advertising copywriter. You write the text inside display ads for small and medium-sized businesses.

Reply with JSON ONLY, no explanation and no code fences:
{ "variants": [ { "headline": string, "body": string, "cta": string }, ... ] }

Write exactly 3 variants that differ in angle — do not write the same thing three ways.

Instructions:
- Write in ${COPY_LANGUAGE}. Clean, idiomatic, correctly spelled.
- The headline sells the benefit, not the feature. No exclamation marks, no all caps.
- The body supports the headline with one concrete thing.
- The CTA is a short call to action, e.g. "Book a time" or "See the range". No full stop.
- Never invent prices, figures, guarantees or claims that are not in the source material.
- Stay inside the character limits. They are absolute.`;

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
  const user = `Company: ${brand.companyName}
Content type: ${brand.contentType || "not known"}
What the company does: ${brand.description}
Tone of voice: ${brand.tone}

Campaign goal: ${goal.name} — ${goal.description}
CTA style: ${goal.ctaHint}

Character limits (absolute):
- headline: at most ${limits.headline} characters
- body: at most ${limits.body} characters
- cta: at most ${limits.cta} characters

Write 3 variants.`;

  const askVariants = async (): Promise<CopyVariant[]> => {
    const r = await askJson<CopyResponse>(COPY_SYSTEM, user, 1500, "medium");
    return (r.variants ?? [])
      .filter((v) => v && typeof v.headline === "string")
      .map((v, i) => ({
        id: `v${i + 1}`,
        headline: clean(v.headline),
        body: clean(v.body),
        cta: clean(v.cta) || "Read more",
      }));
  };

  try {
    let usable = (await askVariants()).filter(isLatinOnly);

    // The model occasionally mixes Cyrillic homoglyphs in among the Latin
    // ones ("your favourite piцца"). They look right at a glance but are
    // broken text in a finished ad, so ask again.
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

/** Cyrillic and Greek characters in Latin-script ad copy are always a slip by
 *  the model, never deliberate. */
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
  const trade = brand.contentType || "what we do";

  const byGoal: Record<GoalId, CopyVariant[]> = {
    awareness: [
      {
        id: "v1",
        headline: `${name} — close to you`,
        body: `See what we do, and why our customers keep coming back.`,
        cta: "Get to know us",
      },
      {
        id: "v2",
        headline: `Do you know ${name} yet?`,
        body: `${trade}, done properly and without the rush.`,
        cta: "See more",
      },
      {
        id: "v3",
        headline: `Here we are`,
        body: `${name} is open on weekdays and at weekends.`,
        cta: "Visit our site",
      },
    ],
    offer: [
      {
        id: "v1",
        headline: `Now is a good time to drop in`,
        body: `${name} has something for new customers. Ask us more.`,
        cta: "See the offer",
      },
      {
        id: "v2",
        headline: `Available for a limited time`,
        body: `Book your place before the offer ends.`,
        cta: "Book now",
      },
      {
        id: "v3",
        headline: `Save on your first visit`,
        body: `Mention this ad and we'll take care of the rest.`,
        cta: "Claim the offer",
      },
    ],
    recruitment: [
      {
        id: "v1",
        headline: `Come and work with us`,
        body: `${name} is looking for someone to join the team. See the openings.`,
        cta: "Apply now",
      },
      {
        id: "v2",
        headline: `We're looking for someone new`,
        body: `Good people, clear shifts and fair pay.`,
        cta: "Read more",
      },
      {
        id: "v3",
        headline: `Could you be next?`,
        body: `Tell us about yourself and let's talk.`,
        cta: "Get in touch",
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
  "contentType": string,
  "contentTypeAlternatives": [string, string, string, string],
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
- "contentType" is the single best IAB Content Taxonomy 3.1 Name for this website (e.g. "Bars & Restaurants", "Real Estate Buying and Selling"). Use an official Name, as specific as possible. Never invent a label.
- "contentTypeAlternatives" is exactly four other official IAB Names — the next-closest matches, ordered closest first. No duplicates, and none equal to contentType.
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

  const content = resolveContentTypePicks(
    clean(r.contentType) || clean(r.industry),
    Array.isArray(r.contentTypeAlternatives)
      ? r.contentTypeAlternatives.map(clean)
      : []
  );

  return {
    businessName,
    industry: content.contentType || clean(r.industry),
    contentType: content.contentType,
    contentTypeAlternatives: content.contentTypeAlternatives,
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
