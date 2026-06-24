import type { Engine, Layer, PropertySchema, PropType, PropertyValue } from "@/engine";
import type { MidiControl } from "@/midi/types";

/**
 * The intuitive-mapping rule the user asked for: a **range** can only be driven by a
 * continuous control (knob/fader/jog); on/off and momentary props go to **momentary**
 * controls (buttons/pads/keys). We split the selected layer's schema and the discovered
 * MIDI controls along that same continuous/momentary line and zip them together, so the
 * map self-builds and adapts to whatever device is connected.
 */

export type BindingKind = "range" | "select" | "toggle" | "trigger";

export interface ParamBinding {
  controlId: string;
  controlLabel: string;
  layerId: string;
  propKey: string;
  propName: string;
  type: PropType;
  kind: BindingKind;
  /** Range/select-index bounds. */
  min: number;
  max: number;
  options?: { label: string; value: string | number }[];
}

const CONTINUOUS_TYPES: PropType[] = ["number", "angle", "percent"];

export function isRangeProp(s: PropertySchema): boolean {
  return CONTINUOUS_TYPES.includes(s.type);
}
export function isToggleProp(s: PropertySchema): boolean {
  return s.type === "boolean" || s.type === "trigger";
}
export function isSelectProp(s: PropertySchema): boolean {
  return s.type === "select";
}

/** Sensible numeric bounds for a schema entry (prefer declared meta, else by type). */
export function rangeOf(s: PropertySchema): [number, number] {
  if (s.meta?.min !== undefined && s.meta?.max !== undefined) return [s.meta.min, s.meta.max];
  if (s.type === "angle") return [0, 360];
  if (s.type === "percent") return [0, 1];
  return [0, 1];
}

/** Stable order so the same knob always lands on the same feature. */
function sortControls(controls: MidiControl[]): MidiControl[] {
  return [...controls].sort((a, b) => a.channel - b.channel || (a.number ?? 0) - (b.number ?? 0));
}

/**
 * Build the binding table for one layer. Continuous props (ranges + selects) are zipped onto
 * continuous controls; toggle/trigger props onto momentary controls. Excess props or controls
 * simply go unmapped (shown as such in the panel).
 */
export function autoMapLayer(
  layer: Layer,
  schema: PropertySchema[],
  controls: MidiControl[],
  reserved?: Set<string>,
): ParamBinding[] {
  const ranges = schema.filter((s) => isRangeProp(s) || isSelectProp(s) || isToggleProp(s));
  const continuousProps = ranges.filter((s) => isRangeProp(s) || isSelectProp(s));
  const toggleProps = ranges.filter((s) => isToggleProp(s));

  // Global performance controls (wheel/add/delete) are removed so they aren't double-mapped.
  const avail = reserved ? controls.filter((c) => !reserved.has(c.id)) : controls;
  const cont = sortControls(avail.filter((c) => c.continuous));
  const mom = sortControls(avail.filter((c) => !c.continuous));

  const out: ParamBinding[] = [];

  continuousProps.forEach((s, i) => {
    const ctl = cont[i];
    if (!ctl) return;
    const [min, max] = isSelectProp(s) ? [0, (s.meta?.options?.length ?? 1) - 1] : rangeOf(s);
    out.push({
      controlId: ctl.id,
      controlLabel: ctl.label,
      layerId: layer.id,
      propKey: s.key,
      propName: s.name,
      type: s.type,
      kind: isSelectProp(s) ? "select" : "range",
      min,
      max,
      options: s.meta?.options,
    });
  });

  toggleProps.forEach((s, i) => {
    const ctl = mom[i];
    if (!ctl) return;
    out.push({
      controlId: ctl.id,
      controlLabel: ctl.label,
      layerId: layer.id,
      propKey: s.key,
      propName: s.name,
      type: s.type,
      kind: s.type === "trigger" ? "trigger" : "toggle",
      min: 0,
      max: 1,
    });
  });

  return out;
}

/** Apply a continuous control's 0..1 value to its bound range/select prop. */
export function applyRange(engine: Engine, b: ParamBinding, unit: number): void {
  const layer = engine.getLayer(b.layerId);
  const prop = layer?.property(b.propKey);
  if (!prop) return;
  let value: PropertyValue;
  if (b.kind === "select" && b.options?.length) {
    const idx = Math.max(0, Math.min(b.options.length - 1, Math.round(unit * (b.options.length - 1))));
    value = b.options[idx].value;
  } else {
    value = b.min + (b.max - b.min) * unit;
  }
  engine.setPropertyValue(b.layerId, prop.id, value, true);
}

/** Apply a momentary press to its bound toggle/trigger prop. */
export function applyToggle(engine: Engine, b: ParamBinding): void {
  const layer = engine.getLayer(b.layerId);
  const prop = layer?.property(b.propKey);
  if (!prop) return;
  const cur = prop.valueAt(engine.transport.time);
  const next = typeof cur === "boolean" ? !cur : true;
  engine.setPropertyValue(b.layerId, prop.id, next);
}
