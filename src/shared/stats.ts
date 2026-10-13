// Design -> UnitStats, plus design validation.

import { CHASSIS_BY_ID, MOBILITY_BY_ID, MODULE_BY_ID, fitsMount, pairingError } from './parts.ts';
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
/** reference enemy armor mix used to rate weapons */
const REF_ARMOR = [0, 5, 12];

/** Fraction of raw damage that gets through the reference armor mix (sim damage formula). */
export function armorEfficiency(damage: number, ap: number): number {
  let sum = 0;
  for (const a of REF_ARMOR) sum += Math.max(damage * 0.15, damage - a * (1 - ap)) / damage;
  return sum / REF_ARMOR.length;
}

/** Predicted damage-output rating of one weapon (or healing value of a repair module). */
export function weaponValue(w: ModuleDef, rangeMult = 1): number {
  const range = (w.range ?? 0) * rangeMult;
  const rangeF = Math.min(1.8, Math.max(0.6, Math.sqrt(range / 5)));
  if (w.heal) return w.heal * 1.6 * rangeF;
  if (w.kind !== 'weapon' || !w.damage || !w.cooldown) return 0;
  const shots = (w.burst ?? 1) * (w.pellets ?? 1);
  let v = weaponDps(w) * armorEfficiency(w.damage, w.ap ?? 0);
  v *= 1 + 0.6 * (w.splash ?? 0);
  v *= 1 + 0.45 * (w.chain ?? 0);
  if (w.pierce) v *= 1.5;
  if ((w.pellets ?? 1) > 1) v *= 0.7; // pellets rarely all land
  if (w.falloff != null) v *= 0.5 + 0.5 * w.falloff;
  const cyc = cycleTime(w);
  // burn refreshes rather than stacks: worth ~its dps on each target it keeps alight
  if (w.burn) v += w.burn.dps * Math.min(1, w.burn.duration / cyc) * (1 + 0.6 * (w.splash ?? 0));
  if (w.stun) v += ((w.stun * shots) / cyc) * 70 * (1 + 0.8 * (w.splash ?? 0));
  if (w.slow) v += (w.slow / cyc) * 18;
  if (w.disarm) v += (w.disarm / cyc) * 55;
  if (w.impulse) v += (Math.abs(w.impulse) / cyc) * 14 * (1 + 0.6 * (w.splash ?? 0));
  v *= 0.75 + 0.25 * (accuracyRating(w) / 100);
  if (w.projectile === 'missile') v *= 1.1; // homing: rarely misses
  if (w.minRange) v *= 0.9;
  const coverage = w.targetsGround && w.targetsAir ? 1 : w.targetsGround ? 0.85 : 0.55 * (w.airBonus ?? 1);
  return v * coverage * rangeF;
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
  const traits = [...c.traits, ...m.traits];
  let rangeMult = 1;
  if (traits.includes('rangeBoost')) rangeMult += 0.2;
  if (traits.includes('fortified')) rangeMult += 0.15;
  let spreadMult = traits.includes('stable') ? 0.5 : 1;
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
  }
  const capacity = m.capacity[size - 1] || 1;
  const load = weight / capacity;
  let range = 0;
  for (const mod of mods) if (mod.range && mod.kind === 'weapon') range = Math.max(range, mod.range * rangeMult);
  const sizeSpeed = size === 3 ? 0.85 : size === 2 ? 0.95 : 1;
  const speed = m.kind === 'static' ? 0 : m.speed * loadSpeedFactor(load) * sizeSpeed;
  const turn = m.turn * (load > 1 ? Math.max(0.5, 1 - (load - 1)) : 1);
  const flying = m.kind === 'air';
  const isStatic = m.kind === 'static';

  // ---- cost model ----
  let offense = 0;
  for (const mod of mods) offense += weaponValue(mod, rangeMult) * (mod.spread && spreadMult < 1 ? 1 + 0.15 * (1 - spreadMult) : 1);
  if (traits.includes('repairAura')) offense += 25;
  offense = Math.max(offense, 5);
  let ehp = (hp + 1.2 * shield) * (1 + armor / 15);
  if (traits.includes('evasive')) ehp *= 1.15;
  if (flying) ehp *= 1.2; // only anti-air can answer it
  const mobilityF = isStatic ? 0.85 : 1 + 0.08 * speed + (traits.includes('fireOnMove') ? 0.05 : 0) + (traits.includes('leap') ? 0.05 : 0);
  const power = Math.sqrt(offense * ehp) * mobilityF;
  const cost = Math.max(10, Math.ceil((PARTS_WEIGHT * partsCost + POWER_K * power) / 5) * 5);

  return {
    size, hp: Math.round(hp), armor, weight: Math.round(weight * 10) / 10, capacity, load,
    speed: Math.round(speed * 100) / 100, turn, cost,
    flying, isStatic, range: Math.round(range * 10) / 10,
    dps: Math.round(dps), shield, heal, traits, rangeMult, spreadMult,
    partsCost, offense: Math.round(offense), ehp: Math.round(ehp), power: Math.round(power),
  };
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
    if (mod.kind === 'weapon' || mod.kind === 'utility') weapons++;
  });
  if (weapons === 0) errs.push('Needs at least one weapon or utility module');
  if (errs.length) return errs;
  const s = computeStats(d);
  if (s.load > MAX_LOAD) errs.push(`Overloaded: ${s.weight} / ${s.capacity} weight (max ${Math.round(MAX_LOAD * 100)}%)`);
  return errs;
}

export const isValidDesign = (d: Design) => validateDesign(d).length === 0;
