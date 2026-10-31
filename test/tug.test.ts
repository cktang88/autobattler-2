// Tug of war: rules (shared/tug.ts), mid-battle spawns in the sim, the AI, and the lockstep server hub.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/shared/sim/battle.ts';
import { FIELD_H, FIELD_W, STANDARD_FIELD, setField } from '../src/shared/grid.ts';
import { computeStats } from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import {
  TIER_COST, TUG, TugGame, advance, buyCooldown, castleGunPrice, castleGuns, castlePos, dropError, incomeCost, incomeRate, sanitizeCommand, validateRoster, type TugOrder,
} from '../src/shared/tug.ts';
import { TugAi } from '../src/shared/tugai.ts';
import { MODULE_BY_ID } from '../src/shared/parts.ts';
import { TICK_RATE } from '../src/shared/sim/types.ts';
import { TUG_IDLE_MS, TUG_LEAD, TugHub } from '../src/server/tug.ts';
import type { Design, Side } from '../src/shared/types.ts';

const ROSTER: Design[] = STARTER_DESIGNS.filter((d) => computeStats(d).size <= 2).slice(0, 6);
const HEAVY = STARTER_DESIGNS.find((d) => computeStats(d).size === 3)!;

const digest = (g: TugGame) => g.battle.units.map((u) => `${u.id}:${+u.alive}:${u.x.toFixed(6)}:${u.y.toFixed(6)}:${u.hp.toFixed(4)}`).join('|') + '#' + g.sides.map((s) => s.gold.toFixed(6)).join(',');

test('tug plays on its own narrow, long field', () => {
  setField(STANDARD_FIELD);
  new TugGame(1, [ROSTER, ROSTER]);
  assert.deepEqual([FIELD_W, FIELD_H], [TUG.field.w, TUG.field.h]);
  assert.ok(TUG.field.w <= STANDARD_FIELD.w / 2 && TUG.field.h >= STANDARD_FIELD.h * 1.25);
  assert.ok(TUG.field.w * TUG.field.deploy < STANDARD_FIELD.w * STANDARD_FIELD.deploy, 'less deploy area than a round-based match');
  setField(STANDARD_FIELD);
  assert.deepEqual([FIELD_W, FIELD_H], [96, 92]);
});

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
  assert.match(g.check(0, { t: 'buy', designId: HEAVY.id, x: 12, y: 95 }) ?? '', /Unlock/);
  assert.match(g.check(0, { t: 'buy', designId: 'nope', x: 12, y: 95 }) ?? '', /roster/);
  // anywhere in the own deploy zone (the back rows), clear of the castle, on the field
  const d = ROSTER[0];
  assert.match(dropError(0, d, 12, FIELD_H / 2) ?? '', /deploy zone/);
  assert.match(dropError(0, d, 12, 18) ?? '', /deploy zone/);
  assert.match(dropError(1, d, 12, 95) ?? '', /deploy zone/);
  assert.match(dropError(0, d, castlePos(0).x, castlePos(0).y) ?? '', /castle/);
  // right beside the castle (and behind it, toward the back edge) is fine as long as the block clears the castle
  const c0 = castlePos(0);
  assert.equal(dropError(0, d, c0.x + 6, c0.y), null, 'beside the castle');
  assert.equal(dropError(0, d, c0.x + 5, FIELD_H - 1), null, 'behind the castle line');
  assert.match(dropError(0, d, -5, 95) ?? '', /Off the field/);
  assert.equal(dropError(0, d, 12, 95), null);
  assert.equal(dropError(0, d, 36, FIELD_H - TUG.field.deploy + 3), null);
  assert.equal(dropError(1, d, 12, 18), null);
  // buy: gold goes down, units appear
  const cost = computeStats(d).cost;
  assert.equal(g.apply(0, { t: 'buy', designId: d.id, x: 12, y: 95 }), null);
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
  assert.equal(g.check(0, { t: 'buy', designId: HEAVY.id, x: 36, y: 95 }), null);
  // not enough gold
  S.gold = 0;
  assert.match(g.check(0, { t: 'income' }) ?? '', /gold/);
  assert.match(g.check(0, { t: 'tier' }) ?? '', /no bigger hulls/, 'heavy is the biggest hull in this roster: nothing more to sell');
  assert.ok(TIER_COST[4] > TIER_COST[3]);
});

