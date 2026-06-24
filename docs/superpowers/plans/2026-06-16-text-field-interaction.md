# Text-Field Interaction (RD & Slime Mold) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Text, der über den bestehenden `below`-Seam als Abdeckungsmaske in Reaction-Diffusion und Slime Mold (Physarum) einfließt — mit wählbaren Modi (`off`/`fill`/`grow`/`attract`).

**Architecture:** Ein neues, reines (canvas-/engine-freies) Modul `_shared/textField.ts` enthält die gesamte Injektions-Mathematik als pure Funktionen auf typisierten Arrays — voll headless-testbar. Das Text-Layer bekommt eine `fieldSource` (rastert Text per Canvas → Abdeckungsraster → bilinearer Sampler). RD und Physarum lesen `frame.below.field`, sampeln es einmal pro Frame auf ihr Sim-Grid (Maske) und rufen je nach Modus die puren Injektionsfunktionen. Alles bleibt deterministisch & scrubbar.

**Tech Stack:** TypeScript, rohes Canvas-2D + `Float32Array` (kein p5 im Sim-Code), Vitest (jsdom).

---

## File Structure

- **Create** `src/plugins/_shared/textField.ts` — pure: `TextMode`, `sampleGrid`, `fieldToMask`, `textModeOf`, RD-Ops (`rdSeedAlongMask`, `rdConfine`, `rdAttract`), Physarum-Ops (`physarumConfineTrail`, `physarumAttract`, `physarumSeedAgentsOnMask`).
- **Create** `src/plugins/_shared/textField.test.ts` — unit tests for every pure function.
- **Modify** `src/plugins/text/TextLayer.ts` — add `fieldSource` + `sourceKey` (+ module-level `rasterTextGrid` canvas helper + `lastW/lastH` capture).
- **Create** `src/plugins/text/TextLayer.test.ts` — light test (fieldSource returns a function; sourceKey stable string).
- **Modify** `src/plugins/reactionDiffusion/ReactionDiffusionLayer.ts` — 2 schema props + mask wiring in `render`/`reinit`.
- **Modify** `src/plugins/physarum/PhysarumLayer.ts` — 2 schema props + mask wiring in `render`/`reinit`.

---

## Task 1: Pure text-field module

