"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  BrandCard,
  CopyVariant,
  GeneratedAsset,
  GoalId,
  TextLimits,
} from "@/lib/types";

type Phase = "input" | "brand" | "results";

const GOALS: { id: GoalId; name: string; hint: string }[] = [
  { id: "tunnettuus", name: "Tunnettuus", hint: "Tee itsesi tunnetuksi" },
  { id: "tarjous", name: "Tarjous", hint: "Nosta etu tai tarjous esiin" },
  { id: "rekrytointi", name: "Rekrytointi", hint: "Houkuttele hakijoita" },
];

export default function Page() {
  const [phase, setPhase] = useState<Phase>("input");
  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState<GoalId>("tunnettuus");

  const [brand, setBrand] = useState<BrandCard | null>(null);
  const [assets, setAssets] = useState<GeneratedAsset[]>([]);
  const [variants, setVariants] = useState<CopyVariant[]>([]);
  const [activeVariant, setActiveVariant] = useState("v1");
  const [limits, setLimits] = useState<TextLimits | null>(null);
  const [zipAll, setZipAll] = useState(false);
  const [delivered, setDelivered] = useState(false);

  const [busy, setBusy] = useState<null | "extract" | "generate" | "zip">(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [aiEnabled, setAiEnabled] = useState(true);

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
      if (!res.ok) throw new Error(data.error ?? "Analysointi epäonnistui.");

      setBrand(data.brand);
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
        body: JSON.stringify({ brand, goalId: goal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generointi epäonnistui.");

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

  /** Renderöi aineistot uudelleen käsin muokatuilla teksteillä.
   *  Claudea ei kutsuta, joten tämä on selvästi nopeampi kuin ensigenerointi. */
  async function handleCopyEdit(edited: CopyVariant) {
    if (!brand) return;
    const next = variants.map((v) => (v.id === edited.id ? edited : v));
    setError(null);
    setBusy("generate");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brand, goalId: goal, copyVariants: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Päivitys epäonnistui.");

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

  async function handleZip() {
    if (!brand) return;
    setBusy("zip");
    setError(null);
    try {
      // Oletuksena mukaan vain valittu variaatio: vastaanottajan ei pidä
      // joutua arvaamaan, mikä kolmesta versiosta oli se oikea.
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
        throw new Error(data.error ?? "Zip-paketin luonti epäonnistui.");
      }
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "amr-aineistot.zip";
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lataus epäonnistui.");
    } finally {
      setBusy(null);
    }
  }

  /** Tyhjentää kaiken ja palaa alkuun. Vain "Aloita alusta" käyttää tätä. */
  function reset() {
    setPhase("input");
    setUrl("");
    setBrand(null);
    setAssets([]);
    setVariants([]);
    setWarnings([]);
    setError(null);
  }

  /** Palaa edelliseen vaiheeseen tiedot tallella. "Takaisin" kutsui aiemmin
   *  resetiä, jolloin osoite ja koko analyysi katosivat — käyttäjä odottaa
   *  palaavansa, ei aloittavansa alusta. */
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
          <h1>Aineistostudio</h1>
          <p>
            Syötä verkkosivusi osoite ja saat valmiit, spec-yhteensopivat
            mainosaineistot Alman medioihin.
          </p>
        </div>
      </header>

      <div className="steps">
        <span className={`step ${stepClass(phase, "input")}`}>1 · Syöttö</span>
        <span className={`step ${stepClass(phase, "brand")}`}>
          2 · Brändikortti
        </span>
        <span className={`step ${stepClass(phase, "results")}`}>
          3 · Aineistot
        </span>
      </div>

      {!aiEnabled && (
        <div className="notice warn">
          <strong>Tekoälyanalyysi ei ole käytössä.</strong> Aineistot syntyvät
          silti: brändi luetaan suoraan sivun rakenteesta ja tekstit tulevat
          valmiista pohjista. Tulos on karkeampi, ja kaikki kentät ovat
          muokattavissa.
          <span className="devhint">
            Kehittäjälle: lisää <code>ANTHROPIC_API_KEY</code> tiedostoon{" "}
            <code>.env.local</code> ja käynnistä palvelin uudelleen.
          </span>
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
            <span className="eyebrow">Vaihe 1</span>
            <h2>Verkkosivun osoite</h2>
            <p className="sub">
              Poimimme sivulta logon, värit, fontit ja kuvat. Voit muokata
              kaikkea ennen aineistojen tekoa.
            </p>

            <div className="field">
              <label htmlFor="url">Osoite</label>
              <input
                id="url"
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="esim. kampaamo-esimerkki.fi"
                autoComplete="url"
                required
              />
            </div>

            <div className="field">
              <label>Kampanjatavoite</label>
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
                  ? "Analysoidaan sivua…"
                  : brand
                  ? "Analysoi uudelleen"
                  : "Analysoi sivu"}
              </button>
              {/* Aiempi analyysi on tallessa: takaisin tullut käyttäjä ei
                  joudu odottamaan uutta ajoa päästäkseen eteenpäin. */}
              {brand && (
                <button
                  type="button"
                  className="outline"
                  onClick={() => back("brand")}
                  disabled={busy !== null}
                >
                  Jatka brändikorttiin
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
              <span className="eyebrow">Vaihe 3</span>
              <h2>
                Aineistot valmiina{" "}
                <span className={`badge ${allPass ? "ok" : "attention"}`}>
                  {allPass
                    ? "Kaikki läpäisivät validoinnin"
                    : "Osa vaatii huomiota"}
                </span>
              </h2>
              <p className="sub">
                {brand.companyName} · {assets.length} aineistoa ·{" "}
                {variants.length} tekstivariaatiota
              </p>

              <div className="field">
                <label>Tekstivariaatio</label>
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
                      Variaatio {i + 1}
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
                <label>Zip-paketin sisältö</label>
                <div className="goals">
                  <button
                    type="button"
                    className={`goal ${!zipAll ? "selected" : ""}`}
                    onClick={() => setZipAll(false)}
                    aria-pressed={!zipAll}
                  >
                    Vain valittu variaatio
                    <small>
                      {shown.length} aineistoa — vastaanottaja tietää mikä on
                      oikea versio
                    </small>
                  </button>
                  <button
                    type="button"
                    className={`goal ${zipAll ? "selected" : ""}`}
                    onClick={() => setZipAll(true)}
                    aria-pressed={zipAll}
                  >
                    Kaikki variaatiot
                    <small>{assets.length} aineistoa — A/B-testaukseen</small>
                  </button>
                </div>
              </div>

              <div className="actions">
                <button onClick={handleZip} disabled={busy !== null}>
                  {busy === "zip" && <span className="spinner" />}
                  Lataa zip-pakettina
                </button>
                <button
                  className="outline"
                  onClick={handleGenerate}
                  disabled={busy !== null}
                >
                  Generoi uudet tekstit
                </button>
                <button
                  className="ghost"
                  onClick={() => back("brand")}
                  disabled={busy !== null}
                >
                  Muokkaa brändikorttia
                </button>
                <button
                  className="ghost"
                  onClick={reset}
                  disabled={busy !== null}
                >
                  Aloita alusta
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

          {/* Polun pää: ilman tätä käyttäjä jää yksin zip-tiedoston kanssa
              juuri kun kiinnostus on korkeimmillaan. Toimitusta ei ole
              kytketty, ja se sanotaan suoraan — ei teeskennellä toimivaa. */}
          <div className="card handoff">
            <div className="card-bar green" />
            <div className="card-body">
              <span className="eyebrow">Seuraava askel</span>
              <h2>Aineistot valmiit — entä sitten?</h2>
              <p className="sub">
                Aineistot täyttävät Alman tekniset vaatimukset ja ovat valmiita
                kampanjaan. Seuraavaksi ne toimitetaan Almalle ja varataan
                näkyvyys.
              </p>

              <div className="actions">
                <button type="button" onClick={() => setDelivered(true)}>
                  Toimita Almalle
                </button>
              </div>

              {delivered && (
                <div className="notice" style={{ marginTop: 16 }}>
                  <strong>Tämä on demon paikanvaraus.</strong> Toimitusta ei ole
                  kytketty: tuotannossa tästä avautuisi aineistojen lähetys ja
                  kampanjan varaus, tai ne siirtyisivät suoraan
                  kampanjanhallintaan. Lataa toistaiseksi zip-paketti ja
                  toimita se sovittua kautta.
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

// ---------------------------------------------------------- brändikortti

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
  /** Onko aineistoja jo olemassa — silloin tarjotaan paluu niihin. */
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

  /** Nostaa kuvan listan kärkeen. Aineistoissa käytetään ensimmäistä
   *  valittuna olevaa kuvaa, joten ilman tätä ainoa keino vaihtaa pääkuvaa
   *  olisi poistaa kaikki sitä edeltävät. */
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
      setUploadError(e instanceof Error ? e.message : "Lataus epäonnistui.");
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
      // Omat kuvat listan kärkeen: käyttäjä lataa kuvan koska haluaa
      // nimenomaan sen käyttöön, joten siitä tulee suoraan pääkuva.
      onChange({ ...brand, images: [...added, ...brand.images] });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Lataus epäonnistui.");
    }
  }

  return (
    <div className="card">
      <div className="card-bar" />
      <div className="card-body">
        <span className="eyebrow">Vaihe 2</span>
        <h2>Brändikortti</h2>
        <p className="sub">
          Tarkista ja korjaa ennen aineistojen tekoa. Ensimmäistä valittuna
          olevaa kuvaa käytetään aineistoissa.
        </p>

        <div className="brand-grid">
        <div>
          <label>Logo</label>
          <div className="logo-box">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt="Logo" />
            ) : (
              <span style={{ color: "#888", fontSize: 13 }}>
                Ei logoa — käytetään nimeä tekstinä
              </span>
            )}
          </div>
          <div className="logo-actions">
            <label className="uploadbtn tiny">
              {brand.logoUrl ? "Vaihda logo" : "Lataa logo"}
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
                Poista
              </button>
            )}
          </div>
        </div>

        <div>
          <div className="field">
            <label htmlFor="cn">Yrityksen nimi</label>
            <input
              id="cn"
              type="text"
              value={brand.companyName}
              onChange={(e) => set("companyName", e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="desc">Mitä yritys tekee</label>
            <textarea
              id="desc"
              value={brand.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>

          <div className="field field-row">
            <div style={{ flex: 1 }}>
              <label htmlFor="tone">Äänensävy</label>
              <input
                id="tone"
                type="text"
                value={brand.tone}
                onChange={(e) => set("tone", e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="ala">Toimiala</label>
              <input
                id="ala"
                type="text"
                value={brand.toimiala}
                onChange={(e) => set("toimiala", e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="field" style={{ marginTop: 20 }}>
        <label>Väripaletti</label>
        <div className="swatches">
          {(
            [
              ["primary", "Pääväri"],
              ["accent", "Korostus"],
              ["secondary", "Toissijainen"],
              ["background", "Tausta"],
              ["text", "Teksti"],
            ] as const
          ).map(([key, label]) => (
            <div className="swatch" key={key}>
              <input
                type="color"
                value={brand.colors[key]}
                onChange={(e) => setColor(key, e.target.value)}
                aria-label={label}
              />
              <span>
                {label}
                <br />
                {brand.colors[key]}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="field field-row">
        <div style={{ flex: 1 }}>
          <label htmlFor="fh">Otsikkofontti</label>
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
          <label htmlFor="fb">Leipätekstin fontti</label>
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

      <div className="field">
        <label>
          Kuvat ({enabledCount} valittuna
          {enabledCount === 0 ? " — aineistot tehdään ilman kuvaa" : ""})
        </label>

        {uploadError && (
          <div className="notice err" style={{ marginBottom: 12 }}>
            {uploadError}
          </div>
        )}

        {/* Latauslaatta on ruudukon ensimmäinen ruutu: toiminto on siellä
            missä kuvatkin, ei erillään sivun reunassa. */}
        <div className="images">
          <label className="uploadtile">
            <span className="uploadtile-plus">+</span>
            <span>Lisää omia kuvia</span>
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
                  {isPrimary && <span className="imgflag">Pääkuva</span>}
                  {img.uploaded && <span className="imgown">Oma kuva</span>}
                  <div className="bar">
                    <span>{img.enabled ? "Käytössä" : "Pois"}</span>
                    <button
                      type="button"
                      className="ghost tiny"
                      onClick={() => toggleImage(img.url)}
                    >
                      {img.enabled ? "Poista" : "Palauta"}
                    </button>
                  </div>
                  {!isPrimary && img.enabled && (
                    <button
                      type="button"
                      className="outline tiny imgprimary"
                      onClick={() => makePrimary(img.url)}
                    >
                      Aseta pääkuvaksi
                    </button>
                  )}
                </div>
              );
            })}
        </div>

        {brand.images.length === 0 && (
          <p className="muted" style={{ marginTop: "var(--space-2)" }}>
            Sivulta ei löytynyt käyttökelpoisia kuvia. Lataa oma kuva tai anna
            aineistojen rakentua väreillä ja typografialla.
          </p>
        )}
      </div>

      <div className="field">
        <label>Kampanjatavoite</label>
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
            {busy ? "Luodaan aineistoja…" : "Luo aineistot"}
          </button>
          {hasResults && (
            <button className="outline" onClick={onForward} disabled={busy}>
              Palaa aineistoihin
            </button>
          )}
          <button className="ghost" onClick={onBack} disabled={busy}>
            Takaisin
          </button>
        </div>
        {busy && <ProgressNote steps={GENERATE_STEPS} />}
      </div>
    </div>
  );
}

// --------------------------------------------------------- kuvan lataus

/** Puhelinkuva on helposti 8 Mt. Se pienennetään selaimessa ennen kuin se
 *  menee tilaan ja sitä kautta generointipyynnön mukana palvelimelle. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Valokuvan pisin sivu. Suurin banneri on 1600 px leveä. */
const PHOTO_MAX_DIM = 1600;
/** Logo piirtyy bannerissa korkeintaan ~90 px korkeana, joten 320 riittää
 *  myös tarkoille näytöille — ja pitää HTML5-paketin painorajan alla. */
const LOGO_MAX_DIM = 320;

async function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Tiedoston luku epäonnistui."));
    reader.readAsDataURL(file);
  });
}

/**
 * Lukee kuvatiedoston ja skaalaa sen data-URI:ksi.
 * Logo säilytetään PNG:nä, koska JPEG tuhoaisi läpinäkyvän taustan.
 */
async function fileToDataUri(
  file: File,
  opts: { maxDim: number; keepAlpha: boolean }
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Valitse kuvatiedosto (JPG, PNG, GIF, WebP tai SVG).");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Kuva on liian suuri (${Math.round(
        file.size / 1024 / 1024
      )} Mt). Enimmäiskoko on 25 Mt.`
    );
  }

  const raw = await readAsDataUri(file);

  // SVG:llä ei ole pikselimittoja, joten sitä ei piirretä kankaalle —
  // se on jo valmiiksi kevyt ja skaalautuu itsestään.
  if (file.type === "image/svg+xml") return raw;

  const img = new Image();
  img.src = raw;
  await img.decode();

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error("Kuvaa ei voitu lukea.");

  const scale = Math.min(1, opts.maxDim / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kuvan käsittely ei onnistunut selaimessa.");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return opts.keepAlpha
    ? canvas.toDataURL("image/png")
    : canvas.toDataURL("image/jpeg", 0.85);
}

// ------------------------------------------------------------- odotus

/** Viestit seuraavat putken todellista suoritusjärjestystä ja ajoitus on
 *  mitattu tyypillisistä ajoista. Ne kertovat mitä on menossa — eivät väitä
 *  tietävänsä prosentteja, joita palvelin ei raportoi. */
const EXTRACT_STEPS = [
  { at: 0, text: "Haetaan verkkosivua…" },
  { at: 2500, text: "Luetaan värit, fontit ja logo…" },
  { at: 5000, text: "Katsotaan kuvat läpi…" },
  { at: 9000, text: "Kootaan brändikorttia…" },
];

const GENERATE_STEPS = [
  { at: 0, text: "Kirjoitetaan mainostekstejä…" },
  { at: 5000, text: "Sovitetaan kuvat kokoihin…" },
  { at: 9000, text: "Renderöidään aineistoja…" },
  { at: 14000, text: "Tarkistetaan speksit ja kontrastit…" },
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

// ---------------------------------------------------------- copy-editori

/**
 * Tekstien tarkistus ja korjaus ennen latausta. Merkkilaskuri näyttää
 * tiukimman rajan, jotta teksti mahtuu jokaiseen kokoon — sama sääntö, jolla
 * copy alun perin generoidaan.
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

  // Vaihda luonnos, kun käyttäjä valitsee toisen variaation.
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
      <label>Tarkista tekstit</label>
      <p className="muted" style={{ marginTop: -2, marginBottom: 12 }}>
        Lue tekstit läpi ennen latausta. Merkkiraja on tiukimman koon mukaan,
        jotta sama teksti mahtuu jokaiseen aineistoon.
      </p>

      <div className="copy-field">
        <div className="copy-label">
          <span>Otsikko</span>
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
          <span>Leipäteksti</span>
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
        {busy ? "Päivitetään…" : "Päivitä aineistot"}
      </button>
    </div>
  );
}

// ------------------------------------------------------------- aineisto

const PREVIEW_WIDTH = 300;

function AssetCard({ asset }: { asset: GeneratedAsset }) {
  const scale = Math.min(1, PREVIEW_WIDTH / asset.width);
  // Animaatio ajetaan kerran latauksessa ja on ohi noin sekunnissa. Iframen
  // uudelleenluonti avaimen vaihdolla on ainoa tapa nähdä se uudestaan.
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
            {asset.validation.pass ? "Hyväksytty" : "Huomioitavaa"}
          </span>
        </h3>
        <div className="dim">
          {asset.width}×{asset.height} px ·{" "}
          {Math.round(asset.fileSizeBytes / 1024)} kt ·{" "}
          {asset.kind === "html5" ? "HTML5" : "staattinen"}
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
              Lataa tämä
            </button>
          </a>

          {asset.kind === "html5" && (
            <button
              type="button"
              className="ghost tiny"
              onClick={() => setReplay((n) => n + 1)}
            >
              ↻ Toista animaatio
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
