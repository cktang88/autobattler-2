// Vertical weapon carriers (round 2 hull pass): hulls that grow UP into the hero weapon instead of a flat deck with a
// turret on it. Low dark running chassis -> tall layered torso (stacked bevelled tiers, a dark seam with a glowing core
// seen through rib cut-outs) -> the hero weapon on top; the top-down silhouette comes from the masses that stick out
// round the turret disc. Distinct from warden (four corner track pods) and longarm (long spine + finned tail):
//   striker  'cross'    low assault frame: knife prow rising in stacked plates to an octagonal torso, two swept-back
//                       thruster nacelles on strut arms (the cross arms), a transverse tail reactor drum with a dorsal
//                       blade. Top-down: blade nose, disc, two swept nacelles, a bar across the tail.
//   bastion  'fortress' tall siege-mech torso over a tracked pelvis: hip drums, a glowing waist core behind ribs and
//                       rams, a flared chest of stacked plates with a chin prow, the hero on the chest between two big
//                       layered pauldrons, two tall reactor silos as a backpack. Top-down: disc + shoulder masses
//                       sticking out both sides + two round silos behind (Vulcan read).

import * as THREE from 'three';
import { bevBox, ellRing, mtx, type MatLike, type V3 } from '../geo.ts';
import type { Bld } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type MountSpec } from './registry.ts';
import { block, both, collar } from './shapes.ts';
import { frustum, ngon } from './tanks-kit.ts';
import { exhaustBox, fineFor, frame, piston, recessPanel } from './hs-kit.ts';
import { frustumPlates, ringSeat } from './hs-kit-vehicles.ts';

const biggest = (ms: MountSpec[]) => ms.reduce<MountSpec | undefined>((a, m) => (!a || m.r > a.r ? m : a), undefined);
/** plain box (12 tris) for strips and small parts */
const pbox = (b: Bld, mat: MatLike, w: number, h: number, d: number, x: number, y: number, z: number, rot?: V3) => b.g(new THREE.BoxGeometry(w, h, d), mat, mtx([x, y, z], rot));

// ---- local shape helpers ---------------------------------------------------------------------------------------------

/** Rounded nacelle along its local x (superellipse rings), yawed by `yaw` about y, centred at c. prof = [x frac, size frac]. */
function nacelle(b: Bld, mat: MatLike, c: V3, rx: number, ry: number, rz: number, yaw: number, prof: [number, number][], n = 12, flat = 0.3): void {
  const rings = prof.map(([f, k]) => ellRing(f * rx, 0, 0, Math.max(0.003, ry * k), Math.max(0.003, rz * k), n, 2.6, flat));
  b.loft(mat, rings, true, true, mtx(c, [0, yaw, 0]));
}

/** Reactor drum: dark core with a glowing inner cylinder seen between vertical rib plates, bevelled caps. Vertical. */
function reactorDrum(b: Bld, kit: Kit, x: number, z: number, r: number, y0: number, y1: number, ribs: number, shellMat: MatLike, seg = 16): void {
  const h = y1 - y0;
  // lower shell sleeve, glowing window band, upper sleeve, cap
  const wb0 = y0 + h * 0.36, wb1 = y0 + h * 0.7;
  b.lathe(shellMat, [[0, 0], [r * 1.04, 0], [r * 1.04, (wb0 - y0) * 0.8], [r * 0.96, wb0 - y0], [0, wb0 - y0]], [x, y0, z], 'y', seg);
  b.cyl(kit.plasma, r * 0.8, r * 0.8, wb1 - wb0 + 0.01, [x, wb0 - 0.005, z], 'y', seg);
  b.lathe(shellMat, [[0, 0], [r * 0.96, 0], [r * 1.04, (y1 - wb1) * 0.2], [r * 1.04, (y1 - wb1) * 0.62], [r * 0.82, y1 - wb1], [0, y1 - wb1]], [x, wb1, z], 'y', seg);
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2 + Math.PI / ribs;
    b.g(bevBox(r * 0.36, wb1 - wb0 + 0.004, r * 0.26, r * 0.05), kit.mech, mtx([x + Math.cos(a) * r * 0.9, (wb0 + wb1) / 2, z + Math.sin(a) * r * 0.9], [0, -a, 0]));
  }
}

