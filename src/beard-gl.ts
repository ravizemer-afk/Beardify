// Fast beard renderer on WebGL. Every strand becomes a thin two-segment ribbon
// that tapers and fades towards the tip, and the base layer is a mesh whose
// opacity follows the style mask, so the edges of the beard are soft. Thousands
// of strands render in well under a frame on phone GPUs, where Canvas 2D strokes
// would be too slow. The result is drawn onto the 2D stage canvas each frame.

import {
  BASE_STEPS_U, BASE_STEPS_V, BASE_V0, SHADE_ALPHA, SHADE_WIDTH,
  shadeRGB, strandCurve, type BeardFrame, type Curve, type Pt, type Strand,
} from './beard';
import type { BeardStyle } from './styles';

const VS = `
attribute vec2 a_pos;
attribute vec4 a_col;
uniform vec2 u_res;
varying vec4 v_col;
void main() {
  vec2 p = a_pos / u_res * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
  v_col = a_col;
}`;

const FS = `
precision mediump float;
varying vec4 v_col;
void main() { gl_FragColor = v_col; }`;

const FLOATS = 6; // x, y, r, g, b, a (premultiplied)
const STRAND_VERTS = 6; // root, middle, tip × two sides
const STRAND_INDICES = 12;

export class BeardGL {
  readonly canvas = document.createElement('canvas');
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private vbo: WebGLBuffer;
  private strandIbo: WebGLBuffer;
  private baseIbo: WebGLBuffer;
  private verts = new Float32Array(0);
  private strandCapacity = 0;
  private baseIndexCount = 0;
  private uRes: WebGLUniformLocation;

  /** Returns null when WebGL is unavailable. */
  static create(): BeardGL | null {
    try {
      return new BeardGL();
    } catch (e) {
      console.warn('WebGL beard renderer unavailable, using Canvas 2D', e);
      return null;
    }
  }

