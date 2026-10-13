// Deterministic battle simulation. Fixed tick (DT), seeded RNG only, stable iteration order.
//
// Layout: `units` (public SimUnit) is indexed by SimUnit.id; `ints` holds the matching internal state.
// Each tick: weapons (targeting, turrets, firing) -> movement -> spatial hash -> separation/crush ->
// auras -> projectiles -> bookkeeping -> end check.

import { MODULE_BY_ID } from '../parts.ts';
import { computeStats, isValidDesign, levelMult, turretTurnRate, weaponDps } from '../stats.ts';
import { FIELD_H, FIELD_W, forwardY, normSpacing, placementUnitCenters } from '../grid.ts';
import { makeRng, type Rng } from '../rng.ts';
import { CLOAK_REVEAL, START_DELAYS, STANCES, TARGET_PRIORITIES } from '../types.ts';
import type { Design, ModuleDef, Side, Stance, TargetPriority } from '../types.ts';
import { DT, MAX_TICKS, TICK_RATE } from './types.ts';
import type { BattleEvent, BattleInput, BattleSummary, MountState, SimProjectile, SimUnit } from './types.ts';

// ---- tuning ----
/** a turret only fires once its barrel is on target (~3.4°) — bursts included */
const AIM_TOLERANCE = 0.06; // rad
const RETARGET_EVERY = 0.3; // s
const GOAL_EVERY = 0.4; // s
const BURST_GAP = 0.1; // s
const SHIELD_DELAY = 3; // s
const SHIELD_REGEN = 0.05; // fraction of max per s
const EVADE_CHANCE = 0.2;
const MIN_DMG_FRAC = 0.15;
const SPLASH_EDGE = 0.3;
const CHAIN_JUMP = 2.5; // cells
const CHAIN_FALLOFF = 0.8;
const LEAP_COOLDOWN = 6;
const LEAP_TIME = 0.8;
const AURA_RANGE = 3;
const AURA_RATE = 0.012; // fraction of maxHp per s
const AURA_EVERY = 0.5;
const HEAL_EVENT_EVERY = 0.3;
const CRUSH_EVERY = 0.3;
const BOMB_ALT = 1.5; // cells: height bombs start falling from
const BOMB_FALL = 0.5; // seconds a bomb takes to land
const CRUSH_DMG = 14; // per size of the crusher, per contact pulse
const RANGE_KEEP = 1.08; // hysteresis: a held target stays valid out to range * this
const STALL_CHECK_EVERY = 20; // ticks
const MAX_STUN = 4;
const MAX_SLOW = 0.6;
const SLOW_DECAY = 0.3; // per s (0.6 fully decays over 2s)
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
const ENGAGE_SHARE = 0.34; // fraction of relevant dps that must be in range before a ground unit halts

// spatial hash
const THREAT_MEMORY = 6 * TICK_RATE; // ticks a recorded attacker stays 'the threat'
const CELL = 3;
const HCOLS = Math.ceil(FIELD_W / CELL);
const HROWS = Math.ceil(FIELD_H / CELL);
const MAX_RADIUS = 3.0; // bounding radius of the largest hull (long axis * 0.45 for non-square footprints)

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
  /** bounding radius (centre to farthest point) */
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
  /** weapon range the kiting distances are measured from */
  kiteRange: number;
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
}

interface Smoke {
  x: number;
  y: number;
  r: number;
  t: number;
}

