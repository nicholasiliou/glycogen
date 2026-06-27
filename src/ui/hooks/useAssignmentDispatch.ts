import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Engine } from "@/engine";
import {
  assignmentDeck,
  assignmentSlot,
  bankOf,
  SLOT_META,
  type ControlAssignment,
  type BankIndex,
  type Deck,
} from "@/midi/preset";
import { driveContinuousSlot, fireMomentarySlot, macroMapFor } from "@/ui/macros/macros";
import type { useDeckState } from "@/ui/hooks/useDeckState";

type DeckHandle = ReturnType<typeof useDeckState>;

export function useAssignmentDispatch(
  engine: Engine,
  deck: DeckHandle,
  selectedTypeRef: MutableRefObject<string>,
  typesRef: MutableRefObject<string[]>,
  setSelectedType: Dispatch<SetStateAction<string>>,
) {
  const lastBrowseAtRef = useRef(0);
  const pendingDriveRef = useRef<Map<ControlAssignment, { value: number; delta: number; relative: boolean }>>(new Map());
  const driveRafRef = useRef(0);

  const deckLayer = useCallback(
    (d: Deck) => {
      const id = deck.managedId(d);
      return id ? engine.getLayer(id) : null;
    },
    [engine, deck],
  );

  const applyContinuousSlot = useCallback(
    (a: ControlAssignment, input: { value: number; delta: number; relative: boolean }) => {
      const d = assignmentDeck(a);
      const slot = assignmentSlot(a);
      if (!d || !slot || !SLOT_META[slot].continuous) return;
      const layer = deckLayer(d);
      if (!layer) return;
      const schema = engine.registry.get(layer.type)?.schema ?? [];
      const macro = macroMapFor(layer.type, schema);
      const spec = macro[slot as "amount" | "evolveX" | "evolveY" | "toneX" | "toneY"];
      if (spec) driveContinuousSlot(engine, layer, schema, spec, input);
    },
    [engine, deckLayer],
  );

  const flushDrives = useCallback(() => {
    driveRafRef.current = 0;
    const pending = pendingDriveRef.current;
    pendingDriveRef.current = new Map();
    for (const [a, input] of pending) applyContinuousSlot(a, input);
  }, [applyContinuousSlot]);

  const driveAssignment = useCallback(
    (a: ControlAssignment, input: { value: number; delta?: number; relative?: boolean }) => {
      if (a === "none" || a.startsWith("placeholder")) return;
      if (a === "browse") {
        const shaderMode = deck.browseModeRef.current === "shader";
        const step = shaderMode ? deck.shaderStep : (dir: number) => deck.browseStep(dir, typesRef.current, setSelectedType);
        const seek = shaderMode ? deck.shaderTo : (u: number) => deck.browseTo(u, typesRef.current, setSelectedType);
        if (input.relative) {
          const d = input.delta ?? 0;
          if (d !== 0) {
            const now = typeof performance !== "undefined" ? performance.now() : Date.now();
            if (now - lastBrowseAtRef.current >= 60) {
              step(d > 0 ? 1 : -1);
              lastBrowseAtRef.current = now;
            }
          }
        } else {
          seek(input.value);
        }
        return;
      }
      if (a === "crossfade") {
        deck.setCrossfade(1 - input.value);
        return;
      }
      const d = assignmentDeck(a);
      const slot = assignmentSlot(a);
      if (!d || !slot || !SLOT_META[slot].continuous) return;
      const prev = pendingDriveRef.current.get(a);
      if (input.relative) {
        pendingDriveRef.current.set(a, {
          value: input.value,
          delta: (prev?.delta ?? 0) + (input.delta ?? 0),
          relative: true,
        });
      } else {
        pendingDriveRef.current.set(a, { value: input.value, delta: 0, relative: false });
      }
      if (typeof requestAnimationFrame === "undefined") {
        flushDrives();
      } else if (!driveRafRef.current) {
        driveRafRef.current = requestAnimationFrame(flushDrives);
      }
    },
    [deck, flushDrives, typesRef, setSelectedType],
  );

  const fireAssignment = useCallback(
    (a: ControlAssignment) => {
      if (a === "none" || a.startsWith("placeholder")) return;
      const bank = bankOf(a);
      if (bank) return deck.selectBank(bank.deck, bank.index, selectedTypeRef.current);
      if (a === "loadA") return deck.loadBank("A", deck.decksRef.current["A"].active as BankIndex, selectedTypeRef.current);
      if (a === "loadB") return deck.loadBank("B", deck.decksRef.current["B"].active as BankIndex, selectedTypeRef.current);
      if (a === "clearA") return deck.clearDeck("A");
      if (a === "clearB") return deck.clearDeck("B");
      if (a === "browseMode") return deck.toggleBrowseMode();
      const d = assignmentDeck(a);
      const slot = assignmentSlot(a);
      if (!d || !slot || SLOT_META[slot].continuous) return;
      const layer = deckLayer(d);
      if (!layer) return;
      const schema = engine.registry.get(layer.type)?.schema ?? [];
      const macro = macroMapFor(layer.type, schema);
      const spec = macro[slot as "trigger" | "toggle"];
      if (spec) fireMomentarySlot(engine, layer, schema, slot as "trigger" | "toggle", spec);
    },
    [engine, deck, deckLayer, selectedTypeRef],
  );

  return { driveAssignment, fireAssignment, driveRafRef };
}
