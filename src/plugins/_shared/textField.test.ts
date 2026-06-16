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
    fieldToMask((x) => x, 2, 2, out);
    expect(out[0]).toBeCloseTo(0.25, 6);
    expect(out[1]).toBeCloseTo(0.75, 6);
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
    expect(u[0]).toBeCloseTo(0.2, 6);
    expect(v[0]).toBeCloseTo(0.5, 6);
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
      expect(ax[i]).toBeLessThan(2);
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
