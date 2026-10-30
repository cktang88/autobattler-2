// Real-time tug of war rooms (shared/tug.ts), in memory only. The server does not run the fight: it is the lockstep
// clock. Every command a player sends is stamped with a tick a little in the future (LEAD) and appended to the room's
// order log; both clients long-poll the log and simulate the same TugGame up to the "frontier", the last tick no
// later command can land on. Since the sim is deterministic, both see the same battle.

import crypto from 'node:crypto';
import { TICK_RATE } from '../shared/sim/types.ts';
import { sanitizeCommand, type TugOrder } from '../shared/tug.ts';
import type { Design, Side } from '../shared/types.ts';
import { HttpError } from './validate.ts';

/** ticks between a command reaching the server and taking effect (the lockstep input delay) */
export const TUG_LEAD = 16;
/** longest a poll is held open; must stay well under LEAD ticks so clients never stall at the frontier */
export const TUG_MAX_WAIT = 500;
/** countdown between the second player joining and tick 0 */
export const TUG_COUNTDOWN_MS = 3000;
/** a player who hasn't polled for this long during a live game forfeits */
export const TUG_IDLE_MS = 20_000;
const ROOM_TTL_MS = 15 * 60_000;
const MAX_ROOMS = 200;
const MAX_ORDERS = 20_000;
const MS_PER_TICK = 1000 / TICK_RATE;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface TugPlayer { id: string; name: string }

interface Room {
  id: string;
  code: string;
  private: boolean;
  seed: number;
  owners: [string, string | null];
  names: [string, string | null];
  rosters: [Design[], Design[] | null];
  createdAt: number;
  /** wall-clock ms of tick 0 (set when the second player joins) */
  startAt: number;
  orders: TugOrder[];
  lastPoll: [number, number];
  /** reported by the clients (or a forfeit) */
  winner: Side | -1 | null;
  doneAt: number;
  /** frontier frozen at the end (no orders are taken after it) */
  endFrontier: number;
  waiters: Set<() => void>;
}

export interface TugRoomView {
  id: string;
  code?: string;
  side: Side;
  status: 'waiting' | 'countdown' | 'live' | 'done';
  seed: number;
  names: [string, string | null];
  rosters?: [Design[], Design[]];
  /** server clock: ms now, ms of tick 0, current (fractional) tick, and the frontier tick */
  now: number;
  startAt: number;
  tick: number;
  frontier: number;
  /** orders from index `since` on, and the total count */
  orders: TugOrder[];
  total: number;
  winner: Side | -1 | null;
}

export class TugHub {
  private rooms = new Map<string, Room>();
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private sweep(): void {
    const t = this.now();
    for (const [id, r] of this.rooms) {
      if (r.winner !== null && t - r.doneAt > 5 * 60_000) this.rooms.delete(id);
      else if (!r.owners[1] && t - r.createdAt > ROOM_TTL_MS) this.rooms.delete(id);
      else if (r.owners[1] && r.winner === null) this.checkIdle(r, t);
    }
  }

  private tickAt(r: Room, t: number): number { return r.startAt ? (t - r.startAt) / MS_PER_TICK : -Infinity; }

  /** the last tick every order is already known for */
  private frontier(r: Room, t: number): number {
    if (!r.startAt) return -1;
    if (r.winner !== null) return r.endFrontier;
    return Math.max(0, Math.floor(this.tickAt(r, t))) + TUG_LEAD - 1;
  }

  /** a live player who stopped polling forfeits (as a surrender order, so both clients replay it the same way) */
  private checkIdle(r: Room, t: number): void {
    if (!r.startAt || t < r.startAt) return;
    for (const s of [0, 1] as Side[]) {
      if (t - Math.max(r.lastPoll[s], r.startAt) > TUG_IDLE_MS) {
        this.push(r, s, { t: 'surrender' }, t);
        this.finish(r, s === 0 ? 1 : 0, t);
        return;
      }
    }
  }

  private finish(r: Room, winner: Side | -1, t: number): void {
    r.endFrontier = Math.max(this.frontier(r, t), r.orders.length ? r.orders[r.orders.length - 1].tick : 0);
    r.winner = winner;
    r.doneAt = t;
    for (const fn of [...r.waiters]) fn();
  }

  private push(r: Room, side: Side, cmd: TugOrder['cmd'], t: number): TugOrder {
    const o: TugOrder = { tick: Math.max(0, Math.floor(this.tickAt(r, t))) + TUG_LEAD, side, cmd };
    r.orders.push(o);
    for (const fn of [...r.waiters]) fn();
    return o;
  }

  private sideOf(r: Room, pid: string): Side | null {
    return r.owners[0] === pid ? 0 : r.owners[1] === pid ? 1 : null;
  }

  private find(idOrCode: string): Room | undefined {
    const r = this.rooms.get(idOrCode);
    if (r) return r;
    const code = idOrCode.toUpperCase();
    for (const x of this.rooms.values()) if (x.code === code && x.winner === null) return x;
    return undefined;
  }

  private view(r: Room, side: Side, since: number, t: number): TugRoomView {
    const status = r.winner !== null ? 'done' : !r.owners[1] ? 'waiting' : t < r.startAt ? 'countdown' : 'live';
    const from = Math.max(0, Math.min(r.orders.length, Math.floor(since) || 0));
    return {
      id: r.id, side, status, seed: r.seed, names: r.names,
      ...(side === 0 && !r.owners[1] ? { code: r.code } : {}),
      ...(r.rosters[1] ? { rosters: [r.rosters[0], r.rosters[1]] as [Design[], Design[]] } : {}),
      now: t, startAt: r.startAt, tick: r.startAt ? this.tickAt(r, t) : 0, frontier: this.frontier(r, t),
      orders: r.orders.slice(from), total: r.orders.length, winner: r.winner,
    };
  }

