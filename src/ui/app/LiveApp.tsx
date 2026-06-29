import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Power, Sliders } from "lucide-react";
import { LiveProvider, useLive } from "@/ui/app/LiveProvider";
import { ExportProvider } from "@/ui/export/ExportContext";
import { HeaderBar } from "@/ui/stage/HeaderBar";
import { Stage } from "@/ui/stage/Stage";
import { ControlsPanel } from "@/ui/controls/ControlsPanel";
import { MidiSettingsDialog, type Tab } from "@/ui/settings/MidiSettingsDialog";

export function LiveApp() {
  return (
    <LiveProvider>
      <ExportProvider>
        <LiveShell />
      </ExportProvider>
    </LiveProvider>
  );
}

/** The intro gate: two blinds meeting at the middle that retract to the top/bottom edges on start. */
function StartGate() {
  const { started, start } = useLive();
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
      style={{ maskImage: "url(/masks/16x9/1.svg)", maskSize: "100% 100%", maskPosition: "0 0", maskRepeat: "no-repeat" }}
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
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-lg border border-accent/50 bg-black/90 px-4 py-2 text-sm text-ink shadow-lg shadow-accent/20">
      <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
      <span>Touch a hardware control to bind <span className="font-mono text-accent">{learnSlot}</span></span>
      <button onClick={cancelLearn} className="ml-2 text-ink-dim hover:text-ink">✕</button>
    </div>
  );
}

function LiveShell() {
  const { load } = useLive();
  const [controllerOpen, setControllerOpen] = useState(false);
  // Lifted here so the chosen tab persists across closing/reopening the overlay (the dialog itself
  // unmounts on close, which would otherwise reset it to "controller").
  const [tab, setTab] = useState<Tab>("controller");
  // Right-side controls drawer. When open it takes width from the stage row, so the canvas (sized
  // by a ResizeObserver on its host) re-fits to the narrower area automatically.
  const [controlsOpen, setControlsOpen] = useState(false);

  // Space loads the browsed plugin onto the stage (replaces the old play/pause transport toggle).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return;
      if (e.code === "Space") {
        e.preventDefault();
        load("A");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-black text-ink">
      <HeaderBar controllerOpen={controllerOpen} onControllerToggle={() => setControllerOpen((o) => !o)} />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 flex-1">
          <Stage />
          <StartGate />
          <LearnToast />
          {/* Drawer toggle: a little arrow on the right edge of the stage. */}
          <button
            onClick={() => setControlsOpen((o) => !o)}
            title={controlsOpen ? "Hide controls" : "Show controls"}
            className="absolute right-0 top-1/2 z-30 flex h-16 w-6 -translate-y-1/2 items-center justify-center rounded-l-md text-ink-dim backdrop-blur transition-colors hover:text-ink"
          >
            {controlsOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        {controllerOpen && (
          <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
            <div
              className="pointer-events-auto relative w-full overflow-hidden"
              style={{
                aspectRatio: "16 / 9",
                maxHeight: "100%",
                maskImage: "url(/masks/16x9/1.svg)",
                maskSize: "100% 100%",
                maskPosition: "0 0",
                maskRepeat: "no-repeat",
                background: "rgba(0,0,0,0.40)",
                backdropFilter: "blur(2px)",
              }}
            >
              {/* The mask notches the top/bottom edges and rounds the corners, so the dialog content
                  is inset into the mask's clip-free interior rather than filling the raw box. */}
              <div className="absolute inset-0" style={{ padding: "0% 3.5%" }}>
                <MidiSettingsDialog tab={tab} onTab={setTab} />
              </div>
            </div>
          </div>
        )}
        </div>

        {/* Right-side controls drawer. Lives in the flex row, so opening it narrows the stage. */}
        {controlsOpen && (
          <aside className="flex h-full w-72 shrink-0 flex-col">
            <div className="flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-ink-dim">
              <Sliders className="h-3.5 w-3.5" />
              Controls
            </div>
            <ControlsPanel />
          </aside>
        )}
      </div>
    </div>
  );
}
