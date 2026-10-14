// Utilities and armour as distinct readable deck props: repair crane, shield pylon, dome projector, command uplink mast,
// radar dish, optics head, stealth fins, ECM antenna array, smoke dischargers, armour slabs / reactive tiles / mirror
// facets, EMP cage, autoloader carousel, overclock radiator, nanite hive, turbo stacks and a gyroscope.

import { dome as domeShape } from '../chassis/shapes.ts';
import { accent, band, ball, bx, capsule, cbox, hazardRings, type WCtx } from './wkit.ts';

export function buildUtility(C: WCtx): void {
  C.t.shot = 'none';
  C.t.rate = 99;
  const v = C.mod.visual, id = C.mod.id;
  switch (v) {
    case 'repair': return repair(C);
    case 'shield': return shieldPylon(C);
    case 'dome': return domeProjector(C);
    case 'uplink': return uplink(C);
    case 'sensor': return id === 'targeting' ? optics(C) : radar(C);
    case 'cloak': return stealthFins(C);
    case 'jammer': return jammer(C);
    case 'smoke': return smoke(C);
    case 'plate': return id === 'reactive' ? reactive(C) : id === 'mirror' ? mirror(C) : armour(C);
    case 'coolant': return id === 'autoloader' ? autoloader(C) : id === 'overclock' ? radiator(C) : cage(C);
    case 'nanite': return nanite(C);
    case 'engine': return turbo(C);
    case 'gyro': return gyro(C);
    default: return radar(C);
  }
}

const base = (C: WCtx, k = 0.62, h = 0.2) =>
  C.b.lathe(C.kit.hull, [[0, 0], [C.r * k, 0], [C.r * k, C.r * h * 0.6], [C.r * k * 0.78, C.r * h], [0, C.r * h]], [0, C.y0, 0], 'y', 8);

/** Repair crane: post, elbowed arm(s) with a glowing nozzle and hazard band. */
function repair(C: WCtx) {
  const { b, p, kit, r, y0 } = C;
  const n = C.c > 0.5 ? 2 : 1;
  base(C);
  cbox(b, kit.hazard, 0, y0 + r * 0.32, 0, r * 0.45, r * 0.24, r * 0.45, r * 0.04);
  b.cyl(kit.metal, r * 0.1, r * 0.09, r * 0.45, [0, y0 + r * 0.42, 0], 'y', 6);
  C.t.pitch.position.set(0, y0 + r * 0.85, 0);
  for (let i = 0; i < n; i++) {
    const z = n > 1 ? (i - 0.5) * r * 0.4 : 0;
    cbox(p, kit.panel, r * 0.25, r * 0.12, z, r * 0.6, r * 0.12, r * 0.12, r * 0.03, [0, 0, 0.35]);
    cbox(p, kit.panel, r * 0.68, r * 0.12, z, r * 0.45, r * 0.1, r * 0.1, r * 0.03, [0, 0, -0.5]);
    p.cyl(kit.trim, r * 0.08, r * 0.05, r * 0.16, [r * 0.86, -r * 0.05, z], '-x', 6);
    ball(p, kit.glow, r * 0.88, -r * 0.08, z, r * 0.07, 1, 6);
  }
  ball(p, kit.trim, 0, 0, 0, r * 0.13, 1, 6);
  C.muzzle(r * 0.9, -r * 0.08, 0);
  accent(C, 0, y0 + r * 0.445, 0, r * 0.2, r * 0.46);
}

/** Shield emitter pylon: tripod base, tapered column, glowing rings, emitter head; heavier = taller with side vanes. */
function shieldPylon(C: WCtx) {
  const { b, kit, r, y0 } = C;
  const heavy = C.c > 0.7;
  const H = r * (heavy ? 1.35 : 1.1);
  base(C, 0.66, 0.22);
  b.lathe(kit.panel, [[0, 0], [r * 0.26, 0], [r * 0.16, H * 0.8], [0, H * 0.8]], [0, y0 + r * 0.2, 0], 'y', 8);
  for (const f of heavy ? [0.3, 0.55, 0.8] : [0.35, 0.7]) b.lathe(kit.glow, [[0, 0], [r * (0.38 - f * 0.18), 0], [r * (0.38 - f * 0.18), r * 0.05], [0, r * 0.05]], [0, y0 + r * 0.2 + H * f * 0.8, 0], 'y', 10);
  b.lathe(kit.trim, [[0, 0], [r * 0.1, 0], [r * 0.4, r * 0.12], [r * 0.38, r * 0.17], [0, r * 0.1]], [0, y0 + r * 0.2 + H * 0.8, 0], 'y', 10);
  ball(b, kit.glow, 0, y0 + r * 0.2 + H * 0.8 + r * 0.14, 0, r * 0.12, 0.7, 8);
  if (heavy) for (const s of [-1, 1]) cbox(b, kit.hull, 0, y0 + r * 0.55, s * r * 0.36, r * 0.5, r * 0.6, r * 0.08, r * 0.03, [s * 0.2, 0, 0], 0.7);
  accent(C, 0, y0 + r * 0.221, 0, r * 0.7, r * 0.18);
}

