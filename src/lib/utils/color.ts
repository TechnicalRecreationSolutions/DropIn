/** Parses "#rrggbb" to [r,g,b] in 0-255. Assumes pre-validated 6-digit hex. */
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * True if the given hex is light enough that on-tint text needs extra
 * darkening to stay legible against a near-white background tint.
 * Empirical threshold, not a strict WCAG AA guarantee for every input.
 */
export function isLightColor(hex: string): boolean {
  return relativeLuminance(hex) > 0.4;
}
