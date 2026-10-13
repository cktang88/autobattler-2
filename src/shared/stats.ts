// Design -> UnitStats, plus design validation.

import { CHASSIS_BY_ID, MOBILITY_BY_ID, MODULE_BY_ID, fitsMount, pairingError } from './parts.ts';
import { squadSize } from './grid.ts';
import type { Design, ModuleDef, UnitStats } from './types.ts';

/** Above this load (weight / capacity) a design is illegal. */
export const MAX_LOAD = 1.5;
export const MAX_LEVEL = 3;
/** Per level above 1: +hp and +damage multiplier. */
export const LEVEL_BONUS = 0.3;

/** Speed multiplier from load: light designs get up to +25%, overloaded ones crawl. */
export function loadSpeedFactor(load: number): number {
  if (load <= 1) return 1 + 0.25 * (1 - load);
  return Math.max(0.3, 1 - (load - 1) * 1.2);
}

export function designModules(d: Design): ModuleDef[] {
  const out: ModuleDef[] = [];
  for (const id of d.mounts) {
    if (!id) continue;
    const m = MODULE_BY_ID.get(id);
    if (m) out.push(m);
  }
  return out;
}

/** Sustained dps of one weapon vs 0 armor (no splash/chain multipliers). */
export function weaponDps(w: ModuleDef): number {
  if (w.kind !== 'weapon' || !w.damage || !w.cooldown) return 0;
  return (w.damage * (w.burst ?? 1) * (w.pellets ?? 1)) / cycleTime(w);
}

/** Average seconds per shot including magazine reloads. */
export function cycleTime(w: ModuleDef): number {
  const cd = w.cooldown ?? 1;
  if (!w.magazine || !w.reload) return cd;
  return (cd * (w.magazine - 1) + w.reload) / w.magazine;
}

/** Firing pattern label for UI. */
export function firingStyle(w: ModuleDef): 'Sustained' | 'Clip' | 'Salvo' | 'Single shot' {
  if ((w.burst ?? 1) > 1 || (w.pellets ?? 1) > 1) return 'Salvo';
  if (w.magazine && w.reload) return 'Clip';
  return (w.cooldown ?? 1) <= 0.6 ? 'Sustained' : 'Single shot';
}

/** Accuracy rating 0..100 for UI: hitscan/homing are perfect, otherwise from spread & projectile speed. */
export function accuracyRating(w: ModuleDef): number {
  const p = w.projectile;
  if (p === 'beam' || p === 'lightning' || p === 'rail' || p === 'missile' && !w.spread) return 100;
  const spreadPenalty = (w.spread ?? 0) / Math.max(1, (w.range ?? 5) / 5);
  const speedPenalty = p === 'arc' ? 0.25 : w.projectileSpeed ? Math.max(0, 0.3 - w.projectileSpeed / 80) : 0;
  return Math.round(Math.max(5, 100 * (1 - spreadPenalty * 0.8 - speedPenalty)));
}

// ---------------------------------------------------------------------------------------------
// Cost model.
//
// Lanchester's square law: an army's fighting strength ~ N^2 * dps * ehp. For two armies of equal
// SUPPLY to be equally strong, a unit's cost must scale with sqrt(dps * ehp). So:
//
//   offense = sum over weapons of (dps vs a mix of armor) * splash/chain/burn/stun value * range factor * coverage
//   ehp     = (hp + shield) * armor factor * evasion/flight factors
//   power   = sqrt(offense * ehp) * mobility factor
//   cost    = PARTS_WEIGHT * partsCost + POWER_K * power          (rounded to 5)
//
// partsCost keeps "complexity" in the price (twin mounts, exotic parts cost more to field even
// when the model under-rates them); the power term is what keeps army sizes balanced.
// ---------------------------------------------------------------------------------------------

export const PARTS_WEIGHT = 0.3;
export const POWER_K = 0.36;
/** Size-class price factor on the whole unit cost, by chassis size 1..5 (size 1 = per unit of a 4-unit squad).
 *  Sim effects that scale with size (overkill, focus fire, chip damage vs a few big targets, squad splash exposure,
 *  retargeting) are not visible to the analytic power term; this one multiplier per class soaks them up. */
