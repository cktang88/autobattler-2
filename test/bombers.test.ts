// Bombers: fast jets, bombs released ahead of the target, empty bays rearm over the own deploy zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/shared/sim/battle.ts';
import { MODULES } from '../src/shared/parts.ts';
import { DEPLOY_D, FIELD_H, FIELD_W, METERS_PER_CELL } from '../src/shared/grid.ts';
import { airRole, computeStats, validateDesign } from '../src/shared/stats.ts';
import type { Design } from '../src/shared/types.ts';

const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id, chassis, mobility, mounts });

test('jet bombers are fast: a loaded strato bomber cruises at 30+ m/s', () => {
  const strato = D('strato', 'stratobomber', 'jet', ['bombs', 'bombs', null, 'shieldL']);
  assert.deepEqual(validateDesign(strato, true), []);
  assert.ok(computeStats(strato).speed * METERS_PER_CELL >= 30, `${computeStats(strato).speed * METERS_PER_CELL} m/s`);
});

test('a bomber that empties its bays flies home, rearms and comes back for more runs', () => {
  const strato = D('strato', 'stratobomber', 'jet', ['bombs', 'bombs', null, 'shieldL']);
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
  assert.equal(airRole(D('b', 'stratobomber', 'jet', ['bombs', 'bombs', null, 'shieldL'])), 'bomber');
  assert.equal(airRole(D('f', 'strikejet', 'jet', ['aamissile', 'aamissile', 'targeting'])), 'fighter');
  assert.equal(airRole(D('i', 'interceptor', 'jet', ['twinmg', 'mg'])), 'fighter');
  assert.equal(airRole(D('h', 'deltawing', 'jet', ['rockets', 'mg', 'targeting'])), 'harasser');
  assert.equal(airRole(D('g', 'gunship', 'rotor', ['autocannon', 'autocannon'])), 'gunship');
  assert.equal(airRole(D('t', 'warden', 'treads', ['autocannon', 'plateL'])), null);
});

