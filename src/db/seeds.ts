/**
 * Seed data for the code-sourced tables and the default layouts.
 *
 * `WIDGET_CATALOG` is the authoritative description of the controller surface — it matches what
 * `Controller.tsx` actually renders (left pads 4–12, right pads 17–25, mixer pads 26–28,
 * encoders 0–5, faders 0–2, buttons 0–1) plus the hardware-only knob:8 and the app-reserved
 * widgets (knob:9 opacity, jog:0/jog:1 browse).
 *
 * `DEFAULT_LAYOUTS` is the per-plugin factory layout: which widget each param sits on out of the
 * box. It is only materialised into `paramBindings` rows for a plugin the user hasn't remapped yet
 * (copy-on-first-touch) — after that the rows are the user's, and "Reset to default" re-seeds.
 */
import { defaultAdapter } from "@/controls/adapters";
import { slotId, type SlotId } from "@/controls/types";
import {
  actionBindings,
  appActions,
  paramBindings,
  paramId,
  params,
  plugins,
  uid,
  widgets,
  type AppAction,
  type AppActionRow,
  type WidgetRow,
} from "./schema";

// ── the controller surface ──────────────────────────────────────────────────────────────────────

function range(kind: WidgetRow["kind"], from: number, to: number): WidgetRow[] {
  return Array.from({ length: to - from + 1 }, (_, i) => ({
    id: slotId(kind, from + i),
    kind,
    index: from + i,
  }));
}

export const WIDGET_CATALOG: WidgetRow[] = [
  ...range("fader", 0, 2),
  ...range("knob", 0, 8), // knob:8 has no on-screen widget (hardware-only) but is a real slot
  { id: "knob:9", kind: "knob", index: 9, reserved: "opacity" },
  ...range("encoder", 0, 5),
  // The jog wheels are the two always-live browse dials (plugins left, shaders right).
  { id: "jog:0", kind: "jog", index: 0, reserved: "browsePlugin" },
  { id: "jog:1", kind: "jog", index: 1, reserved: "browseShader" },
  ...range("button", 0, 1),
  ...range("pad", 0, 12), // left panel (0..3 = top row, factory home of Clear/Bank 1–3)
  ...range("pad", 13, 25), // right panel (13..16 = top row, factory home of Bank 4–6)
  ...range("pad", 26, 28), // mixer
];

// ── app actions ─────────────────────────────────────────────────────────────────────────────────

export const APP_ACTION_SEED: AppActionRow[] = [
  { id: "clear", label: "Clear" },
  { id: "bank0", label: "Bank 1" },
  { id: "bank1", label: "Bank 2" },
  { id: "bank2", label: "Bank 3" },
  { id: "bank3", label: "Bank 4" },
  { id: "bank4", label: "Bank 5" },
  { id: "bank5", label: "Bank 6" },
];

/** Factory placement of the app functions on the pads' top rows (pad:13 is the spare). */
export const DEFAULT_ACTION_LAYOUT: Record<string, AppAction> = {
  "pad:0": "clear",
  "pad:1": "bank0",
  "pad:2": "bank1",
  "pad:3": "bank2",
  "pad:14": "bank3",
  "pad:15": "bank4",
  "pad:16": "bank5",
};

// ── factory layouts (transcribed 1:1 from the plugins' former hardcoded slots) ──────────────────

