import { useEffect, useState } from "react";
import { useEngine } from "@/ui/engine/EngineProvider";
import { LiveProvider } from "./LiveProvider";
import { HeaderBar } from "./HeaderBar";
import { Stage } from "./Stage";
import { MidiSettingsDialog } from "./settings/MidiSettingsDialog";

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

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-black text-ink">
      <HeaderBar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="min-h-0 flex-1">
        <Stage />
      </div>
      <MidiSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
