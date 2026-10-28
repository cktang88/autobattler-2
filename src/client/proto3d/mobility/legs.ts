// Legged locomotion: bipeds (legs, titanlegs; jump legs live in mobility/jumpjets.ts) and multi-leg spiders. Thick, load-bearing legs built from
// chunky segments: big layered hip / knee drums, multi-segment thighs and shins of layered armour shells over a dark
// core with bright rams down the back, and wide stepped feet (toed stompers for bipeds, stepped pads or armoured boots
// for spiders). 2-bone IK per leg.
//
// Each leg is three groups (thigh, shin, foot) with manual matrices, so the render adapter instances them as animated
// nodes. Hip positions come from the chassis (ChassisOut.hips) or the defaults below.

import * as THREE from 'three';
import { Bld, strutGeo, type V3 } from '../geo.ts';
import type { Kit, MatLike } from '../materials.ts';
import { registerMobility, type Hip, type Stance, type StanceIn } from '../chassis/registry.ts';
import { block } from '../chassis/shapes.ts';
import { cableBundle, hose, piston } from '../chassis/hs-kit.ts';
import { claw, limbSegs, limbShell, spike } from '../chassis/hs-kit-organic.ts';

export interface Leg { step(t: number, moving: number, dir?: number): void }

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
  // (x1.2: chunky load-bearing legs whose armour stacks read as separate blocks from the RTS camera)
  const hipY = 0.4 * m + 0.12, t = (0.062 * m + 0.04) * (s.mobId === 'titanlegs' ? 1.2 : 1) * 1.2;
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
//   'mech'    the biped's armoured segments (dark core, layered bevelled shells, big layered drums, a bright ram under
//             every bone) at spider cost, a stepped cross-toed pad (machines on legs: striders, saucers, trains, tanks)
//   'organic' arthropod limbs: a thin dark core under overlapping chitin shells (faceted, thick, shingled down the
//             bone), sinew cable runs instead of rams, spurs at the knee, a hooked claw tip (crawlers, the brood)
export type LegStyle = 'mech' | 'organic';

function spThigh(b: Bld, kit: Kit, l: number, t: number, style: LegStyle, fine: boolean, lite: boolean) {
  // machine legs: the same armoured segments as the bipeds (dorsal armour, rams underneath), cheaper per leg
  if (style !== 'organic') { armThigh(b, kit, l, t, lite ? Q_SPIDER_LITE : fine ? Q_SPIDER_FINE : Q_SPIDER); return; }
  // arthropod: a big dark hip ball-drum, a thick dark core under heavy shingled chitin, a light ventral shell, sinew
  // cables underneath, a knee spur, a knee drum
  drum(b, kit, [0, 0, 0], t * 1.12, t * 1.2, lite ? Q_SPIDER_LITE : Q_SPIDER, kit.armor2);
  b.loft(kit.mech, [ring(t * 0.4, t * 0.54, t * 0.58), ring(l * 0.5, t * 0.5, t * 0.54), ring(l * 0.94, t * 0.4, t * 0.42)]);
  if (lite) {
    limbShell(b, kit.armor, l * 0.06, l * 0.94, t * 0.86, t * 0.42, t * 0.28, t * 0.24, { tp: 0.7, cols: 2 });
  } else {
    limbSegs(b, [kit.armor, kit.armor2], t * 0.5, l * 0.92, 2, t * 0.98, t * 0.54, t * 0.3, t * 0.26, 0.74, 3);
    limbShell(b, kit.shell, l * 0.18, l * 0.78, t * 0.62, t * 0.22, t * 0.42, t * 0.18, { sign: -1, tp: 0.8, cols: 2 });
    cableBundle(b, kit, [t * 0.42, -t * 0.5, l * 0.1], [t * 0.36, -t * 0.46, l * 0.88], t * 0.09, [1, 0, 0], fine ? 2 : 1, 0.05);
    spike(b, kit.armor2, [0, t * 0.62, l * 0.88], [0, t * 1.7, l * 0.68], t * 0.32);
  }
  drum(b, kit, [0, 0, l], t * 0.9, t * 1.05, lite ? Q_SPIDER_LITE : Q_SPIDER, kit.armor);
}

