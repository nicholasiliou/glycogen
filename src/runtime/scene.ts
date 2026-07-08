import { ButtonParam, Param } from "@/controls/Param";
import type { Plugin } from "@/plugins/Plugin";
import { create } from "@/plugins/registry";
import { BANK_COUNT, type FocusPart, type Stage } from "@/runtime/Stage";

/**
 * Scene snapshots: the full bank row (each generator + its layer shader, with every param value) as
 * plain JSON. A still export embeds this into the PNG itself, so dropping the image back onto the
 * stage reloads exactly the layers that rendered it — the image *is* the save file. Param values
 * are stored by field name, so a scene survives params being added/reordered; a renamed plugin or
 * param is simply skipped on load.
 */

/** The PNG text-chunk keyword scene JSON is stored under. */
export const SCENE_PNG_KEYWORD = "marathon:scene";

interface SceneParam {
  name: string;
  /** Numeric param value. */
  value?: number;
  /** ButtonParam press count (drives cycles) and toggle state. */
  count?: number;
  on?: boolean;
}

interface ScenePlugin {
  id: string;
  params: SceneParam[];
}

interface SceneBank {
  plugin: ScenePlugin | null;
  shader: ScenePlugin | null;
}

export interface SceneData {
  app: "marathon";
  v: 1;
  banks: SceneBank[];
  active: number;
  focus: FocusPart;
}

function snapshotPlugin(plugin: Plugin): ScenePlugin {
  const params: SceneParam[] = plugin.params.map((p) =>
    p instanceof Param ? { name: p.name, value: p.value } : { name: p.name, count: p.count, on: p.on },
  );
  return { id: plugin.id, params };
}

export function serializeScene(stage: Stage): SceneData {
  return {
    app: "marathon",
    v: 1,
    banks: stage.banks.map((bank) => ({
      plugin: bank.plugin ? snapshotPlugin(bank.plugin) : null,
      shader: bank.shader ? snapshotPlugin(bank.shader) : null,
    })),
    active: stage.active,
    focus: stage.focusPart,
  };
}

/** Instantiate a stored plugin and restore its param values. Null if the id no longer exists. */
function revivePlugin(state: ScenePlugin): Plugin | null {
  let plugin: Plugin;
  try {
    plugin = create(state.id);
  } catch {
    console.warn(`[scene] unknown plugin "${state.id}" — skipping`);
    return null;
  }
  const byName = new Map(plugin.params.map((p) => [p.name, p]));
  for (const saved of state.params) {
    const target = byName.get(saved.name);
    if (!target) continue;
    if (target instanceof Param && typeof saved.value === "number") {
      target.set(saved.value);
      target.snap(); // land immediately — a scene load shouldn't ease in from the defaults
    } else if (target instanceof ButtonParam) {
      if (typeof saved.count === "number") target.count = saved.count;
      if (typeof saved.on === "boolean") target.on = saved.on;
    }
  }
  return plugin;
}

/** Replace the stage's banks with the scene's. Anything currently loaded is disposed. */
export function applyScene(stage: Stage, scene: SceneData): void {
  for (let i = 0; i < BANK_COUNT; i++) {
    stage.clearBank(i);
    const bank = scene.banks[i];
    if (!bank?.plugin) continue;
    const plugin = revivePlugin(bank.plugin);
    if (!plugin) continue;
    stage.loadBank(i, plugin);
    if (bank.shader) stage.setShader(i, revivePlugin(bank.shader));
  }
  // loadBank moved focus as it went — restore the scene's own selection last.
  const active = Math.min(BANK_COUNT - 1, Math.max(0, scene.active | 0));
  if (stage.banks[active].plugin) stage.selectBank(active);
  stage.focusPart = scene.focus === "shader" && stage.banks[stage.active].shader ? "shader" : "plugin";
}

/** Parse + shape-check scene JSON (from a PNG chunk or anywhere else). Null if it isn't a scene. */
export function parseScene(json: string): SceneData | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const s = raw as Partial<SceneData> | null;
  if (!s || s.app !== "marathon" || s.v !== 1 || !Array.isArray(s.banks)) return null;
  return s as SceneData;
}
