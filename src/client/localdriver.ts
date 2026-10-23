// vs-AI MatchDriver: runs match.ts rules + ai.ts entirely in the browser.
// The in-progress match is persisted in localStorage so a refresh can resume it.

import { aiDeck, aiDeploy, type AiDifficulty } from '../shared/ai.ts';
import { applyDeploy, migrateMatch, newMatch, newPlayer, redactFor, resolveRound, validateDeploy } from '../shared/match.ts';
import { isValidDesign } from '../shared/stats.ts';
import type { DeployAction, Design, MatchMode, MatchState, Side } from '../shared/types.ts';
import type { MatchDriver } from './driver.ts';

const KEY_LOCAL = 'ab2.localMatch';
const WATCH_PREFIX = 'ab2.watched.';

interface SavedLocal { v: 1; difficulty: AiDifficulty; match: MatchState }

export const AI_NAMES: Record<AiDifficulty, string> = {
  easy: 'Rustbucket AI',
  normal: 'Foundry AI',
  hard: 'Overmind AI',
};

function randomSeed(): number {
  try {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0];
  } catch {
    return (Math.random() * 2 ** 32) >>> 0;
  }
}

/** Last round the player has watched the replay of, per match id. */
export function lastWatched(matchId: string): number {
  try { return Number(localStorage.getItem(WATCH_PREFIX + matchId)) || 0; } catch { return 0; }
}
export function setLastWatched(matchId: string, round: number): void {
  try { localStorage.setItem(WATCH_PREFIX + matchId, String(round)); } catch { /* ignore */ }
}

export class LocalDriver implements MatchDriver {
  readonly side: Side = 0;
  readonly mode: MatchMode = 'ai';
  readonly difficulty: AiDifficulty;
  private match: MatchState;
  private subs = new Set<(m: MatchState) => void>();

  constructor(match: MatchState, difficulty: AiDifficulty) {
    this.match = match;
    this.difficulty = difficulty;
  }

  /** Start a fresh match vs the AI (replaces any saved local match). */
  static create(difficulty: AiDifficulty, deck: Design[], playerName: string): LocalDriver {
    const seed = randomSeed();
    const id = 'local-' + Date.now().toString(36) + '-' + (seed % 46656).toString(36);
    const you = newPlayer(playerName, deck.map((d) => structuredClone(d)));
    const ai = newPlayer(AI_NAMES[difficulty], aiDeck(seed ^ 0x5bd1e995, difficulty), true);
    const m = newMatch(id, 'ai', seed, you, ai, Date.now());
    LocalDriver.clearSaved();
    const d = new LocalDriver(m, difficulty);
    d.save();
    return d;
  }

  /** The saved local match, if any (including finished ones whose final replay hasn't been watched). */
  static loadSaved(): SavedLocal | null {
    try {
      const raw = localStorage.getItem(KEY_LOCAL);
      if (!raw) return null;
      const s = JSON.parse(raw) as SavedLocal;
      if (s?.v !== 1 || !s.match?.players) return null;
      // saves from before the price / 5 rescale carry 5x supply: rescale them (and stamp the rules version) once
      if (migrateMatch(s.match)) {
        // a design the current parts rules reject is skipped by the sim: the player would pay for blocks that never
        // fight. Such a stale save can't be played fairly; drop it so a fresh match starts instead.
        const broken = s.match.status !== 'done' && s.match.players.some((p) => p.deck.some((d) => { try { return !isValidDesign(d); } catch { return true; } }));
        if (broken) { localStorage.removeItem(KEY_LOCAL); localStorage.removeItem(WATCH_PREFIX + s.match.id); return null; }
        localStorage.setItem(KEY_LOCAL, JSON.stringify(s));
      }
      return s;
    } catch {
      return null;
    }
  }

  /** Is there a local match worth resuming? */
  static resumable(): SavedLocal | null {
    const s = LocalDriver.loadSaved();
    if (!s) return null;
    const m = s.match;
    if (m.status !== 'done') return s;
    const last = m.history[m.history.length - 1];
    return last && lastWatched(m.id) < last.round ? s : null;
  }

  static resume(): LocalDriver | null {
    const s = LocalDriver.resumable();
    return s ? new LocalDriver(s.match, s.difficulty) : null;
  }

  static clearSaved(): void {
    const s = LocalDriver.loadSaved();
    try {
      localStorage.removeItem(KEY_LOCAL);
      if (s) localStorage.removeItem(WATCH_PREFIX + s.match.id);
    } catch { /* ignore */ }
  }

  private save(): void {
    try {
      const s: SavedLocal = { v: 1, difficulty: this.difficulty, match: this.match };
      localStorage.setItem(KEY_LOCAL, JSON.stringify(s));
    } catch { /* storage full/unavailable: play on without persistence */ }
  }

  state(): MatchState {
    return redactFor(this.match, 0);
  }

  async submit(a: DeployAction): Promise<void> {
    const m = this.match;
    const err = validateDeploy(m, 0, a);
    if (err) throw new Error(err);
    // AI decides before seeing the player's new placements (the player's board only holds resolved units here).
    let ai: DeployAction;
    try {
      ai = aiDeploy(redactFor(m, 1), 1, this.difficulty);
    } catch (e) {
      console.warn('aiDeploy failed', e);
      ai = { round: m.round, place: [], upgrade: [] };
    }
    const aiErr = validateDeploy(m, 1, ai);
    if (aiErr) {
      console.warn('AI deploy rejected:', aiErr, ai);
      ai = { round: m.round, place: [], upgrade: [] };
    }
    // the rules mutate the match in place: if anything throws (a sim bug), roll back to the state before this
    // submit so the player can retry instead of being stuck with both sides marked ready and the supply spent
    const before = structuredClone(m);
    try {
      applyDeploy(m, 0, structuredClone(a));
      if (!m.players[1].ready) applyDeploy(m, 1, ai);
      resolveRound(m, Date.now());
    } catch (e) {
      this.match = before;
      throw e;
    }
    this.save();
    const view = this.state();
    for (const cb of [...this.subs]) {
      try { cb(view); } catch (e) { console.error(e); }
    }
  }

  subscribe(cb: (m: MatchState) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  start(): void {}
  stop(): void {}

  opponentName(): string {
    return this.match.players[1].name;
  }
}
