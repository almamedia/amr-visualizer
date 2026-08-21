/**
 * Where the business operates — a city, a country, or Global.
 *
 * Claude picks the most specific level the website supports. The advertiser
 * can switch between those levels (and search the rest) on the brand step.
 */

import countriesRaw from "./data/countries.json";
import regionsRaw from "./onboarding/data/regions.json";

export type LocationKind = "city" | "country" | "global";

export interface GeoLocation {
  name: string;
  kind: LocationKind;
  /** Country the city sits in. Empty for countries and Global. */
  country: string;
  aliases: string[];
  /** Caption shown under the name in the picker. */
  path: string;
}

export const GLOBAL_LOCATION = "Global";

const GLOBAL: GeoLocation = {
  name: GLOBAL_LOCATION,
  kind: "global",
  country: "",
  aliases: ["worldwide", "international", "everywhere", "world"],
  path: "Worldwide",
};

const COUNTRY_ALIASES: Record<string, string[]> = {
  Czechia: ["Czech Republic"],
  Finland: ["Suomi", "Republic of Finland", "all of Finland", "whole of Finland"],
  Netherlands: ["The Netherlands", "Holland"],
  "South Korea": ["Korea", "Republic of Korea"],
  Turkey: ["Türkiye", "Turkiye"],
  "United Arab Emirates": ["UAE", "the UAE"],
  "United Kingdom": ["UK", "Great Britain", "Britain", "England"],
  "United States": ["USA", "US", "United States of America", "America"],
};

const CITY_ALIASES: Record<string, string[]> = {
  Espoo: ["Esbo"],
  Helsinki: ["Helsingfors"],
  Kokkola: ["Karleby"],
  Lappeenranta: ["Villmanstrand"],
  Loviisa: ["Lovisa"],
  Oulu: ["Uleåborg"],
  Parainen: ["Pargas"],
  Pietarsaari: ["Jakobstad"],
  Pori: ["Björneborg"],
  Porvoo: ["Borgå"],
  Raasepori: ["Raseborg"],
  Tampere: ["Tammerfors"],
  Tornio: ["Torneå"],
  Turku: ["Åbo"],
  Uusikaupunki: ["Nystad"],
  Vaasa: ["Vasa"],
  Vantaa: ["Vanda"],
  Gothenburg: ["Göteborg", "Goteborg"],
  Copenhagen: ["København", "Kobenhavn"],
  Munich: ["München"],
  Cologne: ["Köln", "Koln"],
};

const MAJOR_CITIES = new Set([
  "Helsinki",
  "Espoo",
  "Tampere",
  "Turku",
  "Oulu",
  "Vantaa",
  "Jyväskylä",
  "Kuopio",
  "Lahti",
  "Stockholm",
  "Oslo",
  "Copenhagen",
  "Tallinn",
  "London",
  "Berlin",
  "Paris",
]);

const EXTRA_CITIES: { name: string; country: string }[] = [
  { name: "Stockholm", country: "Sweden" },
  { name: "Gothenburg", country: "Sweden" },
  { name: "Malmö", country: "Sweden" },
  { name: "Oslo", country: "Norway" },
  { name: "Bergen", country: "Norway" },
  { name: "Copenhagen", country: "Denmark" },
  { name: "Aarhus", country: "Denmark" },
  { name: "Tallinn", country: "Estonia" },
  { name: "Tartu", country: "Estonia" },
  { name: "Riga", country: "Latvia" },
  { name: "Vilnius", country: "Lithuania" },
  { name: "Reykjavik", country: "Iceland" },
  { name: "London", country: "United Kingdom" },
  { name: "Manchester", country: "United Kingdom" },
  { name: "Berlin", country: "Germany" },
  { name: "Munich", country: "Germany" },
  { name: "Hamburg", country: "Germany" },
  { name: "Cologne", country: "Germany" },
  { name: "Paris", country: "France" },
  { name: "Amsterdam", country: "Netherlands" },
  { name: "Brussels", country: "Belgium" },
  { name: "Vienna", country: "Austria" },
  { name: "Zurich", country: "Switzerland" },
  { name: "Madrid", country: "Spain" },
  { name: "Barcelona", country: "Spain" },
  { name: "Rome", country: "Italy" },
  { name: "Milan", country: "Italy" },
  { name: "Warsaw", country: "Poland" },
  { name: "Prague", country: "Czechia" },
  { name: "Dublin", country: "Ireland" },
  { name: "New York", country: "United States" },
  { name: "Los Angeles", country: "United States" },
  { name: "Chicago", country: "United States" },
  { name: "San Francisco", country: "United States" },
  { name: "Toronto", country: "Canada" },
  { name: "Tokyo", country: "Japan" },
  { name: "Sydney", country: "Australia" },
  { name: "Dubai", country: "United Arab Emirates" },
];

