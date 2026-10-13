// Superstructure: hull-level engineering detail laid out around the turrets so a hull of any size reads as a
// designed machine rather than an empty box. Turret plinths / sponson housings / cable runs join the guns to the
// hull; an engine deck, crew hatches, vision blocks, stowage, track guards, tow hooks, lights and antennas fill the
// free deck at a density proportional to hull size, with role-specific kit (raider jerrycans, riot hazard plates,
// artillery shell racks, support crosses and masts, tank appliqué slabs). Everything is baked into the cached hull
// sprite. Local frame: nose +x, +y right, units = cells.

import { armourTier, type BuildProfile } from './profile.ts';
import type { MountSlot } from './unitart.ts';
import { METAL, OUTLINE, ctx2d, makeCanvas, rgba, roundRect, shade, type Ctx, type TeamPal } from './palette.ts';

export interface SuperIn {
  S: number;
  /** footprint length / width (cells) */
  X?: number;
  Y?: number;
  shape: string;
  mob: string;
  air: boolean;
  mounts: MountSlot[];
  /** mount indices that ride animated parts (skip their plinths) */
  riding: Set<number>;
  hull: Path2D;
  P: BuildProfile;
  pal: TeamPal;
  o: number;
  /** emissive colour */
  E: string;
  px: number;
  /** muzzle length (multiples of d) per mount, for keeping the barrel lane clear */
  muzzle: number[];
}

/* ------------------------------------------------------------------------------------------- hull geometry */

interface Geo {
  /** half width (cells) at x, sampled */
  half: (x: number) => number;
  /** front / rear edge x at lateral offset y */
  front: (y: number) => number;
  rear: (y: number) => number;
  /** max half width over the hull */
  maxHalf: number;
}

const geoCache = new Map<string, Geo>();
let scratch: Ctx | null = null;

function geometry(shape: string, S: number, hull: Path2D, D = S): Geo {
  const key = shape + '|' + S + '|' + D;
  const hit = geoCache.get(key);
  if (hit) return hit;
  scratch ??= ctx2d(makeCanvas(2, 2));
  const g = scratch;
  const N = Math.round(72 * Math.max(1, D / S)), E = 0.56 * D, st = (2 * E) / N;
  const halfs: number[] = [], fr: number[] = [], rr: number[] = [];
  for (let i = 0; i <= N; i++) {
    const x = -E + i * st;
    let h = 0;
    for (let y = E; y >= 0; y -= st * 0.5) if (g.isPointInPath(hull, x, y) || g.isPointInPath(hull, x, -y)) { h = y; break; }
    halfs.push(h);
  }
  for (let i = 0; i <= N; i++) {
    const y = i * st * 0.5 * (E / (E * 0.5)) * 0.5; // 0..E
    let f = -E, r = E;
    for (let x = E; x >= -E; x -= st * 0.5) if (g.isPointInPath(hull, x, y)) { f = x; break; }
    for (let x = -E; x <= E; x += st * 0.5) if (g.isPointInPath(hull, x, y)) { r = x; break; }
    fr.push(f); rr.push(r);
  }
  const at = (arr: number[], v: number, lo: number, span: number) => {
    const t = Math.max(0, Math.min(arr.length - 1, ((v - lo) / span) * (arr.length - 1)));
    const i = Math.floor(t), k = t - i;
    return arr[i] * (1 - k) + (arr[Math.min(arr.length - 1, i + 1)] ?? arr[i]) * k;
  };
  const geo: Geo = {
    half: (x) => at(halfs, x, -E, 2 * E),
    front: (y) => at(fr, Math.abs(y), 0, E),
    rear: (y) => at(rr, Math.abs(y), 0, E),
    maxHalf: Math.max(...halfs),
  };
  geoCache.set(key, geo);
  return geo;
}

/* ------------------------------------------------------------------------------------------- occupancy */

interface Circ { x: number; y: number; r: number }
interface Box { x0: number; y0: number; x1: number; y1: number }

class Space {
  circs: Circ[] = [];
  boxes: Box[] = [];
  hull: Path2D;
  constructor(hull: Path2D) { this.hull = hull; }
  inside(x: number, y: number): boolean { return scratch!.isPointInPath(this.hull, x, y); }
  /** rect centred at (x, y), w along x, h along y */
  fits(x: number, y: number, w: number, h: number, m: number): boolean {
    const x0 = x - w / 2, x1 = x + w / 2, y0 = y - h / 2, y1 = y + h / 2;
    for (const [px, py] of [[x0 - m, y0 - m], [x1 + m, y0 - m], [x0 - m, y1 + m], [x1 + m, y1 + m], [x, y0 - m], [x, y1 + m], [x0 - m, y], [x1 + m, y]]) if (!this.inside(px, py)) return false;
    return this.clear(x0, y0, x1, y1);
  }
  clear(x0: number, y0: number, x1: number, y1: number): boolean {
    for (const c of this.circs) {
      const dx = Math.max(x0 - c.x, 0, c.x - x1), dy = Math.max(y0 - c.y, 0, c.y - y1);
      if (dx * dx + dy * dy < c.r * c.r) return false;
    }
    for (const b of this.boxes) if (x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0) return false;
    return true;
  }
  take(x: number, y: number, w: number, h: number, pad = 0): void { this.boxes.push({ x0: x - w / 2 - pad, y0: y - h / 2 - pad, x1: x + w / 2 + pad, y1: y + h / 2 + pad }); }
}

