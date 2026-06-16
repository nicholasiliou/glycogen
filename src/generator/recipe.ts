import type { RGBA, ResolutionPreset } from "@/engine";

/** Curated visual layer types selectable as Simple-Mode elements (containers, pure
 *  effects and upload-only `model`/`slicer` are intentionally excluded). Each id is a
 *  real registered layer `type`; see ELEMENT_TUNING in plan.ts for how each is driven. */
export type ElementType =
  | "solid"
  | "text"
  | "glyph"
  | "noise"
  | "cloud"
  | "plant"
  | "harmonograph"
  | "wire"
  | "glyphScatter"
  | "shape"
  | "landscape"
  | "boids"
  | "life"
  | "reactionDiffusion"
  | "physarum";

/** Selectable elements for the Simple-Mode chip picker, in display order. */
export const SIMPLE_ELEMENTS: { type: ElementType; label: string }[] = [
  { type: "solid", label: "Solid" },
  { type: "text", label: "Text" },
  { type: "glyph", label: "Glyph" },
  { type: "noise", label: "Noise" },
  { type: "cloud", label: "Cloud" },
  { type: "plant", label: "Plant" },
  { type: "harmonograph", label: "Harmonograph" },
  { type: "wire", label: "Wire" },
  { type: "glyphScatter", label: "Glyph Scatter" },
  { type: "shape", label: "3D Shape" },
  { type: "landscape", label: "Landscape" },
  { type: "boids", label: "Boids" },
  { type: "life", label: "Game of Life" },
  { type: "reactionDiffusion", label: "Reaction–Diffusion" },
  { type: "physarum", label: "Slime Mold" },
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
