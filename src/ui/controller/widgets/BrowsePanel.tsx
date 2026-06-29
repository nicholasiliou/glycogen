// ── browse selector (rotary with detents → steps a selection) ─────────────────────────────────
import { useRef, useState } from "react";
import * as React from "react";
import { dragWith, SlotFrame } from "./shared";

/**
 * App-level rotary browser. Not a control slot — it steps an external selection (e.g. which plugin
 * is queued to load) via `onStep`, with mechanical detents every ~30°.
 */
export function BrowsePanel({ label, onStep }: { label?: string; onStep?: (delta: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [spin, setSpin] = useState(0);
  const lastAngle = useRef(0);

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    lastAngle.current = Math.atan2(e.clientY - cy, e.clientX - cx);
    let accumulated = 0;

    dragWith((ev) => {
      const ang = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      let d = ang - lastAngle.current;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      lastAngle.current = ang;

      const degrees = (d * 180) / Math.PI;
      setSpin((s) => s + degrees);
      accumulated += degrees;

      const detent = Math.round(accumulated / 30);
      if (detent !== 0) {
        onStep?.(detent);
        accumulated = 0;
      }
    });
  };

  return (
    // Blank SlotFrame label; the browse label is rendered below with a fixed width so a long plugin
    // name wraps inside the wheel's footprint instead of widening this grid cell and shifting the
    // whole mixer layout.
    <SlotFrame label=" ">
      <div
        ref={ref}
        onPointerDown={onDown}
        className="relative touch-none cursor-grab active:cursor-grabbing rounded-full"
        style={{ width: 80, height: 80 }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: "radial-gradient(circle at 50% 32%, #45484d 0%, #25272a 55%, #131416 100%)",
            border: "1px solid #050505",
            boxShadow: "inset 0 1px 1px rgba(255,255,255,.18), inset 0 -3px 5px rgba(0,0,0,.55), 0 1px 2px rgba(0,0,0,.6)",
          }}
        />
        <div className="absolute inset-0" style={{ transform: `rotate(${spin}deg)` }}>
          <div className="absolute left-1/2 top-[10%] h-[8%] w-0.5 -translate-x-1/2 rounded-full bg-accent shadow-lg shadow-accent/50" />
        </div>
        <div
          className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: "radial-gradient(circle at 40% 35%, #6a6a6d, #161618)", zIndex: 10 }}
        />
      </div>
      <span
        className="w-20 select-none text-center text-[8px] font-semibold uppercase leading-tight tracking-[0.12em] text-ink-dim wrap-break-word"
        title={label}
      >
        {label ?? "Browse"}
      </span>
    </SlotFrame>
  );
}