function spShin(b: Bld, kit: Kit, l: number, t: number, style: LegStyle, fine: boolean, lite: boolean) {
  if (style !== 'organic') { armShin(b, kit, l, t, lite ? Q_SPIDER_LITE : fine ? Q_SPIDER_FINE : Q_SPIDER); return; }
  // tapering dark core, heavy shingled chitin down the outer side, spines, a sinew hose, into the armoured boot
  b.loft(kit.mech, [ring(t * 0.3, t * 0.48, t * 0.5), ring(l * 0.5, t * 0.4, t * 0.42), ring(l * 0.9, t * 0.28, t * 0.3)]);
  if (lite) { limbShell(b, kit.armor2, l * 0.04, l * 0.66, t * 0.76, t * 0.36, t * 0.24, t * 0.22, { tp: 0.55, cols: 2 }); return; }
  limbSegs(b, [kit.armor2, kit.armor, kit.armor2], t * 0.3, l * 0.82, 3, t * 0.9, t * 0.48, t * 0.24, t * 0.22, 0.55, 3);
  for (const f of [0.3, 0.55]) spike(b, kit.joint, [t * 0.36, t * 0.55, l * f], [t * 0.6, t * 1.2, l * (f - 0.08)], t * 0.15);
  hose(b, kit, [-t * 0.34, -t * 0.42, l * 0.06], [-t * 0.24, -t * 0.32, l * 0.7], t * 0.08, 0.04, 3);
}

function spFoot(b: Bld, kit: Kit, t: number, style: LegStyle, fine: boolean, lite: boolean) {
  if (style === 'organic') {
    // armoured boot (hull_b crab feet): a tall team wedge on a dark sole, a light cap, thick claws splayed forward
    block(b, kit.mech, 0, 0, 0, t * 1.9, t * 1.6, t * 0.26, { ch: t * 0.45, bev: t * 0.05 });
    block(b, kit.armor, -t * 0.05, t * 0.22, 0, t * 1.6, t * 1.3, t * 1.15, { top: [0.62, 0.74], shift: [-t * 0.18, 0], ch: t * 0.34, bev: t * 0.1 });
    if (lite) return;
    block(b, kit.shell, -t * 0.25, t * 1.37, 0, t * 0.8, t * 0.8, t * 0.22, { top: [0.7, 0.75], ch: t * 0.22, bev: t * 0.06 });
    for (const a of [-0.55, 0.55]) claw(b, kit.joint, [t * 0.5, t * 0.4, Math.sin(a) * t * 0.4], [Math.cos(a) * t * 1.05, t * 0.38, Math.sin(a) * t * 0.7], [Math.cos(a) * t * 1.45, 0, Math.sin(a) * t * 0.95], t * 0.22);
    if (fine) spike(b, kit.armor2, [-t * 0.6, t * 0.5, 0], [-t * 1.25, t * 0.06, 0], t * 0.22);
    return;
  }
  // stepped armoured pad: dark sole, a team tier, four sloped toe blocks (cross), a light cap, the ankle collar
  block(b, kit.mech, 0, 0, 0, t * 2.7, t * 2.7, t * 0.22, { ch: t * 0.8, bev: t * 0.05 });
  block(b, kit.armor2, 0, t * 0.2, 0, t * 2.0, t * 2.0, t * 0.34, { top: [0.76, 0.76], ch: t * 0.6, bev: t * 0.08 });
  if (!lite) for (const s of [-1, 1]) {
    block(b, kit.armor, s * t * 1.05, t * 0.16, 0, t * 1.0, t * 0.82, t * 0.44, { top: [0.5, 0.8], shift: [-s * t * 0.22, 0], ch: t * 0.16, bev: t * 0.06 });
    block(b, kit.armor, 0, t * 0.16, s * t * 1.05, t * 0.82, t * 1.0, t * 0.44, { top: [0.8, 0.5], shift: [0, -s * t * 0.22], ch: t * 0.16, bev: t * 0.06 });
  }
  block(b, kit.shell, 0, t * 0.52, 0, t * 1.1, t * 1.1, t * 0.2, { top: [0.7, 0.7], ch: t * 0.34, bev: t * 0.06 });
  b.cylb(kit.joint, t * 0.5, t * 0.62, t * 0.08, [0, t * 0.66, 0], 'y', lite ? 8 : 10);
}

