// Small-scenario range harness: pairs / small groups of units on the real field, real sim.
// Run: node scripts/duels.ts [weapons|duels|groups|all] [seeds=3] [filter]
//
//  weapons: per weapon module: range (cells / m), projectile speed, flight time at max range, and how long
//           typical rushers need to cross the band between their own range and that weapon's range
//           ("approach time") plus how many shots the weapon gets in that window.
//  duels:   one ranged block (side 0) vs one rusher block (side 1), several seeds x lateral offsets, two setups:
//             adv  = both deploy on their front row, default 'advance' AI (front lines 44 cells apart)
//             hold = ranged block parked on its BACK row with stance holdPos (protected-artillery use case)
//           Columns: contact = s until the rusher first fires (it is in its own range), d@1st = centre distance
//           when the ranged side first fired, shots/hits/dmg% = ranged side's shots, hit events and damage
//           (% of the rusher block's total hp) landed BEFORE contact, kill% = rusher units dead at contact,
//           W = wins ranged/rusher/draw, hp% = winner's remaining hp %, dur = battle length (s).
//  groups:  cost-equal small groups (budget / computeStats(d).cost blocks each), same columns.
//
// Ranges and speeds are in cells (1 cell = 5 m). Keep this fast: it runs in a few seconds.
// Trial numbers without editing parts.ts: DUEL_PATCH='{"howitzer":{"range":30}}' node scripts/duels.ts duels 3 howitzer

import { Battle } from '../src/shared/sim/battle.ts';
import { TICK_RATE } from '../src/shared/sim/types.ts';
import { DEPLOY_D, FIELD_H, FIELD_W, METERS_PER_CELL, blockDims } from '../src/shared/grid.ts';
import { MODULES, MODULE_BY_ID } from '../src/shared/parts.ts';
import { computeStats, validateDesign } from '../src/shared/stats.ts';
import type { Design, ModuleDef, Placement, Stance } from '../src/shared/types.ts';

// DUEL_PATCH='{"howitzer":{"range":30,"projectileSpeed":12}, ...}' tries module numbers without editing parts.ts
if (process.env.DUEL_PATCH) {
  for (const [id, patch] of Object.entries(JSON.parse(process.env.DUEL_PATCH) as Record<string, Partial<ModuleDef>>)) {
    const m = MODULE_BY_ID.get(id);
    if (!m) throw new Error(`DUEL_PATCH: unknown module ${id}`);
    Object.assign(m, patch);
  }
}

const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id, chassis, mobility, mounts });

// ---- archetypes (starters where one exists) ----
const DESIGNS: Design[] = [
  // artillery
  D('howitzer', 'longarm', 'spider', ['howitzer']), // starter Thunderhead
  D('mortar2', 'striker', 'spider', ['mortar', 'mortar', null]), // starter Firestorm
  D('mlrs', 'longarm', 'spider', ['mlrs']),
  D('barrage', 'longarm', 'spider', ['barrage']),
  D('cruise', 'longarm', 'spider', ['cruise']),
  D('mortarcart', 'carriage', 'wheels', ['mortar']), // cheap mortar squad (16)
  // precision
  D('snipers', 'scout', 'halftrack', ['sniper']), // squad
  D('railgun', 'longarm', 'spider', ['railgun']),
  D('lightrail', 'hunter', 'halftrack', ['lightrail', null]),
  // missiles
  D('atgm', 'raider', 'legs', ['atgm', 'atgm']), // starter Tank Hunter (squad)
  D('swarm', 'warden', 'halftrack', ['swarm', null]),
  D('spire', 'warden', 'anchor', ['guidedrocket', 'hmg']), // starter Missile Spire
  // direct fire / assault
  D('tankbuster', 'longarm', 'spider', ['cannon']), // starter
  D('bulwark', 'warden', 'treads', ['autocannon', 'plateL']), // starter
  D('ironclad', 'bastion', 'treads', ['cannon', 'plateM', 'autocannon']), // starter
  D('assaulthalf', 'warden', 'halftrack', ['cannon75', 'hmg']), // faster medium assault
  // fast raiders / light squads
  D('buzzsaw', 'scout', 'wheels', ['mg']), // starter cheap swarm (16)
  D('hoverraid', 'scout', 'hover', ['hmg']), // fastest ground raider squad
  D('wheelraid', 'raider', 'wheels', ['hmg', 'hmg']),
  // melee / short range
  D('ripper', 'mantis', 'legs', ['buzzsaw', 'shockprod']), // starter Gnasher (squad)
  D('mantis', 'mantis', 'jumpjets', ['buzzsaw', 'buzzsaw']),
  D('torch', 'scout', 'halftrack', ['flamer']), // starter Torchbug (squad)
  D('brawler', 'striker', 'halftrack', ['minigun', 'twin30', 'shotgun']), // starter Voltrider
  // AA
  D('skyguard', 'warden', 'halftrack', ['ac40', 'ac20']), // starter
];
const BY_ID = new Map(DESIGNS.map((d) => [d.id, d]));
for (const d of DESIGNS) {
  const e = validateDesign(d);
  if (e.length) throw new Error(`design ${d.id}: ${e.join('; ')}`);
}
const ST = new Map(DESIGNS.map((d) => [d.id, computeStats(d)]));

