import { useEffect, useState } from "react";
import { BUILTIN_GLYPHS, cloneGlyph, type GlyphData } from "@/plugins/glyph/glyphData";

/**
 * Persistent glyph preset library (localStorage). UI-only — the engine stays pure by
 * keeping glyph pixels in each layer's `data`; this library is just for authoring,
 * picking and reusing glyphs across layers/sessions.
 */
const KEY = "marathon.glyphs.v1";

export interface GlyphPreset {
  id: string;
  name: string;
  glyph: GlyphData;
  builtin?: boolean;
}

let cache: GlyphPreset[] | null = null;
const listeners = new Set<() => void>();

function seed(): GlyphPreset[] {
  return BUILTIN_GLYPHS.map((b, i) => ({ id: `builtin_${i}`, name: b.name, glyph: cloneGlyph(b.glyph), builtin: true }));
}

function load(): GlyphPreset[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) cache = JSON.parse(raw) as GlyphPreset[];
    else {
      cache = seed();
      persist();
    }
  } catch {
    cache = seed();
  }
  return cache!;
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage disabled — keep in-memory */
  }
  listeners.forEach((l) => l());
}

export function listGlyphs(): GlyphPreset[] {
  return load();
}

export function saveGlyph(name: string, glyph: GlyphData): GlyphPreset {
  const preset: GlyphPreset = {
    id: `g_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name || "glyph",
    glyph: cloneGlyph(glyph),
  };
  load().push(preset);
  persist();
  return preset;
}

export function deleteGlyph(id: string): void {
  cache = load().filter((p) => p.id !== id);
  persist();
}

export function subscribeGlyphs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useGlyphLibrary(): GlyphPreset[] {
  const [, bump] = useState(0);
  useEffect(() => subscribeGlyphs(() => bump((v) => v + 1)), []);
  return listGlyphs();
}
