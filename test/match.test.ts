import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { validateDesign, computeStats, MAX_LEVEL } from '../src/shared/stats.ts';
import {
  START_HP, DECK_SIZE, MAX_UNITS, newPlayer, newMatch, joinMatch, validateDeck, validateDeploy, applyDeploy,
  resolveRound, redactFor, battleInputFor, supplyForRound, upgradeCost, submitDeploy, isPlaceholder, roundDamage,
} from '../src/shared/match.ts';
import type { DeployAction, MatchState, Placement } from '../src/shared/types.ts';

test('starter designs are valid, unique and cover sizes/flyers/static', () => {
  assert.ok(STARTER_DESIGNS.length >= 10);
  const ids = new Set<string>();
  for (const d of STARTER_DESIGNS) {
    assert.deepEqual(validateDesign(d), [], d.name);
    assert.ok(d.id.startsWith('starter-'));
    assert.ok(!ids.has(d.id));
    ids.add(d.id);
  }
  const stats = STARTER_DESIGNS.map(computeStats);
  assert.ok(stats.some((s) => s.size === 3));
  assert.ok(stats.some((s) => s.flying));
  assert.ok(stats.some((s) => s.isStatic));
  assert.ok(stats.some((s) => s.heal > 0));
  assert.ok(stats.some((s) => s.cost <= supplyForRound(1) / 4));
});

const deck = STARTER_DESIGNS.slice(0, DECK_SIZE);
const cheap = STARTER_DESIGNS.find((d) => computeStats(d).size === 1)!;
const big = STARTER_DESIGNS.find((d) => computeStats(d).size === 3)!;

function fresh(): MatchState {
  return newMatch('m1', 'ai', 42, newPlayer('A', [cheap, big, ...deck.filter((d) => d !== cheap && d !== big)].slice(0, DECK_SIZE)), newPlayer('B', deck, true), 1000);
}
const pl = (uid: number, x: number, y: number, designId = cheap.id, round = 1): Placement => ({ uid, designId, x, y, level: 1, round });

test('newMatch / join', () => {
  const m = fresh();
  assert.equal(m.status, 'deploy');
  assert.equal(m.round, 1);
  assert.equal(m.players[0].hp, START_HP);
  assert.equal(m.players[0].supply, supplyForRound(1));
  const w = newMatch('m2', 'pvp', 1, newPlayer('A', deck));
  assert.equal(w.status, 'waiting');
  assert.ok(isPlaceholder(w.players[1]));
  joinMatch(w, newPlayer('B', deck), 5);
  assert.equal(w.status, 'deploy');
  assert.equal(w.players[1].supply, supplyForRound(1));
  assert.equal(w.updatedAt, 5);
});

test('validateDeck', () => {
  assert.deepEqual(validateDeck(deck), []);
  assert.ok(validateDeck([]).length);
  assert.ok(validateDeck([...STARTER_DESIGNS, ...STARTER_DESIGNS].slice(0, DECK_SIZE + 1)).length);
  assert.ok(validateDeck([deck[0], deck[0]]).length);
  assert.ok(validateDeck([{ ...deck[0], name: '' }]).length);
  assert.ok(validateDeck([{ ...deck[0], mounts: ['nope'] }]).length);
});

test('validateDeploy accepts a legal deployment and rejects bad ones', () => {
  const m = fresh();
  const ok: DeployAction = { round: 1, place: [pl(1, 0, 0), pl(2, 1, 0)], upgrade: [] };
  assert.equal(validateDeploy(m, 0, ok), null);
  // overlap with each other
  assert.match(validateDeploy(m, 0, { round: 1, place: [pl(1, 0, 0), pl(2, 0, 0)], upgrade: [] })!, /overlap/);
  // big unit overlapping a small one
  assert.match(validateDeploy(m, 0, { round: 1, place: [pl(1, 5, 5), pl(2, 4, 4, big.id)], upgrade: [] })!, /overlap/);
  // out of zone
  assert.match(validateDeploy(m, 0, { round: 1, place: [pl(1, 23, 8, big.id)], upgrade: [] })!, /zone/);
  assert.match(validateDeploy(m, 0, { round: 1, place: [pl(1, -1, 0)], upgrade: [] })!, /zone/);
  assert.match(validateDeploy(m, 0, { round: 1, place: [pl(1, 0.5, 0)], upgrade: [] })!, /zone/);
  // over budget
  const many = Array.from({ length: 20 }, (_, i) => pl(i + 1, i, 0));
  assert.match(validateDeploy(m, 0, { round: 1, place: many, upgrade: [] })!, /supply/);
  // bad uids
  assert.match(validateDeploy(m, 0, { round: 1, place: [pl(0, 0, 0)], upgrade: [] })!, /unit id/);
  assert.match(validateDeploy(m, 0, { round: 1, place: [pl(3, 0, 0), pl(3, 2, 0)], upgrade: [] })!, /Duplicate/);
  // wrong round, unknown design, level
  assert.ok(validateDeploy(m, 0, { round: 2, place: [], upgrade: [] }));
  assert.ok(validateDeploy(m, 0, { round: 1, place: [pl(1, 0, 0, 'zzz')], upgrade: [] }));
  assert.ok(validateDeploy(m, 0, { round: 1, place: [{ ...pl(1, 0, 0), level: 2 }], upgrade: [] }));
  assert.ok(validateDeploy(m, 0, { round: 1, place: [pl(1, 0, 0, cheap.id, 3)], upgrade: [] }));
  // upgrade of nonexistent unit
  assert.ok(validateDeploy(m, 0, { round: 1, place: [], upgrade: [7] }));
});

