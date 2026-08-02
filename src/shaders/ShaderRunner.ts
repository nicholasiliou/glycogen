const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Passthrough used to copy a runner's target onto the shared canvas at the end of a chain. */
const BLIT_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
void main() { gl_FragColor = texture2D(uTex, vUv); }`;

/**
 * An offscreen render target owned by one runner: a texture plus the framebuffer that draws into
 * it. Passing one of these back into {@link ShaderRunner.render} or {@link ShaderRunner.setTexture}
 * keeps the pixels on the GPU - the alternative is reading the pass back into a canvas and
 * re-uploading it, which is what the per-pass canvas hand-off used to cost.
 */
export interface ShaderTarget {
  readonly tex: WebGLTexture;
  readonly fbo: WebGLFramebuffer;
  readonly w: number;
  readonly h: number;
}

function isTarget(src: TexImageSource | ShaderTarget): src is ShaderTarget {
  return "fbo" in src;
}

/** Pixel size of any `TexImageSource`; `{0,0}` for sources that do not report one. */
function sourceSize(src: TexImageSource): { w: number; h: number } {
  if (typeof HTMLVideoElement !== "undefined" && src instanceof HTMLVideoElement) {
    return { w: src.videoWidth, h: src.videoHeight };
  }
  const s = src as { width?: number; height?: number };
  return { w: s.width ?? 0, h: s.height ?? 0 };
}

// ── the shared context ─────────────────────────────────────────────────────────────────────────
// Every runner draws through one WebGL context. A context per runner is expensive everywhere, but
// on Firefox it is also *capped*: past the limit the oldest contexts are force-lost, which on a
// full stage (six banks, and DeepGlow alone holding several runners) means layers silently blank.
// One context also lets passes hand each other textures instead of canvases.

interface Shared {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  quad: WebGLBuffer;
  blit: WebGLProgram | null;
  blitTexLoc: WebGLUniformLocation | null;
}

let shared: Shared | null = null;
let sharedFailed = false;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error("[shader]", gl.getShaderInfoLog(sh), src);
    return null;
  }
  return sh;
}

function link(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram | null {
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
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

function getShared(): Shared | null {
  if (shared || sharedFailed) return shared;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) {
    sharedFailed = true;
    return null;
  }
  // Canvas/image sources arrive top-down and are flipped on upload so they land in GL orientation;
  // textures rendered into an FBO are already in that orientation, so the two mix freely.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const quad = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const blit = link(gl, VERT, BLIT_FRAG);
  shared = { canvas, gl, quad, blit, blitTexLoc: blit && gl.getUniformLocation(blit, "uTex") };
  return shared;
}

export class ShaderRunner {
  private program: WebGLProgram | null = null;
  private uniformLoc = new Map<string, WebGLUniformLocation | null>();
  private backdropTex: WebGLTexture | null = null;
  private backdropDims = { w: 0, h: 0 };
  private extraTex = new Map<
    string,
    { tex: WebGLTexture; unit: number; dirty: boolean; source?: TexImageSource | ShaderTarget; dims: { w: number; h: number } }
  >();
  private target: ShaderTarget | null = null;
  private w = 16;
  private h = 16;

  constructor(fragSrc: string, extraTextureNames: string[] = []) {
    const s = getShared();
    if (!s) return;
    const program = link(s.gl, VERT, fragSrc);
    if (!program) return;
    this.program = program;
    this.backdropTex = this.makeTexture();
    extraTextureNames.forEach((name, i) => {
      this.extraTex.set(name, { tex: this.makeTexture()!, unit: i + 1, dirty: true, dims: { w: 0, h: 0 } });
    });
  }

  get available(): boolean {
    return !!shared && !!this.program;
  }

  private makeTexture(): WebGLTexture | null {
    const gl = shared!.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  private loc(name: string): WebGLUniformLocation | null {
    if (!this.uniformLoc.has(name)) this.uniformLoc.set(name, shared!.gl.getUniformLocation(this.program!, name));
    return this.uniformLoc.get(name) ?? null;
  }

  /**
   * Upload `src` into the currently bound texture, reusing the existing allocation when the size is
   * unchanged. `texImage2D` respecifies the texture on every call, so the driver drops and
   * reallocates its storage each frame; `texSubImage2D` writes into the allocation already there.
   */
  private upload(src: TexImageSource, dims: { w: number; h: number }): void {
    const gl = shared!.gl;
    const { w, h } = sourceSize(src);
    if (w > 0 && w === dims.w && h === dims.h) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
      return;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    dims.w = w;
    dims.h = h;
  }

  /** This runner's own render target, grown to the current size on demand. */
  private ensureTarget(): ShaderTarget {
    const gl = shared!.gl;
    if (this.target && this.target.w === this.w && this.target.h === this.h) return this.target;
    if (this.target) {
      gl.deleteFramebuffer(this.target.fbo);
      gl.deleteTexture(this.target.tex);
    }
    const tex = this.makeTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.target = { tex, fbo, w: this.w, h: this.h };
    return this.target;
  }

  /** Bind a source - an existing GPU target binds directly, anything else is uploaded. */
  private bindSource(src: TexImageSource | ShaderTarget, tex: WebGLTexture | null, dims: { w: number; h: number }): void {
    const gl = shared!.gl;
    if (isTarget(src)) {
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    this.upload(src, dims);
  }

  setTexture(name: string, source: TexImageSource | ShaderTarget): void {
    const e = this.extraTex.get(name);
    if (e) {
      e.source = source;
      e.dirty = true;
    }
  }

  resize(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
  }

  /**
   * Run the pass and leave the result on the GPU. Chain these when one pass feeds the next; the
   * returned target stays valid until this runner draws again, so a consumer that needs to hold on
   * to several tiers at once needs a runner per tier.
   */
  renderToTexture(backdrop: TexImageSource | ShaderTarget, uniforms: Record<string, number | number[]>): ShaderTarget | null {
    const s = shared;
    if (!s || !this.program) return null;
    const gl = s.gl;
    const target = this.ensureTarget();

    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);

    // Vertex state is per-context now, so it is re-established per draw rather than once at build.
    gl.bindBuffer(gl.ARRAY_BUFFER, s.quad);
    const aPos = gl.getAttribLocation(this.program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    this.bindSource(backdrop, this.backdropTex, this.backdropDims);
    gl.uniform1i(this.loc("uTex"), 0);

    for (const [name, e] of this.extraTex) {
      gl.activeTexture(gl.TEXTURE0 + e.unit);
      if (e.dirty && e.source) {
        this.bindSource(e.source, e.tex, e.dims);
        e.dirty = false;
      } else {
        gl.bindTexture(gl.TEXTURE_2D, e.source && isTarget(e.source) ? e.source.tex : e.tex);
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return target;
  }

  /**
   * Run the pass and hand back a canvas, for callers that composite in 2D. The canvas is shared and
   * is overwritten by the next `render`, so draw from it before running another pass - the same
   * single-surface contract the runner has always had.
   */
  render(backdrop: TexImageSource | ShaderTarget, uniforms: Record<string, number | number[]>): HTMLCanvasElement {
    const s = shared;
    const target = this.renderToTexture(backdrop, uniforms);
    if (!s || !target || !s.blit) return (isTarget(backdrop) ? s?.canvas : backdrop) as HTMLCanvasElement;
    const gl = s.gl;

    if (s.canvas.width !== target.w || s.canvas.height !== target.h) {
      s.canvas.width = target.w;
      s.canvas.height = target.h;
    }
    gl.viewport(0, 0, target.w, target.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(s.blit);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.quad);
    const aPos = gl.getAttribLocation(s.blit, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.tex);
    gl.uniform1i(s.blitTexLoc, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return s.canvas;
  }

  /** Release this runner's GL objects. The shared context outlives every runner. */
  dispose(): void {
    const s = shared;
    if (!s) return;
    const gl = s.gl;
    if (this.target) {
      gl.deleteFramebuffer(this.target.fbo);
      gl.deleteTexture(this.target.tex);
      this.target = null;
    }
    if (this.backdropTex) gl.deleteTexture(this.backdropTex);
    for (const e of this.extraTex.values()) gl.deleteTexture(e.tex);
    this.extraTex.clear();
    if (this.program) gl.deleteProgram(this.program);
    this.program = null;
    this.uniformLoc.clear();
  }
}
