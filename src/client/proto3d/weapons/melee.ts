// Melee arms: an armoured shoulder drum on the deck and a chunky hydraulic arm that reaches FORWARD past the hull, with a
// big readable tool head: buzzsaw / grinder wheel (spinning), chainsaw bar, three-finger claw, siege hammer, titan fist,
// spinning drill cone, plasma blade, shock prod, spiked ram.

import { accent, band, ball, bx, cbox, hazardRings, type WCtx } from './wkit.ts';

export function buildMelee(C: WCtx): void {
  const { b, p, rc, kit, r, y0 } = C;
  const v = C.mod.visual;
  C.t.shot = 'none';
  C.t.rate = 99;
  if (v === 'ram') return ram(C);
  // shoulder: armoured drum + pivot
  b.lathe(kit.hull, [[0, 0], [r * 0.62, 0], [r * 0.62, r * 0.2], [r * 0.48, r * 0.34], [0, r * 0.34]], [-r * 0.15, y0, 0], 'y', 10);
  b.cylb(kit.trim, r * 0.3, r * 0.5, r * 0.05, [-r * 0.15, y0 + r * 0.5, -r * 0.25], 'z', 10);
  C.t.pitch.position.set(-r * 0.15, y0 + r * 0.5, 0);
  C.t.pitch.rotation.z = -0.06;
  const A = r * (C.tier >= 4 ? 1.35 : 1.25); // reach to the wrist
  // arm: thick upper beam + piston underneath
  cbox(p, kit.hull, A * 0.45, 0, 0, A * 0.95, r * 0.26, r * 0.28, r * 0.05);
  p.strut(kit.steel, [r * 0.05, -r * 0.2, 0], [A * 0.75, -r * 0.08, 0], r * 0.05, r * 0.05, 5);
  accent(C, A * 0.45, r * 0.13 + 0.002, 0, A * 0.5, r * 0.12, undefined, p);
  switch (v) {
    case 'saw': return saw(C, A);
    case 'chainsaw': return chainsaw(C, A);
    case 'claw': return claw(C, A);
    case 'hammer': return C.tier >= 5 ? fist(C, A) : hammer(C, A);
    case 'drill': return drill(C, A);
    case 'blade': return blade(C, A);
    default: return prod(C, A);
  }
  void rc;
}

function saw(C: WCtx, A: number) {
  const { rc, sp, kit, r } = C;
  const big = C.tier >= 4;
  const R = r * (big ? 0.82 : 0.7), t = r * (big ? 0.12 : 0.05);
  cbox(rc, kit.trim, A, 0, 0, r * 0.3, r * 0.3, r * 0.34);
  // guard over the back half of the disc
  cbox(rc, kit.hull, A + R * 0.2, R * 0.82, 0, R * 1.3, r * 0.08, t * 2 + r * 0.14, r * 0.03);
  C.spin('z', [A + R * 0.75, 0, 0]);
  sp.lathe(kit.steel, [[0, -t], [R * 0.92, -t], [R, 0], [R * 0.92, t], [0, t]], [0, 0, 0], 'x', 14);
  sp.lathe(kit.hazard, [[0, -t * 1.6], [R * 0.3, -t * 1.6], [R * 0.3, t * 1.6], [0, t * 1.6]], [0, 0, 0], 'x', 8);
  const n = big ? 10 : 8;
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; bx(sp, kit.metal, 0, Math.sin(a) * R, Math.cos(a) * R, t * 2.4, R * 0.22, R * 0.14, [a, 0, 0]); }
}

function chainsaw(C: WCtx, A: number) {
  const { rc, kit, r } = C;
  const L = r * 1.5, h = r * 0.34;
  cbox(rc, kit.hull, A, 0, 0, r * 0.45, r * 0.45, r * 0.4, r * 0.06);
  hazardRings(rc, kit, A - r * 0.05, r * 0.24, 0, r * 0.02, r * 0.3, 1);
  bx(rc, kit.metal, A + r * 0.2 + L / 2, 0, 0, L, h * 1.12, r * 0.06);
  cbox(rc, kit.steel, A + r * 0.2 + L / 2, 0, 0, L * 0.98, h, r * 0.1, r * 0.02, undefined, 1);
  rc.lathe(kit.metal, [[0, -r * 0.03], [h * 0.56, -r * 0.03], [h * 0.56, r * 0.03], [0, r * 0.03]], [A + r * 0.2 + L, 0, 0], 'z', 8);
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) bx(rc, kit.metal, A + r * 0.3 + (i + 0.5) * (L / 6), s * h * 0.6, 0, r * 0.06, r * 0.08, r * 0.07, [0, 0, s * 0.5]);
}

function claw(C: WCtx, A: number) {
  const { rc, kit, r } = C;
  cbox(rc, kit.trim, A + r * 0.05, 0, 0, r * 0.4, r * 0.42, r * 0.46, r * 0.06);
  // three fingers: two up-forward, one opposing below (each two chunky segments, curling inward)
  const fingers: [number, number][] = [[0.18, -0.2], [0.18, 0.2], [-0.2, 0]];
  for (const [fy, fz] of fingers) {
    const up = fy > 0 ? 1 : -1;
    const x0 = A + r * 0.25, y0 = fy * r, z = fz * r;
    cbox(rc, kit.steel, x0 + r * 0.25, y0 + up * r * 0.12, z, r * 0.55, r * 0.14, r * 0.15, r * 0.03, [0, 0, up * 0.45]);
    cbox(rc, kit.metal, x0 + r * 0.62, y0 + up * r * 0.12, z, r * 0.42, r * 0.12, r * 0.13, r * 0.03, [0, 0, -up * 0.55]);
  }
}