test('fighters go for aircraft over nearer ground units; jets never stack on top of each other', () => {
  const fighter = D('fighter', 'strikejet', 'jet', ['aamissile', 'aamissile', 'targeting']);
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

test('bombs, artillery shells and their splash, bomblets and fire never hit aircraft', () => {
  for (const m of MODULES) {
    if (m.kind !== 'weapon' || (m.projectile !== 'arc' && !m.resupply)) continue;
    assert.equal(!!m.targetsAir, false, `${m.id} targets aircraft`);
  }
  // a bomber pounding a tank that has an enemy helicopter hovering right over it: only the tank takes bomb damage
  const strato = D('strato', 'stratobomber', 'jet', ['heavybomb', 'clusterbombs', null, null]);
  const tank = D('tank', 'bastion', 'anchor', ['cannon', 'plateM', null]);
  assert.deepEqual(validateDesign(tank, true), []);
  const heli = D('heli', 'gunship', 'rotor', ['flak', null]);
  const designs = [strato, tank, heli];
  const b = new Battle({ seed: 7, sides: [
    { designs, units: [{ uid: 1, designId: 'strato', x: 40, y: 4, level: 1, round: 1 }] },
    { designs, units: [{ uid: 1, designId: 'tank', x: 44, y: 2, level: 1, round: 1 }, { uid: 2, designId: 'heli', x: 44, y: 2, level: 1, round: 1, stance: 'holdPos' as const }] },
  ] });
  const bombIds = new Set(['bombs', 'clusterbombs', 'heavybomb']);
  let groundHits = 0;
  for (let t = 0; t < 20 * 40 && !b.done; t++) {
    b.step();
    for (const e of b.events) {
      if (e.t !== 'hit' || !bombIds.has(e.moduleId)) continue;
      assert.equal(b.units[e.unit].flying, false, `${e.moduleId} hit an aircraft`);
      groundHits++;
    }
  }
  assert.ok(groundHits > 0, 'the bombs did hit the tank');
});

// ---- giant / titan bombers (strategic, superfortress, dreadnought airship) ----
const STRAT = D('strat', 'strategic', 'jet', ['bombs', 'bombs', 'heavybomb', 'plateM', 'pointdef', 'shieldL']);
const SFORT = D('sfort', 'superfortress', 'jet', ['heavybomb', 'bombs', 'bombs', 'heavybomb', 'plateM', null, 'pointdef', 'shieldL', null, null]);
const DREAD = D('dread', 'dreadnought', 'gravlift', ['avenger', 'heavybomb', 'bombs', 'bombs', 'plateM', 'shieldL', 'pointdef']);
const isBomb = (id: string | null) => !!id && !!MODULES.find((m) => m.id === id)?.resupply;

test('giant and titan bombers: legal single-unit bombers, slower than the strato and too big to jink', () => {
  const strato = computeStats(D('strato', 'stratobomber', 'jet', ['bombs', 'bombs', null, 'shieldL']));
  for (const d of [STRAT, SFORT, DREAD]) {
    assert.deepEqual(validateDesign(d, true), [], d.id);
    const s = computeStats(d);
    assert.equal(s.squad, 1, d.id);
    assert.equal(airRole(d), 'bomber', d.id);
    assert.ok(!s.traits.includes('evasive'), `${d.id} dodges`);
    assert.ok(s.hp > strato.hp * 2 && s.cost > strato.cost * 2, `${d.id} hp ${s.hp} cost ${s.cost}`);
  }
  for (const d of [STRAT, SFORT]) {
    const s = computeStats(d);
    assert.ok(s.speed < strato.speed && s.speed * METERS_PER_CELL >= 20, `${d.id} ${s.speed * METERS_PER_CELL} m/s`);
  }
  // only grav lifters carry the airship; the jet bombers only fly on jets
  assert.ok(validateDesign({ ...DREAD, mobility: 'rotor' }).length > 0);
  assert.ok(validateDesign({ ...SFORT, mobility: 'gravlift' }).length > 0);
});

/** one bomber vs a row of tanks: bomb drops, home trips, ticks pinned at a field edge, and whether every bay was full
 *  each time it left home */
function sortie(d: Design, ticks: number, seed = 4) {
  const tank = D('tank', 'warden', 'treads', ['autocannon', 'plateL']);
  const designs = [d, tank];
  const b = new Battle({ seed, sides: [
    { designs, units: [{ uid: 1, designId: d.id, x: 40, y: 4, level: 1, round: 1 }] },
    { designs, units: Array.from({ length: 8 }, (_, i) => ({ uid: i + 1, designId: 'tank', x: 6 + i * 11, y: 2, level: 1, round: 1, stance: 'holdPos' as const })) },
  ] });
  const u = b.units[0];
  let drops = 0, trips = 0, edge = 0, wasHome = true;
  const departures: boolean[] = [];
  while (!b.done && b.tick < ticks) {
    b.step();
    for (const e of b.events) if (e.t === 'fire' && e.unit === 0 && isBomb(e.moduleId)) drops++;
    const home = u.y >= FIELD_H - DEPLOY_D;
    if (home && !wasHome) trips++;
    if (!home && wasHome && b.tick > 40) departures.push(u.mounts.every((m, i) => !isBomb(d.mounts[i]) || !m.reloading));
    wasHome = home;
    if (u.x <= 0.6 || u.x >= FIELD_W - 0.6 || u.y <= 0.6 || u.y >= FIELD_H - 0.6) edge++;
  }
  return { drops, trips, edge, departures, b };
}

test('giant jet bombers fly their runs, go home to rearm, wait until every bay is full and never get stuck at the edge', () => {
  for (const d of [STRAT, SFORT]) {
    const r = sortie(d, 20 * 100);
    const bays = d.mounts.filter(isBomb).length;
    assert.ok(r.drops > bays, `${d.id} drops ${r.drops}`);
    assert.ok(r.trips >= 1, `${d.id} home trips ${r.trips}`);
    assert.ok(r.departures.every(Boolean), `${d.id} left home with empty bays`);
    assert.ok(r.edge < 20 * 3, `${d.id} pinned at the field edge for ${(r.edge / 20).toFixed(1)} s`);
    assert.ok(r.b.units.some((x) => x.side === 1 && !x.alive), `${d.id} killed nothing`);
  }
});

test('a gun-armed hovering bomber flies over its target to bomb it instead of parking at machine-gun range', () => {
  // (bombs + machine guns only: a heavy deck gun like the avenger kills the tanks before the bays get a look in)
  const r = sortie(D('dreadb', 'dreadnought', 'gravlift', ['heavybomb', 'bombs', 'bombs', 'bombs', 'plateM', 'shieldL', 'pointdef']), 20 * 100);
  assert.ok(r.drops >= 4, `dreadnought drops ${r.drops}`);
  assert.ok(r.b.units.some((x) => x.side === 1 && !x.alive), 'the dreadnought killed nothing');
});

test('two giant bombers never fly stacked on top of each other', () => {
  const tank = D('t', 'warden', 'treads', ['autocannon', 'plateL']);
  const designs = [STRAT, SFORT, tank];
  const b = new Battle({ seed: 3, sides: [
    { designs, units: [{ uid: 1, designId: 'strat', x: 30, y: 4, level: 1, round: 1 }, { uid: 2, designId: 'sfort', x: 38, y: 2, level: 1, round: 1 }] },
    { designs, units: [{ uid: 1, designId: 't', x: 40, y: 2, level: 1, round: 1, stance: 'holdPos' as const }] },
  ] });
  let minD = Infinity;
  for (let t = 0; t < 20 * 30 && !b.done; t++) {
    b.step();
    const [p, q] = [b.units[0], b.units[1]];
    if (p.alive && q.alive && t > 20) minD = Math.min(minD, Math.hypot(p.x - q.x, p.y - q.y));
  }
  assert.ok(minD > 2.5, `two giant bombers got ${minD.toFixed(2)} cells apart`);
});

test('bomb bays drop a stick, one after another, and stop when the bombs already falling will finish the target', () => {
  const strato = D('strato', 'stratobomber', 'jet', ['bombs', 'bombs', null, 'shieldL']);
  const lone = D('lone', 'bastion', 'treads', ['plateH', 'plateM', 'autocannon']); // size 3: always a single unit
  const designs = [strato, lone];
  const b = new Battle({ seed: 2, sides: [
    { designs, units: [{ uid: 1, designId: 'strato', x: 40, y: 4, level: 1, round: 1 }] },
    { designs, units: [{ uid: 1, designId: 'lone', x: 40, y: 2, level: 1, round: 1, stance: 'holdPos' as const }] },
  ] });
  const target = b.units.find((u) => u.side === 1)!;
  const ticks: number[] = [];
  while (!b.done && target.alive && b.tick < 20 * 60) {
    b.step();
    for (const e of b.events) if (e.t === 'fire' && e.unit === 0 && e.moduleId === 'bombs') ticks.push(b.tick);
  }
  assert.ok(!target.alive, 'the target died');
  // no two bombs leave on the same tick: a stick, not a dump
  assert.equal(new Set(ticks).size, ticks.length, `release ticks ${ticks}`);
  // a 620-hp tank needs ~3 iron bombs (260 each, minus armour); the full 6-bomb load would be overkill
  const need = Math.ceil(target.maxHp / 200) + 1;
  assert.ok(ticks.length <= need, `dropped ${ticks.length} bombs on a target that needed ~${need - 1}`);
});
