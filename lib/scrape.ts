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
  /** The page's visible text, truncated. */
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
  // Throws when invalid — the caller handles it.
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
      `The direct fetch failed (${
        e instanceof Error ? e.message : "tuntematon virhe"
      }), trying browser rendering instead.`
    );
  }

  let $ = cheerio.load(html || "<html></html>");
  let visibleText = extractText($);

  // JS-heavy pages: too little text → render it in a browser.
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
        "The page content could not be fetched. Check the address and try again."
      );
    } else {
      warnings.push("Only a little text was found on the page.");
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
    colorCandidates: await findColors($, finalUrl),
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
 * Drop logo candidates that do not actually load. Sites often carry stale
 * favicon references, and a broken logo would show the user an empty box on
 * the brand card. Order is preserved.
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

  // 2. The first image in the header area.
  $("header img, .header img, #header img, .navbar img").each((i, el) => {
    if (i < 2) push(abs(base, $(el).attr("src")));
  });

  // 3. apple-touch-icon (usually the largest and cleanest icon).
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

  // 5. og:image as a last resort.
  push(abs(base, $('meta[property="og:image"]').attr("content")));

  // Many sites carry both a normal and a reversed-out logo. Ads
  // are built on a light ground, so a white logo would vanish into it — push
  // the reversed-out versions to the tail of the list.
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
    // A finished ad is no good as the image inside a new ad: it has its own
    // headline, its own CTA and often a different web address. A filename or
    // an /ad/ path gives these away for free, before the model is asked.
    if (IMG_SKIP.test(u) || AD_PATH.test(u)) return;
    if (/\.svg($|\?)/i.test(u)) return; // an SVG is usually an icon, not a photo
    seen.add(u);
    out.push({ url: u, alt: alt.trim().slice(0, 140) });
  };

  $("img").each((_, el) => {
    const $el = $(el);
    const w = parseInt($el.attr("width") ?? "0", 10);
    const h = parseInt($el.attr("height") ?? "0", 10);
    // Drop the clearly small ones (icons), but allow images with no stated size.
    if ((w && w < 200) || (h && h < 150)) return;

    const srcset = $el.attr("srcset");
    if (srcset) {
      // Take the last (usually largest) option in the srcset.
      const largest = srcset.split(",").pop()?.trim().split(/\s+/)[0];
      consider(largest, $el.attr("alt") ?? "");
    }
    consider(
      $el.attr("src") ?? $el.attr("data-src") ?? $el.attr("data-lazy-src"),
      $el.attr("alt") ?? ""
    );
  });

  // og:image only after the content images: it is often a share card or collage,
  // joka rajautuu bannerissa huonosti. Otetaan mukaan varalta, ei ensisijaisena.
  const og = $('meta[property="og:image"]').attr("content");
  if (og && !IMG_SKIP.test(og)) consider(og, "");

  return out.slice(0, 14);
}

const HEX_RE = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const RGB_RE = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi;
const NON_BRAND_STYLESHEET =
  /(?:custom-twitter-feeds|social|share|facebook|linkedin|youtube|instagram)/i;

function stylesheetPriority(url: string, id: string, index: number): number {
  let score = -index * 0.01;

  // A site's own theme bundle is much more useful than whichever WordPress
  // plugin happened to enqueue its stylesheet first.
  if (/\/themes?\//i.test(url)) score += 100;
  if (/(?:^|[-_/])(main|site|brand|theme|style)(?:[-_.?/]|$)/i.test(`${id} ${url}`)) {
    score += 25;
  }

  // These can still be selected when a page has nothing better, but they
  // should not push the actual theme bundle outside the fetch limit.
  if (/(?:\/plugins?\/|\/wp-includes\/|fontawesome|google-fonts|\/npm\/|vendor)/i.test(url)) {
    score -= 40;
  }

  return score;
}

/**
 * WordPress injects its whole Gutenberg preset palette into every page, even
 * when none of those colours are used. Treating those declarations as brand
 * signals makes the stock vivid orange and amber beat the site's real palette.
 *
 * Remove only the declarations. A preset colour written directly into a
 * page-specific rule or inline style is still counted normally.
 */
function stripNonBrandColorSources(css: string): string {
  const withoutFrameworkPalettes = css.replace(
    /--wp(?:(?:--preset--)|(?:-(?:admin|components?)-))[\w-]+\s*:\s*[^;}]+;?/gi,
    ""
  );

  // Sharing widgets bring the identity colours of Twitter/X, Facebook,
  // LinkedIn and others into nearly every corporate site. They describe the
  // destination service, not the company whose page is being analysed.
  return withoutFrameworkPalettes.replace(
    /([^{}]+)\{([^{}]*)\}/g,
    (rule, selector: string) =>
      /(?:^|[-_.#\s])(social|share|twitter|facebook|linkedin|youtube|instagram)(?:[-_.#:\s]|$)/i.test(
        selector
      )
        ? ""
        : rule
  );
}

const DYNAMIC_PSEUDO =
  /:(?:active|any-link|autofill|checked|default|disabled|enabled|focus|focus-visible|focus-within|fullscreen|hover|indeterminate|invalid|link|optional|placeholder-shown|read-only|read-write|required|target|user-invalid|valid|visited)(?:\([^)]*\))?/gi;

