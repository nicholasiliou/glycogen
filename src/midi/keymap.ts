/**
 * Persistent MIDI keymap. The {@link MidiManager} learns a controller live but keeps nothing
 * between sessions; a `Keymap` is the editable, saved description of that controller — a friendly
 * name and a corrected input {@link ControlKind} for every physical control, plus what each control
 * is bound to.
 *
 * In the factory-core world a binding is dramatically simpler than the old assignment model: a
 * physical control points either at a **controller slot** (`knob:0`, `fader:1`, `pad:3`,
 * `crossfader:0`) — whatever focused plugin bound that slot reacts, so there is no per-plugin macro
 * table — or at an **app action** (browse, load, focus, bank select) that isn't a plugin parameter.
 *
 * Deliberately framework-free (pure data + localStorage), so it is trivial to unit-test and the UI
 * just renders/edits it.
 */
import { slotId, type ControlKind as SlotKind, type SlotId } from "@/controls/types";
import { KIND_BEHAVIOR, type ControlKind, type MidiControl } from "./types";

/** App-level functions a control can drive that are not plugin parameters. */
export type AppAction =
  | "browse" // relative → step by delta sign; button → step +1
  | "browseMode"
  | "loadA"
  | "loadB"
  | "clearA"
  | "clearB"
  | "focusA"
  | "focusB"
  | "focusShader"
  | "bankA0"
  | "bankA1"
  | "bankA2"
  | "bankB0"
  | "bankB1"
  | "bankB2";

/** What a physical control is wired to: a controller slot, an app action, or nothing. */
export type Binding =
  | { kind: "slot"; slot: SlotId }
  | { kind: "action"; action: AppAction };

/** Parse a `bank{A|B}{0..2}` action into deck + index. */
export function bankOf(a: AppAction): { deck: "A" | "B"; index: number } | null {
  const m = /^bank([AB])([012])$/.exec(a);
  return m ? { deck: m[1] as "A" | "B", index: Number(m[2]) } : null;
}

/** Actions that fire once on press (vs. `browse`, which can also sweep from a relative control). */
const MOMENTARY_ACTIONS = new Set<AppAction>([
  "browseMode", "loadA", "loadB", "clearA", "clearB",
  "focusA", "focusB", "focusShader",
  "bankA0", "bankA1", "bankA2", "bankB0", "bankB1", "bankB2",
]);
export function isMomentaryAction(a: AppAction): boolean {
  return MOMENTARY_ACTIONS.has(a);
}

// ── the bindable surface (for the settings picker) ──────────────────────────────────────────

/** Slots a plugin may bind, in the same counts the on-screen controller exposes. */
export const SLOT_CATALOG: { kind: SlotKind; count: number }[] = [
  { kind: "fader", count: 4 },
  { kind: "knob", count: 8 },
  { kind: "encoder", count: 4 },
  { kind: "pad", count: 8 },
  { kind: "button", count: 8 },
  { kind: "jog", count: 2 },
  { kind: "crossfader", count: 1 },
];

export const APP_ACTIONS: AppAction[] = [
  "browse", "browseMode", "loadA", "loadB", "clearA", "clearB",
  "focusA", "focusB", "focusShader",
  "bankA0", "bankA1", "bankA2", "bankB0", "bankB1", "bankB2",
];

export interface BindingOption {
  value: string; // serialized binding key, see bindingKey()
  label: string;
  binding: Binding | null;
}
export interface BindingGroup {
  label: string;
  options: BindingOption[];
}

/** A stable string key for a binding (used as the <option> value and for equality). */
export function bindingKey(b: Binding | null): string {
  if (!b) return "none";
  return b.kind === "slot" ? `slot:${b.slot}` : `action:${b.action}`;
}

export function parseBindingKey(key: string): Binding | null {
  if (key.startsWith("slot:")) return { kind: "slot", slot: key.slice(5) as SlotId };
  if (key.startsWith("action:")) return { kind: "action", action: key.slice(7) as AppAction };
  return null;
}

/** Grouped options for the inline binding picker in settings. */
export const BINDING_GROUPS: BindingGroup[] = [
  { label: "—", options: [{ value: "none", label: "Unassigned", binding: null }] },
  {
    label: "App",
    options: APP_ACTIONS.map((a) => ({ value: `action:${a}`, label: actionLabel(a), binding: { kind: "action", action: a } })),
  },
  ...SLOT_CATALOG.map((s) => ({
    label: s.kind,
    options: Array.from({ length: s.count }, (_, i) => {
      const slot = slotId(s.kind, i);
      return { value: `slot:${slot}`, label: slot, binding: { kind: "slot", slot } as Binding };
    }),
  })),
];

