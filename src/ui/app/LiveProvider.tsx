import { createContext, useContext, useEffect, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ControlBus } from "@/controls/ControlBus";
import type { SlotId } from "@/controls/types";
import type { PluginInfo } from "@/plugins/registry";
import { Stage, type DeckName, type Focus } from "@/runtime/Stage";
import { AudioEngine } from "@/audio/AudioEngine";
import { LivePerformer } from "@/audio/LivePerformer";
import { MidiManager } from "@/midi/MidiManager";
import type { MidiActionHandlers } from "@/midi/router";
import { ArmLearnContext, BankControlContext, ControlBusContext, LearnSlotContext, SlotLabelContext, type BankControl } from "@/ui/controller/widgets";
import { useBrowse, type BrowseMode } from "./useBrowse";
import { useHardwareSync } from "./useHardwareSync";
import { useMidiRouting } from "./useMidiRouting";
import { useRemoteBridge } from "./useRemoteBridge";

export type { BrowseMode };

/**
 * The live editor's context, over the factory core: one {@link ControlBus} (fed by the on-screen
 * controller AND hardware MIDI), one runtime {@link Stage} (two decks of banks + a shader), and the
 * audio engine. Hardware MIDI is routed through the binding db straight onto bus slots /
 * app actions — no engine, no macro table, no keymap list. The provider itself only owns focus +
 * the render tick; browse/load, hardware sync, MIDI routing and the pop-out bridge each live in
 * their own hook.
 */
interface LiveCtx {
  bus: ControlBus;
  stage: Stage;
  audio: AudioEngine;
  generators: PluginInfo[];
  effects: PluginInfo[];
  browseMode: BrowseMode;
  toggleBrowseMode: () => void;
  selected: PluginInfo | undefined;
  selectedIndex: number;
  step: (delta: number) => void;
  decks: Stage["decks"];
  crossfade: number;
  setCrossfade: (x: number) => void;
  shaderName: string | null;
  focus: Focus;
  setFocus: (f: Focus) => void;
  load: (deck: DeckName, bank?: number) => void;
  selectBank: (deck: DeckName, bank: number) => void;
  clearDeck: (deck: DeckName) => void;
  clearShader: () => void;
  /** Audio/visual gate — the intro is dismissed once started. */
  started: boolean;
  start: () => void;
  /** The hardware MIDI connection (device status, live control snapshots for settings). */
  midi: MidiManager;
  /** MIDI learn: slot currently armed for one-shot hardware capture, or null. */
  learnSlot: SlotId | null;
  /** Arm a slot for MIDI learn — next hardware touch binds it and clears. */
  armLearn: (slot: SlotId) => void;
  /** Cancel any pending learn. */
  cancelLearn: () => void;
  /** Last routed hardware MIDI control + the param/action it hit, for the settings header readout. */
  lastMidi: { control: string; target: string } | null;
}

const Ctx = createContext<LiveCtx | null>(null);

export function useLive(): LiveCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLive must be used within <LiveProvider>");
  return ctx;
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const refs = useRef<{ bus: ControlBus; stage: Stage; audio: AudioEngine; performer: LivePerformer; midi: MidiManager }>();
  if (!refs.current) {
    const bus = new ControlBus();
    const stage = new Stage(bus);
    const audio = new AudioEngine();
    refs.current = { bus, stage, audio, performer: new LivePerformer(stage, audio), midi: new MidiManager() };
  }
  const { bus, stage, audio, performer, midi } = refs.current;

  const [focus, setFocusState] = useState<Focus>("A");
  const [started, setStarted] = useState(false);
  const [, refresh] = useReducer((x) => x + 1, 0);

  const browse = useBrowse({ stage, focus, setFocus: setFocusState, refresh });
  const { step, load, selectBank, clearDeck } = browse;
  useHardwareSync(midi);

  // App actions a hardware control can be bound to (everything that isn't a plugin parameter).
  const runAction: MidiActionHandlers["run"] = (action) => {
    switch (action) {
      case "loadA": return load("A");
      case "loadB": return load("B");
      case "clearA": return clearDeck("A");
      case "clearB": return clearDeck("B");
      case "browseMode": return browse.toggleBrowseMode();
      case "focusA": return setFocusState("A");
      case "focusB": return setFocusState("B");
      case "focusShader": return setFocusState("shader");
      default: {
        const m = /^bank([AB])([012])$/.exec(action);
        if (m) {
          const deck = m[1] as DeckName;
          const i = Number(m[2]);
          if (stage.decks[deck].banks[i]) selectBank(deck, i);
          else load(deck, i);
        }
      }
    }
  };

  const { learnSlot, armLearn, cancelLearn, lastMidi } = useMidiRouting({
    midi,
    bus,
    stage,
    handlers: { step, run: runAction },
    refresh,
  });

  const setCrossfade = (x: number) => bus.drive("crossfader:0", { value: x });

  // ── crossfader bridge + stage loop ──
  useEffect(() => {
    bus.drive("crossfader:0", { value: 0.5 });
    const off = bus.subscribe("crossfader:0", (live) => {
      stage.crossfade = live.value;
      refresh();
    });
    stage.start();
    return () => {
      off();
      stage.stop();
    };
  }, [stage, bus]);

  // ── audio: started on the intro gesture ──
  const start = () => {
    setStarted(true);
    void audio.start().then(() => performer.start());
  };
  useEffect(() => () => performer.dispose(), [performer]);

  // light tick so live indicators (crossfade, labels, learned controls) refresh while mounted
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 66) {
        last = t;
        refresh();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    stage.focus = focus;
  }, [focus, stage]);

  // slot → focused plugin's variable name, for the on-screen labels.
  const slotLabels: Partial<Record<SlotId, string>> = {};
  const managed = stage.managed();
  if (managed) {
    for (const p of managed.params) slotLabels[p.slot] = p.name;
  }

  // Bank controls for the controller's top row (shared by the host surface and the pop-out window).
  const bankControl: BankControl = {
    state: (deck) => ({ loaded: stage.decks[deck].banks.map((b) => !!b), active: stage.decks[deck].active }),
    select: (deck, i) => (stage.decks[deck].banks[i] ? selectBank(deck, i) : load(deck, i)),
    clear: clearDeck,
  };

  useRemoteBridge({ bus, stage, step, bankControl, slotLabels, browseLabel: browse.selected?.label });

  const value: LiveCtx = {
    bus,
    stage,
    audio,
    generators: browse.generators,
    effects: browse.effects,
    browseMode: browse.browseMode,
    toggleBrowseMode: browse.toggleBrowseMode,
    selected: browse.selected,
    selectedIndex: browse.selectedIndex,
    step,
    decks: stage.decks,
    crossfade: stage.crossfade,
    setCrossfade,
    shaderName: stage.shader ? stage.shader.constructor.name.replace(/Layer$/, "") : null,
    focus,
    setFocus: setFocusState,
    load,
    selectBank,
    clearDeck,
    clearShader: browse.clearShader,
    started,
    start,
    midi,
    learnSlot,
    armLearn,
    cancelLearn,
    lastMidi,
  };

  return (
    <Ctx.Provider value={value}>
      <ControlBusContext.Provider value={bus}>
        <BankControlContext.Provider value={bankControl}>
          <LearnSlotContext.Provider value={learnSlot}>
            <ArmLearnContext.Provider value={armLearn}>
              <SlotLabelContext.Provider value={slotLabels}>{children}</SlotLabelContext.Provider>
            </ArmLearnContext.Provider>
          </LearnSlotContext.Provider>
        </BankControlContext.Provider>
      </ControlBusContext.Provider>
    </Ctx.Provider>
  );
}
