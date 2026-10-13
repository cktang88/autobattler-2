// Odd-shaped frames: insectoid, humanoid mech, spider, crab, saucer, delta wing, scorpion, centipede and the giant
// spiders. Each shape has a smooth organic hull outline, hull details, and "parts": separately baked sprites with
// a pivot (limbs, claws, tail segments, body segments, a rotating ring) that are animated per frame and may carry
// turrets. Also: the spider / insect / centipede leg rig used by the 'spider' mobility at every size.
// Local frame: nose +x, +y right, units = cells, S = chassis size.

import { METAL, OUTLINE, mirrorPoly, poly, rgba, roundRect, shade, softDot, type Ctx, type TeamPal } from './palette.ts';
import { bevel, circ, devK, dot, emis, glowLine, grad, hazard, lamp, raised, reactor, recess, rivetRow, seam, stack, grille } from './giantart.ts';
import type { UnitLayout } from './unitart.ts';

const P2 = Math.PI * 2;

export const CREATURE_SHAPES = new Set(['mantis', 'mech', 'arachnid', 'crab', 'saucer', 'delta', 'warlord', 'scorpion', 'centipede', 'broodmother', 'arachne',
  'carriage', 'hunter', 'riot', 'interceptor', 'siegeplat', 'juggernaut', 'bomber']);
const SPIDERS = new Set(['arachnid', 'broodmother', 'arachne']);

/* ------------------------------------------------------------------------------------------------ geometry */

/** Closed Catmull-Rom spline through points (fractions of S). */
function smoothClosed(p: Path2D, pts: number[], S: number): void {
  const n = pts.length / 2;
  const P = (i: number) => { const k = ((i % n) + n) % n; return [pts[k * 2] * S, pts[k * 2 + 1] * S]; };
  const [x0, y0] = P(0);
  p.moveTo(x0, y0);
  for (let i = 0; i < n; i++) {
    const a = P(i - 1), b = P(i), c = P(i + 1), d = P(i + 2);
    p.bezierCurveTo(b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6, c[0] - (d[0] - b[0]) / 6, c[1] - (d[1] - b[1]) / 6, c[0], c[1]);
  }
  p.closePath();
}

/** Smooth mirrored outline from a width profile [x, halfWidth, ...] listed nose to tail (first/last width 0). */
export function profilePath(prof: number[], S: number): Path2D {
  const pts: number[] = [];
  for (let i = 0; i < prof.length; i += 2) pts.push(prof[i], -prof[i + 1]);
  for (let i = prof.length - 4; i >= 2; i -= 2) pts.push(prof[i], prof[i + 1]);
  const p = new Path2D();
  smoothClosed(p, pts, S);
  return p;
}

function sharp(half: number[], S: number): Path2D {
  const p = new Path2D();
  poly(p, mirrorPoly(half), S);
  return p;
}

function ellipse(x: number, y: number, rx: number, ry: number, rot = 0): Path2D {
  const p = new Path2D();
  p.ellipse(x, y, rx, ry, rot, 0, P2);
  return p;
}

/** Tapered capsule from (x0,y0) radius r0 to (x1,y1) radius r1 (cells). */
function capsule(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): Path2D {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const p = new Path2D();
  p.arc(x0, y0, r0, a + Math.PI / 2, a + Math.PI * 1.5);
  p.arc(x1, y1, r1, a - Math.PI / 2, a + Math.PI / 2);
  p.closePath();
  return p;
}

/** Shaded limb segment: gradient fill, top highlight, outline. */
function limbSeg(g: Ctx, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, c0: string, c1: string, o: number): void {
  const p = capsule(x0, y0, r0, x1, y1, r1);
  const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny) || 1;
  const r = Math.max(r0, r1);
  const gr = g.createLinearGradient(x0 - (nx / nl) * r, y0 - (ny / nl) * r, x0 + (nx / nl) * r, y0 + (ny / nl) * r);
  gr.addColorStop(0, c0);
  gr.addColorStop(1, c1);
  g.fillStyle = gr;
  g.fill(p);
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = Math.min(r0, r1) * 0.5;
  g.beginPath();
  g.moveTo(x0 - (nx / nl) * r0 * 0.35, y0 - (ny / nl) * r0 * 0.35);
  g.lineTo(x1 - (nx / nl) * r1 * 0.35, y1 - (ny / nl) * r1 * 0.35);
  g.stroke();
  g.lineJoin = 'round';
  g.lineWidth = o;
  g.strokeStyle = OUTLINE;
  g.stroke(p);
}

function fillOut(g: Ctx, p: Path2D, fill: string | CanvasGradient, o: number): void {
  g.fillStyle = fill;
  g.fill(p);
  g.lineJoin = 'round';
  g.lineWidth = o;
  g.strokeStyle = OUTLINE;
  g.stroke(p);
}

/** Glassy eye: dark socket, emissive iris, specular. */
function eye(g: Ctx, x: number, y: number, r: number, E: string): void {
  dot(g, x, y, r * 1.25, OUTLINE);
  const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(0.35, E);
  gr.addColorStop(1, shade(E, -0.6));
  dot(g, x, y, r, gr);
  dot(g, x - r * 0.35, y - r * 0.35, r * 0.28, 'rgba(255,255,255,0.85)');
}

/** Curved chitin band seams across a body (clipped to path). xs fractions of S, bow > 0 bows toward the tail. */
function bands(g: Ctx, path: Path2D, xs: number[], S: number, o: number, bow = 0.04, w = 0.5): void {
  g.save();
  g.clip(path);
  g.lineCap = 'round';
  for (const x of xs) {
    g.beginPath();
    g.moveTo(x * S, -0.6 * S);
    g.quadraticCurveTo((x - bow) * S, 0, x * S, 0.6 * S);
    g.strokeStyle = 'rgba(0,0,0,0.42)';
    g.lineWidth = o * w * 1.4;
    g.stroke();
    g.save();
    g.translate(-o * 0.7, 0);
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.lineWidth = o * w;
    g.stroke();
    g.restore();
  }
  g.restore();
}

function stripe(g: Ctx, pts: number[], S: number, col: string, w: number): void {
  g.lineCap = 'round';
  g.strokeStyle = col;
  g.lineWidth = w;
  g.beginPath();
  for (let i = 0; i < pts.length; i += 4) { g.moveTo(pts[i] * S, pts[i + 1] * S); g.lineTo(pts[i + 2] * S, pts[i + 3] * S); }
  g.stroke();
}

/** Small triangular spike pointing along angle a from (x,y). */
function spike(g: Ctx, x: number, y: number, a: number, len: number, w: number, fill: string, o: number): void {
  const p = new Path2D();
  const cs = Math.cos(a), sn = Math.sin(a);
  p.moveTo(x - sn * w, y + cs * w);
  p.lineTo(x + cs * len, y + sn * len);
  p.lineTo(x + sn * w, y - cs * w);
  p.closePath();
  g.fillStyle = fill;
  g.fill(p);
  g.lineWidth = o * 0.7;
  g.strokeStyle = OUTLINE;
  g.stroke(p);
}

/* ------------------------------------------------------------------------------------- hard-surface kit */

/** Armoured beam (limb segment): straight sides, chamfered ends, lit edge, centre seam, outline. Half widths. */
function beam(g: Ctx, x0: number, y0: number, w0: number, x1: number, y1: number, w1: number, c0: string, c1: string, o: number): void {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
  const ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
  const c = Math.min(w0, w1) * 0.6;
  const p = new Path2D();
  const P = (x: number, y: number, u: number, n: number) => p.lineTo(x + ux * u + nx * n, y + uy * u + ny * n);
  P(x0, y0, -c, w0 * 0.55); P(x0, y0, 0, w0); P(x1, y1, 0, w1); P(x1, y1, c, w1 * 0.55);
  P(x1, y1, c, -w1 * 0.55); P(x1, y1, 0, -w1); P(x0, y0, 0, -w0); P(x0, y0, -c, -w0 * 0.55);
  p.closePath();
  const w = Math.max(w0, w1);
  const gr = g.createLinearGradient(x0 - nx * w, y0 - ny * w, x0 + nx * w, y0 + ny * w);
  gr.addColorStop(0, c0);
  gr.addColorStop(1, c1);
  g.fillStyle = gr;
  g.fill(p);
  g.lineCap = 'butt';
  // lit bevel on one edge, panel seam down the middle
  g.strokeStyle = 'rgba(255,255,255,0.26)';
  g.lineWidth = Math.min(w0, w1) * 0.32;
  g.beginPath();
  g.moveTo(x0 - nx * w0 * 0.62, y0 - ny * w0 * 0.62);
  g.lineTo(x1 - nx * w1 * 0.62, y1 - ny * w1 * 0.62);
  g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.32)';
  g.lineWidth = Math.max(o * 0.35, Math.min(w0, w1) * 0.12);
  g.beginPath();
  g.moveTo(x0 + ux * c + nx * w0 * 0.2, y0 + uy * c + ny * w0 * 0.2);
  g.lineTo(x1 - ux * c + nx * w1 * 0.2, y1 - uy * c + ny * w1 * 0.2);
  g.stroke();
  g.lineJoin = 'round';
  g.lineWidth = o;
  g.strokeStyle = OUTLINE;
  g.stroke(p);
}

/** Hydraulic ram: dark cylinder from (x0,y0), polished rod to (x1,y1). r = cylinder half width. */
function piston(g: Ctx, x0: number, y0: number, x1: number, y1: number, r: number, o: number): void {
  const mx = x0 + (x1 - x0) * 0.55, my = y0 + (y1 - y0) * 0.55;
  g.lineCap = 'round';
  g.strokeStyle = OUTLINE; g.lineWidth = r * 0.9 + o;
  g.beginPath(); g.moveTo(mx, my); g.lineTo(x1, y1); g.stroke();
  g.strokeStyle = '#c9d1d8'; g.lineWidth = r * 0.9;
  g.stroke();
  g.lineCap = 'butt';
  g.strokeStyle = OUTLINE; g.lineWidth = r * 2 + o;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(mx, my); g.stroke();
  g.strokeStyle = METAL.dark; g.lineWidth = r * 2;
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = r * 0.5;
  g.stroke();
  dot(g, x1, y1, r * 0.75, METAL.base);
}

