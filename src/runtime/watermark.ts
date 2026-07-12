import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { asset } from "@/lib/asset";

export const SITE_URL = "https://nicholasiliou.github.io/glycogen";
export const REPO_URL = "https://github.com/nicholasiliou/glycogen";

export const WATERMARK_SIZE = 64;
export const WATERMARK_PAD = 16;

const BUILD_SIZE = WATERMARK_SIZE * 4;

let built: HTMLCanvasElement | null = null;
let builtBarcode: HTMLCanvasElement | null = null;
let started = false;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

/** The 7-module finder pattern sits in the top-left, top-right and bottom-left corners. */
function isFinderModule(col: number, row: number, size: number): boolean {
  return (col < 8 && row < 8) || (col >= size - 8 && row < 8) || (col < 8 && row >= size - 8);
}

async function build(): Promise<void> {
  // Level-H gives ~30% damage tolerance — that headroom covers the logo in the center.
  const qr = QRCode.create(SITE_URL, { errorCorrectionLevel: "H" });
  const { size, data } = qr.modules;

  const c = document.createElement("canvas");
  c.width = BUILD_SIZE;
  c.height = BUILD_SIZE;
  const ctx = c.getContext("2d")!;

  const margin = 1; // modules of quiet zone
  const cellSize = BUILD_SIZE / (size + margin * 2);
  const offset = margin * cellSize;

  // ── data dots: circles, white on transparent ─────────────────────────────
  const r = cellSize * 0.42;
  ctx.fillStyle = "#ffffff";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!data[row * size + col]) continue;
      if (isFinderModule(col, row, size)) continue;
      const cx = offset + col * cellSize + cellSize / 2;
      const cy = offset + row * cellSize + cellSize / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── finder patterns: concentric rings instead of squares ─────────────────
  const finderCenters = [
    { cx: offset + 3.5 * cellSize, cy: offset + 3.5 * cellSize },
    { cx: offset + (size - 3.5) * cellSize, cy: offset + 3.5 * cellSize },
    { cx: offset + 3.5 * cellSize, cy: offset + (size - 3.5) * cellSize },
  ];

  for (const { cx, cy } of finderCenters) {
    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, cellSize * 3.5, 0, Math.PI * 2);
    ctx.arc(cx, cy, cellSize * 2.9, 0, Math.PI * 2, true);
    ctx.fill();
    // Inner dot
    ctx.beginPath();
    ctx.arc(cx, cy, cellSize * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── logo plate: circle with logo inside ──────────────────────────────────
  const logo = await loadImage(asset("/glycogen.svg"));
  const plateR = cellSize * 3.2;
  const plateCx = BUILD_SIZE / 2;
  const plateCy = BUILD_SIZE / 2;

  // Erase data dots under the plate (destination-out punch)
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(plateCx, plateCy, plateR + cellSize * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  // Dark circle
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.arc(plateCx, plateCy, plateR, 0, Math.PI * 2);
  ctx.fill();

  // Logo (white SVG) fitted inside
  const fit = plateR * 1.1;
  const scale = Math.min(fit / logo.width, fit / logo.height);
  const lw = logo.width * scale;
  const lh = logo.height * scale;
  ctx.drawImage(logo, plateCx - lw / 2, plateCy - lh / 2, lw, lh);

  built = c;
  builtBarcode = buildBarcode();
}

/** Code 128 barcode for the repo, white bars on transparent to match the QR. */
function buildBarcode(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  JsBarcode(c, REPO_URL, {
    format: "CODE128",
    width: 2,
    height: BUILD_SIZE,
    margin: 0,
    displayValue: false,
    lineColor: "#ffffff",
    background: "rgba(0,0,0,0)",
  });
  return c;
}

export function getWatermark(): HTMLCanvasElement | null {
  if (!started) {
    started = true;
    build().catch(() => {});
  }
  return built;
}

export function getBarcode(): HTMLCanvasElement | null {
  getWatermark();
  return builtBarcode;
}

/**
 * Returns the bounding box of the entire watermark strip (QR + barcode) in canvas coordinates,
 * matching the geometry used when drawing in Stage. Returns null if the barcode isn't built yet
 * (call after getWatermark() has resolved).
 */
export function watermarkHitRect(canvasW: number, canvasH: number): { x: number; y: number; w: number; h: number } | null {
  if (!builtBarcode) return null;
  const cornerPad = Math.ceil((72 / 1920) * canvasW) + WATERMARK_PAD;
  const bcW = WATERMARK_SIZE * (builtBarcode.width / builtBarcode.height);
  const totalW = WATERMARK_SIZE + WATERMARK_PAD + bcW;
  return {
    x: cornerPad,
    y: canvasH - WATERMARK_SIZE - cornerPad,
    w: totalW,
    h: WATERMARK_SIZE,
  };
}
