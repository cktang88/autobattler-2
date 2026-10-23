// Deterministic battle simulation. Fixed tick (DT), seeded RNG only, stable iteration order.
//
// Layout: `units` (public SimUnit) is indexed by SimUnit.id; `ints` holds the matching internal state.
// Each tick: weapons (targeting, turrets, firing) -> movement -> spatial hash -> separation/crush ->
// auras -> projectiles -> bookkeeping -> end check.

import { CHASSIS, CHASSIS_BY_ID, MODULE_BY_ID } from '../parts.ts';
import { approxTurretD, mountOffsets } from '../mountgeo.ts';
import { computeStats, defaultOrders, isValidDesign, levelMult, turretTurnRate, weaponDps } from '../stats.ts';
import { FIELD_H, FIELD_W, forwardY, normSpacing, placementUnitCenters } from '../grid.ts';
import { makeRng, type Rng } from '../rng.ts';
import { CLOAK_REVEAL, REPAIR_AURA_RANGE, START_DELAYS, STANCES, TARGET_PRIORITIES } from '../types.ts';
import type { Design, ModuleDef, Side, Stance, TargetPriority } from '../types.ts';
import { DT, MAX_TICKS, TICK_RATE } from './types.ts';
import type { BattleEvent, BattleInput, BattleSummary, MountState, SimProjectile, SimUnit } from './types.ts';

// ---- tuning ----
/** a turret only fires once its barrel is on target (~3.4°) — bursts included */
const AIM_TOLERANCE = 0.06; // rad
const RETARGET_EVERY = 0.3; // s
const GOAL_EVERY = 0.4; // s
const BURST_GAP = 0.1; // s
/** golden angle: successive rounds of a salvo spiral out evenly instead of clumping */
const GOLDEN_ANGLE = 2.399963229728653;
/** a fresh shot is held (and the turret looks for another target) while rounds already in flight are expected to
 *  finish its target off; rechecked every this many seconds */
const OVERKILL_RECHECK = 0.3; // s
const SHIELD_DELAY = 3; // s
const SHIELD_REGEN = 0.05; // fraction of max per s
const EVADE_CHANCE = 0.2;
const MIN_DMG_FRAC = 0.15;
const SPLASH_EDGE = 0.3;
const CHAIN_JUMP = 2.5; // cells
const CHAIN_FALLOFF = 0.8;
const LEAP_COOLDOWN = 6;
const LEAP_TIME = 0.8;
const AURA_RANGE = REPAIR_AURA_RANGE; // [aura balance] edge to edge, see types.ts
const AURA_RATE = 0.012; // fraction of maxHp per s
const AURA_EVERY = 0.5;
/** [aura balance] a dome projects at most this fraction of the ally's own max hp (light squads would otherwise gain ~70% ehp each) */
const AURA_SHIELD_HP = 0.5;
const HEAL_EVENT_EVERY = 0.3;
const CRUSH_EVERY = 0.3;
const BOMB_ALT = 1.5; // cells: height bombs start falling from
const BOMB_FALL = 0.5; // seconds a bomb takes to land
const CRUSH_DMG = 14; // per size of the crusher, per contact pulse
const RANGE_KEEP = 1.08; // hysteresis: a held target stays valid out to range * this
const STALL_CHECK_EVERY = 20; // ticks
/** A battle where nothing at all happens for this long (no unit moves, no shot, hit or heal, no projectile or smoke
 *  in the air, no hp change, every start delay over) can never change again: it ends then, decided exactly as the
 *  time cap would decide it (e.g. two cloaked armies parked out of reveal range used to idle out the full 180 s). */
const QUIET_END = 10 * TICK_RATE; // ticks
const MAX_STUN = 4;
/** Paralysis (Zero-K style): a weapon's `stun` (s) deals stun * PARA_PER_STUN paralysis damage. A unit is stunned while
 *  its paralysis exceeds its max hp, so tough hulls take many more hits; paralysis drains at maxHp * PARA_DECAY per
 *  second, and is capped so one stun lasts at most MAX_STUN seconds. Hits while stunned extend the stun. */
export const PARA_PER_STUN = 150;
const PARA_DECAY = 1 / 20;
/** Disarm works like paralysis (disarm damage vs max hp); slow damage builds toward MAX_SLOW at max hp (Zero-K style)
 *  and drains at maxHp * SLOW_DMG_DECAY per second. */
const DISARM_PER_S = 150;
const SLOW_PER = 1000;
const SLOW_DMG_DECAY = 0.5;
const MAX_SLOW = 0.6;
const BURN_EVERY = 0.5; // s between burn damage pulses
const STEALTH_FIRE_REVEAL = 1.5; // s a stealth unit stays visible after firing
const PHANTOM_FIRE_REVEAL = 3;
const SMOKE_SIGHT = 2.5; // units inside smoke can only be targeted from within this distance
const SMOKE_AT = 0.6; // hp fraction that pops smoke
const REGEN_DELAY = 2;
const REACTIVE_MULT = 0.25;
const CLS_EXPLOSIVE = 1;
const CLS_ENERGY = 2;
const KNOCK_RATE = 0.35; // fraction of pending knockback applied per tick
const FOCUS_RADIUS = 6; // cells: allies this close count towards 'focus'
const RETREAT_BELOW = 0.3; // hp fraction that starts a retreat
const RETREAT_ABOVE = 0.7; // hp fraction that ends it
const FLANK_EDGE = 4; // cells from the field edge a flanker swings out to
const FLANK_TURN_IN = 1.3; // flankers turn in once the goal is within this many weapon ranges
const ESCORT_NEAR = 3; // cells: escorts try to stay this close to the escorted block
const ESCORT_LEASH = 7; // cells: how far from the escorted unit an escort will chase a threat
const ESCORT_THREAT = 12; // cells: threats this close to the escorted unit are engaged
const CHARGE_GUN_FRAC = 0.4; // guns on a charge keep closing until within this fraction of their range
const HOLDPOS_MASS = 60; // holdPos units barely get shoved by separation
/** s: a backing-off kiter (not fireOnMove) stops for its kite gun when it is this close to firing */
const KITE_PAUSE = 0.15;
const ENGAGE_SHARE = 0.999; // halt once ALL weapons that can hit the goal are in range (no reason to close further unless melee/charge)

// spatial hash
const THREAT_MEMORY = 6 * TICK_RATE; // ticks a recorded attacker stays 'the threat'
const CELL = 3;
const HCOLS = Math.ceil(FIELD_W / CELL);
const HROWS = Math.ceil(FIELD_H / CELL);
const SAT_N = (HCOLS + 1) * (HROWS + 1);
/** Centre-to-farthest-point radius of a hull's shape: the circle of radius 0.45 * side for square footprints, else the
 *  oriented 0.45 * fw x 0.45 * fh box that range / edge checks measure to, whose corners reach past 0.45 * longest side. */
const boundOf = (fw: number, fh: number) => (fw === fh ? 0.45 * fw : 0.45 * Math.hypot(fw, fh));
/** bounding radius of the largest hull (the 8x7 citadel's box corners reach 4.78, the 10x10 weaver titan 4.5), at least 4 */
const MAX_RADIUS = CHASSIS.reduce((m, c) => Math.max(m, boundOf(c.footprint?.[0] ?? c.size, c.footprint?.[1] ?? c.size)), 4.0);

const TAU = Math.PI * 2;
function angDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}
/** Turret slew: always the short way round, but once swinging hard it keeps its direction while the target is near
 *  dead astern (~180°), where the "short way" flips sign tick to tick and would make the barrel reverse mid-swing. */
function slewTurret(w: { turnDir: number }, a: number, b: number, max: number): number {
  let d = angDiff(a, b);
  if (w.turnDir !== 0 && Math.abs(d) > Math.PI - 0.35 && Math.sign(d) !== w.turnDir) d += w.turnDir * TAU;
  if (d > max) { w.turnDir = 1; return a + max; }
  if (d < -max) { w.turnDir = -1; return a - max; }
  w.turnDir = 0;
  return b;
}
/** pre-aim reach: turrets with nothing in range track the nearest enemy out to this multiple of their range */
const PREAIM_MULT = 1.5;
function turnToward(a: number, b: number, max: number): number {
  const d = angDiff(a, b);
  if (d > max) return a + max;
  if (d < -max) return a - max;
  return b;
}
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** Exactly `Math.hypot(dx, dy) > r`, but only pays for the (slow) hypot call when the squared distance is within
 *  rounding of r^2; anything clearly inside or outside is decided by the cheap comparison. */
const hypotGt = (dx: number, dy: number, r: number): boolean => {
  const d2 = dx * dx + dy * dy, r2 = r * r;
  if (d2 > r2 * (1 + 1e-9) + 1e-300) return true;
  if (d2 < r2 * (1 - 1e-9)) return false;
  return Math.hypot(dx, dy) > r;
};

interface Wpn {
  def: ModuleDef;
  /** turret traverse rad/s */
  traverse: number;
  heal: number;
  range: number;
  minRange: number;
  hitG: boolean;
  hitA: boolean;
  burstLeft: number;
  burstTimer: number;
  retarget: number;
  aimX: number;
  aimY: number;
  healAcc: number;
  healTimer: number;
  spread: number;
  dps: number;
  melee: boolean;
  cls: number;
  /** nothing in range: enemy (SimUnit.id) within PREAIM_MULT x range the turret swings toward without firing, or -1 */
  preaim: number;
  /** direction (+1/-1) of the last full-speed swing; keeps a turret committed when the target sits ~180° away */
  turnDir: number;
  /** launcher battery (rocket racks, missile pods with 4+ tubes): the whole burst leaves at once as a salvo */
  salvo: boolean;
  /** random rotation of the current salvo's impact pattern */
  salvoRot: number;
  /** tick before which the overkill check is not repeated (no other target was found) */
  okHold: number;
  /** [mount origins] hull-local mount offset (cells, +x = forward, +y = right; same point the art draws the turret
   *  at, see shared/mountgeo.ts). Ranges, aim and shot origins are measured from here. 0,0 for melee (reach stays
   *  measured from the hull edge). */
  ox: number;
  oy: number;
  /** [mount origins] muzzle reach from the mount centre along the barrel (cells, ~half the turret diameter) */
  muz: number;
}

interface Internal {
  u: SimUnit;
  wpns: (Wpn | null)[];
  /** circle radius used for steering / separation broad-phase (0.45 * sqrt(fw*fh); 0.45 * size for squares) */
  radius: number;
  /** non-square footprint: contact / edge-range use the oriented box */
  elong: boolean;
  /** half extents of the oriented box: hl along facing, hw across */
  hl: number;
  hw: number;
  /** capsule used for separation: radius capR around a segment of half-length capS (along facing, or across when capAcross) */
  capR: number;
  capS: number;
  capAcross: boolean;
  /** bounding radius (centre to farthest point of the footprint box; see boundOf) -- every centre-distance pre-filter
   *  in front of an edge / box check relies on it */
  bound: number;
  mass: number;
  dmgMult: number;
  speed: number;
  turn: number;
  fireOnMove: boolean;
  strafe: boolean;
  evasive: boolean;
  canLeap: boolean;
  crush: boolean;
  aura: boolean;
  isStatic: boolean;
  hasWeapon: boolean;
  hasHeal: boolean;
  canHitG: boolean;
  canHitA: boolean;
  maxRange: number;
  minWeaponRange: number;
  goal: number;
  goalTimer: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  sinceDamage: number;
  leapCd: number;
  leapT: number;
  lx0: number;
  ly0: number;
  lx1: number;
  ly1: number;
  strafeT: number;
  crushCd: number;
  burnDps: number;
  /** accumulated slow / disarm damage (see SLOW_PER, DISARM_PER_S); u.slow / u.disarm are derived from them */
  slowDmg: number;
  disarmDmg: number;
  burnSide: Side;
  /** SimUnit.id that set the unit alight (damage tally) */
  burnSrc: number;
  burnModule: string;
  burnTick: number;
  /** pending knockback displacement (cells), applied over a few ticks */
  kbx: number;
  kby: number;
  // ---- utilities ----
  cloak: 'stealth' | 'phantom' | null;
  detect: number;
  sinceFire: number;
  domeR: number;
  domeAmt: number;
  regen: number;
  fireRate: number;
  reloadMult: number;
  uplinkR: number;
  uplinkBonus: number;
  /** current fire-rate bonus received from allied uplinks */
  rateAura: number;
  pdRange: number;
  pdCooldown: number;
  pdCd: number;
  pdModule: string;
  jammer: number;
  /** inside an allied jammer's radius */
  jammed: boolean;
  smokeR: number;
  smokeDur: number;
  smokeUsed: boolean;
  /** inside an active smoke cloud */
  smoked: boolean;
  energyResist: number;
  hardened: boolean;
  blastDmg: number;
  blastR: number;
  blastModule: string;
  /** no weapons and no healing: advances as a blocker */
  blocker: boolean;
  /** every weapon is melee: charge into contact */
  meleeOnly: boolean;
  prio: TargetPriority;
  hold: boolean;
  kite: boolean;
  /** mount index of the weapon the kiting distances are measured from (-1: none) */
  kiteMi: number;
  focus: boolean;
  stance: Stance;
  /** movement is gated until this tick */
  delayTicks: number;
  retreatOn: boolean;
  /** currently falling back (hp < 30% until hp > 70%) */
  retreating: boolean;
  /** flank: swing is over, fight normally */
  flankDone: boolean;
  /** escorted block index or -1 */
  escortBlock: number;
  escUnit: number;
  escThreat: number;
  /** support module/trait present (heal, dome, uplink, jammer, sensor, repair aura) */
  isSupport: boolean;
  /** unitCost x level multiplier (target 'valuable') */
  valueVal: number;
  /** size-major, cost-minor key (target 'swarm': smallest first) */
  swarmKey: number;
  /** index of the placement (block) this unit belongs to */
  block: number;
  /** deployed offset from the block centroid (world cells) */
  offx: number;
  offy: number;
  /** minimum squadmate separation while holding formation */
  sepMin: number;
  /** target-selection value: damage output incl. level */
  dpsVal: number;
  mainW: Wpn | null;
  avoidSide: number;
  avoidT: number;
  stuckT: number;
  /** [mount origins] cos/sin of the hull angle, recomputed only when u.angle changes (see mountAt) */
  trigA: number;
  cosA: number;
  sinA: number;
}

interface Smoke {
  x: number;
  y: number;
  r: number;
  t: number;
}

/** A ranged (non-melee, armed) weapon a kiting unit can measure its distance from. */
const kiteable = (w: Wpn | null): w is Wpn => !!w && w.heal <= 0 && !w.melee && w.range > 0 && (w.hitG || w.hitA);

/** Mount a kiting unit keeps its distance from: the chosen mount's ranged weapon, else the longest-ranged one. */
function kiteMountOf(wpns: (Wpn | null)[], mount: number): number {
  if (Number.isInteger(mount) && mount >= 0 && kiteable(wpns[mount] ?? null)) return mount;
  let best = -1;
  for (let i = 0; i < wpns.length; i++) if (kiteable(wpns[i]) && (best < 0 || wpns[i]!.range > wpns[best]!.range)) best = i;
  return best;
}

/** Damage class of a weapon for reactive armor / energy resist. */
function damageClass(def: ModuleDef): number {
  const k = def.projectile;
  if (k === 'shell' || k === 'rocket' || k === 'missile' || k === 'arc') return CLS_EXPLOSIVE;
  if (k === 'orb') return def.category === 'energy' ? CLS_ENERGY | CLS_EXPLOSIVE : CLS_EXPLOSIVE;
  if (k === 'beam' || k === 'lightning' || k === 'rail' || k === 'flame') return CLS_ENERGY;
  return 0;
}

interface Proj extends SimProjectile {
  /** SimUnit.id of the shooter */
  src: number;
  /** starting altitude of a bomb dropped from a flyer (falls to 0 over the flight) */
  z0: number;
  vx: number;
  vy: number;
  speed: number;
  dmg: number;
  ap: number;
  splash: number;
  airBonus: number;
  air: boolean;
  target: number;
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  total: number;
  traveled: number;
  maxDist: number;
  ignore: number;
  arcH: number;
  dead: boolean;
  pierce: boolean;
  hits: number[];
  fx: ModuleDef | null;
  fxMult: number;
  cls: number;
  /** unit this round was fired at (-1: none) and the damage it is expected to deal there (overkill bookkeeping) */
  aimT: number;
  est: number;
}

export class Battle {
  readonly input: BattleInput;
  tick = 0;
  done = false;
  winner: 0 | 1 | -1 = -1;
  units: SimUnit[] = [];
  projectiles: SimProjectile[] = [];
  /** events produced by the most recent step() only */
  events: BattleEvent[] = [];