/** Actuator hub: octagonal housing, bright ring, centre bolt (optional emissive core). */
function joint(g: Ctx, x: number, y: number, r: number, o: number, fill: string, core?: string): void {
  const p = new Path2D();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * P2 + P2 / 16; p.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  p.closePath();
  g.fillStyle = fill; g.fill(p);
  g.lineWidth = o * 0.8; g.strokeStyle = OUTLINE; g.stroke(p);
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = Math.max(o * 0.3, r * 0.14);
  g.beginPath(); g.arc(x, y, r * 0.62, Math.PI * 0.9, Math.PI * 1.7); g.stroke();
  if (core) { dot(g, x, y, r * 0.42, '#05080b'); dot(g, x, y, r * 0.3, core); }
  else { dot(g, x, y, r * 0.3, METAL.light); dot(g, x + r * 0.06, y + r * 0.06, r * 0.14, METAL.deep); }
}

/** Camera lens: steel bezel, dark glass, emissive pupil, glint. */
function lens(g: Ctx, x: number, y: number, r: number, E: string): void {
  dot(g, x, y, r * 1.45, OUTLINE);
  dot(g, x, y, r * 1.25, METAL.base);
  dot(g, x - r * 0.2, y - r * 0.2, r * 0.9, METAL.light);
  dot(g, x, y, r * 0.95, '#04070a');
  const gr = g.createRadialGradient(x, y, 0, x, y, r * 0.65);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.4, E); gr.addColorStop(1, rgba(E, 0));
  dot(g, x, y, r * 0.65, gr);
  dot(g, x - r * 0.35, y - r * 0.35, r * 0.2, 'rgba(255,255,255,0.8)');
}

/** Recessed visor slot with an emissive strip, between two points (cells already scaled). */
function visor(g: Ctx, x0: number, y0: number, x1: number, y1: number, w: number, E: string, o: number): void {
  g.lineCap = 'butt';
  g.strokeStyle = OUTLINE; g.lineWidth = w * 2 + o * 1.4;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.strokeStyle = '#04070a'; g.lineWidth = w * 2;
  g.stroke();
  g.strokeStyle = rgba(E, 0.95); g.lineWidth = w * 0.95;
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = w * 0.3;
  g.stroke();
}

/** Fuel cell / ammo drum seen from above: steel end caps, glowing core band. Cells already scaled. */
function canister(g: Ctx, x: number, y: number, len: number, r: number, a: number, E: string, o: number): void {
  g.save();
  g.translate(x, y); g.rotate(a);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath(); roundRect(g, -len / 2 + o, -r + o * 1.4, len, r * 2, r * 0.45); g.fill();
  const p = new Path2D();
  roundRect(p, -len / 2, -r, len, r * 2, r * 0.45);
  const gr = g.createLinearGradient(0, -r, 0, r);
  gr.addColorStop(0, METAL.light); gr.addColorStop(0.5, METAL.base); gr.addColorStop(1, METAL.deep);
  g.fillStyle = gr; g.fill(p);
  // glowing window in the middle
  const wl = len * 0.46;
  g.fillStyle = '#05080b'; g.fillRect(-wl / 2, -r * 0.62, wl, r * 1.24);
  const eg = g.createLinearGradient(0, -r * 0.6, 0, r * 0.6);
  eg.addColorStop(0, rgba(E, 0.35)); eg.addColorStop(0.45, shade(E, 0.4)); eg.addColorStop(1, rgba(E, 0.25));
  g.fillStyle = eg; g.fillRect(-wl / 2 + o * 0.4, -r * 0.48, wl - o * 0.8, r * 0.96);
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = o * 0.5;
  g.beginPath();
  for (const f of [-0.17, 0, 0.17]) { g.moveTo(f * len, -r * 0.62); g.lineTo(f * len, r * 0.62); }
  g.stroke();
  g.lineWidth = o * 0.8; g.strokeStyle = OUTLINE; g.stroke(p);
  g.restore();
}

/** Blunt armour fin (replaces organic spikes): trapezoid plate jutting along angle a. */
function fin(g: Ctx, x: number, y: number, a: number, len: number, w: number, fill: string, o: number): void {
  const p = new Path2D();
  const cs = Math.cos(a), sn = Math.sin(a);
  const P = (u: number, n: number) => p.lineTo(x + cs * u - sn * n, y + sn * u + cs * n);
  P(-len * 0.1, -w); P(len * 0.75, -w * 0.55); P(len, -w * 0.15); P(len, w * 0.3); P(len * 0.75, w * 0.55); P(-len * 0.1, w);
  p.closePath();
  g.fillStyle = fill; g.fill(p);
  g.save(); g.clip(p);
  g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = w * 0.5;
  g.beginPath(); g.moveTo(x - sn * -w * 0.6, y + cs * -w * 0.6); g.lineTo(x + cs * len - sn * -w * 0.4, y + sn * len + cs * -w * 0.4); g.stroke();
  g.restore();
  g.lineWidth = o * 0.7; g.strokeStyle = OUTLINE; g.stroke(p);
}

/** Straight plate seams across a body (clipped): dark groove + lit lip. xs fractions of S. */
function plateSeams(g: Ctx, path: Path2D, xs: number[], S: number, o: number, w = 0.6): void {
  g.save();
  g.clip(path);
  g.lineCap = 'butt';
  for (const x of xs) {
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = o * w * 1.3;
    g.beginPath(); g.moveTo(x * S, -0.6 * S); g.lineTo(x * S, 0.6 * S); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = o * w * 0.8;
    g.beginPath(); g.moveTo(x * S - o * w * 1.1, -0.6 * S); g.lineTo(x * S - o * w * 1.1, 0.6 * S); g.stroke();
  }
  g.restore();
}

/** Cable bundle: a few parallel dark hoses with highlights (cells, already scaled pts). */
function cables(g: Ctx, pts: number[], S: number, w: number, n = 2): void {
  g.lineCap = 'round';
  for (let i = 0; i < pts.length; i += 4) {
    const x0 = pts[i] * S, y0 = pts[i + 1] * S, x1 = pts[i + 2] * S, y1 = pts[i + 3] * S;
    const l = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / l, ny = (x1 - x0) / l;
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * w * 1.3;
      g.strokeStyle = OUTLINE; g.lineWidth = w * 1.4;
      g.beginPath(); g.moveTo(x0 + nx * off, y0 + ny * off); g.lineTo(x1 + nx * off, y1 + ny * off); g.stroke();
      g.strokeStyle = k % 2 ? '#3a2f22' : '#262b30'; g.lineWidth = w;
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = w * 0.35;
      g.beginPath(); g.moveTo(x0 + nx * (off - w * 0.2), y0 + ny * (off - w * 0.2)); g.lineTo(x1 + nx * (off - w * 0.2), y1 + ny * (off - w * 0.2)); g.stroke();
    }
  }
}

/* ------------------------------------------------------------------------------------------------- hulls */

export function creatureHullPath(shape: string, S: number): Path2D | null {
  switch (shape) {
    case 'mantis': return sharp([0.47, 0, 0.46, -0.055, 0.42, -0.11, 0.34, -0.115, 0.3, -0.06, 0.26, -0.05, 0.21, -0.075, 0.06, -0.075, 0.02, -0.055, -0.04, -0.06, -0.1, -0.14, -0.38, -0.14, -0.46, -0.09, -0.47, 0], S);
    case 'mech': return sharp([0.24, 0, 0.235, -0.09, 0.19, -0.19, 0.1, -0.27, -0.1, -0.28, -0.2, -0.22, -0.26, -0.12, -0.27, 0], S);
    case 'arachnid': return sharp([0.44, 0, 0.43, -0.06, 0.37, -0.13, 0.27, -0.16, 0.16, -0.15, 0.1, -0.08, 0.06, -0.09, 0.0, -0.19, -0.1, -0.25, -0.34, -0.25, -0.44, -0.17, -0.48, -0.06, -0.48, 0], S);
    case 'crab': return sharp([0.27, 0, 0.27, -0.1, 0.22, -0.26, 0.12, -0.37, 0.0, -0.41, -0.14, -0.39, -0.24, -0.3, -0.3, -0.16, -0.3, 0], S);
    case 'saucer': { const p = new Path2D(); p.arc(0, 0, 0.44 * S, 0, P2); return p; }
    case 'delta': { const p = new Path2D(); poly(p, mirrorPoly([0.5, 0, 0.3, -0.075, -0.27, -0.46, -0.39, -0.46, -0.34, -0.31, -0.45, -0.22, -0.47, -0.1, -0.41, 0]), S); return p; }
    case 'warlord': return sharp([0.25, 0, 0.245, -0.1, 0.2, -0.2, 0.1, -0.27, -0.11, -0.27, -0.22, -0.21, -0.28, -0.12, -0.29, 0], S);
    case 'scorpion': return sharp([0.39, 0, 0.38, -0.07, 0.33, -0.15, 0.24, -0.2, 0.08, -0.23, -0.08, -0.22, -0.2, -0.18, -0.3, -0.12, -0.36, -0.06, -0.36, 0], S);
    case 'centipede': return sharp([0.5, 0, 0.49, -0.05, 0.45, -0.11, 0.38, -0.13, 0.32, -0.11, 0.29, 0], S);
    case 'broodmother': return sharp([0.47, 0, 0.46, -0.07, 0.4, -0.14, 0.29, -0.17, 0.19, -0.15, 0.13, -0.09, 0.08, -0.12, 0.0, -0.25, -0.12, -0.34, -0.33, -0.36, -0.44, -0.28, -0.5, -0.14, -0.5, 0], S);
    case 'carriage': return profilePath([0.25, 0, 0.245, 0.1, 0.21, 0.22, 0.15, 0.265, 0.09, 0.22, 0.07, 0.12, -0.08, 0.1, -0.15, 0.05, -0.16, 0], S);
    case 'hunter': return sharp([0.5, 0, 0.3, -0.065, 0.12, -0.11, 0.04, -0.27, -0.06, -0.31, -0.11, -0.15, -0.3, -0.14, -0.38, -0.25, -0.47, -0.25, -0.44, -0.08, -0.47, 0], S);
    case 'riot': return sharp([0.42, 0, 0.3, -0.2, 0.18, -0.42, 0.06, -0.43, 0.02, -0.3, -0.36, -0.3, -0.44, -0.21, -0.45, 0], S);
    case 'interceptor': return sharp([0.5, 0, 0.32, -0.05, 0.06, -0.08, -0.2, -0.43, -0.31, -0.43, -0.2, -0.1, -0.34, -0.1, -0.42, -0.22, -0.48, -0.22, -0.45, 0], S);
    case 'siegeplat': return sharp([0.38, -0.1, 0.32, -0.27, 0.2, -0.33, -0.28, -0.33, -0.38, -0.25, -0.4, -0.1], S);
    case 'juggernaut': return sharp([0.47, -0.17, 0.44, -0.3, 0.38, -0.43, -0.38, -0.45, -0.46, -0.38, -0.48, -0.16], S);
    case 'bomber': return sharp([0.46, 0, 0.3, -0.115, -0.05, -0.47, -0.2, -0.47, -0.27, -0.37, -0.35, -0.41, -0.45, -0.29, -0.4, -0.18, -0.46, -0.07, -0.42, 0], S);
    case 'arachne': { const p = new Path2D(); poly(p, mirrorPoly([0.49, 0, 0.46, -0.07, 0.4, -0.14, 0.3, -0.19, 0.2, -0.18, 0.13, -0.11, 0.08, -0.12, 0.02, -0.2, -0.08, -0.28, -0.22, -0.33, -0.36, -0.31, -0.45, -0.23, -0.5, -0.11, -0.5, 0]), S); return p; }
  }
  return null;
}