  list(p: TugPlayer): { open: { id: string; name: string; createdAt: number }[] } {
    this.sweep();
    const open = [...this.rooms.values()].filter((r) => !r.owners[1] && !r.private && r.owners[0] !== p.id)
      .sort((a, b) => a.createdAt - b.createdAt).slice(0, 30).map((r) => ({ id: r.id, name: r.names[0], createdAt: r.createdAt }));
    return { open };
  }

  create(p: TugPlayer, roster: Design[], priv: boolean): TugRoomView {
    this.sweep();
    if (this.rooms.size >= MAX_ROOMS) throw new HttpError(503, 'Too many games running — try again in a minute');
    // one waiting room per player: a new one replaces the old
    for (const [id, r] of this.rooms) if (r.owners[0] === p.id && !r.owners[1]) this.rooms.delete(id);
    const t = this.now();
    let code = '';
    do { code = Array.from(crypto.randomBytes(5), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(''); } while (this.find(code));
    const r: Room = {
      id: 'tug-' + crypto.randomBytes(8).toString('hex'), code, private: priv, seed: crypto.randomBytes(4).readUInt32LE(0) >>> 1,
      owners: [p.id, null], names: [p.name, null], rosters: [roster, null], createdAt: t, startAt: 0, orders: [],
      lastPoll: [t, 0], winner: null, doneAt: 0, endFrontier: 0, waiters: new Set(),
    };
    this.rooms.set(r.id, r);
    return this.view(r, 0, 0, t);
  }

  join(p: TugPlayer, idOrCode: string, roster: Design[]): TugRoomView {
    this.sweep();
    const r = this.find(idOrCode);
    if (!r) throw new HttpError(404, 'No such game or join code');
    const t = this.now();
    const mine = this.sideOf(r, p.id);
    if (mine !== null) {
      if (!r.owners[1]) throw new HttpError(400, "You can't join your own game");
      return this.view(r, mine, 0, t);
    }
    if (r.owners[1]) throw new HttpError(409, 'That game already has two players');
    r.owners[1] = p.id;
    r.names[1] = p.name;
    r.rosters[1] = roster;
    r.startAt = t + TUG_COUNTDOWN_MS;
    r.lastPoll = [t, t];
    for (const fn of [...r.waiters]) fn();
    return this.view(r, 1, 0, t);
  }

  /** join the oldest open public game, else open one */
  quick(p: TugPlayer, roster: Design[]): TugRoomView {
    this.sweep();
    let best: Room | null = null;
    for (const r of this.rooms.values()) {
      if (r.owners[1] || r.private || r.owners[0] === p.id || r.winner !== null) continue;
      if (!best || r.createdAt < best.createdAt) best = r;
    }
    return best ? this.join(p, best.id, roster) : this.create(p, roster, false);
  }

  /** the room as `p` sees it, orders from `since`; with `wait` the call is held until there is something new
   *  (an order, the opponent joining, the end) or the wait runs out */
  async poll(p: TugPlayer, id: string, since: number, wait: number, closed?: Promise<void>): Promise<TugRoomView> {
    const r = this.rooms.get(id);
    if (!r) throw new HttpError(404, 'No such game');
    const side = this.sideOf(r, p.id);
    if (side === null) throw new HttpError(404, 'No such game');
    r.lastPoll[side] = this.now();
    if (r.owners[1] && r.winner === null) this.checkIdle(r, this.now());
    const ms = Math.max(0, Math.min(TUG_MAX_WAIT, wait));
    const fresh = () => r.orders.length > since || r.winner !== null || (!!r.owners[1] && since < 0);
    if (ms > 0 && !fresh()) {
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); r.waiters.delete(done); resolve(); };
        const timer = setTimeout(done, ms);
        r.waiters.add(done);
        void closed?.then(done);
      });
    }
    const t = this.now();
    r.lastPoll[side] = t;
    return this.view(r, side, Math.max(0, since), t);
  }

  command(p: TugPlayer, id: string, raw: unknown): { order: TugOrder; index: number } {
    const r = this.rooms.get(id);
    if (!r) throw new HttpError(404, 'No such game');
    const side = this.sideOf(r, p.id);
    if (side === null) throw new HttpError(404, 'No such game');
    if (!r.owners[1]) throw new HttpError(409, 'Waiting for an opponent');
    if (r.winner !== null) throw new HttpError(409, 'The game is over');
    const t = this.now();
    if (t < r.startAt) throw new HttpError(409, 'The game has not started yet');
    if (r.orders.length >= MAX_ORDERS) throw new HttpError(429, 'Too many commands');
    const cmd = sanitizeCommand(raw);
    if (!cmd) throw new HttpError(400, 'Bad command');
    r.lastPoll[side] = t;
    const order = this.push(r, side, cmd, t);
    if (cmd.t === 'surrender') this.finish(r, side === 0 ? 1 : 0, t);
    return { order, index: r.orders.length - 1 };
  }

  /** a client saw a castle fall; the first report stands (the sim is the same on both) */
  result(p: TugPlayer, id: string, winner: unknown): { ok: true } {
    const r = this.rooms.get(id);
    if (!r || this.sideOf(r, p.id) === null) throw new HttpError(404, 'No such game');
    if (r.winner === null && r.startAt && this.now() >= r.startAt && (winner === 0 || winner === 1 || winner === -1)) this.finish(r, winner, this.now());
    return { ok: true };
  }

  /** leave a waiting room (cancel matchmaking) */
  leave(p: TugPlayer, id: string): { ok: true } {
    const r = this.rooms.get(id);
    if (r && r.owners[0] === p.id && !r.owners[1]) this.rooms.delete(id);
    return { ok: true };
  }
}
