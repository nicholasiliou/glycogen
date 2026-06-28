import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function arr(v: unknown, f: number[]): number[] {
  return Array.isArray(v) ? (v as number[]) : f;
}

const NBANDS = 12; // height-colour buckets for batched wireframe drawing

interface Mesh {
  positions: Float32Array; // unique verts, normalised to [-1,1], xyz interleaved
  heights: Float32Array;   // 0..1 normalised height per vertex (for the gradient)
  tris: Uint32Array;       // 3 vertex indices per triangle
  bandEdges: Uint32Array[]; // per height-band, flattened unique edge pairs [a,b,a,b,…]
  flatTris: number[] | null; // lazily built flat array for meshSource (Slicer)
}

/**
 * Parse Wavefront OBJ into *indexed* geometry. OBJ is already index-based (faces
 * reference shared `v` entries), so we keep it that way instead of expanding to a flat
 * triangle soup — that's the single biggest win, since each unique vertex is then
 * projected once per frame rather than ~6× (once per triangle that shares it).
 *
 * We also pre-compute deduplicated edges bucketed by height. A closed mesh has far fewer
 * unique edges than triangle×3, and bucketing lets the whole wireframe draw in NBANDS
 * stroke() calls (one per colour band) instead of one per edge.
 */
function parseOBJIndexed(text: string): Mesh | null {
  const px: number[] = [];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const triList: number[] = [];

  const lines = text.split("\n");
  for (const line of lines) {
    if (line.length < 2) continue;
    const c0 = line.charCodeAt(0);
    if (c0 === 118 /* v */ && (line[1] === " " || line[1] === "\t")) {
      const p = line.split(/\s+/);
      const x = parseFloat(p[1]), y = parseFloat(p[2]), z = parseFloat(p[3]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        px.push(x, y, z);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    } else if (c0 === 102 /* f */ && (line[1] === " " || line[1] === "\t")) {
      const p = line.trim().split(/\s+/);
      const idx: number[] = [];
      const vcount = px.length / 3;
      for (let i = 1; i < p.length; i++) {
        const tok = p[i];
        if (!tok) continue;
        const slash = tok.indexOf("/");
        const raw = slash === -1 ? tok : tok.slice(0, slash);
        let vi = parseInt(raw, 10);
        if (!Number.isFinite(vi)) continue;
        if (vi < 0) vi = vcount + vi; else vi -= 1;
        idx.push(vi);
      }
      for (let i = 1; i + 1 < idx.length; i++) {
        const a = idx[0], b = idx[i], c = idx[i + 1];
        if (a < 0 || b < 0 || c < 0) continue;
        triList.push(a, b, c);
      }
    }
  }

  const nverts = px.length / 3;
  if (nverts === 0 || triList.length === 0) return null;

  // normalise positions → centre on origin, longest axis to [-1,1]
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const inv = 2 / ext;
  const positions = new Float32Array(px.length);
  const heights = new Float32Array(nverts);
  for (let i = 0, v = 0; i < px.length; i += 3, v++) {
    const ny = (px[i + 1] - cy) * inv;
    positions[i] = (px[i] - cx) * inv;
    positions[i + 1] = ny;
    positions[i + 2] = (px[i + 2] - cz) * inv;
    heights[v] = (ny + 1) * 0.5; // [-1,1] → [0,1]
  }

  const tris = new Uint32Array(triList);

  // deduplicate edges and bucket by average endpoint height
  const seen = new Set<number>();
  const bands: number[][] = Array.from({ length: NBANDS }, () => []);
  for (let t = 0; t < tris.length; t += 3) {
    const v0 = tris[t], v1 = tris[t + 1], v2 = tris[t + 2];
    const e = [v0, v1, v1, v2, v2, v0];
    for (let k = 0; k < 6; k += 2) {
      let a = e[k], b = e[k + 1];
      if (a > b) { const tmp = a; a = b; b = tmp; }
      const key = a * nverts + b;
      if (seen.has(key)) continue;
      seen.add(key);
      const hAvg = (heights[a] + heights[b]) * 0.5;
      let band = (hAvg * NBANDS) | 0;
      if (band >= NBANDS) band = NBANDS - 1;
      bands[band].push(a, b);
    }
  }
  const bandEdges = bands.map((b) => new Uint32Array(b));

  return { positions, heights, tris, bandEdges, flatTris: null };
}

/**
 * 3D Model (File) — loads an indexed .obj from the app's public/ folder via fetch and
 * renders it with a custom, allocation-light projector: unique vertices are transformed
 * once per frame, the wireframe is drawn in a dozen batched strokes (bucketed by height
 * for the top→bottom gradient), and filled mode uses back-to-front painter ordering with
 * optional back-face culling. No upload flow needed.
 *
 * Orthographic projection (the `Size` control scales directly). Spin derives from
 * frame.time so playback/scrub stay deterministic.
 *
 * It also exposes its on-screen silhouette as a scalar field (fieldSource), so effects
 * stacked above react to the model exactly as they do to text. That field is built
 * lazily — only when something actually samples it, and at most once per pose — so an
 * unused model pays nothing for the capability, and the silhouette reuses the screen
 * projection (no second rotation pass).
 */
class ModelFileRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;

  private mesh: Mesh | null = null;
  private loadedUrl = "";
  private loading = false;
  private error = "";

  // reusable per-frame projection buffers (sized to vertex count)
  private sx = new Float32Array(0); // screen x
  private sy = new Float32Array(0); // screen y
  private sz = new Float32Array(0); // depth (rotated z)
  private drawKey = "";

  // ── silhouette coverage field (consumed by effects above) ──
  private silCanvas = document.createElement("canvas");
  private silCtx = this.silCanvas.getContext("2d", { willReadFrequently: true })!;
  private sil = new Uint8Array(0); // 0/1 coverage at silW×silH
  private silW = 0;
  private silH = 0;
  private poseToken = "";  // current pose, refreshed every render (cheap string)
  private silToken = "";   // pose the silhouette buffer currently reflects
  private fieldFn: ((x: number, y: number, z: number) => number) | null = null;

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
  }

  private ensureLoaded(url: string): void {
    if (url === this.loadedUrl || this.loading) return;
    this.loading = true;
    this.error = "";
    this.loadedUrl = url;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        const ct = r.headers.get("content-type") ?? "";
        if (ct.includes("text/html")) throw new Error(`Got HTML, not a model — check the path (${url})`);
        return r.text();
      })
      .then((text) => {
        const head = text.slice(0, 200).trimStart().toLowerCase();
        if (head.startsWith("<!doctype") || head.startsWith("<html")) {
          throw new Error(`Got HTML, not a model — check the path (${url})`);
        }
        const m = parseOBJIndexed(text);
        if (!m) { this.error = "No triangles parsed (valid OBJ with f-faces?)"; this.loading = false; return; }
        this.mesh = m;
        const nv = m.positions.length / 3;
        this.sx = new Float32Array(nv);
        this.sy = new Float32Array(nv);
        this.sz = new Float32Array(nv);
        this.drawKey = ""; // force redraw
        this.silToken = ""; // force silhouette rebuild on next sample
        this.loading = false;
      })
      .catch((e) => {
        this.mesh = null;
        this.error = String(e?.message ?? e);
        this.loading = false;
      });
  }

  private resolveUrl(file: string, dir: string): string {
    let f = file.trim();
    if (!f) return "";
    if (/^https?:\/\//i.test(f) || f.startsWith("/")) return f;
    if (!/\.(obj)$/i.test(f)) f += ".obj";
    const base = dir.replace(/\/+$/, "");
    return `${base}/${f}`;
  }

  private status(msg: string): HTMLCanvasElement {
    const w = this.canvas.width, h = this.canvas.height;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.fillStyle = "rgba(160,160,170,0.9)";
    this.ctx.font = `${Math.max(11, Math.round(h * 0.018))}px monospace`;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(msg, w / 2, h / 2);
    return this.canvas;
  }

  /** Transform every unique vertex once into screen space + depth. */
  private project(scale: number, ax: number, ay: number, az: number, w: number, h: number): { dmin: number; dmax: number } {
    const pos = this.mesh!.positions;
    const n = pos.length;
    const cx = Math.cos(ax), sx = Math.sin(ax);
    const cy = Math.cos(ay), sy = Math.sin(ay);
    const cz = Math.cos(az), sz = Math.sin(az);
    const ox = w * 0.5, oy = h * 0.5;
    let dmin = Infinity, dmax = -Infinity;
    for (let i = 0, v = 0; i < n; i += 3, v++) {
      const x0 = pos[i], y0 = pos[i + 1], z0 = pos[i + 2];
      // rotate X
      const y1 = y0 * cx - z0 * sx;
      const z1 = y0 * sx + z0 * cx;
      // rotate Y
      const x2 = x0 * cy + z1 * sy;
      const z2 = -x0 * sy + z1 * cy;
      // rotate Z
      const x3 = x2 * cz - y1 * sz;
      const y3 = x2 * sz + y1 * cz;
      this.sx[v] = ox + x3 * scale;
      this.sy[v] = oy - y3 * scale; // flip so +Y is up
      this.sz[v] = z2;
      if (z2 < dmin) dmin = z2;
      if (z2 > dmax) dmax = z2;
    }
    return { dmin, dmax };
  }

  /**
   * Rasterise the model's filled silhouette into the small coverage buffer. Reuses the
   * screen projection (this.sx/sy) and just scales it down — because the buffer is a
   * scaled copy of the canvas, screenX*(bw/canvasW) lands exactly at the buffer position
   * (the centring cancels), so no second rotation is needed. All triangles fill in one
   * path + one fill, then a single readback builds the 0/1 mask. Called lazily, at most
   * once per pose.
   */
  private rasterSilhouette(): void {
    const mesh = this.mesh;
    if (!mesh) return;
    const cw = this.canvas.width, ch = this.canvas.height;
    if (cw === 0 || ch === 0) return;
    const aspect = cw / ch;
    let bw: number, bh: number;
    if (aspect >= 1) { bw = 160; bh = Math.max(16, Math.round(160 / aspect)); }
    else { bh = 160; bw = Math.max(16, Math.round(160 * aspect)); }

    if (this.silCanvas.width !== bw || this.silCanvas.height !== bh) {
      this.silCanvas.width = bw;
      this.silCanvas.height = bh;
      this.silW = bw;
      this.silH = bh;
      this.sil = new Uint8Array(bw * bh);
    }
    const sctx = this.silCtx;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, bw, bh);
    sctx.fillStyle = "#fff";

    const rx = bw / cw, ry = bh / ch;
    const SX = this.sx, SY = this.sy, tris = mesh.tris;
    sctx.beginPath();
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      sctx.moveTo(SX[a] * rx, SY[a] * ry);
      sctx.lineTo(SX[b] * rx, SY[b] * ry);
      sctx.lineTo(SX[c] * rx, SY[c] * ry);
      sctx.closePath();
    }
    sctx.fill();

    const img = sctx.getImageData(0, 0, bw, bh).data;
    const sil = this.sil;
    for (let i = 0, p = 3; i < sil.length; i++, p += 4) sil[i] = img[p] > 40 ? 1 : 0;
  }

  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.resize(frame.width, frame.height);
    }
    const pr = frame.props;
    const dir = String(pr.directory ?? "/models");
    const file = String(pr.file ?? "");
    const url = this.resolveUrl(file, dir);

    if (!url) return this.status("Set a file name (e.g. Girl_Base_OBJ.obj)");
    this.ensureLoaded(url);
    if (this.loading && !this.mesh) return this.status(`Loading ${file}…`);
    if (this.error) return this.status(`Error: ${this.error}`);
    if (!this.mesh) return this.status("Empty model");

    const w = this.canvas.width, h = this.canvas.height;
    const scale = num(pr.radius, 0.8) * Math.min(w, h) * 0.5;
    const ax = (num(pr.tiltX, 20) * Math.PI) / 180;
    const ay = ((num(pr.tiltY, 0) + frame.time * num(pr.spin, 0)) * Math.PI) / 180;
    const az = (num(pr.tiltZ, 0) * Math.PI) / 180;
    const filled = pr.style === "filled";
    const colorTop = arr(pr.color, [192, 252, 4, 255]);
    const colorBot = arr(pr.colorB, [54, 1, 251, 255]);
    const lineWidth = num(pr.lineWidth, 1);
    const depthShade = pr.depthShade !== false;
    const cull = pr.cull === true;

    // Record the current pose so the silhouette field (built lazily on demand) and
    // sourceKey track rotation. This is just a string assignment — no work is done here
    // unless an effect actually samples the field later this frame.
    this.poseToken = `${scale}|${ax}|${ay}|${az}|${w}x${h}|${this.loadedUrl}`;

    // skip the whole redraw when nothing visual changed (helps while paused/editing).
    const key = JSON.stringify([scale, ax, ay, az, filled, colorTop, colorBot, lineWidth, depthShade, cull, w, h, this.loadedUrl]);
    if (key === this.drawKey) return this.canvas;
    this.drawKey = key;

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const [bgR, bgG, bgB, bgA] = arr(pr.background, [0, 0, 0, 0]);
    if (bgA > 0) {
      ctx.fillStyle = `rgba(${bgR},${bgG},${bgB},${bgA / 255})`;
      ctx.fillRect(0, 0, w, h);
    }

    const { dmin, dmax } = this.project(scale, ax, ay, az, w, h);
    const drange = dmax - dmin || 1;
    const mesh = this.mesh;

    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const lerpCol = (t: number, shade: number) => {
      const r = (colorBot[0] + (colorTop[0] - colorBot[0]) * t) * shade;
      const g = (colorBot[1] + (colorTop[1] - colorBot[1]) * t) * shade;
      const b = (colorBot[2] + (colorTop[2] - colorBot[2]) * t) * shade;
      const a = (colorBot[3] ?? 255) + ((colorTop[3] ?? 255) - (colorBot[3] ?? 255)) * t;
      return `rgba(${r | 0},${g | 0},${b | 0},${a / 255})`;
    };

    if (!filled) {
      // ── wireframe: one stroke per height band (≈12 total), not one per edge ──
      ctx.lineWidth = lineWidth;
      const SX = this.sx, SY = this.sy, SZ = this.sz;
      for (let band = 0; band < NBANDS; band++) {
        const edges = mesh.bandEdges[band];
        if (edges.length === 0) continue;
        const path = new Path2D();
        let depthSum = 0;
        for (let i = 0; i < edges.length; i += 2) {
          const a = edges[i], b = edges[i + 1];
          path.moveTo(SX[a], SY[a]);
          path.lineTo(SX[b], SY[b]);
          depthSum += SZ[a] + SZ[b];
        }
        const t = band / (NBANDS - 1);
        let shade = 1;
        if (depthShade) {
          const avgDepth = depthSum / edges.length; // edges.length = 2×count
          const dn = (avgDepth - dmin) / drange; // 0 far … 1 near
          shade = 0.45 + 0.55 * dn;
        }
        ctx.strokeStyle = lerpCol(t, shade);
        ctx.stroke(path);
      }
    } else {
      // ── filled: cull + painter's sort, then fill each face. Heavier by nature; the
      //    sort is O(n log n) once, culling roughly halves the fills. ──
      const tris = mesh.tris;
      const ntri = tris.length / 3;
      const order: number[] = [];
      const depth = new Float32Array(ntri);
      const SX = this.sx, SY = this.sy, SZ = this.sz, H = mesh.heights;
      for (let t = 0; t < ntri; t++) {
        const i = t * 3;
        const a = tris[i], b = tris[i + 1], c = tris[i + 2];
        if (cull) {
          // screen-space signed area; skip back-facing winding
          const area = (SX[b] - SX[a]) * (SY[c] - SY[a]) - (SX[c] - SX[a]) * (SY[b] - SY[a]);
          if (area <= 0) continue;
        }
        depth[t] = (SZ[a] + SZ[b] + SZ[c]) / 3;
        order.push(t);
      }
      order.sort((p, q) => depth[p] - depth[q]); // far → near
      for (let oi = 0; oi < order.length; oi++) {
        const t = order[oi];
        const i = t * 3;
        const a = tris[i], b = tris[i + 1], c = tris[i + 2];
        const ht = (H[a] + H[b] + H[c]) / 3;
        let shade = 1;
        if (depthShade) shade = 0.45 + 0.55 * ((depth[t] - dmin) / drange);
        ctx.fillStyle = lerpCol(ht, shade);
        ctx.beginPath();
        ctx.moveTo(SX[a], SY[a]);
        ctx.lineTo(SX[b], SY[b]);
        ctx.lineTo(SX[c], SY[c]);
        ctx.closePath();
        ctx.fill();
      }
    }

    return this.canvas;
  }

  // feed a Slicer above — build the flat tris array lazily on first request
  meshSource(): { tris: number[] } {
    const m = this.mesh;
    if (!m) return { tris: [] };
    if (!m.flatTris) {
      const out: number[] = [];
      const pos = m.positions;
      for (let t = 0; t < m.tris.length; t += 3) {
        for (let k = 0; k < 3; k++) {
          const v = m.tris[t + k] * 3;
          out.push(pos[v], pos[v + 1], pos[v + 2]);
        }
      }
      m.flatTris = out;
    }
    return { tris: m.flatTris };
  }

  /**
   * Expose the model's on-screen silhouette as a scalar field — the hook effects above
   * consume (frame.below.field / frame.textField.field), same as the text field. The
   * closure is built once and reads live state: on sample it rasterises the silhouette
   * only if the pose changed since the last raster, otherwise it just reads the cached
   * mask. So nothing is computed unless an effect actually samples it, and repeated
   * samples within a frame share one raster. Coordinates are normalised 0..1 with the
   * value clamped 0..1 — exactly what fieldToMask feeds in.
   */
  fieldSource(): ((x: number, y: number, z: number) => number) | undefined {
    if (!this.fieldFn) {
      this.fieldFn = (x: number, y: number) => {
        if (!this.mesh) return 0;
        if (this.silToken !== this.poseToken) {
          this.rasterSilhouette();
          this.silToken = this.poseToken;
        }
        if (this.silW === 0 || x < 0 || x >= 1 || y < 0 || y >= 1) return 0;
        const bx = (x * this.silW) | 0;
        const by = (y * this.silH) | 0;
        return this.sil[by * this.silW + bx];
      };
    }
    return this.fieldFn;
  }

  sourceKey(): string {
    // pose is part of the key, so consumers re-mask when the model rotates/resizes
    return `modelFile:${this.loadedUrl}:${this.poseToken}`;
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
    this.mesh = null;
    this.sx = this.sy = this.sz = new Float32Array(0);
    this.sil = new Uint8Array(0);
    this.silCanvas.width = this.silCanvas.height = 0;
    this.fieldFn = null;
  }
}