/** Things drawn under the hull paint but part of the hull sprite (antennae, eye stalks, spines, wing roots). */
export function creatureUnderlay(g: Ctx, L: UnitLayout, pal: TeamPal, o: number): void {
  const S = L.S;
  switch (L.shape) {
    case 'mantis':
      // whip radio mast off the power pack
      g.lineCap = 'round';
      g.strokeStyle = OUTLINE; g.lineWidth = 0.03 * S;
      g.beginPath(); g.moveTo(-0.3 * S, -0.1 * S); g.lineTo(-0.56 * S, -0.17 * S); g.stroke();
      g.strokeStyle = METAL.light; g.lineWidth = 0.012 * S; g.stroke();
      dot(g, -0.3 * S, -0.1 * S, 0.028 * S, METAL.dark);
      break;
    case 'crab':
      // periscope sensor booms + armoured skirt plates around the rim
      for (const s of [-1, 1]) {
        beam(g, 0.2 * S, s * 0.08 * S, 0.026 * S, 0.33 * S, s * 0.11 * S, 0.022 * S, METAL.light, METAL.dark, o);
        for (const [x, y, a] of [[0.24, 0.2, -0.5], [0.17, 0.31, -0.8], [0.06, 0.39, -1.2], [-0.08, 0.4, -1.7], [-0.19, 0.33, -2.2]]) fin(g, x * S, s * y * S, s * a, 0.06 * S, 0.04 * S, shade(pal.dark, -0.05), o);
      }
      break;
    case 'scorpion':
      for (const s of [-1, 1]) for (const [x, y] of [[0.16, 0.2], [0.02, 0.225], [-0.12, 0.2]]) fin(g, x * S, s * y * S, s * 1.5, 0.045 * S, 0.035 * S, shade(pal.dark, -0.1), o);
      break;
    case 'arachne': {
      // ablative armour fins along the rear module rim
      for (const s of [-1, 1]) for (const [x, y, a] of [[-0.1, 0.28, 1.2], [-0.24, 0.33, 1.6], [-0.38, 0.3, 2.1], [-0.47, 0.2, 2.6], [0.02, 0.2, 0.9]]) fin(g, x * S, s * y * S, s * a, 0.07 * S, 0.04 * S, shade(pal.deep, 0.1), o);
      break;
    }
    case 'carriage':
      // split trail arms with spades, axle beam
      for (const s of [-1, 1]) {
        limbSeg(g, -0.06 * S, s * 0.07 * S, 0.035 * S, -0.43 * S, s * 0.2 * S, 0.03 * S, shade(pal.dark, 0.1), pal.deep, o);
        const sp = new Path2D();
        poly(sp, [-0.4, s * 0.13, -0.47, s * 0.15, -0.5, s * 0.27, -0.44, s * 0.27], S);
        fillOut(g, sp, METAL.dark, o * 0.8);
      }
      g.lineCap = 'round';
      g.strokeStyle = OUTLINE; g.lineWidth = 0.07 * S;
      g.beginPath(); g.moveTo(0.02 * S, -0.3 * S); g.lineTo(0.02 * S, 0.3 * S); g.stroke();
      g.strokeStyle = METAL.base; g.lineWidth = 0.04 * S; g.stroke();
      break;
    case 'siegeplat':
      // deployed stabiliser outriggers with jack pads
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const ax = sx * 0.26 * S, ay = sy * 0.24 * S, fx = sx * 0.43 * S, fy = sy * 0.45 * S;
        limbSeg(g, ax, ay, 0.045 * S, fx, fy, 0.035 * S, shade(pal.dark, 0.05), pal.deep, o);
        g.strokeStyle = METAL.light; g.lineWidth = 0.014 * S; g.lineCap = 'round';
        g.beginPath(); g.moveTo(ax + sx * 0.03 * S, ay); g.lineTo((ax + fx) / 2 + sx * 0.02 * S, (ay + fy) / 2); g.stroke();
        const pad = new Path2D();
        pad.arc(fx, fy, 0.065 * S, 0, P2);
        g.fillStyle = METAL.dark; g.fill(pad); g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke(pad);
        g.strokeStyle = 'rgba(240,190,40,0.8)'; g.lineWidth = o * 0.8; g.beginPath(); g.arc(fx, fy, 0.045 * S, 0, P2); g.stroke();
        dot(g, fx, fy, 0.018 * S, METAL.light);
      }
      break;
    case 'bomber':
      // tail fins
      for (const s of [-1, 1]) {
        const f = new Path2D();
        poly(f, [-0.3, s * 0.09, -0.47, s * 0.2, -0.5, s * 0.2, -0.44, s * 0.06], S);
        fillOut(g, f, shade(pal.dark, -0.05), o);
      }
      break;
    case 'broodmother':
      for (const s of [-1, 1]) for (const [x, y, a] of [[-0.3, 0.355, 1.7], [-0.44, 0.27, 2.3]]) fin(g, x * S, s * y * S, s * a, 0.05 * S, 0.04 * S, shade(pal.deep, 0.1), o);
      break;
  }
}

