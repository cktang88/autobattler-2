// Procedural battlefield terrain. Three themed maps (desert basin, grassland, frozen steppe) built from layered value
// noise (fbm) for the broad colour field plus deterministic per-cell scatter (rocks, tufts, cracks, drifts) for detail.
//
// Everything is a pure function of world position + map seed, so any world rectangle can be painted at any resolution
// and it lines up with every other rectangle: the full-field canvas, the hi-res patch drawn when zoomed in, and the
// darkened surround outside the field all agree. Kept low-contrast and mid-dark so units (and their team glows) pop.

import { DEPLOY_D, FIELD_H, FIELD_W, fieldKey } from '../../shared/grid.ts';
import { ctx2d, makeCanvas, type Ctx } from './palette.ts';

export type MapId = 'basin' | 'plains' | 'steppe';

type RGB = [number, number, number];

export interface MapTheme {
  id: MapId;
  name: string;
  blurb: string;
  /** broad colour ramp: low -> mid -> high noise */
  ramp: [RGB, RGB, RGB];
  /** secondary patch colour (darker dirt / grass clumps / ice) blended where the patch noise is high */
  patch: RGB;
  patchAmt: number;
  /** grid line tint (r,g,b) */
  grid: RGB;
  /** colour used for the far surround beyond the field edge */
  void: string;
  seed: number;
}

export const MAPS: MapTheme[] = [
  {
    id: 'basin', name: 'Dust Basin', blurb: 'Sun-baked sand and cracked hardpan', seed: 11,
    ramp: [[96, 74, 52], [128, 100, 68], [150, 121, 84]], patch: [92, 70, 52], patchAmt: 0.45,
    grid: [255, 236, 200], void: '#1d1712',
  },
  {
    id: 'plains', name: 'Verdant Plains', blurb: 'Rolling grassland and dirt tracks', seed: 23,
    ramp: [[52, 72, 44], [70, 94, 54], [92, 112, 64]], patch: [96, 84, 58], patchAmt: 0.5,
    grid: [225, 245, 210], void: '#121810',
  },
  {
    id: 'steppe', name: 'Frost Steppe', blurb: 'Wind-scoured snow over dark rock', seed: 37,
    ramp: [[72, 82, 94], [96, 108, 120], [118, 130, 142]], patch: [64, 72, 84], patchAmt: 0.35,
    grid: [235, 245, 255], void: '#10141a',
  },
];

export const MAP_BY_ID = new Map(MAPS.map((m) => [m.id, m] as const));
/** Maps rotate every round. */
export const mapForRound = (round: number): MapTheme => MAPS[((Math.max(1, round) - 1) % MAPS.length + MAPS.length) % MAPS.length];

// ------------------------------------------------------------------------------------------------ noise

function hash2(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}
function fbm(x: number, y: number, s: number, oct = 4): number {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { v += amp * vnoise(x * f, y * f, s + i * 101); norm += amp; amp *= 0.5; f *= 2.03; }
  return v / norm;
}
const mixC = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Broad terrain colour at a world point (cells). */
function colorAt(th: MapTheme, x: number, y: number): RGB {
  const s = th.seed;
  // warp the domain a little so features don't look grid-aligned
  const wx = x + (fbm(x * 0.05, y * 0.05, s + 7, 2) - 0.5) * 6;
  const wy = y + (fbm(x * 0.05, y * 0.05, s + 9, 2) - 0.5) * 6;
  const n = fbm(wx * 0.07, wy * 0.07, s, 4);
  let c = n < 0.5 ? mixC(th.ramp[0], th.ramp[1], clamp01(n * 2)) : mixC(th.ramp[1], th.ramp[2], clamp01((n - 0.5) * 2));
  const p = fbm(wx * 0.16 + 40, wy * 0.16, s + 3, 3);
  const pt = clamp01((p - 0.55) * 4) * th.patchAmt;
  if (pt > 0) c = mixC(c, th.patch, pt);
  if (th.id === 'basin') {
    // wind ripples in the sand, fading out over hardpan patches
    const r = Math.sin((wx * 0.86 + wy * 0.5) * 2.4 + fbm(wx * 0.2, wy * 0.2, s + 5, 2) * 7);
    const k = (1 - pt * 1.6) * 0.06;
    c = mixC(c, r > 0 ? [168, 138, 98] : [86, 66, 48], Math.max(0, k * Math.abs(r)));
  } else if (th.id === 'plains') {
    // lighter sun-lit meadows and a meandering dirt track
    const m = fbm(wx * 0.03, wy * 0.03, s + 11, 3);
    c = mixC(c, [104, 124, 70], clamp01((m - 0.6) * 2.2) * 0.5);
    const track = Math.abs(Math.sin(wy * 0.09 + fbm(wx * 0.04, wy * 0.04, s + 13, 2) * 5) * 14 - (wx - FIELD_W * 0.62) * 0.35);
    if (track < 1.1) c = mixC(c, [104, 90, 64], (1 - track / 1.1) * 0.55);
  } else {
    // exposed dark rock where the snow is thin; streaks blown along the wind
    // exposed rock: a hard-edged threshold (not a soft blur) so it reads as ground, not smoke
    const rock = fbm(wx * 0.11, wy * 0.11, s + 17, 5);
    c = mixC(c, [50, 56, 64], clamp01((rock - 0.64) * 9) * 0.8);
    const streak = fbm(wx * 0.04, wy * 0.6, s + 19, 3);
    c = mixC(c, [138, 150, 162], clamp01((streak - 0.6) * 2.5) * 0.4);
  }
  return c;
}

