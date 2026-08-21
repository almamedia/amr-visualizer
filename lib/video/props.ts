import type { BrandCard, CopyVariant } from "../types";
import type { VideoFormatId } from "./formats";
import type { VideoAdProps } from "./schema";

export function toVideoAdProps(
  brand: BrandCard,
  copy: CopyVariant,
  formatId: VideoFormatId
): VideoAdProps {
  return {
    formatId,
    companyName: brand.companyName,
    headline: copy.headline,
    body: copy.body,
    cta: copy.cta,
    logoUrl: safeMediaUrl(brand.logoUrl, brand.sourceUrl),
    imageUrl: safeMediaUrl(
      brand.images.find((image) => image.enabled)?.url ?? null,
      brand.sourceUrl
    ),
    colors: {
      primary: brand.colors.primary,
      accent: brand.colors.accent,
      background: brand.colors.background,
      text: brand.colors.text,
    },
  };
}

/** Keep the render browser away from local and non-media protocols. Uploaded
 * images remain supported as data:image URIs. */
function safeMediaUrl(value: string | null, sourceUrl: string): string | null {
  if (!value) return null;
  if (value.startsWith("data:image/")) return value;
  try {
    const resolved = new URL(value, sourceUrl);
    return resolved.protocol === "https:" || resolved.protocol === "http:"
      ? resolved.toString()
      : null;
  } catch {
    return null;
  }
}
