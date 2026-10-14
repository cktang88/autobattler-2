import test from 'node:test';
import assert from 'node:assert/strict';
import { CHASSIS, MODULES } from '../src/shared/parts.ts';
import { meleeSlots } from '../src/shared/mountgeo.ts';
import { slotError, validateDesign } from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import type { Design } from '../src/shared/types.ts';

const D = (chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id: 't', name: 'T', chassis, mobility, mounts });

test('melee weapons are rejected on jets and helis', () => {
  const jet = validateDesign(D('strikejet', 'jet', ['buzzsaw', 'hmg', 'hmg']));
  assert.ok(jet.some((e) => /ground units/.test(e)), jet.join('|'));
  const heli = validateDesign(D('gunship', 'rotor', ['claw', 'hmg']));
  assert.ok(heli.some((e) => /ground units/.test(e)), heli.join('|'));
});

test('melee is rejected in a centre slot and accepted in an edge slot', () => {
  // titan walker: slots 0/1 are forearms, 2-4 are shoulder blades / backpack
  assert.deepEqual(meleeSlots(CHASSIS.find((c) => c.id === 'titan')!), [true, true, false, false, false]);
  const bad = validateDesign(D('titan', 'megatracks', ['cannon', 'cannon', 'drill', null, null]));
  assert.ok(bad.some((e) => /can't fit in mount 3: melee weapons need a mount near the edge/.test(e)), bad.join('|'));
  assert.deepEqual(validateDesign(D('titan', 'megatracks', ['titanfist', 'drill', 'autocannon', null, null])), []);
  assert.deepEqual(validateDesign(D('mantis', 'legs', ['buzzsaw', 'buzzsaw'])), []);
  const centre = validateDesign(D('warden', 'treads', ['chainsaw', null]));
  assert.ok(centre.some((e) => /edge of the chassis/.test(e)));
});

test('every melee-role chassis has a melee slot, and flyers have none', () => {
  for (const c of CHASSIS) {
    const slots = meleeSlots(c);
    assert.equal(slots.length, c.mounts.length);
    if (c.roles.includes('melee')) assert.ok(slots.some(Boolean), `${c.id} has no melee slot`);
    if ((c.domain ?? 'ground') !== 'ground') assert.ok(!slots.some(Boolean), `${c.id} flyer has melee slot`);
  }
});

test('slotError agrees with validateDesign for every module on every ground chassis slot', () => {
  for (const c of CHASSIS) {
    const mob = c.domain === 'jet' ? 'jet' : c.domain === 'heli' ? 'rotor' : 'legs';
    for (const m of MODULES) c.mounts.forEach((_, i) => {
      const mounts = c.mounts.map(() => null as string | null);
      mounts[i] = m.id;
      const why = slotError(c, mob, i, m);
      const errs = validateDesign(D(c.id, mob, mounts)).filter((e) => /fit|ground|aircraft|flying|mount/.test(e) && !/Needs at least|Overloaded|can't use|carry/.test(e));
      if (!why) assert.ok(!errs.some((e) => e.startsWith(m.name)), `${c.id}/${i}/${m.id}: ${errs.join('|')}`);
    });
  }
});

test('starter designs validate', () => {
  for (const d of STARTER_DESIGNS) assert.deepEqual(validateDesign(d), [], d.id);
});
