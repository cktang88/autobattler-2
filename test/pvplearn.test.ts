// The AI learns from multiplayer games it played no part in: the server scores every finished PvP game (classic: its
// resolved rounds; tug of war: a replay of the order log) and puts the two best designs on trial in its candidate pool.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PVP_MIN_EFF, defaultPool, findByKey, findBySlot, poolKey, pvpCandidates, scoreMatch, type DesignPerf } from '../src/shared/aipool.ts';
import { aiDeck, aiDeploy } from '../src/shared/ai.ts';
import { FIELD_W, STANDARD_FIELD } from '../src/shared/grid.ts';
import { applyDeploy, newMatch, newPlayer, resolveRound } from '../src/shared/match.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { TugGame, TugReplay, type TugOrder } from '../src/shared/tug.ts';
import { TugAi } from '../src/shared/tugai.ts';
import { GlobalAiPool, freshState } from '../src/server/aipool.ts';
import { computeStats } from '../src/shared/stats.ts';
import type { Design } from '../src/shared/types.ts';

const perf = (rows: [0 | 1, string, number, number?][]): DesignPerf[] =>
  rows.map(([side, designId, eff, invested = 100]) => ({ side, designId, invested, killed: 0, dealt: 0, eff }));

test('pvpCandidates: the two best designs of either side, above the bar and with real spending behind them', () => {
  const a = STARTER_DESIGNS.slice(0, 4), b = STARTER_DESIGNS.slice(4, 8);
  const c = pvpCandidates(perf([
    [0, a[0].id, 1.6], [0, a[1].id, 0.9], [0, a[2].id, 2.5, 1], // a[2]: hardly bought
    [1, b[0].id, 1.4], [1, b[1].id, 1.05], [1, b[2].id, 1.2],
  ]), [a, b], ['Ann', 'Bob']);
  assert.equal(c.length, 2);
  assert.deepEqual(c.map((x) => [x.side, x.creator]), [[0, 'Ann'], [1, 'Bob']]);
  assert.ok(c.every((x) => x.eff >= PVP_MIN_EFF));
  assert.ok(c[0].design.id.startsWith('lrn-'), 'renamed like any adopted design');
  assert.equal(pvpCandidates(perf([[0, a[0].id, 1.0], [1, b[0].id, 0.8]]), [a, b], ['Ann', 'Bob']).length, 0, 'nothing beat the bar');
});

test('the server learns from a finished multiplayer match (once)', async () => {
  const m = newMatch('pvp1', 'pvp', 21, newPlayer('Ann', aiDeck(31, 'normal'), true), newPlayer('Bob', aiDeck(32, 'normal'), true));
  for (let r = 0; r < 3 && m.status === 'deploy'; r++) {
    for (const side of [0, 1] as const) applyDeploy(m, side, aiDeploy(m, side, 'normal'));
    resolveRound(m);
  }
  m.status = 'done';
  const want = pvpCandidates(scoreMatch(m), [m.players[0].deck, m.players[1].deck], ['Ann', 'Bob']);
  const base = defaultPool();
  const fresh = want.filter((c) => !findByKey([...base.entries], c.design) && !findBySlot([...base.entries], c.design));
  const gp = new GlobalAiPool(freshState(), () => {});
  assert.equal(gp.learnFromMatch(m), true);
  assert.equal(gp.learnFromMatch(m), false, 'the same match is learnt once');
  await gp.drain();
  const cands = gp.pool().candidates;
  for (const c of fresh) {
    const e = cands.find((x) => poolKey(x.design) === poolKey(c.design));
    assert.ok(e, `${c.design.name} went on trial`);
    assert.equal(e!.creator, c.creator);
  }
  assert.equal(cands.length, fresh.length);
  assert.ok(gp.state.events.every((e) => e.kind === 'joined' && /multiplayer/.test(e.detail ?? '')));
});

/** a short AI-vs-AI tug game with its order log, as the server would have relayed it */
function tugGame(seed: number, secs: number): { rosters: [Design[], Design[]]; orders: TugOrder[]; g: TugGame } {
  // player designs (the starters: not in the AI's pool), light / medium so both sides can buy from the start
  const own = STARTER_DESIGNS.filter((d) => computeStats(d).size <= 2);
  const rosters: [Design[], Design[]] = [own.slice(0, 9), own.slice(9, 18).length ? own.slice(9, 18) : own.slice(0, 9)];
  const g = new TugGame(seed, rosters);
  const ais = [new TugAi(0, seed, 'normal'), new TugAi(1, seed + 5, 'hard')];
  const orders: TugOrder[] = [];
  for (let t = 0; t < secs * 20 && !g.done; t++) {
    for (const ai of ais) for (const cmd of ai.think(g)) if (!g.apply(ai.side, cmd)) orders.push({ tick: g.tick, side: ai.side, cmd });
    g.step();
  }
  return { rosters, orders, g };
}

test('a tug game replays from its order log exactly, and leaves the shared field standard', () => {
  const { rosters, orders, g } = tugGame(4, 90);
  const end = g.tick;
  const digest = (x: TugGame) => x.battle.units.map((u) => `${u.id}:${+u.alive}:${u.x.toFixed(5)}:${u.y.toFixed(5)}:${u.hp.toFixed(3)}`).join('|');
  const want = digest(g);
  const rep = new TugReplay(4, rosters, orders, end);
  assert.equal(FIELD_W, STANDARD_FIELD.w, 'standard field between chunks');
  while (!rep.step(150)) assert.equal(FIELD_W, STANDARD_FIELD.w);
  assert.equal(digest(rep.g), want);
  const t = rep.tally();
  assert.ok([...t.values()].some((v) => v.invested > 0 && v.dealt > 0));
  // invested is what the blocks cost
  for (const v of t.values()) {
    const d = [...rosters[0], ...rosters[1]].find((x) => x.id === v.designId)!;
    const cost = computeStats(d).cost;
    assert.ok(Math.abs(v.invested / cost - Math.round(v.invested / cost)) < 1e-6, `${d.name}: ${v.invested} vs ${cost}`);
  }
});

test('the server learns from a finished multiplayer tug game', async () => {
  const { rosters, orders, g } = tugGame(6, 150);
  const gp = new GlobalAiPool(freshState(), () => {});
  assert.equal(gp.learnFromTug('t1', 6, rosters, ['Ann', 'Bob'], orders, g.tick), true);
  assert.equal(gp.learnFromTug('t1', 6, rosters, ['Ann', 'Bob'], orders, g.tick), false);
  await gp.drain();
  assert.equal(FIELD_W, STANDARD_FIELD.w);
  assert.ok(gp.state.events.some((e) => e.kind === 'joined'), 'a design of the game went on trial');
  for (const e of gp.state.events) assert.match(e.detail ?? '', /tug of war game, by (Ann|Bob)/);
  for (const c of gp.pool().candidates) assert.ok(c.creator === 'Ann' || c.creator === 'Bob');
});
