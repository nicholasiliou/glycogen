import { useEffect, useMemo, useRef, useState } from "react";
import { ControlBus } from "@/controls/ControlBus";
import type { DriveInput, SlotId } from "@/controls/types";
import {
  openRemoteChannel,
  type RemoteMessage,
  type RemoteSnapshot,
} from "@/controls/remoteChannel";
import { Controller } from "@/ui/controller/Controller";
import {
  ArmLearnContext,
  AssignContext,
  BankControlContext,
  ControlBusContext,
  LearnSlotContext,
  SlotLabelContext,
  type AssignCtxType,
  type BankControl,
} from "@/ui/controller/widgets";

/**
 * A ControlBus stand-in for the pop-out window: it keeps a local bus so the widgets animate (glow,
 * cap positions), but every drive/fire is also relayed to the host window over the channel, where
 * the real stage applies it. `get`/`subscribe` read the local echo. There is no stage here.
 */
class RemoteBus extends ControlBus {
  constructor(private send: (m: RemoteMessage) => void) {
    super();
  }
  override drive(slot: SlotId, input: DriveInput): void {
    super.drive(slot, input); // local echo for widget feedback
    this.send({ kind: "drive", slot, input });
  }
  override fire(slot: SlotId): void {
    super.fire(slot);
    this.send({ kind: "fire", slot });
  }
}

/** The pop-out controller: renders only the surface, relaying input to the host window. */
const EMPTY_BANKS = { loaded: [], active: -1 };

export function RemoteControllerApp() {
  const [snapshot, setSnapshot] = useState<RemoteSnapshot>({ labels: {}, banks: EMPTY_BANKS });
  const chanRef = useRef<BroadcastChannel | null>(null);
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;

  const bus = useMemo(
    () => new RemoteBus((m) => chanRef.current?.postMessage(m)),
    [],
  );

  useEffect(() => {
    const chan = openRemoteChannel();
    chanRef.current = chan;
    if (!chan) return;
    const onMsg = (e: MessageEvent<RemoteMessage>) => {
      if (e.data.kind === "snapshot") setSnapshot(e.data.snapshot);
    };
    chan.addEventListener("message", onMsg);
    chan.postMessage({ kind: "hello" } satisfies RemoteMessage); // ask the host for current state
    return () => {
      chan.removeEventListener("message", onMsg);
      chan.close();
      chanRef.current = null;
    };
  }, []);

  const step = (target: "plugin" | "shader", delta: number) =>
    chanRef.current?.postMessage({ kind: "step", target, delta } satisfies RemoteMessage);

  const bankControl = useMemo<BankControl>(
    () => ({
      state: () => snapRef.current.banks,
      select: (bank) => chanRef.current?.postMessage({ kind: "bankSelect", bank } satisfies RemoteMessage),
      clear: () => chanRef.current?.postMessage({ kind: "bankClear" } satisfies RemoteMessage),
    }),
    [],
  );

  // A remap armed in the host's bindings panel: legal widgets glow here too, and clicking one
  // completes the assignment host-side. (Drag can't cross windows — click-to-assign is the path.)
  const assignCtx = useMemo<AssignCtxType>(() => {
    const a = snapshot.assign;
    return {
      pending: a
        ? { pluginId: "", paramId: "", label: a.label, legal: Object.fromEntries(a.widgets.map((w) => [w, ["remote"]])) }
        : null,
      begin: () => {},
      cancel: () => chanRef.current?.postMessage({ kind: "assignCancel" } satisfies RemoteMessage),
      assignTo: (slot) => chanRef.current?.postMessage({ kind: "assignTo", slot } satisfies RemoteMessage),
    };
  }, [snapshot.assign]);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-black text-ink">
      <ControlBusContext.Provider value={bus}>
        <BankControlContext.Provider value={bankControl}>
          <SlotLabelContext.Provider value={snapshot.labels}>
            <LearnSlotContext.Provider value={null}>
              <ArmLearnContext.Provider value={() => {}}>
                <AssignContext.Provider value={assignCtx}>
                  <Controller
                    browse={{
                      plugin: { label: snapshot.browseLabels?.plugin, onStep: (d) => step("plugin", d) },
                      shader: { label: snapshot.browseLabels?.shader, onStep: (d) => step("shader", d) },
                    }}
                  />
                </AssignContext.Provider>
              </ArmLearnContext.Provider>
            </LearnSlotContext.Provider>
          </SlotLabelContext.Provider>
        </BankControlContext.Provider>
      </ControlBusContext.Provider>
    </div>
  );
}
