import { Engine } from "./Engine";
import { deserializeProject, type ProjectFile } from "./io/serialize";
import { registerBuiltins } from "../plugins";

export interface RuntimeOptions {
  mount: HTMLElement;
  offscreenHost: HTMLElement;
  project: ProjectFile | unknown;
  autoplay?: boolean;
  interactive?: boolean;
}

export interface RuntimeHandle {
  engine: Engine;
  destroy(): void;
}

/**
 * Headless playback bootstrap used by the interactive-web export (and embeddable in
 * any host page). It spins up the same Engine the editor uses — so every expression,
 * input binding and the composition clock behave identically to the editor preview.
 * No editor UI, just the live composition.
 */
export function createRuntime(opts: RuntimeOptions): RuntimeHandle {
  const engine = new Engine();
  registerBuiltins(engine.registry);
  engine.loadProjectInstance(deserializeProject(opts.project));

  const canvas = engine.mount({ offscreenContainer: opts.offscreenHost, pixelRatio: window.devicePixelRatio || 1 });
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.objectFit = "contain";
  opts.mount.appendChild(canvas);

  if (opts.interactive !== false) engine.input.attach(canvas);
  if (opts.autoplay !== false) engine.play();

  return {
    engine,
    destroy() {
      engine.unmount();
      canvas.remove();
    },
  };
}
