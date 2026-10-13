// A MatchDriver hides whether the opponent is the local AI or a remote player.
// LocalDriver (localdriver.ts) runs match.ts + ai.ts in the browser; NetDriver (net.ts) talks to the server.

import type { DeployAction, MatchMode, MatchState, Side } from '../shared/types.ts';

export interface MatchDriver {
  readonly side: Side;
  readonly mode: MatchMode;
  /** latest state as this player may see it (opponent's pending placements hidden) */
  state(): MatchState;
  /** Submit this round's deployment. Rejects with an Error(message) if invalid.
   *  LocalDriver resolves the round immediately; NetDriver resolves once the server accepts. */
  submit(a: DeployAction): Promise<void>;
  /** Called whenever state changes (opponent joined/ready, round resolved). Returns unsubscribe. */
  subscribe(cb: (m: MatchState) => void): () => void;
  /** begin polling (net) — no-op for local */
  start(): void;
  stop(): void;
  /** human-readable opponent label */
  opponentName(): string;
}
