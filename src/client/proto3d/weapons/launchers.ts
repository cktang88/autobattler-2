// Launchers and indirect fire: rocket pods (bundled chunky tubes, MLRS boxes), missiles (ATGM tube, rail rocket,
// exposed AA pair, SAM cells, swarm honeycomb, VLS battery, cruise / nuke on an erector), mortars (stubby tube on a
// baseplate at steep elevation), howitzers (long barrel, open gun-house), bombs and charges.

import type { MatLike } from '../materials.ts';
import type { Bld } from '../geo.ts';
import { accent, band, barrel, bx, capsule, cbox, hazardRings, shell, type WCtx } from './wkit.ts';

export function buildLauncher(C: WCtx): void {
  const v = C.mod.visual, id = C.mod.id;
  if (v === 'rocketPod') return C.nb > 4 ? mlrs(C) : rocketBundle(C);
  if (v === 'cruise') return erector(C);
  if (v === 'missileRack') {
    if (C.nb >= 16) return vls(C);
    if (C.nb >= 8) return swarm(C);
    if (C.nb >= 4) return samCells(C);
    if (C.nb >= 2) return aaPair(C);
    return id === 'atgm' ? atgm(C) : railRocket(C);
  }
  if (v === 'mortar') return mortar(C);
  if (v === 'artillery') return howitzer(C);
  return charge(C);
}

/** missile: body along +X from x0 (length len, radius R), ogive nose, 4 tail fins. */
function missile(B: Bld, nose: MatLike, body: MatLike, fin: MatLike, x0: number, y: number, z: number, R: number, len: number, seg = 7) {
  B.lathe(body, [[0, 0], [R * 0.8, 0], [R, R * 0.6], [R, len * 0.72], [0, len * 0.72]], [x0, y, z], 'x', seg);
  B.lathe(nose, [[0, 0], [R, 0], [R * 0.75, len * 0.16], [R * 0.25, len * 0.26], [0, len * 0.28]], [x0 + len * 0.72, y, z], 'x', seg);
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; bx(B, fin, x0 + len * 0.1, y + Math.sin(a) * R * 1.3, z + Math.cos(a) * R * 1.3, len * 0.16, R * 0.15, R * 1.0, [a, 0, 0]); }
}

const pedestal = (C: WCtx, k = 0.6, h = 0.22) => {
  C.b.lathe(C.kit.panel, [[0, 0], [C.r * k, 0], [C.r * k, C.r * h * 0.55], [C.r * k * 0.75, C.r * h], [0, C.r * h]], [0, C.y0, 0], 'y', 8);
};

/** 2 / 4 chunky tubes strapped into a bundle on a side yoke. */
function rocketBundle(C: WCtx) {
  const { b, p, rc, kit, r, y0, nb } = C;
  const cols = Math.max(2, nb), rows = 1;
  const tr = r * (cols > 2 ? 0.2 : 0.26), pl = r * 2.0, g = tr * 2.1;
  const ph = rows * g, pw = cols * g;
  pedestal(C);
  cbox(b, kit.trim, -r * 0.1, y0 + r * 0.3, 0, r * 0.45, r * 0.3, r * 0.4, r * 0.05);
  C.t.pitch.position.set(-r * 0.1, y0 + r * 0.42 + ph * 0.5, 0);
  cbox(p, kit.panel, 0, -ph * 0.5 - r * 0.02, 0, r * 0.6, r * 0.08, pw * 0.8, r * 0.02);
  C.t.pitch.rotation.z = 0.18;
  const tip = C.mod.id === 'incendiary' ? kit.hot : kit.hazard;
  const ox = -pl * 0.35;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const y = (i - (rows - 1) / 2) * g, z = (j - (cols - 1) / 2) * g;
    rc.lathe(kit.panel, [[0, 0], [tr * 0.9, 0], [tr, tr * 0.3], [tr, pl], [tr * 0.78, pl], [tr * 0.78, pl - tr * 0.5], [0, pl - tr * 0.5]], [ox, y, z], 'x', 8);
    rc.lathe(tip, [[0, 0], [tr * 0.62, 0], [0, tr * 0.7]], [ox + pl - tr * 0.5, y, z], 'x', 6);
    C.muzzle(ox + pl + 0.01, y, z);
  }
  for (const f of [0.2, 0.7]) cbox(rc, kit.trim, ox + pl * f, 0, 0, r * 0.14, ph + r * 0.06, pw + r * 0.06, r * 0.03);
  accent(C, ox + pl * 0.45, ph / 2 + r * 0.01, 0, pl * 0.3, pw * 0.5, undefined, rc);
  C.t.shot = 'rocket';
  C.t.rate = 0.9;
}

