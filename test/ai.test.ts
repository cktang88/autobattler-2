import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiDeck, aiDeploy, profile, type AiDifficulty } from '../src/shared/ai.ts';
import { MAX_BLOCKS, MAX_SIM_UNITS, newMatch, newPlayer, validateDeck, validateDeploy, applyDeploy, resolveRound, DECK_SIZE } from '../src/shared/match.ts';
import { blockCells, squadSize, overlaps, blockInZone } from '../src/shared/grid.ts';
import { computeStats } from '../src/shared/stats.ts';
import type { MatchState, Placement } from '../src/shared/types.ts';

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

function checkBoard(m: MatchState, side: 0 | 1, board: Placement[]) {
  const byId = new Map(m.players[side].deck.map((d) => [d.id, d] as const));
  assert.ok(board.length <= MAX_BLOCKS);
  let units = 0;
  const feet: { x: number; y: number; s: number }[] = [];
  for (const p of board) {
    const size = computeStats(byId.get(p.designId)!).size;
    units += squadSize(size);
    assert.ok(blockInZone(p.x, p.y, size, p.spacing ?? 0), 'in zone');
    const s = blockCells(size, p.spacing ?? 0);
    for (const f of feet) assert.ok(!overlaps(p.x, p.y, s, f.x, f.y, f.s), 'no overlap');
    feet.push({ x: p.x, y: p.y, s });
    if (size > 1) assert.ok(!p.spacing, 'non-squads have no spacing');
  }
  assert.ok(units <= MAX_SIM_UNITS);
}

test('AI boards are valid blocks; squads get spacing; matches last about 5-8 rounds', () => {
  let rounds = 0, spaced = 0, squads = 0, n = 0;
  for (let i = 0; i < 4; i++) {
    const m = playMatch(200 + i, 'normal', 'hard');
    rounds += m.history.length; n++;
    for (const r of m.history) for (const side of [0, 1] as const) {
      checkBoard(m, side, r.boards[side]);
      for (const p of r.boards[side]) {
        const d = m.players[side].deck.find((x) => x.id === p.designId)!;
        if (computeStats(d).size === 1) { squads++; if ((p.spacing ?? 0) > 0) spaced++; }
      }
    }
  }
  assert.ok(squads > 0 && spaced > 0, `squads ${squads} spaced ${spaced}`);
  const avg = rounds / n;
  assert.ok(avg >= 4 && avg <= 9.5, `avg rounds ${avg}`);
});

test('hard AI decision stays fast (<1.5s)', () => {
  const m = playMatch(300, 'hard', 'normal');
  assert.equal(m.status, 'done');
  const mm = newMatch('x', 'ai', 5, newPlayer('A', aiDeck(5, 'hard'), true), newPlayer('B', aiDeck(6, 'hard'), true));
  const t = performance.now();
  aiDeploy(mm, 0, 'hard');
  assert.ok(performance.now() - t < 1500);
});