/** Dome projector: drum base with arched ribs meeting at a glowing crown orb. */
function domeProjector(C: WCtx) {
  const { b, kit, r, y0 } = C;
  const H = r * 0.85;
  b.lathe(kit.hull, [[0, 0], [r * 0.8, 0], [r * 0.8, r * 0.16], [r * 0.6, r * 0.26], [0, r * 0.26]], [0, y0, 0], 'y', 12);
  domeShape(b, kit.glass, [0, y0 + r * 0.24, 0], r * 0.42, r * 0.38, 10, 2);
  const n = C.tier >= 5 ? 6 : 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
    b.strut(kit.panel, [c * r * 0.68, y0 + r * 0.22, s * r * 0.68], [c * r * 0.5, y0 + H * 0.8, s * r * 0.5], r * 0.06, r * 0.05, 4);
    b.strut(kit.panel, [c * r * 0.5, y0 + H * 0.8, s * r * 0.5], [0, y0 + H + r * 0.08, 0], r * 0.05, r * 0.04, 4);
  }
  b.lathe(kit.trim, [[0, 0], [r * 0.22, 0], [r * 0.22, r * 0.06], [0, r * 0.08]], [0, y0 + H + r * 0.04, 0], 'y', 8);
  ball(b, kit.glow, 0, y0 + H + r * 0.2, 0, r * 0.13, 1, 8);
  accent(C, -r * 0.5, y0 + r * 0.2, 0, r * 0.25, r * 0.3, [0, 0, 0.5]);
}

/** Command uplink: tall lattice mast, small dish, whip antennas, beacon lamp. */
function uplink(C: WCtx) {
  const { b, kit, r, y0 } = C;
  base(C);
  cbox(b, kit.trim, -r * 0.1, y0 + r * 0.32, 0, r * 0.5, r * 0.25, r * 0.5);
  b.lathe(kit.metal, [[0, 0], [r * 0.08, 0], [r * 0.04, r * 1.3], [0, r * 1.3]], [r * 0.05, y0 + r * 0.4, 0], 'y', 6);
  for (const f of [0.3, 0.6]) bx(b, kit.panel, r * 0.05, y0 + r * 0.4 + r * 1.3 * f, 0, r * 0.05, r * 0.05, r * 0.5);
  b.lathe(kit.panel, [[0, 0], [r * 0.08, 0], [r * 0.3, r * 0.06], [r * 0.28, r * 0.09], [0, r * 0.03]], [r * 0.08, y0 + r * 1.0, 0], 'x', 10, [0, 0, 0.6]);
  ball(b, kit.lamp, r * 0.05, y0 + r * 1.72, 0, r * 0.06, 1, 6);
  for (const z of [-r * 0.2, r * 0.2]) b.cyl(kit.metal, r * 0.02, r * 0.01, r * 0.7, [-r * 0.3, y0 + r * 0.45, z], 'y', 4);
  accent(C, -r * 0.1, y0 + r * 0.446, 0, r * 0.35, r * 0.3);
}

