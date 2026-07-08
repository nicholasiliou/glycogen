import { useEffect, useRef, useState } from "react";
import type { ControlBus } from "@/controls/ControlBus";
import type { SlotId } from "@/controls/types";
import { appActions, hardwareControls, setHardwareBinding, type AppAction } from "@/db/schema";
import type { MidiManager } from "@/midi/MidiManager";
import { attachMidiRouter, type MidiActionHandlers } from "@/midi/router";
import { defaultKindFor } from "@/midi/types";
import type { Stage } from "@/runtime/Stage";

/** App-level handlers the hardware router invokes (reporting is handled inside the hook). */
export type MidiRoutingHandlers = Pick<MidiActionHandlers, "step" | "run">;

export interface UseMidiRouting {
  /** MIDI learn: widget currently armed for one-shot hardware capture, or null. */
  learnSlot: SlotId | null;
  /** Arm a widget for MIDI learn — next hardware touch binds it and clears. */
  armLearn: (slot: SlotId) => void;
  /** Cancel any pending learn. */
  cancelLearn: () => void;
  /** Last routed hardware MIDI control + the param/action it hit, for the settings header readout. */
  lastMidi: { control: string; target: string } | null;
}

/**
 * Hardware MIDI → bus / app actions, through the binding db, plus one-shot MIDI learn and the
 * "last MIDI action" readout. The router and control listener are attached once; everything that
 * changes per render (handlers, learn state) is read through refs so the once-attached closures
 * always see fresh values. Learning writes `hardwareControls` + `hardwareBindings` rows — nothing
 * else holds mapping state.
 */
export function useMidiRouting(opts: {
  midi: MidiManager;
  bus: ControlBus;
  stage: Stage;
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
  const refreshRef = useRef(opts.refresh);
  refreshRef.current = opts.refresh;

  useEffect(() => {
    void midi.enable();
    const offControl = midi.on("control", (ev) => {
      // If a widget is armed for learn, capture this hardware control and bind it immediately.
      const pending = learnSlotRef.current;
      if (pending !== null) {
        setLearnSlot(null);
        const ctl = ev.control;
        hardwareControls.upsert({
          id: ctl.id,
          name: ctl.label,
          kind: defaultKindFor(ctl),
          disabled: false,
          deviceName: ctl.deviceName,
        });
        setHardwareBinding(ctl.id, { type: "widget", widgetId: pending });
        return;
      }
      refreshRef.current(); // surface newly-seen controls in settings
    });
    const offRouter = attachMidiRouter(midi, bus, {
      step: (d) => handlersRef.current.step(d),
      run: (a) => handlersRef.current.run(a),
      report: (control, target) => {
        // Friendly readout: a widget resolves to the focused plugin's bound param name (or the raw
        // widget id if unbound); an app action resolves to its display label.
        const isWidget = target.includes(":");
        const slotName = isWidget ? stage.managed()?.params.find((p) => p.slot === target)?.name : undefined;
        const label = slotName ?? (isWidget ? target : (appActions.get(target as AppAction)?.label ?? target));
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
