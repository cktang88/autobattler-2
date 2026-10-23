// Dynamic light squads: the units per block (16 / 8 / 4) come from the design's per-unit price (stats.ts squadFor),
// and every consumer (rules, grid, sim, AI, UI helpers) reads that one number.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { SQUAD_TIERS, computeStats, squadFor, squadOf, statsWithSquad } from '../src/shared/stats.ts';
import { blockDims, normSpacing, placementUnitCenters, squadLayout, squadOffsets, MAX_SPACING } from '../src/shared/grid.ts';
import { MAX_BLOCKS, MAX_SIM_UNITS, RULES_VERSION, designCost, migrateMatch, newMatch, newPlayer, placementValue, shapeOf, upgradeCost, validateDeploy } from '../src/shared/match.ts';
import { profile } from '../src/shared/ai.ts';
import { designInfo, unitDps } from '../src/client/ui/deckstats.ts';
import { designSizeLabel } from '../src/client/ui/garage-parts.ts';
import { Battle } from '../src/shared/sim/battle.ts';
import type { Design, Placement } from '../src/shared/types.ts';

const S = (id: string) => STARTER_DESIGNS.find((d) => d.id === id)!;

test('squad tiers: cheap light units 16 to a block, pricier ones 8 or 4; bigger hulls single units', () => {
  assert.deepEqual(SQUAD_TIERS.map((t) => t[1]), [16, 8, 4]);
  const at = (p: number) => squadFor(1, () => p);
  assert.equal(at(5), 16); assert.equal(at(11), 16); assert.equal(at(11.01), 8); assert.equal(at(24), 8); assert.equal(at(24.01), 4); assert.equal(at(500), 4);
  for (const size of [2, 3, 4, 5]) assert.equal(squadFor(size, () => 1), 1);
  // the starters
  const sq = Object.fromEntries(STARTER_DESIGNS.map((d) => [d.name, computeStats(d).squad]));
  assert.deepEqual([sq['Buzzsaw'], sq['Torchbug'], sq['Gnasher'], sq['Tank Hunter'], sq['Lancer'], sq['Hornet']], [16, 16, 16, 8, 4, 4]);
  for (const d of STARTER_DESIGNS) if (computeStats(d).size > 1) assert.equal(computeStats(d).squad, 1, d.name);
  // a squad's unit price (one decimal shown) sits in its tier
  for (const d of STARTER_DESIGNS) {
    const s = computeStats(d);
    if (s.size !== 1) continue;
    const i = SQUAD_TIERS.findIndex((t) => t[1] === s.squad);
    assert.ok(s.unitCost <= SQUAD_TIERS[i][0] + 0.5, `${d.name} ${s.unitCost} in ×${s.squad}`);
    if (i > 0) assert.ok(s.unitCost > SQUAD_TIERS[i - 1][0] - 0.5, `${d.name} ${s.unitCost} could be a bigger squad`);
  }
});

test('every consumer reads the same squad count and cost = unitCost x squad', () => {
  for (const d of STARTER_DESIGNS) {
    const s = computeStats(d);
    assert.equal(squadOf(d), s.squad);
    assert.equal(shapeOf(d).squad, s.squad);
    assert.equal(profile(d).stats.squad, s.squad);
    const info = designInfo(d)!;
    assert.equal(info.st.squad, s.squad);
    assert.ok(Math.abs(info.gnd - unitDps(d).ground * s.squad) < 1e-9, `${d.name}: block dps`);
    assert.equal(designCost(d), s.cost);
    assert.ok(Math.abs(s.unitCost * s.squad - s.cost) < 1e-9);
    assert.equal(designSizeLabel(s).endsWith(s.squad > 1 ? `×${s.squad}` : ''), true, designSizeLabel(s));
    // the sim spawns exactly the squad, at the grid's unit centres
    const p: Placement = { uid: 1, designId: d.id, x: 10, y: 2, level: 1, round: 1, spacing: 1 };
    const b = new Battle({ seed: 1, sides: [{ designs: [d], units: [p] }, { designs: [], units: [] }] });
    assert.equal(b.units.length, s.squad, `${d.name} spawned`);
    assert.deepEqual(b.units.map((u) => [u.x, u.y]), placementUnitCenters(0, { ...p, spacing: normSpacing(s, 1) }, s).map((c) => [c.x, c.y]));
  }
});