/** Radar: mast and a big parabolic dish tilted up toward the front. */
function radar(C: WCtx) {
  const { b, p, kit, r, y0 } = C;
  base(C, 0.55);
  b.cyl(kit.metal, r * 0.1, r * 0.08, r * 0.55, [0, y0 + r * 0.2, 0], 'y', 6);
  C.t.pitch.position.set(0, y0 + r * 0.8, 0);
  C.t.pitch.rotation.z = 0.5;
  const dr = r * 0.62;
  p.lathe(kit.panel, [[0, 0], [r * 0.1, 0], [dr * 0.7, r * 0.1], [dr, r * 0.24], [dr * 0.94, r * 0.27], [dr * 0.6, r * 0.14], [0, r * 0.06]], [-r * 0.1, 0, 0], 'x', 12);
  p.strut(kit.steel, [0, 0, 0], [r * 0.38, 0, 0], r * 0.025, r * 0.02, 4);
  ball(p, kit.glow, r * 0.4, 0, 0, r * 0.06, 1, 6);
  bx(p, kit.trim, -r * 0.2, 0, 0, r * 0.2, r * 0.18, r * 0.18);
  accent(C, 0, y0 + r * 0.125, -r * 0.5, r * 0.2, r * 0.08);
}

/** Targeting computer: armoured optics head with two big lenses. */
function optics(C: WCtx) {
  const { b, p, kit, r, y0 } = C;
  base(C, 0.55);
  b.cyl(kit.metal, r * 0.12, r * 0.12, r * 0.3, [0, y0 + r * 0.18, 0], 'y', 6);
  C.t.pitch.position.set(0, y0 + r * 0.62, 0);
  cbox(p, kit.hull, -r * 0.05, 0, 0, r * 0.6, r * 0.38, r * 0.75, r * 0.07, undefined, 0.85);
  for (const [z, R] of [[-r * 0.18, r * 0.15], [r * 0.2, r * 0.1]] as [number, number][]) {
    p.cyl(kit.trim, R * 1.2, R * 1.2, r * 0.08, [r * 0.24, 0, z], 'x', 8);
    p.cyl(kit.glass, R, R, r * 0.02, [r * 0.32, 0, z], 'x', 8);
    ball(p, kit.glow, r * 0.33, 0, z, R * 0.35, 0.4, 6);
  }
  accent(C, -r * 0.1, r * 0.19 + 0.002, 0, r * 0.3, r * 0.4, undefined, p);
}

/** Stealth: faceted angled fins with a glowing emitter seam (phase veil adds a prism). */
function stealthFins(C: WCtx) {
  const { b, kit, r, y0 } = C;
  const big = C.c > 0.7;
  shellLow(C);
  for (const s of [-1, 1]) for (const k of [0, 1]) {
    cbox(b, kit.trim, -r * 0.25 + k * r * 0.45, y0 + r * 0.45, s * r * (0.32 + k * 0.08), r * 0.42, r * 0.55, r * 0.05, r * 0.02, [s * 0.5, 0, -0.35], 0.6);
  }
  bx(b, kit.glow, 0, y0 + r * 0.25, 0, r * 0.9, r * 0.03, r * 0.06);
  if (big) b.lathe(kit.glass, [[0, 0], [r * 0.22, r * 0.3], [0, r * 0.62]], [0, y0 + r * 0.24, 0], 'y', 4);
  accent(C, -r * 0.45, y0 + r * 0.25, 0, r * 0.2, r * 0.4);
}
/** low faceted plinth used by stealth/jammer props */
function shellLow(C: WCtx) {
  cbox(C.b, C.kit.hull, 0, C.y0 + C.r * 0.12, 0, C.r * 1.2, C.r * 0.24, C.r * 1.0, C.r * 0.08, undefined, 0.85);
}

/** ECM jammer: box with an array of whip antennas and a hatched emitter panel. */
function jammer(C: WCtx) {
  const { b, kit, r, y0 } = C;
  shellLow(C);
  cbox(b, kit.panel, -r * 0.1, y0 + r * 0.36, 0, r * 0.6, r * 0.25, r * 0.6, r * 0.05);
  const pts: [number, number, number][] = [[-r * 0.35, -r * 0.35, 1.1], [-r * 0.35, r * 0.35, 0.8], [r * 0.3, -r * 0.3, 0.6], [r * 0.3, r * 0.3, 0.9], [r * 0.45, 0, 0.5]];
  for (const [x, z, h] of pts) { b.cyl(kit.metal, r * 0.03, r * 0.012, r * h, [x, y0 + r * 0.24, z], 'y', 4); ball(b, kit.glow, x, y0 + r * 0.24 + r * h, z, r * 0.04, 1, 4); }
  cbox(b, kit.trim, r * 0.22, y0 + r * 0.42, 0, r * 0.06, r * 0.3, r * 0.4, r * 0.02, [0, 0, -0.3]);
  for (let i = 0; i < 3; i++) bx(b, kit.glow, r * 0.25, y0 + r * 0.32 + i * r * 0.09, 0, r * 0.02, r * 0.025, r * 0.34, [0, 0, -0.3]);
  accent(C, -r * 0.1, y0 + r * 0.486, 0, r * 0.3, r * 0.3);
}

