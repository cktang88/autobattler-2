// AI strength bench: full matches under the real rules (newMatch / validateDeploy / applyDeploy / resolveRound, each
// AI deciding on the same redacted view localdriver.ts hands it) between AI versions and scripted "player" strategies.
//
//   node scripts/aibench.ts [N=40] [pairing filter] [--workers=4]
//
// Players
//   new-normal / new-hard   src/shared/ai.ts (aiDeck + aiDeploy)
//   old-normal / old-hard   scripts/ai-baseline.ts (frozen copy of the AI before the curated pool / adaptive deploy)
//   greedy                  the default player deck (first DECK_SIZE starters); every round buys the most expensive
//                           affordable design, front-to-back by range, spends the rest on upgrades
//   air / swarm / turtle    themed player decks (air force; cheap swarms; artillery behind a shield wall), played by
//                           the OLD normal AI's deploy logic (counter-picking inside the themed deck)
// Each pairing plays N matches on seeds 1..N in mirrored pairs (same match seed and deck seeds, players swapped). Prints win / loss / draw for the left player, the
// average rounds and the slowest single decision of each side.

import { fork } from 'node:child_process';
import { aiDeck, aiDeploy, type AiDifficulty } from '../src/shared/ai.ts';
import * as OLD from './ai-baseline.ts';
import { DECK_SIZE, applyDeploy, designCost, newMatch, newPlayer, redactFor, resolveRound, upgradeCost, validateDeploy } from '../src/shared/match.ts';
import { DEPLOY_D, DEPLOY_W, blockDims, blockInZone, normSpacing, hasSpacing, rectsOverlap } from '../src/shared/grid.ts';
import { computeStats, MAX_LEVEL, validateDesign } from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import type { DeployAction, Design, MatchState, Placement, Side } from '../src/shared/types.ts';

interface Player { deck(seed: number, oppDeck?: Design[]): Design[]; deploy(m: MatchState, side: Side): DeployAction }

const S = (id: string) => STARTER_DESIGNS.find((d) => d.id === 'starter-' + id)!;
const D = (id: string, name: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name, chassis, mobility, mounts });

const THEMES: Record<string, Design[]> = {
  air: [S('hornet'), S('strafer'), S('thunderbird'), S('skyguard'), S('bulwark'),
    D('p-gunship', 'Gunship', 'gunship', 'rotor', ['autocannon', 'rockets']),
    D('p-dart', 'Dart', 'interceptor', 'jet', ['laser', 'mg']),
    D('p-airraider', 'Air Raider', 'gunship', 'rotor', ['lightrail', 'hmg']),
    D('p-jetwing', 'Jetwing', 'deltawing', 'jet', ['swarm', 'laser', 'mg'])],
  swarm: [S('buzzsaw'), S('torchbug'), S('ripper'), S('hornet'), S('bulwark'),
    D('p-pepper', 'Pepper', 'scout', 'wheels', ['ac20']),
    D('p-skimmer', 'Skimmer', 'scout', 'hover', ['flamer']),
    D('p-lasbug', 'Lasbug', 'scout', 'legs', ['laser']),
    D('p-gnat', 'Gnat', 'drone', 'rotor', ['hmg'])],
  turtle: [S('thunderhead'), S('firestorm'), S('spire'), S('aegiswall'), S('bulwark'), S('skyguard'), S('medic'), S('ironclad'),
    D('p-mlrs', 'Rainmaker', 'longarm', 'spider', ['mlrs'])],
};
{ const bad = Object.entries(THEMES).flatMap(([k, deck]) => deck.filter((d) => validateDesign(d).length).map((d) => `${k} ${d.id}: ${validateDesign(d)}`)); if (bad.length) throw new Error(bad.join("\n")); }

