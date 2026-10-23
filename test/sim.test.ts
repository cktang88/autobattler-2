import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle as SimBattle } from '../src/shared/sim/battle.ts';
import { MAX_TICKS } from '../src/shared/sim/types.ts';
import { DEPLOY_D, FIELD_H, FIELD_W, placementUnitCenters } from '../src/shared/grid.ts';
import type { BattleInput } from '../src/shared/sim/types.ts';
import { SQUAD_TIERS, defaultOrders, validateDesign } from '../src/shared/stats.ts';
import type { Design, Placement } from '../src/shared/types.ts';
import { hullK } from '../src/shared/mountgeo.ts';
import { MODULE_BY_ID } from '../src/shared/parts.ts';

const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id, chassis, mobility, mounts });
// These are per-unit mechanics tests laid out (and indexed: units[1] = the enemy) for single medium units, and most of
// their cheap one-gun medium designs would now come as 2- or 4-squads: keep medium hulls single in this file (light
// squads stay as in the game). Medium squads in the sim are covered by squads.test.ts.
SQUAD_TIERS[2] = [[Infinity, 1]];

const DESIGNS: Design[] = [
  D('buggy', 'scout', 'wheels', ['mg']),
  D('torch', 'scout', 'halftrack', ['flamer']),
  D('lancer', 'raider', 'legs', ['laser', 'laser']),
  D('bulwark', 'warden', 'treads', ['autocannon', 'plateL']),
  D('buster', 'longarm', 'halftrack', ['cannon']),
  D('skyguard', 'warden', 'halftrack', ['flak', 'mg']),
  D('arty', 'longarm', 'spider', ['howitzer']),
  D('hornet', 'drone', 'rotor', ['mg']),
  D('strafer', 'strikejet', 'jet', ['rockets', null, null]),
  D('medic', 'aegis', 'halftrack', ['autocannon', 'repair']),
  D('storm', 'striker', 'halftrack', ['tesla', 'autocannon', 'mg']),
  D('ironclad', 'bastion', 'treads', ['cannon', 'plateM', 'autocannon']),
  D('spire', 'warden', 'anchor', ['sam', 'mg']),
  D('hopper', 'raider', 'jumpjets', ['flamer', 'flamer']),
  D('zapper', 'raider', 'halftrack', ['stungun', 'mg']),
  D('fortress', 'bastion', 'treads', ['plateH', 'plateM', 'repairM']),
  D('fortgun', 'bastion', 'treads', ['plateH', 'plateM', 'autocannon']),
  D('rotorflak', 'drone', 'rotor', ['aamissile']),
  D('dummy', 'raider', 'halftrack', ['plateL', 'repair']),
  D('sniper', 'scout', 'halftrack', ['sniper']),
  D('sniperw', 'warden', 'halftrack', ['sniper', null]),
  D('gunner', 'warden', 'halftrack', ['minigun', null]),
  D('sonic', 'warden', 'halftrack', ['sonic', null]),
  D('disarmer', 'warden', 'halftrack', ['disarm', null]),
  D('pulse', 'warden', 'halftrack', ['autocannon', null]),
  D('focus', 'warden', 'halftrack', ['twinlaser', null]),
  D('firebomber', 'warden', 'halftrack', ['firebomb', null]),
  D('clusterarty', 'goliath', 'megatracks', ['clusterhow', 'plateH', 'plateH', 'plateH']),
  D('flechetter', 'warden', 'halftrack', ['flechette', null]),
  D('brawler', 'mantis', 'legs', ['buzzsaw', 'buzzsaw']),
  D('runner', 'scout', 'wheels', ['mg']),
  D('mortartruck', 'warden', 'halftrack', ['mortar', null]),
  D('ghost', 'striker', 'halftrack', ['stealth', 'autocannon', 'mg']),
  D('spotter', 'raider', 'halftrack', ['sensor', 'mg']),
  D('pdtank', 'warden', 'halftrack', ['autocannon', 'pointdef']),
  D('plaintank', 'warden', 'halftrack', ['autocannon', 'plateL']),
  D('rocketeer', 'warden', 'halftrack', ['rockets', null]),
  D('smoker', 'warden', 'halftrack', ['autocannon', 'smoke']),
  D('bomb', 'scout', 'wheels', ['selfdestruct']),
  D('hardtank', 'warden', 'halftrack', ['autocannon', 'hardened']),
  D('domer', 'bastion', 'treads', ['dome', 'autocannon', 'plateM']),
  D('era', 'warden', 'halftrack', ['reactive', 'mg']),
  D('mirror', 'warden', 'halftrack', ['autocannon', 'mirror']),
  D('mgtank', 'warden', 'halftrack', ['mg', null]),
  D('uplinker', 'warden', 'halftrack', ['uplink', 'mg']),
  D('titanW', 'titan', 'megatracks', [null, null, 'cannon', 'cannon', 'cannon']),
  D('mlrsTruck', 'warden', 'halftrack', ['mlrs', null]),
  D('swarmer', 'warden', 'halftrack', ['swarm', null]),
  D('hunter', 'raider', 'legs', ['atgm', 'atgm']),
  D('cruiser', 'warden', 'halftrack', ['cruise', null]),
];

test('test designs are legal', () => {
  for (const d of DESIGNS) assert.deepEqual(validateDesign(d), [], d.id);
});

let uidSeq = 1;
/** Front-to-front gap the behaviour tests below were tuned for (the original 46-deep field with 12-deep zones). */
const TEST_GAP = 22;
/** These tests check *behaviour at contact range* (kiting, dodging, flanking, targeting), so on the larger field side 1
 *  is moved forward to keep the original 22-cell gap between the two front lines. Real games use the full field. */
class Battle extends SimBattle {
  constructor(inp: BattleInput) {
    super(inp);
    const dy = FIELD_H - 2 * DEPLOY_D - TEST_GAP;
    if (dy > 0) {
      for (const u of this.units) if (u.side === 1) u.y += dy;
      (this as unknown as { rebuildHash(): void }).rebuildHash();
    }
  }
}
const runBattle = (inp: BattleInput) => {
  const b = new Battle(inp);
  while (!b.done) b.step();
  return b.summary();
};
const P = (designId: string, x: number, y: number, level = 1): Placement => ({ uid: uidSeq++, designId, x, y, level, round: 1 });
// Tests were laid out on a 24-wide field; shift side 1's local x so its units keep the same world columns
// (facing side 0) on wider fields.
const mirrorShift = (b: Placement[]) => b.map((p) => ({ ...p, x: p.x + (FIELD_W - 24) }));
/** same, for tests laid out on the 48-wide field */
const shift48 = (b: Placement[]) => b.map((p) => ({ ...p, x: p.x + (FIELD_W - 48) }));
const input = (seed: number, a: Placement[], b: Placement[]): BattleInput => ({ seed, sides: [{ designs: DESIGNS, units: a }, { designs: DESIGNS, units: mirrorShift(b) }] });

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
  const mg = runBattle(input(1, [P('fortgun', 10, 0), P('fortgun', 13, 0)], [P('mgtank', 4, 0), P('mgtank', 8, 0)]));
  assert.equal(mg.winner, 0);
  // per-hit damage check
  const b = new Battle(input(2, [P('fortress', 10, 0)], [P('mgtank', 8, 0), P('buster', 12, 0)]));
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
  assert.equal(b.units.length, 16); // the squad of 16
  b.step();
  assert.ok(b.done);
  assert.equal(b.winner, 1);
  assert.equal(runBattle(input(1, [], [])).winner, -1);
});

test('jets strafe ground targets and win; stun applies', () => {
  const s = runBattle(input(4, [P('strafer', 10, 0), P('strafer', 14, 0)], [P('mgtank', 6, 2)]));
  assert.equal(s.winner, 0);
  const b = new Battle(input(4, [P('zapper', 10, 0)], [P('bulwark', 10, 0)]));
  let stunned = false;
  const foe = b.units.find((u) => u.side === 1)!;
  while (!b.done) { b.step(); if (foe.stun > 0) stunned = true; }
  assert.ok(stunned);
});

