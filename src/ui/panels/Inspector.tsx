import { useState } from "react";
import { Clock, Diamond, FunctionSquare, Link2 } from "lucide-react";
import type { BlendMode, Layer, Property } from "@/engine";
import { useEngine, useRevision, useSelection, useTime } from "@/ui/engine/EngineProvider";
import { cn } from "@/ui/lib/cn";
import { Button } from "@/ui/components/ui/button";
import { Switch } from "@/ui/components/ui/switch";
import { Input } from "@/ui/components/ui/input";
import { Slider } from "@/ui/components/ui/slider";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import { NumberField } from "@/ui/components/controls/NumberField";
import { ColorField } from "@/ui/components/controls/ColorField";
import { PointField } from "@/ui/components/controls/PointField";
import { Vec3Field } from "@/ui/components/controls/Vec3Field";
import { LayerIcon } from "@/ui/components/LayerIcon";
import { CUSTOM_INSPECTORS } from "@/ui/inspectors/registry";

const BLEND_MODES: BlendMode[] = ["normal", "add", "multiply", "screen", "overlay", "lighten", "darken", "difference"];

export function Inspector() {
  const engine = useEngine();
  useRevision();
  const selection = useSelection();
  const { time } = useTime();
  const layers = engine.selectedLayers;

  if (layers.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader title="Inspector" />
        <div className="flex flex-1 items-center justify-center p-4 text-center text-[11px] text-ink-dim">
          Select a layer to edit its properties.
        </div>
      </div>
    );
  }

  const layer = layers[0];

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Inspector" subtitle={selection.length > 1 ? `${selection.length} selected` : layer.type} />
      <ScrollArea className="flex-1">
        <div className="p-2">
          <LayerHeader layer={layer} />
          <CustomInspector layer={layer} />
          <LayerSection layer={layer} />
          {layer.groups().map((g) => (
            <PropertyGroup key={g.label} label={g.label}>
              {g.props.map((p) => (
                <PropertyRow key={p.id} layer={layer} prop={p} time={time} />
              ))}
            </PropertyGroup>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function PanelHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex h-7 shrink-0 items-center justify-between border-b border-edge bg-panel px-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">{title}</span>
      {subtitle && <span className="text-[10px] text-ink-dim">{subtitle}</span>}
    </div>
  );
}

function CustomInspector({ layer }: { layer: Layer }) {
  const Comp = CUSTOM_INSPECTORS[layer.type];
  return Comp ? <Comp layer={layer} /> : null;
}

function LayerHeader({ layer }: { layer: Layer }) {
  const engine = useEngine();
  return (
    <div className="mb-2 flex items-center gap-2 rounded bg-panel-raised p-2">
      <LayerIcon name={layerIcon(engine, layer)} className="h-4 w-4 text-accent" />
      <input
        className="flex-1 bg-transparent text-sm font-medium text-ink outline-none"
        value={layer.name}
        onChange={(e) => engine.setLayerField(layer.id, "name", e.target.value)}
      />
    </div>
  );
}

function LayerSection({ layer }: { layer: Layer }) {
  const engine = useEngine();
  const showSize = layer.type === "solid";
  return (
    <PropertyGroup label="Layer" defaultOpen>
      <Field label="Blend">
        <select
          className="h-6 w-full rounded border border-edge bg-panel-raised px-1 text-xs capitalize text-ink outline-none focus:border-accent/60"
          value={layer.blendMode}
          onChange={(e) => engine.setBlendMode(layer.id, e.target.value as BlendMode)}
        >
          {BLEND_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>
      {showSize && (
        <Field label="Size">
          <PointField
            value={layer.size}
            onChange={([w, h]) => {
              const prev = layer.size;
              engine.history.execute({
                label: "Resize layer",
                coalesceKey: `size:${layer.id}`,
                do: () => (layer.size = [w, h]),
                undo: () => (layer.size = prev),
              });
            }}
          />
        </Field>
      )}
      <Field label="In / Out">
        <div className="grid grid-cols-2 gap-1">
          <NumberField
            value={layer.inPoint}
            step={0.1}
            min={0}
            onChange={(v) => engine.setLayerField(layer.id, "inPoint", v)}
          />
          <NumberField
            value={isFinite(layer.outPoint) ? layer.outPoint : engine.comp.duration}
            step={0.1}
            min={0}
            onChange={(v) => engine.setLayerField(layer.id, "outPoint", v)}
          />
        </div>
      </Field>
    </PropertyGroup>
  );
}

function PropertyGroup({
  label,
  children,
  defaultOpen = true,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1">
      <button
        className="flex w-full items-center gap-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-dim hover:text-ink"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={cn("transition-transform", open ? "rotate-90" : "")}>▸</span>
        {label}
      </button>
      {open && <div className="space-y-1 pl-1">{children}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] items-center gap-2">
      <span className="truncate text-[11px] text-ink-dim" title={label}>
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function PropertyRow({ layer, prop, time }: { layer: Layer; prop: Property; time: number }) {
  const engine = useEngine();
  const [exprOpen, setExprOpen] = useState(false);

  const animated = prop.isAnimated;
  const hasExpr = prop.hasExpression;
  const keyAtTime = animated ? prop.keyframeAt(time) : undefined;
  const base = animated ? prop.valueAt(time) : prop.value;
  const set = (v: any) => engine.setPropertyValue(layer.id, prop.id, v, true);

  return (
    <div className="rounded hover:bg-panel-raised/40">
      <div className="grid grid-cols-[16px_16px_72px_1fr_16px] items-center gap-1 py-0.5">
        {prop.animatable ? (
          <button
            title="Animate (keyframe stopwatch)"
            className={cn("flex h-4 w-4 items-center justify-center", animated ? "text-accent" : "text-ink-dim hover:text-ink")}
            onClick={() => engine.toggleAnimation(layer.id, prop.id)}
          >
            <Clock className="h-3 w-3" />
          </button>
        ) : (
          <span />
        )}

        {animated ? (
          <button
            title={keyAtTime ? "Remove keyframe at playhead" : "Add keyframe at playhead"}
            className={cn("flex h-4 w-4 items-center justify-center", keyAtTime ? "text-accent" : "text-ink-dim hover:text-ink")}
            onClick={() =>
              keyAtTime
                ? engine.removeKeyframe(layer.id, prop.id, keyAtTime.id)
                : engine.addKeyframe(layer.id, prop.id, time)
            }
          >
            <Diamond className={cn("h-2.5 w-2.5", keyAtTime && "fill-accent")} />
          </button>
        ) : (
          <span />
        )}

        <span className="truncate text-[11px] text-ink-dim" title={prop.name}>
          {prop.name}
        </span>

        <div className="min-w-0">
          <PropertyControl prop={prop} value={base} disabled={hasExpr} onChange={set} />
        </div>

        {prop.animatable ? (
          <button
            title="Expression / binding"
            className={cn("flex h-4 w-4 items-center justify-center", hasExpr ? "text-accent" : "text-ink-dim hover:text-ink")}
            onClick={() => setExprOpen((o) => !o)}
          >
            <FunctionSquare className="h-3 w-3" />
          </button>
        ) : (
          <span />
        )}
      </div>

      {exprOpen && <ExpressionEditor layer={layer} prop={prop} />}
    </div>
  );
}

function PropertyControl({
  prop,
  value,
  onChange,
  disabled,
}: {
  prop: Property;
  value: any;
  onChange: (v: any) => void;
  disabled?: boolean;
}) {
  const meta = prop.meta;
  switch (prop.type) {
    case "boolean":
      return <Switch checked={!!value} disabled={disabled} onCheckedChange={onChange} />;
    case "color":
      return <ColorField value={value} onChange={onChange} />;
    case "point":
      return <PointField value={value} step={meta.step} onChange={onChange} />;
    case "point3":
      return <Vec3Field value={value} step={meta.step} onChange={onChange} />;
    case "string":
      return <Input value={String(value ?? "")} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    case "select":
      return (
        <select
          className="h-6 w-full rounded border border-edge bg-panel-raised px-1 text-xs text-ink outline-none focus:border-accent/60"
          value={String(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {(meta.options ?? []).map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "trigger":
      return (
        <Button size="xs" variant="outline" onClick={() => onChange(Date.now())}>
          Trigger
        </Button>
      );
    default: {
      const bounded = meta.min !== undefined && meta.max !== undefined;
      if (bounded) {
        return (
          <div className="flex items-center gap-1.5">
            <Slider
              className="flex-1"
              min={meta.min}
              max={meta.max}
              step={meta.step ?? 0.01}
              value={[Number(value) || 0]}
              disabled={disabled}
              onValueChange={([v]) => onChange(v)}
            />
            <NumberField
              className="w-14"
              value={Number(value) || 0}
              min={meta.min}
              max={meta.max}
              step={meta.step ?? 1}
              disabled={disabled}
              onChange={onChange}
            />
          </div>
        );
      }
      return (
        <NumberField value={Number(value) || 0} min={meta.min} max={meta.max} step={meta.step ?? 1} disabled={disabled} onChange={onChange} />
      );
    }
  }
}

/** The pickwhip / expression surface — no-code bindings AND hand-written expressions
 * share one input, because a binding is just a generated expression string. */
function ExpressionEditor({ layer, prop }: { layer: Layer; prop: Property }) {
  const engine = useEngine();
  const others = engine.comp.layers.filter((l) => l.id !== layer.id);
  const expr = prop.expression ?? "";

  const presets: { label: string; expr: string }[] = [
    { label: "Mouse X", expr: "input.mouseX" },
    { label: "Mouse Y", expr: "input.mouseY" },
    { label: "Mouse Speed", expr: "input.mouseSpeed" },
    { label: "Scroll", expr: "input.scrollVelocity" },
    { label: "Wiggle", expr: "wiggle(2, 30)" },
    { label: "Time", expr: "time * 50" },
  ];

  return (
    <div className="mb-1 ml-1 space-y-1.5 rounded border border-edge bg-black/30 p-1.5">
      <div className="flex items-center gap-1 text-[10px] text-ink-dim">
        <Link2 className="h-3 w-3" /> Pickwhip
        <select
          className="h-5 flex-1 rounded border border-edge bg-panel-raised px-1 text-[11px] text-ink outline-none"
          value=""
          onChange={(e) => {
            const [lid, key] = e.target.value.split("::");
            const src = engine.comp.find(lid);
            if (src) engine.bindProperty(layer.id, prop.id, src.name, key);
          }}
        >
          <option value="">link to…</option>
          {others.map((l) => (
            <optgroup key={l.id} label={l.name}>
              {l.allProperties().map((p) => (
                <option key={p.id} value={`${l.id}::${p.key}`}>
                  {l.name}.{p.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <button
            key={p.label}
            className="rounded border border-edge px-1.5 py-0.5 text-[10px] text-ink-dim hover:border-accent/60 hover:text-ink"
            onClick={() => engine.setExpression(layer.id, prop.id, p.expr)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <textarea
        className="h-14 w-full resize-none rounded border border-edge bg-panel-raised p-1 font-mono text-[11px] text-accent outline-none focus:border-accent/60"
        placeholder="// expression — e.g. layer(&quot;Null&quot;).rotation * 2"
        value={expr}
        onChange={(e) => engine.setExpression(layer.id, prop.id, e.target.value || null)}
        spellCheck={false}
      />
      {prop.expression && (
        <button
          className="text-[10px] text-red-400 hover:underline"
          onClick={() => engine.setExpression(layer.id, prop.id, null)}
        >
          Remove expression
        </button>
      )}
    </div>
  );
}

function layerIcon(engine: ReturnType<typeof useEngine>, layer: Layer): string | undefined {
  return engine.registry.get(layer.type)?.icon;
}
