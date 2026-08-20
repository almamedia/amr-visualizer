import archiver from "archiver";
import { specs } from "@/lib/specs";
import { slug } from "@/lib/generate";
import type { GeneratedAsset } from "@/lib/types";

import type { Route } from "./+types/api.zip";

export async function action({ request }: Route.ActionArgs) {
  let assets: GeneratedAsset[];
  let companyName: string;

  try {
    const body = await request.json();
    assets = Array.isArray(body?.assets) ? body.assets : [];
    companyName = String(body?.companyName ?? "assets");
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (assets.length === 0) {
    return new Response(JSON.stringify({ error: "No assets to package." }), {
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

  archive.append(buildReadme(assets, companyName), { name: "README.txt" });
  archive.finalize();
  await done;

  const zip = Buffer.concat(chunks);
  const fileName = `${slug(companyName)}_amr-ad-assets.zip`;

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

  lines.push(`AMR Asset Studio — ${companyName}`);
  lines.push("=".repeat(60));
  lines.push("");
  lines.push(`Created: ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
  lines.push(`Assets: ${assets.length}`);
  lines.push(
    `Validation: ${allPass ? "all passed" : "some did not pass, see below"}`
  );
  lines.push("");
  lines.push(
    `These assets have been checked against Alma Media's display advertising specs.`
  );
  lines.push(`Source: ${specs.source.url}`);
  lines.push(`Specs fetched: ${specs.source.fetchedAt}`);
  lines.push("");
  if (specs.global.requireAiActLabel) {
    lines.push(`AI Act label: "${specs.global.aiActLabel}" is embedded`);
    lines.push(`in every asset as visible text.`);
    lines.push("");
  }
  lines.push("-".repeat(60));
  lines.push("ASSETS");
  lines.push("-".repeat(60));

  for (const a of assets) {
    lines.push("");
    lines.push(`${a.fileName}`);
    lines.push(
      `  ${a.formatName} · ${a.width}×${a.height} px · ${Math.round(
        a.fileSizeBytes / 1024
      )} kB · ${a.kind === "html5" ? "HTML5 animation" : "static"}`
    );
    lines.push(`  Headline: ${a.copy.headline}`);
    lines.push(`  Body:     ${a.copy.body}`);
    lines.push(`  CTA:      ${a.copy.cta}`);
    for (const c of a.validation.checks) {
      lines.push(
        `  ${c.pass ? "[OK]" : "[NO]"} ${c.label}${c.detail ? `: ${c.detail}` : ""}`
      );
    }
  }

  lines.push("");
  lines.push("-".repeat(60));
  lines.push("HTML5 ASSETS");
  lines.push("-".repeat(60));
  for (const n of specs.global.html5.notes) lines.push(`- ${n}`);
  lines.push("");
  lines.push(
    "The HTML5 files are self-contained: images and styles are embedded in the"
  );
  lines.push("file, so nothing is loaded from outside.");
  lines.push("");

  return lines.join("\n");
}
