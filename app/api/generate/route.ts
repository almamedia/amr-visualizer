import { NextResponse } from "next/server";
import { generateAssets } from "@/lib/generate";
import type { BrandCard, CopyVariant, GoalId } from "@/lib/types";
import { specs } from "@/lib/specs";

export const runtime = "nodejs";
export const maxDuration = 120;

const VALID_GOALS = new Set(specs.goals.map((g) => g.id));

export async function POST(req: Request) {
  let brand: BrandCard;
  let goalId: GoalId;
  let formatIds: string[] | undefined;
  let copyVariants: CopyVariant[] | undefined;

  try {
    const body = await req.json();
    brand = body?.brand;
    goalId = body?.goalId;
    formatIds = Array.isArray(body?.formatIds) ? body.formatIds : undefined;
    copyVariants = Array.isArray(body?.copyVariants)
      ? body.copyVariants
      : undefined;
  } catch {
    return NextResponse.json({ error: "Virheellinen pyyntö." }, { status: 400 });
  }

  if (!brand?.companyName) {
    return NextResponse.json(
      { error: "Brändikortti puuttuu tai on vaillinainen." },
      { status: 400 }
    );
  }
  if (!VALID_GOALS.has(goalId)) {
    return NextResponse.json(
      { error: "Valitse kampanjatavoite." },
      { status: 400 }
    );
  }

  try {
    const result = await generateAssets({
      brand,
      goalId,
      formatIds,
      copyVariants,
    });
    return NextResponse.json(result);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Aineistojen generointi epäonnistui.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
