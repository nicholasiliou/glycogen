import type { LayerTypeDefinition } from "../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../engine/render/types";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}

class PixelSortRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;

  resize(w: number, h: number): void {
    this.canvas.width = w;
    this.canvas.height = h;
  }

  render(frame: RenderFrame): HTMLCanvasElement | null {
    const bd = frame.backdrop;
    if (!bd) return null;
    const { width: w, height: h } = frame;
    const p = frame.props;
    const threshold = num(p.threshold, 0.25);
    const horizontal = p.direction === "horizontal";
    const reverse = !!p.reverse;

    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.drawImage(bd, 0, 0, w, h);
    const img = this.ctx.getImageData(0, 0, w, h);
    const d = img.data;

    const lum = (r: number, g: number, b: number) =>
      (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    if (horizontal) {
      for (let y = 0; y < h; y++) {
        const row = y * w;
        let start = -1;
        for (let x = 0; x <= w; x++) {
          const i = (row + x) * 4;
          const bright = x < w ? lum(d[i], d[i + 1], d[i + 2]) > threshold : false;
          if (bright && start === -1) { start = x; }
          else if (!bright && start !== -1) {
            const segment: [number, number, number, number][] = [];
            for (let sx = start; sx < x; sx++) {
              const si = (row + sx) * 4;
              segment.push([d[si], d[si + 1], d[si + 2], d[si + 3]]);
            }
            segment.sort((a, b) => lum(a[0], a[1], a[2]) - lum(b[0], b[1], b[2]));
            if (reverse) segment.reverse();
            for (let sx = start; sx < x; sx++) {
              const si = (row + sx) * 4;
              [d[si], d[si + 1], d[si + 2], d[si + 3]] = segment[sx - start];
            }
            start = -1;
          }
        }
      }
    } else {
      for (let x = 0; x < w; x++) {
        let start = -1;
        for (let y = 0; y <= h; y++) {
          const i = (y * w + x) * 4;
          const bright = y < h ? lum(d[i], d[i + 1], d[i + 2]) > threshold : false;
          if (bright && start === -1) { start = y; }
          else if (!bright && start !== -1) {
            const segment: [number, number, number, number][] = [];
            for (let sy = start; sy < y; sy++) {
              const si = (sy * w + x) * 4;
              segment.push([d[si], d[si + 1], d[si + 2], d[si + 3]]);
            }
            segment.sort((a, b) => lum(a[0], a[1], a[2]) - lum(b[0], b[1], b[2]));
            if (reverse) segment.reverse();
            for (let sy = start; sy < y; sy++) {
              const si = (sy * w + x) * 4;
              [d[si], d[si + 1], d[si + 2], d[si + 3]] = segment[sy - start];
            }
            start = -1;
          }
        }
      }
    }

    this.ctx.putImageData(img, 0, 0);
    return this.canvas;
  }

  dispose(): void {}
}

export const pixelSortLayerType: LayerTypeDefinition = {
  type: "fx.pixelSort",
  label: "Pixel Sort",
  category: "Effects",
  icon: "AlignVerticalDistributeCenter",
  kind: "effect",
  description: "Sorts pixels within bright spans along rows or columns.",
  schema: [
    { key: "threshold", name: "Threshold", type: "number", default: 0.25, group: "Pixel Sort", meta: { min: 0, max: 1, step: 0.01 } },
    {
      key: "direction", name: "Direction", type: "select", default: "vertical", group: "Pixel Sort",
      meta: { options: [{ value: "vertical", label: "Vertical" }, { value: "horizontal", label: "Horizontal" }] },
    },
    { key: "reverse", name: "Reverse", type: "boolean", default: false, group: "Pixel Sort" },
  ],
  createRenderer: () => new PixelSortRenderer(),
};
