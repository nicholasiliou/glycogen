import * as React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useEngine } from "@/ui/engine/EngineProvider";
import type { Registry } from "@/engine";
import { MidiManager } from "@/midi/MidiManager";
import type { ControlKind, ControlOverride } from "@/midi/types";
import {
  assignmentDeck,
  assignmentSlot,
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
  SLOT_META,
  type ControlAssignment,
  type ControlMapping,
  type Deck,
  type EffectiveControl,
  type MidiPreset,
} from "@/midi/preset";
import { AudioEngine } from "@/audio/AudioEngine";
import { LivePerformer } from "@/audio/LivePerformer";
import type { ScaleName } from "@/audio/scale";
import { clamp, clamp01, driveContinuousSlot, fireMomentarySlot, macroMapFor } from "./macros";

interface LiveContextValue {
  midi: MidiManager;
  audio: AudioEngine;
  performer: LivePerformer;
  started: boolean;
  startAudio: () => Promise<void>;
  /** Bumps whenever a MIDI device/control is (re)discovered. */
  midiRev: number;

  // ── browse + decks ──
  types: string[];
  selectedType: string;
  setSelectedType: (t: string) => void;
  deckA: string | null;
  deckB: string | null;
  loadDeck: (deck: Deck) => void;
  clearDeck: (deck: Deck) => void;
  crossfade: number;
  setCrossfade: (x: number) => void;

  // ── MIDI keymap (the persistent preset) ──
  presets: MidiPreset[];
  activePreset: MidiPreset | null;
  controls: EffectiveControl[];
  selectPreset: (id: string) => void;
  createNewPreset: (name?: string) => void;
  renamePreset: (id: string, name: string) => void;
  duplicateActive: () => void;
  deletePreset: (id: string) => void;
  importPresetJson: (json: string) => boolean;
  exportActive: () => string;
  renameControl: (id: string, name: string) => void;
  setControlKind: (id: string, kind: ControlKind) => void;
  setControlAssignment: (id: string, assignment: ControlAssignment) => void;
  setControlDisabled: (id: string, disabled: boolean) => void;
  resetControl: (id: string) => void;
  applyAutoAssign: () => void;
  forgetDevice: () => void;

  // ── transport / audio ──
  master: number;
  setMaster: (v: number) => void;
  bpm: number;
  setBpm: (v: number) => void;
  root: number;
  scale: ScaleName;
  setKey: (root: number, scale: ScaleName) => void;
}

const LiveContext = createContext<LiveContextValue | null>(null);

/** Layer types offered on the stage: everything except pure containers. */
function selectableTypes(registry: Registry): string[] {
  return registry
    .all()
    .filter((d) => d.kind !== "group" && d.kind !== "layout" && d.type !== "null")
    .map((d) => d.type);
}

