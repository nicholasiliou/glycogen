import type { AspectRatio } from "./aspectRatios";
import type { MaskVariant } from "./masks";
import { MASK_COUNTS } from "./masks";

/**
 * Turns the engine's rendered frame into an export-ready canvas at a chosen aspect ratio, with an
 * optional alpha mask cut into it. The source is cover-fitted (centered crop) into the target so
 * no bars appear; the mask (a white-on-transparent SVG) keeps only its white region.
 *
 * For video, the same target canvas is reused across frames — call `drawInto` each frame rather
 * than allocating a new canvas (see videoExporter).
 */
export interface ExportFrameOptions {
  ratio: AspectRatio;
  /** When set, the mask image is alpha-composited so only its white area survives. */
  mask?: HTMLImageElement | null;
  /** Background for the area outside an alpha mask (PNG keeps transparent; video wants black). */
  background?: string;
}

/** Load an SVG mask as an HTMLImageElement, sized later when drawn. */
export function loadMaskImage(variant: MaskVariant): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const maskUrl = variant.url;
    // If the URL points to a folder, pick a random numbered mask from it
    const url = maskUrl.endsWith(".svg") ? maskUrl : pickRandomMaskFromFolder(maskUrl);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load mask: ${url}`));
    img.src = url;
  });
}

/** Pick a random numbered mask from a folder using the static count. */
function pickRandomMaskFromFolder(folderPath: string): string {
  // Extract aspect ratio from folder path (e.g., "/masks/16x9" -> "16:9")
  const parts = folderPath.split("/");
  const folderName = parts[parts.length - 1];
  const ratioMap: Record<string, "16:9" | "9:16" | "1:1" | "4:5"> = {
    "16x9": "16:9",
    "9x16": "9:16",
    "1x1": "1:1",
    "4x5": "4:5",
  };
  const ratio = ratioMap[folderName] || "1:1";
  const count = MASK_COUNTS[ratio];
  const index = Math.floor(Math.random() * count) + 1;
  return `${folderPath}/${index}.svg`;
}

/** Cover-fit source rect (sx,sy,sw,sh) for drawing `src` into a target of (tw,th). */
function coverRect(srcW: number, srcH: number, tw: number, th: number) {
  const scale = Math.max(tw / srcW, th / srcH);
  const sw = tw / scale;
  const sh = th / scale;
  const sx = (srcW - sw) / 2;
  const sy = (srcH - sh) / 2;
  return { sx, sy, sw, sh };
}

/** Draw the source frame into `target` at the ratio's size, applying the optional alpha mask. */
export function drawFrameInto(target: HTMLCanvasElement, src: CanvasImageSource, srcW: number, srcH: number, opts: ExportFrameOptions): void {
  const { ratio, mask, background } = opts;
  if (target.width !== ratio.width) target.width = ratio.width;
  if (target.height !== ratio.height) target.height = ratio.height;
  const ctx = target.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D context for export frame");

  ctx.clearRect(0, 0, ratio.width, ratio.height);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, ratio.width, ratio.height);
  }

  const { sx, sy, sw, sh } = coverRect(srcW, srcH, ratio.width, ratio.height);
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, ratio.width, ratio.height);

  if (mask) {
    // Keep only the mask's white area: destination-in uses the mask alpha as the cut-out.
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0, ratio.width, ratio.height);
    ctx.globalCompositeOperation = "source-over";
    // Video has no alpha — paint the cut region with the background so it reads as a clean edge.
    if (background) {
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, ratio.width, ratio.height);
      ctx.globalCompositeOperation = "source-over";
    }
  }
}

/** One-shot: allocate a target canvas and draw a single frame into it. */
export function makeFrameCanvas(src: CanvasImageSource, srcW: number, srcH: number, opts: ExportFrameOptions): HTMLCanvasElement {
  const target = document.createElement("canvas");
  drawFrameInto(target, src, srcW, srcH, opts);
  return target;
}
