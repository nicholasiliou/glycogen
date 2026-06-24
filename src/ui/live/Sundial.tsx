import { useMemo } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEngine } from "@/ui/engine/EngineProvider";
import { Button } from "@/ui/components/ui/button";
import { LayerIcon } from "@/ui/components/LayerIcon";
import { FAMILY_META, instrumentSpec } from "@/audio/instruments/registry";
import { useLive } from "./LiveProvider";

interface DialItem {
  type: string;
  label: string;
  icon?: string;
  family?: string;
  color?: string;
  blurb?: string;
}

const SIZE = 264;
const R = 112; // tick ring radius

/**
 * The sundial: a dial of every stage layer. A needle sweeps to the selection; the centre
 * reads out what it is and what it sounds like. Spin with the arrows / mouse wheel — or the
 * MIDI jog wheel once it's learned. Styled to the Marathon palette (panel + lime accent).
 */
export function Sundial() {
  const engine = useEngine();
  const { types, selectedType, setSelectedType, addToStage } = useLive();

  const items = useMemo<DialItem[]>(
    () =>
      types.map((type) => {
        const def = engine.registry.get(type);
        const spec = instrumentSpec(type);
        return {
          type,
          label: def?.label ?? type,
          icon: def?.icon,
          family: spec?.family,
          color: spec ? FAMILY_META[spec.family].color : undefined,
          blurb: spec?.blurb,
        };
      }),
    [engine, types],
  );

  const n = items.length;
  const idx = Math.max(0, items.findIndex((i) => i.type === selectedType));
  const current = items[idx];
  const angleFor = (i: number) => -90 + (i * 360) / Math.max(1, n);
  const step = (d: number) => n && setSelectedType(items[(idx + d + n) % n].type);

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const accent = "var(--color-accent)";
  if (!current) return <div style={{ height: SIZE }} />;

  return (
    <div className="flex flex-col items-center gap-2 p-3">
      <div
        className="relative select-none"
        style={{ width: SIZE, height: SIZE }}
        onWheel={(e) => {
          e.preventDefault();
          step(e.deltaY > 0 ? 1 : -1);
        }}
      >
        <svg width={SIZE} height={SIZE} className="absolute inset-0">
          <circle cx={cx} cy={cy} r={R + 14} fill="var(--color-panel-raised)" stroke="var(--color-edge)" />
          <circle cx={cx} cy={cy} r={R - 30} fill="none" stroke="var(--color-edge)" opacity={0.5} />
          {items.map((it, i) => {
            const a = (angleFor(i) * Math.PI) / 180;
            const on = i === idx;
            const r1 = on ? R - 14 : R - 7;
            const c = Math.cos(a);
            const s = Math.sin(a);
            return (
              <line
                key={it.type}
                x1={cx + c * r1}
                y1={cy + s * r1}
                x2={cx + c * R}
                y2={cy + s * R}
                stroke={on ? it.color ?? accent : "var(--color-edge)"}
                strokeWidth={on ? 2.5 : 1.5}
                strokeLinecap="round"
                opacity={on ? 1 : 0.7}
              />
            );
          })}
          {/* clickable hit targets */}
          {items.map((it, i) => {
            const a = (angleFor(i) * Math.PI) / 180;
            return (
              <circle
                key={`hit-${it.type}`}
                cx={cx + Math.cos(a) * R}
                cy={cy + Math.sin(a) * R}
                r={8}
                fill="transparent"
                className="cursor-pointer"
                onClick={() => setSelectedType(it.type)}
              />
            );
          })}
          {/* needle */}
          <g
            style={{
              transform: `rotate(${angleFor(idx) + 90}deg)`,
              transformOrigin: `${cx}px ${cy}px`,
              transition: "transform 260ms cubic-bezier(.22,1,.36,1)",
            }}
          >
            <line x1={cx} y1={cy} x2={cx} y2={cy - (R - 18)} stroke={current.color ?? accent} strokeWidth={2} strokeLinecap="round" />
            <circle cx={cx} cy={cy - (R - 18)} r={3.5} fill={current.color ?? accent} />
          </g>
        </svg>

        {/* centre readout */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-10 text-center">
          <LayerIcon name={current.icon} className="h-7 w-7 text-ink" />
          <div className="text-sm font-medium leading-tight text-ink">{current.label}</div>
          <span
            className="rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wide"
            style={
              current.color
                ? { color: current.color, borderColor: current.color }
                : { color: "var(--color-ink-dim)", borderColor: "var(--color-edge)" }
            }
          >
            {current.family ? FAMILY_META[current.family as keyof typeof FAMILY_META].label : "Visual · silent"}
          </span>
          <div className="line-clamp-2 text-[10px] leading-tight text-ink-dim">
            {current.blurb ?? engine.registry.get(current.type)?.description ?? ""}
          </div>
        </div>
      </div>

      {/* controls */}
      <div className="flex w-full items-center justify-between">
        <Button size="icon-sm" variant="ghost" onClick={() => step(-1)} title="Previous">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="font-mono text-[10px] tabular-nums tracking-widest text-ink-dim">
          {String(idx + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
        </span>
        <Button size="icon-sm" variant="ghost" onClick={() => step(1)} title="Next">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <Button variant="accent" className="w-full" onClick={() => addToStage(current.type)}>
        <Plus className="h-4 w-4" /> Add to Stage
      </Button>
    </div>
  );
}
