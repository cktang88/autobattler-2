// Client side of async multiplayer: session (localStorage), fetch wrapper, lobby calls and NetDriver.

import type { DeployAction, Design, MatchState, Side } from '../shared/types.ts';
import { sanitizePool, type AiPool } from '../shared/aipool.ts';
import type { MatchDriver } from './driver.ts';

/** `auto`: a guest placeholder created silently so the garage can be stored server-side.
 *  `registered`: signed in with a username + password (the account works on any device). A session with neither is
 *  a callsign from before passwords existed: signing in with that name and a password claims it. */
export interface Session { playerId: string; name: string; token: string; auto?: boolean; registered?: boolean }
export interface MatchSummary {
  id: string;
  status: MatchState['status'];
  round: number;
  /** names [p0, p1?] */
  names: [string, string | null];
  hp: [number, number];
  /** for 'mine': my side, and whether the server is waiting on me */
  side?: Side;
  yourTurn?: boolean;
  /** for 'mine' during deploy: opponent already submitted this round */
  opponentReady?: boolean;
  updatedAt: number;
  createdAt?: number;
  private?: boolean;
  /** join code of my private waiting match */
  code?: string;
  winner?: Side | -1;
  forfeitBy?: Side;
}

const KEY_SESSION = 'ab2.session';
const API = '/api';

let session: Session | null | undefined;

export function currentSession(): Session | null {
  if (session === undefined) {
    session = null;
    try {
      const raw = localStorage.getItem(KEY_SESSION);
      const s = raw ? (JSON.parse(raw) as Session) : null;
      if (s && typeof s.token === 'string' && typeof s.playerId === 'string') session = s;
    } catch { /* storage unavailable */ }
  }
  return session;
}

/** Signed in with a username + password (multiplayer needs this). */
export function signedIn(): boolean {
  const s = currentSession();
  return !!s && !!s.registered;
}

/** Called whenever the session changes (sign in / out): the menu and lobby re-render their account box. */
const sessionListeners = new Set<() => void>();
export function onSessionChange(fn: () => void): () => void {
  sessionListeners.add(fn);
  return () => { sessionListeners.delete(fn); };
}

function setSession(s: Session | null): void {
  const changed = (session?.token ?? null) !== (s?.token ?? null) || session?.registered !== s?.registered || session?.name !== s?.name;
  session = s;
  try {
    if (s) localStorage.setItem(KEY_SESSION, JSON.stringify(s));
    else localStorage.removeItem(KEY_SESSION);
  } catch { /* storage unavailable */ }
  if (changed) for (const fn of [...sessionListeners]) { try { fn(); } catch (e) { console.error('[net] session listener failed', e); } }
}