/** hip keel for legged stances: armoured belly block reaching down to the hip drums */
function keel(c: ChassisCtx, l: number, x = 0): void {
  const { b, kit, stance, W } = c;
  if (!stance.legs) return;
  const t = stance.thick;
  const w = stance.legs === 'spider' ? W * 0.5 : Math.max(W * 0.3, W * 0.54 - t * 1.6);
  block(b, kit.mech, x, stance.hipY - t * 0.9, 0, l, w, stance.y0 - stance.hipY + t * 0.95, { top: [1.06, 1.08], ch: t * 0.5, bev: t * 0.12, bot: t * 0.25 });
}

// ---------------------------------------------------------------------------------------------------------------------
function striker(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, S, stance } = c;
  const fine = fineFor(S);
  const X = (f: number) => (f * L) / 3, Z = (f: number) => (f * W) / 2; // authored at L = 3, W = 2
  const y0 = stance.y0, yt = Math.max(stance.yt, y0 + 0.14);
  const wi = Math.min(stance.wi, Z(0.5));
  const main = biggest(c.mounts.filter((m) => m.mod.kind === 'weapon')) ?? biggest(c.mounts);
  const hx = main?.x ?? X(-0.18), hz = main?.z ?? 0;
  const R = Math.max(main?.r ?? 0.5, 0.3);
  const seatY = yt + 0.4;
  keel(c, L * 0.42, X(-0.1));
  // ---- running chassis: dark belly between the running gear, a low team fender deck over it
  block(b, kit.mech, X(0.0), y0, 0, X(2.5), wi * 2, yt - y0 + 0.04, { top: [0.96, 0.92], ch: 0.08, bev: 0.025, bot: 0.03 });
  block(b, kit.armor2, hx, yt - 0.02, hz, R * 1.9, Z(1.0), 0.08, { top: [0.97, 0.95], ch: 0.14, bev: 0.02 });
  // ---- torso: tall stacked octagon tiers under the hero (dark team base with facet plates, glowing reactor seam
  // behind ribs, light bone upper tier, dark collar), narrower than the turret so it overhangs
  const t0 = yt + 0.04, t1 = t0 + 0.15, g0 = t1 + 0.01, g1 = g0 + 0.07, t2 = seatY - 0.02;
  const o1 = ngon(8, R * 0.92, R * 0.86, Math.PI / 8, hx, hz);
  frustum(b, kit.armor2, o1, t0 - 0.02, t1 - t0 + 0.02, { top: [0.92, 0.92], bev: 0.02 });
  frustumPlates(b, kit, kit.armor, o1, t0 - 0.02, t1 - t0 + 0.02, 0.92, 0.022, { standoff: 0.006, gap: 0.012, widthK: 0.78, f0: 0.12, f1: 0.86 });
  b.cyl(kit.plasma, R * 0.72, R * 0.72, g1 - g0 + 0.02, [hx, g0 - 0.01, hz], 'y', 16);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.g(bevBox(0.07, g1 - g0, 0.05, 0.012), kit.mech, mtx([hx + Math.cos(a) * R * 0.74, (g0 + g1) / 2, hz + Math.sin(a) * R * 0.74], [0, -a, 0]));
  }
  const o2 = ngon(8, R * 0.84, R * 0.78, Math.PI / 8, hx, hz);
  frustum(b, kit.shell, o2, g1, t2 - g1, { top: [0.9, 0.9], bev: 0.025, bot: 0.012 });
  // ---- knife prow: stacked wedge plates rising from the nose up to the torso (dark chin, team wedge, light blade)
  const pX0 = hx + R * 0.45, pX1 = X(1.5);
  block(b, kit.mech, (pX0 + pX1) / 2 - 0.05, y0 + 0.02, 0, pX1 - pX0 + 0.1, Z(0.56), yt - y0 + 0.02, { top: [0.82, 0.86], shift: [-0.06, 0], ch: 0.06, bev: 0.02, bot: 0.02 });
  block(b, kit.armor, (pX0 + pX1) / 2 - 0.02, yt - 0.03, 0, pX1 - pX0 - 0.02, Z(0.66), 0.2, { top: [0.48, 0.62], shift: [-(pX1 - pX0) * 0.24, 0], ch: 0.07, bev: 0.025, mid: [[0.45, 0.86, 0.94]] });
  // blade: a light bone keel plate standing on the wedge, its top edge rising toward the torso
  b.loft(kit.shell, [0.05, -0.05].map((zz) => [
    [pX1 - 0.04, yt + 0.06, zz], [pX1 - 0.22, yt + 0.2, zz * 0.9], [pX0 + 0.04, t1 + 0.04, zz * 0.9], [pX0 - 0.02, t0, zz],
  ] as V3[]), true, true);
  // glowing eye slits on the prow cheeks + nose lamp
  both((s) => {
    pbox(b, kit.glow, 0.26, 0.026, 0.02, pX1 - 0.34, yt + 0.06, s * Z(0.27), [0, s * 0.42, -0.12]);
    pbox(b, kit.lamp, 0.03, 0.04, 0.09, pX1 - 0.02, yt - 0.04, s * Z(0.13));
  });
  // ---- thruster nacelles: the cross arms, swept back on dark strut arms with a ram, over the running gear
  const nY = yt + 0.16, nZ = Z(0.86), nX = hx + X(0.22), sweep = 0.32;
  both((s) => {
    const cN: V3 = [nX, nY, s * nZ];
    const yaw = s * sweep;
    // dark under-shell, team armour shell, light top fairing, glowing intake ring, hot exhaust cone
    nacelle(b, kit.armor2, [cN[0] - 0.02, cN[1] - 0.03, cN[2]], 0.5, 0.15, 0.2, yaw, [[-1, 0.45], [-0.8, 0.86], [0.5, 1], [0.86, 0.9], [1, 0.62]], 12, 0.5);
    nacelle(b, kit.armor, [cN[0], cN[1] + 0.035, cN[2] + s * 0.012], 0.44, 0.14, 0.17, yaw, [[-0.95, 0.5], [-0.7, 0.92], [0.3, 1], [0.7, 0.9], [0.9, 0.55]], 12, 0.2);
    nacelle(b, kit.shell, [cN[0] + 0.05, cN[1] + 0.12, cN[2] + s * 0.03], 0.3, 0.05, 0.1, yaw, [[-1, 0.5], [-0.6, 1], [0.6, 1], [1, 0.4]], 8, 0.9);
    const fwd: V3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const nose: V3 = [cN[0] + fwd[0] * 0.5, cN[1], cN[2] + fwd[2] * 0.5];
    b.lathe(kit.mech, [[0, 0], [0.13, 0], [0.13, 0.03], [0.1, 0.05], [0, 0.05]], nose, 'x', 14, [0, yaw, 0]);
    b.lathe(kit.plasma, [[0, 0], [0.09, 0], [0.09, 0.012], [0, 0.012]], [nose[0] + fwd[0] * 0.045, nose[1], nose[2] + fwd[2] * 0.045], 'x', 14, [0, yaw, 0]);
    const tail: V3 = [cN[0] - fwd[0] * 0.5, cN[1] + 0.01, cN[2] - fwd[2] * 0.5];
    b.lathe(kit.joint, [[0, 0], [0.12, 0], [0.1, 0.1], [0.08, 0.12], [0, 0.12]], tail, '-x', 12, [0, yaw, 0]);
    b.cyl(kit.hot, 0.07, 0.07, 0.01, [tail[0] - fwd[0] * 0.12, tail[1], tail[2] - fwd[2] * 0.12], 'x', 10);
    // strut arm from the torso base into the nacelle, a fat joint drum at the torso, a ram above the arm
    const root: V3 = [hx + 0.05, t0 + 0.03, s * R * 0.62];
    b.g(bevBox(0.16, 0.1, nZ - R * 0.62, 0.02), kit.mech, mtx([root[0] + 0.05, root[1], s * (R * 0.62 + (nZ - R * 0.62) / 2)], [0, s * sweep * 0.6, 0]));
    b.cylb(kit.joint, 0.09, 0.16, 0.015, [root[0], root[1], root[2] - s * 0.04], s > 0 ? 'z' : '-z', 12);
    if (fine) piston(b, kit, [root[0] - 0.12, t1, s * R * 0.66], [cN[0] - 0.18, nY + 0.12, s * (nZ - 0.16)], 0.02, 0.55, true);
  });
  // ---- tail reactor: a big transverse drum behind the torso (glowing core between ribs) on two dark yoke arms, team
  // end caps with hot exhaust rings, and a light dorsal blade standing on it (the cross bar of the top-down silhouette)
  const bX = X(-1.2), bZ = Z(0.62), bR = 0.2, bY = yt + 0.26, bTop = seatY + 0.22;
  block(b, kit.armor2, bX + 0.06, yt - 0.04, 0, 0.5, Z(0.9), 0.14, { top: [0.9, 0.9], ch: 0.08, bev: 0.02 });
  b.cyl(kit.plasma, bR * 0.8, bR * 0.8, bZ * 1.6, [bX, bY, -bZ * 0.8], 'z', 16);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.g(bevBox(0.07, 0.06, bZ * 1.56, 0.012), kit.mech, mtx([bX + Math.cos(a) * bR * 0.84, bY + Math.sin(a) * bR * 0.84, 0], [0, 0, a]));
  }
  both((s) => {
    // yoke arm, team end cap (bevelled drum), dark exhaust ring with a hot core
    block(b, kit.mech, bX + 0.02, yt + 0.04, s * (bZ * 0.8 + 0.04), 0.22, 0.08, bY - yt, { top: [0.7, 1], ch: 0.03, bev: 0.012 });
    b.lathe(kit.armor, [[0, 0], [bR * 1.12, 0], [bR * 1.16, 0.04], [bR * 1.16, bZ * 0.2], [bR * 0.92, bZ * 0.28], [0, bZ * 0.28]], [bX, bY, s * bZ * 0.8], s > 0 ? 'z' : '-z', 16);
    b.lathe(kit.shell, [[0, 0], [bR * 1.2, 0], [bR * 1.2, 0.05], [0, 0.05]], [bX, bY, s * (bZ * 0.8 + 0.08)], s > 0 ? 'z' : '-z', 16);
    b.cyl(kit.hot, bR * 0.5, bR * 0.5, 0.012, [bX, bY, s * (bZ * 1.08 + 0.002)], s > 0 ? 'z' : '-z', 12);
  });
  // spine: a raised team block from the torso back to the drum (light cap, dark seam), under the turret's overhang
  const spX0 = bX + bR * 0.6, spX1 = hx - R * 0.55;
  block(b, kit.armor, (spX0 + spX1) / 2, yt - 0.02, 0, spX1 - spX0, Z(0.42), 0.26, { top: [0.92, 0.8], ch: 0.06, bev: 0.025 });
  block(b, kit.shell, (spX0 + spX1) / 2 - 0.03, yt + 0.235, 0, (spX1 - spX0) * 0.7, Z(0.2), 0.04, { top: [0.9, 0.8], ch: 0.03, bev: 0.012 });
  // dorsal blade: two-layer fin (team core, light edge) rising off the drum behind the turret's sweep
  b.loft(kit.armor, [0.035, -0.035].map((zz) => [[bX + 0.22, bY + bR * 0.6, zz], [bX + 0.02, bTop, zz], [bX - 0.2, bTop - 0.04, zz], [bX - 0.3, bY, zz]] as V3[]), true, true);
  b.loft(kit.shell, [0.05, -0.05].map((zz) => [[bX + 0.05, bTop - 0.06, zz], [bX + 0.0, bTop + 0.025, zz], [bX - 0.2, bTop - 0.015, zz], [bX - 0.18, bTop - 0.09, zz]] as V3[]), true, true);
  pbox(b, kit.glow, 0.2, 0.025, 0.08, bX - 0.08, bTop - 0.12, 0, [0, 0, 0.12]);
  // ---- rear: low tail deck and tow eye
  block(b, kit.armor2, X(-1.42), y0 + 0.06, 0, 0.16, Z(0.7), yt - y0, { top: [0.7, 0.9], shift: [0.02, 0], ch: 0.04, bev: 0.015 });
  const deck = (x: number, z: number): number => {
    if (Math.hypot(x - hx, z - hz) < R * 0.78) return seatY;
    if (Math.abs(x - bX) < bR && Math.abs(z) < bZ) return bY + bR;
    if (x > pX0 && x < pX1 && Math.abs(z) < Z(0.33)) return yt + 0.16;
    return Math.abs(x) <= L / 2 && Math.abs(z) <= W / 2 ? yt + 0.06 : -1;
  };
  return {
    deckAt: deck, top: bTop, custom: true, dressed: true,
    seat: (m) => {
      if (m === main) { collar(b, kit, m.x, seatY, m.z, m.r, seatY - 0.05, 16); return { y: seatY, socket: true }; }
      // a utility rides the prow (sensor head over the nose) or the backpack bridge
      return { y: ringSeat(b, kit, m, Math.max(yt + 0.06, deck(m.x, m.z)), 0.02, 12), socket: true };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
function bastion(c: ChassisCtx): ChassisOut {
  // Tall siege mech torso standing over a tracked pelvis (Vulcan / Fortress read): low armoured pelvis on wall skirts ->
  // a dark mechanical waist (glowing core between ribs, rams up to the chest) -> a broad flared chest of stacked plates
  // -> the hero weapon on the chest top between two big layered pauldrons, two tall reactor silos as a backpack.
  const { b, kit, L, W, S, stance } = c;
  const fine = fineFor(S);
  const kx = L / 2, kz = W / 2, k = Math.min(kx, kz); // ~1.33
  const y0 = stance.y0, yt = Math.max(stance.yt, y0 + 0.15 * k);
  const wi = Math.min(stance.wi, 0.62 * kz);
  // the torso stands on the front hardpoint (slot 0), which normally carries the hero
  const front = [...c.mounts].sort((a, q) => q.x - a.x)[0];
  const onTorso = (m: MountSpec) => Math.abs(m.z) < 0.1 && m.x > -0.1 * kx;
  const hx = front && onTorso(front) ? front.x : 0.06 * L, hz = 0;
  const top = c.mounts.find(onTorso);
  const R = Math.max(top?.r ?? 0.75 * k, 0.45 * k);
  const pY = yt + 0.08 * k; // pelvis deck
  const wY0 = pY + 0.02 * k, wY1 = yt + 0.46 * k; // waist
  const seatY = yt + 0.88 * k;
  keel(c, L * 0.5);
  // ---- pelvis: dark belly, team lower hull with a sloped glacis, light deck plates, low ram + lamps at the nose
  block(b, kit.mech, -0.02 * kx, y0, 0, 1.86 * kx, wi * 2, yt - y0 + 0.04, { top: [0.97, 0.94], ch: 0.1, bev: 0.03, bot: 0.04 });
  block(b, kit.armor, -0.02 * kx, yt - 0.06 * k, 0, 1.3 * kx, 1.18 * kz, pY - yt + 0.06 * k, { top: [0.88, 0.9], ch: 0.14 * k, bev: 0.03 * k });
  block(b, kit.armor2, 0.86 * kx, y0 + 0.02 * k, 0, 0.32 * kx, 1.0 * kz, yt - y0 + 0.02 * k, { top: [0.4, 0.92], shift: [-0.1 * kx, 0], ch: 0.06 * k, bev: 0.02 * k, bot: 0.02 * k });
  both((s) => {
    block(b, kit.shell, 0.52 * kx, pY - 0.005, s * 0.42 * kz, 0.4 * kx, 0.36 * kz, 0.04 * k, { top: [0.84, 0.86], ch: 0.04 * k, bev: 0.015 * k });
    pbox(b, kit.lamp, 0.03 * k, 0.05 * k, 0.12 * k, 0.99 * kx, yt - 0.04 * k, s * 0.3 * kz);
  });
  // track hoods: layered armour over each track run (dark guard, team hood, light rail cap) with a glow strip
  const wX0 = -0.94 * kx, wX1 = 0.38 * kx, wl = wX1 - wX0, wz = Math.max(wi + 0.2 * k, 0.8 * kz), ww = 0.36 * kz;
  both((s) => {
    block(b, kit.armor2, (wX0 + wX1) / 2, yt + 0.02 * k, s * wz, wl, ww, 0.1 * k, { top: [0.97, 0.86], shift: [0, -s * 0.02 * k], ch: 0.06 * k, bev: 0.02 * k });
    block(b, kit.armor, (wX0 + wX1) / 2 - 0.04 * k, yt + 0.11 * k, s * (wz - 0.02 * k), wl * 0.9, ww * 0.82, 0.08 * k, { top: [0.9, 0.78], shift: [-0.03 * k, -s * 0.02 * k], ch: 0.06 * k, bev: 0.025 * k });
    block(b, kit.shell, (wX0 + wX1) / 2 - 0.1 * k, yt + 0.185 * k, s * (wz - 0.05 * k), wl * 0.5, ww * 0.38, 0.035 * k, { top: [0.9, 0.8], ch: 0.03 * k, bev: 0.012 * k });
    pbox(b, kit.glow, wl * 0.36, 0.022 * k, 0.025 * k, (wX0 + wX1) / 2 + 0.1 * k, yt + 0.07 * k, s * (wz + ww * 0.5 + 0.004));
  });
  // ---- waist: dark octagonal column with a glowing core behind ribs, a turntable ring, four rams up to the chest
  const wR = R * 0.48;
  frustum(b, kit.mech, ngon(8, wR * 1.25, wR * 1.25, Math.PI / 8, hx, hz), pY - 0.01, 0.07 * k, { top: [0.92, 0.92], bev: 0.015 * k });
  b.cyl(kit.plasma, wR * 0.82, wR * 0.82, wY1 - wY0, [hx, wY0, hz], 'y', 16);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    b.g(bevBox(0.1 * k, wY1 - wY0, 0.06 * k, 0.012), kit.mech, mtx([hx + Math.cos(a) * wR * 0.86, (wY0 + wY1) / 2, hz + Math.sin(a) * wR * 0.86], [0, -a, 0]));
  }
  b.cylb(kit.joint, wR * 1.02, 0.05 * k, 0.01, [hx, wY1 - 0.04 * k, hz], 'y', 18);
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) piston(b, kit, [hx + dx * wR * 1.15, pY + 0.01, dz * wR * 0.9], [hx + dx * wR * 1.15, wY1 + 0.04 * k, dz * wR * 1.25], 0.045 * k, 0.5, fine);
  // hip drums: the waist turns on a fat cross axle with big drums either side (the mech's hips over the tracks)
  const hipY = pY + 0.1 * k, hipZ = wR * 1.25 + 0.12 * k;
  b.cylb(kit.mech, 0.08 * k, hipZ * 2, 0.01, [hx - 0.04 * k, hipY, -hipZ], 'z', 12);
  both((s) => {
    b.lathe(kit.joint, [[0, 0], [0.17 * k, 0], [0.19 * k, 0.03 * k], [0.19 * k, 0.11 * k], [0.15 * k, 0.15 * k], [0, 0.15 * k]], [hx - 0.04 * k, hipY, s * (hipZ - 0.1 * k)], s > 0 ? 'z' : '-z', 18);
    b.lathe(kit.armor, [[0, 0], [0.13 * k, 0], [0.1 * k, 0.04 * k], [0, 0.04 * k]], [hx - 0.04 * k, hipY, s * (hipZ + 0.05 * k)], s > 0 ? 'z' : '-z', 14);
  });
  // abdomen: two stacked plates hung in front of the core (team over dark), the glow shows round their edges
  const abY0 = wY0 + 0.06 * k, abY1 = wY1 - 0.02 * k;
  b.g(bevBox(0.05 * k, abY1 - abY0, wR * 1.3, 0.014 * k), kit.armor2, mtx([hx + wR * 1.0, (abY0 + abY1) / 2, hz], [0, 0, 0.12]));
  b.g(bevBox(0.05 * k, (abY1 - abY0) * 0.7, wR * 0.9, 0.014 * k), kit.shell, mtx([hx + wR * 1.0 + 0.045 * k, (abY0 + abY1) / 2 + 0.03 * k, hz], [0, 0, 0.12]));
  // ---- chest: broad V-flared stack (dark under-plate, team chest, light breast plates, collar), narrower than the turret
  const cL = R * 1.5, cW = R * 1.5, cY0 = wY1 - 0.01, cY1 = seatY - 0.03 * k;
  block(b, kit.armor2, hx - 0.02 * k, cY0, hz, cL * 0.78, cW * 0.78, 0.12 * k, { top: [1.18, 1.2], ch: 0.08 * k, bev: 0.02 * k, bot: 0.03 * k });
  block(b, kit.armor, hx - 0.03 * k, cY0 + 0.1 * k, hz, cL * 0.92, cW * 0.94, cY1 - cY0 - 0.1 * k, { top: [1.04, 1.06], ch: 0.14 * k, bev: 0.035 * k, mid: [[0.5, 1.04, 1.06]] });
  // breast: two light plates on the front face, stacked over a dark backing, a glowing vent slot between them
  both((s) => {
    const F = frame([hx + cL * 0.5, (cY0 + cY1) / 2 + 0.04 * k, s * cW * 0.24], [1, 0.22, s * 0.25], [0, 0, 1]);
    b.g(bevBox(cW * 0.4, 0.035 * k, (cY1 - cY0) * 0.62, 0.012 * k), kit.shell, F.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.02 * k, 0)));
    b.g(bevBox(cW * 0.3, 0.03 * k, (cY1 - cY0) * 0.4, 0.01 * k), kit.armor, F.clone().multiply(new THREE.Matrix4().makeTranslation(-s * 0.01 * k, 0.05 * k, -0.02 * k)));
    // side plate on each chest flank (team over dark), with a vent grille
    const G = frame([hx - 0.02 * k, (cY0 + cY1) / 2 + 0.02 * k, s * cW * 0.5], [0, 0.1, s], [1, 0, 0]);
    b.g(bevBox(cL * 0.7, 0.03 * k, (cY1 - cY0) * 0.55, 0.01 * k), kit.armor2, G);
  });
  pbox(b, kit.plasma, 0.03 * k, (cY1 - cY0) * 0.45, cW * 0.1, hx + cL * 0.52, (cY0 + cY1) / 2, hz, [0, 0, -0.22]);
  // chin: a light prow wedge jutting forward under the breast plates
  block(b, kit.shell, hx + cL * 0.5, cY0 + 0.02 * k, hz, 0.24 * k, cW * 0.42, 0.14 * k, { top: [0.5, 0.8], shift: [-0.05 * k, 0], ch: 0.04 * k, bev: 0.015 * k });
  // ---- pauldrons: big layered shoulder masses hung off the chest on joint drums (dark shell, team shell, light cap)
  const pz = cW * 0.5 + 0.3 * k, pyC = seatY - 0.17 * k;
  both((s) => {
    b.cylb(kit.joint, 0.13 * k, pz - cW * 0.42, 0.02 * k, [hx, pyC - 0.04 * k, s * cW * 0.42], s > 0 ? 'z' : '-z', 14);
    b.lathe(kit.mech, [[0, 0], [0.17 * k, 0], [0.14 * k, 0.05 * k], [0, 0.05 * k]], [hx, pyC - 0.04 * k, s * (pz - 0.14 * k)], s > 0 ? 'z' : '-z', 14);
    nacelle(b, kit.armor2, [hx - 0.02 * k, pyC - 0.04 * k, s * pz], 0.5 * k, 0.2 * k, 0.24 * k, 0, [[-1, 0.5], [-0.75, 0.9], [0.5, 1], [0.85, 0.85], [1, 0.5]], 14, 0.55);
    nacelle(b, kit.armor, [hx, pyC + 0.02 * k, s * (pz + 0.02 * k)], 0.46 * k, 0.17 * k, 0.25 * k, 0, [[-0.95, 0.5], [-0.7, 0.92], [0.4, 1], [0.8, 0.88], [0.95, 0.5]], 14, 0.15);
    nacelle(b, kit.shell, [hx + 0.04 * k, pyC + 0.12 * k, s * (pz + 0.04 * k)], 0.34 * k, 0.06 * k, 0.17 * k, 0, [[-1, 0.5], [-0.6, 1], [0.6, 1], [1, 0.45]], 10, 0.9);
    // glowing strip along each pauldron's outer face, lamp at its nose
    pbox(b, kit.glow, 0.5 * k, 0.028 * k, 0.03 * k, hx - 0.04 * k, pyC - 0.02 * k, s * (pz + 0.25 * k));
    pbox(b, kit.lamp, 0.03 * k, 0.05 * k, 0.1 * k, hx + 0.47 * k, pyC - 0.02 * k, s * (pz + 0.04 * k));
  });
  // ---- backpack: two tall reactor silos behind the torso, a bridge block and a feed spine down to the pelvis
  const sX = -0.8 * kx, sZ = 0.44 * kz, sR = 0.19 * k, sTop = seatY + 0.26 * k;
  block(b, kit.armor2, sX + 0.02 * k, pY - 0.02 * k, 0, 0.5 * k, 2 * sZ + 0.3 * k, 0.14 * k, { top: [0.9, 0.94], ch: 0.07 * k, bev: 0.02 * k });
  both((s) => {
    reactorDrum(b, kit, sX, s * sZ, sR, pY + 0.1 * k, sTop, 8, kit.shell, 20);
    b.lathe(kit.armor, [[0, 0], [sR * 1.2, 0], [sR * 1.2, 0.08 * k], [sR * 1.08, 0.11 * k], [0, 0.11 * k]], [sX, pY + 0.1 * k, s * sZ], 'y', 16);
    b.lathe(kit.armor, [[0, 0], [sR * 1.1, 0], [sR * 1.1, 0.06 * k], [0, 0.06 * k]], [sX, sTop - 0.22 * k, s * sZ], 'y', 16);
    b.lathe(kit.armor2, [[0, 0], [sR * 0.86, 0], [sR * 0.7, 0.07 * k], [sR * 0.38, 0.1 * k], [0, 0.1 * k]], [sX, sTop - 0.005, s * sZ], 'y', 16);
    b.cyl(kit.hot, sR * 0.28, sR * 0.28, 0.01, [sX, sTop + 0.096 * k, s * sZ], 'y', 10);
  });
  const bH = seatY - 0.12 * k;
  block(b, kit.armor, sX + 0.02 * k, pY + 0.1 * k, 0, 0.34 * k, 2 * sZ - sR * 1.4, bH - pY - 0.1 * k, { top: [0.86, 0.9], shift: [0.02 * k, 0], ch: 0.06 * k, bev: 0.025 * k });
  block(b, kit.shell, sX + 0.03 * k, bH - 0.005, 0, 0.26 * k, 2 * sZ - sR * 2.1, 0.05 * k, { top: [0.86, 0.86], ch: 0.04 * k, bev: 0.015 * k });
  // spine: dark beam from the bridge into the chest's back
  b.g(bevBox(0.16 * k, 0.12 * k, hx - cL * 0.4 - sX, 0.02 * k), kit.mech, mtx([(sX + hx - cL * 0.4) / 2, bH - 0.1 * k, 0], [0, Math.PI / 2, 0]));
  if (fine) recessPanel(b, kit, frame([sX - 0.17 * k, (pY + bH) / 2, 0], [-1, 0, 0], [0, 1, 0]), (bH - pY) * 0.5, sZ, 0.012 * k, { slats: 4, frame: kit.armor });
  both((s) => exhaustBox(b, kit, frame([-0.98 * kx, pY, s * 0.68 * kz], [0, 1, 0], [-1, 0, 0]), 0.05 * k, fine));
  const deck = (x: number, z: number): number => {
    const az = Math.abs(z);
    if (Math.hypot(x - hx, z - hz) < R * 0.78) return seatY;
    if (Math.abs(x - hx) < 0.4 * k && Math.abs(az - pz) < 0.2 * k) return pyC + 0.18 * k;
    if (Math.hypot(x - sX, az - sZ) < sR) return sTop;
    if (Math.abs(x - sX) < 0.2 * k && az < sZ) return bH + 0.05 * k;
    if (x > wX0 && x < wX1 && Math.abs(az - wz) < ww / 2) return yt + 0.2 * k;
    return Math.abs(x) <= kx * 0.86 && az <= kz * 0.72 ? pY : Math.abs(x) <= kx && az <= kz ? yt : -1;
  };
  return {
    deckAt: deck, top: sTop, custom: true, dressed: true,
    seat: (m) => {
      if (m === top) { collar(b, kit, m.x, seatY, m.z, m.r, seatY - 0.05 * k, 18); return { y: seatY, socket: true }; }
      // rear hardpoints ride the pelvis deck beside the silos on a short drum
      const y = pY + 0.12 * k;
      frustum(b, kit.armor2, ngon(8, m.r * 1.0, m.r * 1.0, Math.PI / 8, m.x, m.z), pY - 0.02 * k, y - pY + 0.02 * k, { top: [0.9, 0.9], bev: 0.015 * k });
      return { y: ringSeat(b, kit, m, y, 0.02 * k, 14), socket: true };
    },
  };
}

registerChassis('cross', striker);
registerChassis('fortress', bastion);
