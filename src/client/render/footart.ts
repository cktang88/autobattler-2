// Footprint art: chassis whose footprint is not square (ChassisDef.footprint = [w, h]: w across, h = length along
// the facing). Each frame is designed for its own proportions - long lances, land-trains, battleships, wide wedges,
// flying wings, real aircraft - in a droid-army shape grammar: bulbous pods and orb bodies, big single wheels and hoop
// wheels, long thin legs, radial and asymmetric layouts, spinal cannons; one faction family in one material set.
//
// Coordinates: hull outlines are drawn in a unit box (u along the length, v across, both -0.5..0.5) and stretched to
// X (length) x Y (width) cells; details work in u/v fractions for positions and absolute cells for radii / strokes,
// so features stay round and crisp however the box is stretched. Local frame: nose +x, +y right.

import { METAL, OUTLINE, mirrorPoly, rgba, roundRect, shade, type Ctx, type TeamPal } from './palette.ts';
import { bevel, dot, emis, fxHooks, glowLine, grille, hazard, lamp, merlons, raised, reactor, recess, rivetRow, seam, stack, type GLight } from './giantart.ts';
import {
  beam, buildParts, cables, canister, creatureHooks, fillOut, joint as cjoint, lens, piston, profilePath, sleekShell, seamGlow, floatGap, visor,
  type CLight, type LegRig, type PartDef,
} from './creatures.ts';
import type { UnitLayout } from './unitart.ts';

const P2 = Math.PI * 2;

type Pt = [number, number];
interface Spec {
  /** hull half width, fraction of Y */
  hw: number;
  /** hardpoints, fractions of (X, Y); part-riding ones are overwritten from the part's weapon point */
  mounts: Pt[];
  /** turret scale per hardpoint (one value = all) */
  scale?: number[];
  /** extra sprite half-extent, multiples of S (legs / rotors reaching past the footprint) */
  extPad?: number;
  /** hull outline in the unit box */
  hull: () => Path2D;
  rotors?: (X: number, Y: number, S: number, heavy: boolean) => { x: number; y: number; r: number; blades: number }[];
  nozzles?: (X: number, Y: number, S: number) => { x: number; y: number; w: number }[];
}

/* ------------------------------------------------------------------------------------------- outline kit */

const sharpU = (half: number[]): Path2D => { const p = new Path2D(); const q = mirrorPoly(half); for (let i = 0; i < q.length; i += 2) i ? p.lineTo(q[i], q[i + 1]) : p.moveTo(q[i], q[i + 1]); p.closePath(); return p; };
const smoothU = (prof: number[]): Path2D => profilePath(prof, 1);
const union = (...ps: Path2D[]): Path2D => { const p = new Path2D(); for (const q of ps) p.addPath(q); return p; };
// union parts must share one winding (nonzero fill): mirrored outlines run nose -> port -> tail -> starboard, so
// ellipses are traced anticlockwise and rects are built mirrored in y
const ellU = (x: number, y: number, rx: number, ry: number): Path2D => { const p = new Path2D(); p.ellipse(x, y, rx, ry, 0, 0, P2, true); return p; };
const rectU = (x0: number, y0: number, x1: number, y1: number, r = 0.02): Path2D => { const q = new Path2D(); roundRect(q, x0, -y1, x1 - x0, y1 - y0, r); const p = new Path2D(); p.addPath(q, new DOMMatrix([1, 0, 0, -1, 0, 0])); return p; };

/* ------------------------------------------------------------------------------------------- detail kit */

class K {
  X: number; Y: number; S: number; E: string; t: number; m: number;
  g: Ctx; L: UnitLayout; pal: TeamPal; o: number;
  constructor(g: Ctx, L: UnitLayout, pal: TeamPal, o: number) {
    this.g = g; this.L = L; this.pal = pal; this.o = o;
    this.X = L.X; this.Y = L.Y; this.S = L.S; this.E = emis(pal); this.t = o * 0.5; this.m = Math.min(L.X, L.Y);
  }
  x(u: number): number { return u * this.X; }
  y(v: number): number { return v * this.Y; }
  A(pts: number[]): number[] { return pts.map((v, i) => (i % 2 ? v * this.Y : v * this.X)); }
  P(pts: number[]): Path2D { const p = new Path2D(); for (let i = 0; i < pts.length; i += 2) { const x = pts[i] * this.X, y = pts[i + 1] * this.Y; i ? p.lineTo(x, y) : p.moveTo(x, y); } p.closePath(); return p; }
  M(half: number[]): Path2D { return this.P(mirrorPoly(half)); }
  /** smooth mirrored body from a [u, halfwidth-v] profile */
  B(prof: number[]): Path2D { const p = new Path2D(); p.addPath(profilePath(prof, 1), new DOMMatrix([this.X, 0, 0, this.Y, 0, 0])); return p; }
  /** rounded rect centred at (u, v), size du x dv (fractions), corner radius r (cells) */
  R(u: number, v: number, du: number, dv: number, r = 0.05): Path2D { const p = new Path2D(); const w = du * this.X, h = dv * this.Y; roundRect(p, u * this.X - w / 2, v * this.Y - h / 2, w, h, Math.min(r, w / 2, h / 2)); return p; }
  /** rounded rect centred at (u, v) with absolute size (cells) */
  Ra(u: number, v: number, w: number, h: number, r = 0.04): Path2D { const p = new Path2D(); roundRect(p, u * this.X - w / 2, v * this.Y - h / 2, w, h, Math.min(r, w / 2, h / 2)); return p; }
  C(u: number, v: number, r: number): Path2D { const p = new Path2D(); p.arc(u * this.X, v * this.Y, r, 0, P2); return p; }
  Oct(u: number, v: number, r: number): Path2D { const p = new Path2D(); for (let i = 0; i < 8; i++) { const a = (i / 8) * P2 + P2 / 16; p.lineTo(u * this.X + Math.cos(a) * r, v * this.Y + Math.sin(a) * r); } p.closePath(); return p; }
  gr(u0: number, v0: number, u1: number, v1: number, c0: string, c1: string): CanvasGradient {
    const gr = this.g.createLinearGradient(u0 * this.X, v0 * this.Y, u1 * this.X, v1 * this.Y); gr.addColorStop(0, c0); gr.addColorStop(1, c1); return gr;
  }
  /** team-armour raised panel lit from the top-left of its own bbox (u0..u1, v0..v1) */
  plate(p: Path2D, u0: number, v0: number, u1: number, v1: number, tone = 0, depth = 1.2): void {
    raised(this.g, p, this.gr(u0, v0, u1, v1, shade(this.pal.light, -0.02 + tone), shade(this.pal.dark, -0.04 + tone * 0.5)), this.o, this.S, depth, 0.018, 0.6);
  }
  metal(p: Path2D, u0: number, v0: number, u1: number, v1: number, depth = 1): void {
    raised(this.g, p, this.gr(u0, v0, u1, v1, METAL.light, METAL.dark), this.o, this.S, depth, 0.012, 0.5);
  }
  dark(p: Path2D, u0: number, v0: number, u1: number, v1: number, depth = 1): void {
    raised(this.g, p, this.gr(u0, v0, u1, v1, shade(this.pal.dark, 0.18), this.pal.deep), this.o, this.S, depth, 0.015, 0.6);
  }
  seam(pts: number[], w = this.t, col?: string): void { seam(this.g, this.A(pts), 1, w, col); }
  glow(pts: number[], w = this.o * 0.9, a = 1): void { glowLine(this.g, this.A(pts), 1, this.E, w, a); }
  stripe(pts: number[], w = this.o * 1.1, col = this.pal.accent): void {
    const g = this.g, q = this.A(pts);
    g.lineCap = 'round'; g.strokeStyle = col; g.lineWidth = w; g.beginPath();
    for (let i = 0; i < q.length; i += 4) { g.moveTo(q[i], q[i + 1]); g.lineTo(q[i + 2], q[i + 3]); }
    g.stroke();
  }
  rivets(u0: number, v0: number, u1: number, v1: number, n: number, r = 0.012 * this.S): void { rivetRow(this.g, u0 * this.X, v0 * this.Y, u1 * this.X, v1 * this.Y, n, r); }
  haz(u: number, v: number, w: number, h: number, vert = false): void { hazard(this.g, u * this.X - w / 2, v * this.Y - h / 2, w, h, this.o, vert); }
  lamp(u: number, v: number, r: number, c = '#fff3c4'): void { lamp(this.g, u * this.X, v * this.Y, r, c); }
  dot(u: number, v: number, r: number, c: string | CanvasGradient): void { dot(this.g, u * this.X, v * this.Y, r, c); }
  eye(u: number, v: number, r: number): void { lens(this.g, u * this.X, v * this.Y, r, this.E); }
  visor(u0: number, v0: number, u1: number, v1: number, w: number): void { visor(this.g, u0 * this.X, v0 * this.Y, u1 * this.X, v1 * this.Y, w, this.E, this.o); }
  reactor(u: number, v: number, r: number): void { reactor(this.g, u * this.X, v * this.Y, r, this.o, this.E); }
  grille(u: number, v: number, w: number, h: number, n = 5, hot = 0.6): void { grille(this.g, u * this.X, v * this.Y, w, h, n, this.o, this.E, hot); }
  stack(u: number, v: number, r: number): void { stack(this.g, u * this.X, v * this.Y, r, this.o); }
  recess(p: Path2D, fill?: string): void { recess(this.g, p, this.o, fill); }
  /** fixed barrel (cells): from (u, v) forward, length len, radius r */
  barrel(u: number, v: number, len: number, r: number): void {
    const g = this.g, x = u * this.X, y = v * this.Y;
    const p = new Path2D(); roundRect(p, x, y - r, len, r * 2, r * 0.5);
    g.fillStyle = OUTLINE; g.save(); g.translate(this.o * 0.5, this.o); g.fill(p); g.restore();
    const gr = g.createLinearGradient(0, y - r, 0, y + r); gr.addColorStop(0, METAL.light); gr.addColorStop(0.5, METAL.base); gr.addColorStop(1, METAL.deep);
    g.fillStyle = gr; g.fill(p); g.lineWidth = this.o * 0.7; g.strokeStyle = OUTLINE; g.stroke(p);
    dot(g, x + len - r * 0.4, y, r * 0.55, '#07080a');
    g.fillStyle = METAL.dark; g.fillRect(x + len * 0.7, y - r * 1.25, len * 0.08, r * 2.5);
  }
  /** bulbous droid pod: shaded capsule along x from u0 to u1 at v, half-width r (cells) */
  pod(u0: number, u1: number, v: number, r: number, tone = 0): Path2D {
    const g = this.g, x0 = u0 * this.X, x1 = u1 * this.X, y = v * this.Y;
    const p = new Path2D(); roundRect(p, Math.min(x0, x1), y - r, Math.abs(x1 - x0), r * 2, r);
    raised(g, p, this.gr(u0, v - r / this.Y, u1, v + r / this.Y, shade(this.pal.light, 0.06 + tone), shade(this.pal.dark, -0.06 + tone * 0.5)), this.o, this.S, 1.3, 0.02, 0.65);
    g.save(); g.clip(p);
    g.fillStyle = 'rgba(255,255,255,0.16)'; g.beginPath(); g.ellipse((x0 + x1) / 2 - r * 0.1, y - r * 0.4, Math.abs(x1 - x0) * 0.38, r * 0.3, 0, 0, P2); g.fill();
    g.restore();
    return p;
  }
  /** droid canopy dome / bubble turret glass */
  dome(u: number, v: number, rx: number, ry: number): void {
    const g = this.g, x = u * this.X, y = v * this.Y;
    g.save(); g.translate(this.o * 0.6, this.o); g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, P2); g.fill(); g.restore();
    const gr = g.createRadialGradient(x - rx * 0.35, y - ry * 0.35, 0, x, y, Math.max(rx, ry));
    gr.addColorStop(0, '#e8fbff'); gr.addColorStop(0.25, rgba(this.E, 0.85)); gr.addColorStop(0.7, '#123040'); gr.addColorStop(1, '#071018');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, P2); g.fill();
    g.lineWidth = this.o * 0.8; g.strokeStyle = OUTLINE; g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = this.o * 0.5;
    g.beginPath(); g.moveTo(x - rx, y); g.lineTo(x + rx, y); g.moveTo(x, y - ry); g.lineTo(x, y + ry); g.stroke();
  }
  /** aircraft canopy: elongated glass with a frame bow */
  canopy(u: number, v: number, len: number, w: number): void {
    const g = this.g, x = u * this.X, y = v * this.Y;
    const p = new Path2D(); p.ellipse(x, y, len / 2, w / 2, 0, 0, P2);
    g.fillStyle = '#0e1c26'; g.fill(p); g.lineWidth = this.o * 0.8; g.strokeStyle = OUTLINE; g.stroke(p);
    g.save(); g.clip(p);
    const gr = g.createLinearGradient(x - len / 2, y - w / 2, x + len / 2, y + w / 2);
    gr.addColorStop(0, rgba(this.pal.glow, 0.15)); gr.addColorStop(0.4, rgba(this.pal.glow, 0.65)); gr.addColorStop(0.55, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.7, rgba(this.pal.glow, 0.25));
    g.fillStyle = gr; g.fillRect(x - len / 2, y - w / 2, len, w * 0.45);
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = this.o * 0.5; g.beginPath(); g.moveTo(x - len * 0.12, y - w / 2); g.lineTo(x - len * 0.12, y + w / 2); g.stroke();
    g.restore();
  }
  /** aircraft vertical fin seen from above: thin swept blade */
  fin(u: number, v: number, len: number, lean: number): void {
    const g = this.g, x = u * this.X, y = v * this.Y;
    const p = new Path2D(); p.moveTo(x + len * 0.5, y); p.lineTo(x - len * 0.5, y + lean); p.lineTo(x - len * 0.55, y + lean + this.S * 0.025); p.lineTo(x + len * 0.15, y + this.S * 0.02); p.closePath();
    g.save(); g.translate(this.o, this.o * 1.6); g.fillStyle = 'rgba(0,0,0,0.4)'; g.fill(p); g.restore();
    bevel(g, p, shade(this.pal.light, -0.05), this.o, 0.6);
  }
  /** intake mouth */
  intake(u: number, v: number, w: number, h: number): void {
    const g = this.g, x = u * this.X, y = v * this.Y;
    const p = new Path2D(); roundRect(p, x - w / 2, y - h / 2, w, h, h * 0.4);
    g.fillStyle = '#05070a'; g.fill(p); g.lineWidth = this.o * 0.7; g.strokeStyle = OUTLINE; g.stroke(p);
    g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = this.o * 0.4; g.beginPath(); g.moveTo(x + w / 2 - this.o, y - h * 0.35); g.lineTo(x + w / 2 - this.o, y + h * 0.35); g.stroke();
  }
  /** engine can: dark nozzle with a hot core, opening rearward at (u, v) */
  engine(u: number, v: number, len: number, r: number): void {
    const g = this.g, x = u * this.X, y = v * this.Y;
    const p = new Path2D(); roundRect(p, x, y - r, len, r * 2, r * 0.7);
    g.fillStyle = METAL.dark; g.fill(p); g.lineWidth = this.o; g.strokeStyle = OUTLINE; g.stroke(p);
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(x + len * 0.15, y - r * 0.7, len * 0.7, r * 0.3);
    dot(g, x + r * 0.35, y, r * 0.62, '#07080a');
    dot(g, x + r * 0.35, y, r * 0.34, 'rgba(255,140,60,0.8)');
  }
  /** hangar / bay door slot */
  bay(u: number, v: number, du: number, dv: number): void {
    const p = this.R(u, v, du, dv, 0.02);
    this.recess(p, shade(this.pal.deep, 0.1));
    this.seam([u - du / 2, v, u + du / 2, v], this.o * 0.6);
  }
}

