/**
 * Presets: named snapshots of the user-mutable tables (param bindings, hardware bindings, hardware
 * control identities), stored as rows themselves and exportable as JSON files. Loading replaces the
 * mutable tables wholesale, skipping rows whose FKs no longer resolve (a renamed plugin/param),
 * then re-runs the seed pass so locked opacity rows and layouts for uncovered plugins come back.
 */
import type { RowBase, Table } from "./engine";
import {
  actionBindings,
  hardwareBindings,
  hardwareControls,
  paramBindings,
  presets,
  sanitizePreset,
  uid,
  type PresetRow,
} from "./schema";
import { seedParamBindings } from "./seeds";

function snapshotData(): PresetRow["data"] {
  return {
    paramBindings: paramBindings.all(),
    actionBindings: actionBindings.all(),
    hardwareBindings: hardwareBindings.all(),
    hardwareControls: hardwareControls.all(),
  };
}

export function savePreset(name: string): PresetRow {
  const now = Date.now();
  return presets.insert({ id: uid(), name, createdAt: now, updatedAt: now, data: snapshotData() });
}

/** Overwrite an existing preset's snapshot with the current state. */
export function updatePreset(id: string): void {
  if (!presets.has(id)) return;
  presets.update(id, { updatedAt: Date.now(), data: snapshotData() });
}

function insertEach<Row extends RowBase>(table: Table<Row>, rows: Row[]): void {
  for (const row of rows) {
    try {
      table.insert(row);
    } catch (e) {
      console.warn(`[db.presets] skipping ${table.name}/"${row.id}": ${(e as Error).message}`);
    }
  }
}

export function applyPreset(id: string): void {
  const preset = presets.get(id);
  if (!preset) return;
  // Children first so nothing dangles while the parents swap.
  paramBindings.replaceAll([]);
  actionBindings.replaceAll([]);
  hardwareBindings.replaceAll([]);
  hardwareControls.replaceAll([]);
  insertEach(hardwareControls, preset.data.hardwareControls);
  insertEach(hardwareBindings, preset.data.hardwareBindings);
  // Actions before params: they win the widget, so conflicting param rows are skipped below.
  insertEach(actionBindings, preset.data.actionBindings);
  insertEach(paramBindings, preset.data.paramBindings);
  seedParamBindings(); // locked opacity rows + factory layouts for plugins the preset doesn't cover
}

export function deletePreset(id: string): void {
  presets.delete(id);
}

export function exportPresetJson(id: string): string | null {
  const preset = presets.get(id);
  return preset ? JSON.stringify(preset, null, 2) : null;
}

/** Parse + store an exported preset file (fresh id, so imports never collide). */
export function importPresetJson(json: string): PresetRow | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const preset = sanitizePreset(raw);
  if (!preset) return null;
  return presets.insert({ ...preset, id: uid() });
}
