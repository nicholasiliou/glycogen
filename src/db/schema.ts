/**
 * ── THE control-binding database ────────────────────────────────────────────────────────────────
 *
 * Every piece of control wiring in the app is a row in one of these tables. Nothing else may hold
 * binding state: not plugins, not the router, not the UI. If you are adding a feature that needs
 * "when X is touched, Y happens", it is either a new `params` row (declare it in a plugin — see
 * `Plugin.number()/toggle()/trigger()/cycle()`), a new `appActions` row (seeded in seeds.ts), or a
 * new *binding* row wiring existing ones together. You never hand-write JSON.
 *
 * The relational chain:
 *
 *   hardwareControls ──hardwareBindings──▶ widgets ◀──paramBindings──▶ params ──▶ plugins
 *                                             ▲              └── carries an AdapterSpec
 *                        appActions ◀──actionBindings
 *
 * A `widget` is one logical control on the on-screen surface (and the slot hardware maps onto), so
 * remapping a param to a different widget moves BOTH the on-screen control and the MIDI key. Each
 * widget holds at most ONE occupant: either a plugin param (per-plugin) or an app action (global) —
 * never both. Hardware binds only to widgets; an app function reaches hardware through its widget.
 *
 * Two lifecycles, visible in the persistence column:
 *   • code-sourced tables (plugins, params, widgets, appActions) are re-seeded from typed
 *     registrations every boot and never stored — the code is their source of truth;
 *   • user-mutable tables (hardwareControls, hardwareBindings, paramBindings, actionBindings,
 *     paramDefaults, presets) persist to localStorage and are pruned on boot if their FKs no
 *     longer resolve.
 *
 * Live per-frame values are NOT stored here — that's the ControlBus's job. This db is structure.
 */
import { legalAdapters, WIDGET_SIGNAL, type AdapterSpec } from "@/controls/adapters";
import type { ControlKind, SlotId } from "@/controls/types";
import type { ControlKind as MidiControlKind } from "@/midi/types";
import { Db } from "./engine";

// ── row types ───────────────────────────────────────────────────────────────────────────────────

export interface PluginRow {
  /** Registry id derived from the file path, e.g. "boids". */
  id: string;
  label: string;
  kind: "generator" | "effect";
}

/** What a param *is* — the metadata adapter legality derives from. Authored in plugin code. */
export type ParamControl =
  | { type: "number"; min: number; max: number; step: number; default: number; smooth: number }
  | { type: "toggle"; default: boolean }
  | { type: "trigger" }
  | { type: "cycle"; options: readonly string[] };

export interface ParamRow {
  /** `${pluginId}/${fieldName}`, e.g. "boids/perception". */
  id: string;
  pluginId: string;
  /** The plugin field name — drives labels everywhere. */
  name: string;
  /** Declaration order, for stable panel sorting. */
  order: number;
  control: ParamControl;
}

export interface WidgetRow {
  /** Keeps the ControlBus "kind:index" format so the bus and remote bridge stay untouched. */
  id: SlotId;
  kind: ControlKind;
  index: number;
  /** App-reserved widgets — rejected as paramBinding targets unless the row is `locked`. */
  reserved?: "opacity" | "browsePlugin" | "browseShader";
}

/** App-level functions that aren't plugin parameters. All press-driven — legal only on press widgets. */
export type AppAction =
  | "clear"
  | "bank0"
  | "bank1"
  | "bank2"
  | "bank3"
  | "bank4"
  | "bank5";

export interface AppActionRow {
  id: AppAction;
  label: string;
}

/** Parse a `bank{0..5}` action into a bank index. */
export function bankOf(a: AppAction): number | null {
  const m = /^bank([0-5])$/.exec(a);
  return m ? Number(m[1]) : null;
}

export interface HardwareControlRow {
  /** Stable physical identity, e.g. "cc:0:7", "note:0:36", "pb:0". */
  id: string;
  /** Human label — auto from the manager, user-correctable. */
  name: string;
  /** Authoritative input kind (user-correctable) — how the manager interprets messages. */
  kind: MidiControlKind;
  disabled: boolean;
  deviceName?: string;
}

