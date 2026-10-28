// Heavy brawler / siege hulls built AROUND their main weapon system (Mechabellum / War Robots style): tall, layered,
// integrated upper bodies over the running gear instead of flat decks with a turret on top.
//   riot       (riot)       riot brute, asymmetric: the hero gun rides a tall armoured gun shoulder on one side, the
//                           other side is a hunched shield arm (pauldron, elbow drum, forearm) planting a huge curved
//                           riot shield ahead of the hull; a hunched chest + visor head between, reactor backpack.
//   siegeplat  (siegeplat)  siege spire: a long dark girder keel whose gun end rises into a towering erector (twin
//                           layered pylons, big rams, glowing coil column) lifting the hero high; ammo magazine with a
//                           glowing feed core and a feed chute up the tower at the other end; four splayed jack legs.
//   goliath    (goliath)    warhulk: a hunched titan torso standing on the four corner track pods: pelvis between the
//                           pods, a tall chest carrying the giant gun in a chest cradle, two huge shoulder masses with
//                           the flank guns on top (mirrored pair) and arms knuckling down to the front pods, a reactor
//                           hump with the rear gun, glowing cores in the gaps.
// Paint roles: kit.armor (team), kit.armor2 (near-black team), kit.shell (light bone), kit.mech (near-black mechanics),
// kit.joint (metal), kit.glow / kit.plasma / kit.lamp (emissive, chunky enough to bloom).

import * as THREE from 'three';
import { mtx, type P2, type V3 } from '../geo.ts';
import type { Kit, MatLike } from '../materials.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar, type BlockOpts } from './shapes.ts';
import { cableBundle, fineFor, jointDrum, piston } from './hs-kit.ts';
import { ringSeat } from './hs-kit-vehicles.ts';
import type { Bld } from '../geo.ts';

const biggest = (ms: MountSpec[]) => ms.reduce<MountSpec | undefined>((a, m) => (!a || m.r > a.r ? m : a), undefined);
const grounded = (c: ChassisCtx) => !c.stance.legs && c.mob.kind !== 'air';

/** plain box for small emissive / accent parts */
function pbox(b: Bld, mat: MatLike, w: number, h: number, d: number, x: number, y: number, z: number, rot?: V3): void {
  b.g(new THREE.BoxGeometry(w, h, d), mat, mtx([x, y, z], rot));
}

/** block() under a matrix (rotated / leaning parts): same options, built at the local origin (bottom at y = 0) */
function mblock(b: Bld, mat: MatLike, M: THREE.Matrix4, l: number, w: number, h: number, o: BlockOpts = {}): void {
  block({ loft: (m: MatLike, rings: V3[][]) => b.loft(m, rings, true, true, M) } as unknown as Bld, mat, 0, 0, 0, l, w, h, o);
}

/** Glowing core seen through cut-outs: a dark drum (axis `ax`) with n window slots round it, an emissive core inside
 *  showing through the slots, and armoured end caps. r = drum radius, len = drum length; p = centre. */
function glowCore(b: Bld, kit: Kit, p: V3, r: number, len: number, ax: 'x' | 'y' | 'z', n = 6, core: MatLike = kit.plasma): void {
  const o: V3 = ax === 'y' ? [p[0], p[1] - len / 2, p[2]] : ax === 'x' ? [p[0] - len / 2, p[1], p[2]] : [p[0], p[1], p[2] - len / 2];
  // emissive core (slightly smaller than the cage)
  b.cyl(core, r * 0.8, r * 0.8, len * 0.9, ax === 'y' ? [o[0], o[1] + len * 0.05, o[2]] : ax === 'x' ? [o[0] + len * 0.05, o[1], o[2]] : [o[0], o[1], o[2] + len * 0.05], ax, 12);
  // cage bars round it (the cut-outs are the gaps between them)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a) * r * 0.9, s = Math.sin(a) * r * 0.9;
    const at: V3 = ax === 'y' ? [p[0] + c, p[1], p[2] + s] : ax === 'x' ? [p[0], p[1] + c, p[2] + s] : [p[0] + c, p[1] + s, p[2]];
    const rot: V3 = ax === 'y' ? [0, -a, 0] : ax === 'x' ? [a, 0, 0] : [0, 0, a];
    // bars: thin radially, wide tangentially, full drum length
    const t = r * 0.3, tw = r * 0.46, bl = len * 0.92;
    if (ax === 'y') b.box(kit.mech, t, bl, tw, at[0], at[1], at[2], r * 0.06, rot);
    else if (ax === 'x') b.box(kit.mech, bl, t, tw, at[0], at[1], at[2], r * 0.06, rot);
    else b.box(kit.mech, t, tw, bl, at[0], at[1], at[2], r * 0.06, rot);
  }
  // armoured end caps (stepped rings)
  for (const e of [0, 1]) {
    const q: V3 = ax === 'y' ? [o[0], o[1] + e * len, o[2]] : ax === 'x' ? [o[0] + e * len, o[1], o[2]] : [o[0], o[1], o[2] + e * len];
    const prof: P2[] = [[0, -r * 0.12], [r * 1.12, -r * 0.12], [r * 1.12, r * 0.06], [r * 0.95, r * 0.14], [0, r * 0.14]];
    b.lathe(kit.armor2, prof, q, ax, 14);
  }
}

