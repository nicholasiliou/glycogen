import { describe, it, expect } from "vitest";
import { textLayerType } from "./TextLayer";

describe("text layer field source", () => {
  it("exposes fieldSource and sourceKey on its renderer", () => {
    const renderer = textLayerType.createRenderer({} as never, {} as never);
    expect(typeof renderer.fieldSource).toBe("function");
    expect(typeof renderer.sourceKey).toBe("function");
  });

  it("fieldSource returns a sampler function (zero field without a 2D canvas)", () => {
    const renderer = textLayerType.createRenderer({} as never, {} as never);
    const field = renderer.fieldSource!({ text: "HI", fontSize: 120, tracking: 0, bold: true })!;
    expect(typeof field).toBe("function");
    expect(field(0.5, 0.5, 0)).toBe(0);
  });

  it("sourceKey changes when the text changes", () => {
    const renderer = textLayerType.createRenderer({} as never, {} as never);
    const k1 = renderer.sourceKey!({ text: "A", fontSize: 120, tracking: 0, bold: true }, 0);
    const k2 = renderer.sourceKey!({ text: "B", fontSize: 120, tracking: 0, bold: true }, 0);
    expect(k1).not.toBe(k2);
  });
});
