// Balance harness. Run: node scripts/balance.ts [matches|army|all] [N]
//
//  matches: AI-vs-AI full matches per difficulty pair -> win rates, average match length.
//  army:    equal-cost army test. For each design (starters + one test design per weapon module on a
//           standard chassis) buy ARMY_SUPPLY worth of it and fight armies of every starter design,
//           several seeds, both sides. Win rate ~50% means the cost model prices it right;
//           well above = underpriced (too strong for its cost), well below = overpriced.

import { aiDeck, aiDeploy, type AiDifficulty } from '../src/shared/ai.ts';
import { applyDeploy, newMatch, newPlayer, resolveRound, validateDeploy } from '../src/shared/match.ts';
import { MODULES } from '../src/shared/parts.ts';
import { computeStats, validateDesign } from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { runBattle } from '../src/shared/sim/battle.ts';
import type { Design, Placement } from '../src/shared/types.ts';

const mode = process.argv[2] ?? 'all';
const N = Number(process.argv[3] ?? 20);

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

/** Buy ARMY_SUPPLY of one design and place it with the normal AI's formation logic. */
function army(d: Design, side: 0 | 1, seed: number): Placement[] {
  const deck = [{ ...d, id: 'x' }];
  const m = newMatch('a', 'ai', seed, newPlayer('a', deck, true), newPlayer('b', deck, true));
  m.players[side].supply = ARMY_SUPPLY;
  const a = aiDeploy(m, side, 'normal');
  return a.place;
}

function testDesigns(): Design[] {
  const out: Design[] = [];
  for (const mod of MODULES) {
    if (mod.kind !== 'weapon') continue;
    const d: Design =
      mod.mount === 'L' ? { id: `t-${mod.id}`, name: mod.name.slice(0, 24), chassis: 'raider', mobility: 'halftrack', mounts: [mod.id, null] }
      : mod.mount === 'M' ? { id: `t-${mod.id}`, name: mod.name.slice(0, 24), chassis: 'warden', mobility: 'halftrack', mounts: [mod.id, null] }
      : { id: `t-${mod.id}`, name: mod.name.slice(0, 24), chassis: 'longarm', mobility: 'halftrack', mounts: [mod.id] };
    if (validateDesign(d).length === 0) out.push(d);
  }
  return out;
}

const AIR_FIELD: Design[] = [
  ...STARTER_DESIGNS.filter((d) => computeStats(d).flying),
  { id: 't-air-gunship', name: 'Gunship', chassis: 'gunship', mobility: 'rotor', mounts: ['autocannon', 'rockets'] },
  { id: 't-air-dart', name: 'Dart', chassis: 'drone', mobility: 'jet', mounts: ['laser'] },
  { id: 't-air-raider', name: 'Air Raider', chassis: 'raider', mobility: 'rotor', mounts: ['hmg', 'atgm'] },
].filter((d) => validateDesign(d).length === 0);

const antiAirOnly = (d: Design) => d.mounts.every((id) => !id || MODULES.find((m) => m.id === id)?.targetsGround === false || MODULES.find((m) => m.id === id)?.kind !== 'weapon');

function armyTest() {
  const pool = [...STARTER_DESIGNS, ...testDesigns()];
  const seeds = Math.max(1, Math.min(N, 4));
  const rows: { d: Design; rate: number; cost: number; aaOnly: boolean }[] = [];
  for (const d of pool) {
    let score = 0, games = 0;
    const aaOnly = antiAirOnly(d);
    const field = aaOnly ? AIR_FIELD : STARTER_DESIGNS;
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
    const st = computeStats(d);
    rows.push({ d, rate: score / games, cost: st.cost, aaOnly });
  }
  rows.sort((a, b) => b.rate - a.rate);
  console.log(`\nEqual-cost armies (${ARMY_SUPPLY} supply each) vs the starter field (anti-air-only designs: vs an air field); win rate:`);
  for (const r of rows) {
    const tag = r.rate >= 0.7 ? 'UNDERPRICED' : r.rate <= 0.3 ? 'OVERPRICED' : '';
    console.log(`${(r.rate * 100).toFixed(0).padStart(4)}%  ${String(r.cost).padStart(4)}  ${r.d.id.padEnd(22)} ${r.d.chassis}/${r.d.mobility} [${r.d.mounts.join(',')}] ${r.aaOnly ? '(vs air) ' : ''}${tag}`);
  }
}

if (mode === 'matches' || mode === 'all') matches();
if (mode === 'army' || mode === 'all') armyTest();
