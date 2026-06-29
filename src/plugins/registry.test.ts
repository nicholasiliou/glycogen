import { describe, expect, it } from "vitest";
import { create, list } from "./registry";

describe("registry (path-derived discovery)", () => {
  it("discovers ported plugins and derives id/label/kind from the path", () => {
    const ids = list().map((p) => p.id);
    expect(ids).toContain("shape");
    expect(ids).toContain("pixelate");
    expect(list().find((p) => p.id === "shape")).toMatchObject({ label: "Shape", kind: "generator" });
    expect(list().find((p) => p.id === "pixelate")).toMatchObject({ label: "Pixelate", kind: "effect" });
  });

  it("instantiates by id with its controls already bound + named", () => {
    const shape = create("shape");
    expect(shape.params.length).toBeGreaterThan(0);
    expect(shape.params.every((p) => p.name.length > 0)).toBe(true); // field names assigned
  });

  it("discovers the full ported catalog (generators + effect shaders)", () => {
    const ids = list().map((p) => p.id);
    for (const id of ["shape", "noise", "boids", "gameOfLife", "physarum", "reactionDiffusion",
      "landscape", "harmonograph", "volumetricCloud", "text", "contourField", "glyph", "glyphScatter", "plant"]) {
      expect(ids).toContain(id);
    }
    for (const id of ["pixelate", "bayer", "ascii", "colorLookup", "deepGlow", "fisheye",
      "pixelSort", "pixelStretch", "venetianBlinds", "tracker"]) {
      expect(ids).toContain(id);
      expect(list().find((p) => p.id === id)?.kind).toBe("effect");
    }
  });
});
