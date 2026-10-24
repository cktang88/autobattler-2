// Aero kit: "stylized realistic" construction parts for aircraft (chassis/air.ts, chassis/bombers.ts), the airborne
// counterpart of the hard-surface kit (hs-kit.ts).
//
// The old airframes were smooth superellipse lofts painted all over in the team armour colour with a few accent
// boxes: they read as moulded toys. Real aircraft (and the stylized-realistic references) read through:
//   * FACETED sections with chines and a flat spine, broken into panels (dark panel-break bands, a dorsal spine panel);
//   * thin wings with real thickness whose surface is broken up by function: leading-edge slats, flaps / ailerons with
//     hinge gaps, a wingtip cap with nav lights, "no step" walkway lines;
//   * dark functional openings: intakes with a lip, a splitter plate and a black duct; nozzles; gear-door seams;
//   * scale cues: framed canopies, blade antennas, pitot probes, sensor bumps, pylons with sway braces;
//   * a paint plan per real aircraft: light-grey SHELL on fuselage and wings, darker MECH at intakes / nozzles /
//     gear wells / walkways, the muted team ARMOUR tint only on tail surfaces, wingtips, nose panels and spine, and
//     full-chroma ACCENT kept for small, readable stripes / chevrons / roundels on the TOP surfaces (the RTS camera
//     sees the top), soot streaks behind exhausts.
// Rivet lines come from the skin textures (skins.ts 'air' / 'rotor'), never from geometry.
// Everything writes into the unit's Bld (merged per material): detail costs triangles, never draw calls.
//
// FRAME: hull-local, +x nose, +y up, +z right. Fuselage stations are [x, cy, ry, rz] ordered nose (high x) -> tail.

