import { pickMime, triggerDownload } from "./download";
import { drawFrameInto, type ExportFrameOptions } from "./frameCanvas";
import type { ExportProgress } from "./types";

export interface VideoExportInput {
  /** The live engine canvas, redrawn into the export frame each tick while it plays. */
  source: HTMLCanvasElement;
  frame: ExportFrameOptions;
  fps: number;
  /** Wall-clock seconds of live footage to capture. */
  durationSec: number;
  baseName: string;
  onProgress?: (p: ExportProgress) => void;
}

/**
 * Realtime WebM capture of whatever the engine is currently rendering, for a fixed number of
 * seconds. The instrument plays forever, so a video export is simply "record the next N seconds":
 * we never touch the transport — we just mirror the live canvas into a reframed/masked target
 * canvas each animation frame and capture *that* stream. WebM works across browsers and yields a
 * valid file.
 */
export async function exportVideo(input: VideoExportInput): Promise<Blob> {
  const mime = pickMime(["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]);
  if (!mime) throw new Error("WebM recording isn't supported in this browser.");

  const { source, frame, fps, durationSec, baseName } = input;
  // Video has no alpha — paint masked-out regions black.
  const opts: ExportFrameOptions = { ...frame, background: "#000" };

  const target = document.createElement("canvas");
  target.width = frame.ratio.width;
  target.height = frame.ratio.height;

  const stream = (target as unknown as { captureStream: (fps: number) => MediaStream }).captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
  });

  const span = Math.max(0.1, durationSec);
  const totalFrames = Math.round(span * fps);
  const ms = span * 1000;

  recorder.start(100);

  // Redraw the reframed/masked target from the live canvas every animation frame.
  let raf = 0;
  const drawLoop = () => {
    drawFrameInto(target, source, source.width, source.height, opts);
    raf = requestAnimationFrame(drawLoop);
  };
  drawLoop();

  const startWall = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const el = performance.now() - startWall;
      input.onProgress?.({ frame: Math.round((el / 1000) * fps), totalFrames, fraction: Math.min(1, el / ms) });
      if (el >= ms) resolve();
      else setTimeout(tick, 100);
    };
    tick();
  });

  cancelAnimationFrame(raf);
  await new Promise((r) => setTimeout(r, 150)); // let the encoder flush the tail
  recorder.stop();
  const blob = await done;
  triggerDownload(blob, `${baseName}.webm`);
  return blob;
}
