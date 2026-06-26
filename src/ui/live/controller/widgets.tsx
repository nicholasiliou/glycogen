/**
 * Skeuomorphic controller widgets — knobs, faders, a jog wheel, pads and a crossfader rendered
 * with pure CSS (gradients + inset shadows, no bitmaps) so the live editor's MIDI keymap can be
 * *seen* and *played* as a physical-looking DJ surface.
 *
 * Hover any widget to reveal its MIDI binding overlay — click to arm learning, right-click to clear.
 * The overlay stays visible while learning is active so you can wiggle the hardware control.
 */
import * as React from "react";
import { useContext, useEffect, useRef, useState } from "react";
import { cn } from "@/ui/lib/cn";
import type { ControlAssignment } from "@/midi/preset";
import { clamp01 } from "../macros";
import { useLive } from "../LiveProvider";

export type ControllerMode = "play" | "map";
/**
 * Whether the surface is being *played* or *mapped*. In "play" the controls are directly
 * interactive (no binding overlay covering them); in "map" the hover overlay returns so a
 * physical control can be learned onto a widget. Defaults to play so the surface is usable.
 */
export const ControllerModeContext = React.createContext<ControllerMode>("play");

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
 * Wraps a widget with its label. Hover to reveal the MIDI binding overlay — click to arm
 * learning, right-click to clear. Overlay stays visible while a learn is in progress.
 */
