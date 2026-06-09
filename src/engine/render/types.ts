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
  /**
   * For `kind: "effect"` layers only: a snapshot of everything composited below this
   * layer (within its container). The effect reads this and returns a full-frame result.
   */
  backdrop?: HTMLCanvasElement | null;
  /** Source output of the layer directly beneath this one (noise field / 3D geometry). */
  below?: BelowSource | null;
}

/**
 * The single contract every visual system implements. Plants, solids, images,
 * shaders, particles and future plugins all reduce to "given a frame, hand back a
 * drawable surface in your own content space". The engine owns transform, opacity
 * and blending so plugins never reimplement them.
 */
/**
 * Output a layer can expose to the consumer layer directly ABOVE it in the stack, so
 * layers can feed off each other (e.g. a Noise layer feeding a Glyph Scatter or a
 * Landscape; a Landscape/Model feeding the Slicer) — a little dataflow inside the
 * layer stack, which removes duplicated noise/geometry config.
 */
export interface BelowSource {
  layerType: string;
  /** A scalar field sampler (e.g. fBm noise), roughly [-1,1] or [0,1]. */
  field?: (x: number, y: number, z: number) => number;
  /** Lazy 3D geometry (triangles, 9 numbers each), normalised to roughly [-1,1]. */
  mesh?: () => { tris: number[] } | null;
  /** Changes when the field/mesh would change — lets consumers cache. */
  key?: string;
}

export interface LayerRenderer {
  render(frame: RenderFrame): CanvasSource | null;
  /** Called when the composition resolution changes. */
  resize?(width: number, height: number): void;
  dispose(): void;

  // ── optional "source" capabilities (consumed by the layer above) ──
  /** Build a scalar-field sampler for the given evaluated props. */
  fieldSource?(props: Record<string, PropertyValue>): ((x: number, y: number, z: number) => number) | undefined;
  /** Build 3D geometry for the given evaluated props/time. */
  meshSource?(props: Record<string, PropertyValue>, time: number): { tris: number[] } | null;
  /** Cache key for fieldSource/meshSource (props + time as needed). */
  sourceKey?(props: Record<string, PropertyValue>, time: number): string;
}
