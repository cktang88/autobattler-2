import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle, runBattle } from '../src/shared/sim/battle.ts';
import { MAX_TICKS } from '../src/shared/sim/types.ts';
import { FIELD_H, FIELD_W, placementUnitCenters } from '../src/shared/grid.ts';
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
  D('mgtank', 'warden', 'halftrack', ['mg', null]),
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

test('performance: 240 units per side (15 light squads) simulates in well under 500ms', () => {
  const small = ['buggy', 'torch', 'lancer', 'hornet', 'hopper', 'zapper'];
  const army = () => {
    const out: Placement[] = [];
    for (let i = 0; i < 15; i++) out.push({ ...P(small[i % small.length], (i % 5) * 9, Math.floor(i / 5) * 3), spacing: i % 2 });
    return out;
  };
  const inp = (): BattleInput => ({ seed: 42, sides: [{ designs: DESIGNS, units: army() }, { designs: DESIGNS, units: army() }] });
  runBattle(inp()); // warm up JIT
  const t0 = performance.now();
  const s = runBattle(inp());
  const ms = performance.now() - t0;
  console.log(`  240v240: ${ms.toFixed(0)}ms, ${s.ticks} ticks, winner ${s.winner}`);
  assert.ok(ms < 500, `took ${ms}ms`);
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
  const expect = placementUnitCenters(0, { x: 10, y: 0, spacing: 2 }, 1);
  assert.deepEqual(wide.units.map((u) => [u.x, u.y]), expect.map((c) => [c.x, c.y]));
  // size-2 / size-3 are single units; spacing is ignored for them
  assert.equal(new Battle(input(1, [{ ...P('bulwark', 10, 0), spacing: 2 }, P('ironclad', 20, 0)], [])).units.length, 2);
});

test('side 1 is mirrored: squads and formations are rotated 180 degrees about the field centre', () => {
  for (const spacing of [0, 1, 2]) {
    const p0 = { ...P('buggy', 5, 1), spacing };
    const a = new Battle({ seed: 1, sides: [{ designs: DESIGNS, units: [p0] }, { designs: DESIGNS, units: [{ ...p0 }] }] });
    const s0 = a.units.filter((u) => u.side === 0), s1 = a.units.filter((u) => u.side === 1);
    assert.equal(s0.length, 16);
    assert.equal(s1.length, 16);
    for (let i = 0; i < 16; i++) {
      assert.ok(Math.abs(s1[i].x - (FIELD_W - s0[i].x)) < 1e-9 && Math.abs(s1[i].y - (FIELD_H - s0[i].y)) < 1e-9, `unit ${i} spacing ${spacing}`);
    }
    assert.ok(s0.every((u) => u.y > FIELD_H - 12) && s1.every((u) => u.y < 12), 'each squad starts in its own zone');
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
  const b = new Battle(input(1, [{ ...P('sniperw', 10, 0), target: prio }], [P(enemyA, 8, 0), P(enemyB, 12, 1)]));
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
  // lowestHp picks a damaged unit over a closer healthy one
  r = pickedTarget('lowestHp', 'bulwark', 'bulwark', (_n, f) => { f.hp = 100; });
  assert.equal(r.got, r.far);
  r = pickedTarget('highestHp', 'bulwark', 'bulwark', (_n, f) => { f.hp = 100; });
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
    const b = new Battle(side === 0
      ? { seed: 3, sides: [{ designs: DESIGNS, units: [mine] }, { designs: DESIGNS, units: [{ ...far, x: 22 }] }] }
      : { seed: 3, sides: [{ designs: DESIGNS, units: [{ ...far, x: 22 }] }, { designs: DESIGNS, units: [mine] }] });
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
  const adv = new Battle({ seed: 3, sides: [{ designs: DESIGNS, units: [P('lancer', 22, 0)] }, { designs: DESIGNS, units: [{ ...P('bulwark', 22, 0) }] }] });
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

test('stances + priorities: 120v120 stays fast and deterministic', () => {
  const stances = ['advance', 'holdPos', 'charge', 'flankLeft', 'flankRight'] as const;
  const prios = ['closest', 'aircraft', 'armored', 'longestRange', 'support', 'valuable', 'swarm', 'threat'] as const;
  const army = (): Placement[] => {
    const out: Placement[] = [];
    const ds = ['buggy', 'gunner', 'ironclad', 'medic', 'lancer'];
    for (let i = 0; i < 40; i++) {
      const id = ds[i % ds.length];
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
  assert.ok(ms < 1500, `took ${ms}ms`);
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
    // park the enemy squad 6 cells ahead; the kiter must decide how far to back off
    const en = b.units.filter((x) => x.side === 1);
    en.forEach((x, i) => { x.x = 24 + (i % 2); x.y = 17 + (i >> 1); });
    (b as unknown as { rebuildHash(): void }).rebuildHash();
    for (let i = 0; i < 200; i++) b.step();
    return Math.hypot(b.units[0].x - 24, b.units[0].y - 17.5);
  };
  const onMortar = run(0), onMg = run(1), dflt = run();
  assert.ok(onMg < onMortar - 1, `mg ${onMg} vs mortar ${onMortar}`);
  assert.ok(Math.abs(dflt - onMortar) < 0.5, 'default = longest-range weapon');
});
