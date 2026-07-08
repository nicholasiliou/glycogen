import { slotId, type ControlKind as SlotKind, type SlotId } from "@/controls/types";
import { uid, type AppAction, type HardwareBindingRow, type HardwareControlRow, type HardwareTarget } from "@/db/schema";
import type { ControlKind } from "./types";

/**
 * Best-effort default layout for a two-deck DJ controller (e.g. Numark MixTrack): hardware controls
 * map straight onto widgets so the focused plugin's bound params respond immediately; a few buttons
 * drive app actions (load / browse-mode / banks). Returns fresh binding rows for every control it
 * could place — the caller replaces that control's existing binding. Stable input order; the user
 * edits inline afterwards.
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
      const invert = target.type === "widget" && target.widgetId === ("crossfader:0" as SlotId);
      out.push({ id: uid(), controlId: c.id, target, ...(invert ? { invert: true } : {}) });
    });

  // Channel faders → fader widgets; the last fader → crossfader (which reports inverted).
  assign(pick("fader"), [widget("fader", 0), widget("fader", 1), widget("crossfader", 0)]);

  // Jog wheels → jog widgets (primary performance control).
  assign(pick("jog"), [widget("jog", 0), widget("jog", 1)]);

  // First encoder → browse; the rest → encoder widgets.
  assign(pick("encoder"), [action("browse"), widget("encoder", 0), widget("encoder", 1), widget("encoder", 2)]);

  // EQ knobs → knob widgets.
  assign(pick("knob"), Array.from({ length: 8 }, (_, i) => widget("knob", i)));

  // Buttons: app actions first, then deck-A pads for the focused plugin.
  assign(pick("button"), [
    action("loadA"), action("loadB"), action("browseMode"), action("clearA"), action("clearB"),
    action("bankA0"), action("bankA1"), action("bankA2"),
    action("bankB0"), action("bankB1"), action("bankB2"),
    widget("pad", 4), widget("pad", 5), widget("pad", 6), widget("pad", 7),
  ]);

  return out;
}
