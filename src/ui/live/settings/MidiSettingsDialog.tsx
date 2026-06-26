import { useRef } from "react";
import { Button } from "@/ui/components/ui/button";
import { REMOTE_HASH } from "../liveChannel";
import { Controller } from "../controller/Controller";
import { useLive } from "../LiveProvider";

export function MidiSettingsDialog() {
  const live = useLive();
  const { midi } = live;

  const status = midi.status;
  const devices = midi.devices();

  // Pop the on-screen DJ surface out into its own window (drives this session over BroadcastChannel).
  const openControllerWindow = () => {
    const url = `${window.location.origin}${window.location.pathname}${REMOTE_HASH}`;
    window.open(url, "marathon-controller", "width=1100,height=680");
  };

  if (devices.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center backdrop-blur-sm bg-black">
        <div className="flex flex-col items-center gap-4">
          <div className="max-w-xs p-6 text-center">
            <p className="mb-4 text-sm text-ink-dim">No MIDI controller connected</p>
            <p className="mb-6 text-xs text-ink-dim/70">Either connect a hardware controller or use the digital controller</p>
            <Button size="sm" onClick={openControllerWindow}>
              Open Digital Controller
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex mt-4 ml-34 h-10 shrink-0 items-center gap-2 px-3 text-xs">
        {/* device info */}
        <span className="text-[10px] uppercase tracking-wide text-ink-dim">Device</span>
        {status === "unsupported" ? (
          <span className="text-amber-400">Web MIDI unavailable</span>
        ) : status === "denied" ? (
          <Button size="sm" variant="ghost" onClick={() => midi.enable()}>
            Access denied — retry
          </Button>
        ) : (
          devices.map((d) => (
            <span key={d.id} className="flex items-center gap-1.5 text-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {d.name}
            </span>
          ))
        )}
      </div>

      {/* controller surface */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <Controller />
      </div>
    </div>
  );
}
