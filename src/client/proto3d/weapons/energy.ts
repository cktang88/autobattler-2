// Energy, flame and disruption weapons: curved pod housings (vs the angular kinetic turrets), lens emitters, heat
// dishes, plasma chambers with containment rings, flamers with pressure tanks, tesla coil stacks topped by orbs, stun
// forks, EMP coil guns, disruptor tuning forks, sonic horns and graviton rings.

import { pod } from '../chassis/shapes.ts';
import type { MatLike } from '../materials.ts';
import type { Bld } from '../geo.ts';
import { accent, band, ball, barrel, bx, capsule, cbox, hazardRings, type WCtx } from './wkit.ts';

export function buildEnergy(C: WCtx): void {
  const v = C.mod.visual, id = C.mod.id;
  C.t.shot = 'beam';
  C.t.rate = 0.7;
  switch (v) {
    case 'laser': return C.nb >= 2 ? twinLaser(C) : laser(C);
    case 'heatray': return heatDish(C);
    case 'plasma': return plasma(C);
    case 'flamer': return flamer(C);
    case 'tesla': return C.tier >= 5 ? stormCore(C) : C.tier === 4 ? stormTower(C) : id === 'arclance' ? arcLance(C) : teslaCoil(C);
    case 'emp': return id === 'stungun' ? stunFork(C) : id === 'disarm' ? ringEmitter(C, C.kit.rail) : empGun(C);
    case 'slowbeam': return tuningFork(C);
    case 'sonic': return horn(C);
    case 'gravity': return ringEmitter(C, C.kit.plasma, true);
  }
}

/** curved egg housing (Tau-like) sitting on the ring */
const eggHousing = (C: WCtx, l = 0.95, w = 0.8, h = 0.42, x = -0.1, mat: MatLike = C.kit.hull) =>
  pod(C.b, mat, [C.r * x, C.y0 + C.r * h * 0.55, 0], C.r * l, C.r * h, C.r * w, 10, 6, 2.4, 0.6);

/** stepped lens emitter along +X: breech collar, slim body with a stack of cooling fins, wide lens housing, glass lens,
 *  glowing core (the fin stack + lens bell is the laser's silhouette; a plain fat tube reads as a gun). */
function lensEmitter(C: WCtx, B: Bld, e: number, len: number, z = 0, core: MatLike = C.kit.rail) {
  const { kit } = C;
  B.lathe(kit.metal, [[0, 0], [e * 0.85, 0], [e * 0.85, len * 0.12], [e * 0.58, len * 0.16], [e * 0.58, len * 0.76], [e * 1.25, len * 0.8], [e * 1.25, len * 0.96], [e * 1.08, len], [0, len]], [0, 0, z], 'x', 8);
  for (const f of [0.26, 0.38, 0.5, 0.62]) band(B, kit.trim, len * f, 0, z, e * 1.1, len * 0.045, 6);
  B.cyl(kit.glass, e * 1.0, e * 1.0, e * 0.12, [len, 0, z], 'x', 8);
  B.cyl(core, e * 0.45, e * 0.45, e * 0.14, [len + e * 0.02, 0, z], 'x', 6);
  C.muzzle(len + e * 0.4, 0, z);
}

function laser(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  ball(b, kit.hull, 0, y0 + r * 0.38, 0, r * 0.78, 0.6, 10);
  C.t.pitch.position.set(r * 0.4, y0 + r * 0.4, 0);
  ball(p, kit.trim, 0, 0, 0, r * 0.3, 1, 8, 'x');
  lensEmitter(C, rc, r * 0.17, C.D * 1.05);
  accent(C, -r * 0.25, y0 + r * 0.85, 0, r * 0.35, r * 0.12);
  C.t.rate = 0.5;
}

function twinLaser(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  eggHousing(C, 0.9, 0.62, 0.5);
  C.t.pitch.position.set(r * 0.25, y0 + r * 0.42, 0);
  for (const s of [-1, 1]) cbox(p, kit.trim, 0, 0, s * r * 0.55, r * 0.5, r * 0.32, r * 0.22);
  for (const s of [-1, 1]) lensEmitter(C, rc, r * 0.15, C.D * 1.0, s * r * 0.55);
  bx(b, kit.glass, r * 0.55, y0 + r * 0.55, 0, r * 0.12, r * 0.12, r * 0.3, [0, 0, -0.5]);
  accent(C, -r * 0.3, y0 + r * 0.66, 0, r * 0.4, r * 0.16);
  C.t.rate = 0.4;
}