export function creatureDetails(g: Ctx, L: UnitLayout, pal: TeamPal, o: number, hull: Path2D): void {
  const S = L.S;
  const E = emis(pal);
  const t = o * 0.5;
  const pl = 'rgba(0,0,0,0.4)';
  const lite = shade(pal.body, 0.18);
  switch (L.shape) {
    case 'mantis': {
      // rear power pack: armoured engine module with exhausts
      const pack = sharp([-0.06, 0, -0.11, -0.115, -0.36, -0.115, -0.43, -0.07, -0.44, 0], S);
      raised(g, pack, grad(g, S, shade(pal.light, 0.05), pal.dark, -0.1, -0.12, -0.4, 0.12), o, S, 1, 0.01, 0.45);
      seam(g, [-0.2, -0.11, -0.2, 0.11, -0.31, -0.11, -0.31, 0.11], S, t);
      vent(g, -0.255, 0, 0.08, 0.06, S, o);
      for (const s of [-1, 1]) {
        stripe(g, [-0.12, s * 0.1, -0.35, s * 0.1], S, pal.accent, o * 0.8);
        stack(g, -0.43 * S, s * 0.075 * S, 0.02 * S, o * 0.6);
      }
      hazard(g, -0.445 * S, -0.03 * S, 0.02 * S, 0.06 * S, o, true);
      // spine: torso plate + cable bundle to the pack
      cables(g, [0.06, 0, -0.1, 0], S, 0.016 * S, 2);
      raised(g, roundedRect(0.03, -0.055, 0.2, 0.11, 0.015, S), grad(g, S, shade(pal.light, 0.1), pal.body, 0.05, -0.05, 0.2, 0.05), o, S, 0.8, 0.008, 0.4);
      rivetRow(g, 0.06 * S, -0.03 * S, 0.2 * S, -0.03 * S, 3, 0.008 * S);
      rivetRow(g, 0.06 * S, 0.03 * S, 0.2 * S, 0.03 * S, 3, 0.008 * S);
      // sensor head: armoured block, visor strip, twin camera lenses
      const hd = sharp([0.465, 0, 0.455, -0.05, 0.415, -0.1, 0.345, -0.1, 0.31, -0.05, 0.305, 0], S);
      raised(g, hd, grad(g, S, shade(pal.light, 0.12), pal.dark, 0.3, -0.1, 0.46, 0.1), o, S, 1, 0.01, 0.4);
      visor(g, 0.44 * S, -0.045 * S, 0.44 * S, 0.045 * S, 0.011 * S, E, o);
      for (const s of [-1, 1]) lens(g, 0.375 * S, s * 0.055 * S, 0.022 * S, E);
      break;
    }
    case 'mech': {
      g.save(); g.scale(1.15, 1.15);
      // backpack
      raised(g, roundedRect(-0.26, -0.12, 0.12, 0.24, 0.035, S), grad(g, S, shade(pal.dark, 0.15), pal.deep), o, S, 1, 0.012);
      for (const s of [-1, 1]) dot(g, -0.24 * S, s * 0.07 * S, 0.025 * S, '#0a0c0e');
      // chest plates
      for (const s of [-1, 1]) {
        const cp = new Path2D();
        poly(cp, [0.17, s * 0.02, 0.13, s * 0.16, 0.0, s * 0.2, -0.1, s * 0.15, -0.1, s * 0.02], S);
        raised(g, cp, grad(g, S, pal.light, pal.body), o, S, 1, 0.01, 0.4);
      }
      stripe(g, [0.12, -0.15, 0.0, -0.19, 0.12, 0.15, 0.0, 0.19], S, pal.accent, o * 0.9);
      // head / cockpit
      raised(g, sharp([0.185, 0, 0.18, -0.04, 0.15, -0.065, 0.06, -0.065, 0.035, -0.035, 0.035, 0], S), grad(g, S, shade(pal.light, 0.1), pal.dark, 0.05, -0.06, 0.18, 0.06), o, S, 1, 0.01, 0.4);
      visor(g, 0.162 * S, -0.04 * S, 0.162 * S, 0.04 * S, 0.012 * S, E, o);
      seam(g, [0.06, -0.06, 0.06, 0.06], S, t);
      g.restore();
      break;
    }
    case 'arachnid':
    case 'broodmother':
    case 'arachne':
      spiderDetails(g, L, pal, o, hull);
      break;
    case 'crab': {
      // armoured carapace plate with straight panel lines, rivets, rear exhausts, front sensor visor
      const inner = sharp([0.2, 0, 0.2, -0.08, 0.16, -0.2, 0.08, -0.29, -0.02, -0.32, -0.12, -0.3, -0.19, -0.23, -0.23, -0.12, -0.23, 0], S);
      raised(g, inner, grad(g, S, shade(pal.light, 0.05), pal.dark), o, S, 1.2, 0.012, 0.5);
      seam(g, [0.2, 0, -0.23, 0], S, t);
      g.save(); g.clip(inner);
      seam(g, [0.08, -0.29, 0.02, -0.06, 0.08, 0.29, 0.02, 0.06, -0.19, -0.23, -0.1, -0.05, -0.19, 0.23, -0.1, 0.05], S, t);
      g.restore();
      for (const s of [-1, 1]) {
        stripe(g, [0.14, s * 0.3, -0.02, s * 0.375], S, pal.accent, o * 1.1);
        rivetRow(g, 0.17 * S, s * 0.13 * S, 0.06 * S, s * 0.28 * S, 4, 0.01 * S);
        rivetRow(g, -0.06 * S, s * 0.3 * S, -0.18 * S, s * 0.22 * S, 3, 0.01 * S);
        vent(g, -0.15, s * 0.14, 0.06, 0.08, S, o);
        stack(g, -0.27 * S, s * 0.09 * S, 0.024 * S, o * 0.7);
        lens(g, 0.245 * S, s * 0.155 * S, 0.02 * S, E);
      }
      hazard(g, 0.215 * S, -0.03 * S, 0.035 * S, 0.06 * S, o, true);
      visor(g, 0.255 * S, -0.1 * S, 0.255 * S, 0.1 * S, 0.012 * S, E, o);
      break;
    }
    case 'saucer': {
      // inner fixed deck + dome (outer ring is an animated part)
      const deck = circPath(0, 0, 0.34, S);
      recess(g, deck, o, shade(pal.deep, 0.2));
      g.save(); g.clip(deck);
      g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = t;
      g.beginPath();
      for (let i = 0; i < 12; i++) { const a = (i / 12) * P2; g.moveTo(Math.cos(a) * 0.14 * S, Math.sin(a) * 0.14 * S); g.lineTo(Math.cos(a) * 0.34 * S, Math.sin(a) * 0.34 * S); }
      g.stroke();
      g.restore();
      g.strokeStyle = rgba(E, 0.7); g.lineWidth = o * 0.8;
      g.beginPath(); g.arc(0, 0, 0.3 * S, 0, P2); g.stroke();
      // dome
      const dome = circPath(0, 0, 0.13, S);
      const dg = g.createRadialGradient(-0.04 * S, -0.04 * S, 0, 0, 0, 0.13 * S);
      dg.addColorStop(0, '#ffffff'); dg.addColorStop(0.25, shade(E, 0.3)); dg.addColorStop(0.7, shade(E, -0.45)); dg.addColorStop(1, '#0a1218');
      raised(g, dome, dg, o, S, 0.6, 0.015, 0.6);
      dot(g, -0.045 * S, -0.045 * S, 0.03 * S, 'rgba(255,255,255,0.7)');
      break;
    }
    case 'delta': {
      // spine, wing panels, canopy, intakes, trailing-edge engines
      seam(g, [0.36, -0.06, -0.38, -0.06, 0.36, 0.06, -0.38, 0.06], S, t);
      for (const s of [-1, 1]) {
        seam(g, [0.1, s * 0.12, -0.3, s * 0.38, -0.05, s * 0.07, -0.22, s * 0.3], S, t);
        seam(g, [0.12, s * 0.115, -0.28, s * 0.37], S, o * 0.4, 'rgba(255,255,255,0.15)');
        stripe(g, [-0.24, s * 0.43, -0.36, s * 0.43], S, pal.accent, o * 1.3);
        fillOut(g, roundedRect(-0.47, s * 0.14 - 0.05, 0.12, 0.1, 0.025, S), METAL.dark, o * 0.8);
        dot(g, -0.46 * S, s * 0.14 * S, 0.03 * S, '#07080a');
        g.fillStyle = 'rgba(0,0,0,0.55)';
        g.beginPath(); poly(g, [0.18, s * 0.06, 0.1, s * 0.1, 0.1, s * 0.065], S); g.fill();
      }
      g.fillStyle = '#132230';
      g.beginPath(); g.ellipse(0.25 * S, 0, 0.1 * S, 0.04 * S, 0, 0, P2); g.fill();
      g.lineWidth = o * 0.7; g.strokeStyle = OUTLINE; g.stroke();
      g.fillStyle = rgba(pal.glow, 0.6);
      g.beginPath(); g.ellipse(0.28 * S, -0.012 * S, 0.05 * S, 0.016 * S, 0, 0, P2); g.fill();
      break;
    }
    case 'warlord': {
      // backpack reactor
      raised(g, roundedRect(-0.36, -0.15, 0.17, 0.3, 0.04, S), grad(g, S, shade(pal.dark, 0.2), pal.deep), o, S, 1.2, 0.02);
      for (const s of [-1, 1]) { dot(g, -0.33 * S, s * 0.1 * S, 0.032 * S, METAL.dark); dot(g, -0.33 * S, s * 0.1 * S, 0.02 * S, '#0a0b0d'); }
      // chest
      const ch = new Path2D();
      poly(ch, mirrorPoly([0.22, -0.04, 0.19, -0.14, 0.08, -0.2, -0.12, -0.18, -0.16, -0.06, -0.16, 0]), S);
      raised(g, ch, grad(g, S, shade(pal.light, 0.05), pal.dark), o, S, 1.3, 0.015);
      seam(g, [0.08, -0.2, 0.02, -0.06, 0.08, 0.2, 0.02, 0.06, -0.12, -0.18, -0.06, -0.06, -0.12, 0.18, -0.06, 0.06], S, t);
      reactor(g, 0.02 * S, 0, 0.045 * S, o, E);
      // head
      const hd = profilePath([0.29, 0, 0.28, 0.04, 0.24, 0.07, 0.17, 0.07, 0.15, 0], S);
      raised(g, hd, grad(g, S, shade(pal.light, 0.1), pal.body), o, S, 1.2, 0.015);
      g.fillStyle = '#04070a'; g.beginPath(); g.ellipse(0.255 * S, 0, 0.012 * S, 0.05 * S, 0, 0, P2); g.fill();
      glowLine(g, [0.258, -0.04, 0.258, 0.04], S, E, o * 0.9);
      // pauldrons (arms hang beneath them)
      for (const s of [-1, 1]) {
        const pd = profilePath([0.11, 0, 0.1, 0.06, 0.06, 0.1, -0.04, 0.115, -0.13, 0.09, -0.16, 0.04, -0.165, 0], S);
        g.save(); g.translate(0, s * 0.3 * S);
        raised(g, pd, grad(g, S, shade(pal.light, 0.1), pal.dark, -0.1, -0.1, 0.1, 0.1), o, S, 1.4, 0.025, 0.7);
        for (const k of [0.06, -0.02, -0.1]) seam(g, [k, -0.09, k - 0.01, 0.09], S, t);
        stripe(g, [-0.12, s * 0.085, 0.06, s * 0.085], S, pal.accent, o * 1.2);
        g.restore();
      }
      break;
    }
    case 'scorpion': {
      plateSeams(g, hull, [0.18, 0.06, -0.06, -0.16, -0.25], S, o, 0.7);
      // armoured spine plate down the back
      raised(g, roundedRect(-0.3, -0.06, 0.46, 0.12, 0.02, S), grad(g, S, shade(pal.light, 0.02), pal.dark, -0.3, -0.06, 0.1, 0.06), o, S, 0.9, 0.01, 0.4);
      rivetRow(g, -0.27 * S, -0.04 * S, 0.12 * S, -0.04 * S, 6, 0.009 * S);
      rivetRow(g, -0.27 * S, 0.04 * S, 0.12 * S, 0.04 * S, 6, 0.009 * S);
      vent(g, -0.2, 0, 0.1, 0.05, S, o);
      // sensor head
      const cara = sharp([0.36, 0, 0.355, -0.06, 0.31, -0.125, 0.23, -0.155, 0.185, -0.1, 0.18, 0], S);
      raised(g, cara, grad(g, S, shade(pal.light, 0.08), pal.body), o, S, 1.1, 0.01, 0.4);
      visor(g, 0.335 * S, -0.06 * S, 0.335 * S, 0.06 * S, 0.012 * S, E, o);
      for (const s of [-1, 1]) {
        lens(g, 0.27 * S, s * 0.11 * S, 0.018 * S, E);
        stripe(g, [0.1, s * 0.19, -0.18, s * 0.16], S, pal.accent, o * 1.0);
        stack(g, -0.33 * S, s * 0.06 * S, 0.022 * S, o * 0.7);
      }
      hazard(g, 0.2 * S, -0.025 * S, 0.03 * S, 0.05 * S, o, true);
      break;
    }
    case 'carriage': {
      // gun shield (curved plate) + cradle + trail hinge
      g.save(); g.clip(hull);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-0.2 * S, -0.3 * S, 0.27 * S, 0.6 * S);
      g.restore();
      const sh = new Path2D();
      sh.moveTo(0.25 * S, 0); sh.quadraticCurveTo(0.25 * S, 0.26 * S, 0.12 * S, 0.25 * S); sh.lineTo(0.1 * S, 0.2 * S); sh.quadraticCurveTo(0.17 * S, 0.1 * S, 0.17 * S, 0);
      sh.quadraticCurveTo(0.17 * S, -0.1 * S, 0.1 * S, -0.2 * S); sh.lineTo(0.12 * S, -0.25 * S); sh.quadraticCurveTo(0.25 * S, -0.26 * S, 0.25 * S, 0); sh.closePath();
      raised(g, sh, grad(g, S, shade(pal.light, 0.1), pal.dark, 0.1, -0.2, 0.25, 0.2), o, S, 1, 0.01, 0.5);
      stripe(g, [0.21, -0.17, 0.21, -0.09, 0.21, 0.17, 0.21, 0.09], S, pal.accent, o);
      dot(g, -0.11 * S, 0, 0.03 * S, METAL.dark);
      dot(g, -0.11 * S, 0, 0.014 * S, METAL.light);
      break;
    }
    case 'hunter': {
      // raised spine, fins, cockpit slit, twin intakes
      const sp = sharp([0.44, 0, 0.28, -0.045, -0.36, -0.07, -0.42, 0], S);
      raised(g, sp, grad(g, S, shade(pal.light, 0.1), pal.body), o, S, 1, 0.012, 0.45);
      for (const s of [-1, 1]) {
        seam(g, [0.08, s * 0.12, -0.08, s * 0.29, -0.12, s * 0.15, -0.36, s * 0.22], S, t);
        stripe(g, [0.0, s * 0.24, -0.06, s * 0.29, -0.4, s * 0.23, -0.46, s * 0.23], S, pal.accent, o * 1.1);
        g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); poly(g, [0.18, s * 0.075, 0.08, s * 0.1, 0.06, s * 0.065], S); g.fill();
      }
      g.fillStyle = '#132230'; g.beginPath(); g.ellipse(0.27 * S, 0, 0.08 * S, 0.028 * S, 0, 0, P2); g.fill();
      glowLine(g, [0.22, 0, 0.32, 0], S, emis(pal), o * 0.8);
      for (const s of [-1, 1]) { dot(g, -0.45 * S, s * 0.05 * S, 0.025 * S, '#07080a'); }
      break;
    }
    case 'riot': {
      // sloped glacis riot plate across the front
      const gl = sharp([0.42, 0, 0.3, -0.2, 0.18, -0.42, 0.06, -0.43, 0.03, -0.33, 0.12, -0.18, 0.2, 0], S);
      const gg = g.createLinearGradient(0.42 * S, 0, 0.05 * S, 0);
      gg.addColorStop(0, shade(pal.light, 0.15)); gg.addColorStop(1, pal.dark);
      raised(g, gl, gg, o, S, 1.5, 0.02, 0.7);
      for (const s of [-1, 1]) {
        seam(g, [0.33, s * 0.1, 0.17, s * 0.1, 0.25, s * 0.25, 0.12, s * 0.27], S, t);
        rivetRow(g, 0.36 * S, s * 0.06 * S, 0.12 * S, s * 0.39 * S, 6, 0.01 * S);
        g.fillStyle = '#04070a'; g.fillRect(0.27 * S, (s > 0 ? 0.03 : -0.05) * S, 0.03 * S, 0.02 * S);
      }
      hazard(g, 0.06 * S, -0.41 * S, 0.035 * S, 0.1 * S, o, true);
      hazard(g, 0.06 * S, 0.31 * S, 0.035 * S, 0.1 * S, o, true);
      seam(g, [-0.36, -0.29, -0.36, 0.29, -0.0, -0.29, -0.0, 0.29], S, t);
      for (const s of [-1, 1]) { stripe(g, [-0.02, s * 0.27, -0.32, s * 0.27], S, pal.accent, o); }
      vent(g, -0.41, 0, 0.05, 0.2, S, o);
      break;
    }
    case 'interceptor': {
      for (const s of [-1, 1]) {
        seam(g, [0.04, s * 0.08, -0.22, s * 0.4], S, t);
        stripe(g, [-0.22, s * 0.41, -0.3, s * 0.41], S, pal.accent, o * 1.2);
      }
      g.fillStyle = '#132230'; g.beginPath(); g.ellipse(0.22 * S, 0, 0.1 * S, 0.035 * S, 0, 0, P2); g.fill();
      g.lineWidth = o * 0.6; g.strokeStyle = OUTLINE; g.stroke();
      g.fillStyle = rgba(pal.glow, 0.6); g.beginPath(); g.ellipse(0.25 * S, -0.01 * S, 0.05 * S, 0.014 * S, 0, 0, P2); g.fill();
      dot(g, -0.44 * S, 0, 0.035 * S, '#07080a');
      break;
    }
    case 'siegeplat': {
      // open deck grating, ammo racks, hazard edging
      const deck = sharp([0.31, -0.1, 0.27, -0.24, 0.17, -0.28, -0.25, -0.28, -0.33, -0.22, -0.34, -0.1], S);
      recess(g, deck, o, '#262b30');
      g.save(); g.clip(deck);
      g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = o * 0.6;
      g.beginPath();
      for (let v = -0.4; v <= 0.4; v += 0.045) { g.moveTo(v * S, -0.3 * S); g.lineTo(v * S, 0.3 * S); }
      g.stroke();
      g.restore();
      for (const s of [-1, 1]) {
        hazard(g, -0.3 * S, (s > 0 ? 0.29 : -0.325) * S, 0.56 * S, 0.035 * S, o);
        for (let i = 0; i < 3; i++) {
          const r = roundedRect(-0.28 + i * 0.06, s * 0.21 - 0.035, 0.05, 0.07, 0.008, S);
          raised(g, r, i % 2 ? '#6a6a46' : '#7a7a52', o, S, 0.8, 0.008, 0.5);
        }
      }
      fillOut(g, roundedRect(-0.38, -0.08, 0.08, 0.16, 0.02, S), METAL.dark, o);
      lamp(g, 0.34 * S, 0, 0.016 * S, '#fff3c4');
      break;
    }
    case 'juggernaut': {
      // layered ablative slabs: three stepped tiers + overlapping side scales
      const tiers = [
        sharp([0.42, -0.15, 0.39, -0.38, -0.36, -0.4, -0.42, -0.33, -0.43, -0.14], S),
        sharp([0.34, -0.12, 0.31, -0.3, -0.3, -0.31, -0.35, -0.25, -0.36, -0.1], S),
        sharp([0.24, -0.09, 0.21, -0.2, -0.22, -0.21, -0.26, -0.16, -0.27, -0.07], S),
      ];
      tiers.forEach((p, i) => raised(g, p, grad(g, S, shade(pal.light, -0.1 + i * 0.1), shade(pal.dark, -0.05 + i * 0.05)), o, S, 1.4, 0.02, 0.65));
      for (const s of [-1, 1]) {
        for (let i = 0; i < 6; i++) {
          const x = 0.32 - i * 0.12;
          const sc = sharp([x + 0.05, -0.0, x + 0.04, -0.03, x - 0.07, -0.035, x - 0.08, 0], S);
          g.save(); g.translate(0, s * 0.405 * S);
          bevel(g, sc, i % 2 ? shade(pal.dark, 0.05) : shade(pal.body, -0.05), o, 0.8);
          g.restore();
        }
        rivetRow(g, 0.36 * S, s * 0.34 * S, -0.3 * S, s * 0.355 * S, 9, 0.011 * S);
        stripe(g, [0.38, s * 0.2, 0.38, s * 0.33], S, pal.accent, o * 1.3);
      }
      hazard(g, 0.43 * S, -0.12 * S, 0.03 * S, 0.24 * S, o, true);
      for (const s of [-1, 1]) lamp(g, 0.45 * S, s * 0.22 * S, 0.016 * S, '#fff3c4');
      vent(g, -0.44, -0.2, 0.04, 0.12, S, o);
      vent(g, -0.44, 0.2, 0.04, 0.12, S, o);
      break;
    }
    case 'bomber': {
      // bomb bay doors, wing panels, cockpit, engines
      const bay = roundedRect(-0.24, -0.09, 0.38, 0.18, 0.02, S);
      recess(g, bay, o, shade(pal.deep, 0.15));
      seam(g, [-0.24, 0, 0.14, 0, -0.11, -0.09, -0.11, 0.09, 0.02, -0.09, 0.02, 0.09], S, o * 0.6);
      hazard(g, -0.235 * S, -0.09 * S, 0.37 * S, 0.02 * S, o);
      hazard(g, -0.235 * S, 0.07 * S, 0.37 * S, 0.02 * S, o);
      for (const s of [-1, 1]) {
        seam(g, [0.18, s * 0.13, -0.08, s * 0.42, 0.02, s * 0.1, -0.25, s * 0.38], S, t);
        stripe(g, [-0.07, s * 0.455, -0.19, s * 0.455], S, pal.accent, o * 1.3);
        fillOut(g, roundedRect(-0.43, s * 0.11 - 0.04, 0.12, 0.08, 0.02, S), METAL.dark, o * 0.8);
        dot(g, -0.42 * S, s * 0.11 * S, 0.025 * S, '#07080a');
      }
      g.fillStyle = '#132230'; g.beginPath(); g.ellipse(0.33 * S, 0, 0.07 * S, 0.05 * S, 0, 0, P2); g.fill();
      g.lineWidth = o * 0.7; g.strokeStyle = OUTLINE; g.stroke();
      g.fillStyle = rgba(pal.glow, 0.55); g.beginPath(); g.ellipse(0.35 * S, -0.015 * S, 0.035 * S, 0.018 * S, 0, 0, P2); g.fill();
      break;
    }
    case 'centipede': {
      // armoured sensor head: visor bar + lenses
      const hp = sharp([0.475, 0, 0.465, -0.045, 0.43, -0.09, 0.37, -0.1, 0.335, -0.06, 0.33, 0], S);
      raised(g, hp, grad(g, S, shade(pal.light, 0.08), pal.body), o, S, 1, 0.01, 0.4);
      visor(g, 0.45 * S, -0.05 * S, 0.45 * S, 0.05 * S, 0.01 * S, E, o);
      for (const s of [-1, 1]) lens(g, 0.4 * S, s * 0.06 * S, 0.016 * S, E);
      seam(g, [0.36, 0, 0.42, 0], S, t);
      break;
    }
    case 'mantis':
      for (const s of [-1, 1]) {
        parts.push({
          px: 0.15 * S, py: s * 0.05 * S, ext: 0.36 * S, layer: 'over', mounts: [s < 0 ? 0 : 1],
          draw: (g, pal, o) => {
            const k = S;
            // coxa + femur reaching forward-out, spined tibia folded back, hooked tip
            limbSeg(g, 0, 0, 0.035 * k, 0.19 * k, s * 0.13 * k, 0.04 * k, shade(pal.light, 0.1), pal.dark, o);
            limbSeg(g, 0.19 * k, s * 0.13 * k, 0.03 * k, 0.08 * k, s * 0.2 * k, 0.02 * k, shade(pal.light, -0.05), pal.deep, o);
            for (const f of [0.25, 0.5, 0.75]) spike(g, (0.19 - 0.11 * f) * k, s * (0.13 + 0.07 * f) * k, s * -2.0, 0.035 * k, 0.009 * k, '#d8d0c0', o * 0.6);
            spike(g, 0.08 * k, s * 0.2 * k, Math.PI + s * 0.9, 0.06 * k, 0.014 * k, '#d8d0c0', o * 0.7);
            dot(g, 0.19 * k, s * 0.13 * k, 0.028 * k, METAL.dark);
            stripe(g, [0.05, s * 0.03, 0.15, s * 0.1], k, pal.accent, o * 0.8);
          },
          anim: (a) => {
            const f = (a.t * 0.23 + a.seed * 0.1 + (s > 0 ? 0.47 : 0)) % 1;
            const strike = f < 0.07 ? Math.sin((f / 0.07) * Math.PI) * 0.45 : 0;
            return { r: s * (0.07 * wob(a, 1.9, s) - strike) };
          },
        });
      }
      break;
    case 'mech':
    case 'warlord': {
      const W = L.shape === 'warlord';
      const sy = W ? 0.31 : 0.3;
      for (const s of [-1, 1]) {
        const mounts = W ? [s > 0 ? 1 : 2] : s > 0 ? [0] : [1, 2];
        parts.push({
          px: (W ? -0.02 : 0) * S, py: s * sy * S, ext: 0.4 * S, layer: W ? 'under' : 'over', mounts,
          draw: (g, pal, o) => {
            const k = S;
            const r = W ? 0.07 : 0.062, len = W ? 0.33 : 0.32;
            // upper arm, armoured forearm with team plate, fist/gun cradle
            limbSeg(g, 0, 0, r * 0.8 * k, 0.06 * k, s * 0.03 * k, r * 0.8 * k, METAL.light, METAL.dark, o);
            const fa = roundedRect(0.03, -r, len, r * 2, r * 0.6, k);
            g.save(); g.translate(0, s * 0.035 * k);
            raised(g, fa, grad(g, k, shade(pal.light, 0.05), pal.dark, 0, -r, len, r), o, k, 1.1, 0.012, 0.5);
            seam(g, [0.1, -r, 0.1, r, 0.2, -r, 0.2, r], k, o * 0.5);
            stripe(g, [0.05, s * r * 0.6, len - 0.02, s * r * 0.6], k, pal.accent, o * 0.9);
            fillOut(g, roundedRect(len - 0.02, -r * 0.8, 0.06, r * 1.6, 0.015, k), METAL.dark, o * 0.8);
            g.restore();
            if (!W) {
              // shoulder pauldron on top
              const pd = profilePath([0.09, 0, 0.085, 0.06, 0.04, 0.095, -0.05, 0.1, -0.11, 0.075, -0.125, 0], k);
              raised(g, pd, grad(g, k, shade(pal.light, 0.1), pal.dark, -0.08, -0.08, 0.08, 0.08), o, k, 1.2, 0.012, 0.5);
              stripe(g, [-0.09, s * 0.07, 0.05, s * 0.07], k, pal.accent, o * 1.2);
              seam(g, [0.0, -0.09, 0.0, 0.09, -0.06, -0.09, -0.06, 0.09], k, o * 0.5);
            }
          },
          anim: (a) => ({ dx: (a.moving ? 0.035 * Math.sin(a.walk + (s > 0 ? 0 : Math.PI)) : 0.006 * wob(a, 1.3, s)) * S, r: 0.02 * wob(a, 0.9, s * 2) }),
        });
      }
      break;
    }
    case 'arachnid':
    case 'broodmother':
    case 'arachne': {
      const big = S >= 4;
      const fx = L.shape === 'arachnid' ? 0.405 : L.shape === 'broodmother' ? 0.44 : 0.455;
      for (const s of [-1, 1]) {
        parts.push({
          px: fx * S, py: s * 0.04 * S, ext: 0.16 * S, layer: 'under',
          draw: (g, pal, o) => {
            const k = S;
            // chelicera + curved fang
            limbSeg(g, 0, 0, 0.032 * k, 0.05 * k, s * 0.01 * k, 0.026 * k, shade(pal.dark, 0.1), pal.deep, o);
            const f = new Path2D();
            f.moveTo(0.04 * k, s * -0.012 * k);
            f.quadraticCurveTo(0.11 * k, s * 0.0 * k, 0.1 * k, s * -0.05 * k);
            f.quadraticCurveTo(0.085 * k, s * 0.02 * k, 0.04 * k, s * 0.025 * k);
            f.closePath();
            fillOut(g, f, big ? '#d8d0c0' : METAL.light, o * 0.8);
          },
          anim: (a) => ({ r: s * 0.18 * Math.max(0, wob(a, 3.1, s * 0.4)) }),
        });
      }
      break;
    }
    case 'crab':
      for (const s of [-1, 1]) {
        const ci = parts.length;
        parts.push({
          px: 0.17 * S, py: s * 0.28 * S, ext: 0.56 * S, layer: 'under', mounts: [s < 0 ? 0 : 1],
          draw: (g, pal, o) => {
            const k = S;
            limbSeg(g, 0, 0, 0.045 * k, 0.1 * k, s * 0.11 * k, 0.042 * k, METAL.light, METAL.dark, o);
            g.save(); g.translate(0.09 * k, s * 0.11 * k);
            drawPalm(g, s, k, 1, pal, o);
            g.restore();
            dot(g, 0.1 * k, s * 0.11 * k, 0.03 * k, METAL.dark);
          },
          anim: (a) => ({ r: s * (0.07 * wob(a, 1.1, s) + 0.03 * wob(a, 2.7, 0)) }),
        });
        parts.push({ px: (0.09 + 0.22) * S, py: s * (0.11 + 0.05) * S, parent: ci, ext: 0.2 * S, layer: 'under', draw: (g, pal, o) => drawFinger(g, s, S, 1, pal, o), anim: snipAnim(s, 0.5) });
      }
      break;
    case 'saucer':
      parts.push({
        px: 0, py: 0, ext: 0.5 * S, layer: 'over',
        draw: (g, pal, o) => {
          const k = S, E = emis(pal);
          const ring = new Path2D();
          ring.arc(0, 0, 0.465 * k, 0, P2);
          ring.arc(0, 0, 0.35 * k, 0, P2, true);
          const gr = g.createRadialGradient(-0.1 * k, -0.15 * k, 0.2 * k, 0, 0, 0.47 * k);
          gr.addColorStop(0, shade(pal.light, 0.1)); gr.addColorStop(0.7, pal.body); gr.addColorStop(1, pal.dark);
          bevel(g, ring, gr, o, 1);
          g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = o * 0.6;
          g.beginPath();
          for (let i = 0; i < 16; i++) { const a = (i / 16) * P2; g.moveTo(Math.cos(a) * 0.355 * k, Math.sin(a) * 0.355 * k); g.lineTo(Math.cos(a) * 0.46 * k, Math.sin(a) * 0.46 * k); }
          g.stroke();
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * P2 + P2 / 32;
            lamp(g, Math.cos(a) * 0.41 * k, Math.sin(a) * 0.41 * k, 0.018 * k, i % 2 ? E : '#fff3c4');
          }
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * P2 + P2 / 16;
            g.fillStyle = pal.accent;
            g.save(); g.rotate(a); g.fillRect(0.37 * k, -0.025 * k, 0.07 * k, 0.05 * k); g.restore();
          }
        },
        anim: (a) => ({ r: a.t * (a.moving ? 1.1 : 0.45) + a.seed }),
      });
      break;
    case 'scorpion': {
      for (const s of [-1, 1]) {
        const ci = parts.length;
        const z = 0.85;
        parts.push({
          px: 0.29 * S, py: s * 0.13 * S, ext: 0.56 * S, layer: 'under', mounts: [s < 0 ? 1 : 2],
          draw: (g, pal, o) => {
            const k = S;
            limbSeg(g, 0, 0, 0.04 * k, 0.08 * k, s * 0.11 * k, 0.04 * k, shade(pal.light, -0.05), pal.dark, o);
            limbSeg(g, 0.08 * k, s * 0.11 * k, 0.038 * k, 0.14 * k, s * 0.16 * k, 0.04 * k, shade(pal.light, -0.05), pal.dark, o);
            dot(g, 0.08 * k, s * 0.11 * k, 0.03 * k, METAL.dark);
            g.save(); g.translate(0.13 * k, s * 0.16 * k);
            drawPalm(g, s, k, z, pal, o);
            g.restore();
          },
          anim: (a) => ({ r: s * (0.06 * wob(a, 0.9, s) + 0.02 * wob(a, 2.3, 1)) }),
        });
        parts.push({ px: (0.13 + 0.22 * z) * S, py: s * (0.16 + 0.05 * z) * S, parent: ci, ext: 0.2 * S, layer: 'under', draw: (g, pal, o) => drawFinger(g, s, S, z, pal, o), anim: snipAnim(s, 0.42) });
      }
      // tail: a chain of segments arching back over the body, stinger + heavy gun at the tip
      const P: [number, number, number][] = [[-0.32, 0.0, 0.08], [-0.44, 0.035, 0.078], [-0.555, 0.02, 0.08], [-0.63, -0.07, 0.085], [-0.625, -0.19, 0.09], [-0.53, -0.27, 0.095], [-0.42, -0.28, 0.1]];
      let parent = -1;
      for (let i = 0; i < P.length; i++) {
        const [x, y, r] = P[i];
        const nx = i + 1 < P.length ? P[i + 1][0] - x : 0.11, ny = i + 1 < P.length ? P[i + 1][1] - y : 0.01;
        const last = i === P.length - 1;
        const rel = parent < 0 ? [x, y] : [x - P[i - 1][0], y - P[i - 1][1]];
        const me = parts.length;
        parts.push({
          px: rel[0] * S, py: rel[1] * S, parent: parent < 0 ? undefined : parent, ext: 0.26 * S, layer: 'over', mounts: last ? [0] : undefined,
          draw: (g, pal, o) => {
            const k = S;
            const E = emis(pal);
            if (last) {
              // venom bulb + stinger pointing forward over the back
              spike(g, 0.07 * k, 0.0, 0.15, 0.11 * k, 0.03 * k, '#d8d0c0', o);
              const b = ellipse(0.0, 0.0, r * 1.05 * k, r * 0.85 * k, 0.1);
              const bg = g.createRadialGradient(-0.02 * k, -0.02 * k, 0, 0, 0, r * k);
              bg.addColorStop(0, shade(pal.light, 0.15)); bg.addColorStop(1, pal.dark);
              raised(g, b, bg, o, k, 1.2, 0.012, 0.6);
              glowLine(g, [-0.05, 0.05, 0.05, 0.05], k, E, o * 0.8);
              return;
            }
            const a = Math.atan2(ny, nx);
            const seg = ellipse(nx * 0.45 * k, ny * 0.45 * k, Math.hypot(nx, ny) * 0.62 * k, r * k, a);
            const sg = g.createLinearGradient(-r * k, -r * k, r * k, r * k);
            sg.addColorStop(0, shade(pal.light, 0.02 + i * 0.03)); sg.addColorStop(1, shade(pal.dark, -0.05));
            ao(g, seg, k);
            fillOut(g, seg, sg, o);
            g.save(); g.clip(seg);
            g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = o * 0.8;
            g.beginPath(); g.moveTo(nx * 0.1 * k - Math.sin(a) * r * 0.5 * k, ny * 0.1 * k + Math.cos(a) * -r * 0.5 * k); g.lineTo(nx * 0.8 * k - Math.sin(a) * r * 0.5 * k, ny * 0.8 * k - Math.cos(a) * r * 0.5 * k); g.stroke();
            g.restore();
            stripe(g, [nx * 0.2, ny * 0.2, nx * 0.7, ny * 0.7], k, rgba(pal.accent, 0.9), o * 0.9);
          },
          anim: (a) => ({ r: (a.moving ? 0.07 : 0.05) * Math.sin(a.t * 1.3 + a.seed - i * 0.55) + (last ? 0.04 * wob(a, 2.1, 0) : 0) }),
        });
        parent = me;
      }
      break;
    }
    case 'centipede': {
      const X = [-0.47, -0.335, -0.195, -0.055, 0.085, 0.22];
      for (let j = 0; j < X.length; j++) {
        const i = X.length - 1 - j; // 0 = right behind the head
        const tail = i === X.length - 1;
        const ry = tail ? 0.1 : 0.155 - i * 0.004, rx = tail ? 0.075 : 0.085;
        const mount = i >= 1 && i <= 4 ? [i - 1] : undefined;
        parts.push({
          px: X[j] * S, py: 0, ext: 0.28 * S, layer: 'under', mounts: mount,
          draw: (g, pal, o) => {
            const k = S, E = emis(pal);
            if (tail) for (const s of [-1, 1]) spike(g, -0.05 * k, s * 0.04 * k, Math.PI + s * 0.35, 0.1 * k, 0.02 * k, shade(pal.dark, -0.1), o);
            for (const s of [-1, 1]) spike(g, 0, s * ry * 0.9 * k, s * 1.6, 0.05 * k, 0.022 * k, shade(pal.dark, -0.1), o * 0.8);
            const sh = profilePath([rx, 0, rx * 0.9, ry * 0.55, rx * 0.4, ry, -rx * 0.5, ry * 0.95, -rx, ry * 0.45, -rx * 1.05, 0], k);
            const sg = g.createLinearGradient(0, -ry * k, 0, ry * k);
            sg.addColorStop(0, shade(pal.light, 0.08)); sg.addColorStop(0.55, pal.body); sg.addColorStop(1, pal.dark);
            ao(g, sh, k, 0.02, 0.6);
            bevel(g, sh, sg, o, 0.8);
            seam(g, [-rx * 0.3, -ry * 0.8, -rx * 0.3, ry * 0.8], k, o * 0.5);
            stripe(g, [rx * 0.3, -ry * 0.75, rx * 0.3, -ry * 0.45, rx * 0.3, ry * 0.75, rx * 0.3, ry * 0.45], k, pal.accent, o * 0.9);
            if (!mount) dot(g, 0, 0, 0.02 * k, rgba(E, 0.9));
          },
          anim: (a) => {
            const amp = (L.mob.id === 'spider' ? 0.04 : 0.022) * S * Math.min(1, (i + 1) / 3);
            const w = a.moving ? (a.odo / (0.9 * S)) * P2 : a.t * 0.8;
            const ph = w - i * 0.9 + a.seed;
            return { dy: amp * Math.sin(ph), r: -amp / S * 6 * Math.cos(ph) * 0.9 };
          },
        });
      }
      // mandibles on the head
      for (const s of [-1, 1]) {
        parts.push({
          px: 0.46 * S, py: s * 0.05 * S, ext: 0.14 * S, layer: 'under',
          draw: (g, _pal, o) => {
            const k = S;
            const f = new Path2D();
            f.moveTo(-0.01 * k, s * -0.015 * k);
            f.quadraticCurveTo(0.08 * k, s * 0.02 * k, 0.07 * k, s * -0.06 * k);
            f.quadraticCurveTo(0.06 * k, s * 0.04 * k, -0.01 * k, s * 0.03 * k);
            f.closePath();
            fillOut(g, f, '#cfc6b4', o * 0.9);
          },
          anim: (a) => ({ r: s * 0.25 * Math.max(0, wob(a, 2.6, s * 0.3)) }),
        });
      }
      break;
    }
  }
  return parts;
}