test('spawned units march on the enemy castle and hurt it', () => {
  const g = new TugGame(3, [ROSTER, ROSTER]);
  g.sides[0].gold = 1e6;
  for (let wave = 0; wave < 3; wave++) {
    // four designs side by side across the lane (never on top of each other: drops must not overlap units)
    ROSTER.slice(0, 4).forEach((d, j) => assert.equal(g.apply(0, { t: 'buy', designId: d.id, x: 6 + j * 12, y: 92 }), null));
    for (let i = 0; i < (TUG.spawnFreeze + 4) * 20; i++) g.step(); // past the buy cooldown, and the wave has moved off
  }
  for (let i = 0; i < 20 * 120 && !g.done; i++) g.step();
  assert.ok(g.castleHp(1) < TUG.castleHp, 'the enemy castle took damage');
  assert.equal(g.castleHp(0), TUG.castleHp);
});

test('a tier unlock skips hull sizes the roster has no design of', () => {
  const giant = STARTER_DESIGNS.find((d) => computeStats(d).size === 4)!;
  assert.ok(giant, 'a giant starter');
  const g = new TugGame(6, [[...ROSTER, giant], [...ROSTER, HEAVY]]);
  assert.equal(g.nextTier(0), 4, 'no heavy designs: medium goes straight to giant');
  assert.equal(g.nextTier(1), 3);
  g.sides[0].gold = 5000;
  assert.equal(g.apply(0, { t: 'tier' }), null);
  assert.equal(g.sides[0].tier, 4);
  assert.equal(g.sides[0].gold, 5000 - TIER_COST[4]);
  assert.equal(g.nextTier(0), null);
  assert.match(g.check(0, { t: 'tier' }) ?? '', /no bigger hulls/);
  // a roster of small hulls only has nothing to unlock at all
  const h = new TugGame(7, [ROSTER, ROSTER]);
  assert.equal(h.nextTier(0), null);
  assert.match(h.check(0, { t: 'tier' }) ?? '', /no bigger hulls/);
});

test('drops may not land on units already there; the castle keeps units out of its whole base', () => {
  const g = new TugGame(8, [ROSTER, ROSTER]);
  g.sides[0].gold = 1e6;
  const [a, b] = ROSTER;
  assert.equal(g.apply(0, { t: 'buy', designId: a.id, x: 12, y: 95 }), null);
  assert.match(g.check(0, { t: 'buy', designId: b.id, x: 12, y: 95 }) ?? '', /in the way/);
  assert.equal(g.check(0, { t: 'buy', designId: b.id, x: 36, y: 95 }), null, 'clear ground elsewhere is fine');
  // the castle's collision circle covers its drawn landing legs and wing walls
  assert.ok(g.battle.radiusOf(g.castles[0]) >= 3.4);
  // a unit marching straight at the castle stops at its rim instead of walking into its legs
  const c = g.battle.units[g.castles[1]];
  const ids = g.battle.spawnBlock(0, 77, ROSTER[0], 1, [{ x: c.x, y: c.y + 9 }]);
  for (let i = 0; i < 20 * 20; i++) g.step();
  for (const id of ids) {
    const u = g.battle.units[id];
    if (u.alive) assert.ok(Math.hypot(u.x - c.x, u.y - c.y) > g.battle.radiusOf(c.id) * 0.95, 'outside the castle');
  }
});

