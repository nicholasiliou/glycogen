import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Controller } from "@/ui/controller/Controller";
import { FitBox } from "@/ui/components/FitBox";
import { REMOTE_HASH } from "@/controls/remoteChannel";
import { useLive } from "@/ui/app/LiveProvider";
import {
  appActions,
  hardwareBindings,
  hardwareControls,
  setHardwareBinding,
  widgets,
  type AppAction,
  type HardwareControlRow,
  type HardwareTarget,
} from "@/db/schema";
import { useTable } from "@/db/useDb";
import { autoAssignBindings } from "@/midi/autoAssign";
import { CONTROL_KINDS, type ControlKind } from "@/midi/types";
import type { SlotId } from "@/controls/types";

export type Tab = "controller" | "hardware";

/** `tab`/`onTab` lift the active tab to the caller so it survives the dialog unmounting on close. */
export function MidiSettingsDialog({ tab: tabProp, onTab }: { tab?: Tab; onTab?: (t: Tab) => void } = {}) {
  const [tabLocal, setTabLocal] = useState<Tab>("controller");
  const tab = tabProp ?? tabLocal;
  const setTab = onTab ?? setTabLocal;
  const { midi } = useLive();
  const status = midi.status;
  const devices = midi.devices();

  return (
    <div className="flex h-full flex-col">
      {/* header: device status + tab strip */}
      <div className="flex w-full flex-wrap justify-center items-center gap-x-3 gap-y-1 px-3 pt-3 pb-0">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[10px] uppercase tracking-wide text-ink-dim">Device</span>
          {status === "unsupported" ? (
            <span className="text-amber-400">Web MIDI unavailable</span>
          ) : status === "denied" ? (
            <button className="text-ink-dim hover:text-ink" onClick={() => midi.enable()}>
              Access denied — retry
            </button>
          ) : devices.length === 0 ? (
            <span className="text-ink-dim/70">No controller connected</span>
          ) : (
            devices.map((d) => (
              <span key={d.id} className="flex items-center gap-1.5 text-ink">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                {d.name}
              </span>
            ))
          )}
        </div>
        <div className="flex-1" />
        <div className="flex">
          {(["controller", "hardware"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "px-3 py-1.5 text-xs capitalize transition-colors " +
                (tab === t
                  ? "border-b-2 border-accent text-ink"
                  : "border-b-2 border-transparent text-ink-dim hover:text-ink")
              }
            >
              {t}
            </button>
          ))}
        </div>
        <button
          onClick={() => window.open(`${location.origin}${location.pathname}${REMOTE_HASH}`, "marathon-controller", "width=1100,height=620")}
          className="ml-1 flex items-center gap-1 px-2 py-1.5 text-xs text-ink-dim transition-colors hover:text-ink"
          title="Pop out the controller into a separate window"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>

      {tab === "controller" && <ControllerTab />}
      {tab === "hardware" && <HardwareTab />}
    </div>
  );
}

function ControllerTab() {
  const { selectedPlugin, selectedShader, stepPlugin, stepShader } = useLive();
  return (
    <FitBox className="flex-1 p-2">
      <Controller
        browse={{
          plugin: { label: selectedPlugin?.label, onStep: stepPlugin },
          shader: { label: selectedShader?.label, onStep: stepShader },
        }}
      />
    </FitBox>
  );
}

// ── hardware tab: the hardwareControls/hardwareBindings tables, editable inline ────────────────

/** A stable string key for a target (used as the <option> value and for equality). */
function targetKey(t: HardwareTarget | null): string {
  if (!t) return "none";
  return t.type === "widget" ? `widget:${t.widgetId}` : `action:${t.actionId}`;
}

function parseTargetKey(key: string): HardwareTarget | null {
  if (key.startsWith("widget:")) return { type: "widget", widgetId: key.slice(7) as SlotId };
  if (key.startsWith("action:")) return { type: "action", actionId: key.slice(7) as AppAction };
  return null;
}

/** Sort key so the table is stable while editing: CC, then pitch-bend, then notes; by id. */
function rankOf(id: string): [number, number, number] {
  const [t, ch, n] = id.split(":");
  const tr = t === "cc" ? 0 : t === "pb" ? 1 : 2;
  return [tr, Number(ch) || 0, Number(n) || 0];
}

function HardwareTab() {
  const { midi } = useLive();
  const rows = useTable(hardwareControls, (t) =>
    [...t.all()].sort((a, b) => {
      const ra = rankOf(a.id);
      const rb = rankOf(b.id);
      return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
    }),
  );
  const bindings = useTable(hardwareBindings, (t) => new Map(t.all().map((r) => [r.controlId, r])));

  // Grouped options: app actions first, then each widget kind.
  const groups: { label: string; options: { value: string; label: string }[] }[] = [
    { label: "—", options: [{ value: "none", label: "Unassigned" }] },
    { label: "App", options: appActions.all().map((a) => ({ value: `action:${a.id}`, label: a.label })) },
  ];
  for (const kind of ["fader", "knob", "encoder", "pad", "button", "jog"] as const) {
    const of = widgets.all().filter((w) => w.kind === kind);
    if (of.length) groups.push({ label: kind, options: of.map((w) => ({ value: `widget:${w.id}`, label: w.id })) });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3 text-[11px] text-ink">
      <div className="flex items-center justify-between border-b border-edge pb-2">
        <span className="text-[9px] uppercase tracking-wide text-ink-dim">
          Hardware — touch a control to register it
        </span>
        <button
          onClick={() => {
            for (const row of autoAssignBindings(hardwareControls.all())) setHardwareBinding(row.controlId, row.target);
          }}
          className="rounded border border-edge px-1.5 py-0.5 hover:text-accent"
          disabled={rows.length === 0}
        >
          Auto-assign
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="py-6 text-center text-ink-dim/60">Touch a control on your device…</div>
      ) : (
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {rows.map((r) => (
            <HardwareRow key={r.id} row={r} binding={bindings.get(r.id)?.target ?? null} groups={groups} lastSeen={midi.get(r.id)?.lastSeen} />
          ))}
        </div>
      )}
    </div>
  );
}

function HardwareRow({
  row,
  binding,
  groups,
  lastSeen,
}: {
  row: HardwareControlRow;
  binding: HardwareTarget | null;
  groups: { label: string; options: { value: string; label: string }[] }[];
  lastSeen?: number;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded px-1 py-0.5 ${lastSeen !== undefined && performance.now() - lastSeen < 300 ? "bg-accent/15" : ""} ${row.disabled ? "opacity-40" : ""}`}
    >
      <span className="w-20 shrink-0 truncate text-ink-dim" title={row.id}>{row.name}</span>
      <select
        value={row.kind}
        onChange={(e) => hardwareControls.update(row.id, { kind: e.target.value as ControlKind })}
        className="w-16 rounded border border-edge bg-transparent px-0.5 py-0.5 text-[10px]"
      >
        {CONTROL_KINDS.map((k) => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>
      <select
        value={targetKey(binding)}
        onChange={(e) => setHardwareBinding(row.id, parseTargetKey(e.target.value))}
        className="min-w-0 flex-1 rounded border border-edge bg-transparent px-0.5 py-0.5 text-[10px]"
      >
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        onClick={() => hardwareControls.update(row.id, { disabled: !row.disabled })}
        className="rounded border border-edge px-1 py-0.5 text-[9px] text-ink-dim hover:text-ink"
        title={row.disabled ? "Re-enable this control" : "Ignore this control (faulty / noisy)"}
      >
        {row.disabled ? "off" : "on"}
      </button>
    </div>
  );
}
