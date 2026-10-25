// The global AI design pool (shared/aipool.ts), kept by the server and fed by vs-AI match reports.
//
// Flow: POST /api/aipool/report -> validateReport (cheap, synchronous: shape, size, decks, rules) -> queue. A
// background worker re-simulates the reported rounds one per macrotask (never trusting client scores; a round whose
// re-simulated result differs from the reported one rejects the report), then:
//  - the AI's own designs' running scores update (GLOBAL_ALPHA, small: many reports);
//  - the player's best designs that earned adoption become CANDIDATES; a candidate joins the pool only once
//    ADOPT_REPORTERS distinct reporters (accounts, else IPs) have reported it earning adoption;
//  - the AI's clearly ineffective designs spawn at most one mutant per report (capped unproven mutants);
//  - the weakest entry may be pruned.
// Anti-abuse: per-reporter rate limit (api.ts), dedupe by match id, a capped queue, capped candidate list, distinct
// reporters for adoption, re-simulation of every round.

import { DECK_SIZE, MAX_BLOCKS, MAX_ROUNDS, RULES_VERSION, MAX_SIM_UNITS, START_HP, placementValue, roundDamage, shapeOf, totalSupplyThrough, validateDeck } from '../shared/match.ts';
import {
  combinePerf, defaultPool, findByKey, findBySlot, blendScore, hash, insertEntry, mutateWeak, playerCandidates, poolKey,
  pruneWeakest, sanitizePool, simRound, updateAiScores, validEntryDesign, type AiPool, type PoolEntry, type RoundTally,
} from '../shared/aipool.ts';
import { blockInZone, MAX_SPACING } from '../shared/grid.ts';
import { mixSeed } from '../shared/rng.ts';
import { MAX_LEVEL } from '../shared/stats.ts';
import { STANCES, TARGET_PRIORITIES } from '../shared/types.ts';
import type { Design, MatchState, Placement, PlayerState, RoundRecord, Side } from '../shared/types.ts';
import { HttpError, sanitizeDeck } from './validate.ts';

/** distinct reporters a player design needs before it joins the global pool */
export const ADOPT_REPORTERS = 3;
/** most candidate designs remembered (least recently seen dropped first) */
export const MAX_CANDIDATES = 200;
/** reported match ids remembered for dedupe */
export const MAX_SEEN = 20_000;
/** reports waiting for re-simulation; beyond this the server answers 503 */
export const MAX_QUEUE = 30;
/** weight of one report in an AI design's running score (the pool sees many reports) */
export const GLOBAL_ALPHA = 0.1;
/** body limit of a report (a full 15-round match with both boards per round) */
export const REPORT_BODY_LIMIT = 1024 * 1024;

export interface PoolCandidate {
  design: Design;
  key: string;
  /** distinct reporter keys (hashed) that reported it earning adoption */
  reporters: string[];
  effSum: number;
  n: number;
  lastSeen: number;
}

export interface GlobalPoolState {
  version: 1;
  pool: AiPool;
  candidates: PoolCandidate[];
  /** reported match ids (dedupe), oldest first */
  seen: string[];
  reports: number;
  /** reports rejected by re-simulation */
  rejected: number;
}

export function freshState(): GlobalPoolState {
  return { version: 1, pool: defaultPool(), candidates: [], seen: [], reports: 0, rejected: 0 };
}

/** Load-time validation of the stored state (corrupt parts fall back to defaults). */
export function sanitizeState(raw: unknown): GlobalPoolState {
  const s = freshState();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Partial<GlobalPoolState>;
  if (r.version !== 1) return s;
  s.pool = sanitizePool(r.pool);
  if (Array.isArray(r.candidates)) {
    for (const c of r.candidates.slice(0, MAX_CANDIDATES)) {
      if (!c || typeof c !== 'object' || !Array.isArray(c.reporters)) continue;
      if (!validEntryDesign(c.design)) continue;
      const d = { id: c.design.id, name: c.design.name, chassis: c.design.chassis, mobility: c.design.mobility, mounts: [...c.design.mounts] };
      s.candidates.push({ design: d, key: poolKey(d), reporters: c.reporters.filter((x) => typeof x === 'string').slice(0, 50), effSum: Number(c.effSum) || 0, n: Math.max(0, Number(c.n) || 0), lastSeen: Number(c.lastSeen) || 0 });
    }
  }
  if (Array.isArray(r.seen)) s.seen = r.seen.filter((x) => typeof x === 'string').slice(-MAX_SEEN);
  s.reports = Number.isInteger(r.reports) ? r.reports! : 0;
  s.rejected = Number.isInteger(r.rejected) ? r.rejected! : 0;
  return s;
}