/* ------------------------------------------------------------------------------------------- the frames */

const SPECS: Record<string, Spec> = {
  // ---- longarm: lance gun-carriage. A spinal coil-gun channel runs the whole hull to a muzzle-brake prow; the heavy
  //      turret sits far aft, the reactor bulb behind it, folding jack legs off both flanks.
  long: {
    hw: 0.36, mounts: [[-0.17, 0]], scale: [1.05],
    hull: () => sharpU([0.5, 0, 0.49, -0.12, 0.44, -0.17, 0.36, -0.14, 0.18, -0.17, 0.08, -0.25, 0.02, -0.38, -0.08, -0.44, -0.28, -0.44, -0.36, -0.36, -0.4, -0.26, -0.46, -0.3, -0.5, -0.2, -0.49, 0]),
  },
  // ---- striker: assault hover-tank wedge (AAT grammar) - knife prow, two fat side pods carrying the guns forward
  cross: {
    hw: 0.48, mounts: [[0.0, -0.33], [0.0, 0.33], [0.3, 0]],
    hull: () => sharpU([0.5, 0, 0.45, -0.06, 0.3, -0.14, 0.24, -0.18, 0.3, -0.27, 0.27, -0.42, 0.18, -0.49, -0.16, -0.49, -0.24, -0.42, -0.26, -0.2, -0.42, -0.24, -0.5, -0.16, -0.5, 0]),
  },
  // ---- gunship: attack helicopter - stepped tandem cockpit, stub wings with bubble-turret pods, long tail boom
  airframe: {
    hw: 0.18, mounts: [[0.04, -0.37], [0.04, 0.37]], scale: [0.9],
    hull: () => union(
      smoothU([0.5, 0, 0.48, 0.07, 0.42, 0.12, 0.3, 0.15, 0.12, 0.17, 0.0, 0.15, -0.1, 0.09, -0.2, 0.045, -0.42, 0.035, -0.47, 0.03, -0.5, 0]),
      sharpU([0.14, -0.04, 0.12, -0.3, 0.1, -0.44, -0.02, -0.44, -0.04, -0.3, -0.06, -0.04]),
      sharpU([-0.36, -0.02, -0.4, -0.17, -0.45, -0.17, -0.46, -0.02]),
    ),
    rotors: (X, Y, S) => [{ x: 0.08 * X, y: 0, r: 0.49 * Y, blades: 4 }, { x: -0.47 * X, y: 0.07 * Y, r: 0.12 * S, blades: 2 }],
  },
  // ---- delta wing: tailless delta with a long nose, canopy, twin canted fins and a pair of engines in the tail
  delta: {
    hw: 0.42, mounts: [[0.12, 0], [-0.22, -0.28], [-0.22, 0.28]], scale: [0.85, 0.75, 0.75],
    hull: () => sharpU([0.5, 0, 0.44, -0.035, 0.32, -0.06, 0.18, -0.09, 0.08, -0.14, -0.3, -0.49, -0.38, -0.49, -0.37, -0.32, -0.43, -0.2, -0.46, -0.1, -0.5, -0.08, -0.5, 0]),
    nozzles: (X, Y, S) => [-1, 1].map((s) => ({ x: -0.5 * X, y: s * 0.045 * Y, w: 0.075 * S })),
  },
  // ---- interceptor: split-wing dart (vulture grammar) - needle fuselage, forward canards, two blade wings a side
  interceptor: {
    hw: 0.46, mounts: [[-0.06, -0.3], [-0.06, 0.3]], scale: [0.85],
    hull: () => sharpU([0.5, 0, 0.42, -0.04, 0.3, -0.06, 0.26, -0.18, 0.21, -0.18, 0.18, -0.08, 0.06, -0.1, -0.08, -0.48, -0.17, -0.48, -0.14, -0.13, -0.3, -0.12, -0.44, -0.38, -0.5, -0.36, -0.44, -0.08, -0.5, -0.06, -0.5, 0]),
    nozzles: (X, _Y, S) => [{ x: -0.5 * X, y: 0, w: 0.09 * S }],
  },
  // ---- strike jet: twin-engine, twin-tail multirole fighter - LERX, trapezoid wings, all-moving tailplanes
  strikejet: {
    hw: 0.48, mounts: [[0.06, 0], [-0.1, -0.33], [-0.1, 0.33]], scale: [0.85, 0.72, 0.72],
    hull: () => sharpU([0.5, 0, 0.44, -0.035, 0.33, -0.06, 0.22, -0.08, 0.14, -0.13, 0.04, -0.16, -0.04, -0.48, -0.14, -0.49, -0.18, -0.17, -0.3, -0.15, -0.36, -0.36, -0.46, -0.36, -0.44, -0.12, -0.5, -0.1, -0.5, 0]),
    nozzles: (X, Y, S) => [-1, 1].map((s) => ({ x: -0.5 * X, y: s * 0.05 * Y, w: 0.07 * S })),
  },
  // ---- strato bomber: swing-wing strategic bomber - full-length fuselage, wings swept to the footprint corners,
  //      four podded engines, T-tail; three bay turrets down the spine and a tail gun
  stratobomber: {
    hw: 0.5, mounts: [[0.28, 0], [0.08, 0], [-0.22, 0], [-0.46, 0]], scale: [0.72, 0.72, 0.72, 0.7],
    hull: () => sharpU([0.5, 0, 0.46, -0.035, 0.38, -0.06, 0.2, -0.075, 0.12, -0.12, -0.12, -0.5, -0.21, -0.5, -0.12, -0.2, -0.18, -0.075, -0.34, -0.065, -0.4, -0.22, -0.49, -0.22, -0.47, -0.05, -0.5, -0.03, -0.5, 0]),
    nozzles: (X, Y, S) => [-1, 1].flatMap((s) => [{ x: -0.13 * X, y: s * 0.2 * Y, w: 0.06 * S }, { x: -0.2 * X, y: s * 0.32 * Y, w: 0.06 * S }]),
  },
  // ---- heavy helicopter: tandem-rotor hauler - long box fuselage, raised rotor pylons fore and aft, fuel sponsons
  heavyheli: {
    hw: 0.3, mounts: [[0.42, 0], [-0.02, 0.36], [-0.02, -0.36]], scale: [0.9, 0.85, 0.85],
    hull: () => union(
      smoothU([0.5, 0, 0.49, 0.1, 0.45, 0.2, 0.38, 0.24, -0.3, 0.24, -0.42, 0.22, -0.48, 0.16, -0.5, 0]),
      rectU(-0.22, -0.4, 0.18, 0.4, 0.06),
    ),
    rotors: (X, Y) => [{ x: 0.27 * X, y: 0, r: 0.5 * Y, blades: 3 }, { x: -0.27 * X, y: 0, r: 0.5 * Y, blades: 3 }],
  },
  // ---- heavy bomber (grav lift): lifting-body bomb truck - fat fuselage, straight high wing with lifter nacelles at
  //      the tips, twin-boom H-tail
  bomber: {
    hw: 0.5, mounts: [[0.33, 0], [0.0, -0.3], [0.0, 0.3]], scale: [0.85],
    hull: () => union(
      smoothU([0.5, 0, 0.49, 0.08, 0.44, 0.14, 0.3, 0.17, -0.1, 0.17, -0.3, 0.12, -0.42, 0.06, -0.46, 0]),
      sharpU([0.12, -0.12, 0.1, -0.48, 0.04, -0.5, -0.1, -0.5, -0.12, -0.12]),
      sharpU([-0.08, -0.15, -0.38, -0.2, -0.44, -0.36, -0.5, -0.36, -0.5, -0.16, -0.36, -0.05, -0.36, 0]),
    ),
    rotors: (X, Y) => [-1, 1].map((s) => ({ x: 0.0 * X, y: s * 0.38 * Y, r: 0.12 * Y, blades: 3 })),
  },
  // ---- sky carrier: a giant flying wing - manta planform spanning six cells, hangar decks out on both wings,
  //      a command island off the centreline
  carrier: {
    hw: 0.5, mounts: [[0.24, 0], [-0.2, 0.0], [-0.1, -0.33], [-0.1, 0.33]],
    hull: () => sharpU([0.5, 0, 0.47, -0.04, 0.38, -0.07, 0.26, -0.12, 0.05, -0.44, -0.04, -0.5, -0.22, -0.5, -0.28, -0.44, -0.22, -0.34, -0.36, -0.22, -0.5, -0.2, -0.46, -0.1, -0.5, 0]),
  },
  // ---- leviathan: land battleship - clipper bow, superfiring giant turrets fore and aft, bridge tower amidships
  leviathan: {
    hw: 0.44, mounts: [[0.29, 0], [-0.3, 0], [0.0, -0.3], [0.0, 0.3]],
    hull: () => sharpU([0.5, 0, 0.47, -0.06, 0.4, -0.18, 0.3, -0.31, 0.18, -0.42, 0.04, -0.46, -0.32, -0.46, -0.4, -0.42, -0.47, -0.34, -0.5, -0.2, -0.48, -0.08, -0.5, 0]),
  },
  // ---- goliath: rolling assault fortress - a sloped glacis wall, stepped sponsons with the heavy guns, a command
  //      tower behind the giant gun, armoured engine block astern
  goliath: {
    hw: 0.42, mounts: [[0.15, 0], [-0.1, -0.31], [-0.1, 0.31], [-0.34, 0]],
    hull: () => sharpU([0.5, 0, 0.48, -0.09, 0.42, -0.17, 0.36, -0.26, 0.38, -0.34, 0.32, -0.46, -0.12, -0.46, -0.16, -0.36, -0.3, -0.36, -0.34, -0.43, -0.46, -0.43, -0.5, -0.32, -0.5, 0]),
  },
  // ---- colossus: long-bodied walker (AT-TE / AT-AT grammar) - armoured head pod on a neck, long segmented body
  titan: {
    hw: 0.42, mounts: [[0.02, -0.3], [0.02, 0.3], [0.41, 0], [-0.34, 0]],
    hull: () => union(
      smoothU([0.5, 0, 0.49, 0.1, 0.45, 0.15, 0.38, 0.15, 0.34, 0.09, 0.3, 0.06, 0.26, 0.06, 0.24, 0]),
      sharpU([0.26, 0, 0.25, -0.14, 0.2, -0.4, 0.1, -0.42, 0.06, -0.35, -0.04, -0.35, -0.08, -0.42, -0.22, -0.42, -0.26, -0.35, -0.36, -0.35, -0.4, -0.41, -0.47, -0.32, -0.49, -0.14, -0.48, 0]),
    ),
  },
  // ---- mantis: lanky insect skirmisher - slim thorax, raised head, long abdomen; cutter arms ride the forelimbs
  mantis: {
    hw: 0.24, mounts: [[0.3, -0.3], [0.3, 0.3]], scale: [0.72], extPad: 0.15,
    hull: () => smoothU([0.5, 0, 0.48, 0.11, 0.43, 0.18, 0.36, 0.15, 0.3, 0.08, 0.18, 0.09, 0.05, 0.1, -0.04, 0.12, -0.14, 0.22, -0.3, 0.27, -0.44, 0.2, -0.5, 0]),
  },
  // ---- crab: wide, low scuttling bunker (crab-droid grammar) - a broad shell with a sensor brow, claws out front
  crab: {
    hw: 0.46, mounts: [[0.3, -0.4], [0.3, 0.4], [-0.08, 0]], scale: [0.75], extPad: 0.15,
    hull: () => sharpU([0.38, 0, 0.37, -0.08, 0.32, -0.14, 0.33, -0.22, 0.27, -0.3, 0.26, -0.38, 0.17, -0.4, 0.12, -0.47, 0.02, -0.44, -0.06, -0.49, -0.14, -0.44, -0.24, -0.46, -0.3, -0.37, -0.38, -0.33, -0.42, -0.2, -0.46, -0.12, -0.43, 0]),
  },
  // ---- warlord: broad-shouldered heavy mech - wide yoke, a hunched cockpit head, reactor backpack
  warlord: {
    hw: 0.48, mounts: [[-0.06, -0.3], [0.3, 0.38], [0.3, -0.38], [-0.33, 0]], scale: [0.9],
    hull: () => sharpU([0.36, 0, 0.35, -0.05, 0.3, -0.09, 0.26, -0.18, 0.16, -0.26, 0.1, -0.44, -0.08, -0.47, -0.2, -0.42, -0.26, -0.24, -0.38, -0.2, -0.46, -0.11, -0.46, 0]),
  },
  // ---- scorpion: long armoured crawler - pincers forward, a tail of modules arching over the back to the heavy gun
  scorpion: {
    hw: 0.32, mounts: [[-0.33, -0.27], [0.47, -0.3], [0.47, 0.3]], scale: [0.72, 0.8, 0.8], extPad: 0.1,
    hull: () => sharpU([0.36, 0, 0.34, -0.09, 0.28, -0.18, 0.2, -0.22, 0.17, -0.31, 0.06, -0.28, 0.0, -0.33, -0.08, -0.28, -0.14, -0.33, -0.22, -0.27, -0.28, -0.22, -0.31, -0.1, -0.3, 0]),
  },
  // ---- centipede: articulated land-train (AT-TE grammar) - a cab and five armoured cars coupled down its length
  centipede: {
    hw: 0.3, mounts: [[0.2, 0], [0.04, 0], [-0.12, 0], [-0.28, 0]], scale: [0.78],
    hull: () => sharpU([0.5, 0, 0.49, -0.12, 0.46, -0.22, 0.41, -0.28, 0.35, -0.26, 0.32, -0.12, 0.31, 0]),
  },
  // ---- broodmother: orb walker (homing-spider grammar) - a huge armoured sphere slung between long legs, a prow cab
  broodmother: {
    hw: 0.42, extPad: 0.3, mounts: [[-0.06, 0], [0.34, 0], [-0.08, -0.24], [-0.08, 0.24], [-0.38, 0]],
    hull: () => union(ellU(-0.06, 0, 0.42, 0.4), smoothU([0.5, 0, 0.49, 0.06, 0.44, 0.1, 0.32, 0.11, 0.24, 0.1, 0.2, 0])),
  },
  // ---- arachne: titan orb spider (dwarf-spider grammar) - a great sphere around a central titan cannon on eight
  //      needle legs, cab forward
  arachne: {
    hw: 0.38, extPad: 0.3, mounts: [[-0.06, 0], [0.22, -0.16], [0.22, 0.16], [-0.38, 0]],
    hull: () => union(ellU(-0.06, 0, 0.4, 0.36), smoothU([0.5, 0, 0.49, 0.06, 0.45, 0.1, 0.34, 0.12, 0.26, 0.1, 0.22, 0])),
  },
  // ---- riot: wide crown-wedge (hover-tank grammar) - a knife prow flanked by two forward tusk pods with fixed
  //      blasters, crew bunker behind, gun sponsons on the shoulders
  riot: {
    hw: 0.36, mounts: [[-0.12, -0.2], [-0.12, 0.2]],
    hull: () => sharpU([0.5, 0, 0.42, -0.06, 0.26, -0.15, 0.22, -0.22, 0.34, -0.29, 0.5, -0.35, 0.47, -0.46, 0.3, -0.5, 0.06, -0.5, 0.0, -0.38, -0.3, -0.38, -0.42, -0.32, -0.5, -0.18, -0.46, 0]),
  },
  // ---- juggernaut: troop-carrier wall (MTT grammar) - a hammerhead dome face as wide as the hull, a pinched neck,
  //      ribbed body with side ear-sponsons, narrow engine tail with twin fins
  juggernaut: {
    hw: 0.4, mounts: [[-0.14, 0], [-0.3, 0.2]], scale: [0.9],
    hull: () => smoothU([0.5, 0, 0.49, 0.17, 0.45, 0.33, 0.37, 0.46, 0.27, 0.49, 0.17, 0.44, 0.1, 0.27, 0.02, 0.24, -0.06, 0.3, -0.12, 0.47, -0.26, 0.49, -0.33, 0.36, -0.38, 0.22, -0.44, 0.32, -0.5, 0.3, -0.5, 0]),
  },
  // ---- siege platform: spinal artillery flatbed (SPHA-T grammar) - tandem heavy guns on a long open deck, four
  //      outrigger jacks, power plant astern
  siegeplat: {
    hw: 0.36, mounts: [[0.2, 0], [-0.16, 0]],
    hull: () => sharpU([0.5, 0, 0.48, -0.12, 0.4, -0.2, 0.31, -0.22, 0.29, -0.33, 0.09, -0.33, 0.05, -0.25, -0.05, -0.25, -0.09, -0.34, -0.36, -0.34, -0.44, -0.28, -0.5, -0.16, -0.5, 0]),
  },
  // ---- hunter: slim skirmisher dart - knife nose, swept fins, a spine of armour; rolls on hoop wheels
  hunter: {
    hw: 0.3, mounts: [[0.12, 0], [-0.3, 0]], scale: [0.85],
    hull: () => sharpU([0.5, 0, 0.36, -0.1, 0.16, -0.17, 0.06, -0.38, -0.06, -0.4, -0.12, -0.2, -0.34, -0.2, -0.42, -0.34, -0.5, -0.3, -0.48, 0]),
  },
  // ---- titan walker: colossal humanoid war machine, broad as it is long - forearm weapon pods, pauldrons
  colossal: {
    hw: 0.48, mounts: [[0.14, 0.38], [0.14, -0.38], [-0.12, -0.17], [-0.12, 0.17], [-0.36, 0]],
    hull: () => sharpU([0.32, 0, 0.31, -0.05, 0.26, -0.09, 0.22, -0.2, 0.12, -0.28, 0.06, -0.47, -0.16, -0.48, -0.26, -0.3, -0.34, -0.16, -0.42, -0.12, -0.46, -0.05, -0.45, 0]),
  },
  // ---- citadel: mobile star fort - curtain walls, corner bastions, keep and gatehouse on a 6 x 5 footprint
  citadel: {
    hw: 0.5, mounts: [[0.24, -0.25], [0.24, 0.25], [-0.17, 0], [-0.385, -0.385], [-0.385, 0.385], [0.385, -0.385]],
    hull: () => sharpU([0.48, 0, 0.48, -0.08, 0.43, -0.12, 0.43, -0.26, 0.47, -0.31, 0.52, -0.385, 0.385, -0.52, 0.31, -0.47, 0.2, -0.45, 0.1, -0.45, 0.06, -0.41, -0.06, -0.41, -0.1, -0.45, -0.2, -0.45, -0.31, -0.47, -0.385, -0.52, -0.52, -0.385, -0.47, -0.31, -0.45, -0.2, -0.48, -0.12, -0.48, 0]),
  },
};

