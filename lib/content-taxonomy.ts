/**
 * IAB Content Taxonomy 3.1 — names used as the brand card's Content Type.
 *
 * The list is a local snapshot of the Name column from
 * https://github.com/InteractiveAdvertisingBureau/Taxonomies
 * (Content Taxonomies / Content Taxonomy 3.1.tsv). Claude picks from it;
 * the UI never invents a label.
 */

import raw from "./data/content-taxonomy-3.1.json";
import type { BrandCard } from "./types";

export interface ContentTypeCategory {
  id: string;
  parent: string | null;
  name: string;
  path: string;
}

interface TaxonomyFile {
  source: string;
  sourceUrl: string;
  categories: ContentTypeCategory[];
}

export const contentTaxonomy = raw as TaxonomyFile;
export const contentTypeCategories: ContentTypeCategory[] =
  contentTaxonomy.categories;

export const contentTypeNames: string[] = contentTypeCategories.map(
  (c) => c.name
);

const byName = new Map(
  contentTypeCategories.map((c) => [c.name.toLowerCase(), c])
);

export function findContentType(name: string): ContentTypeCategory | undefined {
  return byName.get(name.trim().toLowerCase());
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b);
  let inter = 0;
  for (const t of a) if (sb.has(t)) inter++;
  return inter / (a.length + b.length - inter);
}

/**
 * Snap a free-form label onto an official Name. Exact match first, then
 * a conservative fuzzy match so a near-miss from the model still lands.
 */
export function snapContentType(raw: string): string {
  const q = raw.trim();
  if (!q) return "";
  const exact = byName.get(q.toLowerCase());
  if (exact) return exact.name;

  const qTokens = tokens(q);
  const qLower = q.toLowerCase();
  let bestName = "";
  let best = 0;

  for (const c of contentTypeCategories) {
    const n = c.name.toLowerCase();
    let score = 0;
    if (n === qLower) return c.name;
    if (n.includes(qLower) || qLower.includes(n)) {
      score = 0.72 + Math.min(n.length, qLower.length) / 200;
    } else {
      score = jaccard(qTokens, tokens(c.name));
    }
    if (score > best) {
      best = score;
      bestName = c.name;
    }
  }

  return best >= 0.4 ? bestName : "";
}

/** Next-best official names, preferring siblings and the same top-level tier. */
export function closestContentTypes(
  name: string,
  count = 4,
  exclude: Iterable<string> = []
): string[] {
  const skip = new Set(
    [...exclude, name].map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
  const origin = findContentType(name);
  const originTop = origin?.path.split(" > ")[0] ?? "";
  const qTokens = tokens(name);

  return contentTypeCategories
    .filter((c) => !skip.has(c.name.toLowerCase()))
    .map((c) => {
      let score = jaccard(qTokens, tokens(c.name)) * 3;
      if (origin && c.parent && c.parent === origin.parent) score += 5;
      if (originTop && c.path.split(" > ")[0] === originTop) score += 2;
      return { name: c.name, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((x) => x.name);
}

export function resolveContentTypePicks(
  primary: string,
  alternatives: string[] = []
): { contentType: string; contentTypeAlternatives: string[] } {
  let contentType = snapContentType(primary);
  const seen = new Set<string>([contentType.toLowerCase()]);
  const alts: string[] = [];

  for (const raw of alternatives) {
    const snapped = snapContentType(raw);
    if (!snapped || seen.has(snapped.toLowerCase())) continue;
    seen.add(snapped.toLowerCase());
    alts.push(snapped);
    if (alts.length === 4) break;
  }

  // The model's first choice does not always land on an official name while
  // its runners-up do. Promoting the best surviving alternative beats handing
  // back nothing at all: the field is required, and an approximate guess the
  // advertiser can correct is more use than an empty select.
  if (!contentType && alts.length > 0) {
    contentType = alts.shift() as string;
  }

  if (contentType && alts.length < 4) {
    for (const extra of closestContentTypes(contentType, 4, seen)) {
      if (seen.has(extra.toLowerCase())) continue;
      seen.add(extra.toLowerCase());
      alts.push(extra);
      if (alts.length === 4) break;
    }
  }

  return { contentType, contentTypeAlternatives: alts.slice(0, 4) };
}

/**
 * Keyword match used when Claude is unavailable. Scores official names
 * against the page text and takes the top hit plus four runners-up.
 */
export function inferContentTypeFromText(text: string): {
  contentType: string;
  contentTypeAlternatives: string[];
} {
  const hay = text.toLowerCase();
  if (!hay.trim()) {
    return { contentType: "", contentTypeAlternatives: [] };
  }

  const scored = contentTypeCategories
    .map((c) => {
      const name = c.name.toLowerCase();
      let score = 0;
      if (name.length > 3 && hay.includes(name)) score += 8;
      for (const tok of tokens(c.name)) {
        if (tok.length > 3 && hay.includes(tok)) score += 1;
      }
      score += c.path.split(" > ").length * 0.05;
      return { name: c.name, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return { contentType: "", contentTypeAlternatives: [] };
  }

  return resolveContentTypePicks(
    scored[0].name,
    scored.slice(1, 8).map((x) => x.name)
  );
}

export function searchContentTypes(
  query: string,
  limit = 50
): ContentTypeCategory[] {
  const q = query.trim().toLowerCase();
  if (!q) return contentTypeCategories;

  const qTokens = tokens(q);
  return contentTypeCategories
    .map((c) => {
      const blob = `${c.name} ${c.path}`.toLowerCase();
      let score = 0;
      if (blob.startsWith(q) || c.name.toLowerCase().startsWith(q)) score += 8;
      if (blob.includes(q)) score += 4;
      score += jaccard(qTokens, tokens(c.name)) * 3;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.c);
}

/** Coarse bucket the onboarding recommendation still branches on. */
export type CoarseBusinessCategory =
  | "real-estate"
  | "b2b-professional"
  | "ecommerce"
  | "local-services"
  | "other";

export function categoryFromContentType(name: string): CoarseBusinessCategory {
  const cat = findContentType(name);
  const top = (cat?.path.split(" > ")[0] ?? name).toLowerCase();
  if (top.includes("real estate")) return "real-estate";
  if (top.includes("business and finance") || top.includes("career")) {
    return "b2b-professional";
  }
  if (top.includes("shopping")) return "ecommerce";
  if (
    /food|drink|medical|health|healthy living|style|fashion|home|garden|automotive|attraction|travel|beauty|sport|family|pet/.test(
      top
    )
  ) {
    return "local-services";
  }
  return "other";
}

/** Accepts a brand card that still carries the old `industry` field. */
export function normalizeBrandContentType(
  brand: BrandCard & { industry?: string }
): BrandCard {
  const raw =
    brand.contentType ||
    (typeof brand.industry === "string" ? brand.industry : "") ||
    "";
  const { industry: _legacyIndustry, ...rest } = brand;
  const resolved = resolveContentTypePicks(
    raw,
    rest.contentTypeAlternatives ?? []
  );
  return { ...rest, ...resolved };
}
