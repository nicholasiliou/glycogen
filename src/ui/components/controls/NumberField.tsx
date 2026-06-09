import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/ui/lib/cn";
import { fmtNum } from "@/ui/lib/format";

interface Props {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  disabled?: boolean;
}

/**
 * Scrubby number field: drag horizontally to scrub (After Effects style), click to
 * type. Shift = ×10 sensitivity. Used everywhere a numeric value is edited.
 */
export function NumberField({ value, onChange, min, max, step = 1, className, disabled }: Props) {
  const [text, setText] = useState(() => fmtNum(value));
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (!editing) setText(fmtNum(value));
  }, [value, editing]);

  const clamp = (v: number) => {
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  };

  return (
    <input
      ref={inputRef}
      className={cn(
        "h-6 w-full cursor-ew-resize rounded border border-transparent bg-panel-raised px-1.5 text-xs tabular-nums text-accent outline-none hover:border-edge focus:cursor-text focus:border-accent/60",
        disabled && "pointer-events-none opacity-40",
        className,
      )}
      value={editing ? text : fmtNum(value)}
      readOnly={!editing}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onPointerDown={(e) => {
        if (disabled || editing) return;
        drag.current = { x: e.clientX, v: value, moved: false };
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (Math.abs(dx) > 2) d.moved = true;
        const sens = step * (e.shiftKey ? 10 : 1);
        onChange(clamp(d.v + dx * sens));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        (e.target as Element).releasePointerCapture?.(e.pointerId);
        if (d && !d.moved) {
          setEditing(true);
          requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
          });
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const p = parseFloat(text);
          if (!isNaN(p)) onChange(clamp(p));
          setEditing(false);
          inputRef.current?.blur();
        } else if (e.key === "Escape") {
          setEditing(false);
          setText(fmtNum(value));
          inputRef.current?.blur();
        }
      }}
      onBlur={() => {
        if (!editing) return;
        setEditing(false);
        const p = parseFloat(text);
        if (!isNaN(p)) onChange(clamp(p));
        else setText(fmtNum(value));
      }}
    />
  );
}
