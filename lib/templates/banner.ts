import { aiActLabel, requireAiActLabel } from "../specs";
import type { BrandCard, CopyVariant } from "../types";

export interface BannerInput {
  width: number;
  height: number;
  brand: BrandCard;
  copy: CopyVariant;
  /** Kuva data-URI:na tai null. */
  imageDataUri: string | null;
  /** Logo data-URI:na tai null. */
  logoDataUri: string | null;
  /** Lisää CSS-animaatiot (HTML5-versio). */
  animated: boolean;
}

type Layout = "wide" | "square" | "tall";

/** Fonttinimien mappaus järjestelmäfontteihin. Ei ulkoisia fonttilatauksia,
 *  koska Alma laskee ulkoiset fontit tiedostokokorajaan. */
function fontStack(name: string): string {
  const n = (name || "").toLowerCase();
  const serif =
    'Georgia, "Times New Roman", "Hoefler Text", Garamond, serif';
  const sans =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const mono = '"SF Mono", Menlo, Consolas, monospace';
  const condensed =
    '"Helvetica Neue Condensed", "Arial Narrow", Impact, sans-serif';

  if (/serif|georgia|times|garamond|playfair|merriweather|lora/.test(n))
    return serif;
  if (/mono|code|courier/.test(n)) return mono;
  if (/condensed|narrow|impact|oswald|bebas/.test(n)) return condensed;
  return sans;
}

