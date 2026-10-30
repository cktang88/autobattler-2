// Light / medium non-tank ground hulls, hard-surface style (chassis/hs-kit.ts + hs-kit-vehicles.ts): a dark structural
// belly inside the running gear, a faceted armour hull on top (flat deck, sharp shoulders, sloped glacis), separate
// thick plates on shadow gaps, functional parts in named slots and 2-3 one-sided features per hull. Size-1 hulls are
// ~20 px in game, so they carry a strong silhouette and a few bold functional parts, no tertiary detail (fineFor).
//   scout    (wedge)    recon car: low arrowhead hull on four wheels, telescopic sensor mast (right rear), driver's
//                       visor + periscopes (left), whip antenna (left), spare wheel on the rear plate
//   raider   (box)      armoured gun truck: raised fighting casemate carrying the twin guns, open cargo bed behind with
//                       a roll bar, spare wheel, jerry cans and tarp, bull bar on the nose, exhaust stack (right)
//   carriage (carriage) self-propelled field gun: cradle on the axle, faceted gun shield (sight box left), equilibrator
//                       pistons, a short spine back to an armoured counterweight bustle with the ammo box on its left
//   hunter   (hunter)   long low 6-wheel tank hunter: shallow glacis with a folded trim vane, smoke banks, driver's
//                       hatch + periscopes (left), remote weapon station on the engine deck, exhaust (right), bins
//   (riot lives in chassis/heavies.ts, striker 'cross' in chassis/carriers.ts)
//   aegis    (round)    armoured recovery / repair vehicle: chamfered octagon hull, crane jib stowed along the left
//                       deck with a hook block, comms dish mast (right), winch + tow bar on the nose, engineer crosses
// Hulls work on every mobility: the lower hull is clamped inside the running gear (stance.wi), anything wider starts at
// the fender line (stance.yt); legged stances get a hip keel under the belly.

import * as THREE from 'three';
import type { P2, V3 } from '../geo.ts';
import { bevBox, Bld, mtx, slabGeo, strutGeo } from '../geo.ts';
import { atlasUV, type Kit, type MatLike } from '../materials.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type MountSpec } from './registry.ts';
import { beam, block, both } from './shapes.ts';
import {
  antenna, armorPlate, cagedLamp, plateStack, crewHatch, exhaustBox, fineFor, frame, hose, jerryCans, piston, recessPanel, rectP, smokeLaunchers,
  stowBox, sub, towHooks,
} from './hs-kit.ts';
import {
  bullBar, dish, facePlate, grille, facetHull, periscopes, ringSeat, sensorMast, spade, spareWheel, wheelArch, type FSt,
} from './hs-kit-vehicles.ts';

/** cheap unbevelled box (12 tris) for small parts: lamps, strips, accents, brackets */
export function cbox(b: Bld, mat: MatLike, w: number, h: number, d: number, x: number, y: number, z: number, _bev = 0, rot?: V3): void {
  b.g(new THREE.BoxGeometry(w, h, d), mat, mtx([x, y, z], rot));
}

/** hip keel for legged stances: armoured belly block reaching down to the hip drums */
function keel(c: ChassisCtx, l: number, x = 0): void {
  const { b, kit, stance, W } = c;
  if (!stance.legs) return;
  const t = stance.thick;
  const w = stance.legs === 'spider' ? W * 0.5 : Math.max(W * 0.3, W * 0.54 - t * 1.6);
  block(b, kit.trim, x, stance.hipY - t * 0.9, 0, l, w, stance.y0 - stance.hipY + t * 0.95, { top: [1.06, 1.08], ch: t * 0.5, bev: t * 0.12, bot: t * 0.25 });
}

const UP: V3 = [0, 1, 0], ZA: V3 = [0, 0, 1], XA: V3 = [1, 0, 0];

/** wheel radius / track for the 'wheels' mobility (mirrors mobility/wheels.ts wheelDims) */
const wheelR = (S: number) => 0.08 + 0.05 * S;
/** the scout's front axle runs a narrower track (mobility/wheels.ts): the arrowhead plan reads even at 20 px */
const WEDGE_FRONT_TRACK = 0.78;

/** mudguards over the axles a 'wheels' mobility will put under this hull: a flat fender from the hull side out over
 *  the tyre with a sloped front lip (plain boxes: these hulls are small) */
function arches(c: ChassisCtx, xs: number[], mat?: MatLike, track: number[] = []): void {
  if (c.mob.id !== 'wheels') return;
  const wr = wheelR(c.S), w = wr * 0.68, th = Math.max(0.008, wr * 0.06);
  const m = mat ?? c.kit.armor2;
  xs.forEach((x, i) => both((s) => {
    const zo = (c.W / 2 - w / 2) * (track[i] ?? 1);
    const z0 = zo - w * 0.8, z1 = zo + w * 0.62, y = wr * 2 + th * 1.5;
    c.b.g(new THREE.BoxGeometry(wr * 2.1, th, z1 - z0), m, mtx([x, y, s * (z0 + z1) / 2]));
    c.b.g(new THREE.BoxGeometry(wr * 0.7, th, z1 - z0), m, mtx([x + wr * 1.3, y - wr * 0.22, s * (z0 + z1) / 2], [0, 0, -0.6]));
    c.b.g(new THREE.BoxGeometry(wr * 0.5, th, z1 - z0), m, mtx([x - wr * 1.22, y - wr * 0.16, s * (z0 + z1) / 2], [0, 0, 0.6]));
  }));
}

