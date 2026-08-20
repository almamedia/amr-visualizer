export type GoalId = "tunnettuus" | "tarjous" | "rekrytointi";

export interface TextLimits {
  headline: number;
  body: number;
  cta: number;
}

export interface DisplayFormat {
  id: string;
  /** Alman tuotenimi, esim. "Paraati". Tämä on aineiston tunniste
   *  käyttöliittymässä: asiakas ostaa Almalta juuri tämän tuotteen, ja
   *  samalla nimellä aineistosta puhutaan Alman kanssa. Ei koskaan korvata. */
  name: string;
  /** Lyhyt arkikielinen kuvaus siitä, mihin mainos sivulla päätyy. Tukee
   *  tuotenimeä ensikertalaiselle — ei korvaa sitä. */
  plainName: string;
  width: number;
  height: number;
  maxFileSizeKb: number;
  acceptedTypes: string[];
  device: "desktop" | "mobile" | "both";
  primary: boolean;
  requirements?: string[];
  mobileAlternative?: { width: number; height: number };
  textLimits: TextLimits;
}

export interface Html5Format {
  id: string;
  baseFormat: string;
  name: string;
  plainName: string;
  maxFileSizeKb: number;
  maxAnimationSeconds: number;
}

export interface Goal {
  id: GoalId;
  name: string;
  description: string;
  ctaHint: string;
}

export interface SpecLibrary {
  source: { url: string; fetchedAt: string };
  global: {
    aiActLabel: string;
    requireAiActLabel: boolean;
    httpsRequired: boolean;
    acceptedStaticFormats: string[];
    html5: {
      maxInitialLoadKb: number;
      maxCpuLoadPercent: number;
      politeLoadAllowed: boolean;
      notes: string[];
    };
  };
  formats: DisplayFormat[];
  html5Formats: Html5Format[];
  video: Record<string, unknown>;
  goals: Goal[];
}

/** Brändikortti — poimittu sivustolta, käyttäjän muokattavissa ennen generointia. */
export interface BrandCard {
  sourceUrl: string;
  companyName: string;
  /** Yrityksen ydinviesti, 1–2 lausetta. */
  description: string;
  /** Äänensävy, esim. "Lämmin ja asiantunteva". */
  tone: string;
  toimiala: string;
  logoUrl: string | null;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
  images: BrandImage[];
  /** true jos Claude-avain puuttui ja tämä on mock-dataa. */
  isMock?: boolean;
  warnings?: string[];
}

export interface BrandImage {
  /** Verkko-osoite tai data-URI, jos kuva on ladattu käyttäjän koneelta. */
  url: string;
  alt: string;
  /** Käyttäjä voi poistaa kuvan käytöstä brändikortissa. */
  enabled: boolean;
  /** Käyttäjän itse lataama kuva, ei sivulta poimittu. */
  uploaded?: boolean;
}

export interface CopyVariant {
  id: string;
  headline: string;
  body: string;
  cta: string;
}

/** Yksi valmis aineisto. */
export interface GeneratedAsset {
  id: string;
  formatId: string;
  formatName: string;
  /** Formaatin arkikielinen kuvaus, jota näytetään tuotenimen tukena. */
  formatPlainName: string;
  kind: "static" | "html5";
  width: number;
  height: number;
  /** data: URI esikatselua varten (PNG) tai HTML-merkkijono html5:lle. */
  dataUri?: string;
  html?: string;
  fileName: string;
  fileSizeBytes: number;
  copy: CopyVariant;
  validation: ValidationResult;
}

export interface ValidationCheck {
  id: string;
  label: string;
  pass: boolean;
  detail?: string;
}

export interface ValidationResult {
  pass: boolean;
  checks: ValidationCheck[];
}
