// =====================================================================================================================
// CHASSIS + MOBILITY BUILDER REGISTRY  (src/client/proto3d/chassis/*, src/client/proto3d/mobility/*)
// =====================================================================================================================
//
// buildUnit(design) (units3d.ts) assembles a ground unit in four steps:
//
//   1. stance   = mobility.stance(...)         heights the hull is built on (underside y0, shoulder yt, legged?, ...)
//   2. out      = chassis(ctx)                 hull meshes into ctx.b; returns deck query, turret seats, hips
//   3. mobility.build(...)                     running gear into ctx.root (legs read out.hips)
//   4. turrets at mountOffsets(design)         seated with out.seat(m) (or on deckAt + a generic barbette)
//
// ADDING A CHASSIS
//   * Pick the right group file (chassis/tanks.ts, walkers.ts, giants.ts, titans.ts, ... or a new one imported from
//     chassis/index.ts) and call `registerChassis('<shape or chassis id>', (c) => { ...; return out; })`.
//     Lookup order is chassis id first, then ChassisDef.shape, then the generic loft fallback (chassis/generic.ts).
//   * Put hull geometry into `c.b` (one Bld merged per material -> the unit's static body; it bobs a little). Anything
//     that must animate gets its own THREE.Group under c.body / c.root and pushes an updater into c.updates.
//     Keep everything static-mergeable: the render instances one template per design (squads of 16+), so a unit is
//     ~1 draw call per animated group. Never create per-unit materials: use c.kit part types only.
//   * Return ChassisOut:
//       deckAt(x, z)  top surface height (hull-local) or -1 off the hull: used for deck props and default seats.
//       seat(m)       per mount, { y, socket }: the turret ring height and whether you modelled the ring/collar
//                     yourself (socket=true) or want the generic armoured barbette (socket=false).
//       hips          leg attach points (see Hip) when c.stance.legs is set; omit to get mobility defaults.
//       custom        true = skip the generic deck clutter (greebles, numbers, mast) added for fallback hulls.
//   * Mounts: c.mounts[i] = { x, z, r, cls, mod } in hull-local cells, exactly mountOffsets(design) (the sim fires from
//     there, src/shared/mountgeo.ts). Build the anatomy so a weapon sits ON something at that point (arm pod, sponson,
//     deck collar). Never move the mount; move the anatomy. r = that turret's ring radius (weapons3d sizes by class).
//
// ADDING A MOBILITY
//   * mobility/<group>.ts: `registerMobility(['treads', ...], { stance(s) {...}, build(c) {...} })`.
//     stance() must be cheap and pure; build() adds meshes to c.root (not the bobbing body) and may return an updater
//     (t seconds, moving 0..1). Legs use c.hips from the chassis (or the defaults from stance()).
//   * Animation convention: render3d drives animate(t) with t = odometer * phaseK (units-adapter phaseFor): legs use
//     phase = t * 3.2 and a half-stride of `strideFor(mob, S)` so planted feet do not skate.
//
// CONVENTIONS
//   * Units: 1 cell = 1 world unit = 5 m. Hull-local frame: +x forward (nose), +y up, +z right (sim +y).
//     L = length (footprint[1]), W = width (footprint[0]), S = size class 1..5. Ground at y = 0.
//   * Proportions (stylized, chunky, readable from the ~58 deg RTS camera; check the TOP view first):
//       tanks     hull height 35-60% of width; tracks/skirts ~30% of that; turret ~0.5-0.6 of hull width.
//       walkers   torso slung LOW between legs (hips ~0.35-0.45 of width up); thigh width >= 18% of torso width;
//                 big hip drums, armoured thighs, pistons, broad feet. Legs must look able to carry the body.
//       spiders   body underside ~0.2-0.3 x width; knees ABOVE the body top; feet planted well outside the hull.
//       giants    stepped superstructures, face/visor, sponsons; titans: heroic humanoid mass, arms carry weapons.
//     Exaggerate: slightly oversized turrets, feet, hip drums and shoulder pads; few, big details (glow strips, vents,
//     hazard bands) instead of many small greebles. Bevel everything (geo.ts bevBox/slab/loft, shapes.ts block()).
//   * Look: stylized and clean, not photoreal. Flat part colours from the kit, soft cel ramp, bevel highlights
//     (materials.ts). No grime/camo. Team colour only in kit.accent / kit.glow / kit.lamp.
//   * Material part types (c.kit): hull (main paint), panel (lighter plates), trim (dark recesses, joints, rings),
//     metal (dark gunmetal mechanics), steel (bright pistons/rods), rubber (tracks, tyres, foot pads), glass
//     (canopies/visors; dark tinted), hazard (yellow bands), accent (team colour paint), glow (team-coloured emissive
//     strips), lamp (warm white emissive), hot (orange exhaust glow), plasma/rail (weapon emissives), canvas.
//   * Triangle budget per unit incl. turrets and gear (unit.tris): S1 <= 15k, S2..S5 <= 30k. Spend it on shape (bevels,
//     smooth rounded parts, layered plates), not on piles of tiny greebles; use plain THREE.BoxGeometry via b.g() for
//     repeated tiny parts.
//     Lathes: 8-12 segments for small parts, 16-24 for big drums; lofts with 8-point rings.
// =====================================================================================================================

