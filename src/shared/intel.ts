// Garage "Intel": what a player needs to fit a design into an army, from the sim's own rules.
//   matchups      equal-supply quick fights against reference designs (the real answer to "what does it beat?")
//   damageVs      damage per 100 supply against target types, after armour / penetration / shields / air bonus
//   toughness     how long 100 supply of it lasts under small arms, autocannons and anti-tank fire
//   reach/speed   where its range and speed sit among the reference designs
// Ratings compare against the mean of a reference roster (the starters), so "good" means good for its price.

import { Battle } from './sim/battle.ts';
import { blockDims, DEPLOY_D, DEPLOY_W, rectsOverlap } from './grid.ts';
import { computeStats, designModules, hitFactor, weaponDps } from './stats.ts';
import type { Design, Placement, UnitStats } from './types.ts';

export interface TargetType { key: string; label: string; armor: number; shield: number; air: boolean; squad: boolean; tip: string }
/** reference targets: armour values span the hulls in the game (light frames 0-2, mediums ~5, heavy tanks ~12, giants 20+) */
export const TARGETS: TargetType[] = [
  { key: 'light', label: 'Light squads', armor: 0, shield: 0, air: false, squad: true, tip: 'Unarmoured squads of small units: splash and fast-firing guns shine' },
  { key: 'medium', label: 'Medium armour', armor: 5, shield: 0, air: false, squad: false, tip: 'Armour 5: medium hulls' },
  { key: 'heavy', label: 'Heavy armour', armor: 12, shield: 0, air: false, squad: false, tip: 'Armour 12: heavy tanks and walkers. Small rounds mostly bounce off' },
  { key: 'giant', label: 'Giants & titans', armor: 22, shield: 0, air: false, squad: false, tip: 'Armour 20+: only penetrating weapons do real damage' },
  { key: 'shield', label: 'Shielded', armor: 5, shield: 1, air: false, squad: false, tip: 'Units behind a shield: the shield takes every hit at full strength, armour and penetration don\'t matter' },
  { key: 'air', label: 'Aircraft', armor: 2, shield: 0, air: true, squad: false, tip: 'Flyers: only anti-air capable weapons can hit them' },
];

/** Damage per second one unit of the design deals to a target type (the sim's per-hit rule, times expected accuracy). */
export function dpsVs(d: Design, t: TargetType): number {
  let v = 0;
  for (const m of designModules(d)) {
    if (m.kind !== 'weapon' || !m.damage) continue;
    if (t.air ? !m.targetsAir : !m.targetsGround) continue;
    const raw = m.damage * (t.air ? m.airBonus ?? 1 : 1);
    // shields soak each hit at full strength; armour takes a flat amount off every hull hit (never below 15%)
    const eff = t.shield ? raw * (m.shieldMult ?? 1) : Math.max(raw * 0.15, raw - t.armor * (1 - (m.ap ?? 0)));
    let w = weaponDps(m) * (eff / m.damage) * Math.min(1, hitFactor(m));
    if (t.squad && m.splash) w *= 1 + 0.8 * m.splash; // a blast catches several units of a packed squad
    if (t.squad && m.chain) w *= 1 + 0.5 * m.chain;
    v += w;
  }
  return v;
}

/** Seconds a block's hit points last under 100 dps of hits of size `hit` with penetration `ap` (shields soak first). */
export function lastsUnder(s: UnitStats, hit: number, ap: number): number {
  const perHit = Math.max(hit * 0.15, hit - s.armor * (1 - ap));
  const hitsToKill = s.hp / perHit + s.shield / hit;
  return (hitsToKill * hit * s.squad) / 100;
}
export const THREATS: { key: string; label: string; hit: number; ap: number; tip: string }[] = [
  { key: 'small', label: 'Small arms', hit: 9, ap: 0, tip: 'Machine guns: many 9-damage hits, no penetration (armour matters most here)' },
  { key: 'ac', label: 'Autocannons', hit: 35, ap: 0.5, tip: 'Medium rounds: 35-damage hits, half penetration' },
  { key: 'at', label: 'Anti-tank', hit: 110, ap: 1, tip: 'Cannons and anti-tank missiles: big hits that ignore armour' },
];

export interface IntelNumbers {
  /** damage per second per 100 supply against each TARGETS entry */
  dmg: number[];
  /** seconds 100 supply lasts under 100 dps of each THREATS entry */
  tough: number[];
  range: number;
  speed: number;
}

