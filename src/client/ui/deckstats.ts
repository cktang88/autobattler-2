// Deck analysis: what a set of designs can and can't do, so players can see whether a deck has holes before a match.

import { METERS_PER_CELL } from '../../shared/grid.ts';
import { START_SUPPLY } from '../../shared/match.ts';
import { MODULE_BY_ID } from '../../shared/parts.ts';
import { computeStats, weaponDps } from '../../shared/stats.ts';
import type { Design, UnitStats } from '../../shared/types.ts';

export type Cap = 'aa' | 'armor' | 'swarm' | 'long' | 'front' | 'support' | 'detect' | 'air' | 'fast';

export const CAPS: { id: Cap; label: string; tip: string }[] = [
  { id: 'aa', label: 'Anti-air', tip: 'Can shoot aircraft' },
  { id: 'armor', label: 'Anti-armor', tip: 'Armor-piercing or heavy single hits that crack tanks' },
  { id: 'swarm', label: 'Anti-swarm', tip: 'Splash, flame, chains or spread that shred light squads' },
  { id: 'long', label: 'Long range', tip: 'Reaches 80 m or more: artillery, snipers, missiles' },
  { id: 'front', label: 'Frontline', tip: 'Tough enough to hold the line (lots of hp, armor or shields)' },
  { id: 'support', label: 'Support', tip: 'Repairs or shields allies' },
  { id: 'detect', label: 'Detection', tip: 'Sensors that reveal cloaked units' },
  { id: 'air', label: 'Aircraft', tip: 'Flying units: only anti-air can hit them' },
  { id: 'fast', label: 'Fast', tip: 'Moves 15 m/s or faster: raiders, flankers' },
];

export interface DesignInfo {
  d: Design;
  st: UnitStats;
  cost: number;
  /** combined dps of weapons that can hit ground / air */
  gnd: number;
  air: number;
  /** longest reach in metres */
  rangeM: number;
  speedMs: number;
  caps: Set<Cap>;
}

export function designInfo(d: Design): DesignInfo | null {
  let st: UnitStats;
  try { st = computeStats(d); } catch { return null; }
  const caps = new Set<Cap>();
  let gnd = 0, air = 0;
  for (const id of d.mounts) {
    const m = id ? MODULE_BY_ID.get(id) : undefined;
    if (!m) continue;
    if (m.kind === 'weapon') {
      const dps = weaponDps(m) * st.squad;
      if (m.targetsGround) gnd += dps;
      if (m.targetsAir) { air += dps; caps.add('aa'); }
      if ((m.ap ?? 0) >= 0.3 || (m.damage ?? 0) >= 60) caps.add('armor');
      if ((m.splash ?? 0) > 0 || m.chain || m.burn || (m.pellets ?? 1) > 2 || m.category === 'flame') caps.add('swarm');
    }
    if (m.heal || m.shieldAura) caps.add('support');
    if (m.detect) caps.add('detect');
  }
  const rangeM = st.range * METERS_PER_CELL;
  const speedMs = st.isStatic ? 0 : st.speed * METERS_PER_CELL;
  if (rangeM >= 80) caps.add('long');
  if (st.ehp >= 1500 || st.armor >= 12 || st.hp * st.squad >= 2000) caps.add('front');
  if (st.heal > 0) caps.add('support');
  if (st.flying) caps.add('air');
  if (speedMs >= 15) caps.add('fast');
  return { d, st, cost: st.cost, gnd, air, rangeM, speedMs, caps };
}

export interface DeckReport {
  infos: DesignInfo[];
  /** designs per capability */
  capCount: Record<Cap, number>;
  /** cost histogram */
  buckets: { label: string; lo: number; hi: number; n: number }[];
  avgCost: number;
  minCost: number;
  maxCost: number;
  avgSpeed: number;
  maxRange: number;
  gnd: number;
  air: number;
  /** designs affordable with round-1 supply */
  roundOne: number;
  warnings: { level: 'bad' | 'warn' | 'good'; text: string }[];
}

export const COST_BUCKETS: [string, number, number][] = [
  ['< 80', 0, 80], ['80–159', 80, 160], ['160–299', 160, 300], ['300–599', 300, 600], ['600+', 600, Infinity],
];

export function analyzeDeck(deck: Design[]): DeckReport {
  const infos = deck.map(designInfo).filter((x): x is DesignInfo => !!x);
  const capCount = Object.fromEntries(CAPS.map((c) => [c.id, 0])) as Record<Cap, number>;
  for (const i of infos) for (const c of i.caps) capCount[c]++;
  const costs = infos.map((i) => i.cost);
  const n = Math.max(1, infos.length);
  const r: DeckReport = {
    infos, capCount,
    buckets: COST_BUCKETS.map(([label, lo, hi]) => ({ label, lo, hi, n: costs.filter((c) => c >= lo && c < hi).length })),
    avgCost: costs.reduce((a, b) => a + b, 0) / n,
    minCost: costs.length ? Math.min(...costs) : 0,
    maxCost: costs.length ? Math.max(...costs) : 0,
    avgSpeed: infos.filter((i) => i.speedMs > 0).reduce((a, i) => a + i.speedMs, 0) / Math.max(1, infos.filter((i) => i.speedMs > 0).length),
    maxRange: infos.reduce((a, i) => Math.max(a, i.rangeM), 0),
    gnd: infos.reduce((a, i) => a + i.gnd, 0),
    air: infos.reduce((a, i) => a + i.air, 0),
    roundOne: costs.filter((c) => c <= START_SUPPLY).length,
    warnings: [],
  };
  const w = r.warnings;
  if (!infos.length) { w.push({ level: 'bad', text: 'Your deck is empty.' }); return r; }
  if (!capCount.aa) w.push({ level: 'bad', text: 'No anti-air: enemy aircraft will be untouchable.' });
  else if (capCount.aa === 1) w.push({ level: 'warn', text: 'Only one design can hit aircraft. A heavy air push could swamp it.' });
  if (!capCount.armor) w.push({ level: 'warn', text: 'No anti-armor: heavy tanks will shrug off your fire.' });
  if (!capCount.swarm) w.push({ level: 'warn', text: 'No splash, flame or chain weapons: big light squads will be hard to clear.' });
  if (!capCount.front) w.push({ level: 'warn', text: 'No frontline: nothing tough to soak damage for the rest of the army.' });
  if (!capCount.long) w.push({ level: 'warn', text: 'Nothing reaches 80 m: artillery and snipers will outrange you.' });
  if (!capCount.detect) w.push({ level: 'warn', text: 'No sensors: cloaked units stay hidden until they fire.' });
  if (r.minCost > START_SUPPLY) w.push({ level: 'bad', text: `Nothing fits round 1's ${START_SUPPLY} supply: you can't deploy at all in round 1.` });
  else if (r.minCost > START_SUPPLY / 2) w.push({ level: 'warn', text: `Cheapest design is ${r.minCost}: hard to spend supply efficiently early on.` });
  if (r.buckets[0].n + r.buckets[1].n === 0) w.push({ level: 'warn', text: 'No cheap units (under 160): nothing to fill leftover supply or screen with.' });
  if (infos.length < 6) w.push({ level: 'warn', text: `Only ${infos.length} designs: you have room for more answers.` });
  if (!w.some((x) => x.level !== 'good')) w.push({ level: 'good', text: 'Well rounded: every role is covered.' });
  return r;
}
