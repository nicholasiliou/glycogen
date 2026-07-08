/**
 * The app-wide color presets. Every plugin declares a default draw color from this palette (the
 * `color` field on the {@link Plugin} factory), and the Color shader recolors any layer by cycling
 * through the same presets — so "which colors exist" lives in exactly one place.
 */
export interface ColorPreset {
  name: string;
  hex: string;
}

export const COLOR_PRESETS: readonly ColorPreset[] = [
  { name: "green", hex: "#C0FC04" }, // the signature rgb(192,252,4)
  { name: "blue", hex: "#2828FF" }, // the contour field's line blue
  { name: "orange", hex: "#F26706" },
  { name: "pink", hex: "#FF006A" },
  { name: "violet", hex: "#9E86E9" },
  { name: "mint", hex: "#49D99E" },
];

export const DEFAULT_COLOR = COLOR_PRESETS[0].hex;

export function presetIndexOf(hex: string): number {
  const needle = hex.toLowerCase();
  return COLOR_PRESETS.findIndex((c) => c.hex.toLowerCase() === needle);
}
