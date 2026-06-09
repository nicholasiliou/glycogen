import { useLayoutEffect, useRef, useState } from "react";
import type { Interpolation, Keyframe, Layer, Property } from "@/engine";
import { useEngine, useRevision, useSelection, useTime } from "@/ui/engine/EngineProvider";
import { cn } from "@/ui/lib/cn";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/components/ui/context-menu";

const LEFT_W = 176;
const ROW_H = 22;

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function Timeline() {
  const engine = useEngine();
  useRevision();
  const selection = useSelection();
  const comp = engine.comp;
  const [tracksRef, width] = useElementWidth<HTMLDivElement>();

  const timeToX = (t: number) => (t / comp.duration) * width;
  const xToTime = (x: number) => Math.max(0, Math.min(comp.duration, (x / width) * comp.duration));

  const scrub = (clientX: number, rect: DOMRect) => engine.seek(xToTime(clientX - rect.left));

  return (
    <div className="flex h-full flex-col bg-panel">
      {/* Ruler */}
      <div className="flex h-7 shrink-0 border-b border-edge">
        <div className="flex w-[176px] shrink-0 items-center gap-2 border-r border-edge px-2 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
          Timeline
        </div>
        <Ruler comp={comp} width={width} timeToX={timeToX} onScrub={scrub} />
      </div>

      {/* Body */}
      <ScrollArea className="flex-1">
        <div className="flex">
          {/* Left: names */}
          <div className="w-[176px] shrink-0 border-r border-edge">
            {comp.layers.map((layer) => (
              <LayerNames key={layer.id} layer={layer} selected={selection.includes(layer.id)} />
            ))}
          </div>
          {/* Right: tracks */}
          <div
            ref={tracksRef}
            className="relative flex-1"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) scrub(e.clientX, e.currentTarget.getBoundingClientRect());
            }}
          >
            {comp.layers.map((layer) => (
              <LayerTracks key={layer.id} layer={layer} timeToX={timeToX} xToTime={xToTime} width={width} />
            ))}
            {comp.layers.length === 0 && <div className="h-16" />}
            <PlayheadLine timeToX={timeToX} />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function Ruler({
  comp,
  width,
  timeToX,
  onScrub,
}: {
  comp: { duration: number; fps: number };
  width: number;
  timeToX: (t: number) => number;
  onScrub: (clientX: number, rect: DOMRect) => void;
}) {
  const step = chooseStep(comp.duration, width);
  const ticks: number[] = [];
  for (let t = 0; t <= comp.duration + 1e-6; t += step) ticks.push(Number(t.toFixed(4)));

  const handle = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onScrub(e.clientX, rect);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  return (
    <div
      className="relative flex-1 cursor-ew-resize select-none"
      onPointerDown={handle}
      onPointerMove={(e) => {
        if (e.buttons === 1) onScrub(e.clientX, e.currentTarget.getBoundingClientRect());
      }}
    >
      {ticks.map((t) => (
        <div key={t} className="absolute top-0 h-full border-l border-edge/70" style={{ left: timeToX(t) }}>
          <span className="ml-1 text-[9px] text-ink-dim">{t}s</span>
        </div>
      ))}
      <RulerHead timeToX={timeToX} />
    </div>
  );
}

function RulerHead({ timeToX }: { timeToX: (t: number) => number }) {
  const { time } = useTime();
  return (
    <div className="pointer-events-none absolute top-0 z-10 -ml-1 h-full" style={{ left: timeToX(time) }}>
      <div className="h-0 w-0 border-x-4 border-t-4 border-x-transparent border-t-accent" />
    </div>
  );
}

function PlayheadLine({ timeToX }: { timeToX: (t: number) => number }) {
  const { time } = useTime();
  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-accent/80"
      style={{ left: timeToX(time) }}
    />
  );
}

