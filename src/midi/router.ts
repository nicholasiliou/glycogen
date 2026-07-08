import type { ControlBus } from "@/controls/ControlBus";
import { appActions, hardwareBindings, hardwareControls, type AppAction } from "@/db/schema";
import { defaultKindFor, type MidiControl } from "./types";
import type { MidiManager } from "./MidiManager";

/** App-level functions the router can invoke (everything that isn't a plugin parameter). */
export interface MidiActionHandlers {
  /** Step the browse selection by a signed amount. */
  step: (delta: number) => void;
  /** Run a momentary app action (load / clear / focus / bank / browse-mode). */
  run: (action: Exclude<AppAction, "browse">) => void;
  /** Report each routed control for the "last MIDI action" readout: the physical control's label
   *  and what it resolved to (a widget id or an app action). Continuous moves report on every tick. */
  report?: (control: string, target: string) => void;
}

/**
 * Wire hardware MIDI onto the {@link ControlBus} and app actions, through the binding db. This is
 * the whole MIDI→runtime path: every message resolves `hardwareBindings` by the control's id — a
 * control bound to a widget drives that widget's bus slot (the focused plugin reacts); a control
 * bound to an app action invokes the matching handler. Newly seen controls auto-register a
 * `hardwareControls` row so they surface in settings without a separate learn step.
 *
 * Returns an unsubscribe.
 */
export function attachMidiRouter(midi: MidiManager, bus: ControlBus, handlers: MidiActionHandlers): () => void {
  return midi.on("control", (ev) => {
    const ctl = ev.control;
    register(ctl);

    const row = hardwareBindings.by("control", ctl.id)[0];
    if (!row || hardwareControls.get(ctl.id)?.disabled) return;

    if (row.target.type === "widget") {
      const widgetId = row.target.widgetId;
      if (ctl.continuous) {
        const value = row.invert ? 1 - ctl.value : ctl.value;
        bus.drive(widgetId, { value, delta: ctl.delta, relative: ctl.relative });
        handlers.report?.(ctl.label, widgetId);
      } else {
        bus.drive(widgetId, { pressed: ctl.pressed });
        if (ctl.pressed) handlers.report?.(ctl.label, widgetId);
      }
      return;
    }

    const action = row.target.actionId;
    if (action === "browse") {
      if (ctl.relative && ctl.delta) { handlers.step(Math.sign(ctl.delta)); handlers.report?.(ctl.label, "browse"); }
      else if (!ctl.continuous && ctl.pressed) { handlers.step(1); handlers.report?.(ctl.label, "browse"); }
    } else if (appActions.get(action)?.momentary && !ctl.continuous && ctl.pressed) {
      handlers.run(action);
      handlers.report?.(ctl.label, action);
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
