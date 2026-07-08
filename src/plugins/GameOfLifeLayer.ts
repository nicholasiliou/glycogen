import { Plugin, type Frame } from "./Plugin";

function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Conway's Game of Life. Cells live in a Uint8Array grid; `speed` generations advance per frame,
 * seeded deterministically. Live cells are drawn in one batched fill; optional alpha-fade trails.
 */
export class GameOfLifeLayer extends Plugin {
  cellSize = this.number({ min: 3, max: 40, step: 1, default: 10 });
  density = this.number({ min: 0.05, max: 0.9, default: 0.32 });
  speed = this.number({ min: 1, max: 8, step: 1, default: 1 });
  trail = this.number({ min: 0, max: 100, default: 0 });
  gap = this.number({ min: 0, max: 6, step: 1, default: 1 });
  seed = this.number({ min: 1, max: 64, step: 1, default: 1 });
  wrap = this.toggle(true);
  reseed = this.trigger();

  private ctx = this.canvas.getContext("2d")!;
  private cells = new Uint8Array(0);
  private next = new Uint8Array(0);
  private cols = 0;
  private rows = 0;
  private lastSeed = NaN;
  private lastDensity = NaN;
  private lastReseed = 0;

  constructor() {
    super();
  }

  private reinit(seed: number, density: number): void {
    const rnd = mulberry32((seed | 0) * 2246822519 + 7);
    const n = this.cols * this.rows;
    if (this.cells.length !== n) {
      this.cells = new Uint8Array(n);
      this.next = new Uint8Array(n);
    }
    for (let i = 0; i < n; i++) this.cells[i] = rnd() < density ? 1 : 0;
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
  }

  render(_f: Frame): HTMLCanvasElement {
    const cs = Math.max(3, Math.round(this.cellSize.value));
    const cols = Math.max(1, Math.floor(this.canvas.width / cs));
    const rows = Math.max(1, Math.floor(this.canvas.height / cs));
    const seed = Math.round(this.seed.value);
    const density = this.density.value;
    const wrap = this.wrap.on;
    const speed = Math.max(1, Math.round(this.speed.value));

    if (cols !== this.cols || rows !== this.rows || seed !== this.lastSeed || density !== this.lastDensity || this.reseed.count !== this.lastReseed) {
      this.cols = cols;
      this.rows = rows;
      this.lastSeed = seed;
      this.lastDensity = density;
      this.lastReseed = this.reseed.count;
      this.reinit(seed, density);
    }

    for (let s = 0; s < speed; s++) this.step(wrap);
    this.draw(cs);
    return this.canvas;
  }

  private draw(cs: number): void {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    const trail = this.trail.value / 100;
    if (trail > 0.01) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0,0,0,${1 - trail})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
    } else {
      ctx.clearRect(0, 0, w, h);
    }
    ctx.fillStyle = "rgba(192,252,4,1)";
    const s = Math.max(1, cs - this.gap.value);
    ctx.beginPath();
    const { cols, rows, cells } = this;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (cells[y * cols + x]) ctx.rect(x * cs, y * cs, s, s);
      }
    }
    ctx.fill();
  }

  dispose(): void {
    super.dispose();
    this.cells = this.next = new Uint8Array(0);
  }
}
