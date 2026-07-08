/**
 * Cross-window bridge for the pop-out controller. The main window owns the real {@link ControlBus}
 * (the single source of truth); a popup opened at {@link REMOTE_HASH} renders only the controller
 * surface and has no stage of its own. It relays every widget drive/fire to the host over a
 * same-origin BroadcastChannel, and the host mirrors back the bits the surface needs to render
 * (per-slot labels + the browse label). No engine, no shared memory — just messages.
 */
import type { DriveInput, SlotId } from "./types";
import type { SlotAction } from "@/ui/controller/widgets/shared";

export const REMOTE_CHANNEL = "marathon-remote";
/** URL hash that boots the app as a pop-out controller instead of the full editor. */
export const REMOTE_HASH = "#controller";

/** State the remote needs to render labels + action pads meaningfully. */
export interface RemoteSnapshot {
  /** slot id → focused plugin's bound param name. */
  labels: Partial<Record<SlotId, string>>;
  /** slot id → the app function sitting on it (label + lit; e.g. bank pads light when active). */
  actions: Partial<Record<SlotId, SlotAction>>;
  /** The two browse-dial labels (selected plugin / selected shader). */
  browseLabels?: { plugin?: string; shader?: string };
}

export type RemoteMessage =
  | { kind: "drive"; slot: SlotId; input: DriveInput }
  | { kind: "fire"; slot: SlotId }
  | { kind: "step"; target: "plugin" | "shader"; delta: number }
  | { kind: "hello" } // remote → host: "send me the current snapshot"
  | { kind: "snapshot"; snapshot: RemoteSnapshot };

export function openRemoteChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(REMOTE_CHANNEL);
}

export function isRemoteWindow(): boolean {
  return typeof window !== "undefined" && window.location.hash.startsWith(REMOTE_HASH);
}