export const FOOT: Record<string, Spec> = SPECS;

const hullCache = new Map<string, Path2D>();
export function footHullPath(shape: string): Path2D | null {
  const sp = SPECS[shape];
  if (!sp) return null;
  let p = hullCache.get(shape);
  if (!p) { p = sp.hull(); hullCache.set(shape, p); }
  return p;
}

/* ------------------------------------------------------------------------------------------- underlay */

/** Under the hull paint (part of the hull sprite): jacks, outriggers, wing roots, boom tails, necks. */
export function footUnderlay(g: Ctx, L: UnitLayout, pal: TeamPal, o: number): boolean {
  if (!SPECS[L.shape]) return false;
  const k = new K(g, L, pal, o), S = L.S;
  const jack = (u0: number, v0: number, u1: number, v1: number, w: number) => {
    beam(g, k.x(u0), k.y(v0), w, k.x(u1), k.y(v1), w * 0.8, shade(pal.dark, 0.08), pal.deep, o);
    const pr = w * 1.6;
    dot(g, k.x(u1), k.y(v1), pr, METAL.dark); g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
    g.strokeStyle = 'rgba(232,184,28,0.8)'; g.lineWidth = o * 0.8; g.beginPath(); g.arc(k.x(u1), k.y(v1), pr * 0.68, 0, P2); g.stroke();
    dot(g, k.x(u1), k.y(v1), pr * 0.28, METAL.light);
  };
  switch (L.shape) {
    case 'long':
      for (const s of [-1, 1]) { jack(0.24, s * 0.14, 0.3, s * 0.44, 0.045 * S); jack(-0.3, s * 0.3, -0.4, s * 0.46, 0.045 * S); }
      break;
    case 'siegeplat':
      for (const sx of [-1, 1]) for (const s of [-1, 1]) jack(sx * 0.3, s * 0.26, sx * 0.4, s * 0.48, 0.05 * S);
      break;
    case 'titan':
      // neck
      beam(g, k.x(0.2), 0, 0.12 * S, k.x(0.36), 0, 0.09 * S, METAL.light, METAL.dark, o);
      break;
    case 'centipede':
      // coupling spine under the cars
      beam(g, k.x(-0.48), 0, 0.06 * S, k.x(0.34), 0, 0.06 * S, METAL.base, METAL.deep, o);
      break;
    case 'broodmother': case 'arachne':
      // waist yoke from the cab into the orb
      beam(g, k.x(0.1), 0, 0.09 * S, k.x(0.3), 0, 0.07 * S, METAL.base, METAL.deep, o);
      break;
    case 'crab':
      for (const s of [-1, 1]) beam(g, k.x(0.22), k.y(s * 0.08), 0.03 * S, k.x(0.42), k.y(s * 0.12), 0.022 * S, METAL.light, METAL.dark, o);
      break;
  }
  return true;
}

/* ------------------------------------------------------------------------------------------- details */

export function footDetails(g: Ctx, L: UnitLayout, pal: TeamPal, o: number): boolean {
  const fn = DETAILS[L.shape];
  if (!fn || !SPECS[L.shape]) return false;
  fn(new K(g, L, pal, o));
  return true;
}

