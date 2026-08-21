# AMR Asset Studio

A browser tool where a small business owner enters their website address and
gets back finished display ads that meet Alma Media's spec requirements.

**The pipeline:** URL in → brand card confirmed → assets out.

## Getting started

```bash
npm install
npx playwright install chromium
npx remotion browser ensure          # needed for MP4 rendering
cp .env.local.example .env.local   # add ANTHROPIC_API_KEY
npm run dev
```

The app starts at `http://localhost:5173`.

To run a production build:

```bash
npm run build
npm start        # react-router-serve, port 3000 by default
```

### API key

The app **works without a key**: the brand card is then assembled straight from
the page structure (og tags, CSS variables, logo heuristics) and the copy comes
from set templates. The whole pipeline, validation and zip download still work.

The key raises the quality: Claude picks the real brand colour out of the
candidates, chooses images that suit advertising, condenses the core message,
and writes copy to match the goal. Add it to `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6   # optional, the default
```

The model is swappable. `claude-opus-5` produces clearly better copy and brand
analysis if quality matters more than speed.

## Architecture

One React Router 7 app (framework mode, Vite, SSR on), with no separate
backend. The APIs are resource routes: route modules that export a
`loader`/`action` and no default component.

```
/app
  root.tsx        the HTML document, globals.css, Archivo from Google Fonts
  routes.ts       the route table — paths are declared here, not in folder names
  /routes
    studio.tsx        "/"           the asset studio (input → brand → results)
    onboarding.tsx    "/onboarding" self-serve path through to a plan
    api.extract.ts    scrape + brand analysis   → brand card JSON
    api.analyze.ts    scrape → brand card + business signals
    api.generate.ts   copy + template render    → assets + validation
    api.video.ts      Remotion server render    → 10 s H.264 MP4
    api.validate.ts   spec check for one asset (+ GET = the specs)
    api.zip.ts        assets into a zip + README.txt
/lib
  /specs          AMR product specs as JSON + a read interface
  /templates      the HTML/CSS banner template, with brand + copy as variables
  scrape.ts       fetch + cheerio, Playwright fallback for JS-heavy pages
  claude.ts       brand analysis + copy generation, mock fallback without a key
  render.ts       Playwright → PNG/JPEG, one shared browser instance
  validate.ts     plain Node validation against the specs
  generate.ts     orchestration: images → copy → render → validation
  /video          shared Player/renderer composition, scenes and video formats
```

Run `npm run remotion` to open the video composition directly in Remotion
Studio. The application results screen embeds the same composition with
`@remotion/player`.

### Design system