export const SIZE_K: number[] = [1.11, 1.17, 1.09, 0.98, 0.85];
/** Per-mobility price factor on the whole unit cost (fitted with scripts/fit_cal.py on plain frames; 1 = analytic).
 *  Soaks up what the analytic mobility term cannot see: how well a drive keeps a hull in the fight (leapers waste
 *  time, anchors and big tracks never leave the front, flyers dodge half the field). */
export const MOBILITY_CAL: Record<string, number> = { anchor: 1.04, gravlift: 1.06, halftrack: 1.04, hover: 1.05, jet: 0.85, jumpjets: 0.82, legs: 1.12, megatracks: 1.11, rotor: 1.18, spider: 1.08, titanlegs: 1.13, treads: 1.03, wheels: 1.08 };
/** reference enemy armor mix used to rate weapons */
const REF_ARMOR = [0, 5, 12];
const RANGE_EXP = 1.0;
const RANGE_CAP = 2.8;

/** Fraction of raw damage that gets through the reference armor mix (sim damage formula). */
export function armorEfficiency(damage: number, ap: number): number {
  let sum = 0;
  for (const a of REF_ARMOR) sum += Math.max(damage * 0.15, damage - a * (1 - ap)) / damage;
  return sum / REF_ARMOR.length;
}

/** Predicted damage-output rating of one weapon (or healing value of a repair module). */
/** Expected fraction of shots that connect with a (mostly engaged, slowly moving) target. Hitscan, homing and
 *  melee never miss; unguided projectiles lose to spread and to target drift during flight (no lead in the sim). */
export function hitFactor(w: ModuleDef): number {
  const p = w.projectile;
  if (p === 'beam' || p === 'lightning' || p === 'rail' || p === 'melee' || (p === 'missile' && !w.spread)) return 1;
  const spread = (w.spread ?? 0) * 0.7;
  const flight = w.projectileSpeed ? (w.range ?? 5) / w.projectileSpeed : 0;
  const target = 0.45 + 0.6 * (w.splash ?? 0);
  return target / (target + spread + 0.25 * flight) / 0.7;
}

/** Empirical calibration, fitted with `node scripts/balance.ts` (equal-supply armies of every module vs a reference
 *  field). The analytic terms above give each module a first-order value; sim effects they cannot see (target
 *  drift, overkill, focus fire, how often a stun/aura/cloak really matters in a big fight) are folded into one
 *  multiplier per module id. Weapons: multiplies weaponValue. Utilities: scales the strength of the effect terms
 *  in computeStats (1 = analytic value; low values mean the effect is worth little in mass battles). Re-fit after
 *  changing the sim or the part numbers. */
export const MODULE_CAL: Record<string, number> = {
  aamissile: 1.64, ac20: 2.38, ac40: 2.64, aegisT: 1.33, annihilator: 2.10, arclance: 1.73, atgm: 3.83,
  autocannon: 2.46, autoloader: 2.09, avenger: 3.10, barrage: 2.83, bombs: 2.04, bulwarkshield: 1.55,
  buzzsaw: 0.63, cannon: 3.06, cannon75: 2.87, chainsaw: 2.65, claw: 2.21, clusterbombs: 3.03, cruise: 3.41,
  disarm: 0.02, dome: 0.10, domeG: 0.71, doomsday: 5.04, drill: 2.00, empcannon: 1.36, flak: 1.50,
  flamer: 0.82, gauss: 2.44, gravity: 1.02, grinder: 4.98, guidedrocket: 1.53, gyro: 0.13, hammer: 2.68,
  hardened: 0.17, heatray: 0.19, heavyflak: 2.47, hmg: 1.64, howitzer: 1.91, incendiary: 1.32, inferno: 2.44,
  jammer: 0.10, laser: 2.35, lightrail: 3.55, massdriver: 1.90, mg: 1.54, minigun: 1.45, mirror: 0.32,
  missilebattery: 1.76, mlrs: 3.87, mortar: 1.16, nanite: 0.12, napalm: 1.02, overclock: 0.52, phantom: 0.20,
  plasma: 2.24, plasmablade: 2.54, plasmaorb: 2.48, pointdef: 2.53, quad20: 3.54, railgun: 3.15, ram: 0.49,
  reactive: 1.03, repair: 3.46, repairM: 2.84, rocketL: 2.34, rockets: 2.81, sam: 1.75, selfdestruct: 0.25,
  sensor: 0.15, shield: 1.09, shieldH: 1.16, shieldL: 0.72, shockprod: 1.31, shotgun: 2.32, siege240: 1.75,
  siegeplasma: 3.90, skyfortress: 8.42, slowbeam: 3.17, smoke: 4.00, sniper: 7.78, sonic: 0.00, stealth: 0.27,
  stormcore: 1.57, stormtower: 2.82, stungun: 1.26, swarm: 1.59, tactnuke: 2.56, targeting: 3.65, tesla: 1.35,
  titanfist: 5.26, turbo: 0.10, twin120: 3.36, twin30: 2.37, twinlaser: 2.31, twinmg: 1.81, uplink: 0.25,
};
const cal = (id: string) => MODULE_CAL[id] ?? 1;