  private constructor() {
    const gl = this.canvas.getContext('webgl', { antialias: true, premultipliedAlpha: true, alpha: true });
    if (!gl) throw new Error('No WebGL');
    this.gl = gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    this.prog = prog;
    this.uRes = gl.getUniformLocation(prog, 'u_res')!;
    this.vbo = gl.createBuffer()!;
    this.strandIbo = gl.createBuffer()!;
    this.baseIbo = gl.createBuffer()!;

    // Base mesh indices never change: a (U+1) × (V+1) vertex grid.
    const idx: number[] = [];
    const row = BASE_STEPS_V + 1;
    for (let i = 0; i < BASE_STEPS_U; i++) {
      for (let j = 0; j < BASE_STEPS_V; j++) {
        const a = i * row + j, b = (i + 1) * row + j;
        idx.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
    this.baseIndexCount = idx.length;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.baseIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  }

  private ensureCapacity(strands: number) {
    const baseVerts = (BASE_STEPS_U + 1) * (BASE_STEPS_V + 1);
    const needed = Math.max(baseVerts, strands * STRAND_VERTS) * FLOATS;
    if (this.verts.length < needed) this.verts = new Float32Array(needed);
    if (strands <= this.strandCapacity) return;
    // 6 vertices per strand must fit 16-bit indices, so draw in chunks if needed.
    this.strandCapacity = strands;
    const idx = new Uint16Array(Math.min(strands, CHUNK) * STRAND_INDICES);
    for (let s = 0; s < Math.min(strands, CHUNK); s++) {
      const v = s * STRAND_VERTS, o = s * STRAND_INDICES;
      // vertices: 0 root-L, 1 root-R, 2 mid-L, 3 mid-R, 4 tip-L, 5 tip-R
      idx.set([v, v + 1, v + 3, v, v + 3, v + 2, v + 2, v + 3, v + 5, v + 2, v + 5, v + 4], o);
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.strandIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  }

  render(
    width: number,
    height: number,
    frame: BeardFrame | null,
    style: BeardStyle,
    strands: Strand[],
    color: string,
    lengthScale: number,
    /** Brightness of the scene around the face, so the beard matches the room's lighting. */
    light = 1,
  ) {
    const gl = this.gl;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!frame) return;

    gl.useProgram(this.prog);
    gl.uniform2f(this.uRes, width, height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const aPos = gl.getAttribLocation(this.prog, 'a_pos');
    const aCol = gl.getAttribLocation(this.prog, 'a_col');
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aCol);
    const setPointers = () => {
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, FLOATS * 4, 0);
      gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, FLOATS * 4, 8);
    };

    this.ensureCapacity(strands.length);
    const shades = shadeRGB(color).map(([r, g, b]) => [(r / 255) * light, (g / 255) * light, (b / 255) * light]);
    const out = this.verts;

    // 1. Base layer.
    if (style.base > 0) {
      const [r, g, b] = shades[0];
      const du = 1 / BASE_STEPS_U, dv = (1 - BASE_V0) / BASE_STEPS_V;
      let o = 0;
      for (let i = 0; i <= BASE_STEPS_U; i++) {
        for (let j = 0; j <= BASE_STEPS_V; j++) {
          const u = i * du, v = BASE_V0 + j * dv;
          frame.at(u, v, tmp);
          const a = style.base * style.mask(u, v);
          out[o++] = tmp.x; out[o++] = tmp.y;
          out[o++] = r * a; out[o++] = g * a; out[o++] = b * a; out[o++] = a;
        }
      }
      gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, o), gl.STREAM_DRAW);
      setPointers();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.baseIbo);
      gl.drawElements(gl.TRIANGLES, this.baseIndexCount, gl.UNSIGNED_SHORT, 0);
    }

    // 2. Strands.
    const widthBase = Math.max(0.9, frame.scale * style.thickness);
    let o = 0;
    for (const st of strands) {
      const c = strandCurve(frame, st, lengthScale, curve);
      // Hair under the jaw sits in shadow; each strand varies a little in tone.
      const k = st.tone * (1 - 0.28 * st.v * st.v);
      const [r, g, b] = shades[st.shade];
      // Hairs on the cheek turned away from the camera are seen edge-on.
      const alpha = style.alpha * SHADE_ALPHA[st.shade] * (1 - 0.3 * c.far);
      const w = (widthBase * SHADE_WIDTH[st.shade]) / 2;
      // Point on the curve halfway along.
      const mx = 0.25 * c.rx + 0.5 * c.cx + 0.25 * c.tx;
      const my = 0.25 * c.ry + 0.5 * c.cy + 0.25 * c.ty;
      // Roots are darker than the tips, as with real facial hair.
      const kr = k * 0.72, kt = Math.min(1.25, k * 1.12);
      o = ribbonPoint(out, o, c.rx, c.ry, c.cx - c.rx, c.cy - c.ry, w, r * kr, g * kr, b * kr, alpha);
      o = ribbonPoint(out, o, mx, my, c.tx - c.rx, c.ty - c.ry, w * 0.8, r * k, g * k, b * k, alpha * 0.9);
      o = ribbonPoint(out, o, c.tx, c.ty, c.tx - c.cx, c.ty - c.cy, w * 0.45, r * kt, g * kt, b * kt, alpha * 0.35);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, o), gl.STREAM_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.strandIbo);
    for (let first = 0; first < strands.length; first += CHUNK) {
      const n = Math.min(CHUNK, strands.length - first);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, FLOATS * 4, first * STRAND_VERTS * FLOATS * 4);
      gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, FLOATS * 4, first * STRAND_VERTS * FLOATS * 4 + 8);
      gl.drawElements(gl.TRIANGLES, n * STRAND_INDICES, gl.UNSIGNED_SHORT, 0);
    }
  }
}

/** Strands per draw call, so vertex indices stay below 65536. */
const CHUNK = 10000;

const tmp: Pt = { x: 0, y: 0 };
const curve: Curve = { rx: 0, ry: 0, cx: 0, cy: 0, tx: 0, ty: 0, far: 0 };

/** Writes the two side vertices of a ribbon at (x, y) heading along (dx, dy). */
function ribbonPoint(
  out: Float32Array, o: number, x: number, y: number, dx: number, dy: number,
  halfWidth: number, r: number, g: number, b: number, a: number,
) {
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * halfWidth, ny = (dx / l) * halfWidth;
  out[o++] = x - nx; out[o++] = y - ny;
  out[o++] = r * a; out[o++] = g * a; out[o++] = b * a; out[o++] = a;
  out[o++] = x + nx; out[o++] = y + ny;
  out[o++] = r * a; out[o++] = g * a; out[o++] = b * a; out[o++] = a;
  return o;
}
