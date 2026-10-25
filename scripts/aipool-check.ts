// Cost-efficiency check for AI pool designs (src/shared/aipool.ts), or any list of candidate designs.
//
//   node scripts/aipool-check.ts [seeds=3] [candidates.ts]
//
// Mixed-army test, as in scripts/balance.ts: each design takes 60% of a 1200-supply army (bought at its real block
// price, rounding included), topped up with a reference mix of starters, against the same mix for the same supply;
// several mixes per seed, both sides. Anti-air-only designs face an air-heavy mix. ~50% = priced right; the AI pool
// wants designs at or above ~50% (they are what the AI actually pays for). `candidates.ts` must export
// `CANDIDATES: Design[]` (optionally with a `role` field); default = the curated pool.

import { fork } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import * as OLD from './ai-baseline.ts';
import { newMatch, newPlayer } from '../src/shared/match.ts';
import { computeStats, validateDesign } from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { runBattle } from '../src/shared/sim/battle.ts';
import { AI_POOL } from '../src/shared/aipool.ts';
import { MODULES } from '../src/shared/parts.ts';
import { profile } from '../src/shared/ai.ts';
import type { Design, Placement } from '../src/shared/types.ts';

type Cand = Design & { role?: string };
const SUPPLY = 1200, SHARE = 0.6, MIXES = 4, WORKERS = 4, UNIT_CAP = 220;
const MIX_POOL = STARTER_DESIGNS.filter((d) => computeStats(d).size <= 3);
const AIR_POOL: Design[] = [...STARTER_DESIGNS.filter((d) => computeStats(d).flying && computeStats(d).size <= 3),
  { id: 'x-gunship', name: 'Gunship', chassis: 'gunship', mobility: 'rotor', mounts: ['autocannon', 'rockets'] },
  { id: 'x-jetwing', name: 'Jetwing', chassis: 'deltawing', mobility: 'jet', mounts: ['swarm', 'laser', 'mg'] },
  STARTER_DESIGNS.find((d) => d.id === 'starter-bulwark')!, STARTER_DESIGNS.find((d) => d.id === 'starter-hunter')!];
const cost = (d: Design) => computeStats(d).cost;

interface Spec { d: Design; n: number }
function mix(pool: Design[], S: number, k: number): { specs: Spec[]; spend: number } {
  const n = new Map<Design, number>();
  let left = S, spend = 0, i = (k * 5) % pool.length, misses = 0;
  while (misses < pool.length) {
    const d = pool[i++ % pool.length];
    if (cost(d) <= left) { n.set(d, (n.get(d) ?? 0) + 1); left -= cost(d); spend += cost(d); misses = 0; } else misses++;
  }
  return { specs: [...n].map(([d, c]) => ({ d, n: c })), spend };
}
function army(specs: Spec[], side: 0 | 1, seed: number): { place: Placement[]; designs: Design[] } {
  const designs = specs.map((s, i) => ({ ...s.d, id: `x${i}` }));
  const m = newMatch('a', 'ai', seed, newPlayer('a', designs.slice(0, 1), true), newPlayer('b', designs.slice(0, 1), true));
  const me = m.players[side];
  const place: Placement[] = [];
  specs.forEach((s, i) => {
    const deck = designs.map((d, j) => (j === i ? d : { ...d, name: '' }));
    me.deck = deck; m.players[1 - side as 0 | 1].deck = deck;
    me.supply = s.n * cost(s.d);
    for (const p of OLD.aiDeploy(m, side, 'normal').place) { place.push(p); me.board.push(p); me.nextUid = Math.max(me.nextUid, p.uid + 1); }
  });
  return { place, designs };
}
/** anti-air designs (all their weapons, or most of their dps, are for aircraft) are tested against an air-heavy mix */
const aaOnly = (d: Design) => {
  const ws = d.mounts.map((id) => MODULES.find((m) => m.id === id)).filter((m) => m?.kind === 'weapon');
  if (ws.length > 0 && ws.every((m) => m!.targetsGround === false)) return true;
  const p = profile(d);
  return !p.flying && p.aaDps > 0 && p.aaDps >= p.groundDps * 1.4;
};

export function score(d: Design, seeds: number): number {
  const st = computeStats(d);
  const S = st.size >= 4 ? 1800 : SUPPLY;
  const pool = aaOnly(d) ? AIR_POOL : MIX_POOL;
  const n = Math.max(1, Math.min(Math.round((S * SHARE) / st.cost), Math.floor(UNIT_CAP / 2 / st.squad)));
  let sc = 0, games = 0;
  for (let s = 0; s < seeds; s++) for (let k = 0; k < MIXES; k++) {
    const mk = s * MIXES + k;
    const top = mix(pool, S - n * st.cost, mk);
    const opp = mix(pool, n * st.cost + top.spend, mk);
    for (const side of [0, 1] as const) {
      const other = (1 - side) as 0 | 1;
      const A = army([{ d, n }, ...top.specs], side, s + 1), B = army(opp.specs, other, s + 101);
      const units: [Placement[], Placement[]] = [[], []], designs: [Design[], Design[]] = [[], []];
      units[side] = A.place; designs[side] = A.designs; units[other] = B.place; designs[other] = B.designs;
      const r = runBattle({ seed: 1000 + mk * 31 + side, sides: [{ designs: designs[0], units: units[0] }, { designs: designs[1], units: units[1] }] });
      sc += r.winner === side ? 1 : r.winner === -1 ? 0.5 : 0;
      games++;
    }
  }
  return sc / games;
}

async function main() {
  const seeds = Number(process.argv[2] ?? 3);
  const file = process.argv[3];
  const cands: Cand[] = file ? (await import(pathToFileURL(resolve(file)).href)).CANDIDATES : AI_POOL;
  const bad = cands.filter((d) => validateDesign(d).length);
  for (const d of bad) console.log(`INVALID ${d.id}: ${validateDesign(d).join('; ')}`);
  const ok = cands.filter((d) => !validateDesign(d).length);
  const res = new Map<string, number>();
  await Promise.all(Array.from({ length: WORKERS }, (_, w) => new Promise<void>((done, fail) => {
    const child = fork(process.argv[1], ['--child', String(seeds), file ?? ''], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    child.on('message', (r) => { for (const [k, v] of r as [string, number][]) res.set(k, v); });
    child.on('exit', (c) => (c === 0 ? done() : fail(new Error(`worker ${w} exited ${c}`))));
    child.send(ok.filter((_, i) => i % WORKERS === w).map((d) => d.id));
  })));
  const rows = ok.map((d) => ({ d, r: res.get(d.id)!, st: computeStats(d) })).sort((a, b) => b.r - a.r);
  for (const { d, r, st } of rows) {
    console.log(`${(r * 100).toFixed(0).padStart(4)}%  ${String(st.cost).padStart(5)} x${String(st.squad).padEnd(2)} ${(d.role ?? '').padEnd(10)} ${d.id.padEnd(22)} ${d.chassis}/${d.mobility} [${d.mounts.join(',')}]${aaOnly(d) ? ' (vs air)' : ''}`);
  }
}

if (process.argv[2] === '--child') {
  const seeds = Number(process.argv[3]);
  const file = process.argv[4];
  const cands: Cand[] = file ? (await import(pathToFileURL(resolve(file)).href)).CANDIDATES : AI_POOL;
  process.on('message', (ids) => {
    const out = (ids as string[]).map((id) => [id, score(cands.find((d) => d.id === id)!, seeds)] as [string, number]);
    process.send!(out, () => process.exit(0));
  });
} else await main();