// ---- scout: recon car ------------------------------------------------------------------------------------------------
function scout(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const y0 = stance.y0;
  const X = (f: number) => f * L, Z = (f: number) => f * W;
  keel(c, L * 0.5, -L * 0.05);
  // dark belly between the wheels, then the faceted armour hull: wide flat rear deck, shallow glacis, arrowhead nose
  facetHull(c, kit.mech, [[X(-0.44), 0, 0.01, 0.05, 0.06, Z(0.204), Z(0.24), Z(0.24)], [X(0.46), 0.03, 0.035, 0.05, 0.06, Z(0.096), Z(0.132), Z(0.132)]]);
  const st: FSt[] = [
    [X(-0.48), 0.05, 0.05, 0.1, 0.13, Z(0.264), Z(0.324), Z(0.252)],
    [X(-0.36), 0.045, 0.045, 0.11, 0.155, Z(0.312), Z(0.36), Z(0.276)],
    [X(0.06), 0.045, 0.045, 0.11, 0.15, Z(0.312), Z(0.36), Z(0.264)],
    [X(0.3), 0.05, 0.05, 0.08, 0.1, Z(0.2), Z(0.24), Z(0.15)],
    [X(0.52), 0.05, 0.055, 0.06, 0.065, Z(0.084), Z(0.192), Z(0.06)],
  ];
  const H = facetHull(c, kit.armor, st);
  const dk = (x: number, z = 0) => Math.max(y0, H.deck(x, z));
  // upper glacis plate on a shadow gap, driver's visor + two periscopes on its left half (asymmetric)
  facePlate(b, kit, kit.armor2, [X(0.3), dk(X(0.3)), 0], [X(0.07), dk(X(0.07)), 0], ZA, Z(0.38), 0.012, UP, { standoff: 0.004, gap: 0.008, fill: 0.86 });
  b.g(new THREE.BoxGeometry(0.05, 0.03, Z(0.12)), kit.armor2, mtx([X(0.16), dk(X(0.16)) + 0.012, -Z(0.12)], [0, 0, 0.2]));
  periscopes(b, kit, X(0.185), dk(X(0.16)) + 0.012, -Z(0.12), 2, 0.022);
  // engine louvres on the rear deck, spare wheel on the rear plate, tow eye
  grille(b, kit, frame([X(-0.38), dk(X(-0.38)), Z(0.02)], UP), X(0.13), Z(0.22), 0.012, 3);
  spareWheel(b, kit, [X(-0.48) - 0.028, y0 + 0.085, -Z(0.05)], '-x', 0.075, 0.045);
  // recon signature: telescopic sensor mast (right rear) + whip antenna (left rear)
  sensorMast(b, kit, [X(-0.28), dk(X(-0.28)), Z(0.16)], 0.3, 0.011, 0.2);
  antenna(b, kit, X(-0.42), dk(X(-0.42)), -Z(0.18), 0.42, 0.0045, [-0.18, 0, 0]);
  // headlamps in the nose corners, exhaust on the left flank
  both((s) => cbox(b, kit.lamp, 0.02, 0.022, 0.035, X(0.43), y0 + 0.075, s * Z(0.08), 0, [0, -s * 0.5, 0]));
  b.cyl(kit.joint, 0.012, 0.012, 0.06, [X(-0.4), y0 + 0.08, -Z(0.37)], 'x', 6);
  cbox(b, kit.accent, X(0.1), 0.004, Z(0.04), X(-0.06), dk(X(-0.06), Z(0.19)) + 0.002, Z(0.19));
  arches(c, [X(0.31), X(-0.31)], undefined, [WEDGE_FRONT_TRACK]);
  return {
    deckAt: H.deck, top: dk(0) + 0.03, custom: true, dressed: true,
    seat: (m) => ({ y: ringSeat(b, kit, m, dk(m.x, m.z), 0.022, 12), socket: true }),
  };
}

