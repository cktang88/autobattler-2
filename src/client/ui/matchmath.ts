// Pure helpers behind the match screen's HP readouts (kept DOM-free so they can be unit tested).

import { START_HP } from '../../shared/match.ts';
import type { MatchState, Side } from '../../shared/types.ts';

/** Commander HP of side `s` right after round `throughRound` (Infinity = now), rebuilt from the round history. */
export function hpAfterRound(m: Pick<MatchState, 'players' | 'history'>, s: Side, throughRound: number): number {
  if (m.players[s].hp > 0) { // nothing clamped yet: undo the later rounds' damage
    let hp = m.players[s].hp;
    for (const r of m.history) if (r.round > throughRound) hp += r.result.damage[s];
    return hp;
  }
  // stored HP is clamped at 0, so the killing round's overshoot can't be undone: replay forward from the start
  let hp = START_HP;
  for (const r of m.history) if (r.round <= throughRound) hp = Math.max(0, hp - r.result.damage[s]);
  return hp;
}

/** Commander damage side `s` took over the whole match; the killing blow's overshoot is not counted. */
export function totalDamageTaken(m: Pick<MatchState, 'history'>, s: Side): number {
  return Math.min(START_HP, m.history.reduce((t, r) => t + r.result.damage[s], 0));
}
