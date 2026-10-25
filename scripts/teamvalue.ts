// Team value: what a design is worth AS PART OF AN ARMY (baseball WAR / basketball RAPM style), and the fit of the
// instant price correction in stats.ts (TEAM_FIT) to it.
//
//   node scripts/teamvalue.ts measure [seeds=4] [filter]   measure every reference design in every context (-> TV_DATA)
//   node scripts/teamvalue.ts fit [lambda]                 aggregate + ridge fit (-> TV_FIT_OUT; prints the constants)
//   node scripts/teamvalue.ts all [seeds=4]                measure + fit
//   node scripts/teamvalue.ts check [seeds=12]             scenario win rates (op-check style and team contexts)
//   node scripts/teamvalue.ts stack [seeds=3]              stacking check: 1 / 2 / 4 blocks of a few designs
//   node scripts/teamvalue.ts walls [seeds=12]             wall-tax tuning set (stats.ts TOUGH; TV_TOUGH='{"a":..,"g":..}')
//   node scripts/teamvalue.ts exploit [gens=6] [pop=24]    GA search for designs / mixes beating the reference mix
//   node scripts/teamvalue.ts show                         the reference library's prices (analytic vs fitted)
//
// The correction ships OFF (stats.ts TEAM_VALUE.on = false): the game charges the analytic price. Without TV_FIT /
// TV_ON this tool measures those shipped prices.
// Env: TV_BASE=1 prices with the analytic formula only (TEAM_FIT zeroed: the "before" prices)
//      TV_FIT=<json file> turns the correction on with a trial fit; TV_ON=1 turns it on with the constants in stats.ts
//      TV_DATA=<json> data file (default scripts/teamvalue-data.json), TV_FIT_OUT=<json> (default scripts/teamvalue-fit.json)
//      TV_PRIOR=<json fit> (fit): add the new log-ratios to this fit's (damped iteration under the new prices)
//      TV_DAMP=0.5 (fit with TV_PRIOR): step size of a damped update; TV_WORKERS=4; TV_EXTRA=<json designs> (measure)
//      TV_PLACE=mix|ai|formation (see place()); TV_RAW=<json> (measure): also dump the filler curves and raw margins
//      scripts/op-check.ts and scripts/balance.ts take TV_BASE=1 / TV_FIT=<json> too, for before / after checks.
//
// FILES (small, committed): teamvalue-data.json = the last measurement (per design, per context break-even prices),
//   teamvalue-fit.json = the fitted constants (copied into stats.ts TEAM_FIT; test/teamvalue.test.ts checks they
//   match), teamvalue-prior.json = the fit the data were measured under (pass it as TV_PRIOR to reproduce the fit),
//   teamvalue-exploits.json = exploit-search winners fed back into the library (TV_EXTRA).
// REPRODUCE (~45 min on 4 cores): TV_BASE=1 measure 6 -> fit -> TV_FIT=<fit> measure 6 -> TV_PRIOR=<fit> fit ->
//   exploit -> TV_FIT=<fit> TV_EXTRA=scripts/teamvalue-exploits.json measure 6 -> TV_PRIOR=<fit> fit.
//   Every measure is ~34k mirrored fights (~68k battles), 10-15 min; fit / show are instant.
//
// METHOD
//  * Replacement level: a stock median-efficiency filler (Bulwark, priced by the analytic formula). A design's value
//    in a context = the supply of filler it is worth when swapped in, at equal supply, vs the same opponent.
//  * Context instance c = (core army C, opponent O, budget tier B). The tested side is C bought for (1 - PHI) B plus
//    either k blocks of the design X (k = floor(PHI B / price), so X stays a marginal 13-25% of the army; big designs
//    go to the 1600 / 3200 tiers) or n filler blocks (a grid of n). Every fight is played on both sides of the field
//    (mirrored) with common random numbers (the same seeds and placements for X and the filler grid). Placement
//    alternates by seed between the AI's own (aiDeploy) and a player-style line (formation()): see place().
//  * Score: a continuous margin, not win/loss: surviving value share of my side minus the enemy's (each unit's
//    price x hp left / max hp; in [-1, 1]). f_c(q) = margin with q supply of filler (isotonic in q); the design's
//    break-even price in c is p_c = f_c^-1(margin with X) / k (linear interpolation; a little extrapolation).
//  * Contexts: 11 role templates x 3 variants (frontline + artillery, riot + tank, swarm, air-heavy, AA-heavy,
//    anti-armour, long-range turtle, mixed, skirmish / energy, wall + pokers, heavy armour), each paired with a different
//    template's army as opponent (11 opponents, 3 contexts each). Plus one NEUTRAL context per opponent (core = filler).
//  * Shapley: the value X adds beyond its value in the neutral (filler) army is synergy with that context's partners.
//    Two-player Shapley between X and its partners gives X half of it: p_sh = p_neutral + 0.5 (p_c - p_neutral).
//    The partners (also priced here) get the other half, so a tank + artillery combo isn't charged twice.
//  * Aggregate: price* = mean(p_sh) + 0.5 (P80(p_sh) - mean) over the 33 contexts. P80 is noise-corrected (the
//    between-context spread minus each p_c's measurement noise, normal quantile), since a raw P80 of noisy values
//    is biased up. Bootstrap CI over contexts.
//  * Fit: ridge regression of log(price* / analytic price) on stats.ts TEAM_FEATURES (standardised), lambda by
//    leave-one-design-out CV, weights = 1 / (CI width^2 + floor); intercept set so the starters' geometric-mean
//    price is unchanged (the filler's own efficiency sets only the overall scale, which must not inflate supply).
import { fork } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Battle } from '../src/shared/sim/battle.ts';
import { MODULE_CAL, TEAM_FEATURES, TEAM_FIT, TEAM_VALUE, TOUGH, clearPriceCache, computeStats, validateDesign, type TeamFeature } from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { CHASSIS, MOBILITY, MODULES, pairingError } from '../src/shared/parts.ts';
import { slotError } from '../src/shared/stats.ts';
import { DEPLOY_D, DEPLOY_W, blockDims, blockInZone, blocksOverlap } from '../src/shared/grid.ts';
import { MAX_SIM_UNITS, newMatch, newPlayer } from '../src/shared/match.ts';
import { aiDeploy } from '../src/shared/ai.ts';
import type { Design, Placement } from '../src/shared/types.ts';

// ------------------------------------------------------------------------------------------- price mode
type Fit = typeof TEAM_FIT;
export function applyFit(f: Partial<Fit> | null): void {
  TEAM_VALUE.on = !!f;
  if (!f) {
    TEAM_FIT.b0 = 0;
    for (const k of TEAM_FEATURES) TEAM_FIT.beta[k] = 0;
  } else {
    if (f.b0 !== undefined) TEAM_FIT.b0 = f.b0;
    if (f.beta) Object.assign(TEAM_FIT.beta, f.beta);
    if (f.center) Object.assign(TEAM_FIT.center, f.center);
    if (f.min !== undefined) TEAM_FIT.min = f.min;
    if (f.max !== undefined) TEAM_FIT.max = f.max;
  }
  clearPriceCache();
}
if (process.env.TV_TOUGH) { Object.assign(TOUGH, JSON.parse(process.env.TV_TOUGH)); clearPriceCache(); }
if (process.env.BAL_CAL) { Object.assign(MODULE_CAL, JSON.parse(process.env.BAL_CAL)); clearPriceCache(); }
if (process.env.TV_BASE === '1') applyFit(null);
else if (process.env.TV_FIT) applyFit(JSON.parse(readFileSync(process.env.TV_FIT, 'utf8')));
else if (process.env.TV_ON === '1') applyFit({});

const DATA = process.env.TV_DATA ?? new URL('./teamvalue-data.json', import.meta.url).pathname;
const FIT_OUT = process.env.TV_FIT_OUT ?? new URL('./teamvalue-fit.json', import.meta.url).pathname;
const WORKERS = Number(process.env.TV_WORKERS ?? 4);