const mode = process.argv[2] ?? 'all';
const SEEDS = Number(process.argv[3] ?? 3);
const FILTER = process.argv[4] ?? '';
const OFFSETS = [0, 12, 24]; // lateral offsets (cells) of the rusher vs the ranged block
const GAP = FIELD_H - 2 * DEPLOY_D;

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const pad = (s: string | number, n: number) => String(s).padStart(n);
const padR = (s: string | number, n: number) => String(s).padEnd(n);

// ---------------------------------------------------------------------------------------------
function weapons() {
  const rushers = ['buzzsaw', 'hoverraid', 'ripper', 'bulwark', 'ironclad'];
  console.log(`\n=== Weapon ranges (field gap ${GAP} cells = ${GAP * METERS_PER_CELL} m; longarm +20%, anchor +15% range) ===`);
  console.log('rusher speeds (cells/s) / own range: ' + rushers.map((r) => `${r} ${ST.get(r)!.speed}/${ST.get(r)!.range}`).join(', '));
  console.log('approach = s a rusher needs to close from this weapon\'s max range to its own range; shots = approach / cooldown');
  console.log(padR('module', 15) + padR('cat', 11) + pad('rng', 5) + pad('m', 5) + pad('min', 4) + pad('pSpd', 5) + pad('fly', 5) + pad('cd', 6) + '  ' + rushers.map((r) => pad(r.slice(0, 9), 10) + pad('sh', 4)).join(''));
  for (const m of MODULES) {
    if (m.kind !== 'weapon' || !m.range || m.requires === 'air') continue;
    if (FILTER && !m.id.includes(FILTER) && m.category !== FILTER) continue;
    const r = m.range;
    const fly = m.projectileSpeed ? r / m.projectileSpeed : 0;
    const cyc = m.cooldown + (m.burst ? (m.burst - 1) * 0.1 : 0);
    const cols = rushers.map((id) => {
      const s = ST.get(id)!;
      const t = Math.max(0, r - s.range) / s.speed;
      return pad(f(t), 10) + pad(f(t / cyc + (t > 0 ? 1 : 0), 0), 4);
    });
    console.log(padR(m.id, 15) + padR(m.category, 11) + pad(f(r), 5) + pad(Math.round(r * METERS_PER_CELL), 5) + pad(m.minRange ?? '', 4) + pad(m.projectileSpeed ?? (m.projectile === 'melee' ? 'mel' : 'inst'), 5) + pad(fly ? f(fly) : '', 5) + pad(f(m.cooldown, 2), 6) + '  ' + cols.join(''));
  }
}

// ---------------------------------------------------------------------------------------------
let uidSeq = 1;
interface Block { id: string; cx: number; y: number; stance?: Stance }

/** Placements for one side: block centres given in WORLD x (cx), local depth y (0 = front row). */
function place(side: 0 | 1, blocks: Block[]): Placement[] {
  return blocks.map((b) => {
    const s = ST.get(b.id)!;
    const { w, h } = blockDims(s.size as 1, 0, s);
    let x = Math.round(side === 0 ? b.cx - w / 2 : FIELD_W - b.cx - w / 2);
    x = Math.max(0, Math.min(FIELD_W - w, x));
    const y = Math.max(0, Math.min(DEPLOY_D - h, b.y));
    return { uid: uidSeq++, designId: b.id, x, y, level: 1, round: 1, stance: b.stance };
  });
}

interface Res { contact: number; d1st: number; shots: number; hits: number; dmgPct: number; killPct: number; win: number; hpPct: number; dur: number }