export interface HardwareBindingRow {
  id: string;
  /** One binding per physical control (unique). */
  controlId: string;
  /** Hardware binds only to widgets — an app function reaches hardware through the widget it sits on. */
  widgetId: SlotId;
  /** Flip an absolute value (e.g. a crossfader that reports inverted). */
  invert?: boolean;
}

/** One assignable occupant per widget: an app function sitting on a press widget (pad/button). */
export interface ActionBindingRow {
  id: string;
  widgetId: SlotId;
  actionId: AppAction;
}

export interface ParamBindingRow {
  id: string;
  pluginId: string;
  /** One binding per widget per plugin (unique). */
  widgetId: SlotId;
  paramId: string;
  adapter: AdapterSpec;
  /** System rows (opacity → knob:9) — allowed on reserved widgets, not user-deletable. */
  locked?: boolean;
}

/**
 * Admin-authored default override for one param: the value a plugin's param lands on whenever the
 * plugin is created, replacing its code-declared default. Authored visually via the `#admin`
 * controls-panel surface; `id` IS the param id, so one override per param. Numbers for number
 * params, `{count, on}` for button params (cycle position / toggle state).
 */
export interface ParamDefaultRow {
  id: string;
  pluginId: string;
  value: number | { count: number; on: boolean };
}

export interface PresetRow {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  data: {
    paramBindings: ParamBindingRow[];
    actionBindings: ActionBindingRow[];
    hardwareBindings: HardwareBindingRow[];
    hardwareControls: HardwareControlRow[];
  };
}

// ── the database ────────────────────────────────────────────────────────────────────────────────

export const db = new Db();

// code-sourced (re-seeded every boot, never persisted)

export const plugins = db.table<PluginRow>("plugins");

export const params = db.table<ParamRow>("params", {
  fks: [{ table: () => plugins, ids: (r) => [r.pluginId], onDelete: "cascade" }],
  indexes: { plugin: (r) => r.pluginId },
});

export const widgets = db.table<WidgetRow>("widgets");

export const appActions = db.table<AppActionRow>("appActions");

// user-mutable (persisted to localStorage)

export const hardwareControls = db.table<HardwareControlRow>("hardwareControls", {
  persist: { key: "marathon.db.hardwareControls.v1", sanitize: sanitizeHardwareControl },
});

export const hardwareBindings = db.table<HardwareBindingRow>("hardwareBindings", {
  persist: { key: "marathon.db.hardwareBindings.v1", sanitize: sanitizeHardwareBinding },
  fks: [
    { table: () => hardwareControls, ids: (r) => [r.controlId], onDelete: "cascade" },
    { table: () => widgets, ids: (r) => [r.widgetId], onDelete: "cascade" },
  ],
  uniques: { control: (r) => r.controlId },
  indexes: { control: (r) => r.controlId },
});

export const actionBindings = db.table<ActionBindingRow>("actionBindings", {
  persist: { key: "marathon.db.actionBindings.v1", sanitize: sanitizeActionBinding },
  fks: [
    { table: () => widgets, ids: (r) => [r.widgetId], onDelete: "cascade" },
    { table: () => appActions, ids: (r) => [r.actionId], onDelete: "cascade" },
  ],
  // One occupant per widget AND one widget per action — both sides are 1:1.
  uniques: { widget: (r) => r.widgetId, action: (r) => r.actionId },
  indexes: { widget: (r) => r.widgetId },
  validate: (r) => {
    const widget = widgets.get(r.widgetId);
    if (widget && WIDGET_SIGNAL[widget.kind] !== "press") return `actions are press-driven — "${r.widgetId}" is not a press widget`;
    if (widget?.reserved) return `widget "${r.widgetId}" is reserved for ${widget.reserved}`;
    return null;
  },
});