function ao(g: Ctx, path: Path2D, S: number, r = 0.015, a = 0.5): void {
  const k = devK(g);
  g.save();
  g.filter = `blur(${Math.max(1, r * S * k)}px)`;
  g.translate(0.006 * S, 0.012 * S);
  g.fillStyle = `rgba(0,0,0,${a})`;
  g.fill(path);
  g.restore();
}

/* -------------------------------------------------------------------------------------------- spider legs */

interface LegRig {
  /** hips and rest feet, fractions of S */
  legs: { hx: number; hy: number; fx: number; fy: number; grp: number }[];
  w: number;
  stride: number;
  big: boolean;
  armour: boolean;
}

const rigCache = new Map<string, LegRig>();

function legRig(L: UnitLayout): LegRig {
  const key = `${L.shape}|${L.S}`;
  let r = rigCache.get(key);
  if (r) return r;
  const S = L.S;
  const legs: LegRig['legs'] = [];
  const radial = (cx: number, hipR: number, hipRy: number, reach: number, angs: number[], ry = 1) => {
    angs.forEach((a, i) => {
      for (const s of [-1, 1]) {
        legs.push({ hx: cx + Math.cos(a) * hipR, hy: s * Math.sin(a) * hipRy, fx: cx + Math.cos(a) * reach, fy: s * Math.sin(a) * reach * ry, grp: (i + (s > 0 ? 1 : 0)) % 2 });
      }
    });
  };
  const row = (xs: number[], hy: number, fy: number, sweep: number[]) => {
    xs.forEach((x, i) => {
      for (const s of [-1, 1]) legs.push({ hx: x, hy: s * hy, fx: x + sweep[i], fy: s * fy, grp: (i + (s > 0 ? 1 : 0)) % 2 });
    });
  };
  let w = 0.065, stride = 0.13;
  let armour = false;
  switch (L.shape) {
    case 'arachnid': radial(0.24, 0.09, 0.1, 0.64, [0.5, 1.12, 1.82, 2.5]); w = 0.062; stride = 0.11; armour = true; break;
    case 'broodmother': radial(0.27, 0.1, 0.11, 0.72, [0.5, 1.1, 1.8, 2.48]); w = 0.058; stride = 0.1; armour = true; break;
    case 'arachne': radial(0.27, 0.11, 0.12, 0.76, [0.48, 1.08, 1.78, 2.46]); w = 0.062; stride = 0.1; armour = true; break;
    case 'scorpion': row([0.14, 0.03, -0.08, -0.19], 0.17, 0.47, [0.12, 0.02, -0.08, -0.17]); w = 0.055; stride = 0.08; armour = true; break;
    case 'crab': row([0.12, 0.02, -0.08, -0.17], 0.3, 0.58, [0.07, -0.02, -0.1, -0.2]); w = 0.06; stride = 0.08; armour = true; break;
    case 'mantis': row([0.06, -0.04], 0.05, 0.4, [0.22, -0.3]); w = 0.05; stride = 0.13; break;
    case 'centipede': row([0.36, 0.22, 0.085, -0.055, -0.195, -0.335], 0.1, 0.3, [0.04, 0.02, 0, -0.02, -0.04, -0.07]); w = 0.04; stride = 0.06; break;
    default: {
      const hr = Math.min(0.22, L.hw * 0.6);
      if (S >= 4) { radial(0, hr, hr, Math.max(0.64, L.hw + 0.28), [0.5, 1.15, 1.95, 2.6]); w = 0.05; stride = 0.09; }
      else { radial(0, hr, hr, Math.max(0.52, L.hw + 0.24), S >= 3 ? [0.6, 1.57, 2.5] : [0.55, 1.57, 2.55]); w = S >= 3 ? 0.055 : 0.065; }
      armour = S >= 3;
    }
  }
  r = { legs, w, stride, big: S >= 4, armour };
  rigCache.set(key, r);
  return r;
}

