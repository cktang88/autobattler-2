import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/shared/sim/battle.ts';
import { wreckLevel, type BattleEvent, type BattleInput } from '../src/shared/sim/types.ts';
import { validateDesign } from '../src/shared/stats.ts';
import type { Design, Placement } from '../src/shared/types.ts';

const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id, chassis, mobility, mounts });
const DESIGNS: Design[] = [
  D('buggy', 'scout', 'wheels', ['mg']),
  D('target', 'warden', 'halftrack', ['mg', null]),
  D('railTitan', 'titan', 'megatracks', ['massdriver', null, null, null, null]),
];
let uid = 1;
const P = (designId: string, x: number, y: number): Placement => ({ uid: uid++, designId, x, y, level: 1, round: 1 });

type Death = Extract<BattleEvent, { t: 'death' }>;
/** deaths of side 1's units over a whole battle */
function deaths(a: Placement[], b: Placement[]): Death[] {
  const inp: BattleInput = { seed: 7, sides: [{ designs: DESIGNS, units: a }, { designs: DESIGNS, units: b }] };
  const bt = new Battle(inp);
  const out: Death[] = [];
  while (!bt.done) {
    bt.step();
    for (const e of bt.events) if (e.t === 'death' && bt.units[e.unit].side === 1) out.push(e);
  }
  return out;
}
const targets = () => [P('target', 10, 0), P('target', 20, 0), P('target', 30, 0)];

test('wreck test designs are legal', () => {
  for (const d of DESIGNS) assert.deepEqual(validateDesign(d), [], d.id);
});

test('death events carry the killing blow (overkill, hit size, weapon, wreck level)', () => {
  const ds = deaths([P('buggy', 10, 0), P('buggy', 20, 0), P('buggy', 30, 0), P('buggy', 15, 0), P('buggy', 25, 0)], targets());
  assert.ok(ds.length > 0);
  for (const e of ds) {
    assert.equal(typeof e.moduleId, 'string');
    assert.ok(e.overkill >= 0 && Number.isFinite(e.overkill), `overkill ${e.overkill}`);
    assert.ok(e.hit > 0 && Number.isFinite(e.hit), `hit ${e.hit}`);
    assert.ok(['kinetic', 'explosive', 'energy', 'fire', 'crush'].includes(e.kind));
    assert.ok([0, 1, 2, 3].includes(e.wreck));
  }
});

test('a huge one-shot leaves less of the wreck than many small hits', () => {
  // machine guns chew the targets up: small last hits, whole hulls
  const mg = deaths([P('buggy', 10, 0), P('buggy', 20, 0), P('buggy', 30, 0), P('buggy', 15, 0), P('buggy', 25, 0)], targets());
  // a spinal mass driver slug is many times their hp: smithereens
  const rail = deaths([P('railTitan', 20, 0)], targets());
  assert.ok(mg.length > 0 && rail.length > 0);
  for (const e of mg) assert.equal(e.kind, 'kinetic');
  const maxMg = Math.max(...mg.map((e) => e.wreck)), minRail = Math.min(...rail.filter((e) => e.moduleId === 'massdriver').map((e) => e.wreck));
  assert.ok(minRail > maxMg, `rail ${minRail} vs mg ${maxMg}`);
  assert.equal(minRail, 3);
  // the level is monotonic in the blow
  assert.ok(wreckLevel(0.05, 0.01, 'explosive') < wreckLevel(5, 4, 'explosive'));
  assert.ok(wreckLevel(0.5, 0.3, 'kinetic') <= wreckLevel(0.5, 0.3, 'explosive'));
});
