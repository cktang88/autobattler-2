// Bombers: fast jets, bombs released ahead of the target, empty bays rearm over the own deploy zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/shared/sim/battle.ts';
import { DEPLOY_D, FIELD_H, METERS_PER_CELL } from '../src/shared/grid.ts';
import { airRole, computeStats, validateDesign } from '../src/shared/stats.ts';
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

test('air roles: bomb bays make a bomber, AA jets a fighter, gun jets a harasser, hovering flyers a gunship', () => {
  assert.equal(airRole(D('b', 'stratobomber', 'jet', ['bombs', 'bombs', 'bombs', 'mg'])), 'bomber');
  assert.equal(airRole(D('f', 'strikejet', 'jet', ['aamissile', 'aamissile', 'mg'])), 'fighter');
  assert.equal(airRole(D('i', 'interceptor', 'jet', ['twinmg', 'mg'])), 'fighter');
  assert.equal(airRole(D('h', 'deltawing', 'jet', ['rockets', 'mg', 'mg'])), 'harasser');
  assert.equal(airRole(D('g', 'gunship', 'rotor', ['autocannon', 'autocannon'])), 'gunship');
  assert.equal(airRole(D('t', 'warden', 'treads', ['autocannon', 'plateL'])), null);
});

test('fighters go for aircraft over nearer ground units; jets never stack on top of each other', () => {
  const fighter = D('fighter', 'strikejet', 'jet', ['aamissile', 'aamissile', 'mg']);
  const tank = D('tank', 'warden', 'treads', ['autocannon', 'plateL']);
  const heli = D('heli', 'gunship', 'rotor', ['autocannon', 'autocannon']);
  const designs = [fighter, tank, heli];
  const b = new Battle({ seed: 2, sides: [
    { designs, units: [30, 33, 36, 39].map((x, i) => ({ uid: i + 1, designId: 'fighter', x, y: 2, level: 1, round: 1 })) },
    { designs, units: [{ uid: 1, designId: 'tank', x: 34, y: 0, level: 1, round: 1, stance: 'holdPos' as const }, { uid: 2, designId: 'heli', x: 48, y: 20, level: 1, round: 1, stance: 'holdPos' as const }] },
  ] });
  const heliId = b.units.length - 1;
  let minD = Infinity, onHeli = 0, ticks = 0;
  for (let t = 0; t < 20 * 6 && b.units[heliId].alive; t++) {
    b.step();
    const ints = (b as unknown as { ints: { goal: number; u: { side: number; alive: boolean } }[] }).ints;
    for (const I of ints) if (I.u.side === 0 && I.u.alive) { ticks++; if (I.goal === heliId) onHeli++; }
    const jets = b.units.filter((u) => u.side === 0 && u.alive);
    for (let i = 0; i < jets.length; i++) for (let j = i + 1; j < jets.length; j++) minD = Math.min(minD, Math.hypot(jets[i].x - jets[j].x, jets[i].y - jets[j].y));
  }
  assert.ok(onHeli / ticks > 0.8, `fighters chased the helicopter ${Math.round((100 * onHeli) / ticks)}% of the time`);
  assert.ok(minD > 0.5, `two jets got ${minD.toFixed(2)} cells apart`);
});
