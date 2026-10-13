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
import { CATEGORIES, CHASSIS, MOBILITY, MODULES, pairingError } from '../src/shared/parts.ts';
import { computeStats, validateDesign } from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { runBattle } from '../src/shared/sim/battle.ts';
import { writeFileSync } from 'node:fs';
import { fork } from 'node:child_process';
import type { Design, Placement } from '../src/shared/types.ts';

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

const ARMY_SUPPLY = 1500;
const SHARDS = 4;

/** Buy ARMY_SUPPLY of one design and place it with the normal AI's formation logic. */
function army(d: Design, side: 0 | 1, seed: number): Placement[] {
  const deck = [{ ...d, id: 'x' }];
  const m = newMatch('a', 'ai', seed, newPlayer('a', deck, true), newPlayer('b', deck, true));
  m.players[side].supply = ARMY_SUPPLY;
  const a = aiDeploy(m, side, 'normal');
  return a.place;
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
      if (mod.mount === 'L') {
        add(`t-${m}-a`, m, false, '', 'raider', melee ? 'hover' : 'halftrack', [m, null]);
        add(`t-${m}-b`, m, false, '', 'raider', melee ? 'jumpjets' : 'legs', [m, m]);
        add(`t-${m}-c`, m, false, '', melee ? 'scout' : 'drone', melee ? 'hover' : 'rotor', [m]);
      } else if (mod.mount === 'M') {
        add(`t-${m}-a`, m, false, '', 'warden', melee ? 'treads' : 'halftrack', [m, melee ? 'plateL' : null]);
        add(`t-${m}-b`, m, false, '', 'striker', melee ? 'jumpjets' : 'halftrack', [m, m, null]);
        add(`t-${m}-c`, m, false, '', melee ? 'striker' : 'gunship', melee ? 'treads' : 'rotor', melee ? [m, 'plateM', 'plateL'] : [m, null]);
      } else {
        add(`t-${m}-a`, m, false, '', 'longarm', melee ? 'treads' : 'halftrack', [m]);
        add(`t-${m}-b`, m, false, '', 'bastion', 'treads', [m, 'plateM', null]);
        add(`t-${m}-c`, m, false, '', 'colossus', 'treads', [m, melee ? 'plateH' : null, null, null]);
      }
    } else {
      // carriers: [chassis, mobility, mounts-with-slot-index-of-util, mounts-without]
      const carriers: [string, string, (string | null)[], number][] =
        mod.mount === 'L' ? [['warden', 'halftrack', ['autocannon', 'U'], 1], ['raider', 'legs', ['laser', 'U'], 1], ['striker', 'treads', ['cannon75', 'autocannon', 'U'], 2]]
        : mod.mount === 'M' ? [['striker', 'halftrack', ['autocannon', 'U', 'hmg'], 1], ['warden', 'treads', ['U', 'hmg'], 0], ['striker', 'spider', ['cannon75', 'U', 'laser'], 1]]
        : [['bastion', 'treads', ['U', 'autocannon', 'cannon75'], 0], ['colossus', 'treads', ['cannon', 'U', 'autocannon', 'laser'], 1]];
      carriers.forEach(([ch, mob, mounts], i) => {
        const key = `${ch}/${mob}/${mounts.join(',')}`;
        add(`t-${m}-${i}`, m, false, key, ch, mob, mounts.map((x) => (x === 'U' ? m : x)));
        if (!seenBase.has(key)) {
          seenBase.add(key);
          add(`base-${i}-${ch}-${mob}-${mounts.map((x) => x === 'U' ? '_' : x).join('+')}`.slice(0, 40), null, true, key, ch, mob, mounts.map((x) => (x === 'U' ? null : x)));
        }
      });
    }
  }
  // plain frames: every legal chassis/mobility pairing with a neutral loadout (calibrates hulls and drives)
  const FILL: Record<string, string> = { L: 'laser', M: 'autocannon', H: 'cannon' };
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
    const field = antiAirOnly(d) ? AIR_FIELD : STARTER_DESIGNS;
    for (const e of field) {
      if (e.id === d.id) continue;
      for (let s = 0; s < seeds; s++) {
        for (const side of [0, 1] as const) {
          const other = (1 - side) as 0 | 1;
          const units: [Placement[], Placement[]] = [[], []];
          units[side] = army(d, side, s + 1);
          units[other] = army(e, other, s + 101);
          const designs: [Design[], Design[]] = [[], []];
          designs[side] = [{ ...d, id: 'x' }];
          designs[other] = [{ ...e, id: 'x' }];
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
  if (process.env.BAL_OUT) {
    const dump = results.map((r) => {
      const d = [...STARTER_DESIGNS, ...tests.map((t) => t.d)].find((x) => x.id === r.id)!;
      const st = computeStats(d);
      const t = tests.find((x) => x.d.id === r.id);
      return { id: r.id, module: t?.module ?? null, base: t?.base ?? false, carrier: t?.carrier ?? '', rate: r.score / r.games, mounts: d.mounts, chassis: d.chassis, mobility: d.mobility, cost: st.cost, hp: st.hp, armor: st.armor, speed: st.speed, range: st.range, offense: st.offense, ehp: st.ehp, flying: st.flying };
    });
    writeFileSync(process.env.BAL_OUT, JSON.stringify(dump));
  }
  const rate = new Map(results.map((r) => [r.id, r.score / r.games]));
  const byId = new Map<string, Design>([...STARTER_DESIGNS, ...tests.map((t) => t.d)].map((d) => [d.id, d]));
  const baseRate = new Map(tests.filter((t) => t.base).map((t) => [t.carrier, rate.get(t.d.id)!]));

  console.log(`\nEqual-cost armies (${ARMY_SUPPLY} supply each, ${seeds} seeds, both sides); AA-only designs face an air field.\n--- per design ---`);
  const rows = [...byId.values()].filter((d) => rate.has(d.id)).sort((a, b) => rate.get(b.id)! - rate.get(a.id)!);
  for (const d of rows) {
    const r = rate.get(d.id)!;
    console.log(`${pct(r).padStart(4)}  ${String(computeStats(d).cost).padStart(4)}  ${d.id.padEnd(30)} ${d.chassis}/${d.mobility} [${d.mounts.join(',')}]${antiAirOnly(d) ? ' (vs air)' : ''}${flag(r)}`);
  }

  // per module
  const modRows: { id: string; cat: string; rate: number; delta: number | null; n: number }[] = [];
  for (const mod of MODULES) {
    const ts = tests.filter((t) => t.module === mod.id && rate.has(t.d.id));
    if (!ts.length) continue;
    const r = ts.reduce((a, t) => a + rate.get(t.d.id)!, 0) / ts.length;
    const deltas = ts.filter((t) => t.carrier && baseRate.has(t.carrier)).map((t) => rate.get(t.d.id)! - baseRate.get(t.carrier)!);
    modRows.push({ id: mod.id, cat: mod.category, rate: r, delta: deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null, n: ts.length });
  }
  modRows.sort((a, b) => b.rate - a.rate);
  console.log('\n--- per module (mean win rate of its designs; delta = vs same carrier without the module) ---');
  for (const r of modRows) {
    console.log(`${pct(r.rate).padStart(4)}  ${r.id.padEnd(14)} ${r.cat.padEnd(11)} n=${r.n}${r.delta == null ? '' : `  delta ${r.delta >= 0 ? '+' : ''}${(r.delta * 100).toFixed(0)}`}${flag(r.rate)}`);
  }

  console.log('\n--- per category (mean of module means) ---');
  const cats = CATEGORIES.map((c) => {
    const ms = modRows.filter((m) => m.cat === c.id);
    return { id: c.id, rate: ms.reduce((a, m) => a + m.rate, 0) / Math.max(1, ms.length), n: ms.length, lo: Math.min(...ms.map((m) => m.rate)), hi: Math.max(...ms.map((m) => m.rate)) };
  }).filter((c) => c.n > 0).sort((a, b) => b.rate - a.rate);
  for (const c of cats) console.log(`${pct(c.rate).padStart(4)}  ${c.id.padEnd(12)} modules=${c.n}  range ${pct(c.lo)}-${pct(c.hi)}`);
  const inBand = modRows.filter((m) => m.rate >= 0.35 && m.rate <= 0.65).length;
  const sd = Math.sqrt(modRows.reduce((a, m) => a + (m.rate - 0.5) ** 2, 0) / Math.max(1, modRows.length));
  console.log(`\n${inBand}/${modRows.length} modules within 35-65%; rms deviation from 50%: ${(sd * 100).toFixed(1)} pts`);
}

if (mode === 'shard') {
  const { pool } = buildPool(process.argv[4] ?? '');
  process.send!(runShard(pool, Number(process.argv[3]), Number(process.env.BAL_SHARD)));
  process.exit(0);
}
if (mode === 'matches' || mode === 'all') matches();
if (mode === 'army' || mode === 'all') await armyTest();
