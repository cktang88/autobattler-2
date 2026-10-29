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
import { registerChassis, registerTorso, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
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
  // waist height: a walker's torso sits right on its pelvis; a wheeled / tracked raider stands its torso up on a taller
  // glowing waist column over the drive block (a centaur, not a turret)
  const wH = legs ? 0.08 * k : 0.2 * k;
  
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
  // ---- waist: a short glowing core in a ribbed cage, the swivel the whole upper body twists on
  coreCage(b, kit, -0.03 * k, B, 0, 0.12 * k, wH, 8);
  const seatY = B + wH;
  b.cylb(kit.joint, 0.13 * k, 0.02 * k, 0.006 * k, [-0.03 * k, seatY - 0.02 * k, 0], 'y', 12);
  const deck = (x: number, z: number) => (Math.abs(x) <= 0.4 * k && Math.abs(z) <= 0.4 * k ? seatY : -1);
  return {
    deckAt: deck, top: seatY + 0.4 * k, custom: true, dressed: true, hips,
    seat: (m) => (m === hero ? { y: seatY, socket: true } : { y: ringSeat(b, kit, m, seatY, 0.015 * k, 10), socket: true }),
    // ---- the upper body twists with the guns: a hunched predator torso leaning over its beak, the hero gun as the
    // right forearm, the second gun on the left, big swept pauldrons with blade fins, a reactor pack with exhaust horns
    torso: (t) => {
      // the upper body outweighs the legs: broad, top-heavy, shoulders wider than the stance
      const u = k * 1.3;
      // dark core and the swivel collar
      t.cylb(kit.mech, 0.11 * u, 0.05 * u, 0.012 * u, [-0.02 * u, 0, 0], 'y', 12);
      block(t, kit.mech, -0.04 * u, 0.03 * u, 0, 0.4 * u, 0.3 * u, 0.24 * u, { top: [0.82, 0.8], ch: 0.06 * u, bev: 0.015 * u });
      // carapace: a high rear hump and a lower front plate tipping down to the beak, a glowing seam between them
      block(t, kit.armor, -0.1 * u, 0.13 * u, 0, 0.32 * u, 0.42 * u, 0.17 * u, { top: [0.62, 0.66], shift: [-0.03 * u, 0], ch: 0.07 * u, bev: 0.018 * u, bot: 0.012 * u, mid: [[0.5, 0.96, 1.0]] });
      block(t, kit.shell, -0.13 * u, 0.28 * u, 0, 0.17 * u, 0.2 * u, 0.04 * u, { top: [0.7, 0.7], ch: 0.04 * u, bev: 0.01 * u });
      block(t, kit.armor, 0.13 * u, 0.06 * u, 0, 0.24 * u, 0.36 * u, 0.15 * u, { top: [0.45, 0.62], shift: [0.05 * u, 0], ch: 0.06 * u, bev: 0.016 * u, bot: 0.01 * u });
      pbox(t, kit.plasma, 0.02 * u, 0.12 * u, 0.3 * u, 0.04 * u, 0.15 * u, 0, [0, 0, 0.5]);
      // the face: a narrow dark beak low at the front, a V of hot visor slits, a chin blade under it
      block(t, kit.armor2, 0.3 * u, 0.04 * u, 0, 0.13 * u, 0.15 * u, 0.09 * u, { top: [0.35, 0.55], shift: [0.03 * u, 0], ch: 0.04 * u, bev: 0.01 * u });
      both((sd) => pbox(t, kit.hot, 0.008 * u, 0.012 * u, 0.055 * u, 0.355 * u, 0.09 * u, sd * 0.03 * u, [0, sd * 0.45, -sd * 0.35]));
      block(t, kit.shell, 0.31 * u, 0.0, 0, 0.12 * u, 0.06 * u, 0.04 * u, { top: [0.3, 0.6], shift: [0.05 * u, 0], ch: 0.02 * u, bev: 0.006 * u });
      both((sd) => {
        const zs = sd * 0.23 * u;
        // shoulder drum, pauldron (team block swept back, dark lip, bone cap) and a long blade fin raking back
        t.cylb(kit.joint, 0.07 * u, 0.08 * u, 0.012 * u, [-0.02 * u, 0.16 * u, zs], 'z', 10);
        block(t, kit.armor2, -0.04 * u, 0.08 * u, sd * 0.31 * u, 0.3 * u, 0.12 * u, 0.12 * u, { top: [0.85, 0.9], ch: 0.04 * u, bev: 0.012 * u });
        block(t, kit.armor, -0.05 * u, 0.15 * u, sd * 0.32 * u, 0.32 * u, 0.15 * u, 0.12 * u, { top: [0.55, 0.62], shift: [-0.06 * u, sd * 0.03 * u], ch: 0.05 * u, bev: 0.016 * u, bot: 0.01 * u });
        block(t, kit.shell, -0.07 * u, 0.25 * u, sd * 0.34 * u, 0.2 * u, 0.06 * u, 0.025 * u, { top: [0.4, 0.8], shift: [-0.05 * u, 0], ch: 0.02 * u, bev: 0.006 * u });
        block(t, kit.armor, -0.14 * u, 0.24 * u, sd * 0.3 * u, 0.18 * u, 0.025 * u, 0.12 * u, { top: [0.1, 0.6], shift: [-0.16 * u, sd * 0.03 * u], ch: 0.01 * u, bev: 0.005 * u });
        pbox(t, kit.glow, 0.16 * u, 0.012 * u, 0.008 * u, -0.05 * u, 0.13 * u, sd * 0.392 * u);
        // upper arm: a dark strut from the shoulder drum down to the gun's trunnion, a piston beside it
        beam(t, kit.mech, [-0.02 * u, 0.15 * u, sd * 0.3 * u], [0.04 * u, 0.0, sd * 0.42 * u], 0.07 * u, 0.06 * u);
        piston(t, kit, [-0.08 * u, 0.12 * u, sd * 0.36 * u], [0.0, 0.02 * u, sd * 0.38 * u], 0.012 * u);
      });
      // reactor pack: a dark block with two exhaust horns raking up and back, glowing vents
      block(t, kit.mech, -0.28 * u, 0.06 * u, 0, 0.12 * u, 0.22 * u, 0.2 * u, { top: [0.8, 0.85], ch: 0.03 * u, bev: 0.01 * u });
      both((sd) => {
        beam(t, kit.armor2, [-0.3 * u, 0.2 * u, sd * 0.07 * u], [-0.42 * u, 0.36 * u, sd * 0.1 * u], 0.05 * u, 0.05 * u);
        t.cyl(kit.hot, 0.02 * u, 0.02 * u, 0.01 * u, [-0.425 * u, 0.367 * u, sd * 0.1 * u], 'y', 8);
        pbox(t, kit.plasma, 0.008 * u, 0.1 * u, 0.04 * u, -0.345 * u, 0.15 * u, sd * 0.06 * u);
      });
      return { hp: [[0.06 * u, 0.0, 0.44 * u], [0.06 * u, 0.0, -0.44 * u], [-0.1 * u, 0.32 * u, 0.2 * u], [-0.1 * u, 0.32 * u, -0.2 * u]], at: [-0.03 * u, seatY, 0] };
    },
  };
}

