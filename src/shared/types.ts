// Core shared types. Every module (sim, match, ai, client, server) speaks these.

export type Size = 1 | 2 | 3;
/** Weapon mount class. A slot of class X accepts modules of class X or smaller (L < M < H). */
export type MountClass = 'L' | 'M' | 'H';
export type MoveKind = 'ground' | 'air' | 'static';
export type Side = 0 | 1;

export type ChassisTrait = 'rangeBoost' | 'repairAura' | 'airOnly' | 'compact';
export type MobilityTrait = 'fireOnMove' | 'evasive' | 'leap' | 'fortified' | 'stable' | 'strafe' | 'crush';

export interface ChassisDef {
  id: string;
  name: string;
  desc: string;
  size: Size;
  hp: number;
  armor: number;
  weight: number;
  cost: number;
  mounts: MountClass[];
  traits: ChassisTrait[];
  /** Render hint: silhouette family for procedural art. */
  shape: 'wedge' | 'box' | 'pod' | 'hex' | 'long' | 'round' | 'cross' | 'fortress' | 'titan' | 'airframe';
}

export interface MobilityDef {
  id: string;
  name: string;
  desc: string;
  kind: MoveKind;
  sizes: Size[];
  /** cells / second at ideal load */
  speed: number;
  /** radians / second body turn rate */
  turn: number;
  /** Max weight carried at full speed, per chassis size (index 0 = size 1). 0 means unsupported. */
  capacity: [number, number, number];
  /** weight per size unit (total = weight * size) */
  weight: number;
  /** hp per size unit */
  hp: number;
  armor: number;
  /** cost per size unit */
  cost: number;
  traits: MobilityTrait[];
}

export type ProjectileKind = 'bullet' | 'shell' | 'rocket' | 'missile' | 'beam' | 'flame' | 'arc' | 'lightning' | 'rail' | 'none';
export type ModuleKind = 'weapon' | 'armor' | 'utility';

export interface ModuleDef {
  id: string;
  name: string;
  desc: string;
  mount: MountClass;
  kind: ModuleKind;
  weight: number;
  cost: number;
  hp?: number;
  armor?: number;
  // ---- weapon fields (kind === 'weapon') ----
  /** damage per hit (per projectile) */
  damage?: number;
  /** seconds between shots (or between bursts when burst > 1) */
  cooldown?: number;
  /** projectiles per volley, fired ~0.1s apart */
  burst?: number;
  /** cells */
  range?: number;
  minRange?: number;
  targetsGround?: boolean;
  targetsAir?: boolean;
  projectile?: ProjectileKind;
  /** cells / second; ignored for hitscan (beam, lightning, rail) */
  projectileSpeed?: number;
  /** splash radius in cells (0 = single target) */
  splash?: number;
  /** armor pierce 0..1 (fraction of target armor ignored) */
  ap?: number;
  /** random aim error in cells at max range */
  spread?: number;
  /** lightning: additional jumps */
  chain?: number;
  /** multiplier vs flying targets (default 1) */
  airBonus?: number;
  /** rail: hits everything along the line */
  pierce?: boolean;
  // ---- utility ----
  /** hp healed per second to the most damaged ally in range */
  heal?: number;
  /** personal energy shield points (regenerates 5%/s after 3s without damage) */
  shield?: number;
}

/** A player-authored unit blueprint. */
export interface Design {
  id: string;
  name: string;
  chassis: string;
  mobility: string;
  /** one entry per chassis mount slot; null = empty */
  mounts: (string | null)[];
}

/** Derived stats of a design (see stats.ts). */
export interface UnitStats {
  size: Size;
  hp: number;
  armor: number;
  weight: number;
  capacity: number;
  /** weight / capacity */
  load: number;
  speed: number;
  turn: number;
  cost: number;
  flying: boolean;
  isStatic: boolean;
  /** longest weapon range (after range bonuses) */
  range: number;
  /** approximate sustained dps vs 0 armor */
  dps: number;
  shield: number;
  heal: number;
  traits: string[];
  /** range multiplier from chassis/mobility traits */
  rangeMult: number;
}

/** One placed unit instance on a player's board. Coordinates are in the player's LOCAL deploy grid (see grid.ts). */
export interface Placement {
  /** unique per side within a match */
  uid: number;
  designId: string;
  /** top-left cell, local coords */
  x: number;
  y: number;
  /** 1..MAX_LEVEL */
  level: number;
  /** round it was placed in */
  round: number;
}

export interface DeployAction {
  round: number;
  /** newly bought units */
  place: Placement[];
  /** uids of existing units to upgrade by one level (may repeat a uid to upgrade twice) */
  upgrade: number[];
}

export interface RoundResult {
  /** 0 or 1, or -1 for draw */
  winner: Side | -1;
  /** surviving unit uids per side */
  survivors: [number[], number[]];
  /** damage dealt TO each player this round */
  damage: [number, number];
  ticks: number;
}

export interface RoundRecord {
  round: number;
  seed: number;
  boards: [Placement[], Placement[]];
  result: RoundResult;
}

export interface PlayerState {
  name: string;
  /** up to DECK_SIZE designs, fixed for the match */
  deck: Design[];
  hp: number;
  supply: number;
  board: Placement[];
  nextUid: number;
  /** has submitted this round's deployment */
  ready: boolean;
  isAI?: boolean;
}

export type MatchMode = 'ai' | 'pvp';
export type MatchStatus = 'waiting' | 'deploy' | 'done';

export interface MatchState {
  id: string;
  mode: MatchMode;
  status: MatchStatus;
  round: number;
  seed: number;
  players: [PlayerState, PlayerState];
  history: RoundRecord[];
  winner?: Side | -1;
  createdAt: number;
  updatedAt: number;
}
