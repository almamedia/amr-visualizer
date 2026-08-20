import { NextResponse } from "next/server";
import { scrape } from "@/lib/scrape";
import { analyzeBrand, extractSignals, hasApiKey } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 60;

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
export async function POST(req: Request) {
  let url: string;
  try {
    const body = await req.json();
    url = String(body?.url ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!url) {
    return NextResponse.json(
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

    return NextResponse.json({
      signals,
      brand,
      meta: { aiEnabled: hasApiKey(), usedPlaywright: scraped.usedPlaywright },
    });
  } catch {
    // The site was unreachable or unreadable. The flow continues without it.
    return NextResponse.json({
      signals: null,
      brand: null,
      meta: { aiEnabled: hasApiKey(), unreachable: true },
    });
  }
}
