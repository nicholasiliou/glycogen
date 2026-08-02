import { Plugin, type FieldFn, type Frame } from "./Plugin";
import { sampleGrid } from "./_shared/textField";
import { asset } from "@/lib/asset";

export const AVAILABLE_FONTS = ["Maratype", "NuCore", "Sekgen", "UESC", "BitcountPropSingle", "HinaMincho", "SpaceMono"] as const;

const FONT_FILES: Record<string, { file: string; format: string }> = {
  Maratype:          { file: "Maratype.otf",          format: "opentype" },
  NuCore:            { file: "NuCore.otf",             format: "opentype" },
  Sekgen:            { file: "Sekgen.otf",             format: "opentype" },
  UESC:              { file: "UESC.otf",               format: "opentype" },
  BitcountPropSingle: { file: "BitcountPropSingle.ttf", format: "truetype" },
  HinaMincho:        { file: "HinaMincho.ttf",         format: "truetype" },
  SpaceMono:         { file: "SpaceMono.ttf",          format: "truetype" },
};

export const TEXT_PRESETS = [
  "Glycogen", "Pathfinder", "Epsilon Krios IV", "ISC Wayfarer", "North Meridian", "Frost Repository",
  "Boundary Zone", "Black Fen", "Forward Station", "Synaptic Forge", "Vital Harvest", "Iron Meridian", "VANTA Collective",
  "Silk Covenant", "Kisaragi Bioworks", "Assignment", "Extraction", "Frame", "Settlement", "Settlement Ark",
] as const;

// Load every custom font and block on all of them so ctx.font can pick any of the four.
// No-ops where the Font Loading API is absent (e.g. jsdom under tests).
const fontsReady: Promise<void> =
  typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts
    ? Promise.resolve()
    : Promise.all(
        AVAILABLE_FONTS.map((name) => {
          const { file, format } = FONT_FILES[name];
          const face = new FontFace(name, `url('${asset(`/fonts/${file}`)}') format('${format}')`, { weight: "400" });
          return face.load().then((loaded) => { document.fonts.add(loaded); }).catch(() => {});
        }),
      ).then(() => {});

const GRID_MAX = 256;

/** Renders a line of text centred in the frame. Cycle the preset/font with the pads. */
export class TextLayer extends Plugin {
  preset = this.cycle(TEXT_PRESETS);
  font = this.cycle(AVAILABLE_FONTS);
  outline = this.toggle();
  fontSize = this.number({ min: 20, max: 400, default: 120 });
  tracking = this.number({ min: -20, max: 40, default: 0 });
  x = this.number({ min: -960, max: 960, default: 0 });
  y = this.number({ min: -540, max: 540, default: 0 });

  /**
   * Freeform override for the preset list, typed in the controls panel. Deliberately a plain field
   * and not a param: it never reaches the db, a scene snapshot, a QR or an exported PNG, so it
   * lives exactly as long as this instance does and a reload/reset comes back to the presets.
   */
  customText = "";

  private ctx = this.canvas.getContext("2d")!;
  private gridCache: { key: string; data: Float32Array; gw: number; gh: number } | null = null;

  constructor() {
    super();
    fontsReady.catch(() => {});
  }

  /** What actually gets drawn: the freeform text if there is any, else the selected preset. */
  private get text(): string {
    return this.customText.trim() ? this.customText : this.preset.pick(TEXT_PRESETS as readonly string[]);
  }