function pickLayout(w: number, h: number): Layout {
  const r = w / h;
  if (r >= 1.6) return "wide";
  if (r >= 0.85) return "square";
  return "tall";
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return [255, 255, 255];
  let s = m[1];
  if (s.length === 3)
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const INK = "#141821";
const PAPER = "#ffffff";

/**
 * Valitse luettava tekstiväri taustaa vasten. Kiinteä luminanssikynnys ei
 * riitä: keskisävyinen väri kuten kulta (luminanssi ~0,35) jäi kynnyksen
 * alle ja sai valkoisen tekstin, jonka kontrasti on vain 2,6:1, kun tumma
 * teksti samalla pohjalla on 6,6:1. Verrataan siis kontrastit ja valitaan
 * parempi sen sijaan että arvattaisiin kynnyksellä.
 */
function readableOn(bg: string): string {
  return contrastRatio(PAPER, bg) >= contrastRatio(INK, bg) ? PAPER : INK;
}

function saturation(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

export type BannerMode = "light" | "bold";

export interface BannerColors {
  mode: BannerMode;
  ground: string;
  text: string;
  ctaBg: string;
  ctaText: string;
  accent: string;
}

/**
 * Ratkaisee bannerin värit. Sama funktio ajetaan sekä renderöinnissä että
 * validoinnissa, jotta kontrastitarkistus mittaa juuri niitä värejä, jotka
 * aineistoon päätyvät.
 *
 * Moodit tulevat AMR Design Systemistä:
 * - Editorial Light: vaalea pohja, kuva kantaa ilmeen.
 * - Bold: täyskylläinen brändiväri pohjana. Ilman kuvaa tämä on selvästi
 *   parempi, sillä valkoinen banneri katoaa julkaisijan valkoiselle sivulle,
 *   ja tyhjä pinta näyttää keskeneräiseltä.
 */
export function resolveBannerColors(
  brand: BrandCard,
  hasImage: boolean
): BannerColors {
  const bg = brand.colors.background || "#ffffff";
  const primary = brand.colors.primary || "#1a1a1a";
  const secondary = brand.colors.secondary || primary;
  const accent = brand.colors.accent || primary;
  const brandText = brand.colors.text || "#141821";

  if (hasImage) {
    const text =
      contrastRatio(brandText, bg) >= 4.5 ? brandText : readableOn(bg);
    const ctaBg = contrastRatio(accent, bg) >= 1.6 ? accent : primary;
    return {
      mode: "light",
      ground: bg,
      text,
      ctaBg,
      ctaText: readableOn(ctaBg),
      accent,
    };
  }

  // Värillinen pohja: riittävän kylläinen ja tarpeeksi tumma, jotta
  // tekstille löytyy luettava vastaväri. Lähes valkoinen "brändiväri" on
  // yleensä poimintavirhe, eikä siitä saa pohjaa.
  const ground =
    [primary, secondary, accent, brandText].find(
      (c) => saturation(c) > 0.18 && luminance(c) > 0.015 && luminance(c) < 0.7
    ) ??
    [brandText, primary].find((c) => luminance(c) < 0.35) ??
    primary;

  const text = readableOn(ground);

  // CTA erottuu pohjasta. Korostusväri kelpaa, jos se irtoaa pohjasta ja
  // kantaa itse luettavan tekstin; muuten käytetään vastapoolia.
  const accentWorks =
    contrastRatio(accent, ground) >= 2.2 &&
    contrastRatio(readableOn(accent), accent) >= 4.5;
  const ctaBg = accentWorks ? accent : text === "#ffffff" ? "#ffffff" : "#141821";

  return {
    mode: "bold",
    ground,
    text,
    ctaBg,
    ctaText: readableOn(ctaBg),
    accent,
  };
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function escapeHtml(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderBannerHtml(input: BannerInput): string {
  const { width: w, height: h, brand, copy, imageDataUri, logoDataUri } = input;
  const layout = pickLayout(w, h);

  const ref = layout === "wide" ? 980 : layout === "square" ? 600 : 300;
  const scale = w / ref;

  const pad = Math.round(Math.max(14, Math.min(w, h) * 0.065));
  const size = (base: number) => Math.max(9, Math.round(base * scale));

  const hasImage = Boolean(imageDataUri);

  // Ilman kuvaa teksti saa koko pinnan, joten se saa myös kasvaa. Muuten
  // banneriin jää iso tyhjä alue ja viesti jää heiveröiseksi.
  const fill = hasImage ? 1 : 1.24;

  const headlineSize = Math.round(
    (layout === "wide" ? size(40) : layout === "square" ? size(34) : size(26)) *
      fill
  );
  const bodySize = Math.round(
    (layout === "wide" ? size(17) : layout === "square" ? size(16) : size(14)) *
      (hasImage ? 1 : 1.12)
  );
  const ctaSize = Math.round(
    (layout === "wide" ? size(16) : layout === "square" ? size(15) : size(14)) *
      (hasImage ? 1 : 1.08)
  );
  const logoH =
    layout === "wide" ? size(34) : layout === "square" ? size(30) : size(24);

  const colors = resolveBannerColors(brand, hasImage);
  const bg = colors.ground;
  const primary = brand.colors.primary || "#1a1a1a";
  const { text, ctaBg, ctaText, accent } = colors;


  const headFont = fontStack(brand.fonts?.heading || "");
  const bodyFont = fontStack(brand.fonts?.body || "");

  // Kuvapinnan osuus layoutin mukaan.
  const mediaPct =
    layout === "wide" ? 44 : layout === "square" ? 46 : 38;

  const a = input.animated;
  const anim = (name: string, delay: number, dur = 0.6) =>
    a
      ? `animation:${name} ${dur}s cubic-bezier(.22,.61,.36,1) ${delay}s both;`
      : "";

  const labelSize = Math.max(8, Math.round(9 * Math.max(1, scale * 0.8)));

  // Merkintä voi osua valokuvan päälle, joten se saa oman taustalaatan
  // mainoksen omasta taustavärista, jotta se on luettava kuvan ja pohjan päällä.
  const aiLabelBg = rgba(bg, 0.88);
  const aiLabelText = rgba(text, 0.75);

  const mediaBlock = hasImage
    ? `<div class="media"><div class="img"></div></div>`
    : "";

  // Ilman kuvaa teksti saa koko pinnan.
  const contentFlex = hasImage ? `flex:0 0 ${100 - mediaPct}%;` : "flex:1 1 100%;";

  const flexDir = layout === "wide" ? "row" : "column";

  return `<!doctype html>
<html lang="fi">
<head>
<meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${w}px;height:${h}px;overflow:hidden}
  body{
    background:${bg};
    font-family:${bodyFont};
    color:${text};
    -webkit-font-smoothing:antialiased;
  }
  .ad{
    position:relative;
    width:${w}px;height:${h}px;
    display:flex;flex-direction:${flexDir};
    cursor:pointer;
    overflow:hidden;
  }
  .media{
    flex:0 0 ${mediaPct}%;
    position:relative;overflow:hidden;
    ${layout === "wide" ? "order:2;" : "order:1;"}
  }
  .img{
    position:absolute;inset:0;
    background-image:url("${imageDataUri ?? ""}");
    background-size:cover;background-position:center;
    ${a ? "animation:kenburns 9s ease-out both;" : ""}
  }
  /* Terävä raja kuvan ja tekstipinnan välillä. Häivytystä kokeiltiin, mutta
     poimittujen valokuvien tummat alueet muuttuivat sen läpi harmaaksi
     suttaumaksi, ja selkeä jako on ennustettavampi mielivaltaisilla kuvilla.
     Signature-väripalkkia ei piirretä värilliselle pohjalle: design system
     rajaa sen Mode A:han, eikä se erotu täyskylläiseltä pinnalta. */
  .media::after{
    content:"";position:absolute;z-index:1;
    ${
      layout === "wide"
        ? `top:0;bottom:0;left:0;width:${Math.max(2, Math.round(3 * scale))}px;`
        : `left:0;right:0;bottom:0;height:${Math.max(2, Math.round(3 * scale))}px;`
    }
    background:${ctaBg};
  }
  .content{
    ${contentFlex}
    ${layout === "wide" ? "order:1;" : "order:2;"}
    display:flex;flex-direction:column;
    justify-content:center;
    padding:${pad}px;
    gap:${Math.round(pad * 0.42)}px;
    position:relative;z-index:2;
    min-width:0;
    overflow:hidden;
  }
  .logo{
    height:${logoH}px;width:auto;max-width:62%;
    object-fit:contain;object-position:left center;
    ${anim("fadeUp", 0)}
  }
  .logo-text{
    font-family:${headFont};
    font-size:${Math.round(logoH * 0.62)}px;
    font-weight:800;letter-spacing:-.02em;
    color:${contrastRatio(primary, bg) >= 3 ? primary : text};
    ${anim("fadeUp", 0)}
  }
  h1{
    font-family:${headFont};
    font-size:${headlineSize}px;
    line-height:1.1;
    letter-spacing:-.022em;
    font-weight:800;
    /* Viimeinen suoja: jos yhdyssana ei mahdu pienimmälläkään koolla,
       se katkeaa rivin sisällä eikä leikkaudu reunasta pois. */
    overflow-wrap:anywhere;
    ${anim("fadeUp", 0.25)}
  }
  p.body{
    font-size:${bodySize}px;
    line-height:1.4;
    opacity:.86;
    ${anim("fadeUp", 0.45)}
  }
  .cta{
    align-self:flex-start;
    margin-top:${Math.round(pad * 0.25)}px;
    background:${ctaBg};
    color:${ctaText};
    font-size:${ctaSize}px;
    font-weight:700;
    letter-spacing:.005em;
    padding:${Math.round(ctaSize * 0.68)}px ${Math.round(ctaSize * 1.5)}px;
    border-radius:${Math.round(ctaSize * 0.42)}px;
    white-space:nowrap;
    ${anim("popIn", 0.68, 0.5)}
  }
  /* AI Act -merkintä on luettava myös valokuvan päällä: oma taustalaatta. */
  .aiact{
    position:absolute;
    right:${Math.round(pad * 0.42)}px;
    bottom:${Math.round(pad * 0.34)}px;
    z-index:5;
    font-size:${labelSize}px;
    line-height:1;
    letter-spacing:.01em;
    color:${aiLabelText};
    background:${aiLabelBg};
    padding:${Math.round(labelSize * 0.42)}px ${Math.round(labelSize * 0.62)}px;
    border-radius:${Math.round(labelSize * 0.4)}px;
    font-family:${bodyFont};
    white-space:nowrap;
    max-width:calc(100% - ${pad}px);
    overflow:hidden;
  }
  @keyframes fadeUp{
    from{opacity:0;transform:translateY(${Math.round(10 * scale)}px)}
    to{opacity:1;transform:none}
  }
  @keyframes popIn{
    0%{opacity:0;transform:scale(.9)}
    60%{opacity:1;transform:scale(1.03)}
    100%{opacity:1;transform:scale(1)}
  }
  @keyframes kenburns{
    from{transform:scale(1)}
    to{transform:scale(1.08)}
  }
</style>
</head>
<body>
  <div class="ad">
    ${mediaBlock}
    <div class="content">
      ${
        logoDataUri
          ? `<img class="logo" src="${logoDataUri}" alt="${escapeHtml(
              brand.companyName
            )}">`
          : `<div class="logo-text">${escapeHtml(brand.companyName)}</div>`
      }
      <h1>${escapeHtml(copy.headline)}</h1>
      <p class="body">${escapeHtml(copy.body)}</p>
      <div class="cta">${escapeHtml(copy.cta)}</div>
    </div>
    ${
      requireAiActLabel
        ? `<div class="aiact">${escapeHtml(aiActLabel)}</div>`
        : ""
    }
  </div>
<script>
/* Sovita teksti laatikkoon. Merkkiraja on arvio: suomen yhdyssanat vaihtelevat
   pituudeltaan rajusti, ja sama merkkimäärä taittuu eri tavalla eri kokoihin.
   Siksi typografia joustaa sen sijaan että teksti katkaistaisiin kesken:
   katkaisu pudottaisi kokonaisen sanan yhden merkin ylityksen takia.
   Ajetaan synkronisesti ennen load-tapahtumaa, joten kuvakaappaus näkee
   lopullisen asettelun. */
(function () {
  var box = document.querySelector('.content');
  var head = document.querySelector('h1');
  if (!box || !head) return;

  var cs = getComputedStyle(box);
  var avail =
    box.clientHeight -
    parseFloat(cs.paddingTop || 0) -
    parseFloat(cs.paddingBottom || 0);
  var gap = parseFloat(cs.rowGap || cs.gap || 0) || 0;

  function used() {
    var kids = box.children;
    var total = 0;
    for (var i = 0; i < kids.length; i++) {
      total += kids[i].getBoundingClientRect().height;
    }
    return total + Math.max(0, kids.length - 1) * gap;
  }

  /* Yksittäinen pitkä yhdyssana voi olla leveämpi kuin koko banneri, jolloin
     se leikkautuu reunasta vaikka korkeus riittäisi. Siksi mitataan
     molemmat suunnat. */
  function tooWide(el) {
    return el.scrollWidth > el.clientWidth + 1;
  }

  function overflows(el) {
    return used() > avail || tooWide(el);
  }

  function shrink(el, floorRatio, minPx) {
    var size = parseFloat(getComputedStyle(el).fontSize);
    var floor = Math.max(minPx, size * floorRatio);
    var guard = 0;
    while (overflows(el) && size > floor && guard++ < 80) {
      size -= 1;
      el.style.fontSize = size + 'px';
    }
  }

  /* Otsikko joustaa ensin, sillä se vie eniten tilaa ja kestää kutistamisen
     parhaiten. Leipäteksti vasta jos se ei riitä. */
  shrink(head, 0.6, 12);
  var body = document.querySelector('p.body');
  if (body && overflows(body)) shrink(body, 0.78, 10);
})();
</script>
</body>
</html>`;
}

/** Animaation kokonaiskesto sekunteina. Validointi vertaa tätä speksin rajaan. */
export const ANIMATION_DURATION_SECONDS = 9;
