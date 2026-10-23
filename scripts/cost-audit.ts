// Price audit: for every starter design plus a set of generated designs, compute every number the game shows or
// charges for it through the same functions the UI / rules / AI use, and report any that disagree.
//
//   node scripts/cost-audit.ts            (N=400 generated designs by default; N=<n> env to change)
//
// Paths compared (per design):
//   stats      computeStats(d).cost                     garage header, list, deck builder, shop card, hover card, lobby
//   rules      designCost(d), actionCost(place)          validateDeploy / applyDeploy (what is charged)
//   charged    supply delta of a real applyDeploy(place)  the match
//   deckinfo   designInfo(d).cost                         deck builder stats panel
//   ai         profile(d).cost                            AI budgeting
//   clone      cost after structuredClone / JSON / redactFor (server + resumed matches) and with a behavior set
//   perunit    unitCost x squad vs block cost              "≈N each" texts
//   breakdown  priceParts + pricePower + priceSupport (x squad, rounded) vs block cost   garage Intel rows
//   upgrade    upgradeCost(d, L) shown vs supply delta of a real upgrade (incl. two upgrades in one action)

import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { computeStats, fmtUnitPrice, roundPrice } from '../src/shared/stats.ts';
import { actionCost, applyDeploy, designCost, newMatch, newPlayer, placementValue, redactFor, upgradeCost, validateDeploy } from '../src/shared/match.ts';
import { generateDesign, profile, type Role } from '../src/shared/ai.ts';
import { designInfo } from '../src/client/ui/deckstats.ts';
import { makeRng } from '../src/shared/rng.ts';
import type { Design, MatchState } from '../src/shared/types.ts';

const N = Number(process.env.N ?? 400);
const ROLES: Role[] = ['swarm', 'frontline', 'antiArmor', 'antiAir', 'artillery', 'flyer', 'support', 'skirmisher'];
const designs: Design[] = STARTER_DESIGNS.map((d) => structuredClone(d));
const rng = makeRng(12345);
for (let i = 0; designs.length < STARTER_DESIGNS.length + N && i < N * 4; i++) {
  const g = generateDesign(rng, ROLES[i % ROLES.length], `gen${i}`, i % 23 === 0);
  if (g) designs.push(g);
}

const issues = new Map<string, string[]>();
const flag = (kind: string, msg: string) => { if (!issues.has(kind)) issues.set(kind, []); issues.get(kind)!.push(msg); };

/** a match where side 0 owns `d` with plenty of supply, in deploy phase */
function matchWith(d: Design, supply = 100000): MatchState {
  const m = newMatch('audit', 'ai', 1, newPlayer('a', [d]), newPlayer('b', [d], true), 0);
  m.players[0].supply = supply;
  return m;
}

