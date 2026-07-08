// ── vertical fader (absolute 0..1) ───────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import * as React from "react";
import { clamp01, slotId } from "@/controls/types";
import { dragWith, SlotFrame, useSlot } from "./shared";
import { FaderVisual } from "./FaderVisual";

export function Fader({ slot, label, height = 160 }: { slot: number; label?: string; height?: number }) {
  const sid = slotId("fader", slot);
  const s = useSlot(sid);
  const [local, setLocal] = useState(0);
  useEffect(() => {
    setLocal(s.liveValue);
  }, [s.liveValue]);
  const trackRef = useRef<HTMLDivElement>(null);
  const CAP = 16;
  const travel = height - 8 - CAP;

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const apply = (clientY: number) => {
      const r = trackRef.current?.getBoundingClientRect();
      if (!r) return;
      const nv = clamp01(1 - (clientY - r.top - CAP / 2) / travel);
      setLocal(nv);
      s.drive({ value: nv });
    };
    apply(e.clientY);
    dragWith((ev) => apply(ev.clientY));
  };

  return (
    <SlotFrame slot={sid} label={s.label ?? label} active={s.active} armed={s.armed}>
      <FaderVisual
        norm={local}
        orient="vertical"
        length={height}
        active={s.active}
        trackRef={trackRef}
        onPointerDown={onDown}
        onClick={() => s.arm()}
      />
    </SlotFrame>
  );
}
