import { useMemo, useSyncExternalStore } from "react";
import type { RowBase, Table } from "./engine";

/**
 * Subscribe a component to a db table. `selector` derives whatever the component needs; it re-runs
 * only when the table's version bumps (any mutation), so hot paths never pay for reactivity.
 *
 *   const rows = useTable(paramBindings, (t) => t.by("plugin", pluginId));
 */
export function useTable<Row extends RowBase, T>(table: Table<Row>, selector: (t: Table<Row>) => T): T {
  const version = useSyncExternalStore(
    (cb) => table.subscribe(cb),
    () => table.version,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the table's change signal
  return useMemo(() => selector(table), [table, version]);
}
