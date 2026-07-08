import { slotId, type ControlKind as SlotKind, type SlotId } from "@/controls/types";
import { uid, type AppAction, type HardwareBindingRow, type HardwareControlRow, type HardwareTarget } from "@/db/schema";
import type { ControlKind } from "./types";

/**
 * Best-effort default layout for a two-deck DJ controller (e.g. Numark MixTrack): hardware controls
 * map straight onto widgets so the focused plugin's bound params respond immediately; jog wheels
 * land on the two reserved browse dials and a few buttons drive app actions (load / clear / banks).
 * Returns fresh binding rows for every control it could place — the caller replaces that control's
 * existing binding. Stable input order; the user edits inline afterwards.
 */
export function autoAssignBindings(controls: HardwareControlRow[]): HardwareBindingRow[] {
  const enabled = controls.filter((c) => !c.disabled);
  const pick = (kind: ControlKind) => enabled.filter((c) => c.kind === kind);

  const widget = (kind: SlotKind, i: number): HardwareTarget => ({ type: "widget", widgetId: slotId(kind, i) });
  const action = (a: AppAction): HardwareTarget => ({ type: "action", actionId: a });

  const out: HardwareBindingRow[] = [];
  const assign = (list: HardwareControlRow[], plan: HardwareTarget[]) =>
    list.forEach((c, i) => {
      const target = plan[i];
      if (!target) return;
      out.push({ id: uid(), controlId: c.id, target });
    });

  // Channel faders → fader widgets.
  assign(pick("fader"), [widget("fader", 0), widget("fader", 1), widget("fader", 2)]);

  // Jog wheels → the two browse dials (jog:0 sweeps plugins, jog:1 sweeps shaders).
  assign(pick("jog"), [widget("jog", 0), widget("jog", 1)]);

  // Encoders: browse first, then generic encoder widgets.
  assign(pick("encoder"), [action("browsePlugin"), action("browseShader"), widget("encoder", 0), widget("encoder", 1)]);

  // EQ knobs → knob widgets; the last one lands on the reserved opacity knob.
  assign(pick("knob"), [...Array.from({ length: 8 }, (_, i) => widget("knob", i)), widget("knob", 9)]);

  // Buttons: app actions first (load / clear / the six banks), then left-panel pads.
  assign(pick("button"), [
    action("load"), action("clear"), action("clearShader"),
    action("bank0"), action("bank1"), action("bank2"),
    action("bank3"), action("bank4"), action("bank5"),
    widget("pad", 4), widget("pad", 5), widget("pad", 6), widget("pad", 7),
  ]);

  return out;
}
