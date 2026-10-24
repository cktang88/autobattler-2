// Tracked / heavy ground hulls. Each class has its own plan shape and height profile (no boxes):
//   warden     'hex'        hard-surface line tank (hs-kit): faceted sponson hull, two-plate glacis, V ram blade on rams,
//                            smoke banks, caged lamps, offset hatch / exhaust / stowage, hs track system.
//   bastion    'fortress'   star fort on four corner track pods: octagonal citadel, two round drum towers (crenellated)
//                            for the rear guns, stepped octagonal keep for the front gun.
//   longarm    'long'       long-necked artillery carriage: hunched rear gun body on a turntable, a long neck sloping
//                            down to a small sensor head, travel-lock fork, rear recoil spades.
//   colossus   'titan'      trimaran assault tank: arched teardrop spine, two bulbous sponson pods carrying the flank
//                            guns, nose barbette, swept tail fins.
//   siegeplat  'siegeplat'  hunched siege platform: thin girder spine, two raised turntables (superfiring rear), four
//                            splayed outrigger jacks, offset cab.
//   juggernaut 'juggernaut' wall of armour, wider than long: chevron shield plan, toothed ram prow, stepped ziggurat
//                            casemate, keep on top.
// Running gear looks per shape live in mobility/tracks.ts (trackStyle). Shape helpers: chassis/tanks-kit.ts.

import * as THREE from 'three';
import { atlasUV } from '../materials.ts';
import { bevBox, type P2, type V3 } from '../geo.ts';
import { HS_NARROW } from '../mobility/tracks.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type MountSpec } from './registry.ts';
import { block, both, collar, exhaust, glow, hazard, pod, sensor, vent, beam } from './shapes.ts';
import { drum, frustum, inPlan, mirrorPlan, ngon, scalePlan, xLoft, xTop, type Sec } from './tanks-kit.ts';
import {
  antenna, armorPlate, cagedLamp, crewHatch, exhaustBox, fineFor, frame, hexSec, hose, jerryCans, piston, recessPanel, rectP,
  smokeLaunchers, spareTrack, stowBox, sub, towHooks, trapP,
} from './hs-kit.ts';

const sc = (p: P2[], kx: number, kz: number): P2[] => p.map(([x, z]) => [x * kx, z * kz]);
const biggest = (ms: MountSpec[]) => ms.reduce<MountSpec | undefined>((a, m) => (!a || m.r > a.r ? m : a), undefined);
const grounded = (c: ChassisCtx) => !c.stance.legs && c.mob.kind !== 'air';

