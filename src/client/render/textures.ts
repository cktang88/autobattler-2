// Effect textures (Zero-K public-domain set, public/assets/zk/pd/). Loaded lazily; every user falls back to
// procedural sprites until an image is ready, so nothing depends on them being present.

import { ctx2d, makeCanvas } from './palette.ts';

export type TexName = 'shockwave' | 'spark' | 'fireball' | 'smoke' | 'hex' | 'eball' | 'wbolt' | 'burn' | 'flower' | 'lring' | 'orangesmoke';

const FILES: Record<TexName, string> = {
  shockwave: 'shockwave.png',
  spark: 'spark.png',
  fireball: 'fireball.png',
  smoke: 'smoke1.png',
  hex: 'hexbig.png',
  eball: 'lightningball4.png',
  wbolt: 'whitelightningball.png',
  burn: 'burncircle.png',
  flower: 'flowerflash.png',
  lring: 'lightring.png',
  orangesmoke: 'orangesmoke.png',
};

let base = 'assets/zk/pd/';
const imgs = new Map<TexName, HTMLImageElement>();
const ready = new Set<TexName>();
let started = false;

/** Override the texture folder (relative to the page). */
export function setTextureBase(path: string): void {
  base = path.endsWith('/') ? path : path + '/';
}

export function loadTextures(): void {
  if (started || typeof Image === 'undefined') return;
  started = true;
  for (const [k, f] of Object.entries(FILES) as [TexName, string][]) {
    const im = new Image();
    im.onload = () => ready.add(k);
    im.onerror = () => {};
    im.src = base + f;
    imgs.set(k, im);
  }
}

export function tex(name: TexName): HTMLImageElement | null {
  if (!started) loadTextures();
  return ready.has(name) ? imgs.get(name)! : null;
}

const tintCache = new Map<string, HTMLCanvasElement>();
/** Texture multiplied by a colour (for additive use: black stays black). */
export function tinted(name: TexName, color: string): HTMLCanvasElement | null {
  const im = tex(name);
  if (!im) return null;
  const key = name + color;
  let c = tintCache.get(key);
  if (c) return c;
  const w = Math.min(128, im.naturalWidth || 128), h = Math.min(128, im.naturalHeight || 128);
  c = makeCanvas(w, h);
  const g = ctx2d(c);
  g.drawImage(im, 0, 0, w, h);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(im, 0, 0, w, h);
  tintCache.set(key, c);
  return c;
}