/** Heat ray: low egg base, big parabolic dish facing forward, glowing focal spike on struts. */
function heatDish(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  eggHousing(C, 0.85, 0.75, 0.42, -0.2);
  C.t.pitch.position.set(r * 0.15, y0 + r * 0.6, 0);
  const dr = r * 0.62;
  rc.lathe(kit.panel, [[0, 0], [r * 0.18, 0], [dr * 0.7, r * 0.12], [dr, r * 0.3], [dr * 0.92, r * 0.34], [dr * 0.6, r * 0.2], [r * 0.12, r * 0.1], [0, r * 0.1]], [0, 0, 0], 'x', 12);
  rc.cyl(kit.trim, r * 0.12, r * 0.08, r * 0.4, [r * 0.1, 0, 0], 'x', 6);
  rc.lathe(kit.hot, [[0, 0], [r * 0.08, 0], [r * 0.1, r * 0.06], [0, r * 0.14]], [r * 0.5, 0, 0], 'x', 6);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.5; rc.strut(kit.metal, [r * 0.28, Math.sin(a) * dr * 0.88, Math.cos(a) * dr * 0.88], [r * 0.52, 0, 0], r * 0.025, r * 0.02, 4); }
  C.muzzle(r * 0.66, 0, 0);
  accent(C, -r * 0.6, y0 + r * 0.4, 0, r * 0.3, r * 0.3);
}

/** Plasma: egg housing, bulbous chamber with glowing window ring, containment-ringed barrel(s). */
function plasma(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const n = Math.min(2, Math.max(1, C.nb));
  const big = C.tier >= 4;
  const lance = C.mod.projectile === 'beam';
  eggHousing(C, 0.95, 0.85, big ? 0.5 : 0.46, -0.15);
  C.t.pitch.position.set(r * 0.35, y0 + r * (big ? 0.5 : 0.45), 0);
  const gap = r * 0.62;
  const cr = r * (lance ? 0.24 : 0.3);
  const len = C.D * (lance ? 1.15 : 0.85);
  for (let i = 0; i < n; i++) {
    const z = n > 1 ? (i - 0.5) * gap : 0;
    // chamber
    ball(rc, kit.panel, r * 0.02, 0, z, cr, 1, 10, 'x');
    band(rc, kit.plasma, r * 0.02, 0, z, cr * 1.03, cr * 0.4, 10);
    // barrel with containment rings
    const br = cr * (lance ? 0.45 : 0.5);
    rc.lathe(kit.steel, [[0, 0], [br, 0], [br * 0.9, len], [0, len]], [cr * 0.6, 0, z], 'x', 8);
    const nr = lance ? 3 : 2;
    for (let k = 0; k < nr; k++) band(rc, k === nr - 1 ? kit.plasma : kit.trim, cr * 0.6 + len * (0.35 + (0.6 * k) / Math.max(1, nr - 1) * 0.95), 0, z, br * 1.7, br * 0.7, 8);
    rc.cyl(kit.plasma, br * 0.7, br * 0.7, r * 0.02, [cr * 0.6 + len, 0, z], 'x', 6);
    C.muzzle(cr * 0.6 + len + r * 0.08, 0, z);
  }
  if (n > 1) bx(p, kit.trim, -r * 0.05, 0, 0, r * 0.3, r * 0.25, gap);
  if (big) for (const s of [-1, 1]) capsule(b, kit.trim, -r * 0.55, y0 + r * 0.45, s * r * 0.62, r * 0.16, r * 0.6, 'x', 8);
  accent(C, -r * 0.45, y0 + r * (big ? 0.97 : 0.89), 0, r * 0.3, r * 0.22);
  C.t.shot = lance ? 'beam' : 'orb';
  C.t.rate = 1.6;
}

