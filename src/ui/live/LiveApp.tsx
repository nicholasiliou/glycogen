import { useEffect, useState } from "react";
import { Pause, Play, Power, Settings2 } from "lucide-react";
import { useEngine, useTime } from "@/ui/engine/EngineProvider";
import { Button } from "@/ui/components/ui/button";
import { Slider } from "@/ui/components/ui/slider";
import { Separator } from "@/ui/components/ui/separator";
import { SCALE_NAMES, type ScaleName } from "@/audio/scale";
import { LiveProvider, useLive } from "./LiveProvider";
import { Stage } from "./Stage";
import { Sundial } from "./Sundial";
import { LivePanel } from "./LivePanel";
import { MidiSettingsDialog } from "./settings/MidiSettingsDialog";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export function LiveApp() {
  return (
    <LiveProvider>
      <LiveShell />
    </LiveProvider>
  );
}

function LiveShell() {
  const engine = useEngine();
  const { playing } = useTime();
  const { started, startAudio, master, setMaster, bpm, setBpm, root, scale, setKey } = useLive();
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const rootIdx = (((root - 48) % 12) + 12) % 12;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0b0b0c] text-ink">
      {/* top bar */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-edge bg-panel px-3">
        <span className="select-none text-sm font-semibold tracking-tight text-accent">◇ Marathon · Live</span>
        <Separator orientation="vertical" className="h-5" />

        {!started ? (
          <Button size="sm" variant="accent" onClick={() => void startAudio()}>
            <Power className="h-3.5 w-3.5" /> Start Audio
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase text-ink-dim">Master</span>
            <Slider className="w-24" min={0} max={1} step={0.01} value={[master]} onValueChange={([v]) => setMaster(v)} />
          </div>
        )}

        <Button size="icon-sm" variant={playing ? "accent" : "ghost"} onClick={() => engine.togglePlay()} title="Play / Pause (Space)">
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>

        {/* tempo */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase text-ink-dim">BPM</span>
          <Slider className="w-24" min={60} max={160} step={1} value={[bpm]} onValueChange={([v]) => setBpm(v)} />
          <span className="w-7 text-xs tabular-nums">{bpm}</span>
        </div>

        {/* key */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase text-ink-dim">Key</span>
          <select
            value={rootIdx}
            onChange={(e) => setKey(48 + Number(e.target.value), scale)}
            className="rounded border border-edge bg-panel-raised px-1 py-0.5 text-xs outline-none"
          >
            {NOTE_NAMES.map((nm, i) => (
              <option key={nm} value={i}>
                {nm}
              </option>
            ))}
          </select>
          <select
            value={scale}
            onChange={(e) => setKey(root, e.target.value as ScaleName)}
            className="rounded border border-edge bg-panel-raised px-1 py-0.5 text-xs outline-none"
          >
            {SCALE_NAMES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1" />

        <Button size="sm" variant="ghost" onClick={() => setSettingsOpen(true)} title="MIDI settings & keymap">
          <Settings2 className="h-3.5 w-3.5" /> MIDI Settings
        </Button>
      </div>

      {/* body */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <Stage />
        </div>
        <div className="flex w-[340px] shrink-0 flex-col border-l border-edge bg-panel">
          <Sundial />
          <Separator />
          <div className="min-h-0 flex-1">
            <LivePanel onOpenSettings={() => setSettingsOpen(true)} />
          </div>
        </div>
      </div>

      <MidiSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