const DETAILS: Record<string, (k: K) => void> = {
  long(k) {
    const S = k.S, g = k.g;
    // reactor bulb astern of the turret
    k.pod(-0.5, -0.3, 0, 0.3, -0.04);
    k.reactor(-0.42, 0, 0.09 * S);
    for (const s of [-1, 1]) k.stack(-0.34, s * 0.3, 0.045 * S);
    // turntable collar
    k.metal(k.C(-0.17, 0, 0.36), -0.27, -0.4, -0.07, 0.4, 1.1);
    k.seam([-0.17, -0.36, -0.17, 0.36]);
    // spinal coil-gun channel: recessed rail running to the prow with glowing coil bands
    const ch = k.R(0.18, 0, 0.6, 0.16, 0.03);
    k.recess(ch, '#0b0f13');
    for (let u = -0.08; u < 0.46; u += 0.065) {
      g.fillStyle = METAL.dark; g.fillRect(k.x(u) - 0.035, -k.y(0.11), 0.07, k.y(0.22));
      g.fillStyle = rgba(k.E, 0.8); g.fillRect(k.x(u) - 0.012, -k.y(0.08), 0.024, k.y(0.16));
    }
    // muzzle-brake prow
    k.metal(k.M([0.5, 0, 0.49, -0.13, 0.43, -0.17, 0.42, 0]), 0.42, -0.17, 0.5, 0.17, 1.2);
    for (const s of [-1, 1]) { g.fillStyle = '#07080a'; g.fillRect(k.x(0.445), k.y(s * 0.06) - 0.02, 0.05, 0.04); }
    for (const s of [-1, 1]) { k.stripe([0.05, s * 0.2, 0.36, s * 0.15]); k.rivets(0.06, s * 0.15, 0.36, s * 0.12, 5); }
    k.haz(0.39, 0, 0.04 * S, k.y(0.28), true);
  },
  cross(k) {
    const S = k.S;
    // centre wedge with a raised spine and dome cockpit
    k.plate(k.M([0.46, 0, 0.3, -0.12, 0.18, -0.14, -0.3, -0.14, -0.36, 0]), -0.3, -0.14, 0.46, 0.14, 0.06);
    k.dome(0.16, 0, 0.12 * S, 0.09 * S);
    k.seam([0.3, 0, 0.42, 0]);
    // side pods: bulbous capsules with twin fixed blaster barrels at the nose
    for (const s of [-1, 1]) {
      k.barrel(0.22, s * 0.38, 0.22 * S, 0.028 * S);
      k.barrel(0.22, s * 0.28, 0.22 * S, 0.028 * S);
      k.pod(-0.2, 0.27, s * 0.33, 0.16 * k.Y, 0);
      k.stripe([-0.12, s * 0.46, 0.14, s * 0.46]);
      k.grille(-0.15, s * 0.33, 0.1 * S, 0.12 * S, 4, 0.5);
    }
    k.grille(-0.42, 0, 0.08 * S, 0.22 * S, 5, 0.7);
    for (const s of [-1, 1]) k.lamp(0.44, s * 0.04, 0.02 * S);
  },
  airframe(k) {
    const S = k.S;
    // stub wings with weapon pylons and a boom spine
    for (const s of [-1, 1]) {
      k.plate(k.P([0.12, s * 0.12, 0.1, s * 0.42, -0.02, s * 0.42, -0.04, s * 0.12]), -0.04, 0.12, 0.12, 0.42, 0.0, 0.9);
      k.stripe([0.09, s * 0.4, -0.01, s * 0.4]);
      for (const d of [0.18, 0.26]) k.dot(0.1, s * d, 0.022 * S, '#07080a');
    }
    k.plate(k.B([0.46, 0, 0.44, 0.08, 0.36, 0.11, 0.2, 0.13, 0.0, 0.12, -0.12, 0.06, -0.2, 0]), -0.2, -0.13, 0.46, 0.13, 0.08, 1.1);
    // tandem cockpit: gunner forward, pilot stepped up behind
    k.canopy(0.38, 0, 0.1 * k.X, 0.13 * k.Y);
    k.canopy(0.26, 0, 0.1 * k.X, 0.15 * k.Y);
    k.dot(0.47, 0, 0.04 * S, METAL.dark); k.eye(0.47, 0, 0.022 * S);
    // engine nacelles beside the mast + exhausts
    for (const s of [-1, 1]) { k.pod(-0.1, 0.1, s * 0.1, 0.07 * S, -0.06); k.dot(-0.11, s * 0.1, 0.035 * S, '#07080a'); }
    // tail boom + stabiliser + tail fin
    k.dark(k.R(-0.32, 0, 0.3, 0.06, 0.03), -0.46, -0.04, -0.18, 0.04, 0.8);
    k.plate(k.M([-0.37, -0.02, -0.4, -0.16, -0.44, -0.16, -0.45, -0.02]), -0.45, -0.16, -0.37, 0.16, 0, 0.8);
    k.fin(-0.44, 0.02, 0.1 * k.X, 0);
    k.stripe([-0.39, -0.14, -0.39, 0.14]);
  },
  delta(k) {
    const S = k.S;
    for (const s of [-1, 1]) {
      k.seam([0.1, s * 0.13, -0.3, s * 0.46, 0.0, s * 0.1, -0.24, s * 0.36]);
      k.stripe([-0.31, s * 0.47, -0.37, s * 0.47], k.o * 1.4);
      k.fin(-0.36, s * 0.07, 0.18 * k.X, s * 0.04 * S);
      k.intake(0.16, s * 0.1, 0.06 * k.X, 0.04 * S);
    }
    k.plate(k.M([0.42, 0, 0.3, -0.06, -0.4, -0.07, -0.46, 0]), -0.46, -0.07, 0.42, 0.07, 0.1, 0.9);
    k.canopy(0.28, 0, 0.13 * k.X, 0.09 * k.Y);
    for (const s of [-1, 1]) k.engine(-0.5, s * 0.045, 0.1 * k.X, 0.065 * S);
  },
  interceptor(k) {
    const S = k.S;
    for (const s of [-1, 1]) {
      k.seam([-0.04, s * 0.12, -0.12, s * 0.46, -0.22, s * 0.13, -0.42, s * 0.36]);
      k.stripe([-0.09, s * 0.47, -0.16, s * 0.47], k.o * 1.2);
      k.stripe([-0.43, s * 0.37, -0.48, s * 0.36], k.o);
      k.dot(0.23, s * 0.15, 0.02 * S, '#07080a');
    }
    k.plate(k.M([0.46, 0, 0.3, -0.05, -0.4, -0.07, -0.47, 0]), -0.47, -0.07, 0.46, 0.07, 0.1, 0.8);
    k.canopy(0.26, 0, 0.16 * k.X, 0.08 * k.Y);
    k.engine(-0.5, 0, 0.12 * k.X, 0.07 * S);
  },
  strikejet(k) {
    const S = k.S;
    for (const s of [-1, 1]) {
      // wing panels, flaps, tip rails
      k.seam([0.0, s * 0.17, -0.08, s * 0.46, -0.1, s * 0.17, -0.16, s * 0.42]);
      k.seam([-0.12, s * 0.2, -0.15, s * 0.42], k.o * 0.4, 'rgba(255,255,255,0.15)');
      k.stripe([-0.05, s * 0.48, -0.13, s * 0.48], k.o * 1.4);
      // LERX intakes, twin canted fins, tailplanes
      k.intake(0.12, s * 0.105, 0.07 * k.X, 0.05 * S);
      k.fin(-0.32, s * 0.08, 0.16 * k.X, s * 0.05 * S);
      k.seam([-0.33, s * 0.16, -0.44, s * 0.34]);
    }
    k.plate(k.M([0.44, 0, 0.32, -0.055, 0.1, -0.08, -0.42, -0.08, -0.48, 0]), -0.48, -0.08, 0.44, 0.08, 0.1, 0.9);
    k.canopy(0.3, 0, 0.14 * k.X, 0.08 * k.Y);
    k.dot(0.47, 0, 0.02 * S, '#07080a');
    for (const s of [-1, 1]) k.engine(-0.5, s * 0.05, 0.08 * k.X, 0.06 * S);
  },
  stratobomber(k) {
    const S = k.S;
    for (const s of [-1, 1]) {
      // swept wing panels with control surfaces and a glove fairing
      k.seam([0.08, s * 0.14, -0.13, s * 0.48, -0.06, s * 0.12, -0.18, s * 0.38]);
      k.seam([-0.15, s * 0.22, -0.2, s * 0.46], k.o * 0.45, 'rgba(255,255,255,0.15)');
      k.stripe([-0.13, s * 0.49, -0.2, s * 0.49], k.o * 1.6);
      // podded engines
      k.pod(-0.15, 0.0, s * 0.2, 0.05 * S, -0.08);
      k.pod(-0.22, -0.07, s * 0.32, 0.05 * S, -0.08);
      k.intake(0.0, s * 0.2, 0.03 * k.X, 0.07 * S);
      k.intake(-0.07, s * 0.32, 0.03 * k.X, 0.07 * S);
      k.seam([-0.4, s * 0.07, -0.46, s * 0.2]);
    }
    // fuselage spine with bomb bays, T-tail, cockpit
    k.plate(k.M([0.46, 0, 0.36, -0.06, -0.44, -0.065, -0.5, 0]), -0.5, -0.07, 0.46, 0.07, 0.08, 1);
    for (const u of [0.18, -0.02, -0.12]) k.bay(u, 0, 0.06, 0.07);
    k.canopy(0.4, 0, 0.07 * k.X, 0.07 * k.Y);
    k.fin(-0.42, 0, 0.14 * k.X, 0);
    k.plate(k.M([-0.43, -0.02, -0.46, -0.12, -0.49, -0.12, -0.49, -0.02]), -0.49, -0.12, -0.43, 0.12, 0.05, 0.8);
  },
  heavyheli(k) {
    const S = k.S;
    // fuel sponsons with door-gun bays
    for (const s of [-1, 1]) {
      k.pod(-0.2, 0.16, s * 0.33, 0.12 * k.Y, -0.03);
      k.stripe([-0.14, s * 0.4, 0.1, s * 0.4]);
      k.grille(-0.14, s * 0.33, 0.08 * S, 0.1 * S, 4, 0.4);
    }
    // long roof with rotor pylons fore and aft, engine pods on the aft pylon
    k.plate(k.R(0.0, 0, 0.84, 0.32, 0.12), -0.42, -0.16, 0.42, 0.16, 0.06, 1);
    k.seam([-0.42, 0, 0.42, 0]);
    k.dark(k.R(0.27, 0, 0.14, 0.24, 0.08), 0.2, -0.12, 0.34, 0.12, 1.2);
    k.dark(k.R(-0.3, 0, 0.22, 0.3, 0.1), -0.41, -0.15, -0.19, 0.15, 1.4);
    for (const s of [-1, 1]) { k.pod(-0.38, -0.2, s * 0.17, 0.06 * S, -0.08); k.dot(-0.39, s * 0.17, 0.035 * S, '#07080a'); }
    // cockpit glazing + loading ramp
    for (const s of [-1, 1]) k.canopy(0.44, s * 0.08, 0.06 * k.X, 0.12 * k.Y);
    k.haz(-0.47, 0, 0.04 * S, k.y(0.28), true);
    for (const s of [-1, 1]) k.lamp(0.48, s * 0.17, 0.02 * S, s < 0 ? '#ff5050' : '#5aff9a');
  },
  bomber(k) {
    const S = k.S;
    for (const s of [-1, 1]) {
      k.seam([0.1, s * 0.18, 0.08, s * 0.47, -0.04, s * 0.18, -0.06, s * 0.47]);
      k.stripe([0.05, s * 0.49, -0.05, s * 0.49], k.o * 1.5);
      // twin tail booms + fins
      k.dark(k.R(-0.3, s * 0.15, 0.36, 0.05, 0.04), -0.48, s * 0.13, -0.12, s * 0.17, 0.8);
      k.fin(-0.44, s * 0.2, 0.1 * k.X, s * 0.0);
    }
    k.plate(k.R(-0.47, 0, 0.05, 0.42, 0.03), -0.5, -0.21, -0.44, 0.21, 0, 0.8);
    // fat fuselage with a glazed bombardier nose and bomb bay doors
    k.plate(k.B([0.48, 0, 0.46, 0.08, 0.38, 0.13, 0.2, 0.15, -0.2, 0.14, -0.34, 0.08, -0.4, 0]), -0.4, -0.15, 0.48, 0.15, 0.06, 1.1);
    k.dome(0.44, 0, 0.06 * k.X, 0.08 * k.Y);
    const bay = k.R(-0.14, 0, 0.26, 0.14, 0.03);
    k.recess(bay, shade(k.pal.deep, 0.15));
    k.seam([-0.27, 0, -0.01, 0, -0.14, -0.07, -0.14, 0.07], k.o * 0.6);
    k.haz(-0.14, -0.08, k.x(0.24), 0.025 * S); k.haz(-0.14, 0.08, k.x(0.24), 0.025 * S);
  },
  carrier(k) {
    const S = k.S;
    for (const s of [-1, 1]) {
      // wing hangar decks with launch rails and glowing bay doors
      const w = k.P([0.12, s * 0.2, 0.0, s * 0.38, -0.06, s * 0.44, -0.2, s * 0.44, -0.24, s * 0.36, -0.2, s * 0.2]);
      k.plate(w, -0.24, s * 0.2, 0.12, s * 0.44, 0.04, 1.2);
      for (const v of [0.26, 0.32, 0.38]) { k.bay(-0.08, s * v, 0.18, 0.025); k.glow([-0.16, s * v, 0.0, s * v], k.o * 0.7, 0.7); }
      k.haz(-0.21, s * 0.3, 0.03 * S, k.y(0.12), true);
      k.stripe([0.04, s * 0.42, -0.04, s * 0.47], k.o * 1.4);
      k.seam([0.26, s * 0.12, 0.05, s * 0.44]);
    }
    // central spine deck + command island (port)
    k.plate(k.M([0.46, 0, 0.36, -0.07, 0.2, -0.13, -0.36, -0.13, -0.46, 0]), -0.46, -0.13, 0.46, 0.13, 0.08, 1.3);
    k.seam([0.36, 0, -0.42, 0]);
    k.plate(k.R(0.0, -0.12, 0.22, 0.07, 0.06), -0.11, -0.16, 0.11, -0.08, 0.14, 1.5);
    k.glow([0.06, -0.14, 0.06, -0.1], k.o * 1.2);
    for (const s of [-1, 1]) for (const v of [0.07, 0.17]) k.engine(-0.47, s * v, 0.06 * k.X, 0.06 * S);
    for (const s of [-1, 1]) k.lamp(0.44, s * 0.03, 0.03 * S);
  },
  leviathan(k) {
    const S = k.S, g = k.g;
    // deck
    const deck = k.M([0.42, 0, 0.32, -0.24, 0.18, -0.35, -0.34, -0.37, -0.44, -0.28, -0.46, 0]);
    g.save(); g.clip(deck);
    g.fillStyle = shade(k.pal.deep, 0.12); g.fill(deck);
    g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = k.o * 0.5; g.beginPath();
    for (let v = -0.4; v <= 0.4; v += 0.06) { g.moveTo(k.x(-0.5), k.y(v)); g.lineTo(k.x(0.5), k.y(v)); }
    g.stroke();
    g.lineWidth = k.o * 3.5; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.stroke(deck);
    g.restore();
    g.lineWidth = k.o * 0.6; g.strokeStyle = OUTLINE; g.stroke(deck);
    // armour belts down both flanks
    for (const s of [-1, 1]) {
      k.plate(k.P([0.18, s * 0.37, 0.04, s * 0.44, -0.32, s * 0.44, -0.4, s * 0.38]), -0.4, s * 0.37, 0.18, s * 0.44, -0.02, 1);
      k.rivets(0.12, s * 0.405, -0.36, s * 0.405, 12, 0.012 * S);
      k.glow([0.12, s * 0.39, -0.34, s * 0.39], k.o * 0.9);
      for (const u of [0.16, -0.16, -0.24]) { k.metal(k.Ra(u, s * 0.3, 0.2 * S, 0.14 * S, 0.03), u - 0.03, s * 0.28, u + 0.03, s * 0.33, 1); k.barrel(u, s * 0.33, 0.08 * S, 0.018 * S); }
    }
    // barbette armour rings fore and aft (superfiring step)
    k.dark(k.Oct(0.29, 0, 0.62), 0.2, -0.3, 0.38, 0.3, 1.3);
    k.dark(k.Oct(-0.3, 0, 0.62), -0.39, -0.3, -0.21, 0.3, 1.3);
    // bow: forecastle, anchor hawses, chevron lights
    k.plate(k.M([0.5, 0, 0.45, -0.1, 0.4, -0.16, 0.4, 0]), 0.4, -0.16, 0.5, 0.16, 0.1, 1.3);
    for (let i = 0; i < 3; i++) k.glow([0.41 + i * 0.02, -0.08 + i * 0.022, 0.44 + i * 0.018, 0, 0.44 + i * 0.018, 0, 0.41 + i * 0.02, 0.08 - i * 0.022], k.o * 0.8, 0.8);
    // bridge tower: three tiers with a fire-control director
    k.plate(k.R(0.02, 0, 0.18, 0.4, 0.08), -0.07, -0.2, 0.11, 0.2, 0.05, 1.4);
    k.plate(k.R(0.03, 0, 0.11, 0.26, 0.06), -0.025, -0.13, 0.085, 0.13, 0.14, 1.4);
    k.dark(k.C(0.05, 0, 0.16 * S), 0.0, -0.08, 0.1, 0.08, 1.2);
    k.glow([0.075, -0.1, 0.075, 0.1], k.o * 1.1);
    for (const s of [-1, 1]) k.stack(-0.1, s * 0.12, 0.05 * S);
    // stern engines
    for (const v of [-0.2, 0, 0.2]) k.engine(-0.5, v, 0.04 * k.X, 0.08 * S);
  },
  goliath(k) {
    const S = k.S;
    // rear engine block
    k.dark(k.R(-0.43, 0, 0.13, 0.6, 0.08), -0.5, -0.3, -0.36, 0.3, 1.2);
    for (const s of [-1, 1]) { k.grille(-0.43, s * 0.15, 0.3, 0.42, 6, 0.7); k.stack(-0.47, s * 0.35, 0.07 * S); }
    // sponsons
    for (const s of [-1, 1]) {
      k.plate(k.P([0.28, s * 0.25, 0.24, s * 0.44, -0.1, s * 0.44, -0.14, s * 0.34, -0.34, s * 0.34, -0.34, s * 0.25]), -0.34, s * 0.25, 0.28, s * 0.44, 0.02, 1.4);
      k.seam([-0.34, s * 0.3, 0.26, s * 0.3]);
      k.rivets(-0.08, s * 0.42, 0.2, s * 0.42, 6, 0.014 * S);
      k.glow([0.22, s * 0.4, -0.06, s * 0.4], k.o);
      k.haz(0.25, s * 0.38, 0.06 * S, 0.22 * S, true);
    }
    // glacis wall + vision slits
    k.plate(k.M([0.49, -0.1, 0.44, -0.2, 0.36, -0.26, 0.28, -0.26, 0.28, 0]), 0.28, -0.26, 0.49, 0.26, 0.12, 1.6);
    k.seam([0.36, -0.24, 0.36, 0.24]);
    for (const s of [-1, 1]) { k.glow([0.42, s * 0.1, 0.42, s * 0.18], k.o * 1.2); k.lamp(0.47, s * 0.08, 0.03 * S); }
    // central deck + command tower behind the giant gun
    k.plate(k.R(-0.12, 0, 0.36, 0.42, 0.1), -0.3, -0.21, 0.06, 0.21, 0.0, 1.2);
    k.plate(k.R(-0.24, -0.04, 0.14, 0.2, 0.08), -0.31, -0.14, -0.17, 0.06, 0.12, 1.6);
    k.glow([-0.18, -0.12, -0.18, 0.04], k.o * 1.2);
  },
  titan(k) {
    const S = k.S;
    // long segmented body: three armour bands with joints, rear drive section
    for (let i = 0; i < 3; i++) {
      const u0 = 0.18 - i * 0.2, u1 = u0 - 0.17;
      k.plate(k.P([u0, -0.39, u0, 0.39, u1, 0.39, u1, -0.39]), u1, -0.39, u0, 0.39, -i * 0.03, 1.2);
      k.seam([u0 - 0.09, -0.37, u0 - 0.09, 0.37]);
      for (const s of [-1, 1]) k.rivets(u0 - 0.02, s * 0.36, u1 + 0.02, s * 0.36, 4, 0.014 * S);
    }
    k.dark(k.R(-0.44, 0, 0.1, 0.5, 0.08), -0.49, -0.25, -0.39, 0.25, 1.2);
    for (const s of [-1, 1]) k.stack(-0.46, s * 0.18, 0.06 * S);
    k.grille(-0.44, 0, 0.12, 0.3 * S, 5, 0.8);
    // head pod with visor + chin
    k.plate(k.B([0.5, 0, 0.49, 0.09, 0.45, 0.14, 0.38, 0.14, 0.33, 0.08, 0.3, 0]), 0.3, -0.14, 0.5, 0.14, 0.12, 1.4);
    k.visor(0.47, -0.08, 0.47, 0.08, 0.02 * S);
    for (const s of [-1, 1]) k.eye(0.44, s * 0.1, 0.03 * S);
    for (const s of [-1, 1]) k.glow([0.16, s * 0.4, -0.36, s * 0.4], k.o);
  },
  mantis(k) {
    const S = k.S, E = k.E, g = k.g;
    const pack = k.B([-0.06, 0, -0.12, 0.2, -0.28, 0.24, -0.42, 0.18, -0.48, 0]);
    floatGap(g, pack, E, k.o, 1);
    sleekShell(g, pack, k.pal, k.o, 1, k.x(-0.1), k.y(-0.24), k.x(-0.44), k.y(0.24));
    seamGlow(g, k.A([-0.1, -0.14, -0.28, -0.22, -0.44, -0.08, -0.1, 0.14, -0.28, 0.22, -0.44, 0.08]), 1, E, k.o * 0.8);
    cables(g, k.A([0.08, 0, -0.08, 0]), 1, 0.03 * S, 2);
    const th = k.B([0.28, 0, 0.24, 0.08, 0.12, 0.1, 0.02, 0.08, 0.0, 0]);
    sleekShell(g, th, k.pal, k.o, 1, k.x(0.02), k.y(-0.1), k.x(0.26), k.y(0.1));
    const hd = k.B([0.49, 0, 0.47, 0.1, 0.42, 0.17, 0.36, 0.15, 0.32, 0.08, 0.31, 0]);
    sleekShell(g, hd, k.pal, k.o, 1, k.x(0.31), k.y(-0.17), k.x(0.49), k.y(0.17));
    seamGlow(g, k.A([0.43, -0.12, 0.48, 0, 0.43, 0.12]), 1, E, k.o * 1.4);
  },
  crab(k) {
    const S = k.S;
    // armoured carapace with radial plate seams, side skirt slabs
    const inner = k.M([0.26, 0, 0.26, -0.12, 0.2, -0.26, 0.1, -0.36, -0.12, -0.38, -0.26, -0.3, -0.33, -0.16, -0.33, 0]);
    k.plate(inner, -0.33, -0.38, 0.26, 0.38, 0.06, 1.3);
    k.seam([0.26, 0, -0.33, 0]);
    for (const s of [-1, 1]) {
      k.seam([0.12, s * 0.34, 0.04, s * 0.08, -0.22, s * 0.3, -0.12, s * 0.06]);
      for (const [u0, u1] of [[0.2, 0.06], [0.02, -0.12], [-0.16, -0.3]]) {
        const sk = k.P([u0, s * 0.4, u0 - 0.01, s * 0.46, u1 + 0.01, s * 0.46, u1, s * 0.4]);
        k.plate(sk, u1, s * 0.4, u0, s * 0.46, -0.12, 0.8);
      }
      k.stripe([0.18, s * 0.38, -0.02, s * 0.39]);
      k.grille(-0.2, s * 0.18, 0.14 * S, 0.12 * S, 4, 0.5);
      k.stack(-0.36, s * 0.1, 0.04 * S);
      k.eye(0.3, s * 0.16, 0.03 * S);
    }
    // sensor brow
    k.dark(k.M([0.37, -0.0, 0.36, -0.12, 0.3, -0.14, 0.29, 0]), 0.29, -0.14, 0.37, 0.14, 1);
    k.visor(0.345, -0.1, 0.345, 0.1, 0.018 * S);
  },
  warlord(k) {
    const S = k.S;
    // reactor backpack
    k.dark(k.R(-0.38, 0, 0.16, 0.34, 0.1), -0.46, -0.17, -0.3, 0.17, 1.3);
    for (const s of [-1, 1]) k.stack(-0.42, s * 0.1, 0.06 * S);
    // chest + reactor core
    k.plate(k.M([0.24, -0.04, 0.2, -0.13, 0.1, -0.2, -0.14, -0.18, -0.2, -0.06, -0.2, 0]), -0.2, -0.2, 0.24, 0.2, 0.06, 1.4);
    k.seam([0.1, -0.2, 0.03, -0.06, 0.1, 0.2, 0.03, 0.06, -0.14, -0.18, -0.07, -0.06, -0.14, 0.18, -0.07, 0.06]);
    k.reactor(0.02, 0, 0.13);
    // hunched cockpit head
    k.plate(k.B([0.35, 0, 0.34, 0.04, 0.3, 0.07, 0.22, 0.07, 0.2, 0]), 0.2, -0.07, 0.35, 0.07, 0.12, 1.3);
    k.visor(0.31, -0.04, 0.31, 0.04, 0.025 * S);
    // shoulder yoke pauldrons
    for (const s of [-1, 1]) {
      const pd = k.B([0.12, 0, 0.1, 0.06, 0.04, 0.09, -0.08, 0.1, -0.18, 0.07, -0.21, 0]);
      const g = k.g; g.save(); g.translate(0, k.y(s * 0.36));
      k.plate(pd, -0.2, -0.1, 0.12, 0.1, 0.1, 1.5);
      k.stripe([-0.16, s * 0.08, 0.06, s * 0.08], k.o * 1.3);
      for (const u of [0.06, -0.04, -0.14]) k.seam([u, -0.08, u - 0.01, 0.08]);
      g.restore();
    }
  },
  scorpion(k) {
    const S = k.S;
    // spine plate, side sponsons, sensor head
    for (const s of [-1, 1]) {
      const sp = k.M([0.16, 0, 0.14, -0.05, -0.24, -0.05, -0.28, 0]);
      const g = k.g; g.save(); g.translate(0, k.y(s * 0.19));
      k.plate(sp, -0.28, -0.05, 0.16, 0.05, -0.02, 0.9);
      k.rivets(0.1, 0, -0.22, 0, 6, 0.012 * S);
      g.restore();
      k.stripe([0.1, s * 0.27, -0.18, s * 0.26]);
      k.stack(-0.29, s * 0.07, 0.035 * S);
      k.eye(0.27, s * 0.13, 0.025 * S);
    }
    k.plate(k.R(-0.08, 0, 0.42, 0.14, 0.05), -0.29, -0.07, 0.13, 0.07, 0.02, 1);
    k.rivets(-0.27, -0.045, 0.1, -0.045, 7, 0.012 * S);
    k.rivets(-0.27, 0.045, 0.1, 0.045, 7, 0.012 * S);
    k.plate(k.M([0.36, 0, 0.35, -0.07, 0.3, -0.15, 0.22, -0.18, 0.18, -0.1, 0.18, 0]), 0.18, -0.18, 0.36, 0.18, 0.08, 1.1);
    k.visor(0.33, -0.07, 0.33, 0.07, 0.018 * S);
  },
  centipede(k) {
    const S = k.S;
    // armoured cab: visor bar + lenses + ram plough
    k.plate(k.M([0.49, 0, 0.48, -0.1, 0.44, -0.2, 0.38, -0.22, 0.34, -0.14, 0.33, 0]), 0.33, -0.22, 0.49, 0.22, 0.08, 1);
    k.visor(0.46, -0.12, 0.46, 0.12, 0.016 * S);
    for (const s of [-1, 1]) k.eye(0.41, s * 0.15, 0.025 * S);
    k.seam([0.36, 0, 0.43, 0]);
  },
  broodmother(k) { orbDetails(k, false); },
  arachne(k) { orbDetails(k, true); },
  riot(k) {
    const S = k.S;
    // knife prow: sloped ram plate with teeth
    const prow = k.M([0.5, 0, 0.42, -0.06, 0.26, -0.15, 0.2, -0.16, 0.2, 0]);
    k.plate(prow, 0.2, -0.16, 0.5, 0.16, 0.18, 1.6);
    k.seam([0.42, -0.04, 0.42, 0.04, 0.34, -0.09, 0.34, 0.09]);
    k.haz(0.27, 0, 0.04 * S, k.y(0.22), true);
    for (const s of [-1, 1]) {
      // tusk pods: bulbous capsules jutting forward with twin fixed blasters
      k.barrel(0.36, s * 0.37, 0.14 * k.X, 0.03 * S);
      k.barrel(0.36, s * 0.43, 0.14 * k.X, 0.03 * S);
      k.pod(0.04, 0.46, s * 0.41, 0.085 * k.Y, 0.02);
      k.lamp(0.44, s * 0.4, 0.03 * S);
      k.stripe([0.1, s * 0.47, 0.3, s * 0.47], k.o * 1.3);
      // gun sponsons on the shoulders
      k.dark(k.Ra(-0.12, s * 0.22, 0.45 * S, 0.42 * S, 0.1), -0.2, s * 0.15, -0.04, s * 0.29, 1.1);
    }
    // crew bunker with vision slits + engine grille
    k.plate(k.R(-0.12, 0, 0.28, 0.2, 0.08), -0.26, -0.1, 0.02, 0.1, 0.06, 1.4);
    for (const s of [-1, 1]) k.glow([0.0, s * 0.03, 0.0, s * 0.08], k.o * 1.1);
    k.grille(-0.4, 0, 0.1 * S, 0.34 * S, 5, 0.7);
    for (const s of [-1, 1]) k.stack(-0.38, s * 0.3, 0.05 * S);
  },
  juggernaut(k) {
    const S = k.S, g = k.g;
    // ribbed body: armour hoops between the neck and the tail
    for (let i = 0; i < 4; i++) {
      const u = 0.06 - i * 0.09, h = [0.22, 0.3, 0.42, 0.42][i];
      k.seam([u, -h, u, h], k.o * 0.9);
      k.seam([u - 0.008, -h, u - 0.008, h], k.o * 0.5, 'rgba(255,255,255,0.15)');
    }
    // ear sponsons with troop doors
    for (const s of [-1, 1]) {
      k.pod(-0.3, -0.06, s * 0.4, 0.08 * k.Y, -0.02);
      k.bay(-0.18, s * 0.4, 0.14, 0.06);
      k.fin(-0.44, s * 0.3, 0.12 * k.X, s * 0.06 * S);
    }
    // great hammerhead face: domed prow, eye slits, deployment rack seam
    const face = k.B([0.5, 0, 0.49, 0.17, 0.45, 0.32, 0.37, 0.44, 0.26, 0.47, 0.16, 0.42, 0.12, 0]);
    k.plate(face, 0.12, -0.47, 0.5, 0.47, 0.14, 1.7);
    g.save(); g.clip(face); g.fillStyle = 'rgba(255,255,255,0.13)'; g.beginPath(); g.ellipse(k.x(0.34), k.y(-0.15), k.x(0.1), k.y(0.18), 0, 0, P2); g.fill(); g.restore();
    for (const s of [-1, 1]) {
      k.recess(k.P([0.45, s * 0.1, 0.39, s * 0.36, 0.35, s * 0.36, 0.41, s * 0.1]), '#05080b');
      k.glow([0.43, s * 0.12, 0.375, s * 0.33], k.o * 1.2);
    }
    k.seam([0.2, -0.38, 0.2, 0.38], k.o * 1.1);
    k.rivets(0.22, -0.34, 0.22, 0.34, 9, 0.014 * S);
    // spine walk + engine tail
    k.plate(k.R(-0.14, 0, 0.36, 0.12, 0.05), -0.32, -0.06, 0.04, 0.06, 0.02, 1.2);
    k.dark(k.R(-0.45, 0, 0.1, 0.4, 0.08), -0.5, -0.2, -0.4, 0.2, 1.3);
    for (const s of [-1, 1]) k.stack(-0.45, s * 0.12, 0.06 * S);
  },
  siegeplat(k) {
    const S = k.S, g = k.g;
    // open deck grating between the gun cradles
    const deck = k.M([0.4, -0.18, 0.34, -0.24, -0.34, -0.26, -0.4, -0.2, -0.4, 0]);
    k.recess(deck, '#262b30');
    g.save(); g.clip(deck); g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = k.o * 0.6; g.beginPath();
    for (let u = -0.5; u <= 0.5; u += 0.025) { g.moveTo(k.x(u), -k.y(0.3)); g.lineTo(k.x(u), k.y(0.3)); }
    g.stroke(); g.restore();
    // gun cradles (raised rings) + loader rails
    for (const u of [0.2, -0.16]) k.dark(k.Oct(u, 0, 0.42 * S * 0.6), u - 0.1, -0.2, u + 0.1, 0.2, 1.3);
    for (const s of [-1, 1]) {
      k.haz(0.0, s * 0.29, k.x(0.66), 0.03 * S);
      for (let i = 0; i < 4; i++) k.metal(k.Ra(0.02 + i * 0.03 - 0.06, s * 0.2, 0.08, 0.1, 0.015), 0, s * 0.18, 0.1, s * 0.22, 0.8);
    }
    // power plant astern + cab forward
    k.dark(k.R(-0.45, 0, 0.1, 0.4, 0.08), -0.5, -0.2, -0.4, 0.2, 1.3);
    k.grille(-0.45, 0, 0.1 * k.X, 0.2 * S, 5, 0.8);
    k.plate(k.M([0.49, 0, 0.47, -0.1, 0.44, -0.16, 0.42, 0]), 0.42, -0.16, 0.49, 0.16, 0.1, 1.2);
    k.lamp(0.47, 0, 0.025 * S);
  },
  hunter(k) {
    const S = k.S;
    const sp = k.M([0.46, 0, 0.3, -0.07, -0.38, -0.1, -0.46, 0]);
    k.plate(sp, -0.46, -0.1, 0.46, 0.1, 0.1, 1.1);
    for (const s of [-1, 1]) {
      k.seam([0.1, s * 0.18, -0.02, s * 0.36, -0.12, s * 0.21, -0.38, s * 0.3]);
      k.stripe([0.02, s * 0.34, -0.04, s * 0.38, -0.42, s * 0.32, -0.48, s * 0.31]);
      k.intake(0.2, s * 0.12, 0.05 * k.X, 0.04 * S);
    }
    k.canopy(0.3, 0, 0.14 * k.X, 0.09 * k.Y);
    for (const s of [-1, 1]) k.dot(-0.46, s * 0.06, 0.03 * S, '#07080a');
  },
  colossal(k) {
    const S = k.S;
    // reactor backpack, waist skirt, chest + core, sunken head (arms are drawn by the top layer helpers)
    k.dark(k.M([0.04, -0.2, -0.04, -0.28, -0.2, -0.26, -0.26, -0.16]), -0.26, -0.28, 0.04, 0.28, 1);
    k.dark(k.R(-0.32, 0, 0.26, 0.32, 0.18), -0.45, -0.16, -0.19, 0.16, 1.3);
    for (const s of [-1, 1]) k.stack(-0.4, s * 0.1, 0.12);
    k.grille(-0.26, 0, 0.18, 0.5, 5, 0.8);
    for (const s of [-1, 1]) {
      const fa = k.R(0.16, s * 0.38, 0.28, 0.16, 0.14);
      k.plate(fa, 0.02, s * 0.3, 0.3, s * 0.46, 0.04, 1.4);
      k.seam([0.08, s * 0.31, 0.08, s * 0.45, 0.22, s * 0.31, 0.22, s * 0.45]);
      k.glow([0.04, s * 0.44, 0.27, s * 0.44], k.o * 0.9);
    }
    k.plate(k.M([0.22, -0.08, 0.18, -0.18, 0.06, -0.25, -0.12, -0.25, -0.17, -0.12, -0.17, 0]), -0.17, -0.25, 0.22, 0.25, 0.08, 1.5);
    k.reactor(0.03, 0, 0.3);
    k.glow([0.12, -0.05, 0.19, -0.15, 0.12, 0.05, 0.19, 0.15, -0.06, -0.1, -0.12, -0.21, -0.06, 0.1, -0.12, 0.21], k.o);
    k.plate(k.M([0.32, -0.04, 0.3, -0.085, 0.2, -0.095, 0.17, -0.06, 0.17, 0]), 0.17, -0.095, 0.32, 0.095, 0.12, 1.4);
    k.visor(0.3, -0.05, 0.3, 0.05, 0.04 * S * 0.5);
  },
  citadel(k) {
    const S = k.S, g = k.g;
    const yard = k.R(0, 0, 0.68, 0.68, 0.1);
    k.recess(yard, shade(k.pal.deep, 0.1));
    g.save(); g.clip(yard); g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = k.o * 0.5; g.beginPath();
    for (let v = -0.34; v <= 0.34; v += 0.068) { g.moveTo(k.x(v), k.y(-0.34)); g.lineTo(k.x(v), k.y(0.34)); g.moveTo(k.x(-0.34), k.y(v)); g.lineTo(k.x(0.34), k.y(v)); }
    g.stroke(); g.restore();
    const mf = shade(k.pal.light, -0.12);
    const ml = (u0: number, v0: number, u1: number, v1: number, n: number) => merlons(g, k.x(u0), k.y(v0), k.x(u1), k.y(v1), n, 0.035 * S, 0.05 * S, mf, k.o);
    ml(0.415, -0.27, 0.415, -0.15, 3); ml(0.415, 0.15, 0.415, 0.27, 3); ml(-0.415, -0.27, -0.415, 0.27, 9);
    for (const s of [-1, 1]) ml(-0.27, s * 0.415, 0.27, s * 0.415, 9);
    k.reactor(0.08, 0, 0.06 * S);
    k.plate(k.R(-0.18, 0, 0.38, 0.4, 0.2), -0.37, -0.2, 0.01, 0.2, 0.04, 1.4);
    k.plate(k.R(-0.175, 0, 0.27, 0.28, 0.15), -0.31, -0.14, -0.04, 0.14, 0.14, 1.4);
    k.dark(k.R(0.43, 0, 0.1, 0.24, 0.08), 0.38, -0.12, 0.48, 0.12, 1.2);
    k.glow([0.415, -0.085, 0.415, 0.085], k.o * 1.3);
    for (const sx of [1, -1]) for (const sy of [-1, 1]) {
      const bu = sx * 0.385, bv = sy * 0.385;
      k.plate(k.Oct(bu, bv, 0.125 * S), bu - 0.1, bv - 0.1, bu + 0.1, bv + 0.1, 0.04, 1.5);
      k.recess(k.Oct(bu, bv, 0.085 * S), shade(k.pal.deep, 0.15));
      g.strokeStyle = rgba(k.E, 0.9); g.lineWidth = k.o; g.beginPath(); g.arc(k.x(bu), k.y(bv), 0.06 * S, 0, P2); g.stroke();
    }
  },
};

