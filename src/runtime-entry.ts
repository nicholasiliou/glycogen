/**
 * Global entry for the standalone runtime bundle (`public/marathon-runtime.js`,
 * built via `npm run build:runtime`). The interactive-web export inlines this file
 * and calls `MarathonRuntime.createRuntime(...)`. It contains the engine + plugins
 * (and p5), but no editor UI.
 */
import { createRuntime } from "./engine/runtime";

(window as any).MarathonRuntime = { createRuntime };

export { createRuntime };
