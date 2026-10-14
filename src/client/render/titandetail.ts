// Titan-class (size 5) hull detail pass: the extra mechanical layer that makes a 35-40 m war machine read as one
// when zoomed in - panel seams, plate layering, hatches, vents and heat sinks, sensor clusters, masts, walkways,
// railings, cable runs, rivets, point-defence blisters, stencils, glowing reactor vents and weathering. Drawn into the
// cached hull sprite on top of the base art (footart.ts DETAILS), under the turrets. Density is gated by sprite pixels
// per cell (`px`), so a zoomed-out titan stays clean and cheap; the sprite is cached per px so this runs once.
//
// Coordinates follow footart.ts: u along the length (nose +), v across, both fractions of the footprint (X, Y);
// sizes are absolute cells (1 cell = 5 m). Lit from the top-left; shadows are hard and offset down-right.

import { METAL, rgba, roundRect, shade, type Ctx, type TeamPal } from './palette.ts';
import { emis, hazard } from './giantart.ts';
import type { UnitLayout } from './unitart.ts';

const P2 = Math.PI * 2;
export const TITAN_SHAPES = new Set(['colossal', 'citadel', 'arachne']);

/** device px per cell of the sprite being drawn (set by unitart before the hull details run) */
let curPx = 30;
export function setDetailPx(px: number): void { curPx = px; }

/** 0 = none (tiny on screen), 1 = seams, panels, grime, 2 = hatches, vents, masts, 3 = rivets, rails, stencils */
const levelOf = (px: number) => (px < 20 ? 0 : px < 38 ? 1 : px < 64 ? 2 : 3);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

