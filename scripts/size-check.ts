// Size-class balance check: equal-supply fights by chassis size and giant/titan designs vs mixed armies.
// Usage: node scripts/size-check.ts 1,1,1,1,1   (multipliers applied on top of SIZE_K for experiments)
import { Battle } from '../src/shared/sim/battle.ts';
import { computeStats, PRICE_DIV, SIZE_K } from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { blockDims, DEPLOY_W, DEPLOY_D, rectsOverlap } from '../src/shared/grid.ts';
import type { Design, Placement } from '../src/shared/types.ts';
const base = [...SIZE_K]; const mult = process.argv[2].split(',').map(Number);
for (let i = 0; i < 5; i++) SIZE_K[i] = base[i] * mult[i];
const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id, chassis, mobility, mounts });
function pack(list: Design[]): Placement[] {
  const out: Placement[] = []; const occ: { x: number; y: number; w: number; h: number }[] = []; let uid = 1;
  for (const d of list) { const s = computeStats(d); const { w, h } = blockDims(s.size, 1, s); let placed = false;
    for (let y = 0; y + h <= DEPLOY_D && !placed; y++) for (let x = 0; x + w <= DEPLOY_W && !placed; x++) {
      if (occ.some((o) => rectsOverlap(x, y, w, h, o.x, o.y, o.w, o.h))) continue;
      occ.push({ x, y, w, h }); out.push({ uid: uid++, designId: d.id, x, y, level: 1, round: 1, spacing: 1 }); placed = true; } }
  return out;
}
function army(budget: number, pool: Design[], seed: number): Design[] {
  const out: Design[] = []; let left = budget; let i = seed * 5;
  for (let g = 0; g < 400 && left >= 50 / PRICE_DIV; g++) { const d = pool[i++ % pool.length]; const c = computeStats(d).cost; if (c <= left) { out.push(d); left -= c; } }
  return out;
}
function fight(a: Design[], b: Design[], seed: number) {
  const designs = [...new Map([...a, ...b].map((d) => [d.id, d])).values()];
  const r = new Battle({ seed, sides: [{ designs, units: pack(a) }, { designs, units: pack(b) }] }); while (!r.done) r.step(); return r.winner;
}
const big = [D('garg', 'goliath', 'megatracks', ['avenger', 'cannon', 'twin120', 'ac40']), D('tit', 'titan', 'titanlegs', ['annihilator', 'siegeplasma', 'barrage', 'cruise', 'lightrail']),
  D('levi', 'leviathan', 'treads', ['siege240', 'missilebattery', 'autocannon', 'autocannon']), D('brood', 'broodmother', 'spider', ['stormtower', 'cannon', 'autocannon', 'autocannon', 'mg']),
  ...STARTER_DESIGNS.filter((d) => computeStats(d).size >= 4)];
const by = (k: number) => STARTER_DESIGNS.filter((d) => computeStats(d).size === k);
const mixed = STARTER_DESIGNS.filter((d) => computeStats(d).size <= 2);
const N = Number(process.env.N ?? 4); const res: string[] = [];
const vs = (A: (s: number) => Design[], Bf: (s: number) => Design[]) => { let w = 0, n = 0; for (let s = 0; s < N; s++) { const a = A(s), b = Bf(s); if (fight(a, b, 10 + s) === 0) w++; n++; if (fight(b, a, 20 + s) === 1) w++; n++; } return Math.round(100 * w / n); };
res.push('s1v2 ' + vs((s) => army(6000 / PRICE_DIV, by(1), s), (s) => army(6000 / PRICE_DIV, by(2), s)));
res.push('s2v3 ' + vs((s) => army(6000 / PRICE_DIV, by(2), s), (s) => army(6000 / PRICE_DIV, by(3), s)));
res.push('s3vMix ' + vs((s) => army(6000 / PRICE_DIV, by(3), s), (s) => army(6000 / PRICE_DIV, mixed, s)));
for (const b of big) { const c = computeStats(b).cost; res.push(`${b.id}(${c}) ` + vs(() => [b], (s) => army(c, mixed, s))); }
console.log(mult.join(','), '|', res.join('  '));
