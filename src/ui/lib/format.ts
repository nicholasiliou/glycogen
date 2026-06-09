/** Formatting helpers shared across panels. */

export function formatTimecode(time: number, fps: number): string {
  const totalFrames = Math.round(time * fps);
  const f = ((totalFrames % fps) + fps) % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

export function roundTo(n: number, step = 0.01): number {
  return Math.round(n / step) * step;
}

/** Trim float noise for display. */
export function fmtNum(n: number): string {
  if (!isFinite(n)) return "0";
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/\.?0+$/, "");
}
