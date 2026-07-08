import { createContext, useContext, useEffect, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ControlBus } from "@/controls/ControlBus";
import type { SlotId } from "@/controls/types";
import type { AdapterKind } from "@/controls/adapters";
import { bankOf, paramBindings, params, setParamBinding } from "@/db/schema";
import type { PluginInfo } from "@/plugins/registry";
import { Stage, type FocusPart } from "@/runtime/Stage";
import { AudioEngine } from "@/audio/AudioEngine";
import { LivePerformer } from "@/audio/LivePerformer";
import { MidiManager } from "@/midi/MidiManager";
import type { MidiActionHandlers } from "@/midi/router";
import { ArmLearnContext, AssignContext, BankControlContext, ControlBusContext, LearnSlotContext, SlotLabelContext, type AssignCtxType, type AssignPending, type BankControl } from "@/ui/controller/widgets";
import { useBrowse } from "./useBrowse";
import { useHardwareSync } from "./useHardwareSync";
import { useMidiRouting } from "./useMidiRouting";
import { useRemoteBridge } from "./useRemoteBridge";

/**
 * The live editor's context, over the factory core: one {@link ControlBus} (fed by the on-screen
 * controller AND hardware MIDI), one runtime {@link Stage} (a flat row of banks, each a generator
 * plus an optional per-layer shader), and the audio engine. Hardware MIDI is routed through the
 * binding db straight onto bus slots / app actions. The provider itself only owns the render tick
 * and small UI state; browse/load, hardware sync, MIDI routing and the pop-out bridge each live in
 * their own hook.
 */
interface LiveCtx {
  bus: ControlBus;
  stage: Stage;
  audio: AudioEngine;
  generators: PluginInfo[];
  effects: PluginInfo[];
  selectedPlugin: PluginInfo | undefined;
  selectedPluginIndex: number;
  selectedShader: PluginInfo | undefined;
  selectedShaderIndex: number;
  stepPlugin: (delta: number) => void;
  stepShader: (delta: number) => void;
  banks: Stage["banks"];
  activeBank: number;
  focusPart: FocusPart;
  setFocusPart: (p: FocusPart) => void;
  load: (bank?: number) => void;
  selectBank: (bank: number) => void;
  clearBank: (bank?: number) => void;
  clearShader: () => void;
  /** Master audio mute — silences the master bus without stopping the engine. */
  muted: boolean;
  toggleMute: () => void;
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

/** Accumulated jog delta that fires one browse step per this many units. */
const JOG_STEP = 4;

export function LiveProvider({ children }: { children: ReactNode }) {
  const refs = useRef<{ bus: ControlBus; stage: Stage; audio: AudioEngine; performer: LivePerformer; midi: MidiManager }>();
  if (!refs.current) {
    const bus = new ControlBus();
    const stage = new Stage(bus);
    const audio = new AudioEngine();
    refs.current = { bus, stage, audio, performer: new LivePerformer(stage, audio), midi: new MidiManager() };
  }
  const { bus, stage, audio, performer, midi } = refs.current;

  const [started, setStarted] = useState(false);
  const [, refresh] = useReducer((x) => x + 1, 0);

  const browse = useBrowse({ stage, refresh });
  const { stepPlugin, stepShader, load, selectBank, clearBank, clearShader } = browse;
  useHardwareSync(midi);

  // App actions a hardware control can be bound to (everything that isn't a plugin parameter).
  const runAction: MidiActionHandlers["run"] = (action) => {
    switch (action) {
      case "load": return load();
      case "clear": return clearBank();
      case "clearShader": return clearShader();
      default: {
        const bank = bankOf(action);
        if (bank !== null) {
          if (stage.banks[bank].plugin) selectBank(bank);
          else load(bank);
        }
      }
    }
  };

  const stepBrowse = (target: "plugin" | "shader", delta: number) =>
    target === "plugin" ? stepPlugin(delta) : stepShader(delta);

  const { learnSlot, armLearn, cancelLearn, lastMidi } = useMidiRouting({
    midi,
    bus,
    stage,
    handlers: { step: stepBrowse, run: runAction },
    refresh,
  });

  // ── the jog wheels ARE the browse dials: jog:0 sweeps plugins, jog:1 sweeps shaders ──
  const stepRef = useRef(stepBrowse);
  stepRef.current = stepBrowse;
  useEffect(() => {
    const attach = (slot: SlotId, target: "plugin" | "shader") => {
      let acc = 0;
      return bus.subscribe(slot, (live) => {
        if (!live.relative || !live.delta) return;
        acc += live.delta;
        const steps = Math.trunc(acc / JOG_STEP);
        if (steps !== 0) {
          acc -= steps * JOG_STEP;
          stepRef.current(target, steps);
        }
      });
    };
    const offPlugin = attach("jog:0", "plugin");
    const offShader = attach("jog:1", "shader");
    return () => {
      offPlugin();
      offShader();
    };
  }, [bus]);

  // ── header master mute (silences the master bus, engine keeps running) ──
  const [muted, setMuted] = useState(false);
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    audio.setMasterLevel(next ? 0 : 0.9);
  };

