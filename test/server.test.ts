// End-to-end tests for the async PvP server: real HTTP on port 0 with a temp data dir.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { startServer, type RunningServer } from '../src/server/main.ts';
import { resolveStatic } from '../src/server/static.ts';
import type { DeployAction, Design, MatchState, Side } from '../src/shared/types.ts';

const DECK: Design[] = [
  { id: 'd-buzz', name: 'Buzzsaw', chassis: 'scout', mobility: 'wheels', mounts: ['mg'] },
  { id: 'd-lance', name: 'Lancer', chassis: 'raider', mobility: 'legs', mounts: ['laser', 'laser'] },
];

let dataDir: string;
let publicDir: string;
let srv: RunningServer;
let base: string;

async function startOn(dir: string) {
  srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, publicDir, saveDebounceMs: 10 });
  base = `http://127.0.0.1:${srv.port}`;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab2-data-'));
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab2-pub-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>t</title>');
  fs.writeFileSync(path.join(publicDir, 'a.mp3'), 'x');
  fs.writeFileSync(path.join(publicDir, 'f.woff2'), 'x');
  fs.writeFileSync(path.join(dataDir, 'secret.txt'), 'top secret');
  await startOn(dataDir);
});
after(async () => {
  await srv.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
});

interface Res { status: number; body: any }
async function api(method: string, url: string, token?: string, body?: unknown): Promise<Res> {
  const r = await fetch(base + url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed: any = text;
  try { parsed = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, body: parsed };
}

async function login(name: string) {
  const r = await api('POST', '/api/login', undefined, { name });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.token, /^[0-9a-f]{64}$/);
  return r.body as { playerId: string; name: string; token: string };
}

/** A tiny valid action: place the cheapest design from the deck at a free front-row cell. */
function placeOne(m: MatchState, side: Side, x = 0): DeployAction {
  const p = m.players[side];
  return { round: m.round, place: [{ uid: p.nextUid, designId: DECK[0].id, x, y: 0, level: 1, round: m.round }], upgrade: [] };
}

