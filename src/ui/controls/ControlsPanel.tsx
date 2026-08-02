import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ButtonParam, Param } from "@/controls/Param";
import { clamp01, type ControlKind } from "@/controls/types";
import { clearDefaults, hasDefaults, isAdmin, saveDefaults } from "@/db/appDefaults";
import { paramBindings, params, type ParamRow, widgets } from "@/db/schema";
import type { Plugin } from "@/plugins/Plugin";
import { TextLayer, TEXT_PRESETS } from "@/plugins/TextLayer";
import { labelOf } from "@/plugins/registry";
import { useTable } from "@/db/useDb";
import { useLive } from "@/ui/app/LiveProvider";
import { FaderVisual } from "@/ui/controller/widgets/FaderVisual";
import { dragWith } from "@/ui/controller/widgets/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/components/select";
import { Switch } from "@/ui/components/switch";

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
  // Reactive read of paramBindings version so widget-kind lookups update when bindings change.
  useTable(paramBindings, (t) => t.version);

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
          <div className="space-y-4">
            {rows.map((row) => {
              const live = liveByName.get(row.name);
              if (!live) return null;
              // Resolve the widget kind assigned to this param for this plugin.
              const binding = paramBindings.by("plugin", pluginId).find((b) => b.paramId === row.id);
              const widgetKind = binding ? widgets.get(binding.widgetId)?.kind : undefined;
              return <ValueEditor key={row.id} row={row} live={live} label={row.name} widgetKind={widgetKind} />;
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
      <span className="text-[10px] uppercase tracking-wide text-ink-dim/60">text override</span>
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
 * The `#admin` dev surface: freeze the FOCUSED plugin's current values as its load-time defaults.
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

/** Annotation row: label left, editable value right — rendered below the widget. */
function Annotation({ label, param }: { label?: string; param: Param }) {
  return (
    <div className="flex items-center justify-between px-0.5">
      <span className="min-w-0 flex-1 truncate text-[10px] uppercase tracking-wide text-ink-dim/50">{label}</span>
      <ParamValueInput param={param} />
    </div>
  );
}

export function ValueEditor({
  row,
  live,
  label,
  widgetKind,
}: {
  row: ParamRow;
  live: Param | ButtonParam;
  label?: string;
  widgetKind?: ControlKind;
}) {
  // ── continuous numeric param ──────────────────────────────────────────────
  if (live instanceof Param) {
    const widget = resolveNumericWidget(live, widgetKind);
    return (
      <div className="flex flex-col items-center gap-1.5">
        {widget}
        <Annotation label={label} param={live} />
      </div>
    );
  }

  // ── cycle param ───────────────────────────────────────────────────────────
  const cycleStates = row.control.type === "cycle" ? row.control.options : undefined;
  if (cycleStates?.length) {
    const activeIdx = live.count % cycleStates.length;
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-ink-dim/50">{label}</span>
        {cycleStates.length >= 5 ? (
          <Select
            value={String(activeIdx)}
            onValueChange={(v) => {
              const i = Number(v);
              const steps = ((i - activeIdx) + cycleStates.length) % cycleStates.length;
              if (steps > 0) live.press(steps);
            }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {cycleStates.map((opt, i) => (
                <SelectItem key={opt} value={String(i)}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex flex-wrap gap-1">
            {cycleStates.map((opt, i) => {
              const active = activeIdx === i;
              return (
                <button
                  key={opt}
                  onClick={() => {
                    const steps = ((i - activeIdx) + cycleStates.length) % cycleStates.length;
                    if (steps > 0) live.press(steps);
                  }}
                  className={
                    "rounded px-2 py-0.5 text-xs transition-colors " +
                    (active ? "border-accent bg-accent/20 text-accent" : "border-edge text-ink-dim hover:border-accent/50 hover:text-ink")
                  }
                >
                  {opt}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── toggle param → Switch ─────────────────────────────────────────────────
  if (live.intent === "toggle") {
    return (
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-ink-dim/50">{label}</span>
        <Switch checked={live.on} onCheckedChange={() => live.press()} />
      </div>
    );
  }

  // ── trigger param → FIRE button ───────────────────────────────────────────
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-wide text-ink-dim/50">{label}</span>
      <button
        onClick={() => live.press()}
        className="self-start rounded border border-edge px-3 py-1 text-xs text-ink-dim transition-colors hover:border-accent/50 hover:text-ink"
      >
        FIRE
      </button>
    </div>
  );
}

/**
 * Picks the right numeric widget based on the assigned controller widget kind.
 * Falls back to a horizontal fader when unbound or kind is "fader".
 */
function resolveNumericWidget(param: Param, kind?: ControlKind) {
  if (kind === "knob") return <ParamKnob param={param} />;
  if (kind === "encoder") return <ParamEncoder param={param} />;
  return <ParamFader param={param} />;
}

// ── numeric widget implementations ────────────────────────────────────────────────────────────

/** Horizontal skeuomorphic fader (default — same look as the controller). */
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
    <div className="w-full">
      <FaderVisual norm={param.norm} orient="horizontal" length={200} trackRef={trackRef} onPointerDown={onDown} />
    </div>
  );
}

/** Skeuomorphic knob (potentiometer: vertical drag → absolute position). */
function ParamKnob({ param, size = 40 }: { param: Param; size?: number }) {
  const angle = -135 + param.norm * 270;
  const onDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startNorm = param.norm;
    dragWith((ev) => {
      param.setNorm(clamp01(startNorm - (ev.clientY - startY) / 180));
    });
  };

  return (
    <div
      onPointerDown={onDown}
      className="relative touch-none cursor-ns-resize rounded-full"
      style={{ width: size, height: size }}
    >
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: "radial-gradient(circle at 50% 32%, #45484d 0%, #25272a 55%, #131416 100%)",
          border: "1px solid #050505",
          boxShadow: "inset 0 1px 1px rgba(255,255,255,.18), inset 0 -3px 5px rgba(0,0,0,.55), 0 1px 2px rgba(0,0,0,.6)",
        }}
      />
      <div className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
        <div className="absolute left-1/2 top-[10%] h-[32%] w-[2px] -translate-x-1/2 rounded-full bg-ink" />
      </div>
    </div>
  );
}

/** Skeuomorphic endless encoder (relative drag → nudge). */
function ParamEncoder({ param, size = 40 }: { param: Param; size?: number }) {
  const [spin, setSpin] = useState(0);
  const onDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    let lastY = e.clientY;
    dragWith((ev) => {
      const dy = lastY - ev.clientY;
      lastY = ev.clientY;
      if (dy === 0) return;
      const delta = dy / 4;
      setSpin((d) => d + delta * 18);
      param.nudge(delta);
    });
  };

  return (
    <div
      onPointerDown={onDown}
      className="relative touch-none cursor-ns-resize"
      style={{ width: size, height: size }}
    >
      <div className="absolute" style={{ inset: size * 0.08, transform: `rotate(${spin}deg)` }}>
        {Array.from({ length: 32 }).map((_, i) => (
          <div
            key={i}
            className="absolute left-1/2 top-1/2"
            style={{
              width: "2px",
              height: "6px",
              background: i % 2 ? "#555" : "transparent",
              transform: `translate(-50%, -50%) rotate(${i * 11.25}deg) translateY(${-size / 2 + 4}px)`,
            }}
          />
        ))}
      </div>
      <div
        className="absolute rounded-full"
        style={{
          inset: size * 0.14,
          background: "radial-gradient(circle at 50% 28%, #5a5d62 0%, #323438 55%, #18191b 100%)",
          border: "1px solid #111",
          boxShadow: "inset 0 2px 3px rgba(255,255,255,.18), inset 0 -4px 8px rgba(0,0,0,.6)",
        }}
      />
    </div>
  );
}

/** Inline editable number input for a Param value. Invisible border until focused. */
function ParamValueInput({ param }: { param: Param }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const formatted = param.step >= 1 ? String(Math.round(param.value)) : param.value.toFixed(2);

  const commit = (raw: string) => {
    const n = parseFloat(raw);
    if (!isNaN(n)) {
      const clamped = Math.max(param.min, Math.min(param.max, n));
      param.setNorm((clamped - param.min) / (param.max - param.min));
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        type="number"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-14 shrink-0 rounded border border-accent/60 bg-panel-raised px-1 text-right font-mono text-[10px] text-ink outline-none"
      />
    );
  }

  return (
    <button
      onClick={() => { setDraft(formatted); setEditing(true); }}
      className="w-14 shrink-0 text-right font-mono text-[10px] text-ink-dim/60 hover:text-ink-dim"
      title="Click to edit"
    >
      {formatted}
    </button>
  );
}

