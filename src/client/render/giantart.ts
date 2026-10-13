// Giant (size 4) and Titan (size 5) war machines: hull details, running gear (megatracks, titan legs, grav
// lifters), a "top" layer drawn above the turrets (titan pauldrons) and the animated overlay (pulsing reactor,
// travelling emissive lines, radar sweeps, vents, engine glow, exhaust, footfall dust, lifter swirl).
// Local frame: nose +x, +y right, units = cells, S = chassis size.

import { METAL, OUTLINE, mirrorPoly, poly, rgba, roundRect, shade, softDot, TEAM_PAL, type Ctx, type TeamPal } from './palette.ts';
import type { UnitLayout } from './unitart.ts';

const P2 = Math.PI * 2;

export const GIANT_SHAPES = new Set(['goliath', 'leviathan', 'carrier', 'colossal', 'citadel']);

/** Emissive accent colour: cyan for the friendly team, blood red for the enemy. */
export function emis(pal: TeamPal): string {
  return pal.body === TEAM_PAL[1].body ? '#ff3a28' : '#46f0ff';
}

/* ---------------------------------------------------------------------------------------------- helpers */

const pm = (half: number[], S: number): Path2D => {
  const p = new Path2D();
  poly(p, mirrorPoly(half), S);
  return p;
};
const pp = (pts: number[], S: number): Path2D => {
  const p = new Path2D();
  poly(p, pts, S);
  return p;
};
const rr = (x: number, y: number, w: number, h: number, r: number, S: number): Path2D => {
  const p = new Path2D();
  roundRect(p, x * S, y * S, w * S, h * S, r * S);
  return p;
};
const oct = (x: number, y: number, r: number, S: number): Path2D => {
  const p = new Path2D();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * P2 + P2 / 16; p.lineTo((x + Math.cos(a) * r) * S, (y + Math.sin(a) * r) * S); }
  p.closePath();
  return p;
};
const circ = (x: number, y: number, r: number, S: number): Path2D => {
  const p = new Path2D();
  p.arc(x * S, y * S, r * S, 0, P2);
  return p;
};

/** Device pixels per cell of the current transform (for blur radii). */
const devK = (g: Ctx) => Math.hypot(g.getTransform().a, g.getTransform().b) || 1;

/** Soft ambient-occlusion shadow around/under a raised part. */
function ao(g: Ctx, path: Path2D, S: number, r = 0.022, a = 0.6): void {
  const k = devK(g);
  g.save();
  g.filter = `blur(${Math.max(1, r * S * k)}px)`;
  g.translate(0.006 * S, 0.012 * S);
  g.fillStyle = `rgba(0,0,0,${a})`;
  g.fill(path);
  g.lineJoin = 'round';
  g.lineWidth = r * S * 1.2;
  g.strokeStyle = `rgba(0,0,0,${a * 0.8})`;
  g.stroke(path);
  g.restore();
}

/** Filled panel with a lit top-left edge, a shadowed bottom-right edge and an outline. */
function bevel(g: Ctx, path: Path2D, fill: string | CanvasGradient, o: number, depth = 1): void {
  g.fillStyle = fill;
  g.fill(path);
  g.save();
  g.clip(path);
  g.lineJoin = 'round';
  g.lineWidth = o * 2.6 * depth;
  g.save();
  g.translate(o * 1.3 * depth, o * 1.3 * depth);
  g.strokeStyle = 'rgba(255,255,255,0.32)';
  g.stroke(path);
  g.restore();
  g.save();
  g.translate(-o * 1.3 * depth, -o * 1.3 * depth);
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.stroke(path);
  g.restore();
  g.restore();
  g.lineWidth = o * 0.85;
  g.strokeStyle = OUTLINE;
  g.stroke(path);
}

/** Raised armour: AO shadow then a bevelled panel. */
function raised(g: Ctx, path: Path2D, fill: string | CanvasGradient, o: number, S: number, depth = 1, aoR = 0.022, aoA = 0.6): void {
  ao(g, path, S, aoR, aoA);
  bevel(g, path, fill, o, depth);
}

function grad(g: Ctx, S: number, c0: string, c1: string, x0 = -0.3, y0 = -0.3, x1 = 0.3, y1 = 0.3): CanvasGradient {
  const gr = g.createLinearGradient(x0 * S, y0 * S, x1 * S, y1 * S);
  gr.addColorStop(0, c0);
  gr.addColorStop(1, c1);
  return gr;
}

function recess(g: Ctx, path: Path2D, o: number, fill = 'rgba(4,6,9,0.62)'): void {
  g.fillStyle = fill;
  g.fill(path);
  g.save();
  g.clip(path);
  g.lineWidth = o * 3.4;
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.stroke(path);
  g.restore();
  g.lineWidth = o * 0.5;
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.stroke(path);
}

function glowLine(g: Ctx, pts: number[], S: number, col: string, w: number, a = 1): void {
  g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i < pts.length; i += 4) { g.moveTo(pts[i] * S, pts[i + 1] * S); g.lineTo(pts[i + 2] * S, pts[i + 3] * S); }
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = w * 2.2;
  g.stroke();
  g.strokeStyle = rgba(col, 0.95 * a);
  g.lineWidth = w;
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = w * 0.35;
  g.stroke();
}

function seam(g: Ctx, pts: number[], S: number, w: number, col = 'rgba(0,0,0,0.45)'): void {
  g.lineCap = 'butt';
  g.strokeStyle = col;
  g.lineWidth = w;
  g.beginPath();
  for (let i = 0; i < pts.length; i += 4) { g.moveTo(pts[i] * S, pts[i + 1] * S); g.lineTo(pts[i + 2] * S, pts[i + 3] * S); }
  g.stroke();
}

function dot(g: Ctx, x: number, y: number, r: number, c: string | CanvasGradient): void {
  g.fillStyle = c;
  g.beginPath();
  g.arc(x, y, r, 0, P2);
  g.fill();
}

function rivetRow(g: Ctx, x0: number, y0: number, x1: number, y1: number, n: number, r: number): void {
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    const x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f;
    dot(g, x, y, r, 'rgba(0,0,0,0.55)');
    dot(g, x - r * 0.3, y - r * 0.3, r * 0.5, 'rgba(255,255,255,0.35)');
  }
}

function hazard(g: Ctx, x: number, y: number, w: number, h: number, o: number, vertical = false): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = '#e8b81c';
  g.fillRect(x, y, w, h);
  g.strokeStyle = '#17140c';
  const u = Math.min(w, h);
  g.lineWidth = u * 0.34;
  g.beginPath();
  const step = u * 0.7;
  if (vertical) for (let i = -2; i < h / step + 2; i++) { g.moveTo(x - u, y + i * step + u); g.lineTo(x + w + u, y + i * step - u); }
  else for (let i = -2; i < w / step + 2; i++) { g.moveTo(x + i * step - u, y + h + u); g.lineTo(x + i * step + u + h, y - u); }
  g.stroke();
  g.restore();
  g.lineWidth = o * 0.7;
  g.strokeStyle = OUTLINE;
  g.strokeRect(x, y, w, h);
}

function grille(g: Ctx, x: number, y: number, w: number, h: number, n: number, o: number, E: string, hot = 0.5): void {
  g.beginPath();
  roundRect(g, x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.15);
  g.fillStyle = '#05070a';
  g.fill();
  g.lineWidth = o * 0.7;
  g.strokeStyle = OUTLINE;
  g.stroke();
  const horiz = w > h;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    g.fillStyle = rgba(E, 0.18 + hot * 0.35);
    if (horiz) g.fillRect(x - w / 2 + w * f - w / n * 0.2, y - h * 0.38, w / n * 0.4, h * 0.76);
    else g.fillRect(x - w * 0.38, y - h / 2 + h * f - h / n * 0.2, w * 0.76, h / n * 0.4);
  }
  g.strokeStyle = 'rgba(255,255,255,0.2)';
  g.lineWidth = o * 0.4;
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    if (horiz) { g.moveTo(x - w / 2 + w * f, y - h / 2); g.lineTo(x - w / 2 + w * f, y + h / 2); }
    else { g.moveTo(x - w / 2, y - h / 2 + h * f); g.lineTo(x + w / 2, y - h / 2 + h * f); }
  }
  g.stroke();
}

