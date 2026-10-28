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
//   riot     (riot)     dozer brute: full-width curved dozer blade on push arms + rams, twin guns on a raised rear
//                       casemate, slat cage armour on the flanks, riot light bar, searchlight (right), antenna (left)
//   (striker 'cross' lives in chassis/carriers.ts)
//   aegis    (round)    armoured recovery / repair vehicle: chamfered octagon hull, crane jib stowed along the left
//                       deck with a hook block, comms dish mast (right), winch + tow bar on the nose, engineer crosses
// Hulls work on every mobility: the lower hull is clamped inside the running gear (stance.wi), anything wider starts at
// the fender line (stance.yt); legged stances get a hip keel under the belly.

import * as THREE from 'three';
import type { P2, V3 } from '../geo.ts';
import { bevBox, mtx, strutGeo } from '../geo.ts';
import type { Bld } from '../geo.ts';
import { atlasUV, type Kit, type MatLike } from '../materials.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type MountSpec } from './registry.ts';
import { beam, block, both } from './shapes.ts';
import {
  antenna, armorPlate, cagedLamp, crewHatch, exhaustBox, fineFor, frame, hose, jerryCans, piston, recessPanel, rectP, smokeLaunchers,
  stowBox, sub, towHooks,
} from './hs-kit.ts';
import {
  bullBar, dish, facePlate, grille, facetHull, periscopes, ringSeat, sensorMast, slatCage, spareWheel, wheelArch, type FSt,
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
function carriage(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const y0 = stance.y0;
  const X = (f: number) => f * L, Z = (f: number) => f * W;
  const m = c.mounts[0];
  const mr = m?.r ?? 0.16, mx = m?.x ?? 0;
  keel(c, L * 0.4);
  // cradle / saddle on the axle: dark core box, armour top carriage the turntable sits on
  const cw = Math.min(Z(0.34), stance.wi * 2);
  facetHull(c, kit.mech, [[X(-0.2), 0, 0.01, 0.06, 0.08, cw * 0.4, cw * 0.46, cw * 0.4], [X(0.2), 0.0, 0.01, 0.06, 0.08, cw * 0.4, cw * 0.46, cw * 0.4]]);
  const deckY = y0 + 0.13;
  facetHull(c, kit.armor2, [[mx - mr * 1.25, 0.06, 0.06, 0.1, 0.13, mr * 1.0, mr * 1.15, mr * 1.0], [mx + mr * 1.25, 0.06, 0.06, 0.1, 0.13, mr * 1.0, mr * 1.15, mr * 1.0]], 0, false);
  // equilibrator pistons either side of the cradle (functional: they balance the barrel)
  both((s) => piston(b, kit, [X(-0.17), y0 + 0.04, s * mr * 1.1], [mx + mr * 0.6, deckY - 0.01, s * mr * 1.1], 0.016, 0.55, false));
  // self-propelled mount, not a towed gun: no trails or spades. A short box-section spine runs back from the cradle to
  // an armoured counterweight bustle (balances the barrel), with the ready-ammo box strapped to its left side
  beam(b, kit.armor2, [X(-0.12), y0 + 0.06, 0], [X(-0.36), y0 + 0.06, 0], Z(0.16), 0.06);
  const bx = X(-0.42), bw = Math.min(Z(0.4), stance.wi * 2.2);
  b.g(bevBox(X(0.16), 0.1, bw, 0.012), kit.armor2, mtx([bx, y0 + 0.08, 0]));
  b.g(bevBox(X(0.1), 0.02, bw * 0.8, 0.006), kit.mech, mtx([bx, y0 + 0.14, 0]));
  stowBox(b, kit, frame([bx + X(0.02), y0 + 0.08, -bw / 2 - 0.03], UP, XA), 0.09, 0.06, 0.05, kit.canvas);
  // gun shield: centre plate + two raked wings on a dark backing, notched top, sight box on the left wing
  const R = Math.max(mr * 1.55, Z(0.3));
  const sx = mx + R * 0.62, sh = 0.3;
  const shieldPlate = (yaw: number, zc: number, w: number, h: number) => {
    const F = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2 + 0.2)).setPosition(sx - Math.abs(zc) * Math.sin(Math.abs(yaw)) * 0.9, y0 + 0.03 + h / 2, zc);
    // after rotZ the plate's local +y faces forward (+x), local x runs down -> poly in (x = height, z = width)
    armorPlate(b, kit, kit.armor, F, [[-h / 2, -w / 2], [h / 2 - 0.03, -w / 2], [h / 2, -w / 2 + 0.03], [h / 2, w / 2 - 0.03], [h / 2 - 0.03, w / 2], [-h / 2, w / 2]], 0.014, { standoff: 0.004, gap: 0.01 });
  };
  shieldPlate(0, 0, R * 0.95, sh * 0.82);
  both((s) => shieldPlate(-s * 0.55, s * R * 0.72, R * 0.6, sh));
  b.g(bevBox(0.05, 0.035, 0.035, 0.006), kit.armor2, mtx([sx + 0.01, y0 + 0.03 + sh + 0.012, -R * 0.62]));
  b.g(new THREE.BoxGeometry(0.008, 0.016, 0.022), kit.glass, mtx([sx + 0.036, y0 + 0.03 + sh + 0.014, -R * 0.62]));
  cbox(b, kit.accent, 0.004, 0.02, R * 0.4, sx + 0.04, y0 + 0.03 + sh * 0.68, R * 0.22, 0, [0, 0, 0.2]);
  return {
    deckAt: (x, z) => (Math.hypot(x - mx, z) < mr * 1.15 ? deckY : -1), top: deckY + 0.02, custom: true, dressed: true,
    seat: (mm) => ({ y: ringSeat(b, kit, mm, deckY, 0.02, 12), socket: true }),
  };
}

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

