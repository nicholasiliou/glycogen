// ── smooth knob (no indicator) ──────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import * as React from "react";
import type { ControlAssignment } from "@/midi/preset";
import { clamp01 } from "../../macros";
import { activeRing, dragWith, SlotFrame, useSlot } from "./shared";

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
