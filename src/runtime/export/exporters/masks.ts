import type { AspectRatioId } from "./aspectRatios";

/**
 * Mask registry: each aspect ratio maps to a folder in /masks/{aspectRatio}/. Masks are numbered
 * (1.svg, 2.svg, etc.) and stored with a count of how many exist. A mask is an alpha cut-out  - 
 * its white area is the visible region; everything else becomes transparent (PNG) or black (video).
 *
 * The frontend exposes a simple on/off toggle; when enabled, a random mask from the aspect
 * ratio's folder is selected at export time. To add a variant, drop a numbered SVG in the
 * appropriate folder (e.g., public/masks/16x9/2.svg) and update MASK_COUNTS below.
 */
export interface MaskVariant {
  id: string;
  label: string;
  /** URL of the SVG mask folder, served statically. Random selection happens at export time. */
  url: string;
}

/** Number of masks available in each folder. Update when adding new masks. Ratios without an
 *  entry (the A-series poster sizes) simply have no masks. */
export const MASK_COUNTS: Partial<Record<AspectRatioId, number>> = {
  "16:9": 1,
  "9:16": 1,
  "1:1": 1,
  "4:5": 1,
  custom: 1,
};

import { asset } from "@/lib/asset";

export const MASK_FOLDERS: Partial<Record<AspectRatioId, string>> = {
  "16:9": asset("/masks/16x9"),
  "9:16": asset("/masks/9x16"),
  "1:1": asset("/masks/1x1"),
  "4:5": asset("/masks/4x5"),
  custom: asset("/masks/1x1"),
};

/**
 * Get mask variants for an aspect ratio. Since masks are now folder-based,
 * we create a single variant that represents the random selection feature.
 */
export function masksFor(ratio: AspectRatioId): MaskVariant[] {
  const folder = MASK_FOLDERS[ratio];
  if (!folder) return [];
  // Return a single variant representing the folder (random selection happens at export time)
  return [{ id: "folder", label: "Random frame", url: folder }];
}
