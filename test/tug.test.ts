// Tug of war: rules (shared/tug.ts), mid-battle spawns in the sim, the AI, and the lockstep server hub.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/shared/sim/battle.ts';
import { FIELD_H } from '../src/shared/grid.ts';
import { computeStats } from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import {
  TIER_COST, TUG, TugGame, advance, castlePos, dropError, incomeCost, incomeRate, sanitizeCommand, validateRoster, type TugOrder,
} from '../src/shared/tug.ts';
import { TugAi } from '../src/shared/tugai.ts';
import { TUG_IDLE_MS, TUG_LEAD, TugHub } from '../src/server/tug.ts';
import type { Design, Side } from '../src/shared/types.ts';

const ROSTER: Design[] = STARTER_DESIGNS.filter((d) => computeStats(d).size <= 2).slice(0, 6);
const HEAVY = STARTER_DESIGNS.find((d) => computeStats(d).size === 3)!;

const digest = (g: TugGame) => g.battle.units.map((u) => `${u.id}:${+u.alive}:${u.x.toFixed(6)}:${u.y.toFixed(6)}:${u.hp.toFixed(4)}`).join('|') + '#' + g.sides.map((s) => s.gold.toFixed(6)).join(',');

test('castles stand at each back edge and the game runs until one falls', () => {
  const g = new TugGame(7, [ROSTER, ROSTER]);
  assert.equal(g.castleHp(0), TUG.castleHp);
  assert.equal(g.castleHp(1), TUG.castleHp);
  assert.equal(g.aliveCount(0), 0);
  const c0 = g.battle.units[g.castles[0]], c1 = g.battle.units[g.castles[1]];
  assert.ok(c0.y > FIELD_H / 2 && c1.y < FIELD_H / 2);
  // an empty field never ends on its own (no "all dead" / quiet / time-cap end in tug mode)
  for (let i = 0; i < 20 * 200; i++) g.step();
  assert.equal(g.done, false);
  // a dead castle ends it for the other side
  c1.hp = 1;
  c1.alive = false;
  g.step();
  assert.equal(g.done, true);
  assert.equal(g.winner, 0);
});

test('income, tiers, gold and the drop zone are enforced', () => {
  const g = new TugGame(1, [[...ROSTER, HEAVY], ROSTER]);
  const S = g.sides[0];
  assert.equal(S.gold, TUG.startGold);
  assert.match(g.check(0, { t: 'buy', designId: HEAVY.id, x: 30, y: 70 }) ?? '', /Unlock/);
  assert.match(g.check(0, { t: 'buy', designId: 'nope', x: 30, y: 70 }) ?? '', /roster/);
  // own half only, clear of the castle, on the field
  const d = ROSTER[0];
  assert.match(dropError(0, d, 30, 20) ?? '', /own half/);
  assert.match(dropError(1, d, 30, 70) ?? '', /own half/);
  assert.match(dropError(0, d, castlePos(0).x, castlePos(0).y) ?? '', /castle/);
  assert.match(dropError(0, d, -5, 70) ?? '', /Off the field/);
  assert.equal(dropError(0, d, 30, 70), null);
  assert.equal(dropError(1, d, 30, 20), null);
  // buy: gold goes down, units appear
  const cost = computeStats(d).cost;
  assert.equal(g.apply(0, { t: 'buy', designId: d.id, x: 30, y: 70 }), null);
  assert.equal(S.gold, TUG.startGold - cost);
  assert.equal(g.aliveCount(0), computeStats(d).squad);
  // income
  S.gold = 10_000;
  assert.equal(g.apply(0, { t: 'income' }), null);
  assert.equal(S.incomeLvl, 1);
  assert.equal(S.gold, 10_000 - incomeCost(0));
  const before = S.gold;
  g.step();
  assert.ok(Math.abs(S.gold - before - incomeRate(1) / 20) < 1e-9);
  // tier unlock opens the heavy hull
  assert.equal(g.apply(0, { t: 'tier' }), null);
  assert.equal(S.tier, 3);
  assert.equal(g.check(0, { t: 'buy', designId: HEAVY.id, x: 60, y: 70 }), null);
  // not enough gold
  S.gold = 0;
  assert.match(g.check(0, { t: 'income' }) ?? '', /gold/);
  assert.match(g.check(0, { t: 'tier' }) ?? '', /gold/);
  assert.ok(TIER_COST[4] > TIER_COST[3]);
});

