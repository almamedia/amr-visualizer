import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "node:path";
import { VIDEO_COMPOSITION_ID } from "./remotion-root";
import type { VideoAdProps } from "./schema";

const globalCache = globalThis as unknown as {
  __amrRemotionBundle?: Promise<string>;
};

async function makeBundle(): Promise<string> {
  return bundle({
    entryPoint: path.join(process.cwd(), "lib/video/remotion-entry.tsx"),
    rootDir: process.cwd(),
    publicDir: path.join(process.cwd(), "public"),
    enableCaching: true,
  });
}

async function getBundle(): Promise<string> {
  if (process.env.NODE_ENV !== "production") return makeBundle();
  globalCache.__amrRemotionBundle ??= makeBundle().catch((error) => {
    globalCache.__amrRemotionBundle = undefined;
    throw error;
  });
  return globalCache.__amrRemotionBundle;
}

export async function renderVideoAd(inputProps: VideoAdProps): Promise<Buffer> {
  const serveUrl = await getBundle();
  const composition = await selectComposition({
    serveUrl,
    id: VIDEO_COMPOSITION_ID,
    inputProps,
    chromiumOptions: { disableWebSecurity: true },
  });
  const rendered = await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "h264",
    crf: 27,
    muted: true,
    imageFormat: "jpeg",
    jpegQuality: 84,
    concurrency: 1,
    chromiumOptions: { disableWebSecurity: true },
    outputLocation: null,
  });
  if (!rendered.buffer) throw new Error("Remotion returned no video data.");
  return rendered.buffer;
}