/** MLRS: big launcher box (4 x 3) on a turntable, raised, with lid ribs. */
function mlrs(C: WCtx) {
  const { b, p, rc, kit, r, y0, nb } = C;
  const cols = 4, rows = Math.ceil(nb / cols), cell = r * 0.38;
  const pw = cols * cell + r * 0.12, ph = rows * cell + r * 0.12, pl = r * 1.6;
  shell(b, kit.panel, [[-r * 0.8, r * 0.6, r * 0.5, r * 0.3], [r * 0.6, r * 0.6, r * 0.5, r * 0.3]], y0);
  for (const s of [-1, 1]) cbox(b, kit.trim, -r * 0.3, y0 + r * 0.45, s * (pw / 2 + r * 0.06), r * 0.45, r * 0.4, r * 0.1);
  C.t.pitch.position.set(-r * 0.3, y0 + r * 0.55, 0);
  C.t.pitch.rotation.z = 0.28;
  const ox = pl * 0.25;
  cbox(rc, kit.panel, ox, ph * 0.5, 0, pl, ph, pw, r * 0.06);
  for (const f of [-0.3, 0.1]) bx(rc, kit.hull, ox + pl * f, ph + r * 0.02, 0, pl * 0.12, r * 0.04, pw * 1.02);
  tipGridAt(C, rc, ox + pl / 2, ph * 0.5, cols, rows, cell, kit.hazard);
  accent(C, ox - pl * 0.1, ph + 0.003, 0, pl * 0.35, pw * 0.4, undefined, rc);
  C.t.shot = 'rocket';
  C.t.rate = 0.35;
}
/** tube grid face: dark recess panel with coloured warhead cones poking out (centred at yc) */
function tipGridAt(C: WCtx, B: Bld, xFace: number, yc: number, cols: number, rows: number, cell: number, tip: MatLike) {
  bx(B, C.kit.trim, xFace, yc, 0, C.r * 0.03, rows * cell, cols * cell);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const y = yc + (i - (rows - 1) / 2) * cell, z = (j - (cols - 1) / 2) * cell;
    B.lathe(tip, [[0, 0], [cell * 0.36, 0], [0, cell * 0.42]], [xFace, y, z], 'x', 6);
    C.muzzle(xFace + cell * 0.4, y, z);
  }
}

/** ATGM: one fat launch tube on a side arm of a post, sight box on the other side. */
function atgm(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const tr = r * 0.24, tl = r * 1.7;
  pedestal(C, 0.5);
  b.cyl(kit.metal, r * 0.1, r * 0.1, r * 0.45, [0, y0 + r * 0.2, 0], 'y', 6);
  C.t.pitch.position.set(0, y0 + r * 0.68, 0);
  cbox(p, kit.trim, 0, 0, 0, r * 0.3, r * 0.22, r * 0.5);
  cbox(p, kit.panel, r * 0.05, r * 0.02, -r * 0.42, r * 0.4, r * 0.3, r * 0.26);
  p.cyl(kit.glass, r * 0.08, r * 0.08, r * 0.02, [r * 0.25, r * 0.04, -r * 0.42], 'x', 6);
  const z = r * 0.38;
  rc.lathe(kit.hull, [[0, 0], [tr * 0.85, 0], [tr, tr * 0.4], [tr, tl - tr * 0.5], [tr * 1.15, tl - tr * 0.3], [tr * 1.15, tl], [tr * 0.8, tl], [0, tl - tr * 0.3]], [-tl * 0.4, 0, z], 'x', 8);
  rc.lathe(kit.steel, [[0, 0], [tr * 0.6, 0], [0, tr * 0.8]], [tl * 0.6 - tr * 0.3, 0, z], 'x', 6);
  hazardRings(rc, kit, -tl * 0.4 + tl * 0.15, 0, z, tr * 1.03, tl * 0.18, 2);
  accent(C, tl * 0.15, tr + 0.002, z, tl * 0.3, tr * 0.6, undefined, rc);
  C.muzzle(tl * 0.6 + 0.01, 0, z);
  C.t.shot = 'rocket';
  C.t.rate = 1.6;
}