// ---- armoured walker segments (hard-surface, after docs/inspo/legs_cool.jpg / hull_ares.jpg) ------------------------
// A leg is a dark mechanical core (a waisted spine) carrying separate bevelled armour shells: each bone has two armour
// segments with a shadow gap between them (a chunky glow block sits in the gap), each segment a heavy dark-team shell
// wrapping the face and flanks with a team plate layered over it at an offset (a light bone panel on the flanks / lower
// face), so every plate edge steps. Joints are big round layered drums (dark core band, machined flanges, team hub
// caps, bright pins). Bright hydraulic rams run down the back of every bone out of the drums; the shin carries one big
// calf ram. Feet are wide stepped pads: sole, two tiers, parallel armoured toes with bone toe caps, a heel block, ankle
// cheeks around an ankle drum and an ankle ram. Segments stay flat-shaded lofts (cheap, crisp facets): the triangle
// budget goes into the drums and the silhouette, not into greebles.
//
// Local frame for the bone segments: +Z along the bone, +Y the armoured face (toward the knee bend; reverse-jointed legs
// are rolled 180 deg so the armour faces forward), X across (the joint axis). Feet: +x forward, +y up, z across.

type Sec = [z: number, wx: number, wy: number, yc: number];
/** chamfered 8-point section at z, centred (xc, yc) */
const sec = (z: number, wx: number, wy: number, yc = 0, xc = 0, c = 0.32): V3[] => ring(z, wx, wy, c).map(([x, y]) => [x + xc, y + yc, z] as V3);
/** armour shell along the bone: a flat-shaded chamfered loft through stations [z, half-width, half-depth, centre y],
 *  both ends bevelled by bev (the first / last station is the outer extent) */
function shell(b: Bld, mat: MatLike, s: Sec[], bev: number, xc = 0, c = 0.32) {
  const f = s[0], l = s[s.length - 1], d = Math.sign(l[0] - f[0]) || 1;
  const rings = [sec(f[0], f[1] - bev, f[2] - bev, f[3], xc, c), sec(f[0] + bev * d, f[1], f[2], f[3], xc, c)];
  for (const m of s.slice(1, -1)) rings.push(sec(m[0], m[1], m[2], m[3], xc, c));
  rings.push(sec(l[0] - bev * d, l[1], l[2], l[3], xc, c), sec(l[0], l[1] - bev, l[2] - bev, l[3], xc, c));
  b.loft(mat, rings);
}

/** detail of one armoured leg: radial segments, armour layers (1 = shells only, 2 = + layered plates, 3 = + side
 *  panels and a second layer on the lower segments), rams per bone, clevis eyes on the rams, glow blocks in the gaps */
interface LegQ { seg: number; layers: 1 | 2 | 3; rams: 1 | 2; clevis: boolean; glow: boolean; lite: boolean }
const Q_FULL: LegQ = { seg: 16, layers: 2, rams: 2, clevis: true, glow: true, lite: false };
const Q_HEAVY: LegQ = { seg: 18, layers: 3, rams: 2, clevis: true, glow: true, lite: false };
const Q_LITE: LegQ = { seg: 9, layers: 2, rams: 1, clevis: false, glow: true, lite: true };
const Q_SPIDER: LegQ = { seg: 10, layers: 2, rams: 1, clevis: false, glow: false, lite: true };
const Q_SPIDER_LITE: LegQ = { seg: 8, layers: 1, rams: 1, clevis: false, glow: false, lite: true };
const Q_SPIDER_FINE: LegQ = { seg: 12, layers: 2, rams: 1, clevis: true, glow: true, lite: false };
const qFor = (fine: boolean, heavy: boolean) => (heavy ? Q_HEAVY : fine ? Q_FULL : { ...Q_FULL, seg: 12, clevis: false });

/** big layered joint drum, axis x (bones) or z (feet), centred at p, overall width ~1.34 w: a recessed dark core band
 *  between two machined metal flanges, a team-colour hub cap on each side and a bright pin. lite: flanges + caps only */
