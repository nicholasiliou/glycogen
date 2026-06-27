/**
 * Cross-window bridge for the "digital controller" popup. The main window owns the engine +
 * audio (the single source of truth); a popup opened at `#controller` renders the same DJ
 * surface but has no engine of its own, so it relays every tap/drag here and mirrors back the
 * bits of state it needs to display. Same-origin BroadcastChannel carries it both ways.
 */
import type { ControlAssignment } from "@/midi/preset";

export const LIVE_CHANNEL = "marathon-live";
/** URL hash that boots the app as a remote controller instead of the full editor. */
export const REMOTE_HASH = "#controller";

export interface DriveInput {
  value: number;
  delta?: number;
  relative?: boolean;
}

/** What the remote needs to render the surface meaningfully (labels, positions, modes). */
export interface LiveSnapshot {
  types: string[];
  selectedType: string;
  deckAName: string | null;
  deckBName: string | null;
  /** Plugin name in each of the side's three storage banks (null = empty). */
  deckABankNames: (string | null)[];
  deckBBankNames: (string | null)[];
  /** Which bank index is active (MIDI-controlled) on each side. */
  activeBankA: number;
  activeBankB: number;
  crossfade: number;
  browseMode: "plugin" | "shader";
  shaders: string[];
  shaderType: string;
}

export type LiveMessage =
  | { kind: "drive"; a: ControlAssignment; input: DriveInput }
  | { kind: "fire"; a: ControlAssignment }
  | { kind: "selectType"; type: string }
  | { kind: "hello" } // remote → host: "send me the current state"
  | { kind: "state"; snapshot: LiveSnapshot };

/** Per-side deck state in the form the snapshot needs (ref.current or live state both fit). */
export interface SnapshotDeckSide {
  banks: (string | null)[];
  active: number;
  /** Active (MIDI-controlled) layer id for the side, or null. */
  activeId: string | null;
}

/** Everything a snapshot is built from. Both the ref-read and state-read call sites in
 * useLiveChannel supply these, so the snapshot's shape is defined in exactly one place. */
export interface SnapshotSource {
  types: string[];
  selectedType: string;
  A: SnapshotDeckSide;
  B: SnapshotDeckSide;
  crossfade: number;
  browseMode: "plugin" | "shader";
  shaders: string[];
  shaderType: string;
}

/** Single definition of how a {@link LiveSnapshot} is assembled (names resolved via `nameOf`). */
export function buildSnapshot(s: SnapshotSource, nameOf: (id: string | null) => string | null): LiveSnapshot {
  return {
    types: s.types,
    selectedType: s.selectedType,
    deckAName: nameOf(s.A.activeId),
    deckBName: nameOf(s.B.activeId),
    deckABankNames: s.A.banks.map(nameOf),
    deckBBankNames: s.B.banks.map(nameOf),
    activeBankA: s.A.active,
    activeBankB: s.B.active,
    crossfade: s.crossfade,
    browseMode: s.browseMode,
    shaders: s.shaders,
    shaderType: s.shaderType,
  };
}

export function openLiveChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(LIVE_CHANNEL);
}

export function isRemoteWindow(): boolean {
  return typeof window !== "undefined" && window.location.hash.startsWith(REMOTE_HASH);
}
