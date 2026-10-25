import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { validateDesign, computeStats, MAX_LEVEL } from '../src/shared/stats.ts';
import {
  START_HP, DECK_SIZE, MAX_UNITS, MAX_SIM_UNITS, newPlayer, newMatch, joinMatch, validateDeck, validateDeploy, applyDeploy,
  resolveRound, redactFor, battleInputFor, supplyForRound, upgradeCost, submitDeploy, isPlaceholder, roundDamage, sellValue, SELL_REFUND,
} from '../src/shared/match.ts';
import { blockDims, blockInZone, blocksOverlap, rectInZone, rectsOverlap, localRectToWorld, placementUnitCenters, type BlockShape, FIELD_W, FIELD_H, DEPLOY_W, DEPLOY_D } from '../src/shared/grid.ts';
/** zone edges, so geometry tests hold at any field size */
const ZW = DEPLOY_W, ZD = DEPLOY_D;
import type { DeployAction, Design, MatchState, Placement } from '../src/shared/types.ts';

test('starter designs are valid, unique and cover sizes/flyers/healers', () => {
  assert.ok(STARTER_DESIGNS.length >= 10);
  const ids = new Set<string>();
  for (const d of STARTER_DESIGNS) {
    assert.deepEqual(validateDesign(d), [], d.name);
    assert.ok(d.id.startsWith('starter-'));
    assert.ok(!ids.has(d.id));
    ids.add(d.id);
  }
  const stats = STARTER_DESIGNS.map(computeStats);
  assert.ok(stats.some((s) => s.size === 3));
  assert.ok(stats.some((s) => s.flying));
  assert.ok(!stats.some((s) => s.isStatic)); // the Anchor Mount is retired
  assert.ok(stats.some((s) => s.heal > 0));
  assert.ok(stats.some((s) => s.cost <= supplyForRound(1) / 4));
});

// a 16-unit light squad (no starter is cheap enough for 16 since the rules-7 prices: a shotgun scout is)
const cheap: Design = { id: 'cheap16', name: 'Shotgun Scout', chassis: 'scout', mobility: 'wheels', mounts: ['shotgun'] };
const deck = [cheap, ...STARTER_DESIGNS].slice(0, DECK_SIZE);
const big = STARTER_DESIGNS.find((d) => computeStats(d).size === 3)!;
/** block shapes: a 16-unit light squad (8 x 2) and a single 2x2 unit */
const SQ16: BlockShape = { size: 1, squad: 16 }, ONE2: BlockShape = { size: 2, squad: 1 };

function fresh(): MatchState {
  return newMatch('m1', 'ai', 42, newPlayer('A', [cheap, big, ...deck.filter((d) => d !== cheap && d !== big)].slice(0, DECK_SIZE)), newPlayer('B', deck, true), 1000);
}
const pl = (uid: number, x: number, y: number, designId = cheap.id, round = 1): Placement => ({ uid, designId, x, y, level: 1, round });

test('newMatch / join', () => {
  const m = fresh();
  assert.equal(m.status, 'deploy');
  assert.equal(m.round, 1);
  assert.equal(m.players[0].hp, START_HP);
  assert.equal(m.players[0].supply, supplyForRound(1));
  const w = newMatch('m2', 'pvp', 1, newPlayer('A', deck));
  assert.equal(w.status, 'waiting');
  assert.ok(isPlaceholder(w.players[1]));
  joinMatch(w, newPlayer('B', deck), 5);
  assert.equal(w.status, 'deploy');
  assert.equal(w.players[1].supply, supplyForRound(1));
  assert.equal(w.updatedAt, 5);
});

test('validateDeck', () => {
  assert.deepEqual(validateDeck(deck), []);
  assert.ok(validateDeck([]).length);
  assert.ok(validateDeck([...STARTER_DESIGNS, ...STARTER_DESIGNS].slice(0, DECK_SIZE + 1)).length);
  assert.ok(validateDeck([deck[0], deck[0]]).length);
  assert.ok(validateDeck([{ ...deck[0], name: '' }]).length);
  assert.ok(validateDeck([{ ...deck[0], mounts: ['nope'] }]).length);
});

