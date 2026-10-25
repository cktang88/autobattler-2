// Smart deployment (the balance tooling's "sensible player" layout): roles and the front-to-back order of the lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { deployRole, isChaffClear, smartDeploy } from '../src/shared/smartdeploy.ts';
import { MODULE_BY_ID } from '../src/shared/parts.ts';
import { computeStats } from '../src/shared/stats.ts';
import { blockInZone, blocksOverlap } from '../src/shared/grid.ts';
import type { Design } from '../src/shared/types.ts';

const S = (id: string) => STARTER_DESIGNS.find((d) => d.id === `starter-${id}`)!;

test('deploy roles of the starters', () => {
  const role = (id: string) => deployRole(S(id));
  assert.equal(role('buzzsaw'), 'chaff');
  assert.equal(role('bulwark'), 'armor');
  assert.equal(role('ripper'), 'melee');
  assert.equal(role('hornet'), 'air');
  assert.equal(role('medic'), 'support');
  assert.equal(role('firestorm'), 'artillery');
  // a railgun beside a cannon on a heavy hull is a brawler, not back-row artillery
  assert.equal(role('behemoth'), 'armor');
  // flak clears aircraft, not ground chaff
  assert.equal(isChaffClear(MODULE_BY_ID.get('flak')!), false);
  assert.equal(isChaffClear(MODULE_BY_ID.get('flamer')!), true);
});

test('smart layout: chaff screen ahead of the armour, artillery at the back, aircraft held, all legal', () => {
  const ds: Design[] = ['buzzsaw', 'bulwark', 'ripper', 'lancer', 'firestorm', 'hornet', 'stormcaller'].map(S);
  const place = smartDeploy(ds.map((d) => ({ d, n: 2 })));
  assert.equal(place.length, 14, 'every block placed');
  const by = (id: string) => place.filter((p) => p.designId === `starter-${id}`);
  const minY = (id: string) => Math.min(...by(id).map((p) => p.y));
  const maxY = (id: string) => Math.max(...by(id).map((p) => p.y));
  assert.equal(minY('buzzsaw'), 0, 'chaff at the front');
  assert.ok(maxY('buzzsaw') < minY('bulwark'), 'chaff ahead of the armour');
  assert.ok(by('bulwark').every((p) => p.hold), 'armour holds the line');
  assert.ok(minY('lancer') > minY('bulwark'), 'ranged behind the armour');
  assert.ok(by('lancer').every((p) => p.escort != null), 'ranged escorts the armour');
  assert.ok(minY('firestorm') > maxY('lancer'), 'artillery at the back');
  assert.ok(by('ripper').every((p) => (p.delay ?? 0) > 0), 'melee held a moment');
  assert.ok(by('hornet').every((p) => (p.delay ?? 0) >= 6), 'aircraft held back');
  // legal: inside the zone, no overlaps
  const shape = (p: (typeof place)[number]) => computeStats(ds.find((d) => d.id === p.designId)!);
  for (const p of place) assert.ok(blockInZone(p.x, p.y, shape(p), p.spacing ?? 0), p.designId);
  for (let i = 0; i < place.length; i++) for (let j = i + 1; j < place.length; j++) {
    assert.ok(!blocksOverlap(place[i], shape(place[i]), place[j], shape(place[j])), `${place[i].designId} / ${place[j].designId}`);
  }
});
