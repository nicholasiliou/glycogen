import { Plugin, type Frame } from "./Plugin";
import {
  boxMesh,
  coneMesh,
  cylinderMesh,
  drawMesh3D,
  sphereMesh,
  supershapeMesh,
  torusKnotMesh,
  torusMesh,
} from "./_shared/mesh3d";

const SHAPES = ["torusKnot", "sphere", "torus", "box", "cylinder", "cone", "supershape"];

/**
 * Reference generator. A parametric 3D shape rendered as a rotating wireframe/filled object. Each
 * parameter is just a control binding — move `fader 3` to spin, tap `button 0` to cycle geometry.
 * No id/label/kind here: those come from the filename + folder via the registry.
 */
export class ShapeLayer extends Plugin {
  shape = this.cycle(SHAPES);
  resolution = this.number({ min: 8, max: 80, step: 1, default: 28 });
  radius = this.number({ min: 0.1, max: 1.4, step: 0.01, default: 0.7 });
  lineWidth = this.number({ min: 0.25, max: 8, step: 0.25, default: 1 });
  tiltX = this.number({ min: -180, max: 180, default: 28 });
  tiltY = this.number({ min: -180, max: 180, default: 0 });
  tiltZ = this.number({ min: -180, max: 180, default: 0 });
  spin = this.number({ min: -360, max: 360, default: 24 }); // deck-A SmoothKnob
  filled = this.toggle();
  depthShade = this.toggle(true);
  cull = this.toggle();

  private ctx = this.canvas.getContext("2d")!;
  private tris: number[] = [];
  private meshKey = "";

  constructor() {
    super();
  }

  private buildMesh(): number[] {
    const res = Math.max(8, Math.min(80, Math.round(this.resolution.value)));
    switch (this.shape.pick(SHAPES)) {
      case "torus": return torusMesh(0.62, 0.28, res);
      case "box": return boxMesh();
      case "cylinder": return cylinderMesh(res);
      case "cone": return coneMesh(res);
      case "torusKnot": return torusKnotMesh(2, 3, res * 6, 12, 0.18);
      case "supershape": return supershapeMesh(6, 0.4, 1, 1, res * 2);
      default: return sphereMesh(res);
    }
  }

  render(f: Frame): HTMLCanvasElement {
    const key = `${this.shape.pick(SHAPES)}|${Math.round(this.resolution.value)}`;
    if (key !== this.meshKey) {
      this.tris = this.buildMesh();
      this.meshKey = key;
    }

    const w = this.canvas.width, h = this.canvas.height;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    drawMesh3D(this.ctx, this.tris, {
      w,
      h,
      scale: this.radius.value * Math.min(w, h) * 0.5,
      ax: (this.tiltX.value * Math.PI) / 180,
      ay: ((this.tiltY.value + f.time * this.spin.value) * Math.PI) / 180,
      az: (this.tiltZ.value * Math.PI) / 180,
      style: this.filled.on ? "filled" : "wire",
      color: [192, 252, 4, 255],
      colorB: [54, 1, 251, 255],
      lineWidth: this.lineWidth.value,
      depthShade: this.depthShade.on,
      cull: this.cull.on,
    });
    return this.canvas;
  }

  dispose(): void {
    super.dispose();
    this.tris = [];
  }
}