export function weaponValue(w: ModuleDef, rangeMult = 1): number {
  const range = (w.range ?? 0) * rangeMult;
  const rangeF = Math.min(RANGE_CAP, Math.max(0.5, Math.pow(range / 5, RANGE_EXP))); // reach decides most fights
  if (w.heal) return w.heal * 1.6 * rangeF * cal(w.id);
  if (w.kind !== 'weapon' || !w.damage || !w.cooldown) return 0;
  const shots = (w.burst ?? 1) * (w.pellets ?? 1);
  let v = weaponDps(w) * armorEfficiency(w.damage, w.ap ?? 0);
  v *= 1 + 0.6 * (w.splash ?? 0);
  v *= 1 + 0.45 * (w.chain ?? 0);
  if (w.pierce) v *= 1.5;
  if ((w.pellets ?? 1) > 1) v *= 0.7; // pellets rarely all land
  if (w.falloff != null) v *= 0.3 + 0.7 * w.falloff;
  const cyc = cycleTime(w);
  // burn refreshes rather than stacks: worth ~its dps on each target it keeps alight
  if (w.burn) v += w.burn.dps * Math.min(1, w.burn.duration / cyc) * (1 + 0.6 * (w.splash ?? 0));
  if (w.stun) v += ((w.stun * shots) / cyc) * 22 * (1 + 0.8 * (w.splash ?? 0));
  if (w.slow) v += (w.slow / cyc) * 14;
  if (w.disarm) v += (w.disarm / cyc) * 28;
  if (w.impulse) v += (Math.abs(w.impulse) / cyc) * 6 * (1 + 0.6 * (w.splash ?? 0));
  v *= hitFactor(w);
  if (w.projectile === 'missile') v *= 1.1; // homing: rarely misses
  if (w.minRange) v *= 0.9;
  const coverage = w.targetsGround && w.targetsAir ? 1.15 : w.targetsGround ? 0.85 : 1.5 * (w.airBonus ?? 1);
  return v * coverage * rangeF * cal(w.id);
}

