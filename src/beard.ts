// Procedural beard renderer.
//
// The beard lives on a ring-shaped patch of the face: the inner edge follows the
// outer lip contour and the outer edge follows the jaw line, the sideburns and
// the cheek line under the nose. Every hair strand is anchored by (u, v) inside
// that ring, so as the face moves, turns or opens its mouth the strands follow
// the tracked landmarks with no 3D model needed.
//
//   u ∈ [0,1): position around the mouth. 0 = chin, 0.25 = one mouth corner,
//              0.5 = under the nose (mustache), 0.75 = other mouth corner.
//   v ∈ [0,1]: 0 = lip edge, 1 = jaw / cheek edge.

import type { BeardStyle } from './styles';

export type Pt = { x: number; y: number };

// Each ring is split into four matching segments so that the chin lines up with
// the chin, the mouth corners with the sideburns and the cupid's bow with the nose.
const OUTER_SEGMENTS = [
  [152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454],
  [454, 352, 425, 426, 391, 393, 164],
  [164, 167, 165, 206, 205, 123, 234],
  [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152],
];
const INNER_SEGMENTS = [
  [17, 314, 405, 321, 375, 291],
  [291, 409, 270, 269, 267, 0],
  [0, 37, 39, 40, 185, 61],
  [61, 146, 91, 181, 84, 17],
];

const SAMPLES_PER_SEGMENT = 24;
const RING_SAMPLES = SAMPLES_PER_SEGMENT * 4;

const NOSE_BRIDGE = 168;
const CHIN = 152;
const LEFT_EDGE = 234;
const RIGHT_EDGE = 454;

/** Canonical (front facing) positions of the landmarks the beard uses. Used to
 *  place strands evenly by area and to draw the style preview thumbnails. */
export const CANONICAL: Record<number, [number, number]> = {
  0: [0.0, 3.406], 1: [0.0, 1.127], 2: [0.0, 2.089], 10: [0.0, -8.262], 13: [0.0, 3.994], 14: [0.0, 4.542],
  17: [0.0, 5.365], 21: [-7.088, -5.435], 33: [-4.446, -2.664], 37: [-0.711, 3.329],
  39: [-1.432, 3.501], 40: [-1.915, 3.803], 54: [-6.279, -6.615], 58: [-6.72, 4.789],
  61: [-2.456, 4.343], 67: [-3.524, -8.006], 84: [-0.7, 5.292], 91: [-1.839, 4.829],
  93: [-7.542, 1.049], 103: [-5.133, -7.486], 109: [-1.891, -8.236], 123: [-6.338, 0.529],
  127: [-7.743, -2.365], 132: [-7.271, 2.891], 133: [-1.856, -2.585], 136: [-5.085, 7.179],
  145: [-3.177, -2.294], 146: [-2.196, 4.598], 148: [-1.293, 9.296], 149: [-3.211, 8.533],
  150: [-4.069, 7.993], 152: [0.0, 9.403], 159: [-3.177, -2.964], 162: [-7.556, -4.107],
  164: [0.0, 2.522], 165: [-1.776, 2.684], 167: [-0.731, 2.537], 168: [0.0, -3.271],
  172: [-5.941, 6.224], 176: [-2.309, 8.974], 181: [-1.325, 5.107], 185: [-2.285, 4.051],
  205: [-3.833, 1.537], 206: [-2.962, 2.274], 234: [-7.664, -0.673], 251: [7.088, -5.435],
  263: [4.446, -2.664], 267: [0.711, 3.329], 269: [1.432, 3.501], 270: [1.915, 3.803],
  284: [6.279, -6.615], 288: [6.72, 4.789], 291: [2.456, 4.343], 297: [3.524, -8.006],
  314: [0.7, 5.292], 321: [1.839, 4.829], 323: [7.542, 1.049], 332: [5.133, -7.486],
  338: [1.891, -8.236], 352: [6.338, 0.529], 356: [7.743, -2.365], 361: [7.271, 2.891],
  362: [1.856, -2.585], 365: [5.085, 7.179], 374: [3.177, -2.294], 375: [2.196, 4.598],
  377: [1.293, 9.296], 378: [3.211, 8.533], 379: [4.069, 7.993], 386: [3.177, -2.964],
  389: [7.556, -4.107], 391: [1.776, 2.684], 393: [0.731, 2.537], 397: [5.941, 6.224],
  400: [2.309, 8.974], 405: [1.325, 5.107], 409: [2.285, 4.051], 425: [3.833, 1.537],
  426: [2.962, 2.274], 454: [7.664, -0.673],
};

