import { useEffect } from "react";
import { useEngine } from "@/ui/engine/EngineProvider";
import { Viewport } from "@/ui/panels/Viewport";
import { SimpleToolbar } from "@/ui/panels/SimpleToolbar";
import { SimplePanel } from "@/ui/panels/SimplePanel";

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export function SimpleApp() {
  const engine = useEngine();

  // Minimal shortcut: space toggles playback (no editing shortcuts in simple mode).
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
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <SimpleToolbar />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <Viewport />
        </div>
        <div className="w-72 shrink-0 border-l border-edge bg-panel">
          <SimplePanel />
        </div>
      </div>
    </div>
  );
}