  private rng: Rng;
  private blockCount = 0;
  private blockAtk: number[] = [];
  private blockAtkT: number[] = [];
  private blockSide: Side[] = [];
  private blockUid: number[] = [];
  private blockEscortUid: number[] = [];
  private anchorX: Float64Array = new Float64Array(0);
  private anchorY: Float64Array = new Float64Array(0);
  private anchorN: Int32Array = new Int32Array(0);
  private anyHold = false;
  private blockUnits: number[][] = [];
  private healers: Internal[] = [];
  private focusMark: Int32Array = new Int32Array(0);
  /** expected damage of rounds in flight toward each unit (see Proj.est) */
  private incoming: Float64Array = new Float64Array(0);
  private focusStamp = 0;
  /** pickTarget scratch: valid candidates (unit index, score, distance) in scan order */
  private candJ: Int32Array = new Int32Array(0);
  private candS: Float64Array = new Float64Array(0);
  private candD: Float64Array = new Float64Array(0);
  private curSrc = -1;
  /** SimUnit.id credited with damage for the per-block tally (accounting only; never affects the fight) */
  private dmgSrc = -1;
  /** damage dealt to enemies per block, keyed side * 1e6 + placement uid */
  private blockDmg = new Map<number, number>();
  private ints: Internal[] = [];
  private projs: Proj[] = [];
  private nextProjId = 1;
  private damageDealt: [number, number] = [0, 0];
  private auraTimer = 0;
  /** last tick anything happened (see QUIET_END), the alive-hp total then, and the last tick a start delay runs to */
  private activeTick = 0;
  private hpSum = NaN;
  private maxDelay = 0;
  private head: Int32Array = new Int32Array(HCOLS * HROWS);
  /** highest unit index in each hash cell (chains are ascending), lets separate() skip cells with no j > i */
  private tail: Int32Array = new Int32Array(HCOLS * HROWS);
  /** the same hash split by side (cells of side s start at s * HCOLS * HROWS): one-sided scans skip the other army */
  private sideHead: Int32Array = new Int32Array(2 * HCOLS * HROWS);
  private sideNext: Int32Array = new Int32Array(0);
  /** does side s field any emplacement (the only enemies avoid() steers around)? */
  private staticOn: [boolean, boolean] = [false, false];
  private next: Int32Array = new Int32Array(0);
  private scratch: Int32Array = new Int32Array(0);
  /** ascending unit indexes alive at the last hash rebuild, per side (cheap enemy scans) */
  private liveIdx: [Int32Array, Int32Array] = [new Int32Array(0), new Int32Array(0)];
  private liveN: [number, number] = [0, 0];
  /** position + footprint-bound snapshot per unit index, valid while posSnapOk (positions are frozen during the
   *  goals + weapons phase); used only as a conservative range pre-filter in pickTarget */
  private snapX: Float64Array = new Float64Array(0);
  private snapY: Float64Array = new Float64Array(0);
  private snapB: Float64Array = new Float64Array(0);
  private posSnapOk = false;
  /** movement phase: snapX/snapY hold every unit's position except the one currently moving (synced after each move) */
  private posMoveOk = false;
  /** while posSnapOk / posMoveOk: an upper bound on how far (per axis) any unit has drifted from its hash position */
  private drift = 0;
  /** while posSnapOk: per side, summed-area table of live unit counts per hash cell (by snapshot position);
   *  side s, cell-corner (cx, cy) at s * SAT_N + cy * (HCOLS + 1) + cx */
  private sat: Int32Array = new Int32Array(2 * SAT_N);
  /** per unit: max(footprint bound, radius) -- separate()'s conservative contact reach */
  private sepQ: Float64Array = new Float64Array(0);
  private maxSepQ = 0;
  /** unit positions as of the last rebuildHash (what the hash cells were built from) */
  private hashX: Float64Array = new Float64Array(0);
  private hashY: Float64Array = new Float64Array(0);
  /** per unit hull radius (constant), for avoid()'s geometric pre-check */
  private radA: Float64Array = new Float64Array(0);
  private smokes: Smoke[] = [];
  private pendingBlasts: number[] = [];
  private hasCloak = false;
  private detectors: Internal[] = [];
  private domes: Internal[] = [];
  private uplinks: Internal[] = [];
  private jammers: Internal[] = [];
  private pds: Internal[] = [];

  constructor(input: BattleInput) {
    this.input = input;
    this.rng = makeRng(input.seed);
    const validCache = new Map<Design, boolean>();
    for (const s of [0, 1] as Side[]) {
      const sideIn = input.sides[s];
      const byId = new Map<string, Design>();
      for (const d of sideIn.designs) if (!byId.has(d.id)) byId.set(d.id, d);
      for (const p of sideIn.units) {
        const d = byId.get(p.designId);
        if (!d) continue;
        let ok = validCache.get(d);
        if (ok === undefined) {
          try { ok = isValidDesign(d); } catch { ok = false; }
          validCache.set(d, ok);
        }
        if (!ok) continue;
        const size = computeStats(d).size;
        const sp = normSpacing(size, p.spacing);
        const cs = placementUnitCenters(s, { x: p.x, y: p.y, spacing: sp, rot: p.rot }, size, computeStats(d));
        let mx = 0, my = 0;
        for (const c of cs) { mx += c.x; my += c.y; }
        mx /= cs.length; my /= cs.length;
        const block = this.blockCount++;
        this.blockUnits.push([]);
        this.blockSide.push(s);
        this.blockUid.push(p.uid);
        this.blockEscortUid.push(typeof p.escort === 'number' && p.escort !== p.uid ? p.escort : -1);
        const prio: TargetPriority = p.target && TARGET_PRIORITIES.includes(p.target) ? p.target : 'closest';
        const stance: Stance = p.stance && STANCES.includes(p.stance) ? p.stance : 'advance';
        const delay = p.delay !== undefined && (START_DELAYS as readonly number[]).includes(p.delay) ? p.delay : 0;
        // kite / focus left unset on the placement: the design's defaults (shared with client + AI)
        const defs = defaultOrders(d);
        for (const c of cs) {
          this.blockUnits[block].push(this.units.length);
          this.addUnit(s, p.uid, d, p.level, c.x, c.y, { block, prio, hold: !!p.hold && cs.length > 1, kite: typeof p.kite === 'boolean' ? p.kite : defs.kite, kiteMount: typeof p.kiteMount === 'number' ? p.kiteMount : -1, focus: typeof p.focus === 'boolean' ? p.focus : defs.focus, stance, delay, retreat: !!p.retreat, offx: c.x - mx, offy: c.y - my, sepMin: sp + 1 });
        }
      }
    }
    const n = this.units.length;
    this.blockAtk = new Array(this.blockCount).fill(-1);
    this.blockAtkT = new Array(this.blockCount).fill(-1e9);
    this.anchorX = new Float64Array(this.blockCount);
    this.anchorY = new Float64Array(this.blockCount);
    this.anchorN = new Int32Array(this.blockCount);
    // resolve escort targets (same side, by placement uid; not itself)
    const byUid: Map<number, number>[] = [new Map(), new Map()];
    for (let b = 0; b < this.blockCount; b++) if (!byUid[this.blockSide[b]].has(this.blockUid[b])) byUid[this.blockSide[b]].set(this.blockUid[b], b);
    for (const I of this.ints) {
      const b = I.block;
      const eu = this.blockEscortUid[b];
      const tb = eu >= 0 ? byUid[I.u.side].get(eu) : undefined;
      I.escortBlock = tb !== undefined && tb !== b ? tb : -1;
      if (I.hasHeal || I.aura) this.healers.push(I);
    }
    this.focusMark = new Int32Array(n);
    this.incoming = new Float64Array(n);
    this.candJ = new Int32Array(n); this.candS = new Float64Array(n); this.candD = new Float64Array(n);
    for (const I of this.ints) {
      if (I.cloak) this.hasCloak = true;
      if (I.detect > 0) this.detectors.push(I);
      if (I.domeAmt > 0) this.domes.push(I);
      if (I.uplinkBonus > 0) this.uplinks.push(I);
      if (I.jammer > 0) this.jammers.push(I);
      if (I.pdRange > 0) this.pds.push(I);
    }
    this.next = new Int32Array(n);
    this.sideNext = new Int32Array(n);
    this.liveIdx = [new Int32Array(n), new Int32Array(n)];
    for (const I of this.ints) if (I.isStatic) this.staticOn[I.u.side] = true;
    this.scratch = new Int32Array(Math.max(16, n));
    this.snapX = new Float64Array(n); this.snapY = new Float64Array(n); this.snapB = new Float64Array(n);
    this.sepQ = new Float64Array(n);
    this.hashX = new Float64Array(n); this.hashY = new Float64Array(n);
    this.radA = new Float64Array(n);
    for (let i = 0; i < n; i++) this.radA[i] = this.ints[i].radius;
    for (let i = 0; i < n; i++) {
      this.snapB[i] = this.ints[i].bound;
      this.sepQ[i] = Math.max(this.ints[i].bound, this.ints[i].radius);
      this.maxSepQ = Math.max(this.maxSepQ, this.sepQ[i]);
    }
    this.rebuildHash();
  }

  private addUnit(side: Side, uid: number, design: Design, level: number, cx: number, cy: number, cfg: { block: number; prio: TargetPriority; hold: boolean; kite: boolean; kiteMount: number; focus: boolean; stance: Stance; delay: number; retreat: boolean; offx: number; offy: number; sepMin: number }): void {
    const stats = computeStats(design);
    const lm = levelMult(level);
    const c = { x: cx, y: cy };
    const heading = forwardY(side) < 0 ? -Math.PI / 2 : Math.PI / 2;
    const id = this.units.length;
    const traits = stats.traits;
    const mounts: MountState[] = [];
    const wpns: (Wpn | null)[] = [];
    let canHitG = false, canHitA = false, maxRange = 0, minWeaponRange = Infinity, hasWeapon = false, hasHeal = false;
    // [mount origins] rest-pose mount offsets (identical to the render layout) + hull size for the muzzle reach
    const offs = mountOffsets(design);
    const hullS = (CHASSIS_BY_ID.get(design.chassis) ?? CHASSIS_BY_ID.get('scout')!).size;
        for (const mid of design.mounts) {
      const def = mid ? MODULE_BY_ID.get(mid) ?? null : null;
      mounts.push({ moduleId: mid ?? null, angle: heading, cooldown: 0, flash: 0, target: -1 });
      if (!def || (def.kind === 'armor') || (def.kind === 'utility' && !def.heal)) { wpns.push(null); continue; }
      const isWeapon = def.kind === 'weapon';
      const melee = def.projectile === 'melee';
      const range = (def.range ?? 0) * (melee ? 1 : stats.rangeMult);
      const w: Wpn = {
        def, heal: def.heal ?? 0, range, minRange: def.minRange ?? 0,
        hitG: isWeapon && !!def.targetsGround, hitA: isWeapon && !!def.targetsAir,
        burstLeft: 0, burstTimer: 0, retarget: (id * 0.037) % RETARGET_EVERY, aimX: 0, aimY: 0, healAcc: 0, healTimer: 0, preaim: -1, turnDir: 0,
        salvo: isWeapon && (def.burst ?? 1) > 1 && (def.projectile === 'rocket' || (def.projectile === 'missile' && (def.burst ?? 1) >= 4)),
        salvoRot: 0, okHold: 0,
        spread: (def.spread ?? 0) * (stats.spreadMult ?? 1),
        traverse: turretTurnRate(def),
        dps: isWeapon ? Math.max(1e-3, weaponDps(def)) : 0,
        melee, cls: damageClass(def),
        ox: melee ? 0 : offs[mounts.length - 1]?.x ?? 0, oy: melee ? 0 : offs[mounts.length - 1]?.y ?? 0,
        muz: melee ? 0 : 0.5 * approxTurretD(def.mount, hullS),
      };
      if (isWeapon) {
        hasWeapon = true;
        canHitG ||= w.hitG;
        canHitA ||= w.hitA;
        maxRange = Math.max(maxRange, range);
        minWeaponRange = Math.min(minWeaponRange, range);
        const ms = mounts[mounts.length - 1];
        ms.cooldown = this.rng() * (def.cooldown ?? 1) * 0.5;
        if (def.magazine && def.magazine > 0) { ms.ammo = def.magazine; ms.reloading = false; }
      } else hasHeal = true;
      wpns.push(w);
    }
    if (!Number.isFinite(minWeaponRange)) minWeaponRange = 3;
    let cloak: 'stealth' | 'phantom' | null = null, detect = 0, domeR = 0, domeAmt = 0, regen = 0, fireRate = 1, reloadBonus = 0;
    let uplinkR = 0, uplinkBonus = 0, pdRange = 0, pdCooldown = 0, pdModule = '', jammer = 0, smokeR = 0, smokeDur = 0;
    let isSupport = traits.includes('repairAura') || hasHeal;
    let reactive = 0, energyResist = 0, hardened = traits.includes('hardened'), blastDmg = 0, blastR = 0, blastModule = '';
    for (const mid of design.mounts) {
      const d = mid ? MODULE_BY_ID.get(mid) : undefined;
      if (!d) continue;
      if (d.cloak && cloak !== 'phantom') cloak = d.cloak;
      if (d.detect) detect = Math.max(detect, d.detect);
      if (d.shieldAura) { domeR = Math.max(domeR, d.shieldAura.radius); domeAmt = Math.max(domeAmt, d.shieldAura.amount); }
      regen += d.regen ?? 0;
      fireRate += d.fireRateBonus ?? 0;
      reloadBonus += d.reloadBonus ?? 0;
      if (d.fireRateAura && d.fireRateAura.bonus > uplinkBonus) { uplinkBonus = d.fireRateAura.bonus; uplinkR = d.fireRateAura.radius; }
      if (d.pointDefense && d.pointDefense.range > pdRange) { pdRange = d.pointDefense.range; pdCooldown = d.pointDefense.cooldown; pdModule = d.id; }
      if (d.jammer) jammer = Math.max(jammer, d.jammer);
      if (d.smoke) { smokeR = Math.max(smokeR, d.smoke.radius); smokeDur = Math.max(smokeDur, d.smoke.duration); }
      reactive += d.reactive ?? 0;
      energyResist += d.energyResist ?? 0;
      if (d.hardened) hardened = true;
      if (d.heal || d.shieldAura || d.fireRateAura || d.jammer || d.detect) isSupport = true;
      if (d.deathBlast) { blastDmg += d.deathBlast.damage; blastR = Math.max(blastR, d.deathBlast.radius); blastModule = d.id; }
    }
    const maxHp = stats.hp * lm;
    const u: SimUnit = {
      id, side, uid, design, stats, level, x: c.x, y: c.y, angle: heading, hp: maxHp, maxHp,
      shield: stats.shield, maxShield: stats.shield, alive: true, flying: stats.flying, moving: false,
      odometer: 0, leap: 0, mounts, hitFlash: 0, stun: 0, para: 0, slow: 0, burning: 0, disarm: 0,
      cloaked: cloak !== null, reactive, auraShield: 0, maxAuraShield: 0,
    };
    this.units.push(u);
    this.ints.push({
      u, wpns, radius: 0.45 * Math.sqrt(stats.fw * stats.fh), elong: stats.fw !== stats.fh,
      hl: 0.45 * stats.fh, hw: 0.45 * stats.fw, capR: 0.45 * Math.min(stats.fw, stats.fh), capS: 0.45 * Math.abs(stats.fh - stats.fw),
      capAcross: stats.fw > stats.fh, bound: boundOf(stats.fw, stats.fh), mass: stats.isStatic ? 1e6 : stats.size * stats.size * (cfg.stance === 'holdPos' ? HOLDPOS_MASS : 1), dmgMult: lm,
      speed: stats.speed, turn: stats.turn,
      fireOnMove: traits.includes('fireOnMove'), strafe: traits.includes('strafe'), evasive: traits.includes('evasive'),
      canLeap: traits.includes('leap'), crush: traits.includes('crush'), aura: traits.includes('repairAura'),
      isStatic: stats.isStatic, hasWeapon, hasHeal, canHitG, canHitA, maxRange, minWeaponRange,
      goal: -1, goalTimer: (id * 0.053) % GOAL_EVERY, px: c.x, py: c.y, vx: 0, vy: 0, sinceDamage: 99,
      leapCd: 1 + this.rng() * 2, leapT: -1, lx0: 0, ly0: 0, lx1: 0, ly1: 0, strafeT: 0, crushCd: 0,
      burnDps: 0, slowDmg: 0, disarmDmg: 0, burnSide: side, burnSrc: -1, burnModule: '', burnTick: 0, kbx: 0, kby: 0,
      cloak, detect, sinceFire: 99, domeR, domeAmt, regen, fireRate, reloadMult: Math.max(0.2, 1 - reloadBonus),
      uplinkR, uplinkBonus, rateAura: 0, pdRange, pdCooldown, pdCd: 0, pdModule, jammer, jammed: false,
      smokeR, smokeDur, smokeUsed: false, smoked: false, energyResist: Math.min(0.8, energyResist), hardened,
      blastDmg: blastDmg * lm, blastR, blastModule, blocker: !hasWeapon && !hasHeal,
      meleeOnly: hasWeapon && wpns.every((w) => !w || w.heal > 0 || w.melee), avoidSide: 0, avoidT: 0, stuckT: 0, trigA: NaN, cosA: 1, sinA: 0,
      prio: cfg.prio, hold: cfg.hold, kite: cfg.kite && !stats.isStatic, kiteMi: kiteMountOf(wpns, cfg.kiteMount), focus: cfg.focus, stance: cfg.stance,
      delayTicks: Math.round(cfg.delay * TICK_RATE), retreatOn: cfg.retreat && !stats.isStatic, retreating: false, flankDone: false,
      escortBlock: -1, escUnit: -1, escThreat: -1, isSupport, valueVal: stats.unitCost * lm, swarmKey: stats.size * 1e5 + stats.unitCost,
      block: cfg.block, offx: cfg.offx, offy: cfg.offy, sepMin: cfg.sepMin,
      dpsVal: stats.dps * lm, mainW: wpns.reduce<Wpn | null>((b, w) => (w && w.heal <= 0 && w.range > 0 && (!b || w.range > b.range) ? w : b), null),
    });
    if (cfg.hold) this.anyHold = true;
    this.maxDelay = Math.max(this.maxDelay, Math.round(cfg.delay * TICK_RATE));
  }

