// Legged locomotion: bipeds (legs, titanlegs; jump legs live in mobility/jumpjets.ts) and multi-leg spiders. Thick, load-bearing legs built from
// chunky segments: a big hip drum, an armoured thigh with a hydraulic ram, a knee drum + knee cap, an armoured shin
// with a calf ram, and broad feet (three-toed stompers for bipeds, splayed claw pads for spiders). 2-bone IK per leg.
//
// Each leg is three groups (thigh, shin, foot) with manual matrices, so the render adapter instances them as animated
// nodes. Hip positions come from the chassis (ChassisOut.hips) or the defaults below.

import * as THREE from 'three';
import { Bld, strutGeo, type V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerMobility, type Hip, type Stance, type StanceIn } from '../chassis/registry.ts';
import { block } from '../chassis/shapes.ts';
import { armorPlate, cableBundle, frame, frameLimb, hose, jointDrum, piston, plateStack, rectP, trapP } from '../chassis/hs-kit.ts';
import { claw, limbSegs, limbShell, spike } from '../chassis/hs-kit-organic.ts';

export interface Leg { step(t: number, moving: number): void }

/** half-stride (cells) that keeps planted feet from skating under render3d's odometer clock (units-adapter phaseFor) */
export function strideFor(mobId: string, S: number): number {
  return mobId === 'spider' ? 0.14 + 0.17 * S : 0.2 + 0.2 * S;
}

export function legStance(s: StanceIn): Stance {
  const m = Math.min(s.L, s.W);
  if (s.mobId === 'spider') {
    const hipY = 0.19 * m + 0.1, t = (0.05 * m + 0.035) * 0.88;
    return { y0: hipY - t * 1.3, yt: hipY + t * 0.4, wi: s.W * 0.34, tracked: false, legs: 'spider', thick: t, hipY };
  }
  // titan-class legs carry far more mass: thicker for the same reach
  // (x0.88: slimmer structure; walkers read as machines when the frame is thinner than the masses it carries)
  const hipY = 0.4 * m + 0.12, t = (0.062 * m + 0.04) * (s.mobId === 'titanlegs' ? 1.2 : 1) * 0.88;
  return { y0: hipY - t * 0.5, yt: hipY + t * 0.6, wi: s.W * 0.34, tracked: false, legs: 'biped', thick: t, hipY };
}

/** default hips for hulls that do not place their own */
export function defaultHips(st: Stance, L: number, W: number): Hip[] {
  const t = st.thick;
  if (st.legs === 'spider') {
    const out: Hip[] = [];
    // 1x1 hulls (size-1 squads of 16) walk on four legs (diagonal trot) to stay inside the S1 triangle budget
    const quad = L <= 1.01 && W <= 1.01;
    for (const row of quad ? [-1, 1] : [-1, 0, 1]) for (const side of [-1, 1] as const) {
      const x = row * L * (quad ? 0.26 : 0.3), z = side * W * 0.36;
      const phase = quad ? (row === side ? 0 : Math.PI) : ((row + 1) % 2 === (side > 0 ? 1 : 0) ? 0 : Math.PI);
      out.push({ p: [x, st.hipY, z], side, t, foot: [x + row * L * (quad ? 0.24 : 0.16), 0, side * (W * 0.5 + st.hipY * 1.15)], phase });
    }
    return out;
  }
  return ([-1, 1] as const).map((side) => ({ p: [-0.02 * L, st.hipY, side * W * 0.27] as V3, side, t, foot: [-0.02 * L, 0, side * W * 0.31] as V3, phase: side > 0 ? Math.PI : 0 }));
}

// ---- segment geometry (local frame: +Z along the bone, +Y toward the knee/bend side, X across) ----------------------
const ring = (z: number, wx: number, wy: number, c = 0.3): V3[] => [
  [-wx * (1 - c), -wy, z], [wx * (1 - c), -wy, z], [wx, -wy * (1 - c), z], [wx, wy * (1 - c), z],
  [wx * (1 - c), wy, z], [-wx * (1 - c), wy, z], [-wx, wy * (1 - c), z], [-wx, -wy * (1 - c), z],
];

