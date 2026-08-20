import type { Browser } from "playwright";

/**
 * Yksi jaettu selain koko prosessille. Playwrightin käynnistys on hidas
 * (~1 s), joten sitä ei tehdä per aineisto. Dev-moden hot reload säilyttää
 * instanssin globalThisin kautta.
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
    // Käynnistys epäonnistui — yritä uudelleen puhtaalta pöydältä.
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
 * Renderöi HTML kuvaksi. Kokeilee ensin PNG:tä (terävä, tasaiset värit);
 * jos se ylittää painorajan, siirtyy JPEGiin ja laskee laatua kunnes mahtuu.
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
    reducedMotion: "reduce", // pysäyttää CSS-animaatiot loppuasentoon
  });
  const page = await context.newPage();

  try {
    await page.setContent(html, { waitUntil: "load", timeout: 15000 });
    // Varmista että fontit ovat valmiina ennen kuvakaappausta.
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
 * Pakkaa kuvan bannerin kokoon ja painobudjettiin. Ilman tätä sivulta poimittu
 * valokuva voi yksin ylittää 300 kt:n rajan HTML5-paketissa.
 * Käyttää Playwrightia, jotta natiivia kuvakirjastoa ei tarvita.
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
    // Ei mahtunut budjettiin — parempi jättää kuva pois kuin rikkoa painoraja.
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
 * Mittaa logon keskimääräisen vaaleuden läpinäkymättömistä pikseleistä.
 * Sivustoilla on usein negaversio logosta (alma-logo-white.png), joka latautuu
 * moitteettomasti mutta katoaa vaalealle pohjalle. Pelkkä latauksen
 * onnistuminen ei siis riitä tarkistukseksi — pitää katsoa itse pikselit.
 * Palauttaa null, jos kuvaa ei voi analysoida.
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
        if (alpha < 0.15) continue; // läpinäkyvä tausta ei kerro logon väristä
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
    // ei väliä
  }
  g.__amrBrowser = undefined;
}