**Files:**
- Create: `src/plugins/_shared/textField.ts`
- Test: `src/plugins/_shared/textField.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/plugins/_shared/textField.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  sampleGrid, fieldToMask, textModeOf,
  rdSeedAlongMask, rdConfine, rdAttract,
  physarumConfineTrail, physarumAttract, physarumSeedAgentsOnMask,
} from "./textField";

describe("textModeOf", () => {
  it("accepts known modes and falls back to off", () => {
    expect(textModeOf("fill")).toBe("fill");
    expect(textModeOf("grow")).toBe("grow");
    expect(textModeOf("attract")).toBe("attract");
    expect(textModeOf("off")).toBe("off");
    expect(textModeOf("garbage")).toBe("off");
    expect(textModeOf(undefined)).toBe("off");
  });
});

describe("sampleGrid", () => {
  // 2x2 grid: only bottom-right cell is hot.
  const g = [0, 0, 0, 1];
  it("returns the corner values at the extremes", () => {
    expect(sampleGrid(g, 2, 2, 0, 0)).toBeCloseTo(0, 6);
    expect(sampleGrid(g, 2, 2, 1, 1)).toBeCloseTo(1, 6);
  });
  it("bilinearly interpolates the centre", () => {
    expect(sampleGrid(g, 2, 2, 0.5, 0.5)).toBeCloseTo(0.25, 6);
  });
  it("clamps out-of-range coordinates", () => {
    expect(sampleGrid(g, 2, 2, -1, -1)).toBeCloseTo(0, 6);
    expect(sampleGrid(g, 2, 2, 2, 2)).toBeCloseTo(1, 6);
  });
});

describe("fieldToMask", () => {
  it("samples cell centres and clamps to [0,1]", () => {
    const out = new Float32Array(4);
    // field returns x (the normalised column centre): cols=2 → centres 0.25, 0.75
    fieldToMask((x) => x, 2, 2, out);
    expect(out[0]).toBeCloseTo(0.25, 6);
    expect(out[1]).toBeCloseTo(0.75, 6);
    // negatives clamp to 0, >1 clamps to 1
    const out2 = new Float32Array(1);
    fieldToMask(() => -5, 1, 1, out2);
    expect(out2[0]).toBe(0);
    fieldToMask(() => 5, 1, 1, out2);
    expect(out2[0]).toBe(1);
  });
});

describe("rdSeedAlongMask", () => {
  it("stamps V-rich seeds only where the mask is set", () => {
    const u = new Float32Array([1, 1]);
    const v = new Float32Array([0, 0]);
    rdSeedAlongMask(u, v, new Float32Array([0.9, 0.1]), 2);
    expect(u[0]).toBeCloseTo(0.5, 6);
    expect(v[0]).toBeCloseTo(0.25, 6);
    expect(u[1]).toBe(1);
    expect(v[1]).toBe(0);
  });
});

describe("rdConfine", () => {
  it("pushes cells outside the mask toward U=1,V=0 at full strength", () => {
    const u = new Float32Array([0.2, 0.2]);
    const v = new Float32Array([0.5, 0.5]);
    rdConfine(u, v, new Float32Array([0.9, 0.1]), 2, 1);
    // inside mask (index 0) untouched
    expect(u[0]).toBeCloseTo(0.2, 6);
    expect(v[0]).toBeCloseTo(0.5, 6);
    // outside mask (index 1) fully suppressed
    expect(u[1]).toBeCloseTo(1, 6);
    expect(v[1]).toBeCloseTo(0, 6);
  });
});

describe("rdAttract", () => {
  it("raises V inside the mask and lowers it outside", () => {
    const v = new Float32Array([0.5, 0.5]);
    rdAttract(v, new Float32Array([1, 0]), 2, 1);
    expect(v[0]).toBeGreaterThan(0.5);
    expect(v[1]).toBeLessThan(0.5);
  });
});

describe("physarumConfineTrail", () => {
  it("damps trail outside the mask, keeps it inside", () => {
    const t = new Float32Array([1, 1]);
    physarumConfineTrail(t, new Float32Array([0.9, 0.1]), 2, 1);
    expect(t[0]).toBeCloseTo(1, 6);
    expect(t[1]).toBeCloseTo(0, 6);
  });
});

describe("physarumAttract", () => {
  it("adds scent proportional to the mask", () => {
    const t = new Float32Array([0, 0]);
    physarumAttract(t, new Float32Array([1, 0.5]), 2, 2);
    expect(t[0]).toBeCloseTo(2, 6);
    expect(t[1]).toBeCloseTo(1, 6);
  });
});

describe("physarumSeedAgentsOnMask", () => {
  it("places every agent on a masked cell (left half here)", () => {
    const cols = 4, rows = 2;
    const mask = new Float32Array(cols * rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) mask[y * cols + x] = x < 2 ? 1 : 0;
    const n = 50;
    const ax = new Float32Array(n), ay = new Float32Array(n), ah = new Float32Array(n);
    let s = 123;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    physarumSeedAgentsOnMask(ax, ay, ah, n, mask, cols, rows, rnd);
    for (let i = 0; i < n; i++) {
      expect(ax[i]).toBeGreaterThanOrEqual(0);
      expect(ax[i]).toBeLessThan(2); // only left-half cells were masked
      expect(ah[i]).toBeGreaterThanOrEqual(0);
    }
  });
  it("falls back to the whole grid when the mask is empty", () => {
    const cols = 4, rows = 2, n = 10;
    const ax = new Float32Array(n), ay = new Float32Array(n), ah = new Float32Array(n);
    let s = 7;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    physarumSeedAgentsOnMask(ax, ay, ah, n, new Float32Array(cols * rows), cols, rows, rnd);
    for (let i = 0; i < n; i++) {
      expect(ax[i]).toBeLessThan(cols);
      expect(ay[i]).toBeLessThan(rows);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/plugins/_shared/textField.test.ts`