function drum(b: Bld, kit: Kit, p: V3, r: number, w: number, q: LegQ, cap: MatLike = kit.armor, axis: 'x' | 'z' = 'x') {
  const seg = q.seg, X = axis === 'x';
  const at = (s: number, d: number): V3 => (X ? [p[0] + s * d, p[1], p[2]] : [p[0], p[1], p[2] + s * d]);
  if (q.lite) b.cyl(kit.mech, r * 0.86, r * 0.86, w * 0.64, at(-1, w * 0.32), axis, seg);
  else b.cylb(kit.mech, r * 0.86, w * 0.64, r * 0.05, at(-1, w * 0.32), axis, seg);
  for (const s of [-1, 1] as const) {
    const ax = (X ? (s > 0 ? 'x' : '-x') : (s > 0 ? 'z' : '-z')) as 'x' | '-x' | 'z' | '-z';
    const o = at(s, w * 0.3);
    if (q.lite) {
      b.lathe(kit.joint, [[r * 0.8, 0], [r, w * 0.04], [r, w * 0.17], [r * 0.78, w * 0.22]], o, ax, seg);
      b.lathe(cap, [[r * 0.72, w * 0.21], [r * 0.6, w * 0.29], [0, w * 0.29]], o, ax, seg);
      continue;
    }
    b.lathe(kit.joint, [[r * 0.8, 0], [r, w * 0.03], [r, w * 0.15], [r * 0.92, w * 0.21], [r * 0.7, w * 0.21]], o, ax, seg);
    b.lathe(cap, [[r * 0.72, w * 0.2], [r * 0.66, w * 0.28], [r * 0.44, w * 0.3], [r * 0.4, w * 0.26], [0, w * 0.26]], o, ax, seg);
    if (!q.lite) b.lathe(kit.steel, [[r * 0.24, w * 0.25], [r * 0.24, w * 0.34], [r * 0.16, w * 0.38], [0, w * 0.38]], o, ax, Math.max(8, seg - 4));
  }
}

/** hydraulic ram with mounting blocks at both ends (the rams read as bright machinery between the plates) */
function ram(b: Bld, kit: Kit, a: V3, c: V3, r: number, q: LegQ, ext = 0.5) {
  piston(b, kit, a, c, r, ext, q.clevis);
}

function armThigh(b: Bld, kit: Kit, l: number, t: number, q: LegQ) {
  // dark mechanical core: a waisted spine from the hip drum into the knee drum
  b.loft(kit.mech, [sec(t * 0.2, t * 0.5, t * 0.55), sec(l * 0.32, t * 0.6, t * 0.62), sec(l * 0.72, t * 0.5, t * 0.52), sec(l - t * 0.2, t * 0.46, t * 0.48)]);
  drum(b, kit, [0, 0, 0], t * 1.12, t * 1.46, q);
  const gp = Math.min(t * 0.34, l * 0.07), zA0 = t * 0.95, zA1 = l * 0.5, zB0 = l * 0.5 + gp, zB1 = l - t * 0.8;
  // upper segment: heavy dark-team shell wrapping face and flanks, a team plate layered over its face (offset edges)
  shell(b, kit.armor2, [[zA0, t * 0.86, t * 0.58, t * 0.18], [l * 0.28, t * 0.94, t * 0.66, t * 0.22], [zA1, t * 0.8, t * 0.56, t * 0.14]], t * 0.16);
  if (q.layers >= 2) shell(b, kit.armor, [[zA0 + t * 0.3, t * 0.7, t * 0.22, t * 0.84], [l * 0.3, t * 0.76, t * 0.26, t * 0.92], [zA1 - t * 0.16, t * 0.62, t * 0.22, t * 0.76]], t * 0.11);
  if (q.layers >= 3) shell(b, kit.armor2, [[zA0 + t * 0.62, t * 0.46, t * 0.12, t * 1.16], [zA1 - t * 0.4, t * 0.4, t * 0.12, t * 1.04]], t * 0.07);
  // light side panels on the flanks of the upper segment
  if (q.layers >= 2) for (const s of [-1, 1]) shell(b, kit.shell, [[l * 0.16, t * 0.1, t * 0.4, t * 0.06], [zA1 - t * 0.2, t * 0.1, t * 0.34, t * 0.04]], t * 0.05, s * t * 0.96);
  // lower segment: team shell over the knee, a light bone strip layered on its face
  shell(b, kit.armor, [[zB0, t * 0.74, t * 0.52, t * 0.14], [zB1, t * 0.66, t * 0.48, t * 0.12]], t * 0.13);
  if (q.layers >= 2) shell(b, kit.shell, [[zB0 + t * 0.16, t * 0.5, t * 0.16, t * 0.66], [zB1 - t * 0.12, t * 0.42, t * 0.15, t * 0.62]], t * 0.07);
  if (q.layers >= 3) for (const s of [-1, 1]) shell(b, kit.armor2, [[zB0 + t * 0.1, t * 0.09, t * 0.36, t * 0.08], [zB1 - t * 0.1, t * 0.09, t * 0.3, t * 0.06]], t * 0.04, s * t * 0.8);
  // glowing core block in the gap between the segments
  if (q.glow) shell(b, kit.glow, [[zA1 - t * 0.04, t * 0.4, t * 0.14, t * 0.46], [zB0 + t * 0.04, t * 0.36, t * 0.12, t * 0.44]], t * 0.03);
  // bright rams down the back, out of the hip drum into the knee
  if (q.rams === 2) for (const s of [-1, 1]) ram(b, kit, [s * t * 0.36, -t * 0.66, t * 0.5], [s * t * 0.34, -t * 0.62, l * 0.86], t * 0.17, q);
  else ram(b, kit, [0, -t * 0.66, t * 0.5], [0, -t * 0.6, l * 0.86], t * 0.2, q);
  drum(b, kit, [0, 0, l], t * 0.82, t * 1.24, q);
}

