/**
 * Deterministic mulberry32 PRNG. Seeds are pre-scrambled with the
 * golden-ratio constant (`^ 0x9e3779b9`) so nearby seeds diverge quickly;
 * note this yields a different sequence than the raw mulberry32 inlined in
 * some plugins (e.g. BoidsLayer, NoiseLayer).
 */
export function makeRng(seed: number): () => number {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Deterministically pick one item using the given rng.
 *
 * @param items - Must be non-empty.
 * @param rng   - A `[0,1)` random function, e.g. from `makeRng`.
 */
export function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)];
}
