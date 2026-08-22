/**
 * Alma cohort ids -> Xandr segment ids.
 *
 * The audience step ranks cohorts from Alma's own taxonomy, and those cohorts
 * exist in Xandr as segments whose `code` is the cohort id with a `permutive_`
 * prefix:
 *
 *   cohort 107119  ->  segment 31071911
 *                      code       "permutive_107119"
 *                      short_name "ALMA - Socio - Income Level - More than 100 000 €/year (107119)"
 *
 * So a cohort the user picked can be targeted directly, with no mapping table
 * for anyone to maintain.
 */

import { request } from "./client";
import { memberId } from "./config";

/** Xandr stores Alma's cohort ids behind this prefix. */
const SEGMENT_CODE_PREFIX = "permutive_";

/** Cohort id -> segment id, or null when Xandr has no segment for it. */
const cache = new Map<string, number | null>();

export function segmentCodeFor(cohortId: string): string {
  return `${SEGMENT_CODE_PREFIX}${cohortId}`;
}

async function lookup(cohortId: string): Promise<number | null> {
  const cached = cache.get(cohortId);
  if (cached !== undefined) return cached;

  let id: number | null = null;
  try {
    const res = await request<{ segments?: { id: number }[]; segment?: { id: number } }>({
      method: "GET",
      service: "segment",
      params: { member_id: memberId(), code: segmentCodeFor(cohortId) },
    });
    // Xandr answers with `segment` for an exact match and `segments` for a list.
    id = res.segment?.id ?? res.segments?.[0]?.id ?? null;
  } catch {
    // A cohort with no segment is a data gap, not a failed booking.
    id = null;
  }

  cache.set(cohortId, id);
  return id;
}

export interface ResolvedSegments {
  ids: number[];
  warnings: string[];
}

export async function resolveCohortSegments(
  cohortIds: string[]
): Promise<ResolvedSegments> {
  const ids: number[] = [];
  const warnings: string[] = [];

  for (const cohortId of cohortIds) {
    const id = await lookup(cohortId);
    if (id === null) {
      warnings.push(
        `Cohort ${cohortId} has no Xandr segment (looked for code "${segmentCodeFor(cohortId)}").`
      );
      continue;
    }
    ids.push(id);
  }

  return { ids, warnings };
}