test('validateDeploy accepts a legal deployment and rejects bad ones', () => {
  const m = fresh();
  const ok: DeployAction = { round: 1, place: [pl(1, 0, 0), pl(2, 8, 0)], upgrade: [] };
  assert.equal(validateDeploy(m, 0, ok), null);
  // an 8x2 squad footprint: one column short of 8 overlaps, 8 apart is fine, and the second row is free
  assert.match(validateDeploy(m, 0, { round: 1, place: [pl(1, 0, 0), pl(2, 7, 0)], upgrade: [] })!, /overlap/);
  assert.match(validateDeploy(m, 0, { round: 1, place: [pl(1, 0, 0), pl(2, 0, 1)], upgrade: [] })!, /overlap/);
  assert.equal(validateDeploy(m, 0, { round: 1, place: [pl(1, 0, 0), pl(2, 0, 2)], upgrade: [] }), null);
  assert.match(validateDeploy(m, 0, { round: 1, place: [pl(1, ZW - 7, 0)], upgrade: [] })!, /zone/);
  assert.equal(validateDeploy(m, 0, { round: 1, place: [pl(1, ZW - 8, ZD - 2)], upgrade: [] }), null);
  assert.match(validateDeploy(m, 0, { round: 1, place: [pl(1, 0, ZD - 1)], upgrade: [] })!, /zone/);
  // overlap with each other
  assert.match(validateDeploy(m, 0, { round: 1, place: [pl(1, 0, 0), pl(2, 0, 0)], upgrade: [] })!, /overlap/);
  // big unit overlapping a small one
  assert.match(validateDeploy(m, 0, { round: 1, place: [pl(1, 5, 5), pl(2, 4, 4, big.id)], upgrade: [] })!, /overlap/);
  // out of zone
  assert.match(validateDeploy(m, 0, { round: 1, place: [pl(1, ZW - 1, ZD - 1, big.id)], upgrade: [] })!, /zone/);
  assert.match(validateDeploy(m, 0, { round: 1, place: [pl(1, -1, 0)], upgrade: [] })!, /zone/);
  assert.match(validateDeploy(m, 0, { round: 1, place: [pl(1, 0.5, 0)], upgrade: [] })!, /zone/);
  // over budget
  const many = Array.from({ length: 12 }, (_, i) => pl(i + 1, (i % 6) * 8, Math.floor(i / 6) * 2));
  assert.match(validateDeploy(m, 0, { round: 1, place: many, upgrade: [] })!, /supply/);
  // bad uids
  assert.match(validateDeploy(m, 0, { round: 1, place: [pl(0, 0, 0)], upgrade: [] })!, /unit id/);
  assert.match(validateDeploy(m, 0, { round: 1, place: [pl(3, 0, 0), pl(3, 8, 0)], upgrade: [] })!, /Duplicate/);
  // wrong round, unknown design, level
  assert.ok(validateDeploy(m, 0, { round: 2, place: [], upgrade: [] }));
  assert.ok(validateDeploy(m, 0, { round: 1, place: [pl(1, 0, 0, 'zzz')], upgrade: [] }));
  assert.ok(validateDeploy(m, 0, { round: 1, place: [{ ...pl(1, 0, 0), level: 2 }], upgrade: [] }));
  assert.ok(validateDeploy(m, 0, { round: 1, place: [pl(1, 0, 0, cheap.id, 3)], upgrade: [] }));
  // upgrade of nonexistent unit
  assert.ok(validateDeploy(m, 0, { round: 1, place: [], upgrade: [7] }));
});

