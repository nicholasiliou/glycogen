import type { Stage } from "@/runtime/Stage";
import { SCENE_PNG_KEYWORD, serializeScene } from "@/runtime/scene";
import { resolveAspectRatio } from "./exporters/aspectRatios";
import { masksFor } from "./exporters/masks";
import { loadMaskImage, type ExportFrameOptions } from "./exporters/frameCanvas";
import { exportStill } from "./exporters/stillExporter";
import { exportVideo } from "./exporters/videoExporter";
import type { ExportProgress, ExportSettings, StillFormat } from "./exporters/types";

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

  constructor(private stage: Stage) {}

  private get canvas(): HTMLCanvasElement {
    return this.stage.canvas;
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

  /** Snapshot the current live frame as a still image (does not pause the runtime). */
  async still(settings: ExportSettings, format: StillFormat = "png", quality = 0.95): Promise<Blob> {
    // Force one fresh render so the snapshot is current.
    this.stage.tick();
    const frame = await this.frameOptions(settings);
    return exportStill({
      source: this.canvas,
      frame,
      format,
      quality,
      baseName: "glycogen",
      frameNumber: this.frameCounter++,
      // A PNG carries the scene that rendered it — drop it back on the stage to keep editing.
      meta: { keyword: SCENE_PNG_KEYWORD, text: JSON.stringify(serializeScene(this.stage)) },
    });
  }

  /** Record the next `videoDurationSec` seconds of live playback as a WebM video, reframed + masked. */
  async video(settings: ExportSettings, opts?: { onProgress?: (p: ExportProgress) => void }): Promise<Blob> {
    const frame = await this.frameOptions(settings);
    return exportVideo({
      source: this.canvas,
      frame,
      quality: settings.videoQuality,
      format: settings.videoFormat,
      durationSec: settings.videoDurationSec ?? 10,
      baseName: "glycogen",
      onProgress: opts?.onProgress,
    });
  }
}