// ---- raider: armoured gun truck ----------------------------------------------------------------------------------------
function raider(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const y0 = stance.y0;
  const X = (f: number) => f * L, Z = (f: number) => f * W;
  keel(c, L * 0.5, -L * 0.05);
  facetHull(c, kit.mech, [[X(-0.46), 0, 0.01, 0.05, 0.06, Z(0.24), Z(0.288), Z(0.288)], [X(0.46), 0.02, 0.03, 0.05, 0.06, Z(0.192), Z(0.24), Z(0.24)]]);
  // lower hull: boxy truck body with a low flat bed at the rear and a blunt bonnet at the nose
  const H = facetHull(c, kit.armor2, [
    [X(-0.49), 0.045, 0.045, 0.09, 0.11, Z(0.312), Z(0.36), Z(0.336)],
    [X(0.36), 0.045, 0.045, 0.09, 0.11, Z(0.312), Z(0.36), Z(0.336)],
    [X(0.5), 0.05, 0.05, 0.07, 0.085, Z(0.264), Z(0.324), Z(0.24)],
  ]);
  // fighting casemate carrying both guns: vertical lower band, sloped cheeks, sloped front plate down to the bonnet
  const cy = y0 + 0.1;
  const cs: FSt[] = [
    [X(-0.17), 0.1, 0.1, 0.15, 0.2, Z(0.324), Z(0.36), Z(0.3)],
    [X(0.26), 0.1, 0.1, 0.15, 0.2, Z(0.324), Z(0.36), Z(0.3)],
    [X(0.4), 0.1, 0.1, 0.11, 0.125, Z(0.288), Z(0.336), Z(0.24)],
  ];
  const C = facetHull(c, kit.armor, cs, 0, false);
  const roof = y0 + 0.2;
  // front plate (driver's visor slit + periscopes on the left), side armour plates on the casemate flanks
  facePlate(b, kit, kit.armor, [X(0.4), y0 + 0.125, 0], [X(0.26), roof, 0], ZA, Z(0.44), 0.011, XA, { standoff: 0.004, gap: 0.007, fill: 0.84 });
  cbox(b, kit.mech, 0.012, 0.012, Z(0.14), X(0.335), y0 + 0.17, -Z(0.12), 0, [0, 0, 0.75]);
  periscopes(b, kit, X(0.25), roof, -Z(0.12), 2, 0.02);
  // flank plates (plain boxes on size 1: a shadow line under them, no bevel budget)
  both((s) => { b.g(new THREE.BoxGeometry(X(0.36), 0.07, 0.01), kit.armor2, mtx([X(0.05), cy + 0.06, s * (Z(0.36) + 0.009)])); b.g(new THREE.BoxGeometry(X(0.34), 0.01, 0.006), kit.mech, mtx([X(0.05), cy + 0.022, s * (Z(0.36) + 0.004)])); });
  // open cargo bed: side boards, roll bar, spare wheel lying in it, jerry cans, rolled tarp
  const bed = H.deck(X(-0.3), 0);
  both((s) => b.g(new THREE.BoxGeometry(X(0.32), 0.05, 0.012), kit.armor2, mtx([X(-0.33), bed + 0.025, s * Z(0.345)])));
  b.g(new THREE.BoxGeometry(0.012, 0.05, Z(0.7)), kit.armor2, mtx([X(-0.49), bed + 0.025, 0]));
  const rb = (s: number): V3 => [X(-0.2), bed, s * Z(0.27)];
  both((s) => b.g(strutGeo(rb(s), [X(-0.22), bed + 0.15, s * Z(0.22)], 0.008, 0.008, 5), kit.joint));
  b.g(strutGeo([X(-0.22), bed + 0.15, -Z(0.22)], [X(-0.22), bed + 0.15, Z(0.22)], 0.008, 0.008, 5), kit.joint);
  spareWheel(b, kit, [X(-0.37), bed + 0.024, -Z(0.13)], 'y', 0.07, 0.042);
  jerryCans(b, kit, frame([X(-0.3), bed, Z(0.15)], UP, ZA), 2, 0.062);
  b.cyl(kit.canvas, 0.03, 0.03, Z(0.5), [X(-0.45), bed + 0.03, -Z(0.25)], 'z', 7);
  // bull bar, headlamps, exhaust stack behind the casemate (right), antenna (left rear)
  bullBar(b, kit, X(0.53), y0 + 0.01, 0, Z(0.5), 0.09, 0.007);
  both((s) => cbox(b, kit.lamp, 0.016, 0.022, 0.035, X(0.505), y0 + 0.075, s * Z(0.17)));
  b.cyl(kit.joint, 0.012, 0.012, 0.17, [X(-0.15), bed, Z(0.36)], 'y', 6);
  b.cyl(kit.hot, 0.009, 0.009, 0.005, [X(-0.15), bed + 0.17, Z(0.36)], 'y', 6);
  antenna(b, kit, X(-0.12), roof, -Z(0.22), 0.38, 0.0045, [-0.2, 0, 0]);
  cbox(b, kit.accent, 0.004, 0.03, Z(0.1), X(0.405), y0 + 0.14, Z(0.14), 0, [0, 0, 0.75]);
  arches(c, [X(0.31), X(-0.31)]);
  const deck = (x: number, z: number) => Math.max(H.deck(x, z), C.deck(x, z));
  return {
    deckAt: deck, top: roof + 0.03, custom: true, dressed: true,
    seat: (m) => ({ y: ringSeat(b, kit, m, roof, 0.018, 9), socket: true }),
  };
}