// ---- riot: dozer brute -------------------------------------------------------------------------------------------------------
function riot(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, S, stance } = c;
  const y0 = stance.y0;
  const X = (f: number) => (f * L) / 2, Z = (f: number) => (f * W) / 3; // authored at L=2, W=3
  const fine = fineFor(S);
  keel(c, L * 0.5, -L * 0.1);
  facetHull(c, kit.mech, [[X(-0.96), 0, 0.02, 0.1, 0.12, Z(0.85), Z(0.95), Z(0.95)], [X(0.9), 0.04, 0.06, 0.1, 0.12, Z(0.8), Z(0.9), Z(0.9)]]);
  // wide low hull with sponsons over the tracks, sloped front plate
  const st: FSt[] = [
    [X(-1.0), 0.06, 0.06, 0.2, 0.28, Z(0.9), Z(1.36), Z(1.12)],
    [X(-0.86), 0.04, 0.04, 0.22, 0.33, Z(0.92), Z(1.42), Z(1.2)],
    [X(0.42), 0.04, 0.04, 0.22, 0.33, Z(0.92), Z(1.42), Z(1.2)],
    [X(0.86), 0.06, 0.06, 0.18, 0.2, Z(0.9), Z(1.38), Z(1.12)],
  ];
  const H = facetHull(c, kit.armor, st);
  const dk = (x: number, z = 0) => Math.max(y0, H.deck(x, z));
  const deckY = dk(0);
  facePlate(b, kit, kit.armor2, [X(0.86), y0 + 0.2, 0], [X(0.42), deckY, 0], ZA, Z(2.2), 0.018, UP, { standoff: 0.006, gap: 0.014, fill: 0.86 });
  // raised rear casemate carrying the twin guns: vertical band, sloped front, flat roof
  const mz = Math.max(...c.mounts.map((m) => Math.abs(m.z)), Z(0.45));
  const cw = mz + Z(0.32);
  const C = facetHull(c, kit.armor, [
    [X(-0.84), 0.32, 0.32, 0.39, 0.44, cw * 0.95, cw, cw * 0.92],
    [X(-0.02), 0.32, 0.32, 0.39, 0.44, cw * 0.95, cw, cw * 0.92],
    [X(0.2), 0.32, 0.32, 0.34, 0.36, cw * 0.9, cw * 0.95, cw * 0.82],
  ], 0, false);
  const roof = y0 + 0.44;
  facePlate(b, kit, kit.armor2, [X(0.2), y0 + 0.36, 0], [X(-0.02), roof, 0], ZA, cw * 1.6, 0.014, [1, 0.6, 0], { standoff: 0.005, gap: 0.01, fill: 0.8 });
  // riot light bar across the casemate front (four caged lamps)
  for (const f of [-0.6, -0.2, 0.2, 0.6]) cagedLamp(b, kit, frame([X(0.06), roof, f * cw * 0.8], UP, XA), 0.045, fine);
  // the dozer blade: full width, curved in plan, leaning back, steel cutting edge, ribs behind, push arms + rams
  const half = Z(1.5), n = 6, bh = (y0 + 0.22) * 1.25;
  const pts: P2[] = [];
  for (let i = 0; i <= n; i++) { const z = -half + (2 * half * i) / n; pts.push([X(1.12) - X(0.3) * (z / half) ** 2, z]); }
  for (let i = 0; i < n; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const M = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationZ(0.22)).setPosition(cx, 0.03 + bh / 2, cz);
    b.g(bevBox(0.035, bh, len * 1.02, 0.008), kit.armor2, M);
    b.g(new THREE.BoxGeometry(0.03, 0.035, len * 1.0), kit.steel, M.clone().multiply(new THREE.Matrix4().makeTranslation(0.012, -bh / 2 + 0.01, 0)));
    b.g(new THREE.BoxGeometry(0.045, bh * 0.8, 0.02), kit.mech, M.clone().multiply(new THREE.Matrix4().makeTranslation(-0.03, 0, len * 0.4)));
    if (i === 1 || i === 4) b.g(new THREE.BoxGeometry(0.008, 0.04, len * 0.7), kit.hazard, M.clone().multiply(new THREE.Matrix4().makeTranslation(0.02, bh / 2 - 0.03, 0)));
  }
  both((s) => {
    beam(b, kit.mech, [X(1.0), 0.12, s * Z(0.75)], [X(0.4), y0 + 0.05, s * Z(0.9)], 0.06, 0.07);
    piston(b, kit, [X(0.7), y0 + 0.2, s * Z(0.5)], [X(0.98), bh * 0.85, s * Z(0.5)], 0.024, 0.55, fine);
  });
  // slat cage armour off the sponson flanks (the riot look at a distance), searchlight (right), antenna (left)
  both((s) => slatCage(b, kit, frame([X(-0.2), y0 + 0.08, s * (Z(1.42) + 0.06)], [0, 0, s], XA), X(1.1), 0.2, 4, 0.007));
  const sl: V3 = [X(-0.5), roof, cw * 0.7];
  b.g(strutGeo(sl, [sl[0], sl[1] + 0.07, sl[2]], 0.012, 0.012, 6), kit.joint);
  b.g(new THREE.CylinderGeometry(0.04, 0.035, 0.06, 8).rotateZ(-Math.PI / 2), kit.mech, mtx([sl[0], sl[1] + 0.1, sl[2]]));
  b.g(new THREE.CylinderGeometry(0.033, 0.033, 0.01, 8).rotateZ(-Math.PI / 2), kit.lamp, mtx([sl[0] + 0.032, sl[1] + 0.1, sl[2]]));
  antenna(b, kit, X(-0.7), roof, -cw * 0.75, 0.75, 0.007, [-0.15, 0, 0]);
  crewHatch(b, kit, frame([X(-0.6), roof, 0], UP), 0.05, fine);
  // engine deck behind the casemate: louvres, exhaust (right), jerry cans (left)
  grille(b, kit, frame([X(-0.93), dk(X(-0.93)), 0], UP), X(0.1), Z(1.1), 0.015, 3);
  exhaustBox(b, kit, frame([X(-0.92), dk(X(-0.92), Z(1.0)), Z(1.0)], UP, ZA), 0.03, fine);
  jerryCans(b, kit, frame([X(-0.92), dk(X(-0.92), -Z(1.0)), -Z(1.0)], UP), 2, 0.06);
  b.decal(0.16, 0.16, X(0.6), deckY + 0.003, -Z(0.8), atlasUV(1), 0);
  const deck = (x: number, z: number) => Math.max(H.deck(x, z), C.deck(x, z));
  return {
    deckAt: deck, top: roof + 0.04, custom: true, dressed: true,
    seat: (m) => ({ y: ringSeat(b, kit, m, Math.max(roof, deck(m.x, m.z)), 0.025, 14), socket: true }),
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
registerChassis('riot', riot);
registerChassis('round', aegis);
void hose;
