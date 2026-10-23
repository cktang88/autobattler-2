// Damage rules (stats.ts header): three penetration tiers, shields soak hits before armour, melee ignores armour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODULES } from '../src/shared/parts.ts';
import { apTier, damageKinds } from '../src/shared/stats.ts';
import { Battle } from '../src/shared/sim/battle.ts';
import type { Design } from '../src/shared/types.ts';

test('armour penetration uses only the three tiers; every melee weapon has full penetration', () => {
  for (const m of MODULES) {
    if (m.kind !== 'weapon') continue;
    assert.ok([0, 0.5, 1].includes(m.ap ?? 0), `${m.id}: ap ${m.ap}`);
    if (m.projectile === 'melee') assert.equal(apTier(m), 'full', m.id);
  }
  assert.deepEqual(damageKinds({ projectile: 'rocket', category: 'rocket' }), ['explosive']);
  assert.deepEqual(damageKinds({ projectile: 'beam', category: 'energy' }), ['energy']);
  assert.deepEqual(damageKinds({ projectile: 'bullet', category: 'machinegun' }), ['kinetic']);
});

test('shields soak hits at full strength before armour; armour then takes a flat amount off', () => {
  const d: Design = { id: 'tank', name: 'tank', chassis: 'warden', mobility: 'halftrack', mounts: ['autocannon', null] };
  const b = new Battle({ seed: 1, sides: [{ designs: [d], units: [{ uid: 1, designId: 'tank', x: 10, y: 0, level: 1, round: 1 }] }, { designs: [d], units: [{ uid: 1, designId: 'tank', x: 10, y: 0, level: 1, round: 1 }] }] });
  const t = b.units[1];
  const hit = (raw: number, ap: number) => (b as unknown as { damage(t: unknown, raw: number, ap: number, air: number, side: number, mod: string, x: number, y: number): void }).damage(t, raw, ap, 1, 0, 'mg', t.x, t.y);
  t.stats = { ...t.stats, armor: 10 };
  t.shield = 100;
  const hp0 = t.hp;
  hit(9, 0); // a 9-damage bullet would be cut to 15% by armour 10, but the shield takes all 9
  assert.equal(t.shield, 91);
  assert.equal(t.hp, hp0);
  t.shield = 0;
  hit(30, 0); // no shield: 30 - 10 armour
  assert.equal(hp0 - t.hp, 20);
  hit(30, 0.5); // half penetration: 30 - 5
  assert.equal(hp0 - t.hp, 45);
  hit(30, 1); // full penetration: all 30
  assert.equal(hp0 - t.hp, 75);
  t.shield = 5;
  hit(30, 0); // 5 into the shield, the remaining 25 hits the hull through armour: 25 - 10
  assert.equal(t.shield, 0);
  assert.equal(hp0 - t.hp, 90);
});
