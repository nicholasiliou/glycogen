import { useMemo, useState } from "react";
import { create, list, type PluginInfo } from "@/plugins/registry";
import type { Stage } from "@/runtime/Stage";

export interface Browse {
  generators: PluginInfo[];
  effects: PluginInfo[];
  selectedPlugin: PluginInfo | undefined;
  selectedPluginIndex: number;
  selectedShader: PluginInfo | undefined;
  selectedShaderIndex: number;
  stepPlugin: (delta: number) => void;
  stepShader: (delta: number) => void;
  load: (bank?: number) => void;
  selectBank: (bank: number) => void;
  clearBank: (bank?: number) => void;
  clearShader: () => void;
}

/**
 * The two browse dials and bank loading. Plugins and shaders live side by side — no mode switch:
 * stepping the plugin dial loads the browsed generator into the active bank; stepping the shader
 * dial applies the browsed effect to the active bank's output (and focuses it, so its params are
 * immediately editable). Pure orchestration over the imperative {@link Stage}.
 */
export function useBrowse({ stage, refresh }: { stage: Stage; refresh: () => void }): Browse {
  const catalog = useMemo(() => list(), []);
  const generators = useMemo(() => catalog.filter((p) => p.kind === "generator"), [catalog]);
  // "None" (the passthrough shader) sits at the top of the shader dial so it's the first/home entry.
  const effects = useMemo(() => {
    const fx = catalog.filter((p) => p.kind === "effect");
    return fx.sort((a, b) => (a.id === "none" ? -1 : b.id === "none" ? 1 : 0));
  }, [catalog]);

  const [selPlugin, setSelPlugin] = useState(0);
  const [selShader, setSelShader] = useState(0);

  // Apply a shader entry live to the active bank: "none" clears the slot (and hands the controls
  // back to the plugin), anything else loads it and focuses the shader half of the bank.
  const applyShader = (info: PluginInfo | undefined) => {
    if (!info) return;
    const clearing = info.id === "none";
    stage.setShader(stage.active, clearing ? null : create(info.id));
    stage.focusPart = clearing ? "plugin" : "shader";
    refresh();
  };

  const stepPlugin = (d: number) => {
    if (!generators.length) return;
    const n = (selPlugin + d + generators.length * 100) % generators.length;
    setSelPlugin(n);
    // Previewing a plugin loads it straight into the active bank — no manual load step.
    stage.loadBank(stage.active, create(generators[n].id));
    refresh();
  };

  const stepShader = (d: number) => {
    if (!effects.length) return;
    const n = (selShader + d + effects.length * 100) % effects.length;
    setSelShader(n);
    applyShader(effects[n]); // previewing a shader applies + focuses it directly
  };

  const load = (bank?: number) => {
    const info = generators[selPlugin];
    if (!info) return;
    stage.loadBank(bank ?? stage.active, create(info.id));
    refresh();
  };

  const selectBank = (bank: number) => {
    stage.selectBank(bank);
    refresh();
  };

  const clearShader = () => {
    stage.setShader(stage.active, null);
    stage.focusPart = "plugin";
    setSelShader(0); // None is index 0, so the dial returns home
    refresh();
  };

  const clearBank = (bank?: number) => {
    stage.clearBank(bank);
    refresh();
  };

  return {
    generators,
    effects,
    selectedPlugin: generators[selPlugin],
    selectedPluginIndex: selPlugin,
    selectedShader: effects[selShader],
    selectedShaderIndex: selShader,
    stepPlugin,
    stepShader,
    load,
    selectBank,
    clearBank,
    clearShader,
  };
}