class D {
  g: Ctx; X: number; Y: number; S: number; o: number; pal: TeamPal; E: string; lvl: number; px: number;
  /** hairline in cells: ~1 device px, but never thinner than the base outline */
  h: number;
  constructor(g: Ctx, L: UnitLayout, pal: TeamPal, o: number, px: number) {
    this.g = g; this.X = L.X; this.Y = L.Y; this.S = L.S; this.o = o; this.pal = pal; this.E = emis(pal); this.px = px; this.lvl = levelOf(px);
    this.h = Math.max(1 / px, o * 0.6);
  }
  x(u: number): number { return u * this.X; }
  y(v: number): number { return v * this.Y; }
  path(pts: number[], close = false): Path2D {
    const p = new Path2D();
    for (let i = 0; i < pts.length; i += 2) i ? p.lineTo(pts[i] * this.X, pts[i + 1] * this.Y) : p.moveTo(pts[i] * this.X, pts[i + 1] * this.Y);
    if (close) p.closePath();
    return p;
  }
  /** polyline: a dark groove with a lit lip just below/right of it (a panel seam) */
  seam(pts: number[], w = 1, close = false): void {
    const g = this.g, h = this.h * w, p = this.path(pts, close);
    g.lineJoin = 'round'; g.lineCap = 'butt';
    g.save(); g.translate(h * 0.9, h * 0.9); g.strokeStyle = 'rgba(255,255,255,0.13)'; g.lineWidth = h; g.stroke(p); g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.42)'; g.lineWidth = h; g.stroke(p);
  }
  /** an overlapping armour plate: raised lip, drop shadow on the plate below, own tone */
  plate(pts: number[], tone = 0, depth = 1): void {
    const g = this.g, p = this.path(pts, true), h = this.h;
    g.save(); g.translate(h * 2.2 * depth, h * 3 * depth); g.fillStyle = 'rgba(0,0,0,0.42)'; g.fill(p); g.restore();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i] * this.X); x1 = Math.max(x1, pts[i] * this.X); y0 = Math.min(y0, pts[i + 1] * this.Y); y1 = Math.max(y1, pts[i + 1] * this.Y); }
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, shade(this.pal.light, -0.04 + tone)); gr.addColorStop(1, shade(this.pal.dark, 0.02 + tone * 0.6));
    g.fillStyle = gr; g.fill(p);
    g.save(); g.clip(p); g.lineJoin = 'round';
    g.lineWidth = h * 3; g.save(); g.translate(h * 1.4, h * 1.4); g.strokeStyle = 'rgba(255,255,255,0.36)'; g.stroke(p); g.restore();
    g.save(); g.translate(-h * 1.4, -h * 1.4); g.strokeStyle = 'rgba(0,0,0,0.4)'; g.stroke(p); g.restore();
    g.restore();
    g.lineWidth = h * 0.8; g.strokeStyle = 'rgba(8,10,12,0.5)'; g.lineJoin = 'round'; g.stroke(p);
  }
  rivets(u0: number, v0: number, u1: number, v1: number, n: number, r = 0.022): void {
    const g = this.g;
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0.5 : i / (n - 1), x = this.x(u0 + (u1 - u0) * f), y = this.y(v0 + (v1 - v0) * f);
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.arc(x + r * 0.25, y + r * 0.3, r, 0, P2); g.fill();
      g.fillStyle = 'rgba(190,200,208,0.5)'; g.beginPath(); g.arc(x, y, r * 0.8, 0, P2); g.fill();
    }
  }
  /** round access hatch with a lid ring, a wheel handle and a few bolts */
  hatch(u: number, v: number, r: number, rot = 0): void {
    const g = this.g, x = this.x(u), y = this.y(v);
    g.fillStyle = 'rgba(0,0,0,0.38)'; g.beginPath(); g.arc(x + r * 0.15, y + r * 0.22, r * 1.1, 0, P2); g.fill();
    const gr = g.createRadialGradient(x - r * 0.4, y - r * 0.4, 0, x, y, r * 1.1);
    gr.addColorStop(0, shade(this.pal.light, 0.08)); gr.addColorStop(1, shade(this.pal.dark, 0.05));
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, P2); g.fill();
    g.lineWidth = this.h * 1.2; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.stroke();
    if (this.lvl < 3) { g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = this.h; g.beginPath(); g.arc(x, y, r * 0.66, 0, P2); g.stroke(); return; }
    g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = this.h; g.beginPath(); g.arc(x - this.h * 0.5, y - this.h * 0.5, r * 0.78, 0, P2); g.stroke();
    g.save(); g.translate(x, y); g.rotate(rot);
    g.strokeStyle = METAL.dark; g.lineWidth = r * 0.16; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-r * 0.42, 0); g.lineTo(r * 0.42, 0); g.moveTo(0, -r * 0.42); g.lineTo(0, r * 0.42); g.stroke();
    g.strokeStyle = METAL.light; g.lineWidth = r * 0.07; g.stroke();
    g.restore();
    for (let i = 0; i < 6; i++) { const a = (i / 6) * P2; g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.arc(x + Math.cos(a) * r * 0.86, y + Math.sin(a) * r * 0.86, r * 0.06, 0, P2); g.fill(); }
  }
  /** rectangular access door (cells w x hh) with a handle */
  door(u: number, v: number, w: number, hh: number, tone = 0): void {
    const g = this.g, x = this.x(u) - w / 2, y = this.y(v) - hh / 2, p = new Path2D();
    roundRect(p, x, y, w, hh, Math.min(w, hh) * 0.12);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.save(); g.translate(this.h * 1.5, this.h * 2); g.fill(p); g.restore();
    g.fillStyle = shade(this.pal.dark, 0.05 + tone); g.fill(p);
    g.lineWidth = this.h; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.stroke(p);
    g.save(); g.clip(p); g.translate(this.h, this.h); g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = this.h; g.stroke(p); g.restore();
    if (this.lvl >= 3) { g.fillStyle = METAL.light; g.fillRect(x + w * 0.68, y + hh * 0.42, w * 0.14, hh * 0.16); }
  }
  /** slatted louvre vent (dark slot, lit slat edges), sizes in cells; `hot` adds a faint reactor glow under the slats */
  vent(u: number, v: number, w: number, hh: number, n: number, hot = 0): void {
    const g = this.g, x = this.x(u) - w / 2, y = this.y(v) - hh / 2, p = new Path2D();
    roundRect(p, x, y, w, hh, Math.min(w, hh) * 0.1);
    g.fillStyle = '#06080a'; g.fill(p);
    if (hot > 0) { g.save(); g.clip(p); g.fillStyle = rgba(this.E, hot); g.fillRect(x, y, w, hh); g.restore(); }
    g.save(); g.clip(p);
    const horiz = w >= hh;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      g.fillStyle = shade(this.pal.dark, 0.1);
      if (horiz) g.fillRect(x, y + hh * f - hh / n * 0.28, w, hh / n * 0.56); else g.fillRect(x + w * f - w / n * 0.28, y, w / n * 0.56, hh);
      g.fillStyle = 'rgba(255,255,255,0.14)';
      if (horiz) g.fillRect(x, y + hh * f - hh / n * 0.28, w, this.h * 0.8); else g.fillRect(x + w * f - w / n * 0.28, y, this.h * 0.8, hh);
    }
    g.restore();
    g.lineWidth = this.h; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.stroke(p);
  }
  /** heat-sink fin bank (cells): thin parallel fins over a dark well, faintly glowing at the root */
  fins(u: number, v: number, w: number, hh: number, n: number, vert = false): void {
    const g = this.g, x = this.x(u) - w / 2, y = this.y(v) - hh / 2;
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x + this.h * 2, y + this.h * 2.5, w, hh);
    g.fillStyle = '#0a0c0e'; g.fillRect(x, y, w, hh);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      if (vert) { const fw = w / n * 0.5; g.fillStyle = METAL.base; g.fillRect(x + w * f - fw / 2, y, fw, hh); g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(x + w * f - fw / 2, y, this.h * 0.8, hh); }
      else { const fh = hh / n * 0.5; g.fillStyle = METAL.base; g.fillRect(x, y + hh * f - fh / 2, w, fh); g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(x, y + hh * f - fh / 2, w, this.h * 0.8); }
    }
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = this.h; g.strokeRect(x, y, w, hh);
    const gr = vert ? g.createLinearGradient(0, y + hh, 0, y) : g.createLinearGradient(x + w, 0, x, 0);
    gr.addColorStop(0, rgba(this.E, 0.22)); gr.addColorStop(0.6, rgba(this.E, 0));
    g.fillStyle = gr; g.fillRect(x, y, w, hh);
  }
  /** walkway rail: a bar with posts and a hard shadow beside it */
  rail(u0: number, v0: number, u1: number, v1: number, posts = 4): void {
    const g = this.g, x0 = this.x(u0), y0 = this.y(v0), x1 = this.x(u1), y1 = this.y(v1), h = this.h;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.32)'; g.lineWidth = h * 1.4; g.beginPath(); g.moveTo(x0 + h * 3, y0 + h * 4); g.lineTo(x1 + h * 3, y1 + h * 4); g.stroke();
    g.strokeStyle = METAL.base; g.lineWidth = h * 1.1; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = h * 0.45; g.stroke();
    for (let i = 0; i < posts; i++) {
      const f = posts === 1 ? 0.5 : i / (posts - 1); g.fillStyle = METAL.light;
      g.beginPath(); g.arc(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, h * 1.1, 0, P2); g.fill();
    }
  }
  /** ladder: two rails and rungs; w = rail spacing in cells */
  ladder(u0: number, v0: number, u1: number, v1: number, w = 0.12): void {
    const g = this.g, x0 = this.x(u0), y0 = this.y(v0), x1 = this.x(u1), y1 = this.y(v1), h = this.h;
    const len = Math.hypot(x1 - x0, y1 - y0), nx = -(y1 - y0) / len * w / 2, ny = (x1 - x0) / len * w / 2;
    g.lineCap = 'butt';
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = h * 1.3;
    g.beginPath(); g.moveTo(x0 + nx + h * 2, y0 + ny + h * 3); g.lineTo(x1 + nx + h * 2, y1 + ny + h * 3); g.moveTo(x0 - nx + h * 2, y0 - ny + h * 3); g.lineTo(x1 - nx + h * 2, y1 - ny + h * 3); g.stroke();
    g.strokeStyle = METAL.light; g.lineWidth = h;
    g.beginPath(); g.moveTo(x0 + nx, y0 + ny); g.lineTo(x1 + nx, y1 + ny); g.moveTo(x0 - nx, y0 - ny); g.lineTo(x1 - nx, y1 - ny); g.stroke();
    const n = Math.max(3, Math.floor(len / (w * 0.9)));
    g.lineWidth = h * 0.8; g.beginPath();
    for (let i = 1; i < n; i++) { const f = i / n; g.moveTo(x0 + (x1 - x0) * f + nx, y0 + (y1 - y0) * f + ny); g.lineTo(x0 + (x1 - x0) * f - nx, y0 + (y1 - y0) * f - ny); }
    g.stroke();
  }
  /** thick cable run through points (u,v) with a lit top edge; w in cells */
  cable(pts: number[], w = 0.07): void {
    const g = this.g, h = this.h;
    const p = new Path2D(); p.moveTo(this.x(pts[0]), this.y(pts[1]));
    for (let i = 2; i < pts.length - 2; i += 2) p.quadraticCurveTo(this.x(pts[i]), this.y(pts[i + 1]), this.x((pts[i] + pts[i + 2]) / 2), this.y((pts[i + 1] + pts[i + 3]) / 2));
    p.lineTo(this.x(pts[pts.length - 2]), this.y(pts[pts.length - 1]));
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.save(); g.translate(h * 2, h * 3); g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = w; g.stroke(p); g.restore();
    g.strokeStyle = '#15181b'; g.lineWidth = w; g.stroke(p);
    g.strokeStyle = 'rgba(160,170,180,0.25)'; g.lineWidth = w * 0.25; g.save(); g.translate(-w * 0.12, -w * 0.12); g.stroke(p); g.restore();
  }
  /** whip antenna mast (length in cells) with a tip light; hard shadow */
  mast(u: number, v: number, len: number, ang: number, tip = '#ff5040'): void {
    const g = this.g, x = this.x(u), y = this.y(v), ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len, h = this.h;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = h * 1.1; g.beginPath(); g.moveTo(x + h * 4, y + h * 6); g.lineTo(ex + h * 4, ey + h * 6); g.stroke();
    g.fillStyle = METAL.dark; g.beginPath(); g.arc(x, y, h * 2.6, 0, P2); g.fill();
    g.strokeStyle = METAL.light; g.lineWidth = h * 0.9; g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
    const cx = x + (ex - x) * 0.6, cy = y + (ey - y) * 0.6, nx = -Math.sin(ang) * len * 0.1, ny = Math.cos(ang) * len * 0.1;
    g.lineWidth = h * 0.7; g.beginPath(); g.moveTo(cx - nx, cy - ny); g.lineTo(cx + nx, cy + ny); g.stroke();
    g.fillStyle = tip; g.beginPath(); g.arc(ex, ey, h * 1.2, 0, P2); g.fill();
  }
  /** small dish, angled */
  dish(u: number, v: number, r: number, ang: number): void {
    const g = this.g, x = this.x(u), y = this.y(v);
    g.save(); g.translate(x, y); g.rotate(ang);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(r * 0.18, r * 0.25, r * 0.5, r, 0, 0, P2); g.fill();
    const gr = g.createLinearGradient(-r * 0.5, 0, r * 0.5, 0); gr.addColorStop(0, METAL.light); gr.addColorStop(1, METAL.dark);
    g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, r * 0.5, r, 0, 0, P2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = this.h; g.stroke();
    g.strokeStyle = METAL.deep; g.lineWidth = this.h * 1.2; g.beginPath(); g.moveTo(0, 0); g.lineTo(r * 0.7, 0); g.stroke();
    g.fillStyle = '#c9d2d8'; g.beginPath(); g.arc(r * 0.7, 0, this.h * 1.4, 0, P2); g.fill();
    g.restore();
  }
  /** point-defence blister: armoured ring, a dome and twin short barrels aimed at `ang` (r in cells) */
  blister(u: number, v: number, r: number, ang: number): void {
    const g = this.g, x = this.x(u), y = this.y(v);
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.arc(x + r * 0.22, y + r * 0.3, r * 1.12, 0, P2); g.fill();
    g.fillStyle = METAL.dark; g.beginPath(); g.arc(x, y, r * 1.05, 0, P2); g.fill();
    g.lineWidth = this.h; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.stroke();
    g.save(); g.translate(x, y); g.rotate(ang);
    for (const s of [-1, 1]) {
      g.fillStyle = METAL.deep; g.fillRect(r * 0.2, s * r * 0.3 - r * 0.1, r * 1.15, r * 0.2);
      g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(r * 0.2, s * r * 0.3 - r * 0.1, r * 1.15, this.h * 0.7);
    }
    const gr = g.createRadialGradient(-r * 0.25, -r * 0.25, 0, 0, 0, r * 0.85);
    gr.addColorStop(0, shade(this.pal.light, 0.1)); gr.addColorStop(1, shade(this.pal.dark, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r * 0.72, 0, P2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = this.h * 0.8; g.stroke();
    g.fillStyle = '#0b1319'; g.fillRect(r * 0.12, -r * 0.14, r * 0.42, r * 0.28);
    g.restore();
  }
  /** row of small sensor lenses in a recessed bar (w = span in cells) */
  sensors(u: number, v: number, w: number, n: number, r: number, vert = false): void {
    const g = this.g, x = this.x(u), y = this.y(v), h = this.h;
    const p = new Path2D(); roundRect(p, vert ? x - r * 1.6 : x - w / 2 - r, vert ? y - w / 2 - r : y - r * 1.6, vert ? r * 3.2 : w + r * 2, vert ? w + r * 2 : r * 3.2, r);
    g.fillStyle = '#0a0d10'; g.fill(p); g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = h; g.stroke(p);
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0.5 : i / (n - 1), lx = vert ? x : x - w / 2 + w * f, ly = vert ? y - w / 2 + w * f : y;
      const lr = r * (i % 2 ? 0.8 : 1);
      g.fillStyle = '#0f2530'; g.beginPath(); g.arc(lx, ly, lr, 0, P2); g.fill();
      g.fillStyle = rgba(this.E, 0.75); g.beginPath(); g.arc(lx, ly, lr * 0.55, 0, P2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(lx - lr * 0.25, ly - lr * 0.25, lr * 0.2, 0, P2); g.fill();
    }
  }
  /** searchlight: housing + bright lens, aimed at `ang` */
  searchlight(u: number, v: number, r: number, ang: number): void {
    const g = this.g, x = this.x(u), y = this.y(v);
    g.save(); g.translate(x, y); g.rotate(ang);
    g.fillStyle = 'rgba(0,0,0,0.38)'; g.fillRect(-r * 0.6 + r * 0.25, -r * 0.8 + r * 0.3, r * 1.4, r * 1.6);
    g.fillStyle = METAL.dark; g.fillRect(-r * 0.6, -r * 0.8, r * 1.2, r * 1.6);
    g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(-r * 0.6, -r * 0.8, r * 1.2, this.h);
    g.fillStyle = '#fff3c4'; g.fillRect(r * 0.45, -r * 0.6, r * 0.22, r * 1.2);
    g.restore();
  }
  /** stencilled marking text (reads left to right when the nose points up); size in cells */
  stencil(u: number, v: number, text: string, size: number, a = 0.55): void {
    if (this.lvl < 3) return;
    const g = this.g; g.save(); g.translate(this.x(u), this.y(v)); g.rotate(Math.PI / 2);
    g.font = `700 ${size}px "Arial Narrow", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = `rgba(222,224,214,${a})`; g.fillText(text, 0, 0); g.restore();
  }
  haz(u: number, v: number, w: number, hh: number, vert = false): void {
    this.g.save(); this.g.globalAlpha = 0.85; hazard(this.g, this.x(u) - w / 2, this.y(v) - hh / 2, w, hh, this.o, vert); this.g.restore();
  }
  /** team-colour bar: a small accent only */
  accent(u0: number, v0: number, u1: number, v1: number, w: number): void {
    const g = this.g; g.lineCap = 'butt'; g.strokeStyle = rgba(this.pal.accent, 0.9); g.lineWidth = w;
    g.beginPath(); g.moveTo(this.x(u0), this.y(v0)); g.lineTo(this.x(u1), this.y(v1)); g.stroke();
  }
  /** faint glowing vent slit */
  glowSlit(u0: number, v0: number, u1: number, v1: number, w: number, a = 0.7): void {
    const g = this.g; g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = w * 2; g.beginPath(); g.moveTo(this.x(u0), this.y(v0)); g.lineTo(this.x(u1), this.y(v1)); g.stroke();
    g.strokeStyle = rgba(this.E, a); g.lineWidth = w; g.stroke();
  }
  /** ring of bolts around (u,v); r and br in cells */
  boltRing(u: number, v: number, r: number, n: number, br = 0.02): void {
    const g = this.g;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * P2, x = this.x(u) + Math.cos(a) * r, y = this.y(v) + Math.sin(a) * r;
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.arc(x + br * 0.2, y + br * 0.3, br, 0, P2); g.fill();
      g.fillStyle = 'rgba(190,200,208,0.5)'; g.beginPath(); g.arc(x, y, br * 0.75, 0, P2); g.fill();
    }
  }
  ring(u: number, v: number, r: number, w = 1): void {
    const g = this.g; g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = this.h * w; g.beginPath(); g.arc(this.x(u), this.y(v), r, 0, P2); g.stroke();
  }
  /** flat sunken floor / deck panel (darker than the armour), with a lit lip */
  floor(pts: number[], tone = 0): void {
    const g = this.g, p = this.path(pts, true), h = this.h;
    g.fillStyle = shade(this.pal.deep, 0.16 + tone); g.fill(p);
    g.save(); g.clip(p); g.lineJoin = 'round';
    g.lineWidth = h * 4; g.strokeStyle = 'rgba(0,0,0,0.45)'; g.stroke(p);
    g.save(); g.translate(h * 1.2, h * 1.2); g.lineWidth = h * 1.2; g.strokeStyle = 'rgba(255,255,255,0.14)'; g.stroke(p); g.restore();
    g.restore();
  }
  /** a sector of an elliptical shell (angles a0..a1 about the nose axis, radius fractions f0..f1) as a path */
  sector(cx: number, rx: number, ry: number, a0: number, a1: number, f0: number, f1: number): number[] {
    const out: number[] = [], n = 5;
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push(cx + Math.cos(a) * rx * f1, Math.sin(a) * ry * f1); }
    for (let i = n; i >= 0; i--) { const a = a0 + (a1 - a0) * i / n; out.push(cx + Math.cos(a) * rx * f0, Math.sin(a) * ry * f0); }
    return out;
  }
  /** shell scute: translucent tone, hard shadow under its far edge, lit lip */
  scute(pts: number[], a: number, light: boolean): void {
    const g = this.g, p = this.path(pts, true), h = this.h;
    g.fillStyle = light ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; g.fill(p);
    g.save(); g.clip(p); g.lineJoin = 'round';
    g.lineWidth = h * 3; g.save(); g.translate(h * 1.3, h * 1.3); g.strokeStyle = 'rgba(255,255,255,0.22)'; g.stroke(p); g.restore();
    g.save(); g.translate(-h * 1.3, -h * 1.3); g.strokeStyle = 'rgba(0,0,0,0.36)'; g.stroke(p); g.restore();
    g.restore();
    g.lineWidth = h * 0.8; g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineJoin = 'round'; g.stroke(p);
  }
  /** weathering over the hull: edge darkening, soot from exhausts, grime streaks, dust blotches, paint chips */
  weather(hull: Path2D, seed: number, sootAt: [number, number][], streaks: number): void {
    const g = this.g, h = this.h, R = rng(seed);
    const hp = new Path2D(); hp.addPath(hull, new DOMMatrix([this.X, 0, 0, this.Y, 0, 0]));
    g.save(); g.clip(hp);
    g.strokeStyle = 'rgba(0,0,0,0.13)'; g.lineWidth = this.S * 0.16; g.lineJoin = 'round'; g.stroke(hp);
    g.strokeStyle = 'rgba(0,0,0,0.1)'; g.lineWidth = this.S * 0.07; g.stroke(hp);
    for (const [u, v] of sootAt) {
      const gr = g.createRadialGradient(this.x(u), this.y(v), 0, this.x(u), this.y(v), this.S * 0.5);
      gr.addColorStop(0, 'rgba(14,12,10,0.34)'); gr.addColorStop(1, 'rgba(14,12,10,0)');
      g.fillStyle = gr; g.fillRect(this.x(u) - this.S, this.y(v) - this.S, this.S * 2, this.S * 2);
    }
    for (let i = 0; i < 9; i++) {
      const x = (R() - 0.5) * this.X * 0.9, y = (R() - 0.5) * this.Y * 0.9, r = this.S * (0.18 + R() * 0.3);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, i % 2 === 0 ? 'rgba(140,124,98,0.09)' : 'rgba(0,0,0,0.07)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    if (this.lvl >= 2) {
      g.lineCap = 'round';
      for (let i = 0; i < streaks; i++) {
        const x = (R() - 0.5) * this.X * 0.85, y = (R() - 0.5) * this.Y * 0.85, len = this.S * (0.2 + R() * 0.5);
        g.strokeStyle = `rgba(20,16,12,${0.05 + R() * 0.06})`; g.lineWidth = h * (1.2 + R() * 2.2);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - len, y + (R() - 0.5) * this.S * 0.06); g.stroke();
      }
    }
    if (this.lvl >= 3) {
      g.lineWidth = h * 0.7;
      for (let i = 0; i < 70; i++) {
        const x = (R() - 0.5) * this.X * 0.95, y = (R() - 0.5) * this.Y * 0.95, a = R() * P2, l = h * (2 + R() * 7);
        g.strokeStyle = R() < 0.6 ? 'rgba(220,225,230,0.16)' : 'rgba(0,0,0,0.18)';
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
    }
    g.restore();
  }
}

/* --------------------------------------------------------------------------------------------- Titan Walker */

function colossal(d: D, hull: Path2D): void {
  const lvl = d.lvl, h = d.h, g = d.g;
  d.weather(hull, 11, [[-0.5, -0.1], [-0.5, 0.1], [-0.4, 0]], 18);
  // chest: pectoral plates either side of the reactor well, a collar yoke, and a shingled abdomen skirt
  for (const s of [-1, 1]) {
    d.plate([0.19, s * 0.04, 0.19, s * 0.2, 0.15, s * 0.245, 0.05, s * 0.245, 0.0, s * 0.21, 0.0, s * 0.04], 0.04, 0.9);
    d.seam([0.1, s * 0.05, 0.1, s * 0.24], 0.9);
    d.accent(0.17, s * 0.07, 0.17, s * 0.15, h * 3);
  }
  for (let i = 0; i < 4; i++) {
    const u = -0.03 - i * 0.04, w = 0.22 - i * 0.02;
    d.plate([u, -w, u, w, u - 0.05, w - 0.015, u - 0.05, -w + 0.015], -0.03 - i * 0.02, 0.55);
  }
  if (lvl >= 2) {
    // reactor flange: bolted ring and four braces around the core
    const cu = 0.03;
    d.boltRing(cu, 0, d.S * 0.4, 16, 0.03);
    d.ring(cu, 0, d.S * 0.44);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2, cx = d.x(cu);
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = h * 1.6; g.beginPath();
      g.moveTo(cx + Math.cos(a) * d.S * 0.44, Math.sin(a) * d.S * 0.44); g.lineTo(cx + Math.cos(a) * d.S * 0.6, Math.sin(a) * d.S * 0.6); g.stroke();
    }
    d.vent(0.14, -0.16, 0.5, 0.2 * 1.4, 4, 0.12); d.vent(0.14, 0.16, 0.5, 0.2 * 1.4, 4, 0.12);
  }
  // gorget between head and chest, head brow, cheeks
  d.seam([0.205, -0.21, 0.205, 0.21]);
  d.plate([0.245, -0.075, 0.245, 0.075, 0.215, 0.1, 0.2, 0.1, 0.2, -0.1, 0.215, -0.1], 0.0, 0.6);
  d.seam([0.3, -0.09, 0.3, 0.09]);
  // head: brow plate over a lower jaw plate, cheek vents, sensor bar, antenna masts, searchlights
  d.plate([0.46, -0.04, 0.46, 0.04, 0.42, 0.07, 0.34, 0.075, 0.34, -0.075, 0.42, -0.07], 0.05, 0.6);
  d.seam([0.42, -0.07, 0.42, 0.07]); d.seam([0.38, 0, 0.46, 0]);
  if (lvl >= 2) {
    d.sensors(0.405, 0, 0.42, 3, 0.07);
    d.vent(0.31, -0.062, 0.2 * d.X * 0.35, 0.02 * d.Y, 3); d.vent(0.31, 0.062, 0.2 * d.X * 0.35, 0.02 * d.Y, 3);
    d.mast(0.28, -0.085, 1.5, Math.PI * 0.75); d.mast(0.28, 0.085, 1.1, Math.PI * 0.25, '#ffd060');
    d.dish(0.225, 0.06, 0.5, -0.3);
    d.searchlight(0.445, -0.07, 0.09, 0); d.searchlight(0.445, 0.07, 0.09, 0);
    d.hatch(0.235, -0.06, 0.13, 0.4);
  }
  // shoulder yokes: bridge plates over the arm sockets, bolt rows, cable runs to the backpack
  for (const s of [-1, 1]) {
    d.plate([0.08, s * 0.3, 0.08, s * 0.5, -0.05, s * 0.5, -0.11, s * 0.42, -0.11, s * 0.3], 0.0, 0.7);
    d.seam([0.0, s * 0.31, 0.0, s * 0.49]);
    if (lvl >= 3) { d.rivets(0.06, s * 0.33, 0.06, s * 0.48, 5); d.rivets(-0.09, s * 0.33, -0.09, s * 0.42, 3); }
    if (lvl >= 2) {
      d.cable([-0.2, s * 0.14, -0.14, s * 0.22, -0.05, s * 0.27, 0.05, s * 0.28], 0.08);
      d.cable([-0.22, s * 0.11, -0.16, s * 0.2, -0.08, s * 0.25], 0.05);
      d.fins(0.2, s * 0.285, 0.34 * d.X, 0.07 * d.Y, 6);
      d.vent(0.0, s * 0.455, 0.14 * d.X, 0.08 * d.Y, 4);
      d.blister(-0.02, s * 0.5 - s * 0.01, 0.2, s * Math.PI * 0.5);
      d.glowSlit(0.28, s * 0.44, 0.28, s * 0.36, h * 1.4, 0.55);
    }
    d.seam([0.05, s * 0.36, 0.33, s * 0.36]);
    d.seam([0.22, s * 0.3, 0.22, s * 0.46]);
    if (lvl >= 3) { d.door(0.28, s * 0.46, 0.4, 0.14 * d.Y); d.rivets(0.05, s * 0.45, 0.31, s * 0.45, 7); d.stencil(0.1, s * 0.34, s > 0 ? 'R-1' : 'L-2', 0.2); }
  }
  // spine: access panel behind the chest
  d.plate([-0.18, -0.12, -0.18, 0.12, -0.23, 0.15, -0.27, 0.15, -0.27, -0.15, -0.23, -0.15], 0.03, 0.8);
  if (lvl >= 2) {
    d.vent(-0.2, 0, 0.1 * d.X, 0.17 * d.Y, 5);
    d.haz(-0.17, 0.255 * 0, 0.4, 0.14, false);
  }
  // backpack: coolant fin banks both sides, hatches, stencil
  d.seam([-0.38, -0.15, -0.38, 0.15]); d.seam([-0.3, -0.19, -0.3, 0.19]);
  if (lvl >= 2) {
    for (const s of [-1, 1]) {
      d.fins(-0.42, s * 0.135, 0.12 * d.X * 0.75, 0.04 * d.Y, 5);
      d.fins(-0.33, s * 0.155, 0.5, 0.05 * d.Y * 0.8, 4);
      d.hatch(-0.265, s * 0.17, 0.2, s);
      d.glowSlit(-0.47, s * 0.12, -0.38, s * 0.12, h * 1.6, 0.35);
    }
    d.rail(-0.24, -0.19, -0.45, -0.19, 4); d.rail(-0.24, 0.19, -0.45, 0.19, 4);
    d.vent(-0.465, 0, 0.07 * d.X, 0.07 * d.Y, 4, 0.2);
    d.mast(-0.34, 0.13, 2.0, Math.PI * 0.95);
    d.accent(-0.31, -0.18, -0.31, -0.1, h * 4);
  }
  d.stencil(-0.14, 0.0, 'TW-01', 0.26, 0.5);
  if (lvl >= 3) { d.rivets(-0.2, -0.18, -0.36, -0.18, 6, 0.024); d.rivets(-0.2, 0.18, -0.36, 0.18, 6, 0.024); }
}

/* --------------------------------------------------------------------------------------------- Citadel */

function citadel(d: D, hull: Path2D): void {
  const lvl = d.lvl, h = d.h, S = d.S, g = d.g, X = d.X, Y = d.Y;
  d.weather(hull, 23, [[-0.5, 0], [-0.4, -0.35], [-0.4, 0.35]], 22);
  // ---- yard: sunken deck plates (tiled), a painted vehicle lane, reactor pad with coolant lines
  d.floor([-0.34, -0.34, 0.34, -0.34, 0.34, 0.34, -0.34, 0.34], 0.02);
  for (const s of [-1, 1]) d.floor([0.08, s * 0.22, 0.36, s * 0.22, 0.36, s * 0.34, 0.08, s * 0.34], 0.05);
  if (lvl >= 1) {
    for (let u = -0.3; u < 0.35; u += 0.1) d.seam([u, -0.34, u, 0.34], 0.7);
    for (const v of [-0.17, 0.17]) d.seam([-0.34, v, 0.34, v], 0.7);
    // lane markings: dashed yellow centre line from the gate to the reactor pad
    g.strokeStyle = 'rgba(214,176,52,0.55)'; g.lineWidth = h * 2.2; g.setLineDash([d.x(0.045), d.x(0.035)]);
    g.beginPath(); g.moveTo(d.x(0.38), 0); g.lineTo(d.x(0.2), 0); g.stroke(); g.setLineDash([]);
  }
  // reactor pad: octagonal plate with hazard corners, coolant mains to the keep and the turret wells
  {
    const ru = 0.08, r = 0.13 * S;
    const oct = new Path2D(); for (let i = 0; i < 8; i++) { const a = (i / 8) * P2 + P2 / 16; oct.lineTo(d.x(ru) + Math.cos(a) * r, Math.sin(a) * r); } oct.closePath();
    g.fillStyle = shade(d.pal.dark, 0.0); g.fill(oct); g.lineWidth = h * 1.4; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.stroke(oct);
    g.save(); g.clip(oct); g.lineWidth = h * 4; g.strokeStyle = 'rgba(255,255,255,0.18)'; g.save(); g.translate(h * 1.4, h * 1.4); g.stroke(oct); g.restore(); g.restore();
    if (lvl >= 2) {
      for (let i = 0; i < 4; i++) { const a = (i / 4) * P2 + P2 / 8; g.save(); g.translate(d.x(ru) + Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82); g.rotate(a + Math.PI / 2); hazard(g, -r * 0.14, -r * 0.05, r * 0.28, r * 0.1, d.o, false); g.restore(); }
      d.boltRing(ru, 0, r * 0.62, 12, 0.026);
      d.cable([ru, 0.0, 0.0, 0.09, -0.01, 0.15], 0.1); d.cable([ru, 0.0, 0.0, -0.09, -0.01, -0.15], 0.1);
      d.cable([ru, 0.0, 0.14, 0.0, 0.3, 0.0], 0.08);
    }
  }
  // fuel / ammunition tanks flanking the lane ahead of the reactor pad
  if (lvl >= 2) for (const s of [-1, 1]) {
    const tp = d.path([0.34, s * 0.055, 0.34, s * 0.1, 0.18, s * 0.1, 0.18, s * 0.055], true);
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.save(); g.translate(h * 3, h * 4); g.fill(tp); g.restore();
    g.fillStyle = shade(d.pal.dark, 0.1); g.fill(tp); g.lineWidth = h; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.stroke(tp);
    g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(d.x(0.18), d.y(s * 0.0 + (s > 0 ? 0.055 : 0.055)) - (s > 0 ? 0 : 0) , d.x(0.16), h * 1.5);
    for (const u of [0.22, 0.26, 0.3]) d.seam([u, s * 0.055, u, s * 0.1], 1.2);
    d.hatch(0.26, s * 0.0775, 0.09, 0);
  }
  // ---- side depots: long roofed blocks along the inner walls with hatches, vents and ID stripes
  for (const s of [-1, 1]) {
    d.plate([0.07, s * 0.225, 0.07, s * 0.335, -0.3, s * 0.335, -0.3, s * 0.225], -0.02, 0.9);
    d.seam([-0.06, s * 0.23, -0.06, s * 0.33], 1); d.seam([-0.18, s * 0.23, -0.18, s * 0.33], 1);
    d.seam([0.07, s * 0.28, -0.3, s * 0.28], 0.8);
    if (lvl >= 2) {
      d.vent(-0.12, s * 0.255, 0.07 * X, 0.04 * Y, 4); d.vent(-0.24, s * 0.255, 0.07 * X, 0.04 * Y, 4);
      d.hatch(0.0, s * 0.255, 0.13, s); d.hatch(-0.12, s * 0.31, 0.11, 0.5); d.hatch(-0.24, s * 0.31, 0.11, 1);
      d.accent(0.065, s * 0.24, 0.065, s * 0.32, h * 3.4);
    }
    if (lvl >= 3) { d.rivets(0.05, s * 0.23, -0.29, s * 0.23, 9, 0.02); d.rivets(0.05, s * 0.33, -0.29, s * 0.33, 9, 0.02); }
  }
  // ---- keep: stepped tiers (outer deck, inner deck, raised citadel block), glacis, comms farm
  d.plate([0.02, -0.2, 0.02, 0.2, -0.37, 0.2, -0.37, -0.2], 0.04, 1.0);
  d.plate([-0.01, -0.165, -0.01, 0.165, -0.34, 0.165, -0.34, -0.165], -0.02, 0.9);
  d.plate([-0.2, -0.1, -0.2, 0.1, -0.33, 0.12, -0.33, -0.12], 0.1, 0.9);
  d.seam([-0.1, -0.165, -0.1, 0.165]); d.seam([-0.25, -0.165, -0.25, 0.165]); d.seam([-0.17, -0.2, -0.17, 0.2], 0.6);
  if (lvl >= 2) {
    for (const s of [-1, 1]) {
      d.hatch(-0.04, s * 0.13, 0.19, s); d.hatch(-0.3, s * 0.15, 0.15, 0.7 * s);
      d.vent(-0.29, s * 0.07, 0.045 * X, 0.05 * Y, 4, 0.12);
      d.fins(-0.12, s * 0.19, 0.09 * X, 0.025 * Y, 7);
    }
    d.sensors(-0.33, 0, 0.55, 3, 0.1);
    d.mast(-0.35, -0.17, 2.4, Math.PI * 0.9); d.mast(-0.35, 0.17, 3.2, Math.PI * 1.1, '#ffd060'); d.mast(-0.37, 0.0, 1.6, Math.PI);
    d.dish(-0.255, -0.12, 0.45, 0.4);
  }
  if (lvl >= 3) { d.rivets(0.0, -0.18, -0.36, -0.18, 11); d.rivets(0.0, 0.18, -0.36, 0.18, 11); d.stencil(-0.33, 0.0, 'CF-01', 0.26, 0.5); }
  // ---- walls: wall-walk rails, gun galleries, ID bands, sally ports
  if (lvl >= 2) {
    for (const s of [-1, 1]) {
      d.rail(-0.3, s * 0.365, 0.3, s * 0.365, 10);
      d.rail(s * 0.0 - 0.355, s * 0.3, -0.355, s * 0.0, 1);
    }
    d.rail(-0.36, -0.3, -0.36, 0.3, 9);
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) d.glowSlit(-0.27 + i * 0.13, s * 0.44, -0.27 + i * 0.13 + 0.05, s * 0.44, h * 1.4, 0.4);
    d.door(0.0, -0.405, 0.9, 0.34); d.door(0.0, 0.405, 0.9, 0.34);
  }
  d.seam([-0.34, -0.405, 0.34, -0.405], 0.8); d.seam([-0.34, 0.405, 0.34, 0.405], 0.8);
  // ---- rear engine block: panel breaks, hazard rim, exhaust ports, service rail
  d.seam([-0.355, -0.37, -0.355, 0.37], 1.2);
  d.seam([-0.49, -0.12, -0.35, -0.12], 0.8); d.seam([-0.49, 0.12, -0.35, 0.12], 0.8);
  if (lvl >= 2) {
    d.haz(-0.357, 0.0, 0.8 * d.X * 0.12, 0.7 * Y * 0.12, true);
    d.rail(-0.46, -0.36, -0.46, 0.36, 9);
    for (const s of [-1, 1]) { d.hatch(-0.425, s * 0.3, 0.16, s); d.glowSlit(-0.5, s * 0.17, -0.5, s * 0.07, h * 1.6, 0.35); }
  }
  // ---- gatehouse: portcullis grid, hazard chevrons, searchlights
  d.plate([0.49, -0.12, 0.49, 0.12, 0.44, 0.14, 0.4, 0.14, 0.4, -0.14, 0.44, -0.12], 0.04, 0.8);
  d.seam([0.44, -0.13, 0.44, 0.13]);
  if (lvl >= 2) {
    d.seam([0.4, 0, 0.49, 0], 1.2);
    for (let i = -2; i <= 2; i++) d.seam([0.4, i * 0.045, 0.44, i * 0.045], 0.7);
    d.searchlight(0.42, -0.16, 0.13, 0); d.searchlight(0.42, 0.16, 0.13, 0); d.accent(0.4, -0.14, 0.4, 0.14, h * 3);
    d.haz(0.375, 0.0, 0.1, 0.55 * Y * 0.2, true);
  }
  // ---- bastions: bolt rings, panel splits, point-defence blisters on the faces
  for (const sx of [1, -1]) for (const sy of [-1, 1]) {
    const bu = sx * 0.385, bv = sy * 0.385;
    d.boltRing(bu, bv, 0.15 * S, 12, 0.03);
    d.ring(bu, bv, 0.18 * S, 1.4);
    d.seam([bu - 0.1 * sx, bv, bu + 0.1 * sx, bv]); d.seam([bu, bv - 0.1 * sy, bu, bv + 0.1 * sy]);
    if (lvl >= 2) {
      d.blister(sx * 0.455, sy * 0.3, 0.17, sx > 0 ? 0 : Math.PI);
      d.blister(sx * 0.3, sy * 0.455, 0.17, sy * Math.PI * 0.5);
    }
  }
}

/* --------------------------------------------------------------------------------------------- Weaver Titan */

function arachne(d: D, hull: Path2D): void {
  const lvl = d.lvl, h = d.h, g = d.g;
  const cx = -0.06, rx = 0.4, ry = 0.36;
  d.weather(hull, 37, [[-0.44, -0.15], [-0.44, 0.15]], 16);
  // ---- chitin shell: two tiers of overlapping scutes (outer rim scales over an inner ring over the dorsal cap)
  const N = 14;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * P2, a1 = ((i + 1) / N) * P2, am = (a0 + a1) / 2;
    if (Math.cos(am) > 0.78) continue;
    d.scute(d.sector(cx, rx, ry, a0 + 0.012, a1 - 0.012, 0.34, 0.66), i % 2 ? 0.11 : 0.07, i % 2 === 0);
  }
  for (let i = 0; i < N; i++) {
    const a0 = ((i + 0.5) / N) * P2, a1 = ((i + 1.5) / N) * P2, am = (a0 + a1) / 2;
    if (Math.cos(am) > 0.8) continue;
    d.scute(d.sector(cx, rx, ry, a0 + 0.01, a1 - 0.01, 0.6, 0.97), i % 2 ? 0.08 : 0.13, i % 2 === 1);
    if (lvl >= 3) {
      const ux = cx + Math.cos(am) * rx * 0.8, vy = Math.sin(am) * ry * 0.8;
      d.rivets(ux - Math.sin(am) * 0.01, vy, ux + Math.sin(am) * 0.01, vy, 2, 0.02);
    }
    if (lvl >= 2 && i % 3 === 0) {
      d.glowSlit(cx + Math.cos(am) * rx * 0.68, Math.sin(am) * ry * 0.68, cx + Math.cos(am) * rx * 0.9, Math.sin(am) * ry * 0.9, h * 1.3, 0.33);
    }
  }
  // collar rings around the dorsal gun's barbette
  g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = h * 1.2;
  for (const r of [0.22, 0.27, 0.32]) { g.beginPath(); g.ellipse(d.x(cx), 0, d.x(r), d.y(r), 0, 0, P2); g.stroke(); }
  if (lvl >= 2) d.boltRing(cx, 0, d.x(0.25), 24, 0.03);
  // ---- spine crest from the collar to the tail: stepped plates with a dorsal channel
  d.plate([-0.2, -0.05, -0.34, -0.065, -0.4, -0.04, -0.4, 0.04, -0.34, 0.065, -0.2, 0.05], 0.06, 0.8);
  d.plate([0.14, -0.045, 0.14, 0.045, 0.1, 0.07, 0.04, 0.07, 0.04, -0.07, 0.1, -0.07], 0.08, 0.8);
  d.seam([-0.4, 0, -0.2, 0], 1.2);
  if (lvl >= 2) {
    for (const s of [-1, 1]) {
      d.fins(-0.3, s * 0.2, 0.11 * d.X, 0.075 * d.Y, 6);
      d.vent(-0.2, s * 0.29, 0.1 * d.X, 0.06 * d.Y, 4, 0.18);
      d.hatch(-0.12, s * 0.17, 0.15, s);
      d.hatch(0.1, s * 0.22, 0.11, 0.7 * s);
    }
    d.vent(-0.455, 0, 0.065 * d.X, 0.14 * d.Y, 5, 0.25);
    d.rail(-0.44, -0.09, -0.4, -0.09, 2); d.rail(-0.44, 0.09, -0.4, 0.09, 2);
    // hub feeds: bolt ring, collar and a cable into the shell
    for (const a of [0.5, 1.1, 1.85, 2.6]) for (const s of [-1, 1]) {
      const hu = cx + Math.cos(a) * rx * 0.97, hv = s * Math.sin(a) * ry * 0.97;
      d.boltRing(hu, hv, d.x(0.062), 10, 0.022);
      d.ring(hu, hv, d.x(0.075));
      d.cable([hu, hv, cx + Math.cos(a) * rx * 0.62, s * Math.sin(a) * ry * 0.62], 0.05);
    }
  }
  // ---- cab: layered brow, sensor eyes, intakes, antennae, PD blisters
  d.plate([0.46, -0.05, 0.46, 0.05, 0.4, 0.085, 0.3, 0.085, 0.3, -0.085, 0.4, -0.085], 0.06, 0.7);
  d.plate([0.3, -0.095, 0.3, 0.095, 0.22, 0.1, 0.22, -0.1], 0.0, 0.6);
  d.seam([0.4, -0.085, 0.4, 0.085]); d.seam([0.3, -0.1, 0.3, 0.1]);
  if (lvl >= 2) {
    d.sensors(0.44, 0, 0.5, 4, 0.12);
    d.sensors(0.265, 0, 0.5, 3, 0.1);
    for (const s of [-1, 1]) {
      d.vent(0.36, s * 0.07, 0.05 * d.X, 0.035 * d.Y, 3);
      d.mast(0.25, s * 0.095, 1.8, s * Math.PI * 0.6, s > 0 ? '#ffd060' : '#ff5040');
      d.blister(0.215, s * 0.14, 0.17, s * Math.PI * 0.5);
    }
  }
  d.accent(0.2, -0.1, 0.2, 0.1, h * 4);
  d.stencil(-0.275, 0.0, 'WT-07', 0.22, 0.5);
}

/** Called after the base footart details for size-5 shapes. `hull` is the hull outline in the unit box. */
export function titanDetail(g: Ctx, L: UnitLayout, pal: TeamPal, o: number, hull: Path2D): void {
  const d = new D(g, L, pal, o, curPx);
  if (d.lvl === 0) return;
  g.save();
  // everything stays inside the hull outline (silhouette is untouched)
  const hp = new Path2D(); hp.addPath(hull, new DOMMatrix([L.X, 0, 0, L.Y, 0, 0]));
  g.clip(hp);
  switch (L.shape) {
    case 'colossal': colossal(d, hull); break;
    case 'citadel': citadel(d, hull); break;
    case 'arachne': arachne(d, hull); break;
  }
  g.restore();
  g.beginPath();
}