Expected: FAIL — "Failed to resolve import './textField'".

- [ ] **Step 3: Write the implementation**

Create `src/plugins/_shared/textField.ts`:
```ts
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

/** attract (per step): add static scent into the trail where the mask is set. */
export function physarumAttract(trail: Float32Array, mask: Float32Array, n: number, amount: number): void {
  for (let i = 0; i < n; i++) trail[i] += amount * mask[i];
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/plugins/_shared/textField.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/_shared/textField.ts src/plugins/_shared/textField.test.ts
git commit -m "feat: pure text-field injection helpers for simulations"
```

---

## Task 2: Text layer exposes a field source

**Files:**
- Modify: `src/plugins/text/TextLayer.ts`
- Test: `src/plugins/text/TextLayer.test.ts`

- [ ] **Step 1: Add `lastW/lastH` capture + `fieldSource`/`sourceKey` + raster helper**

In `src/plugins/text/TextLayer.ts`:

(a) Add the import at the top (after the existing imports):
```ts
import { sampleGrid } from "../_shared/textField";
```

(b) In the `TextRenderer` class, add two fields (next to `private ctx`):
```ts
  private lastW = 1920;
  private lastH = 1080;
```

(c) In `render`, capture the dimensions — change the resize guard so it records size. Replace:
```ts
    if (this.canvas.width !== frame.width) this.resize(frame.width, frame.height);
```
with:
```ts
    if (this.canvas.width !== frame.width) this.resize(frame.width, frame.height);
    this.lastW = frame.width;
    this.lastH = frame.height;
```

(d) Add these two methods to the `TextRenderer` class (e.g. just before `dispose`):
```ts
  fieldSource(props: Record<string, unknown>): (x: number, y: number, z: number) => number {
    const grid = rasterTextGrid(props, this.lastW, this.lastH);
    if (!grid) return () => 0;
    const { data, gw, gh } = grid;
    return (x: number, y: number) => sampleGrid(data, gw, gh, x, y);
  }

  sourceKey(props: Record<string, unknown>): string {
    return [props.text, props.fontSize, props.tracking, props.bold, this.lastW, this.lastH].join("|");
  }
```

(e) Add this module-level helper at the bottom of the file (after the class, before `export const textLayerType`):
```ts
/**
 * Rasterise the text into a small coverage grid (alpha channel → [0,1]). Mirrors
 * TextRenderer.render's font/layout so the mask matches what's drawn. Returns null when
 * no 2D context is available (e.g. jsdom in tests) so callers fall back to a zero field.
 */
function rasterTextGrid(
  props: Record<string, unknown>,
  w: number,
  h: number,
): { data: Float32Array; gw: number; gh: number } | null {
  const maxDim = 256;
  const scale = maxDim / Math.max(1, Math.max(w, h));
  const gw = Math.max(1, Math.round(w * scale));
  const gh = Math.max(1, Math.round(h * scale));
  const c = document.createElement("canvas");
  c.width = gw;
  c.height = gh;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const data = new Float32Array(gw * gh);
  const text = String(props.text ?? "");
  if (!text) return { data, gw, gh };
  const size = (Number(props.fontSize) || 120) * scale;
  const weight = props.bold ? "700" : "400";
  const family = String(props.fontFamily || "sans-serif");
  ctx.fillStyle = "#fff";
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tracking = (Number(props.tracking) || 0) * scale;
  if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${tracking}px`;
  const lines = text.split("\n");
  const lh = size * 1.2;
  const startY = gh / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((line, i) => ctx.fillText(line, gw / 2, startY + i * lh));
  const img = ctx.getImageData(0, 0, gw, gh).data;
  for (let i = 0; i < gw * gh; i++) data[i] = img[i * 4 + 3] / 255;
  return { data, gw, gh };
}
```

- [ ] **Step 2: Write the test**

Create `src/plugins/text/TextLayer.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { textLayerType } from "./TextLayer";