test('apply, upgrade limits, overlap with existing board, unit cap', () => {
  const m = fresh();
  const err = submitDeploy(m, 0, { round: 1, place: [pl(1, 0, 0), pl(2, 3, 0)], upgrade: [] });
  assert.equal(err, null);
  assert.equal(m.players[0].nextUid, 3);
  assert.equal(m.players[0].supply, supplyForRound(1) - 2 * computeStats(cheap).cost);
  assert.ok(validateDeploy(m, 0, { round: 1, place: [], upgrade: [] }), 'already ready');
  submitDeploy(m, 1, { round: 1, place: [], upgrade: [] });
  assert.equal(m.round, 2);
  assert.equal(m.history.length, 1);
  // overlap with existing unit
  assert.match(validateDeploy(m, 0, { round: 2, place: [pl(3, 0, 0, cheap.id, 2)], upgrade: [] })!, /overlap/);
  // upgrades
  m.players[0].supply = 100000;
  const ups = Array(MAX_LEVEL - 1).fill(1);
  assert.equal(validateDeploy(m, 0, { round: 2, place: [], upgrade: ups }), null);
  assert.match(validateDeploy(m, 0, { round: 2, place: [], upgrade: [...ups, 1] })!, /max level/);
  const before = m.players[0].supply;
  applyDeploy(m, 0, { round: 2, place: [], upgrade: ups });
  assert.equal(m.players[0].board[0].level, MAX_LEVEL);
  let c = 0;
  for (let l = 1; l < MAX_LEVEL; l++) c += upgradeCost(cheap, l);
  assert.equal(before - m.players[0].supply, c);
  // unit cap
  const m2 = fresh();
  m2.players[0].supply = 1e9;
  const lots: Placement[] = [];
  for (let i = 0; i < MAX_UNITS + 1; i++) lots.push(pl(i + 1, i % 24, Math.floor(i / 24)));
  assert.match(validateDeploy(m2, 0, { round: 1, place: lots, upgrade: [] })!, /Too many/);
});

test('redaction hides pending placements, upgrades and supply', () => {
  const m = fresh();
  submitDeploy(m, 0, { round: 1, place: [pl(1, 0, 0)], upgrade: [] });
  submitDeploy(m, 1, { round: 1, place: [pl(1, 0, 0, deck[0].id)], upgrade: [] });
  // round 2: p1 places another unit and upgrades its old one
  m.players[1].supply = 10000;
  submitDeploy(m, 1, { round: 2, place: [pl(2, 5, 5, deck[0].id, 2)], upgrade: [1] });
  const v = redactFor(m, 0);
  assert.equal(v.players[1].board.length, 1);
  assert.equal(v.players[1].board[0].uid, 1);
  assert.equal(v.players[1].board[0].level, 1);
  assert.equal(v.players[1].supply, -1);
  assert.equal(v.players[1].ready, true);
  assert.notEqual(v.players[0].supply, -1);
  // original untouched
  assert.equal(m.players[1].board.length, 2);
  assert.equal(m.players[1].board[0].level, 2);
  // p1 sees its own stuff
  assert.equal(redactFor(m, 1).players[1].board.length, 2);
});

test('battleInputFor rebuilds the recorded input; damage rules', () => {
  const m = fresh();
  submitDeploy(m, 0, { round: 1, place: [pl(1, 0, 0)], upgrade: [] });
  submitDeploy(m, 1, { round: 1, place: [pl(1, 0, 0)], upgrade: [] });
  const rec = m.history[0];
  const bi = battleInputFor(m, rec);
  assert.equal(bi.seed, rec.seed);
  assert.deepEqual(bi.sides[0].units, rec.boards[0]);
  const boards: [Placement[], Placement[]] = [[pl(1, 0, 0, big.id)], [pl(1, 0, 0)]];
  const [d0, d1] = roundDamage(m, 3, 0, [[1], []], boards);
  assert.equal(d0, 0);
  assert.ok(d1 > 5);
  const [e0, e1] = roundDamage(m, 3, -1, [[], []], boards);
  assert.ok(e0 > 0 && e0 === e1);
});

test('match ends by hp or round cap', () => {
  const m = fresh();
  m.players[1].hp = 1;
  // force a draw-ish outcome: both empty boards; draw damage kills p1 at 1 hp
  submitDeploy(m, 0, { round: 1, place: [], upgrade: [] });
  submitDeploy(m, 1, { round: 1, place: [], upgrade: [] });
  assert.equal(m.status, 'done');
  assert.ok(m.winner === 0);
  const m2 = fresh();
  for (let r = 1; r <= 40 && m2.status === 'deploy'; r++) {
    m2.players[0].hp = m2.players[1].hp = 1e6; // never die
    submitDeploy(m2, 0, { round: m2.round, place: [], upgrade: [] });
    submitDeploy(m2, 1, { round: m2.round, place: [], upgrade: [] });
  }
  assert.equal(m2.status, 'done');
  assert.equal(m2.winner, -1);
  assert.equal(m2.history.length, 15);
});

test('resolveRound is a no-op until both ready', () => {
  const m = fresh();
  resolveRound(m);
  assert.equal(m.history.length, 0);
});