function actionLabel(a: AppAction): string {
  const bank = bankOf(a);
  if (bank) return `Bank ${bank.deck}${bank.index + 1}`;
  const labels: Partial<Record<AppAction, string>> = {
    browse: "Browse",
    browseMode: "Browse mode",
    loadA: "Load A",
    loadB: "Load B",
    clearA: "Clear A",
    clearB: "Clear B",
    focusA: "Focus A",
    focusB: "Focus B",
    focusShader: "Focus shader",
  };
  return labels[a] ?? a;
}

/** Short human label for a binding. */
export function bindingLabel(b: Binding | null): string {
  if (!b) return "Unassigned";
  return b.kind === "slot" ? b.slot : actionLabel(b.action);
}

// ── kind metadata (label + behaviour the manager derives from a kind) ──────────────────────────

export const CONTROL_KINDS: ControlKind[] = ["fader", "knob", "encoder", "jog", "button"];

export interface KindMeta {
  label: string;
  /** lucide-react icon name, mapped to a component in the UI layer. */
  icon: string;
  hint: string;
}

export const KIND_META: Record<ControlKind, KindMeta> = {
  fader: { label: "Fader", icon: "SlidersVertical", hint: "linear, absolute" },
  knob: { label: "Potentiometer", icon: "Circle", hint: "rotary, absolute" },
  encoder: { label: "Encoder", icon: "RotateCw", hint: "endless, relative" },
  jog: { label: "Jogwheel", icon: "Disc3", hint: "platter, relative" },
  button: { label: "Button", icon: "Square", hint: "momentary press" },
};

export function kindIsContinuous(kind: ControlKind): boolean {
  return KIND_BEHAVIOR[kind].continuous;
}
export function kindIsRelative(kind: ControlKind): boolean {
  return KIND_BEHAVIOR[kind].relative;
}

/** Best guess of a kind from what the manager auto-detected — the starting point a user edits. */
export function defaultKindFor(ctl: Pick<MidiControl, "continuous" | "relative" | "subtype">): ControlKind {
  if (!ctl.continuous) return "button";
  if (ctl.relative) return ctl.subtype === "jog" ? "jog" : "encoder";
  return ctl.subtype === "fader" ? "fader" : "knob";
}

// ── one physical control's saved identity + binding ────────────────────────────────────────────

export interface ControlBinding {
  controlId: string;
  name: string;
  kind: ControlKind;
  binding: Binding | null;
  /** Ignore this control entirely (e.g. a faulty / noisy one). */
  disabled?: boolean;
}

/** A named, savable keymap for a controller. */
export interface Keymap {
  id: string;
  name: string;
  /** Device this was captured on (a hint shown in the UI; not a hard match). */
  deviceName?: string;
  controls: Record<string, ControlBinding>;
  createdAt: number;
  updatedAt: number;
}

// ── effective controls: live stream ∪ saved keymap ─────────────────────────────────────────────

/** A row for the settings table / runtime: the saved identity merged with the live snapshot. */
export interface EffectiveControl {
  id: string;
  name: string;
  kind: ControlKind;
  continuous: boolean;
  relative: boolean;
  binding: Binding | null;
  disabled: boolean;
  /** Present in the active keymap (so it shows even before it's touched this session). */
  known: boolean;
  /** Live snapshot if the control has been seen this session. */
  live?: MidiControl;
}

/** Sort key so the table is stable while editing: CC, then pitch-bend, then notes; by id. */
function rankOf(id: string): [number, number, number] {
  const [t, ch, n] = id.split(":");
  const tr = t === "cc" ? 0 : t === "pb" ? 1 : 2;
  return [tr, Number(ch) || 0, Number(n) || 0];
}

export function effectiveControls(live: MidiControl[], keymap: Keymap | null): EffectiveControl[] {
  const byId = new Map<string, MidiControl>(live.map((c) => [c.id, c]));
  const ids = new Set<string>([...byId.keys(), ...Object.keys(keymap?.controls ?? {})]);
  const out: EffectiveControl[] = [];
  for (const id of ids) {
    const l = byId.get(id);
    const m = keymap?.controls[id];
    const kind = m?.kind ?? (l ? defaultKindFor(l) : "knob");
    out.push({
      id,
      name: m?.name ?? l?.label ?? id,
      kind,
      continuous: kindIsContinuous(kind),
      relative: kindIsRelative(kind),
      binding: m?.binding ?? null,
      disabled: m?.disabled ?? false,
      known: !!m,
      live: l,
    });
  }
  out.sort((a, b) => {
    const ra = rankOf(a.id);
    const rb = rankOf(b.id);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
  });
  return out;
}

// ── identity helpers ───────────────────────────────────────────────────────────────────────────

function uid(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createKeymap(name = "New keymap", deviceName?: string): Keymap {
  const now = Date.now();
  return { id: uid(), name, deviceName, controls: {}, createdAt: now, updatedAt: now };
}

export function duplicateKeymap(src: Keymap, name = `${src.name} copy`): Keymap {
  const now = Date.now();
  return { ...src, id: uid(), name, controls: { ...src.controls }, createdAt: now, updatedAt: now };
}

export function exportKeymap(keymap: Keymap): string {
  return JSON.stringify(keymap, null, 2);
}

export function parseKeymap(json: string): Keymap | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  return sanitizeKeymap(raw);
}

