// Quick, parallel balance probe: small smart-deployed battles, a few seeds, one process per core.
//
//   node scripts/quickmatch.ts mix [budget[,budget..]=700] [seeds=3] designs...
//       half the budget on the design + half on a starter mix, vs the full budget on the mix (op-check style),
//       both sides of the field: ~50% = fairly priced.
//   node scripts/quickmatch.ts vs [budget=700] [seeds=3] A B [B2 ...]
//       A alone vs each B alone at equal supply (both sides of the field).
//
// A design is a starter id without its 'starter-' prefix (ironclad), or chassis/mobility/mount,mount,... (empty
// mount = blank). Env: QM_SET='{"ARMOR_PRICE":{"k":4},"SIZE_K":[..]}' patches stats.ts exports (objects merged,
// arrays replaced) in every worker (the starter mix keeps its unpatched prices unless QM_FREEZE=0); BAL_CAL / BAL_MOBCAL patch MODULE_CAL / MOBILITY_CAL; QM_PARTS='{"evasion":{..}}'
// patches module definitions. QM_JOBS = worker count (default nproc).
import { fork } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { Battle } from '../src/shared/sim/battle.ts';
import { smartDeploy } from '../src/shared/smartdeploy.ts';
import { MODULE_BY_ID } from '../src/shared/parts.ts';
import * as stats from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import type { Design } from '../src/shared/types.ts';

const { computeStats, validateDesign, clearPriceCache, MODULE_CAL, MOBILITY_CAL } = stats;
// the starter mix is bought at the unpatched prices (QM_FREEZE=0: at the patched ones), so a trial price change
// measures the tested design against the same opponent armies
const FROZEN = new Map(STARTER_DESIGNS.map((d) => [d.id, computeStats(d).cost]));
const mixCost = (d: Design) => (process.env.QM_FREEZE !== '0' && FROZEN.get(d.id)) || computeStats(d).cost;
if (process.env.QM_SET) for (const [k, v] of Object.entries(JSON.parse(process.env.QM_SET) as Record<string, unknown>)) {
  const t = (stats as unknown as Record<string, unknown>)[k];
  if (Array.isArray(t)) t.splice(0, t.length, ...(v as unknown[]));
  else if (t && typeof t === 'object') Object.assign(t, v);
  else throw new Error(`QM_SET: no mutable export ${k}`);
}
if (process.env.BAL_CAL) Object.assign(MODULE_CAL, JSON.parse(process.env.BAL_CAL));
if (process.env.BAL_MOBCAL) Object.assign(MOBILITY_CAL, JSON.parse(process.env.BAL_MOBCAL));
if (process.env.QM_PARTS) for (const [id, p] of Object.entries(JSON.parse(process.env.QM_PARTS) as Record<string, object>)) Object.assign(MODULE_BY_ID.get(id)!, p);
clearPriceCache();

