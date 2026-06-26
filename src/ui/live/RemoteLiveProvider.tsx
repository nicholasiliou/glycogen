/**
 * Provides a `useLive()` value for the popup "digital controller" window, which has no engine of
 * its own. Every action is relayed to the host window over the BroadcastChannel; display state
 * (plugin/shader names, crossfade, browse mode) is mirrored back. Only the fields the on-screen
 * Controller surface actually reads are populated — the rest are inert stubs (the remote never
 * touches the engine/audio/preset machinery), so we cast the shim to the full context shape.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiveContext, type LiveContextValue } from "./LiveProvider";
import { openLiveChannel, type LiveMessage, type LiveSnapshot } from "./liveChannel";
import { bankAssignment, type BankIndex } from "@/midi/preset";

const EMPTY_SNAPSHOT: LiveSnapshot = {
  types: [],
  selectedType: "",
  deckAName: null,
  deckBName: null,
  deckABankNames: [null, null, null],
  deckBBankNames: [null, null, null],
  activeBankA: 0,
  activeBankB: 0,
  crossfade: 0.5,
  browseMode: "plugin",
  shaders: ["none"],
  shaderType: "none",
};

export function RemoteLiveProvider({ children }: { children: React.ReactNode }) {
  const [snap, setSnap] = useState<LiveSnapshot>(EMPTY_SNAPSHOT);
  const chRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const ch = openLiveChannel();
    if (!ch) return;
    chRef.current = ch;
    ch.onmessage = (e: MessageEvent<LiveMessage>) => {
      if (e.data.kind === "state") setSnap(e.data.snapshot);
    };
    ch.postMessage({ kind: "hello" }); // ask the host for the current state
    return () => {
      ch.close();
      chRef.current = null;
    };
  }, []);

  const post = useCallback((m: LiveMessage) => chRef.current?.postMessage(m), []);

  const value = useMemo(() => {
    const noop = () => {};
    const used = {
      // routed to the host:
      driveAssignment: (a, input) => post({ kind: "drive", a, input }),
      fireAssignment: (a) => post({ kind: "fire", a }),
      setSelectedType: (t: string) => post({ kind: "selectType", type: t }),
      setCrossfade: (x: number) => post({ kind: "drive", a: "crossfade", input: { value: x } }),
      loadBank: (d, i) => post({ kind: "fire", a: bankAssignment(d, i) }),
      selectBank: (d, i) => post({ kind: "fire", a: bankAssignment(d, i) }),
      // mirrored display state:
      types: snap.types,
      selectedType: snap.selectedType,
      crossfade: snap.crossfade,
      browseMode: snap.browseMode,
      shaders: snap.shaders,
      shaderType: snap.shaderType,
      deckA: null,
      deckB: null,
      deckBanks: { A: snap.deckABankNames, B: snap.deckBBankNames },
      activeBank: { A: snap.activeBankA as BankIndex, B: snap.activeBankB as BankIndex },
      // inert on the remote:
      controls: [],
      learn: null,
      setLearn: noop,
      setControlAssignment: noop,
      setShaderType: noop,
      toggleBrowseMode: noop,
      clearDeck: noop,
      bindAssignment: noop,
    } satisfies Partial<LiveContextValue>;
    return used as unknown as LiveContextValue;
  }, [snap, post]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
