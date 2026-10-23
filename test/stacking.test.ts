// Percentage modules stack with diminishing returns, identically in the price model and the sim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_BY_ID } from '../src/shared/parts.ts';
import { MAX_ENERGY_RESIST, computeStats, stackBonus, stackedBonuses } from '../src/shared/stats.ts';

test('stackBonus: strongest copy full, then 80%, 60%, ...', () => {
  assert.equal(stackBonus([0.15]), 0.15);
  assert.ok(Math.abs(stackBonus([0.15, 0.15, 0.15]) - 0.15 * (1 + 0.8 + 0.6)) < 1e-12);
  assert.ok(Math.abs(stackBonus([0.1, 0.3]) - (0.3 + 0.1 * 0.8)) < 1e-12, 'strongest first');
});

test('two targeting computers give less than double range; mirrors never pass the resistance cap', () => {
  const one = computeStats({ id: 'a', name: 'a', chassis: 'striker', mobility: 'halftrack', mounts: ['autocannon', 'autocannon', 'targeting'] });
  const tc = MODULE_BY_ID.get('targeting')!;
  const two = stackedBonuses([tc, tc]);
  assert.ok(two.range < 2 * (tc.rangeBonus ?? 0) && two.range > (tc.rangeBonus ?? 0));
  assert.ok(Math.abs(one.rangeMult - (1 + (tc.rangeBonus ?? 0))) < 1e-9);
  const mirror = MODULE_BY_ID.get('mirror')!;
  assert.ok(stackedBonuses([mirror, mirror, mirror, mirror]).energyResist <= MAX_ENERGY_RESIST);
});
