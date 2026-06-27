/**
 * Owns the two-sided deck + bank state: which plugin layer lives in each bank, which bank is
 * active per side, and the crossfade between sides. Also owns the full-canvas shader layer and
 * the browse / shader selection state. Pure state management — no MIDI, no audio.
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Engine } from "@/engine";
import type { BankIndex, Deck } from "@/midi/preset";

export type DeckState = { banks: [string | null, string | null, string | null]; active: BankIndex };

/**
 * The deck operations the dispatch layer ({@link useAssignmentDispatch}) needs. Declaring this
 * seam explicitly — rather than passing the whole `useDeckState` return — keeps dispatch from
 * reaching into deck internals, so a rename inside the hook can't silently break dispatch.
 */
export interface DeckActions {
  managedId: (deck: Deck) => string | null;
  decksRef: React.MutableRefObject<{ A: DeckState; B: DeckState }>;
  browseModeRef: React.MutableRefObject<"plugin" | "shader">;
  setCrossfade: (x: number) => void;
  toggleBrowseMode: () => void;
  loadBank: (deck: Deck, index: BankIndex, selectedType: string) => void;
  selectBank: (deck: Deck, index: BankIndex, selectedType: string) => void;
  clearDeck: (deck: Deck) => void;
  browseStep: (dir: number, list: string[], setSelectedType: React.Dispatch<React.SetStateAction<string>>) => void;
  browseTo: (u: number, list: string[], setSelectedType: React.Dispatch<React.SetStateAction<string>>) => void;
  shaderStep: (dir: number) => void;
  shaderTo: (u: number) => void;
}

/**
 * The deck state {@link useLiveChannel} reads (via refs) to build a remote snapshot. Same intent
 * as {@link DeckActions}: name the read seam so the BroadcastChannel layer doesn't depend on the
 * deck hook's private ref layout.
 */
export interface DeckReadout {
  decksRef: React.MutableRefObject<{ A: DeckState; B: DeckState }>;
  crossfadeRef: React.MutableRefObject<number>;
  browseModeRef: React.MutableRefObject<"plugin" | "shader">;
  shaderTypeRef: React.MutableRefObject<string>;
  shaders: string[];
  managedId: (deck: Deck) => string | null;
}

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function clamp(x: number, lo: number, hi: number) {
  return x < lo ? lo : x > hi ? hi : x;
}