/** Raw HTTP so the path isn't normalized by fetch. */
function rawGet(p: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const s = net.connect(srv.port, '127.0.0.1', () => s.write(`GET ${p} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
    let data = '';
    s.on('data', (d) => (data += d));
    s.on('end', () => resolve({ status: Number(data.split(' ')[1]), body: data.split('\r\n\r\n').slice(1).join('') }));
    s.on('error', reject);
  });
}

let alice: { playerId: string; token: string };
let bob: { playerId: string; token: string };
let carol: { playerId: string; token: string };
let matchId: string;

test('login validates and sanitizes callsigns', async () => {
  assert.equal((await api('POST', '/api/login', undefined, { name: 'x' })).status, 400);
  assert.equal((await api('POST', '/api/login', undefined, { name: 42 })).status, 400);
  assert.equal((await api('POST', '/api/login', undefined, {})).status, 400);
  const weird = await login('  <b>Ace</b>  \u0000 ');
  assert.equal(weird.name, 'bAceb');
  alice = await login('Alice');
  bob = await login('Bob');
  carol = await login('Alice'); // same name allowed, distinct player
  assert.notEqual(carol.playerId, alice.playerId);
  // reclaim by token
  const again = await api('POST', '/api/login', undefined, { token: alice.token });
  assert.equal(again.status, 200);
  assert.equal(again.body.playerId, alice.playerId);
  const me = await api('GET', '/api/me', alice.token);
  assert.equal(me.status, 200);
  assert.equal(me.body.name, 'Alice');
});

test('auth is required', async () => {
  assert.equal((await api('GET', '/api/me')).status, 401);
  assert.equal((await api('GET', '/api/matches')).status, 401);
  assert.equal((await api('POST', '/api/matches', undefined, { deck: DECK })).status, 401);
  assert.equal((await api('GET', '/api/me', 'f'.repeat(64))).status, 401);
  const r = await api('GET', '/api/me', 'nonsense');
  assert.equal(r.status, 401);
  assert.ok(r.body.error);
});

test('bad input is rejected', async () => {
  assert.equal((await api('POST', '/api/matches', alice.token, { deck: [] })).status, 400);
  assert.equal((await api('POST', '/api/matches', alice.token, { deck: 'x' })).status, 400);
  const bad = [{ ...DECK[0], chassis: 'nope' }];
  assert.equal((await api('POST', '/api/matches', alice.token, { deck: bad })).status, 400);
  const tooMany = Array.from({ length: 10 }, (_, i) => ({ ...DECK[0], id: 'x' + i }));
  assert.equal((await api('POST', '/api/matches', alice.token, { deck: tooMany })).status, 400);
  const big = await fetch(base + '/api/matches', {
    method: 'POST', headers: { Authorization: `Bearer ${alice.token}` }, body: 'x'.repeat(260 * 1024),
  }).catch(() => null);
  assert.ok(!big || big.status === 413);
  const badJson = await fetch(base + '/api/matches', { method: 'POST', headers: { Authorization: `Bearer ${alice.token}` }, body: '{' });
  assert.equal(badJson.status, 400);
  assert.equal((await api('GET', '/api/nope', alice.token)).status, 404);
});

test('create, list, join', async () => {
  const c = await api('POST', '/api/matches', alice.token, { deck: DECK });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  matchId = c.body.id;
  assert.equal(c.body.side, 0);
  assert.equal(c.body.match.status, 'waiting');

  const la = await api('GET', '/api/matches', alice.token);
  assert.equal(la.body.mine.length, 1);
  assert.equal(la.body.mine[0].status, 'waiting');
  assert.equal(la.body.mine[0].names[1], null);
  assert.equal(la.body.open.length, 0, 'own match is not in open list');
  const lb = await api('GET', '/api/matches', bob.token);
  assert.equal(lb.body.open.length, 1);
  assert.equal(lb.body.open[0].id, matchId);

  // can't deploy before the opponent joins; can't join own match
  assert.equal((await api('POST', `/api/matches/${matchId}/join`, alice.token, { deck: DECK })).status, 400);
  // bob can peek at the open lobby but gets no match state
  const peek = await api('GET', `/api/matches/${matchId}`, bob.token);
  assert.equal(peek.status, 200);
  assert.ok(peek.body.summary && !peek.body.match);

  const j = await api('POST', `/api/matches/${matchId}/join`, bob.token, { deck: DECK });
  assert.equal(j.status, 200, JSON.stringify(j.body));
  assert.equal(j.body.side, 1);
  assert.equal(j.body.match.status, 'deploy');
  assert.equal(j.body.match.round, 1);

  // third party can neither join nor view
  assert.equal((await api('POST', `/api/matches/${matchId}/join`, carol.token, { deck: DECK })).status, 409);
  assert.equal((await api('GET', `/api/matches/${matchId}`, carol.token)).status, 404);
  assert.equal((await api('POST', `/api/matches/${matchId}/deploy`, carol.token, { action: {} })).status, 404);

  const la2 = await api('GET', '/api/matches', alice.token);
  assert.equal(la2.body.mine[0].yourTurn, true);
  assert.deepEqual(la2.body.mine[0].names, ['Alice', 'Bob']);
});

test('deploy, redaction, polling and round resolution', async () => {
  const ga = await api('GET', `/api/matches/${matchId}`, alice.token);
  assert.equal(ga.status, 200);
  assert.equal(ga.body.side, 0);
  const m0: MatchState = ga.body.match;

  // invalid deploys
  assert.equal((await api('POST', `/api/matches/${matchId}/deploy`, alice.token, { action: { ...placeOne(m0, 0), round: 99 } })).status, 400);
  assert.equal((await api('POST', `/api/matches/${matchId}/deploy`, alice.token, { action: 'x' })).status, 400);
  const off = placeOne(m0, 0, 999);
  assert.equal((await api('POST', `/api/matches/${matchId}/deploy`, alice.token, { action: off })).status, 400);

  // bad block settings are rejected
  const withSettings = (extra: object): DeployAction => { const a = placeOne(m0, 0); a.place[0] = { ...a.place[0], ...extra }; return a; };
  for (const bad of [{ spacing: 9 }, { spacing: 1.5 }, { target: 'nope' }, { hold: 'yes' }, { kite: 1 }, { focus: 1 }, { retreat: 'x' }, { stance: 'sideways' }, { delay: 4 }, { delay: '3' }, { escort: 1.5 }, { escort: 'a' }, { escort: 424242 }, { kiteMount: -1 }, { kiteMount: 1.5 }, { kiteMount: 99 }]) {
    assert.equal((await api('POST', `/api/matches/${matchId}/deploy`, alice.token, { action: withSettings(bad) })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await api('POST', `/api/matches/${matchId}/deploy`, alice.token, { action: { ...placeOne(m0, 0), configure: [{ uid: 77, kite: true }] } })).status, 400, 'configure of unknown unit');

  const d1 = await api('POST', `/api/matches/${matchId}/deploy`, alice.token, { action: withSettings({ spacing: 1, target: 'lowestHp', hold: true, kite: true, focus: true, stance: 'flankLeft', delay: 6, retreat: true }) });
  assert.equal(d1.status, 200, JSON.stringify(d1.body));
  assert.equal(d1.body.match.players[0].ready, true);
  assert.equal(d1.body.match.players[0].board.length, 1);
  assert.deepEqual(
    { s: d1.body.match.players[0].board[0].spacing, t: d1.body.match.players[0].board[0].target, h: d1.body.match.players[0].board[0].hold, k: d1.body.match.players[0].board[0].kite },
    { s: 1, t: 'lowestHp', h: true, k: true }, 'spacing/target/hold/kite pass through the server');
  const placed0 = d1.body.match.players[0].board[0];
  assert.deepEqual([placed0.focus, placed0.stance, placed0.delay, placed0.retreat], [true, 'flankLeft', 6, true], 'new settings pass through');
  // double submit refused
  assert.equal((await api('POST', `/api/matches/${matchId}/deploy`, alice.token, { action: placeOne(m0, 0, 4) })).status, 409);

  // bob sees alice is ready but NOT her pending placement or supply
  const gb = await api('GET', `/api/matches/${matchId}`, bob.token);
  assert.equal(gb.body.side, 1);
  const mb: MatchState = gb.body.match;
  assert.equal(mb.players[0].ready, true);
  assert.equal(mb.players[0].board.length, 0, 'opponent pending placements hidden');
  assert.notEqual(mb.players[0].supply, d1.body.match.players[0].supply);
  const lb = await api('GET', '/api/matches', bob.token);
  assert.equal(lb.body.mine[0].yourTurn, true);
  assert.equal(lb.body.mine[0].opponentReady, true);

  // cheap polling
  const unchanged = await api('GET', `/api/matches/${matchId}?since=${mb.updatedAt}`, bob.token);
  assert.deepEqual(unchanged.body, { unchanged: true });
  const stale = await api('GET', `/api/matches/${matchId}?since=${mb.updatedAt - 1}`, bob.token);
  assert.ok(stale.body.match);

  const d2 = await api('POST', `/api/matches/${matchId}/deploy`, bob.token, { action: placeOne(mb, 1) });
  assert.equal(d2.status, 200, JSON.stringify(d2.body));
  const after: MatchState = d2.body.match;
  assert.equal(after.history.length, 1, 'round resolved');
  assert.equal(after.history[0].round, 1);
  assert.equal(after.history[0].boards[0].length, 1);
  assert.equal(after.history[0].boards[1].length, 1);
  assert.ok(after.status === 'deploy' || after.status === 'done');
  if (after.status === 'deploy') {
    assert.equal(after.round, 2);
    assert.equal(after.players[0].ready, false);
    assert.equal(after.players[1].ready, false);
    // resolved units are visible to both now, but their settings are not
    assert.equal(after.players[0].board.length, 1);
    assert.equal(after.players[0].board[0].spacing, 1);
    assert.equal(after.players[0].board[0].target, undefined);
    assert.equal(after.players[0].board[0].hold, undefined);
    assert.equal(after.players[0].board[0].kite, undefined);
    for (const k of ['focus', 'stance', 'delay', 'retreat', 'escort'] as const) assert.equal(after.players[0].board[0][k], undefined, k);
    assert.equal(after.history[0].boards[0][0].stance, 'flankLeft');
    // the history keeps the full settings for replay
    assert.equal(after.history[0].boards[0][0].target, 'lowestHp');
    // alice (owner) still sees her own, and may reconfigure them for free
    const ma: MatchState = (await api('GET', `/api/matches/${matchId}`, alice.token)).body.match;
    assert.equal(ma.players[0].board[0].target, 'lowestHp');
    const bad = await api('POST', `/api/matches/${matchId}/deploy`, alice.token, { action: { round: ma.round, place: [], upgrade: [], configure: [{ uid: ma.players[0].board[0].uid, escort: ma.players[0].board[0].uid }] } });
    assert.equal(bad.status, 400, 'can not escort itself');
    const badStance = await api('POST', `/api/matches/${matchId}/deploy`, alice.token, { action: { round: ma.round, place: [], upgrade: [], configure: [{ uid: ma.players[0].board[0].uid, stance: 'x' }] } });
    assert.equal(badStance.status, 400);
    const cfg = await api('POST', `/api/matches/${matchId}/deploy`, alice.token, { action: { round: ma.round, place: [], upgrade: [], configure: [{ uid: ma.players[0].board[0].uid, target: 'highestHp', kite: false }] } });
    assert.equal(cfg.status, 200, JSON.stringify(cfg.body));
    assert.equal(cfg.body.match.players[0].board[0].target, 'highestHp');
    assert.equal(cfg.body.match.players[0].board[0].kite, false);
  }
  const poll = await api('GET', `/api/matches/${matchId}?since=${mb.updatedAt}`, bob.token);
  assert.ok(poll.body.match, 'change visible to poller');
  assert.equal(poll.body.match.history.length, 1);
});

test('long poll: a waiting GET returns as soon as the opponent deploys', async () => {
  const a = await login('LongA');
  const b = await login('LongB');
  const id = (await api('POST', '/api/matches', a.token, { deck: DECK })).body.id;
  await api('POST', `/api/matches/${id}/join`, b.token, { deck: DECK });
  const ga = (await api('GET', `/api/matches/${id}`, a.token)).body;
  const gb = (await api('GET', `/api/matches/${id}`, b.token)).body;

  // nothing changes: the server holds the request for the wait, then answers unchanged
  let t0 = Date.now();
  const idle = await api('GET', `/api/matches/${id}?since=${ga.match.updatedAt}&wait=300`, a.token);
  assert.deepEqual(idle.body, { unchanged: true });
  assert.ok(Date.now() - t0 >= 250, 'held for the wait');

  // alice waits; bob's deploy wakes her immediately (long before the 15 s wait would end)
  t0 = Date.now();
  const pending = api('GET', `/api/matches/${id}?since=${ga.match.updatedAt}&wait=15000`, a.token);
  await new Promise((r) => setTimeout(r, 50));
  const db = await api('POST', `/api/matches/${id}/deploy`, b.token, { action: placeOne(gb.match, 1) });
  assert.equal(db.status, 200);
  const woke = await pending;
  assert.equal(woke.status, 200);
  assert.equal(woke.body.match.players[1].ready, true);
  assert.ok(Date.now() - t0 < 5000, 'woken by the deploy');

  // both ready: the poll is woken by the resolved round
  const pending2 = api('GET', `/api/matches/${id}?since=${db.body.match.updatedAt}&wait=15000`, b.token);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await api('POST', `/api/matches/${id}/deploy`, a.token, { action: placeOne(ga.match, 0) })).status, 200);
  const resolved = await pending2;
  assert.equal(resolved.body.match.round, 2);
  assert.equal(resolved.body.match.history.length, 1);
});

test('long poll: a client copy newer than the server (writes lost in a crash) gets the full state, not a hang', async () => {
  const a = alice;
  const b = carol;
  const id = (await api('POST', '/api/matches', a.token, { deck: DECK })).body.id;
  await api('POST', `/api/matches/${id}/join`, b.token, { deck: DECK });
  const ga = (await api('GET', `/api/matches/${id}`, a.token)).body;
  // alice's deploy was acknowledged, then the server crashed before its debounced save: it restarts on the older state
  const before = structuredClone(srv.store.matches.get(id)!.match);
  const da = await api('POST', `/api/matches/${id}/deploy`, a.token, { action: placeOne(ga.match, 0) });
  assert.equal(da.status, 200);
  srv.store.matches.get(id)!.match = before;
  const t0 = Date.now();
  const r = await api('GET', `/api/matches/${id}?since=${da.body.match.updatedAt}&wait=5000`, a.token);
  assert.equal(r.status, 200);
  assert.ok(r.body.match, 'full state returned');
  assert.equal(r.body.match.players[0].ready, false, 'alice sees she must deploy again');
  assert.ok(Date.now() - t0 < 2000, 'not held');
});

test('private matches and join codes', async () => {
  const c = await api('POST', '/api/matches', carol.token, { deck: DECK, private: true });
  assert.equal(c.status, 200);
  assert.match(c.body.code, /^[A-Z2-9]{6}$/);
  const lb = await api('GET', '/api/matches', bob.token);
  assert.ok(!lb.body.open.some((s: any) => s.id === c.body.id), 'private hidden from open list');
  assert.equal((await api('GET', `/api/matches/${c.body.id}`, bob.token)).status, 404);
  const lc = await api('GET', '/api/matches', carol.token);
  assert.equal(lc.body.mine.find((s: any) => s.id === c.body.id).code, c.body.code);
  const j = await api('POST', `/api/matches/${c.body.code.toLowerCase()}/join`, bob.token, { deck: DECK });
  assert.equal(j.status, 200, JSON.stringify(j.body));
  assert.equal(j.body.id, c.body.id);
  // forfeit
  const f = await api('POST', `/api/matches/${c.body.id}/forfeit`, bob.token);
  assert.equal(f.status, 200);
  assert.equal(f.body.match.status, 'done');
  assert.equal(f.body.match.winner, 0);
  assert.equal((await api('POST', `/api/matches/${c.body.id}/forfeit`, bob.token)).status, 409);
});

test('quick match joins oldest open match, else creates', async () => {
  const a = await api('POST', '/api/matches/quick', alice.token, { deck: DECK });
  assert.equal(a.status, 200);
  assert.equal(a.body.joined, false);
  const b = await api('POST', '/api/matches/quick', bob.token, { deck: DECK });
  assert.equal(b.body.joined, true);
  assert.equal(b.body.id, a.body.id);
  // cancel a waiting match
  const w = await api('POST', '/api/matches', alice.token, { deck: DECK });
  const cancel = await api('POST', `/api/matches/${w.body.id}/forfeit`, alice.token);
  assert.equal(cancel.body.cancelled, true);
  assert.equal((await api('GET', `/api/matches/${w.body.id}`, alice.token)).status, 404);
});

test('active match cap', async () => {
  const p = await login('Spammer');
  let last = 0;
  for (let i = 0; i < 21; i++) last = (await api('POST', '/api/matches', p.token, { deck: DECK })).status;
  assert.equal(last, 409);
});

test('stale turns auto-forfeit', async () => {
  const c = await api('POST', '/api/matches', alice.token, { deck: DECK });
  const j = await api('POST', `/api/matches/${c.body.id}/join`, bob.token, { deck: DECK });
  await api('POST', `/api/matches/${c.body.id}/deploy`, bob.token, { action: placeOne(j.body.match, 1) });
  srv.api.sweepStale(Date.now() + 8 * 24 * 3600 * 1000);
  const g = await api('GET', `/api/matches/${c.body.id}`, alice.token);
  assert.equal(g.body.match.status, 'done');
  assert.equal(g.body.match.winner, 1);
});

test('garage: designs + deck stored per player, revs detect another session, rename keeps the account', async () => {
  const g = carol; // (a fresh login would trip the per-IP login limit in this file)
  assert.equal((await api('GET', '/api/garage')).status, 401);
  assert.equal((await api('GET', '/api/garage', g.token)).body.garage, null);
  const illegal = { id: 'd-bad', name: 'Bad', chassis: 'scout', mobility: 'wheels', mounts: ['nosuchgun'] };
  const put = await api('POST', '/api/garage', g.token, { designs: [...DECK, illegal, DECK[0]], deck: ['d-lance', 'd-bad', 'nope'], baseRev: 0 });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepEqual(put.body, { ok: true, rev: 1, kept: 2 });
  const got = (await api('GET', '/api/garage', g.token)).body.garage;
  assert.deepEqual(got.designs.map((d: Design) => d.id), ['d-buzz', 'd-lance']);
  assert.deepEqual(got.deck, ['d-lance']);
  // a write based on an old rev is refused with the server copy to merge
  const stale = await api('POST', '/api/garage', g.token, { designs: [DECK[0]], deck: [], baseRev: 0 });
  assert.equal(stale.body.ok, false);
  assert.equal(stale.body.conflict.rev, 1);
  assert.equal((await api('POST', '/api/garage', g.token, { designs: [DECK[0]], deck: ['d-buzz'], baseRev: 1 })).body.rev, 2);
  // malformed designs are a 400, other players never see this garage
  assert.equal((await api('POST', '/api/garage', g.token, { designs: [{ id: 5 }], deck: [], baseRev: 2 })).status, 400);
  assert.equal((await api('GET', '/api/garage', alice.token)).body.garage?.rev ?? null, null);
  // logging in with the token and a new callsign renames the same account
  const renamed = await api('POST', '/api/login', undefined, { name: 'Carol B', token: g.token });
  assert.equal(renamed.body.playerId, g.playerId);
  assert.equal(renamed.body.name, 'Carol B');
  garageToken = g.token;
});

let garageToken = '';

test('persistence survives restart', async () => {
  const before = await api('GET', `/api/matches/${matchId}`, alice.token);
  await srv.close();
  const files = fs.readdirSync(dataDir);
  assert.ok(files.includes('players.json') && files.includes('matches.json'));
  assert.ok(!files.some((f) => f.endsWith('.tmp')));
  assert.ok(!fs.readFileSync(path.join(dataDir, 'players.json'), 'utf8').includes(alice.token), 'raw tokens not stored');
  await startOn(dataDir);
  const me = await api('GET', '/api/me', alice.token);
  assert.equal(me.status, 200);
  assert.equal(me.body.playerId, alice.playerId);
  const afterRes = await api('GET', `/api/matches/${matchId}`, alice.token);
  assert.deepEqual(afterRes.body.match, before.body.match);
  const garage = (await api('GET', '/api/garage', garageToken)).body.garage;
  assert.equal(garage.rev, 2);
  assert.deepEqual(garage.designs.map((d: Design) => d.id), ['d-buzz']);
});

test('static files: index, MIME types, traversal blocked', async () => {
  const idx = await fetch(base + '/');
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get('content-type')!, /text\/html/);
  assert.equal((await fetch(base + '/a.mp3')).headers.get('content-type'), 'audio/mpeg');
  assert.equal((await fetch(base + '/f.woff2')).headers.get('content-type'), 'font/woff2');
  assert.equal((await fetch(base + '/missing.js')).status, 404);
  const rel = path.relative(publicDir, path.join(dataDir, 'secret.txt')).split(path.sep).join('/');
  for (const p of [`/../${rel}`, `/%2e%2e/${rel}`, `/..%2f${rel.replace(/\//g, '%2f')}`, '/%2e%2e%2f%2e%2e%2fetc%2fpasswd', '/..\\..\\etc\\passwd', '/.hidden']) {
    const r = await rawGet(p);
    assert.ok(r.status === 400 || r.status === 404, `${p} -> ${r.status}`);
    assert.ok(!r.body.includes('top secret'));
  }
  assert.equal(resolveStatic('/srv/pub', '/../etc/passwd'), null);
  assert.equal(resolveStatic('/srv/pub', '/%2e%2e/etc/passwd'), null);
  assert.equal(resolveStatic('/srv/pub', '/a/b.js'), path.resolve('/srv/pub/a/b.js'));
});

test('TRUST_PROXY: rate limits key on the proxy-appended (last) X-Forwarded-For entry, not a spoofable first one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab2-xff-'));
  const s2 = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, publicDir, saveDebounceMs: 10, trustProxy: true, loginRateLimit: 6 });
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await fetch(`http://127.0.0.1:${s2.port}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.0.${i}, 203.0.113.7` },
        body: JSON.stringify({ name: `spoof${i}` }),
      });
      await r.text();
      statuses.push(r.status);
    }
    assert.ok(statuses.includes(429), `spoofed first XFF entry must not reset the login limit: ${statuses}`);
  } finally {
    await s2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('random (unknown) bearer tokens share the IP rate-limit bucket', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab2-rl-'));
  const s2 = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, publicDir, saveDebounceMs: 10, rateLimit: 40 });
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) {
      const tok = (i.toString(16).padStart(2, '0')).repeat(32);
      const r = await fetch(`http://127.0.0.1:${s2.port}/api/me`, { headers: { Authorization: `Bearer ${tok}` } });
      await r.text();
      statuses.push(r.status);
    }
    assert.ok(statuses.includes(429), `fresh fake tokens must not each get a new bucket: ${statuses}`);
  } finally {
    await s2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('accounts: register, sign in again from a new device, wrong password, unique names, legacy claim, sign out', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab2-acct-'));
  // players.json from before passwords: two passwordless "Dana"s (most recent one gets claimed), an old placeholder
  const sha = (x: string) => crypto.createHash('sha256').update(x).digest('hex');
  const oldToken = (id: string) => sha('tok:' + id);
  const old = (id: string, name: string, lastSeen: number, garageIds: string[]) => ({
    id, name, tokenHash: sha(oldToken(id)), createdAt: 1, lastSeen,
    garage: { designs: DECK.filter((d) => garageIds.includes(d.id)), deck: garageIds, rev: 3, updatedAt: lastSeen },
  });
  fs.writeFileSync(path.join(dir, 'players.json'), JSON.stringify({ version: 1, players: [
    old('p_dana_old', 'Dana', 1000, ['d-buzz']), old('p_dana_new', 'Dana', 5000, ['d-lance']), old('p_pilot', 'Pilot 1234', 9000, []),
  ] }));
  const opts = { port: 0, host: '127.0.0.1', dataDir: dir, publicDir, saveDebounceMs: 10, loginRateLimit: 600 };
  let s2 = await startServer(opts);
  const call = async (method: string, url: string, token?: string, body?: unknown): Promise<Res> => {
    const r = await fetch(`http://127.0.0.1:${s2.port}${url}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
  const signIn = (name: string, password: string, token?: string) => call('POST', '/api/login', undefined, { name, password, ...(token ? { token } : {}) });
  try {
    // a guest placeholder with a garage; registering "Alice" upgrades that same account (garage kept)
    const guest = (await call('POST', '/api/login', undefined, { name: 'Pilot 4321' })).body;
    assert.equal(guest.registered, false);
    assert.equal((await call('POST', '/api/garage', guest.token, { designs: DECK, deck: ['d-buzz'], baseRev: 0 })).status, 200);
    const reg = await signIn('Alice', 'hunter22', guest.token);
    assert.equal(reg.status, 200, JSON.stringify(reg.body));
    assert.equal(reg.body.status, 'registered');
    assert.equal(reg.body.playerId, guest.playerId);
    assert.equal(reg.body.registered, true);
    assert.match(reg.body.token, /^[0-9a-f]{64}$/);
    // "new device": no token, same username (any case) + password -> same account and garage, a different token
    const dev2 = await signIn('alice', 'hunter22');
    assert.equal(dev2.status, 200, JSON.stringify(dev2.body));
    assert.equal(dev2.body.status, 'signed-in');
    assert.equal(dev2.body.playerId, guest.playerId);
    assert.equal(dev2.body.name, 'Alice');
    assert.notEqual(dev2.body.token, reg.body.token);
    const g = (await call('GET', '/api/garage', dev2.body.token)).body.garage;
    assert.deepEqual(g.designs.map((d: Design) => d.id), ['d-buzz', 'd-lance']);
    assert.deepEqual(g.deck, ['d-buzz']);
    // both devices' sessions stay valid
    assert.equal((await call('GET', '/api/me', reg.body.token)).body.playerId, guest.playerId);
    assert.equal((await call('GET', '/api/me', dev2.body.token)).body.registered, true);
    // wrong password: 401 with a clear message
    const wrong = await signIn('ALICE', 'nope1234');
    assert.equal(wrong.status, 401);
    assert.match(wrong.body.error, /wrong password/i);
    // too-short password; a different-case name can't register a second "Bob"
    assert.equal((await signIn('Bob', 'abc')).status, 400);
    const bob = await signIn('Bob', 'abcd');
    assert.equal(bob.body.status, 'registered');
    assert.notEqual(bob.body.playerId, guest.playerId);
    assert.equal((await signIn('bOB', 'abce')).status, 401);
    assert.equal((await signIn('bOB', 'abcd')).body.playerId, bob.body.playerId);
    // a registered account can't be renamed onto another registered name
    assert.equal((await call('POST', '/api/login', undefined, { name: 'Bob', token: reg.body.token })).status, 409);
    // legacy passwordless "Dana": the most recently seen one is claimed (its garage kept), the other left alone
    const dana = await signIn('Dana', 'secret');
    assert.equal(dana.body.status, 'claimed');
    assert.equal(dana.body.playerId, 'p_dana_new');
    assert.deepEqual((await call('GET', '/api/garage', dana.body.token)).body.garage.deck, ['d-lance']);
    assert.equal((await call('GET', '/api/me', oldToken('p_dana_new'))).body.playerId, 'p_dana_new', 'its old token still works');
    assert.equal((await call('GET', '/api/me', oldToken('p_dana_old'))).body.registered, false);
    assert.equal((await signIn('Dana', 'other')).status, 401);
    // an old placeholder name is not claimable: a new account
    const pilot = await signIn('Pilot 1234', 'pppp');
    assert.equal(pilot.body.status, 'registered');
    assert.notEqual(pilot.body.playerId, 'p_pilot');
    // change password; sign out ends only that device's session
    assert.equal((await call('POST', '/api/password', dev2.body.token, { password: 'bad', newPassword: 'newpass' })).status, 401);
    assert.equal((await call('POST', '/api/password', dev2.body.token, { password: 'hunter22', newPassword: 'newpass' })).status, 200);
    assert.equal((await signIn('Alice', 'hunter22')).status, 401);
    assert.equal((await signIn('Alice', 'newpass')).status, 200);
    assert.equal((await call('POST', '/api/logout', dev2.body.token)).status, 200);
    assert.equal((await call('GET', '/api/me', dev2.body.token)).status, 401);
    assert.equal((await call('GET', '/api/me', reg.body.token)).status, 200);
    // passwords and raw tokens are never written; the name index survives a restart
    await s2.close();
    const raw = fs.readFileSync(path.join(dir, 'players.json'), 'utf8');
    assert.ok(!raw.includes('hunter22') && !raw.includes('newpass') && !raw.includes(reg.body.token));
    s2 = await startServer(opts);
    assert.equal((await signIn('alice', 'nope')).status, 401);
    assert.equal((await signIn('alice', 'newpass')).body.playerId, guest.playerId);
    assert.equal((await call('GET', '/api/me', reg.body.token)).body.playerId, guest.playerId);
  } finally {
    await s2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