test('a design can only be bought again after its cooldown', () => {
  const g = new TugGame(2, [ROSTER, ROSTER]);
  g.sides[0].gold = 1e6;
  const [a, b] = ROSTER;
  assert.equal(g.apply(0, { t: 'buy', designId: a.id, x: 12, y: 95 }), null);
  assert.match(g.check(0, { t: 'buy', designId: a.id, x: 30, y: 95 }) ?? '', /ready again in 1 s/);
  assert.equal(g.check(0, { t: 'buy', designId: b.id, x: 30, y: 95 }), null, 'other designs are not held up');
  assert.equal(g.check(1, { t: 'buy', designId: a.id, x: 12, y: 18 }), null, 'nor is the other side');
  for (let i = 0; i < TUG.buyCooldown * TICK_RATE - 1; i++) g.step();
  assert.ok(g.cooldown(0, a.id) > 0);
  g.step();
  assert.equal(g.cooldown(0, a.id), 0);
  assert.equal(g.apply(0, { t: 'buy', designId: a.id, x: 30, y: 95 }), null);
});

test('the buy cooldown doubles with each block of that design on the field, and shrinks as they die', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(buyCooldown), [1, 2, 4, 8, 8], 'doubling, capped at 8 s');
  assert.equal(buyCooldown(50), TUG.buyCooldownMax);
  const g = new TugGame(2, [ROSTER, ROSTER]);
  g.sides[0].gold = 1e6;
  const a = ROSTER[0];
  const buyWhenReady = (x: number, y: number) => {
    while (g.cooldown(0, a.id) > 0) g.step();
    assert.equal(g.apply(0, { t: 'buy', designId: a.id, x, y }), null);
    return g.cooldown(0, a.id) / TICK_RATE;
  };
  assert.equal(buyWhenReady(12, 105), 1, '1st block: the 2nd waits 1 s');
  assert.equal(buyWhenReady(36, 105), 2, '2nd block: the 3rd waits 2 s');
  assert.equal(buyWhenReady(12, 92), 4, '3rd block: the 4th waits 4 s');
  assert.equal(g.liveBlocks(0, a.id), 3);
  // wipe out two of the three blocks: the next buy only counts what is left
  for (const ids of g.sides[0].blocks[a.id]!.slice(0, 2)) for (const id of ids) g.battle.units[id]!.alive = false;
  assert.equal(g.liveBlocks(0, a.id), 1);
  assert.equal(g.nextCooldown(0, a.id), 2);
});

test('castles start with a plain gun and can buy any other', () => {
  const g = new TugGame(3, [ROSTER, ROSTER]);
  const guns = castleGuns();
  assert.ok(guns.length > 40);
  assert.ok(guns.every((m) => m.projectile !== 'melee' && !m.resupply));
  assert.ok(guns.some((m) => m.mount === 'XL'), 'titan guns too');
  assert.equal(g.sides[0].castleGun, TUG.startCastleGun);
  const start = MODULE_BY_ID.get(TUG.startCastleGun)!;
  assert.ok(castleGunPrice(start) <= 100, 'the starting gun is a cheap one');
  const big = MODULE_BY_ID.get('avenger')!;
  assert.ok(castleGunPrice(big) > 1000, 'a big gun costs a lot');
  assert.match(g.check(0, { t: 'castleGun', moduleId: 'avenger' }) ?? '', /gold/);
  assert.match(g.check(0, { t: 'castleGun', moduleId: 'buzzsaw' }) ?? '', /castle gun/);
  assert.match(g.check(0, { t: 'castleGun', moduleId: TUG.startCastleGun }) ?? '', /already/);
  // buying swaps the castle for a re-armed one: same place, same hp, still the core
  const old = g.battle.units[g.castles[0]];
  old.hp = 12345;
  g.sides[0].gold = 5000;
  assert.equal(g.apply(0, { t: 'castleGun', moduleId: 'avenger' }), null);
  assert.equal(g.sides[0].gold, 5000 - castleGunPrice(big));
  const c = g.battle.units[g.castles[0]];
  assert.notEqual(c, old);
  assert.equal(old.alive, false);
  assert.deepEqual([c.x, c.y, c.hp, c.maxHp, c.stats.armor], [old.x, old.y, 12345, TUG.castleHp, old.stats.armor]);
  assert.equal(c.design.mounts[0], 'avenger');
  assert.equal(g.battle.cores[0], c.id);
  assert.equal(g.castleHp(0), 12345);
  for (let i = 0; i < 20 * 5; i++) g.step();
  assert.equal(g.done, false, 'the old castle leaving does not end the game');
  c.hp = 1; c.alive = false;
  g.step();
  assert.equal(g.winner, 1);
});