// ---- multi-leg (spider) segments, hard-surface (chassis/hs-kit.ts + hs-kit-organic.ts). Local frame: +Z along the
// bone, +Y the dorsal / outer side (toward the knee bend), X across (the joint axis).
//   'mech'    a dark twin-strut skeleton under stacked armour plates on shadow gaps, joint drums, a hydraulic ram under
//             every bone, a stepped toe pad (machines walking on legs: striders, saucers, trains, tanks on legs)
//   'organic' arthropod limbs: a thin dark core under overlapping chitin shells (faceted, thick, shingled down the
//             bone), sinew cable runs instead of rams, spurs at the knee, a hooked claw tip (crawlers, the brood)
export type LegStyle = 'mech' | 'organic';

/** joint drum across the bone (axis x): the full hs-kit drum with pin caps on fine legs, a plain bevelled drum with one
 *  dark hub ring otherwise (half the triangles: spider legs come four to eight at a time) */
function legDrum(b: Bld, kit: Kit, z: number, r: number, w: number, fine: boolean) {
  if (fine) { jointDrum(b, kit, [0, 0, z], r, w, 'x'); return; }
  b.cylb(kit.joint, r, w, r * 0.12, [-w / 2, 0, z], 'x', 8);
  b.cyl(kit.mech, r * 0.62, r * 0.62, w * 1.12, [-w * 0.56, 0, z], 'x', 6);
}

function spThigh(b: Bld, kit: Kit, l: number, t: number, style: LegStyle, fine: boolean, lite: boolean) {
  const org = style === 'organic';
  if (lite) {
    // cheap: hip drum, one dark spar, one dorsal shell, knee drum
    b.cylb(kit.mech, t * 1.0, t * 1.5, t * 0.15, [-t * 0.75, 0, 0], 'x', 7);
    b.g(strutGeo([0, 0, t * 0.4], [0, 0, l], t * 0.5, t * 0.4, 5), kit.mech);
    if (org) limbShell(b, kit.armor, l * 0.06, l * 0.94, t * 0.7, t * 0.32, t * 0.22, t * 0.2, { tp: 0.7, cols: 2 });
    else armorPlate(b, kit, kit.armor, frame([0, t * 0.3, l * 0.5], [0, 1, 0], [0, 0, 1]), trapP(l * 0.8, t * 0.95, t * 1.25, t * 0.14), t * 0.2, { standoff: t * 0.12, back: null });
    b.cylb(kit.joint, t * 0.62, t * 1.15, t * 0.1, [-t * 0.58, 0, l], 'x', 6);
    return;
  }
  legDrum(b, kit, 0, t * 1.02, t * 1.6, fine);
  if (org) {
    // dark tapering core, two chitin shells down the dorsal side, a ventral plate, sinew cables underneath
    b.loft(kit.mech, [ring(t * 0.4, t * 0.46, t * 0.5), ring(l * 0.5, t * 0.42, t * 0.46), ring(l * 0.94, t * 0.34, t * 0.36)]);
    limbSegs(b, [kit.armor, kit.armor2], t * 0.5, l * 0.92, 2, t * 0.78, t * 0.42, t * 0.24, t * 0.2, 0.74, 3);
    limbShell(b, kit.shell, l * 0.18, l * 0.78, t * 0.5, t * 0.16, t * 0.36, t * 0.14, { sign: -1, tp: 0.8, cols: 2 });
    cableBundle(b, kit, [t * 0.42, -t * 0.42, l * 0.1], [t * 0.36, -t * 0.4, l * 0.88], t * 0.08, [1, 0, 0], fine ? 2 : 1, 0.05);
    // knee spur: a short spike rising off the knee, raked back toward the hip
    spike(b, kit.armor2, [0, t * 0.5, l * 0.9], [0, t * 1.5, l * 0.72], t * 0.26);
  } else {
    frameLimb(b, kit, [0, 0, t * 0.5], [0, 0, l * 0.95], t * 0.18, [t * 0.36, 0, 0]);
    plateStack(b, kit, kit.armor2, frame([0, t * 0.18, l * 0.5], [0, 1, 0], [0, 0, 1]), trapP(l * 0.78, t * 1.05, t * 1.4, t * 0.16), [
      { inset: 0, thick: t * 0.2, standoff: t * 0.22 },
      { inset: t * 0.2, thick: t * 0.15, shift: [l * 0.08, 0], mat: kit.armor },
    ], { gap: t * 0.16 });
    piston(b, kit, [0, -t * 0.46, l * 0.12], [0, -t * 0.42, l * 0.84], t * 0.17, 0.55, fine);
    if (fine) cableBundle(b, kit, [t * 0.5, -t * 0.12, l * 0.1], [t * 0.44, -t * 0.2, l * 0.88], t * 0.06, [0, 1, 0], 2, 0.04);
  }
  legDrum(b, kit, l, t * 0.74, t * 1.36, fine);
}

