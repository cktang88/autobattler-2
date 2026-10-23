// Quick calibration touch-up on REAL designs (starters + op-check candidates): a few passes of the op-check
// mixed-army test; each design's win-rate logit nudges the MODULE_CAL of the modules it carries (split evenly).
// Complements fit_cal.py, whose single-weapon test designs can't see chassis synergies (a howitzer on a long-range
// spider platform, repair on a tanky hull). Prints the updated MODULE_CAL entries as JSON.
// Run: node scripts/quick-cal.ts [passes=3] [seeds=6] [gain=0.6]
import { MODULE_BY_ID } from '../src/shared/parts.ts';
import { MODULE_CAL, computeStats } from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { CANDIDATES, winRate } from './op-check.ts';

const passes = Number(process.argv[2] ?? 3), seeds = Number(process.argv[3] ?? 6), gain = Number(process.argv[4] ?? 0.6);
const pool = STARTER_DESIGNS.filter((d) => computeStats(d).size <= 3);
const designs = [...STARTER_DESIGNS, ...CANDIDATES];
const lg = (r: number) => { const x = Math.min(0.94, Math.max(0.06, r)); return Math.log(x / (1 - x)); };
const touched = new Set<string>();
for (let it = 0; it < passes; it++) {
  const acc = new Map<string, [number, number]>();
  let rms = 0;
  for (const d of designs) {
    const r = winRate(d, 1500, seeds, pool);
    rms += (r / 100 - 0.5) ** 2;
    const mods = [...new Set(d.mounts.filter((m): m is string => !!m && MODULE_BY_ID.get(m)?.kind !== 'armor'))];
    for (const m of mods) {
      const a = acc.get(m) ?? [0, 0];
      a[0] += lg(r / 100) / mods.length; a[1] += 1 / mods.length;
      acc.set(m, a);
    }
  }
  console.error(`pass ${it}: rms ${(100 * Math.sqrt(rms / designs.length)).toFixed(1)} pts over ${designs.length} designs`);
  for (const [m, [s, w]] of acc) {
    const step = Math.max(-0.4, Math.min(0.4, (gain * s) / (w + 0.3)));
    MODULE_CAL[m] = (MODULE_CAL[m] ?? 1) * Math.exp(step);
    touched.add(m);
  }
}
console.log(JSON.stringify(Object.fromEntries([...touched].sort().map((m) => [m, Math.round(MODULE_CAL[m] * 100) / 100]))));
