import * as React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useEngine, useRevision } from "@/ui/engine/EngineProvider";
import type { Registry } from "@/engine";
import { MidiManager } from "@/midi/MidiManager";
import type { ControlKind, ControlOverride } from "@/midi/types";
import {
  assignmentDeck,
  assignmentSlot,
  bankOf,
  SLOT_META,
  type ControlAssignment,
  type BankIndex,
  type ControlMapping,
  type Deck,
  type EffectiveControl,
  type MidiPreset,
} from "@/midi/preset";
import { type TextSetting, textSettingOf } from "@/plugins/_shared/textField";
import { AudioEngine } from "@/audio/AudioEngine";
import { LivePerformer } from "@/audio/LivePerformer";
import type { ScaleName } from "@/audio/scale";
import { clamp, clamp01, driveContinuousSlot, fireMomentarySlot, macroMapFor } from "@/ui/live/macros/macros";
import { openLiveChannel, type LiveMessage, type LiveSnapshot } from "@/ui/live/channel/liveChannel";
import { useDeckState } from "@/ui/live/hooks/useDeckState";
import { usePresetManager } from "@/ui/live/hooks/usePresetManager";
import { useMidiRouter } from "@/ui/live/hooks/useMidiRouter";

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
  deckBanks: { A: (string | null)[]; B: (string | null)[] };
  activeBank: { A: BankIndex; B: BankIndex };
  loadBank: (deck: Deck, index: BankIndex) => void;
  selectBank: (deck: Deck, index: BankIndex) => void;
  clearDeck: (deck: Deck) => void;
  crossfade: number;
  setCrossfade: (x: number) => void;
  textMode: TextSetting;

  // ── full-canvas shader ──
  shaders: string[];
  shaderType: string;
  setShaderType: (type: string) => void;
  browseMode: "plugin" | "shader";
  toggleBrowseMode: () => void;

  // ── MIDI keymap ──
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

  // ── live driving + on-screen mapping ──
  driveAssignment: (a: ControlAssignment, input: { value: number; delta?: number; relative?: boolean }) => void;
  fireAssignment: (a: ControlAssignment) => void;
  learn: ControlAssignment | null;
  setLearn: (a: ControlAssignment | null, preferKind?: ControlKind) => void;
  bindAssignment: (controlId: string, a: ControlAssignment, preferKind?: ControlKind) => void;

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

function selectableTypes(registry: Registry): string[] {
  return registry
    .all()
    .filter((d) => d.kind !== "group" && d.kind !== "layout" && d.kind !== "effect" && d.type !== "null")
    .map((d) => d.type);
}

