// Cached procedural sprites for battlefield effects: bloom glows, turbulent fireballs (white -> yellow -> orange -> red),
// smoke puffs, muzzle cones, lens stars and ground shock rings. Everything is drawn once into a small canvas and blitted
// (no per-frame gradients, no shadowBlur, no filters).

import { makeCanvas, ctx2d } from './palette.ts';

/** deterministic tiny rng for sprite construction */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function parseRgb(c: string): [number, number, number] {
  if (c[0] === '#') {
    if (c.length === 4) return [parseInt(c[1] + c[1], 16), parseInt(c[2] + c[2], 16), parseInt(c[3] + c[3], 16)];
    return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  }
  const m = /(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c);
  return m ? [+m[1], +m[2], +m[3]] : [255, 255, 255];
}

const mixCache = new Map<string, string>();
/** colour a -> b by f (0..1), as '#rrggbb' (cached) */
export function mixHex(a: string, b: string, f: number): string {
  const key = a + b + Math.round(f * 20);
  let r = mixCache.get(key);
  if (r) return r;
  const A = parseRgb(a), B = parseRgb(b);
  const h = (i: number) => Math.round(A[i] + (B[i] - A[i]) * f).toString(16).padStart(2, '0');
  r = '#' + h(0) + h(1) + h(2);
  mixCache.set(key, r);
  return r;
}

const glowCache = new Map<string, HTMLCanvasElement>();
/** Bloom: bright centre with a long soft tail (reads as light, not as a flat disc). */
export function glowTex(color: string): HTMLCanvasElement {
  let c = glowCache.get(color);
  if (c) return c;
  c = makeCanvas(64, 64);
  const g = ctx2d(c);
  const [r, gg, b] = parseRgb(color);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${r},${gg},${b},1)`);
  gr.addColorStop(0.18, `rgba(${r},${gg},${b},0.62)`);
  gr.addColorStop(0.45, `rgba(${r},${gg},${b},0.2)`);
  gr.addColorStop(0.75, `rgba(${r},${gg},${b},0.05)`);
  gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(color, c);
  return c;
}

/** Fire temperature stages: 0 white-hot, 1 yellow, 2 orange, 3 deep red. */
const STAGE_RGB: [number, number, number][] = [[255, 250, 225], [255, 214, 112], [255, 128, 40], [176, 44, 14]];
const fireCache: HTMLCanvasElement[] = [];
export const FIRE_VARIANTS = 4;
/** turbulent fireball blob with a lumpy edge */
export function fireTex(stage: number, variant: number): HTMLCanvasElement {
  const key = stage * FIRE_VARIANTS + (variant % FIRE_VARIANTS);
  let c = fireCache[key];
  if (c) return c;
  c = makeCanvas(96, 96);
  const g = ctx2d(c);
  const R = rng(1000 + key * 77);
  const [r, gg, b] = STAGE_RGB[stage];
  const lobes = 11;
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + R() * 0.5;
    const d = 14 + R() * 16;
    const x = 48 + Math.cos(a) * d, y = 48 + Math.sin(a) * d;
    const rad = 13 + R() * 11;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${r},${gg},${b},0.9)`);
    gr.addColorStop(0.62, `rgba(${r},${gg},${b},0.62)`);
    gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 96, 96);
  }
  const gr = g.createRadialGradient(48, 48, 0, 48, 48, 26);
  gr.addColorStop(0, `rgba(${r},${gg},${b},0.9)`);
  gr.addColorStop(0.6, `rgba(${r},${gg},${b},0.4)`);
  gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 96, 96);
  fireCache[key] = c;
  return c;
}

const puffCache = new Map<string, HTMLCanvasElement>();
/** soft lumpy smoke / dust puff, lit from the top-left (lighter) to the bottom-right (darker) */
export function puffTex(color: string, variant: number): HTMLCanvasElement {
  const key = color + '|' + (variant & 3);
  let c = puffCache.get(key);
  if (c) return c;
  c = makeCanvas(96, 96);
  const g = ctx2d(c);
  const R = rng(55 + (variant & 3) * 131);
  const [r, gg, b] = parseRgb(color);
  const lit = (k: number) => `rgb(${Math.min(255, Math.round(r * k))},${Math.min(255, Math.round(gg * k))},${Math.min(255, Math.round(b * k))})`;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + R();
    const d = 8 + R() * 18;
    const x = 48 + Math.cos(a) * d, y = 48 + Math.sin(a) * d;
    const rad = 18 + R() * 14;
    const gr = g.createRadialGradient(x - rad * 0.25, y - rad * 0.3, 0, x, y, rad);
    gr.addColorStop(0, lit(1.25) .replace('rgb', 'rgba').replace(')', ',0.7)'));
    gr.addColorStop(0.6, lit(0.9).replace('rgb', 'rgba').replace(')', ',0.4)'));
    gr.addColorStop(1, lit(0.7).replace('rgb', 'rgba').replace(')', ',0)'));
    g.fillStyle = gr;
    g.fillRect(0, 0, 96, 96);
  }
  puffCache.set(key, c);
  return c;
}