// ------------------------------------------------------------------------------------------- library
const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id.slice(0, 24), chassis, mobility, mounts });
const S = (id: string) => STARTER_DESIGNS.find((d) => d.id === `starter-${id}`)!;
/** snapshot of the AI pool's curated designs (src/shared/aipool.ts, Oct 2026), copied so this tool doesn't move with it */
const POOL: Design[] = [
  D('pool-lasertick', 'scout', 'legs', ['laser']), D('pool-hailrunner', 'scout', 'wheels', ['hmg']), D('pool-chatterbug', 'scout', 'wheels', ['twinmg']),
  D('pool-arcwarden', 'warden', 'treads', ['tesla', 'plateL']), D('pool-shieldwarden', 'warden', 'treads', ['shield', 'hmg']),
  D('pool-pyrewall', 'juggernaut', 'treads', ['napalm', 'hardened']), D('pool-bastion', 'bastion', 'treads', ['shieldH', 'cannon75', 'plateH']),
  D('pool-smokecrab', 'crab', 'treads', ['napalm', 'plateH', 'smoke']), D('pool-gunsled', 'carriage', 'halftrack', ['cannon75']),
  D('pool-ghosthunter', 'hunter', 'hover', ['stealth', 'atgm']), D('pool-gausslance', 'longarm', 'spider', ['gauss']),
  D('pool-flakdisc', 'saucer', 'hover', ['flak', 'flak', 'hmg']), D('pool-skyspear', 'strider', 'legs', ['sam', 'aamissile', 'aamissile']),
  D('pool-interceptor', 'interceptor', 'jet', ['aamissile', 'aamissile']), D('pool-cruisepost', 'longarm', 'spider', ['cruise']),
  D('pool-rocketcart', 'carriage', 'halftrack', ['rockets']), D('pool-railstrider', 'striker', 'spider', ['lightrail', 'lightrail', 'targeting']),
  D('pool-wraith', 'striker', 'halftrack', ['lightrail', 'stealth', 'sniper']), D('pool-siegebattery', 'siegeplat', 'spider', ['barrage', 'mortar']),
  D('pool-laserdrone', 'drone', 'rotor', ['laser']), D('pool-clusterdart', 'deltawing', 'jet', ['clusterbombs', 'hmg', 'hmg']),
  D('pool-stormcopter', 'gunship', 'rotor', ['tesla', 'heatray']), D('pool-domecar', 'striker', 'halftrack', ['dome', 'uplink', 'hmg']),
  D('pool-jamstrider', 'strider', 'legs', ['jammer', 'laser', 'laser']), D('pool-infernohulk', 'goliath', 'megatracks', ['inferno', 'tesla', 'plateH', 'plateH']),
];
/** extremes: walls with token guns on every size class, glass cannons, the cannon-on-a-cheap-hull family, air */
const EXTREMES: Design[] = [
  D('x-mono-twinmg', 'monolith', 'titanlegs', ['twinmg', null]), D('x-mono-smoke', 'monolith', 'titanlegs', ['smoke', null]),
  D('x-mono-mg', 'monolith', 'titanlegs', ['mg', null]), D('x-mono-hmgsmoke', 'monolith', 'megatracks', ['hmg', 'smoke']),
  D('x-mono-plate', 'monolith', 'megatracks', ['plateG', 'smoke']), D('x-mono-siege', 'monolith', 'megatracks', ['siege240', 'cannon']),
  D('x-jugg-smoke', 'juggernaut', 'treads', ['plateH', 'smoke']), D('x-jugg-hmg', 'juggernaut', 'treads', ['hmg', 'smoke']),
  D('x-bastion-wall', 'bastion', 'treads', ['plateH', 'plateH', 'smoke']), D('x-warden-wall', 'warden', 'treads', ['plateM', 'smoke']),
  D('x-crab-wall', 'crab', 'treads', ['plateH', 'plateH', 'smoke']), D('x-raider-wall', 'raider', 'halftrack', ['plateL', 'smoke']),
  D('x-goliath-wall', 'goliath', 'megatracks', ['plateG', 'plateH', 'plateH', 'hmg']),
  D('x-titan-wall', 'titan', 'megatracks', ['plateT', 'plateG', 'plateM', 'plateM', 'twinmg']),
  D('x-mortarcart', 'carriage', 'halftrack', ['mortar']), D('x-railhunter', 'hunter', 'hover', ['railgun', null]),
  D('x-howitzers', 'siegeplat', 'spider', ['howitzer', 'howitzer']), D('x-railarm', 'longarm', 'wheels', ['railgun']),
  D('x-plasmahover', 'striker', 'hover', ['plasma', 'plasma', 'laser']), D('x-nuke', 'lance', 'titanlegs', ['tactnuke', 'mortar']),
  D('x-aegis-cannon-hmg', 'aegis', 'treads', ['cannon', 'hmg']), D('x-aegis-cannon', 'aegis', 'treads', ['cannon', null]),
  D('x-aegis-75-hmg', 'aegis', 'treads', ['cannon75', 'hmg']), D('x-warden-cannon-hmg', 'warden', 'halftrack', ['cannon', 'hmg']),
  D('x-aegis-ac-hmg', 'aegis', 'treads', ['autocannon', 'hmg']),
  D('x-swarmjet', 'interceptor', 'jet', ['twinmg', 'mg']), D('x-hornet-sam', 'gunship', 'rotor', ['sam', 'swarm']),
  D('x-pokies', 'mantis', 'legs', ['atgm', 'atgm']), D('x-deltabomb', 'deltawing', 'jet', ['bombs', 'mg', 'mg']),
  // a player's army: weaponless 13k-hp Monolith wall (Bastion Shield Generator + point defense) fronting laser/ATGM pokers
  D('x-wall-mono', 'monolith', 'spider', ['bulwarkshield', 'pointdef']), D('x-kpokies', 'mantis', 'legs', ['laser', 'atgm']),
  D('x-wall-mono-pd', 'monolith', 'megatracks', [null, 'pointdef']), D('x-wall-bastion', 'bastion', 'spider', ['shieldH', 'shield', 'pointdef']),
];
export const LIBRARY: Design[] = [...STARTER_DESIGNS, ...POOL, ...EXTREMES];
const BY_ID = new Map(LIBRARY.map((d) => [d.id, d]));
const L = (id: string) => BY_ID.get(id) ?? S(id) ?? (() => { throw new Error(`no design ${id}`); })();

/** the replacement-level filler (Bulwark: 70 supply, autocannon tank that also hits air) */
export const FILLER = S('bulwark');

type Recipe = [string, number][];
/** 11 role templates x 3 variants (ids: starter ids without the prefix, or library ids) */
const TEMPLATES: { name: string; variants: Recipe[] }[] = [
  { name: 'frontline+artillery', variants: [[['bulwark', 2], ['thunderhead', 1], ['firestorm', 1], ['skyguard', 0.5]], [['ironclad', 2], ['thunderhead', 1], ['pool-siegebattery', 1], ['pool-flakdisc', 0.5]], [['pool-shieldwarden', 2], ['firestorm', 1], ['pool-rocketcart', 1], ['pool-skyspear', 0.5]]] },
  { name: 'artillery+riot', variants: [[['thunderhead', 1], ['firestorm', 1], ['torchbug', 1], ['spire', 1], ['stormcaller', 1]], [['pool-pyrewall', 1], ['pool-arcwarden', 1], ['torchbug', 1], ['stormcaller', 1]], [['pool-smokecrab', 1], ['stormcaller', 1], ['ripper', 1], ['ironclad', 1]]] },
  { name: 'swarm', variants: [[['buzzsaw', 1], ['torchbug', 1], ['ripper', 1]], [['pool-lasertick', 1], ['pool-hailrunner', 1], ['pool-chatterbug', 1]], [['hornet', 1], ['buzzsaw', 1], ['pool-gunsled', 1]]] },
  { name: 'air-heavy', variants: [[['strafer', 1], ['hornet', 1], ['pool-laserdrone', 1], ['skyguard', 0.5]], [['pool-clusterdart', 1], ['pool-stormcopter', 1], ['pool-interceptor', 1], ['bulwark', 0.5]], [['strafer', 1], ['pool-stormcopter', 1], ['pool-laserdrone', 1], ['pool-flakdisc', 0.5]]] },
  { name: 'AA-heavy', variants: [[['skyguard', 1], ['pool-flakdisc', 1], ['pool-chatterbug', 1], ['bulwark', 1]], [['pool-skyspear', 1], ['pool-flakdisc', 1], ['pool-hailrunner', 1]], [['pool-interceptor', 1], ['skyguard', 1], ['spire', 1]]] },
  { name: 'anti-armour', variants: [[['hunter', 1], ['tankbuster', 1], ['pool-gausslance', 1]], [['pool-ghosthunter', 1], ['shade', 1], ['pool-gunsled', 1]], [['pool-railstrider', 1], ['hunter', 1], ['tankbuster', 1]]] },
  { name: 'long-range turtle', variants: [[['spire', 2], ['thunderhead', 1], ['aegiswall', 1]], [['pool-cruisepost', 1], ['spire', 1], ['pool-bastion', 1]], [['pool-siegebattery', 1], ['firestorm', 1], ['pool-shieldwarden', 1], ['pool-flakdisc', 0.5]]] },
  { name: 'mixed', variants: [STARTER_DESIGNS.filter((d) => computeStats(d).size <= 3).map((d) => [d.id.replace('starter-', ''), 1] as [string, number]), POOL.filter((d) => computeStats(d).size <= 3).map((d) => [d.id, 1] as [string, number]), [['lancer', 1], ['commander', 1], ['medic', 1], ['bulwark', 1], ['hunter', 1], ['skyguard', 1]]] },
  { name: 'skirmish/energy', variants: [[['lancer', 1], ['stormcaller', 1], ['commander', 1]], [['pool-jamstrider', 1], ['pool-railstrider', 1], ['pool-domecar', 1]], [['lancer', 1], ['shade', 1], ['medic', 1]]] },
  { name: 'wall+pokers', variants: [[['x-wall-mono', 1], ['x-kpokies', 2]], [['x-mono-twinmg', 1], ['thunderhead', 1], ['firestorm', 1]], [['x-jugg-smoke', 1], ['hunter', 1], ['lancer', 1]]] },
  { name: 'heavy armour', variants: [[['ironclad', 1], ['behemoth', 1], ['aegiswall', 1]], [['pool-infernohulk', 1], ['pool-bastion', 1], ['ironclad', 1]], [['juggernaut', 1], ['ironclad', 1], ['skyguard', 1]]] },
];
const resolve = (r: Recipe): [Design, number][] => r.map(([id, w]) => [L(id), w]);