function armShin(b: Bld, kit: Kit, l: number, t: number, q: LegQ) {
  b.loft(kit.mech, [sec(t * 0.1, t * 0.5, t * 0.52), sec(l * 0.45, t * 0.52, t * 0.54), sec(l * 0.9, t * 0.36, t * 0.38), sec(l, t * 0.3, t * 0.32)]);
  // knee cap: a big rounded plate over the front of the knee drum, a light plate layered on it
  shell(b, kit.armor, [[-t * 0.62, t * 0.6, t * 0.28, t * 0.82], [t * 0.12, t * 0.8, t * 0.42, t * 0.96], [t * 0.86, t * 0.66, t * 0.3, t * 0.74]], t * 0.15);
  if (q.layers >= 2) shell(b, kit.shell, [[-t * 0.36, t * 0.4, t * 0.13, t * 1.26], [t * 0.16, t * 0.5, t * 0.15, t * 1.34], [t * 0.62, t * 0.38, t * 0.12, t * 1.12]], t * 0.07);
  const gp = Math.min(t * 0.32, l * 0.07), zA0 = t * 0.9, zA1 = l * 0.56, zB0 = l * 0.56 + gp, zB1 = l * 0.86;
  // upper shin: dark-team shell, a team plate layered over the face, light flank panels
  shell(b, kit.armor2, [[zA0, t * 0.84, t * 0.58, t * 0.14], [l * 0.3, t * 0.88, t * 0.64, t * 0.18], [zA1, t * 0.72, t * 0.54, t * 0.12]], t * 0.15);
  if (q.layers >= 2) shell(b, kit.armor, [[zA0 + t * 0.2, t * 0.64, t * 0.22, t * 0.8], [l * 0.32, t * 0.66, t * 0.24, t * 0.86], [zA1 - t * 0.14, t * 0.5, t * 0.2, t * 0.72]], t * 0.1);
  if (q.layers >= 3) for (const s of [-1, 1]) shell(b, kit.shell, [[zA0 + t * 0.3, t * 0.1, t * 0.38, t * 0.04], [zA1 - t * 0.2, t * 0.1, t * 0.32, t * 0.02]], t * 0.05, s * t * 0.9);
  // lower shin: team shell narrowing to the ankle, a light plate on its face
  shell(b, kit.armor, [[zB0, t * 0.64, t * 0.5, t * 0.1], [zB1, t * 0.54, t * 0.42, t * 0.06]], t * 0.12);
  if (q.layers >= 2) shell(b, kit.shell, [[zB0 + t * 0.14, t * 0.44, t * 0.15, t * 0.6], [zB1 - t * 0.1, t * 0.36, t * 0.13, t * 0.5]], t * 0.06);
  if (q.glow) shell(b, kit.glow, [[zA1 - t * 0.04, t * 0.36, t * 0.13, t * 0.44], [zB0 + t * 0.04, t * 0.32, t * 0.12, t * 0.42]], t * 0.03);
  // the big calf ram down the back of the shin (bracket block at its top), slim side rams on heavy legs
  shell(b, kit.mech, [[t * 0.3, t * 0.34, t * 0.24, -t * 0.72], [t * 1.1, t * 0.3, t * 0.2, -t * 0.66]], t * 0.06);
  ram(b, kit, [0, -t * 0.82, t * 0.7], [0, -t * 0.58, l * 0.9], t * (q.lite ? 0.2 : 0.24), q, 0.45);
  if (q.layers >= 3) for (const s of [-1, 1]) ram(b, kit, [s * t * 0.62, -t * 0.4, l * 0.12], [s * t * 0.5, -t * 0.36, l * 0.8], t * 0.12, q);
}