function parse(s: string): Design {
  const st = STARTER_DESIGNS.find((d) => d.id === `starter-${s}` || d.id === s);
  if (st) return st;
  const [chassis, mobility, mounts] = s.split('/');
  return { id: s.slice(0, 40), name: s.slice(0, 24), chassis, mobility, mounts: (mounts ?? '').split(',').map((x) => x || null) };
}
const POOL = STARTER_DESIGNS.filter((d) => computeStats(d).size <= 3);
function buy(budget: number, pool: Design[], start: number): Design[] {
  const out: Design[] = []; let left = budget, i = start, miss = 0;
  while (miss < pool.length) { const d = pool[i++ % pool.length]; const c = pool.length > 1 ? mixCost(d) : computeStats(d).cost; if (c <= left) { out.push(d); left -= c; miss = 0; } else miss++; }
  return out;
}
const deploy = (list: Design[]) => {
  const n = new Map<Design, number>();
  for (const d of list) n.set(d, (n.get(d) ?? 0) + 1);
  return smartDeploy([...n].map(([d, k]) => ({ d, n: k })));
};
/** score of side 0 (1 win, 0.5 draw) over both sides of the field */
function pair(a: Design[], b: Design[], seed: number): number {
  const designs = [...new Map([...a, ...b].map((d) => [d.id, d])).values()];
  let sc = 0;
  for (const flip of [false, true]) {
    const r = new Battle({ seed: seed * 2 + (flip ? 1 : 0), sides: flip ? [{ designs, units: deploy(b) }, { designs, units: deploy(a) }] : [{ designs, units: deploy(a) }, { designs, units: deploy(b) }] });
    while (!r.done) r.step();
    const w = r.winner;
    sc += w === -1 ? 0.5 : (w === 0) !== flip ? 1 : 0;
  }
  return sc / 2;
}
interface Job { mode: string; budget: number; a: string; b?: string; seed: number }
function runJob(j: Job): number {
  const A = parse(j.a);
  if (j.mode === 'vs') {
    const B = parse(j.b!);
    const ca = computeStats(A).cost, cb = computeStats(B).cost;
    const na = Math.max(1, Math.round(j.budget / ca)), nb = Math.max(1, Math.round((na * ca) / cb));
    return pair(Array(na).fill(A), Array(nb).fill(B), 1000 + j.seed);
  }
  // (at least one copy: a titan in a small budget is bought anyway and both sides get the bigger budget)
  const mine = buy(j.budget / 2, [A], 0);
  if (!mine.length) mine.push(A);
  const spent = mine.reduce((t, x) => t + computeStats(x).cost, 0), total = Math.max(j.budget, 2 * spent);
  // the top-up and the opponent's army are the same round-robin mix (same start), so only the design differs
  const opp = buy(total, POOL, j.seed * 7);
  return pair([...mine, ...buy(total - spent, POOL, j.seed * 7)], opp, 1000 + j.seed);
}

if (process.argv[2] === '__worker') {
  process.on('message', (j: Job) => process.send!(runJob(j)));
} else {
  const mode = process.argv[2] ?? 'mix';
  // budget may be a comma list (900,1200,1500): every seed runs at each, which smooths out how many blocks fit
  const budgets = (process.argv[3] ?? '700').split(',').map(Number), seeds = Number(process.argv[4] ?? 3);
  const names = process.argv.slice(5);
  const jobs: (Job & { key: string })[] = [];
  const keys: string[] = [];
  const add = (key: string, j: Job) => { if (!keys.includes(key)) keys.push(key); for (let s = 0; s < seeds; s++) for (const budget of budgets) jobs.push({ ...j, budget, seed: s, key }); };
  for (const n of names) { const e = validateDesign(parse(n)); if (e.length) { console.log(n, 'INVALID', e.join('; ')); process.exit(1); } }
  if (mode === 'vs') for (const b of names.slice(1)) add(`${names[0]} vs ${b}`, { mode, budget: 0, a: names[0], b, seed: 0 });
  else for (const a of names) add(a, { mode, budget: 0, a, seed: 0 });
  const res = new Map<string, number[]>();
  const t0 = performance.now();
  const W = Math.min(jobs.length, Number(process.env.QM_JOBS ?? availableParallelism()));
  let next = 0, done = 0;
  await new Promise<void>((resolve) => {
    for (let w = 0; w < W; w++) {
      const c = fork(process.argv[1], ['__worker'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      let cur: (typeof jobs)[number] | undefined;
      const feed = () => { cur = jobs[next++]; if (cur) c.send(cur); else c.kill(); };
      c.on('message', (v: number) => { res.set(cur!.key, [...(res.get(cur!.key) ?? []), v]); if (++done === jobs.length) resolve(); feed(); });
      feed();
    }
  });
  for (const k of keys) {
    const v = res.get(k)!, d = parse(k.split(' vs ')[0]), s = computeStats(d);
    const extra = mode === 'vs' ? '' : `  cost ${String(s.cost).padStart(4)} x${s.squad}`;
    console.log(`${k.padEnd(40)} win ${String(Math.round((100 * v.reduce((a, b) => a + b, 0)) / v.length)).padStart(3)}%${extra}`);
  }
  console.log(`(${jobs.length * 2} battles, ${((performance.now() - t0) / 1000).toFixed(0)}s)`);
}