function spShin(b: Bld, kit: Kit, l: number, t: number, style: LegStyle, fine: boolean, lite: boolean) {
  const org = style === 'organic';
  if (lite) {
    b.g(strutGeo([0, 0, t * 0.3], [0, 0, l * 0.96], t * 0.44, t * 0.3, 5), kit.mech);
    if (org) limbShell(b, kit.armor2, l * 0.04, l * 0.6, t * 0.6, t * 0.26, t * 0.2, t * 0.18, { tp: 0.55, cols: 2 });
    else armorPlate(b, kit, kit.armor2, frame([0, t * 0.26, l * 0.32], [0, 1, 0], [0, 0, 1]), trapP(l * 0.5, t * 0.7, t * 1.05, t * 0.12), t * 0.18, { standoff: t * 0.1, back: null });
    return;
  }
  if (org) {
    // tapering core into a long claw, three shingled chitin shells, a pair of spines on the outer edge, sinew
    b.loft(kit.mech, [ring(t * 0.3, t * 0.4, t * 0.42), ring(l * 0.5, t * 0.32, t * 0.34), ring(l * 0.86, t * 0.18, t * 0.2)]);
    limbSegs(b, [kit.armor2, kit.armor, kit.armor2], t * 0.3, l * 0.8, 3, t * 0.72, t * 0.38, t * 0.2, t * 0.18, 0.5, 3);
    for (const f of [0.3, 0.55]) spike(b, kit.joint, [t * 0.3, t * 0.45, l * f], [t * 0.5, t * 1.05, l * (f - 0.08)], t * 0.12);
    hose(b, kit, [-t * 0.3, -t * 0.36, l * 0.06], [-t * 0.2, -t * 0.26, l * 0.7], t * 0.07, 0.04, 3);
    b.g(strutGeo([0, 0, l * 0.82], [0, 0, l], t * 0.22, t * 0.1, 4), kit.joint);
    return;
  }
  frameLimb(b, kit, [0, 0, t * 0.4], [0, 0, l * 0.84], t * 0.16, [t * 0.3, 0, 0]);
  plateStack(b, kit, kit.armor2, frame([0, t * 0.14, l * 0.4], [0, 1, 0], [0, 0, 1]), trapP(l * 0.66, t * 0.8, t * 1.25, t * 0.14), [
    { inset: 0, thick: t * 0.18, standoff: t * 0.22 },
    { inset: t * 0.18, thick: t * 0.13, shift: [-l * 0.08, 0], mat: kit.shell },
  ], { gap: t * 0.14 });
  // knee cap overhanging the knee drum
  armorPlate(b, kit, kit.armor, frame([0, t * 0.58, t * 0.08], [0, 0.85, -0.5], [1, 0, 0]), trapP(t * 1.25, t * 0.85, t * 0.62, t * 0.12), t * 0.18, { standoff: t * 0.06 });
  piston(b, kit, [0, -t * 0.4, l * 0.08], [0, -t * 0.32, l * 0.7], t * 0.14, 0.55, fine);
  // lower leg: dark tapering strut to the foot pivot, a collar at the transition
  b.g(strutGeo([0, 0, l * 0.8], [0, 0, l], t * 0.4, t * 0.32, 6), kit.mech);
  b.cyl(kit.joint, t * 0.46, t * 0.46, t * 0.14, [0, 0, l * 0.8], 'z', 6);
}