test('formations and spacing for every squad size', () => {
  assert.deepEqual([squadLayout(16), squadLayout(8), squadLayout(4), squadLayout(1)], [[8, 2], [4, 2], [2, 2], [1, 1]]);
  assert.deepEqual(squadLayout(8, true), [2, 4]);
  for (const [squad, [c, r]] of [[16, [8, 2]], [8, [4, 2]], [4, [2, 2]]] as const) {
    const sh = { size: 1 as const, squad };
    for (let sp = 0; sp <= MAX_SPACING; sp++) {
      assert.deepEqual(blockDims(sh, sp), { w: c + (c - 1) * sp, h: r + (r - 1) * sp });
      assert.deepEqual(blockDims(sh, sp, true), { w: r + (r - 1) * sp, h: c + (c - 1) * sp });
      const offs = squadOffsets(sh, sp);
      assert.equal(offs.length, squad);
      const d = blockDims(sh, sp);
      assert.ok(offs.every((o) => o.x > 0 && o.x < d.w && o.y > 0 && o.y < d.h));
    }
    assert.equal(normSpacing(sh, 9), MAX_SPACING);
  }
  assert.equal(normSpacing({ squad: 1 }, 2), 0);
});

test('rules: zone, overlap and the sim-unit cap use the real squad', () => {
  const lancer = S('starter-lancer'), hunter = S('starter-hunter');
  const m = newMatch('q', 'ai', 1, newPlayer('A', [lancer, hunter]), newPlayer('B', [lancer], true), 0);
  m.players[0].supply = 100000;
  const pl = (uid: number, id: string, x: number, y: number, extra: Partial<Placement> = {}): Placement => ({ uid, designId: id, x, y, level: 1, round: 1, ...extra });
  const v = (...place: Placement[]) => validateDeploy(m, 0, { round: 1, place, upgrade: [] });
  // a 4-unit Lancer block is 2 x 2 packed: fits in the zone's corner, and two sit side by side
  assert.equal(v(pl(1, lancer.id, 94, 22)), null);
  assert.match(v(pl(1, lancer.id, 95, 22))!, /zone/);
  assert.equal(v(pl(1, lancer.id, 0, 0), pl(2, lancer.id, 2, 0)), null);
  assert.match(v(pl(1, lancer.id, 0, 0), pl(2, lancer.id, 1, 0))!, /overlap/);
  // an 8-unit Tank Hunter block is 4 x 2 (spacing 2: 10 x 4)
  assert.equal(v(pl(1, hunter.id, 0, 0, { spacing: 2 }), pl(2, hunter.id, 10, 0)), null);
  assert.match(v(pl(1, hunter.id, 0, 0, { spacing: 2 }), pl(2, hunter.id, 9, 0))!, /overlap/);
  // sim-unit cap counts 8 per Tank Hunter block: 30 blocks = 240 fit, the 31st doesn't (blocks cap is 40)
  const many = Array.from({ length: 31 }, (_, i) => pl(i + 1, hunter.id, (i % 19) * 5, Math.floor(i / 19) * 3));
  assert.ok(31 <= MAX_BLOCKS && 30 * 8 === MAX_SIM_UNITS);
  assert.equal(v(...many.slice(0, 30)), null);
  assert.match(v(...many)!, /Too many units/);
});

