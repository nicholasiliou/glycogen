import { useEffect, useRef, useState } from "react";
import type { RowBase, Table } from "@/db/engine";
import {
  actionBindings,
  appActions,
  hardwareBindings,
  hardwareControls,
  paramBindings,
  paramDefaults,
  params,
  plugins,
  presets,
  widgets,
} from "@/db/schema";
import { useTable } from "@/db/useDb";
import { exportSnapshotJson } from "@/db/snapshot";
import { MidiManager } from "@/midi/MidiManager";
import { CONTROL_KINDS, type ControlKind } from "@/midi/types";

/**
 * `#db` — the binding-db dev page: every table, live, with row delete on the user-mutable ones and
 * a `kind` select on hardwareControls rows. That select is the home of the "learned a jog as a
 * knob" override (the main window's useHardwareSync projects the row back onto the MidiManager —
 * reload the app window after editing here, the two windows don't share a live db).
 */

const TABLES = {
  plugins,
  params,
  widgets,
  appActions,
  hardwareControls,
  hardwareBindings,
  paramBindings,
  actionBindings,
  paramDefaults,
  presets,
} as const;
type TableName = keyof typeof TABLES;

/** Persisted tables — the user's rows, safe to delete here. Code-sourced tables are read-only. */
const MUTABLE: TableName[] = ["hardwareControls", "hardwareBindings", "paramBindings", "actionBindings", "paramDefaults", "presets"];

function DeviceStatus() {
  const midiRef = useRef<MidiManager>();
  if (!midiRef.current) midiRef.current = new MidiManager();
  const midi = midiRef.current;
  const [, setTick] = useState(0);
  useEffect(() => {
    void midi.enable();
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [midi]);

  const devices = midi.devices();
  return (
    <span style={{ fontSize: 12, color: "#888" }}>
      MIDI:{" "}
      {midi.status === "unsupported"
        ? "unavailable"
        : midi.status === "denied"
          ? "access denied"
          : devices.length === 0
            ? "no device"
            : devices.map((d) => d.name).join(", ")}
    </span>
  );
}

/**
 * Export the whole user-mutable db as the committed baseline. Under the dev server this POSTs to the
 * `snapshot-writer` plugin, which writes `src/db/seed.snapshot.json` directly — just commit after.
 * On the static build that endpoint is absent, so it falls back to copying the JSON to the clipboard.
 */
function SnapshotExport() {
  const [status, setStatus] = useState<"written" | "copied" | null>(null);
  const flash = (s: "written" | "copied") => {
    setStatus(s);
    setTimeout(() => setStatus((cur) => (cur === s ? null : cur)), 1500);
  };
  const onClick = async () => {
    const json = exportSnapshotJson();
    try {
      const res = await fetch("/__write-snapshot", { method: "POST", body: json });
      if (res.ok) return flash("written");
    } catch {
      /* no dev endpoint (static build) — fall back to clipboard */
    }
    void navigator.clipboard?.writeText(json);
    flash("copied");
  };
  const label = status === "written" ? "written to seed file ✓" : status === "copied" ? "copied ✓" : "Export snapshot → seed file";
  return (
    <button
      onClick={() => void onClick()}
      title="Write the whole db to src/db/seed.snapshot.json (dev), or copy it to the clipboard (static build). Commit after."
      style={{ background: "#1a1a1a", color: status ? "#6c6" : "#ccc", border: "1px solid #333", borderRadius: 3, cursor: "pointer", fontSize: 12, padding: "3px 10px" }}
    >
      {label}
    </button>
  );
}

function RowGrid({ name }: { name: TableName }) {
  const table = TABLES[name] as unknown as Table<RowBase>;
  const rows = useTable(table, (t) => t.all());
  const mutable = MUTABLE.includes(name);

  if (!rows.length) return <p style={{ color: "#666", margin: 0 }}>— empty —</p>;
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];

  return (
    <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
      <thead>
        <tr>
          {keys.map((k) => (
            <th key={k} style={{ border: "1px solid #333", padding: "3px 8px", textAlign: "left", background: "#1a1a1a", whiteSpace: "nowrap" }}>
              {k}
            </th>
          ))}
          {mutable && <th style={{ border: "1px solid #333", padding: "3px 8px", background: "#1a1a1a" }} />}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.id} style={{ background: i % 2 === 0 ? "#0d0d0d" : "#111" }}>
            {keys.map((k) => {
              const v = (row as unknown as Record<string, unknown>)[k];
              // The kind-misclassification override: fix a control learned as the wrong type.
              if (name === "hardwareControls" && k === "kind") {
                return (
                  <td key={k} style={{ border: "1px solid #222", padding: "3px 8px" }}>
                    <select
                      value={String(v)}
                      onChange={(e) => hardwareControls.update(row.id, { kind: e.target.value as ControlKind })}
                      style={{ background: "#1a1a1a", color: "#ccc", border: "1px solid #333", fontSize: 12 }}
                    >
                      {CONTROL_KINDS.map((kind) => (
                        <option key={kind} value={kind}>{kind}</option>
                      ))}
                    </select>
                  </td>
                );
              }
              const text = v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
              return (
                <td key={k} style={{ border: "1px solid #222", padding: "3px 8px", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={text}>
                  {text}
                </td>
              );
            })}
            {mutable && (
              <td style={{ border: "1px solid #222", padding: "3px 8px", whiteSpace: "nowrap" }}>
                <button
                  onClick={() => table.delete(row.id)}
                  title="Delete this row (cascades to referencing rows)"
                  style={{ background: "none", border: "1px solid #533", color: "#c66", borderRadius: 3, cursor: "pointer", fontSize: 11, padding: "1px 6px" }}
                >
                  ✕
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DbPage() {
  const [tab, setTab] = useState<TableName>("plugins");
  const counts = Object.fromEntries(
    (Object.keys(TABLES) as TableName[]).map((n) => [n, (TABLES[n] as unknown as Table<RowBase>).size]),
  ) as Record<TableName, number>;

  return (
    <div style={{ fontFamily: "monospace", color: "#ccc", background: "#0a0a0a", height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 24px 12px", borderBottom: "1px solid #222", display: "flex", alignItems: "baseline", gap: 16 }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>DB</h1>
        <DeviceStatus />
        <div style={{ marginLeft: "auto" }}>
          <SnapshotExport />
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "8px 24px", borderBottom: "1px solid #222" }}>
        {(Object.keys(TABLES) as TableName[]).map((n) => (
          <button
            key={n}
            onClick={() => setTab(n)}
            style={{
              background: tab === n ? "#222" : "none",
              color: tab === n ? "#fff" : "#888",
              border: "1px solid #333",
              borderRadius: 3,
              cursor: "pointer",
              fontSize: 12,
              padding: "3px 10px",
            }}
          >
            {n} ({counts[n]})
          </button>
        ))}
      </div>
      <div style={{ overflow: "auto", flex: 1, padding: 24 }}>
        <RowGrid name={tab} />
      </div>
    </div>
  );
}
