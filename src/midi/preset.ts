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

/** Reserved global controls that drive the performance, not a single plugin param. */
export type PerformanceRole = "wheel" | "add" | "remove";

export const PERFORMANCE_ROLES: { role: PerformanceRole; label: string; hint: string; continuous: boolean }[] = [
  { role: "wheel", label: "Jog / Wheel", hint: "spin the sundial", continuous: true },
  { role: "add", label: "Add to stage", hint: "drop the selected plugin", continuous: false },
  { role: "remove", label: "Remove from stage", hint: "delete the active plugin", continuous: false },
];

/** One physical control's user-authored identity. */
export interface ControlMapping {
  controlId: string;
  name: string;
  kind: ControlKind;
}

/** A named, savable keymap for a controller. */
export interface MidiPreset {
  id: string;
  name: string;
  /** Device this was captured on (a hint shown in the UI; not a hard match). */
  deviceName?: string;
  controls: Record<string, ControlMapping>;
  roles: Partial<Record<PerformanceRole, string>>;
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
  return { id: uid(), name, deviceName, controls: {}, roles: {}, createdAt: now, updatedAt: now };
}

export function duplicatePreset(src: MidiPreset, name = `${src.name} copy`): MidiPreset {
  const now = Date.now();
  return {
    ...src,
    id: uid(),
    name,
    controls: { ...src.controls },
    roles: { ...src.roles },
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
    const kind = CONTROL_KINDS.includes(c.kind as ControlKind) ? (c.kind as ControlKind) : "knob";
    controls[id] = { controlId: id, name: typeof c.name === "string" ? c.name : id, kind };
  }

  const roles: Partial<Record<PerformanceRole, string>> = {};
  const rawRoles = (o.roles && typeof o.roles === "object" ? o.roles : {}) as Record<string, unknown>;
  for (const role of ["wheel", "add", "remove"] as PerformanceRole[]) {
    if (typeof rawRoles[role] === "string") roles[role] = rawRoles[role] as string;
  }

  const now = Date.now();
  return {
    id: uid(),
    name: typeof o.name === "string" && o.name.trim() ? o.name : "Imported preset",
    deviceName: typeof o.deviceName === "string" ? o.deviceName : undefined,
    controls,
    roles,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : now,
    updatedAt: now,
  };
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
