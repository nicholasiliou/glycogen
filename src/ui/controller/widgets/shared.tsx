/**
 * Shared internals for the skeuomorphic controller widgets. Every on-screen widget is an abstract
 * control slot on the {@link ControlBus}. Right-click any widget to arm it for MIDI learn — the
 * next hardware touch binds to that slot and clears the learn state.
 */
import * as React from "react";
import { createContext, useContext } from "react";
import type { ControlBus } from "@/controls/ControlBus";
import type { DriveInput, SlotId } from "@/controls/types";
import type { AppAction } from "@/db/schema";

export const ControlBusContext = createContext<ControlBus | null>(null);

/**
 * What the surface is for right now: `"live"` (pop-out + host bus — widgets drive the app) or
 * `"assign"` (the controller overlay — an inert map you drag functions onto; widgets never drive
 * the bus).
 */
export type SurfaceMode = "live" | "assign";
export const SurfaceModeContext = createContext<SurfaceMode>("live");

/** Slot → label (the focused plugin's bound variable name). Updates as focus changes. */
export const SlotLabelContext = createContext<Partial<Record<SlotId, string>>>({});

/** Slot → the app function sitting on it (`lit` = that bank is active). Overrides the param label. */
export interface SlotAction {
  actionId: AppAction;
  label: string;
  lit: boolean;
}
export const SlotActionContext = createContext<Partial<Record<SlotId, SlotAction>>>({});

/** The slot currently armed for MIDI learn, or null. */
export const LearnSlotContext = createContext<SlotId | null>(null);
/** Callback to arm/cancel a slot for learn. */
export const ArmLearnContext = createContext<(slot: SlotId) => void>(() => {});

/**
 * An assignment in progress — armed by clicking/dragging a row in the assign sidebar, or by
 * dragging a widget's occupant on the assign surface. While pending, every legal widget highlights
 * and completes the assignment on click or drop; illegal widgets dim (clicking one cancels).
 * `legal` maps each allowed widget to its legal adapters (first entry = the default the assignment
 * lands with; actions carry a placeholder entry — legality is press-widgets-only).
 */
export type AssignPending =
  | { type: "param"; pluginId: string; paramId: string; label: string; legal: Partial<Record<SlotId, string[]>> }
  | { type: "action"; actionId: AppAction; label: string; legal: Partial<Record<SlotId, string[]>> };

/**
 * Slot → the occupant sitting on it, as a ready-to-arm pending (assign mode only). Dragging an
 * occupied frame re-arms its occupant so it can move to another widget or return to the sidebar.
 */
export const SlotOccupantContext = createContext<Partial<Record<SlotId, AssignPending>>>({});

/** dataTransfer type for a dragged occupant/function; payload = JSON-serialised AssignPending. */
export const ASSIGN_MIME = "application/x-glycogen-assign";
export interface AssignCtxType {
  pending: AssignPending | null;
  begin: (p: AssignPending) => void;
  cancel: () => void;
  /** Complete the pending assignment onto a widget (SlotFrame calls this). */
  assignTo: (slot: SlotId) => void;
}
export const AssignContext = createContext<AssignCtxType>({
  pending: null,
  begin: () => {},
  cancel: () => {},
  assignTo: () => {},
});

export function useBus(): ControlBus {
  const bus = useContext(ControlBusContext);
  if (!bus) throw new Error("ControlBusContext is missing — wrap the controller in a provider");
  return bus;
}

export function useLearn(slot: SlotId): { armed: boolean; arm: () => void } {
  const learnSlot = useContext(LearnSlotContext);
  const armLearn = useContext(ArmLearnContext);
  return { armed: learnSlot === slot, arm: () => armLearn(slot) };
}

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

/** Everything a widget reads about its slot, plus the actions to drive it. */
export interface SlotView {
  /** The occupant's label: the app function on this slot, else the focused plugin's bound param. */
  label?: string;
  /** The app action on this slot wants the widget lit steady (its bank is active). */
  lit: boolean;
  /** Last absolute position 0..1 (faders/knobs). */
  liveValue: number;
  /** Last signed step (encoders/jog). */
  liveDelta: number;
  /** Bumps on every message — lets relative widgets react to each tick. */
  liveSeq: number;
  pressed: boolean;
  /** Moved within the last 300ms — drives the accent glow. */
  active: boolean;
  /** This slot is currently armed for MIDI learn. */
  armed: boolean;
  /** Arm this slot for MIDI learn (right-click handler). */
  arm: () => void;
  drive: (input: DriveInput) => void;
  fire: () => void;
}

