/**
 * Dev-authored app defaults: what the stage boots with. Unlocked via the `#admin` URL hash — the
 * controls panel then shows "save as app default" buttons that snapshot the current bank setup so
 * defaults are configured visually instead of hand-written. Plugins and shaders are SEPARATE
 * snapshots (separate keys, separate buttons), so either side can be re-saved without touching
 * the other. Stored in localStorage; a snapshot naming a plugin that no longer exists is skipped.
 */
import { ButtonParam, Param } from "@/controls/Param";
import type { Plugin } from "@/plugins/Plugin";
import { create, list } from "@/plugins/registry";
import type { Stage } from "@/runtime/Stage";

const PLUGIN_KEY = "marathon.appDefaults.plugins.v1";
const SHADER_KEY = "marathon.appDefaults.shaders.v1";

/** One loaded plugin, frozen: its registry id plus every param's live value by field name. */
interface PluginSnapshot {
  id: string;
  values: Record<string, number | { count: number; on: boolean }>;
}

/** One entry per bank, null where the bank (or its shader slot) is empty. */
type BankSnapshots = (PluginSnapshot | null)[];

/** The `#admin` hash unlocks the default-saving dev surface. */
export function isAdmin(): boolean {
  return typeof window !== "undefined" && window.location.hash.startsWith("#admin");
}

function snapshot(p: Plugin | null): PluginSnapshot | null {
  if (!p) return null;
  const values: PluginSnapshot["values"] = {};
  for (const param of p.params) {
    if (!param.name) continue;
    values[param.name] = param instanceof Param ? param.value : { count: param.count, on: param.on };
  }
  return { id: p.id, values };
}

function restore(snap: PluginSnapshot | null): Plugin | null {
  if (!snap || !list().some((e) => e.id === snap.id)) return null;
  const plugin = create(snap.id);
  for (const param of plugin.params) {
    const v = snap.values[param.name];
    if (param instanceof Param && typeof v === "number") param.set(v);
    else if (param instanceof ButtonParam && typeof v === "object" && v !== null) {
      param.count = v.count;
      param.on = v.on;
    }
  }
  return plugin;
}

function read(key: string): BankSnapshots {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.map((r) =>
      r && typeof r === "object" && typeof r.id === "string" && r.values && typeof r.values === "object"
        ? (r as PluginSnapshot)
        : null,
    );
  } catch {
    return [];
  }
}

function write(key: string, snaps: BankSnapshots): void {
  try {
    localStorage.setItem(key, JSON.stringify(snaps));
  } catch {
    /* storage full/blocked — dev surface, fail silently */
  }
}

/** Freeze the current per-bank generators (which plugin, all param values) as the boot default. */
export function saveDefaultPlugins(stage: Stage): void {
  write(PLUGIN_KEY, stage.banks.map((b) => snapshot(b.plugin)));
}

/** Freeze the current per-bank shaders as the boot default — independent of the plugin snapshot. */
export function saveDefaultShaders(stage: Stage): void {
  write(SHADER_KEY, stage.banks.map((b) => snapshot(b.shader)));
}

export function clearAppDefaults(): void {
  try {
    localStorage.removeItem(PLUGIN_KEY);
    localStorage.removeItem(SHADER_KEY);
  } catch {
    /* ignore */
  }
}

/** Materialise the saved defaults onto a fresh stage (called once at boot, before first render). */
export function applyAppDefaults(stage: Stage): void {
  const pluginSnaps = read(PLUGIN_KEY);
  const shaderSnaps = read(SHADER_KEY);
  let first = -1;
  for (let i = 0; i < stage.banks.length; i++) {
    const plugin = restore(pluginSnaps[i] ?? null);
    if (plugin) {
      stage.loadBank(i, plugin);
      if (first < 0) first = i;
    }
    const shader = restore(shaderSnaps[i] ?? null);
    if (shader && stage.banks[i].plugin) stage.setShader(i, shader);
  }
  if (first >= 0) {
    stage.active = first;
    stage.focusPart = "plugin";
  }
}
