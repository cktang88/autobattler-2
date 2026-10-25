// In-match chat between the two players of a PvP match. Ephemeral by design: the last MAX_CHAT_HISTORY messages per
// match live in memory only (a restart clears them; nothing is written to DATA_DIR). Delivery is its own cheap
// since-id long poll (GET /api/matches/:id/chat?since=<id>&wait=ms), kept apart from the match poll so a chat line
// never bumps the match's updatedAt (which would persist the match and resend its whole state to both players).
// Api (api.ts) does the auth + participant check and hands the side over; this file owns the messages and waiters.

import type { Side } from '../shared/types.ts';
import { RateLimiter } from './ratelimit.ts';
import { HttpError } from './validate.ts';

/** longest message, in code points (the client's input enforces the same) */
export const CHAT_MAX_LEN = 140;
/** messages kept per match */
export const MAX_CHAT_HISTORY = 30;
/** cap on a chat long poll; kept under the server's 30 s requestTimeout */
export const CHAT_MAX_WAIT_MS = 20_000;
/** posts per player: a burst of 5, then one every 2 s */
export const CHAT_BURST = 5;
export const CHAT_PER_SEC = 0.5;

/** Mirrors ChatMessage in src/client/net.ts. */
export interface ChatMessage {
  /** monotonic across the whole server (and across restarts: it follows the clock), so ?since=<id> survives one */
  id: number;
  side: Side;
  text: string;
  at: number;
}

const bad = (msg: string): never => { throw new HttpError(400, msg); };

/** Trim, collapse whitespace, strip control / invisible format characters (bidi overrides etc.; the zero-width
 *  joiner stays for emoji sequences). 400 when it is not a string, empty afterwards or over CHAT_MAX_LEN. */
export function sanitizeChatText(raw: unknown): string {
  if (typeof raw !== 'string') bad('Message text required');
  if ((raw as string).length > CHAT_MAX_LEN * 8) bad(`Message is too long (${CHAT_MAX_LEN} characters max)`);
  const text = (raw as string)
    .normalize('NFC')
    .replace(/[\t\n\r\v\f\u2028\u2029]+/g, ' ')
    .replace(/(?!\u200d)[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) bad('Message is empty');
  if ([...text].length > CHAT_MAX_LEN) bad(`Message is too long (${CHAT_MAX_LEN} characters max)`);
  return text;
}

interface Channel { msgs: ChatMessage[]; waiters: Set<() => void> }

export class ChatHub {
  private readonly channels = new Map<string, Channel>();
  private readonly limiter = new RateLimiter(CHAT_BURST, CHAT_PER_SEC);
  private lastId = 0;

  private channel(matchId: string): Channel {
    let ch = this.channels.get(matchId);
    if (!ch) this.channels.set(matchId, (ch = { msgs: [], waiters: new Set() }));
    return ch;
  }

  /** Post as `playerId` on `side` (already checked to be a participant). Rate-limited per player. */
  post(matchId: string, playerId: string, side: Side, raw: unknown, now = Date.now()): ChatMessage {
    const text = sanitizeChatText(raw);
    if (!this.limiter.take(`p:${playerId}`, now)) throw new HttpError(429, 'You are chatting too fast — wait a moment');
    const ch = this.channel(matchId);
    this.lastId = Math.max(now, this.lastId + 1);
    const msg: ChatMessage = { id: this.lastId, side, text, at: now };
    ch.msgs.push(msg);
    if (ch.msgs.length > MAX_CHAT_HISTORY) ch.msgs.splice(0, ch.msgs.length - MAX_CHAT_HISTORY);
    for (const fn of [...ch.waiters]) fn();
    return msg;
  }

  /** Messages newer than `since` (all kept ones when since is absent / not a number). */
  read(matchId: string, since?: number): { msgs: ChatMessage[]; last: number } {
    const msgs = this.channels.get(matchId)?.msgs ?? [];
    const s = since != null && Number.isFinite(since) ? since : -Infinity;
    const out = msgs.filter((m) => m.id > s);
    const last = msgs.length ? msgs[msgs.length - 1].id : (Number.isFinite(s) ? Math.max(0, s) : 0);
    return { msgs: out, last };
  }

  /** Long poll: resolves with the new messages as soon as one arrives, or (empty) after `waitMs` / when the
   *  request closes. */
  async poll(matchId: string, since: number | undefined, waitMs: number, onClose?: (fn: () => void) => () => void): Promise<{ msgs: ChatMessage[]; last: number }> {
    const now = this.read(matchId, since);
    const wait = Math.min(CHAT_MAX_WAIT_MS, Math.max(0, waitMs || 0));
    if (now.msgs.length || wait <= 0 || since == null) return now;
    const ch = this.channel(matchId);
    await new Promise<void>((resolve) => {
      let off: (() => void) | undefined;
      const done = () => {
        clearTimeout(timer);
        off?.();
        ch.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, wait);
      ch.waiters.add(done);
      off = onClose?.(done);
    });
    return this.read(matchId, since);
  }

  /** Wake a match's chat polls (e.g. the match was removed, so they can find out). */
  wake(matchId: string): void {
    const ch = this.channels.get(matchId);
    if (ch) for (const fn of [...ch.waiters]) fn();
  }

  /** Drop channels of matches that no longer exist (and nobody is waiting on), and refilled rate-limit buckets. */
  prune(exists: (matchId: string) => boolean): void {
    for (const [id, ch] of this.channels) if (!exists(id) && !ch.waiters.size) this.channels.delete(id);
    this.limiter.prune();
  }
}
