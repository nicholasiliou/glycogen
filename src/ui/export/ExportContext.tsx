import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { resolveAspectRatio, type AspectRatio, type AspectRatioId, type ExportSettings } from "@/runtime/export";

/**
 * Shared export selection so the panel (which edits it) and the Stage (which previews it as a
 * framing guide) agree. Kept separate from LiveProvider to stay self-contained.
 */
interface ExportContextValue {
  ratioId: AspectRatioId;
  setRatioId: (id: AspectRatioId) => void;
  custom: { width: number; height: number };
  setCustom: (c: { width: number; height: number }) => void;
  maskEnabled: boolean;
  setMaskEnabled: (b: boolean) => void;
  maskVariant: number;
  setMaskVariant: (i: number) => void;
  /** The resolved target dimensions for the current selection. */
  ratio: AspectRatio;
  /** Snapshot of the settings for an export call. */
  settings: (videoDurationSec?: number) => ExportSettings;
}

const ExportCtx = createContext<ExportContextValue | null>(null);

export function ExportProvider({ children }: { children: ReactNode }) {
  const [ratioId, setRatioId] = useState<AspectRatioId>("16:9");
  const [custom, setCustom] = useState({ width: 1080, height: 1080 });
  const [maskEnabled, setMaskEnabled] = useState(true);
  const [maskVariant, setMaskVariant] = useState(0);

  const ratio = useMemo(
    () => resolveAspectRatio(ratioId, custom),
    [ratioId, custom],
  );

  const value: ExportContextValue = {
    ratioId,
    setRatioId,
    custom,
    setCustom,
    maskEnabled,
    setMaskEnabled,
    maskVariant,
    setMaskVariant,
    ratio,
    settings: (videoDurationSec) => ({
      aspectRatio: ratioId,
      custom: ratioId === "custom" ? custom : undefined,
      maskEnabled,
      maskVariant,
      videoDurationSec,
    }),
  };

  return <ExportCtx.Provider value={value}>{children}</ExportCtx.Provider>;
}

export function useExportSettings(): ExportContextValue {
  const ctx = useContext(ExportCtx);
  if (!ctx) throw new Error("useExportSettings must be used within <ExportProvider>");
  return ctx;
}
