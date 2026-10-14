// Per-weapon balance harness: every weapon module is grouped by role within its mount size (S/M/L/XL), mounted on a
// fixed neutral carrier (only the tested weapon varies), and fought at equal SUPPLY against its peers and against a
// common reference army. Win rate ~50% = priced right for its strength.
//
// Usage:
//   node scripts/weapon-balance.ts cost                    cost table + weapon share of unit cost
//   node scripts/weapon-balance.ts run [seeds=4] [filter]  pairwise + vs-reference fights (filter: size S|M|L|XL, group or weapon id)
//   node scripts/weapon-balance.ts fit [iters=4] [seeds=4] [filter]   iterate MODULE_CAL (printed; copy into stats.ts)
// Env: BAL_CAL='{"id":cal,...}' injects trial MODULE_CAL values (children inherit it). BAL_OUT=file writes JSON.
// Armies: pure blocks of the design; if one unit would exceed ~60% of the budget the rest is filled with a standard
// escort. Both sides spend the same raw supply (rounding-free unit cost x squad), see `plan`.
import { fork } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { aiDeploy } from '../src/shared/ai.ts';
import { newMatch, newPlayer } from '../src/shared/match.ts';
import { MODULE_BY_ID } from '../src/shared/parts.ts';
import { MODULE_CAL, computeStats, validateDesign } from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { runBattle } from '../src/shared/sim/battle.ts';
import type { Design, Placement } from '../src/shared/types.ts';

if (process.env.BAL_CAL) Object.assign(MODULE_CAL, JSON.parse(process.env.BAL_CAL));

export type Size = 'S' | 'M' | 'L' | 'XL';
export interface Group { size: Size; name: string; ids: string[]; air?: boolean }

/** Every weapon module, grouped by role/type within its mount size. Weapons are only ever compared inside a group
 *  (and against the common reference army), so each group should hold weapons that do the same job. */
export const GROUPS: Group[] = [
  // ---- S (light mounts) ----
  { size: 'S', name: 'riot (short-range)', ids: ['mg', 'twinmg', 'shotgun', 'flamer'] },
  { size: 'S', name: 'sustained mid-range', ids: ['hmg', 'ac20', 'laser', 'rocketL', 'guidedrocket'] },
  { size: 'S', name: 'precision (single target)', ids: ['sniper', 'atgm'] },
  { size: 'S', name: 'melee', ids: ['ram', 'buzzsaw', 'shockprod'] },
  { size: 'S', name: 'disruption', ids: ['stungun'] },
  { size: 'S', name: 'anti-air', ids: ['aamissile'], air: true },
  // ---- M (medium + heavy mounts) ----
  { size: 'M', name: 'riot (short-range)', ids: ['minigun', 'napalm', 'heatray', 'tesla', 'plasma'] },
  { size: 'M', name: 'sustained mid-range', ids: ['autocannon', 'twin30', 'ac40', 'twinlaser', 'rockets', 'swarm', 'sam', 'plasmaorb', 'incendiary'] },
  { size: 'M', name: 'precision (single target)', ids: ['cannon75', 'cannon', 'twin120', 'gauss', 'lightrail', 'railgun'] },
  { size: 'M', name: 'long-range artillery', ids: ['mortar', 'howitzer', 'barrage', 'mlrs', 'cruise'] },
  { size: 'M', name: 'melee', ids: ['claw', 'hammer', 'drill', 'chainsaw', 'plasmablade'] },
  { size: 'M', name: 'disruption', ids: ['sonic', 'disarm', 'gravity', 'slowbeam', 'empcannon', 'arclance'] },
  { size: 'M', name: 'anti-air', ids: ['flak', 'heavyflak', 'quad20'], air: true },
  { size: 'M', name: 'bombs (air carrier)', ids: ['bombs', 'clusterbombs'] },
  // ---- L (giant mounts) ----
  { size: 'L', name: 'riot (short-range)', ids: ['avenger', 'inferno', 'stormtower', 'grinder'] },
  { size: 'L', name: 'long-range / siege', ids: ['siege240', 'siegeplasma', 'missilebattery'] },
  { size: 'L', name: 'anti-air', ids: ['skyfortress'], air: true },
  // ---- XL (titan mounts) ----
  { size: 'XL', name: 'riot (short-range)', ids: ['annihilator', 'stormcore', 'titanfist'] },
  { size: 'XL', name: 'long-range', ids: ['doomsday', 'tactnuke', 'massdriver'] },
];

