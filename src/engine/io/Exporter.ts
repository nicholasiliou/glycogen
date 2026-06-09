import type { Engine } from "../Engine";
import { serializeProject } from "./serialize";

export type StillFormat = "png" | "jpeg";

export interface ExportProgress {
  frame: number;
  totalFrames: number;
  fraction: number;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function pad(n: number, width = 5): string {
  return String(n).padStart(width, "0");
}

/**
 * Export pipeline.
 *
 * Stills & PNG sequences drive the engine's deterministic render path frame-by-frame
 * (independent of the viewport refresh rate). Video uses MediaRecorder over the
 * canvas capture stream — realtime, but reliable across browsers and a real, valid
 * file. Interactive export bundles the project + the inlined runtime into one
 * self-contained HTML that boots the same engine, preserving every live behaviour.
 *
 * Seams (documented, not faked): GIF (needs a quantizer); frame-accurate MP4 (needs
 * WebCodecs/ffmpeg.wasm). The per-frame canvas via `renderFrameAt` is the hook for both.
 */
export class Exporter {
  constructor(private engine: Engine) {}

  private get canvas(): HTMLCanvasElement {
    const c = this.engine.canvas;
    if (!c) throw new Error("Engine not mounted — nothing to export");
    return c;
  }

  /** Render a single composition time deterministically and return the output canvas. */
  private renderFrameAt(time: number): HTMLCanvasElement {
    this.engine.transport.pause();
    this.engine.transport.time = time;
    this.engine.renderNow();
    return this.canvas;
  }

  async still(format: StillFormat = "png", quality = 0.95): Promise<Blob> {
    const canvas = this.renderFrameAt(this.engine.transport.time);
    const mime = format === "png" ? "image/png" : "image/jpeg";
    const blob = await canvasToBlob(canvas, mime, quality);
    triggerDownload(blob, `${this.baseName()}_${pad(this.engine.transport.frame)}.${format}`);
    return blob;
  }

  /** The work-area frame range [start, end). */
  private frameRange(): { start: number; end: number; fps: number } {
    const c = this.engine.comp;
    const fps = c.fps;
    const start = Math.round(c.workArea.in * fps);
    const end = Math.max(start + 1, Math.round(Math.min(c.workArea.out, c.duration) * fps));
    return { start, end, fps };
  }

  /** Frame-accurate PNG sequence over the work area — folder via FS Access API, else downloads. */
  async pngSequence(opts?: { onProgress?: (p: ExportProgress) => void; maxFallbackFrames?: number }): Promise<void> {
    const { start, end, fps } = this.frameRange();
    const totalFrames = end - start;
    const max = opts?.maxFallbackFrames ?? 300;

    let dir: FileSystemDirectoryHandle | null = null;
    const picker = (window as any).showDirectoryPicker as (() => Promise<FileSystemDirectoryHandle>) | undefined;
    if (picker) {
      try {
        dir = await picker();
      } catch {
        return;
      }
    } else if (totalFrames > max) {
      throw new Error(
        `This browser lacks the File System Access API; refusing to trigger ${totalFrames} downloads. Use WebM, or a Chromium browser for folder export.`,
      );
    }

    const base = this.baseName();
    for (let i = 0; i < totalFrames; i++) {
      const canvas = this.renderFrameAt((start + i) / fps);
      const blob = await canvasToBlob(canvas, "image/png");
      const name = `${base}_${pad(i)}.png`;
      if (dir) {
        const handle = await dir.getFileHandle(name, { create: true });
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
      } else {
        triggerDownload(blob, name);
      }
      opts?.onProgress?.({ frame: i + 1, totalFrames, fraction: (i + 1) / totalFrames });
      await raf();
    }
  }