function belt(g: Ctx, x0: number, x1: number, y: number, h: number, S: number, pal: TeamPal, o: number, E: string, segs: number): void {
  const p = rr(x0, y - h / 2, x1 - x0, h, h * 0.25, S);
  const gr = g.createLinearGradient(0, (y - h / 2) * S, 0, (y + h / 2) * S);
  gr.addColorStop(0, shade(pal.body, -0.05));
  gr.addColorStop(1, shade(pal.dark, -0.15));
  bevel(g, p, gr, o);
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = o * 0.5;
  g.beginPath();
  for (let i = 1; i < segs; i++) { const x = (x0 + ((x1 - x0) * i) / segs) * S; g.moveTo(x, (y - h / 2) * S); g.lineTo(x, (y + h / 2) * S); }
  g.stroke();
  rivetRow(g, (x0 + 0.015) * S, y * S, (x1 - 0.015) * S, y * S, segs * 2, h * S * 0.07);
  g.lineCap = 'round';
  g.strokeStyle = rgba(E, 0.85);
  g.lineWidth = o * 0.9;
  g.beginPath();
  const sgn = y < 0 ? 1 : -1;
  g.moveTo((x0 + 0.02) * S, (y + sgn * h * 0.42) * S);
  g.lineTo((x1 - 0.02) * S, (y + sgn * h * 0.42) * S);
  g.stroke();
}

/** Exhaust stack seen from above: heavy collar, sooty bore. */
function stack(g: Ctx, x: number, y: number, r: number, o: number): void {
  dot(g, x + r * 0.25, y + r * 0.35, r * 1.35, 'rgba(0,0,0,0.45)');
  dot(g, x, y, r * 1.15, METAL.dark);
  g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
  const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
  gr.addColorStop(0, METAL.light); gr.addColorStop(1, METAL.base);
  dot(g, x, y, r * 0.95, gr);
  dot(g, x, y, r * 0.66, '#07080a');
  dot(g, x, y, r * 0.3, 'rgba(255,120,40,0.55)');
}

function lamp(g: Ctx, x: number, y: number, r: number, c: string): void {
  dot(g, x, y, r * 1.7, 'rgba(0,0,0,0.5)');
  dot(g, x, y, r, c);
  dot(g, x - r * 0.25, y - r * 0.25, r * 0.4, 'rgba(255,255,255,0.8)');
}

/** Row of crenellation blocks (merlons) along a segment. */
function merlons(g: Ctx, x0: number, y0: number, x1: number, y1: number, n: number, w: number, h: number, fill: string, o: number): void {
  const a = Math.atan2(y1 - y0, x1 - x0);
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    g.save();
    g.translate(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
    g.rotate(a);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(-w / 2 + o, -h / 2 + o * 1.2, w, h);
    g.beginPath(); roundRect(g, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.18);
    g.fillStyle = fill; g.fill();
    g.lineWidth = o * 0.6; g.strokeStyle = OUTLINE; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.fillRect(-w / 2 + o * 0.5, -h / 2 + o * 0.5, w - o, h * 0.25);
    g.restore();
  }
}

/** Reactor core socket (the pulsing light is added by the overlay). */
function reactor(g: Ctx, x: number, y: number, r: number, o: number, E: string): void {
  dot(g, x, y, r * 1.25, METAL.dark);
  g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * P2;
    dot(g, x + Math.cos(a) * r * 1.08, y + Math.sin(a) * r * 1.08, r * 0.09, METAL.light);
  }
  dot(g, x, y, r * 0.9, '#030608');
  const gr = g.createRadialGradient(x, y, 0, x, y, r * 0.85);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, rgba(E, 1)); gr.addColorStop(1, rgba(E, 0.05));
  dot(g, x, y, r * 0.85, gr);
  g.strokeStyle = 'rgba(0,0,0,0.65)'; g.lineWidth = r * 0.12;
  g.beginPath();
  for (let i = 0; i < 3; i++) { const a = (i / 3) * P2 + 0.3; g.moveTo(x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3); g.lineTo(x + Math.cos(a) * r * 0.88, y + Math.sin(a) * r * 0.88); }
  g.stroke();
}

/* --------------------------------------------------------------------------------------------- hull path */

export function giantHullPath(shape: string, S: number): Path2D | null {
  switch (shape) {
    case 'goliath': return pm([0.48, -0.1, 0.42, -0.22, 0.3, -0.31, -0.36, -0.31, -0.46, -0.23, -0.48, -0.1], S);
    case 'leviathan': return pm([0.5, 0, 0.43, -0.11, 0.3, -0.23, 0.12, -0.28, -0.32, -0.28, -0.44, -0.24, -0.49, -0.13, -0.49, 0], S);
    case 'carrier': return pm([0.5, -0.05, 0.42, -0.14, 0.24, -0.19, 0.12, -0.41, -0.04, -0.47, -0.3, -0.47, -0.4, -0.41, -0.42, -0.25, -0.5, -0.2, -0.5, -0.05], S);
    case 'colossal': return pm([0.22, -0.09, 0.19, -0.19, 0.1, -0.27, -0.14, -0.28, -0.23, -0.2, -0.26, -0.09], S);
    case 'citadel': return pm([0.44, -0.3, 0.4, -0.42, 0.3, -0.44, -0.3, -0.44, -0.4, -0.42, -0.44, -0.3], S);
  }
  return null;
}

/* ------------------------------------------------------------------------------------------ hull details */

