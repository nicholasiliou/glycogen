import { useEffect, useRef, type MutableRefObject } from "react";
import { buildSnapshot, openLiveChannel, type LiveMessage } from "@/ui/channel/liveChannel";
import type { DeckReadout, DeckState } from "@/ui/hooks/useDeckState";
import type { ControlAssignment } from "@/midi/preset";

/** Deck state the broadcast-on-change effect reads directly (live React state, not refs). */
interface DeckLiveState {
  decks: { A: DeckState; B: DeckState };
  deckA: string | null;
  deckB: string | null;
  crossfade: number;
  browseMode: "plugin" | "shader";
  shaderType: string;
}

interface LiveChannelDeps {
  deck: DeckReadout & DeckLiveState;
  types: string[];
  selectedType: string;
  typesRef: MutableRefObject<string[]>;
  selectedTypeRef: MutableRefObject<string>;
  setSelectedType: (t: string) => void; // plain setter (doesn't need updater form)
  driveAssignment: (a: ControlAssignment, input: { value: number; delta?: number; relative?: boolean }) => void;
  fireAssignment: (a: ControlAssignment) => void;
  nameOf: (id: string | null) => string | null;
}

export function useLiveChannel({
  deck,
  types,
  selectedType,
  typesRef,
  selectedTypeRef,
  setSelectedType,
  driveAssignment,
  fireAssignment,
  nameOf,
}: LiveChannelDeps) {
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const ch = openLiveChannel();
    if (!ch) return;
    channelRef.current = ch;
    // Read from refs so the `hello` reply reflects the latest state even from outside React.
    const snapshot = () =>
      buildSnapshot(
        {
          types: typesRef.current,
          selectedType: selectedTypeRef.current,
          A: { ...deck.decksRef.current.A, activeId: deck.managedId("A") },
          B: { ...deck.decksRef.current.B, activeId: deck.managedId("B") },
          crossfade: deck.crossfadeRef.current,
          browseMode: deck.browseModeRef.current,
          shaders: deck.shaders,
          shaderType: deck.shaderTypeRef.current,
        },
        nameOf,
      );
    ch.onmessage = (e: MessageEvent<LiveMessage>) => {
      const m = e.data;
      if (m.kind === "drive") driveAssignment(m.a, m.input);
      else if (m.kind === "fire") fireAssignment(m.a);
      else if (m.kind === "selectType") setSelectedType(m.type);
      else if (m.kind === "hello") ch.postMessage({ kind: "state", snapshot: snapshot() });
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, [deck, driveAssignment, fireAssignment, nameOf, typesRef, selectedTypeRef, setSelectedType]);

  // Broadcast state whenever relevant values change (reads live React state, not refs).
  useEffect(() => {
    channelRef.current?.postMessage({
      kind: "state",
      snapshot: buildSnapshot(
        {
          types,
          selectedType,
          A: { ...deck.decks.A, activeId: deck.deckA },
          B: { ...deck.decks.B, activeId: deck.deckB },
          crossfade: deck.crossfade,
          browseMode: deck.browseMode,
          shaders: deck.shaders,
          shaderType: deck.shaderType,
        },
        nameOf,
      ),
    });
  }, [types, selectedType, deck, nameOf]);
}
