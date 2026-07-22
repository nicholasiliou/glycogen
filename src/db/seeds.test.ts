import { beforeEach, describe, expect, it, vi } from "vitest";
import { harvestRegistrations } from "@/plugins/registry";
import { actionBindings, paramBindings, paramId, params, plugins } from "./schema";
import { DEFAULT_ACTION_LAYOUT, DEFAULT_LAYOUTS, seedActionBindings, seedCodeTables, seedParamBindings } from "./seeds";

/**
 * Parity net for the M3 migration: boots the db from the real plugin registry and checks that the
 * transcribed factory layouts resolve — every layout entry must name a real param and widget and
 * carry a legal adapter (materialisation warns + skips otherwise, which this treats as a failure).
 */
describe("seedParamBindings against the real registry", () => {
  beforeEach(() => {
    const reg = harvestRegistrations();
    seedCodeTables();
    plugins.replaceAll(reg.plugins);
    params.replaceAll(reg.params);
    paramBindings.replaceAll([]);
    actionBindings.replaceAll([]);
  });

  it("materialises every DEFAULT_LAYOUTS entry without warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    seedParamBindings();
    expect(warn.mock.calls.map((c) => c.join(" "))).toEqual([]);
    warn.mockRestore();

    for (const [pluginId, layout] of Object.entries(DEFAULT_LAYOUTS)) {
      // A layout may outlive its plugin while the plugin is temporarily disabled in the registry
      // (see DISABLED in registry.ts) — the entry stays so re-enabling is one edit, so skip it here.
      if (!plugins.has(pluginId)) continue;
      const rows = paramBindings.by("plugin", pluginId);
      for (const [field, widgetId] of Object.entries(layout)) {
        const row = rows.find((r) => r.paramId === paramId(pluginId, field));
        expect(row?.widgetId, `${pluginId}.${field}`).toBe(widgetId);
      }
    }
  });

  it("ships opacity as an ordinary unbound, assignable param (no locked row)", () => {
    seedParamBindings();
    for (const plugin of plugins.all()) {
      expect(paramBindings.get(`opacity:${plugin.id}`), `no locked opacity row for ${plugin.id}`).toBeUndefined();
      const opacityId = paramId(plugin.id, "opacity");
      expect(
        paramBindings.by("plugin", plugin.id).some((r) => r.paramId === opacityId),
        `opacity for ${plugin.id} ships unbound`,
      ).toBe(false);
    }
  });

  it("covers every registered plugin with a factory layout", () => {
    // A new plugin without a DEFAULT_LAYOUTS entry still works (params exist) but ships with no
    // widget layout — flag it here so the omission is a decision, not an accident.
    for (const plugin of plugins.all()) {
      expect(DEFAULT_LAYOUTS[plugin.id], `DEFAULT_LAYOUTS["${plugin.id}"]`).toBeDefined();
    }
  });

  it("materialises the default action layout only into an empty table", () => {
    seedActionBindings();
    const placed = new Map(actionBindings.all().map((r) => [r.widgetId, r.actionId]));
    expect(Object.fromEntries(placed)).toEqual(DEFAULT_ACTION_LAYOUT);

    // user moves Clear elsewhere, then "reboots" — nothing re-materialises (the rows are theirs)
    const clear = actionBindings.all().find((r) => r.actionId === "clear")!;
    actionBindings.delete(clear.id);
    seedActionBindings();
    expect(actionBindings.all().find((r) => r.actionId === "clear")).toBeUndefined();
  });

  it("leaves user rows alone on reboot (copy-on-first-touch)", () => {
    seedParamBindings();
    // user remaps one boids row onto a widget its layout doesn't use, then "reboots"
    const row = paramBindings.by("plugin", "boids").find((r) => !r.locked)!;
    paramBindings.update(row.id, { widgetId: "fader:2" });
    seedParamBindings();
    expect(paramBindings.get(row.id)!.widgetId).toBe("fader:2");
  });
});
