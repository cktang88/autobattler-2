// Tracked / heavy ground hulls, all in the hard-surface style (chassis/hs-kit.ts + hs-kit-vehicles.ts): a dark
// structural belly, faceted armour lofts / frustums (flat decks, sharp shoulders), separate thick plates on shadow gaps,
// functional parts in named slots and 2-3 one-sided features per hull. Each class keeps its own plan shape:
//   warden     'hex'        line tank (the reference build): faceted sponson hull, two-plate glacis, V ram blade on rams,
//                            smoke banks, caged lamps, offset hatch / exhaust / stowage, hs track system.
//   bastion    'fortress'   fortress tank on four corner track pods: octagonal citadel with a plate per facet, stepped
//                            octagonal keep for the front gun, two faceted barbettes for the rear guns, rear ladder.
//   longarm    'long'       self-propelled gun: faceted gun casemate over the rear tracks, long low forward hull, travel
//                            lock A-frame, hydraulic recoil spades, driver's cab front-left.
//   colossus   'titan'      multi-turret heavy tank: long central hull, two armoured side casemates over the outer tracks,
//                            nose barbette, rear MG cupola, handrails and a ladder.
//   siegeplat  'siegeplat'  siege platform: girder spine with lattice side girders, two pedestals on rams fed by ammo
//                            hoses, four hydraulic outrigger jacks, crew cab front-left, fire-control mast front-right.
//   juggernaut 'juggernaut' breaching casemate, wider than long: chevron hull, frontal plate stacks + ERA, set-back
//                            casemate, hex keep, full-width toothed mine plough on push arms and rams.
// Running gear looks per shape live in mobility/tracks.ts (trackStyle). Shape helpers: chassis/tanks-kit.ts.

import * as THREE from 'three';
import { atlasUV } from '../materials.ts';
import { bevBox, type P2, type V3 } from '../geo.ts';
import { HS_NARROW } from '../mobility/tracks.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type MountSpec } from './registry.ts';
import { both, collar, beam, block } from './shapes.ts';
import { frustum, inPlan, mirrorPlan, ngon, scalePlan } from './tanks-kit.ts';
import {
  antenna, armorPlate, cagedLamp, crewHatch, cupola, eraGrid, exhaustBox, fineFor, frame, handrail, hexSec, hose, jerryCans, ladder,
  piston, recessPanel, rectP, smokeLaunchers, spareTrack, stowBox, sub, towHooks, trapP,
} from './hs-kit.ts';
import { facePlate, facetHull, frustumPlates, outrigger, periscopes, ringSeat, sensorMast, spade, trussRun } from './hs-kit-vehicles.ts';
import { mtx, strutGeo } from '../geo.ts';

const sc = (p: P2[], kx: number, kz: number): P2[] => p.map(([x, z]) => [x * kx, z * kz]);
const biggest = (ms: MountSpec[]) => ms.reduce<MountSpec | undefined>((a, m) => (!a || m.r > a.r ? m : a), undefined);
const grounded = (c: ChassisCtx) => !c.stance.legs && c.mob.kind !== 'air';

