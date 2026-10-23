// Balance harness. Run: node scripts/balance.ts [matches|army|all] [N]
//
//  matches: AI-vs-AI full matches per difficulty pair -> win rates, average match length.
//  army:    equal-cost army test of EVERY module. For each starter and for 1-3 generated designs per module
//           (weapons, utilities, armor; see moduleDesigns) buy ARMY_SUPPLY worth of the design and fight
//           armies of the reference field (starters; anti-air-only designs face an air field), several
//           seeds, both sides. Win rate ~50% = priced right; above = underpriced, below = overpriced.
//           Prints a per-design table, a per-module table (utility modules also show the delta against
//           the same carrier design without the module) and per-category averages.
//           Usage: node scripts/balance.ts army [seeds=3] [filter]   (filter: substring of design id or category)
//           Runs in 4 parallel shards.

import { aiDeck, aiDeploy, type AiDifficulty } from '../src/shared/ai.ts';
import { applyDeploy, newMatch, newPlayer, resolveRound, validateDeploy } from '../src/shared/match.ts';
import { CATEGORIES, CHASSIS, CHASSIS_BY_ID, MOBILITY, MODULES, pairingError } from '../src/shared/parts.ts';
import { MOBILITY_CAL, MODULE_CAL, SIZE_K, computeStats, validateDesign } from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { runBattle } from '../src/shared/sim/battle.ts';
import { writeFileSync } from 'node:fs';
import { fork } from 'node:child_process';
import type { Design, Placement } from '../src/shared/types.ts';

// fit_cal.py injects trial calibrations here (children inherit the env)
if (process.env.BAL_CAL) Object.assign(MODULE_CAL, JSON.parse(process.env.BAL_CAL));
if (process.env.BAL_MOBCAL) Object.assign(MOBILITY_CAL, JSON.parse(process.env.BAL_MOBCAL));
// BAL_CHASSIS = {chassisId: {hp, cost, armor, weight, agility}}: trial hull numbers (fit_cal.py fits hp/cost; copy into parts.ts)
if (process.env.BAL_CHASSIS) for (const [id, patch] of Object.entries(JSON.parse(process.env.BAL_CHASSIS) as Record<string, Record<string, number>>)) { const c = CHASSIS_BY_ID.get(id); if (c) Object.assign(c, patch); }
if (process.env.BAL_SIZEK) SIZE_K.splice(0, 5, ...(JSON.parse(process.env.BAL_SIZEK) as number[]));

const mode = process.argv[2] ?? 'all';
const N = Number(process.argv[3] ?? 3);

function matches() {
  const pairs: [AiDifficulty, AiDifficulty][] = [['normal', 'normal'], ['hard', 'easy'], ['hard', 'normal'], ['normal', 'easy']];
  for (const [A, B] of pairs) {
    const wins = [0, 0, 0];
    let rounds = 0, maxMs = 0;
    for (let s = 1; s <= N; s++) {
      // alternate sides so side bias cancels
      const flip = s % 2 === 0;
      const d0 = flip ? B : A, d1 = flip ? A : B;
      const m = newMatch('b', 'ai', s * 7919, newPlayer('0', aiDeck(s * 2, d0), true), newPlayer('1', aiDeck(s * 2 + 1, d1), true));
      while (m.status === 'deploy') {
        for (const side of [0, 1] as const) {
          const t = performance.now();
          const a = aiDeploy(m, side, side ? d1 : d0);
          maxMs = Math.max(maxMs, performance.now() - t);
          const e = validateDeploy(m, side, a);
          if (e) throw new Error(`invalid AI deploy: ${e}`);
          applyDeploy(m, side, a);
        }
        resolveRound(m);
      }
      rounds += m.history.length;
      const w = m.winner ?? -1;
      if (w === -1) wins[2]++;
      else wins[(w === 0) !== flip ? 0 : 1]++;
    }
    console.log(`${A} vs ${B}: ${A} ${wins[0]} / ${B} ${wins[1]} / draw ${wins[2]}  avg rounds ${(rounds / N).toFixed(2)}  max decision ${maxMs.toFixed(0)}ms`);
  }
}

