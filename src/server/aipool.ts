// The global AI design pool (shared/aipool.ts), kept by the server and fed by vs-AI match reports.
//
// Flow: POST /api/aipool/report -> validateReport (cheap, synchronous: shape, size, decks, rules) -> queue. A
// background worker re-simulates the reported rounds one per macrotask (never trusting client scores; a round whose
// re-simulated result differs from the reported one rejects the report), then folds the match into the two-tier pool
// (shared/aipool.ts foldMatch):
//  - the AI's fielded designs update their running scores (GLOBAL_ALPHA) and collect good / bad verdicts per match;
//  - candidates with enough good games graduate to the tested tier; any design with 2 bad games is kicked out (a
//    tested design that a role floor protects is demoted instead);
//  - the player's designs that did well go on trial in the candidate tier after ONE re-simulated report (at most
//    CANDIDATES_PER_REPORTER_DAY per reporter per day), and the AI's clearly ineffective designs spawn a mutant.
// Every change is logged (events, and a history of the designs that left) for GET /api/aipool/log and the /aipool page.
// Anti-abuse: per-reporter rate limit (api.ts), dedupe by match id, a capped queue, a capped candidate tier, a daily
// per-reporter cap on new candidates, re-simulation of every round.

import { DECK_SIZE, MAX_BLOCKS, MAX_ROUNDS, RULES_VERSION, MAX_SIM_UNITS, START_HP, placementValue, roundDamage, shapeOf, totalSupplyThrough, validateDeck } from '../shared/match.ts';
import {
  combinePerf, defaultPool, designTags, foldMatch, hash, poolKey, roleOf, sanitizeEntry, sanitizePool, simRound, validEntryDesign,
  MAX_CANDIDATES, type AiPool, type PoolEntry, type PoolEvent, type RoundTally,
} from '../shared/aipool.ts';
import { blockInZone, MAX_SPACING } from '../shared/grid.ts';
import { mixSeed } from '../shared/rng.ts';
import { MAX_LEVEL } from '../shared/stats.ts';
import { STANCES, TARGET_PRIORITIES } from '../shared/types.ts';
import type { Design, MatchState, Placement, PlayerState, RoundRecord, Side } from '../shared/types.ts';
import { HttpError, sanitizeDeck } from './validate.ts';

/** new candidates one reporter may put on trial per UTC day */
export const CANDIDATES_PER_REPORTER_DAY = 3;
/** reported match ids remembered for dedupe */
export const MAX_SEEN = 20_000;
/** reports waiting for re-simulation; beyond this the server answers 503 */
export const MAX_QUEUE = 30;
/** weight of one report in an AI design's running score (the pool sees many reports) */
export const GLOBAL_ALPHA = 0.1;
/** body limit of a report (a full 15-round match with both boards per round) */
export const REPORT_BODY_LIMIT = 1024 * 1024;
/** events kept in the log, and designs kept in the history of those that left the pool */
export const MAX_EVENTS = 1000;
export const MAX_GONE = 200;

export interface LoggedEvent extends PoolEvent { t: number }
export interface GoneEntry { entry: PoolEntry; t: number; kind: PoolEvent['kind']; tier: PoolEvent['tier']; detail?: string }

export interface GlobalPoolState {
  version: 2;
  pool: AiPool;
  /** reported match ids (dedupe), oldest first */
  seen: string[];
  reports: number;
  /** reports rejected by re-simulation */
  rejected: number;
  /** new candidates per reporter key (hashed) on day `day` (days since epoch, UTC) */
  adds: Record<string, { day: number; n: number }>;
  /** what happened, oldest first (capped) */
  events: LoggedEvent[];
  /** designs that left the pool (kicked, pruned, replaced, dropped), oldest first (capped) */
  gone: GoneEntry[];
}

export function freshState(): GlobalPoolState {
  return { version: 2, pool: defaultPool(), seen: [], reports: 0, rejected: 0, adds: {}, events: [], gone: [] };
}

