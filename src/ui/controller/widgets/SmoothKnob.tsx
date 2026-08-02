// ── smooth knob (endless encoder: vertical drag → relative delta, no fixed 0..1 position) ─────
import { useEffect, useRef, useState } from "react";
import * as React from "react";
import { slotId } from "@/controls/types";
import { activeRing, dragWith, SlotFrame, useSlot } from "./shared";

/**
 * Skeuomorphic endless encoder. Unlike a potentiometer (the {@link Knob}/{@link Fader}, which have
 * a fixed absolute position), this turns indefinitely and only ever emits *relative* deltas, so the
 * bound param accumulates them  -  matching a hardware encoder. Its rotation just stores how far it
 * has been spun; no end-stop, no absolute value to snap to.
 */
export function SmoothKnob({ slot, label, size = 32 }: { slot: number; label?: string; size?: number }) {
  const sid = slotId("encoder", slot);
  const s = useSlot(sid);
  const [spin, setSpin] = useState(0);
  const lastSeq = useRef<number | undefined>(undefined);

  // Spin when an external (MIDI) encoder tick arrives. liveSeq bumps per message; liveDelta is the
  // signed step. (On-screen drags spin locally below, so guard against double-counting our own.)
  useEffect(() => {
    if (s.liveSeq === lastSeq.current) return;
    lastSeq.current = s.liveSeq;
    if (s.liveDelta) setSpin((d) => d - s.liveDelta * 18);
  }, [s.liveSeq, s.liveDelta]);

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    let lastY = e.clientY;
    dragWith((ev) => {
      const dy = lastY - ev.clientY; // up = positive
      lastY = ev.clientY;
      if (dy === 0) return;
      const delta = dy / 4; // 4px ≈ one detent
      setSpin((d) => d + delta * 18);
      lastSeq.current = s.liveSeq + 1; // skip our own tick in the effect above
      s.drive({ relative: true, delta });
    });
  };

  return (
    <SlotFrame slot={sid} label={s.label ?? label} active={s.active} armed={s.armed}>
      <div
        onPointerDown={onDown}
        onContextMenu={(e) => { e.preventDefault(); s.arm(); }}
        className="relative touch-none cursor-ns-resize"
        style={{ width: size, height: size, ...activeRing(s.active) }}
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
                transform: `translate(-50%, -50%) rotate(${i * 11.25}deg) translateY(${-size / 2 + 4}px)`,
              }}
            />
          ))}
        </div>
        {/* Inner knob */}
        <div
          className="absolute rounded-full"
          style={{
            inset: size * 0.14,
            background: "radial-gradient(circle at 50% 28%, #5a5d62 0%, #323438 55%, #18191b 100%)",
            border: "1px solid #111",
            boxShadow: "inset 0 2px 3px rgba(255,255,255,.18), inset 0 -4px 8px rgba(0,0,0,.6)",
          }}
        />
      </div>
    </SlotFrame>
  );
}
