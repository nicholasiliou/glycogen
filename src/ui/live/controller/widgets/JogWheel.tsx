// ── jog wheel (angular drag → relative delta for an Evolve slot) ──────────────────────────────
import { useEffect, useRef, useState } from "react";
import * as React from "react";
import type { ControlAssignment } from "@/midi/preset";
import { activeRing, dragWith, SlotFrame, useSlot } from "./shared";

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
