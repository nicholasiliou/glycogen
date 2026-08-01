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

  // Apply a shader entry live to the active bank. "none" loads the passthrough (NoneLayer) so
  // there is always a shader slot to edit — the switch in the controls panel stays enabled.
  const applyShader = (info: PluginInfo | undefined) => {
    if (!info) return;
    stage.setShader(stage.active, create(info.id));
    stage.focusPart = "shader";
    refresh();
  };

  const stepPlugin = (d: number) => {
    if (!generators.length) return;
    setSelPlugin((prev) => {
      const n = (prev + d + generators.length * 100) % generators.length;
      stage.loadBank(stage.active, create(generators[n].id));
      refresh();
      return n;
    });
  };

  const stepShader = (d: number) => {
    if (!effects.length) return;
    setSelShader((prev) => {
      const n = (prev + d + effects.length * 100) % effects.length;
      applyShader(effects[n]);
      return n;
    });
  };

  const load = (bank?: number) => {
    const info = generators[selPlugin];
    if (!info) return;
    stage.loadBank(bank ?? stage.active, create(info.id));
    refresh();
  };

  const selectBank = (bank: number) => {
    stage.selectBank(bank);
    // Sync the dials/previews to what the newly active bank actually holds — otherwise the header
    // keeps showing whatever was browsed on the previous bank.
    const state = stage.banks[stage.active];
    const pIdx = state?.plugin ? generators.findIndex((g) => g.id === state.plugin!.id) : -1;
    if (pIdx >= 0) setSelPlugin(pIdx);
    const sIdx = state?.shader ? effects.findIndex((e) => e.id === state.shader!.id) : 0; // no shader → "None"
    if (sIdx >= 0) setSelShader(sIdx);
    refresh();
  };

  const clearShader = () => {
    const noneInfo = effects.find((e) => e.id === "none");
    if (noneInfo) stage.setShader(stage.active, create(noneInfo.id));
    else stage.setShader(stage.active, null);
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