function presetToOverrides(preset: MidiPreset | null): Record<string, ControlOverride> {
  const map: Record<string, ControlOverride> = {};
  if (preset)
    for (const m of Object.values(preset.controls)) map[m.controlId] = { name: m.name, kind: m.kind, disabled: m.disabled };
  return map;
}

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const engine = useEngine();
  const midi = useMemo(() => new MidiManager(), []);
  const audio = useMemo(() => new AudioEngine(), []);
  const performer = useMemo(() => new LivePerformer(engine, audio), [engine, audio]);
  const types = useMemo(() => selectableTypes(engine.registry), [engine]);

  const boot = useMemo(() => {
    let ps = loadPresets();
    if (!ps.length) ps = [createPreset("Default")];
    let id = loadActiveId();
    if (!id || !ps.some((p) => p.id === id)) id = ps[0].id;
    return { ps, id };
  }, []);

  const [started, setStarted] = useState(false);
  const [midiRev, setMidiRev] = useState(0);
  const [selectedType, setSelectedType] = useState("");
  const [deckA, setDeckA] = useState<string | null>(null);
  const [deckB, setDeckB] = useState<string | null>(null);
  const [crossfade, setCrossfadeState] = useState(0.5);
  const [presets, setPresets] = useState<MidiPreset[]>(boot.ps);
  const [activeId, setActiveId] = useState<string>(boot.id);
  const [master, setMasterState] = useState(0.9);
  const [bpm, setBpmState] = useState(110);
  const [root, setRoot] = useState(48);
  const [scale, setScale] = useState<ScaleName>("minorPentatonic");

  const activePreset = useMemo(() => presets.find((p) => p.id === activeId) ?? null, [presets, activeId]);
  // `midi.list()` isn't reactive; midiRev is the intentional signal that a control was (re)learned.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const controls = useMemo(() => effectiveControls(midi.list(), activePreset), [midi, midiRev, activePreset]);

  // Refs so the once-bound MIDI handlers + stable callbacks always read current values.
  const activePresetRef = useRef<MidiPreset | null>(activePreset);
  const controlsRef = useRef<EffectiveControl[]>(controls);
  const activeIdRef = useRef(activeId);
  const selectedTypeRef = useRef("");
  const typesRef = useRef<string[]>(types);
  const deckARef = useRef<string | null>(null);
  const deckBRef = useRef<string | null>(null);
  const crossfadeRef = useRef(0);
  const browseAccumRef = useRef(0);
  activePresetRef.current = activePreset;
  controlsRef.current = controls;
  activeIdRef.current = activeId;
  selectedTypeRef.current = selectedType;
  typesRef.current = types;
  deckARef.current = deckA;
  deckBRef.current = deckB;
  crossfadeRef.current = crossfade;

  useEffect(() => {
    savePresets(boot.ps);
    saveActiveId(boot.id);
  }, [boot]);

  useEffect(() => {
    if (!selectedType && types.length) setSelectedType(types.includes("physarum") ? "physarum" : types[0]);
  }, [types, selectedType]);

  // ── live continuity: run forward forever, never loop-reset, auto-play ──
  useEffect(() => {
    engine.setLoop(false);
    if (engine.comp.duration < 3600) engine.setCompositionSettings({ duration: 36000 });
    engine.play();
  }, [engine]);

  // ── push the active preset down so retypes/renames/disables take effect live ──
  useEffect(() => {
    midi.applyOverrides(presetToOverrides(activePreset));
  }, [midi, activePreset]);

  // ── deck opacity crossfade (equal-power); audio is left untouched (stays derived) ──
  const setOpacity = useCallback(
    (layerId: string | null, gain: number) => {
      if (!layerId) return;
      const layer = engine.getLayer(layerId);
      if (!layer) return;
      const op = layer.transform("opacity");
      engine.setPropertyValue(layerId, op.id, clamp(gain, 0, 1) * 100, true);
    },
    [engine],
  );
  const applyCrossfade = useCallback(
    (x: number, aId: string | null, bId: string | null) => {
      const t = clamp01(x);
      const both = !!aId && !!bId;
      if (aId) setOpacity(aId, both ? Math.cos((t * Math.PI) / 2) : 1);
      if (bId) setOpacity(bId, both ? Math.sin((t * Math.PI) / 2) : 1);
    },
    [setOpacity],
  );
  const setCrossfade = useCallback(
    (x: number) => {
      const v = clamp01(x);
      setCrossfadeState(v);
      applyCrossfade(v, deckARef.current, deckBRef.current);
    },
    [applyCrossfade],
  );

  const loadDeck = useCallback(
    (deck: Deck) => {
      const type = selectedTypeRef.current;
      if (!type) return;
      const prev = deck === "A" ? deckARef.current : deckBRef.current;
      if (prev) engine.removeLayers([prev]);
      const layer = engine.addLayer(type);
      if (!layer) return;
      if (deck === "A") {
        deckARef.current = layer.id;
        setDeckA(layer.id);
      } else {
        deckBRef.current = layer.id;
        setDeckB(layer.id);
      }
      applyCrossfade(crossfadeRef.current, deckARef.current, deckBRef.current);
    },
    [engine, applyCrossfade],
  );

  const clearDeck = useCallback(
    (deck: Deck) => {
      const id = deck === "A" ? deckARef.current : deckBRef.current;
      if (id) engine.removeLayers([id]);
      if (deck === "A") {
        deckARef.current = null;
        setDeckA(null);
      } else {
        deckBRef.current = null;
        setDeckB(null);
      }
    },
    [engine],
  );

  // ── keymap mutation helpers (auto-save) ──
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
      const next = prev.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name, updatedAt: Date.now() } : p));
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
  const exportActive = useCallback(() => (activePreset ? exportPreset(activePreset) : ""), [activePreset]);
  const forgetDevice = useCallback(() => {
    midi.forget();
    setMidiRev((r) => r + 1);
  }, [midi]);

  // ── MIDI runtime (bound once; reads live state via refs) ──
  useEffect(() => {
    performer.start();
    midi.enable();

    const browseStep = (dir: number) => {
      const list = typesRef.current;
      if (!list.length) return;
      const i = Math.max(0, list.indexOf(selectedTypeRef.current));
      setSelectedType(list[(i + dir + list.length) % list.length]);
    };
    const browseTo = (u: number) => {
      const list = typesRef.current;
      if (!list.length) return;
      setSelectedType(list[Math.round(clamp01(u) * (list.length - 1))]);
    };
    const deckLayer = (deck: Deck) => {
      const id = deck === "A" ? deckARef.current : deckBRef.current;
      return id ? engine.getLayer(id) : null;
    };

    const offs = [
      midi.on("discover", () => setMidiRev((r) => r + 1)),
      midi.on("devices", () => setMidiRev((r) => r + 1)),
      midi.on("status", () => setMidiRev((r) => r + 1)),
      midi.on("control", (e) => {
        const ctl = e.control;
        const m = activePresetRef.current?.controls[ctl.id];
        if (!m || m.disabled) return;
        if (m.assignment === "browse") {
          if (ctl.relative) {
            browseAccumRef.current += ctl.delta;
            const STEP = 3;
            while (browseAccumRef.current >= STEP) {
              browseStep(1);
              browseAccumRef.current -= STEP;
            }
            while (browseAccumRef.current <= -STEP) {
              browseStep(-1);
              browseAccumRef.current += STEP;
            }
          } else {
            browseTo(ctl.value);
          }
          return;
        }
        if (m.assignment === "crossfade") {
          setCrossfade(ctl.value);
          return;
        }
        const deck = assignmentDeck(m.assignment);
        const slot = assignmentSlot(m.assignment);
        if (!deck || !slot || !SLOT_META[slot].continuous) return;
        const layer = deckLayer(deck);
        if (!layer) return;
        const schema = engine.registry.get(layer.type)?.schema ?? [];
        const macro = macroMapFor(layer.type, schema);
        const spec = macro[slot as "amount" | "evolveX" | "evolveY" | "toneX" | "toneY"];
        if (spec) driveContinuousSlot(engine, layer, schema, spec, ctl);
      }),
      midi.on("trigger", (c) => {
        const m = activePresetRef.current?.controls[c.id];
        if (!m || m.disabled) return;
        if (m.assignment === "loadA") return loadDeck("A");
        if (m.assignment === "loadB") return loadDeck("B");
        const deck = assignmentDeck(m.assignment);
        const slot = assignmentSlot(m.assignment);
        if (!deck || !slot || SLOT_META[slot].continuous) return;
        const layer = deckLayer(deck);
        if (!layer) return;
        const schema = engine.registry.get(layer.type)?.schema ?? [];
        const macro = macroMapFor(layer.type, schema);
        const spec = macro[slot as "trigger" | "toggle"];
        if (spec) fireMomentarySlot(engine, layer, schema, slot as "trigger" | "toggle", spec);
      }),
    ];
    return () => {
      offs.forEach((o) => o());
      performer.dispose();
      midi.dispose();
      audio.dispose();
    };
  }, [engine, midi, audio, performer, loadDeck, setCrossfade]);

  const startAudio = useCallback(async () => {
    await audio.start();
    audio.setBpm(bpm);
    audio.setKey(root, scale);
    audio.setMasterLevel(master);
    setStarted(true);
  }, [audio, bpm, root, scale, master]);

  const setMaster = useCallback((v: number) => { setMasterState(v); audio.setMasterLevel(v); }, [audio]);
  const setBpm = useCallback((v: number) => { setBpmState(v); audio.setBpm(v); }, [audio]);
  const setKey = useCallback((r: number, s: ScaleName) => { setRoot(r); setScale(s); audio.setKey(r, s); }, [audio]);

  const value: LiveContextValue = {
    midi, audio, performer, started, startAudio, midiRev,
    types, selectedType, setSelectedType, deckA, deckB, loadDeck, clearDeck, crossfade, setCrossfade,
    presets, activePreset, controls,
    selectPreset, createNewPreset, renamePreset, duplicateActive, deletePreset, importPresetJson, exportActive,
    renameControl, setControlKind, setControlAssignment, setControlDisabled, resetControl, applyAutoAssign, forgetDevice,
    master, setMaster, bpm, setBpm, root, scale, setKey,
  };

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive must be used within <LiveProvider>");
  return ctx;
}
