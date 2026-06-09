import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { Engine, Exporter, serializeProject } from "@/engine";
import { registerBuiltins } from "@/plugins";
import { EngineProvider } from "@/ui/engine/EngineProvider";
import App from "@/ui/App";

const engine = new Engine();
registerBuiltins(engine.registry);

// Default project: the original plant as a background layer + a title, so the editor
// opens on something live and demonstrates that "plants are just one layer type".
const plant = engine.addLayer("plant", { select: false });
engine.addLayer("text", {
  name: "Title",
  select: false,
  transform: { position: [engine.comp.width / 2, engine.comp.height * 0.16] },
});
if (plant) engine.select([plant.id]);
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
    <EngineProvider engine={engine}>
      <App />
    </EngineProvider>
  </StrictMode>,
);
