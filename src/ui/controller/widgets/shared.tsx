/**
 * Shared internals for the skeuomorphic controller widgets. Every on-screen widget is an abstract
 * control slot on the {@link ControlBus}. Right-click any widget to arm it for MIDI learn — the
 * next hardware touch binds to that slot and clears the learn state.
 */
import * as React from "react";
import { createContext, useContext } from "react";
import type { ControlBus } from "@/controls/ControlBus";
import type { DriveInput, SlotId } from "@/controls/types";

export const ControlBusContext = createContext<ControlBus | null>(null);

/**
 * Bank state + actions for the top-row Del/Bank buttons. Supplied by the host (LiveProvider)
 * and by the pop-out window (over the channel), so the controller surface renders the same in both
 * without depending on the full live context. `loaded[i]` = bank i has a plugin; `active` = current.
 */
export interface BankControl {
  state: () => { loaded: boolean[]; active: number };
  select: (bank: number) => void;
  clear: () => void;
}
export const BankControlContext = createContext<BankControl | null>(null);

/** Slot → label (the focused plugin's bound variable name). Updates as focus changes. */
export const SlotLabelContext = createContext<Partial<Record<SlotId, string>>>({});

/** The slot currently armed for MIDI learn, or null. */
export const LearnSlotContext = createContext<SlotId | null>(null);
/** Callback to arm/cancel a slot for learn. */
export const ArmLearnContext = createContext<(slot: SlotId) => void>(() => {});

/**
 * A param remap in progress — armed by clicking/dragging a binding chip in the bindings panel.
 * While pending, every legal widget highlights and completes the assignment on click or drop;
 * illegal widgets dim (clicking one cancels). `legal` maps each allowed widget to its legal
 * adapters (first entry = the default the assignment lands with).
 */
export interface AssignPending {
  pluginId: string;
  paramId: string;
  /** The param name, shown under highlighted widgets. */
  label: string;
  legal: Partial<Record<SlotId, string[]>>;
}
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
  /** The focused plugin's variable name bound to this slot, if any (for the on-screen label). */
  label?: string;
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

/** Bind a widget to a slot: read its live state + focused label, get actions to drive it. */
export function useSlot(slot: SlotId): SlotView {
  const bus = useBus();
  const labels = useContext(SlotLabelContext);
  const { armed, arm } = useLearn(slot);
  const live = bus.get(slot);
  return {
    label: labels[slot],
    liveValue: live.value,
    liveDelta: live.delta,
    liveSeq: live.hits,
    pressed: live.pressed,
    active: live.lastSeen > 0 && performance.now() - live.lastSeen < 300,
    armed,
    arm,
    drive: (input) => bus.drive(slot, input),
    fire: () => bus.fire(slot),
  };
}

// ── chrome ───────────────────────────────────────────────────────────────────────────────────

function Label({ children, lit }: { children: React.ReactNode; lit?: boolean }) {
  return (
    <span
      className={
        "select-none text-[8px] font-semibold uppercase leading-none tracking-[0.12em] " +
        (lit ? "text-accent" : "text-ink-dim")
      }
    >
      {children}
    </span>
  );
}

/**
 * Wraps a widget with its label (always rendered, matching the original spacing). Passing `slot`
 * additionally makes the frame an assignment target: while a param remap is pending, legal frames
 * highlight and complete it on click or drop, illegal ones dim (clicking cancels).
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
  const pending = slot ? assign.pending : null;
  const legal = !!(pending && slot && pending.legal[slot]);

  const capture = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (legal) assign.assignTo(slot!);
    else assign.cancel();
  };

  return (
    <div
      className={"relative flex flex-col items-center gap-1" + (pending && !legal ? " opacity-30" : "")}
      style={armed || legal ? { filter: "drop-shadow(0 0 6px var(--color-accent))" } : undefined}
      onPointerDownCapture={pending ? capture : undefined}
      onDragOver={legal ? (e) => e.preventDefault() : undefined}
      onDrop={legal ? capture : undefined}
    >
      {(armed || legal) && (
        <span
          className="pointer-events-none absolute -inset-1 z-10 animate-pulse rounded-sm border border-accent/70"
          aria-hidden
        />
      )}
      {children}
      <Label lit={active || armed || legal}>{legal ? pending!.label : (label ?? (armed ? "LEARN" : " "))}</Label>
    </div>
  );
}

/** Accent ring shown while the slot is moving. */
export const activeRing = (active: boolean) =>
  active ? { boxShadow: "0 0 0 2px var(--color-accent), 0 0 10px -1px var(--color-accent)" } : undefined;