// ---------------------------------------------------------------------------------------------------------------------
function warden(c: ChassisCtx): ChassisOut {
  // Hard-surface line tank (chassis/hs-kit.ts): a low dark belly between the track systems, a faceted upper hull with
  // sponsons over the tracks and a flat engine deck (elongated hex from above: chamfered nose and tail corners), a
  // two-plate upper glacis standing proud on shadow gaps, a separate lower glacis plate, a thin V dozer/ram blade on
  // push arms and two hydraulic rams (the warden's signature), smoke-grenade banks on the sponson fronts, caged
  // headlamps. Asymmetric: driver's hatch + periscopes front-left, exhaust right rear, jerry cans + antenna left rear,
  // tool bins and spare track on the right side only.
  const { b, kit, L, W, stance, S } = c;
  const kx = L / 2, kz = (W / 2) * (HS_NARROW.hex ?? 1), k = Math.min(L / 2, W / 2);
  const fine = fineFor(S);
  const y0 = stance.y0, yt = Math.max(stance.yt, y0 + 0.12 * k);
  const wi = Math.min(stance.wi, 0.66 * kz);
  const ys = yt + 0.03 * k, deck = ys + 0.25 * k;
  // ---- belly (dark structure between the tracks): lower glacis slope at the front, short rear slope
  const belly: [number, number, number][] = [[1.02, ys - 0.06 * k, 0.55], [0.86, y0 + 0.04 * k, 1], [-0.9, y0, 1], [-1.0, y0 + 0.07 * k, 0.9]];
  b.loft(kit.mech, belly.map(([x, yb, f]) => hexSec(x * kx, yb, wi * f * 0.9, wi * f, yb + 0.03 * k, ys - 0.01, wi * f, ys + 0.01)));
  // ---- upper hull: faceted sponson hull (x, sponson half-width, side band height, deck half-width, top y)
  const up: [number, number, number, number, number][] = [
    [1.07, 0.42, 0.04, 0.3, ys + 0.06 * k], [0.86, 0.94, 0.07, 0.68, ys + 0.11 * k], [0.4, 1.0, 0.1, 0.72, deck],
    [-0.74, 1.0, 0.1, 0.72, deck], [-0.95, 0.86, 0.1, 0.6, deck - 0.02 * k], [-1.0, 0.72, 0.09, 0.5, deck - 0.05 * k],
  ];
  b.loft(kit.armor, up.map(([x, ws, hs, wt, ytop]) => hexSec(x * kx, ys, ws * kz, ws * kz, ys, ys + hs * k, wt * kz, ytop)));
  const T = 0.038 * k; // plate thickness
  // ---- upper glacis: two-plate stack on the sloped front
  const g0: V3 = [0.86 * kx, ys + 0.11 * k, 0], g1: V3 = [0.4 * kx, deck, 0];
  const gl = Math.hypot(g1[0] - g0[0], g1[1] - g0[1]);
  const GF = frame([(g0[0] + g1[0]) / 2, (g0[1] + g1[1]) / 2, 0], [g1[1] - g0[1], g0[0] - g1[0], 0], [0, 0, 1]);
  armorPlate(b, kit, kit.armor, GF, trapP(1.36 * kz, gl * 0.9, gl * 0.9, 0.06 * k), T, { standoff: 0.012 * k, gap: 0.03 * k });
  armorPlate(b, kit, kit.armor, sub(GF, 0, 0.012 * k + T, gl * 0.14), rectP(1.1 * kz, gl * 0.46, 0.05 * k), T * 0.9, { standoff: T * 0.45, gap: 0.03 * k });
  // sloped side armour: two plates per shoulder (hull side above the sponson), shadow gap between them
  const sh0 = ys + 0.1 * k;
  both((s) => {
    const a: V3 = [0, sh0, s * 1.0 * kz], e: V3 = [0, deck, s * 0.72 * kz];
    const sl = Math.hypot(e[1] - a[1], e[2] - a[2]);
    const SF = frame([0, (a[1] + e[1]) / 2, (a[2] + e[2]) / 2], [0, Math.abs(e[2] - a[2]), s * (e[1] - a[1])], [1, 0, 0]);
    for (const [x0, x1] of [[0.36, -0.2], [-0.24, -0.72]] as [number, number][]) {
      armorPlate(b, kit, kit.armor2, sub(SF, ((x0 + x1) / 2) * kx, 0, 0), rectP((x0 - x1) * kx - 0.03 * k, sl * 0.8), T * 0.9, { standoff: 0.008 * k, gap: 0.02 * k });
    }
  });
  // spare track links clipped to the right half of the glacis (asymmetric stowage)
  spareTrack(b, kit, sub(GF, 0.42 * kz, 0.012 * k + T * 2.3, gl * 0.12, 0, Math.PI / 2, 0), 3, 0.2 * k, 0.07 * k);
  // ---- lower glacis plate on the belly front
  const l0: V3 = [0.86 * kx, y0 + 0.04 * k, 0], l1: V3 = [1.02 * kx, ys - 0.06 * k, 0];
  const ll = Math.hypot(l1[0] - l0[0], l1[1] - l0[1]);
  const LF = frame([(l0[0] + l1[0]) / 2, (l0[1] + l1[1]) / 2, 0], [l1[1] - l0[1], l0[0] - l1[0], 0], [0, 0, 1]);
  armorPlate(b, kit, kit.armor2, LF, rectP(wi * 1.7, ll * 0.86, 0.03 * k), T, { standoff: 0.01 * k });
  // ---- dozer / ram blade: thin V on push arms and two hydraulic rams
  const bh = ((ys - 0.06 * k) - 0.05 * k) * 0.62, by = 0.05 * k + bh / 2;
  both((s) => {
    const a: P2 = [1.2 * kx, 0], e: P2 = [1.06 * kx, s * 0.9 * kz];
    const len = Math.hypot(e[0] - a[0], e[1] - a[1]), yaw = Math.atan2(-(e[1] - a[1]), e[0] - a[0]);
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition((a[0] + e[0]) / 2, by, (a[1] + e[1]) / 2);
    b.g(bevBox(len, bh, 0.035 * k, 0.008 * k), kit.armor2, m.clone().multiply(new THREE.Matrix4().makeRotationX(s * 0.18)));
    b.g(new THREE.BoxGeometry(len * 0.98, 0.022 * k, 0.04 * k), kit.steel, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, -bh / 2, 0)));
    b.g(new THREE.BoxGeometry(len * 0.5, 0.02 * k, 0.045 * k), kit.hazard, m.clone().multiply(new THREE.Matrix4().makeTranslation(len * 0.2, bh / 2, -0.01 * k)));
    // push arm from the blade back to the belly side, ram from the glacis foot to the blade top
    beam(b, kit.mech, [1.08 * kx, by - bh * 0.1, s * 0.46 * kz], [0.74 * kx, y0 + 0.06 * k, s * wi * 0.92], 0.04 * k, 0.05 * k);
    piston(b, kit, [0.94 * kx, ys - 0.04 * k, s * 0.32 * kz], [1.1 * kx, by + bh * 0.4, s * 0.3 * kz], 0.02 * k, 0.55, fine);
  });
  // ---- sponson fronts: smoke-grenade banks (fire forward-out), caged headlamps on the nose corners
  both((s) => {
    smokeLaunchers(b, kit, frame([0.52 * kx, sh0, s * 0.86 * kz], [0, 1, 0], [Math.cos(0.5), 0, s * Math.sin(0.5)]), 4, 0.026 * k);
    cagedLamp(b, kit, frame([0.92 * kx, ys + 0.06 * k, s * 0.74 * kz], [0, 1, 0], [1, 0, 0]), 0.07 * k, fine);
  });
  // ---- driver's hatch with periscopes (front left)
  const hx = 0.32 * kx, hz = -0.48 * kz;
  crewHatch(b, kit, frame([hx, deck, hz], [0, 1, 0]), 0.075 * k, fine);
  for (const dz of [-0.07, 0, 0.07]) b.g(new THREE.BoxGeometry(0.05 * k, 0.05 * k, 0.06 * k), kit.glass, new THREE.Matrix4().makeRotationY(dz * 3).setPosition(hx + 0.11 * k, deck + 0.025 * k, hz + dz * k));
  // ---- shoulders: tool bins on the right, stowage strap rail + crowbar on the left
  stowBox(b, kit, frame([-0.2 * kx, sh0 + 0.004, 0.93 * kz], [0, 1, 0]), 0.5 * kx, 0.07 * k, 0.1 * kz);
  stowBox(b, kit, frame([-0.66 * kx, sh0 + 0.004, 0.93 * kz], [0, 1, 0]), 0.3 * kx, 0.09 * k, 0.1 * kz, kit.canvas);
  b.g(new THREE.BoxGeometry(0.42 * kx, 0.018 * k, 0.04 * k), kit.steel, new THREE.Matrix4().makeTranslation(-0.3 * kx, deck + 0.012 * k, -0.62 * kz));
  b.g(new THREE.BoxGeometry(0.12 * kx, 0.02 * k, 0.07 * k), kit.joint, new THREE.Matrix4().makeTranslation(-0.06 * kx, deck + 0.012 * k, -0.62 * kz));
  // ---- engine deck: recessed louvred grille, exhaust (right rear only), jerry cans + antenna (left rear)
  recessPanel(b, kit, frame([-0.86 * kx, deck, -0.08 * kz], [0, 1, 0]), 0.2 * kx, 0.56 * kz, 0.03 * k, { slats: 5, frame: kit.armor });
  // engine access plates either side of the S turret (raised, on shadow gaps)
  both((s) => armorPlate(b, kit, kit.armor, frame([-0.48 * kx, deck, s * 0.52 * kz], [0, 1, 0]), rectP(0.36 * kx, 0.22 * kz, 0.03 * k), 0.018 * k, { standoff: 0.006 * k, gap: 0.015 * k }));
  exhaustBox(b, kit, frame([-0.86 * kx, deck, 0.5 * kz], [0, 1, 0], [0, 0, 1]), 0.055 * k, fine);
  jerryCans(b, kit, frame([-0.88 * kx, deck - 0.004 * k, -0.52 * kz], [0, 1, 0]), 2, 0.085 * k);
  antenna(b, kit, -0.7 * kx, deck, -0.64 * kz, 0.7 * k, 0.008 * k, [-0.15, 0, 0]);
  // ---- rear plate: tow hooks and a tow cable looped across it
  const rp: V3 = [-1.0 * kx - 0.004, (ys + deck - 0.06 * k) / 2, 0];
  towHooks(b, kit, frame(rp, [-1, 0, 0], [0, 0, 1]), 0.9 * kz, 0.04 * k);
  if (fine) hose(b, kit, [-1.01 * kx, deck - 0.08 * k, -0.45 * kz], [-1.01 * kx, deck - 0.08 * k, 0.45 * kz], 0.012 * k, 0.12, 6, kit.joint);
  b.decal(0.12 * k, 0.12 * k, -0.18 * kx, deck + 0.003, 0.58 * kz, atlasUV(1), 0);
  const main = biggest(c.mounts);
  const topP = sc(mirrorPlan([[0.4, 0.72], [-0.74, 0.72], [-0.95, 0.6], [-1.0, 0.5]]), kx, kz);
  const outP = sc(mirrorPlan([[1.07, 0.4], [0.86, 0.94], [0.42, 1.0], [-0.72, 1.0], [-0.94, 0.86], [-1.0, 0.72]]), kx, kz);
  const deckFn = (x: number, z: number) => (inPlan(topP, x, z) ? deck : inPlan(outP, x, z) ? ys + 0.07 * k : -1);
  return {
    deckAt: deckFn, top: deck + 0.1 * k, custom: true,
    seat: (m) => {
      // low armoured turret-ring guard flush on the deck (no plinth: the turret sits low, like a real MBT)
      const big = m === main, y = deck + (big ? 0.03 : 0.04) * k;
      b.lathe(kit.armor2, [[0, 0], [m.r * 1.32, 0], [m.r * 1.3, y - deck - 0.01 * k], [m.r * 1.18, y - deck], [0, y - deck]], [m.x, deck - 0.005, m.z], 'y', big ? 18 : 14);
      collar(b, kit, m.x, y, m.z, m.r, y - 0.02 * k, big ? 18 : 14);
      return { y, socket: true };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
function bastion(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const kx = L / 3, kz = W / 3, k = Math.min(kx, kz);
  const y0 = stance.y0, yt = Math.max(stance.yt, y0 + 0.15 * k);
  // belly octagon between the pods, then the octagonal citadel (flats fore/aft/sides) overhanging them
  frustum(b, kit.trim, ngon(8, 1.25 * kx, Math.min(stance.wi, 1.2 * kz), Math.PI / 8), y0, yt - y0 + 0.02, { bev: 0.03 });
  const cit = ngon(8, 1.5 * kx, 1.4 * kz, Math.PI / 8);
  const hC = 0.36 * k, cy = yt - 0.04 * k;
  frustum(b, kit.hull, cit, cy, hC, { top: [0.84, 0.84], bot: 0.04 * k, bev: 0.05 * k, mid: [[0.35, 0.98, 0.98]] });
  const deckY = cy + hC;
  // armour skirt band around the citadel's lower edge, lighter paint
  frustum(b, kit.panel, ngon(8, 1.56 * kx, 1.46 * kz, Math.PI / 8), cy + 0.03 * k, 0.1 * k, { top: [0.98, 0.98], bev: 0.03 * k });
  // glacis facets: hazard chevrons, lamps
  both((s) => {
    hazard(b, kit, 1.18 * kx, cy + hC * 0.6, s * 0.36 * kz, 0.36 * kx, 0.12 * kz, 4, s * 0.4);
    b.box(kit.lamp, 0.03 * k, 0.06 * k, 0.12 * k, 1.42 * kx, cy + hC * 0.32, s * 0.36 * kz, 0.012);
    exhaust(b, kit, -1.18 * kx, deckY - 0.08 * k, s * 0.22 * kz, 0.07 * k, 0.18 * k);
  });
  vent(b, kit, -0.95 * kx, deckY - 0.005, 0, 0.2 * kx, 0.36 * kz, 3, 'x');
  const sorted = [...c.mounts].sort((a, q) => q.x - a.x);
  const front = sorted[0];
  const fx = front?.x ?? 0.16 * kx;
  // stepped octagonal keep for the front gun + a sloped mantlet brow with a glowing vision slit
  const keepY = deckY + 0.2 * k;
  frustum(b, kit.hull, ngon(8, 0.66 * k, 0.62 * k, Math.PI / 8, fx, 0), deckY - 0.02 * k, 0.12 * k, { top: [0.92, 0.92], bev: 0.03 * k });
  frustum(b, kit.panel, ngon(8, 0.54 * k, 0.5 * k, Math.PI / 8, fx, 0), deckY + 0.09 * k, keepY - deckY - 0.09 * k, { top: [0.9, 0.9], bev: 0.025 * k });
  glow(b, kit, fx + 0.6 * k, deckY + 0.06 * k, 0, 0.03 * k, 0.035 * k, 0.42 * k, [0, 0, -0.5]);
  // rear drum towers: tall round bastions with merlons around the rim
  const towerY = deckY + 0.24 * k;
  const towers = sorted.slice(1);
  const towerAt: [number, number][] = towers.length ? towers.map((m) => [m.x, m.z]) : [[-0.64 * kx, -0.66 * kz], [-0.64 * kx, 0.66 * kz]];
  towerAt.forEach(([x, z], i) => {
    const r = Math.max(towers[i]?.r ?? 0.24 * k, 0.24 * k) * 1.45;
    drum(b, kit.hull, x, z, r, deckY - 0.1 * k, towerY, 16, 1.1);
    b.lathe(kit.panel, [[r * 1.02, 0], [r * 1.08, 0], [r * 1.08, 0.05 * k], [r * 1.02, 0.05 * k]], [x, towerY - 0.1 * k, z], 'y', 16);
    for (let j = 0; j < 6; j++) {
      const a = (j / 6) * Math.PI * 2 + 0.26;
      b.box(kit.hull, 0.08 * k, 0.06 * k, 0.07 * k, x + Math.cos(a) * r * 0.94, towerY + 0.025 * k, z + Math.sin(a) * r * 0.94, 0.012 * k, [0, -a, 0]);
    }
  });
  b.decal(0.24 * k, 0.24 * k, 0.6 * kx, deckY + 0.004, 0.62 * kz, atlasUV(1), 0);
  const topP = scalePlan(cit, 0.8, 0.8);
  const deck = (x: number, z: number) => (inPlan(topP, x, z) ? deckY : inPlan(cit, x, z) ? cy + hC * 0.5 : -1);
  return {
    deckAt: deck, top: keepY, custom: true,
    seat: (m) => {
      const y = m === front ? keepY : towerY;
      collar(b, kit, m.x, y, m.z, m.r, y - 0.04 * k, m === front ? 20 : 16);
      return { y, socket: true };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
function longarm(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const kx = L / 3, kz = W, k = Math.min(kx, kz);
  const y0 = stance.y0, yt = Math.max(stance.yt, y0 + 0.12 * k);
  const main = biggest(c.mounts);
  const mx = main?.x ?? -0.51 * kx, mr = main?.r ?? 0.22 * k;
  // hunched gun body: round-shouldered, highest over the turntable, tucked tail
  const body: Sec[] = [
    { x: -1.47 * kx, hw: 0.3 * kz, yb: y0, yt: yt + 0.1 * k, crown: 0.5 },
    { x: -1.36 * kx, hw: 0.42 * kz, yb: y0, yt: yt + 0.24 * k, crown: 0.62 },
    { x: mx - 0.3 * kx, hw: 0.47 * kz, yb: y0, yt: yt + 0.3 * k, crown: 0.66 },
    { x: mx + 0.42 * kx, hw: 0.44 * kz, yb: y0, yt: yt + 0.28 * k, crown: 0.62 },
    { x: 0.12 * kx, hw: 0.26 * kz, yb: y0 + 0.04 * k, yt: yt + 0.14 * k, crown: 0.55 },
  ];
  xLoft(b, kit.hull, body);
  const bodyY = xTop(body, mx, 0);
  // the neck: long, narrow, sloping down to a low sensor head
  const neck: Sec[] = [
    { x: 0.0, hw: 0.2 * kz, yb: y0 + 0.04 * k, yt: yt + 0.12 * k, crown: 0.55, belly: 0.7 },
    { x: 0.7 * kx, hw: 0.15 * kz, yb: y0 + 0.06 * k, yt: yt + 0.03 * k, crown: 0.5, belly: 0.7 },
    { x: 1.32 * kx, hw: 0.12 * kz, yb: y0 + 0.08 * k, yt: yt - 0.04 * k, crown: 0.5, belly: 0.7 },
  ];
  xLoft(b, kit.panel, neck);
  // spine ridge on the neck in hull paint, glow strip down its length
  beam(b, kit.hull, [0.05 * kx, yt + 0.12 * k, 0], [1.25 * kx, yt - 0.03 * k, 0], 0.12 * kz, 0.04 * k);
  glow(b, kit, 0.66 * kx, yt + 0.05 * k, 0.1 * kz, 0.9 * kx, 0.02 * k, 0.02 * k, [0, 0, -0.12]);
  // sensor head: offset to the left of the barrel line, glowing eye, little dish ear
  const hx = 1.38 * kx, hy = yt + 0.02 * k, hz = -0.08 * kz;
  block(b, kit.hull, hx, hy - 0.06 * k, hz, 0.26 * kx, 0.22 * kz, 0.15 * k, { top: [0.7, 0.8], shift: [0.03 * kx, 0], ch: 0.05 * k, bev: 0.03 * k });
  b.cyl(kit.glow, 0.045 * k, 0.045 * k, 0.03 * k, [hx + 0.13 * kx, hy + 0.02 * k, hz], 'x', 10);
  b.cyl(kit.trim, 0.06 * k, 0.06 * k, 0.02 * k, [hx + 0.12 * kx, hy + 0.02 * k, hz], 'x', 10);
  b.lathe(kit.panel, [[0, 0], [0.07 * k, 0.04 * k], [0.072 * k, 0.05 * k], [0, 0.015 * k]], [hx - 0.04 * kx, hy + 0.1 * k, hz - 0.08 * kz], 'y', 10, [0.5, 0, -0.5]);
  // spade/stabilizer blade under the nose
  block(b, kit.trim, 1.38 * kx, y0 - 0.04 * k, 0, 0.1 * kx, 0.4 * kz, 0.16 * k, { top: [0.6, 1], shift: [0.04 * kx, 0], ch: 0.03 * k });
  // travel-lock fork, folded down along the neck (a cradle the barrel drops into)
  const fx = 0.78 * kx, fy = xTop(neck, fx, 0);
  both((s) => beam(b, kit.metal, [fx - 0.05 * kx, fy, s * 0.07 * kz], [fx + 0.04 * kx, fy + 0.16 * k, s * 0.1 * kz], 0.035 * k, 0.035 * k));
  b.box(kit.hazard, 0.05 * k, 0.03 * k, 0.24 * kz, fx + 0.04 * kx, fy + 0.16 * k, 0, 0.008);
  // rear recoil spades: hydraulic arms to ground pads (raised when walking)
  const g = grounded(c);
  both((s) => {
    const a: V3 = [-1.34 * kx, yt + 0.02 * k, s * 0.3 * kz];
    const e: V3 = g ? [-1.72 * kx, 0.06 * k, s * 0.4 * kz] : [-1.66 * kx, yt + 0.2 * k, s * 0.36 * kz];
    beam(b, kit.metal, a, e, 0.07 * k, 0.07 * k);
    beam(b, kit.steel, a, [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2, (a[2] + e[2]) / 2], 0.045 * k, 0.045 * k, [0, 0, 1]);
    block(b, kit.hull, e[0], e[1] - 0.05 * k, e[2], 0.12 * kx, 0.2 * kz, 0.12 * k, { top: [0.4, 0.9], shift: [-0.04 * kx, 0], ch: 0.03 * k });
    b.box(kit.lamp, 0.02 * k, 0.03 * k, 0.05 * k, 0.1 * kx, yt + 0.06 * k, s * 0.2 * kz, 0.006);
  });
  vent(b, kit, -1.1 * kx, xTop(body, -1.1 * kx, 0) - 0.004, 0, 0.18 * kx, 0.3 * kz, 3, 'x');
  const deck = (x: number, z: number) => Math.max(xTop(body, x, z), xTop(neck, x, z));
  return {
    deckAt: deck, top: bodyY + 0.12 * k, custom: true,
    seat: (m) => {
      // raised turntable drum over the body hump
      const y = deck(m.x, m.z) + 0.09 * k;
      drum(b, kit.panel, m.x, m.z, m.r * 1.32, deck(m.x, m.z) - 0.06 * k, y - 0.02 * k, 16, 1.0);
      collar(b, kit, m.x, y, m.z, m.r, y - 0.05 * k, 18);
      void mr;
      return { y, socket: true };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
function colossus(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const kx = L / 4, kz = W / 3, k = Math.min(kx, kz);
  const y0 = stance.y0, yt = Math.max(stance.yt, y0 + 0.15 * k);
  // arched teardrop spine
  const sp: Sec[] = [
    { x: -1.98 * kx, hw: 0.38 * kz, yb: y0 + 0.04, yt: yt + 0.22 * k, crown: 0.5 },
    { x: -1.75 * kx, hw: 0.58 * kz, yb: y0, yt: yt + 0.34 * k, crown: 0.62 },
    { x: -0.7 * kx, hw: 0.74 * kz, yb: y0, yt: yt + 0.5 * k, crown: 0.62 },
    { x: 0.5 * kx, hw: 0.74 * kz, yb: y0, yt: yt + 0.52 * k, crown: 0.6 },
    { x: 1.3 * kx, hw: 0.6 * kz, yb: y0, yt: yt + 0.38 * k, crown: 0.6 },
    { x: 1.8 * kx, hw: 0.46 * kz, yb: y0 + 0.04, yt: yt + 0.3 * k, crown: 0.55 },
    { x: 2.0 * kx, hw: 0.26 * kz, yb: y0 + 0.1, yt: yt + 0.16 * k, crown: 0.45 },
  ];
  xLoft(b, kit.hull, sp);
  // lighter dorsal armour plate along the arch
  const dor: Sec[] = sp.slice(1, 5).map((s) => ({ ...s, hw: s.hw * 0.42, yb: s.yt - 0.12 * k, yt: s.yt + 0.035 * k, crown: 0.75, belly: 1 }));
  xLoft(b, kit.panel, dor);
  // sponson pods for the flank guns, joined to the spine by sloped wing roots
  const side = c.mounts.filter((m) => Math.abs(m.z) > 0.4 * kz);
  const sz = side.length ? Math.abs(side[0].z) : 0.9 * kz, sx = side.length ? side[0].x : 0.08 * kx;
  const pr = 0.24 * k, pY = yt + 0.12 * k;
  both((s) => {
    pod(b, kit.hull, [sx - 0.05 * kx, pY, s * (sz + 0.05 * kz)], 0.95 * kx, pr, 0.46 * kz, 12, 6, 2.6, 0.45);
    block(b, kit.hull, sx - 0.1 * kx, yt - 0.02 * k, s * (sz * 0.6), 1.1 * kx, 0.5 * kz, 0.22 * k, { top: [0.8, 0.7], shift: [0, -s * 0.08 * kz], ch: 0.1 * k, bev: 0.04 * k });
    glow(b, kit, sx + 0.55 * kx, pY, s * (sz + 0.05 * kz), 0.2 * kx, 0.03 * k, 0.28 * kz, [0, 0, -0.9]);
    b.box(kit.lamp, 0.03 * k, 0.05 * k, 0.08 * k, sx + 0.9 * kx, pY - 0.04 * k, s * (sz + 0.18 * kz), 0.01);
    // swept tail fins
    b.slab(kit.panel, [[0, 0], [0.42 * kx, 0], [0.1 * kx, -0.34 * k], [-0.12 * kx, -0.34 * k]], 0.05 * k, 0.012 * k, -1.62 * kx, yt + 0.32 * k, s * 0.34 * kz, [Math.PI / 2 - s * 0.35, 0, 0]);
    exhaust(b, kit, -1.82 * kx, xTop(sp, -1.82 * kx, 0) - 0.06 * k, s * 0.16 * kz, 0.06 * k, 0.1 * k);
  });
  // nose: cow-catcher wedge and a glowing visor slit under the barbette
  block(b, kit.trim, 1.9 * kx, y0 - 0.06 * k, 0, 0.32 * kx, 0.8 * kz, (yt - y0) + 0.06 * k, { top: [0.4, 0.9], shift: [0.1 * kx, 0], ch: 0.06 * k });
  glow(b, kit, 1.86 * kx, yt + 0.14 * k, 0, 0.03 * k, 0.04 * k, 0.5 * kz, [0, 0, -0.7]);
  vent(b, kit, -1.0 * kx, xTop(sp, -1.0 * kx, 0) + 0.03 * k, 0, 0.3 * kx, 0.36 * kz, 3, 'x');
  b.decal(0.26 * k, 0.26 * k, 0.9 * kx, xTop(sp, 0.9 * kx, 0.4 * kz) + 0.004, 0.4 * kz, atlasUV(1), 0);
  const deck = (x: number, z: number) => {
    const s = xTop(sp, x, z);
    const dz = (Math.abs(z) - sz) / (0.46 * kz), dx = (x - sx) / (0.95 * kx);
    return dx * dx + dz * dz < 1 ? Math.max(s, pY + pr) : s;
  };
  return {
    deckAt: deck, top: yt + 0.6 * k, custom: true,
    seat: (m) => {
      if (Math.abs(m.z) > 0.4 * kz) { const y = pY + pr * 0.92; collar(b, kit, m.x, y, m.z, m.r, y - 0.06 * k, 18); return { y, socket: true }; }
      const t = Math.max(0, xTop(sp, m.x, m.z));
      const y = t + 0.08 * k;
      drum(b, kit.hull, m.x, m.z, m.r * 1.28, t - 0.12 * k, y - 0.02 * k, 16, 1.0);
      collar(b, kit, m.x, y, m.z, m.r, y - 0.04 * k, 18);
      return { y, socket: true };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
function siegeplat(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const kx = L / 4, kz = W / 2, k = Math.min(kx, kz);
  const y0 = stance.y0, yt = Math.max(stance.yt, y0 + 0.12 * k);
  // belly + thin girder spine deck
  frustum(b, kit.trim, sc(mirrorPlan([[1.85, 0.3], [1.6, Math.min(stance.wi, 0.6)], [-1.7, Math.min(stance.wi, 0.6)], [-1.88, 0.3]]), kx, 1), y0, yt - y0, { bev: 0.03 });
  const spine = sc(mirrorPlan([[1.98, 0.22], [1.7, 0.5], [-1.75, 0.5], [-1.96, 0.3]]), kx, kz);
  const dY = yt + 0.1 * k;
  frustum(b, kit.hull, spine, yt - 0.04 * k, dY - yt + 0.04 * k, { top: [0.97, 0.9], bev: 0.03 * k, bot: 0.02 * k });
  // catwalk rails
  both((s) => {
    b.box(kit.metal, 2.7 * kx, 0.025 * k, 0.025 * k, 0.05 * kx, dY + 0.1 * k, s * 0.46 * kz, 0.006);
    for (let i = 0; i < 6; i++) b.box(kit.metal, 0.02 * k, 0.1 * k, 0.02 * k, (-1.3 + i * 0.54) * kx, dY + 0.05 * k, s * 0.46 * kz, 0.004);
  });
  // offset cab at the front left, rangefinder at the front right
  block(b, kit.hull, 1.6 * kx, dY - 0.02 * k, -0.25 * kz, 0.42 * kx, 0.36 * kz, 0.2 * k, { top: [0.7, 0.86], shift: [-0.05 * kx, 0], ch: 0.06 * k, bev: 0.03 * k });
  b.box(kit.glass, 0.05 * k, 0.07 * k, 0.28 * kz, 1.77 * kx, dY + 0.11 * k, -0.25 * kz, 0.01, [0, 0, -0.5]);
  sensor(b, kit, 1.8 * kx, dY + 0.06 * k, 0.3 * kz, 0.1 * k);
  hazard(b, kit, 1.9 * kx, dY + 0.005, 0.12 * kz, 0.1 * kx, 0.3 * kz, 2, Math.PI / 2);
  // ammo hoppers at the tail
  both((s) => b.cylb(kit.panel, 0.12 * k, 0.2 * k, 0.03 * k, [-1.75 * kx, dY - 0.01, s * 0.26 * kz], 'y', 10));
  const sorted = [...c.mounts].sort((a, q) => q.x - a.x);
  const front = sorted[0], rear = sorted[1];
  const pedH = (m: MountSpec) => (m === rear ? 0.36 * k : 0.2 * k);
  // outrigger jacks: four splayed arms from the deck corners to big ground pads (stowed when walking)
  const g = grounded(c);
  for (const fx of [1.3, -1.3]) both((s) => {
    const a: V3 = [fx * kx, dY - 0.02 * k, s * 0.42 * kz];
    const e: V3 = g ? [(fx + Math.sign(fx) * 0.5) * kx, 0.05 * k, s * 1.28 * kz] : [(fx + Math.sign(fx) * 0.25) * kx, dY + 0.05 * k, s * 0.86 * kz];
    beam(b, kit.hull, a, e, 0.1 * k, 0.08 * k);
    beam(b, kit.steel, [a[0], a[1] + 0.06 * k, a[2]], [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2 + 0.07 * k, (a[2] + e[2]) / 2], 0.04 * k, 0.04 * k);
    if (g) {
      b.lathe(kit.metal, [[0, 0], [0.21 * k, 0], [0.2 * k, 0.05 * k], [0.08 * k, 0.09 * k], [0, 0.09 * k]], [e[0], 0, e[2]], 'y', 10);
      b.box(kit.hazard, 0.04 * k, 0.05 * k, 0.12 * k, e[0], e[1] + 0.06 * k, e[2], 0.01, [0, Math.atan2(e[2] - a[2], e[0] - a[0]), 0]);
    }
    b.box(kit.trim, 0.2 * k, 0.12 * k, 0.16 * k, a[0], a[1], a[2], 0.02 * k);
  });
  const deck = (x: number, z: number) => (inPlan(spine, x, z) ? dY : -1);
  return {
    deckAt: deck, top: dY + 0.4 * k, custom: true,
    seat: (m) => {
      // hunched turntable pedestal on hydraulic rams (rear one taller: superfiring over the front gun)
      const h = pedH(m), y = dY + h;
      drum(b, kit.hull, m.x, m.z, m.r * 1.5, dY - 0.02 * k, dY + 0.07 * k, 16, 1.04);
      b.cylb(kit.metal, m.r * 0.9, h - 0.08 * k, 0.02 * k, [m.x, dY + 0.05 * k, m.z], 'y', 12);
      both((s) => beam(b, kit.steel, [m.x - 0.25 * k, dY + 0.05 * k, m.z + s * m.r * 1.1], [m.x, y - 0.05 * k, m.z + s * m.r * 0.6], 0.035 * k, 0.035 * k));
      drum(b, kit.panel, m.x, m.z, m.r * 1.22, y - 0.09 * k, y - 0.02 * k, 16, 1.0);
      collar(b, kit, m.x, y, m.z, m.r, y - 0.05 * k, 18);
      void front;
      return { y, socket: true };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
function juggernaut(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const kx = L / 3, kz = W / 4, k = Math.min(kx, kz);
  const y0 = stance.y0, yt = Math.max(stance.yt, y0 + 0.15 * k);
  frustum(b, kit.trim, sc(mirrorPlan([[1.3, 0.5], [1.0, Math.min(stance.wi, 1.5)], [-1.3, Math.min(stance.wi, 1.5)], [-1.45, 1.0]]), kx, 1), y0, yt - y0 + 0.02, { bev: 0.03 });
  // tier 1: chevron shield hull, wider than long
  const t1 = sc(mirrorPlan([[1.52, 0.3], [0.45, 1.98], [-0.95, 1.98], [-1.48, 1.1]]), kx, kz);
  const h1 = 0.4 * k, y1 = yt - 0.06 * k;
  frustum(b, kit.hull, t1, y1, h1, { top: [0.9, 0.93], shift: [-0.06 * kx, 0], bot: 0.05 * k, bev: 0.05 * k });
  const d1 = y1 + h1;
  // tier 2: stepped casemate, set back
  const t2 = sc(mirrorPlan([[0.74, 0.26], [0.05, 1.4], [-0.85, 1.4], [-1.3, 0.8]]), kx, kz);
  const h2 = 0.3 * k;
  frustum(b, kit.trim, scalePlan(t2, 1.04, 1.03), d1 - 0.03 * k, 0.07 * k, { top: [0.99, 0.99], bev: 0.015 * k });
  frustum(b, kit.hull, t2, d1 + 0.02 * k, h2 - 0.02 * k, { top: [0.86, 0.88], shift: [-0.06 * kx, 0], bev: 0.04 * k, mid: [[0.3, 0.98, 0.99]] });
  frustum(b, kit.panel, scalePlan(t2, 0.8, 0.8, -0.06 * kx, 0), d1 + h2 - 0.02 * k, 0.04 * k, { top: [0.96, 0.96], bev: 0.012 * k });
  const d2 = d1 + h2 + 0.02 * k;
  // tier 3: hex keep for the main gun
  const main = biggest(c.mounts);
  const mx = main?.x ?? -0.42 * kx, mz = main?.z ?? 0;
  const keepY = d2 + 0.2 * k;
  frustum(b, kit.hull, ngon(6, 0.62 * k, 0.66 * k, 0, mx, mz), d2 - 0.03 * k, keepY - d2 + 0.03 * k, { top: [0.86, 0.86], bev: 0.03 * k });
  // toothed ram prow: a thick chevron blade low across the front, three spikes, hazard edge
  b.slab(kit.panel, sc([[1.74, 0], [0.62, 2.0], [0.44, 2.0], [1.55, 0], [0.44, -2.0], [0.62, -2.0]], kx, kz), (yt - y0) + 0.14 * k, 0.03 * k, 0, y0 - 0.04 * k, 0);
  for (const z of [-0.95, 0, 0.95]) {
    const x = (z === 0 ? 1.74 : 1.2) * kx;
    b.cyl(kit.steel, 0.09 * k, 0.005, 0.2 * k, [x - 0.02 * kx, y0 + (yt - y0) * 0.5, z * kz], 'x', 8);
  }
  both((s) => {
    hazard(b, kit, 1.33 * kx, yt + 0.11 * k, s * 0.6 * kz, 0.6 * kx, 0.1 * kz, 4, s * 1.06);
    // brow vision slit on the casemate front facets
    glow(b, kit, 0.4 * kx, d1 + h2 * 0.5, s * 0.75 * kz, 0.03 * k, 0.04 * k, 0.7 * kz, [0, s * 1.2, -0.5]);
    b.box(kit.lamp, 0.03 * k, 0.06 * k, 0.12 * k, 0.86 * kx, y1 + h1 * 0.45, s * 1.25 * kz, 0.012, [0, s * 1.0, 0]);
    // armour bolsters on the tier-1 shoulders
    block(b, kit.hull, -0.3 * kx, d1 - 0.02 * k, s * 1.7 * kz, 0.9 * kx, 0.22 * kz, 0.12 * k, { top: [0.9, 0.6], shift: [0, -s * 0.04 * kz], ch: 0.05 * k, bev: 0.03 * k });
    exhaust(b, kit, -1.3 * kx, d1 - 0.04 * k, s * 0.5 * kz, 0.07 * k, 0.16 * k);
  });
  vent(b, kit, -1.18 * kx, d1 - 0.005, -0.1 * kz, 0.16 * kx, 0.5 * kz, 3, 'x');
  b.decal(0.3 * k, 0.3 * k, 0.1 * kx, d2 + 0.004, -0.75 * kz, atlasUV(1), 0);
  const t2top = scalePlan(t2, 0.86, 0.88, -0.05 * kx, 0);
  const deck = (x: number, z: number) => (inPlan(t2top, x, z) ? d2 : inPlan(t1, x, z) ? d1 : -1);
  return {
    deckAt: deck, top: keepY, custom: true,
    seat: (m) => {
      if (m === main) { collar(b, kit, m.x, keepY, m.z, m.r, keepY - 0.05 * k, 20); return { y: keepY, socket: true }; }
      const base = Math.max(0, deck(m.x, m.z)), y = base + 0.08 * k;
      frustum(b, kit.hull, ngon(6, m.r * 1.5, m.r * 1.5, 0, m.x, m.z), base - 0.03 * k, y - base + 0.03 * k, { top: [0.86, 0.86], bev: 0.02 * k });
      collar(b, kit, m.x, y, m.z, m.r, y - 0.04 * k, 14);
      return { y, socket: true };
    },
  };
}

registerChassis('hex', warden);
registerChassis('fortress', bastion);
registerChassis(['long', 'longarm'], longarm);
registerChassis('colossus', colossus);
registerChassis('siegeplat', siegeplat);
registerChassis('juggernaut', juggernaut);