test('apply, upgrade limits, overlap with existing board, unit cap', () => {
  const m = fresh();
  const err = submitDeploy(m, 0, { round: 1, place: [pl(1, 0, 0), pl(2, 8, 0)], upgrade: [] });
  assert.equal(err, null);
  assert.equal(m.players[0].nextUid, 3);
  assert.equal(m.players[0].supply, supplyForRound(1) - 2 * computeStats(cheap).cost);
  assert.ok(validateDeploy(m, 0, { round: 1, place: [], upgrade: [] }), 'already ready');
  submitDeploy(m, 1, { round: 1, place: [], upgrade: [] });
  assert.equal(m.round, 2);
  assert.equal(m.history.length, 1);
  // overlap with existing unit
  assert.match(validateDeploy(m, 0, { round: 2, place: [pl(3, 0, 0, cheap.id, 2)], upgrade: [] })!, /overlap/);
  // upgrades
  m.players[0].supply = 100000;
  const ups = Array(MAX_LEVEL - 1).fill(1);
  assert.equal(validateDeploy(m, 0, { round: 2, place: [], upgrade: ups }), null);
  assert.match(validateDeploy(m, 0, { round: 2, place: [], upgrade: [...ups, 1] })!, /max level/);
  const before = m.players[0].supply;
  applyDeploy(m, 0, { round: 2, place: [], upgrade: ups });
  assert.equal(m.players[0].board[0].level, MAX_LEVEL);
  let c = 0;
  for (let l = 1; l < MAX_LEVEL; l++) c += upgradeCost(cheap, l);
  assert.equal(before - m.players[0].supply, c);
  // unit cap
  const m2 = fresh();
  m2.players[0].supply = 1e9;
  const lots: Placement[] = [];
  for (let i = 0; i < MAX_UNITS + 1; i++) lots.push(pl(i + 1, i % 24, Math.floor(i / 24)));
  assert.match(validateDeploy(m2, 0, { round: 1, place: lots, upgrade: [] })!, /Too many blocks/);
  // sim-unit cap: 16 squads = 256 units > 240 though only 16 blocks
  const squads: Placement[] = [];
  for (let i = 0; i < 16; i++) squads.push(pl(i + 1, (i % 6) * 8, Math.floor(i / 6) * 2));
  assert.match(validateDeploy(m2, 0, { round: 1, place: squads, upgrade: [] })!, new RegExp(`max ${MAX_SIM_UNITS}`));
  assert.equal(validateDeploy(m2, 0, { round: 1, place: squads.slice(0, 15), upgrade: [] }), null);
});

test('spacing: footprint grows, validated, stored and redacted', () => {
  const m = fresh();
  const sp = (uid: number, x: number, y: number, spacing: number | undefined, id = cheap.id): Placement => ({ ...pl(uid, x, y, id), spacing });
  assert.equal(computeStats(cheap).squad, 16);
  assert.deepEqual(blockDims(SQ16, 0), { w: 8, h: 2 });
  assert.deepEqual(blockDims(SQ16, 2), { w: 22, h: 4 });
  // spacing 2 -> 22x4 footprint: x=0..21 taken
  assert.match(validateDeploy(m, 0, { round: 1, place: [sp(1, 0, 0, 2), sp(2, 21, 0, 0)], upgrade: [] })!, /overlap/);
  assert.equal(validateDeploy(m, 0, { round: 1, place: [sp(1, 0, 0, 2), sp(2, 22, 0, 0)], upgrade: [] }), null);
  assert.equal(validateDeploy(m, 0, { round: 1, place: [sp(1, 0, 0, 2), sp(2, 0, 4, 0)], upgrade: [] }), null);
  assert.match(validateDeploy(m, 0, { round: 1, place: [sp(1, 0, 0, 2), sp(2, 0, 3, 0)], upgrade: [] })!, /overlap/);
  // zone check uses the spaced footprint
  assert.match(validateDeploy(m, 0, { round: 1, place: [sp(1, ZW - 21, 0, 2)], upgrade: [] })!, /zone/);
  assert.equal(validateDeploy(m, 0, { round: 1, place: [sp(1, ZW - 22, 0, 2)], upgrade: [] }), null);
  assert.match(validateDeploy(m, 0, { round: 1, place: [sp(1, 0, ZD - 3, 2)], upgrade: [] })!, /zone/);
  assert.equal(validateDeploy(m, 0, { round: 1, place: [sp(1, 0, ZD - 4, 2)], upgrade: [] }), null);
  // bad spacing values
  for (const bad of [-1, 3, 5, 1.5, NaN, '2' as unknown as number]) assert.match(validateDeploy(m, 0, { round: 1, place: [sp(1, 0, 0, bad)], upgrade: [] })!, /spacing/i);
  // non-squads can't be spaced
  assert.match(validateDeploy(m, 0, { round: 1, place: [sp(1, 0, 0, 2, big.id)], upgrade: [] })!, /spaced/);
  assert.equal(validateDeploy(m, 0, { round: 1, place: [sp(1, 0, 0, 0, big.id)], upgrade: [] }), null);
  // stored on the board, and kept for later overlap checks
  submitDeploy(m, 0, { round: 1, place: [sp(1, 0, 0, 2)], upgrade: [] });
  assert.equal(m.players[0].board[0].spacing, 2);
  submitDeploy(m, 1, { round: 1, place: [], upgrade: [] });
  assert.match(validateDeploy(m, 0, { round: 2, place: [{ ...sp(2, 4, 3, 0), round: 2 }], upgrade: [] })!, /overlap/);
  assert.equal(redactFor(m, 1).players[0].board[0].spacing, 2);
});