function armFoot(b: Bld, kit: Kit, t: number, q: LegQ, heavy = false) {
  const L = t * (heavy ? 4.8 : 4.1), W = t * (heavy ? 3.3 : 2.8);
  // sole and two stepped tiers: a wide, low, heavy footprint with sloped edges
  block(b, kit.mech, 0, 0, 0, L, W, t * 0.24, { ch: t * 0.5, bev: t * 0.05 });
  block(b, kit.armor2, -t * 0.1, t * 0.22, 0, L * 0.86, W * 0.88, t * 0.32, { top: [0.92, 0.94], ch: t * 0.45, bev: t * 0.08 });
  block(b, kit.mech, -t * 0.35, t * 0.52, 0, L * 0.52, W * 0.6, t * 0.46, { top: [0.76, 0.84], ch: t * 0.3, bev: t * 0.08 });
  // parallel armoured toes, each a sloped team block with a light toe cap layered on top
  const n = heavy ? 4 : 3, tw = (W * 0.92) / n;
  for (let i = 0; i < n; i++) {
    const z = (i - (n - 1) / 2) * tw, x = L * 0.2 + (i === 0 || i === n - 1 ? -t * 0.12 : 0);
    block(b, kit.armor, x, t * 0.2, z, t * 1.9, tw * 0.86, t * 0.5, { top: [0.55, 0.86], shift: [-t * 0.32, 0], ch: t * 0.16, bev: t * 0.07 });
    if (q.layers >= 2) block(b, kit.shell, x - t * 0.36, t * 0.68, z, t * 0.86, tw * 0.62, t * 0.16, { top: [0.62, 0.8], shift: [-t * 0.06, 0], ch: t * 0.1, bev: t * 0.05 });
  }
  // heel block sloping back, a light cap on it
  block(b, kit.armor, -L * 0.36, t * 0.2, 0, t * 1.3, W * 0.56, t * 0.56, { top: [0.6, 0.82], shift: [t * 0.22, 0], ch: t * 0.22, bev: t * 0.07 });
  if (q.layers >= 2) block(b, kit.shell, -L * 0.33, t * 0.74, 0, t * 0.6, W * 0.36, t * 0.14, { top: [0.6, 0.8], ch: t * 0.1, bev: t * 0.04 });
  // ankle: team cheeks either side of the shin around a drum across the foot, a bright ram from the heel
  for (const s of [-1, 1]) block(b, kit.armor, -t * 0.12, t * 0.5, s * t * 0.86, t * 1.5, t * 0.3, t * 0.86, { top: [0.66, 1], shift: [-t * 0.08, 0], ch: t * 0.1, bev: t * 0.06 });
  drum(b, kit, [-t * 0.1, t * 0.86, 0], t * 0.56, t * 1.3, q, kit.armor2, 'z');
  ram(b, kit, [-L * 0.3, t * 0.7, 0], [-t * 0.62, t * 1.12, 0], t * 0.18, q, 0.5);
}

// ---- exported segment builders (titanlegs.ts / jumpjets.ts reuse them) ----------------------------------------------
function liteThigh(b: Bld, kit: Kit, l: number, t: number) { armThigh(b, kit, l, t, Q_LITE); }
function liteShin(b: Bld, kit: Kit, l: number, t: number) { armShin(b, kit, l, t, Q_LITE); }
function liteFoot(b: Bld, kit: Kit, t: number) { armFoot(b, kit, t, Q_LITE); }

export function hsThigh(b: Bld, kit: Kit, l: number, t: number, fine: boolean, heavy = false) { armThigh(b, kit, l, t, qFor(fine, heavy)); }
export function hsShin(b: Bld, kit: Kit, l: number, t: number, fine: boolean, heavy = false) { armShin(b, kit, l, t, qFor(fine, heavy)); }
export function hsFoot(b: Bld, kit: Kit, t: number, fine: boolean, heavy = false) { armFoot(b, kit, t, qFor(fine, heavy), heavy); }


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
  // bipeds: bones a little longer than the hip-to-foot drop, so the knee always breaks forward (a loaded, crouched leg
  // whose thigh and shin both show, not a straight post under the hull)
  const rk = o.reach ?? (spider ? 1 : 1.12);
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
  /** way: travel direction in the hull frame (0 = forward): the feet stride that way (backing up, a spider strafing) */
  const step = (time: number, moving: number, way = 0) => {
    const ph = time * 3.2 + hip.phase;
    f.copy(footV);
    const sw = -Math.sin(ph) * o.stride * moving;
    f.x += sw * Math.cos(way);
    f.z += sw * Math.sin(way);
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
    return (t, mv, dir) => { for (const l of legs) l.step(t, mv, dir); };
  },
});
