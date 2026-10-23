// JSON API: auth, lobby and async PvP match flow. The server is authoritative: it validates every
// deployment with the shared rules and resolves rounds itself once both players are ready.

import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  START_HP, applyDeploy, joinMatch, newMatch, newPlayer, redactFor, resolveRound, validateDeploy,
} from '../shared/match.ts';
import type { MatchState, Side } from '../shared/types.ts';
import { RateLimiter } from './ratelimit.ts';
import { hashToken, type MatchRecord, type PlayerRecord, type Store } from './store.ts';
import { HttpError, sanitizeAction, sanitizeDeck, sanitizeGarage, sanitizeName } from './validate.ts';

export const BODY_LIMIT = 256 * 1024; // a full garage upload (up to MAX_GARAGE designs) is the largest body
export const MAX_ACTIVE_MATCHES = 20;
const DAY = 24 * 3600 * 1000;
export const STALE_TURN_MS = 7 * DAY;
export const STALE_WAITING_MS = 14 * DAY;
const RESOLVE_RETRY_MS = 60 * 1000;
/** cap on a long-poll GET (?since=…&wait=ms); kept under the server's 30 s requestTimeout */
export const MAX_WAIT_MS = 20_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Mirrors MatchSummary in src/client/net.ts. */
export interface MatchSummary {
  id: string;
  status: MatchState['status'];
  round: number;
  names: [string, string | null];
  hp: [number, number];
  side?: Side;
  yourTurn?: boolean;
  /** opponent has submitted this round (only for 'mine') */
  opponentReady?: boolean;
  updatedAt: number;
  createdAt: number;
  private?: boolean;
  /** join code — only shown to the creator */
  code?: string;
  winner?: Side | -1;
  forfeitBy?: Side;
}

interface Ctx {
  req: IncomingMessage;
  method: string;
  parts: string[];
  query: URLSearchParams;
  ip: string;
  body: unknown;
}

export interface ApiOptions {
  /** requests per minute per token/IP (default 240) */
  rateLimit?: number;
  /** logins per minute per IP (default 20) */
  loginRateLimit?: number;
  trustProxy?: boolean;
}

export class Api {
  readonly store: Store;
  private readonly limiter: RateLimiter;
  private readonly loginLimiter: RateLimiter;
  private readonly trustProxy: boolean;
  /** long-poll waiters per match id, woken whenever that match changes */
  private readonly waiters = new Map<string, Set<() => void>>();

  constructor(store: Store, opts: ApiOptions = {}) {
    this.store = store;
    const rpm = opts.rateLimit ?? 240;
    const lpm = opts.loginRateLimit ?? 20;
    this.limiter = new RateLimiter(Math.max(10, rpm / 4), rpm / 60);
    this.loginLimiter = new RateLimiter(Math.max(3, lpm / 2), lpm / 60);
    this.trustProxy = !!opts.trustProxy;
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const ip = this.clientIp(req);
    try {
      const method = req.method ?? 'GET';
      const auth = bearer(req);
      const th = auth ? hashToken(auth) : null;
      // only KNOWN tokens get their own bucket: random well-formed tokens would otherwise each get a fresh one
      // (unlimited requests, unbounded bucket map)
      if (!this.limiter.take(th && this.store.playersByToken.has(th) ? `t:${th.slice(0, 16)}` : `ip:${ip}`)) {
        throw new HttpError(429, 'Too many requests — slow down');
      }
      let body: unknown = undefined;
      if (method === 'POST') body = await readJson(req);
      else if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      const ctx: Ctx = { req, method, parts: url.pathname.split('/').filter(Boolean).slice(1), query: url.searchParams, ip, body };
      const out = await this.route(ctx);
      if (!res.destroyed) send(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError) {
        send(res, e.status, { error: e.message }, e.status === 429 ? { 'Retry-After': '5' } : undefined);
      } else {
        console.error('[api] internal error', req.method, url.pathname, e);
        send(res, 500, { error: 'Internal server error' });
      }
    }
  }

