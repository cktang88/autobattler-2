// Tracked / heavy ground hulls, all in the hard-surface style (chassis/hs-kit.ts + hs-kit-vehicles.ts): a dark
// structural belly, faceted armour lofts / frustums (flat decks, sharp shoulders), separate thick plates on shadow gaps,
// functional parts in named slots and 2-3 one-sided features per hull. Each class keeps its own plan shape:
//   warden     'hex'        battle-tank carrier (Sabertooth-like): the hero weapon body is the upper body on a squat
//                            pedestal; four separate armoured track pods stand out at the corners (light front pods with
//                            team prows, team rear pods), low glacis wedge and dark engine block between them.
//   (bastion 'fortress' lives in chassis/carriers.ts)
//   longarm    'long'       long-gun carrier: the gun on a raised shoulder yoke far back, twin engine-nacelle
//                            counterweight with splayed radiator fins and recoil spades at the tail, long low segmented
//                            prow out to a castor pair.
//   colossus   'titan'      multi-turret heavy tank: long central hull, two armoured side casemates over the outer tracks,
//                            nose barbette, rear MG cupola, handrails and a ladder.
//   siegeplat  'siegeplat'  siege platform: girder spine with lattice side girders, two pedestals on rams fed by ammo
//                            hoses, four hydraulic outrigger jacks, crew cab front-left, fire-control mast front-right.
//   juggernaut 'juggernaut' breaching casemate, wider than long: chevron hull, frontal plate stacks + ERA, set-back
//                            casemate, hex keep, full-width toothed mine plough on push arms and rams.
// Running gear looks per shape live in mobility/tracks.ts (trackStyle). Shape helpers: chassis/tanks-kit.ts.

import * as THREE from 'three';
import { atlasUV, type MatLike } from '../materials.ts';
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
/** plain (unbevelled) box for small repeated parts: 12 triangles */
const pbox = (b: ChassisCtx['b'], mat: MatLike, w: number, h: number, d: number, x: number, y: number, z: number, rot?: V3) => b.g(new THREE.BoxGeometry(w, h, d), mat, mtx([x, y, z], rot));
const grounded = (c: ChassisCtx) => !c.stance.legs && c.mob.kind !== 'air';

