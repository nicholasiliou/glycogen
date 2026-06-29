import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useLive } from "@/ui/app/LiveProvider";
import { Param, ButtonParam } from "@/controls/Param";
import { clamp01 } from "@/controls/types";
import { FaderVisual } from "@/ui/controller/widgets/FaderVisual";
import { dragWith } from "@/ui/controller/widgets/shared";

/** ~30fps tick so live values (faders, cycle states) stay in sync while the panel is mounted. */
function useRaf(): void {
  const [, setT] = useState(0);
  useEffect(() => {
    let id = 0;
    let last = 0;
    const loop = (now: number) => {
      if (now - last > 33) { last = now; setT((x) => (x + 1) % 1_000_000); }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
}

/**
 * The parameter editor for the focused plugin — every bound control as a row (faders as skeuomorphic
 * sliders matching the controller surface, buttons/pads as toggles or cycle chips). Drives the
 * ControlBus, so on-screen edits and hardware MIDI stay in lockstep. Used by the right-side drawer.
 */
export function ControlsPanel() {
  useRaf();
  const { stage, bus } = useLive();
  const managed = stage.managed();

  if (!managed) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-sm text-ink-dim/60">
        No plugin focused — load one first
      </div>
    );
  }

  const params = managed.params;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-ink-dim">
        {managed.constructor.name.replace(/Layer$/, "")}
      </div>
      <div className="space-y-3">
        {params.map((p) => {
          if (p instanceof ButtonParam) {
            // Cycle states are discovered from the param itself (recorded on its last pick()), so
            // any new cycle a plugin adds shows up here automatically — no hand-maintained map.
            const cycleStates: readonly string[] | undefined = p.cycle.length ? p.cycle : undefined;
            const isLong = !!cycleStates && cycleStates.length > 6;
            return (
              <div key={p.slot} className={isLong ? "flex flex-col gap-1" : "flex flex-wrap items-center gap-x-3 gap-y-1"}>
                <span className="w-28 shrink-0 text-xs text-ink-dim">{p.name || p.slot}</span>
                {cycleStates ? (
                  <div className="flex flex-wrap gap-1">
                    {cycleStates.map((label, i) => {
                      const active = p.count % cycleStates.length === i;
                      return (
                        <button
                          key={label}
                          onClick={() => {
                            // Fire until we land on this index.
                            const steps = ((i - (p.count % cycleStates.length)) + cycleStates.length) % cycleStates.length;
                            for (let s = 0; s < steps; s++) bus.fire(p.slot);
                          }}
                          className={
                            "rounded px-2 py-0.5 text-xs transition-colors " +
                            (active
                              ? "border-accent bg-accent/20 text-accent"
                              : "border-edge text-ink-dim hover:border-accent/50 hover:text-ink")
                          }
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <button
                    onClick={() => bus.fire(p.slot)}
                    className={
                      "rounded px-3 py-1 text-xs transition-colors " +
                      (p.on
                        ? "border-accent bg-accent/20 text-accent"
                        : "border-edge text-ink-dim hover:border-accent/50 hover:text-ink")
                    }
                  >
                    {p.on ? "ON" : "OFF"}
                  </button>
                )}
              </div>
            );
          }
          if (p instanceof Param) {
            return (
              <div key={p.slot} className="flex items-center gap-3">
                <span className="w-24 min-w-0 shrink truncate text-xs text-ink-dim">{p.name || p.slot}</span>
                <ParamFader param={p} onDrive={(norm) => bus.drive(p.slot, { value: norm })} />
                <span className="w-14 shrink-0 text-right font-mono text-xs text-ink-dim">
                  {p.step >= 1 ? Math.round(p.value) : p.value.toFixed(2)}
                </span>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

/** A horizontal skeuomorphic fader (same look as the controller) driving a plugin {@link Param}. */
function ParamFader({ param, onDrive }: { param: Param; onDrive: (norm: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const active = param.value !== param.default;

  const onDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    const apply = (clientX: number) => {
      const r = trackRef.current?.getBoundingClientRect();
      if (!r) return;
      const CAP = 16;
      onDrive(clamp01((clientX - r.left - CAP / 2) / (r.width - 8 - CAP)));
    };
    apply(e.clientX);
    dragWith((ev) => apply(ev.clientX));
  };

  return (
    <div className="min-w-0 flex-1">
      <FaderVisual norm={param.norm} orient="horizontal" length={200} active={active} trackRef={trackRef} onPointerDown={onDown} />
    </div>
  );
}
