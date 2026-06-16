import { useEffect } from "react";
import { useEngine } from "@/ui/engine/EngineProvider";
import { Toolbar } from "@/ui/panels/Toolbar";
import { Viewport } from "@/ui/panels/Viewport";
import { LayersPanel } from "@/ui/panels/LayersPanel";
import { Inspector } from "@/ui/panels/Inspector";
import { Timeline } from "@/ui/panels/Timeline";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/ui/components/ui/resizable";

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export function ProApp() {
  const engine = useEngine();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? engine.history.redo() : engine.history.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        engine.history.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "d" && engine.selection.length) {
        e.preventDefault();
        engine.duplicateLayers(engine.selection);
        return;
      }
      if (isTyping()) return;
      if (e.code === "Space") {
        e.preventDefault();
        engine.togglePlay();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (engine.selection.length) {
          e.preventDefault();
          engine.removeLayers(engine.selection);
        }
      } else if (e.key === "ArrowRight") {
        engine.step(e.shiftKey ? 10 : 1);
      } else if (e.key === "ArrowLeft") {
        engine.step(e.shiftKey ? -10 : -1);
      } else if (e.key === "Home") {
        engine.seek(0);
      } else if (e.key === "End") {
        engine.seek(engine.comp.duration);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <Toolbar />
      <ResizablePanelGroup direction="vertical" className="flex-1">
        <ResizablePanel defaultSize={66} minSize={30}>
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={18} minSize={12} className="border-r border-edge bg-panel">
              <LayersPanel />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={56} minSize={30}>
              <Viewport />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={26} minSize={16} className="border-l border-edge bg-panel">
              <Inspector />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={34} minSize={12}>
          <Timeline />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
