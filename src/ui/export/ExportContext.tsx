import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { resolveAspectRatio, type AspectRatio, type AspectRatioId, type ExportSettings, type VideoFormatId, type VideoQualityId } from "@/runtime/export";

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
  watermarkEnabled: boolean;
  setWatermarkEnabled: (b: boolean) => void;
  videoQuality: VideoQualityId;
  setVideoQuality: (q: VideoQualityId) => void;
  videoFormat: VideoFormatId;
  setVideoFormat: (f: VideoFormatId) => void;
  /** The resolved target dimensions for the current selection. */
  ratio: AspectRatio;
  /** Snapshot of the settings for an export call. */
  settings: (videoDurationSec?: number) => ExportSettings;
}

const ExportCtx = createContext<ExportContextValue | null>(null);

export function ExportProvider({ children }: { children: ReactNode }) {
  const [ratioId, setRatioId] = useState<AspectRatioId>("16:9");
  // Custom is a relative ratio (w:h), resolved to pixels by resolveAspectRatio.
  const [custom, setCustom] = useState({ width: 1, height: 1 });
  const [maskEnabled, setMaskEnabled] = useState(true);
  const [maskVariant, setMaskVariant] = useState(0);
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);
  const [videoQuality, setVideoQuality] = useState<VideoQualityId>("high");
  const [videoFormat, setVideoFormat] = useState<VideoFormatId>("webm");

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
    watermarkEnabled,
    setWatermarkEnabled,
    videoQuality,
    setVideoQuality,
    videoFormat,
    setVideoFormat,
    ratio,
    settings: (videoDurationSec) => ({
      aspectRatio: ratioId,
      custom: ratioId === "custom" ? custom : undefined,
      maskEnabled,
      maskVariant,
      videoDurationSec,
      videoQuality,
      videoFormat,
    }),
  };

  return <ExportCtx.Provider value={value}>{children}</ExportCtx.Provider>;
}

export function useExportSettings(): ExportContextValue {
  const ctx = useContext(ExportCtx);
  if (!ctx) throw new Error("useExportSettings must be used within <ExportProvider>");
  return ctx;
}
