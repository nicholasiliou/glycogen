import { useEffect, useRef, useState } from "react";
import type { ControlBus } from "@/controls/ControlBus";
import type { SlotId } from "@/controls/types";
import { actionBindings, appActions, hardwareControls, paramBindings, params, setHardwareBinding } from "@/db/schema";
import type { MidiManager } from "@/midi/MidiManager";
import { attachMidiRouter } from "@/midi/router";
import { defaultKindFor } from "@/midi/types";
import type { Stage } from "@/runtime/Stage";

export interface UseMidiRouting {
  /** MIDI learn: widget currently armed for one-shot hardware capture, or null. */
  learnSlot: SlotId | null;
  /** Arm a widget for MIDI learn — next hardware touch binds it and clears. */
  armLearn: (slot: SlotId) => void;
  /** Cancel any pending learn. */
  cancelLearn: () => void;
  /** Last routed hardware MIDI control + the param/action it hit, for the overlay header readout. */
  lastMidi: { control: string; target: string } | null;
}

/**
 * Hardware MIDI → bus, through the binding db, plus one-shot MIDI learn and the "last MIDI action"
 * readout. The router and control listener are attached once; per-render state (learn) is read
 * through refs so the once-attached closures always see fresh values. Learning writes
 * `hardwareControls` + `hardwareBindings` rows — nothing else holds mapping state.
 */
export function useMidiRouting(opts: {
  midi: MidiManager;
  bus: ControlBus;
  stage: Stage;
  /** Bump the host's render tick (surfaces newly-seen controls). */
  refresh: () => void;
}): UseMidiRouting {
  const { midi, bus, stage } = opts;
  const [learnSlot, setLearnSlot] = useState<SlotId | null>(null);
  const [lastMidi, setLastMidi] = useState<{ control: string; target: string } | null>(null);

  const learnSlotRef = useRef<SlotId | null>(null);
  learnSlotRef.current = learnSlot;
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
        setHardwareBinding(ctl.id, pending);
        return;
      }
      refreshRef.current(); // surface newly-seen controls
    });
    const offRouter = attachMidiRouter(midi, bus, {
      report: (control, widgetId) => {
        // Friendly readout: the widget's occupant — the app action sitting on it, else the focused
        // plugin's bound param name, else the raw widget id.
        const action = actionBindings.by("widget", widgetId as SlotId)[0];
        let label: string | undefined = action && appActions.get(action.actionId)?.label;
        if (!label) {
          const pluginId = stage.managed()?.id;
          const row = pluginId ? paramBindings.by("plugin", pluginId).find((r) => r.widgetId === widgetId) : undefined;
          label = (row && params.get(row.paramId)?.name) ?? widgetId;
        }
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