export function giantHullDetails(g: Ctx, L: UnitLayout, pal: TeamPal, o: number): void {
  const S = L.S;
  const E = emis(pal);
  const lite = shade(pal.body, 0.18);
  const hi = shade(pal.light, -0.06);
  const dk = shade(pal.dark, 0.06);
  switch (L.shape) {
    case 'goliath': {
      // rear engine deck
      raised(g, rr(-0.475, -0.25, 0.27, 0.5, 0.04, S), grad(g, S, shade(pal.dark, 0.2), pal.deep), o, S);
      for (const s of [-1, 1]) grille(g, -0.33 * S, s * 0.12 * S, 0.14 * S, 0.09 * S, 6, o, E, 0.7);
      grille(g, -0.33 * S, 0, 0.14 * S, 0.06 * S, 6, o, E, 0.4);
      for (const s of [-1, 1]) stack(g, -0.43 * S, s * 0.19 * S, 0.035 * S, o);
      // central armoured deck
      raised(g, pm([0.22, -0.18, 0.14, -0.25, -0.18, -0.25, -0.21, -0.18], S), grad(g, S, lite, pal.dark), o, S, 1.2);
      seam(g, [0.14, -0.25, 0.14, 0.25, -0.08, -0.25, -0.08, 0.25], S, o * 0.5);
      // glacis: heavy sloped front wedge
      const gl = pm([0.49, -0.09, 0.43, -0.21, 0.31, -0.3, 0.2, -0.27, 0.21, 0], S);
      raised(g, gl, grad(g, S, hi, pal.body, 0.2, -0.3, 0.5, 0.3), o, S, 1.5, 0.03);
      seam(g, [0.29, -0.27, 0.36, -0.08, 0.36, -0.08, 0.36, 0.08, 0.36, 0.08, 0.29, 0.27], S, o * 0.6);
      hazard(g, 0.415 * S, -0.075 * S, 0.06 * S, 0.15 * S, o, true);
      // eye slits
      for (const s of [-1, 1]) {
        g.fillStyle = '#04070a';
        g.beginPath(); poly(g, [0.33, s * 0.12, 0.4, s * 0.15, 0.39, s * 0.18, 0.31, s * 0.155], S); g.fill();
        glowLine(g, [0.325, s * 0.135, 0.39, s * 0.16], S, E, o * 1.1);
        lamp(g, 0.455 * S, s * 0.14 * S, 0.016 * S, '#fff3c4');
      }
      // sponsons (the heavy guns sit on these)
      for (const s of [-1, 1]) {
        const sp = pp([0.14, s * 0.25, 0.1, s * 0.43, -0.22, s * 0.43, -0.27, s * 0.37, -0.27, s * 0.25], S);
        raised(g, sp, grad(g, S, lite, shade(pal.dark, -0.05)), o, S, 1.4, 0.03);
        seam(g, [-0.27, s * 0.3, 0.12, s * 0.3], S, o * 0.5);
        hazard(g, 0.095 * S, (s < 0 ? -0.42 : 0.31) * S, 0.035 * S, 0.11 * S, o, true);
        rivetRow(g, -0.22 * S, s * 0.41 * S, 0.06 * S, s * 0.41 * S, 7, 0.008 * S);
        glowLine(g, [0.1, s * 0.4, -0.21, s * 0.4], S, E, o * 0.9);
      }
      glowLine(g, [0.21, -0.17, 0.3, -0.27, 0.21, 0.17, 0.3, 0.27], S, E, o);
      break;
    }
    case 'leviathan': {
      // armoured belts on the flanks
      for (const s of [-1, 1]) belt(g, -0.4, 0.28, s * 0.25, 0.05, S, pal, o, E, 8);
      // recessed steel deck with plank seams
      const deck = pm([0.4, -0.08, 0.28, -0.19, -0.33, -0.21, -0.43, -0.17, -0.45, 0], S);
      g.save();
      g.clip(deck);
      g.fillStyle = shade(pal.deep, 0.12);
      g.fill(deck);
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.lineWidth = o * 0.5;
      g.beginPath();
      for (let y = -0.2; y <= 0.2; y += 0.035) { g.moveTo(-0.5 * S, y * S); g.lineTo(0.45 * S, y * S); }
      g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      for (let x = -0.44; x <= 0.4; x += 0.07) for (let y = -0.2; y <= 0.2; y += 0.07) { g.moveTo(x * S, y * S); g.lineTo(x * S, (y + 0.035) * S); }
      g.stroke();
      g.lineWidth = o * 3.5;
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.stroke(deck);
      g.restore();
      g.lineWidth = o * 0.6; g.strokeStyle = OUTLINE; g.stroke(deck);
      // casemate secondaries along the flanks
      for (const s of [-1, 1]) for (const x of [-0.2, -0.08, 0.14]) {
        g.fillStyle = OUTLINE; g.fillRect((x - 0.012) * S, s > 0 ? 0.255 * S : -0.31 * S, 0.024 * S, 0.055 * S);
        g.fillStyle = METAL.light; g.fillRect((x - 0.007) * S, s > 0 ? 0.26 * S : -0.305 * S, 0.014 * S, 0.045 * S);
        raised(g, rr(x - 0.03, s > 0 ? 0.2 : -0.26, 0.06, 0.06, 0.012, S), lite, o, S, 1, 0.01);
      }
      // forecastle + bow
      raised(g, pm([0.5, 0, 0.43, -0.105, 0.36, -0.15, 0.38, 0], S), grad(g, S, hi, pal.body), o, S, 1.4);
      for (let i = 0; i < 3; i++) glowLine(g, [0.4 + i * 0.025, -0.07 + i * 0.02, 0.44 + i * 0.02, 0, 0.44 + i * 0.02, 0, 0.4 + i * 0.025, 0.07 - i * 0.02], S, E, o * 0.8, 0.8);
      for (const s of [-1, 1]) lamp(g, 0.44 * S, s * 0.09 * S, 0.014 * S, '#fff3c4');
      // stern engine block
      raised(g, rr(-0.5, -0.17, 0.1, 0.34, 0.03, S), grad(g, S, dk, pal.deep), o, S);
      for (const y of [-0.11, 0, 0.11]) { dot(g, -0.49 * S, y * S, 0.04 * S, METAL.dark); dot(g, -0.49 * S, y * S, 0.028 * S, '#08090b'); }
      // bridge superstructure (two tiers + windows)
      raised(g, rr(-0.135, -0.135, 0.26, 0.27, 0.04, S), grad(g, S, lite, pal.dark), o, S, 1.4, 0.035, 0.7);
      seam(g, [-0.135, 0, 0.125, 0], S, o * 0.5);
      raised(g, rr(-0.1, -0.085, 0.17, 0.17, 0.03, S), grad(g, S, hi, pal.body), o, S, 1.4, 0.03, 0.7);
      g.fillStyle = '#04070a';
      g.fillRect(0.045 * S, -0.07 * S, 0.02 * S, 0.14 * S);
      glowLine(g, [0.055, -0.06, 0.055, 0.06], S, E, o * 1.1);
      for (const s of [-1, 1]) stack(g, -0.1 * S, s * 0.1 * S, 0.026 * S, o);
      hazard(g, -0.13 * S, -0.012 * S, 0.06 * S, 0.024 * S, o);
      glowLine(g, [0.28, -0.2, 0.36, -0.14, 0.28, 0.2, 0.36, 0.14, -0.36, -0.2, -0.43, -0.16, -0.36, 0.2, -0.43, 0.16], S, E, o);
      break;
    }
    case 'carrier': {
      // outer wing decks
      for (const s of [-1, 1]) {
        const w = pp([0.2, s * 0.15, 0.1, s * 0.4, -0.04, s * 0.45, -0.29, s * 0.45, -0.38, s * 0.4, -0.4, s * 0.15], S);
        raised(g, w, grad(g, S, lite, pal.dark), o, S, 1.2, 0.02);
        seam(g, [-0.2, s * 0.15, -0.2, s * 0.45, 0.0, s * 0.15, 0.0, s * 0.44], S, o * 0.5);
        hazard(g, -0.28 * S, (s < 0 ? -0.455 : 0.405) * S, 0.22 * S, 0.05 * S, o);
        glowLine(g, [0.09, s * 0.41, -0.03, s * 0.445, -0.03, s * 0.445, -0.28, s * 0.445], S, E, o);
      }
      // runway
      const deck = rr(-0.48, -0.13, 0.95, 0.26, 0.03, S);
      raised(g, deck, '#22272c', o, S, 0.6, 0.02);
      g.save();
      g.clip(deck);
      g.strokeStyle = 'rgba(230,230,200,0.6)';
      g.lineWidth = o * 0.9;
      g.setLineDash([0.045 * S, 0.035 * S]);
      g.beginPath(); g.moveTo(-0.46 * S, 0); g.lineTo(0.44 * S, 0); g.stroke();
      g.setLineDash([]);
      g.strokeStyle = 'rgba(230,230,200,0.45)';
      g.beginPath(); g.moveTo(-0.47 * S, -0.11 * S); g.lineTo(0.46 * S, -0.11 * S); g.moveTo(-0.47 * S, 0.11 * S); g.lineTo(0.46 * S, 0.11 * S); g.stroke();
      g.fillStyle = 'rgba(230,230,200,0.55)';
      for (let i = 0; i < 4; i++) for (const s of [-1, 1]) g.fillRect(-0.44 * S, s * (0.025 + i * 0.022) * S - 0.008 * S, 0.06 * S, 0.012 * S);
      g.strokeStyle = rgba(E, 0.85);
      g.lineWidth = o * 0.9;
      g.beginPath();
      for (let i = 0; i < 4; i++) { const x = (-0.3 + i * 0.08) * S; g.moveTo(x, -0.08 * S); g.lineTo(x + 0.035 * S, -0.03 * S); g.lineTo(x, 0.0); g.moveTo(x, 0.08 * S); g.lineTo(x + 0.035 * S, 0.03 * S); g.lineTo(x, 0.0); }
      g.stroke();
      g.restore();
      // landing pad + elevator on the starboard wing
      g.strokeStyle = 'rgba(240,230,160,0.75)'; g.lineWidth = o * 0.9;
      g.beginPath(); g.arc(0.0, 0.3 * S, 0.06 * S, 0, P2); g.stroke();
      g.fillStyle = 'rgba(240,230,160,0.75)';
      g.fillRect(-0.02 * S, 0.27 * S, 0.012 * S, 0.06 * S); g.fillRect(0.012 * S, 0.27 * S, 0.012 * S, 0.06 * S); g.fillRect(-0.02 * S, 0.294 * S, 0.044 * S, 0.012 * S);
      recess(g, rr(-0.3, 0.22, 0.12, 0.14, 0.01, S), o, '#15191d');
      seam(g, [-0.24, 0.22, -0.24, 0.36], S, o * 0.6, 'rgba(255,255,255,0.15)');
      // island superstructure (port side), tall: deep AO
      const isl = pp([0.13, -0.2, 0.08, -0.4, -0.18, -0.42, -0.24, -0.36, -0.24, -0.2], S);
      raised(g, isl, grad(g, S, hi, pal.dark), o, S, 1.5, 0.045, 0.75);
      raised(g, pp([0.1, -0.24, 0.06, -0.37, -0.02, -0.38, -0.02, -0.24], S), grad(g, S, shade(pal.light, 0.1), pal.body), o, S, 1.3, 0.02);
      g.fillStyle = '#04070a'; g.fillRect(0.075 * S, -0.36 * S, 0.018 * S, 0.11 * S);
      glowLine(g, [0.084, -0.35, 0.084, -0.26], S, E, o);
      for (const s of [-1, 1]) lamp(g, 0.44 * S, s * 0.09 * S, 0.013 * S, '#fff3c4');
      // engines
      for (const y of [-0.12, 0.12]) { raised(g, rr(-0.53, y - 0.05, 0.08, 0.1, 0.02, S), METAL.dark, o, S, 1, 0.01); dot(g, -0.52 * S, y * S, 0.03 * S, '#07080a'); }
      for (const s of [-1, 1]) { raised(g, rr(-0.45, s * 0.33 - 0.04, 0.07, 0.08, 0.02, S), METAL.dark, o, S, 1, 0.01); dot(g, -0.44 * S, s * 0.33 * S, 0.025 * S, '#07080a'); }
      break;
    }
    case 'colossal': {
      // waist + hip armour skirt
      raised(g, pm([0.04, -0.2, -0.04, -0.27, -0.2, -0.24, -0.25, -0.15], S), grad(g, S, dk, pal.deep), o, S, 1, 0.015);
      // reactor backpack
      const bp = rr(-0.45, -0.155, 0.27, 0.31, 0.05, S);
      raised(g, bp, grad(g, S, shade(pal.dark, 0.2), pal.deep), o, S, 1.2, 0.03, 0.7);
      seam(g, [-0.45, 0, -0.18, 0], S, o * 0.5);
      for (const s of [-1, 1]) stack(g, -0.4 * S, s * 0.095 * S, 0.042 * S, o);
      grille(g, -0.255 * S, 0, 0.05 * S, 0.17 * S, 5, o, E, 0.8);
      hazard(g, -0.44 * S, -0.03 * S, 0.035 * S, 0.06 * S, o, true);
      // arms: upper arm under the pauldron, armoured forearm forward (weapons are carried on the forearms)
      for (const s of [-1, 1]) {
        g.lineCap = 'round';
        g.strokeStyle = OUTLINE; g.lineWidth = 0.13 * S;
        g.beginPath(); g.moveTo(-0.06 * S, s * 0.33 * S); g.lineTo(0.08 * S, s * 0.37 * S); g.stroke();
        g.strokeStyle = METAL.base; g.lineWidth = 0.1 * S; g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 0.03 * S; g.stroke();
        const fa = rr(0.02, s * 0.37 - 0.075, 0.26, 0.15, 0.04, S);
        raised(g, fa, grad(g, S, lite, pal.dark), o, S, 1.3, 0.03, 0.7);
        seam(g, [0.1, s * 0.37 - 0.075, 0.1, s * 0.37 + 0.075, 0.2, s * 0.37 - 0.075, 0.2, s * 0.37 + 0.075], S, o * 0.5);
        hazard(g, 0.245 * S, (s * 0.37 - 0.06) * S, 0.03 * S, 0.12 * S, o, true);
        glowLine(g, [0.04, s * 0.37 + s * 0.06, 0.24, s * 0.37 + s * 0.06], S, E, o * 0.9);
      }
      // chest plate + reactor core
      raised(g, pm([0.215, -0.08, 0.18, -0.18, 0.06, -0.245, -0.11, -0.245, -0.16, -0.12, -0.16, 0], S), grad(g, S, hi, pal.dark), o, S, 1.5, 0.025);
      seam(g, [0.06, -0.245, 0.0, -0.1, 0.06, 0.245, 0.0, 0.1, -0.11, -0.245, -0.06, -0.1, -0.11, 0.245, -0.06, 0.1], S, o * 0.55);
      reactor(g, 0.03 * S, 0, 0.075 * S, o, E);
      glowLine(g, [0.12, -0.05, 0.19, -0.15, 0.12, 0.05, 0.19, 0.15, -0.06, -0.1, -0.12, -0.21, -0.06, 0.1, -0.12, 0.21], S, E, o);
      // head (sunk between the shoulders) with a visor slit
      const hd = pm([0.33, -0.04, 0.3, -0.085, 0.2, -0.095, 0.17, -0.06, 0.17, 0], S);
      raised(g, hd, grad(g, S, shade(pal.light, 0.08), pal.body), o, S, 1.4, 0.03, 0.75);
      g.fillStyle = '#04070a';
      g.beginPath(); poly(g, mirrorPoly([0.315, -0.02, 0.29, -0.07, 0.27, -0.07, 0.29, 0]), S); g.fill();
      glowLine(g, [0.3, -0.055, 0.31, 0, 0.31, 0, 0.3, 0.055], S, E, o * 1.1);
      seam(g, [0.2, -0.09, 0.2, 0.09], S, o * 0.5);
      break;
    }
    case 'citadel': {
      // courtyard
      const yard = rr(-0.34, -0.34, 0.68, 0.68, 0.03, S);
      recess(g, yard, o, shade(pal.deep, 0.1));
      g.save();
      g.clip(yard);
      g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = o * 0.5;
      g.beginPath();
      for (let v = -0.34; v <= 0.34; v += 0.068) { g.moveTo(v * S, -0.34 * S); g.lineTo(v * S, 0.34 * S); g.moveTo(-0.34 * S, v * S); g.lineTo(0.34 * S, v * S); }
      g.stroke();
      g.lineWidth = o * 4; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.stroke(yard);
      g.restore();
      // inner parapet glow
      glowLine(g, [-0.33, -0.345, 0.33, -0.345, -0.33, 0.345, 0.33, 0.345, -0.345, -0.25, -0.345, 0.25, 0.345, -0.25, 0.345, -0.12, 0.345, 0.12, 0.345, 0.25], S, E, o * 0.8, 0.85);
      // crenellated outer walls
      const mf = shade(pal.light, -0.12);
      merlons(g, 0.415 * S, -0.27 * S, 0.415 * S, -0.15 * S, 3, 0.035 * S, 0.05 * S, mf, o);
      merlons(g, 0.415 * S, 0.15 * S, 0.415 * S, 0.27 * S, 3, 0.035 * S, 0.05 * S, mf, o);
      merlons(g, -0.415 * S, -0.27 * S, -0.415 * S, 0.27 * S, 8, 0.035 * S, 0.05 * S, mf, o);
      for (const s of [-1, 1]) merlons(g, -0.27 * S, s * 0.415 * S, 0.27 * S, s * 0.415 * S, 8, 0.035 * S, 0.05 * S, mf, o);
      // reactor in the courtyard
      reactor(g, 0.08 * S, 0, 0.06 * S, o, E);
      // keep (two tiers with corner turrets)
      raised(g, rr(-0.37, -0.2, 0.38, 0.4, 0.04, S), grad(g, S, lite, pal.dark), o, S, 1.4, 0.045, 0.75);
      merlons(g, -0.35 * S, -0.185 * S, -0.01 * S, -0.185 * S, 6, 0.03 * S, 0.035 * S, mf, o);
      merlons(g, -0.35 * S, 0.185 * S, -0.01 * S, 0.185 * S, 6, 0.03 * S, 0.035 * S, mf, o);
      raised(g, rr(-0.31, -0.14, 0.27, 0.28, 0.03, S), grad(g, S, hi, pal.body), o, S, 1.4, 0.03, 0.7);
      for (const sx of [-0.35, -0.01]) for (const sy of [-0.18, 0.18]) {
        dot(g, (sx + 0.006) * S, (sy + 0.01) * S, 0.042 * S, 'rgba(0,0,0,0.5)');
        dot(g, sx * S, sy * S, 0.036 * S, grad(g, S, shade(pal.light, 0.1), pal.dark, sx - 0.03, sy - 0.03, sx + 0.03, sy + 0.03));
        g.lineWidth = o * 0.8; g.strokeStyle = OUTLINE; g.stroke();
        dot(g, sx * S, sy * S, 0.014 * S, rgba(E, 0.9));
      }
      for (const s of [-1, 1]) grille(g, -0.42 * S, s * 0.06 * S, 0.035 * S, 0.06 * S, 3, o, E, 0.8);
      // gatehouse
      raised(g, rr(0.38, -0.12, 0.1, 0.24, 0.02, S), grad(g, S, dk, pal.deep), o, S, 1.2, 0.02);
      hazard(g, 0.455 * S, -0.09 * S, 0.02 * S, 0.18 * S, o, true);
      glowLine(g, [0.415, -0.085, 0.415, 0.085], S, E, o * 1.3);
      for (const s of [-1, 1]) { raised(g, circ(0.42, s * 0.13, 0.035, S), shade(pal.light, -0.1), o, S, 1, 0.01); lamp(g, 0.44 * S, s * 0.13 * S, 0.012 * S, '#fff3c4'); }
      // bastions
      for (const sx of [1, -1]) for (const sy of [-1, 1]) {
        const bx = sx * 0.385, by = sy * 0.385;
        const bp = oct(bx, by, 0.125, S);
        raised(g, bp, grad(g, S, shade(pal.light, 0.05), pal.dark, bx - 0.12, by - 0.12, bx + 0.12, by + 0.12), o, S, 1.5, 0.035, 0.7);
        recess(g, oct(bx, by, 0.085, S), o, shade(pal.deep, 0.15));
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * P2 + P2 / 16 + P2 / 16;
          merlons(g, (bx + Math.cos(a) * 0.105) * S, (by + Math.sin(a) * 0.105) * S, (bx + Math.cos(a) * 0.105) * S, (by + Math.sin(a) * 0.105) * S, 1, 0.03 * S, 0.03 * S, mf, o);
        }
        g.strokeStyle = rgba(E, 0.9); g.lineWidth = o;
        g.beginPath(); g.arc(bx * S, by * S, 0.06 * S, 0, P2); g.stroke();
      }
      break;
    }
  }
}