  private route(c: Ctx): unknown | Promise<unknown> {
    const [a, b, d] = c.parts;
    const M = c.method === 'HEAD' ? 'GET' : c.method;
    if (a === 'health' && !b && M === 'GET') return { ok: true };
    if (a === 'login' && !b && M === 'POST') return this.login(c);
    if (a === 'me' && !b && M === 'GET') return this.me(c);
    if (a === 'garage' && !b) {
      if (M === 'GET') return this.getGarage(c);
      if (M === 'POST') return this.putGarage(c);
    }
    if (a === 'matches') {
      if (!b) {
        if (M === 'GET') return this.list(c);
        if (M === 'POST') return this.create(c);
      } else if (b === 'quick' && !d && M === 'POST') {
        return this.quick(c);
      } else if (c.parts.length <= 3) {
        if (!d && M === 'GET') return this.get(c, b);
        if (d === 'join' && M === 'POST') return this.join(c, b);
        if (d === 'deploy' && M === 'POST') return this.deploy(c, b);
        if (d === 'forfeit' && M === 'POST') return this.forfeit(c, b);
      }
    }
    throw new HttpError(404, 'Not found');
  }

  // ---------------------------------------------------------------- auth

  private login(c: Ctx) {
    const body = obj(c.body);
    const existing = typeof body.token === 'string' ? this.store.playersByToken.get(hashToken(body.token)) : undefined;
    if (existing) {
      if (body.name != null && body.name !== existing.name) existing.name = sanitizeName(body.name);
      existing.lastSeen = Date.now();
      this.store.save();
      return { playerId: existing.id, name: existing.name, token: body.token as string };
    }
    if (!this.loginLimiter.take(`ip:${c.ip}`)) throw new HttpError(429, 'Too many logins — try again shortly');
    const name = sanitizeName(body.name);
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const p: PlayerRecord = { id: 'p_' + crypto.randomBytes(8).toString('hex'), name, tokenHash: hashToken(token), createdAt: now, lastSeen: now };
    this.store.addPlayer(p);
    return { playerId: p.id, name: p.name, token };
  }

  private auth(c: Ctx): PlayerRecord {
    const t = bearer(c.req);
    if (!t) throw new HttpError(401, 'Login required');
    const p = this.store.playersByToken.get(hashToken(t));
    if (!p) throw new HttpError(401, 'Session expired — please log in again');
    const now = Date.now();
    if (now - p.lastSeen > 60_000) { p.lastSeen = now; this.store.save(); }
    return p;
  }

  private me(c: Ctx) {
    const p = this.auth(c);
    const active = this.activeCount(p.id);
    return { playerId: p.id, name: p.name, activeMatches: active, maxActiveMatches: MAX_ACTIVE_MATCHES };
  }

  // ---------------------------------------------------------------- garage (designs + deck, kept in players.json)

  private getGarage(c: Ctx) {
    const p = this.auth(c);
    return { garage: p.garage ?? null };
  }

  /** Replace the stored garage. `baseRev` is the rev the client last synced; if another session wrote since,
   *  nothing is stored and the server copy comes back as `conflict` for the client to merge and resend. */
  private putGarage(c: Ctx) {
    const p = this.auth(c);
    const body = obj(c.body);
    const baseRev = typeof body.baseRev === 'number' && Number.isInteger(body.baseRev) ? body.baseRev : 0;
    if (p.garage && p.garage.rev !== baseRev) return { ok: false, conflict: p.garage };
    const { designs, deck } = sanitizeGarage(body);
    p.garage = { designs, deck, rev: (p.garage?.rev ?? 0) + 1, updatedAt: Date.now() };
    this.store.save();
    return { ok: true, rev: p.garage.rev, kept: designs.length };
  }

  // ---------------------------------------------------------------- lobby

  private list(c: Ctx) {
    const p = this.auth(c);
    this.sweepStale();
    const mine: MatchSummary[] = [];
    const open: MatchSummary[] = [];
    for (const r of this.store.matches.values()) {
      const side = sideOf(r, p.id);
      if (side != null) mine.push(summarize(r, side));
      else if (r.match.status === 'waiting' && !r.private) open.push(summarize(r));
    }
    const rank = (s: MatchSummary) => (s.yourTurn ? 0 : s.status === 'deploy' ? 1 : s.status === 'waiting' ? 2 : 3);
    mine.sort((x, y) => rank(x) - rank(y) || y.updatedAt - x.updatedAt);
    // keep every active match, but only the 20 most recent finished ones
    let done = 0;
    const mineTrim = mine.filter((s) => s.status !== 'done' || ++done <= 20);
    open.sort((x, y) => x.createdAt - y.createdAt);
    return { mine: mineTrim, open: open.slice(0, 50) };
  }

