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

const EMPTY_SNAPSHOT: LiveSnapshot = {
  types: [],
  selectedType: "",
  deckAName: null,
  deckBName: null,
  deckAStashName: null,
  deckBStashName: null,
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
      loadDeck: (d) => post({ kind: "fire", a: d === "A" ? "loadA" : "loadB" }),
      swapDeck: (d) => post({ kind: "fire", a: d === "A" ? "swapA" : "swapB" }),
      // mirrored display state:
      types: snap.types,
      selectedType: snap.selectedType,
      crossfade: snap.crossfade,
      browseMode: snap.browseMode,
      shaders: snap.shaders,
      shaderType: snap.shaderType,
      deckA: null,
      deckB: null,
      deckAStash: null,
      deckBStash: null,
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
