// Shared colours and small canvas helpers for the renderer.

/** Render team: 0 = the viewer's units (cool blue/teal), 1 = enemy (warm red/orange). */
export type Team = 0 | 1;

export interface TeamPal {
  body: string;
  light: string;
  dark: string;
  deep: string;
  accent: string;
  glow: string;
  /** rgb triple of glow for rgba() strings */
  glowRgb: string;
  bar: string;
  /** bright outer rim / underglow colour (unit silhouette halo, markers) */
  rim: string;
}

// Friendly = bright cyan-blue (high luminance), enemy = saturated red-orange (lower luminance, warm hue): they differ
// in hue AND lightness, and the unit overlay adds a shape cue (circle vs diamond marker) for colour-blind viewers.
export const TEAM_PAL: [TeamPal, TeamPal] = [
  { body: '#3f8fc4', light: '#9fdcf8', dark: '#255a82', deep: '#122c42', accent: '#55f2ff', glow: '#9af6ff', glowRgb: '154,246,255', bar: '#4fe3d0', rim: '#46dcff' },
  { body: '#c2452b', light: '#f58a5a', dark: '#6a2216', deep: '#34100a', accent: '#ffb23e', glow: '#ffb27a', glowRgb: '255,170,110', bar: '#ff5a3a', rim: '#ff4a22' },
];

export const METAL = { base: '#545b62', light: '#8c959e', dark: '#2b3035', deep: '#16191c', rubber: '#1d1f21', rubberHi: '#3a3e42' };
export const OUTLINE = '#0b0d0f';

export type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): Ctx {
  const g = c.getContext('2d');
  if (!g) throw new Error('2d context unavailable');
  return g;
}

const hexRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const shade = (h: string, k: number) => {
  const [r, g, b] = hexRgb(h);
  return k >= 0 ? toHex(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k) : toHex(r * (1 + k), g * (1 + k), b * (1 + k));
};
export const rgba = (h: string, a: number) => {
  const [r, g, b] = hexRgb(h);
  return `rgba(${r},${g},${b},${a})`;
};
export const mix = (a: string, b: string, t: number) => {
  const [r1, g1, b1] = hexRgb(a);
  const [r2, g2, b2] = hexRgb(b);
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
};

export function roundRect(g: Ctx | Path2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.arcTo(x + w, y, x + w, y + r, r);
  g.lineTo(x + w, y + h - r);
  g.arcTo(x + w, y + h, x + w - r, y + h, r);
  g.lineTo(x + r, y + h);
  g.arcTo(x, y + h, x, y + h - r, r);
  g.lineTo(x, y + r);
  g.arcTo(x, y, x + r, y, r);
  g.closePath();
}

export function poly(g: Ctx | Path2D, pts: number[], s = 1): void {
  g.moveTo(pts[0] * s, pts[1] * s);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] * s, pts[i + 1] * s);
  g.closePath();
}

/** Mirror a half-outline (points with y <= 0, listed nose-to-tail) into a closed symmetric polygon. */
export function mirrorPoly(half: number[]): number[] {
  const out = half.slice();
  for (let i = half.length - 2; i >= 0; i -= 2) {
    if (Math.abs(half[i + 1]) < 1e-6) continue;
    out.push(half[i], -half[i + 1]);
  }
  return out;
}

/** Soft radial dot sprites, cached by colour. Used for glows, smoke and fire. */
const dotCache = new Map<string, HTMLCanvasElement>();
export function softDot(color: string, hard = 0): HTMLCanvasElement {
  const key = color + '|' + hard;
  let c = dotCache.get(key);
  if (c) return c;
  c = makeCanvas(64, 64);
  const g = ctx2d(c);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, color);
  gr.addColorStop(Math.min(0.9, 0.15 + hard), color);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  dotCache.set(key, c);
  return c;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
/** Small deterministic hash -> [0,1) for stable per-unit variation. */
export function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
