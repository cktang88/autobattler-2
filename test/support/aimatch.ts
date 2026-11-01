// One full AI vs AI match (shared by ai.test.ts, which runs these on worker threads via pool.ts).
import assert from 'node:assert/strict';
import { aiDeck, aiDeploy, type AiDifficulty } from '../../src/shared/ai.ts';
import { newMatch, newPlayer, validateDeploy, applyDeploy, resolveRound } from '../../src/shared/match.ts';
import type { MatchState } from '../../src/shared/types.ts';

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