export interface Ctx { id: string; template: string; core: Recipe; opp: Recipe; oppName: string; neutral: boolean; oppIdx: number }
export const CONTEXTS: Ctx[] = [];
TEMPLATES.forEach((t, ti) => t.variants.forEach((core, v) => {
  const oi = (ti + 1 + 3 * v) % TEMPLATES.length;
  CONTEXTS.push({ id: `${t.name}#${v + 1}`, template: t.name, core, opp: TEMPLATES[oi].variants[0], oppName: TEMPLATES[oi].name, neutral: false, oppIdx: oi });
}));
TEMPLATES.forEach((t, oi) => CONTEXTS.push({ id: `neutral-vs-${t.name}`, template: 'neutral', core: [[FILLER.id, 1]], opp: t.variants[0], oppName: t.name, neutral: true, oppIdx: oi }));

export const TIERS = [800, 1600, 3200];
export const PHI = 0.25;
const FILLER_GRID = [0, 1, 2, 3, 4, 6, 8];

// ------------------------------------------------------------------------------------------- armies & battles
const cost = (d: Design) => computeStats(d).cost;
/** buy blocks of a recipe for `budget` supply: always the design furthest below its weight share that still fits */
export function buildArmy(recipe: [Design, number][], budget: number, unitCap = MAX_SIM_UNITS): Design[] {
  const out: Design[] = [];
  const spent = recipe.map(() => 0);
  let left = budget, units = 0;
  for (let g = 0; g < 400; g++) {
    let best = -1, bestR = Infinity;
    recipe.forEach(([d, w], i) => {
      const s = computeStats(d);
      if (s.cost > left || units + s.squad > unitCap) return;
      const r = (spent[i] + s.cost) / w;
      if (r < bestR) { bestR = r; best = i; }
    });
    if (best < 0) break;
    const [d] = recipe[best]; const s = computeStats(d);
    out.push(d); spent[best] += s.cost; left -= s.cost; units += s.squad;
  }
  return out;
}

/** Deterministic formation: tanks then other ground units fill the front rows from the centre outward, long-range
 *  ground units (range >= 13) the back rows, aircraft the middle; `seed` shifts the centre a little. Squads get
 *  1-cell spacing. Both sides use it (local coordinates), so fights are mirror images. */
export function formation(list: Design[], seed: number): Placement[] {
  const occ = new Uint8Array(DEPLOY_W * DEPLOY_D);
  const free = (x: number, y: number, w: number, h: number) => {
    if (x < 0 || y < 0 || x + w > DEPLOY_W || y + h > DEPLOY_D) return false;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (occ[j * DEPLOY_W + i]) return false;
    return true;
  };
  const items = list.map((d, i) => {
    const s = computeStats(d);
    const sp = s.squad > 1 ? 1 : 0;
    const { w, h } = blockDims(s, sp);
    const role = s.flying ? 1 : s.range >= 13 ? 2 : 0;
    return { d, i, s, sp, w, h, role, tank: s.ehp / Math.max(1, s.offense) };
  });
  items.sort((a, b) => a.role - b.role || b.tank - a.tank || a.i - b.i);
  const shift = ((seed * 7919) % 13) - 6;
  const out: Placement[] = [];
  let uid = 1;
  for (const it of items) {
    const cx = Math.round(DEPLOY_W / 2 + shift - it.w / 2);
    const rows: number[] = [];
    if (it.role === 0) for (let y = 0; y + it.h <= DEPLOY_D; y++) rows.push(y);
    else if (it.role === 2) for (let y = DEPLOY_D - it.h; y >= 0; y--) rows.push(y);
    else { const mid = Math.floor((DEPLOY_D - it.h) / 2); for (let k = 0; k <= DEPLOY_D; k++) for (const y of [mid - k, mid + k]) if (y >= 0 && y + it.h <= DEPLOY_D && !rows.includes(y)) rows.push(y); }
    let done = false;
    for (const y of rows) {
      for (let k = 0; k <= DEPLOY_W && !done; k++) for (const x of k ? [cx + k, cx - k] : [cx]) {
        if (!free(x, y, it.w, it.h)) continue;
        for (let j = y; j < y + it.h; j++) for (let i = x; i < x + it.w; i++) occ[j * DEPLOY_W + i] = 1;
        out.push({ uid: uid++, designId: it.d.id, x, y, level: 1, round: 1, spacing: it.sp });
        done = true; break;
      }
      if (done) break;
    }
  }
  return out;
}

/** Placement: TV_PLACE=mix (default) alternates by seed between the normal AI's own placement (src/shared/ai.ts
 *  aiDeploy, one design at a time as in scripts/balance.ts; formation-style search for anything it leaves out) on even
 *  seeds and formation() (a player's tanks-in-front, guns-behind line) on odd ones: prices must hold up under both,
 *  and they disagree a lot about walls (a player puts the wall in front; the AI often doesn't). TV_PLACE=ai or
 *  TV_PLACE=formation uses one only. */
const PLACE = process.env.TV_PLACE ?? 'mix';
function aiPlace(list: Design[], side: 0 | 1, seed: number): Placement[] {
  const groups = new Map<string, { d: Design; n: number }>();
  for (const d of list) { const g = groups.get(d.id); if (g) g.n++; else groups.set(d.id, { d, n: 1 }); }
  const specs = [...groups.values()];
  const deckAll = specs.map((g) => g.d);
  const m = newMatch('tv', 'ai', 7 + seed * 31 + side, newPlayer('a', deckAll.slice(0, 1), true), newPlayer('b', deckAll.slice(0, 1), true));
  const me = m.players[side];
  const out: Placement[] = [];
  const missing: Design[] = [];
  specs.forEach((g, i) => {
    // earlier designs stay in the deck (so the AI knows their footprints) but can't be bought (empty name)
    const deck = deckAll.map((d, j) => (j === i ? d : { ...d, name: '' }));
    me.deck = deck; m.players[side === 0 ? 1 : 0].deck = deck;
    me.supply = g.n * cost(g.d); me.ready = false;
    let placed = 0;
    try {
      const a = aiDeploy(m, side, 'normal');
      for (const p of a.place) if (p.designId === g.d.id && placed < g.n) { const q = { ...p, uid: out.length + 1 }; out.push(q); me.board.push(q); me.nextUid = q.uid + 1; placed++; }
    } catch { /* fall back below */ }
    for (let k = placed; k < g.n; k++) missing.push(g.d);
  });
  if (process.env.TV_DEBUG) process.stderr.write(`place ${list.length} blocks, AI left ${missing.length}\n`);
  if (missing.length) {
    // the rest: first free spots, front to back, from the centre out (formation's search, around what's placed)
    const occ = out.map((p) => { const s = computeStats(deckAll.find((d) => d.id === p.designId)!); return { p, s }; });
    for (const d of missing) {
      const s = computeStats(d); const sp = s.squad > 1 ? 1 : 0;
      let done = false;
      for (let y = 0; y < DEPLOY_D && !done; y++) for (let k = 0; k <= DEPLOY_W && !done; k++) for (const x of k ? [48 + k, 48 - k] : [48]) {
        const cand = { x, y, spacing: sp };
        if (!blockInZone(x, y, s, sp) || occ.some((o) => blocksOverlap(cand, s, o.p, o.s))) continue;
        const q: Placement = { uid: out.length + 1, designId: d.id, x, y, level: 1, round: 1, spacing: sp };
        out.push(q); occ.push({ p: q, s }); done = true; break;
      }
    }
  }
  return out;
}
const placeCache = new Map<string, Placement[]>();
function place(list: Design[], side: 0 | 1, seed: number): Placement[] {
  if (PLACE === 'formation' || (PLACE === 'mix' && seed % 2 === 1)) return formation(list, seed + side);
  const key = `${side}|${seed}|${list.map((d) => d.id).join(',')}`;
  let p = placeCache.get(key);
  if (!p) { p = aiPlace(list, side, seed); if (placeCache.size > 3000) placeCache.clear(); placeCache.set(key, p); }
  return p;
}

