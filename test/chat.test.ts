// In-match chat (src/server/chat.ts via the API): only the two players may post / read, text is validated and
// cleaned, posts are rate-limited, history is capped, and a since-id long poll returns as soon as a line arrives.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type RunningServer } from '../src/server/main.ts';
import { CHAT_BURST, CHAT_MAX_LEN, MAX_CHAT_HISTORY, sanitizeChatText } from '../src/server/chat.ts';
import type { Design } from '../src/shared/types.ts';

const DECK: Design[] = [
  { id: 'd-buzz', name: 'Buzzsaw', chassis: 'scout', mobility: 'wheels', mounts: ['mg'] },
  { id: 'd-lance', name: 'Lancer', chassis: 'raider', mobility: 'legs', mounts: ['laser', 'laser'] },
];

let dataDir: string;
let publicDir: string;
let srv: RunningServer;
let base: string;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab2-chat-data-'));
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab2-chat-pub-'));
  srv = await startServer({ port: 0, host: '127.0.0.1', dataDir, publicDir, saveDebounceMs: 10 });
  base = `http://127.0.0.1:${srv.port}`;
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
async function login(name: string): Promise<string> {
  const r = await api('POST', '/api/login', undefined, { name });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}
/** a fresh two-player match: [matchId, token side 0, token side 1] */
async function pair(tag: string): Promise<[string, string, string]> {
  const a = await login(`A ${tag}`), b = await login(`B ${tag}`);
  const c = await api('POST', '/api/matches', a, { deck: DECK, private: true });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const j = await api('POST', `/api/matches/${c.body.id}/join`, b, { deck: DECK });
  assert.equal(j.status, 200, JSON.stringify(j.body));
  return [c.body.id, a, b];
}
const say = (id: string, tok: string | undefined, text: unknown) => api('POST', `/api/matches/${id}/chat`, tok, { text });

test('sanitizeChatText: trims, strips control / bidi characters, enforces length', () => {
  assert.equal(sanitizeChatText('  hurry   up!  '), 'hurry up!');
  assert.equal(sanitizeChatText('a\nb\tc'), 'a b c');
  assert.equal(sanitizeChatText('x\u0000\u0007y\u202Ez\u200B'), 'xyz');
  assert.equal(sanitizeChatText('👩\u200D🚀 gg'), '👩\u200D🚀 gg', 'emoji ZWJ sequences survive');
  assert.equal(sanitizeChatText('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>', 'kept as text: the client renders with textContent');
  assert.equal(sanitizeChatText('é'.repeat(CHAT_MAX_LEN)).length, CHAT_MAX_LEN);
  for (const bad of [undefined, null, 42, {}, ['x'], '', '   ', '\u0000\u0001', 'x'.repeat(CHAT_MAX_LEN + 1)]) {
    assert.throws(() => sanitizeChatText(bad), (e: any) => e.status === 400, JSON.stringify(bad));
  }
});

test('chat: participants post and read; outsiders and anonymous callers cannot', async () => {
  const [id, a, b] = await pair('auth');
  const outsider = await login('Lurker');

  const p = await say(id, a, '  hurry up!  ');
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.msg.text, 'hurry up!');
  assert.equal(p.body.msg.side, 0);
  const q = await say(id, b, 'gg');
  assert.equal(q.status, 200);
  assert.equal(q.body.msg.side, 1);
  assert.ok(q.body.msg.id > p.body.msg.id);

  for (const tok of [a, b]) {
    const r = await api('GET', `/api/matches/${id}/chat`, tok);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.msgs.map((m: any) => [m.side, m.text]), [[0, 'hurry up!'], [1, 'gg']]);
    assert.equal(r.body.last, q.body.msg.id);
  }
  const since = await api('GET', `/api/matches/${id}/chat?since=${p.body.msg.id}`, a);
  assert.deepEqual(since.body.msgs.map((m: any) => m.text), ['gg']);

  assert.equal((await say(id, outsider, 'hi')).status, 404);
  assert.equal((await api('GET', `/api/matches/${id}/chat`, outsider)).status, 404);
  assert.equal((await say(id, undefined, 'hi')).status, 401);
  assert.equal((await api('GET', `/api/matches/${id}/chat`)).status, 401);
  assert.equal((await say('m_nope', a, 'hi')).status, 404);

  // a waiting match (no opponent yet) has nobody to talk to
  const c = await api('POST', '/api/matches', outsider, { deck: DECK, private: true });
  assert.equal((await say(c.body.id, outsider, 'anyone?')).status, 409);
});

test('chat: invalid messages are rejected', async () => {
  const [id, a] = await pair('valid');
  for (const text of [undefined, 7, '', '    ', '\u0001\u0002', 'x'.repeat(CHAT_MAX_LEN + 1)]) {
    const r = await say(id, a, text);
    assert.equal(r.status, 400, `${JSON.stringify(text)} → ${JSON.stringify(r.body)}`);
  }
  const notObj = await api('POST', `/api/matches/${id}/chat`, a, ['hi']);
  assert.equal(notObj.status, 400);
  assert.equal((await api('GET', `/api/matches/${id}/chat`, a)).body.msgs.length, 0, 'nothing stored');
});

test('chat: posts are rate-limited per player, history is capped', async () => {
  const [id, a, b] = await pair('rate');
  let ok = 0, limited = 0;
  for (let i = 0; i < CHAT_BURST + 3; i++) {
    const r = await say(id, a, `spam ${i}`);
    if (r.status === 200) ok++;
    else { assert.equal(r.status, 429); limited++; }
  }
  assert.ok(ok >= CHAT_BURST && ok <= CHAT_BURST + 1, `ok=${ok}`);
  assert.ok(limited >= 2, `limited=${limited}`);
  // the opponent has a bucket of their own
  assert.equal((await say(id, b, 'calm down')).status, 200);

  // history cap: fill the channel directly through the hub (no rate limit wait)
  for (let i = 0; i < MAX_CHAT_HISTORY + 10; i++) srv.api.chat.post(id, `p_fill${i}`, 1, `line ${i}`);
  const all = await api('GET', `/api/matches/${id}/chat`, a);
  assert.equal(all.body.msgs.length, MAX_CHAT_HISTORY);
  assert.equal(all.body.msgs.at(-1).text, `line ${MAX_CHAT_HISTORY + 9}`);
});

test('chat: a since-id long poll returns as soon as the opponent says something', async () => {
  const [id, a, b] = await pair('poll');
  const first = await api('GET', `/api/matches/${id}/chat`, a);
  const t0 = Date.now();
  const pending = api('GET', `/api/matches/${id}/chat?since=${first.body.last}&wait=10000`, a);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal((await say(id, b, 'your move')).status, 200);
  const r = await pending;
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.msgs.map((m: any) => m.text), ['your move']);
  assert.ok(Date.now() - t0 < 5000, 'returned early');
  // nothing new: the poll holds for its wait and comes back empty
  const empty = await api('GET', `/api/matches/${id}/chat?since=${r.body.last}&wait=200`, a);
  assert.deepEqual(empty.body.msgs, []);
  assert.equal(empty.body.last, r.body.last);
});