/** Smoke dischargers: two banks of angled tubes. */
function smoke(C: WCtx) {
  const { b, kit, r, y0 } = C;
  base(C, 0.5, 0.16);
  for (const s of [-1, 1]) {
    cbox(b, kit.hull, 0, y0 + r * 0.26, s * r * 0.32, r * 0.5, r * 0.22, r * 0.3, r * 0.04);
    for (let i = 0; i < 3; i++) {
      const x = -r * 0.15 + i * r * 0.15;
      b.lathe(kit.metal, [[0, 0], [r * 0.065, 0], [r * 0.065, r * 0.32], [0, r * 0.32]], [x, y0 + r * 0.32, s * r * 0.36], 'y', 6, [s * 0.5, 0, -0.5]);
    }
  }
  accent(C, 0, y0 + r * 0.17, 0, r * 0.3, r * 0.16);
}

/** Armour: stacked sloped slabs, bigger tiers add a second layer and bolt strips. */
function armour(C: WCtx) {
  const { b, kit, r } = C;
  const w = r * 1.8, layers = C.tier >= 3 ? 2 : 1;
  for (let i = 0; i < layers; i++) {
    const k = 1 - i * 0.18;
    cbox(b, i ? kit.panel : kit.hull, -i * r * 0.18, r * 0.32 * k + i * r * 0.04, 0, r * 0.95 * k, r * 0.62 * k, w * k, r * 0.08, [0, 0, 0], 0.72);
  }
  for (const z of [-w * 0.32, w * 0.32]) bx(b, kit.trim, r * 0.05, r * 0.66, z, r * 0.5, r * 0.04, r * 0.08);
  accent(C, -r * 0.05, r * (layers > 1 ? 0.66 : 0.64), 0, r * 0.3, w * 0.35);
}

/** Reactive armour: a grid of chunky explosive tiles on a backing slab. */
function reactive(C: WCtx) {
  const { b, kit, r } = C;
  const w = r * 1.7;
  cbox(b, kit.trim, 0, r * 0.12, 0, r * 0.95, r * 0.24, w, r * 0.05);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) cbox(b, (i + j) % 2 ? kit.panel : kit.hull, -r * 0.22 + i * r * 0.44, r * 0.34, (j - 1) * w * 0.32, r * 0.4, r * 0.2, w * 0.29, r * 0.05, [0, 0, 0], 0.8);
  accent(C, -r * 0.22, r * 0.442, 0, r * 0.25, w * 0.2);
}

/** Mirror coating: bright faceted reflector plates in a low frame. */
function mirror(C: WCtx) {
  const { b, kit, r } = C;
  cbox(b, kit.trim, 0, r * 0.08, 0, r * 1.1, r * 0.16, r * 1.4, r * 0.04);
  for (const s of [-1, 1]) cbox(b, kit.steel, 0, r * 0.25, s * r * 0.34, r * 0.95, r * 0.08, r * 0.62, r * 0.03, [s * 0.35, 0, 0]);
  bx(b, kit.glow, 0, r * 0.2, 0, r * 0.9, r * 0.04, r * 0.05);
}

/** EMP shielding: Faraday cage box with banded straps. */
function cage(C: WCtx) {
  const { b, kit, r, y0 } = C;
  cbox(b, kit.hull, 0, y0 + r * 0.3, 0, r * 0.95, r * 0.6, r * 0.85, r * 0.08, undefined, 0.85);
  for (const x of [-r * 0.28, 0, r * 0.28]) bx(b, kit.steel, x, y0 + r * 0.3, 0, r * 0.06, r * 0.64, r * 0.9);
  ball(b, kit.rail, 0, y0 + r * 0.66, 0, r * 0.12, 0.6, 6);
  accent(C, -r * 0.14, y0 + r * 0.6, 0, r * 0.18, r * 0.5);
}

