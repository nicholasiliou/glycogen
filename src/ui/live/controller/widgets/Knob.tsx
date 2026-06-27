// ── knob ───────────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import * as React from "react";
import type { ControlAssignment } from "@/midi/preset";
import { clamp01 } from "@/ui/live/macros/macros";
import { activeRing, dragWith, SlotFrame, useSlot } from "./shared";

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
