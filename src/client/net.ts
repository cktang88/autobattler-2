// Client side of async multiplayer: session (localStorage), fetch wrapper, lobby calls and NetDriver.

import type { DeployAction, Design, MatchState, Side } from '../shared/types.ts';
import type { MatchDriver } from './driver.ts';

export interface Session { playerId: string; name: string; token: string }
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

function setSession(s: Session | null): void {
  session = s;
  try {
    if (s) localStorage.setItem(KEY_SESSION, JSON.stringify(s));
    else localStorage.removeItem(KEY_SESSION);
  } catch { /* storage unavailable */ }
}

/** Thrown for non-2xx responses; `status` is the HTTP status (0 = network failure). */
export class NetError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const s = currentSession();
  if (s) headers.Authorization = `Bearer ${s.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch {
    throw new NetError('Cannot reach the server — check your connection', 0);
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* empty / non-JSON */ }
  if (!res.ok) {
    if (res.status === 401 && s) setSession(null);
    throw new NetError((data && typeof data.error === 'string' && data.error) || `Server error (${res.status})`, res.status);
  }
  return data as T;
}

export async function login(name: string): Promise<Session> {
  const s = await call<Session>('POST', '/login', { name });
  setSession({ playerId: s.playerId, name: s.name, token: s.token });
  return currentSession()!;
}

export function logout(): void {
  setSession(null);
}

/** Verify the stored session with the server (clears it if the token is no longer valid). */
export async function getMe(): Promise<{ playerId: string; name: string; activeMatches: number; maxActiveMatches: number }> {
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

const POLL_VISIBLE_MS = 3000;
const POLL_HIDDEN_MS = 30000;
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
  private readonly onVisibility = () => {
    if (!this.active) return;
    if (document.visibilityState === 'visible') { this.failures = 0; void this.refresh(); } else this.schedule();
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
    this.schedule();
  }

  stop(): void {
    this.active = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Fetch now (if changed since our copy) and notify subscribers. */
  async refresh(): Promise<void> {
    if (this.inflight) return;
    this.inflight = true;
    try {
      const r = await call<Partial<MatchResponse> & { unchanged?: boolean }>(
        'GET', `/matches/${encodeURIComponent(this.id)}?since=${this.m.updatedAt}`);
      this.failures = 0;
      if (r.match) this.update(r.match);
    } catch (e) {
      this.failures++;
      // permanent failures (logged out / match gone) end polling
      if (e instanceof NetError && (e.status === 401 || e.status === 403 || e.status === 404)) this.stop();
    } finally {
      this.inflight = false;
      this.schedule();
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.active) return;
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    let delay = hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
    // finished matches never change; poll rarely just in case
    if (this.m.status === 'done') delay = Math.max(delay, POLL_MAX_BACKOFF_MS);
    if (this.failures) delay = Math.min(POLL_MAX_BACKOFF_MS, delay * 2 ** Math.min(this.failures, 5));
    this.timer = setTimeout(() => void this.refresh(), delay);
  }

  private update(m: MatchState): void {
    if (m.updatedAt < this.m.updatedAt) return; // out-of-order response
    this.m = m;
    for (const cb of [...this.subs]) {
      try { cb(m); } catch (e) { console.error('[net] subscriber failed', e); }
    }
  }
}
