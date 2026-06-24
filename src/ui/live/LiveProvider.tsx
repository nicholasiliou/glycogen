import * as React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useEngine } from "@/ui/engine/EngineProvider";
import type { Registry } from "@/engine";
import { MidiManager } from "@/midi/MidiManager";
import type { ControlKind, ControlOverride } from "@/midi/types";
import {
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
  type EffectiveControl,
  type MidiPreset,
  type PerformanceRole,
} from "@/midi/preset";
import { AudioEngine } from "@/audio/AudioEngine";
import { LivePerformer } from "@/audio/LivePerformer";
import type { ScaleName } from "@/audio/scale";
import { applyRange, applyToggle, autoMapLayer, type ParamBinding } from "./autoMap";

interface LiveContextValue {
  midi: MidiManager;
  audio: AudioEngine;
  performer: LivePerformer;
  started: boolean;
  startAudio: () => Promise<void>;
  /** Bumps whenever a MIDI device/control is (re)discovered. */
  midiRev: number;

  // ── stage / sundial ──
  /** Every selectable layer type, in a stable order shared with the sundial + jog wheel. */
  types: string[];
  selectedType: string;
  setSelectedType: (t: string) => void;
  addToStage: (type: string) => void;
  removeActive: () => void;
  activeLayerId: string | null;
  setActiveLayer: (id: string) => void;
  bindings: ParamBinding[];

