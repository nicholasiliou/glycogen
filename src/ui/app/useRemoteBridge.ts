import { useEffect, useMemo, useRef } from "react";
import type { ControlBus } from "@/controls/ControlBus";
import { openRemoteChannel, type RemoteMessage, type RemoteSnapshot } from "@/controls/remoteChannel";
import type { SlotId } from "@/controls/types";
import type { Stage } from "@/runtime/Stage";
import type { AssignCtxType, BankControl } from "@/ui/controller/widgets";

/**
 * Pop-out controller bridge (host side). Applies drives/fires/steps relayed from the popup onto the
 * real bus, and mirrors back a snapshot (slot labels + browse labels + banks + any pending param
 * remap) so the popup can render the surface and complete assignments. The host always owns state;
 * the channel is attached once and reads fresh closures through refs.
 */
export function useRemoteBridge(opts: {
  bus: ControlBus;
  stage: Stage;
  step: (target: "plugin" | "shader", delta: number) => void;
  bankControl: BankControl;
  slotLabels: Partial<Record<SlotId, string>>;
  browseLabels: { plugin?: string; shader?: string };
  assign: AssignCtxType;
}): void {
  const { bus, stage, slotLabels, browseLabels } = opts;

  const stepRef = useRef(opts.step);
  stepRef.current = opts.step;
  const bankRef = useRef(opts.bankControl);
  bankRef.current = opts.bankControl;
  const assignRef = useRef(opts.assign);
  assignRef.current = opts.assign;

  const banksSnap = { loaded: stage.banks.map((b) => !!b.plugin), active: stage.active };
  const assignSnap = opts.assign.pending
    ? { label: opts.assign.pending.label, widgets: Object.keys(opts.assign.pending.legal) as SlotId[] }
    : null;
  const snapshot = useMemo<RemoteSnapshot>(
    () => ({ labels: slotLabels, browseLabels, banks: banksSnap, assign: assignSnap }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(slotLabels), JSON.stringify(browseLabels), JSON.stringify(banksSnap), JSON.stringify(assignSnap)],
  );
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const chanRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    const chan = openRemoteChannel();
    chanRef.current = chan;
    if (!chan) return;
    const onMsg = (e: MessageEvent<RemoteMessage>) => {
      const m = e.data;
      if (m.kind === "drive") bus.drive(m.slot, m.input);
      else if (m.kind === "fire") bus.fire(m.slot);
      else if (m.kind === "step") stepRef.current(m.target, m.delta);
      else if (m.kind === "bankSelect") bankRef.current.select(m.bank);
      else if (m.kind === "bankClear") bankRef.current.clear();
      else if (m.kind === "assignTo") assignRef.current.assignTo(m.slot);
      else if (m.kind === "assignCancel") assignRef.current.cancel();
      else if (m.kind === "hello") chan.postMessage({ kind: "snapshot", snapshot: snapshotRef.current } satisfies RemoteMessage);
    };
    chan.addEventListener("message", onMsg);
    return () => {
      chan.removeEventListener("message", onMsg);
      chan.close();
      chanRef.current = null;
    };
  }, [bus]);

  // Broadcast a fresh snapshot whenever the labels/browse/assign state changes so the popup syncs.
  useEffect(() => {
    chanRef.current?.postMessage({ kind: "snapshot", snapshot } satisfies RemoteMessage);
  }, [snapshot]);
}
