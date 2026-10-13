// Core shared types. Every module (sim, match, ai, client, server) speaks these.

export type Size = 1 | 2 | 3;
/** Weapon mount class. A slot of class X accepts modules of class X or smaller (L < M < H). */
export type MountClass = 'L' | 'M' | 'H';
export type MoveKind = 'ground' | 'air' | 'static';
export type Side = 0 | 1;

export type ChassisTrait = 'rangeBoost' | 'repairAura' | 'airOnly' | 'compact';
/** distance (cells, edge to edge) at which a 'stealth' cloak is revealed */
export const CLOAK_REVEAL = 2.5;
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

/** 'melee' = instant contact strike; its range is measured EDGE to edge (shooter radius + target radius excluded),
 *  ground targets only. 'arc' = lobbed shell with a real flight time that lands where the target WAS. */
export type ProjectileKind = 'bullet' | 'shell' | 'rocket' | 'missile' | 'beam' | 'flame' | 'arc' | 'lightning' | 'rail' | 'orb' | 'melee' | 'none';

/** Main weapon/module categories (UI grouping + AI roles). */
export type ModuleCategory =
  | 'machinegun' | 'autocannon' | 'cannon' | 'precision' | 'rocket' | 'missile' | 'artillery'
  | 'energy' | 'flame' | 'disruption' | 'antiair' | 'melee'
  | 'support' | 'defense' | 'stealth' | 'systems' | 'armor';

/** Render family: the renderer draws a turret per visual kind, varied by barrels & caliber. */
export type ModuleVisual =
  | 'gun' | 'gatling' | 'shotgun' | 'cannon' | 'gauss' | 'sniper' | 'rail' | 'rocketPod' | 'missileRack' | 'cruise'
  | 'mortar' | 'artillery' | 'laser' | 'heatray' | 'plasma' | 'flamer' | 'tesla' | 'emp' | 'slowbeam' | 'flak'
  | 'repair' | 'shield' | 'sensor' | 'plate' | 'sonic' | 'gravity'
  // melee
  | 'saw' | 'chainsaw' | 'hammer' | 'claw' | 'blade' | 'drill' | 'prod' | 'ram'
  // utilities
  | 'cloak' | 'jammer' | 'smoke' | 'pointdef' | 'engine' | 'uplink' | 'charge' | 'gyro' | 'coolant' | 'dome' | 'nanite';
export type ModuleKind = 'weapon' | 'armor' | 'utility';

export interface ModuleDef {
  id: string;
  name: string;
  desc: string;
  mount: MountClass;
  kind: ModuleKind;
  category: ModuleCategory;
  /** sub-category label shown in UI, e.g. "30mm" or "Twin 30mm" */
  family: string;
  visual: ModuleVisual;
  /** visual barrel / tube count (1 if omitted) */
  barrels?: number;
  /** visual size 0..1 within its mount class */
  caliber?: number;
  weight: number;
  /** base complexity cost of the part; final unit cost also depends on predicted combat power (stats.ts) */
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
  /** clip size: after this many shots (volleys) the weapon pauses `reload` seconds. Omit = continuous fire */
  magazine?: number;
  /** seconds to reload a full magazine */
  reload?: number;
  /** projectiles per shot fired simultaneously in a spread (shotguns, barrage) */
  pellets?: number;
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
  /** random aim error in cells at max range (0 = pinpoint). Hitscan beams/lightning/rail never miss;
   *  homing missiles track their target; every other projectile flies to where the target WAS when fired
   *  (no lead), so slow unguided shots miss fast movers. */
  spread?: number;
  /** lightning: additional jumps */
  chain?: number;
  /** multiplier vs flying targets (default 1) */
  airBonus?: number;
  /** rail/gauss: hits every enemy along its path (once each) */
  pierce?: boolean;
  /** seconds of paralysis applied per hit (target can't move or fire); stacks up to 4s */
  stun?: number;
  /** slow applied per hit: fraction of speed & fire rate removed (0..1) for 2s; max 0.6 */
  slow?: number;
  /** burning damage over time applied per hit (refreshes, doesn't stack) */
  burn?: { dps: number; duration: number };
  /** knockback in cells per hit, away from the shooter (negative = pull toward). Halved vs size 2, x0.25 vs size 3, none vs static */
  impulse?: number;
  /** seconds per hit the target can't fire (but can still move); stacks to max 4s */
  disarm?: number;
  /** damage multiplier at max range (beams that fade with distance, e.g. 0.3); 1 = none */
  falloff?: number;
  // ---- utility ----
  /** hp healed per second to the most damaged ally in range */
  heal?: number;
  /** personal energy shield points (regenerates 5%/s after 3s without damage) */
  shield?: number;
  /** utility: +fraction weapon range for the whole unit (targeting computer) */
  rangeBonus?: number;
  /** utility: multiplies weapon spread (e.g. 0.6) */
  spreadMult?: number;
  // ---- more utilities (each is optional; a module may combine several) ----
  /** 'stealth': can't be targeted unless an enemy is within CLOAK_REVEAL cells or it fired in the last 1.5s.
   *  'phantom': can't be targeted except for 3s after each time it fires (proximity doesn't reveal it). */
  cloak?: 'stealth' | 'phantom';
  /** reveals cloaked enemies within this many cells (for all allies) */
  detect?: number;
  /** projects an energy shield onto allies (not self) within radius; each ally gets up to `amount` shield, regenerating */
  shieldAura?: { radius: number; amount: number };
  /** self-repair: fraction of max hp per second (only after 2s without damage) */
  regen?: number;
  /** +fraction move speed (applied in stats.speed) */
  speedBonus?: number;
  /** +fraction rate of fire for all of this unit's weapons */
  fireRateBonus?: number;
  /** -fraction reload time for clip weapons */
  reloadBonus?: number;
  /** allies within radius get +bonus rate of fire (doesn't stack between uplinks) */
  fireRateAura?: { radius: number; bonus: number };
  /** shoots down incoming enemy rockets/missiles/shells/arc/orb projectiles within range, one per cooldown */
  pointDefense?: { range: number; cooldown: number };
  /** enemy missiles aimed at allies within radius lose homing; enemy spread doubled vs them */
  jammer?: number;
  /** when first dropping below 60% hp: smoke cloud of radius for duration; units inside can't be targeted from > 2.5 cells */
  smoke?: { radius: number; duration: number };
  /** number of explosive hits (shell/rocket/missile/arc/orb) reduced by 75% */
  reactive?: number;
  /** fraction of damage removed from beam/lightning/rail/plasma/flame hits */
  energyResist?: number;
  /** immune to stun, slow, disarm, burn and knockback */
  hardened?: boolean;
  /** explodes on death */
  deathBlast?: { damage: number; radius: number };
  /** grants fire-on-move to the whole unit */
  gyro?: boolean;
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
  /** range multiplier from chassis/mobility traits and modules */
  rangeMult: number;
  /** spread multiplier from traits/modules (stable, targeting computer) */
  spreadMult: number;
  // ---- cost model breakdown (see stats.ts) ----
  /** sum of the parts' base complexity costs */
  partsCost: number;
  /** predicted damage output rating */
  offense: number;
  /** effective hp rating (hp, shield, armor, evasion, flight) */
  ehp: number;
  /** combat power = sqrt(offense * ehp) * mobility factor */
  power: number;
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
  /** squads only: empty cells between neighbouring units in the block (0..MAX_SPACING, default 0). See grid.ts */
  spacing?: number;
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
