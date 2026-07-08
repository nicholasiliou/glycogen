import { Plugin, type Frame } from "@/plugins/Plugin";
import { COLOR_PRESETS, presetIndexOf } from "@/plugins/colors";

/**
 * Recolors a layer to one of the shared {@link COLOR_PRESETS} (the replacement for the old global
 * hue knob). The `preset` cycle steps through the palette; on attach it adopts the host plugin's
 * factory default color, so loading it onto a layer starts from the look the layer already has.
 * Pure 2D: the input's luminance is multiplied into the preset color, alpha preserved.
 */
export class ColorLayer extends Plugin {
  preset = this.cycle(COLOR_PRESETS.map((c) => c.name));

  override onAttach(host: Plugin): void {
    const target = presetIndexOf(host.color);
    if (target < 0) return;
    const at = this.preset.count % COLOR_PRESETS.length;
    const steps = (target - at + COLOR_PRESETS.length) % COLOR_PRESETS.length;
    if (steps > 0) this.preset.press(steps);
  }

  render(f: Frame): HTMLCanvasElement | null {
    const src = f.input;
    if (!src || src.width === 0 || src.height === 0) return null;
    const { width: w, height: h } = src;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.canvas.getContext("2d")!;
    const { hex } = COLOR_PRESETS[this.preset.count % COLOR_PRESETS.length];

    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, w, h);
    // luminance × preset color: white → the color, black stays black…
    ctx.filter = "grayscale(1)";
    ctx.drawImage(src, 0, 0);
    ctx.filter = "none";
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, w, h);
    // …and the source's own alpha clips the fill back out of transparent regions.
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(src, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    return this.canvas;
  }
}