// ---- aegis: field-medic bell tower ------------------------------------------------------------------------------------
function aegis(c: ChassisCtx): ChassisOut {
  const { b, kit, stance, L, W, S } = c;
  const u = Math.min(L, W) / 2; // authored at 2 x 2
  const fine = fineFor(S);
  const y0 = stance.y0, yt = Math.max(stance.yt, y0 + 0.12 * u);
  const legs = !!stance.legs;
  const hero = heroOf(c.mounts);
  const hx = hero?.x ?? -0.04 * u, hz = hero?.z ?? 0, R = hero?.r ?? 0.8 * u;
  const wi = Math.min(stance.wi, 0.6 * u);
  // ---- belly between the running gear (on legs a keel down to the hips)
  const bb = legs ? stance.hipY - stance.thick * 0.9 : y0;
  block(b, kit.mech, -0.02 * u, bb, 0, 1.7 * u, wi * 2, yt + 0.02 * u - bb, { top: [0.96, 0.96], ch: 0.14 * u, bev: 0.02 * u, bot: 0.02 * u });
  // ---- round armoured skirt over the running gear: dark 12-gon frustum with a team plate on every facet
  const sk = ngon(12, 0.92 * u, 0.9 * u, Math.PI / 12, -0.03 * u, 0);
  const skY = yt - 0.06 * u, skH = 0.15 * u;
  frustum(b, kit.armor2, sk, skY, skH, { top: [0.9, 0.9], bev: 0.02 * u, bot: 0.015 * u });
  frustumPlates(b, kit, kit.armor, sk, skY, skH, 0.9, 0.028 * u, { standoff: 0.01 * u, gap: 0.02 * u, widthK: 0.84, f0: 0.12, f1: 0.86, skip: (i) => i === 5 || i === 6 });
  const Y1 = skY + skH;
  // ---- rotunda lifting the gun: team base drum, glowing nanite core band in a ribbed cage, bone drum, plinth
  const r1 = Math.min(0.74 * u, R * 0.92);
  b.lathe(kit.armor, [[0, 0], [r1, 0], [r1, 0.08 * u], [r1 * 0.94, 0.12 * u], [0, 0.12 * u]], [hx, Y1 - 0.01 * u, hz], 'y', 20);
  coreCage(b, kit, hx, Y1 + 0.11 * u, hz, r1 * 0.78, 0.2 * u, 14);
  b.lathe(kit.shell, [[0, 0], [r1 * 0.86, 0], [r1 * 0.86, 0.06 * u], [r1 * 0.8, 0.1 * u], [0, 0.1 * u]], [hx, Y1 + 0.31 * u, hz], 'y', 20);
  const seatY = Y1 + 0.47 * u;
  plinth(b, kit.mech, hx, Y1 + 0.4 * u, seatY - 0.01 * u, hz, Math.min(R * 0.68, r1 * 0.7), 16);
  // ---- nanite tanks standing upright at the rear flanks (taller than the gun: the medic's silhouette), bone capsules
  // with dark bands, glowing windows down their outer faces, valve heads, clamped to the rotunda by armoured arms;
  // a low team fender runs forward from each tank over the front of the running gear
  both((s) => {
    const tx = -0.5 * u, tz = s * 0.76 * u, cr = 0.17 * u, ty = yt - 0.04 * u, H = seatY + 0.3 * u - ty;
    b.lathe(kit.shell, [[0, 0], [cr * 0.9, 0], [cr, cr * 0.3], [cr, H - cr * 1.1], [cr * 0.86, H - cr * 0.45], [cr * 0.45, H], [0, H]], [tx, ty, tz], 'y', 16);
    for (const f of [0.06, 0.42, 0.74]) b.cylb(kit.mech, cr * 1.06, 0.05 * u, 0.008 * u, [tx, ty + f * H, tz], 'y', 16);
    for (const a of [0.0, 0.7, -0.7]) {
      const ang = s * (Math.PI / 2) + a * s, wx = tx + Math.cos(ang) * cr * 0.97, wz = tz + Math.sin(ang) * cr * 0.97;
      pbox(b, kit.plasma, 0.035 * u, H * 0.26, 0.035 * u, wx, ty + H * 0.24, wz, [0, -ang, 0]);
      pbox(b, kit.plasma, 0.035 * u, H * 0.2, 0.035 * u, wx, ty + H * 0.58, wz, [0, -ang, 0]);
    }
    b.cylb(kit.joint, cr * 0.42, 0.06 * u, 0.01 * u, [tx, ty + H - 0.01 * u, tz], 'y', 10);
    b.cyl(kit.lamp, cr * 0.2, cr * 0.2, 0.012 * u, [tx, ty + H + 0.05 * u, tz], 'y', 8);
    // clamp arms to the rotunda (two heights)
    for (const yy of [Y1 + 0.04 * u, Y1 + 0.27 * u]) {
      block(b, kit.armor2, tx + 0.02 * u, yy, s * 0.5 * u, 0.14 * u, 0.36 * u, 0.07 * u, { ch: 0.03 * u, bev: 0.012 * u });
      b.cylb(kit.mech, cr * 1.1, 0.075 * u, 0.01 * u, [tx, yy - 0.003 * u, tz], 'y', 16);
    }
    // front fender over the running gear: team block, bone cap, glow strip, feed hose into the core
    block(b, kit.armor, 0.22 * u, yt - 0.04 * u, s * 0.79 * u, 0.74 * u, 0.32 * u, 0.15 * u, { top: [0.82, 0.8], shift: [-0.04 * u, -s * 0.02 * u], ch: 0.08 * u, bev: 0.025 * u, bot: 0.015 * u });
    block(b, kit.shell, 0.18 * u, yt + 0.105 * u, s * 0.78 * u, 0.42 * u, 0.2 * u, 0.03 * u, { top: [0.85, 0.8], ch: 0.05 * u, bev: 0.01 * u });
    pbox(b, kit.glow, 0.4 * u, 0.022 * u, 0.014 * u, 0.22 * u, yt + 0.04 * u, s * 0.955 * u);
    b.g(new THREE.TorusGeometry(0.12 * u, 0.024 * u, 6, 10, Math.PI / 2), kit.rubber, mtx([tx + 0.18 * u, Y1 + 0.2 * u, s * 0.62 * u], [Math.PI / 2, 0, s > 0 ? Math.PI / 2 : 0]));
  });
  // ---- rounded nose bumper with the medic cross, lamps
  const nX = 0.8 * u;
  block(b, kit.shell, nX, yt - 0.1 * u, 0, 0.3 * u, 1.0 * u, 0.2 * u, { top: [0.45, 0.82], shift: [-0.07 * u, 0], ch: 0.14 * u, bev: 0.03 * u, bot: 0.02 * u, mid: [[0.5, 1.02, 1.0]] });
  const crossF = frame([nX + 0.035 * u, yt + 0.035 * u, 0], [Math.sin(0.95), Math.cos(0.95), 0], ZA);
  b.g(new THREE.BoxGeometry(0.06 * u, 0.012 * u, 0.2 * u), kit.accent, crossF);
  b.g(new THREE.BoxGeometry(0.17 * u, 0.012 * u, 0.06 * u), kit.accent, crossF);
  both((s) => pbox(b, kit.lamp, 0.02 * u, 0.04 * u, 0.14 * u, nX + 0.12 * u, yt - 0.02 * u, s * 0.3 * u, [0, -s * 0.35, 0]));
  // ---- raised service bay at the back for the repair rig / utility, twin sensor masts at the rear corners
  const bayX = -0.78 * u, bayT = yt + 0.12 * u;
  block(b, kit.armor, bayX, yt - 0.04 * u, 0, 0.34 * u, 0.62 * u, bayT - yt + 0.04 * u, { top: [0.86, 0.9], shift: [0.02 * u, 0], ch: 0.08 * u, bev: 0.02 * u });
  block(b, kit.shell, bayX - 0.02 * u, bayT - 0.005 * u, 0, 0.22 * u, 0.5 * u, 0.03 * u, { top: [0.8, 0.9], ch: 0.05 * u, bev: 0.01 * u });
  both((s) => {
    const p: V3 = [-0.86 * u, yt - 0.02 * u, s * 0.42 * u];
    b.cylb(kit.armor2, 0.05 * u, 0.42 * u, 0.01 * u, p, 'y', 10);
    b.cyl(kit.glow, 0.053 * u, 0.053 * u, 0.025 * u, [p[0], p[1] + 0.3 * u, p[2]], 'y', 10);
    antenna(b, kit, p[0], p[1] + 0.42 * u, p[2], 0.5 * u, 0.007 * u, [-0.1, 0, s * 0.08]);
    piston(b, kit, [p[0] + 0.06 * u, yt, s * 0.3 * u], [-0.55 * u, Y1 + 0.05 * u, s * 0.3 * u], 0.02 * u, 0.55, fine);
  });
  const deck = (x: number, z: number) => {
    if (Math.hypot(x - hx, z - hz) < r1 * 0.8) return seatY;
    if (Math.abs(x - bayX) < 0.17 * u && Math.abs(z) < 0.3 * u) return bayT + 0.02 * u;
    return Math.abs(x) <= u && Math.abs(z) <= u ? Y1 : -1;
  };
  return {
    deckAt: deck, top: seatY + 0.02 * u, custom: true, dressed: true,
    seat: (m) => {
      if (m === hero) { collar(b, kit, m.x, seatY, m.z, m.r, seatY - 0.03 * u, 18); return { y: seatY, socket: true }; }
      return { y: ringSeat(b, kit, m, Math.max(0, deck(m.x, m.z)), 0.02 * u, 12), socket: true };
    },
  };
}

