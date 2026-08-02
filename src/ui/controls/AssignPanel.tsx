import { useContext } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { GripVertical } from "lucide-react";
import {
  actionBindings,
  appActions,
  paramBindings,
  params,
  setActionBinding,
  setParamBinding,
  type AppAction,
} from "@/db/schema";
import { useTable } from "@/db/useDb";
import { labelOf } from "@/plugins/registry";
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
  const { stage, focusPart, setFocusPart, banks, activeBank } = useLive();
  const assign = useContext(AssignContext);
  const managed = stage.managed();
  const pluginId = managed?.id ?? "";
  const hasShader = !!banks[activeBank]?.shader;

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
      {/* Plugin / Shader focus toggle — swaps which half of the active bank is being assigned */}
      <div className="flex shrink-0 gap-px p-2">
        <button
          onClick={() => setFocusPart("plugin")}
          className={
            "flex-1 rounded-l py-1.5 text-xs font-medium transition-colors " +
            (focusPart === "plugin"
              ? "text-bg"
              : "bg-transparent text-ink-dim hover:text-ink")
          }
        >
          Plugin
        </button>
        <button
          onClick={() => hasShader && setFocusPart("shader")}
          disabled={!hasShader}
          className={
            "flex-1 rounded-r py-1.5 text-xs font-medium transition-colors " +
            (focusPart === "shader"
              ? "text-bg"
              : hasShader
                ? "bg-transparent text-ink-dim hover:text-ink"
                : "bg-transparent text-ink-dim/30 cursor-not-allowed")
          }
        >
          Shader
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <Section title={managed ? `Params — ${labelOf(managed.id)}` : "Params"}>
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
          ? "animate-pulse border-edge bg-accent/20 text-ink"
          : "border-edge text-ink hover:border-accent/50")
      }
    >
      <GripVertical className="h-3 w-3 shrink-0 text-ink-dim/50" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