/* ------------------------------------------------------------------------------------------- primitives */

const P2 = Math.PI * 2;
function dot(g: Ctx, x: number, y: number, r: number, c: string): void { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, P2); g.fill(); }

/** Raised block: contact shadow, fill, lit top bevel, outline. */
function raised(g: Ctx, p: Path2D, fill: string | CanvasGradient, o: number, lift: number): void {
  g.save(); g.translate(lift * 0.6, lift); g.fillStyle = 'rgba(0,0,0,0.42)'; g.fill(p); g.restore();
  g.fillStyle = fill; g.fill(p);
  g.save(); g.clip(p);
  g.translate(o * 0.7, o * 0.7); g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = o * 1.4; g.stroke(p);
  g.restore();
  g.lineWidth = o * 0.75; g.strokeStyle = OUTLINE; g.stroke(p);
}
function rrect(x: number, y: number, w: number, h: number, r: number): Path2D { const p = new Path2D(); roundRect(p, x - w / 2, y - h / 2, w, h, r); return p; }
function octagon(x: number, y: number, R: number): Path2D {
  const p = new Path2D();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * P2 + P2 / 16; i ? p.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R) : p.moveTo(x + Math.cos(a) * R, y + Math.sin(a) * R); }
  p.closePath();
  return p;
}
function lgrad(g: Ctx, x0: number, y0: number, x1: number, y1: number, a: string, b: string): CanvasGradient {
  const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr;
}
function bolt(g: Ctx, x: number, y: number, r: number): void { dot(g, x, y, r, 'rgba(0,0,0,0.6)'); dot(g, x - r * 0.3, y - r * 0.3, r * 0.5, 'rgba(255,255,255,0.45)'); }
function grille(g: Ctx, x: number, y: number, w: number, h: number, o: number, alongX: boolean): void {
  const p = rrect(x, y, w, h, Math.min(w, h) * 0.18);
  g.fillStyle = '#0b0e11'; g.fill(p);
  g.save(); g.clip(p);
  const n = Math.max(3, Math.round((alongX ? w : h) / (o * 3.2)));
  g.strokeStyle = 'rgba(150,165,180,0.45)'; g.lineWidth = o * 0.55;
  g.beginPath();
  for (let i = 1; i < n; i++) {
    if (alongX) { const xx = x - w / 2 + (w * i) / n; g.moveTo(xx, y - h / 2); g.lineTo(xx, y + h / 2); }
    else { const yy = y - h / 2 + (h * i) / n; g.moveTo(x - w / 2, yy); g.lineTo(x + w / 2, yy); }
  }
  g.stroke();
  g.restore();
  g.lineWidth = o * 0.6; g.strokeStyle = OUTLINE; g.stroke(p);
}
function hatch(g: Ctx, x: number, y: number, r: number, o: number, pal: TeamPal): void {
  const p = new Path2D(); p.arc(x, y, r, 0, P2);
  raised(g, p, lgrad(g, x - r, y - r, x + r, y + r, shade(pal.light, -0.12), shade(pal.dark, -0.05)), o, r * 0.25);
  g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = o * 0.5; g.beginPath(); g.arc(x, y, r * 0.66, 0, P2); g.stroke();
  // hinge + handle
  g.fillStyle = METAL.dark; g.fillRect(x - r * 1.05, y - r * 0.28, r * 0.3, r * 0.56);
  g.strokeStyle = METAL.light; g.lineWidth = o * 0.6; g.beginPath(); g.moveTo(x + r * 0.2, y - r * 0.3); g.lineTo(x + r * 0.45, y); g.lineTo(x + r * 0.2, y + r * 0.3); g.stroke();
}
function visionBlock(g: Ctx, x: number, y: number, w: number, h: number, o: number, E: string): void {
  const p = rrect(x, y, w, h, Math.min(w, h) * 0.3);
  g.fillStyle = METAL.dark; g.fill(p); g.lineWidth = o * 0.5; g.strokeStyle = OUTLINE; g.stroke(p);
  const q = rrect(x + w * 0.08, y, w * 0.5, h * 0.7, Math.min(w, h) * 0.2);
  g.fillStyle = '#0d1a24'; g.fill(q);
  g.fillStyle = rgba(E, 0.75); g.fillRect(x + w * 0.05, y - h * 0.25, w * 0.15, h * 0.5);
}
function lamp(g: Ctx, x: number, y: number, r: number, o: number, col: string, guard: boolean): void {
  dot(g, x, y, r * 1.35, OUTLINE);
  dot(g, x, y, r, col);
  dot(g, x + r * 0.25, y - r * 0.25, r * 0.4, 'rgba(255,255,255,0.85)');
  if (guard) { g.strokeStyle = METAL.light; g.lineWidth = o * 0.5; g.beginPath(); g.moveTo(x + r * 1.6, y - r * 1.4); g.lineTo(x + r * 1.6, y + r * 1.4); g.moveTo(x - r * 0.6, y - r * 1.4); g.lineTo(x + r * 1.6, y - r * 1.4); g.moveTo(x - r * 0.6, y + r * 1.4); g.lineTo(x + r * 1.6, y + r * 1.4); g.stroke(); }
}
function towHook(g: Ctx, x: number, y: number, r: number, o: number, dir: number): void {
  g.lineCap = 'round';
  g.strokeStyle = OUTLINE; g.lineWidth = r * 0.75;
  g.beginPath(); g.arc(x + dir * r * 0.2, y, r, dir > 0 ? -Math.PI / 2 : Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI * 1.5); g.stroke();
  g.strokeStyle = '#c9a040'; g.lineWidth = r * 0.4; g.stroke();
  g.fillStyle = METAL.dark; g.fillRect(x - r * 0.5, y - r * 1.25, r * 0.8, r * 0.5); g.fillRect(x - r * 0.5, y + r * 0.75, r * 0.8, r * 0.5);
  void o;
}
function antenna(g: Ctx, x: number, y: number, len: number, ang: number, o: number, tip: string): void {
  const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
  const cx = x + Math.cos(ang) * len * 0.55 + Math.cos(ang + Math.PI / 2) * len * 0.05, cy = y + Math.sin(ang) * len * 0.55 + Math.sin(ang + Math.PI / 2) * len * 0.05;
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = o * 0.9;
  g.beginPath(); g.moveTo(x + o, y + o * 1.5); g.quadraticCurveTo(cx + o * 2, cy + o * 3, ex + o * 2.5, ey + o * 4); g.stroke();
  g.strokeStyle = OUTLINE; g.lineWidth = o * 0.85;
  g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(cx, cy, ex, ey); g.stroke();
  g.strokeStyle = METAL.light; g.lineWidth = o * 0.35; g.stroke();
  dot(g, x, y, o * 1.5, OUTLINE); dot(g, x, y, o * 1.0, METAL.base);
  dot(g, ex, ey, o * 0.8, tip);
}
function strapBox(g: Ctx, x: number, y: number, w: number, h: number, o: number, fill: string, strap: string): void {
  const p = rrect(x, y, w, h, Math.min(w, h) * 0.18);
  raised(g, p, lgrad(g, x - w / 2, y - h / 2, x + w / 2, y + h / 2, shade(fill, 0.12), shade(fill, -0.18)), o, Math.min(w, h) * 0.18);
  g.fillStyle = strap;
  for (const k of [-0.28, 0.28]) g.fillRect(x + k * w - o * 0.6, y - h / 2, o * 1.2, h);
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = o * 0.4; g.beginPath(); g.moveTo(x - w * 0.45, y + h * 0.18); g.lineTo(x + w * 0.45, y + h * 0.18); g.stroke();
}
function hazardPlate(g: Ctx, x: number, y: number, w: number, h: number, o: number): void {
  const p = rrect(x, y, w, h, Math.min(w, h) * 0.12);
  raised(g, p, '#e8b81c', o, Math.min(w, h) * 0.15);
  g.save(); g.clip(p);
  g.strokeStyle = '#17140c'; const u = Math.min(w, h); g.lineWidth = u * 0.28;
  g.beginPath(); for (let i = -8; i < 12; i++) { g.moveTo(x - w / 2 + i * u * 0.55, y + h / 2); g.lineTo(x - w / 2 + i * u * 0.55 + h, y - h / 2); } g.stroke();
  g.restore();
  g.lineWidth = o * 0.6; g.strokeStyle = OUTLINE; g.stroke(p);
}
function shellRack(g: Ctx, x: number, y: number, w: number, h: number, o: number, alongX: boolean): void {
  const p = rrect(x, y, w, h, Math.min(w, h) * 0.15);
  raised(g, p, METAL.dark, o, Math.min(w, h) * 0.15);
  const n = Math.max(2, Math.floor((alongX ? w : h) / (Math.min(w, h) * 0.75)));
  const r = Math.min(w, h) * 0.3;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    const cx = alongX ? x - w / 2 + w * f : x, cy = alongX ? y : y - h / 2 + h * f;
    dot(g, cx, cy, r * 1.15, OUTLINE); dot(g, cx, cy, r, '#c9a040'); dot(g, cx, cy, r * 0.45, '#8a3a2a'); dot(g, cx - r * 0.35, cy - r * 0.35, r * 0.25, 'rgba(255,255,255,0.6)');
  }
}
function jerrycan(g: Ctx, x: number, y: number, w: number, h: number, o: number, col: string): void {
  const p = rrect(x, y, w, h, Math.min(w, h) * 0.2);
  raised(g, p, col, o, Math.min(w, h) * 0.15);
  g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = o * 0.45;
  g.beginPath(); g.moveTo(x - w * 0.3, y - h * 0.3); g.lineTo(x + w * 0.3, y + h * 0.3); g.moveTo(x + w * 0.3, y - h * 0.3); g.lineTo(x - w * 0.3, y + h * 0.3); g.stroke();
}
function crossBox(g: Ctx, x: number, y: number, w: number, h: number, o: number): void {
  const p = rrect(x, y, w, h, Math.min(w, h) * 0.15);
  raised(g, p, '#e6e9ec', o, Math.min(w, h) * 0.15);
  const u = Math.min(w, h) * 0.5;
  g.fillStyle = '#d23030'; g.fillRect(x - u * 0.6, y - u * 0.2, u * 1.2, u * 0.4); g.fillRect(x - u * 0.2, y - u * 0.6, u * 0.4, u * 1.2);
}
function slabBlock(g: Ctx, x: number, y: number, w: number, h: number, o: number, pal: TeamPal): void {
  const p = rrect(x, y, w, h, Math.min(w, h) * 0.1);
  raised(g, p, lgrad(g, x - w / 2, y - h / 2, x + w / 2, y + h / 2, shade(pal.light, -0.18), shade(pal.dark, -0.15)), o, Math.min(w, h) * 0.2);
  const r = Math.min(w, h) * 0.09;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) bolt(g, x + sx * (w / 2 - r * 2.2), y + sy * (h / 2 - r * 2.2), r);
}
function trackLinks(g: Ctx, x: number, y: number, w: number, h: number, o: number, alongX: boolean): void {
  const n = Math.max(2, Math.round((alongX ? w : h) / (Math.min(w, h) * 0.55)));
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    const lw = alongX ? w / n : w, lh = alongX ? h : h / n;
    const cx = alongX ? x - w / 2 + w * f : x, cy = alongX ? y : y - h / 2 + h * f;
    const p = rrect(cx, cy, lw * 0.86, lh * 0.86, Math.min(lw, lh) * 0.15);
    g.fillStyle = METAL.rubberHi; g.fill(p); g.lineWidth = o * 0.5; g.strokeStyle = OUTLINE; g.stroke(p);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    if (alongX) g.fillRect(cx - lw * 0.08, cy - lh * 0.35, lw * 0.16, lh * 0.7); else g.fillRect(cx - lw * 0.35, cy - lh * 0.08, lw * 0.7, lh * 0.16);
  }
}
function exhaust(g: Ctx, x: number, y: number, r: number, o: number): void {
  const sg = g.createRadialGradient(x - r, y, 0, x - r, y, r * 3);
  sg.addColorStop(0, 'rgba(0,0,0,0.45)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sg; g.beginPath(); g.arc(x - r, y, r * 3, 0, P2); g.fill();
  dot(g, x, y, r * 1.25, OUTLINE); dot(g, x, y, r, METAL.base); dot(g, x, y, r * 0.62, '#07080a');
  g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = o * 0.4; g.beginPath(); g.arc(x, y, r * 0.85, Math.PI, Math.PI * 1.6); g.stroke();
}
function cable(g: Ctx, pts: number[], w: number, o: number): void {
  g.lineCap = 'round'; g.lineJoin = 'round';
  const path = () => { g.beginPath(); g.moveTo(pts[0], pts[1]); if (pts.length >= 6) g.quadraticCurveTo(pts[2], pts[3], pts[4], pts[5]); else g.lineTo(pts[2], pts[3]); };
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = w * 1.2; g.save(); g.translate(w * 0.4, w * 0.6); path(); g.stroke(); g.restore();
  g.strokeStyle = OUTLINE; g.lineWidth = w; path(); g.stroke();
  g.strokeStyle = '#3a3f45'; g.lineWidth = w * 0.6; path(); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = w * 0.18; path(); g.stroke();
  void o;
}

/* ------------------------------------------------------------------------------------------------ main */

const AIR = new Set(['airframe', 'interceptor', 'bomber', 'delta', 'carrier']);
const WALKER = new Set(['titan', 'colossal']);

/** Turret plinths, sponson housings, collars and cable runs: the layer directly under the turrets. */
export function drawTurretSeats(g: Ctx, I: SuperIn): void {
  const { S, mounts, pal, o, E } = I;
  if (S >= 4) return; // giants seat their guns in barbettes
  let main = -1;
  for (let i = 0; i < mounts.length; i++) {
    const m = mounts[i];
    if (!m.turret || I.riding.has(i) || Math.abs(m.y) > 0.08 * S) continue;
    if (main < 0 || m.d > mounts[main].d) main = i;
  }
  const geo = geometry(I.shape, S, I.hull, Math.max(S, I.X ?? S, I.Y ?? S));
  for (let i = 0; i < mounts.length; i++) {
    const m = mounts[i];
    if (!m.turret || I.riding.has(i)) continue;
    const r = m.d * 0.5;
    if (i === main && S >= 2) {
      // turret deck: raised armoured plinth; a light gun on a heavy hull sits on a proper cupola so it reads intentional
      const R = Math.max(r * 1.28, 0.16 * S);
      const pl = octagon(m.x, m.y, R);
      raised(g, pl, lgrad(g, m.x - R, m.y - R, m.x + R, m.y + R, shade(pal.body, 0.05), shade(pal.dark, -0.2)), o, R * 0.08);
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = o * 0.5;
      g.beginPath(); g.arc(m.x, m.y, (R + r) / 2 + (R - r) * 0.2, 0, P2); g.stroke();
      const nb = S >= 3 ? 12 : 8;
      for (let k = 0; k < nb; k++) { const a = (k / nb) * P2 + 0.2; bolt(g, m.x + Math.cos(a) * R * 0.86, m.y + Math.sin(a) * R * 0.86, Math.max(o * 0.5, R * 0.04)); }
      // vision blocks round the front arc of the deck
      const band = R - r;
      if (band > 0.035 * S && I.px >= 12) {
        for (const a of [-0.75, 0.75, -1.5, 1.5]) {
          const rr = r + band * 0.5;
          g.save(); g.translate(m.x + Math.cos(a) * rr, m.y + Math.sin(a) * rr); g.rotate(a);
          visionBlock(g, 0, 0, band * 0.42, band * 0.75, o, E);
          g.restore();
        }
      }
      // armoured cable conduit from the turret ring down into the hull
      if (I.px >= 12) {
        const a0 = Math.PI * 0.78, x0 = m.x + Math.cos(a0) * R * 0.9, y0 = m.y + Math.sin(a0) * R * 0.9;
        const x2 = m.x - R - 0.08 * S, y2 = m.y + R * 0.95;
        if (geo.half(x2) > Math.abs(y2) + 0.03 * S) cable(g, [x0, y0, x2 + 0.02 * S, y0 + 0.02 * S, x2, y2], Math.max(o * 1.2, 0.022 * S), o);
      }
      continue;
    }
    const flank = Math.abs(m.y) > 0.12 * S;
    const sgn = Math.sign(m.y) || 1;
    if (flank && !I.air) {
      // sponson: armoured housing joining the side turret to the hull edge
      const edge = geo.half(m.x);
      const yIn = m.y - sgn * r * 0.55, yOut = sgn * Math.max(Math.abs(m.y) + r * 0.55, Math.min(edge, Math.abs(m.y) + r * 1.05));
      const h = Math.abs(yOut - yIn), w = m.d * 1.12;
      const sp = rrect(m.x - r * 0.05, (yIn + yOut) / 2, w, h, w * 0.22);
      raised(g, sp, lgrad(g, m.x, yIn, m.x, yOut, shade(pal.body, 0.04), shade(pal.dark, -0.18)), o, r * 0.12);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = o * 0.45;
      g.beginPath(); g.moveTo(m.x - w * 0.42, yOut - sgn * h * 0.18); g.lineTo(m.x + w * 0.38, yOut - sgn * h * 0.18); g.stroke();
      for (const k of [-0.36, 0.36]) bolt(g, m.x + k * w, yOut - sgn * h * 0.1, Math.max(o * 0.45, r * 0.06));
    } else if (flank && I.air) {
      // wing pylon: strut from the hardpoint to the fuselage
      const p = rrect(m.x - r * 0.1, m.y / 2, m.d * 0.42, Math.abs(m.y), m.d * 0.12);
      raised(g, p, METAL.dark, o, r * 0.08);
    }
    // collar ring
    const C = new Path2D(); C.arc(m.x, m.y, r * 1.14, 0, P2);
    raised(g, C, lgrad(g, m.x - r, m.y - r, m.x + r, m.y + r, METAL.light, METAL.dark), o, r * 0.08);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * P2 + 0.3; bolt(g, m.x + Math.cos(a) * r * 1.03, m.y + Math.sin(a) * r * 1.03, Math.max(o * 0.4, r * 0.05)); }
  }
}

