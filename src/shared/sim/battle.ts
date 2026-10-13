// Deterministic battle simulation. Fixed tick (DT), seeded RNG only, stable iteration order.
//
// Layout: `units` (public SimUnit) is indexed by SimUnit.id; `ints` holds the matching internal state.
// Each tick: weapons (targeting, turrets, firing) -> movement -> spatial hash -> separation/crush ->
// auras -> projectiles -> bookkeeping -> end check.

import { MODULE_BY_ID } from '../parts.ts';
import { computeStats, isValidDesign, levelMult, weaponDps } from '../stats.ts';
import { FIELD_H, FIELD_W, forwardY, normSpacing, placementUnitCenters } from '../grid.ts';
import { makeRng, type Rng } from '../rng.ts';
import { CLOAK_REVEAL } from '../types.ts';
import type { Design, ModuleDef, Side } from '../types.ts';
import { DT, MAX_TICKS } from './types.ts';
import type { BattleEvent, BattleInput, BattleSummary, MountState, SimProjectile, SimUnit } from './types.ts';

// ---- tuning ----
const TURRET_TURN = 6; // rad/s
const AIM_TOLERANCE = 0.2; // rad
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
const ENGAGE_SHARE = 0.34; // fraction of relevant dps that must be in range before a ground unit halts

// spatial hash
const CELL = 3;
const HCOLS = Math.ceil(FIELD_W / CELL);
const HROWS = Math.ceil(FIELD_H / CELL);
const MAX_RADIUS = 1.4;

const TAU = Math.PI * 2;
function angDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}
function turnToward(a: number, b: number, max: number): number {
  const d = angDiff(a, b);
  if (d > max) return a + max;
  if (d < -max) return a - max;
  return b;
}
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

interface Wpn {
  def: ModuleDef;
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
}

