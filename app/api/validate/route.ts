import { NextResponse } from "next/server";
import { validateStatic, validateHtml5 } from "@/lib/validate";
import { specs } from "@/lib/specs";

export const runtime = "nodejs";

/**
 * Tarkistaa yksittäisen aineiston speksejä vasten. Generointi validoi
 * aineistot jo valmiiksi; tämä on erillinen tarkistuspiste esimerkiksi
 * käsin muokatulle copylle tai ulkopuolelta tuodulle aineistolle.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body?.kind === "html5") {
      return NextResponse.json(
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

    return NextResponse.json(
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
      e instanceof Error ? e.message : "Validointi epäonnistui.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Speksikirjaston sisältö UI:lle ja tarkistuksiin. */
export async function GET() {
  return NextResponse.json(specs);
}
