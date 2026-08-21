import { useEffect, useMemo, useState } from "react";
import type { Route } from "./+types/studio";
import type {
  BrandCard,
  CopyVariant,
  GeneratedAsset,
  GoalId,
  TextLimits,
} from "@/lib/types";
import { BRIEF_STORAGE_KEY } from "@/lib/onboarding/brief";
import type { CreativeBrief, GoalId as BriefGoalId } from "@/lib/onboarding/types";
import { renderBannerHtml } from "@/lib/templates/banner";
import { normalizeBrandContentType } from "@/lib/content-taxonomy";
import { ContentTypeSelect } from "@/app/components/content-type-select";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "AMR Asset Studio" },
    {
      name: "description",
      content:
        "Enter your website address and get finished, spec-compliant display ads for Alma's titles.",
    },
  ];
}

type Phase = "input" | "brand" | "results";

/** Onboarding goal → studio campaign goal. Onboarding speaks the advertiser's
 *  language ("drive online sales"); the studio speaks the spec library's. */
const GOAL_FROM_BRIEF: Record<BriefGoalId, GoalId> = {
  awareness: "awareness",
  conversion: "offer",
  local: "awareness",
};

const GOALS: { id: GoalId; name: string; hint: string }[] = [
  { id: "awareness", name: "Awareness", hint: "Make yourself known" },
  { id: "offer", name: "Offer", hint: "Put a benefit or offer front and centre" },
  { id: "recruitment", name: "Recruitment", hint: "Attract people to apply" },
];

/** What each colour role actually does in the rendered banner — see
 *  resolveBannerColors() in lib/templates/banner.ts, which this mirrors. */
const COLOR_HINTS: Record<keyof BrandCard["colors"], string> = {
  primary: "The company name, and the background when there's no image.",
  accent: "The button, and the line beside the image.",
  secondary: "Backup colour for the background. Rarely seen.",
  background: "The background when there's an image.",
  text: "The headline and body text.",
};

/** Placeholder copy for the colour preview — real copy is written later, by
 *  Claude or the mock templates, once the goal is chosen and generation runs. */
const COLOR_PREVIEW_COPY: CopyVariant = {
  id: "preview",
  headline: "Your headline goes here",
  body: "",
  cta: "Button",
};

const COLOR_PREVIEW_WIDTH = 280;
const COLOR_PREVIEW_HEIGHT = 165;