/** Flamer: open platform, hazard-banded pressure tanks, hose, flared nozzle with a pilot flame. */
function flamer(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const big = C.tier >= 4;
  const nt = C.c > 0.5 ? 3 : 2;
  cbox(b, kit.trim, -r * 0.15, y0 + r * 0.08, 0, r * 1.25, r * 0.16, r * 1.1, r * 0.04);
  const tr = r * (nt === 3 ? 0.22 : 0.28);
  for (let i = 0; i < nt; i++) {
    const z = (i - (nt - 1) / 2) * tr * 2.15;
    capsule(b, kit.canvas, -r * 0.45, y0 + r * 0.16 + tr, z, tr, r * 0.85, 'x', 8);
    hazardRings(b, kit, -r * 0.45 - r * 0.2, y0 + r * 0.16 + tr, z, tr * 1.03, r * 0.2, 2, 8);
  }
  C.t.pitch.position.set(r * 0.25, y0 + r * 0.38, 0);
  cbox(p, kit.hull, 0, 0, 0, r * 0.4, r * 0.3, r * 0.42, r * 0.05);
  const nn = big ? 2 : 1;
  const len = C.D * (big ? 0.8 : 0.7), R = r * (big ? 0.09 : 0.1);
  for (let i = 0; i < nn; i++) {
    const z = nn > 1 ? (i - 0.5) * r * 0.32 : 0;
    rc.lathe(kit.metal, [[0, 0], [R, 0], [R, len * 0.75], [R * 1.9, len], [R * 1.4, len], [0, len - R]], [0, 0, z], 'x', 8);
    band(rc, kit.trim, len * 0.4, 0, z, R * 1.4, R * 1.2, 8);
    rc.cyl(kit.hot, R * 0.35, R * 0.2, R * 0.6, [len * 0.86, -R * 1.5, z], 'x', 5);
    C.muzzle(len + R, 0, z);
  }
  p.strut(kit.rubber, [-r * 0.15, -r * 0.1, r * 0.12], [-r * 0.5, -r * 0.05, r * 0.25], r * 0.04, r * 0.04, 5);
  accent(C, r * 0.02, r * 0.155, 0, r * 0.3, r * 0.2, undefined, p);
  C.t.shot = 'flame';
  C.t.rate = 0.12;
}

/** tesla coil stack: one zig-zag lathe (rings), along +Y from y, n rings, radius R */
function coilStack(B: Bld, mat: MatLike, x: number, y: number, z: number, R: number, h: number, n: number, axis: 'x' | 'y' = 'y', seg = 10) {
  const prof: [number, number][] = [[0, 0], [R * 0.55, 0]];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * h, m = ((i + 0.5) / n) * h, k = 1 - (i / n) * 0.35;
    prof.push([R * 0.55 * k, a + h * 0.04 / n], [R * k, m - h * 0.12 / n], [R * k, m + h * 0.12 / n], [R * 0.5 * k, (a + h / n) - h * 0.04 / n]);
  }
  prof.push([R * 0.4, h], [0, h]);
  B.lathe(mat, prof, [x, y, z], axis, seg);
}

function teslaCoil(C: WCtx) {
  const { b, rc, kit, r, y0 } = C;
  b.lathe(kit.hull, [[0, 0], [r * 0.78, 0], [r * 0.78, r * 0.12], [r * 0.45, r * 0.32], [0, r * 0.32]], [0, y0, 0], 'y', 10);
  coilStack(b, kit.metal, 0, y0 + r * 0.3, 0, r * 0.36, r * 0.75, 4);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; b.strut(kit.trim, [Math.cos(a) * r * 0.62, y0 + r * 0.1, Math.sin(a) * r * 0.62], [Math.cos(a) * r * 0.2, y0 + r * 0.9, Math.sin(a) * r * 0.2], r * 0.04, r * 0.03, 4); }
  C.t.pitch.position.set(0, y0 + r * 1.22, 0);
  ball(rc, kit.rail, 0, 0, 0, r * 0.26, 1, 10);
  band(rc, kit.trim, 0, 0, 0, r * 0.3, r * 0.06, 10);
  C.muzzle(r * 0.28, 0, 0);
  accent(C, 0, y0 + r * 0.33, 0, r * 0.3, r * 0.6);
  C.t.rate = 0.9;
}

/** Arc lance: horizontal coil lance on a yoke, orb at the tip. */
function arcLance(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  b.lathe(kit.hull, [[0, 0], [r * 0.7, 0], [r * 0.7, r * 0.14], [r * 0.5, r * 0.26], [0, r * 0.26]], [0, y0, 0], 'y', 10);
  for (const s of [-1, 1]) cbox(b, kit.trim, -r * 0.1, y0 + r * 0.42, s * r * 0.38, r * 0.45, r * 0.45, r * 0.12);
  C.t.pitch.position.set(-r * 0.1, y0 + r * 0.55, 0);
  ball(p, kit.trim, 0, 0, 0, r * 0.3, 1, 8, 'x');
  const len = C.D * 1.0;
  coilStack(rc, kit.metal, r * 0.1, 0, 0, r * 0.26, len, 5, 'x', 8);
  ball(rc, kit.rail, r * 0.1 + len + r * 0.12, 0, 0, r * 0.19, 1, 8);
  C.muzzle(r * 0.1 + len + r * 0.2, 0, 0);
  accent(C, -r * 0.1, r * 0.3, 0, r * 0.2, r * 0.25, undefined, p);
  C.t.rate = 1.2;
}