/** Parts drawn ABOVE the turrets (titan pauldrons). Returns false when the shape has none. */
export function giantTopLayer(g: Ctx, L: UnitLayout, pal: TeamPal, o: number): boolean {
  if (L.shape !== 'colossal') return false;
  const S = L.S;
  const E = emis(pal);
  for (const s of [-1, 1]) {
    // pauldron: layered armour lames hanging outward from a heavy shoulder cap
    const outer = new Path2D();
    roundRect(outer, -0.27 * S, (s > 0 ? 0.24 : -0.52) * S, 0.35 * S, 0.28 * S, 0.1 * S);
    ao(g, outer, S, 0.045, 0.85);
    for (let k = 2; k >= 0; k--) {
      const x0 = -0.265 + 0.025 * k, x1 = 0.075 - 0.03 * k;
      const yc = s * (0.44 - 0.07 * k), h = 0.12 + 0.02 * k;
      const lp = new Path2D();
      roundRect(lp, x0 * S, (yc - h / 2) * S, (x1 - x0) * S, h * S, h * 0.45 * S);
      const c1 = shade(pal.dark, -0.1 + 0.08 * (2 - k));
      bevel(g, lp, grad(g, S, k === 0 ? shade(pal.light, 0.1) : shade(pal.light, -0.1 - 0.08 * k), k === 0 ? pal.body : c1, x0, yc - h / 2, x1, yc + h / 2), o, 1.3);
      if (k > 0) rivetRow(g, (x0 + 0.04) * S, (yc + s * h * 0.3) * S, (x1 - 0.04) * S, (yc + s * h * 0.3) * S, 5, 0.008 * S);
    }
    // cap crest + emissive edge on the outermost lame
    seam(g, [-0.2, s * 0.32, 0.03, s * 0.32], S, o * 1.2, 'rgba(0,0,0,0.55)');
    seam(g, [-0.2, s * 0.315, 0.03, s * 0.315], S, o * 0.6, 'rgba(255,255,255,0.35)');
    glowLine(g, [-0.24, s * 0.5, 0.05, s * 0.5], S, E, o * 1.2);
    hazard(g, -0.24 * S, (s > 0 ? 0.35 : -0.39) * S, 0.03 * S, 0.04 * S, o, true);
    g.fillStyle = rgba(pal.accent, 0.95);
    g.beginPath(); roundRect(g, -0.08 * S, (s > 0 ? 0.345 : -0.385) * S, 0.07 * S, 0.04 * S, 0.01 * S); g.fill();
    g.lineWidth = o * 0.5; g.strokeStyle = OUTLINE; g.stroke();
  }
  return true;
}

