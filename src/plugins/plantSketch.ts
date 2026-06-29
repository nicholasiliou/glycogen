import type p5 from "p5";

/**
 * The original `sketch.js` L-system + turtle, preserved verbatim — only adapted from
 * p5 global mode to instance mode (global `random()` → `p.random()`, etc.). The
 * constants, thresholds, EGA palette, rule grammar, Phi metrics and turtle drawing
 * are intentionally unchanged. Do not "fix" anything here; the look is the point.
 */

export const AXIOM = "F";
export const BASE_LEN = 80;

// ---------- SYSTEM ----------
export function makeRule(p: p5): string {
  let result = "";
  let open = 0;

  for (let i = 0; i < 10; i++) {
    const r = p.random();

    // HARD LIMIT: prevent forward-only chains
    if (i > 2 && p.random() < 0.25) {
      result += "[F]";
      continue;
    }

    if (r < 0.22) {
      result += "F";
    } else if (r < 0.5) {
      result += p.random(["+", "-", "^", "&"]);
    } else if (r < 0.78) {
      result += "[F";
      open++;
    } else {
      if (open > 0) {
        result += "]";
        open--;
      } else {
        result += p.random(["+", "-", "&", "^"]);
      }
    }
  }

  while (open-- > 0) result += "]";

  return result;
}

export function randomEGAColor(p: p5): p5.Color {
  const ega = [
    p.color(192, 252, 4),
    p.color(234, 2, 126),
    p.color(54, 1, 251),
    p.color(255, 85, 0),
  ];
  return p.random(ega);
}

// ---------- PHI ----------
export interface PhiStats {
  energy: number;
  chaos: number;
  rotation: number;
  branches: number;
}

export function Phi(str: string): PhiStats {
  const stats: Record<string, number> = { F: 0, "+": 0, "-": 0, "^": 0, "&": 0 };
  let branches = 0;

  for (const c of str) {
    if (stats[c] !== undefined) stats[c]++;
    if (c === "[") branches++;
  }

  const total = Object.values(stats).reduce((a, b) => a + b, 0) || 1;

  return {
    energy: total,
    chaos: stats["^"] + stats["&"],
    rotation: Math.abs(stats["+"] - stats["-"]),
    branches,
  };
}

// ---------- FIX: ANTI-PILLAR ----------
export function injectEarlyDeviation(p: p5, str: string): string {
  const head = str.slice(0, 20);
  const rest = str.slice(20);

  const hasDeviation =
    head.includes("+") ||
    head.includes("-") ||
    head.includes("&") ||
    head.includes("^");

  if (hasDeviation) return str;

  return p.random(["+", "-", "&", "^"]) + "F" + rest;
}

// ---------- SYSTEM GENERATION ----------
export function generateSystem(
  p: p5,
  iterations = 4,
  baseLen = BASE_LEN,
): { sentence: string; len: number } {
  let sentence = AXIOM;
  let len = baseLen;

  const rules: Record<string, string> = {};
  rules.F = makeRule(p);

  for (let i = 0; i < iterations; i++) {
    let next = "";
    for (const c of sentence) next += rules[c] || c;
    sentence = next;
    len *= 0.6;
  }

  // enforce early non-vertical structure
  sentence = injectEarlyDeviation(p, sentence);
  return { sentence, len };
}

// ---------- TURTLE ----------
export function drawTurtle(
  p: p5,
  str: string,
  col: p5.Color,
  len: number,
  angle: number,
): void {
  p.push();

  let depth = 0;

  for (let i = 0; i < str.length; i++) {
    const c = str[i];

    switch (c) {
      case "F": {
        depth++;

        p.stroke(col);

        const w = p.map(depth, 0, 20, 6, 0.4, true);
        p.strokeWeight(w);

        const segmentLen = len * p.map(depth, 0, 20, 1, 0.35, true);

        p.line(0, 0, 0, 0, -segmentLen, 0);
        p.translate(0, -segmentLen, 0);
        break;
      }

      case "+":
        p.rotateY(angle);
        break;

      case "-":
        p.rotateY(-angle);
        break;

      case "&":
        p.rotateX(angle);
        p.rotateZ(angle * 0.3);
        break;

      case "^":
        p.rotateX(-angle);
        p.rotateZ(-angle * 0.3);
        break;

      case "[":
        p.push();
        depth += 2;
        break;

      case "]":
        p.pop();
        depth = Math.max(0, depth - 2);
        break;
    }
  }

  p.pop();
}
