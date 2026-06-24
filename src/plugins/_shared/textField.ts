/** How a text mask (from the layer below) influences a simulation. */
export type TextMode = "off" | "fill" | "grow" | "attract";

/** Validate an arbitrary prop value into a TextMode (defaults to "off"). */
export function textModeOf(v: unknown): TextMode {
  return v === "fill" || v === "grow" || v === "attract" ? v : "off";
}

const THRESHOLD = 0.5;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Bilinear sample of a gw×gh grid at normalised (x,y) in [0,1] (clamped). */
export function sampleGrid(grid: ArrayLike<number>, gw: number, gh: number, x: number, y: number): number {
  const cx = clamp01(x) * (gw - 1);
  const cy = clamp01(y) * (gh - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(gw - 1, x0 + 1);
  const y1 = Math.min(gh - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const a = grid[y0 * gw + x0];
  const b = grid[y0 * gw + x1];
  const c = grid[y1 * gw + x0];
  const d = grid[y1 * gw + x1];
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

/** Sample a below-layer field into a cols×rows mask in [0,1] (at cell centres). */
export function fieldToMask(
  field: (x: number, y: number, z: number) => number,
  cols: number,
  rows: number,
  out: Float32Array,
): void {
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      out[y * cols + x] = clamp01(field((x + 0.5) / cols, (y + 0.5) / rows, 0));
    }
  }
}

// ── Reaction–Diffusion injections ──

/** grow/fill init: stamp V-rich seed cells where the mask is set. */
export function rdSeedAlongMask(u: Float32Array, v: Float32Array, mask: Float32Array, n: number): void {
  for (let i = 0; i < n; i++) {
    if (mask[i] > THRESHOLD) {
      u[i] = 0.5;
      v[i] = 0.25;
    }
  }
}

/** fill (per step): push cells OUTSIDE the mask back toward U=1,V=0 by strength. */
export function rdConfine(u: Float32Array, v: Float32Array, mask: Float32Array, n: number, strength: number): void {
  const s = clamp01(strength);
  for (let i = 0; i < n; i++) {
    if (mask[i] <= THRESHOLD) {
      u[i] += (1 - u[i]) * s;
      v[i] *= 1 - s;
    }
  }
}

/** attract (per step): nudge V up inside the mask, down outside (accumulates). */
export function rdAttract(v: Float32Array, mask: Float32Array, n: number, strength: number): void {
  const s = clamp01(strength) * 0.04;
  for (let i = 0; i < n; i++) {
    v[i] = clamp01(v[i] + s * (mask[i] - 0.5) * 2);
  }
}

// ── Physarum injections ──

/** fill (per step): damp trail OUTSIDE the mask by strength (confine the network). */
export function physarumConfineTrail(trail: Float32Array, mask: Float32Array, n: number, strength: number): void {
  const s = clamp01(strength);
  for (let i = 0; i < n; i++) {
    if (mask[i] <= THRESHOLD) trail[i] *= 1 - s;
  }
}

/** attract (per step): raise the trail to a scent FLOOR where the mask is set (bounded,
 *  so it can't accumulate without limit across steps). */
export function physarumAttract(trail: Float32Array, mask: Float32Array, n: number, amount: number): void {
  for (let i = 0; i < n; i++) {
    const floor = amount * mask[i];
    if (trail[i] < floor) trail[i] = floor;
  }
}

/** grow/fill init: place agents on masked cells using the given rng (uniform fallback
 *  when the mask has no set cells). Sets position (ax,ay in grid coords) and heading. */
export function physarumSeedAgentsOnMask(
  ax: Float32Array,
  ay: Float32Array,
  ah: Float32Array,
  count: number,
  mask: Float32Array,
  cols: number,
  rows: number,
  rnd: () => number,
): void {
  const cells: number[] = [];
  for (let i = 0; i < cols * rows; i++) if (mask[i] > THRESHOLD) cells.push(i);
  const hasCells = cells.length > 0;
  for (let i = 0; i < count; i++) {
    if (hasCells) {
      const c = cells[Math.floor(rnd() * cells.length)];
      ax[i] = (c % cols) + rnd();
      ay[i] = Math.floor(c / cols) + rnd();
    } else {
      ax[i] = rnd() * cols;
      ay[i] = rnd() * rows;
    }
    ah[i] = rnd() * Math.PI * 2;
  }
}
