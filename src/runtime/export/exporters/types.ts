import type { AspectRatioId } from "./aspectRatios";

export type StillFormat = "png" | "jpeg";

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
}
