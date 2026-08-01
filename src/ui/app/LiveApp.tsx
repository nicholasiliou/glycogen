import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Power } from "lucide-react";
import { LiveProvider, useLive } from "@/ui/app/LiveProvider";
import { ExportProvider } from "@/ui/export/ExportContext";
import { asset } from "@/lib/asset";
import { cn } from "@/ui/lib/cn";
import { HeaderBar } from "@/ui/stage/HeaderBar";
import { Stage } from "@/ui/stage/Stage";
import { ControlsPanel } from "@/ui/controls/ControlsPanel";
import { AssignPanel } from "@/ui/controls/AssignPanel";
import { MidiSettingsDialog } from "@/ui/settings/MidiSettingsDialog";
import { DIALOG_PORTAL_ID } from "@/ui/components/dialog";

export function LiveApp() {
  return (
    <LiveProvider>
      <ExportProvider>
        <LiveShell />
      </ExportProvider>
    </LiveProvider>
  );
}

/**
 * Demo stub: skip the click-to-start intro and boot straight into the preview. The whole StartGate
 * below is left intact — flip this back to `false` to restore the audio-gesture gate.
 *
 * Note: browsers suspend the AudioContext until a real user gesture, so with the intro skipped audio
 * may not sound until the first click/keypress anywhere in the page; the visuals run regardless.
 */
const SKIP_INTRO = true;

/** The intro gate: two blinds meeting at the middle that retract to the top/bottom edges on start. */
function StartGate() {
  const { started, start } = useLive();
  // Auto-start once on mount when the intro is skipped — no blinds, no button.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (SKIP_INTRO && !autoStarted.current) {
      autoStarted.current = true;
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot-once; start is stable enough here
  }, []);
  if (SKIP_INTRO) return null;
  const [phase, setPhase] = useState<"idle" | "opening" | "gone">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleStart = () => {
    start();
    setPhase("opening");
    timerRef.current = setTimeout(() => setPhase("gone"), 360);
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  if (phase === "gone" || (started && phase !== "opening")) return null;

  const blind = (which: "top" | "bottom"): CSSProperties => ({
    transformOrigin: which, // top blind retracts upward, bottom blind retracts downward
    transition: phase === "opening" ? "transform 320ms cubic-bezier(0.55,0,1,0.45)" : "none",
    transform: phase === "opening" ? "scaleY(0)" : "scaleY(1)",
  });

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-20"
      style={{ maskImage: `url(${asset("/masks/16x9/1.svg")})`, maskSize: "100% 100%", maskPosition: "0 0", maskRepeat: "no-repeat" }}
    >
      <div className="absolute inset-x-0 top-0 h-1/2 bg-[#0c0c0d]" style={blind("top")} />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[#0c0c0d]" style={blind("bottom")} />
      {phase === "idle" && (
        <button onClick={handleStart} className="absolute h-full w-full text-white/60 hover:bg-white/5">
          <Power className="mx-auto h-8 w-8" />
        </button>
      )}
    </div>
  );
}

function LearnToast() {
  const { learnSlot, cancelLearn } = useLive();
  if (!learnSlot) return null;
  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-lg px-4 py-2 text-sm text-ink">
      <span className="h-2 w-2 animate-pulse rounded-full" />
      <span>Touch a hardware control to bind <span className="font-mono text-accent">{learnSlot}</span></span>
      <button onClick={cancelLearn} className="ml-2 text-ink-dim hover:text-ink">✕</button>
    </div>
  );
}

/** Exhibition inactivity warning: a small countdown that appears in the final seconds before the
 *  scene re-randomizes itself, so a lull doesn't reset without warning. Any control touch (or
 *  click/keypress) resets the timer in the provider and clears this. */
function IdleResetToast() {
  const { idleCountdown } = useLive();
  if (idleCountdown === null) return null;
  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-50 -translate-x-1/2 flex items-center gap-2 rounded-lg bg-black/60 px-4 py-2 text-sm text-ink backdrop-blur">
      <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
      <span>
        Resetting to a fresh scene in <span className="font-mono text-accent">{idleCountdown}s</span> — touch any control to keep this one
      </span>
    </div>
  );
}