function hammer(C: WCtx, A: number) {
  const { rc, kit, r } = C;
  const hw = r * 0.55;
  cbox(rc, kit.trim, A, 0, 0, r * 0.3, r * 0.3, r * 0.32);
  cbox(rc, kit.metal, A + r * 0.4, 0, 0, r * 0.6, hw * 1.6, hw * 1.3, r * 0.08);
  cbox(rc, kit.steel, A + r * 0.75, 0, 0, r * 0.12, hw * 1.45, hw * 1.15, r * 0.04);
  hazardRings(rc, kit, A + r * 0.2, 0, 0, hw * 0.82, r * 0.3, 3, 4);
}

function fist(C: WCtx, A: number) {
  const { rc, kit, r } = C;
  cbox(rc, kit.trim, A, 0, 0, r * 0.3, r * 0.4, r * 0.4);
  hazardRings(rc, kit, A - r * 0.05, 0, 0, r * 0.24, r * 0.15, 1, 8);
  cbox(rc, kit.hull, A + r * 0.38, 0, 0, r * 0.55, r * 0.6, r * 0.62, r * 0.1);
  for (let i = 0; i < 4; i++) cbox(rc, kit.metal, A + r * 0.72, r * 0.22 - i * r * 0.145, 0, r * 0.22, r * 0.13, r * 0.56, r * 0.04);
  cbox(rc, kit.metal, A + r * 0.45, -r * 0.05, -r * 0.36, r * 0.4, r * 0.18, r * 0.14, r * 0.04, [0, 0.4, 0]);
}

function drill(C: WCtx, A: number) {
  const { rc, sp, kit, r } = C;
  const R = r * 0.42, L = r * 1.4;
  rc.lathe(kit.hull, [[0, 0], [R * 0.9, 0], [R * 1.1, r * 0.15], [R * 1.1, r * 0.3], [0, r * 0.3]], [A - r * 0.1, 0, 0], 'x', 10);
  C.spin('x', [A + r * 0.2, 0, 0]);
  // stepped spiral-ish cone: offset ridges read as flutes when it spins
  const prof: [number, number][] = [[0, 0], [R, 0]];
  const steps = 4;
  for (let i = 0; i < steps; i++) { const f0 = i / steps, f1 = (i + 1) / steps; prof.push([R * (1 - f0) * 1.0, L * f0 + L * 0.02], [R * (1 - f1) + R * 0.12, L * f1 - L * 0.03]); }
  prof.push([0, L]);
  sp.lathe(kit.steel, prof, [0, 0, 0], 'x', 7);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; sp.strut(kit.metal, [L * 0.05, Math.sin(a) * R * 0.95, Math.cos(a) * R * 0.95], [L * 0.85, Math.sin(a + 1.6) * R * 0.18, Math.cos(a + 1.6) * R * 0.18], r * 0.05, r * 0.02, 4); }
}

function blade(C: WCtx, A: number) {
  const { rc, kit, r } = C;
  const L = r * 1.5;
  cbox(rc, kit.trim, A, 0, 0, r * 0.32, r * 0.34, r * 0.34);
  cbox(rc, kit.hull, A + r * 0.2, 0, 0, r * 0.1, r * 0.6, r * 0.22, r * 0.03);
  rc.slab(kit.plasma, [[0, -r * 0.12], [L * 0.85, -r * 0.12], [L, r * 0.05], [L * 0.8, r * 0.14], [0, r * 0.12]], r * 0.06, r * 0.015, A + r * 0.25, -r * 0.03, 0, [Math.PI / 2, 0, 0]);
}

function prod(C: WCtx, A: number) {
  const { rc, kit, r } = C;
  const L = r * 0.8;
  rc.cyl(kit.metal, r * 0.09, r * 0.07, L, [A, 0, 0], 'x', 6);
  for (const f of [0.25, 0.55]) band(rc, kit.hazard, A + L * f, 0, 0, r * 0.12, r * 0.07, 6);
  for (const s of [-1, 1]) {
    rc.strut(kit.steel, [A + L, 0, 0], [A + L + r * 0.35, 0, s * r * 0.18], r * 0.04, r * 0.035, 4);
    ball(rc, kit.rail, A + L + r * 0.38, 0, s * r * 0.18, r * 0.08, 1, 6);
  }
}

/** Spike ram: a sloped wedge plough with three spikes, braced to a low deck block (no arm). */
function ram(C: WCtx) {
  const { b, kit, r, y0 } = C;
  cbox(b, kit.trim, -r * 0.2, y0 + r * 0.15, 0, r * 0.6, r * 0.3, r * 0.7);
  for (const s of [-1, 1]) b.strut(kit.steel, [-r * 0.2, y0 + r * 0.3, s * r * 0.25], [r * 0.45, y0 + r * 0.35, s * r * 0.4], r * 0.06, r * 0.06, 5);
  cbox(b, kit.hull, r * 0.55, y0 + r * 0.35, 0, r * 0.18, r * 0.7, r * 1.5, r * 0.05, [0, 0, -0.35]);
  for (const z of [-r * 0.5, 0, r * 0.5]) b.lathe(kit.steel, [[0, 0], [r * 0.14, 0], [0, r * 0.55]], [r * 0.62, y0 + r * 0.32, z], 'x', 6);
  accent(C, r * 0.45, y0 + r * 0.66, 0, r * 0.1, r * 1.2, [0, 0, -0.35]);
}
