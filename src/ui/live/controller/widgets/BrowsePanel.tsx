// ── browse selector (rotary encoder with detents) ────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import * as React from "react";
import { useLive } from "@/ui/live/app/LiveProvider";
import { activeRing, dragWith, SlotFrame, useSlot } from "./shared";

export function BrowsePanel() {
  const live = useLive();
  const slot = useSlot("browse");
  const shaderMode = live.browseMode === "shader";
  const label = shaderMode ? live.shaderType : live.selectedType;
  const list = shaderMode ? live.shaders : live.types;
  const currentIndex = list.indexOf(label);

  // Normalized rotation: each detent is ~26.67 degrees (360 / 13.5 avg slots)
  // Map selection index to continuous rotation for smooth visual feedback
  const rotationAngle = (currentIndex / Math.max(1, list.length - 1)) * 360;

  const ref = useRef<HTMLDivElement>(null);
  const [spin, setSpin] = useState(rotationAngle);
  const lastAngle = useRef(0);

  const step = (d: number) => {
    live.driveAssignment("browse", { value: 0, relative: true, delta: d });
  };

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

      // Detent every ~30 degrees (12 positions)
      const detent = Math.round(accumulated / 30);
      if (detent !== 0) {
        step(detent);
        accumulated = 0;
      }
    });
  };

  // Sync rotation when selection changes externally
  useEffect(() => {
    setSpin(rotationAngle);
  }, [rotationAngle]);

  return (
    <SlotFrame slot={slot} label={shaderMode ? "Browse · Shader" : "Browse · Plugin"}>
      <div
        ref={ref}
        onPointerDown={onDown}
        className="relative touch-none cursor-grab active:cursor-grabbing rounded-full"
        style={{ width: 80, height: 80, ...activeRing(slot.active) }}
      >
        {/* outer knurled ring */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: "radial-gradient(circle at 50% 32%, #45484d 0%, #25272a 55%, #131416 100%)",
            border: "1px solid #050505",
            boxShadow: "inset 0 1px 1px rgba(255,255,255,.18), inset 0 -3px 5px rgba(0,0,0,.55), 0 1px 2px rgba(0,0,0,.6)",
          }}
        />

        {/* rotating indicator with detents */}
        <div className="absolute inset-0" style={{ transform: `rotate(${spin}deg)` }}>
          {/* primary indicator (top) */}
          <div className="absolute left-1/2 top-[10%] h-[8%] w-0.5 -translate-x-1/2 rounded-full bg-accent shadow-lg shadow-accent/50" />
        </div>

        {/* center spindle */}
        <div
          className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: "radial-gradient(circle at 40% 35%, #6a6a6d, #161618)", zIndex: 10 }}
        />
      </div>
    </SlotFrame>
  );
}