// ---- hunter: raptor carrier ---------------------------------------------------------------------------------------------
function hunter(c: ChassisCtx): ChassisOut {
  const { b, kit, stance, L, W } = c;
  const kx = L / 2, kz = W; // authored at L = 2, W = 1
  const k = Math.min(kx, kz);
  const legs = !!stance.legs;
  const y0 = stance.y0, yt = Math.max(stance.yt, y0 + 0.1 * k);
  const hero = heroOf(c.mounts);
  const hx = hero?.x ?? 0.24 * kx, hz = hero?.z ?? 0, R = hero?.r ?? 0.4 * k;
  const wi = Math.min(stance.wi, 0.36 * kz);
  // ---- low dark chassis between the wheels (keel to the hips on legs)
  const bb = legs ? stance.hipY - stance.thick * 0.9 : y0;
  block(b, kit.mech, -0.08 * kx, bb, 0, 1.72 * kx, wi * 2, yt + 0.03 * k - bb, { top: [0.96, 0.92], ch: 0.08 * k, bev: 0.015 * k, bot: 0.015 * k });
  // ---- pointed nose: dark wedge, team prow, bone top plate, twin lamp slits
  block(b, kit.armor2, 0.74 * kx, y0 + 0.02 * k, 0, 0.5 * kx, 0.6 * kz, yt - y0 + 0.06 * k, { top: [0.55, 0.62], shift: [-0.08 * kx, 0], ch: 0.1 * k, bev: 0.02 * k, bot: 0.02 * k });
  block(b, kit.armor, 0.7 * kx, yt + 0.04 * k, 0, 0.46 * kx, 0.4 * kz, 0.08 * k, { top: [0.35, 0.55], shift: [-0.1 * kx, 0], ch: 0.06 * k, bev: 0.02 * k });
  block(b, kit.shell, 0.66 * kx, yt + 0.115 * k, 0, 0.18 * kx, 0.2 * kz, 0.03 * k, { top: [0.6, 0.7], ch: 0.03 * k, bev: 0.008 * k });
  both((s) => pbox(b, kit.lamp, 0.03 * kx, 0.016 * k, 0.07 * kz, 0.94 * kx, yt + 0.02 * k, s * 0.1 * kz, [0, -s * 0.5, 0.35]));
  // ---- chest pylon under the gun: barrel-chested team block, bone front plates, dark ribs at the sides
  const cY = yt + 0.02 * k, cT = yt + 0.26 * k, seatY = cT + 0.06 * k;
  block(b, kit.armor, hx - 0.02 * kx, cY, hz, 0.56 * kx, 0.66 * kz, cT - cY, { top: [0.74, 0.76], shift: [0.02 * kx, 0], ch: 0.1 * k, bev: 0.03 * k, bot: 0.02 * k, mid: [[0.42, 1.05, 1.05]] });
  both((s) => {
    facePlate(b, kit, kit.shell, [hx + 0.28 * kx, cY + 0.03 * k, s * 0.12 * kz], [hx + 0.22 * kx, cT - 0.02 * k, s * 0.11 * kz], ZA, 0.17 * kz, 0.022 * k, XA, { standoff: 0.006 * k, gap: 0.01 * k, fill: 0.9 });
    // flank vents: glowing slot behind a dark louvre
    pbox(b, kit.plasma, 0.2 * kx, 0.03 * k, 0.012 * k, hx - 0.04 * kx, cY + 0.11 * k, s * 0.345 * kz);
    for (const f of [-0.06, 0.0, 0.06]) pbox(b, kit.mech, 0.025 * kx, 0.06 * k, 0.02 * k, hx - 0.04 * kx + f * kx, cY + 0.11 * k, s * 0.35 * kz);
  });
  block(b, kit.mech, hx + 0.26 * kx, cY + 0.02 * k, 0, 0.05 * kx, 0.05 * kz, cT - cY - 0.04 * k, { ch: 0.01 * k, bev: 0.005 * k });
  const pr = Math.min(R * 0.72, 0.26 * k);
  plinth(b, kit.shell, hx, cT - 0.01 * k, seatY - 0.01 * k, hz, pr, 14);
  // ---- hunched back: rises behind the gun to a tall hump, then drops to the tail. Team loft over a glowing spine
  // core in a dark channel, layered bone carapace plates stepping up the crown, dark flank plates over glowing slots
  const hb: [number, number, number][] = [[-0.06, 0.16, 0.3], [-0.3, 0.42, 0.33], [-0.56, 0.66, 0.32], [-0.78, 0.6, 0.28], [-0.92, 0.4, 0.24], [-1.0, 0.18, 0.2]];
  const ht = (x: number) => {
    const f = x / kx;
    for (let i = 0; i < hb.length - 1; i++) {
      const [a, ta] = hb[i], [e, te] = hb[i + 1];
      if (f <= a && f >= e) return yt + (ta + ((te - ta) * (f - a)) / (e - a)) * k;
    }
    return yt;
  };
  const ring = (x: number, top: number, hw: number): V3[] => {
    const yb = yt - 0.02 * k, t = yt + top * k;
    return [[x, yb, -hw * 0.9], [x, yb, hw * 0.9], [x, yb + (t - yb) * 0.5, hw], [x, t - 0.06 * k, hw * 0.88], [x, t, hw * 0.5], [x, t, -hw * 0.5], [x, t - 0.06 * k, -hw * 0.88], [x, yb + (t - yb) * 0.5, -hw]];
  };
  b.loft(kit.armor, hb.map(([x, t, hw]) => ring(x * kx, t, hw * kz)));
  // spine channel + glowing core bar along the crown
  b.loft(kit.mech, hb.slice(1, 5).map(([x, t]) => ring(x * kx, t + 0.03, 0.08 * kz)));
  for (const [x0, x1] of [[-0.32, -0.52], [-0.6, -0.86]]) {
    const xm = ((x0 + x1) / 2) * kx;
    pbox(b, kit.plasma, Math.abs(x1 - x0) * kx * 0.8, 0.025 * k, 0.05 * kz, xm, ht(xm) + 0.045 * k, 0, [0, 0, x0 > -0.4 ? 0.45 : -0.15]);
  }
  // carapace: three stacked bone plates per side, each overlapping the one behind (offset edges), tilted with the crown
  both((s) => {
    for (const [x0, x1, dz] of [[-0.14, -0.4, 0.0], [-0.38, -0.66, 0.012], [-0.64, -0.9, 0.0]] as [number, number, number][]) {
      const xa = x0 * kx, xb = x1 * kx, xm = (xa + xb) / 2;
      const ya = ht(xa), yb2 = ht(xb), slope = Math.atan2(ya - yb2, xa - xb);
      const F = new THREE.Matrix4().makeRotationZ(slope).setPosition(xm, (ya + yb2) / 2 - 0.035 * k, s * (0.15 + dz) * kz);
      b.g(new THREE.BoxGeometry(Math.abs(xa - xb) * 1.04, 0.015 * k, 0.1 * kz), kit.mech, F.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.035 * k, 0)));
      const g = new THREE.BoxGeometry(Math.abs(xa - xb), 0.05 * k, 0.13 * kz);
      b.g(g, kit.shell, F.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.065 * k, s * 0.01 * kz)));
    }
    // flank: glowing slot under a dark plate on the hump side
    pbox(b, kit.plasma, 0.4 * kx, 0.04 * k, 0.012 * k, -0.6 * kx, yt + 0.3 * k, s * 0.318 * kz);
    const F = frame([-0.58 * kx, yt + 0.15 * k, s * 0.33 * kz], [0, 0.12, s], XA);
    armorPlate(b, kit, kit.armor2, F, rectP(0.56 * kx, 0.17 * k, 0.03 * k), 0.024 * k, { standoff: 0.008 * k, gap: 0.012 * k });
    // forelimb: armoured strut from the chest shoulder down over the front wheel, joint drum at the shoulder, a
    // fender pad over the tyre (the predator crouching on its front wheels)
    const sh: V3 = [hx - 0.02 * kx, cT - 0.08 * k, s * 0.36 * kz], ft: V3 = [0.7 * kx, yt + 0.06 * k, s * 0.43 * kz];
    b.cylb(kit.joint, 0.08 * k, 0.1 * kz, 0.012 * k, [sh[0], sh[1], s * 0.3 * kz], 'z', 12);
    beam(b, kit.armor, sh, ft, 0.07 * kz, 0.09 * k, [0, 0, s]);
    beam(b, kit.shell, [sh[0] + 0.03 * kx, sh[1] + 0.01 * k, sh[2] + s * 0.035 * kz], [ft[0] - 0.08 * kx, ft[1] + 0.04 * k, ft[2] + s * 0.035 * kz], 0.02 * kz, 0.06 * k, [0, 0, s]);
    block(b, kit.armor2, ft[0] + 0.02 * kx, ft[1] - 0.03 * k, ft[2], 0.3 * kx, 0.13 * kz, 0.06 * k, { top: [0.6, 0.85], shift: [0.02 * kx, 0], ch: 0.04 * k, bev: 0.012 * k });
  });
  // ---- haunches over the rear axle: big joint drums in armoured hip blocks (the raptor's hind legs)
  both((s) => {
    const p: V3 = [-0.66 * kx, yt + 0.02 * k, s * 0.36 * kz];
    b.cylb(kit.joint, 0.11 * k, 0.1 * kz, 0.015 * k, [p[0], p[1], s * 0.34 * kz], 'z', 14);
    block(b, kit.armor, p[0] + 0.02 * kx, yt - 0.06 * k, s * 0.43 * kz, 0.4 * kx, 0.1 * kz, 0.2 * k, { top: [0.66, 0.8], shift: [-0.05 * kx, -s * 0.01 * kz], ch: 0.05 * k, bev: 0.02 * k, bot: 0.015 * k });
    block(b, kit.shell, p[0] - 0.01 * kx, yt + 0.12 * k, s * 0.43 * kz, 0.22 * kx, 0.08 * kz, 0.03 * k, { top: [0.7, 0.8], ch: 0.025 * k, bev: 0.01 * k });
    pbox(b, kit.glow, 0.16 * kx, 0.016 * k, 0.01 * k, p[0] + 0.02 * kx, yt + 0.04 * k, s * 0.483 * kz);
    // ram from the haunch up to the hump
    piston(b, kit, [p[0] + 0.14 * kx, yt + 0.02 * k, s * 0.34 * kz], [-0.3 * kx, yt + 0.24 * k, s * 0.3 * kz], 0.022 * k, 0.55, true);
  });
  // tail: twin exhausts out the back of the hump
  both((s) => b.cyl(kit.hot, 0.03 * k, 0.03 * k, 0.012 * k, [-1.005 * kx, yt + 0.08 * k, s * 0.08 * kz], '-x', 8));
  antenna(b, kit, -0.86 * kx, yt + 0.38 * k, -0.18 * kz, 0.4 * k, 0.006 * k, [-0.3, 0, 0]);
  const deck = (x: number, z: number) => {
    if (Math.abs(z) > 0.5 * kz || Math.abs(x) > kx) return -1;
    if (Math.hypot(x - hx, z - hz) < pr) return seatY;
    if (Math.abs(x - hx) < 0.28 * kx && Math.abs(z) < 0.3 * kz) return cT;
    return yt + 0.05 * k;
  };
  return {
    deckAt: deck, top: seatY + 0.02 * k, custom: true, dressed: true,
    seat: (m) => {
      if (m === hero) { collar(b, kit, m.x, seatY, m.z, m.r, seatY - 0.02 * k, 16); return { y: seatY, socket: true }; }
      return { y: ringSeat(b, kit, m, deck(m.x, m.z) > 0 ? deck(m.x, m.z) : yt, 0.015 * k, 10), socket: true };
    },
  };
}

registerChassis('raider', raider);
registerTorso('raider');
registerChassis('aegis', aegis);
registerChassis('hunter', hunter);
