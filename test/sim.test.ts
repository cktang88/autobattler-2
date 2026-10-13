import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle, runBattle } from '../src/shared/sim/battle.ts';
import { MAX_TICKS } from '../src/shared/sim/types.ts';
import type { BattleInput } from '../src/shared/sim/types.ts';
import { validateDesign } from '../src/shared/stats.ts';
import type { Design, Placement } from '../src/shared/types.ts';

const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id, chassis, mobility, mounts });

const DESIGNS: Design[] = [
  D('buggy', 'scout', 'wheels', ['mg']),
  D('torch', 'scout', 'halftrack', ['flamer']),
  D('lancer', 'raider', 'legs', ['laser', 'laser']),
  D('bulwark', 'warden', 'treads', ['autocannon', 'plateL']),
  D('buster', 'longarm', 'halftrack', ['cannon']),
  D('skyguard', 'warden', 'halftrack', ['flak', 'mg']),
  D('arty', 'longarm', 'spider', ['howitzer']),
  D('hornet', 'drone', 'rotor', ['mg']),
  D('strafer', 'gunship', 'jet', ['rockets', null]),
  D('medic', 'aegis', 'halftrack', ['autocannon', 'repair']),
  D('storm', 'striker', 'halftrack', ['tesla', 'autocannon', 'mg']),
  D('ironclad', 'bastion', 'treads', ['cannon', 'plateM', 'autocannon']),
  D('spire', 'warden', 'anchor', ['sam', 'mg']),
  D('hopper', 'raider', 'jumpjets', ['flamer', 'flamer']),
  D('zapper', 'raider', 'halftrack', ['stungun', 'mg']),
  D('fortress', 'bastion', 'treads', ['plateH', 'plateM', 'plateM']),
  D('fortgun', 'bastion', 'treads', ['plateH', 'plateM', 'autocannon']),
  D('rotorflak', 'drone', 'rotor', ['aamissile']),
];

test('test designs are legal', () => {
  for (const d of DESIGNS) assert.deepEqual(validateDesign(d), [], d.id);
});

let uidSeq = 1;
const P = (designId: string, x: number, y: number, level = 1): Placement => ({ uid: uidSeq++, designId, x, y, level, round: 1 });
const input = (seed: number, a: Placement[], b: Placement[]): BattleInput => ({ seed, sides: [{ designs: DESIGNS, units: a }, { designs: DESIGNS, units: b }] });

function mixedArmy(): Placement[] {
  return [
    P('bulwark', 2, 0), P('buster', 6, 1), P('lancer', 10, 0), P('storm', 13, 0), P('ironclad', 17, 0),
    P('buggy', 0, 3), P('torch', 1, 3), P('hornet', 4, 4), P('medic', 8, 4), P('arty', 12, 5),
    P('skyguard', 16, 4), P('spire', 20, 5), P('strafer', 4, 7), P('hopper', 9, 7), P('zapper', 22, 0),
  ];
}

function snapshot(b: Battle) {
  return b.units.map((u) => [u.id, u.alive, +u.x.toFixed(6), +u.y.toFixed(6), +u.hp.toFixed(6)]);
}

test('determinism: identical input gives identical results', () => {
  const inp = input(12345, mixedArmy(), mixedArmy().reverse());
  const runs = [0, 1].map(() => {
    const b = new Battle(structuredClone(inp));
    let events = 0;
    while (!b.done) { b.step(); events += b.events.length; }
    return { summary: b.summary(), snap: snapshot(b), events };
  });
  assert.deepEqual(runs[0], runs[1]);
  assert.ok(runs[0].summary.ticks > 0);
  // a different seed should normally change something
  const other = runBattle(input(999, mixedArmy(), mixedArmy().reverse()));
  assert.ok(other.ticks > 0);
});

test('ground-only weapons cannot hurt flyers', () => {
  const ground = [P('buster', 4, 0), P('buster', 10, 0), P('arty', 16, 2), P('torch', 0, 0)];
  const air = [P('hornet', 4, 0), P('hornet', 8, 0), P('hornet', 12, 0)];
  const s = runBattle(input(7, ground, air));
  assert.equal(s.damageDealt[0], 0);
  assert.notEqual(s.winner, 0);
});

test('mutually untouchable armies end early instead of running to the cap', () => {
  // ground-only cannons vs air-only missiles: nobody can hit anybody
  const s = runBattle(input(3, [P('buster', 4, 0)], [P('rotorflak', 4, 0)]));
  assert.ok(s.ticks < MAX_TICKS / 2, `ticks ${s.ticks}`);
  assert.deepEqual(s.damageDealt, [0, 0]);
});

