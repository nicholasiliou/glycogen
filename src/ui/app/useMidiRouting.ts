import { useEffect, useRef, useState } from "react";
import type { ControlBus } from "@/controls/ControlBus";
import type { SlotId } from "@/controls/types";
import { bindingLabel, type AppAction, type Keymap } from "@/midi/keymap";
import type { MidiManager } from "@/midi/MidiManager";
import { attachMidiRouter, type MidiActionHandlers } from "@/midi/router";
import type { ControlKind } from "@/midi/types";
import type { Stage } from "@/runtime/Stage";

/** App-level handlers the hardware router invokes (reporting is handled inside the hook). */
export type MidiRoutingHandlers = Pick<MidiActionHandlers, "step" | "run">;

export interface UseMidiRouting {
  /** MIDI learn: slot currently armed for one-shot hardware capture, or null. */
  learnSlot: SlotId | null;
  /** Arm a slot for MIDI learn — next hardware touch binds it and clears. */
  armLearn: (slot: SlotId) => void;
  /** Cancel any pending learn. */
  cancelLearn: () => void;
  /** Last routed hardware MIDI control + the param/action it hit, for the settings header readout. */
  lastMidi: { control: string; target: string } | null;
}

/**
 * Hardware MIDI → bus / app actions, through the active keymap, plus one-shot MIDI learn and the
 * "last MIDI action" readout. The router and control listener are attached once; everything that
 * changes per render (keymap, handlers, patchActive, learn state) is read through refs so the
 * once-attached closures always see fresh values.
 */
export function useMidiRouting(opts: {
  midi: MidiManager;
  bus: ControlBus;
  stage: Stage;
  activeKeymap: Keymap | null;
  patchActive: (mutate: (k: Keymap) => Keymap) => void;
  /** Fresh closures each render — step the browse dial, run an app action. */
  handlers: MidiRoutingHandlers;
  /** Bump the host's render tick (surfaces newly-seen controls in settings). */
  refresh: () => void;
}): UseMidiRouting {
  const { midi, bus, stage } = opts;
  const [learnSlot, setLearnSlot] = useState<SlotId | null>(null);
  const [lastMidi, setLastMidi] = useState<{ control: string; target: string } | null>(null);

  const learnSlotRef = useRef<SlotId | null>(null);
  learnSlotRef.current = learnSlot;
  const handlersRef = useRef(opts.handlers);
  handlersRef.current = opts.handlers;
  const keymapRef = useRef<Keymap | null>(opts.activeKeymap);
  keymapRef.current = opts.activeKeymap;
  const patchActiveRef = useRef(opts.patchActive);
  patchActiveRef.current = opts.patchActive;
  const refreshRef = useRef(opts.refresh);
  refreshRef.current = opts.refresh;

  useEffect(() => {
    void midi.enable();
    const offControl = midi.on("control", (ev) => {
      // If a slot is armed for learn, capture this hardware control and bind it immediately.
      const pending = learnSlotRef.current;
      if (pending !== null) {
        setLearnSlot(null);
        const ctl = ev.control;
        const derivedKind: ControlKind = ctl.relative ? "encoder" : ctl.continuous ? "knob" : "button";
        patchActiveRef.current((k) => ({
          ...k,
          controls: {
            ...k.controls,
            [ctl.id]: {
              controlId: ctl.id,
              name: ctl.label,
              kind: derivedKind,
              binding: { kind: "slot", slot: pending },
              disabled: false,
            },
          },
        }));
        return;
      }
      refreshRef.current(); // surface newly-seen controls in settings
    });
    const offRouter = attachMidiRouter(midi, () => keymapRef.current, bus, {
      step: (d) => handlersRef.current.step(d),
      run: (a) => handlersRef.current.run(a),
      report: (control, target) => {
        // Friendly readout: a slot resolves to the focused plugin's bound param name (or the raw
        // slot if unbound); an app action resolves to its display label.
        const slotName = stage.managed()?.params.find((p) => p.slot === target)?.name;
        const label = slotName || bindingLabel(target.includes(":") ? { kind: "slot", slot: target as SlotId } : { kind: "action", action: target as AppAction });
        setLastMidi({ control, target: label });
      },
    });
    return () => {
      offControl();
      offRouter();
    };
  }, [midi, bus, stage]);

  return {
    learnSlot,
    armLearn: (slot) => setLearnSlot((cur) => (cur === slot ? null : slot)),
    cancelLearn: () => setLearnSlot(null),
    lastMidi,
  };
}
