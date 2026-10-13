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
  return (w.damage * (w.burst ?? 1)) / w.cooldown;
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
  let cost = c.cost + m.cost * size;
  let shield = 0;
  let heal = 0;
  let dps = 0;
  for (const mod of mods) {
    hp += mod.hp ?? 0;
    armor += mod.armor ?? 0;
    weight += mod.weight;
    cost += mod.cost;
    shield += mod.shield ?? 0;
    heal += mod.heal ?? 0;
    dps += weaponDps(mod);
  }
  const capacity = m.capacity[size - 1] || 1;
  const load = weight / capacity;
  const traits = [...c.traits, ...m.traits];
  let rangeMult = 1;
  if (traits.includes('rangeBoost')) rangeMult += 0.2;
  if (traits.includes('fortified')) rangeMult += 0.15;
  let range = 0;
  for (const mod of mods) if (mod.range && mod.kind === 'weapon') range = Math.max(range, mod.range * rangeMult);
  const sizeSpeed = size === 3 ? 0.85 : size === 2 ? 0.95 : 1;
  const speed = m.kind === 'static' ? 0 : m.speed * loadSpeedFactor(load) * sizeSpeed;
  const turn = m.turn * (load > 1 ? Math.max(0.5, 1 - (load - 1)) : 1);
  return {
    size, hp: Math.round(hp), armor, weight: Math.round(weight * 10) / 10, capacity, load,
    speed: Math.round(speed * 100) / 100, turn, cost: Math.ceil(cost / 5) * 5,
    flying: m.kind === 'air', isStatic: m.kind === 'static', range: Math.round(range * 10) / 10,
    dps: Math.round(dps), shield, heal, traits, rangeMult,
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
