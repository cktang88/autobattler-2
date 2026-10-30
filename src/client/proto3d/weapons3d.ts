// Procedural stylized 3D weapons for every ModuleDef (src/shared/parts.ts), by visual family / mount class / calibre.
// Turret frame: +X = muzzle direction, +Y = up, origin on the deck at the turret ring centre.
// Static parts are merged into one mesh per material per rig group (yaw / pitch / recoil / spin).
//
// SIZING (strict, shared with the 2D art via src/client/render/weaponsize.ts):
//   housing diameter D = weaponD(mod) x unit scale: a band per size tier (S < M < M-heavy < L < XL) placed by calibre
//   and weight, so a 75 mm gun is always bigger than a 40 mm one and no M weapon outgrows an L one.
//   barrel radius from the real calibre (boreOf(mm)), barrel length from the family x D; bigger calibre = fatter, longer.
// FAMILIES live in weapons/*.ts (guns, launchers, energy, melee, utility); weapons/wkit.ts holds the shared kit.

import * as THREE from 'three';
import { unitK } from '../../shared/mountgeo.ts';
import { moduleTier } from '../../shared/parts.ts';
import type { ModuleDef, MountClass } from '../../shared/types.ts';
import { CLASS_RANK, boreOf, calibreMm, classPos, weaponD } from '../render/weaponsize.ts';
import type { Kit } from './materials.ts';
import { Bld, loft, type P2 } from './geo.ts';
import { accent, deckRing, finishHousing, type WCtx } from './weapons/wkit.ts';
import { buildGun } from './weapons/guns.ts';
import { buildLauncher } from './weapons/launchers.ts';
import { buildEnergy } from './weapons/energy.ts';
import { buildMelee } from './weapons/melee.ts';
import { buildUtility } from './weapons/utility.ts';
import { arc, artillery, blades, carbine, cradle, emitter, flame, lens, railDriver, rotary } from './weapons/w2500.ts';

export interface Turret {
  /** yaw group: rotate .rotation.y for traverse */
  yaw: THREE.Group;
  /** pitch group (barrels hang off this) */
  pitch: THREE.Group;
  /** barrel assembly that kicks back on firing */
  recoil: THREE.Group;
  muzzles: THREE.Object3D[];
  /** spinning barrel cluster (gatling), saw disc or drill: rotated about its local X */
  spin?: THREE.Object3D;
  /** visible ammunition (warheads in a launcher's cells, a missile on its erector, bombs on a rack): the renderer
   *  hides it when the weapon fires and shows it again once reloaded */
  ammo?: THREE.Object3D;
  /** spin rate (rad/s) of `spin` right now: kicked up by each shot, winding down to idleSpin between bursts */
  spinV: number;
  /** spin rate at rest: 0 for rotary barrels (a parked gatling holds still), a slow idle for saw discs / drills */
  idleSpin: number;
  /** weapon fires fixed forward (aircraft hardpoints) */
  fixed: boolean;
  /** weapon pod riding another turret (index into the unit's turrets): it turns with its host and aims only a little
   *  on its own (aimPod) */
  host?: number;
  /** visual projectile style */
  shot: 'tracer' | 'shell' | 'beam' | 'orb' | 'rocket' | 'flame' | 'none';
  /** cooldown seconds between visual shots */
  rate: number;
  /** turret radius (cells) */
  r: number;
  /** triangle count (for stats) */
  tris: number;
}

const GUNS = new Set(['gun', 'gatling', 'shotgun', 'cannon', 'gauss', 'sniper', 'rail', 'flak', 'pointdef']);
const LAUNCH = new Set(['rocketPod', 'missileRack', 'cruise', 'mortar', 'artillery', 'charge']);
const ENERGY = new Set(['laser', 'heatray', 'plasma', 'flamer', 'tesla', 'emp', 'slowbeam', 'sonic', 'gravity']);
const MELEE = new Set(['saw', 'chainsaw', 'hammer', 'claw', 'blade', 'drill', 'prod', 'ram']);

/** Unit-size scale applied to reference weapon sizes (bigger hulls carry proportionally bigger hardware). */
/** Drawn housing diameter (cells) of a weapon / module of each size class, the same on every hull: each class twice
 *  the one below (L 2x M 2x S), titan weapons 1.75x large, so a class reads at a glance (titans are built round them). */