/** Thrown for non-2xx responses; `status` is the HTTP status (0 = network failure). */
export class NetError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** `keepSession`: a 401 means bad credentials in the body (wrong password), not an expired token. */
async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal, keepSession = false): Promise<T> {
  const headers: Record<string, string> = {};
  const s = currentSession();
  if (s) headers.Authorization = `Bearer ${s.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store', signal });
  } catch {
    throw new NetError('Cannot reach the server — check your connection', 0);
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* empty / non-JSON */ }
  if (!res.ok) {
    if (res.status === 401 && s && !keepSession && currentSession()?.token === s.token) setSession(null);
    throw new NetError((data && typeof data.error === 'string' && data.error) || `Server error (${res.status})`, res.status);
  }
  return data as T;
}

export type SignInStatus = 'signed-in' | 'registered' | 'claimed';

/** Sign in with a username + password: an existing name opens that account (its garage and matches, on any device);
 *  a new name creates it. A guest placeholder or an old password-less callsign on this device is upgraded in place, so
 *  its server-side garage stays with it; otherwise sync.ts merges this device's garage into the account. */
export async function signIn(name: string, password: string): Promise<{ session: Session; status: SignInStatus }> {
  // an auto-session being created right now (garage sync) is the one to upgrade, not one to replace
  if (pendingAuto) await pendingAuto.catch(() => {});
  const prev = currentSession();
  const body: Record<string, string> = { name, password };
  if (prev && !prev.registered) body.token = prev.token;
  const s = await call<Session & { status: SignInStatus }>('POST', '/login', body, undefined, true);
  setSession({ playerId: s.playerId, name: s.name, token: s.token, registered: true });
  return { session: currentSession()!, status: s.status };
}

/** Change the signed-in account's password. */
export async function changePassword(password: string, newPassword: string): Promise<void> {
  await call('POST', '/password', { password, newPassword }, undefined, true);
}

/** Re-read name / registered from the server (e.g. a session stored by an older build). */
export async function refreshSession(): Promise<void> {
  const s = currentSession();
  if (!s) return;
  const me = await getMe();
  const cur = currentSession();
  if (cur && cur.token === s.token) setSession({ ...cur, name: me.name, registered: me.registered || undefined, ...(me.registered ? { auto: undefined } : {}) });
}

/** The stored session, or a fresh account under a placeholder callsign (so designs can be saved server-side). */
let pendingAuto: Promise<Session> | null = null;
export function ensureSession(): Promise<Session> {
  const cur = currentSession();
  if (cur) return Promise.resolve(cur);
  // one placeholder account at a time (startup sync, a write, the lobby may all ask at once)
  pendingAuto ??= (async () => {
    try {
      const s = await call<Session>('POST', '/login', { name: `Pilot ${1000 + Math.floor(Math.random() * 9000)}` });
      // a real login that finished meanwhile wins over the placeholder
      if (!currentSession()) setSession({ playerId: s.playerId, name: s.name, token: s.token, auto: true });
      return currentSession()!;
    } finally { pendingAuto = null; }
  })();
  return pendingAuto;
}

export interface GarageData { designs: Design[]; deck: string[]; rev: number; updatedAt: number }
export async function getGarage(): Promise<GarageData | null> {
  return (await call<{ garage: GarageData | null }>('GET', '/garage')).garage;
}
export async function putGarage(designs: Design[], deck: string[], baseRev: number): Promise<{ ok: true; rev: number } | { ok: false; conflict: GarageData }> {
  return call('POST', '/garage', { designs, deck, baseRev });
}

/** Sign out on this device: the server forgets this session's token; the local garage copy stays (as a guest). */
export function logout(): void {
  const s = currentSession();
  if (s) void call('POST', '/logout').catch(() => { /* offline: the token just stays valid server-side */ });
  setSession(null);
}

/** Verify the stored session with the server (clears it if the token is no longer valid). */
export async function getMe(): Promise<{ playerId: string; name: string; registered?: boolean; activeMatches: number; maxActiveMatches: number }> {
  return call('GET', '/me');
}

export async function listMatches(): Promise<{ mine: MatchSummary[]; open: MatchSummary[] }> {
  return call('GET', '/matches');
}

/** Create a public match waiting for an opponent; returns its id. */
export async function createMatch(deck: Design[]): Promise<string> {
  return (await call<{ id: string }>('POST', '/matches', { deck, private: false })).id;
}

/** Create a private match; share `code` with a friend so they can join. */
export async function createPrivateMatch(deck: Design[]): Promise<{ id: string; code: string }> {
  return call('POST', '/matches', { deck, private: true });
}

/** Join the oldest open public match, or create one if none. */
export async function quickMatch(deck: Design[]): Promise<{ id: string; joined: boolean }> {
  return call('POST', '/matches/quick', { deck });
}

/** Join by match id or 6-char join code; resolves to the match id. */
export async function joinMatch(idOrCode: string, deck: Design[]): Promise<string> {
  const key = idOrCode.trim();
  if (!key) throw new Error('Enter a match code');
  return (await call<{ id: string }>('POST', `/matches/${encodeURIComponent(key)}/join`, { deck })).id;
}

/** Forfeit a running match (or cancel your own waiting one). */
export async function forfeitMatch(id: string): Promise<void> {
  await call('POST', `/matches/${encodeURIComponent(id)}/forfeit`);
}

interface MatchResponse { side: Side; match: MatchState }

/** Load a match the current player is in and return a driver for it. */
export async function openMatch(id: string): Promise<MatchDriver> {
  const r = await call<MatchResponse & { summary?: MatchSummary }>('GET', `/matches/${encodeURIComponent(id)}`);
  if (!r.match) throw new Error('You are not in this match');
  return new NetDriver(r.match.id, r.side, r.match);
}

/** how long the server may hold each poll open waiting for a change (it caps this at 20 s) */
const LONG_POLL_MS = 20000;
/** pause between polls when the server answered without holding (e.g. an older server) */
const POLL_GAP_MS = 1000;
const POLL_FAIL_MS = 3000;
const POLL_DONE_MS = 60000;
const POLL_MAX_BACKOFF_MS = 60000;

export class NetDriver implements MatchDriver {
  readonly side: Side;
  readonly mode = 'pvp' as const;
  readonly id: string;
  private m: MatchState;
  private subs = new Set<(m: MatchState) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private inflight = false;
  private failures = 0;
  private abort: AbortController | null = null;
  private readonly onVisibility = () => {
    if (!this.active || document.visibilityState !== 'visible') return;
    if (this.failures) { this.failures = 0; void this.refresh(); }
  };

  constructor(id: string, side: Side, m: MatchState) {
    this.id = id;
    this.side = side;
    this.m = m;
  }

  state(): MatchState { return this.m; }

  opponentName(): string {
    const p = this.m.players[(1 - this.side) as Side];
    return this.m.status === 'waiting' || !p?.name ? 'Waiting for opponent…' : p.name;
  }

  async submit(a: DeployAction): Promise<void> {
    const r = await call<MatchResponse>('POST', `/matches/${encodeURIComponent(this.id)}/deploy`, { action: a });
    this.update(r.match);
  }

  /** Forfeit this match. */
  async forfeit(): Promise<void> {
    const r = await call<Partial<MatchResponse>>('POST', `/matches/${encodeURIComponent(this.id)}/forfeit`);
    if (r.match) this.update(r.match);
  }

  subscribe(cb: (m: MatchState) => void): () => void {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.refresh();
  }

  stop(): void {
    this.active = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.abort?.abort();
    this.abort = null;
  }

  /** Long-poll: the server holds the request until the match changes (or ~20 s pass), so the opponent's
   *  deployment / the resolved round shows up immediately — also in a background window. */
  async refresh(): Promise<void> {
    if (this.inflight) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.inflight = true;
    const t0 = Date.now();
    let held = false;
    try {
      const wait = this.m.status === 'done' ? 0 : LONG_POLL_MS;
      const asked = this.m;
      this.abort = new AbortController();
      const r = await call<Partial<MatchResponse> & { unchanged?: boolean }>(
        'GET', `/matches/${encodeURIComponent(this.id)}?since=${this.m.updatedAt}&wait=${wait}`, undefined, this.abort.signal);
      this.failures = 0;
      held = wait > 0 && (!!r.match || Date.now() - t0 > LONG_POLL_MS / 2);
      // nothing changed locally while the poll was out: an OLDER answer means the server rolled back (it lost
      // writes in a crash), so take it rather than waiting on state the server no longer has
      if (r.match) this.update(r.match, this.m === asked);
    } catch (e) {
      this.failures++;
      // permanent failures (logged out / match gone) end polling
      if (e instanceof NetError && (e.status === 401 || e.status === 403 || e.status === 404)) this.stop();
    } finally {
      this.inflight = false;
      this.abort = null;
      // re-poll straight away after a held poll (no timer: background tabs throttle timers to ~1/min)
      if (this.active && !this.failures && held && this.m.status !== 'done') void this.refresh();
      else this.schedule();
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.active) return;
    let delay = this.m.status === 'done' ? POLL_DONE_MS : POLL_GAP_MS;
    if (this.failures) delay = Math.min(POLL_MAX_BACKOFF_MS, POLL_FAIL_MS * 2 ** Math.min(this.failures - 1, 5));
    this.timer = setTimeout(() => void this.refresh(), delay);
  }

  private update(m: MatchState, force = false): void {
    if (!force && m.updatedAt < this.m.updatedAt) return; // out-of-order response
    this.m = m;
    for (const cb of [...this.subs]) {
      try { cb(m); } catch (e) { console.error('[net] subscriber failed', e); }
    }
  }
}

// ---- the global AI design pool (server: src/server/aipool.ts) ----

/** The server's global AI pool (validated), or null when the server can't be reached within `timeoutMs`. */
export async function fetchAiPool(timeoutMs = 1500): Promise<AiPool | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(API + '/aipool', { signal: ctl.signal });
    if (!res.ok) return null;
    const data = await res.json() as { pool?: unknown };
    const pool = sanitizePool(data?.pool);
    return pool.v === (data?.pool as AiPool | undefined)?.v ? pool : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Report a finished vs-AI match to the global pool. true = accepted or a permanent refusal (don't retry: bad match,
 *  duplicate); false = try again later (offline, rate-limited, busy). */
export async function reportAiMatch(match: MatchState): Promise<boolean> {
  try {
    await call('POST', '/aipool/report', { match });
    return true;
  } catch (e) {
    const st = e instanceof NetError ? e.status : 0;
    return st === 400 || st === 409 || st === 413;
  }
}

// ---- in-match chat (server: src/server/chat.ts) ----

/** Mirrors ChatMessage in src/server/chat.ts. */
export interface ChatMessage { id: number; side: Side; text: string; at: number }

/** Post a chat line to a PvP match (the server trims / cleans it and caps it at 140 characters). */
export async function postChat(matchId: string, text: string): Promise<ChatMessage> {
  return (await call<{ msg: ChatMessage }>('POST', `/matches/${encodeURIComponent(matchId)}/chat`, { text })).msg;
}

/** Chat lines newer than `since` (all kept ones when null). With `wait` the server holds the request until one
 *  arrives (or ~20 s pass). `last` is the id to pass as `since` next time. */
export async function pollChat(matchId: string, since: number | null, wait: number, signal?: AbortSignal): Promise<{ msgs: ChatMessage[]; last: number }> {
  const q = since == null ? '' : `?since=${since}&wait=${wait}`;
  return call('GET', `/matches/${encodeURIComponent(matchId)}/chat${q}`, undefined, signal);
}
