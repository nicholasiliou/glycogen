import * as React from "react";
import { createContext, useContext, useState, useCallback } from "react";
import { loadMode, saveMode, type UiMode } from "./modeStorage";

interface ModeContextValue {
  mode: UiMode;
  setMode: (mode: UiMode) => void;
}

const ModeContext = createContext<ModeContextValue | null>(null);

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<UiMode>(() => loadMode());
  const setMode = useCallback((next: UiMode) => {
    setModeState(next);
    saveMode(next);
  }, []);
  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>;
}

export function useMode(): ModeContextValue {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error("useMode must be used within <ModeProvider>");
  return ctx;
}