/** Outline of the face, used for the preview thumbnails. */
export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

type Landmarks = (i: number) => Pt;

/** Resample a polyline to `n` points spaced evenly by arc length (n ≥ 2). */
function resample(pts: Pt[], n: number, out: Pt[], offset: number) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[cum.length - 1] || 1;
  let seg = 1;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * total;
    while (seg < pts.length - 1 && cum[seg] < target) seg++;
    const a = pts[seg - 1], b = pts[seg];
    const span = cum[seg] - cum[seg - 1] || 1;
    const t = Math.min(1, Math.max(0, (target - cum[seg - 1]) / span));
    const o = out[offset + k];
    o.x = a.x + (b.x - a.x) * t;
    o.y = a.y + (b.y - a.y) * t;
  }
}

/** Screen-space beard ring for one frame. */
export class BeardFrame {
  inner: Pt[] = Array.from({ length: RING_SAMPLES }, () => ({ x: 0, y: 0 }));
  outer: Pt[] = Array.from({ length: RING_SAMPLES }, () => ({ x: 0, y: 0 }));
  down: Pt = { x: 0, y: 1 };
  right: Pt = { x: 1, y: 0 };
  center: Pt = { x: 0, y: 0 };
  scale = 1; // face width in pixels
  /** How much the head is turned: -1 (fully one way) … 1 (fully the other way). */
  yaw = 0;

  update(lm: Landmarks) {
    for (let s = 0; s < 4; s++) {
      resample(OUTER_SEGMENTS[s].map(lm), SAMPLES_PER_SEGMENT, this.outer, s * SAMPLES_PER_SEGMENT);
      resample(INNER_SEGMENTS[s].map(lm), SAMPLES_PER_SEGMENT, this.inner, s * SAMPLES_PER_SEGMENT);
    }
    const top = lm(NOSE_BRIDGE), chin = lm(CHIN), l = lm(LEFT_EDGE), r = lm(RIGHT_EDGE);
    const dl = Math.hypot(chin.x - top.x, chin.y - top.y) || 1;
    this.down = { x: (chin.x - top.x) / dl, y: (chin.y - top.y) / dl };
    const wl = Math.hypot(r.x - l.x, r.y - l.y) || 1;
    this.right = { x: (r.x - l.x) / wl, y: (r.y - l.y) / wl };
    // Width shrinks when the head turns, height does not: use the larger of the two.
    this.scale = Math.max(wl, dl * 1.25);
    const nose = lm(1);
    const mid = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
    this.yaw = Math.max(-1, Math.min(1, ((nose.x - mid.x) * this.right.x + (nose.y - mid.y) * this.right.y) / (wl * 0.35)));
    this.center = lm(13);
  }

  /** Point inside the ring. */
  at(u: number, v: number, out: Pt): Pt {
    const f = (((u % 1) + 1) % 1) * RING_SAMPLES;
    const i0 = Math.floor(f) % RING_SAMPLES, i1 = (i0 + 1) % RING_SAMPLES, t = f - Math.floor(f);
    const a = this.inner[i0], b = this.inner[i1], c = this.outer[i0], d = this.outer[i1];
    const ix = a.x + (b.x - a.x) * t, iy = a.y + (b.y - a.y) * t;
    const ox = c.x + (d.x - c.x) * t, oy = c.y + (d.y - c.y) * t;
    out.x = ix + (ox - ix) * v;
    out.y = iy + (oy - iy) * v;
    return out;
  }
}

export type Strand = {
  u: number;
  v: number;
  len: number; // fraction of face width
  curl: number; // signed bend, fraction of strand length
  angle: number; // radians of random tilt
  shade: number; // index into the shade buckets
};

/** Small deterministic PRNG so a style always looks the same. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Area of each (u, v) cell of the ring on the canonical face, used so that wide
 *  cheeks get as many hairs per square cm as the narrow mustache strip. */