/** Articulated walker legs (spider mobility): arching femur, high knee, tapering tibia, claw tip. */
export function drawSpiderLegs(g: Ctx, L: UnitLayout, pal: TeamPal, phase: number, rest: boolean, o: number): void {
  const S = L.S;
  const rig = legRig(L);
  const E = emis(pal);
  const W = Math.max(rig.w * S, 0.075);
  const cent = L.shape === 'centipede';
  const order = rig.legs.map((l, i) => ({ l, i, lift: 0 }));
  const geo = order.map(({ l, i }) => {
    const ph = phase * P2 + (cent ? i * 0.7 : l.grp * Math.PI);
    const lift = rest ? 0 : Math.max(0, Math.cos(ph));
    const fx = (l.fx + (rest ? 0 : Math.sin(ph) * rig.stride)) * S, fy = l.fy * S * (1 - lift * 0.06);
    const hx = l.hx * S, hy = l.hy * S;
    const dx = fx - hx, dy = fy - hy, d = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx), lat = l.hy < 0 ? -Math.PI / 2 : Math.PI / 2;
    let da = lat - a;
    while (da > Math.PI) da -= P2;
    while (da < -Math.PI) da += P2;
    const ka = a + Math.max(-0.4, Math.min(0.4, da * 0.5));
    const kd = d * (0.56 + lift * 0.06);
    return { hx, hy, fx, fy, kx: hx + Math.cos(ka) * kd, ky: hy + Math.sin(ka) * kd, lift };
  });
  const idx = geo.map((_, i) => i).sort((p, q) => geo[p].lift - geo[q].lift);
  // contact shadows of planted feet (big walkers)
  if (rig.big) {
    g.save();
    g.filter = `blur(${Math.max(1, 0.02 * S * devK(g))}px)`;
    for (const k of geo) if (k.lift < 0.3) dot(g, k.fx + 0.015 * S, k.fy + 0.015 * S, W * 0.5, 'rgba(0,0,0,0.35)');
    g.restore();
  }
  for (const i of idx) {
    const { hx, hy, fx, fy, kx, ky, lift } = geo[i];
    const up = 1 + lift * 0.25;
    const fem0 = rig.armour ? shade(pal.body, -0.1 + lift * 0.15) : shade(METAL.light, lift * 0.1);
    const fem1 = rig.armour ? shade(pal.deep, 0.05) : METAL.dark;
    if (rig.big) {
      // three segments: femur up to the knee, tibia down to the ankle, slim metatarsus to the claw
      const ax = kx + (fx - kx) * 0.6, ay = ky + (fy - ky) * 0.6;
      limbSeg(g, ax, ay, W * 0.36, fx, fy, W * 0.16, METAL.base, METAL.deep, o);
      limbSeg(g, kx, ky, W * 0.66 * up, ax, ay, W * 0.42, shade(pal.dark, 0.1), pal.deep, o);
      dot(g, ax, ay, W * 0.34, METAL.dark);
      g.lineWidth = o * 0.6; g.strokeStyle = OUTLINE; g.stroke();
    } else limbSeg(g, kx, ky, W * 0.62 * up, fx, fy, W * 0.22, METAL.base, METAL.deep, o);
    limbSeg(g, hx, hy, W * 0.85, kx, ky, W * 0.8 * up, fem0, fem1, o);
    if (rig.big) {
      // femur armour lames + spikes
      for (const f of [0.3, 0.55, 0.8]) {
        const x = hx + (kx - hx) * f, y = hy + (ky - hy) * f;
        const a = Math.atan2(ky - hy, kx - hx);
        g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = o * 0.7;
        g.beginPath(); g.moveTo(x - Math.sin(a) * W * 0.8, y + Math.cos(a) * W * 0.8); g.lineTo(x + Math.sin(a) * W * 0.8, y - Math.cos(a) * W * 0.8); g.stroke();
      }
      const a = Math.atan2(ky - hy, kx - hx), side = hy < 0 ? -1 : 1;
      for (const f of [0.45, 0.85]) spike(g, hx + (kx - hx) * f, hy + (ky - hy) * f, a + side * 1.1, W * 0.8, W * 0.22, shade(pal.deep, 0.1), o * 0.8);
      g.strokeStyle = rgba(E, 0.85); g.lineWidth = o * 1.1; g.lineCap = 'round';
      g.beginPath(); g.moveTo(hx + (kx - hx) * 0.2, hy + (ky - hy) * 0.2); g.lineTo(hx + (kx - hx) * 0.8, hy + (ky - hy) * 0.8); g.stroke();
    }
    // knee: higher = bigger + brighter
    dot(g, kx, ky, W * 0.62 * up, rig.armour ? shade(pal.dark, 0.1 + lift * 0.2) : shade(METAL.base, lift * 0.2));
    g.lineWidth = o * 0.7; g.strokeStyle = OUTLINE; g.stroke();
    if (rig.big || rig.armour) dot(g, kx, ky, W * 0.26 * up, rgba(E, 0.95));
    else dot(g, kx - W * 0.15, ky - W * 0.15, W * 0.22, 'rgba(255,255,255,0.35)');
    // claw tip
    const b = Math.atan2(fy - ky, fx - kx);
    spike(g, fx - Math.cos(b) * W * 0.1, fy - Math.sin(b) * W * 0.1, b, W * 0.55, W * 0.18, OUTLINE, o * 0.5);
    if (cent) continue;
    dot(g, hx, hy, W * 0.55, METAL.dark);
  }
}

