import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstLegalMobility, refitForClass, reqReason, reseat } from '../src/client/ui/garage-fit.ts';
import { meleeSlots } from '../src/shared/mountgeo.ts';
import { CHASSIS, CHASSIS_BY_ID, MODULES, MODULE_BY_ID, chassisDomain } from '../src/shared/parts.ts';
import { slotError } from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import type { Design, Domain } from '../src/shared/types.ts';

const legal = (d: Design) => {
  const c = CHASSIS_BY_ID.get(d.chassis)!;
  assert.equal(d.mounts.length, c.mounts.length, `${d.chassis}: one entry per socket`);
  d.mounts.forEach((id, i) => { if (id) assert.equal(slotError(c, d.mobility, i, MODULE_BY_ID.get(id)!), null, `${d.chassis} socket ${i}: ${id}`); });
};

test('reseat only ever produces legal sockets', () => {
  for (const s of STARTER_DESIGNS) for (const c of CHASSIS) {
    const mobility = firstLegalMobility(c.id);
    legal({ ...s, chassis: c.id, mobility, mounts: reseat(s.mounts, c, mobility) });
  }
});

test('reseat gives the edge socket to the melee part, not to a gun of the same size listed first', () => {
  const c = CHASSIS.find((x) => x.id === 'colossus')!;
  const edge = meleeSlots(c);
  assert.ok(edge.some(Boolean) && !edge.every(Boolean), 'colossus has edge and non-edge M sockets');
  const guns = MODULES.filter((m) => m.kind === 'weapon' && m.mount === 'M' && m.category !== 'melee' && !m.requires).slice(0, 3).map((m) => m.id);
  const saw = MODULES.find((m) => m.category === 'melee' && m.mount === 'M')!.id;
  const mobility = firstLegalMobility(c.id);
  const out = reseat([...guns, saw], c, mobility);
  assert.ok(out.includes(saw), 'melee part kept');
  assert.equal(out.filter(Boolean).length, 3, 'all three M sockets filled (one gun goes back to stores)');
  assert.ok(edge[out.indexOf(saw)], 'melee part sits on an edge socket');
});

test('class switch keeps what it can and drops parts the new class cannot carry', () => {
  // crab: claw (melee, ground only) on an edge socket + a machine gun
  const crab: Design = { id: 't', name: 't', chassis: 'crab', mobility: firstLegalMobility('crab'), mounts: ['claw', null, 'mg'] };
  for (const dom of ['jet', 'heli'] as Domain[]) {
    const d = refitForClass(crab, dom)!;
    assert.equal(chassisDomain(CHASSIS_BY_ID.get(d.chassis)!), dom);
    legal(d);
    assert.ok(!d.mounts.includes('claw'), 'melee never rides an aircraft');
    assert.ok(d.mounts.includes('mg'), 'the gun comes along');
  }
  const jet = refitForClass(crab, 'jet')!;
  const bomber: Design = { ...jet, mounts: jet.mounts.map((m, i) => (i === CHASSIS_BY_ID.get(jet.chassis)!.mounts.indexOf('M') ? 'bombs' : m)) };
  legal(bomber);
  const back = refitForClass(bomber, 'ground')!;
  legal(back);
  assert.ok(!back.mounts.includes('bombs'), 'bomb bays need a flying design');
});

test('class switch lands on a hull that keeps the most parts, nearest the current size', () => {
  for (const s of STARTER_DESIGNS) for (const dom of ['ground', 'jet', 'heli'] as Domain[]) {
    const d = refitForClass(s, dom)!;
    legal(d);
    const best = Math.max(...CHASSIS.filter((c) => chassisDomain(c) === dom).map((c) => {
      const mobility = firstLegalMobility(c.id);
      return reseat(s.mounts.map((id) => (id && !reqReason(MODULE_BY_ID.get(id)!, mobility) ? id : null)), c, mobility).filter(Boolean).length;
    }));
    assert.equal(d.mounts.filter(Boolean).length, best, `${s.name} -> ${dom}`);
  }
  // a 1-socket scout with one gun becomes the smallest jet, not a bomber
  const scout: Design = { id: 's', name: 's', chassis: 'scout', mobility: firstLegalMobility('scout'), mounts: ['mg'] };
  assert.equal(CHASSIS_BY_ID.get(refitForClass(scout, 'jet')!.chassis)!.size, 1);
});