/** one fight; returns the margin from side 0's view: surviving value share of side 0 minus side 1's */
function fight(a: Design[], b: Design[], seed: number): number {
  const designs = [...new Map([...a, ...b].map((d) => [d.id, d])).values()];
  const pa = place(a, 0, seed), pb = place(b, 1, seed);
  const bt = new Battle({ seed: 1000 + seed, sides: [{ designs, units: pa }, { designs, units: pb }] });
  const v0 = [0, 0], v1 = [0, 0];
  for (const u of bt.units) v0[u.side] += u.stats.unitCost;
  while (!bt.done) bt.step();
  for (const u of bt.units) if (u.alive) v1[u.side] += u.stats.unitCost * Math.max(0, u.hp) / u.maxHp;
  return v1[0] / Math.max(1, v0[0]) - v1[1] / Math.max(1, v0[1]);
}
/** mirrored pair: A on side 0, then A on side 1; mean margin from A's view */
export function mirrored(a: Design[], b: Design[], seed: number): number {
  return (fight(a, b, seed) - fight(b, a, seed)) / 2;
}

// ------------------------------------------------------------------------------------------- worker pool
interface Job { key: string; a: string[]; b: string[]; seed: number }
interface Res { key: string; m: number }
let jobDesigns = new Map<string, Design>();
async function runJobs(jobs: Job[], designs: Design[], label = ''): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!jobs.length) return out;
  const t0 = Date.now();
  let next = 0, doneN = 0;
  await Promise.all(Array.from({ length: Math.min(WORKERS, jobs.length) }, () => new Promise<void>((res, rej) => {
    const child = fork(new URL(import.meta.url).pathname, ['worker'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    let inflight = 0, finished = false;
    const send = () => {
      if (next < jobs.length) { child.send({ job: jobs[next++] }); inflight++; }
      else if (!inflight && !finished) { finished = true; child.disconnect(); }
    };
    child.on('message', (m: Res | { ready: true }) => {
      if ('ready' in m) { send(); send(); return; }
      inflight--;
      out.set(m.key, m.m); doneN++;
      if (doneN % 200 === 0) process.stderr.write(`\r${label} ${doneN}/${jobs.length} ${((Date.now() - t0) / 1000).toFixed(0)}s   `);
      send();
    });
    child.on('exit', (c) => (c === 0 || finished ? res() : rej(new Error(`worker exited ${c}`))));
    child.send({ designs });
  })));
  process.stderr.write(`\r${label} ${jobs.length} fights x2 in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  return out;
}
function workerMain() {
  process.on('message', (m: { designs?: Design[]; job?: Job }) => {
    if (m.designs) { jobDesigns = new Map(m.designs.map((d) => [d.id, d])); process.send!({ ready: true }); return; }
    const j = m.job!;
    const g = (ids: string[]) => ids.map((id) => jobDesigns.get(id)!);
    process.send!({ key: j.key, m: mirrored(g(j.a), g(j.b), j.seed) });
  });
}

// ------------------------------------------------------------------------------------------- measure
export const tierOf = (d: Design) => TIERS.find((B) => cost(d) <= 0.3 * B) ?? TIERS[TIERS.length - 1];
const kOf = (d: Design, B: number) => Math.max(1, Math.floor((PHI * B) / cost(d)));
const ids = (l: Design[]) => l.map((d) => d.id);

interface Point { q: number; m: number[] }
export interface CtxResult { ctx: string; B: number; k: number; mX?: number[]; p: number; noise: number }
export interface DesignResult { id: string; design: Design; price: number; squad: number; ctx: CtxResult[] }
export interface Curve { ctx: string; B: number; pts: Point[] }

/** isotonic (non-decreasing) fit of y over sorted x (pool adjacent violators) */
function isotonic(y: number[]): number[] {
  const blocks: { v: number; n: number }[] = [];
  for (const v of y) {
    blocks.push({ v, n: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].v > blocks[blocks.length - 1].v) {
      const b = blocks.pop()!, a = blocks.pop()!;
      blocks.push({ v: (a.v * a.n + b.v * b.n) / (a.n + b.n), n: a.n + b.n });
    }
  }
  return blocks.flatMap((b) => Array(b.n).fill(b.v));
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)); };

/** filler supply q whose margin equals m, on the isotonic curve (linear between points, gentle extrapolation) */
export function invert(c: Curve, m: number): { q: number; slope: number } {
  const xs = c.pts.map((p) => p.q), ys = isotonic(c.pts.map((p) => mean(p.m)));
  const n = xs.length, span = xs[n - 1];
  const slopeAt = (i: number) => Math.max((ys[n - 1] - ys[0]) / span / 4, (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]), 1e-6);
  if (m <= ys[0]) { const s = slopeAt(0); return { q: Math.max(-0.5 * span, xs[0] - (ys[0] - m) / s), slope: s }; }
  for (let i = 0; i + 1 < n; i++) if (m <= ys[i + 1]) {
    const s = slopeAt(i);
    return { q: ys[i + 1] > ys[i] ? xs[i] + ((m - ys[i]) / (ys[i + 1] - ys[i])) * (xs[i + 1] - xs[i]) : xs[i], slope: s };
  }
  const s = Math.max(slopeAt(n - 2), (ys[n - 1] - ys[0]) / span);
  return { q: Math.min(2 * span, xs[n - 1] + (m - ys[n - 1]) / s), slope: s };
}

async function measure(seeds: number, filter: string) {
  const extra: Design[] = process.env.TV_EXTRA ? (JSON.parse(readFileSync(process.env.TV_EXTRA, 'utf8')) as Design[]).map((d) => ({ ...d, name: d.id.slice(0, 24) })) : [];
  const lib = [...LIBRARY, ...extra].filter((d) => !filter || d.id.includes(filter)).filter((d) => !validateDesign(d).length);
  const tiers = [...new Set(lib.map(tierOf))].sort((a, b) => a - b);
  const all = new Map<string, Design>([...LIBRARY, ...extra, FILLER].map((d) => [d.id, d]));
  const jobs: Job[] = [];
  const cores = new Map<string, Design[]>(), opps = new Map<string, Design[]>();
  for (const B of tiers) for (const c of CONTEXTS) {
    const core = buildArmy(resolve(c.core), (1 - PHI) * B);
    const opp = buildArmy(resolve(c.opp), B);
    cores.set(`${c.id}@${B}`, core); opps.set(`${c.id}@${B}`, opp);
    const g = B / TIERS[0];
    for (const n0 of FILLER_GRID) {
      const n = Math.round(n0 * g);
      for (let s = 0; s < seeds; s++) jobs.push({ key: `F|${c.id}|${B}|${n}|${s}`, a: [...ids(core), ...Array(n).fill(FILLER.id)], b: ids(opp), seed: s });
    }
  }
  for (const d of lib) {
    const B = tierOf(d), k = kOf(d, B);
    for (const c of CONTEXTS) {
      const core = cores.get(`${c.id}@${B}`)!, opp = opps.get(`${c.id}@${B}`)!;
      for (let s = 0; s < seeds; s++) jobs.push({ key: `X|${d.id}|${c.id}|${s}`, a: [...ids(core), ...Array(k).fill(d.id)], b: ids(opp), seed: s });
    }
  }
  console.log(`${lib.length} designs, ${CONTEXTS.length} contexts (${CONTEXTS.filter((c) => c.neutral).length} neutral), tiers ${tiers.join('/')}, ${seeds} seeds: ${jobs.length} mirrored fights`);
  const t0 = Date.now();
  const r = await runJobs(jobs, [...all.values()], 'measure');
  const curves: Curve[] = [];
  for (const B of tiers) for (const c of CONTEXTS) {
    const g = B / TIERS[0];
    curves.push({ ctx: c.id, B, pts: FILLER_GRID.map((n0) => { const n = Math.round(n0 * g); return { q: n * cost(FILLER), m: Array.from({ length: seeds }, (_, s) => r.get(`F|${c.id}|${B}|${n}|${s}`)!) }; }) });
  }
  const results: DesignResult[] = lib.map((d) => {
    const B = tierOf(d), k = kOf(d, B), st = computeStats(d);
    return {
      id: d.id, design: d, price: st.cost, squad: st.squad,
      ctx: CONTEXTS.map((c) => {
        const mX = Array.from({ length: seeds }, (_, s) => r.get(`X|${d.id}|${c.id}|${s}`)!);
        const cv = curves.find((x) => x.ctx === c.id && x.B === B)!;
        const { q, slope } = invert(cv, mean(mX));
        // measurement noise of p_c: margin noise (paired with the filler grid on the same seeds) through the slope
        const noise = (sd(mX) / Math.sqrt(seeds)) / slope / k;
        return { ctx: c.id, B, k, mX: mX.map((x) => Math.round(x * 1e4) / 1e4), p: q / k, noise: Math.min(noise, 3 * st.cost) };
      }),
    };
  });
  // compact: per-context break-even prices only (the filler curves and raw margins go to TV_RAW if set)
  if (process.env.TV_RAW) writeFileSync(process.env.TV_RAW, JSON.stringify({ curves, results }));
  const out = { when: new Date().toISOString(), seeds, phi: PHI, filler: FILLER.id, fillerCost: cost(FILLER), mode: process.env.TV_BASE === '1' ? 'base' : process.env.TV_FIT ?? 'compiled', minutes: (Date.now() - t0) / 60000, contexts: CONTEXTS.map((c) => c.id), results: results.map(compact) };
  writeFileSync(DATA, JSON.stringify(out));
  console.log(`wrote ${DATA} (${(Date.now() - t0) / 60000 | 0} min)`);
}

/** data file format: per design the per-context break-even prices / noise as arrays in `contexts` order */
interface CompactResult { id: string; design: Design; price: number; squad: number; B: number; k: number; p: number[]; noise: number[] }
const r1 = (x: number) => Math.round(x * 10) / 10;
function compact(r: DesignResult): CompactResult {
  return { id: r.id, design: r.design, price: r.price, squad: r.squad, B: r.ctx[0].B, k: r.ctx[0].k, p: r.ctx.map((c) => r1(c.p)), noise: r.ctx.map((c) => r1(c.noise)) };
}
function expand(data: { contexts?: string[]; results: (CompactResult | DesignResult)[] }): DesignResult[] {
  return data.results.map((r) => ('ctx' in r ? r : { id: r.id, design: r.design, price: r.price, squad: r.squad, ctx: data.contexts!.map((c, i) => ({ ctx: c, B: r.B, k: r.k, p: r.p[i], noise: r.noise[i] })) }));
}

// ------------------------------------------------------------------------------------------- aggregate
const Z80 = 0.8416;
export interface Agg { id: string; design: Design; price: number; squad: number; mean: number; p80: number; p80raw: number; star: number; lo: number; hi: number; neutral: number; n: number }
function quantile(xs: number[], q: number) { const s = [...xs].sort((a, b) => a - b); const i = q * (s.length - 1); const lo = Math.floor(i); return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo); }
function starOf(ps: number[], noises: number[]): { mean: number; p80: number; p80raw: number; star: number } {
  const m = mean(ps);
  const between = Math.max(0, sd(ps) ** 2 - mean(noises.map((x) => x * x)));
  const p80 = m + Z80 * Math.sqrt(between);
  return { mean: m, p80, p80raw: quantile(ps, 0.8), star: m + 0.5 * (p80 - m) };
}
export function aggregate(data: { contexts?: string[]; results: (CompactResult | DesignResult)[] }): Agg[] {
  return expand(data).map((r) => {
    const byCtx = new Map(r.ctx.map((c) => [c.ctx, c]));
    const sh: number[] = [], nz: number[] = [];
    let neutralSum = 0;
    for (const c of CONTEXTS.filter((x) => !x.neutral)) {
      const v = byCtx.get(c.id)!;
      const nu = byCtx.get(`neutral-vs-${c.oppName}`)!;
      neutralSum += nu.p;
      sh.push(nu.p + 0.5 * (v.p - nu.p));
      nz.push(Math.sqrt((0.5 * v.noise) ** 2 + (0.5 * nu.noise) ** 2));
    }
    const s = starOf(sh, nz);
    // bootstrap CI of price* over contexts (deterministic resampling)
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const boots: number[] = [];
    for (let b = 0; b < 400; b++) {
      const idx = sh.map(() => Math.floor(rnd() * sh.length));
      boots.push(starOf(idx.map((i) => sh[i]), idx.map((i) => nz[i])).star);
    }
    return { id: r.id, design: r.design, price: r.price, squad: r.squad, mean: s.mean, p80: s.p80, p80raw: s.p80raw, star: s.star, lo: quantile(boots, 0.1), hi: quantile(boots, 0.9), neutral: neutralSum / sh.length, n: sh.length };
  });
}

// ------------------------------------------------------------------------------------------- fit
/** per-unit analytic (pre-correction) price and the features, with TEAM_FIT zeroed */
function baseInfo(d: Design): { unit: number; f: Record<TeamFeature, number>; squad: number } {
  const saved = JSON.parse(JSON.stringify(TEAM_FIT)) as Fit;
  applyFit(null);
  const s = computeStats(d);
  applyFit(saved);
  return { unit: s.unitCost / s.teamMult, f: s.teamFeatures as Record<TeamFeature, number>, squad: s.squad };
}
function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let j = i + 1; j < n; j++) if (Math.abs(M[j][i]) > Math.abs(M[p][i])) p = j;
    [M[i], M[p]] = [M[p], M[i]];
    for (let j = i + 1; j < n; j++) { const f = M[j][i] / M[i][i]; for (let k = i; k <= n; k++) M[j][k] -= f * M[i][k]; }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k]; x[i] = s / M[i][i]; }
  return x;
}
/** weighted ridge on standardised features (no penalty on the intercept); returns [intercept, ...betas] */
function ridge(X: number[][], y: number[], w: number[], lambda: number): number[] {
  const p = X[0].length + 1;
  const A = Array.from({ length: p }, () => Array(p).fill(0)), b = Array(p).fill(0);
  X.forEach((row, i) => {
    const r = [1, ...row];
    for (let a = 0; a < p; a++) { b[a] += w[i] * r[a] * y[i]; for (let c = 0; c < p; c++) A[a][c] += w[i] * r[a] * r[c]; }
  });
  const W = w.reduce((a, c) => a + c, 0);
  for (let a = 1; a < p; a++) A[a][a] += lambda * W;
  return solve(A, b);
}

function fit(lambdaArg?: number) {
  const data = JSON.parse(readFileSync(DATA, 'utf8'));
  const agg = aggregate(data).filter((a) => a.star > 0);
  const rows = agg.map((a) => ({ a, ...baseInfo(a.design) }));
  // target: log(price* / analytic per-unit price); price* is per block, so / squad
  const y = rows.map((r) => Math.log(Math.max(0.2 * r.unit, r.a.star / r.a.squad) / r.unit));
  const w = rows.map((r) => { const rel = (r.a.hi - r.a.lo) / Math.max(1, r.a.star); return 1 / (rel * rel + 0.05); });
  const keys = TEAM_FEATURES;
  const mu = keys.map((k) => mean(rows.map((r) => r.f[k])));
  const sig = keys.map((k, i) => Math.max(1e-6, Math.sqrt(mean(rows.map((r) => (r.f[k] - mu[i]) ** 2)))));
  const X = rows.map((r) => keys.map((k, i) => (r.f[k] - mu[i]) / sig[i]));
  // damped iteration: data were measured under a prior fit -> the target is prior log-mult + residual
  const prior: Fit | null = process.env.TV_PRIOR ? JSON.parse(readFileSync(process.env.TV_PRIOR, 'utf8')) : null;
  const damp = Number(process.env.TV_DAMP ?? 0.5);
  const priorLog = (f: Record<TeamFeature, number>) => (prior ? Math.log(Math.min(prior.max, Math.max(prior.min, Math.exp(prior.b0 + keys.reduce((t, k) => t + prior.beta[k] * (f[k] - prior.center[k]), 0))))) : 0);
  // with a prior the measured prices were the prior's: log(star/unit_prior) is the residual; damped step on it
  const yT = rows.map((r, i) => (prior ? priorLog(r.f) + damp * (y[i] - priorLog(r.f)) : y[i]));
  const cvErr = (lambda: number) => {
    let e = 0, W = 0;
    for (let i = 0; i < rows.length; i++) {
      const idx = rows.map((_, j) => j).filter((j) => j !== i);
      const beta = ridge(idx.map((j) => X[j]), idx.map((j) => yT[j]), idx.map((j) => w[j]), lambda);
      const pred = beta[0] + X[i].reduce((t, v, k) => t + v * beta[k + 1], 0);
      const pc = Math.log(Math.min(TEAM_FIT.max, Math.max(TEAM_FIT.min, Math.exp(pred))));
      e += w[i] * (pc - yT[i]) ** 2; W += w[i];
    }
    return e / W;
  };
  const grid = [0.01, 0.03, 0.1, 0.3, 1, 3];
  const errs = grid.map((l) => ({ l, e: cvErr(l) }));
  const nullErr = (() => { let e = 0, W = 0; rows.forEach((_, i) => { const pc = 0; e += w[i] * (pc - yT[i]) ** 2; W += w[i]; }); return e / W; })();
  const lambda = lambdaArg ?? errs.reduce((a, b) => (b.e < a.e ? b : a)).l;
  console.log(`CV (leave-one-design-out) weighted MSE of log price: analytic only ${nullErr.toFixed(4)}; ${errs.map((x) => `lambda ${x.l}: ${x.e.toFixed(4)}`).join(', ')} -> lambda ${lambda}`);
  const beta = ridge(X, yT, w, lambda);
  const out: Fit = { b0: 0, beta: {} as Record<TeamFeature, number>, center: {} as Record<TeamFeature, number>, min: TEAM_FIT.min, max: TEAM_FIT.max };
  keys.forEach((k, i) => { out.beta[k] = beta[i + 1] / sig[i]; out.center[k] = mu[i]; });
  out.b0 = beta[0];
  // keep the starters' price level: geometric mean of the new / analytic starter prices = 1
  const pred = (f: Record<TeamFeature, number>, b0: number) => Math.min(out.max, Math.max(out.min, Math.exp(b0 + keys.reduce((t, k) => t + out.beta[k] * (f[k] - out.center[k]), 0))));
  const starters = rows.filter((r) => r.a.id.startsWith('starter-'));
  let lo = -2, hi = 2;
  for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2; const g = mean(starters.map((r) => Math.log(pred(r.f, mid)))); if (g > 0) hi = mid; else lo = mid; }
  console.log(`intercept ${out.b0.toFixed(3)} -> ${((lo + hi) / 2).toFixed(3)} (starters' geometric-mean price kept)`);
  out.b0 = (lo + hi) / 2;
  const round = (x: number) => Math.round(x * 1e4) / 1e4;
  out.b0 = round(out.b0);
  for (const k of keys) { out.beta[k] = round(out.beta[k]); out.center[k] = round(out.center[k]); }
  writeFileSync(FIT_OUT, JSON.stringify(out, null, 1));
  console.log(`\nfeature weights (beta per feature unit; std = beta x feature sd, i.e. log-price effect of 1 sd):`);
  keys.forEach((k, i) => console.log(`  ${k.padEnd(11)} beta ${out.beta[k].toFixed(4).padStart(8)}   std ${(out.beta[k] * sig[i]).toFixed(3).padStart(7)}   center ${out.center[k]}`));
  console.log(`\nwrote ${FIT_OUT}. stats.ts TEAM_FIT:\n  b0: ${out.b0},\n  beta: ${JSON.stringify(out.beta).replace(/"/g, '').replace(/,/g, ', ').replace(/:/g, ': ')},\n  center: ${JSON.stringify(out.center).replace(/"/g, '').replace(/,/g, ', ').replace(/:/g, ': ')},`);
  console.log('\nper design: analytic block price, price* (mean / P80 / CI), fitted price');
  const rowsOut = rows.map((r, i) => ({ r, y: y[i], fitted: r.unit * r.a.squad * pred(r.f, out.b0) })).sort((a, b) => b.y - a.y);
  for (const { r, y: yy, fitted } of rowsOut) console.log(`${r.a.id.padEnd(22)} ${String(r.a.price).padStart(5)}  star ${r.a.star.toFixed(0).padStart(5)} (mean ${r.a.mean.toFixed(0)}, P80 ${r.a.p80.toFixed(0)}, raw P80 ${r.a.p80raw.toFixed(0)}, neutral ${r.a.neutral.toFixed(0)}, CI ${r.a.lo.toFixed(0)}-${r.a.hi.toFixed(0)})  ratio ${Math.exp(yy).toFixed(2)}  fitted x${pred(r.f, out.b0).toFixed(2)} = ${fitted.toFixed(0)}`);
}

// ------------------------------------------------------------------------------------------- check / stack / exploit / show
const USER_MIX = ['thunderhead', 'firestorm', 'torchbug', 'spire', 'stormcaller'].map(S);
const DEFAULT_MIX = STARTER_DESIGNS.filter((d) => computeStats(d).size <= 3);
/** op-check's question with this tool's formation and margin: half of `budget` on d (+ the mix), vs the full mix.
 *  Returns win% (draws half) over seeds x mirrored sides; every seed draws its own random mix weights. */
export async function scenario(list: { d: Design; pool: Design[]; budget: number }[], seeds: number, label: string): Promise<number[]> {
  const jobs: Job[] = [], designs = new Map<string, Design>();
  list.forEach(({ d, pool, budget }, i) => {
    [d, ...pool].forEach((x) => designs.set(x.id, x));
    for (let s = 0; s < seeds; s++) {
      const mine = buildArmy([[d, 1]], budget / 2);
      const spent = mine.reduce((t, x) => t + cost(x), 0);
      // each seed draws its own random mix weights (0.2..1.8), different for my top-up and the enemy's army
      let z = 7919 * (s + 1) + 104729 * i;
      const w = () => 0.2 + 1.6 * ((z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const a = [...mine, ...buildArmy(pool.map((x) => [x, w()] as [Design, number]), budget - spent)];
      const b = buildArmy(pool.map((x) => [x, w()] as [Design, number]), budget);
      jobs.push({ key: `${i}|${s}`, a: ids(a), b: ids(b), seed: s });
    }
  });
  const r = await runJobs(jobs, [...designs.values()], label);
  return list.map((_, i) => {
    const ms = Array.from({ length: seeds }, (_, s) => r.get(`${i}|${s}`)!);
    // a mirrored pair's mean margin > 0 means A won on balance; count wins (margin > 0.02), draws, losses
    return Math.round((100 * ms.reduce((t, m) => t + (m > 0.02 ? 1 : m < -0.02 ? 0 : 0.5), 0)) / ms.length);
  });
}

async function check(seeds: number) {
  const { winRate } = await import('./op-check.ts');
  const cases: { name: string; d: Design; pool: Design[]; poolName: string; budget: number }[] = [
    { name: 'Monolith twinmg (titanlegs)', d: L('x-mono-twinmg'), pool: USER_MIX, poolName: 'arty+riot', budget: 700 },
    { name: 'Monolith smoke (titanlegs)', d: L('x-mono-smoke'), pool: USER_MIX, poolName: 'arty+riot', budget: 700 },
    { name: 'Monolith mg (titanlegs)', d: L('x-mono-mg'), pool: USER_MIX, poolName: 'arty+riot', budget: 700 },
    { name: 'Monolith hmg+smoke', d: L('x-mono-hmgsmoke'), pool: USER_MIX, poolName: 'arty+riot', budget: 700 },
    { name: 'Aegis/treads cannon+hmg', d: L('x-aegis-cannon-hmg'), pool: DEFAULT_MIX, poolName: 'starters', budget: 700 },
    { name: 'Warden/halftrack cannon+hmg', d: L('x-warden-cannon-hmg'), pool: DEFAULT_MIX, poolName: 'starters', budget: 700 },
    { name: 'Aegis/treads cannon', d: L('x-aegis-cannon'), pool: DEFAULT_MIX, poolName: 'starters', budget: 700 },
    { name: 'Juggernaut plate+smoke', d: L('x-jugg-smoke'), pool: USER_MIX, poolName: 'arty+riot', budget: 700 },
    { name: 'Bastion wall', d: L('x-bastion-wall'), pool: USER_MIX, poolName: 'arty+riot', budget: 700 },
    { name: 'Gargantua', d: S('juggernaut'), pool: DEFAULT_MIX, poolName: 'starters', budget: 2000 },
    { name: 'Kronos', d: S('warlord'), pool: DEFAULT_MIX, poolName: 'starters', budget: 3000 },
    { name: 'Thunderbird', d: S('thunderbird'), pool: DEFAULT_MIX, poolName: 'starters', budget: 1200 },
    { name: 'Hornet swarm', d: S('hornet'), pool: DEFAULT_MIX, poolName: 'starters', budget: 700 },
    { name: 'Buzzsaw swarm', d: S('buzzsaw'), pool: DEFAULT_MIX, poolName: 'starters', budget: 700 },
    { name: 'Skyguard', d: S('skyguard'), pool: DEFAULT_MIX, poolName: 'starters', budget: 700 },
    { name: 'Missile Spire', d: S('spire'), pool: DEFAULT_MIX, poolName: 'starters', budget: 700 },
    { name: 'Monolith wall (shield+PD)', d: L('x-wall-mono'), pool: USER_MIX, poolName: 'arty+riot', budget: 700 },
    { name: 'Monolith wall (shield+PD)', d: L('x-wall-mono'), pool: DEFAULT_MIX, poolName: 'starters', budget: 700 },
    { name: 'Monolith wall (shield+PD)', d: L('x-wall-mono'), pool: [L('x-kpokies')], poolName: 'K POKIES', budget: 540 },
  ];
  const team = await scenario(cases, seeds, 'check');
  console.log(`\nwin % (half the budget on the design + the mix, vs the mix): op-check = scripts/op-check.ts winRate (corner packing, ${seeds} seeds x 2 sides), team = this tool's formation (${seeds} seeds x 2 sides)`);
  cases.forEach((c, i) => {
    const st = computeStats(c.d);
    const op = winRate(c.d, c.budget, seeds, c.pool);
    console.log(`${c.name.padEnd(30)} ${String(st.cost).padStart(5)} x${st.squad} (x${st.teamMult.toFixed(2)})  vs ${c.poolName.padEnd(9)} @${c.budget}:  op-check ${String(op).padStart(3)}%   team ${String(team[i]).padStart(3)}%`);
  });
  // the player's wall army: 1 weaponless Monolith wall + 2 blocks of laser/ATGM pokers, vs equal supply
  const wall = L('x-wall-mono'), kp = L('x-kpokies');
  const STARTER8 = ['bulwark', 'lancer', 'tankbuster', 'skyguard', 'firestorm', 'hunter', 'stormcaller', 'thunderhead'].map(S);
  const fill = (budget: number, pool: Design[]) => { const a = [wall]; return [...a, ...buildArmy(pool.map((x) => [x, 1] as [Design, number]), budget - cost(wall))]; };
  console.log(`\nwall army (wall ${cost(wall)} x${computeStats(wall).teamMult.toFixed(2)}, K POKIES ${cost(kp)} x${computeStats(kp).squad}); equal supply unless noted, ${seeds} seeds x 2 sides:`);
  await armyVs([
    { name: '1 wall + 2 K POKIES vs K POKIES', a: [wall, kp, kp], opp: [kp] },
    { name: '1 wall + 2 K POKIES vs starter mix (8)', a: [wall, kp, kp], opp: STARTER8 },
    { name: '1 wall + 2 K POKIES vs arty+riot mix', a: [wall, kp, kp], opp: USER_MIX },
    { name: '1 wall + 2 K POKIES vs all starters <= size 3', a: [wall, kp, kp], opp: DEFAULT_MIX },
    { name: 'wall + starter mix (8) vs starter mix @700', a: fill(700, STARTER8), opp: STARTER8 },
    { name: 'wall + arty+riot vs arty+riot @700', a: fill(700, USER_MIX), opp: USER_MIX },
    { name: 'wall + K POKIES vs K POKIES @540', a: fill(540, [kp]), opp: [kp] },
  ], seeds);
}

/** fixed army A vs `budget` (default: A's own price, i.e. equal supply) of a recipe; win % over seeds x mirrored sides */
async function armyVs(cases: { name: string; a: Design[]; opp: Design[]; budget?: number }[], seeds: number): Promise<void> {
  const jobs: Job[] = [], designs = new Map<string, Design>();
  const armies = cases.map((c) => {
    const spend = c.a.reduce((t, x) => t + cost(x), 0);
    const b = buildArmy(c.opp.map((x) => [x, 1] as [Design, number]), c.budget ?? spend);
    [...c.a, ...c.opp].forEach((x) => designs.set(x.id, x));
    return { spend, b };
  });
  cases.forEach((c, i) => { for (let s = 0; s < seeds; s++) jobs.push({ key: `${i}|${s}`, a: ids(c.a), b: ids(armies[i].b), seed: s }); });
  const r = await runJobs(jobs, [...designs.values()], 'armies');
  cases.forEach((c, i) => {
    const ms = Array.from({ length: seeds }, (_, s) => r.get(`${i}|${s}`)!);
    const w = Math.round((100 * ms.reduce((t, m) => t + (m > 0.02 ? 1 : m < -0.02 ? 0 : 0.5), 0)) / ms.length);
    const bs = armies[i].b.reduce((t, x) => t + cost(x), 0);
    console.log(`${c.name.padEnd(46)} ${String(armies[i].spend).padStart(5)} vs ${String(bs).padStart(5)}:  win ${String(w).padStart(3)}%  mean margin ${mean(ms).toFixed(2)}`);
  });
}

/** The wall-tax tuning set (stats.ts TOUGH): Monolith walls in front of the artillery / riot mix, massed cheap
 *  weaponless walls, the self-destruct cart swarm, and the player's wall + K POKIES army. Prints one summary line
 *  (mean distance from 55%) for scripting. */
async function walls(seeds: number) {
  const { winRate } = await import('./op-check.ts');
  const cases: { name: string; d: Design; pool: Design[]; budget: number }[] = [
    { name: 'Monolith twinmg + arty/riot', d: L('x-mono-twinmg'), pool: USER_MIX, budget: 700 },
    { name: 'Monolith smoke + arty/riot', d: L('x-mono-smoke'), pool: USER_MIX, budget: 700 },
    { name: 'Monolith shield+PD wall + arty/riot', d: L('x-wall-mono'), pool: USER_MIX, budget: 700 },
    { name: 'Monolith shield+PD wall + starters', d: L('x-wall-mono'), pool: DEFAULT_MIX, budget: 700 },
    { name: 'Monolith Hull plate+smoke (massed)', d: D('w1', 'juggernaut', 'treads', ['plateH', 'smoke']), pool: DEFAULT_MIX, budget: 1000 },
    { name: 'Monolith Hull reactive+smoke (massed)', d: D('w2', 'juggernaut', 'treads', ['reactive', 'smoke']), pool: USER_MIX, budget: 1000 },
    { name: 'Monolith Hull shieldH+smoke (massed)', d: D('w3', 'juggernaut', 'treads', ['shieldH', 'smoke']), pool: DEFAULT_MIX, budget: 1000 },
    { name: 'Bastion plate wall (massed)', d: L('x-bastion-wall'), pool: USER_MIX, budget: 1000 },
    { name: 'Monolith Hull hmg (massed)', d: D('w4', 'juggernaut', 'treads', ['hmg', null]), pool: DEFAULT_MIX, budget: 1000 },
    { name: 'self-destruct carts x16 (massed)', d: D('w5', 'carriage', 'wheels', ['selfdestruct']), pool: DEFAULT_MIX, budget: 1000 },
  ];
  // half the budget must still buy the design: a design dearer than budget / 2 is tested at 2.4x its price
  for (const c of cases) c.budget = Math.max(c.budget, Math.ceil((2.4 * cost(c.d)) / 50) * 50);
  const team = await scenario(cases, seeds, 'walls');
  const wall = L('x-wall-mono'), kp = L('x-kpokies');
  const STARTER8 = ['bulwark', 'lancer', 'tankbuster', 'skyguard', 'firestorm', 'hunter', 'stormcaller', 'thunderhead'].map(S);
  const rows: number[] = [];
  console.log(`\nwin % (half the budget on the design + the mix, vs the mix): op-check (corner packing) / team (AI + line placement), ${seeds} seeds x 2 sides`);
  cases.forEach((c, i) => {
    const st = computeStats(c.d), op = winRate(c.d, c.budget, seeds, c.pool);
    rows.push(op, team[i]);
    console.log(`${c.name.padEnd(40)} ${String(st.cost).padStart(5)} x${st.squad} (tax +${st.toughTax.toFixed(0)}/unit) @${c.budget}  op-check ${String(op).padStart(3)}%   team ${String(team[i]).padStart(3)}%`);
  });
  console.log(`\nwall army (wall ${cost(wall)}, K POKIES ${cost(kp)} x${computeStats(kp).squad}): 1 wall + 2 K POKIES vs equal supply`);
  const res = await armyVsRows([
    { name: 'vs K POKIES', a: [wall, kp, kp], opp: [kp] },
    { name: 'vs starter mix (8)', a: [wall, kp, kp], opp: STARTER8 },
    { name: 'vs arty+riot mix', a: [wall, kp, kp], opp: USER_MIX },
    { name: 'vs all starters <= size 3', a: [wall, kp, kp], opp: DEFAULT_MIX },
  ], seeds);
  rows.push(...res);
  console.log(`SUMMARY mean |win - 55| = ${mean(rows.map((x) => Math.abs(x - 55))).toFixed(1)}  (mean win ${mean(rows).toFixed(1)})`);
}
async function armyVsRows(cases: { name: string; a: Design[]; opp: Design[] }[], seeds: number): Promise<number[]> {
  const jobs: Job[] = [], designs = new Map<string, Design>();
  // equal supply, as near as the opponent's block prices allow (it may go over by up to half its cheapest block)
  const bs = cases.map((c) => { [...c.a, ...c.opp].forEach((x) => designs.set(x.id, x)); return buildArmy(c.opp.map((x) => [x, 1] as [Design, number]), c.a.reduce((t, x) => t + cost(x), 0) + Math.min(...c.opp.map(cost)) / 2); });
  cases.forEach((c, i) => { for (let s = 0; s < seeds; s++) jobs.push({ key: `${i}|${s}`, a: ids(c.a), b: ids(bs[i]), seed: s }); });
  const r = await runJobs(jobs, [...designs.values()], 'armies');
  return cases.map((c, i) => {
    const ms = Array.from({ length: seeds }, (_, s) => r.get(`${i}|${s}`)!);
    const w = Math.round((100 * ms.reduce((t, m) => t + (m > 0.02 ? 1 : m < -0.02 ? 0 : 0.5), 0)) / ms.length);
    console.log(`${c.name.padEnd(40)} ${String(c.a.reduce((t, x) => t + cost(x), 0)).padStart(5)} vs ${String(bs[i].reduce((t, x) => t + cost(x), 0)).padStart(5)}:  win ${String(w).padStart(3)}%  margin ${mean(ms).toFixed(2)}`);
    return w;
  });
}

async function stack(seeds: number) {
  const list = ['x-mono-twinmg', 'x-wall-mono', 'x-aegis-cannon-hmg', 'thunderhead', 'hornet', 'skyguard', 'x-jugg-smoke', 'spire', 'ironclad', 'bulwark', 'lancer', 'pool-gunsled'].map(L);
  const ctxs = CONTEXTS.filter((c) => !c.neutral).filter((_, i) => i % 3 === 0);
  const jobs: Job[] = [];
  const all = new Map<string, Design>([...LIBRARY, FILLER].map((d) => [d.id, d]));
  const B = 1600;
  const meta = new Map<string, { core: Design[]; opp: Design[] }>();
  for (const c of ctxs) {
    const core = buildArmy(resolve(c.core), (1 - PHI) * B), opp = buildArmy(resolve(c.opp), B);
    meta.set(c.id, { core, opp });
    for (const n of [0, 2, 4, 6, 8, 12, 16]) for (let s = 0; s < seeds; s++) jobs.push({ key: `F|${c.id}|${n}|${s}`, a: [...ids(core), ...Array(n).fill(FILLER.id)], b: ids(opp), seed: s });
    for (const d of list) for (const k of [1, 2, 4]) for (let s = 0; s < seeds; s++) jobs.push({ key: `X|${d.id}|${k}|${c.id}|${s}`, a: [...ids(core), ...Array(k).fill(d.id)], b: ids(opp), seed: s });
  }
  const r = await runJobs(jobs, [...all.values()], 'stack');
  console.log(`\nstacking: value per block (filler supply) with 1 / 2 / 4 blocks in ${ctxs.length} contexts @${B}`);
  for (const d of list) {
    const per = [1, 2, 4].map((k) => mean(ctxs.map((c) => {
      const cv: Curve = { ctx: c.id, B, pts: [0, 2, 4, 6, 8, 12, 16].map((n) => ({ q: n * cost(FILLER), m: Array.from({ length: seeds }, (_, s) => r.get(`F|${c.id}|${n}|${s}`)!) })) };
      return invert(cv, mean(Array.from({ length: seeds }, (_, s) => r.get(`X|${d.id}|${k}|${c.id}|${s}`)!))).q / k;
    })));
    console.log(`${d.id.padEnd(22)} price ${String(cost(d)).padStart(5)}   per block: x1 ${per[0].toFixed(0).padStart(5)}  x2 ${per[1].toFixed(0).padStart(5)}  x4 ${per[2].toFixed(0).padStart(5)}`);
  }
}

function randomDesign(rnd: () => number, id: string): Design | null {
  for (let t = 0; t < 60; t++) {
    const c = CHASSIS[Math.floor(rnd() * CHASSIS.length)];
    const mobs = MOBILITY.filter((m) => !pairingError(c.id, m.id));
    if (!mobs.length) continue;
    const m = mobs[Math.floor(rnd() * mobs.length)];
    const mounts = c.mounts.map((_, i) => {
      if (rnd() < 0.2) return null;
      const ok = MODULES.filter((x) => !slotError(c, m.id, i, x));
      return ok.length ? ok[Math.floor(rnd() * ok.length)].id : null;
    });
    const d: Design = { id, name: id.slice(0, 24), chassis: c.id, mobility: m.id, mounts };
    if (!validateDesign(d).length && cost(d) <= 900) return d;
  }
  return null;
}
function mutate(rnd: () => number, d: Design, id: string): Design | null {
  for (let t = 0; t < 30; t++) {
    const c = CHASSIS.find((x) => x.id === d.chassis)!;
    const x: Design = { ...d, id, name: id.slice(0, 24), mounts: [...d.mounts] };
    const r = rnd();
    if (r < 0.2) { const mobs = MOBILITY.filter((m) => !pairingError(c.id, m.id)); x.mobility = mobs[Math.floor(rnd() * mobs.length)].id; }
    else {
      const i = Math.floor(rnd() * c.mounts.length);
      const ok = MODULES.filter((m) => !slotError(c, x.mobility, i, m));
      x.mounts[i] = rnd() < 0.15 || !ok.length ? null : ok[Math.floor(rnd() * ok.length)].id;
    }
    if (!validateDesign(x).length && cost(x) <= 900) return x;
  }
  return null;
}
/** GA over designs: fitness = win % of (half the budget on the design + the reference mix) vs the reference mix,
 *  over two mixes (starters; the user's artillery + riot mix). Reports anything above 60%. */
async function exploit(gens: number, pop: number) {
  let seed = Number(process.env.TV_SEED ?? 99);
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let P: Design[] = [...EXTREMES.filter((d) => cost(d) <= 900).slice(0, Math.floor(pop / 3))];
  while (P.length < pop) { const d = randomDesign(rnd, `ga0-${P.length}`); if (d) P.push(d); }
  const seen = new Map<string, number>();
  const evalAll = async (ds: Design[], g: number) => {
    const fresh = ds.filter((d) => !seen.has(d.id));
    const rs = await scenario(fresh.flatMap((d) => [{ d, pool: DEFAULT_MIX, budget: 1000 }, { d, pool: USER_MIX, budget: 1000 }]), 4, `gen ${g}`);
    fresh.forEach((d, i) => seen.set(d.id, (rs[2 * i] + rs[2 * i + 1]) / 2));
  };
  const all: Design[] = [];
  for (let g = 0; g < gens; g++) {
    await evalAll(P, g);
    all.push(...P.filter((d) => !all.includes(d)));
    P.sort((a, b) => seen.get(b.id)! - seen.get(a.id)!);
    console.log(`gen ${g}: best ${P.slice(0, 4).map((d) => `${d.chassis}/${d.mobility} [${d.mounts.join(',')}] ${cost(d)} -> ${seen.get(d.id)}%`).join(' | ')}`);
    const elite = P.slice(0, Math.ceil(pop / 3));
    const next = [...elite];
    let n = 0;
    while (next.length < pop) { const p = elite[Math.floor(rnd() * elite.length)]; const m = rnd() < 0.8 ? mutate(rnd, p, `ga${g + 1}-${n++}`) : randomDesign(rnd, `ga${g + 1}-${n++}`); if (m) next.push(m); }
    P = next;
  }
  // confirm the top ones with more seeds
  const top = [...all].sort((a, b) => seen.get(b.id)! - seen.get(a.id)!).slice(0, 10);
  const conf = await scenario(top.flatMap((d) => [{ d, pool: DEFAULT_MIX, budget: 1000 }, { d, pool: USER_MIX, budget: 1000 }]), 12, 'confirm');
  console.log('\ntop designs (confirmation: 12 seeds x 2 sides per mix; starters / arty+riot):');
  const winners: Design[] = [];
  top.forEach((d, i) => {
    const w = (conf[2 * i] + conf[2 * i + 1]) / 2;
    console.log(`${String(w).padStart(4)}%  (${conf[2 * i]} / ${conf[2 * i + 1]})  ${cost(d)} x${computeStats(d).squad} mult ${computeStats(d).teamMult.toFixed(2)}  ${JSON.stringify({ chassis: d.chassis, mobility: d.mobility, mounts: d.mounts })}`);
    if (w > 60) winners.push({ ...d, id: `ex-${d.chassis}-${i}` });
  });
  const f = new URL('./teamvalue-exploits.json', import.meta.url).pathname;
  const prev: Design[] = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
  writeFileSync(f, JSON.stringify([...prev, ...winners.filter((w) => !prev.some((p) => p.chassis === w.chassis && p.mobility === w.mobility && p.mounts.join() === w.mounts.join()))], null, 1));
  console.log(`${winners.length} designs above 60% appended to ${f} (feed back with TV_EXTRA=${f} node scripts/teamvalue.ts measure)`);
}

function show() {
  for (const d of LIBRARY) {
    const s = computeStats(d);
    console.log(`${d.id.padEnd(22)} ${`${d.chassis}/${d.mobility}`.padEnd(24)} ${JSON.stringify(d.mounts).padEnd(44)} ${String(s.cost).padStart(5)} x${String(s.squad).padEnd(2)} team x${s.teamMult.toFixed(2)}`);
  }
}

// ------------------------------------------------------------------------------------------- main
const mode = process.argv[2] ?? 'show';
if (mode === 'worker') workerMain();
else if (process.argv[1]?.endsWith('teamvalue.ts')) {
  const a3 = process.argv[3], a4 = process.argv[4];
  if (mode === 'measure') await measure(Number(a3 ?? 4), a4 ?? '');
  else if (mode === 'fit') fit(a3 ? Number(a3) : undefined);
  else if (mode === 'all') { await measure(Number(a3 ?? 4), ''); fit(); }
  else if (mode === 'check') await check(Number(a3 ?? 12));
  else if (mode === 'stack') await stack(Number(a3 ?? 3));
  else if (mode === 'walls') await walls(Number(a3 ?? 12));
  else if (mode === 'exploit') await exploit(Number(a3 ?? 6), Number(a4 ?? 24));
  else show();
}