describe("text layer field source", () => {
  it("exposes fieldSource and sourceKey on its renderer", () => {
    const renderer = textLayerType.createRenderer({} as never, {} as never);
    expect(typeof renderer.fieldSource).toBe("function");
    expect(typeof renderer.sourceKey).toBe("function");
  });

  it("fieldSource returns a sampler function (zero field without a 2D canvas)", () => {
    const renderer = textLayerType.createRenderer({} as never, {} as never);
    const field = renderer.fieldSource!({ text: "HI", fontSize: 120, tracking: 0, bold: true });
    expect(typeof field).toBe("function");
    // jsdom has no real 2D canvas → rasterTextGrid returns null → zero field.
    expect(field(0.5, 0.5, 0)).toBe(0);
  });

  it("sourceKey changes when the text changes", () => {
    const renderer = textLayerType.createRenderer({} as never, {} as never);
    const k1 = renderer.sourceKey!({ text: "A", fontSize: 120, tracking: 0, bold: true });
    const k2 = renderer.sourceKey!({ text: "B", fontSize: 120, tracking: 0, bold: true });
    expect(k1).not.toBe(k2);
  });
});
```

- [ ] **Step 3: Run test + typecheck**

Run: `npx vitest run src/plugins/text/TextLayer.test.ts && npm run typecheck`
Expected: PASS (3 tests); typecheck exit 0.

> Note: jsdom provides no working 2D canvas, so `rasterTextGrid` returns null and the field is all-zero in tests — that's expected and asserted. The real raster runs in the browser. Visual behaviour is verified manually in Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/text/TextLayer.ts src/plugins/text/TextLayer.test.ts
git commit -m "feat: text layer exposes a coverage field source"
```

---

## Task 3: Reaction–Diffusion consumes the text field

**Files:**
- Modify: `src/plugins/reactionDiffusion/ReactionDiffusionLayer.ts`

- [ ] **Step 1: Add the import**

At the top of `src/plugins/reactionDiffusion/ReactionDiffusionLayer.ts`, after the existing `import type { LayerRenderer, RenderFrame } ...` line:
```ts
import { fieldToMask, rdSeedAlongMask, rdConfine, rdAttract, textModeOf, type TextMode } from "../_shared/textField";
```

- [ ] **Step 2: Add instance fields**

In the `ReactionDiffusionRenderer` class, after the line `private forceInitial = true;`, add:
```ts
  private mask = new Float32Array(0);
  private maskKey = "";
  private maskActive = false;
  private textMode: TextMode = "off";
```

- [ ] **Step 3: Replace `reinit` to honour grow/fill seeding**

Replace the entire `private reinit(seed: number): void { ... }` method with:
```ts
  private reinit(seed: number): void {
    const n = this.cols * this.rows;
    if (this.u.length !== n) {
      this.u = new Float32Array(n);
      this.v = new Float32Array(n);
      this.u2 = new Float32Array(n);
      this.v2 = new Float32Array(n);
    }
    this.u.fill(1);
    this.v.fill(0);
    if ((this.textMode === "grow" || this.textMode === "fill") && this.maskActive) {
      // Pattern nucleates on the letters instead of random spots.
      rdSeedAlongMask(this.u, this.v, this.mask, n);
    } else {
      // Stamp a handful of V-rich blobs; everything else grows out from these.
      const rnd = mulberry32((seed | 0) * 9176 + 13);
      const spots = Math.max(6, Math.round(n / 1600));
      for (let s = 0; s < spots; s++) {
        const cx = Math.floor(rnd() * this.cols);
        const cy = Math.floor(rnd() * this.rows);
        const r = 2 + Math.floor(rnd() * 3);
        for (let dy = -r; dy <= r; dy++) {
          const y = cy + dy;
          if (y < 0 || y >= this.rows) continue;
          for (let dx = -r; dx <= r; dx++) {
            const x = cx + dx;
            if (x < 0 || x >= this.cols) continue;
            const i = y * this.cols + x;
            this.u[i] = 0.5;
            this.v[i] = 0.25;
          }
        }
      }
    }
    this.simStep = 0;
  }
```

- [ ] **Step 4: Replace `render` to build the mask and inject per step**

