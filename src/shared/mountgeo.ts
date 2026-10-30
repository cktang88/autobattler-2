// Mount geometry shared by the sim (server + client) and the unit art. Pure data + math: no DOM / canvas.
//
// Hardpoint positions are fractions of the footprint (X = length along the facing, Y = width across; square
// chassis X = Y = S) in the hull-local frame: +x = forward (nose), +y = right. The render's
// `layoutOf(design).mounts[i].x/.y` (src/client/render/unitart.ts) is built from exactly these tables (socket i always
// sits on hardpoint i), so `mountOffsets(design)` matches it by construction. The one exception is mounts that ride animated
// anatomy on footprint frames (arms, claws, tails, train cars): the art places those from its part rig, which is
// render-only, so their rest-pose positions are snapshotted in PART_REST below (test/mountgeo.test.ts asserts
// parity with layoutOf for every chassis + starter design, so a rig change that moves a weapon fails loudly).

import { CHASSIS_BY_ID, MODULE_BY_ID } from './parts.ts';
import type { ChassisDef, Design, ModuleDef, MountClass } from './types.ts';

type Pt = [number, number];

/** Mount points per chassis id, fractions of S (chassis whose shape has no footprint-frame table, see FOOT_MOUNTS). */
export const MOUNT_PTS: Record<string, [number, number][]> = {
  scout: [[0.02, 0]],
  drone: [[0.04, 0]],
  raider: [[0.13, -0.2], [0.13, 0.2]],
  warden: [[0.05, 0], [-0.25, 0.15]],
  striker: [[-0.02, -0.25], [-0.02, 0.25], [0.22, 0]],
  longarm: [[0.04, 0]],
  aegis: [[0.06, 0], [-0.22, 0]],
  gunship: [[-0.03, -0.28], [-0.03, 0.28]],
  bastion: [[0.06, 0], [-0.24, -0.25], [-0.24, 0.25]],
  colossus: [[0.0, -0.31], [0.0, 0.31], [0.18, 0], [-0.24, 0]],
  // giants / titans: turrets sit ON the hull with clear deck between them (hull dominates the silhouette)
  goliath: [[0.08, 0], [-0.07, -0.34], [-0.07, 0.34], [-0.31, 0]],
  leviathan: [[0.27, 0], [-0.28, 0], [0.0, -0.205], [0.0, 0.205]],
  carrier: [[0.33, 0], [-0.07, -0.31], [-0.37, -0.25], [-0.37, 0.25]],
  // titan walker: T on the right forearm, G on the left forearm, heavies on the shoulder blades, M on the backpack
  titan: [[0.15, 0.37], [0.15, -0.37], [-0.115, -0.165], [-0.115, 0.165], [-0.34, 0]],
  citadel: [[0.22, -0.26], [0.22, 0.26], [-0.27, 0], [-0.39, -0.39], [-0.39, 0.39], [0.45, 0]],
  // odd shapes: turrets sit where the anatomy carries them (forelimbs, arms, claws, tail tip, spine segments)
  mantis: [[0.31, -0.165], [0.31, 0.165]],
  strider: [[0.32, 0.335], [0.32, -0.335], [-0.04, -0.3]],
  arachnid: [[-0.16, -0.115], [-0.16, 0.115]],
  crab: [[0.33, -0.39], [0.33, 0.39], [-0.04, 0]],
  saucer: [[0.11, -0.19], [0.11, 0.19], [-0.215, 0]],
  deltawing: [[0.02, 0], [-0.22, -0.25], [-0.22, 0.25]],
  warlord: [[-0.04, -0.3], [0.32, 0.36], [0.32, -0.36], [-0.28, 0]],
  scorpion: [[-0.42, -0.28], [0.5, -0.29], [0.5, 0.29]],
  centipede: [[0.22, 0], [0.085, 0], [-0.055, 0], [-0.195, 0]],
  broodmother: [[-0.19, 0], [0.26, 0], [-0.05, -0.25], [-0.05, 0.25], [-0.41, 0]],
  arachne: [[-0.22, 0], [0.24, -0.15], [0.24, 0.15], [-0.43, 0]],
  carriage: [[0.0, 0]],
  hunter: [[0.08, 0], [-0.25, 0]],
  riot: [[-0.13, -0.15], [-0.13, 0.15]],
  interceptor: [[-0.05, -0.2], [-0.05, 0.2]],
  siegeplat: [[0.02, -0.15], [0.02, 0.15]],
  juggernaut: [[-0.04, 0], [-0.3, 0.2]],
  bomberhull: [[0.24, 0], [-0.1, -0.3], [-0.1, 0.3]],
};