/** Broodmother / Arachne: an armoured orb slung between the legs, banded with emissive seams, cab forward. */
function orbDetails(k: K, titan: boolean): void {
  const S = k.S, g = k.g, E = k.E;
  const cx = -0.06, rx = titan ? 0.4 : 0.42, ry = titan ? 0.36 : 0.4;
  const orb = new Path2D(); orb.ellipse(k.x(cx), 0, k.x(rx), k.y(ry), 0, 0, P2);
  // shading: big sphere highlight + terminator
  const gr = g.createRadialGradient(k.x(cx - rx * 0.35), k.y(-ry * 0.35), 0, k.x(cx), 0, Math.max(k.x(rx), k.y(ry)) * 1.05);
  gr.addColorStop(0, shade(k.pal.light, 0.18)); gr.addColorStop(0.45, k.pal.body); gr.addColorStop(1, shade(k.pal.deep, -0.1));
  g.fillStyle = gr; g.fill(orb);
  g.save(); g.clip(orb);
  // armour bands (latitude) and plate meridians
  g.strokeStyle = 'rgba(0,0,0,0.42)'; g.lineWidth = k.o * 0.8;
  for (const f of [-0.6, -0.25, 0.25, 0.6]) { g.beginPath(); g.ellipse(k.x(cx), 0, k.x(rx) * Math.sqrt(1 - f * f) * 1.0, k.y(ry), 0, 0, P2); g.stroke(); }
  for (const f of [-0.5, 0, 0.5]) { g.beginPath(); g.ellipse(k.x(cx), k.y(ry * f), k.x(rx), k.y(ry) * 0.18, 0, 0, P2); g.stroke(); }
  g.restore();
  g.lineWidth = k.o * 1.2; g.strokeStyle = OUTLINE; g.stroke(orb);
  if (titan) {
    // glowing meridian seams and vents
    seamGlow(g, k.A([cx + rx * 0.6, -ry * 0.75, cx, -ry * 0.98, cx - rx * 0.7, -ry * 0.7, cx + rx * 0.6, ry * 0.75, cx, ry * 0.98, cx - rx * 0.7, ry * 0.7]), 1, E, k.o * 1.2);
    for (const s of [-1, 1]) k.grille(cx - rx * 0.62, s * ry * 0.45, 0.4, 0.3, 5, 0.9);
  } else {
    // fuel cells racked around the rim + rear reactor
    for (let i = 0; i < 8; i++) {
      const a = Math.PI * 0.42 + (i / 7) * Math.PI * 1.16;
      const x = k.x(cx) + Math.cos(a) * k.x(rx) * 0.84, y = Math.sin(a) * k.y(ry) * 0.84;
      if (Math.cos(a) > 0.6) continue;
      canister(g, x, y, 0.22 * S * 0.35, 0.06 * S * 0.35, a + Math.PI / 2, E, k.o * 0.8);
    }
    k.reactor(cx - rx * 0.62, 0, 0.06 * S);
    for (const s of [-1, 1]) k.glow([cx + rx * 0.2, s * ry * 0.55, cx - rx * 0.3, s * ry * 0.72], k.o * 1.1);
  }
  // barbette collar for the dorsal gun
  k.dark(k.C(cx, 0, (titan ? 0.17 : 0.15) * S), cx - 0.1, -0.1, cx + 0.1, 0.1, 1.2);
  // cab
  const ce = k.B([0.5, 0, 0.49, 0.06, 0.44, 0.1, 0.32, 0.11, 0.24, 0.1, 0.2, 0]);
  k.plate(ce, 0.2, -0.11, 0.5, 0.11, 0.08, 1.4);
  k.seam([0.24, 0, 0.42, 0]);
  k.visor(0.47, -0.06, 0.47, 0.06, 0.012 * S);
  for (const s of [-1, 1]) k.eye(0.44, s * 0.07, 0.02 * S);
}

