// ── jog wheel (angular drag → relative delta) ─────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import * as React from "react";
import { slotId } from "@/controls/types";
import { asset } from "@/lib/asset";
import { activeRing, dragWith, SlotFrame, useSlot } from "./shared";

export function JogWheel({ slot, label, size = 360 }: { slot: number; label?: string; size?: number }) {
  const sid = slotId("jog", slot);
  const s = useSlot(sid);
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(0);
  const [spin, setSpin] = useState(0);

  // Spin the wheel when the slot is driven from hardware MIDI (not just on-screen drag). Each new
  // bus message bumps liveSeq; we fold its signed delta into the visible rotation so the animation
  // matches a physical jog. While the user is dragging on-screen, the drag handler owns the spin
  // (it calls setSpin directly), so we skip those self-induced bus bumps to avoid double-counting.
  const dragging = useRef(false);
  const lastSeq = useRef(s.liveSeq);
  useEffect(() => {
    if (s.liveSeq === lastSeq.current) return;
    lastSeq.current = s.liveSeq;
    if (!dragging.current && s.liveDelta) setSpin((p) => p + s.liveDelta * 30);
  }, [s.liveSeq, s.liveDelta]);

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    last.current = Math.atan2(e.clientY - cy, e.clientX - cx);
    dragging.current = true;
    dragWith(
      (ev) => {
        const ang = Math.atan2(ev.clientY - cy, ev.clientX - cx);
        let d = ang - last.current;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        last.current = ang;
        setSpin((p) => p + (d * 180) / Math.PI);
        s.drive({ relative: true, delta: d * 6 });
      },
      () => { dragging.current = false; lastSeq.current = s.liveSeq; },
    );
  };

  return (
    <SlotFrame slot={sid} label={s.label ?? label} active={s.active} armed={s.armed}>
      <div
        ref={ref}
        onPointerDown={onDown}
        onClick={() => s.arm()}
        className="relative touch-none cursor-grab active:cursor-grabbing rounded-full"
        style={{ width: size, height: size, ...activeRing(s.active) }}
      >
        {/* outer rim – image sequence (5 frames, ~3° per frame) */}
        {(() => {
          const frameIndex = ((Math.floor(spin / 5) % 5) + 5) % 5;
          return Array.from({ length: 5 }, (_, i) => (
            <img
              key={i}
              src={asset(`/animations/rim/${String(i + 1).padStart(4, "0")}.webp`)}
              alt=""
              className="absolute inset-0 rounded-full"
              style={{ width: size, height: size, display: i === frameIndex ? "block" : "none" }}
              draggable={false}
            />
          ));
        })()}
        {/* spindle */}
        <img
          src={asset("/Spindle.svg")}
          alt="spindle"
          className="absolute left-1/2 top-1/2 h-30 w-30 -translate-x-1/2 -translate-y-1/2"
          style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))" }}
          draggable={false}
        />
      </div>
    </SlotFrame>
  );
}