// Economy: 600 starting supply, +120/round -> a mid-game army is ~1200 supply (a 16-squad block costs 90+, a
// single medium 20-60, a giant ~300, a titan ~500).
const ARMY_SUPPLY = Number(process.env.BAL_SUPPLY ?? 1200);
/** Budget when a giant/titan is involved on either side. */
const BIG_SUPPLY = Number(process.env.BAL_BIG_SUPPLY ?? 1600);
/** Keep armies under the sim-unit cap (match.ts MAX_SIM_UNITS = 240) so supply is never silently dropped. */
const UNIT_CAP = 220;
const SHARDS = 4;
const FIELD_DIV = Math.max(1, Number(process.env.BAL_FIELD_DIV ?? 1));
/** BAL_MIX=1 (default): mixed-army test. Each design gets MIX_SHARE of the budget, topped up with a reference mix of
 *  starters, and fights the full budget of the same mix (MIX_PER_SEED mixes per seed, both sides). This is what the
 *  design adds to a real army. BAL_MIX=0: the old pure-army test (the design alone vs each starter alone), which is
 *  dominated by rock-paper-scissors: a ground-only gun loses every fight against the air starters however strong it
 *  is, so the fit under-priced strong ground-only weapons (ATGM, artillery) and over-priced anti-air ones. */
const MIX = process.env.BAL_MIX !== '0';
const MIX_SHARE = Number(process.env.BAL_MIX_SHARE ?? 0.6);
const MIX_PER_SEED = Number(process.env.BAL_MIX_PER_SEED ?? 4);
/** reference mix pool: every starter up to size 3 (ground, air, anti-air, artillery, support) */
const MIX_POOL: Design[] = STARTER_DESIGNS.filter((d) => computeStats(d).size <= 3);

/** Fillers that top up a giant/titan army (bought in equal supply shares): a balanced, cheap-ish mix. */
const FILLER_IDS = ['starter-bulwark', 'starter-buzzsaw', 'starter-tankbuster', 'starter-skyguard'];
const FILLER: Design[] = STARTER_DESIGNS.filter((d) => FILLER_IDS.includes(d.id));

const stats = new Map<string, ReturnType<typeof computeStats>>();
const st = (d: Design) => {
  const k = `${d.chassis}/${d.mobility}/${d.mounts.join(',')}`;
  let s = stats.get(k);
  if (!s) stats.set(k, (s = computeStats(d)));
  return s;
};
/** Rounding-free block cost: the model's unit cost times the squad size. Armies are sized with this so the
 *  50-supply price rounding (a separate, per-design matter, see the starter table) does not pollute the
 *  per-module calibration; the supply actually granted is blocks * the real block price. */
const rawCost = (d: Design) => st(d).unitCost * st(d).squad; // player-scale (raw / PRICE_DIV)

interface Spec { d: Design; n: number }
/** Army of ~`S` raw supply: pure blocks of one design; giants/titans (size >= 4) are bought as ~55% of the budget
 *  in big blocks (at least one) with the rest spent on FILLER, i.e. "a 3500-supply army containing one titan". */
function plan(d: Design, S: number): { specs: Spec[]; spend: number } {
  const raw = rawCost(d);
  if (st(d).size < 4) {
    // (blocks: one block = one 16-unit squad for size-1 designs, one unit otherwise)
    const n = Math.max(1, Math.min(Math.round(S / raw), Math.floor(UNIT_CAP / st(d).squad)));
    return { specs: [{ d, n }], spend: n * raw };
  }
  const nBig = Math.max(1, Math.round((0.55 * S) / raw));
  const specs: Spec[] = [{ d, n: nBig }];
  let spend = nBig * raw;
  const rest = S - spend;
  if (rest > 150) for (const f of FILLER) {
    const n = Math.round(rest / FILLER.length / rawCost(f));
    if (n > 0) { specs.push({ d: f, n }); spend += n * rawCost(f); }
  }
  return { specs, spend };
}

/** Place the specs on `side` with the normal AI's formation logic, one design at a time. */
function army(specs: Spec[], side: 0 | 1, seed: number): { place: Placement[]; designs: Design[] } {
  const designs = specs.map((s, i) => ({ ...s.d, id: `x${i}` }));
  const m = newMatch('a', 'ai', seed, newPlayer('a', designs.slice(0, 1), true), newPlayer('b', designs.slice(0, 1), true));
  const me = m.players[side];
  const place: Placement[] = [];
  specs.forEach((s, i) => {
    // earlier designs stay in the deck (so the AI knows their footprints) but are made unbuyable via an empty name
    const deck = designs.map((d, j) => (j === i ? d : { ...d, name: '' }));
    me.deck = deck;
    m.players[1 - side as 0 | 1].deck = deck;
    me.supply = s.n * st(s.d).cost;
    const a = aiDeploy(m, side, 'normal');
    for (const p of a.place) { place.push(p); me.board.push(p); me.nextUid = Math.max(me.nextUid, p.uid + 1); }
  });
  return { place, designs };
}