/** Storm tower (L): tall coil tower with flaring discs, big orb, lightning rods. */
function stormTower(C: WCtx) {
  const { b, rc, kit, r, y0 } = C;
  b.lathe(kit.hull, [[0, 0], [r * 0.85, 0], [r * 0.85, r * 0.15], [r * 0.5, r * 0.35], [0, r * 0.35]], [0, y0, 0], 'y', 12);
  coilStack(b, kit.metal, 0, y0 + r * 0.3, 0, r * 0.32, r * 1.0, 5);
  for (const [f, k] of [[0.35, 0.55], [0.7, 0.45]]) b.lathe(kit.trim, [[0, 0], [r * k, r * 0.03], [r * k, r * 0.06], [0, r * 0.08]], [0, y0 + r * 0.3 + r * f, 0], 'y', 10);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.4; b.strut(kit.steel, [Math.cos(a) * r * 0.65, y0 + r * 0.2, Math.sin(a) * r * 0.65], [Math.cos(a) * r * 0.55, y0 + r * 0.95, Math.sin(a) * r * 0.55], r * 0.04, r * 0.02, 4); ball(b, kit.rail, Math.cos(a) * r * 0.55, y0 + r * 0.98, Math.sin(a) * r * 0.55, r * 0.07, 1, 6); }
  C.t.pitch.position.set(0, y0 + r * 1.55, 0);
  ball(rc, kit.rail, 0, 0, 0, r * 0.3, 1, 12);
  band(rc, kit.trim, 0, 0, 0, r * 0.34, r * 0.07, 12);
  C.muzzle(r * 0.32, 0, 0);
  accent(C, 0, y0 + r * 0.36, 0, r * 0.35, r * 0.7);
  C.t.rate = 1.0;
}

/** Tempest core (XL): three coil towers around a big central orb. */
function stormCore(C: WCtx) {
  const { b, rc, kit, r, y0 } = C;
  b.lathe(kit.hull, [[0, 0], [r * 0.9, 0], [r * 0.9, r * 0.15], [r * 0.6, r * 0.32], [0, r * 0.32]], [0, y0, 0], 'y', 12);
  const n = Math.max(3, C.nb);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 2, x = Math.cos(a) * r * 0.5, z = Math.sin(a) * r * 0.5;
    coilStack(b, kit.metal, x, y0 + r * 0.3, z, r * 0.2, r * 0.7, 3, 'y', 8);
    ball(b, kit.rail, x, y0 + r * 1.08, z, r * 0.12, 1, 8);
  }
  b.cyl(kit.trim, r * 0.2, r * 0.14, r * 0.7, [0, y0 + r * 0.3, 0], 'y', 8);
  C.t.pitch.position.set(0, y0 + r * 1.2, 0);
  ball(rc, kit.rail, 0, 0, 0, r * 0.3, 1, 12);
  band(rc, kit.trim, 0, 0, 0, r * 0.34, r * 0.07, 12);
  C.muzzle(r * 0.32, 0, 0);
  accent(C, 0, y0 + r * 0.33, 0, r * 0.4, r * 0.4);
  C.t.rate = 1.0;
}

/** Stun gun: compact box with a forked prod and glowing tips. */
function stunFork(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  eggHousing(C, 0.8, 0.65, 0.45, -0.15);
  C.t.pitch.position.set(r * 0.4, y0 + r * 0.4, 0);
  cbox(p, kit.trim, 0, 0, 0, r * 0.3, r * 0.3, r * 0.4);
  const len = C.D * 0.8;
  for (const s of [-1, 1]) {
    cbox(rc, kit.steel, len / 2, 0, s * r * 0.17, len, r * 0.08, r * 0.08, r * 0.02);
    ball(rc, kit.rail, len + r * 0.04, 0, s * r * 0.17, r * 0.1, 1, 6);
  }
  C.muzzle(len + r * 0.06, 0, 0);
  C.t.rate = 0.8;
}

/** EMP cannon: spherical capacitor chamber and a short fat coil barrel. */
function empGun(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  eggHousing(C, 0.9, 0.78, 0.46, -0.2);
  C.t.pitch.position.set(r * 0.3, y0 + r * 0.46, 0);
  ball(rc, kit.panel, 0, 0, 0, r * 0.32, 1, 10, 'x');
  band(rc, kit.rail, 0, 0, 0, r * 0.335, r * 0.1, 10);
  const R = r * 0.17, len = C.D * 0.62;
  barrel(C, rc, { len, rad: R, x0: r * 0.2, seg: 8, taper: 1, noMuzzle: true });
  for (let k = 0; k < 3; k++) band(rc, k === 2 ? kit.rail : kit.trim, r * 0.2 + len * (0.4 + k * 0.25), 0, 0, R * 1.6, R * 0.6, 8);
  C.muzzle(r * 0.2 + len + r * 0.05, 0, 0);
  C.t.shot = 'orb';
  C.t.rate = 1.3;
}