function spFoot(b: Bld, kit: Kit, t: number, style: LegStyle, fine: boolean, lite: boolean) {
  if (style === 'organic') {
    // hooked claw tip: a small dark hoof, three claws splayed forward and out, a heel spur
    b.cyl(kit.mech, t * 0.5, t * 0.62, t * 0.36, [0, 0.0, 0], 'y', 5);
    if (lite) { spike(b, kit.joint, [0, t * 0.1, 0], [t * 0.7, 0, 0], t * 0.3); return; }
    for (const a of [-0.7, 0, 0.7]) claw(b, kit.joint, [0, t * 0.16, 0], [Math.cos(a) * t * 0.55, t * 0.24, Math.sin(a) * t * 0.55], [Math.cos(a) * t * 1.05, 0, Math.sin(a) * t * 1.05], t * 0.17);
    spike(b, kit.armor2, [0, t * 0.2, 0], [-t * 0.75, t * 0.02, 0], t * 0.18);
    return;
  }
  // stepped pad: rubber sole, dark hub, armoured toe plates in three directions
  b.cyl(kit.rubber, t * 0.95, t * 0.85, t * 0.18, [0, 0, 0], 'y', 6);
  b.cylb(kit.mech, t * 0.62, t * 0.42, t * 0.08, [0, t * 0.16, 0], 'y', 6);
  if (lite) return;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    armorPlate(b, kit, kit.armor, frame([Math.cos(a) * t * 0.68, t * 0.2, Math.sin(a) * t * 0.68], [Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5], [Math.cos(a), 0, Math.sin(a)]), trapP(t * 0.75, t * 0.4, t * 0.62, t * 0.08), t * 0.12, { standoff: t * 0.03, back: null });
  }
  if (fine) b.cyl(kit.joint, t * 0.22, t * 0.22, t * 0.3, [0, t * 0.5, 0], 'y', 6);
}

// ---- cheap biped segments (size-1 walkers): the hard-surface read (dark spar, one armour shell on a shadow gap, joint
// drums, a calf ram) at a fraction of the triangles
function liteThigh(b: Bld, kit: Kit, l: number, t: number) {
  b.cylb(kit.joint, t * 1.05, t * 1.7, t * 0.15, [-t * 0.85, 0, 0], 'x', 8);
  b.g(strutGeo([0, 0, t * 0.4], [0, 0, l], t * 0.48, t * 0.4, 5), kit.mech);
  armorPlate(b, kit, kit.armor, frame([0, t * 0.36, l * 0.46], [0, 1, 0], [0, 0, 1]), trapP(l * 0.72, t * 1.1, t * 1.45, t * 0.16), t * 0.24, { standoff: t * 0.16 });
  b.g(strutGeo([0, -t * 0.55, l * 0.15], [0, -t * 0.5, l * 0.8], t * 0.18, t * 0.18, 4), kit.joint);
  b.cylb(kit.mech, t * 0.74, t * 1.5, t * 0.1, [-t * 0.75, 0, l], 'x', 7);
}
function liteShin(b: Bld, kit: Kit, l: number, t: number) {
  b.g(strutGeo([0, 0, t * 0.3], [0, 0, l], t * 0.4, t * 0.32, 5), kit.mech);
  armorPlate(b, kit, kit.armor2, frame([0, t * 0.3, l * 0.44], [0, 1, 0], [0, 0, 1]), trapP(l * 0.7, t * 0.85, t * 1.2, t * 0.14), t * 0.2, { standoff: t * 0.14 });
  armorPlate(b, kit, kit.armor, frame([0, t * 0.5, t * 0.1], [0, 0.85, -0.5], [1, 0, 0]), trapP(t * 1.2, t * 0.8, t * 0.6, t * 0.12), t * 0.18, { standoff: t * 0.05, back: null });
  b.g(strutGeo([0, -t * 0.45, l * 0.1], [0, -t * 0.38, l * 0.75], t * 0.15, t * 0.15, 4), kit.joint);
  b.cylb(kit.joint, t * 0.55, t * 1.2, t * 0.08, [-t * 0.6, 0, l], 'x', 6);
}
function liteFoot(b: Bld, kit: Kit, t: number) {
  b.slab(kit.rubber, rectP(t * 3.6, t * 2.2, t * 0.5), t * 0.2, t * 0.05, t * 0.3, 0, 0);
  block(b, kit.mech, -t * 0.1, t * 0.18, 0, t * 2.0, t * 1.5, t * 0.55, { top: [0.66, 0.74], ch: t * 0.3, bev: t * 0.06 });
  armorPlate(b, kit, kit.armor, frame([t * 1.15, t * 0.24, 0], [0.45, 1, 0], [1, 0, 0]), trapP(t * 1.3, t * 1.9, t * 1.5, t * 0.3), t * 0.16, { standoff: t * 0.04, back: null });
}

