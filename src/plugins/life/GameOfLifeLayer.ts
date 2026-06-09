import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function rgba(v: unknown, f = "rgba(192,252,4,1)"): string {
  if (!Array.isArray(v)) return f;
  const [r, g, b, a] = v as number[];
  return `rgba(${r ?? 0},${g ?? 0},${b ?? 0},${(a ?? 255) / 255})`;
}
function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_CATCHUP = 1500;

/**
 * Conway's Game of Life. Cells live in a Uint8Array grid; one generation advances per
 * composition frame (× a speed multiplier), seeded so it's deterministic & seekable
 * (backward seeks replay from generation 0, capped). Live cells are drawn in one
 * batched fill; optional alpha-fade trails keep the layer transparent.
 */
class LifeRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private cells = new Uint8Array(0);
  private next = new Uint8Array(0);
  private cols = 0;
  private rows = 0;
  private simGen = 0;
  private lastSeed = NaN;
  private lastDensity = NaN;
  private lastKey = "";
  private forceInitial = true;

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
  }

  private reinit(seed: number, density: number): void {
    const rnd = mulberry32((seed | 0) * 2246822519 + 7);
    const n = this.cols * this.rows;
    if (this.cells.length !== n) {
      this.cells = new Uint8Array(n);
      this.next = new Uint8Array(n);
    }
    for (let i = 0; i < n; i++) this.cells[i] = rnd() < density ? 1 : 0;
    this.simGen = 0;
  }

  private step(wrap: boolean): void {
    const { cols, rows, cells, next } = this;
    for (let y = 0; y < rows; y++) {
      const yp = y === 0 ? (wrap ? rows - 1 : -1) : y - 1;
      const yn = y === rows - 1 ? (wrap ? 0 : -1) : y + 1;
      for (let x = 0; x < cols; x++) {
        const xp = x === 0 ? (wrap ? cols - 1 : -1) : x - 1;
        const xn = x === cols - 1 ? (wrap ? 0 : -1) : x + 1;
        let n = 0;
        if (yp >= 0) {
          if (xp >= 0) n += cells[yp * cols + xp];
          n += cells[yp * cols + x];
          if (xn >= 0) n += cells[yp * cols + xn];
        }
        if (xp >= 0) n += cells[y * cols + xp];
        if (xn >= 0) n += cells[y * cols + xn];
        if (yn >= 0) {
          if (xp >= 0) n += cells[yn * cols + xp];
          n += cells[yn * cols + x];
          if (xn >= 0) n += cells[yn * cols + xn];
        }
        const alive = cells[y * cols + x];
        next[y * cols + x] = alive ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0;
      }
    }
    this.cells.set(next);
    this.simGen++;
  }

  private draw(cs: number, props: Record<string, unknown>): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const trail = num(props.trail, 0) / 100;
    if (trail > 0.01) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0,0,0,${1 - trail})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
    } else {
      ctx.clearRect(0, 0, w, h);
    }
    ctx.fillStyle = rgba(props.color);
    const gap = num(props.gap, 1);
    const s = Math.max(1, cs - gap);
    ctx.beginPath();
    const { cols, rows, cells } = this;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (cells[y * cols + x]) ctx.rect(x * cs, y * cs, s, s);
      }
    }
    ctx.fill();
  }

  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.resize(frame.width, frame.height);
    }
    const pr = frame.props;
    const cs = Math.max(3, Math.round(num(pr.cellSize, 10)));
    const cols = Math.max(1, Math.floor(this.canvas.width / cs));
    const rows = Math.max(1, Math.floor(this.canvas.height / cs));
    const seed = Math.round(num(pr.seed, 1));
    const density = num(pr.density, 0.32);
    const wrap = pr.wrap !== false;
    const speed = Math.max(1, Math.round(num(pr.speed, 1)));

    if (cols !== this.cols || rows !== this.rows || seed !== this.lastSeed || density !== this.lastDensity || this.forceInitial) {
      this.cols = cols;
      this.rows = rows;
      this.lastSeed = seed;
      this.lastDensity = density;
      this.reinit(seed, density);
    }

    const target = frame.frame * speed;
    let steps = 0;
    if (target < this.simGen) {
      this.reinit(seed, density);
      steps = Math.min(target, MAX_CATCHUP);
    } else {
      steps = Math.min(target - this.simGen, MAX_CATCHUP);
    }
    for (let s = 0; s < steps; s++) this.step(wrap);
    this.simGen = target;

    const key = [cs, pr.color, pr.gap, pr.trail].join("|");
    const drew = steps > 0 || this.forceInitial || key !== this.lastKey;
    this.lastKey = key;
    this.forceInitial = false;
    if (drew) this.draw(cs, pr);
    return this.canvas;
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
    this.cells = this.next = new Uint8Array(0);
  }
}

export const gameOfLifeLayerType: LayerTypeDefinition = {
  type: "life",
  label: "Game of Life",
  category: "Simulation",
  icon: "Grid3x3",
  description: "Conway's Game of Life cellular automaton — seeded, deterministic, seekable.",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "cellSize", name: "Cell Size", type: "number", default: 10, group: "Life", animatable: false, meta: { min: 3, max: 80, step: 1 } },
    { key: "density", name: "Seed Density", type: "percent", default: 0.32, group: "Life", animatable: false, meta: { min: 0.01, max: 0.9, step: 0.01 } },
    { key: "seed", name: "Seed", type: "number", default: 1, group: "Life", animatable: false, meta: { min: 0, max: 99999, step: 1 } },
    { key: "speed", name: "Gens / Frame", type: "number", default: 1, group: "Life", meta: { min: 1, max: 6, step: 1 } },
    { key: "wrap", name: "Wrap Edges", type: "boolean", default: true, group: "Life" },
    { key: "color", name: "Color", type: "color", default: [192, 252, 4, 255], group: "Appearance" },
    { key: "gap", name: "Cell Gap", type: "number", default: 1, group: "Appearance", meta: { min: 0, max: 10, step: 1 } },
    { key: "trail", name: "Trails", type: "percent", default: 0, group: "Appearance", meta: { min: 0, max: 98, step: 1 } },
  ],
  createRenderer: () => new LifeRenderer(),
};
