// Team-value pricing (stats.ts TEAM_FIT, fitted by scripts/teamvalue.ts; shipped OFF via TEAM_VALUE.on): the switch,
// the fitted constants, the monotone price floor, the clamp, and the rules-5 migration that keeps boards legal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHASSIS, MOBILITY, MODULES, pairingError } from '../src/shared/parts.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { TEAM_FEATURES, TEAM_FIT, TEAM_VALUE, TOUGH, analyticStats, clearPriceCache, computeStats, slotError, squadK, teamMultiplier, validateDesign } from '../src/shared/stats.ts';
import { MAX_BLOCKS, MAX_SIM_UNITS, RULES_VERSION, migrateMatch, newMatch, newPlayer, placementValue, relegalizeBoard, shapeOf } from '../src/shared/match.ts';
import { DEPLOY_D, DEPLOY_W, blockDims, blockInZone, blocksOverlap } from '../src/shared/grid.ts';
import type { Design, Placement } from '../src/shared/types.ts';

const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id, chassis, mobility, mounts });

test('the fitted constants in stats.ts are the ones scripts/teamvalue.ts wrote', () => {
  const fit = JSON.parse(readFileSync(new URL('../scripts/teamvalue-fit.json', import.meta.url), 'utf8'));
  assert.equal(TEAM_FIT.b0, fit.b0);
  for (const k of TEAM_FEATURES) {
    assert.equal(TEAM_FIT.beta[k], fit.beta[k], `beta.${k}`);
    assert.equal(TEAM_FIT.center[k], fit.center[k], `center.${k}`);
  }
  assert.deepEqual([TEAM_FIT.min, TEAM_FIT.max], [fit.min, fit.max]);
});

test('the team-value correction ships off: the price is the analytic one (raised only by the monotone floor)', () => {
  assert.equal(TEAM_VALUE.on, false);
  for (const d of designs(300, 9)) {
    const s = computeStats(d), a = analyticStats(d);
    assert.ok(s.cost >= a.cost, `${d.chassis}/${d.mobility} [${d.mounts}]: ${s.cost} < analytic ${a.cost}`);
    assert.equal(s.squad, a.squad);
  }
  // a starter priced above its analytic price is there only because a sub-design (one module fewer) is dearer
  // (the Thunderbird: one bay fewer it is lighter and faster, and the old formula priced that higher)
  for (const d of STARTER_DESIGNS) {
    const c = computeStats(d).cost;
    if (c === analyticStats(d).cost) continue;
    const subs = d.mounts.map((_, i) => computeStats({ ...d, mounts: d.mounts.map((x, j) => (j === i ? null : x)) }).cost);
    assert.ok(subs.some((x) => x >= c - 10), `${d.name}: ${c} vs analytic ${analyticStats(d).cost}, subs ${subs}`);
  }
});

test('toughness floor (wall tax): weaponless walls pay for their hull; ordinary designs and the starters are untouched', () => {
  const wall = D('m2', 'monolith', 'spider', ['bulwarkshield', 'pointdef']);
  const twin = D('m1', 'monolith', 'titanlegs', ['twinmg', null]);
  const smoke = D('m3', 'monolith', 'titanlegs', ['smoke', null]);
  const hull = D('j1', 'juggernaut', 'treads', ['plateH', 'smoke']);
  assert.equal(analyticStats(wall).cost, 190); // 180 before the drive rework (spider legs slower and repriced), 160 before the utility remake (lighter, cheaper shield generator with a speed cost), 150 before the rules-7 re-fit (titan SIZE_K 1.34 -> 1.68)
  assert.ok(computeStats(wall).cost >= 400, `the player's shield + point-defense wall: ${computeStats(wall).cost}`);
  assert.ok(computeStats(twin).cost >= 400 && computeStats(smoke).cost >= 350, `${computeStats(twin).cost} / ${computeStats(smoke).cost}`);
  assert.ok(computeStats(hull).cost >= 2 * analyticStats(hull).cost, `Monolith Hull plate + smoke ${analyticStats(hull).cost} -> ${computeStats(hull).cost}`);
  // a gun on a taxed wall still pays at least half its own analytic price (it isn't free up to the floor)
  const bare = D('m0', 'monolith', 'titanlegs', [null, 'smoke']), gun = D('m4', 'monolith', 'titanlegs', ['mg', 'smoke']);
  const dA = analyticStats(gun).cost - analyticStats(bare).cost, dN = computeStats(gun).cost - computeStats(bare).cost;
  assert.ok(dN >= 0.5 * dA - 10, `mg on a wall: +${dN} (analytic +${dA})`);
  // ordinary hulls sit below the threshold; gun-heavy giants' guns already cost more than the floor
  for (const d of STARTER_DESIGNS) assert.equal(computeStats(d).toughTax, 0, d.name);
  assert.equal(TOUGH.t0 > 0 && TOUGH.a > 0, true);
});

