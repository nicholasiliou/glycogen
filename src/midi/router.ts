import type { ControlBus } from "@/controls/ControlBus";
import type { AppAction, Keymap } from "./keymap";
import type { MidiManager } from "./MidiManager";

/** App-level functions the router can invoke (everything that isn't a plugin parameter). */
export interface MidiActionHandlers {
  /** Step the browse selection by a signed amount. */
  step: (delta: number) => void;
  /** Run a momentary app action (load / clear / focus / bank / browse-mode). */
  run: (action: Exclude<AppAction, "browse">) => void;
  /** Report each routed control for the "last MIDI action" readout: the physical control's label
   *  and what it resolved to (a slot id or an app action). Continuous moves report on every tick. */
  report?: (control: string, target: string) => void;
}

/**
 * Wire hardware MIDI onto the {@link ControlBus} and app actions, through the active {@link Keymap}.
 * This is the whole MIDI→runtime path now: a control bound to a slot drives that slot (the focused
 * plugin reacts); a control bound to an app action invokes the matching handler. No assignment
 * strings, no macro table. `getKeymap` is read fresh each message so swapping keymaps is live.
 *
 * Returns an unsubscribe.
 */
export function attachMidiRouter(
  midi: MidiManager,
  getKeymap: () => Keymap | null,
  bus: ControlBus,
  handlers: MidiActionHandlers,
): () => void {
  return midi.on("control", (ev) => {
    const m = getKeymap()?.controls[ev.control.id];
    if (!m || m.disabled || !m.binding) return;
    const ctl = ev.control;
    const b = m.binding;

    if (b.kind === "slot") {
      if (ctl.continuous) {
        // The physical crossfader reports its direction inverted relative to the A/B convention.
        const value = b.slot === "crossfader:0" ? 1 - ctl.value : ctl.value;
        bus.drive(b.slot, { value, delta: ctl.delta, relative: ctl.relative });
        handlers.report?.(ctl.label, b.slot);
      } else {
        bus.drive(b.slot, { pressed: ctl.pressed });
        if (ctl.pressed) handlers.report?.(ctl.label, b.slot);
      }
      return;
    }

    // app action
    if (b.action === "browse") {
      if (ctl.relative && ctl.delta) { handlers.step(Math.sign(ctl.delta)); handlers.report?.(ctl.label, "browse"); }
      else if (!ctl.continuous && ctl.pressed) { handlers.step(1); handlers.report?.(ctl.label, "browse"); }
    } else if (!ctl.continuous && ctl.pressed) {
      handlers.run(b.action);
      handlers.report?.(ctl.label, b.action);
    }
  });
}
