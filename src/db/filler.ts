/**
 * ── Exhibition filler bindings (never persisted) ─────────────────────────────────────────────────
 *
 * At an unattended exhibition every dead control is a moment of confusion: a visitor grabs a knob or
 * mashes a pad and nothing happens. This module computes *phantom* bindings so that, for whichever
 * plugin is currently focused, EVERY otherwise-empty widget drives one of that plugin's own params.
 *
 * These are computed on the fly, never written to the db — so they leave no junk rows, regenerate as
 * you browse plugins, and can never fight a real binding: a widget already taken by a real param
 * binding, an app action, or a reserved role is skipped. Params are reused freely to cover every
 * widget (doubling is fine, and expected — most plugins declare fewer params than there are widgets).
 *
 * The pick is deterministic per plugin (seeded from the plugin id), so the on-screen labels
 * (LiveProvider) and the live drivers (Stage) always agree, and the surface doesn't reshuffle every
 * frame.
 */
import { defaultAdapter, type AdapterSpec } from "@/controls/adapters";
import type { SlotId } from "@/controls/types";
import { actionBindings, paramBindings, params, widgets, type ParamRow } from "./schema";

/** One phantom binding: a widget pointed at a real param of the focused plugin. */
export interface FillerBinding {
  widgetId: SlotId;
  param: ParamRow;
  adapter: AdapterSpec;
}

/** A tiny deterministic PRNG (mulberry32) so a plugin's fill is stable across frames/renders. */
function seeded(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compute the phantom fillers for `pluginId`: every widget that is not reserved, not occupied by an
 * app action, and not already carrying a real param binding for this plugin gets a random legal
 * param of the plugin. Widgets with no legal param for their kind (e.g. a pad when the plugin has
 * only continuous params) are left empty — nothing to honestly do there.
 */
export function fillerBindings(pluginId: string): FillerBinding[] {
  const pluginParams = params.by("plugin", pluginId);
  if (pluginParams.length === 0) return [];

  const taken = new Set<SlotId>();
  for (const row of paramBindings.by("plugin", pluginId)) taken.add(row.widgetId);
  for (const row of actionBindings.all()) taken.add(row.widgetId);

  const rand = seeded(pluginId);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

  const out: FillerBinding[] = [];
  for (const widget of widgets.all()) {
    if (widget.reserved || taken.has(widget.id)) continue;
    // Params this widget kind can legally drive — pair each with its default adapter up front.
    const candidates: { param: ParamRow; adapter: AdapterSpec }[] = [];
    for (const param of pluginParams) {
      const adapter = defaultAdapter(param.control, widget.kind);
      if (adapter) candidates.push({ param, adapter });
    }
    if (candidates.length === 0) continue;
    const choice = pick(candidates);
    out.push({ widgetId: widget.id, param: choice.param, adapter: choice.adapter });
  }
  return out;
}