test('migrating a rules-2 match splits old 16-unit blocks into blocks of the new squad on the same unit positions', () => {
  const lancer = S('starter-lancer'), hunter = S('starter-hunter'), buzz = S('starter-buzzsaw');
  const deck = [lancer, hunter, buzz];
  const m = newMatch('old', 'ai', 1, newPlayer('A', deck), newPlayer('B', deck, true), 0);
  m.rules = 2;
  m.round = 3;
  const old = (d: Design, lv: number) => { const c = statsWithSquad(d, 16).cost; let v = c; for (let l = 1; l < lv; l++) v += Math.round(c * (0.4 + 0.1 * l) / 10) * 10; return v; };
  m.players[0].board = [
    { uid: 1, designId: lancer.id, x: 10, y: 0, level: 2, round: 1, spacing: 1, target: 'armored', hold: true },
    { uid: 2, designId: hunter.id, x: 40, y: 4, level: 1, round: 2, spacing: 2, rot: true },
    { uid: 3, designId: buzz.id, x: 60, y: 10, level: 1, round: 2 },
    { uid: 4, designId: hunter.id, x: 70, y: 0, level: 1, round: 2, escort: 1 },
  ];
  m.players[0].nextUid = 5;
  m.players[0].supply = 100;
  // the old army's unit positions (16 per light block, the legacy 8 x 2 layout)
  const legacyCenters = m.players[0].board.map((u) => placementUnitCenters(0, u, { ...shapeOf(deck.find((d) => d.id === u.designId)), squad: 16 }));
  assert.equal(migrateMatch(m), true);
  assert.equal(m.rules, RULES_VERSION);
  const b = m.players[0].board;
  assert.equal(b.length, 4 + 2 + 1 + 2); // lancer -> 4 blocks, each hunter -> 2, buzzsaw unchanged
  assert.equal(new Set(b.map((u) => u.uid)).size, b.length, 'unique uids');
  assert.equal(m.players[0].nextUid, 1 + Math.max(...b.map((u) => u.uid)));
  // same units in the same places
  const centers = (uids: number[]) => b.filter((u) => uids.includes(u.uid)).flatMap((u) => placementUnitCenters(0, u, shapeOf(deck.find((d) => d.id === u.designId)))).map((c) => `${c.x},${c.y}`).sort();
  const lanc = b.filter((u) => u.designId === lancer.id);
  assert.deepEqual(centers(lanc.map((u) => u.uid)), legacyCenters[0].map((c) => `${c.x},${c.y}`).sort());
  assert.ok(lanc.every((u) => u.level === 2 && u.target === 'armored' && u.hold && u.spacing === 1));
  const h2 = b.filter((u) => u.designId === hunter.id && u.round === 2 && u.rot);
  assert.equal(h2.length, 2);
  assert.deepEqual(centers(h2.map((u) => u.uid)), legacyCenters[1].map((c) => `${c.x},${c.y}`).sort());
  assert.equal(b.find((u) => u.uid === 4)!.escort, 1, 'the first piece keeps the uid (escorts keep working)');
  // whatever the old blocks cost beyond their pieces is refunded
  // (never a charge: under the new prices the same units may be worth more than they cost)
  const refund = Math.max(0, old(lancer, 2) - 4 * placementValue(lancer, 2)) + 2 * Math.max(0, old(hunter, 1) - 2 * placementValue(hunter, 1));
  assert.equal(m.players[0].supply, 100 + refund);
  assert.equal(migrateMatch(m), false, 'idempotent');
  // the migrated board is still a legal base for new purchases (no overlaps among the pieces)
  m.status = 'deploy';
  m.players[0].supply = 5000;
  assert.equal(validateDeploy(m, 0, { round: 3, place: [{ uid: 99, designId: buzz.id, x: 0, y: 20, level: 1, round: 3 }], upgrade: [b[0].uid] }), null);
  assert.match(validateDeploy(m, 0, { round: 3, place: [{ uid: 99, designId: buzz.id, x: 12, y: 0, level: 1, round: 3 }], upgrade: [] })!, /overlap/);
  void upgradeCost;
});
