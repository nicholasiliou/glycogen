import { beforeEach, describe, expect, it, vi } from "vitest";
import { ControlBus } from "@/controls/ControlBus";
import { hardwareBindings, hardwareControls, setHardwareBinding } from "@/db/schema";
import { seedCodeTables } from "@/db/seeds";
import { attachMidiRouter, type MidiActionHandlers } from "./router";
import type { MidiManager } from "./MidiManager";
import type { MidiControl, MidiEvent } from "./types";

/** The router only needs `on("control", fn)` — a hand-rolled emitter stands in for the manager. */
function fakeMidi() {
  let handler: ((ev: MidiEvent) => void) | null = null;
  const midi = {
    on: (_ev: string, fn: (ev: MidiEvent) => void) => {
      handler = fn;
      return () => (handler = null);
    },
  } as unknown as MidiManager;
  const emit = (control: MidiControl) => handler?.({ control, kind: "cc" });
  return { midi, emit };
}

function ctl(id: string, over: Partial<MidiControl> = {}): MidiControl {
  return {
    id, label: id, continuous: true, subtype: "knob", channel: 0, number: 7,
    value: 0, raw: 0, pressed: false, relative: false, delta: 0,
    deviceId: "dev", deviceName: "Fake", hits: 1, lastSeen: 0,
    ...over,
  };
}

describe("attachMidiRouter (db-driven)", () => {
  let bus: ControlBus;
  let handlers: { step: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    seedCodeTables();
    hardwareBindings.replaceAll([]);
    hardwareControls.replaceAll([]);
    bus = new ControlBus();
    handlers = { step: vi.fn(), run: vi.fn() };
  });

  function attach(): ReturnType<typeof fakeMidi>["emit"] {
    const { midi, emit } = fakeMidi();
    attachMidiRouter(midi, bus, handlers as unknown as MidiActionHandlers);
    return emit;
  }

  it("auto-registers newly seen controls as identity rows (no binding)", () => {
    const emit = attach();
    emit(ctl("cc:0:7", { value: 0.5 }));
    const row = hardwareControls.get("cc:0:7");
    expect(row).toMatchObject({ name: "cc:0:7", kind: "knob", disabled: false, deviceName: "Fake" });
    expect(hardwareBindings.size).toBe(0);
    expect(bus.get("knob:0").hits).toBe(0); // unbound → nothing driven
  });

  it("drives a bound widget's bus slot from a continuous control", () => {
    const emit = attach();
    emit(ctl("cc:0:7")); // register
    setHardwareBinding("cc:0:7", { type: "widget", widgetId: "knob:3" });
    emit(ctl("cc:0:7", { value: 0.75 }));
    expect(bus.get("knob:3").value).toBe(0.75);
  });

  it("inverts the crossfader by default (it reports backwards)", () => {
    const emit = attach();
    emit(ctl("cc:0:8"));
    setHardwareBinding("cc:0:8", { type: "widget", widgetId: "crossfader:0" });
    emit(ctl("cc:0:8", { value: 0.2 }));
    expect(bus.get("crossfader:0").value).toBeCloseTo(0.8);
  });

  it("routes button presses into the slot's pressed state", () => {
    const emit = attach();
    emit(ctl("note:0:36", { continuous: false }));
    setHardwareBinding("note:0:36", { type: "widget", widgetId: "pad:4" });
    emit(ctl("note:0:36", { continuous: false, pressed: true }));
    expect(bus.get("pad:4").pressed).toBe(true);
    expect(bus.get("pad:4").presses).toBe(1);
  });

  it("runs momentary app actions on press only", () => {
    const emit = attach();
    emit(ctl("note:0:1", { continuous: false }));
    setHardwareBinding("note:0:1", { type: "action", actionId: "loadA" });
    emit(ctl("note:0:1", { continuous: false, pressed: false }));
    expect(handlers.run).not.toHaveBeenCalled();
    emit(ctl("note:0:1", { continuous: false, pressed: true }));
    expect(handlers.run).toHaveBeenCalledWith("loadA");
  });

  it("browse steps by delta sign from a relative control and +1 from a button", () => {
    const emit = attach();
    emit(ctl("cc:0:20", { relative: true }));
    setHardwareBinding("cc:0:20", { type: "action", actionId: "browse" });
    emit(ctl("cc:0:20", { relative: true, delta: -3 }));
    expect(handlers.step).toHaveBeenCalledWith(-1);

    emit(ctl("note:0:2", { continuous: false }));
    setHardwareBinding("note:0:2", { type: "action", actionId: "browse" });
    emit(ctl("note:0:2", { continuous: false, pressed: true }));
    expect(handlers.step).toHaveBeenCalledWith(1);
  });

  it("routes nothing for disabled controls", () => {
    const emit = attach();
    emit(ctl("cc:0:7"));
    setHardwareBinding("cc:0:7", { type: "widget", widgetId: "knob:0" });
    hardwareControls.update("cc:0:7", { disabled: true });
    emit(ctl("cc:0:7", { value: 0.9 }));
    expect(bus.get("knob:0").hits).toBe(0);
  });

  it("cascades the binding away when its control row is deleted", () => {
    const emit = attach();
    emit(ctl("cc:0:7"));
    setHardwareBinding("cc:0:7", { type: "widget", widgetId: "knob:0" });
    expect(hardwareBindings.size).toBe(1);
    hardwareControls.delete("cc:0:7");
    expect(hardwareBindings.size).toBe(0);
  });
});