/** Ring emitter (graviton / disarmer): big vertical ring with a glowing core, generator pod behind. */
function ringEmitter(C: WCtx, core: MatLike, heavy = false) {
  const { b, p, rc, kit, r, y0 } = C;
  eggHousing(C, 0.85, 0.72, 0.42, -0.25);
  const R = r * (heavy ? 0.62 : 0.52), w = r * 0.1;
  C.t.pitch.position.set(r * 0.25, y0 + r * 0.42 + R * 0.55, 0);
  cbox(p, kit.trim, -r * 0.1, -R * 0.4, 0, r * 0.3, R * 0.5, r * 0.25);
  // funnel of three stepped rings (reads as a target-ring cone from above)
  for (let i = 0; i < 3; i++) {
    const k = 1 - i * 0.28, x = r * 0.02 + i * r * 0.2;
    rc.lathe(i === 2 ? core : kit.trim, [[R * k * 0.7, 0], [R * k, 0], [R * k, w], [R * k * 0.7, w]], [x, 0, 0], 'x', heavy ? 14 : 12);
    if (i < 2) rc.lathe(core, [[R * k * 0.66, w * 0.25], [R * k * 0.71, w * 0.25], [R * k * 0.71, w * 0.75], [R * k * 0.66, w * 0.75]], [x, 0, 0], 'x', heavy ? 14 : 12);
  }
  rc.strut(kit.metal, [-r * 0.1, 0, 0], [r * 0.5, 0, 0], r * 0.06, r * 0.05, 5);
  ball(rc, core, r * 0.55, 0, 0, r * 0.11, 1, 8);
  C.muzzle(r * 0.62, 0, 0);
  accent(C, -r * 0.6, y0 + r * 0.4, 0, r * 0.3, r * 0.3);
  C.t.shot = 'beam';
  C.t.rate = 1.2;
}

/** Disruptor: tuning-fork emitter with a glowing crystal between the tines. */
function tuningFork(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  eggHousing(C, 0.85, 0.7, 0.44, -0.2);
  C.t.pitch.position.set(r * 0.3, y0 + r * 0.45, 0);
  ball(p, kit.trim, 0, 0, 0, r * 0.26, 1, 8, 'x');
  const len = C.D * 0.85;
  for (const s of [-1, 1]) {
    rc.strut(kit.steel, [r * 0.05, 0, s * r * 0.1], [len * 0.45, 0, s * r * 0.3], r * 0.06, r * 0.06, 5);
    rc.strut(kit.steel, [len * 0.45, 0, s * r * 0.3], [len, 0, s * r * 0.16], r * 0.06, r * 0.04, 5);
  }
  rc.lathe(kit.plasma, [[0, 0], [r * 0.1, r * 0.12], [0, r * 0.3]], [len * 0.55, 0, 0], 'x', 4);
  C.muzzle(len, 0, 0);
  C.t.rate = 1.0;
}

/** Sonic pulser: big flared horn (LRAD) on a yoke. */
function horn(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  b.lathe(kit.hull, [[0, 0], [r * 0.7, 0], [r * 0.7, r * 0.15], [r * 0.5, r * 0.28], [0, r * 0.28]], [0, y0, 0], 'y', 10);
  for (const s of [-1, 1]) cbox(b, kit.trim, -r * 0.1, y0 + r * 0.48, s * r * 0.62, r * 0.4, r * 0.5, r * 0.1);
  C.t.pitch.position.set(-r * 0.1, y0 + r * 0.62, 0);
  const R = r * 0.7, L = r * 0.85;
  rc.lathe(kit.panel, [[0, -r * 0.3], [R * 0.6, -r * 0.3], [R * 0.6, 0], [R * 0.75, L * 0.5], [R, L], [R * 0.9, L], [R * 0.4, L * 0.55], [0, L * 0.5]], [0, 0, 0], 'x', 12);
  band(rc, kit.trim, L * 0.12, 0, 0, R * 0.68, r * 0.08, 12);
  rc.cyl(kit.lamp, R * 0.22, R * 0.22, r * 0.03, [L * 0.52, 0, 0], 'x', 8);
  C.muzzle(L, 0, 0);
  accent(C, -r * 0.05, R * 0.6 + 0.002, 0, r * 0.25, r * 0.2, undefined, rc);
  C.t.shot = 'orb';
  C.t.rate = 1.1;
}
