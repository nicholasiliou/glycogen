import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MidiControl } from "./types";
import {
  autoAssign,
  createPreset,
  defaultKindFor,
  duplicatePreset,
  effectiveControls,
  exportPreset,
  kindIsContinuous,
  kindIsRelative,
  loadActiveId,
  loadPresets,
  parsePreset,
  saveActiveId,
  savePresets,
  sanitizePreset,
} from "./preset";

function control(id: string, over: Partial<MidiControl> = {}): MidiControl {
  return {
    id,
    label: id,
    continuous: true,
    subtype: "knob",
    channel: 0,
    number: 7,
    value: 0,
    raw: 0,
    pressed: false,
    relative: false,
    delta: 0,
    deviceId: "dev",
    deviceName: "Test Device",
    hits: 1,
    lastSeen: 0,
    ...over,
  };
}

describe("defaultKindFor", () => {
  it("maps detection to a sensible kind", () => {
    expect(defaultKindFor({ continuous: false, relative: false, subtype: "pad" })).toBe("button");
    expect(defaultKindFor({ continuous: true, relative: false, subtype: "fader" })).toBe("fader");
    expect(defaultKindFor({ continuous: true, relative: false, subtype: "knob" })).toBe("knob");
    expect(defaultKindFor({ continuous: true, relative: true, subtype: "jog" })).toBe("jog");
    expect(defaultKindFor({ continuous: true, relative: true, subtype: "knob" })).toBe("encoder");
  });
});

describe("kind behaviour", () => {
  it("derives continuous / relative from the kind", () => {
    expect(kindIsContinuous("fader")).toBe(true);
    expect(kindIsContinuous("button")).toBe(false);
    expect(kindIsRelative("encoder")).toBe(true);
    expect(kindIsRelative("jog")).toBe(true);
    expect(kindIsRelative("knob")).toBe(false);
  });
});

describe("effectiveControls", () => {
  it("merges live controls with the preset, letting the preset win", () => {
    const preset = createPreset("p");
    preset.controls["cc:0:7"] = { controlId: "cc:0:7", name: "Volume", kind: "fader", assignment: "A:amount" };
    preset.controls["cc:0:9"] = { controlId: "cc:0:9", name: "Phantom", kind: "encoder", assignment: "none" };

    const live = [control("cc:0:7", { subtype: "knob" }), control("note:0:36", { continuous: false, subtype: "pad" })];
    const eff = effectiveControls(live, preset);
    const byId = Object.fromEntries(eff.map((e) => [e.id, e]));

    // preset name/kind/assignment override the live detection
    expect(byId["cc:0:7"].name).toBe("Volume");
    expect(byId["cc:0:7"].kind).toBe("fader");
    expect(byId["cc:0:7"].assignment).toBe("A:amount");
    expect(byId["cc:0:7"].live).toBeDefined();

    // live-only control falls back to detected default
    expect(byId["note:0:36"].kind).toBe("button");
    expect(byId["note:0:36"].known).toBe(false);

    // preset-only control still appears, without a live snapshot
    expect(byId["cc:0:9"].known).toBe(true);
    expect(byId["cc:0:9"].live).toBeUndefined();
    expect(byId["cc:0:9"].relative).toBe(true);
  });

  it("orders CC before notes for a stable table", () => {
    const eff = effectiveControls([control("note:0:40", { continuous: false }), control("cc:0:1")], null);
    expect(eff.map((e) => e.id)).toEqual(["cc:0:1", "note:0:40"]);
  });
});

describe("export / import", () => {
  it("round-trips controls (name/kind/assignment/disabled) with a fresh id", () => {
    const preset = createPreset("MixTrack");
    preset.controls["cc:0:7"] = { controlId: "cc:0:7", name: "Vol", kind: "fader", assignment: "A:amount" };
    preset.controls["cc:0:8"] = { controlId: "cc:0:8", name: "Bad", kind: "knob", assignment: "none", disabled: true };

    const parsed = parsePreset(exportPreset(preset));
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("MixTrack");
    expect(parsed!.controls["cc:0:7"]).toEqual({ controlId: "cc:0:7", name: "Vol", kind: "fader", assignment: "A:amount" });
    expect(parsed!.controls["cc:0:8"].disabled).toBe(true);
    expect(parsed!.id).not.toBe(preset.id); // never clobbers the source
  });

  it("migrates a legacy roles map onto control assignments", () => {
    const legacy = { name: "Old", controls: {}, roles: { wheel: "cc:0:20", add: "note:0:1", remove: "note:0:2" } };
    const p = sanitizePreset(legacy);
    expect(p!.controls["cc:0:20"].assignment).toBe("browse");
    expect(p!.controls["note:0:1"].assignment).toBe("loadA");
    expect(p!.controls["note:0:2"].assignment).toBe("loadB");
    expect("roles" in p!).toBe(false);
  });

  it("rejects malformed json and coerces bad fields", () => {
    expect(parsePreset("not json")).toBeNull();
    expect(sanitizePreset(42)).toBeNull();
    const p = sanitizePreset({ controls: { "cc:0:1": { kind: "bogus", assignment: "garbage" } } });
    expect(p).not.toBeNull();
    expect(p!.controls["cc:0:1"].kind).toBe("knob"); // bad kind -> default
    expect(p!.controls["cc:0:1"].assignment).toBe("none"); // bad assignment -> default
    expect(p!.name).toBe("Imported preset"); // missing name -> default
  });
});

describe("autoAssign", () => {
  it("lays out faders/encoders/knobs/buttons onto sensible defaults", () => {
    const eff = effectiveControls(
      [
        control("cc:0:1", { subtype: "fader" }),
        control("cc:0:2", { subtype: "fader" }),
        control("cc:0:3", { subtype: "fader" }),
        control("cc:0:10", { relative: true, subtype: "jog" }),
        control("cc:0:11", { relative: true, subtype: "jog" }),
        control("note:0:1", { continuous: false }),
        control("note:0:2", { continuous: false }),
      ],
      null,
    );
    const map = autoAssign(eff);
    expect(map["cc:0:1"]).toBe("A:amount");
    expect(map["cc:0:2"]).toBe("B:amount");
    expect(map["cc:0:3"]).toBe("crossfade");
    expect(map["cc:0:10"]).toBe("browse");
    expect(map["cc:0:11"]).toBe("A:evolveX");
    expect(map["note:0:1"]).toBe("clearA");
    expect(map["note:0:2"]).toBe("clearB");
  });
});

describe("localStorage persistence", () => {
  // jsdom builds vary in their localStorage shim; use a deterministic Map-backed one.
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
  });

  it("round-trips presets and the active id, preserving ids", () => {
    const a = createPreset("A");
    const b = duplicatePreset(a, "B");
    savePresets([a, b]);
    saveActiveId(b.id);

    const loaded = loadPresets();
    expect(loaded.map((p) => p.id)).toEqual([a.id, b.id]);
    expect(loadActiveId()).toBe(b.id);
  });

  it("returns an empty list when nothing is stored", () => {
    expect(loadPresets()).toEqual([]);
    expect(loadActiveId()).toBeNull();
  });
});