test('a dropped block is frozen for the spawn time but fires from the start', () => {
  const solo = ROSTER.find((d) => computeStats(d).squad === 1 && computeStats(d).speed > 0 && computeStats(d).dps > 0)!;
  const g = new TugGame(5, [[solo], [solo]]);
  assert.equal(g.apply(0, { t: 'buy', designId: solo.id, x: 12, y: 95 }), null);
  const id = g.spawns[0].ids[0];
  const u = g.battle.units[id];
  const x0 = u.x, y0 = u.y;
  // an enemy parked right in front of it (straight into the sim, past the drop rules), itself frozen for good
  const foe = g.battle.units[g.battle.spawnBlock(1, 99, solo, 1, [{ x: 12, y: 95 - Math.min(6, computeStats(solo).range * 0.6) }], 1e6)[0]];
  let fired = false;
  for (let i = 0; i < TUG.spawnFreeze * 20 - 1; i++) {
    g.step();
    if (g.battle.events.some((e) => e.t === 'fire' && e.unit === id)) fired = true;
  }
  assert.ok(Math.hypot(u.x - x0, u.y - y0) < 0.3, 'held its spot while frozen');
  assert.ok(fired, 'its guns fired while frozen');
  assert.equal(g.spawns.length, 1);
  for (let i = 0; i < 20; i++) g.step();
  assert.equal(g.spawns.length, 0, 'thawed');
  // nothing left in reach: it marches on the enemy castle
  foe.alive = false;
  const y1 = u.y;
  for (let i = 0; i < 20 * 3; i++) g.step();
  assert.ok(u.alive && y1 - u.y > 1, 'moves once thawed');
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
  setField(STANDARD_FIELD);
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
  hub.command(b, r0.id, { t: 'buy', designId: ROSTER[0].id, x: 12, y: 18 });
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

test('a dropped squad keeps the spacing it was bought with', () => {
  const sq = STARTER_DESIGNS.find((d) => computeStats(d).squad >= 4 && computeStats(d).size <= 2)!;
  const roster = [sq, ...ROSTER.filter((d) => d.id !== sq.id)].slice(0, 6);
  const width = (sp?: number) => {
    const g = new TugGame(3, [roster, roster]);
    g.sides[0].gold = 1e6;
    assert.equal(g.apply(0, { t: 'buy', designId: sq.id, x: 30, y: 95, ...(sp ? { spacing: sp } : {}) }), null);
    const xs = g.battle.units.filter((u) => u.side === 0 && u.design.id === sq.id).map((u) => u.x);
    return Math.max(...xs) - Math.min(...xs);
  };
  const tight = width(), open = width(2);
  assert.ok(open > tight + 1, `spacing 2 opens the formation (${tight} -> ${open})`);
  // the network shape check keeps only whole steps inside 0..MAX_SPACING
  assert.equal((sanitizeCommand({ t: 'buy', designId: 'x', x: 1, y: 1, spacing: 2 }) as { spacing?: number }).spacing, 2);
  assert.equal((sanitizeCommand({ t: 'buy', designId: 'x', x: 1, y: 1, spacing: 9 }) as { spacing?: number }).spacing, undefined);
  assert.equal((sanitizeCommand({ t: 'buy', designId: 'x', x: 1, y: 1, spacing: 1.5 }) as { spacing?: number }).spacing, undefined);
});