/* ------------------------------------------------------------------------------------------------ dynamic fx */

interface CLight { x: number; y: number; r: number; k: 'eye' | 'egg' | 'core'; ph: number; }
const lightCache = new Map<string, CLight[]>();

function lightsOf(L: UnitLayout): CLight[] {
  const key = L.shape + L.S;
  let o = lightCache.get(key);
  if (o) return o;
  const S = L.S;
  o = [];
  const eye = (x: number, y: number, r: number) => { for (const s of [-1, 1]) o!.push({ x: x * S, y: s * y * S, r: r * S, k: 'eye', ph: s }); };
  switch (L.shape) {
    case 'mantis': eye(0.385, 0.095, 0.06); break;
    case 'arachnid': eye(0.36, 0.05, 0.07); break;
    case 'crab': eye(0.335, 0.1, 0.045); break;
    case 'mech': o.push({ x: 0.19 * S, y: 0, r: 0.06 * S, k: 'eye', ph: 0 }); break;
    case 'warlord': o.push({ x: 0.26 * S, y: 0, r: 0.06 * S, k: 'eye', ph: 0 }); break;
    case 'scorpion': eye(0.33, 0.04, 0.035); break;
    case 'centipede': eye(0.44, 0.075, 0.035); break;
    case 'saucer': o.push({ x: 0, y: 0, r: 0.12 * S, k: 'core', ph: 0 }); break;
    case 'broodmother':
      eye(0.405, 0.05, 0.05);
      for (const [x, y, r] of EGGS) o.push({ x: x * S, y: y * S, r: r * S, k: 'egg', ph: x * 13 + y * 7 });
      break;
    case 'arachne': eye(0.425, 0.05, 0.045); break;
  }
  lightCache.set(key, o);
  return o;
}

