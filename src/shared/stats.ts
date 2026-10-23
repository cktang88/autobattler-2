// Design -> UnitStats, plus design validation.

import { CHASSIS_BY_ID, MOBILITY_BY_ID, MODULE_BY_ID, fitsMount, moduleTier, pairingError } from './parts.ts';
import { hullK, meleeSlots } from './mountgeo.ts';
import { squadSize } from './grid.ts';
import { REPAIR_AURA_RANGE } from './types.ts';
import type { ChassisDef, Design, ModuleDef, UnitStats } from './types.ts';

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
  const cl = w.cluster ? w.cluster.count * w.cluster.damage : 0; // bomblets released by each shell
  return ((w.damage + cl) * (w.burst ?? 1) * (w.pellets ?? 1)) / cycleTime(w);
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
// Re-tuned by direct equal-supply sims (light/medium/heavy armies vs each other; giants & titans vs mixed armies):
// bigger hulls concentrate armour and firepower far better than the analytic model credits (flat armour shrugs off
// light weapons, no squad splash exposure), so price rises steeply with class. Previous fit (0.93/0.83 for 4/5) made
// giants and titans win ~100% at equal cost; these values bring them to ~50%. Light squads dropped to 0.9 when bodies
// were scaled down (mountgeo bodyScale: light troopers 0.7, the rest 0.78): size-1 armies fell to ~20% vs size 2.
export const SIZE_K: number[] = [0.9, 1.11, 1.19, 1.49, 1.49];
/** Per-mobility price factor on the whole unit cost (fitted with scripts/fit_cal.py on plain frames; 1 = analytic).
 *  Soaks up what the analytic mobility term cannot see: how well a drive keeps a hull in the fight (leapers waste
 *  time, anchors and big tracks never leave the front, flyers dodge half the field). */
export const MOBILITY_CAL: Record<string, number> = { anchor: 0.97, gravlift: 1.06, halftrack: 1.17, hover: 0.98, jet: 0.85, jumpjets: 0.93, legs: 1.01, megatracks: 1.14, rotor: 1.18, spider: 1.12, titanlegs: 1.09, treads: 1.14, wheels: 0.96 };
/** reference enemy armor mix used to rate weapons */
const REF_ARMOR = [0, 5, 12];
const RANGE_EXP = 1.0;
/** Range (cells) rated 1.0. Weapon ranges were stretched ~1.3x for the 96 x 92 field (direct fire 6 -> 7.5 cells);
 *  the reference moved with them so a gun's price is unchanged by the stretch. Repair beams kept their range, so
 *  their MODULE_CAL was scaled by 6.5 / 5 to keep their price; weapon MODULE_CAL re-fitted with fit_cal.py. */
const RANGE_REF = 6.5;
/** Effective-hp floor for long-reach units (see computeStats): ramps in from SHELTER_FROM cells of reach to full
 *  at SHELTER_FROM + SHELTER_SPAN.  Fitted with `node scripts/duels.ts groups` (cheap mortar carts vs tanks). */
export const SHELTER_EHP = 400;
const SHELTER_FROM = 10;
const SHELTER_SPAN = 10;
const RANGE_CAP = 2.8;

/** Fraction of raw damage that gets through the reference armor mix (sim damage formula). */
export function armorEfficiency(damage: number, ap: number): number {
  let sum = 0;
  for (const a of REF_ARMOR) sum += Math.max(damage * 0.15, damage - a * (1 - ap)) / damage;
  return sum / REF_ARMOR.length;
}

/** Predicted damage-output rating of one weapon (or healing value of a repair module). */
/** Expected fraction of shots that connect with a (mostly engaged, slowly moving) target. Hitscan, homing and
 *  melee never miss; unguided projectiles lose to spread, and a little to flight time: the sim leads moving targets
 *  (constant-velocity intercept), so only targets that turn or stop mid-flight dodge. MODULE_CAL was rescaled when
 *  this went from 0.25 to 0.04 per second of flight, keeping every price unchanged. */
export function hitFactor(w: ModuleDef): number {
  const p = w.projectile;
  if (p === 'beam' || p === 'lightning' || p === 'rail' || p === 'melee' || (p === 'missile' && !w.spread)) return 1;
  const spread = (w.spread ?? 0) * 0.7;
  const flight = w.projectileSpeed ? (w.range ?? 5) / w.projectileSpeed : 0;
  const target = 0.45 + 0.6 * (w.splash ?? 0);
  return target / (target + spread + 0.04 * flight) / 0.7;
}