Replace the entire `render(frame: RenderFrame): HTMLCanvasElement { ... }` method with:
```ts
  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.resize(frame.width, frame.height);
    }
    const pr = frame.props;
    const resolution = Math.max(0.08, Math.min(0.6, num(pr.resolution, 0.26)));
    const [cols, rows] = this.gridSize(resolution);
    const seed = Math.round(num(pr.seed, 1));

    // ── text-field influence (consumed from the layer directly below) ──
    const mode = textModeOf(pr.textInfluence);
    const strength = Math.max(0, Math.min(1, num(pr.textStrength, 0.8)));
    const field = mode !== "off" ? frame.below?.field : undefined;
    const needReinit = cols !== this.cols || rows !== this.rows || seed !== this.lastSeed || this.forceInitial;
    this.cols = cols;
    this.rows = rows;
    this.lastSeed = seed;
    this.textMode = mode;
    if (field) {
      const key = `${frame.below?.key ?? ""}|${cols}x${rows}`;
      if (this.mask.length !== cols * rows) this.mask = new Float32Array(cols * rows);
      if (key !== this.maskKey) {
        fieldToMask(field, cols, rows, this.mask);
        this.maskKey = key;
      }
      this.maskActive = true;
    } else {
      this.maskActive = false;
      this.maskKey = "";
    }

    if (needReinit) this.reinit(seed);

    const pattern = String(pr.pattern ?? "coral");
    const preset = PRESETS[pattern];
    const feed = preset ? preset[0] : num(pr.feed, 0.055);
    const kill = preset ? preset[1] : num(pr.kill, 0.062);
    const iters = Math.max(1, Math.round(num(pr.iterations, 10)));
    const n = cols * rows;

    const target = frame.frame * iters;
    let steps = 0;
    if (target < this.simStep) {
      this.reinit(seed);
      steps = Math.min(target, MAX_CATCHUP);
    } else {
      steps = Math.min(target - this.simStep, MAX_CATCHUP);
    }
    for (let s = 0; s < steps; s++) {
      this.step(feed, kill);
      if (this.maskActive) {
        if (mode === "fill") rdConfine(this.u, this.v, this.mask, n, strength);
        else if (mode === "attract") rdAttract(this.v, this.mask, n, strength);
      }
    }
    this.simStep = target;

    this.forceInitial = false;
    this.draw(pr);
    return this.canvas;
  }
```

- [ ] **Step 5: Add the two schema props**

In `reactionDiffusionLayerType.schema`, add these two entries at the end of the array (after the `resolution` entry):
```ts
    { key: "textInfluence", name: "Text Influence", type: "select", default: "off", group: "Text", animatable: false, meta: { options: [
      { label: "Off", value: "off" }, { label: "Fill text", value: "fill" }, { label: "Grow from text", value: "grow" }, { label: "Attract to text", value: "attract" } ] } },
    { key: "textStrength", name: "Text Strength", type: "percent", default: 0.8, group: "Text", meta: { min: 0, max: 1, step: 0.01 } },
```