/** Barbette ring the turret sits on: heavy riveted collar with a team-glow trim and contact shadow. */
export function drawBarbette(g: Ctx, x: number, y: number, r: number, pal: TeamPal, o: number, empty: boolean): void {
  const E = emis(pal);
  const k = devK(g);
  g.save();
  g.filter = `blur(${Math.max(1, r * 0.25 * k)}px)`;
  dot(g, x + r * 0.06, y + r * 0.1, r * 1.12, 'rgba(0,0,0,0.6)');
  g.restore();
  dot(g, x, y, r, METAL.dark);
  g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
  const gr = g.createLinearGradient(x - r, y - r, x + r, y + r);
  gr.addColorStop(0, METAL.light); gr.addColorStop(0.5, METAL.base); gr.addColorStop(1, METAL.deep);
  g.strokeStyle = gr; g.lineWidth = r * 0.16;
  g.beginPath(); g.arc(x, y, r * 0.88, 0, P2); g.stroke();
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * P2;
    dot(g, x + Math.cos(a) * r * 0.88, y + Math.sin(a) * r * 0.88, r * 0.035, 'rgba(0,0,0,0.6)');
  }
  g.strokeStyle = rgba(E, 0.7); g.lineWidth = Math.max(o * 0.6, r * 0.04);
  g.beginPath(); g.arc(x, y, r * 0.74, 0, P2); g.stroke();
  dot(g, x, y, r * 0.68, empty ? '#0a0c0e' : 'rgba(0,0,0,0.5)');
  if (empty) {
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = o * 0.6;
    g.beginPath(); g.arc(x, y, r * 0.45, 0, P2); g.moveTo(x - r * 0.45, y); g.lineTo(x + r * 0.45, y); g.moveTo(x, y - r * 0.45); g.lineTo(x, y + r * 0.45); g.stroke();
  }
}

/* ----------------------------------------------------------------------------------------------- lights */

export interface GLight {
  x: number;
  y: number;
  r: number;
  k: 'core' | 'blink' | 'stack' | 'radar' | 'visor' | 'engine' | 'vent';
  ph?: number;
  col?: string;
  /** engine exhaust direction (local, radians) */
  dir?: number;
}

const lightCache = new Map<string, GLight[]>();

/** Positions (cells, local) of animated hull details per shape. */
export function giantLights(shape: string, S: number): GLight[] {
  const key = shape + S;
  const hit = lightCache.get(key);
  if (hit) return hit;
  const o: GLight[] = [];
  const nav = (x: number, y: number, s: number) => o.push({ x: x * S, y: y * S, r: 0.05 * S, k: 'blink', ph: s, col: s < 0 ? '#ff4040' : '#40ff70' });
  switch (shape) {
    case 'goliath':
      o.push({ x: 0.36 * S, y: 0, r: 0.0, k: 'radar' });
      for (const s of [-1, 1]) {
        nav(0.4, s * 0.25, s);
        o.push({ x: -0.43 * S, y: s * 0.19 * S, r: 0.035 * S, k: 'stack' });
        o.push({ x: -0.33 * S, y: s * 0.12 * S, r: 0.1 * S, k: 'vent' });
        o.push({ x: 0.36 * S, y: s * 0.15 * S, r: 0.07 * S, k: 'visor' });
      }
      break;
    case 'leviathan':
      o.push({ x: -0.015 * S, y: 0, r: 0.13 * S, k: 'radar' });
      o.push({ x: 0.055 * S, y: 0, r: 0.1 * S, k: 'visor' });
      for (const s of [-1, 1]) { o.push({ x: -0.1 * S, y: s * 0.1 * S, r: 0.026 * S, k: 'stack' }); nav(0.43, s * 0.09, s); }
      for (const y of [-0.11, 0, 0.11]) o.push({ x: -0.5 * S, y: y * S, r: 0.05 * S, k: 'engine', dir: Math.PI });
      break;
    case 'carrier':
      o.push({ x: 0.03 * S, y: -0.31 * S, r: 0.12 * S, k: 'radar' });
      o.push({ x: 0.084 * S, y: -0.305 * S, r: 0.07 * S, k: 'visor' });
      for (const s of [-1, 1]) { nav(-0.04, s * 0.45, s); o.push({ x: -0.44 * S, y: s * 0.33 * S, r: 0.04 * S, k: 'engine', dir: Math.PI }); o.push({ x: -0.52 * S, y: s * 0.12 * S, r: 0.05 * S, k: 'engine', dir: Math.PI }); }
      break;
    case 'colossal':
      o.push({ x: 0.03 * S, y: 0, r: 0.075 * S, k: 'core' });
      o.push({ x: 0.305 * S, y: 0, r: 0.1 * S, k: 'visor' });
      o.push({ x: -0.255 * S, y: 0, r: 0.1 * S, k: 'vent' });
      for (const s of [-1, 1]) { o.push({ x: -0.4 * S, y: s * 0.095 * S, r: 0.042 * S, k: 'stack' }); nav(-0.02, s * 0.5, s); }
      break;
    case 'citadel':
      o.push({ x: 0.08 * S, y: 0, r: 0.06 * S, k: 'core' });
      o.push({ x: 0.385 * S, y: 0.385 * S, r: 0.17 * S, k: 'radar' });
      for (const sx of [1, -1]) for (const sy of [-1, 1]) o.push({ x: sx * 0.385 * S, y: sy * 0.385 * S, r: 0.08 * S, k: 'vent', ph: sx + sy * 2 });
      o.push({ x: 0.415 * S, y: 0, r: 0.09 * S, k: 'visor' });
      for (const s of [-1, 1]) { o.push({ x: -0.42 * S, y: s * 0.06 * S, r: 0.03 * S, k: 'stack' }); nav(0.44, s * 0.13, s); }
      break;
  }
  lightCache.set(key, o);
  return o;
}

/** Emissive trim (local cell fractions, segment list) that gets a travelling pulse in the overlay. */
function giantStrips(shape: string): number[] {
  switch (shape) {
    case 'goliath': return [0.21, -0.17, 0.3, -0.27, 0.21, 0.17, 0.3, 0.27, 0.1, -0.4, -0.21, -0.4, 0.1, 0.4, -0.21, 0.4];
    case 'leviathan': return [-0.4, -0.235, 0.28, -0.235, -0.4, 0.235, 0.28, 0.235];
    case 'carrier': return [0.09, -0.41, -0.03, -0.445, -0.03, -0.445, -0.28, -0.445, 0.09, 0.41, -0.03, 0.445, -0.03, 0.445, -0.28, 0.445];
    case 'colossal': return [0.12, -0.05, 0.19, -0.15, 0.12, 0.05, 0.19, 0.15, -0.06, -0.1, -0.12, -0.21, -0.06, 0.1, -0.12, 0.21, 0.04, -0.43, 0.24, -0.43, 0.04, 0.43, 0.24, 0.43];
    case 'citadel': return [-0.33, -0.345, 0.33, -0.345, -0.33, 0.345, 0.33, 0.345, -0.345, -0.25, -0.345, 0.25, 0.415, -0.085, 0.415, 0.085];
  }
  return [];
}

