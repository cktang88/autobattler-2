// Mount geometry shared by the sim (server + client) and the unit art. Pure data + math: no DOM / canvas.
//
// Hardpoint positions are fractions of the footprint (X = length along the facing, Y = width across; square
// chassis X = Y = S) in the hull-local frame: +x = forward (nose), +y = right. The render's
// `layoutOf(design).mounts[i].x/.y` (src/client/render/unitart.ts) is built from exactly these tables (socket i always
// sits on hardpoint i), so `mountOffsets(design)` matches it by construction. The one exception is mounts that ride animated
// anatomy on footprint frames (arms, claws, tails, train cars): the art places those from its part rig, which is
// render-only, so their rest-pose positions are snapshotted in PART_REST below (test/mountgeo.test.ts asserts
// parity with layoutOf for every chassis + starter design, so a rig change that moves a weapon fails loudly).

import { CHASSIS_BY_ID, MOBILITY_BY_ID, MODULE_BY_ID, MODULES } from './parts.ts';
import { weaponD } from './weaponsize.ts';
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
  leviathan: [[0.325, 0], [-0.325, 0], [0.0, -0.3], [0.0, 0.3]],
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
  // titan walker (torso: weapons drawn where the torso carries them): titan gun on the right shoulder (edge slot, a fist
  // hangs on the right arm), giant gun on the left forearm, mediums on the left pauldron and the backpack
  colossal: [[0.2, 0.38], [0.04, -0.38], [-0.06, -0.3], [-0.36, -0.12], [-0.36, 0.12]],
  citadel: [[0.22, -0.26], [0.22, 0.26], [-0.27, 0], [-0.39, -0.39], [-0.39, 0.39], [0.45, 0]],
  // lance: the titan gun in its keel between the trunnion cheeks (centreline), the medium on the command tower behind
  // the breech; monolith: the giant gun in the casemate's front slot, the medium on the rear-right corner tower
  lance: [[0.06, 0], [-0.38, 0]],
  monolith: [[0.14, 0], [-0.235, 0.21]],
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

// ---- where the 3D model draws each module, and so where the sim fires it from -------------------------------------
// The 3D units (client/proto3d/units3d.ts) build every hull round its main weapon: the hero takes the hull's primary
// seat, the secondary weapons of a small / medium hull ride the hero turret as pods on its flanks, and a module whose
// housing would clash with another moves to the nearest clear spot. drawnSeats() is that placement, shared so the
// battle sim, the range tools and the renderer agree on where every gun is.

/** drawn housing diameter (cells) per weapon class on ground hulls: the same weapon is the same size on every hull */
export const DRAW_D: Record<MountClass, number> = { S: 0.75, M: 1.5, L: 3.0, XL: 5.25 };
/** hulls with a mech torso (client chassis registerTorso): the upper body twists with the guns and the chassis says
 *  where on it each weapon hangs. Kept here as data so the server's sim sees the same list as the client */
export const TORSO_HULLS = new Set(['raider', 'aegis', 'mantis', 'strider', 'arachnid', 'crab', 'saucer', 'warlord', 'juggernaut', 'broodmother', 'titan', 'arachne', 'lance', 'monolith']);

export interface Seats {
  /** the main weapon's slot (biggest housing, first of a tie), -1 without weapons */
  hero: number;
  /** standing module centres (cells, x forward, y right) per slot, null for empty slots and pods */
  pos: ({ x: number; y: number } | null)[];
  /** pod index on the hero turret per slot (-1 = not a pod) */
  pod: number[];
  /** drawn housing radius per slot (0 = empty) */
  r: number[];
  /** drawn as an aircraft (fixed hardpoint guns); a lifted titan is not */
  flying: boolean;
  torso: boolean;
}

const seatCache = new Map<string, Seats>();
/** class a module is drawn at in slot i (a utility in a smaller hardpoint shrinks to the slot) */
const drawCls = (ch: ChassisDef, mod: ModuleDef, i: number): MountClass => {
  const sl = ch.mounts[i];
  return sl && mod.kind !== 'weapon' && RANK[mod.mount] > RANK[sl] ? sl : mod.mount;
};