test('spawned units march on the enemy castle and hurt it', () => {
  const g = new TugGame(3, [ROSTER, ROSTER]);
  g.sides[0].gold = 1e6;
  for (const x of [30, 48, 66]) for (const d of ROSTER.slice(0, 4)) g.apply(0, { t: 'buy', designId: d.id, x, y: 60 });
  for (let i = 0; i < 20 * 120 && !g.done; i++) g.step();
  assert.ok(g.castleHp(1) < TUG.castleHp, 'the enemy castle took damage');
  assert.equal(g.castleHp(0), TUG.castleHp);
});

test('the same orders give the same game (lockstep determinism)', () => {
  const orders: TugOrder[] = [];
  const g0 = new TugGame(11, [ROSTER, ROSTER]);
  // record what two AIs do in one run...
  const ais = [new TugAi(0, 5), new TugAi(1, 6)];
  for (let i = 0; i < 20 * 150 && !g0.done; i++) {
    for (const a of ais) for (const c of a.think(g0)) { orders.push({ tick: g0.tick, side: a.side, cmd: c }); g0.apply(a.side, c); }
    g0.step();
  }
  assert.ok(orders.length > 5);
  // ...and replay them from the log, in uneven chunks like a client catching up to a moving frontier
  const g1 = new TugGame(11, [ROSTER, ROSTER]);
  let next = 0;
  for (let t = 0; t < g0.tick; t += 7) next = advance(g1, orders, next, Math.min(t, g0.tick));
  next = advance(g1, orders, next, g0.tick);
  assert.equal(g1.tick, g0.tick);
  assert.equal(digest(g1), digest(g0));
});

test('a mid-battle spawn keeps an ordinary battle working', () => {
  const d = ROSTER[0];
  const b = new Battle({ seed: 2, sides: [{ designs: [d], units: [{ uid: 1, designId: d.id, x: 40, y: 2, level: 1, round: 1 }] }, { designs: [d], units: [{ uid: 1, designId: d.id, x: 40, y: 2, level: 1, round: 1 }] }] });
  for (let i = 0; i < 20; i++) b.step();
  const ids = b.spawnBlock(1, 9, ROSTER[1], 1, [{ x: 20, y: 20 }, { x: 24, y: 20 }]);
  assert.deepEqual(ids, [b.units.length - 2, b.units.length - 1]);
  while (!b.done) b.step();
  assert.ok(b.units.every((u) => Number.isFinite(u.x) && Number.isFinite(u.y)));
});

test('AI vs AI ends with a fallen castle', () => {
  const g = new TugGame(4, [ROSTER, ROSTER]);
  const ais = [new TugAi(0, 1, 'hard'), new TugAi(1, 2, 'easy')];
  while (!g.done && g.time < 20 * 60) {
    for (const a of ais) for (const c of a.think(g)) g.apply(a.side, c);
    g.step();
  }
  assert.equal(g.done, true, 'overtime ends every game');
  assert.notEqual(g.winner, null);
});

test('overtime crumbles both castles until one falls', () => {
  const g = new TugGame(9, [ROSTER, ROSTER]);
  while (g.time < TUG.overtimeAt) g.step();
  assert.equal(g.castleHp(0), TUG.castleHp);
  g.battle.units[g.castles[1]].hp = 100; // the more battered castle goes first
  for (let i = 0; i < 20 * 5 && !g.done; i++) g.step();
  assert.equal(g.done, true);
  assert.equal(g.winner, 0);
  assert.ok(g.castleHp(0) < TUG.castleHp);
});

