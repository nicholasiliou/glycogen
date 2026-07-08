import { ButtonParam, Param, type NumOpts } from "@/controls/Param";
import { DEFAULT_COLOR } from "./colors";

/**
 * A scalar field function that any plugin can export for other plugins to read.
 * Coordinates are normalised: x/y in [0,1], z is time or an animation axis.
 * Used by TextLayer to export a coverage mask that sim layers use to guide agents.
 *
 * `key` identifies the field's *content* so consumers can cache a rasterised mask and only rebuild
 * it when the content actually changes. A fresh closure is returned every frame, so its identity
 * (or `String(fn)`) is useless as a cache key — read `fn.key` instead. Omitted ⇒ treat as volatile.
 */
export interface FieldFn {
  (x: number, y: number, z: number): number;
  key?: string;
}

/** Real-time per-frame context handed to every plugin. No timeline — this is a live instrument. */
export interface Frame {
  width: number;
  height: number;
  /** Seconds since this plugin's stage started. */
  time: number;
  /** Seconds since the previous frame. */
  dt: number;
  /** For effects: the canvas of everything composited below. Null for the bottom of the stack. */
  input: HTMLCanvasElement | null;
  /**
   * Field function exported by a TextLayer earlier in the same deck's bank stack.
   * Sims (Physarum, RD, ContourField) use this to shape their behaviour around the text.
   * Null when no TextLayer is present below.
   */
  textField: FieldFn | null;
}

export type AnyParam = Param | ButtonParam;

/**
 * The plugin factory. Every visual plugin extends this and, in its field initialisers, declares the
 * params it wants — `spin = this.number({ min: -360, max: 360 })`, `wrap = this.toggle()`. A param
 * declaration says what the field *is* (range, step, button intent), never which control drives it:
 * at boot every declaration becomes a read-only row in the db's `params` table, and which
 * widget/hardware drives it is a remappable `paramBindings` row (factory layouts live in
 * db/seeds.ts). Everything else (the plugin's id, label, generator/effect) is derived from
 * structure, not declared.
 */
export abstract class Plugin {
  /**
   * The instance currently being constructed. Param declarations are field initialisers, which run
   * right after the base constructor — so even when a subclass constructor *body* throws (e.g. a
   * GL/p5-backed plugin in a headless boot harvest), the declarations are already complete on this
   * instance and the harvest can recover them.
   */
  static underConstruction: Plugin | null = null;

  /** Registry id (derived from the file path), stamped on by `create()`. Drives instrument lookup. */
  id = "";
  /** Every declared param, in declaration order — harvested into the db and shown by the panel. */
  readonly params: AnyParam[] = [];
  /** A plugin owns its output surface; generators draw here, effects usually return a shader canvas. */
  protected canvas: HTMLCanvasElement = document.createElement("canvas");

  /** Layer opacity 0..1 — the Stage composites this plugin's output at this alpha every frame.
   *  Bound to the reserved knob:9 via a locked db row (the per-plugin mixing control). */
  opacity = this.bind(new Param({ min: 0, max: 1, default: 1 }));

  /** The plugin's default draw color (a {@link COLOR_PRESETS} hex). Subclasses override where they
   *  draw differently; the Color shader adopts it as its starting preset when applied to a layer. */
  color = DEFAULT_COLOR;

  constructor() {
    Plugin.underConstruction = this;
  }

  // ── param declarations ──────────────────────────────────────────────────────────────────────
  /** A continuous (or, with `step`, quantised) numeric parameter. */
  protected number(o: NumOpts = {}): Param { return this.bind(new Param(o)); }
  /** An on/off parameter — read `.on`. */
  protected toggle(def = false): ButtonParam { return this.bind(new ButtonParam("toggle", { default: def })); }
  /** A one-shot parameter — read `.fired` (or diff `.count`). */
  protected trigger(): ButtonParam { return this.bind(new ButtonParam("trigger")); }
  /** A parameter cycling through named options — read `.pick([...])` (labels drive the UI chips). */
  protected cycle(options: readonly string[]): ButtonParam { return this.bind(new ButtonParam("cycle", { options })); }

  /**
   * Optional hook: called when this plugin is attached as a layer shader, with the host generator
   * it now transforms (the Color shader uses it to adopt the host's default color).
   */
  onAttach?(host: Plugin): void;

  private bind<T extends AnyParam>(p: T): T {
    this.params.push(p);
    return p;
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────────────────────
  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
  }

  /** Draw one frame. Return the surface to composite, or null to pass the input through unchanged. */
  abstract render(f: Frame): HTMLCanvasElement | null;

  /**
   * Optionally export a scalar field for downstream plugins to use (e.g. TextLayer exports
   * a coverage function so sim layers can shape agents around the text).
   * Return null (or omit this method) if this plugin exports nothing.
   */
  exportField?(): FieldFn | null;

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
  }
}