// =====================================================================================================================
// RIOT: asymmetric brute (gun shoulder + shield arm)
// =====================================================================================================================
function riot(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, S, stance } = c;
  const kx = L / 2, kz = W / 3; // authored at L = 2, W = 3
  const k = Math.min(kx, kz * 1.5) * (0.85 + 0.075 * S);
  const fine = fineFor(S);
  const y0 = stance.y0;
  const ya = Math.max(stance.yt, y0 + 0.2 * k); // shoulder / fender level: the upper body starts here
  const wi = Math.min(stance.wi, 1.0 * kz);
  const hero = biggest(c.mounts);
  const hs: -1 | 1 = hero && hero.z > 0.05 ? 1 : -1; // gun side
  const os = -hs as -1 | 1; // shield side
  const hx = hero?.x ?? -0.24 * kx, hz = hero?.z ?? hs * 0.6 * kz, R = hero?.r ?? 0.75 * k;
  const seatY = ya + 1.02 * k;
  // ---- lower body: a narrow dark waist recessed between the running gear (the upper body overhangs it)
  block(b, kit.mech, -0.05 * kx, y0, 0, 1.45 * kx, Math.min(2 * wi * 0.9, 1.3 * kz), ya - y0 + 0.12 * k, { top: [0.96, 0.96], ch: 0.12 * k, bev: 0.025 * k, bot: 0.04 * k });
  // ---- torso core: one dark mass flaring out from the waist to broad shoulders over the tracks (inverted taper)
  const tY = ya + 0.58 * k; // shoulder line
  block(b, kit.mech, -0.08 * kx, ya + 0.02 * k, 0, 1.3 * kx, 1.3 * kz, tY - ya - 0.02 * k, { top: [1.22, 1.8], mid: [[0.55, 1.12, 1.5]], ch: 0.16 * k, bev: 0.03 * k });
  // ---- gun shoulder: layered armour mass climbing from the shoulder line straight up into the gun collar
  const tw = R * 1.0;
  const gz = hz + hs * 0.05 * kz; // the mass leans slightly outboard under the gun
  block(b, kit.armor2, hx, tY - 0.22 * k, gz, 1.5 * kx, 1.24 * kz, 0.3 * k, { top: [0.96, 0.94], ch: 0.14 * k, bev: 0.03 * k });
  block(b, kit.armor, hx + 0.02 * kx, tY + 0.06 * k, gz, 1.4 * kx, 1.12 * kz, seatY - tY - 0.1 * k, { top: [0.64, 0.68], shift: [-0.02 * kx, hz - gz], mid: [[0.45, 0.9, 0.92]], ch: 0.16 * k, bev: 0.04 * k });
  // bone cheek plate on the outboard slope, a glow strip under it, a dark collar band under the gun
  block(b, kit.shell, hx + 0.06 * kx, tY + 0.14 * k, hz + hs * 0.42 * kz, 0.95 * kx, 0.12 * kz, seatY - tY - 0.34 * k, { top: [0.78, 0.5], shift: [-0.04 * kx, -hs * 0.1 * kz], ch: 0.05 * k, bev: 0.02 * k });
  pbox(b, kit.glow, 0.8 * kx, 0.045 * k, 0.04 * k, hx + 0.04 * kx, tY + 0.08 * k, hz + hs * 0.56 * kz);
  b.lathe(kit.mech, [[0, 0], [tw * 0.62, 0], [tw * 0.6, 0.12 * k], [0, 0.12 * k]], [hx, seatY - 0.14 * k, hz], 'y', 12);
  // front: sloped dark glacis from the waist up the gun shoulder's face, bone brow under the gun
  block(b, kit.armor2, hx + 0.55 * kx, ya - 0.04 * k, hz, 0.42 * kx, 0.95 * kz, seatY - ya - 0.2 * k, { top: [0.25, 0.86], shift: [-0.18 * kx, 0], ch: 0.08 * k, bev: 0.025 * k });
  block(b, kit.shell, hx + 0.48 * kx, seatY - 0.36 * k, hz, 0.22 * kx, 0.85 * kz, 0.18 * k, { top: [0.3, 0.9], shift: [-0.07 * kx, 0], ch: 0.05 * k, bev: 0.02 * k });
  // ---- chest between the shoulders: a raised spine ridge (team / bone stack) and a sloped bone breastplate down to
  // the visor head jutting out under it
  const tz = os * 0.32 * kz;
  block(b, kit.armor, -0.25 * kx, tY - 0.1 * k, tz, 0.95 * kx, 0.62 * kz, 0.36 * k, { top: [0.72, 0.7], shift: [-0.05 * kx, 0], ch: 0.12 * k, bev: 0.035 * k });
  block(b, kit.shell, -0.3 * kx, tY + 0.24 * k, tz, 0.55 * kx, 0.34 * kz, 0.08 * k, { top: [0.75, 0.7], ch: 0.06 * k, bev: 0.02 * k });
  block(b, kit.armor2, 0.4 * kx, ya + 0.04 * k, tz, 0.4 * kx, 0.8 * kz, tY - ya + 0.12 * k, { top: [0.3, 0.86], shift: [-0.16 * kx, 0], ch: 0.08 * k, bev: 0.025 * k });
  block(b, kit.shell, 0.34 * kx, tY - 0.14 * k, tz, 0.34 * kx, 0.66 * kz, 0.26 * k, { top: [0.35, 0.8], shift: [-0.12 * kx, 0], ch: 0.06 * k, bev: 0.02 * k });
  const hdx = 0.66 * kx, hdy = ya - 0.02 * k, hdz = tz * 0.7;
  block(b, kit.mech, hdx, hdy, hdz, 0.4 * kx, 0.46 * kz, 0.28 * k, { top: [0.6, 0.8], shift: [0.03 * kx, 0], ch: 0.07 * k, bev: 0.02 * k });
  block(b, kit.shell, hdx - 0.02 * kx, hdy + 0.26 * k, hdz, 0.38 * kx, 0.5 * kz, 0.07 * k, { top: [0.6, 0.9], shift: [0.03 * kx, 0], ch: 0.04 * k, bev: 0.015 * k });
  pbox(b, kit.glow, 0.05 * k, 0.06 * k, 0.34 * kz, hdx + 0.19 * kx, hdy + 0.16 * k, hdz, [0, 0, -0.4]);
  // shield shoulder mass (carries the pauldron)
  block(b, kit.armor2, 0.0, tY - 0.22 * k, os * 0.9 * kz, 1.1 * kx, 0.9 * kz, 0.3 * k, { top: [0.94, 0.92], ch: 0.12 * k, bev: 0.03 * k });
  block(b, kit.armor, -0.04 * kx, tY + 0.06 * k, os * 0.88 * kz, 0.95 * kx, 0.72 * kz, 0.16 * k, { top: [0.8, 0.75], ch: 0.1 * k, bev: 0.03 * k });
  // ---- shield arm (other side): shoulder drum, layered pauldron, upper arm, elbow drum, forearm, curved riot shield
  const sh: V3 = [0.02 * kx, ya + 0.86 * k, os * 1.1 * kz];
  const el: V3 = [0.42 * kx, ya + 0.34 * k, os * 1.24 * kz];
  const wr: V3 = [0.78 * kx, ya + 0.42 * k, os * 1.02 * kz];
  jointDrum(b, kit, [sh[0], sh[1] - 0.06 * k, os * 0.92 * kz], 0.16 * k, 0.3 * k, 'z');
  beam(b, kit.mech, sh, el, 0.17 * k, 0.15 * k);
  beam(b, kit.armor2, [sh[0] + 0.02 * kx, sh[1] - 0.08 * k, sh[2] + os * 0.07 * k], [el[0] - 0.02 * kx, el[1] + 0.05 * k, el[2] + os * 0.05 * k], 0.22 * k, 0.12 * k, [0, 0, os]);
  jointDrum(b, kit, el, 0.12 * k, 0.28 * k, 'z');
  beam(b, kit.mech, el, wr, 0.15 * k, 0.14 * k);
  beam(b, kit.armor, [el[0] + 0.04 * kx, el[1] + 0.06 * k, el[2] + os * 0.04 * k], [wr[0] - 0.06 * kx, wr[1] + 0.05 * k, wr[2] + os * 0.06 * k], 0.21 * k, 0.12 * k, [0, 0, os]);
  // pauldron: three stacked plates with offset edges (dark base, team shell, bone cap)
  block(b, kit.armor2, sh[0] - 0.02 * kx, sh[1] - 0.2 * k, sh[2] + os * 0.02 * k, 0.62 * kx, 0.52 * kz, 0.28 * k, { top: [0.86, 0.8], ch: 0.1 * k, bev: 0.03 * k });
  block(b, kit.armor, sh[0] - 0.04 * kx, sh[1] + 0.02 * k, sh[2] + os * 0.05 * k, 0.58 * kx, 0.48 * kz, 0.17 * k, { top: [0.72, 0.7], shift: [-0.02 * kx, os * 0.03 * k], ch: 0.1 * k, bev: 0.035 * k });
  block(b, kit.shell, sh[0] - 0.06 * kx, sh[1] + 0.16 * k, sh[2] + os * 0.06 * k, 0.36 * kx, 0.3 * kz, 0.07 * k, { top: [0.7, 0.66], ch: 0.07 * k, bev: 0.025 * k });
  pbox(b, kit.glow, 0.34 * kx, 0.04 * k, 0.03 * k, sh[0] - 0.02 * kx, sh[1] - 0.08 * k, sh[2] + os * 0.27 * kz);
  // the shield: one curved wall of three tight segments wrapping the shield side, leaning back, layered (dark
  // backing, team face plate, bone top band), a glowing vision slit and a steel cutting edge along the bottom
  const sH = ya + 0.9 * k, sY0 = 0.05 * k, sh2 = sH - sY0;
  let P: P2[] = [[0.9, 0.3], [1.04, 0.74], [1.04, 1.2], [0.86, 1.58]];
  P = P.map(([x, z]) => [x * kx, os * z * kz] as P2);
  if (os < 0) P.reverse(); // local z must run toward +z so the face (local +x) points forward
  for (let i = 0; i < 3; i++) {
    const [x0, z0] = P[i], [x1, z1] = P[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0) * 1.08, yaw = Math.atan2(x1 - x0, z1 - z0);
    const M = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationZ(0.14)).setPosition((x0 + x1) / 2, sY0 + sh2 / 2, (z0 + z1) / 2);
    const put = (mat: MatLike, l: number, h: number, w: number, dx: number, dy: number, bev: number) =>
      mblock(b, mat, M.clone().multiply(new THREE.Matrix4().makeTranslation(dx, dy - h / 2, 0)), l, w, h, { ch: bev, bev: bev * 0.6 });
    put(kit.armor2, 0.11 * k, sh2, len, 0, 0, 0.035 * k);
    put(kit.armor, 0.06 * k, sh2 * 0.56, len * 0.84, 0.06 * k, -sh2 * 0.08, 0.025 * k);
    put(kit.shell, 0.08 * k, sh2 * 0.15, len * 0.96, 0.04 * k, sh2 * 0.41, 0.025 * k);
    b.g(new THREE.BoxGeometry(0.04 * k, 0.05 * k, len * 0.98), kit.joint, M.clone().multiply(new THREE.Matrix4().makeTranslation(0.05 * k, -sh2 / 2 + 0.04 * k, 0)));
    if (i === 1) b.g(new THREE.BoxGeometry(0.03 * k, 0.05 * k, len * 0.7), kit.glow, M.clone().multiply(new THREE.Matrix4().makeTranslation(0.095 * k, sh2 * 0.27, 0)));
  }
  // shield bracing: forearm clamp to the shield back + a ram to its top
  beam(b, kit.mech, wr, [0.94 * kx, wr[1] + 0.02 * k, wr[2]], 0.2 * k, 0.18 * k);
  piston(b, kit, [el[0], el[1] + 0.1 * k, os * 0.8 * kz], [0.9 * kx, sH - 0.14 * k, os * 0.8 * kz], 0.032 * k, 0.5, fine);
  // ---- reactor backpack behind the torso: vertical glowing core through cut-outs, twin stacks
  const bx = -0.8 * kx, bz = os * 0.3 * kz;
  block(b, kit.armor2, bx, tY - 0.12 * k, bz, 0.42 * kx, 0.7 * kz, 0.16 * k, { ch: 0.08 * k, bev: 0.02 * k });
  glowCore(b, kit, [bx, tY + 0.3 * k, bz], 0.18 * k, 0.52 * k, 'y', 6);
  both((s) => {
    b.cylb(kit.mech, 0.045 * k, 0.66 * k, 0.01 * k, [bx - 0.12 * kx, tY - 0.04 * k, bz + s * 0.3 * kz], 'y', 8);
    b.cyl(kit.hot, 0.03 * k, 0.03 * k, 0.01 * k, [bx - 0.12 * kx, tY + 0.625 * k, bz + s * 0.3 * kz], 'y', 8);
  });
  if (fine) cableBundle(b, kit, [bx + 0.1 * kx, tY + 0.4 * k, bz - os * 0.1 * kz], [hx - 0.1 * kx, seatY - 0.24 * k, hz + os * tw * 0.45], 0.022 * k, [1, 0, 0], 3, 0.1);
  // ---- legs: hip keel under the belly
  if (stance.legs) {
    const t = stance.thick;
    block(b, kit.mech, -0.1 * kx, stance.hipY - t * 0.9, 0, L * 0.5, Math.max(W * 0.3, W * 0.54 - t * 1.6), y0 - stance.hipY + t * 0.95, { top: [1.06, 1.08], ch: t * 0.5, bev: t * 0.12, bot: t * 0.25 });
  }
  const deck = (x: number, z: number) => {
    if (Math.hypot(x - hx, z - hz) < tw * 0.6) return seatY;
    if (Math.abs(z - tz) < 0.3 * kz && x > -0.6 * kx && x < 0.2 * kx) return tY + 0.26 * k;
    if (Math.abs(x) < 0.8 * kx && Math.abs(z) < 1.3 * kz) return tY;
    return Math.abs(x) <= kx && Math.abs(z) <= 1.5 * kz ? ya + 0.1 * k : -1;
  };
  return {
    deckAt: deck, top: seatY + 0.1 * k, custom: true, dressed: true,
    seat: (m) => {
      if (m === hero) { collar(b, kit, m.x, seatY, m.z, m.r, seatY - 0.06 * k, 16); return { y: seatY, socket: true }; }
      return { y: ringSeat(b, kit, m, Math.max(ya + 0.1 * k, deck(m.x, m.z)), 0.03 * k, 14), socket: true };
    },
  };
}