/**
 * Bind a widget to a slot: read its live state + occupant label, get actions to drive it. In
 * assign mode the surface is an inert map — drive/fire are no-ops, only the frames respond.
 */
export function useSlot(slot: SlotId): SlotView {
  const bus = useBus();
  const mode = useContext(SurfaceModeContext);
  const labels = useContext(SlotLabelContext);
  const action = useContext(SlotActionContext)[slot];
  const { armed, arm } = useLearn(slot);
  const live = bus.get(slot);
  const inert = mode === "assign";
  return {
    label: action?.label ?? labels[slot],
    lit: !!action?.lit,
    liveValue: live.value,
    liveDelta: live.delta,
    liveSeq: live.hits,
    pressed: live.pressed,
    active: live.lastSeen > 0 && performance.now() - live.lastSeen < 300,
    armed,
    arm,
    drive: inert ? () => {} : (input) => bus.drive(slot, input),
    fire: inert ? () => {} : () => bus.fire(slot),
  };
}

// ── chrome ───────────────────────────────────────────────────────────────────────────────────

function Label({ children, lit }: { children: React.ReactNode; lit?: boolean }) {
  // Absolutely positioned inside a fixed-height spacer: label text never contributes to the
  // frame's intrinsic size, so changing labels can't re-trigger the FitBox scale (the surface
  // would visibly resize). Long labels truncate instead of pushing the grid apart.
  return (
    <span
      className={
        "absolute left-1/2 top-0 max-w-16 -translate-x-1/2 select-none truncate text-center text-[8px] font-semibold uppercase leading-none tracking-[0.12em] " +
        (lit ? "text-accent" : "text-ink-dim")
      }
    >
      {children}
    </span>
  );
}

/**
 * Wraps a widget with its label (always rendered, matching the original spacing). Passing `slot`
 * additionally makes the frame an assignment target: while an assignment is pending, legal frames
 * highlight and complete it on click or drop, illegal ones dim (clicking cancels). In assign mode
 * the frame also blocks pointer input from reaching the widget (the surface is an inert map) and,
 * when the slot has an occupant, becomes draggable — dragging re-arms the occupant so it can move
 * to another widget or be dropped on the sidebar to unbind.
 */
export function SlotFrame({
  label,
  active,
  armed,
  slot,
  children,
}: {
  label?: string;
  active?: boolean;
  armed?: boolean;
  slot?: SlotId;
  children: React.ReactNode;
}) {
  const assign = useContext(AssignContext);
  const mode = useContext(SurfaceModeContext);
  const occupants = useContext(SlotOccupantContext);
  const occupant = slot ? occupants[slot] : undefined;
  const pending = slot ? assign.pending : null;
  const legal = !!(pending && slot && pending.legal[slot]);

  const capture = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (legal) assign.assignTo(slot!);
    else assign.cancel();
  };
  // Assign mode, nothing pending: swallow the pointer before the widget sees it (inert surface) —
  // no preventDefault, so a native drag of the occupant can still start.
  const inertCapture = (e: React.SyntheticEvent) => e.stopPropagation();

  const draggable = mode === "assign" && !!occupant;

  return (
    <div
      className={"relative flex flex-col items-center gap-1 select-none" + (pending && !legal ? " opacity-30" : "")}
      style={armed || legal ? { outline: "1px solid var(--color-accent)", borderRadius: "4px" } : undefined}
      onPointerDownCapture={pending ? capture : mode === "assign" ? inertCapture : undefined}
      onDragOver={legal ? (e) => e.preventDefault() : undefined}
      onDrop={legal ? capture : undefined}
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.setData(ASSIGN_MIME, JSON.stringify(occupant));
              e.dataTransfer.effectAllowed = "move";
              assign.begin(occupant!);
            }
          : undefined
      }
      onDragEnd={draggable ? () => assign.cancel() : undefined}
    >
      {children}
      <div className="relative h-2 w-full">
        <Label lit={active || armed}>
          {label ?? (armed ? "LEARN" : " ")}
        </Label>
      </div>
    </div>
  );
}

/** Accent ring shown while the slot is moving. */
export const activeRing = (active: boolean) =>
  active ? { boxShadow: "0 0 0 2px var(--color-accent), 0 0 10px -1px var(--color-accent)" } : undefined;
