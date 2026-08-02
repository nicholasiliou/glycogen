import { createContext, useContext, useState, type ReactNode } from "react";
import { isPrintRatio, type AspectRatioId, type ExportSettings, type VideoFormatId } from "@/runtime/export";

const MIN_PX = 480;
const DEFAULT_W = 1920;
const DEFAULT_H = 1080;
const DEFAULT_FPS = 30;

interface ExportContextValue {
  ratioId: AspectRatioId;
  setRatioId: (id: AspectRatioId) => void;
  pixelWidth: number;
  setPixelWidth: (n: number) => void;
  pixelHeight: number;
  setPixelHeight: (n: number) => void;
  fps: number;
  setFps: (n: number) => void;
  /** Whether W and H are aspect-locked together. */
  linked: boolean;
  setLinked: (b: boolean) => void;
  maskEnabled: boolean;
  setMaskEnabled: (b: boolean) => void;
  maskVariant: number;
  setMaskVariant: (i: number) => void;
  watermarkEnabled: boolean;
  setWatermarkEnabled: (b: boolean) => void;
  videoFormat: VideoFormatId;
  setVideoFormat: (f: VideoFormatId) => void;
  /** Snapshot of the settings for an export call. */
  settings: (videoDurationSec?: number) => ExportSettings;
}

const ExportCtx = createContext<ExportContextValue | null>(null);

export function ExportProvider({ children }: { children: ReactNode }) {
  const [ratioId, setRatioIdRaw] = useState<AspectRatioId>("16:9");
  const [pixelWidth, setPixelWidthRaw] = useState(DEFAULT_W);
  const [pixelHeight, setPixelHeightRaw] = useState(DEFAULT_H);
  const [fps, setFpsRaw] = useState(DEFAULT_FPS);
  const [linked, setLinked] = useState(true);
  const [maskEnabled, setMaskEnabled] = useState(true);
  const [maskVariant, setMaskVariant] = useState(0);
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [videoFormat, setVideoFormat] = useState<VideoFormatId>("webm");

  const aspectW = pixelWidth;
  const aspectH = pixelHeight;

  const setRatioId = (id: AspectRatioId) => {
    setRatioIdRaw(id);
    // Preset ratios have known canonical sizes — apply them directly.
    const presets: Partial<Record<AspectRatioId, { w: number; h: number }>> = {
      "16:9": { w: 1920, h: 1080 },
      "9:16": { w: 1080, h: 1920 },
      "1:1":  { w: 1080, h: 1080 },
      "4:5":  { w: 1080, h: 1350 },
      A4:     { w: 1240, h: 1754 },
      A3:     { w: 1754, h: 2480 },
      A2:     { w: 2480, h: 3508 },
      A1:     { w: 3508, h: 4967 },
    };
    const p = presets[id];
    if (p) {
      setPixelWidthRaw(p.w);
      setPixelHeightRaw(p.h);
    }
  };

  const setPixelWidth = (n: number) => {
    const clamped = Math.max(MIN_PX, Math.round(n));
    if (linked && aspectH > 0) {
      const ratio = aspectW / aspectH;
      const newH = Math.max(MIN_PX, Math.round(clamped / ratio));
      setPixelWidthRaw(clamped);
      setPixelHeightRaw(newH);
    } else {
      setPixelWidthRaw(clamped);
    }
    setRatioIdRaw("custom");
  };

  const setPixelHeight = (n: number) => {
    const clamped = Math.max(MIN_PX, Math.round(n));
    if (linked && aspectW > 0) {
      const ratio = aspectW / aspectH;
      const newW = Math.max(MIN_PX, Math.round(clamped * ratio));
      setPixelHeightRaw(clamped);
      setPixelWidthRaw(newW);
    } else {
      setPixelHeightRaw(clamped);
    }
    setRatioIdRaw("custom");
  };

  const setFps = (n: number) => setFpsRaw(Math.max(1, Math.min(120, Math.round(n))));

  const print = isPrintRatio(ratioId);

  const value: ExportContextValue = {
    ratioId,
    setRatioId,
    pixelWidth,
    setPixelWidth,
    pixelHeight,
    setPixelHeight,
    fps,
    setFps,
    linked,
    setLinked,
    maskEnabled,
    setMaskEnabled,
    maskVariant,
    setMaskVariant,
    watermarkEnabled,
    setWatermarkEnabled,
    videoFormat,
    setVideoFormat,
    settings: (videoDurationSec) => ({
      width: pixelWidth,
      height: pixelHeight,
      aspectRatio: ratioId,
      maskEnabled,
      maskVariant,
      videoDurationSec,
      fps: print ? 1 : fps,
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
