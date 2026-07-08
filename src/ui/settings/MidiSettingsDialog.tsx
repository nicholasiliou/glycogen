import { ExternalLink } from "lucide-react";
import { Controller } from "@/ui/controller/Controller";
import { FitBox } from "@/ui/components/FitBox";
import { REMOTE_HASH } from "@/controls/remoteChannel";
import { useLive } from "@/ui/app/LiveProvider";
import { SurfaceModeContext } from "@/ui/controller/widgets";

/**
 * The controller overlay: an *assignment surface* — an inert map of the pop-out surface that you
 * drag functions onto (from the assign sidebar) or drag occupants off of. It never drives the bus;
 * performing happens on the pop-out and the main sidebar. Right-click learn still works (the learn
 * toast + last-MIDI readout give feedback); hardware kind overrides live on the `#db` page.
 */
export function MidiSettingsDialog() {
  const { midi } = useLive();
  const status = midi.status;
  const devices = midi.devices();

  return (
    <div className="flex h-full flex-col">
      {/* header: device status + pop-out (the lastMidi readout lives in the app HeaderBar) */}
      <div className="flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 px-3 pt-3 pb-0">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[10px] uppercase tracking-wide text-ink-dim">Device</span>
          {status === "unsupported" ? (
            <span className="text-amber-400">Web MIDI unavailable</span>
          ) : status === "denied" ? (
            <button className="text-ink-dim hover:text-ink" onClick={() => midi.enable()}>
              Access denied — retry
            </button>
          ) : devices.length === 0 ? (
            <span className="text-ink-dim/70">No controller connected</span>
          ) : (
            devices.map((d) => (
              <span key={d.id} className="flex items-center gap-1.5 text-ink">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                {d.name}
              </span>
            ))
          )}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => window.open(`${location.origin}${location.pathname}${REMOTE_HASH}`, "marathon-controller", "width=1100,height=620")}
          className="ml-1 flex items-center gap-1 px-2 py-1.5 text-xs text-ink-dim transition-colors hover:text-ink"
          title="Pop out the live controller into a separate window"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>

      <SurfaceModeContext.Provider value="assign">
        <FitBox className="flex-1 p-2">
          <Controller />
        </FitBox>
      </SurfaceModeContext.Provider>
    </div>
  );
}
