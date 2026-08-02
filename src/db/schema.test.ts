import { beforeEach, describe, expect, it } from "vitest";
import { harvestRegistrations } from "@/plugins/registry";
import {
  actionBindings,
  paramBindings,
  paramId,
  params,
  plugins,
  setActionBinding,
  setParamBinding,
  uid,
} from "./schema";
import { seedCodeTables } from "./seeds";

/**
 * The one-occupant-per-widget rules: actionBindings is 1:1 on both sides and press-only; an action
 * on a widget evicts/blocks param bindings there, across ALL plugins.
 */
describe("actionBindings + occupancy", () => {
  beforeEach(() => {
    const reg = harvestRegistrations();
    seedCodeTables();
    plugins.replaceAll(reg.plugins);
    params.replaceAll(reg.params);
    paramBindings.replaceAll([]);
    actionBindings.replaceAll([]);
  });

  it("is unique on both widgetId and actionId", () => {
    actionBindings.insert({ id: uid(), widgetId: "pad:4", actionId: "clear" });
    expect(() => actionBindings.insert({ id: uid(), widgetId: "pad:4", actionId: "bank0" })).toThrow(/widget/);
    expect(() => actionBindings.insert({ id: uid(), widgetId: "pad:5", actionId: "clear" })).toThrow(/action/);
  });

  it("rejects non-press widgets", () => {
    expect(() => actionBindings.insert({ id: uid(), widgetId: "knob:0", actionId: "clear" })).toThrow(/press/);
    expect(() => actionBindings.insert({ id: uid(), widgetId: "fader:0", actionId: "clear" })).toThrow(/press/);
    actionBindings.insert({ id: uid(), widgetId: "button:0", actionId: "clear" }); // buttons are press  -  fine
  });

  it("setActionBinding replaces both sides and evicts params across ALL plugins", () => {
    // Two different plugins park a param on pad:4.
    setParamBinding("boids", paramId("boids", "wrap"), "pad:4");
    setParamBinding("gameOfLife", paramId("gameOfLife", "wrap"), "pad:4");
    expect(paramBindings.all().filter((r) => r.widgetId === "pad:4")).toHaveLength(2);

    setActionBinding("bank0", "pad:4");
    expect(paramBindings.all().filter((r) => r.widgetId === "pad:4")).toHaveLength(0);
    expect(actionBindings.all()).toHaveLength(1);

    // Moving the action re-homes it (old widget freed), and re-binding the widget replaces it.
    setActionBinding("bank0", "pad:5");
    expect(actionBindings.all().map((r) => r.widgetId)).toEqual(["pad:5"]);
    setActionBinding("clear", "pad:5");
    expect(actionBindings.all().map((r) => r.actionId)).toEqual(["clear"]);

    // Unbind returns the widget to params.
    setActionBinding("clear", null);
    expect(actionBindings.size).toBe(0);
    setParamBinding("boids", paramId("boids", "wrap"), "pad:5");
    expect(paramBindings.all().filter((r) => r.widgetId === "pad:5")).toHaveLength(1);
  });

  it("blocks param bindings on an action-occupied widget", () => {
    setActionBinding("clear", "pad:4");
    // The mutation bails silently (defensive)…
    setParamBinding("boids", paramId("boids", "wrap"), "pad:4");
    expect(paramBindings.all().filter((r) => r.widgetId === "pad:4")).toHaveLength(0);
    // …and the validator rejects a direct insert.
    expect(() =>
      paramBindings.insert({
        id: uid(),
        pluginId: "boids",
        widgetId: "pad:4",
        paramId: paramId("boids", "wrap"),
        adapter: { kind: "toggle" },
      }),
    ).toThrow(/occupied/);
  });
});
