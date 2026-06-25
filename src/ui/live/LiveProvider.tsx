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
  isMomentaryAssignment,
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
import { type TextSetting, textSettingOf } from "@/plugins/_shared/textField";
import { useRevision } from "@/ui/engine/EngineProvider";
import { AudioEngine } from "@/audio/AudioEngine";
import { LivePerformer } from "@/audio/LivePerformer";
import type { ScaleName } from "@/audio/scale";
import { clamp, clamp01, driveContinuousSlot, fireMomentarySlot, macroMapFor } from "./macros";
import { openLiveChannel, type LiveMessage, type LiveSnapshot } from "./liveChannel";

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
  /** The MIDI-managed ("active") layer for each side. */
  deckA: string | null;
  deckB: string | null;
  /** The stashed layer for each side: still rendering + sounding, just not MIDI-controlled. */
  deckAStash: string | null;
  deckBStash: string | null;
  loadDeck: (deck: Deck) => void;
  clearDeck: (deck: Deck) => void;
  /** Swap which of a side's two plugins the controller drives (the other keeps running). */
  swapDeck: (deck: Deck) => void;
  crossfade: number;
  setCrossfade: (x: number) => void;
  /** Current text-influence setting of the active deck plugin (for popup display). */
  textMode: TextSetting;

  // ── full-canvas shader (instagram-filter style; "none" = off) ──
  shaders: string[];
  shaderType: string;
  setShaderType: (type: string) => void;
  /** Whether the browse wheel scrolls plugins or shaders. */
  browseMode: "plugin" | "shader";
  toggleBrowseMode: () => void;

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

  // ── live driving + on-screen ("digital controller") mapping ──
  /** Apply a continuous assignment as if a control moved — drives the same paths as MIDI. */
  driveAssignment: (a: ControlAssignment, input: { value: number; delta?: number; relative?: boolean }) => void;
  /** Fire a momentary assignment (load / trigger / toggle). */
  fireAssignment: (a: ControlAssignment) => void;
  /** The assignment currently armed to learn the next moved control (or null). */
  learn: ControlAssignment | null;
  setLearn: (a: ControlAssignment | null) => void;
  /** Bind a physical control to an assignment, clearing any other control that held it. */
  bindAssignment: (controlId: string, a: ControlAssignment) => void;

  // ── transport / audio ──
  master: number;
  setMaster: (v: number) => void;
  bpm: number;
  setBpm: (v: number) => void;
  root: number;
  scale: ScaleName;
  setKey: (root: number, scale: ScaleName) => void;
}

export const LiveContext = createContext<LiveContextValue | null>(null);
export type { LiveContextValue };

