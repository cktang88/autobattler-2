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
import { registerChassis, type ChassisCtx, type ChassisOut, type MountSpec } from './registry.ts';
import { beam, block, both, collar, type BlockOpts } from './shapes.ts';
import { cableBundle, fineFor, jointDrum, piston } from './hs-kit.ts';
import { ringSeat } from './hs-kit-vehicles.ts';
import type { Bld } from '../geo.ts';

const biggest = (ms: MountSpec[]) => ms.reduce<MountSpec | undefined>((a, m) => (!a || m.r > a.r ? m : a), undefined);

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
