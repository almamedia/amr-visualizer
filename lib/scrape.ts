import * as cheerio from "cheerio";
import { fetchWithTimeout } from "./assets";

export interface ScrapeResult {
  url: string;
  finalUrl: string;
  title: string;
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
  ogSiteName: string;
  /** Sivun näkyvä teksti, katkaistu. */
  text: string;
  logoCandidates: string[];
  imageCandidates: { url: string; alt: string }[];
  colorCandidates: { color: string; count: number }[];
  fontCandidates: string[];
  usedPlaywright: boolean;
  warnings: string[];
}

const TEXT_LIMIT = 6000;

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  const withProto = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  // Heittää jos ei kelvollinen — kutsuja käsittelee.
  const u = new URL(withProto);
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("Vain http- ja https-osoitteet ovat tuettuja.");
  }
  return u.toString();
}

function abs(base: string, href: string | undefined): string | null {
  if (!href) return null;
  const h = href.trim();
  if (!h || h.startsWith("data:") || h.startsWith("javascript:")) return null;
  try {
    return new URL(h, base).toString();
  } catch {
    return null;
  }
}

export async function scrape(rawUrl: string): Promise<ScrapeResult> {
  const url = normalizeUrl(rawUrl);
  const warnings: string[] = [];
  let html = "";
  let finalUrl = url;
  let usedPlaywright = false;

  try {
    const res = await fetchWithTimeout(url, 12000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    finalUrl = res.url || url;
    html = await res.text();
  } catch (e) {
    warnings.push(
      `Suora haku epäonnistui (${
        e instanceof Error ? e.message : "tuntematon virhe"
      }), kokeillaan selainrenderöintiä.`
    );
  }

  let $ = cheerio.load(html || "<html></html>");
  let visibleText = extractText($);

  // JS-raskaat sivut: liian vähän tekstiä → renderöi selaimella.
  if (!html || visibleText.length < 220) {
    const rendered = await renderWithPlaywright(url);
    if (rendered) {
      html = rendered.html;
      finalUrl = rendered.finalUrl;
      usedPlaywright = true;
      $ = cheerio.load(html);
      visibleText = extractText($);
    } else if (!html) {
      throw new Error(
        "Sivun sisältöä ei saatu haettua. Tarkista osoite ja yritä uudelleen."
      );
    } else {
      warnings.push("Sivulta löytyi vain vähän tekstiä.");
    }
  }

  const meta = (sel: string) =>
    ($(sel).attr("content") ?? "").trim();

  const result: ScrapeResult = {
    url,
    finalUrl,
    title: ($("title").first().text() ?? "").trim().slice(0, 200),
    metaDescription: meta('meta[name="description"]').slice(0, 400),
    ogTitle: meta('meta[property="og:title"]').slice(0, 200),
    ogDescription: meta('meta[property="og:description"]').slice(0, 400),
    ogSiteName: meta('meta[property="og:site_name"]').slice(0, 120),
    text: visibleText.slice(0, TEXT_LIMIT),
    logoCandidates: await verifyReachable(findLogos($, finalUrl)),
    imageCandidates: findImages($, finalUrl),
    colorCandidates: await findColors($, finalUrl, html),
    fontCandidates: findFonts(html),
    usedPlaywright,
    warnings,
  };

  return result;
}

function extractText($: cheerio.CheerioAPI): string {
  const clone = $.root().clone();
  clone.find("script,style,noscript,svg,iframe,nav,footer").remove();
  return clone
    .text()
    .replace(/\s+/g, " ")
    .trim();
}

async function renderWithPlaywright(
  url: string
): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      });
      await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
      const html = await page.content();
      return { html, finalUrl: page.url() };
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
}

/**
 * Pudota logoehdokkaat, jotka eivät oikeasti lataudu. Sivustoilla on usein
 * vanhentuneita favicon-viittauksia, ja rikkinäinen logo näkyisi käyttäjälle
 * tyhjänä ruutuna brändikortissa. Järjestys säilyy.
 */