function LiveShell() {
  const { load, midi, remoteConnected, controllerConnected } = useLive();
  const [controllerOpen, setControllerOpen] = useState(false);
  // Right-side controls drawer. When open it takes width from the stage row, so the canvas (sized
  // by a ResizeObserver on its host) re-fits to the narrower area automatically.
  const [controlsOpen, setControlsOpen] = useState(false);

  // Track the stage container's left offset and width so HeaderBar can center its controls over it.
  const stageContainerRef = useRef<HTMLDivElement>(null);
  const [stageRect, setStageRect] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    const el = stageContainerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setStageRect({ left: r.left, width: r.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Boot default: without a controller (hardware or emulator) the on-screen sliders are the only
  // way to play, so open the drawer; with one connected keep it closed. Decided once, shortly
  // after MIDI enumeration settles — the delay lets an already-open emulator answer the bridge's
  // presence ping first. After that the toggle is entirely the user's.
  const remoteConnectedRef = useRef(remoteConnected);
  remoteConnectedRef.current = remoteConnected;
  const bootDecided = useRef(false);
  useEffect(() => {
    if (bootDecided.current || midi.status === "idle") return;
    bootDecided.current = true;
    const t = setTimeout(() => setControlsOpen(midi.devices().length === 0 && !remoteConnectedRef.current), 300);
    return () => clearTimeout(t);
  }, [midi, midi.status]);

  // The controller overlay auto-opens the drawer (it shows the assign sidebar there), then puts
  // it back how it was: closed again if it was closed before, kept open if it was open.
  const controlsBefore = useRef(false);
  const prevShown = useRef(false);
  useEffect(() => {
    if (controllerOpen === prevShown.current) return;
    prevShown.current = controllerOpen;
    if (controllerOpen) {
      controlsBefore.current = controlsOpen;
      setControlsOpen(true);
    } else {
      setControlsOpen(controlsBefore.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- controlsOpen is only sampled on the transition
  }, [controllerOpen]);

  // Space loads the browsed plugin onto the stage (replaces the old play/pause transport toggle).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return;
      if (e.code === "Space") {
        e.preventDefault();
        load();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-black text-ink">
      <HeaderBar controllerOpen={controllerOpen} onControllerToggle={() => setControllerOpen((o) => !o)} stageRect={stageRect} />
      <div className="flex min-h-0 flex-1">
        {/* Also the dialog portal target: dialogs center on the canvas, not the page. */}
        <div ref={stageContainerRef} id={DIALOG_PORTAL_ID} className="relative min-h-0 flex-1">
          <Stage />
          <StartGate />
          <LearnToast />
          <IdleResetToast />
          {/* Drawer toggle: a little arrow on the right edge of the stage. */}
          <button
            onClick={() => setControlsOpen((o) => !o)}
            title={controlsOpen ? "Hide controls" : "Show controls"}
            className="absolute right-0 top-1/2 z-30 flex h-16 w-6 -translate-y-1/2 items-center justify-center rounded-l-md text-ink-dim backdrop-blur transition-colors hover:text-ink"
          >
            {controlsOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        {controllerOpen && (
          <div
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center"
            style={{ containerType: "size" }}
          >
            {/* Contain a true 16:9 box in the stage area (container-query units): on screens wider
                than 16:9 the height caps the width, so the mask never stretches and the header
                stays inside it. */}
            <div
              // While assignment is locked the live canvas is fully blacked out (an opaque
              // backdrop) — translucency + the locked surface's own blur reads as clutter.
              className={cn(
                "animate-overlay-in pointer-events-auto relative overflow-hidden",
                controllerConnected ? "bg-black/80 backdrop-blur-xs" : "bg-black",
              )}
              style={{
                width: "min(100cqw, calc(100cqh * 16 / 9))",
                aspectRatio: "16 / 9",
                maskImage: `url(${asset("/masks/16x9/1.svg")})`,
                maskSize: "100% 100%",
                maskPosition: "0 0",
                maskRepeat: "no-repeat",
              }}
            >
              {/* The mask notches the top/bottom edges (30px deep on the 1920×1080 artwork) and
                  rounds the corners, so the dialog content is inset past the notch band on every
                  side. Percent padding scales with the box like the mask does — vertical percent
                  padding resolves against the WIDTH, so the notch depth is 30/1920 = 1.5625%. */}
              <div className="absolute inset-0" style={{ padding: "1.5625% 3.5%" }}>
                <MidiSettingsDialog />
              </div>
            </div>
          </div>
        )}
        </div>

        {/* Right-side drawer. Lives in the flex row, so opening it narrows the stage (the canvas
            re-fits via its ResizeObserver, which also animates thanks to the width transition).
            While the controller overlay is open it shows the assign sidebar; otherwise the value
            editors. Kept mounted so the drawer can slide instead of popping. */}
        <aside
          className={cn(
            "flex h-full shrink-0 flex-col overflow-hidden transition-[width] duration-220 ease-out",
            controlsOpen ? "w-72" : "w-0",
          )}
        >
          <div className="flex h-full w-72 shrink-0 flex-col pt-3">
            {controllerOpen ? <AssignPanel /> : <ControlsPanel />}
          </div>
        </aside>
      </div>
    </div>
  );
}
