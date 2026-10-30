// Battle simulation contract. Implemented in src/shared/sim/battle.ts; consumed by
// match.ts (headless resolution), the server, and the client renderer (live playback).
//
// Determinism: given identical BattleInput the sim MUST produce identical results on any JS engine
// run. Use makeRng(input.seed) only; iterate units in stable (array) order; no Date/Math.random.

import type { Design, Placement, Side, UnitStats } from '../types.ts';

export const TICK_RATE = 20; // ticks per second
export const DT = 1 / TICK_RATE;
export const MAX_TICKS = TICK_RATE * 180; // 180s battle cap (480 x 460 m field)

/** What dealt a killing blow, for the wreck's look: bullets/rails/blades perforate, explosives tear apart and scatter,
 *  energy melts, fire (burn ticks, fire fields) chars, crush flattens. */
export type DeathKind = 'kinetic' | 'explosive' | 'energy' | 'fire' | 'crush';
/** 0 intact (perforated) hull, 1 burnt and broken, 2 broken apart into pieces, 3 blown to smithereens (scorch + debris) */
export type WreckLevel = 0 | 1 | 2 | 3;
const WRECK_KIND_K: Record<DeathKind, number> = { kinetic: 0.75, explosive: 1.3, energy: 1, fire: 0.5, crush: 0.45 };

/** Destruction level of a wreck from the killing blow: a unit chewed up by many small hits leaves a whole hull, one
 *  giant hit (nuke, doomsday shell, mass driver slug) leaves next to nothing. `hit` and `overkill` are in max hp;
 *  `heft` scales for the weapon's class (titan weapons tear apart even what a small fraction of their hit kills). */
export function wreckLevel(hit: number, overkill: number, kind: DeathKind, heft = 1): WreckLevel {
  const s = (0.55 * hit + 0.45 * overkill) * WRECK_KIND_K[kind] * heft;
  return s < 0.12 ? 0 : s < 0.45 ? 1 : s < 1.8 ? 2 : 3;
}

export interface SideInput {
  /** the player's deck; placements reference these by id */
  designs: Design[];
  units: Placement[];
}

export interface BattleInput {
  seed: number;
  sides: [SideInput, SideInput];
  /** tug of war (shared/tug.ts): an endless fight that blocks join mid-battle (Battle.spawnBlock); it ends only when
   *  a side's core (Battle.cores) is destroyed, and units ignore enemies far off their lane and march on the core */
  tug?: boolean;
}

export interface MountState {
  moduleId: string | null;
  /** world-space angle (radians, 0 = +x, PI/2 = +y) the mount points */
  angle: number;
  /** seconds until it can fire again */
  cooldown: number;
  /** 0..1 visual recoil / muzzle flash, decays after firing */
  flash: number;
  /** uid (SimUnit.id) currently targeted, or -1 */
  target: number;
  /** shots left in the magazine (weapons with a magazine only) */
  ammo?: number;
  /** true while the magazine reloads */
  reloading?: boolean;
}

export interface SimUnit {
  /** unique within the battle */
  id: number;
  side: Side;
  /** Placement.uid on its owner's board */
  uid: number;
  design: Design;
  stats: UnitStats;
  level: number;
  /** world center, cells */
  x: number;
  y: number;
  /** body heading, radians */
  angle: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  alive: boolean;
  flying: boolean;
  /** true while its own locomotion moved it this tick (for wheel/leg animation; being shoved aside does not count) */
  moving: boolean;
  /** distance travelled so far (drives tread/leg animation phase) */
  odometer: number;
  /** 0..1 height while leaping (jump legs); 0 otherwise */
  leap: number;
  mounts: MountState[];
  /** recent damage taken, 0..1 decaying (hit flash) */
  hitFlash: number;
  /** seconds of paralysis remaining (can't move, turn or fire) */
  stun: number;
  /** paralysis damage (Zero-K style): stun weapons pile it up; above maxHp the unit is stunned until it drains back */
  para: number;
  /** current slow fraction 0..0.6 (reduces move speed and fire rate) */
  slow: number;
  /** seconds of burning remaining */
  burning: number;
  /** seconds remaining during which it can't fire (but can move) */
  disarm: number;
  /** true while enemies can't target it (cloak not revealed) */
  cloaked: boolean;
  /** reactive armor charges left */
  reactive: number;
  /** projected shield from allied shield domes (absorbed after the unit's own shield) */
  auraShield: number;
  maxAuraShield: number;
}