  async webm(opts?: { onProgress?: (p: ExportProgress) => void }): Promise<Blob> {
    const mime = pickMime(["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]);
    if (!mime) throw new Error("WebM recording isn't supported in this browser.");
    const blob = await this.recordRealtime(mime, opts?.onProgress);
    triggerDownload(blob, `${this.baseName()}.webm`);
    return blob;
  }

  async mp4(opts?: { onProgress?: (p: ExportProgress) => void }): Promise<Blob> {
    const mime = pickMime(["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1", "video/mp4"]);
    if (!mime) {
      throw new Error(
        "This browser's MediaRecorder can't emit MP4 (Chrome can't; Safari can). Use WebM — it works everywhere — or wire WebCodecs/ffmpeg.wasm for MP4 (feed it Exporter.renderFrameAt's per-frame canvases).",
      );
    }
    const blob = await this.recordRealtime(mime, opts?.onProgress);
    triggerDownload(blob, `${this.baseName()}.mp4`);
    return blob;
  }

  /**
   * Realtime capture of the composition playing once through. Plays from t=0 to
   * `duration`, recording the canvas stream at the composition's fps. Returns a valid
   * video blob. (For frame-exact output regardless of machine speed, swap this for a
   * WebCodecs encoder fed by renderFrameAt — same per-frame source.)
   */
  private async recordRealtime(mime: string, onProgress?: (p: ExportProgress) => void): Promise<Blob> {
    const canvas = this.canvas;
    const c = this.engine.comp;
    const fps = c.fps;
    const inT = c.workArea.in;
    const outT = Math.min(c.workArea.out, c.duration);
    const span = Math.max(0.1, outT - inT);
    const rate = this.engine.transport.rate;
    const stream = (canvas as any).captureStream(fps) as MediaStream;
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const done = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
    });

    this.engine.seek(inT);
    this.engine.play();
    recorder.start(100);

    const totalFrames = Math.round(span * fps);
    const ms = (span / (Math.abs(rate) || 1)) * 1000;
    const startWall = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        const el = performance.now() - startWall;
        onProgress?.({ frame: Math.round((el / 1000) * fps), totalFrames, fraction: Math.min(1, el / ms) });
        if (el >= ms) resolve();
        else setTimeout(tick, 100);
      };
      tick();
    });

    this.engine.pause();
    await new Promise((r) => setTimeout(r, 150)); // let the encoder flush the tail
    recorder.stop();
    return done;
  }

  async gif(): Promise<never> {
    throw new Error(
      "GIF export seam: collect Exporter.pngSequence() frames and feed them to a GIF encoder (gifenc/gif.js). Not bundled in the slice to avoid the dependency — WebM works today.",
    );
  }

  exportProjectJSON(): void {
    const file = serializeProject(this.engine.project);
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    triggerDownload(blob, `${this.baseName()}.marathon.json`);
  }

  /**
   * Self-contained interactive web export. Inlines the prebuilt runtime bundle + the
   * project into a single HTML file that boots the engine, mounts a full-window canvas
   * and plays — preserving expressions, input bindings and the composition clock.
   * Requires `npm run build:runtime` (writes public/marathon-runtime.js).
   */
  async exportInteractiveWeb(runtimeUrl = "/marathon-runtime.js"): Promise<void> {
    let runtimeJs: string;
    try {
      const res = await fetch(runtimeUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      runtimeJs = await res.text();
    } catch {
      throw new Error(
        "Interactive export needs the runtime bundle. Run `npm run build:runtime` (writes public/marathon-runtime.js), then export again.",
      );
    }
    const file = serializeProject(this.engine.project);
    const html = interactiveWebTemplate(JSON.stringify(file), runtimeJs, this.engine.project.name || "Marathon");
    triggerDownload(new Blob([html], { type: "text/html" }), `${this.baseName()}.html`);
  }

  private baseName(): string {
    return (this.engine.project.name || "composition").replace(/[^\w.-]+/g, "_");
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))), mime, quality);
  });
}

function pickMime(candidates: string[]): string | null {
  for (const c of candidates) {
    if (c && typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

function raf(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] as string);
}

function interactiveWebTemplate(projectJson: string, runtimeJs: string, title: string): string {
  const safeRuntime = runtimeJs.replace(/<\/script/gi, "<\\/script");
  const safeJson = projectJson.replace(/</g, "\\u003c"); // safe inside the JSON script tag
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#stage{width:100vw;height:100vh}</style>
</head>
<body>
<div id="stage"></div>
<div id="offscreen-host" style="position:fixed;left:-99999px;top:0;width:0;height:0;overflow:hidden"></div>
<script>${safeRuntime}</script>
<script id="marathon-project" type="application/json">${safeJson}</script>
<script>
(function () {
  var project = JSON.parse(document.getElementById("marathon-project").textContent);
  window.MarathonRuntime.createRuntime({
    mount: document.getElementById("stage"),
    offscreenHost: document.getElementById("offscreen-host"),
    project: project,
    autoplay: true,
    interactive: true,
  });
})();
</script>
</body>
</html>`;
}