function presetToOverrides(preset: MidiPreset | null): Record<string, ControlOverride> {
  const map: Record<string, ControlOverride> = {};
  if (preset)
    for (const m of Object.values(preset.controls))
      map[m.controlId] = { name: m.name, kind: m.kind, disabled: m.disabled };
  return map;
}

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const engine = useEngine();
  const midi = useMemo(() => new MidiManager(), []);
  const audio = useMemo(() => new AudioEngine(), []);
  const performer = useMemo(() => new LivePerformer(engine, audio), [engine, audio]);
  const types = useMemo(() => selectableTypes(engine.registry), [engine]);

  const [started, setStarted] = useState(false);
  const [midiRev, setMidiRev] = useState(0);
  const [selectedType, setSelectedType] = useState("");
  const [master, setMasterState] = useState(0.9);
  const [bpm, setBpmState] = useState(110);
  const [root, setRoot] = useState(48);
  const [scale, setScale] = useState<ScaleName>("minorPentatonic");

  const selectedTypeRef = useRef("");
  const typesRef = useRef<string[]>(types);
  selectedTypeRef.current = selectedType;
  typesRef.current = types;

  const deck = useDeckState(engine);
  const preset = usePresetManager(midi, midiRev);

  const lastBrowseAtRef = useRef(0);
  const pendingDriveRef = useRef<Map<ControlAssignment, { value: number; delta: number; relative: boolean }>>(new Map());
  const driveRafRef = useRef(0);

  const deckLayer = useCallback(
    (d: Deck) => {
      const id = deck.managedId(d);
      return id ? engine.getLayer(id) : null;
    },
    [engine, deck],
  );

  const applyContinuousSlot = useCallback(
    (a: ControlAssignment, input: { value: number; delta: number; relative: boolean }) => {
      const d = assignmentDeck(a);
      const slot = assignmentSlot(a);
      if (!d || !slot || !SLOT_META[slot].continuous) return;
      const layer = deckLayer(d);
      if (!layer) return;
      const schema = engine.registry.get(layer.type)?.schema ?? [];
      const macro = macroMapFor(layer.type, schema);
      const spec = macro[slot as "amount" | "evolveX" | "evolveY" | "toneX" | "toneY"];
      if (spec) driveContinuousSlot(engine, layer, schema, spec, input);
    },
    [engine, deckLayer],
  );

  const flushDrives = useCallback(() => {
    driveRafRef.current = 0;
    const pending = pendingDriveRef.current;
    pendingDriveRef.current = new Map();
    for (const [a, input] of pending) applyContinuousSlot(a, input);
  }, [applyContinuousSlot]);

  const driveAssignment = useCallback(
    (a: ControlAssignment, input: { value: number; delta?: number; relative?: boolean }) => {
      if (a === "none" || a.startsWith("placeholder")) return;
      if (a === "browse") {
        const shaderMode = deck.browseModeRef.current === "shader";
        const step = shaderMode ? deck.shaderStep : (dir: number) => deck.browseStep(dir, typesRef.current, setSelectedType);
        const seek = shaderMode ? deck.shaderTo : (u: number) => deck.browseTo(u, typesRef.current, setSelectedType);
        if (input.relative) {
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
        deck.setCrossfade(1 - input.value);
        return;
      }
      const d = assignmentDeck(a);
      const slot = assignmentSlot(a);
      if (!d || !slot || !SLOT_META[slot].continuous) return;
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
    [deck, flushDrives],
  );

  const fireAssignment = useCallback(
    (a: ControlAssignment) => {
      if (a === "none" || a.startsWith("placeholder")) return;
      const bank = bankOf(a);
      if (bank) return deck.selectBank(bank.deck, bank.index, selectedTypeRef.current);
      if (a === "loadA") return deck.loadBank("A", deck.decksRef.current["A"].active, selectedTypeRef.current);
      if (a === "loadB") return deck.loadBank("B", deck.decksRef.current["B"].active, selectedTypeRef.current);
      if (a === "clearA") return deck.clearDeck("A");
      if (a === "clearB") return deck.clearDeck("B");
      if (a === "browseMode") return deck.toggleBrowseMode();
      const d = assignmentDeck(a);
      const slot = assignmentSlot(a);
      if (!d || !slot || SLOT_META[slot].continuous) return;
      const layer = deckLayer(d);
      if (!layer) return;
      const schema = engine.registry.get(layer.type)?.schema ?? [];
      const macro = macroMapFor(layer.type, schema);
      const spec = macro[slot as "trigger" | "toggle"];
      if (spec) fireMomentarySlot(engine, layer, schema, slot as "trigger" | "toggle", spec);
    },
    [engine, deck, deckLayer],
  );

  const { learn, setLearn } = useMidiRouter({
    midi,
    activePresetRef: preset.activePresetRef,
    driveAssignment,
    fireAssignment,
    bindAssignment: preset.bindAssignment,
    setMidiRev,
  });

  useEffect(() => {
    performer.start();
    midi.enable();
    return () => {
      performer.dispose();
      midi.dispose();
      audio.dispose();
    };
  }, [midi, audio, performer]);

  useEffect(() => () => { if (driveRafRef.current) cancelAnimationFrame(driveRafRef.current); }, []);

  useEffect(() => {
    if (!selectedType && types.length) setSelectedType(types.includes("physarum") ? "physarum" : types[0]);
  }, [types, selectedType]);

  useEffect(() => {
    engine.setLoop(false);
    if (engine.comp.duration < 3600) engine.setCompositionSettings({ duration: 36000 });
    engine.play();
  }, [engine]);

  useEffect(() => {
    midi.applyOverrides(presetToOverrides(preset.activePreset));
  }, [midi, preset.activePreset]);

  useEffect(() => {
    if (midiRev) midi.allLedsOff();
  }, [midi, midiRev]);

  const channelRef = useRef<BroadcastChannel | null>(null);
  const nameOf = useCallback(
    (id: string | null): string | null => (id ? engine.getLayer(id)?.name ?? null : null),
    [engine],
  );

  useEffect(() => {
    const ch = openLiveChannel();
    if (!ch) return;
    channelRef.current = ch;
    const snapshot = (): LiveSnapshot => ({
      types: typesRef.current,
      selectedType: selectedTypeRef.current,
      deckAName: nameOf(deck.managedId("A")),
      deckBName: nameOf(deck.managedId("B")),
      deckABankNames: deck.decksRef.current.A.banks.map(nameOf),
      deckBBankNames: deck.decksRef.current.B.banks.map(nameOf),
      activeBankA: deck.decksRef.current.A.active,
      activeBankB: deck.decksRef.current.B.active,
      crossfade: deck.crossfadeRef.current,
      browseMode: deck.browseModeRef.current,
      shaders: deck.shaders,
      shaderType: deck.shaderTypeRef.current,
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
  }, [deck, driveAssignment, fireAssignment, nameOf]);

  useEffect(() => {
    channelRef.current?.postMessage({
      kind: "state",
      snapshot: {
        types,
        selectedType,
        deckAName: nameOf(deck.deckA),
        deckBName: nameOf(deck.deckB),
        deckABankNames: deck.decks.A.banks.map(nameOf),
        deckBBankNames: deck.decks.B.banks.map(nameOf),
        activeBankA: deck.decks.A.active,
        activeBankB: deck.decks.B.active,
        crossfade: deck.crossfade,
        browseMode: deck.browseMode,
        shaders: deck.shaders,
        shaderType: deck.shaderType,
      },
    });
  }, [types, selectedType, deck, nameOf]);

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

  useRevision();
  const textMode: TextSetting = (() => {
    const textLayer = engine.comp.layers.find((l) => l.type === "text" && l.enabled);
    if (textLayer) return textSettingOf(textLayer.property("textInfluence")?.valueAt(engine.transport.time));
    for (const id of [deck.deckA, deck.deckB]) {
      if (!id) continue;
      const prop = engine.getLayer(id)?.property("textInfluence");
      if (prop) return textSettingOf(prop.valueAt(engine.transport.time));
    }
    return "attract";
  })();

  const value: LiveContextValue = {
    midi, audio, performer, started, startAudio, midiRev,
    types, selectedType, setSelectedType,
    deckA: deck.deckA, deckB: deck.deckB,
    deckBanks: { A: deck.decks.A.banks, B: deck.decks.B.banks },
    activeBank: { A: deck.decks.A.active, B: deck.decks.B.active },
    loadBank: (d, i) => deck.loadBank(d, i, selectedTypeRef.current),
    selectBank: (d, i) => deck.selectBank(d, i, selectedTypeRef.current),
    clearDeck: deck.clearDeck,
    crossfade: deck.crossfade, setCrossfade: deck.setCrossfade,
    textMode,
    shaders: deck.shaders, shaderType: deck.shaderType, setShaderType: deck.applyShader,
    browseMode: deck.browseMode, toggleBrowseMode: deck.toggleBrowseMode,
    presets: preset.presets, activePreset: preset.activePreset, controls: preset.controls,
    selectPreset: preset.selectPreset,
    createNewPreset: preset.createNewPreset,
    renamePreset: preset.renamePreset,
    duplicateActive: preset.duplicateActive,
    deletePreset: preset.deletePreset,
    importPresetJson: preset.importPresetJson,
    exportActive: preset.exportActive,
    renameControl: preset.renameControl,
    setControlKind: preset.setControlKind,
    setControlAssignment: preset.setControlAssignment,
    setControlDisabled: preset.setControlDisabled,
    resetControl: preset.resetControl,
    applyAutoAssign: preset.applyAutoAssign,
    forgetDevice: useCallback(() => { midi.forget(); setMidiRev((r) => r + 1); }, [midi]),
    driveAssignment, fireAssignment, learn, setLearn, bindAssignment: preset.bindAssignment,
    master, setMaster, bpm, setBpm, root, scale, setKey,
  };

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive must be used within <LiveProvider>");
  return ctx;
}