// ---- hard-surface biped segments (chassis/hs-kit.ts): a dark twin-strut skeleton, separate armour shells on shadow
// gaps (front plate stacks, side shells, knee cap), exposed joint drums with actuator rings, paired pistons on the back
// of each bone, hose runs, armoured toe plates. Same local frames as the segment builders above.
export function hsThigh(b: Bld, kit: Kit, l: number, t: number, fine: boolean, heavy = false) {
  // heavy (titan) legs: a solid dark core inside the frame, so the leg reads load-bearing, plus a third plate layer
  if (heavy) b.loft(kit.mech, [ring(t * 0.4, t * 0.6, t * 0.62), ring(l * 0.5, t * 0.58, t * 0.6), ring(l * 0.92, t * 0.5, t * 0.5)]);
  jointDrum(b, kit, [0, 0, 0], t * 1.12, t * 1.9, 'x');
  b.cyl(kit.mech, t * 1.26, t * 1.26, t * 0.34, [-t * 0.17, 0, 0], 'x', 12);
  frameLimb(b, kit, [0, 0, t * 0.6], [0, 0, l * 0.96], t * 0.2, [t * 0.4, 0, 0]);
  plateStack(b, kit, kit.armor2, frame([0, t * 0.16, l * 0.47], [0, 1, 0], [0, 0, 1]), trapP(l * 0.74, t * 1.4, t * 1.75, t * 0.16), [
    { inset: 0, thick: t * 0.22, standoff: t * 0.26 },
    { inset: t * 0.22, thick: t * 0.16, shift: [l * 0.1, 0], mat: kit.armor },
    ...(heavy ? [{ inset: t * 0.3, thick: t * 0.12, shift: [l * 0.16, 0] as [number, number], mat: kit.armor2 }] : []),
  ], { gap: t * 0.18 });
  for (const sx of [-1, 1]) armorPlate(b, kit, kit.armor, frame([sx * t * 0.6, -t * 0.05, l * 0.36], [sx, 0, 0], [0, 0, 1]), rectP(l * 0.42, t * 0.95, t * 0.12), t * 0.13, { standoff: t * 0.06, gap: t * 0.12 });
  for (const sx of [-1, 1]) piston(b, kit, [sx * t * 0.3, -t * 0.52, l * 0.14], [sx * t * 0.28, -t * 0.46, l * 0.86], t * 0.15, 0.55, fine);
  jointDrum(b, kit, [0, 0, l], t * 0.8, t * 1.65, 'x');
  if (fine) cableBundle(b, kit, [t * 0.62, -t * 0.32, l * 0.08], [t * 0.56, -t * 0.4, l * 0.9], t * 0.06, [0, 1, 0], 2, 0.04);
}
export function hsShin(b: Bld, kit: Kit, l: number, t: number, fine: boolean, heavy = false) {
  if (heavy) b.loft(kit.mech, [ring(t * 0.3, t * 0.52, t * 0.55), ring(l * 0.9, t * 0.46, t * 0.48)]);
  frameLimb(b, kit, [0, 0, t * 0.5], [0, 0, l * 0.92], t * 0.18, [t * 0.34, 0, 0]);
  plateStack(b, kit, kit.armor2, frame([0, t * 0.12, l * 0.46], [0, 1, 0], [0, 0, 1]), trapP(l * 0.72, t * 1.05, t * 1.45, t * 0.14), [
    { inset: 0, thick: t * 0.2, standoff: t * 0.26 },
    { inset: t * 0.2, thick: t * 0.15, shift: [-l * 0.1, 0], mat: kit.shell },
  ], { gap: t * 0.16 });
  // knee cap overhanging the knee drum
  armorPlate(b, kit, kit.armor, frame([0, t * 0.62, t * 0.05], [0, 0.85, -0.5], [1, 0, 0]), trapP(t * 1.35, t * 0.9, t * 0.7, t * 0.12), t * 0.2, { standoff: t * 0.08 });
  for (const sx of [-1, 1]) piston(b, kit, [sx * t * 0.28, -t * 0.42, l * 0.1], [sx * t * 0.26, -t * 0.38, l * 0.78], t * 0.13, 0.55, fine);
  jointDrum(b, kit, [0, 0, l], t * 0.6, t * 1.35, 'x');
  if (heavy) for (const sx of [-1, 1]) armorPlate(b, kit, kit.armor, frame([sx * t * 0.56, 0, l * 0.5], [sx, 0, 0], [0, 0, 1]), rectP(l * 0.5, t * 0.8, t * 0.1), t * 0.12, { standoff: t * 0.05 });
  if (fine) hose(b, kit, [-t * 0.55, -t * 0.25, l * 0.05], [-t * 0.5, -t * 0.3, l * 0.85], t * 0.06, 0.04, 4);
}
export function hsFoot(b: Bld, kit: Kit, t: number, fine: boolean, heavy = false) {
  const L = t * (heavy ? 4.6 : 4.2), Wd = t * (heavy ? 3.0 : 2.5);
  b.slab(kit.rubber, rectP(L * 0.92, Wd, t * 0.45), t * 0.2, t * 0.05, t * 0.3, 0, 0);
  block(b, kit.mech, t * 0.05, t * 0.18, 0, L * 0.5, Wd * 0.66, t * 0.62, { top: [0.66, 0.74], shift: [-t * 0.15, 0], ch: t * 0.3, bev: t * 0.08 });
  // instep armour, three armoured toes (each a core + a sloped plate), heel spur
  armorPlate(b, kit, kit.armor2, frame([t * 0.55, t * 0.62, 0], [0.55, 1, 0], [0, 0, 1]), rectP(Wd * 0.62, t * 1.1, t * 0.12), t * 0.18, { standoff: t * 0.05 });
  const toes: [number, number][] = heavy ? [[-1.05, -0.3], [-0.36, -0.1], [0.36, 0.1], [1.05, 0.3]] : [[-0.8, -0.24], [0, 0], [0.8, 0.24]];
  for (const [dz, ry] of toes) {
    const x = t * 1.55 + Math.cos(ry) * t * 0.4;
    block(b, kit.joint, x, t * 0.12, dz * t, t * 1.3, t * 0.68, t * 0.38, { top: [0.6, 0.85], shift: [t * 0.2, 0], ch: t * 0.18, bev: t * 0.05 });
    armorPlate(b, kit, kit.armor, frame([x + t * 0.05, t * 0.48, dz * t], [0.4, 1, 0], [Math.cos(ry), 0, Math.sin(ry)]), rectP(t * 1.05, t * 0.6, t * 0.08), t * 0.12, { standoff: t * 0.03, gap: t * 0.06 });
  }
  block(b, kit.joint, -t * 1.6, t * 0.1, 0, t * 0.9, t * 0.9, t * 0.4, { top: [0.6, 0.7], shift: [-t * 0.2, 0], ch: t * 0.25, bev: t * 0.06 });
  // ankle yoke + ankle piston from the heel up to the shin
  for (const sz of [-1, 1]) b.box(kit.mech, t * 0.9, t * 0.9, t * 0.24, 0, t * 0.85, sz * t * 0.66, t * 0.08);
  piston(b, kit, [-t * 1.45, t * 0.5, 0], [-t * 0.45, t * 1.35, 0], t * 0.16, 0.55, fine);
}