test('rectangular footprints: overlap, zone and world mapping', () => {
  assert.ok(rectsOverlap(0, 0, 8, 2, 7, 1, 8, 2));
  assert.ok(!rectsOverlap(0, 0, 8, 2, 8, 0, 8, 2));
  assert.ok(!rectsOverlap(0, 0, 8, 2, 0, 2, 8, 2));
  assert.ok(rectInZone(ZW - 8, ZD - 2, 8, 2) && !rectInZone(ZW - 7, ZD - 2, 8, 2) && !rectInZone(ZW - 8, ZD - 1, 8, 2) && !rectInZone(0.5, 0, 8, 2));
  assert.ok(blockInZone(ZW - 22, ZD - 4, SQ16, 2) && !blockInZone(ZW - 21, ZD - 4, SQ16, 2) && !blockInZone(ZW - 22, ZD - 3, SQ16, 2));
  assert.ok(blocksOverlap({ x: 0, y: 0, spacing: 2 }, SQ16, { x: 10, y: 2 }, SQ16)); // inside the spread squad's 22x4 box
  assert.ok(!blocksOverlap({ x: 0, y: 0, spacing: 2 }, SQ16, { x: 22, y: 0 }, SQ16));
  assert.ok(blocksOverlap({ x: 3, y: 1 }, SQ16, { x: 8, y: 1 }, ONE2)); // a size-2 unit against a squad
  // side 1 is the same rectangle rotated 180 degrees
  const r0 = localRectToWorld(0, 5, 1, 8, 2), r1 = localRectToWorld(1, 5, 1, 8, 2);
  assert.deepEqual([r0.col + 8, r0.row + 2], [FIELD_W - r1.col, FIELD_H - r1.row]);
  for (const spacing of [0, 1, 2]) {
    const c0 = placementUnitCenters(0, { x: 5, y: 1, spacing }, SQ16), c1 = placementUnitCenters(1, { x: 5, y: 1, spacing }, SQ16);
    assert.equal(c0.length, 16);
    c0.forEach((c, i) => assert.ok(Math.abs(c1[i].x - (FIELD_W - c.x)) < 1e-9 && Math.abs(c1[i].y - (FIELD_H - c.y)) < 1e-9));
  }
});

test('survivor damage scales with the surviving fraction of a squad', () => {
  const m = fresh();
  const boards: [Placement[], Placement[]] = [[pl(1, 0, 0, big.id)], []];
  const full = roundDamage(m, 3, 0, [[1], []], boards, [{ 1: 1 }, {}])[1];
  const half = roundDamage(m, 3, 0, [[1], []], boards, [{ 1: 0.25 }, {}])[1];
  assert.ok(full > half && half >= 5, `${full} ${half}`);
});

test('redaction hides pending placements, upgrades and supply', () => {
  const m = fresh();
  submitDeploy(m, 0, { round: 1, place: [pl(1, 0, 0)], upgrade: [] });
  submitDeploy(m, 1, { round: 1, place: [pl(1, 0, 0, deck[0].id)], upgrade: [] });
  // round 2: p1 places another unit and upgrades its old one
  m.players[1].supply = 10000;
  submitDeploy(m, 1, { round: 2, place: [pl(2, 5, 5, deck[0].id, 2)], upgrade: [1] });
  const v = redactFor(m, 0);
  assert.equal(v.players[1].board.length, 1);
  assert.equal(v.players[1].board[0].uid, 1);
  assert.equal(v.players[1].board[0].level, 1);
  assert.equal(v.players[1].supply, -1);
  assert.equal(v.players[1].ready, true);
  assert.notEqual(v.players[0].supply, -1);
  // original untouched
  assert.equal(m.players[1].board.length, 2);
  assert.equal(m.players[1].board[0].level, 2);
  // p1 sees its own stuff
  assert.equal(redactFor(m, 1).players[1].board.length, 2);
});

test('battleInputFor rebuilds the recorded input; damage rules', () => {
  const m = fresh();
  submitDeploy(m, 0, { round: 1, place: [pl(1, 0, 0)], upgrade: [] });
  submitDeploy(m, 1, { round: 1, place: [pl(1, 0, 0)], upgrade: [] });
  const rec = m.history[0];
  const bi = battleInputFor(m, rec);
  assert.equal(bi.seed, rec.seed);
  assert.deepEqual(bi.sides[0].units, rec.boards[0]);
  const boards: [Placement[], Placement[]] = [[pl(1, 0, 0, big.id)], [pl(1, 0, 0)]];
  const [d0, d1] = roundDamage(m, 3, 0, [[1], []], boards);
  assert.equal(d0, 0);
  assert.ok(d1 > 5);
  const [e0, e1] = roundDamage(m, 3, -1, [[], []], boards);
  assert.ok(e0 > 0 && e0 === e1);
});