/** Autoloader: ammo carousel drum with brass rounds standing in it. */
function autoloader(C: WCtx) {
  const { b, kit, r, y0 } = C;
  b.lathe(kit.hull, [[0, 0], [r * 0.7, 0], [r * 0.7, r * 0.3], [r * 0.62, r * 0.36], [0, r * 0.36]], [0, y0, 0], 'y', 10);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; capsule(b, kit.hazard, Math.cos(a) * r * 0.45, y0 + r * 0.44, Math.sin(a) * r * 0.45, r * 0.09, r * 0.34, 'y', 5); }
  b.cylb(kit.trim, r * 0.2, r * 0.25, r * 0.04, [0, y0 + r * 0.36, 0], 'y', 8);
  accent(C, 0, y0 + r * 0.62, 0, r * 0.25, r * 0.25);
}

/** Overclocked core: radiator fin stack around a glowing core. */
function radiator(C: WCtx) {
  const { b, kit, r, y0 } = C;
  cbox(b, kit.hull, 0, y0 + r * 0.12, 0, r * 1.1, r * 0.24, r * 0.95, r * 0.06);
  b.cyl(kit.hot, r * 0.18, r * 0.18, r * 0.5, [0, y0 + r * 0.24, 0], 'y', 8);
  for (let i = 0; i < 5; i++) bx(b, i % 2 ? kit.steel : kit.metal, -r * 0.4 + i * r * 0.2, y0 + r * 0.45, 0, r * 0.06, r * 0.42, r * 0.8);
  hazardRings(b, kit, 0, y0 + r * 0.26, -r * 0.5, r * 0.03, r * 0.8, 4, 4);
  C.acc = true;
}

/** Nanite hive: low dome with glowing pores and emitter nubs. */
function nanite(C: WCtx) {
  const { b, kit, r, y0 } = C;
  domeShape(b, kit.panel, [0, y0, 0], r * 0.68, r * 0.5, 8, 2);
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; ball(b, kit.glow, Math.cos(a) * r * 0.42, y0 + r * 0.36, Math.sin(a) * r * 0.42, r * 0.08, 0.6, 6); }
  b.cyl(kit.trim, r * 0.1, r * 0.06, r * 0.25, [0, y0 + r * 0.48, 0], 'y', 6);
  ball(b, kit.glow, 0, y0 + r * 0.76, 0, r * 0.07, 1, 6);
  accent(C, 0, y0 + r * 0.02, -r * 0.68, r * 0.4, r * 0.06);
}

/** Turbo: intake drum and twin exhaust stacks with hot rims. */
function turbo(C: WCtx) {
  const { b, kit, r, y0 } = C;
  cbox(b, kit.hull, 0, y0 + r * 0.15, 0, r * 1.1, r * 0.3, r * 0.85, r * 0.06);
  b.cylb(kit.metal, r * 0.26, r * 0.4, r * 0.05, [r * 0.15, y0 + r * 0.42, 0], 'x', 10);
  b.cyl(kit.trim, r * 0.18, r * 0.18, r * 0.02, [r * 0.55, y0 + r * 0.42, 0], 'x', 8);
  for (const s of [-1, 1]) {
    b.cyl(kit.metal, r * 0.12, r * 0.14, r * 0.55, [-r * 0.32, y0 + r * 0.3, s * r * 0.25], 'y', 7);
    b.cyl(kit.hot, r * 0.09, r * 0.09, r * 0.02, [-r * 0.32, y0 + r * 0.86, s * r * 0.25], 'y', 6);
  }
  accent(C, r * 0.15, y0 + r * 0.302, 0, r * 0.5, r * 0.6);
}

/** Gyro stabiliser: crossed gimbal rings around a glowing core. */
function gyro(C: WCtx) {
  const { b, kit, r, y0 } = C;
  base(C, 0.55, 0.18);
  const c = y0 + r * 0.6, R = r * 0.42;
  b.lathe(kit.panel, [[R * 0.82, 0], [R, 0], [R, r * 0.08], [R * 0.82, r * 0.08]], [0, c - r * 0.04, 0], 'y', 10);
  b.lathe(kit.steel, [[R * 0.72, 0], [R * 0.88, 0], [R * 0.88, r * 0.07], [R * 0.72, r * 0.07]], [-r * 0.035, c, 0], 'x', 10);
  b.cyl(kit.metal, r * 0.05, r * 0.05, c - y0, [0, y0, 0], 'y', 5);
  ball(b, kit.glow, 0, c, 0, r * 0.16, 1, 8);
  band(b, kit.trim, 0, c, 0, r * 0.17, r * 0.04, 8);
  accent(C, 0, y0 + r * 0.185, 0, r * 0.4, r * 0.15);
}