export const paramBindings = db.table<ParamBindingRow>("paramBindings", {
  persist: { key: "marathon.db.paramBindings.v1", sanitize: sanitizeParamBinding },
  fks: [
    { table: () => plugins, ids: (r) => [r.pluginId], onDelete: "cascade" },
    { table: () => params, ids: (r) => [r.paramId], onDelete: "cascade" },
    { table: () => widgets, ids: (r) => [r.widgetId], onDelete: "cascade" },
  ],
  uniques: { widgetPerPlugin: (r) => `${r.pluginId} ${r.widgetId}` },
  indexes: { plugin: (r) => r.pluginId },
  validate: (r) => {
    const param = params.get(r.paramId);
    if (param && param.pluginId !== r.pluginId)
      return `param "${r.paramId}" belongs to "${param.pluginId}", not "${r.pluginId}"`;
    const widget = widgets.get(r.widgetId);
    if (widget?.reserved && !r.locked) return `widget "${r.widgetId}" is reserved for ${widget.reserved}`;
    // One occupant per widget across kinds: an app function on a widget evicts/blocks params there.
    if (actionBindings.by("widget", r.widgetId).length > 0)
      return `widget "${r.widgetId}" is occupied by an app action`;
    if (param && widget && !legalAdapters(param.control, widget.kind).includes(r.adapter.kind))
      return `adapter "${r.adapter.kind}" is not legal for ${param.control.type} ← ${widget.kind}`;
    return null;
  },
});

export const paramDefaults = db.table<ParamDefaultRow>("paramDefaults", {
  persist: { key: "marathon.db.paramDefaults.v1", sanitize: sanitizeParamDefault },
  fks: [
    { table: () => plugins, ids: (r) => [r.pluginId], onDelete: "cascade" },
    { table: () => params, ids: (r) => [r.id], onDelete: "cascade" },
  ],
  indexes: { plugin: (r) => r.pluginId },
  validate: (r) => {
    const param = params.get(r.id);
    if (!param) return null; // FK pruning handles missing params
    if (param.pluginId !== r.pluginId) return `param "${r.id}" belongs to "${param.pluginId}", not "${r.pluginId}"`;
    if ((param.control.type === "number") !== (typeof r.value === "number"))
      return `value shape doesn't match a ${param.control.type} param`;
    return null;
  },
});

export const presets = db.table<PresetRow>("presets", {
  persist: { key: "marathon.db.presets.v1", sanitize: sanitizePreset },
});

// ── stored-row sanitizers (never trust localStorage) ────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

const MIDI_KINDS: MidiControlKind[] = ["fader", "knob", "encoder", "jog", "button"];

export function sanitizeHardwareControl(raw: unknown): HardwareControlRow | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) return null;
  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : raw.id,
    kind: MIDI_KINDS.includes(raw.kind as MidiControlKind) ? (raw.kind as MidiControlKind) : "knob",
    disabled: raw.disabled === true,
    ...(typeof raw.deviceName === "string" ? { deviceName: raw.deviceName } : {}),
  };
}

export function sanitizeHardwareBinding(raw: unknown): HardwareBindingRow | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.controlId !== "string") return null;
  // Accept the old `{ target: { type: "widget", widgetId } }` shape; action-target rows are dropped
  // (an app function reaches hardware through the widget it sits on now).
  const legacy = isRecord(raw.target) && raw.target.type === "widget" ? raw.target.widgetId : undefined;
  const widgetId = typeof raw.widgetId === "string" ? raw.widgetId : typeof legacy === "string" ? legacy : null;
  if (!widgetId) return null;
  return { id: raw.id, controlId: raw.controlId, widgetId: widgetId as SlotId, ...(raw.invert === true ? { invert: true } : {}) };
}

export function sanitizeActionBinding(raw: unknown): ActionBindingRow | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  if (typeof raw.widgetId !== "string" || typeof raw.actionId !== "string") return null;
  return { id: raw.id, widgetId: raw.widgetId as SlotId, actionId: raw.actionId as AppAction };
}

export function sanitizeParamDefault(raw: unknown): ParamDefaultRow | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.pluginId !== "string") return null;
  const v = raw.value;
  if (typeof v === "number" && Number.isFinite(v)) return { id: raw.id, pluginId: raw.pluginId, value: v };
  if (isRecord(v) && typeof v.count === "number" && typeof v.on === "boolean")
    return { id: raw.id, pluginId: raw.pluginId, value: { count: v.count, on: v.on } };
  return null;
}

