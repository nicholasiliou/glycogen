/** A pixel glyph: a w×h grid of 0/1, row-major. Stored in layer `data` (serializable). */
export interface GlyphData {
  w: number;
  h: number;
  pixels: number[];
}

export function emptyGlyph(w = 8, h = 8): GlyphData {
  return { w, h, pixels: new Array(w * h).fill(0) };
}

export function cloneGlyph(g: GlyphData): GlyphData {
  return { w: g.w, h: g.h, pixels: g.pixels.slice() };
}

/** Resize a glyph, preserving the overlapping top-left region. */
export function resizeGlyph(g: GlyphData, w: number, h: number): GlyphData {
  const out = emptyGlyph(w, h);
  for (let y = 0; y < Math.min(h, g.h); y++) {
    for (let x = 0; x < Math.min(w, g.w); x++) {
      out.pixels[y * w + x] = g.pixels[y * g.w + x];
    }
  }
  return out;
}

function fromRows(rows: string[]): GlyphData {
  const h = rows.length;
  const w = rows[0].length;
  const pixels: number[] = [];
  for (const r of rows) for (const c of r) pixels.push(c === "#" || c === "X" || c === "1" ? 1 : 0);
  return { w, h, pixels };
}

export const BUILTIN_GLYPHS: { name: string; glyph: GlyphData }[] = [
  { name: "Arrow", glyph: fromRows([
    "........",
    "...#....",
    "...##...",
    "#######.",
    "#######.",
    "...##...",
    "...#....",
    "........",
  ]) },
  { name: "Heart", glyph: fromRows([
    ".##..##.",
    "########",
    "########",
    "########",
    ".######.",
    "..####..",
    "...##...",
    "........",
  ]) },
  { name: "Skull", glyph: fromRows([
    ".######.",
    "#.####.#",
    "##.##.##",
    "########",
    "#.####.#",
    ".######.",
    "..#..#..",
    ".#.##.#.",
  ]) },
  { name: "Diamond", glyph: fromRows([
    "...#....",
    "..###...",
    ".#####..",
    "#######.",
    ".#####..",
    "..###...",
    "...#....",
    "........",
  ]) },
  { name: "Face", glyph: fromRows([
    ".######.",
    "#......#",
    "#.#..#.#",
    "#......#",
    "#.#..#.#",
    "#..##..#",
    "#......#",
    ".######.",
  ]) },
  { name: "Cross", glyph: fromRows([
    "#......#",
    ".#....#.",
    "..#..#..",
    "...##...",
    "...##...",
    "..#..#..",
    ".#....#.",
    "#......#",
  ]) },
];

export function randomGlyph(seed = Math.random() * 1e9): GlyphData {
  const i = Math.floor(((seed | 0) >>> 0) % BUILTIN_GLYPHS.length);
  return cloneGlyph(BUILTIN_GLYPHS[Math.abs(i)] ? BUILTIN_GLYPHS[Math.abs(i)].glyph : BUILTIN_GLYPHS[0].glyph);
}

/** Add a glyph's filled-pixel rects to the current path (caller batches the fill). */
export function addGlyphRects(
  ctx: CanvasRenderingContext2D,
  g: GlyphData,
  x: number,
  y: number,
  cell: number,
  gap = 0,
): void {
  const s = Math.max(0.5, cell - gap);
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (g.pixels[j * g.w + i]) ctx.rect(x + i * cell, y + j * cell, s, s);
    }
  }
}