const GRID_U = 96, GRID_V = 12;
const cellAreas: number[] = (() => {
  const f = new BeardFrame();
  f.update((i) => ({ x: CANONICAL[i][0], y: CANONICAL[i][1] }));
  const p = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
  const areas: number[] = [];
  for (let iu = 0; iu < GRID_U; iu++) {
    for (let iv = 0; iv < GRID_V; iv++) {
      f.at(iu / GRID_U, iv / GRID_V, p[0]);
      f.at((iu + 1) / GRID_U, iv / GRID_V, p[1]);
      f.at((iu + 1) / GRID_U, (iv + 1) / GRID_V, p[2]);
      f.at(iu / GRID_U, (iv + 1) / GRID_V, p[3]);
      let a = 0;
      for (let k = 0; k < 4; k++) {
        const q = p[k], r = p[(k + 1) % 4];
        a += q.x * r.y - r.x * q.y;
      }
      areas.push(Math.abs(a) / 2);
    }
  }
  return areas;
})();

export const SHADES = 4;

export function buildStrands(style: BeardStyle, density: number): Strand[] {
  const rand = rng(style.seed);
  const weights = cellAreas.map((a, k) => {
    const iu = Math.floor(k / GRID_V), iv = k % GRID_V;
    return a * style.mask((iu + 0.5) / GRID_U, (iv + 0.5) / GRID_V);
  });
  const total = weights.reduce((s, w) => s + w, 0);
  const count = Math.round(style.strands * density);
  const strands: Strand[] = [];
  if (total <= 0) return strands;
  // Systematic sampling over the cumulative weights gives an even spread.
  let acc = 0, k = 0;
  const step = total / count;
  let next = rand() * step;
  while (strands.length < count && k < weights.length) {
    if (acc + weights[k] < next) {
      acc += weights[k++];
      continue;
    }
    const iu = Math.floor(k / GRID_V), iv = k % GRID_V;
    const u = (iu + rand()) / GRID_U, v = (iv + rand()) / GRID_V;
    const m = style.mask(u, v);
    strands.push({
      u,
      v,
      len: style.length(u, v) * (0.6 + rand() * 0.6) * (0.55 + 0.45 * m),
      curl: (rand() - 0.5) * style.curl,
      angle: (rand() - 0.5) * 0.7,
      shade: Math.min(SHADES - 1, Math.floor(rand() * rand() * SHADES * 1.4)),
    });
    next += step;
  }
  // Draw roots first, outer and longer hairs last so they sit on top.
  strands.sort((a, b) => a.v - b.v);
  return strands;
}

/** Shades of the chosen colour as RGB 0..255: darker roots, base tone, lighter
 *  tips, highlights. */
export function shadeRGB(hex: string): [number, number, number][] {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (k: number, to: number): [number, number, number] =>
    [r + (to - r) * k, g + (to - g) * k, b + (to - b) * k];
  return [mix(0.3, 0), mix(0, 0), mix(0.18, 255), mix(0.38, 255)];
}

/** Opacity and width multipliers for each shade bucket. */
export const SHADE_ALPHA = [1, 1, 1, 0.7];
export const SHADE_WIDTH = [1.25, 1, 1, 0.7];

/** A strand on screen: a quadratic curve root → (control) → tip. */
export type Curve = { rx: number; ry: number; cx: number; cy: number; tx: number; ty: number };

const tmpA: Pt = { x: 0, y: 0 };
const tmpB: Pt = { x: 0, y: 0 };
const tmpC: Pt = { x: 0, y: 0 };

/** Where a strand lies in this frame. Hair grows mostly down the face, fanning
 *  outwards from the mouth and away from the centre line. */
