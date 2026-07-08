import { useEffect } from "react";
import { hardwareControls } from "@/db/schema";
import type { MidiManager } from "@/midi/MidiManager";
import type { ControlOverride } from "@/midi/types";

/**
 * Keep the MidiManager's interpretation in sync with the `hardwareControls` table: every row's
 * name/kind/disabled is pushed down as an override so a corrected control type takes effect live
 * (a CC reclassified as a button switches to edge detection, etc.). Runs at mount and on every
 * table change — the db is the source of truth, the learner is just its live projection.
 */
export function useHardwareSync(midi: MidiManager): void {
  useEffect(() => {
    const push = () => {
      const overrides: Record<string, ControlOverride> = {};
      for (const c of hardwareControls.all()) overrides[c.id] = { name: c.name, kind: c.kind, disabled: c.disabled };
      midi.applyOverrides(overrides);
    };
    push();
    if (midi.status === "ready") midi.allLedsOff();
    return hardwareControls.subscribe(push);
  }, [midi]);
}