const coneCache = new Map<string, HTMLCanvasElement>();
/** directional muzzle flash: bright root at the left edge flaring to a soft forward lobe (draw rotated, length along +x) */
export function coneTex(color: string): HTMLCanvasElement {
  let c = coneCache.get(color);
  if (c) return c;
  c = makeCanvas(128, 64);
  const g = ctx2d(c);
  const [r, gg, b] = parseRgb(color);
  g.save();
  g.translate(8, 32);
  g.scale(1, 0.34);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 118);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.12, `rgba(255,248,225,0.95)`);
  gr.addColorStop(0.4, `rgba(${r},${gg},${b},0.55)`);
  gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, 118, -Math.PI / 2, Math.PI / 2);
  g.closePath();
  g.fill();
  g.restore();
  coneCache.set(color, c);
  return c;
}

const starCache = new Map<string, HTMLCanvasElement>();
/** lens star: soft bloom with a horizontal and a vertical streak */
export function starTex(color: string): HTMLCanvasElement {
  let c = starCache.get(color);
  if (c) return c;
  c = makeCanvas(128, 128);
  const g = ctx2d(c);
  const [r, gg, b] = parseRgb(color);
  g.drawImage(glowTex(color), 24, 24, 80, 80);
  for (const rot of [0, Math.PI / 2]) {
    g.save();
    g.translate(64, 64);
    g.rotate(rot);
    g.scale(1, 0.06);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.3, `rgba(${r},${gg},${b},0.5)`);
    gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = gr;
    g.fillRect(-64, -64, 128, 128);
    g.restore();
  }
  starCache.set(color, c);
  return c;
}

const ringCache = new Map<string, HTMLCanvasElement>();
/** shock ring: thin bright leading edge with a soft inner trail (r = 1 at the edge of the sprite) */
export function ringTex(color: string, soft = false): HTMLCanvasElement {
  const key = color + (soft ? 's' : '');
  let c = ringCache.get(key);
  if (c) return c;
  c = makeCanvas(128, 128);
  const g = ctx2d(c);
  const [r, gg, b] = parseRgb(color);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, `rgba(${r},${gg},${b},0)`);
  gr.addColorStop(soft ? 0.5 : 0.7, `rgba(${r},${gg},${b},${soft ? 0.1 : 0.12})`);
  gr.addColorStop(soft ? 0.82 : 0.9, `rgba(${r},${gg},${b},${soft ? 0.55 : 0.8})`);
  gr.addColorStop(soft ? 0.93 : 0.955, `rgba(${r},${gg},${b},${soft ? 0.3 : 1})`);
  gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  ringCache.set(key, c);
  return c;
}

const flameCache: HTMLCanvasElement[] = [];
export const FLAME_VARIANTS = 6;
/** Licking flame tongue, base at the bottom-centre of the sprite, tip at the top (draw it oriented "screen up"): a hot
 *  yellow-white root, orange body, deep red tip fading out, with a slightly curled, per-variant silhouette. 32 x 64. */
export function flameTex(variant: number): HTMLCanvasElement {
  const v = ((variant % FLAME_VARIANTS) + FLAME_VARIANTS) % FLAME_VARIANTS;
  let c = flameCache[v];
  if (c) return c;
  c = makeCanvas(32, 64);
  const g = ctx2d(c);
  const R = rng(4242 + v * 97);
  const curl = (R() - 0.5) * 9, lean = (R() - 0.5) * 6, fat = 0.85 + R() * 0.3;
  const shape = (k: number) => {
    // teardrop: round base (centre y = 50), sides pinching in to a curled tip
    const w = 11 * fat * k, by = 50, ty = 64 - (60 * (0.75 + 0.25 * k));
    g.beginPath();
    g.moveTo(16 - w, by);
    g.bezierCurveTo(16 - w, by + w * 1.1, 16 + w, by + w * 1.1, 16 + w, by);
    g.bezierCurveTo(16 + w * 0.9 + lean, by - 18, 16 + curl * 0.6 + lean, ty + 16, 16 + curl, ty);
    g.bezierCurveTo(16 + curl * 0.3 - w * 0.4, ty + 18, 16 - w * 0.9 + lean, by - 16, 16 - w, by);
    g.closePath();
  };
  const lg = (a0: number, stops: [number, string][]) => {
    const gr = g.createLinearGradient(0, 62, 0, 2);
    for (const [o, col] of stops) gr.addColorStop(o, col.replace('A', String(a0)));
    return gr;
  };
  // soft outer body, then the brighter inner flame, then the white-hot root
  g.fillStyle = lg(0.45, [[0, 'rgba(255,150,40,A)'], [0.45, 'rgba(235,80,20,A)'], [0.8, 'rgba(160,30,10,A)'], [1, 'rgba(120,20,5,0)']]);
  shape(1.15); g.fill();
  g.fillStyle = lg(0.95, [[0, 'rgba(255,230,140,A)'], [0.3, 'rgba(255,160,50,A)'], [0.65, 'rgba(230,70,20,A)'], [1, 'rgba(170,30,10,0)']]);
  shape(0.85); g.fill();
  g.fillStyle = lg(1, [[0, 'rgba(255,255,230,A)'], [0.25, 'rgba(255,230,140,A)'], [0.5, 'rgba(255,190,80,0)'], [1, 'rgba(255,190,80,0)']]);
  shape(0.5); g.fill();
  flameCache[v] = c;
  return c;
}

/** fast integer hash -> [0,1) */
export function hash1(n: number): number {
  n = (n | 0) * 2654435761;
  n ^= n >>> 15;
  n = Math.imul(n, 2246822519);
  n ^= n >>> 13;
  return (n >>> 0) / 4294967296;
}

export const easeOut = (u: number): number => 1 - (1 - u) * (1 - u) * (1 - u);