test('units start facing the enemy and stay inside the field', () => {
  const b = new Battle(input(8, mixedArmy(), mixedArmy()));
  assert.ok(Math.abs(b.units[0].angle + Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(b.units.at(-1)!.angle - Math.PI / 2) < 1e-9);
  while (!b.done) {
    b.step();
    for (const u of b.units) assert.ok(u.x >= 0 && u.x <= FIELD_W && u.y >= 0 && u.y <= FIELD_H, `unit ${u.id} out of bounds`);
  }
});

test('performance: 240 units per side (15 light squads) simulates in under 3s', () => {
  const small = ['buggy', 'torch', 'lancer', 'hornet', 'hopper', 'zapper'];
  const army = () => {
    const out: Placement[] = [];
    for (let i = 0; i < 15; i++) out.push({ ...P(small[i % small.length], (i % 5) * 9, Math.floor(i / 5) * 3), spacing: i % 2 });
    return out;
  };
  // laid out 48 wide: shift side 1 so both armies face each other on the wider field
  const inp = (): BattleInput => ({ seed: 42, sides: [{ designs: DESIGNS, units: army() }, { designs: DESIGNS, units: army().map((p) => ({ ...p, x: p.x + (FIELD_W - 48) })) }] });
  runBattle(inp()); // warm up JIT
  const t0 = performance.now();
  const s = runBattle(inp());
  const ms = performance.now() - t0;
  console.log(`  240v240: ${ms.toFixed(0)}ms, ${s.ticks} ticks, winner ${s.winner}`);
  assert.ok(ms < 3000, `took ${ms}ms`);
});

function fireLog(b: Battle) {
  const fires: { tick: number; unit: number; mount: number; moduleId: string }[] = [];
  const hits: Record<string, number> = {};
  while (!b.done) {
    b.step();
    for (const e of b.events) {
      if (e.t === 'fire') fires.push({ tick: b.tick, unit: e.unit, mount: e.mount, moduleId: e.moduleId });
      if (e.t === 'hit') hits[e.moduleId] = (hits[e.moduleId] ?? 0) + 1;
    }
  }
  return { fires, hits };
}

test('magazines pause for reload', () => {
  const b = new Battle(input(1, [P('pulse', 10, 0)], [P('fortress', 9, 0)]));
  const { fires } = fireLog(b);
  const ticks = fires.filter((f) => f.unit === 0).map((f) => f.tick);
  assert.ok(ticks.length > 12);
  const gaps = ticks.slice(1).map((t, i) => (t - ticks[i]) / 20);
  // 6-shot magazine at 0.3s, then a 2s reload
  assert.ok(gaps.slice(0, 5).every((g) => g < 0.4), `gaps ${gaps.slice(0, 8)}`);
  assert.ok(gaps[5] >= 1.9, `reload gap ${gaps[5]}`);
});

test('accuracy: sniper is pinpoint, minigun sprays', () => {
  const sn = fireLog(new Battle(input(3, [P('sniperw', 10, 0)], [{ ...P('dummy', 10, 0), spacing: 2 }])));
  const mg = fireLog(new Battle(input(3, [P('gunner', 10, 0)], [{ ...P('dummy', 10, 0), spacing: 2 }])));
  const ratio = (r: ReturnType<typeof fireLog>, id: string) => (r.hits[id] ?? 0) / r.fires.filter((f) => f.moduleId === id).length;
  const rs = ratio(sn, 'sniper'), rm = ratio(mg, 'minigun');
  assert.ok(rs > 0.9, `sniper ${rs}`);
  assert.ok(rm < rs - 0.05, `minigun ${rm} vs sniper ${rs}`);
});

test('impulse knocks units back; disarm stops firing', () => {
  const b = new Battle(input(2, [P('sonic', 10, 0)], [P('plaintank', 10, 0)]));
  while (!b.done && b.tick < 20 * 20) b.step();
  assert.ok(b.units[1].odometer > 0.5, `pushed ${b.units[1].odometer}`);

  const d = new Battle(input(2, [P('disarmer', 10, 0)], [P('buster', 10, 0)]));
  let disarmedTicks = 0, firedWhileDisarmed = 0;
  while (!d.done) {
    const wasDisarmed = d.units[1].alive && d.units[1].disarm > 0.06;
    d.step();
    if (wasDisarmed) {
      disarmedTicks++;
      for (const e of d.events) if (e.t === 'fire' && e.unit === 1) firedWhileDisarmed++;
    }
  }
  assert.ok(disarmedTicks > 0);
  assert.equal(firedWhileDisarmed, 0);
});

test('melee: charges into contact and strikes edge-to-edge', () => {
  const b = new Battle(input(1, [P('brawler', 10, 0)], [P('plaintank', 10, 0)]));
  let firstHitGap = -1, swings = 0;
  while (!b.done) {
    b.step();
    for (const e of b.events) {
      if (e.t === 'fire' && e.moduleId === 'buzzsaw') {
        swings++;
        if (firstHitGap < 0) {
          const [a, t] = b.units;
          firstHitGap = Math.hypot(a.x - t.x, a.y - t.y) - 0.45 - 0.45;
        }
      }
    }
  }
  assert.equal(b.winner, 0);
  assert.ok(swings > 3);
  assert.ok(firstHitGap <= 0.6 * 1.08 + 0.05, `gap ${firstHitGap}`);
});

test('arc shells lead their target: a fast mover on a steady course is hit about as well as a parked one', () => {
  // one mortar truck vs one target, several seeds and lateral offsets
  const perShot = (enemy: string) => {
    let dmg = 0, shots = 0;
    for (const seed of [1, 2, 3]) for (const ox of [2, 10, 18]) {
      const b = new Battle(input(seed, [P('mortartruck', 10, 0)], [P(enemy, ox, 0)]));
      while (!b.done && b.tick < 20 * 40) {
        b.step();
        for (const e of b.events) {
          if (e.t === 'fire' && e.moduleId === 'mortar') shots++;
          if (e.t === 'hit' && e.moduleId === 'mortar') dmg += e.damage;
        }
      }
    }
    return { per: dmg / Math.max(1, shots), shots };
  };
  const parked = perShot('dummy');
  const fast = perShot('runner');
  assert.ok(fast.shots > 0 && parked.shots > 0);
  assert.ok(parked.per > 20, `parked ${parked.per}`);
  // artillery solves for the intercept point, so running in a straight line no longer dodges it
  assert.ok(fast.per > parked.per * 0.6, `fast ${fast.per} vs parked ${parked.per}`);
});

test('stealth: untargetable until it fires; detectors reveal it', () => {
  const b = new Battle(input(1, [P('ghost', 10, 0)], [P('spire', 10, 0)]));
  assert.equal(b.units[0].cloaked, true);
  let ghostFired = false, enemyFiredFirst = false;
  while (!b.done) {
    b.step();
    for (const e of b.events) if (e.t === 'fire') {
      if (e.unit === 0) ghostFired = true;
      else if (!ghostFired) enemyFiredFirst = true;
    }
  }
  assert.ok(ghostFired);
  assert.equal(enemyFiredFirst, false);

  // a sensor reveals a cloaked unit whenever it is within detection range (12 cells edge to edge), fired or not
  const d = new Battle(input(1, [P('ghost', 10, 0)], [P('spire', 10, 0), P('spotter', 12, 0)]));
  let inRangeTicks = 0, hiddenInRange = 0;
  while (!d.done) {
    d.step();
    const g = d.units[0], sp = d.units.find((u) => u.design.id === 'spotter')!;
    if (!g.alive || !sp.alive) continue;
    if (Math.hypot(g.x - sp.x, g.y - sp.y) < 12) { inRangeTicks++; if (g.cloaked) hiddenInRange++; }
  }
  assert.ok(inRangeTicks > 0, 'the ghost came within sensor range');
  assert.equal(hiddenInRange, 0, 'never cloaked while inside sensor range');
});

test('point defense shoots down rockets', () => {
  const rocketHits = (target: string) => {
    const b = new Battle(input(2, [P('rocketeer', 10, 0)], [P(target, 10, 0)]));
    let hits = 0, zaps = 0;
    while (!b.done && b.tick < 20 * 30) {
      b.step();
      for (const e of b.events) {
        if (e.t === 'hit' && e.moduleId === 'rockets') hits++;
        if (e.t === 'explode' && e.moduleId === 'pointdef') zaps++;
      }
    }
    return { hits, zaps };
  };
  const pd = rocketHits('pdtank'), plain = rocketHits('plaintank');
  assert.ok(pd.zaps > 0);
  assert.ok(pd.hits < plain.hits, `pd ${pd.hits} vs plain ${plain.hits}`);
});

test('smoke pops below 60% hp and blocks long-range targeting', () => {
  const b = new Battle(input(3, [P('smoker', 10, 0)], [P('buster', 4, 0), P('buster', 16, 0)]));
  let smoke: { x: number; y: number; radius: number; from: number; until: number } | null = null;
  let violations = 0;
  while (!b.done) {
    b.step();
    for (const e of b.events) if (e.t === 'smoke') {
      smoke = { x: e.x, y: e.y, radius: e.radius, from: b.tick + 1, until: b.tick + e.duration * 20 };
      assert.ok(b.units[0].hp < b.units[0].maxHp * 0.6);
    }
    if (smoke && b.tick > smoke.from && b.tick < smoke.until - 1 && b.units[0].alive) {
      const s0 = b.units[0];
      if (Math.hypot(s0.x - smoke.x, s0.y - smoke.y) > smoke.radius) continue;
      for (const u of b.units.slice(1)) {
        if (!u.alive) continue;
        if (u.mounts[0].target === 0 && Math.hypot(u.x - s0.x, u.y - s0.y) > 2.6) violations++;
      }
    }
  }
  assert.ok(smoke, 'smoke event');
  assert.equal(violations, 0);
});

test('unarmed blockers advance; self-destruct blasts on death', () => {
  const b = new Battle(input(4, [P('bomb', 10, 0)], [P('buggy', 10, 0)]));
  let blast = false;
  while (!b.done) {
    b.step();
    for (const e of b.events) if (e.t === 'explode' && e.moduleId === 'selfdestruct') blast = true;
  }
  assert.ok(b.units[0].odometer > 3, `advanced ${b.units[0].odometer}`);
  assert.ok(blast);
  assert.ok(b.summary().damageDealt[0] > 0);
});

test('[aura balance] auras never stack and are measured edge to edge', () => {
  const rate = (b: Battle, id: number) => (b as unknown as { ints: { rateAura: number }[] }).ints[id].rateAura;
  const unitOf = (b: Battle, design: string, nth = 0) => b.units.filter((u) => u.side === 0 && u.design.id === design)[nth];
  // one uplink vs two uplinks next to the same tank: the same +15%, not +30%
  const one = new Battle(input(1, [P('uplinker', 4, 6), P('bulwark', 8, 6)], [P('buggy', 10, 0)]));
  const two = new Battle(input(1, [P('uplinker', 4, 6), P('uplinker', 12, 6), P('bulwark', 8, 6)], [P('buggy', 10, 0)]));
  one.step();
  two.step();
  assert.equal(rate(one, unitOf(one, 'bulwark').id), 0.15);
  assert.equal(rate(two, unitOf(two, 'bulwark').id), rate(one, unitOf(one, 'bulwark').id), 'two uplinks give the same bonus as one');
  assert.equal(rate(two, unitOf(two, 'uplinker', 0).id), 0.15, 'uplinks boost each other once');
  assert.equal(rate(one, unitOf(one, 'uplinker').id), 0, 'an uplink does not boost its own carrier');
  // edge to edge: a titan whose centre is well beyond the radius is still covered by a carrier next to its hull
  const t = new Battle(input(1, [P('uplinker', 0, 10), P('titanW', 8, 8)], [P('buggy', 10, 0)]));
  t.step();
  const ti = unitOf(t, 'titanW'), up = unitOf(t, 'uplinker');
  assert.ok(Math.hypot(ti.x - up.x, ti.y - up.y) > 8, 'centres farther apart than the radius');
  assert.equal(rate(t, ti.id), 0.15);
  // domes: two domes over the same squad give one dome's shield (capped at half the ally's hp)
  const d1 = new Battle(input(1, [P('domer', 10, 0), P('buggy', 9, 4)], [P('buggy', 10, 0)]));
  const d2 = new Battle(input(1, [P('domer', 10, 0), P('domer', 4, 0), P('buggy', 9, 4)], [P('buggy', 10, 0)]));
  d1.step();
  d2.step();
  const b1 = unitOf(d1, 'buggy'), b2 = unitOf(d2, 'buggy');
  assert.ok(b1.maxAuraShield > 0);
  assert.equal(b1.maxAuraShield, Math.min(150, b1.maxHp * 0.5));
  assert.equal(b2.maxAuraShield, b1.maxAuraShield, 'two domes give the same shield as one');
});

test('defensive systems: hardened, shield dome, reactive armor, mirror coating', () => {
  // hardened: stun guns never stun it
  const h = new Battle(input(1, [P('zapper', 10, 0)], [P('hardtank', 10, 0)]));
  const tank = h.units.find((u) => u.side === 1)!;
  while (!h.done) { h.step(); assert.equal(tank.stun, 0); }
  // dome: neighbours start with projected shield, the dome itself doesn't
  const d = new Battle(input(1, [P('domer', 10, 0), P('buggy', 9, 0), P('buggy', 14, 1)], [P('buggy', 10, 0)]));
  d.step();
  assert.ok(d.units[1].auraShield > 0 && d.units[17].auraShield > 0); // first unit of each buggy squad
  assert.equal(d.units[0].maxAuraShield, 0);
  // reactive: charges are consumed by explosive hits and blunt them
  const r = new Battle(input(1, [P('buster', 10, 0)], [P('era', 10, 0)]));
  const cannonHits: number[] = [];
  while (!r.done) { r.step(); for (const e of r.events) if (e.t === 'hit' && e.unit === 1 && e.moduleId === 'cannon') cannonHits.push(e.damage); }
  assert.ok(cannonHits.length > 0 && cannonHits[0] < 190 * 0.3, `first cannon hit ${cannonHits[0]}`);
  assert.ok(r.units[1].reactive < 6);
  // mirror: laser hits reduced
  const m = new Battle(input(1, [P('lancer', 10, 0)], [P('mirror', 10, 0)]));
  const mirrorId = m.units.find((u) => u.side === 1)!.id;
  let lh = 0, ln = 0;
  while (!m.done) { m.step(); for (const e of m.events) if (e.t === 'hit' && e.unit === mirrorId && e.moduleId === 'laser' && !e.shieldHit) { lh += e.damage; ln++; } }
  assert.ok(ln > 0 && lh / ln < 24 * 0.6, `laser per hit ${lh / ln}`);
});

test('blocks: size-1 designs spawn a squad of 16 (8x2) at spacing-dependent positions', () => {
  const tight = new Battle(input(1, [P('buggy', 10, 0)], []));
  assert.equal(tight.units.length, 16);
  assert.ok(tight.units.every((u) => u.uid === tight.units[0].uid));
  const wide = new Battle(input(1, [{ ...P('buggy', 10, 0), spacing: 2 }], []));
  assert.equal(wide.units.length, 16);
  const ext = (b: Battle, k: 'x' | 'y') => Math.max(...b.units.map((u) => u[k])) - Math.min(...b.units.map((u) => u[k]));
  assert.equal(ext(tight, 'x'), 7);
  assert.equal(ext(tight, 'y'), 1);
  assert.equal(ext(wide, 'x'), 21);
  assert.equal(ext(wide, 'y'), 3);
  const expect = placementUnitCenters(0, { x: 10, y: 0, spacing: 2 }, { size: 1, squad: 16 });
  assert.deepEqual(wide.units.map((u) => [u.x, u.y]), expect.map((c) => [c.x, c.y]));
  // size-2 / size-3 are single units; spacing is ignored for them
  assert.equal(new Battle(input(1, [{ ...P('bulwark', 10, 0), spacing: 2 }, P('ironclad', 20, 0)], [])).units.length, 2);
});

test('side 1 is mirrored: squads and formations are rotated 180 degrees about the field centre', () => {
  for (const spacing of [0, 1, 2]) {
    const p0 = { ...P('buggy', 5, 1), spacing };
    const a = new SimBattle({ seed: 1, sides: [{ designs: DESIGNS, units: [p0] }, { designs: DESIGNS, units: [{ ...p0 }] }] }); // raw spawn positions
    const s0 = a.units.filter((u) => u.side === 0), s1 = a.units.filter((u) => u.side === 1);
    assert.equal(s0.length, 16);
    assert.equal(s1.length, 16);
    for (let i = 0; i < 16; i++) {
      assert.ok(Math.abs(s1[i].x - (FIELD_W - s0[i].x)) < 1e-9 && Math.abs(s1[i].y - (FIELD_H - s0[i].y)) < 1e-9, `unit ${i} spacing ${spacing}`);
    }
    assert.ok(s0.every((u) => u.y > FIELD_H - DEPLOY_D) && s1.every((u) => u.y < DEPLOY_D), 'each squad starts in its own zone');
  }
});

test('summary: a placement survives while any unit lives; aliveFraction reports the share', () => {
  const b = new Battle(input(1, [P('buggy', 10, 0), P('bulwark', 20, 0)], [P('buggy', 10, 0)]));
  b.step();
  const uid0 = b.units[0].uid;
  for (let i = 0; i < 8; i++) b.units[i].alive = false;
  const s = b.summary();
  assert.equal(s.survivors[0].filter((u) => u === uid0).length, 1);
  assert.equal(s.aliveFraction[0][uid0], 0.5);
  assert.equal(s.aliveFraction[0][b.units[16].uid], 1);
  for (let i = 8; i < 16; i++) b.units[i].alive = false;
  assert.ok(!b.summary().survivors[0].includes(uid0));
});

test('bombers fly over ground targets and bomb them; bombs cannot hit flyers', () => {
  const bomber = D('bomber', 'strikejet', 'jet', ['bombs', null, null]);
  const rotorBomber = D('rotorbomber', 'gunship', 'rotor', ['bombs', null]);
  assert.deepEqual(validateDesign(bomber), []);
  assert.deepEqual(validateDesign(rotorBomber), []);
  const designs = [...DESIGNS, bomber, rotorBomber];
  const run = (a: Placement[], bb: Placement[]) => {
    const b = new Battle({ seed: 5, sides: [{ designs, units: a }, { designs, units: mirrorShift(bb) }] });
    let bombHits = 0, minZ = 99, maxZ = 0;
    while (!b.done) {
      b.step();
      for (const e of b.events) if (e.t === 'hit' && e.moduleId === 'bombs') bombHits++;
      for (const p of b.projectiles ?? []) if (p.moduleId === 'bombs') { minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    }
    return { b, bombHits, minZ, maxZ };
  };
  for (const id of ['bomber', 'rotorbomber']) {
    const g = run([P(id, 10, 0)], [P('bulwark', 10, 0)]);
    assert.ok(g.bombHits > 0, `${id} landed bombs`);
    assert.ok(g.b.summary().damageDealt[0] > 0);
  }
  const air = run([P('rotorbomber', 10, 0)], [P('hornet', 10, 0)]);
  assert.equal(air.bombHits, 0);
  assert.equal(air.b.summary().damageDealt[0], 0);
});

// ---------------------------------------------------------------- target priorities, hold, kite
import { computeStats } from '../src/shared/stats.ts';
import type { TargetPriority } from '../src/shared/types.ts';

function pickedTarget(prio: TargetPriority, enemyA: string, enemyB: string, tweak?: (near: Battle['units'][number], far: Battle['units'][number]) => void): { near: number; far: number; got: number } {
  const b = new Battle(input(1, [{ ...P('sniperw', 10, 0), target: prio, kite: false, focus: false }], [P(enemyA, 8, 0), P(enemyB, 12, 1)]));
  const near = b.units[1], far = b.units[2];
  tweak?.(near, far);
  for (let i = 0; i < 600 && b.units[0].mounts[0].target < 0; i++) b.step();
  for (let i = 0; i < 40; i++) b.step();
  return { near: near.id, far: far.id, got: b.units[0].mounts[0].target };
}

test('target priority: closest / farthest / lowestHp / highestHp', () => {
  let r = pickedTarget('closest', 'bulwark', 'bulwark');
  assert.equal(r.got, r.near);
  r = pickedTarget('farthest', 'bulwark', 'bulwark');
  assert.equal(r.got, r.far);
  // lowestHp picks a damaged unit over a closer healthy one (damaged to 300 hp so the 14-cell sniper, which now
  // fires before the near unit is in range, can't one-shot it before the check)
  r = pickedTarget('lowestHp', 'bulwark', 'bulwark', (_n, f) => { f.hp = 300; });
  assert.equal(r.got, r.far);
  r = pickedTarget('highestHp', 'bulwark', 'bulwark', (_n, f) => { f.hp = 300; });
  assert.equal(r.got, r.near);
});

test('target priority: highestDps / lowestDps', () => {
  const dA = computeStats(DESIGNS.find((d) => d.id === 'gunner')!).dps, dB = computeStats(DESIGNS.find((d) => d.id === 'plaintank')!).dps;
  assert.notEqual(dA, dB);
  const hi = pickedTarget('highestDps', 'gunner', 'plaintank');
  assert.equal(hi.got, dA > dB ? hi.near : hi.far);
  const lo = pickedTarget('lowestDps', 'gunner', 'plaintank');
  assert.equal(lo.got, dA > dB ? lo.far : lo.near);
});

test('target priority: threat retaliates against a long-range attacker, else closest', () => {
  const mk = (prio: TargetPriority) => new Battle(input(1, [{ ...P('sniperw', 10, 0), target: prio }], [P('bulwark', 8, 0), P('bulwark', 12, 1)]));
  const b = mk('threat');
  const none = (() => { for (let i = 0; i < 600 && b.units[0].mounts[0].target < 0; i++) b.step(); return b.units[0].mounts[0].target; })();
  for (let i = 0; i < 40; i++) b.step();
  assert.equal(b.units[0].mounts[0].target, 1, 'no attacker yet -> closest');
  void none;
  // an enemy damages the block: the unit swings to it
  const hook = b as unknown as { blockAtk: number[]; blockAtkT: number[] };
  hook.blockAtk[0] = 2; hook.blockAtkT[0] = b.tick;
  for (let i = 0; i < 8; i++) b.step();
  assert.equal(b.units[0].mounts[0].target, 2);
  // organic: a sniper outranging a bulwark makes the bulwark's block remember it
  const o = new Battle(input(2, [{ ...P('bulwark', 10, 0), target: 'threat' }], [P('bulwark', 6, 0), P('sniperw', 14, 8)]));
  let tracked = false;
  for (let i = 0; i < 400 && !o.done; i++) { o.step(); if ((o as unknown as { blockAtk: number[] }).blockAtk[0] >= 0) tracked = true; }
  assert.ok(tracked, 'attacks are recorded per block');
});

test('hold keeps squad spacing while advancing; no hold lets squads bunch up', () => {
  const run = (hold: boolean) => {
    const b = new Battle(input(3, [{ ...P('buggy', 10, 0), spacing: 2, hold }], [P('ironclad', 10, 0)]));
    let minD = 99;
    for (let i = 0; i < 160 && !b.done; i++) {
      b.step();
      const sq = b.units.filter((u) => u.side === 0 && u.alive);
      if (sq.length < 16) break;
      for (let a = 0; a < sq.length; a++) for (let c = a + 1; c < sq.length; c++) minD = Math.min(minD, Math.hypot(sq[a].x - sq[c].x, sq[a].y - sq[c].y));
    }
    return minD;
  };
  const held = run(true), loose = run(false);
  assert.ok(held >= 2.5, `held min distance ${held}`);
  assert.ok(loose < held, `loose ${loose} vs held ${held}`);
});

test('kite: ranged units back away from enemies that close in', () => {
  const run = (kite: boolean) => {
    const b = new Battle(input(4, [{ ...P('sniperw', 10, 0), kite }], [P('bulwark', 10, 0)]));
    for (let i = 0; i < 270 && !b.done; i++) b.step();
    return { hp: b.units[0].hp, y: b.units[0].y };
  };
  const k = run(true), n = run(false);
  assert.ok(k.hp > n.hp + 100, `kiter hp ${k.hp} vs ${n.hp}`);
  assert.ok(k.y > n.y + 3, `kiter retreated: y ${k.y} vs ${n.y}`);
});

// ---------------------------------------------------------------- new priorities, focus, stances, delay, retreat, escort
/** Move every unit of a placement so its centroid sits at (x, y). */
function teleport(b: Battle, side: 0 | 1, uid: number, x: number, y: number): void {
  const us = b.units.filter((u) => u.side === side && u.uid === uid);
  const cx = us.reduce((a, u) => a + u.x, 0) / us.length, cy = us.reduce((a, u) => a + u.y, 0) / us.length;
  for (const u of us) { u.x += x - cx; u.y += y - cy; }
  (b as unknown as { rebuildHash(): void }).rebuildHash();
}
/** attacker sits at (24, 23); `near` 3 cells away, `far` 5 cells away on the other side; both parked (holdPos). */
function pickFrom(attacker: string, prio: TargetPriority, enemyA: string, enemyB: string, extra: Partial<Placement> = {}): { near: string; far: string; got: string; gotUid: number; nearUid: number; farUid: number } {
  const a = { ...P(attacker, 10, 0), target: prio, ...extra };
  const e1 = { ...P(enemyA, 8, 0), stance: 'holdPos' as const }, e2 = { ...P(enemyB, 12, 1), stance: 'holdPos' as const };
  const b = new Battle(input(1, [a], [e1, e2]));
  teleport(b, 0, a.uid, 24, 23);
  teleport(b, 1, e1.uid, 21, 23);
  teleport(b, 1, e2.uid, 24, 18);
  for (let i = 0; i < 30; i++) b.step();
  const t = b.units[b.units[0].mounts[0].target];
  return { near: enemyA, far: enemyB, got: t?.design.id ?? '', gotUid: t?.uid ?? -1, nearUid: e1.uid, farUid: e2.uid };
}

test('target priority: aircraft prefers flyers, else falls back to closest', () => {
  let r = pickFrom('bulwark', 'aircraft', 'sniperw', 'hornet');
  assert.equal(r.got, 'hornet');
  r = pickFrom('bulwark', 'aircraft', 'sniperw', 'ironclad');
  assert.equal(r.got, 'sniperw');
});

test('target priority: armored / longestRange / support / valuable / swarm', () => {
  const arm = (n: string) => computeStats(DESIGNS.find((d) => d.id === n)!);
  assert.ok(arm('ironclad').armor > arm('gunner').armor);
  let r = pickFrom('sniperw', 'armored', 'gunner', 'ironclad');
  assert.equal(r.got, 'ironclad');
  r = pickFrom('sniperw', 'armored', 'ironclad', 'gunner');
  assert.equal(r.got, 'ironclad');

  assert.ok(arm('sniperw').range > arm('bulwark').range);
  r = pickFrom('sniperw', 'longestRange', 'bulwark', 'sniperw');
  assert.equal(r.got, 'sniperw');
  r = pickFrom('sniperw', 'longestRange', 'sniperw', 'bulwark');
  assert.equal(r.got, 'sniperw');

  r = pickFrom('sniperw', 'support', 'bulwark', 'medic');
  assert.equal(r.got, 'medic');
  r = pickFrom('sniperw', 'support', 'bulwark', 'domer');
  assert.equal(r.got, 'domer');
  r = pickFrom('sniperw', 'support', 'bulwark', 'spotter');
  assert.equal(r.got, 'spotter');
  r = pickFrom('sniperw', 'support', 'medic', 'bulwark');
  assert.equal(r.got, 'medic');

  assert.ok(arm('ironclad').unitCost > arm('bulwark').unitCost);
  r = pickFrom('sniperw', 'valuable', 'bulwark', 'ironclad');
  assert.equal(r.got, 'ironclad');
  r = pickFrom('sniperw', 'valuable', 'ironclad', 'bulwark');
  assert.equal(r.got, 'ironclad');

  assert.ok(arm('ironclad').size > arm('bulwark').size);
  r = pickFrom('sniperw', 'swarm', 'ironclad', 'bulwark');
  assert.equal(r.got, 'bulwark');
  r = pickFrom('sniperw', 'swarm', 'bulwark', 'ironclad');
  assert.equal(r.got, 'bulwark');
  // same size: the cheaper one goes first
  assert.ok(arm('gunner').unitCost < arm('sniperw').unitCost && arm('gunner').size === arm('sniperw').size);
  r = pickFrom('bulwark', 'swarm', 'sniperw', 'gunner');
  assert.equal(r.got, 'gunner');
});

test('focus: units join the target their neighbours already shoot', () => {
  const run = (focus: boolean) => {
    const ally = { ...P('sniperw', 10, 0), target: 'farthest' as const };
    const me = { ...P('sniperw', 12, 0), target: 'closest' as const, focus };
    const e1 = { ...P('bulwark', 8, 0), stance: 'holdPos' as const }, e2 = { ...P('bulwark', 14, 1), stance: 'holdPos' as const };
    const b = new Battle(input(1, [ally, me], [e1, e2]));
    teleport(b, 0, ally.uid, 22, 23);
    teleport(b, 0, me.uid, 26, 23);
    teleport(b, 1, e1.uid, 24, 21); // nearer to `me`
    teleport(b, 1, e2.uid, 24, 15);
    for (let i = 0; i < 60; i++) b.step();
    return { a: b.units[0].mounts[0].target, f: b.units[1].mounts[0].target, far: b.units.find((u) => u.uid === e2.uid)!.id };
  };
  const on = run(true), off = run(false);
  assert.equal(on.a, on.far);
  assert.equal(on.f, on.a, 'focus follows the ally');
  assert.notEqual(off.f, off.a, 'without focus it picks its own');
});

test('stance holdPos: never moves but still fires', () => {
  const run = (stance?: 'holdPos') => {
    const b = new Battle(input(2, [{ ...P('gunner', 10, 0), stance }], [P('brawler', 10, 0)]));
    const x0 = b.units[0].x, y0 = b.units[0].y;
    for (let i = 0; i < 400 && !b.done; i++) b.step();
    return { moved: Math.hypot(b.units[0].x - x0, b.units[0].y - y0), dealt: b.summary().damageDealt[0] };
  };
  const h = run('holdPos'), n = run();
  assert.ok(h.moved < 0.6, `held ${h.moved}`);
  assert.ok(n.moved > 5, `advance ${n.moved}`);
  assert.ok(h.dealt > 0);
});

test('stance charge: closes to contact range instead of stopping to shoot', () => {
  const run = (stance?: 'charge') => {
    const b = new Battle(input(2, [{ ...P('gunner', 10, 0), stance }], [{ ...P('ironclad', 10, 0), stance: 'holdPos' }]));
    let min = 99;
    for (let i = 0; i < 500 && !b.done; i++) {
      b.step();
      min = Math.min(min, Math.hypot(b.units[0].x - b.units[1].x, b.units[0].y - b.units[1].y));
    }
    return min - 1.35; // edge distance to the ironclad
  };
  const range = computeStats(DESIGNS.find((d) => d.id === 'gunner')!).range;
  const c = run('charge'), n = run();
  assert.ok(c < range * 0.4 + 0.4, `charge min edge dist ${c}`);
  assert.ok(c < n - 0.8, `charge ${c} vs advance ${n}`);
});

test('stance flank: swings toward the owner\'s left/right edge before advancing', () => {
  const at = (side: 0 | 1, stance: 'flankLeft' | 'flankRight') => {
    const mine: Placement = { ...P('lancer', 22, 0), stance };
    const far = P('bulwark', 10, 0);
    // flanking steers by the field's own geometry (edges, midline): run it on the real, unshifted field
    const b = new SimBattle(side === 0
      ? { seed: 3, sides: [{ designs: DESIGNS, units: [mine] }, { designs: DESIGNS, units: shift48([{ ...far, x: 22 }]) }] }
      : { seed: 3, sides: [{ designs: DESIGNS, units: [{ ...far, x: 22 }] }, { designs: DESIGNS, units: shift48([mine]) }] });
    const us = b.units.filter((q) => q.side === side);
    const cx = () => us.reduce((a, q) => a + q.x, 0) / us.length, cy = () => us.reduce((a, q) => a + q.y, 0) / us.length;
    const x0 = cx(), y0 = cy();
    for (let i = 0; i < 80; i++) b.step();
    return { dx: cx() - x0, dy: Math.abs(cy() - y0) };
  };
  const l0 = at(0, 'flankLeft'), r0 = at(0, 'flankRight'), l1 = at(1, 'flankLeft'), r1 = at(1, 'flankRight');
  assert.ok(l0.dx < -3 && l0.dy < -l0.dx, `side0 left ${JSON.stringify(l0)}`);
  assert.ok(r0.dx > 3, `side0 right ${JSON.stringify(r0)}`);
  assert.ok(l1.dx > 3, `side1 left ${JSON.stringify(l1)}`);
  assert.ok(r1.dx < -3, `side1 right ${JSON.stringify(r1)}`);
  // a plain advancer barely moves laterally
  const adv = new SimBattle({ seed: 3, sides: [{ designs: DESIGNS, units: [P('lancer', 22, 0)] }, { designs: DESIGNS, units: shift48([{ ...P('bulwark', 22, 0) }]) }] });
  const x0 = adv.units[0].x;
  for (let i = 0; i < 80; i++) adv.step();
  assert.ok(Math.abs(adv.units[0].x - x0) < 2);
});

test('delay: waits before moving but fires at anything in range', () => {
  const g = new Battle(input(2, [{ ...P('gunner', 10, 0), delay: 3 }], [P('bulwark', 10, 0)]));
  const gy = g.units[0].y;
  for (let i = 0; i < 58; i++) g.step();
  assert.equal(g.units[0].y, gy, 'parked at 2.9s');
  for (let i = 0; i < 80; i++) g.step();
  assert.ok(Math.abs(g.units[0].y - gy) > 1, 'moves after the delay');
  // fires while delayed when the enemy is already in range
  const s = { ...P('sniperw', 10, 0), delay: 10 };
  const f = new Battle(input(2, [s], [{ ...P('bulwark', 10, 0), stance: 'holdPos' }]));
  teleport(f, 1, f.units[1].uid, 24, 18);
  teleport(f, 0, s.uid, 24, 23);
  const x0 = f.units[0].y;
  for (let i = 0; i < 100; i++) f.step();
  assert.ok(f.summary().damageDealt[0] > 0, 'delayed sniper still shoots');
  assert.equal(f.units[0].y, x0);
});

test('retreat: a badly hurt unit falls back instead of advancing', () => {
  const run = (retreat: boolean) => {
    const b = new Battle(input(2, [{ ...P('bulwark', 10, 0), retreat }], [P('buster', 10, 0)]));
    b.units[0].hp = b.units[0].maxHp * 0.2;
    const y0 = b.units[0].y;
    for (let i = 0; i < 120 && !b.done; i++) b.step();
    return { dy: b.units[0].y - y0, y: b.units[0].y };
  };
  const r = run(true), n = run(false);
  assert.ok(r.dy > 3, `retreating moved back ${r.dy}`);
  assert.ok(n.dy < 0, `non-retreating advanced ${n.dy}`);
});

test('retreat: heads for a friendly healer, is repaired, then returns to the fight', () => {
  const med = { ...P('medic', 16, 6), stance: 'holdPos' as const };
  const b = new Battle(input(2, [{ ...P('bulwark', 10, 0), retreat: true }, med], [P('dummy', 10, 0)]));
  const u = b.units[0], medic = b.units[1];
  u.hp = u.maxHp * 0.2;
  let near = 99, healedAt = -1;
  for (let i = 0; i < 1500 && !b.done; i++) {
    b.step();
    near = Math.min(near, Math.hypot(u.x - medic.x, u.y - medic.y));
    if (healedAt < 0 && u.hp > u.maxHp * 0.7) healedAt = i;
    if (healedAt >= 0 && i > healedAt + 200) break;
  }
  assert.ok(near < 4, `reached the medic: ${near}`);
  assert.ok(healedAt > 0, 'was repaired past 70%');
  assert.ok(Math.hypot(u.x - medic.x, u.y - medic.y) > 6, 'left the medic after recovering');
});

test('escort: stays near the escorted block; invalid escort target behaves normally', () => {
  const anchor = { ...P('ironclad', 20, 0), stance: 'holdPos' as const };
  const run = (escort?: number) => {
    const b = new Battle(input(2, [anchor, { ...P('buggy', 3, 6), escort }], [{ ...P('bulwark', 3, 0), stance: 'holdPos' }]));
    const E = b.units[0];
    const mine = b.units.filter((u) => u.side === 0 && u.id > 0);
    let late = 0;
    for (let i = 0; i < 300 && !b.done; i++) {
      b.step();
      if (i > 200) late = Math.max(late, ...mine.filter((m) => m.alive).map((m) => Math.hypot(m.x - E.x, m.y - E.y)));
    }
    return late;
  };
  const near = run(anchor.uid);
  assert.ok(near < 4, `escort stays close: ${near}`);
  assert.ok(run(99999) > 8, 'bogus uid ignored');
  assert.ok(run(undefined) > 8, 'no escort');
});

test('escort: a jet circles its slow ground charge instead of streaking away', () => {
  const tank = P('ironclad', 20, 2);
  const run = (escort?: number) => {
    const b = new Battle(input(3, [tank, { ...P('strafer', 4, 0), escort }], [{ ...P('bulwark', 20, 0), stance: 'holdPos' }]));
    const E = b.units[0], jet = b.units.find((u) => u.flying)!;
    let far = 0;
    for (let i = 0; i < 400 && !b.done && E.alive && jet.alive; i++) {
      b.step();
      if (i > 120) far = Math.max(far, Math.hypot(jet.x - E.x, jet.y - E.y));
    }
    return far;
  };
  const esc = run(tank.uid);
  assert.ok(esc < 9, `jet stays on station around its charge: ${esc.toFixed(1)}`);
  assert.ok(run(undefined) > esc + 3, 'unescorted jet ranges much further');
});

test('stances + priorities: 120v120 stays fast and deterministic', () => {
  const stances = ['advance', 'holdPos', 'charge', 'flankLeft', 'flankRight'] as const;
  const prios = ['closest', 'aircraft', 'armored', 'longestRange', 'support', 'valuable', 'swarm', 'threat'] as const;
  const army = (): Placement[] => {
    const out: Placement[] = [];
    const ds = ['buggy', 'gunner', 'ironclad', 'medic', 'lancer'];
    // light designs now spawn 16-unit squads: stop at ~120 sim units per side so this stays a 120v120 test
    let units = 0;
    for (let i = 0; i < 40 && units < 120; i++) {
      const id = ds[i % ds.length];
      units += computeStats(DESIGNS.find((d) => d.id === id)!).squad;
      const big = id === 'ironclad';
      out.push({ ...P(id, (i % 8) * 3, Math.floor(i / 8) * (big ? 3 : 2)), stance: stances[i % 5], target: prios[i % 8], focus: i % 3 === 0, retreat: i % 4 === 0, delay: [0, 3, 6, 10][i % 4] });
    }
    return out;
  };
  const a0 = army(), a1 = mirrorShift(army());
  const inp = (): BattleInput => structuredClone({ seed: 9, sides: [{ designs: DESIGNS, units: a0 }, { designs: DESIGNS, units: a1 }] });
  const t0 = performance.now();
  const a = runBattle(inp());
  const ms = performance.now() - t0;
  assert.deepEqual(runBattle(inp()), a);
  assert.ok(ms < 3000, `took ${ms}ms`);
});

test('titan battle: giants/titans fight, crush smaller units, stay deterministic and fast', () => {
  const titan = D('titanw', 'titan', 'megatracks', ['stormcore', 'siege240', 'cannon', 'cannon', 'autocannon']);
  const giant = D('giantw', 'goliath', 'titanlegs', ['siege240', 'cannon', 'cannon', 'autocannon']);
  const designs = [...DESIGNS, titan, giant];
  for (const d of [titan, giant]) assert.deepEqual(validateDesign(d), [], d.id);
  const mk = (): BattleInput => {
    const a = [P('titanw', 4, 0), P('giantw', 14, 0), P('bulwark', 22, 0), P('buggy', 30, 0)];
    const b = [P('giantw', 4, 0), P('titanw', 12, 0), P('lancer', 24, 0), P('ironclad', 30, 0)];
    return structuredClone({ seed: 11, sides: [{ designs, units: a }, { designs, units: mirrorShift(b) }] });
  };
  const inp = mk();
  const x = new Battle(structuredClone(inp));
  assert.equal(x.units[0].stats.size, 5);
  const t0 = performance.now();
  const r1 = runBattle(inp);
  assert.ok(performance.now() - t0 < 400);
  const inp2 = mk();
  inp2.sides[0].units.forEach((u, i) => { u.uid = inp.sides[0].units[i].uid; });
  inp2.sides[1].units.forEach((u, i) => { u.uid = inp.sides[1].units[i].uid; });
  assert.deepEqual(runBattle(inp2), r1);
  assert.ok(r1.damageDealt[0] > 0 && r1.damageDealt[1] > 0);
  const b = new Battle(structuredClone(inp));
  while (!b.done) {
    b.step();
    for (const u of b.units) if (u.alive) assert.ok(Number.isFinite(u.x) && u.x >= 0 && u.x <= FIELD_W && u.y >= 0 && u.y <= FIELD_H);
  }
});

test('kiteMount: kiting on the mg mount holds closer than kiting on the mortar', () => {
  const mm = D('mortmg', 'warden', 'halftrack', ['mortar', 'mg']);
  assert.deepEqual(validateDesign(mm), []);
  const designs = [...DESIGNS, mm];
  const run = (kiteMount?: number) => {
    const u: Placement = { ...P('mortmg', 10, 0), kite: true, kiteMount };
    const b = new Battle({ seed: 4, sides: [{ designs, units: [u] }, { designs, units: mirrorShift([{ ...P('buggy', 10, 0), stance: 'holdPos' }]) }] });
    // park the enemy squad ahead of side 0's front line (17 cells, as on the original field); the kiter must decide
    // how far to back off
    const ey = FIELD_H - DEPLOY_D - 17;
    const en = b.units.filter((x) => x.side === 1);
    en.forEach((x, i) => { x.x = 24 + (i % 2); x.y = ey + (i >> 1); });
    (b as unknown as { rebuildHash(): void }).rebuildHash();
    for (let i = 0; i < 200; i++) b.step();
    return Math.hypot(b.units[0].x - 24, b.units[0].y - (ey + 0.5));
  };
  const onMortar = run(0), onMg = run(1), dflt = run();
  assert.ok(onMg < onMortar - 1, `mg ${onMg} vs mortar ${onMortar}`);
  assert.ok(Math.abs(dflt - onMortar) < 0.5, 'default = longest-range weapon');
});

test('kite: an outranged kiter closes in to its own firing range (from its mount) and never backs off while out of range', () => {
  // flamerear: a rear-mounted short-range gun (the old hull-centre distance parked it just out of reach for good)
  const rear = D('flamerear', 'longarm', 'treads', ['flamer']);
  assert.deepEqual(validateDesign(rear), []);
  const designs = [...DESIGNS, rear];
  for (const kd of ['flamerear', 'mgtank']) {
    const b = new Battle({ seed: 3, sides: [{ designs, units: [{ ...P(kd, 10, 0), kite: true }] }, { designs, units: mirrorShift([{ ...P('sniperw', 10, 0), stance: 'holdPos' }]) }] });
    const k = b.units[0], e = b.units[1];
    e.x = k.x; e.y = k.y - 20;
    (b as unknown as { rebuildHash(): void }).rebuildHash();
    const hp0 = e.hp;
    let prev = Infinity, hitAt = -1;
    for (let i = 0; i < 500 && !b.done && hitAt < 0; i++) {
      b.step();
      const d = Math.hypot(k.x - e.x, k.y - e.y);
      if (e.hp < hp0) hitAt = i;
      else assert.ok(d <= prev + 1e-9, `${kd} backed off while out of range at tick ${i}: ${d} > ${prev}`);
      prev = d;
    }
    assert.ok(hitAt >= 0 && e.hp < hp0, `${kd} never damaged the longer-ranged enemy`);
  }
});

test('default orders: kite / focus derived from the design; unset placements use them, explicit values win', () => {
  const des = (id: string) => DESIGNS.find((d) => d.id === id)!;
  const want: Record<string, [boolean, boolean]> = {
    sniperw: [true, true], arty: [true, true], mortartruck: [true, true], // long guns: kite + focus
    bulwark: [false, true], gunner: [false, true], buggy: [false, true], // frontline-range guns: focus only
    torch: [false, false], brawler: [false, false], sonic: [false, false], // flamers / melee / short range: neither
    spire: [false, true], hornet: [false, true], // static / flying: never kite by default
  };
  for (const [id, [kite, focus]] of Object.entries(want)) assert.deepEqual(defaultOrders(des(id)), { kite, focus }, id);
  type Ints = { ints: { kite: boolean; focus: boolean }[] };
  const mk = (pl: Placement) => new Battle({ seed: 1, sides: [{ designs: DESIGNS, units: [pl] }, { designs: DESIGNS, units: mirrorShift([P('bulwark', 10, 0)]) }] }) as unknown as Ints;
  const unset = mk(P('sniperw', 10, 0)).ints[0];
  assert.deepEqual([unset.kite, unset.focus], [true, true]);
  const off = mk({ ...P('sniperw', 10, 0), kite: false, focus: false }).ints[0];
  assert.deepEqual([off.kite, off.focus], [false, false]);
  const on = mk({ ...P('bulwark', 10, 0), kite: true }).ints[0];
  assert.deepEqual([on.kite, on.focus], [true, true]);
});

test('non-square footprints: long units spawn on their footprint centre and contact uses the long axis', () => {
  const long = D('longone', 'longarm', 'halftrack', ['cannon']); // 1 wide x 3 long
  const designs = [...DESIGNS, long];
  const st = computeStats(long);
  assert.equal(st.fh, 3);
  const mk = (blocks: Placement[]) => new Battle({ seed: 3, sides: [{ designs, units: blocks }, { designs, units: [] }] });
  const b = mk([P('longone', 10, 2)]);
  const c = placementUnitCenters(0, { x: 10, y: 2 }, st)[0];
  assert.deepEqual([b.units[0].x, b.units[0].y], [c.x, c.y]);
  assert.deepEqual([c.x, c.y], [10.5, FIELD_H - DEPLOY_D + 2 + 1.5]);
  // deterministic and still resolves a full fight
  const a0 = [P('longone', 4, 0), P('longone', 8, 0)], a1 = mirrorShift([P('buggy', 4, 0), P('bulwark', 20, 0)]);
  const inp = (): BattleInput => structuredClone({ seed: 5, sides: [{ designs, units: a0 }, { designs, units: a1 }] });
  assert.deepEqual(runBattle(inp()), runBattle(inp()));
});


test('ranged units stop advancing once all weapons are in range (no bum-rush), even fire-on-move walkers', () => {
  const walker = D('rangewalker', 'strider', 'legs', ['autocannon', null, null]);
  const wall = D('rangewall', 'bastion', 'anchor', ['flak', 'plateM', 'plateM']); // air-only gun: can't shoot back at the walker
  assert.deepEqual(validateDesign(walker), []);
  const designs = [walker, wall];
  const b = new Battle({ seed: 9, sides: [
    { designs, units: [{ uid: 1, designId: 'rangewalker', x: 23, y: 0, level: 1, round: 1 }] },
    { designs, units: [{ uid: 1, designId: 'rangewall', x: 22, y: 0, level: 1, round: 1 }] },
  ] });
  const w = b.units[0], t = b.units[1];
  const range = 6 * w.stats.rangeMult;
  let firstShotTick = -1;
  for (let i = 0; i < 20 * 70 && !b.done; i++) {
    b.step();
    if (firstShotTick < 0 && b.events.some((e) => e.t === 'fire' && e.unit === w.id)) firstShotTick = b.tick;
  }
  assert.ok(firstShotTick > 0, 'walker should start shooting');
  // edge-to-edge gap to the wall stays a decent fraction of the weapon range instead of closing to contact
  const gap = Math.hypot(t.x - w.x, t.y - w.y) - 1.5 - 1;
  assert.ok(gap > range * 0.6, `walker closed to ${gap.toFixed(2)} cells (range ${range})`);
});

// ---------------------------------------------------------------- regressions (sim bug hunt)

/** one unit per side, side 1's unit parked `dist` cells straight ahead of side 0's (hash rebuilt) */
function duel(designs: Design[], a: Partial<Placement> & { designId: string }, b: Partial<Placement> & { designId: string }, dist: number, seed = 1) {
  const pl = (p: Partial<Placement> & { designId: string }): Placement => ({ uid: 1, x: 40, y: 0, level: 1, round: 1, ...p });
  const bt = new SimBattle({ seed, sides: [{ designs, units: [pl(a)] }, { designs, units: [pl(b)] }] });
  const k = bt.units[0], e = bt.units[1];
  e.x = k.x; e.y = k.y - dist; e.angle = Math.PI / 2;
  (bt as unknown as { rebuildHash(): void }).rebuildHash();
  return { b: bt, k, e };
}

test('kite: a rapid-fire secondary gun does not pin a backing-off kiter in place', () => {
  // the mg (0.15 s cooldown) was always "about to fire", so the mortar carrier never backed away and died in place
  const designs = [D('mortmg', 'warden', 'halftrack', ['mortar', 'mg']), D('mortonly', 'warden', 'halftrack', ['mortar', null]), DESIGNS.find((d) => d.id === 'bulwark')!];
  const run = (id: string) => {
    const { b, k, e } = duel(designs, { designId: id, kite: true }, { designId: 'bulwark', kite: false }, 5);
    for (let i = 0; i < 120 && !b.done; i++) b.step();
    return Math.hypot(k.x - e.x, k.y - e.y);
  };
  const withMg = run('mortmg'), without = run('mortonly');
  assert.ok(withMg > 8, `mortar + mg kiter stayed at ${withMg.toFixed(2)} cells`);
  assert.ok(Math.abs(withMg - without) < 1.5, `mg ${withMg.toFixed(2)} vs mortar-only ${without.toFixed(2)}`);
});

test('kite: a disarmed kiter keeps backing off instead of waiting to fire a gun that cannot fire', () => {
  const designs = [D('mortonly', 'warden', 'halftrack', ['mortar', null]), DESIGNS.find((d) => d.id === 'bulwark')!];
  const { b, k, e } = duel(designs, { designId: 'mortonly', kite: true }, { designId: 'bulwark', kite: false }, 5);
  const K = (b as unknown as { ints: { disarmDmg: number }[] }).ints[0];
  for (let i = 0; i < 100 && !b.done; i++) { K.disarmDmg = k.maxHp * 1.1; b.step(); }
  assert.ok(k.disarm > 0);
  assert.ok(Math.hypot(k.x - e.x, k.y - e.y) > 8, `disarmed kiter stayed at ${Math.hypot(k.x - e.x, k.y - e.y).toFixed(2)}`);
});

test('hold: outer squad members whose formation slot lies beyond their range still close in and fire', () => {
  // a spaced-out (22 cells wide) mg squad on hold vs one emplacement: the outer half parked at their slots around the
  // target, 6-9 cells out with 5.5-cell guns, and never fired
  const fort = D('flakfort', 'bastion', 'anchor', ['flak', 'plateH', 'plateM']); // air-only gun: can't shoot back
  assert.deepEqual(validateDesign(fort), []);
  const designs = [DESIGNS.find((d) => d.id === 'buggy')!, fort];
  const b = new SimBattle({ seed: 2, sides: [
    { designs, units: [{ uid: 1, designId: 'buggy', x: 37, y: 0, level: 1, round: 1, spacing: 2, hold: true, kite: false }] },
    { designs, units: [{ uid: 1, designId: 'flakfort', x: 46, y: 0, level: 3, round: 1 }] },
  ] });
  const fired = new Set<number>();
  for (let i = 0; i < 20 * 45 && !b.done; i++) { b.step(); for (const e of b.events) if (e.t === 'fire' && b.units[e.unit].side === 0) fired.add(e.unit); }
  assert.equal(fired.size, 16, `${fired.size}/16 squad members ever fired`);
});

test('fire-on-move units close to the range of the guns that can hit the goal, not an air-only long gun', () => {
  // titan legs fire on the move; the 18-cell flak fortress is air-only. It used to park ~12 cells from a ground target,
  // out of reach of every gun that could hit it, for the rest of the battle.
  const t = D('aatitan', 'titan', 'titanlegs', ['skyfortress', 'stormtower', null, null, null]);
  const tgt = D('anchoredflak', 'warden', 'anchor', ['flak', null]); // can't shoot back at ground
  assert.deepEqual(validateDesign(t), []);
  assert.deepEqual(validateDesign(tgt), []);
  const { b, e } = duel([t, tgt], { designId: 'aatitan', kite: false }, { designId: 'anchoredflak' }, 25);
  const hp0 = e.hp;
  for (let i = 0; i < 20 * 30 && !b.done; i++) b.step();
  assert.ok(e.hp < hp0, 'the titan never got its storm tower in range');
});

test('railguns hit big hulls whose edge is in range (rail reach measured to the footprint)', () => {
  const r = D('railer', 'warden', 'halftrack', ['lightrail', null]);
  const designs = [r, DESIGNS.find((d) => d.id === 'bulwark')!, DESIGNS.find((d) => d.id === 'titanW')!];
  for (const target of ['bulwark', 'titanW']) {
    const { b, k, e } = duel(designs, { designId: 'railer', kite: false }, { designId: target, stance: 'holdPos' }, 30);
    let fires = 0, hits = 0;
    for (let i = 0; i < 400 && !b.done; i++) {
      b.step();
      for (const ev of b.events) { if (ev.t === 'fire' && ev.unit === k.id) fires++; if (ev.t === 'hit' && ev.unit === e.id) hits++; }
    }
    assert.ok(fires > 0, `${target}: railer never fired`);
    assert.equal(hits, fires, `${target}: ${hits} of ${fires} rail shots hit`);
  }
});

test('flames reach a long hull seen end-on (projectiles hit the capsule, not the mean-radius circle)', () => {
  // the flamer parks once the centipede's nose (box edge) is in range; its 1.4-radius circle sat beyond the flames,
  // so 180 shots in a row missed and the duel never ended
  const f = D('flameunit', 'warden', 'halftrack', ['flamer', null]);
  const centi = D('centi', 'centipede', 'treads', ['flak', null, null, null]);
  assert.deepEqual(validateDesign(centi), []);
  const { b, k, e } = duel([f, centi], { designId: 'flameunit', kite: false }, { designId: 'centi', stance: 'holdPos' }, 30);
  let fires = 0, hits = 0;
  for (let i = 0; i < 500 && !b.done; i++) {
    b.step();
    for (const ev of b.events) { if (ev.t === 'fire' && ev.unit === k.id) fires++; if (ev.t === 'hit' && ev.unit === e.id) hits++; }
  }
  assert.ok(fires > 20, `fires ${fires}`);
  assert.ok(hits > fires / 2, `${hits} hits of ${fires} flames`);
});

test('the biggest hull (10x10 weaver titan) is found by the spatial hash: splash at its edge hits it', () => {
  // MAX_RADIUS (gather margin) was 4.0 while the arachne's footprint reaches 4.5 from its centre
  const big = D('weaver', 'arachne', 'spider', ['massdriver', 'flak', 'stormtower', 'railgun']);
  assert.deepEqual(validateDesign(big), []);
  const { b, e } = duel([big, DESIGNS.find((d) => d.id === 'bulwark')!], { designId: 'bulwark' }, { designId: 'weaver', stance: 'holdPos' }, 40);
  // impact 0.2 outside the hull edge (hullK * 10 from the centre), placed so the hull's hash cell lies just past the
  // impact's gather box at a too-small margin
  e.x = 37.5 + hullK(5) * 10 + 0.2; e.y = 40.5;
  (b as unknown as { rebuildHash(): void }).rebuildHash();
  const hp0 = e.hp;
  (b as unknown as { splash(...a: unknown[]): void }).splash(37.5, 40.5, 0.3, 500, 1, 1, 0, false, 'cannon', -1, false);
  assert.ok(e.hp < hp0, 'splash 0.2 cells from the hull edge missed it');
});

type SP = { id: number; moduleId: string; kind: string; tx: number; ty: number; sx: number; sy: number; src: number; target: number; speed: number; total: number; x: number; y: number; z: number };
const simProjs = (b: Battle) => (b as unknown as { projs: SP[] }).projs;

test('salvo: rocket and missile batteries ripple-fire the burst, rockets scatter into a random cloud', () => {
  for (const [design, mod, n] of [['mlrsTruck', 'mlrs', 12], ['rocketeer', 'rockets', 4], ['swarmer', 'swarm', 8]] as const) {
    const b = new Battle(input(5, [P(design, 10, 0)], [{ ...P('bulwark', 10, 0), stance: 'holdPos' }]));
    const seen = new Map<number, SP & { tick: number }>();
    let fires = 0;
    while (!b.done && b.tick < 20 * 40 && seen.size < n) {
      b.step();
      fires += b.events.filter((e) => e.t === 'fire' && e.moduleId === mod).length;
      for (const p of simProjs(b)) if (p.moduleId === mod && p.src === 0 && !seen.has(p.id)) seen.set(p.id, { ...p, tick: b.tick });
    }
    const rounds = [...seen.values()];
    assert.equal(rounds.length, n, `${mod}: all ${n} rounds launched`);
    assert.equal(fires, 1, `${mod}: one launch event per salvo`);
    const ticks = rounds.map((r) => r.tick);
    const span = Math.max(...ticks) - Math.min(...ticks);
    assert.ok(span >= n - 1 && span <= 2 * (n - 1), `${mod}: tubes ripple-fire over ${span} ticks, not all at once`);
    assert.equal(new Set(ticks).size, n, `${mod}: one tube per launch tick`);
    if (mod === 'swarm') continue; // homing missiles fly to their targets, not to scattered points
    let minD = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) minD = Math.min(minD, Math.hypot(rounds[i].tx - rounds[j].tx, rounds[i].ty - rounds[j].ty));
    assert.ok(minD > 0.15, `${mod}: impact points are spread out (closest pair ${minD.toFixed(3)} cells apart)`);
    // the impact points fill an area (both principal axes of their spread are substantial), not a line / flat fan
    const mx = rounds.reduce((a, r) => a + r.tx, 0) / n, my = rounds.reduce((a, r) => a + r.ty, 0) / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (const r of rounds) { sxx += (r.tx - mx) ** 2; syy += (r.ty - my) ** 2; sxy += (r.tx - mx) * (r.ty - my); }
    const tr = sxx + syy, det = sxx * syy - sxy * sxy, d = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + d, l2 = tr / 2 - d;
    assert.ok(l2 / l1 > 0.15, `${mod}: impact cloud is 2-D (axis ratio ${(l2 / l1).toFixed(3)})`);
    if (n >= 12) {
      // a disc, not a ring or a spiral arm: points both near the centre and out at the edge, all round
      const ds = rounds.map((r) => Math.hypot(r.tx - mx, r.ty - my)), R = Math.max(...ds);
      assert.ok(ds.some((x) => x < R * 0.5), `${mod}: some impacts land near the middle of the cloud`);
      const quad = new Set(rounds.map((r) => (r.tx > mx ? 1 : 0) + (r.ty > my ? 2 : 0)));
      assert.equal(quad.size, 4, `${mod}: impacts fall all round the aim point`);
    }
  }
});

test('missiles boost: they leave the launcher slow and speed up; flight times stay as at constant speed', () => {
  for (const [design, mod, foe] of [['hunter', 'atgm', 'fortress'], ['swarmer', 'swarm', 'fortress'], ['cruiser', 'cruise', 'fortress'], ['rocketeer', 'rockets', 'fortress']] as const) {
    const b = new Battle(input(3, [P(design, 10, 0)], [{ ...P(foe, 10, 0), stance: 'holdPos' }]));
    const spd = MODULE_BY_ID.get(mod)!.projectileSpeed!;
    const track = new Map<number, { t0: number; t1: number; total: number; v: number[] }>();
    while (!b.done && b.tick < 20 * 60) {
      b.step();
      const live = new Set<number>();
      for (const p of simProjs(b)) {
        if (p.moduleId !== mod || p.src !== 0) continue;
        live.add(p.id);
        let r = track.get(p.id);
        if (!r) track.set(p.id, (r = { t0: b.tick - 1, t1: -1, total: p.total, v: [] }));
        r.v.push(p.speed);
      }
      for (const [id, r] of track) if (r.t1 < 0 && !live.has(id)) r.t1 = b.tick;
      if ([...track.values()].filter((r) => r.t1 >= 0).length >= 6) break;
    }
    const done = [...track.values()].filter((r) => r.t1 >= 0 && r.v.length > 4);
    assert.ok(done.length >= 2, `${mod}: rounds landed (${done.length})`);
    const ratio = done.reduce((a, r) => a + ((r.t1 - r.t0) / 20) / (r.total / spd), 0) / done.length;
    assert.ok(ratio > 0.85 && ratio < 1.15, `${mod}: mean flight time ${ratio.toFixed(3)} x the constant-speed time`);
    if (mod === 'rockets') continue; // rockets: the path parameter accelerates (speed field unused)
    for (const r of done) {
      assert.ok(r.v[0] < 0.6 * Math.max(...r.v), `${mod}: launch speed ${r.v[0].toFixed(2)} well below top ${Math.max(...r.v).toFixed(2)}`);
      for (let i = 1; i < r.v.length; i++) assert.ok(r.v[i] >= r.v[i - 1] - 1e-9, `${mod}: speed never drops in flight`);
    }
  }
});

test('guided volleys split over several weak targets, but all go to one tough target', () => {
  // weak targets: a row of buggies (one swarm missile kills each with margin) -> the 8 missiles spread out
  {
    const b = new Battle(input(4, [P('swarmer', 10, 0)], [0, 2, 4, 6, 8].map((x) => ({ ...P('buggy', 6 + x, 0), stance: 'holdPos' as const }))));
    for (const u of b.units) if (u.side === 1) { u.hp = 20; u.maxHp = 20; u.shield = 0; }
    const targets = new Map<number, number>();
    while (!b.done && b.tick < 20 * 40 && targets.size < 8) {
      b.step();
      for (const p of simProjs(b)) if (p.moduleId === 'swarm' && p.src === 0 && !targets.has(p.id)) targets.set(p.id, p.target);
    }
    const distinct = new Set([...targets.values()].filter((t) => t >= 0));
    assert.ok(distinct.size > 1, `swarm volley spread over ${distinct.size} targets`);
  }
  // one tough target: every missile of the volley goes for it
  {
    const b = new Battle(input(4, [P('swarmer', 10, 0)], [{ ...P('fortress', 10, 0), stance: 'holdPos' }]));
    const targets = new Map<number, number>();
    while (!b.done && b.tick < 20 * 40 && targets.size < 8) {
      b.step();
      for (const p of simProjs(b)) if (p.moduleId === 'swarm' && p.src === 0 && !targets.has(p.id)) targets.set(p.id, p.target);
    }
    assert.equal(targets.size, 8);
    assert.deepEqual([...new Set(targets.values())], [b.units[1].id], 'all missiles on the one target');
  }
});

test('unguided rocket salvos keep saturating one aim point even when it overkills', () => {
  const b = new Battle(input(4, [P('mlrsTruck', 10, 0)], [0, 2, 4, 6].map((x) => ({ ...P('buggy', 7 + x, 0), stance: 'holdPos' as const }))));
  for (const u of b.units) if (u.side === 1) { u.hp = 10; u.maxHp = 10; u.shield = 0; }
  const seen = new Map<number, SP>();
  while (!b.done && b.tick < 20 * 40 && seen.size < 12) {
    b.step();
    for (const p of simProjs(b)) if (p.moduleId === 'mlrs' && p.src === 0 && !seen.has(p.id)) seen.set(p.id, p);
  }
  const rs = [...seen.values()];
  const mx = rs.reduce((a, r) => a + r.tx, 0) / rs.length, my = rs.reduce((a, r) => a + r.ty, 0) / rs.length;
  assert.ok(rs.every((r) => Math.hypot(r.tx - mx, r.ty - my) < 4), 'one cloud round a single aim point');
});

test('overkill: shooters do not pile onto a target that rounds in flight will already kill', () => {
  // three snipers, two enemies; the near one dies to a single hit. Without overkill prevention every sniper takes it.
  const b = new Battle(input(3, [
    { ...P('sniperw', 6, 0), target: 'closest', focus: false },
    { ...P('sniperw', 10, 0), target: 'closest', focus: false },
    { ...P('sniperw', 14, 0), target: 'closest', focus: false },
  ], [{ ...P('bulwark', 10, 0), stance: 'holdPos' }, { ...P('bulwark', 16, 2), stance: 'holdPos' }]));
  const near = b.units[3];
  near.hp = 20; near.shield = 0;
  type PP = { id: number; aimT: number };
  const seen = new Set<number>();
  let atNear = 0;
  for (let i = 0; i < 20 * 20 && near.alive; i++) {
    b.step();
    for (const p of (b as unknown as { projs: PP[] }).projs) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      if (p.aimT === near.id) atNear++;
    }
  }
  assert.equal(near.alive, false);
  assert.equal(atNear, 1, 'only one round is spent on the doomed unit');
});