registerChassis('riot', riot);

// =====================================================================================================================
// SIEGEPLAT: siege spire (gun tower on a girder keel, magazine counterweight, four splayed jack legs)
// =====================================================================================================================
function siegeplat(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, S, stance } = c;
  const kx = L / 4, kz = W / 1.7; // authored at L = 4, W = 1.7
  const k = Math.min(kx, kz) * (0.9 + 0.035 * S);
  const fine = fineFor(S);
  const y0 = stance.y0;
  const ya = Math.max(stance.yt, y0 + 0.22 * k);
  const wi = Math.min(stance.wi, 0.5 * kz);
  const hero = biggest(c.mounts);
  const hx = hero?.x ?? 0.8 * kx, R = hero?.r ?? 0.68 * k;
  const gs = hx >= -0.05 ? 1 : -1; // tower end (+1 front)
  const seatY = ya + 1.35 * k;
  // ---- keel: a narrow dark girder spine recessed between the bogies, sloped armour skirts leaning in over it
  block(b, kit.mech, 0, y0, 0, 3.7 * kx, 2 * wi * 0.85, ya - y0 + 0.1 * k, { top: [0.97, 0.9], ch: 0.1 * k, bev: 0.025 * k, bot: 0.05 * k });
  both((s) => block(b, kit.armor2, -gs * 0.2 * kx, ya - 0.12 * k, s * 0.36 * kz, 2.6 * kx, 0.22 * kz, 0.26 * k, { top: [0.94, 0.5], shift: [0, -s * 0.06 * kz], ch: 0.06 * k, bev: 0.02 * k }));
  // ---- the gun tower: slewing drum, two tall layered pylons, a glowing coil column between them, big lift rams
  const tx = hx;
  b.lathe(kit.armor2, [[0, 0], [R * 0.95, 0], [R * 0.95, 0.08 * k], [R * 0.86, 0.14 * k], [0, 0.14 * k]], [tx, ya + 0.08 * k, 0], 'y', 16);
  const pz = R * 0.46, pH = seatY - ya - 0.32 * k, pB = ya + 0.2 * k;
  both((s) => {
    // pylon: dark inner core, team armour slab tapering up and leaning back, bone cheek plate on its outer face
    block(b, kit.mech, tx, pB, s * pz, R * 1.15, 0.2 * k, pH + 0.14 * k, { top: [0.62, 0.9], shift: [-gs * 0.06 * kx, 0], ch: 0.06 * k, bev: 0.02 * k });
    block(b, kit.armor, tx + gs * 0.02 * kx, pB - 0.02 * k, s * (pz + 0.09 * k), R * 1.3, 0.12 * k, pH * 0.92, { top: [0.5, 0.85], shift: [-gs * 0.1 * kx, 0], ch: 0.05 * k, bev: 0.02 * k });
    block(b, kit.shell, tx - gs * 0.04 * kx, pB + pH * 0.3, s * (pz + 0.16 * k), R * 0.8, 0.06 * k, pH * 0.5, { top: [0.62, 0.8], shift: [-gs * 0.06 * kx, 0], ch: 0.04 * k, bev: 0.015 * k });
    pbox(b, kit.glow, 0.03 * k, pH * 0.42, 0.03 * k, tx + gs * R * 0.28, pB + pH * 0.4, s * (pz + 0.16 * k), [0, 0, -gs * 0.28]);
    // lift ram: from the deck behind the tower up to the cradle
    piston(b, kit, [tx - gs * R * 1.15, ya + 0.12 * k, s * (pz + 0.2 * k)], [tx - gs * R * 0.35, seatY - 0.2 * k, s * (pz + 0.1 * k)], 0.06 * k, 0.5, fine);
  });
  glowCore(b, kit, [tx, pB + pH * 0.48, 0], R * 0.3, pH * 0.82, 'y', 6);
  // cradle under the collar: a stepped octagonal plate stack bridging the pylon tops
  b.lathe(kit.armor2, [[0, 0], [R * 0.8, 0], [R * 0.9, 0.06 * k], [R * 0.9, 0.12 * k], [0, 0.12 * k]], [tx, seatY - 0.2 * k, 0], 'y', 8);
  b.lathe(kit.armor, [[0, 0], [R * 0.84, 0], [R * 0.78, 0.08 * k], [0, 0.08 * k]], [tx, seatY - 0.08 * k, 0], 'y', 8);
  // prow: a layered armour wedge climbing from the bow up the tower's face (dark base, team mass, bone brow)
  block(b, kit.armor2, tx + gs * R * 1.0, y0 + 0.02 * k, 0, 0.75 * kx, 0.95 * kz, ya - y0 + 0.2 * k, { top: [0.5, 0.86], shift: [-gs * 0.14 * kx, 0], ch: 0.1 * k, bev: 0.03 * k });
  block(b, kit.armor, tx + gs * R * 0.78, ya + 0.12 * k, 0, 0.6 * kx, 0.8 * kz, pH * 0.5, { top: [0.3, 0.86], shift: [-gs * 0.16 * kx, 0], ch: 0.08 * k, bev: 0.03 * k });
  // sensor head on the tower front: dark visor with a glowing slit
  block(b, kit.mech, tx + gs * R * 0.62, pB + pH * 0.62, 0, 0.22 * k, 0.32 * k, 0.16 * k, { top: [0.6, 0.8], shift: [gs * 0.03 * k, 0], ch: 0.04 * k });
  pbox(b, kit.glow, 0.03 * k, 0.04 * k, 0.24 * k, tx + gs * (R * 0.62 + 0.1 * k), pB + pH * 0.62 + 0.1 * k, 0);
  // ---- magazine at the other end: armoured housing, a revolving shell drum glowing through its cut-outs
  const mx = -gs * 1.3 * kx, ml = 1.05 * kx, mH = 0.72 * k;
  block(b, kit.mech, mx, ya + 0.04 * k, 0, ml, 0.9 * kz, mH, { top: [0.9, 0.9], ch: 0.1 * k, bev: 0.03 * k });
  glowCore(b, kit, [mx + gs * 0.05 * kx, ya + mH * 0.62, 0], 0.22 * k, 1.2 * kz, 'z', 8, kit.hot);
  // armour hood over the drum: team shell with a bone ridge, open at the sides (the drum shows)
  block(b, kit.armor, mx - gs * 0.05 * kx, ya + mH * 0.85, 0, ml * 0.9, 0.8 * kz, 0.2 * k, { top: [0.8, 0.7], ch: 0.1 * k, bev: 0.035 * k });
  block(b, kit.shell, mx - gs * 0.1 * kx, ya + mH * 0.85 + 0.18 * k, 0, ml * 0.55, 0.36 * kz, 0.08 * k, { top: [0.8, 0.7], ch: 0.06 * k, bev: 0.02 * k });
  block(b, kit.armor2, mx - gs * ml * 0.45, ya - 0.02 * k, 0, 0.2 * kx, 1.02 * kz, mH * 0.75, { top: [0.5, 0.9], shift: [gs * 0.05 * kx, 0], ch: 0.06 * k, bev: 0.02 * k });
  // the spine: a massive armoured feed boom climbing from the magazine up the tower's back into the cradle (dark core,
  // team armour plates in two runs with a gap, bone ridge caps, a glowing feed channel along its top)
  const f0: V3 = [mx + gs * ml * 0.2, ya + mH * 0.55, 0], f2: V3 = [tx - gs * R * 0.55, seatY - 0.22 * k, 0];
  const f1: V3 = [f0[0] + (f2[0] - f0[0]) * 0.5, f0[1] + (f2[1] - f0[1]) * 0.42, 0];
  beam(b, kit.mech, f0, f2, 0.34 * k, 0.3 * k);
  for (const [a0, a1, mat] of [[0.08, 0.48, kit.armor], [0.54, 0.92, kit.shell]] as [number, number, MatLike][]) {
    const p0: V3 = [f0[0] + (f2[0] - f0[0]) * a0, f0[1] + (f2[1] - f0[1]) * a0 + 0.13 * k, 0];
    const p1: V3 = [f0[0] + (f2[0] - f0[0]) * a1, f0[1] + (f2[1] - f0[1]) * a1 + 0.13 * k, 0];
    both((s) => beam(b, mat, [p0[0], p0[1], s * 0.13 * k], [p1[0], p1[1], s * 0.13 * k], 0.2 * k, 0.12 * k, [0, 1, s * 0.6]));
  }
  // the body under the boom: a hunched armoured mass rising from the keel into the boom (dark core, team flank plates
  // stepping up toward the tower, bone plates, glow strip), so magazine, body, boom and tower read as one climbing mass
  {
    const xa = mx + gs * ml * 0.5, xb = tx - gs * R * 0.92, xc = (xa + xb) / 2, bl = Math.abs(xb - xa) + 0.1 * kx;
    const at = (x: number) => f0[1] + ((f2[1] - f0[1]) * (x - f0[0])) / (f2[0] - f0[0]);
    const hA = at(xc) - ya;
    block(b, kit.mech, xc, ya - 0.04 * k, 0, bl, 0.62 * kz, hA, { top: [0.9, 0.7], ch: 0.1 * k, bev: 0.03 * k });
    both((s) => {
      block(b, kit.armor, xc + gs * 0.04 * kx, ya + 0.02 * k, s * 0.33 * kz, bl * 0.95, 0.16 * kz, hA * 0.82, { top: [0.8, 0.6], shift: [gs * 0.08 * kx, -s * 0.03 * kz], ch: 0.05 * k, bev: 0.02 * k });
      block(b, kit.shell, xc + gs * 0.1 * kx, ya + hA * 0.35, s * 0.42 * kz, bl * 0.5, 0.06 * kz, hA * 0.4, { top: [0.7, 0.8], shift: [gs * 0.05 * kx, 0], ch: 0.03 * k, bev: 0.012 * k });
      pbox(b, kit.glow, bl * 0.6, 0.04 * k, 0.03 * k, xc, ya + hA * 0.25, s * 0.42 * kz);
    });
  }
  beam(b, kit.plasma, [f0[0], f0[1] + 0.17 * k, 0], [f2[0], f2[1] + 0.17 * k, 0], 0.07 * k, 0.05 * k);
  void f1;
  // ---- four splayed jack legs: armoured upper leg out from the keel to a knee drum, a jack down to a broad pad
  const g = grounded(c);
  for (const fx of [1, -1]) both((s) => {
    const hip: V3 = [fx * 1.25 * kx, ya + 0.02 * k, s * 0.42 * kz];
    const knee: V3 = g ? [fx * 1.62 * kx, ya + 0.28 * k, s * 1.05 * kz] : [fx * 1.45 * kx, ya + 0.26 * k, s * 0.72 * kz];
    const foot: V3 = g ? [fx * 1.95 * kx, 0, s * 1.3 * kz] : [fx * 1.62 * kx, ya - 0.05 * k, s * 0.86 * kz];
    jointDrum(b, kit, hip, 0.1 * k, 0.16 * k, 'x');
    beam(b, kit.mech, hip, knee, 0.13 * k, 0.11 * k);
    beam(b, fx === gs ? kit.armor : kit.shell, [hip[0], hip[1] + 0.08 * k, hip[2]], [knee[0], knee[1] + 0.07 * k, knee[2]], 0.19 * k, 0.07 * k);
    b.cylb(kit.joint, 0.085 * k, 0.16 * k, 0.015 * k, [knee[0], knee[1], knee[2] - 0.08 * k], 'z', 10);
    b.strut(kit.armor2, knee, [foot[0], foot[1] + 0.12 * k, foot[2]], 0.06 * k, 0.055 * k, 8);
    b.lathe(kit.mech, [[0, 0], [0.17 * k, 0], [0.17 * k, 0.03 * k], [0.12 * k, 0.07 * k], [0, 0.07 * k]], foot, 'y', 8);
    piston(b, kit, [hip[0] - fx * 0.1 * kx, hip[1] - 0.05 * k, s * 0.3 * kz], [knee[0] - fx * 0.05 * kx, knee[1] - 0.12 * k, knee[2] - s * 0.05 * kz], 0.028 * k, 0.5, fine);
  });
  // tail lights on the magazine end
  both((s) => pbox(b, kit.lamp, 0.03 * k, 0.04 * k, 0.12 * k, mx - gs * (ml * 0.55 + 0.02 * k), ya + 0.2 * k, s * 0.35 * kz));
  if (fine) cableBundle(b, kit, [mx + gs * ml * 0.4, ya + 0.15 * k, 0.3 * kz], [tx - gs * R * 0.5, pB + 0.1 * k, pz + 0.2 * k], 0.022 * k, [0, 1, 0], 2, 0.08);
  if (stance.legs) {
    const t = stance.thick;
    block(b, kit.mech, 0, stance.hipY - t * 0.9, 0, L * 0.6, W * 0.5, y0 - stance.hipY + t * 0.95, { top: [1.06, 1.08], ch: t * 0.5, bev: t * 0.12 });
  }
  const deck = (x: number, z: number) => {
    if (Math.abs(x - tx) < R * 0.55 && Math.abs(z) < R * 0.55) return seatY;
    if (Math.abs(x - mx) < ml / 2 && Math.abs(z) < 0.4 * kz) return ya + mH * 0.85 + 0.2 * k;
    return Math.abs(x) <= 1.9 * kx && Math.abs(z) <= 0.7 * kz ? ya + 0.12 * k : -1;
  };
  return {
    deckAt: deck, top: seatY + 0.1 * k, custom: true, dressed: true,
    seat: (m) => {
      if (m === hero) { collar(b, kit, m.x, seatY, m.z, m.r, seatY - 0.06 * k, 16); return { y: seatY, socket: true }; }
      return { y: ringSeat(b, kit, m, Math.max(ya + 0.12 * k, deck(m.x, m.z)), 0.03 * k, 14), socket: true };
    },
  };
}