/** Empirical calibration, fitted with `node scripts/balance.ts` (equal-supply armies of every module vs a reference
 *  field). The analytic terms above give each module a first-order value; sim effects they cannot see (target
 *  drift, overkill, focus fire, how often a stun/aura/cloak really matters in a big fight) are folded into one
 *  multiplier per module id. Weapons: multiplies weaponValue. Utilities: scales the strength of the effect terms
 *  in computeStats (1 = analytic value; low values mean the effect is worth little in mass battles). Re-fit after
 *  changing the sim or the part numbers. */
export const MODULE_CAL: Record<string, number> = {
  aamissile: 3.74, ac20: 3.07, ac40: 2.44, aegisT: 1.25, annihilator: 3.56, arclance: 2.20, atgm: 1.22,
  autocannon: 2.25, autoloader: 2.35, avenger: 0.72, barrage: 7.54, bombs: 1.16, bulwarkshield: 1.53, buzzsaw: 0.35,
  cannon: 0.88, cannon75: 4.91, chainsaw: 0.90, claw: 1.46, clusterbombs: 5.60, cruise: 9.80, disarm: 1.46,
  dome: 1.0, domeG: 1.0, doomsday: 8.01, drill: 2.29, empcannon: 0.39, flak: 1.37, flamer: 0.37, gauss: 5.56,
  gravity: 3.09, grinder: 2.29, guidedrocket: 2.42, gyro: 0.10, hammer: 1.25, hardened: 0.13, heatray: 0.52,
  heavyflak: 5.46, hmg: 3.17, howitzer: 13.25, incendiary: 0.55, inferno: 2.10, jammer: 0.25, laser: 5.85,
  lightrail: 10.00, massdriver: 0.30, mg: 2.95, minigun: 1.00, mirror: 0.31, missilebattery: 2.28, mlrs: 4.86,
  mortar: 2.75, nanite: 0.10, napalm: 0.90, overclock: 0.22, phantom: 0.14, plasma: 4.60, plasmablade: 1.04,
  plasmaorb: 1.90, pointdef: 3.3, quad20: 2.97, railgun: 11.66, ram: 0.76, reactive: 0.88, repair: 4.2,
  repairM: 4.17, rocketL: 2.18, rockets: 0.74, sam: 3.14, selfdestruct: 0.22, sensor: 1.0, shield: 1.04,
  shieldH: 1.11, shieldL: 0.84, shockprod: 0.68, shotgun: 0.70, siege240: 1.54, siegeplasma: 0.48, skyfortress: 2.80,
  slowbeam: 5.00, smoke: 4.00, sniper: 30.00, sonic: 1.04, stealth: 0.20, stormcore: 0.33, stormtower: 1.85,
  stungun: 1.22, swarm: 3.10, tactnuke: 5.85, targeting: 3.45, tesla: 1.22, titanfist: 2.82, turbo: 0.10,
  twin120: 0.28, twin30: 2.70, twinlaser: 3.40, twinmg: 8.00, uplink: 0.3,
  clusterhow: 1.4, firebomb: 0.8, flechette: 3.1, grenade: 2.5,
  // [aura balance] aura strengths (uplink, dome, domeG, jammer, sensor above and these two) were set by hand after the
  // radius rework: `node scripts/balance.ts army 3 <id>` (every unit carries the aura -> heavy overlap) lands at a
  // delta of -7..+2, i.e. a little overpriced when massed, and `node scripts/auras.ts field` (ONE carrier escorting a
  // block, no overlap) at roughly even vs the same supply of guns. fit_cal.py holds them fixed (non-stacking makes
  // its all-carrier gradient drift them toward zero). aegisTAura prices the Aegis Field's projected shield only.
  aegisTAura: 1.5, repairAura: 1.5,
};
const cal = (id: string) => MODULE_CAL[id] ?? 1;

// [aura balance] Support auras (uplink, domes, jammer, sensor, repair-aura hulls) are priced by what they project onto
// OTHER units, so their value is added to the unit cost directly instead of riding on the carrier's own power term
// (in sqrt(offense * ehp) an aura on a titan cost next to nothing, on a tanky gunless hull a lot).
/** Raw cost (x PRICE_DIV = supply) per analytic aura point at reach 1 (MODULE_CAL then scales each module). */
export const SUPPORT_K = 1;
/** Aura radius (cells, edge to edge) from a size-2 hull (radius 0.9) rated reach 1. */
const AURA_REF_R = 8 + 0.9;
/** Reach is capped: past ~60 m an aura already covers everything near its carrier that matters. */
const AURA_REACH_CAP = 2.5;
/** Expected coverage of an aura of `radius` cells (edge to edge) on a hull of bounding radius `hullR`: covered area
 *  grows with (radius + hullR)^2, relative to the reference, capped. */
