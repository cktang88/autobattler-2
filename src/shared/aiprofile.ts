// AI design profiling: what a design is good for, read from the part catalog (no hard-coded module ids). Shared by the
// AI deck builder / deploy planner (ai.ts) and the AI design pool (aipool.ts).

import { MODULE_BY_ID } from './parts.ts';
import { computeStats, defaultOrders, designModules, hitFactor, type DefaultOrders } from './stats.ts';
import type { Design, ModuleDef, UnitStats } from './types.ts';

export type Role = 'swarm' | 'frontline' | 'antiArmor' | 'antiAir' | 'artillery' | 'flyer' | 'support' | 'skirmisher';
export const ROLES: readonly Role[] = ['swarm', 'frontline', 'antiArmor', 'antiAir', 'artillery', 'flyer', 'support', 'skirmisher'];

/** One weapon of a design, as the matchup maths sees it. */
export interface WeaponInfo {
  /** sustained dps (damage x burst x pellets / cooldown, before armour) */
  dps: number;
  /** damage of one hit (one pellet) */
  hit: number;
  ap: number;
  air: boolean;
  ground: boolean;
  /** splash radius (cells; chain / pierce count as a little splash) */
  splash: number;
  range: number;
  minRange: number;
  /** share of shots that connect (stats.ts hitFactor, capped at 1) */
  acc: number;
  /** homing missile (an ECM jammer breaks its lock) */
  missile: boolean;
  melee: boolean;
  /** damage kinds for reactive / mirror */
  explosive: boolean;
  energy: boolean;
}

export interface Profile {
  stats: UnitStats;
  /** price of one block */
  cost: number;
  /** model value of one unit */
  unitCost: number;
  /** splash radius of the largest splash weapon (cells) */
  splashRadius: number;
  melee: boolean;
  size: number;
  /** dps usable vs air */
  aaDps: number;
  /** dps usable vs ground */
  groundDps: number;
  /** dps-weighted armor pierce of ground weapons (0..1) */
  ap: number;
  /** dps from splash/chain weapons */
  splashDps: number;
  minRange: number;
  range: number;
  /** effective toughness rating per cost */
  toughPerCost: number;
  ehp: number;
  flying: boolean;
  heal: number;
  role: Role;
  /** the design's default kite / focus orders (shared with the sim and client) */
  defaults: DefaultOrders;
  weapons: WeaponInfo[];
  /** defensive kit */
  cloak: 'stealth' | 'phantom' | null;
  detect: boolean;
  smoke: boolean;
  jammer: boolean;
  /** reactive tiles (explosive hits) and energy resist (0..0.75) */
  reactive: number;
  energyResist: number;
  /** projects a shield dome / repairs allies */
  dome: boolean;
}

const profileCache = new Map<string, Profile>();
export const designKey = (d: Design) => `${d.chassis}|${d.mobility}|${d.mounts.join(',')}`;

export function weaponDps(w: ModuleDef): number {
  if (w.kind !== 'weapon' || !w.damage || !w.cooldown) return 0;
  return (w.damage * (w.burst ?? 1) * (w.pellets ?? 1)) / w.cooldown;
}

export function profile(d: Design): Profile {
  const key = designKey(d);
  const hit = profileCache.get(key);
  if (hit) return hit;
  const s = computeStats(d);
  const mods = designModules(d);
  let aaDps = 0, groundDps = 0, apSum = 0, splashDps = 0, minRange = 0, splashRadius = 0, melee = false;
  const weapons: WeaponInfo[] = [];
  let cloak: Profile['cloak'] = null, detect = false, smoke = false, jammer = false, reactive = 0, energyResist = 0, dome = false;
  for (const m of mods) {
    if (m.cloak) cloak = cloak === 'phantom' ? cloak : m.cloak as Profile['cloak'];
    if (m.detect) detect = true;
    if (m.smoke) smoke = true;
    if (m.jammer) jammer = true;
    if (m.reactive) reactive += m.reactive;
    if (m.energyResist) energyResist = Math.min(0.75, energyResist + m.energyResist);
    if (m.shieldAura) dome = true;
    if (m.kind !== 'weapon') continue;
    const dps = weaponDps(m);
    if (m.targetsAir) aaDps += dps * (m.airBonus ?? 1);
    if (m.targetsGround !== false) {
      groundDps += dps;
      apSum += dps * (m.ap ?? 0);
    }
    if ((m.splash ?? 0) >= 0.8 || (m.chain ?? 0) > 0 || m.pierce) splashDps += dps * (1 + (m.splash ?? 0) + (m.chain ?? 0) * 0.5);
    if ((m.splash ?? 0) >= 0.8 || m.category === 'flame' || m.category === 'artillery') splashRadius = Math.max(splashRadius, m.splash ?? 1);
    if (m.projectile === 'melee') melee = true;
    if (m.minRange) minRange = Math.max(minRange, m.minRange);
    const p = m.projectile;
    weapons.push({
      dps, hit: m.damage ?? 0, ap: m.ap ?? 0, air: !!m.targetsAir, ground: m.targetsGround !== false,
      splash: Math.max(m.splash ?? 0, (m.chain ?? 0) > 0 ? 0.8 : 0, m.pierce ? 0.6 : 0, m.category === 'flame' ? 0.6 : 0),
      range: (m.range ?? 1) * s.rangeMult, minRange: m.minRange ?? 0,
      acc: Math.min(1, hitFactor(m)), missile: p === 'missile', melee: p === 'melee',
      explosive: p === 'shell' || p === 'rocket' || p === 'missile' || p === 'arc' || p === 'orb',
      energy: p === 'beam' || p === 'lightning' || p === 'rail' || p === 'flame' || (p === 'orb' && m.category === 'energy'),
    });
  }
  const ehp = (s.hp + s.shield) * (1 + s.armor / 12) * (s.traits.includes('evasive') ? 1.3 : 1);
  const p: Profile = {
    stats: s, cost: s.cost, unitCost: s.unitCost, splashRadius, melee, size: s.size, aaDps, groundDps, ap: groundDps > 0 ? apSum / groundDps : 0,
    splashDps, minRange, range: s.range, toughPerCost: ehp / Math.max(1, s.unitCost), ehp,
    flying: s.flying, heal: s.heal, role: 'skirmisher', defaults: defaultOrders(d),
    weapons, cloak, detect, smoke, jammer, reactive, energyResist, dome,
  };
  p.role = classify(p);
  profileCache.set(key, p);
  return p;
}

export function classify(p: Pick<Profile, 'flying' | 'heal' | 'range' | 'minRange' | 'groundDps' | 'aaDps' | 'ap' | 'unitCost' | 'size' | 'toughPerCost'>): Role {
  if (p.flying) return 'flyer';
  if (p.heal > 0) return 'support';
  if (p.range >= 9 && (p.minRange > 0 || p.groundDps === 0 || p.aaDps < p.groundDps * 0.5)) return 'artillery';
  if (p.aaDps > 0 && (p.groundDps === 0 || p.aaDps >= p.groundDps * 1.4)) return 'antiAir';
  if (p.ap >= 0.55 && p.groundDps > 0) return 'antiArmor';
  if (p.unitCost <= 15) return 'swarm';
  if (p.size >= 2 && p.toughPerCost >= 17.5) return 'frontline';
  return 'skirmisher';
}

export const isHealer = (p: Profile) => p.heal > 0 || p.stats.traits.includes('repairAura');

/** Module lookup that tolerates unknown ids. */
export const moduleOf = (id: string | null | undefined): ModuleDef | undefined => (id ? MODULE_BY_ID.get(id) : undefined);
