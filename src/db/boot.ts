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
import committedSnapshot from "./seed.snapshot.json";
import { seedSnapshot, type DbSnapshot } from "./snapshot";

export interface CodeRegistration {
  plugins: PluginRow[];
  params: ParamRow[];
}

let booted = false;

export function bootDb(code: CodeRegistration): void {
  if (booted) return; // idempotent  -  StrictMode / HMR may re-run the caller
  booted = true;
  seedCodeTables();
  plugins.replaceAll(code.plugins);
  params.replaceAll(code.params);
  db.load(); // localStorage rows in first  -  a visitor's own tweaks win over the committed baseline
  seedSnapshot(committedSnapshot as DbSnapshot); // fill only ids localStorage didn't provide
  seedActionBindings(); // before params: an action on a widget blocks param rows there
  seedParamBindings();
}
