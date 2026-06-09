import type { FrameContext, InputSnapshot, PropertyValue } from "../core/types";
import type { Evaluator } from "../properties/expression";
import type { Layer } from "../scene/Layer";

/** Resources a renderer may use to allocate offscreen surfaces. */
export interface RenderHost {
  /** Hidden DOM node where offscreen renderers (p5 instances, WebGL canvases) live. */
  offscreenContainer: HTMLElement;
  pixelRatio: number;
}

export type CanvasSource = HTMLCanvasElement | OffscreenCanvas | ImageBitmap;

/**
 * Everything a layer needs to render exactly one frame. Note it extends
 * FrameContext (the composition clock) — a renderer never reads wall time, only
 * the time the engine hands it, which is what makes scrubbing & export work.
 */
export interface RenderFrame extends FrameContext {
  /** Evaluated values for this layer's properties, keyed by property key. */
  props: Record<string, PropertyValue>;
  /** Live evaluator, for renderers that pull other layers'/inputs' values directly. */
  evaluator: Evaluator;
  input: InputSnapshot;
  layer: Layer;
}

/**
 * The single contract every visual system implements. Plants, solids, images,
 * shaders, particles and future plugins all reduce to "given a frame, hand back a
 * drawable surface in your own content space". The engine owns transform, opacity
 * and blending so plugins never reimplement them.
 */
export interface LayerRenderer {
  render(frame: RenderFrame): CanvasSource | null;
  /** Called when the composition resolution changes. */
  resize?(width: number, height: number): void;
  dispose(): void;
}