/** The 3D model's seat for every module of a design (see the section comment). Cached per design; do not mutate. */
export function drawnSeats(d: Design): Seats {
  const key = `${d.chassis}|${d.mobility}|${d.mounts.map((m) => m ?? '-').join(',')}`;
  let out = seatCache.get(key);
  if (out) return out;
  const ch = CHASSIS_BY_ID.get(d.chassis) ?? CHASSIS_BY_ID.get('scout')!;
  const mob = MOBILITY_BY_ID.get(d.mobility);
  // a titan-class ground hull lifted into the air keeps its anatomy and class-size turning guns (units3d liftedTitan);
  // only real aircraft use fixed hardpoint guns
  const flying = ((ch.domain ?? 'ground') !== 'ground' || mob?.kind === 'air') && !(ch.size >= 5 && (ch.domain ?? 'ground') === 'ground');
  const torso = !flying && TORSO_HULLS.has(ch.id);
  const offs = mountOffsets(d);
  const mods = ch.mounts.map((_, i) => { const id = d.mounts[i] ?? null; return id ? MODULE_BY_ID.get(id) ?? null : null; });
  const r = mods.map((m, i) => (!m ? 0 : m.kind === 'weapon' ? DRAW_D[drawCls(ch, m, i)] / 2 : Math.min(DRAW_D[drawCls(ch, m, i)] * 0.6, 1.2) / 2));
  let hero = -1;
  mods.forEach((m, i) => { if (m && m.kind === 'weapon' && (hero < 0 || weaponD(m) > weaponD(mods[hero]!))) hero = i; });
  const pod = mods.map(() => -1);
  if (!flying && (torso || (ch.size <= 3 && !PART_SHAPES.has(ch.shape))) && hero >= 0) {
    let n = 0;
    const max = torso ? 6 : 3;
    mods.forEach((m, i) => { if (n < max && i !== hero && m && m.kind === 'weapon' && offs[i]) pod[i] = n++; });
  }
  const pos = offs.map((o, i) => (o && mods[i] && pod[i] < 0 ? { x: o.x, y: o.y } : null));
  if (!flying && !torso && hero >= 0 && pos[hero]) {
    // the hero takes the primary socket (biggest class, first of a tie); the module that was there takes its slot
    let prim = -1;
    ch.mounts.forEach((c, i) => { if (offs[i] && pod[i] < 0 && (prim < 0 || RANK[c] > RANK[ch.mounts[prim]!])) prim = i; });
    if (prim >= 0 && prim !== hero && RANK[ch.mounts[prim]!] >= RANK[ch.mounts[hero]!]) {
      const t = pos[prim] ?? { x: offs[prim]!.x, y: offs[prim]!.y };
      if (pos[prim]) pos[prim] = pos[hero];
      pos[hero] = t;
    }
    const stand = pos.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
    const clash = (i: number, x: number, y: number) => stand.some((j) => j !== i && Math.hypot(pos[j]!.x - x, pos[j]!.y - y) < 0.9 * (r[i] + r[j]));
    // move the smaller module of a clashing pair (never the hero); candidates on a grid over the hull, inside its outline
    const [W, L] = artBox(ch);
    for (const i of [...stand].sort((a, b) => r[a] - r[b])) {
      if (i === hero || !clash(i, pos[i]!.x, pos[i]!.y)) continue;
      const hx = Math.max(0, L / 2 - r[i] * 0.8), hy = Math.max(0, W / 2 - r[i] * 0.8);
      let best: { x: number; y: number } | null = null, bd = Infinity;
      for (let gx = -8; gx <= 8; gx++) for (let gy = -8; gy <= 8; gy++) {
        const x = (gx / 8) * hx, y = (gy / 8) * hy, dd = Math.hypot(x - pos[i]!.x, y - pos[i]!.y);
        if (dd < bd && !clash(i, x, y)) { bd = dd; best = { x, y }; }
      }
      if (best) pos[i] = best;
    }
  }
  out = { hero, pos, pod, r, flying, torso };
  seatCache.set(key, out);
  return out;
}

/** a pod's place on its hero turret (hero-local cells, x forward, y right, h = height as a fraction of the hero's
 *  trunnion height): side pods right then left by the housing, a third on top at the back */
export function podSeat(slot: number, heroR: number, podR: number): { x: number; y: number; h: number } {
  const s = slot === 0 ? 1 : slot === 1 ? -1 : 0;
  return { x: slot < 2 ? -heroR * 0.12 : -heroR * 0.75, y: s * (heroR * 1.05 + podR * 0.9), h: slot < 2 ? 0.6 : 1 };
}

