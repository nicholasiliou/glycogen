import { useContext, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Lock, RotateCcw } from "lucide-react";
import { ButtonParam, Param } from "@/controls/Param";
import { legalAdapters, type AdapterKind } from "@/controls/adapters";
import { clamp01 } from "@/controls/types";
import {
  paramBindings,
  params,
  setParamBinding,
  widgets,
  type ParamBindingRow,
  type ParamRow,
} from "@/db/schema";
import { applyPreset, deletePreset, exportPresetJson, importPresetJson, savePreset } from "@/db/presets";
import { presets } from "@/db/schema";
import { seedPluginBindings } from "@/db/seeds";
import { useTable } from "@/db/useDb";
import { useLive } from "@/ui/app/LiveProvider";
import { AssignContext, type AssignPending } from "@/ui/controller/widgets";
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

/** Everything the focused plugin's widgets could legally host this param on. */
function pendingFor(row: ParamRow): AssignPending {
  const legal: AssignPending["legal"] = {};
  for (const w of widgets.all()) {
    if (w.reserved) continue;
    const kinds = legalAdapters(row.control, w.kind);
    if (kinds.length) legal[w.id] = kinds;
  }
  return { pluginId: row.pluginId, paramId: row.id, label: row.name, legal };
}

/**
 * The db-reflecting parameter editor for the focused plugin: one row per `params` entry with a live
 * value editor and a binding chip showing which widget drives it through which adapter. Drag a chip
 * onto a controller widget (or click chip → click widget) to remap; presets snapshot/restore the
 * whole mutable state in place. This panel and the router read the same tables — there is no other
 * mapping state anywhere.
 */
export function PluginBindingsPanel() {
  useRaf();
  const { stage } = useLive();
  const managed = stage.managed();
  const pluginId = managed?.id ?? "";

  const rows = useTable(params, (t) => [...t.by("plugin", pluginId)].sort((a, b) => a.order - b.order));
  const bound = useTable(paramBindings, (t) => new Map(t.by("plugin", pluginId).map((r) => [r.paramId, r])));

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
          </span>
          <button
            onClick={() => {
              for (const r of paramBindings.by("plugin", pluginId)) if (!r.locked) paramBindings.delete(r.id);
              seedPluginBindings(pluginId);
            }}
            title="Reset this plugin's bindings to the factory layout"
            className="flex items-center gap-1 rounded border border-edge px-1.5 py-0.5 text-[10px] text-ink-dim hover:text-accent"
          >
            <RotateCcw className="h-3 w-3" /> reset
          </button>
        </div>
        <div className="space-y-3">
          {rows.map((row) => (
            <ParamRowView key={row.id} row={row} live={liveByName.get(row.name)} binding={bound.get(row.id)} />
          ))}
        </div>
      </div>
      <PresetsBar />
    </div>
  );
}

function ParamRowView({ row, live, binding }: { row: ParamRow; live?: Param | ButtonParam; binding?: ParamBindingRow }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-ink-dim">{row.name}</span>
        <BindingChip row={row} binding={binding} />
      </div>
      {live && <ValueEditor row={row} live={live} />}
    </div>
  );
}

// ── the binding chip: where the db meets the pointer ────────────────────────────────────────────

function BindingChip({ row, binding }: { row: ParamRow; binding?: ParamBindingRow }) {
  const assign = useContext(AssignContext);
  const arming = assign.pending?.paramId === row.id;
  const widget = binding ? widgets.get(binding.widgetId) : undefined;
  const adapters = binding && widget ? legalAdapters(row.control, widget.kind) : [];

  if (binding?.locked) {
    return (
      <span className="flex items-center gap-1 rounded border border-edge/60 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim/70">
        <Lock className="h-2.5 w-2.5" /> {binding.widgetId}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <button
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-marathon-param", row.id);
          e.dataTransfer.effectAllowed = "link";
          assign.begin(pendingFor(row));
        }}
        onDragEnd={() => assign.cancel()}
        onClick={() => (arming ? assign.cancel() : assign.begin(pendingFor(row)))}
        title="Drag onto a controller widget, or click then click a widget"
        className={
          "cursor-grab rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors " +
          (arming
            ? "animate-pulse border-accent bg-accent/20 text-accent"
            : binding
              ? "border-edge text-ink hover:border-accent/50"
              : "border-dashed border-edge text-ink-dim/60 hover:border-accent/50 hover:text-ink")
        }
      >
        {arming ? "pick a widget…" : (binding?.widgetId ?? "unbound")}
      </button>
      {binding && adapters.length > 1 && (
        <select
          value={binding.adapter.kind}
          onChange={(e) => paramBindings.update(binding.id, { adapter: { kind: e.target.value as AdapterKind } })}
          className="rounded border border-edge bg-transparent px-0.5 py-0.5 text-[9px] text-ink-dim"
          title="How this widget's signal drives the param"
        >
          {adapters.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      )}
      {binding && (
        <button
          onClick={() => setParamBinding(row.pluginId, row.id, null)}
          className="px-0.5 text-[10px] text-ink-dim/60 hover:text-red-400"
          title="Unbind"
        >
          ✕
        </button>
      )}
    </span>
  );
}

// ── live value editors (drive the param directly — bound or not) ────────────────────────────────

function ValueEditor({ row, live }: { row: ParamRow; live: Param | ButtonParam }) {
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

// ── presets: snapshot / restore the whole mutable state ─────────────────────────────────────────

function PresetsBar() {
  const rows = useTable(presets, (t) => [...t.all()].sort((a, b) => b.updatedAt - a.updatedAt));
  const [selected, setSelected] = useState<string>("");
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const current = rows.find((r) => r.id === selected);

  const download = () => {
    if (!current) return;
    const json = exportPresetJson(current.id);
    if (!json) return;
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${current.name}.marathon-preset.json` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-1.5 border-t border-edge p-3 text-[11px]">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-wide text-ink-dim">Presets</span>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="min-w-0 flex-1 rounded border border-edge bg-transparent px-1 py-0.5"
        >
          <option value="">—</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <button onClick={() => current && applyPreset(current.id)} disabled={!current} className="rounded border border-edge px-1.5 py-0.5 hover:text-accent disabled:opacity-40">Load</button>
        <button onClick={download} disabled={!current} className="rounded border border-edge px-1.5 py-0.5 hover:text-accent disabled:opacity-40">Export</button>
        <button
          onClick={() => { if (current) { deletePreset(current.id); setSelected(""); } }}
          disabled={!current}
          className="rounded border border-edge px-1.5 py-0.5 text-red-400 hover:bg-red-400/10 disabled:opacity-40"
        >
          ✕
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="new preset name…"
          className="min-w-0 flex-1 rounded border border-edge bg-transparent px-1 py-0.5 placeholder:text-ink-dim/40"
        />
        <button
          onClick={() => {
            if (!name.trim()) return;
            const p = savePreset(name.trim());
            setSelected(p.id);
            setName("");
          }}
          className="rounded border border-edge px-1.5 py-0.5 hover:text-accent"
        >
          Save
        </button>
        <button onClick={() => fileRef.current?.click()} className="rounded border border-edge px-1.5 py-0.5 hover:text-accent">
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const imported = importPresetJson(await file.text());
            if (imported) setSelected(imported.id);
          }}
        />
      </div>
    </div>
  );
}
