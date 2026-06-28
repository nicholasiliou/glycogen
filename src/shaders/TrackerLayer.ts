import type { LayerTypeDefinition } from "../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../engine/render/types";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function arr(v: unknown, f: number[]): number[] {
  return Array.isArray(v) ? (v as number[]) : f;
}
function str(v: unknown, f: string): string {
  return typeof v === "string" ? v : f;
}

interface TrackedRegion {
  cx: number;
  cy: number;
  w: number;
  h: number;
  score: number;
}

function findRegions(
  bd: HTMLCanvasElement,
  count: number,
  gridCols: number,
  gridRows: number,
): TrackedRegion[] {
  const oc = document.createElement("canvas");
  oc.width = gridCols;
  oc.height = gridRows;
  const oc2d = oc.getContext("2d")!;
  oc2d.drawImage(bd, 0, 0, gridCols, gridRows);
  const pixels = oc2d.getImageData(0, 0, gridCols, gridRows).data;

  const scores: { col: number; row: number; score: number }[] = [];
  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const idx = (row * gridCols + col) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const a = pixels[idx + 3] / 255;
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      scores.push({ col, row, score: lum * a });
    }
  }
  scores.sort((a, b) => b.score - a.score);

  const minSep = Math.max(2, Math.floor(Math.min(gridCols, gridRows) / (count + 1)));
  const picked: typeof scores = [];
  for (const cell of scores) {
    if (picked.length >= count) break;
    const tooClose = picked.some(
      (p) => Math.abs(p.col - cell.col) < minSep && Math.abs(p.row - cell.row) < minSep,
    );
    if (!tooClose) picked.push(cell);
  }

  if (picked.length === 0) {
    for (let i = 0; i < count; i++) {
      picked.push({ col: Math.floor((i * gridCols) / count), row: 0, score: 0 });
    }
  }
  while (picked.length < count) {
    picked.push({ col: Math.floor(Math.random() * gridCols), row: Math.floor(Math.random() * gridRows), score: 0 });
  }

  const cellW = 1 / gridCols;
  const cellH = 1 / gridRows;

  return picked.map((p) => ({
    cx: (p.col + 0.5) / gridCols,
    cy: (p.row + 0.5) / gridRows,
    w: cellW * 3,
    h: cellH * 3,
    score: p.score,
  }));
}

const DIRECTIONS: Record<string, [number, number]> = {
  "up":         [ 0, -1],
  "down":       [ 0,  1],
  "left":       [-1,  0],
  "right":      [ 1,  0],
  "up-left":    [-1, -1],
  "up-right":   [ 1, -1],
  "down-left":  [-1,  1],
  "down-right": [ 1,  1],
  "outward":    [ 0,  0],
};

function dirVector(name: string, cx: number, cy: number): [number, number] {
  if (name === "outward") {
    const dx = cx - 0.5;
    const dy = cy - 0.5;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return [dx / len, dy / len];
  }
  const d = DIRECTIONS[name] ?? [1, 0];
  const len = Math.sqrt(d[0] * d[0] + d[1] * d[1]) || 1;
  return [d[0] / len, d[1] / len];
}

class TrackerRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private regions: TrackedRegion[] = [];

  render(frame: RenderFrame): HTMLCanvasElement | null {
    const bd = frame.backdrop;
    if (!bd) return null;

    const w = frame.width;
    const h = frame.height;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    const p = frame.props;
    const count = Math.max(1, Math.min(5, Math.round(num(p.count, 1))));
    const grid = Math.max(8, Math.min(64, Math.round(num(p.grid, 24))));
    const lineLen = num(p.lineLength, 0.6);
    const direction = str(p.direction, "outward");
    const boxColor = arr(p.boxColor, [192, 252, 4, 255]);
    const lineColor = arr(p.lineColor, [192, 252, 4, 180]);
    const boxThick = num(p.boxThickness, 1.5);
    const lineThick = num(p.lineThickness, 1);
    const smoothing = Math.max(0, Math.min(0.99, num(p.smoothing, 0.7)));
    const showBackdrop = p.showBackdrop !== false;
    const dashLen = num(p.dashLength, 0);

    const sampleEvery = Math.max(1, Math.round(num(p.sampleRate, 1)));
    const frameIdx = frame.frame;

    let targets: TrackedRegion[];
    if (frameIdx % sampleEvery === 0) {
      targets = findRegions(bd, count, grid, grid);
    } else {
      targets = this.regions.length >= count ? this.regions : findRegions(bd, count, grid, grid);
    }

    if (this.regions.length !== targets.length) {
      this.regions = targets;
    } else {
      this.regions = this.regions.map((old, i) => ({
        cx: old.cx * smoothing + targets[i].cx * (1 - smoothing),
        cy: old.cy * smoothing + targets[i].cy * (1 - smoothing),
        w: old.w * smoothing + targets[i].w * (1 - smoothing),
        h: old.h * smoothing + targets[i].h * (1 - smoothing),
        score: targets[i].score,
      }));
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    if (showBackdrop) ctx.drawImage(bd, 0, 0, w, h);

    const diag = Math.sqrt(w * w + h * h);
    const strokeBox = `rgba(${boxColor[0]},${boxColor[1]},${boxColor[2]},${((boxColor[3] ?? 255) / 255).toFixed(3)})`;
    const strokeLine = `rgba(${lineColor[0]},${lineColor[1]},${lineColor[2]},${((lineColor[3] ?? 255) / 255).toFixed(3)})`;

    for (const r of this.regions) {
      const bx = (r.cx - r.w / 2) * w;
      const by = (r.cy - r.h / 2) * h;
      const bw = r.w * w;
      const bh = r.h * h;

      ctx.save();
      ctx.strokeStyle = strokeBox;
      ctx.lineWidth = boxThick;
      if (dashLen > 0) ctx.setLineDash([dashLen, dashLen * 0.6]);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.restore();

      const [dx, dy] = dirVector(direction, r.cx, r.cy);
      const startX = r.cx * w;
      const startY = r.cy * h;
      const endX = startX + dx * diag * lineLen;
      const endY = startY + dy * diag * lineLen;

      ctx.save();
      ctx.strokeStyle = strokeLine;
      ctx.lineWidth = lineThick;
      if (dashLen > 0) ctx.setLineDash([dashLen * 1.5, dashLen]);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.restore();
    }

    return this.canvas;
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
    this.regions = [];
  }
}

export const trackerLayerType: LayerTypeDefinition = {
  type: "fx.tracker",
  label: "Region Tracker",
  category: "Effects",
  icon: "ScanSearch",
  kind: "effect",
  description: "Finds the brightest / most active areas below and marks them with boxes and directional lines.",
  schema: [
    { key: "count",          name: "Track Count",      type: "number",  default: 2,        group: "Tracking", meta: { min: 1, max: 5, step: 1 } },
    { key: "grid",           name: "Grid Resolution",  type: "number",  default: 24,       group: "Tracking", meta: { min: 8, max: 64, step: 1 } },
    { key: "smoothing",      name: "Smoothing",        type: "number",  default: 0.7,      group: "Tracking", meta: { min: 0, max: 0.99, step: 0.01 } },
    { key: "sampleRate",     name: "Sample Every N Frames", type: "number", default: 1,    group: "Tracking", meta: { min: 1, max: 30, step: 1 } },
    { key: "direction",      name: "Line Direction",   type: "select",  default: "outward", group: "Lines",
      meta: { options: [
        { label: "Outward (from centre)", value: "outward" },
        { label: "Up",         value: "up" },
        { label: "Down",       value: "down" },
        { label: "Left",       value: "left" },
        { label: "Right",      value: "right" },
        { label: "Up-Left",    value: "up-left" },
        { label: "Up-Right",   value: "up-right" },
        { label: "Down-Left",  value: "down-left" },
        { label: "Down-Right", value: "down-right" },
      ]}
    },
    { key: "lineLength",     name: "Line Length",      type: "percent", default: 0.6,      group: "Lines",    meta: { min: 0.05, max: 2, step: 0.05 } },
    { key: "dashLength",     name: "Dash Length (0=solid)", type: "number", default: 0,    group: "Lines",    meta: { min: 0, max: 40, step: 1 } },
    { key: "boxColor",       name: "Box Color",        type: "color",   default: [192, 252, 4, 255],  group: "Style" },
    { key: "lineColor",      name: "Line Color",       type: "color",   default: [192, 252, 4, 180],  group: "Style" },
    { key: "boxThickness",   name: "Box Thickness",    type: "number",  default: 1.5,      group: "Style",    meta: { min: 0.5, max: 8, step: 0.5 } },
    { key: "lineThickness",  name: "Line Thickness",   type: "number",  default: 1,        group: "Style",    meta: { min: 0.5, max: 8, step: 0.5 } },
    { key: "showBackdrop",   name: "Show Source",      type: "boolean", default: true,     group: "Style" },
  ],
  createRenderer: () => new TrackerRenderer(),
};