import * as THREE from 'three';
import { Bld, mtx, type MatLike, type P2, type V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';

/** plain 12-triangle box (small parts: no bevel, so detail stays cheap) */
export function bx(b: Bld, mat: MatLike, w: number, h: number, d: number, x: number, y: number, z: number, rot?: V3): void {
  b.g(new THREE.BoxGeometry(w, h, d), mat, mtx([x, y, z], rot));
}

// =====================================================================================================================
// faceted fuselage
// =====================================================================================================================

/** section shape: half widths (fraction of rz) and heights (fraction of ry) of the keel / lower side / chine /
 *  shoulder / spine. Defaults = a chined fighter section (flat spine, sharp chine just below the middle). */
export interface Facet { kw?: number; lw?: number; ly?: number; chy?: number; sh?: number; shy?: number; tw?: number }
export const SEC_JET: Facet = { kw: 0.3, lw: 0.74, ly: -0.7, chy: -0.08, sh: 0.82, shy: 0.52, tw: 0.4 };
/** boxy transport / helicopter section: wide flat floor, near-vertical sides, chamfered roof edges */
export const SEC_BOX: Facet = { kw: 0.72, lw: 0.97, ly: -0.72, chy: 0.05, sh: 0.95, shy: 0.6, tw: 0.66 };
/** rounder airliner-like section for big bombers (still faceted, 12 points worth of silhouette in 10) */
export const SEC_ROUND: Facet = { kw: 0.42, lw: 0.86, ly: -0.62, chy: 0.0, sh: 0.88, shy: 0.55, tw: 0.48 };

export type FSt = [number, number, number, number];

/** 10-point faceted ring at x (index 0/1 keel, 2/9 lower side, 3/8 chine, 4/7 shoulder, 5/6 spine) */
export function fRing(x: number, cy: number, ry: number, rz: number, cz = 0, k: Facet = SEC_JET): V3[] {
  const kw = k.kw ?? 0.3, lw = k.lw ?? 0.74, ly = k.ly ?? -0.7, chy = k.chy ?? -0.08, sh = k.sh ?? 0.82, shy = k.shy ?? 0.52, tw = k.tw ?? 0.4;
  const P = (z: number, y: number): V3 => [x, cy + y * ry, cz + z * rz];
  return [P(-kw, -1), P(kw, -1), P(lw, ly), P(1, chy), P(sh, shy), P(tw, 1), P(-tw, 1), P(-sh, shy), P(-1, chy), P(-lw, ly)];
}

/** a faceted fuselage (or nacelle / boom / gasbag) described by stations, with surface queries */
export class Fuse {
  st: FSt[]; cz: number; k: Facet;
  constructor(st: FSt[], cz = 0, k: Facet = SEC_JET) { this.st = st; this.cz = cz; this.k = k; }
  /** interpolated [cy, ry, rz] at x (clamped to the ends) */
  at(x: number): [number, number, number] {
    const s = this.st;
    if (x >= s[0][0]) return [s[0][1], s[0][2], s[0][3]];
    if (x <= s[s.length - 1][0]) { const e = s[s.length - 1]; return [e[1], e[2], e[3]]; }
    let i = 0;
    while (i < s.length - 2 && s[i + 1][0] > x) i++;
    const p = s[i], q = s[i + 1], f = (p[0] - x) / (p[0] - q[0] || 1);
    return [p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f, p[3] + (q[3] - p[3]) * f];
  }
  ring(x: number, off = 0): V3[] { const [cy, ry, rz] = this.at(x); return fRing(x, cy, Math.max(0.002, ry + off), Math.max(0.002, rz + off), this.cz, this.k); }
  top(x: number): number { const [cy, ry] = this.at(x); return cy + ry; }
  bot(x: number): number { const [cy, ry] = this.at(x); return cy - ry; }
  w(x: number): number { return this.at(x)[2]; }
  cy(x: number): number { return this.at(x)[0]; }
  /** half width of the flat spine at x */
  spineW(x: number): number { return this.at(x)[2] * (this.k.tw ?? 0.4); }
  /** station xs strictly between x0 > x1 plus both ends (for lofting skin parts that follow the fuselage) */
  xs(x0: number, x1: number): number[] {
    const hi = Math.max(x0, x1), lo = Math.min(x0, x1);
    return [hi, ...this.st.map((s) => s[0]).filter((x) => x < hi - 1e-4 && x > lo + 1e-4), lo];
  }
}

/** loft the fuselage skin */
export function fuselage(b: Bld, mat: MatLike, F: Fuse): void {
  b.loft(mat, F.st.map((s) => F.ring(s[0])));
}

/** a full-section over-skin from x0 down to x1 standing `off` proud (radome, coloured nose / tail cone, cowl ring) */
export function overSkin(b: Bld, mat: MatLike, F: Fuse, x0: number, x1: number, off = 0.003): void {
  b.loft(mat, F.xs(x0, x1).map((x) => F.ring(x, off)));
}

/** panel break: a thin dark band standing just proud of the skin all round at x (reads as a panel seam from any
 *  angle, and as a crisp line across the spine from above) */
export function panelBreak(b: Bld, kit: Kit, F: Fuse, x: number, w = 0.012, mat?: MatLike): void {
  const e = Math.max(0.0025, F.at(x)[1] * 0.025);
  b.loft(mat ?? kit.mech, [F.ring(x + w / 2, e), F.ring(x - w / 2, e)]);
}

/** a skin panel over ring points i0..i1 (inclusive, ring order; wraps) from x0 down to x1, standing `off` proud with
 *  thickness th: dorsal spine panels, chine stripes, walkways, coloured nose / tail panels */
export function skinPanel(b: Bld, mat: MatLike, F: Fuse, x0: number, x1: number, i0: number, i1: number, off = 0.004, th = 0.006): void {
  const idx: number[] = [];
  for (let i = i0; ; i = (i + 1) % 10) { idx.push(i); if (i === i1) break; }
  const rings = F.xs(x0, x1).map((x) => {
    const o = F.ring(x, off + th), n = F.ring(x, off);
    return [...idx.map((i) => o[i]), ...idx.slice().reverse().map((i) => n[i])];
  });
  b.loft(mat, rings);
}
/** dorsal spine strip (ring points 5..6 plus a bit of the shoulders) from x0 to x1 */
export const spinePanel = (b: Bld, mat: MatLike, F: Fuse, x0: number, x1: number, off = 0.004, th = 0.006) => skinPanel(b, mat, F, x0, x1, 5, 6, off, th);

/** flat ribbon (stripe / soot streak / walkway) lying on a surface: centreline points with their surface heights,
 *  half width tapering w0 -> w1, thickness th */
export function ribbon(b: Bld, mat: MatLike, pts: V3[], w0: number, w1: number, th = 0.004): void {
  const n = pts.length;
  const rings = pts.map((p, i) => {
    const q = pts[Math.min(n - 1, i + 1)], r = pts[Math.max(0, i - 1)];
    const dx = q[0] - r[0], dz = q[2] - r[2], l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l, w = w0 + (w1 - w0) * (i / Math.max(1, n - 1));
    return [[p[0] - nx * w, p[1], p[2] - nz * w], [p[0] + nx * w, p[1], p[2] + nz * w], [p[0] + nx * w, p[1] + th, p[2] + nz * w], [p[0] - nx * w, p[1] + th, p[2] - nz * w]] as V3[];
  });
  b.loft(mat, rings);
}
/** soot streak on the fuselage spine / flank behind an exhaust: tapering dark ribbon following the skin */
export function soot(b: Bld, kit: Kit, F: Fuse, x0: number, x1: number, z: number, w: number): void {
  const xs = F.xs(x0, x1);
  ribbon(b, kit.mech, xs.map((x) => [x, F.top(x) + 0.003, z] as V3), w, w * 0.25, 0.003);
}

// =====================================================================================================================
// canopy, intakes, sensors
// =====================================================================================================================

/** Framed canopy: faceted glazing from x0 (windscreen foot, front) back to x1, sill at yb, half width w, height h;
 *  a raked windscreen, a bubble falling to the rear, windscreen bow + `bows` frame hoops and a centre spine, sills.
 *  frame = frame material (default shell, i.e. painted like the fuselage). */
export function canopy(b: Bld, kit: Kit, x0: number, x1: number, yb: number, w: number, h: number, o: { bows?: number; frame?: MatLike; rake?: number; cz?: number } = {}): void {
  const L = x0 - x1, rake = o.rake ?? 0.32, cz = o.cz ?? 0;
  const sec = (x: number, s: number, hh: number, ww = w): V3[] => [[x, yb, cz - ww], [x, yb, cz + ww], [x, yb + hh * 0.58, cz + ww * 0.86 * s + ww * (1 - s) * 0.5], [x, yb + hh, cz + ww * 0.42 * s], [x, yb + hh, cz - ww * 0.42 * s], [x, yb + hh * 0.58, cz - ww * 0.86 * s - ww * (1 - s) * 0.5]];
  const prof: [number, number, number][] = [[0, 0.05, 0.7], [rake, 1, 1], [0.62, 0.96, 1], [0.86, 0.7, 0.92], [1, 0.12, 0.8]];
  b.loft(kit.glass, prof.map(([f, hh, ww]) => sec(x0 - f * L, 1, h * hh, w * ww)));
  const fm = o.frame ?? kit.shell;
  const hoop = (f: number, hh: number, ww: number, t: number) => {
    const x = x0 - f * L;
    b.loft(fm, [sec(x + t / 2, 1, h * hh + 0.006, w * ww + 0.005), sec(x - t / 2, 1, h * hh + 0.006, w * ww + 0.005)]);
  };
  const t = Math.max(0.008, L * 0.035);
  hoop(rake, 1, 1, t * 1.3);
  const n = o.bows ?? 1;
  for (let i = 1; i <= n; i++) { const f = rake + ((0.86 - rake) * i) / (n + 1); hoop(f, 0.98 - (f - 0.6) * 0.6 * +(f > 0.6), 1, t); }
  // centre spine over the glazing, sills along both sides
  bx(b, fm, L * (1 - rake) * 0.9, t * 0.6, t * 0.9, x0 - L * (rake + (1 - rake) * 0.45), yb + h + 0.004, cz);
  for (const s of [-1, 1]) bx(b, fm, L * 1.02, t * 0.9, t * 1.1, x0 - L / 2, yb + t * 0.3, cz + s * (w * 0.9));
}

/** Intake: a lipped box duct facing +x at (x, y, z), w wide (z) by h tall, len long, with a black duct face, a raised
 *  lip and an optional boundary-layer splitter plate standing off the fuselage side (side = which side the fuselage
 *  is on: -1 = fuselage on -z, 0 = chin / no splitter). Ramp rakes the lip back from top to bottom. */
export function intake(b: Bld, kit: Kit, x: number, y: number, z: number, w: number, h: number, len: number, o: { side?: number; ramp?: number; mat?: MatLike; splitter?: boolean } = {}): void {
  const mat = o.mat ?? kit.shell, ramp = o.ramp ?? 0.25, side = o.side ?? 0;
  const r = h * ramp;
  // duct body: lofted box from the lip back, narrowing into the fuselage
  const sec = (xx: number, k: number, rk: number): V3[] => [[xx + rk, y - h / 2 * k, z - w / 2 * k], [xx + rk, y - h / 2 * k, z + w / 2 * k], [xx, y + h / 2 * k, z + w / 2 * k], [xx, y + h / 2 * k, z - w / 2 * k]];
  b.loft(mat, [sec(x, 1, -r), sec(x - len * 0.5, 0.98, -r * 0.5), sec(x - len, 0.82, 0)]);
  // lip frame (4 bars) and the black duct face just inside
  const t = Math.min(w, h) * 0.12;
  bx(b, kit.mech, t * 1.1, h * 0.84, w * 0.84, x - t * 1.4 - r * 0.5, y, z, [0, 0, Math.atan2(r, h)]);
  for (const s of [-1, 1]) {
    bx(b, mat, t * 1.4, t, w + t * 0.4, x - (s < 0 ? r : 0) + t * 0.2, y + s * (h / 2 - t * 0.3), z);
    bx(b, mat, t * 1.4, h + t * 0.2, t, x - r * 0.5 + t * 0.2, y, z + s * (w / 2 - t * 0.3), [0, 0, Math.atan2(r, h)]);
  }
  if (side && o.splitter !== false) {
    // splitter plate: thin plate between the intake and the fuselage, standing off on two little posts
    const pz = z + side * (w / 2 + t * 1.2);
    bx(b, kit.joint, len * 0.55, h * 1.06, t * 0.35, x - len * 0.2 + t, y, pz);
    for (const px of [x - len * 0.05, x - len * 0.38]) bx(b, kit.mech, t * 0.8, t * 0.8, t * 1.4, px, y, pz + side * t * 0.6);
  }
}

/** round engine intake facing +x (nacelles): lip ring + black face + a hub spinner */
export function roundIntake(b: Bld, kit: Kit, x: number, y: number, z: number, r: number, lipMat?: MatLike): void {
  b.lathe(lipMat ?? kit.shell, [[r * 0.8, 0], [r, r * 0.12], [r * 1.02, r * 0.35], [r * 0.82, r * 0.38], [r * 0.78, r * 0.05]], [x - r * 0.3, y, z], 'x', 12);
  b.cyl(kit.mech, r * 0.8, r * 0.8, r * 0.04, [x - r * 0.42, y, z], '-x', 10);
  b.lathe(kit.joint, [[0, 0], [r * 0.24, 0], [0, r * 0.3]], [x - r * 0.44, y, z], 'x', 8);
}

/** blade antenna (small swept fin) standing on y, along x */
export function bladeAntenna(b: Bld, kit: Kit, x: number, y: number, z: number, h: number, down = false): void {
  const s = down ? -1 : 1;
  b.loft(kit.mech, [
    [[x + h * 0.35, y, z - h * 0.05], [x - h * 0.35, y, z - h * 0.05], [x - h * 0.35, y, z + h * 0.05], [x + h * 0.35, y, z + h * 0.05]],
    [[x - h * 0.05, y + s * h, z - h * 0.03], [x - h * 0.35, y + s * h, z - h * 0.03], [x - h * 0.35, y + s * h, z + h * 0.03], [x - h * 0.05, y + s * h, z + h * 0.03]],
  ]);
}
/** pitot / nose probe pointing +x */
export function pitot(b: Bld, kit: Kit, x: number, y: number, z: number, len: number, r: number): void {
  b.strut(kit.joint, [x, y, z], [x + len * 0.55, y, z], r * 1.6, r, 6);
  b.strut(kit.steel, [x + len * 0.55, y, z], [x + len, y, z], r * 0.7, r * 0.5, 5);
}
/** sensor / EO turret bump: a faceted half-dome on (down = hanging) the skin, glazed window facing +x */
export function sensorBall(b: Bld, kit: Kit, x: number, y: number, z: number, r: number, down = true): void {
  const s = down ? -1 : 1;
  const up: P2[] = [[0, 0], [r, 0], [r * 0.92, r * 0.5], [r * 0.6, r * 0.88], [0, r]];
  b.lathe(kit.mech, down ? up.map(([a, c]) => [a, -c] as P2).reverse() : up, [x, y, z], 'y', 10);
  bx(b, kit.glass, r * 0.3, r * 0.5, r * 0.9, x + r * 0.8, y + s * r * 0.45, z);
}

/** closed landing-gear doors: a pair of flush door plates with dark seams on the belly (yb = belly height, plates
 *  lie just under it), l long, total width w */
export function gearDoors(b: Bld, kit: Kit, x: number, yb: number, z: number, l: number, w: number, mat?: MatLike): void {
  const t = Math.max(0.004, w * 0.05);
  bx(b, kit.mech, l + t * 2, t * 0.8, w + t * 2, x, yb - t * 0.2, z);
  for (const s of [-1, 1]) bx(b, mat ?? kit.shell, l, t, w / 2 - t * 0.4, x, yb - t * 0.6, z + s * (w / 4 + t * 0.1));
}

/** nav lights at a wingtip pair: port (-z) red-ish team accent lamp, starboard (+z) team glow, plus a white strobe */
export function tipLights(b: Bld, kit: Kit, x: number, y: number, z: number, s: number): void {
  bx(b, kit.accent, s * 1.8, s * 0.9, s * 1.1, x, y, -z);
  bx(b, kit.glow, s * 1.8, s * 0.9, s * 1.1, x, y, z);
  for (const zz of [-z, z]) bx(b, kit.lamp, s * 0.7, s * 0.7, s * 0.7, x - s * 1.6, y, zz);
}

// =====================================================================================================================
// wings and fins
// =====================================================================================================================

/** [leading-edge x, y, z (span), chord, thickness] */
export type Station = [number, number, number, number, number];

// aerofoil section (chord fraction, thickness fraction): top and bottom surfaces, matching foil()
const TOP: P2[] = [[0, 0], [0.1, 0.55], [0.4, 1], [0.8, 0.55], [1, 0]];
const BOT: P2[] = [[0, 0], [0.1, -0.4], [0.4, -0.6], [0.8, -0.35], [1, 0]];
function prof(p: P2[], f: number): number {
  let i = 0;
  while (i < p.length - 2 && p[i + 1][0] < f) i++;
  const a = p[i], c = p[i + 1], k = (f - a[0]) / (c[0] - a[0] || 1);
  return a[1] + (c[1] - a[1]) * Math.max(0, Math.min(1, k));
}

/** aerofoil ring: leading edge at le, chord along -x, thickness along `up` ('y' wings, 'z' fins) */
export function foil(le: V3, c: number, t: number, up: 'y' | 'z' = 'y'): V3[] {
  const p = (a: number, b: number): V3 => (up === 'y' ? [le[0] - a * c, le[1] + b * t, le[2]] : [le[0] - a * c, le[1], le[2] + b * t]);
  return [p(0, 0), p(0.1, 0.55), p(0.4, 1), p(0.8, 0.55), p(1, 0), p(0.8, -0.35), p(0.4, -0.6), p(0.1, -0.4)];
}

/** interpolate a station table at span coordinate s (|z| for wings, y for fins via `key`) -> a full station */
export function stAt(st: Station[], s: number, key: 1 | 2 = 2): Station {
  const a = Math.abs(s);
  const v = (q: Station) => Math.abs(q[key]);
  let i = 0;
  while (i < st.length - 2 && v(st[i + 1]) < a) i++;
  const p = st[i], q = st[i + 1];
  const f = Math.max(0, Math.min(1, (a - v(p)) / (v(q) - v(p) || 1)));
  return p.map((pv, k) => pv + (q[k] - pv) * f) as Station;
}
/** wing station table split at span z: [inner part, outer part] (shared station at the split) */
export function splitAt(st: Station[], z: number, key: 1 | 2 = 2): [Station[], Station[]] {
  const m = stAt(st, z, key), a = Math.abs(z);
  const inner = st.filter((q) => Math.abs(q[key]) < a - 1e-4), outer = st.filter((q) => Math.abs(q[key]) > a + 1e-4);
  return [[...inner, m], [m, ...outer]];
}

/** a skin patch on the TOP (or bottom) surface of a wing between span z0..z1 and chord fractions f0..f1, standing off
 *  by e with thickness th (stripes, walkway lines, hinge gaps, control surfaces, slats) */
export function wingSkin(b: Bld, mat: MatLike, st: Station[], z0: number, z1: number, f0: number, f1: number, o: { e?: number; th?: number; bottom?: boolean; up?: 'y' | 'z'; side?: number } = {}): void {
  const up = o.up ?? 'y', key = up === 'y' ? 2 : 1;
  const surf = o.bottom ? BOT : TOP, sg = o.bottom ? -1 : 1;
  const fs = [f0, ...TOP.map((p) => p[0]).filter((f) => f > f0 + 1e-3 && f < f1 - 1e-3), f1];
  const ring = (s: number) => {
    const [lx, y, z, c, t] = stAt(st, s, key);
    const e = o.e ?? Math.max(0.002, t * 0.06), th = o.th ?? Math.max(0.003, t * 0.08);
    const pt = (f: number, d: number): V3 => {
      const n = prof(surf, f) * t + sg * d;
      return up === 'y' ? [lx - f * c, y + n, z] : [lx - f * c, y, z + n * (o.side ?? 1)];
    };
    return [...fs.map((f) => pt(f, e + th)), ...fs.slice().reverse().map((f) => pt(f, e))];
  };
  b.loft(mat, [ring(z0), ring(z1)]);
}

export interface WingOpts {
  mat?: MatLike;
  /** muted-team wingtip cap from this |z| outward (0 = none) */
  tip?: number;
  tipMat?: MatLike;
  /** leading-edge slat span [z0, z1] (hinge line at 14% chord) */
  slat?: [number, number];
  /** flaps (inboard) and ailerons (outboard) spans; hinge at 74% chord */
  flaps?: [number, number][];
  /** full-chroma team stripe across the top at span [z0, z1] */
  stripe?: [number, number];
  /** walkway / no-step line from the root to this span */
  walk?: number;
  /** nav lights at the tip */
  lights?: number;
  /** skip the underside surfaces (small craft) */
  fine?: boolean;
}

/** Wing panel (one side: st already mirrored, z signed) with real thickness and functional surface breaks. */
export function aeroWing(b: Bld, kit: Kit, st: Station[], o: WingOpts = {}): void {
  const s = Math.sign(st[st.length - 1][2]) || 1, zt = Math.abs(st[st.length - 1][2]), zr = Math.abs(st[0][2]);
  const mat = o.mat ?? kit.shell;
  if (o.tip && o.tip < zt) {
    const [inner, outer] = splitAt(st, s * o.tip);
    b.loft(mat, inner.map(([x, y, z, c, t]) => foil([x, y, z], c, t)));
    b.loft(o.tipMat ?? kit.armor, outer.map(([x, y, z, c, t]) => foil([x, y, z], c, t)));
  } else b.loft(mat, st.map(([x, y, z, c, t]) => foil([x, y, z], c, t)));
  const gap = (z0: number, z1: number, f0: number, f1: number) => wingSkin(b, kit.mech, st, s * z0, s * z1, f0, f1, { th: 0.002 });
  if (o.slat) { gap(o.slat[0], o.slat[1], 0.13, 0.15); }
  for (const [z0, z1] of o.flaps ?? []) {
    // hinge gap line + raised control surface + end gaps
    gap(z0, z1, 0.72, 0.745);
    wingSkin(b, mat, st, s * (z0 + 0.01), s * (z1 - 0.01), 0.75, 0.99, {});
    gap(z0, z0 + 0.012, 0.74, 1); gap(z1 - 0.012, z1, 0.74, 1);
  }
  if (o.stripe) wingSkin(b, kit.accent, st, s * o.stripe[0], s * o.stripe[1], 0.04, 0.7, {});
  if (o.walk) { gap(zr + 0.01, o.walk, 0.2, 0.22); gap(zr + 0.01, o.walk, 0.55, 0.57); }
  if (o.lights) { const [lx, y, , c, t] = stAt(st, zt * 0.999); tipLightsOne(b, kit, lx - c * 0.25, y + t * 0.2, s * zt, o.lights, s); }
}
function tipLightsOne(b: Bld, kit: Kit, x: number, y: number, z: number, sz: number, s: number): void {
  bx(b, s < 0 ? kit.accent : kit.glow, sz * 1.8, sz * 0.8, sz * 1.0, x + sz * 0.6, y, z);
  bx(b, kit.lamp, sz * 0.7, sz * 0.6, sz * 0.7, x - sz * 1.4, y, z);
}

/** Fin (vertical / canted) through stations root -> tip ([le x, y, z, chord, thickness along z]): muted team paint,
 *  a rudder hinge line and rudder surface on both faces, optional full-chroma band and tip beacon. */
export function aeroFin(b: Bld, kit: Kit, st: Station[], o: { mat?: MatLike; rudder?: [number, number]; band?: [number, number]; beacon?: number } = {}): void {
  const mat = o.mat ?? kit.armor;
  b.loft(mat, st.map(([x, y, z, c, t]) => foil([x, y, z], c, t, 'z')));
  const y0 = st[0][1], y1 = st[st.length - 1][1], hgt = y1 - y0;
  for (const side of [-1, 1]) {
    if (o.rudder) {
      const [a, c] = o.rudder;
      wingSkin(b, kit.mech, st, y0 + hgt * a, y0 + hgt * c, 0.7, 0.72, { up: 'z', side, th: 0.002 });
    }
    if (o.band) wingSkin(b, kit.accent, st, y0 + hgt * o.band[0], y0 + hgt * o.band[1], 0.08, 0.68, { up: 'z', side });
  }
  if (o.beacon) { const [lx, yy, z, c] = st[st.length - 1]; bx(b, kit.lamp, o.beacon * 1.4, o.beacon, o.beacon, lx - c * 0.5, yy + o.beacon * 0.3, z); }
}

// =====================================================================================================================
// pylons, stores, nacelles
// =====================================================================================================================

/** Swept pylon from the underside yTop down to yBot at (x, z), chord l at the root: a thin aerofoil-ish blade with an
 *  ejector rack at its foot and a pair of sway-brace pads. */
export function pylon(b: Bld, kit: Kit, x: number, yTop: number, yBot: number, z: number, l: number, t: number, mat?: MatLike): void {
  const h = yTop - yBot;
  const sec = (y: number, c: number, xs: number): V3[] => [[xs + c * 0.5, y, z], [xs + c * 0.2, y, z + t / 2], [xs - c * 0.5, y, z + t * 0.3], [xs - c * 0.5, y, z - t * 0.3], [xs + c * 0.2, y, z - t / 2]];
  b.loft(mat ?? kit.shell, [sec(yTop + 0.01, l, x), sec(yBot, l * 0.8, x - h * 0.15)]);
  bx(b, kit.joint, l * 0.62, t * 0.9, t * 1.8, x - h * 0.15, yBot - t * 0.3, z);
  for (const s of [-1, 1]) bx(b, kit.mech, t * 0.7, t * 0.9, t * 0.7, x - h * 0.15 + s * l * 0.26, yBot - t * 0.7, z);
}

/** engine nacelle (podded engine) around x0 (intake face) -> x1 (exhaust): faceted body, intake lip, a muted-team
 *  band, dark exhaust can; the hot nozzle itself is a lift unit (mobility/air.ts) at x1. */
export function nacelle(b: Bld, kit: Kit, x0: number, x1: number, y: number, z: number, r: number, o: { mat?: MatLike; band?: MatLike | null; k?: Facet } = {}): Fuse {
  const L = x0 - x1;
  const F = new Fuse([[x0, y, r * 0.92, r * 0.92], [x0 - L * 0.12, y, r, r], [x0 - L * 0.7, y, r * 0.98, r * 0.98], [x1 + L * 0.06, y, r * 0.84, r * 0.84], [x1, y, r * 0.8, r * 0.8]], z, o.k ?? { kw: 0.42, lw: 0.86, ly: -0.62, chy: 0, sh: 0.86, shy: 0.6, tw: 0.42 });
  fuselage(b, o.mat ?? kit.shell, F);
  roundIntake(b, kit, x0 + r * 0.32, y, z, r * 0.9);
  panelBreak(b, kit, F, x0 - L * 0.32, Math.max(0.008, L * 0.02));
  if (o.band !== null) skinPanel(b, o.band ?? kit.armor, F, x0 - L * 0.12, x0 - L * 0.28, 0, 9, 0.003, 0.004);
  b.cyl(kit.mech, r * 0.84, r * 0.78, L * 0.08, [x1 + L * 0.06, y, z], '-x', 10);
  return F;
}

/** quick helper: the same fn for both sides */
export const sides = (fn: (s: -1 | 1) => void) => { fn(-1); fn(1); };
/** mirror a station table to side s */
export const mirrorSt = (st: Station[], s: number): Station[] => st.map(([x, y, z, c, t]) => [x, y, z * s, c, t]);
/** angle helper for loft rotation-free parts */
export const deg = (d: number) => THREE.MathUtils.degToRad(d);