/** Neutral carrier per size class: only the tested weapon varies, every other slot is identical plating. */
export function carrier(size: Size, w: string): Design {
  const id = `w-${w}`;
  const bomb = MODULE_BY_ID.get(w)?.requires === 'air';
  const D = (chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id.slice(0, 24), chassis, mobility, mounts });
  if (size === 'S') return D('raider', 'halftrack', [w, w]);
  if (size === 'M') return bomb ? D('gunship', 'rotor', [w, null]) : D('warden', 'treads', [w, 'plateL']);
  if (size === 'L') return D('goliath', 'megatracks', [w, 'plateH', 'plateH', 'plateH']);
  return D('titan', 'titanlegs', [w, 'plateG', 'plateH', 'plateH', 'plateH']);
}

/** Per-size equal-supply budget (raw supply). */
const BUDGET: Record<Size, number> = { S: 10000, M: 10000, L: 20000, XL: 36000 };
const UNIT_CAP = 220;

const stats = new Map<string, ReturnType<typeof computeStats>>();
const st = (d: Design) => {
  const k = `${d.chassis}/${d.mobility}/${d.mounts.join(',')}`;
  let s = stats.get(k);
  if (!s) stats.set(k, (s = computeStats(d)));
  return s;
};
const rawCost = (d: Design) => st(d).unitCost * st(d).squad;
const byId = (id: string) => STARTER_DESIGNS.find((d) => d.id === id)!;

/** Escort that tops up big hulls: a balanced ground mix. */
const ESCORT = ['starter-bulwark', 'starter-buzzsaw', 'starter-tankbuster', 'starter-skyguard'].map(byId);
/** Common reference armies (equal supply, rotating through the pool by seed): a mixed ground field (no aircraft, so
 *  ground-only weapons are not shut out of the fight) and an air field for the anti-air groups. */
const GROUND_REF = STARTER_DESIGNS.filter((d) => st(d).size <= 2 && !st(d).flying);
const AIR_REF: Design[] = [
  ...STARTER_DESIGNS.filter((d) => st(d).flying),
  { id: 'ref-gunship', name: 'Gunship', chassis: 'gunship', mobility: 'rotor', mounts: ['autocannon', 'rockets'] },
  { id: 'ref-dart', name: 'Dart', chassis: 'drone', mobility: 'jet', mounts: ['laser'] },
  { id: 'ref-jetwing', name: 'Jetwing', chassis: 'gunship', mobility: 'jet', mounts: ['swarm', 'laser'] },
].filter((d) => validateDesign(d).length === 0);

interface Spec { d: Design; n: number }

/** n blocks of the design as a share of raw budget T; if that is a single big unit the remainder goes to the escort. */
function plan(d: Design, T: number, share: number): { specs: Spec[]; spend: number } {
  const raw = rawCost(d);
  const n = Math.max(1, Math.min(Math.round((share * T) / raw), Math.floor(UNIT_CAP / st(d).squad)));
  const specs: Spec[] = [{ d, n }];
  let spend = n * raw;
  const rest = T - spend;
  if (rest > 250) for (const f of ESCORT) {
    const k = Math.round(rest / ESCORT.length / rawCost(f));
    if (k > 0) { specs.push({ d: f, n: k }); spend += k * rawCost(f); }
  }
  return { specs, spend };
}
/** Mixed pool army: round-robin over the pool until the budget is spent. */
function poolArmy(pool: Design[], T: number, seed: number): Spec[] {
  const specs = new Map<string, Spec>();
  let left = T, i = seed * 5;
  for (let g = 0; g < 600 && left > 120; g++) {
    const d = pool[i++ % pool.length];
    const raw = rawCost(d);
    if (raw > left) continue;
    left -= raw;
    const s = specs.get(d.id) ?? { d, n: 0 };
    s.n++; specs.set(d.id, s);
  }
  return [...specs.values()];
}

