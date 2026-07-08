import { useContext, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { GripVertical } from "lucide-react";
import {
  actionBindings,
  appActions,
  paramBindings,
  params,
  presets,
  setActionBinding,
  setParamBinding,
  type AppAction,
} from "@/db/schema";
import { applyPreset, deletePreset, exportPresetJson, importPresetJson, savePreset } from "@/db/presets";
import { useTable } from "@/db/useDb";
import { useLive } from "@/ui/app/LiveProvider";
import { ASSIGN_MIME, AssignContext, type AssignPending } from "@/ui/controller/widgets";
import { pendingForAction, pendingForParam } from "./assign";

/**
 * The assignment sidebar, shown while the controller overlay is open: the dump of *unassigned*
 * functions. Drag a row onto an overlay widget (or click the row, then click a widget) to assign —
 * the row disappears, consumed by the widget. Drag a widget's occupant back here to unbind it (it
 * reappears in the list). Presets snapshot the whole binding state.
 */
export function AssignPanel() {
  const { stage } = useLive();
  const assign = useContext(AssignContext);
  const managed = stage.managed();
  const pluginId = managed?.id ?? "";

  // Unassigned = no binding row. Locked (opacity) rows count as assigned — they never surface here.
  const pbVersion = useTable(paramBindings, (t) => t.version);
  const abVersion = useTable(actionBindings, (t) => t.version);
  const unboundParams = useTable(
    params,
    (t) => {
      const bound = new Set(paramBindings.by("plugin", pluginId).map((r) => r.paramId));
      return [...t.by("plugin", pluginId)].filter((r) => !bound.has(r.id)).sort((a, b) => a.order - b.order);
    },
    [pluginId, pbVersion],
  );
  const unboundActions = useTable(
    appActions,
    (t) => t.all().filter((a) => !actionBindings.all().some((r) => r.actionId === a.id)),
    [abVersion],
  );

  // The panel body is the unbind target: dropping a dragged occupant here returns it to the list.
  const onDrop = (e: ReactDragEvent) => {
    const raw = e.dataTransfer.getData(ASSIGN_MIME);
    if (!raw) return;
    e.preventDefault();
    try {
      const occ = JSON.parse(raw) as AssignPending;
      if (occ.type === "param") setParamBinding(occ.pluginId, occ.paramId, null);
      else setActionBinding(occ.actionId as AppAction, null);
    } catch {
      /* not ours */
    }
    assign.cancel();
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => { if (e.dataTransfer.types.includes(ASSIGN_MIME)) e.preventDefault(); }}
      onDrop={onDrop}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <Section title={managed ? `Params — ${managed.constructor.name.replace(/Layer$/, "")}` : "Params"}>
          {!managed ? (
            <Hint>No plugin focused — load one first</Hint>
          ) : unboundParams.length === 0 ? (
            <Hint>All params assigned — drag one off a widget to unbind</Hint>
          ) : (
            unboundParams.map((row) => (
              <AssignRow
                key={row.id}
                label={row.name}
                arming={assign.pending?.type === "param" && assign.pending.paramId === row.id}
                pendingOf={() => pendingForParam(row)}
              />
            ))
          )}
        </Section>
        <Section title="App">
          {unboundActions.length === 0 ? (
            <Hint>All app functions assigned</Hint>
          ) : (
            unboundActions.map((row) => (
              <AssignRow
                key={row.id}
                label={row.label}
                arming={assign.pending?.type === "action" && assign.pending.actionId === row.id}
                pendingOf={() => pendingForAction(row)}
              />
            ))
          )}
        </Section>
      </div>
      <PresetsBar />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-ink-dim">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="py-1 text-xs text-ink-dim/60">{children}</div>;
}

/** One unassigned function: whole row draggable onto the overlay; click to arm as a fallback. */
function AssignRow({ label, arming, pendingOf }: { label: string; arming: boolean; pendingOf: () => AssignPending }) {
  const assign = useContext(AssignContext);
  return (
    <button
      draggable
      onDragStart={(e) => {
        const pending = pendingOf();
        e.dataTransfer.setData(ASSIGN_MIME, JSON.stringify(pending));
        e.dataTransfer.effectAllowed = "link";
        assign.begin(pending);
      }}
      onDragEnd={() => assign.cancel()}
      onClick={() => (arming ? assign.cancel() : assign.begin(pendingOf()))}
      title="Drag onto a controller widget, or click then click a widget"
      className={
        "flex w-full cursor-grab items-center gap-1.5 rounded border px-2 py-1 text-left text-xs transition-colors " +
        (arming
          ? "animate-pulse border-accent bg-accent/20 text-accent"
          : "border-edge text-ink hover:border-accent/50")
      }
    >
      <GripVertical className="h-3 w-3 shrink-0 text-ink-dim/50" />
      <span className="min-w-0 flex-1 truncate">{arming ? "pick a widget…" : label}</span>
    </button>
  );
}

// ── presets: snapshot / restore the whole mutable binding state ─────────────────────────────────

function PresetsBar() {
  const rows = useTable(presets, (t) => [...t.all()].sort((a, b) => b.updatedAt - a.updatedAt));
  const [selected, setSelected] = useState<string>("");
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const current = rows.find((r) => r.id === selected);

  const download = () => {
    if (!current) return;
    const json = exportPresetJson(current.id);
    if (!json) return;
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${current.name}.marathon-preset.json` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-1.5 border-t border-edge p-3 text-[11px]">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-wide text-ink-dim">Presets</span>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="min-w-0 flex-1 rounded border border-edge bg-transparent px-1 py-0.5"
        >
          <option value="">—</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <button onClick={() => current && applyPreset(current.id)} disabled={!current} className="rounded border border-edge px-1.5 py-0.5 hover:text-accent disabled:opacity-40">Load</button>
        <button onClick={download} disabled={!current} className="rounded border border-edge px-1.5 py-0.5 hover:text-accent disabled:opacity-40">Export</button>
        <button
          onClick={() => { if (current) { deletePreset(current.id); setSelected(""); } }}
          disabled={!current}
          className="rounded border border-edge px-1.5 py-0.5 text-red-400 hover:bg-red-400/10 disabled:opacity-40"
        >
          ✕
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="new preset name…"
          className="min-w-0 flex-1 rounded border border-edge bg-transparent px-1 py-0.5 placeholder:text-ink-dim/40"
        />
        <button
          onClick={() => {
            if (!name.trim()) return;
            const p = savePreset(name.trim());
            setSelected(p.id);
            setName("");
          }}
          className="rounded border border-edge px-1.5 py-0.5 hover:text-accent"
        >
          Save
        </button>
        <button onClick={() => fileRef.current?.click()} className="rounded border border-edge px-1.5 py-0.5 hover:text-accent">
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            const imported = importPresetJson(await file.text());
            if (imported) setSelected(imported.id);
          }}
        />
      </div>
    </div>
  );
}
