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

/** Container/codec choice for video exports. */
export type VideoFormatId = "webm" | "mp4";

export interface VideoFormat {
  id: VideoFormatId;
  label: string;
  /** File extension for the download. */
  ext: string;
  /** MediaRecorder mime candidates, best first. */
  mimes: string[];
}

export const VIDEO_FORMATS: Record<VideoFormatId, VideoFormat> = {
  webm: {
    id: "webm",
    label: "WebM",
    ext: "webm",
    // VP9 is the highest-quality WebM codec; fall back through VP8 then any WebM.
    mimes: ["video/webm;codecs=vp09.00.40.08", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
  },
  mp4: {
    id: "mp4",
    label: "MP4",
    ext: "mp4",
    // H.264 in MP4 — supported by Safari's MediaRecorder and recent Chrome.
    mimes: ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1.42E01E", "video/mp4"],
  },
};

/** The formats this browser's MediaRecorder can actually produce (webm effectively always). */
export function supportedVideoFormats(): VideoFormat[] {
  if (typeof MediaRecorder === "undefined") return [];
  return Object.values(VIDEO_FORMATS).filter((f) => f.mimes.some((m) => MediaRecorder.isTypeSupported(m)));
}

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
  /** Quality preset; the resolution scale applies to BOTH video and still exports (fps/bitrate
   * are video-only). Defaults to "high". */
  videoQuality?: VideoQualityId;
  /** Container/codec for a video export; defaults to "webm". */
  videoFormat?: VideoFormatId;
}
