import { canonicalAt } from './beard';

// Beard styles. Each style is a coverage mask over the beard ring (see beard.ts
// for what u and v mean) plus a few numbers that control the look of the hair.

export type BeardStyle = {
  id: string;
  name: string;
  seed: number;
  strands: number; // hair count at density 1
  /** Coverage 0..1 at (u, v). */
  mask: (u: number, v: number) => number;
  /** Hair length at (u, v), as a fraction of face width. */
  length: (u: number, v: number) => number;
  curl: number;
  thickness: number; // stroke width as a fraction of face width
  alpha: number;
  base: number; // opacity of the solid layer under the hairs
  /** Optional hair direction at (u, v): `side` sweeps hairs away from the centre
   *  line, `lift` raises them (negative lowers), `curl` > 0 curls tips upwards. */
  flow?: (u: number, v: number) => { side?: number; lift?: number; curl?: number };
};

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
/** Distance around the ring from the chin (0) to under the nose (0.5). */
const fromChin = (u: number) => {
  const w = ((u % 1) + 1) % 1;
  return Math.min(w, 1 - w);
};
/** Distance around the ring from the centre of the mustache. */
const fromNose = (u: number) => Math.abs(0.5 - fromChin(u));

/** Leaves a thin clean-shaven gap along the lips. */
const lipGap = (v: number, gap = 0.08) => smooth(gap, gap + 0.07, v);

const fullMask = (u: number, v: number) => {
  // Keep the upper cheeks tidy: near the sideburns (u≈0.25/0.75) the ring's outer
  // edge runs up to the ears, which is right; just fade the very edge.
  return lipGap(v) * (1 - 0.35 * smooth(0.93, 1.0, v) * smooth(0.3, 0.45, fromChin(u)));
};

const goateeMask = (u: number, v: number) =>
  lipGap(v, 0.06) * (1 - smooth(0.07, 0.11, fromChin(u))) * (1 - smooth(0.72, 0.85, v));

const mustacheMask = (u: number, v: number) =>
  lipGap(v, -0.04) * (1 - smooth(0.09, 0.13, fromNose(u))) * (1 - smooth(0.9, 1.0, v));

