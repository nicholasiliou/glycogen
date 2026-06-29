import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ControlBus } from "@/controls/ControlBus";
import type { SlotId } from "@/controls/types";
import { openRemoteChannel, type RemoteMessage, type RemoteSnapshot } from "@/controls/remoteChannel";
import { create, list, type PluginInfo } from "@/plugins/registry";
import { Stage, type DeckName, type Focus } from "@/runtime/Stage";
import { AudioEngine } from "@/audio/AudioEngine";
import { LivePerformer } from "@/audio/LivePerformer";
import { MidiManager } from "@/midi/MidiManager";
import { attachMidiRouter, type MidiActionHandlers } from "@/midi/router";
import {
  autoAssign,
  bindingLabel,
  createKeymap,
  effectiveControls,
  loadActiveId,
  loadKeymaps,
  saveActiveId,
  saveKeymaps,
  type AppAction,
  type Binding,
  type Keymap,
} from "@/midi/keymap";
import type { ControlKind } from "@/midi/types";
import { ArmLearnContext, BankControlContext, ControlBusContext, LearnSlotContext, SlotLabelContext, type BankControl } from "@/ui/controller/widgets";

export type BrowseMode = "plugin" | "shader";

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

/**
 * The live editor's context, over the factory core: one {@link ControlBus} (fed by the on-screen
 * controller AND hardware MIDI), one runtime {@link Stage} (two decks of banks + a shader), and the
 * audio engine. Hardware MIDI is routed through the active {@link Keymap} straight onto bus slots /
 * app actions — no engine, no macro table.
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
  /** MIDI keymap editing surface. */
  keymap: KeymapCtx;
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

  const catalog = useMemo(() => list(), []);
  const generators = useMemo(() => catalog.filter((p) => p.kind === "generator"), [catalog]);
  // "None" (the passthrough shader) sits at the top of the shader dial so it's the first/home entry.
  const effects = useMemo(() => {
    const fx = catalog.filter((p) => p.kind === "effect");
    return fx.sort((a, b) => (a.id === "none" ? -1 : b.id === "none" ? 1 : 0));
  }, [catalog]);

  const [browseMode, setBrowseMode] = useState<BrowseMode>("plugin");
  const [selPlugin, setSelPlugin] = useState(0);
  const [selShader, setSelShader] = useState(0);
  const [focus, setFocusState] = useState<Focus>("A");
  const [started, setStarted] = useState(false);
  const [, refresh] = useReducer((x) => x + 1, 0);
  const [learnSlot, setLearnSlot] = useState<SlotId | null>(null);
  const learnSlotRef = useRef<SlotId | null>(null);
  learnSlotRef.current = learnSlot;
  /** Last routed MIDI control + what it targeted — shown in the settings header. */
  const [lastMidi, setLastMidi] = useState<{ control: string; target: string } | null>(null);

  // ── MIDI keymaps (persistent, named) ──
  const [keymaps, setKeymaps] = useState<Keymap[]>(() => loadKeymaps());
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveId());
  const activeKeymap = useMemo(() => keymaps.find((k) => k.id === activeId) ?? null, [keymaps, activeId]);

  const liveList = browseMode === "shader" ? effects : generators;
  const selectedIndex = browseMode === "shader" ? selShader : selPlugin;
  const selected = liveList[selectedIndex];

  // Apply a shader entry live: "none" clears the slot, anything else loads it; either way the
  // controller focuses the shader so its params are immediately editable.
  const applyShader = (info: PluginInfo | undefined) => {
    if (!info) return;
    stage.setShader(info.id === "none" ? null : create(info.id));
    setFocusState("shader");
    refresh();
  };

  const step = (d: number) => {
    if (browseMode === "shader") {
      const n = effects.length ? (selShader + d + effects.length * 100) % effects.length : 0;
      setSelShader(n);
      applyShader(effects[n]); // previewing a shader applies + focuses it directly
    } else {
      setSelPlugin((s) => (generators.length ? (s + d + generators.length * 100) % generators.length : 0));
    }
  };

  const toggleBrowseMode = () => {
    const next = browseMode === "plugin" ? "shader" : "plugin";
    setBrowseMode(next);
    // Entering shader mode applies + focuses the current shader selection; leaving it keeps the
    // shader applied and returns focus to deck A so deck controls are editable again.
    if (next === "shader") applyShader(effects[selShader]);
    else setFocusState("A");
  };

  const load = (deck: DeckName, bank?: number) => {
    if (!selected) return;
    if (browseMode === "shader") {
      applyShader(selected);
    } else {
      stage.loadBank(deck, bank ?? stage.decks[deck].active, create(selected.id));
      setFocusState(deck);
    }
    refresh();
  };

  const selectBank = (deck: DeckName, bank: number) => {
    stage.selectBank(deck, bank);
    setFocusState(deck);
    refresh();
  };

  const clearShader = () => {
    stage.setShader(null);
    setSelShader(0); // None is index 0, so the dial returns home
    refresh();
  };

  const clearDeck = (deck: DeckName) => {
    stage.clearBank(deck);
    refresh();
  };

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

  // ── hardware MIDI → bus / app actions, through the active keymap ──
  // Handlers are read from a ref so the router (attached once) always sees fresh closures.
  const handlersRef = useRef<MidiActionHandlers>({ step: () => {}, run: () => {} });
  handlersRef.current = {
    step,
    report: (control, target) => {
      // Friendly readout: a slot resolves to the focused plugin's bound param name (or the raw slot
      // if unbound); an app action resolves to its display label.
      const slotName = stage.managed()?.params.find((p) => p.slot === target)?.name;
      const label = slotName || bindingLabel(target.includes(":") ? { kind: "slot", slot: target as SlotId } : { kind: "action", action: target as AppAction });
      setLastMidi({ control, target: label });
    },
    run: (action) => {
      switch (action) {
        case "loadA": return load("A");
        case "loadB": return load("B");
        case "clearA": return clearDeck("A");
        case "clearB": return clearDeck("B");
        case "browseMode": return toggleBrowseMode();
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
    },
  };
  const keymapRef = useRef<Keymap | null>(activeKeymap);
  keymapRef.current = activeKeymap;

  // Keep patchActive reachable from the (once-mounted) MIDI useEffect (assigned after definition below).
  const patchActiveRef = useRef<((mutate: (k: Keymap) => Keymap) => void) | null>(null);

  useEffect(() => {
    void midi.enable();
    const offControl = midi.on("control", (ev) => {
      // If a slot is armed for learn, capture this hardware control and bind it immediately.
      const pending = learnSlotRef.current;
      if (pending !== null) {
        setLearnSlot(null);
        const ctl = ev.control;
        const derivedKind: ControlKind = ctl.relative ? "encoder" : ctl.continuous ? "knob" : "button";
        patchActiveRef.current?.((k) => ({
          ...k,
          controls: {
            ...k.controls,
            [ctl.id]: {
              controlId: ctl.id,
              name: ctl.label,
              kind: derivedKind,
              binding: { kind: "slot", slot: pending },
              disabled: false,
            },
          },
        }));
        return;
      }
      refresh(); // surface newly-seen controls in settings
    });
    const offRouter = attachMidiRouter(midi, () => keymapRef.current, bus, {
      step: (d) => handlersRef.current.step(d),
      run: (a) => handlersRef.current.run(a),
      report: (c, t) => handlersRef.current.report?.(c, t),
    });
    return () => {
      offControl();
      offRouter();
    };
  }, [midi, bus]);

  // Push the active keymap's per-control overrides (name/kind/disabled) down to the manager so a
  // corrected control type takes effect live, and reset LEDs when the map changes.
  useEffect(() => {
    const overrides: Record<string, { name?: string; kind?: ControlKind; disabled?: boolean }> = {};
    for (const c of Object.values(activeKeymap?.controls ?? {})) {
      overrides[c.controlId] = { name: c.name, kind: c.kind, disabled: c.disabled };
    }
    midi.applyOverrides(overrides);
    if (midi.status === "ready") midi.allLedsOff();
  }, [activeKeymap, midi]);

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

  // ── keymap persistence + mutation helpers ──
  useEffect(() => saveKeymaps(keymaps), [keymaps]);
  useEffect(() => saveActiveId(activeId), [activeId]);

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
  patchActiveRef.current = patchActive;

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

  // slot → focused plugin's variable name, for the on-screen labels.
  const slotLabels: Partial<Record<SlotId, string>> = {};
  const managed = stage.managed();
  if (managed) {
    for (const p of managed.params) slotLabels[p.slot] = p.name;
  }

  // ── pop-out controller bridge (host side) ──
  // Apply drives/fires/steps relayed from the popup onto our real bus, and mirror back a snapshot
  // (slot labels + browse label) so the popup can render the surface. The host always owns state.
  const stepRef = useRef(step);
  stepRef.current = step;
  const bankRef = useRef<BankControl>({ state: () => ({ loaded: [], active: -1 }), select: () => {}, clear: () => {} });
  const banksSnap = {
    A: { loaded: stage.decks.A.banks.map((b) => !!b), active: stage.decks.A.active },
    B: { loaded: stage.decks.B.banks.map((b) => !!b), active: stage.decks.B.active },
  };
  const snapshot = useMemo<RemoteSnapshot>(
    () => ({ labels: slotLabels, browseLabel: selected?.label, banks: banksSnap }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(slotLabels), selected?.label, JSON.stringify(banksSnap)],
  );
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const chanRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    const chan = openRemoteChannel();
    chanRef.current = chan;
    if (!chan) return;
    const onMsg = (e: MessageEvent<RemoteMessage>) => {
      const m = e.data;
      if (m.kind === "drive") bus.drive(m.slot, m.input);
      else if (m.kind === "fire") bus.fire(m.slot);
      else if (m.kind === "step") stepRef.current(m.delta);
      else if (m.kind === "bankSelect") bankRef.current.select(m.deck, m.bank);
      else if (m.kind === "bankClear") bankRef.current.clear(m.deck);
      else if (m.kind === "hello") chan.postMessage({ kind: "snapshot", snapshot: snapshotRef.current } satisfies RemoteMessage);
    };
    chan.addEventListener("message", onMsg);
    return () => {
      chan.removeEventListener("message", onMsg);
      chan.close();
      chanRef.current = null;
    };
  }, [bus]);
  // Broadcast a fresh snapshot whenever the labels/browse change so the popup stays in sync.
  useEffect(() => {
    chanRef.current?.postMessage({ kind: "snapshot", snapshot } satisfies RemoteMessage);
  }, [snapshot]);

  // Bank controls for the controller's top row (shared by the host surface and the pop-out window).
  const bankControl: BankControl = {
    state: (deck) => ({ loaded: stage.decks[deck].banks.map((b) => !!b), active: stage.decks[deck].active }),
    select: (deck, i) => (stage.decks[deck].banks[i] ? selectBank(deck, i) : load(deck, i)),
    clear: clearDeck,
  };
  bankRef.current = bankControl;

  const value: LiveCtx = {
    bus,
    stage,
    audio,
    generators,
    effects,
    browseMode,
    toggleBrowseMode,
    selected,
    selectedIndex,
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
    clearShader,
    started,
    start,
    keymap,
    learnSlot,
    armLearn: (slot) => setLearnSlot((cur) => (cur === slot ? null : slot)),
    cancelLearn: () => setLearnSlot(null),
    lastMidi,
  };

  return (
    <Ctx.Provider value={value}>
      <ControlBusContext.Provider value={bus}>
        <BankControlContext.Provider value={bankControl}>
          <LearnSlotContext.Provider value={learnSlot}>
            <ArmLearnContext.Provider value={(slot) => setLearnSlot((cur) => (cur === slot ? null : slot))}>
              <SlotLabelContext.Provider value={slotLabels}>{children}</SlotLabelContext.Provider>
            </ArmLearnContext.Provider>
          </LearnSlotContext.Provider>
        </BankControlContext.Provider>
      </ControlBusContext.Provider>
    </Ctx.Provider>
  );
}
