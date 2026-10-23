// The exotic energy weapons each do something no gun does: leech (lifesteal), prism (one pulse, several targets),
// void lance (a share of the target's max hp) and entropy ray (strips armour for the rest of the army).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/shared/sim/battle.ts';
import { validateDesign } from '../src/shared/stats.ts';
import type { Design, Placement } from '../src/shared/types.ts';

const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id, chassis, mobility, mounts });
const designs = [
  D('leech', 'warden', 'treads', ['leech', null]),
  D('prism', 'warden', 'treads', ['prism', null]),
  D('void', 'warden', 'treads', ['voidlance', null]),
  D('entropy', 'warden', 'treads', ['entropy', null]),
  D('swarm', 'scout', 'wheels', ['mg']),
  D('tank', 'bastion', 'treads', ['cannon', 'plateM', 'autocannon']),
  D('titan', 'titan', 'megatracks', ['siege240', 'cannon', null, null, null]),
];
const pl = (designId: string, uid: number, x = 10, extra: Partial<Placement> = {}): Placement => ({ uid, designId, x, y: 0, level: 1, round: 1, ...extra });
/** our weapon unit (side 0, held) against `foe` (side 1, advancing into it) */
function fight(me: string, foe: string, ticks: number, onStep: (b: Battle) => void): Battle {
  const b = new Battle({ seed: 3, sides: [{ designs, units: [pl(me, 1, 40, { stance: 'holdPos' })] }, { designs, units: [pl(foe, 2, 40)] }] });
  for (let i = 0; i < ticks && !b.done; i++) { b.step(); onStep(b); }
  return b;
}

test('the energy test designs are legal', () => {
  for (const d of designs) assert.deepEqual(validateDesign(d), [], d.id);
});

test('leech beam heals its own hull from the damage it deals', () => {
  let healed = 0;
  fight('leech', 'tank', 1200, (b) => { for (const e of b.events) if (e.t === 'heal' && b.units[e.unit].design.id === 'leech') healed += e.amount; });
  assert.ok(healed > 50, `leech healed ${healed.toFixed(0)} hp`);
});

test('prism array: one pulse strikes several different targets', () => {
  let most = 0;
  fight('prism', 'swarm', 1200, (b) => {
    const tg = new Set<string>();
    for (const e of b.events) if (e.t === 'beam' && e.moduleId === 'prism') tg.add(`${e.x2.toFixed(2)},${e.y2.toFixed(2)}`);
    most = Math.max(most, tg.size);
  });
  assert.ok(most >= 3, `most targets hit by one pulse: ${most}`);
});

test('void lance: hits scale with the target\'s max hp (big vs a titan)', () => {
  let best = 0;
  const b = fight('void', 'titan', 1600, (bb) => { for (const e of bb.events) if (e.t === 'hit' && e.moduleId === 'voidlance') best = Math.max(best, e.damage); });
  const titan = b.units.find((u) => u.design.id === 'titan')!;
  assert.ok(best >= titan.maxHp * 0.04, `best void hit ${best.toFixed(0)} vs titan max hp ${titan.maxHp}`);
});

test('entropy ray strips the target\'s armour while it keeps hitting', () => {
  let most = 0;
  const b = fight('entropy', 'tank', 1200, (bb) => {
    const ints = (bb as unknown as { ints: { shred: number }[] }).ints;
    const tank = bb.units.find((u) => u.design.id === 'tank');
    if (tank) most = Math.max(most, ints[tank.id].shred);
  });
  const tank = b.units.find((u) => u.design.id === 'tank')!;
  assert.ok(most > tank.stats.armor * 0.5, `stripped ${most.toFixed(1)} of ${tank.stats.armor} armour`);
});
