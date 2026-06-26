/**
 * Persistent MIDI keymap ("preset"). The {@link MidiManager} learns a controller live but
 * keeps nothing between sessions; a `MidiPreset` is the editable, saved description of that
 * controller — a friendly name and a corrected input {@link ControlKind} for every physical
 * control, plus the performance-role assignments. Named presets are stored in localStorage so
 * a captured layout (e.g. a Numark MixTrack) survives reloads and can be exported/imported.
 *
 * Deliberately framework- and engine-free (mirrors the rest of `src/midi/`): pure data +
 * localStorage, so it is trivial to unit-test and the UI just renders/edits it.
 */
import { KIND_BEHAVIOR, type ControlKind, type MidiControl } from "./types";

/**
 * What a control *does*. Instead of a separate "roles" list, every control carries one
 * assignment: a stage-global function, or a per-deck **semantic slot** that each plugin maps to
 * its own parameters (so the same fader "grows" whatever plugin is loaded — the hand-crafted feel).
 */
export type Deck = "A" | "B";
export type Slot = "amount" | "evolveX" | "evolveY" | "toneX" | "toneY" | "trigger" | "toggle";
export type PlaceholderAssignment =
  | "placeholder1"
  | "placeholder2"
  | "placeholder3"
  | "placeholder4"
  | "placeholder5"
  | "placeholder6"
  | "placeholder7"
  | "placeholder8"
  | "placeholder9"
  | "placeholder10"
  | "placeholder11"
  | "placeholder12"
  | "placeholder13"
  | "placeholder14"
  | "placeholder15"
  | "placeholder16"
  | "placeholder17"
  | "placeholder18"
  | "placeholder19"
  | "placeholder20"
  | "placeholder21"
  | "placeholder22"
  | "placeholder23"
  | "placeholder24"
  | "placeholder25"
  | "placeholder26"
  | "placeholder27"
  | "placeholder28"
  | "placeholder29"
  | "placeholder30"
  | "placeholder31";

/**
 * A storage bank for a turntable side. Pressing a bank stores the plugin currently selected by the
 * browse wheel into that bank and makes it the side's active (MIDI-controlled) layer; all filled
 * banks keep rendering + sounding. Three banks per side, one active per side. `bankA1..bankB3`.
 */
export type BankAssignment = `bank${Deck}${1 | 2 | 3}`;
export const BANK_INDICES = [0, 1, 2] as const;
export type BankIndex = (typeof BANK_INDICES)[number];

export type GlobalAssignment =
  | "browse"
  | "loadA"
  | "loadB"
  | "clearA"
  | "clearB"
  | "crossfade"
  | "browseMode"
  | BankAssignment;
export type ControlAssignment = "none" | GlobalAssignment | PlaceholderAssignment | `${Deck}:${Slot}`;

/** Parse a bank assignment into its side + 0-based bank index, or null if it isn't one. */
export function bankOf(a: ControlAssignment): { deck: Deck; index: BankIndex } | null {
  const m = /^bank([AB])([123])$/.exec(a);
  if (!m) return null;
  return { deck: m[1] as Deck, index: (Number(m[2]) - 1) as BankIndex };
}
/** The assignment for a side's bank button (1-based-looking but takes a 0-based index). */
export function bankAssignment(deck: Deck, index: BankIndex): BankAssignment {
  return `bank${deck}${(index + 1) as 1 | 2 | 3}`;
}

export const SLOTS: Slot[] = ["amount", "evolveX", "evolveY", "toneX", "toneY", "trigger", "toggle"];

export interface SlotMeta {
  label: string;
  /** continuous slots want a knob/fader/encoder; momentary slots want a button. */
  continuous: boolean;
  /** prefers a relative control (encoder/jog). */
  relative: boolean;
}

export const SLOT_META: Record<Slot, SlotMeta> = {
  amount: { label: "Amount / Growth", continuous: true, relative: false },
  evolveX: { label: "Evolve X", continuous: true, relative: true },
  evolveY: { label: "Evolve Y", continuous: true, relative: true },
  toneX: { label: "Tone X", continuous: true, relative: false },
  toneY: { label: "Tone Y", continuous: true, relative: false },
  trigger: { label: "Trigger", continuous: false, relative: false },
  toggle: { label: "Toggle", continuous: false, relative: false },
};

