import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ButtonParam, Param } from "@/controls/Param";
import { clamp01 } from "@/controls/types";
import { clearDefaults, hasDefaults, isAdmin, saveDefaults } from "@/db/appDefaults";
import { params, type ParamRow } from "@/db/schema";
import type { Plugin } from "@/plugins/Plugin";
import { useTable } from "@/db/useDb";
import { useLive } from "@/ui/app/LiveProvider";
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
 * The right-side controls drawer: the focused plugin's params with live value editors ONLY — this
 * panel *drives* the app. All binding work (chips, drag-to-assign, presets) lives on the assign
 * surface (the controller overlay + {@link AssignPanel}), never here.
 */
export function ControlsPanel() {
  useRaf();
  const { stage } = useLive();
  const managed = stage.managed();
  const pluginId = managed?.id ?? "";

  // pluginId is a selector input: without it in deps the memoised selection would go stale when
  // focus moves (or the first plugin loads) without a table mutation.
  const rows = useTable(params, (t) => [...t.by("plugin", pluginId)].sort((a, b) => a.order - b.order), [pluginId]);

  if (!managed) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-sm text-ink-dim/60">
        No plugin focused — load one first
      </div>
    );
  }

  const liveByName = new Map(managed.params.map((p) => [p.name, p]));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-ink-dim">
            {managed.constructor.name.replace(/Layer$/, "")}
            {stage.focusPart === "shader" && <span className="ml-1 rounded bg-accent/15 px-1 text-accent">fx</span>}
          </span>
        </div>
        <div className="space-y-3">
          {rows.map((row) => {
            const live = liveByName.get(row.name);
            return (
              <div key={row.id} className="flex flex-col gap-1">
                <span className="min-w-0 flex-1 truncate text-xs text-ink-dim">{row.name}</span>
                {live && <ValueEditor row={row} live={live} />}
              </div>
            );
          })}
        </div>
      </div>
      {isAdmin() && <AdminDefaults managed={managed} />}
    </div>
  );
}

/**
 * The `#admin` dev surface: freeze the FOCUSED plugin's current values as its load-time defaults
 * (`paramDefaults` rows applied on every `create()`). Focus is per bank-half, so a generator and
 * its shader are saved separately — focus the fx preview to author the shader's defaults.
 */
function AdminDefaults({ managed }: { managed: Plugin }) {
  const { stage } = useLive();
  const [flashed, setFlashed] = useState<"saved" | "cleared" | null>(null);
  const flash = (what: "saved" | "cleared") => {
    setFlashed(what);
    setTimeout(() => setFlashed((cur) => (cur === what ? null : cur)), 1500);
  };
  const name = managed.constructor.name.replace(/Layer$/, "");
  const overridden = hasDefaults(managed.id);
  const btn =
    "rounded border border-edge px-2 py-1 text-left text-xs text-ink-dim transition-colors hover:border-accent/50 hover:text-ink";
  return (
    <div className="shrink-0 border-t border-edge p-3">
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-ink-dim">
        <span>
          Admin · defaults
          {stage.focusPart === "shader" && <span className="ml-1 rounded bg-accent/15 px-1 text-accent">fx</span>}
        </span>
        {flashed && <span className="normal-case text-accent">{flashed} ✓</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        <button className={btn} onClick={() => { saveDefaults(managed); flash("saved"); }}>
          Save current values as {name} defaults
        </button>
        {overridden && (
          <button className={btn} onClick={() => { clearDefaults(managed.id); flash("cleared"); }}>
            Reset {name} to code defaults
          </button>
        )}
      </div>
    </div>
  );
}

// ── live value editors (drive the param directly — bound or not) ────────────────────────────────

export function ValueEditor({ row, live }: { row: ParamRow; live: Param | ButtonParam }) {
  if (live instanceof Param) {
    return (
      <div className="flex items-center gap-3">
        <ParamFader param={live} />
        <span className="w-14 shrink-0 text-right font-mono text-xs text-ink-dim">
          {live.step >= 1 ? Math.round(live.value) : live.value.toFixed(2)}
        </span>
      </div>
    );
  }
  const cycleStates = row.control.type === "cycle" ? row.control.options : undefined;
  if (cycleStates?.length) {
    return (
      <div className="flex flex-wrap gap-1">
        {cycleStates.map((label, i) => {
          const active = live.count % cycleStates.length === i;
          return (
            <button
              key={label}
              onClick={() => {
                const steps = ((i - (live.count % cycleStates.length)) + cycleStates.length) % cycleStates.length;
                if (steps > 0) live.press(steps);
              }}
              className={
                "rounded px-2 py-0.5 text-xs transition-colors " +
                (active ? "border-accent bg-accent/20 text-accent" : "border-edge text-ink-dim hover:border-accent/50 hover:text-ink")
              }
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <button
      onClick={() => live.press()}
      className={
        "self-start rounded px-3 py-1 text-xs transition-colors " +
        (live.intent !== "trigger" && live.on
          ? "border-accent bg-accent/20 text-accent"
          : "border-edge text-ink-dim hover:border-accent/50 hover:text-ink")
      }
    >
      {live.intent === "trigger" ? "FIRE" : live.on ? "ON" : "OFF"}
    </button>
  );
}

/** A horizontal skeuomorphic fader (same look as the controller) driving a plugin {@link Param}. */
function ParamFader({ param }: { param: Param }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const active = param.value !== param.default;

  const onDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    const apply = (clientX: number) => {
      const r = trackRef.current?.getBoundingClientRect();
      if (!r) return;
      const CAP = 16;
      param.setNorm(clamp01((clientX - r.left - CAP / 2) / (r.width - 8 - CAP)));
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