function run(seed: number, a: Placement[], b: Placement[]): Res {
  const bt = new Battle({ seed, sides: [{ designs: DESIGNS, units: a }, { designs: DESIGNS, units: b }] });
  const hp1 = bt.units.filter((u) => u.side === 1).reduce((s, u) => s + u.maxHp, 0);
  const n1 = bt.units.filter((u) => u.side === 1).length;
  let tick = 0, contact = NaN, d1st = NaN, shots = 0, hits = 0, dmg = 0, kills = 0;
  while (!bt.done) {
    bt.step();
    tick++;
    if (!Number.isNaN(contact)) continue;
    for (const e of bt.events) {
      if (e.t === 'fire') {
        const u = bt.units[e.unit];
        if (u.side === 1) { contact = tick / TICK_RATE; break; }
        shots++;
        if (Number.isNaN(d1st)) {
          // distance to the nearest living rusher
          let best = Infinity;
          for (const v of bt.units) if (v.side === 1 && v.alive) best = Math.min(best, Math.hypot(v.x - u.x, v.y - u.y));
          d1st = best;
        }
      } else if (e.t === 'hit' && bt.units[e.unit].side === 1) { hits++; dmg += e.damage; }
      else if (e.t === 'death' && bt.units[e.unit].side === 1) kills++;
    }
  }
  const s = bt.summary();
  const winSide = s.winner;
  let hpPct = NaN;
  if (winSide !== -1) {
    const us = bt.units.filter((u) => u.side === winSide);
    hpPct = (100 * us.reduce((a, u) => a + (u.alive ? u.hp : 0), 0)) / us.reduce((a, u) => a + u.maxHp, 0);
  }
  return { contact, d1st, shots, hits, dmgPct: (100 * dmg) / hp1, killPct: (100 * kills) / n1, win: winSide, hpPct, dur: s.ticks / TICK_RATE };
}

function header(label: string) {
  console.log(`\n=== ${label} (seeds ${SEEDS} x offsets ${OFFSETS.join('/')}; means over runs; contact '-' = rusher never fired) ===`);
  console.log(padR('ranged', 11) + padR('rusher', 11) + padR('mode', 5) + pad('cntct', 6) + pad('d@1st', 6) + pad('shots', 6) + pad('hits', 6) + pad('dmg%', 6) + pad('kill%', 6) + pad('W r/R/d', 9) + pad('hp%', 5) + pad('dur', 6));
}

function report(ranged: string, rusher: string, mode: string, rs: Res[]) {
  const mean = (k: keyof Res) => { const v = rs.map((r) => r[k] as number).filter((x) => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
  const w = [0, 0, 0];
  for (const r of rs) w[r.win === 0 ? 0 : r.win === 1 ? 1 : 2]++;
  const hpW = mean('hpPct');
  console.log(padR(ranged, 11) + padR(rusher, 11) + padR(mode, 5) + pad(f(mean('contact')), 6) + pad(f(mean('d1st')), 6) + pad(f(mean('shots')), 6) + pad(f(mean('hits')), 6) + pad(f(mean('dmgPct'), 0), 6) + pad(f(mean('killPct'), 0), 6) + pad(`${w[0]}/${w[1]}/${w[2]}`, 9) + pad(f(hpW, 0), 5) + pad(f(mean('dur'), 0), 6));
}

function duel(ranged: string, rusher: string) {
  for (const md of ['adv', 'hold'] as const) {
    const rs: Res[] = [];
    for (let s = 1; s <= SEEDS; s++) for (const off of OFFSETS) {
      const a = place(0, [{ id: ranged, cx: FIELD_W / 2, y: md === 'adv' ? 0 : DEPLOY_D, stance: md === 'hold' ? 'holdPos' : undefined }]);
      const b = place(1, [{ id: rusher, cx: FIELD_W / 2 + off, y: 0 }]);
      rs.push(run(s * 1013 + off, a, b));
    }
    report(ranged, rusher, md, rs);
  }
}

const DUELS: [string, string][] = [
  // artillery vs rushers
  ['howitzer', 'buzzsaw'], ['howitzer', 'hoverraid'], ['howitzer', 'ripper'], ['howitzer', 'bulwark'], ['howitzer', 'assaulthalf'], ['howitzer', 'ironclad'],
  ['mortar2', 'buzzsaw'], ['mortar2', 'ripper'], ['mortar2', 'bulwark'], ['mortar2', 'assaulthalf'],
  ['mlrs', 'buzzsaw'], ['mlrs', 'bulwark'], ['barrage', 'buzzsaw'], ['barrage', 'bulwark'], ['cruise', 'bulwark'],
  ['mortarcart', 'buzzsaw'], ['mortarcart', 'bulwark'],
  // precision
  ['snipers', 'hoverraid'], ['snipers', 'bulwark'], ['railgun', 'bulwark'], ['railgun', 'tankbuster'], ['lightrail', 'wheelraid'], ['lightrail', 'tankbuster'],
  // missiles
  ['atgm', 'wheelraid'], ['atgm', 'bulwark'], ['swarm', 'hoverraid'], ['swarm', 'bulwark'], ['spire', 'ripper'],
  // direct fire
  ['tankbuster', 'bulwark'], ['bulwark', 'bulwark'], ['assaulthalf', 'bulwark'], ['ironclad', 'brawler'],
  // short range
  ['torch', 'buzzsaw'], ['brawler', 'buzzsaw'], ['skyguard', 'buzzsaw'], ['bulwark', 'ripper'],
];

function duels() {
  header('Duels: one block each');
  for (const [a, b] of DUELS) {
    if (FILTER && !a.includes(FILTER) && !b.includes(FILTER)) continue;
    duel(a, b);
  }
}

// ---------------------------------------------------------------------------------------------
const BUDGET = 300;
/** n blocks of a design spread across the field centre, rows of up to 4, `y0` local depth of the first row. */
function groupBlocks(id: string, n: number, y0: number, stance?: Stance): Block[] {
  const s = ST.get(id)!;
  const { w, h } = blockDims(s.size as 1, 0, s);
  const out: Block[] = [];
  const perRow = Math.max(1, Math.min(n, Math.floor(60 / (w + 2))));
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / perRow), c = i % perRow;
    const inRow = Math.min(perRow, n - r * perRow);
    out.push({ id, cx: FIELD_W / 2 + (c - (inRow - 1) / 2) * (w + 2), y: y0 + (y0 > 0 ? -r : r) * (h + 1), stance });
  }
  return out;
}

