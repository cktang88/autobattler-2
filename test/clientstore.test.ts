// Client persistence: saved designs and settings from older builds (or hand-edited storage) load instead of breaking
// the UI or silently disappearing (src/client/collection.ts, src/client/storage.ts).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
};

const { allDesigns, activeDeck, repairDesign } = await import('../src/client/collection.ts');
const { defaultSettings, loadSettings } = await import('../src/client/storage.ts');
const { validateDesign, computeStats, MAX_LOAD } = await import('../src/shared/stats.ts');
const { CHASSIS, CHASSIS_BY_ID, MODULES } = await import('../src/shared/parts.ts');
const { slotError } = await import('../src/shared/stats.ts');
const { firstLegalMobility } = await import('../src/client/ui/garage-fit.ts');
type Design = import('../src/shared/types.ts').Design;
const { STARTER_DESIGNS } = await import('../src/shared/starters.ts');

beforeEach(() => mem.clear());

const mine = (over: Record<string, unknown> = {}) => ({ ...structuredClone(STARTER_DESIGNS.find((d) => d.id === 'starter-ironclad')!), id: 'd-mine', name: 'My Tank', editedAt: 5, ...over });

test('a valid saved design loads unchanged', () => {
  mem.set('ab2.designs', JSON.stringify([mine()]));
  const d = allDesigns().find((x) => x.id === 'd-mine');
  assert.ok(d);
  assert.deepEqual(d!.mounts, mine().mounts);
});

test('designs made illegal by a rules change are repaired, not deleted', () => {
  const base = mine();
  const c = CHASSIS_BY_ID.get(base.chassis)!;
  const cases: Record<string, unknown>[] = [
    { mounts: [...base.mounts, 'laser'] },                       // socket count shrank
    { mounts: base.mounts.slice(0, -1) },                        // socket count grew
    { mounts: base.mounts.map((m, i) => (i === 1 ? 'retired-part' : m)) }, // part removed from the game
    { mobility: 'no-such-drive' },                               // drive removed / no longer pairs
    { name: '   A name far longer than twenty-four chars   ' }, // name rules
    { mounts: [...base.mounts].reverse() },                      // parts in sockets that no longer take them
  ];
  for (const over of cases) {
    mem.clear();
    mem.set('ab2.designs', JSON.stringify([mine(over)]));
    mem.set('ab2.deck', JSON.stringify(['d-mine']));
    const d = allDesigns().find((x) => x.id === 'd-mine');
    assert.ok(d, `kept: ${JSON.stringify(over)}`);
    assert.deepEqual(validateDesign(d!), [], `legal: ${JSON.stringify(over)}`);
    assert.equal(d!.mounts.length, c.mounts.length);
    assert.equal(d!.editedAt, 5);
    assert.ok(d!.name.length <= 24 && d!.name.length > 0);
    assert.deepEqual(activeDeck().map((x) => x.id), ['d-mine'], 'still in the deck');
    // and the repair is persisted, so the next read is a plain load
    assert.deepEqual(JSON.parse(mem.get('ab2.designs')!).find((x: { id: string }) => x.id === 'd-mine'), d);
  }
});

test('an overloaded design sheds its heaviest parts until it is legal', () => {
  // find a hull + drive whose heaviest legal parts overload it
  let over: Design | null = null;
  for (const c of CHASSIS) {
    const mobility = firstLegalMobility(c.id);
    const mounts = c.mounts.map((_, i) => MODULES.filter((m) => !slotError(c, mobility, i, m)).sort((a, b) => b.weight - a.weight)[0]?.id ?? null);
    const d: Design = { id: 'd-heavy', name: 'Heavy', chassis: c.id, mobility, mounts };
    try { if (computeStats(d).load > MAX_LOAD && mounts.some((id) => id && MODULES.find((m) => m.id === id)!.kind === 'weapon')) { over = d; break; } } catch { /* unpriceable */ }
  }
  assert.ok(over, 'some loadout overloads its hull');
  const d = repairDesign(over);
  assert.ok(d);
  assert.deepEqual(validateDesign(d!), []);
  assert.ok(computeStats(d!).load <= MAX_LOAD);
  assert.ok(d!.mounts.filter(Boolean).length < over!.mounts.filter(Boolean).length);
});

test('entries that are not designs at all are still dropped', () => {
  for (const bad of [null, 7, 'x', [], { id: 'a' }, { id: 'a', name: 'A', chassis: 'nope', mobility: 'treads', mounts: [] }, { name: 'no id', chassis: 'raider', mobility: 'treads', mounts: [] }]) {
    assert.equal(repairDesign(bad), null, JSON.stringify(bad));
  }
  mem.set('ab2.designs', JSON.stringify([null, 'junk', mine()]));
  assert.deepEqual(allDesigns().map((d) => d.id), ['d-mine']);
});

test('settings from older builds or corrupt storage fall back per field', () => {
  assert.deepEqual(loadSettings(), defaultSettings);
  for (const raw of ['null', '[]', '"x"', '7', '{bad json']) {
    mem.set('ab2.settings', raw);
    assert.deepEqual(loadSettings(), defaultSettings, raw);
  }
  // an early build: only volumes + speed, some of the wrong type
  mem.set('ab2.settings', JSON.stringify({ master: '0.3', music: 0.2, sfx: 7, battleSpeed: 3, shake: null, renderer: 'webgpu', tilt: 'no' }));
  const s = loadSettings();
  assert.equal(s.master, defaultSettings.master);
  assert.equal(s.music, 0.2);
  assert.equal(s.sfx, 1);
  assert.equal(s.battleSpeed, 1);
  assert.equal(s.shake, defaultSettings.shake);
  assert.equal(s.tilt, true);
  assert.equal(s.renderer, defaultSettings.renderer);
  // a renderer the player picked is kept; one stored by an older default is not
  mem.set('ab2.settings', JSON.stringify({ renderer: '2d', rendererChosen: true, shadows: false, battleSpeed: 0.5 }));
  assert.equal(loadSettings().renderer, '2d');
  assert.equal(loadSettings().shadows, false);
  assert.equal(loadSettings().battleSpeed, 0.5);
  mem.set('ab2.settings', JSON.stringify({ renderer: '2d' }));
  assert.equal(loadSettings().renderer, '3d');
});
