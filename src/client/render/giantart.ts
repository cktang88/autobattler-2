// Giant (size 4) and Titan (size 5) war machines: hull details, running gear (megatracks, titan legs, grav
// lifters) and the animated overlay (pulsing reactors, blinking lights, radar, exhaust, footfall dust, lifter swirl).
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
  g.strokeStyle = 'rgba(255,255,255,0.3)';
  g.stroke(path);
  g.restore();
  g.save();
  g.translate(-o * 1.3 * depth, -o * 1.3 * depth);
  g.strokeStyle = 'rgba(0,0,0,0.42)';
  g.stroke(path);
  g.restore();
  g.restore();
  g.lineWidth = o * 0.8;
  g.strokeStyle = OUTLINE;
  g.stroke(path);
}

function recess(g: Ctx, path: Path2D, o: number): void {
  g.fillStyle = 'rgba(4,6,9,0.62)';
  g.fill(path);
  g.save();
  g.clip(path);
  g.lineWidth = o * 3;
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
  g.strokeStyle = rgba(col, 0.28 * a);
  g.lineWidth = w * 3.2;
  g.stroke();
  g.strokeStyle = rgba(col, 0.95 * a);
  g.lineWidth = w;
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = w * 0.35;
  g.stroke();
}

function seam(g: Ctx, pts: number[], S: number, w: number, col = 'rgba(0,0,0,0.42)'): void {
  g.lineCap = 'butt';
  g.strokeStyle = col;
  g.lineWidth = w;
  g.beginPath();
  for (let i = 0; i < pts.length; i += 4) { g.moveTo(pts[i] * S, pts[i + 1] * S); g.lineTo(pts[i + 2] * S, pts[i + 3] * S); }
  g.stroke();
}