// ---- carriage: self-propelled field gun ------------------------------------------------------------------------------------------
// Built round its one medium gun (1.5 cells, the same size on every hull): a split-trail field carriage that drives
// itself. Static: the gun axle (a box beam between the wheels with hub drive motors and armoured mudguards), the bottom
// carriage saddle + slewing ring on it, two box-section trails splaying back to recoil spades at the rear corners and a
// glowing power pack slung between them. Twisting with the gun (mech torso mode): the top carriage (dark saddle,
// cradle trough), two tall trunnion cheeks holding the gun's trunnion pins, equilibrator rams, and a faceted gun shield
// (centre apron under the barrel, two swept wings flanking the gun, sight box on the left). Top-down: a broad shield
// across the front, the trails as an arrowhead behind it.
function carriage(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, S, stance } = c;
  const y0 = stance.y0;
  const k = Math.min(L, W) / 2; // authored at 2 x 2
  const wheels = c.mob.id === 'wheels';
  const legs = !!stance.legs;
  keel(c, L * 0.3);
  // gun axle height: the wheel centre on wheels, otherwise just above the running gear
  const ay = wheels ? wheelR(S) * 1.0 + 0.06 * (S - 1) : y0 + 0.08 * k;
  const P = Math.max(stance.yt, ay + 0.1 * k) + 0.12 * k; // slewing ring top = the twist pivot
  // ---- axle: dark box beam between the wheels, drive motor drums at the hubs, armoured mudguards
  block(b, kit.mech, 0, ay - 0.08 * k, 0, 0.24 * k, (wheels ? 1.72 : 1.3) * k, 0.16 * k, { ch: 0.05 * k, bev: 0.015 * k });
  if (wheels) both((s) => {
    const wr = wheelR(S);
    b.cylb(kit.joint, 0.1 * k, 0.16 * k, 0.012 * k, [0, ay, s * 0.86 * k - (s > 0 ? 0.16 * k : 0)], 'z', 10);
    // mudguard: a flat team plate over the tyre, sloped lips front and back, bone cap
    const z0 = 0.84 * k, z1 = 1.0 * k, gy = ay + wr + 0.05 * k;
    block(b, kit.armor, 0, gy, s * (z0 + z1) / 2, wr * 1.5, z1 - z0, 0.035 * k, { top: [0.9, 0.9], ch: 0.02 * k, bev: 0.01 * k });
    for (const d of [-1, 1]) b.g(new THREE.BoxGeometry(wr * 0.7, 0.03 * k, z1 - z0), kit.armor2, mtx([d * wr * 0.98, gy - wr * 0.2, s * (z0 + z1) / 2], [0, 0, d * -0.75]));
    // strut from the axle beam up to the mudguard
    beam(b, kit.mech, [0, ay + 0.06 * k, s * 0.7 * k], [0, gy, s * 0.88 * k], 0.06 * k, 0.05 * k);
  });
  // ---- bottom carriage: armoured saddle on the axle, slewing ring
  const sb = legs ? stance.hipY - stance.thick * 0.6 : ay - 0.02 * k;
  block(b, kit.armor2, 0, sb, 0, 0.62 * k, 0.66 * k, P - 0.04 * k - sb, { top: [0.8, 0.82], ch: 0.1 * k, bev: 0.02 * k, bot: 0.015 * k });
  b.cylb(kit.joint, 0.34 * k, 0.06 * k, 0.012 * k, [0, P - 0.055 * k, 0], 'y', 16);
  // ---- split trails: box beams from hinge drums on the saddle back to recoil spades at the rear corners
  const tr: V3 = [-0.86 * k, Math.max(0.1 * k, y0 * 0.7), 0];
  both((s) => {
    const h0: V3 = [-0.22 * k, ay, s * 0.2 * k], e: V3 = [tr[0], tr[1], s * 0.72 * k];
    b.cylb(kit.joint, 0.075 * k, 0.2 * k, 0.012 * k, [h0[0], ay - 0.1 * k, h0[2]], 'y', 10);
    beam(b, kit.armor2, h0, e, 0.15 * k, 0.13 * k);
    // armour cap along the trail top, bright lift handle near the end
    beam(b, kit.armor, [h0[0] - 0.06 * k, h0[1] + 0.075 * k, h0[2] + s * 0.02 * k], [e[0] + 0.12 * k, e[1] + 0.07 * k, e[2] - s * 0.04 * k], 0.1 * k, 0.03 * k);
    pbox(b, kit.glow, 0.26 * k, 0.018 * k, 0.012 * k, (h0[0] + e[0]) / 2, (h0[1] + e[1]) / 2 + 0.01 * k, (h0[2] + e[2]) / 2 + s * 0.068 * k, [0, Math.atan2(e[2] - h0[2], e[0] - h0[0]) * -1 + Math.PI, 0]);
    // recoil spade: a wide blade digging in behind the trail end, braced by ribs
    spade(b, kit, new THREE.Matrix4().makeRotationY(Math.PI / 2).multiply(new THREE.Matrix4().makeRotationX(-0.35)).setPosition(e[0] - 0.04 * k, e[1] + 0.06 * k, e[2]), 0.32 * k, 0.22 * k, 0.03 * k, kit.armor2);
    b.cylb(kit.joint, 0.04 * k, 0.24 * k, 0.006 * k, [e[0] - 0.02 * k, e[1] + 0.04 * k, e[2] - 0.12 * k], 'z', 8);
  });
  // power pack between the trails (the gun drives itself): dark block, glowing vents, an exhaust out the back
  const pp = -0.5 * k;
  block(b, kit.mech, pp, Math.max(0.05 * k, ay - 0.1 * k), 0, 0.36 * k, 0.3 * k, 0.2 * k, { top: [0.9, 0.85], ch: 0.05 * k, bev: 0.012 * k });
  pbox(b, kit.plasma, 0.2 * k, 0.012 * k, 0.2 * k, pp, Math.max(0.05 * k, ay - 0.1 * k) + 0.205 * k, 0);
  b.cyl(kit.hot, 0.025 * k, 0.025 * k, 0.01 * k, [pp - 0.185 * k, ay, 0.06 * k], '-x', 8);
  arches(c, []);

  // ---- top carriage, cheeks and shield (twist with the gun); hero trunnion at hp
  const hp: V3 = [0.12 * k, 0.4 * k, 0];
  const upper = (t: Bld) => {
    // swivel collar + dark top carriage
    t.cylb(kit.mech, 0.3 * k, 0.05 * k, 0.01 * k, [0, -0.01 * k, 0], 'y', 16);
    block(t, kit.mech, -0.04 * k, 0.02 * k, 0, 0.86 * k, 0.86 * k, 0.12 * k, { top: [0.9, 0.9], ch: 0.14 * k, bev: 0.02 * k });
    // cradle trough the gun rests in
    block(t, kit.armor2, 0.12 * k, 0.12 * k, 0, 0.9 * k, 0.5 * k, 0.07 * k, { top: [0.92, 0.9], ch: 0.06 * k, bev: 0.012 * k });
    both((s) => {
      // trunnion cheek: a tall team plate (dark backing inside), bone cap, trunnion bearing drum + pin into the gun
      const cz = s * 0.62 * k;
      cheek(t, kit.armor, [[-0.42 * k, 0.04 * k], [0.4 * k, 0.04 * k], [0.34 * k, 0.4 * k], [0.18 * k, 0.56 * k], [-0.12 * k, 0.56 * k], [-0.36 * k, 0.3 * k]], cz + s * 0.03 * k, 0.07 * k);
      cheek(t, kit.mech, [[-0.36 * k, 0.04 * k], [0.36 * k, 0.04 * k], [0.3 * k, 0.36 * k], [-0.3 * k, 0.3 * k]], cz - s * 0.03 * k, 0.05 * k);
      block(t, kit.shell, 0.02 * k, 0.56 * k, cz + s * 0.03 * k, 0.26 * k, 0.09 * k, 0.03 * k, { top: [0.7, 0.8], ch: 0.02 * k, bev: 0.008 * k });
      t.cylb(kit.joint, 0.11 * k, 0.12 * k, 0.015 * k, [hp[0], hp[1], cz + (s > 0 ? -0.02 : -0.1) * k], 'z', 12);
      t.cyl(kit.mech, 0.06 * k, 0.06 * k, 0.36 * k, [hp[0], hp[1], s > 0 ? 0.3 * k : -0.66 * k], 'z', 8);
      pbox(t, kit.glow, 0.3 * k, 0.025 * k, 0.012 * k, -0.06 * k, 0.2 * k, cz + s * 0.072 * k);
      // equilibrator ram from the top carriage up to the cheek head
      piston(t, kit, [-0.36 * k, 0.12 * k, s * 0.5 * k], [-0.08 * k, 0.5 * k, s * 0.53 * k], 0.03 * k, 0.55, S >= 2);
      // shield wing: hinged on the apron edge either side of the barrel slot, swept back past the wheel, its inner
      // top a horn rising beside the gun; two-layer plate (team face, bone inner layer) on a dark backing
      const a = 0.42, n: V3 = [Math.cos(a), 0.26, s * Math.sin(a)];
      const F = frame([0.84 * k - Math.sin(a) * 0.33 * k, 0.22 * k, s * (0.34 + Math.cos(a) * 0.33) * k], n, [-n[2], 0, n[0]]);
      // (local x runs outward-back along the wing, local z up the plate)
      const wing: P2[] = [[-0.33 * k, -0.36 * k], [0.2 * k, -0.42 * k], [0.33 * k, -0.3 * k], [0.33 * k, 0.2 * k], [0.12 * k, 0.32 * k], [-0.2 * k, 0.36 * k], [-0.33 * k, 0.46 * k]];
      plateStack(t, kit, kit.armor, F, wing, [
        { inset: 0, thick: 0.045 * k, standoff: 0.025 * k },
        { inset: 0.11 * k, thick: 0.025 * k, mat: kit.armor2, shift: [0.05 * k, -0.08 * k] },
      ], { gap: 0.03 * k });
      // bone edge cap along the horn and a glowing vision slit
      t.g(new THREE.BoxGeometry(0.2 * k, 0.03 * k, 0.05 * k), kit.shell, sub(F, -0.24 * k, 0.1 * k, 0.4 * k, 0, 0, 0));
      t.g(new THREE.BoxGeometry(0.22 * k, 0.03 * k, 0.025 * k), kit.glow, sub(F, 0.06 * k, 0.1 * k, 0.12 * k, 0, 0, 0));
      // wing brace back to the cheek
      beam(t, kit.mech, [0.3 * k, 0.24 * k, s * 0.62 * k], [0.64 * k, 0.24 * k, s * 0.62 * k], 0.07 * k, 0.1 * k);
    });
    // centre apron under the barrel slot: a raked two-layer plate below the gun
    const AF = frame([0.84 * k, -0.08 * k, 0], [1, 0.4, 0], [0, 0, 1]);
    plateStack(t, kit, kit.armor, AF, [[-0.36 * k, -0.22 * k], [0.36 * k, -0.22 * k], [0.36 * k, 0.16 * k], [0.2 * k, 0.2 * k], [-0.2 * k, 0.2 * k], [-0.36 * k, 0.16 * k]], [
      { inset: 0, thick: 0.04 * k, standoff: 0.02 * k },
      { inset: 0.05 * k, thick: 0.025 * k, mat: kit.armor2, shift: [0, -0.02 * k] },
    ], { gap: 0.02 * k });
    both((s) => pbox(t, kit.lamp, 0.02 * k, 0.03 * k, 0.1 * k, 0.9 * k, -0.06 * k, s * 0.2 * k, [0, 0, -0.38]));
    // sight box on the left wing top, accent tick on the right
    block(t, kit.armor2, 0.3 * k, 0.6 * k, -0.84 * k, 0.12 * k, 0.1 * k, 0.08 * k, { ch: 0.02 * k, bev: 0.008 * k });
    pbox(t, kit.glass, 0.01 * k, 0.03 * k, 0.06 * k, 0.365 * k, 0.645 * k, -0.84 * k);
    // ready-ammo bin on the back of the top carriage
    block(t, kit.armor2, -0.48 * k, 0.1 * k, 0.3 * k, 0.18 * k, 0.24 * k, 0.14 * k, { ch: 0.03 * k, bev: 0.01 * k });
    pbox(t, kit.accent, 0.012 * k, 0.03 * k, 0.18 * k, -0.575 * k, 0.17 * k, 0.3 * k);
  };
  const heroM = c.mounts.find((m) => m.mod.kind === 'weapon');
  if (!heroM) {
    // a utility instead of a gun: the same upper carriage, static
    const tb = new Bld(), g = new THREE.Group();
    g.position.set(0, P, 0);
    upper(tb);
    tb.mount(g);
    c.body.add(g);
  }
  return {
    deckAt: (x, z) => (Math.hypot(x, z) < 0.4 * k ? P : -1), top: P + 0.6 * k, custom: true, dressed: true,
    seat: (mm) => (mm === heroM ? { y: P, socket: true } : { y: ringSeat(b, kit, mm, P + 0.14 * k, 0.02, 12), socket: true }),
    torso: heroM ? (t) => { upper(t); return { hp: [hp], at: [0, P, 0] }; } : undefined,
  };
}

