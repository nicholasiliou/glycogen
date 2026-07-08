import { Plugin, type Frame } from "@/plugins/Plugin";

interface TrackedRegion {
  cx: number;
  cy: number;
  w: number;
  h: number;
  score: number;
}

function findRegions(bd: HTMLCanvasElement, count: number, gridCols: number, gridRows: number): TrackedRegion[] {
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
      const lum = (0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2]) / 255;
      scores.push({ col, row, score: lum * (pixels[idx + 3] / 255) });
    }
  }
  scores.sort((a, b) => b.score - a.score);

  const minSep = Math.max(2, Math.floor(Math.min(gridCols, gridRows) / (count + 1)));
  const picked: typeof scores = [];
  for (const cell of scores) {
    if (picked.length >= count) break;
    if (!picked.some((p) => Math.abs(p.col - cell.col) < minSep && Math.abs(p.row - cell.row) < minSep)) picked.push(cell);
  }
  while (picked.length < count) {
    picked.push({ col: Math.floor(Math.random() * gridCols), row: Math.floor(Math.random() * gridRows), score: 0 });
  }

  const cellW = 1 / gridCols;
  const cellH = 1 / gridRows;
  return picked.map((p) => ({ cx: (p.col + 0.5) / gridCols, cy: (p.row + 0.5) / gridRows, w: cellW * 3, h: cellH * 3, score: p.score }));
}

const DIR_NAMES = ["outward", "up", "down", "left", "right", "up-left", "up-right", "down-left", "down-right"];
const DIRECTIONS: Record<string, [number, number]> = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
  "up-left": [-1, -1], "up-right": [1, -1], "down-left": [-1, 1], "down-right": [1, 1], outward: [0, 0],
};

function dirVector(name: string, cx: number, cy: number): [number, number] {
  if (name === "outward") {
    const dx = cx - 0.5, dy = cy - 0.5;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return [dx / len, dy / len];
  }
  const d = DIRECTIONS[name] ?? [1, 0];
  const len = Math.sqrt(d[0] * d[0] + d[1] * d[1]) || 1;
  return [d[0] / len, d[1] / len];
}

const BOX = [192, 252, 4, 255];
const LINE = [192, 252, 4, 180];

/** Finds the brightest / most active regions below and marks them with boxes + directional lines. */
export class TrackerLayer extends Plugin {
  count = this.number({ min: 1, max: 5, step: 1, default: 2 });
  grid = this.number({ min: 8, max: 64, step: 1, default: 24 });
  smoothing = this.number({ min: 0, max: 0.99, default: 0.7 });
  sampleRate = this.number({ min: 1, max: 30, step: 1, default: 1 });
  lineLength = this.number({ min: 0.05, max: 2, default: 0.6 });
  dashLength = this.number({ min: 0, max: 40, step: 1, default: 0 });
  boxThickness = this.number({ min: 0.5, max: 8, default: 1.5 });
  lineThickness = this.number({ min: 0.5, max: 8, default: 1 });
  direction = this.cycle(DIR_NAMES);
  showBackdrop = this.toggle(true);

  private ctx = this.canvas.getContext("2d")!;
  private regions: TrackedRegion[] = [];
  private frameIdx = 0;

  constructor() {
    super();
  }

  render(f: Frame): HTMLCanvasElement | null {
    const bd = f.input;
    if (!bd) return null;
    const w = f.width, h = f.height;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    const count = Math.max(1, Math.min(5, Math.round(this.count.value)));
    const grid = Math.max(8, Math.min(64, Math.round(this.grid.value)));
    const smoothing = Math.max(0, Math.min(0.99, this.smoothing.value));
    const sampleEvery = Math.max(1, Math.round(this.sampleRate.value));
    const direction = this.direction.pick(DIR_NAMES);
    const dashLen = this.dashLength.value;
    this.frameIdx++;

    const targets =
      this.frameIdx % sampleEvery === 0 || this.regions.length < count
        ? findRegions(bd, count, grid, grid)
        : this.regions;

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
    if (this.showBackdrop.on) ctx.drawImage(bd, 0, 0, w, h);

    const diag = Math.sqrt(w * w + h * h);
    const strokeBox = `rgba(${BOX[0]},${BOX[1]},${BOX[2]},${BOX[3] / 255})`;
    const strokeLine = `rgba(${LINE[0]},${LINE[1]},${LINE[2]},${LINE[3] / 255})`;

    for (const r of this.regions) {
      const bx = (r.cx - r.w / 2) * w, by = (r.cy - r.h / 2) * h;
      ctx.save();
      ctx.strokeStyle = strokeBox;
      ctx.lineWidth = this.boxThickness.value;
      if (dashLen > 0) ctx.setLineDash([dashLen, dashLen * 0.6]);
      ctx.strokeRect(bx, by, r.w * w, r.h * h);
      ctx.restore();

      const [dx, dy] = dirVector(direction, r.cx, r.cy);
      const startX = r.cx * w, startY = r.cy * h;
      ctx.save();
      ctx.strokeStyle = strokeLine;
      ctx.lineWidth = this.lineThickness.value;
      if (dashLen > 0) ctx.setLineDash([dashLen * 1.5, dashLen]);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(startX + dx * diag * this.lineLength.value, startY + dy * diag * this.lineLength.value);
      ctx.stroke();
      ctx.restore();
    }
    return this.canvas;
  }

  dispose(): void {
    super.dispose();
    this.regions = [];
  }
}
