// ── smooth knob (endless encoder: vertical drag → relative delta, no fixed 0..1 position) ─────
import { useEffect, useRef, useState } from "react";
import * as React from "react";
import type { ControlAssignment } from "@/midi/preset";
import { activeRing, dragWith, SlotFrame, useSlot } from "./shared";

/**
 * Skeuomorphic endless encoder. Unlike a potentiometer (the {@link Knob}/{@link Fader}, which
 * have a fixed absolute position), this can be turned indefinitely in either direction. It only
 * ever emits *relative* deltas, so the engine accumulates them onto the bound param — matching
 * how a hardware encoder (and the {@link JogWheel}) behaves. Its on-screen rotation simply stores
 * how far it has been spun; there is no end-stop and no absolute value to snap to.
 *
 * Intentionally does NOT sync visual rotation to liveValue: an encoder's raw CC value is a signed
 * step (1 or 127), not a 0..1 position, so mapping it to degrees would cause large random jumps.
 */
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
  // Accumulated rotation (degrees) — driven by drag and by hardware encoder ticks.
  const [spin, setSpin] = useState(0);
  const lastSeq = useRef<number | undefined>(undefined);

  // Spin when the bound hardware encoder moves. liveSeq bumps on every message; liveDelta is the
  // signed step — safe to use directly unlike liveValue (which is an absolute CC, not a position).
  useEffect(() => {
    if (slot.liveSeq === undefined || slot.liveSeq === lastSeq.current) return;
    lastSeq.current = slot.liveSeq;
    if (slot.liveDelta !== undefined && slot.liveDelta !== 0) {
      setSpin((s) => s - slot.liveDelta! * 18);
    }
  }, [slot.liveSeq, slot.liveDelta]);

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    let lastY = e.clientY;
    dragWith((ev) => {
      const dy = lastY - ev.clientY; // up = positive
      lastY = ev.clientY;
      if (dy === 0) return;
      // Pixels → encoder ticks. 4px ≈ one detent feels close to a hardware encoder's resolution.
      const delta = dy / 4;
      setSpin((s) => s + delta * 18);
      slot.drive({ value: 0, relative: true, delta });
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
      <div className="absolute" style={{ inset: size * 0.08, transform: `rotate(${spin}deg)` }}>
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
