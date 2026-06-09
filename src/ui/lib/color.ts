/** Helpers for the [r,g,b,a] (0..255) colour arrays the engine uses. */

export type RGBAArr = [number, number, number, number];

export function toRGBA(v: unknown): RGBAArr {
  if (Array.isArray(v)) {
    const [r, g, b, a] = v as number[];
    return [r ?? 0, g ?? 0, b ?? 0, a ?? 255];
  }
  return [0, 0, 0, 255];
}

export function toHex(v: unknown): string {
  const [r, g, b] = toRGBA(v);
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRGB(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function cssRGBA(v: unknown): string {
  const [r, g, b, a] = toRGBA(v);
  return `rgba(${r},${g},${b},${a / 255})`;
}