// ---------------------------------------------------------------------------------------------
// Report validation (synchronous, cheap)

const bad = (msg: string): never => { throw new HttpError(400, msg); };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function readPlacement(raw: unknown, deck: Map<string, Design>, round: number): Placement {
  if (!isObj(raw)) return bad('Bad placement');
  const o = raw as Record<string, unknown>;
  if (!isInt(o.uid) || o.uid < 1 || o.uid > 100_000) bad('Bad placement uid');
  if (typeof o.designId !== 'string' || !deck.has(o.designId)) bad('Placement of an unknown design');
  if (!isInt(o.x) || !isInt(o.y)) bad('Bad placement position');
  if (!isInt(o.level) || o.level < 1 || o.level > MAX_LEVEL) bad('Bad placement level');
  if (!isInt(o.round) || o.round < 1 || o.round > round) bad('Bad placement round');
  const p: Placement = { uid: o.uid as number, designId: o.designId as string, x: o.x as number, y: o.y as number, level: o.level as number, round: o.round as number };
  if (o.spacing !== undefined) { if (!isInt(o.spacing) || o.spacing < 0 || o.spacing > MAX_SPACING) bad('Bad spacing'); p.spacing = o.spacing as number; }
  if (o.rot !== undefined) { if (typeof o.rot !== 'boolean') bad('Bad rotation'); if (o.rot) p.rot = true; }
  // battle orders are copied when well-typed, anything else is dropped
  if (TARGET_PRIORITIES.includes(o.target as never)) p.target = o.target as Placement['target'];
  if (STANCES.includes(o.stance as never)) p.stance = o.stance as Placement['stance'];
  for (const k of ['hold', 'kite', 'focus', 'retreat'] as const) if (typeof o[k] === 'boolean') p[k] = o[k] as boolean;
  if (o.delay === 0 || o.delay === 3 || o.delay === 6) p.delay = o.delay;
  if (isInt(o.kiteMount) && o.kiteMount >= 0 && o.kiteMount < 12) p.kiteMount = o.kiteMount;
  if (isInt(o.escort) && o.escort >= 1) p.escort = o.escort;
  const d = deck.get(p.designId)!;
  if (!blockInZone(p.x, p.y, shapeOf(d), p.spacing, !!p.rot)) bad('Placement outside the deploy zone');
  return p;
}

