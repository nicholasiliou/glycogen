import { useEffect, useMemo, useState } from "react";
import type { MidiManager } from "@/midi/MidiManager";
import {
  autoAssign,
  createKeymap,
  effectiveControls,
  loadActiveId,
  loadKeymaps,
  saveActiveId,
  saveKeymaps,
  type Binding,
  type Keymap,
} from "@/midi/keymap";
import type { ControlKind } from "@/midi/types";

/** The keymap-editing surface exposed to the settings UI. */
export interface KeymapCtx {
  midi: MidiManager;
  keymaps: Keymap[];
  active: Keymap | null;
  activeId: string | null;
  setActive: (id: string | null) => void;
  create: () => void;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  bind: (controlId: string, name: string, kind: ControlKind, binding: Binding | null) => void;
  setDisabled: (controlId: string, name: string, kind: ControlKind, disabled: boolean) => void;
  autoAssign: () => void;
}

export interface UseKeymaps {
  activeKeymap: Keymap | null;
  /** Patch the active keymap, creating one first if none exists. */
  patchActive: (mutate: (k: Keymap) => Keymap) => void;
  /** The editing surface handed to the settings UI. */
  keymap: KeymapCtx;
}

/**
 * Persistent named MIDI keymaps: localStorage-backed list + active selection, mutation helpers,
 * and pushing the active map's per-control overrides (name/kind/disabled) down to the manager so a
 * corrected control type takes effect live.
 */
export function useKeymaps(midi: MidiManager): UseKeymaps {
  const [keymaps, setKeymaps] = useState<Keymap[]>(() => loadKeymaps());
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveId());
  const activeKeymap = useMemo(() => keymaps.find((k) => k.id === activeId) ?? null, [keymaps, activeId]);

  useEffect(() => saveKeymaps(keymaps), [keymaps]);
  useEffect(() => saveActiveId(activeId), [activeId]);

  // Apply the active keymap's overrides and reset LEDs when the map changes.
  useEffect(() => {
    const overrides: Record<string, { name?: string; kind?: ControlKind; disabled?: boolean }> = {};
    for (const c of Object.values(activeKeymap?.controls ?? {})) {
      overrides[c.controlId] = { name: c.name, kind: c.kind, disabled: c.disabled };
    }
    midi.applyOverrides(overrides);
    if (midi.status === "ready") midi.allLedsOff();
  }, [activeKeymap, midi]);

  const ensureActive = (): Keymap => {
    if (activeKeymap) return activeKeymap;
    const k = createKeymap("Keymap 1", midi.devices()[0]?.name);
    setKeymaps((ks) => [...ks, k]);
    setActiveId(k.id);
    return k;
  };

  const patchActive = (mutate: (k: Keymap) => Keymap) => {
    const base = ensureActive();
    setKeymaps((ks) => ks.map((k) => (k.id === base.id ? { ...mutate(k), updatedAt: Date.now() } : k)));
  };

  const keymap: KeymapCtx = {
    midi,
    keymaps,
    active: activeKeymap,
    activeId,
    setActive: setActiveId,
    create: () => {
      const k = createKeymap(`Keymap ${keymaps.length + 1}`, midi.devices()[0]?.name);
      setKeymaps((ks) => [...ks, k]);
      setActiveId(k.id);
    },
    remove: (id) => {
      setKeymaps((ks) => ks.filter((k) => k.id !== id));
      setActiveId((cur) => (cur === id ? null : cur));
    },
    rename: (id, name) => setKeymaps((ks) => ks.map((k) => (k.id === id ? { ...k, name, updatedAt: Date.now() } : k))),
    bind: (controlId, name, kind, binding) =>
      patchActive((k) => ({
        ...k,
        controls: { ...k.controls, [controlId]: { controlId, name, kind, binding, disabled: k.controls[controlId]?.disabled } },
      })),
    setDisabled: (controlId, name, kind, disabled) =>
      patchActive((k) => ({
        ...k,
        controls: { ...k.controls, [controlId]: { ...k.controls[controlId], controlId, name, kind, binding: k.controls[controlId]?.binding ?? null, disabled } },
      })),
    autoAssign: () =>
      patchActive((k) => {
        const eff = effectiveControls(midi.list(), k);
        const plan = autoAssign(eff);
        const controls = { ...k.controls };
        for (const c of eff) {
          const binding = plan[c.id] ?? c.binding;
          controls[c.id] = { controlId: c.id, name: c.name, kind: c.kind, binding, disabled: c.disabled };
        }
        return { ...k, controls };
      }),
  };

  return { activeKeymap, patchActive, keymap };
}