The interface follows the AMR Design System (claude.ai/design, project "AMR
Design System"). The tokens are copied from the source into
[globals.css](app/globals.css):

- **Colour** — violet `#9F248F` and green `#28B78F` as equal primaries, olive
  `#C2C83D` only as a small accent. Tinted neutrals: paper `#FAF6F8`, ink
  `#1C0A19`.
- **Typography** — Archivo, fetched from Google Fonts in the `links` export of
  `app/root.tsx`. Two weights are in use: 800 (headings, buttons, labels) and
  400 (body); the design system allows at most two per composition.
- **Shape** — an 8-pixel grid, pill-shaped buttons (`radius: 999px`), 16 px
  card corners, a 7 px signature colour bar.
- **Mode** — A (Editorial Light). The tool is form-led, so a light paper ground
  reads better than Mode B's fully saturated violet, and ad previews sit more
  naturally on a neutral ground.

The design system has no token for an error colour — the palette is violet,
green and olive. Validation states are therefore solved inside the palette:
**green = passed**, **violet = needs attention**. Olive is never used for text,
because the design system forbids it on every ground.

**The design system does not govern the ads themselves.** They carry the
customer's brand, not Alma's: a hair salon's banner uses the salon's colours and
logo. [banner.ts](lib/templates/banner.ts) is left alone for that reason.

### Spec library

`lib/specs/display.json` is the **only** place dimensions, weight limits and
character limits live. All generation and validation reads from it; there are no
hard-coded values anywhere else.

Dimensions and maximum weights are Alma's official figures
([spec guidelines](https://www.almamedia.fi/mainostajat/aineisto-ohjeet/display-mainonnan-aineisto-ohjeet/),
fetched 2026-08-11). **The character limits are this tool's own**, based on
legibility — Alma specifies character limits only for Performance Native.

Format names are Alma's product names and are kept as they are: they are what a
media buyer actually books.

The three primary sizes in use (`"primary": true`):

| Format | Size | Max |
|---|---|---|
| Paraati | 980×400 | 300 kB |
| Pystyparaati | 300×600 | 300 kB |
| Performance Display | 600×600 | 300 kB |

The library also holds Mobiiliparaati, Boksi, Megaparaati and Tapetti ready to
go — a new size joins the run by switching its `primary` flag on.

### The banner's two modes

The modes come from the AMR Design System and are chosen automatically, based on
whether a usable image exists:

| Mode | When | Look |
|---|---|---|
| Editorial Light | An image was found | Light ground, the image carries the look |
| Bold | No image | Brand colour as the whole ground, counter-coloured text and CTA |

A coloured ground is not a matter of taste: the publisher's page is white
itself, so a white banner melts into it. With no image the empty surface would
also be large, so the typography grows to fill it.

The ground colour is the first of the brand's colours that is saturated enough
and dark enough to carry readable text. A near-white "brand colour" is usually a
picking error, and is not made into a ground.

### Checking the copy

On the results screen the copy is editable, and a counter shows the tightest
size's limit. An edit re-renders the assets **without calling Claude**, so in
about a second: [generate.ts](lib/generate.ts) uses the given text as-is when
`copyVariants` arrives with the request.

### The language of the ads

The interface, the code and the docs are English. The ads themselves follow one
constant, `COPY_LANGUAGE` in [claude.ts](lib/claude.ts), which is currently also
English.

This is a product decision rather than a translation detail. The ads run in
Alma's titles, which are read in Finnish, so English creative may well be the
wrong output even though the tool around it is English. Changing that one
constant puts the creative back into Finnish: the prompt follows it, and the
mock copy fallback would need its templates swapped to match.

## How quality is assured

- **Weight limit**: the renderer tries PNG first; if that goes over, it moves to
  JPEG and lowers quality until it fits. The source image is compressed
  separately to the banner's size, so the HTML5 package stays under the limit.
- **Character limits**: copy is generated to the **tightest** limits across the
  chosen sizes, so the same text fits every one of them.
- **Text fitting**: a character limit is only an estimate, because the same
  character count wraps differently at different sizes and word lengths vary
  widely. So the typography gives: during rendering the headline shrinks until
  the text fits its box both vertically and horizontally. Without this, a single
  character of overflow dropped a whole word in truncation, and one long
  compound word could be clipped at the edge.
- **The AI Act label is switched off.** That is an AMR decision: images are
  cropped rather than altered, and every line of copy is reviewed by a person
  before download. The label is implemented as a flag rather than deleted from
  the code: setting `requireAiActLabel` back to `true` in
  [display.json](lib/specs/display.json) restores it in the assets, in the
  validation and in the zip's README file.

  Worth noting for any review: ad headlines, body copy and CTAs are written
  entirely by the model — a disclosure duty would most likely attach to the
  text, not to cropped images. If the label is switched on for ads running in
  Finnish media, `aiActLabel` needs translating too: a disclosure has to read in
  the language of the ad.
- **HTML5**: the files are self-contained (images and styles embedded), load
  nothing from outside, and use no jQuery. Validation checks all three.
- **Image selection**: image candidates are sent to the model as images, not as
  bare URLs, so it can see what it is choosing. Finished ads are rejected: they
  carry their own headline, their own CTA and often a different web address, and
  cropping cuts their text mid-word. A free filter runs before the model and
  drops `/ad/` paths and filenames containing banner, mainos or promo. If no
  image is usable, the ad is built from type — better than the wrong image.
- **Contrast**: every asset is measured for text contrast against its ground
  (4.5:1 required) and for whether the CTA separates from the ground and carries
  readable text itself. The colours are resolved by the same function that
  renders them, so the check measures exactly what ends up in the asset.
- **Character set**: the model occasionally mixes Cyrillic homoglyphs in among
  the Latin ones (`piцца`). They look right at a glance but are broken text.
  Generation filters such variants out and asks again; on top of that every
  asset gets its own character-set check, which makes any slip visible.
- **Logo visibility**: sites often carry a reversed-out logo
  (`alma-logo-white.png`) that loads perfectly and then disappears on a light
  ground. The logo's pixels are measured and contrast is calculated against the
  background colour; if the logo does not separate, the company name is used as
  text instead and the user is warned. A successful fetch is not a sufficient
  check.

## The user's path

Three steps: input → brand card → assets. You can move in both directions
without losing anything:

- **Back** only changes the view. The address and the analysis survive, and
  **Continue to the brand card** appears on step one so you can move forward
  without another ~14 second analysis. Only **Start over** clears everything.
- **The main image** is chosen directly on the brand card: the assets use the
  first enabled image, and *Make main image* lifts the one you want to the top.
  Previously the only way was to remove every image ahead of it.
- **Waiting messages** say what the pipeline is doing ("Fetching your website…",
  "Fitting images to each size…"). They follow the real order of execution; no
  percentage is shown, because the server does not report progress.
- **What goes in the zip** is a choice. By default only the selected variant is
  included, so the recipient does not have to guess which of the three was the
  right one. All variants can go in for A/B testing.
- **At the end of the path** is a delivery card. Delivery is not connected, and
  the user is told so plainly — a placeholder does not pretend to work.

## Onboarding microsite (`/onboarding`)

A self-serve onboarding path sits in front of the studio, built to the PRD *AMS
Advertising Onboarding Tool* v0.1. It takes a small business owner from intent
to a plan in under five minutes:

```
Welcome → URL → Brand → Goal → Timeline → Audience → Budget → Plan
```

- **The brand is confirmed first.** The page is read, and the user is shown who
  their business is — name, industry, what they sell, where they operate, plus
  the logo and colour palette we found. Only once that is acknowledged is
  anything asked about the campaign. Everything later leans on it, so it is
  looked at first.
- **The creative is made last.** Onboarding does no creative work at all. It
  produces a plan, and the ads are made afterwards, in the studio.
- **The analysis is a visible wait.** The PRD ran the analysis in the background
  and confirmed it at the end (§7 6a) precisely to avoid that wait. Confirming
  first means the user waits once, on the brand step. The fetch starts the
  moment the address is submitted; after 30 seconds it is treated as failed and
  the path carries on without it.
- **The recommendation is rule-based**, not ML: the same answers always give the
  same result, and every rule can be explained in one sentence. The AI signals
  only *add* weight — they never remove a channel the user's own answer put on
  the table.
- **The numbers are placeholders.** Prices, budget tiers, channel reach and
  regional shares live in `lib/onboarding/data/` — one file per owner — and
  every figure on screen follows them. See `docs/task-fanout.md`.
- **A creative brief comes out of the far end** (PRD Appendix B) and travels to
  the studio under the `sessionStorage` key `ams.creativeBrief.v1`. The studio
  jumps straight to the brand card: the address is not asked twice, and the
  brand is not analysed again.

## Known limitations

- **Video is a local Remotion demo.** The results screen can preview and render
  a 10-second H.264 MP4 in Paraati, Pystyparaati and Boksi sizes. The `/api/video`
  route uses a cached server-side Remotion bundle. Production scaling, render
  queues and permanent asset storage are deliberately still unbuilt.
- **Image selection without an API key** takes the first images found on the
  page. The name- and path-based filter weeds out the obvious ads, but actually
  looking at images needs the model. The user drops a bad image on the brand
  card.
- **Spelling mistakes are not caught automatically.** The character-set check
  catches Cyrillic slips, but an ordinary typo goes through — in testing the
  model once wrote `lempipiazzasi` where it meant `lempipizzasi`. That is why
  the copy is editable on the results screen; read it before downloading.
- **Fonts** are mapped to system fonts, because Alma counts external font loads
  toward the file size limit. The brand font's name shows on the brand card, but
  rendering uses the closest system equivalent.
- **Browser launch loops forever** if Playwright's chromium binary is missing or
  does not match the installed version. `getBrowser()` (`lib/render.ts`) calls
  itself again after every failed launch with no attempt cap, so `/api/generate`
  never responds and the server logs no error. The fix is an attempt counter;
  until then, make sure you have run `npx playwright install chromium`.

## Tested

The pipeline has been run end to end against three real websites without an API
key:

| Site | Extraction | Assets | Validation |
|---|---|---|---|
| almamedia.fi | 0.7 s | 12 | 12/12 |
| kotipizza.fi | 3.7 s (Playwright) | 12 | 12/12 |
| fazer.fi | 2.1 s (Playwright) | 12 | 12/12 |

Twelve assets come out: three sizes × three copy variants, plus an HTML5
animation for each variant.

With a Claude key, extraction takes about 9 seconds and generation about 16, so
the whole pipeline runs in under half a minute. Without a key it is under 10
seconds, but the copy comes from set templates.