async function verifyReachable(urls: string[]): Promise<string[]> {
  const checked = await Promise.all(
    urls.map(async (u) => {
      try {
        const r = await fetchWithTimeout(u, 5000);
        const ok =
          r.ok && (r.headers.get("content-type") ?? "").startsWith("image/");
        return ok ? u : null;
      } catch {
        return null;
      }
    })
  );
  return checked.filter((u): u is string => u !== null);
}

function findLogos($: cheerio.CheerioAPI, base: string): string[] {
  const out: string[] = [];
  const push = (u: string | null) => {
    if (u && !out.includes(u)) out.push(u);
  };

  // 1. <img> jonka polussa, altissa tai luokassa on "logo".
  $("img").each((_, el) => {
    const $el = $(el);
    const hay = [
      $el.attr("src"),
      $el.attr("alt"),
      $el.attr("class"),
      $el.attr("id"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (/logo|brand|wordmark/.test(hay)) {
      push(abs(base, $el.attr("src") ?? $el.attr("data-src")));
    }
  });

  // 2. Header-alueen ensimmäinen kuva.
  $("header img, .header img, #header img, .navbar img").each((i, el) => {
    if (i < 2) push(abs(base, $(el).attr("src")));
  });

  // 3. apple-touch-icon (yleensä isoin ja siistein ikoni).
  $('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').each(
    (_, el) => push(abs(base, $(el).attr("href")))
  );

  // 4. Favicon, isoin ilmoitettu koko ensin.
  const icons: { url: string; size: number }[] = [];
  $('link[rel~="icon"]').each((_, el) => {
    const u = abs(base, $(el).attr("href"));
    if (!u) return;
    const sizes = $(el).attr("sizes") ?? "";
    const n = parseInt(sizes.split("x")[0] ?? "0", 10) || 0;
    icons.push({ url: u, size: n });
  });
  icons.sort((a, b) => b.size - a.size).forEach((i) => push(i.url));

  // 5. og:image viimeisenä oljenkortena.
  push(abs(base, $('meta[property="og:image"]').attr("content")));

  // Monella sivustolla on sekä tavallinen että negaversio logosta. Mainokset
  // rakentuvat vaalealle pohjalle, joten valkoinen logo katoaisi taustaan —
  // pudota negaversiot listan hännille.
  const NEGATIVE = /white|valko|nega|negative|invert|inverted|light|reverse/i;
  return out
    .sort((a, b) => Number(NEGATIVE.test(a)) - Number(NEGATIVE.test(b)))
    .slice(0, 6);
}

const IMG_SKIP =
  /sprite|icon|favicon|logo|pixel|tracking|spacer|blank|1x1|placeholder|avatar|badge|banner|mainos|promo|kampanja|advert/i;

/** Mainospalvelimen polku, esim. /ad/1167/kuva.jpg tai /ads/kuva.jpg. */
const AD_PATH = /\/ads?\//i;

function findImages(
  $: cheerio.CheerioAPI,
  base: string
): { url: string; alt: string }[] {
  const seen = new Set<string>();
  const out: { url: string; alt: string }[] = [];

  const consider = (src: string | undefined, alt: string) => {
    const u = abs(base, src);
    if (!u || seen.has(u)) return;
    // Valmis mainos ei kelpaa uuden mainoksen kuvaksi: siinä on oma otsikko,
    // oma CTA ja usein eri verkko-osoite. Tiedostonimi tai /ad/-polku
    // paljastaa nämä ilmaiseksi, ennen kuin mallia tarvitsee kysyä.
    if (IMG_SKIP.test(u) || AD_PATH.test(u)) return;
    if (/\.svg($|\?)/i.test(u)) return; // SVG on yleensä ikoni, ei valokuva
    seen.add(u);
    out.push({ url: u, alt: alt.trim().slice(0, 140) });
  };

  $("img").each((_, el) => {
    const $el = $(el);
    const w = parseInt($el.attr("width") ?? "0", 10);
    const h = parseInt($el.attr("height") ?? "0", 10);
    // Pudota selvästi pienet (ikonit), mutta salli jos mittoja ei ilmoiteta.
    if ((w && w < 200) || (h && h < 150)) return;

    const srcset = $el.attr("srcset");
    if (srcset) {
      // Ota srcsetin viimeinen (yleensä suurin) vaihtoehto.
      const largest = srcset.split(",").pop()?.trim().split(/\s+/)[0];
      consider(largest, $el.attr("alt") ?? "");
    }
    consider(
      $el.attr("src") ?? $el.attr("data-src") ?? $el.attr("data-lazy-src"),
      $el.attr("alt") ?? ""
    );
  });

  // og:image vasta sisältökuvien jälkeen: se on usein jakokortti tai kollaasi,
  // joka rajautuu bannerissa huonosti. Otetaan mukaan varalta, ei ensisijaisena.
  const og = $('meta[property="og:image"]').attr("content");
  if (og && !IMG_SKIP.test(og)) consider(og, "");

  return out.slice(0, 14);
}

const HEX_RE = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const RGB_RE = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi;

async function findColors(
  $: cheerio.CheerioAPI,
  base: string,
  html: string
): Promise<{ color: string; count: number }[]> {
  let css = "";

  $("style").each((_, el) => {
    css += "\n" + $(el).text();
  });

  // Hae muutama ensimmäinen tyylitiedosto — sieltä löytyvät CSS-muuttujat.
  const sheets: string[] = [];
  $('link[rel="stylesheet"]').each((_, el) => {
    const u = abs(base, $(el).attr("href"));
    if (u) sheets.push(u);
  });

  const fetched = await Promise.all(
    sheets.slice(0, 4).map(async (u) => {
      try {
        const r = await fetchWithTimeout(u, 6000);
        if (!r.ok) return "";
        const t = await r.text();
        return t.slice(0, 400_000);
      } catch {
        return "";
      }
    })
  );
  css += "\n" + fetched.join("\n");

  // Inline style -attribuutit.
  $("[style]").each((_, el) => {
    css += "\n" + ($(el).attr("style") ?? "");
  });

  // CSS-muuttujat painotetaan: ne ovat lähes aina brändivärejä.
  const varDecls = css.match(/--[\w-]*(?:color|brand|primary|accent|bg|theme)[\w-]*\s*:\s*[^;]+/gi) ?? [];
  const weighted = css + "\n" + varDecls.join(";\n").repeat(6);

  const counts = new Map<string, number>();
  const bump = (hex: string, by = 1) => {
    const norm = normalizeHex(hex);
    if (!norm) return;
    counts.set(norm, (counts.get(norm) ?? 0) + by);
  };

  for (const m of weighted.matchAll(HEX_RE)) bump(m[0]);
  for (const m of weighted.matchAll(RGB_RE)) {
    bump(
      "#" +
        [m[1], m[2], m[3]]
          .map((v) => Math.min(255, parseInt(v, 10)).toString(16).padStart(2, "0"))
          .join("")
    );
  }

  // Suosi värejä, jotka esiintyvät myös HTML:ssä (teemavärit, brand-tagit).
  const themeColor = $('meta[name="theme-color"]').attr("content");
  if (themeColor) bump(themeColor, 25);
  for (const m of html.matchAll(HEX_RE)) bump(m[0], 0.2);

  return [...counts.entries()]
    .map(([color, count]) => ({ color, count: Math.round(count) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
}

function normalizeHex(hex: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1].toLowerCase();
  if (s.length === 3)
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  return "#" + s;
}

function findFonts(html: string): string[] {
  const out = new Set<string>();

  for (const m of html.matchAll(/font-family\s*:\s*([^;}"']+)/gi)) {
    const first = m[1]
      .split(",")[0]
      .replace(/["']/g, "")
      .trim();
    if (
      first &&
      first.length < 40 &&
      !/^(inherit|initial|unset|var\(|revert)/i.test(first)
    ) {
      out.add(first);
    }
  }

  // Google Fonts -linkit kertovat brändifontin suoraan.
  for (const m of html.matchAll(
    /fonts\.googleapis\.com\/css2?\?([^"'>]+)/gi
  )) {
    for (const f of m[1].matchAll(/family=([^&:]+)/gi)) {
      out.add(decodeURIComponent(f[1].replace(/\+/g, " ")));
    }
  }

  return [...out].slice(0, 12);
}