registerChassis('siegeplat', siegeplat);

// =====================================================================================================================
// GOLIATH: warhulk (hunched titan torso on the corner track pods: chest gun, shoulder guns, knuckle arms, reactor hump)
// =====================================================================================================================
function goliath(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, S, stance } = c;
  const kx = L / 4.8, kz = W / 4, k = Math.min(kx, kz);
  const fine = fineFor(S);
  const legged = stance.legs !== null;
  const y0 = stance.y0;
  const ya = legged ? y0 + 0.3 * k : Math.max(stance.yt, y0 + 0.4 * k); // the torso starts at the pod tops
  const wi = Math.min(stance.wi, 1.1 * kz);
  const hero = biggest(c.mounts);
  const hx = hero?.x ?? 0.72 * kx, R = hero?.r ?? 1.5 * k;
  const chestTop = ya + 1.45 * k, seatY = chestTop + 0.06 * k;
  const shY = ya + 1.95 * k; // shoulder gun seats (above the chest: the flank guns ride high, Fortress / Vulcan style)
  const flank = c.mounts.find((m) => m !== hero && Math.abs(m.z) > 0.9 * kz);
  const shX = flank?.x ?? -0.77 * kx, shZ = flank ? Math.abs(flank.z) : 1.48 * kz;
  const humpX = -1.63 * kx, humpY = ya + 1.2 * k;
  // ---- pelvis: dark girder block between the pods, a pelvis armour belt over it
  block(b, kit.mech, -0.05 * kx, y0, 0, 4.0 * kx, 2 * wi * 0.95, ya - y0 + 0.12 * k, { top: [0.96, 0.95], ch: 0.15 * k, bev: 0.04 * k, bot: 0.06 * k });
  block(b, kit.armor2, 0.1 * kx, ya - 0.06 * k, 0, 2.2 * kx, 2.3 * kz, 0.22 * k, { top: [0.94, 0.9], ch: 0.18 * k, bev: 0.05 * k });
  // ---- waist: narrow dark core with a glowing reactor drum across it, visible in the deep gap under the chest
  block(b, kit.mech, -0.2 * kx, ya + 0.1 * k, 0, 1.7 * kx, 1.5 * kz, 0.62 * k, { top: [0.9, 0.9], ch: 0.2 * k, bev: 0.04 * k });
  glowCore(b, kit, [-0.15 * kx, ya + 0.42 * k, 0], 0.26 * k, 2.1 * kz, 'z', 8);
  // ---- chest: tall layered torso (dark core, team chest shell, bone breastplates stepping up to the gun cradle)
  const cx0 = -1.25 * kx, cx1 = 1.45 * kx, cl = cx1 - cx0, ccx = (cx0 + cx1) / 2;
  block(b, kit.mech, ccx, ya + 0.6 * k, 0, cl * 0.92, 2.1 * kz, chestTop - ya - 0.6 * k, { top: [0.86, 0.8], ch: 0.25 * k, bev: 0.05 * k });
  // team chest shell: sloped sides, a forward lean (the hunch)
  block(b, kit.armor, ccx + 0.05 * kx, ya + 0.72 * k, 0, cl, 2.3 * kz, chestTop - ya - 0.8 * k, { top: [0.82, 0.74], shift: [0.08 * kx, 0], ch: 0.3 * k, bev: 0.06 * k, mid: [[0.5, 1.02, 1.04]] });
  // breastplates: two bone plates on the chest front, a dark lower plate, a glowing visor band between them (the face
  // under the gun)
  both((s) => block(b, kit.shell, cx1 - 0.16 * kx, ya + 0.82 * k, s * 0.52 * kz, 0.46 * kx, 0.9 * kz, 0.55 * k, { top: [0.4, 0.86], shift: [-0.12 * kx, -s * 0.04 * kz], ch: 0.1 * k, bev: 0.035 * k }));
  block(b, kit.armor2, cx1 + 0.02 * kx, ya + 0.1 * k, 0, 0.55 * kx, 1.7 * kz, 0.72 * k, { top: [0.5, 0.92], shift: [-0.14 * kx, 0], ch: 0.12 * k, bev: 0.035 * k });
  pbox(b, kit.glow, 0.07 * k, 0.09 * k, 1.1 * kz, cx1 + 0.04 * kx, ya + 0.86 * k, 0);
  both((s) => pbox(b, kit.glow, 0.07 * k, 0.08 * k, 0.26 * kz, cx1 - 0.02 * kx, ya + 0.92 * k, s * 0.72 * kz, [s * 0.3, 0, 0]));
  // gun cradle on the chest: a stepped octagonal ring stack under the collar (narrower than the turret)
  b.lathe(kit.armor2, [[0, 0], [R * 0.7, 0], [R * 0.72, 0.08 * k], [R * 0.66, 0.12 * k], [0, 0.12 * k]], [hx, chestTop - 0.08 * k, 0], 'y', 16);
  // ---- shoulders: two towering layered masses down the flanks (Vulcan-like), standing over the gap between the front
  // and rear pods, carrying the flank guns on top; joint drums into the chest, a forearm ram block knuckling forward
  // onto the front pod
  both((s) => {
    const z = s * shZ, sl = 1.55 * kx;
    jointDrum(b, kit, [shX + 0.1 * kx, chestTop - 0.35 * k, s * 1.05 * kz], 0.32 * k, 0.42 * k, 'z');
    // dark core column from the pod line up to the gun
    block(b, kit.mech, shX, ya - 0.2 * k, z, sl * 0.8, 0.8 * kz, shY - ya + 0.1 * k, { top: [0.86, 0.86], ch: 0.18 * k, bev: 0.04 * k });
    // lower skirt (dark team), main mass (team, flaring out then tucking in under the gun), bone upper plates
    block(b, kit.armor2, shX, ya - 0.3 * k, z + s * 0.04 * kz, sl, 0.92 * kz, 0.62 * k, { top: [1.04, 1.06], ch: 0.16 * k, bev: 0.04 * k });
    block(b, kit.armor, shX + 0.04 * kx, ya + 0.38 * k, z + s * 0.05 * kz, sl * 0.98, 0.98 * kz, shY - ya - 0.62 * k, { top: [0.8, 0.72], mid: [[0.35, 1.04, 1.04]], shift: [0, -s * 0.06 * kz], ch: 0.2 * k, bev: 0.05 * k });
    block(b, kit.shell, shX + 0.1 * kx, ya + 0.62 * k, z + s * 0.47 * kz, sl * 0.62, 0.1 * kz, shY - ya - 1.0 * k, { top: [0.8, 0.6], shift: [0, -s * 0.06 * kz], ch: 0.05 * k, bev: 0.02 * k });
    block(b, kit.shell, shX - 0.05 * kx, shY - 0.26 * k, z - s * 0.02 * kz, sl * 0.6, 0.6 * kz, 0.12 * k, { top: [0.85, 0.8], ch: 0.1 * k, bev: 0.03 * k });
    pbox(b, kit.glow, sl * 0.5, 0.08 * k, 0.06 * k, shX + 0.1 * kx, ya + 0.46 * k, z + s * 0.53 * kz);
    // forearm: a big layered ram block from the shoulder's front sloping down onto the front pod
    const a: V3 = [shX + sl * 0.45, ya + 0.75 * k, z], f: V3 = [1.6 * kx, ya + 0.1 * k, s * 1.55 * kz];
    const len = Math.hypot(f[0] - a[0], f[1] - a[1]), pitch = Math.atan2(f[1] - a[1], f[0] - a[0]);
    const M = new THREE.Matrix4().makeTranslation((a[0] + f[0]) / 2, (a[1] + f[1]) / 2, (a[2] + f[2]) / 2).multiply(new THREE.Matrix4().makeRotationZ(pitch));
    mblock(b, kit.mech, M.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.2 * k, 0)), len, 0.4 * kz, 0.36 * k, { ch: 0.1 * k, bev: 0.03 * k });
    mblock(b, kit.armor, M.clone().multiply(new THREE.Matrix4().makeTranslation(-0.05 * kx, 0.08 * k, 0)), len * 0.8, 0.56 * kz, 0.2 * k, { top: [0.9, 0.75], ch: 0.12 * k, bev: 0.04 * k });
    mblock(b, kit.shell, new THREE.Matrix4().makeTranslation(f[0] + 0.05 * kx, f[1] - 0.12 * k, f[2]), 0.5 * kx, 0.62 * kz, 0.36 * k, { top: [0.5, 0.82], shift: [-0.1 * kx, 0], ch: 0.1 * k, bev: 0.035 * k });
    piston(b, kit, [shX + 0.1 * kx, ya + 0.35 * k, s * (shZ - 0.4 * kz)], [a[0] + len * 0.55, ya + 0.32 * k, s * (shZ - 0.32 * kz)], 0.06 * k, 0.5, fine);
  });
  // ---- reactor hump at the back carrying the rear gun: twin glowing cores in cut-outs, exhaust stacks
  block(b, kit.mech, humpX, ya - 0.1 * k, 0, 1.15 * kx, 1.35 * kz, humpY - ya + 0.1 * k, { top: [0.8, 0.8], ch: 0.22 * k, bev: 0.04 * k });
  block(b, kit.armor, humpX + 0.08 * kx, humpY - 0.36 * k, 0, 1.0 * kx, 1.05 * kz, 0.36 * k, { top: [0.82, 0.8], ch: 0.18 * k, bev: 0.05 * k });
  both((s) => {
    glowCore(b, kit, [humpX - 0.1 * kx, ya + 0.6 * k, s * 0.66 * kz], 0.24 * k, 0.8 * k, 'y', 6);
    b.cylb(kit.mech, 0.09 * k, 1.0 * k, 0.02 * k, [humpX - 0.5 * kx, ya + 0.3 * k, s * 0.3 * kz], 'y', 10);
    b.cyl(kit.hot, 0.06 * k, 0.06 * k, 0.02 * k, [humpX - 0.5 * kx, ya + 1.305 * k, s * 0.3 * kz], 'y', 10);
  });
  if (fine) both((s) => cableBundle(b, kit, [humpX + 0.4 * kx, humpY - 0.2 * k, s * 0.5 * kz], [shX - 0.3 * kx, shY - 0.3 * k, s * 1.2 * kz], 0.04 * k, [0, 1, 0], 2, 0.1));
  let hips: Hip[] | undefined;
  if (stance.legs === 'biped') {
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.2 * kx, stance.hipY, s * 1.15 * kz] as V3, side: s, t: stance.thick, foot: [-0.2 * kx, 0, s * 1.35 * kz] as V3, phase: s > 0 ? Math.PI : 0 }));
    both((s) => b.cylb(kit.mech, stance.thick * 1.4, 0.5 * kz, 0.05, [-0.2 * kx, stance.hipY, s * 0.95 * kz - 0.25 * kz], 'z', 12));
  }
  const deck = (x: number, z: number) => {
    const az = Math.abs(z);
    if (Math.hypot(x - shX, az - shZ) < 0.45 * kz) return shY;
    if (Math.abs(x - humpX) < 0.5 * kx && az < 0.5 * kz) return humpY;
    if (x > cx0 && x < cx1 && az < 1.0 * kz) return chestTop;
    return Math.abs(x) <= 2.4 * kx && az <= 2 * kz ? ya + 0.16 * k : -1;
  };
  return {
    deckAt: deck, top: shY + 0.1 * k, custom: true, dressed: true, hips,
    seat: (m: MountSpec) => {
      if (m === hero) { collar(b, kit, m.x, seatY, m.z, m.r, chestTop - 0.1 * k, 20); return { y: seatY, socket: true }; }
      if (Math.abs(m.z) > 0.9 * kz) { collar(b, kit, m.x, shY, m.z, m.r, shY - 0.12 * k, 16); return { y: shY, socket: true }; }
      if (m.x < -1.2 * kx) { collar(b, kit, m.x, humpY, m.z, m.r, humpY - 0.1 * k, 16); return { y: humpY, socket: true }; }
      return { y: ringSeat(b, kit, m, Math.max(ya, deck(m.x, m.z)), 0.04 * k, 14), socket: true };
    },
  };
}

registerChassis('goliath', goliath);