export function intelNumbers(d: Design): IntelNumbers | null {
  let s: UnitStats;
  try { s = computeStats(d); } catch { return null; }
  const per100 = 100 / Math.max(1, s.cost);
  return {
    dmg: TARGETS.map((t) => dpsVs(d, t) * s.squad * per100),
    tough: THREATS.map((th) => lastsUnder(s, th.hit, th.ap) * per100),
    range: s.range,
    speed: s.speed,
  };
}

/** Mean of each number over a reference roster (for "good for its price" ratings). Zero entries (e.g. no anti-air)
 *  don't count toward the mean of a damage column, so ground-only designs don't drag the air column down. */
export function referenceMeans(ref: Design[]): IntelNumbers {
  const all = ref.map(intelNumbers).filter((x): x is IntelNumbers => !!x);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    dmg: TARGETS.map((_, i) => mean(all.map((n) => n.dmg[i]).filter((v) => v > 0))),
    tough: THREATS.map((_, i) => mean(all.map((n) => n.tough[i]))),
    range: mean(all.map((n) => n.range)),
    speed: mean(all.map((n) => n.speed)),
  };
}

/** share (0..1) of the reference designs this value beats */
export function percentile(v: number, ref: number[]): number {
  if (!ref.length) return 0.5;
  return ref.filter((x) => x < v).length / ref.length + ref.filter((x) => x === v).length / (2 * ref.length);
}

// ---------------------------------------------------------------- matchups

export interface Matchup { opp: Design; score: number; games: number }

function pack(list: Design[]): Placement[] {
  const out: Placement[] = []; const occ: { x: number; y: number; w: number; h: number }[] = []; let uid = 1;
  for (const d of list) {
    const s = computeStats(d); const { w, h } = blockDims(s, 1);
    let placed = false;
    for (let y = 0; y + h <= DEPLOY_D && !placed; y++) for (let x = 0; x + w <= DEPLOY_W && !placed; x++) {
      if (occ.some((o) => rectsOverlap(x, y, w, h, o.x, o.y, o.w, o.h))) continue;
      occ.push({ x, y, w, h }); out.push({ uid: uid++, designId: d.id, x, y, level: 1, round: 1, spacing: 1 }); placed = true;
    }
  }
  return out;
}
/** blocks of one design worth about `budget` supply (at least one) */
function army(d: Design, budget: number): Design[] {
  const c = Math.max(1, computeStats(d).cost);
  return Array.from({ length: Math.max(1, Math.round(budget / c)) }, () => d);
}

/** One equal-supply fight from each side of the field: 1 = `d` won both, 0.5 = split / draws, 0 = lost both. */
export function matchup(d: Design, opp: Design, budget: number, seed = 1): Matchup {
  const a = { ...d, id: 'intel-a' }, b = { ...opp, id: 'intel-b' };
  const A = army(a, budget), B = army(b, Math.max(budget, computeStats(a).cost * A.length));
  let score = 0;
  for (const side of [0, 1] as const) {
    const sides: [{ designs: Design[]; units: Placement[] }, { designs: Design[]; units: Placement[] }] = side === 0
      ? [{ designs: [a], units: pack(A) }, { designs: [b], units: pack(B) }]
      : [{ designs: [b], units: pack(B) }, { designs: [a], units: pack(A) }];
    const r = new Battle({ seed: seed + side, sides });
    while (!r.done) r.step();
    score += r.winner === side ? 1 : r.winner === -1 ? 0.5 : 0;
  }
  return { opp, score: score / 2, games: 2 };
}

/** Run matchups against `refs` a few per call (keeps the UI responsive); `onDone` gets them sorted best first. */
export function runMatchups(d: Design, refs: Design[], budget: number, onStep: (done: Matchup[]) => void, onDone: (all: Matchup[]) => void, chunk = 2): () => void {
  let i = 0, stopped = false;
  const out: Matchup[] = [];
  const step = () => {
    if (stopped) return;
    for (let k = 0; k < chunk && i < refs.length; k++, i++) {
      try { out.push(matchup(d, refs[i], budget)); } catch { /* unbuildable reference: skip */ }
    }
    onStep(out);
    if (i < refs.length) setTimeout(step, 0);
    else onDone([...out].sort((x, y) => y.score - x.score));
  };
  setTimeout(step, 0);
  return () => { stopped = true; };
}

