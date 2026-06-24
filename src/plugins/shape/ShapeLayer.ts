import type { LayerTypeDefinition } from "../../engine/plugins/Registry";
import type { LayerRenderer, RenderFrame } from "../../engine/render/types";
import type { PropertyValue } from "../../engine/core/types";
import {
  boxMesh,
  coneMesh,
  cylinderMesh,
  drawMesh3D,
  sphereMesh,
  supershapeMesh,
  torusKnotMesh,
  torusMesh,
} from "../_shared/mesh3d";

function num(v: unknown, f: number): number {
  return typeof v === "number" ? v : f;
}
function arr(v: unknown, f: number[]): number[] {
  return Array.isArray(v) ? (v as number[]) : f;
}

function buildMesh(props: Record<string, PropertyValue>): number[] {
  const res = Math.max(8, Math.min(80, Math.round(num(props.resolution, 28))));
  switch (props.shape) {
    case "torus": return torusMesh(0.62, 0.28, res);
    case "box": return boxMesh();
    case "cylinder": return cylinderMesh(res);
    case "cone": return coneMesh(res);
    case "torusKnot": return torusKnotMesh(Math.round(num(props.knotP, 2)), Math.round(num(props.knotQ, 3)), res * 6, 12, 0.18);
    case "supershape": return supershapeMesh(num(props.superM, 6), num(props.superN1, 0.4), 1, 1, res * 2);
    default: return sphereMesh(res);
  }
}
function meshKey(props: Record<string, PropertyValue>): string {
  return [props.shape, props.resolution, props.knotP, props.knotQ, props.superM, props.superN1].join("|");
}

/**
 * A parametric 3D shape (sphere / torus / box / cylinder / cone / torus-knot /
 * supershape). Renders itself as a rotating wireframe or filled object AND exposes its
 * geometry via meshSource — so a Slicer placed above it slices this shape. No implicit
 * shapes live in the slicer anymore; they're authored here with options.
 */
class ShapeRenderer implements LayerRenderer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private tris: number[] = [];
  private meshKey = "";
  private projKey = "";
  private lastFrame = -1;
  private forceInitial = true;

  resize(w: number, h: number): void {
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
  }

  private ensure(props: Record<string, PropertyValue>): void {
    const key = meshKey(props);
    if (key !== this.meshKey) {
      this.tris = buildMesh(props);
      this.meshKey = key;
    }
  }

  render(frame: RenderFrame): HTMLCanvasElement {
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) this.resize(frame.width, frame.height);
    const pr = frame.props;
    this.ensure(pr);
    const projKey = JSON.stringify([this.meshKey, pr.style, pr.radius, pr.tiltX, pr.tiltY, pr.tiltZ, pr.spin && 0, pr.color, pr.colorB, pr.lineWidth, pr.depthShade, pr.cull]);
    const drew = this.forceInitial || frame.frame !== this.lastFrame || projKey !== this.projKey;
    this.projKey = projKey;
    this.lastFrame = frame.frame;
    this.forceInitial = false;
    if (!drew) return this.canvas;

    const w = this.canvas.width, h = this.canvas.height;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    drawMesh3D(this.ctx, this.tris, {
      w, h,
      scale: num(pr.radius, 0.7) * Math.min(w, h) * 0.5,
      ax: (num(pr.tiltX, 28) * Math.PI) / 180,
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

  meshSource(props: Record<string, PropertyValue>): { tris: number[] } {
    this.ensure(props);
    return { tris: this.tris };
  }
  sourceKey(props: Record<string, PropertyValue>): string {
    return meshKey(props);
  }

  dispose(): void {
    this.canvas.width = this.canvas.height = 0;
    this.tris = [];
  }
}

export const shapeLayerType: LayerTypeDefinition = {
  type: "shape",
  label: "3D Shape",
  category: "3D",
  icon: "Shapes",
  description: "A parametric 3D shape (sphere/torus/box/knot/supershape…). Slice it with a Slicer above.",
  defaultSize: (comp) => [comp.width, comp.height],
  schema: [
    { key: "shape", name: "Shape", type: "select", default: "torusKnot", group: "Shape", meta: { options: [
      { label: "Sphere", value: "sphere" }, { label: "Torus", value: "torus" }, { label: "Box", value: "box" },
      { label: "Cylinder", value: "cylinder" }, { label: "Cone", value: "cone" }, { label: "Torus Knot", value: "torusKnot" },
      { label: "Supershape", value: "supershape" } ] } },
    { key: "resolution", name: "Resolution", type: "number", default: 28, group: "Shape", meta: { min: 8, max: 80, step: 1 } },
    { key: "knotP", name: "Knot P", type: "number", default: 2, group: "Shape", meta: { min: 1, max: 12, step: 1 } },
    { key: "knotQ", name: "Knot Q", type: "number", default: 3, group: "Shape", meta: { min: 1, max: 12, step: 1 } },
    { key: "superM", name: "Super m", type: "number", default: 6, group: "Shape", meta: { min: 1, max: 20, step: 1 } },
    { key: "superN1", name: "Super n1", type: "number", default: 0.4, group: "Shape", meta: { min: 0.1, max: 4, step: 0.05 } },
    { key: "radius", name: "Size", type: "number", default: 0.7, group: "View", meta: { min: 0.1, max: 1.4, step: 0.01 } },
    { key: "tiltX", name: "Tilt X", type: "angle", default: 28, group: "View", meta: { step: 1, unit: "°" } },
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
  createRenderer: () => new ShapeRenderer(),
};
