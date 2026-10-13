// STUB — the match/AI agent replaces bodies. Keep the exported API.

import type { DeployAction, Design, MatchState, Side } from './types.ts';

export type AiDifficulty = 'easy' | 'normal' | 'hard';

/** Build an AI deck of up to DECK_SIZE valid designs (deterministic for a seed). */
export function aiDeck(seed: number, difficulty: AiDifficulty): Design[] { return []; }
/** Decide the AI's deployment for the current round. Must pass validateDeploy. */
export function aiDeploy(m: MatchState, side: Side, difficulty: AiDifficulty): DeployAction {
  return { round: m.round, place: [], upgrade: [] };
}