/** Range a kiting unit keeps to: the chosen mount's (non-melee, armed) weapon, else the longest range. */
function kiteRangeOf(wpns: (Wpn | null)[], mount: number, fallback: number): number {
  const w = Number.isInteger(mount) && mount >= 0 ? wpns[mount] : null;
  return w && w.heal <= 0 && !w.melee && w.range > 0 ? w.range : fallback;
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
  private focusStamp = 0;
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
  private head: Int32Array = new Int32Array(HCOLS * HROWS);
  private next: Int32Array = new Int32Array(0);
  private scratch: Int32Array = new Int32Array(0);
  /** ascending unit indexes alive at the last hash rebuild, per side (cheap enemy scans) */
  private liveIdx: number[][] = [[], []];
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
        for (const c of cs) {
          this.blockUnits[block].push(this.units.length);
          this.addUnit(s, p.uid, d, p.level, c.x, c.y, { block, prio, hold: !!p.hold && cs.length > 1, kite: !!p.kite, kiteMount: typeof p.kiteMount === 'number' ? p.kiteMount : -1, focus: !!p.focus, stance, delay, retreat: !!p.retreat, offx: c.x - mx, offy: c.y - my, sepMin: sp + 1 });
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
    for (const I of this.ints) {
      if (I.cloak) this.hasCloak = true;
      if (I.detect > 0) this.detectors.push(I);
      if (I.domeAmt > 0) this.domes.push(I);
      if (I.uplinkBonus > 0) this.uplinks.push(I);
      if (I.jammer > 0) this.jammers.push(I);
      if (I.pdRange > 0) this.pds.push(I);
    }
    this.next = new Int32Array(n);
    this.scratch = new Int32Array(Math.max(16, n));
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
        spread: (def.spread ?? 0) * (stats.spreadMult ?? 1),
        traverse: turretTurnRate(def),
        dps: isWeapon ? Math.max(1e-3, weaponDps(def)) : 0,
        melee, cls: damageClass(def),
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
      odometer: 0, leap: 0, mounts, hitFlash: 0, stun: 0, slow: 0, burning: 0, disarm: 0,
      cloaked: cloak !== null, reactive, auraShield: 0, maxAuraShield: 0,
    };
    this.units.push(u);
    this.ints.push({
      u, wpns, radius: 0.45 * Math.sqrt(stats.fw * stats.fh), elong: stats.fw !== stats.fh,
      hl: 0.45 * stats.fh, hw: 0.45 * stats.fw, capR: 0.45 * Math.min(stats.fw, stats.fh), capS: 0.45 * Math.abs(stats.fh - stats.fw),
      capAcross: stats.fw > stats.fh, bound: 0.45 * Math.max(stats.fw, stats.fh), mass: stats.isStatic ? 1e6 : stats.size * stats.size * (cfg.stance === 'holdPos' ? HOLDPOS_MASS : 1), dmgMult: lm,
      speed: stats.speed, turn: stats.turn,
      fireOnMove: traits.includes('fireOnMove'), strafe: traits.includes('strafe'), evasive: traits.includes('evasive'),
      canLeap: traits.includes('leap'), crush: traits.includes('crush'), aura: traits.includes('repairAura'),
      isStatic: stats.isStatic, hasWeapon, hasHeal, canHitG, canHitA, maxRange, minWeaponRange,
      goal: -1, goalTimer: (id * 0.053) % GOAL_EVERY, px: c.x, py: c.y, vx: 0, vy: 0, sinceDamage: 99,
      leapCd: 1 + this.rng() * 2, leapT: -1, lx0: 0, ly0: 0, lx1: 0, ly1: 0, strafeT: 0, crushCd: 0,
      burnDps: 0, burnSide: side, burnSrc: -1, burnModule: '', burnTick: 0, kbx: 0, kby: 0,
      cloak, detect, sinceFire: 99, domeR, domeAmt, regen, fireRate, reloadMult: Math.max(0.2, 1 - reloadBonus),
      uplinkR, uplinkBonus, rateAura: 0, pdRange, pdCooldown, pdCd: 0, pdModule, jammer, jammed: false,
      smokeR, smokeDur, smokeUsed: false, smoked: false, energyResist: Math.min(0.8, energyResist), hardened,
      blastDmg: blastDmg * lm, blastR, blastModule, blocker: !hasWeapon && !hasHeal,
      meleeOnly: hasWeapon && wpns.every((w) => !w || w.heal > 0 || w.melee), avoidSide: 0, avoidT: 0, stuckT: 0,
      prio: cfg.prio, hold: cfg.hold, kite: cfg.kite && !stats.isStatic, kiteRange: kiteRangeOf(wpns, cfg.kiteMount, maxRange), focus: cfg.focus, stance: cfg.stance,
      delayTicks: Math.round(cfg.delay * TICK_RATE), retreatOn: cfg.retreat && !stats.isStatic, retreating: false, flankDone: false,
      escortBlock: -1, escUnit: -1, escThreat: -1, isSupport, valueVal: stats.unitCost * lm, swarmKey: stats.size * 1e5 + stats.unitCost,
      block: cfg.block, offx: cfg.offx, offy: cfg.offy, sepMin: cfg.sepMin,
      dpsVal: stats.dps * lm, mainW: wpns.reduce<Wpn | null>((b, w) => (w && w.heal <= 0 && w.range > 0 && (!b || w.range > b.range) ? w : b), null),
    });
    if (cfg.hold) this.anyHold = true;
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
      if (u.stun > 0) u.stun = Math.max(0, u.stun - DT);
      if (u.disarm > 0) u.disarm = Math.max(0, u.disarm - DT);
      if (u.slow > 0) u.slow = Math.max(0, u.slow - SLOW_DECAY * DT);
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

    // goals + weapons
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

    // movement
    if (this.anyHold) this.computeAnchors();
    for (let i = 0; i < n; i++) {
      const I = ints[i];
      if (I.u.alive) this.move(I);
    }

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
    }

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
          const dx = o.x - u.x, dy = o.y - u.y, r = D.detect + I.radius;
          if (dx * dx + dy * dy <= r * r) { visible = true; break; }
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

  /** Shield domes, command uplinks and jammers (refreshed every AURA_EVERY). */
  private supportAuras(): void {
    const units = this.units, ints = this.ints;
    const first = this.tick === 0;
    for (const I of ints) { I.rateAura = 0; I.jammed = false; if (this.domes.length) I.u.maxAuraShield = 0; }
    for (const D of this.domes) {
      const d = D.u;
      if (!d.alive) continue;
      const cnt = this.gather(d.x, d.y, D.domeR + MAX_RADIUS);
      for (let q = 0; q < cnt; q++) {
        const o = units[this.scratch[q]];
        if (!o.alive || o.side !== d.side || o === d) continue;
        if (Math.hypot(o.x - d.x, o.y - d.y) <= D.domeR) o.maxAuraShield = Math.max(o.maxAuraShield, D.domeAmt);
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
      const cnt = this.gather(l.x, l.y, L.uplinkR + MAX_RADIUS);
      for (let q = 0; q < cnt; q++) {
        const j = this.scratch[q];
        const o = units[j];
        if (!o.alive || o.side !== l.side || o === l) continue;
        if (Math.hypot(o.x - l.x, o.y - l.y) <= L.uplinkR) ints[j].rateAura = Math.max(ints[j].rateAura, L.uplinkBonus);
      }
    }
    for (const J of this.jammers) {
      const jm = J.u;
      if (!jm.alive) continue;
      const cnt = this.gather(jm.x, jm.y, J.jammer + MAX_RADIUS);
      for (let q = 0; q < cnt; q++) {
        const j = this.scratch[q];
        const o = units[j];
        if (!o.alive || o.side !== jm.side) continue;
        if (Math.hypot(o.x - jm.x, o.y - jm.y) <= J.jammer) ints[j].jammed = true;
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
      let best: Proj | null = null, bestD = I.pdRange * I.pdRange;
      for (const p of this.projs) {
        if (p.dead || p.side === u.side) continue;
        const k = p.kind;
        if (k !== 'rocket' && k !== 'missile' && k !== 'shell' && k !== 'arc' && k !== 'orb') continue;
        const dx = p.x - u.x, dy = p.y - u.y, d = dx * dx + dy * dy;
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
      this.splash(u.x, u.y, I.blastR, I.blastDmg, 0.3, 1, u.side, false, I.blastModule, -1, true);
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
    const foes = this.liveIdx[u.side === 0 ? 1 : 0];
    for (let k = 0; k < foes.length; k++) {
      const j = foes[k];
      const o = units[j];
      if (!o.alive) continue;
      if (o.flying ? !I.canHitA : !I.canHitG) continue;
      if (!this.visible(u, o)) continue;
      const dx = o.x - u.x, dy = o.y - u.y, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = j; }
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

  private inRange(u: SimUnit, w: Wpn, t: SimUnit, mult: number): number {
    const dx = t.x - u.x, dy = t.y - u.y;
    const T = this.ints[t.id], U = this.ints[u.id];
    const lim = w.range * mult + T.bound + (w.melee ? U.bound : 0);
    if (dx * dx + dy * dy > lim * lim) return -1;
    const d = Math.sqrt(dx * dx + dy * dy);
    // edge-to-edge: nearest point of the target's (oriented) footprint, minus our own reach toward it for melee
    let edge = T.elong ? this.boxDist(T, u.x, u.y) : d - T.radius;
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
    if (prio === 'threat') {
      const a = this.blockAtk[I.block];
      if (a >= 0 && this.tick - this.blockAtkT[I.block] <= THREAT_MEMORY) {
        const o = units[a];
        if (o.alive && o.side !== u.side && this.canHit(w, o) && this.inRange(u, w, o, mult) >= 0 && this.visible(u, o)) return a;
      }
    }
    // focus: enemies that allies nearby (and we ourselves) are already shooting are preferred
    let stamp = 0;
    if (I.focus) {
      stamp = ++this.focusStamp;
      const cnt = this.gather(u.x, u.y, FOCUS_RADIUS + MAX_RADIUS);
      for (let q = 0; q < cnt; q++) {
        const a = units[this.scratch[q]];
        if (!a.alive || a.side !== u.side) continue;
        if (a !== u && Math.hypot(a.x - u.x, a.y - u.y) > FOCUS_RADIUS) continue;
        for (const m of a.mounts) if (m.target >= 0) this.focusMark[m.target] = stamp;
      }
    }
    let best = -1, bestS = Infinity, bestD = Infinity;
    let fBest = -1, fS = Infinity, fD = Infinity;
    // short-range weapons only look at the spatial hash neighbourhood (hash is at most one step stale);
    // ties are broken by lowest index so the result does not depend on iteration order
    let src: ArrayLike<number> = this.liveIdx[u.side === 0 ? 1 : 0];
    let cnt = src.length;
    const reach = w.range * mult + MAX_RADIUS + (w.melee ? I.bound : 0) + 1.5;
    if (reach <= 12) { cnt = this.gather(u.x, u.y, reach); src = this.scratch; }
    for (let k = 0; k < cnt; k++) {
      const j = src[k];
      const o = units[j];
      if (!o.alive || o.side === u.side || !this.canHit(w, o)) continue;
      const d = this.inRange(u, w, o, mult);
      if (d < 0 || !this.visible(u, o)) continue;
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
      if (stamp && this.focusMark[j] === stamp && (sc < fS - 1e-9 || (Math.abs(sc - fS) <= 1e-9 && (d < fD || (d === fD && j < fBest))))) { fS = sc; fD = d; fBest = j; }
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
    const r2 = w.range * w.range;
    for (let j = 0; j < units.length; j++) {
      const o = units[j];
      if (!o.alive || o.side !== u.side || o === u) continue;
      const ratio = o.hp / o.maxHp;
      if (ratio >= bestR) continue;
      const dx = o.x - u.x, dy = o.y - u.y;
      if (dx * dx + dy * dy > r2) continue;
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
          const dc = Math.hypot(c.x - u.x, c.y - u.y);
          if (dc < curD * 0.6) m.target = cand;
        }
      }

      const t = m.target >= 0 ? units[m.target] : null;
      let want = u.angle;
      let ax = 0, ay = 0;
      if (t) {
        w.preaim = -1;
        const p = this.aimPoint(I, w, t);
        ax = p.x; ay = p.y;
        want = Math.atan2(ay - u.y, ax - u.x);
      } else {
        // nothing in range: swing toward whatever is closing in (aim only, never fires)
        if (refreshed) w.preaim = this.pickTarget(I, w, PREAIM_MULT);
        const pa = w.preaim >= 0 ? units[w.preaim] : null;
        if (pa && pa.alive && this.visible(u, pa)) want = Math.atan2(pa.y - u.y, pa.x - u.x);
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
        w.aimX = ax; w.aimY = ay;
        m.cooldown = Math.max(m.cooldown, -DT) + (w.def.cooldown ?? 1); // carry sub-tick remainder
        if (m.ammo !== undefined) {
          m.ammo--;
          if (m.ammo <= 0) { m.ammo = 0; m.reloading = true; m.cooldown = Math.max(m.cooldown, (w.def.reload ?? 0) * I.reloadMult); }
        }
        const burst = w.def.burst ?? 1;
        if (burst > 1) { w.burstLeft = burst - 1; w.burstTimer = BURST_GAP; }
        this.fire(I, mi, w, t, ax, ay);
      }
    }
  }

  private aimScratch = { x: 0, y: 0 };
  /** Where a weapon aims: the target's current position. Unguided shots are not led, so movers dodge slow rounds. */
  private aimPoint(I: Internal, w: Wpn, t: SimUnit): { x: number; y: number } {
    const p = this.aimScratch;
    p.x = t.x; p.y = t.y;
    void I; void w;
    return p;
  }

  // ---------------------------------------------------------------- firing

  private fire(I: Internal, mi: number, w: Wpn, t: SimUnit | null, ax: number, ay: number): void {
    this.curSrc = this.dmgSrc = I.u.id;
    this.fireImpl(I, mi, w, t, ax, ay);
    this.curSrc = this.dmgSrc = -1;
  }

  private fireImpl(I: Internal, mi: number, w: Wpn, t: SimUnit | null, ax: number, ay: number): void {
    const u = I.u;
    const def = w.def;
    const m = u.mounts[mi];
    m.flash = 1;
    I.sinceFire = 0;
    const aim = Math.atan2(ay - u.y, ax - u.x);
    const mx = u.x + Math.cos(aim) * I.radius * 0.8;
    const my = u.y + Math.sin(aim) * I.radius * 0.8;
    this.events.push({ t: 'fire', unit: u.id, mount: mi, moduleId: def.id, x: mx, y: my, angle: aim });
    const dist0 = Math.hypot(ax - u.x, ay - u.y);
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
    for (let k = 0; k < pellets; k++) {
      let tx = ax, ty = ay;
      if (kind === 'flame') {
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
      const ang = Math.atan2(ty - oy, tx - ox);
      const pierce = !!def.pierce;
      const p: Proj = {
        id: this.nextProjId++, side: u.side, moduleId: def.id, kind: kind as Proj['kind'], x: ox, y: oy, z: bomb ? BOMB_ALT : 0, z0: bomb ? BOMB_ALT : 0, src: u.id, angle: ang, progress: 0,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, speed: bomb ? total / BOMB_FALL : speed, dmg: raw, ap, splash: def.splash ?? 0, airBonus, air,
        target: kind === 'missile' && t ? t.id : -1, tx, ty, sx: ox, sy: oy, total, traveled: 0,
        maxDist: kind === 'flame' ? total : kind === 'missile' ? w.range * 1.8 : pierce ? w.range + 1 : total + 2,
        ignore: -1, arcH: kind === 'arc' && !bomb ? 1 + total * 0.22 : 0, dead: false,
        pierce, hits: [], fx, fxMult: lm, cls, mount: mi,
      };
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
    const len = w.range;
    const ex = mx + c * len, ey = my + s * len;
    const units = this.units;
    for (let j = 0; j < units.length; j++) {
      const o = units[j];
      if (!o.alive || o.side === u.side || !this.canHit(w, o)) continue;
      const dx = o.x - mx, dy = o.y - my;
      const along = dx * c + dy * s;
      if (along < -0.3 || along > len + 0.3) continue;
      const perp = Math.abs(-dx * s + dy * c);
      if (perp <= this.ints[j].bound + 0.15) this.damage(o, raw, ap, airBonus, u.side, w.def.id, o.x, o.y, fx, lm, mx, my, w.cls);
    }
    this.events.push({ t: 'beam', moduleId: w.def.id, x1: mx, y1: my, x2: clamp(ex, -2, FIELD_W + 2), y2: clamp(ey, -2, FIELD_H + 2), side: u.side, unit: u.id, mount: mi });
  }

  private updateHeal(I: Internal, w: Wpn, m: MountState): void {
    const u = I.u;
    w.retarget -= DT;
    let t = m.target >= 0 ? this.units[m.target] : null;
    if (t && (!t.alive || t.hp >= t.maxHp || Math.hypot(t.x - u.x, t.y - u.y) > w.range * RANGE_KEEP)) { t = null; m.target = -1; }
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
    m.angle = turnToward(m.angle, Math.atan2(t.y - u.y, t.x - u.x), w.traverse * DT);
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
      this.events.push({ t: 'beam', moduleId: w.def.id, x1: u.x, y1: u.y, x2: target.x, y2: target.y, side: u.side, unit: u.id, mount: u.mounts.indexOf(m) });
    }
    w.healAcc = 0;
    void m;
  }

  private applyAura(I: Internal): void {
    const u = I.u;
    const cnt = this.gather(u.x, u.y, AURA_RANGE + MAX_RADIUS);
    for (let q = 0; q < cnt; q++) {
      const o = this.units[this.scratch[q]];
      if (!o.alive || o.side !== u.side || o === u || o.hp >= o.maxHp) continue;
      if (Math.hypot(o.x - u.x, o.y - u.y) > AURA_RANGE) continue;
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
    if (fx && !T.hardened) {
      if (fx.disarm) t.disarm = Math.min(MAX_STUN, t.disarm + fx.disarm);
      if (fx.impulse && !t.flying && !t.stats.isStatic && !Number.isNaN(ox)) {
        const mag = fx.impulse * (t.stats.size === 1 ? 1 : t.stats.size === 2 ? 0.5 : 0.25);
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
      if (fx.stun) t.stun = Math.min(MAX_STUN, t.stun + fx.stun);
      if (fx.slow) t.slow = Math.min(MAX_SLOW, t.slow + fx.slow);
      if (fx.burn) {
        const dps = fx.burn.dps * fxMult;
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
      this.smokes.push({ x: t.x, y: t.y, r: T.smokeR, t: T.smokeDur });
      this.events.push({ t: 'smoke', x: t.x, y: t.y, radius: T.smokeR, duration: T.smokeDur });
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
    for (let i = 0; i < ps.length; i++) if (!ps[i].dead) ps[wi++] = ps[i];
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
      const r = this.ints[id].radius;
      let t = len2 > 0 ? ((o.x - ox) * sx + (o.y - oy) * sy) / len2 : 0;
      t = clamp(t, 0, 1);
      const qx = ox + sx * t - o.x, qy = oy + sy * t - o.y;
      if (qx * qx + qy * qy <= r * r && (t < bestT || (t === bestT && id < best))) { bestT = t; best = id; }
    }
    return best;
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

    // Engaged = weapons holding targets make up a meaningful share of the firepower that could hit our goal
    // (so a long-range gun alone doesn't park a brawler out of reach of its main armament).
    let engagedDps = 0, relevantDps = 0;
    let targetAngle = NaN;
    for (let mi = 0; mi < I.wpns.length; mi++) {
      const w = I.wpns[mi];
      if (!w || w.heal > 0) continue;
      const tg = u.mounts[mi].target;
      if (!goal || this.canHit(w, goal)) relevantDps += w.dps;
      if (tg >= 0) {
        engagedDps += w.dps;
        if (Number.isNaN(targetAngle)) targetAngle = Math.atan2(this.units[tg].y - u.y, this.units[tg].x - u.x);
      }
    }
    const engaged = engagedDps > 0 && engagedDps >= ENGAGE_SHARE * relevantDps;

    let gx = u.x, gy = u.y, wantMove = false, stopDist = 0;
    const fwd = forwardY(u.side);
    if (goal) {
      const dx = goal.x - u.x, dy = goal.y - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
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
      } else if (kiteOn && !I.meleeOnly && this.edgeC(this.ints[goal.id], u.x, u.y) < 0.7 * I.kiteRange) {
        // kiting: an enemy got inside 70% of our range, back away (non-fireOnMove units pause to shoot first)
        if (!I.fireOnMove && I.wpns.some((w, wi) => w && w.heal <= 0 && u.mounts[wi].cooldown <= 0.15 && u.mounts[wi].target >= 0)) return;
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
        const engageR = I.maxRange;
        const lw = clamp(1 - (d - engageR - 2) / 8, 0.3, 1);
        let hx = dx, hy = dy;
        if (I.hold && this.anchorN[I.block] > 0) {
          // formation: aim at our slot around the goal, pulled toward our slot around the squad's anchor
          hx += I.offx + 0.6 * (this.anchorX[I.block] + I.offx - u.x);
          hy += I.offy + 0.6 * (this.anchorY[I.block] + I.offy - u.y);
        }
        gx = u.x + hx * lw;
        gy = u.y + hy;
        stopDist = 0;
        if (charge) wantMove = I.meleeOnly || this.edgeC(this.ints[goal.id], u.x, u.y) > CHARGE_GUN_FRAC * engageR;
        else if (kiteOn && !I.meleeOnly && this.edgeC(this.ints[goal.id], u.x, u.y) <= 0.9 * I.kiteRange) wantMove = false;
        else if (engaged && (!I.fireOnMove || I.meleeOnly)) wantMove = false;
        else if (I.meleeOnly) wantMove = true; // brawlers charge all the way into contact
        else if (I.fireOnMove && engageR > 2.5 && this.edgeC(this.ints[goal.id], u.x, u.y) <= Math.max(1.2, engageR * 0.7)) wantMove = false; // bombers (tiny range) fly right over the target
        else wantMove = true;
        if (!wantMove) {
          // face the fight while holding
          if (!u.flying && !Number.isNaN(targetAngle)) u.angle = turnToward(u.angle, targetAngle, I.turn * DT * 0.5);
          return;
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

  /** Turn the body toward whatever the first engaged weapon targets (ground units only). */
  private faceTarget(I: Internal): void {
    const u = I.u;
    if (u.flying || u.stun > 0) return;
    for (const m of u.mounts) {
      if (m.target < 0) continue;
      const t = this.units[m.target];
      u.angle = turnToward(u.angle, Math.atan2(t.y - u.y, t.x - u.x), I.turn * DT * 0.5);
      return;
    }
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
    const cnt = this.gather(u.x, u.y, look);
    let best = Infinity, bestPerp = 0, bestClear = 1;
    const mySpeed = I.speed * 0.5;
    for (let q = 0; q < cnt; q++) {
      const j = this.scratch[q];
      if (j === u.id || j === goalId) continue;
      const o = this.units[j];
      if (!o.alive || o.flying !== u.flying) continue;
      const O = this.ints[j];
      if (O.leapT >= 0) continue;
      // enemies are only obstacles when they can't be pushed (emplacements)
      if (o.side !== u.side && !O.isStatic) continue;
      const rx = o.x - u.x, ry = o.y - u.y;
      const along = rx * dirX + ry * dirY;
      if (along <= 0) continue;
      const clear = I.radius + O.radius + 0.1;
      if (along > clear + 0.8) continue;
      const perp = rx * -dirY + ry * dirX; // >0: obstacle on our left (in +perp direction)
      if (Math.abs(perp) >= clear) continue;
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
    const head = this.head;
    head.fill(-1);
    const units = this.units;
    const l0 = this.liveIdx[0], l1 = this.liveIdx[1];
    l0.length = 0; l1.length = 0;
    for (let i = 0; i < units.length; i++) if (units[i].alive) (units[i].side === 0 ? l0 : l1).push(i);
    for (let i = units.length - 1; i >= 0; i--) {
      const u = units[i];
      if (!u.alive) continue;
      const c = this.cellOf(u.x, u.y);
      this.next[i] = head[c];
      head[c] = i;
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
    const head = this.head, next = this.next;
    for (let i = 0; i < units.length; i++) {
      const a = units[i];
      if (!a.alive) continue;
      const A = ints[i];
      if (A.leapT >= 0) continue;
      const ccx = clamp(Math.floor(a.x / CELL), 0, HCOLS - 1), ccy = clamp(Math.floor(a.y / CELL), 0, HROWS - 1);
      const reach = Math.max(1, Math.ceil((A.bound + MAX_RADIUS) / CELL));
      for (let cy = Math.max(0, ccy - reach); cy <= Math.min(HROWS - 1, ccy + reach); cy++) {
        for (let cx = Math.max(0, ccx - reach); cx <= Math.min(HCOLS - 1, ccx + reach); cx++) {
          for (let j = head[cy * HCOLS + cx]; j >= 0; j = next[j]) {
            if (j <= i) continue;
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
    if (this.tick >= MAX_TICKS || stalled) {
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