  /** Advance one tick (DT seconds). No-op once done. */
  step(): void {
    if (this.done) return;
    this.events = [];
    const ints = this.ints;
    const n = ints.length;

    // timers, decay, shields
    for (let i = 0; i < n; i++) {
      const I = ints[i];
      const u = I.u;
      if (!u.alive) continue;
      u.hitFlash = Math.max(0, u.hitFlash - DT * 4);
      I.sinceDamage += DT;
      I.sinceFire += DT;
      if (I.sinceDamage > SHIELD_DELAY) {
        if (u.shield < u.maxShield) u.shield = Math.min(u.maxShield, u.shield + u.maxShield * SHIELD_REGEN * DT);
        if (u.auraShield < u.maxAuraShield) u.auraShield = Math.min(u.maxAuraShield, u.auraShield + u.maxAuraShield * SHIELD_REGEN * DT);
      }
      if (I.regen > 0 && I.sinceDamage > REGEN_DELAY && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * I.regen * DT);
      if (I.leapCd > 0) I.leapCd -= DT;
      if (I.crushCd > 0) I.crushCd -= DT;
      if (u.para > 0) {
        const rate = u.maxHp * PARA_DECAY;
        u.para = Math.max(0, u.para - rate * DT);
        u.stun = u.para > u.maxHp ? (u.para - u.maxHp) / rate : 0;
      } else if (u.stun > 0) u.stun = 0;
      if (I.disarmDmg > 0) {
        const rate = u.maxHp * PARA_DECAY;
        I.disarmDmg = Math.max(0, I.disarmDmg - rate * DT);
        u.disarm = I.disarmDmg > u.maxHp ? (I.disarmDmg - u.maxHp) / rate : 0;
      } else if (u.disarm > 0) u.disarm = 0;
      if (I.slowDmg > 0) {
        I.slowDmg = Math.max(0, I.slowDmg - u.maxHp * SLOW_DMG_DECAY * DT);
        u.slow = MAX_SLOW * Math.min(1, I.slowDmg / u.maxHp);
      } else if (u.slow > 0) u.slow = 0;
      if (u.burning > 0) {
        I.burnTick += DT;
        if (I.burnTick >= BURN_EVERY || u.burning <= DT) {
          const dmg = I.burnDps * I.burnTick;
          I.burnTick = 0;
          this.dmgSrc = I.burnSrc;
          this.damage(u, dmg, 1, 1, I.burnSide, I.burnModule, u.x, u.y);
          this.dmgSrc = -1;
        }
        u.burning = Math.max(0, u.burning - DT);
        if (!u.alive) continue;
      }
      I.px = u.x;
      I.py = u.y;
    }

    this.updateVisibility();

    // goals + weapons (no unit moves until the movement phase: snapshot positions for the target-scan pre-filter)
    const snapX = this.snapX, snapY = this.snapY;
    const hashX = this.hashX, hashY = this.hashY;
    let drift = 0;
    for (let i = 0; i < n; i++) {
      const u = ints[i].u;
      snapX[i] = u.x; snapY[i] = u.y;
      drift = Math.max(drift, Math.abs(u.x - hashX[i]), Math.abs(u.y - hashY[i]));
    }
    this.drift = drift;
    this.buildSat();
    this.posSnapOk = true;
    for (let i = 0; i < n; i++) {
      const I = ints[i];
      if (!I.u.alive) continue;
      I.goalTimer -= DT;
      if (I.goalTimer <= 0 || I.goal < 0 || !this.units[I.goal].alive || (I.escortBlock >= 0 && I.escUnit >= 0 && !this.units[I.escUnit].alive)) {
        I.goalTimer = GOAL_EVERY;
        I.goal = this.findGoal(I);
        if (I.escortBlock >= 0) this.refreshEscort(I);
        if ((I.prio !== 'closest' || I.focus) && I.mainW && !I.blocker && I.goal >= 0) {
          const pt = this.pickTarget(I, I.mainW, 1.5);
          if (pt >= 0) I.goal = pt;
        }
      }
      this.updateWeapons(I);
    }
    this.posSnapOk = false;

    // movement
    if (this.anyHold) this.computeAnchors();
    this.posMoveOk = true;
    for (let i = 0; i < n; i++) {
      const I = ints[i];
      if (I.u.alive) {
        this.move(I);
        const u = I.u;
        snapX[i] = u.x; snapY[i] = u.y;
        this.drift = Math.max(this.drift, Math.abs(u.x - hashX[i]), Math.abs(u.y - hashY[i]));
      }
    }
    this.posMoveOk = false;

    this.rebuildHash();
    this.separate();

    // repair / support auras
    this.auraTimer -= DT;
    if (this.auraTimer <= 0) {
      this.auraTimer = AURA_EVERY;
      for (let i = 0; i < n; i++) if (ints[i].aura && ints[i].u.alive) this.applyAura(ints[i]);
      this.supportAuras();
    }

    if (this.pds.length) this.pointDefense();
    this.updateProjectiles();
    this.dmgSrc = -1;
    this.flushBlasts();

    // bookkeeping
    let active = this.events.length > 0 || this.projs.length > 0 || this.smokes.length > 0 || this.tick <= this.maxDelay;
    let hpSum = 0;
    for (let i = 0; i < n; i++) {
      const I = ints[i];
      const u = I.u;
      if (!u.alive) { u.moving = false; continue; }
      const dx = u.x - I.px, dy = u.y - I.py;
      const d = Math.sqrt(dx * dx + dy * dy);
      I.vx = dx / DT;
      I.vy = dy / DT;
      u.moving = d > 0.002;
      u.odometer += d;
      if (u.moving) active = true;
      // a gun holding a live target fires again once its cooldown runs out (a 20 s nuke reload is not a stalemate)
      if (!active) for (let mi = 0; mi < I.wpns.length; mi++) {
        const w = I.wpns[mi], tg = u.mounts[mi].target;
        if (w && w.heal <= 0 && tg >= 0 && this.units[tg].alive) { active = true; break; }
      }
      hpSum += u.hp;
    }
    if (hpSum !== this.hpSum) { this.hpSum = hpSum; active = true; }
    if (active) this.activeTick = this.tick;

    this.tick++;
    this.checkEnd();
  }

  // ---------------------------------------------------------------- visibility + support systems

  /** Smoke clouds tick down; cloaked units are revealed by proximity, recent fire or detectors. */
  private updateVisibility(): void {
    const units = this.units, ints = this.ints;
    if (this.smokes.length) {
      let wi = 0;
      for (const c of this.smokes) { c.t -= DT; if (c.t > 0) this.smokes[wi++] = c; }
      this.smokes.length = wi;
      for (let i = 0; i < ints.length; i++) {
        const u = units[i];
        let inside = false;
        if (u.alive) for (const c of this.smokes) { const dx = u.x - c.x, dy = u.y - c.y; if (dx * dx + dy * dy <= c.r * c.r) { inside = true; break; } }
        ints[i].smoked = inside;
      }
    } else {
      for (let i = 0; i < ints.length; i++) ints[i].smoked = false;
    }
    if (!this.hasCloak) return;
    for (let i = 0; i < ints.length; i++) {
      const I = ints[i];
      const u = I.u;
      if (!I.cloak || !u.alive) continue;
      let visible = I.sinceFire < (I.cloak === 'phantom' ? PHANTOM_FIRE_REVEAL : STEALTH_FIRE_REVEAL);
      if (!visible) {
        for (const D of this.detectors) {
          const o = D.u;
          if (!o.alive || o.side === u.side) continue;
          // [aura balance] sensor reach is measured edge to edge (sensor hull to cloaked hull)
          const dx = o.x - u.x, dy = o.y - u.y, r = D.detect + I.bound + D.bound;
          if (dx * dx + dy * dy <= r * r && this.gap(D, I) <= D.detect) { visible = true; break; }
        }
      }
      if (!visible && I.cloak === 'stealth') {
        const cnt = this.gather(u.x, u.y, CLOAK_REVEAL + I.bound + MAX_RADIUS);
        for (let q = 0; q < cnt; q++) {
          const j = this.scratch[q];
          const o = units[j];
          if (!o.alive || o.side === u.side) continue;
          if (this.gap(I, ints[j]) <= CLOAK_REVEAL) { visible = true; break; }
        }
      }
      u.cloaked = !visible;
    }
  }

  /** Can `shooter` see (target) `t`? Cloak and smoke. */
  private visible(shooter: SimUnit, t: SimUnit): boolean {
    if (t.cloaked) return false;
    if (this.ints[t.id].smoked) {
      const dx = t.x - shooter.x, dy = t.y - shooter.y;
      if (dx * dx + dy * dy > SMOKE_SIGHT * SMOKE_SIGHT) return false;
    }
    return true;
  }

  /** Shield domes, command uplinks and jammers (refreshed every AURA_EVERY). [aura balance] Radii are measured edge to
   *  edge (carrier footprint to ally footprint) and nothing stacks: each ally keeps the single strongest source. */
  private supportAuras(): void {
    const units = this.units, ints = this.ints;
    const first = this.tick === 0;
    for (const I of ints) { I.rateAura = 0; I.jammed = false; if (this.domes.length) I.u.maxAuraShield = 0; }
    for (const D of this.domes) {
      const d = D.u;
      if (!d.alive) continue;
      const cnt = this.gather(d.x, d.y, D.domeR + D.bound + MAX_RADIUS);
      for (let q = 0; q < cnt; q++) {
        const j = this.scratch[q];
        const o = units[j];
        if (!o.alive || o.side !== d.side || o === d) continue;
        const amt = Math.min(D.domeAmt, o.maxHp * AURA_SHIELD_HP); // [aura balance] at most half the ally's hp
        if (o.maxAuraShield < amt && this.gap(D, ints[j]) <= D.domeR) o.maxAuraShield = amt;
      }
    }
    if (this.domes.length) for (const I of ints) {
      const u = I.u;
      if (first) u.auraShield = u.maxAuraShield;
      if (u.auraShield > u.maxAuraShield) u.auraShield = u.maxAuraShield;
    }
    for (const L of this.uplinks) {
      const l = L.u;
      if (!l.alive) continue;
      const cnt = this.gather(l.x, l.y, L.uplinkR + L.bound + MAX_RADIUS);
      for (let q = 0; q < cnt; q++) {
        const j = this.scratch[q];
        const o = units[j];
        if (!o.alive || o.side !== l.side || o === l || ints[j].rateAura >= L.uplinkBonus) continue;
        if (this.gap(L, ints[j]) <= L.uplinkR) ints[j].rateAura = L.uplinkBonus;
      }
    }
    for (const J of this.jammers) {
      const jm = J.u;
      if (!jm.alive) continue;
      const cnt = this.gather(jm.x, jm.y, J.jammer + J.bound + MAX_RADIUS);
      for (let q = 0; q < cnt; q++) {
        const j = this.scratch[q];
        const o = units[j];
        if (!o.alive || o.side !== jm.side || ints[j].jammed) continue;
        if (o === jm || this.gap(J, ints[j]) <= J.jammer) ints[j].jammed = true;
      }
    }
  }

  /** Point-defense lasers shoot down one incoming explosive projectile per cooldown. */
  private pointDefense(): void {
    for (const I of this.pds) {
      const u = I.u;
      if (!u.alive) continue;
      if (I.pdCd > 0) I.pdCd -= DT;
      if (I.pdCd > 0 || u.stun > 0 || u.disarm > 0) continue;
      // [aura balance] reach is measured from the hull edge, so a titan's PD covers more than its own hull
      let best: Proj | null = null, bestD = I.pdRange;
      const lim = I.pdRange + I.bound, lim2 = lim * lim;
      for (const p of this.projs) {
        if (p.dead || p.side === u.side) continue;
        if (!this.interceptable(p.kind)) continue;
        const dx = p.x - u.x, dy = p.y - u.y;
        if (dx * dx + dy * dy > lim2) continue;
        const d = this.edgeC(I, p.x, p.y);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (!best) continue;
      best.dead = true;
      I.pdCd = I.pdCooldown;
      this.events.push({ t: 'beam', moduleId: I.pdModule, x1: u.x, y1: u.y, x2: best.x, y2: best.y, side: u.side });
      this.events.push({ t: 'explode', x: best.x, y: best.y, radius: 0.3, moduleId: I.pdModule });
    }
  }

  private flushBlasts(): void {
    const pb = this.pendingBlasts;
    for (let k = 0; k < pb.length; k++) {
      const I = this.ints[pb[k]];
      const u = I.u;
      this.dmgSrc = u.id;
      this.splash(u.x, u.y, I.blastR + I.radius, I.blastDmg, 0.3, 1, u.side, false, I.blastModule, -1, true); // [aura balance] radius beyond the hull
      this.dmgSrc = -1;
    }
    pb.length = 0;
  }

  // ---------------------------------------------------------------- targeting

  private canHit(w: Wpn, t: SimUnit): boolean {
    return t.flying ? w.hitA : w.hitG;
  }

  /** Movement goal: nearest enemy this unit can attack (support units: nearest armed ally). */
  private findGoal(I: Internal): number {
    const u = I.u;
    const units = this.units;
    let best = -1, bestD = Infinity;
    if (I.blocker) {
      // pure walls: head for the nearest visible ground enemy (else any) to body-block it
      let bestA = -1, bestAD = Infinity;
      for (let j = 0; j < units.length; j++) {
        const o = units[j];
        if (!o.alive || o.side === u.side || !this.visible(u, o)) continue;
        const dx = o.x - u.x, dy = o.y - u.y, d = dx * dx + dy * dy;
        if (o.flying) { if (d < bestAD) { bestAD = d; bestA = j; } }
        else if (d < bestD) { bestD = d; best = j; }
      }
      return best >= 0 ? best : bestA;
    }
    if (!I.hasWeapon) {
      for (let j = 0; j < units.length; j++) {
        const o = units[j];
        if (!o.alive || o.side !== u.side || o === u || !this.ints[j].hasWeapon) continue;
        const dx = o.x - u.x, dy = o.y - u.y, d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = j; }
      }
      return best;
    }
    const foes = this.liveIdx[u.side === 0 ? 1 : 0], nf = this.liveN[u.side === 0 ? 1 : 0];
    const snap = this.posSnapOk, sx = this.snapX, sy = this.snapY;
    for (let k = 0; k < nf; k++) {
      const j = foes[k];
      // not nearer than the best so far: skip without touching the unit (snapshot = its current position)
      if (snap) { const dx = sx[j] - u.x, dy = sy[j] - u.y; if (!(dx * dx + dy * dy < bestD)) continue; }
      const o = units[j];
      if (!o.alive) continue;
      if (o.flying ? !I.canHitA : !I.canHitG) continue;
      const dx = o.x - u.x, dy = o.y - u.y, d = dx * dx + dy * dy;
      if (d < bestD && this.visible(u, o)) { bestD = d; best = j; }
    }
    return best;
  }

  /** distance from a world point to the nearest point of O's oriented footprint box (0 inside) */
  private boxDist(O: Internal, px: number, py: number): number {
    const o = O.u;
    const dx = px - o.x, dy = py - o.y, c = Math.cos(o.angle), sn = Math.sin(o.angle);
    const ex = Math.max(Math.abs(dx * c + dy * sn) - O.hl, 0), ey = Math.max(Math.abs(-dx * sn + dy * c) - O.hw, 0);
    return Math.sqrt(ex * ex + ey * ey);
  }

  /** how far an elongated unit's footprint reaches from its centre toward the direction (dx, dy) */
  private extToward(I: Internal, dx: number, dy: number): number {
    const phi = Math.atan2(dy, dx) - I.u.angle;
    return Math.abs(Math.cos(phi)) * I.hl + Math.abs(Math.sin(phi)) * I.hw;
  }

  /** distance from a world point to O's edge (negative inside a round footprint) */
  private edgeC(O: Internal, px: number, py: number): number {
    return O.elong ? this.boxDist(O, px, py) : Math.hypot(px - O.u.x, py - O.u.y) - O.radius;
  }

  /** edge-to-edge gap between two units (center distance minus both radii for square hulls) */
  private gap(I: Internal, O: Internal): number {
    if (!I.elong && !O.elong) return Math.hypot(O.u.x - I.u.x, O.u.y - I.u.y) - I.radius - O.radius;
    const ext = I.elong ? this.extToward(I, O.u.x - I.u.x, O.u.y - I.u.y) : I.radius;
    return this.edgeC(O, I.u.x, I.u.y) - ext;
  }

  // [mount origins] world position of a weapon's mount, written to mpx/mpy (no allocation). The hull angle's
  // cos/sin are cached on the unit and only recomputed when u.angle has changed since the last call.
  private mpx = 0;
  private mpy = 0;
  private mountAt(I: Internal, w: Wpn): void {
    const u = I.u;
    if (w.ox === 0 && w.oy === 0) { this.mpx = u.x; this.mpy = u.y; return; }
    if (I.trigA !== u.angle) { I.trigA = u.angle; I.cosA = Math.cos(u.angle); I.sinA = Math.sin(u.angle); }
    this.mpx = u.x + I.cosA * w.ox - I.sinA * w.oy;
    this.mpy = u.y + I.sinA * w.ox + I.cosA * w.oy;
  }