const EVENT_KINDS = new Set<PoolEvent['kind']>(['joined', 'promoted', 'demoted', 'kicked', 'mutated', 'pruned', 'replaced', 'dropped']);
function cleanEvent(x: unknown): LoggedEvent | null {
  if (!x || typeof x !== 'object') return null;
  const e = x as Partial<LoggedEvent>;
  if (!EVENT_KINDS.has(e.kind!) || typeof e.key !== 'string' || typeof e.name !== 'string' || typeof e.t !== 'number' || (e.tier !== 'tested' && e.tier !== 'candidate')) return null;
  const out: LoggedEvent = { kind: e.kind!, key: e.key.slice(0, 200), name: e.name.slice(0, 40), tier: e.tier, t: e.t };
  if (typeof e.detail === 'string') out.detail = e.detail.slice(0, 120);
  return out;
}

/** Load-time validation of the stored state (corrupt parts fall back to defaults). Version 1 (one tier plus a
 *  distinct-reporter candidate list) migrates: the pool becomes the tested tier, the old candidates the candidate
 *  tier (best-evidenced first, at most MAX_CANDIDATES). */
export function sanitizeState(raw: unknown): GlobalPoolState {
  const s = freshState();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 && r.version !== 2) return s;
  s.pool = sanitizePool(r.pool);
  if (r.version === 1 && Array.isArray(r.candidates)) {
    const keys = new Set([...s.pool.entries, ...s.pool.candidates].map((e) => poolKey(e.design)));
    const old = (r.candidates as Record<string, unknown>[])
      .filter((c) => c && typeof c === 'object' && validEntryDesign(c.design))
      .sort((a, b) => (Number(b.n) || 0) - (Number(a.n) || 0) || (Number(b.lastSeen) || 0) - (Number(a.lastSeen) || 0));
    const cands = old.map((c) => {
      const d = c.design as Design;
      const n = Math.max(1, Number(c.n) || 1);
      return { design: { id: d.id, name: d.name, chassis: d.chassis, mobility: d.mobility, mounts: [...d.mounts] }, score: Math.max(0.5, Math.min(3, (Number(c.effSum) || n) / n)), games: 0, learned: true, origin: 'adopted' as const, creator: 'unknown', addedAt: Number(c.lastSeen) || 0 };
    }).filter((e) => !keys.has(poolKey(e.design)));
    s.pool = sanitizePool({ ...s.pool, candidates: cands.slice(0, MAX_CANDIDATES) });
  }
  if (Array.isArray(r.seen)) s.seen = (r.seen as unknown[]).filter((x): x is string => typeof x === 'string').slice(-MAX_SEEN);
  s.reports = Number.isInteger(r.reports) ? r.reports as number : 0;
  s.rejected = Number.isInteger(r.rejected) ? r.rejected as number : 0;
  if (r.adds && typeof r.adds === 'object') {
    for (const [k, v] of Object.entries(r.adds as Record<string, { day?: unknown; n?: unknown }>)) {
      if (v && Number.isInteger(v.day) && Number.isInteger(v.n)) s.adds[k] = { day: v.day as number, n: v.n as number };
    }
  }
  if (Array.isArray(r.events)) s.events = (r.events as unknown[]).map(cleanEvent).filter((e): e is LoggedEvent => !!e).slice(-MAX_EVENTS);
  if (Array.isArray(r.gone)) {
    for (const g of (r.gone as Record<string, unknown>[]).slice(-MAX_GONE)) {
      const ev = g && cleanEvent({ ...g, key: 'x', name: 'x' });
      const one = g && sanitizeEntry(g.entry);
      if (ev && one) s.gone.push({ entry: one, t: ev.t, kind: ev.kind, tier: ev.tier, ...(ev.detail ? { detail: ev.detail } : {}) });
    }
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// The public log (GET /api/aipool/log): everything about the designs, nothing about the reporters

export interface PoolRow {
  key: string;
  name: string;
  chassis: string;
  mobility: string;
  mounts: (string | null)[];
  role: string;
  tags: string[];
  tier: 'tested' | 'candidate' | 'gone';
  origin: 'curated' | 'adopted' | 'mutant';
  creator?: string;
  parent?: string;
  addedAt?: number;
  promotedAt?: number;
  games: number;
  good: number;
  bad: number;
  score: number;
  /** gone: when and why it left */
  leftAt?: number;
  leftWhy?: string;
}

function row(e: PoolEntry, tier: PoolRow['tier']): PoolRow {
  const r: PoolRow = {
    key: poolKey(e.design), name: e.design.name, chassis: e.design.chassis, mobility: e.design.mobility, mounts: [...e.design.mounts],
    role: roleOf(e.design), tags: [...designTags(e.design)], tier, origin: e.origin ?? 'curated',
    games: e.games, good: (e.rec ?? []).filter((v) => v.good).length, bad: (e.rec ?? []).filter((v) => !v.good).length, score: Math.round(e.score * 1000) / 1000,
  };
  if (e.creator) r.creator = e.creator;
  if (e.parent) r.parent = e.parent;
  if (e.addedAt) r.addedAt = e.addedAt;
  if (e.promotedAt) r.promotedAt = e.promotedAt;
  return r;
}

export function poolLog(s: GlobalPoolState): { tested: PoolRow[]; candidates: PoolRow[]; gone: PoolRow[]; events: LoggedEvent[]; reports: number; rejected: number; matches: number } {
  return {
    tested: s.pool.entries.map((e) => row(e, 'tested')),
    candidates: s.pool.candidates.map((e) => row(e, 'candidate')),
    gone: [...s.gone].reverse().map((g) => ({ ...row(g.entry, 'gone'), leftAt: g.t, leftWhy: `${g.kind}${g.detail ? `: ${g.detail}` : ''}` })),
    events: [...s.events].reverse().slice(0, 300),
    reports: s.reports, rejected: s.rejected, matches: s.pool.matches,
  };
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

interface Job { match: MatchState; reporter: string; creator: string }

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

  /** Queue a validated report (`reporter`: hashed key for the caps; `creator`: the display name credited for adopted
   *  designs). Throws 409 for a match id already reported, 503 when the queue is full. */
  submit(match: MatchState, reporter: string, creator = 'guest'): { queued: number } {
    if (this.seenSet.has(match.id) || this.queue.some((j) => j.match.id === match.id)) throw new HttpError(409, 'This match was already reported');
    if (this.queue.length >= MAX_QUEUE) throw new HttpError(503, 'Busy: try again later');
    this.queue.push({ match, reporter, creator });
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
    const now = Date.now();
    const day = Math.floor(now / 86_400_000);
    const pool = structuredClone(this.state.pool);
    // the pool before, to snapshot what leaves
    const before = new Map([...pool.entries, ...pool.candidates].map((e) => [poolKey(e.design), structuredClone(e)] as const));
    const res = foldMatch(pool, m, 1, combinePerf(rounds), {
      matchId: m.id, alpha: GLOBAL_ALPHA, now, seed: hash(m.id), creator: job.creator,
      mayAddCandidate: () => {
        const a = this.state.adds[job.reporter];
        const cur = a && a.day === day ? a : { day, n: 0 };
        if (cur.n >= CANDIDATES_PER_REPORTER_DAY) return false;
        this.state.adds[job.reporter] = { day, n: cur.n + 1 };
        return true;
      },
    });
    for (const e of res.events) {
      this.state.events.push({ ...e, t: now });
      if (e.kind === 'kicked' || e.kind === 'pruned' || e.kind === 'replaced' || e.kind === 'dropped') {
        const was = before.get(e.key) ?? [...pool.entries, ...pool.candidates].find((x) => poolKey(x.design) === e.key);
        if (was) this.state.gone.push({ entry: was, t: now, kind: e.kind, tier: e.tier, ...(e.detail ? { detail: e.detail } : {}) });
      }
    }
    if (this.state.events.length > MAX_EVENTS) this.state.events.splice(0, this.state.events.length - MAX_EVENTS);
    if (this.state.gone.length > MAX_GONE) this.state.gone.splice(0, this.state.gone.length - MAX_GONE);
    for (const [k, v] of Object.entries(this.state.adds)) if (v.day < day) delete this.state.adds[k];
    this.state.pool = sanitizePool(pool);
    this.state.reports++;
    this.save();
  }
}
