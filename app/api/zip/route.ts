import archiver from "archiver";
import { specs } from "@/lib/specs";
import { slug } from "@/lib/generate";
import type { GeneratedAsset } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let assets: GeneratedAsset[];
  let companyName: string;

  try {
    const body = await req.json();
    assets = Array.isArray(body?.assets) ? body.assets : [];
    companyName = String(body?.companyName ?? "aineistot");
  } catch {
    return new Response(JSON.stringify({ error: "Virheellinen pyyntö." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (assets.length === 0) {
    return new Response(JSON.stringify({ error: "Ei pakattavia aineistoja." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const archive = archiver("zip", { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on("data", (c: Buffer) => chunks.push(c));

  const done = new Promise<void>((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
  });

  for (const a of assets) {
    if (a.kind === "html5" && a.html) {
      archive.append(a.html, { name: `html5/${a.fileName}` });
    } else if (a.dataUri) {
      const b64 = a.dataUri.slice(a.dataUri.indexOf(",") + 1);
      archive.append(Buffer.from(b64, "base64"), {
        name: `display/${a.fileName}`,
      });
    }
  }

  archive.append(buildReadme(assets, companyName), { name: "LUEMINUT.txt" });
  archive.finalize();
  await done;

  const zip = Buffer.concat(chunks);
  const fileName = `${slug(companyName)}_amr-aineistot.zip`;

  return new Response(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${fileName}"`,
      "content-length": String(zip.byteLength),
    },
  });
}

function buildReadme(assets: GeneratedAsset[], companyName: string): string {
  const lines: string[] = [];
  const allPass = assets.every((a) => a.validation.pass);

  lines.push(`AMR Aineistostudio — ${companyName}`);
  lines.push("=".repeat(60));
  lines.push("");
  lines.push(`Luotu: ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
  lines.push(`Aineistoja: ${assets.length}`);
  lines.push(
    `Validointi: ${allPass ? "kaikki läpäisivät" : "osa ei läpäissyt, katso alta"}`
  );
  lines.push("");
  lines.push(
    `Aineistot on tarkistettu Alma Median display-aineisto-ohjeita vasten.`
  );
  lines.push(`Lähde: ${specs.source.url}`);
  lines.push(`Speksit haettu: ${specs.source.fetchedAt}`);
  lines.push("");
  if (specs.global.requireAiActLabel) {
    lines.push(`AI Act -merkintä: "${specs.global.aiActLabel}" on upotettu`);
    lines.push(`jokaiseen aineistoon näkyvänä tekstinä.`);
    lines.push("");
  }
  lines.push("-".repeat(60));
  lines.push("AINEISTOT");
  lines.push("-".repeat(60));

  for (const a of assets) {
    lines.push("");
    lines.push(`${a.fileName}`);
    lines.push(
      `  ${a.formatName} · ${a.width}×${a.height} px · ${Math.round(
        a.fileSizeBytes / 1024
      )} kt · ${a.kind === "html5" ? "HTML5-animaatio" : "staattinen"}`
    );
    lines.push(`  Otsikko: ${a.copy.headline}`);
    lines.push(`  Teksti:  ${a.copy.body}`);
    lines.push(`  CTA:     ${a.copy.cta}`);
    for (const c of a.validation.checks) {
      lines.push(
        `  ${c.pass ? "[OK]" : "[EI]"} ${c.label}${c.detail ? `: ${c.detail}` : ""}`
      );
    }
  }

  lines.push("");
  lines.push("-".repeat(60));
  lines.push("HTML5-AINEISTOT");
  lines.push("-".repeat(60));
  for (const n of specs.global.html5.notes) lines.push(`- ${n}`);
  lines.push("");
  lines.push(
    "HTML5-tiedostot ovat itsenäisiä: kuvat ja tyylit on upotettu tiedostoon,"
  );
  lines.push("joten ulkoisia latauksia ei tehdä.");
  lines.push("");

  return lines.join("\n");
}