/* ------------------------------------------------------------------------------------------- running gear */

/** Shape-specific running gear (droid grammar): hoop wheels, single snail tread, juggernaut wheel trains. */
export function footMobility(g: Ctx, L: UnitLayout, pal: TeamPal, phase: number, rest: boolean, o: number): boolean {
  void rest;
  const id = L.mob.id, S = L.S;
  // hoop wheels: two huge rings flanking a slim hull - only their treads show from above
  if (id === 'wheels' && (L.shape === 'hunter' || L.shape === 'long' || L.shape === 'wedge')) {
    for (const s of [-1, 1]) hoopWheel(g, 0, s * (0.5 * L.Y - 0.07 * S), 0.94 * L.X, 0.13 * S, phase, pal, o);
    return true;
  }
  if (!SPECS[L.shape]) return false;
  // single wide snail tread under a wedge, outrigger skids either side
  if (id === 'treads' && L.shape === 'riot') {
    for (const s of [-1, 1]) {
      beam(g, 0, s * 0.18 * L.Y, 0.05 * S, -0.1 * L.X, s * 0.44 * L.Y, 0.04 * S, METAL.light, METAL.dark, o);
      const sk = new Path2D(); roundRect(sk, -0.3 * L.X, s * 0.44 * L.Y - 0.06 * S, 0.5 * L.X, 0.12 * S, 0.06 * S);
      fillOut(g, sk, METAL.dark, o);
    }
    bigTread(g, -0.48 * L.X, 0.48 * L.X, 0, 0.5 * L.Y, phase, S, o);
    return true;
  }
  // wheel trains: five / six tall wheels a side on huge walking-beam bogies
  if ((id === 'halftrack' && (L.shape === 'juggernaut' || L.shape === 'titan')) || (id === 'treads' && (L.shape === 'goliath' || L.shape === 'juggernaut'))) {
    const n = L.X >= 4 ? 6 : 5;
    const span = 0.84 * L.X, y = 0.5 * L.Y - 0.07 * S, wl = (span / n) * 0.92, ww = 0.2 * S;
    for (const s of [-1, 1]) {
      g.strokeStyle = OUTLINE; g.lineWidth = 0.09 * S; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-span / 2, s * y); g.lineTo(span / 2, s * y); g.stroke();
      g.strokeStyle = METAL.dark; g.lineWidth = 0.06 * S; g.stroke();
      for (let i = 0; i < n; i++) {
        const x = -span / 2 + span * (i + 0.5) / n;
        bigWheel(g, x, s * y, wl, ww, phase + i * 0.13, o);
      }
    }
    return true;
  }
  return false;
}

