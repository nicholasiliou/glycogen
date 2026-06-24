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
  deckAStashName: string | null;
  deckBStashName: string | null;
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

export function openLiveChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(LIVE_CHANNEL);
}

export function isRemoteWindow(): boolean {
  return typeof window !== "undefined" && window.location.hash.startsWith(REMOTE_HASH);
}
