/**
 * Skeuomorphic controller widgets — knobs, faders, a jog wheel, pads and a crossfader rendered
 * with pure CSS (gradients + inset shadows, no bitmaps) so the live editor's MIDI keymap can be
 * *seen* and *played* as a physical-looking DJ surface.
 *
 * Each widget binds to a single {@link ControlAssignment}. In **play** mode dragging/clicking it
 * drives the visuals through the same engine paths a real control would (`driveAssignment` /
 * `fireAssignment`); when the assigned hardware control moves it lights up and mirrors its value.
 * In **map** mode the widget instead arms that assignment to learn the next moved control — so
 * mapping is "click the thing on screen, then wiggle the thing on the box".
 */
import * as React from "react";
import { createContext, useContext, useRef, useState } from "react";
import { cn } from "@/ui/lib/cn";
import type { ControlAssignment } from "@/midi/preset";
import { clamp01 } from "../macros";
import { useLive } from "../LiveProvider";

// ── mode (play vs. map) shared down the surface ──────────────────────────────────────────────
export type ControllerMode = "play" | "map";
const ModeCtx = createContext<ControllerMode>("play");
export const ModeProvider = ModeCtx.Provider;
export const useMode = (): ControllerMode => useContext(ModeCtx);

/** Window-level pointer drag: calls `onMove` until pointer-up, then `onEnd`. */
function dragWith(onMove: (e: PointerEvent) => void, onEnd?: () => void): void {
  const move = (e: PointerEvent) => onMove(e);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    onEnd?.();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

interface SlotState {
  bound: boolean;
  name?: string;
  liveValue?: number;
  pressed: boolean;
  active: boolean;
  learning: boolean;
  arm: () => void;
  unbind: () => void;
  drive: (input: { value: number; delta?: number; relative?: boolean }) => void;
  fire: () => void;
}

/** Everything a widget needs about its assignment: the bound control, its live activity, actions. */
function useSlot(a: ControlAssignment): SlotState {
  const live = useLive();
  const ctl = live.controls.find((c) => c.assignment === a && !c.disabled);
  const snap = ctl?.live;
  return {
    bound: !!ctl,
    name: ctl?.name,
    liveValue: snap?.value,
    pressed: !!snap?.pressed,
    active: !!snap && performance.now() - snap.lastSeen < 300,
    learning: live.learn === a,
    arm: () => live.setLearn(live.learn === a ? null : a),
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
 * Wraps a widget with its label and, in map mode, an overlay button that arms learning and shows
 * the bound control's name (right-click to clear). The overlay swallows pointer events so the
 * underlying knob/fader doesn't also drag while mapping.
 */
function SlotFrame({ slot, label, children }: { slot: SlotState; label: string; children: React.ReactNode }) {
  const mode = useMode();
  return (
    <div className="relative flex flex-col items-center gap-1">
      {children}
      <Label lit={slot.active}>{label}</Label>
      {mode === "map" && (
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
const activeRing = (active: boolean) =>
  active ? { boxShadow: "0 0 0 2px var(--color-accent), 0 0 10px -1px var(--color-accent)" } : undefined;

// ── knob ───────────────────────────────────────────────────────────────────────────────────

export function Knob({ assignment, label, size = 64 }: { assignment: ControlAssignment; label: string; size?: number }) {
  const slot = useSlot(assignment);
  const [local, setLocal] = useState(0.5);
  const v = slot.active && slot.liveValue !== undefined ? slot.liveValue : local;
  const angle = -135 + v * 270;

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startV = v;
    dragWith((ev) => {
      const nv = clamp01(startV - (ev.clientY - startY) / 180);
      setLocal(nv);
      slot.drive({ value: nv });
    });
  };

  return (
    <SlotFrame slot={slot} label={label}>
      <div
        onPointerDown={onDown}
        className="relative touch-none cursor-ns-resize rounded-full"
        style={{ width: size, height: size, ...activeRing(slot.active) }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: "radial-gradient(circle at 50% 32%, #45484d 0%, #25272a 55%, #131416 100%)",
            border: "1px solid #050505",
            boxShadow: "inset 0 1px 1px rgba(255,255,255,.18), inset 0 -3px 5px rgba(0,0,0,.55), 0 1px 2px rgba(0,0,0,.6)",
          }}
        />
        <div className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
          <div className="absolute left-1/2 top-[10%] h-[32%] w-[2px] -translate-x-1/2 rounded-full bg-ink" />
        </div>
      </div>
    </SlotFrame>
  );
}

// ── vertical fader ───────────────────────────────────────────────────────────────────────────

export function Fader({
  assignment,
  label,
  height = 160,
}: {
  assignment: ControlAssignment;
  label: string;
  height?: number;
}) {
  const slot = useSlot(assignment);
  const [local, setLocal] = useState(0);
  const v = slot.active && slot.liveValue !== undefined ? slot.liveValue : local;
  const trackRef = useRef<HTMLDivElement>(null);
  const CAP = 16;
  const travel = height - 8 - CAP;
  const top = 4 + (1 - v) * travel;

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const apply = (clientY: number) => {
      const r = trackRef.current?.getBoundingClientRect();
      if (!r) return;
      const nv = clamp01(1 - (clientY - r.top - CAP / 2) / travel);
      setLocal(nv);
      slot.drive({ value: nv });
    };
    apply(e.clientY);
    dragWith((ev) => apply(ev.clientY));
  };

  return (
    <SlotFrame slot={slot} label={label}>
      <div
        ref={trackRef}
        onPointerDown={onDown}
        className="relative touch-none cursor-ns-resize rounded"
        style={{ width: 24, height }}
      >
        {/* recessed slot */}
        <div
          className="absolute bottom-1 left-1/2 top-1 w-[5px] -translate-x-1/2 rounded-full"
          style={{ background: "#08080a", boxShadow: "inset 0 0 4px rgba(0,0,0,.9)" }}
        />
        {/* cap */}
        <div
          className="absolute left-1/2 -translate-x-1/2 rounded-sm"
          style={{
            top,
            width: 20,
            height: CAP,
            background: "linear-gradient(#54575c, #2a2c2f 55%, #171819)",
            border: "1px solid #050505",
            boxShadow: "inset 0 1px 1px rgba(255,255,255,.22), 0 2px 3px rgba(0,0,0,.6)",
            ...activeRing(slot.active),
          }}
        >
          <div className="absolute left-1 right-1 top-1/2 h-[1px] -translate-y-1/2 bg-black/60" />
        </div>
      </div>
    </SlotFrame>
  );
}

// ── horizontal crossfader (reads/writes the live crossfade directly) ─────────────────────────

export function Crossfader({ width = 240 }: { width?: number }) {
  const live = useLive();
  const slot = useSlot("crossfade");
  const v = live.crossfade;
  const trackRef = useRef<HTMLDivElement>(null);
  const CAP = 18;
  const travel = width - 8 - CAP;
  const left = 4 + v * travel;

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const apply = (clientX: number) => {
      const r = trackRef.current?.getBoundingClientRect();
      if (!r) return;
      slot.drive({ value: clamp01((clientX - r.left - CAP / 2) / travel) });
    };
    apply(e.clientX);
    dragWith((ev) => apply(ev.clientX));
  };

  return (
    <SlotFrame slot={slot} label="A · X · B">
      <div ref={trackRef} onPointerDown={onDown} className="relative h-7 touch-none cursor-ew-resize" style={{ width }}>
        <div
          className="absolute left-1 right-1 top-1/2 h-[5px] -translate-y-1/2 rounded-full"
          style={{ background: "#08080a", boxShadow: "inset 0 0 4px rgba(0,0,0,.9)" }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-sm"
          style={{
            left,
            width: CAP,
            height: 22,
            background: "linear-gradient(#54575c, #2a2c2f 55%, #171819)",
            border: "1px solid #050505",
            boxShadow: "inset 0 1px 1px rgba(255,255,255,.22), 0 2px 3px rgba(0,0,0,.6)",
            ...activeRing(slot.active),
          }}
        >
          <div className="absolute inset-y-1 left-1/2 w-[1px] -translate-x-1/2 bg-black/60" />
        </div>
      </div>
    </SlotFrame>
  );
}

// ── jog wheel (angular drag → relative delta for an Evolve slot) ──────────────────────────────

export function JogWheel({ assignment, label, size = 180 }: { assignment: ControlAssignment; label: string; size?: number }) {
  const slot = useSlot(assignment);
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(0);
  const [spin, setSpin] = useState(0);

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    last.current = Math.atan2(e.clientY - cy, e.clientX - cx);
    dragWith((ev) => {
      const ang = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      let d = ang - last.current;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      last.current = ang;
      setSpin((s) => s + (d * 180) / Math.PI);
      slot.drive({ value: 0, relative: true, delta: d * 6 });
    });
  };

  return (
    <SlotFrame slot={slot} label={label}>
      <div
        ref={ref}
        onPointerDown={onDown}
        className="relative touch-none cursor-grab active:cursor-grabbing rounded-full"
        style={{ width: size, height: size, ...activeRing(slot.active) }}
      >
        {/* outer rubber rim */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: "radial-gradient(circle at 50% 35%, #2a2c2f, #0c0d0e 78%)",
            border: "1px solid #050505",
            boxShadow: "inset 0 2px 3px rgba(255,255,255,.08), 0 2px 5px rgba(0,0,0,.6)",
          }}
        />
        {/* brushed-metal platter */}
        <div
          className="absolute rounded-full"
          style={{
            inset: size * 0.12,
            background: "radial-gradient(circle at 50% 38%, #d6d6d8 0%, #9a9a9d 32%, #5c5c5f 60%, #2c2c2e 82%, #141416 100%)",
            boxShadow: "inset 0 2px 4px rgba(255,255,255,.35), inset 0 -4px 8px rgba(0,0,0,.5), 0 1px 2px rgba(0,0,0,.6)",
            transform: `rotate(${spin}deg)`,
          }}
        >
          <div className="absolute left-1/2 top-[8%] h-[20%] w-[3px] -translate-x-1/2 rounded-full bg-black/60" />
        </div>
        {/* spindle */}
        <div
          className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: "radial-gradient(circle at 40% 35%, #6a6a6d, #161618)" }}
        />
      </div>
    </SlotFrame>
  );
}