export const DEFAULT_LAYOUTS: Record<string, Record<string, SlotId>> = {
  boids: {
    count: "knob:0", perception: "knob:1", separationRange: "knob:2", maxSpeed: "knob:3",
    maxForce: "knob:4", separation: "knob:5", alignment: "knob:6", cohesion: "knob:7",
    size: "knob:8", trail: "fader:0", seed: "fader:1", wrap: "pad:4", dot: "pad:5", reseed: "pad:6",
  },
  contourField: {
    resolution: "knob:0", scale: "knob:1", octaves: "knob:2", warp: "knob:3", levels: "knob:4",
    evolveSpeed: "knob:5", swirlSpeed: "knob:6", lineWidth: "knob:7", seed: "knob:8", textStrength: "fader:1",
  },
  gameOfLife: {
    cellSize: "knob:0", density: "knob:1", speed: "knob:2", trail: "knob:3", gap: "knob:4",
    seed: "knob:5", wrap: "pad:4", reseed: "pad:5",
  },
  harmonograph: {
    freqX1: "knob:0", freqY1: "knob:1", freqX2: "knob:2", freqY2: "knob:3", phaseSpeed: "knob:4",
    damping: "knob:5", cycles: "knob:6", lineWidth: "knob:7", phase: "fader:0",
  },
  landscape: {
    resolution: "knob:0", amplitude: "knob:1", scale: "knob:2", octaves: "knob:3", terrace: "knob:4",
    radius: "knob:5", lineWidth: "knob:6", speed: "knob:7", tiltX: "fader:0", tiltY: "fader:1",
    tiltZ: "fader:2", spin: "encoder:0", filled: "pad:4", depthShade: "pad:5",
  },
  noise: {
    detail: "knob:0", scale: "knob:1", octaves: "knob:2", persistence: "knob:3", lacunarity: "knob:4",
    contrast: "knob:5", bands: "knob:6", speed: "knob:7", seed: "knob:8",
  },
  physarum: {
    count: "knob:0", sensorDist: "knob:1", sensorAngle: "knob:2", turnAngle: "knob:3", stepSize: "knob:4",
    deposit: "knob:5", decay: "knob:6", gain: "knob:7", seed: "knob:8", speed: "fader:0",
    textStrength: "fader:1", textMode: "pad:4", reseed: "pad:5",
  },
  plant: {
    iterations: "knob:0", cameraScale: "knob:1", spinSpeed: "knob:2", evolutionSpeed: "knob:3",
    seed: "fader:0", autoEvolve: "pad:4", opaque: "pad:5",
  },
  reactionDiffusion: {
    pattern: "pad:4", reseed: "pad:5", textMode: "pad:6", resolution: "knob:0", iterations: "knob:1",
    gain: "knob:2", seed: "knob:3", textStrength: "fader:1",
  },
  shape: {
    shape: "pad:4", resolution: "knob:0", radius: "knob:1", lineWidth: "knob:2", tiltX: "fader:0",
    tiltY: "fader:1", tiltZ: "fader:2", spin: "encoder:0", filled: "pad:5", depthShade: "pad:6", cull: "pad:7",
  },
  text: { preset: "pad:4", font: "pad:5", bold: "pad:6", fontSize: "knob:0", tracking: "knob:1" },
  volumetricCloud: {
    detail: "knob:0", scale: "knob:1", octaves: "knob:2", coverage: "knob:3", density: "knob:4",
    steps: "knob:5", shadow: "knob:6", speed: "knob:7",
  },
  glyph: { glyph: "pad:4", padding: "knob:0", gap: "knob:1" },
  glyphScatter: {
    cell: "knob:0", threshold: "knob:1", scale: "knob:2", noiseScale: "knob:3", speed: "knob:4",
    jitter: "knob:5", seed: "knob:6", textStrength: "fader:1",
  },
  ascii: { cell: "knob:0", colored: "pad:4" },
  bayer: { levels: "knob:0", scale: "knob:1", colored: "pad:4" },
  colorLookup: { count: "knob:0", amount: "knob:1" },
  deepGlow: {
    radius0: "knob:0", radius1: "knob:1", radius2: "knob:2", str0: "knob:3", str1: "knob:4",
    str2: "knob:5", mix: "knob:6",
  },
  fisheye: { strength: "knob:0", zoom: "knob:1" },
  color: { preset: "pad:4" }, // the palette-cycle shader (replaces the old hue knob)
  none: {}, // passthrough shader — nothing to bind (opacity comes from its locked row)
  pixelSort: { threshold: "knob:0", horizontal: "pad:4", reverse: "pad:5" },
  pixelStretch: { threshold: "knob:0", amount: "knob:1", horizontal: "pad:4" },
  pixelate: { size: "knob:0" },
  tracker: {
    count: "knob:0", grid: "knob:1", smoothing: "knob:2", sampleRate: "knob:3", lineLength: "knob:4",
    dashLength: "knob:5", boxThickness: "knob:6", lineThickness: "knob:7", direction: "pad:4", showBackdrop: "pad:5",
  },
  venetianBlinds: { bands: "knob:0", offset: "knob:1", angle: "fader:0", fade: "knob:2" },
};

// ── materialisation ─────────────────────────────────────────────────────────────────────────────

export function seedCodeTables(): void {
  widgets.replaceAll(WIDGET_CATALOG);
  appActions.replaceAll(APP_ACTION_SEED);
}

/** Deterministic id so re-seeding upserts instead of duplicating. */
function seedRowId(pluginId: string, field: string): string {
  return `seed:${pluginId}:${field}`;
}

/** Materialise the factory layout rows for one plugin (used by boot and "Reset to default"). */
export function seedPluginBindings(pluginId: string): void {
  const layout = DEFAULT_LAYOUTS[pluginId] ?? {};
  for (const [field, widgetId] of Object.entries(layout)) {
    const param = params.get(paramId(pluginId, field));
    const widget = widgets.get(widgetId);
    if (!param || !widget) {
      console.warn(`[db.seed] ${pluginId}.${field} → ${widgetId}: ${param ? "widget" : "param"} missing`);
      continue;
    }
    const adapter = defaultAdapter(param.control, widget.kind);
    if (!adapter) {
      console.warn(`[db.seed] ${pluginId}.${field} → ${widgetId}: no legal adapter`);
      continue;
    }
    if (actionBindings.by("widget", widgetId).length > 0) {
      console.warn(`[db.seed] ${pluginId}.${field} → ${widgetId}: occupied by an app action`);
      continue;
    }
    paramBindings.upsert({ id: seedRowId(pluginId, field), pluginId, widgetId, paramId: param.id, adapter });
  }
}

/**
 * Copy-on-first-touch for the app functions: only when the user has never placed any (the table is
 * empty) does the factory layout materialise — after that the rows are the user's.
 */
export function seedActionBindings(): void {
  if (actionBindings.size > 0) return;
  for (const [widgetId, actionId] of Object.entries(DEFAULT_ACTION_LAYOUT)) {
    actionBindings.insert({ id: uid(), widgetId: widgetId as SlotId, actionId });
  }
}

/**
 * Copy-on-first-touch: plugins with no user rows get their factory layout; every plugin always
 * gets its locked opacity row (the one binding allowed on the reserved knob:9).
 */
export function seedParamBindings(): void {
  for (const plugin of plugins.all()) {
    const rows = paramBindings.by("plugin", plugin.id);
    if (rows.filter((r) => !r.locked).length === 0) seedPluginBindings(plugin.id);

    const opacity = params.get(paramId(plugin.id, "opacity"));
    if (opacity && !paramBindings.has(`opacity:${plugin.id}`)) {
      paramBindings.upsert({
        id: `opacity:${plugin.id}`,
        pluginId: plugin.id,
        widgetId: "knob:9",
        paramId: opacity.id,
        adapter: { kind: "absolute" },
        locked: true,
      });
    }
  }
}
