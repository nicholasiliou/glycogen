import { useEffect, useRef, useState } from "react";
import { useEngine } from "@/ui/engine/EngineProvider";
import { LiveProvider, useLive } from "@/ui/app/LiveProvider";
import { HeaderBar } from "@/ui/stage/HeaderBar";
import { Stage } from "@/ui/stage/Stage";
import { MidiSettingsDialog } from "@/ui/settings/MidiSettingsDialog";
import { ExportProvider } from "@/ui/export/ExportContext";
import { Power } from "lucide-react";
import type { TextSetting } from "@/plugins/_shared/textField";

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export function LiveApp() {
  return (
    <LiveProvider>
      <ExportProvider>
        <LiveShell />
      </ExportProvider>
    </LiveProvider>
  );
}

function TextModePopup() {
  const { textMode } = useLive();
  const [visible, setVisible] = useState(false);
  const [label, setLabel] = useState<TextSetting>(textMode);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLabel(textMode);
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 1200);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [textMode]);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
      style={{ transition: "opacity 400ms ease", opacity: visible ? 1 : 0 }}
    >
      <span className="rounded bg-black/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/80">
        text · {label}
      </span>
    </div>
  );
}

const SLAT_COUNT = 10;

function AudioGate() {
  const { started, startAudio } = useLive();
  const [phase, setPhase] = useState<"idle" | "opening" | "gone">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleStart = async () => {
    await startAudio();
    setPhase("opening");
    timerRef.current = setTimeout(() => setPhase("gone"), 320);
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  if (phase === "gone" || started) return null;

  return (
    <div className="pointer-events-auto absolute inset-0 z-20" style={{ maskImage: "url(/masks/mask.svg)", maskSize: "100% 100%", maskPosition: "0 0", maskRepeat: "no-repeat" }}>
      {Array.from({ length: SLAT_COUNT }, (_, i) => (
        <div
          key={i}
          className="absolute left-0 right-0 origin-top bg-[#0c0c0d]"
          style={{
            top: `${(i / SLAT_COUNT) * 100}%`,
            height: `${100 / SLAT_COUNT}%`,
            transformOrigin: i % 2 === 0 ? "top" : "bottom",
            transition: phase === "opening" ? `transform 180ms cubic-bezier(0.55,0,1,0.45) ${i * 12}ms` : "none",
            transform: phase === "opening" ? "scaleY(0)" : "scaleY(1)",
          }}
        />
      ))}
      {phase === "idle" && (
        <button
          onClick={() => void handleStart()}
          className="absolute h-full w-full text-white/60 hover:bg-white/5"
        >
          <Power className="mx-auto h-8 w-8" />
        </button>
      )}
    </div>
  );
}

function LiveShell() {
  const engine = useEngine();
  const [controllerOpen, setControllerOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      if (e.code === "Space") {
        e.preventDefault();
        engine.togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-black text-ink">
      <HeaderBar
        controllerOpen={controllerOpen}
        onControllerToggle={() => setControllerOpen((o) => !o)}
      />
      <div className="relative min-h-0 flex-1">
        <Stage />
        <TextModePopup />
        <AudioGate />
        {controllerOpen && (
          <div className="absolute inset-0 z-50 bg-black/90" style={{ maskImage: "url(/masks/mask.svg)", maskSize: "100% 100%", maskPosition: "0 0", maskRepeat: "no-repeat" }}>
            <MidiSettingsDialog />
          </div>
        )}
      </div>
    </div>
  );
}
