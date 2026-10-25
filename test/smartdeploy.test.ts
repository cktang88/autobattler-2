// Smart deployment (the balance tooling's "sensible player" layout): roles and the front-to-back order of the lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { clashPoint, deployRole, formationClock, formationDelays, isChaffClear, smartDeploy, smartDeployBlocks } from '../src/shared/smartdeploy.ts';
import { Battle } from '../src/shared/sim/battle.ts';
import { START_DELAYS } from '../src/shared/types.ts';
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

test('smart layout: chaff screen ahead of the armour, artillery behind it, aircraft timed, all legal', () => {
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
  assert.ok(minY('firestorm') > maxY('bulwark'), 'artillery behind the armour');
  assert.ok(by('ripper').every((p) => (p.delay ?? 0) > 0), 'melee held a moment');
  assert.ok(by('hornet').every((p) => p.delay !== undefined), 'aircraft timed');
  // legal: inside the zone, no overlaps
  const shape = (p: (typeof place)[number]) => computeStats(ds.find((d) => d.id === p.designId)!);
  for (const p of place) assert.ok(blockInZone(p.x, p.y, shape(p), p.spacing ?? 0), p.designId);
  for (let i = 0; i < place.length; i++) for (let j = i + 1; j < place.length; j++) {
    assert.ok(!blocksOverlap(place[i], shape(place[i]), place[j], shape(place[j])), `${place[i].designId} / ${place[j].designId}`);
  }
});

test('incremental layout: new blocks form up around the board, armour line extended, existing spots kept', () => {
  const ds: Design[] = ['buzzsaw', 'bulwark', 'firestorm', 'hornet', 'lancer'].map(S);
  const first = smartDeploy(ds.map((d) => ({ d, n: 1 })));
  const existing = first.map((p) => ({ d: ds.find((d) => d.id === p.designId)!, p }));
  const more = smartDeployBlocks(ds.map((d, i) => ({ d, uid: 100 + i })), { existing, round: 2 });
  assert.equal(more.length, ds.length, 'every new block placed');
  assert.ok(more.every((p) => p.round === 2 && p.uid >= 100));
  const shape = (p: { designId: string }) => computeStats(ds.find((d) => d.id === p.designId)!);
  const all = [...first, ...more];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(!blocksOverlap(all[i], shape(all[i]), all[j], shape(all[j])));
  const armour = all.filter((p) => p.designId === 'starter-bulwark');
  assert.equal(armour[0].y, armour[1].y, 'new armour extends the existing line');
  const newChaff = more.find((p) => p.designId === 'starter-buzzsaw')!;
  assert.ok(newChaff.y < armour[0].y, 'new chaff in front of the armour');
  assert.ok(more.find((p) => p.designId === 'starter-hornet')!.delay !== undefined, 'aircraft timed');
  assert.ok(armour.map((p) => p.uid).includes(more.find((p) => p.designId === 'starter-lancer')!.escort!), 'ranged escorts the armour');
});

test('timing: chaff paced to the armour, artillery reaches the clash, delays legal', () => {
  const ds: Design[] = ['buzzsaw', 'bulwark', 'skyguard', 'lancer', 'firestorm', 'thunderhead', 'hornet', 'strafer', 'ripper'].map(S);
  const place = smartDeploy(ds.map((d) => ({ d, n: ['bulwark', 'buzzsaw'].some((k) => d.id.endsWith(k)) ? 2 : 1 })));
  const by = (id: string) => place.filter((p) => p.designId === `starter-${id}`);
  const armour = new Set(by('bulwark').map((p) => p.uid));
  // fast chaff and riot escort the armour instead of running ahead of it
  assert.ok(by('buzzsaw').every((p) => armour.has(p.escort!)), 'chaff escorts the armour');
  assert.ok(by('skyguard').every((p) => armour.has(p.escort!)), 'riot escorts the armour');
  for (const p of place) if (p.delay !== undefined) assert.ok((START_DELAYS as readonly number[]).includes(p.delay), `${p.designId} delay ${p.delay}`);
  // artillery: forward enough to reach the clash point (walking at its speed), behind the escorts
  const armorY = Math.min(...by('bulwark').map((p) => p.y));
  const st = computeStats(S('bulwark'));
  const { clash } = formationClock([st, st], [], armorY);
  // the clock is the mirror-enemy clash of a line ~20% slower than its hull (escorts crowding it)
  assert.deepEqual(clash, clashPoint(armorY, 0.8 * st.speed, st.range));
  for (const id of ['firestorm', 'thunderhead']) {
    const a = computeStats(S(id));
    for (const p of by(id)) {
      assert.ok(p.y - a.speed * clash.t - clash.enemyY <= a.range, `${id} reaches the clash (row ${p.y})`);
      assert.ok(p.y > Math.max(...by('bulwark').map((q) => q.y)), `${id} behind the armour`);
    }
  }
  // the short-ranged gun sits further forward than the old back row; the long one stays at the back
  assert.ok(by('firestorm')[0].y < 24 - 3, 'short artillery moved up');
  assert.ok(by('thunderhead')[0].y >= by('firestorm')[0].y, 'long artillery stays further back');
  // a faster aircraft waits longer; re-timing the whole board gives the same delays
  assert.ok(by('strafer')[0].delay! >= by('hornet')[0].delay!, 'jets wait longer than slow aircraft');
  const re = formationDelays(place.map((p) => ({ d: ds.find((d) => d.id === p.designId)!, p })));
  for (const p of [...by('hornet'), ...by('strafer'), ...by('ripper')]) assert.equal(re.get(p.uid), p.delay, p.designId);

  // in the sim the chaff stays with the armour: no chaff unit gets far ahead of the nearest armour before it engages
  const b = new Battle({ seed: 3, sides: [{ designs: ds, units: place }, { designs: ds, units: place }] });
  let worst = 0;
  for (let t = 0; t < 20 * 12; t++) {
    b.step();
    for (const u of b.units) {
      if (!u.alive || u.side !== 0 || u.design.id !== 'starter-buzzsaw' || u.mounts.some((m) => m.target >= 0)) continue;
      const arm = b.units.filter((a) => a.alive && a.side === 0 && a.design.id === 'starter-bulwark');
      if (arm.length) worst = Math.max(worst, Math.min(...arm.map((a) => a.y - u.y)));
    }
  }
  assert.ok(worst < 8, `chaff kept near the armour (max lead ${worst.toFixed(1)} cells)`);
});
