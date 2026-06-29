import { Plugin, type FieldFn, type Frame } from "./Plugin";
import { sampleGrid } from "./_shared/textField";

export const AVAILABLE_FONTS = ["Maratype", "NuCore", "Sekgen", "UESC"] as const;

export const TEXT_PRESETS = [
  "Marathon", "Runner", "Tau Ceti IV", "UESC Marathon", "New Cascadia", "Cryo Archive",
  "Perimeter", "Dire Marsh", "Outpost", "CyberAcme", "NuCaloric", "Traxus", "MIDA",
  "Arachne", "Sekiguchi Genetics", "Contract", "Exfil", "Shell", "Colony", "Colony Ship",
] as const;

// Load every custom font and block on all of them so ctx.font can pick any of the four.
// No-ops where the Font Loading API is absent (e.g. jsdom under tests).
const fontsReady: Promise<void> =
  typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts
    ? Promise.resolve()
    : Promise.all(
        AVAILABLE_FONTS.map((name) => {
          const face = new FontFace(name, `url('/fonts/${name}.otf') format('opentype')`, { weight: "400" });
          return face.load().then((loaded) => { document.fonts.add(loaded); }).catch(() => {});
        }),
      ).then(() => {});

const GRID_MAX = 256;

/** Renders a line of text centred in the frame. Cycle the preset/font with the pads. */
export class TextLayer extends Plugin {
  preset = this.pad(4); // cycles TEXT_PRESETS
  font = this.pad(5); // cycles AVAILABLE_FONTS
  bold = this.pad(6);
  fontSize = this.knob(0, { min: 20, max: 400, default: 120 });
  tracking = this.knob(1, { min: -20, max: 40, default: 0 });

  private ctx = this.canvas.getContext("2d")!;
  private gridCache: { key: string; data: Float32Array; gw: number; gh: number } | null = null;

  constructor() {
    super();
    fontsReady.catch(() => {});
  }

  render(_f: Frame): HTMLCanvasElement {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const text = this.preset.pick(TEXT_PRESETS as readonly string[]);
    const size = this.fontSize.value;
    const weight = this.bold.on ? "700" : "400";
    const family = this.font.pick(AVAILABLE_FONTS as readonly string[]);
    ctx.fillStyle = "rgba(255,255,255,1)";
    ctx.font = `${weight} ${size}px ${family}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${this.tracking.value}px`;

    const lines = text.split("\n");
    const lh = size * 1.2;
    const startY = h / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((line, i) => ctx.fillText(line, w / 2, startY + i * lh));

    // Invalidate grid cache when text params change.
    const key = [text, size, weight, family, this.tracking.value, w, h].join("|");
    if (this.gridCache?.key !== key) this.gridCache = null;

    return this.canvas;
  }

  exportField(): FieldFn {
    const text = this.preset.pick(TEXT_PRESETS as readonly string[]);
    const w = this.canvas.width || 1920, h = this.canvas.height || 1080;
    const size = this.fontSize.value;
    const weight = this.bold.on ? "700" : "400";
    const family = this.font.pick(AVAILABLE_FONTS as readonly string[]);
    const key = [text, size, weight, family, this.tracking.value, w, h].join("|");

    if (!this.gridCache || this.gridCache.key !== key) {
      this.gridCache = rasterGrid(text, size, weight, family, this.tracking.value, w, h, key);
    }
    const { data, gw, gh } = this.gridCache;
    const fn: FieldFn = (x, y) => sampleGrid(data, gw, gh, x, y);
    fn.key = key; // content identity, so sims rebuild their mask only when the text changes
    return fn;
  }
}

function rasterGrid(
  text: string, size: number, weight: string, family: string,
  tracking: number, w: number, h: number, key: string,
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
  ctx.fillStyle = "#fff";
  ctx.font = `${weight} ${s}px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${tracking * scale}px`;
  const lines = text.split("\n");
  const lh = s * 1.2;
  const startY = gh / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((line, i) => ctx.fillText(line, gw / 2, startY + i * lh));
  const img = ctx.getImageData(0, 0, gw, gh).data;
  for (let i = 0; i < gw * gh; i++) data[i] = img[i * 4 + 3] / 255;
  return { key, data, gw, gh };
}