test('rosters and network commands are checked', () => {
  assert.deepEqual(validateRoster(ROSTER), []);
  assert.ok(validateRoster([]).length);
  assert.ok(validateRoster([ROSTER[0], ROSTER[0]]).length);
  assert.ok(validateRoster(Array(TUG.rosterSize + 1).fill(0).map((_, i) => ({ ...ROSTER[0], id: 'x' + i }))).length);
  assert.deepEqual(sanitizeCommand({ t: 'buy', designId: 'a', x: 1.234567, y: 2, extra: 1 }), { t: 'buy', designId: 'a', x: 1.23, y: 2 });
  assert.equal(sanitizeCommand({ t: 'buy', designId: 'a', x: NaN, y: 2 }), null);
  assert.equal(sanitizeCommand({ t: 'nuke' }), null);
  assert.deepEqual(sanitizeCommand({ t: 'income', gold: 9999 }), { t: 'income' });
});

test('server hub: matchmaking, lockstep stamping, surrender and idle forfeit', async () => {
  let now = 1_000_000;
  const hub = new TugHub(() => now);
  const a = { id: 'pa', name: 'Alice' }, b = { id: 'pb', name: 'Bob' };
  const r0 = hub.quick(a, ROSTER);
  assert.equal(r0.status, 'waiting');
  assert.ok(r0.code);
  assert.deepEqual(hub.list(b).open.map((o) => o.id), [r0.id]);
  assert.throws(() => hub.command(a, r0.id, { t: 'income' }), /opponent/);
  const r1 = hub.quick(b, ROSTER);
  assert.equal(r1.id, r0.id);
  assert.equal(r1.side, 1);
  assert.equal(r1.status, 'countdown');
  assert.ok(r1.rosters);
  assert.throws(() => hub.join({ id: 'pc', name: 'C' }, r0.id, ROSTER), /two players/);
  // live: commands land LEAD ticks after the server's current tick, and the frontier never passes an unknown order
  now = r1.startAt + 1000; // tick 20
  const { order } = hub.command(a, r0.id, { t: 'income' });
  assert.equal(order.tick, 20 + TUG_LEAD);
  assert.equal(order.side, 0);
  const v = await hub.poll(b, r0.id, 0, 0);
  assert.equal(v.status, 'live');
  assert.equal(v.orders.length, 1);
  assert.equal(v.frontier, 20 + TUG_LEAD - 1);
  assert.ok(v.frontier < order.tick + TUG_LEAD);
  // a poll with nothing new waits, and wakes when an order arrives
  const p = hub.poll(a, r0.id, 1, 400);
  hub.command(b, r0.id, { t: 'buy', designId: ROSTER[0].id, x: 30, y: 20 });
  assert.equal((await p).orders.length, 1);
  assert.throws(() => hub.command(b, r0.id, { t: 'buy', designId: 1 }), /Bad command/);
  // surrender ends it for both
  hub.command(b, r0.id, { t: 'surrender' });
  const end = await hub.poll(a, r0.id, 0, 0);
  assert.equal(end.status, 'done');
  assert.equal(end.winner, 0);
  assert.ok(end.frontier >= end.orders[end.orders.length - 1].tick);
  assert.throws(() => hub.command(a, r0.id, { t: 'income' }), /over/);

  // a player who stops polling forfeits
  const q = hub.create(a, ROSTER, true);
  assert.equal(hub.list(b).open.length, 0, 'private games are not listed');
  hub.join(b, q.code!, ROSTER);
  now += 5000;
  await hub.poll(a, q.id, 0, 0);
  now += TUG_IDLE_MS - 1000;
  await hub.poll(a, q.id, 0, 0);
  now += 2000;
  const f = await hub.poll(a, q.id, 0, 0);
  assert.equal(f.status, 'done');
  assert.equal(f.winner, 0 as Side);
  assert.equal(f.orders.at(-1)?.cmd.t, 'surrender');
});