const ALL_STYLES: BeardStyle[] = [
  {
    id: 'stubble',
    name: 'Stubble',
    seed: 11,
    strands: 6000,
    mask: (u, v) => fullMask(u, v) * (1 - 0.6 * smooth(0.85, 1, v)),
    length: () => 0.009,
    curl: 0.2,
    thickness: 0.0026,
    alpha: 0.5,
    base: 0.24,
  },
  {
    id: 'short',
    name: 'Short',
    seed: 23,
    strands: 5200,
    mask: fullMask,
    length: (u, v) => 0.03 + 0.012 * v,
    curl: 0.35,
    thickness: 0.0034,
    alpha: 0.85,
    base: 0.42,
  },
  {
    id: 'full',
    name: 'Full',
    seed: 37,
    strands: 5600,
    mask: fullMask,
    // Longest at the chin, growing towards the jaw line.
    length: (u, v) => 0.045 + 0.09 * v * v * (1 - smooth(0.12, 0.3, fromChin(u))) + 0.03 * v,
    curl: 0.6,
    thickness: 0.0042,
    alpha: 0.9,
    base: 0.55,
  },
  {
    id: 'chin',
    name: 'Chin only',
    seed: 41,
    strands: 1800,
    mask: goateeMask,
    length: (u, v) => 0.035 + 0.05 * v,
    curl: 0.4,
    thickness: 0.0038,
    alpha: 0.9,
    base: 0.45,
  },
  {
    id: 'vandyke',
    name: 'Goatee + mustache',
    seed: 53,
    strands: 2600,
    mask: (u, v) => Math.max(goateeMask(u, v), mustacheMask(u, v)),
    length: (u, v) => (fromChin(u) < 0.2 ? 0.035 + 0.05 * v : 0.035),
    curl: 0.4,
    thickness: 0.0038,
    alpha: 0.9,
    base: 0.45,
  },
  {
    id: 'mustache',
    name: 'Mustache',
    seed: 67,
    strands: 1500,
    mask: mustacheMask,
    length: () => 0.05,
    curl: 0.3,
    thickness: 0.004,
    alpha: 0.92,
    base: 0.5,
  },
  {
    id: 'chinstrap',
    name: 'Chinstrap',
    seed: 79,
    strands: 2400,
    mask: (u, v) => smooth(0.62, 0.72, v) * (1 - smooth(0.36, 0.42, fromChin(u))),
    length: () => 0.03,
    curl: 0.3,
    thickness: 0.0036,
    alpha: 0.88,
    base: 0.4,
  },
  {
    id: 'long',
    name: 'Long beard',
    seed: 83,
    strands: 6400,
    mask: fullMask,
    // Grows well below the chin, tapering off along the jaw.
    length: (u, v) => 0.05 + 0.24 * v * v * (1 - smooth(0.08, 0.32, fromChin(u))) + 0.03 * v,
    curl: 0.55,
    thickness: 0.0044,
    alpha: 0.9,
    base: 0.55,
    flow: (u) => ({ side: -0.12 * (1 - smooth(0.05, 0.25, fromChin(u))) }),
  },
  {
    id: 'chinbeard',
    name: 'Chin beard',
    seed: 97,
    strands: 2800,
    // Covers the chin and runs under the jaw, no mustache.
    mask: (u, v) => lipGap(v, 0.2) * (1 - smooth(0.13, 0.18, fromChin(u))),
    length: (u, v) => 0.04 + 0.1 * v * (1 - smooth(0.04, 0.16, fromChin(u))),
    curl: 0.45,
    thickness: 0.004,
    alpha: 0.9,
    base: 0.5,
    flow: () => ({ side: -0.1 }),
  },
  {
    id: 'handlebar',
    name: 'Handlebar',
    seed: 101,
    strands: 1900,
    mask: (u, v) => lipGap(v, -0.04) * (1 - smooth(0.13, 0.17, fromNose(u))) * (1 - smooth(0.9, 1.0, v)),
    // Short in the middle, long sweeping ends that curl up.
    length: (u) => 0.035 + 0.11 * smooth(0.04, 0.15, fromNose(u)),
    curl: 0.15,
    thickness: 0.0042,
    alpha: 0.94,
    base: 0.5,
    flow: (u) => {
      const end = smooth(0.05, 0.14, fromNose(u));
      return { side: 1.1 * end, lift: 0.6 * end, curl: 0.55 * end };
    },
  },
  {
    id: 'pirate',
    name: 'Pirate',
    seed: 113,
    strands: 2800,
    // A long droopy mustache that hangs past the mouth plus a long pointed chin tuft.
    mask: (u, v) =>
      Math.max(
        lipGap(v, -0.04) * (1 - smooth(0.13, 0.17, fromNose(u))) * (1 - smooth(0.9, 1.0, v)),
        lipGap(v, 0.15) * (1 - smooth(0.05, 0.08, fromChin(u))),
      ),
    length: (u, v) =>
      fromNose(u) < 0.2
        ? 0.04 + 0.1 * smooth(0.05, 0.15, fromNose(u))
        : 0.06 + 0.2 * v * (1 - smooth(0.0, 0.07, fromChin(u))),
    curl: 0.35,
    thickness: 0.0042,
    alpha: 0.93,
    base: 0.5,
    flow: (u) => {
      if (fromNose(u) < 0.2) return { side: 0.25, lift: -0.15, curl: -0.25 * smooth(0.06, 0.15, fromNose(u)) };
      return { side: -0.18 };
    },
  },
  {
    id: 'horseshoe',
    name: 'Horseshoe',
    seed: 127,
    strands: 2600,
    // Mustache with two bars running down past the mouth to the jaw.
    mask: (u, v) =>
      Math.max(
        mustacheMask(u, v),
        // Bars hang straight down from the mouth corners to the jaw line.
        (() => {
          const p = canonicalAt(u, v);
          const ax = Math.abs(p.x);
          return lipGap(v, -0.02) * smooth(1.9, 2.2, ax) * (1 - smooth(3.0, 3.4, ax)) * smooth(3.2, 3.8, p.y);
        })(),
      ),
    length: () => 0.04,
    curl: 0.3,
    thickness: 0.0042,
    alpha: 0.92,
    base: 0.5,
  },
  {
    id: 'muttonchops',
    name: 'Mutton chops',
    seed: 131,
    strands: 3400,
    // Big sideburns down the cheeks to the jaw, chin and lip shaved.
    mask: (u, v) =>
      smooth(0.35, 0.5, v) * smooth(0.15, 0.2, fromChin(u)) * (1 - smooth(0.4, 0.44, fromChin(u))),
    length: (u, v) => 0.035 + 0.02 * v,
    curl: 0.45,
    thickness: 0.004,
    alpha: 0.9,
    base: 0.5,
  },
];

const ORDER = [
  'stubble', 'short', 'full', 'long', 'chin', 'chinbeard', 'vandyke',
  'mustache', 'handlebar', 'pirate', 'horseshoe', 'muttonchops', 'chinstrap',
];
export const STYLES: BeardStyle[] = ORDER.map((id) => ALL_STYLES.find((s) => s.id === id)!);

export const COLORS: { name: string; hex: string }[] = [
  { name: 'Black', hex: '#1c1612' },
  { name: 'Dark brown', hex: '#3d2718' },
  { name: 'Brown', hex: '#6b4429' },
  { name: 'Light brown', hex: '#94683f' },
  { name: 'Blonde', hex: '#c9a467' },
  { name: 'Ginger', hex: '#a9512b' },
  { name: 'Gray', hex: '#8e8b87' },
  { name: 'White', hex: '#e8e4dc' },
  { name: 'Blue', hex: '#2f6fd6' },
  { name: 'Pink', hex: '#e0569b' },
];
