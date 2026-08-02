import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
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
import { RotateOverlay } from "@/ui/app/RotateOverlay";
import { cn } from "@/ui/lib/cn";

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
 * below is left intact  -  flip this back to `false` to restore the audio-gesture gate.
 *
 * Note: browsers suspend the AudioContext until a real user gesture, so with the intro skipped audio
 * may not sound until the first click/keypress anywhere in the page; the visuals run regardless.
 */
const SKIP_INTRO = true;

/** The intro gate: two blinds meeting at the middle that retract to the top/bottom edges on start. */
function StartGate() {
  const { started, start } = useLive();
  // Auto-start once on mount when the intro is skipped  -  no blinds, no button.
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
        Resetting to a fresh scene in <span className="font-mono text-accent">{idleCountdown}s</span>  -  touch any control to keep this one
      </span>
    </div>
  );
}

const PIP_W = 280;
const PIP_H = Math.round(PIP_W * 9 / 16);
const PIP_MARGIN = 16;
const MORPH_MS = 420;

type Rect = { x: number; y: number; w: number; h: number };

/**
 * A single, always-mounted stage that morphs between two geometries:
 *  - full: fills the {@link fullRect} (the stage column), used in normal mode.
 *  - pip: a draggable corner window, used while the controller overlay is open.
 *
 * The morph is a FLIP animation. Rather than swap two Stage instances (which reparents the runtime
 * canvas and pops), we keep this one element mounted and transition its `left/top/width/height` on
 * every toggle, so the canvas visibly shrinks/grows and slides between the two spots. The runtime
 * canvas cover-fits inside, so it scales smoothly while the box animates; the ResizeObserver in
 * {@link Stage} only re-renders at the settled size (start + end), never per frame.
 *
 * `fullRect` is the live geometry of the stage column (measured by the shell). While the controller
 * is open the pip owns its own drag/snap position; on close it animates back to `fullRect`.
 */
