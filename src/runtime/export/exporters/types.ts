import type { AspectRatioId } from "./aspectRatios";

export type StillFormat = "png" | "jpeg";


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
    // H.264 in MP4  -  supported by Safari's MediaRecorder and recent Chrome.
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

/** What the user chose in the export panel  -  passed to the Exporter on each export. */
export interface ExportSettings {
  /** Exact pixel dimensions for the export frame. */
  width: number;
  height: number;
  /** Whether to bake a mask into the frame. */
  maskEnabled: boolean;
  /** Index into masksFor(aspectRatio); ignored when masks are off or none exist. */
  maskVariant?: number;
  /** Aspect ratio id  -  used to look up masks; "custom" when the user typed their own px size. */
  aspectRatio: AspectRatioId;
  /** Seconds of live footage to capture for a video export. */
  videoDurationSec?: number;
  /** Capture frame rate for video exports. */
  fps: number;
  /** Container/codec for a video export; defaults to "webm". */
  videoFormat?: VideoFormatId;
}
