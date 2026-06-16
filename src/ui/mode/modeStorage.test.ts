import { describe, it, expect, beforeEach } from "vitest";
import { loadMode, saveMode, type UiMode } from "./modeStorage";

describe("modeStorage", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to simple when nothing is stored", () => {
    expect(loadMode()).toBe("simple");
  });

  it("round-trips a saved mode", () => {
    saveMode("pro");
    expect(loadMode()).toBe("pro");
  });

  it("falls back to simple on a corrupt value", () => {
    localStorage.setItem("marathon.uiMode", "garbage");
    const v: UiMode = loadMode();
    expect(v).toBe("simple");
  });
});
