import { scrape } from "@/lib/scrape";
import { analyzeBrand, extractSignals, hasApiKey } from "@/lib/claude";

import type { Route } from "./+types/api.analyze";

/**
 * Onboarding microsite (PRD §7 step 1). The user does not wait for this: the
 * flow fires it and moves on, and the result is collected on the
 * recommendation screen.
 *
 * Two things come back from one scrape. The signals shape the recommendation;
 * the brand card is carried through to the asset studio so it never has to
 * scrape the same site twice.
 *
 * Failure is a 200 with signals: null. A missing analysis is a normal state
 * in this flow, not an error the user needs to see.
 */
export async function action({ request }: Route.ActionArgs) {
  let url: string;
  try {
    const body = await request.json();
    url = String(body?.url ?? "").trim();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!url) {
    return Response.json(
      { error: "Enter a website address." },
      { status: 400 }
    );
  }

  try {
    const scraped = await scrape(url);
    const [brand, signals] = await Promise.all([
      analyzeBrand(scraped).catch(() => null),
      extractSignals(scraped),
    ]);

    return Response.json({
      signals,
      brand,
      meta: { aiEnabled: hasApiKey(), usedPlaywright: scraped.usedPlaywright },
    });
  } catch {
    // The site was unreachable or unreadable. The flow continues without it.
    return Response.json({
      signals: null,
      brand: null,
      meta: { aiEnabled: hasApiKey(), unreachable: true },
    });
  }
}
