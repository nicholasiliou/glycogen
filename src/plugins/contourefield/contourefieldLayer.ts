import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";
import { fieldToMask, resolveTextMode, textSettingOf, type TextMode } from "../_shared/textField";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function arr(v: unknown, f: number[]): number[] {
  return Array.isArray(v) ? (v as number[]) : f;
}

// ── deterministic hash + 3D value-noise ──────────────────────────────────────
// The third axis is the animation axis: instead of sliding the field in X/Y (which
// looks like a panned texture), we evolve through Z. Contours then morph *in place* —
// splitting, merging, drifting — like ripples on water.
function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 1610612741 + seed * 2246822519) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = smooth(x - x0), fy = smooth(y - y0), fz = smooth(z - z0);
  // 8 lattice corners, trilinear blend
  const c000 = hash3(x0,     y0,     z0,     seed);
  const c100 = hash3(x0 + 1, y0,     z0,     seed);
  const c010 = hash3(x0,     y0 + 1, z0,     seed);
  const c110 = hash3(x0 + 1, y0 + 1, z0,     seed);
  const c001 = hash3(x0,     y0,     z0 + 1, seed);
  const c101 = hash3(x0 + 1, y0,     z0 + 1, seed);
  const c011 = hash3(x0,     y0 + 1, z0 + 1, seed);
  const c111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);
  const x00 = c000 + (c100 - c000) * fx;
  const x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx;
  const x11 = c011 + (c111 - c011) * fx;
  const y0v = x00 + (x10 - x00) * fy;
  const y1v = x01 + (x11 - x01) * fy;
  return y0v + (y1v - y0v) * fz; // 0..1
}
/** Fractal Brownian motion in 3D — z is the time/evolution axis. */
function fbm3(x: number, y: number, z: number, seed: number, octaves: number): number {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise3(x * freq, y * freq, z * freq, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm; // 0..1
}

const MAX_CELLS = 200000;

/**
 * Contour / topographic lines — iso-lines from a 3D fBm field via marching squares.
 *
 * Animation works by walking the field's third axis (z) over time rather than
 * translating it, so individual contours mutate in place: loops pinch off, merge, and
 * swim around like a liquid surface. A second, independently-animated domain warp adds
 * the swirling "floating on water" motion. Both motions derive purely from frame.frame,
 * so every frame is reproducible without replaying history — fully seekable.
 */
class ContourFieldRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;

  private cols = 0;
  private rows = 0;
  private grid = new Float32Array(0);
  private mask = new Float32Array(0);
  private maskSoft = new Float32Array(0); // blurred mask: soft falloff into the pattern
  private maskTmp = new Float32Array(0);
  private maskKey = "";
  private maskActive = false;
  private textMode: TextMode = "off";
  private fieldKey = ""; // skip re-sampling when nothing affecting the field changed

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
  }

  private gridSize(resolution: number): [number, number] {
    let cols = Math.max(8, Math.round(this.canvas.width * resolution));
    let rows = Math.max(8, Math.round(this.canvas.height * resolution));
    if (cols * rows > MAX_CELLS) {
      const s = Math.sqrt(MAX_CELLS / (cols * rows));
      cols = Math.max(8, Math.floor(cols * s));
      rows = Math.max(8, Math.floor(rows * s));
    }
    return [cols, rows];
  }

  /**
   * Blur the hard glyph mask into a soft falloff that reaches *past* the letters, so the
   * text bends the surrounding contours instead of stamping a dense plateau on the
   * glyphs themselves. Separable box blur, `passes` iterations of radius `r` — cheap and
   * good enough; three passes approximate a gaussian.
   */
  private blurMask(radius: number): void {
    const { cols, rows } = this;
    const n = cols * rows;
    if (this.maskSoft.length !== n) this.maskSoft = new Float32Array(n);
    if (this.maskTmp.length !== n) this.maskTmp = new Float32Array(n);
    this.maskSoft.set(this.mask);
    const r = Math.max(1, Math.round(radius));
    const passes = 3;
    const src = this.maskSoft;
    const tmp = this.maskTmp;
    const inv = 1 / (r * 2 + 1);

    // record the source peak so we can restore it after blurring. A normalised box blur
    // collapses thin glyph strokes almost to nothing (a 2-cell line spread over ~2r+1
    // cells loses most of its height); re-normalising to the original peak keeps the
    // soft falloff while preserving how *strongly* the text lifts the field.
    let peakBefore = 0;
    for (let i = 0; i < n; i++) if (src[i] > peakBefore) peakBefore = src[i];

    for (let p = 0; p < passes; p++) {
      // horizontal
      for (let y = 0; y < rows; y++) {
        const row = y * cols;
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += src[row + Math.max(0, Math.min(cols - 1, k))];
        for (let x = 0; x < cols; x++) {
          tmp[row + x] = acc * inv;
          const xout = Math.max(0, x - r);
          const xin = Math.min(cols - 1, x + r + 1);
          acc += src[row + xin] - src[row + xout];
        }
      }
      // vertical
      for (let x = 0; x < cols; x++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += tmp[Math.max(0, Math.min(rows - 1, k)) * cols + x];
        for (let y = 0; y < rows; y++) {
          src[y * cols + x] = acc * inv;
          const yout = Math.max(0, y - r) * cols;
          const yin = Math.min(rows - 1, y + r + 1) * cols;
          acc += tmp[yin + x] - tmp[yout + x];
        }
      }
    }

    // restore peak: rescale so the strongest blurred cell matches the original mask peak
    let peakAfter = 0;
    for (let i = 0; i < n; i++) if (src[i] > peakAfter) peakAfter = src[i];
    if (peakAfter > 1e-6) {
      const g = peakBefore / peakAfter;
      for (let i = 0; i < n; i++) src[i] *= g;
    }
  }

  /**
   * Sample the 3D fBm field into the grid.
   *  zEvo  – evolution depth (animates the surface morphing in place)
   *  zWarp – separate depth for the warp field (animates the swirl independently)
   */
  private sampleField(
    scale: number, octaves: number, seed: number,
    zEvo: number, warp: number, zWarp: number, textPush: number,
  ): void {
    const { cols, rows } = this;
    const n = cols * rows;
    if (this.grid.length !== n) this.grid = new Float32Array(n);
    const g = this.grid;
    const fx = scale / cols;
    const fy = scale / rows;
    const soft = this.maskSoft;
    let i = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let sx = x * fx;
        let sy = y * fy;
        if (warp > 0) {
          // domain warp reads its own evolving slice (zWarp) so the swirl drifts
          // on a different rhythm than the elevation — that decoupling is what reads
          // as fluid rather than mechanical.
          const wx = fbm3(sx + 11.3, sy + 4.7, zWarp, seed + 7777, 2) - 0.5;
          const wy = fbm3(sx + 2.1, sy + 19.4, zWarp + 5.0, seed + 3333, 2) - 0.5;
          sx += wx * warp;
          sy += wy * warp;
        }
        let val = fbm3(sx, sy, zEvo, seed, octaves);
        // gentle, soft-edged elevation bump: contours flow *around* the text and crowd
        // slightly near it, rather than a hard plateau on the glyphs.
        if (this.maskActive) val += soft[i] * textPush;
        g[i++] = val;
      }
    }
  }

  /**
   * Single-pass marching squares for *all* levels at once.
   *
   * The old version walked the whole grid once per contour level (levels × cols × rows).
   * Here we walk the grid a single time, and for each cell only touch the levels that
   * actually cross it — derived from the cell's min/max corner values. Segments go into
   * one of two Path2D objects (normal vs. emphasised "index" lines) so the whole draw is
   * two stroke() calls instead of `levels` of them. No per-cell closures: the crossing
   * geometry is computed inline, which keeps the hot loop allocation-free.
   */
  private marchAll(
    levels: number, emphasizeEvery: number,
    sx: number, sy: number,
    pathNormal: Path2D, pathEmph: Path2D,
  ): void {
    const { cols, rows, grid } = this;
    const denom = levels + 1;
    for (let y = 0; y < rows - 1; y++) {
      const r0 = y * cols;
      const r1 = r0 + cols;
      for (let x = 0; x < cols - 1; x++) {
        const tl = grid[r0 + x];
        const tr = grid[r0 + x + 1];
        const br = grid[r1 + x + 1];
        const bl = grid[r1 + x];

        // which levels cross this cell? only those strictly between min and max corner.
        let lo = tl, hi = tl;
        if (tr < lo) lo = tr; else if (tr > hi) hi = tr;
        if (br < lo) lo = br; else if (br > hi) hi = br;
        if (bl < lo) lo = bl; else if (bl > hi) hi = bl;
        // level k sits at k/denom; find the k-range inside (lo,hi]
        let kStart = Math.floor(lo * denom) + 1;
        let kEnd = Math.floor(hi * denom);
        if (kStart < 1) kStart = 1;
        if (kEnd > levels) kEnd = levels;
        if (kStart > kEnd) continue; // no contour through this cell — the common case

        const xL = x * sx;
        const xR = (x + 1) * sx;
        const yT = y * sy;
        const yB = (y + 1) * sy;

        for (let k = kStart; k <= kEnd; k++) {
          const level = k / denom;
          let code = 0;
          if (tl > level) code |= 8;
          if (tr > level) code |= 4;
          if (br > level) code |= 2;
          if (bl > level) code |= 1;
          if (code === 0 || code === 15) continue;

          const p = (emphasizeEvery > 0 && k % emphasizeEvery === 0) ? pathEmph : pathNormal;

          // crossing points, computed only when this code path needs them
          // top:    between tl..tr at yT
          // right:  between tr..br at xR
          // bottom: between bl..br at yB
          // left:   between tl..bl at xL
          switch (code) {
            case 1: case 14: { // left → bottom
              const ay = yT + (level - tl) / (bl - tl || 1e-6) * (yB - yT);
              const bx = xL + (level - bl) / (br - bl || 1e-6) * (xR - xL);
              p.moveTo(xL, ay); p.lineTo(bx, yB); break;
            }
            case 2: case 13: { // bottom → right
              const ax = xL + (level - bl) / (br - bl || 1e-6) * (xR - xL);
              const by = yT + (level - tr) / (br - tr || 1e-6) * (yB - yT);
              p.moveTo(ax, yB); p.lineTo(xR, by); break;
            }
            case 3: case 12: { // left → right
              const ay = yT + (level - tl) / (bl - tl || 1e-6) * (yB - yT);
              const by = yT + (level - tr) / (br - tr || 1e-6) * (yB - yT);
              p.moveTo(xL, ay); p.lineTo(xR, by); break;
            }
            case 4: case 11: { // top → right
              const ax = xL + (level - tl) / (tr - tl || 1e-6) * (xR - xL);
              const by = yT + (level - tr) / (br - tr || 1e-6) * (yB - yT);
              p.moveTo(ax, yT); p.lineTo(xR, by); break;
            }
            case 6: case 9: { // top → bottom
              const ax = xL + (level - tl) / (tr - tl || 1e-6) * (xR - xL);
              const bx = xL + (level - bl) / (br - bl || 1e-6) * (xR - xL);
              p.moveTo(ax, yT); p.lineTo(bx, yB); break;
            }
            case 7: case 8: { // top → left
              const ax = xL + (level - tl) / (tr - tl || 1e-6) * (xR - xL);
              const ay = yT + (level - tl) / (bl - tl || 1e-6) * (yB - yT);
              p.moveTo(ax, yT); p.lineTo(xL, ay); break;
            }
            case 5: case 10: { // saddle — two segments
              const center = (tl + tr + br + bl) * 0.25;
              const tX = xL + (level - tl) / (tr - tl || 1e-6) * (xR - xL); // top
              const bX = xL + (level - bl) / (br - bl || 1e-6) * (xR - xL); // bottom
              const lY = yT + (level - tl) / (bl - tl || 1e-6) * (yB - yT); // left
              const rY = yT + (level - tr) / (br - tr || 1e-6) * (yB - yT); // right
              if ((code === 5) === (center > level)) {
                p.moveTo(tX, yT); p.lineTo(xL, lY);
                p.moveTo(bX, yB); p.lineTo(xR, rY);
              } else {
                p.moveTo(tX, yT); p.lineTo(xR, rY);
                p.moveTo(bX, yB); p.lineTo(xL, lY);
              }
              break;
            }
          }
        }
      }
    }
  }

  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.resize(frame.width, frame.height);
    }
    const pr = frame.props;
    const resolution = Math.max(0.05, Math.min(0.5, num(pr.resolution, 0.22)));
    const [cols, rows] = this.gridSize(resolution);
    this.cols = cols;
    this.rows = rows;

    const seed = Math.round(num(pr.seed, 1));
    const scale = Math.max(1, num(pr.scale, 6));
    const octaves = Math.max(1, Math.min(8, Math.round(num(pr.octaves, 4))));
    const warp = Math.max(0, num(pr.warp, 0.4));
    const levels = Math.max(2, Math.min(60, Math.round(num(pr.levels, 18))));

    // ── animation: walk through the noise's z-axis instead of translating XY ──
    const evolveSpeed = num(pr.evolveSpeed, 1.0); // how fast contours morph in place
    const swirlSpeed = num(pr.swirlSpeed, 0.6);   // how fast the warp swims around
    const zEvo = frame.frame * evolveSpeed * 0.01;
    const zWarp = frame.frame * swirlSpeed * 0.01;

    // ── text-field influence (same wiring as the sim layers) ──
    // textPush: how strongly text lifts the field (small → contours bend, don't pile up)
    // textRange: blur radius in grid cells → how far the influence feathers past the glyphs
    const textPush = num(pr.textPush, 0.35);
    const textRange = Math.max(1, num(pr.textRange, 3));
    const textSrc = frame.textField ?? frame.below;
    const mode = resolveTextMode(textSettingOf(textSrc?.props?.textInfluence), !!textSrc?.field);
    const field = mode !== "off" ? textSrc?.field : undefined;
    this.textMode = mode;
    if (field) {
      const key = `${textSrc?.key ?? ""}|${cols}x${rows}|${textRange}`;
      if (this.mask.length !== cols * rows) this.mask = new Float32Array(cols * rows);
      if (key !== this.maskKey) {
        fieldToMask(field, cols, rows, this.mask);
        // modest, resolution-aware feather (kept small so strokes don't dissolve)
        this.blurMask(textRange * (cols / 600 + 0.4));
        this.maskKey = key;
      }
      this.maskActive = true;
    } else {
      this.maskActive = false;
      this.maskKey = "";
    }

    // Only re-sample the noise field when something that affects it actually changed.
    // When the user is tweaking *other* layers, or sitting on a static (non-animated)
    // frame, this skips the whole fbm3 pass — the single biggest editor-lag win.
    const animated = evolveSpeed !== 0 || swirlSpeed !== 0;
    const fieldKey = animated
      ? "anim" // animated frames always differ, force resample
      : `${seed}|${scale}|${octaves}|${warp}|${textPush}|${this.maskKey}|${cols}x${rows}`;
    if (animated || fieldKey !== this.fieldKey) {
      this.sampleField(scale, octaves, seed, zEvo, warp, zWarp, textPush);
      this.fieldKey = fieldKey;
    }

    // ── draw ──
    const w = this.canvas.width;
    const h = this.canvas.height;
    const sx = w / (cols - 1);
    const sy = h / (rows - 1);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    const [bgR, bgG, bgB, bgA] = arr(pr.background, [0, 0, 0, 0]);
    if (bgA > 0) {
      ctx.fillStyle = `rgba(${bgR},${bgG},${bgB},${bgA / 255})`;
      ctx.fillRect(0, 0, w, h);
    }

    const [lr, lg, lb, la] = arr(pr.lineColor, [40, 40, 255, 255]);
    const lineWidth = Math.max(0.25, num(pr.lineWidth, 1));
    const emphasizeEvery = Math.max(0, Math.round(num(pr.emphasizeEvery, 5)));
    const emphasisMul = Math.max(1, num(pr.emphasisMul, 2.2));

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = `rgba(${lr},${lg},${lb},${la / 255})`;

    // accumulate every contour into two paths (thin + emphasised), then stroke twice.
    const pathNormal = new Path2D();
    const pathEmph = new Path2D();
    this.marchAll(levels, emphasizeEvery, sx, sy, pathNormal, pathEmph);

    ctx.lineWidth = lineWidth;
    ctx.stroke(pathNormal);
    if (emphasizeEvery > 0) {
      ctx.lineWidth = lineWidth * emphasisMul;
      ctx.stroke(pathEmph);
    }

    return this.canvas;
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
    this.grid = this.mask = this.maskSoft = this.maskTmp = new Float32Array(0);
  }
}