// ── pad / button ─────────────────────────────────────────────────────────────────────────────

export function Pad({
  assignment,
  label,
  className,
}: {
  assignment: ControlAssignment;
  label: string;
  className?: string;
}) {
  const slot = useSlot(assignment);
  const [flash, setFlash] = useState(false);
  const lit = slot.pressed || flash;

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    slot.fire();
    setFlash(true);
    window.setTimeout(() => setFlash(false), 140);
  };

  return (
    <SlotFrame slot={slot} label={label}>
      <div
        onPointerDown={onDown}
        className={cn("flex h-12 w-20 touch-none cursor-pointer items-center justify-center rounded", className)}
        style={{
          background: lit
            ? "linear-gradient(#1c2a00, #0e1500)"
            : "linear-gradient(#303236, #1a1b1d 60%, #131416)",
          border: lit ? "1px solid var(--color-accent)" : "1px solid #050505",
          boxShadow: lit
            ? "inset 0 0 8px rgba(192,252,4,.5), 0 0 8px -1px var(--color-accent)"
            : "inset 0 1px 1px rgba(255,255,255,.16), 0 2px 3px rgba(0,0,0,.55)",
        }}
      >
        <div className={cn("h-2 w-2 rounded-full", lit ? "bg-accent" : "bg-ink-dim/40")} />
      </div>
    </SlotFrame>
  );
}

// ── browse selector ──────────────────────────────────────────────────────────────────────────

export function BrowsePanel() {
  const live = useLive();
  const slot = useSlot("browse");
  const { types, selectedType, setSelectedType } = live;
  const idx = Math.max(0, types.indexOf(selectedType));
  const step = (d: number) => types.length && setSelectedType(types[(idx + d + types.length) % types.length]);

  return (
    <SlotFrame slot={slot} label="Browse">
      <div
        className="flex h-9 items-center gap-1 rounded px-1"
        style={{
          background: "linear-gradient(#202225, #131416)",
          border: "1px solid #050505",
          boxShadow: "inset 0 1px 1px rgba(255,255,255,.12)",
          ...activeRing(slot.active),
        }}
      >
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            step(-1);
          }}
          className="h-6 w-5 rounded text-ink-dim hover:text-ink"
        >
          ‹
        </button>
        <span className="w-24 truncate text-center text-[10px] font-medium text-ink">{selectedType || "—"}</span>
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            step(1);
          }}
          className="h-6 w-5 rounded text-ink-dim hover:text-ink"
        >
          ›
        </button>
      </div>
    </SlotFrame>
  );
}