function hoopWheel(g: Ctx, x: number, y: number, len: number, w: number, phase: number, pal: TeamPal, o: number): void {
  // tyre band
  const band = new Path2D(); roundRect(band, x - len / 2, y - w / 2, len, w, w * 0.5);
  g.fillStyle = METAL.rubber; g.fill(band);
  g.save(); g.clip(band);
  g.strokeStyle = METAL.rubberHi; g.lineWidth = w * 0.35;
  const sp = w * 0.9;
  g.beginPath(); for (let xx = x - len / 2 - sp + phase * sp; xx < x + len / 2 + sp; xx += sp) { g.moveTo(xx, y - w / 2); g.lineTo(xx + w * 0.3, y + w / 2); } g.stroke();
  // curvature: ends darken (the hoop curves away from the camera)
  const gr = g.createLinearGradient(x - len / 2, 0, x + len / 2, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0.7)'); gr.addColorStop(0.25, 'rgba(0,0,0,0)'); gr.addColorStop(0.75, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.7)');
  g.fillStyle = gr; g.fillRect(x - len / 2, y - w / 2, len, w);
  g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(x - len / 2, y - w / 2, len, w * 0.25);
  g.restore();
  g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke(band);
  // team-armour hub fairing at the centre
  const hub = new Path2D(); roundRect(hub, x - len * 0.12, y - w * 0.72, len * 0.24, w * 1.44, w * 0.4);
  g.fillStyle = shade(pal.dark, 0.1); g.fill(hub); g.lineWidth = o * 0.8; g.strokeStyle = OUTLINE; g.stroke(hub);
  dot(g, x, y, w * 0.3, METAL.light);
}