export function auraReach(radius: number, hullR: number): number {
  return Math.min(AURA_REACH_CAP, ((radius + hullR) / AURA_REF_R) ** 2);
}
/** Auras don't stack, so the 16 carriers of one squad mostly cover the same allies: per unit, a squad's aura is
 *  worth this share of a lone carrier's (the squad's union covers ~2 lone carriers' worth of ground). */
/** Raw cost per point-defense module at cooldown 0.6 s (x MODULE_CAL.pointdef): ~+12 supply on a medium hull, as before. */
const PD_PTS = 23;
export const auraSquadShare = (squad: number) => (squad > 1 ? Math.min(1, 2 / squad) : 1);

export function weaponValue(w: ModuleDef, rangeMult = 1): number {
  const range = (w.range ?? 0) * rangeMult;
  const rangeF = Math.min(RANGE_CAP, Math.max(0.5, Math.pow(range / RANGE_REF, RANGE_EXP))); // reach decides most fights
  if (w.heal) return w.heal * 1.6 * rangeF * cal(w.id);
  if (w.kind !== 'weapon' || !w.damage || !w.cooldown) return 0;
  const shots = (w.burst ?? 1) * (w.pellets ?? 1);
  const cl = w.cluster;
  const cyc = cycleTime(w);
  let v = (weaponDps(w) - (cl ? (cl.count * cl.damage * shots) / cyc : 0)) * armorEfficiency(w.damage, w.ap ?? 0);
  v *= 1 + 0.6 * (w.splash ?? 0);
  // cluster bomblets: scatter widely, so only part of them land on something
  if (cl) v += ((cl.count * cl.damage * shots) / cyc) * armorEfficiency(cl.damage, w.ap ?? 0) * (1 + 0.6 * cl.splash) * 0.6;
  v *= 1 + 0.45 * (w.chain ?? 0);
  if (w.pierce) v *= 1.5;
  if ((w.pellets ?? 1) > 1) v *= 0.7; // pellets rarely all land
  if (w.falloff != null) v *= 0.3 + 0.7 * w.falloff;
  if (w.spinUp) v *= 0.85; // time lost spinning up at the start of each engagement
  if (w.ramp) v *= 1 + (w.ramp - 1) * 0.5; // average power over a focus
  // burn refreshes rather than stacks: worth ~its dps on each target it keeps alight
  if (w.burn) v += w.burn.dps * Math.min(1, w.burn.duration / cyc) * (1 + 0.6 * (w.splash ?? 0));
  // fire field: burns everyone who stands in (or walks through) the patch while it lasts
  if (w.fireField) v += w.fireField.dps * Math.min(1.5, w.fireField.duration / cyc) * (1 + 0.6 * w.fireField.radius);
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
  // utility modules: rate-of-fire boosts multiply offense; ally/defensive effects add value
  offense *= fireRate;
  let reactiveHp = 0;
  const shieldCal = mods.reduce((a, m) => a + (m.shield ?? 0) * cal(m.id), 0) / Math.max(1, shield);
  let ehpMult = 1;
  // [aura balance] support auras: analytic points x coverage x calibration, added to the unit cost below
  const hullR = hullK(size) * Math.sqrt((c.footprint?.[0] ?? size) * (c.footprint?.[1] ?? size));
  let interceptors = 0; // not shared within a squad: every PD shoots down its own projectiles
  let support = traits.includes('repairAura') ? 25 * auraReach(REPAIR_AURA_RANGE, hullR) * cal('repairAura') : 0;
  for (const mod of mods) {
    const u = cal(mod.id); // empirical strength of the utility's effect (1 = analytic value)
    const eh = (mult: number) => 1 + (mult - 1) * u;
    if (mod.reloadBonus) offense *= 1 + 0.25 * u * mod.reloadBonus * mods.filter((w) => w.magazine).length / Math.max(1, mods.filter((w) => w.kind === 'weapon').length);
    if (mod.shieldAura) support += mod.shieldAura.amount * 0.3 * auraReach(mod.shieldAura.radius, hullR) * (MODULE_CAL[mod.id + 'Aura'] ?? u);
    if (mod.fireRateAura) support += mod.fireRateAura.bonus * 300 * auraReach(mod.fireRateAura.radius, hullR) * u;
    if (mod.detect) support += 12 * auraReach(mod.detect, hullR) * u;
    if (mod.jammer) support += 15 * auraReach(mod.jammer, hullR) * u; // covers its carrier too (counted in the reach)
    if (mod.deathBlast) offense += mod.deathBlast.damage * 0.06 * u;
    if (mod.regen) ehpMult *= eh(1 + mod.regen * 12);
    // [aura balance] point defense: worth its intercept rate, whatever the hull (as an ehp multiplier a titan's PD cost ~300 supply)
    if (mod.pointDefense) interceptors += PD_PTS * (0.6 / mod.pointDefense.cooldown) * u;
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
  // long reach shelters a fragile hull: artillery behind a front line is rarely shot, so a paper-thin carriage with a
  // mortar is priced as if it were at least moderately tough (sturdy hulls are already above the floor: no change)
  ehp = Math.max(ehp, SHELTER_EHP * Math.min(1, Math.max(0, (range - SHELTER_FROM) / SHELTER_SPAN)));
  const mobilityF = isStatic ? 0.85 : 1 + 0.08 * speed + (traits.includes('fireOnMove') ? 0.05 : 0) + (traits.includes('leap') ? 0.05 : 0);
  const power = Math.sqrt(offense * ehp) * mobilityF;
  let unitCost = Math.max(10, (PARTS_WEIGHT * partsCost + POWER_K * power) * (SIZE_K[size - 1] ?? 1) * (MOBILITY_CAL[d.mobility] ?? 1));
  const squad = squadSize(size);
  unitCost += SUPPORT_K * (support * auraSquadShare(squad) + interceptors);
  const cost = roundCost(unitCost * squad);

  return {
    size, fw: c.footprint?.[0] ?? size, fh: c.footprint?.[1] ?? size, hp: Math.round(hp), armor, weight: Math.round(weight * 10) / 10, capacity, load,
    speed: Math.round(speed * 100) / 100, turn, cost, unitCost: Math.round(unitCost / PRICE_DIV), squad,
    flying, isStatic, range: Math.round(range * 10) / 10,
    dps: Math.round(dps), shield, heal, traits, rangeMult, spreadMult,
    partsCost, offense: Math.round(offense), ehp: Math.round(ehp), power: Math.round(power),
  };
}

const TIER_TRAVERSE = [7, 5, 3.2, 2, 1.2];
const VISUAL_TRAVERSE: Partial<Record<string, number>> = {
  gatling: 1.1, shotgun: 1.2, sniper: 0.6, rail: 0.7, gauss: 0.7, cannon: 0.8, artillery: 0.5, mortar: 0.8, flak: 1.3,
  missileRack: 1.4, cruise: 0.6, rocketPod: 1.1, laser: 1.2, heatray: 1.0, plasma: 0.9, flamer: 1.2, tesla: 1.5, emp: 1.1,
  slowbeam: 1.1, sonic: 1.1, gravity: 0.9, repair: 1.4,
  saw: 1.4, chainsaw: 1.4, hammer: 1.1, claw: 1.4, blade: 1.5, drill: 1.2, prod: 1.5, ram: 1.0,
};
/** Turret traverse speed (rad/s) of a module: explicit turretTurn, else mount-class base x weapon-type factor. */
export function turretTurnRate(mod: ModuleDef): number {
  if (mod.turretTurn != null) return mod.turretTurn;
  return TIER_TRAVERSE[moduleTier(mod) - 1] * (VISUAL_TRAVERSE[mod.visual] ?? 1);
}

/** Round a supply cost to a friendly number: nearest 50 (min 50). */
/** Player-facing prices are the model's raw cost / PRICE_DIV (raw numbers ran past 10 000; now the biggest titans are ~2000). */
export const PRICE_DIV = 5;
/** Round a raw model cost to a supply price. */
export function roundCost(raw: number): number {
  return roundPrice(raw / PRICE_DIV);
}
/** Round an already-scaled supply amount: nearest 10 below 1000, nearest 50 above. */
export function roundPrice(v: number): number {
  return v < 1000 ? Math.max(10, Math.round(v / 10) * 10) : Math.round(v / 50) * 50;
}

/** Level multiplier for hp and damage. */
export const levelMult = (level: number) => 1 + LEVEL_BONUS * (Math.max(1, Math.min(MAX_LEVEL, level)) - 1);

/** Why module `mod` can't go in slot `i` of chassis `c` with mobility `mobilityId` (null = legal). Single source of truth
 *  for validateDesign, the garage (socket highlighting, drop messages) and the AI. */
export function slotError(c: ChassisDef, mobilityId: string | null | undefined, i: number, mod: ModuleDef): string | null {
  if (!fitsMount(c.mounts[i], mod.mount)) return `${mod.name} (${mod.mount}) doesn't fit a ${c.mounts[i]} mount`;
  const flies = mobilityId ? MOBILITY_BY_ID.get(mobilityId)?.kind === 'air' : (c.domain ?? 'ground') !== 'ground';
  if (mod.category === 'melee') {
    if (flies || (c.domain ?? 'ground') !== 'ground') return `${mod.name} can't go on aircraft: melee weapons can only go on ground units`;
    if (!meleeSlots(c)[i]) return `${mod.name} can't fit in mount ${i + 1}: melee weapons need a mount near the edge of the chassis`;
  }
  if (mod.requires === 'air' && !flies) return `${mod.name} can only be mounted on flying designs`;
  if (mod.requires === 'ground' && flies) return `${mod.name} can't be mounted on flying designs`;
  return null;
}

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
    const why = slotError(c, d.mobility, i, mod);
    if (why) errs.push(why);
    if (mod.kind === 'weapon' || mod.kind === 'utility') weapons++;
  });
  if (weapons === 0) errs.push('Needs at least one weapon or utility module');
  if (errs.length) return errs;
  const s = computeStats(d);
  if (s.load > MAX_LOAD) errs.push(`Overloaded: ${s.weight} / ${s.capacity} weight (max ${Math.round(MAX_LOAD * 100)}%)`);
  return errs;
}

