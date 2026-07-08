import { useEffect, useMemo, useRef } from "react";
import type { ControlBus } from "@/controls/ControlBus";
import { openRemoteChannel, type RemoteMessage, type RemoteSnapshot } from "@/controls/remoteChannel";
import type { SlotId } from "@/controls/types";
import type { Stage } from "@/runtime/Stage";
import type { SlotAction } from "@/ui/controller/widgets";

/**
 * Pop-out controller bridge (host side). Applies drives/fires/steps relayed from the popup onto the
 * real bus, and mirrors back a snapshot (slot labels + action occupants + browse labels) so the
 * popup can render the live surface. The host always owns state; the channel is attached once and
 * reads fresh closures through refs. App functions need no messages of their own: a relayed pad
 * press lands on the host bus, where the action driver picks it up like any local press.
 */
export function useRemoteBridge(opts: {
  bus: ControlBus;
  stage: Stage;
  step: (target: "plugin" | "shader", delta: number) => void;
  slotLabels: Partial<Record<SlotId, string>>;
  slotActions: Partial<Record<SlotId, SlotAction>>;
  browseLabels: { plugin?: string; shader?: string };
}): void {
  const { bus, slotLabels, slotActions, browseLabels } = opts;

  const stepRef = useRef(opts.step);
  stepRef.current = opts.step;

  const snapshot = useMemo<RemoteSnapshot>(
    () => ({ labels: slotLabels, actions: slotActions, browseLabels }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(slotLabels), JSON.stringify(slotActions), JSON.stringify(browseLabels)],
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
      else if (m.kind === "hello") chan.postMessage({ kind: "snapshot", snapshot: snapshotRef.current } satisfies RemoteMessage);
    };
    chan.addEventListener("message", onMsg);
    return () => {
      chan.removeEventListener("message", onMsg);
      chan.close();
      chanRef.current = null;
    };
  }, [bus]);

  // Broadcast a fresh snapshot whenever the labels/actions/browse state changes so the popup syncs.
  useEffect(() => {
    chanRef.current?.postMessage({ kind: "snapshot", snapshot } satisfies RemoteMessage);
  }, [snapshot]);
}