/** Place specs with the normal AI's formation logic, one design at a time (as scripts/balance.ts does). */
function place(specs: Spec[], side: 0 | 1, seed: number): { place: Placement[]; designs: Design[] } {
  const designs = specs.map((s, i) => ({ ...s.d, id: `x${i}` }));
  const m = newMatch('a', 'ai', seed, newPlayer('a', designs.slice(0, 1), true), newPlayer('b', designs.slice(0, 1), true));
  const me = m.players[side];
  const out: Placement[] = [];
  specs.forEach((s, i) => {
    const deck = designs.map((d, j) => (j === i ? d : { ...d, name: '' }));
    me.deck = deck;
    m.players[1 - side as 0 | 1].deck = deck;
    me.supply = s.n * st(s.d).cost;
    const a = aiDeploy(m, side, 'normal');
    for (const p of a.place) { out.push(p); me.board.push(p); me.nextUid = Math.max(me.nextUid, p.uid + 1); }
  });
  return { place: out, designs };
}

interface Score { win: number; margin: number }
/** One fight set between two armies (built per seed so mixed references vary), both sides. `win` is A's win rate
 *  (draw = half); `margin` is a smoother 0..1 score = 0.5 + 0.5 * (A's surviving share of its supply - B's), used for
 *  fitting because win/lose results of a few big units are very noisy. */
function fightSpecs(mkA: (s: number) => Spec[], mkB: (s: number) => Spec[], seeds: number): Score {
  let win = 0, margin = 0, games = 0;
  for (let s = 0; s < seeds; s++) {
    const A = mkA(s), B = mkB(s);
    for (const side of [0, 1] as const) {
      const other = (1 - side) as 0 | 1;
      const a = place(A, side, s + 1), b = place(B, other, s + 101);
      const units: [Placement[], Placement[]] = [[], []]; const designs: [Design[], Design[]] = [[], []];
      units[side] = a.place; designs[side] = a.designs; units[other] = b.place; designs[other] = b.designs;
      const r = runBattle({ seed: 1000 + s * 31 + side, sides: [{ designs: designs[0], units: units[0] }, { designs: designs[1], units: units[1] }] });
      win += r.winner === side ? 1 : r.winner === -1 ? 0.5 : 0;
      const share = (sd: 0 | 1, specs: Spec[], pl: Placement[]) => {
        const price = new Map(specs.map((x, i) => [`x${i}`, st(x.d).cost]));
        let tot = 0, left = 0;
        for (const p of pl) { const c = price.get(p.designId) ?? 0; tot += c; left += c * (r.aliveFraction[sd][p.uid] ?? 0); }
        return tot ? left / tot : 0;
      };
      margin += 0.5 + 0.5 * (share(side, A, a.place) - share(other, B, b.place)); games++;
    }
  }
  return { win: win / games, margin: margin / games };
}

/** Anti-air weapon armies: half the budget in the AA design, half in air bait (the AA carriers are ground units that
 *  only AA fire can hurt, so who kills the other's air first wins). */
function aaSpecs(d: Design, T: number, seed: number): Spec[] {
  const half = plan(d, T / 2, 1).specs;
  return [...half, ...poolArmy(AIR_REF, T / 2, seed)];
}

type Task = { a: string; b: string | 'REF'; size: Size; air: boolean };
function runTask(t: Task, seeds: number): Score {
  const da = carrier(t.size, t.a);
  const T0 = BUDGET[t.size];
  if (t.b === 'REF') {
    const T = Math.max(T0, 1.15 * rawCost(da));
    // AA design alone vs a pure air army of the whole budget; otherwise ~60% of the budget in the design vs a mixed field
    if (t.air) return fightSpecs(() => plan(da, T, 1).specs, (s) => poolArmy(AIR_REF, T, s), seeds);
    return fightSpecs(() => plan(da, T, 0.6).specs, (s) => poolArmy(GROUND_REF, T, s), seeds);
  }
  const db = carrier(t.size, t.b);
  const T = Math.max(T0, 1.15 * Math.max(rawCost(da), rawCost(db)));
  if (t.air) return fightSpecs((s) => aaSpecs(da, T, s), (s) => aaSpecs(db, T, s), seeds);
  return fightSpecs(() => plan(da, T, 0.6).specs, () => plan(db, T, 0.6).specs, seeds);
}

