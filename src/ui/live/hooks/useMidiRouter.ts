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

  useEffect(() => {
    const offs = [
      midi.on("discover", () => setMidiRev((r) => r + 1)),
      midi.on("devices", () => setMidiRev((r) => r + 1)),
      midi.on("status", () => setMidiRev((r) => r + 1)),
      midi.on("control", (e) => {
        const ctl = e.control;
        if (learnRef.current) {
          bindAssignment(ctl.id, learnRef.current.a, learnRef.current.preferKind);
          setLearn(null);
          return;
        }
        const m = activePresetRef.current?.controls[ctl.id];
        if (!m || m.disabled) return;
        if (isMomentaryAssignment(m.assignment)) {
          // CC-typed-as-button: fire on value-rising edge.
          // Note presses are handled by the trigger event below.
          if (e.kind === "cc" && ctl.value > 0) fireAssignment(m.assignment);
          return;
        }
        driveAssignment(m.assignment, { value: ctl.value, delta: ctl.delta, relative: ctl.relative });
      }),
      midi.on("trigger", (c) => {
        if (learnRef.current) {
          bindAssignment(c.id, learnRef.current.a, learnRef.current.preferKind);
          setLearn(null);
          return;
        }
        const m = activePresetRef.current?.controls[c.id];
        if (!m || m.disabled) return;
        if (isMomentaryAssignment(m.assignment)) fireAssignment(m.assignment);
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [midi, activePresetRef, driveAssignment, fireAssignment, bindAssignment, setLearn, setMidiRev]);

  return { learn, setLearn };
}
