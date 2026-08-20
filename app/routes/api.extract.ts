import { scrape } from "@/lib/scrape";
import { analyzeBrand, hasApiKey } from "@/lib/claude";
import { specs, goals } from "@/lib/specs";

import type { Route } from "./+types/api.extract";

export async function action({ request }: Route.ActionArgs) {
  let url: string;
  try {
    const body = await request.json();
    url = String(body?.url ?? "").trim();
  } catch {
    return Response.json(
      { error: "Invalid request." },
      { status: 400 }
    );
  }

  if (!url) {
    return Response.json(
      { error: "Enter a website address." },
      { status: 400 }
    );
  }

  try {
    const scraped = await scrape(url);
    const brand = await analyzeBrand(scraped);

    return Response.json({
      brand,
      meta: {
        usedPlaywright: scraped.usedPlaywright,
        aiEnabled: hasApiKey(),
        formats: specs.formats.filter((f) => f.primary),
        goals,
      },
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Analysing the page failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
