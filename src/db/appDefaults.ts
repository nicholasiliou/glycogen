/**
 * Admin-authored param defaults: the values a plugin's params land on whenever it is created,
 * overriding the code-declared defaults. NOT a boot scene  -  nothing loads by itself; these fire
 * on every `create()`, so a freshly browsed plugin or shader starts from the saved look.
 *
 * Authored visually: the `#admin` URL hash unlocks a controls-panel section that snapshots the
 * FOCUSED plugin's current values into `paramDefaults` rows  -  the focused half of the bank is
 * either the generator or its shader, so plugin and shader defaults save separately. Rows live in
 * the db like every other user-mutable table (persisted, FK-pruned on boot when a plugin/param
 * disappears from code).
 */
import { ButtonParam, Param } from "@/controls/Param";
import type { Plugin } from "@/plugins/Plugin";
import { paramDefaults, paramId } from "./schema";

/** The `#admin` hash unlocks the default-saving dev surface. */
export function isAdmin(): boolean {
  return typeof window !== "undefined" && window.location.hash.startsWith("#admin");
}

/** Snapshot a live plugin's CURRENT values as its load-time defaults (one row per param). */
export function saveDefaults(plugin: Plugin): void {
  for (const p of plugin.params) {
    if (!p.name) continue;
    paramDefaults.upsert({
      id: paramId(plugin.id, p.name),
      pluginId: plugin.id,
      value: p instanceof Param ? p.value : { count: p.count, on: p.on },
    });
  }
}

/** Drop a plugin's overrides  -  back to the code-declared defaults. */
export function clearDefaults(pluginId: string): void {
  for (const row of paramDefaults.by("plugin", pluginId)) paramDefaults.delete(row.id);
}

export function hasDefaults(pluginId: string): boolean {
  return paramDefaults.by("plugin", pluginId).length > 0;
}

/** Applied by `create()` right after construction: saved defaults override the declared ones. */
export function applyDefaults(plugin: Plugin): void {
  const byName = new Map(plugin.params.map((p) => [p.name, p]));
  for (const row of paramDefaults.by("plugin", plugin.id)) {
    const p = byName.get(row.id.slice(plugin.id.length + 1));
    if (p instanceof Param && typeof row.value === "number") {
      p.set(row.value);
      p.snap(); // land instantly  -  smoothing is for live driving, not load-time defaults
    } else if (p instanceof ButtonParam && typeof row.value === "object") {
      p.count = row.value.count;
      p.on = row.value.on;
    }
  }
}