for (const d of designs) {
  const s = computeStats(d);
  const tag = `${d.name} (${d.chassis}/${d.mobility}, ×${s.squad})`;
  const cost = s.cost;
  const cmp = (kind: string, v: number) => { if (v !== cost) flag(kind, `${tag}: ${v} vs shown ${cost}`); };
  cmp('rules', designCost(d));
  cmp('deckinfo', designInfo(d)!.cost);
  cmp('ai', profile(d).cost);
  cmp('clone', computeStats(JSON.parse(JSON.stringify(d))).cost);
  cmp('clone', computeStats({ ...d, behavior: { target: 'armored', kite: true, hold: true, stance: 'hold', delay: 3 } } as Design).cost);

  // perunit: the "≈N each" text x squad must give the block price (within the display rounding of N)
  const shownEach = Number(fmtUnitPrice(s.unitCost));
  if (Math.abs(shownEach * s.squad - cost) > 0.05 * s.squad + 1e-9) flag('perunit', `${tag}: ≈${fmtUnitPrice(s.unitCost)} each × ${s.squad} = ${(shownEach * s.squad).toFixed(1)} vs block ${cost}`);

  // breakdown rows (supply per unit) must add up to the price
  const sum = (s.priceParts + s.pricePower + s.priceSupport) * s.squad;
  if (roundPrice(sum) !== cost) flag('breakdown', `${tag}: rows sum ${sum.toFixed(1)} -> ${roundPrice(sum)} vs ${cost}`);
  if (s.priceParts < 0 || s.pricePower < 0 || s.priceSupport < 0) flag('breakdown', `${tag}: negative row`);

  // a real purchase
  const m = matchWith(d);
  const place = { uid: 1, designId: d.id, x: 0, y: 0, level: 1, round: 1 };
  const a = { round: 1, place: [place], upgrade: [] as number[] };
  const err = validateDeploy(m, 0, a);
  if (err) { flag('deploy', `${tag}: ${err}`); continue; }
  const before = m.players[0].supply;
  if (actionCost(m, 0, a) !== cost) flag('rules', `${tag}: actionCost ${actionCost(m, 0, a)} vs ${cost}`);
  applyDeploy(m, 0, a);
  if (before - m.players[0].supply !== cost) flag('charged', `${tag}: charged ${before - m.players[0].supply} vs shown ${cost}`);
  // affordability edge: exactly `cost` supply must be enough, cost - 1 not
  if (validateDeploy(matchWith(d, cost), 0, a) !== null) flag('charged', `${tag}: can't buy with exactly ${cost} supply`);
  if (validateDeploy(matchWith(d, cost - 1), 0, a) === null) flag('charged', `${tag}: buyable with ${cost - 1} supply`);

  // upgrades: next round, upgrade L1->2 then L2->3 (the button shows upgradeCost(d, level + pending))
  m.status = 'deploy'; m.round = 2; m.players[0].ready = false;
  const shown1 = upgradeCost(d, 1), shown2 = upgradeCost(d, 2);
  const up2 = { round: 2, place: [], upgrade: [1, 1] };
  const e2 = validateDeploy(m, 0, up2);
  if (e2) flag('upgrade', `${tag}: double upgrade rejected: ${e2}`);
  else {
    const b2 = m.players[0].supply;
    if (actionCost(m, 0, up2) !== shown1 + shown2) flag('upgrade', `${tag}: actionCost ${actionCost(m, 0, up2)} vs shown ${shown1}+${shown2}`);
    applyDeploy(m, 0, up2);
    if (b2 - m.players[0].supply !== shown1 + shown2) flag('upgrade', `${tag}: charged ${b2 - m.players[0].supply} vs shown ${shown1}+${shown2}`);
    if (m.players[0].board[0].level !== 3) flag('upgrade', `${tag}: level ${m.players[0].board[0].level} after two upgrades`);
    if (placementValue(d, 3) !== cost + shown1 + shown2) flag('upgrade', `${tag}: placementValue ${placementValue(d, 3)} vs ${cost + shown1 + shown2}`);
  }
  // redacted / resumed copies price the same
  const rc = redactFor(m, 1).players[0].deck[0];
  cmp('clone', computeStats(rc).cost);
}

const bySquad = new Map<number, number>();
for (const d of designs) { const q = computeStats(d).squad; bySquad.set(q, (bySquad.get(q) ?? 0) + 1); }
console.log(`${designs.length} designs (${STARTER_DESIGNS.length} starters) · squads ${[...bySquad].sort((a, b) => b[0] - a[0]).map(([q, n]) => `×${q}: ${n}`).join(', ')}`);
if (!issues.size) console.log('OK: every displayed and charged price agrees');
for (const [k, v] of issues) {
  console.log(`\n[${k}] ${v.length} mismatch(es)`);
  for (const x of v.slice(0, 8)) console.log('  ' + x);
  if (v.length > 8) console.log(`  ... ${v.length - 8} more`);
}
process.exitCode = issues.size ? 1 : 0;
