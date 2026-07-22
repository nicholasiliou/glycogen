import { beforeEach, describe, expect, it } from "vitest";
import { legalAdapters } from "@/controls/adapters";
import { harvestRegistrations } from "@/plugins/registry";
import { fillerBindings } from "./filler";
import {
  actionBindings,
  paramBindings,
  params,
  plugins,
  uid,
  widgets,
} from "./schema";
import { seedActionBindings, seedCodeTables, seedParamBindings } from "./seeds";

/**
 * Exhibition fillers: for a focused plugin, every otherwise-empty widget should phantom-drive one of
 * that plugin's own params so no control is dead — without ever colliding with a real binding, an
 * app action, or a reserved role.
 */
describe("fillerBindings against the real registry", () => {
  beforeEach(() => {
    const reg = harvestRegistrations();
    seedCodeTables();
    plugins.replaceAll(reg.plugins);
    params.replaceAll(reg.params);
    paramBindings.replaceAll([]);
    actionBindings.replaceAll([]);
    seedParamBindings();
    seedActionBindings();
  });

  it("never fills a reserved, action-occupied, or already-bound widget", () => {
    const actionWidgets = new Set(actionBindings.all().map((r) => r.widgetId));
    for (const plugin of plugins.all()) {
      const real = new Set(paramBindings.by("plugin", plugin.id).map((r) => r.widgetId));
      for (const filler of fillerBindings(plugin.id)) {
        const widget = widgets.get(filler.widgetId)!;
        expect(widget.reserved, `${plugin.id} → ${filler.widgetId} reserved`).toBeUndefined();
        expect(actionWidgets.has(filler.widgetId), `${plugin.id} → ${filler.widgetId} action`).toBe(false);
        expect(real.has(filler.widgetId), `${plugin.id} → ${filler.widgetId} already bound`).toBe(false);
      }
    }
  });

  it("only produces legal param→widget pairings", () => {
    for (const plugin of plugins.all()) {
      for (const filler of fillerBindings(plugin.id)) {
        const widget = widgets.get(filler.widgetId)!;
        expect(
          legalAdapters(filler.param.control, widget.kind),
          `${plugin.id}: ${filler.param.name} → ${widget.kind}`,
        ).toContain(filler.adapter.kind);
      }
    }
  });

  it("leaves no reachable widget dead for a plugin with mixed param kinds (boids)", () => {
    const actionWidgets = new Set(actionBindings.all().map((r) => r.widgetId));
    const covered = new Set([
      ...paramBindings.by("plugin", "boids").map((r) => r.widgetId),
      ...fillerBindings("boids").map((f) => f.widgetId),
    ]);
    const boidsParams = params.by("plugin", "boids");
    for (const widget of widgets.all()) {
      if (widget.reserved || actionWidgets.has(widget.id)) continue;
      // A widget is only expected to be covered if some boids param can legally drive its kind.
      const reachable = boidsParams.some((p) => legalAdapters(p.control, widget.kind).length > 0);
      if (reachable) expect(covered.has(widget.id), `boids widget ${widget.id} covered`).toBe(true);
    }
  });

  it("is deterministic across calls (stable labels vs drivers)", () => {
    const a = fillerBindings("boids").map((f) => `${f.widgetId}=${f.param.name}`);
    const b = fillerBindings("boids").map((f) => `${f.widgetId}=${f.param.name}`);
    expect(a).toEqual(b);
  });

  it("re-derives when an app action frees a widget", () => {
    const before = new Set(fillerBindings("boids").map((f) => f.widgetId));
    // pad:1 is a bank action out of the box — move it away and that widget becomes fillable.
    const row = actionBindings.all().find((r) => r.widgetId === "pad:1")!;
    actionBindings.delete(row.id);
    const after = new Set(fillerBindings("boids").map((f) => f.widgetId));
    expect(before.has("pad:1")).toBe(false);
    expect(after.has("pad:1")).toBe(true);
  });

  it("returns nothing for a plugin with no params", () => {
    plugins.insert({ id: "empty_" + uid(), label: "Empty", kind: "effect" });
    const empty = plugins.all().find((p) => p.label === "Empty")!;
    expect(fillerBindings(empty.id)).toEqual([]);
  });
});
