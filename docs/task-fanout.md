# Task fan-out — AMS Advertising Onboarding

The onboarding flow is built and running end to end:

```
Welcome → URL → Brand → Goal → Timeline → Audience → Budget → Plan
```

The advertiser confirms who they are before answering a single question about
the campaign, and no creative is made here at all — the plan comes first, and
the asset studio builds the ads from it afterwards.

What the flow does not yet have is **real numbers, real audience data, and a
real handoff at the far end**. Everything unfinished is listed below, assigned
to the discipline best placed to close it.

The build was deliberately arranged so that most of this work is *editing one
JSON file*, not touching the flow. Placeholder values are quarantined in
`lib/onboarding/data/`, one file per owner.

| File | Owner | What it holds |
|---|---|---|
| `data/channels.json` | Data | Channel audience profiles, editorial context |
| `data/formats.json` | Adtech | Formats, pricing, spec requirements |
| `data/regions.json` | Data | Regional audience shares, city list |
| `data/flow.json` | Design / content | Question copy, options, coaching tips, budget tiers |

Each of those files carries a `provisional: true` flag. While any is true, the
recommendation screen shows an internal note saying the figures are not real.
Flipping the flags off is the definition of done for the data work.

---

## Data

The recommendation is only as good as the audience data underneath it. Three of
these five are blocking — the flow currently invents nothing, but it also
promises nothing specific, and that is the gap.

**D1 · Channel audience profiles** — *blocking*
`lib/onboarding/data/channels.json`, PRD Appendix B.1, Open Question 3.
Fill age range, gender skew, income profile, geographic concentration and
monthly reach for Iltalehti, Kauppalehti and Etuovi. `monthlyReach` is
deliberately empty rather than estimated; the card hides the line until it is
filled, so nothing false ships in the meantime.

The field that matters most is **`editorialContext`** — the reader's mindset,
not their demographics. It is the one field that travels all the way into the
asset studio and shapes generated ad copy. Draft text is in the file already;
it needs a read from someone who knows the audience research. Same product,
different channel, different angle: that difference lives entirely in this
string.

**D2 · Regional audience split** — *blocking*
`lib/onboarding/data/regions.json`, PRD Appendix B.3.
`audienceShare` per bucket (Helsinki-Uusimaa, Pirkanmaa, Varsinais-Suomi, rest
of Finland) plus `cityFallbackShare`. Current values are population-directional
placeholders. Directional accuracy is enough — the output is a range.

**D3 · Region delivery modifier** — *blocking*
`regionModifier()` in `lib/onboarding/recommend.ts`.
Narrow targeting does not cut delivery in proportion to population: the budget
is unchanged, the inventory is just scarcer and priced higher. The build models
this as `0.55 + 0.45 × share`, which is a shape, not a measurement. Replace it
with real per-region factors, or tell us the relationship is different and we
will rewrite the function.

**D4 · Validate the reach estimator**
Back-test `low`–`high` against closed campaigns of comparable budget and
targeting. The spread is currently a flat ±20% (`RANGE_SPREAD`). If real
variance is wider at small budgets — likely — make the spread a function of
budget rather than a constant.

**D5 · Instrument the success metrics**
PRD §4 sets targets (completion rate >60%, time to recommendation <5 min, bounce
on step 1 <30%, recommendation-to-asset conversion >40%) and nothing currently
emits an event. Define the event schema — step entered, step completed, step
abandoned, analysis outcome, recommendation shown, CTA clicked — before the soft
launch, because the soft launch is the measurement.

---

## AI

The extraction pipeline works: `/api/analyze` returns structured signals from a
live Finnish site today. What it lacks is calibration and an owner.

**A1 · Own the extraction prompt** — *blocking*
`SIGNALS_SYSTEM` in `lib/claude.ts`, PRD Open Question 13.
Decide whether this lives in code or behind a versioned prompt layer. It is
currently a string in a source file, which is fine for a prototype and not fine
once someone needs to change extraction behaviour without a deploy.

**A2 · Calibrate the confidence floor** — *blocking*
`CONFIDENCE_FLOOR = 0.5` in `lib/onboarding/recommend.ts`.
Below this the analysis is discarded silently and the user never learns it
happened — which is the right behaviour and the wrong number, because 0.5 is a
guess. Build an eval set of ~30 Finnish SME sites with hand-labelled ground
truth (a salon, a regional clinic, a webshop, a B2B consultancy, a coming-soon
page, a login wall) and tune the floor so bad extractions are dropped and good
ones survive. The eval set is reusable for every later prompt change.

**A3 · Validate the category taxonomy**
Five buckets: `real-estate`, `b2b-professional`, `ecommerce`, `local-services`,
`other`. They exist because they map onto channel weighting, not because they
describe Finnish SMEs well. Check how much of the long tail lands in `other`;
if it is most of it, the taxonomy is doing no work.

**A4 · Cut the analysis wait** — *blocking*
PRD Open Question 12. This got more important when the flow changed. The brand
confirmation now sits directly after the URL step, so the advertiser **watches**
the scrape rather than answering questions through it — the PRD's
background-analysis design traded this wait away, and confirming first trades it
back. `/api/analyze` runs a scrape plus two Claude calls in parallel, and the
whole thing is in front of the user.

Measure p50/p95 against real Finnish SME sites and pick the model and effort per
call from that. The brand-card call is the expensive one and is only needed for
the studio handoff, so the strongest lever is splitting the route: return
signals as soon as they land, let the brand card finish in the background. The
30-second client timeout (`ANALYSIS_TIMEOUT_MS`) is a backstop so nobody gets
stranded — not a target, and far too long to be a good experience.