export interface LegOpts {
  kind: 'biped' | 'spider'; stride: number; lift: number;
  /** cheap LOD (fewer drums / rams / toes) for small or many-legged units */
  lite?: boolean;
  /** bone length factor (x hip-to-foot distance); longer bones fold further at the knee */
  reach?: number;
  /** biped knee direction: 'fwd' (human knee) or 'back' (reverse-jointed "chicken walker") */
  bend?: 'fwd' | 'back';
  /** hard-surface segments (skeleton + armour shells + pistons) for bipeds (spider legs are always hard-surface) */
  hs?: boolean;
  /** spider leg construction: machine legs (default) or arthropod chitin legs */
  style?: LegStyle;
  /** tertiary detail on hs segments */
  fine?: boolean;
  /** extra geometry on the thigh / shin groups (same local frames as the segment builders) */
  extra?: { thigh?: (b: Bld, l: number, t: number) => void; shin?: (b: Bld, l: number, t: number) => void; foot?: (b: Bld, t: number) => void };
}

/** longest bone per unit of leg thickness: a leg has to look like it carries the hull above it, so however long a hull
 *  makes its legs, they get at least this stout (spider legs splay wide and carry from the side: stouter still) */
const MAX_SLENDER = { spider: 4.6, biped: 4.4 };

