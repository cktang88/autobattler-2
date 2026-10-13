// STUB — the match/AI agent replaces bodies with the real implementation. Keep the exported API.
// Pure, deterministic match rules shared by the server (PvP) and the client (vs AI).

import type { DeployAction, Design, MatchMode, MatchState, PlayerState, Side } from './types.ts';

export const DECK_SIZE = 9;
export const START_HP = 0;

/** Supply granted at the start of `round` (1-based). */
export function supplyForRound(round: number): number { return 0; }
/** Cost to raise a unit from `level` to `level + 1`. */
export function upgradeCost(design: Design, level: number): number { return 0; }

export function newPlayer(name: string, deck: Design[], isAI?: boolean): PlayerState {
  throw new Error('stub');
}

/** Create a match. For 'pvp' the second player may be filled later via joinMatch (status 'waiting'). */
export function newMatch(id: string, mode: MatchMode, seed: number, p0: PlayerState, p1?: PlayerState, now?: number): MatchState {
  throw new Error('stub');
}
export function joinMatch(m: MatchState, p1: PlayerState, now?: number): void {}

export function validateDeck(deck: Design[]): string[] { return []; }
/** Returns an error string, or null when the action is legal for `side` right now. */
export function validateDeploy(m: MatchState, side: Side, a: DeployAction): string | null { return 'stub'; }
/** Apply a validated action, deduct supply, mark ready. */
export function applyDeploy(m: MatchState, side: Side, a: DeployAction): void {}
/** When both players are ready: simulate, apply damage, record history, advance round or finish. */
export function resolveRound(m: MatchState, now?: number): void {}
/** Copy of the match as `viewer` may see it: hides the opponent's not-yet-resolved placements & supply. */
export function redactFor(m: MatchState, viewer: Side): MatchState { return m; }

import type { BattleInput } from './sim/types.ts';
import type { RoundRecord } from './types.ts';
/** Rebuild the exact BattleInput a recorded round was simulated with (for client replay). */
export function battleInputFor(m: MatchState, rec: RoundRecord): BattleInput { throw new Error('stub'); }