test('match ends by hp or round cap', () => {
  const m = fresh();
  m.players[1].hp = 1;
  // force a draw-ish outcome: both empty boards; draw damage kills p1 at 1 hp
  submitDeploy(m, 0, { round: 1, place: [], upgrade: [] });
  submitDeploy(m, 1, { round: 1, place: [], upgrade: [] });
  assert.equal(m.status, 'done');
  assert.ok(m.winner === 0);
  const m2 = fresh();
  for (let r = 1; r <= 40 && m2.status === 'deploy'; r++) {
    m2.players[0].hp = m2.players[1].hp = 1e6; // never die
    submitDeploy(m2, 0, { round: m2.round, place: [], upgrade: [] });
    submitDeploy(m2, 1, { round: m2.round, place: [], upgrade: [] });
  }
  assert.equal(m2.status, 'done');
  assert.equal(m2.winner, -1);
  assert.equal(m2.history.length, 15);
});

test('resolveRound is a no-op until both ready', () => {
  const m = fresh();
  resolveRound(m);
  assert.equal(m.history.length, 0);
});

test('target / hold / kite validation, configure and redaction', () => {
  const m = fresh();
  const w = (extra: object): DeployAction => ({ round: 1, place: [{ ...pl(1, 0, 0), ...extra }], upgrade: [] });
  assert.equal(validateDeploy(m, 0, w({ target: 'lowestHp', hold: true, kite: false })), null);
  for (const bad of [{ target: 'x' }, { hold: 'y' }, { kite: 0 }]) assert.ok(validateDeploy(m, 0, w(bad)), JSON.stringify(bad));
  submitDeploy(m, 0, w({ target: 'lowestHp', hold: true, kite: true, spacing: 2 }));
  submitDeploy(m, 1, { round: 1, place: [pl(1, 0, 0, deck[0].id)], upgrade: [] });
  assert.equal(m.round, 2);
  const b = m.players[0].board[0];
  assert.deepEqual([b.target, b.hold, b.kite, b.spacing], ['lowestHp', true, true, 2]);
  // configure: free, any uid on own board, validated; spacing can't change
  assert.ok(validateDeploy(m, 0, { round: 2, place: [], upgrade: [], configure: [{ uid: 9, kite: true }] }));
  assert.ok(validateDeploy(m, 0, { round: 2, place: [], upgrade: [], configure: [{ uid: 1, target: 'bad' as never }] }));
  const before = m.players[0].supply;
  submitDeploy(m, 0, { round: 2, place: [], upgrade: [], configure: [{ uid: 1, target: 'farthest', kite: false }] });
  assert.equal(m.players[0].supply, before);
  assert.deepEqual([b.target, b.hold, b.kite, b.spacing], ['farthest', true, false, 2]);
  // the opponent never sees current settings; history keeps them
  const v = redactFor(m, 1);
  assert.equal(v.players[0].board[0].target, undefined);
  assert.equal(v.players[0].board[0].hold, undefined);
  assert.equal(v.players[0].board[0].kite, undefined);
  assert.equal(v.players[0].board[0].spacing, 2);
  assert.equal(v.history[0].boards[0][0].target, 'lowestHp');
  assert.equal(redactFor(m, 0).players[0].board[0].target, 'farthest');
});

test('design behavior defaults: validated, hidden from the opponent', () => {
  assert.deepEqual(validateDeck([{ ...deck[0], behavior: { target: 'closest', hold: true, kite: false } }]), []);
  assert.ok(validateDeck([{ ...deck[0], behavior: { target: 'nope' as never } }]).length);
  assert.ok(validateDeck([{ ...deck[0], behavior: { hold: 'x' as never } }]).length);
  const m = fresh();
  m.players[1].deck[0].behavior = { kite: true };
  assert.equal(redactFor(m, 0).players[1].deck[0].behavior, undefined);
  assert.deepEqual(redactFor(m, 1).players[1].deck[0].behavior, { kite: true });
});

