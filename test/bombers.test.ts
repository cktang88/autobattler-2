// Bombers: fast jets, bombs released ahead of the target, empty bays rearm over the own deploy zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/shared/sim/battle.ts';
import { DEPLOY_D, FIELD_H, METERS_PER_CELL } from '../src/shared/grid.ts';
import { computeStats, validateDesign } from '../src/shared/stats.ts';
import type { Design } from '../src/shared/types.ts';

const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id, chassis, mobility, mounts });

test('jet bombers are fast: a loaded strato bomber cruises at 30+ m/s', () => {
  const strato = D('strato', 'stratobomber', 'jet', ['bombs', 'bombs', 'bombs', 'mg']);
  assert.deepEqual(validateDesign(strato), []);
  assert.ok(computeStats(strato).speed * METERS_PER_CELL >= 30, `${computeStats(strato).speed * METERS_PER_CELL} m/s`);
});

test('a bomber that empties its bays flies home, rearms and comes back for more runs', () => {
  const strato = D('strato', 'stratobomber', 'jet', ['bombs', 'bombs', 'bombs', 'mg']);
  const tank = D('tank', 'warden', 'treads', ['autocannon', 'plateL']);
  const designs = [strato, tank];
  const b = new Battle({ seed: 4, sides: [
    { designs, units: [{ uid: 1, designId: 'strato', x: 40, y: 4, level: 1, round: 1 }] },
    { designs, units: Array.from({ length: 6 }, (_, i) => ({ uid: i + 1, designId: 'tank', x: 20 + i * 8, y: 2, level: 1, round: 1, stance: 'holdPos' as const })) },
  ] });
  const u = b.units[0];
  let drops = 0, trips = 0, wasHome = true;
  while (!b.done && b.tick < 20 * 90) {
    b.step();
    for (const e of b.events) if (e.t === 'fire' && e.unit === 0 && e.moduleId === 'bombs') drops++;
    const home = u.y >= FIELD_H - DEPLOY_D;
    if (home && !wasHome) trips++;
    wasHome = home;
  }
  // one load = 3 bays x 2 passes; more drops than that means it rearmed
  assert.ok(drops > 6, `drops ${drops}`);
  assert.ok(trips >= 1, `home trips ${trips}`);
  assert.ok(b.units.some((x) => x.side === 1 && !x.alive), 'the bombs killed something');
});