/** Rebuild a reported vs-AI match from known fields only, or throw HttpError(400). The AI is side 1. */
export function validateReport(raw: unknown): MatchState {
  if (!isObj(raw) || !isObj(raw.match)) bad('Report needs a match');
  const r = (raw as { match: Record<string, unknown> }).match;
  if (typeof r.id !== 'string' || r.id.length < 4 || r.id.length > 80 || !/^[\w.-]+$/.test(r.id)) bad('Bad match id');
  if (r.mode !== 'ai') bad('Only vs-AI matches can be reported');
  if (r.status !== 'done') bad('Only finished matches can be reported');
  if (!isInt(r.seed) || r.seed < 0 || r.seed > 0xffffffff) bad('Bad seed');
  if (!Array.isArray(r.players) || r.players.length !== 2) bad('Bad players');
  if (!Array.isArray(r.history) || r.history.length < 1 || r.history.length > MAX_ROUNDS) bad('Bad round history');
  if (r.winner !== 0 && r.winner !== 1 && r.winner !== -1) bad('Bad winner');
  const players = (r.players as unknown[]).map((p, i): PlayerState => {
    if (!isObj(p)) return bad('Bad player');
    const deck = sanitizeDeck(p.deck);
    if (validateDeck(deck).length) bad(`Invalid deck for side ${i}`);
    if (deck.length > DECK_SIZE) bad('Deck too large');
    const ps: PlayerState = { name: typeof p.name === 'string' ? p.name.slice(0, 24) : '?', deck, hp: START_HP, supply: 0, board: [], nextUid: 1, ready: false };
    if (i === 1) ps.isAI = true;
    return ps;
  });
  const p1 = (r.players as unknown[])[1];
  if (!isObj(p1) || p1.isAI !== true) bad('Side 1 must be the AI');
  const m: MatchState = {
    id: r.id as string, mode: 'ai', status: 'done', round: (r.history as unknown[]).length, seed: r.seed as number,
    players: [players[0], players[1]], history: [], createdAt: 0, updatedAt: 0, winner: r.winner as Side | -1,
  };
  // only matches played under the current rules re-simulate the same (prices, squads, sim)
  if (r.rules !== RULES_VERSION) bad('Match was played under other rules');
  m.rules = RULES_VERSION;
  const decks = players.map((p) => new Map(p.deck.map((d) => [d.id, d] as const)));
  (r.history as unknown[]).forEach((rawRec, i) => {
    if (!isObj(rawRec)) return bad('Bad round record');
    const round = i + 1;
    if (rawRec.round !== round) bad('Rounds out of order');
    if (rawRec.seed !== mixSeed(m.seed, round)) bad('Bad round seed');
    if (!Array.isArray(rawRec.boards) || rawRec.boards.length !== 2) bad('Bad boards');
    const boards = (rawRec.boards as unknown[]).map((b, s) => {
      if (!Array.isArray(b) || b.length > MAX_BLOCKS) bad('Bad board');
      const pl = (b as unknown[]).map((x) => readPlacement(x, decks[s], round));
      if (new Set(pl.map((p) => p.uid)).size !== pl.length) bad('Duplicate unit ids');
      let units = 0, value = 0;
      for (const p of pl) { const d = decks[s].get(p.designId)!; units += shapeOf(d).squad; value += placementValue(d, p.level); }
      if (units > MAX_SIM_UNITS) bad('Too many units');
      if (value > totalSupplyThrough(round)) bad('Board worth more supply than the rules grant');
      return pl;
    }) as [Placement[], Placement[]];
    const res = isObj(rawRec.result) ? rawRec.result : bad('Bad round result');
    const winner = (res as Record<string, unknown>).winner;
    const damage = (res as Record<string, unknown>).damage;
    if (winner !== 0 && winner !== 1 && winner !== -1) bad('Bad round winner');
    if (!Array.isArray(damage) || damage.length !== 2 || !damage.every((x) => isInt(x) && x >= 0 && x <= 1000)) bad('Bad round damage');
    const rec: RoundRecord = { round, seed: rawRec.seed as number, boards, result: { winner: winner as Side | -1, survivors: [[], []], damage: damage as [number, number], ticks: 0 } };
    m.history.push(rec);
  });
  // hp follows from the recorded damage; the match ends when someone hits 0 or at MAX_ROUNDS
  const hp: [number, number] = [START_HP, START_HP];
  m.history.forEach((rec, i) => {
    if (hp[0] <= 0 || hp[1] <= 0) bad('Rounds after the match ended');
    hp[0] = Math.max(0, hp[0] - rec.result.damage[0]);
    hp[1] = Math.max(0, hp[1] - rec.result.damage[1]);
    void i;
  });
  if (hp[0] > 0 && hp[1] > 0 && m.history.length < MAX_ROUNDS) bad('The match has not ended');
  const winner: Side | -1 = hp[0] > hp[1] ? 0 : hp[1] > hp[0] ? 1 : -1;
  if (winner !== m.winner) bad('Winner does not match the rounds');
  m.players[0].hp = hp[0];
  m.players[1].hp = hp[1];
  return m;
}

// ---------------------------------------------------------------------------------------------
// The service

interface Job { match: MatchState; reporter: string; resolve?: () => void }

export class GlobalAiPool {
  state: GlobalPoolState;
  private readonly save: () => void;
  private readonly queue: Job[] = [];
  private seenSet: Set<string>;
  private running = false;
  private idle: (() => void)[] = [];

  constructor(state: GlobalPoolState, save: () => void) {
    this.state = state;
    this.save = save;
    this.seenSet = new Set(state.seen);
  }

