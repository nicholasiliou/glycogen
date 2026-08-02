import { pickMime, triggerDownload } from "./download";
import { drawFrameInto, type ExportFrameOptions } from "./frameCanvas";
import { VIDEO_FORMATS, type ExportProgress, type VideoFormatId } from "./types";

export interface VideoExportInput {
  /** The live engine canvas, redrawn into the export frame each tick while it plays. */
  source: HTMLCanvasElement;
  frame: ExportFrameOptions;
  /** Capture frame rate. */
  fps: number;
  /** Container/codec. Defaults to "webm" (always recordable). */
  format?: VideoFormatId;
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
 * Realtime capture of whatever the engine is currently rendering, for a fixed number of seconds.
 * The instrument plays forever, so a video export is simply "record the next N seconds": we never
 * touch the transport — we just mirror the live canvas into a reframed/masked target canvas and
 * capture *that* stream. The quality preset controls capture fps, supersampling (the target is
 * rendered larger than the chosen ratio for crisper edges) and a resolution-aware bitrate; the
 * format picks the container/codec (WebM everywhere, MP4 where MediaRecorder supports it).
 */
export async function exportVideo(input: VideoExportInput): Promise<Blob> {
  const format = VIDEO_FORMATS[input.format ?? "webm"];
  const mime = pickMime(format.mimes);
  if (!mime) throw new Error(`${format.label} recording isn't supported in this browser.`);

  const { source, frame, durationSec, baseName } = input;
  const fps = input.fps;
  // Video has no alpha — paint masked-out regions black.
  const opts: ExportFrameOptions = { ...frame, background: "#000" };

  const outW = frame.ratio.width;
  const outH = frame.ratio.height;
  const target = document.createElement("canvas");
  target.width = outW;
  target.height = outH;
  const scaledOpts: ExportFrameOptions = { ...opts, ratio: { ...frame.ratio, width: outW, height: outH } };

  const bitrate = targetBitrate(outW, outH, fps, 1);
  // Capture with an explicit per-frame push (`requestFrame`), not `captureStream(fps)`: the
  // fps-throttled stream only samples the canvas when the browser notices a repaint, so under
  // load frames land unevenly and the recording stutters below the nominal rate. With frameRate 0
  // nothing is captured until we ask — we draw on our own fps clock below and push each frame the
  // moment it's drawn, so the encoder sees frames at the cadence the preset promises.
  const captureTarget = target as unknown as { captureStream: (fps?: number) => MediaStream };
  let stream = captureTarget.captureStream(0);
  const pushTrack = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const requestFrame =
    typeof pushTrack.requestFrame === "function"
      ? () => pushTrack.requestFrame!()
      : null;
  // No requestFrame support → fall back to the throttled auto-capture stream.
  if (!requestFrame) stream = captureTarget.captureStream(fps);
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

  // Redraw the reframed/masked target on the fps clock (not every animation frame): each drawn
  // frame is pushed to the encoder explicitly, and skipping the off-beat rAF ticks keeps the
  // expensive supersampled draw from starving the encoder at high display refresh rates.
  const frameMs = 1000 / fps;
  let nextDraw = performance.now();
  let raf = 0;
  const drawLoop = () => {
    const t = performance.now();
    if (!requestFrame || t >= nextDraw) {
      drawFrameInto(target, source, source.width, source.height, scaledOpts);
      requestFrame?.();
      nextDraw += frameMs;
      // If we fell behind more than a frame (tab hiccup), resync instead of bursting catch-ups.
      if (t >= nextDraw) nextDraw = t + frameMs;
    }
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
  triggerDownload(blob, `${baseName}.${format.ext}`);
  return blob;
}