export function computeStats(d: Design): UnitStats {
  const c = CHASSIS_BY_ID.get(d.chassis);
  const m = MOBILITY_BY_ID.get(d.mobility);
  if (!c || !m) throw new Error(`bad design parts: ${d.chassis}/${d.mobility}`);
  const size = c.size;
  const mods = designModules(d);
  let hp = c.hp + m.hp * size;
  let armor = c.armor + m.armor;
  let weight = c.weight + m.weight * size;
  let partsCost = c.cost + m.cost * size;
  let shield = 0;
  let heal = 0;
  let dps = 0;
  const traits: string[] = [...c.traits, ...m.traits];
  let rangeMult = 1;
  if (traits.includes('rangeBoost')) rangeMult += 0.2;
  if (traits.includes('fortified')) rangeMult += 0.15;
  let spreadMult = traits.includes('stable') ? 0.5 : 1;
  let speedBonus = 0;
  let fireRate = 1;
  for (const mod of mods) {
    hp += mod.hp ?? 0;
    armor += mod.armor ?? 0;
    weight += mod.weight;
    partsCost += mod.cost;
    shield += mod.shield ?? 0;
    heal += mod.heal ?? 0;
    dps += weaponDps(mod);
    rangeMult += mod.rangeBonus ?? 0;
    if (mod.spreadMult) spreadMult *= mod.spreadMult;
    speedBonus += mod.speedBonus ?? 0;
    fireRate += mod.fireRateBonus ?? 0;
    if (mod.gyro && !traits.includes('fireOnMove')) traits.push('fireOnMove');
    if (mod.cloak && !traits.includes(mod.cloak)) traits.push(mod.cloak);
    if (mod.hardened && !traits.includes('hardened')) traits.push('hardened');
  }
  const capacity = m.capacity[size - 1] || 1;
  const load = weight / capacity;
  let range = 0;
  for (const mod of mods) if (mod.range && mod.kind === 'weapon') range = Math.max(range, mod.projectile === 'melee' ? mod.range : mod.range * rangeMult);
  const sizeSpeed = [1, 0.95, 0.85, 0.75, 0.65][size - 1];
  const speed = m.kind === 'static' ? 0 : m.speed * loadSpeedFactor(load) * sizeSpeed * (1 + speedBonus);
  // body turn rate: mobility base x hull agility x size inertia, slowed when overloaded (heavier armament = slower)
  const sizeTurn = [1, 0.95, 0.85, 0.75, 0.65][size - 1];
  const turn = m.turn * c.agility * sizeTurn * (load > 1 ? Math.max(0.5, 1 - (load - 1)) : 1);
  const flying = m.kind === 'air';
  const isStatic = m.kind === 'static';

  // ---- cost model ----
  let offense = 0;
  for (const mod of mods) offense += weaponValue(mod, rangeMult) * (mod.spread && spreadMult < 1 ? 1 + 0.15 * (1 - spreadMult) : 1);
  if (traits.includes('repairAura')) offense += 25;
  // utility modules: rate-of-fire boosts multiply offense; ally/defensive effects add value
  offense *= fireRate;
  let reactiveHp = 0;
  const shieldCal = mods.reduce((a, m) => a + (m.shield ?? 0) * cal(m.id), 0) / Math.max(1, shield);
  let ehpMult = 1;
  for (const mod of mods) {
    const u = cal(mod.id); // empirical strength of the utility's effect (1 = analytic value)
    const eh = (mult: number) => 1 + (mult - 1) * u;
    if (mod.reloadBonus) offense *= 1 + 0.25 * u * mod.reloadBonus * mods.filter((w) => w.magazine).length / Math.max(1, mods.filter((w) => w.kind === 'weapon').length);
    if (mod.shieldAura) offense += mod.shieldAura.amount * 0.3 * u;
    if (mod.fireRateAura) offense += mod.fireRateAura.bonus * 300 * u;
    if (mod.detect) offense += 12 * u;
    if (mod.jammer) { offense += 15 * u; ehpMult *= eh(1.1); }
    if (mod.deathBlast) offense += mod.deathBlast.damage * 0.06 * u;
    if (mod.regen) ehpMult *= eh(1 + mod.regen * 12);
    if (mod.pointDefense) ehpMult *= eh(1.2);
    if (mod.smoke) ehpMult *= eh(1.12);
    if (mod.reactive) reactiveHp += mod.reactive * 60 * u;
    if (mod.energyResist) ehpMult *= eh(1 + mod.energyResist * 0.4);
    if (mod.hardened) ehpMult *= eh(1.08);
    if (mod.cloak === 'stealth') ehpMult *= eh(1.35);
    if (mod.cloak === 'phantom') ehpMult *= eh(1.5);
  }
  offense = Math.max(offense, 5);
  let ehp = (hp + 1.2 * shield * shieldCal + reactiveHp) * (1 + armor / 15) * ehpMult;
  if (traits.includes('evasive')) ehp *= 1.15;
  if (flying) ehp *= 1.2; // only anti-air can answer it
  const mobilityF = isStatic ? 0.85 : 1 + 0.08 * speed + (traits.includes('fireOnMove') ? 0.05 : 0) + (traits.includes('leap') ? 0.05 : 0);
  const power = Math.sqrt(offense * ehp) * mobilityF;
  const unitCost = Math.max(10, (PARTS_WEIGHT * partsCost + POWER_K * power) * (SIZE_K[size - 1] ?? 1) * (MOBILITY_CAL[d.mobility] ?? 1));
  const squad = squadSize(size);
  const cost = roundCost(unitCost * squad);

  return {
    size, fw: c.footprint?.[0] ?? size, fh: c.footprint?.[1] ?? size, hp: Math.round(hp), armor, weight: Math.round(weight * 10) / 10, capacity, load,
    speed: Math.round(speed * 100) / 100, turn, cost, unitCost: Math.round(unitCost), squad,
    flying, isStatic, range: Math.round(range * 10) / 10,
    dps: Math.round(dps), shield, heal, traits, rangeMult, spreadMult,
    partsCost, offense: Math.round(offense), ehp: Math.round(ehp), power: Math.round(power),
  };
}