function LayerNames({ layer, selected }: { layer: Layer; selected: boolean }) {
  const engine = useEngine();
  const animated = layer.allProperties().filter((p) => p.isAnimated);
  return (
    <div>
      <div
        className={cn(
          "flex items-center px-2 text-[11px]",
          selected ? "bg-accent/15 text-ink" : "text-ink-dim",
        )}
        style={{ height: ROW_H }}
        onClick={() => engine.select([layer.id])}
      >
        <span className="truncate">{layer.name}</span>
      </div>
      {animated.map((p) => (
        <div
          key={p.id}
          className="flex items-center pl-5 pr-2 text-[10px] text-ink-dim/80"
          style={{ height: ROW_H }}
        >
          <span className="truncate">{p.name}</span>
        </div>
      ))}
    </div>
  );
}

function LayerTracks({
  layer,
  timeToX,
  xToTime,
  width,
}: {
  layer: Layer;
  timeToX: (t: number) => number;
  xToTime: (x: number) => number;
  width: number;
}) {
  const engine = useEngine();
  const animated = layer.allProperties().filter((p) => p.isAnimated);
  const inX = timeToX(layer.inPoint);
  const outX = isFinite(layer.outPoint) ? timeToX(layer.outPoint) : width;

  return (
    <div>
      {/* Layer duration bar */}
      <div className="relative border-b border-edge/30" style={{ height: ROW_H }}>
        <div
          className={cn("absolute top-1 bottom-1 rounded-sm", layer.enabled ? "bg-panel-raised" : "bg-panel-raised/40")}
          style={{ left: inX, width: Math.max(2, outX - inX) }}
        />
      </div>
      {animated.map((p) => (
        <PropertyTrack key={p.id} layer={layer} prop={p} timeToX={timeToX} xToTime={xToTime} />
      ))}
    </div>
  );
}

function PropertyTrack({
  layer,
  prop,
  timeToX,
  xToTime,
}: {
  layer: Layer;
  prop: Property;
  timeToX: (t: number) => number;
  xToTime: (x: number) => number;
}) {
  const engine = useEngine();
  return (
    <div
      className="relative border-b border-edge/20"
      style={{ height: ROW_H }}
      onDoubleClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        engine.addKeyframe(layer.id, prop.id, xToTime(e.clientX - rect.left));
      }}
    >
      {prop.keyframes.map((kf) => (
        <KeyframeDot key={kf.id} layer={layer} prop={prop} kf={kf} timeToX={timeToX} xToTime={xToTime} />
      ))}
    </div>
  );
}

function KeyframeDot({
  layer,
  prop,
  kf,
  timeToX,
  xToTime,
}: {
  layer: Layer;
  prop: Property;
  kf: Keyframe;
  timeToX: (t: number) => number;
  xToTime: (x: number) => number;
}) {
  const engine = useEngine();
  const interps: Interpolation[] = ["linear", "bezier", "smooth", "stepped"];

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="absolute top-1/2 z-[5] h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-grab border border-black/50 bg-accent active:cursor-grabbing"
          style={{ left: timeToX(kf.time) }}
          onPointerDown={(e) => {
            e.stopPropagation();
            const parent = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            const move = (ev: PointerEvent) =>
              engine.moveKeyframe(layer.id, prop.id, kf.id, xToTime(ev.clientX - parent.left));
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
          title={`${prop.name} @ ${kf.time.toFixed(2)}s · ${kf.interp}`}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>Interpolation</ContextMenuLabel>
        {interps.map((i) => (
          <ContextMenuItem
            key={i}
            className={cn("capitalize", kf.interp === i && "text-accent")}
            onSelect={() => engine.setKeyframeInterpolation(layer.id, prop.id, kf.id, i)}
          >
            {i}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem className="text-red-400" onSelect={() => engine.removeKeyframe(layer.id, prop.id, kf.id)}>
          Delete keyframe
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function chooseStep(duration: number, width: number): number {
  const targetPx = 70;
  const rawStep = (duration / Math.max(1, width)) * targetPx;
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
  return steps.find((s) => s >= rawStep) ?? 60;
}
