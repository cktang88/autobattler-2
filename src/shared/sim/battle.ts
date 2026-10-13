// STUB — the sim agent replaces this file with the real implementation. Keep the exported API.

import type { BattleEvent, BattleInput, BattleSummary, SimProjectile, SimUnit } from './types.ts';

export class Battle {
  readonly input: BattleInput;
  tick = 0;
  done = false;
  winner: 0 | 1 | -1 = -1;
  units: SimUnit[] = [];
  projectiles: SimProjectile[] = [];
  /** events produced by the most recent step() only */
  events: BattleEvent[] = [];

  constructor(input: BattleInput) {
    this.input = input;
  }

  /** Advance one tick (DT seconds). No-op once done. */
  step(): void {
    this.done = true;
  }

  summary(): BattleSummary {
    return { winner: this.winner, ticks: this.tick, survivors: [[], []], damageDealt: [0, 0] };
  }
}

/** Run to completion headlessly. */
export function runBattle(input: BattleInput): BattleSummary {
  const b = new Battle(input);
  while (!b.done) b.step();
  return b.summary();
}