/* ---------------------------------------------------------------------------------------------- mobility */

function limbG(g: Ctx, pts: number[], w: number, color: string, o: number): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.strokeStyle = OUTLINE; g.lineWidth = w + o * 2; g.stroke();
  g.strokeStyle = color; g.lineWidth = w; g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = w * 0.28; g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = w * 0.2;
  g.save(); g.translate(w * 0.25, w * 0.25); g.stroke(); g.restore();
}

function trackUnit(g: Ctx, cx: number, cy: number, len: number, th: number, phase: number, pal: TeamPal, o: number, E: string): void {
  const x0 = cx - len / 2, y0 = cy - th / 2;
  const band = new Path2D();
  roundRect(band, x0, y0, len, th, th * 0.45);
  g.fillStyle = '#121416';
  g.fill(band);
  g.save();
  g.clip(band);
  const pitch = len / 8;
  for (let x = x0 - pitch + phase * pitch; x < x0 + len + pitch; x += pitch) {
    g.fillStyle = METAL.base;
    g.fillRect(x + pitch * 0.08, y0, pitch * 0.78, th);
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.fillRect(x + pitch * 0.08, y0, pitch * 0.18, th);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(x + pitch * 0.64, y0, pitch * 0.22, th);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(x + pitch * 0.3, y0 + th * 0.4, pitch * 0.3, th * 0.2);
  }
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(x0, y0, len, th * 0.12);
  g.fillRect(x0, y0 + th * 0.88, len, th * 0.12);
  g.restore();
  g.lineWidth = o * 1.1;
  g.strokeStyle = OUTLINE;
  g.stroke(band);
  // track guard (armoured fender) + road wheels peeking out
  const gp = new Path2D();
  roundRect(gp, x0 + len * 0.1, cy - th * 0.32, len * 0.8, th * 0.64, th * 0.14);
  const gr = g.createLinearGradient(0, cy - th * 0.32, 0, cy + th * 0.32);
  gr.addColorStop(0, shade(pal.light, -0.12)); gr.addColorStop(1, pal.dark);
  g.fillStyle = gr; g.fill(gp); g.lineWidth = o * 0.8; g.strokeStyle = OUTLINE; g.stroke(gp);
  g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = o * 0.5;
  g.beginPath();
  for (let i = 1; i < 4; i++) { const x = x0 + len * (0.1 + i * 0.2); g.moveTo(x, cy - th * 0.32); g.lineTo(x, cy + th * 0.32); }
  g.stroke();
  g.strokeStyle = rgba(E, 0.9); g.lineWidth = o * 1.0;
  g.beginPath(); g.moveTo(x0 + len * 0.14, cy); g.lineTo(x0 + len * 0.86, cy); g.stroke();
  for (const f of [0.08, 0.92]) { dot(g, x0 + len * f, cy, th * 0.32, METAL.dark); g.lineWidth = o * 0.7; g.strokeStyle = OUTLINE; g.stroke(); dot(g, x0 + len * f, cy, th * 0.15, METAL.light); }
  hazard(g, x0 + len * 0.86, cy - th * 0.28, len * 0.04, th * 0.56, o * 0.6, true);
}

export function drawMegatracks(g: Ctx, L: UnitLayout, pal: TeamPal, phase: number, o: number): void {
  const S = L.S;
  const E = emis(pal);
  const yc = (Math.min(0.47, L.hw) + 0.09) * S, th = 0.18 * S, len = 0.44 * S;
  const xs = [0.265 * S, -0.265 * S];
  // axle beams + pylons
  g.strokeStyle = OUTLINE; g.lineWidth = 0.08 * S; g.lineCap = 'round';
  g.beginPath();
  for (const x of xs) { g.moveTo(x, -yc); g.lineTo(x, yc); }
  g.stroke();
  g.strokeStyle = METAL.dark; g.lineWidth = 0.06 * S; g.stroke();
  for (const s of [-1, 1]) for (const x of xs) trackUnit(g, x, s * yc, len, th, phase, pal, o, E);
}

export interface Foot { x: number; y: number; lift: number; a: number; }

/** Foot placements of titan legs for a gait phase (0..1). a = radians since touchdown. */
export function titanFeet(L: UnitLayout, phase: number, rest: boolean): Foot[] {
  const S = L.S;
  const quad = L.shape !== 'colossal' && S >= 4;
  const colossal = L.shape === 'colossal';
  const out: Foot[] = [];
  const stride = (quad ? 0.1 : colossal ? 0.32 : 0.2) * S;
  const rows = quad ? [0.28, -0.28] : [colossal ? -0.02 : 0];
  const fy = (quad ? Math.min(L.hw, 0.42) + 0.1 : colossal ? 0.215 : 0.31) * S;
  let k = 0;
  for (const row of rows) for (const s of [-1, 1]) {
    const diag = quad && (k++ % 2 === 1) ? Math.PI : 0;
    const ph = phase * P2 + (s > 0 ? Math.PI : 0) + diag;
    const restX = colossal ? (s > 0 ? 0.27 : -0.22) : (s > 0 ? 0.03 : -0.03);
    const fx = rest ? row * S + restX * S : row * S + Math.sin(ph) * stride;
    const lift = rest ? 0 : Math.max(0, Math.cos(ph));
    const a = (((ph - Math.PI / 2) % P2) + P2) % P2;
    out.push({ x: fx, y: s * fy, lift, a });
  }
  return out;
}

export function drawTitanLegs(g: Ctx, L: UnitLayout, pal: TeamPal, phase: number, rest: boolean, o: number): void {
  const S = L.S;
  const E = emis(pal);
  const quad = L.shape !== 'colossal' && S >= 4;
  const colossal = L.shape === 'colossal';
  const feet = titanFeet(L, phase, rest);
  const hipY = (quad ? Math.min(L.hw, 0.42) * 0.6 : colossal ? 0.15 : 0.2) * S;
  const lw = (quad ? 0.1 : colossal ? 0.13 : 0.14) * S;
  feet.forEach((f, i) => {
    const s = f.y < 0 ? -1 : 1;
    const row = quad ? (i < 2 ? 0.28 : -0.28) * S : colossal ? -0.02 * S : 0;
    const kx = (row + f.x) * 0.5 + (quad ? 0 : 0.06 * S);
    const ky = s * (Math.abs(f.y) + (quad ? 0.09 : colossal ? 0.07 : 0.07) * S);
    // contact shadow of a planted foot
    if (f.lift < 0.3) {
      g.save();
      g.filter = `blur(${Math.max(1, 0.02 * S * devK(g))}px)`;
      dot(g, f.x + 0.02 * S, f.y + 0.02 * S, (quad ? 0.13 : 0.17) * S, 'rgba(0,0,0,0.45)');
      g.restore();
    }
    // thigh + shin
    limbG(g, [row, s * hipY, kx, ky, f.x, f.y], lw, METAL.base, o);
    // hydraulic piston
    g.strokeStyle = METAL.light; g.lineWidth = lw * 0.14; g.lineCap = 'round';
    g.beginPath(); g.moveTo(row + lw * 0.25, s * hipY + s * lw * 0.15); g.lineTo(kx + lw * 0.25, ky - s * lw * 0.1); g.stroke();
    // foot: raised when lifted (bigger, lighter = closer to camera)
    const k = 1 + f.lift * 0.22;
    const fl = (quad ? 0.22 : colossal ? 0.31 : 0.3) * S * k, fw = (quad ? 0.16 : colossal ? 0.17 : 0.19) * S * k;
    const fp = new Path2D();
    // toe-shaped plate: wide front, narrower heel
    fp.moveTo(f.x + fl * 0.58, f.y - fw * 0.42);
    fp.lineTo(f.x + fl * 0.58, f.y + fw * 0.42);
    fp.lineTo(f.x + fl * 0.4, f.y + fw * 0.5);
    fp.lineTo(f.x - fl * 0.32, f.y + fw * 0.4);
    fp.lineTo(f.x - fl * 0.42, f.y + fw * 0.2);
    fp.lineTo(f.x - fl * 0.42, f.y - fw * 0.2);
    fp.lineTo(f.x - fl * 0.32, f.y - fw * 0.4);
    fp.lineTo(f.x + fl * 0.4, f.y - fw * 0.5);
    fp.closePath();
    const gr = g.createLinearGradient(f.x - fl * 0.4, f.y - fw / 2, f.x + fl * 0.4, f.y + fw / 2);
    gr.addColorStop(0, shade(METAL.light, 0.15 * f.lift)); gr.addColorStop(1, shade(METAL.dark, 0.05));
    g.fillStyle = gr; g.fill(fp); g.lineWidth = o * 1.2; g.strokeStyle = OUTLINE; g.stroke(fp);
    // toes
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = o * 0.7;
    g.beginPath();
    for (const q of [-0.17, 0.17]) { g.moveTo(f.x + fl * 0.22, f.y + fw * q); g.lineTo(f.x + fl * 0.58, f.y + fw * q); }
    g.moveTo(f.x + fl * 0.2, f.y - fw * 0.45); g.lineTo(f.x + fl * 0.2, f.y + fw * 0.45);
    g.stroke();
    // team armour cap on the ankle
    const cap = new Path2D();
    roundRect(cap, f.x - fl * 0.3, f.y - fw * 0.3, fl * 0.46, fw * 0.6, fw * 0.14);
    g.fillStyle = grad(g, 1, shade(pal.light, -0.05), pal.dark, f.x - fl * 0.3, f.y - fw * 0.3, f.x + fl * 0.16, f.y + fw * 0.3);
    g.fill(cap); g.lineWidth = o * 0.8; g.strokeStyle = OUTLINE; g.stroke(cap);
    hazard(g, f.x + fl * 0.44, f.y - fw * 0.36, fl * 0.1, fw * 0.72, o * 0.6, true);
    // knee + hip armour
    dot(g, kx, ky, lw * 0.7, shade(pal.dark, 0.1));
    g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
    dot(g, kx - lw * 0.15, ky - lw * 0.15, lw * 0.35, rgba(shade(pal.light, 0), 0.5));
    dot(g, kx, ky, lw * 0.26, rgba(E, 0.95));
    dot(g, row, s * hipY, lw * 0.75, METAL.dark);
    g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
    dot(g, row, s * hipY, lw * 0.4, METAL.light);
  });
}

