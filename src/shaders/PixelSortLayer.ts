import { Plugin, type Frame } from "@/plugins/Plugin";

/** CPU pixel sort  -  brightens runs above a threshold and sorts them by luminance. */
export class PixelSortLayer extends Plugin {
  threshold = this.number({ min: 0, max: 1, default: 0.25 });
  horizontal = this.toggle();
  reverse = this.toggle();

  private ctx = this.canvas.getContext("2d")!;

  render(f: Frame): HTMLCanvasElement | null {
    const bd = f.input;
    if (!bd) return null;
    const w = f.width, h = f.height;
    const threshold = this.threshold.value;
    const horizontal = this.horizontal.on;
    const reverse = this.reverse.on;

    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.drawImage(bd, 0, 0, w, h);
    const img = this.ctx.getImageData(0, 0, w, h);
    const d = img.data;

    const lum = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

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
}
