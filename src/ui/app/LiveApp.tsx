import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { GripVertical, Power } from "lucide-react";
import { LiveProvider, useLive } from "@/ui/app/LiveProvider";
import { ExportProvider, useExportSettings } from "@/ui/export/ExportContext";
import { masksFor } from "@/runtime/export";
import { asset } from "@/lib/asset";
import { HeaderBar } from "@/ui/stage/HeaderBar";
import { Stage } from "@/ui/stage/Stage";
import { ControlsPanel } from "@/ui/controls/ControlsPanel";
import { AssignPanel } from "@/ui/controls/AssignPanel";
import { MidiSettingsDialog } from "@/ui/settings/MidiSettingsDialog";
import { DIALOG_PORTAL_ID } from "@/ui/components/dialog";
import { dragWith } from "@/ui/controller/widgets/shared";

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

const PIP_W = 280;
const PIP_H = Math.round(PIP_W * 9 / 16);
const PIP_MARGIN = 16;

/** Draggable picture-in-picture stage window that snaps to the nearest corner on release. */
function PipStage() {
  const ex = useExportSettings();
  const maskVariant = ex.maskEnabled ? masksFor(ex.ratioId)[0] : null;
  const maskUrl = maskVariant
    ? (maskVariant.url.endsWith(".svg") ? maskVariant.url : `${maskVariant.url}/1.svg`)
    : null;

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const elRef = useRef<HTMLDivElement>(null);

  // Place in bottom-right on first render once we know the viewport.
  useEffect(() => {
    setPos({
      x: window.innerWidth - PIP_W - PIP_MARGIN,
      y: window.innerHeight - PIP_H - PIP_MARGIN,
    });
  }, []);

  const clamp = (x: number, y: number) => ({
    x: Math.max(PIP_MARGIN, Math.min(window.innerWidth - PIP_W - PIP_MARGIN, x)),
    y: Math.max(PIP_MARGIN, Math.min(window.innerHeight - PIP_H - PIP_MARGIN, y)),
  });

  const snapToCorner = (x: number, y: number) => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const right = x >= cx;
    const top = y < cy;
    // Top-right overlaps the header bar buttons — redirect to bottom-right instead.
    const snapY = (right && top) ? window.innerHeight - PIP_H - PIP_MARGIN : (top ? PIP_MARGIN : window.innerHeight - PIP_H - PIP_MARGIN);
    return clamp(right ? window.innerWidth - PIP_W - PIP_MARGIN : PIP_MARGIN, snapY);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!elRef.current || !pos) return;
    dragging.current = true;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    elRef.current.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    setPos(clamp(e.clientX - offset.current.x, e.clientY - offset.current.y));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging.current || !pos) return;
    dragging.current = false;
    setPos(snapToCorner(e.clientX - offset.current.x, e.clientY - offset.current.y));
  };

  if (!pos) return null;

  return (
    <div
      ref={elRef}
      className="fixed z-50 overflow-hidden rounded-lg shadow-2xl ring-1 ring-white/10 cursor-grab active:cursor-grabbing select-none"
      style={{
        left: pos.x, top: pos.y, width: PIP_W, height: PIP_H,
        transition: dragging.current ? "none" : "left 180ms ease, top 180ms ease",
        ...(maskUrl ? { maskImage: `url(${maskUrl})`, maskSize: "100% 100%", maskPosition: "0 0", maskRepeat: "no-repeat" } : {}),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <Stage />
    </div>
  );
}

function LiveShell() {
  const { load, midi, remoteConnected } = useLive();
  const [controllerOpen, setControllerOpen] = useState(false);
  // Right-side controls drawer. When open it takes width from the stage row, so the canvas (sized
  // by a ResizeObserver on its host) re-fits to the narrower area automatically.
  const [controlsOpen, setControlsOpenRaw] = useState(() => {
    const saved = localStorage.getItem("glycogen.controlsOpen");
    return saved === null ? false : saved === "true";
  });
  const setControlsOpen = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setControlsOpenRaw((prev) => {
      const val = typeof next === "function" ? next(prev) : next;
      localStorage.setItem("glycogen.controlsOpen", String(val));
      return val;
    });
  }, []);
  const [drawerWidth, setDrawerWidth] = useState(() => {
    const saved = localStorage.getItem("glycogen.drawerWidth");
    return saved ? Math.max(200, Math.min(480, Number(saved))) : 288;
  });

  // Track the stage container's left offset and width so HeaderBar can center its controls over it.
  // Use a ref callback so the observer re-attaches whenever the element mounts (it unmounts/remounts
  // when controllerOpen toggles, which breaks a plain useEffect with [] deps).
  const stageContainerRef = useRef<HTMLDivElement>(null);
  const [stageRect, setStageRect] = useState<{ left: number; width: number } | null>(null);
  const stageRoRef = useRef<ResizeObserver | null>(null);
  const stageCallbackRef = useCallback((el: HTMLDivElement | null) => {
    (stageContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    stageRoRef.current?.disconnect();
    stageRoRef.current = null;
    if (!el) { setStageRect(null); return; }
    const update = () => {
      const r = el.getBoundingClientRect();
      setStageRect({ left: r.left, width: r.width });
    };
    update();
    stageRoRef.current = new ResizeObserver(update);
    stageRoRef.current.observe(el);
  }, []);

  // Boot default: without a controller (hardware or emulator) the on-screen sliders are the only
  // way to play, so open the drawer; with one connected keep it closed. We only override the saved
  // state when MIDI device availability changes from the last session, so the user's toggle
  // persists across reloads. Decided once after MIDI enumeration settles.
  const remoteConnectedRef = useRef(remoteConnected);
  remoteConnectedRef.current = remoteConnected;
  const bootDecided = useRef(false);
  useEffect(() => {
    if (bootDecided.current || midi.status === "idle") return;
    bootDecided.current = true;
    const t = setTimeout(() => {
      const hasController = midi.devices().length > 0 || remoteConnectedRef.current;
      const prevHadController = localStorage.getItem("glycogen.hadController");
      const nowStr = hasController ? "true" : "false";
      if (prevHadController === null || prevHadController !== nowStr) {
        // Device availability changed (or first visit) — override to the sensible default.
        localStorage.setItem("glycogen.hadController", nowStr);
        setControlsOpen(!hasController);
      }
      // Otherwise leave the saved toggle state as-is.
    }, 300);
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
      <HeaderBar controllerOpen={controllerOpen} onControllerToggle={() => setControllerOpen((o) => !o)} stageRect={controllerOpen ? null : stageRect} />
      <div className="flex min-h-0 flex-1">
        {controllerOpen ? (
          <>
            {/* Stage shrinks to a floating pip; the controller panel fills the full area. */}
            <PipStage />
            <div
              id={DIALOG_PORTAL_ID}
              className="relative flex min-h-0 flex-1 items-center justify-center bg-black"
              style={{ containerType: "size" }}
            >
              <div
                className="animate-overlay-in relative overflow-hidden bg-black"
                style={{
                  width: "min(100cqw, calc(100cqh * 16 / 9))",
                  aspectRatio: "16 / 9",
                  maskImage: `url(${asset("/masks/16x9/1.svg")})`,
                  maskSize: "100% 100%",
                  maskPosition: "0 0",
                  maskRepeat: "no-repeat",
                }}
              >
                <div className="absolute inset-0" style={{ padding: "1.5625% 3.5%" }}>
                  <MidiSettingsDialog />
                </div>
              </div>
              <LearnToast />
            </div>
          </>
        ) : (
          /* Normal mode: stage fills the flex area. */
          <div ref={stageCallbackRef} id={DIALOG_PORTAL_ID} className="relative min-h-0 flex-1">
            <Stage />
            <StartGate />
            <LearnToast />
            <IdleResetToast />
            {/* Toggle + resize handle: sits on the right edge of the stage, always visible. Click
                to open/close; drag left to open and resize in one motion. */}
            <div
              className="absolute right-0 top-0 z-50 h-full w-6 cursor-col-resize group"
              onPointerDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                let didDrag = false;
                const startW = controlsOpen ? drawerWidth : 0;
                dragWith((ev) => {
                  const delta = startX - ev.clientX;
                  if (!didDrag && Math.abs(delta) > 4) {
                    didDrag = true;
                    setControlsOpen(true);
                  }
                  if (didDrag) {
                    const next = Math.max(200, Math.min(480, startW + delta));
                    setDrawerWidth(next);
                    localStorage.setItem("glycogen.drawerWidth", String(next));
                  }
                }, () => {
                  if (!didDrag) setControlsOpen((o) => !o);
                });
              }}
            >
              <div className="absolute top-1/2 left-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-none transition-opacity opacity-30 group-hover:opacity-100">
                <GripVertical className="h-4 w-4 text-ink-dim" />
              </div>
            </div>
          </div>
        )}

        {/* Right-side drawer. Lives in the flex row, so opening it narrows the stage (the canvas
            re-fits via its ResizeObserver, which also animates thanks to the width transition).
            While the controller overlay is open it shows the assign sidebar; otherwise the value
            editors. Kept mounted so the drawer can slide instead of popping. */}
        <aside
          className="flex h-full shrink-0 flex-col overflow-hidden transition-[width] duration-220 ease-out"
          style={{ width: controlsOpen ? drawerWidth : 0 }}
        >
          <div
            className="relative flex h-full shrink-0 flex-col pt-3"
            style={{ width: drawerWidth }}
          >
            {controllerOpen ? <AssignPanel /> : <ControlsPanel />}
          </div>
        </aside>
      </div>
    </div>
  );
}