/** flat side plate in the x-y plane (a cheek / fin): poly in (x, y), thickness th centred on z */
function cheek(b: Bld, mat: MatLike, poly: P2[], z: number, th: number): void {
  const g = slabGeo(poly, th, Math.min(th * 0.3, 0.02));
  b.g(g, mat, new THREE.Matrix4().makeTranslation(0, 0, z + th / 2).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)));
}
const pbox = (b: Bld, mat: MatLike, w: number, h: number, d: number, x: number, y: number, z: number, rot?: V3) => b.g(new THREE.BoxGeometry(w, h, d), mat, mtx([x, y, z], rot));

// ---- hunter: long low 6-wheel tank hunter ----------------------------------------------------------------------------------
function hunter(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, S, stance } = c;
  const y0 = stance.y0;
  const X = (f: number) => (f * L) / 2, Z = (f: number) => f * W; // authored at L=2, W=1
  const fine = fineFor(S);
  keel(c, L * 0.42, -L * 0.1);
  facetHull(c, kit.mech, [[X(-0.95), 0, 0.01, 0.06, 0.07, Z(0.24), Z(0.288), Z(0.288)], [X(0.9), 0.04, 0.05, 0.07, 0.08, Z(0.144), Z(0.192), Z(0.192)]]);
  const st: FSt[] = [
    [X(-1.0), 0.05, 0.05, 0.17, 0.22, Z(0.288), Z(0.336), Z(0.264)],
    [X(-0.86), 0.04, 0.04, 0.19, 0.27, Z(0.312), Z(0.36), Z(0.276)],
    [X(0.42), 0.04, 0.04, 0.19, 0.27, Z(0.312), Z(0.36), Z(0.276)],
    [X(0.9), 0.06, 0.06, 0.1, 0.12, Z(0.24), Z(0.312), Z(0.18)],
    [X(1.02), 0.08, 0.08, 0.09, 0.095, Z(0.12), Z(0.216), Z(0.096)],
  ];
  const H = facetHull(c, kit.armor, st);
  const dk = (x: number, z = 0) => Math.max(y0, H.deck(x, z));
  const T = 0.014;
  // long shallow upper glacis: two-plate stack, folded trim vane on its lower half (the hunter's nose signature)
  const g0: V3 = [X(0.9), dk(X(0.9)), 0], g1: V3 = [X(0.44), dk(X(0.44)), 0];
  const GF = facePlate(b, kit, kit.armor, g0, g1, ZA, Z(0.44), T, UP, { standoff: 0.005, gap: 0.01, fill: 0.9 });
  armorPlate(b, kit, kit.armor2, sub(GF, 0, 0.005 + T, 0), rectP(Z(0.4), 0.09, 0.02), T * 0.9, { standoff: 0.004, gap: 0.008 });
  b.g(new THREE.CylinderGeometry(0.008, 0.008, Z(0.4), 6).rotateX(Math.PI / 2), kit.joint, mtx([X(0.86), dk(X(0.86)) + 0.03, 0]));
  // shoulder plates, smoke banks on the nose corners, caged lamps
  both((s) => facePlate(b, kit, kit.armor2, [0, y0 + 0.19, s * Z(0.36)], [0, y0 + 0.27, s * Z(0.276)], XA, X(0.9), 0.01, [0, 0.4, s], { shift: -X(0.16), standoff: 0.004, gap: 0.008 }));
  both((s) => {
    smokeLaunchers(b, kit, frame([X(0.5), dk(X(0.5), s * Z(0.2)), s * Z(0.2)], UP, [Math.cos(0.6), 0, s * Math.sin(0.6)]), 3, 0.014);
    cagedLamp(b, kit, frame([X(0.9), dk(X(0.9), s * Z(0.13)), s * Z(0.13)], UP, XA), 0.035, fine);
  });
  // driver's hatch + periscopes (front left)
  crewHatch(b, kit, frame([X(0.3), dk(X(0.3)), -Z(0.12)], UP), 0.04, fine);
  periscopes(b, kit, X(0.37), dk(X(0.37)), -Z(0.12), 3, 0.02);
  // engine deck: recessed louvred grille, exhaust (right rear), antenna pair (left rear), stowage bins (right flank)
  grille(b, kit, frame([X(-0.86), dk(X(-0.86)), -Z(0.04)], UP), X(0.18), Z(0.3), 0.015, 4);
  exhaustBox(b, kit, frame([X(-0.86), dk(X(-0.86)), Z(0.17)], UP, ZA), 0.026, fine);
  antenna(b, kit, X(-0.72), dk(X(-0.72)), -Z(0.2), 0.62, 0.006, [-0.16, 0, 0]);
  antenna(b, kit, X(-0.2), dk(X(-0.2)), -Z(0.21), 0.38, 0.005, [-0.12, 0, 0]);
  stowBox(b, kit, frame([X(-0.1), y0 + 0.19, Z(0.36) + 0.01], [0, 0, 1], XA), X(0.42), 0.05, 0.04);
  stowBox(b, kit, frame([X(0.18), y0 + 0.19, -Z(0.36) - 0.01], [0, 0, -1], XA), X(0.28), 0.045, 0.035, kit.canvas);
  towHooks(b, kit, frame([X(-1.0) - 0.004, y0 + 0.11, 0], [-1, 0, 0], ZA), Z(0.3), 0.018);
  b.decal(0.09, 0.09, X(-0.3), dk(X(-0.3)) + 0.003, Z(0.13), atlasUV(1), 0);
  arches(c, [X(0.68), 0, X(-0.68)]);
  const sorted = [...c.mounts].sort((a, q) => q.x - a.x);
  const front = sorted[0];
  return {
    deckAt: H.deck, top: dk(0) + 0.06, custom: true, dressed: true,
    seat: (m) => {
      const base = dk(m.x, m.z);
      if (m === front) return { y: ringSeat(b, kit, m, base, 0.022, 14), socket: true };
      // rear remote weapon station on a short armoured pedestal
      const y = base + 0.05;
      b.g(new THREE.CylinderGeometry(m.r * 0.8, m.r * 1.0, 0.05, 8), kit.armor2, mtx([m.x, base + 0.025, m.z]));
      return { y: ringSeat(b, kit, m, y, 0.012, 10, kit.mech), socket: true };
    },
  };
}

