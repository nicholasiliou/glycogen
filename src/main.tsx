import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { Engine, Exporter, serializeProject } from "@/engine";
import { registerBuiltins } from "@/plugins";
import { EngineProvider } from "@/ui/engine/EngineProvider";
import { LiveApp } from "@/ui/live/app/LiveApp";
import { isRemoteWindow } from "@/ui/live/channel/liveChannel";
import { RemoteControllerApp } from "@/ui/live/app/RemoteControllerApp";

// Popup "digital controller" window: no engine here — it relays to the host over BroadcastChannel.
if (isRemoteWindow()) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <RemoteControllerApp />
    </StrictMode>,
  );
} else {
  document.fonts.ready.then(bootEditor);
}

function bootEditor() {
const engine = new Engine();
registerBuiltins(engine.registry);

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
}
