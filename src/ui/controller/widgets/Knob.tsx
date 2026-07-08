// ── knob (potentiometer: absolute 0..1) ──────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import * as React from "react";
import { clamp01, slotId } from "@/controls/types";
import { activeRing, dragWith, SlotFrame, useSlot } from "./shared";

export function Knob({ slot, label, size = 32 }: { slot: number; label?: string; size?: number }) {
  const sid = slotId("knob", slot);
  const s = useSlot(sid);
  const [local, setLocal] = useState(0.5);
  // Follow incoming (MIDI) value so the position persists when hardware goes quiet.
  useEffect(() => {
    setLocal(s.liveValue);
  }, [s.liveValue]);
  const angle = -135 + local * 270;

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startV = local;
    dragWith((ev) => {
      const nv = clamp01(startV - (ev.clientY - startY) / 180);
      setLocal(nv);
      s.drive({ value: nv });
    });
  };

  return (
    <SlotFrame slot={sid} label={s.label ?? label} active={s.active} armed={s.armed}>
      <div
        onPointerDown={onDown}
        onContextMenu={(e) => { e.preventDefault(); s.arm(); }}
        className="relative touch-none cursor-ns-resize rounded-full"
        style={{ width: size, height: size, ...activeRing(s.active) }}
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
