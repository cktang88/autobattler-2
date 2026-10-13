// Battle simulation contract. Implemented in src/shared/sim/battle.ts; consumed by
// match.ts (headless resolution), the server, and the client renderer (live playback).
//
// Determinism: given identical BattleInput the sim MUST produce identical results on any JS engine
// run. Use makeRng(input.seed) only; iterate units in stable (array) order; no Date/Math.random.

import type { Design, Placement, Side, UnitStats } from '../types.ts';

export const TICK_RATE = 20; // ticks per second
export const DT = 1 / TICK_RATE;
export const MAX_TICKS = TICK_RATE * 120; // 120s battle cap

export interface SideInput {
  /** the player's deck; placements reference these by id */
  designs: Design[];
  units: Placement[];
}

export interface BattleInput {
  seed: number;
  sides: [SideInput, SideInput];
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
  /** true while it moved this tick (for wheel/leg animation) */
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
}

export type BattleEvent =
  | { t: 'fire'; unit: number; mount: number; moduleId: string; x: number; y: number; angle: number }
  | { t: 'beam'; moduleId: string; x1: number; y1: number; x2: number; y2: number; side: Side }
  | { t: 'chain'; moduleId: string; points: { x: number; y: number }[]; side: Side }
  | { t: 'hit'; unit: number; damage: number; shieldHit: boolean; x: number; y: number; moduleId: string }
  | { t: 'explode'; x: number; y: number; radius: number; moduleId: string }
  | { t: 'heal'; unit: number; amount: number; from: number }
  | { t: 'death'; unit: number; x: number; y: number; size: number; flying: boolean }
  | { t: 'leap'; unit: number }
  | { t: 'smoke'; x: number; y: number; radius: number; duration: number }
  | { t: 'end'; winner: Side | -1 };

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
