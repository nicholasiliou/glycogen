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
  const lit = s.pressed || flash || s.lit; // s.lit = a bank action on this pad is the active bank

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    s.drive({ pressed: true });
    setFlash(true);
    window.setTimeout(() => setFlash(false), 140);
  };
  const onUp = () => s.drive({ pressed: false });

  return (
    <SlotFrame slot={sid} label={s.label ?? label} active={s.active || s.lit} armed={s.armed}>
      <div
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        onClick={() => s.arm()}
        className={cn("flex h-8 w-16 touch-none cursor-pointer items-center justify-center rounded", className)}
        style={{
          background: lit ? "linear-gradient(#232426, #131416)" : "linear-gradient(#303236, #1a1b1d 60%, #131416)",
          border: lit ? "1px solid var(--color-accent)" : "1px solid #050505",
        }}
      >
        <div className={cn("h-2 w-2 rounded-full", lit ? "bg-accent" : "bg-ink-dim/40")} />
      </div>
    </SlotFrame>
  );
}