/** Layer types offered on the stage: everything except pure containers and full-canvas shaders. */
function selectableTypes(registry: Registry): string[] {
  return registry
    .all()
    .filter((d) => d.kind !== "group" && d.kind !== "layout" && d.kind !== "effect" && d.type !== "null")
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

  // Each side holds two plugin slots; `managed` is the one the MIDI controller drives. Both slots
  // keep rendering + sounding — stashing just moves the controller's focus to the other slot.
  type DeckState = { slots: [string | null, string | null]; managed: 0 | 1 };
  const [decks, setDecks] = useState<{ A: DeckState; B: DeckState }>({
    A: { slots: [null, null], managed: 0 },
    B: { slots: [null, null], managed: 0 },
  });
  const deckA = decks.A.slots[decks.A.managed];
  const deckB = decks.B.slots[decks.B.managed];
  const deckAStash = decks.A.slots[decks.A.managed === 0 ? 1 : 0];
  const deckBStash = decks.B.slots[decks.B.managed === 0 ? 1 : 0];


  const [started, setStarted] = useState(false);
  const [midiRev, setMidiRev] = useState(0);
  const [selectedType, setSelectedType] = useState("");
  const [crossfade, setCrossfadeState] = useState(0.5);
  const [browseMode, setBrowseMode] = useState<"plugin" | "shader">("plugin");
  const [shaderType, setShaderTypeState] = useState("none");
  const [presets, setPresets] = useState<MidiPreset[]>(boot.ps);
  const [activeId, setActiveId] = useState<string>(boot.id);
  const [master, setMasterState] = useState(0.9);
  const [bpm, setBpmState] = useState(110);
  const [root, setRoot] = useState(48);
  const [scale, setScale] = useState<ScaleName>("minorPentatonic");
  const [learn, setLearnState] = useState<ControlAssignment | null>(null);
  const learnRef = useRef<ControlAssignment | null>(null);
  const setLearn = useCallback((a: ControlAssignment | null) => {
    learnRef.current = a;
    setLearnState(a);
  }, []);

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
  const decksRef = useRef(decks);
  const crossfadeRef = useRef(0);
  /** Timestamp of the last browse step — gates out the burst of messages a single detent emits. */
  const lastBrowseAtRef = useRef(0);
  const browseModeRef = useRef<"plugin" | "shader">("plugin");
  const shaderTypeRef = useRef("none");
  /** The engine layer id of the active full-canvas shader (null when "none"). */
  const shaderLayerIdRef = useRef<string | null>(null);
  // Coalescing buffer for continuous drives (flushed once per animation frame — see driveAssignment).
  const pendingDriveRef = useRef<Map<ControlAssignment, { value: number; delta: number; relative: boolean }>>(new Map());
  const driveRafRef = useRef(0);
  /** Last press state per control id, for momentary actions bound to continuous-detected controls. */
  const pressEdgeRef = useRef<Map<string, boolean>>(new Map());
  activePresetRef.current = activePreset;
  controlsRef.current = controls;
  activeIdRef.current = activeId;
  selectedTypeRef.current = selectedType;
  typesRef.current = types;
  decksRef.current = decks;
  crossfadeRef.current = crossfade;
  browseModeRef.current = browseMode;
  shaderTypeRef.current = shaderType;

  /** The MIDI-managed layer id for a side (reads live deck state). */
  const managedId = useCallback((deck: Deck): string | null => {
    const d = decksRef.current[deck];
    return d.slots[d.managed];
  }, []);
  const nameOf = useCallback(
    (id: string | null): string | null => (id ? engine.getLayer(id)?.name ?? null : null),
    [engine],
  );

  // Full-canvas shaders are the registered "effect" layer types; "none" disables.
  const shaders = useMemo(
    () => ["none", ...engine.registry.all().filter((d) => d.kind === "effect").map((d) => d.type)],
    [engine],
  );

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
  const commitDecks = useCallback((next: { A: DeckState; B: DeckState }) => {
    decksRef.current = next;
    setDecks(next);
  }, []);

  /** Keep the full-canvas shader pinned above all content so it filters everything. */
  const pinShader = useCallback(() => {
    const id = shaderLayerIdRef.current;
    if (id) engine.comp.moveLayer(id, 0);
  }, [engine]);

  const setCrossfade = useCallback(
    (x: number) => {
      const v = clamp01(x);
      setCrossfadeState(v);
      applyCrossfade(v, managedId("A"), managedId("B"));
    },
    [applyCrossfade, managedId],
  );

  // Loading replaces the side's *managed* slot — the stashed plugin keeps running untouched.
  const loadDeck = useCallback(
    (deck: Deck) => {
      const type = selectedTypeRef.current;
      if (!type) return;
      const d = decksRef.current[deck];
      const prev = d.slots[d.managed];
      if (prev) engine.removeLayers([prev]);
      const layer = engine.addLayer(type, { select: false });
      if (!layer) return;
      const slots = [...d.slots] as [string | null, string | null];
      slots[d.managed] = layer.id;
      commitDecks({ ...decksRef.current, [deck]: { slots, managed: d.managed } });
      pinShader();
      applyCrossfade(crossfadeRef.current, managedId("A"), managedId("B"));
    },
    [engine, applyCrossfade, commitDecks, managedId, pinShader],
  );

  const clearDeck = useCallback(
    (deck: Deck) => {
      const d = decksRef.current[deck];
      const id = d.slots[d.managed];
      if (id) engine.removeLayers([id]);
      const slots = [...d.slots] as [string | null, string | null];
      slots[d.managed] = null;
      commitDecks({ ...decksRef.current, [deck]: { slots, managed: d.managed } });
    },
    [engine, commitDecks],
  );

  // Move the controller's focus to the side's other slot; both layers keep rendering + sounding.
  const swapDeck = useCallback(
    (deck: Deck) => {
      const d = decksRef.current[deck];
      commitDecks({ ...decksRef.current, [deck]: { slots: d.slots, managed: d.managed === 0 ? 1 : 0 } });
      applyCrossfade(crossfadeRef.current, managedId("A"), managedId("B"));
    },
    [applyCrossfade, commitDecks, managedId],
  );

  // ── shared driving core: one routing used by both real MIDI and the on-screen controller ──
  const deckLayer = useCallback(
    (deck: Deck) => {
      const id = managedId(deck);
      return id ? engine.getLayer(id) : null;
    },
    [engine, managedId],
  );
  // Functional update so several browse steps within one flush each build on the *committed*
  // selection — otherwise rapid encoder ticks all read the same stale ref and collapse to one move.
  const browseStep = useCallback((dir: number) => {
    setSelectedType((curr) => {
      const list = typesRef.current;
      if (!list.length) return curr;
      const i = Math.max(0, list.indexOf(curr));
      return list[(i + dir + list.length) % list.length];
    });
  }, []);
  const browseTo = useCallback((u: number) => {
    const list = typesRef.current;
    if (!list.length) return;
    setSelectedType(list[Math.round(clamp01(u) * (list.length - 1))]);
  }, []);

  // ── full-canvas shader: add/remove a top-most effect layer, applied immediately as you scroll ──
  const applyShader = useCallback(
    (type: string) => {
      const prev = shaderLayerIdRef.current;
      if (prev) {
        engine.removeLayers([prev]);
        shaderLayerIdRef.current = null;
      }
      if (type && type !== "none") {
        const layer = engine.addLayer(type, { index: 0, select: false });
        if (layer) shaderLayerIdRef.current = layer.id;
      }
      shaderTypeRef.current = type;
      setShaderTypeState(type);
    },
    [engine],
  );
  const shaderStep = useCallback(
    (dir: number) => {
      const list = shaders;
      const i = Math.max(0, list.indexOf(shaderTypeRef.current));
      applyShader(list[(i + dir + list.length) % list.length]);
    },
    [shaders, applyShader],
  );
  const shaderTo = useCallback(
    (u: number) => {
      const list = shaders;
      if (list.length) applyShader(list[Math.round(clamp01(u) * (list.length - 1))]);
    },
    [shaders, applyShader],
  );
  const toggleBrowseMode = useCallback(() => {
    setBrowseMode((m) => {
      const next = m === "plugin" ? "shader" : "plugin";
      browseModeRef.current = next;
      return next;
    });
  }, []);

  // Resolve + apply one continuous slot to its deck's layer (the expensive part).
  const applyContinuousSlot = useCallback(
    (a: ControlAssignment, input: { value: number; delta: number; relative: boolean }) => {
      const deck = assignmentDeck(a);
      const slot = assignmentSlot(a);
      if (!deck || !slot || !SLOT_META[slot].continuous) return;
      const layer = deckLayer(deck);
      if (!layer) return;
      const schema = engine.registry.get(layer.type)?.schema ?? [];
      const macro = macroMapFor(layer.type, schema);
      const spec = macro[slot as "amount" | "evolveX" | "evolveY" | "toneX" | "toneY"];
      if (spec) driveContinuousSlot(engine, layer, schema, spec, input);
    },
    [engine, deckLayer],
  );

  // Flush all coalesced drives accumulated since the last frame, then clear.
  const flushDrives = useCallback(() => {
    driveRafRef.current = 0;
    const pending = pendingDriveRef.current;
    pendingDriveRef.current = new Map();
    for (const [a, input] of pending) applyContinuousSlot(a, input);
  }, [applyContinuousSlot]);

  const driveAssignment = useCallback(
    (a: ControlAssignment, input: { value: number; delta?: number; relative?: boolean }) => {
      if (a === "browse") {
        const shaderMode = browseModeRef.current === "shader";
        const step = shaderMode ? shaderStep : browseStep;
        const seek = shaderMode ? shaderTo : browseTo;
        if (input.relative) {
          // A single physical detent usually fires several CC messages a few ms apart; without
          // gating that skips multiple entries. Step once per burst (the sign of the first
          // message wins), then ignore anything for a short window — one detent = one move.
          const d = input.delta ?? 0;
          if (d !== 0) {
            const now = typeof performance !== "undefined" ? performance.now() : Date.now();
            if (now - lastBrowseAtRef.current >= 60) {
              step(d > 0 ? 1 : -1);
              lastBrowseAtRef.current = now;
            }
          }
        } else {
          seek(input.value);
        }
        return;
      }
      if (a === "crossfade") {
        setCrossfade(1 - input.value);
        return;
      }
      // Continuous deck slots are coalesced to one apply per animation frame: a fader/knob emits
      // a flood of messages, and applying every one (reseeding agents, recomputing the frame) is
      // what makes Amount/Gain feel laggy. Keep the latest absolute value; sum relative deltas.
      const deck = assignmentDeck(a);
      const slot = assignmentSlot(a);
      if (!deck || !slot || !SLOT_META[slot].continuous) return;
      const prev = pendingDriveRef.current.get(a);
      if (input.relative) {
        pendingDriveRef.current.set(a, {
          value: input.value,
          delta: (prev?.delta ?? 0) + (input.delta ?? 0),
          relative: true,
        });
      } else {
        pendingDriveRef.current.set(a, { value: input.value, delta: 0, relative: false });
      }
      if (typeof requestAnimationFrame === "undefined") {
        flushDrives();
      } else if (!driveRafRef.current) {
        driveRafRef.current = requestAnimationFrame(flushDrives);
      }
    },
    [setCrossfade, browseStep, browseTo, shaderStep, shaderTo, flushDrives],
  );

  const fireAssignment = useCallback(
    (a: ControlAssignment) => {
      if (a === "loadA") return loadDeck("A");
      if (a === "loadB") return loadDeck("B");
      if (a === "swapA") return swapDeck("A");
      if (a === "swapB") return swapDeck("B");
      if (a === "browseMode") return toggleBrowseMode();
      const deck = assignmentDeck(a);
      const slot = assignmentSlot(a);
      if (!deck || !slot || SLOT_META[slot].continuous) return;
      const layer = deckLayer(deck);
      if (!layer) return;
      const schema = engine.registry.get(layer.type)?.schema ?? [];
      const macro = macroMapFor(layer.type, schema);
      const spec = macro[slot as "trigger" | "toggle"];
      if (spec) fireMomentarySlot(engine, layer, schema, slot as "trigger" | "toggle", spec);
    },
    [engine, loadDeck, swapDeck, toggleBrowseMode, deckLayer],
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

  const bindAssignment = useCallback(
    (controlId: string, a: ControlAssignment) => {
      updateActive((p) => {
        const next: Record<string, ControlMapping> = { ...p.controls };
        // a control's role is exclusive: clear whoever else held this assignment.
        for (const [id, m] of Object.entries(next)) {
          if (id !== controlId && m.assignment === a) next[id] = { ...m, assignment: "none" };
        }
        next[controlId] = { ...ensureMapping(p, controlId), assignment: a };
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

    const offs = [
      midi.on("discover", () => setMidiRev((r) => r + 1)),
      midi.on("devices", () => setMidiRev((r) => r + 1)),
      midi.on("status", () => setMidiRev((r) => r + 1)),
      midi.on("control", (e) => {
        const ctl = e.control;
        // learn mode: the next moved control binds to the armed assignment.
        if (learnRef.current && learnRef.current !== "none") {
          bindAssignment(ctl.id, learnRef.current);
          setLearn(null);
          return;
        }
        const m = activePresetRef.current?.controls[ctl.id];
        if (!m || m.disabled) return;
        if (isMomentaryAssignment(m.assignment)) {
          // Fire on rising edge regardless of how the control is detected (button-kind CC,
          // plain CC auto-detected as knob, or note). "trigger" fires for note/button-kind
          // but not for plain CC — handle all cases here so nothing is missed.
          const down = ctl.value > 0 || ctl.pressed;
          const prev = pressEdgeRef.current.get(ctl.id) ?? false;
          pressEdgeRef.current.set(ctl.id, down);
          if (down && !prev) fireAssignment(m.assignment);
          return;
        }
        driveAssignment(m.assignment, { value: ctl.value, delta: ctl.delta, relative: ctl.relative });
      }),
      midi.on("trigger", (c) => {
        if (learnRef.current && learnRef.current !== "none") {
          bindAssignment(c.id, learnRef.current);
          setLearn(null);
          return;
        }
        // Only handle trigger for controls NOT mapped to a momentary assignment — those are
        // already handled (edge-detected) in the "control" handler above to avoid double-firing.
        const m = activePresetRef.current?.controls[c.id];
        if (!m || m.disabled) return;
        if (!isMomentaryAssignment(m.assignment)) fireAssignment(m.assignment);
      }),
    ];
    return () => {
      offs.forEach((o) => o());
      performer.dispose();
      midi.dispose();
      audio.dispose();
    };
  }, [midi, audio, performer, driveAssignment, fireAssignment, bindAssignment, setLearn]);

  // Drop any queued drive frame on unmount.
  useEffect(() => () => { if (driveRafRef.current) cancelAnimationFrame(driveRafRef.current); }, []);

  // ── digital-controller popup bridge (host side): apply the remote's taps, mirror state back ──
  const channelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    const ch = openLiveChannel();
    if (!ch) return;
    channelRef.current = ch;
    const snapshot = (): LiveSnapshot => ({
      types: typesRef.current,
      selectedType: selectedTypeRef.current,
      deckAName: nameOf(managedId("A")),
      deckBName: nameOf(managedId("B")),
      deckAStashName: nameOf(decksRef.current.A.slots[decksRef.current.A.managed === 0 ? 1 : 0]),
      deckBStashName: nameOf(decksRef.current.B.slots[decksRef.current.B.managed === 0 ? 1 : 0]),
      crossfade: crossfadeRef.current,
      browseMode: browseModeRef.current,
      shaders,
      shaderType: shaderTypeRef.current,
    });
    ch.onmessage = (e: MessageEvent<LiveMessage>) => {
      const m = e.data;
      if (m.kind === "drive") driveAssignment(m.a, m.input);
      else if (m.kind === "fire") fireAssignment(m.a);
      else if (m.kind === "selectType") setSelectedType(m.type);
      else if (m.kind === "hello") ch.postMessage({ kind: "state", snapshot: snapshot() });
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, [shaders, driveAssignment, fireAssignment, managedId, nameOf]);

  // Mirror display state to any open remote whenever the relevant pieces change.
  useEffect(() => {
    channelRef.current?.postMessage({
      kind: "state",
      snapshot: {
        types,
        selectedType,
        deckAName: nameOf(deckA),
        deckBName: nameOf(deckB),
        deckAStashName: nameOf(deckAStash),
        deckBStashName: nameOf(deckBStash),
        crossfade,
        browseMode,
        shaders,
        shaderType,
      },
    });
  }, [types, selectedType, deckA, deckB, deckAStash, deckBStash, crossfade, browseMode, shaders, shaderType, nameOf]);

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

  // Derive the current text-influence mode from the first text layer in the comp — the
  // text layer owns this prop so the toggle button on its deck controls all simulations.
  useRevision();
  const textMode: TextSetting = (() => {
    const textLayer = engine.comp.layers.find((l) => l.type === "text" && l.enabled);
    if (textLayer) return textSettingOf(textLayer.property("textInfluence")?.valueAt(engine.transport.time));
    // Fall back to reading from whichever active deck has the prop (non-text plugin case).
    for (const id of [deckA, deckB]) {
      if (!id) continue;
      const prop = engine.getLayer(id)?.property("textInfluence");
      if (prop) return textSettingOf(prop.valueAt(engine.transport.time));
    }
    return "auto";
  })();

  const value: LiveContextValue = {
    midi, audio, performer, started, startAudio, midiRev,
    types, selectedType, setSelectedType,
    deckA, deckB, deckAStash, deckBStash, loadDeck, clearDeck, swapDeck, crossfade, setCrossfade,
    textMode,
    shaders, shaderType, setShaderType: applyShader, browseMode, toggleBrowseMode,
    presets, activePreset, controls,
    selectPreset, createNewPreset, renamePreset, duplicateActive, deletePreset, importPresetJson, exportActive,
    renameControl, setControlKind, setControlAssignment, setControlDisabled, resetControl, applyAutoAssign, forgetDevice,
    driveAssignment, fireAssignment, learn, setLearn, bindAssignment,
    master, setMaster, bpm, setBpm, root, scale, setKey,
  };

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive must be used within <LiveProvider>");
  return ctx;
}