export function useDeckState(engine: Engine) {
  const [decks, setDecks] = useState<{ A: DeckState; B: DeckState }>({
    A: { banks: [null, null, null], active: 0 },
    B: { banks: [null, null, null], active: 0 },
  });
  const decksRef = useRef(decks);
  const crossfadeRef = useRef(0.5);
  const [crossfade, setCrossfadeState] = useState(0.5);
  const shaderLayerIdRef = useRef<string | null>(null);
  const shaderTypeRef = useRef("none");
  const [shaderType, setShaderTypeState] = useState("none");
  const [browseMode, setBrowseMode] = useState<"plugin" | "shader">("plugin");
  const browseModeRef = useRef<"plugin" | "shader">("plugin");

  const shaders = useMemo(
    () => ["none", ...engine.registry.all().filter((d) => d.kind === "effect").map((d) => d.type)],
    [engine],
  );

  const setOpacity = useCallback(
    (layerId: string | null, gain: number) => {
      if (!layerId) return;
      const layer = engine.getLayer(layerId);
      if (!layer) return;
      const op = layer.transform("opacity");
      engine.setPropertyValue(layerId, op.id, clamp(gain, 0, 1) * 100, true);
    },
    [engine],
  );

  const applyCrossfade = useCallback(
    (x: number, aId: string | null, bId: string | null) => {
      const t = clamp01(x);
      const both = !!aId && !!bId;
      if (aId) setOpacity(aId, both ? Math.cos((t * Math.PI) / 2) : 1);
      if (bId) setOpacity(bId, both ? Math.sin((t * Math.PI) / 2) : 1);
    },
    [setOpacity],
  );

  const commitDecks = useCallback((next: { A: DeckState; B: DeckState }) => {
    decksRef.current = next;
    setDecks(next);
  }, []);

  const managedId = useCallback((deck: Deck): string | null => {
    const d = decksRef.current[deck];
    return d.banks[d.active];
  }, []);

  const setCrossfade = useCallback(
    (x: number) => {
      const v = clamp01(x);
      crossfadeRef.current = v;
      setCrossfadeState(v);
      applyCrossfade(v, managedId("A"), managedId("B"));
    },
    [applyCrossfade, managedId],
  );

  const pinShader = useCallback(() => {
    const id = shaderLayerIdRef.current;
    if (id) engine.comp.moveLayer(id, 0);
  }, [engine]);

  const applyShader = useCallback(
    (type: string) => {
      const prev = shaderLayerIdRef.current;
      if (prev) {
        engine.removeLayers([prev]);
        shaderLayerIdRef.current = null;
      }
      if (type && type !== "none") {
        const layer = engine.addLayer(type, { index: 0, select: false });
        if (layer) shaderLayerIdRef.current = layer.id;
      }
      shaderTypeRef.current = type;
      setShaderTypeState(type);
    },
    [engine],
  );

  const loadBank = useCallback(
    (deck: Deck, index: BankIndex, selectedType: string) => {
      if (!selectedType) return;
      const d = decksRef.current[deck];
      const prev = d.banks[index];
      if (prev) engine.removeLayers([prev]);
      const layer = engine.addLayer(selectedType, { select: false });
      if (!layer) return;
      const banks = [...d.banks] as DeckState["banks"];
      banks[index] = layer.id;
      commitDecks({ ...decksRef.current, [deck]: { banks, active: index } });
      pinShader();
      applyCrossfade(crossfadeRef.current, managedId("A"), managedId("B"));
    },
    [engine, applyCrossfade, commitDecks, managedId, pinShader],
  );

  const selectBank = useCallback(
    (deck: Deck, index: BankIndex, selectedType: string) => {
      const d = decksRef.current[deck];
      if (d.active === index || !d.banks[index]) return loadBank(deck, index, selectedType);
      commitDecks({ ...decksRef.current, [deck]: { banks: d.banks, active: index } });
      applyCrossfade(crossfadeRef.current, managedId("A"), managedId("B"));
    },
    [loadBank, applyCrossfade, commitDecks, managedId],
  );

  const clearDeck = useCallback(
    (deck: Deck) => {
      const d = decksRef.current[deck];
      const id = d.banks[d.active];
      if (id) engine.removeLayers([id]);
      const banks = [...d.banks] as DeckState["banks"];
      banks[d.active] = null;
      commitDecks({ ...decksRef.current, [deck]: { banks, active: d.active } });
    },
    [engine, commitDecks],
  );

  const browseStep = useCallback(
    (dir: number, list: string[], setSelectedType: React.Dispatch<React.SetStateAction<string>>) => {
      setSelectedType((curr) => {
        if (!list.length) return curr;
        const i = Math.max(0, list.indexOf(curr));
        return list[(i + dir + list.length) % list.length];
      });
    },
    [],
  );

  const browseTo = useCallback(
    (u: number, list: string[], setSelectedType: React.Dispatch<React.SetStateAction<string>>) => {
      if (!list.length) return;
      setSelectedType(list[Math.round(clamp01(u) * (list.length - 1))]);
    },
    [],
  );

  const shaderStep = useCallback(
    (dir: number) => {
      const i = Math.max(0, shaders.indexOf(shaderTypeRef.current));
      applyShader(shaders[(i + dir + shaders.length) % shaders.length]);
    },
    [shaders, applyShader],
  );

  const shaderTo = useCallback(
    (u: number) => {
      if (shaders.length) applyShader(shaders[Math.round(clamp01(u) * (shaders.length - 1))]);
    },
    [shaders, applyShader],
  );

  const toggleBrowseMode = useCallback(() => {
    // Browse mode is the only momentary action backed by React state rather than an engine
    // mutation. The ref is the source of truth for the browse encoder (read synchronously in
    // driveAssignment); the state drives the UI. flushSync renders synchronously so the surface
    // updates immediately even though the call originates from a raw Web MIDI callback (outside
    // React's event system) — matching the engine-revision re-render the other buttons get.
    const next = browseModeRef.current === "plugin" ? "shader" : "plugin";
    browseModeRef.current = next;
    flushSync(() => setBrowseMode(next));
  }, []);

  return {
    decks, decksRef,
    deckA: decks.A.banks[decks.A.active],
    deckB: decks.B.banks[decks.B.active],
    managedId,
    crossfade, crossfadeRef, setCrossfade,
    shaders, shaderType, shaderTypeRef, applyShader, shaderStep, shaderTo,
    browseMode, browseModeRef, toggleBrowseMode,
    loadBank, selectBank, clearDeck,
    browseStep, browseTo,
    applyCrossfade,
  };
}
