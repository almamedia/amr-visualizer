/**
 * AMS Advertising Onboarding.
 *
 * Welcome → URL → Brand → Goal → Timeline → Audience → Budget → Plan.
 *
 * The order matters. We read the advertiser's website, tell them who we think
 * they are, and get that confirmed before asking a single question about the
 * campaign. Only once the plan is agreed do the creatives get made — and not
 * here: everything collected is packed into a creative brief and handed to the
 * asset studio, which is where ads are built.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "./+types/onboarding";
import "./onboarding.css";
import {
  audienceTypeOptions,
  budgetTiers,
  cities,
  durationOptions,
  flow,
  formatRequirements,
  goalOptions,
  hasProvisionalData,
  regionDisplayName,
  regions,
  specsUrl,
} from "@/lib/onboarding/catalog";
import {
  formatCount,
  formatEur,
  recommend,
  suggestedGoal,
  suggestedRegionId,
} from "@/lib/onboarding/recommend";
import {
  BRIEF_STORAGE_KEY,
  briefAsText,
  buildCreativeBrief,
} from "@/lib/onboarding/brief";
import type {
  AnalysisState,
  AudienceTypeId,
  BudgetTierId,
  BusinessSignals,
  ConfirmedBusiness,
  DurationId,
  FlowAnswers,
  GeographyMode,
  GoalId,
  StartMode,
} from "@/lib/onboarding/types";
import { ContentTypeSelect } from "@/app/components/content-type-select";
import { LocationSelect } from "@/app/components/location-select";
import { MultiSelect } from "@/app/components/multi-select";
import {
  categoryFromContentType,
  resolveContentTypePicks,
} from "@/lib/content-taxonomy";
import {
  isNationalReach,
  locationKind,
  resolveLocationPicks,
} from "@/lib/geography";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Advertise with Alma — find where to start" },
    {
      name: "description",
      content:
        "Answer a few questions and get a recommendation for the right channels, ad formats and budget for your business.",
    },
  ];
}

type Step =
  | "welcome"
  | "url"
  | "brand"
  | "goal"
  | "timeline"
  | "audience"
  | "budget"
  | "recommendation";

/**
 * The order of the flow.
 *
 * Nothing about the campaign is asked until we have shown the advertiser who
 * we think they are and they have said yes. The brand step therefore sits
 * directly after the analysis, and the creatives are not made here at all —
 * they come after the plan, in the asset studio.
 *
 * This departs from the PRD, which ran the analysis in the background and
 * confirmed it at the end (§7 6a) to avoid a wait. Confirming first means the
 * advertiser does wait on the scrape once, on the brand step.
 */
const ORDER: Step[] = [
  "welcome",
  "url",
  "brand",
  "goal",
  "timeline",
  "audience",
  "budget",
  "recommendation",
];

/** Steps the progress indicator counts. Skipping the URL drops the brand step. */
function questionSteps(urlSkipped: boolean): Step[] {
  const all: Step[] = ["url", "brand", "goal", "timeline", "audience", "budget"];
  return urlSkipped ? all.filter((s) => s !== "brand") : all;
}

/** Past this the scrape is treated as a failure and the flow moves on. */
const ANALYSIS_TIMEOUT_MS = 30000;

const EMPTY_ANSWERS: FlowAnswers = {
  url: "",
  urlSkipped: false,
  goal: null,
  timeline: { startMode: "asap", startDate: "", duration: "1-month" },
  audience: { geography: "finland", regionIds: [], cities: [], types: [] },
  budget: { tier: "small", customEur: null },
};

const EMPTY_BUSINESS: ConfirmedBusiness = {
  businessName: "",
  industry: "",
  contentType: "",
  contentTypeAlternatives: [],
  productsOrServices: "",
  location: "",
  locationAlternatives: [],
};