  private inRange(u: SimUnit, w: Wpn, t: SimUnit, mult: number): number {
    this.mountAt(this.ints[u.id], w);
    return this.inRangeFrom(this.mpx, this.mpy, u, w, t, mult);
  }

  /** [mount origins] range check measured from the weapon's mount point (px, py); returns the mount-to-target-centre
   *  distance, or -1 when out of range. Melee mounts sit at the unit centre (ox = oy = 0). */
  private inRangeFrom(px: number, py: number, u: SimUnit, w: Wpn, t: SimUnit, mult: number): number {
    const dx = t.x - px, dy = t.y - py;
    const T = this.ints[t.id], U = this.ints[u.id];
    const lim = w.range * mult + T.bound + (w.melee ? U.bound : 0);
    if (dx * dx + dy * dy > lim * lim) return -1;
    const d = Math.sqrt(dx * dx + dy * dy);
    // edge-to-edge: nearest point of the target's (oriented) footprint, minus our own reach toward it for melee
    let edge = T.elong ? this.boxDist(T, px, py) : d - T.radius;
    if (w.melee) edge -= U.elong ? this.extToward(U, dx, dy) : U.radius;
    if (edge > w.range * mult || d < w.minRange) return -1;
    return d;
  }

  private findTarget(u: SimUnit, w: Wpn): number {
    return this.pickTarget(this.ints[u.id], w, 1);
  }

  /** Choose among valid targets (right layer, visible, within w.range * mult) by the unit's priority. */
  private pickTarget(I: Internal, w: Wpn, mult: number): number {
    const u = I.u;
    const units = this.units;
    const prio = I.prio;
    // [mount origins] ranges are measured from this weapon's mount, computed once per call
    this.mountAt(I, w);
    const mx = this.mpx, my = this.mpy;
    if (prio === 'threat') {
      const a = this.blockAtk[I.block];
      if (a >= 0 && this.tick - this.blockAtkT[I.block] <= THREAT_MEMORY) {
        const o = units[a];
        if (o.alive && o.side !== u.side && !this.doomed(a) && this.canHit(w, o) && this.inRangeFrom(mx, my, u, w, o, mult) >= 0 && this.visible(u, o)) return a;
      }
    }
    let best = -1, bestS = Infinity, bestD = Infinity;
    let doomedBest = -1, doomedD = Infinity;
    // valid candidates in scan order, kept for the focus pass (most scans find none, so focus is only worked out
    // when there is something to choose between; nothing in the scan below depends on it)
    const focus = I.focus, candJ = this.candJ, candS = this.candS, candD = this.candD;
    let nc = 0;
    // short-range weapons only look at the spatial hash neighbourhood (hash is at most one step stale);
    // ties are broken by lowest index so the result does not depend on iteration order
    let src = this.liveIdx[u.side === 0 ? 1 : 0];
    let cnt = this.liveN[u.side === 0 ? 1 : 0];
    const reach = w.range * mult + MAX_RADIUS + (w.melee ? I.bound : 0) + 1.5;
    // conservative pre-filter (a hair looser than inRange's own bound check, same positions): skips far units
    // without touching their objects; everything that passes goes through the exact checks below
    // [mount origins] centred on the weapon's mount, like inRangeFrom
    const snap = this.posSnapOk, sx = this.snapX, sy = this.snapY, sb = this.snapB;
    const ux = mx, uy = my, limBase = w.range * mult + (w.melee ? I.bound : 0) + 1e-6;
    // most scans find nothing: no enemy anywhere in range's bounding box means no candidate (and no focus pass)
    if (snap) {
      const L = limBase + this.maxSepQ + 1e-6;
      if (!this.anyIn(u.side === 0 ? 1 : 0, ux - L, ux + L, uy - L, uy + L)) return -1;
    }
    if (reach <= 12) { cnt = this.gatherSideNear(u.side === 0 ? 1 : 0, mx, my, reach, limBase + this.maxSepQ); src = this.scratch; }
    for (let k = 0; k < cnt; k++) {
      const j = src[k];
      if (snap) {
        const dx = sx[j] - ux, dy = sy[j] - uy, lim = limBase + sb[j];
        if (dx * dx + dy * dy > lim * lim) continue;
      }
      const o = units[j];
      if (!o.alive || o.side === u.side || !this.canHit(w, o)) continue;
      const d = this.inRangeFrom(mx, my, u, w, o, mult);
      if (d < 0 || !this.visible(u, o)) continue;
      // already doomed by rounds in flight: only a fallback when nothing else is in reach
      if (this.doomed(j)) { if (doomedBest < 0 || d < doomedD) { doomedBest = j; doomedD = d; } continue; }
      const O = this.ints[j];
      let sc: number;
      switch (prio) {
        case 'farthest': sc = -d; break;
        case 'lowestHp': sc = o.hp; break;
        case 'highestHp': sc = -o.hp; break;
        case 'highestDps': sc = -O.dpsVal; break;
        case 'lowestDps': sc = O.dpsVal; break;
        case 'aircraft': sc = o.flying ? 0 : 1; break;
        case 'armored': sc = -o.stats.armor; break;
        case 'longestRange': sc = -o.stats.range; break;
        case 'support': sc = O.isSupport ? 0 : 1; break;
        case 'valuable': sc = -O.valueVal; break;
        case 'swarm': sc = O.swarmKey; break;
        default: sc = d;
      }
      if (sc < bestS - 1e-9 || (Math.abs(sc - bestS) <= 1e-9 && (d < bestD || (d === bestD && j < best)))) { bestS = sc; bestD = d; best = j; }
      if (focus) { candJ[nc] = j; candS[nc] = sc; candD[nc] = d; nc++; }
    }
    if (nc === 0) return best >= 0 ? best : doomedBest;
    // focus: enemies that allies nearby (and we ourselves) are already shooting are preferred
    const stamp = ++this.focusStamp;
    const fcnt = this.gatherSideNear(u.side, u.x, u.y, FOCUS_RADIUS + MAX_RADIUS, FOCUS_RADIUS);
    const fr2 = FOCUS_RADIUS * FOCUS_RADIUS * (1 + 1e-9);
    for (let q = 0; q < fcnt; q++) {
      const ai = this.scratch[q];
      // clearly outside the focus radius (exact hypot test below would reject it too): skip without touching it
      if (snap) { const dx = sx[ai] - u.x, dy = sy[ai] - u.y; if (dx * dx + dy * dy > fr2) continue; }
      const a = units[ai];
      if (!a.alive || a.side !== u.side) continue;
      if (a !== u && hypotGt(a.x - u.x, a.y - u.y, FOCUS_RADIUS)) continue;
      for (const m of a.mounts) if (m.target >= 0) this.focusMark[m.target] = stamp;
    }
    let fBest = -1, fS = Infinity, fD = Infinity;
    for (let c = 0; c < nc; c++) {
      const j = candJ[c], sc = candS[c], d = candD[c];
      if (this.focusMark[j] === stamp && (sc < fS - 1e-9 || (Math.abs(sc - fS) <= 1e-9 && (d < fD || (d === fD && j < fBest))))) { fS = sc; fD = d; fBest = j; }
    }
    return fBest >= 0 ? fBest : best;
  }

  /** Escort bookkeeping: nearest living unit of the escorted block, and the threat to engage near it. */
  private refreshEscort(I: Internal): void {
    const u = I.u, units = this.units;
    let e = -1, bd = Infinity;
    for (const j of this.blockUnits[I.escortBlock]) {
      const o = units[j];
      if (!o.alive) continue;
      const d = (o.x - u.x) * (o.x - u.x) + (o.y - u.y) * (o.y - u.y);
      if (d < bd) { bd = d; e = j; }
    }
    I.escUnit = e;
    I.escThreat = -1;
    if (e < 0 || !I.hasWeapon) return;
    const E = units[e];
    // the escorted unit's own target, if we can hit it
    for (const m of E.mounts) {
      if (m.target < 0) continue;
      const t = units[m.target];
      if (t.alive && t.side !== u.side && (t.flying ? I.canHitA : I.canHitG) && this.visible(u, t)) { I.escThreat = m.target; return; }
    }
    // else the nearest enemy to it
    let bt = -1, btd = ESCORT_THREAT * ESCORT_THREAT;
    for (let j = 0; j < units.length; j++) {
      const o = units[j];
      if (!o.alive || o.side === u.side || (o.flying ? !I.canHitA : !I.canHitG) || !this.visible(u, o)) continue;
      const d = (o.x - E.x) * (o.x - E.x) + (o.y - E.y) * (o.y - E.y);
      if (d < btd) { btd = d; bt = j; }
    }
    I.escThreat = bt;
  }

  /** Formation anchors for holding squads: mean of (position - deployed offset) over living members. */
  private computeAnchors(): void {
    this.anchorX.fill(0); this.anchorY.fill(0); this.anchorN.fill(0);
    for (let i = 0; i < this.ints.length; i++) {
      const I = this.ints[i];
      if (!I.hold || !I.u.alive) continue;
      this.anchorX[I.block] += I.u.x - I.offx;
      this.anchorY[I.block] += I.u.y - I.offy;
      this.anchorN[I.block]++;
    }
    for (let b = 0; b < this.blockCount; b++) if (this.anchorN[b] > 0) { this.anchorX[b] /= this.anchorN[b]; this.anchorY[b] /= this.anchorN[b]; }
  }

  private findHealTarget(u: SimUnit, w: Wpn): number {
    const units = this.units;
    let best = -1, bestR = 0.999;
    const lim = w.range + MAX_RADIUS, r2 = lim * lim; // [aura balance] heal reach is measured to the target's edge
    this.mountAt(this.ints[u.id], w); // [mount origins] heal range from the emitter's mount
    const mx = this.mpx, my = this.mpy;
    for (let j = 0; j < units.length; j++) {
      const o = units[j];
      if (!o.alive || o.side !== u.side || o === u) continue;
      const ratio = o.hp / o.maxHp;
      if (ratio >= bestR) continue;
      const dx = o.x - mx, dy = o.y - my;
      if (dx * dx + dy * dy > r2 || this.edgeC(this.ints[j], mx, my) > w.range) continue;
      bestR = ratio;
      best = j;
    }
    return best;
  }

  private updateWeapons(I: Internal): void {
    const u = I.u;
    const units = this.units;
    for (let mi = 0; mi < I.wpns.length; mi++) {
      const m = u.mounts[mi];
      if (m.flash > 0) m.flash = Math.max(0, m.flash - DT * 6);
      const w = I.wpns[mi];
      if (!w) continue;
      if (u.stun > 0) continue; // paralysed: no aiming, no firing, no reloading
      if (m.cooldown > -DT) m.cooldown -= DT * (1 - u.slow) * (I.fireRate + I.rateAura);
      if (m.reloading && m.cooldown <= 1e-9) { m.reloading = false; m.ammo = w.def.magazine; }

      if (w.heal > 0) {
        this.updateHeal(I, w, m);
        continue;
      }

      // validate held target
      let curD = -1;
      if (m.target >= 0) {
        const t = units[m.target];
        curD = t.alive && this.visible(u, t) ? this.inRange(u, w, t, RANGE_KEEP) : -1;
        if (curD < 0) { m.target = -1; w.retarget = 0; }
      }
      w.retarget -= DT;
      let refreshed = false;
      if (w.retarget <= 0) {
        w.retarget = RETARGET_EVERY;
        refreshed = true;
        const cand = this.findTarget(u, w);
        if (m.target < 0) m.target = cand;
        else if (cand >= 0 && cand !== m.target && (I.prio !== 'closest' || I.focus)) m.target = cand;
        else if (cand >= 0 && cand !== m.target) {
          const c = units[cand];
          this.mountAt(I, w); // [mount origins] same origin as curD
          const dc = Math.hypot(c.x - this.mpx, c.y - this.mpy);
          if (dc < curD * 0.6) m.target = cand;
        }
      }

      const t = m.target >= 0 ? units[m.target] : null;
      let want = u.angle;
      let ax = 0, ay = 0;
      // [mount origins] the turret aims from its own mount point
      this.mountAt(I, w);
      const mx = this.mpx, my = this.mpy;
      if (t) {
        w.preaim = -1;
        const p = this.aimPoint(I, w, t, mx, my);
        ax = p.x; ay = p.y;
        want = Math.atan2(ay - my, ax - mx);
      } else {
        // nothing in range: swing toward whatever is closing in (aim only, never fires)
        if (refreshed) w.preaim = this.pickTarget(I, w, PREAIM_MULT);
        const pa = w.preaim >= 0 ? units[w.preaim] : null;
        if (pa && pa.alive && this.visible(u, pa)) want = Math.atan2(pa.y - my, pa.x - mx);
        else w.preaim = -1;
      }
      m.angle = slewTurret(w, m.angle, want, w.traverse * DT);

      // burst continuation
      if (w.burstLeft > 0) {
        if (u.disarm > 0) { w.burstLeft = 0; continue; }
        w.burstTimer -= DT * (1 - u.slow) * (I.fireRate + I.rateAura);
        // follow-up rounds wait for the barrel too (a target that moves out of the arc pauses the burst)
        if (w.burstTimer <= 0 && (!t || Math.abs(angDiff(m.angle, want)) < AIM_TOLERANCE)) {
          w.burstLeft--;
          w.burstTimer = BURST_GAP;
          if (t) { w.aimX = ax; w.aimY = ay; }
          this.fire(I, mi, w, t, w.aimX, w.aimY);
        }
        continue;
      }
      if (t && m.cooldown <= 1e-9 && u.disarm <= 0 && Math.abs(angDiff(m.angle, want)) < AIM_TOLERANCE && I.leapT < 0) {
        // overkill: rounds already in flight are expected to finish this target -- switch to another one, or hold
        // the shot until they land (the target dies, or survives and incoming drops so we fire after all)
        if (this.doomed(t.id) && this.tick >= w.okHold) {
          w.okHold = this.tick + Math.round(OVERKILL_RECHECK * TICK_RATE);
          const c = this.pickTarget(I, w, 1);
          if (c !== m.target) { m.target = c; w.retarget = RETARGET_EVERY; }
          continue;
        }
        if (this.doomed(t.id)) continue;
        w.aimX = ax; w.aimY = ay;
        m.cooldown = Math.max(m.cooldown, -DT) + (w.def.cooldown ?? 1); // carry sub-tick remainder
        if (m.ammo !== undefined) {
          m.ammo--;
          if (m.ammo <= 0) { m.ammo = 0; m.reloading = true; m.cooldown = Math.max(m.cooldown, (w.def.reload ?? 0) * I.reloadMult); }
        }
        const burst = w.def.burst ?? 1;
        if (w.salvo) {
          // launcher battery: every tube fires in the same instant, spread into a cluster around the aim point
          w.salvoRot = this.rng() * Math.PI * 2;
          for (let k = 0; k < burst; k++) this.fire(I, mi, w, t, ax, ay, k, burst);
          continue;
        }
        if (burst > 1) { w.burstLeft = burst - 1; w.burstTimer = BURST_GAP; }
        this.fire(I, mi, w, t, ax, ay);
      }
    }
  }

  private aimScratch = { x: 0, y: 0 };
  /** Where a weapon aims. Projectile weapons lead their target: solve for the point where a round at the weapon's
   *  projectile speed meets a target moving at its current velocity (artillery and rockets need this most; fast
   *  rounds get a small lead so they reliably connect). Homing missiles, beams, rails, lightning and melee aim at
   *  the target itself. A target that changes course after the shot can still slip a slow shell. */
  private aimPoint(I: Internal, w: Wpn, t: SimUnit, mx: number, my: number): { x: number; y: number } {
    const p = this.aimScratch;
    p.x = t.x; p.y = t.y;
    const kind = w.def.projectile ?? 'bullet';
    if (kind === 'missile' || kind === 'beam' || kind === 'rail' || kind === 'lightning' || kind === 'melee' || kind === 'flame' || kind === 'none') return p;
    const T = this.ints[t.id];
    const vx = T.vx, vy = T.vy;
    if (vx * vx + vy * vy < 1e-4) return p;
    const u = I.u;
    let tof: number;
    if (kind === 'arc' && u.flying) tof = BOMB_FALL; // bombs fall a fixed time
    else {
      // |d + v t| = s t  ->  (v.v - s^2) t^2 + 2 (d.v) t + d.d = 0
      const s = w.def.projectileSpeed ?? 15;
      const dx = t.x - mx, dy = t.y - my; // [mount origins] the round leaves from the mount
      const a = vx * vx + vy * vy - s * s, b = 2 * (dx * vx + dy * vy), c = dx * dx + dy * dy;
      if (Math.abs(a) < 1e-6) tof = b < 0 ? -c / b : Math.sqrt(c) / s;
      else {
        const disc = b * b - 4 * a * c;
        if (disc < 0) return p; // can't catch it: aim at it
        const r = Math.sqrt(disc);
        const t1 = (-b - r) / (2 * a), t2 = (-b + r) / (2 * a);
        tof = t1 > 0 && t2 > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
        if (!(tof > 0)) return p;
      }
    }
    tof = Math.min(tof, 8);
    p.x = clamp(t.x + vx * tof, 0, FIELD_W);
    p.y = clamp(t.y + vy * tof, 0, FIELD_H);
    return p;
  }