import type * as THREE from 'three';
import type { ChassisDef, Design, ModuleDef, MountClass, MobilityDef as MobPart } from '../../../shared/types.ts';
import type { Bld, V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';

/** what the mobility needs the hull to be built on */
export interface Stance {
  /** hull underside height */
  y0: number;
  /** shoulder height (track top / fender level); hull flanks start here */
  yt: number;
  /** half width available to the lower hull between running gear */
  wi: number;
  tracked: boolean;
  /** legged locomotion: hull should provide hips (or accept default ones) */
  legs: null | 'biped' | 'spider';
  /** leg thickness hint (cells) for legged stances */
  thick: number;
  /** hip height hint for legged stances */
  hipY: number;
}

export interface StanceIn { mobId: string; L: number; W: number; S: number; shape: string }

/** one weapon hardpoint, hull-local cells (x forward, z right), from mountOffsets(design) */
export interface MountSpec { i: number; x: number; z: number; r: number; cls: MountClass; mod: ModuleDef }

/** leg attachment: hip pivot (hull-local), side (-1 left, +1 right), rest foot position on the ground */
export interface Hip { p: V3; side: -1 | 1; foot: V3; /** leg thickness at the hip */ t: number; /** gait phase offset (radians) */ phase: number }

export interface ChassisCtx {
  b: Bld;
  kit: Kit;
  design: Design;
  ch: ChassisDef;
  mob: MobPart;
  L: number; W: number; S: number;
  stance: Stance;
  mounts: MountSpec[];
  rnd: () => number;
  /** bobbing body group (b is merged into it) */
  body: THREE.Group;
  /** unit root (not bobbing) */
  root: THREE.Group;
  /** per-frame updaters (t seconds, dt, moving 0..1, dir = travel direction in the hull frame, rad, 0 = forward) */
  updates: ((t: number, dt: number, mv: number, dir?: number) => void)[];
}

export interface Seat { y: number; socket: boolean }

export interface ChassisOut {
  deckAt(x: number, z: number): number;
  top: number;
  seat?: (m: MountSpec) => Seat | null;
  hips?: Hip[];
  /** skip the generic deck clutter */
  custom?: boolean;
  /** the builder placed the hard-surface functional kit itself: skip units3d's slot autoDress (hs-kit AUTO_DRESS) */
  dressed?: boolean;
  /** mech torso: the hero weapon's turret becomes the upper body (it twists as a whole, weapons on arms / shoulders).
   *  Called after the turrets exist with a builder in the hero yaw frame (origin = the hero seat, +x forward, world
   *  units, unscaled); returns the weapon hardpoints in that frame: hp[0] = the hero's trunnion, hp[1..] = the pods
   *  (secondary weapons riding the hero, in pod order). units3d drops the hero's ring / yoke and the pod brackets.
   *  at moves the twist pivot (the hero yaw origin) to that point of the hull frame. Weapons keep their own class size
   *  (units3d DRAW_D): design the torso round the slot sizes, never rescale a weapon. */
  torso?: (b: Bld, t: { heroR: number; podR: number[] }) => { hp: V3[]; at?: V3 };
}

export type ChassisBuilder = (c: ChassisCtx) => ChassisOut;

export interface MobilityCtx {
  root: THREE.Group;
  kit: Kit;
  mobId: string;
  L: number; W: number; S: number;
  shape: string;
  stance: Stance;
  hips?: Hip[];
}
export interface MobilityBuilder {
  stance(s: StanceIn): Stance;
  /** returns the gear animation: t = gait clock, moving 0..1, dir = travel direction in the hull frame (rad, 0 =
   *  forward, +PI/2 = toward +z): walkers stride that way (a spider strafing, legs backing up); others ignore it */
  build(c: MobilityCtx): ((t: number, moving: number, dir?: number) => void) | void;
}

const CHASSIS = new Map<string, ChassisBuilder>();
const MOBILITY = new Map<string, MobilityBuilder>();

/** register a hull builder under one or more chassis ids / shape ids */
export function registerChassis(keys: string | string[], fn: ChassisBuilder): void {
  for (const k of Array.isArray(keys) ? keys : [keys]) CHASSIS.set(k, fn);
}
export function registerMobility(ids: string | string[], def: MobilityBuilder): void {
  for (const k of Array.isArray(ids) ? ids : [ids]) MOBILITY.set(k, def);
}
/** chassis id first, then shape, then the 'generic' fallback */
export function chassisBuilder(ch: ChassisDef): ChassisBuilder {
  return CHASSIS.get(ch.id) ?? CHASSIS.get(ch.shape) ?? CHASSIS.get('generic')!;
}
export function mobilityBuilder(id: string): MobilityBuilder {
  return MOBILITY.get(id) ?? MOBILITY.get('generic')!;
}
/** registered keys (diagnostics / lab view) */
export const registered = () => ({ chassis: [...CHASSIS.keys()], mobility: [...MOBILITY.keys()] });
