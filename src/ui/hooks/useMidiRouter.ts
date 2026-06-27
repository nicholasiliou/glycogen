/**
 * Subscribes to MidiManager events and routes them to driveAssignment / fireAssignment.
 * Also owns the learn-arm state (which assignment is waiting for the next hardware move).
 * Single handler per message type — no edge-detection maps, no double-fire guards.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { MidiManager } from "@/midi/MidiManager";
import type { ControlKind } from "@/midi/types";
import { isMomentaryAssignment, type ControlAssignment, type MidiPreset } from "@/midi/preset";

interface RouterDeps {
  midi: MidiManager;
  activePresetRef: RefObject<MidiPreset | null>;
  driveAssignment: (a: ControlAssignment, input: { value: number; delta?: number; relative?: boolean }) => void;
  fireAssignment: (a: ControlAssignment) => void;
  bindAssignment: (controlId: string, a: ControlAssignment, preferKind?: ControlKind) => void;
  setMidiRev: React.Dispatch<React.SetStateAction<number>>;
}

export function useMidiRouter({
  midi,
  activePresetRef,
  driveAssignment,
  fireAssignment,
  bindAssignment,
  setMidiRev,
}: RouterDeps) {
  const [learn, setLearnState] = useState<ControlAssignment | null>(null);
  const learnRef = useRef<{ a: ControlAssignment; preferKind?: ControlKind } | null>(null);

  const setLearn = useCallback((a: ControlAssignment | null, preferKind?: ControlKind) => {
    learnRef.current = a ? { a, preferKind } : null;
    setLearnState(a);
  }, []);

  // The dispatch callbacks (drive/fire/bind) are recreated on most renders because they close
  // over the deck state object. Holding them in refs lets the MIDI subscription below mount ONCE
  // and always call the latest version — otherwise the effect tears down and re-subscribes on
  // every render, and a hardware message arriving mid-churn can land on a torn-down listener (the
  // "button lights up but nothing happens" symptom for state-toggling actions like browseMode).
  const driveRef = useRef(driveAssignment);
  const fireRef = useRef(fireAssignment);
  const bindRef = useRef(bindAssignment);
  driveRef.current = driveAssignment;
  fireRef.current = fireAssignment;
  bindRef.current = bindAssignment;

  useEffect(() => {
    const offs = [
      midi.on("discover", () => setMidiRev((r) => r + 1)),
      midi.on("devices", () => setMidiRev((r) => r + 1)),
      midi.on("status", () => setMidiRev((r) => r + 1)),
      midi.on("control", (e) => {
        const ctl = e.control;
        if (learnRef.current) {
          bindRef.current(ctl.id, learnRef.current.a, learnRef.current.preferKind);
          setLearn(null);
          return;
        }
        const m = activePresetRef.current?.controls[ctl.id];
        if (!m || m.disabled) return;
        if (isMomentaryAssignment(m.assignment)) {
          // A CC used as a momentary assignment fires here on the value-rising edge, BUT only
          // when the control has NOT been overridden as kind="button". An overridden button
          // generates a "trigger" event (handled below) so firing here too would double-fire
          // and cancel toggling actions (e.g. browseMode flips twice, back to the original).
          // Notes are never "cc" kind so they always go through the trigger path exclusively.
          if (e.kind === "cc" && ctl.subtype !== "button" && ctl.value > 0) fireRef.current(m.assignment);
          return;
        }
        driveRef.current(m.assignment, { value: ctl.value, delta: ctl.delta, relative: ctl.relative });
      }),
      midi.on("trigger", (c) => {
        if (learnRef.current) {
          bindRef.current(c.id, learnRef.current.a, learnRef.current.preferKind);
          setLearn(null);
          return;
        }
        const m = activePresetRef.current?.controls[c.id];
        if (!m || m.disabled) return;
        if (isMomentaryAssignment(m.assignment)) fireRef.current(m.assignment);
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [midi, activePresetRef, setLearn, setMidiRev]);

  return { learn, setLearn };
}
