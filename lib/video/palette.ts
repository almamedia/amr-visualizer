function luminance(hex: string): number {
  const normalized = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function readableText(background: string): "#ffffff" | "#1c0a19" {
  return luminance(background) < 0.42 ? "#ffffff" : "#1c0a19";
}