// ---------------------------------------------------------------------------------------------------------------------
function warden(c: ChassisCtx): ChassisOut {
  // Line tank as an ASSEMBLY of chunky armour blocks (Mechabellum style): a dark mechanical core shows through deep gaps
  // between separate blocks, and each block carries its own role colour so the hull never reads as one moulded piece.
  //   core      dark belly + inner frame between the tracks (visible in every gap)
  //   spine     team-colour central block carrying the turret, two light access plates on its rear half
  //   glacis    light bone wedge on the nose, a dark lower plate under it, caged lamps on its corners
  //   sponsons  two blocks per side over the tracks (light front, team rear) split by a gap with a hydraulic ram in it
  //   skirts    three thick outward-tilted plates per side over the track run
  //   engine    dark stepped-down rear block: louvred grille, twin exhaust stacks, jerry cans + antenna (left)
  // Asymmetric: driver's hatch + periscopes front-left, tool bin right shoulder.
  const { b, kit, L, W, stance, S } = c;
  const kx = L / 2, kz = (W / 2) * (HS_NARROW.hex ?? 1), k = Math.min(L / 2, W / 2);
  const fine = fineFor(S);
  const y0 = stance.y0, yt = Math.max(stance.yt, y0 + 0.12 * k);
  const wi = Math.min(stance.wi, 0.66 * kz);
  const ys = yt + 0.03 * k, deck = ys + 0.27 * k;
  const G = 0.035 * k; // gap between blocks
  // ---- core: dark belly between the tracks and an inner frame block that fills the gaps between the armour blocks
  const belly: [number, number, number][] = [[1.02, ys - 0.06 * k, 0.55], [0.86, y0 + 0.04 * k, 1], [-0.9, y0, 1], [-1.0, y0 + 0.07 * k, 0.9]];
  b.loft(kit.mech, belly.map(([x, yb, f]) => hexSec(x * kx, yb, wi * f * 0.9, wi * f, yb + 0.03 * k, ys - 0.01, wi * f, ys + 0.01)));
  block(b, kit.mech, -0.06 * kx, ys - 0.02 * k, 0, 1.84 * kx, 1.3 * kz, (deck - ys) * 0.5, { ch: 0.1 * k, bev: 0.02 * k });
  // ---- spine: team-colour centre block (turret base)
  const spL = 1.12 * kx, spX = -0.02 * kx, spW = 0.98 * kz;
  block(b, kit.armor, spX, ys, 0, spL, spW, deck - ys, { top: [0.95, 0.9], ch: 0.12 * k, bev: 0.035 * k });
  // light access plates on the spine's rear half, either side of the centre line
  both((s) => block(b, kit.shell, -0.36 * kx, deck - 0.004, s * 0.22 * kz, 0.34 * kx, 0.3 * kz, 0.035 * k, { top: [0.92, 0.88], ch: 0.04 * k, bev: 0.012 * k }));
  // ---- glacis: light wedge on the nose (sloped top), dark lower plate under it
  const gX0 = spX + spL / 2 + G, gX1 = 1.06 * kx, gl = gX1 - gX0;
  block(b, kit.shell, (gX0 + gX1) / 2, ys - 0.01 * k, 0, gl, 1.18 * kz, (deck - ys) * 0.86, { top: [0.42, 0.86], shift: [-gl * 0.28, 0], ch: 0.1 * k, bev: 0.025 * k });
  block(b, kit.armor2, 0.93 * kx, y0 + 0.06 * k, 0, 0.26 * kx, wi * 1.6, ys - y0 - 0.08 * k, { top: [0.55, 0.92], shift: [-0.04 * kx, 0], ch: 0.05 * k, bev: 0.015 * k });
  // ---- sponsons over the tracks: front block light, rear block team colour, a gap between with a ram across it
  const spZ = 0.8 * kz, spWd = 0.36 * kz, sh = 0.17 * k, sy = ys + 0.01 * k;
  both((s) => {
    block(b, kit.shell, 0.4 * kx, sy, s * spZ, 0.5 * kx, spWd, sh, { top: [0.82, 0.78], shift: [-0.03 * kx, -s * 0.02 * kz], ch: 0.06 * k, bev: 0.02 * k });
    block(b, kit.armor, -0.45 * kx, sy, s * spZ, 0.95 * kx, spWd, sh * 1.12, { top: [0.94, 0.78], shift: [0, -s * 0.02 * kz], ch: 0.06 * k, bev: 0.02 * k });
    piston(b, kit, [0.06 * kx, sy + sh * 0.55, s * spZ], [0.2 * kx, sy + sh * 0.55, s * spZ], 0.024 * k, 0.5, fine);
    // skirts: three thick plates tilted out over the track run, alternating team / dark
    for (let i = 0; i < 3; i++) {
      const x0 = 0.86 - i * 0.64, x1 = x0 - 0.6, sx = ((x0 + x1) / 2) * kx, sl = (x0 - x1) * kx;
      const F = frame([sx, sy - 0.035 * k, s * (spZ + spWd / 2 + 0.02 * kz)], [0, 0.2, s], [1, 0, 0]);
      armorPlate(b, kit, i === 1 ? kit.armor2 : kit.armor, F, rectP(sl, 0.13 * k, 0.03 * k), 0.045 * k, { standoff: 0.006 * k, gap: 0.015 * k });
    }
    // exposed hydraulics in the gap between spine and sponson: a long ram and a pivot drum at the front
    piston(b, kit, [-0.7 * kx, ys + 0.06 * k, s * 0.56 * kz], [0.3 * kx, ys + 0.09 * k, s * 0.56 * kz], 0.022 * k, 0.6, fine);
    b.cylb(kit.joint, 0.05 * k, 0.07 * kz, 0.01 * k, [0.54 * kx, ys + 0.08 * k, s * 0.53 * kz - 0.035 * kz], 'z', 12);
    // smoke-grenade banks on the light sponson fronts, caged lamps on the glacis corners
    smokeLaunchers(b, kit, frame([0.66 * kx, sy + sh, s * spZ], [0, 1, 0], [Math.cos(0.5), 0, s * Math.sin(0.5)]), 3, 0.026 * k);
    cagedLamp(b, kit, frame([0.92 * kx, ys + 0.08 * k, s * 0.5 * kz], [0, 1, 0], [1, 0, 0]), 0.07 * k, fine);
  });
  // ---- engine: dark stepped-down rear block with a louvred grille and twin exhaust stacks
  const eX1 = spX - spL / 2 - G, eX0 = -1.02 * kx, el = eX1 - eX0, eh = (deck - ys) * 0.74;
  block(b, kit.armor2, (eX0 + eX1) / 2, ys, 0, el, 1.0 * kz, eh, { top: [0.88, 0.86], ch: 0.08 * k, bev: 0.02 * k });
  recessPanel(b, kit, frame([(eX0 + eX1) / 2, ys + eh, 0], [0, 1, 0]), el * 0.6, 0.5 * kz, 0.025 * k, { slats: 5, frame: kit.armor2 });
  both((s) => exhaustBox(b, kit, frame([eX0 + 0.06 * kx, ys + eh * 0.55, s * 0.36 * kz], [-1, 0, 0], [0, 0, 1]), 0.05 * k, fine));
  jerryCans(b, kit, frame([(eX0 + eX1) / 2, ys + eh - 0.004 * k, -0.42 * kz], [0, 1, 0]), 2, 0.07 * k);
  antenna(b, kit, eX1 - 0.04 * kx, ys + eh, -0.44 * kz, 0.7 * k, 0.008 * k, [-0.15, 0, 0]);
  // ---- driver's hatch with periscopes (front left of the spine), tool bin on the right rear sponson
  const hx = 0.36 * kx, hz = -0.28 * kz;
  crewHatch(b, kit, frame([hx, deck, hz], [0, 1, 0]), 0.07 * k, fine);
  for (const dz of [-0.06, 0, 0.06]) b.g(new THREE.BoxGeometry(0.05 * k, 0.05 * k, 0.05 * k), kit.glass, new THREE.Matrix4().makeRotationY(dz * 3).setPosition(hx + 0.1 * k, deck + 0.025 * k, hz + dz * k));
  stowBox(b, kit, frame([-0.5 * kx, sy + sh * 1.12, spZ], [0, 1, 0]), 0.4 * kx, 0.06 * k, 0.2 * kz);
  if (fine) hose(b, kit, [eX0 - 0.01, ys + eh * 0.4, -0.3 * kz], [eX0 - 0.01, ys + eh * 0.4, 0.3 * kz], 0.012 * k, 0.12, 6, kit.joint);
  b.decal(0.12 * k, 0.12 * k, -0.36 * kx, deck + 0.04 * k, 0.22 * kz, atlasUV(1), 0);
  const deckFn = (x: number, z: number) => {
    const az = Math.abs(z);
    if (x > spX - spL / 2 && x < spX + spL / 2 && az < spW * 0.45) return deck;
    if (x <= eX1 && x > eX0 && az < 0.45 * kz) return ys + eh;
    if (az > spZ - spWd / 2 && az < spZ + spWd / 2 && x > -0.92 * kx && x < 0.65 * kx) return sy + sh;
    return Math.abs(x) <= kx && az <= kz ? ys + 0.06 * k : -1;
  };
  const main = biggest(c.mounts);
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
  // Fortress tank (hs-kit): dark octagonal belly between the four track pods, a low faceted octagonal citadel wearing
  // an armour belt of separate plates on shadow gaps (one per facet), a stepped octagonal keep for the front gun and two
  // faceted barbettes for the rear guns. Functional: smoke banks + caged lamps on the front facets, driver's hatch and
  // periscopes, louvred engine grille between the barbettes, ladder on the rear plate. Asymmetric: exhaust right
  // rear, jerry cans + antenna left rear, spare track on the front-right facet, tool bins on the right deck only.
  const { b, kit, L, W, S, stance } = c;
  const kx = L / 3, kz = W / 3, k = Math.min(kx, kz);
  const fine = fineFor(S);
  const y0 = stance.y0, yt = Math.max(stance.yt, y0 + 0.15 * k);
  frustum(b, kit.mech, ngon(8, 1.25 * kx, Math.min(stance.wi, 1.2 * kz), Math.PI / 8), y0, yt - y0 + 0.02, { bev: 0.02 });
  const cit = ngon(8, 1.5 * kx, 1.42 * kz, Math.PI / 8);
  const hC = 0.3 * k, cy = yt - 0.03 * k, top = 0.86;
  frustum(b, kit.armor, cit, cy, hC, { top: [top, top], bot: 0.03 * k, bev: 0.012 * k });
  const deckY = cy + hC;
  // armour belt: one thick plate per facet (front-right facet carries spare track instead)
  frustumPlates(b, kit, kit.armor2, cit, cy, hC, top, 0.03 * k, { standoff: 0.012 * k, gap: 0.025 * k, widthK: 0.82, f0: 0.14, f1: 0.82 });
  const facetMid = (i: number, f: number): V3 => {
    const a = cit[i], e = cit[(i + 1) % 8], kk = 1 - (1 - top) * f;
    return [((a[0] + e[0]) / 2) * kk, cy + hC * f, ((a[1] + e[1]) / 2) * kk];
  };
  // ngon(8, rot pi/8): facet 0 faces front-right (+x +z), facet 7 front-left
  both((s) => {
    const i = s > 0 ? 0 : 7, p = facetMid(i, 1.0);
    smokeLaunchers(b, kit, frame([p[0] - 0.06 * k, deckY, p[2] * 0.82], [0, 1, 0], [Math.cos(0.4), 0, s * Math.sin(0.4)]), 4, 0.03 * k);
    cagedLamp(b, kit, frame([1.18 * kx, deckY, s * 0.28 * kz], [0, 1, 0], [1, 0, 0]), 0.08 * k, fine);
  });
  const sorted = [...c.mounts].sort((a, q) => q.x - a.x);
  const front = sorted[0];
  const fx = front?.x ?? 0.18 * kx;
  // stepped octagonal keep for the front gun, sloped front plate, driver's hatch + periscopes ahead-left of it
  const keep = ngon(8, 0.66 * k, 0.62 * k, Math.PI / 8, fx, 0);
  const keepY = deckY + 0.15 * k;
  frustum(b, kit.armor, keep, deckY - 0.02 * k, keepY - deckY + 0.02 * k, { top: [0.86, 0.86], bev: 0.01 * k });
  frustumPlates(b, kit, kit.armor, keep, deckY - 0.02 * k, keepY - deckY + 0.02 * k, 0.86, 0.022 * k, { standoff: 0.008 * k, gap: 0.016 * k, skip: (i) => i > 1 && i < 6, widthK: 0.75 });
  crewHatch(b, kit, frame([fx + 0.82 * k, deckY, -0.42 * kz], [0, 1, 0]), 0.08 * k, fine);
  periscopes(b, kit, fx + 0.96 * k, deckY, -0.42 * kz, 3, 0.04 * k);
  // rear barbettes: faceted octagonal drums with a stepped armour band
  const towerY = deckY + 0.2 * k;
  const towers = sorted.slice(1);
  const towerAt: [number, number, number][] = towers.length ? towers.map((m) => [m.x, m.z, m.r]) : [[-0.72 * kx, -0.75 * kz, 0.24 * k], [-0.72 * kx, 0.75 * kz, 0.24 * k]];
  for (const [x, z, mr] of towerAt) {
    const r = Math.max(mr, 0.24 * k) * 1.42;
    const pl = ngon(8, r, r, Math.PI / 8, x, z);
    frustum(b, kit.armor, pl, deckY - 0.05 * k, towerY - deckY + 0.05 * k, { top: [0.9, 0.9], bev: 0.01 * k });
    frustum(b, kit.armor2, ngon(8, r * 1.06, r * 1.06, Math.PI / 8, x, z), deckY - 0.02 * k, 0.07 * k, { top: [0.98, 0.98], bev: 0.008 * k });
    if (fine) handrail(b, kit, ngon(8, r * 0.95, r * 0.95, Math.PI / 8, x, z).slice(3, 7).map(([px, pz]) => [px, towerY + 0.07 * k, pz] as V3), 0.007 * k, 0.07 * k);
  }
  // engine deck between the barbettes: louvred grille; exhaust right rear, jerry cans + antenna left rear
  recessPanel(b, kit, frame([-1.0 * kx, deckY, 0], [0, 1, 0]), 0.36 * kx, 0.62 * kz, 0.035 * k, { slats: 5, frame: kit.armor2 });
  exhaustBox(b, kit, frame([-0.98 * kx, deckY, 0.5 * kz], [0, 1, 0], [-0.4, 0, 1]), 0.06 * k, fine);
  jerryCans(b, kit, frame([-0.3 * kx, deckY, -1.08 * kz], [0, 1, 0], [1, 0, 0]), 3, 0.09 * k);
  antenna(b, kit, -0.25 * kx, deckY, -0.82 * kz, 0.9 * k, 0.009 * k, [-0.15, 0, 0]);
  stowBox(b, kit, frame([-0.2 * kx, deckY, 1.06 * kz], [0, 1, 0], [1, 0.0, -0.25]), 0.5 * kx, 0.08 * k, 0.14 * kz);
  const fr = facetMid(0, 0.5);
  spareTrack(b, kit, frame([fr[0] - 0.04 * k, fr[1] + 0.04 * k, fr[2] - 0.04 * k], [0.62, 0.55, 0.62], [-1, 0, 1]), 3, 0.2 * k, 0.08 * k);
  // ladder up the rear facet (scale cue: a crew member climbs it), tow hooks
  const rp = facetMid(4, 0.5);
  ladder(b, kit, [rp[0] - 0.12 * k, 0.04, -0.3 * kz], [rp[0] + 0.02 * k, deckY, -0.3 * kz], 0.12 * k, [0, 0, 1], [-1, 0, 0], 0.03 * k);
  towHooks(b, kit, frame([rp[0] - 0.03 * k, cy + 0.08 * k, 0.2 * kz], [-1, 0, 0], [0, 0, 1]), 0.3 * kz, 0.045 * k);
  b.decal(0.22 * k, 0.22 * k, 0.55 * kx, deckY + 0.004, 0.62 * kz, atlasUV(1), 0);
  const topP = scalePlan(cit, top, top);
  const deck = (x: number, z: number) => (inPlan(topP, x, z) ? deckY : inPlan(cit, x, z) ? cy + hC * 0.5 : -1);
  return {
    deckAt: deck, top: keepY, custom: true, dressed: true,
    seat: (m) => ({ y: ringSeat(b, kit, m, m === front ? keepY : towerY, 0.02 * k, m === front ? 18 : 14), socket: true }),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
function longarm(c: ChassisCtx): ChassisOut {
  // Self-propelled gun (hs-kit): a faceted gun casemate over the rear tracks carrying the turntable, a long low forward
  // hull (engine + driver) running out over the castor wheels, a travel-lock A-frame the barrel drops into, hydraulic
  // recoil spades at the tail. Asymmetric: driver's cab + periscopes front-left, exhaust right, antenna + jerry cans
  // left, ammo lockers on the right flank.
  const { b, kit, L, W, S, stance } = c;
  const kx = L / 3, kz = W, k = Math.min(kx, kz);
  const fine = fineFor(S);
  const y0 = stance.y0;
  const main = biggest(c.mounts);
  const mx = main?.x ?? -0.51 * kx;
  const X = (f: number) => f * kx, Z = (f: number) => f * kz;
  facetHull(c, kit.mech, [[X(-1.46), 0, 0.02, 0.12, 0.14, Z(0.24), Z(0.27), Z(0.27)], [X(1.4), 0.04, 0.05, 0.1, 0.12, Z(0.16), Z(0.2), Z(0.2)]]);
  // gun casemate (rear) and the long forward hull, as two faceted lofts
  const G = facetHull(c, kit.armor, [
    [X(-1.48), 0.04, 0.04, 0.3, 0.36, Z(0.3), Z(0.4), Z(0.32)],
    [X(-1.3), 0.02, 0.02, 0.33, 0.42, Z(0.3), Z(0.46), Z(0.38)],
    [mx + X(0.42), 0.02, 0.02, 0.33, 0.42, Z(0.3), Z(0.46), Z(0.38)],
    [mx + X(0.66), 0.03, 0.03, 0.24, 0.27, Z(0.26), Z(0.4), Z(0.3)],
  ]);
  const F = facetHull(c, kit.armor, [
    [mx + X(0.6), 0.03, 0.03, 0.2, 0.26, Z(0.24), Z(0.34), Z(0.26)],
    [X(1.18), 0.04, 0.04, 0.2, 0.25, Z(0.22), Z(0.32), Z(0.24)],
    [X(1.48), 0.07, 0.07, 0.11, 0.13, Z(0.16), Z(0.24), Z(0.14)],
  ]);
  const deck = (x: number, z: number) => Math.max(G.deck(x, z), F.deck(x, z));
  const dk = (x: number, z = 0) => Math.max(y0, deck(x, z));
  const gy = y0 + 0.42;
  // casemate front plate, glacis plate on the nose
  facePlate(b, kit, kit.armor2, [mx + X(0.66), y0 + 0.27, 0], [mx + X(0.42), gy, 0], [0, 0, 1], Z(0.62), 0.022 * k, [1, 1, 0], { standoff: 0.008 * k, gap: 0.014 * k, fill: 0.8 });
  facePlate(b, kit, kit.armor, [X(1.48), y0 + 0.13, 0], [X(1.18), y0 + 0.25, 0], [0, 0, 1], Z(0.4), 0.02 * k, [1, 1, 0], { standoff: 0.006 * k, gap: 0.012 * k, fill: 0.86 });
  // driver's cab front-left: raised armoured box with a visor and periscopes
  const cx = X(1.0), cz = -Z(0.13), cb = dk(cx);
  b.g(bevBox(0.22 * k, 0.09 * k, Z(0.18), 0.012 * k), kit.armor2, mtx([cx, cb + 0.045 * k, cz]));
  periscopes(b, kit, cx + 0.11 * k, cb + 0.05 * k, cz, 3, 0.035 * k);
  // travel lock: A-frame on the forward hull with a cradle the barrel rests in (hinged, held by a small ram)
  const tx = X(0.78), tb = dk(tx), th = Math.max(0.2 * k, gy + 0.05 * k - tb);
  both((s) => b.g(strutGeo([tx - 0.08 * k, tb, s * Z(0.12)], [tx, tb + th, s * Z(0.04)], 0.016 * k, 0.014 * k, 5), kit.joint));
  b.g(new THREE.BoxGeometry(0.05 * k, 0.03 * k, Z(0.14)), kit.hazard, mtx([tx, tb + th, 0]));
  both((s) => b.g(new THREE.BoxGeometry(0.04 * k, 0.06 * k, 0.015 * k), kit.mech, mtx([tx, tb + th + 0.03 * k, s * Z(0.06)])));
  piston(b, kit, [tx + 0.2 * k, tb, 0], [tx + 0.02 * k, tb + th * 0.55, 0], 0.014 * k, 0.55, fine);
  // recoil spades at the tail on hydraulic arms (dug in when grounded, raised otherwise)
  const g = grounded(c);
  both((s) => {
    const a: V3 = [X(-1.36), y0 + 0.2, s * Z(0.22)];
    const e: V3 = g ? [X(-1.72), 0.12 * k, s * Z(0.3)] : [X(-1.62), y0 + 0.3, s * Z(0.3)];
    beam(b, kit.armor2, a, e, 0.06 * k, 0.07 * k);
    piston(b, kit, [X(-1.3), y0 + 0.36, s * Z(0.16)], [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2 + 0.04 * k, s * Z(0.26)], 0.02 * k, 0.55, fine);
    spade(b, kit, new THREE.Matrix4().makeRotationY(-Math.PI / 2).multiply(new THREE.Matrix4().makeRotationX(g ? -0.4 : 0.6)).setPosition(e[0] - 0.02 * k, e[1] + 0.02 * k, e[2]), 0.2 * k, g ? 0.16 * k : 0.12 * k, 0.02 * k);
  });
  // engine grille on the forward hull, exhaust right, antenna + jerry cans left, ammo lockers right flank
  recessPanel(b, kit, frame([X(0.3), dk(X(0.3)), 0], [0, 1, 0]), 0.36 * kx, Z(0.3), 0.025 * k, { slats: 4, frame: kit.armor2 });
  exhaustBox(b, kit, frame([X(0.55), dk(X(0.55), Z(0.2)), Z(0.2)], [0, 1, 0], [0, 0, 1]), 0.035 * k, fine);
  antenna(b, kit, X(-1.3), dk(X(-1.3)), -Z(0.3), 0.75 * k, 0.008 * k, [-0.15, 0, 0]);
  jerryCans(b, kit, frame([X(0.0), dk(X(0.0), -Z(0.2)), -Z(0.2)], [0, 1, 0], [1, 0, 0]), 2, 0.075 * k);
  stowBox(b, kit, frame([X(-0.95), y0 + 0.36, Z(0.46) + 0.012 * k], [0, 0, 1], [1, 0, 0]), 0.5 * kx, 0.07 * k, 0.05 * k);
  cagedLamp(b, kit, frame([X(1.35), dk(X(1.35), Z(0.12)), Z(0.12)], [0, 1, 0], [1, 0, 0]), 0.05 * k, fine);
  return {
    deckAt: deck, top: gy + 0.12 * k, custom: true, dressed: true,
    seat: (m) => {
      // turntable: faceted octagonal ring base, then the low ring guard
      const base = dk(m.x, m.z);
      frustum(b, kit.armor2, ngon(8, m.r * 1.4, m.r * 1.4, Math.PI / 8, m.x, m.z), base - 0.01, 0.06 * k, { top: [0.92, 0.92], bev: 0.008 * k });
      return { y: ringSeat(b, kit, m, base + 0.05 * k, 0.02 * k, 16), socket: true };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
function colossus(c: ChassisCtx): ChassisOut {
  // Multi-turret heavy tank (hs-kit): a long faceted central hull (sponsons over the inner tracks, flat deck, stepped
  // glacis), two armoured side casemates over the outer tracks carrying the flank guns, a faceted nose barbette, a rear
  // MG cupola. Functional: casemate side doors and smoke banks, glacis plate stack, engine grilles, handrails along the
  // deck edges, ladder on the left casemate. Asymmetric: driver's hatch front-left, exhaust right rear, antennas + cans
  // left rear, spare track on the right of the glacis.
  const { b, kit, L, W, S, stance } = c;
  const kx = L / 4, kz = W / 3, k = Math.min(kx, kz);
  const fine = fineFor(S);
  const y0 = stance.y0;
  const X = (f: number) => f * kx, Z = (f: number) => f * kz;
  facetHull(c, kit.mech, [[X(-1.95), 0, 0.03, 0.16, 0.2, Z(0.5), Z(0.58), Z(0.58)], [X(1.9), 0.05, 0.07, 0.16, 0.2, Z(0.4), Z(0.5), Z(0.5)]]);
  const H = facetHull(c, kit.armor, [
    [X(-2.0), 0.08, 0.08, 0.42, 0.5, Z(0.5), Z(0.72), Z(0.56)],
    [X(-1.76), 0.04, 0.04, 0.46, 0.62, Z(0.56), Z(0.96), Z(0.76)],
    [X(1.16), 0.04, 0.04, 0.46, 0.62, Z(0.56), Z(0.96), Z(0.76)],
    [X(1.72), 0.06, 0.06, 0.34, 0.4, Z(0.5), Z(0.82), Z(0.56)],
    [X(2.02), 0.1, 0.1, 0.18, 0.2, Z(0.36), Z(0.56), Z(0.3)],
  ]);
  const dk = (x: number, z = 0) => Math.max(y0, H.deck(x, z));
  const deckY = y0 + 0.62;
  // stepped glacis: two-plate stack, lower nose plate
  const GF = facePlate(b, kit, kit.armor, [X(1.72), y0 + 0.4, 0], [X(1.16), deckY, 0], [0, 0, 1], Z(1.2), 0.035 * k, [1, 1, 0], { standoff: 0.012 * k, gap: 0.025 * k, fill: 0.9 });
  armorPlate(b, kit, kit.armor2, sub(GF, 0, 0.012 * k + 0.035 * k, 0), rectP(Z(0.9), 0.24 * k, 0.03 * k), 0.03 * k, { standoff: 0.01 * k, gap: 0.02 * k });
  facePlate(b, kit, kit.armor2, [X(2.02), y0 + 0.2, 0], [X(1.72), y0 + 0.4, 0], [0, 0, 1], Z(0.8), 0.03 * k, [1, 0.6, 0], { standoff: 0.01 * k, gap: 0.02 * k, fill: 0.86 });
  spareTrack(b, kit, sub(GF, Z(0.42), 0.1 * k, -0.04 * k, 0, Math.PI / 2, 0), 3, 0.22 * k, 0.08 * k);
  // side casemates over the outer tracks: faceted, sloped front, gun on the roof
  const side = c.mounts.filter((m) => Math.abs(m.z) > 0.4 * kz);
  const sx = side.length ? side[0].x : X(0.08), sz = side.length ? Math.abs(side[0].z) : Z(0.9);
  const hw = Z(0.4), zc = sz + Z(0.12), pTop = y0 + 0.74;
  const pods = new Map<number, (x: number, z: number) => number>();
  both((s) => {
    const P = facetHull(c, kit.armor, [
      [sx - X(0.95), 0.3, 0.3, 0.6, 0.74, hw * 0.9, hw, hw * 0.88],
      [sx + X(0.55), 0.3, 0.3, 0.6, 0.74, hw * 0.9, hw, hw * 0.88],
      [sx + X(0.95), 0.3, 0.3, 0.4, 0.46, hw * 0.8, hw * 0.92, hw * 0.7],
    ], s * zc, false);
    pods.set(s, P.deck);
    facePlate(b, kit, kit.armor2, [sx + X(0.95), y0 + 0.46, s * zc], [sx + X(0.55), pTop, s * zc], [0, 0, 1], hw * 1.6, 0.03 * k, [1, 1, 0], { standoff: 0.01 * k, gap: 0.02 * k, fill: 0.86 });
    recessPanel(b, kit, frame([sx - X(0.35), y0 + 0.47, s * (zc + hw)], [0, 0, s], [1, 0, 0]), X(0.5), 0.2 * k, 0.025 * k, { frame: kit.armor2 });
    smokeLaunchers(b, kit, frame([sx + X(0.62), pTop, s * (zc + hw * 0.5)], [0, 1, 0], [Math.cos(0.45), 0, s * Math.sin(0.45)]), 4, 0.028 * k);
    cagedLamp(b, kit, frame([X(1.6), dk(X(1.6), s * Z(0.4)), s * Z(0.4)], [0, 1, 0], [1, 0, 0]), 0.07 * k, fine);
    if (fine) handrail(b, kit, [[X(-1.6), deckY + 0.08 * k, s * Z(0.7)], [sx - X(1.05), deckY + 0.08 * k, s * Z(0.7)]], 0.007 * k, 0.08 * k);
  });
  ladder(b, kit, [sx - X(0.7), 0.05, -(zc + hw)], [sx - X(0.7), pTop, -(zc + hw)], 0.13 * k, [1, 0, 0], [0, 0, -1], 0.03 * k);
  // deck: driver's hatch front-left, engine grilles, exhaust right rear, antennas + jerry cans left rear, tow hooks
  crewHatch(b, kit, frame([X(1.0), deckY, -Z(0.32)], [0, 1, 0]), 0.08 * k, fine);
  periscopes(b, kit, X(1.12), deckY, -Z(0.32), 3, 0.04 * k);
  for (const gx of [-1.2, -1.62]) recessPanel(b, kit, frame([X(gx), deckY, Z(0.1)], [0, 1, 0]), 0.3 * kx, Z(0.6), 0.03 * k, { slats: 4, frame: kit.armor2 });
  exhaustBox(b, kit, frame([X(-1.75), deckY, Z(0.6)], [0, 1, 0], [0, 0, 1]), 0.06 * k, fine);
  jerryCans(b, kit, frame([X(-1.0), deckY, -Z(0.58)], [0, 1, 0], [1, 0, 0]), 3, 0.09 * k);
  antenna(b, kit, X(-1.85), deckY, -Z(0.5), 1.0 * k, 0.009 * k, [-0.15, 0, 0]);
  antenna(b, kit, X(-0.6), deckY, -Z(0.6), 0.7 * k, 0.008 * k, [-0.1, 0, 0]);
  towHooks(b, kit, frame([X(-2.0) - 0.005, y0 + 0.3, 0], [-1, 0, 0], [0, 0, 1]), Z(0.7), 0.05 * k);
  b.decal(0.24 * k, 0.24 * k, X(0.4), deckY + 0.004, Z(0.45), atlasUV(1), 0);
  const deck = (x: number, z: number) => {
    let d = H.deck(x, z);
    for (const f of pods.values()) d = Math.max(d, f(x, z));
    return d;
  };
  return {
    deckAt: deck, top: pTop + 0.1 * k, custom: true, dressed: true,
    seat: (m) => {
      if (Math.abs(m.z) > 0.4 * kz) return { y: ringSeat(b, kit, m, pTop, 0.02 * k, 16), socket: true };
      const base = Math.max(y0, H.deck(m.x, m.z));
      if (m.x > X(1.2)) {
        // nose barbette rising off the glacis to deck level
        const y = deckY + 0.02 * k;
        frustum(b, kit.armor, ngon(8, m.r * 1.45, m.r * 1.45, Math.PI / 8, m.x, m.z), base - 0.1 * k, y - base + 0.1 * k, { top: [0.9, 0.9], bev: 0.01 * k });
        return { y: ringSeat(b, kit, m, y, 0.015 * k, 16), socket: true };
      }
      return { y: ringSeat(b, kit, m, base, 0.03 * k, 14), socket: true };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
function siegeplat(c: ChassisCtx): ChassisOut {
  // Siege platform (hs-kit): a long girder platform (dark box spine, lattice side girders, armoured deck plates) on four
  // bogies, two weapon pedestals on hydraulic rams fed by ammo hoses from the rear hoppers, four hydraulic outrigger
  // jacks on ground pads (stowed when moving on legs / hover), handrailed catwalks. Asymmetric: crew cab front-left,
  // fire-control mast front-right, exhaust right rear, antenna left rear.
  const { b, kit, L, W, S, stance } = c;
  const kx = L / 4, kz = W / 2, k = Math.min(kx, kz);
  const fine = fineFor(S);
  const y0 = stance.y0;
  const X = (f: number) => f * kx, Z = (f: number) => f * kz;
  facetHull(c, kit.mech, [[X(-1.9), 0, 0.02, 0.14, 0.16, Z(0.36), Z(0.42), Z(0.42)], [X(1.88), 0.02, 0.04, 0.14, 0.16, Z(0.32), Z(0.38), Z(0.38)]]);
  const H = facetHull(c, kit.armor, [
    [X(-1.98), 0.14, 0.14, 0.26, 0.3, Z(0.4), Z(0.5), Z(0.46)],
    [X(-1.84), 0.12, 0.12, 0.28, 0.32, Z(0.46), Z(0.56), Z(0.52)],
    [X(1.74), 0.12, 0.12, 0.28, 0.32, Z(0.46), Z(0.56), Z(0.52)],
    [X(1.98), 0.14, 0.14, 0.22, 0.24, Z(0.36), Z(0.46), Z(0.34)],
  ]);
  const dY = y0 + 0.32;
  // lattice side girders under the deck edge (the platform's construction read)
  both((s) => trussRun(b, kit, [X(-1.7), dY - 0.13 * k, s * Z(0.6)], [X(1.7), dY - 0.13 * k, s * Z(0.6)], [0, 0.07 * k, 0], 0.012 * k, 8));
  // deck plates in two runs with a gap (walkways), handrails along the edges
  both((s) => armorPlate(b, kit, kit.armor2, frame([X(-0.05), dY, s * Z(0.3)], [0, 1, 0], [1, 0, 0]), rectP(X(3.2), Z(0.36), 0.03 * k), 0.016 * k, { standoff: 0.005 * k, gap: 0.01 * k }));
  if (fine) both((s) => handrail(b, kit, [[X(-1.75), dY + 0.11 * k, s * Z(0.52)], [X(-0.6), dY + 0.11 * k, s * Z(0.52)], [X(0.7), dY + 0.11 * k, s * Z(0.52)], [X(1.35), dY + 0.11 * k, s * Z(0.52)]], 0.007 * k, 0.11 * k));
  // crew cab front-left (glass visor, periscopes) and fire-control mast front-right
  const cabX = X(1.62), cabZ = -Z(0.24);
  const Cb = facetHull(c, kit.armor, [
    [cabX - X(0.3), 0.32, 0.32, 0.44, 0.5, Z(0.2), Z(0.22), Z(0.18)],
    [cabX + X(0.18), 0.32, 0.32, 0.44, 0.5, Z(0.2), Z(0.22), Z(0.18)],
    [cabX + X(0.32), 0.32, 0.32, 0.36, 0.38, Z(0.18), Z(0.2), Z(0.14)],
  ], cabZ, false);
  b.g(new THREE.BoxGeometry(0.02 * k, 0.05 * k, Z(0.3)), kit.glass, mtx([cabX + X(0.25), y0 + 0.43, cabZ], [0, 0, 0.9]));
  sensorMast(b, kit, [X(1.6), dY, Z(0.3)], 0.5 * k, 0.018 * k, 0, 1.4);
  // ammo hoppers at the tail feeding the pedestals through hoses
  const hop: V3[] = [[X(-1.6), dY, -Z(0.28)], [X(-1.6), dY, Z(0.28)]];
  for (const p of hop) {
    b.g(bevBox(0.3 * k, 0.2 * k, 0.24 * k, 0.02 * k), kit.armor2, mtx([p[0], p[1] + 0.1 * k, p[2]]));
    b.g(new THREE.BoxGeometry(0.32 * k, 0.025 * k, 0.26 * k), kit.mech, mtx([p[0], p[1] + 0.16 * k, p[2]]));
  }
  const sorted = [...c.mounts].sort((a, q) => a.z - q.z);
  sorted.forEach((m, i) => { const p = hop[Math.min(i, 1)]; hose(b, kit, [p[0] + 0.15 * k, p[1] + 0.12 * k, p[2]], [m.x - m.r, dY + 0.18 * k, m.z], 0.018 * k, 0.12, 5); });
  // outrigger jacks: four, on ground pads when grounded, folded up against the platform otherwise
  const g = grounded(c);
  for (const fx of [1.3, -1.3]) both((s) => {
    const a: V3 = [X(fx), dY - 0.05 * k, s * Z(0.5)];
    const foot: V3 = g ? [X(fx + Math.sign(fx) * 0.45), 0, s * Z(1.25)] : [X(fx + Math.sign(fx) * 0.2), dY - 0.1 * k, s * Z(0.85)];
    outrigger(b, kit, a, foot, 0.05 * k, fine, kit.mech);
  });
  // exhaust right rear, antenna left rear, ladder on the left side, tow hooks
  exhaustBox(b, kit, frame([X(-1.88), dY, Z(0.0)], [0, 1, 0], [0, 0, 1]), 0.05 * k, fine);
  antenna(b, kit, X(-1.85), dY, -Z(0.46), 1.0 * k, 0.009 * k, [-0.15, 0, 0]);
  ladder(b, kit, [X(0.3), 0.06, -Z(0.56)], [X(0.3), dY, -Z(0.56)], 0.12 * k, [1, 0, 0], [0, 0, -1], 0.03 * k);
  cagedLamp(b, kit, frame([X(1.9), dY, Z(0.0)], [0, 1, 0], [1, 0, 0]), 0.07 * k, fine);
  const deck = (x: number, z: number) => Math.max(H.deck(x, z), Cb.deck(x, z));
  return {
    deckAt: deck, top: dY + 0.4 * k, custom: true, dressed: true,
    seat: (m) => {
      // armoured pedestal on two hydraulic rams
      const h = 0.24 * k, y = dY + h;
      frustum(b, kit.armor2, ngon(8, m.r * 1.5, m.r * 1.5, Math.PI / 8, m.x, m.z), dY - 0.01, 0.06 * k, { top: [0.94, 0.94], bev: 0.008 * k });
      b.cylb(kit.mech, m.r * 0.8, h - 0.06 * k, 0.01 * k, [m.x, dY + 0.05 * k, m.z], 'y', 8);
      both((s) => piston(b, kit, [m.x - m.r * 1.2, dY + 0.05 * k, m.z + s * m.r * 0.9], [m.x - m.r * 0.3, y - 0.04 * k, m.z + s * m.r * 0.7], 0.025 * k, 0.5, fine));
      frustum(b, kit.armor, ngon(8, m.r * 1.25, m.r * 1.25, Math.PI / 8, m.x, m.z), y - 0.07 * k, 0.05 * k, { top: [0.94, 0.94], bev: 0.008 * k });
      return { y: ringSeat(b, kit, m, y - 0.02 * k, 0.02 * k, 16), socket: true };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
function juggernaut(c: ChassisCtx): ChassisOut {
  // Breaching casemate (hs-kit): wider than long. A dark belly, a chevron-plan faceted lower hull, a set-back casemate,
  // a hex keep for the main gun. The front is a wall of layered armour: two-layer plate stacks on the chevron facets
  // with ERA grids, and a full-width mine plough (two V halves of toothed blades on push arms and rams). Asymmetric:
  // commander's cupola left, exhaust right rear, jerry cans + antenna left rear, ladder on the right flank.
  const { b, kit, L, W, S, stance } = c;
  const kx = L / 3, kz = W / 4, k = Math.min(kx, kz);
  const fine = fineFor(S);
  const y0 = stance.y0, yt = Math.max(stance.yt, y0 + 0.15 * k);
  frustum(b, kit.mech, sc(mirrorPlan([[1.3, 0.5], [1.0, Math.min(stance.wi, 1.5)], [-1.3, Math.min(stance.wi, 1.5)], [-1.45, 1.0]]), kx, 1), y0, yt - y0 + 0.02, { bev: 0.02 });
  const t1 = sc(mirrorPlan([[1.52, 0.3], [0.45, 1.98], [-0.95, 1.98], [-1.48, 1.1]]), kx, kz);
  const h1 = 0.34 * k, y1 = yt - 0.05 * k;
  frustum(b, kit.armor, t1, y1, h1, { top: [0.9, 0.93], shift: [-0.06 * kx, 0], bot: 0.04 * k, bev: 0.012 * k });
  const d1 = y1 + h1;
  // frontal wall: plate stack + ERA on the two chevron facets (t1 points 0->1 is the right front facet, last->0 left)
  both((s) => {
    const a: P2 = [1.52 * kx, 0.3 * kz * s], e: P2 = [0.45 * kx, 1.98 * kz * s];
    const ta: P2 = [a[0] * 0.9 - 0.06 * kx, a[1] * 0.93], te: P2 = [e[0] * 0.9 - 0.06 * kx, e[1] * 0.93];
    const p0: V3 = [(a[0] + e[0]) / 2, y1 + h1 * 0.12, (a[1] + e[1]) / 2], p1: V3 = [(ta[0] + te[0]) / 2, y1 + h1 * 0.92, (ta[1] + te[1]) / 2];
    const F = facePlate(b, kit, kit.armor2, p0, p1, [e[0] - a[0], 0, e[1] - a[1]], Math.hypot(e[0] - a[0], e[1] - a[1]) * 0.86, 0.04 * k, [1, 0.3, s], { standoff: 0.014 * k, gap: 0.03 * k, fill: 1 });
    eraGrid(b, kit, sub(F, 0, 0.014 * k + 0.04 * k, 0), 2, 5, Math.hypot(e[0] - a[0], e[1] - a[1]) * 0.15, h1 * 0.4, 0.03 * k, kit.armor);
  });
  frustumPlates(b, kit, kit.armor2, t1, y1, h1, 0.91, 0.03 * k, { standoff: 0.01 * k, gap: 0.022 * k, f0: 0.15, f1: 0.85, skip: (i) => i === 0 || i === t1.length - 1 || i === 3, widthK: 0.8 });
  // tier 2: set-back casemate, flat roof
  const t2 = sc(mirrorPlan([[0.74, 0.26], [0.05, 1.4], [-0.85, 1.4], [-1.3, 0.8]]), kx, kz);
  const h2 = 0.24 * k;
  frustum(b, kit.mech, scalePlan(t2, 1.04, 1.03), d1 - 0.03 * k, 0.06 * k, { top: [0.99, 0.99], bev: 0.01 * k });
  frustum(b, kit.armor, t2, d1 + 0.02 * k, h2 - 0.02 * k, { top: [0.86, 0.88], shift: [-0.06 * kx, 0], bev: 0.012 * k });
  frustumPlates(b, kit, kit.armor, t2, d1 + 0.02 * k, h2 - 0.02 * k, 0.87, 0.025 * k, { standoff: 0.008 * k, gap: 0.018 * k, f0: 0.15, f1: 0.85, skip: (i) => i > 1 && i < t2.length - 2, widthK: 0.78 });
  const d2 = d1 + h2;
  const main = biggest(c.mounts);
  const mx = main?.x ?? -0.42 * kx, mz = main?.z ?? 0;
  const keepY = d2 + 0.16 * k;
  const kp = ngon(6, 0.62 * k, 0.66 * k, 0, mx, mz);
  frustum(b, kit.armor, kp, d2 - 0.03 * k, keepY - d2 + 0.03 * k, { top: [0.86, 0.86], bev: 0.01 * k });
  frustumPlates(b, kit, kit.armor2, kp, d2 - 0.03 * k, keepY - d2 + 0.03 * k, 0.86, 0.022 * k, { standoff: 0.008 * k, gap: 0.015 * k, skip: (i) => i === 2 || i === 3, widthK: 0.72 });
  // mine plough: two V halves of toothed blades across the front, on push arms and rams
  const pw = yt * 0.78;
  both((s) => {
    const a: P2 = [1.78 * kx, 0], e: P2 = [0.72 * kx, s * 2.0 * kz];
    const len = Math.hypot(e[0] - a[0], e[1] - a[1]), yaw = Math.atan2(e[0] - a[0], e[1] - a[1]);
    const M = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationZ(0.35)).setPosition((a[0] + e[0]) / 2, 0.04 * k + pw / 2, (a[1] + e[1]) / 2);
    b.g(bevBox(0.05 * k, pw, len, 0.01 * k), kit.armor2, M);
    b.g(new THREE.BoxGeometry(0.03 * k, 0.04 * k, len * 0.96), kit.hazard, M.clone().multiply(new THREE.Matrix4().makeTranslation(0.01 * k, pw / 2 - 0.02 * k, 0)));
    const nT = 6;
    for (let i = 0; i < nT; i++) {
      const zz = -len / 2 + (len * (i + 0.5)) / nT;
      b.g(new THREE.BoxGeometry(0.16 * k, 0.04 * k, 0.05 * k), kit.steel, M.clone().multiply(new THREE.Matrix4().makeTranslation(0.08 * k, -pw / 2 + 0.005, zz)).multiply(new THREE.Matrix4().makeRotationZ(-0.6)));
    }
    beam(b, kit.mech, [1.6 * kx, 0.1 * k + pw * 0.5, s * 0.8 * kz], [0.95 * kx, y0 + 0.05 * k, s * 1.2 * kz], 0.08 * k, 0.09 * k);
    piston(b, kit, [1.15 * kx, d1 - 0.04 * k, s * 0.7 * kz], [1.55 * kx, 0.04 * k + pw * 0.9, s * 0.62 * kz], 0.03 * k, 0.55, fine);
    cagedLamp(b, kit, frame([0.8 * kx, d1, s * 1.45 * kz], [0, 1, 0], [1, 0, 0]), 0.08 * k, fine);
  });
  // commander's cupola (left of the keep), driver's periscopes, crew hatch
  cupola(b, kit, mx + 0.35 * kx, d2, -1.0 * kz, 0.12 * k, { fine });
  periscopes(b, kit, 0.52 * kx, d2, -0.55 * kz, 4, 0.045 * k, -0.35);
  crewHatch(b, kit, frame([-0.95 * kx, d2, 0.55 * kz], [0, 1, 0]), 0.08 * k, fine);
  // rear deck: grille, exhaust (right), jerry cans + antenna (left), ladder on the right flank, tow hooks
  recessPanel(b, kit, frame([-1.2 * kx, d1, -0.15 * kz], [0, 1, 0]), 0.2 * kx, 0.7 * kz, 0.03 * k, { slats: 4, frame: kit.armor2 });
  exhaustBox(b, kit, frame([-1.25 * kx, d1, 0.9 * kz], [0, 1, 0], [0, 0, 1]), 0.06 * k, fine);
  jerryCans(b, kit, frame([-1.2 * kx, d1, -1.2 * kz], [0, 1, 0], [0, 0, 1]), 3, 0.09 * k);
  antenna(b, kit, -1.0 * kx, d2, -0.75 * kz, 1.0 * k, 0.009 * k, [-0.15, 0, 0]);
  ladder(b, kit, [-0.4 * kx, 0.05, 1.98 * kz], [-0.4 * kx, d1, 1.98 * kz * 0.95], 0.13 * k, [1, 0, 0], [0, 0, 1], 0.04 * k);
  towHooks(b, kit, frame([-1.46 * kx, y1 + 0.1 * k, 0], [-1, 0, 0], [0, 0, 1]), 0.9 * kz, 0.05 * k);
  b.decal(0.26 * k, 0.26 * k, 0.1 * kx, d2 + 0.004, -0.75 * kz, atlasUV(1), 0);
  const t2top = scalePlan(t2, 0.86, 0.88, -0.05 * kx, 0);
  const deck = (x: number, z: number) => (inPlan(t2top, x, z) ? d2 : inPlan(t1, x, z) ? d1 : -1);
  return {
    deckAt: deck, top: keepY, custom: true, dressed: true,
    seat: (m) => {
      if (m === main) return { y: ringSeat(b, kit, m, keepY, 0.02 * k, 18), socket: true };
      const base = Math.max(0, deck(m.x, m.z));
      return { y: ringSeat(b, kit, m, base, 0.04 * k, 14), socket: true };
    },
  };
}

registerChassis('hex', warden);
registerChassis('fortress', bastion);
registerChassis(['long', 'longarm'], longarm);
registerChassis('colossus', colossus);
registerChassis('siegeplat', siegeplat);
registerChassis('juggernaut', juggernaut);