/** A reference mix worth ~S: starters bought round-robin from a seed-dependent starting point (seed k's mix is the
 *  same for the tested side's top-up and the opponent's army). */
function mixSpecs(S: number, k: number): { specs: Spec[]; spend: number } {
  const n = new Map<Design, number>();
  let left = S, spend = 0, i = (k * 5) % MIX_POOL.length, misses = 0;
  while (misses < MIX_POOL.length) {
    const d = MIX_POOL[i++ % MIX_POOL.length];
    const c = rawCost(d);
    if (c <= left) { n.set(d, (n.get(d) ?? 0) + 1); left -= c; spend += c; misses = 0; } else misses++;
  }
  return { specs: [...n].map(([d, c]) => ({ d, n: c })), spend };
}

interface TestDesign { d: Design; module: string | null; base: boolean; carrier: string }

/** Generate sensible designs for each module. Utilities/armor ride on a carrier design with a standard weapon;
 *  the same carrier without the module is emitted as a `base` row so the module's effect can be isolated. */
function moduleDesigns(): TestDesign[] {
  const out: TestDesign[] = [];
  const add = (id: string, module: string | null, base: boolean, carrier: string, chassis: string, mobility: string, mounts: (string | null)[]) => {
    const d: Design = { id, name: id.slice(0, 24), chassis, mobility, mounts };
    if (validateDesign(d).length === 0) out.push({ d, module, base, carrier });
  };
  const seenBase = new Set<string>();
  for (const mod of MODULES) {
    const m = mod.id;
    if (mod.kind === 'weapon') {
      const melee = mod.projectile === 'melee';
      const f = (x: string | null) => (mod.targetsGround === false ? null : x); // anti-air-only designs stay anti-air-only
      // mount classes: S (light), M (medium), L (giant), XL (titan)
      if (mod.mount === 'S') {
        add(`t-${m}-a`, m, false, '', 'raider', melee ? 'hover' : 'halftrack', [m, null]);
        add(`t-${m}-b`, m, false, '', 'raider', melee ? 'jumpjets' : 'legs', [m, m]);
        add(`t-${m}-c`, m, false, '', melee ? 'scout' : 'drone', melee ? 'hover' : 'rotor', [m]);
      } else if (mod.mount === 'M') {
        add(`t-${m}-a`, m, false, '', 'warden', melee ? 'treads' : 'halftrack', [m, melee ? 'plateL' : null]);
        add(`t-${m}-b`, m, false, '', 'striker', melee ? 'jumpjets' : 'halftrack', [m, m, null]);
        add(`t-${m}-c`, m, false, '', melee ? 'striker' : 'gunship', melee ? 'treads' : 'rotor', melee ? [m, 'plateM', 'plateL'] : [m, null]);
      } else if (mod.mount === 'L') {
        add(`t-${m}-a`, m, false, '', 'goliath', 'megatracks', melee ? [m, 'plateH', 'plateH', 'plateM'] : [m, f('cannon'), f('cannon'), f('autocannon')]);
        add(`t-${m}-b`, m, false, '', 'leviathan', 'megatracks', melee ? [m, m, 'plateM', 'plateM'] : [m, m, f('autocannon'), f('autocannon')]);
        add(`t-${m}-c`, m, false, '', 'goliath', 'spider', [m, null, null, null]);
        add(`t-${m}-d`, m, false, '', 'carrier', 'gravlift', [m, null, null, null]);
      } else {
        add(`t-${m}-a`, m, false, '', 'titan', 'megatracks', melee ? [m, 'plateG', 'plateH', 'plateH', 'plateM'] : [m, f('cannon'), f('cannon'), f('cannon'), f('autocannon')]);
        add(`t-${m}-b`, m, false, '', 'citadel', 'megatracks', melee ? [m, m, 'plateG', 'plateM', 'plateM', 'plateL'] : [m, m, f('cannon'), f('autocannon'), f('autocannon'), f('laser')]);
        add(`t-${m}-c`, m, false, '', 'titan', 'titanlegs', [m, null, null, null, null]);
      }
    } else {
      // carriers: [chassis, mobility, mounts-with-slot-index-of-util, mounts-without]
      const carriers: [string, string, (string | null)[], number][] =
        mod.mount === 'S' ? [['warden', 'halftrack', ['autocannon', 'U'], 1], ['raider', 'legs', ['laser', 'U'], 1], ['striker', 'treads', ['cannon75', 'autocannon', 'U'], 2]]
        : mod.mount === 'M' ? [['striker', 'halftrack', ['autocannon', 'U', 'hmg'], 1], ['warden', 'treads', ['U', 'hmg'], 0], ['striker', 'spider', ['cannon75', 'U', 'laser'], 1]]
        : mod.mount === 'L' ? [['goliath', 'megatracks', ['U', 'cannon', 'cannon', 'autocannon'], 0], ['leviathan', 'megatracks', ['U', 'cannon', 'autocannon', 'autocannon'], 0], ['goliath', 'titanlegs', ['U', 'hmg', 'cannon', 'autocannon'], 0]]
        : [['titan', 'megatracks', ['U', 'cannon', 'cannon', 'cannon', 'autocannon'], 0], ['citadel', 'megatracks', ['U', 'cannon', 'cannon', 'autocannon', 'autocannon', 'laser'], 0], ['titan', 'titanlegs', ['U', 'cannon', 'cannon', 'hmg', 'autocannon'], 0]];
      carriers.forEach(([ch, mob, mounts], i) => {
        const key = `${ch}/${mob}/${mounts.join(',')}`;
        add(`t-${m}-${i}`, m, false, key, ch, mob, mounts.map((x) => (x === 'U' ? m : x)));
        if (!seenBase.has(key)) {
          seenBase.add(key);
          add(`base-${seenBase.size}-${ch}-${mob}`, null, true, key, ch, mob, mounts.map((x) => (x === 'U' ? null : x)));
        }
      });
    }
  }
  // plain frames: every legal chassis/mobility pairing with a neutral loadout (calibrates hulls and drives)
  const FILL: Record<string, string> = { S: 'laser', M: 'autocannon', L: 'cannon', XL: 'cannon' };
  for (const c of CHASSIS) {
    for (const mob of MOBILITY) {
      if (pairingError(c.id, mob.id)) continue;
      add(`f-${c.id}-${mob.id}`, null, false, '', c.id, mob.id, c.mounts.map((mc) => (c.traits.includes('airOnly') && mc === 'M' ? 'autocannon' : FILL[mc])));
    }
  }
  return out;
}

