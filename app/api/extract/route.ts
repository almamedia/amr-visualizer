import { NextResponse } from "next/server";
import { scrape } from "@/lib/scrape";
import { analyzeBrand, hasApiKey } from "@/lib/claude";
import { specs, goals } from "@/lib/specs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let url: string;
  try {
    const body = await req.json();
    url = String(body?.url ?? "").trim();
  } catch {
    return NextResponse.json(
      { error: "Virheellinen pyyntö." },
      { status: 400 }
    );
  }

  if (!url) {
    return NextResponse.json(
      { error: "Anna verkkosivun osoite." },
      { status: 400 }
    );
  }

  try {
    const scraped = await scrape(url);
    const brand = await analyzeBrand(scraped);

    return NextResponse.json({
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
      e instanceof Error ? e.message : "Sivun analysointi epäonnistui.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
