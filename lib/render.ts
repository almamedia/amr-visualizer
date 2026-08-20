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
    // Käynnistys epäonnistui, joten yritä uudelleen puhtaalta pöydältä.
  }
  g.__amrBrowser = undefined;
  return getBrowser();
}

export interface RenderResult {
  buffer: Buffer;
  /** "png" tai "jpg", kumpi mahtui painorajaan. */
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
    // Ei mahtunut budjettiin: parempi jättää kuva pois kuin rikkoa painoraja.
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
 * Osuus logon näkyvistä pikseleistä, jotka erottuvat annetusta pohjasta.
 *
 * Sivustoilla on usein negaversio logosta (alma-logo-white.png), joka latautuu
 * moitteettomasti mutta katoaa vaalealle pohjalle. Pelkkä latauksen
 * onnistuminen ei siis riitä tarkistukseksi, vaan pikselit on katsottava.
 *
 * Keskiluminanssi oli tähän väärä mittari. Moni logo on piirretty valkoisen
 * levyn päälle: kotipizza.fi:n SVG alkaa koko kuvan peittävällä
 * fill="#fff" -muodolla, joten keskiarvo on lähes valkoinen ja logo hylättiin,
 * vaikka sen tummanvihreä teksti näkyy vaalealla pohjalla moitteettomasti.
 * Oikea kysymys on "erottuuko logosta riittävä osa", ei "onko logo
 * keskimäärin eri väriä kuin pohja".
 *
 * Palauttaa null, jos kuvaa ei voi analysoida.
 */
export async function measureLogoVisibility(
  dataUri: string,
  groundHex: string
): Promise<number | null> {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: 64, height: 64 } });
  const page = await context.newPage();

  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const s = (groundHex || "#ffffff").replace("#", "");
  const groundLum =
    0.2126 * lin(parseInt(s.slice(0, 2), 16)) +
    0.7152 * lin(parseInt(s.slice(2, 4), 16)) +
    0.0722 * lin(parseInt(s.slice(4, 6), 16));

  try {
    await page.setContent("<!doctype html><meta charset='utf-8'>", {
      waitUntil: "load",
      timeout: 10000,
    });

    return await page.evaluate(
      async ({ uri, bgLum, minContrast }) => {
        const img = new Image();
        img.src = uri;
        try {
          await img.decode();
        } catch {
          return null;
        }
        // Isompi näyte kuin logon näkyvä koko: ohut teksti valkoisen levyn
        // päällä katoaa, jos kuva kutistetaan liian pieneksi ennen mittausta.
        const w = Math.min(img.naturalWidth || 128, 128);
        const h = Math.min(img.naturalHeight || 128, 128);
        if (!w || !h) return null;

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, w, h);

        const { data } = ctx.getImageData(0, 0, w, h);
        const lin = (c: number) => {
          const t = c / 255;
          return t <= 0.03928 ? t / 12.92 : Math.pow((t + 0.055) / 1.055, 2.4);
        };

        let visible = 0;
        let opaque = 0;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3] / 255;
          if (alpha < 0.15) continue; // läpinäkyvä tausta ei kerro logon väristä
          opaque++;
          const l =
            0.2126 * lin(data[i]) +
            0.7152 * lin(data[i + 1]) +
            0.0722 * lin(data[i + 2]);
          const hi = Math.max(l, bgLum);
          const lo = Math.min(l, bgLum);
          if ((hi + 0.05) / (lo + 0.05) >= minContrast) visible++;
        }
        return opaque > 0 ? visible / opaque : null;
      },
      { uri: dataUri, bgLum: groundLum, minContrast: 1.6 }
    );
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
