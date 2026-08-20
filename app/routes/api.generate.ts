import { generateAssets } from "@/lib/generate";
import type { BrandCard, CopyVariant, GoalId } from "@/lib/types";
import { specs } from "@/lib/specs";

import type { Route } from "./+types/api.generate";

const VALID_GOALS = new Set(specs.goals.map((g) => g.id));

export async function action({ request }: Route.ActionArgs) {
  let brand: BrandCard;
  let goalId: GoalId;
  let formatIds: string[] | undefined;
  let copyVariants: CopyVariant[] | undefined;

  try {
    const body = await request.json();
    brand = body?.brand;
    goalId = body?.goalId;
    formatIds = Array.isArray(body?.formatIds) ? body.formatIds : undefined;
    copyVariants = Array.isArray(body?.copyVariants)
      ? body.copyVariants
      : undefined;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!brand?.companyName) {
    return Response.json(
      { error: "The brand card is missing or incomplete." },
      { status: 400 }
    );
  }
  if (!VALID_GOALS.has(goalId)) {
    return Response.json(
      { error: "Choose a campaign goal." },
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
    return Response.json(result);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Generating the assets failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
