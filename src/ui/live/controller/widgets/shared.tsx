/**
 * Shared internals for the skeuomorphic controller widgets — the play/map mode context, the
 * per-widget slot binding, and the chrome (label + hover-to-reveal MIDI binding overlay) that
 * wraps every widget.
 */
import * as React from "react";
import { useContext, useState } from "react";
import { cn } from "@/ui/lib/cn";
import type { ControlAssignment } from "@/midi/preset";
import type { ControlKind } from "@/midi/types";
import { useLive } from "@/ui/live/app/LiveProvider";

export type ControllerMode = "play" | "map";
/**
 * Whether the surface is being *played* or *mapped*. In "play" the controls are directly
 * interactive (no binding overlay covering them); in "map" the hover overlay returns so a
 * physical control can be learned onto a widget. Defaults to play so the surface is usable.
 */
export const ControllerModeContext = React.createContext<ControllerMode>("play");

/** Window-level pointer drag: calls `onMove` until pointer-up, then `onEnd`. */
export function dragWith(onMove: (e: PointerEvent) => void, onEnd?: () => void): void {
  const move = (e: PointerEvent) => onMove(e);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    onEnd?.();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

export interface SlotState {
  bound: boolean;
  name?: string;
  liveValue?: number;
  /** Last signed encoder step (only meaningful for relative/encoder controls). */
  liveDelta?: number;
  /** Monotonically-bumped counter: increments on every hardware message so widgets can react. */
  liveSeq?: number;
  pressed: boolean;
  active: boolean;
  learning: boolean;
  arm: () => void;
  unbind: () => void;
  drive: (input: { value: number; delta?: number; relative?: boolean }) => void;
  fire: () => void;
}

/** Everything a widget needs about its assignment: the bound control, its live activity, actions. */
export function useSlot(a: ControlAssignment, preferKind?: ControlKind): SlotState {
  const live = useLive();
  const ctl = live.controls.find((c) => c.assignment === a && !c.disabled);
  const snap = ctl?.live;
  return {
    bound: !!ctl,
    name: ctl?.name,
    liveValue: snap?.value,
    liveDelta: snap?.delta,
    liveSeq: snap ? snap.hits : undefined,
    pressed: !!snap?.pressed,
    active: !!snap && performance.now() - snap.lastSeen < 300,
    learning: live.learn === a,
    arm: () => live.setLearn(live.learn === a ? null : a, preferKind),
    unbind: () => ctl && live.setControlAssignment(ctl.id, "none"),
    drive: (input) => live.driveAssignment(a, input),
    fire: () => live.fireAssignment(a),
  };
}

// ── chrome ───────────────────────────────────────────────────────────────────────────────────

function Label({ children, lit }: { children: React.ReactNode; lit?: boolean }) {
  return (
    <span
      className={cn(
        "select-none text-[8px] font-semibold uppercase leading-none tracking-[0.12em]",
        lit ? "text-accent" : "text-ink-dim",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Wraps a widget with its label. Hover to reveal the MIDI binding overlay — click to arm
 * learning, right-click to clear. Overlay stays visible while a learn is in progress.
 */
export function SlotFrame({ slot, label, children }: { slot: SlotState; label: string; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  const mode = useContext(ControllerModeContext);
  // Only cover the control with the bind overlay while mapping — in play mode it stays interactive.
  const showOverlay = mode === "map" && (hovered || slot.learning);
  return (
    <div
      className="relative flex flex-col items-center gap-1"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      <Label lit={slot.active}>{label}</Label>
      {showOverlay && (
        <button
          type="button"
          onClick={slot.arm}
          onContextMenu={(e) => {
            e.preventDefault();
            slot.unbind();
          }}
          title={
            slot.bound
              ? `Bound to ${slot.name} — click to rebind, right-click to clear`
              : "Click, then move a control on your device to bind it"
          }
          className={cn(
            "absolute inset-0 z-10 flex items-center justify-center rounded-md border px-1 text-center text-[8px] font-semibold uppercase leading-tight tracking-wide transition-colors",
            slot.learning
              ? "animate-pulse border-accent bg-accent/20 text-accent"
              : slot.bound
                ? "border-accent/40 bg-black/55 text-ink hover:border-accent"
                : "border-dashed border-ink-dim/40 bg-black/65 text-ink-dim hover:border-ink-dim hover:text-ink",
          )}
        >
          {slot.learning ? "move a control…" : slot.bound ? slot.name : "bind"}
        </button>
      )}
    </div>
  );
}

/** Accent ring shown while the bound hardware control is moving. */
export const activeRing = (active: boolean) =>
  active ? { boxShadow: "0 0 0 2px var(--color-accent), 0 0 10px -1px var(--color-accent)" } : undefined;