// ---- aegis: armoured recovery / repair vehicle -----------------------------------------------------------------------------
function aegis(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, S, stance } = c;
  const y0 = stance.y0;
  const u = Math.min(L, W) / 2;
  const fine = fineFor(S);
  keel(c, L * 0.4, 0);
  facetHull(c, kit.mech, [[-0.92 * u, 0, 0.02, 0.1, 0.12, 0.5 * u, 0.6 * u, 0.6 * u], [0.9 * u, 0.04, 0.06, 0.1, 0.12, 0.46 * u, 0.56 * u, 0.56 * u]]);
  // chamfered octagon plan (the 'round' identity), sponsons over the tracks, flat deck, sloped nose and tail
  const st: FSt[] = [
    [-0.98 * u, 0.06, 0.06, 0.2, 0.26, 0.5 * u, 0.62 * u, 0.5 * u],
    [-0.74 * u, 0.04, 0.04, 0.22, 0.32, 0.62 * u, 0.94 * u, 0.78 * u],
    [0.5 * u, 0.04, 0.04, 0.22, 0.32, 0.62 * u, 0.94 * u, 0.78 * u],
    [0.8 * u, 0.05, 0.05, 0.18, 0.24, 0.56 * u, 0.82 * u, 0.62 * u],
    [0.98 * u, 0.07, 0.07, 0.12, 0.14, 0.42 * u, 0.6 * u, 0.4 * u],
  ];
  const H = facetHull(c, kit.armor, st);
  const dk = (x: number, z = 0) => Math.max(y0, H.deck(x, z));
  const deckY = dk(0);
  facePlate(b, kit, kit.armor2, [0.8 * u, y0 + 0.24, 0], [0.5 * u, deckY, 0], ZA, 1.1 * u, 0.016, UP, { standoff: 0.005, gap: 0.012, fill: 0.84 });
  // engineer crosses on the side armour plates (role read), side plates on shadow gaps
  both((s) => {
    const F = facePlate(b, kit, kit.armor2, [-0.1 * u, y0 + 0.22, s * 0.94 * u], [-0.1 * u, deckY, s * 0.78 * u], XA, 0.9 * u, 0.012, [0, 0.5, s], { standoff: 0.004, gap: 0.01, fill: 0.8 });
    const C = sub(F, -0.18 * u, 0.02, 0);
    b.g(new THREE.BoxGeometry(0.16 * u, 0.006, 0.045 * u), kit.accent, C);
    b.g(new THREE.BoxGeometry(0.045 * u, 0.006, 0.16 * u), kit.accent, C);
  });
  // crane jib stowed along the left deck edge: pivot post at the rear, boom forward to a rest on the nose, hook block
  const jz = -0.55 * u, pv: V3 = [-0.72 * u, deckY, jz];
  b.g(new THREE.CylinderGeometry(0.07 * u, 0.09 * u, 0.1 * u, 8), kit.armor2, mtx([pv[0], pv[1] + 0.05 * u, pv[2]]));
  const jt: V3 = [0.82 * u, deckY + 0.12 * u, jz], jb: V3 = [pv[0], deckY + 0.12 * u, jz];
  beam(b, kit.armor2, jb, jt, 0.06 * u, 0.07 * u);
  b.g(new THREE.BoxGeometry(0.16 * u, 0.072 * u, 0.062 * u), kit.hazard, mtx([jt[0] - 0.08 * u, jt[1], jz]));
  beam(b, kit.mech, [jb[0], jb[1] - 0.045 * u, jz], [jt[0] - 0.1 * u, jt[1] - 0.045 * u, jz], 0.04 * u, 0.02 * u);
  piston(b, kit, [pv[0] + 0.12 * u, deckY + 0.02, jz + 0.06 * u], [pv[0] + 0.55 * u, jb[1] - 0.02, jz + 0.04 * u], 0.022 * u, 0.55, fine);
  b.g(new THREE.BoxGeometry(0.06 * u, 0.1 * u, 0.04 * u), kit.mech, mtx([0.62 * u, deckY + 0.05 * u, jz]));
  b.g(bevBox(0.06 * u, 0.07 * u, 0.05 * u, 0.008), kit.hazard, mtx([jt[0] + 0.02 * u, jt[1] - 0.09 * u, jz]));
  b.g(new THREE.TorusGeometry(0.025 * u, 0.008 * u, 4, 8, Math.PI * 1.4), kit.steel, mtx([jt[0] + 0.02 * u, jt[1] - 0.15 * u, jz]));
  // comms dish mast on the right rear (support role), whip antenna
  const dp: V3 = [-0.7 * u, deckY, 0.55 * u];
  b.g(strutGeo(dp, [dp[0], dp[1] + 0.32 * u, dp[2]], 0.025 * u, 0.02 * u, 6), kit.joint);
  dish(b, kit, [dp[0], dp[1] + 0.3 * u, dp[2]], 0.17 * u, 0.4, 0.7, 0.08 * u);
  antenna(b, kit, -0.86 * u, dk(-0.86 * u), 0.3 * u, 0.85 * u, 0.008, [-0.15, 0, 0]);
  // nose: winch drum + cable, tow bar folded on the glacis, caged lamps
  const wx = 0.9 * u, wy = y0 + 0.16;
  b.lathe(kit.joint, [[0, -0.2 * u], [0.06 * u, -0.2 * u], [0.06 * u, 0.2 * u], [0, 0.2 * u]], [wx, wy, 0], 'z', 8);
  b.lathe(kit.mech, [[0, -0.16 * u], [0.068 * u, -0.16 * u], [0.068 * u, 0.16 * u], [0, 0.16 * u]], [wx, wy, 0], 'z', 8);
  both((s) => {
    b.g(bevBox(0.1 * u, 0.12 * u, 0.04 * u, 0.008), kit.armor2, mtx([wx - 0.02 * u, wy, s * 0.22 * u]));
    b.g(strutGeo([0.55 * u, deckY - 0.04 * u, s * 0.08 * u], [0.92 * u, wy + 0.08 * u, 0], 0.012 * u, 0.012 * u, 5), kit.joint);
    cagedLamp(b, kit, frame([0.84 * u, dk(0.84 * u, s * 0.5 * u), s * 0.5 * u], UP, XA), 0.06 * u, fine);
  });
  // rear: spare road wheels on the tail plate, tool bins, exhaust (right)
  for (const s of [-1, 1]) spareWheel(b, kit, [-0.99 * u - 0.03, y0 + 0.17, s * 0.2 * u], '-x', 0.09 * u, 0.05 * u);
  stowBox(b, kit, frame([-0.2 * u, deckY, 0.62 * u], UP, XA), 0.5 * u, 0.06 * u, 0.12 * u);
  exhaustBox(b, kit, frame([-0.9 * u, dk(-0.9 * u, 0.2 * u), 0.15 * u], UP, ZA), 0.035 * u, fine);
  crewHatch(b, kit, frame([0.3 * u, deckY, 0.4 * u], UP), 0.06 * u, fine);
  return {
    deckAt: H.deck, top: deckY + 0.1, custom: true, dressed: true,
    seat: (m) => ({ y: ringSeat(b, kit, m, dk(m.x, m.z), 0.024, 14), socket: true }),
  };
}

registerChassis('wedge', scout);
registerChassis('box', raider);
registerChassis('carriage', carriage);
registerChassis('hunter', hunter);
registerChassis('round', aegis);
void hose;