/** Engine deck, crew hatches, vision blocks, stowage, guards, hooks, lights, antennas. */
export function drawSuperstructure(g: Ctx, I: SuperIn): void {
  const { S, P, pal, o, E, mounts } = I;
  if (S < 2) return;
  const geo = geometry(I.shape, S, I.hull, Math.max(S, I.X ?? S, I.Y ?? S));
  const sp = new Space(I.hull);
  const air = I.air || AIR.has(I.shape);
  const walker = WALKER.has(I.shape) || I.mob === 'titanlegs';
  const ground = !air;
  const tracked = I.mob === 'treads' || I.mob === 'halftrack' || I.mob === 'megatracks';
  const wheeled = I.mob === 'wheels' || I.mob === 'halftrack';
  const fine = I.px >= 12; // tiny details only when they can resolve
  const u = 0.1 * (1 + 0.12 * (S - 2)) * (S >= 4 ? 1.25 : 1);
  for (let i = 0; i < mounts.length; i++) {
    const m = mounts[i];
    if (I.riding.has(i)) continue;
    if (m.mod || S < 4) sp.circs.push({ x: m.x, y: m.y, r: m.d * (m.turret ? 0.62 : 0.5) + u * 0.15 });
    if (m.turret) {
      // barrel lane at rest
      const ml = (I.muzzle[i] ?? 1.2) * m.d;
      sp.boxes.push({ x0: m.x, y0: m.y - m.d * 0.2, x1: m.x + ml, y1: m.y + m.d * 0.2 });
    }
  }
  const front0 = geo.front(0), rear0 = geo.rear(0);
  const len = front0 - rear0;

  // ---- engine deck: raised rear plate with grilles and exhausts (vehicles), or reactor vents (walkers)
  if (ground && I.shape !== 'siegeplat' && I.shape !== 'long' && I.shape !== 'round') {
    const dd = Math.min(len * 0.22, 0.32 * S * 0.75);
    const x1 = rear0 + 0.03 * S, x0 = x1 + dd;
    const xm = (x0 + x1) / 2;
    const hw = Math.min(geo.half(x1 + dd * 0.15), geo.half(x0)) * 0.78;
    if (hw > 0.08 * S) {
      const deck = rrect(xm, 0, dd, hw * 2, dd * 0.12);
      g.save(); g.clip(I.hull);
      raised(g, deck, lgrad(g, x0, -hw, x1, hw, shade(pal.dark, 0.1), shade(pal.deep, 0.15)), o, dd * 0.04);
      g.restore();
      // grilles: paired, avoiding anything mounted on the deck
      const nG = S >= 3 ? 3 : 2;
      const gw = dd * 0.62, gh = (hw * 2 * 0.8) / nG;
      for (let k = 0; k < nG; k++) {
        const gy = -hw * 0.8 + gh * (k + 0.5);
        grille(g, xm + dd * 0.04, gy, gw, gh * 0.78, o, false);
      }
      // walkers vent heat upward: glowing coolant slits instead of exhausts
      if (walker) for (const s of [-1, 1]) { g.fillStyle = rgba(E, 0.5); g.fillRect(x1 + dd * 0.06, s * hw * 0.55 - hw * 0.06, dd * 0.08, hw * 0.12); }
      else for (const s of [-1, 1]) {
        const ey = s * hw * 0.9;
        if (sp.inside(x1 - 0.005 * S, ey)) exhaust(g, x1 + u * 0.15, ey, u * 0.32, o);
      }
      sp.take(xm, 0, dd, hw * 2, 0);
      // seam between the fighting compartment and the engine bay
      g.save(); g.clip(I.hull);
      g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = o * 0.6;
      g.beginPath(); g.moveTo(x0 + dd * 0.08, -2 * S); g.lineTo(x0 + dd * 0.08, 2 * S); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.moveTo(x0 + dd * 0.08 + o * 0.7, -2 * S); g.lineTo(x0 + dd * 0.08 + o * 0.7, 2 * S); g.stroke();
      g.restore();
    }
  }

  // ---- glacis zone: lighter sloped front plate with a weld seam (vehicles)
  if (ground && !walker && P.heavy <= 0.12) {
    const gx = front0 - Math.min(len * 0.14, 0.2 * S);
    g.save(); g.clip(I.hull);
    g.fillStyle = lgrad(g, front0, 0, gx, 0, 'rgba(255,255,255,0.16)', 'rgba(255,255,255,0.02)');
    g.fillRect(gx, -2 * S, 2 * S, 4 * S);
    g.strokeStyle = 'rgba(0,0,0,0.42)'; g.lineWidth = o * 0.6;
    g.beginPath(); g.moveTo(gx, -2 * S); g.lineTo(gx, 2 * S); g.stroke();
    g.restore();
  }

  // ---- driver's hatch + vision blocks near the front, offset left
  if (fine && !air) {
    const r = u * 0.5;
    let placed = false;
    for (let fx = front0 - u * 1.1; fx > front0 - len * 0.45 && !placed; fx -= u * 0.25) {
      for (const fy of [-geo.half(fx) * 0.45, -geo.half(fx) * 0.3, 0]) {
        if (sp.fits(fx, fy, r * 2.2, r * 2.2, u * 0.08)) {
          hatch(g, fx, fy, r, o, pal);
          sp.take(fx, fy, r * 2.2, r * 2.2, u * 0.05);
          if (sp.fits(fx + r * 1.7, fy, u * 0.3, r * 2.2, 0)) { visionBlock(g, fx + r * 1.6, fy - r * 0.5, u * 0.22, u * 0.42, o, E); visionBlock(g, fx + r * 1.6, fy + r * 0.5, u * 0.22, u * 0.42, o, E); sp.take(fx + r * 1.6, fy, u * 0.3, r * 2.2); }
          placed = true;
          break;
        }
      }
    }
  }

  // ---- commander's cupola beside the main gun
  if (fine && !air && S >= 2) {
    let main: MountSlot | null = null;
    for (const m of mounts) if (m.turret && Math.abs(m.y) <= 0.08 * S && (!main || m.d > main.d)) main = m;
    if (main) {
      const r = u * 0.55;
      for (const [ox, oy] of [[-0.55, -0.62], [-0.75, -0.4], [-0.2, -0.78], [-0.55, 0.62]]) {
        const cx = main.x + ox * main.d * 1.05, cy = main.y + oy * main.d * 1.05;
        if (!sp.fits(cx, cy, r * 2.3, r * 2.3, u * 0.05)) continue;
        const p = new Path2D(); p.arc(cx, cy, r, 0, P2);
        raised(g, p, lgrad(g, cx - r, cy - r, cx + r, cy + r, METAL.light, METAL.dark), o, r * 0.3);
        for (let k = 0; k < 6; k++) { const a = (k / 6) * P2; g.save(); g.translate(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8); g.rotate(a); g.fillStyle = '#0d1a24'; g.fillRect(-r * 0.12, -r * 0.2, r * 0.24, r * 0.4); g.fillStyle = rgba(E, 0.7); g.fillRect(r * 0.02, -r * 0.12, r * 0.08, r * 0.24); g.restore(); }
        hatch(g, cx, cy, r * 0.55, o, pal);
        sp.take(cx, cy, r * 2.3, r * 2.3);
        break;
      }
    }
  }

  // ---- flank stowage / role kit along both sides, mirrored so the design reads symmetric
  {
    const bw = u * (S >= 4 ? 2.4 : 2.0), bh = u * 0.85;
    const x0 = front0 - len * 0.2, x1 = rear0 + len * 0.28;
    const maxN = S >= 4 ? 4 : S >= 3 ? 3 : 2;
    let n = 0;
    // candidate stations spread over the flank, filled from the middle outward
    const cands: number[] = [];
    for (let x = x1 + bw / 2; x < x0 - bw / 2; x += bw * 0.3) cands.push(x);
    const xm0 = (x0 + x1) / 2;
    cands.sort((a, b) => Math.abs(a - xm0) - Math.abs(b - xm0));
    for (const x of cands) {
      if (n >= maxN) break;
      const h = Math.min(geo.half(x - bw / 2), geo.half(x + bw / 2));
      const y = h - bh * 0.5 - u * 0.22;
      if (y < 0.12 * S) continue;
      if (!sp.fits(x, y, bw, bh, u * 0.05) || !sp.fits(x, -y, bw, bh, u * 0.05)) continue;
      for (const s of [-1, 1]) {
        const yy = s * y;
        switch (P.role) {
          case 'artillery': shellRack(g, x, yy, bw, bh, o, true); break;
          case 'support': if (n % 2 === 0) crossBox(g, x, yy, bw, bh, o); else strapBox(g, x, yy, bw, bh, o, '#c8ccd0', '#5a5f64'); break;
          case 'riot': hazardPlate(g, x, yy, bw, bh, o); break;
          case 'raider': case 'skirmisher':
            for (const k of [-0.25, 0.25]) jerrycan(g, x + k * bw, yy, bw * 0.44, bh, o, n % 2 ? '#5f6a3a' : shade(pal.dark, 0.1));
            break;
          case 'tank': case 'giant': slabBlock(g, x, yy, bw, bh * 1.1, o, pal); break;
          default:
            if (tracked && n === 1 && fine) trackLinks(g, x, yy, bw, bh, o, true);
            else strapBox(g, x, yy, bw, bh, o, n % 2 ? '#5d6646' : shade(pal.dark, 0.05), '#2a2d22');
        }
        sp.take(x, yy, bw, bh, u * 0.12);
      }
      n++;
    }
  }

  // ---- spare track links across the glacis (tracked vehicles)
  if (fine && tracked && ground && !walker) {
    const lw = u * 2.6, lh = u * 0.5;
    for (let fx = front0 - u * 0.6; fx > front0 - len * 0.25; fx -= u * 0.2) {
      if (sp.fits(fx, geo.half(fx) * 0.35, lw * 0.6, lh * 1.8, u * 0.05)) {
        g.save(); g.translate(fx, geo.half(fx) * 0.35); g.rotate(Math.PI / 2);
        trackLinks(g, 0, 0, lh * 1.8 * 1.0, lw * 0.6 * 0.5, o, true);
        g.restore();
        sp.take(fx, geo.half(fx) * 0.35, lw * 0.6, lh * 1.8);
        break;
      }
    }
  }

  // ---- lights: headlights with guards at the front, tail lights at the rear
  if (ground && !walker) {
    for (const s of [-1, 1]) {
      const ly = s * Math.min(geo.maxHalf * 0.62, geo.half(front0 - u) * 0.72);
      const lx = geo.front(ly) - u * 0.38;
      if (sp.inside(lx - u * 0.2, ly)) lamp(g, lx, ly, u * 0.17, o, '#fff3c4', fine);
      const ty = s * Math.min(geo.maxHalf * 0.7, geo.half(rear0 + u) * 0.8);
      const tx = geo.rear(ty) + u * 0.3;
      if (sp.inside(tx + u * 0.2, ty)) lamp(g, tx, ty, u * 0.13, o, '#ff3a2a', false);
    }
  }

  // ---- tow hooks front and rear
  if (fine && ground && !walker) {
    for (const s of [-1, 1]) {
      const y = s * geo.half(front0 - u) * 0.38;
      towHook(g, geo.front(y) - u * 0.12, y, u * 0.2, o, 1);
      const y2 = s * geo.half(rear0 + u) * 0.32;
      towHook(g, geo.rear(y2) + u * 0.12, y2, u * 0.2, o, -1);
    }
  }

  // ---- track guards / mudguards where the running gear shows past the hull
  if (ground && (tracked || wheeled) && S < 4 && armourTier(P) === 0 && (I.X ?? S) === S && (I.Y ?? S) === S) {
    const tc = Math.max(0.3, Math.min(0.38, geo.maxHalf / S + 0.06)) * S;
    const tw = I.mob === 'wheels' ? 0.13 * S : 0.19 * S;
    for (const s of [-1, 1]) for (const [xa, xb] of [[0.31, 0.47], [-0.47, -0.36]] as [number, number][]) {
      if (I.mob === 'halftrack' && xa > 0) continue;
      const cx = ((xa + xb) / 2) * S, cy = s * tc;
      if (sp.inside(cx, cy) && sp.inside(cx, cy + s * tw * 0.4)) continue; // covered by the hull already
      const p = rrect(cx, cy, (xb - xa) * S, tw * 1.08, tw * 0.15);
      raised(g, p, lgrad(g, cx, cy - tw / 2, cx, cy + tw / 2, shade(pal.dark, 0.08), shade(pal.deep, 0.1)), o, tw * 0.06);
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = o * 0.5;
      g.beginPath(); g.moveTo(cx - (xb - xa) * S * 0.3, cy - tw * 0.54); g.lineTo(cx - (xb - xa) * S * 0.3, cy + tw * 0.54); g.stroke();
      g.fillStyle = rgba(pal.accent, 0.8); g.fillRect(cx + (xa > 0 ? 1 : -1) * (xb - xa) * S * 0.3 - o * 0.6, cy - tw * 0.5, o * 1.2, tw);
    }
  }

  // ---- antennas: whip antennas off the rear corners (support: tall masts with a relay dish)
  if (fine) {
    const n = P.role === 'support' ? 2 : P.role === 'artillery' || P.role === 'tank' || P.role === 'giant' ? 2 : 1;
    const L0 = (P.role === 'support' ? 0.42 : 0.26) * Math.sqrt(S);
    let k = 0;
    for (const s of n === 1 ? [-1] : [-1, 1]) {
      for (let x = rear0 + len * 0.3; x < front0 - len * 0.3; x += u * 0.3) {
        const y = s * (geo.half(x) - u * 0.4);
        if (!sp.fits(x, y, u * 0.35, u * 0.35, 0)) continue;
        antenna(g, x, y, L0, Math.PI + s * 0.18, o, P.role === 'support' ? '#5aff9a' : '#ff5050');
        sp.take(x, y, u * 0.35, u * 0.35);
        k++;
        break;
      }
    }
    if (P.role === 'support' && k) {
      // relay dish on the deck
      for (let x = rear0 + len * 0.35; x < front0 - len * 0.2; x += u * 0.3) {
        if (!sp.fits(x, 0, u * 1.2, u * 1.2, 0)) continue;
        g.fillStyle = METAL.light; g.beginPath(); g.ellipse(x, 0, u * 0.42, u * 0.55, 0, 0, P2); g.fill();
        g.lineWidth = o * 0.7; g.strokeStyle = OUTLINE; g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = o * 0.4; g.beginPath(); g.ellipse(x, 0, u * 0.26, u * 0.36, 0, 0, P2); g.stroke();
        dot(g, x + u * 0.1, 0, u * 0.08, '#5aff9a');
        break;
      }
    }
  }

  // ---- remaining free deck on big hulls: hatches / grilles so no large area stays blank
  if (fine && S >= 3) {
    const cell = u * 2.2;
    let placed = 0;
    const cap = S >= 4 ? 6 : 3;
    for (let x = front0 - len * 0.25; x > rear0 + len * 0.25 && placed < cap; x -= cell * 0.5) {
      for (const y of [0, -geo.half(x) * 0.45, geo.half(x) * 0.45]) {
        if (placed >= cap) break;
        if (!sp.fits(x, y, cell, cell, 0)) continue;
        if (placed % 2 === 0) { grille(g, x, y, cell * 0.7, cell * 0.5, o, true); hatch(g, x, y - cell * 0.42 * Math.sign(y || 1), u * 0.25, o, pal); }
        else { slabBlock(g, x, y, cell * 0.8, cell * 0.7, o, pal); }
        sp.take(x, y, cell, cell, u * 0.1);
        placed++;
      }
    }
  }
}
