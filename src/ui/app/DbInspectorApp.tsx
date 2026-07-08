import { useTable } from "@/db/useDb";
import {
  plugins,
  params,
  widgets,
  appActions,
  hardwareControls,
  hardwareBindings,
  paramBindings,
  presets,
} from "@/db/schema";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: "bold", textTransform: "uppercase", letterSpacing: 1 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function JsonTable<T extends object>({ rows }: { rows: T[] }) {
  if (!rows.length) return <p style={{ color: "#666", margin: 0 }}>— empty —</p>;
  const keys = Object.keys(rows[0]) as (keyof T)[];
  return (
    <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
      <thead>
        <tr>
          {keys.map((k) => (
            <th
              key={String(k)}
              style={{ border: "1px solid #333", padding: "3px 8px", textAlign: "left", background: "#1a1a1a", whiteSpace: "nowrap" }}
            >
              {String(k)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? "#0d0d0d" : "#111" }}>
            {keys.map((k) => {
              const v = row[k];
              const text = typeof v === "object" ? JSON.stringify(v) : String(v);
              return (
                <td key={String(k)} style={{ border: "1px solid #222", padding: "3px 8px", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={text}>
                  {text}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DbInspectorApp() {
  const pluginRows = useTable(plugins, (t) => t.all());
  const paramRows = useTable(params, (t) => t.all());
  const widgetRows = useTable(widgets, (t) => t.all());
  const appActionRows = useTable(appActions, (t) => t.all());
  const hwControlRows = useTable(hardwareControls, (t) => t.all());
  const hwBindingRows = useTable(hardwareBindings, (t) => t.all());
  const paramBindingRows = useTable(paramBindings, (t) => t.all());
  const presetRows = useTable(presets, (t) => t.all());

  return (
    <div style={{ fontFamily: "monospace", color: "#ccc", background: "#0a0a0a", height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 24, paddingBottom: 12, borderBottom: "1px solid #222" }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>DB Inspector</h1>
      </div>
      <div style={{ overflow: "auto", flex: 1, padding: 24 }}>
        <Section title={`plugins (${pluginRows.length})`}>
          <JsonTable rows={pluginRows} />
        </Section>

        <Section title={`params (${paramRows.length})`}>
          <JsonTable rows={paramRows} />
        </Section>

        <Section title={`widgets (${widgetRows.length})`}>
          <JsonTable rows={widgetRows} />
        </Section>

        <Section title={`appActions (${appActionRows.length})`}>
          <JsonTable rows={appActionRows} />
        </Section>

        <Section title={`hardwareControls (${hwControlRows.length})`}>
          <JsonTable rows={hwControlRows} />
        </Section>

        <Section title={`hardwareBindings (${hwBindingRows.length})`}>
          <JsonTable rows={hwBindingRows} />
        </Section>

        <Section title={`paramBindings (${paramBindingRows.length})`}>
          <JsonTable rows={paramBindingRows} />
        </Section>

        <Section title={`presets (${presetRows.length})`}>
          <JsonTable rows={presetRows} />
        </Section>
      </div>
    </div>
  );
}
