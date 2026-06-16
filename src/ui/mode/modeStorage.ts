export type UiMode = "simple" | "pro";

const KEY = "marathon.uiMode";

export function loadMode(): UiMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "pro" ? "pro" : "simple";
  } catch {
    return "simple";
  }
}

export function saveMode(mode: UiMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* ignore (private mode / SSR) */
  }
}
