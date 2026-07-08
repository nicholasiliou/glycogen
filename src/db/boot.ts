/**
 * Boot sequence for the control-binding db. Order matters:
 *   1. re-seed the code-sourced tables from typed registrations (widgets, actions, plugins, params);
 *   2. load the user-mutable tables from localStorage, pruning rows whose FKs no longer resolve
 *      (a renamed plugin/param, a removed widget);
 *   3. materialise factory layouts for plugins the user hasn't remapped, plus the locked opacity rows.
 *
 * The plugin/param registration is passed in (harvested from one throwaway instance per plugin by
 * the registry) so this module stays free of plugin imports.
 */
import { db, params, plugins, type ParamRow, type PluginRow } from "./schema";
import { seedActionBindings, seedCodeTables, seedParamBindings } from "./seeds";

export interface CodeRegistration {
  plugins: PluginRow[];
  params: ParamRow[];
}

let booted = false;

export function bootDb(code: CodeRegistration): void {
  if (booted) return; // idempotent — StrictMode / HMR may re-run the caller
  booted = true;
  seedCodeTables();
  plugins.replaceAll(code.plugins);
  params.replaceAll(code.params);
  db.load();
  seedActionBindings(); // before params: an action on a widget blocks param rows there
  seedParamBindings();
  purgeLegacyKeys();
}

/** Superseded storage — the pre-db keymap system and the boot-scene take on app defaults. */
function purgeLegacyKeys(): void {
  try {
    localStorage.removeItem("marathon.midi.keymaps.v1");
    localStorage.removeItem("marathon.midi.activeKeymap.v1");
    localStorage.removeItem("marathon.appDefaults.plugins.v1");
    localStorage.removeItem("marathon.appDefaults.shaders.v1");
  } catch {
    /* ignore */
  }
}