/** Guided rocket: an open rail beam with a missile riding on top. */
function railRocket(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const R = r * 0.15, L = r * 1.75;
  pedestal(C, 0.5);
  cbox(b, kit.trim, 0, y0 + r * 0.38, 0, r * 0.3, r * 0.34, r * 0.32);
  C.t.pitch.position.set(0, y0 + r * 0.6, 0);
  C.t.pitch.rotation.z = 0.12;
  cbox(p, kit.panel, r * 0.05, 0, 0, L * 0.9, r * 0.14, r * 0.22, r * 0.03);
  missile(rc, kit.hazard, kit.hull, kit.trim, -L * 0.4, R + r * 0.08, 0, R, L);
  C.muzzle(L * 0.6, R + r * 0.08, 0);
  accent(C, -r * 0.1, r * 0.075, 0, L * 0.4, r * 0.1, undefined, p);
  C.t.shot = 'rocket';
  C.t.rate = 1.4;
}

/** AA pod: central seeker head with two exposed missiles on side rails. */
function aaPair(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const R = r * 0.13, L = r * 1.5;
  pedestal(C, 0.55);
  b.cyl(kit.metal, r * 0.1, r * 0.1, r * 0.35, [0, y0 + r * 0.2, 0], 'y', 6);
  C.t.pitch.position.set(0, y0 + r * 0.62, 0);
  C.t.pitch.rotation.z = 0.15;
  capsule(p, kit.panel, r * 0.05, 0, 0, r * 0.22, r * 0.75, 'x', 8);
  p.cyl(kit.glass, r * 0.14, r * 0.14, r * 0.03, [r * 0.42, 0, 0], 'x', 7);
  for (const s of [-1, 1]) {
    bx(p, kit.trim, 0, 0, s * r * 0.3, L * 0.6, r * 0.06, r * 0.2);
    missile(rc, kit.steel, kit.hull, kit.trim, -L * 0.45, 0, s * r * 0.44, R, L, 7);
    C.muzzle(L * 0.55, 0, s * r * 0.44);
  }
  accent(C, -r * 0.1, r * 0.22, 0, r * 0.3, r * 0.12, undefined, p);
  C.t.shot = 'rocket';
  C.t.rate = 1.0;
}

/** SAM: 2 x 2 square cells in a raised box with hazard caps. */
function samCells(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const cell = r * 0.48, pl = r * 1.5, pw = cell * 2 + r * 0.1;
  pedestal(C, 0.62, 0.28);
  for (const s of [-1, 1]) cbox(b, kit.trim, -r * 0.2, y0 + r * 0.45, s * (pw / 2 + r * 0.07), r * 0.5, r * 0.45, r * 0.1);
  C.t.pitch.position.set(-r * 0.2, y0 + r * 0.55, 0);
  C.t.pitch.rotation.z = 0.32;
  const ox = pl * 0.25;
  cbox(rc, kit.panel, ox, pw * 0.5, 0, pl, pw, pw, r * 0.06);
  // dark face frame, four cell covers each with a frangible hazard cap
  bx(rc, kit.trim, ox + pl / 2 + r * 0.01, pw * 0.5, 0, r * 0.03, pw * 0.94, pw * 0.94);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const y = pw * 0.5 + (i - 0.5) * cell, z = (j - 0.5) * cell;
    cbox(rc, kit.hull, ox + pl / 2 + r * 0.03, y, z, r * 0.05, cell * 0.8, cell * 0.8, r * 0.02);
    cbox(rc, kit.hazard, ox + pl / 2 + r * 0.06, y, z, r * 0.03, cell * 0.44, cell * 0.44, r * 0.01);
    C.muzzle(ox + pl / 2 + r * 0.08, y, z);
  }
  accent(C, ox - pl * 0.15, pw + 0.003, 0, pl * 0.4, pw * 0.35, undefined, rc);
  C.t.shot = 'rocket';
  C.t.rate = 0.8;
}

