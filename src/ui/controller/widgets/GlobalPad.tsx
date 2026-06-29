// ── global pad (app action, not a control slot) ───────────────────────────────────────────────
import { useState } from "react";
import * as React from "react";
import { cn } from "@/ui/lib/cn";
import { SlotFrame } from "./shared";

/**
 * A pad that drives an app-wide function (bank select / delete) rather than a ControlBus slot, so it
 * is never assignable to a plugin. Same skeuomorphic look as {@link Pad}; `active` lights it (e.g.
 * the deck's current bank), `loaded` shows a filled dot, and `onPress` runs the action.
 */
export function GlobalPad({
  label,
  onPress,
  active = false,
  loaded = false,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  loaded?: boolean;
}) {
  const [flash, setFlash] = useState(false);
  const lit = active || flash;

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    onPress();
    setFlash(true);
    window.setTimeout(() => setFlash(false), 140);
  };

  return (
    <SlotFrame active={active}>
      <button
        type="button"
        onPointerDown={onDown}
        title={label}
        className="flex h-12 w-16 touch-none cursor-pointer flex-col items-center justify-center gap-1 rounded select-none"
        style={{
          background: lit ? "linear-gradient(#1c2a00, #0e1500)" : "linear-gradient(#303236, #1a1b1d 60%, #131416)",
          border: lit ? "1px solid var(--color-accent)" : "1px solid #050505",
          boxShadow: lit
            ? "inset 0 0 8px rgba(192,252,4,.5), 0 0 8px -1px var(--color-accent)"
            : "inset 0 1px 1px rgba(255,255,255,.16), 0 2px 3px rgba(0,0,0,.55)",
        }}
      >
        <div className={cn("h-1.5 w-1.5 rounded-full", lit ? "bg-accent" : loaded ? "bg-ink/50" : "bg-ink-dim/40")} />
        <span className={cn("text-[9px] font-semibold uppercase leading-none tracking-wide", lit ? "text-accent" : "text-ink-dim")}>
          {label}
        </span>
      </button>
    </SlotFrame>
  );
}
