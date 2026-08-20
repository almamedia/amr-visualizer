import { validateStatic, validateHtml5 } from "@/lib/validate";
import { specs } from "@/lib/specs";

import type { Route } from "./+types/api.validate";

/**
 * Check a single asset against the specs. Generation already validates what it
 * makes; this is a separate checkpoint for, say, hand-edited copy or an asset
 * brought in from outside.
 */
export async function action({ request }: Route.ActionArgs) {
  try {
    const body = await request.json();

    if (body?.kind === "html5") {
      return Response.json(
        validateHtml5({
          html5FormatId: body.html5FormatId,
          width: Number(body.width),
          height: Number(body.height),
          fileSizeBytes: Number(body.fileSizeBytes),
          animationSeconds: Number(body.animationSeconds ?? 0),
          copy: body.copy,
          hasAiActLabel: Boolean(body.hasAiActLabel),
          html: String(body.html ?? ""),
        })
      );
    }

    return Response.json(
      validateStatic({
        formatId: body.formatId,
        width: Number(body.width),
        height: Number(body.height),
        fileSizeBytes: Number(body.fileSizeBytes),
        fileType: String(body.fileType ?? "png"),
        copy: body.copy,
        hasAiActLabel: Boolean(body.hasAiActLabel),
      })
    );
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Validation failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}

/** The spec library, for the UI and for checks. */
export function loader() {
  return Response.json(specs);
}
