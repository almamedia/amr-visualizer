import { matchCohorts } from "@/lib/claude";
import type { BusinessSignals, GoalId } from "@/lib/onboarding/types";

import type { Route } from "./+types/api.cohorts";

/**
 * Onboarding microsite (PRD §7 step 4 upgrade). Fired when the audience step
 * mounts, and again on Refresh or after the advertiser adds free text.
 *
 * Failure is a 200 with matches: null — a missing cohorts.json or a missing
 * API key is a normal state here, not an error the user needs to see; the
 * audience step falls back to the static audience-type list.
 */
export async function action({ request }: Route.ActionArgs) {
  let signals: BusinessSignals | null;
  let goal: GoalId | null;
  let regionId: string;
  let city: string;
  let enrichment: string;
  let exclude: string[];
  let limit: number;

  try {
    const body = await request.json();
    signals = (body?.signals ?? null) as BusinessSignals | null;
    goal = (body?.goal ?? null) as GoalId | null;
    regionId = String(body?.regionId ?? "");
    city = String(body?.city ?? "");
    enrichment = String(body?.enrichment ?? "");
    exclude = Array.isArray(body?.exclude) ? body.exclude.map(String) : [];
    limit = Math.min(10, Math.max(1, Number(body?.limit) || 5));
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const matches = await matchCohorts(
    signals,
    goal,
    regionId,
    city,
    enrichment,
    exclude,
    limit
  );

  return Response.json({ matches });
}
