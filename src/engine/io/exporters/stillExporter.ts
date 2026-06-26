import { canvasToBlob, triggerDownload } from "./download";
import { makeFrameCanvas, type ExportFrameOptions } from "./frameCanvas";
import type { StillFormat } from "./types";

export interface StillExportInput {
  /** The freshly rendered engine canvas. */
  source: HTMLCanvasElement;
  frame: ExportFrameOptions;
  format: StillFormat;
  quality: number;
  baseName: string;
  /** Frame number, for the filename suffix. */
  frameNumber: number;
}

function pad(n: number, width = 5): string {
  return String(n).padStart(width, "0");
}

/** Render one frame to the chosen aspect ratio + mask and download it. */
export async function exportStill(input: StillExportInput): Promise<Blob> {
  const { source, frame, format, quality, baseName, frameNumber } = input;
  // PNG keeps the masked region transparent; JPEG can't, so fall back to black behind the cut.
  const opts: ExportFrameOptions = format === "jpeg" ? { ...frame, background: "#000" } : frame;
  const canvas = makeFrameCanvas(source, source.width, source.height, opts);
  const mime = format === "png" ? "image/png" : "image/jpeg";
  const blob = await canvasToBlob(canvas, mime, quality);
  triggerDownload(blob, `${baseName}_${pad(frameNumber)}.${format}`);
  return blob;
}
