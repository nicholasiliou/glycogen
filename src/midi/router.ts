import type { ControlBus } from "@/controls/ControlBus";
import { hardwareBindings, hardwareControls } from "@/db/schema";
import { defaultKindFor, type MidiControl } from "./types";
import type { MidiManager } from "./MidiManager";

export interface MidiActionHandlers {
  /** Report each routed control for the "last MIDI action" readout: the physical control's label
   *  and the widget it resolved to. Continuous moves report on every tick. */
  report?: (control: string, widgetId: string) => void;
}

/**
 * Wire hardware MIDI onto the {@link ControlBus}, through the binding db. This is the whole
 * MIDI→runtime path: every message resolves `hardwareBindings` by the control's id and drives the
 * bound widget's bus slot — everything downstream (params, app actions, browse) hangs off the bus.
 * Newly seen controls auto-register a `hardwareControls` row so they surface without a separate
 * learn step.
 *
 * Returns an unsubscribe.
 */
export function attachMidiRouter(midi: MidiManager, bus: ControlBus, handlers: MidiActionHandlers = {}): () => void {
  return midi.on("control", (ev) => {
    const ctl = ev.control;
    register(ctl);

    const row = hardwareBindings.by("control", ctl.id)[0];
    if (!row || hardwareControls.get(ctl.id)?.disabled) return;

    if (ctl.continuous) {
      const value = row.invert ? 1 - ctl.value : ctl.value;
      bus.drive(row.widgetId, { value, delta: ctl.delta, relative: ctl.relative });
      handlers.report?.(ctl.label, row.widgetId);
    } else {
      bus.drive(row.widgetId, { pressed: ctl.pressed });
      if (ctl.pressed) handlers.report?.(ctl.label, row.widgetId);
    }
  });
}

/** First sighting of a physical control becomes a db row (identity only — no binding). */
function register(ctl: MidiControl): void {
  if (hardwareControls.has(ctl.id)) return;
  hardwareControls.insert({
    id: ctl.id,
    name: ctl.label,
    kind: defaultKindFor(ctl),
    disabled: false,
    deviceName: ctl.deviceName,
  });
}