test('the switch works: on, the fitted correction prices walls up (tooling: scripts/teamvalue.ts TV_ON=1)', () => {
  const wall = D('m2', 'monolith', 'spider', ['bulwarkshield', 'pointdef']);
  const off = computeStats(wall).cost;
  TEAM_VALUE.on = true; clearPriceCache();
  try {
    const on = computeStats(wall);
    assert.ok(on.cost >= off + 50, `wall ${off} -> ${on.cost}`);
  } finally { TEAM_VALUE.on = false; clearPriceCache(); }
  assert.equal(computeStats(wall).cost, off);
});

test('the multiplier is clamped', () => {
  const hi = Object.fromEntries(TEAM_FEATURES.map((k) => [k, TEAM_FIT.center[k] + 1e3 * Math.sign(TEAM_FIT.beta[k])])) as Record<typeof TEAM_FEATURES[number], number>;
  const lo = Object.fromEntries(TEAM_FEATURES.map((k) => [k, TEAM_FIT.center[k] - 1e3 * Math.sign(TEAM_FIT.beta[k])])) as Record<typeof TEAM_FEATURES[number], number>;
  assert.equal(teamMultiplier(hi), TEAM_FIT.max);
  assert.equal(teamMultiplier(lo), TEAM_FIT.min);
  assert.ok(TEAM_FIT.min >= 0.5 && TEAM_FIT.max <= 2.5);
});

/** deterministic random legal designs */
function designs(n: number, seed = 7): Design[] {
  let s = seed;
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out: Design[] = [];
  for (let t = 0; out.length < n && t < n * 20; t++) {
    const c = CHASSIS[Math.floor(r() * CHASSIS.length)];
    const mobs = MOBILITY.filter((m) => !pairingError(c.id, m.id));
    const m = mobs[Math.floor(r() * mobs.length)];
    const mounts = c.mounts.map((_, i) => {
      if (r() < 0.25) return null;
      const ok = MODULES.filter((x) => !slotError(c, m.id, i, x));
      return ok.length ? ok[Math.floor(r() * ok.length)].id : null;
    });
    const d = D(`g${t}`, c.id, m.id, mounts);
    if (!validateDesign(d).length) out.push(d);
  }
  return out;
}

test('prices are monotone: adding a weapon (or any module) never makes a unit cheaper', () => {
  // per-unit price before the squad factor; the block price rounds to 10, i.e. +-5 / squad per unit
  const unit = (d: Design) => { const s = computeStats(d); return { v: (s.cost / s.squad) / squadK(s.size, s.squad), tol: 5 / s.squad }; };
  let checked = 0;
  for (const d of designs(300)) {
    const full = unit(d);
    d.mounts.forEach((id, i) => {
      if (!id) return;
      const sub = { ...d, mounts: d.mounts.map((x, j) => (j === i ? null : x)) };
      const p = unit(sub);
      assert.ok(full.v + full.tol + p.tol + 1e-9 >= p.v, `${d.chassis}/${d.mobility} [${d.mounts}] ${full.v} < without ${id} ${p.v}`);
      checked++;
    });
  }
  assert.ok(checked > 300);
  // the reported multiplier stays inside the clamp unless the monotone floor lifted it
  for (const d of designs(200, 3)) assert.ok(computeStats(d).teamMult >= TEAM_FIT.min - 1e-9, d.id);
});

