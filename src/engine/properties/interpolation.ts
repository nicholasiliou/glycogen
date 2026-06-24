import type { PropertyValue } from "../core/types";

export type Interpolation = "linear" | "stepped" | "smooth" | "bezier";

export function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** AE-style clamped remap: map x from [ix0,ix1] onto [ox0,ox1]. */
export function linearMap(
  x: number,
  ix0: number,
  ix1: number,
  ox0: number,
  ox1: number,
): number {
  if (ix0 === ix1) return ox0;
  const t = clamp((x - ix0) / (ix1 - ix0), 0, 1);
  return ox0 + (ox1 - ox0) * t;
}

export function smoothstep(t: number): number {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Cubic-bezier temporal easing solver (the same maths as CSS `cubic-bezier`).
 * Endpoints are fixed at (0,0) and (1,1); handles are [x1,y1,x2,y2]. Returns an
 * easing function mapping linear t -> eased t. Solved with Newton-Raphson plus a
 * bisection fallback for robustness near flat regions.
 */
export function cubicBezierEase(
  handles: [number, number, number, number],
): (t: number) => number {
  const [x1, y1, x2, y2] = handles;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  const solveX = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const xe = sampleX(t) - x;
      if (Math.abs(xe) < 1e-6) return t;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= xe / d;
    }
    // Bisection fallback
    let lo = 0;
    let hi = 1;
    t = x;
    while (lo < hi) {
      const xe = sampleX(t);
      if (Math.abs(xe - x) < 1e-6) return t;
      if (x > xe) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleY(solveX(t));
  };
}

/**
 * Interpolate between two property values. Numbers and numeric arrays (point,
 * colour) interpolate component-wise; everything else holds the left value.
 */
export function interpValue(
  a: PropertyValue,
  b: PropertyValue,
  t: number,
): PropertyValue {
  if (typeof a === "number" && typeof b === "number") return lerp(a, b, t);
  if (Array.isArray(a) && Array.isArray(b)) {
    const out: number[] = [];
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) out[i] = lerp(a[i] ?? 0, b[i] ?? 0, t);
    return out;
  }
  return a; // boolean / string → stepped hold
}
