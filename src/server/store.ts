// JSON-file persistence for players and matches.
// Layout (DATA_DIR): players.json = {version, players: PlayerRecord[]} (incl. each player's garage of designs),
// matches.json = {version, matches: MatchRecord[]}.
// Writes are debounced and atomic (write tmp file, fsync, rename).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { migrateMatch } from '../shared/match.ts';
import type { Design, MatchState } from '../shared/types.ts';

export interface PlayerRecord {
  id: string;
  name: string;
  /** sha256(token) hex of every live session (one per device that signed in) — raw tokens are never stored */
  tokenHashes: string[];
  /** @deprecated single-session records from before tokenHashes; migrated on load */
  tokenHash?: string;
  /** scrypt password hash: present on registered accounts (username + password), which own their name */
  pw?: PasswordHash;
  /** placeholder account made silently for garage sync; never claimable by name */
  guest?: boolean;
  createdAt: number;
  lastSeen: number;
  /** the player's saved designs and active deck (synced from the client's garage) */
  garage?: GarageRecord;
}

export interface PasswordHash {
  /** hex salt (per user) */
  salt: string;
  /** hex scrypt(password, salt) */
  hash: string;
}

export interface GarageRecord {
  designs: Design[];
  /** design ids of the active deck */
  deck: string[];
  /** bumped on every write; clients send the rev they last saw to detect edits from another session */
  rev: number;
  updatedAt: number;
}

export interface MatchRecord {
  match: MatchState;
  /** playerId per side (side 1 null while waiting) */
  owners: [string, string | null];
  private: boolean;
  /** 6-char join code (private matches only) */
  code: string | null;
  /** side that forfeited (or was auto-forfeited), if any */
  forfeitBy?: 0 | 1;
  /** last time resolveRound threw for this match (retry throttling) */
  resolveErrorAt?: number;
}

const VERSION = 1;

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
/** most sessions (devices) kept per account; signing in on one more drops the oldest */
export const MAX_SESSIONS = 20;
/** key of the case-insensitive username index */
export const nameKey = (name: string) => name.normalize('NFKC').toLowerCase();

export class Store {
  readonly dir: string;
  readonly players = new Map<string, PlayerRecord>();
  readonly playersByToken = new Map<string, PlayerRecord>();
  /** registered accounts (with a password) by nameKey(name): usernames are unique case-insensitively */
  readonly playersByName = new Map<string, PlayerRecord>();
  readonly matches = new Map<string, MatchRecord>();
  readonly matchesByCode = new Map<string, MatchRecord>();
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;
  private readonly debounceMs: number;

  constructor(dir: string, debounceMs = 250) {
    this.dir = path.resolve(dir);
    this.debounceMs = debounceMs;
  }

  load(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const players = readJson<{ players?: PlayerRecord[] }>(path.join(this.dir, 'players.json'));
    for (const p of players?.players ?? []) {
      if (!p || typeof p.id !== 'string') continue;
      if (!Array.isArray(p.tokenHashes)) p.tokenHashes = typeof p.tokenHash === 'string' ? [p.tokenHash] : [];
      delete p.tokenHash;
      p.tokenHashes = p.tokenHashes.filter((t) => typeof t === 'string');
      this.players.set(p.id, p);
      for (const t of p.tokenHashes) this.playersByToken.set(t, p);
      if (p.pw && typeof p.name === 'string') {
        const k = nameKey(p.name);
        const other = this.playersByName.get(k);
        // two registered accounts with one name can't be made by the API; keep the most recently seen one indexed
        if (!other || other.lastSeen < p.lastSeen) this.playersByName.set(k, p);
      }
    }
    const matches = readJson<{ matches?: MatchRecord[] }>(path.join(this.dir, 'matches.json'));
    let migrated = 0;
    for (const r of matches?.matches ?? []) {
      if (!r || !r.match || typeof r.match.id !== 'string') continue;
      // matches saved before the rules marker: rescale pre-price-/5 supply, stamp the version (see migrateMatch)
      // a changed match gets a newer updatedAt: a client that kept the old copy open across the restart long-polls
      // with since=<old updatedAt> and would otherwise be told "unchanged" (stale supply / board) until the next move
      try { if (migrateMatch(r.match)) { migrated++; r.match.updatedAt = Math.max(Date.now(), (r.match.updatedAt || 0) + 1); } } catch (e) { console.error(`[store] could not migrate match ${r.match.id}`, e); }
      this.indexMatch(r);
    }
    if (migrated) { console.log(`[store] migrated ${migrated} match(es) to the current rules version`); this.save(); }
  }

  indexMatch(r: MatchRecord): void {
    this.matches.set(r.match.id, r);
    if (r.code) this.matchesByCode.set(r.code, r);
  }

  removeMatch(r: MatchRecord): void {
    this.matches.delete(r.match.id);
    if (r.code) this.matchesByCode.delete(r.code);
    this.save();
  }

  addPlayer(p: PlayerRecord): void {
    this.players.set(p.id, p);
    for (const t of p.tokenHashes) this.playersByToken.set(t, p);
    if (p.pw) this.playersByName.set(nameKey(p.name), p);
    this.save();
  }

  /** Start one more session for the player (oldest dropped beyond MAX_SESSIONS). */
  addToken(p: PlayerRecord, tokenHash: string): void {
    p.tokenHashes.push(tokenHash);
    this.playersByToken.set(tokenHash, p);
    while (p.tokenHashes.length > MAX_SESSIONS) this.playersByToken.delete(p.tokenHashes.shift()!);
    this.save();
  }

  /** End one session (sign out). */
  removeToken(tokenHash: string): void {
    const p = this.playersByToken.get(tokenHash);
    if (!p) return;
    this.playersByToken.delete(tokenHash);
    p.tokenHashes = p.tokenHashes.filter((t) => t !== tokenHash);
    this.save();
  }

  /** Rename and/or register (set the password of) a player, keeping the username index in step. */
  setIdentity(p: PlayerRecord, name: string, pw?: PasswordHash): void {
    if (p.pw && this.playersByName.get(nameKey(p.name)) === p) this.playersByName.delete(nameKey(p.name));
    p.name = name;
    if (pw) { p.pw = pw; delete p.guest; }
    if (p.pw) this.playersByName.set(nameKey(p.name), p);
    this.save();
  }

  /** Schedule a debounced write. */
  save(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
  }

  /** Write immediately if anything changed. */
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      writeAtomic(path.join(this.dir, 'players.json'), { version: VERSION, players: [...this.players.values()] });
      writeAtomic(path.join(this.dir, 'matches.json'), { version: VERSION, matches: [...this.matches.values()] });
    } catch (e) {
      console.error('[store] write failed', e);
      this.dirty = true;
    }
  }
}

function readJson<T>(file: string): T | null {
  let raw: string;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  try { return JSON.parse(raw) as T; } catch (e) {
    // Keep the corrupt file around for inspection instead of silently overwriting it.
    const bad = `${file}.corrupt-${Date.now()}`;
    try { fs.copyFileSync(file, bad); } catch { /* ignore */ }
    console.error(`[store] could not parse ${file} (copied to ${bad})`, e);
    return null;
  }
}

function writeAtomic(file: string, data: unknown): void {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(data));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}