function SlotFrame({ slot, label, children }: { slot: SlotState; label: string; children: React.ReactNode }) {
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
const activeRing = (active: boolean) =>
  active ? { boxShadow: "0 0 0 2px var(--color-accent), 0 0 10px -1px var(--color-accent)" } : undefined;

// ── knob ───────────────────────────────────────────────────────────────────────────────────

export function Knob({ assignment, label, size = 32 }: { assignment: ControlAssignment; label: string; size?: number }) {
  const slot = useSlot(assignment);
  const [local, setLocal] = useState(0.5);
  // Keep local in sync with incoming MIDI value so position persists when hardware goes quiet
  useEffect(() => {
    if (slot.liveValue !== undefined) setLocal(slot.liveValue);
  }, [slot.liveValue]);
  const v = local;
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

// ── smooth knob (no indicator) ──────────────────────────────────────────────────────────────

export function SmoothKnob({
  assignment,
  label,
  size = 32,
}: {
  assignment: ControlAssignment;
  label: string;
  size?: number;
}) {
  const slot = useSlot(assignment);
  const [local, setLocal] = useState(0.5);
  useEffect(() => {
    if (slot.liveValue !== undefined) setLocal(slot.liveValue);
  }, [slot.liveValue]);
  const v = local;
  const angle = v * 360;

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
    className="relative touch-none cursor-ns-resize"
    style={{ width: size, height: size, ...activeRing(slot.active) }}
  >
      {/* Rotating knurling */}
      <div className="absolute" style={{ inset: size * 0.08, transform: `rotate(${angle}deg)` }}>
        {Array.from({ length: 32 }).map((_, i) => (
          <div
            key={i}
            className="absolute left-1/2 top-1/2"
            style={{
              width: 2,
              height: 6,
              background: i % 2 ? "#555" : "",
              transform: `
                translate(-50%, -50%)
                rotate(${i * 11.25}deg)
                translateY(${-size / 2 + 4}px)
              `,
            }}
          />
        ))}
      </div>

    {/* Inner knob */}
    <div
      className="absolute rounded-full"
      style={{
        inset: size * 0.14,
        background:
          "radial-gradient(circle at 50% 28%, #5a5d62 0%, #323438 55%, #18191b 100%)",
        border: "1px solid #111",
        boxShadow:
          "inset 0 2px 3px rgba(255,255,255,.18), inset 0 -4px 8px rgba(0,0,0,.6)",
      }}
    />
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
  useEffect(() => {
    if (slot.liveValue !== undefined) setLocal(slot.liveValue);
  }, [slot.liveValue]);
  const v = local;
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
          style={{ background: "#18181c", boxShadow: "inset 0 0 4px rgba(0,0,0,.9)" }}
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
          style={{ background: "#18181c", boxShadow: "inset 0 0 4px rgba(0,0,0,.9)" }}
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

export function JogWheel({ assignment, label, size = 360 }: { assignment: ControlAssignment; label: string; size?: number }) {
  const slot = useSlot(assignment);
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(0);
  const [spin, setSpin] = useState(0);

  useEffect(() => {
    if (slot.liveValue !== undefined) {
      setSpin((s) => s + slot.liveValue * 360);
    }
  }, [slot.liveValue]);

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
        {/* outer rim – image sequence (5 frames, ~3° per frame) */}
        {(() => {
          const frameIndex = Math.floor((spin % 360 / 5)) % 5;
          return Array.from({ length: 5 }, (_, i) => (
            <img
              key={i}
              src={`/animations/rim/${String(i + 1).padStart(4, "0")}.webp`}
              alt=""
              className="absolute inset-0 rounded-full"
              style={{ width: size, height: size, display: i === frameIndex ? "block" : "none" }}
              draggable={false}
            />
          ));
        })()}
        {/* spindle */}
        <img
          src="/Spindle.svg"
          alt="spindle"
          className="absolute left-1/2 top-1/2 h-30 w-30 -translate-x-1/2 -translate-y-1/2"
          style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))" }}
          draggable={false}
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
        className={cn("flex h-8 w-16 touch-none cursor-pointer items-center justify-center rounded", className)}
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

// ── circle button ───────────────────────────────────────────────────────────────────────────

export function Circle({
  assignment,
  label,
  size = 20,
}: {
  assignment: ControlAssignment;
  label: string;
  size?: number;
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
        className="flex touch-none cursor-pointer items-center justify-center rounded-full"
        style={{
          width: size,
          height: size,
          background: lit
            ? "radial-gradient(circle at 40% 35%, #1c2a00, #0e1500)"
            : "radial-gradient(circle at 40% 35%, #303236, #1a1b1d 60%, #131416)",
          border: lit ? "1px solid var(--color-accent)" : "1px solid #050505",
          boxShadow: lit
            ? "inset 0 0 8px rgba(192,252,4,.5), 0 0 8px -1px var(--color-accent)"
            : "inset 0 1px 1px rgba(255,255,255,.16), 0 2px 3px rgba(0,0,0,.55)",
          ...activeRing(slot.active),
        }}
      >
        <div className={cn("h-2 w-2 rounded-full", lit ? "bg-accent" : "bg-ink-dim/40")} />
      </div>
    </SlotFrame>
  );
}

// ── browse selector (rotary encoder with detents) ────────────────────────────────────────────

export function BrowsePanel() {
  const live = useLive();
  const slot = useSlot("browse");
  const shaderMode = live.browseMode === "shader";
  const label = shaderMode ? live.shaderType : live.selectedType;
  const list = shaderMode ? live.shaders : live.types;
  const currentIndex = list.indexOf(label);

  // Normalized rotation: each detent is ~26.67 degrees (360 / 13.5 avg slots)
  // Map selection index to continuous rotation for smooth visual feedback
  const rotationAngle = (currentIndex / Math.max(1, list.length - 1)) * 360;

  const ref = useRef<HTMLDivElement>(null);
  const [spin, setSpin] = useState(rotationAngle);
  const lastAngle = useRef(0);

  const step = (d: number) => {
    live.driveAssignment("browse", { value: 0, relative: true, delta: d });
  };

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    lastAngle.current = Math.atan2(e.clientY - cy, e.clientX - cx);
    let accumulated = 0;

    dragWith((ev) => {
      const ang = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      let d = ang - lastAngle.current;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      lastAngle.current = ang;

      const degrees = (d * 180) / Math.PI;
      setSpin((s) => s + degrees);
      accumulated += degrees;

      // Detent every ~30 degrees (12 positions)
      const detent = Math.round(accumulated / 30);
      if (detent !== 0) {
        step(detent);
        accumulated = 0;
      }
    });
  };

  // Sync rotation when selection changes externally
  useEffect(() => {
    setSpin(rotationAngle);
  }, [rotationAngle]);

  return (
    <SlotFrame slot={slot} label={shaderMode ? "Browse · Shader" : "Browse · Plugin"}>
      <div
        ref={ref}
        onPointerDown={onDown}
        className="relative touch-none cursor-grab active:cursor-grabbing rounded-full"
        style={{ width: 80, height: 80, ...activeRing(slot.active) }}
      >
        {/* outer knurled ring */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: "radial-gradient(circle at 50% 32%, #45484d 0%, #25272a 55%, #131416 100%)",
            border: "1px solid #050505",
            boxShadow: "inset 0 1px 1px rgba(255,255,255,.18), inset 0 -3px 5px rgba(0,0,0,.55), 0 1px 2px rgba(0,0,0,.6)",
          }}
        />

        {/* rotating indicator with detents */}
        <div className="absolute inset-0" style={{ transform: `rotate(${spin}deg)` }}>
          {/* primary indicator (top) */}
          <div className="absolute left-1/2 top-[10%] h-[8%] w-0.5 -translate-x-1/2 rounded-full bg-accent shadow-lg shadow-accent/50" />
        </div>

        {/* center spindle */}
        <div
          className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: "radial-gradient(circle at 40% 35%, #6a6a6d, #161618)", zIndex: 10 }}
        />
      </div>
    </SlotFrame>
  );
}
