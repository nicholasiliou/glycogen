/**
 * Export aspect ratios. The composition keeps its own size; these are applied only at export
 * time by fitting/cropping the rendered frame into the target dimensions (see frameCanvas).
 */

export type AspectRatioId = "16:9" | "9:16" | "1:1" | "4:5" | "A4" | "A3" | "A2" | "A1" | "custom";

export interface AspectRatio {
  id: AspectRatioId;
  label: string;
  /** Target pixel size of the exported frame. */
  width: number;
  height: number;
}

/** The fixed presets, in display order. `custom` is resolved separately (see resolveAspectRatio). */
export const ASPECT_RATIOS: Record<Exclude<AspectRatioId, "custom">, AspectRatio> = {
  "16:9": { id: "16:9", label: "16:9 landscape", width: 1920, height: 1080 },
  "9:16": { id: "9:16", label: "9:16 portrait", width: 1080, height: 1920 },
  "1:1": { id: "1:1", label: "1:1 square", width: 1080, height: 1080 },
  "4:5": { id: "4:5", label: "4:5 portrait", width: 1080, height: 1350 },
  // ISO A-series posters (portrait, 1:√2) at a 150 dpi base — the Max quality preset's 2×
  // supersample lands exactly on 300 dpi, i.e. print-ready pixel dimensions.
  A4: { id: "A4", label: "A4 poster", width: 1240, height: 1754 },
  A3: { id: "A3", label: "A3 poster", width: 1754, height: 2480 },
  A2: { id: "A2", label: "A2 poster", width: 2480, height: 3508 },
  A1: { id: "A1", label: "A1 poster", width: 3508, height: 4967 },
};

export const ASPECT_RATIO_LIST: AspectRatio[] = Object.values(ASPECT_RATIOS);

/** Screen-destined ratios (social/video framings), shown as the primary row in the panel. */
export const SCREEN_RATIO_LIST: AspectRatio[] = (["16:9", "9:16", "1:1", "4:5"] as const).map((id) => ASPECT_RATIOS[id]);

/** Print-destined poster sizes. Stills only — video makes no sense at print resolution. */
export const PRINT_RATIO_LIST: AspectRatio[] = (["A4", "A3", "A2", "A1"] as const).map((id) => ASPECT_RATIOS[id]);

export function isPrintRatio(id: AspectRatioId): boolean {
  return PRINT_RATIO_LIST.some((r) => r.id === id);
}

/**
 * Resolve an aspect-ratio choice to concrete dimensions. `custom` is a *relative* ratio (e.g.
 * 21:9, 2:3), not pixels: the short side is pinned to 1080 and the long side derived, capped at
 * 3840 so extreme ratios can't allocate absurd canvases.
 */
export function resolveAspectRatio(id: AspectRatioId, custom?: { width: number; height: number }): AspectRatio {
  if (id === "custom") {
    const rw = Math.max(1, custom?.width ?? 1);
    const rh = Math.max(1, custom?.height ?? 1);
    const scale = Math.min(1080 / Math.min(rw, rh), 3840 / Math.max(rw, rh));
    return {
      id: "custom",
      label: `Custom ${rw}:${rh}`,
      width: Math.max(1, Math.round(rw * scale)),
      height: Math.max(1, Math.round(rh * scale)),
    };
  }
  return ASPECT_RATIOS[id];
}