/** Swarm: rounded pod with a honeycomb face of small warheads. */
function swarm(C: WCtx) {
  const { b, p, rc, kit, r, y0, nb } = C;
  const cols = 4, rows = Math.ceil(nb / cols), cell = r * 0.3;
  const pw = cols * cell + r * 0.16, ph = rows * cell + r * 0.16, pl = r * 1.25;
  pedestal(C, 0.6);
  cbox(b, kit.trim, -r * 0.15, y0 + r * 0.4, 0, r * 0.4, r * 0.4, r * 0.4);
  C.t.pitch.position.set(-r * 0.1, y0 + r * 0.55 + ph * 0.5, 0);
  C.t.pitch.rotation.z = 0.2;
  const ox = pl * 0.2;
  shell(rc, kit.panel, [[ox - pl / 2, pw * 0.38, pw * 0.3, ph * 0.8], [ox - pl * 0.3, pw * 0.5, pw * 0.42, ph], [ox + pl / 2, pw * 0.5, pw * 0.42, ph]], -ph / 2);
  tipGridAt(C, rc, ox + pl / 2, -ph / 2 + ph * 0.5, cols, rows, cell, kit.hazard);
  accent(C, ox - pl * 0.05, ph / 2 + 0.003, 0, pl * 0.4, pw * 0.4, undefined, rc);
  C.t.shot = 'rocket';
  C.t.rate = 0.6;
}

/** VLS battery: a big cell block erected steeply on a heavy turntable. */
function vls(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const cols = 4, rows = 4, cell = r * 0.36;
  const pw = cols * cell + r * 0.14, pl = r * 1.45;
  shell(b, kit.panel, [[-r * 0.9, r * 0.75, r * 0.6, r * 0.32], [r * 0.7, r * 0.75, r * 0.6, r * 0.32], [r * 0.9, r * 0.5, r * 0.4, r * 0.25]], y0);
  for (const s of [-1, 1]) cbox(b, kit.trim, -r * 0.45, y0 + r * 0.55, s * (pw / 2 + r * 0.07), r * 0.5, r * 0.5, r * 0.12);
  b.cyl(kit.steel, r * 0.06, r * 0.06, r * 0.7, [r * 0.3, y0 + r * 0.3, 0], 'y', 6);
  C.t.pitch.position.set(-r * 0.45, y0 + r * 0.62, 0);
  C.t.pitch.rotation.z = 0.75;
  const ox = pl * 0.3;
  cbox(rc, kit.panel, ox, pw * 0.5, 0, pl, pw, pw, r * 0.07);
  tipGridAt(C, rc, ox + pl / 2, pw * 0.5, cols, rows, cell, kit.hazard);
  accent(C, ox, pw + 0.003, 0, pl * 0.6, pw * 0.3, undefined, rc);
  C.t.shot = 'rocket';
  C.t.rate = 0.4;
}

