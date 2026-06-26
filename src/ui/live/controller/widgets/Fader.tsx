// ── vertical fader ───────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import * as React from "react";
import type { ControlAssignment } from "@/midi/preset";
import { clamp01 } from "../../macros";
import { activeRing, dragWith, SlotFrame, useSlot } from "./shared";

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