function countryLocation(name: string): GeoLocation {
  return {
    name,
    kind: "country",
    country: "",
    aliases: COUNTRY_ALIASES[name] ?? [],
    path: "Country",
  };
}

function cityLocation(name: string, country: string): GeoLocation {
  return {
    name,
    kind: "city",
    country,
    aliases: CITY_ALIASES[name] ?? [],
    path: country ? `City · ${country}` : "City",
  };
}

const finnishCities: GeoLocation[] = (
  regionsRaw.cities as string[]
).map((name) => cityLocation(name, "Finland"));

const extraCities: GeoLocation[] = EXTRA_CITIES.map((c) =>
  cityLocation(c.name, c.country)
);

const countries: GeoLocation[] = (
  countriesRaw.countries as string[]
).map(countryLocation);

const catalog: GeoLocation[] = [GLOBAL, ...countries, ...finnishCities, ...extraCities];

const byKey = new Map<string, GeoLocation>();
for (const loc of catalog) {
  byKey.set(norm(loc.name), loc);
  for (const alias of loc.aliases) byKey.set(norm(alias), loc);
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9äöåüéíóúáčďěňřšťž]+/i)
    .filter((t) => t.length > 2);
}

export function findLocation(name: string): GeoLocation | undefined {
  if (!name.trim()) return undefined;
  return byKey.get(norm(name));
}

export function isGlobalLocation(name: string): boolean {
  return findLocation(name)?.kind === "global";
}

/** True when reach should not be capped to a Finnish region. */
export function isNationalReach(name: string): boolean {
  const loc = findLocation(name) ?? parseLocation(name);
  if (loc.kind === "global") return true;
  return loc.kind === "country" && loc.name === "Finland";
}

export function locationKind(name: string): LocationKind | "" {
  if (!name.trim()) return "";
  return (findLocation(name) ?? parseLocation(name)).kind;
}

/**
 * Catalog match, or a custom city when the model (or the advertiser) named
 * a place we do not list.
 */
export function parseLocation(raw: string): GeoLocation {
  const q = raw.trim();
  if (!q) {
    return { name: "", kind: "city", country: "", aliases: [], path: "City" };
  }
  const found = findLocation(q);
  if (found) return found;
  return cityLocation(q, "");
}

export function snapLocation(raw: string): string {
  const q = raw.trim();
  if (!q) return "";
  return (findLocation(q) ?? parseLocation(q)).name;
}

/** Next-best operating areas: the other geographic levels, then nearby cities. */
export function closestLocations(
  name: string,
  count = 4,
  exclude: Iterable<string> = []
): string[] {
  const skip = new Set(
    [...exclude, name].map((s) => norm(s)).filter(Boolean)
  );
  const origin = findLocation(name) ?? (name.trim() ? parseLocation(name) : null);
  const ranked: { name: string; score: number }[] = [];

  function consider(loc: GeoLocation, score: number) {
    if (!loc.name || skip.has(norm(loc.name))) return;
    ranked.push({ name: loc.name, score });
    skip.add(norm(loc.name));
  }

  if (origin?.kind === "city") {
    if (origin.country) consider(countryLocation(origin.country), 10);
    consider(GLOBAL, 8);
    for (const city of catalog) {
      if (city.kind !== "city") continue;
      if (origin.country && city.country === origin.country) {
        consider(city, MAJOR_CITIES.has(city.name) ? 6 : 3);
      }
    }
  } else if (origin?.kind === "country") {
    consider(GLOBAL, 10);
    for (const city of catalog) {
      if (city.kind === "city" && city.country === origin.name) {
        consider(city, 5);
      }
    }
  } else if (origin?.kind === "global") {
    consider(countryLocation("Finland"), 6);
    consider(cityLocation("Helsinki", "Finland"), 3);
  } else {
    consider(GLOBAL, 5);
    consider(countryLocation("Finland"), 4);
  }

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((x) => x.name);
}