/** Cruise missile / tactical nuke: one huge missile on an erector cradle. */
function erector(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const nuke = C.tier >= 5;
  const R = r * (nuke ? 0.26 : 0.22), L = r * 2.0;
  shell(b, kit.panel, [[-r * 0.85, r * 0.6, r * 0.5, r * 0.28], [r * 0.6, r * 0.6, r * 0.5, r * 0.28]], y0);
  for (const s of [-1, 1]) cbox(b, kit.trim, -r * 0.4, y0 + r * 0.42, s * r * 0.36, r * 0.4, r * 0.35, r * 0.1);
  C.t.pitch.position.set(-r * 0.4, y0 + r * 0.5, 0);
  C.t.pitch.rotation.z = 0.22;
  for (const s of [-1, 1]) cbox(p, kit.trim, r * 0.35, 0, s * R * 0.9, L * 0.75, r * 0.1, r * 0.08);
  for (const f of [0.15, 0.6]) bx(p, kit.metal, f * L, R * 0.4, 0, r * 0.08, R * 1.4, R * 2.4);
  missile(rc, nuke ? kit.hazard : kit.steel, kit.hull, kit.trim, -L * 0.15, R + r * 0.06, 0, R, L, 10);
  if (nuke) { hazardRings(rc, kit, -L * 0.15 + L * 0.5, R + r * 0.06, 0, R * 1.04, L * 0.2, 3, 10); band(rc, kit.hot, L * 0.82, R + r * 0.06, 0, R * 0.96, r * 0.04, 10); }
  else accent(C, L * 0.3, R * 2 + r * 0.065, 0, L * 0.25, R * 0.5, undefined, rc);
  C.acc = true;
  C.muzzle(L * 0.85, R + r * 0.06, 0);
  C.t.shot = 'rocket';
  C.t.rate = 3.0;
}

/** Mortar: round baseplate, stubby fat tube at steep elevation, bipod, ready-round crate. */
function mortar(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const R = Math.max(C.bore, r * 0.18);
  b.lathe(kit.panel, [[0, 0], [r * 0.8, 0], [r * 0.8, r * 0.08], [r * 0.55, r * 0.18], [0, r * 0.2]], [0, y0, 0], 'y', 10);
  cbox(b, kit.hull, -r * 0.45, y0 + r * 0.3, r * 0.42, r * 0.4, r * 0.2, r * 0.3);
  cbox(b, kit.trim, -r * 0.1, y0 + r * 0.28, 0, r * 0.4, r * 0.18, r * 0.5);
  C.t.pitch.position.set(-r * 0.15, y0 + r * 0.32, 0);
  C.t.pitch.rotation.z = 1.0;
  const len = C.D * 0.8;
  rc.lathe(kit.metal, [[0, 0], [R * 1.25, 0], [R * 1.25, R * 0.6], [R, R * 0.9], [R, len - R * 0.6], [R * 1.3, len - R * 0.4], [R * 1.3, len], [R * 0.85, len], [R * 0.85, len - R * 0.6], [0, len - R * 0.6]], [0, 0, 0], 'x', 8);
  band(rc, kit.trim, len * 0.45, 0, 0, R * 1.18, R * 0.7, 8);
  C.muzzle(len + R * 0.3, 0, 0);
  for (const s of [-1, 1]) p.strut(kit.steel, [len * 0.45, -R, s * R * 0.6], [len * 0.2, -r * 0.4, s * r * 0.5], r * 0.03, r * 0.025, 4);
  accent(C, -r * 0.45, y0 + r * 0.405, r * 0.42, r * 0.3, r * 0.2);
  C.t.shot = 'shell';
  C.t.rate = 1.4;
}

/** Howitzer family: open-topped gun-house, shielded cradle, long slim elevated barrel(s): thick recoil sleeve at the
 *  breech with recuperator cylinders above and below, bare tube, double-baffle muzzle brake. */
