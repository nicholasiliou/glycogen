import { describe, expect, it } from "vitest";
import { embedPngTextBytes, readPngText } from "./pngMeta";

/** A minimal well-formed-enough PNG: signature + IHDR(13 bytes) + IEND. CRCs are zero  -  the
 *  codec never verifies them, it only walks length-prefixed chunks. */
function tinyPng(): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...new Array<number>(13).fill(0), 0, 0, 0, 0];
  const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0];
  return new Uint8Array([...sig, ...ihdr, ...iend]);
}

describe("pngMeta", () => {
  it("round-trips text through an embedded iTXt chunk", () => {
    const text = JSON.stringify({ app: "glycogen", v: 1, note: "ünïcode ✓" });
    const data = embedPngTextBytes(tinyPng(), "glycogen:scene", text);
    expect(data).not.toBeNull();
    expect(readPngText(data!, "glycogen:scene")).toBe(text);
  });

  it("returns null for a missing keyword and for non-PNG data", () => {
    const data = embedPngTextBytes(tinyPng(), "glycogen:scene", "x")!;
    expect(readPngText(data, "other")).toBeNull();
    expect(readPngText(new Uint8Array([1, 2, 3]), "glycogen:scene")).toBeNull();
  });

  it("refuses to embed into non-PNG bytes", () => {
    expect(embedPngTextBytes(new Uint8Array([1, 2, 3]), "k", "v")).toBeNull();
  });
});