- [ ] **Step 6: Typecheck, tests, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck exit 0; all tests green (no new tests here — covered by Task 1's pure functions + existing suite); build succeeds.

> Why no render-level test: rendering needs a real 2D canvas (absent in jsdom). The injection math is fully unit-tested in Task 1; this task is thin wiring with an `off`-mode early-out that preserves the previous behaviour by construction. Verified visually in Task 5.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/reactionDiffusion/ReactionDiffusionLayer.ts
git commit -m "feat: reaction-diffusion consumes a text field (fill/grow/attract)"
```

---

## Task 4: Physarum (Slime Mold) consumes the text field

**Files:**
- Modify: `src/plugins/physarum/PhysarumLayer.ts`

- [ ] **Step 1: Add the import**

At the top of `src/plugins/physarum/PhysarumLayer.ts`, after the existing `import type { LayerRenderer, RenderFrame } ...` line:
```ts
import { fieldToMask, physarumConfineTrail, physarumAttract, physarumSeedAgentsOnMask, textModeOf, type TextMode } from "../_shared/textField";
```

- [ ] **Step 2: Add instance fields**

In the `PhysarumRenderer` class, after the line `private forceInitial = true;`, add:
```ts
  private mask = new Float32Array(0);
  private maskKey = "";
  private maskActive = false;
  private textMode: TextMode = "off";
```

- [ ] **Step 3: Replace `reinit` to honour grow/fill agent seeding**

Replace the entire `private reinit(count: number, seed: number): void { ... }` method with:
```ts
  private reinit(count: number, seed: number): void {
    if (count > this.capacity) {
      this.ax = new Float32Array(count);
      this.ay = new Float32Array(count);
      this.ah = new Float32Array(count);
      this.capacity = count;
    }
    const n = this.cols * this.rows;
    if (this.trail.length !== n) {
      this.trail = new Float32Array(n);
      this.trail2 = new Float32Array(n);
    } else {
      this.trail.fill(0);
    }
    const rnd = mulberry32((seed | 0) * 2654435761 + 31);
    if ((this.textMode === "grow" || this.textMode === "fill") && this.maskActive) {
      physarumSeedAgentsOnMask(this.ax, this.ay, this.ah, count, this.mask, this.cols, this.rows, rnd);
    } else {
      for (let i = 0; i < count; i++) {
        this.ax[i] = rnd() * this.cols;
        this.ay[i] = rnd() * this.rows;
        this.ah[i] = rnd() * Math.PI * 2;
      }
    }
    this.count = count;
    this.simStep = 0;
  }
```

- [ ] **Step 4: Replace `render` to build the mask and inject per step**

Replace the entire `render(frame: RenderFrame): HTMLCanvasElement { ... }` method with:
```ts
  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.resize(frame.width, frame.height);
    }
    const pr = frame.props;
    const resolution = Math.max(0.1, Math.min(0.6, num(pr.resolution, 0.4)));
    const [cols, rows] = this.gridSize(resolution);
    const count = Math.max(1, Math.min(HARD_MAX, Math.round(num(pr.count, 5000))));
    const seed = Math.round(num(pr.seed, 1));

    // ── text-field influence (consumed from the layer directly below) ──
    const mode = textModeOf(pr.textInfluence);
    const strength = Math.max(0, Math.min(1, num(pr.textStrength, 0.8)));
    const field = mode !== "off" ? frame.below?.field : undefined;
    const needReinit =
      cols !== this.cols || rows !== this.rows || count !== this.lastCount || seed !== this.lastSeed || this.forceInitial;
    this.cols = cols;
    this.rows = rows;
    this.lastCount = count;
    this.lastSeed = seed;
    this.textMode = mode;
    if (field) {
      const key = `${frame.below?.key ?? ""}|${cols}x${rows}`;
      if (this.mask.length !== cols * rows) this.mask = new Float32Array(cols * rows);
      if (key !== this.maskKey) {
        fieldToMask(field, cols, rows, this.mask);
        this.maskKey = key;
      }
      this.maskActive = true;
    } else {
      this.maskActive = false;
      this.maskKey = "";
    }

    if (needReinit) this.reinit(count, seed);

    const p: AgentParams = {
      sensorDist: num(pr.sensorDist, 9),
      sensorAngle: num(pr.sensorAngle, 22) * DEG,
      turnAngle: num(pr.turnAngle, 30) * DEG,
      stepSize: num(pr.stepSize, 1),
      deposit: num(pr.deposit, 1),
      decay: Math.max(0, Math.min(0.95, num(pr.decay, 0.1))),
    };
    const speed = Math.max(1, Math.round(num(pr.speed, 1)));
    const n = cols * rows;

    const target = frame.frame * speed;
    let steps = 0;
    if (target < this.simStep) {
      this.reinit(count, seed);
      steps = Math.min(target, MAX_CATCHUP);
    } else {
      steps = Math.min(target - this.simStep, MAX_CATCHUP);
    }
    for (let s = 0; s < steps; s++) {
      this.step(p);
      if (this.maskActive) {
        if (mode === "fill") physarumConfineTrail(this.trail, this.mask, n, strength);
        else if (mode === "attract") physarumAttract(this.trail, this.mask, n, strength * 2);
      }
    }
    this.simStep = target;

    this.forceInitial = false;
    this.draw(pr);
    return this.canvas;
  }