const AIR_FIELD: Design[] = [
  ...STARTER_DESIGNS.filter((d) => computeStats(d).flying),
  { id: 't-air-gunship', name: 'Gunship', chassis: 'gunship', mobility: 'rotor', mounts: ['autocannon', 'rockets'] },
  { id: 't-air-dart', name: 'Dart', chassis: 'drone', mobility: 'jet', mounts: ['laser'] },
  { id: 't-air-raider', name: 'Air Raider', chassis: 'raider', mobility: 'rotor', mounts: ['hmg', 'atgm'] },
  { id: 't-air-jetwing', name: 'Jetwing', chassis: 'gunship', mobility: 'jet', mounts: ['swarm', 'laser'] },
  { id: 't-air-carrier', name: 'Sky Carrier', chassis: 'carrier', mobility: 'gravlift', mounts: ['missilebattery', 'cannon', 'autocannon', 'autocannon'] },
].filter((d) => validateDesign(d).length === 0);

const antiAirOnly = (d: Design) => {
  const ws = d.mounts.map((id) => MODULES.find((m) => m.id === id)).filter((m) => m?.kind === 'weapon');
  return ws.length > 0 && ws.every((m) => m!.targetsGround === false);
};

interface Result { id: string; score: number; games: number }

/** Run the fights for the designs of this shard; returns raw scores. */
function runShard(pool: Design[], seeds: number, shard: number): Result[] {
  const res: Result[] = [];
  pool.forEach((d, i) => {
    if (i % SHARDS !== shard) return;
    let score = 0, games = 0;
    if (MIX) {
      const S = st(d).size >= 4 ? BIG_SUPPLY : ARMY_SUPPLY;
      const pd = plan(d, S * MIX_SHARE);
      for (let s = 0; s < seeds; s++) {
        for (let k = 0; k < MIX_PER_SEED; k++) {
          const mixK = s * MIX_PER_SEED + k;
          const top = mixSpecs(S - pd.spend, mixK);
          const opp = mixSpecs(pd.spend + top.spend, mixK);
          const mine = [...pd.specs, ...top.specs];
          for (const side of [0, 1] as const) {
            const other = (1 - side) as 0 | 1;
            const A = army(mine, side, s + 1);
            const B = army(opp.specs, other, s + 101);
            const units: [Placement[], Placement[]] = [[], []];
            const designs: [Design[], Design[]] = [[], []];
            units[side] = A.place; designs[side] = A.designs;
            units[other] = B.place; designs[other] = B.designs;
            const r = runBattle({ seed: 1000 + mixK * 31 + side, sides: [{ designs: designs[0], units: units[0] }, { designs: designs[1], units: units[1] }] });
            score += r.winner === side ? 1 : r.winner === -1 ? 0.5 : 0;
            games++;
          }
        }
      }
      res.push({ id: d.id, score, games });
      return;
    }
    const field = antiAirOnly(d) ? AIR_FIELD : STARTER_DESIGNS;
    // BAL_FIELD_DIV=k: each design faces only every k-th opponent (staggered by design index) -> k times faster, noisier
    for (const [j, e] of field.entries()) {
      if (e.id === d.id || (j + i) % FIELD_DIV !== 0) continue;
      // giants/titans on either side -> the big budget for the whole pairing
      const S = st(d).size >= 4 || st(e).size >= 4 ? BIG_SUPPLY : ARMY_SUPPLY;
      const pd = plan(d, S);
      const pe = plan(e, pd.spend);
      for (let s = 0; s < seeds; s++) {
        for (const side of [0, 1] as const) {
          const other = (1 - side) as 0 | 1;
          const A = army(pd.specs, side, s + 1);
          const B = army(pe.specs, other, s + 101);
          const units: [Placement[], Placement[]] = [[], []];
          const designs: [Design[], Design[]] = [[], []];
          units[side] = A.place; designs[side] = A.designs;
          units[other] = B.place; designs[other] = B.designs;
          const r = runBattle({ seed: 1000 + s * 31 + side, sides: [{ designs: designs[0], units: units[0] }, { designs: designs[1], units: units[1] }] });
          score += r.winner === side ? 1 : r.winner === -1 ? 0.5 : 0;
          games++;
        }
      }
    }
    res.push({ id: d.id, score, games });
  });
  return res;
}

