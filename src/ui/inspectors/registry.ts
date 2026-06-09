import type { FC } from "react";
import type { Layer } from "@/engine";
import { GlyphInspector } from "./GlyphInspector";
import { GlyphScatterInspector } from "./GlyphScatterInspector";
import { ModelInspector } from "./ModelInspector";

/**
 * Layer types that supply a custom inspector section (rendered above their schema
 * controls) — the UI-side extension point parallel to the engine's plugin registry.
 */
export const CUSTOM_INSPECTORS: Record<string, FC<{ layer: Layer }>> = {
  glyph: GlyphInspector,
  glyphScatter: GlyphScatterInspector,
  model: ModelInspector,
};
