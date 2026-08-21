import type { BrandCard, CopyVariant } from "@/lib/types";
import {
  getVideoFormat,
  isVideoFormatId,
  VIDEO_DURATION_SECONDS,
  type VideoFormatId,
} from "@/lib/video/formats";
import { toVideoAdProps } from "@/lib/video/props";
import { renderVideoAd } from "@/lib/video/render.server";
import type { Route } from "./+types/api.video";

export async function action({ request }: Route.ActionArgs) {
  let brand: BrandCard;
  let copy: CopyVariant;
  let formatId: VideoFormatId;

  try {
    const body = await request.json();
    brand = body?.brand;
    copy = body?.copy;
    formatId = body?.formatId;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!brand?.companyName || !copy?.headline || !copy?.cta) {
    return Response.json(
      { error: "The brand card or selected copy is incomplete." },
      { status: 400 }
    );
  }
  if (!isVideoFormatId(formatId)) {
    return Response.json(
      { error: "Choose a supported video format." },
      { status: 400 }
    );
  }

  try {
    const format = getVideoFormat(formatId);
    const buffer = await renderVideoAd(toVideoAdProps(brand, copy, formatId));
    const maxBytes = format.maxFileSizeMb * 1024 * 1024;
    const passed =
      buffer.byteLength <= maxBytes &&
      VIDEO_DURATION_SECONDS <= format.maxDurationSeconds;
    const filename = `${slug(brand.companyName)}_${format.id}_${format.width}x${format.height}_10s.mp4`;

    return new Response(new Uint8Array(buffer), {
      headers: {
        "content-type": "video/mp4",
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": String(buffer.byteLength),
        "x-amr-video-filename": filename,
        "x-amr-video-bytes": String(buffer.byteLength),
        "x-amr-video-passed": String(passed),
        "x-amr-video-max-bytes": String(maxBytes),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Rendering the video failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[äå]/g, "a")
      .replace(/ö/g, "o")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "asset"
  );
}
