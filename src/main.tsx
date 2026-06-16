import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { Engine, Exporter, serializeProject } from "@/engine";
import { registerBuiltins } from "@/plugins";
import { EngineProvider } from "@/ui/engine/EngineProvider";
import { ModeProvider } from "@/ui/mode/ModeProvider";
import { regenerate } from "@/generator/generate";
import { DEFAULT_RECIPE } from "@/generator/recipe";
import App from "@/ui/App";

const engine = new Engine();
registerBuiltins(engine.registry);

// Open on a generated, on-brand scene so Simple Mode has something live from the start.
engine.setCompositionSettings({ width: DEFAULT_RECIPE.format.width, height: DEFAULT_RECIPE.format.height });
regenerate(engine, DEFAULT_RECIPE);
engine.history.clear();

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
    <ModeProvider>
      <EngineProvider engine={engine}>
        <App />
      </EngineProvider>
    </ModeProvider>
  </StrictMode>,
);