test('spin-up: a rotary gun starts slow and reaches full rate after continuous fire', () => {
  const b = new Battle(input(1, [P('gunner', 10, 0)], [{ ...P('fortress', 9, 0), stance: 'holdPos' }]));
  const ticks: number[] = [];
  while (!b.done && b.tick < 20 * 40 && ticks.length < 80) {
    b.step();
    for (const e of b.events) if (e.t === 'fire' && e.unit === 0) ticks.push(b.tick);
  }
  const gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
  // (the very first gap can be short: a ready gun carries its sub-tick remainder)
  const early = gaps.slice(1, 5).reduce((a, g) => a + g, 0) / 4;
  assert.ok(early >= 2.2, `first shots come slowly (${gaps.slice(0, 6)} ticks apart)`);
  const late = gaps.slice(-20);
  assert.ok(late.every((g) => g === 1), `spun up: one round per tick (${late})`);
});

test('focus beam: damage ramps up while it stays on one target', () => {
  const b = new Battle(input(1, [P('focus', 10, 0)], [{ ...P('fortress', 9, 0), stance: 'holdPos' }]));
  const dmg: number[] = [];
  while (!b.done && b.tick < 20 * 40 && dmg.length < 40) {
    b.step();
    for (const e of b.events) if (e.t === 'hit' && e.moduleId === 'twinlaser') dmg.push(e.damage);
  }
  assert.ok(dmg.length >= 30, `hits ${dmg.length}`);
  assert.ok(dmg[dmg.length - 1] > 2.2 * dmg[0], `ramped from ${dmg[0].toFixed(1)} to ${dmg[dmg.length - 1].toFixed(1)}`);
});