/** Animated glows (eyes, egg sacs, saucer dome), drawn right after the hull + parts. */
export function drawCreatureFx(g: Ctx, L: UnitLayout, t: number, seed: number, x: number, y: number, ang: number, sc: number, px: number, pal: TeamPal, alpha: number): void {
  const ls = lightsOf(L);
  if (!ls.length) return;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const E = emis(pal);
  const glow = softDot(rgba(E, 1));
  const prev = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter';
  for (const l of ls) {
    const wx = x + (cs * l.x - sn * l.y) * sc, wy = y + (sn * l.x + cs * l.y) * sc;
    let a = 0, r = 0;
    if (l.k === 'eye') {
      const blink = ((t * 0.31 + seed * 0.17) % 1) < 0.025 ? 0.15 : 1;
      a = (0.45 + 0.3 * Math.sin(t * 2.4 + seed + l.ph * 0.6)) * blink;
      r = Math.max(4 / px, l.r * sc * 1.6);
    } else if (l.k === 'egg') {
      const b = Math.pow(0.5 + 0.5 * Math.sin(t * 1.7 + l.ph + seed), 2);
      a = 0.25 + 0.5 * b;
      r = l.r * sc * (2.2 + b);
    } else {
      const b = 0.5 + 0.5 * Math.sin(t * 2 + seed);
      a = 0.35 + 0.35 * b;
      r = l.r * sc * 2.2;
    }
    g.globalAlpha = alpha * a;
    g.drawImage(glow, wx - r, wy - r, r * 2, r * 2);
  }
  g.globalCompositeOperation = prev;
  g.globalAlpha = alpha;
}
