// ── pad (button slot: press = fire) ──────────────────────────────────────────────────────────
import { useState } from "react";
import * as React from "react";
import { slotId } from "@/controls/types";
import { cn } from "@/ui/lib/cn";
import { SlotFrame, useSlot } from "./shared";

export function Pad({ slot, label, className }: { slot: number; label?: string; className?: string }) {
  const sid = slotId("pad", slot);
  const s = useSlot(sid);
  const [flash, setFlash] = useState(false);
  const lit = s.pressed || flash;

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    s.drive({ pressed: true });
    setFlash(true);
    window.setTimeout(() => setFlash(false), 140);
  };
  const onUp = () => s.drive({ pressed: false });

  return (
    <SlotFrame slot={sid} label={s.label ?? label} active={s.active} armed={s.armed}>
      <div
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        onContextMenu={(e) => { e.preventDefault(); s.arm(); }}
        className={cn("flex h-8 w-16 touch-none cursor-pointer items-center justify-center rounded", className)}
        style={{
          background: lit ? "linear-gradient(#1c2a00, #0e1500)" : "linear-gradient(#303236, #1a1b1d 60%, #131416)",
          border: lit ? "1px solid var(--color-accent)" : "1px solid #050505",
          boxShadow: lit
            ? "inset 0 0 8px rgba(192,252,4,.5), 0 0 8px -1px var(--color-accent)"
            : "inset 0 1px 1px rgba(255,255,255,.16), 0 2px 3px rgba(0,0,0,.55)",
        }}
      >
        <div className={cn("h-2 w-2 rounded-full", lit ? "bg-accent" : "bg-ink-dim/40")} />
      </div>
    </SlotFrame>
  );
}
