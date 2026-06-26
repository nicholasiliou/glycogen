// ── circle button ───────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import * as React from "react";
import { cn } from "@/ui/lib/cn";
import type { ControlAssignment } from "@/midi/preset";
import { activeRing, SlotFrame, useSlot } from "./shared";

export function Circle({
  assignment,
  label,
  size = 20,
}: {
  assignment: ControlAssignment;
  label: string;
  size?: number;
}) {
  const slot = useSlot(assignment);
  const [flash, setFlash] = useState(false);
  const lit = slot.pressed || flash;

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    slot.fire();
    setFlash(true);
    window.setTimeout(() => setFlash(false), 140);
  };

  return (
    <SlotFrame slot={slot} label={label}>
      <div
        onPointerDown={onDown}
        className="flex touch-none cursor-pointer items-center justify-center rounded-full"
        style={{
          width: size,
          height: size,
          background: lit
            ? "radial-gradient(circle at 40% 35%, #1c2a00, #0e1500)"
            : "radial-gradient(circle at 40% 35%, #303236, #1a1b1d 60%, #131416)",
          border: lit ? "1px solid var(--color-accent)" : "1px solid #050505",
          boxShadow: lit
            ? "inset 0 0 8px rgba(192,252,4,.5), 0 0 8px -1px var(--color-accent)"
            : "inset 0 1px 1px rgba(255,255,255,.16), 0 2px 3px rgba(0,0,0,.55)",
          ...activeRing(slot.active),
        }}
      >
        <div className={cn("h-2 w-2 rounded-full", lit ? "bg-accent" : "bg-ink-dim/40")} />
      </div>
    </SlotFrame>
  );
}
