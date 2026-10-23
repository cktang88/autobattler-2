// Client garage sync (src/client/sync.ts) against a real server: fake localStorage / window, fetch routed to it.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type RunningServer } from '../src/server/main.ts';
import type { Design } from '../src/shared/types.ts';

const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
};
(globalThis as any).window = new EventTarget();

let srv: RunningServer;
let base = '';
let dataDir: string;
const realFetch = globalThis.fetch;
/** called (once) when a GET /api/garage response arrives, before the client sees it */
let onGarageGet: (() => void) | null = null;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  const r = await realFetch(u.startsWith('/') ? base + u : u, init);
  if (u === '/api/garage' && (init?.method ?? 'GET') === 'GET' && onGarageGet) { const f = onGarageGet; onGarageGet = null; f(); }
  return r;
}) as typeof fetch;

const { syncGarage, mergeGarage } = await import('../src/client/sync.ts');
const net = await import('../src/client/net.ts');
const storage = await import('../src/client/storage.ts');

const D = (id: string, name = id): Design => ({ id, name, chassis: 'scout', mobility: 'wheels', mounts: ['mg'] });

async function start(dir: string) {
  srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, publicDir: dir, saveDebounceMs: 10 });
  base = `http://127.0.0.1:${srv.port}`;
}
async function api(method: string, url: string, body?: unknown): Promise<any> {
  const s = net.currentSession()!;
  const r = await realFetch(base + url, { method, headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
const ids = (ds: Design[] | null) => (ds ?? []).map((d) => d.id);

before(async () => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab2-sync-')); await start(dataDir); });
after(async () => { await srv.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
beforeEach(() => { mem.clear(); net.logout(); });

test('mergeGarage: deletions stick, local edits win, new designs on both sides kept', () => {
  const base = { designs: [D('a'), D('b'), D('c')], deck: ['a', 'b'] };
  const mine = { designs: [D('a', 'A mine'), D('c'), D('m')], deck: ['a', 'b'] }; // deleted b, edited a, added m
  const srvG = { designs: [D('a', 'A srv'), D('b'), D('s')], deck: ['s', 'a'] }; // deleted c, edited a, added s
  const out = mergeGarage(base, mine, srvG);
  assert.deepEqual(ids(out.designs), ['a', 's', 'm']);
  assert.equal(out.designs[0].name, 'A mine');
  assert.deepEqual(out.deck, ['s', 'a']); // only the server changed the deck
  // deleted here but edited on the server: the edit survives
  assert.deepEqual(ids(mergeGarage(base, { designs: [D('a'), D('c')], deck: [] }, { designs: [D('a'), D('b', 'B2'), D('c')], deck: [] }).designs), ['a', 'b', 'c']);
  // never synced: union, this device winning on the same id
  const u = mergeGarage(null, { designs: [D('a', 'mine')], deck: ['a'] }, { designs: [D('a', 'srv'), D('z')], deck: ['z'] });
  assert.deepEqual(ids(u.designs), ['a', 'z']);
  assert.equal(u.designs[0].name, 'mine');
  assert.deepEqual(u.deck, ['a']);
});

test('first run: placeholder account, nothing pushed until designs exist, then pushed', async () => {
  await syncGarage();
  assert.ok(net.currentSession()?.auto);
  assert.equal((await api('GET', '/api/garage')).garage, null);
  storage.saveDesigns([D('a'), D('b')]);
  storage.saveDeckIds(['a']);
  await syncGarage();
  const g = (await api('GET', '/api/garage')).garage;
  assert.deepEqual(ids(g.designs), ['a', 'b']);
  assert.deepEqual(g.deck, ['a']);
});

test('a design deleted here is not resurrected when another tab wrote meanwhile', async () => {
  storage.saveDesigns([D('a'), D('b'), D('c')]);
  await syncGarage();
  // another tab / session edits a, then this one deletes b before syncing
  const g = (await api('GET', '/api/garage')).garage;
  assert.equal((await api('POST', '/api/garage', { designs: [D('a', 'A2'), D('b'), D('c')], deck: [], baseRev: g.rev })).ok, true);
  storage.saveDesigns([D('a'), D('c')]);
  await syncGarage();
  assert.deepEqual(ids(storage.loadDesigns()), ['a', 'c']);
  assert.equal(storage.loadDesigns()![0].name, 'A2');
  assert.deepEqual(ids((await api('GET', '/api/garage')).garage.designs), ['a', 'c']);
});

test('an edit made while the pull is in flight is neither wiped nor left unpushed', async () => {
  storage.saveDesigns([D('a')]);
  await syncGarage();
  const g = (await api('GET', '/api/garage')).garage;
  await api('POST', '/api/garage', { designs: [D('a'), D('s')], deck: [], baseRev: g.rev }); // newer server rev
  onGarageGet = () => storage.saveDesigns([D('a'), D('new')]); // the player saves while the GET is out
  await syncGarage();
  assert.deepEqual(ids(storage.loadDesigns()).sort(), ['a', 'new', 's']);
  assert.deepEqual(ids((await api('GET', '/api/garage')).garage.designs).sort(), ['a', 'new', 's']);
});

test('server data reset (401): a fresh account gets the local garage', async () => {
  storage.saveDesigns([D('a'), D('b')]);
  await syncGarage();
  const old = net.currentSession()!.playerId;
  await srv.close();
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'ab2-sync-'));
  await start(fresh);
  try {
    await syncGarage();
    assert.notEqual(net.currentSession()?.playerId, old);
    assert.deepEqual(ids((await api('GET', '/api/garage')).garage.designs), ['a', 'b']);
  } finally {
    await srv.close();
    fs.rmSync(fresh, { recursive: true, force: true });
    await start(dataDir);
  }
});

test('ensureSession: concurrent callers share one placeholder account; a login meanwhile wins', async () => {
  const [a, b] = await Promise.all([net.ensureSession(), net.ensureSession()]);
  assert.equal(a.playerId, b.playerId);
  net.logout();
  const p = net.ensureSession();
  const named = (await net.signIn('Named', 'pass1')).session;
  await p;
  assert.equal(net.currentSession()?.name, 'Named');
  assert.equal(net.currentSession()?.auto, undefined);
  assert.equal(net.currentSession()?.registered, true);
  assert.equal(named.playerId, net.currentSession()?.playerId);
});

test('sign in: a guest registering keeps its account; signing in to an existing account merges the guest garage', async () => {
  // guest designs a unit, then registers: the same (upgraded) account, garage intact
  storage.saveDesigns([D('g1')]);
  await syncGarage();
  const guestId = net.currentSession()!.playerId;
  assert.equal(net.currentSession()!.auto, true);
  const reg = await net.signIn('Merger', 'pw1234');
  assert.equal(reg.status, 'registered');
  assert.equal(reg.session.playerId, guestId);
  await syncGarage();
  assert.deepEqual(ids((await api('GET', '/api/garage')).garage.designs), ['g1']);
  // a fresh device: its own guest garage, then signs in to the account -> union of both, on both sides
  mem.clear();
  net.logout();
  storage.saveDesigns([D('g2')]);
  await syncGarage();
  assert.notEqual(net.currentSession()!.playerId, guestId);
  const again = await net.signIn('merger', 'pw1234');
  assert.equal(again.status, 'signed-in');
  assert.equal(again.session.playerId, guestId);
  await syncGarage();
  assert.deepEqual(ids(storage.loadDesigns()).sort(), ['g1', 'g2']);
  assert.deepEqual(ids((await api('GET', '/api/garage')).garage.designs).sort(), ['g1', 'g2']);
  // wrong password: rejected, and the current session is not dropped
  await assert.rejects(net.signIn('Merger', 'nope'), /wrong password/i);
  assert.equal(net.currentSession()?.playerId, guestId);
  // signing out keeps the local garage
  net.logout();
  assert.equal(net.currentSession(), null);
  assert.deepEqual(ids(storage.loadDesigns()).sort(), ['g1', 'g2']);
});