const GROUPS: [string, string][] = [
  ['howitzer', 'bulwark'], ['howitzer', 'buzzsaw'], ['howitzer', 'assaulthalf'], ['mortar2', 'bulwark'], ['mortar2', 'ripper'],
  ['mlrs', 'buzzsaw'], ['mortarcart', 'bulwark'], ['mortarcart', 'buzzsaw'], ['mortarcart', 'assaulthalf'], ['mortarcart', 'ironclad'], ['mortarcart', 'hoverraid'], ['mortar2', 'buzzsaw'], ['snipers', 'bulwark'], ['snipers', 'buzzsaw'], ['atgm', 'buzzsaw'], ['railgun', 'bulwark'], ['atgm', 'bulwark'], ['swarm', 'hoverraid'], ['tankbuster', 'bulwark'],
];

function groups() {
  header(`Cost-equal groups (~${BUDGET} supply each; blocks shown as n x)`);
  for (const [a, b] of GROUPS) {
    if (FILTER && !a.includes(FILTER) && !b.includes(FILTER)) continue;
    // budget grows to fit an expensive block so both sides really spend about the same
    const bud = Math.max(BUDGET, ST.get(a)!.cost, ST.get(b)!.cost);
    const na = Math.max(1, Math.round(bud / ST.get(a)!.cost)), nb = Math.max(1, Math.round(bud / ST.get(b)!.cost));
    for (const md of ['adv', 'hold'] as const) {
      const rs: Res[] = [];
      for (let s = 1; s <= SEEDS; s++) for (const off of OFFSETS) {
        const A = place(0, groupBlocks(a, na, md === 'adv' ? 0 : DEPLOY_D - 1, md === 'hold' ? 'holdPos' : undefined));
        const B = place(1, groupBlocks(b, nb, 0).map((x) => ({ ...x, cx: x.cx + off })));
        rs.push(run(s * 7919 + off, A, B));
      }
      report(`${na}x${a}`.slice(0, 10), `${nb}x${b}`.slice(0, 10), md, rs);
    }
  }
}

function designsTable() {
  console.log('\n=== Archetypes (cost per block, units/block, speed cells/s, max range cells incl. hull bonus, hp, armor) ===');
  for (const d of DESIGNS) {
    const s = ST.get(d.id)!;
    console.log(padR(d.id, 12) + padR(`${d.chassis}/${d.mobility}/${d.mounts.filter(Boolean).join('+')}`, 42) + `cost ${pad(s.cost, 5)}  x${pad(s.squad, 2)}  spd ${pad(s.speed.toFixed(2), 5)}  rng ${pad(s.range, 5)}  hp ${pad(s.hp, 5)}  ar ${pad(s.armor, 3)}`);
  }
}

const t0 = performance.now();
if (mode === 'weapons' || mode === 'all') weapons();
if (mode === 'duels' || mode === 'groups' || mode === 'all') designsTable();
if (mode === 'duels' || mode === 'all') duels();
if (mode === 'groups' || mode === 'all') groups();
console.log(`\n(${((performance.now() - t0) / 1000).toFixed(1)} s)`);