export const DRAW_D: Record<MountClass, number> = { S: 0.75, M: 1.5, L: 3.0, XL: 5.25 };
/** reference cells -> drawn cells for ground weapons (DRAW_D M 1.5 over the M band middle 0.52) */
export const DRAW_K = 1.5 / 0.52;
/** drawn barrel radius of a ground weapon (cells): what its rounds / rockets / beams are sized from */
export const drawnBore = (mod: ModuleDef, cls: MountClass = mod.mount): number =>
  Math.max(boreOf(calibreMm(mod)) * 0.4 * DRAW_K, (DRAW_D[cls] / 2) * 0.075);

export const unitScale = (S: number) => unitK(S) * (S > 2 ? 1 + 0.22 * (S - 2) : 1);

/** `cls` overrides the size class (a utility shrunk to a smaller hardpoint, same rule as the 2D art's weaponsize). */
/** `drawD` (cells) fixes the housing diameter: ground units pass their size class's drawn size (units3d DRAW_D), so a
 *  class's housing is the same on every hull; bores (calibre) and barrel lengths (class position) still vary per
 *  weapon on top of it, scaled by the same drawing scale. Without it the old hull-scaled size applies (aircraft). */
export function buildTurret(mod: ModuleDef, S: number, kit: Kit, fixed = false, cls?: MountClass, drawD = 0): Turret {
  const ov = cls && cls !== mod.mount ? cls : undefined;
  // drawing scale: reference cells -> drawn cells (one global factor for every ground weapon, hull size for aircraft)
  const kS = drawD ? DRAW_K : unitScale(S);
  const D = drawD || weaponD(mod, ov) * kS;
  const mainL = 0;
  const r = D / 2;
  const yaw = new THREE.Group(), pitch = new THREE.Group(), recoil = new THREE.Group();
  yaw.add(pitch); pitch.add(recoil);
  const t: Turret = { yaw, pitch, recoil, muzzles: [], fixed, shot: 'tracer', rate: 0.5, r, tris: 0, spinV: 0, idleSpin: 0 };
  let spinG: THREE.Group | null = null;
  const C: WCtx = {
    b: new Bld(), p: new Bld(), rc: new Bld(), sp: new Bld(), am: new Bld(), kit, mod, r, D,
    c: classPos(mod, ov), tier: (ov ? CLASS_RANK[ov] : moduleTier(mod)) as WCtx['tier'], nb: mod.barrels ?? 1,
    // armour level of the weapon body by its size class only (a weapon looks the same on every hull): small weapons
    // are slim exposed guns, medium ones get side pods and a sensor, large / titan weapons the full armoured body
    arm: ((t) => (t <= 1 ? 0.15 : t <= 2 ? 0.5 : t <= 4 ? 0.85 : 1))(ov ? CLASS_RANK[ov] : moduleTier(mod)),
    // stylized but gun-like: barrel radius ~0.4 x the true bore width (long slim tubes read as machines, fat pipes as
    // toys), never thinner than 7.5% of the housing radius so it survives a small screen
    bore: Math.max(boreOf(calibreMm(mod)) * 0.4 * kS, r * 0.075),
    y0: fixed ? 0 : r * 0.1, fixed, mainL, bv: Math.max(0.004, r * 0.05), t,
    muzzle: (x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); recoil.add(o); t.muzzles.push(o); },
    spin: (axis = 'x', at = [0, 0, 0]) => {
      spinG = new THREE.Group();
      if (axis === 'z') { const holder = new THREE.Group(); holder.rotation.y = -Math.PI / 2; holder.position.set(...at); holder.add(spinG); recoil.add(holder); }
      else { spinG.position.set(...at); recoil.add(spinG); }
      t.spin = spinG;
    },
  };
  C.b.segMax = C.p.segMax = C.rc.segMax = S >= 2 ? 16 : 10;
  const v = mod.visual;
  if (MELEE.has(v)) t.idleSpin = t.spinV = 6;
  if (!fixed && v !== 'plate' && !MELEE.has(v)) deckRing(C);

  // year-2500 families (weapons/w2500.ts) take precedence over the older modern-weapon builders
  const W25 = v === 'gatling' ? rotary : v === 'rocketPod' || v === 'missileRack' ? blades : v === 'tesla' ? arc : v === 'laser' ? lens : v === 'plasma' ? cradle : v === 'flamer' ? flame : v === 'rail' ? railDriver
    : v === 'gun' || v === 'shotgun' || v === 'flak' || v === 'pointdef' || v === 'sniper' ? carbine
    : v === 'mortar' || v === 'artillery' ? artillery
    : v === 'heatray' || v === 'emp' || v === 'slowbeam' || v === 'sonic' || v === 'gravity' ? emitter : null;
  if (W25) W25(C);
  else if (GUNS.has(v)) buildGun(C);
  else if (LAUNCH.has(v)) buildLauncher(C);
  else if (ENERGY.has(v)) buildEnergy(C);
  else if (MELEE.has(v)) buildMelee(C);
  else buildUtility(C);
  finishHousing(C);

  // team accent: a stripe on the housing's left cheek for weapons that did not place their own
  if (!fixed && t.shot !== 'none' && !C.acc) accent(C, -r * 0.3, C.y0 + r * 0.42, -r * 0.42, r * 0.36, r * 0.07);

  const tris0 = C.b.tris;
  C.b.mount(yaw);
  C.p.mount(pitch);
  C.rc.mount(recoil);
  if (spinG) C.sp.mount(spinG);
  if (C.am.tris || hasGeo(C.am)) { const ag = new THREE.Group(); recoil.add(ag); C.am.mount(ag); t.ammo = ag; }
  t.tris = C.b.tris - tris0 + C.p.tris + C.rc.tris + C.sp.tris + C.am.tris;
  return t;
}