// ------------------------------------------------------------------------------------------------ painting

/** painted base resolution (texels per cell); the broad field is smooth, so it is upscaled with smoothing */
const BASE_RES = 6;

function paintBase(g: Ctx, th: MapTheme, x0: number, y0: number, x1: number, y1: number, cw: number, ch: number): void {
  const sw = Math.max(2, Math.ceil((x1 - x0) * BASE_RES)), sh = Math.max(2, Math.ceil((y1 - y0) * BASE_RES));
  const small = makeCanvas(sw, sh);
  const sg = ctx2d(small);
  const im = sg.createImageData(sw, sh);
  const sx = (x1 - x0) / sw, sy = (y1 - y0) / sh;
  for (let j = 0; j < sh; j++) {
    const wy = y0 + (j + 0.5) * sy;
    for (let i = 0; i < sw; i++) {
      const c = colorAt(th, x0 + (i + 0.5) * sx, wy);
      const o = (j * sw + i) * 4;
      im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = 255;
    }
  }
  sg.putImageData(im, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(small, 0, 0, cw, ch);
}

let grainTile: HTMLCanvasElement | null = null;
/** fine monochrome grain, tiled in screen space for texture at any zoom */
function grain(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const n = 128;
  grainTile = makeCanvas(n, n);
  const g = ctx2d(grainTile);
  const im = g.createImageData(n, n);
  let s = 12345;
  for (let i = 0; i < n * n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = (s >> 8) & 255;
    const k = v > 128 ? 255 : 0;
    im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = k;
    im.data[i * 4 + 3] = Math.abs(v - 128) * 0.16;
  }
  g.putImageData(im, 0, 0);
  return grainTile;
}

/** Per-cell scatter: a deterministic handful of small features, so every region paints identically. */
function paintScatter(g: Ctx, th: MapTheme, x0: number, y0: number, x1: number, y1: number, px: number): void {
  const s = th.seed;
  const cx0 = Math.floor(x0) - 1, cy0 = Math.floor(y0) - 1, cx1 = Math.ceil(x1) + 1, cy1 = Math.ceil(y1) + 1;
  const lw = 1 / px;
  for (let cy = cy0; cy < cy1; cy++) for (let cx = cx0; cx < cx1; cx++) {
    const r = (k: number) => hash2(cx, cy, s * 31 + k);
    if (th.id === 'basin') {
      // pebbles + the odd boulder, sun-lit top edge and a shadow
      if (r(1) < 0.22) {
        const x = cx + r(2), y = cy + r(3), rr = 0.04 + r(4) * 0.07 + (r(5) < 0.06 ? 0.22 : 0);
        g.fillStyle = 'rgba(30,20,12,0.28)';
        g.beginPath(); g.ellipse(x + rr * 0.35, y + rr * 0.3, rr, rr * 0.8, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = `rgba(${120 + r(6) * 40 | 0},${96 + r(6) * 30 | 0},${70 + r(6) * 20 | 0},0.9)`;
        g.beginPath(); g.ellipse(x, y, rr, rr * 0.8, r(7) * 3, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,230,190,0.18)';
        g.beginPath(); g.ellipse(x - rr * 0.25, y - rr * 0.25, rr * 0.45, rr * 0.3, 0, 0, Math.PI * 2); g.fill();
      }
      // hardpan cracks in the darker patches
      if (r(8) < 0.018 && fbm(cx * 0.16 + 40, cy * 0.16, s + 3, 3) > 0.58) {
        g.strokeStyle = 'rgba(40,26,16,0.28)';
        g.lineWidth = lw * 0.9;
        let x = cx + r(9), y = cy + r(10), a = r(11) * 6.28;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 5; k++) { a += (r(12 + k) - 0.5) * 0.7; x += Math.cos(a) * 0.3; y += Math.sin(a) * 0.3; g.lineTo(x, y); }
        g.stroke();
      }
    } else if (th.id === 'plains') {
      // grass tufts: a few short blades, darker base, sunlit tips
      if (r(1) < 0.32) {
        const n = 2 + (r(2) * 2 | 0);
        for (let k = 0; k < n; k++) {
          const x = cx + r(10 + k), y = cy + r(20 + k), h = 0.12 + r(30 + k) * 0.14;
          g.strokeStyle = r(40 + k) < 0.5 ? 'rgba(36,56,28,0.55)' : 'rgba(120,150,80,0.45)';
          g.lineWidth = lw * 1.3;
          g.beginPath();
          for (let b = -1; b <= 1; b++) { g.moveTo(x, y); g.lineTo(x + b * h * 0.4, y - h); }
          g.stroke();
        }
      }
      // rare wildflowers and stones
      if (r(3) < 0.035) {
        g.fillStyle = r(4) < 0.5 ? 'rgba(232,214,110,0.75)' : 'rgba(220,170,210,0.7)';
        for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(cx + r(50 + k), cy + r(60 + k), 0.035, 0, Math.PI * 2); g.fill(); }
      }
      if (r(5) < 0.03) {
        const x = cx + r(6), y = cy + r(7), rr = 0.08 + r(8) * 0.12;
        g.fillStyle = 'rgba(20,24,16,0.3)';
        g.beginPath(); g.ellipse(x + rr * 0.3, y + rr * 0.3, rr, rr * 0.75, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(130,134,120,0.9)';
        g.beginPath(); g.ellipse(x, y, rr, rr * 0.75, r(9) * 3, 0, Math.PI * 2); g.fill();
      }
    } else {
      // snow: drifts (soft bright crescents), dark rock chips where it is thin, ice glints
      if (r(1) < 0.12) {
        const x = cx + r(2), y = cy + r(3), w = 0.3 + r(4) * 0.5;
        g.strokeStyle = 'rgba(200,212,226,0.2)';
        g.lineWidth = lw * 2.2;
        g.beginPath(); g.ellipse(x, y, w, w * 0.28, -0.35, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
        g.strokeStyle = 'rgba(60,70,84,0.16)';
        g.lineWidth = lw * 1.4;
        g.beginPath(); g.ellipse(x, y + 0.05, w, w * 0.28, -0.35, Math.PI * 0.1, Math.PI * 0.9); g.stroke();
      }
      if (r(5) < 0.16 && fbm(cx * 0.11, cy * 0.11, s + 17, 5) > 0.6) {
        const x = cx + r(6), y = cy + r(7), rr = 0.05 + r(8) * 0.1;
        g.fillStyle = 'rgba(40,46,56,0.85)';
        g.beginPath();
        g.moveTo(x - rr, y); g.lineTo(x - rr * 0.2, y - rr * 0.9); g.lineTo(x + rr, y - rr * 0.2); g.lineTo(x + rr * 0.5, y + rr * 0.7);
        g.closePath(); g.fill();
        g.fillStyle = 'rgba(230,240,250,0.35)';
        g.beginPath(); g.moveTo(x - rr * 0.8, y - rr * 0.1); g.lineTo(x - rr * 0.2, y - rr * 0.8); g.lineTo(x + rr * 0.3, y - rr * 0.4); g.closePath(); g.fill();
      }
      if (r(9) < 0.04) {
        g.fillStyle = 'rgba(210,235,255,0.5)';
        g.beginPath(); g.arc(cx + r(10), cy + r(11), 0.025, 0, Math.PI * 2); g.fill();
      }
    }
  }
}

/** Faint 5 m / 25 m survey grid and the no-man's-land midline, tinted for the map. */
function paintGrid(g: Ctx, th: MapTheme, x0: number, y0: number, x1: number, y1: number, px: number): void {
  const lw = 1 / px;
  const [r, gg, b] = th.grid;
  const ix0 = Math.max(1, Math.ceil(x0)), ix1 = Math.min(FIELD_W - 1, Math.floor(x1));
  const iy0 = Math.max(1, Math.ceil(y0)), iy1 = Math.min(FIELD_H - 1, Math.floor(y1));
  g.lineWidth = lw;
  g.strokeStyle = `rgba(${r},${gg},${b},0.05)`;
  g.beginPath();
  for (let x = ix0; x <= ix1; x++) if (x % 5) { g.moveTo(x, Math.max(0, y0)); g.lineTo(x, Math.min(FIELD_H, y1)); }
  for (let y = iy0; y <= iy1; y++) if (y % 5) { g.moveTo(Math.max(0, x0), y); g.lineTo(Math.min(FIELD_W, x1), y); }
  g.stroke();
  g.strokeStyle = `rgba(${r},${gg},${b},0.11)`;
  g.lineWidth = lw * 1.4;
  g.beginPath();
  for (let x = Math.ceil(ix0 / 5) * 5; x <= ix1; x += 5) { g.moveTo(x, Math.max(0, y0)); g.lineTo(x, Math.min(FIELD_H, y1)); }
  for (let y = Math.ceil(iy0 / 5) * 5; y <= iy1; y += 5) { g.moveTo(Math.max(0, x0), y); g.lineTo(Math.min(FIELD_W, x1), y); }
  g.stroke();
  const mid = FIELD_H / 2;
  if (mid >= y0 && mid <= y1) {
    g.strokeStyle = `rgba(${r},${gg},${b},0.12)`;
    g.lineWidth = lw * 2;
    g.setLineDash([0.4, 0.4]);
    g.beginPath(); g.moveTo(Math.max(0, x0), mid); g.lineTo(Math.min(FIELD_W, x1), mid); g.stroke();
    g.setLineDash([]);
  }
}

/** Paint world rect [x0,x1]x[y0,y1] (cells) into g at px device px per cell. */
function paint(g: Ctx, th: MapTheme, px: number, x0: number, y0: number, x1: number, y1: number, cw: number, ch: number, grid = true): void {
  paintBase(g, th, x0, y0, x1, y1, cw, ch);
  g.setTransform(1, 0, 0, 1, 0, 0);
  const pat = g.createPattern(grain(), 'repeat');
  if (pat) { g.fillStyle = pat; g.globalAlpha = th.id === 'steppe' ? 0.08 : 0.12; g.fillRect(0, 0, cw, ch); g.globalAlpha = 1; }
  g.setTransform(px, 0, 0, px, -x0 * px, -y0 * px);
  if (px >= 6) paintScatter(g, th, x0, y0, x1, y1, px);
  // a soft darkening toward both back lines so the deploy zones read as "home ground"
  for (const [ya, yb] of [[0, DEPLOY_D], [FIELD_H - DEPLOY_D, FIELD_H]]) {
    const gr = g.createLinearGradient(0, ya === 0 ? 0 : FIELD_H, 0, ya === 0 ? yb : ya);
    gr.addColorStop(0, 'rgba(0,0,0,0.12)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(Math.max(0, x0), ya, Math.min(FIELD_W, x1) - Math.max(0, x0), yb - ya);
  }
  if (grid) paintGrid(g, th, x0, y0, x1, y1, px);
  g.setTransform(1, 0, 0, 1, 0, 0);
}

const cache = new Map<string, HTMLCanvasElement>();
const cached = (key: string, make: () => HTMLCanvasElement) => {
  let c = cache.get(key);
  if (!c) { if (cache.size > 8) cache.clear(); c = make(); cache.set(key, c); }
  return c;
};

/** Whole field at px per cell. */
export function groundCanvas(px: number, map: MapTheme = MAPS[0]): HTMLCanvasElement {
  px = Math.max(4, Math.round(px));
  return cached(`${map.id}:${px}:${fieldKey()}`, () => {
    const c = makeCanvas(FIELD_W * px, FIELD_H * px);
    paint(ctx2d(c), map, px, 0, 0, FIELD_W, FIELD_H, c.width, c.height);
    return c;
  });
}

/** Hi-res ground for just the world rect [x0,x1]x[y0,y1] (cells); lines up exactly with groundCanvas. */
export function groundRegion(px: number, x0: number, y0: number, x1: number, y1: number, map: MapTheme = MAPS[0]): HTMLCanvasElement {
  const c = makeCanvas(Math.max(1, Math.ceil((x1 - x0) * px)), Math.max(1, Math.ceil((y1 - y0) * px)));
  paint(ctx2d(c), map, px, x0, y0, x1, y1, c.width, c.height);
  return c;
}

/** The land beyond the field edge (cells x0..x1, y0..y1), darkened, no grid: the board sits in a landscape. */
export const SURROUND = 16;
export function surroundCanvas(map: MapTheme = MAPS[0]): HTMLCanvasElement {
  return cached(`${map.id}:surround:${fieldKey()}`, () => {
    const px = 6;
    const x0 = -SURROUND, y0 = -SURROUND, x1 = FIELD_W + SURROUND, y1 = FIELD_H + SURROUND;
    const c = makeCanvas((x1 - x0) * px, (y1 - y0) * px);
    const g = ctx2d(c);
    paint(g, map, px, x0, y0, x1, y1, c.width, c.height, false);
    // fade into the void with distance from the field
    g.setTransform(px, 0, 0, px, -x0 * px, -y0 * px);
    g.fillStyle = 'rgba(0,0,0,0.42)';
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    const cx = FIELD_W / 2, cy = FIELD_H / 2, R = Math.hypot(FIELD_W, FIELD_H) / 2;
    const gr = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R + SURROUND * 1.2);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, map.void);
    g.fillStyle = gr;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    return c;
  });
}