test('focus / stance / delay / retreat / escort: validation, configure, redaction', () => {
  const m = fresh();
  const w = (extra: object): DeployAction => ({ round: 1, place: [{ ...pl(1, 0, 0), ...extra }], upgrade: [] });
  assert.equal(validateDeploy(m, 0, w({ focus: true, stance: 'charge', delay: 10, retreat: true })), null);
  for (const stance of ['advance', 'holdPos', 'charge', 'flankLeft', 'flankRight']) assert.equal(validateDeploy(m, 0, w({ stance })), null, stance);
  for (const d of [0, 3, 6, 10]) assert.equal(validateDeploy(m, 0, w({ delay: d })), null);
  for (const bad of [{ focus: 'y' }, { retreat: 1 }, { stance: 'nope' }, { stance: 3 }, { delay: 4 }, { delay: '3' }, { delay: -3 }, { escort: 1 }, { escort: 99 }, { escort: 1.5 }, { escort: 'x' }, { target: 'bogus' }]) {
    assert.ok(validateDeploy(m, 0, w(bad)), JSON.stringify(bad));
  }
  // new priorities are legal
  for (const t of ['aircraft', 'armored', 'longestRange', 'support', 'valuable', 'swarm']) assert.equal(validateDeploy(m, 0, w({ target: t })), null, t);
  // escort may point at a unit bought in the same action, but not at itself
  const two: DeployAction = { round: 1, place: [{ ...pl(1, 0, 0), escort: 2 }, pl(2, 8, 0)], upgrade: [] };
  assert.equal(validateDeploy(m, 0, two), null);
  assert.ok(validateDeploy(m, 0, { round: 1, place: [{ ...pl(1, 0, 0), escort: 1 }], upgrade: [] }));

  submitDeploy(m, 0, { round: 1, place: [{ ...pl(1, 0, 0), focus: true, stance: 'holdPos', delay: 3, retreat: true }, { ...pl(2, 8, 0), escort: 1 }], upgrade: [] });
  submitDeploy(m, 1, { round: 1, place: [pl(1, 0, 0, deck[0].id)], upgrade: [] });
  assert.equal(m.round, 2);
  const b = m.players[0].board[0];
  assert.deepEqual([b.focus, b.stance, b.delay, b.retreat, m.players[0].board[1].escort], [true, 'holdPos', 3, true, 1]);

  // configure: escort must be an own uid (or -1 to clear); stance/delay validated; free of charge
  const cfg = (c: object): DeployAction => ({ round: 2, place: [], upgrade: [], configure: [{ uid: 2, ...c }] });
  assert.ok(validateDeploy(m, 0, cfg({ escort: 2 })), 'self');
  assert.ok(validateDeploy(m, 0, cfg({ escort: 77 })), 'unknown');
  assert.ok(validateDeploy(m, 0, cfg({ stance: 'x' })));
  assert.ok(validateDeploy(m, 0, cfg({ delay: 5 })));
  assert.ok(validateDeploy(m, 0, cfg({ focus: 'no' })));
  assert.equal(validateDeploy(m, 0, cfg({ escort: -1 })), null);
  const before = m.players[0].supply;
  submitDeploy(m, 0, { round: 2, place: [], upgrade: [], configure: [{ uid: 2, escort: -1, stance: 'flankRight', delay: 10, focus: true, retreat: false }, { uid: 1, escort: 2, stance: 'advance' }] });
  assert.equal(m.players[0].supply, before);
  const [u1, u2] = m.players[0].board;
  assert.equal(u2.escort, undefined, 'escort -1 clears');
  assert.deepEqual([u2.stance, u2.delay, u2.focus, u2.retreat], ['flankRight', 10, true, false]);
  assert.deepEqual([u1.escort, u1.stance], [2, 'advance']);

  // the opponent sees none of them; history and the owner keep everything
  const v = redactFor(m, 1);
  for (const u of v.players[0].board) for (const k of ['target', 'hold', 'kite', 'focus', 'stance', 'delay', 'retreat', 'escort'] as const) assert.equal(u[k], undefined, k);
  assert.equal(v.history[0].boards[0][0].stance, 'holdPos');
  assert.equal(v.history[0].boards[0][1].escort, 1);
  assert.equal(redactFor(m, 0).players[0].board[1].stance, 'flankRight');
});

