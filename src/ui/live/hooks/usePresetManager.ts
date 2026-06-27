/**
 * Owns the MIDI preset list: loading/saving to localStorage, all mutation helpers (rename,
 * duplicate, delete, import/export, per-control edits). Pure preset state — no MIDI, no engine.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { MidiManager } from "@/midi/MidiManager";
import type { ControlKind } from "@/midi/types";
import {
  autoAssign,
  createPreset,
  defaultKindFor,
  duplicatePreset,
  effectiveControls,
  exportPreset,
  loadActiveId,
  loadPresets,
  parsePreset,
  saveActiveId,
  savePresets,
  type ControlAssignment,
  type ControlMapping,
  type MidiPreset,
} from "@/midi/preset";

function bootPresets() {
  let ps = loadPresets();
  if (!ps.length) ps = [createPreset("Default")];
  let id = loadActiveId();
  if (!id || !ps.some((p) => p.id === id)) id = ps[0].id;
  return { ps, id };
}

export function usePresetManager(midi: MidiManager, midiRev: number) {
  const boot = useMemo(() => bootPresets(), []);

  const [presets, setPresets] = useState<MidiPreset[]>(boot.ps);
  const [activeId, setActiveId] = useState<string>(boot.id);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const activePreset = useMemo(
    () => presets.find((p) => p.id === activeId) ?? null,
    [presets, activeId],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const controls = useMemo(() => effectiveControls(midi.list(), activePreset), [midi, midiRev, activePreset]);
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  const activePresetRef = useRef<MidiPreset | null>(activePreset);
  activePresetRef.current = activePreset;

  const updateActive = useCallback((mut: (p: MidiPreset) => MidiPreset) => {
    setPresets((prev) => {
      const next = prev.map((p) => (p.id === activeIdRef.current ? { ...mut(p), updatedAt: Date.now() } : p));
      savePresets(next);
      return next;
    });
  }, []);

  const ensureMapping = useCallback(
    (p: MidiPreset, id: string): ControlMapping =>
      p.controls[id] ?? {
        controlId: id,
        name: midi.get(id)?.label ?? id,
        kind: defaultKindFor(midi.get(id) ?? { continuous: true, relative: false, subtype: "knob" }),
        assignment: "none",
      },
    [midi],
  );

  const bindAssignment = useCallback(
    (controlId: string, a: ControlAssignment, preferKind?: ControlKind) => {
      updateActive((p) => {
        const next: Record<string, ControlMapping> = { ...p.controls };
        for (const [id, m] of Object.entries(next)) {
          if (id !== controlId && m.assignment === a) next[id] = { ...m, assignment: "none" };
        }
        const mapping = { ...ensureMapping(p, controlId), assignment: a };
        if (preferKind) mapping.kind = preferKind;
        next[controlId] = mapping;
        return { ...p, controls: next };
      });
    },
    [updateActive, ensureMapping],
  );

  const renameControl = useCallback(
    (id: string, name: string) =>
      updateActive((p) => ({ ...p, controls: { ...p.controls, [id]: { ...ensureMapping(p, id), name } } })),
    [updateActive, ensureMapping],
  );

  const setControlKind = useCallback(
    (id: string, kind: ControlKind) =>
      updateActive((p) => ({ ...p, controls: { ...p.controls, [id]: { ...ensureMapping(p, id), kind } } })),
    [updateActive, ensureMapping],
  );

  const setControlAssignment = useCallback(
    (id: string, assignment: ControlAssignment) =>
      updateActive((p) => ({ ...p, controls: { ...p.controls, [id]: { ...ensureMapping(p, id), assignment } } })),
    [updateActive, ensureMapping],
  );

  const setControlDisabled = useCallback(
    (id: string, disabled: boolean) => {
      midi.setOverride(id, { disabled });
      updateActive((p) => ({ ...p, controls: { ...p.controls, [id]: { ...ensureMapping(p, id), disabled } } }));
    },
    [updateActive, ensureMapping, midi],
  );

  const resetControl = useCallback(
    (id: string) => {
      midi.setOverride(id, null);
      updateActive((p) => {
        const c = { ...p.controls };
        delete c[id];
        return { ...p, controls: c };
      });
    },
    [updateActive, midi],
  );

  const applyAutoAssign = useCallback(() => {
    const map = autoAssign(controlsRef.current);
    updateActive((p) => {
      const next = { ...p.controls };
      for (const [id, assignment] of Object.entries(map)) {
        next[id] = { ...ensureMapping(p, id), assignment };
      }
      return { ...p, controls: next };
    });
  }, [updateActive, ensureMapping]);

  const selectPreset = useCallback((id: string) => {
    setActiveId(id);
    saveActiveId(id);
  }, []);

  const createNewPreset = useCallback(
    (name?: string) => {
      const device = midi.devices()[0]?.name;
      const p = createPreset(name?.trim() || "New preset", device);
      setPresets((prev) => {
        const next = [...prev, p];
        savePresets(next);
        return next;
      });
      selectPreset(p.id);
    },
    [midi, selectPreset],
  );

  const renamePreset = useCallback((id: string, name: string) => {
    setPresets((prev) => {
      const next = prev.map((p) =>
        p.id === id ? { ...p, name: name.trim() || p.name, updatedAt: Date.now() } : p,
      );
      savePresets(next);
      return next;
    });
  }, []);

  const duplicateActive = useCallback(() => {
    setPresets((prev) => {
      const src = prev.find((p) => p.id === activeIdRef.current);
      if (!src) return prev;
      const copy = duplicatePreset(src);
      const next = [...prev, copy];
      savePresets(next);
      saveActiveId(copy.id);
      setActiveId(copy.id);
      return next;
    });
  }, []);

  const deletePreset = useCallback((id: string) => {
    setPresets((prev) => {
      let next = prev.filter((p) => p.id !== id);
      if (!next.length) next = [createPreset("Default")];
      savePresets(next);
      if (activeIdRef.current === id) {
        setActiveId(next[0].id);
        saveActiveId(next[0].id);
      }
      return next;
    });
  }, []);

  const importPresetJson = useCallback(
    (json: string) => {
      const p = parsePreset(json);
      if (!p) return false;
      setPresets((prev) => {
        const next = [...prev, p];
        savePresets(next);
        return next;
      });
      selectPreset(p.id);
      return true;
    },
    [selectPreset],
  );

  const exportActive = useCallback(
    () => (activePreset ? exportPreset(activePreset) : ""),
    [activePreset],
  );

  return {
    presets, activePreset, activePresetRef, controls, controlsRef,
    selectPreset, createNewPreset, renamePreset, duplicateActive, deletePreset,
    importPresetJson, exportActive,
    renameControl, setControlKind, setControlAssignment, setControlDisabled, resetControl,
    applyAutoAssign, bindAssignment,
    boot,
  };
}
