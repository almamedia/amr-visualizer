/**
 * Alma's private audience-segment taxonomy (cohorts.json, PRD §7 step 4
 * upgrade). Gitignored — every environment supplies its own copy at this
 * path; the flow degrades to the static audience-type list when it's absent.
 * See cohorts.example.json for the shape.
 *
 * This module only prepares data — same role scrape.ts plays for
 * analyzeBrand/extractSignals. The matching itself is one function in
 * claude.ts, not a separate engine: the taxonomy is too large and too
 * free-form (Finnish descriptions, no category or keyword fields) for the
 * deterministic scoring the rest of onboarding uses.
 */

import fs from "node:fs";
import path from "node:path";
import type { Cohort } from "./types";

const COHORTS_PATH = path.join(
  process.cwd(),
  "lib/onboarding/data/cohorts.json"
);

interface RawCohort {
  id: string;
  name: string;
  description: string;
  live_audience_size: number;
}

interface LoadedCohort extends Cohort {
  /** True for the "Geo" branch — region/city segments. */
  isGeo: boolean;
  /** Lowercased leaf value, e.g. "helsinki", for the free-text override match. */
  leaf: string;
}

let cache: LoadedCohort[] | null = null;

/** Parsed once per server process; cohorts.json does not change at runtime. */
function load(): LoadedCohort[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(
      fs.readFileSync(COHORTS_PATH, "utf-8")
    ) as RawCohort[];
    cache = raw.map((r) => {
      // "ALMA - Automotive - Car model - Volvo C40" -> "Automotive>Car model>Volvo C40".
      // The name is already English; description is Finnish and largely redundant with it.
      const segments = r.name
        .split(" - ")
        .map((s) => s.trim())
        .filter((s) => s && s !== "ALMA");
      return {
        id: r.id,
        path: segments.join(">"),
        liveAudienceSize: r.live_audience_size,
        isGeo: segments[0] === "Geo",
        leaf: (segments[segments.length - 1] ?? "").toLowerCase(),
      };
    });
  } catch {
    // Missing file, unreadable, or malformed — the flow falls back silently.
    cache = [];
  }
  return cache;
}

export function cohortsAvailable(): boolean {
  return load().length > 0;
}

/**
 * The candidate set sent to Claude: every non-Geo cohort, plus a short Geo
 * shortlist built by testing each Geo cohort's place name against whatever
 * the advertiser already told us (region, city, or their own free text) —
 * one substring scan, so "based in Tampere, want to reach Helsinki" surfaces
 * the Helsinki segment without sending all ~300 Geo rows.
 *
 * `exclude` drops ids already shown, so Refresh can't repeat itself.
 */
export function prepareCohortCandidates(opts: {
  regionId: string;
  city: string;
  enrichment: string;
  exclude: string[];
}): { promptBlock: string; byId: Map<string, Cohort> } | null {
  const all = load();
  if (all.length === 0) return null;

  const excluded = new Set(opts.exclude);
  const nonGeo = all.filter((c) => !c.isGeo && !excluded.has(c.id));

  const needle = `${opts.regionId} ${opts.city} ${opts.enrichment}`.toLowerCase();
  const geoShortlist = all.filter(
    (c) => c.isGeo && !excluded.has(c.id) && c.leaf && needle.includes(c.leaf)
  );

  const candidates = [...nonGeo, ...geoShortlist];
  if (candidates.length === 0) return null;

  const byId = new Map<string, Cohort>(
    candidates.map((c) => [c.id, { id: c.id, path: c.path, liveAudienceSize: c.liveAudienceSize }])
  );
  // One line per candidate, id + path only — no JSON keys, no description,
  // no audience size. That's the whole compression: strip everything the
  // model doesn't need to judge relevance.
  const promptBlock = candidates.map((c) => `${c.id}\t${c.path}`).join("\n");

  return { promptBlock, byId };
}