function tasks(filter: string): Task[] {
  const out: Task[] = [];
  for (const g of GROUPS) {
    if (filter && ![g.size, g.name, ...g.ids].some((x) => x === filter)) continue;
    const ids = g.ids.filter((id) => validateDesign(carrier(g.size, id)).length === 0);
    for (const id of g.ids) if (!ids.includes(id)) console.error(`skip ${id}: carrier invalid (${validateDesign(carrier(g.size, id)).join('; ')})`);
    for (let i = 0; i < ids.length; i++) {
      out.push({ a: ids[i], b: 'REF', size: g.size, air: !!g.air });
      for (let j = i + 1; j < ids.length; j++) out.push({ a: ids[i], b: ids[j], size: g.size, air: !!g.air });
    }
  }
  return out;
}

const SHARDS = 4;
async function runAll(filter: string, seeds: number): Promise<{ t: Task; r: Score }[]> {
  const all = tasks(filter);
  const res: { t: Task; r: Score }[] = [];
  await Promise.all(Array.from({ length: SHARDS }, (_, shard) => new Promise<void>((resolve, reject) => {
    const child = fork(process.argv[1], ['shard', String(seeds), filter], { env: { ...process.env, BAL_SHARD: String(shard) }, stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
    child.on('message', (m) => { res.push(...(m as { t: Task; r: Score }[])); });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`shard ${shard} exited ${code}`))));
  })));
  void all;
  return res;
}

interface WRow { id: string; size: Size; group: string; cost: number; ref: number; peers: number; n: number; refM: number; peersM: number }
function summarize(res: { t: Task; r: Score }[]): WRow[] {
  const rows: WRow[] = [];
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  for (const g of GROUPS) {
    for (const id of g.ids) {
      const refT = res.find((x) => x.t.a === id && x.t.b === 'REF' && x.t.size === g.size);
      if (!refT) continue;
      const w: number[] = [], m: number[] = [];
      for (const x of res) {
        if (x.t.size !== g.size || x.t.b === 'REF') continue;
        if (x.t.a === id) { w.push(x.r.win); m.push(x.r.margin); }
        else if (x.t.b === id && g.ids.includes(x.t.a)) { w.push(1 - x.r.win); m.push(1 - x.r.margin); }
      }
      rows.push({ id, size: g.size, group: g.name, cost: computeStats(carrier(g.size, id)).cost, ref: refT.r.win, refM: refT.r.margin, peers: avg(w), peersM: avg(m), n: w.length });
    }
  }
  return rows;
}
const pct = (x: number) => (Number.isNaN(x) ? '  - ' : `${Math.round(x * 100)}%`.padStart(4));
function printRows(rows: WRow[]) {
  let last = '';
  for (const r of rows) {
    const key = `${r.size} ${r.group}`;
    if (key !== last) { console.log(`\n== ${key} ==`); last = key; }
    const flag = (r.ref < 0.35 || r.ref > 0.65 || r.peers < 0.35 || r.peers > 0.65) ? '  <--' : '';
    console.log(`${r.id.padEnd(15)} cost ${String(r.cost).padStart(6)}  vs peers ${pct(r.peers)} (${pct(r.peersM)})  vs ref ${pct(r.ref)} (${pct(r.refM)})  cal ${(MODULE_CAL[r.id] ?? 1).toFixed(2)}${flag}`);
  }
  const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, x) => a + (x - 0.5) ** 2, 0) / Math.max(1, xs.length));
  const inb = (x: number) => x >= 0.4 && x <= 0.6;
  console.log(`\n${rows.filter((r) => inb(r.ref)).length}/${rows.length} weapons within 40-60% vs ref (rms ${(rms(rows.map((r) => r.ref)) * 100).toFixed(1)} pts); ` +
    `${rows.filter((r) => !Number.isNaN(r.peers) && inb(r.peers)).length}/${rows.filter((r) => !Number.isNaN(r.peers)).length} within 40-60% vs peers (rms ${(rms(rows.filter((r) => !Number.isNaN(r.peers)).map((r) => r.peers)) * 100).toFixed(1)} pts)`);
}