export default function Studio() {
  const [phase, setPhase] = useState<Phase>("input");
  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState<GoalId>("awareness");

  const [brand, setBrand] = useState<BrandCard | null>(null);
  const [assets, setAssets] = useState<GeneratedAsset[]>([]);
  const [variants, setVariants] = useState<CopyVariant[]>([]);
  const [activeVariant, setActiveVariant] = useState("v1");
  const [limits, setLimits] = useState<TextLimits | null>(null);
  const [zipAll, setZipAll] = useState(false);
  const [delivered, setDelivered] = useState(false);
  const [booking, setBooking] = useState(false);
  const [bookResult, setBookResult] = useState<{
    lineItemId: number | null;
    warnings: string[];
  } | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);

  /** The brief handed over by the onboarding microsite. When it exists the
   *  page need not be analysed again — the brand card came with it. */
  const [brief, setBrief] = useState<CreativeBrief | null>(null);
  /** Recommended formats from the brief. Empty means the spec defaults. */
  const [formatIds, setFormatIds] = useState<string[] | undefined>(undefined);

  const [busy, setBusy] = useState<null | "extract" | "generate" | "zip">(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [aiEnabled, setAiEnabled] = useState(true);

  /** Pick up the brief onboarding left, once on load, and jump straight to the
   *  brand card check: the user has already given us the address. */
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(BRIEF_STORAGE_KEY);
      if (raw) sessionStorage.removeItem(BRIEF_STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;

    try {
      const incoming = JSON.parse(raw) as CreativeBrief;
      setBrief(incoming);
      setGoal(GOAL_FROM_BRIEF[incoming.goal.id] ?? "awareness");

      const wanted = incoming.formats
        .map((f) => f.specFormatId)
        .filter((id): id is string => Boolean(id));
      if (wanted.length) setFormatIds(wanted);

      if (incoming.brand) {
        setBrand(normalizeBrandContentType(incoming.brand));
        setUrl(incoming.brand.sourceUrl);
        setPhase("brand");
      }
    } catch {
      // A broken brief must not block normal use of the studio.
    }
  }, []);

  async function handleExtract(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setWarnings([]);
    setBusy("extract");
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed.");

      setBrand(normalizeBrandContentType(data.brand));
      setAiEnabled(data.meta?.aiEnabled ?? true);
      setWarnings(data.brand?.warnings ?? []);
      setPhase("brand");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tuntematon virhe.");
    } finally {
      setBusy(null);
    }
  }

  async function handleGenerate() {
    if (!brand) return;
    setError(null);
    setBusy("generate");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brand, goalId: goal, formatIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed.");

      setAssets(data.assets);
      setVariants(data.copyVariants);
      setLimits(data.limits ?? null);
      setActiveVariant(data.copyVariants[0]?.id ?? "v1");
      setWarnings(data.warnings ?? []);
      setPhase("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tuntematon virhe.");
    } finally {
      setBusy(null);
    }
  }

  /** Re-render the assets with hand-edited copy. Claude is not called, so this
   *  is clearly faster than the first generation. */
  async function handleCopyEdit(edited: CopyVariant) {
    if (!brand) return;
    const next = variants.map((v) => (v.id === edited.id ? edited : v));
    setError(null);
    setBusy("generate");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brand, goalId: goal, copyVariants: next, formatIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed.");

      setAssets(data.assets);
      setVariants(data.copyVariants);
      setLimits(data.limits ?? null);
      setWarnings(data.warnings ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tuntematon virhe.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Book the finished ad into the adserver. Only possible when the user came
   * through onboarding: the brief is what carries the dates, budget and
   * targeting a line item needs. Without one the button says so instead.
   */
  async function deliver() {
    if (!brief?.booking) {
      setDelivered(true);
      return;
    }

    setBooking(true);
    setBookError(null);
    try {
      // Only the variant the user settled on is booked — the other two were
      // alternatives, not extra ads to run.
      const chosen = assets.filter((a) => a.id.endsWith(`-${activeVariant}`));
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief, assets: chosen }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "The booking failed.");
      setBookResult({ lineItemId: data.lineItemId, warnings: data.warnings ?? [] });
    } catch (e) {
      setBookError(e instanceof Error ? e.message : "The booking failed.");
    } finally {
      setBooking(false);
    }
  }

  async function handleZip() {
    if (!brand) return;
    setBusy("zip");
    setError(null);
    try {
      // By default only the selected variant goes in: the recipient should
      // not have to guess which of the three was the right one.
      const packed = zipAll
        ? assets
        : assets.filter((a) => a.id.endsWith(`-${activeVariant}`));

      const res = await fetch("/api/zip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assets: packed, companyName: brand.companyName }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Building the zip package failed.");
      }
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "amr-ad-assets.zip";
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setBusy(null);
    }
  }

  /** Clears everything and returns to the start. Only "Start over" uses this. */
  function reset() {
    setPhase("input");
    setUrl("");
    setBrand(null);
    setAssets([]);
    setVariants([]);
    setWarnings([]);
    setError(null);
  }

  /** Go back a step with everything intact. "Back" used to call reset, which
   *  lost the address and the whole analysis — a user going back expects to go
   *  back, not to start over. */
  function back(to: Phase) {
    setError(null);
    setPhase(to);
  }

  const shown = useMemo(
    () => assets.filter((a) => a.id.endsWith(`-${activeVariant}`)),
    [assets, activeVariant]
  );

  const allPass = assets.length > 0 && assets.every((a) => a.validation.pass);

  return (
    <div className="wrap">
      <header className="masthead">
        {/* Logo: pieni, vasemmalla, tukee otsikkoa — ei koskaan sankari.
            Musta versio, koska pohja on vaalea paperi. */}
        <img className="logo" src="/alma-logo-black.png" alt="Alma" />
        <div>
          <h1>Asset Studio</h1>
          <p>
            Enter your website address and get finished, spec-compliant display
            ads for Alma's titles.
          </p>
        </div>
      </header>

      <div className="steps">
        <span className={`step ${stepClass(phase, "input")}`}>1 · Input</span>
        <span className={`step ${stepClass(phase, "brand")}`}>
          2 · Brand card
        </span>
        <span className={`step ${stepClass(phase, "results")}`}>
          3 · Assets
        </span>
      </div>

      {!aiEnabled && (
        <div className="notice warn">
          <strong>AI analysis is switched off.</strong> The assets still get
          made: the brand is read straight off the page structure and the copy
          comes from set templates. The result is rougher, and every field is
          editable.
          <span className="devhint">
            For developers: add <code>ANTHROPIC_API_KEY</code> to{" "}
            <code>.env.local</code> and restart the server.
          </span>
        </div>
      )}

      {/* We arrived from onboarding with a finished plan: say what has already
          been decided, so nobody wonders where the data came from. */}
      {brief && (
        <div className="notice">
          <strong>Continuing from your plan.</strong> Goal: {brief.goal.label}.
          Recommended ad sizes:{" "}
          {brief.formats.map((f) => f.smeName).join(", ")}. Your brand card is
          already filled in — check it and carry on.
        </div>
      )}

      {error && <div className="notice err">{error}</div>}
      {warnings.map((w, i) => (
        <div className="notice warn" key={i}>
          {w}
        </div>
      ))}

      {phase === "input" && (
        <form className="card" onSubmit={handleExtract}>
          <div className="card-bar" />
          <div className="card-body">
            <span className="eyebrow">Step 1</span>
            <h2>Your website address</h2>
            <p className="sub">
              We read the logo, colours, fonts and images off your page. You can
              change any of it before the assets are made.
            </p>

            <div className="field">
              <label htmlFor="url">Address</label>
              <input
                id="url"
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="e.g. yourbusiness.fi"
                autoComplete="url"
                required
              />
            </div>

            <div className="field">
              <label>Campaign goal</label>
              <div className="goals">
                {GOALS.map((g) => (
                  <button
                    type="button"
                    key={g.id}
                    className={`goal ${goal === g.id ? "selected" : ""}`}
                    onClick={() => setGoal(g.id)}
                    aria-pressed={goal === g.id}
                  >
                    {g.name}
                    <small>{g.hint}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="actions">
              <button type="submit" disabled={busy !== null || !url.trim()}>
                {busy === "extract"
                  ? "Analysing the page…"
                  : brand
                  ? "Analyse again"
                  : "Analyse the page"}
              </button>
              {/* The earlier analysis is still here: a user who came back does
                  not wait for another run to move forward. */}
              {brand && (
                <button
                  type="button"
                  className="outline"
                  onClick={() => back("brand")}
                  disabled={busy !== null}
                >
                  Continue to the brand card
                </button>
              )}
            </div>
            {busy === "extract" && <ProgressNote steps={EXTRACT_STEPS} />}
          </div>
        </form>
      )}

      {phase === "brand" && brand && (
        <BrandEditor
          brand={brand}
          onChange={setBrand}
          goal={goal}
          onGoalChange={setGoal}
          busy={busy === "generate"}
          onGenerate={handleGenerate}
          onBack={() => back("input")}
          hasResults={assets.length > 0}
          onForward={() => back("results")}
        />
      )}

      {phase === "results" && brand && (
        <>
          <div className="card">
            <div className={`card-bar ${allPass ? "green" : ""}`} />
            <div className="card-body">
              <span className="eyebrow">Step 3</span>
              <h2>
                Your assets are ready{" "}
                <span className={`badge ${allPass ? "ok" : "attention"}`}>
                  {allPass
                    ? "All passed validation"
                    : "Some need attention"}
                </span>
              </h2>
              <p className="sub">
                {brand.companyName} · {assets.length} assets ·{" "}
                {variants.length} copy variants
              </p>

              <div className="field">
                <label>Copy variant</label>
                <div className="goals">
                  {variants.map((v, i) => (
                    <button
                      key={v.id}
                      type="button"
                      className={`goal ${
                        activeVariant === v.id ? "selected" : ""
                      }`}
                      onClick={() => setActiveVariant(v.id)}
                      aria-pressed={activeVariant === v.id}
                    >
                      Variant {i + 1}
                      <small>{v.headline}</small>
                    </button>
                  ))}
                </div>
              </div>

              <CopyEditor
                variant={variants.find((v) => v.id === activeVariant)}
                limits={limits}
                busy={busy === "generate"}
                onSave={handleCopyEdit}
              />

              <div className="field zipchoice">
                <label>What goes in the zip</label>
                <div className="goals">
                  <button
                    type="button"
                    className={`goal ${!zipAll ? "selected" : ""}`}
                    onClick={() => setZipAll(false)}
                    aria-pressed={!zipAll}
                  >
                    Only the selected variant
                    <small>
                      {shown.length} assets — the recipient knows which version
                      is the right one
                    </small>
                  </button>
                  <button
                    type="button"
                    className={`goal ${zipAll ? "selected" : ""}`}
                    onClick={() => setZipAll(true)}
                    aria-pressed={zipAll}
                  >
                    All variants
                    <small>{assets.length} assets — for A/B testing</small>
                  </button>
                </div>
              </div>

              <div className="actions">
                <button onClick={handleZip} disabled={busy !== null}>
                  {busy === "zip" && <span className="spinner" />}
                  Download as a zip
                </button>
                <button
                  className="outline"
                  onClick={handleGenerate}
                  disabled={busy !== null}
                >
                  Generate new copy
                </button>
                <button
                  className="ghost"
                  onClick={() => back("brand")}
                  disabled={busy !== null}
                >
                  Edit the brand card
                </button>
                <button
                  className="ghost"
                  onClick={reset}
                  disabled={busy !== null}
                >
                  Start over
                </button>
              </div>

              {busy === "generate" && <ProgressNote steps={GENERATE_STEPS} />}
            </div>
          </div>

          <div className="assets">
            {shown.map((a) => (
              <AssetCard key={a.id} asset={a} />
            ))}
          </div>

          {/* The end of the path: without this the user is left alone with a
              zip file at the exact moment their interest peaks. Delivery is not
              connected, and that is said plainly — no pretending it works. */}
          <div className="card handoff">
            <div className="card-bar green" />
            <div className="card-body">
              <span className="eyebrow">Next step</span>
              <h2>The assets are done — what now?</h2>
              <p className="sub">
                They meet Alma's technical requirements and are ready to run.
                Next they get delivered to Alma and the placement is booked.
              </p>

              <div className="actions">
                <button
                  type="button"
                  onClick={deliver}
                  disabled={booking || Boolean(bookResult)}
                >
                  {booking ? "Booking…" : "Deliver to Alma"}
                </button>
              </div>

              {bookError && (
                <div className="notice" style={{ marginTop: 16 }}>
                  <strong>The booking did not go through.</strong> {bookError}
                </div>
              )}

              {bookResult && (
                <div className="notice" style={{ marginTop: 16 }}>
                  <strong>
                    Booked — line item {bookResult.lineItemId}.
                  </strong>{" "}
                  It is paused until Alma confirms the placement, so nothing is
                  running yet.
                  {bookResult.warnings.length > 0 && (
                    <ul style={{ margin: "8px 0 0 18px" }}>
                      {bookResult.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {delivered && !bookResult && !bookError && (
                <div className="notice" style={{ marginTop: 16 }}>
                  <strong>Not connected for this ad.</strong> Booking needs the
                  dates, budget and targeting that only the onboarding flow
                  collects. Download the zip and send it the agreed way.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function stepClass(phase: Phase, step: Phase): string {
  const order: Phase[] = ["input", "brand", "results"];
  const cur = order.indexOf(phase);
  const mine = order.indexOf(step);
  if (mine === cur) return "active";
  if (mine < cur) return "done";
  return "";
}

// ------------------------------------------------------------ brand card

function BrandEditor({
  brand,
  onChange,
  goal,
  onGoalChange,
  busy,
  onGenerate,
  onBack,
  hasResults,
  onForward,
}: {
  brand: BrandCard;
  onChange: (b: BrandCard) => void;
  goal: GoalId;
  onGoalChange: (g: GoalId) => void;
  busy: boolean;
  onGenerate: () => void;
  onBack: () => void;
  /** Whether assets already exist — if so, offer a way back to them. */
  hasResults: boolean;
  onForward: () => void;
}) {
  const [uploadError, setUploadError] = useState<string | null>(null);

  const set = <K extends keyof BrandCard>(k: K, v: BrandCard[K]) =>
    onChange({ ...brand, [k]: v });

  const setColor = (k: keyof BrandCard["colors"], v: string) =>
    onChange({ ...brand, colors: { ...brand.colors, [k]: v } });

  const toggleImage = (url: string) =>
    onChange({
      ...brand,
      images: brand.images.map((i) =>
        i.url === url ? { ...i, enabled: !i.enabled } : i
      ),
    });

  /** Lifts an image to the top of the list. The assets use the first enabled
   *  image, so without this the only way to change the main image would be to
   *  remove everything ahead of it. */
  const makePrimary = (url: string) => {
    const picked = brand.images.find((i) => i.url === url);
    if (!picked) return;
    onChange({
      ...brand,
      images: [
        { ...picked, enabled: true },
        ...brand.images.filter((i) => i.url !== url),
      ],
    });
  };

  const enabledCount = brand.images.filter((i) => i.enabled).length;
  const primaryUrl = brand.images.find((i) => i.enabled)?.url ?? null;

  async function handleLogoUpload(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    try {
      const uri = await fileToDataUri(file, {
        maxDim: LOGO_MAX_DIM,
        keepAlpha: true,
      });
      onChange({ ...brand, logoUrl: uri });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed.");
    }
  }

  async function handleImageUpload(files: FileList | null) {
    if (!files?.length) return;
    setUploadError(null);
    try {
      const added = await Promise.all(
        Array.from(files).map(async (f) => ({
          url: await fileToDataUri(f, {
            maxDim: PHOTO_MAX_DIM,
            keepAlpha: false,
          }),
          alt: f.name.replace(/\.[^.]+$/, ""),
          enabled: true,
          uploaded: true,
        }))
      );
      // Uploads go to the top: someone uploads an image because they want
      // that image used, so it becomes the main image straight away.
      onChange({ ...brand, images: [...added, ...brand.images] });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed.");
    }
  }

  return (
    <div className="card">
      <div className="card-bar" />
      <div className="card-body">
        <span className="eyebrow">Step 2</span>
        <h2>Brand card</h2>
        <p className="sub">
          Check and correct this before the assets are made. The first enabled
          image is the one they use.
        </p>

        <div className="brand-grid">
        <div>
          <label>Logo</label>
          <div className="logo-box">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt="Logo" />
            ) : (
              <span style={{ color: "#888", fontSize: 13 }}>
                No logo — the name is used as text
              </span>
            )}
          </div>
          <div className="logo-actions">
            <label className="uploadbtn tiny">
              {brand.logoUrl ? "Replace logo" : "Upload logo"}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  handleLogoUpload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {brand.logoUrl && (
              <button
                type="button"
                className="ghost tiny"
                onClick={() => set("logoUrl", null)}
              >
                Remove
              </button>
            )}
          </div>
        </div>

        <div>
          <div className="field">
            <label htmlFor="cn">Company name</label>
            <input
              id="cn"
              type="text"
              value={brand.companyName}
              onChange={(e) => set("companyName", e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="desc">What the company does</label>
            <textarea
              id="desc"
              value={brand.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>

          <div className="field field-row">
            <div style={{ flex: 1 }}>
              <label htmlFor="tone">Tone of voice</label>
              <input
                id="tone"
                type="text"
                value={brand.tone}
                onChange={(e) => set("tone", e.target.value)}
                placeholder="e.g. Warm and friendly"
              />
              <p className="muted" style={{ marginTop: "var(--space-1)" }}>
                How your ads should sound — this guides the copy that gets
                written.
              </p>
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="content-type">Content type</label>
              <ContentTypeSelect
                value={brand.contentType}
                alternatives={brand.contentTypeAlternatives}
                onChange={(next) =>
                  onChange({
                    ...brand,
                    contentType: next.contentType,
                    contentTypeAlternatives: next.contentTypeAlternatives,
                  })
                }
              />
            </div>
          </div>
        </div>
      </div>

      <div className="field" style={{ marginTop: 20 }}>
        <label>Colour palette</label>
        <p className="muted" style={{ marginBottom: "var(--space-2)" }}>
          We picked these up from your site. Click a swatch to fix a colour
          if we got it wrong.
        </p>
        <div className="swatches">
          {(
            [
              ["primary", "Primary"],
              ["accent", "Accent"],
              ["secondary", "Secondary"],
              ["background", "Background"],
              ["text", "Text"],
            ] as const
          ).map(([key, label]) => (
            <div className="swatch" key={key}>
              <input
                type="color"
                value={brand.colors[key]}
                onChange={(e) => setColor(key, e.target.value)}
                aria-label={label}
              />
              <div className="swatch-info">
                <strong>
                  {label} <span className="swatch-hex">{brand.colors[key]}</span>
                </strong>
                <span className="swatch-hint">{COLOR_HINTS[key]}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="color-preview-grid">
          {primaryUrl && (
            <div className="color-preview-card">
              <span className="color-preview-label">Ad with image</span>
              <iframe
                srcDoc={renderBannerHtml({
                  width: COLOR_PREVIEW_WIDTH,
                  height: COLOR_PREVIEW_HEIGHT,
                  brand,
                  copy: COLOR_PREVIEW_COPY,
                  imageDataUri: primaryUrl,
                  logoDataUri: brand.logoUrl,
                  animated: false,
                })}
                width={COLOR_PREVIEW_WIDTH}
                height={COLOR_PREVIEW_HEIGHT}
                title="Ad with image"
                sandbox="allow-scripts"
                scrolling="no"
              />
            </div>
          )}
          <div className="color-preview-card">
            <span className="color-preview-label">Ad without image</span>
            <iframe
              srcDoc={renderBannerHtml({
                width: COLOR_PREVIEW_WIDTH,
                height: COLOR_PREVIEW_HEIGHT,
                brand,
                copy: COLOR_PREVIEW_COPY,
                imageDataUri: null,
                logoDataUri: brand.logoUrl,
                animated: false,
              })}
              width={COLOR_PREVIEW_WIDTH}
              height={COLOR_PREVIEW_HEIGHT}
              title="Ad without image"
              sandbox="allow-scripts"
              scrolling="no"
            />
          </div>
        </div>
      </div>

      <div className="field">
        <div className="field-row">
          <div style={{ flex: 1 }}>
            <label htmlFor="fh">Heading font</label>
            <input
              id="fh"
              type="text"
              value={brand.fonts.heading}
              onChange={(e) =>
                onChange({
                  ...brand,
                  fonts: { ...brand.fonts, heading: e.target.value },
                })
              }
            />
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="fb">Body font</label>
            <input
              id="fb"
              type="text"
              value={brand.fonts.body}
              onChange={(e) =>
                onChange({
                  ...brand,
                  fonts: { ...brand.fonts, body: e.target.value },
                })
              }
            />
          </div>
        </div>
        <p className="muted" style={{ marginTop: "var(--space-1)" }}>
          The ad uses the closest system font to this, not the exact
          typeface — Alma's file-size limit rules out loading a web font.
        </p>
      </div>

      <div className="field">
        <label>
          Images ({enabledCount} selected
          {enabledCount === 0 ? " — the assets will be made without one" : ""})
        </label>

        {uploadError && (
          <div className="notice err" style={{ marginBottom: 12 }}>
            {uploadError}
          </div>
        )}

        {/* The upload tile is the first cell of the grid: the action sits where
            the images are, not off on its own at the edge of the page. */}
        <div className="images">
          <label className="uploadtile">
            <span className="uploadtile-plus">+</span>
            <span>Add your own images</span>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                handleImageUpload(e.target.files);
                e.target.value = "";
              }}
            />
          </label>

          {brand.images.length > 0 &&
            brand.images.map((img) => {
              const isPrimary = img.url === primaryUrl;
              return (
                <div
                  className={`imgcard ${img.enabled ? "" : "dropped"} ${
                    isPrimary ? "primary" : ""
                  }`}
                  key={img.url}
                >
                  <img src={img.url} alt={img.alt} />
                  {isPrimary && <span className="imgflag">Main image</span>}
                  {img.uploaded && <span className="imgown">Your upload</span>}
                  <div className="bar">
                    <span>{img.enabled ? "In use" : "Dropped"}</span>
                    <button
                      type="button"
                      className="ghost tiny"
                      onClick={() => toggleImage(img.url)}
                    >
                      {img.enabled ? "Drop" : "Restore"}
                    </button>
                  </div>
                  {!isPrimary && img.enabled && (
                    <button
                      type="button"
                      className="outline tiny imgprimary"
                      onClick={() => makePrimary(img.url)}
                    >
                      Make main image
                    </button>
                  )}
                </div>
              );
            })}
        </div>

        {brand.images.length === 0 && (
          <p className="muted" style={{ marginTop: "var(--space-2)" }}>
            No usable images were found on the page. Upload your own, or let
            the assets be built from colour and type alone.
          </p>
        )}
      </div>

      <div className="field">
        <label>Campaign goal</label>
        <div className="goals">
          {GOALS.map((g) => (
            <button
              type="button"
              key={g.id}
              className={`goal ${goal === g.id ? "selected" : ""}`}
              onClick={() => onGoalChange(g.id)}
              aria-pressed={goal === g.id}
            >
              {g.name}
              <small>{g.hint}</small>
            </button>
          ))}
        </div>
      </div>

        <div className="actions">
          <button onClick={onGenerate} disabled={busy}>
            {busy ? "Making the assets…" : "Make the assets"}
          </button>
          {hasResults && (
            <button className="outline" onClick={onForward} disabled={busy}>
              Back to the assets
            </button>
          )}
          <button className="ghost" onClick={onBack} disabled={busy}>
            Back
          </button>
        </div>
        {busy && <ProgressNote steps={GENERATE_STEPS} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ image upload

/** A phone photo is easily 8 MB. It is scaled down in the browser before it
 *  enters state and rides along to the server on the generate request. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** A photo's longest side. The largest banner is 1600 px wide. */
const PHOTO_MAX_DIM = 1600;
/** A logo draws at most ~90 px tall in a banner, so 320 is plenty even on
 *  sharp displays — and keeps the HTML5 package under its weight limit. */
const LOGO_MAX_DIM = 320;

async function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Reading the file failed."));
    reader.readAsDataURL(file);
  });
}

/**
 * Read an image file and scale it into a data URI.
 * A logo stays PNG, because JPEG would destroy its transparent background.
 */
async function fileToDataUri(
  file: File,
  opts: { maxDim: number; keepAlpha: boolean }
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file (JPG, PNG, GIF, WebP or SVG).");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `That image is too large (${Math.round(
        file.size / 1024 / 1024
      )} MB). The maximum is 25 MB.`
    );
  }

  const raw = await readAsDataUri(file);

  // An SVG has no pixel dimensions, so it is not drawn to a canvas — it is
  // already light and scales on its own.
  if (file.type === "image/svg+xml") return raw;

  const img = new Image();
  img.src = raw;
  await img.decode();

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error("The image could not be read.");

  const scale = Math.min(1, opts.maxDim / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The browser could not process the image.");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return opts.keepAlpha
    ? canvas.toDataURL("image/png")
    : canvas.toDataURL("image/jpeg", 0.85);
}

// ---------------------------------------------------------------- waiting

/** These messages follow the pipeline's real order of execution, timed from
 *  typical runs. They say what is happening — they do not claim to know a
 *  percentage the server never reports. */
const EXTRACT_STEPS = [
  { at: 0, text: "Fetching your website…" },
  { at: 2500, text: "Reading colours, fonts and logo…" },
  { at: 5000, text: "Looking through the images…" },
  { at: 9000, text: "Assembling the brand card…" },
];

const GENERATE_STEPS = [
  { at: 0, text: "Writing the ad copy…" },
  { at: 5000, text: "Fitting images to each size…" },
  { at: 9000, text: "Rendering the assets…" },
  { at: 14000, text: "Checking specs and contrast…" },
];

function ProgressNote({
  steps,
}: {
  steps: { at: number; text: string }[];
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - started), 500);
    return () => clearInterval(id);
  }, []);

  const current =
    [...steps].reverse().find((s) => elapsed >= s.at) ?? steps[0];

  return (
    <div className="progress-note">
      <span className="spinner" />
      <span>{current.text}</span>
    </div>
  );
}

// ------------------------------------------------------------- copy editor

/**
 * Check and fix the copy before download. The counter shows the tightest limit,
 * so the text fits every size — the same rule the copy was generated under.
 */
function CopyEditor({
  variant,
  limits,
  busy,
  onSave,
}: {
  variant: CopyVariant | undefined;
  limits: TextLimits | null;
  busy: boolean;
  onSave: (v: CopyVariant) => void;
}) {
  const [draft, setDraft] = useState<CopyVariant | null>(null);

  // Swap the draft when the user selects a different variant.
  const current = draft?.id === variant?.id ? draft : variant;
  if (!current || !variant) return null;

  const dirty =
    current.headline !== variant.headline ||
    current.body !== variant.body ||
    current.cta !== variant.cta;

  const set = (k: keyof CopyVariant, v: string) =>
    setDraft({ ...current, [k]: v });

  const counter = (value: string, max: number | undefined) => {
    if (!max) return null;
    const over = value.length > max;
    return (
      <span className={`counter ${over ? "over" : ""}`}>
        {value.length} / {max}
      </span>
    );
  };

  return (
    <div className="field copy-editor">
      <label>Check the copy</label>
      <p className="muted" style={{ marginTop: -2, marginBottom: 12 }}>
        Read these through before downloading. The character limit follows the
        tightest size, so the same text fits every asset.
      </p>

      <div className="copy-field">
        <div className="copy-label">
          <span>Headline</span>
          {counter(current.headline, limits?.headline)}
        </div>
        <input
          type="text"
          value={current.headline}
          onChange={(e) => set("headline", e.target.value)}
        />
      </div>

      <div className="copy-field">
        <div className="copy-label">
          <span>Body</span>
          {counter(current.body, limits?.body)}
        </div>
        <textarea
          value={current.body}
          onChange={(e) => set("body", e.target.value)}
        />
      </div>

      <div className="copy-field">
        <div className="copy-label">
          <span>CTA</span>
          {counter(current.cta, limits?.cta)}
        </div>
        <input
          type="text"
          value={current.cta}
          onChange={(e) => set("cta", e.target.value)}
        />
      </div>

      <button
        type="button"
        className="sm"
        disabled={!dirty || busy}
        onClick={() => onSave(current)}
      >
        {busy && <span className="spinner" />}
        {busy ? "Updating…" : "Update the assets"}
      </button>
    </div>
  );
}

// ----------------------------------------------------------------- asset

const PREVIEW_WIDTH = 300;

function AssetCard({ asset }: { asset: GeneratedAsset }) {
  const scale = Math.min(1, PREVIEW_WIDTH / asset.width);
  // The animation runs once on load and is over in about a second. Recreating
  // the iframe by changing its key is the only way to see it again.
  const [replay, setReplay] = useState(0);

  return (
    <div className="asset">
      <div className="preview">
        <div
          style={{
            width: asset.width * scale,
            height: asset.height * scale,
            position: "relative",
          }}
        >
          <div
            style={{
              width: asset.width,
              height: asset.height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              position: "absolute",
              top: 0,
              left: 0,
            }}
          >
            {asset.kind === "html5" ? (
              <iframe
                key={replay}
                srcDoc={asset.html}
                width={asset.width}
                height={asset.height}
                title={asset.fileName}
                sandbox="allow-scripts"
                scrolling="no"
              />
            ) : (
              <img
                src={asset.dataUri}
                width={asset.width}
                height={asset.height}
                alt={asset.copy.headline}
              />
            )}
          </div>
        </div>
      </div>

      <div className="meta">
        <h3>
          {asset.formatName}{" "}
          <span
            className={`badge ${asset.validation.pass ? "ok" : "attention"}`}
          >
            {asset.validation.pass ? "Passed" : "Needs attention"}
          </span>
        </h3>
        <div className="dim">
          {asset.width}×{asset.height} px ·{" "}
          {Math.round(asset.fileSizeBytes / 1024)} kB ·{" "}
          {asset.kind === "html5" ? "HTML5" : "static"}
        </div>

        <ul className="checks">
          {asset.validation.checks.map((c) => (
            <li key={c.id} className={c.pass ? "pass" : "fail"}>
              <span>
                {c.label}
                {c.detail ? ` — ${c.detail}` : ""}
              </span>
            </li>
          ))}
        </ul>

        <div className="asset-actions">
          <a
            href={
              asset.kind === "html5"
                ? `data:text/html;charset=utf-8,${encodeURIComponent(
                    asset.html ?? ""
                  )}`
                : asset.dataUri
            }
            download={asset.fileName}
          >
            <button type="button" className="outline tiny">
              Download this
            </button>
          </a>

          {asset.kind === "html5" && (
            <button
              type="button"
              className="ghost tiny"
              onClick={() => setReplay((n) => n + 1)}
            >
              ↻ Replay animation
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