  private create(c: Ctx) {
    const p = this.auth(c);
    const body = obj(c.body);
    const deck = sanitizeDeck(body.deck);
    this.checkCap(p.id);
    const r = this.newRecord(p, deck, body.private === true);
    return { id: r.match.id, code: r.code, side: 0, match: redactFor(r.match, 0) };
  }

  private quick(c: Ctx) {
    const p = this.auth(c);
    const deck = sanitizeDeck(obj(c.body).deck);
    this.checkCap(p.id);
    let best: MatchRecord | null = null;
    for (const r of this.store.matches.values()) {
      if (r.match.status !== 'waiting' || r.private || r.owners[0] === p.id) continue;
      if (!best || r.match.createdAt < best.match.createdAt) best = r;
    }
    if (best) {
      this.doJoin(best, p, deck);
      return { id: best.match.id, joined: true, side: 1, match: redactFor(best.match, 1) };
    }
    const r = this.newRecord(p, deck, false);
    return { id: r.match.id, joined: false, side: 0, match: redactFor(r.match, 0) };
  }

  private join(c: Ctx, idOrCode: string) {
    const p = this.auth(c);
    const deck = sanitizeDeck(obj(c.body).deck);
    const r = this.findMatch(idOrCode);
    if (!r) throw new HttpError(404, 'No such match or join code');
    if (r.owners[0] === p.id || r.owners[1] === p.id) {
      if (r.match.status === 'waiting') throw new HttpError(400, "You can't join your own match");
      return { id: r.match.id, side: sideOf(r, p.id), match: redactFor(r.match, sideOf(r, p.id)!) };
    }
    if (r.match.status !== 'waiting') throw new HttpError(409, 'That match already has two players');
    this.checkCap(p.id);
    this.doJoin(r, p, deck);
    return { id: r.match.id, side: 1, match: redactFor(r.match, 1) };
  }

  // ---------------------------------------------------------------- match

  private get(c: Ctx, idOrCode: string, noWait = false): unknown {
    const p = this.auth(c);
    const r = this.findMatch(idOrCode);
    if (!r) throw new HttpError(404, 'No such match');
    const side = sideOf(r, p.id);
    if (side == null) {
      // non-participants may only peek at joinable lobbies
      if (r.match.status === 'waiting' && (!r.private || r.code === idOrCode.toUpperCase())) return { summary: summarize(r) };
      throw new HttpError(404, 'No such match');
    }
    this.maybeRetryResolve(r);
    const since = Number(c.query.get('since'));
    // updatedAt is monotonic, so a client copy NEWER than ours means this server lost writes (crash inside the save
    // debounce): answer with the full state instead of holding "unchanged" forever against a phantom version
    if (c.query.has('since') && Number.isFinite(since) && r.match.updatedAt === since) {
      // long poll: hold the request until the match changes (opponent joined/ready, round resolved) or the wait ends
      const wait = noWait ? 0 : Math.min(MAX_WAIT_MS, Math.max(0, Number(c.query.get('wait')) || 0));
      if (wait > 0) return this.waitForChange(c, r.match.id, wait).then(() => this.get(c, idOrCode, true));
      return { unchanged: true };
    }
    return { side, match: redactFor(r.match, side), summary: summarize(r, side) };
  }

