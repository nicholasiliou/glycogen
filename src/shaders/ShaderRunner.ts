const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export class ShaderRunner {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null;
  private program: WebGLProgram | null = null;
  private uniformLoc = new Map<string, WebGLUniformLocation | null>();
  private backdropTex: WebGLTexture | null = null;
  private extraTex = new Map<string, { tex: WebGLTexture; unit: number; dirty: boolean; source?: TexImageSource }>();

  constructor(fragSrc: string, extraTextureNames: string[] = []) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 16;
    this.canvas.height = 16;
    this.gl = this.canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!this.gl) return;
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    const program = this.build(VERT, fragSrc);
    if (!program) {
      this.gl = null;
      return;
    }
    this.program = program;
    gl.useProgram(program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.backdropTex = this.makeTexture();
    extraTextureNames.forEach((name, i) => {
      const tex = this.makeTexture();
      this.extraTex.set(name, { tex: tex!, unit: i + 1, dirty: true });
    });
  }

  get available(): boolean {
    return !!this.gl && !!this.program;
  }

  private build(vs: string, fs: string): WebGLProgram | null {
    const gl = this.gl!;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("[shader]", gl.getShaderInfoLog(sh), src);
        return null;
      }
      return sh;
    };
    const v = compile(gl.VERTEX_SHADER, vs);
    const f = compile(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = gl.createProgram()!;
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error("[shader] link", gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  private makeTexture(): WebGLTexture | null {
    const gl = this.gl!;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  private loc(name: string): WebGLUniformLocation | null {
    if (!this.uniformLoc.has(name)) this.uniformLoc.set(name, this.gl!.getUniformLocation(this.program!, name));
    return this.uniformLoc.get(name) ?? null;
  }

  setTexture(name: string, source: TexImageSource): void {
    const e = this.extraTex.get(name);
    if (e) {
      e.source = source;
      e.dirty = true;
    }
  }

  resize(w: number, h: number): void {
    if (!this.gl) return;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = Math.max(1, w);
      this.canvas.height = Math.max(1, h);
    }
  }

  render(backdrop: TexImageSource, uniforms: Record<string, number | number[]>): HTMLCanvasElement {
    const gl = this.gl;
    if (!gl || !this.program) {
      return backdrop as HTMLCanvasElement;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.backdropTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, backdrop);
    gl.uniform1i(this.loc("uTex"), 0);

    for (const [name, e] of this.extraTex) {
      gl.activeTexture(gl.TEXTURE0 + e.unit);
      gl.bindTexture(gl.TEXTURE_2D, e.tex);
      if (e.dirty && e.source) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, e.source);
        e.dirty = false;
      }
      gl.uniform1i(this.loc(name), e.unit);
    }

    for (const [name, val] of Object.entries(uniforms)) {
      const l = this.loc(name);
      if (l === null) continue;
      if (typeof val === "number") gl.uniform1f(l, val);
      else if (val.length === 2) gl.uniform2f(l, val[0], val[1]);
      else if (val.length === 3) gl.uniform3f(l, val[0], val[1], val[2]);
      else if (val.length === 4) gl.uniform4f(l, val[0], val[1], val[2], val[3]);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }

  dispose(): void {
    const gl = this.gl;
    if (!gl) return;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }
}
