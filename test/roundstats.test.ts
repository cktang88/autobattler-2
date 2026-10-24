// Per-unit combat records (Battle.unitTally) behind the round stats popup: pure accounting that agrees with the
// per-block tally and the deaths in the fight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/shared/sim/battle.ts';
import type { Design } from '../src/shared/types.ts';

test('unit tallies add up: dealt matches the block tally, every kill is a death credited to its killer', () => {
  const a: Design = { id: 'a', name: 'a', chassis: 'warden', mobility: 'halftrack', mounts: ['autocannon', null] };
  const sq: Design = { id: 'sq', name: 'sq', chassis: 'scout', mobility: 'wheels', mounts: ['lmg'] };
  const units = [
    { uid: 1, designId: 'a', x: 10, y: 0, level: 1, round: 1 },
    { uid: 2, designId: 'sq', x: 20, y: 0, level: 2, round: 1 },
  ];
  const b = new Battle({ seed: 7, sides: [{ designs: [a, sq], units }, { designs: [a, sq], units }] });
  while (!b.done) b.step();
  let deaths = 0, kills = 0;
  for (const s of [0, 1] as const) for (const uid of [1, 2]) {
    let dealt = 0;
    for (const u of b.units) if (u.side === s && u.uid === uid) dealt += b.unitTally(u.id).dealt;
    assert.ok(Math.abs(dealt - b.blockDamage(s, uid)) < 1e-6, `side ${s} block ${uid}`);
  }
  for (const u of b.units) {
    const t = b.unitTally(u.id);
    assert.ok(t.taken >= t.shieldTaken && t.shieldTaken >= 0);
    assert.equal(t.deathTick >= 0, !u.alive);
    if (!u.alive) deaths++;
    if (t.killedBy >= 0) {
      assert.notEqual(b.units[t.killedBy].side, u.side);
      assert.ok(b.unitTally(t.killedBy).kills.includes(u.id));
    }
    for (const v of t.kills) { kills++; assert.equal(b.unitTally(v).killedBy, u.id); }
    // the per-weapon split adds back up to the unit's totals
    const ws = Object.values(t.byWeapon);
    assert.ok(Math.abs(ws.reduce((x, w) => x + w.dealt, 0) - t.dealt) < 1e-6);
    assert.ok(Math.abs(ws.reduce((x, w) => x + w.dealtAir, 0) - t.dealtAir) < 1e-6);
    assert.equal(ws.reduce((x, w) => x + w.kills.length, 0), t.kills.length);
  }
  assert.ok(deaths > 0 && kills > 0 && kills <= deaths);
});
