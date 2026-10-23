// Prices shown in the UI (garage, deck builder, shop, hover cards, upgrade button) and prices charged by the rules
// must agree: one source of truth (computeStats().cost, upgradeCost), every per-unit figure derived from it.
// scripts/cost-audit.ts runs the same checks over hundreds of generated designs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { computeStats, fmtUnitPrice, roundPrice } from '../src/shared/stats.ts';
import { SELL_REFUND, actionCost, applyDeploy, designCost, newMatch, newPlayer, placementValue, redactFor, sellValue, upgradeCost, validateDeploy } from '../src/shared/match.ts';
import { generateDesign, profile, type Role } from '../src/shared/ai.ts';
import { designInfo } from '../src/client/ui/deckstats.ts';
import { makeRng } from '../src/shared/rng.ts';
import type { Design, MatchState } from '../src/shared/types.ts';

function designs(): Design[] {
  const out = STARTER_DESIGNS.map((d) => structuredClone(d));
  const rng = makeRng(99);
  const roles: Role[] = ['swarm', 'frontline', 'antiArmor', 'antiAir', 'artillery', 'flyer', 'support', 'skirmisher'];
  for (let i = 0; i < 120; i++) { const g = generateDesign(rng, roles[i % roles.length], `g${i}`, i % 17 === 0); if (g) out.push(g); }
  return out;
}
const DESIGNS = designs();

function matchWith(d: Design, supply: number): MatchState {
  const m = newMatch('t', 'ai', 1, newPlayer('a', [d]), newPlayer('b', [d], true), 0);
  m.players[0].supply = supply;
  return m;
}

test('every price path reads the same block price (stats, rules, deck builder, AI, clones, behavior)', () => {
  for (const d of DESIGNS) {
    const s = computeStats(d);
    assert.equal(designCost(d), s.cost, d.name);
    assert.equal(designInfo(d)!.cost, s.cost, d.name);
    assert.equal(profile(d).cost, s.cost, d.name);
    assert.equal(computeStats(JSON.parse(JSON.stringify(d))).cost, s.cost, d.name);
    assert.equal(computeStats({ ...d, behavior: { kite: true, hold: true, target: 'armored' } }).cost, s.cost, `${d.name}: orders must not change the price`);
  }
});

test('per-unit price x squad is the block price, and the garage breakdown rows add up to it', () => {
  for (const d of DESIGNS) {
    const s = computeStats(d);
    // bug: unitCost was round(raw / 5) per unit, so "≈9 each" x 16 = 144 for a 150 block (and 64 for a 60 tank)
    assert.ok(Math.abs(s.unitCost * s.squad - s.cost) < 1e-9, `${d.name}: ${s.unitCost} x ${s.squad} vs ${s.cost}`);
    assert.ok(Math.abs(Number(fmtUnitPrice(s.unitCost)) * s.squad - s.cost) <= 0.05 * s.squad + 1e-9, `${d.name}: shown ≈${fmtUnitPrice(s.unitCost)} each`);
    // bug: the Intel tab showed raw model numbers (no hull class / drive factor, not ÷ 5) that summed to nothing
    const sum = (s.priceParts + s.pricePower + s.priceSupport) * s.squad;
    assert.equal(roundPrice(sum), s.cost, `${d.name}: breakdown ${sum}`);
    assert.ok(s.priceParts >= 0 && s.pricePower >= 0 && s.priceSupport >= 0, d.name);
  }
  assert.equal(fmtUnitPrice(9.375), '9.4');
  assert.equal(fmtUnitPrice(20), '20');
  assert.equal(fmtUnitPrice(1234.5), '1235');
  assert.equal(fmtUnitPrice(112.5), '112.5');
});

test('buying, upgrading and selling move exactly the shown supply', () => {
  for (const d of DESIGNS) {
    const cost = computeStats(d).cost;
    const a = { round: 1, place: [{ uid: 1, designId: d.id, x: 0, y: 0, level: 1, round: 1 }], upgrade: [] as number[] };
    assert.equal(validateDeploy(matchWith(d, cost), 0, a), null, `${d.name}: exactly ${cost} supply must buy it`);
    assert.match(validateDeploy(matchWith(d, cost - 1), 0, a) ?? '', /Not enough supply/, d.name);
    const m = matchWith(d, 100000);
    assert.equal(actionCost(m, 0, a), cost);
    applyDeploy(m, 0, a);
    assert.equal(m.players[0].supply, 100000 - cost, d.name);
    // next round: the upgrade button shows upgradeCost(d, level + pending); two in one action
    m.round = 2; m.players[0].ready = false;
    const up = { round: 2, place: [], upgrade: [1, 1] };
    const shown = upgradeCost(d, 1) + upgradeCost(d, 2);
    assert.equal(validateDeploy(m, 0, up), null, d.name);
    const before = m.players[0].supply;
    applyDeploy(m, 0, up);
    assert.equal(before - m.players[0].supply, shown, d.name);
    assert.equal(m.players[0].board[0].level, 3);
    assert.equal(placementValue(d, 3), cost + shown);
    // selling it next round returns exactly the shown "Sell · +N"
    m.round = 3; m.players[0].ready = false;
    const back = sellValue(d, 3);
    assert.equal(back, roundPrice((cost + shown) * SELL_REFUND));
    const sell = { round: 3, place: [], upgrade: [], sell: [1] };
    assert.equal(validateDeploy(m, 0, sell), null, d.name);
    const pre = m.players[0].supply;
    applyDeploy(m, 0, sell);
    assert.equal(m.players[0].supply - pre, back, `${d.name}: sell refund`);
    assert.equal(computeStats(redactFor(m, 1).players[0].deck[0]).cost, cost, 'the opponent sees the same price');
  }
});

test('the garage never labels raw part complexity points as supply', () => {
  // bug: chassis / drive / module inspectors showed the parts' raw complexity (c.cost, m.cost) with the supply icon as
  // "Base cost" / "Cost": numbers on a different scale from anything the match charges
  for (const f of ['garage.ts', 'garage-parts.ts']) {
    const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'client', 'ui', f), 'utf8');
    assert.ok(!/Base cost/.test(src), `${f} still shows "Base cost"`);
    assert.ok(!/icon\('cost'\), String\((c|m)\.cost/.test(src), `${f} shows a part's complexity with the supply icon`);
  }
});