export function makeLeg(g: THREE.Object3D, kit: Kit, hip: Hip, o: LegOpts): Leg {
  const spider = o.kind === 'spider';
  const hipV = new THREE.Vector3(...hip.p), footV = new THREE.Vector3(...hip.foot);
  const d0 = hipV.distanceTo(footV);
  const rk = o.reach ?? 1;
  const l1 = d0 * (spider ? 0.7 : 0.6) * rk, l2 = d0 * (spider ? 0.84 : 0.6) * rk;
  const t = Math.max(hip.t, Math.max(l1, l2) / MAX_SLENDER[o.kind]);
  const bendV = spider ? new THREE.Vector3(0, 1, hip.side * 0.3) : new THREE.Vector3(o.bend === 'back' ? -1 : 1, 0.12, 0);
  const lite = !!o.lite, ex = o.extra ?? {}, flip = o.bend === 'back';
  const mk = (fn: (b: Bld) => void) => { const grp = new THREE.Group(); const b = new Bld(); if (lite) b.segK = 0.7; fn(b); b.mount(grp); grp.matrixAutoUpdate = false; g.add(grp); return grp; };
  const fine = (o.fine ?? true) && !lite, style = o.style ?? 'mech';
  const upper = mk((b) => {
    if (spider) spThigh(b, kit, l1, t, style, fine, lite); else if (lite) liteThigh(b, kit, l1, t); else hsThigh(b, kit, l1, t, fine);
    ex.thigh?.(b, l1, t);
  });
  const lower = mk((b) => {
    if (spider) spShin(b, kit, l2, t * 0.95, style, fine, lite); else if (lite) liteShin(b, kit, l2, t * 0.92); else hsShin(b, kit, l2, t * 0.92, fine);
    ex.shin?.(b, l2, t * 0.92);
  });
  const footG = mk((b) => {
    if (spider) spFoot(b, kit, t * 0.9, style, fine, lite); else if (lite) liteFoot(b, kit, t); else hsFoot(b, kit, t, fine);
    ex.foot?.(b, t);
  });
  if (spider) footG.matrixAutoUpdate = true;
  const f = new THREE.Vector3(), k = new THREE.Vector3(), dir = new THREE.Vector3(), perp = new THREE.Vector3(), tmp = new THREE.Vector3(), xa = new THREE.Vector3(), ya = new THREE.Vector3();
  const place = (a: THREE.Vector3, bb: THREE.Vector3, m: THREE.Object3D) => {
    tmp.copy(bb).sub(a).normalize();
    ya.copy(perp).addScaledVector(tmp, -perp.dot(tmp)).normalize();
    // reverse-jointed legs: armour faces forward (away from the knee), i.e. the segment rolled 180 deg about its bone
    if (flip) ya.negate();
    xa.crossVectors(ya, tmp);
    m.matrix.makeBasis(xa, ya, tmp).setPosition(a);
    m.matrixWorldNeedsUpdate = true;
  };
  const step = (time: number, moving: number) => {
    const ph = time * 3.2 + hip.phase;
    f.copy(footV);
    f.x += -Math.sin(ph) * o.stride * moving;
    const up = Math.max(0, Math.cos(ph));
    f.y += up * up * o.lift * moving;
    dir.copy(f).sub(hipV);
    let d = dir.length();
    d = Math.min(d, (l1 + l2) * 0.999);
    dir.normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    perp.copy(bendV).addScaledVector(dir, -bendV.dot(dir)).normalize();
    k.copy(hipV).addScaledVector(dir, a).addScaledVector(perp, h);
    place(hipV, k, upper);
    place(k, f, lower);
    if (spider) { footG.position.copy(f); footG.updateMatrix(); }
    else {
      // foot stays level, toes pitch up a little while swinging
      const pitch = up * moving * 0.25;
      footG.matrix.makeRotationZ(pitch).setPosition(f);
      footG.matrixWorldNeedsUpdate = true;
    }
  };
  step(0, 0);
  return { step };
}

