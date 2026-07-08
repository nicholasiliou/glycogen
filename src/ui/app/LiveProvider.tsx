import { createContext, useContext, useEffect, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ControlBus } from "@/controls/ControlBus";
import type { SlotId } from "@/controls/types";
import type { AdapterKind } from "@/controls/adapters";
import { actionBindings, appActions, bankOf, paramBindings, params, setActionBinding, setParamBinding, type AppAction } from "@/db/schema";
import { useTable } from "@/db/useDb";
import type { PluginInfo } from "@/plugins/registry";
import { Stage, type FocusPart } from "@/runtime/Stage";
import { AudioEngine } from "@/audio/AudioEngine";
import { LivePerformer } from "@/audio/LivePerformer";
import { MidiManager } from "@/midi/MidiManager";
import { ArmLearnContext, AssignContext, ControlBusContext, LearnSlotContext, SlotActionContext, SlotLabelContext, SlotOccupantContext, type AssignCtxType, type AssignPending, type SlotAction } from "@/ui/controller/widgets";
import { pendingForAction, pendingForParam } from "@/ui/controls/assign";
import { useBrowse } from "./useBrowse";
import { useHardwareSync } from "./useHardwareSync";
import { useMidiRouting } from "./useMidiRouting";
import { useRemoteBridge } from "./useRemoteBridge";

/**
 * The live editor's context, over the factory core: one {@link ControlBus} (fed by the on-screen
 * controller, the pop-out relay AND hardware MIDI), one runtime {@link Stage} (a flat row of banks,
 * each a generator plus an optional per-layer shader), and the audio engine. Hardware MIDI is
 * routed through the binding db straight onto bus slots; app functions run off the bus too, via
 * their `actionBindings` widgets. The provider itself only owns the render tick and small UI state;
 * browse/load, hardware sync, MIDI routing and the pop-out bridge each live in their own hook.
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
  /** Reorder the bank row (header dot drag) — bank order is composite order. */
  moveBank: (from: number, to: number) => void;
  clearBank: (bank?: number) => void;
  clearShader: () => void;
  /** Master audio mute — silences the master bus without stopping the engine. */
  muted: boolean;
  toggleMute: () => void;
  /** Audio/visual gate — the intro is dismissed once started. */
  started: boolean;
  start: () => void;
  /** The hardware MIDI connection (device status, live control snapshots). */
  midi: MidiManager;
  /** MIDI learn: slot currently armed for one-shot hardware capture, or null. */
  learnSlot: SlotId | null;
  /** Arm a slot for MIDI learn — next hardware touch binds it and clears. */
  armLearn: (slot: SlotId) => void;
  /** Cancel any pending learn. */
  cancelLearn: () => void;
  /** Last routed hardware MIDI control + the param/action it hit, for the overlay header readout. */
  lastMidi: { control: string; target: string } | null;
}

const Ctx = createContext<LiveCtx | null>(null);

export function useLive(): LiveCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLive must be used within <LiveProvider>");
  return ctx;
}

/** Accumulated jog delta that fires one browse step per this many units — deliberately coarse
 *  (~most of a platter revolution) so a flick can't overshoot into loading the wrong plugin. */
const JOG_STEP = 30;

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

  const stepBrowse = (target: "plugin" | "shader", delta: number) =>
    target === "plugin" ? stepPlugin(delta) : stepShader(delta);

  const { learnSlot, armLearn, cancelLearn, lastMidi } = useMidiRouting({ midi, bus, stage, refresh });

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

  // ── app functions run off the bus: each actionBindings row watches its widget's slot for a
  //    rising press. Works identically for the on-screen pads, pop-out relays and hardware, since
  //    everything lands on the host bus. Rebuilt whenever the table changes. ──
  const actionRows = useTable(actionBindings, (t) => t.all());
  const runAction = (actionId: AppAction) => {
    if (actionId === "clear") return clearBank();
    const bank = bankOf(actionId);
    if (bank !== null) {
      if (stage.banks[bank].plugin) selectBank(bank);
      else load(bank);
    }
  };
  const runActionRef = useRef(runAction);
  runActionRef.current = runAction;
  useEffect(() => {
    const offs = actionRows.map((row) => {
      let lastPresses = bus.get(row.widgetId).presses;
      return bus.subscribe(row.widgetId, (live) => {
        if (live.presses === lastPresses) return;
        lastPresses = live.presses;
        runActionRef.current(row.actionId);
      });
    });
    return () => offs.forEach((off) => off());
  }, [bus, actionRows]);

  // ── header master mute (silences the master bus, engine keeps running) ──
  const [muted, setMuted] = useState(false);
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    audio.setMasterLevel(next ? 0 : 0.9);
  };

  // ── assignment (sidebar row / occupant → widget), shared by the panel and the overlay ──
  const [assignPending, setAssignPending] = useState<AssignPending | null>(null);
  const assignCtx: AssignCtxType = {
    pending: assignPending,
    begin: setAssignPending,
    cancel: () => setAssignPending(null),
    assignTo: (slot) => {
      if (!assignPending) return;
      if (assignPending.type === "param")
        setParamBinding(assignPending.pluginId, assignPending.paramId, slot, assignPending.legal[slot]?.[0] as AdapterKind | undefined);
      else setActionBinding(assignPending.actionId, slot);
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

  // widget → the app function sitting on it (label + lit), for pad labels/lighting everywhere.
  const slotActions: Partial<Record<SlotId, SlotAction>> = {};
  for (const row of actionRows) {
    const action = appActions.get(row.actionId);
    if (!action) continue;
    const bank = bankOf(row.actionId);
    slotActions[row.widgetId] = {
      actionId: row.actionId,
      label: action.label,
      lit: bank !== null && bank === stage.active && !!stage.banks[bank].plugin,
    };
  }

  // widget → its occupant as a ready-to-arm pending, so the assign overlay can drag occupants off.
  const slotOccupants: Partial<Record<SlotId, AssignPending>> = {};
  if (managed) {
    for (const row of paramBindings.by("plugin", managed.id)) {
      const p = params.get(row.paramId);
      if (p && !row.locked) slotOccupants[row.widgetId] = pendingForParam(p);
    }
  }
  for (const row of actionRows) {
    const action = appActions.get(row.actionId);
    if (action) slotOccupants[row.widgetId] = pendingForAction(action);
  }

  useRemoteBridge({
    bus,
    stage,
    step: stepBrowse,
    slotLabels,
    slotActions,
    browseLabels: { plugin: browse.selectedPlugin?.label, shader: browse.selectedShader?.label },
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
    moveBank: (from, to) => {
      stage.moveBank(from, to);
      refresh();
    },
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
        <LearnSlotContext.Provider value={learnSlot}>
          <ArmLearnContext.Provider value={armLearn}>
            <AssignContext.Provider value={assignCtx}>
              <SlotActionContext.Provider value={slotActions}>
                <SlotOccupantContext.Provider value={slotOccupants}>
                  <SlotLabelContext.Provider value={slotLabels}>{children}</SlotLabelContext.Provider>
                </SlotOccupantContext.Provider>
              </SlotActionContext.Provider>
            </AssignContext.Provider>
          </ArmLearnContext.Provider>
        </LearnSlotContext.Provider>
      </ControlBusContext.Provider>
    </Ctx.Provider>
  );
}