export interface SimProjectile {
  id: number;
  side: Side;
  moduleId: string;
  kind: 'bullet' | 'shell' | 'rocket' | 'missile' | 'flame' | 'arc' | 'orb';
  x: number;
  y: number;
  /** height above ground in cells (arc shells, missiles) */
  z: number;
  /** travel heading, radians */
  angle: number;
  /** 0..1 progress to impact (useful for arcs) */
  progress: number;
  /** shooter (SimUnit.id) and its mount index, so the view can launch the round from that barrel's tip */
  src?: number;
  mount?: number;
  /** arc shells: launch point, aim point (cells) and apex height above the straight line between them (the sim flies
   *  z = 4 arcH k (1 - k) over a straight ground track) */
  sx?: number; sy?: number; tx?: number; ty?: number; arcH?: number;
}

export type BattleEvent =
  | { t: 'fire'; unit: number; mount: number; moduleId: string; x: number; y: number; angle: number }
  | { t: 'beam'; moduleId: string; x1: number; y1: number; x2: number; y2: number; side: Side; unit?: number; mount?: number }
  | { t: 'chain'; moduleId: string; points: { x: number; y: number }[]; side: Side; unit?: number; mount?: number }
  | { t: 'hit'; unit: number; damage: number; shieldHit: boolean; x: number; y: number; moduleId: string }
  /** air: the blast went off in the air (a round fired at aircraft, e.g. a flak proximity burst): only flyers are hit,
   *  and the renderers draw it at the aircraft's altitude with no mark on the ground (absent for ground bursts) */
  | { t: 'explode'; x: number; y: number; radius: number; moduleId: string; air?: true }
  | { t: 'heal'; unit: number; amount: number; from: number }
  /** overkill / hit: how far below 0 hp the killing blow went, and that blow's size (after armour), both in max hp;
   *  kind: what killed it; wreck: WreckLevel derived from the three (visual only) */
  | { t: 'death'; unit: number; x: number; y: number; size: number; flying: boolean; moduleId: string; overkill: number; hit: number; kind: DeathKind; wreck: WreckLevel }
  | { t: 'leap'; unit: number }
  | { t: 'smoke'; x: number; y: number; radius: number; duration: number }
  /** a firebomb's burning patch on the ground (ModuleDef.fireField); lasts `duration` s */
  | { t: 'fireField'; x: number; y: number; radius: number; duration: number; moduleId: string; rad?: boolean }
  | { t: 'end'; winner: Side | -1 };

/** A unit's combat record over one battle (accounting only: the fight never reads it). Damage counts shields too. */
export interface UnitTally {
  /** damage dealt to enemies; dealtAir is the part dealt to flying ones */
  dealt: number;
  dealtAir: number;
  /** damage taken from any source; shieldTaken is the part its own / dome shields soaked */
  taken: number;
  shieldTaken: number;
  /** hp repaired on allies (repair beams, repair aura) */
  healed: number;
  /** SimUnit.ids of the enemies it landed the killing blow on */
  kills: number[];
  /** SimUnit.id of the enemy that killed it, or -1 */
  killedBy: number;
  /** tick it died, or -1 while alive */
  deathTick: number;
  /** dealt and kills split by the module that did it (weapon id; burns count for the igniting weapon, death blasts for
   *  the blast module, 'crush' for running enemies over) */
  byWeapon: Record<string, { dealt: number; dealtAir: number; kills: number[] }>;
}

export interface BattleSummary {
  winner: Side | -1;
  ticks: number;
  /** surviving Placement.uids per side */
  survivors: [number[], number[]];
  /** per side: fraction (0..1] of each surviving placement uid's units still alive (squads); keys = survivors */
  aliveFraction: [Record<number, number>, Record<number, number>];
  /** total damage dealt by each side */
  damageDealt: [number, number];
}
