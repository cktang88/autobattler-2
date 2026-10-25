// Overpowered-design check (real sim, both sides of the field, several seeds): half the budget spent on one design
// plus half on a mix of starter designs, vs the full budget on the mix. ~50% = fairly priced; far above = underpriced,
// far below = overpriced. (Pure mono armies are no test: an army that can't hit aircraft loses however strong it is.)
// Small armies (~5 blocks a side at the default 700 budget), like a real round, not 240-unit brawls.
// Run: node scripts/op-check.ts [budget=700] [seeds=4] [ids...]   (ids from the list below; default all)
//      OP_DESIGNS='[{"id":"x","chassis":"..","mobility":"..","mounts":[..]}]' adds designs.
import { readFileSync } from 'node:fs';
import { Battle } from '../src/shared/sim/battle.ts';
import { smartDeploy } from '../src/shared/smartdeploy.ts';
import { AP_VALUE, MODULE_CAL, TOUGH, TEAM_FIT, TEAM_VALUE, clearPriceCache, computeStats, validateDesign } from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { blockDims, DEPLOY_W, DEPLOY_D, rectsOverlap } from '../src/shared/grid.ts';
import type { Design, Placement } from '../src/shared/types.ts';

if (process.env.BAL_APK) AP_VALUE.k = Number(process.env.BAL_APK);
if (process.env.TV_TOUGH) { Object.assign(TOUGH, JSON.parse(process.env.TV_TOUGH)); clearPriceCache(); }
if (process.env.BAL_CAL) { Object.assign(MODULE_CAL, JSON.parse(process.env.BAL_CAL)); clearPriceCache(); }
// TV_BASE=1: analytic prices only (stats.ts TEAM_FIT zeroed); TV_FIT=<json>: turn the team-value correction on with a trial fit (scripts/teamvalue.ts)
if (process.env.TV_FIT) { const f = JSON.parse(readFileSync(process.env.TV_FIT, 'utf8')); TEAM_VALUE.on = true; TEAM_FIT.b0 = f.b0; Object.assign(TEAM_FIT.beta, f.beta); Object.assign(TEAM_FIT.center, f.center); clearPriceCache(); }
if (process.env.TV_BASE === '1') { TEAM_FIT.b0 = 0; for (const k of Object.keys(TEAM_FIT.beta) as (keyof typeof TEAM_FIT.beta)[]) TEAM_FIT.beta[k] = 0; clearPriceCache(); }

const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id, chassis, mobility, mounts });
export const CANDIDATES: Design[] = [
  D('pokies', 'mantis', 'legs', ['atgm', 'atgm']),
  D('swarmies', 'interceptor', 'jet', ['twinmg', 'mg']),
  D('hornet', 'gunship', 'rotor', ['sam', 'swarm']),
  D('pokiesA', 'mantis', 'legs', ['atgm', 'aamissile']),
  D('strato', 'stratobomber', 'jet', ['bombs', 'bombs', 'plateM', 'shieldL']),
  D('deltabomb', 'deltawing', 'jet', ['bombs', 'mg', 'shieldL']),
  D('heavybomber', 'bomberhull', 'gravlift', ['bombs', 'heavybomb', 'plateM']),
  D('clusterjet', 'stratobomber', 'jet', ['clusterbombs', 'heavybomb', 'plateM', 'shieldL']),
  D('fighterjet', 'strikejet', 'jet', ['aamissile', 'aamissile', 'targeting']),
  D('harasserjet', 'deltawing', 'jet', ['rockets', 'mg', 'targeting']),
  ...(process.env.OP_DESIGNS ? (JSON.parse(process.env.OP_DESIGNS) as Design[]).map((d) => ({ name: d.id, ...d })) : []),
];

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
/** buy round-robin from the pool until the budget runs out */
export function army(budget: number, pool: Design[], seed: number): Design[] {
  const out: Design[] = []; let left = budget; let i = seed * 3;
  for (let g = 0; g < 600; g++) { const d = pool[i++ % pool.length]; const c = computeStats(d).cost; if (c <= left) { out.push(d); left -= c; } if (left < 40) break; }
  return out;
}
/** OP_DEPLOY=smart (default): both sides deploy like a sensible player (shared/smartdeploy.ts); naive: packed rows */
const DEPLOY = process.env.OP_DEPLOY ?? 'smart';
const deploy = (list: Design[]): Placement[] => {
  if (DEPLOY !== 'smart') return pack(list);
  const n = new Map<Design, number>();
  for (const d of list) n.set(d, (n.get(d) ?? 0) + 1);
  return smartDeploy([...n].map(([d, k]) => ({ d, n: k })));
};
function fight(a: Design[], b: Design[], seed: number): number {
  const designs = [...new Map([...a, ...b].map((d) => [d.id, d])).values()];
  const r = new Battle({ seed, sides: [{ designs, units: deploy(a) }, { designs, units: deploy(b) }] });
  while (!r.done) r.step();
  return r.winner;
}
/** win% of (half budget on `d` + mix) vs (full budget on the mix) */
export function winRate(d: Design, budget: number, seeds: number, pool: Design[]): number {
  let w = 0, n = 0;
  for (let s = 0; s < seeds; s++) {
    const mine = army(budget / 2, [d], 0);
    const spent = mine.reduce((t, x) => t + computeStats(x).cost, 0);
    const a = [...mine, ...army(budget - spent, pool, s + 7)], b = army(budget, pool, s);
    const r1 = fight(a, b, 100 + s), r2 = fight(b, a, 200 + s);
    w += (r1 === 0 ? 1 : r1 === -1 ? 0.5 : 0) + (r2 === 1 ? 1 : r2 === -1 ? 0.5 : 0); n += 2;
  }
  return Math.round((100 * w) / n);
}

const isMain = process.argv[1]?.endsWith('op-check.ts');
if (isMain) {
  const budget = Number(process.argv[2] ?? 700), seeds = Number(process.argv[3] ?? 4);
  const ids = process.argv.slice(4);
  const pool = STARTER_DESIGNS.filter((d) => computeStats(d).size <= 3);
  const list = [...CANDIDATES, ...STARTER_DESIGNS].filter((d) => !ids.length || ids.includes(d.id));
  for (const d of list) {
    if (validateDesign(d).length) { console.log(d.id, 'INVALID', validateDesign(d)); continue; }
    const st = computeStats(d);
    console.log(`${d.id.padEnd(14)} cost ${String(st.cost).padStart(4)} x${st.squad}  win ${String(winRate(d, budget, seeds, pool)).padStart(3)}%`);
  }
}