/** Greedy scripted player: most expensive affordable design first; long range at the back, short range at the front. */
function greedyDeploy(m: MatchState, side: Side): DeployAction {
  const me = m.players[side];
  const a: DeployAction = { round: m.round, place: [], upgrade: [] };
  const byId = new Map(me.deck.map((d) => [d.id, d] as const));
  const feet = me.board.map((u) => ({ x: u.x, y: u.y, ...blockDims(computeStats(byId.get(u.designId)!), u.spacing ?? 0, !!u.rot) }));
  let supply = me.supply, uid = me.nextUid;
  const designs = [...me.deck].sort((x, y) => designCost(y) - designCost(x));
  for (let guard = 0; guard < 40; guard++) {
    const d = designs.find((x) => designCost(x) <= supply);
    if (!d) break;
    const st = computeStats(d);
    const sp = normSpacing(st, hasSpacing(st) ? 1 : 0);
    const { w, h } = blockDims(st, sp);
    const back = st.range >= 9 && !st.flying;
    let spot: { x: number; y: number } | null = null;
    for (let i = 0; i <= DEPLOY_D - h && !spot; i++) {
      const y = back ? DEPLOY_D - h - i : i;
      for (let k = 0; k <= DEPLOY_W - w && !spot; k++) {
        const x = Math.floor((DEPLOY_W - w) / 2) + (k % 2 ? 1 : -1) * Math.ceil(k / 2);
        if (x < 0 || x + w > DEPLOY_W || !blockInZone(x, y, st, sp)) continue;
        if (feet.every((f) => !rectsOverlap(x, y, w, h, f.x, f.y, f.w, f.h))) spot = { x, y };
      }
    }
    if (!spot) { designs.splice(designs.indexOf(d), 1); continue; }
    const pl: Placement = { uid: uid++, designId: d.id, x: spot.x, y: spot.y, level: 1, round: m.round };
    if (hasSpacing(st)) pl.spacing = sp;
    if (validateDeploy(m, side, { ...a, place: [...a.place, pl] }) !== null) { designs.splice(designs.indexOf(d), 1); continue; }
    a.place.push(pl);
    feet.push({ ...spot, w, h });
    supply -= designCost(d);
  }
  const lv = new Map(me.board.map((u) => [u.uid, u.level] as const));
  for (const u of [...me.board].sort((x, y) => designCost(byId.get(y.designId)!) - designCost(byId.get(x.designId)!))) {
    const d = byId.get(u.designId)!;
    while (lv.get(u.uid)! < MAX_LEVEL && upgradeCost(d, lv.get(u.uid)!) <= supply) { supply -= upgradeCost(d, lv.get(u.uid)!); a.upgrade.push(u.uid); lv.set(u.uid, lv.get(u.uid)! + 1); }
  }
  return a;
}

export const PLAYERS: Record<string, Player> = {
  'new-easy': { deck: (s) => aiDeck(s, 'easy'), deploy: (m, side) => aiDeploy(m, side, 'easy') },
  'new-normal': { deck: (s) => aiDeck(s, 'normal'), deploy: (m, side) => aiDeploy(m, side, 'normal') },
  'new-hard': { deck: (s, opp) => aiDeck(s, 'hard', undefined, opp), deploy: (m, side) => aiDeploy(m, side, 'hard') },
  'old-normal': { deck: (s) => OLD.aiDeck(s, 'normal'), deploy: (m, side) => OLD.aiDeploy(m, side, 'normal') },
  'old-hard': { deck: (s) => OLD.aiDeck(s, 'hard'), deploy: (m, side) => OLD.aiDeploy(m, side, 'hard') },
  greedy: { deck: () => STARTER_DESIGNS.slice(0, DECK_SIZE), deploy: greedyDeploy },
  ...Object.fromEntries(Object.entries(THEMES).map(([k, deck]) => [k, { deck: () => deck, deploy: (m: MatchState, side: Side) => OLD.aiDeploy(m, side, 'normal') } satisfies Player])),
};

export const DEFAULT_PAIRINGS: [string, string][] = [
  ['old-hard', 'old-normal'],
  ['new-normal', 'old-normal'],
  ['new-normal', 'old-hard'],
  ['new-hard', 'old-hard'],
  ['new-hard', 'new-normal'],
  ['old-normal', 'greedy'], ['old-hard', 'greedy'], ['new-normal', 'greedy'], ['new-hard', 'greedy'],
  ['old-normal', 'air'], ['old-hard', 'air'], ['new-normal', 'air'], ['new-hard', 'air'],
  ['old-normal', 'swarm'], ['old-hard', 'swarm'], ['new-normal', 'swarm'], ['new-hard', 'swarm'],
  ['old-normal', 'turtle'], ['old-hard', 'turtle'], ['new-normal', 'turtle'], ['new-hard', 'turtle'],
];

interface Game { pair: number; seed: number; res: 0 | 1 | 2; rounds: number; ms: [number, number]; hp: [number, number] }

