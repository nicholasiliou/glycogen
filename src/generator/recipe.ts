import type { RGBA, ResolutionPreset } from "@/engine";

/** Element-Typen, die der Simple Mode dieser Iteration anbietet. */
export type ElementType = "noise" | "boids" | "text";

export const SIMPLE_ELEMENTS: { type: ElementType; label: string; icon: string }[] = [
  { type: "noise", label: "Noise", icon: "Cloudy" },
  { type: "boids", label: "Boids", icon: "Bird" },
  { type: "text", label: "Text", icon: "Type" },
];

export interface Recipe {
  /** Gewählte Element-Typen (Reihenfolge egal). */
  elements: ElementType[];
  /** 0..1 — Bewegungsintensität. */
  dynamic: number;
  /** 0..1 — Dichte & Detail. */
  complexity: number;
  /** "Würfeln" ändert nur das. */
  seed: number;
  /** Social-Format (Breite/Höhe der Komposition). */
  format: { label: string; width: number; height: number };
}

/** Marathon-Hausstil: dunkler Hintergrund + 6-Farben-Palette für fx.colorLookup. */
export const MARATHON_BG: RGBA = [12, 12, 16, 255];
export const MARATHON_PALETTE: RGBA[] = [
  [255, 90, 31, 255], // orange
  [234, 2, 126, 255], // magenta
  [0, 200, 180, 255], // teal
  [30, 20, 90, 255], // deep blue
  [12, 12, 16, 255], // near-black
  [235, 235, 240, 255], // off-white
];

/** Kurze, on-brand Phrasen, aus denen der Text-Layer per Seed eine wählt. */
export const MARATHON_TAGLINES = ["MARATHON", "RUN IT BACK", "NO ESCAPE", "RECLAIM", "SEVENTH COLUMN"];

export const DEFAULT_RECIPE: Recipe = {
  elements: ["noise", "boids"],
  dynamic: 0.5,
  complexity: 0.5,
  seed: 1,
  format: { label: "Instagram Story / Reel", width: 1080, height: 1920 },
};

/** Helper: ein ResolutionPreset auf das Recipe-Format reduzieren. */
export function formatFromPreset(p: ResolutionPreset): Recipe["format"] {
  return { label: p.label, width: p.width, height: p.height };
}