export function gravPods(S: number, hw: number): { x: number; y: number; r: number }[] {
  if (S >= 4) {
    // giant lifters: four big nacelles out on outriggers + two small ones mid-ship
    const y = (Math.min(0.46, hw) + 0.1) * S, R = 0.085 * S;
    return [
      { x: 0.26 * S, y, r: R }, { x: 0.26 * S, y: -y, r: R }, { x: -0.3 * S, y, r: R }, { x: -0.3 * S, y: -y, r: R },
      { x: -0.02 * S, y: y + 0.02 * S, r: R * 0.7 }, { x: -0.02 * S, y: -y - 0.02 * S, r: R * 0.7 },
    ];
  }
  const y = (Math.min(0.46, hw) + 0.07) * S;
  return [
    { x: 0.3 * S, y, r: 0.115 * S }, { x: 0.3 * S, y: -y, r: 0.115 * S },
    { x: -0.3 * S, y, r: 0.115 * S }, { x: -0.3 * S, y: -y, r: 0.115 * S },
  ];
}

export function drawGravlift(g: Ctx, L: UnitLayout, pal: TeamPal, o: number): void {
  const S = L.S;
  const E = emis(pal);
  const pods = gravPods(S, L.hw);
  g.lineCap = 'round';
  g.strokeStyle = OUTLINE; g.lineWidth = 0.07 * S;
  g.beginPath();
  for (const p of pods) { g.moveTo(p.x * 0.5, p.y * 0.4); g.lineTo(p.x, p.y); }
  g.stroke();
  g.strokeStyle = METAL.dark; g.lineWidth = 0.05 * S; g.stroke();
  for (const p of pods) {
    // nacelle housing
    const h = new Path2D();
    roundRect(h, p.x - p.r * 1.45, p.y - p.r * 1.25, p.r * 2.9, p.r * 2.5, p.r * 0.9);
    g.fillStyle = grad(g, 1, shade(pal.light, -0.1), pal.deep, p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r);
    g.fill(h); g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke(h);
    dot(g, p.x, p.y, p.r * 1.12, METAL.dark); g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
    const gr = g.createRadialGradient(p.x, p.y, p.r * 0.2, p.x, p.y, p.r * 1.05);
    gr.addColorStop(0, rgba(E, 0.95)); gr.addColorStop(0.5, rgba(E, 0.4)); gr.addColorStop(1, '#10161c');
    dot(g, p.x, p.y, p.r * 0.98, gr);
    g.lineWidth = o * 0.8; g.strokeStyle = OUTLINE; g.stroke();
    g.strokeStyle = rgba(E, 0.9); g.lineWidth = o * 1.1;
    g.beginPath(); g.arc(p.x, p.y, p.r * 0.7, 0, P2); g.stroke();
    g.strokeStyle = METAL.light; g.lineWidth = p.r * 0.1;
    for (let i = 0; i < 6; i++) { const a = (i / 6) * P2; g.beginPath(); g.moveTo(p.x + Math.cos(a) * p.r * 0.75, p.y + Math.sin(a) * p.r * 0.75); g.lineTo(p.x + Math.cos(a) * p.r * 1.05, p.y + Math.sin(a) * p.r * 1.05); g.stroke(); }
    dot(g, p.x, p.y, p.r * 0.22, '#ffffff');
  }
}

/* ---------------------------------------------------------------------------------------- dynamic overlay */

export interface GiantPose { time: number; seed?: number; moving?: boolean; odometer?: number; }

