/**
 * The app-wide color presets. Every plugin declares a native draw color from this palette (the
 * `nativeColor` field on the {@link Plugin} factory), and every layer carries a factory `color`
 * cycle that recolors its final output through the same presets  -  so "which colors exist" lives
 * in exactly one place.
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
  { name: "white", hex: "#FFFFFF" },
  { name: "red", hex: "#B30001" },
];

export const DEFAULT_COLOR = COLOR_PRESETS[0].hex;

/** The factory `color` cycle's options  -  every preset. */
export const COLOR_CYCLE: readonly string[] = COLOR_PRESETS.map((c) => c.name);

/** Map a `color` cycle press count to a preset hex. */
export function cycleHex(count: number): string {
  const i = count % COLOR_CYCLE.length;
  return COLOR_PRESETS[i].hex;
}