interface Internal {
  u: SimUnit;
  wpns: (Wpn | null)[];
  radius: number;
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

/** Damage class of a weapon for reactive armor / energy resist. */
function damageClass(def: ModuleDef): number {
  const k = def.projectile;
  if (k === 'shell' || k === 'rocket' || k === 'missile' || k === 'arc') return CLS_EXPLOSIVE;
  if (k === 'orb') return def.category === 'energy' ? CLS_ENERGY | CLS_EXPLOSIVE : CLS_EXPLOSIVE;
  if (k === 'beam' || k === 'lightning' || k === 'rail' || k === 'flame') return CLS_ENERGY;
  return 0;
}

interface Proj extends SimProjectile {
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
  private ints: Internal[] = [];
  private projs: Proj[] = [];
  private nextProjId = 1;
  private damageDealt: [number, number] = [0, 0];
  private auraTimer = 0;
  private head: Int32Array = new Int32Array(HCOLS * HROWS);
  private next: Int32Array = new Int32Array(0);
  private scratch: Int32Array = new Int32Array(0);
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
        for (const c of placementUnitCenters(s, { x: p.x, y: p.y, spacing: normSpacing(size, p.spacing) }, size)) this.addUnit(s, p.uid, d, p.level, c.x, c.y);
      }
    }
    const n = this.units.length;
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

  private addUnit(side: Side, uid: number, design: Design, level: number, cx: number, cy: number): void {
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
        burstLeft: 0, burstTimer: 0, retarget: (id * 0.037) % RETARGET_EVERY, aimX: 0, aimY: 0, healAcc: 0, healTimer: 0,
        spread: (def.spread ?? 0) * (stats.spreadMult ?? 1),
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
      u, wpns, radius: stats.size * 0.45, mass: stats.isStatic ? 1e6 : stats.size * stats.size, dmgMult: lm,
      speed: stats.speed, turn: stats.turn,
      fireOnMove: traits.includes('fireOnMove'), strafe: traits.includes('strafe'), evasive: traits.includes('evasive'),
      canLeap: traits.includes('leap'), crush: traits.includes('crush'), aura: traits.includes('repairAura'),
      isStatic: stats.isStatic, hasWeapon, hasHeal, canHitG, canHitA, maxRange, minWeaponRange,
      goal: -1, goalTimer: (id * 0.053) % GOAL_EVERY, px: c.x, py: c.y, vx: 0, vy: 0, sinceDamage: 99,
      leapCd: 1 + this.rng() * 2, leapT: -1, lx0: 0, ly0: 0, lx1: 0, ly1: 0, strafeT: 0, crushCd: 0,
      burnDps: 0, burnSide: side, burnModule: '', burnTick: 0, kbx: 0, kby: 0,
      cloak, detect, sinceFire: 99, domeR, domeAmt, regen, fireRate, reloadMult: Math.max(0.2, 1 - reloadBonus),
      uplinkR, uplinkBonus, rateAura: 0, pdRange, pdCooldown, pdCd: 0, pdModule, jammer, jammed: false,
      smokeR, smokeDur, smokeUsed: false, smoked: false, energyResist: Math.min(0.8, energyResist), hardened,
      blastDmg: blastDmg * lm, blastR, blastModule, blocker: !hasWeapon && !hasHeal,
      meleeOnly: hasWeapon && wpns.every((w) => !w || w.heal > 0 || w.melee), avoidSide: 0, avoidT: 0, stuckT: 0,
    });
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
          this.damage(u, dmg, 1, 1, I.burnSide, I.burnModule, u.x, u.y);
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
      if (I.goalTimer <= 0 || I.goal < 0 || !this.units[I.goal].alive) {
        I.goalTimer = GOAL_EVERY;
        I.goal = this.findGoal(I);
      }
      this.updateWeapons(I);
    }

    // movement
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
        const cnt = this.gather(u.x, u.y, CLOAK_REVEAL + I.radius + MAX_RADIUS);
        for (let q = 0; q < cnt; q++) {
          const j = this.scratch[q];
          const o = units[j];
          if (!o.alive || o.side === u.side) continue;
          if (Math.hypot(o.x - u.x, o.y - u.y) - I.radius - ints[j].radius <= CLOAK_REVEAL) { visible = true; break; }
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
      this.splash(u.x, u.y, I.blastR, I.blastDmg, 0.3, 1, u.side, false, I.blastModule, -1, true);
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
    for (let j = 0; j < units.length; j++) {
      const o = units[j];
      if (!o.alive || o.side === u.side) continue;
      if (o.flying ? !I.canHitA : !I.canHitG) continue;
      if (!this.visible(u, o)) continue;
      const dx = o.x - u.x, dy = o.y - u.y, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = j; }
    }
    return best;
  }

  private inRange(u: SimUnit, w: Wpn, t: SimUnit, mult: number): number {
    const dx = t.x - u.x, dy = t.y - u.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    let edge = d - this.ints[t.id].radius;
    if (w.melee) edge -= this.ints[u.id].radius;
    if (edge > w.range * mult || d < w.minRange) return -1;
    return d;
  }

  private findTarget(u: SimUnit, w: Wpn): number {
    const units = this.units;
    let best = -1, bestD = Infinity;
    for (let j = 0; j < units.length; j++) {
      const o = units[j];
      if (!o.alive || o.side === u.side || !this.canHit(w, o)) continue;
      const d = this.inRange(u, w, o, 1);
      if (d >= 0 && !this.visible(u, o)) continue;
      if (d >= 0 && d < bestD) { bestD = d; best = j; }
    }
    return best;
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
      if (w.retarget <= 0) {
        w.retarget = RETARGET_EVERY;
        const cand = this.findTarget(u, w);
        if (m.target < 0) m.target = cand;
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
        const p = this.aimPoint(I, w, t);
        ax = p.x; ay = p.y;
        want = Math.atan2(ay - u.y, ax - u.x);
      }
      m.angle = turnToward(m.angle, want, TURRET_TURN * DT);

      // burst continuation
      if (w.burstLeft > 0) {
        if (u.disarm > 0) { w.burstLeft = 0; continue; }
        w.burstTimer -= DT * (1 - u.slow) * (I.fireRate + I.rateAura);
        if (w.burstTimer <= 0) {
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
      this.events.push({ t: 'beam', moduleId: def.id, x1: mx, y1: my, x2: t.x, y2: t.y, side: u.side });
      this.damage(t, raw, ap, airBonus, u.side, def.id, t.x, t.y, fx, lm, mx, my, cls);
      return;
    }
    if (kind === 'lightning') {
      if (!t || !t.alive) return;
      this.lightning(u, w, t, raw, ap, airBonus, mx, my, fx, lm);
      return;
    }
    if (kind === 'rail') {
      this.rail(u, w, aim, raw, ap, airBonus, mx, my, fx, lm);
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
      const total = Math.max(0.3, Math.hypot(tx - mx, ty - my));
      const ang = Math.atan2(ty - my, tx - mx);
      const pierce = !!def.pierce;
      const p: Proj = {
        id: this.nextProjId++, side: u.side, moduleId: def.id, kind: kind as Proj['kind'], x: mx, y: my, z: 0, angle: ang, progress: 0,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, speed, dmg: raw, ap, splash: def.splash ?? 0, airBonus, air,
        target: kind === 'missile' && t ? t.id : -1, tx, ty, sx: mx, sy: my, total, traveled: 0,
        maxDist: kind === 'flame' ? total : kind === 'missile' ? w.range * 1.8 : pierce ? w.range + 1 : total + 2,
        ignore: -1, arcH: kind === 'arc' ? 1 + total * 0.22 : 0, dead: false,
        pierce, hits: [], fx, fxMult: lm, cls,
      };
      if (air && kind !== 'missile') p.z = 1;
      else if (kind === 'orb') p.z = 0.4;
      this.projs.push(p);
    }
  }

  private lightning(u: SimUnit, w: Wpn, first: SimUnit, raw: number, ap: number, airBonus: number, mx: number, my: number, fx: ModuleDef | null, lm: number): void {
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
    this.events.push({ t: 'chain', moduleId: w.def.id, points: pts, side: u.side });
  }

  private rail(u: SimUnit, w: Wpn, aim: number, raw: number, ap: number, airBonus: number, mx: number, my: number, fx: ModuleDef | null, lm: number): void {
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
      if (perp <= this.ints[j].radius + 0.15) this.damage(o, raw, ap, airBonus, u.side, w.def.id, o.x, o.y, fx, lm, mx, my, w.cls);
    }
    this.events.push({ t: 'beam', moduleId: w.def.id, x1: mx, y1: my, x2: clamp(ex, -2, FIELD_W + 2), y2: clamp(ey, -2, FIELD_H + 2), side: u.side });
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
      m.angle = turnToward(m.angle, u.angle, TURRET_TURN * DT);
      if (w.healAcc > 0) this.flushHeal(u, w, m, null);
      return;
    }
    m.angle = turnToward(m.angle, Math.atan2(t.y - u.y, t.x - u.x), TURRET_TURN * DT);
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
      this.events.push({ t: 'beam', moduleId: w.def.id, x1: u.x, y1: u.y, x2: target.x, y2: target.y, side: u.side });
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
        if (t.burning <= 0 || dps >= T.burnDps) { T.burnDps = dps; T.burnSide = side; T.burnModule = moduleId; }
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
      const d = Math.hypot(o.x - x, o.y - y) - this.ints[id].radius;
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
      if (p.kind === 'arc') {
        p.progress = Math.min(1, p.progress + (p.speed * DT) / p.total);
        const k = p.progress;
        p.x = p.sx + (p.tx - p.sx) * k;
        p.y = p.sy + (p.ty - p.sy) * k;
        p.z = 4 * p.arcH * k * (1 - k);
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
    const goal = I.goal >= 0 ? this.units[I.goal] : null;
    if (I.strafe) { this.strafeMove(I, goal); return; }

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
        if (d - I.radius - this.ints[goal.id].radius <= 0.15) return;
      } else if (!I.hasWeapon) {
        // support: stay just behind the nearest armed ally
        gx = goal.x;
        gy = clamp(goal.y - fwd * (1.6 + this.ints[goal.id].radius), I.radius, FIELD_H - I.radius);
        stopDist = 0.6;
        // close enough to the ally already: don't shove it around
        if (d - I.radius - this.ints[goal.id].radius <= 1.2 && Math.abs(goal.y - fwd * 1.6 - u.y) < 2.5) return;
      } else {
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
        gx = u.x + dx * lw;
        gy = u.y + dy;
        stopDist = 0;
        if (engaged && (!I.fireOnMove || I.meleeOnly)) wantMove = false;
        else if (I.meleeOnly) wantMove = true; // brawlers charge all the way into contact
        else if (I.fireOnMove && d - this.ints[goal.id].radius <= Math.max(1.2, engageR * 0.7)) wantMove = false;
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

    const dx = gx - u.x, dy = gy - u.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= Math.max(stopDist, 0.05)) return;
    const want = Math.atan2(dy, dx) + this.avoid(I, dx / d, dy / d, goal ? goal.id : -1);
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
    const look = I.radius + MAX_RADIUS + 0.8;
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
      for (let cy = Math.max(0, ccy - 1); cy <= Math.min(HROWS - 1, ccy + 1); cy++) {
        for (let cx = Math.max(0, ccx - 1); cx <= Math.min(HCOLS - 1, ccx + 1); cx++) {
          for (let j = head[cy * HCOLS + cx]; j >= 0; j = next[j]) {
            if (j <= i) continue;
            const b = units[j];
            if (!b.alive || b.flying !== a.flying) continue;
            const B = ints[j];
            if (B.leapT >= 0) continue;
            if (A.strafe || B.strafe) continue; // jets pass through each other
            let dx = b.x - a.x, dy = b.y - a.y;
            const rr = A.radius + B.radius;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr) continue;
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
                this.damage(b, CRUSH_DMG * a.stats.size, 0.5, 1, a.side, 'crush', b.x, b.y);
              } else if (B.crush && B.crushCd <= 0 && a.stats.size < b.stats.size) {
                B.crushCd = CRUSH_EVERY;
                this.damage(a, CRUSH_DMG * b.stats.size, 0.5, 1, b.side, 'crush', a.x, a.y);
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