/** Animated hull details and running-gear effects, drawn right after the hull. (x, y) world position of the unit. */
export function drawGiantFx(g: Ctx, L: UnitLayout, p: GiantPose, x: number, y: number, ang: number, sc: number, px: number, pal: TeamPal, alpha: number): void {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const W = (lx: number, ly: number) => [x + (cs * lx - sn * ly) * sc, y + (sn * lx + cs * ly) * sc] as const;
  const E = emis(pal);
  const t = p.time, seed = p.seed ?? 0;
  const S = L.S;
  const prev = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter';
  const glow = softDot(rgba(E, 1));
  const white = softDot('rgba(255,255,255,1)');
  const breathe = 0.5 + 0.5 * Math.sin(t * 2.2 + seed);
  if (GIANT_SHAPES.has(L.shape)) {
    // emissive trim with a travelling pulse
    const st = giantStrips(L.shape);
    if (st.length) {
      const tr = g.getTransform();
      g.transform(cs * sc, sn * sc, -sn * sc, cs * sc, x, y);
      g.lineCap = 'round';
      g.strokeStyle = E;
      g.globalAlpha = alpha * (0.25 + 0.3 * breathe);
      g.lineWidth = Math.max(3 / px, 0.035 * S);
      g.beginPath();
      for (let i = 0; i < st.length; i += 4) { g.moveTo(st[i] * S, st[i + 1] * S); g.lineTo(st[i + 2] * S, st[i + 3] * S); }
      g.stroke();
      g.globalAlpha = alpha * (0.55 + 0.35 * breathe);
      g.lineWidth = Math.max(1.3 / px, 0.01 * S);
      g.stroke();
      const f = (t * 0.6 + seed * 0.1) % 1;
      for (let i = 0; i < st.length; i += 4) {
        const qx = (st[i] + (st[i + 2] - st[i]) * f) * S, qy = (st[i + 1] + (st[i + 3] - st[i + 1]) * f) * S;
        const r = Math.max(4 / px, 0.05 * S);
        g.globalAlpha = alpha * 0.9;
        g.drawImage(glow, qx - r, qy - r, r * 2, r * 2);
        g.drawImage(white, qx - r * 0.3, qy - r * 0.3, r * 0.6, r * 0.6);
      }
      g.setTransform(tr);
    }
    for (const l of giantLights(L.shape, S)) {
      const [wx, wy] = W(l.x, l.y);
      if (l.k === 'core') {
        // reactor heart: slow heavy throb visible from fit zoom
        const beat = Math.pow(0.5 + 0.5 * Math.sin(t * 3.1 + seed), 3);
        const r = Math.max(10 / px, l.r * sc * (3.2 + 1.2 * beat));
        g.globalAlpha = alpha * (0.45 + 0.4 * beat);
        g.drawImage(glow, wx - r, wy - r, r * 2, r * 2);
        g.globalAlpha = alpha * (0.7 + 0.3 * beat);
        const r2 = l.r * sc * 1.1;
        g.drawImage(white, wx - r2, wy - r2, r2 * 2, r2 * 2);
      } else if (l.k === 'visor') {
        const scan = 0.6 + 0.4 * Math.sin(t * 1.7 + seed);
        g.globalAlpha = alpha * scan;
        const r = Math.max(6 / px, l.r * sc * 1.4);
        g.drawImage(glow, wx - r, wy - r, r * 2, r * 2);
      } else if (l.k === 'vent') {
        const h = 0.5 + 0.5 * Math.sin(t * 1.3 + (l.ph ?? 0) + seed + l.y);
        g.globalAlpha = alpha * (0.15 + 0.35 * h);
        const r = l.r * sc * 1.6;
        g.drawImage(softDot('rgba(255,110,50,1)'), wx - r, wy - r, r * 2, r * 2);
      } else if (l.k === 'engine') {
        const fl = 0.8 + 0.2 * Math.sin(t * 31 + l.y * 7) + (p.moving ? 0.25 : 0);
        const r = l.r * sc * 1.8 * fl;
        const ex = Math.cos(ang + (l.dir ?? Math.PI)), ey = Math.sin(ang + (l.dir ?? Math.PI));
        g.globalAlpha = alpha * 0.7;
        g.drawImage(glow, wx + ex * r * 0.5 - r, wy + ey * r * 0.5 - r, r * 2, r * 2);
        g.globalAlpha = alpha * 0.9;
        g.drawImage(white, wx - r * 0.35, wy - r * 0.35, r * 0.7, r * 0.7);
        g.globalAlpha = alpha * 0.4;
        g.drawImage(glow, wx + ex * r * 1.3 - r * 0.7, wy + ey * r * 1.3 - r * 0.7, r * 1.4, r * 1.4);
      } else if (l.k === 'blink') {
        const on = ((t * 1.1 + seed + (l.ph ?? 0) * 0.5) % 1) < 0.16;
        if (on) {
          g.globalAlpha = alpha;
          const r = Math.max(6 / px, l.r * sc);
          g.drawImage(softDot(l.col ?? '#ffffff'), wx - r, wy - r, r * 2, r * 2);
          g.drawImage(white, wx - r * 0.25, wy - r * 0.25, r * 0.5, r * 0.5);
        }
      } else if (l.k === 'stack') {
        const n = p.moving ? 4 : 2;
        for (let i = 0; i < n; i++) {
          const age = (t * (p.moving ? 1.1 : 0.6) + i / n + seed * 0.37 + l.y * 2) % 1;
          const [bx, by] = W(l.x - age * 0.28 * S, l.y + Math.sin(age * 6 + i) * 0.02 * S);
          const r = (0.03 + age * 0.09) * S * sc;
          g.globalAlpha = alpha * (1 - age) * 0.28;
          g.drawImage(softDot('rgba(255,170,90,1)'), bx - r, by - r, r * 2, r * 2);
        }
        g.globalAlpha = alpha * (0.4 + 0.2 * Math.sin(t * 9 + l.y * 5));
        const r = l.r * sc * 1.4;
        g.drawImage(softDot('rgba(255,150,70,1)'), wx - r, wy - r, r * 2, r * 2);
      }
    }
    // smoke (normal blend) from stacks
    g.globalCompositeOperation = prev;
    for (const l of giantLights(L.shape, S)) {
      if (l.k !== 'stack') continue;
      const n = p.moving ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const age = (t * (p.moving ? 0.8 : 0.45) + i / n + seed * 0.21 + l.y * 3) % 1;
        const [bx, by] = W(l.x - (0.05 + age * 0.4) * S, l.y * (1 + age * 0.6));
        const r = (0.03 + age * 0.11) * S * sc;
        g.globalAlpha = alpha * (1 - age) * 0.32;
        g.drawImage(softDot('rgba(40,40,44,1)'), bx - r, by - r, r * 2, r * 2);
      }
    }
    // radar dishes
    for (const l of giantLights(L.shape, S)) {
      if (l.k !== 'radar' || l.r <= 0) continue;
      const [wx, wy] = W(l.x, l.y);
      const a = ang + t * 1.6 + seed;
      const r = l.r * sc * 0.55;
      g.globalAlpha = alpha;
      // sweep wedge
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = rgba(E, 0.12);
      g.beginPath(); g.moveTo(wx, wy); g.arc(wx, wy, r * 2.2, a - 0.6, a); g.closePath(); g.fill();
      g.globalCompositeOperation = prev;
      g.lineCap = 'round';
      g.strokeStyle = OUTLINE; g.lineWidth = Math.max(2 / px, r * 0.5);
      g.beginPath(); g.moveTo(wx + Math.cos(a) * r * 0.2, wy + Math.sin(a) * r * 0.2); g.lineTo(wx - Math.cos(a) * r, wy - Math.sin(a) * r);
      g.moveTo(wx + Math.cos(a + 1.57) * r * 0.7, wy + Math.sin(a + 1.57) * r * 0.7); g.lineTo(wx + Math.cos(a - 1.57) * r * 0.7, wy + Math.sin(a - 1.57) * r * 0.7); g.stroke();
      g.strokeStyle = '#c4ccd4'; g.lineWidth = Math.max(1.2 / px, r * 0.26);
      g.beginPath(); g.moveTo(wx + Math.cos(a + 1.57) * r * 0.7, wy + Math.sin(a + 1.57) * r * 0.7); g.lineTo(wx + Math.cos(a - 1.57) * r * 0.7, wy + Math.sin(a - 1.57) * r * 0.7); g.stroke();
      g.fillStyle = METAL.dark; g.beginPath(); g.arc(wx, wy, r * 0.28, 0, P2); g.fill();
      g.fillStyle = E; g.beginPath(); g.arc(wx, wy, r * 0.13, 0, P2); g.fill();
    }
    g.globalCompositeOperation = 'lighter';
  }
  // running gear
  const id = L.mob.id;
  if (id === 'gravlift') {
    for (const [i, pod] of gravPods(S, L.hw).entries()) {
      const [wx, wy] = W(pod.x, pod.y);
      const r = pod.r * sc;
      const pulse = 0.5 + 0.5 * Math.sin(t * 5 + i * 1.3 + seed);
      const gk = S >= 4 ? 1.6 : 2.1;
      g.globalAlpha = alpha * (S >= 4 ? 0.3 + 0.2 * pulse : 0.5 + 0.25 * pulse);
      g.drawImage(glow, wx - r * gk, wy - r * gk, r * gk * 2, r * gk * 2);
      g.globalAlpha = alpha * 0.7;
      g.drawImage(white, wx - r * 0.5, wy - r * 0.5, r, r);
      g.strokeStyle = E;
      g.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        const f = (t * 0.9 + k / 3 + i * 0.19) % 1;
        g.globalAlpha = alpha * (1 - f) * 0.75;
        g.lineWidth = Math.max(1.2 / px, r * 0.1 * (1 - f * 0.6));
        g.beginPath(); g.arc(wx, wy, r * (0.7 + f * 1.5), 0, P2); g.stroke();
      }
      g.globalAlpha = alpha * 0.95;
      g.lineWidth = Math.max(1.5 / px, r * 0.14);
      for (let k = 0; k < 3; k++) {
        const a0 = t * (i % 2 ? -3.4 : 3.4) + k * (P2 / 3);
        g.beginPath(); g.arc(wx, wy, r * 0.9, a0, a0 + 0.9); g.stroke();
      }
    }
  } else if (id === 'megatracks' && p.moving) {
    g.globalCompositeOperation = prev;
    const yc = (Math.min(0.47, L.hw) + 0.09) * S;
    for (const s of [-1, 1]) for (const sx of [0.265, -0.265]) for (let i = 0; i < 4; i++) {
      const age = (t * 1.6 + i / 4 + seed + sx * 3 + s) % 1;
      const [bx, by] = W((sx - 0.22) * S - age * 0.45 * S, s * (yc / S + (age - 0.3) * 0.12 * s) * S);
      const r = (0.05 + age * 0.14) * S * sc;
      g.globalAlpha = alpha * (1 - age) * 0.42;
      g.drawImage(softDot('rgba(150,130,100,1)'), bx - r, by - r, r * 2, r * 2);
    }
  } else if (id === 'titanlegs' && p.moving) {
    g.globalCompositeOperation = prev;
    const ph = ((p.odometer ?? 0) / L.cycle) % 1;
    for (const f of titanFeet(L, ph, false)) {
      const age = f.a / 1.7;
      if (age >= 1) continue;
      const [bx, by] = W(f.x - 0.02 * S, f.y);
      const r = (0.1 + age * 0.45) * S * sc;
      g.globalAlpha = alpha * (1 - age) * 0.6;
      g.drawImage(softDot('rgba(160,140,108,1)'), bx - r, by - r, r * 2, r * 2);
      g.strokeStyle = 'rgba(220,200,160,0.55)';
      g.lineWidth = Math.max(1.5 / px, 0.035 * S * (1 - age));
      g.globalAlpha = alpha * (1 - age) * 0.45;
      g.beginPath(); g.arc(bx, by, r * 1.2, 0, P2); g.stroke();
    }
  }
  g.globalCompositeOperation = prev;
  g.globalAlpha = alpha;
}