function isBinding(v: unknown): v is Binding {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  if (b.kind === "slot") return typeof b.slot === "string";
  if (b.kind === "action") return typeof b.action === "string" && (APP_ACTIONS as string[]).includes(b.action as string);
  return false;
}

export function sanitizeKeymap(raw: unknown): Keymap | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== "string" && o.name !== undefined) return null;

  const controls: Record<string, ControlBinding> = {};
  const rawControls = (o.controls && typeof o.controls === "object" ? o.controls : {}) as Record<string, unknown>;
  for (const [id, v] of Object.entries(rawControls)) {
    if (!v || typeof v !== "object") continue;
    const c = v as Record<string, unknown>;
    const kind = CONTROL_KINDS.includes(c.kind as ControlKind) ? (c.kind as ControlKind) : "knob";
    controls[id] = {
      controlId: id,
      name: typeof c.name === "string" ? c.name : id,
      kind,
      binding: isBinding(c.binding) ? c.binding : null,
      ...(c.disabled === true ? { disabled: true } : {}),
    };
  }

  const now = Date.now();
  return {
    id: uid(),
    name: typeof o.name === "string" && o.name.trim() ? o.name : "Imported keymap",
    deviceName: typeof o.deviceName === "string" ? o.deviceName : undefined,
    controls,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : now,
    updatedAt: now,
  };
}

// ── auto-assign: a sensible starting layout from the detected control kinds ──────────────────────

/**
 * Best-effort default layout for a two-deck DJ controller (e.g. Numark MixTrack). Hardware controls
 * map straight onto controller slots so the focused plugin's bound params respond immediately; a few
 * buttons drive app actions (load / browse-mode / banks). Stable input order; the user edits inline.
 */
export function autoAssign(controls: EffectiveControl[]): Record<string, Binding> {
  const enabled = controls.filter((c) => !c.disabled);
  const pick = (kind: ControlKind) => enabled.filter((c) => c.kind === kind);

  const out: Record<string, Binding> = {};
  const slot = (kind: SlotKind, i: number): Binding => ({ kind: "slot", slot: slotId(kind, i) });
  const action = (a: AppAction): Binding => ({ kind: "action", action: a });

  const assign = (list: EffectiveControl[], plan: Binding[]) =>
    list.forEach((c, i) => plan[i] && (out[c.id] = plan[i]));

  // Channel faders → fader slots; the widest/last fader → crossfader.
  const faders = pick("fader");
  assign(faders, [slot("fader", 0), slot("fader", 1), { kind: "slot", slot: "crossfader:0" }]);

  // Jog wheels → jog slots (primary performance control).
  assign(pick("jog"), [slot("jog", 0), slot("jog", 1)]);

  // First encoder → browse; the rest → encoder slots.
  assign(pick("encoder"), [action("browse"), slot("encoder", 0), slot("encoder", 1), slot("encoder", 2)]);

  // EQ knobs → knob slots.
  assign(pick("knob"), Array.from({ length: 8 }, (_, i) => slot("knob", i)));

  // Buttons: app actions first, then pad slots for the focused plugin. Pad slots start at 4 —
  // pad:0..3 are the decks' global Del/Bank rows and aren't plugin-bindable.
  assign(pick("button"), [
    action("loadA"), action("loadB"), action("browseMode"), action("clearA"), action("clearB"),
    action("bankA0"), action("bankA1"), action("bankA2"),
    action("bankB0"), action("bankB1"), action("bankB2"),
    slot("pad", 4), slot("pad", 5), slot("pad", 6), slot("pad", 7),
  ]);

  return out;
}

// ── localStorage persistence ─────────────────────────────────────────────────────────────────

const KEYMAPS_KEY = "marathon.midi.keymaps.v1";
const ACTIVE_KEY = "marathon.midi.activeKeymap.v1";

export function loadKeymaps(): Keymap[] {
  try {
    const raw = localStorage.getItem(KEYMAPS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((p) => normalizeStored(p)).filter((p): p is Keymap => p !== null);
  } catch {
    return [];
  }
}

/** Like {@link sanitizeKeymap} but keeps the stored id (round-trips our own persistence). */
function normalizeStored(raw: unknown): Keymap | null {
  const p = sanitizeKeymap(raw);
  if (!p) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id === "string" && o.id) p.id = o.id;
  return p;
}

export function saveKeymaps(keymaps: Keymap[]): void {
  try {
    localStorage.setItem(KEYMAPS_KEY, JSON.stringify(keymaps));
  } catch {
    /* ignore (private mode / SSR / quota) */
  }
}

export function loadActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function saveActiveId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}
