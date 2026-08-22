/**
 * Onboarding places -> Xandr geography ids.
 *
 * Xandr knows 23 Finnish regions by name ("uusimaa", "finland proper",
 * "paijanne tavastia"), and regions.json already carries the aliases that
 * bridge the two vocabularies — "finland proper" is listed as an alias of
 * southwest-finland. So the match is on names, and no id table has to be
 * kept in step by hand.
 *
 * Cities are matched the same way, with one wrinkle: Xandr lists most Finnish
 * cities twice, once under an old coarse region ("Southern Finland") and once
 * under the maakunta ("uusimaa"). The maakunta entry is the current one, so a
 * candidate whose region matches a known maakunta wins.
 */

import { regions as onboardingRegions } from "../onboarding/catalog";
import { request } from "./client";

const COUNTRY_CODE = "FI";

interface XandrRegion {
  id: number;
  name: string;
}

interface XandrCity {
  id: number;
  name: string;
  region_name?: string;
}

/** Lowercase, strip accents and punctuation, so "Päijät-Häme" meets "paijat hame". */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Xandr's English region names where they do not match anything in
 * regions.json. Kept here rather than in the shared catalog: these spellings
 * are Xandr's, and nothing else in the app should have to know them.
 */
const XANDR_REGION_NAMES: Record<string, string> = {
  "paijat-hame": "paijanne tavastia",
  "south-ostrobothnia": "southern ostrobothnia",
  "north-ostrobothnia": "northern ostrobothnia",
  "north-savo": "northern savonia",
  "south-savo": "southern savonia",
  "kanta-hame": "tavastia proper",
  "southwest-finland": "finland proper",
};

/**
 * Names to try, most trustworthy first. Aliases come last because they are
 * city hints as much as region names — "oulu" is an alias of
 * north-ostrobothnia, and Xandr has a legacy region actually called Oulu that
 * would otherwise win over the real maakunta.
 */
function nameTiers(regionId: string): string[][] {
  const region = onboardingRegions.find((r) => r.id === regionId);
  const override = XANDR_REGION_NAMES[regionId];
  const tiers: string[][] = [];
  if (override) tiers.push([normalise(override)]);
  if (!region) return [...tiers, [normalise(regionId)]];
  tiers.push([regionId, region.name, region.finnishName].map(normalise));
  tiers.push((region.aliases ?? []).map(normalise));
  return tiers;
}

let regionCache: XandrRegion[] | null = null;

async function allRegions(): Promise<XandrRegion[]> {
  if (regionCache) return regionCache;
  const res = await request<{ regions: XandrRegion[] }>({
    method: "GET",
    service: "region",
    params: { country_code: COUNTRY_CODE, num_elements: 100 },
  });
  regionCache = res.regions ?? [];
  return regionCache;
}

export interface ResolvedGeo {
  ids: number[];
  warnings: string[];
}

export async function resolveRegions(regionIds: string[]): Promise<ResolvedGeo> {
  const ids: number[] = [];
  const warnings: string[] = [];
  if (regionIds.length === 0) return { ids, warnings };

  let available: XandrRegion[];
  try {
    available = await allRegions();
  } catch (e) {
    return {
      ids,
      warnings: [
        `Xandr regions could not be read, so no geographic targeting was applied: ${
          e instanceof Error ? e.message : "unknown error"
        }`,
      ],
    };
  }

  for (const regionId of regionIds) {
    let match: XandrRegion | undefined;
    for (const tier of nameTiers(regionId)) {
      const names = new Set(tier);
      match = available.find((r) => names.has(normalise(r.name)));
      if (match) break;
    }
    if (!match) {
      warnings.push(`Region "${regionId}" has no match among Xandr's Finnish regions.`);
      continue;
    }
    ids.push(match.id);
  }

  return { ids, warnings };
}

/** Region names Xandr uses for the current maakunta entries, for city picking. */
function maakuntaNames(): Set<string> {
  const names = new Set<string>();
  for (const region of onboardingRegions) {
    for (const tier of nameTiers(region.id)) for (const n of tier) names.add(n);
  }
  return names;
}

export async function resolveCities(cities: string[]): Promise<ResolvedGeo> {
  const ids: number[] = [];
  const warnings: string[] = [];
  if (cities.length === 0) return { ids, warnings };

  const maakunnat = maakuntaNames();

  for (const city of cities) {
    try {
      const res = await request<{ cities: XandrCity[] }>({
        method: "GET",
        service: "city",
        params: { country_code: COUNTRY_CODE, search: city, num_elements: 10 },
      });
      const candidates = (res.cities ?? []).filter(
        (c) => normalise(c.name) === normalise(city)
      );
      if (candidates.length === 0) {
        warnings.push(`City "${city}" is not known to Xandr and was not targeted.`);
        continue;
      }
      // Prefer the entry filed under a maakunta over the legacy coarse region.
      const best =
        candidates.find((c) => maakunnat.has(normalise(c.region_name ?? ""))) ??
        candidates[0];
      ids.push(best.id);
    } catch (e) {
      warnings.push(
        `City "${city}" could not be looked up: ${
          e instanceof Error ? e.message : "unknown error"
        }`
      );
    }
  }

  return { ids, warnings };
}