/** One match: `a` is the left player of the pairing; on odd seeds it plays side 1. */
export function playGame(a: string, b: string, seed: number): Omit<Game, 'pair'> {
  // mirrored pairs: seeds 2k and 2k+1 play the same match seed and the same two deck seeds with the players swapped
  // (sides AND deck seeds), so deck luck and side bias cancel out within each pair
  const flip = seed % 2 === 1;
  const k = seed >> 1;
  const P: [Player, Player] = flip ? [PLAYERS[b], PLAYERS[a]] : [PLAYERS[a], PLAYERS[b]];
  // a deck may be drafted against the other side's (as localdriver passes the player's deck to the AI's aiDeck)
  const pre: [Design[], Design[]] = [P[0].deck(k * 2 + 1), P[1].deck(k * 2 + 2)];
  const m = newMatch(`bench${seed}`, 'ai', k * 7919 + 13, newPlayer('0', P[0].deck(k * 2 + 1, pre[1]), true), newPlayer('1', P[1].deck(k * 2 + 2, pre[0]), true));
  const ms: [number, number] = [0, 0];
  while (m.status === 'deploy') {
    const acts: DeployAction[] = [];
    for (const side of [0, 1] as const) {
      const t = performance.now();
      let act = P[side].deploy(redactFor(m, side), side);
      ms[side] = Math.max(ms[side], performance.now() - t);
      const err = validateDeploy(m, side, act);
      if (err) { console.error(`invalid deploy (${side ? (flip ? a : b) : flip ? b : a}) r${m.round}: ${err}`); act = { round: m.round, place: [], upgrade: [] }; }
      acts.push(act);
    }
    applyDeploy(m, 0, acts[0]);
    applyDeploy(m, 1, acts[1]);
    resolveRound(m);
  }
  const w = m.winner ?? -1;
  const aSide = flip ? 1 : 0;
  return {
    seed, res: w === -1 ? 2 : w === aSide ? 0 : 1, rounds: m.history.length,
    ms: flip ? [ms[1], ms[0]] : [ms[0], ms[1]], hp: flip ? [m.players[1].hp, m.players[0].hp] : [m.players[0].hp, m.players[1].hp],
  };
}

async function main() {
  const args = process.argv.slice(2).filter((x) => !x.startsWith('--'));
  const N = Number(args[0] ?? 40);
  const filter = args[1] ?? '';
  const workers = Number(process.argv.find((x) => x.startsWith('--workers='))?.slice(10) ?? 4);
  const pairs = DEFAULT_PAIRINGS.filter(([a, b]) => !filter || filter.split(',').some((f) => `${a} vs ${b}`.includes(f)));
  const jobs: [number, number][] = [];
  for (let p = 0; p < pairs.length; p++) for (let s = 1; s <= N; s++) jobs.push([p, s]);
  const games: Game[] = [];
  const t0 = performance.now();
  await Promise.all(Array.from({ length: workers }, (_, w) => new Promise<void>((resolve, reject) => {
    const mine = jobs.filter((_, i) => i % workers === w);
    const child = fork(process.argv[1], ['--child'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    child.on('message', (g) => games.push(...(g as Game[])));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${w} exited ${code}`))));
    child.send({ pairs, jobs: mine });
  })));
  console.log(`\n${N} matches per pairing, sides alternate (${((performance.now() - t0) / 1000).toFixed(0)} s)\n`);
  console.log(`${'pairing'.padEnd(26)} ${'win'.padStart(5)} ${'loss'.padStart(5)} ${'draw'.padStart(5)}  ${'win%'.padStart(5)}  rounds  hp(left/right)  max ms (left/right)`);
  pairs.forEach(([a, b], p) => {
    const gs = games.filter((g) => g.pair === p);
    const c = [0, 1, 2].map((r) => gs.filter((g) => g.res === r).length);
    const avg = (f: (g: Game) => number) => gs.reduce((t, g) => t + f(g), 0) / Math.max(1, gs.length);
    const mx = (i: 0 | 1) => Math.max(...gs.map((g) => g.ms[i]));
    console.log(`${`${a} vs ${b}`.padEnd(26)} ${String(c[0]).padStart(5)} ${String(c[1]).padStart(5)} ${String(c[2]).padStart(5)}  ${(((c[0] + c[2] / 2) / Math.max(1, gs.length)) * 100).toFixed(0).padStart(4)}%  ${avg((g) => g.rounds).toFixed(1).padStart(6)}  ${avg((g) => g.hp[0]).toFixed(0).padStart(5)} / ${avg((g) => g.hp[1]).toFixed(0).padEnd(5)}  ${mx(0).toFixed(0).padStart(6)} / ${mx(1).toFixed(0)}`);
  });
}

if (process.argv.includes('--child')) {
  process.on('message', (msg) => {
    const { pairs, jobs } = msg as { pairs: [string, string][]; jobs: [number, number][] };
    const out: Game[] = [];
    for (const [p, s] of jobs) out.push({ pair: p, ...playGame(pairs[p][0], pairs[p][1], s) });
    process.send!(out, () => process.exit(0));
  });
} else if (process.argv[1]?.endsWith('aibench.ts')) {
  await main();
}
