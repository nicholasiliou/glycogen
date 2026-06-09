import type { Layer } from "../../engine/scene/Layer";
import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";
import type { PropertyValue } from "../../engine/core/types";
import type { MeshData } from "../slicer/meshLoader";
import { drawMesh3D } from "../_shared/mesh3d";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function arr(v: unknown, f: number[]): number[] {
  return Array.isArray(v) ? (v as number[]) : f;
}

/**
 * An uploaded 3D model (.obj / .stl). Renders it as a rotating wireframe/filled object
 * and exposes its triangles via meshSource — so a Slicer above slices the model. The
 * renderer keeps a reference to its layer, so it can serve geometry even while hidden.
 */
class ModelRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private lastFrame = -1;
  private projKey = "";
  private forceInitial = true;

  constructor(private layer: Layer) {}

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
  }

  private mesh(): MeshData | undefined {
    return this.layer.data.mesh as MeshData | undefined;
  }

  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) this.resize(frame.width, frame.height);
    const pr = frame.props;
    const m = this.mesh();
    const projKey = JSON.stringify([m?.name ?? "", num(this.layer.data.meshVersion as number, 0), pr.style, pr.radius, pr.tiltX, pr.tiltY, pr.tiltZ, pr.color, pr.colorB, pr.lineWidth, pr.depthShade, pr.cull]);
    const drew = this.forceInitial || frame.frame !== this.lastFrame || projKey !== this.projKey;
    this.projKey = projKey;
    this.lastFrame = frame.frame;
    this.forceInitial = false;
    if (!drew) return this.canvas;

    const w = this.canvas.width, h = this.canvas.height;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    if (!m || !m.tris.length) return this.canvas;
    drawMesh3D(this.ctx, m.tris, {
      w, h,
      scale: num(pr.radius, 0.8) * Math.min(w, h) * 0.5,
      ax: (num(pr.tiltX, 20) * Math.PI) / 180,
      ay: ((num(pr.tiltY, 0) + frame.time * num(pr.spin, 24)) * Math.PI) / 180,
      az: (num(pr.tiltZ, 0) * Math.PI) / 180,
      style: pr.style === "filled" ? "filled" : "wire",
      color: arr(pr.color, [192, 252, 4, 255]),
      colorB: arr(pr.colorB, [54, 1, 251, 255]),
      lineWidth: num(pr.lineWidth, 1),
      depthShade: pr.depthShade !== false,
      cull: pr.cull === true,
    });
    return this.canvas;
  }

  meshSource(): { tris: number[] } {
    const m = this.mesh();
    return { tris: m?.tris ?? [] };
  }
  sourceKey(_props: Record<string, PropertyValue>): string {
    return `model:${num(this.layer.data.meshVersion as number, 0)}`;
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
  }
}

export const modelLayerType: LayerTypeDefinition = {
  type: "model",
  label: "3D Model",
  category: "3D",
  icon: "Boxes",
  description: "Upload an .obj/.stl model; render it and feed it to a Slicer above.",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "radius", name: "Size", type: "number", default: 0.8, group: "View", meta: { min: 0.1, max: 1.6, step: 0.01 } },
    { key: "tiltX", name: "Tilt X", type: "angle", default: 20, group: "View", meta: { step: 1, unit: "°" } },
    { key: "tiltY", name: "Tilt Y", type: "angle", default: 0, group: "View", meta: { step: 1, unit: "°" } },
    { key: "tiltZ", name: "Tilt Z", type: "angle", default: 0, group: "View", meta: { step: 1, unit: "°" } },
    { key: "spin", name: "Spin Speed", type: "number", default: 24, group: "View", meta: { min: -360, max: 360, step: 1 } },
    { key: "style", name: "Style", type: "select", default: "wire", group: "Look", meta: { options: [ { label: "Wireframe", value: "wire" }, { label: "Filled", value: "filled" } ] } },
    { key: "color", name: "Color (top)", type: "color", default: [192, 252, 4, 255], group: "Look" },
    { key: "colorB", name: "Color (bottom)", type: "color", default: [54, 1, 251, 255], group: "Look" },
    { key: "lineWidth", name: "Line Width", type: "number", default: 1, group: "Look", meta: { min: 0.25, max: 8, step: 0.25 } },
    { key: "depthShade", name: "Depth Shade", type: "boolean", default: true, group: "Look" },
    { key: "cull", name: "Backface Cull", type: "boolean", default: false, group: "Look" },
  ],
  createRenderer: (layer) => new ModelRenderer(layer),
};
