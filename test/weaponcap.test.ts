// The weapon cap: light, medium and heavy hulls carry at most 2 weapons, giants 3, titans 4; the other sockets take
// utilities, armour and shields. Validation, repair of saved designs, AI designs and the rules-7 migration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHASSIS, CHASSIS_BY_ID, MODULE_BY_ID, maxWeaponsFor, weaponCap } from '../src/shared/parts.ts';
import { dropExtraWeapons, validateDesign, weaponCount, weaponValue } from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { AI_POOL, sanitizeEntry } from '../src/shared/aipool.ts';
import { aiDeck } from '../src/shared/ai.ts';
import { repairDesign } from '../src/client/collection.ts';
import { capDeckWeapons, migrateMatch, newMatch, newPlayer } from '../src/shared/match.ts';
import type { Design } from '../src/shared/types.ts';

const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id, chassis, mobility, mounts });

test('weapon cap by hull size: 2 up to heavy hulls, 3 on giants, 4 on titans', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(maxWeaponsFor), [2, 2, 2, 3, 4]);
  for (const c of CHASSIS) assert.equal(weaponCap(c), c.maxWeapons ?? maxWeaponsFor(c.size), c.id);
  assert.equal(weaponCap({ size: 2, maxWeapons: 3 }), 3, 'a hull may deviate');
});

test('validation rejects more weapons than the cap with a clear message; utilities do not count', () => {
  const three = D('three', 'striker', 'halftrack', ['minigun', 'twin30', 'shotgun']);
  const errs = validateDesign(three);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /^Too many weapons: 3\/2\. This hull carries at most 2 weapons; use the other sockets for utilities\.$/);
  assert.deepEqual(validateDesign(D('two', 'striker', 'halftrack', ['minigun', 'twin30', 'shieldL'])), []);
  // repair beams are utilities, so a two-gun hull may still carry one
  assert.equal(MODULE_BY_ID.get('repair')!.kind, 'utility');
  assert.deepEqual(validateDesign(D('medic', 'striker', 'halftrack', ['minigun', 'twin30', 'repair'])), []);
  // giants carry 3, titans 4
  assert.deepEqual(validateDesign(D('g3', 'goliath', 'megatracks', ['avenger', 'cannon', 'cannon', 'plateM'])), []);
  assert.match(validateDesign(D('g4', 'goliath', 'megatracks', ['avenger', 'cannon', 'cannon', 'autocannon'])).join(), /Too many weapons: 4\/3/);
  assert.deepEqual(validateDesign(D('t4', 'titan', 'megatracks', ['annihilator', 'siegeplasma', 'cannon', 'cannon', 'plateM'])), []);
  assert.match(validateDesign(D('t5', 'titan', 'megatracks', ['annihilator', 'siegeplasma', 'cannon', 'cannon', 'autocannon'])).join(), /Too many weapons: 5\/4/);
});

test('dropExtraWeapons keeps the most valuable weapons and frees the rest', () => {
  const d = D('x', 'striker', 'halftrack', ['minigun', 'twin30', 'shotgun']);
  const vals = ['minigun', 'twin30', 'shotgun'].map((id) => [id, weaponValue(MODULE_BY_ID.get(id)!)] as const).sort((a, b) => a[1] - b[1]);
  assert.deepEqual(dropExtraWeapons(d), [vals[0][0]]);
  assert.equal(weaponCount(d), 2);
  assert.deepEqual(validateDesign(d), []);
  assert.deepEqual(dropExtraWeapons(d), [], 'idempotent');
});

test('saved designs over the cap are repaired, not dropped (UI-independent repair)', () => {
  const raw = { id: 'mine', name: 'Old Thunderbird', chassis: 'strategic', mobility: 'jet', mounts: ['bombs', 'bombs', 'heavybomb', 'bombs', 'hmg', 'hmg'] };
  const r = repairDesign(raw)!;
  assert.ok(r, 'kept');
  assert.equal(weaponCount(r), weaponCap(CHASSIS_BY_ID.get('strategic')!));
  assert.deepEqual(validateDesign(r), []);
  assert.equal(r.name, 'Old Thunderbird');
});

test('starters, the AI pool and generated AI decks respect the cap', () => {
  for (const d of [...STARTER_DESIGNS, ...AI_POOL]) {
    assert.ok(weaponCount(d) <= weaponCap(CHASSIS_BY_ID.get(d.chassis)!), d.id);
    assert.deepEqual(validateDesign(d), [], d.id);
  }
  for (let s = 1; s <= 12; s++) for (const diff of ['easy', 'normal', 'hard'] as const) {
    for (const d of aiDeck(s, diff)) assert.ok(weaponCount(d) <= weaponCap(CHASSIS_BY_ID.get(d.chassis)!), `${d.id} (${s}/${diff})`);
  }
  // a stored pool entry from before the cap is repaired rather than dropped
  const e = sanitizeEntry({ design: { id: 'old', name: 'Old Disc', chassis: 'saucer', mobility: 'hover', mounts: ['flak', 'flak', 'hmg'] }, score: 1.2, games: 3 });
  assert.ok(e, 'kept');
  assert.equal(weaponCount(e!.design), 2);
});

test('rules 7: a match deck over the cap is capped and its blocks re-checked', () => {
  const over = D('over', 'striker', 'halftrack', ['minigun', 'twin30', 'shotgun']);
  const ok = STARTER_DESIGNS.find((d) => d.id === 'starter-bulwark')!;
  const m = newMatch('c', 'ai', 1, newPlayer('A', [ok]), newPlayer('B', [ok], true), 0);
  m.players[0].deck = [{ ...over, mounts: [...over.mounts] }, ok];
  m.players[0].board = [{ uid: 1, designId: 'over', x: 4, y: 2, level: 1, round: 1 }, { uid: 2, designId: ok.id, x: 30, y: 2, level: 1, round: 1 }];
  m.rules = 6; m.status = 'deploy'; m.round = 2;
  assert.equal(migrateMatch(m), true);
  const d = m.players[0].deck[0];
  assert.equal(weaponCount(d), 2);
  assert.deepEqual(validateDesign(d), []);
  const keep = m.players[0].board.find((u) => u.uid === 2)!;
  assert.deepEqual([keep.x, keep.y], [30, 2]);
  assert.deepEqual([...capDeckWeapons(m.players[0])], [], 'nothing left over the cap');
});
