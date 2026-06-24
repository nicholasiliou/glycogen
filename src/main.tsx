import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { Engine, Exporter, serializeProject } from "@/engine";
import { registerBuiltins } from "@/plugins";
import { EngineProvider } from "@/ui/engine/EngineProvider";
import { LiveApp } from "@/ui/live/LiveApp";

const engine = new Engine();
registerBuiltins(engine.registry);

// The live instrument opens on an empty stage — you add plugins from the sundial.
// (A modest 720p canvas keeps the live render light.)
engine.setCompositionSettings({ width: 1280, height: 720 });

engine.mount({
  offscreenContainer: document.getElementById("offscreen-host")!,
  pixelRatio: window.devicePixelRatio || 1,
});

// Dev convenience: poke the engine from the console (e.g. `marathon.engine`, exports).
if (import.meta.env.DEV) {
  (window as any).marathon = {
    engine,
    exporter: new Exporter(engine),
    serialize: () => serializeProject(engine.project),
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EngineProvider engine={engine}>
      <LiveApp />
    </EngineProvider>
  </StrictMode>,
);