test('design behavior defaults: new fields validated and hidden', () => {
  assert.deepEqual(validateDeck([{ ...deck[0], behavior: { target: 'aircraft', focus: true, stance: 'holdPos', delay: 6, retreat: true } }]), []);
  for (const behavior of [{ stance: 'x' }, { delay: 2 }, { focus: 'y' }, { retreat: 0 }]) {
    assert.ok(validateDeck([{ ...deck[0], behavior: behavior as never }]).length, JSON.stringify(behavior));
  }
  const m = fresh();
  m.players[1].deck[0].behavior = { stance: 'charge', delay: 3 };
  assert.equal(redactFor(m, 0).players[1].deck[0].behavior, undefined);
  assert.deepEqual(redactFor(m, 1).players[1].deck[0].behavior, { stance: 'charge', delay: 3 });
});

test('kiteMount: validated against weapon mounts, configure/clear, redacted', () => {
  const m = fresh();
  const w = (extra: object): DeployAction => ({ round: 1, place: [{ ...pl(1, 0, 0), ...extra }], upgrade: [] });
  const d = m.players[0].deck.find((x) => x.id === pl(1, 0, 0).designId)!;
  const weapon = d.mounts.findIndex((id) => id);
  assert.ok(weapon >= 0);
  assert.equal(validateDeploy(m, 0, w({ kite: true, kiteMount: weapon })), null);
  for (const bad of [-1, 99, 1.5, 'x']) assert.ok(validateDeploy(m, 0, w({ kiteMount: bad })), String(bad));
  submitDeploy(m, 0, w({ kite: true, kiteMount: weapon }));
  submitDeploy(m, 1, { round: 1, place: [pl(1, 0, 0, deck[0].id)], upgrade: [] });
  assert.equal(m.players[0].board[0].kiteMount, weapon);
  assert.ok(validateDeploy(m, 0, { round: 2, place: [], upgrade: [], configure: [{ uid: 1, kiteMount: 99 }] }));
  assert.equal(validateDeploy(m, 0, { round: 2, place: [], upgrade: [], configure: [{ uid: 1, kiteMount: -1 }] }), null);
  assert.equal(redactFor(m, 1).players[0].board[0].kiteMount, undefined);
  assert.equal(redactFor(m, 1).history[0].boards[0][0].kiteMount, weapon);
  submitDeploy(m, 0, { round: 2, place: [], upgrade: [], configure: [{ uid: 1, kiteMount: -1 }] });
  assert.equal(m.players[0].board[0].kiteMount, undefined);
});

test('non-square footprints: validateDeploy zone + overlap use the real w x h', () => {
  const long: Design = { id: 'lg', name: 'Long', chassis: 'longarm', mobility: 'halftrack', mounts: ['howitzer'] }; // 1 wide x 3 long, a single unit (a cheaper gun makes it a x2 squad)
  const wide: Design = { id: 'wd', name: 'Wide', chassis: 'riot', mobility: 'treads', mounts: ['mg', 'mg'] }; // 3 wide x 2 long
  const st = computeStats(long), sw = computeStats(wide);
  assert.deepEqual([st.fw, st.fh, sw.fw, sw.fh], [1, 3, 3, 2]);
  assert.deepEqual(blockDims(st, 0), { w: 1, h: 3 });
  const m = newMatch('mf', 'ai', 7, newPlayer('A', [long, wide, ...deck].slice(0, DECK_SIZE)), newPlayer('B', deck, true), 1000);
  m.players[0].supply = 5000;
  const at = (uid: number, x: number, y: number, id: string): Placement => pl(uid, x, y, id);
  const v = (...place: Placement[]) => validateDeploy(m, 0, { round: 1, place, upgrade: [] });
  // zone: 1x3 fits down to y=ZD-3, not ZD-2; 3 wide at the right edge
  assert.equal(v(at(1, 0, ZD - 3, 'lg')), null);
  assert.match(v(at(1, 0, ZD - 2, 'lg'))!, /zone/);
  assert.equal(v(at(1, ZW - 3, 0, 'wd')), null);
  assert.match(v(at(1, ZW - 2, 0, 'wd'))!, /zone/);
  // a 1x3 block and a 3x1-ish (3 wide x 2 long) block: overlap exactly when the rectangles intersect
  assert.ok(blocksOverlap({ x: 5, y: 0 }, st, { x: 3, y: 2 }, sw));
  assert.ok(!blocksOverlap({ x: 5, y: 0 }, st, { x: 3, y: 3 }, sw));
  assert.ok(!blocksOverlap({ x: 5, y: 0 }, st, { x: 6, y: 0 }, sw));
  assert.match(v(at(1, 5, 0, 'lg'), at(2, 3, 2, 'wd'))!, /overlap/);
  assert.equal(v(at(1, 5, 0, 'lg'), at(2, 3, 3, 'wd')), null);
  assert.equal(v(at(1, 5, 0, 'lg'), at(2, 6, 0, 'wd')), null);
});