  // ── MIDI keymap (the persistent preset) ──
  presets: MidiPreset[];
  activePreset: MidiPreset | null;
  /** Live stream ∪ active preset, ready to render in the settings table. */
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
  resetControl: (id: string) => void;
  forgetDevice: () => void;
  setRole: (role: PerformanceRole, controlId: string | null) => void;
  /** Which performance role (if any) is currently waiting for a control to be touched. */
  learning: PerformanceRole | null;
  setLearning: (r: PerformanceRole | null) => void;

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
  if (preset) for (const m of Object.values(preset.controls)) map[m.controlId] = { name: m.name, kind: m.kind };
  return map;
}

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const engine = useEngine();
  const midi = useMemo(() => new MidiManager(), []);
  const audio = useMemo(() => new AudioEngine(), []);
  const performer = useMemo(() => new LivePerformer(engine, audio), [engine, audio]);
  const types = useMemo(() => selectableTypes(engine.registry), [engine]);

  // Bootstrap the keymap: stored presets (or a fresh default), and a valid active selection.
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
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [bindings, setBindings] = useState<ParamBinding[]>([]);
  const [presets, setPresets] = useState<MidiPreset[]>(boot.ps);
  const [activeId, setActiveId] = useState<string>(boot.id);
  const [learning, setLearning] = useState<PerformanceRole | null>(null);
  const [master, setMasterState] = useState(0.9);
  const [bpm, setBpmState] = useState(110);
  const [root, setRoot] = useState(48);
  const [scale, setScale] = useState<ScaleName>("minorPentatonic");

  const activePreset = useMemo(() => presets.find((p) => p.id === activeId) ?? null, [presets, activeId]);
  // `midi.list()` isn't reactive; midiRev is the intentional signal that a control was (re)learned.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const controls = useMemo(() => effectiveControls(midi.list(), activePreset), [midi, midiRev, activePreset]);

  // Refs so the once-bound MIDI handlers always read current values.
  const bindingsRef = useRef<ParamBinding[]>([]);
  const rolesRef = useRef<MidiPreset["roles"]>({});
  const learningRef = useRef<PerformanceRole | null>(null);
  const activeIdRef = useRef(activeId);
  const selectedTypeRef = useRef("");
  const activeLayerIdRef = useRef<string | null>(null);
  const typesRef = useRef<string[]>(types);
  const wheelAccumRef = useRef(0);
  bindingsRef.current = bindings;
  rolesRef.current = activePreset?.roles ?? {};
  learningRef.current = learning;
  activeIdRef.current = activeId;
  selectedTypeRef.current = selectedType;
  activeLayerIdRef.current = activeLayerId;
  typesRef.current = types;

  // Persist the bootstrap (writes the freshly-created default the first time).
  useEffect(() => {
    savePresets(boot.ps);
    saveActiveId(boot.id);
  }, [boot]);

  // Pick an initial selection once the type list is known.
  useEffect(() => {
    if (!selectedType && types.length) setSelectedType(types.includes("physarum") ? "physarum" : types[0]);
  }, [types, selectedType]);

  // ── live continuity: run forward forever, never loop-reset, auto-play ──
  useEffect(() => {
    engine.setLoop(false);
    if (engine.comp.duration < 3600) engine.setCompositionSettings({ duration: 36000 });
    engine.play();
  }, [engine]);

  // ── push the active preset down so retypes/renames change interpretation live ──
  useEffect(() => {
    midi.applyOverrides(presetToOverrides(activePreset));
  }, [midi, activePreset]);

  // ── keymap mutation helpers (all auto-save) ──
  const updateActive = useCallback((mut: (p: MidiPreset) => MidiPreset) => {
    setPresets((prev) => {
      const next = prev.map((p) => (p.id === activeIdRef.current ? { ...mut(p), updatedAt: Date.now() } : p));
      savePresets(next);
      return next;
    });
  }, []);

  const setRole = useCallback(
    (role: PerformanceRole, controlId: string | null) => {
      updateActive((p) => {
        const roles = { ...p.roles };
        if (controlId) roles[role] = controlId;
        else delete roles[role];
        return { ...p, roles };
      });
    },
    [updateActive],
  );

  const renameControl = useCallback(
    (id: string, name: string) => {
      updateActive((p) => {
        const kind = p.controls[id]?.kind ?? defaultKindFor(midi.get(id) ?? { continuous: true, relative: false, subtype: "knob" });
        return { ...p, controls: { ...p.controls, [id]: { controlId: id, name, kind } } };
      });
    },
    [updateActive, midi],
  );

  const setControlKind = useCallback(
    (id: string, kind: ControlKind) => {
      updateActive((p) => {
        const name = p.controls[id]?.name ?? midi.get(id)?.label ?? id;
        return { ...p, controls: { ...p.controls, [id]: { controlId: id, name, kind } } };
      });
    },
    [updateActive, midi],
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

    const stepSel = (dir: number) => {
      const list = typesRef.current;
      if (!list.length) return;
      const i = Math.max(0, list.indexOf(selectedTypeRef.current));
      setSelectedType(list[(i + dir + list.length) % list.length]);
    };
    const selByUnit = (u: number) => {
      const list = typesRef.current;
      if (!list.length) return;
      const c = u < 0 ? 0 : u > 1 ? 1 : u;
      setSelectedType(list[Math.round(c * (list.length - 1))]);
    };
    const assignRole = (role: PerformanceRole, id: string) => {
      setRole(role, id);
      setLearning(null);
    };

    const offs = [
      midi.on("discover", () => setMidiRev((r) => r + 1)),
      midi.on("devices", () => setMidiRev((r) => r + 1)),
      midi.on("status", () => setMidiRev((r) => r + 1)),
      midi.on("control", (e) => {
        const ctl = e.control;
        // Learning a continuous role (the wheel): grab the first continuous move.
        if (learningRef.current) {
          if (learningRef.current === "wheel" && ctl.continuous) assignRole("wheel", ctl.id);
          return; // momentary roles are learned on trigger
        }
        const roles = rolesRef.current;
        // Reserved jog/wheel → spin the sundial.
        if (roles.wheel === ctl.id) {
          if (ctl.relative) {
            wheelAccumRef.current += ctl.delta;
            const STEP = 3;
            while (wheelAccumRef.current >= STEP) {
              stepSel(1);
              wheelAccumRef.current -= STEP;
            }
            while (wheelAccumRef.current <= -STEP) {
              stepSel(-1);
              wheelAccumRef.current += STEP;
            }
          } else {
            selByUnit(ctl.value);
          }
          return;
        }
        if (!ctl.continuous) return; // momentary handled on trigger
        const b = bindingsRef.current.find((x) => x.controlId === ctl.id && (x.kind === "range" || x.kind === "select"));
        if (b) applyRange(engine, b, ctl.value);
      }),
      midi.on("trigger", (c) => {
        // Learning a momentary role (add / remove): grab the first press.
        if (learningRef.current) {
          if (learningRef.current !== "wheel") assignRole(learningRef.current, c.id);
          return;
        }
        const roles = rolesRef.current;
        if (roles.add === c.id) {
          const l = engine.addLayer(selectedTypeRef.current);
          if (l) setActiveLayerId(l.id);
          return;
        }
        if (roles.remove === c.id) {
          const id = activeLayerIdRef.current;
          if (id) {
            engine.removeLayers([id]);
            setActiveLayerId(null);
          }
          return;
        }
        const b = bindingsRef.current.find((x) => x.controlId === c.id && (x.kind === "toggle" || x.kind === "trigger"));
        if (b) applyToggle(engine, b);
      }),
    ];
    return () => {
      offs.forEach((o) => o());
      performer.dispose();
      midi.dispose();
      audio.dispose();
    };
  }, [engine, midi, audio, performer, setRole]);

  // ── (re)build the binding table; exclude reserved performance controls ──
  useEffect(() => {
    const layer = activeLayerId ? engine.getLayer(activeLayerId) : undefined;
    const def = layer ? engine.registry.get(layer.type) : undefined;
    if (!layer || !def?.schema) {
      setBindings([]);
      return;
    }
    const roles = activePreset?.roles ?? {};
    const reserved = new Set([roles.wheel, roles.add, roles.remove].filter(Boolean) as string[]);
    setBindings(autoMapLayer(layer, def.schema, midi.list(), reserved));
  }, [engine, midi, activeLayerId, midiRev, activePreset]);

  const startAudio = useCallback(async () => {
    await audio.start();
    audio.setBpm(bpm);
    audio.setKey(root, scale);
    audio.setMasterLevel(master);
    setStarted(true);
  }, [audio, bpm, root, scale, master]);

  const addToStage = useCallback(
    (type: string) => {
      const layer = engine.addLayer(type);
      if (layer) setActiveLayerId(layer.id);
    },
    [engine],
  );
  const removeActive = useCallback(() => {
    const id = activeLayerIdRef.current;
    if (id) {
      engine.removeLayers([id]);
      setActiveLayerId(null);
    }
  }, [engine]);
  const setActiveLayer = useCallback(
    (id: string) => {
      setActiveLayerId(id);
      engine.select([id]);
    },
    [engine],
  );
  const setMaster = useCallback((v: number) => { setMasterState(v); audio.setMasterLevel(v); }, [audio]);
  const setBpm = useCallback((v: number) => { setBpmState(v); audio.setBpm(v); }, [audio]);
  const setKey = useCallback((r: number, s: ScaleName) => { setRoot(r); setScale(s); audio.setKey(r, s); }, [audio]);

  const value: LiveContextValue = {
    midi, audio, performer, started, startAudio, midiRev,
    types, selectedType, setSelectedType, addToStage, removeActive, activeLayerId, setActiveLayer, bindings,
    presets, activePreset, controls,
    selectPreset, createNewPreset, renamePreset, duplicateActive, deletePreset, importPresetJson, exportActive,
    renameControl, setControlKind, resetControl, forgetDevice, setRole, learning, setLearning,
    master, setMaster, bpm, setBpm, root, scale, setKey,
  };

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive must be used within <LiveProvider>");
  return ctx;
}