  // ---------------------------------------------------------------- firing

  private fire(I: Internal, mi: number, w: Wpn, t: SimUnit | null, ax: number, ay: number, salvoK = 0, salvoN = 1): void {
    this.curSrc = this.dmgSrc = I.u.id;
    this.fireImpl(I, mi, w, t, ax, ay, salvoK, salvoN);
    this.curSrc = this.dmgSrc = -1;
  }

  /** Damage one round is expected to deal to `t` after armour (shields count as hp, see doomed). */
  private expectedHit(t: SimUnit, raw: number, ap: number, airBonus: number): number {
    const r = t.flying ? raw * airBonus : raw;
    return Math.max(r * MIN_DMG_FRAC, r - t.stats.armor * (1 - ap));
  }

  /** projectile kinds point defense shoots down (see pointDefense) */
  private interceptable(k: string): boolean {
    return k === 'rocket' || k === 'missile' || k === 'shell' || k === 'arc' || k === 'orb';
  }

  /** does `side` field a living point-defense unit? */
  private sideHasPd(side: Side): boolean {
    for (const P of this.pds) if (P.u.alive && P.u.side === side) return true;
    return false;
  }

  /** Rounds already in flight are expected to kill this unit. */
  private doomed(j: number): boolean {
    const inc = this.incoming[j];
    if (inc <= 0) return false;
    const o = this.units[j];
    return inc >= o.hp + o.shield + o.auraShield;
  }

  private fireImpl(I: Internal, mi: number, w: Wpn, t: SimUnit | null, ax: number, ay: number, salvoK = 0, salvoN = 1): void {
    const u = I.u;
    const def = w.def;
    const m = u.mounts[mi];
    m.flash = 1;
    I.sinceFire = 0;
    // [mount origins] shots leave the muzzle: mount point + barrel direction * muzzle reach
    this.mountAt(I, w);
    const px = this.mpx, py = this.mpy;
    const aim = Math.atan2(ay - py, ax - px);
    let mx = px + Math.cos(aim) * w.muz;
    let my = py + Math.sin(aim) * w.muz;
    if (salvoK === 0) this.events.push({ t: 'fire', unit: u.id, mount: mi, moduleId: def.id, x: mx, y: my, angle: aim });
    if (salvoN > 1) {
      // each tube of the pod launches from its own spot across the launcher face
      const lat = ((salvoK + 0.5) / salvoN - 0.5) * Math.min(0.6, 0.08 * salvoN);
      mx += -Math.sin(aim) * lat;
      my += Math.cos(aim) * lat;
    }
    const dist0 = Math.hypot(ax - px, ay - py);
    let raw = (def.damage ?? 0) * I.dmgMult;
    if (def.falloff != null && def.falloff !== 1 && w.range > 0) raw *= 1 + (def.falloff - 1) * Math.min(1, dist0 / w.range);
    const kind = def.projectile ?? 'bullet';
    const ap = def.ap ?? 0;
    const airBonus = def.airBonus ?? 1;
    const fx = def.stun || def.slow || def.burn || def.impulse || def.disarm ? def : null;
    const lm = I.dmgMult;

    const cls = w.cls;
    if (kind === 'melee') {
      if (!t || !t.alive) return;
      const hx = t.x - Math.cos(aim) * this.ints[t.id].radius * 0.7, hy = t.y - Math.sin(aim) * this.ints[t.id].radius * 0.7;
      if (def.splash && def.splash > 0) this.splash(t.x, t.y, def.splash, raw, ap, airBonus, u.side, false, def.id, t.id, false, fx, lm, cls, u.x, u.y);
      else this.damage(t, raw, ap, airBonus, u.side, def.id, hx, hy, fx, lm, u.x, u.y, cls);
      return;
    }
    if (kind === 'beam') {
      if (!t || !t.alive) return;
      this.events.push({ t: 'beam', moduleId: def.id, x1: mx, y1: my, x2: t.x, y2: t.y, side: u.side, unit: u.id, mount: mi });
      this.damage(t, raw, ap, airBonus, u.side, def.id, t.x, t.y, fx, lm, mx, my, cls);
      return;
    }
    if (kind === 'lightning') {
      if (!t || !t.alive) return;
      this.lightning(u, w, t, raw, ap, airBonus, mx, my, fx, lm, mi);
      return;
    }
    if (kind === 'rail') {
      this.rail(u, w, aim, raw, ap, airBonus, mx, my, fx, lm, mi);
      return;
    }
    if (kind === 'none') return;

    const pellets = Math.max(1, def.pellets ?? 1);
    const c = Math.cos(aim), s = Math.sin(aim);
    const err = w.spread * Math.min(1.2, dist0 / Math.max(1, w.range)) * (t && this.ints[t.id].jammed ? 2 : 1);
    const speed = def.projectileSpeed ?? 15;
    const air = kind === 'arc' || kind === 'flame' ? false : t ? t.flying : !w.hitG;
    // overkill bookkeeping: what one round is expected to deal to the target it was fired at. Rounds point defense can
    // shoot down are not counted on while the target's side fields any: a squad holding fire for the one missile in
    // the air let a single PD laser swat every shot, one at a time, for the rest of the battle
    const est = t && kind !== 'flame' && !(this.interceptable(kind) && this.sideHasPd(t.side))
      ? this.expectedHit(t, raw, ap, airBonus) * (kind === 'missile' ? 0.9 : pellets > 1 || salvoN > 1 ? 0.5 : err > 0 ? 0.7 : 0.9)
      : 0;
    for (let k = 0; k < pellets; k++) {
      let tx = ax, ty = ay;
      if (salvoN > 1 && kind !== 'missile') {
        // salvo cluster: rounds spiral out from the aim point (golden angle) so the blasts land side by side like a
        // cluster strike instead of stacking; a bit longer along the line of fire, where rockets scatter most
        const R = Math.max(err, (def.splash ?? 0.5) * 0.35 * Math.sqrt(salvoN));
        const r = R * Math.sqrt((salvoK + 0.5) / salvoN) * (0.85 + 0.3 * this.rng());
        const th = w.salvoRot + salvoK * GOLDEN_ANGLE;
        const e1 = r * Math.sin(th), e2 = r * Math.cos(th) * 1.25;
        tx = ax - s * e1 + c * e2;
        ty = ay + c * e1 + s * e2;
      } else if (kind === 'flame') {
        const a = aim + (this.rng() - 0.5) * 0.5;
        tx = mx + Math.cos(a) * w.range;
        ty = my + Math.sin(a) * w.range;
      } else if (err > 0) {
        // pellets fan evenly across the spread (with jitter); single shots use a triangular distribution
        const e1 = pellets > 1
          ? ((k + 0.5) / pellets - 0.5) * 2 * err + (this.rng() - 0.5) * (err / pellets)
          : (this.rng() + this.rng() - 1) * err;
        const e2 = (this.rng() + this.rng() - 1) * err * 0.6;
        tx = ax - s * e1 + c * e2;
        ty = ay + c * e1 + s * e2;
      }
      // bombs: dropped from the flyer's own position, falling from its altitude in ~0.5s
      const bomb = kind === 'arc' && u.flying;
      const ox = bomb ? u.x : mx, oy = bomb ? u.y : my;
      const total = Math.max(0.3, Math.hypot(tx - ox, ty - oy));
      let ang = Math.atan2(ty - oy, tx - ox);
      // missile salvo: the pod fans its missiles out on launch; they curve back in on the target
      if (salvoN > 1 && kind === 'missile') ang += ((salvoK + 0.5) / salvoN - 0.5) * 1.2 + (this.rng() - 0.5) * 0.15;
      const pierce = !!def.pierce;
      const p: Proj = {
        id: this.nextProjId++, side: u.side, moduleId: def.id, kind: kind as Proj['kind'], x: ox, y: oy, z: bomb ? BOMB_ALT : 0, z0: bomb ? BOMB_ALT : 0, src: u.id, angle: ang, progress: 0,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, speed: bomb ? total / BOMB_FALL : speed, dmg: raw, ap, splash: def.splash ?? 0, airBonus, air,
        target: kind === 'missile' && t ? t.id : -1, tx, ty, sx: ox, sy: oy, total, traveled: 0,
        maxDist: kind === 'flame' ? total : kind === 'missile' ? w.range * 1.8 : pierce ? w.range + 1 : total + 2,
        ignore: -1, arcH: kind === 'arc' && !bomb ? 1 + total * 0.22 : 0, dead: false,
        pierce, hits: [], fx, fxMult: lm, cls, mount: mi,
        aimT: est > 0 && t ? t.id : -1, est,
      };
      if (p.aimT >= 0) this.incoming[p.aimT] += est;
      if (air && kind !== 'missile') p.z = 1;
      else if (kind === 'orb') p.z = 0.4;
      this.projs.push(p);
    }
  }

  private lightning(u: SimUnit, w: Wpn, first: SimUnit, raw: number, ap: number, airBonus: number, mx: number, my: number, fx: ModuleDef | null, lm: number, mi = -1): void {
    const pts: { x: number; y: number }[] = [{ x: mx, y: my }];
    const hit: number[] = [];
    let cur: SimUnit | null = first;
    let dmg = raw;
    const jumps = w.def.chain ?? 0;
    for (let k = 0; k <= jumps && cur; k++) {
      const from = pts[pts.length - 1];
      pts.push({ x: cur.x, y: cur.y });
      hit.push(cur.id);
      this.damage(cur, dmg, ap, airBonus, u.side, w.def.id, cur.x, cur.y, fx, lm, from.x, from.y, w.cls);
      dmg *= CHAIN_FALLOFF;
      if (k === jumps) break;
      // next jump: nearest unhit enemy near the current one
      let best: SimUnit | null = null, bestD = CHAIN_JUMP * CHAIN_JUMP;
      const cnt = this.gather(cur.x, cur.y, CHAIN_JUMP);
      for (let q = 0; q < cnt; q++) {
        const o = this.units[this.scratch[q]];
        if (!o.alive || o.side === u.side || !this.canHit(w, o) || hit.includes(o.id)) continue;
        const dx = o.x - cur.x, dy = o.y - cur.y, d = dx * dx + dy * dy;
        if (d < bestD || (d === bestD && best && o.id < best.id)) { bestD = d; best = o; }
      }
      cur = best;
    }
    this.events.push({ t: 'chain', moduleId: w.def.id, points: pts, side: u.side, unit: u.id, mount: mi });
  }

  private rail(u: SimUnit, w: Wpn, aim: number, raw: number, ap: number, airBonus: number, mx: number, my: number, fx: ModuleDef | null, lm: number, mi = -1): void {
    const c = Math.cos(aim), s = Math.sin(aim);
    // reaches as far as a held target may be (range * RANGE_KEEP, to the target's footprint, like inRange): measured to
    // the centre, a big hull whose edge is in range sat beyond the slug and every shot missed
    const len = w.range * RANGE_KEEP;
    const ex = mx + c * len, ey = my + s * len;
    const units = this.units;
    for (let j = 0; j < units.length; j++) {
      const o = units[j];
      if (!o.alive || o.side === u.side || !this.canHit(w, o)) continue;
      const dx = o.x - mx, dy = o.y - my;
      const along = dx * c + dy * s;
      const O = this.ints[j];
      const ob = O.elong ? O.capS + O.capR : O.bound; // hull reach of 0.45 * longest side (box corners not counted)
      if (along < -0.3 || along > len + ob) continue;
      const perp = Math.abs(-dx * s + dy * c);
      if (perp <= ob + 0.15) this.damage(o, raw, ap, airBonus, u.side, w.def.id, o.x, o.y, fx, lm, mx, my, w.cls);
    }
    this.events.push({ t: 'beam', moduleId: w.def.id, x1: mx, y1: my, x2: clamp(ex, -2, FIELD_W + 2), y2: clamp(ey, -2, FIELD_H + 2), side: u.side, unit: u.id, mount: mi });
  }

  private updateHeal(I: Internal, w: Wpn, m: MountState): void {
    const u = I.u;
    w.retarget -= DT;
    let t = m.target >= 0 ? this.units[m.target] : null;
    this.mountAt(I, w); // [mount origins] heal range / aim from the emitter's mount
    if (t && (!t.alive || t.hp >= t.maxHp || this.edgeC(this.ints[t.id], this.mpx, this.mpy) > w.range * RANGE_KEEP)) { t = null; m.target = -1; } // [aura balance] to the target's edge
    if (w.retarget <= 0 || !t) {
      if (w.retarget <= 0) w.retarget = 0.5;
      const cand = this.findHealTarget(u, w);
      m.target = cand;
      t = cand >= 0 ? this.units[cand] : null;
    }
    if (!t) {
      m.angle = turnToward(m.angle, u.angle, w.traverse * DT);
      if (w.healAcc > 0) this.flushHeal(u, w, m, null);
      return;
    }
    this.mountAt(I, w);
    m.angle = turnToward(m.angle, Math.atan2(t.y - this.mpy, t.x - this.mpx), w.traverse * DT);
    const amt = Math.min(w.heal * DT, t.maxHp - t.hp);
    t.hp += amt;
    w.healAcc += amt;
    m.flash = Math.max(m.flash, 0.5);
    w.healTimer -= DT;
    if (w.healTimer <= 0) this.flushHeal(u, w, m, t);
  }

  private flushHeal(u: SimUnit, w: Wpn, m: MountState, t: SimUnit | null): void {
    w.healTimer = HEAL_EVENT_EVERY;
    if (w.healAcc <= 0) return;
    const target = t ?? null;
    if (target) {
      this.events.push({ t: 'heal', unit: target.id, amount: w.healAcc, from: u.id });
      this.mountAt(this.ints[u.id], w); // [mount origins] heal beam leaves the emitter's mount
      this.events.push({ t: 'beam', moduleId: w.def.id, x1: this.mpx, y1: this.mpy, x2: target.x, y2: target.y, side: u.side, unit: u.id, mount: u.mounts.indexOf(m) });
    }
    w.healAcc = 0;
    void m;
  }

  /** [aura balance] repair-aura pulse: edge to edge, and an ally is repaired by at most one aura per pulse (no stacking) */
  private auraPulse: Int32Array | null = null;
  private applyAura(I: Internal): void {
    const u = I.u;
    const mark = this.auraPulse ??= new Int32Array(this.units.length).fill(-1);
    const cnt = this.gather(u.x, u.y, AURA_RANGE + I.bound + MAX_RADIUS);
    for (let q = 0; q < cnt; q++) {
      const j = this.scratch[q];
      const o = this.units[j];
      if (!o.alive || o.side !== u.side || o === u || o.hp >= o.maxHp || mark[j] === this.tick) continue;
      if (this.gap(I, this.ints[j]) > AURA_RANGE) continue;
      mark[j] = this.tick;
      const amt = Math.min(o.maxHp * AURA_RATE * AURA_EVERY, o.maxHp - o.hp);
      o.hp += amt;
      if (amt > 0.5) this.events.push({ t: 'heal', unit: o.id, amount: amt, from: u.id });
    }
  }

  // ---------------------------------------------------------------- damage

