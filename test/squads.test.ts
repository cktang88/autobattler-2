// Dynamic squads: the units per block (light 16 / 8 / 4, medium 4 / 2 / 1) come from the design's per-unit price (stats.ts squadFor),
// and every consumer (rules, grid, sim, AI, UI helpers) reads that one number.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { SQUAD_TIERS, analyticStats, computeStats, squadFor, squadOf, statsWithSquad } from '../src/shared/stats.ts';
import { blockDims, normSpacing, placementUnitCenters, squadLayout, squadOffsets, MAX_SPACING } from '../src/shared/grid.ts';
import { MAX_BLOCKS, MAX_SIM_UNITS, RULES_VERSION, designCost, migrateMatch, newMatch, newPlayer, placementValue, shapeOf, upgradeCost, validateDeploy } from '../src/shared/match.ts';
import { profile } from '../src/shared/ai.ts';
import { designInfo, unitDps } from '../src/client/ui/deckstats.ts';
import { designSizeLabel } from '../src/client/ui/garage-parts.ts';
import { Battle } from '../src/shared/sim/battle.ts';
import type { Design, Placement } from '../src/shared/types.ts';

const S = (id: string) => STARTER_DESIGNS.find((d) => d.id === id)!;
/** a 2 x 2 medium hull cheap enough for blocks of 4 (the Missile Spire used to be; reprices moved it to 2) */
const SPIRE4: Design = { id: 'spire4', name: 'Spire4', chassis: 'warden', mobility: 'spider', mounts: ['minigun', null] };
/** an 8-unit light block at current prices (the tests below were written around Tank Hunter, which reprices move
 *  between tiers); asserted in the first test so a price change that moves it fails loudly here */
const EIGHT: Design = { id: 'eight', name: 'Eight', chassis: 'raider', mobility: 'legs', mounts: ['twinmg', null] };

