// Vertical mech-bodied light / medium frames: tall layered torsos built round the weapon system they carry, instead of
// flat hulls with a turret on the deck. The hero weapon (units3d scales it to ~0.8 x the hull width and hangs the
// secondaries on its flanks as pods) is the head / upper body; these hulls are what lifts it up and what sticks out
// round it: a stacked waist, shoulders, reactor packs, haunches. Chunky separate blocks with deep dark gaps, light
// shell / team armour / near-black mechanics alternating, glowing cores seen through cut-outs.
//   raider  (box)    "Jackal" hunched assault torso: barrel chest on a glowing waist core, big layered pauldrons, a
//                    sensor head in the chest notch, twin reactor drums on the back; pelvis + hip drums on legs, a dark
//                    drive block on wheels / tracks / hover
//   aegis   (round)  "Field medic" bell tower: a round armoured skirt over the running gear, a stacked rotunda (base
//                    drum, glowing nanite core band in a ribbed cage, bone drum) lifting the gun high, two big nanite
//                    canisters with glowing windows slung over the tracks, rounded nose bumper with the medic cross,
//                    raised service bay for the repair rig at the back, twin sensor masts
//   hunter  (hunter) "Stalker" raptor carrier: low pointed nose, the gun raised on a forward chest pylon, a tall hunched
//                    back rising behind it (layered plates over a glowing spine core), big armoured haunch drums over
//                    the rear axle
// Registered by chassis id (looked up before the shape), so the older flat builders in light.ts no longer draw them.

import * as THREE from 'three';
import { mtx, type MatLike, type V3 } from '../geo.ts';
import type { Bld } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar } from './shapes.ts';
import { frustum, ngon } from './tanks-kit.ts';
import { antenna, armorPlate, fineFor, frame, jointDrum, piston, rectP } from './hs-kit.ts';
import { facePlate, frustumPlates, ringSeat } from './hs-kit-vehicles.ts';

const XA: V3 = [1, 0, 0], ZA: V3 = [0, 0, 1];
/** plain box for small parts (12 tris) */
const pbox = (b: Bld, mat: MatLike, w: number, h: number, d: number, x: number, y: number, z: number, rot?: V3) => b.g(new THREE.BoxGeometry(w, h, d), mat, mtx([x, y, z], rot));
const heroOf = (ms: MountSpec[]) => ms.filter((m) => m.mod.kind === 'weapon').reduce<MountSpec | undefined>((a, m) => (!a || m.r > a.r ? m : a), undefined) ?? ms[0];

/** glowing core seen through a ribbed dark cage (vertical): emissive drum, n dark ribs round it, dark rims */
function coreCage(b: Bld, kit: Kit, x: number, y: number, z: number, r: number, h: number, n: number, mat: MatLike = kit.plasma): void {
  b.cyl(mat, r * 0.84, r * 0.84, h, [x, y, z], 'y', Math.max(8, n));
  const tw = ((Math.PI * 2 * r) / n) * 0.5;
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    b.g(new THREE.BoxGeometry(r * 0.32, h, tw), kit.mech, new THREE.Matrix4().makeRotationY(-a).setPosition(x + Math.cos(a) * r * 0.9, y + h / 2, z + Math.sin(a) * r * 0.9));
  }
  for (const yy of [y, y + h - 0.012 * r * 10]) b.cylb(kit.mech, r * 1.04, Math.max(0.01, r * 0.12), r * 0.04, [x, yy - r * 0.02, z], 'y', Math.max(8, n));
}

/** round turret plinth (light shell drum, chamfered top) from y0 to y1, radius r */
function plinth(b: Bld, mat: MatLike, x: number, y0: number, y1: number, z: number, r: number, seg = 14): void {
  const h = y1 - y0, c = Math.min(h * 0.4, r * 0.08);
  b.lathe(mat, [[0, 0], [r * 1.02, 0], [r * 1.02, c], [r, h - c], [r - c, h], [0, h]], [x, y0, z], 'y', seg);
}

