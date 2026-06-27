import { useEffect, useRef, type MutableRefObject } from "react";
import { openLiveChannel, type LiveMessage, type LiveSnapshot } from "@/ui/channel/liveChannel";
import type { useDeckState } from "@/ui/hooks/useDeckState";
import type { ControlAssignment } from "@/midi/preset";

type DeckHandle = ReturnType<typeof useDeckState>;

interface LiveChannelDeps {
  deck: DeckHandle;
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
    const snapshot = (): LiveSnapshot => ({
      types: typesRef.current,
      selectedType: selectedTypeRef.current,
      deckAName: nameOf(deck.managedId("A")),
      deckBName: nameOf(deck.managedId("B")),
      deckABankNames: deck.decksRef.current.A.banks.map(nameOf),
      deckBBankNames: deck.decksRef.current.B.banks.map(nameOf),
      activeBankA: deck.decksRef.current.A.active,
      activeBankB: deck.decksRef.current.B.active,
      crossfade: deck.crossfadeRef.current,
      browseMode: deck.browseModeRef.current,
      shaders: deck.shaders,
      shaderType: deck.shaderTypeRef.current,
    });
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

  // Broadcast state whenever relevant values change.
  useEffect(() => {
    channelRef.current?.postMessage({
      kind: "state",
      snapshot: {
        types,
        selectedType,
        deckAName: nameOf(deck.deckA),
        deckBName: nameOf(deck.deckB),
        deckABankNames: deck.decks.A.banks.map(nameOf),
        deckBBankNames: deck.decks.B.banks.map(nameOf),
        activeBankA: deck.decks.A.active,
        activeBankB: deck.decks.B.active,
        crossfade: deck.crossfade,
        browseMode: deck.browseMode,
        shaders: deck.shaders,
        shaderType: deck.shaderType,
      },
    });
  }, [types, selectedType, deck, nameOf]);
}
