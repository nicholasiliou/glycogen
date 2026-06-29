import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Controller } from "@/ui/controller/Controller";
import { FitBox } from "@/ui/components/FitBox";
import { REMOTE_HASH } from "@/controls/remoteChannel";
import { useLive } from "@/ui/app/LiveProvider";
import {
  BINDING_GROUPS,
  bindingKey,
  parseBindingKey,
  effectiveControls,
  CONTROL_KINDS,
  type EffectiveControl,
} from "@/midi/keymap";
import type { ControlKind } from "@/midi/types";

export type Tab = "controller" | "keymap";

/** `tab`/`onTab` lift the active tab to the caller so it survives the dialog unmounting on close. */
export function MidiSettingsDialog({ tab: tabProp, onTab }: { tab?: Tab; onTab?: (t: Tab) => void } = {}) {
  const [tabLocal, setTabLocal] = useState<Tab>("controller");
  const tab = tabProp ?? tabLocal;
  const setTab = onTab ?? setTabLocal;
  const { keymap } = useLive();
  const { midi } = keymap;
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
          {(["controller", "keymap"] as Tab[]).map((t) => (
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
      {tab === "keymap" && <KeymapTab />}
    </div>
  );
}

function ControllerTab() {
  const { selected, step } = useLive();
  return (
    <FitBox className="flex-1 p-2">
      <Controller browse={{ label: selected?.label, onStep: step }} />
    </FitBox>
  );
}


function KeymapTab() {
  const { keymap } = useLive();
  const { midi } = keymap;
  const rows = effectiveControls(midi.list(), keymap.active);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3 text-[11px] text-ink">
      <KeymapHeader />
      <ControlTable
        rows={rows}
        onBind={(r, key) => keymap.bind(r.id, r.name, r.kind, parseBindingKey(key))}
        onKind={(r, kind) => keymap.bind(r.id, r.name, kind, r.binding)}
      />
    </div>
  );
}

function KeymapHeader() {
  const { keymap } = useLive();
  return (
    <div className="space-y-2 border-b border-edge pb-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-wide text-ink-dim">Keymap</span>
        <div className="flex gap-1">
          <button onClick={keymap.create} className="rounded border border-edge px-1.5 py-0.5 hover:text-accent">New</button>
          <button onClick={keymap.autoAssign} className="rounded border border-edge px-1.5 py-0.5 hover:text-accent" disabled={!keymap.active}>Auto</button>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <select
          value={keymap.activeId ?? ""}
          onChange={(e) => keymap.setActive(e.target.value || null)}
          className="min-w-0 flex-1 rounded border border-edge bg-transparent px-1 py-0.5"
        >
          <option value="">— no keymap —</option>
          {keymap.keymaps.map((k) => (
            <option key={k.id} value={k.id}>{k.name}</option>
          ))}
        </select>
        {keymap.active && (
          <>
            <input
              value={keymap.active.name}
              onChange={(e) => keymap.rename(keymap.active!.id, e.target.value)}
              className="w-28 rounded border border-edge bg-transparent px-1 py-0.5"
            />
            <button onClick={() => keymap.remove(keymap.active!.id)} className="rounded border border-edge px-1.5 py-0.5 text-red-400 hover:bg-red-400/10">✕</button>
          </>
        )}
      </div>
    </div>
  );
}

function ControlTable({
  rows,
  onBind,
  onKind,
}: {
  rows: EffectiveControl[];
  onBind: (row: EffectiveControl, bindingKey: string) => void;
  onKind: (row: EffectiveControl, kind: ControlKind) => void;
}) {
  if (rows.length === 0) {
    return <div className="py-6 text-center text-ink-dim/60">Touch a control on your device…</div>;
  }
  return (
    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
      {rows.map((r) => (
        <div
          key={r.id}
          className={`flex items-center gap-1.5 rounded px-1 py-0.5 ${r.live && performance.now() - r.live.lastSeen < 300 ? "bg-accent/15" : ""}`}
        >
          <span className="w-20 shrink-0 truncate text-ink-dim" title={r.id}>{r.name}</span>
          <select
            value={r.kind}
            onChange={(e) => onKind(r, e.target.value as ControlKind)}
            className="w-16 rounded border border-edge bg-transparent px-0.5 py-0.5 text-[10px]"
          >
            {CONTROL_KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <select
            value={bindingKey(r.binding)}
            onChange={(e) => onBind(r, e.target.value)}
            className="min-w-0 flex-1 rounded border border-edge bg-transparent px-0.5 py-0.5 text-[10px]"
          >
            {BINDING_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
