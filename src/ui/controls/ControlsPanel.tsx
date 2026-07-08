import { PluginBindingsPanel } from "./PluginBindingsPanel";

/**
 * The right-side controls drawer: a live reflection of the binding db for the focused plugin —
 * every param with its value editor and binding chip, plus the preset bar. All state lives in the
 * db tables (see PluginBindingsPanel); this shell only exists so LiveApp keeps a stable import.
 */
export function ControlsPanel() {
  return <PluginBindingsPanel />;
}
