import type { FrameContext, InputSnapshot, PropertyValue } from "../core/types";
import type { Property } from "./Property";
import type { Layer } from "../scene/Layer";
import type { Composition } from "../scene/Composition";
import { clamp, linearMap, lerp, smoothstep } from "./interpolation";

/**
 * Compiled-expression cache. Expressions are short and reused every frame, so we
 * compile each source string once into a function of a single `ctx` argument.
 */
const compiledCache = new Map<string, (ctx: any) => unknown>();

function compile(source: string): (ctx: any) => unknown {
  let fn = compiledCache.get(source);
  if (fn) return fn;
  const body = /\breturn\b/.test(source) ? source : `return ( ${source} );`;
  // The destructured names define the *entire* expression sandbox surface. Anything
  // not listed is simply undefined (→ ReferenceError → caught → falls back to base).
  // eslint-disable-next-line no-new-func
  fn = new Function(
    "ctx",
    `"use strict";
     const { value, time, frame, comp, thisComp, input, layer, thisLayer, global,
             Math, PI, TWO_PI, sin, cos, tan, abs, floor, ceil, round, sqrt, pow, min, max,
             random, noise, wiggle, clamp, linear, lerp, smoothstep, degrees, radians } = ctx;
     ${body}`,
  ) as (ctx: any) => unknown;
  compiledCache.set(source, fn);
  return fn;
}

const TWO_PI = Math.PI * 2;

/** Cheap deterministic 1-D value noise (smoothed) for wiggle/noise helpers. */
function valueNoise(x: number): number {
  const xi = Math.floor(x);
  const xf = x - xi;
  const h = (n: number) => {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  const a = h(xi);
  const b = h(xi + 1);
  return lerp(a, b, smoothstep(xf)) * 2 - 1; // -1..1
}

/**
 * Evaluates properties against a single frame of composition state. One Evaluator
 * is created per rendered frame; it memoises results and guards against cyclic
 * references (a property whose expression depends, directly or transitively, on
 * itself resolves to its own base value instead of looping forever).
 */
export class Evaluator {
  private cache = new Map<string, PropertyValue>();
  private stack = new Set<string>();

  constructor(
    readonly comp: Composition,
    readonly frame: FrameContext,
    readonly input: InputSnapshot,
    readonly globals: Record<string, unknown> = {},
  ) {}

  evaluate(prop: Property, layer: Layer): PropertyValue {
    const cached = this.cache.get(prop.id);
    if (cached !== undefined) return cached;

    const base = prop.valueAt(this.frame.time);

    // Cycle guard: if we re-enter the same property, return its base value.
    if (this.stack.has(prop.id)) return base;

    if (!prop.hasExpression) {
      this.cache.set(prop.id, base);
      return base;
    }

    this.stack.add(prop.id);
    let result: PropertyValue = base;
    try {
      const fn = compile(prop.expression as string);
      const out = fn(this.makeContext(layer, base));
      if (out !== undefined && out !== null) result = out as PropertyValue;
    } catch {
      result = base; // malformed / runtime error → graceful fallback
    } finally {
      this.stack.delete(prop.id);
    }
    this.cache.set(prop.id, result);
    return result;
  }

  /** Build the sandbox API object for one expression evaluation. */
  private makeContext(thisLayer: Layer, base: PropertyValue) {
    const self = this;
    const f = this.frame;

    const layerProxy = (layer: Layer) => ({
      name: layer.name,
      index: self.comp.layers.indexOf(layer) + 1,
      enabled: layer.enabled,
      /** Evaluate any property of this layer by key, e.g. layer("Ctrl").prop("rotation"). */
      prop: (key: string) => {
        const p = layer.property(key);
        return p ? self.evaluate(p, layer) : 0;
      },
      get position() {
        return this.prop("position");
      },
      get rotation() {
        return this.prop("rotation");
      },
      get scale() {
        return this.prop("scale");
      },
      get opacity() {
        return this.prop("opacity");
      },
    });

    const lookup = (ref: string | number) => {
      let layer: Layer | undefined;
      if (typeof ref === "number") layer = self.comp.layers[ref - 1];
      else layer = self.comp.layers.find((l) => l.name === ref);
      return layer ? layerProxy(layer) : layerProxy(thisLayer);
    };

    const compApi = {
      width: f.width,
      height: f.height,
      duration: f.duration,
      fps: f.fps,
      frame: f.frame,
      time: f.time,
      layer: lookup,
    };

    const wiggle = (freq: number, amp: number): PropertyValue => {
      const t = f.time * freq;
      if (Array.isArray(base)) {
        return base.map((v, i) => v + valueNoise(t + i * 37.3) * amp);
      }
      if (typeof base === "number") return base + valueNoise(t) * amp;
      return base;
    };

    return {
      value: base,
      time: f.time,
      frame: f.frame,
      comp: compApi,
      thisComp: compApi,
      input: this.input,
      layer: lookup,
      thisLayer: layerProxy(thisLayer),
      global: this.globals,
      // maths surface
      Math,
      PI: Math.PI,
      TWO_PI,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      abs: Math.abs,
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
      sqrt: Math.sqrt,
      pow: Math.pow,
      min: Math.min,
      max: Math.max,
      random: Math.random,
      noise: valueNoise,
      wiggle,
      clamp,
      linear: linearMap,
      lerp,
      smoothstep,
      degrees: (r: number) => (r * 180) / Math.PI,
      radians: (d: number) => (d * Math.PI) / 180,
    };
  }
}

/**
 * Static analysis helper used by the pickwhip UI: turn a structured reference into
 * an expression string. Keeps "no-code" binding and hand-written expressions unified.
 */
export function bindingExpression(
  sourceLayerName: string,
  sourceKey: string,
): string {
  return `layer(${JSON.stringify(sourceLayerName)}).prop(${JSON.stringify(sourceKey)})`;
}