  render(_f: Frame): HTMLCanvasElement {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const text = this.text;
    const size = this.fontSize.value;
    const outline = this.outline.on;
    const family = this.font.pick(AVAILABLE_FONTS as readonly string[]);
    ctx.font = `400 ${size}px ${family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${this.tracking.value}px`;

    const lines = text.split("\n");
    const lh = size * 1.2;
    const halfH = (lines.length * lh) / 2;
    // Clamp horizontally by the real text width (widest line), not halfH  -  text is far wider than
    // tall, so clamping x by the vertical extent still lets a big offset slide it off the sides.
    const halfW = Math.min(w / 2, maxLineWidth(ctx, lines) / 2);
    const cx = Math.max(halfW, Math.min(w - halfW, w / 2 + this.x.value));
    const cy = Math.max(halfH, Math.min(h - halfH, h / 2 + this.y.value));
    const startY = cy - ((lines.length - 1) * lh) / 2;
    if (outline) {
      ctx.strokeStyle = "rgba(255,255,255,1)";
      ctx.lineWidth = 1;
      lines.forEach((line, i) => ctx.strokeText(line, cx, startY + i * lh));
    } else {
      ctx.fillStyle = "rgba(255,255,255,1)";
      lines.forEach((line, i) => ctx.fillText(line, cx, startY + i * lh));
    }

    // Invalidate grid cache when text params change.
    const key = [text, size, outline, family, this.tracking.value, this.x.value, this.y.value, w, h].join("|");
    if (this.gridCache?.key !== key) this.gridCache = null;

    return this.canvas;
  }

  exportField(): FieldFn {
    const text = this.text;
    const w = this.canvas.width || 1920, h = this.canvas.height || 1080;
    const size = this.fontSize.value;
    const outline = this.outline.on;
    const family = this.font.pick(AVAILABLE_FONTS as readonly string[]);
    const dx = this.x.value, dy = this.y.value;
    const key = [text, size, outline, family, this.tracking.value, dx, dy, w, h].join("|");

    if (!this.gridCache || this.gridCache.key !== key) {
      this.gridCache = rasterGrid(text, size, outline, family, this.tracking.value, dx, dy, w, h, key);
    }
    const { data, gw, gh } = this.gridCache;
    const fn: FieldFn = (x, y) => sampleGrid(data, gw, gh, x, y);
    fn.key = key; // content identity, so sims rebuild their mask only when the text changes
    return fn;
  }
}

function rasterGrid(
  text: string, size: number, outline: boolean, family: string,
  tracking: number, dx: number, dy: number, w: number, h: number, key: string,
): { key: string; data: Float32Array; gw: number; gh: number } {
  const scale = GRID_MAX / Math.max(1, Math.max(w, h));
  const gw = Math.max(1, Math.round(w * scale));
  const gh = Math.max(1, Math.round(h * scale));
  const data = new Float32Array(gw * gh);
  const c = document.createElement("canvas");
  c.width = gw; c.height = gh;
  const ctx = c.getContext("2d");
  if (!ctx || !text) return { key, data, gw, gh };
  const s = size * scale;
  ctx.font = `400 ${s}px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${tracking * scale}px`;
  const lines = text.split("\n");
  const lh = s * 1.2;
  const halfH = (lines.length * lh) / 2;
  const halfW = Math.min(gw / 2, maxLineWidth(ctx, lines) / 2);
  const cx = Math.max(halfW, Math.min(gw - halfW, gw / 2 + dx * scale));
  const cy = Math.max(halfH, Math.min(gh - halfH, gh / 2 + dy * scale));
  const startY = cy - ((lines.length - 1) * lh) / 2;
  if (outline) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(1, s * 0.04);
    lines.forEach((line, i) => ctx.strokeText(line, cx, startY + i * lh));
  } else {
    ctx.fillStyle = "#fff";
    lines.forEach((line, i) => ctx.fillText(line, cx, startY + i * lh));
  }
  const img = ctx.getImageData(0, 0, gw, gh).data;
  for (let i = 0; i < gw * gh; i++) data[i] = img[i * 4 + 3] / 255;
  return { key, data, gw, gh };
}

/** Widest measured line in the ctx's current font, so callers can clamp the text on-screen. */
function maxLineWidth(ctx: CanvasRenderingContext2D, lines: readonly string[]): number {
  let max = 0;
  for (const line of lines) max = Math.max(max, ctx.measureText(line).width);
  return max;
}