/** Footprint-frame hardpoints per chassis SHAPE, fractions of (X, Y) (footart.ts frames; take precedence over
 *  MOUNT_PTS). Part-riding ones are overwritten from the part's weapon point (PART_REST). */
export const FOOT_MOUNTS: Record<string, Pt[]> = {
  long: [[-0.17, 0]],
  // striker: the hero weapon stands on the torso at the centre (the other M rides it as a pod), utility over the prow
  cross: [[-0.06, -0.05], [-0.06, 0.05], [0.3, 0]],
  airframe: [[0.04, -0.37], [0.04, 0.37]],
  delta: [[0.12, 0], [-0.22, -0.28], [-0.22, 0.28]],
  interceptor: [[-0.06, -0.3], [-0.06, 0.3]],
  strikejet: [[0.06, 0], [-0.1, -0.33], [-0.1, 0.33]],
  stratobomber: [[0.28, 0], [0.08, 0], [-0.22, 0], [-0.46, 0]],
  // giant / titan bombers: bays down the belly (bombs drop in a stick), defensive guns at nose, tail and waist
  strategic: [[0.22, 0], [0.07, 0], [-0.08, 0], [-0.23, 0], [0.42, 0], [-0.47, 0]],
  superfortress: [[0.25, 0], [0.09, 0], [-0.07, 0], [-0.23, 0], [0.0, -0.2], [0.0, 0.2], [0.44, 0], [-0.47, 0], [-0.14, -0.4], [-0.14, 0.4]],
  // airship: the bow gun on the keel's nose, four keel bays clustered amidships (a hovering bomber drops from right
  // over its target, so every bay must reach it from there), gun blisters on the two gasbags
  airship: [[0.3, 0], [0.08, -0.1], [0.08, 0.1], [-0.08, -0.1], [-0.08, 0.1], [-0.28, -0.3], [-0.28, 0.3]],
  heavyheli: [[0.42, 0], [-0.02, 0.36], [-0.02, -0.36]],
  bomber: [[0.33, 0], [0.0, -0.3], [0.0, 0.3]],
  carrier: [[0.24, 0], [-0.2, 0.0], [-0.1, -0.33], [-0.1, 0.33]],
  leviathan: [[0.29, 0], [-0.3, 0], [0.0, -0.3], [0.0, 0.3]],
  goliath: [[0.15, 0], [-0.16, -0.37], [-0.16, 0.37], [-0.34, 0]],
  titan: [[0.02, -0.3], [0.02, 0.3], [0.38, 0], [-0.34, 0]],
  mantis: [[0.3, -0.27], [0.3, 0.27]],
  crab: [[0.3, -0.4], [0.3, 0.4], [-0.08, 0]],
  warlord: [[-0.04, 0], [0.06, -0.39], [0.06, 0.39], [0.2, 0]],
  mech: [[-0.04, 0], [0.04, -0.37], [0.04, 0.37]],
  scorpion: [[-0.33, -0.27], [0.47, -0.3], [0.47, 0.3]],
  centipede: [[0.2, 0], [0.04, 0], [-0.12, 0], [-0.28, 0]],
  broodmother: [[-0.06, 0], [0.34, 0], [-0.08, -0.24], [-0.08, 0.24], [-0.38, 0]],
  arachne: [[-0.06, 0], [0.22, -0.16], [0.22, 0.16], [-0.38, 0]],
  riot: [[-0.12, -0.2], [-0.12, 0.2]],
  juggernaut: [[-0.14, 0], [-0.3, 0.2]],
  siegeplat: [[0.2, 0], [-0.16, 0]],
  hunter: [[0.12, 0], [-0.3, 0]],
  colossal: [[0.14, 0.38], [0.14, -0.38], [-0.12, -0.17], [-0.12, 0.17], [-0.36, 0]],
  citadel: [[0.22, -0.26], [0.22, 0.26], [-0.27, 0], [-0.39, -0.39], [-0.39, 0.39], [0.45, 0]],
  // lance: the titan gun at the breech of the spinal accelerator (centreline, ahead of the bridge), the medium on the
  // aft deck; monolith: the giant gun in the roof cupola, the medium in a rear-quarter casemate
  lance: [[0.06, 0], [-0.36, 0]],
  monolith: [[0.1, 0], [-0.33, 0.33]],
  pod: [[-0.04, 0]],
  box: [[0.06, -0.24], [0.06, 0.24]],
  hex: [[0.04, 0], [-0.24, 0]],
  round: [[-0.02, 0], [-0.39, 0]],
};

