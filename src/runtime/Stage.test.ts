import { beforeEach, describe, expect, it } from "vitest";
import { ControlBus } from "@/controls/ControlBus";
import { Plugin, type FieldFn, type Frame } from "@/plugins/Plugin";
import { Stage } from "./Stage";

/** A generator whose only param is a fader. */
class Gen extends Plugin {
  level = this.fader(0, { min: 0, max: 100 });
  render(): HTMLCanvasElement {
    return this.canvas;
  }
}

/** A text-like generator that exports a constant field. */
class Text extends Plugin {
  render(): HTMLCanvasElement {
    return this.canvas;
  }
  exportField(): FieldFn {
    return () => 1;
  }
}

/** A sim-like generator that records the textField it received this frame. */
class Sim extends Plugin {
  sawField: FieldFn | null = null;
  render(f: Frame): HTMLCanvasElement {
    this.sawField = f.textField;
    return this.canvas;
  }
}

/** An effect: records the input it was handed and a knob param. */
class Fx extends Plugin {
  amount = this.knob(0, { min: 0, max: 100 });
  sawInput: HTMLCanvasElement | null = null;
  render(f: Frame): HTMLCanvasElement {
    this.sawInput = f.input;
    return this.canvas;
  }
}

// jsdom has no 2D backend, so stub the contexts the Stage composites with.
const fakeCtx = () => ({ clearRect() {}, drawImage() {}, globalAlpha: 1 }) as unknown as CanvasRenderingContext2D;
const stubCanvas = () => ({ width: 64, height: 64, getContext: () => fakeCtx() }) as unknown as HTMLCanvasElement;

let bus: ControlBus;
let stage: Stage;
beforeEach(() => {
  bus = new ControlBus();
  stage = new Stage(bus, stubCanvas());
  // jsdom canvases have no 2D backend, so give the internal composite buffer and per-deck
  // compositor canvases working (fake) contexts.
  const internals = stage as unknown as {
    bctx: CanvasRenderingContext2D;
    deckCtx: Record<"A" | "B", CanvasRenderingContext2D>;
  };
  internals.bctx = fakeCtx();
  internals.deckCtx = { A: fakeCtx(), B: fakeCtx() };
});

describe("Stage decks/banks", () => {
  it("loadBank places a plugin in a bank and makes it active + managed", () => {
    const gen = new Gen();
    stage.loadBank("A", 1, gen);
    expect(stage.decks.A.active).toBe(1);
    expect(stage.active("A")).toBe(gen);
    expect(stage.managed()).toBe(gen); // focus defaults to A
  });

  it("selectBank only switches to a loaded bank; clearBank empties the active one", () => {
    const gen = new Gen();
    stage.loadBank("A", 0, gen);
    stage.selectBank("A", 2); // bank 2 is empty → ignored
    expect(stage.decks.A.active).toBe(0);
    stage.clearBank("A");
    expect(stage.active("A")).toBeNull();
  });

  it("drives only the focused deck's active bank from the bus", () => {
    // The controller drives one layer at a time. Param state is retained per instance, so a setting
    // made while focused persists after focus moves — text interaction doesn't need live tracking.
    const a = new Gen();
    const b = new Gen();
    stage.loadBank("A", 0, a);
    stage.loadBank("B", 0, b);
    stage.focus = "A";
    bus.drive("fader:0", { value: 1 });
    stage.tick(1);
    expect(a.level.value).toBe(100);
    expect(b.level.value).toBe(0); // unfocused deck holds its last value
  });
});

describe("Stage text field", () => {
  it("threads a TextLayer's field to a sim in the OTHER deck (stage-wide)", () => {
    stage.loadBank("A", 0, new Text());
    const sim = new Sim();
    stage.loadBank("B", 0, sim);
    stage.tick(1);
    expect(sim.sawField).not.toBeNull();
  });

  it("threads a TextLayer's field to a sim in a different bank of the same deck", () => {
    stage.loadBank("A", 0, new Text());
    const sim = new Sim();
    stage.loadBank("A", 1, sim);
    stage.tick(1);
    expect(sim.sawField).not.toBeNull();
  });

  it("leaves textField null when no TextLayer is loaded", () => {
    const sim = new Sim();
    stage.loadBank("A", 0, sim);
    stage.tick(1);
    expect(sim.sawField).toBeNull();
  });
});

describe("Stage shader slot", () => {
  it("feeds the composited decks into the shader as input", () => {
    stage.loadBank("A", 0, new Gen());
    const fx = new Fx();
    stage.setShader(fx);
    stage.tick(1);
    expect(fx.sawInput).toBe((stage as unknown as { buffer: HTMLCanvasElement }).buffer);
  });

  it("drives the shader's params when it is focused", () => {
    const fx = new Fx();
    stage.setShader(fx);
    stage.focus = "shader";
    bus.drive("knob:0", { value: 0.5 });
    stage.tick(1);
    expect(fx.amount.value).toBe(50);
  });

  it("editing the focused shader does not touch deck plugins", () => {
    // With the shader focused, only the shader pulls the bus — the deck plugin below holds its value.
    const gen = new Gen(); // level on fader:0
    stage.loadBank("A", 0, gen);
    stage.setShader(new Fx()); // amount on knob:0
    stage.focus = "shader";
    bus.drive("fader:0", { value: 1 }); // the deck plugin's slot
    stage.tick(1);
    expect(gen.level.value).toBe(0); // unfocused deck plugin unchanged
  });
});