  // ── param remapping (chip → widget), shared by the panel and the controller surface ──
  const [assignPending, setAssignPending] = useState<AssignPending | null>(null);
  const assignCtx: AssignCtxType = {
    pending: assignPending,
    begin: setAssignPending,
    cancel: () => setAssignPending(null),
    assignTo: (slot) => {
      if (!assignPending) return;
      setParamBinding(assignPending.pluginId, assignPending.paramId, slot, assignPending.legal[slot]?.[0] as AdapterKind | undefined);
      setAssignPending(null);
    },
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAssignPending(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── stage loop ──
  useEffect(() => {
    stage.start();
    return () => stage.stop();
  }, [stage]);

  // ── audio: started on the intro gesture ──
  const start = () => {
    setStarted(true);
    void audio.start().then(() => performer.start());
  };
  useEffect(() => () => performer.dispose(), [performer]);

  // light tick so live indicators (bank dots, labels, learned controls) refresh while mounted
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

  // widget → focused plugin's bound param name, for the on-screen labels.
  const slotLabels: Partial<Record<SlotId, string>> = {};
  const managed = stage.managed();
  if (managed) {
    for (const row of paramBindings.by("plugin", managed.id)) {
      const p = params.get(row.paramId);
      if (p) slotLabels[row.widgetId] = p.name;
    }
  }

  // Bank controls for the controller's top row (shared by the host surface and the pop-out window).
  const bankControl: BankControl = {
    state: () => ({ loaded: stage.banks.map((b) => !!b.plugin), active: stage.active }),
    select: (i) => (stage.banks[i].plugin ? selectBank(i) : load(i)),
    clear: () => clearBank(),
  };

  useRemoteBridge({
    bus,
    stage,
    step: stepBrowse,
    bankControl,
    slotLabels,
    browseLabels: { plugin: browse.selectedPlugin?.label, shader: browse.selectedShader?.label },
    assign: assignCtx,
  });

  const value: LiveCtx = {
    bus,
    stage,
    audio,
    generators: browse.generators,
    effects: browse.effects,
    selectedPlugin: browse.selectedPlugin,
    selectedPluginIndex: browse.selectedPluginIndex,
    selectedShader: browse.selectedShader,
    selectedShaderIndex: browse.selectedShaderIndex,
    stepPlugin,
    stepShader,
    banks: stage.banks,
    activeBank: stage.active,
    focusPart: stage.focusPart,
    setFocusPart: (p) => {
      stage.focusPart = p;
      refresh();
    },
    load,
    selectBank,
    clearBank,
    clearShader,
    muted,
    toggleMute,
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
              <AssignContext.Provider value={assignCtx}>
                <SlotLabelContext.Provider value={slotLabels}>{children}</SlotLabelContext.Provider>
              </AssignContext.Provider>
            </ArmLearnContext.Provider>
          </LearnSlotContext.Provider>
        </BankControlContext.Provider>
      </ControlBusContext.Provider>
    </Ctx.Provider>
  );
}
