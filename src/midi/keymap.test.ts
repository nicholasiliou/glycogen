import { describe, expect, it } from "vitest";
import {
  autoAssign,
  bindingKey,
  parseBindingKey,
  sanitizeKeymap,
  type Binding,
  type EffectiveControl,
} from "./keymap";

function ctl(id: string, kind: EffectiveControl["kind"]): EffectiveControl {
  return { id, name: id, kind, continuous: kind !== "button", relative: kind === "encoder" || kind === "jog", binding: null, disabled: false, known: false };
}

describe("binding keys", () => {
  it("round-trips slot and action bindings", () => {
    const slot: Binding = { kind: "slot", slot: "knob:2" };
    const action: Binding = { kind: "action", action: "loadA" };
    expect(parseBindingKey(bindingKey(slot))).toEqual(slot);
    expect(parseBindingKey(bindingKey(action))).toEqual(action);
    expect(parseBindingKey(bindingKey(null))).toBeNull();
  });
});

describe("autoAssign", () => {
  it("maps hardware kinds straight onto controller slots + a few app actions", () => {
    const map = autoAssign([
      ctl("cc:0:0", "fader"),
      ctl("cc:0:1", "fader"),
      ctl("cc:0:2", "fader"),
      ctl("cc:0:10", "encoder"),
      ctl("cc:0:11", "knob"),
      ctl("note:0:1", "button"),
      ctl("note:0:2", "button"),
    ]);
    // faders → fader slots, last → crossfader
    expect(map["cc:0:0"]).toEqual({ kind: "slot", slot: "fader:0" });
    expect(map["cc:0:1"]).toEqual({ kind: "slot", slot: "fader:1" });
    expect(map["cc:0:2"]).toEqual({ kind: "slot", slot: "crossfader:0" });
    // first encoder → browse
    expect(map["cc:0:10"]).toEqual({ kind: "action", action: "browse" });
    // knob → knob slot
    expect(map["cc:0:11"]).toEqual({ kind: "slot", slot: "knob:0" });
    // buttons → app actions
    expect(map["note:0:1"]).toEqual({ kind: "action", action: "loadA" });
    expect(map["note:0:2"]).toEqual({ kind: "action", action: "loadB" });
  });
});

describe("sanitizeKeymap", () => {
  it("keeps valid bindings and drops malformed ones", () => {
    const k = sanitizeKeymap({
      name: "Test",
      controls: {
        "cc:0:0": { name: "Fader", kind: "fader", binding: { kind: "slot", slot: "fader:0" } },
        "cc:0:1": { name: "Bad", kind: "knob", binding: { kind: "nope" } },
      },
    });
    expect(k).not.toBeNull();
    expect(k!.controls["cc:0:0"].binding).toEqual({ kind: "slot", slot: "fader:0" });
    expect(k!.controls["cc:0:1"].binding).toBeNull();
  });
});