function costReport() {
  console.log('weapon share of unit cost: (armed - same carrier with the weapon slot empty) / armed');
  for (const g of GROUPS) {
    console.log(`\n== ${g.size} ${g.name} ==`);
    for (const id of g.ids) {
      const d = carrier(g.size, id);
      if (validateDesign(d).length) { console.log(`${id.padEnd(15)} invalid carrier`); continue; }
      const s = st(d);
      const bare = st({ ...d, mounts: d.mounts.map((m, i) => (i === 0 || (g.size === 'S' && i === 1) ? null : m)) });
      console.log(`${id.padEnd(15)} unit ${String(s.unitCost).padStart(5)} block ${String(s.cost).padStart(6)}  bare ${String(bare.unitCost).padStart(5)}  weapon share ${(100 * (1 - bare.unitCost / s.unitCost)).toFixed(0).padStart(3)}%  (x${(s.unitCost / bare.unitCost).toFixed(1)})  dps ${s.dps} off ${s.offense} ehp ${s.ehp}`);
    }
  }
}

/** Lower bound for fitted weapon cals (BAL_MINCAL): a weapon that wants to go below it is too weak at any sane price and needs its numbers buffed instead. */
const MIN_CAL = Number(process.env.BAL_MINCAL ?? 0.1);
const mode = process.argv[2] ?? 'run';
if (mode === 'shard') {
  const seeds = Number(process.argv[3]); const filter = process.argv[4] ?? '';
  const shard = Number(process.env.BAL_SHARD);
  const out = tasks(filter).map((t, i) => ({ t, i })).filter((x) => x.i % SHARDS === shard).map(({ t }) => ({ t, r: runTask(t, seeds) }));
  process.send!(out);
  process.exit(0);
} else if (mode === 'dbg') {
  // node scripts/weapon-balance.ts dbg <size> <weaponA> <weaponB|REF>: print both armies and one battle
  const size = process.argv[3] as Size, a = process.argv[4], b = process.argv[5];
  const g = GROUPS.find((x) => x.size === size && x.ids.includes(a))!;
  const da = carrier(size, a);
  const T = Math.max(BUDGET[size], 1.15 * rawCost(da));
  const A = plan(da, T, 0.6).specs;
  const B = b === 'REF' ? poolArmy(g.air ? AIR_REF : GROUND_REF, T, 0) : plan(carrier(size, b), T, 0.6).specs;
  const show = (x: Spec[]) => x.map((s) => `${s.n}x${s.d.id}(${rawCost(s.d)}${s.d.id.startsWith('w-') ? '' : ''})`).join(' ');
  console.log('T', T, '\nA', show(A), '\nB', show(B));
  for (const side of [0, 1] as const) {
    const pa = place(A, side, 1), pb = place(B, (1 - side) as 0 | 1, 101);
    console.log('placed', pa.place.length, pb.place.length);
    const units: [Placement[], Placement[]] = [[], []]; const designs: [Design[], Design[]] = [[], []];
    units[side] = pa.place; designs[side] = pa.designs; units[1 - side] = pb.place; designs[1 - side] = pb.designs;
    const r = runBattle({ seed: 1000 + side, sides: [{ designs: designs[0], units: units[0] }, { designs: designs[1], units: units[1] }] });
    console.log('side', side, JSON.stringify(r).slice(0, 600));
  }
} else if (mode === 'cost') {
  costReport();
} else if (mode === 'run') {
  const seeds = Number(process.argv[3] ?? 4); const filter = process.argv[4] ?? '';
  const t0 = Date.now();
  const rows = summarize(await runAll(filter, seeds));
  printRows(rows);
  if (process.env.BAL_OUT) writeFileSync(process.env.BAL_OUT, JSON.stringify(rows));
  console.log(`(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
} else if (mode === 'fit') {
  const iters = Number(process.argv[3] ?? 4); const seeds = Number(process.argv[4] ?? 4); const filter = process.argv[5] ?? '';
  const hist: Record<string, number[]> = {};
  const anchor: Record<string, number> = {};
  for (let it = 0; it < iters; it++) {
    const rows = summarize(await runAll(filter, seeds));
    console.log(`\n##### iteration ${it} #####`);
    printRows(rows);
    // Smooth (margin) scores -> multiplicative cal step. Cost ~ cal^0.5 and score logit ~ -2.5 * ln(cost), so
    // ln(cal) moves ~0.8 * logit; the gain decays so the fit settles instead of oscillating.
    const gain = 1.6 / (1 + 0.35 * it);
    const upd: Record<string, number> = {};
    // The carriers are artificial (one weapon + plating), so the absolute strength of a whole size class vs the reference
    // is the hulls' business (SIZE_K, hull numbers); the fit only equalises weapons: the class-mean ref score is re-centred on 50%.
    const classMean: Record<string, number> = {};
    for (const z of ['S', 'M', 'L', 'XL']) { const xs = rows.filter((r) => r.size === z).map((r) => r.refM); classMean[z] = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0.5; }
    // Role groups differ structurally vs the common reference (artillery beats it, melee loses to it), so the ref score is
    // re-centred on the weapon's own group mean (the peers decide inside the group); the group mean itself is pushed
    // 25% away from the class mean in the direction of its ref score (weak groups get cheaper, strong ones dearer). Anti-air groups fight an air army: raw ref score.
    const groupMean = (r: WRow) => { const xs = rows.filter((q) => q.size === r.size && q.group === r.group).map((q) => q.refM); return xs.reduce((a, b) => a + b, 0) / xs.length; };
    const airGroup = (r: WRow) => GROUPS.find((g) => g.size === r.size && g.name === r.group)?.air;
    for (const r of rows) {
      const gm = groupMean(r);
      const refC = airGroup(r) ? r.refM : r.refM - gm + 0.5 + 0.25 * (gm - classMean[r.size]);
      const sc = Number.isNaN(r.peersM) ? refC : 0.5 * refC + 0.5 * r.peersM;
      const c = Math.min(0.95, Math.max(0.05, sc));
      const step = Math.pow(c / (1 - c), gain);
      const cal = Math.round(Math.min(15, Math.max(MIN_CAL, (MODULE_CAL[r.id] || MIN_CAL) * Math.min(1.7, Math.max(0.6, step)))) * 100) / 100;
      upd[r.id] = cal;
      (hist[r.id] ??= []).push(MODULE_CAL[r.id] ?? 1);
    }
    // Level anchor: peers are scale-free, so keep each size class's geometric-mean cal at its starting level (S and M
    // keep their class price level; L and XL are rescaled per class afterwards with size-check).
    for (const z of ['S', 'M', 'L', 'XL']) {
      const ids = rows.filter((r) => r.size === z).map((r) => r.id);
      if (!ids.length) continue;
      const geo = (f: (id: string) => number) => Math.exp(ids.reduce((a, id) => a + Math.log(f(id)), 0) / ids.length);
      anchor[z] ??= geo((id) => MODULE_CAL[id] || MIN_CAL);
      const k = anchor[z] / geo((id) => upd[id]);
      for (const id of ids) upd[id] = Math.round(Math.min(15, Math.max(MIN_CAL, upd[id] * k)) * 100) / 100;
    }
    Object.assign(MODULE_CAL, upd);
    process.env.BAL_CAL = JSON.stringify({ ...JSON.parse(process.env.BAL_CAL ?? '{}'), ...upd });
    console.log('CAL ' + JSON.stringify(upd));
  }
  // geometric mean of the last iterations' cals (the fit hovers around the optimum)
  const fin: Record<string, number> = {};
  for (const [id, h] of Object.entries(hist)) { const t = [...h.slice(-3), MODULE_CAL[id]]; fin[id] = Math.round(Math.exp(t.reduce((a, x) => a + Math.log(x), 0) / t.length) * 100) / 100; }
  console.log('FINAL ' + JSON.stringify(fin));
}