```

- [ ] **Step 5: Add the two schema props**

In `physarumLayerType.schema`, add these two entries at the end of the array (after the `resolution` entry):
```ts
    { key: "textInfluence", name: "Text Influence", type: "select", default: "off", group: "Text", animatable: false, meta: { options: [
      { label: "Off", value: "off" }, { label: "Fill text", value: "fill" }, { label: "Grow from text", value: "grow" }, { label: "Attract to text", value: "attract" } ] } },
    { key: "textStrength", name: "Text Strength", type: "percent", default: 0.8, group: "Text", meta: { min: 0, max: 1, step: 0.01 } },
```

- [ ] **Step 6: Typecheck, tests, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck exit 0; all tests green; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/physarum/PhysarumLayer.ts
git commit -m "feat: physarum consumes a text field (fill/grow/attract)"
```

---

## Task 5: Manual verification

**Files:** none (manual).

- [ ] **Step 1: Run the dev server and verify in the browser**

Run: `npm run dev` → open http://localhost:5173, switch to **Pro Mode** (the "Simple"/"Pro" toggle), then:

1. Add a **Reaction–Diffusion** layer and a **Text** layer. In the Layers panel, drag the Text layer to sit **directly below** the Reaction–Diffusion layer.
2. Select the Text layer, set its text (e.g. "MARATHON"), large font.
3. Select the Reaction–Diffusion layer → Inspector → group **Text** → set **Text Influence** to:
   - **Fill text:** the RD pattern should live only inside the letterforms; the rest stays background. Adjust **Text Strength**.
   - **Grow from text:** play the timeline (Space) — the pattern should nucleate on the letters and spread outward over time.
   - **Attract to text:** the letter region should read denser/brighter than the surroundings.
   - **Off:** identical to before (no text influence).
4. Scrub the timeline back and forth — the result must be **deterministic** (same frame → same image).
5. Repeat 1–4 with a **Slime Mold** layer above the Text layer (fill = network confined to letters; grow = agents start on the letters; attract = veins drawn toward the text).
6. Confirm a layer with **Text Influence = Off** and no text below behaves exactly as before.

- [ ] **Step 2: Done**

No commit (verification only). If anything misbehaves, fix in the relevant plugin and re-run Tasks 3/4 checks.

---

## Self-Review (by the author)

**Spec coverage:**
- Style = target plugins (raw Canvas2D + typed arrays, no p5) → Tasks 1/3/4 operate on `Float32Array`; only Task 2's `rasterTextGrid` uses a canvas (the same API TextRenderer already uses). ✓
- Mechanism = existing `below` seam; Text exposes `fieldSource`/`sourceKey` → Task 2; RD/physarum read `frame.below.field` → Tasks 3/4. No compositor change. ✓
- Selectable modes `off/fill/grow/attract` + `textStrength` → schema props in Tasks 3/4; dispatch in `reinit`/`render`. ✓
- Per-mode mapping (RD: seed/confine/attract; physarum: seed-agents/confine-trail/attract-scent) → Task 1 functions wired in Tasks 3/4 per the spec table. ✓
- Determinism preserved → mask depends only on evaluated props; `fill`/`attract` per step, `grow` at reinit; backward seek replays from 0 (unchanged). `off` path is byte-identical (early-out). ✓
- Pure, headless-testable injection functions → Task 1 (`textField.ts`) fully unit-tested without canvas. ✓
- Scope: only RD + physarum, Pro only, generic-field bonus noted → schema added only to those two; no Simple-Mode change. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code. The two render methods and both reinit methods are given verbatim (full replacements). ✓

**Type consistency:** `TextMode`, `textModeOf`, `sampleGrid`, `fieldToMask`, `rdSeedAlongMask`, `rdConfine`, `rdAttract`, `physarumConfineTrail`, `physarumAttract`, `physarumSeedAgentsOnMask` are named identically in their definitions (Task 1) and all call sites (Tasks 2–4). Schema prop keys `textInfluence`/`textStrength` match the `pr.textInfluence`/`pr.textStrength` reads. ✓
