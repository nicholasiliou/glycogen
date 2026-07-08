import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Power, Sliders } from "lucide-react";
import { LiveProvider, useLive } from "@/ui/app/LiveProvider";
import { ExportProvider } from "@/ui/export/ExportContext";
import { asset } from "@/lib/asset";
import { HeaderBar } from "@/ui/stage/HeaderBar";
import { Stage } from "@/ui/stage/Stage";
import { ControlsPanel } from "@/ui/controls/ControlsPanel";
import { AssignPanel } from "@/ui/controls/AssignPanel";
import { MidiSettingsDialog } from "@/ui/settings/MidiSettingsDialog";

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

function LiveShell() {
  const { load } = useLive();
  const [controllerOpen, setControllerOpen] = useState(false);
  // Right-side controls drawer. When open it takes width from the stage row, so the canvas (sized
  // by a ResizeObserver on its host) re-fits to the narrower area automatically.
  const [controlsOpen, setControlsOpen] = useState(false);

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
          <div
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center"
            style={{ containerType: "size" }}
          >
            {/* Contain a true 16:9 box in the stage area (container-query units): on screens wider
                than 16:9 the height caps the width, so the mask never stretches and the header
                stays inside it. */}
            <div
              className="pointer-events-auto relative overflow-hidden bg-panel/10 backdrop-blur-xs"
              style={{
                width: "min(100cqw, calc(100cqh * 16 / 9))",
                aspectRatio: "16 / 9",
                maskImage: `url(${asset("/masks/16x9/1.svg")})`,
                maskSize: "100% 100%",
                maskPosition: "0 0",
                maskRepeat: "no-repeat",
              }}
            >
              {/* The mask notches the top/bottom edges and rounds the corners, so the dialog content
                  is inset into the mask's clip-free interior rather than filling the raw box. */}
              <div className="absolute inset-0" style={{ padding: "0% 3.5%" }}>
                <MidiSettingsDialog />
              </div>
            </div>
          </div>
        )}
        </div>

        {/* Right-side drawer. Lives in the flex row, so opening it narrows the stage. While the
            controller overlay is open it shows the assign sidebar; otherwise the value editors. */}
        {controlsOpen && (
          <aside className="flex h-full w-72 shrink-0 flex-col">
            <div className="flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-ink-dim">
              <Sliders className="h-3.5 w-3.5" />
              {controllerOpen ? "Assign" : "Controls"}
            </div>
            {controllerOpen ? <AssignPanel /> : <ControlsPanel />}
          </aside>
        )}
      </div>
    </div>
  );
}
