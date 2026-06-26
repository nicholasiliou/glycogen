import type { Engine } from "../Engine";
import { resolveAspectRatio } from "./exporters/aspectRatios";
import { masksFor } from "./exporters/masks";
import { loadMaskImage, type ExportFrameOptions } from "./exporters/frameCanvas";
import { exportStill } from "./exporters/stillExporter";
import { exportVideo } from "./exporters/videoExporter";
import type { ExportProgress, ExportSettings, StillFormat } from "./exporters/types";

export type { StillFormat, ExportProgress, ExportSettings } from "./exporters/types";

/**
 * Lean export pipeline: a still (PNG/JPEG) or a WebM video, each reframed to a chosen aspect ratio
 * with an optional alpha mask baked in. Built for the live instrument, which plays forever: a still
 * snapshots the current live frame and a video records the next N seconds — neither touches the
 * transport, so playback is never interrupted. The aspect ratio is applied at export time
 * (cover-crop); the composition keeps its own size.
 */
export class Exporter {
  constructor(private engine: Engine) {}

  private get canvas(): HTMLCanvasElement {
    const c = this.engine.canvas;
    if (!c) throw new Error("Engine not mounted — nothing to export");
    return c;
  }

  /** Build the reframe + mask options for the chosen export settings (loads the SVG mask). */
  private async frameOptions(settings: ExportSettings): Promise<ExportFrameOptions> {
    const ratio = resolveAspectRatio(settings.aspectRatio, settings.custom);
    let mask = null;
    if (settings.maskEnabled) {
      const variants = masksFor(settings.aspectRatio);
      const variant = variants[settings.maskVariant ?? 0] ?? variants[0];
      if (variant) mask = await loadMaskImage(variant);
    }
    return { ratio, mask };
  }

  /** Snapshot the current live frame as a still image (does not pause playback). */
  async still(settings: ExportSettings, format: StillFormat = "png", quality = 0.95): Promise<Blob> {
    // Force one fresh render so the snapshot is current, without touching the transport.
    this.engine.renderNow();
    const frame = await this.frameOptions(settings);
    return exportStill({
      source: this.canvas,
      frame,
      format,
      quality,
      baseName: this.baseName(),
      frameNumber: this.engine.transport.frame,
    });
  }

  /** Record the next `videoDurationSec` seconds of live playback as a WebM video, reframed + masked. */
  async video(settings: ExportSettings, opts?: { onProgress?: (p: ExportProgress) => void }): Promise<Blob> {
    const frame = await this.frameOptions(settings);
    return exportVideo({
      source: this.canvas,
      frame,
      fps: this.engine.comp.fps,
      durationSec: settings.videoDurationSec ?? 10,
      baseName: this.baseName(),
      onProgress: opts?.onProgress,
    });
  }

  private baseName(): string {
    return (this.engine.project.name || "composition").replace(/[^\w.-]+/g, "_");
  }
}