function MorphStage({
  controllerOpen,
  fullRect,
  fadingOut,
  onFadeOutDone,
}: {
  controllerOpen: boolean;
  fullRect: Rect | null;
  fadingOut?: boolean;
  onFadeOutDone?: () => void;
}) {
  const ex = useExportSettings();
  const maskVariant = ex.maskEnabled ? masksFor(ex.ratioId)[0] : null;
  const maskUrl = maskVariant
    ? (maskVariant.url.endsWith(".svg") ? maskVariant.url : `${maskVariant.url}/1.svg`)
    : null;

  // The resting pip position (bottom-right by default), only meaningful while controllerOpen.
  const pipCorner = (): Rect => ({
    x: window.innerWidth - PIP_W - PIP_MARGIN,
    y: window.innerHeight - PIP_H - PIP_MARGIN,
    w: PIP_W,
    h: PIP_H,
  });
  const [pipPos, setPipPos] = useState<{ x: number; y: number }>(() =>
    typeof window === "undefined" ? { x: 0, y: 0 } : { x: pipCorner().x, y: pipCorner().y },
  );

  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const elRef = useRef<HTMLDivElement>(null);
  const prevRect = useRef<Rect | null>(null);

  // Reset the pip to its default corner each time the controller opens, so it always animates out
  // from the full frame to a predictable spot.
  const wasOpen = useRef(controllerOpen);
  useEffect(() => {
    if (controllerOpen !== wasOpen.current) {
      wasOpen.current = controllerOpen;
      if (controllerOpen) setPipPos({ x: pipCorner().x, y: pipCorner().y });
    }
  }, [controllerOpen]);

  const clamp = (x: number, y: number) => ({
    x: Math.max(PIP_MARGIN, Math.min(window.innerWidth - PIP_W - PIP_MARGIN, x)),
    y: Math.max(PIP_MARGIN, Math.min(window.innerHeight - PIP_H - PIP_MARGIN, y)),
  });

  const snapToCorner = (x: number, y: number) => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const right = x >= cx;
    const top = y < cy;
    // Top-right overlaps the header bar buttons  -  redirect to bottom-right instead.
    const snapY = (right && top) ? window.innerHeight - PIP_H - PIP_MARGIN : (top ? PIP_MARGIN : window.innerHeight - PIP_H - PIP_MARGIN);
    return clamp(right ? window.innerWidth - PIP_W - PIP_MARGIN : PIP_MARGIN, snapY);
  };

  // Dragging only makes sense in pip (controller) mode.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!controllerOpen || !elRef.current) return;
    dragging.current = true;
    offset.current = { x: e.clientX - pipPos.x, y: e.clientY - pipPos.y };
    elRef.current.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    setPipPos(clamp(e.clientX - offset.current.x, e.clientY - offset.current.y));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    // Snap animates via the FLIP effect below (the rect changes while not dragging).
    setPipPos(snapToCorner(e.clientX - offset.current.x, e.clientY - offset.current.y));
  };

  // Target geometry: pip corner while the controller is open, otherwise the full stage column.
  const rect: Rect | null = controllerOpen
    ? { x: pipPos.x, y: pipPos.y, w: PIP_W, h: PIP_H }
    : fullRect;

  // FLIP: drive the box geometry imperatively so a toggle always animates, even when re-triggered
  // before the previous morph finished. On each geometry change we write the *previous* rect with
  // no transition, force a reflow so the browser commits it, then write the *new* rect with the
  // transition armed  -  guaranteeing there's always an old→new delta to tween. Drags bypass the
  // transition and track the pointer 1:1.
  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el || !rect) return;
    const TRANSITION = `left ${MORPH_MS}ms cubic-bezier(0.4,0,0.2,1), top ${MORPH_MS}ms cubic-bezier(0.4,0,0.2,1), width ${MORPH_MS}ms cubic-bezier(0.4,0,0.2,1), height ${MORPH_MS}ms cubic-bezier(0.4,0,0.2,1), border-radius ${MORPH_MS}ms ease`;
    const apply = (r: Rect) => {
      el.style.left = `${r.x}px`;
      el.style.top = `${r.y}px`;
      el.style.width = `${r.w}px`;
      el.style.height = `${r.h}px`;
    };
    const prev = prevRect.current;
    const changed = !prev || prev.x !== rect.x || prev.y !== rect.y || prev.w !== rect.w || prev.h !== rect.h;

    if (dragging.current || !prev) {
      // Dragging (or first paint): jump straight to the target, no animation.
      el.style.transition = "none";
      apply(rect);
    } else if (changed) {
      // Seat the old rect without a transition, commit it, then tween to the new rect.
      el.style.transition = "none";
      apply(prev);
      void el.offsetWidth; // force reflow so the old box is the transition's start point
      el.style.transition = TRANSITION;
      apply(rect);
    }
    prevRect.current = rect;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depend on the rect's scalar fields, not
    // the object identity (which is fresh every render); dragging is a ref sampled at run time.
  }, [rect?.x, rect?.y, rect?.w, rect?.h]);

  if (!rect) return null;
  const pip = controllerOpen;

  return (
    <div
      ref={elRef}
      className={cn(
        "fixed overflow-hidden bg-black select-none",
        // Pip floats above the controller panel and is draggable; the full frame sits at the base
        // layer so the drawer handle + toasts (z-50, in the stage column) stay clickable over it.
        pip ? "z-50 rounded-lg shadow-2xl ring-1 ring-white/10 cursor-grab active:cursor-grabbing" : "z-10",
      )}
      // Geometry (left/top/width/height) is driven imperatively by the FLIP effect below so the
      // browser always sees the *old* box before the *new* one, and thus tweens between them  -
      // even on a rapid re-toggle. Setting these via React style would apply the new box in the same
      // commit that arms the transition, which paints instantly (the bug we're fixing).
      style={{
        ...(pip && maskUrl ? { maskImage: `url(${maskUrl})`, maskSize: "100% 100%", maskPosition: "0 0", maskRepeat: "no-repeat" } : {}),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <Stage fadingOut={fadingOut} onFadeOutDone={onFadeOutDone} />
    </div>
  );
}

function LiveShell() {
  const { load, midi, remoteConnected, randomizeScene } = useLive();
  const [shuffling, setShuffling] = useState(false);
  const shuffleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleShuffle = () => {
    if (shuffleTimerRef.current !== null) return;
    setShuffling(true);
    // 380ms matches the CSS fade-out duration; randomize at the dark frame
    shuffleTimerRef.current = setTimeout(() => {
      randomizeScene();
      setShuffling(false);
      shuffleTimerRef.current = null;
    }, 200);
  };
  const handleFadeOutDone = () => {};
  const [portrait, setPortrait] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse) and (orientation: portrait)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse) and (orientation: portrait)");
    const update = () => setPortrait(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

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

  // Track the stage column's viewport rect. HeaderBar centers its controls over it (needs left/width)
  // and MorphStage uses it as the "full" geometry it grows back into (needs the full box). This
  // element is always mounted now (it's the stage-row area regardless of controller state), so a
  // plain ResizeObserver on it is enough  -  but we keep the ref-callback form so the observer
  // re-attaches cleanly on remount. We also refresh on window resize/scroll since getBoundingClientRect
  // is viewport-relative and the layout above it (header height) is fixed.
  const stageContainerRef = useRef<HTMLDivElement>(null);
  const [stageRect, setStageRect] = useState<Rect | null>(null);
  const stageRoRef = useRef<ResizeObserver | null>(null);
  const stageCallbackRef = useCallback((el: HTMLDivElement | null) => {
    (stageContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    stageRoRef.current?.disconnect();
    stageRoRef.current = null;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setStageRect({ x: r.left, y: r.top, w: r.width, h: r.height });
    };
    update();
    stageRoRef.current = new ResizeObserver(update);
    stageRoRef.current.observe(el);
    window.addEventListener("resize", update);
    // Note: cleanup for this listener runs on the next ref-callback invocation via the disconnect
    // above being paired with a fresh attach; the element is stable for the app's lifetime.
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
        // Device availability changed (or first visit)  -  override to the sensible default.
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
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-black text-ink"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <RotateOverlay />
      <HeaderBar controllerOpen={controllerOpen} onControllerToggle={() => setControllerOpen((o) => !o)} stageRect={stageRect} onShuffle={handleShuffle} />
      <div className={cn("flex min-h-0 flex-1", portrait && "flex-col-reverse")}>
        {/* The single stage element, morphing between full frame and pip corner. It's position:fixed,
            so it floats above the stage-column area below rather than living inside the flex flow. */}
        <MorphStage controllerOpen={controllerOpen} fullRect={stageRect} fadingOut={shuffling} onFadeOutDone={handleFadeOutDone} />

        {/* Stage-column area  -  always mounted. In normal mode it's just the background the stage
            grows into (plus the drawer handle + toasts); in controller mode it hosts the assign
            surface while the stage floats over it as a pip. */}
        <div ref={stageCallbackRef} id={DIALOG_PORTAL_ID} className="relative min-h-0 flex-1 bg-black">
          {controllerOpen ? (
            <div
              className="relative flex h-full w-full items-center justify-center bg-black"
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
          ) : (
            <>
              <StartGate />
              <LearnToast />
              <IdleResetToast />
              {/* Toggle + resize handle: sits on the right edge of the stage, always visible. Click
                  to open/close; drag left to open and resize in one motion. Fixed + positioned over
                  the column's right edge so it escapes this container's stacking context and stays
                  above the fixed stage layer. */}
              <div
                className="fixed z-50 w-6 cursor-col-resize group"
                style={stageRect ? { left: stageRect.x + stageRect.w - 24, top: stageRect.y, height: stageRect.h } : undefined}
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
            </>
          )}
        </div>

        {/* Right-side drawer. Lives in the flex row, so opening it narrows the stage (the canvas
            re-fits via its ResizeObserver, which also animates thanks to the width transition).
            While the controller overlay is open it shows the assign sidebar; otherwise the value
            editors. Kept mounted so the drawer can slide instead of popping. */}
        <aside
          className={cn(
            "shrink-0 overflow-hidden",
            portrait
              ? "flex w-full flex-col transition-[height] duration-220 ease-out"
              : "flex h-full flex-col transition-[width] duration-220 ease-out",
          )}
          style={portrait
            ? { height: controlsOpen ? 280 : 0 }
            : { width: controlsOpen ? drawerWidth : 0 }}
        >
          <div
            className={cn("relative flex shrink-0 flex-col pt-3", portrait ? "h-70 w-full" : "h-full")}
            style={portrait ? undefined : { width: drawerWidth }}
          >
            {controllerOpen ? <AssignPanel /> : <ControlsPanel />}
          </div>
        </aside>
      </div>
    </div>
  );
}
