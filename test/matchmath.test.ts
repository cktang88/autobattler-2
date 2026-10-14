import { test } from 'node:test';
import assert from 'node:assert/strict';
import { START_HP } from '../src/shared/match.ts';
import { hpAfterRound, totalDamageTaken } from '../src/client/ui/matchmath.ts';

type M = Parameters<typeof hpAfterRound>[0];
const match = (hp: [number, number], dmg: [number, number][]): M => ({
  players: [{ hp: hp[0] }, { hp: hp[1] }] as unknown as M['players'],
  history: dmg.map((damage, i) => ({ round: i + 1, result: { damage, winner: -1, survivors: [[], []], ticks: 0 } })) as unknown as M['history'],
});

test('hpAfterRound rebuilds HP before/after each round while alive', () => {
  const m = match([START_HP - 30, START_HP], [[10, 0], [20, 0]]);
  assert.equal(hpAfterRound(m, 0, 0), START_HP);
  assert.equal(hpAfterRound(m, 0, 1), START_HP - 10);
  assert.equal(hpAfterRound(m, 0, 2), START_HP - 30);
  assert.equal(hpAfterRound(m, 0, Infinity), START_HP - 30);
  assert.equal(hpAfterRound(m, 1, 1), START_HP);
});

test('hpAfterRound is not fooled by the clamped killing blow', () => {
  // 100 -> 60 -> 30 -> 0 (the last round dealt 64 into 30 HP; stored HP is clamped at 0)
  const m = match([0, START_HP], [[40, 0], [30, 0], [64, 0]]);
  assert.equal(hpAfterRound(m, 0, 2), START_HP - 70, 'HP shown during the final replay');
  assert.equal(hpAfterRound(m, 0, 3), 0);
  assert.equal(hpAfterRound(m, 0, Infinity), 0);
});

test('totalDamageTaken never exceeds the starting HP', () => {
  assert.equal(totalDamageTaken(match([0, START_HP], [[60, 0], [70, 0]]), 0), START_HP);
  assert.equal(totalDamageTaken(match([START_HP - 25, START_HP], [[5, 0], [20, 0]]), 0), 25);
  assert.equal(totalDamageTaken(match([START_HP, START_HP], []), 1), 0);
});
