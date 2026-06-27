// ── horizontal crossfader (reads/writes the live crossfade directly) ─────────────────────────
import { useRef } from "react";
import * as React from "react";
import { clamp01 } from "@/ui/live/macros/macros";
import { useLive } from "@/ui/live/app/LiveProvider";
import { activeRing, dragWith, SlotFrame, useSlot } from "./shared";

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