export interface AssignmentOption {
  value: ControlAssignment;
  label: string;
}
export interface AssignmentGroup {
  label: string;
  options: AssignmentOption[];
}

/** Grouped options for the inline assignment picker in settings. */
export const ASSIGNMENT_GROUPS: AssignmentGroup[] = [
  {
    label: "—",
    options: [
      { value: "none", label: "Unassigned" },
      ...Array.from({ length: 31 }, (_, i) => ({
        value: `placeholder${i + 1}` as PlaceholderAssignment,
        label: `Placeholder ${i + 1}`,
      })),
    ],
  },
  {
    label: "Stage",
    options: [
      { value: "browse", label: "Browse" },
      { value: "clearA", label: "Clear A (active bank)" },
      { value: "clearB", label: "Clear B (active bank)" },
      { value: "crossfade", label: "Crossfade A/B" },
      { value: "browseMode", label: "Browse Mode" },
    ],
  },
  {
    label: "Banks",
    options: [
      ...BANK_INDICES.map((i) => ({ value: bankAssignment("A", i), label: `Bank A${i + 1}` })),
      ...BANK_INDICES.map((i) => ({ value: bankAssignment("B", i), label: `Bank B${i + 1}` })),
    ],
  },
  { label: "Deck A", options: SLOTS.map((s) => ({ value: `A:${s}` as ControlAssignment, label: SLOT_META[s].label })) },
  { label: "Deck B", options: SLOTS.map((s) => ({ value: `B:${s}` as ControlAssignment, label: SLOT_META[s].label })) },
];

const ASSIGN_LABEL = new Map(ASSIGNMENT_GROUPS.flatMap((g) => g.options.map((o) => [o.value, o.label] as const)));
/** Short human label for an assignment (e.g. "A · Amount / Growth"). */
export function assignmentLabel(a: ControlAssignment): string {
  const deck = assignmentDeck(a);
  if (deck) return `${deck} · ${SLOT_META[assignmentSlot(a)!].label}`;
  return ASSIGN_LABEL.get(a) ?? "Unassigned";
}
export function assignmentDeck(a: ControlAssignment): Deck | null {
  return a[1] === ":" ? (a[0] as Deck) : null;
}
export function assignmentSlot(a: ControlAssignment): Slot | null {
  return a[1] === ":" ? (a.slice(2) as Slot) : null;
}

/**
 * Placeholder slots driven by the on-screen SmoothKnob (endless encoder) widget — kept in sync
 * with the layout in Controller.tsx. A control bound to one of these is an encoder: it should be
 * registered relative so the engine accumulates its steps rather than reading an absolute sweep.
 */
export const SMOOTHKNOB_ASSIGNMENTS = new Set<ControlAssignment>([
  "placeholder6", "placeholder7", "placeholder8",
  "placeholder16", "placeholder17", "placeholder18",
]);
export function isSmoothKnobAssignment(a: ControlAssignment): boolean {
  return SMOOTHKNOB_ASSIGNMENTS.has(a);
}

/** Global assignments that fire once on press rather than sweeping a value. */
const MOMENTARY_GLOBALS = new Set<ControlAssignment>(["loadA", "loadB", "clearA", "clearB", "browseMode"]);
/**
 * Whether an assignment is momentary (fired on press: load/bank-select/browse-mode + per-deck
 * trigger/toggle) as opposed to continuous (browse/crossfade + amount/evolve/tone, which sweep).
 */
export function isMomentaryAssignment(a: ControlAssignment): boolean {
  const slot = assignmentSlot(a);
  if (slot) return !SLOT_META[slot].continuous;
  return !!bankOf(a) || MOMENTARY_GLOBALS.has(a);
}

/** One physical control's user-authored identity + function. */
export interface ControlMapping {
  controlId: string;
  name: string;
  kind: ControlKind;
  assignment: ControlAssignment;
  /** Ignore this control entirely (e.g. a faulty / noisy one). */
  disabled?: boolean;
}