// ---------------------------------------------------------------------------------------------------------------------
function warden(c: ChassisCtx): ChassisOut {
  // Battle-tank CARRIER (Sabertooth-like): the hero turret is the whole upper body, so the hull is what holds it up and
  // what sticks out round it. From above: one big turret disc between FOUR separate armoured track pods standing out at
  // the corners (long light front pods with team prows and lamps, shorter team rear pods), a low team glacis wedge
  // between the front pods and a dark engine block between the rear pods. Each pod is a chunky stack (dark track guard,
  // dark seam, hood, cap) and the front / rear pods are split by a deep gap with a joint drum and a ram in it. The
  // turret stands on a squat octagonal pedestal (narrower than the turret) on a dark core visible in every gap.
  const { b, kit, L, W, stance, S } = c;
  const kx = L / 2, kz = (W / 2) * (HS_NARROW.hex ?? 1), k = Math.min(L / 2, W / 2);
  const fine = fineFor(S);
  const y0 = stance.y0, yt = Math.max(stance.yt, y0 + 0.12 * k);
  const wi = Math.min(stance.wi, 0.66 * kz);
  const main = biggest(c.mounts);
  const mx = main?.x ?? 0.08 * kx;
  const R = main?.r ?? 0.7 * k;
  const G = 0.035 * k; // gap between blocks
  const podB = yt - 0.11 * k, podM = yt + 0.07 * k, podT = yt + 0.17 * k; // pod: guard bottom, seam, hood top
  const seatY = podT + 0.06 * k;
  // pods sit over the tracks and stand a little outside them
  const pz = 0.8 * kz, pw = 0.64 * kz;
  const fX0 = 0.13 * kx, fX1 = 1.14 * kx, rX0 = -0.13 * kx, rX1 = -1.08 * kx;
  // ---- core: dark belly between the tracks + the inner frame every gap shows
  const belly: [number, number, number][] = [[1.0, yt - 0.05 * k, 0.55], [0.84, y0 + 0.04 * k, 1], [-0.9, y0, 1], [-1.0, y0 + 0.07 * k, 0.9]];
  b.loft(kit.mech, belly.map(([x, yb, f]) => hexSec(x * kx, yb, wi * f * 0.9, wi * f, yb + 0.03 * k, yt - 0.01, wi * f, yt + 0.01)));
  block(b, kit.mech, -0.02 * kx, yt - 0.04 * k, 0, 1.8 * kx, 2 * (pz - pw / 2) + 0.04 * kz, 0.14 * k, { ch: 0.1 * k, bev: 0.02 * k });
  // ---- four track pods
  const pod = (x0: number, x1: number, s: -1 | 1, front: boolean) => {
    const x = (x0 + x1) / 2, l = Math.abs(x1 - x0), z = s * pz;
    // dark track guard (wraps the top run, its outer face drops over the track side)
    block(b, kit.armor2, x, podB, z, l, pw, podM - podB, { top: [0.97, 0.94], shift: [0, -s * 0.01 * kz], ch: 0.07 * k, bev: 0.02 * k });
    // dark seam, then the hood: light at the front, team at the back
    block(b, kit.mech, x, podM - 0.005, z, l - 0.08 * k, pw - 0.07 * kz, 0.03 * k, { ch: 0.05 * k, bev: 0.008 * k });
    block(b, front ? kit.shell : kit.armor, x - (front ? 0.04 : -0.02) * kx, podM + 0.02 * k, z, l - 0.1 * k, pw - 0.04 * kz, podT - podM - 0.02 * k,
      { top: [front ? 0.8 : 0.86, 0.84], shift: [(front ? -0.06 : 0.04) * kx, -s * 0.02 * kz], ch: 0.08 * k, bev: 0.03 * k });
    // outer skirt plate on a shadow gap, down over the track
    const F = frame([x, podB + 0.05 * k, s * (pz + pw / 2 + 0.005)], [0, 0.18, s], [1, 0, 0]);
    armorPlate(b, kit, front ? kit.armor : kit.armor2, F, rectP(l * 0.8, 0.14 * k, 0.03 * k), 0.035 * k, { standoff: 0.008 * k, gap: 0.015 * k });
  };
  both((s) => {
    pod(fX0, fX1, s, true);
    pod(rX0, rX1, s, false);
    // front pod prow: a raised team-colour wedge ahead of the turret disc, with a lamp in its nose
    const nx = 0.93 * kx, nl = 0.38 * kx;
    block(b, kit.armor, nx, podT - 0.03 * k, s * pz, nl, pw * 0.86, 0.14 * k, { top: [0.46, 0.8], shift: [-0.1 * kx, -s * 0.02 * kz], ch: 0.06 * k, bev: 0.02 * k });
    block(b, kit.mech, nx - nl * 0.42, podT + 0.06 * k, s * pz, 0.05 * kx, pw * 0.5, 0.05 * k, { ch: 0.015 * k, bev: 0.008 * k });
    pbox(b, kit.lamp, 0.03 * k, 0.04 * k, 0.16 * kz, fX1 + 0.005, podM - 0.01 * k, s * pz);
    pbox(b, kit.glow, 0.24 * kx, 0.016 * k, 0.02 * k, 0.62 * kx, podT - 0.002, s * (pz + pw * 0.33));
    // rear pod: tail cap (light) and a smoke-grenade bank
    block(b, kit.shell, -0.92 * kx, podT - 0.005, s * pz, 0.2 * kx, pw * 0.8, 0.05 * k, { top: [0.8, 0.85], ch: 0.04 * k, bev: 0.015 * k });
    smokeLaunchers(b, kit, frame([-0.45 * kx, podT, s * (pz + pw * 0.2)], [0, 1, 0], [-Math.cos(0.6), 0, s * Math.sin(0.6)]), 3, 0.028 * k);
    // the gap between front and rear pod: a big joint drum on the frame and a ram bridging the pods
    b.cylb(kit.joint, 0.085 * k, pw * 0.7, 0.012 * k, [0, yt + 0.02 * k, s * (pz - pw * 0.35)], 'z', 12);
    b.cylb(kit.mech, 0.05 * k, pw * 0.74, 0.008 * k, [0, yt + 0.02 * k, s * (pz - pw * 0.37)], 'z', 10);
    piston(b, kit, [rX0 - 0.12 * kx, podM - 0.02 * k, s * (pz + pw * 0.18)], [fX0 + 0.14 * kx, podM - 0.02 * k, s * (pz + pw * 0.18)], 0.026 * k, 0.55, fine);
  });
  // ---- glacis: low team wedge between the front pods (under the turret's front edge), light plate + dark lower plate
  const gw = 2 * (pz - pw / 2) - 2 * G, gX0 = 0.42 * kx, gX1 = 1.06 * kx, gl = gX1 - gX0;
  block(b, kit.armor, (gX0 + gX1) / 2, y0 + 0.04 * k, 0, gl, gw, yt + 0.1 * k - y0 - 0.04 * k, { top: [0.5, 0.9], shift: [-gl * 0.24, 0], ch: 0.08 * k, bev: 0.025 * k, bot: 0.03 * k });
  block(b, kit.shell, gX0 + gl * 0.32, yt + 0.095 * k, 0, gl * 0.36, gw * 0.7, 0.03 * k, { top: [0.8, 0.85], ch: 0.04 * k, bev: 0.012 * k });
  pbox(b, kit.glow, 0.02 * k, 0.025 * k, gw * 0.6, gX1 - 0.03 * kx, yt - 0.02 * k, 0);
  // ---- engine: dark block between the rear pods, louvred grille, twin exhausts out the back, jerry cans left
  const eX0 = -1.04 * kx, eX1 = -0.42 * kx, el = eX1 - eX0, eh = yt + 0.12 * k;
  block(b, kit.armor2, (eX0 + eX1) / 2, yt - 0.04 * k, 0, el, gw, eh - yt + 0.04 * k, { top: [0.9, 0.88], ch: 0.07 * k, bev: 0.02 * k });
  recessPanel(b, kit, frame([(eX0 + eX1) / 2 - 0.04 * kx, eh, 0], [0, 1, 0]), el * 0.5, gw * 0.62, 0.02 * k, { slats: 4, frame: kit.armor2 });
  both((s) => exhaustBox(b, kit, frame([eX0 + 0.02 * kx, yt + 0.02 * k, s * gw * 0.26], [-1, 0, 0], [0, 0, 1]), 0.045 * k, fine));
  towHooks(b, kit, frame([eX0 - 0.004, y0 + 0.12 * k, 0], [-1, 0, 0], [0, 0, 1]), gw * 0.7, 0.035 * k);
  antenna(b, kit, -0.98 * kx, podT + 0.04 * k, -pz, 0.7 * k, 0.008 * k, [-0.15, 0, 0]);
  // ---- turret pedestal: squat octagon (dark base, light ring) narrower than the turret it carries
  b.lathe(kit.armor2, [[0, 0], [R * 0.76, 0], [R * 0.74, 0.08 * k], [R * 0.7, 0.1 * k], [0, 0.1 * k]], [mx, yt + 0.06 * k, 0], 'y', 8);
  b.lathe(kit.shell, [[0, 0], [R * 0.68, 0], [R * 0.66, seatY - yt - 0.18 * k], [R * 0.62, seatY - yt - 0.16 * k], [0, seatY - yt - 0.16 * k]], [mx, yt + 0.16 * k, 0], 'y', 8);
  b.decal(0.12 * k, 0.12 * k, -0.6 * kx, podT + 0.003, pz, atlasUV(1), 0);
  const deckFn = (x: number, z: number) => {
    const az = Math.abs(z);
    if (Math.hypot(x - mx, z) < R * 0.66) return seatY;
    if (az > pz - pw / 2 && az < pz + pw / 2 && ((x > fX0 && x < fX1) || (x < rX0 && x > rX1))) return podT;
    if (az < gw / 2 && x > gX0 && x < gX1) return yt + 0.1 * k;
    if (az < gw / 2 && x > eX0 && x < eX1) return eh;
    return Math.abs(x) <= kx && az <= kz ? yt + 0.1 * k : -1;
  };
  return {
    deckAt: deckFn, top: seatY + 0.1 * k, custom: true,
    seat: (m) => {
      if (m === main) {
        collar(b, kit, m.x, seatY, m.z, m.r, seatY - 0.03 * k, 16);
        return { y: seatY, socket: true };
      }
      // a utility rides the engine deck behind the turret
      return { y: ringSeat(b, kit, m, Math.max(eh, deckFn(m.x, m.z)), 0.02 * k, 12), socket: true };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
function longarm(c: ChassisCtx): ChassisOut {
  // Long-gun CARRIER: one huge gun set far back on a raised shoulder yoke, balanced by a heavy engine COUNTERWEIGHT
  // behind it with radiator fins splayed out like a tail, recoil spades on rams at the very back, and a long, low,
  // segmented prow running out ahead under the barrel to a castor pair. From above: a long thin spine, the gun disc
  // two thirds back, a wide finned block at the tail. Assembly: dark keel and spine beam show in the gaps between the
  // three prow segments (team / light / team), light yoke cheeks either side of the dark pedestal with rams in the gap.
  const { b, kit, L, W, S, stance } = c;
  const kx = L / 3, kz = W, k = Math.min(kx, kz);
  const fine = fineFor(S);
  const X = (f: number) => f * kx, Z = (f: number) => f * kz;
  const y0 = stance.y0, yt = Math.max(stance.yt, y0 + 0.12 * k);
  const main = biggest(c.mounts);
  const mx = main?.x ?? X(-0.51), R = main?.r ?? 0.4 * k;
  const seatY = yt + 0.17 * k;
  const G = 0.04 * k;
  // ---- keel: dark structure from the tail to the castor fork, a steel spine beam along the top of it
  block(b, kit.mech, X(-0.4), y0, 0, X(2.2), Z(0.44), yt - y0 + 0.02 * k, { ch: 0.06 * k, bev: 0.02 * k, top: [0.98, 0.9] });
  b.cylb(kit.joint, 0.035 * k, X(1.9), 0.008 * k, [X(-0.4), yt - 0.02 * k, 0], 'x', 8);
  // ---- long low prow: three segments (team / light / team) on shadow gaps, stepping down to the nose
  const pro: [number, number, number, number, number, MatLike, MatLike][] = [
    // x0, x1, y bottom, y top, width, body, cap
    [X(-0.06), X(0.5), y0 + 0.02 * k, yt + 0.07 * k, Z(0.5), kit.armor, kit.shell],
    [X(0.5) + G, X(1.0), yt - 0.14 * k, yt + 0.04 * k, Z(0.44), kit.shell, kit.armor2],
    [X(1.0) + G, X(1.52), yt - 0.12 * k, yt + 0.0 * k, Z(0.38), kit.armor, kit.shell],
  ];
  pro.forEach(([x0, x1, yb, ytp, w, mat, cap], i) => {
    const l = x1 - x0, nose = i === 2;
    block(b, mat, (x0 + x1) / 2, yb, 0, l, w, ytp - yb, { top: nose ? [0.55, 0.78] : [0.92, 0.84], shift: [nose ? -l * 0.2 : 0, 0], ch: 0.06 * k, bev: 0.02 * k });
    block(b, cap, (x0 + x1) / 2 - (nose ? l * 0.18 : 0), ytp - 0.004, 0, l * (nose ? 0.4 : 0.66), w * 0.56, 0.03 * k, { top: [0.86, 0.8], ch: 0.03 * k, bev: 0.01 * k });
  });
  // castor fork over the nose wheels, lamps and a glow bar in the nose
  block(b, kit.mech, X(1.14), yt - 0.18 * k, 0, X(0.22), Z(0.34), 0.08 * k, { ch: 0.03 * k, bev: 0.01 * k });
  both((s) => b.box(kit.lamp, 0.02 * k, 0.035 * k, 0.07 * k, X(1.53), yt - 0.07 * k, s * Z(0.11), 0.008 * k));
  pbox(b, kit.glow, 0.24 * kx, 0.014 * k, 0.018 * k, X(0.76), yt + 0.045 * k, 0);
  // driver's pod on the left of the first segment: dark box with a visor
  const cx = X(0.3), cz = -Z(0.17);
  b.g(bevBox(0.2 * k, 0.07 * k, Z(0.13), 0.012 * k), kit.armor2, mtx([cx, yt + 0.105 * k, cz]));
  b.g(bevBox(0.02 * k, 0.03 * k, Z(0.1), 0.004 * k), kit.glass, mtx([cx + 0.1 * k, yt + 0.11 * k, cz]));
  // barrel rest: A-frame on the middle segment with a hazard cradle
  const tx = X(0.86), tb = yt + 0.04 * k, th = 0.16 * k;
  both((s) => b.g(strutGeo([tx - 0.07 * k, tb, s * Z(0.12)], [tx, tb + th, s * Z(0.05)], 0.014 * k, 0.012 * k, 5), kit.joint));
  b.g(new THREE.BoxGeometry(0.05 * k, 0.025 * k, Z(0.15)), kit.hazard, mtx([tx, tb + th, 0]));
  // ---- gun shoulder: dark pedestal, light yoke cheeks over the tracks, rams in the gaps between them
  const shL = 2 * R * 0.95;
  block(b, kit.armor2, mx, yt - 0.06 * k, 0, shL * 0.9, Z(0.42), seatY - yt + 0.03 * k, { top: [0.8, 0.84], ch: 0.1 * k, bev: 0.02 * k });
  both((s) => {
    block(b, kit.shell, mx, yt - 0.1 * k, s * Z(0.37), shL, Z(0.2), seatY - yt + 0.07 * k, { top: [0.8, 0.7], shift: [0, -s * Z(0.02)], ch: 0.06 * k, bev: 0.025 * k });
    // team plate hung on each cheek over the track
    armorPlate(b, kit, kit.armor, frame([mx, yt - 0.04 * k, s * Z(0.47)], [0, 0.15, s], [1, 0, 0]), rectP(shL * 0.8, 0.12 * k, 0.03 * k), 0.03 * k, { standoff: 0.006 * k, gap: 0.012 * k });
    piston(b, kit, [mx + shL * 0.42, yt - 0.02 * k, s * Z(0.25)], [mx - shL * 0.25, seatY - 0.04 * k, s * Z(0.25)], 0.024 * k, 0.55, false);
  });
  // ---- counterweight: twin engine nacelles flanking a low dark engine deck behind the gun (the weapon body's own rear
  // swings down between them when the gun elevates), light caps, dark radiator fins splayed out like a tail
  const cwX0 = mx - R - 0.06 * k, cwX1 = X(-1.5), cwL = cwX0 - cwX1, cwC = (cwX0 + cwX1) / 2, cwT = seatY - 0.01 * k;
  const nz = Z(0.4), nw = Z(0.26);
  block(b, kit.armor2, cwC, yt - 0.08 * k, 0, cwL, Z(0.5), 0.13 * k, { top: [0.96, 0.9], ch: 0.06 * k, bev: 0.02 * k });
  recessPanel(b, kit, frame([cwC + 0.02 * kx, yt + 0.05 * k, 0], [0, 1, 0]), cwL * 0.6, Z(0.2), 0.015 * k, { slats: 3, frame: kit.armor2 });
  b.cylb(kit.joint, 0.05 * k, 2 * nz - nw * 0.6, 0.008 * k, [cwX0 - cwL * 0.2, yt + 0.02 * k, -(nz - nw * 0.3)], 'z', 10);
  both((s) => {
    block(b, kit.armor, cwC - 0.02 * kx, yt - 0.14 * k, s * nz, cwL, nw, cwT - yt + 0.14 * k, { top: [0.84, 0.78], shift: [-0.04 * kx, s * Z(0.01)], ch: 0.07 * k, bev: 0.025 * k, bot: 0.03 * k });
    block(b, kit.shell, cwC - 0.06 * kx, cwT - 0.005, s * nz, cwL * 0.5, nw * 0.6, 0.04 * k, { top: [0.82, 0.8], ch: 0.03 * k, bev: 0.012 * k });
    const nF = 3;
    for (let i = 0; i < nF; i++) {
      const fx = cwX0 - cwL * (0.18 + (0.62 * i) / (nF - 1)), fl = Z(0.16) + i * 0.035 * k, z0 = nz + nw * 0.42;
      pbox(b, kit.mech, 0.03 * k, 0.2 * k, fl, fx, yt + 0.06 * k, s * (z0 + fl / 2), [0, s * 0.14, 0]);
      pbox(b, kit.glow, 0.032 * k, 0.012 * k, fl * 0.6, fx, yt + 0.165 * k, s * (z0 + fl * 0.55), [0, s * 0.14, 0]);
    }
    b.cylb(kit.joint, 0.018 * k, cwL * 0.75, 0.004 * k, [cwX0 - cwL * 0.1, yt + 0.1 * k, s * (nz + nw * 0.45)], '-x', 6);
    exhaustBox(b, kit, frame([cwX1 + 0.05 * kx, cwT - 0.03 * k, s * nz], [0, 1, 0], [-1, 0, 0]), 0.035 * k, false);
  });
  antenna(b, kit, cwX0 - 0.1 * kx, cwT, -nz, 0.7 * k, 0.008 * k, [-0.15, 0, 0]);
  // ---- recoil spades at the tail on hydraulic arms (dug in when grounded, raised otherwise)
  const g = grounded(c);
  both((s) => {
    const a: V3 = [X(-1.42), y0 + 0.12 * k, s * Z(0.2)];
    const e: V3 = g ? [X(-1.78), 0.12 * k, s * Z(0.36)] : [X(-1.66), y0 + 0.24 * k, s * Z(0.34)];
    beam(b, kit.armor2, a, e, 0.06 * k, 0.07 * k);
    piston(b, kit, [X(-1.36), yt + 0.02 * k, s * Z(0.14)], [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2 + 0.04 * k, s * Z(0.28)], 0.02 * k, 0.55, fine);
    spade(b, kit, new THREE.Matrix4().makeRotationY(-Math.PI / 2).multiply(new THREE.Matrix4().makeRotationX(g ? -0.4 : 0.6)).setPosition(e[0] - 0.02 * k, e[1] + 0.02 * k, e[2]), 0.2 * k, g ? 0.16 * k : 0.12 * k, 0.02 * k, kit.shell);
  });
  const deck = (x: number, z: number) => {
    const az = Math.abs(z);
    if (x > cwX1 && x < cwX0 && Math.abs(az - nz) < nw / 2) return cwT;
    if (x > cwX1 && x < cwX0 && az < Z(0.25)) return yt + 0.05 * k;
    if (Math.abs(x - mx) < shL / 2 && az < Z(0.47)) return seatY;
    for (const [x0, x1, , ytp, w] of pro) if (x >= x0 && x <= x1 && az < w / 2) return ytp;
    return Math.abs(x) <= X(1.5) && az < Z(0.25) ? yt : -1;
  };
  return {
    deckAt: deck, top: cwT + 0.1 * k, custom: true, dressed: true,
    seat: (m) => {
      if (m === main) { collar(b, kit, m.x, seatY, m.z, m.r, seatY - 0.03 * k, 16); return { y: seatY, socket: true }; }
      return { y: ringSeat(b, kit, m, Math.max(yt, deck(m.x, m.z)), 0.02 * k, 12), socket: true };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
function colossus(c: ChassisCtx): ChassisOut {
  // Multi-turret heavy (walks or rolls) as a MODULAR assembly (Mechabellum / modular-mech style): a dark structural
  // frame carrying separate modules with deep gaps between them, each in its own role colour:
  //   centre    team-colour main module (the centre guns), framed panel grid on its flanks
  //   nose      light wedge module with a dark lower plate; rear: dark engine module with grilles + exhaust stacks
  //   casemates light container-like side modules over the flanks carrying the side guns: team roof cap, framed
  //             recessed panels, vertical ribs, a dark band, joined to the centre by dark beams and hydraulic rams
  // Asymmetric: driver's hatch + periscopes front-left, ladder on the left casemate, antennas + cans left rear.
  const { b, kit, L, W, S, stance } = c;
  const kx = L / 4, kz = W / 3, k = Math.min(kx, kz);
  const fine = fineFor(S);
  const y0 = stance.y0;
  const X = (f: number) => f * kx, Z = (f: number) => f * kz;
  const G = 0.05 * k, deckY = y0 + 0.62, pTop = y0 + 0.74;
  // ---- frame: dark keel the modules sit on (shows in every gap)
  block(b, kit.mech, X(-0.1), y0, 0, X(3.7), Z(1.3), 0.3, { ch: 0.1 * k, bev: 0.03 * k, bot: 0.04 * k });
  // ---- centre module (team colour)
  const cX0 = X(-1.45), cX1 = X(1.15), cW = Z(1.04);
  block(b, kit.armor, (cX0 + cX1) / 2, y0 + 0.08, 0, cX1 - cX0, cW, deckY - y0 - 0.08, { top: [0.97, 0.9], ch: 0.12 * k, bev: 0.035 * k });
  both((s) => {
    for (const gx of [-0.9, -0.15, 0.6]) recessPanel(b, kit, frame([X(gx), y0 + 0.36, s * cW / 2], [0, 0, s], [1, 0, 0]), X(0.6), 0.2, 0.02 * k, { frame: kit.armor });
  });
  // ---- nose module: light wedge, dark lower plate, caged lamps
  const nX0 = cX1 + G, nX1 = X(2.02), nl = nX1 - nX0;
  block(b, kit.shell, (nX0 + nX1) / 2, y0 + 0.12, 0, nl, Z(0.96), deckY - y0 - 0.16, { top: [0.4, 0.86], shift: [-nl * 0.3, 0], ch: 0.1 * k, bev: 0.03 * k });
  block(b, kit.armor2, X(1.86), y0 + 0.02, 0, X(0.36), Z(0.8), 0.14, { top: [0.6, 0.9], shift: [-X(0.05), 0], ch: 0.05 * k, bev: 0.015 * k });
  both((s) => cagedLamp(b, kit, frame([X(1.72), y0 + 0.36, s * Z(0.36)], [0, 1, 0], [1, 0, 0]), 0.07 * k, fine));
  // ---- rear engine module (dark), grilles on top, twin exhaust stacks out the back
  const rX0 = X(-2.02), rX1 = cX0 - G, rl = rX1 - rX0, rh = 0.46;
  block(b, kit.armor2, (rX0 + rX1) / 2, y0 + 0.08, 0, rl, Z(1.1), rh, { top: [0.9, 0.88], ch: 0.1 * k, bev: 0.03 * k });
  recessPanel(b, kit, frame([(rX0 + rX1) / 2, y0 + 0.08 + rh, 0], [0, 1, 0]), rl * 0.6, Z(0.7), 0.03 * k, { slats: 5, frame: kit.armor2 });
  both((s) => exhaustBox(b, kit, frame([rX0 + X(0.06), y0 + 0.3, s * Z(0.36)], [-1, 0, 0], [0, 0, 1]), 0.06 * k, fine));
  towHooks(b, kit, frame([rX0 - 0.005, y0 + 0.2, 0], [-1, 0, 0], [0, 0, 1]), Z(0.7), 0.05 * k);
  // ---- side casemates (light container modules) over the flanks, carrying the side guns
  const side = c.mounts.filter((m) => Math.abs(m.z) > 0.4 * kz);
  const sx = side.length ? side[0].x : X(0.08), sz = side.length ? Math.abs(side[0].z) : Z(0.9);
  const hw = Z(0.4), zc = sz + Z(0.12), cl = X(1.9), cy0 = y0 + 0.1;
  both((s) => {
    block(b, kit.shell, sx, cy0, s * zc, cl, hw * 2, pTop - cy0 - 0.045 * k, { top: [0.9, 0.9], shift: [-X(0.05), 0], ch: 0.1 * k, bev: 0.025 * k });
    // team roof cap, dark band round the base, vertical ribs and a framed panel grid on the outer flank
    block(b, kit.armor, sx - X(0.04), pTop - 0.05 * k, s * zc, cl * 0.84, hw * 1.7, 0.05 * k, { top: [0.94, 0.9], ch: 0.06 * k, bev: 0.015 * k });
    block(b, kit.armor2, sx, cy0 - 0.02, s * zc, cl * 1.02, hw * 2.04, 0.1, { ch: 0.1 * k, bev: 0.02 * k });
    const ox = s * (zc + hw);
    for (let i = 0; i < 4; i++) b.box(kit.mech, 0.035 * k, (pTop - cy0) * 0.62, 0.03 * k, sx - cl * 0.36 + i * cl * 0.24, cy0 + 0.1 + (pTop - cy0) * 0.31, ox + s * 0.012 * k, 0.008 * k);
    for (let i = 0; i < 3; i++) recessPanel(b, kit, frame([sx - cl * 0.24 + i * cl * 0.24, cy0 + 0.1 + (pTop - cy0) * 0.34, ox], [0, 0, s], [1, 0, 0]), cl * 0.18, (pTop - cy0) * 0.42, 0.02 * k, { frame: kit.shell, slats: i === 1 ? 4 : 0 });
    // connectors to the centre module: two dark beams and a ram in the gap
    for (const bx of [sx - cl * 0.3, sx + cl * 0.25]) beam(b, kit.mech, [bx, y0 + 0.3, s * cW * 0.45], [bx, y0 + 0.3, s * (zc - hw + 0.02)], 0.09 * k, 0.12 * k);
    piston(b, kit, [sx - cl * 0.05, y0 + 0.46, s * cW * 0.47], [sx - cl * 0.05, y0 + 0.5, s * (zc - hw * 0.9)], 0.025 * k, 0.5, fine);
    smokeLaunchers(b, kit, frame([sx + cl * 0.42, pTop, s * (zc + hw * 0.5)], [0, 1, 0], [Math.cos(0.45), 0, s * Math.sin(0.45)]), 3, 0.028 * k);
  });
  ladder(b, kit, [sx - cl * 0.36, 0.05, -(zc + hw) - 0.03 * k], [sx - cl * 0.36, pTop, -(zc + hw) - 0.03 * k], 0.13 * k, [1, 0, 0], [0, 0, -1], 0.03 * k);
  // ---- deck kit: driver's hatch front-left, antennas + jerry cans left rear
  crewHatch(b, kit, frame([X(0.9), deckY, -Z(0.26)], [0, 1, 0]), 0.08 * k, fine);
  periscopes(b, kit, X(1.02), deckY, -Z(0.26), 3, 0.04 * k);
  jerryCans(b, kit, frame([(rX0 + rX1) / 2, y0 + 0.08 + rh, -Z(0.44)], [0, 1, 0], [1, 0, 0]), 2, 0.08 * k);
  antenna(b, kit, rX0 + X(0.12), y0 + 0.08 + rh, -Z(0.46), 1.0 * k, 0.009 * k, [-0.15, 0, 0]);
  antenna(b, kit, X(-1.2), deckY, -Z(0.4), 0.7 * k, 0.008 * k, [-0.1, 0, 0]);
  b.decal(0.24 * k, 0.24 * k, X(0.4), deckY + 0.004, Z(0.3), atlasUV(1), 0);
  const deck = (x: number, z: number) => {
    const az = Math.abs(z);
    if (az > zc - hw && az < zc + hw && x > sx - cl / 2 && x < sx + cl / 2) return pTop;
    if (az < cW / 2 && x > cX0 && x < cX1) return deckY;
    if (az < cW / 2 && x >= cX1 && x < nX1) return y0 + 0.12 + (deckY - y0 - 0.16) * Math.max(0, 1 - (x - nX0) / nl);
    if (az < Z(0.55) && x <= rX1 && x > rX0) return y0 + 0.08 + rh;
    return Math.abs(x) < X(2) && az < Z(1.4) ? y0 + 0.3 : -1;
  };
  const H = { deck };
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
registerChassis(['long', 'longarm'], longarm);
registerChassis('colossus', colossus);
registerChassis('siegeplat', siegeplat);
registerChassis('juggernaut', juggernaut);