test('heavy armor shrugs off machine guns but not cannons', () => {
  // vs MG buggies: the armored hull with an autocannon wins
  const mg = runBattle(input(1, [P('fortgun', 10, 0)], [P('buggy', 4, 0), P('buggy', 8, 0), P('buggy', 12, 0), P('buggy', 16, 0)]));
  assert.equal(mg.winner, 0);
  // per-hit damage check
  const b = new Battle(input(2, [P('fortress', 10, 0)], [P('buggy', 8, 0), P('buster', 12, 0)]));
  let mgHit = 0, mgN = 0, cHit = 0, cN = 0;
  while (!b.done) {
    b.step();
    for (const e of b.events) if (e.t === 'hit' && e.unit === 0) {
      if (e.moduleId === 'mg') { mgHit += e.damage; mgN++; }
      if (e.moduleId === 'cannon') { cHit += e.damage; cN++; }
    }
  }
  assert.ok(mgN > 0 && cN > 0);
  assert.ok(mgHit / mgN < 9 * 0.2, `mg per hit ${mgHit / mgN}`);
  assert.ok(cHit / cN > 190 * 0.8, `cannon per hit ${cHit / cN}`);
});

test('leveled unit beats the same unlevelled unit', () => {
  for (const id of ['bulwark', 'lancer', 'buster']) {
    for (const seed of [1, 2, 3]) {
      const a = runBattle(input(seed, [P(id, 10, 0, 2)], [P(id, 10, 0, 1)]));
      assert.equal(a.winner, 0, `${id} seed ${seed} (leveled side 0)`);
      const b = runBattle(input(seed, [P(id, 10, 0, 1)], [P(id, 10, 0, 3)]));
      assert.equal(b.winner, 1, `${id} seed ${seed} (leveled side 1)`);
    }
  }
});

test('timeout / stalemate decided by remaining value', () => {
  // emplacements far out of each other's range: value 2 spires vs 1
  const s = runBattle(input(5, [P('spire', 2, 7), P('spire', 20, 7)], [P('spire', 10, 7)]));
  assert.ok(s.ticks <= MAX_TICKS);
  assert.equal(s.winner, 0);
  assert.equal(s.survivors[0].length, 2);
  const d = runBattle(input(5, [P('spire', 2, 7)], [P('spire', 10, 7)]));
  assert.equal(d.winner, -1);
  // hard cap
  const b = new Battle(input(5, [P('spire', 2, 7)], [P('spire', 10, 7)]));
  let n = 0;
  while (!b.done && n++ < MAX_TICKS + 10) b.step();
  assert.ok(b.done && b.tick <= MAX_TICKS);
  assert.equal(b.events.at(-1)?.t, 'end');
});

test('invalid / unknown placements are skipped; empty side loses', () => {
  const bad: Design = D('bad', 'scout', 'treads', ['mg']);
  const inp: BattleInput = { seed: 1, sides: [{ designs: [...DESIGNS, bad], units: [P('bad', 0, 0), P('nope', 4, 0)] }, { designs: DESIGNS, units: [P('buggy', 4, 0)] }] };
  const b = new Battle(inp);
  assert.equal(b.units.length, 1);
  b.step();
  assert.ok(b.done);
  assert.equal(b.winner, 1);
  assert.equal(runBattle(input(1, [], [])).winner, -1);
});

test('jets strafe ground targets and win; stun applies', () => {
  const s = runBattle(input(4, [P('strafer', 10, 0)], [P('buggy', 6, 2), P('torch', 14, 2)]));
  assert.equal(s.winner, 0);
  const b = new Battle(input(4, [P('zapper', 10, 0)], [P('bulwark', 10, 0)]));
  let stunned = false;
  while (!b.done) { b.step(); if (b.units[1].stun > 0) stunned = true; }
  assert.ok(stunned);
});

test('units start facing the enemy and stay inside the field', () => {
  const b = new Battle(input(8, mixedArmy(), mixedArmy()));
  assert.ok(Math.abs(b.units[0].angle + Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(b.units.at(-1)!.angle - Math.PI / 2) < 1e-9);
  while (!b.done) {
    b.step();
    for (const u of b.units) assert.ok(u.x >= 0 && u.x <= 24 && u.y >= 0 && u.y <= 32, `unit ${u.id} out of bounds`);
  }
});

test('performance: 60 units per side simulates quickly', () => {
  const small = ['buggy', 'torch', 'lancer', 'hornet', 'hopper', 'zapper'];
  const army = () => {
    const out: Placement[] = [];
    for (let i = 0; i < 60; i++) out.push(P(small[i % small.length], (i * 2) % 24, Math.floor(i / 12) + (i % 2)));
    return out;
  };
  const inp = input(42, army(), army());
  runBattle(structuredClone(inp)); // warm up JIT
  const t0 = performance.now();
  const s = runBattle(inp);
  const ms = performance.now() - t0;
  console.log(`  60v60: ${ms.toFixed(0)}ms, ${s.ticks} ticks, winner ${s.winner}`);
  assert.ok(ms < 1000, `took ${ms}ms`);
});
