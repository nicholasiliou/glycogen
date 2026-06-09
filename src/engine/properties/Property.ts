import { uid } from "../core/ids";
import type { PropType, PropertyMeta, PropertyValue } from "../core/types";
import {
  cubicBezierEase,
  interpValue,
  smoothstep,
  type Interpolation,
} from "./interpolation";

export interface Keyframe {
  id: string;
  time: number;
  value: PropertyValue;
  /** Easing applied on the segment LEAVING this keyframe. */
  interp: Interpolation;
  /** Temporal bezier handles when interp === "bezier". */
  bezier?: [number, number, number, number];
}

export interface PropertyInit {
  id?: string;
  key: string;
  name: string;
  type: PropType;
  value: PropertyValue;
  meta?: PropertyMeta;
  /** UI grouping label, e.g. "Transform". */
  group?: string;
  /** Whether this property accepts keyframes / expressions. */
  animatable?: boolean;
}

/**
 * A single animatable property. Holds a static value, an optional keyframe track,
 * and an optional expression string. Evaluation of the expression lives in the
 * Evaluator (it needs the whole composition as context); `valueAt` here is the pure
 * keyframe/static sampling that the expression's `value` symbol resolves to.
 */
export class Property {
  readonly id: string;
  key: string;
  name: string;
  type: PropType;
  value: PropertyValue;
  meta: PropertyMeta;
  group?: string;
  animatable: boolean;

  keyframes: Keyframe[] = [];
  expression: string | null = null;
  /** UI affordance: collapsed expression editor, etc. Not serialized as behavior. */
  expressionEnabled = true;

  constructor(init: PropertyInit) {
    this.id = init.id ?? uid("prop");
    this.key = init.key;
    this.name = init.name;
    this.type = init.type;
    this.value = init.value;
    this.meta = init.meta ?? {};
    this.group = init.group;
    this.animatable = init.animatable ?? init.type !== "trigger";
  }

  get isAnimated(): boolean {
    return this.keyframes.length > 0;
  }

  get hasExpression(): boolean {
    return !!this.expression && this.expressionEnabled;
  }

  /** Pure sampling of the keyframe track (or static value). No expressions. */
  valueAt(time: number): PropertyValue {
    const kfs = this.keyframes;
    if (kfs.length === 0) return this.value;
    if (kfs.length === 1) return kfs[0].value;
    if (time <= kfs[0].time) return kfs[0].value;
    const last = kfs[kfs.length - 1];
    if (time >= last.time) return last.value;

    let i = 0;
    while (i < kfs.length - 1 && kfs[i + 1].time <= time) i++;
    const a = kfs[i];
    const b = kfs[i + 1];
    if (a.interp === "stepped") return a.value;

    let t = (time - a.time) / (b.time - a.time);
    if (a.interp === "smooth") t = smoothstep(t);
    else if (a.interp === "bezier" && a.bezier) t = cubicBezierEase(a.bezier)(t);
    return interpValue(a.value, b.value, t);
  }

  sortKeyframes(): void {
    this.keyframes.sort((a, b) => a.time - b.time);
  }

  keyframeAt(time: number, epsilon = 1e-4): Keyframe | undefined {
    return this.keyframes.find((k) => Math.abs(k.time - time) <= epsilon);
  }

  /** Insert or replace a keyframe at `time`. Returns the keyframe. */
  setKeyframe(
    time: number,
    value: PropertyValue,
    interp: Interpolation = "linear",
  ): Keyframe {
    const existing = this.keyframeAt(time);
    if (existing) {
      existing.value = value;
      existing.interp = interp;
      return existing;
    }
    const kf: Keyframe = { id: uid("kf"), time, value, interp };
    this.keyframes.push(kf);
    this.sortKeyframes();
    return kf;
  }

  removeKeyframe(id: string): void {
    this.keyframes = this.keyframes.filter((k) => k.id !== id);
  }

  clearKeyframes(): void {
    this.keyframes = [];
  }

  toJSON(): unknown {
    return {
      id: this.id,
      key: this.key,
      name: this.name,
      type: this.type,
      value: this.value,
      meta: this.meta,
      group: this.group,
      animatable: this.animatable,
      keyframes: this.keyframes,
      expression: this.expression,
      expressionEnabled: this.expressionEnabled,
    };
  }

  static fromJSON(raw: any): Property {
    const p = new Property({
      id: raw.id,
      key: raw.key,
      name: raw.name,
      type: raw.type,
      value: raw.value,
      meta: raw.meta,
      group: raw.group,
      animatable: raw.animatable,
    });
    p.keyframes = (raw.keyframes ?? []).map((k: any) => ({
      id: k.id ?? uid("kf"),
      time: k.time,
      value: k.value,
      interp: k.interp ?? "linear",
      bezier: k.bezier,
    }));
    p.expression = raw.expression ?? null;
    p.expressionEnabled = raw.expressionEnabled ?? true;
    return p;
  }
}
