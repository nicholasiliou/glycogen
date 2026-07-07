import { useEffect, useMemo, useRef } from "react";
import type { ControlBus } from "@/controls/ControlBus";
import { openRemoteChannel, type RemoteMessage, type RemoteSnapshot } from "@/controls/remoteChannel";
import type { SlotId } from "@/controls/types";
import type { Stage } from "@/runtime/Stage";
import type { BankControl } from "@/ui/controller/widgets";

/**
 * Pop-out controller bridge (host side). Applies drives/fires/steps relayed from the popup onto the
 * real bus, and mirrors back a snapshot (slot labels + browse label + banks) so the popup can render
 * the surface. The host always owns state; the channel is attached once and reads fresh closures
 * through refs.
 */
export function useRemoteBridge(opts: {
  bus: ControlBus;
  stage: Stage;
  step: (delta: number) => void;
  bankControl: BankControl;
  slotLabels: Partial<Record<SlotId, string>>;
  browseLabel: string | undefined;
}): void {
  const { bus, stage, slotLabels, browseLabel } = opts;

  const stepRef = useRef(opts.step);
  stepRef.current = opts.step;
  const bankRef = useRef(opts.bankControl);
  bankRef.current = opts.bankControl;

  const banksSnap = {
    A: { loaded: stage.decks.A.banks.map((b) => !!b), active: stage.decks.A.active },
    B: { loaded: stage.decks.B.banks.map((b) => !!b), active: stage.decks.B.active },
  };
  const snapshot = useMemo<RemoteSnapshot>(
    () => ({ labels: slotLabels, browseLabel, banks: banksSnap }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(slotLabels), browseLabel, JSON.stringify(banksSnap)],
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
      else if (m.kind === "step") stepRef.current(m.delta);
      else if (m.kind === "bankSelect") bankRef.current.select(m.deck, m.bank);
      else if (m.kind === "bankClear") bankRef.current.clear(m.deck);
      else if (m.kind === "hello") chan.postMessage({ kind: "snapshot", snapshot: snapshotRef.current } satisfies RemoteMessage);
    };
    chan.addEventListener("message", onMsg);
    return () => {
      chan.removeEventListener("message", onMsg);
      chan.close();
      chanRef.current = null;
    };
  }, [bus]);

  // Broadcast a fresh snapshot whenever the labels/browse change so the popup stays in sync.
  useEffect(() => {
    chanRef.current?.postMessage({ kind: "snapshot", snapshot } satisfies RemoteMessage);
  }, [snapshot]);
}