/** Slew a turret's yaw toward a target given in the owning unit's local XZ plane (x fwd, z right). Returns the remaining error (rad). */
export function aimTurret(t: Turret, lx: number, lz: number, dt: number, rate = 3): number {
  if (t.fixed) return 0;
  const want = -Math.atan2(lz - t.yaw.position.z, lx - t.yaw.position.x);
  let diff = want - t.yaw.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  t.yaw.rotation.y += diff * Math.min(1, dt * rate);
  return Math.abs(diff);
}
/** Aim a pod riding a host turret: the pod's yaw is relative to the host, so it takes the wanted unit-local angle
 *  (0 = forward, +ve toward +z) minus the host's traverse, clamped to +-0.4 rad. Returns the remaining error (rad). */
export function aimPod(t: Turret, hostYaw: number, localAngle: number, dt: number, rate = 3): number {
  let want = -localAngle - hostYaw;
  want = Math.atan2(Math.sin(want), Math.cos(want));
  const tgt = Math.max(-0.4, Math.min(0.4, want));
  t.yaw.rotation.y += (tgt - t.yaw.rotation.y) * Math.min(1, dt * rate);
  return Math.abs(want - t.yaw.rotation.y);
}
/** Kick the barrel assembly back (call on each shot) and relax it each frame with recoilRelax. */
export function recoilKick(t: Turret): void { t.recoil.position.x = -t.r * 0.18; t.spinV = 30; }
export function recoilRelax(t: Turret, dt: number): void {
  t.recoil.position.x *= Math.max(0, 1 - dt * 9);
  if (t.spin) {
    // rotary barrels spin at full rate while firing and wind down to rest after the burst (they used to turn at a
    // constant 6 rad/s forever, so every parked minigun / gatling kept whirring)
    if (t.recoil.position.x < -0.01) t.spinV = 30;
    else t.spinV = t.idleSpin + (t.spinV - t.idleSpin) * Math.max(0, 1 - dt * 2.5);
    if (Math.abs(t.spinV - t.idleSpin) < 0.05) t.spinV = t.idleSpin;
    t.spin.rotation.x = (t.spin.rotation.x + dt * t.spinV) % (Math.PI * 2);
  }
}

/** a builder holds geometry not yet mounted */
const hasGeo = (B: Bld): boolean => (B as unknown as { m: Map<unknown, unknown[]> }).m.size > 0;

export { loft };
export type { P2 };