test('fire field: a firebomb leaves a burning patch that sets units inside alight', () => {
  const b = new Battle(input(2, [{ ...P('firebomber', 10, 0), stance: 'holdPos' }], [P('bulwark', 10, 0)]));
  let field: { x: number; y: number; radius: number } | null = null;
  while (!b.done && b.tick < 20 * 60 && !field) {
    b.step();
    for (const e of b.events) if (e.t === 'fireField') field = e;
  }
  assert.ok(field, 'a fire field was laid');
  // drop a fresh enemy into the patch: it catches fire although no shell hit it
  const v = b.units[1];
  v.x = field.x; v.y = field.y; v.burning = 0; v.shield = 0; v.auraShield = 0;
  (b as unknown as { rebuildHash(): void }).rebuildHash();
  for (let i = 0; i < 12; i++) b.step();
  assert.ok(v.burning > 0, 'unit standing in the fire field burns');
});

test('cluster shell: the landing releases bomblets that burst across the area', () => {
  const b = new Battle(input(3, [{ ...P('clusterarty', 10, 0), stance: 'holdPos' }], [{ ...P('bulwark', 10, 0), stance: 'holdPos' }]));
  type PP = { moduleId: string; tx: number; ty: number; src: number; cl: unknown };
  const projs = () => (b as unknown as { projs: PP[] }).projs.filter((p) => p.moduleId === 'clusterhow');
  let bomblets: PP[] = [];
  while (!b.done && b.tick < 20 * 60 && bomblets.length === 0) {
    b.step();
    bomblets = projs().filter((p) => p.cl === null);
  }
  assert.equal(bomblets.length, 10, 'ten bomblets released on landing');
  let minD = Infinity;
  for (let i = 0; i < bomblets.length; i++) for (let j = i + 1; j < bomblets.length; j++) minD = Math.min(minD, Math.hypot(bomblets[i].tx - bomblets[j].tx, bomblets[i].ty - bomblets[j].ty));
  assert.ok(minD > 0.05, 'bomblets scatter to separate points');
  let blasts = 0;
  for (let i = 0; i < 40; i++) { b.step(); blasts += b.events.filter((e) => e.t === 'explode' && e.moduleId === 'clusterhow').length; }
  assert.ok(blasts >= 10, `bomblets burst (${blasts} blasts)`);
});

test('flechettes pierce: one dart can hit several units in a line', () => {
  const b = new Battle(input(4, [{ ...P('flechetter', 10, 0), stance: 'holdPos' }], [{ ...P('buggy', 10, 0), stance: 'holdPos' }]));
  type PP = { moduleId: string; hits: number[] };
  let maxHits = 0;
  // line the enemy squad up straight in front of the gun
  const shooter = b.units[0];
  const foes = b.units.filter((u) => u.side === 1);
  foes.forEach((u, i) => { u.x = shooter.x + (i % 2) * 0.1; u.y = shooter.y - 3 - i * 0.6; });
  (b as unknown as { rebuildHash(): void }).rebuildHash();
  for (let i = 0; i < 20 * 6 && !b.done; i++) {
    b.step();
    for (const p of (b as unknown as { projs: PP[] }).projs) if (p.moduleId === 'flechette') maxHits = Math.max(maxHits, p.hits.length);
  }
  assert.ok(maxHits >= 2, `a dart passed through ${maxHits} units`);
});