  private waitForChange(c: Ctx, id: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      let set = this.waiters.get(id);
      if (!set) this.waiters.set(id, (set = new Set()));
      const done = () => {
        clearTimeout(timer);
        c.req.off('close', done);
        set!.delete(done);
        if (!set!.size && this.waiters.get(id) === set) this.waiters.delete(id);
        resolve();
      };
      const timer = setTimeout(done, ms);
      c.req.once('close', done);
      set.add(done);
    });
  }

  /** Wake every long poll waiting on this match. */
  private wake(id: string): void {
    const set = this.waiters.get(id);
    if (set) for (const fn of [...set]) fn();
  }

  private deploy(c: Ctx, id: string) {
    const p = this.auth(c);
    const r = this.store.matches.get(id);
    const side = r ? sideOf(r, p.id) : null;
    if (!r || side == null) throw new HttpError(404, 'No such match');
    const m = r.match;
    if (m.status !== 'deploy') throw new HttpError(409, m.status === 'waiting' ? 'Waiting for an opponent to join' : 'Match is over');
    if (m.players[side].ready) throw new HttpError(409, 'Already submitted this round');
    const action = sanitizeAction(obj(c.body).action);
    let err: string | null;
    try { err = validateDeploy(m, side, action); } catch (e) {
      console.error('[api] validateDeploy threw', e);
      err = 'Invalid deployment';
    }
    if (err) throw new HttpError(400, err);
    const snapshot = structuredClone(m);
    try {
      applyDeploy(m, side, action);
    } catch (e) {
      console.error('[api] applyDeploy threw', e);
      r.match = snapshot;
      throw new HttpError(500, 'Could not apply deployment');
    }
    touch(m);
    if (m.players[0].ready && m.players[1].ready) this.tryResolve(r);
    this.store.save();
    this.wake(r.match.id);
    return { side, match: redactFor(r.match, side), summary: summarize(r, side) };
  }

  private forfeit(c: Ctx, id: string) {
    const p = this.auth(c);
    const r = this.store.matches.get(id);
    const side = r ? sideOf(r, p.id) : null;
    if (!r || side == null) throw new HttpError(404, 'No such match');
    if (r.match.status === 'done') throw new HttpError(409, 'Match is already over');
    if (r.match.status === 'waiting') {
      this.store.removeMatch(r);
      this.wake(r.match.id);
      return { ok: true, cancelled: true };
    }
    forfeitSide(r, side);
    this.store.save();
    this.wake(r.match.id);
    return { ok: true, side, match: redactFor(r.match, side), summary: summarize(r, side) };
  }

  // ---------------------------------------------------------------- helpers

  private newRecord(p: PlayerRecord, deck: ReturnType<typeof sanitizeDeck>, isPrivate: boolean): MatchRecord {
    const now = Date.now();
    let id: string;
    do id = 'm_' + crypto.randomBytes(6).toString('hex'); while (this.store.matches.has(id));
    const seed = crypto.randomInt(1, 2 ** 31 - 1);
    const m = newMatch(id, 'pvp', seed, newPlayer(p.name, deck), undefined, now);
    m.mode = 'pvp';
    m.status = 'waiting';
    let code: string | null = null;
    if (isPrivate) {
      do code = Array.from(crypto.randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
      while (this.store.matchesByCode.has(code));
    }
    const r: MatchRecord = { match: m, owners: [p.id, null], private: isPrivate, code };
    this.store.indexMatch(r);
    this.store.save();
    return r;
  }

  private doJoin(r: MatchRecord, p: PlayerRecord, deck: ReturnType<typeof sanitizeDeck>): void {
    const snapshot = structuredClone(r.match);
    try {
      joinMatch(r.match, newPlayer(p.name, deck), Date.now());
    } catch (e) {
      r.match = snapshot;
      console.error('[api] joinMatch threw', e);
      throw new HttpError(500, 'Could not join match');
    }
    r.owners[1] = p.id;
    touch(r.match);
    // a private match's code is spent once it's full
    if (r.code) this.store.matchesByCode.delete(r.code);
    this.store.save();
    this.wake(r.match.id);
  }

  /** Resolve the round; on a sim exception roll back and retry later instead of crashing. */
  private tryResolve(r: MatchRecord): void {
    const snapshot = structuredClone(r.match);
    try {
      resolveRound(r.match, Date.now());
      touch(r.match);
      delete r.resolveErrorAt;
    } catch (e) {
      console.error(`[api] resolveRound failed for ${r.match.id} round ${snapshot.round}`, e);
      r.match = snapshot;
      r.resolveErrorAt = Date.now();
    }
    this.store.save();
    this.wake(r.match.id);
  }

  private maybeRetryResolve(r: MatchRecord): void {
    const m = r.match;
    if (m.status !== 'deploy' || !m.players[0].ready || !m.players[1].ready) return;
    if (r.resolveErrorAt && Date.now() - r.resolveErrorAt < RESOLVE_RETRY_MS) return;
    this.tryResolve(r);
  }

  private findMatch(idOrCode: string): MatchRecord | undefined {
    return this.store.matches.get(idOrCode) ?? this.store.matchesByCode.get(idOrCode.toUpperCase());
  }

  private activeCount(pid: string): number {
    let n = 0;
    for (const r of this.store.matches.values()) {
      if (r.match.status !== 'done' && (r.owners[0] === pid || r.owners[1] === pid)) n++;
    }
    return n;
  }

  private checkCap(pid: string): void {
    if (this.activeCount(pid) >= MAX_ACTIVE_MATCHES) {
      throw new HttpError(409, `You already have ${MAX_ACTIVE_MATCHES} active matches — finish or forfeit some first`);
    }
  }

  /** Auto-forfeit turns idle for STALE_TURN_MS; drop lobbies nobody joined for STALE_WAITING_MS. */
  sweepStale(now = Date.now()): number {
    let changed = 0;
    for (const r of [...this.store.matches.values()]) {
      const m = r.match;
      if (m.status === 'waiting' && now - m.updatedAt > STALE_WAITING_MS) {
        this.store.removeMatch(r);
        this.wake(r.match.id);
        changed++;
      } else if (m.status === 'deploy' && now - m.updatedAt > STALE_TURN_MS) {
        const r0 = m.players[0].ready, r1 = m.players[1].ready;
        if (r0 && r1) { this.tryResolve(r); continue; }
        if (r0 !== r1) forfeitSide(r, r0 ? 1 : 0);
        else { m.status = 'done'; m.winner = -1; touch(m); }
        this.wake(m.id);
        changed++;
      }
    }
    if (changed) this.store.save();
    return changed;
  }

  private clientIp(req: IncomingMessage): string {
    if (this.trustProxy) {
      // The trusted proxy (one hop, e.g. Fly's edge) APPENDS the address it saw, so only the LAST entry is
      // trustworthy; anything to its left is whatever the client sent and would let it dodge the rate limits.
      const xff = req.headers['x-forwarded-for'];
      const last = (Array.isArray(xff) ? xff.join(',') : xff)?.split(',').map((s) => s.trim()).filter(Boolean).pop();
      if (last) return last;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  prune(): void {
    this.limiter.prune();
    this.loginLimiter.prune();
  }
}

// ------------------------------------------------------------------ pure helpers

function forfeitSide(r: MatchRecord, side: Side): void {
  const m = r.match;
  m.status = 'done';
  m.winner = (1 - side) as Side;
  m.players[side].hp = 0;
  r.forfeitBy = side;
  touch(m);
}

/** Monotonic updatedAt so ?since polling never misses a same-millisecond change. */
function touch(m: MatchState): void {
  m.updatedAt = Math.max(Date.now(), (m.updatedAt || 0) + 1);
}

function sideOf(r: MatchRecord, pid: string): Side | null {
  if (r.owners[0] === pid) return 0;
  if (r.owners[1] === pid) return 1;
  return null;
}

export function summarize(r: MatchRecord, side?: Side): MatchSummary {
  const m = r.match;
  const joined = r.owners[1] != null;
  const s: MatchSummary = {
    id: m.id,
    status: m.status,
    round: m.round,
    names: [m.players[0]?.name ?? '?', joined ? m.players[1]?.name ?? '?' : null],
    hp: [m.players[0]?.hp ?? START_HP, joined ? m.players[1]?.hp ?? START_HP : START_HP],
    updatedAt: m.updatedAt,
    createdAt: m.createdAt,
  };
  if (r.private) s.private = true;
  if (m.winner != null) s.winner = m.winner;
  if (r.forfeitBy != null) s.forfeitBy = r.forfeitBy;
  if (side != null) {
    s.side = side;
    s.yourTurn = m.status === 'deploy' && !m.players[side].ready;
    if (m.status === 'deploy') s.opponentReady = !!m.players[(1 - side) as Side].ready;
    if (side === 0 && r.code && m.status === 'waiting') s.code = r.code;
  }
  return s;
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+([0-9a-f]{64})$/i.exec(h.trim());
  return m ? m[1].toLowerCase() : null;
}

function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'JSON object body required');
  return v as Record<string, unknown>;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length']);
    if (len > BODY_LIMIT) { reject(new HttpError(413, 'Request body too large')); req.resume(); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > BODY_LIMIT) { failed = true; reject(new HttpError(413, 'Request body too large')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      if (size === 0) { resolve({}); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', (e) => { if (!failed) { failed = true; reject(e); } });
  });
}

function send(res: ServerResponse, status: number, body: unknown, extra?: Record<string, string>): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(data);
}