// ---- raider: hunched assault torso ------------------------------------------------------------------------------------
function raider(c: ChassisCtx): ChassisOut {
  const { b, kit, stance, L, W } = c;
  const k = Math.min(L, W); // authored at 1 x 1
  const legs = !!stance.legs;
  const y0 = stance.y0;
  const hero = heroOf(c.mounts);
  const hx = hero?.x ?? 0.06 * k, hz = hero?.z ?? 0, R = hero?.r ?? 0.35 * k;
  // torso root: on legs the pelvis sits between the hips, otherwise the torso rides a dark drive block
  const B = legs ? stance.hipY + 0.02 * k : Math.max(stance.yt, y0 + 0.1 * k);
  const chestY = B + 0.13 * k, chestT = B + 0.32 * k, seatY = B + 0.39 * k;
  // ---- lower body
  let hips: Hip[] | undefined;
  if (legs) {
    const t = stance.thick, hy = stance.hipY;
    // pelvis: dark block between the hips, armoured crotch plate in front, hip drums the legs hang from
    block(b, kit.mech, -0.04 * k, hy - t * 0.9, 0, 0.32 * k, 0.36 * k, B + 0.04 * k - (hy - t * 0.9), { top: [0.9, 1.05], ch: 0.06 * k, bev: 0.015 * k });
    block(b, kit.armor2, 0.13 * k, hy - t * 1.15, 0, 0.12 * k, 0.17 * k, t * 1.25, { top: [0.6, 0.85], shift: [0.025 * k, 0], ch: 0.04 * k, bev: 0.012 * k, bot: 0.01 * k });
    pbox(b, kit.glow, 0.012 * k, 0.05 * k, 0.04 * k, 0.17 * k, hy - t * 0.45, 0);
    both((s) => {
      jointDrum(b, kit, [-0.04 * k, hy, s * 0.2 * k], t * 0.72, 0.07 * k, 'z');
      // hip guard: team plate hanging over the thigh, light cap on top
      block(b, kit.armor, -0.03 * k, hy - t * 0.7, s * 0.345 * k, 0.24 * k, 0.05 * k, t * 1.6, { top: [0.86, 0.9], shift: [0, -s * 0.012 * k], ch: 0.02 * k, bev: 0.01 * k });
      block(b, kit.shell, -0.03 * k, hy + t * 0.85, s * 0.33 * k, 0.2 * k, 0.08 * k, 0.03 * k, { top: [0.8, 0.8], ch: 0.02 * k, bev: 0.008 * k });
    });
    hips = ([-1, 1] as const).map((side) => ({ p: [-0.04 * k, hy, side * 0.27 * k] as V3, side, t, foot: [-0.02 * k, 0, side * 0.31 * k] as V3, phase: side > 0 ? Math.PI : 0 }));
  } else {
    const wi = Math.min(stance.wi, 0.42 * k);
    block(b, kit.mech, -0.02 * k, y0, 0, 0.84 * k, wi * 2, B + 0.06 * k - y0, { top: [0.94, 0.96], ch: 0.08 * k, bev: 0.015 * k, bot: 0.015 * k });
    // nose ram: low team wedge, lamp slit
    block(b, kit.armor2, 0.36 * k, y0 + 0.01 * k, 0, 0.18 * k, wi * 1.7, B - y0 + 0.02 * k, { top: [0.45, 0.85], shift: [-0.04 * k, 0], ch: 0.05 * k, bev: 0.012 * k });
    pbox(b, kit.lamp, 0.012 * k, 0.018 * k, wi * 0.9, 0.45 * k, y0 + (B - y0) * 0.45, 0);
  }
  // ---- waist: glowing core in a ribbed cage between pelvis / drive block and chest
  coreCage(b, kit, -0.03 * k, B, 0, 0.15 * k, 0.15 * k, 8);
  // ---- chest: barrel-chested team block, bone collar under the gun
  block(b, kit.armor, -0.01 * k, chestY, 0, 0.6 * k, 0.56 * k, chestT - chestY, { top: [0.8, 0.8], shift: [0.03 * k, 0], ch: 0.1 * k, bev: 0.03 * k, bot: 0.025 * k, mid: [[0.45, 1.05, 1.06]] });
  // chest front: two layered bone plates either side of a notch, the sensor head sits in the notch
  both((s) => {
    const p0: V3 = [0.31 * k, chestY + 0.02 * k, s * 0.13 * k], p1: V3 = [0.27 * k, chestT - 0.015 * k, s * 0.115 * k];
    const F = facePlate(b, kit, kit.shell, p0, p1, ZA, 0.18 * k, 0.022 * k, XA, { standoff: 0.006 * k, gap: 0.01 * k, fill: 0.92 });
    armorPlate(b, kit, kit.armor, F.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.03 * k, -0.02 * k)), rectP(0.11 * k, 0.1 * k, 0.025 * k), 0.016 * k, { standoff: 0.004 * k, gap: 0.006 * k });
  });
  block(b, kit.mech, 0.3 * k, chestY + 0.01 * k, 0, 0.06 * k, 0.07 * k, chestT - chestY - 0.02 * k, { ch: 0.015 * k, bev: 0.006 * k });
  // sensor head: dark visor block with a wide lamp, jutting out of the notch under the gun
  block(b, kit.armor2, 0.37 * k, chestY + 0.035 * k, 0, 0.13 * k, 0.15 * k, 0.085 * k, { top: [0.7, 0.8], shift: [0.015 * k, 0], ch: 0.035 * k, bev: 0.012 * k });
  pbox(b, kit.lamp, 0.016 * k, 0.022 * k, 0.1 * k, 0.43 * k, chestY + 0.08 * k, 0);
  // ---- shoulders: big layered pauldrons (team block, bone cap, glow strip), dark shoulder drum in the gap
  both((s) => {
    const zc = s * 0.34 * k;
    b.cylb(kit.joint, 0.075 * k, 0.1 * k, 0.012 * k, [0.0, chestY + 0.1 * k, s * 0.2 * k], 'z', 8);
    block(b, kit.armor, 0.01 * k, chestY + 0.02 * k, zc, 0.42 * k, 0.19 * k, 0.16 * k, { top: [0.76, 0.66], shift: [0.01 * k, s * 0.025 * k], ch: 0.06 * k, bev: 0.025 * k, bot: 0.02 * k });
    block(b, kit.shell, 0.03 * k, chestY + 0.175 * k, zc + s * 0.01 * k, 0.3 * k, 0.12 * k, 0.035 * k, { top: [0.8, 0.75], ch: 0.04 * k, bev: 0.012 * k });
    // lower pauldron lip: dark plate stepping out under the team block
    block(b, kit.armor2, -0.01 * k, chestY - 0.03 * k, zc + s * 0.03 * k, 0.36 * k, 0.15 * k, 0.06 * k, { top: [0.95, 0.9], ch: 0.04 * k, bev: 0.012 * k });
    pbox(b, kit.glow, 0.2 * k, 0.018 * k, 0.012 * k, 0.03 * k, chestY + 0.07 * k, s * 0.44 * k);
  });
  // ---- back: twin reactor drums (team, bone band, glowing vent ring) with a dark exhaust block between
  both((s) => {
    const p: V3 = [-0.35 * k, chestY - 0.06 * k, s * 0.14 * k];
    b.cylb(kit.armor2, 0.085 * k, 0.27 * k, 0.015 * k, p, 'y', 10);
    b.cyl(kit.plasma, 0.088 * k, 0.088 * k, 0.03 * k, [p[0], p[1] + 0.07 * k, p[2]], 'y', 10);
    b.cylb(kit.shell, 0.092 * k, 0.05 * k, 0.012 * k, [p[0], p[1] + 0.16 * k, p[2]], 'y', 10);
    b.lathe(kit.mech, [[0, 0], [0.08 * k, 0], [0.05 * k, 0.03 * k], [0, 0.03 * k]], [p[0], p[1] + 0.27 * k, p[2]], 'y', 8);
  });
  block(b, kit.mech, -0.32 * k, chestY - 0.04 * k, 0, 0.12 * k, 0.16 * k, 0.2 * k, { ch: 0.03 * k, bev: 0.01 * k });
  both((s) => b.cyl(kit.hot, 0.022 * k, 0.022 * k, 0.012 * k, [-0.385 * k, chestY + 0.08 * k, s * 0.04 * k], '-x', 8));
  // ---- the gun's plinth: bone drum on the chest top (narrower than the housing), collar
  const pr = Math.min(R * 0.8, 0.34 * k);
  plinth(b, kit.shell, hx, chestT - 0.01 * k, seatY - 0.012 * k, hz, pr, 12);
  antenna(b, kit, -0.3 * k, chestT, -0.25 * k, 0.32 * k, 0.005 * k, [-0.25, 0, 0]);
  const deck = (x: number, z: number) => (Math.abs(x) <= 0.5 * k && Math.abs(z) <= 0.45 * k ? (Math.hypot(x - hx, z - hz) < pr ? seatY : chestT) : -1);
  return {
    deckAt: deck, top: seatY + 0.02 * k, custom: true, dressed: true, hips,
    seat: (m) => {
      if (m === hero) { collar(b, kit, m.x, seatY, m.z, m.r, seatY - 0.02 * k, 16); return { y: seatY, socket: true }; }
      return { y: ringSeat(b, kit, m, deck(m.x, m.z) > 0 ? deck(m.x, m.z) : chestT, 0.015 * k, 10), socket: true };
    },
  };
}

registerChassis('raider', raider);