/**
 * Turn an interactive selector into the element selector Cheerio can match.
 * `.button:hover::before` still proves that `.button` is present; the hover
 * state and generated pseudo-element do not exist in the static DOM.
 */
function staticSelector(selector: string): string {
  return selector
    .replace(/^[\s}]+/, "")
    .replace(/::[\w-]+(?:\([^)]*\))?/g, "")
    .replace(DYNAMIC_PSEUDO, "")
    .trim();
}

function selectorIsUsed($: cheerio.CheerioAPI, selectorList: string): boolean {
  return selectorList.split(",").some((raw) => {
    const selector = staticSelector(raw);
    if (
      !selector ||
      selector.startsWith("@") ||
      /^(?:from|to|\d+(?:\.\d+)?%)$/i.test(selector)
    ) {
      return false;
    }

    try {
      return $(selector).length > 0;
    } catch {
      // Browser-only or vendor selectors are not evidence that a rule is used.
      return false;
    }
  });
}

/** Return declarations only from CSS rules whose selector exists in the DOM. */
function findAppliedCss(
  $: cheerio.CheerioAPI,
  css: string
): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const declarations: string[] = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;

  for (const match of withoutComments.matchAll(ruleRe)) {
    if (selectorIsUsed($, match[1])) declarations.push(match[2]);
  }

  return declarations.join("\n");
}

async function findColors(
  $: cheerio.CheerioAPI,
  base: string
): Promise<{ color: string; count: number }[]> {
  let css = "";
  let inlineCss = "";

  $("style").each((_, el) => {
    css += "\n" + $(el).text();
  });

  // Fetch the first few stylesheets — that is where the CSS variables live.
  const sheets: { url: string; priority: number }[] = [];
  $('link[rel="stylesheet"]').each((index, el) => {
    const u = abs(base, $(el).attr("href"));
    // Social and sharing plugins carry the destination service's identity
    // colours (Twitter blue, LinkedIn blue, etc.), not this site's brand.
    if (u && !NON_BRAND_STYLESHEET.test(u)) {
      sheets.push({
        url: u,
        priority: stylesheetPriority(u, $(el).attr("id") ?? "", index),
      });
    }
  });

  sheets.sort((a, b) => b.priority - a.priority);

  const fetched = await Promise.all(
    sheets.slice(0, 6).map(async ({ url }) => {
      try {
        const r = await fetchWithTimeout(url, 6000);
        if (!r.ok) return "";
        const t = await r.text();
        return t.slice(0, 400_000);
      } catch {
        return "";
      }
    })
  );
  css += "\n" + fetched.join("\n");

  // Inline styles are applied by definition and do not need selector matching.
  $("[style]").each((_, el) => {
    inlineCss += "\n" + ($(el).attr("style") ?? "");
  });

  // Count only rules that can apply to the page's DOM. A downloaded component
  // library may define hundreds of unused success, warning and danger colours.
  const siteCss = stripNonBrandColorSources(css);
  const appliedCss = findAppliedCss($, siteCss) + inlineCss;

  // Site-specific variables used by matching rules are strong brand signals.
  const varDecls =
    appliedCss.match(
      /--[\w-]*(?:color|brand|primary|accent|bg|theme)[\w-]*\s*:\s*[^;]+/gi
    ) ?? [];
  // Large branded surfaces carry more visual identity than ordinary text
  // links. Give explicit background declarations a modest extra vote.
  const backgroundDecls =
    appliedCss.match(
      /(?:^|[;\n])\s*background(?:-color)?\s*:\s*[^;]+/gim
    ) ?? [];
  const weighted =
    appliedCss +
    "\n" +
    varDecls.join(";\n").repeat(6) +
    "\n" +
    backgroundDecls.join(";\n").repeat(2);

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

  // A declared browser theme colour is explicit page-level evidence.
  const themeColor = $('meta[name="theme-color"]').attr("content");
  if (themeColor) bump(themeColor, 25);

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

  // Google Fonts links name the brand font outright.
  for (const m of html.matchAll(
    /fonts\.googleapis\.com\/css2?\?([^"'>]+)/gi
  )) {
    for (const f of m[1].matchAll(/family=([^&:]+)/gi)) {
      out.add(decodeURIComponent(f[1].replace(/\+/g, " ")));
    }
  }

  return [...out].slice(0, 12);
}