function buildPool(filter: string): { tests: TestDesign[]; pool: Design[] } {
  const tests = moduleDesigns();
  const fits = (t: TestDesign) => {
    if (!filter) return true;
    const cat = t.module ? MODULES.find((m) => m.id === t.module)!.category : '';
    return t.d.id.includes(filter) || cat === filter || t.module === filter;
  };
  // keep base rows whose carrier is used by a kept test design
  const kept = tests.filter((t) => !t.base && fits(t));
  const carriers = new Set(kept.map((t) => t.carrier).filter(Boolean));
  const baseKept = tests.filter((t) => t.base && (!filter || carriers.has(t.carrier)));
  const starters = STARTER_DESIGNS.filter((d) => !filter || d.id.includes(filter));
  const all = [...kept, ...baseKept];
  return { tests: all, pool: [...starters, ...all.map((t) => t.d)] };
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const flag = (r: number) => (r >= 0.65 ? '  HIGH' : r <= 0.35 ? '  LOW' : '');

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

async function armyTest() {
  const seeds = Math.max(1, Math.min(N, 6));
  const filter = process.argv[4] ?? '';
  const { tests, pool } = buildPool(filter);
  const results: Result[] = [];
  await Promise.all(Array.from({ length: SHARDS }, (_, shard) => new Promise<void>((resolve, reject) => {
    const child = fork(process.argv[1], ['shard', String(seeds), filter], { env: { ...process.env, BAL_SHARD: String(shard) }, stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
    child.on('message', (m) => results.push(...(m as Result[])));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`shard ${shard} exited ${code}`))));
  })));
  void pool;
  const byId = new Map<string, Design>([...STARTER_DESIGNS, ...tests.map((t) => t.d)].map((d) => [d.id, d]));
  if (process.env.BAL_OUT) {
    const dump = results.map((r) => {
      const d = byId.get(r.id)!;
      const s = computeStats(d);
      const t = tests.find((x) => x.d.id === r.id);
      return { id: r.id, module: t?.module ?? null, base: t?.base ?? false, carrier: t?.carrier ?? '', rate: r.score / r.games, mounts: d.mounts, chassis: d.chassis, mobility: d.mobility, size: s.size, cost: s.cost, unitCost: s.unitCost, hp: s.hp, armor: s.armor, speed: s.speed, range: s.range, offense: s.offense, ehp: s.ehp, flying: s.flying };
    });
    writeFileSync(process.env.BAL_OUT, JSON.stringify(dump));
  }
  const rate = new Map(results.map((r) => [r.id, r.score / r.games]));
  const baseRate = new Map(tests.filter((t) => t.base).map((t) => [t.carrier, rate.get(t.d.id)!]));

  console.log(`\nEqual-cost armies (${ARMY_SUPPLY} supply, ${BIG_SUPPLY} when a giant/titan is involved; ${seeds} seeds, both sides); AA-only designs face an air field.\n--- per design (cost = block price) ---`);
  const rows = [...byId.values()].filter((d) => rate.has(d.id)).sort((a, b) => rate.get(b.id)! - rate.get(a.id)!);
  for (const d of rows) {
    const r = rate.get(d.id)!;
    const s = computeStats(d);
    console.log(`${pct(r).padStart(4)}  ${String(s.cost).padStart(4)}  ${d.id.padEnd(30)} ${d.chassis}/${d.mobility} [${d.mounts.join(',')}]${antiAirOnly(d) ? ' (vs air)' : ''}${flag(r)}`);
  }

  // per module
  const modRows: { id: string; cat: string; mount: string; rate: number; delta: number | null; n: number }[] = [];
  for (const mod of MODULES) {
    const ts = tests.filter((t) => t.module === mod.id && rate.has(t.d.id));
    if (!ts.length) continue;
    const r = mean(ts.map((t) => rate.get(t.d.id)!));
    const deltas = ts.filter((t) => t.carrier && baseRate.has(t.carrier)).map((t) => rate.get(t.d.id)! - baseRate.get(t.carrier)!);
    modRows.push({ id: mod.id, cat: mod.category, mount: mod.mount, rate: r, delta: deltas.length ? mean(deltas) : null, n: ts.length });
  }
  modRows.sort((a, b) => b.rate - a.rate);
  console.log('\n--- per module (mean win rate of its designs; delta = vs same carrier without the module) ---');
  for (const r of modRows) {
    console.log(`${pct(r.rate).padStart(4)}  ${r.id.padEnd(14)} ${r.cat.padEnd(11)} ${r.mount} n=${r.n}${r.delta == null ? '' : `  delta ${r.delta >= 0 ? '+' : ''}${(r.delta * 100).toFixed(0)}`}${flag(r.rate)}`);
  }

  console.log('\n--- per category (mean of module means) ---');
  const cats = CATEGORIES.map((c) => {
    const ms = modRows.filter((m) => m.cat === c.id);
    return { id: c.id, rate: mean(ms.map((m) => m.rate)), n: ms.length, lo: Math.min(...ms.map((m) => m.rate)), hi: Math.max(...ms.map((m) => m.rate)) };
  }).filter((c) => c.n > 0).sort((a, b) => b.rate - a.rate);
  for (const c of cats) console.log(`${pct(c.rate).padStart(4)}  ${c.id.padEnd(12)} modules=${c.n}  range ${pct(c.lo)}-${pct(c.hi)}`);

  console.log('\n--- per module mount class (mean of module means) ---');
  for (const mc of ['L', 'M', 'H', 'G', 'T']) {
    const ms = modRows.filter((m) => m.mount === mc);
    if (ms.length) console.log(`${pct(mean(ms.map((m) => m.rate))).padStart(4)}  ${mc}  modules=${ms.length}`);
  }

  console.log('\n--- per design size class (chassis size; non-base designs) ---');
  const sizeOf = (d: Design) => computeStats(d).size;
  const nb = rows.filter((d) => !tests.find((t) => t.d.id === d.id && t.base));
  const groups: [string, (d: Design) => boolean][] = [['starters', (d) => d.id.startsWith('starter-')], ['module designs', (d) => d.id.startsWith('t-')], ['plain frames', (d) => d.id.startsWith('f-')], ['all', () => true]];
  for (const [name, f] of groups) {
    const parts: string[] = [];
    for (let z = 1; z <= 5; z++) {
      const xs = nb.filter((d) => sizeOf(d) === z && f(d)).map((d) => rate.get(d.id)!);
      if (xs.length) parts.push(`size${z} ${pct(mean(xs))} (n=${xs.length})`);
    }
    console.log(`${name.padEnd(15)} ${parts.join('   ')}`);
  }
  const big = nb.filter((d) => sizeOf(d) >= 4).map((d) => ({ id: d.id, r: rate.get(d.id)! }));
  const bigBad = big.filter((x) => x.r < 0.35 || x.r > 0.65);
  if (bigBad.length) console.log(`giant/titan designs outside 35-65%: ${bigBad.map((x) => `${x.id} ${pct(x.r)}`).join(', ')}`);

  // ---- plain frames: per chassis / role / mobility ----
  const frames = nb.filter((d) => d.id.startsWith('f-'));
  if (frames.length) {
    const chRows = CHASSIS.map((c) => {
      const xs = frames.filter((d) => d.chassis === c.id).map((d) => rate.get(d.id)!);
      return { id: c.id, size: c.size, roles: c.roles, rate: mean(xs), n: xs.length, lo: Math.min(...xs), hi: Math.max(...xs) };
    }).filter((c) => c.n > 0).sort((a, b) => b.rate - a.rate);
    console.log('\n--- plain frames per chassis (mean over legal mobilities; range) ---');
    for (const c of chRows) console.log(`${pct(c.rate).padStart(4)}  ${c.id.padEnd(12)} size${c.size} n=${String(c.n).padEnd(2)} ${pct(c.lo)}-${pct(c.hi)}  [${c.roles.join(',')}]${flag(c.rate)}`);
    console.log('\n--- plain frames per role (chassis tagged with the role; viable = chassis mean within 40-60%) ---');
    const roles = [...new Set(CHASSIS.flatMap((c) => c.roles))];
    for (const r of roles) {
      const cs = chRows.filter((c) => c.roles.includes(r));
      const viable = cs.filter((c) => c.rate >= 0.4 && c.rate <= 0.6);
      console.log(`${r.padEnd(11)} mean ${pct(mean(cs.map((c) => c.rate)))}  viable ${viable.length}/${cs.length}  ${cs.map((c) => `${c.id} ${pct(c.rate)}`).join(', ')}`);
    }
    console.log('\n--- plain frames per mobility (mean) ---');
    for (const m of MOBILITY) {
      const xs = frames.filter((d) => d.mobility === m.id).map((d) => rate.get(d.id)!);
      if (xs.length) console.log(`${pct(mean(xs)).padStart(4)}  ${m.id.padEnd(11)} n=${xs.length}`);
    }
  }
  console.log('\n--- starter price rounding (raw = unit cost x squad; block price rounds to 50) ---');
  for (const d of STARTER_DESIGNS) {
    const x = st(d), raw = rawCost(d);
    console.log(`${d.id.padEnd(22)} raw ${String(raw).padStart(5)}  price ${String(x.cost).padStart(5)}  ${((x.cost / raw - 1) * 100).toFixed(1).padStart(6)}%`);
  }

  const inBand = modRows.filter((m) => m.rate >= 0.35 && m.rate <= 0.65).length;
  const sd = Math.sqrt(mean(modRows.map((m) => (m.rate - 0.5) ** 2)));
  console.log(`\n${inBand}/${modRows.length} modules within 35-65%; rms deviation from 50%: ${(sd * 100).toFixed(1)} pts`);
}

if (mode === 'shard') {
  const { pool } = buildPool(process.argv[4] ?? '');
  process.send!(runShard(pool, Number(process.argv[3]), Number(process.env.BAL_SHARD)));
  process.exit(0);
}
if (mode === 'matches' || mode === 'all') matches();
if (mode === 'army' || mode === 'all') await armyTest();
