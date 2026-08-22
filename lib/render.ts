import type { Browser } from "playwright";

/**
 * One shared browser for the whole process. Launching Playwright is slow
 * (~1 s), so it does not happen per asset. Hot reload in dev keeps the
 * instance alive through globalThis.
 */
const g = globalThis as unknown as { __amrBrowser?: Promise<Browser> };

async function getBrowser(): Promise<Browser> {
  if (!g.__amrBrowser) {
    g.__amrBrowser = import("playwright").then((pw) =>
      pw.chromium.launch({
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
      })
    );
  }
  try {
    const b = await g.__amrBrowser;
    if (b.isConnected()) return b;
  } catch {
    // The launch failed — try again from a clean slate.
  }
  g.__amrBrowser = undefined;
  return getBrowser();
}

export interface RenderResult {
  buffer: Buffer;
  /** "png" tai "jpg" — kumpi mahtui painorajaan. */
  fileType: "png" | "jpg";
  bytes: number;
  /** true jos ei mahtunut rajaan edes matalimmalla laadulla. */
  overLimit: boolean;
}

/**
 * Render HTML to an image. Tries PNG first (sharp, flat colour); if that
 * exceeds the weight limit it moves to JPEG and lowers quality until it fits.
 */
export async function renderToImage(
  html: string,
  width: number,
  height: number,
  maxBytes: number
): Promise<RenderResult> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce", // freezes CSS animations at their end state
  });
  const page = await context.newPage();

  try {
    await page.setContent(html, { waitUntil: "load", timeout: 15000 });
    // Make sure the fonts are ready before the screenshot.
    await page.evaluate(() => (document as any).fonts?.ready);

    const png = (await page.screenshot({ type: "png" })) as Buffer;
    if (png.byteLength <= maxBytes) {
      return {
        buffer: png,
        fileType: "png",
        bytes: png.byteLength,
        overLimit: false,
      };
    }

    let last = png;
    for (const quality of [88, 78, 68, 58, 45]) {
      const jpg = (await page.screenshot({ type: "jpeg", quality })) as Buffer;
      last = jpg;
      if (jpg.byteLength <= maxBytes) {
        return {
          buffer: jpg,
          fileType: "jpg",
          bytes: jpg.byteLength,
          overLimit: false,
        };
      }
    }

    return {
      buffer: last,
      fileType: "jpg",
      bytes: last.byteLength,
      overLimit: true,
    };
  } finally {
    await context.close();
  }
}

/**
 * Compress an image to the banner's size and weight budget. Without this a
 * photo lifted off a website can blow the 300 kB limit of an HTML5 package on
 * its own. Uses Playwright so no native image library is needed.
 */
export async function compressImage(
  dataUri: string,
  width: number,
  height: number,
  maxBytes: number
): Promise<string | null> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  try {
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>
         html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden}
         div{width:${width}px;height:${height}px;
             background:url("${dataUri}") center/cover no-repeat}
       </style><div></div>`,
      { waitUntil: "load", timeout: 15000 }
    );

    let last: Buffer | null = null;
    for (const quality of [82, 70, 60, 50, 40]) {
      const buf = (await page.screenshot({ type: "jpeg", quality })) as Buffer;
      last = buf;
      if (buf.byteLength <= maxBytes) {
        return `data:image/jpeg;base64,${buf.toString("base64")}`;
      }
    }
    // It did not fit the budget — better to drop the image than break the limit.
    return last && last.byteLength <= maxBytes * 1.35
      ? `data:image/jpeg;base64,${last.toString("base64")}`
      : null;
  } catch {
    return null;
  } finally {
    await context.close();
  }
}

/**
 * Measure a logo's average lightness across its opaque pixels.
 * Sites often carry a reversed-out logo (alma-logo-white.png) that loads
 * perfectly and then disappears on a light ground. A successful fetch is
 * therefore not a sufficient check — the pixels have to be looked at.
 * Returns null when the image cannot be analysed.
 */
export async function measureLuminance(
  dataUri: string
): Promise<number | null> {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: 64, height: 64 } });
  const page = await context.newPage();

  try {
    await page.setContent("<!doctype html><meta charset='utf-8'>", {
      waitUntil: "load",
      timeout: 10000,
    });

    return await page.evaluate(async (uri: string) => {
      const img = new Image();
      img.src = uri;
      try {
        await img.decode();
      } catch {
        return null;
      }
      const w = Math.min(img.naturalWidth || 64, 64);
      const h = Math.min(img.naturalHeight || 64, 64);
      if (!w || !h) return null;

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);

      const { data } = ctx.getImageData(0, 0, w, h);
      let sum = 0;
      let weight = 0;
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3] / 255;
        if (alpha < 0.15) continue; // a transparent ground says nothing about the logo
        const lin = (c: number) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        const l =
          0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]);
        sum += l * alpha;
        weight += alpha;
      }
      return weight > 0 ? sum / weight : null;
    }, dataUri);
  } catch {
    return null;
  } finally {
    await context.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (!g.__amrBrowser) return;
  try {
    const b = await g.__amrBrowser;
    await b.close();
  } catch {
    // does not matter
  }
  g.__amrBrowser = undefined;
}