export const isValidDesign = (d: Design) => validateDesign(d).length === 0;

/** Effective range (cells, after range bonuses) a kiting-by-default design's main guns must reach: clearly past the
 *  typical frontline guns (autocannons 7.5, cannons 9) so kiting actually keeps it out of their reach. */
export const DEFAULT_KITE_RANGE = 10;
/** Shortest effective range at which focus fire is on by default (shotguns / flamers / sonic stay off). */
export const DEFAULT_FOCUS_RANGE = 5;

export interface DefaultOrders { kite: boolean; focus: boolean }
const defaultOrdersCache = new Map<string, DefaultOrders>();

/** Battle orders a design gets when its placement (and Design.behavior) leave them unset. Shared by the sim, client
 *  and AI so all agree; an explicit true/false on a placement always wins.
 *  - kite: mobile ground units (not static, not flying, not giant/titan hulls, which are the front line), no melee
 *    weapons, whose long guns (effective range >= DEFAULT_KITE_RANGE) carry at least half the design's weapon dps:
 *    artillery, snipers, missile carriers, long-range skirmishers. Not brawlers, flamers, or tanks whose main guns
 *    are frontline-range.
 *  - focus: any design with a ranged weapon of effective range >= DEFAULT_FOCUS_RANGE. */
export function defaultOrders(d: Design | undefined): DefaultOrders {
  if (!d || !Array.isArray(d.mounts)) return { kite: false, focus: false };
  const key = `${d.chassis}|${d.mobility}|${d.mounts.join(',')}`;
  const hit = defaultOrdersCache.get(key);
  if (hit) return hit;
  let out: DefaultOrders = { kite: false, focus: false };
  try {
    const s = computeStats(d);
    let melee = false, total = 0, longDps = 0, longest = 0;
    for (const m of designModules(d)) {
      if (m.kind !== 'weapon') continue;
      const dps = weaponDps(m);
      total += dps;
      if (m.projectile === 'melee') { melee = true; continue; }
      const r = (m.range ?? 0) * s.rangeMult;
      longest = Math.max(longest, r);
      if (r >= DEFAULT_KITE_RANGE) longDps += dps;
    }
    out = {
      kite: !s.isStatic && !s.flying && s.size < 4 && !melee && longDps > 0 && longDps >= 0.5 * total,
      focus: longest >= DEFAULT_FOCUS_RANGE,
    };
  } catch { /* unknown parts: no defaults */ }
  defaultOrdersCache.set(key, out);
  return out;
}