export const contourFieldLayerType: LayerTypeDefinition = {
  type: "contourField",
  label: "Contour Field",
  category: "Generative",
  icon: "Waves",
  description: "Topographic iso-lines from a 3D fBm field via marching squares. Contours morph in place like a liquid surface. Deterministic & seekable.",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "scale", name: "Feature Scale", type: "number", default: 6, group: "Field", meta: { min: 1, max: 40, step: 0.5 } },
    { key: "octaves", name: "Octaves", type: "number", default: 4, group: "Field", meta: { min: 1, max: 8, step: 1 } },
    { key: "warp", name: "Domain Warp", type: "number", default: 0.4, group: "Field", meta: { min: 0, max: 2, step: 0.05 } },
    { key: "seed", name: "Seed", type: "number", default: 1, group: "Field", animatable: false, meta: { min: 0, max: 99999, step: 1 } },
    { key: "evolveSpeed", name: "Evolve Speed", type: "number", default: 1.0, group: "Motion", meta: { min: 0, max: 5, step: 0.1 } },
    { key: "swirlSpeed", name: "Swirl Speed", type: "number", default: 0.6, group: "Motion", meta: { min: 0, max: 5, step: 0.1 } },
    { key: "levels", name: "Contour Levels", type: "number", default: 18, group: "Lines", meta: { min: 2, max: 60, step: 1 } },
    { key: "lineColor", name: "Line Color", type: "color", default: [40, 40, 255, 255], group: "Lines" },
    { key: "lineWidth", name: "Line Width", type: "number", default: 1, group: "Lines", meta: { min: 0.25, max: 6, step: 0.25 } },
    { key: "emphasizeEvery", name: "Index Line Every", type: "number", default: 5, group: "Lines", meta: { min: 0, max: 12, step: 1 } },
    { key: "emphasisMul", name: "Index Line Weight", type: "number", default: 2.2, group: "Lines", meta: { min: 1, max: 5, step: 0.1 } },
    { key: "background", name: "Background", type: "color", default: [0, 0, 0, 0], group: "Look" },
    { key: "resolution", name: "Resolution (perf)", type: "percent", default: 0.22, group: "Look", animatable: false, meta: { min: 0.05, max: 0.5, step: 0.01 } },
    { key: "textPush", name: "Text Push", type: "number", default: 0.35, group: "Text", meta: { min: 0, max: 1.5, step: 0.01 } },
    { key: "textRange", name: "Text Falloff", type: "number", default: 3, group: "Text", meta: { min: 1, max: 12, step: 0.5 } },
  ],
  createRenderer: () => new ContourFieldRenderer(),
};