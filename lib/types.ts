export type GoalId = "awareness" | "offer" | "recruitment";

export interface TextLimits {
  headline: number;
  body: number;
  cta: number;
}

export interface DisplayFormat {
  id: string;
  name: string;
  width: number;
  height: number;
  maxFileSizeKb: number;
  acceptedTypes: string[];
  device: "desktop" | "mobile" | "both";
  /** Alma's own grouping on the display format table. */
  family?: "standard" | "tactical" | "special";
  primary: boolean;
  requirements?: string[];
  /** Other sizes Alma accepts for the same product. Not rendered — they are
   *  here so the offering can state what a buyer may supply. */
  alternateSizes?: { width: number; height: number }[];
  textLimits: TextLimits;
}

export interface Html5Format {
  id: string;
  baseFormat: string;
  name: string;
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
  video: VideoSpec;
  goals: Goal[];
}

export interface VideoSpec {
  id: string;
  name: string;
  width: number;
  height: number;
  maxFileSizeMb: number;
  maxDurationSeconds: number;
  acceptedTypes: string[];
  outstream: {
    maxFileSizeMb: number;
    maxDurationSeconds: number;
    codec: string;
    videoBitrateKbps: { min: number; max: number };
    audioBitrateKbps: number;
    frameRates: number[];
    loudnessLufs: number;
    aspectRatios: string[];
  };
}

/** Brand card — read off the website, editable before assets are generated. */
export interface BrandCard {
  sourceUrl: string;
  companyName: string;
  /** What the company does, in one or two sentences. */
  description: string;
  /** Tone of voice, e.g. "Warm and expert". */
  tone: string;
  /** IAB Content Taxonomy 3.1 Name, inferred from the site. */
  contentType: string;
  /** Next-best IAB names the user can switch to from the dropdown. */
  contentTypeAlternatives: string[];
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
  /** True when the Claude key was missing and this is mock data. */
  isMock?: boolean;
  warnings?: string[];
}

export interface BrandImage {
  /** A URL, or a data URI when the user uploaded the image themselves. */
  url: string;
  alt: string;
  /** The user can drop an image from the brand card. */
  enabled: boolean;
  /** Uploaded by the user rather than found on the page. */
  uploaded?: boolean;
}

export interface CopyVariant {
  id: string;
  headline: string;
  body: string;
  cta: string;
}

/** One finished ad asset. */
export interface GeneratedAsset {
  id: string;
  formatId: string;
  formatName: string;
  kind: "static" | "html5";
  width: number;
  height: number;
  /** A data: URI for preview (PNG), or the markup for html5 assets. */
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
