import { useMemo, useState } from "react";
import { create, list, type PluginInfo } from "@/plugins/registry";
import type { DeckName, Focus, Stage } from "@/runtime/Stage";

export type BrowseMode = "plugin" | "shader";

export interface Browse {
  generators: PluginInfo[];
  effects: PluginInfo[];
  browseMode: BrowseMode;
  toggleBrowseMode: () => void;
  selected: PluginInfo | undefined;
  selectedIndex: number;
  step: (delta: number) => void;
  load: (deck: DeckName, bank?: number) => void;
  selectBank: (deck: DeckName, bank: number) => void;
  clearDeck: (deck: DeckName, bank?: number) => void;
  clearShader: () => void;
}

/**
 * The browse dial and deck loading: the plugin/shader catalog, the current selection per mode, and
 * every mutation that loads/clears stage banks or the shader. Pure orchestration over the imperative
 * {@link Stage} — focus is owned by the host provider and threaded in.
 */
export function useBrowse({ stage, focus, setFocus, refresh }: {
  stage: Stage;
  focus: Focus;
  setFocus: (f: Focus) => void;
  refresh: () => void;
}): Browse {
  const catalog = useMemo(() => list(), []);
  const generators = useMemo(() => catalog.filter((p) => p.kind === "generator"), [catalog]);
  // "None" (the passthrough shader) sits at the top of the shader dial so it's the first/home entry.
  const effects = useMemo(() => {
    const fx = catalog.filter((p) => p.kind === "effect");
    return fx.sort((a, b) => (a.id === "none" ? -1 : b.id === "none" ? 1 : 0));
  }, [catalog]);

  const [browseMode, setBrowseMode] = useState<BrowseMode>("plugin");
  const [selPlugin, setSelPlugin] = useState(0);
  const [selShader, setSelShader] = useState(0);

  const liveList = browseMode === "shader" ? effects : generators;
  const selectedIndex = browseMode === "shader" ? selShader : selPlugin;
  const selected = liveList[selectedIndex];

  // Apply a shader entry live: "none" clears the slot, anything else loads it; either way the
  // controller focuses the shader so its params are immediately editable.
  const applyShader = (info: PluginInfo | undefined) => {
    if (!info) return;
    stage.setShader(info.id === "none" ? null : create(info.id));
    setFocus("shader");
    refresh();
  };

  const step = (d: number) => {
    if (browseMode === "shader") {
      const n = effects.length ? (selShader + d + effects.length * 100) % effects.length : 0;
      setSelShader(n);
      applyShader(effects[n]); // previewing a shader applies + focuses it directly
    } else {
      if (!generators.length) return;
      const n = (selPlugin + d + generators.length * 100) % generators.length;
      setSelPlugin(n);
      // Previewing a plugin loads it straight into the focused deck's active bank, mirroring
      // shader mode — no manual load step.
      const deck: DeckName = focus === "shader" ? "A" : focus;
      stage.loadBank(deck, stage.decks[deck].active, create(generators[n].id));
      setFocus(deck);
      refresh();
    }
  };

  const toggleBrowseMode = () => {
    const next = browseMode === "plugin" ? "shader" : "plugin";
    setBrowseMode(next);
    // Entering shader mode applies + focuses the current shader selection; leaving it keeps the
    // shader applied and returns focus to deck A so deck controls are editable again.
    if (next === "shader") applyShader(effects[selShader]);
    else setFocus("A");
  };

  const load = (deck: DeckName, bank?: number) => {
    if (!selected) return;
    if (browseMode === "shader") {
      applyShader(selected);
    } else {
      stage.loadBank(deck, bank ?? stage.decks[deck].active, create(selected.id));
      setFocus(deck);
    }
    refresh();
  };

  const selectBank = (deck: DeckName, bank: number) => {
    stage.selectBank(deck, bank);
    setFocus(deck);
    refresh();
  };

  const clearShader = () => {
    stage.setShader(null);
    setSelShader(0); // None is index 0, so the dial returns home
    refresh();
  };

  const clearDeck = (deck: DeckName, bank?: number) => {
    stage.clearBank(deck, bank);
    refresh();
  };

  return { generators, effects, browseMode, toggleBrowseMode, selected, selectedIndex, step, load, selectBank, clearDeck, clearShader };
}
