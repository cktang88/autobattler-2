// Odd-shaped frames: mantis / arachnid / crab / scorpion / centipede walkers, humanoid mechs, saucer, delta wing and
// the giant spider walkers. Art direction: these are MECHANICAL war machines that only borrow a creature's layout
// (think Zero-K spiders, Mechabellum crawlers, Battletech / Horizon machines) - faceted armour plates, panel seams,
// rivets, vents, exhausts, cable bundles, hydraulic rams on the joints, sensor clusters / visors instead of eyes,
// steel grippers and cutters instead of fangs, fuel cells instead of egg sacs. Each shape has a hull outline, hull
// details, and "parts": separately baked sprites with a pivot (arms, clamps, tail modules, body modules, a rotating
// ring) that are animated per frame and may carry turrets. Also: the walker leg rig used by the 'spider' mobility.
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

export function sharp(half: number[], S: number): Path2D {
  const p = new Path2D();
  poly(p, mirrorPoly(half), S);
  return p;
}

export function ellipse(x: number, y: number, rx: number, ry: number, rot = 0): Path2D {
  const p = new Path2D();
  p.ellipse(x, y, rx, ry, rot, 0, P2);
  return p;
}

/** Tapered capsule from (x0,y0) radius r0 to (x1,y1) radius r1 (cells). */
export function capsule(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): Path2D {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const p = new Path2D();
  p.arc(x0, y0, r0, a + Math.PI / 2, a + Math.PI * 1.5);
  p.arc(x1, y1, r1, a - Math.PI / 2, a + Math.PI / 2);
  p.closePath();
  return p;
}