function sanitizeAdapter(raw: unknown): AdapterSpec | null {
  if (!isRecord(raw) || typeof raw.kind !== "string") return null;
  const kinds = ["absolute", "relative", "toggle", "momentary", "trigger", "cycle"];
  if (!kinds.includes(raw.kind)) return null;
  return { kind: raw.kind as AdapterSpec["kind"], ...(raw.invert === true ? { invert: true } : {}) };
}

export function sanitizeParamBinding(raw: unknown): ParamBindingRow | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  if (typeof raw.pluginId !== "string" || typeof raw.widgetId !== "string" || typeof raw.paramId !== "string") return null;
  const adapter = sanitizeAdapter(raw.adapter);
  if (!adapter) return null;
  return {
    id: raw.id,
    pluginId: raw.pluginId,
    widgetId: raw.widgetId as SlotId,
    paramId: raw.paramId,
    adapter,
    ...(raw.locked === true ? { locked: true } : {}),
  };
}

export function sanitizePreset(raw: unknown): PresetRow | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  const data = isRecord(raw.data) ? raw.data : {};
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  return {
    id: raw.id,
    name: raw.name,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
    data: {
      paramBindings: list(data.paramBindings).map(sanitizeParamBinding).filter((r): r is ParamBindingRow => !!r),
      actionBindings: list(data.actionBindings).map(sanitizeActionBinding).filter((r): r is ActionBindingRow => !!r),
      hardwareBindings: list(data.hardwareBindings).map(sanitizeHardwareBinding).filter((r): r is HardwareBindingRow => !!r),
      hardwareControls: list(data.hardwareControls).map(sanitizeHardwareControl).filter((r): r is HardwareControlRow => !!r),
    },
  };
}

// ── common mutations ────────────────────────────────────────────────────────────────────────────

/**
 * Point a physical control at a widget (or nothing) — replaces any existing binding row for
 * that control.
 */
export function setHardwareBinding(controlId: string, widgetId: SlotId | null): void {
  const existing = hardwareBindings.by("control", controlId)[0];
  if (existing) hardwareBindings.delete(existing.id);
  if (widgetId === null) return;
  hardwareBindings.insert({ id: uid(), controlId, widgetId });
}

/**
 * Put a param on a widget (1:1 within a plugin): replaces both the widget's previous occupant and
 * the param's previous binding. `adapterKind` defaults to the first legal adapter; passing null as
 * `widgetId` just unbinds the param. Bails if the widget is occupied by an app action (defensive —
 * the UI filters legality anyway).
 */
export function setParamBinding(pluginId: string, pId: string, widgetId: SlotId | null, adapterKind?: AdapterSpec["kind"]): void {
  if (widgetId !== null && actionBindings.by("widget", widgetId).length > 0) return;
  for (const row of paramBindings.by("plugin", pluginId)) {
    if (row.locked) continue;
    if (row.paramId === pId || (widgetId !== null && row.widgetId === widgetId)) paramBindings.delete(row.id);
  }
  if (widgetId === null) return;
  const param = params.get(pId);
  const widget = widgets.get(widgetId);
  if (!param || !widget) return;
  const kind = adapterKind ?? legalAdapters(param.control, widget.kind)[0];
  if (!kind) return;
  paramBindings.insert({ id: uid(), pluginId, widgetId, paramId: pId, adapter: { kind } });
}

/**
 * Put an app function on a press widget (or nothing): replaces the action's previous widget and
 * the widget's previous action, and evicts EVERY plugin's param bindings from that widget — one
 * occupant per widget, and actions are global while params are per-plugin.
 */
export function setActionBinding(actionId: AppAction, widgetId: SlotId | null): void {
  for (const row of actionBindings.all()) {
    if (row.actionId === actionId || (widgetId !== null && row.widgetId === widgetId)) actionBindings.delete(row.id);
  }
  if (widgetId === null) return;
  for (const row of paramBindings.all()) {
    if (row.widgetId === widgetId && !row.locked) paramBindings.delete(row.id);
  }
  actionBindings.insert({ id: uid(), widgetId, actionId });
}

// ── id helper ───────────────────────────────────────────────────────────────────────────────────

export function uid(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function paramId(pluginId: string, fieldName: string): string {
  return `${pluginId}/${fieldName}`;
}
