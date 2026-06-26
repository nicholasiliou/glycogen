/**
 * Export aspect ratios. The composition keeps its own size; these are applied only at export
 * time by fitting/cropping the rendered frame into the target dimensions (see frameCanvas).
 */

export type AspectRatioId = "16:9" | "9:16" | "1:1" | "4:5" | "custom";

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
};

export const ASPECT_RATIO_LIST: AspectRatio[] = Object.values(ASPECT_RATIOS);

/** Resolve an aspect-ratio choice to concrete dimensions; `custom` needs an explicit size. */
export function resolveAspectRatio(id: AspectRatioId, custom?: { width: number; height: number }): AspectRatio {
  if (id === "custom") {
    const width = Math.max(1, Math.round(custom?.width ?? 1080));
    const height = Math.max(1, Math.round(custom?.height ?? 1080));
    return { id: "custom", label: `Custom ${width}×${height}`, width, height };
  }
  return ASPECT_RATIOS[id];
}