export default function OnboardingPage() {
  const [step, setStep] = useState<Step>("welcome");
  const [answers, setAnswers] = useState<FlowAnswers>(EMPTY_ANSWERS);
  const [analysis, setAnalysis] = useState<AnalysisState>({
    status: "idle",
    signals: null,
    brand: null,
  });

  /** What the advertiser confirmed about themselves on the brand step. */
  const [business, setBusiness] = useState<ConfirmedBusiness>(EMPTY_BUSINESS);
  const [category, setCategory] =
    useState<BusinessSignals["category"]>("other");

  const patch = useCallback(
    (part: Partial<FlowAnswers>) => setAnswers((a) => ({ ...a, ...part })),
    []
  );

  const go = useCallback((to: Step) => {
    setStep(to);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  /** There is nothing to confirm when the advertiser gave us no address. */
  const skipsBrand = answers.urlSkipped;

  const move = useCallback(
    (delta: 1 | -1) => {
      let i = ORDER.indexOf(step) + delta;
      if (ORDER[i] === "brand" && skipsBrand) i += delta;
      go(ORDER[Math.min(Math.max(i, 0), ORDER.length - 1)]);
    },
    [step, go, skipsBrand]
  );

  const next = useCallback(() => move(1), [move]);
  const back = useCallback(() => move(-1), [move]);

  /**
   * Kicked off the moment the address is submitted. The brand step waits on
   * it, so the sooner it starts the shorter that wait is.
   */
  const startAnalysis = useCallback((url: string) => {
    setAnalysis({ status: "running", signals: null, brand: null });
    fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    })
      .then((r) => r.json())
      .then((data) => {
        setAnalysis({
          status: data?.signals || data?.brand ? "ready" : "failed",
          signals: (data?.signals as BusinessSignals) ?? null,
          brand: data?.brand ?? null,
        });
      })
      .catch(() => {
        setAnalysis({ status: "failed", signals: null, brand: null });
      });

    // A scrape that never lands must not strand the advertiser on one screen.
    setTimeout(() => {
      setAnalysis((a) =>
        a.status === "running" ? { ...a, status: "failed" } : a
      );
    }, ANALYSIS_TIMEOUT_MS);
  }, []);

  const steps = questionSteps(skipsBrand);
  const stepIndex = steps.indexOf(step);

  return (
    <div className="ob">
      <div className="ob-top">
        <img src="/alma-logo-black.png" alt="Alma" />
        {analysis.status === "running" && step === "url" && (
          <span className="ob-ticker" role="status">
            <span className="spinner" />
            Reading your website…
          </span>
        )}
      </div>

      {stepIndex >= 0 && <Progress index={stepIndex} total={steps.length} />}

      {step === "welcome" && <Welcome onStart={next} />}

      {step === "url" && (
        <UrlStep
          url={answers.url}
          onChange={(url) => patch({ url })}
          onContinue={() => {
            patch({ urlSkipped: false });
            startAnalysis(answers.url);
            go("brand");
          }}
          onSkip={() => {
            patch({ urlSkipped: true, url: "" });
            setAnalysis({ status: "idle", signals: null, brand: null });
            go("goal");
          }}
          onBack={back}
        />
      )}

      {step === "brand" && (
        <BrandStep
          analysis={analysis}
          business={business}
          onBusinessChange={setBusiness}
          onCategoryChange={setCategory}
          onNext={next}
          onBack={back}
          onRetry={() => startAnalysis(answers.url)}
        />
      )}

      {step === "goal" && (
        <GoalStep
          value={answers.goal}
          suggestion={suggestedGoal(analysis.signals)}
          onChange={(goal) => patch({ goal })}
          onNext={next}
          onBack={back}
        />
      )}

      {step === "timeline" && (
        <TimelineStep
          value={answers.timeline}
          onChange={(timeline) => patch({ timeline })}
          onNext={next}
          onBack={back}
        />
      )}

      {step === "audience" && (
        <AudienceStep
          value={answers.audience}
          suggestedRegion={suggestedRegionId(analysis.signals)}
          onChange={(audience) => patch({ audience })}
          onNext={next}
          onBack={back}
        />
      )}

      {step === "budget" && (
        <BudgetStep
          value={answers.budget}
          onChange={(budget) => patch({ budget })}
          onNext={next}
          onBack={back}
        />
      )}

      {step === "recommendation" && (
        <RecommendationStep
          answers={answers}
          analysis={analysis}
          business={business}
          category={category}
          onBack={back}
          onRestart={() => {
            setAnswers(EMPTY_ANSWERS);
            setAnalysis({ status: "idle", signals: null, brand: null });
            setBusiness(EMPTY_BUSINESS);
            setCategory("other");
            go("welcome");
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------- chrome

function Progress({ index, total }: { index: number; total: number }) {
  const pct = ((index + 1) / total) * 100;
  return (
    <div className="ob-progress">
      <span className="ob-progress-label">
        Step {index + 1} of {total}
      </span>
      <div
        className="ob-progress-track"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={index + 1}
        aria-label={`Step ${index + 1} of ${total}`}
      >
        <div className="ob-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * The coaching panel. Directional statements only — no percentages, no
 * urgency (PRD Appendix A).
 */
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="ob-tip">
      <span className="ob-tip-mark" aria-hidden="true">
        ✦
      </span>
      <span>{children}</span>
    </div>
  );
}

function OptionCard({
  selected,
  label,
  hint,
  onClick,
  disabled,
  suggested,
}: {
  selected: boolean;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  /** The website hinted at this one. Highlighted, never pre-selected. */
  suggested?: boolean;
}) {
  return (
    <button
      type="button"
      className={`ob-option ${selected ? "selected" : ""} ${
        suggested && !selected ? "suggested" : ""
      }`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
      {hint && <small>{hint}</small>}
      {suggested && (
        <span className="ob-suggest">
          Based on your website, this might be a good fit.
        </span>
      )}
    </button>
  );
}

function Nav({
  onNext,
  onBack,
  nextLabel = "Continue",
  nextDisabled,
  children,
}: {
  onNext?: () => void;
  onBack?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="ob-nav">
      {onNext && (
        <button type="button" onClick={onNext} disabled={nextDisabled}>
          {nextLabel}
        </button>
      )}
      {onBack && (
        <button type="button" className="ghost" onClick={onBack}>
          Back
        </button>
      )}
      {children}
    </div>
  );
}

// ------------------------------------------------------------- step 0

function Welcome({ onStart }: { onStart: () => void }) {
  const c = flow.welcome;
  return (
    <div className="ob-card ob-hero">
      <h1>{c.headline}</h1>
      <p>{c.sub}</p>
      <button type="button" onClick={onStart}>
        {c.cta}
      </button>
      <span className="ob-noaccount">{c.noAccount}</span>
      <p className="ob-credibility">{c.credibility}</p>
    </div>
  );
}

// ------------------------------------------------------------- step 1

function UrlStep({
  url,
  onChange,
  onContinue,
  onSkip,
  onBack,
}: {
  url: string;
  onChange: (v: string) => void;
  onContinue: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const c = flow.urlStep;
  return (
    <form
      className="ob-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim()) onContinue();
      }}
    >
      <h2 className="ob-q">{c.question}</h2>
      <p className="ob-sub">{c.helper}</p>

      <div className="ob-field">
        <label htmlFor="ob-url">Website address</label>
        <input
          id="ob-url"
          type="text"
          inputMode="url"
          autoComplete="url"
          value={url}
          placeholder={c.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>

      <div className="ob-nav">
        <button type="submit" disabled={!url.trim()}>
          {c.cta}
        </button>
        <button type="button" className="ghost" onClick={onBack}>
          Back
        </button>
        <button type="button" className="ob-linkbtn" onClick={onSkip}>
          {c.skip}
        </button>
      </div>

      <Tip>{c.tip}</Tip>
    </form>
  );
}

// ------------------------------------------------------------- step 2

function GoalStep({
  value,
  suggestion,
  onChange,
  onNext,
  onBack,
}: {
  value: GoalId | null;
  suggestion: GoalId | null;
  onChange: (g: GoalId) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const c = flow.goalStep;
  return (
    <div className="ob-card">
      <h2 className="ob-q">{c.question}</h2>
      <p className="ob-sub">Pick the one that matters most right now.</p>

      <div className="ob-options stacked">
        {goalOptions.map((g) => (
          <OptionCard
            key={g.id}
            selected={value === g.id}
            suggested={suggestion === g.id}
            label={g.label}
            hint={g.hint}
            onClick={() => onChange(g.id)}
          />
        ))}
      </div>

      <Nav onNext={onNext} onBack={onBack} nextDisabled={!value} />
      <Tip>{c.tip}</Tip>
    </div>
  );
}

// ------------------------------------------------------------- step 3

function TimelineStep({
  value,
  onChange,
  onNext,
  onBack,
}: {
  value: FlowAnswers["timeline"];
  onChange: (v: FlowAnswers["timeline"]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const c = flow.timelineStep;
  const needsDate = value.startMode === "date";
  const ready = !needsDate || Boolean(value.startDate);

  return (
    <div className="ob-card">
      <h2 className="ob-q">{c.question}</h2>

      <fieldset className="ob-fieldset">
        <legend className="ob-legend">{c.startQuestion}</legend>
        <div className="ob-options two">
          {c.startOptions.map((o) => (
            <OptionCard
              key={o.id}
              selected={value.startMode === o.id}
              label={o.label}
              hint={o.hint}
              onClick={() =>
                onChange({ ...value, startMode: o.id as StartMode })
              }
            />
          ))}
        </div>

        {needsDate && (
          <div className="ob-field" style={{ marginTop: "var(--space-3)" }}>
            <label htmlFor="ob-start">Start date</label>
            <input
              id="ob-start"
              type="date"
              value={value.startDate}
              onChange={(e) => onChange({ ...value, startDate: e.target.value })}
            />
          </div>
        )}
      </fieldset>

      <fieldset className="ob-fieldset">
        <legend className="ob-legend">{c.durationQuestion}</legend>
        <div className="ob-options two">
          {durationOptions.map((d) => (
            <OptionCard
              key={d.id}
              selected={value.duration === d.id}
              label={d.label}
              hint={d.hint}
              onClick={() =>
                onChange({ ...value, duration: d.id as DurationId })
              }
            />
          ))}
        </div>
      </fieldset>

      <Nav onNext={onNext} onBack={onBack} nextDisabled={!ready} />
      <Tip>{c.tip}</Tip>
    </div>
  );
}

// ------------------------------------------------------------- step 4

const MAX_AUDIENCE_TYPES = 2;

function AudienceStep({
  value,
  suggestedRegion,
  onChange,
  onNext,
  onBack,
}: {
  value: FlowAnswers["audience"];
  suggestedRegion: string | null;
  onChange: (v: FlowAnswers["audience"]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const c = flow.audienceStep;

  // The website's own geography, applied once and always overridable.
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !suggestedRegion) return;
    applied.current = true;
    onChange({ ...value, geography: "region", regionIds: [suggestedRegion] });
    // Only ever runs on the first suggestion; value is intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedRegion]);

  const full = value.types.length >= MAX_AUDIENCE_TYPES;

  const toggleType = (id: AudienceTypeId) => {
    const has = value.types.includes(id);
    if (!has && full) return;
    onChange({
      ...value,
      types: has ? value.types.filter((t) => t !== id) : [...value.types, id],
    });
  };

  const ready =
    value.geography === "finland" ||
    (value.geography === "region" && value.regionIds.length > 0) ||
    (value.geography === "city" && value.cities.length > 0);

  const prefilled =
    suggestedRegion !== null &&
    value.geography === "region" &&
    value.regionIds.length === 1 &&
    value.regionIds[0] === suggestedRegion;

  return (
    <div className="ob-card">
      <h2 className="ob-q">{c.question}</h2>

      <fieldset className="ob-fieldset">
        <legend className="ob-legend">{c.geographyQuestion}</legend>
        <div className="ob-options three">
          {c.geographyOptions.map((o) => (
            <OptionCard
              key={o.id}
              selected={value.geography === o.id}
              label={o.label}
              hint={o.hint}
              onClick={() =>
                onChange({ ...value, geography: o.id as GeographyMode })
              }
            />
          ))}
        </div>

        {value.geography === "region" && (
          <div className="ob-field" style={{ marginTop: "var(--space-3)" }}>
            <label htmlFor="ob-region">Regions</label>
            <MultiSelect
              id="ob-region"
              label="Regions"
              values={value.regionIds}
              options={regions.map((r) => ({
                value: r.id,
                label: regionDisplayName(r),
              }))}
              placeholder="Select one or more regions"
              searchPlaceholder="Search regions"
              emptyText="No matching regions."
              onChange={(regionIds) => onChange({ ...value, regionIds })}
            />
            {prefilled && (
              <p className="ob-sub" style={{ margin: "var(--space-2) 0 0" }}>
                Based on your website. Change it if that&rsquo;s not right.
              </p>
            )}
          </div>
        )}

        {value.geography === "city" && (
          <div className="ob-field" style={{ marginTop: "var(--space-3)" }}>
            <label htmlFor="ob-city">Cities</label>
            <MultiSelect
              id="ob-city"
              label="Cities"
              values={value.cities}
              options={cities.map((city) => ({ value: city, label: city }))}
              placeholder="Select one or more cities"
              searchPlaceholder="Search cities"
              emptyText="No matching cities."
              allowCustom
              customLabel={(q) => `Add “${q}”`}
              onChange={(next) => onChange({ ...value, cities: next })}
            />
          </div>
        )}
      </fieldset>

      <fieldset className="ob-fieldset">
        <legend className="ob-legend">{c.typeQuestion}</legend>
        <p className="ob-sub" style={{ marginBottom: "var(--space-2)" }}>
          {c.typeHelper}
          {full ? " — that's two, unpick one to swap." : ""}
        </p>
        <div className="ob-options two">
          {audienceTypeOptions.map((t) => {
            const selected = value.types.includes(t.id);
            return (
              <OptionCard
                key={t.id}
                selected={selected}
                label={t.label}
                hint={t.hint}
                disabled={!selected && full}
                onClick={() => toggleType(t.id)}
              />
            );
          })}
        </div>
      </fieldset>

      <Nav onNext={onNext} onBack={onBack} nextDisabled={!ready} />
      <Tip>{c.tip}</Tip>
    </div>
  );
}

// ------------------------------------------------------------- step 5

function BudgetStep({
  value,
  onChange,
  onNext,
  onBack,
}: {
  value: FlowAnswers["budget"];
  onChange: (v: FlowAnswers["budget"]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const c = flow.budgetStep;
  const custom = value.tier === "custom";
  const ready = !custom || (value.customEur ?? 0) > 0;

  return (
    <div className="ob-card">
      <h2 className="ob-q">{c.question}</h2>
      <p className="ob-sub">{c.allTiersNote}</p>

      <div className="ob-options three">
        {budgetTiers.map((t) => (
          <OptionCard
            key={t.id}
            selected={value.tier === t.id}
            label={t.name}
            hint={
              t.minEur !== null && t.maxEur !== null
                ? `${formatEur(t.minEur)}–${formatEur(t.maxEur)} / month · ${t.hint}`
                : t.hint
            }
            onClick={() => onChange({ ...value, tier: t.id as BudgetTierId })}
          />
        ))}
      </div>

      {custom && (
        <div className="ob-field" style={{ marginTop: "var(--space-3)" }}>
          <label htmlFor="ob-custom">Your monthly budget (EUR)</label>
          <input
            id="ob-custom"
            type="number"
            min={0}
            step={50}
            inputMode="numeric"
            value={value.customEur ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                customEur: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
        </div>
      )}

      <p className="ob-sub" style={{ marginTop: "var(--space-3)" }}>
        {c.reassurance}
      </p>

      <Nav
        onNext={onNext}
        onBack={onBack}
        nextLabel="See my plan"
        nextDisabled={!ready}
      />
      <Tip>{c.tip}</Tip>
    </div>
  );
}

// -------------------------------------------------- step 2 · who you are

/**
 * The advertiser sees who we think they are before we ask them anything about
 * a campaign. Nothing downstream — not the recommendation, not the ad copy —
 * runs on data they have not looked at.
 *
 * Brand assets are shown, not edited. Cropping a logo or dropping a photo is
 * work for the asset studio, which already does it well; here the only
 * question is whether we understood the business.
 */
function BrandStep({
  analysis,
  business,
  onBusinessChange,
  onCategoryChange,
  onNext,
  onBack,
  onRetry,
}: {
  analysis: AnalysisState;
  business: ConfirmedBusiness;
  onBusinessChange: (b: ConfirmedBusiness) => void;
  onCategoryChange: (c: BusinessSignals["category"]) => void;
  onNext: () => void;
  onBack: () => void;
  onRetry: () => void;
}) {
  const { status, signals, brand } = analysis;

  // Seed the form from the analysis the first time it lands. After that the
  // advertiser owns these fields and a re-render must not overwrite them.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || (!signals && !brand)) return;
    seeded.current = true;
    const content = resolveContentTypePicks(
      brand?.contentType || signals?.contentType || signals?.industry || "",
      brand?.contentTypeAlternatives ??
        signals?.contentTypeAlternatives ??
        []
    );
    const geo = resolveLocationPicks(
      signals?.geographicSignal || "",
      signals?.geographicAlternatives ?? []
    );
    onBusinessChange({
      businessName: signals?.businessName || brand?.companyName || "",
      industry: content.contentType || signals?.industry || "",
      contentType: content.contentType,
      contentTypeAlternatives: content.contentTypeAlternatives,
      productsOrServices:
        signals?.productsOrServices || brand?.description || "",
      location: geo.location,
      locationAlternatives: geo.locationAlternatives,
    });
    onCategoryChange(
      signals?.category ?? categoryFromContentType(content.contentType)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, brand]);

  if (status === "running") {
    return (
      <div className="ob-card">
        <h2 className="ob-q">Reading your website…</h2>
        <p className="ob-sub">
          We&rsquo;re working out what your business does, and picking up your
          logo, colours and photos while we&rsquo;re there. This takes a few
          seconds.
        </p>
        <span className="ob-ticker" role="status">
          <span className="spinner" />
          Still reading
        </span>
      </div>
    );
  }

  if (!signals && !brand) {
    return (
      <div className="ob-card">
        <h2 className="ob-q">We couldn&rsquo;t read your site</h2>
        <p className="ob-sub">
          No problem — nothing here depends on it. We&rsquo;ll build your plan
          from your own answers instead, and you can add your logo and colours
          when you make the ad.
        </p>
        <div className="ob-nav">
          <button type="button" onClick={onNext}>
            Continue
          </button>
          <button type="button" className="outline" onClick={onRetry}>
            Try again
          </button>
          <button type="button" className="ghost" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    );
  }

  const set = <K extends keyof ConfirmedBusiness>(
    k: K,
    v: ConfirmedBusiness[K]
  ) => onBusinessChange({ ...business, [k]: v });

  const palette = brand
    ? ([
        ["Primary", brand.colors.primary],
        ["Accent", brand.colors.accent],
        ["Secondary", brand.colors.secondary],
      ] as const)
    : [];
  const photoCount = brand?.images.filter((i) => i.enabled).length ?? 0;

  return (
    <div className="ob-card">
      <h2 className="ob-q">Here&rsquo;s what we found about your business</h2>
      <p className="ob-sub">
        Everything after this — where your ad runs, what it costs, what it says
        — is built on this. Correct anything that&rsquo;s off.
      </p>

      {signals?.summary && <p className="ob-summary">{signals.summary}</p>}

      <div className="ob-confirm-grid" style={{ marginTop: "var(--space-4)" }}>
        <div className="ob-field">
          <label htmlFor="ob-bn">Business name</label>
          <input
            id="ob-bn"
            type="text"
            value={business.businessName}
            onChange={(e) => set("businessName", e.target.value)}
          />
        </div>

        <div className="ob-field">
          <label htmlFor="content-type">Content type</label>
          <ContentTypeSelect
            value={business.contentType}
            alternatives={business.contentTypeAlternatives}
            onChange={(next) => {
              onBusinessChange({
                ...business,
                contentType: next.contentType,
                contentTypeAlternatives: next.contentTypeAlternatives,
                industry: next.contentType,
              });
              if (next.contentType) {
                onCategoryChange(categoryFromContentType(next.contentType));
              }
            }}
          />
        </div>

        <div className="ob-field full">
          <label htmlFor="ob-sell">What you sell or offer</label>
          <input
            id="ob-sell"
            type="text"
            value={business.productsOrServices}
            onChange={(e) => set("productsOrServices", e.target.value)}
          />
        </div>

        <div className="ob-field full">
          <label htmlFor="ob-loc">Where you operate</label>
          <LocationSelect
            id="ob-loc"
            value={business.location}
            alternatives={business.locationAlternatives}
            onChange={(next) =>
              onBusinessChange({
                ...business,
                location: next.location,
                locationAlternatives: next.locationAlternatives,
              })
            }
          />
        </div>
      </div>

      {(brand?.logoUrl || palette.length > 0) && (
        <div className="ob-assets">
          <h3 className="ob-legend">We also picked up your brand</h3>
          <div className="ob-assets-row">
            {brand?.logoUrl && (
              <div className="ob-logo">
                <img src={brand.logoUrl} alt={`${business.businessName} logo`} />
              </div>
            )}
            <div className="ob-swatches">
              {palette.map(([label, hex]) => (
                <div className="ob-swatch" key={label}>
                  <span
                    className="ob-swatch-chip"
                    style={{ background: hex }}
                    aria-hidden="true"
                  />
                  <span className="ob-swatch-label">
                    {label}
                    <br />
                    <span className="mono">{hex}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="ob-sub" style={{ margin: "var(--space-3) 0 0" }}>
            {photoCount > 0
              ? `Plus ${photoCount} photo${photoCount === 1 ? "" : "s"} from your site. `
              : ""}
            You&rsquo;ll be able to change any of this when you make the ad —
            that comes after the plan.
          </p>
        </div>
      )}

      <Nav
        onNext={onNext}
        onBack={onBack}
        nextLabel="That's us — next question"
        nextDisabled={!business.businessName.trim()}
      />
      <Tip>
        A recommendation is only as good as what it knows about you. The two
        minutes you spend correcting this are the two minutes that make the rest
        of it fit.
      </Tip>
    </div>
  );
}

// ---------------------------------------------------------- step 6 · plan

function RecommendationStep({
  answers,
  analysis,
  business,
  category,
  onBack,
  onRestart,
}: {
  answers: FlowAnswers;
  analysis: AnalysisState;
  business: ConfirmedBusiness;
  category: BusinessSignals["category"];
  onBack: () => void;
  onRestart: () => void;
}) {
  const c = flow.recommendationStep;

  // The advertiser already corrected this on the brand step, so their version
  // is what the engine sees — not what we originally read off the page.
  const effectiveSignals = useMemo<BusinessSignals | null>(() => {
    if (!analysis.signals) return null;
    return {
      ...analysis.signals,
      businessName: business.businessName,
      industry: business.contentType || business.industry,
      contentType: business.contentType,
      contentTypeAlternatives: business.contentTypeAlternatives,
      productsOrServices: business.productsOrServices,
      geographicSignal: business.location,
      geographicAlternatives: business.locationAlternatives,
      geographicKind: locationKind(business.location),
      national: isNationalReach(business.location),
      category,
    };
  }, [analysis.signals, business, category]);

  const recommendation = useMemo(
    () => recommend(answers, effectiveSignals),
    [answers, effectiveSignals]
  );

  return (
    <RecommendationPanels
      answers={answers}
      business={business}
      recommendation={recommendation}
      brand={analysis.brand}
      copy={c}
      onBack={onBack}
      onRestart={onRestart}
    />
  );
}

function RecommendationPanels({
  answers,
  business,
  recommendation,
  brand,
  copy,
  onBack,
  onRestart,
}: {
  answers: FlowAnswers;
  business: ConfirmedBusiness;
  recommendation: ReturnType<typeof recommend>;
  brand: AnalysisState["brand"];
  copy: typeof flow.recommendationStep;
  onBack: () => void;
  onRestart: () => void;
}) {
  const [email, setEmail] = useState("");
  const [specialist, setSpecialist] = useState(false);

  const reachLabel =
    recommendation.reach.unit === "clicks"
      ? "Estimated visits to your website each month"
      : "Estimated times your ad is seen each month";

  function handleCreateAd() {
    const brief = buildCreativeBrief(answers, business, recommendation, brand);
    try {
      sessionStorage.setItem(BRIEF_STORAGE_KEY, JSON.stringify(brief));
    } catch {
      // A blocked sessionStorage is not worth stopping the handoff for —
      // the studio simply starts from its own URL step instead.
    }
    window.location.href = "/";
  }

  const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
    "Your advertising recommendation"
  )}&body=${encodeURIComponent(briefAsText(business, recommendation))}`;

  return (
    <>
      <div className="ob-card ob-rec-head">
        <span className="eyebrow">Your advertising plan</span>
        <p className="ob-summary">{recommendation.summary}</p>
        {recommendation.notes.length > 0 && (
          <ul className="ob-notes">
            {recommendation.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="ob-card">
        <h3 className="ob-q" style={{ fontSize: "var(--text-h3)" }}>
          Where your ad should run
        </h3>
        <p className="ob-sub">
          {recommendation.channels.length === 1
            ? "One place, so your budget builds recognition instead of spreading thin."
            : "Two places that between them cover the people you described."}
        </p>

        {recommendation.channels.map((c) => (
          <div className="ob-channel" key={c.channel.id}>
            <span className="ob-channel-mark" aria-hidden="true">
              {c.channel.name.slice(0, 1)}
            </span>
            <div>
              <h4>{c.channel.name}</h4>
              <p>{c.channel.whyItFits}</p>
              {c.channel.monthlyReach && <p>{c.channel.monthlyReach}</p>}
              <span className="ob-tag">{c.channel.audienceTag}</span>
            </div>
            {recommendation.channels.length > 1 && (
              <span className="ob-share">
                {Math.round(c.budgetShare * 100)}%
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="ob-card">
        <h3 className="ob-q" style={{ fontSize: "var(--text-h3)" }}>
          The ad format that fits
        </h3>
        <p className="ob-sub">
          {recommendation.formats.length === 1
            ? "One format, chosen for your goal."
            : "Two formats that work together for your goal."}
        </p>

        {recommendation.formats.map((f) => (
          <div className="ob-format" key={f.format.id}>
            <h4>{f.format.smeName}</h4>
            <p className="ob-sub" style={{ margin: 0 }}>
              {f.rationale}
            </p>
            <dl>
              <div>
                <dt>Size</dt>
                <dd>{f.format.dimensions}</dd>
              </div>
              <div>
                <dt>Appears on</dt>
                <dd>{f.format.devices}</dd>
              </div>
              <div>
                <dt>How you pay</dt>
                <dd>{f.format.pricingCopy}</dd>
              </div>
            </dl>
          </div>
        ))}

        <p className="ob-sub" style={{ marginTop: "var(--space-3)" }}>
          <a href={specsUrl} target="_blank" rel="noreferrer">
            Full technical specs on almamedia.fi
          </a>
        </p>

        <details style={{ marginTop: "var(--space-2)" }}>
          <summary style={{ cursor: "pointer", fontSize: "var(--text-small)" }}>
            What your ad needs to include
          </summary>
          <ul className="ob-notes">
            {formatRequirements.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>

        <Tip>{copy.tip}</Tip>
      </div>

      <div className="ob-card">
        <div className="ob-reach">
          <span className="ob-reach-number">
            {formatCount(recommendation.reach.low)}–
            {formatCount(recommendation.reach.high)}
          </span>
          <span className="ob-reach-label">{reachLabel}</span>
          <span className="ob-reach-note">
            Based on your budget, target area and channels.{" "}
            {copy.reachDisclaimer}
          </span>
        </div>

        <div style={{ marginTop: "var(--space-4)" }}>
          <h3 className="ob-legend">Your budget</h3>
          <p style={{ margin: 0 }}>
            <strong>{recommendation.budget.tier.name}</strong> ·{" "}
            {recommendation.budget.display}
          </p>
          {recommendation.channels.length > 1 && (
            <p className="ob-sub" style={{ marginTop: "var(--space-2)" }}>
              Split{" "}
              {recommendation.channels
                .map(
                  (c) => `${Math.round(c.budgetShare * 100)}% ${c.channel.name}`
                )
                .join(" / ")}
              .
            </p>
          )}
        </div>
      </div>

      <div className="ob-card">
        <h3 className="ob-q" style={{ fontSize: "var(--text-h3)" }}>
          Ready when you are
        </h3>
        <p className="ob-sub">
          The plan is set, so now the ad gets made. Your business, your brand,
          your goal and the formats above all travel with you — you won&rsquo;t
          answer any of it twice.
        </p>

        <div className="ob-cta-row">
          <button type="button" onClick={handleCreateAd}>
            {copy.primaryCta}
          </button>
          <button
            type="button"
            className="outline"
            onClick={() => setSpecialist(true)}
          >
            {copy.secondaryCta}
          </button>
          <button type="button" className="ghost" onClick={onBack}>
            Back
          </button>
          <button type="button" className="ghost" onClick={onRestart}>
            Start over
          </button>
        </div>

        {specialist && (
          <p className="ob-devnote">
            <strong>Not connected yet.</strong> How this handoff works — a form,
            a calendar booking, or a direct email — is still open with AMS Sales
            Ops (PRD Open Question 4).
          </p>
        )}

        <div className="ob-email">
          <label htmlFor="ob-email" className="ob-legend" style={{ flexBasis: "100%" }}>
            {copy.emailCta}
          </label>
          <input
            id="ob-email"
            type="email"
            inputMode="email"
            value={email}
            placeholder="you@yourbusiness.fi"
            onChange={(e) => setEmail(e.target.value)}
          />
          <a href={mailto}>
            <button type="button" className="outline" disabled={!email.trim()}>
              Send
            </button>
          </a>
        </div>
        <p className="ob-sub" style={{ marginTop: "var(--space-2)" }}>
          This opens your own mail app with the summary already written. Sending
          from our side, and whether that needs a marketing opt-in, is still open
          with Legal.
        </p>

        {hasProvisionalData && (
          <p className="ob-devnote">
            <strong>For the AMS team:</strong> budget tiers, prices, channel
            reach and regional shares in this build are placeholders. Real
            figures go into <code>lib/onboarding/data/</code> — one file per
            owner — and every number on this screen follows.
          </p>
        )}
      </div>
    </>
  );
}
