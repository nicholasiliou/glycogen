import type { Stage } from "@/runtime/Stage";
import { SCENE_PNG_KEYWORD, serializeScene } from "@/runtime/scene";
import { resolveAspectRatio } from "./exporters/aspectRatios";
import { masksFor } from "./exporters/masks";
import { loadMaskImage, type ExportFrameOptions } from "./exporters/frameCanvas";
import { exportStill } from "./exporters/stillExporter";
import { exportVideo } from "./exporters/videoExporter";
import { type ExportProgress, type ExportSettings, type StillFormat } from "./exporters/types";

export type { StillFormat, ExportProgress, ExportSettings } from "./exporters/types";

/**
 * Lean export pipeline for the live runtime: a still (PNG/JPEG) or a WebM video, each reframed to a
 * chosen aspect ratio with an optional alpha mask baked in. The instrument plays forever: a still
 * snapshots the current live frame and a video records the next N seconds — neither interrupts the
 * Stage's render loop. The aspect ratio is applied at export time (cover-crop); the Stage keeps its
 * own size.
 */
export class Exporter {
  private frameCounter = 0;
  private abortController: AbortController | null = null;

  constructor(private stage: Stage) {}

  cancel() {
    this.abortController?.abort();
    this.abortController = null;
  }

  private get canvas(): HTMLCanvasElement {
    return this.stage.canvas;
  }

  /** Build the reframe + mask options for the chosen export settings (loads the SVG mask). */
  private async frameOptions(settings: ExportSettings): Promise<ExportFrameOptions> {
    const ratio = resolveAspectRatio(settings.aspectRatio, { width: settings.width, height: settings.height });
    // Override with exact user-specified pixel dimensions.
    const sized = { ...ratio, width: settings.width, height: settings.height };
    let mask = null;
    if (settings.maskEnabled) {
      const variants = masksFor(settings.aspectRatio);
      const variant = variants[settings.maskVariant ?? 0] ?? variants[0];
      if (variant) mask = await loadMaskImage(variant);
    }
    return { ratio: sized, mask };
  }

  /** Snapshot the current live frame as a still image (does not pause the runtime). */
  async still(settings: ExportSettings, format: StillFormat = "png", quality = 0.95): Promise<Blob> {
    const frame = await this.frameOptions(settings);
    this.stage.lockRenderSize(settings.width, settings.height);
    try {
      this.stage.tick();
      return await exportStill({
        source: this.canvas,
        frame,
        format,
        quality,
        baseName: "glycogen",
        frameNumber: this.frameCounter++,
        meta: { keyword: SCENE_PNG_KEYWORD, text: JSON.stringify(serializeScene(this.stage)) },
      });
    } finally {
      this.stage.unlockRenderSize();
    }
  }

  /** Record the next `videoDurationSec` seconds of live playback as a WebM video, reframed + masked. */
  async video(settings: ExportSettings, opts?: { onProgress?: (p: ExportProgress) => void }): Promise<Blob> {
    const frame = await this.frameOptions(settings);
    this.abortController = new AbortController();
    this.stage.lockRenderSize(settings.width, settings.height);
    try {
      return await exportVideo({
        source: this.canvas,
        frame,
        fps: settings.fps,
        format: settings.videoFormat,
        durationSec: settings.videoDurationSec ?? 10,
        baseName: "glycogen",
        onProgress: opts?.onProgress,
        signal: this.abortController.signal,
      });
    } finally {
      this.abortController = null;
      this.stage.unlockRenderSize();
    }
  }
}