  private damage(t: SimUnit, raw: number, ap: number, airBonus: number, side: Side, moduleId: string, x: number, y: number, fx: ModuleDef | null = null, fxMult = 1, ox = NaN, oy = NaN, cls = 0): void {
    if (!t.alive) return;
    const T = this.ints[t.id];
    if (this.curSrc >= 0 && this.units[this.curSrc].side !== t.side) { this.blockAtk[T.block] = this.curSrc; this.blockAtkT[T.block] = this.tick; }
    // an up shield stops the shot before it touches the hull: no status effects; paralysis drains the shield instead
    const shielded = t.shield > 0 || t.auraShield > 0;
    if (fx && !T.hardened && shielded && fx.stun) {
      const drain = fx.stun * PARA_PER_STUN * fxMult * 0.5;
      const a = Math.min(t.shield, drain);
      t.shield -= a;
      t.auraShield = Math.max(0, t.auraShield - (drain - a));
    }
    if (fx && !T.hardened && !shielded) {
      // disarm: like paralysis, builds against max hp
      if (fx.disarm) {
        const rate = t.maxHp * PARA_DECAY;
        T.disarmDmg = Math.min(t.maxHp + rate * MAX_STUN, T.disarmDmg + fx.disarm * DISARM_PER_S * fxMult);
        t.disarm = T.disarmDmg > t.maxHp ? (T.disarmDmg - t.maxHp) / rate : 0;
      }
      if (fx.impulse && !t.flying && !t.stats.isStatic && !Number.isNaN(ox)) {
        // knockback by mass: light raiders fly, tanks shrug, titans barely notice
        const mag = fx.impulse * Math.min(1.2, Math.pow(10 / Math.max(1, t.stats.weight), 0.6));
        let dx = t.x - ox, dy = t.y - oy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1e-6) {
          dx /= d; dy /= d;
          // pulls never drag a unit past the puller
          const m2 = mag < 0 ? -Math.min(-mag, Math.max(0, d - 1)) : mag;
          T.kbx += dx * m2;
          T.kby += dy * m2;
        }
      }
      // paralysis piles up against max hp (bigger hulls = more hits to stun); capped at MAX_STUN seconds of stun
      if (fx.stun) {
        const rate = t.maxHp * PARA_DECAY;
        t.para = Math.min(t.maxHp + rate * MAX_STUN, t.para + fx.stun * PARA_PER_STUN * fxMult);
        t.stun = t.para > t.maxHp ? (t.para - t.maxHp) / rate : 0;
      }
      if (fx.slow) {
        T.slowDmg = Math.min(t.maxHp, T.slowDmg + fx.slow * SLOW_PER * fxMult);
        t.slow = MAX_SLOW * Math.min(1, T.slowDmg / t.maxHp);
      }
      if (fx.burn) {
        // armour sheds some of the heat: 10 armour halves the burn
        const dps = fx.burn.dps * fxMult * (10 / (10 + t.stats.armor));
        if (t.burning <= 0 || dps >= T.burnDps) { T.burnDps = dps; T.burnSide = side; T.burnSrc = this.dmgSrc; T.burnModule = moduleId; }
        t.burning = Math.max(t.burning, fx.burn.duration);
      }
    }
    if (t.flying) raw *= airBonus;
    if (cls) {
      if ((cls & CLS_ENERGY) && T.energyResist > 0) raw *= 1 - T.energyResist;
      if ((cls & CLS_EXPLOSIVE) && t.reactive > 0) { raw *= REACTIVE_MULT; t.reactive--; }
    }
    const effArmor = t.stats.armor * (1 - ap);
    let dmg = Math.max(raw * MIN_DMG_FRAC, raw - effArmor);
    let dealt = 0;
    let shieldHit = false;
    if (t.shield > 0) {
      const a = Math.min(t.shield, dmg);
      t.shield -= a;
      dmg -= a;
      dealt += a;
      shieldHit = true;
    }
    if (dmg > 0 && t.auraShield > 0) {
      const a = Math.min(t.auraShield, dmg);
      t.auraShield -= a;
      dmg -= a;
      dealt += a;
      shieldHit = true;
    }
    if (dmg > 0) {
      const a = Math.min(t.hp, dmg);
      t.hp -= dmg;
      dealt += a;
    }
    this.damageDealt[side] += dealt;
    if (this.dmgSrc >= 0) {
      const a = this.units[this.dmgSrc];
      if (a && a.side !== t.side) { const k = a.side * 1e6 + a.uid; this.blockDmg.set(k, (this.blockDmg.get(k) ?? 0) + dealt); }
    }
    t.hitFlash = 1;
    T.sinceDamage = 0;
    this.events.push({ t: 'hit', unit: t.id, damage: dealt, shieldHit, x, y, moduleId });
    if (t.hp <= 0) {
      t.hp = 0;
      t.alive = false;
      t.moving = false;
      t.leap = 0;
      t.cloaked = false;
      this.events.push({ t: 'death', unit: t.id, x: t.x, y: t.y, size: t.stats.size, flying: t.flying });
      if (T.blastDmg > 0) this.pendingBlasts.push(t.id);
    } else if (T.smokeR > 0 && !T.smokeUsed && t.hp < t.maxHp * SMOKE_AT) {
      T.smokeUsed = true;
      const sr = T.smokeR + T.radius; // [aura balance] the cloud reaches smokeR beyond the carrier's hull
      this.smokes.push({ x: t.x, y: t.y, r: sr, t: T.smokeDur });
      this.events.push({ t: 'smoke', x: t.x, y: t.y, radius: sr, duration: T.smokeDur });
    }
  }

  private splash(x: number, y: number, R: number, raw: number, ap: number, airBonus: number, side: Side, air: boolean, moduleId: string, direct: number, emit: boolean, fx: ModuleDef | null = null, fxMult = 1, cls = 0, ox = x, oy = y): void {
    if (emit) this.events.push({ t: 'explode', x, y, radius: R, moduleId });
    const cnt = this.gather(x, y, R + MAX_RADIUS);
    for (let q = 0; q < cnt; q++) {
      const id = this.scratch[q];
      const o = this.units[id];
      if (!o.alive || o.side === side || o.flying !== air) continue;
      const d = this.edgeC(this.ints[id], x, y);
      if (d > R && id !== direct) continue;
      const f = id === direct ? 1 : 1 - (1 - SPLASH_EDGE) * Math.max(0, d) / R;
      this.damage(o, raw * f, ap, airBonus, side, moduleId, o.x, o.y, fx, fxMult, ox, oy, cls);
    }
  }

  // ---------------------------------------------------------------- projectiles

  private updateProjectiles(): void {
    const ps = this.projs;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.dead) continue;
      this.curSrc = this.dmgSrc = p.src;
      if (p.kind === 'arc') {
        p.progress = Math.min(1, p.progress + (p.speed * DT) / p.total);
        const k = p.progress;
        p.x = p.sx + (p.tx - p.sx) * k;
        p.y = p.sy + (p.ty - p.sy) * k;
        p.z = 4 * p.arcH * k * (1 - k) + p.z0 * (1 - k);
        if (k >= 1) {
          this.splash(p.tx, p.ty, p.splash, p.dmg, p.ap, p.airBonus, p.side, false, p.moduleId, -1, true, p.fx, p.fxMult, p.cls);
          p.dead = true;
        }
        continue;
      }
      if (p.kind === 'missile') {
        if (p.target >= 0) {
          const t = this.units[p.target];
          // jammed targets break the lock: the missile flies on to its last known point
          if (t.alive && !this.ints[t.id].jammed) { p.tx = t.x; p.ty = t.y; } else p.target = -1;
        }
        const want = Math.atan2(p.ty - p.y, p.tx - p.x);
        p.angle = turnToward(p.angle, want, 5 * DT);
        p.vx = Math.cos(p.angle) * p.speed;
        p.vy = Math.sin(p.angle) * p.speed;
      }
      const ox = p.x, oy = p.y;
      const step = p.speed * DT;
      p.x += p.vx * DT;
      p.y += p.vy * DT;
      p.traveled += step;
      p.progress = Math.min(1, p.traveled / p.total);
      if (p.kind === 'missile') {
        p.z = p.air ? 1 : 0.2 + 0.8 * Math.sin(Math.PI * Math.min(1, p.traveled / Math.max(1, p.total)));
      }
      // contact
      const hitId = this.sweep(p, ox, oy);
      if (hitId >= 0) {
        const t = this.units[hitId];
        const T = this.ints[hitId];
        if (T.evasive && this.rng() < EVADE_CHANCE) {
          p.ignore = hitId;
        } else {
          if (p.splash > 0) this.splash(p.x, p.y, p.splash, p.dmg, p.ap, p.airBonus, p.side, p.air, p.moduleId, hitId, p.kind !== 'flame', p.fx, p.fxMult, p.cls);
          else this.damage(t, p.dmg, p.ap, p.airBonus, p.side, p.moduleId, p.x, p.y, p.fx, p.fxMult, p.x - p.vx * DT, p.y - p.vy * DT, p.cls);
          if (p.pierce) { p.hits.push(hitId); p.ignore = hitId; }
          else { p.dead = true; continue; }
        }
      }
      if (p.kind === 'missile') {
        const dx = p.tx - p.x, dy = p.ty - p.y;
        if (p.target < 0 && dx * dx + dy * dy < step * step) {
          this.splash(p.tx, p.ty, Math.max(0.4, p.splash), p.dmg, p.ap, p.airBonus, p.side, p.air, p.moduleId, -1, true, p.fx, p.fxMult, p.cls);
          p.dead = true;
          continue;
        }
      } else if (p.splash > 0 && p.kind !== 'flame' && !p.pierce && p.traveled >= p.total) {
        this.splash(p.tx, p.ty, p.splash, p.dmg, p.ap, p.airBonus, p.side, p.air, p.moduleId, -1, true, p.fx, p.fxMult, p.cls);
        p.dead = true;
        continue;
      }
      if (p.traveled >= p.maxDist || p.x < -2 || p.y < -2 || p.x > FIELD_W + 2 || p.y > FIELD_H + 2) p.dead = true;
    }
    // compact
    let wi = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!p.dead) { ps[wi++] = p; continue; }
      if (p.aimT >= 0) { const v = this.incoming[p.aimT] - p.est; this.incoming[p.aimT] = v > 1e-9 ? v : 0; }
    }
    ps.length = wi;
    this.projectiles = ps;
  }

  /** First enemy (of the projectile's layer) whose circle the segment (ox,oy)->(p.x,p.y) touches. */
  private sweep(p: Proj, ox: number, oy: number): number {
    const sx = p.x - ox, sy = p.y - oy;
    const len2 = sx * sx + sy * sy;
    const cx = (ox + p.x) / 2, cy = (oy + p.y) / 2;
    const cnt = this.gather(cx, cy, Math.sqrt(len2) / 2 + MAX_RADIUS);
    let best = -1, bestT = Infinity;
    for (let q = 0; q < cnt; q++) {
      const id = this.scratch[q];
      const o = this.units[id];
      if (!o.alive || o.side === p.side || o.flying !== p.air || id === p.ignore || (p.pierce && p.hits.includes(id))) continue;
      const O = this.ints[id];
      if (O.elong) {
        // elongated hull: its capsule (the same shape separation uses), not the mean-radius circle -- a long hull
        // seen end-on reaches ~hl toward the shooter, where range checks find it but a circle let flames fall short
        const t = this.segCapsule(ox, oy, sx, sy, O);
        if (t >= 0 && (t < bestT || (t === bestT && id < best))) { bestT = t; best = id; }
        continue;
      }
      const r = O.radius;
      let t = len2 > 0 ? ((o.x - ox) * sx + (o.y - oy) * sy) / len2 : 0;
      t = clamp(t, 0, 1);
      const qx = ox + sx * t - o.x, qy = oy + sy * t - o.y;
      if (qx * qx + qy * qy <= r * r && (t < bestT || (t === bestT && id < best))) { bestT = t; best = id; }
    }
    return best;
  }

  /** Does the segment (ox, oy) + (sx, sy) * t, t in [0, 1], touch O's capsule? Returns t of its closest approach, or -1. */
  private segCapsule(ox: number, oy: number, sx: number, sy: number, O: Internal): number {
    const o = O.u;
    const ar = O.capAcross ? o.angle + Math.PI / 2 : o.angle;
    const vx = Math.cos(ar) * O.capS, vy = Math.sin(ar) * O.capS;
    // closest points of P(t) = A + d1 t and Q(s) = B + d2 s, t, s in [0, 1] (core segment B = centre - v, d2 = 2v)
    const d1x = sx, d1y = sy, d2x = 2 * vx, d2y = 2 * vy;
    const rx = ox - (o.x - vx), ry = oy - (o.y - vy);
    const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y, f = d2x * rx + d2y * ry;
    let t = 0, s = 0;
    if (a <= 1e-12) s = e > 1e-12 ? clamp(f / e, 0, 1) : 0;
    else {
      const c = d1x * rx + d1y * ry;
      if (e <= 1e-12) t = clamp(-c / a, 0, 1);
      else {
        const b = d1x * d2x + d1y * d2y, den = a * e - b * b;
        t = den > 1e-12 ? clamp((b * f - c * e) / den, 0, 1) : 0;
        s = (b * t + f) / e;
        if (s < 0) { s = 0; t = clamp(-c / a, 0, 1); }
        else if (s > 1) { s = 1; t = clamp((b - c) / a, 0, 1); }
      }
    }
    const qx = rx + d1x * t - d2x * s, qy = ry + d1y * t - d2y * s;
    return qx * qx + qy * qy <= O.capR * O.capR ? t : -1;
  }

  // ---------------------------------------------------------------- movement

  private move(I: Internal): void {
    const u = I.u;
    if (I.isStatic) return;
    if (I.kbx !== 0 || I.kby !== 0) {
      const kx = I.kbx * KNOCK_RATE, ky = I.kby * KNOCK_RATE;
      u.x += kx; u.y += ky;
      I.kbx -= kx; I.kby -= ky;
      if (Math.abs(I.kbx) < 0.01 && Math.abs(I.kby) < 0.01) { I.kbx = 0; I.kby = 0; }
    }
    if (u.stun > 0 && I.leapT < 0 && !I.strafe) return;
    if (I.leapT >= 0) {
      I.leapT = Math.min(1, I.leapT + DT / LEAP_TIME);
      const k = I.leapT;
      u.x = I.lx0 + (I.lx1 - I.lx0) * k;
      u.y = I.ly0 + (I.ly1 - I.ly0) * k;
      u.leap = Math.sin(Math.PI * k);
      if (k >= 1) { I.leapT = -1; u.leap = 0; }
      return;
    }
    // Movement precedence: delay gates everything at the start; then
    //   holdPos > retreat (while active) > charge > escort > kite > flank > advance.
    if (this.tick < I.delayTicks) return;
    if (I.stance === 'holdPos') { this.faceTarget(I); return; }
    let goal = I.goal >= 0 ? this.units[I.goal] : null;
    if (I.strafe) { this.strafeMove(I, goal); return; }

    if (I.retreatOn) {
      const r = u.hp / u.maxHp;
      if (!I.retreating && r < RETREAT_BELOW) I.retreating = true;
      else if (I.retreating && r > RETREAT_ABOVE) I.retreating = false;
      if (I.retreating) { this.retreatMove(I); return; }
    }
    const charge = I.stance === 'charge';
    let escorting = false;
    if (I.escortBlock >= 0 && I.escUnit >= 0 && !charge) {
      const E = this.units[I.escUnit];
      if (E.alive) {
        const dE = Math.hypot(E.x - u.x, E.y - u.y);
        const thr = I.escThreat >= 0 && this.units[I.escThreat].alive ? this.units[I.escThreat] : null;
        if (thr && dE <= ESCORT_LEASH) { goal = thr; escorting = true; }
        else {
          if (dE <= ESCORT_NEAR) this.faceTarget(I);
          else this.steer(I, E.x, E.y, ESCORT_NEAR - 0.4, E.id);
          return;
        }
      }
    }
    const kiteOn = I.kite && !charge && !escorting;

    // Engaged = every weapon that could hit our goal is holding a target, i.e. the whole armament is in range.
    // Until then keep closing (so a long-range gun alone doesn't park a brawler out of reach of its main guns);
    // after that, stop — there's no reason to close further unless melee or Charge.
    let engagedDps = 0, relevantDps = 0, relevantR = 0;
    for (let mi = 0; mi < I.wpns.length; mi++) {
      const w = I.wpns[mi];
      if (!w || w.heal > 0) continue;
      const tg = u.mounts[mi].target;
      if (!goal || this.canHit(w, goal)) { relevantDps += w.dps; relevantR = Math.max(relevantR, w.range); }
      if (tg >= 0) engagedDps += w.dps;
    }
    const engaged = engagedDps > 0 && engagedDps >= ENGAGE_SHARE * relevantDps;

    let gx = u.x, gy = u.y, wantMove = false, stopDist = 0;
    const fwd = forwardY(u.side);
    if (goal) {
      const dx = goal.x - u.x, dy = goal.y - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      // kiting: how far the kite gun's muzzle reaches into its own range of the goal (1 = right at the edge).
      // [mount origins] measured from the kite mount as it sits with the hull facing the goal (the pose the unit
      // advances and parks in), so it doesn't depend on which way the hull happens to point right now. Only our own
      // weapon's range counts: an enemy that outranges us is closed on until we can shoot it, never run from.
      let kiteR = Infinity, kiteMi = -1;
      if (kiteOn && !I.meleeOnly) {
        kiteMi = this.kiteMount(I, goal);
        if (kiteMi >= 0) {
          const w = I.wpns[kiteMi]!, c = dx / Math.max(d, 1e-6), s = dy / Math.max(d, 1e-6);
          kiteR = this.edgeC(this.ints[goal.id], u.x + c * w.ox - s * w.oy, u.y + s * w.ox + c * w.oy) / w.range;
        }
      }
      if (I.blocker) {
        // wall: march into the nearest enemy and body-block it (straight-ish advance while far)
        const lw = clamp(1 - (d - 4) / 8, 0.3, 1);
        gx = u.x + dx * lw;
        gy = u.y + dy;
        stopDist = 0;
        if (this.gap(I, this.ints[goal.id]) <= 0.15) return;
      } else if (!I.hasWeapon) {
        // support: stay just behind the nearest armed ally
        gx = goal.x;
        gy = clamp(goal.y - fwd * (1.6 + this.ints[goal.id].radius), I.radius, FIELD_H - I.radius);
        stopDist = 0.6;
        // close enough to the ally already: don't shove it around
        if (this.gap(I, this.ints[goal.id]) <= 1.2 && Math.abs(goal.y - fwd * 1.6 - u.y) < 2.5) return;
      } else if (kiteR < 0.7) {
        // kiting: an enemy got inside 70% of our range, back away (non-fireOnMove units pause to shoot first)
        // Only the kite gun counts, and only one with a real reload cycle: a rapid-fire gun (mg: 0.15 s) is "about to
        // fire" every tick and would pin the kiter in place for good while the enemy closes.
        const kw = I.wpns[kiteMi]!, km = u.mounts[kiteMi];
        if (!I.fireOnMove && (kw.def.cooldown ?? 1) > 2 * KITE_PAUSE && km.cooldown <= KITE_PAUSE && km.target >= 0 && u.disarm <= 0) return; // (a disarmed gun will not fire: keep running)
        gx = clamp(u.x - (dx / Math.max(d, 1e-6)) * 3, I.radius, FIELD_W - I.radius);
        gy = clamp(u.y - (dy / Math.max(d, 1e-6)) * 3, I.radius, FIELD_H - I.radius);
        stopDist = 0;
      } else {
        // flank: swing out to the owner's left/right edge, run along it, then turn in
        if ((I.stance === 'flankLeft' || I.stance === 'flankRight') && !I.flankDone) {
          const past = fwd < 0 ? u.y < FIELD_H / 2 : u.y > FIELD_H / 2;
          if (engaged || past || this.edgeC(this.ints[goal.id], u.x, u.y) <= FLANK_TURN_IN * I.maxRange) I.flankDone = true;
          else {
            // owner's left is -x for side 0 and +x for side 1
            const leftX = u.side === 0 ? -1 : 1;
            const toward = (I.stance === 'flankLeft' ? leftX : -leftX) < 0 ? 0 : 1;
            const edgeX = toward === 0 ? FLANK_EDGE : FIELD_W - FLANK_EDGE;
            const lat = edgeX - u.x;
            if (Math.abs(lat) > 1.5) { this.steer(I, edgeX, u.y + fwd * Math.abs(lat) * 0.25, 0, goal.id); return; }
            this.steer(I, edgeX, u.y + fwd * 10, 0, goal.id);
            return;
          }
        }
        // leap in
        if (I.canLeap && I.leapCd <= 0 && d >= 3 && d <= 7) {
          const land = Math.max(1.5, I.minWeaponRange * 0.6);
          const jump = Math.min(5, d - land);
          if (jump >= 1.5) {
            I.leapT = 0;
            I.leapCd = LEAP_COOLDOWN;
            I.lx0 = u.x; I.ly0 = u.y;
            I.lx1 = clamp(u.x + (dx / d) * jump, I.radius, FIELD_W - I.radius);
            I.ly1 = clamp(u.y + (dy / d) * jump, I.radius, FIELD_H - I.radius);
            u.angle = Math.atan2(dy, dx);
            this.events.push({ t: 'leap', unit: u.id });
            return;
          }
        }
        // far away: advance mostly straight ahead so formations hold their shape
        // only the guns that can hit this goal count (an AA-only long gun must not park us out of reach of a ground goal)
        const engageR = relevantR > 0 ? relevantR : I.maxRange;
        const lw = clamp(1 - (d - engageR - 2) / 8, 0.3, 1);
        let hx = dx, hy = dy;
        if (I.hold && this.anchorN[I.block] > 0) {
          // formation: aim at our slot around the goal, pulled toward our slot around the squad's anchor. The pull
          // fades out as we close to our own weapon range: an outer member's slot can lie farther from the goal than
          // its guns reach, and it used to park there for good (squadmate spacing is still kept by separation).
          const kf = clamp((d - engageR) / (Math.hypot(I.offx, I.offy) + 1), 0, 1);
          hx += kf * (I.offx + 0.6 * (this.anchorX[I.block] + I.offx - u.x));
          hy += kf * (I.offy + 0.6 * (this.anchorY[I.block] + I.offy - u.y));
        }
        gx = u.x + hx * lw;
        gy = u.y + hy;
        stopDist = 0;
        if (charge) wantMove = I.meleeOnly || this.edgeC(this.ints[goal.id], u.x, u.y) > CHARGE_GUN_FRAC * engageR;
        else if (kiteR <= 0.9) {
          // kiting: parked at our range edge. If the kite gun still has nothing to shoot (the hull came to rest
          // turned away, e.g. after backing off, leaving the mount out of reach) swing the hull back to face the goal.
          if (u.mounts[kiteMi].target < 0 && u.stun <= 0) u.angle = turnToward(u.angle, Math.atan2(dy, dx), I.turn * DT);
          else this.faceTarget(I);
          return;
        }
        else if (engaged && !I.meleeOnly) wantMove = false; // includes fire-on-move units: hold at range, don't bum-rush
        else if (I.meleeOnly) wantMove = true; // brawlers charge all the way into contact
        else if (I.fireOnMove && engageR > 2.5 && this.edgeC(this.ints[goal.id], u.x, u.y) <= Math.max(1.2, engageR * 0.7)) wantMove = false; // bombers (tiny range) fly right over the target
        else wantMove = true;
        if (!wantMove) {
          // holding: turrets do the aiming; only a gun that traverses slower than the hull turns swings the hull toward the fight
          this.faceTarget(I);
          return;
        }
        // [mount origins] pressed against the goal's hull with no gun in reach (e.g. a rear-mounted flamer on a long
        // hull nosed into a big emplacement): pushing on gets nowhere and it sat there for good, so pivot in place to
        // swing the longest-ranged gun's mount toward the goal instead
        if (!u.flying && !goal.flying && !I.meleeOnly && engagedDps <= 0 && this.gap(I, this.ints[goal.id]) <= 0.25) {
          let bw: Wpn | null = null;
          for (const w of I.wpns) if (w && w.heal <= 0 && !w.melee && this.canHit(w, goal) && (!bw || w.range > bw.range)) bw = w;
          if (bw && bw.ox * bw.ox + bw.oy * bw.oy > 0.09) {
            u.angle = turnToward(u.angle, Math.atan2(dy, dx) - Math.atan2(bw.oy, bw.ox), I.turn * DT);
            return;
          }
        }
      }
    } else if (I.hasWeapon && this.anyEnemyAlive(u.side)) {
      // nothing we can hit: advance to our side of the midline and hold
      const holdY = FIELD_H / 2 - fwd * 3;
      gx = u.x;
      gy = holdY;
    } else {
      return;
    }

    this.steer(I, gx, gy, stopDist, goal ? goal.id : -1);
  }

  /** Kite mount for this goal: the unit's kite mount if it can hit the goal, else its longest-ranged weapon that can
   *  (-1: nothing ranged can hit it, so no kiting against this goal). */
  private kiteMount(I: Internal, goal: SimUnit): number {
    const k = I.kiteMi;
    if (k < 0) return -1;
    if (this.canHit(I.wpns[k]!, goal)) return k;
    let best = -1;
    for (let i = 0; i < I.wpns.length; i++) {
      const w = I.wpns[i];
      if (kiteable(w) && this.canHit(w, goal) && (best < 0 || w.range > I.wpns[best]!.range)) best = i;
    }
    return best;
  }

  /** While parked, the turrets do the aiming and the hull stays put. The exception is a gun whose traverse is slower
   *  than the hull's turn rate (e.g. the spinal mass driver): then swinging the whole vehicle is the faster way to
   *  bring it on target, so the hull turns toward that weapon's target (the highest-dps such weapon that is engaged)
   *  and carries the barrel with it. Ground units only; the hull only otherwise turns to steer while moving. */
  private faceTarget(I: Internal): void {
    const u = I.u;
    if (u.flying || u.stun > 0) return;
    let best = -1, bestDps = -1;
    for (let mi = 0; mi < I.wpns.length; mi++) {
      const w = I.wpns[mi];
      if (!w || w.heal > 0 || w.traverse >= I.turn || u.mounts[mi].target < 0) continue;
      if (w.dps > bestDps) { bestDps = w.dps; best = mi; }
    }
    if (best < 0) return;
    const m = u.mounts[best];
    const t = this.units[m.target];
    const want = Math.atan2(t.y - u.y, t.x - u.x);
    const prev = u.angle;
    u.angle = turnToward(u.angle, want, I.turn * DT * 0.5);
    // the slow mount rides the hull round (never past its target)
    m.angle = turnToward(m.angle, want, Math.abs(angDiff(prev, u.angle)));
  }

  /** Fall back to the nearest friendly repair source (healer / repair aura), else the rear of the own deploy zone. */
  private retreatMove(I: Internal): void {
    const u = I.u;
    let best: Internal | null = null, bd = Infinity;
    for (const H of this.healers) {
      if (H === I || !H.u.alive || H.u.side !== u.side || H.retreating) continue;
      const d = (H.u.x - u.x) * (H.u.x - u.x) + (H.u.y - u.y) * (H.u.y - u.y);
      if (d < bd) { bd = d; best = H; }
    }
    if (best) this.steer(I, best.u.x, best.u.y, 1.5 + I.radius + best.radius, best.u.id);
    else this.steer(I, u.x, u.side === 0 ? FIELD_H - I.radius - 0.6 : I.radius + 0.6, 0.1, -1);
  }

  /** Common locomotion: head for (gx, gy), stopping within stopDist. */
  private steer(I: Internal, gx: number, gy: number, stopDist: number, goalId: number): void {
    const u = I.u;
    const dx = gx - u.x, dy = gy - u.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= Math.max(stopDist, 0.05)) return;
    const want = Math.atan2(dy, dx) + this.avoid(I, dx / d, dy / d, goalId);
    u.angle = turnToward(u.angle, want, I.turn * DT);
    const diff = Math.abs(angDiff(u.angle, want));
    let f = diff >= Math.PI / 2 ? 0 : Math.cos(diff);
    if (u.flying) f = Math.max(f, 0.3); // rotors can drift sideways
    const sp = Math.min(I.speed * (1 - u.slow) * f * DT, d - stopDist * 0.5);
    if (sp <= 0) return;
    if (u.flying) {
      // rotors slide toward the goal directly; body heading follows
      u.x += (dx / d) * sp;
      u.y += (dy / d) * sp;
    } else {
      u.x += Math.cos(u.angle) * sp;
      u.y += Math.sin(u.angle) * sp;
    }
  }

  /** Steering offset (radians) to slip around allies (or emplacements) that block the way ahead. */
  private avoid(I: Internal, dirX: number, dirY: number, goalId: number): number {
    const u = I.u;
    const look = I.bound + MAX_RADIUS + 0.8;
    // enemies only matter when they field emplacements; otherwise scan just our own side (same order, fewer ids)
    const foeSide = u.side === 0 ? 1 : 0;
    // anything that can pass the along/perp window below (0 < along <= clear + 0.8, |perp| < clear) lies in the
    // bounding box of that window at its widest clear
    let cnt = 0;
    if (this.staticOn[foeSide] || !this.posMoveOk) cnt = this.gather(u.x, u.y, look);
    else {
      // gatherSideBox(u.side, u.x, u.y, look, <window box>), written out here: this runs for every moving unit
      // every tick and a call would box all its float arguments
      const cMax = I.radius + this.maxSepQ + 0.1, aMax = cMax + 0.8, m = this.drift + 1e-6;
      const bx0 = u.x + (Math.min(0, aMax * dirX) - cMax * Math.abs(dirY)) - m, bx1 = u.x + (Math.max(0, aMax * dirX) + cMax * Math.abs(dirY)) + m;
      const by0 = u.y + (Math.min(0, aMax * dirY) - cMax * Math.abs(dirX)) - m, by1 = u.y + (Math.max(0, aMax * dirY) + cMax * Math.abs(dirX)) + m;
      const x0 = clamp(Math.floor((u.x - look) / CELL), 0, HCOLS - 1), x1 = clamp(Math.floor((u.x + look) / CELL), 0, HCOLS - 1);
      const y0 = clamp(Math.floor((u.y - look) / CELL), 0, HROWS - 1), y1 = clamp(Math.floor((u.y + look) / CELL), 0, HROWS - 1);
      const sc = this.scratch, head = this.sideHead, next = this.sideNext, base = u.side * (HCOLS * HROWS);
      for (let cy = y0; cy <= y1; cy++) {
        if ((cy > 0 && cy * CELL > by1) || (cy < HROWS - 1 && (cy + 1) * CELL < by0)) continue;
        for (let cx = x0; cx <= x1; cx++) {
          if ((cx > 0 && cx * CELL > bx1) || (cx < HCOLS - 1 && (cx + 1) * CELL < bx0)) continue;
          for (let i = head[base + cy * HCOLS + cx]; i >= 0; i = next[i]) sc[cnt++] = i;
        }
      }
    }
    let best = Infinity, bestPerp = 0, bestClear = 1;
    const mySpeed = I.speed * 0.5;
    const radA = this.radA, live = this.posMoveOk, sx = this.snapX, sy = this.snapY;
    const ux = u.x, uy = u.y;
    for (let q = 0; q < cnt; q++) {
      const j = this.scratch[q];
      if (j === u.id || j === goalId) continue;
      // geometry first (all filters here are independent tests, so their order doesn't change the result);
      // other units' positions come from the flat mirror while it is valid
      const rx = (live ? sx[j] : this.units[j].x) - ux, ry = (live ? sy[j] : this.units[j].y) - uy;
      const along = rx * dirX + ry * dirY;
      if (along <= 0) continue;
      const clear = I.radius + radA[j] + 0.1;
      if (along > clear + 0.8) continue;
      const perp = rx * -dirY + ry * dirX; // >0: obstacle on our left (in +perp direction)
      if (Math.abs(perp) >= clear) continue;
      const o = this.units[j];
      if (!o.alive || o.flying !== u.flying) continue;
      const O = this.ints[j];
      if (O.leapT >= 0) continue;
      // enemies are only obstacles when they can't be pushed (emplacements)
      if (o.side !== u.side && !O.isStatic) continue;
      // allies moving our way at a decent clip aren't in the way
      if (O.vx * dirX + O.vy * dirY > mySpeed) continue;
      if (along < best) { best = along; bestPerp = perp; bestClear = clear; }
    }
    if (best === Infinity) {
      if (I.avoidT > 0) I.avoidT -= DT;
      else I.avoidSide = 0;
      return 0;
    }
    if (I.avoidSide === 0) {
      I.avoidSide = bestPerp > 0.05 ? -1 : bestPerp < -0.05 ? 1 : (u.id & 1 ? 1 : -1);
      // don't dodge into a wall
      const sx = u.x + I.avoidSide * -dirY * (I.radius + 1.5), sy = u.y + I.avoidSide * dirX * (I.radius + 1.5);
      if (sx < I.radius || sx > FIELD_W - I.radius || sy < I.radius || sy > FIELD_H - I.radius) I.avoidSide = -I.avoidSide;
      I.stuckT = 0;
    }
    // making no headway around this obstacle: try the other way
    if (I.vx * dirX + I.vy * dirY < I.speed * 0.15) {
      I.stuckT += DT;
      if (I.stuckT > 1.5) { I.avoidSide = -I.avoidSide; I.stuckT = 0; }
    } else I.stuckT = 0;
    I.avoidT = 0.6;
    const strength = 1 - Math.abs(bestPerp) / bestClear; // 1 = dead ahead
    return I.avoidSide * (0.5 + 0.9 * strength);
  }

  private strafeMove(I: Internal, goal: SimUnit | null): void {
    const u = I.u;
    let want: number;
    const margin = 1.5;
    if (u.x < margin || u.x > FIELD_W - margin || u.y < margin || u.y > FIELD_H - margin) {
      want = Math.atan2(FIELD_H / 2 - u.y, FIELD_W / 2 - u.x);
      I.strafeT = Math.max(I.strafeT, 0.2);
    } else if (I.strafeT > 0) {
      I.strafeT -= DT;
      want = u.angle;
    } else if (goal) {
      const dx = goal.x - u.x, dy = goal.y - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      want = Math.atan2(dy, dx);
      if (d < 1.2 || (d < 2.5 && Math.abs(angDiff(u.angle, want)) > 1.2)) {
        I.strafeT = 1.1; // overshoot, then loop back
        want = u.angle;
      }
    } else {
      want = Math.atan2(FIELD_H / 2 - u.y, FIELD_W / 2 - u.x);
    }
    // a stunned jet can't steer but keeps gliding
    if (u.stun <= 0) u.angle = turnToward(u.angle, want, I.turn * DT);
    const sp = I.speed * (1 - u.slow) * DT;
    u.x += Math.cos(u.angle) * sp;
    u.y += Math.sin(u.angle) * sp;
    u.x = clamp(u.x, 0.5, FIELD_W - 0.5);
    u.y = clamp(u.y, 0.5, FIELD_H - 0.5);
  }

  private anyEnemyAlive(side: Side): boolean {
    for (const o of this.units) if (o.alive && o.side !== side) return true;
    return false;
  }

  // ---------------------------------------------------------------- spatial hash + separation

  private rebuildHash(): void {
    const head = this.head, sideHead = this.sideHead;
    head.fill(-1);
    sideHead.fill(-1);
    const units = this.units;
    const l0 = this.liveIdx[0], l1 = this.liveIdx[1];
    let n0 = 0, n1 = 0;
    for (let i = 0; i < units.length; i++) if (units[i].alive) { if (units[i].side === 0) l0[n0++] = i; else l1[n1++] = i; }
    this.liveN[0] = n0; this.liveN[1] = n1;
    for (let i = units.length - 1; i >= 0; i--) {
      const u = units[i];
      if (!u.alive) continue;
      const c = this.cellOf(u.x, u.y);
      this.hashX[i] = u.x; this.hashY[i] = u.y;
      if (head[c] < 0) this.tail[c] = i;
      this.next[i] = head[c];
      head[c] = i;
      const sc = u.side * (HCOLS * HROWS) + c;
      this.sideNext[i] = sideHead[sc];
      sideHead[sc] = i;
    }
  }

  private cellOf(x: number, y: number): number {
    const cx = clamp(Math.floor(x / CELL), 0, HCOLS - 1);
    const cy = clamp(Math.floor(y / CELL), 0, HROWS - 1);
    return cy * HCOLS + cx;
  }

  /** Fill this.scratch with ids of living units in hash cells overlapping the circle; returns count. */
  private gather(x: number, y: number, r: number): number {
    const x0 = clamp(Math.floor((x - r) / CELL), 0, HCOLS - 1), x1 = clamp(Math.floor((x + r) / CELL), 0, HCOLS - 1);
    const y0 = clamp(Math.floor((y - r) / CELL), 0, HROWS - 1), y1 = clamp(Math.floor((y + r) / CELL), 0, HROWS - 1);
    let n = 0;
    const sc = this.scratch;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++)
        for (let i = this.head[cy * HCOLS + cx]; i >= 0; i = this.next[i]) sc[n++] = i;
    return n;
  }

  /** Fill this.sat from the snapshot positions of the units alive now. */
  private buildSat(): void {
    const sat = this.sat, units = this.units, W1 = HCOLS + 1;
    sat.fill(0);
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u.alive) continue;
      const cx = clamp(Math.floor(this.snapX[i] / CELL), 0, HCOLS - 1), cy = clamp(Math.floor(this.snapY[i] / CELL), 0, HROWS - 1);
      sat[u.side * SAT_N + (cy + 1) * W1 + cx + 1]++;
    }
    for (let s = 0; s < 2; s++) {
      const b = s * SAT_N;
      for (let cy = 1; cy <= HROWS; cy++)
        for (let cx = 1; cx <= HCOLS; cx++)
          sat[b + cy * W1 + cx] += sat[b + (cy - 1) * W1 + cx] + sat[b + cy * W1 + cx - 1] - sat[b + (cy - 1) * W1 + cx - 1];
    }
  }

  /** while posSnapOk: does `side` have any unit (alive at the snapshot) whose position is inside the box? (may say
   *  yes for units just outside it, never no for one inside) */
  private anyIn(side: Side, x0: number, x1: number, y0: number, y1: number): boolean {
    const W1 = HCOLS + 1, b = side * SAT_N, sat = this.sat;
    const cx0 = clamp(Math.floor(x0 / CELL), 0, HCOLS - 1), cx1 = clamp(Math.floor(x1 / CELL), 0, HCOLS - 1) + 1;
    const cy0 = clamp(Math.floor(y0 / CELL), 0, HROWS - 1), cy1 = clamp(Math.floor(y1 / CELL), 0, HROWS - 1) + 1;
    return sat[b + cy1 * W1 + cx1] - sat[b + cy0 * W1 + cx1] - sat[b + cy1 * W1 + cx0] + sat[b + cy0 * W1 + cx0] > 0;
  }

  /** gather() restricted to one side's units: the same ids in the same order as gather() minus the other side */
  private gatherSide(side: Side, x: number, y: number, r: number): number {
    const x0 = clamp(Math.floor((x - r) / CELL), 0, HCOLS - 1), x1 = clamp(Math.floor((x + r) / CELL), 0, HCOLS - 1);
    const y0 = clamp(Math.floor((y - r) / CELL), 0, HROWS - 1), y1 = clamp(Math.floor((y + r) / CELL), 0, HROWS - 1);
    let n = 0;
    const sc = this.scratch, head = this.sideHead, next = this.sideNext, base = side * (HCOLS * HROWS);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++)
        for (let i = head[base + cy * HCOLS + cx]; i >= 0; i = next[i]) sc[n++] = i;
    return n;
  }

  /** gatherSide(side, x, y, r) over the same cells in the same order, minus whole cells that cannot hold a unit whose
   *  current position is inside the box [bx0, bx1] x [by0, by1]: a unit sits in the cell of its hash position and has
   *  drifted at most this.drift (per axis) since. Only valid while posSnapOk / posMoveOk; otherwise exactly gatherSide(). */
  private gatherSideBox(side: Side, x: number, y: number, r: number, bx0: number, bx1: number, by0: number, by1: number): number {
    if (!this.posSnapOk && !this.posMoveOk) return this.gatherSide(side, x, y, r);
    const x0 = clamp(Math.floor((x - r) / CELL), 0, HCOLS - 1), x1 = clamp(Math.floor((x + r) / CELL), 0, HCOLS - 1);
    const y0 = clamp(Math.floor((y - r) / CELL), 0, HROWS - 1), y1 = clamp(Math.floor((y + r) / CELL), 0, HROWS - 1);
    const m = this.drift + 1e-6;
    bx0 -= m; bx1 += m; by0 -= m; by1 += m;
    let n = 0;
    const sc = this.scratch, head = this.sideHead, next = this.sideNext, base = side * (HCOLS * HROWS);
    // edge rows/columns also hold anything filed from beyond the field, so they are unbounded outward
    for (let cy = y0; cy <= y1; cy++) {
      if ((cy > 0 && cy * CELL > by1) || (cy < HROWS - 1 && (cy + 1) * CELL < by0)) continue;
      for (let cx = x0; cx <= x1; cx++) {
        if ((cx > 0 && cx * CELL > bx1) || (cx < HCOLS - 1 && (cx + 1) * CELL < bx0)) continue;
        for (let i = head[base + cy * HCOLS + cx]; i >= 0; i = next[i]) sc[n++] = i;
      }
    }
    return n;
  }

  /** gatherSideBox() for the units within `need` of (x, y) */
  private gatherSideNear(side: Side, x: number, y: number, r: number, need: number): number {
    return this.gatherSideBox(side, x, y, r, x - need, x + need, y - need, y + need);
  }

  private capSeg = { d: 0, nx: 0, ny: 0 };
  /** closest distance between the core segments of two capsules, with the unit vector from A's point to B's point */
  private capsuleSep(A: Internal, B: Internal, a: SimUnit, b: SimUnit): { d: number; nx: number; ny: number } {
    const ar = A.capAcross ? a.angle + Math.PI / 2 : a.angle, br = B.capAcross ? b.angle + Math.PI / 2 : b.angle;
    const ux = Math.cos(ar) * A.capS, uy = Math.sin(ar) * A.capS, vx = Math.cos(br) * B.capS, vy = Math.sin(br) * B.capS;
    // segments P(s) = a + s*u, Q(t) = b + t*v with s,t in [-1,1]
    const wx = a.x - b.x, wy = a.y - b.y;
    const uu = ux * ux + uy * uy, vv = vx * vx + vy * vy, uv = ux * vx + uy * vy;
    const uw = ux * wx + uy * wy, vw = vx * wx + vy * wy;
    const den = uu * vv - uv * uv;
    let sp = 0, tp = 0;
    if (uu < 1e-9 && vv < 1e-9) { sp = 0; tp = 0; }
    else if (uu < 1e-9) { tp = clamp(vw / vv, -1, 1); }
    else if (vv < 1e-9) { sp = clamp(-uw / uu, -1, 1); }
    else {
      sp = den > 1e-9 ? clamp((uv * vw - vv * uw) / den, -1, 1) : 0;
      tp = clamp((uv * sp + vw) / vv, -1, 1);
      sp = clamp((uv * tp - uw) / uu, -1, 1);
    }
    const px = a.x + ux * sp, py = a.y + uy * sp, qx = b.x + vx * tp, qy = b.y + vy * tp;
    let ddx = qx - px, ddy = qy - py;
    const dd = Math.sqrt(ddx * ddx + ddy * ddy);
    const r = this.capSeg;
    if (dd < 1e-6) { ddx = b.x - a.x; ddy = b.y - a.y; const l = Math.sqrt(ddx * ddx + ddy * ddy); if (l < 1e-6) { r.nx = 1; r.ny = 0; } else { r.nx = ddx / l; r.ny = ddy / l; } r.d = 0; }
    else { r.nx = ddx / dd; r.ny = ddy / dd; r.d = dd; }
    return r;
  }

  private separate(): void {
    const units = this.units;
    const ints = this.ints;
    const head = this.head, next = this.next, tail = this.tail;
    // positions mirrored into flat arrays (kept in sync with every push below) so distant pairs are rejected
    // before touching either unit's objects; snapX/snapY are free outside the goals + weapons phase
    const px = this.snapX, py = this.snapY, sq = this.sepQ, hx = this.hashX, hy = this.hashY;
    // D: largest per-axis drift of any live unit from the position its hash cell was built from. A unit filed in
    // cell (cx, cy) is within D of that cell's box, so whole cells farther than the contact reach + D from `a`
    // hold only pairs the distance pre-filter would reject anyway, and are skipped without walking them.
    let D = 0;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      px[i] = u.x; py[i] = u.y;
      if (u.alive) D = Math.max(D, Math.abs(u.x - hx[i]), Math.abs(u.y - hy[i]));
    }
    for (let i = 0; i < units.length; i++) {
      const a = units[i];
      if (!a.alive) continue;
      const A = ints[i];
      if (A.leapT >= 0) continue;
      const ccx = clamp(Math.floor(a.x / CELL), 0, HCOLS - 1), ccy = clamp(Math.floor(a.y / CELL), 0, HROWS - 1);
      const reach = Math.max(1, Math.ceil((A.bound + MAX_RADIUS) / CELL));
      // (the cells the original neighbourhood scan visits, in this row-major order)
      const rowLo = Math.max(0, ccy - reach), rowHi = Math.min(HROWS - 1, ccy + reach);
      const colLo = Math.max(0, ccx - reach), colHi = Math.min(HCOLS - 1, ccx + reach);
      // a pair is never pushed when its centres are this far apart: no branch below separates beyond both reaches
      // (or A's hold-formation spacing). Units that could be that close now sit in hash cells within that reach + D
      // of `a`, so only those cells are walked; the window is recomputed whenever `a` or D moves.
      const qi = sq[i], holdCap = A.hold ? Math.min(2.9, A.sepMin) * 0.95 : 0;
      const far0 = Math.max(qi + this.maxSepQ, holdCap) * (1 + 1e-9) + 1e-6;
      let far = far0 + D;
      let wy1 = Math.min(rowHi, clamp(Math.floor((py[i] + far) / CELL), 0, HROWS - 1));
      let wx0 = Math.max(colLo, clamp(Math.floor((px[i] - far) / CELL), 0, HCOLS - 1));
      let wx1 = Math.min(colHi, clamp(Math.floor((px[i] + far) / CELL), 0, HCOLS - 1));
      for (let cy = Math.max(rowLo, clamp(Math.floor((py[i] - far) / CELL), 0, HROWS - 1)); cy <= wy1; cy++) {
        for (let cx = wx0; cx <= wx1; cx++) {
          const c = cy * HCOLS + cx;
          if (head[c] < 0 || tail[c] <= i) continue;
          for (let j = head[c]; j >= 0; j = next[j]) {
            if (j <= i) continue;
            const qx = px[j] - px[i], qy = py[j] - py[i], ql = Math.max(qi + sq[j], holdCap) * (1 + 1e-9);
            if (qx * qx + qy * qy >= ql * ql) continue;
            const b = units[j];
            if (!b.alive || b.flying !== a.flying) continue;
            const B = ints[j];
            if (B.leapT >= 0) continue;
            if (A.strafe || B.strafe) continue; // jets pass through each other
            let dx = b.x - a.x, dy = b.y - a.y;
            let rr = A.radius + B.radius;
            let d2 = dx * dx + dy * dy;
            if (A.elong || B.elong) {
              // capsule vs capsule: separate along the closest points of the two core segments
              const bb = A.bound + B.bound;
              if (d2 >= bb * bb) continue;
              const cd = this.capsuleSep(A, B, a, b);
              if (cd.d >= A.capR + B.capR) continue;
              rr = A.capR + B.capR;
              dx = cd.nx * cd.d; dy = cd.ny * cd.d; d2 = cd.d * cd.d;
            } else {
              if (A.hold && B.hold && A.block === B.block) rr = Math.max(rr, Math.min(2.9, A.sepMin) * 0.95);
              if (d2 >= rr * rr) continue;
            }
            let d = Math.sqrt(d2);
            if (d < 1e-6) {
              // deterministic nudge
              const ang = ((i * 7 + j * 13) % 16) * (TAU / 16);
              dx = Math.cos(ang); dy = Math.sin(ang); d = 1;
            } else { dx /= d; dy /= d; }
            const overlap = (rr - d) * 0.5;
            const tm = A.mass + B.mass;
            const ka = B.mass / tm, kb = A.mass / tm;
            a.x -= dx * overlap * ka; a.y -= dy * overlap * ka;
            b.x += dx * overlap * kb; b.y += dy * overlap * kb;
            px[i] = a.x; py[i] = a.y; px[j] = b.x; py[j] = b.y;
            D = Math.max(D, Math.abs(a.x - hx[i]), Math.abs(a.y - hy[i]), Math.abs(b.x - hx[j]), Math.abs(b.y - hy[j]));
            far = far0 + D;
            wy1 = Math.min(rowHi, clamp(Math.floor((py[i] + far) / CELL), 0, HROWS - 1));
            wx0 = Math.max(colLo, clamp(Math.floor((px[i] - far) / CELL), 0, HCOLS - 1));
            wx1 = Math.min(colHi, clamp(Math.floor((px[i] + far) / CELL), 0, HCOLS - 1));
            if (a.side !== b.side && !a.flying) {
              if (A.crush && A.crushCd <= 0 && b.stats.size < a.stats.size) {
                A.crushCd = CRUSH_EVERY;
                this.dmgSrc = a.id;
                this.damage(b, CRUSH_DMG * a.stats.size, 0.5, 1, a.side, 'crush', b.x, b.y);
                this.dmgSrc = -1;
              } else if (B.crush && B.crushCd <= 0 && a.stats.size < b.stats.size) {
                B.crushCd = CRUSH_EVERY;
                this.dmgSrc = b.id;
                this.damage(a, CRUSH_DMG * b.stats.size, 0.5, 1, b.side, 'crush', a.x, a.y);
                this.dmgSrc = -1;
              }
            }
          }
        }
      }
    }
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u.alive) continue;
      const r = ints[i].radius;
      u.x = clamp(u.x, r, FIELD_W - r);
      u.y = clamp(u.y, r, FIELD_H - r);
    }
  }

  // ---------------------------------------------------------------- end

  private sideValue(side: Side): number {
    let v = 0;
    for (const u of this.units) if (u.alive && u.side === side) v += u.stats.unitCost * (u.hp / u.maxHp);
    return v;
  }

  /** Can any living unit of `side` still hurt a living enemy? (Static units only count with an enemy in range.) */
  private sideCanHit(side: Side): boolean {
    let enemyG = false, enemyA = false;
    for (const u of this.units) if (u.alive && u.side !== side) { if (u.flying) enemyA = true; else enemyG = true; }
    for (let i = 0; i < this.ints.length; i++) {
      const I = this.ints[i];
      const u = I.u;
      if (!u.alive || u.side !== side) continue;
      if (!((I.canHitA && enemyA) || (I.canHitG && enemyG) || (I.crush && enemyG))) continue;
      if (!I.isStatic) return true;
      for (const w of I.wpns) if (w && w.heal <= 0 && this.findTarget(u, w) >= 0) return true;
    }
    return false;
  }

  /** Damage this block (all its squad units) has dealt to enemies so far, shields included. */
  blockDamage(side: Side, uid: number): number {
    return this.blockDmg.get(side * 1e6 + uid) ?? 0;
  }

  private finish(winner: Side | -1): void {
    this.done = true;
    this.winner = winner;
    this.events.push({ t: 'end', winner });
  }

  private checkEnd(): void {
    let a0 = 0, a1 = 0;
    for (const u of this.units) if (u.alive) { if (u.side === 0) a0++; else a1++; }
    if (a0 === 0 || a1 === 0) {
      this.finish(a0 === 0 && a1 === 0 ? -1 : a0 === 0 ? 1 : 0);
      return;
    }
    const stalled = this.tick % STALL_CHECK_EVERY === 0 && this.projs.length === 0 && !this.sideCanHit(0) && !this.sideCanHit(1);
    if (this.tick >= MAX_TICKS || stalled || this.tick - this.activeTick > QUIET_END) {
      const v0 = this.sideValue(0), v1 = this.sideValue(1);
      this.finish(v0 > v1 * 1.1 ? 0 : v1 > v0 * 1.1 ? 1 : -1);
    }
  }

  summary(): BattleSummary {
    const survivors: [number[], number[]] = [[], []];
    const total: Map<number, number>[] = [new Map(), new Map()];
    const alive: Map<number, number>[] = [new Map(), new Map()];
    for (const u of this.units) {
      total[u.side].set(u.uid, (total[u.side].get(u.uid) ?? 0) + 1);
      if (u.alive) {
        if (!alive[u.side].has(u.uid)) survivors[u.side].push(u.uid);
        alive[u.side].set(u.uid, (alive[u.side].get(u.uid) ?? 0) + 1);
      }
    }
    const aliveFraction: [Record<number, number>, Record<number, number>] = [{}, {}];
    for (const sd of [0, 1] as const) for (const uid of survivors[sd]) aliveFraction[sd][uid] = alive[sd].get(uid)! / total[sd].get(uid)!;
    return {
      aliveFraction,
      winner: this.winner, ticks: this.tick, survivors,
      damageDealt: [Math.round(this.damageDealt[0]), Math.round(this.damageDealt[1])],
    };
  }
}

/** Run to completion headlessly. */
export function runBattle(input: BattleInput): BattleSummary {
  const b = new Battle(input);
  while (!b.done) b.step();
  return b.summary();
}
