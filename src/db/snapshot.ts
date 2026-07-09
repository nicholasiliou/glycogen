/**
 * The committed db baseline — the authored floor the app boots from.
 *
 * Every user-mutable table persists to the *local* browser's localStorage and never rides into git,
 * so a fresh deploy (or any first-time visitor) boots with those tables empty and everything falls
 * back to code-declared defaults. This module closes that gap: a developer authors the look in the
 * `#admin` surface (which writes localStorage rows like any other mutation), exports the whole db as
 * a JSON snapshot, and commits it to `seed.snapshot.json`. At boot the snapshot seeds each table —
 * but only rows the browser's own localStorage didn't already provide, so a visitor's live tweaks
 * still win. The committed snapshot is the floor; localStorage overrides on top.
 */
import type { RowBase, Table } from "./engine";
import {
  actionBindings,
  hardwareBindings,
  hardwareControls,
  paramBindings,
  paramDefaults,
  presets,
  sanitizeActionBinding,
  sanitizeHardwareBinding,
  sanitizeHardwareControl,
  sanitizeParamBinding,
  sanitizeParamDefault,
  sanitizePreset,
  type ActionBindingRow,
  type HardwareBindingRow,
  type HardwareControlRow,
  type ParamBindingRow,
  type ParamDefaultRow,
  type PresetRow,
} from "./schema";

/** One array per user-mutable table — the full authored db, minus the code-sourced tables. */
export interface DbSnapshot {
  paramDefaults: ParamDefaultRow[];
  paramBindings: ParamBindingRow[];
  actionBindings: ActionBindingRow[];
  hardwareBindings: HardwareBindingRow[];
  hardwareControls: HardwareControlRow[];
  presets: PresetRow[];
}

export const EMPTY_SNAPSHOT: DbSnapshot = {
  paramDefaults: [],
  paramBindings: [],
  actionBindings: [],
  hardwareBindings: [],
  hardwareControls: [],
  presets: [],
};

/** The current db state, ready to serialise into the committed file. */
export function snapshotDb(): DbSnapshot {
  return {
    paramDefaults: paramDefaults.all(),
    paramBindings: paramBindings.all(),
    actionBindings: actionBindings.all(),
    hardwareBindings: hardwareBindings.all(),
    hardwareControls: hardwareControls.all(),
    presets: presets.all(),
  };
}

/** Pretty JSON of the current db — the `#admin` export action copies this into `seed.snapshot.json`. */
export function exportSnapshotJson(): string {
  return JSON.stringify(snapshotDb(), null, 2);
}

/** Insert rows the table doesn't already hold, skipping (with a warning) any that fail validation. */
function fillMissing<Row extends RowBase>(table: Table<Row>, rows: Row[]): void {
  for (const row of rows) {
    if (table.has(row.id)) continue; // localStorage already provided this row — it wins
    try {
      table.insert(row);
    } catch (e) {
      console.warn(`[db.snapshot] skipping ${table.name}/"${row.id}": ${(e as Error).message}`);
    }
  }
}

function keep<Row>(rows: unknown[], sanitize: (raw: unknown) => Row | null): Row[] {
  return rows.map(sanitize).filter((r): r is Row => !!r);
}

/**
 * Seed the committed baseline into the already-loaded tables. Runs AFTER `db.load()` so localStorage
 * rows are in first and win; parents before children so FKs resolve. Rows pass through the schema's
 * sanitizers, so a hand-edited or stale committed file can't inject malformed rows.
 */
export function seedSnapshot(snap: DbSnapshot): void {
  fillMissing(hardwareControls, keep(snap.hardwareControls, sanitizeHardwareControl));
  fillMissing(hardwareBindings, keep(snap.hardwareBindings, sanitizeHardwareBinding));
  // Actions before params: an action owns its widget, so a conflicting param row is rejected below.
  fillMissing(actionBindings, keep(snap.actionBindings, sanitizeActionBinding));
  fillMissing(paramBindings, keep(snap.paramBindings, sanitizeParamBinding));
  fillMissing(paramDefaults, keep(snap.paramDefaults, sanitizeParamDefault));
  fillMissing(presets, keep(snap.presets, sanitizePreset));
}