function bigTread(g: Ctx, x0: number, x1: number, y: number, w: number, phase: number, S: number, o: number): void {
  const band = new Path2D(); roundRect(band, x0, y - w / 2, x1 - x0, w, w * 0.25);
  g.fillStyle = METAL.rubber; g.fill(band);
  g.save(); g.clip(band);
  const sp = 0.12 * S;
  for (let x = x0 - sp + phase * sp; x < x1 + sp; x += sp) {
    g.fillStyle = METAL.base; g.fillRect(x, y - w / 2, sp * 0.6, w);
    g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(x, y - w / 2, sp * 0.14, w);
  }
  const gr = g.createLinearGradient(0, y - w / 2, 0, y + w / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.3, 'rgba(0,0,0,0)'); gr.addColorStop(0.7, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = gr; g.fillRect(x0, y - w / 2, x1 - x0, w);
  g.restore();
  g.lineWidth = o * 1.1; g.strokeStyle = OUTLINE; g.stroke(band);
}

function bigWheel(g: Ctx, x: number, y: number, len: number, w: number, phase: number, o: number): void {
  const band = new Path2D(); roundRect(band, x - len / 2, y - w / 2, len, w, Math.min(w, len) * 0.45);
  g.fillStyle = METAL.rubber; g.fill(band);
  g.save(); g.clip(band);
  g.strokeStyle = METAL.rubberHi; g.lineWidth = len * 0.1;
  const sp = len * 0.28;
  g.beginPath(); for (let xx = x - len / 2 - sp + (phase % 1) * sp; xx < x + len / 2 + sp; xx += sp) { g.moveTo(xx, y - w / 2); g.lineTo(xx, y + w / 2); } g.stroke();
  const gr = g.createLinearGradient(x - len / 2, 0, x + len / 2, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(0.35, 'rgba(0,0,0,0)'); gr.addColorStop(0.65, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = gr; g.fillRect(x - len / 2, y - w / 2, len, w);
  g.restore();
  g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke(band);
  dot(g, x, y, w * 0.22, METAL.light); g.lineWidth = o * 0.6; g.strokeStyle = OUTLINE; g.stroke();
}

/* ------------------------------------------------------------------------------------------- parts / legs / lights */

const kxy = (L: UnitLayout) => [L.X / L.S, L.Y / L.S] as const;

/** Animated parts for footprint frames: the shape's parts with pivots spread to the footprint and weapon points. */
function footParts(L: UnitLayout): PartDef[] | null {
  if (!SPECS[L.shape]) return null;
  const S = L.S;
  const [kx, ky] = kxy(L);
  const ps = buildParts(L);
  const spread = (p: PartDef) => { if (p.parent === undefined) { p.px *= kx; p.py *= ky; } };
  switch (L.shape) {
    case 'mantis':
      for (const p of ps) { p.px = 0.2 * L.X; p.py = Math.sign(p.py) * 0.12 * L.Y; p.mountAt = [0.16 * S, Math.sign(p.py) * 0.115 * S]; }
      break;
    case 'crab':
      for (const p of ps) if (p.parent === undefined) { const s = Math.sign(p.py); p.px = 0.22 * L.X; p.py = s * 0.34 * L.Y; p.mountAt = [0.16 * S, s * 0.11 * S]; }
      break;
    case 'warlord':
      for (const p of ps) { const s = Math.sign(p.py); p.px = -0.02 * L.X; p.py = s * 0.4 * L.Y; p.mountAt = [0.34 * S, s * 0.05 * S]; }
      break;
    case 'scorpion': {
      // claws (2 x [arm, finger]) then the tail chain (root + relative links, scaled along the length)
      for (let j = 0; j < ps.length; j++) {
        const p = ps[j];
        if (j < 4) { if (p.parent === undefined) { const s = Math.sign(p.py); p.px = 0.3 * L.X; p.py = s * 0.17 * L.Y; p.mountAt = [0.21 * S, s * 0.16 * S]; } continue; }
        if (p.parent === undefined) { p.px = -0.3 * L.X; p.py = 0; } else { p.px *= kx * 0.85; p.py *= ky * 0.95; }
        if (p.mounts) p.mountAt = [0, 0];
      }
      break;
    }
    case 'centipede': {
      // cars: spread down the length (head shears keep their place on the cab)
      const cars = ps.filter((p) => p.ext >= 0.2 * S);
      const n = cars.length;
      cars.forEach((p, j) => { p.px = (-0.44 + (j * 0.71) / (n - 1)) * L.X; p.py = 0; if (p.mounts) p.mountAt = [0, 0]; });
      for (const p of ps) if (!cars.includes(p)) { p.px = 0.48 * L.X; p.py = Math.sign(p.py) * 0.06 * L.Y; }
      break;
    }
    case 'broodmother': case 'arachne':
      for (const p of ps) { p.px = 0.49 * L.X; p.py = Math.sign(p.py) * 0.035 * L.Y; }
      break;
    default:
      for (const p of ps) spread(p);
  }
  return ps;
}

function footRig(L: UnitLayout): LegRig | null {
  const legs: LegRig['legs'] = [];
  if (L.shape === 'saucer') {
    // tripod walker: one leg forward, two swept back - the disc rides high on three long stilts
    for (const [a, grp] of [[0, 0], [2.2, 1], [-2.2, 1]] as [number, number][]) legs.push({ hx: Math.cos(a) * 0.2, hy: Math.sin(a) * 0.2, fx: Math.cos(a) * 0.78, fy: Math.sin(a) * 0.74, grp });
    return { legs, w: 0.07, stride: 0.1, big: false, armour: true, style: 'ind', foot: true };
  }
  if (!SPECS[L.shape]) return null;
  const row = (xs: number[], hy: number, fy: number, sweep: number[]) => xs.forEach((x, i) => { for (const s of [-1, 1]) legs.push({ hx: x, hy: s * hy, fx: x + sweep[i], fy: s * fy, grp: (i + (s > 0 ? 1 : 0)) % 2 }); });
  const radial = (cx: number, hr: number, ry: number, rx: number, angs: number[]) => angs.forEach((a, i) => { for (const s of [-1, 1]) legs.push({ hx: cx + Math.cos(a) * hr, hy: s * Math.sin(a) * hr * 1.2, fx: cx + Math.cos(a) * rx, fy: s * Math.sin(a) * ry, grp: (i + (s > 0 ? 1 : 0)) % 2 }); });
  let w = 0.065, stride = 0.08, armour = false, style: LegRig['style'] = 'ind';
  switch (L.shape) {
    case 'mantis': row([0.08, -0.08], 0.1, 0.46, [0.22, -0.3]); w = 0.06; stride = 0.12; style = 'sleek'; break;
    case 'crab': row([0.16, -0.06, -0.26], 0.32, 0.5, [0.08, -0.02, -0.12]); w = 0.075; stride = 0.05; armour = true; style = 'stub'; break;
    case 'scorpion': row([0.22, 0.08, -0.06, -0.2], 0.24, 0.5, [0.06, 0.02, -0.02, -0.08]); w = 0.06; stride = 0.05; armour = true; break;
    case 'centipede': row([0.36, 0.2, 0.05, -0.1, -0.25, -0.4], 0.24, 0.48, [0.02, 0.01, 0, -0.01, -0.02, -0.03]); w = 0.055; stride = 0.03; style = 'stub'; break;
    case 'broodmother': radial(-0.06, 0.3, 0.7, 0.72, [0.55, 1.15, 1.9, 2.55]); w = 0.055; stride = 0.06; armour = true; break;
    case 'arachne': radial(-0.06, 0.28, 0.72, 0.74, [0.5, 1.1, 1.85, 2.6]); w = 0.045; stride = 0.06; armour = true; style = 'sleek'; break;
    case 'warlord': row([0.2, 0.0, -0.22], 0.3, 0.5, [0.1, 0, -0.1]); w = 0.07; stride = 0.08; armour = true; break;
    case 'titan': row([0.14, -0.1, -0.34], 0.32, 0.5, [0.06, 0, -0.06]); w = 0.07; stride = 0.06; armour = true; break;
    case 'goliath': case 'leviathan': case 'juggernaut': case 'siegeplat': case 'riot': case 'cross': case 'long': case 'hunter': case 'citadel': case 'colossal': {
      const n = L.X / L.Y >= 1.6 ? 4 : 3;
      const xs = Array.from({ length: n }, (_, i) => 0.3 - (i * 0.6) / (n - 1));
      row(xs, 0.3, 0.52, xs.map((x) => x * 0.15));
      w = L.S >= 4 ? 0.05 : 0.06; stride = 0.05; armour = L.S >= 3;
      break;
    }
    default: return null;
  }
  return { legs, w, stride, big: L.S >= 4, armour, style, foot: true };
}

function footCreatureLights(L: UnitLayout): CLight[] | null {
  if (!SPECS[L.shape]) return null;
  const X = L.X, Y = L.Y, S = L.S;
  const eye = (u: number, v: number, r: number) => [-1, 1].map((s) => ({ x: u * X, y: s * v * Y, r: r * S, k: 'eye' as const, ph: s }));
  switch (L.shape) {
    case 'mantis': return eye(0.44, 0.11, 0.06);
    case 'crab': return eye(0.3, 0.16, 0.03);
    case 'warlord': return [{ x: 0.31 * X, y: 0, r: 0.05 * S, k: 'eye', ph: 0 }];
    case 'scorpion': return eye(0.27, 0.13, 0.025);
    case 'centipede': return eye(0.41, 0.15, 0.025);
    case 'broodmother': case 'arachne': return eye(0.44, 0.07, 0.03);
  }
  return [];
}

const gl = new Map<string, GLight[]>();
function footGiantLights(L: UnitLayout): GLight[] | null {
  if (!SPECS[L.shape]) return null;
  const key = `${L.shape}|${L.X}|${L.Y}|${L.S}`;
  let o = gl.get(key);
  if (o) return o;
  const X = L.X, Y = L.Y, S = L.S;
  o = [];
  const nav = (u: number, v: number, s: number) => o!.push({ x: u * X, y: v * Y, r: 0.05 * S, k: 'blink', ph: s, col: s < 0 ? '#ff4040' : '#40ff70' });
  switch (L.shape) {
    case 'goliath':
      o.push({ x: -0.24 * X, y: -0.04 * Y, r: 0.11 * S, k: 'radar' });
      for (const s of [-1, 1]) { nav(0.3, s * 0.47, s); o.push({ x: -0.47 * X, y: s * 0.35 * Y, r: 0.07 * S * 0.5, k: 'stack' }); o.push({ x: -0.43 * X, y: s * 0.15 * Y, r: 0.1 * S, k: 'vent' }); o.push({ x: 0.42 * X, y: s * 0.14 * Y, r: 0.07 * S, k: 'visor' }); }
      break;
    case 'leviathan':
      o.push({ x: 0.05 * X, y: 0, r: 0.13 * S, k: 'radar' });
      o.push({ x: 0.075 * X, y: 0, r: 0.1 * S, k: 'visor' });
      for (const s of [-1, 1]) { o.push({ x: -0.1 * X, y: s * 0.12 * Y, r: 0.026 * S, k: 'stack' }); nav(0.44, s * 0.12, s); }
      for (const v of [-0.2, 0, 0.2]) o.push({ x: -0.5 * X, y: v * Y, r: 0.05 * S, k: 'engine', dir: Math.PI });
      break;
    case 'carrier':
      o.push({ x: 0.0, y: -0.12 * Y, r: 0.12 * S, k: 'radar' });
      o.push({ x: 0.06 * X, y: -0.12 * Y, r: 0.07 * S, k: 'visor' });
      for (const s of [-1, 1]) { nav(-0.13, s * 0.49, s); for (const v of [0.07, 0.17]) o.push({ x: -0.47 * X, y: s * v * Y, r: 0.05 * S, k: 'engine', dir: Math.PI }); }
      break;
    case 'colossal':
      o.push({ x: 0.03 * X, y: 0, r: 0.075 * S, k: 'core' });
      o.push({ x: 0.3 * X, y: 0, r: 0.1 * S, k: 'visor' });
      o.push({ x: -0.26 * X, y: 0, r: 0.1 * S, k: 'vent' });
      for (const s of [-1, 1]) { o.push({ x: -0.4 * X, y: s * 0.1 * Y, r: 0.042 * S, k: 'stack' }); nav(-0.02, s * 0.48, s); }
      break;
    case 'broodmother':
      o.push({ x: -0.32 * X, y: 0, r: 0.05 * S, k: 'core' });
      o.push({ x: 0.46 * X, y: 0, r: 0.08 * S, k: 'visor' });
      for (const s of [-1, 1]) nav(-0.1, s * 0.4, s);
      break;
    case 'arachne':
      o.push({ x: 0.46 * X, y: 0, r: 0.09 * S, k: 'visor' });
      for (const s of [-1, 1]) { nav(-0.24, s * 0.34, s); o.push({ x: -0.31 * X, y: s * 0.16 * Y, r: 0.06 * S, k: 'vent', ph: s }); }
      break;
    case 'citadel':
      o.push({ x: 0.08 * X, y: 0, r: 0.06 * S, k: 'core' });
      o.push({ x: 0.385 * X, y: 0.385 * Y, r: 0.17 * S, k: 'radar' });
      for (const sx of [1, -1]) for (const sy of [-1, 1]) o.push({ x: sx * 0.385 * X, y: sy * 0.385 * Y, r: 0.08 * S, k: 'vent', ph: sx + sy * 2 });
      o.push({ x: 0.415 * X, y: 0, r: 0.09 * S, k: 'visor' });
      for (const s of [-1, 1]) nav(0.44, s * 0.13, s);
      break;
  }
  gl.set(key, o);
  return o;
}

const gs = new Map<string, number[]>();
function footStrips(L: UnitLayout): number[] | null {
  if (!SPECS[L.shape]) return null;
  const key = `${L.shape}|${L.X}|${L.Y}`;
  let o = gs.get(key);
  if (o) return o;
  const u: Record<string, number[]> = {
    goliath: [0.22, -0.4, -0.06, -0.4, 0.22, 0.4, -0.06, 0.4],
    leviathan: [0.12, -0.39, -0.34, -0.39, 0.12, 0.39, -0.34, 0.39],
    carrier: [-0.16, -0.32, 0.0, -0.32, -0.16, 0.32, 0.0, 0.32],
    colossal: [0.12, -0.05, 0.19, -0.15, 0.12, 0.05, 0.19, 0.15, 0.04, -0.44, 0.27, -0.44, 0.04, 0.44, 0.27, 0.44],
    broodmother: [-0.04, -0.22, -0.2, -0.29, -0.04, 0.22, -0.2, 0.29],
    arachne: [0.06, -0.27, -0.2, -0.35, 0.06, 0.27, -0.2, 0.35],
    citadel: [-0.33, -0.345, 0.33, -0.345, -0.33, 0.345, 0.33, 0.345, -0.345, -0.25, -0.345, 0.25, 0.415, -0.085, 0.415, 0.085],
  };
  const f = u[L.shape] ?? [];
  o = f.map((v, i) => (i % 2 ? v * L.Y : v * L.X));
  gs.set(key, o);
  return o;
}

creatureHooks.parts = footParts;
creatureHooks.rig = footRig;
creatureHooks.lights = footCreatureLights;
fxHooks.lights = footGiantLights;
fxHooks.strips = footStrips;

void piston; void cjoint; void bevel; void ellU;
