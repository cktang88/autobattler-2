// Procedural battlefield ground: dark dusty metal deck with panel seams, grit, cracks and a faint cell grid.
// Rendered once per (field size, px) into an offscreen canvas in world orientation.

import { DEPLOY_D, FIELD_H, FIELD_W } from '../../shared/grid.ts';
import { ctx2d, makeCanvas, type Ctx } from './palette.ts';

let noiseTile: HTMLCanvasElement | null = null;
function getNoise(): HTMLCanvasElement {
  if (noiseTile) return noiseTile;
  const n = 128;
  noiseTile = makeCanvas(n, n);
  const g = ctx2d(noiseTile);
  const im = g.createImageData(n, n);
  let s = 12345;
  for (let i = 0; i < n * n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = (s >> 8) & 255;
    const k = v > 128 ? 255 : 0;
    im.data[i * 4] = k;
    im.data[i * 4 + 1] = k;
    im.data[i * 4 + 2] = k;
    im.data[i * 4 + 3] = Math.abs(v - 128) * 0.18;
  }
  g.putImageData(im, 0, 0);
  return noiseTile;
}

const cache = new Map<number, HTMLCanvasElement>();

export function groundCanvas(px: number): HTMLCanvasElement {
  px = Math.max(4, Math.round(px));
  let c = cache.get(px);
  if (c) return c;
  if (cache.size > 4) cache.clear();
  c = makeCanvas(FIELD_W * px, FIELD_H * px);
  const g = ctx2d(c);
  paint(g, px);
  cache.set(px, c);
  return c;
}

function paint(g: Ctx, px: number): void {
  let seed = 9001;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const W = FIELD_W, H = FIELD_H;
  g.setTransform(px, 0, 0, px, 0, 0);
  // base
  const base = g.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, '#363a37');
  base.addColorStop(0.5, '#313432');
  base.addColorStop(1, '#383934');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);

  // large deck plates (4x4 cells) with slight tint variation
  const P = 4;
  for (let y = 0; y < H; y += P) for (let x = 0; x < W; x += P) {
    const v = rnd();
    g.fillStyle = v < 0.33 ? 'rgba(255,255,255,0.025)' : v < 0.66 ? 'rgba(0,0,0,0.05)' : 'rgba(90,80,60,0.05)';
    g.fillRect(x + 0.03, y + 0.03, P - 0.06, P - 0.06);
  }
  // dusty blotches
  for (let i = 0; i < 90; i++) {
    const x = rnd() * W, y = rnd() * H, r = 0.8 + rnd() * 3.5;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const dusty = rnd() < 0.6;
    gr.addColorStop(0, dusty ? `rgba(120,104,78,${0.05 + rnd() * 0.07})` : `rgba(0,0,0,${0.06 + rnd() * 0.08})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // fine grit
  g.setTransform(1, 0, 0, 1, 0, 0);
  const pat = g.createPattern(getNoise(), 'repeat');
  if (pat) {
    g.fillStyle = pat;
    g.globalAlpha = 0.55;
    g.fillRect(0, 0, W * px, H * px);
    g.globalAlpha = 1;
  }
  g.setTransform(px, 0, 0, px, 0, 0);
  // plate seams
  const lw = 1 / px;
  g.lineWidth = lw * 1.5;
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  for (let x = P; x < W; x += P) { g.moveTo(x, 0); g.lineTo(x, H); }
  for (let y = P; y < H; y += P) { g.moveTo(0, y); g.lineTo(W, y); }
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.beginPath();
  for (let x = P; x < W; x += P) { g.moveTo(x + lw * 1.5, 0); g.lineTo(x + lw * 1.5, H); }
  for (let y = P; y < H; y += P) { g.moveTo(0, y + lw * 1.5); g.lineTo(W, y + lw * 1.5); }
  g.stroke();
  // rivets at plate corners
  for (let y = P; y < H; y += P) for (let x = P; x < W; x += P) {
    for (const [dx, dy] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.beginPath(); g.arc(x + dx, y + dy, 0.045, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.09)';
      g.beginPath(); g.arc(x + dx - 0.012, y + dy - 0.012, 0.022, 0, Math.PI * 2); g.fill();
    }
  }
  // faint cell grid
  g.strokeStyle = 'rgba(255,255,255,0.035)';
  g.lineWidth = lw;
  g.beginPath();
  for (let x = 1; x < W; x++) { g.moveTo(x, 0); g.lineTo(x, H); }
  for (let y = 1; y < H; y++) { g.moveTo(0, y); g.lineTo(W, y); }
  g.stroke();
  // cracks
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.lineWidth = lw * 1.2;
  for (let i = 0; i < 14; i++) {
    let x = rnd() * W, y = DEPLOY_D + rnd() * (H - 2 * DEPLOY_D);
    let a = rnd() * Math.PI * 2;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      a += (rnd() - 0.5) * 1.4;
      x += Math.cos(a) * 0.4;
      y += Math.sin(a) * 0.4;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // old craters in no man's land
  for (let i = 0; i < 9; i++) {
    const x = 1 + rnd() * (W - 2), y = DEPLOY_D + 1 + rnd() * (H - 2 * DEPLOY_D - 2), r = 0.3 + rnd() * 0.7;
    const gr = g.createRadialGradient(x, y, 0, x, y, r * 1.4);
    gr.addColorStop(0, 'rgba(0,0,0,0.3)');
    gr.addColorStop(0.6, 'rgba(0,0,0,0.12)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r * 1.4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(160,140,110,0.05)';
    g.lineWidth = r * 0.12;
    g.beginPath(); g.arc(x, y, r * 0.75, 3.6, 5.8); g.stroke();
  }
  // hazard stripes along the midline
  const mid = H / 2;
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  g.lineWidth = lw * 2;
  g.setLineDash([0.4, 0.4]);
  g.beginPath(); g.moveTo(0, mid); g.lineTo(W, mid); g.stroke();
  g.setLineDash([]);
  g.setTransform(1, 0, 0, 1, 0, 0);
}