function dot(g: Ctx, x: number, y: number, r: number, c: string): void {
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
  gr.addColorStop(1, shade(pal.dark, -0.1));
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

function tower(g: Ctx, x: number, y: number, r: number, pal: TeamPal, o: number, E: string): void {
  dot(g, x + r * 0.22, y + r * 0.28, r * 1.08, 'rgba(0,0,0,0.45)');
  g.beginPath();
  g.arc(x, y, r * 1.05, 0, P2);
  g.fillStyle = METAL.dark;
  g.fill();
  g.lineWidth = o;
  g.strokeStyle = OUTLINE;
  g.stroke();
  const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
  gr.addColorStop(0, shade(pal.light, 0.2));
  gr.addColorStop(1, pal.dark);
  dot(g, x, y, r * 0.82, gr as unknown as string);
  g.lineWidth = o * 0.6;
  g.strokeStyle = OUTLINE;
  g.stroke();
  g.fillStyle = '#050a10';
  g.beginPath();
  roundRect(g, x + r * 0.05, y - r * 0.5, r * 0.62, r * 1.0, r * 0.15);
  g.fill();
  g.fillStyle = rgba(E, 0.9);
  g.fillRect(x + r * 0.34, y - r * 0.4, r * 0.18, r * 0.8);
  dot(g, x - r * 0.3, y, r * 0.22, METAL.dark);
}

function lamp(g: Ctx, x: number, y: number, r: number, c: string): void {
  dot(g, x, y, r * 1.7, 'rgba(0,0,0,0.5)');
  dot(g, x, y, r, c);
  dot(g, x - r * 0.25, y - r * 0.25, r * 0.4, 'rgba(255,255,255,0.8)');
}

function topLight(g: Ctx, S: number, hw: number): CanvasGradient {
  const gr = g.createLinearGradient(-0.3 * S, -hw * S, 0.3 * S, hw * S);
  gr.addColorStop(0, '#ffffff22');
  gr.addColorStop(1, '#00000000');
  return gr;
}

/* --------------------------------------------------------------------------------------------- hull path */

export function giantHullPath(shape: string, S: number): Path2D | null {
  switch (shape) {
    case 'goliath': return pm([0.47, -0.12, 0.4, -0.24, 0.24, -0.34, 0.0, -0.4, -0.36, -0.4, -0.47, -0.3], S);
    case 'leviathan': return pm([0.48, -0.07, 0.42, -0.2, 0.2, -0.22, 0.16, -0.42, -0.32, -0.42, -0.46, -0.33, -0.48, -0.1], S);
    case 'carrier': return pm([0.5, -0.05, 0.4, -0.1, 0.22, -0.12, 0.16, -0.4, -0.18, -0.46, -0.32, -0.42, -0.34, -0.22, -0.47, -0.18, -0.5, -0.08], S);
    case 'colossal': return pm([0.44, -0.06, 0.4, -0.13, 0.3, -0.15, 0.27, -0.24, 0.14, -0.27, 0.12, -0.4, 0.04, -0.47, -0.16, -0.47, -0.22, -0.4, -0.22, -0.28, -0.36, -0.27, -0.44, -0.2, -0.46, -0.08], S);
    case 'citadel': return pm([0.5, -0.26, 0.42, -0.43, 0.3, -0.47, -0.3, -0.47, -0.42, -0.43, -0.5, -0.26], S);
  }
  return null;
}

/* ------------------------------------------------------------------------------------------ hull details */

export function giantHullDetails(g: Ctx, L: UnitLayout, pal: TeamPal, o: number): void {
  const S = L.S;
  const E = emis(pal);
  const lite = shade(pal.body, 0.16);
  const hi = shade(pal.light, -0.08);
  switch (L.shape) {
    case 'goliath': {
      belt(g, -0.38, 0.2, -0.345, 0.075, S, pal, o, E, 6);
      belt(g, -0.38, 0.2, 0.345, 0.075, S, pal, o, E, 6);
      bevel(g, pm([0.37, -0.1, 0.3, -0.2, 0.04, -0.27, -0.34, -0.27, -0.42, -0.17], S), lite, o);
      seam(g, [0.3, -0.1, -0.35, -0.1, 0.3, 0.1, -0.35, 0.1, -0.2, -0.27, -0.2, 0.27, 0.0, -0.27, 0.0, 0.27], S, o * 0.5);
      bevel(g, rr(-0.41, -0.1, 0.5, 0.2, 0.03, S), hi, o, 1.3);
      seam(g, [-0.36, 0, 0.06, 0], S, o * 0.45);
      g.fillStyle = 'rgba(255,255,255,0.1)';
      g.fillRect(-0.4 * S, -0.095 * S, 0.48 * S, 0.04 * S);
      recess(g, rr(-0.04, -0.16, 0.14, 0.32, 0.02, S), o);
      glowLine(g, [0.34, -0.09, 0.2, -0.2, 0.34, 0.09, 0.2, 0.2, 0.16, -0.17, 0.0, -0.17, 0.16, 0.17, 0.0, 0.17], S, E, o * 0.9);
      hazard(g, 0.385 * S, -0.1 * S, 0.055 * S, 0.2 * S, o, true);
      grille(g, -0.36 * S, -0.19 * S, 0.1 * S, 0.1 * S, 4, o, E);
      grille(g, -0.36 * S, 0.19 * S, 0.1 * S, 0.1 * S, 4, o, E);
      tower(g, -0.16 * S, 0, 0.075 * S, pal, o, E);
      rivetRow(g, -0.3 * S, -0.245 * S, 0.2 * S, -0.245 * S, 6, 0.008 * S);
      rivetRow(g, -0.3 * S, 0.245 * S, 0.2 * S, 0.245 * S, 6, 0.008 * S);
      for (const s of [-1, 1]) lamp(g, 0.42 * S, s * 0.16 * S, 0.014 * S, '#fff3c4');
      break;
    }
    case 'leviathan': {
      for (const s of [-1, 1]) {
        bevel(g, rr(-0.4, s < 0 ? -0.4 : 0.1, 0.56, 0.3, 0.03, S), lite, o);
        seam(g, [-0.3, s * 0.1, -0.3, s * 0.4, -0.12, s * 0.1, -0.12, s * 0.4, 0.04, s * 0.1, 0.04, s * 0.4], S, o * 0.5);
        belt(g, -0.42, 0.14, s * 0.415, 0.06, S, pal, o, E, 7);
        recess(g, rr(-0.36, s < 0 ? -0.27 : 0.19, 0.12, 0.08, 0.01, S), o);
        grille(g, -0.42 * S, s * 0.28 * S, 0.06 * S, 0.12 * S, 4, o, E);
        hazard(g, 0.17 * S, (s < 0 ? -0.4 : 0.34) * S, 0.05 * S, 0.06 * S, o, true);
      }
      // central superstructure
      bevel(g, rr(-0.44, -0.105, 0.68, 0.21, 0.035, S), hi, o, 1.3);
      seam(g, [-0.36, -0.105, -0.36, 0.105, 0.0, -0.105, 0.0, 0.105], S, o * 0.5);
      bevel(g, rr(-0.22, -0.075, 0.2, 0.15, 0.025, S), shade(pal.light, 0.1), o, 1.5);
      g.fillStyle = '#050a10';
      g.fillRect(-0.045 * S, -0.06 * S, 0.03 * S, 0.12 * S);
      g.fillStyle = rgba(E, 0.95);
      g.fillRect(-0.036 * S, -0.05 * S, 0.012 * S, 0.1 * S);
      for (const s of [-1, 1]) { tower(g, -0.36 * S, s * 0.05 * S, 0.035 * S, pal, o, E); }
      glowLine(g, [0.44, -0.04, 0.3, -0.12, 0.44, 0.04, 0.3, 0.12, 0.2, -0.22, 0.2, -0.1, 0.2, 0.22, 0.2, 0.1], S, E, o * 0.9);
      hazard(g, 0.4 * S, -0.06 * S, 0.06 * S, 0.12 * S, o, true);
      for (const s of [-1, 1]) lamp(g, 0.4 * S, s * 0.19 * S, 0.014 * S, '#fff3c4');
      break;
    }
    case 'carrier': {
      // flight deck
      bevel(g, pm([0.42, -0.1, 0.24, -0.12, 0.2, -0.34, -0.14, -0.4, -0.28, -0.36, -0.3, -0.2, -0.42, -0.16], S), shade(pal.dark, 0.1), o);
      const deck = rr(-0.3, -0.115, 0.6, 0.23, 0.02, S);
      bevel(g, deck, '#2a3036', o, 0.8);
      g.save();
      g.clip(deck);
      g.strokeStyle = 'rgba(230,230,200,0.55)';
      g.lineWidth = o * 0.9;
      g.setLineDash([0.04 * S, 0.035 * S]);
      g.beginPath(); g.moveTo(-0.3 * S, 0); g.lineTo(0.3 * S, 0); g.stroke();
      g.setLineDash([]);
      g.strokeStyle = rgba(E, 0.8);
      g.lineWidth = o * 0.8;
      g.beginPath();
      for (let i = 0; i < 5; i++) { const x = (0.0 + i * 0.07) * S; g.moveTo(x, -0.09 * S); g.lineTo(x + 0.03 * S, -0.04 * S); g.lineTo(x, 0.0); g.moveTo(x, 0.09 * S); g.lineTo(x + 0.03 * S, 0.04 * S); g.lineTo(x, 0.0); }
      g.stroke();
      g.restore();
      for (const s of [-1, 1]) {
        // wing decks with landing pads
        bevel(g, pp([0.18, s * 0.14, 0.14, s * 0.38, -0.14, s * 0.43, -0.26, s * 0.37, -0.28, s * 0.14], S), shade(pal.body, 0.1), o);
        seam(g, [-0.2, s * 0.15, -0.2, s * 0.4, 0.0, s * 0.14, 0.0, s * 0.41], S, o * 0.5);
        g.strokeStyle = 'rgba(240,230,160,0.7)';
        g.lineWidth = o * 0.9;
        g.beginPath(); g.arc(0.08 * S, s * 0.28 * S, 0.055 * S, 0, P2); g.stroke();
        g.fillStyle = 'rgba(240,230,160,0.7)';
        g.fillRect(0.062 * S, s * 0.28 * S - 0.03 * S, 0.012 * S, 0.06 * S);
        g.fillRect(0.098 * S, s * 0.28 * S - 0.03 * S, 0.012 * S, 0.06 * S);
        g.fillRect(0.062 * S, s * 0.28 * S - 0.006 * S, 0.048 * S, 0.012 * S);
        hazard(g, -0.16 * S, (s < 0 ? -0.46 : 0.4) * S, 0.2 * S, 0.06 * S, o);
        glowLine(g, [0.14, s * 0.37, -0.12, s * 0.42], S, E, o * 0.9);
        grille(g, -0.42 * S, s * 0.13 * S, 0.1 * S, 0.1 * S, 4, o, E, 0.8);
        lamp(g, -0.1 * S, s * 0.44 * S, 0.013 * S, s < 0 ? '#ff4040' : '#40ff70');
      }
      tower(g, -0.2 * S, 0, 0.06 * S, pal, o, E);
      hazard(g, 0.4 * S, -0.06 * S, 0.06 * S, 0.12 * S, o, true);
      break;
    }
    case 'colossal': {
      // backpack + exhaust stacks
      bevel(g, rr(-0.45, -0.2, 0.2, 0.4, 0.03, S), shade(pal.dark, 0.1), o);
      for (const s of [-1, 1]) {
        tower(g, -0.4 * S, s * 0.11 * S, 0.05 * S, pal, o, E);
        dot(g, -0.4 * S, s * 0.11 * S, 0.028 * S, '#0a0a0a');
      }
      grille(g, -0.31 * S, 0, 0.05 * S, 0.14 * S, 4, o, E);
      // pauldrons
      for (const s of [-1, 1]) {
        const pa = pp([0.1, s * 0.39, 0.02, s * 0.46, -0.16, s * 0.46, -0.2, s * 0.4, -0.2, s * 0.29, 0.1, s * 0.29], S);
        bevel(g, pa, shade(pal.light, -0.12), o, 1.4);
        seam(g, [-0.1, s * 0.29, -0.1, s * 0.46, 0.0, s * 0.3, 0.02, s * 0.45], S, o * 0.5);
        hazard(g, -0.19 * S, (s < 0 ? -0.455 : 0.405) * S, 0.07 * S, 0.05 * S, o);
        rivetRow(g, 0.08 * S, s * 0.33 * S, 0.08 * S, s * 0.39 * S, 3, 0.008 * S);
        glowLine(g, [0.09, s * 0.31, 0.09, s * 0.39, -0.17, s * 0.43, 0.0, s * 0.45], S, E, o * 0.9);
      }
      // chest
      bevel(g, pm([0.3, -0.12, 0.24, -0.21, -0.08, -0.24, -0.2, -0.2, -0.2, -0.1], S), shade(pal.body, 0.12), o, 1.3);
      seam(g, [0.28, 0, -0.2, 0, -0.08, -0.22, -0.08, 0.22], S, o * 0.5);
      recess(g, rr(-0.15, -0.075, 0.15, 0.15, 0.03, S), o);
      dot(g, -0.075 * S, 0, 0.05 * S, rgba(E, 0.35));
      g.lineWidth = o;
      g.strokeStyle = rgba(E, 0.95);
      g.beginPath(); g.arc(-0.075 * S, 0, 0.05 * S, 0, P2); g.stroke();
      dot(g, -0.075 * S, 0, 0.022 * S, '#ffffff');
      // head
      bevel(g, pm([0.43, -0.05, 0.4, -0.12, 0.31, -0.14, 0.3, -0.05], S), hi, o, 1.2);
      g.fillStyle = '#04080c';
      g.fillRect(0.355 * S, -0.1 * S, 0.04 * S, 0.2 * S);
      g.fillStyle = rgba(E, 0.95);
      g.fillRect(0.37 * S, -0.09 * S, 0.016 * S, 0.18 * S);
      break;
    }
    case 'citadel': {
      // rampart ring + keep
      const ring = pm([0.5, -0.26, 0.42, -0.43, 0.3, -0.47, -0.3, -0.47, -0.42, -0.43, -0.5, -0.26], S);
      g.save();
      g.clip(ring);
      g.strokeStyle = 'rgba(0,0,0,0.38)';
      g.lineWidth = 0.1 * S;
      g.stroke(ring);
      g.restore();
      for (let i = 0; i < 9; i++) {
        const x = (-0.32 + i * 0.08) * S;
        for (const s of [-1, 1]) {
          g.beginPath(); roundRect(g, x - 0.025 * S, s * 0.435 * S - 0.02 * S, 0.05 * S, 0.04 * S, 0.008 * S);
          g.fillStyle = shade(pal.light, -0.1); g.fill(); g.lineWidth = o * 0.6; g.strokeStyle = OUTLINE; g.stroke();
        }
      }
      bevel(g, pm([0.44, -0.2, 0.38, -0.36, -0.36, -0.36, -0.44, -0.24], S), shade(pal.body, 0.1), o, 1.4);
      seam(g, [0.38, 0, -0.44, 0, 0.0, -0.36, 0.0, 0.36, -0.2, -0.36, -0.2, 0.36], S, o * 0.5);
      recess(g, rr(-0.2, -0.1, 0.16, 0.2, 0.04, S), o);
      g.strokeStyle = rgba(E, 0.95);
      g.lineWidth = o * 1.1;
      g.beginPath(); g.arc(-0.12 * S, 0, 0.08 * S, 0, P2); g.stroke();
      glowLine(g, [0.44, -0.2, 0.38, -0.33, 0.44, 0.2, 0.38, 0.33, 0.35, -0.35, -0.33, -0.35, 0.35, 0.35, -0.33, 0.35], S, E, o * 0.8, 0.9);
      // gate
      bevel(g, rr(0.43, -0.12, 0.08, 0.24, 0.015, S), METAL.dark, o);
      hazard(g, 0.44 * S, -0.1 * S, 0.025 * S, 0.2 * S, o, true);
      grille(g, -0.45 * S, -0.17 * S, 0.06 * S, 0.14 * S, 4, o, E);
      grille(g, -0.45 * S, 0.17 * S, 0.06 * S, 0.14 * S, 4, o, E);
      // bastions
      for (const sx of [1, -1]) for (const sy of [-1, 1]) {
        const bx = sx * 0.425 * S, by = sy * 0.375 * S, br = 0.1 * S;
        dot(g, bx + br * 0.2, by + br * 0.25, br * 1.1, 'rgba(0,0,0,0.4)');
        g.beginPath();
        for (let i = 0; i < 8; i++) { const a = (i / 8) * P2 + P2 / 16; g.lineTo(bx + Math.cos(a) * br, by + Math.sin(a) * br); }
        g.closePath();
        const gr = g.createRadialGradient(bx - br * 0.3, by - br * 0.3, 0, bx, by, br);
        gr.addColorStop(0, shade(pal.light, 0.1)); gr.addColorStop(1, pal.dark);
        g.fillStyle = gr; g.fill(); g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = o * 0.6;
        g.beginPath(); g.arc(bx, by, br * 0.62, 0, P2); g.stroke();
        dot(g, bx, by, br * 0.32, METAL.dark);
        dot(g, bx, by, br * 0.18, rgba(E, 0.9));
        g.strokeStyle = OUTLINE; g.lineWidth = o * 1.2;
        g.beginPath();
        const a0 = Math.atan2(sy, sx);
        g.moveTo(bx + Math.cos(a0) * br * 0.65, by + Math.sin(a0) * br * 0.65); g.lineTo(bx + Math.cos(a0) * br * 0.95, by + Math.sin(a0) * br * 0.95);
        g.stroke();
      }
      break;
    }
  }
  // soft global top light so the big hulls read as layered
  void topLight;
}

/* ----------------------------------------------------------------------------------------------- lights */

export interface GLight {
  x: number;
  y: number;
  r: number;
  k: 'core' | 'blink' | 'stack' | 'radar' | 'visor';
  ph?: number;
  col?: string;
}

/** Positions (cells, local) of animated hull details per shape. */
export function giantLights(shape: string, S: number): GLight[] {
  const o: GLight[] = [];
  switch (shape) {
    case 'goliath':
      o.push({ x: -0.16 * S, y: 0, r: 0.12 * S, k: 'radar' });
      for (const s of [-1, 1]) { o.push({ x: 0.42 * S, y: s * 0.16 * S, r: 0.05 * S, k: 'blink', ph: s, col: s < 0 ? '#ff4040' : '#40ff70' }); o.push({ x: -0.36 * S, y: s * 0.19 * S, r: 0.1 * S, k: 'core' }); }
      break;
    case 'leviathan':
      o.push({ x: -0.12 * S, y: 0, r: 0.15 * S, k: 'radar' });
      for (const s of [-1, 1]) { o.push({ x: -0.36 * S, y: s * 0.05 * S, r: 0.04 * S, k: 'stack' }); o.push({ x: 0.4 * S, y: s * 0.19 * S, r: 0.05 * S, k: 'blink', ph: s, col: s < 0 ? '#ff4040' : '#40ff70' }); o.push({ x: -0.04 * S, y: 0, r: 0.1 * S, k: 'core' }); }
      break;
    case 'carrier':
      o.push({ x: -0.2 * S, y: 0, r: 0.14 * S, k: 'radar' });
      for (const s of [-1, 1]) { o.push({ x: -0.42 * S, y: s * 0.13 * S, r: 0.1 * S, k: 'core' }); o.push({ x: -0.1 * S, y: s * 0.44 * S, r: 0.05 * S, k: 'blink', ph: s, col: s < 0 ? '#ff4040' : '#40ff70' }); }
      break;
    case 'colossal':
      o.push({ x: -0.075 * S, y: 0, r: 0.2 * S, k: 'core' });
      o.push({ x: 0.378 * S, y: 0, r: 0.16 * S, k: 'visor' });
      for (const s of [-1, 1]) { o.push({ x: -0.4 * S, y: s * 0.11 * S, r: 0.05 * S, k: 'stack' }); o.push({ x: -0.04 * S, y: s * 0.45 * S, r: 0.04 * S, k: 'blink', ph: s, col: s < 0 ? '#ff4040' : '#40ff70' }); }
      break;
    case 'citadel':
      o.push({ x: -0.12 * S, y: 0, r: 0.16 * S, k: 'core' });
      o.push({ x: -0.12 * S, y: 0, r: 0.2 * S, k: 'radar' });
      for (const sx of [1, -1]) for (const sy of [-1, 1]) o.push({ x: sx * 0.425 * S, y: sy * 0.375 * S, r: 0.1 * S, k: 'core' });
      for (const s of [-1, 1]) { o.push({ x: -0.45 * S, y: s * 0.17 * S, r: 0.05 * S, k: 'stack' }); o.push({ x: 0.46 * S, y: s * 0.2 * S, r: 0.04 * S, k: 'blink', ph: s, col: s < 0 ? '#ff4040' : '#40ff70' }); }
      break;
  }
  return o;
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
  g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = w * 0.28; g.stroke();
}

function trackUnit(g: Ctx, cx: number, cy: number, len: number, th: number, phase: number, pal: TeamPal, o: number, E: string): void {
  const x0 = cx - len / 2, y0 = cy - th / 2;
  const band = new Path2D();
  roundRect(band, x0, y0, len, th, th * 0.5);
  g.fillStyle = '#121416';
  g.fill(band);
  g.save();
  g.clip(band);
  const pitch = len / 7;
  for (let x = x0 - pitch + phase * pitch; x < x0 + len + pitch; x += pitch) {
    g.fillStyle = METAL.base;
    g.fillRect(x + pitch * 0.08, y0, pitch * 0.78, th);
    g.fillStyle = 'rgba(255,255,255,0.2)';
    g.fillRect(x + pitch * 0.08, y0, pitch * 0.2, th);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(x + pitch * 0.64, y0, pitch * 0.22, th);
    dot(g, x + pitch * 0.45, y0 + th * 0.14, th * 0.04, 'rgba(0,0,0,0.6)');
    dot(g, x + pitch * 0.45, y0 + th * 0.86, th * 0.04, 'rgba(0,0,0,0.6)');
  }
  // guard plate over the upper run
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(x0, y0, len, th * 0.14);
  g.fillRect(x0, y0 + th * 0.86, len, th * 0.14);
  g.restore();
  g.lineWidth = o * 1.1;
  g.strokeStyle = OUTLINE;
  g.stroke(band);
  // inner guard + road wheels
  const gp = new Path2D();
  roundRect(gp, x0 + len * 0.12, cy - th * 0.3, len * 0.76, th * 0.6, th * 0.15);
  const gr = g.createLinearGradient(0, cy - th * 0.3, 0, cy + th * 0.3);
  gr.addColorStop(0, shade(pal.light, -0.15)); gr.addColorStop(1, pal.dark);
  g.fillStyle = gr; g.fill(gp); g.lineWidth = o * 0.8; g.strokeStyle = OUTLINE; g.stroke(gp);
  g.strokeStyle = rgba(E, 0.85); g.lineWidth = o * 0.9;
  g.beginPath(); g.moveTo(x0 + len * 0.16, cy); g.lineTo(x0 + len * 0.84, cy); g.stroke();
  for (const f of [0.1, 0.9]) { dot(g, x0 + len * f, cy, th * 0.3, METAL.dark); dot(g, x0 + len * f, cy, th * 0.16, METAL.light); }
  for (let i = 0; i < 4; i++) dot(g, x0 + len * (0.22 + i * 0.185), cy - th * 0.2, th * 0.05, 'rgba(0,0,0,0.55)');
}

export function drawMegatracks(g: Ctx, L: UnitLayout, pal: TeamPal, phase: number, o: number): void {
  const S = L.S;
  const E = emis(pal);
  const yc = (Math.min(0.47, L.hw) + 0.085) * S, th = 0.17 * S, len = 0.42 * S;
  const xs = [0.265 * S, -0.265 * S];
  for (const s of [-1, 1]) for (const x of xs) {
    limbG(g, [x, s * yc * 0.45, x, s * yc], 0.05 * S, METAL.dark, o);
  }
  g.strokeStyle = METAL.dark; g.lineWidth = 0.06 * S;
  g.beginPath(); g.moveTo(xs[0], 0); g.lineTo(xs[1], 0); g.stroke();
  for (const s of [-1, 1]) for (const x of xs) trackUnit(g, x, s * yc, len, th, phase, pal, o, E);
}

export interface Foot { x: number; y: number; lift: number; a: number; }

/** Foot placements of titan legs for a gait phase (0..1). a = radians since touchdown. */
export function titanFeet(L: UnitLayout, phase: number, rest: boolean): Foot[] {
  const S = L.S;
  const quad = L.shape !== 'colossal' && S >= 4;
  const out: Foot[] = [];
  const stride = (quad ? 0.1 : 0.2) * S;
  const rows = quad ? [0.25, -0.25] : [0];
  const fy = (quad ? 0.4 : 0.31) * S;
  let k = 0;
  for (const row of rows) for (const s of [-1, 1]) {
    const diag = (k++ % 2 === 0) ? 0 : Math.PI;
    const ph = phase * P2 + (s > 0 ? Math.PI : 0) + diag;
    const fx = rest ? row * S + (s > 0 ? 0.03 : -0.03) * S : row * S + Math.sin(ph) * stride;
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
  const feet = titanFeet(L, phase, rest);
  const hipY = (quad ? 0.2 : 0.2) * S;
  const lw = (quad ? 0.1 : 0.14) * S;
  feet.forEach((f, i) => {
    const s = f.y < 0 ? -1 : 1;
    const row = quad ? (i < 2 ? 0.25 : -0.25) * S : 0;
    const kx = (row + f.x) * 0.5 + (quad ? 0 : 0.08 * S), ky = s * (Math.abs(f.y) + 0.07 * S);
    // thigh + shin
    limbG(g, [row, s * hipY, kx, ky, f.x, f.y], lw, METAL.base, o);
    // hydraulic piston
    g.strokeStyle = METAL.light; g.lineWidth = lw * 0.12; g.lineCap = 'round';
    g.beginPath(); g.moveTo(row + lw * 0.2, s * hipY + s * lw * 0.15); g.lineTo(kx + lw * 0.2, ky - s * lw * 0.1); g.stroke();
    // foot
    const k = 1 + f.lift * 0.2;
    const fl = (quad ? 0.22 : 0.3) * S * k, fw = (quad ? 0.15 : 0.19) * S * k;
    const fp = new Path2D();
    roundRect(fp, f.x - fl * 0.42, f.y - fw / 2, fl, fw, fw * 0.28);
    const gr = g.createLinearGradient(0, f.y - fw / 2, 0, f.y + fw / 2);
    gr.addColorStop(0, shade(METAL.base, 0.2 * f.lift + 0.1)); gr.addColorStop(1, shade(METAL.dark, 0.05));
    g.fillStyle = gr; g.fill(fp); g.lineWidth = o * 1.1; g.strokeStyle = OUTLINE; g.stroke(fp);
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = o * 0.6;
    g.beginPath();
    for (const q of [0.3, 0.6]) { g.moveTo(f.x - fl * 0.42 + fl * q, f.y - fw / 2); g.lineTo(f.x - fl * 0.42 + fl * q, f.y + fw / 2); }
    g.stroke();
    hazard(g, f.x + fl * 0.4, f.y - fw * 0.4, fl * 0.12, fw * 0.8, o * 0.6, true);
    // ankle + knee armour
    dot(g, f.x - fl * 0.05, f.y, fw * 0.3, pal.dark);
    g.lineWidth = o * 0.8; g.strokeStyle = OUTLINE; g.stroke();
    dot(g, kx, ky, lw * 0.62, shade(pal.dark, 0.1));
    g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
    dot(g, kx, ky, lw * 0.3, rgba(E, 0.9));
    dot(g, row, s * hipY, lw * 0.75, METAL.dark);
    g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
    dot(g, row, s * hipY, lw * 0.4, METAL.light);
  });
}

export function gravPods(S: number, hw: number): { x: number; y: number; r: number }[] {
  const y = (Math.min(0.46, hw) + 0.07) * S;
  const o = [
    { x: 0.3 * S, y, r: 0.115 * S }, { x: 0.3 * S, y: -y, r: 0.115 * S },
    { x: -0.3 * S, y, r: 0.115 * S }, { x: -0.3 * S, y: -y, r: 0.115 * S },
  ];
  if (S >= 4) { o.push({ x: 0, y: y + 0.02 * S, r: 0.09 * S }, { x: 0, y: -y - 0.02 * S, r: 0.09 * S }); }
  return o;
}

export function drawGravlift(g: Ctx, L: UnitLayout, pal: TeamPal, o: number): void {
  const S = L.S;
  const E = emis(pal);
  const pods = gravPods(S, L.hw);
  g.strokeStyle = METAL.dark; g.lineWidth = 0.05 * S; g.lineCap = 'round';
  g.beginPath();
  for (const p of pods) { g.moveTo(p.x * 0.4, p.y * 0.3); g.lineTo(p.x, p.y); }
  g.stroke();
  for (const p of pods) {
    dot(g, p.x, p.y, p.r * 1.25, METAL.dark); g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
    const gr = g.createRadialGradient(p.x, p.y, p.r * 0.2, p.x, p.y, p.r * 1.1);
    gr.addColorStop(0, rgba(E, 0.95)); gr.addColorStop(0.5, rgba(E, 0.4)); gr.addColorStop(1, '#10161c');
    dot(g, p.x, p.y, p.r * 1.05, gr as unknown as string);
    g.lineWidth = o * 0.8; g.strokeStyle = OUTLINE; g.stroke();
    g.strokeStyle = rgba(E, 0.9); g.lineWidth = o * 1.1;
    g.beginPath(); g.arc(p.x, p.y, p.r * 0.7, 0, P2); g.stroke();
    g.strokeStyle = METAL.light; g.lineWidth = p.r * 0.1;
    for (let i = 0; i < 6; i++) { const a = (i / 6) * P2; g.beginPath(); g.moveTo(p.x + Math.cos(a) * p.r * 1.0, p.y + Math.sin(a) * p.r * 1.0); g.lineTo(p.x + Math.cos(a) * p.r * 1.3, p.y + Math.sin(a) * p.r * 1.3); g.stroke(); }
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
  // hull lights
  if (GIANT_SHAPES.has(L.shape)) {
    for (const l of giantLights(L.shape, S)) {
      const [wx, wy] = W(l.x, l.y);
      if (l.k === 'core') {
        const a = 0.35 + 0.3 * Math.sin(t * 2.6 + seed + l.x * 3);
        g.globalAlpha = alpha * a;
        const r = l.r * sc;
        g.drawImage(glow, wx - r, wy - r, r * 2, r * 2);
        g.globalAlpha = alpha * a * 0.6;
        g.drawImage(white, wx - r * 0.3, wy - r * 0.3, r * 0.6, r * 0.6);
      } else if (l.k === 'visor') {
        const a = 0.45 + 0.35 * Math.sin(t * 1.7 + seed);
        g.globalAlpha = alpha * a;
        const r = l.r * sc;
        g.drawImage(glow, wx - r, wy - r, r * 2, r * 2);
      } else if (l.k === 'blink') {
        const on = ((t * 1.3 + seed + (l.ph ?? 0) * 0.5) % 1) < 0.18;
        if (on) {
          g.globalAlpha = alpha;
          const r = l.r * sc;
          g.drawImage(softDot(l.col ?? '#ffffff'), wx - r, wy - r, r * 2, r * 2);
        }
      } else if (l.k === 'stack') {
        // heat shimmer + exhaust wisps trailing backward
        const n = p.moving ? 4 : 2;
        for (let i = 0; i < n; i++) {
          const age = (t * (p.moving ? 1.1 : 0.6) + i / n + seed * 0.37 + l.y * 2) % 1;
          const [bx, by] = W(l.x - age * 0.28 * S, l.y + Math.sin(age * 6 + i) * 0.02 * S);
          const r = (0.03 + age * 0.09) * S * sc;
          g.globalAlpha = alpha * (1 - age) * 0.28;
          g.drawImage(softDot('rgba(255,170,90,1)'), bx - r, by - r, r * 2, r * 2);
        }
        g.globalAlpha = alpha * (0.35 + 0.2 * Math.sin(t * 9 + l.y * 5));
        const r = l.r * sc * 1.4;
        g.drawImage(softDot('rgba(255,150,70,1)'), wx - r, wy - r, r * 2, r * 2);
      }
    }
    // smoke (normal blend) from stacks
    g.globalCompositeOperation = prev;
    for (const l of giantLights(L.shape, S)) {
      if (l.k !== 'stack') continue;
      const n = p.moving ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const age = (t * (p.moving ? 0.8 : 0.45) + i / n + seed * 0.21 + l.y * 3) % 1;
        const [bx, by] = W(l.x - (0.05 + age * 0.4) * S, l.y * (1 + age * 0.6));
        const r = (0.03 + age * 0.1) * S * sc;
        g.globalAlpha = alpha * (1 - age) * 0.3;
        g.drawImage(softDot('rgba(40,40,44,1)'), bx - r, by - r, r * 2, r * 2);
      }
    }
    // radar dishes
    for (const l of giantLights(L.shape, S)) {
      if (l.k !== 'radar') continue;
      const [wx, wy] = W(l.x, l.y);
      const a = ang + t * 1.6 + seed;
      const r = l.r * sc * 0.55;
      g.globalAlpha = alpha;
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
      g.globalAlpha = alpha * (0.5 + 0.25 * pulse);
      g.drawImage(glow, wx - r * 2.1, wy - r * 2.1, r * 4.2, r * 4.2);
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
    const yc = (Math.min(0.47, L.hw) + 0.085) * S;
    for (const s of [-1, 1]) for (const sx of [0.265, -0.265]) for (let i = 0; i < 4; i++) {
      const age = (t * 1.6 + i / 4 + seed + sx * 3 + s) % 1;
      const [bx, by] = W((sx - 0.21) * S - age * 0.45 * S, s * (yc / S + (age - 0.3) * 0.12 * s) * S);
      const r = (0.04 + age * 0.12) * S * sc;
      g.globalAlpha = alpha * (1 - age) * 0.38;
      g.drawImage(softDot('rgba(150,130,100,1)'), bx - r, by - r, r * 2, r * 2);
    }
  } else if (id === 'titanlegs' && p.moving) {
    g.globalCompositeOperation = prev;
    const ph = ((p.odometer ?? 0) / L.cycle) % 1;
    for (const f of titanFeet(L, ph, false)) {
      const age = f.a / 1.7;
      if (age >= 1) continue;
      const [bx, by] = W(f.x - 0.02 * S, f.y);
      const r = (0.08 + age * 0.4) * S * sc;
      g.globalAlpha = alpha * (1 - age) * 0.55;
      g.drawImage(softDot('rgba(160,140,108,1)'), bx - r, by - r, r * 2, r * 2);
      g.strokeStyle = 'rgba(210,190,150,0.45)';
      g.lineWidth = Math.max(1.2 / px, 0.03 * S * (1 - age));
      g.globalAlpha = alpha * (1 - age) * 0.7;
      g.beginPath(); g.arc(bx, by, r * 1.2, 0, P2); g.stroke();
    }
  }
  g.globalCompositeOperation = prev;
  g.globalAlpha = alpha;
}