/** where each torso hull hangs its weapons at rest (cells, x forward, y right), measured from the 3D builders
 *  (scripts/3d/torso-seats.ts): keyed by role (hero 'H' / pod 'P0'.. in slot order) and weapon class, or by slot,
 *  class and role ('S1:M:P'), whichever the hull's torso builder places by */
export const TORSO_SEATS: Record<string, { by: 'role' | 'slot'; at: Record<string, [number, number]> }> = {
  raider: { by: 'role', at: { 'H:S': [0.039, 0.572], 'P0:S': [0.081, -0.572] } },
  aegis: { by: 'slot', at: { 'S0:M:H': [0.1, 0], 'S0:S:H': [0.1, 0], 'S0:S:P': [-0.918, 0.78], 'S1:S:H': [-0.64, 0], 'S1:S:P': [-0.17, 0.78] } },
  mantis: { by: 'role', at: { 'H:S': [0.36, 0], 'P0:S': [-0.298, 0] } },
  strider: { by: 'role', at: { 'H:M': [0.1, 0.885], 'H:S': [0.1, 0.593], 'P0:S': [0.17, -0.77], 'P1:S': [-0.184, -0.62] } },
  arachnid: { by: 'role', at: { 'H:M': [0.06, 1.035], 'H:S': [0.06, 0.788], 'P0:M': [0.175, -1.035], 'P0:S': [0.102, -1.035] } },
  crab: { by: 'slot', at: { 'S0:M:H': [0.7, -1.02], 'S0:M:P': [0.815, -1.02], 'S0:S:P': [0.742, -1.02], 'S1:M:H': [0.7, 1.02], 'S1:M:P': [0.815, 1.02], 'S1:S:H': [0.7, 1.02], 'S1:S:P': [0.662, 1.02], 'S2:S:H': [-0.26, 0], 'S2:S:P': [-0.224, 0] } },
  saucer: { by: 'slot', at: { 'S0:M:H': [0, -0.86], 'S0:M:P': [0.115, -0.86], 'S0:S:P': [0.042, -0.86], 'S1:M:H': [0, 0.86], 'S1:M:P': [0.115, 0.86], 'S1:S:H': [0, 0.86], 'S1:S:P': [-0.038, 0.86], 'S2:S:H': [-0.86, 0], 'S2:S:P': [-0.824, 0] } },
  warlord: { by: 'slot', at: { 'S0:M:H': [-0.46, 0], 'S0:M:P': [-0.345, 0], 'S0:S:P': [-0.418, 0], 'S1:M:H': [0.04, -1.38], 'S1:M:P': [0.155, -1.38], 'S1:S:P': [0.003, -1.38], 'S2:M:H': [0.04, 1.38], 'S2:M:P': [0.155, 1.38], 'S2:S:P': [-0.016, 1.38], 'S3:S:P': [0.484, 0] } },
  juggernaut: { by: 'role', at: { 'H:M': [-0.06, 0], 'H:S': [-0.06, 0], 'P0:S': [-0.73, 0.96] } },
  broodmother: { by: 'slot', at: { 'S0:L:H': [0.285, 0], 'S0:M:H': [0.143, 0], 'S0:M:P': [0.115, 0], 'S0:S:P': [0.036, 0], 'S1:M:H': [-2.058, 0], 'S1:M:P': [-2.085, 0], 'S1:S:P': [-2.238, 0], 'S2:M:H': [1.093, -1.8], 'S2:M:P': [1.065, -1.8], 'S2:S:P': [0.894, -1.8], 'S3:M:H': [1.093, 1.8], 'S3:M:P': [1.065, 1.8], 'S3:S:P': [1, 1.8], 'S4:S:P': [-1.958, -0.95] } },
  titan: { by: 'slot', at: { 'S0:L:H': [0.335, 2.65], 'S0:M:H': [0.193, 2.65], 'S0:M:P': [0.165, 2.65], 'S0:S:P': [0.092, 2.65], 'S0:XL:H': [0.549, 2.65], 'S1:L:H': [0.635, -3.6], 'S1:M:H': [0.492, -3.6], 'S1:M:P': [0.465, -3.6], 'S1:S:P': [0.392, -3.6], 'S2:M:H': [-0.408, -3], 'S2:M:P': [-0.435, -3], 'S2:S:P': [-0.606, -3], 'S3:M:H': [-2.607, -1.15], 'S3:M:P': [-2.635, -1.15], 'S3:S:P': [-2.7, -1.15], 'S4:M:H': [-4.008, 0.9], 'S4:M:P': [-4.035, 0.9], 'S4:S:P': [-4.206, 0.9] } },
  arachne: { by: 'slot', at: { 'S0:L:H': [0.101, 0], 'S0:M:H': [-0.041, 0], 'S0:M:P': [-0.069, 0], 'S0:S:P': [-0.142, 0], 'S0:XL:H': [0.315, 0], 'S1:L:H': [0.301, -3.3], 'S1:M:H': [0.159, -3.3], 'S1:M:P': [0.131, -3.3], 'S1:S:P': [0.058, -3.3], 'S2:L:H': [0.301, 3.3], 'S2:L:P': [0.304, 3.3], 'S2:M:H': [0.159, 3.3], 'S2:M:P': [0.131, 3.3], 'S2:S:H': [0.087, 3.3], 'S2:S:P': [-0.021, 3.3], 'S3:M:H': [-3.891, 0], 'S3:M:P': [-3.919, 0], 'S3:S:P': [-3.984, 0] } },
  lance: { by: 'slot', at: { 'S0:L:H': [0.835, 0], 'S0:M:H': [0.693, 0], 'S0:M:P': [0.665, 0], 'S0:S:H': [0.621, 0], 'S0:S:P': [0.592, 0], 'S0:XL:H': [1.049, 0], 'S1:M:H': [-3.657, 0], 'S1:M:P': [-3.685, 0], 'S1:S:H': [-3.729, 0], 'S1:S:P': [-3.837, 0] } },
  monolith: { by: 'slot', at: { 'S0:L:H': [1.285, 0], 'S0:M:H': [1.143, 0], 'S0:M:P': [1.115, 0], 'S0:S:H': [1.071, 0], 'S0:S:P': [1.042, 0], 'S1:M:H': [-1.507, 1.45], 'S1:M:P': [-1.535, 1.45], 'S1:S:H': [-1.579, 1.45], 'S1:S:P': [-1.688, 1.45] } },
};

