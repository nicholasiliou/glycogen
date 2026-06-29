// ── horizontal crossfader (single absolute slot) ─────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import * as React from "react";
import { clamp01, slotId } from "@/controls/types";
import { activeRing, dragWith, SlotFrame, useSlot } from "./shared";

export function Crossfader({ slot = 0, width = 240 }: { slot?: number; width?: number }) {
  const s = useSlot(slotId("crossfader", slot));
  const [local, setLocal] = useState(0.5);
  useEffect(() => {
    setLocal(s.liveValue);
  }, [s.liveValue]);
  const trackRef = useRef<HTMLDivElement>(null);
  const CAP = 18;
  const travel = width - 8 - CAP;
  const left = 4 + local * travel;

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const apply = (clientX: number) => {
      const r = trackRef.current?.getBoundingClientRect();
      if (!r) return;
      const nv = clamp01((clientX - r.left - CAP / 2) / travel);
      setLocal(nv);
      s.drive({ value: nv });
    };
    apply(e.clientX);
    dragWith((ev) => apply(ev.clientX));
  };

  return (
    <SlotFrame label="A · X · B" active={s.active} armed={s.armed}>
      <div
        ref={trackRef}
        onPointerDown={onDown}
        onContextMenu={(e) => { e.preventDefault(); s.arm(); }}
        className="relative h-7 touch-none cursor-ew-resize"
        style={{ width }}
      >
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
            ...activeRing(s.active),
          }}
        >
          <div className="absolute inset-y-1 left-1/2 w-[1px] -translate-x-1/2 bg-black/60" />
        </div>
      </div>
    </SlotFrame>
  );
}
