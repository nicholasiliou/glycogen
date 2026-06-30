import type { AspectRatioId } from "./aspectRatios";

export type StillFormat = "png" | "jpeg";

/** Video quality preset — trades file size/CPU for fidelity. */
export type VideoQualityId = "draft" | "standard" | "high" | "max";

export interface VideoQuality {
  id: VideoQualityId;
  label: string;
  /** Capture frame rate. */
  fps: number;
  /** Supersample factor: the target canvas is rendered this much larger than the chosen ratio,
   *  then encoded at that higher resolution for crisper edges. */
  scale: number;
  /** Multiplier on the resolution-derived target bitrate (1 = baseline). */
  bitrateFactor: number;
}

/** Quality presets in display order. `standard` matches the previous fixed behaviour. */
export const VIDEO_QUALITIES: Record<VideoQualityId, VideoQuality> = {
  draft: { id: "draft", label: "Draft", fps: 30, scale: 1, bitrateFactor: 0.5 },
  standard: { id: "standard", label: "Standard", fps: 60, scale: 1, bitrateFactor: 1 },
  high: { id: "high", label: "High", fps: 60, scale: 1.5, bitrateFactor: 1.6 },
  max: { id: "max", label: "Max", fps: 60, scale: 2, bitrateFactor: 2.4 },
};

export const VIDEO_QUALITY_LIST: VideoQuality[] = Object.values(VIDEO_QUALITIES);

export interface ExportProgress {
  frame: number;
  totalFrames: number;
  fraction: number;
}

/** What the user chose in the export panel — passed to the Exporter on each export. */
export interface ExportSettings {
  aspectRatio: AspectRatioId;
  /** Concrete size when `aspectRatio === "custom"`. */
  custom?: { width: number; height: number };
  /** Whether to bake a mask into the frame. */
  maskEnabled: boolean;
  /** Index into masksFor(aspectRatio); ignored when masks are off or none exist. */
  maskVariant?: number;
  /** Seconds of live footage to capture for a video export (the instrument runs forever, so a
   * video is "record the next N seconds", not a bounded work area). */
  videoDurationSec?: number;
  /** Quality preset for a video export; defaults to "high". */
  videoQuality?: VideoQualityId;
}
