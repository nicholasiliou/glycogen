// ── fader (absolute 0..1), vertical or horizontal ─────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import * as React from "react";
import { clamp01, slotId } from "@/controls/types";
import { dragWith, SlotFrame, useSlot } from "./shared";
import { FaderVisual } from "./FaderVisual";

export function Fader({
  slot,
  label,
  orient = "vertical",
  length = 160,
}: {
  slot: number;
  label?: string;
  orient?: "vertical" | "horizontal";
  length?: number;
}) {
  const sid = slotId("fader", slot);
  const s = useSlot(sid);
  const [local, setLocal] = useState(0);
  useEffect(() => {
    setLocal(s.liveValue);
  }, [s.liveValue]);
  const trackRef = useRef<HTMLDivElement>(null);
  const vertical = orient === "vertical";
  const CAP = 16;

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const apply = (clientX: number, clientY: number) => {
      const r = trackRef.current?.getBoundingClientRect();
      if (!r) return;
      // Both ends inset by CAP/2 so the cap centre tracks the pointer over the usable travel.
      const nv = vertical
        ? clamp01(1 - (clientY - r.top - CAP / 2) / (r.height - CAP))
        : clamp01((clientX - r.left - CAP / 2) / (r.width - CAP));
      setLocal(nv);
      s.drive({ value: nv });
    };
    apply(e.clientX, e.clientY);
    dragWith((ev) => apply(ev.clientX, ev.clientY));
  };

  return (
    <SlotFrame slot={sid} label={s.label ?? label} active={s.active} armed={s.armed}>
      <FaderVisual
        norm={local}
        orient={orient}
        length={length}
        trackRef={trackRef}
        onPointerDown={onDown}
        onClick={() => s.arm()}
      />
    </SlotFrame>
  );
}
