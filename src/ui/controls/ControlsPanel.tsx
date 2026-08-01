import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ButtonParam, Param } from "@/controls/Param";
import { clamp01 } from "@/controls/types";
import { clearDefaults, hasDefaults, isAdmin, saveDefaults } from "@/db/appDefaults";
import { params, type ParamRow } from "@/db/schema";
import type { Plugin } from "@/plugins/Plugin";
import { TextLayer, TEXT_PRESETS } from "@/plugins/TextLayer";
import { labelOf } from "@/plugins/registry";
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

/** Collapsible param section with a chevron header. */
function ParamSection({ plugin, focusPart }: { plugin: Plugin; focusPart: "plugin" | "shader" }) {
  const { stage, setFocusPart } = useLive();
  const [open, setOpen] = useState(true);
  const pluginId = plugin.id;
  const rows = useTable(params, (t) => [...t.by("plugin", pluginId)].sort((a, b) => a.order - b.order), [pluginId]);
  const liveByName = new Map(plugin.params.map((p) => [p.name, p]));

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) setFocusPart(focusPart);
    else if (stage.focusPart === focusPart) setFocusPart(focusPart === "plugin" ? "shader" : "plugin");
  };

  return (
    <div>
      <button
        onClick={toggle}
        className="flex w-full items-center gap-1.5 px-4 py-2 text-[10px] uppercase tracking-wide text-ink-dim hover:text-ink"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        {labelOf(plugin.id)}
      </button>
      {open && (
        <div className="px-4 pb-3">
          {plugin instanceof TextLayer && <CustomTextField layer={plugin} />}
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
      )}
    </div>
  );
}

/**
 * The right-side controls drawer: the focused plugin's params with live value editors ONLY — this
 * panel *drives* the app. All binding work (chips, drag-to-assign, presets) lives on the assign
 * surface (the controller overlay + {@link AssignPanel}), never here.
 */
export function ControlsPanel() {
  useRaf();
  const { stage } = useLive();
  const bank = stage.banks[stage.active];

  if (!bank?.plugin) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-sm text-ink-dim/60">
        No plugin focused — load one first
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ParamSection plugin={bank.plugin} focusPart="plugin" />
        {bank.shader && (
          <>
            <div className="mx-4 border-t border-edge/40" />
            <ParamSection plugin={bank.shader} focusPart="shader" />
          </>
        )}
      </div>
      {isAdmin() && <AdminDefaults managed={stage.managed()!} />}
    </div>
  );
}

/**
 * Freeform text for the Text layer: type anything and it replaces the preset list until the field
 * is cleared. Non-persistent by design — it lives on the layer instance only, so reloading the
 * plugin, restoring a scene or resetting the exhibition brings the presets back.
 */
function CustomTextField({ layer }: { layer: TextLayer }) {
  const [value, setValue] = useState(layer.customText);
  // A different Text instance (other bank, freshly loaded) carries its own text.
  useEffect(() => setValue(layer.customText), [layer]);
  return (
    <div className="mb-4 flex flex-col gap-1">
      <span className="text-xs text-ink-dim">text override</span>
      <textarea
        rows={2}
        value={value}
        spellCheck={false}
        placeholder={layer.preset.pick(TEXT_PRESETS as readonly string[])}
        onChange={(e) => {
          setValue(e.target.value);
          layer.customText = e.target.value;
        }}
        className="resize-none rounded border border-edge bg-transparent px-2 py-1 text-xs text-ink outline-none placeholder:text-ink-dim/50 focus:border-accent/60"
      />
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
  const name = labelOf(managed.id);
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
      <FaderVisual norm={param.norm} orient="horizontal" length={200} trackRef={trackRef} onPointerDown={onDown} />
    </div>
  );
}