export function strandCurve(frame: BeardFrame, st: Strand, lengthScale: number, out: Curve): Curve {
  const { down, right } = frame;
  const root = frame.at(st.u, st.v, tmpA);
  const outer = frame.at(st.u, 1, tmpB);
  const inner = frame.at(st.u, 0, tmpC);
  let ox = outer.x - inner.x, oy = outer.y - inner.y;
  const ol = Math.hypot(ox, oy) || 1;
  ox /= ol; oy /= ol;
  const side = (root.x - frame.center.x) * right.x + (root.y - frame.center.y) * right.y;
  const sideSign = Math.sign(side);
  const dx0 = down.x * 0.85 + ox * 0.35 + right.x * sideSign * 0.18;
  const dy0 = down.y * 0.85 + oy * 0.35 + right.y * sideSign * 0.18;
  const c = Math.cos(st.angle), sn = Math.sin(st.angle);
  const rx = dx0 * c - dy0 * sn, ry = dx0 * sn + dy0 * c;
  const dl = Math.hypot(rx, ry) || 1;
  const dx = rx / dl, dy = ry / dl;
  // When the head turns, hairs on the far cheek are seen side-on and look shorter.
  const far = Math.max(0, -sideSign * frame.yaw);
  const len = st.len * frame.scale * lengthScale * (1 - 0.45 * far);
  const bend = st.curl * len;
  out.rx = root.x;
  out.ry = root.y;
  out.tx = root.x + dx * len;
  out.ty = root.y + dy * len;
  out.cx = (out.rx + out.tx) / 2 - dy * bend;
  out.cy = (out.ry + out.ty) / 2 + dx * bend;
  return out;
}

/** The base layer is a grid over the ring; its corners as (u, v). */
export const BASE_STEPS_U = 72, BASE_STEPS_V = 8, BASE_V0 = 0.1;

const curve: Curve = { rx: 0, ry: 0, cx: 0, cy: 0, tx: 0, ty: 0 };

/** Paints the beard with Canvas 2D. Used for the style thumbnails and as a
 *  fallback on devices without WebGL (see beard-gl.ts for the fast path). */
export function drawBeard(
  ctx: CanvasRenderingContext2D,
  frame: BeardFrame,
  style: BeardStyle,
  strands: Strand[],
  color: string,
  lengthScale: number,
) {
  const shades = shadeRGB(color).map(([r, g, b]) => `rgb(${r | 0},${g | 0},${b | 0})`);

  // 1. Soft base layer so skin does not shine through between hairs.
  if (style.base > 0) {
    ctx.save();
    ctx.fillStyle = shades[0];
    const p = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
    const du = 1 / BASE_STEPS_U, dv = (1 - BASE_V0) / BASE_STEPS_V;
    for (const [lo, hi, alpha] of [[0.25, 0.6, 0.5], [0.6, 2, 1]] as const) {
      ctx.globalAlpha = style.base * alpha;
      ctx.beginPath();
      for (let i = 0; i < BASE_STEPS_U; i++) {
        for (let j = 0; j < BASE_STEPS_V; j++) {
          const u = i * du, v = BASE_V0 + j * dv;
          const m = style.mask(u + du / 2, v + dv / 2);
          if (m < lo || m >= hi) continue;
          frame.at(u, v, p[0]);
          frame.at(u + du, v, p[1]);
          frame.at(u + du, v + dv, p[2]);
          frame.at(u, v + dv, p[3]);
          ctx.moveTo(p[0].x, p[0].y);
          ctx.lineTo(p[1].x, p[1].y);
          ctx.lineTo(p[2].x, p[2].y);
          ctx.lineTo(p[3].x, p[3].y);
          ctx.closePath();
        }
      }
      ctx.fill('nonzero');
    }
    ctx.restore();
  }

  // 2. Hair strands, batched into one path per shade.
  ctx.save();
  ctx.lineCap = 'round';
  const widthBase = Math.max(0.6, frame.scale * style.thickness);
  for (let shade = 0; shade < SHADES; shade++) {
    ctx.beginPath();
    for (const st of strands) {
      if (st.shade !== shade) continue;
      const c = strandCurve(frame, st, lengthScale, curve);
      ctx.moveTo(c.rx, c.ry);
      ctx.quadraticCurveTo(c.cx, c.cy, c.tx, c.ty);
    }
    ctx.strokeStyle = shades[shade];
    ctx.globalAlpha = style.alpha * SHADE_ALPHA[shade];
    ctx.lineWidth = widthBase * SHADE_WIDTH[shade];
    ctx.stroke();
  }
  ctx.restore();
}
