import type { AspectRatioId } from "./aspectRatios";

/**
 * Mask registry: each aspect ratio maps to one or more SVG mask files served from /masks. A mask
 * is an alpha cut-out — its white area is the visible region; everything else becomes transparent
 * (PNG) or black (video). The frontend exposes a simple on/off toggle (and, when more than one
 * variant exists, picks an index); the export bakes the chosen mask into the frame.
 *
 * To add a variant, drop an SVG in public/masks and list its URL here. The first entry in each
 * list is the default. `custom` reuses the 1:1 set as a sensible fallback.
 */
export interface MaskVariant {
  id: string;
  label: string;
  /** URL of the SVG mask, served statically (white = keep, transparent/black = cut). */
  url: string;
}

const SQUARE_MASKS: MaskVariant[] = [
  { id: "default", label: "Rounded frame", url: "/mask.svg" },
];

export const MASKS: Record<AspectRatioId, MaskVariant[]> = {
  "16:9": [{ id: "default", label: "Rounded frame", url: "/mask.svg" }],
  "9:16": SQUARE_MASKS,
  "1:1": SQUARE_MASKS,
  "4:5": SQUARE_MASKS,
  custom: SQUARE_MASKS,
};

/** All mask variants offered for an aspect ratio (may be empty if none are registered). */
export function masksFor(ratio: AspectRatioId): MaskVariant[] {
  return MASKS[ratio] ?? [];
}