/** cheap leg LOD for small units and many-legged hulls (keeps squads inside the triangle budget); giant-class hulls
 *  always get the full legs (they are few on the field and seen close) */
export const liteLegs = (S: number, n: number, kind: 'biped' | 'spider') => S < 4 && (S <= 1 || n > 6 || (kind === 'spider' && S <= 2 && n > 4));

/** hull shapes that walk on arthropod (chitin) legs; every other hull gets machine legs */
const ORGANIC_LEGS = new Set(['crab', 'scorpion', 'broodmother', 'arachnid', 'arachne', 'mantis']);
export const legStyleFor = (shape: string): LegStyle => (ORGANIC_LEGS.has(shape) ? 'organic' : 'mech');

registerMobility(['legs', 'titanlegs', 'spider'], {
  stance: legStance,
  build(c) {
    const st = c.stance;
    const own = !!(c.hips && c.hips.length);
    const hips = own ? c.hips! : defaultHips(st, c.L, c.W);
    const kind = st.legs ?? 'biped';
    // default hips sit where a footprint-filling hull would be; a hull narrower than its footprint (a titan's pedestal
    // waist, a slim spine) would leave them in the air: brace each one back toward the hull's core with a hip arm
    // (hidden inside a hull that does reach the hip)
    if (!own) {
      const b = new Bld();
      for (const h of hips) {
        const [x, y, z] = h.p, t = h.t * 1.2, inner: V3 = [x * 0.25, y + t * 0.2, z * 0.25];
        b.g(strutGeo(inner, [x, y, z], t * 0.95, t * 0.8, 6), c.kit.mech);
        b.g(strutGeo([inner[0], inner[1] + t * 0.7, inner[2]], [x * 0.92, y + t * 0.55, z * 0.92], t * 0.55, t * 0.45, 5), c.kit.armor);
      }
      b.mount(c.root);
    }
    const stride = Math.min(strideFor(c.mobId, c.S), st.hipY * (kind === 'spider' ? 0.7 : 0.55));
    const lite = liteLegs(c.S, hips.length, kind);
    const style = legStyleFor(c.shape);
    // spider legs come four to eight at a time: tertiary detail (pin caps, clevis eyes, second cables) from heavy up
    const fine = kind === 'spider' ? c.S >= 3 : c.S >= 2;
    const legs = hips.map((h) => makeLeg(c.root, c.kit, h, { kind, stride, lift: st.hipY * (kind === 'spider' ? 0.32 : 0.26), lite, hs: kind === 'biped', fine, style }));
    return (t, mv) => { for (const l of legs) l.step(t, mv); };
  },
});