/** Rest-pose positions (hull-local cells) of mounts riding animated parts on footprint frames, per chassis id and
 *  mount index (null = not part-riding). SNAPSHOT of the art rig (footart footParts / creatures buildParts, which
 *  are render-only); regenerate from `layoutOf` if the rig moves a weapon point (test/mountgeo.test.ts fails). */
export const PART_REST: Record<string, (Pt | null)[]> = {
  mantis: [[0.54, -0.29500000000000004], [0.54, 0.29500000000000004]],
  strider: [null, [0.060000000000000005, -0.6799999999999999], [0.060000000000000005, 0.6799999999999999]],
  crab: [[0.76, -1.24], [0.76, 1.24], null],
  warlord: [null, [0.10500000000000001, -1.3399999999999999], [0.10500000000000001, 1.3399999999999999], null],
  scorpion: [[-1.54, -0.798], [1.83, -0.99], [1.83, 0.99]],
  centipede: [[0.7599999999999999, 0.6], [0.04750000000000004, -0.6], [-0.665, 0.6], [-1.3775000000000002, -0.6]],
};

export const RANK: Record<MountClass, number> = { S: 1, M: 2, L: 3, XL: 4 };
/** frames whose mounts ride animated anatomy (limbs, claws, tails): hardpoints are fixed to the part */
export const PART_SHAPES = new Set(['mantis', 'mech', 'warlord', 'arachnid', 'broodmother', 'arachne', 'crab', 'saucer', 'scorpion', 'centipede']);

/** Hardpoint points (fractions of X, Y) for a chassis: footprint frame table, else per-chassis table, else a grid. */
export function hardpointsOf(chassis: ChassisDef): Pt[] {
  return FOOT_MOUNTS[chassis.shape] ?? MOUNT_PTS[chassis.id] ?? chassis.mounts.map((_, i, a) => [0.05 - 0.25 * Math.floor(i / 2), a.length === 1 ? 0 : (i % 2 ? 0.2 : -0.2)] as Pt);
}

/** A hardpoint is "edge" (melee-capable) when it sits on the front rim (x >= MELEE_EDGE) or a side rim
 *  (|y| >= MELEE_EDGE, not behind MELEE_SIDE_MIN), i.e. within ~24% of the half-extent of the hull boundary.
 *  Rear and centre-deck points never qualify: a blade there can't reach anything. */
export const MELEE_EDGE = 0.38;
export const MELEE_SIDE_MIN = -0.2;

const meleeCache = new Map<string, boolean[]>();
/** meleeSlots(chassis)[i] = true when mount slot i (design.mounts order) is near the hull edge and can fit a melee
 *  weapon. Anatomy-riding mounts (arms, claws, forelimbs) count when they are not on the rear/tail. Ground hulls
 *  only: flyers return all false. */
export function meleeSlots(chassis: ChassisDef): boolean[] {
  let out = meleeCache.get(chassis.id);
  if (out) return out;
  const pts = hardpointsOf(chassis);
  const Y = chassis.footprint?.[0] ?? chassis.size, X = chassis.footprint?.[1] ?? chassis.size;
  const rest = FOOT_MOUNTS[chassis.shape] && PART_SHAPES.has(chassis.shape) && chassis.shape !== 'centipede' ? PART_REST[chassis.id] : undefined;
  out = chassis.mounts.map((_, i) => {
    if ((chassis.domain ?? 'ground') !== 'ground') return false;
    const r = rest?.[i];
    if (r) return r[0] / X > MELEE_SIDE_MIN;
    const p = pts[i] ?? [0, 0];
    return p[0] >= MELEE_EDGE || (Math.abs(p[1]) >= MELEE_EDGE && p[0] > MELEE_SIDE_MIN);
  });
  meleeCache.set(chassis.id, out);
  return out;
}

