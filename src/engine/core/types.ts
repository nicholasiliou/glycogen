/** Shared primitive types used across engine subsystems. */

export type Vec2 = [x: number, y: number];
/** RGBA in 0..255 (matches p5 / the original sketch's colour space). */
export type RGBA = [r: number, g: number, b: number, a: number];

/** The value space an animatable property can hold. */
export type PropertyValue = number | number[] | boolean | string;

export type PropType =
  | "number"
  | "angle" // degrees
  | "percent" // 0..100
  | "point" // [x, y]
  | "point3" // [x, y, z]
  | "color" // [r, g, b, a]
  | "boolean"
  | "string"
  | "select"
  | "trigger";

export interface PropertyMeta {
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { label: string; value: string | number }[];
}

/**
 * The composition clock state handed to every layer each frame. Layers MUST
 * evaluate themselves against this — never against the raw render loop / wall
 * clock — so playback is deterministic, seekable and FPS-independent.
 */
export interface FrameContext {
  /** Composition-local time, in seconds. */
  time: number;
  /** Whole-frame index = floor(time * fps). */
  frame: number;
  fps: number;
  duration: number;
  width: number;
  height: number;
  playing: boolean;
  /** Seconds elapsed since the previously evaluated frame (preview only). */
  delta: number;
}

/**
 * Snapshot of live runtime inputs, exposed to the expression system as `input.*`
 * so interaction-driven effects use the exact same binding mechanism as keyframes.
 */
export interface InputSnapshot {
  time: number;
  /** Pointer in composition pixel space. */
  mouseX: number;
  mouseY: number;
  /** Pointer normalised 0..1 across the composition. */
  mouseNX: number;
  mouseNY: number;
  mouseVX: number;
  mouseVY: number;
  mouseSpeed: number;
  mouseDown: boolean;
  scrollY: number;
  scrollVelocity: number;
  /** 0..1 microphone analysis (requires user opt-in). */
  audioLevel: number;
  audioLow: number;
  audioMid: number;
  audioHigh: number;
  keys: Record<string, boolean>;
  orientation: { alpha: number; beta: number; gamma: number };
  width: number;
  height: number;
}

export function emptyInputSnapshot(width = 1920, height = 1080): InputSnapshot {
  return {
    time: 0,
    mouseX: width / 2,
    mouseY: height / 2,
    mouseNX: 0.5,
    mouseNY: 0.5,
    mouseVX: 0,
    mouseVY: 0,
    mouseSpeed: 0,
    mouseDown: false,
    scrollY: 0,
    scrollVelocity: 0,
    audioLevel: 0,
    audioLow: 0,
    audioMid: 0,
    audioHigh: 0,
    keys: {},
    orientation: { alpha: 0, beta: 0, gamma: 0 },
    width,
    height,
  };
}
