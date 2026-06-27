import * as React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useEngine } from "@/ui/engine/EngineProvider";
import type { Registry } from "@/engine";
import { MidiManager } from "@/midi/MidiManager";
import type { ControlKind, ControlOverride } from "@/midi/types";
import type {
  ControlAssignment,
  BankIndex,
  Deck,
  EffectiveControl,
  MidiPreset,
} from "@/midi/preset";
import type { TextSetting } from "@/plugins/_shared/textField";
import { AudioEngine } from "@/audio/AudioEngine";
import { LivePerformer } from "@/audio/LivePerformer";
import type { ScaleName } from "@/audio/scale";
import { useDeckState } from "@/ui/hooks/useDeckState";
import { usePresetManager } from "@/ui/hooks/usePresetManager";
import { useMidiRouter } from "@/ui/hooks/useMidiRouter";
import { useAudioTransport } from "@/ui/hooks/useAudioTransport";
import { useAssignmentDispatch } from "@/ui/hooks/useAssignmentDispatch";
import { useLiveChannel } from "@/ui/hooks/useLiveChannel";
import { useTextMode } from "@/ui/hooks/useTextMode";

interface LiveContextValue {
  midi: MidiManager;
  audio: AudioEngine;
  performer: LivePerformer;
  started: boolean;
  startAudio: () => Promise<void>;
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

  const [midiRev, setMidiRev] = useState(0);
  const [selectedType, setSelectedType] = useState("");
  const selectedTypeRef = useRef("");
  const typesRef = useRef<string[]>(types);
  selectedTypeRef.current = selectedType;
  typesRef.current = types;

  const deck = useDeckState(engine);
  const preset = usePresetManager(midi, midiRev);
  const transport = useAudioTransport(audio);

  const { driveAssignment, fireAssignment, driveRafRef } = useAssignmentDispatch(
    engine, deck, selectedTypeRef, typesRef, setSelectedType,
  );

  const { learn, setLearn } = useMidiRouter({
    midi,
    activePresetRef: preset.activePresetRef,
    driveAssignment,
    fireAssignment,
    bindAssignment: preset.bindAssignment,
    setMidiRev,
  });

  const nameOf = useCallback(
    (id: string | null): string | null => (id ? engine.getLayer(id)?.name ?? null : null),
    [engine],
  );

  useLiveChannel({
    deck, types, selectedType,
    typesRef, selectedTypeRef, setSelectedType,
    driveAssignment, fireAssignment, nameOf,
  });

  const textMode = useTextMode(engine, deck.deckA, deck.deckB);

  useEffect(() => {
    performer.start();
    midi.enable();
    return () => {
      performer.dispose();
      midi.dispose();
      audio.dispose();
    };
  }, [midi, audio, performer]);

  useEffect(() => () => { if (driveRafRef.current) cancelAnimationFrame(driveRafRef.current); }, [driveRafRef]);

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

  const value: LiveContextValue = {
    midi, audio, performer,
    started: transport.started, startAudio: transport.startAudio, midiRev,
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
    master: transport.master, setMaster: transport.setMaster,
    bpm: transport.bpm, setBpm: transport.setBpm,
    root: transport.root, scale: transport.scale, setKey: transport.setKey,
  };

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive must be used within <LiveProvider>");
  return ctx;
}