test('rules 5: repricing keeps every squad (tiers use the analytic price), and boards stay legal', () => {
  for (const d of designs(400, 11)) assert.equal(computeStats(d).squad, analyticStats(d).squad, `${d.chassis}/${d.mobility} [${d.mounts}]`);
  // a rules-4 match: prices change, the board doesn't
  const deck = designs(200, 5).filter((d) => computeStats(d).size <= 2).slice(0, 6).map((d, i) => ({ ...d, id: `d${i}`, name: `d${i}` }));
  const m = newMatch('old4', 'ai', 1, newPlayer('A', deck), newPlayer('B', deck, true), 0);
  m.rules = 4;
  m.round = 3;
  const p = m.players[0];
  let x = 0, uid = 1;
  for (const d of deck) { const s = computeStats(d); const sp = s.squad > 1 ? 1 : 0; p.board.push({ uid: uid++, designId: d.id, x, y: 0, level: 2, round: 1, spacing: sp }); x += blockDims(s, sp).w + 1; }
  p.nextUid = uid;
  const before = JSON.stringify(p.board), supply = p.supply;
  assert.equal(migrateMatch(m), true);
  assert.equal(m.rules, RULES_VERSION);
  assert.equal(JSON.stringify(p.board), before, 'no block moved');
  assert.equal(p.supply, supply, 'no refunds for the price change');
  assert.equal(migrateMatch(m), false, 'idempotent');
});

test('relegalizeBoard: a reshaped block moves to the nearest free spot, or is sold back when nothing fits', () => {
  const big = D('big', 'bastion', 'treads', ['cannon', 'plateM', 'autocannon']);
  const small = D('small', 'warden', 'treads', ['autocannon', 'plateL']);
  const deck = [big, small];
  const m = newMatch('rl', 'ai', 1, newPlayer('A', deck), newPlayer('B', deck, true), 0);
  const p = m.players[0];
  // 'big' overlaps the block before it and pokes out of the zone: as if its footprint had just grown
  p.board = [
    { uid: 1, designId: 'small', x: 10, y: 0, level: 1, round: 1 },
    { uid: 2, designId: 'big', x: 11, y: 1, level: 2, round: 1, escort: 1 },
    { uid: 3, designId: 'big', x: DEPLOY_W - 1, y: DEPLOY_D - 1, level: 1, round: 1 },
  ];
  p.supply = 0;
  relegalizeBoard(p, new Set(['big']));
  const shapes = p.board.map((u) => shapeOf(deck.find((d) => d.id === u.designId)));
  p.board.forEach((u, i) => {
    assert.ok(blockInZone(u.x, u.y, shapes[i], u.spacing, !!u.rot), `block ${u.uid} out of the zone`);
    for (let j = 0; j < i; j++) assert.ok(!blocksOverlap(u, shapes[i], p.board[j], shapes[j]), `blocks ${u.uid} and ${p.board[j].uid} overlap`);
  });
  assert.deepEqual(p.board.map((u) => u.uid), [1, 2, 3], 'both moved, nothing sold');
  assert.deepEqual([p.board[0].x, p.board[0].y], [10, 0], 'the legal block stays put');
  assert.equal(p.supply, 0);
  // a full board (the block cap): the forced block can't stay and is sold back at its full value (price + upgrades)
  const fill: Placement[] = [];
  const ss = computeStats(small);
  for (let y = 0; y + ss.fh <= DEPLOY_D; y += ss.fh) for (let xx = 0; xx + ss.fw <= DEPLOY_W; xx += ss.fw) if (fill.length < MAX_BLOCKS) fill.push({ uid: fill.length + 10, designId: 'small', x: xx, y, level: 1, round: 1 });
  p.board = [...fill, { uid: 5, designId: 'big', x: 0, y: 0, level: 2, round: 1 }];
  relegalizeBoard(p, new Set(['big']));
  assert.ok(!p.board.some((u) => u.uid === 5));
  assert.equal(p.supply, placementValue(big, 2));
  assert.ok(p.board.length <= MAX_BLOCKS && p.board.reduce((t, u) => t + shapeOf(deck.find((d) => d.id === u.designId)).squad, 0) <= MAX_SIM_UNITS);
});