  /** The current pool (always valid). */
  pool(): AiPool { return this.state.pool; }

  pending(): number { return this.queue.length + (this.running ? 1 : 0); }

  /** Queue a validated report. Throws 409 for a match id already reported, 503 when the queue is full. */
  submit(match: MatchState, reporter: string): { queued: number } {
    if (this.seenSet.has(match.id) || this.queue.some((j) => j.match.id === match.id)) throw new HttpError(409, 'This match was already reported');
    if (this.queue.length >= MAX_QUEUE) throw new HttpError(503, 'Busy: try again later');
    this.queue.push({ match, reporter });
    this.remember(match.id);
    if (!this.running) this.kick();
    return { queued: this.queue.length };
  }

  /** Resolves when the queue is empty (tests, shutdown). */
  drain(): Promise<void> {
    if (!this.running && !this.queue.length) return Promise.resolve();
    return new Promise((res) => this.idle.push(res));
  }

  private remember(id: string): void {
    this.seenSet.add(id);
    this.state.seen.push(id);
    if (this.state.seen.length > MAX_SEEN) this.seenSet.delete(this.state.seen.shift()!);
    this.save();
  }

  private kick(): void {
    const job = this.queue.shift();
    if (!job) {
      this.running = false;
      for (const f of this.idle.splice(0)) f();
      return;
    }
    this.running = true;
    const rounds: RoundTally[] = [];
    let i = 0;
    const step = () => {
      try {
        if (i < job.match.history.length) {
          const rec = job.match.history[i++];
          // re-simulate the round: its result must be what the reporter claimed (else the report is a fake)
          const { tally, summary } = simRound(job.match, rec);
          const dmg = roundDamage(job.match, rec.round, summary.winner, summary.survivors, rec.boards, summary.aliveFraction);
          if (summary.winner !== rec.result.winner || dmg[0] !== rec.result.damage[0] || dmg[1] !== rec.result.damage[1]) {
            this.state.rejected++;
            this.save();
            setImmediate(() => this.kick());
            return;
          }
          rounds.push(tally);
          setImmediate(step);
          return;
        }
        this.apply(job, rounds);
      } catch (e) {
        console.error('[aipool] report failed', e);
      }
      setImmediate(() => this.kick());
    };
    setImmediate(step);
  }

  /** Fold one re-scored report into the global pool. */
  private apply(job: Job, rounds: RoundTally[]): void {
    const m = job.match;
    const scores = combinePerf(rounds);
    const entries: PoolEntry[] = this.state.pool.entries;
    updateAiScores(entries, m, 1, scores, GLOBAL_ALPHA);
    const now = Date.now();
    for (const c of playerCandidates(entries, m, 1, scores)) {
      // already pooled (exactly or as a near-duplicate): just a score update
      const known = findByKey(entries, c.design) ?? findBySlot(entries, c.design);
      if (known) { blendScore(known, c.eff, GLOBAL_ALPHA); continue; }
      const key = poolKey(c.design);
      let cand = this.state.candidates.find((x) => x.key === key);
      if (!cand) {
        cand = { design: c.design, key, reporters: [], effSum: 0, n: 0, lastSeen: now };
        this.state.candidates.push(cand);
      }
      cand.effSum += c.eff; cand.n++; cand.lastSeen = now;
      if (!cand.reporters.includes(job.reporter)) cand.reporters.push(job.reporter);
      if (cand.reporters.length >= ADOPT_REPORTERS) {
        const eff = cand.effSum / cand.n;
        insertEntry(entries, { design: cand.design, score: Math.max(0.5, Math.min(3, eff)), games: cand.n, learned: true }, eff);
        this.state.candidates.splice(this.state.candidates.indexOf(cand), 1);
      }
    }
    if (this.state.candidates.length > MAX_CANDIDATES) {
      this.state.candidates.sort((a, b) => b.lastSeen - a.lastSeen);
      this.state.candidates.length = MAX_CANDIDATES;
    }
    mutateWeak(entries, m, 1, scores, hash(m.id));
    pruneWeakest(entries);
    this.state.pool = sanitizePool({ ...this.state.pool, entries, matches: this.state.pool.matches + 1 });
    this.state.reports++;
    this.save();
  }
}
