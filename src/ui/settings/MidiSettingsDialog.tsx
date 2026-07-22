import { ExternalLink } from "lucide-react";
import { Controller } from "@/ui/controller/Controller";
import { FitBox } from "@/ui/components/FitBox";
import { REMOTE_HASH } from "@/controls/remoteChannel";
import { cn } from "@/ui/lib/cn";
import { useLive } from "@/ui/app/LiveProvider";
import { SurfaceModeContext } from "@/ui/controller/widgets";

/**
 * The controller overlay: an *assignment surface* — an inert map of the pop-out surface that you
 * drag functions onto (from the assign sidebar) or drag occupants off of. It never drives the bus;
 * performing happens on the pop-out and the main sidebar. Right-click learn still works (the learn
 * toast + last-MIDI readout give feedback); hardware kind overrides live on the `#db` page.
 *
 * Assignment is locked (surface blurred + inert) until something can actually play it: a hardware
 * MIDI device or the pop-out emulator.
 */
export function MidiSettingsDialog() {
  const { midi, remoteConnected, controllerConnected } = useLive();
  const status = midi.status;
  const devices = midi.devices();
  console.warn("[midi] dialog render; status", status, "devices", devices.length);
  const unlocked = controllerConnected;

  const openEmulator = () =>
    window.open(`${location.origin}${location.pathname}${REMOTE_HASH}`, "glycogen-controller", "width=1100,height=620");

  return (
    <div className="flex h-full flex-col">
      {/* header: device status + emulator pop-out (the lastMidi readout lives in the app HeaderBar) */}
      <div className="flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 px-3 pt-3 pb-0">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[10px] uppercase tracking-wide text-ink-dim">Device</span>
          {status === "unsupported" ? (
            <span className="text-amber-400">Web MIDI unavailable</span>
          ) : status === "denied" ? (
            <button className="text-ink-dim hover:text-ink" onClick={() => midi.enable()}>
              Access denied — retry
            </button>
          ) : status === "unavailable" ? (
            <button
              className="text-amber-400 hover:text-ink"
              onClick={() => midi.enable()}
              title="Permission is fine, but the MIDI backend failed to start. On Linux/Chromium this usually means the ALSA sequencer isn't loaded — run `sudo modprobe snd-seq`, then retry. Also make sure the page is served over https or localhost."
            >
              MIDI backend unavailable — retry
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
          {remoteConnected && (
            <span className="flex items-center gap-1.5 text-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Emulator
            </span>
          )}
        </div>
        <div className="flex-1" />
        <button
          onClick={openEmulator}
          className="ml-1 flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[10px] uppercase tracking-wide text-ink transition-colors hover:border-accent/60 hover:text-accent"
          title="Pop out the live controller emulator into a separate window"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Controller emulator
        </button>
      </div>

      <SurfaceModeContext.Provider value="assign">
        <div className="relative min-h-0 flex-1">
          <FitBox className={cn("h-full w-full p-2", !unlocked && "pointer-events-none opacity-50 blur-sm")}>
            <Controller />
          </FitBox>
          {!unlocked && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <span className="text-[10px] uppercase tracking-wide text-ink-dim">Assignment locked</span>
              <span className="max-w-xs text-xs text-ink">
                Connect a MIDI controller or open the emulator to start assigning.
              </span>
              <button
                onClick={openEmulator}
                className="flex items-center gap-1.5 rounded border border-edge px-2.5 py-1.5 text-[10px] uppercase tracking-wide text-ink transition-colors hover:border-accent/60 hover:text-accent"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open emulator
              </button>
            </div>
          )}
        </div>
      </SurfaceModeContext.Provider>
    </div>
  );
}
