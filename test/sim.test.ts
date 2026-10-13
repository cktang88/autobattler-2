import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle, runBattle } from '../src/shared/sim/battle.ts';
import { MAX_TICKS } from '../src/shared/sim/types.ts';
import { FIELD_H, FIELD_W } from '../src/shared/grid.ts';
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
  D('fortress', 'bastion', 'treads', ['plateH', 'plateM', 'repairM']),
  D('fortgun', 'bastion', 'treads', ['plateH', 'plateM', 'autocannon']),
  D('rotorflak', 'drone', 'rotor', ['aamissile']),
  D('dummy', 'raider', 'halftrack', ['plateL', 'repair']),
  D('sniper', 'scout', 'halftrack', ['sniper']),
  D('gunner', 'warden', 'halftrack', ['minigun', null]),
  D('sonic', 'warden', 'halftrack', ['sonic', null]),
  D('disarmer', 'warden', 'halftrack', ['disarm', null]),
  D('pulse', 'warden', 'halftrack', ['twinlaser', null]),
  D('brawler', 'raider', 'halftrack', ['buzzsaw', 'buzzsaw']),
  D('runner', 'scout', 'wheels', ['buzzsaw']),
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
];

test('test designs are legal', () => {
  for (const d of DESIGNS) assert.deepEqual(validateDesign(d), [], d.id);
});

let uidSeq = 1;
const P = (designId: string, x: number, y: number, level = 1): Placement => ({ uid: uidSeq++, designId, x, y, level, round: 1 });
// Tests were laid out on a 24-wide field; shift side 1's local x so its units keep the same world columns
// (facing side 0) on wider fields.
const mirrorShift = (b: Placement[]) => b.map((p) => ({ ...p, x: p.x + (FIELD_W - 24) }));
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
    for (const u of b.units) assert.ok(u.x >= 0 && u.x <= FIELD_W && u.y >= 0 && u.y <= FIELD_H, `unit ${u.id} out of bounds`);
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
  // 6-shot magazine at 0.15s, then a 1.5s reload
  assert.ok(gaps.slice(0, 5).every((g) => g < 0.3), `gaps ${gaps.slice(0, 8)}`);
  assert.ok(gaps[5] >= 1.4, `reload gap ${gaps[5]}`);
});

test('accuracy: sniper is pinpoint, minigun sprays', () => {
  const sn = fireLog(new Battle(input(3, [P('sniper', 10, 0)], [P('dummy', 10, 0)])));
  const mg = fireLog(new Battle(input(3, [P('gunner', 10, 0)], [P('dummy', 10, 0)])));
  const ratio = (r: ReturnType<typeof fireLog>, id: string) => (r.hits[id] ?? 0) / r.fires.filter((f) => f.moduleId === id).length;
  const rs = ratio(sn, 'sniper'), rm = ratio(mg, 'minigun');
  assert.ok(rs > 0.9, `sniper ${rs}`);
  assert.ok(rm < rs - 0.1, `minigun ${rm} vs sniper ${rs}`);
});

test('impulse knocks units back; disarm stops firing', () => {
  const b = new Battle(input(2, [P('sonic', 10, 0)], [P('dummy', 10, 0)]));
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
  const b = new Battle(input(1, [P('brawler', 10, 0)], [P('dummy', 10, 0)]));
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

test('arc shells land where the target was: fast movers dodge, parked targets do not', () => {
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
  assert.ok(fast.per < parked.per * 0.4, `fast ${fast.per} vs parked ${parked.per}`);
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

  const d = new Battle(input(1, [P('ghost', 10, 0)], [P('spire', 10, 0), P('spotter', 12, 0)]));
  let revealedEarly = false, gf = false;
  while (!d.done) {
    d.step();
    for (const e of d.events) if (e.t === 'fire' && e.unit === 0) gf = true;
    if (!gf && !d.units[0].cloaked) revealedEarly = true; // the sensor uncloaked it before it ever fired
  }
  assert.ok(revealedEarly);
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

test('defensive systems: hardened, shield dome, reactive armor, mirror coating', () => {
  // hardened: stun guns never stun it
  const h = new Battle(input(1, [P('zapper', 10, 0)], [P('hardtank', 10, 0)]));
  while (!h.done) { h.step(); assert.equal(h.units[1].stun, 0); }
  // dome: neighbours start with projected shield, the dome itself doesn't
  const d = new Battle(input(1, [P('domer', 10, 0), P('buggy', 9, 0), P('buggy', 14, 1)], [P('buggy', 10, 0)]));
  d.step();
  assert.ok(d.units[1].auraShield > 0 && d.units[2].auraShield > 0);
  assert.equal(d.units[0].maxAuraShield, 0);
  // reactive: charges are consumed by explosive hits and blunt them
  const r = new Battle(input(1, [P('buster', 10, 0)], [P('era', 10, 0)]));
  const cannonHits: number[] = [];
  while (!r.done) { r.step(); for (const e of r.events) if (e.t === 'hit' && e.unit === 1 && e.moduleId === 'cannon') cannonHits.push(e.damage); }
  assert.ok(cannonHits.length > 0 && cannonHits[0] < 190 * 0.3, `first cannon hit ${cannonHits[0]}`);
  assert.ok(r.units[1].reactive < 6);
  // mirror: laser hits reduced
  const m = new Battle(input(1, [P('lancer', 10, 0)], [P('mirror', 10, 0)]));
  let lh = 0, ln = 0;
  while (!m.done) { m.step(); for (const e of m.events) if (e.t === 'hit' && e.unit === 1 && e.moduleId === 'laser' && !e.shieldHit) { lh += e.damage; ln++; } }
  assert.ok(ln > 0 && lh / ln < 24 * 0.6, `laser per hit ${lh / ln}`);
});
