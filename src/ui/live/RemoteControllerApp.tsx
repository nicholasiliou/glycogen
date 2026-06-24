/**
 * Standalone page rendered in the popup window (booted via the `#controller` URL hash). It shows
 * the same skeuomorphic DJ surface as the in-app controller, but wired to the host window through
 * {@link RemoteLiveProvider} — so a phone/tablet/second monitor becomes your control surface when
 * you don't have a MIDI controller.
 */
import { Controller } from "./controller/Controller";
import { RemoteLiveProvider } from "./RemoteLiveProvider";

export function RemoteControllerApp() {
  return (
    <RemoteLiveProvider>
      <div className="flex h-screen w-screen flex-col bg-black text-ink">
        <div className="flex h-9 shrink-0 items-center px-3 text-[10px] uppercase tracking-[0.18em] text-ink-dim">
          Marathon · Remote Controller
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
          {/* Remote is a play surface only — no MIDI here to map. */}
          <Controller allowMap={false} />
        </div>
      </div>
    </RemoteLiveProvider>
  );
}