const fireCache = new Map<string, { x: number; y: number }[]>();
/**
 * Where each mount fires from at rest (hull-local cells, +x forward, +y right; same frame and scaling as mountOffsets):
 * the 3D model's seat for it (drawnSeats; a pod sits on its hero turret's flank). Torso hulls carry their weapons where
 * the torso holds them, which their mount table already describes. Battle sim and range tools use this.
 */
export function fireOffsets(d: Design): { x: number; y: number }[] {
  const key = `${d.chassis}|${d.mobility}|${d.mounts.map((m) => m ?? '-').join(',')}`;
  let out = fireCache.get(key);
  if (out) return out;
  const offs = mountOffsets(d), st = drawnSeats(d);
  const ts = st.torso ? TORSO_SEATS[d.chassis] : undefined;
  out = offs.map((o, i) => {
    if (ts && o && (i === st.hero || st.pod[i] >= 0)) {
      const id = d.mounts[i], cls = id ? MODULE_BY_ID.get(id)?.mount : undefined;
      const role = i === st.hero ? 'H' : `P${st.pod[i]}`;
      const p = ts.by === 'role' ? ts.at[`${role}:${cls}`] : ts.at[`S${i}:${cls}:${role[0]}`];
      if (p) return { x: p[0], y: p[1] };
    }
    if (st.torso || st.flying) return o;
    if (st.pod[i] >= 0 && st.pos[st.hero]) {
      const p = podSeat(st.pod[i], st.r[st.hero], st.r[i]);
      return { x: st.pos[st.hero]!.x + p.x, y: st.pos[st.hero]!.y + p.y };
    }
    return st.pos[i] ?? o;
  });
  fireCache.set(key, out);
  return out;
}

/** where a weapon put into slot i would be drawn (an empty socket's ring in the garage): fireOffsets of the design with
 *  a typical gun of the slot's class in it */
export function slotSeat(d: Design, i: number): { x: number; y: number } | null {
  const ch = CHASSIS_BY_ID.get(d.chassis);
  const cls = ch?.mounts[i];
  if (!cls) return null;
  const gun = MODULES.find((m) => m.kind === 'weapon' && m.mount === cls && m.projectile !== 'melee');
  if (!gun) return mountOffsets(d)[i] ?? null;
  return fireOffsets({ ...d, mounts: ch.mounts.map((_, j) => (j === i ? gun.id : d.mounts[j] ?? null)) })[i] ?? null;
}