/** Shaded limb segment: gradient fill, top highlight, outline. */
export function limbSeg(g: Ctx, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, c0: string, c1: string, o: number): void {
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

export function fillOut(g: Ctx, p: Path2D, fill: string | CanvasGradient, o: number): void {
  g.fillStyle = fill;
  g.fill(p);
  g.lineJoin = 'round';
  g.lineWidth = o;
  g.strokeStyle = OUTLINE;
  g.stroke(p);
}

export function stripe(g: Ctx, pts: number[], S: number, col: string, w: number): void {
  g.lineCap = 'round';
  g.strokeStyle = col;
  g.lineWidth = w;
  g.beginPath();
  for (let i = 0; i < pts.length; i += 4) { g.moveTo(pts[i] * S, pts[i + 1] * S); g.lineTo(pts[i + 2] * S, pts[i + 3] * S); }
  g.stroke();
}

/** Small triangular spike pointing along angle a from (x,y). */
export function spike(g: Ctx, x: number, y: number, a: number, len: number, w: number, fill: string, o: number): void {
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
export function beam(g: Ctx, x0: number, y0: number, w0: number, x1: number, y1: number, w1: number, c0: string, c1: string, o: number): void {
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
export function piston(g: Ctx, x0: number, y0: number, x1: number, y1: number, r: number, o: number): void {
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
export function joint(g: Ctx, x: number, y: number, r: number, o: number, fill: string, core?: string): void {
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
export function lens(g: Ctx, x: number, y: number, r: number, E: string): void {
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
export function visor(g: Ctx, x0: number, y0: number, x1: number, y1: number, w: number, E: string, o: number): void {
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
export function canister(g: Ctx, x: number, y: number, len: number, r: number, a: number, E: string, o: number): void {
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
export function fin(g: Ctx, x: number, y: number, a: number, len: number, w: number, fill: string, o: number): void {
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
export function plateSeams(g: Ctx, path: Path2D, xs: number[], S: number, o: number, w = 0.6): void {
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
export function cables(g: Ctx, pts: number[], S: number, w: number, n = 2): void {
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
    case 'mantis': return profilePath([0.48, 0, 0.46, 0.05, 0.4, 0.09, 0.33, 0.08, 0.28, 0.04, 0.2, 0.05, 0.08, 0.06, -0.02, 0.06, -0.1, 0.11, -0.26, 0.13, -0.4, 0.1, -0.47, 0], S);
    case 'mech': return sharp([0.28, 0, 0.27, -0.05, 0.23, -0.08, 0.2, -0.18, 0.13, -0.24, 0.12, -0.32, 0.02, -0.34, -0.08, -0.33, -0.1, -0.28, -0.2, -0.22, -0.24, -0.14, -0.33, -0.12, -0.36, -0.05, -0.32, 0], S);
    case 'arachnid': return profilePath([0.45, 0, 0.43, 0.06, 0.36, 0.12, 0.25, 0.14, 0.15, 0.11, 0.08, 0.06, 0.02, 0.1, -0.08, 0.2, -0.22, 0.245, -0.36, 0.22, -0.45, 0.13, -0.48, 0], S);
    // spiked carapace: sawtooth shell rim
    case 'crab': return sharp([0.3, 0, 0.29, -0.08, 0.27, -0.16, 0.3, -0.22, 0.24, -0.3, 0.2, -0.38, 0.14, -0.39, 0.1, -0.44, 0.04, -0.4, -0.04, -0.45, -0.1, -0.4, -0.18, -0.43, -0.22, -0.36, -0.28, -0.34, -0.3, -0.26, -0.36, -0.2, -0.32, -0.12, -0.36, -0.05, -0.33, 0], S);
    case 'saucer': {
      // manta disc: bridge prow, twin side nacelles and a split tail jutting out past the turret ring
      const p = new Path2D();
      const bump = (a: number, c: number, wdt: number, h: number) => { let d = Math.abs(a - c); d = Math.min(d, P2 - d); return d < wdt ? h * (1 - Math.pow(d / wdt, 4)) : 0; };
      for (let i = 0; i < 128; i++) {
        const a = (i / 128) * P2;
        const r = 0.44 + bump(a, 0, 0.2, 0.12) + bump(a, 1.75, 0.2, 0.08) + bump(a, P2 - 1.75, 0.2, 0.08) + bump(a, 2.85, 0.13, 0.09) + bump(a, P2 - 2.85, 0.13, 0.09);
        i ? p.lineTo(Math.cos(a) * r * S, Math.sin(a) * r * S) : p.moveTo(Math.cos(a) * r * S, Math.sin(a) * r * S);
      }
      p.closePath();
      return p;
    }
    case 'delta': { const p = new Path2D(); poly(p, mirrorPoly([0.5, 0, 0.3, -0.075, -0.27, -0.46, -0.39, -0.46, -0.34, -0.31, -0.45, -0.22, -0.47, -0.1, -0.41, 0]), S); return p; }
    case 'warlord': return sharp([0.3, 0, 0.29, -0.05, 0.25, -0.08, 0.22, -0.18, 0.14, -0.26, 0.1, -0.27, -0.11, -0.27, -0.2, -0.22, -0.24, -0.17, -0.34, -0.19, -0.41, -0.1, -0.39, 0], S);
    case 'scorpion': return sharp([0.4, 0, 0.38, -0.08, 0.32, -0.16, 0.24, -0.2, 0.22, -0.26, 0.15, -0.23, 0.09, -0.28, 0.02, -0.235, -0.05, -0.285, -0.12, -0.235, -0.19, -0.28, -0.25, -0.21, -0.31, -0.17, -0.37, -0.1, -0.36, 0], S);
    case 'centipede': return sharp([0.5, 0, 0.49, -0.05, 0.45, -0.11, 0.38, -0.13, 0.32, -0.11, 0.29, 0], S);
    case 'broodmother': return sharp([0.47, 0, 0.46, -0.07, 0.4, -0.14, 0.29, -0.17, 0.19, -0.15, 0.13, -0.09, 0.08, -0.12, 0.0, -0.25, -0.12, -0.34, -0.33, -0.36, -0.44, -0.28, -0.5, -0.14, -0.5, 0], S);
    case 'carriage': return profilePath([0.25, 0, 0.245, 0.1, 0.21, 0.22, 0.15, 0.265, 0.09, 0.22, 0.07, 0.12, -0.08, 0.1, -0.15, 0.05, -0.16, 0], S);
    case 'hunter': return sharp([0.5, 0, 0.3, -0.065, 0.12, -0.11, 0.04, -0.27, -0.06, -0.31, -0.11, -0.15, -0.3, -0.14, -0.38, -0.25, -0.47, -0.25, -0.44, -0.08, -0.47, 0], S);
    // riot plough: toothed sloped front, cut-in flanks, rear engine block
    case 'riot': return sharp([0.45, 0, 0.42, -0.088, 0.36, -0.12, 0.36, -0.188, 0.3, -0.22, 0.3, -0.288, 0.24, -0.32, 0.24, -0.388, 0.18, -0.42, 0.06, -0.43, 0.02, -0.3, -0.12, -0.3, -0.15, -0.345, -0.3, -0.345, -0.34, -0.3, -0.44, -0.21, -0.46, -0.08, -0.43, 0], S);
    case 'interceptor': return sharp([0.5, 0, 0.32, -0.05, 0.06, -0.08, -0.2, -0.43, -0.31, -0.43, -0.2, -0.1, -0.34, -0.1, -0.42, -0.22, -0.48, -0.22, -0.45, 0], S);
    case 'siegeplat': return sharp([0.46, -0.04, 0.44, -0.12, 0.34, -0.17, 0.34, -0.28, 0.22, -0.35, -0.2, -0.35, -0.24, -0.31, -0.3, -0.31, -0.35, -0.38, -0.45, -0.35, -0.43, -0.2, -0.47, -0.1, -0.44, -0.04], S);
    // wall of armour: a swept dozer-blade front wider than the tracks, notched casemate flanks, rear engine block
    case 'juggernaut': return sharp([0.58, 0, 0.52, -0.1, 0.47, -0.3, 0.47, -0.52, 0.35, -0.52, 0.31, -0.44, 0.22, -0.44, 0.19, -0.47, -0.06, -0.47, -0.1, -0.415, -0.16, -0.415, -0.2, -0.47, -0.38, -0.47, -0.46, -0.4, -0.5, -0.22, -0.45, -0.17, -0.49, -0.06], S);
    case 'bomber': return sharp([0.46, 0, 0.3, -0.115, -0.05, -0.47, -0.2, -0.47, -0.27, -0.37, -0.35, -0.41, -0.45, -0.29, -0.4, -0.18, -0.46, -0.07, -0.42, 0], S);
    case 'arachne': return profilePath([0.49, 0, 0.47, 0.07, 0.41, 0.14, 0.31, 0.18, 0.2, 0.17, 0.13, 0.11, 0.07, 0.13, -0.02, 0.22, -0.14, 0.3, -0.3, 0.32, -0.43, 0.25, -0.5, 0.12, -0.51, 0], S);
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
      g.beginPath(); g.moveTo(-0.3 * S, -0.1 * S); g.lineTo(-0.47 * S, -0.16 * S); g.stroke();
      g.strokeStyle = METAL.light; g.lineWidth = 0.012 * S; g.stroke();
      dot(g, -0.3 * S, -0.1 * S, 0.028 * S, METAL.dark);
      break;
    case 'crab':
      // periscope sensor booms + armoured skirt plates around the rim
      for (const s of [-1, 1]) {
        beam(g, 0.2 * S, s * 0.08 * S, 0.026 * S, 0.33 * S, s * 0.11 * S, 0.022 * S, METAL.light, METAL.dark, o);
      }
      break;
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
      // lanky alien strider: smooth power core, slender spine, sleek sensor head
      const pack = profilePath([-0.05, 0, -0.1, 0.1, -0.24, 0.12, -0.38, 0.09, -0.45, 0], S);
      floatGap(g, pack, E, o, S);
      sleekShell(g, pack, pal, o, S, -0.1, -0.12, -0.4, 0.12);
      seamGlow(g, [-0.09, -0.07, -0.25, -0.12, -0.42, -0.04, -0.09, 0.07, -0.25, 0.12, -0.42, 0.04], S, E, o * 0.8);
      cables(g, [0.06, 0, -0.08, 0], S, 0.014 * S, 2);
      const sp = profilePath([0.25, 0, 0.22, 0.04, 0.12, 0.05, 0.03, 0.04, 0.01, 0], S);
      sleekShell(g, sp, pal, o, S, 0.02, -0.05, 0.24, 0.05);
      const hd = profilePath([0.47, 0, 0.455, 0.045, 0.41, 0.085, 0.35, 0.08, 0.31, 0.04, 0.3, 0], S);
      sleekShell(g, hd, pal, o, S, 0.3, -0.09, 0.47, 0.09);
      seamGlow(g, [0.42, -0.06, 0.465, 0, 0.42, 0.06], S, E, o * 1.4);
      void t;
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
      const inner = sharp([0.2, 0, 0.2, -0.12, 0.17, -0.22, 0.11, -0.28, -0.12, -0.3, -0.19, -0.25, -0.23, -0.16, -0.23, 0], S);
      raised(g, inner, grad(g, S, shade(pal.light, 0.05), pal.dark), o, S, 1.2, 0.012, 0.5);
      seam(g, [0.2, 0, -0.23, 0], S, t);
      g.save(); g.clip(inner);
      seam(g, [0.08, -0.29, 0.02, -0.06, 0.08, 0.29, 0.02, 0.06, -0.19, -0.23, -0.1, -0.05, -0.19, 0.23, -0.1, 0.05], S, t);
      g.restore();
      for (const s of [-1, 1]) {
        // bolted side skirt slabs: bunker armour
        for (const [x0, x1] of [[0.18, 0.04], [0.02, -0.12], [-0.14, -0.26]]) {
          const sk = new Path2D(); poly(sk, [x0, s * 0.31, x0 - 0.01, s * 0.395, x1 + 0.01, s * 0.395, x1, s * 0.31], S);
          bevel(g, sk, grad(g, S, shade(pal.light, -0.15), pal.dark, x1, s * 0.3, x0, s * 0.4), o, 0.8);
          rivetRow(g, (x0 - 0.02) * S, s * 0.355 * S, (x1 + 0.02) * S, s * 0.355 * S, 3, 0.009 * S);
        }
        stripe(g, [0.14, s * 0.29, -0.02, s * 0.3], S, pal.accent, o * 1.1);
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
      plateSeams(g, hull, [0.04, -0.2], S, o, 0.7);
      // side armour sponsons
      for (const s of [-1, 1]) {
        const sp = sharp([0.16, 0, 0.14, -0.04, 0.12, -0.045, -0.22, -0.045, -0.26, -0.02, -0.26, 0], S);
        g.save(); g.translate(0, s * 0.155 * S);
        raised(g, sp, grad(g, S, shade(pal.light, -0.02), pal.dark, 0, -0.05, 0, 0.05), o, S, 0.9, 0.008, 0.4);
        seam(g, [-0.05, -0.04, -0.05, 0.04], S, t);
        rivetRow(g, 0.1 * S, 0, -0.2 * S, 0, 5, 0.008 * S);
        g.restore();
      }
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
        stripe(g, [0.1, s * 0.205, -0.18, s * 0.19], S, pal.accent, o * 1.0);
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
      // one massive cast casemate behind a swept dozer-blade glacis; overlapping ablative scales down the flanks
      const blade = sharp([0.58, 0, 0.52, -0.1, 0.47, -0.3, 0.47, -0.52, 0.35, -0.52, 0.31, -0.44, 0.34, -0.3, 0.39, -0.1, 0.41, 0], S);
      const bg = g.createLinearGradient(0.58 * S, 0, 0.32 * S, 0);
      bg.addColorStop(0, shade(pal.light, 0.12)); bg.addColorStop(1, shade(pal.dark, 0.05));
      raised(g, blade, bg, o, S, 1.6, 0.02, 0.7);
      for (const s of [-1, 1]) {
        seam(g, [0.5, s * 0.05, 0.44, s * 0.28, 0.44, s * 0.28, 0.43, s * 0.48], S, t);
        hazard(g, 0.37 * S, (s > 0 ? 0.42 : -0.5) * S, 0.08 * S, 0.08 * S, o, true);
        lamp(g, 0.5 * S, s * 0.13 * S, 0.018 * S, '#fff3c4');
        rivetRow(g, 0.43 * S, s * 0.1 * S, 0.39 * S, s * 0.42 * S, 6, 0.011 * S);
      }
      const cm = sharp([0.32, -0.12, 0.28, -0.35, -0.28, -0.37, -0.36, -0.29, -0.37, -0.1], S);
      raised(g, cm, grad(g, S, shade(pal.light, -0.04), shade(pal.dark, -0.08)), o, S, 1.4, 0.02, 0.65);
      seam(g, [0.1, -0.36, 0.1, 0.36, -0.14, -0.37, -0.14, 0.37], S, t);
      // asymmetric command tower on the left of the casemate: vision slits all round, periscope head
      const twp = new Path2D(); poly(twp, [0.27, -0.17, 0.25, -0.31, 0.12, -0.31, 0.1, -0.17], S);
      raised(g, twp, grad(g, S, shade(pal.light, 0.08), pal.dark), o, S, 1.3, 0.015, 0.6);
      g.fillStyle = '#04070a';
      g.fillRect(0.245 * S, -0.29 * S, 0.012 * S, 0.1 * S);
      glowLine(g, [0.251, -0.28, 0.251, -0.2], S, E, o * 0.8);
      for (const yy of [-0.2, -0.28]) { g.fillStyle = '#04070a'; g.fillRect(0.14 * S, yy * S, 0.08 * S, 0.01 * S); }
      dot(g, 0.18 * S, -0.24 * S, 0.028 * S, METAL.dark); dot(g, 0.18 * S, -0.24 * S, 0.014 * S, METAL.light);
      for (const s of [-1, 1]) rivetRow(g, 0.26 * S, s * 0.31 * S, -0.3 * S, s * 0.33 * S, 10, 0.01 * S);
      for (const s of [-1, 1]) {
        for (let i = 0; i < 6; i++) {
          const x = 0.27 - i * 0.11;
          const sc = sharp([x + 0.05, -0.0, x + 0.04, -0.03, x - 0.07, -0.035, x - 0.08, 0], S);
          g.save(); g.translate(0, s * 0.415 * S);
          bevel(g, sc, i % 2 ? shade(pal.dark, 0.05) : shade(pal.body, -0.05), o, 0.8);
          g.restore();
        }
        stripe(g, [0.3, s * 0.4, 0.3, s * 0.44], S, pal.accent, o * 1.3);
      }
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
  }
}

export function roundedRect(x: number, y: number, w: number, h: number, r: number, S: number): Path2D {
  const p = new Path2D();
  roundRect(p, x * S, y * S, w * S, h * S, r * S);
  return p;
}
export function vent(g: Ctx, x: number, y: number, w: number, h: number, S: number, o: number): void {
  const p = roundedRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.2, S);
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fill(p);
  g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = o * 0.35;
  g.beginPath();
  const horiz = w > h, n = 4;
  for (let i = 1; i < n; i++) {
    if (horiz) { const xx = (x - w / 2 + (w * i) / n) * S; g.moveTo(xx, (y - h * 0.35) * S); g.lineTo(xx, (y + h * 0.35) * S); }
    else { const yy = (y - h / 2 + (h * i) / n) * S; g.moveTo((x - w * 0.35) * S, yy); g.lineTo((x + w * 0.35) * S, yy); }
  }
  g.stroke();
}
function circPath(x: number, y: number, r: number, S: number): Path2D { return circ(x, y, r, S); }

/** Sensor cluster: dark recessed housing with a visor bar and a lens array (cells, fractions of S). */
export function sensorCluster(g: Ctx, x: number, hw: number, S: number, E: string, o: number, big: boolean): void {
  const hous = sharp([x + 0.025, -hw * 0.55, x + 0.01, -hw, x - 0.05, -hw, x - 0.065, -hw * 0.5, x - 0.065, 0], S);
  recess(g, hous, o, '#0a0d10');
  visor(g, (x + 0.004) * S, -hw * 0.62 * S, (x + 0.004) * S, hw * 0.62 * S, 0.009 * S, E, o);
  lens(g, (x - 0.035) * S, 0, (big ? 0.02 : 0.022) * S, E);
  for (const s of [-1, 1]) {
    lens(g, (x - 0.03) * S, s * hw * 0.62 * S, 0.013 * S, E);
    if (big) lens(g, (x - 0.05) * S, s * hw * 0.3 * S, 0.009 * S, E);
  }
}

/** Sleek alien shell: polished team-tinted metal, broad specular sweep, crisp outline. */
export function sleekShell(g: Ctx, p: Path2D, pal: TeamPal, o: number, S: number, x0: number, y0: number, x1: number, y1: number): void {
  const gr = g.createLinearGradient(x0 * S, y0 * S, x1 * S, y1 * S);
  gr.addColorStop(0, shade(pal.light, 0.05)); gr.addColorStop(0.35, pal.body); gr.addColorStop(1, shade(pal.deep, 0.1));
  ao(g, p, S, 0.02, 0.6);
  g.fillStyle = gr; g.fill(p);
  g.save(); g.clip(p);
  const sp = g.createLinearGradient(x0 * S, y0 * S, x1 * S, y1 * S);
  sp.addColorStop(0, 'rgba(255,255,255,0)'); sp.addColorStop(0.3, 'rgba(255,255,255,0.32)'); sp.addColorStop(0.42, 'rgba(255,255,255,0)');
  g.fillStyle = sp; g.fill(p);
  g.lineWidth = o * 3; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.stroke(p);
  g.restore();
  g.lineWidth = o; g.lineJoin = 'round'; g.strokeStyle = OUTLINE; g.stroke(p);
}

/** Curved glowing seams: [x0, y0, cx, cy, x1, y1, ...] fractions of S. */
export function seamGlow(g: Ctx, q: number[], S: number, E: string, w: number): void {
  g.lineCap = 'round';
  for (const [col, lw] of [['rgba(0,0,0,0.6)', w * 2.2], [rgba(E, 0.95), w], ['rgba(255,255,255,0.7)', w * 0.35]] as [string, number][]) {
    g.strokeStyle = col; g.lineWidth = lw;
    g.beginPath();
    for (let i = 0; i < q.length; i += 6) { g.moveTo(q[i] * S, q[i + 1] * S); g.quadraticCurveTo(q[i + 2] * S, q[i + 3] * S, q[i + 4] * S, q[i + 5] * S); }
    g.stroke();
  }
}

/** Levitating core module: dark gap ring with an emissive underglow, then the shell floating above it. */
export function floatGap(g: Ctx, p: Path2D, E: string, o: number, S: number): void {
  g.save();
  g.lineJoin = 'round';
  g.strokeStyle = rgba(E, 0.35); g.lineWidth = 0.05 * S; g.stroke(p);
  g.strokeStyle = '#05080b'; g.lineWidth = 0.025 * S; g.stroke(p);
  g.strokeStyle = rgba(E, 0.8); g.lineWidth = o * 0.7; g.stroke(p);
  g.restore();
}

/** Arachnid / Broodmother / Arachne: armoured walker cab up front, engine / ammo module behind. */
function spiderDetails(g: Ctx, L: UnitLayout, pal: TeamPal, o: number, hull: Path2D): void {
  const S = L.S;
  const E = emis(pal);
  const t = o * 0.5;
  if (L.shape === 'arachnid') {
    // sleek alien quad walker: levitating rear core pod, smooth cab with one wide sensor visor
    const ab = profilePath([0.0, 0, -0.03, 0.1, -0.1, 0.18, -0.22, 0.21, -0.34, 0.19, -0.42, 0.11, -0.44, 0], S);
    floatGap(g, ab, E, o, S);
    sleekShell(g, ab, pal, o, S, -0.1, -0.2, -0.35, 0.2);
    seamGlow(g, [-0.04, -0.12, -0.2, -0.24, -0.38, -0.1, -0.04, 0.12, -0.2, 0.24, -0.38, 0.1, -0.12, 0, -0.25, -0.03, -0.4, 0], S, E, o * 0.9);
    const ce = profilePath([0.41, 0, 0.39, 0.06, 0.32, 0.115, 0.22, 0.125, 0.14, 0.09, 0.11, 0], S);
    sleekShell(g, ce, pal, o, S, 0.15, -0.12, 0.4, 0.12);
    seamGlow(g, [0.37, -0.085, 0.405, 0, 0.37, 0.085], S, E, o * 1.6);
    seamGlow(g, [0.15, -0.06, 0.25, -0.11, 0.33, -0.07, 0.15, 0.06, 0.25, 0.11, 0.33, 0.07], S, E, o * 0.7);
    dot(g, 0.07 * S, 0, 0.03 * S, OUTLINE); dot(g, 0.07 * S, 0, 0.02 * S, rgba(E, 0.9));
    void t;
    return;
  }
  if (L.shape === 'broodmother') {
    // rear module: heavy reactor / ammo bunker ringed with fuel cells
    const ab = sharp([0.05, 0, 0.02, -0.13, -0.06, -0.25, -0.17, -0.315, -0.32, -0.315, -0.42, -0.24, -0.465, -0.12, -0.475, 0], S);
    raised(g, ab, grad(g, S, shade(pal.body, 0.05), pal.deep, -0.1, -0.3, -0.3, 0.3), o, S, 1.4, 0.03, 0.7);
    // inner armour deck
    const deck = sharp([-0.02, 0, -0.05, -0.1, -0.11, -0.19, -0.3, -0.22, -0.39, -0.16, -0.42, 0], S);
    bevel(g, deck, grad(g, S, shade(pal.light, -0.02), pal.dark, -0.1, -0.2, -0.4, 0.2), o, 1.2);
    plateSeams(g, deck, [-0.12, -0.25], S, o, 0.6);
    seam(g, [-0.02, 0, -0.42, 0], S, t);
    for (const s of [-1, 1]) {
      rivetRow(g, -0.06 * S, s * 0.12 * S, -0.36 * S, s * 0.19 * S, 6, 0.007 * S);
      glowLine(g, [-0.06, s * 0.2, -0.2, s * 0.27], S, E, o * 1.1);
    }
    reactor(g, -0.32 * S, 0, 0.045 * S, o, E);
    hazard(g, -0.47 * S, -0.06 * S, 0.02 * S, 0.12 * S, o, true);
    // fuel cells / ammo drums racked along the flanks (tangent to the rim)
    for (const [x, y, r] of CELLS) {
      canister(g, x * S, y * S, r * 2.6 * S, r * 0.8 * S, Math.atan2(y, x + 0.2) + Math.PI / 2, E, o * 0.8);
    }
    // waist coupling
    cables(g, [0.16, 0, 0.02, 0], S, 0.016 * S, 3);
    joint(g, 0.09 * S, 0, 0.04 * S, o, METAL.base);
    // command cab
    const ce = sharp([0.45, 0, 0.44, -0.065, 0.38, -0.13, 0.28, -0.155, 0.18, -0.13, 0.13, 0], S);
    raised(g, ce, grad(g, S, shade(pal.light, 0.05), pal.dark), o, S, 1.4, 0.025, 0.6);
    seam(g, [0.18, 0, 0.36, 0, 0.3, -0.14, 0.26, -0.04, 0.3, 0.14, 0.26, 0.04], S, t);
    rivetRow(g, 0.2 * S, -0.12 * S, 0.36 * S, -0.1 * S, 5, 0.006 * S);
    rivetRow(g, 0.2 * S, 0.12 * S, 0.36 * S, 0.1 * S, 5, 0.006 * S);
    sensorCluster(g, 0.44, 0.075, S, E, o, true);
    return;
  }
  // arachne: colossal alien walking fortress - layered smooth shells, glowing seams, levitating core rings
  const ab = profilePath([0.04, 0, 0.01, 0.15, -0.08, 0.25, -0.22, 0.29, -0.36, 0.27, -0.45, 0.19, -0.47, 0.09, -0.475, 0], S);
  floatGap(g, ab, E, o, S);
  sleekShell(g, ab, pal, o, S, -0.1, -0.3, -0.35, 0.3);
  for (let i = 0; i < 3; i++) {
    const x0 = -0.08 - i * 0.12, w = [0.22, 0.25, 0.2][i];
    const lm = profilePath([x0, 0, x0 - 0.005, w * 0.6, x0 - 0.03, w, x0 - 0.08, w * 0.95, x0 - 0.095, w * 0.5, x0 - 0.1, 0], S);
    sleekShell(g, lm, pal, o * 0.8, S, x0, -w, x0 - 0.1, w);
  }
  seamGlow(g, [-0.06, -0.2, -0.24, -0.31, -0.42, -0.16, -0.06, 0.2, -0.24, 0.31, -0.42, 0.16], S, E, o * 1.2);
  for (const s of [-1, 1]) { dot(g, -0.3 * S, s * 0.13 * S, 0.03 * S, OUTLINE); dot(g, -0.3 * S, s * 0.13 * S, 0.02 * S, rgba(E, 0.85)); }
  cables(g, [0.15, 0, 0.0, 0], S, 0.016 * S, 3);
  dot(g, 0.075 * S, 0, 0.045 * S, OUTLINE); dot(g, 0.075 * S, 0, 0.035 * S, '#0b1016');
  g.strokeStyle = rgba(E, 0.9); g.lineWidth = o; g.beginPath(); g.arc(0.075 * S, 0, 0.025 * S, 0, P2); g.stroke();
  // command cab: smooth crest with a sweeping visor arc
  const ce = profilePath([0.48, 0, 0.46, 0.07, 0.39, 0.13, 0.29, 0.165, 0.2, 0.155, 0.14, 0.09, 0.13, 0], S);
  sleekShell(g, ce, pal, o * 1.1, S, 0.15, -0.16, 0.47, 0.16);
  const cr = profilePath([0.4, 0, 0.38, 0.05, 0.31, 0.085, 0.22, 0.08, 0.19, 0], S);
  sleekShell(g, cr, pal, o, S, 0.2, -0.09, 0.4, 0.09);
  seamGlow(g, [0.43, -0.1, 0.475, 0, 0.43, 0.1], S, E, o * 2);
  seamGlow(g, [0.16, -0.1, 0.26, -0.165, 0.36, -0.13, 0.16, 0.1, 0.26, 0.165, 0.36, 0.13], S, E, o * 0.8);
  void hull; void t;
}

/** Broodmother fuel cells around the rear module rim [x, y, r]. */
const CELLS: [number, number, number][] = [
  [-0.37, -0.255, 0.034], [-0.255, -0.29, 0.032], [-0.44, -0.165, 0.03],
  [-0.37, 0.255, 0.034], [-0.255, 0.29, 0.032], [-0.44, 0.165, 0.03],
  [-0.14, -0.27, 0.026], [-0.14, 0.27, 0.026],
];

/* ------------------------------------------------------------------------------------------------- parts */

export interface AnimIn {
  t: number;
  odo: number;
  moving: boolean;
  seed: number;
  /** leg gait phase, radians */
  walk: number;
}

export interface PartDef {
  /** pivot (cells), in hull coords or relative to the parent's pivot */
  px: number;
  py: number;
  /** sprite half extent (cells) around the pivot */
  ext: number;
  parent?: number;
  /** under = between mobility and hull, over = above hull, below turrets */
  layer: 'under' | 'over';
  draw: (g: Ctx, pal: TeamPal, o: number) => void;
  anim?: (a: AnimIn) => { r?: number; dx?: number; dy?: number };
  /** mount indices riding on this part */
  mounts?: number[];
  /** footprint frames: where the riding weapon sits, in the part's rest frame (cells from the pivot) */
  mountAt?: [number, number];
}

export interface Xf { x: number; y: number; r: number; }

const partCache = new Map<string, PartDef[]>();

/** Footprint art hooks (set by footart.ts): parts, leg rig and lights for redesigned frames; null = shape tables. */
export const creatureHooks: {
  parts: ((L: UnitLayout) => PartDef[] | null) | null;
  rig: ((L: UnitLayout) => LegRig | null) | null;
  lights: ((L: UnitLayout) => CLight[] | null) | null;
} = { parts: null, rig: null, lights: null };

export function partsOf(L: UnitLayout): PartDef[] {
  const key = `${L.chassis.id}|${L.mob.id}|${L.X}|${L.Y}`;
  let p = partCache.get(key);
  if (!p) { p = creatureHooks.parts?.(L) ?? buildParts(L); partCache.set(key, p); }
  return p;
}

/** Part transforms (hull coords) for an animation state; null = rest pose. */
export function partXfs(parts: PartDef[], a: AnimIn | null): Xf[] {
  const out: Xf[] = [];
  for (let i = 0; i < parts.length; i++) {
    const d = parts[i];
    const an = a && d.anim ? d.anim(a) : null;
    const lx = d.px + (an?.dx ?? 0), ly = d.py + (an?.dy ?? 0), lr = an?.r ?? 0;
    if (d.parent !== undefined) {
      const P = out[d.parent];
      const c = Math.cos(P.r), s = Math.sin(P.r);
      out.push({ x: P.x + c * lx - s * ly, y: P.y + s * lx + c * ly, r: P.r + lr });
    } else out.push({ x: lx, y: ly, r: lr });
  }
  return out;
}

/** Mount position (hull coords) when riding a part. */
export function mountOnPart(parts: PartDef[], rest: Xf[], xfs: Xf[], i: number, mx: number, my: number): { x: number; y: number } | null {
  for (let j = 0; j < parts.length; j++) {
    if (!parts[j].mounts?.includes(i)) continue;
    const R = rest[j], X = xfs[j];
    const dx = mx - R.x, dy = my - R.y;
    const c0 = Math.cos(-R.r), s0 = Math.sin(-R.r);
    const qx = c0 * dx - s0 * dy, qy = s0 * dx + c0 * dy;
    const c = Math.cos(X.r), s = Math.sin(X.r);
    return { x: X.x + c * qx - s * qy, y: X.y + s * qx + c * qy };
  }
  return null;
}

/** Mount indices that ride on parts. */
export function partMounts(parts: PartDef[]): Set<number> {
  const s = new Set<number>();
  for (const p of parts) for (const m of p.mounts ?? []) s.add(m);
  return s;
}

export function snipAnim(s: number, rate: number): (a: AnimIn) => { r: number } {
  return (a) => {
    const c = (a.t * rate + a.seed * 0.13 + (s > 0 ? 0.5 : 0)) % 1;
    return { r: s * (0.22 + 0.3 * (c < 0.18 ? Math.sin((c / 0.18) * Math.PI * 2) : 0)) };
  };
}

/** Hydraulic clamp body along +x from the wrist at (0,0): boxy armoured housing, ram on top, fixed steel jaw. */
export function drawPalm(g: Ctx, s: number, k: number, z: number, pal: TeamPal, o: number): void {
  const Z = k * z;
  // fixed jaw (steel, angular, serrated inner edge)
  const fx = new Path2D();
  poly(fx, [0.2, 0.0, 0.33, -s * 0.005, 0.41, s * 0.025, 0.385, -s * 0.045, 0.3, -s * 0.075, 0.19, -s * 0.07], Z);
  fillOut(g, fx, grad(g, k, '#c3cbd2', METAL.dark, 0.2 * z, -0.07, 0.4 * z, 0.02), o * 0.9);
  g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = o * 0.5;
  g.beginPath(); g.moveTo(0.21 * Z, -s * 0.06 * Z); g.lineTo(0.37 * Z, -s * 0.04 * Z); g.stroke();
  // housing
  const h = new Path2D();
  poly(h, mirrorPoly([0.27, 0, 0.265, -0.06, 0.22, -0.1, 0.05, -0.1, 0.0, -0.065, -0.01, 0]), Z);
  raised(g, h, grad(g, k, shade(pal.light, 0.12), pal.dark, 0.05 * z, -0.1 * z, 0.25 * z, 0.1 * z), o, k, 1.2, 0.012, 0.5);
  seam(g, [0.1, -0.1, 0.1, 0.1, 0.2, -0.1, 0.2, 0.1], Z, o * 0.5);
  hazard(g, 0.215 * Z, -0.04 * Z, 0.035 * Z, 0.08 * Z, o, true);
  piston(g, 0.03 * Z, s * 0.055 * Z, 0.19 * Z, s * 0.055 * Z, 0.016 * Z, o * 0.7);
  stripe(g, [0.04, -s * 0.07, 0.18, -s * 0.07], Z, pal.accent, o);
  rivetRow(g, 0.05 * Z, -s * 0.03 * Z, 0.17 * Z, -s * 0.03 * Z, 3, 0.008 * k);
}

/** Movable jaw, pivot at its root: angular steel blade with a serrated edge. */
export function drawFinger(g: Ctx, s: number, k: number, z: number, pal: TeamPal, o: number): void {
  const Z = k * z;
  const f = new Path2D();
  poly(f, [-0.01, -s * 0.03, 0.1, -s * 0.035, 0.175, -s * 0.075, 0.155, -s * 0.015, 0.1, s * 0.035, -0.01, s * 0.035], Z);
  fillOut(g, f, grad(g, k, '#c3cbd2', METAL.dark, 0, -0.03, 0.15 * z, 0.03), o * 0.9);
  for (const x of [0.04, 0.08, 0.12]) spike(g, x * Z, -s * 0.03 * Z, -s * Math.PI / 2, 0.018 * Z, 0.01 * Z, '#d6dde3', o * 0.4);
  joint(g, 0, 0, 0.026 * Z, o * 0.8, METAL.base);
  void pal;
}

const wob = (a: AnimIn, f: number, ph: number) => Math.sin(a.t * f + a.seed * 1.7 + ph);

export function buildParts(L: UnitLayout): PartDef[] {
  const S = L.S;
  const parts: PartDef[] = [];
  switch (L.shape) {
    case 'mantis':
      for (const s of [-1, 1]) {
        parts.push({
          px: 0.15 * S, py: s * 0.05 * S, ext: 0.36 * S, layer: 'over', mounts: [s < 0 ? 0 : 1],
          draw: (g, pal, o) => {
            const k = S;
            // weapon arm: armoured boom forward-out, folded cutter blade, hydraulic ram across the elbow
            const blade = new Path2D();
            poly(blade, [0.215, s * 0.135, 0.2, s * 0.17, 0.03, s * 0.235, 0.075, s * 0.2, 0.17, s * 0.15], k);
            fillOut(g, blade, grad(g, k, '#d3dae0', METAL.dark, 0.05, s * 0.24, 0.2, s * 0.14), o * 0.8);
            g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = o * 0.5;
            g.beginPath(); g.moveTo(0.2 * k, s * 0.168 * k); g.lineTo(0.035 * k, s * 0.232 * k); g.stroke();
            beam(g, 0.19 * k, s * 0.13 * k, 0.026 * k, 0.09 * k, s * 0.19 * k, 0.018 * k, shade(pal.light, -0.05), pal.deep, o);
            beam(g, 0, 0, 0.033 * k, 0.19 * k, s * 0.13 * k, 0.036 * k, shade(pal.light, 0.1), pal.dark, o);
            piston(g, 0.04 * k, s * 0.0 * k, 0.15 * k, s * 0.075 * k, 0.012 * k, o * 0.6);
            joint(g, 0.19 * k, s * 0.13 * k, 0.03 * k, o, METAL.dark);
            joint(g, 0, 0, 0.026 * k, o, METAL.base);
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
            beam(g, 0, 0, r * 0.8 * k, 0.06 * k, s * 0.03 * k, r * 0.8 * k, METAL.light, METAL.dark, o);
            joint(g, 0, 0, r * 0.7 * k, o, METAL.base);
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
            // manipulator: armoured stub + angular steel gripper jaw
            const f = new Path2D();
            poly(f, [0.035, -s * 0.02, 0.085, -s * 0.02, 0.112, -s * 0.05, 0.104, s * 0.004, 0.075, s * 0.026, 0.035, s * 0.026], k);
            fillOut(g, f, grad(g, k, '#c9d1d8', METAL.dark, 0.04, -0.03, 0.1, 0.03), o * 0.8);
            beam(g, 0, 0, 0.03 * k, 0.05 * k, s * 0.004 * k, 0.026 * k, shade(pal.dark, 0.15), pal.deep, o);
            joint(g, 0.048 * k, s * 0.004 * k, 0.017 * k, o * 0.7, METAL.base);
            void big;
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
            beam(g, 0, 0, 0.042 * k, 0.1 * k, s * 0.11 * k, 0.04 * k, METAL.light, METAL.dark, o);
            piston(g, 0.015 * k, -s * 0.03 * k, 0.09 * k, s * 0.06 * k, 0.012 * k, o * 0.6);
            g.save(); g.translate(0.09 * k, s * 0.11 * k);
            drawPalm(g, s, k, 1, pal, o);
            g.restore();
            joint(g, 0.1 * k, s * 0.11 * k, 0.03 * k, o, METAL.dark);
            joint(g, 0, 0, 0.032 * k, o, METAL.base);
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
            beam(g, 0, 0, 0.036 * k, 0.08 * k, s * 0.11 * k, 0.036 * k, shade(pal.light, -0.05), pal.dark, o);
            beam(g, 0.08 * k, s * 0.11 * k, 0.034 * k, 0.14 * k, s * 0.16 * k, 0.036 * k, shade(pal.light, -0.05), pal.dark, o);
            piston(g, 0.01 * k, -s * 0.02 * k, 0.075 * k, s * 0.07 * k, 0.011 * k, o * 0.6);
            joint(g, 0.08 * k, s * 0.11 * k, 0.03 * k, o, METAL.dark);
            joint(g, 0, 0, 0.03 * k, o, METAL.base);
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
            const len = Math.hypot(nx, ny);
            if (last) {
              // weapon pod: armoured housing with a stepped injector lance pointing forward over the back
              const ln = new Path2D();
              poly(ln, [0.04, -0.022, 0.13, -0.01, 0.17, 0, 0.13, 0.01, 0.04, 0.022], k);
              g.save(); g.rotate(0.15);
              fillOut(g, ln, grad(g, k, '#d3dae0', METAL.dark, 0.05, -0.02, 0.12, 0.02), o * 0.8);
              seam(g, [0.08, -0.016, 0.08, 0.016, 0.11, -0.012, 0.11, 0.012], k, o * 0.5);
              g.restore();
              joint(g, 0, 0, r * 0.62 * k, o, METAL.base);
              const b = new Path2D();
              for (let q = 0; q < 6; q++) { const aa = (q / 6) * P2 + P2 / 12; b.lineTo(Math.cos(aa) * r * 1.05 * k, Math.sin(aa) * r * 0.9 * k); }
              b.closePath();
              raised(g, b, grad(g, k, shade(pal.light, 0.12), pal.dark, -r, -r, r, r), o, k, 1.2, 0.012, 0.6);
              glowLine(g, [-0.045, 0.055, 0.045, 0.055], k, E, o * 0.8);
              return;
            }
            // armoured tail module on a ball joint
            g.save();
            g.rotate(Math.atan2(ny, nx));
            const seg = new Path2D();
            poly(seg, mirrorPoly([len * 0.92, 0, len * 0.88, -r * 0.62, len * 0.74, -r * 0.92, len * 0.22, -r * 0.92, len * 0.1, -r * 0.6, len * 0.1, 0]), k);
            ao(g, seg, k);
            joint(g, len * 0.02 * k, 0, r * 0.58 * k, o, METAL.base);
            const sg = g.createLinearGradient(0, -r * k, 0, r * k);
            sg.addColorStop(0, shade(pal.light, 0.02 + i * 0.03)); sg.addColorStop(1, shade(pal.dark, -0.05));
            bevel(g, seg, sg, o, 0.8);
            seam(g, [len * 0.5, -r * 0.9, len * 0.5, r * 0.9], k, o * 0.5);
            stripe(g, [len * 0.25, -r * 0.55, len * 0.8, -r * 0.55], k, rgba(pal.accent, 0.9), o * 0.9);
            rivetRow(g, len * 0.3 * k, r * 0.5 * k, len * 0.7 * k, r * 0.5 * k, 2, 0.008 * k);
            g.restore();
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
        const ry = tail ? 0.1 : 0.15 - i * 0.004, rx = (tail ? 0.07 : 0.062) * Math.max(1, (L.X / S) * 0.95);
        const mount = i >= 1 && i <= 4 ? [i - 1] : undefined;
        parts.push({
          px: X[j] * S, py: 0, ext: 0.28 * S, layer: 'under', mounts: mount,
          draw: (g, pal, o) => {
            const k = S, E = emis(pal);
            // ball-joint coupling to the module behind + hydraulic links
            if (j > 0) {
              cables(g, [-0.075, -ry * 0.55, -rx * 0.8, -ry * 0.55, -0.075, ry * 0.55, -rx * 0.8, ry * 0.55], k, 0.012 * k, 1);
              joint(g, -0.072 * k, 0, 0.034 * k, o, METAL.base);
            }
            if (tail) for (const s of [-1, 1]) stack(g, -rx * 0.95 * k, s * 0.045 * k, 0.022 * k, o * 0.6);
            // armoured side skirts
            for (const s of [-1, 1]) {
              const sk = new Path2D();
              poly(sk, [rx * 0.7, s * ry * 0.75, rx * 0.55, s * (ry + 0.03), -rx * 0.55, s * (ry + 0.03), -rx * 0.75, s * ry * 0.75], k);
              fillOut(g, sk, shade(pal.dark, -0.12), o * 0.8);
            }
            const sh = sharp([rx, 0, rx, -ry * 0.6, rx * 0.6, -ry, -rx * 0.65, -ry, -rx, -ry * 0.6, -rx, 0], k);
            const sg = g.createLinearGradient(0, -ry * k, 0, ry * k);
            sg.addColorStop(0, shade(pal.light, 0.08)); sg.addColorStop(0.55, pal.body); sg.addColorStop(1, pal.dark);
            ao(g, sh, k, 0.02, 0.6);
            bevel(g, sh, sg, o, 0.8);
            stripe(g, [rx * 0.3, -ry * 0.82, rx * 0.3, -ry * 0.5, rx * 0.3, ry * 0.82, rx * 0.3, ry * 0.5], k, pal.accent, o * 0.9);
            for (const s of [-1, 1]) rivetRow(g, -rx * 0.6 * k, s * ry * 0.78 * k, rx * 0.0, s * ry * 0.78 * k, 2, 0.008 * k);
            if (tail) hazard(g, -rx * 0.75 * k, -0.02 * k, 0.025 * k, 0.04 * k, o, true);
            else if (!mount) { vent(g, -0.01, 0, 0.05, 0.08, k, o); dot(g, 0.03 * k, 0, 0.012 * k, rgba(E, 0.9)); }
          },
          anim: (a) => {
            const amp = (L.mob.id === 'spider' ? 0.04 : 0.022) * S * Math.min(1, (i + 1) / 3);
            const w = a.moving ? (a.odo / (0.9 * S)) * P2 : a.t * 0.8;
            const ph = w - i * 0.9 + a.seed;
            return { dy: amp * Math.sin(ph), r: -amp / S * 6 * Math.cos(ph) * 0.9 };
          },
        });
      }
      // hydraulic shears on the head
      for (const s of [-1, 1]) {
        parts.push({
          px: 0.46 * S, py: s * 0.05 * S, ext: 0.14 * S, layer: 'under',
          draw: (g, _pal, o) => {
            const k = S;
            const f = new Path2D();
            poly(f, [-0.01, -s * 0.018, 0.05, -s * 0.012, 0.078, -s * 0.055, 0.072, s * 0.01, 0.045, s * 0.03, -0.01, s * 0.03], k);
            fillOut(g, f, grad(g, k, '#c9d1d8', METAL.dark, 0, -0.03, 0.07, 0.03), o * 0.9);
            joint(g, 0, 0, 0.018 * k, o * 0.7, METAL.base);
          },
          anim: (a) => ({ r: s * 0.25 * Math.max(0, wob(a, 2.6, s * 0.3)) }),
        });
      }
      break;
    }
  }
  return parts;
}

export function ao(g: Ctx, path: Path2D, S: number, r = 0.015, a = 0.5): void {
  const k = devK(g);
  g.save();
  g.filter = `blur(${Math.max(1, r * S * k)}px)`;
  g.translate(0.006 * S, 0.012 * S);
  g.fillStyle = `rgba(0,0,0,${a})`;
  g.fill(path);
  g.restore();
}

/* -------------------------------------------------------------------------------------------- spider legs */

export interface LegRig {
  /** hips and rest feet, fractions of S (footprint rigs: hx/fx fractions of X, hy/fy of Y; stride of X) */
  legs: { hx: number; hy: number; fx: number; fy: number; grp: number }[];
  w: number;
  stride: number;
  big: boolean;
  armour: boolean;
  /** limb design language: industrial beams + rams, sleek alien digitigrade limbs, stubby piston stilts */
  style: 'ind' | 'sleek' | 'stub';
  /** footprint rig: coordinates are fractions of X (along) / Y (across) */
  foot?: boolean;
}

const rigCache = new Map<string, LegRig>();

function legRig(L: UnitLayout): LegRig {
  const key = `${L.shape}|${L.S}|${L.X}|${L.Y}`;
  let r = rigCache.get(key);
  if (r) return r;
  const hr = creatureHooks.rig?.(L);
  if (hr) { rigCache.set(key, hr); return hr; }
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
  let style: LegRig['style'] = 'ind';
  switch (L.shape) {
    // sleek alien quad walker: two long digitigrade pairs splayed fore and aft
    case 'arachnid': row([0.22, 0.0], 0.1, 0.56, [0.3, -0.42]); w = 0.07; stride = 0.13; armour = true; style = 'sleek'; break;
    // brutalist walking fortress: six heavy industrial legs
    case 'broodmother': radial(0.2, 0.12, 0.13, 0.74, [0.65, 1.55, 2.4]); w = 0.07; stride = 0.1; armour = true; break;
    // colossal alien walker: six sweeping alien limbs
    case 'arachne': radial(0.2, 0.12, 0.13, 0.82, [0.6, 1.5, 2.35]); w = 0.07; stride = 0.1; armour = true; style = 'sleek'; break;
    // weapon-boom platform: three industrial legs a side
    case 'scorpion': row([0.12, -0.03, -0.18], 0.17, 0.46, [0.12, 0.0, -0.16]); w = 0.062; stride = 0.08; armour = true; break;
    // mobile bunker on stubby piston stilts
    case 'crab': row([0.13, -0.04, -0.2], 0.3, 0.5, [0.06, -0.03, -0.12]); w = 0.075; stride = 0.06; armour = true; style = 'stub'; break;
    // lanky alien strider
    case 'mantis': row([0.06, -0.06], 0.05, 0.44, [0.24, -0.32]); w = 0.055; stride = 0.14; style = 'sleek'; break;
    // land-train: short paired piston walking beams under each car
    case 'centipede': row([0.36, 0.22, 0.085, -0.055, -0.195, -0.335], 0.1, 0.27, [0.03, 0.015, 0, -0.015, -0.03, -0.05]); w = 0.05; stride = 0.05; style = 'stub'; break;
    default: {
      const hr = Math.min(0.22, L.hw * 0.6);
      if (S >= 4) { radial(0, hr, hr, Math.max(0.64, L.hw + 0.28), [0.5, 1.15, 1.95, 2.6]); w = 0.05; stride = 0.09; }
      else { radial(0, hr, hr, Math.max(0.52, L.hw + 0.24), S >= 3 ? [0.6, 1.57, 2.5] : [0.55, 1.57, 2.55]); w = S >= 3 ? 0.055 : 0.065; }
      armour = S >= 3;
    }
  }
  r = { legs, w, stride, big: S >= 4, armour, style };
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
  const KX = rig.foot ? L.X : S, KY = rig.foot ? L.Y : S;
  const order = rig.legs.map((l, i) => ({ l, i, lift: 0 }));
  const geo = order.map(({ l, i }) => {
    const ph = phase * P2 + (cent ? i * 0.7 : l.grp * Math.PI);
    const lift = rest ? 0 : Math.max(0, Math.cos(ph));
    const fx = (l.fx + (rest ? 0 : Math.sin(ph) * rig.stride)) * KX, fy = l.fy * KY * (1 - lift * 0.06);
    const hx = l.hx * KX, hy = l.hy * KY;
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
  if (rig.style !== 'ind') {
    for (const i of idx) {
      const q = geo[i];
      if (rig.style === 'sleek') sleekLeg(g, q, W, pal, E, o, rig.big);
      else stubLeg(g, q, W, pal, E, o, cent);
    }
    return;
  }
  for (const i of idx) {
    const { hx, hy, fx, fy, kx, ky, lift } = geo[i];
    const up = 1 + lift * 0.25;
    const fem0 = rig.armour ? shade(pal.body, -0.1 + lift * 0.15) : shade(METAL.light, lift * 0.1);
    const fem1 = rig.armour ? shade(pal.deep, 0.05) : METAL.dark;
    const b = Math.atan2(fy - ky, fx - kx);
    const side = hy < 0 ? -1 : 1;
    let ax = kx, ay = ky;
    if (rig.big) {
      // three segments: femur up to the knee, armoured shin down to the ankle actuator, steel strut to the foot
      ax = kx + (fx - kx) * 0.6; ay = ky + (fy - ky) * 0.6;
      beam(g, ax, ay, W * 0.3, fx, fy, W * 0.2, METAL.light, METAL.deep, o);
      beam(g, kx, ky, W * 0.6 * up, ax, ay, W * 0.4, shade(pal.dark, 0.1), pal.deep, o);
      piston(g, kx + Math.cos(b + side * 1.2) * W * 0.3, ky + Math.sin(b + side * 1.2) * W * 0.3, ax + (fx - ax) * 0.35, ay + (fy - ay) * 0.35, W * 0.12, o * 0.6);
      joint(g, ax, ay, W * 0.34, o * 0.8, METAL.dark);
    } else {
      beam(g, kx, ky, W * 0.5 * up, fx, fy, W * 0.26, METAL.light, METAL.dark, o);
    }
    // armoured foot pad
    const pr = W * (rig.big ? 0.42 : 0.36);
    const pad = new Path2D();
    for (let q = 0; q < 6; q++) { const aa = b + (q / 6) * P2 + P2 / 12; pad.lineTo(fx + Math.cos(b) * pr * 0.25 + Math.cos(aa) * pr, fy + Math.sin(b) * pr * 0.25 + Math.sin(aa) * pr * 0.85); }
    pad.closePath();
    g.fillStyle = METAL.dark; g.fill(pad);
    g.lineWidth = o * 0.7; g.strokeStyle = OUTLINE; g.stroke(pad);
    dot(g, fx - pr * 0.15, fy - pr * 0.15, pr * 0.35, 'rgba(255,255,255,0.18)');
    // femur beam + hydraulic ram along its top
    beam(g, hx, hy, W * 0.72, kx, ky, W * 0.62 * up, fem0, fem1, o);
    const fa = Math.atan2(ky - hy, kx - hx), fl = Math.hypot(kx - hx, ky - hy);
    const pnx = -Math.sin(fa) * -side, pny = Math.cos(fa) * -side;
    if (W > 0.05) piston(g, hx + Math.cos(fa) * fl * 0.12 + pnx * W * 0.5, hy + Math.sin(fa) * fl * 0.12 + pny * W * 0.5, hx + Math.cos(fa) * fl * 0.8 + pnx * W * 0.45, hy + Math.sin(fa) * fl * 0.8 + pny * W * 0.45, W * (rig.big ? 0.16 : 0.18), o * 0.6);
    if (rig.big) {
      // femur armour plates + emissive conduit
      for (const f of [0.3, 0.55]) {
        const x = hx + (kx - hx) * f, y = hy + (ky - hy) * f;
        g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = o * 0.7; g.lineCap = 'butt';
        g.beginPath(); g.moveTo(x - Math.sin(fa) * W * 0.7, y + Math.cos(fa) * W * 0.7); g.lineTo(x + Math.sin(fa) * W * 0.7, y - Math.cos(fa) * W * 0.7); g.stroke();
      }
      g.strokeStyle = rgba(E, 0.85); g.lineWidth = o * 1.1; g.lineCap = 'round';
      g.beginPath(); g.moveTo(hx + (kx - hx) * 0.2 - pnx * W * 0.3, hy + (ky - hy) * 0.2 - pny * W * 0.3); g.lineTo(hx + (kx - hx) * 0.8 - pnx * W * 0.3, hy + (ky - hy) * 0.8 - pny * W * 0.3); g.stroke();
    }
    // knee actuator: higher = bigger + brighter
    joint(g, kx, ky, W * 0.6 * up, o, rig.armour ? shade(pal.dark, 0.1 + lift * 0.2) : shade(METAL.base, lift * 0.2), rig.big || rig.armour ? rgba(E, 0.95) : undefined);
    if (cent) continue;
    joint(g, hx, hy, W * 0.55, o, METAL.dark);
  }
}

interface LegGeo { hx: number; hy: number; fx: number; fy: number; kx: number; ky: number; lift: number; }

/** Smooth tapered alien limb segment (lens-shaped, bowed outward) with a glowing seam. */
function sleekSeg(g: Ctx, x0: number, y0: number, w0: number, x1: number, y1: number, w1: number, bow: number, c0: string, c1: string, E: string, o: number): void {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l, ny = dx / l;
  const mx = (x0 + x1) / 2 + nx * bow, my = (y0 + y1) / 2 + ny * bow;
  const wm = (w0 + w1) * 0.62;
  const p = new Path2D();
  p.moveTo(x0 + nx * w0, y0 + ny * w0);
  p.quadraticCurveTo(mx + nx * wm * 1.4, my + ny * wm * 1.4, x1 + nx * w1, y1 + ny * w1);
  p.lineTo(x1 - nx * w1, y1 - ny * w1);
  p.quadraticCurveTo(mx - nx * wm * 0.6, my - ny * wm * 0.6, x0 - nx * w0, y0 - ny * w0);
  p.closePath();
  const gr = g.createLinearGradient(mx + nx * wm, my + ny * wm, mx - nx * wm, my - ny * wm);
  gr.addColorStop(0, c0); gr.addColorStop(1, c1);
  g.fillStyle = gr; g.fill(p);
  g.lineJoin = 'round'; g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke(p);
  // glowing seam following the bow
  g.lineCap = 'round';
  g.strokeStyle = rgba(E, 0.85); g.lineWidth = Math.max(o * 0.6, Math.min(w0, w1) * 0.28);
  g.beginPath();
  g.moveTo(x0 + dx * 0.12 + nx * w0 * 0.2, y0 + dy * 0.12 + ny * w0 * 0.2);
  g.quadraticCurveTo(mx + nx * wm * 0.45, my + ny * wm * 0.45, x1 - dx * 0.12 + nx * w1 * 0.2, y1 - dy * 0.12 + ny * w1 * 0.2);
  g.stroke();
}

/** Alien digitigrade leg: arched thigh, floating knee node, needle shin, hovering foot node. */
function sleekLeg(g: Ctx, q: LegGeo, W: number, pal: TeamPal, E: string, o: number, big: boolean): void {
  const { hx, hy, fx, fy, kx, ky, lift } = q;
  const side = hy < 0 ? -1 : 1;
  const up = 1 + lift * 0.25;
  const shell0 = shade(METAL.light, 0.05 + lift * 0.1), shell1 = METAL.deep;
  // shin: knee -> foot, tapering to a point, bowed backward (reverse joint)
  sleekSeg(g, kx, ky, W * 0.42 * up, fx, fy, W * 0.1, -side * W * 0.5, shell0, shell1, E, o);
  // thigh: hip -> knee, thick, bowed outward
  sleekSeg(g, hx, hy, W * 0.7, kx, ky, W * 0.5 * up, side * W * 0.9, shade(pal.dark, 0.05 + lift * 0.1), METAL.deep, E, o);
  // floating knee node: dark orb in an emissive ring
  dot(g, kx, ky, W * 0.5 * up, OUTLINE);
  dot(g, kx, ky, W * 0.42 * up, '#0b1016');
  g.strokeStyle = rgba(E, 0.9); g.lineWidth = Math.max(o * 0.7, W * 0.12);
  g.beginPath(); g.arc(kx, ky, W * 0.3 * up, 0, P2); g.stroke();
  dot(g, kx - W * 0.1, ky - W * 0.1, W * 0.1, 'rgba(255,255,255,0.7)');
  // foot node
  dot(g, fx, fy, W * (big ? 0.24 : 0.2), OUTLINE);
  dot(g, fx, fy, W * (big ? 0.15 : 0.12), rgba(E, 0.95));
  // hip socket
  dot(g, hx, hy, W * 0.55, OUTLINE);
  dot(g, hx, hy, W * 0.46, METAL.dark);
  dot(g, hx, hy, W * 0.2, rgba(E, 0.8));
}

/** Stubby piston stilt: short A-frame strut, telescoping ram straight down to a big bolted foot pad. */
function stubLeg(g: Ctx, q: LegGeo, W: number, pal: TeamPal, E: string, o: number, small: boolean): void {
  const { hx, hy, fx, fy, kx, ky, lift } = q;
  const pr = W * (small ? 0.5 : 0.62) * (1 - lift * 0.15);
  // foot pad
  const pad = new Path2D();
  for (let k = 0; k < 8; k++) { const a = (k / 8) * P2 + P2 / 16; pad.lineTo(fx + Math.cos(a) * pr, fy + Math.sin(a) * pr); }
  pad.closePath();
  g.fillStyle = METAL.dark; g.fill(pad); g.lineWidth = o * 0.8; g.strokeStyle = OUTLINE; g.stroke(pad);
  g.strokeStyle = 'rgba(232,184,28,0.75)'; g.lineWidth = Math.max(o * 0.5, pr * 0.14);
  g.beginPath(); g.arc(fx, fy, pr * 0.66, 0, P2); g.stroke();
  // upper strut (team armour) and the ram
  beam(g, hx, hy, W * 0.5, kx, ky, W * 0.42, shade(pal.dark, 0.08 + lift * 0.1), pal.deep, o);
  piston(g, kx, ky, fx, fy, W * 0.26, o * 0.8);
  joint(g, kx, ky, W * 0.38, o * 0.8, METAL.base, small ? undefined : rgba(E, 0.9));
  dot(g, fx, fy, pr * 0.3, METAL.light);
  if (!small) joint(g, hx, hy, W * 0.45, o * 0.8, METAL.dark);
}

/* ------------------------------------------------------------------------------------------------ dynamic fx */

export interface CLight { x: number; y: number; r: number; k: 'eye' | 'egg' | 'core'; ph: number; }
const lightCache = new Map<string, CLight[]>();

function lightsOf(L: UnitLayout): CLight[] {
  const key = `${L.shape}|${L.S}|${L.X}|${L.Y}`;
  let o = lightCache.get(key);
  if (o) return o;
  const hl = creatureHooks.lights?.(L);
  if (hl) { lightCache.set(key, hl); return hl; }
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
      for (const [x, y, r] of CELLS) o.push({ x: x * S, y: y * S, r: r * S, k: 'egg', ph: x * 13 + y * 7 });
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