/** perm[i] = hardpoint index module i occupies. Sockets are fixed by the chassis: the part the player puts in socket i
 *  sits on hardpoint i (its class and edge/melee eligibility come from that same hardpoint), never re-shuffled by role. */
export function mountPerm(chassis: ChassisDef, _pts: Pt[], _mods: (ModuleDef | null)[]): number[] {
  return chassis.mounts.map((_, i) => i);
}

/** Melee tools (saws, prods, claws, rams...) sit at the hull's front edge so the tool reaches out ahead of it, not on a
 *  mid-deck gun mount. x is hull-local cells (+x forward), X the footprint length. Anatomical frames keep their points. */
export function meleeFront(mod: ModuleDef | null, x: number, X: number): number {
  return mod && mod.kind === 'weapon' && mod.projectile === 'melee' ? Math.max(x, 0.3 * X) : x;
}

/** How much of its footprint a hull's body fills on the battlefield, by size class. Footprints (deploy grid, squad
 *  slots) stay whole cells; the body inside them is drawn and simulated at this scale, so light squads have room
 *  between troopers and big hulls are small next to their weapon ranges. Sim hit shapes, mount origins and the battle
 *  art (2D + 3D) all scale by it; the designer shows the art at full size. */
export const bodyScale = (size: number) => (size <= 1 ? 0.7 : 0.78);
/** Hull half-extent per footprint cell in the sim (radius = hullK * sqrt(fw * fh); boxes hullK * fw x hullK * fh). */
export const hullK = (size: number) => 0.45 * bodyScale(size);

/** Unit-size factor on turret diameters: a bigger hull carries a slightly bigger mount for the same weapon. */
export const unitK = (S: number) => (S >= 5 ? 1.12 : S >= 4 ? 1.06 : 1 + 0.12 * (S - 1));

/** Middle of each class's turret housing band (reference cells; render weaponsize.ts BAND_D). */
const CLASS_D_MID: Record<MountClass, number> = { S: 0.32, M: 0.52, L: 0.85, XL: 1.06 };
/** Approximate turret housing diameter (cells) of a module class on a hull of size S. The exact drawn size also
 *  depends on calibre / overlap clearing (render-only); the sim uses half of this as a weapon's muzzle reach. */
export const approxTurretD = (cls: MountClass, S: number) => CLASS_D_MID[cls] * unitK(S);

/** Box [w across, l along] in cells the chassis art (and its hardpoints) is laid out in: ChassisDef.art, else the
 *  footprint, else size x size. The footprint itself (collisions, deploy blocks) stays ChassisDef.footprint. */
export const artBox = (c: ChassisDef): [number, number] => c.art ?? c.footprint ?? [c.size, c.size];

const offCache = new Map<string, { x: number; y: number }[]>();

/**
 * Rest-pose mount centres in hull-local cells (+x = forward, +y = right), one per design mount slot: the same
 * values as the render's `layoutOf(design).mounts[i].x/.y`. Rotate by the hull angle and add the unit position for
 * the world point: (ux + cos(a) * x - sin(a) * y, uy + sin(a) * x + cos(a) * y). Cached per design key; do not mutate.
 */
export function mountOffsets(d: Design): { x: number; y: number }[] {
  const key = `${d.chassis}|${d.mounts.map((m) => m ?? '-').join(',')}`;
  let out = offCache.get(key);
  if (out) return out;
  const chassis = CHASSIS_BY_ID.get(d.chassis) ?? CHASSIS_BY_ID.get('scout')!;
  const [Y, X] = artBox(chassis);
  const pts = hardpointsOf(chassis);
  const mods = chassis.mounts.map((_, i) => { const id = d.mounts[i] ?? null; return id ? MODULE_BY_ID.get(id) ?? null : null; });
  const perm = mountPerm(chassis, pts, mods);
  const rest = FOOT_MOUNTS[chassis.shape] && PART_SHAPES.has(chassis.shape) ? PART_REST[chassis.id] : undefined;
  out = chassis.mounts.map((_, i) => {
    const r = rest?.[i];
    if (r) return { x: r[0], y: r[1] };
    const p = pts[perm[i]] ?? [0, 0];
    return { x: PART_SHAPES.has(chassis.shape) ? p[0] * X : meleeFront(mods[i], p[0] * X, X), y: p[1] * Y };
  });
  offCache.set(key, out);
  return out;
}