**A5 · Make editorial context actually change the copy**
This is the payoff of the whole brief handoff and it is not wired yet. The
studio's `generateCopy()` receives brand, goal and character limits. The brief
now also carries the recommended channel's editorial context — "professional,
analytical mindset" versus "browsing, emotionally receptive" — and nothing
reads it. Feed it into the copy prompt. A dental clinic on Kauppalehti should
not sound like the same clinic on Iltalehti.

---

## Adtech

Everything here is a number or a route AMS already owns internally. Most of it
is transcription, not invention — but the flow cannot go live without it.

**T1 · Pricing per format** — *blocking*
`data/formats.json` → `priceEur`, PRD Open Question 2, Appendix B.2.
CPC for the two Performance Display variants, CPM for the rest. Rough ranges
are fine; the estimate is shown as a range anyway. Server-side only — the SME
sees impressions and clicks, never a CPM.

**T2 · Budget tier ranges** — *blocking*
`data/flow.json` → `budgetStep.tiers`, PRD Open Question 1.
Small is currently 300–800 €/month and Medium 800–3 000 €/month, both invented.
These drive more than the copy on three cards: the tier boundary decides
whether an advertiser gets one channel or two, and whether CPM formats are
offered at all.

**T3 · Confirm format availability** — *blocking*
`data/formats.json` → `specFormatId`.
Välimainos and Interscroller are recommendable but have `specFormatId: null`,
meaning the asset studio cannot currently produce them — a recommendation the
next step can't fulfil. Either the studio gains those sizes (PRD Open Question
5) or the formats come out of v1. Right now neither is decided, so neither is
reachable by the current goal rules; that is luck, not design.

**T4 · Channel scope for v1**
PRD Open Question 3. Iltalehti, Kauppalehti and Etuovi are in. If anything else
is in scope it needs an entry in `channels.json` and a row in the audience-type
mapping in `flow.json`.

**T5 · Define the far end of the funnel**
PRD Open Questions 4 and 6. Two buttons currently admit they are not connected:
"Talk to an AMS specialist" and the email summary, which opens the user's own
mail client rather than pretending a backend exists. Decide the handoff — form,
calendar booking, or direct email — and whether inbound recommendations feed a
CRM.

**T6 · Own spec drift**
PRD Open Question 7. `data/formats.json` mirrors
`almamedia.fi/mainostajat/aineisto-ohjeet/`, and `lib/specs/display.json`
mirrors it a second time for the studio. When the spec page changes, both need
updating. Name the person, or the pair goes stale silently.

---

## Design

The flow is built against the design system already in `app/globals.css`, so
this is refinement rather than a blank page. Two of these are correctness
issues, not polish.

**S1 · Wireframes for all eight screens**
PRD §12 step 2. Mobile first — 375px is the primary width, desktop is the
adaptation. What exists is a working implementation; it has not been designed,
and two screens need real attention: the plan screen is four stacked cards in
the order the PRD happens to list them, and the brand confirmation screen is new
— it is not in the PRD, it carries a wait, and it is the screen that decides
whether the advertiser trusts everything after it.

**S2 · Accessibility audit** — *blocking*
PRD §9 requires WCAG 2.1 AA. The build labels every field, uses real fieldsets
and legends, sets `aria-pressed` on option cards and keeps targets at 48px. That
is the floor, not a pass. Needs: a contrast check across every state (the
coaching tip sits on olive-20, and the design system's own note says olive never
carries text), visible focus states, keyboard order through the card grids, and
a screen-reader pass on the progress indicator and the brand-step waiting
state.

**S3 · Design the coaching tip system**
PRD §9 and Appendix A. One tip per step lives in `data/flow.json`. The rule is
already written down and worth defending in review: directional statements, no
percentages, no urgency. "Longer campaigns build stronger brand recognition" is
durable; "improve recall by 40%" needs a source and expires. The tips need a
visual treatment that reads as a knowledgeable aside, not as help text.

**S4 · Recommendation screen hierarchy**
Decide what an SME sees before scrolling. The reach number is the answer to
their actual question — "is this worth it?" — and it is currently third.

**S5 · Channel identity**
Channel cards render a letter tile as a placeholder. Real logos, and a rule for
how they sit next to Alma's own mark on the same screen.

**S6 · Content pass, then prepare for Finnish**
Every user-facing string is in `data/flow.json` or inline in the page. v1 is
English (PRD §3); Finnish is v2. A content pass now is also the moment to pull
the remaining inline strings into the JSON so translation is a file, not a
grep.

---

## Not ours to close

Three PRD open questions need Legal or Compliance and belong to none of the four
disciplines. Flagging them because two are marked High and both touch code that
already runs:

- **Open Question 9** — data retention for scraped URL content. The build
  processes in real time and stores nothing server-side, which is probably the
  answer Legal wants, but it has not been asked.
- **Open Question 11** — GDPR basis for scraping the user's own URL.
- **Open Question 8** — whether the email summary needs a marketing opt-in.

---

## Suggested order

The blocking items gate a soft launch; the rest can run alongside.

1. **T1, T2, D1, D2** — without these the recommendation screen shows invented
   numbers, and that is the one thing it must never do.
2. **T3** — resolve the two formats that can be recommended but not produced.
3. **A2, A4, S2** — calibration, the analysis wait, and accessibility. All
   three now sit in front of real users on the brand step.
4. **A5** — the copy payoff; the thing that makes the handoff worth building.
5. **D5** — instrumentation, in place before the soft launch that measures it.