export function resolveLocationPicks(
  primary: string,
  alternatives: string[] = []
): { location: string; locationAlternatives: string[] } {
  const location = snapLocation(primary);
  const seen = new Set<string>(location ? [norm(location)] : []);
  const alts: string[] = [];

  const push = (raw: string) => {
    const snapped = snapLocation(raw);
    if (!snapped || seen.has(norm(snapped))) return false;
    seen.add(norm(snapped));
    alts.push(snapped);
    return true;
  };

  for (const raw of alternatives) push(raw);

  // Global is always a first-class option, even when the model omitted it.
  if (location !== GLOBAL_LOCATION && !seen.has(norm(GLOBAL_LOCATION))) {
    if (alts.length >= 4) alts.pop();
    alts.push(GLOBAL_LOCATION);
    seen.add(norm(GLOBAL_LOCATION));
  }

  if (alts.length < 4) {
    for (const extra of closestLocations(location, 4, seen)) {
      push(extra);
      if (alts.length === 4) break;
    }
  }

  return { location, locationAlternatives: alts.slice(0, 4) };
}

/** Keyword match used when Claude leaves geography blank. */
export function inferLocationFromText(text: string): {
  location: string;
  locationAlternatives: string[];
} {
  const hay = text.toLowerCase();
  if (!hay.trim()) {
    return { location: "", locationAlternatives: [] };
  }

  const worldwide =
    /\b(worldwide|global(?:ly)?|international(?:ly)?|around the world|across the world)\b/i.test(
      text
    );

  const scored = catalog
    .filter((loc) => loc.kind !== "global")
    .map((loc) => {
      let score = 0;
      const names = [loc.name, ...loc.aliases];
      for (const n of names) {
        const needle = n.toLowerCase();
        if (needle.length < 3) continue;
        if (!hay.includes(needle)) continue;
        const weight = loc.kind === "city" ? 6 : 4;
        score += weight + Math.min(needle.length, 12) / 10;
      }
      return { loc, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return worldwide
      ? resolveLocationPicks(GLOBAL_LOCATION)
      : { location: "", locationAlternatives: [] };
  }

  const top = scored[0].loc;
  if (worldwide && top.kind !== "city") {
    return resolveLocationPicks(GLOBAL_LOCATION, scored.slice(0, 4).map((x) => x.loc.name));
  }

  return resolveLocationPicks(
    top.name,
    scored.slice(1, 8).map((x) => x.loc.name)
  );
}

export function searchLocations(
  query: string,
  limit = 80
): GeoLocation[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    const finland = countries.filter((c) => c.name === "Finland");
    const majors = catalog.filter(
      (loc) => loc.kind === "city" && MAJOR_CITIES.has(loc.name)
    );
    return [
      GLOBAL,
      ...finland,
      ...majors,
      ...countries.filter((c) => c.name !== "Finland"),
    ];
  }

  const qTokens = tokens(q);
  return catalog
    .map((loc) => {
      const blob = `${loc.name} ${loc.country} ${loc.aliases.join(" ")}`.toLowerCase();
      let score = 0;
      if (blob.startsWith(q) || loc.name.toLowerCase().startsWith(q)) score += 8;
      else if (blob.includes(q)) score += 4;
      for (const tok of qTokens) {
        if (blob.includes(tok)) score += 1;
      }
      if (loc.kind === "global") {
        const hits = [GLOBAL_LOCATION.toLowerCase(), ...loc.aliases];
        if (hits.some((h) => h.startsWith(q) || h.includes(q))) score += 6;
      }
      return { loc, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.loc.kind !== b.loc.kind) {
        const order = { global: 0, country: 1, city: 2 };
        return order[a.loc.kind] - order[b.loc.kind];
      }
      return a.loc.name.localeCompare(b.loc.name);
    })
    .slice(0, limit)
    .map((x) => x.loc);
}
