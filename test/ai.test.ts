import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiDeck, aiDeploy, profile, type AiDifficulty } from '../src/shared/ai.ts';
import { newMatch, newPlayer, validateDeck, validateDeploy, applyDeploy, resolveRound, DECK_SIZE } from '../src/shared/match.ts';
import type { MatchState } from '../src/shared/types.ts';

test('aiDeck is valid, deterministic and covers roles', () => {
  for (const diff of ['easy', 'normal', 'hard'] as AiDifficulty[]) {
    for (let seed = 1; seed <= 25; seed++) {
      const d = aiDeck(seed, diff);
      assert.ok(d.length >= 6 && d.length <= DECK_SIZE, `size ${d.length}`);
      assert.deepEqual(validateDeck(d), [], `seed ${seed} ${diff}`);
      assert.deepEqual(aiDeck(seed, diff), d);
      const p = d.map(profile);
      assert.ok(p.some((x) => x.aaDps > 0), 'anti-air');
      assert.ok(p.some((x) => x.flying), 'flyer');
      assert.ok(p.some((x) => x.groundDps > 0 && !x.flying), 'ground attack');
    }
  }
});

export function playMatch(seed: number, a: AiDifficulty, b: AiDifficulty): MatchState {
  const m = newMatch(`t${seed}`, 'ai', seed, newPlayer('A', aiDeck(seed * 2 + 1, a), true), newPlayer('B', aiDeck(seed * 2 + 2, b), true));
  let guard = 0;
  while (m.status === 'deploy' && guard++ < 50) {
    for (const side of [0, 1] as const) {
      const act = aiDeploy(m, side, side === 0 ? a : b);
      const err = validateDeploy(m, side, act);
      assert.equal(err, null, `round ${m.round} side ${side}: ${err}`);
      applyDeploy(m, side, act);
    }
    resolveRound(m);
  }
  return m;
}

test('AI vs AI matches complete with valid deployments', () => {
  const pairs: [AiDifficulty, AiDifficulty][] = [['easy', 'normal'], ['normal', 'hard'], ['hard', 'easy']];
  pairs.forEach(([a, b], i) => {
    const m = playMatch(100 + i, a, b);
    assert.equal(m.status, 'done');
    assert.ok(m.winner !== undefined);
    // AIs actually spend: after round 1 both have units
    assert.ok(m.history[0].boards[0].length > 0 && m.history[0].boards[1].length > 0);
  });
});

test('aiDeploy is deterministic', () => {
  const mk = () => newMatch('d', 'ai', 9, newPlayer('A', aiDeck(1, 'hard'), true), newPlayer('B', aiDeck(2, 'hard'), true));
  assert.deepEqual(aiDeploy(mk(), 0, 'hard'), aiDeploy(mk(), 0, 'hard'));
  assert.deepEqual(aiDeploy(mk(), 1, 'normal'), aiDeploy(mk(), 1, 'normal'));
});

test('aiDeploy returns a legal (empty) action when it cannot deploy', () => {
  const m = newMatch('w', 'pvp', 1, newPlayer('A', aiDeck(1, 'normal')));
  const a = aiDeploy(m, 0, 'normal');
  assert.deepEqual(a.place, []);
});
