import { pickMime, triggerDownload } from "./download";
import { drawFrameInto, type ExportFrameOptions } from "./frameCanvas";
import { VIDEO_QUALITIES, type ExportProgress, type VideoQualityId } from "./types";

export interface VideoExportInput {
  /** The live engine canvas, redrawn into the export frame each tick while it plays. */
  source: HTMLCanvasElement;
  frame: ExportFrameOptions;
  /** Quality preset (fps, supersampling, bitrate). Defaults to "high". */
  quality?: VideoQualityId;
  /** Wall-clock seconds of live footage to capture. */
  durationSec: number;
  baseName: string;
  onProgress?: (p: ExportProgress) => void;
}

/**
 * Target encoder bitrate (bits/sec) from the output resolution and frame rate. A flat bitrate
 * starves large frames and wastes bits on small ones, so we scale with pixels·fps and clamp to a
 * sane range, then let the quality preset bias it up or down.
 */
function targetBitrate(width: number, height: number, fps: number, factor: number): number {
  // ~0.07 bits per pixel per frame is a good baseline for clean shader/vector footage.
  const raw = width * height * fps * 0.07 * factor;
  return Math.round(Math.min(80_000_000, Math.max(4_000_000, raw)));
}

/**
 * Realtime WebM capture of whatever the engine is currently rendering, for a fixed number of
 * seconds. The instrument plays forever, so a video export is simply "record the next N seconds":
 * we never touch the transport — we just mirror the live canvas into a reframed/masked target
 * canvas each animation frame and capture *that* stream. The quality preset controls capture fps,
 * supersampling (the target is rendered larger than the chosen ratio for crisper edges) and a
 * resolution-aware bitrate. WebM works across browsers and yields a valid file.
 */
export async function exportVideo(input: VideoExportInput): Promise<Blob> {
  // VP9 is the highest-quality WebM codec; fall back through VP8 then any WebM.
  const mime = pickMime([
    "video/webm;codecs=vp09.00.40.08",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ]);
  if (!mime) throw new Error("WebM recording isn't supported in this browser.");

  const { source, frame, durationSec, baseName } = input;
  const q = VIDEO_QUALITIES[input.quality ?? "high"];
  const fps = q.fps;
  // Video has no alpha — paint masked-out regions black.
  const opts: ExportFrameOptions = { ...frame, background: "#000" };

  // Supersample: render the target larger than the chosen ratio, then encode at that resolution.
  const outW = Math.round(frame.ratio.width * q.scale);
  const outH = Math.round(frame.ratio.height * q.scale);
  const target = document.createElement("canvas");
  target.width = outW;
  target.height = outH;
  // drawFrameInto sizes the canvas to ratio.width/height, so feed it a scaled ratio.
  const scaledOpts: ExportFrameOptions = { ...opts, ratio: { ...frame.ratio, width: outW, height: outH } };

  const bitrate = targetBitrate(outW, outH, fps, q.bitrateFactor);
  const stream = (target as unknown as { captureStream: (fps: number) => MediaStream }).captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
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
    drawFrameInto(target, source, source.width, source.height, scaledOpts);
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