/** A named, savable keymap for a controller. */
export interface MidiPreset {
  id: string;
  name: string;
  /** Device this was captured on (a hint shown in the UI; not a hard match). */
  deviceName?: string;
  controls: Record<string, ControlMapping>;
  createdAt: number;
  updatedAt: number;
}

// ── kind metadata (label + behaviour the manager derives from a kind) ──────────────────────

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

// ── effective controls: live stream ∪ saved preset ─────────────────────────────────────────

/** A row for the settings table / runtime: the saved identity merged with the live snapshot. */
export interface EffectiveControl {
  id: string;
  name: string;
  kind: ControlKind;
  continuous: boolean;
  relative: boolean;
  assignment: ControlAssignment;
  disabled: boolean;
  /** Present in the active preset (so it shows even before it's touched this session). */
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

/**
 * Union of currently-learned controls and the active preset's mappings. Live controls get the
 * preset's name/kind when present (else a sensible default); preset-only controls still appear
 * (greyed, no live value) so a saved keymap is fully visible before the device is touched.
 */
export function effectiveControls(live: MidiControl[], preset: MidiPreset | null): EffectiveControl[] {
  const byId = new Map<string, MidiControl>(live.map((c) => [c.id, c]));
  const ids = new Set<string>([...byId.keys(), ...Object.keys(preset?.controls ?? {})]);
  const out: EffectiveControl[] = [];
  for (const id of ids) {
    const l = byId.get(id);
    const m = preset?.controls[id];
    const kind = m?.kind ?? (l ? defaultKindFor(l) : "knob");
    out.push({
      id,
      name: m?.name ?? l?.label ?? id,
      kind,
      continuous: kindIsContinuous(kind),
      relative: kindIsRelative(kind),
      assignment: m?.assignment ?? "none",
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

// ── identity helpers ───────────────────────────────────────────────────────────────────────

function uid(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createPreset(name = "New preset", deviceName?: string): MidiPreset {
  const now = Date.now();
  return { id: uid(), name, deviceName, controls: {}, createdAt: now, updatedAt: now };
}

export function duplicatePreset(src: MidiPreset, name = `${src.name} copy`): MidiPreset {
  const now = Date.now();
  return {
    ...src,
    id: uid(),
    name,
    controls: { ...src.controls },
    createdAt: now,
    updatedAt: now,
  };
}

/** Pretty JSON for download. */
export function exportPreset(preset: MidiPreset): string {
  return JSON.stringify(preset, null, 2);
}

/**
 * Validate + normalize an imported object into a preset (new id, so importing never clobbers an
 * existing one). Returns `null` if the shape is unusable, so the UI can surface a clean error.
 */
export function parsePreset(json: string): MidiPreset | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  return sanitizePreset(raw);
}

export function sanitizePreset(raw: unknown): MidiPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== "string" && o.name !== undefined) return null;

  const controls: Record<string, ControlMapping> = {};
  const rawControls = (o.controls && typeof o.controls === "object" ? o.controls : {}) as Record<string, unknown>;
  for (const [id, v] of Object.entries(rawControls)) {
    if (!v || typeof v !== "object") continue;
    const c = v as Record<string, unknown>;
    let kind = CONTROL_KINDS.includes(c.kind as ControlKind) ? (c.kind as ControlKind) : "knob";
    const assignment = isAssignment(c.assignment) ? c.assignment : "none";
    // A control on an on-screen SmoothKnob is an endless encoder — fix any saved preset where it
    // was typed as an absolute knob/fader so it accumulates relative steps in the engine.
    if (isSmoothKnobAssignment(assignment)) kind = "encoder";
    controls[id] = {
      controlId: id,
      name: typeof c.name === "string" ? c.name : id,
      kind,
      assignment,
      ...(c.disabled === true ? { disabled: true } : {}),
    };
  }

  // Migrate the old `roles` map (wheel/add/remove) onto control assignments.
  const rawRoles = (o.roles && typeof o.roles === "object" ? o.roles : {}) as Record<string, unknown>;
  const ROLE_TO_ASSIGN: Record<string, { assignment: ControlAssignment; kind: ControlKind }> = {
    wheel: { assignment: "browse", kind: "encoder" },
    add: { assignment: "loadA", kind: "button" },
    remove: { assignment: "loadB", kind: "button" },
  };
  for (const [role, spec] of Object.entries(ROLE_TO_ASSIGN)) {
    const id = rawRoles[role];
    if (typeof id !== "string") continue;
    const existing = controls[id];
    controls[id] = existing
      ? { ...existing, assignment: existing.assignment === "none" ? spec.assignment : existing.assignment }
      : { controlId: id, name: id, kind: spec.kind, assignment: spec.assignment };
  }

  const now = Date.now();
  return {
    id: uid(),
    name: typeof o.name === "string" && o.name.trim() ? o.name : "Imported preset",
    deviceName: typeof o.deviceName === "string" ? o.deviceName : undefined,
    controls,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : now,
    updatedAt: now,
  };
}

const ALL_ASSIGNMENTS = new Set<string>(ASSIGNMENT_GROUPS.flatMap((g) => g.options.map((o) => o.value)));
function isAssignment(v: unknown): v is ControlAssignment {
  return typeof v === "string" && ALL_ASSIGNMENTS.has(v);
}

// ── auto-assign: a sensible starting layout from the detected control kinds ──────────────────

/**
 * Best-effort default layout so a freshly captured controller does something musical without
 * hand-wiring: faders → amount (A, B) then crossfade; encoders/jogs → browse then evolve;
 * knobs → tone; buttons → load then trigger/toggle. Stable order; the user edits inline after.
 */
export function autoAssign(controls: EffectiveControl[]): Record<string, ControlAssignment> {
  const enabled = controls.filter((c) => !c.disabled);
  const take = (pred: (c: EffectiveControl) => boolean) => enabled.filter(pred);
  const faders = take((c) => c.kind === "fader");
  const rotaries = take((c) => c.kind === "encoder" || c.kind === "jog");
  const knobs = take((c) => c.kind === "knob");
  const buttons = take((c) => c.kind === "button");

  const out: Record<string, ControlAssignment> = {};
  const assign = (list: EffectiveControl[], plan: ControlAssignment[]) =>
    list.forEach((c, i) => plan[i] && (out[c.id] = plan[i]));

  // faders: two amounts then a crossfade (a MixTrack has 2 channel faders + 1 crossfader)
  assign(faders, faders.length >= 3 ? ["A:amount", "B:amount", "crossfade"] : ["A:amount", "B:amount"]);
  assign(rotaries, ["browse", "A:evolveX", "A:evolveY", "B:evolveX", "B:evolveY"]);
  assign(knobs, ["A:toneX", "A:toneY", "B:toneX", "B:toneY"]);
  // Buttons also cover the stage actions the on-screen surface exposes (load each side + the six
  // storage banks + browse-mode), so a captured controller can drive them too — one keymap.
  assign(buttons, [
    "clearA", "clearB", "browseMode",
    bankAssignment("A", 0), bankAssignment("A", 1), bankAssignment("A", 2),
    bankAssignment("B", 0), bankAssignment("B", 1), bankAssignment("B", 2),
    "A:trigger", "A:toggle", "B:trigger", "B:toggle",
  ]);
  return out;
}

// ── localStorage persistence (mirrors modeStorage's defensive try/catch style) ──────────────

const PRESETS_KEY = "marathon.midi.presets.v1";
const ACTIVE_KEY = "marathon.midi.activePreset.v1";

export function loadPresets(): MidiPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((p) => normalizeStored(p))
      .filter((p): p is MidiPreset => p !== null);
  } catch {
    return [];
  }
}

/** Like {@link sanitizePreset} but keeps the stored id (round-trips our own persistence). */
function normalizeStored(raw: unknown): MidiPreset | null {
  const p = sanitizePreset(raw);
  if (!p) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id === "string" && o.id) p.id = o.id;
  return p;
}

export function savePresets(presets: MidiPreset[]): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
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
