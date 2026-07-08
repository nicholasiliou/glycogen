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
  ControlBusContext,
  LearnSlotContext,
  SlotActionContext,
  SlotLabelContext,
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

/**
 * The pop-out controller: a live performance surface (mode `"live"` — the default — so widgets
 * drive), relaying input to the host window. Assignment happens only on the host's overlay; this
 * window renders labels/lighting from the mirrored snapshot.
 */
export function RemoteControllerApp() {
  const [snapshot, setSnapshot] = useState<RemoteSnapshot>({ labels: {}, actions: {} });
  const chanRef = useRef<BroadcastChannel | null>(null);

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

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-black text-ink">
      <ControlBusContext.Provider value={bus}>
        <SlotActionContext.Provider value={snapshot.actions}>
          <SlotLabelContext.Provider value={snapshot.labels}>
            <LearnSlotContext.Provider value={null}>
              <ArmLearnContext.Provider value={() => {}}>
                <Controller
                  browse={{
                    plugin: { label: snapshot.browseLabels?.plugin, onStep: (d) => step("plugin", d) },
                    shader: { label: snapshot.browseLabels?.shader, onStep: (d) => step("shader", d) },
                  }}
                />
              </ArmLearnContext.Provider>
            </LearnSlotContext.Provider>
          </SlotLabelContext.Provider>
        </SlotActionContext.Provider>
      </ControlBusContext.Provider>
    </div>
  );
}
