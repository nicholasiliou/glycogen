import { useMemo, useSyncExternalStore } from "react";
import type { RowBase, Table } from "./engine";

/**
 * Subscribe a component to a db table. `selector` derives whatever the component needs; it re-runs
 * when the table's version bumps (any mutation) — so hot paths never pay for reactivity — and when
 * any of `deps` change. Pass every outside value the selector closes over (a plugin id, a filter…)
 * in `deps`, exactly like a useMemo: the table version alone can't see them change.
 *
 *   const rows = useTable(paramBindings, (t) => t.by("plugin", pluginId), [pluginId]);
 */
export function useTable<Row extends RowBase, T>(
  table: Table<Row>,
  selector: (t: Table<Row>) => T,
  deps: readonly unknown[] = [],
): T {
  const version = useSyncExternalStore(
    (cb) => table.subscribe(cb),
    () => table.version,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the table's change signal
  return useMemo(() => selector(table), [table, version, ...deps]);
}