const CLASS_TRAVERSE: Record<string, number> = { L: 7, M: 5, H: 3.2, G: 2, T: 1.2 };
const VISUAL_TRAVERSE: Partial<Record<string, number>> = {
  gatling: 1.1, shotgun: 1.2, sniper: 0.6, rail: 0.7, gauss: 0.7, cannon: 0.8, artillery: 0.5, mortar: 0.8, flak: 1.3,
  missileRack: 1.4, cruise: 0.6, rocketPod: 1.1, laser: 1.2, heatray: 1.0, plasma: 0.9, flamer: 1.2, tesla: 1.5, emp: 1.1,
  slowbeam: 1.1, sonic: 1.1, gravity: 0.9, repair: 1.4,
  saw: 1.4, chainsaw: 1.4, hammer: 1.1, claw: 1.4, blade: 1.5, drill: 1.2, prod: 1.5, ram: 1.0,
};
/** Turret traverse speed (rad/s) of a module: explicit turretTurn, else mount-class base x weapon-type factor. */
export function turretTurnRate(mod: ModuleDef): number {
  if (mod.turretTurn != null) return mod.turretTurn;
  return (CLASS_TRAVERSE[mod.mount] ?? 4) * (VISUAL_TRAVERSE[mod.visual] ?? 1);
}

/** Round a supply cost to a friendly number: nearest 50 (min 50). */
export function roundCost(raw: number): number {
  return Math.max(50, Math.round(raw / 50) * 50);
}

/** Level multiplier for hp and damage. */
export const levelMult = (level: number) => 1 + LEVEL_BONUS * (Math.max(1, Math.min(MAX_LEVEL, level)) - 1);

/** Returns a list of problems; empty means the design is legal. */
export function validateDesign(d: Design): string[] {
  const errs: string[] = [];
  if (!d || typeof d !== 'object') return ['Not a design'];
  if (typeof d.id !== 'string' || !d.id || d.id.length > 40) errs.push('Bad id');
  if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 24) errs.push('Name must be 1-24 characters');
  const pe = pairingError(d.chassis, d.mobility);
  if (pe) { errs.push(pe); return errs; }
  const c = CHASSIS_BY_ID.get(d.chassis)!;
  if (!Array.isArray(d.mounts) || d.mounts.length !== c.mounts.length) { errs.push('Mount count mismatch'); return errs; }
  let weapons = 0;
  d.mounts.forEach((id, i) => {
    if (id == null) return;
    const mod = MODULE_BY_ID.get(id);
    if (!mod) { errs.push(`Unknown module ${id}`); return; }
    if (!fitsMount(c.mounts[i], mod.mount)) errs.push(`${mod.name} (${mod.mount}) doesn't fit a ${c.mounts[i]} mount`);
    const flies = MOBILITY_BY_ID.get(d.mobility)?.kind === 'air';
    if (mod.requires === 'air' && !flies) errs.push(`${mod.name} can only be mounted on flying designs`);
    if (mod.requires === 'ground' && flies) errs.push(`${mod.name} can't be mounted on flying designs`);
    if (mod.kind === 'weapon' || mod.kind === 'utility') weapons++;
  });
  if (weapons === 0) errs.push('Needs at least one weapon or utility module');
  if (errs.length) return errs;
  const s = computeStats(d);
  if (s.load > MAX_LOAD) errs.push(`Overloaded: ${s.weight} / ${s.capacity} weight (max ${Math.round(MAX_LOAD * 100)}%)`);
  return errs;
}

export const isValidDesign = (d: Design) => validateDesign(d).length === 0;