test('squad tiers: cheap light units 16 to a block, pricier ones 8 or 4; medium 4, 2 or 1; bigger hulls single units', () => {
  assert.deepEqual(SQUAD_TIERS[1].map((t) => t[1]), [16, 8, 4]);
  assert.deepEqual(SQUAD_TIERS[2].map((t) => t[1]), [4, 2, 1]);
  const at = (p: number) => squadFor(1, () => p);
  assert.equal(at(5), 16); assert.equal(at(11), 16); assert.equal(at(11.01), 8); assert.equal(at(24), 8); assert.equal(at(24.01), 4); assert.equal(at(500), 4);
  const at2 = (p: number) => squadFor(2, () => p);
  assert.equal(at2(20), 4); assert.equal(at2(35), 4); assert.equal(at2(35.01), 2); assert.equal(at2(60), 2); assert.equal(at2(60.01), 1); assert.equal(at2(500), 1);
  for (const size of [3, 4, 5]) assert.equal(squadFor(size, () => 1), 1);
  // the starters
  const sq = Object.fromEntries(STARTER_DESIGNS.map((d) => [d.name, computeStats(d).squad]));
  assert.deepEqual([sq['Buzzsaw'], sq['Torchbug'], sq['Gnasher'], sq['Tank Hunter'], sq['Lancer'], sq['Hornet']], [8, 8, 8, 4, 4, 16]); // rules 7: light squads repriced up (SIZE_K 0.85 -> 0.97); the Hornet is a 16 again (SMALL_AIR_CAL.rotor[0] 0.7075: an 8-squad won ~30%)
  assert.deepEqual([sq['Missile Spire'], sq['Strafer'], sq['Tankbuster'], sq['Bulwark'], sq['Skyguard']], [1, 1, 1, 1, 1]); // (Spire: spider legs since the anchor was retired; Tankbuster a single unit since rules 7b's dearer cannon / Longarm)
  assert.equal(computeStats(EIGHT).squad, 8, 'test design EIGHT');
  for (const d of STARTER_DESIGNS) if (computeStats(d).size > 2) assert.equal(computeStats(d).squad, 1, d.name);
  // a squad's unit price (one decimal shown) sits in its tier -- the analytic price: the team-value correction (stats.ts
  // TEAM_FIT) changes what a block costs, never how many units it holds
  for (const d of STARTER_DESIGNS) {
    const s = analyticStats(d);
    assert.equal(computeStats(d).squad, s.squad, d.name);
    const tiers = SQUAD_TIERS[s.size];
    if (!tiers) continue;
    const i = tiers.findIndex((t) => t[1] === s.squad);
    assert.ok(s.unitCost <= tiers[i][0] + 0.5, `${d.name} ${s.unitCost} in ×${s.squad}`);
    if (i > 0) assert.ok(s.unitCost > tiers[i - 1][0] - 0.5, `${d.name} ${s.unitCost} could be a bigger squad`);
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
  const lancer = S('starter-lancer'), hunter = EIGHT;
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
  // buzz: a light design that is a 16-unit squad at the current prices (no starter is since rules 7)
  const lancer = S('starter-lancer'), hunter = EIGHT, buzz: Design = { id: 'buzz16', name: 'Buzz16', chassis: 'scout', mobility: 'wheels', mounts: ['shotgun'] };
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

test('medium squads: 2 x 2 / 2 x 1 blocks of the real hull footprint, spaced, rotated, validated and simulated', () => {
  const spire = SPIRE4, tb: Design = { id: 'longarm-mg', name: 'Longarm MG', chassis: 'longarm', mobility: 'spider', mounts: ['mg'] }; // 2 x 2 hull x4, 1 x 3 hull x2
  const ss = computeStats(spire), ts = computeStats(tb);
  assert.deepEqual([ss.squad, ss.fw, ss.fh, ts.squad, ts.fw, ts.fh], [4, 2, 2, 2, 1, 3]);
  assert.deepEqual(squadLayout(2), [2, 1]);
  assert.deepEqual(squadLayout(2, true), [1, 2]);
  for (let sp = 0; sp <= MAX_SPACING; sp++) {
    assert.deepEqual(blockDims(ss, sp), { w: 4 + sp, h: 4 + sp });
    assert.deepEqual(blockDims(ts, sp), { w: 2 + sp, h: 3 });
    assert.deepEqual(blockDims(ts, sp, true), { w: 1, h: 6 + sp });
    // unit centres sit a hull + spacing apart, each hull inside the block
    assert.deepEqual(squadOffsets(ss, sp).map((c) => [c.x, c.y]), [[1, 1], [3 + sp, 1], [1, 3 + sp], [3 + sp, 3 + sp]]);
  }
  const m = newMatch('m', 'ai', 1, newPlayer('A', [spire, tb]), newPlayer('B', [spire], true), 0);
  m.players[0].supply = 100000;
  const pl = (uid: number, id: string, x: number, y: number, extra: Partial<Placement> = {}): Placement => ({ uid, designId: id, x, y, level: 1, round: 1, ...extra });
  const v = (...place: Placement[]) => validateDeploy(m, 0, { round: 1, place, upgrade: [] });
  assert.equal(v(pl(1, spire.id, 92, 20)), null);
  assert.match(v(pl(1, spire.id, 92, 20, { spacing: 1 }))!, /zone/);
  assert.equal(v(pl(1, spire.id, 0, 0, { spacing: 2 }), pl(2, spire.id, 6, 0)), null);
  assert.match(v(pl(1, spire.id, 0, 0, { spacing: 2 }), pl(2, spire.id, 5, 0))!, /overlap/);
  assert.equal(v(pl(1, tb.id, 0, 0, { rot: true, spacing: 2 }), pl(2, tb.id, 0, 8)), null);
  assert.match(v(pl(1, tb.id, 0, 0, { rot: true, spacing: 2 }), pl(2, tb.id, 0, 7))!, /overlap/);
  // 60 spire blocks (the block cap) are 240 units (the sim-unit cap): all fit, one more doesn't
  assert.equal(MAX_BLOCKS, 60);
  assert.equal(60 * 4, MAX_SIM_UNITS);
  const many = Array.from({ length: 60 }, (_, i) => pl(i + 1, spire.id, (i % 24) * 4, Math.floor(i / 24) * 4));
  assert.equal(v(...many), null);
  assert.match(v(...many, pl(61, spire.id, 0, 12))!, /Too many blocks/);
  // the sim spawns the whole squads and they fight
  const b = new Battle({ seed: 3, sides: [
    { designs: [spire], units: [pl(1, spire.id, 40, 2, { spacing: 1, hold: true })] },
    { designs: [tb], units: [pl(1, tb.id, 40, 2, { spacing: 1, hold: true })] },
  ] });
  assert.equal(b.units.filter((u) => u.side === 0).length, 4);
  assert.equal(b.units.filter((u) => u.side === 1).length, 2);
  for (let i = 0; i < 20 * 60 && !b.done; i++) b.step();
  assert.ok(b.units.some((u) => u.hp < u.maxHp), 'shots were exchanged');
});

test('migrating a rules-3 match sells back medium single blocks of designs that now come in squads', () => {
  const spire = SPIRE4, bul = S('starter-bulwark'), lancer = S('starter-lancer');
  const deck = [spire, bul, lancer];
  const m = newMatch('old3', 'ai', 1, newPlayer('A', deck), newPlayer('B', deck, true), 0);
  m.rules = 3;
  m.round = 3;
  m.players[0].board = [
    { uid: 1, designId: spire.id, x: 10, y: 0, level: 2, round: 1 },
    { uid: 2, designId: bul.id, x: 20, y: 0, level: 1, round: 1, escort: 1 },
    { uid: 3, designId: lancer.id, x: 30, y: 0, level: 1, round: 2, spacing: 1 },
  ];
  m.players[0].supply = 100;
  const single = statsWithSquad(spire, 1).cost;
  const paid = single + Math.max(10, Math.round((single * 0.5) / 10) * 10); // price + one upgrade, single-unit prices
  assert.equal(migrateMatch(m), true);
  assert.equal(m.rules, RULES_VERSION);
  assert.deepEqual(m.players[0].board.map((u) => u.uid), [2, 3], 'the spire single left the board; the rest is untouched');
  assert.equal(m.players[0].board[0].escort, undefined, 'escort of the sold block dropped');
  assert.equal(m.players[0].board[1].spacing, 1);
  assert.equal(m.players[0].supply, 100 + paid);
  assert.equal(migrateMatch(m), false, 'idempotent');
});

/** a broad set of plain designs (every hull x drive, one of a few guns in its first socket that takes it): the migration
 *  tests look for designs a rules change actually reshaped, instead of pinning ones that later repricing moves */
async function generated(): Promise<Design[]> {
  const { CHASSIS, MOBILITY, MODULE_BY_ID, pairingError } = await import('../src/shared/parts.ts');
  const { slotError, validateDesign } = await import('../src/shared/stats.ts');
  const out: Design[] = [];
  for (const c of CHASSIS) for (const mob of MOBILITY) {
    if (pairingError(c.id, mob.id) || mob.retired || c.size > 2) continue;
    for (const w of ['mg', 'twinmg', 'hmg', 'ac20', 'autocannon', 'flak', 'laser', 'grenade', 'rocketL', 'cannon75']) {
      const mod = MODULE_BY_ID.get(w)!;
      const i = c.mounts.findIndex((_, k) => !slotError(c, mob.id, k, mod));
      if (i < 0) continue;
      const d: Design = { id: `g-${c.id}-${mob.id}-${w}`.slice(0, 40), name: 'gen', chassis: c.id, mobility: mob.id, mounts: c.mounts.map((_, k) => (k === i ? w : null)) };
      if (!validateDesign(d).length) out.push(d);
    }
  }
  return out;
}

/** board legality after a migration: untouched blocks kept their place, and no two blocks overlap */
async function checkBoard(m: import('../src/shared/types.ts').MatchState, untouched: Record<number, [number, number]>) {
  const { shapeOf } = await import('../src/shared/match.ts');
  const { blocksOverlap } = await import('../src/shared/grid.ts');
  const p = m.players[0];
  const design = (id: string) => p.deck.find((d) => d.id === id);
  for (const [uid, [x, y]] of Object.entries(untouched)) {
    const u = p.board.find((b) => b.uid === Number(uid))!;
    assert.deepEqual([u.x, u.y], [x, y], `untouched block ${uid} keeps its place`);
  }
  for (let a = 0; a < p.board.length; a++) for (let b = a + 1; b < p.board.length; b++) {
    const A = p.board[a], B = p.board[b];
    assert.ok(!blocksOverlap(A, shapeOf(design(A.designId)), B, shapeOf(design(B.designId))), `blocks ${A.uid} and ${B.uid} overlap`);
  }
}

test('rules 6 migration: only blocks whose squad the drive rework changed are re-checked; prices just update', async () => {
  const { STARTER_DESIGNS } = await import('../src/shared/starters.ts');
  const { RULES_VERSION, drivesReshaped, migrateMatch, newMatch, newPlayer, shapeOf } = await import('../src/shared/match.ts');
  const gen = await generated();
  const moved = drivesReshaped(newPlayer('A', gen));
  assert.ok(moved.size > 0, 'the drive rework reshaped some designs');
  const re = gen.find((d) => moved.has(d.id) && shapeOf(d).squad > 1) ?? gen.find((d) => moved.has(d.id))!;
  const bulwark = STARTER_DESIGNS.find((d) => d.id === 'starter-bulwark')!, torch = STARTER_DESIGNS.find((d) => d.id === 'starter-torchbug')!;
  assert.ok(!drivesReshaped(newPlayer('A', [bulwark, torch])).size, 'the fixtures around it are untouched');
  const deck = [re, bulwark, torch];
  assert.ok(RULES_VERSION >= 6);
  const m = newMatch('r5', 'ai', 1, newPlayer('A', deck), newPlayer('B', deck, true), 0);
  m.rules = 5; m.status = 'deploy'; m.round = 2;
  // the reshaped block was placed right up against the bulwark; the torch squad sits elsewhere
  m.players[0].board = [
    { uid: 1, designId: re.id, x: 10, y: 2, level: 1, round: 1 },
    { uid: 2, designId: bulwark.id, x: 10 + shapeOf(re).squad, y: 2, level: 1, round: 1 },
    { uid: 3, designId: torch.id, x: 40, y: 2, level: 1, round: 1 },
  ];
  const supply0 = m.players[0].supply;
  assert.equal(migrateMatch(m), true);
  assert.equal(m.rules, RULES_VERSION);
  await checkBoard(m, { 2: [10 + shapeOf(re).squad, 2], 3: [40, 2] });
  assert.ok(m.players[0].board.some((u) => u.uid === 1) || m.players[0].supply > supply0, 'the reshaped block is kept (moved if needed) or sold back');
});

test('rules 7 migration (weapon pass): designs whose squad the weapon numbers changed are re-checked, others untouched', async () => {
  const { STARTER_DESIGNS } = await import('../src/shared/starters.ts');
  const { MODULE_BY_ID } = await import('../src/shared/parts.ts');
  const { RULES_VERSION, migrateMatch, newMatch, newPlayer, weaponsReshaped } = await import('../src/shared/match.ts');
  assert.equal(RULES_VERSION, 7);
  const gen = await generated();
  const snap = () => JSON.stringify([...MODULE_BY_ID.values()].map((m) => Object.fromEntries(Object.entries(m).sort())));
  const before = snap();
  const moved = weaponsReshaped(newPlayer('A', gen));
  assert.equal(snap(), before, 'the current numbers are swapped back in full');
  assert.ok(moved.size > 0 && moved.size < gen.length, `reshaped ${moved.size}/${gen.length}`);
  // a design carrying only weapons the pass left alone is never re-checked
  const hunter = STARTER_DESIGNS.find((d) => d.id === 'starter-hunter')!;
  assert.ok(!weaponsReshaped(newPlayer('A', [hunter])).size, 'ATGM raiders: untouched');
  const re = gen.find((d) => moved.has(d.id))!;
  const deck = [re, hunter];
  const m = newMatch('r6', 'ai', 1, newPlayer('A', deck), newPlayer('B', deck, true), 0);
  m.rules = 6; m.status = 'deploy'; m.round = 2;
  m.players[0].board = [
    { uid: 1, designId: hunter.id, x: 30, y: 2, level: 1, round: 1 },
    { uid: 2, designId: re.id, x: 2, y: 2, level: 1, round: 1 },
  ];
  const supply0 = m.players[0].supply;
  assert.equal(migrateMatch(m), true);
  assert.equal(m.rules, 7);
  await checkBoard(m, { 1: [30, 2] });
  assert.ok(m.players[0].board.some((u) => u.uid === 2) || m.players[0].supply > supply0, 'the reshaped block is kept (moved if needed) or sold back');
  assert.equal(migrateMatch(m), false, 'idempotent');
});