function howitzer(C: WCtx) {
  const { b, p, rc, kit, r, y0 } = C;
  const n = Math.max(1, C.nb);
  const R = C.bore, gap = R * 4.2;
  const xl = C.tier >= 5;
  const h = r * 0.42;
  const wid = Math.max(r * 0.66, n * gap / 2 + R * 3);
  shell(b, kit.panel, [[-r * 1.0, wid * 0.82, wid * 0.7, h * 0.9], [r * 0.4, wid, wid * 0.85, h], [r * 0.85, wid * 0.7, wid * 0.55, h * 0.6]], y0);
  for (const s of [-1, 1]) cbox(b, kit.trim, -r * 0.2, y0 + h + r * 0.12, s * (wid * 0.72), r * 0.75, r * 0.3, r * 0.1, r * 0.03, undefined, 0.75);
  cbox(b, kit.hull, -r * 0.8, y0 + h + r * 0.08, 0, r * 0.3, r * 0.16, wid * 0.9);
  accent(C, -r * 0.8, y0 + h + r * 0.165, 0, r * 0.22, wid * 0.6);
  C.t.pitch.position.set(-r * 0.05, y0 + h + r * 0.12, 0);
  C.t.pitch.rotation.z = n >= 3 ? 0.55 : 0.45;
  cbox(p, kit.trim, 0, 0, 0, r * 0.4, R * 3.4, n * gap + R * 2.5, r * 0.05);
  bx(p, kit.panel, r * 0.3, R * 0.4, 0, r * 0.08, Math.min(R * 3.6, r * 0.5), n * gap + R * 3);
  const len = C.D * (n >= 3 ? 1.5 : xl ? 1.75 : 1.95);
  for (const z of Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * gap)) {
    barrel(C, rc, { len, rad: R, x0: r * 0.1, z, seg: xl ? 10 : 8, sleeve: true, brake: 'slot', taper: 0.9 });
    // recuperator / recoil buffer cylinders hugging the sleeve
    for (const y of n < 3 ? [R * 1.55, -R * 1.45] : [R * 1.5]) rc.cyl(kit.metal, R * 0.45, R * 0.45, len * 0.34, [r * 0.1, y, z], 'x', 6);
  }
  C.t.shot = 'shell';
  C.t.rate = xl ? 3 : 2.4;
}

/** Bomb rack / cluster dispenser / demolition charge. */
function charge(C: WCtx) {
  const { b, kit, r, y0 } = C;
  const id = C.mod.id;
  if (id === 'selfdestruct') {
    cbox(b, kit.hazard, 0, y0 + r * 0.3, 0, r * 1.0, r * 0.6, r * 0.9, r * 0.08);
    for (const z of [-r * 0.22, r * 0.22]) bx(b, kit.trim, 0, y0 + r * 0.3, z, r * 1.02, r * 0.62, r * 0.12);
    capsule(b, kit.canvas, r * 0.0, y0 + r * 0.72, 0, r * 0.14, r * 0.8, 'x', 7);
    b.lathe(kit.hot, [[0, 0], [r * 0.1, 0], [r * 0.08, r * 0.1], [0, r * 0.14]], [-r * 0.25, y0 + r * 0.6, r * 0.3], 'y', 6);
    C.acc = true;
    C.t.shot = 'none';
    C.t.rate = 99;
    return;
  }
  const yb = C.fixed ? -r * 0.32 : y0 + r * 0.32;
  cbox(b, kit.trim, 0, C.fixed ? -r * 0.06 : y0 + r * 0.7, 0, r * 1.3, r * 0.12, r * 0.9);
  if (id === 'clusterbombs') {
    for (const s of [-1, 1]) {
      capsule(b, kit.hull, 0, yb, s * r * 0.3, r * 0.26, r * 1.5, 'x', 8);
      for (let i = 0; i < 3; i++) b.cyl(kit.trim, r * 0.07, r * 0.07, r * 0.02, [-r * 0.3 + i * r * 0.3, yb - r * 0.25, s * r * 0.3], 'y', 5);
    }
  } else {
    for (const z of [-r * 0.45, 0, r * 0.45]) missile(b, kit.canvas, kit.canvas, kit.trim, -r * 0.65, yb, z, r * 0.2, r * 1.35, 8);
  }
  accent(C, 0, (C.fixed ? -r * 0.06 : y0 + r * 0.7) + r * 0.065, 0, r * 0.5, r * 0.4);
  C.t.shot = 'none';
  C.t.rate = 99;
}