export const modelFileLayerType: LayerTypeDefinition = {
  type: "modelFile",
  label: "3D Model (File)",
  category: "3D",
  icon: "Boxes",
  description: "Load an .obj from public/models by name and render it (rotating wire/filled), indexed & batched for speed. No upload needed; can feed a Slicer above and drive effects via its silhouette.",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "file", name: "File Name", type: "string", default: "marathon.obj", group: "Source", animatable: false },
    { key: "directory", name: "Folder (public)", type: "string", default: "/models", group: "Source", animatable: false },
    { key: "radius", name: "Size", type: "number", default: 0.8, group: "View", meta: { min: 0.1, max: 1.6, step: 0.01 } },
    { key: "tiltX", name: "Tilt X", type: "angle", default: 20, group: "View", meta: { step: 1, unit: "°" } },
    { key: "tiltY", name: "Tilt Y", type: "angle", default: 0, group: "View", meta: { step: 1, unit: "°" } },
    { key: "tiltZ", name: "Tilt Z", type: "angle", default: 0, group: "View", meta: { step: 1, unit: "°" } },
    { key: "spin", name: "Spin Speed", type: "number", default: 0, group: "View", meta: { min: -360, max: 360, step: 1 } },
    { key: "style", name: "Style", type: "select", default: "wire", group: "Look", meta: { options: [ { label: "Wireframe", value: "wire" }, { label: "Filled", value: "filled" } ] } },
    { key: "color", name: "Color (top)", type: "color", default: [192, 252, 4, 255], group: "Look" },
    { key: "colorB", name: "Color (bottom)", type: "color", default: [54, 1, 251, 255], group: "Look" },
    { key: "lineWidth", name: "Line Width", type: "number", default: 1, group: "Look", meta: { min: 0.25, max: 8, step: 0.25 } },
    { key: "depthShade", name: "Depth Shade", type: "boolean", default: true, group: "Look" },
    { key: "cull", name: "Backface Cull", type: "boolean", default: false, group: "Look" },
    { key: "background", name: "Background", type: "color", default: [0, 0, 0, 0], group: "Look" },
  ],
  createRenderer: () => new ModelFileRenderer(),
};