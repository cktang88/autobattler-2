// JSON-file persistence for players and matches.
// Layout (DATA_DIR): players.json = {version, players: PlayerRecord[]}, matches.json = {version, matches: MatchRecord[]}.
// Writes are debounced and atomic (write tmp file, fsync, rename).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { migrateMatch } from '../shared/match.ts';
import type { MatchState } from '../shared/types.ts';

export interface PlayerRecord {
  id: string;
  name: string;
  /** sha256(token) hex — the raw token is never stored */
  tokenHash: string;
  createdAt: number;
  lastSeen: number;
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

export class Store {
  readonly dir: string;
  readonly players = new Map<string, PlayerRecord>();
  readonly playersByToken = new Map<string, PlayerRecord>();
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
      if (!p || typeof p.id !== 'string' || typeof p.tokenHash !== 'string') continue;
      this.players.set(p.id, p);
      this.playersByToken.set(p.tokenHash, p);
    }
    const matches = readJson<{ matches?: MatchRecord[] }>(path.join(this.dir, 'matches.json'));
    let migrated = 0;
    for (const r of matches?.matches ?? []) {
      if (!r || !r.match || typeof r.match.id !== 'string') continue;
      // matches saved before the rules marker: rescale pre-price-/5 supply, stamp the version (see migrateMatch)
      try { if (migrateMatch(r.match)) migrated++; } catch (e) { console.error(`[store] could not migrate match ${r.match.id}`, e); }
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
    this.playersByToken.set(p.tokenHash, p);
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