test('rotation: squads turn 90° (8x2 -> 2x8), validated, stored, and units laid out in the turned block', () => {
  const m = fresh();
  assert.deepEqual(blockDims(SQ16, 0, true), { w: 2, h: 8 });
  assert.deepEqual(blockDims(SQ16, 1, true), { w: 3, h: 15 });
  // a rotated packed squad is 8 deep: fits with its back on the zone's rear edge, not one row further
  const r = (uid: number, x: number, y: number): Placement => ({ ...pl(uid, x, y), rot: true });
  assert.equal(validateDeploy(m, 0, { round: 1, place: [r(1, 0, ZD - 8)], upgrade: [] }), null);
  assert.match(validateDeploy(m, 0, { round: 1, place: [r(1, 0, ZD - 7)], upgrade: [] })!, /outside/);
  // two rotated columns side by side don't overlap; a flat squad across them does
  assert.equal(validateDeploy(m, 0, { round: 1, place: [r(1, 0, 0), r(2, 2, 0)], upgrade: [] }), null);
  assert.match(validateDeploy(m, 0, { round: 1, place: [r(1, 0, 0), pl(2, 0, 3)], upgrade: [] })!, /overlap/);
  const c = placementUnitCenters(0, { x: 0, y: 0, rot: true }, SQ16);
  assert.equal(c.length, 16);
  assert.equal(new Set(c.map((p) => p.x)).size, 2, 'two columns');
  assert.equal(new Set(c.map((p) => p.y)).size, 8, 'eight rows');
  // stored on the board through applyDeploy
  applyDeploy(m, 0, { round: 1, place: [r(1, 0, 0)], upgrade: [] });
  assert.equal(m.players[0].board.find((u) => u.uid === 1)?.rot, true);
});

test('selling: units from earlier rounds sell for 75% of purchase + upgrades; room, units and refund are usable the same turn; hidden from the opponent', () => {
  const m = fresh();
  assert.equal(submitDeploy(m, 0, { round: 1, place: [pl(1, 0, 0), pl(2, 12, 0)], upgrade: [] }), null);
  submitDeploy(m, 1, { round: 1, place: [], upgrade: [] });
  assert.equal(m.round, 2);
  const p = m.players[0];
  // upgrade unit 1 this turn first, then sell it next turn
  p.supply = 100000;
  applyDeploy(m, 0, { round: 2, place: [], upgrade: [1] });
  p.ready = false;
  const lvl = p.board.find((u) => u.uid === 1)!.level;
  assert.equal(lvl, 2);
  const invested = computeStats(cheap).cost + upgradeCost(cheap, 1);
  assert.ok(Math.abs(sellValue(cheap, 2) - invested * SELL_REFUND) <= 10, `${sellValue(cheap, 2)} vs ${invested * SELL_REFUND}`);
  // can't sell unknown / twice / then upgrade the sold unit
  assert.match(validateDeploy(m, 0, { round: 2, place: [], upgrade: [], sell: [99] })!, /unknown/);
  assert.match(validateDeploy(m, 0, { round: 2, place: [], upgrade: [], sell: [1, 1] })!, /twice/);
  assert.match(validateDeploy(m, 0, { round: 2, place: [], upgrade: [1], sell: [1] })!, /unknown/);
  // the sold block's spot is free for a new block in the same action, and the refund pays for it
  p.supply = 0;
  const reuse = { round: 2, place: [pl(3, 0, 0, cheap.id, 2)], upgrade: [], sell: [1] };
  assert.equal(validateDeploy(m, 0, reuse), null);
  const before = p.supply;
  applyDeploy(m, 0, reuse);
  assert.equal(p.supply, before + sellValue(cheap, 2) - computeStats(cheap).cost);
  assert.ok(!p.board.some((u) => u.uid === 1));
  // the opponent still sees the board as it fought last round (sold unit included, new one hidden)
  const view = redactFor(m, 1);
  assert.ok(view.players[0].board.some((u) => u.uid === 1));
  assert.ok(!view.players[0].board.some((u) => u.uid === 3));
});
