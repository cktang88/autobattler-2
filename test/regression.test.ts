// Regression tests for gameplay fixes of the last weeks (status effects vs max hp, price / 5, shared code purity,
// honest footprints, data validity) plus the bugs found in the regression pass (contact pivot, quiet stalemates,
// pre-rescale saves). Other fixes already have tests next to their features: kiting / hold / rails / flames /
// MAX_RADIUS / default orders in sim.test.ts, melee edge mounts in melee.test.ts, mount origins in mountgeo.test.ts,
// HP readouts in matchmath.test.ts, rate limits in server.test.ts, aura balance in sim.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Battle } from '../src/shared/sim/battle.ts';
import { MAX_TICKS, TICK_RATE } from '../src/shared/sim/types.ts';
import { CHASSIS, MOBILITY, MODULES, MODULE_BY_ID, pairingError } from '../src/shared/parts.ts';
import { artBox, hullK, mountOffsets } from '../src/shared/mountgeo.ts';
import { PRICE_DIV, computeStats, slotError, validateDesign } from '../src/shared/stats.ts';
import {
  PRICE_RESCALE_AT, RULES_VERSION, START_SUPPLY, designCost, isPreRescaleMatch, migrateMatch, newMatch, newPlayer,
  supplyForRound, totalSupplyThrough, upgradeCost,
} from '../src/shared/match.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import { Store } from '../src/server/store.ts';
import type { Design, MatchState, Placement } from '../src/shared/types.ts';

const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id, chassis, mobility, mounts });
const pl = (designId: string, extra: Partial<Placement> = {}): Placement => ({ uid: 1, designId, x: 40, y: 0, level: 1, round: 1, ...extra });

/** one unit per side (side 1's parked `dist` cells straight ahead of side 0's), hash rebuilt */
function duel(designs: Design[], a: Partial<Placement> & { designId: string }, b: Partial<Placement> & { designId: string }, dist: number, seed = 1) {
  const bt = new Battle({ seed, sides: [{ designs, units: [pl(a.designId, a)] }, { designs, units: [pl(b.designId, b)] }] });
  const k = bt.units[0], e = bt.units[1];
  e.x = k.x; e.y = k.y - dist; e.angle = Math.PI / 2;
  (bt as unknown as { rebuildHash(): void }).rebuildHash();
  return { b: bt, k, e };
}

// ---------------------------------------------------------------- status effects (Zero-K style, 14485af / c96fce9)

type DamageFn = (t: unknown, raw: number, ap: number, airBonus: number, side: number, moduleId: string, x: number, y: number, fx?: unknown, fxMult?: number, ox?: number, oy?: number, cls?: number) => void;
/** a battle with a light scout (unit 0) and a heavy bastion (unit 1) on side 1, to apply hits to directly */
function statusBench(extra: Design[] = []) {
  const designs = [D('light', 'scout', 'wheels', ['mg']), D('heavy', 'bastion', 'treads', ['autocannon', 'plateM', null]), D('shot', 'warden', 'halftrack', ['mg', null]), ...extra];
  const b = new Battle({ seed: 1, sides: [{ designs, units: [pl('shot')] }, { designs, units: [pl('light', { x: 10 }), pl('heavy', { uid: 2, x: 60 })] }] });
  const light = b.units.find((u) => u.design.id === 'light')!, heavy = b.units.find((u) => u.design.id === 'heavy')!;
  const hit = (t: typeof light, mod: string, raw = 0.01) => {
    const fx = MODULE_BY_ID.get(mod)!;
    (b as unknown as { damage: DamageFn }).damage.call(b, t, raw, 1, 1, 0, mod, t.x, t.y, fx, 1, t.x, t.y - 5, 0);
  };
  return { b, light, heavy, hit, ints: (b as unknown as { ints: { slowDmg: number; disarmDmg: number; hardened: boolean }[] }).ints };
}

test('paralysis builds against max hp: a light unit is stunned by one stun gun hit, a heavy hull needs many; never past 4 s', () => {
  const { light, heavy, hit } = statusBench();
  hit(light, 'stungun');
  assert.ok(light.stun > 0, 'one stun-gun bolt stuns a light scout');
  let n = 0;
  while (heavy.stun <= 0 && n < 100) { hit(heavy, 'stungun'); n++; }
  assert.ok(n >= 3, `heavy hull stunned after only ${n} hits`); // a lockdown weapon: a few bolts freeze even a tank
  // hits while stunned extend the stun, capped at 4 s
  const s0 = heavy.stun;
  hit(heavy, 'stungun');
  assert.ok(heavy.stun > s0, 'a hit while stunned extends it');
  for (let i = 0; i < 200; i++) hit(heavy, 'stungun');
  assert.ok(heavy.stun <= 4 + 1e-9 && heavy.stun > 3.9, `stun ${heavy.stun}`);
});

test('slow and disarm build against max hp; slow caps at 60%', () => {
  const { light, heavy, hit } = statusBench();
  hit(light, 'slowbeam'); hit(heavy, 'slowbeam');
  assert.ok(light.slow > heavy.slow * 3, `slow light ${light.slow} vs heavy ${heavy.slow}`);
  for (let i = 0; i < 200; i++) hit(light, 'slowbeam');
  assert.ok(Math.abs(light.slow - 0.6) < 1e-9, `slow cap ${light.slow}`);
  hit(light, 'disarm'); hit(heavy, 'disarm');
  assert.ok(light.disarm > 0 && heavy.disarm === 0, `disarm light ${light.disarm} heavy ${heavy.disarm}`);
  for (let i = 0; i < 200; i++) hit(heavy, 'disarm');
  assert.ok(heavy.disarm > 0 && heavy.disarm <= 4 + 1e-9, `disarm ${heavy.disarm}`);
});

test('an up shield blocks status effects (paralysis drains it); hardened systems are immune', () => {
  const shieldD = D('shieldy', 'warden', 'halftrack', ['shield', 'mg']);
  const hardD = D('hard', 'raider', 'halftrack', ['mg', 'hardened']);
  assert.deepEqual(validateDesign(shieldD), []);
  const designs = [shieldD, hardD, D('shot', 'warden', 'halftrack', ['mg', null])];
  const b = new Battle({ seed: 1, sides: [{ designs, units: [pl('shot')] }, { designs, units: [pl('shieldy', { x: 10 }), pl('hard', { uid: 2, x: 60 })] }] });
  const sh = b.units.find((u) => u.design.id === 'shieldy')!, hd = b.units.find((u) => u.design.id === 'hard')!;
  const dmg = (b as unknown as { damage: DamageFn }).damage.bind(b);
  assert.ok(sh.shield > 0);
  const s0 = sh.shield;
  // stun last: a stun gun bolt now drains a whole small shield, after which the others would reach the hull
  for (const m of ['slowbeam', 'disarm', 'stungun']) dmg(sh, 0.01, 1, 1, 0, m, sh.x, sh.y, MODULE_BY_ID.get(m), 1, sh.x, sh.y - 5, 0);
  assert.equal(sh.stun, 0); assert.equal(sh.slow, 0); assert.equal(sh.disarm, 0);
  assert.ok(sh.shield < s0 - 50, 'paralysis drains the shield instead');
  for (let i = 0; i < 50; i++) for (const m of ['stungun', 'slowbeam', 'disarm', 'napalm']) dmg(hd, 0.01, 1, 1, 0, m, hd.x, hd.y, MODULE_BY_ID.get(m), 1, hd.x, hd.y - 5, 0);
  assert.equal(hd.stun, 0); assert.equal(hd.slow, 0); assert.equal(hd.disarm, 0); assert.equal(hd.burning, 0);
});

test('armour damps burning and weight damps knockback', () => {
  const { light, heavy, hit, b } = statusBench();
  const ints = (b as unknown as { ints: { burnDps: number; kbx: number; kby: number }[] }).ints;
  hit(light, 'napalm'); hit(heavy, 'napalm');
  assert.ok(ints[light.id].burnDps > ints[heavy.id].burnDps * 1.5, `burn light ${ints[light.id].burnDps} heavy ${ints[heavy.id].burnDps}`);
  hit(light, 'sonic'); hit(heavy, 'sonic');
  const kb = (i: number) => Math.hypot(ints[i].kbx, ints[i].kby);
  assert.ok(kb(light.id) > kb(heavy.id) * 1.5, `knockback light ${kb(light.id)} heavy ${kb(heavy.id)}`);
});

// ---------------------------------------------------------------- price / 5 (4a9c201)

test('prices are raw cost / 5: supply, upgrades and unit costs share one scale', () => {
  assert.equal(PRICE_DIV, 5);
  assert.equal(START_SUPPLY, 600);
  assert.equal(supplyForRound(1), 600);
  assert.equal(supplyForRound(2), 720);
  let maxCost = 0;
  for (const d of STARTER_DESIGNS) {
    const s = computeStats(d);
    maxCost = Math.max(maxCost, s.cost);
    // a block's price is its squad's unit costs (both on the /5 scale)
    assert.ok(Math.abs(s.cost - s.unitCost * s.squad) < 1e-9, `${d.name}: block ${s.cost} vs ${s.unitCost} x ${s.squad}`);
    // upgrades are 50% / 60% of the (already scaled) price -- not divided by 5 a second time
    assert.ok(Math.abs(upgradeCost(d, 1) - 0.5 * s.cost) <= Math.max(10, s.cost * 0.03), `${d.name} L1->2 ${upgradeCost(d, 1)} of ${s.cost}`);
    assert.ok(Math.abs(upgradeCost(d, 2) - 0.6 * s.cost) <= Math.max(10, s.cost * 0.03), `${d.name} L2->3 ${upgradeCost(d, 2)} of ${s.cost}`);
    assert.ok(s.cost >= 10 && s.cost < 3000, `${d.name} costs ${s.cost}`);
  }
  // the starter titan fits a few rounds of income, as at the old scale (it would be ~5x supply if prices regressed)
  assert.ok(maxCost > 300 && maxCost <= totalSupplyThrough(4), `starter titan ${maxCost}`);
  // the biggest titans are ~2000, not 10 000
  const big = D('bigt', 'citadel', 'megatracks', ['doomsday', 'doomsday', 'annihilator', 'cannon', 'cannon', 'hmg']);
  if (validateDesign(big).length === 0) assert.ok(designCost(big) < 4000, `citadel ${designCost(big)}`);
});

// ---------------------------------------------------------------- shared code stays browser-safe (2f87798)

test('shared code never reads process / process.env (it ships in the browser bundle)', () => {
  const root = path.join(import.meta.dirname, '..', 'src', 'shared');
  const files: string[] = [];
  const walk = (dir: string) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.ts')) files.push(p); } };
  walk(root);
  assert.ok(files.length > 5);
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/\bprocess\s*\.|\brequire\s*\(|from\s+'node:/.test(src), `${path.relative(root, f)} uses a Node-only API`);
  }
});

// ---------------------------------------------------------------- honest footprints / art boxes (cc7d2b5)

test('no chassis art overhangs its footprint, and every mount sits on the hull', () => {
  for (const c of CHASSIS) {
    const fw = c.footprint?.[0] ?? c.size, fh = c.footprint?.[1] ?? c.size;
    const [aw, al] = artBox(c);
    assert.ok(aw <= fw + 1e-9 && al <= fh + 1e-9, `${c.id}: art ${aw}x${al} on footprint ${fw}x${fh}`);
    const offs = mountOffsets(D('m', c.id, 'treads', c.mounts.map(() => null)));
    assert.equal(offs.length, c.mounts.length);
    for (const o of offs) assert.ok(Math.abs(o.x) <= fh / 2 + 1e-9 && Math.abs(o.y) <= fw / 2 + 1e-9, `${c.id}: mount at ${o.x},${o.y} outside ${fw}x${fh}`);
  }
});

// ---------------------------------------------------------------- data: everything the designer allows is sane

test('every chassis / mobility / module the designer allows validates and has finite stats', () => {
  let n = 0;
  for (const c of CHASSIS) for (const m of MOBILITY) {
    if (pairingError(c.id, m.id)) continue;
    for (let i = 0; i < c.mounts.length; i++) for (const mod of MODULES) {
      if (slotError(c, m.id, i, mod)) continue;
      const mounts = c.mounts.map(() => null as string | null);
      mounts[i] = mod.id;
      const d = D('x', c.id, m.id, mounts);
      const errs = validateDesign(d);
      // a legal slot can only fail on weight, or (an armour plate alone) on having nothing to fight with
      assert.ok(errs.every((e) => e.startsWith('Overloaded') || (mod.kind === 'armor' && e.startsWith('Needs at least one'))), `${c.id}/${m.id}/${mod.id}@${i}: ${errs.join('; ')}`);
      if (errs.length) continue;
      const s = computeStats(d);
      for (const [k, v] of Object.entries(s)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${c.id}/${m.id}/${mod.id}: ${k} = ${v}`);
      assert.ok(s.cost >= 10 && s.hp > 0 && (s.isStatic || s.speed > 0), `${c.id}/${m.id}/${mod.id}`);
      n++;
    }
  }
  assert.ok(n > 10000, `only ${n} combos`);
});

// ---------------------------------------------------------------- new bugs found in this pass

test('a long hull nosed into a big emplacement pivots so its rear-mounted short gun reaches (no endless push)', () => {
  // the flamer sits 1.4 cells behind the land-train's centre: in contact nose-first it stayed 0.07 cells out of reach
  // for the rest of the battle, pushing on a hull that can't move
  const train = D('train', 'centipede', 'halftrack', [null, null, 'shieldH', 'flamer']);
  const fort = D('fort', 'leviathan', 'anchor', [null, null, 'flak', null]); // air-only gun: can't shoot back
  assert.deepEqual(validateDesign(train), []);
  assert.deepEqual(validateDesign(fort), []);
  const { b, e } = duel([train, fort], { designId: 'train', kite: false }, { designId: 'fort' }, 20);
  const hp0 = e.hp;
  for (let i = 0; i < 40 * TICK_RATE && !b.done; i++) b.step();
  assert.ok(e.hp < hp0, 'the land-train never got its flamer on the emplacement');
});

test('a battle where nothing can ever happen again ends early, decided like the time cap (cloaked standoff)', () => {
  // two Shade squads (stealth) park at their midline hold lines out of reveal range of each other: they used to idle
  // out the whole 180 s
  const shade = STARTER_DESIGNS.find((d) => d.id === 'starter-shade')!;
  const run = () => {
    const b = new Battle({ seed: 3, sides: [{ designs: [shade], units: [pl(shade.id, { x: 46, y: 2 })] }, { designs: [shade], units: [pl(shade.id, { x: 46, y: 2 })] }] });
    while (!b.done) b.step();
    return b.summary();
  };
  const s = run();
  assert.ok(s.ticks < MAX_TICKS / 2, `ended at ${s.ticks / TICK_RATE}s`);
  assert.equal(s.winner, -1);
  assert.deepEqual(s.survivors, [[1], [1]]);
  assert.deepEqual(run(), s, 'deterministic');
});

test('start delays are not cut short by the quiet-battle end', () => {
  // nothing moves or fires while the only mobile squad waits out its 10 s start delay; it must still get to fight
  const buggy = D('buggy', 'scout', 'wheels', ['mg']), tow = D('tower', 'warden', 'anchor', ['mg', null]);
  const b = new Battle({ seed: 1, sides: [{ designs: [buggy], units: [pl('buggy', { delay: 10 })] }, { designs: [tow], units: [pl('tower')] }] });
  while (!b.done) b.step();
  const s = b.summary();
  assert.ok(s.damageDealt[0] > 0, `ended at ${s.ticks / TICK_RATE}s before the delayed squad fought`);
});

// ---------------------------------------------------------------- pre-rescale saves (5x supply)

function oldMatch(createdAt: number, supply: number, round = 3): MatchState {
  const deck = [STARTER_DESIGNS[0], STARTER_DESIGNS[4]];
  const m = newMatch('old', 'ai', 1, newPlayer('A', deck), newPlayer('B', deck, true), createdAt);
  delete m.rules; // saved before the marker existed
  m.round = round;
  m.players[0].supply = supply;
  m.players[1].supply = supply + 500;
  return m;
}

test('new matches carry the rules version; pre-rescale saves get their supply divided by 5 once', () => {
  assert.equal(newMatch('n', 'ai', 1, newPlayer('A', [STARTER_DESIGNS[0]]), newPlayer('B', [STARTER_DESIGNS[0]], true)).rules, RULES_VERSION);
  // created before the rescale shipped
  const a = oldMatch(PRICE_RESCALE_AT - 86400e3, 4000);
  assert.ok(isPreRescaleMatch(a));
  assert.equal(migrateMatch(a), true);
  assert.deepEqual([a.players[0].supply, a.players[1].supply, a.rules], [800, 900, RULES_VERSION]);
  assert.equal(migrateMatch(a), false, 'idempotent');
  assert.equal(a.players[0].supply, 800);
  // unknown creation time, but more supply than the current rules ever grant through this round
  const b = oldMatch(0, totalSupplyThrough(3) + 10);
  assert.ok(isPreRescaleMatch(b));
  migrateMatch(b);
  assert.ok(b.players[0].supply <= totalSupplyThrough(3) / 4);
  // an unmarked match made after the rescale with plausible supply is only stamped
  const c = oldMatch(PRICE_RESCALE_AT + 1000, 300);
  assert.ok(!isPreRescaleMatch(c));
  assert.equal(migrateMatch(c), true);
  assert.deepEqual([c.players[0].supply, c.players[1].supply, c.rules], [300, 800, RULES_VERSION]);
});

test('server store migrates stale matches on load and persists the marker', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab2-mig-'));
  try {
    const m = oldMatch(PRICE_RESCALE_AT - 1000, 5000);
    m.status = 'deploy';
    const before = m.updatedAt;
    fs.writeFileSync(path.join(dir, 'matches.json'), JSON.stringify({ version: 1, matches: [{ match: m, owners: ['p0', 'p1'], private: false, code: null }] }));
    const s = new Store(dir, 1);
    const log = console.log; console.log = () => {};
    try { s.load(); } finally { console.log = log; }
    const r = s.matches.get('old')!;
    assert.deepEqual([r.match.players[0].supply, r.match.rules], [1000, RULES_VERSION]);
    // clients still holding the pre-migration copy must see a change on their next ?since= poll
    assert.ok(r.match.updatedAt > before, 'a migrated match keeps its old updatedAt');
    s.flush();
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'matches.json'), 'utf8'));
    assert.deepEqual([saved.matches[0].match.players[0].supply, saved.matches[0].match.rules], [1000, RULES_VERSION]);
    // reloading doesn't divide again
    const s2 = new Store(dir, 1);
    s2.load();
    assert.equal(s2.matches.get('old')!.match.players[0].supply, 1000);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('local vs-AI saves: stale supply rescaled on load; stale saves with designs the rules now reject are dropped', async () => {
  const store = new Map<string, string>();
  const g = globalThis as unknown as { localStorage?: unknown };
  const prev = g.localStorage;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) };
  try {
    const { LocalDriver } = await import('../src/client/localdriver.ts');
    const m = oldMatch(PRICE_RESCALE_AT - 1000, 3000);
    m.status = 'deploy';
    store.set('ab2.localMatch', JSON.stringify({ v: 1, difficulty: 'normal', match: m }));
    const s = LocalDriver.loadSaved()!;
    assert.deepEqual([s.match.players[0].supply, s.match.rules], [600, RULES_VERSION]);
    assert.equal(JSON.parse(store.get('ab2.localMatch')!).match.players[0].supply, 600, 'written back');
    assert.equal(LocalDriver.loadSaved()!.match.players[0].supply, 600, 'not divided twice');
    // a stale save whose deck holds a design the current parts rules reject is dropped
    const bad = oldMatch(PRICE_RESCALE_AT - 1000, 3000);
    bad.status = 'deploy';
    bad.players[0].deck.push(D('retired', 'warden', 'treads', ['retiredpart', null]));
    assert.ok(validateDesign(bad.players[0].deck[2]).length > 0);
    store.set('ab2.localMatch', JSON.stringify({ v: 1, difficulty: 'normal', match: bad }));
    assert.equal(LocalDriver.loadSaved(), null);
    assert.equal(store.has('ab2.localMatch'), false);
  } finally { g.localStorage = prev; }
});

test('guns reach a long hull at its box corner (range pre-filters use the box\'s true bounding radius)', () => {
  // the box a range check measures to (0.45 * fw x 0.45 * fh) has corners past 0.45 * longest side; the centre-distance
  // pre-filter used the latter, so a target whose nearest point was a corner was dropped although the gun reached it.
  // A kiter parked at its range edge then sat with no target for the rest of the battle.
  const flame = D('flametower', 'warden', 'anchor', ['flamer', null]);
  const cit = D('cit', 'citadel', 'anchor', [null, null, null, 'flak', null, null]); // 8 x 7 box
  assert.deepEqual(validateDesign(flame), []);
  assert.deepEqual(validateDesign(cit), []);
  const b = new Battle({ seed: 1, sides: [{ designs: [flame, cit], units: [pl('flametower')] }, { designs: [flame, cit], units: [pl('cit')] }] });
  const s = b.units[0], t = b.units.find((u) => u.side === 1)!; // (the cheap flame tower is a 4-squad: its first unit)
  type W = { range: number; ox: number; oy: number };
  const I = (b as unknown as { ints: { wpns: (W | null)[]; hl: number; hw: number }[] }).ints;
  const w = I[0].wpns[0]!, T = I[t.id];
  // mount world position at the shooter's facing; put the citadel's corner 0.8 x range away, diagonally
  const mx = s.x + Math.cos(s.angle) * w.ox - Math.sin(s.angle) * w.oy, my = s.y + Math.sin(s.angle) * w.ox + Math.cos(s.angle) * w.oy;
  t.angle = Math.PI / 2; // long axis (hl) along y, hw across x
  const g = (0.8 * w.range) / Math.SQRT2;
  t.x = mx + g + T.hw; t.y = my - g - T.hl;
  (b as unknown as { rebuildHash(): void }).rebuildHash();
  assert.ok(Math.hypot(t.x - mx, t.y - my) > w.range + hullK(5) * 8, 'set-up: the corner case the old pre-filter missed');
  b.step();
  assert.equal(s.mounts[0].target, t.id, 'the flamer should target the citadel corner 0.8 x range away');
});

// ---------------------------------------------------------------- sim bug pass: quiet end vs long reloads, overkill vs PD

test('a long reload is not a quiet stalemate: two nuke launchers trade shots past the first 20 s cooldown', () => {
  // the quiet end (nothing moved, fired or got hurt for 10 s) cut the duel at ~20 s as a draw, while both 20 s-reload
  // launchers still held a live target and were about to fire again
  const nuker = D('nuker', 'titan', 'anchor', ['tactnuke', null, null, null, null]);
  assert.deepEqual(validateDesign(nuker), []);
  const { b } = duel([nuker], { designId: 'nuker' }, { designId: 'nuker' }, 30);
  while (!b.done) b.step();
  const s = b.summary();
  assert.ok(s.ticks > 30 * TICK_RATE, `ended at ${s.ticks / TICK_RATE}s after one exchange`);
  assert.ok(s.damageDealt[0] > 2 * 2190 && s.damageDealt[1] > 2 * 2190, `only ${s.damageDealt} damage traded`);
  assert.notEqual(s.winner, -1);
});

test('overkill prevention does not let one point-defense laser swat a whole missile squad one shot at a time', () => {
  // with the target "doomed" by the one missile in the air, all 16 launchers held fire; the PD shot each lone missile
  // down, so the squad never finished a nearly dead target
  const hunter = D('hunter', 'raider', 'legs', ['atgm', 'atgm']);
  const fort = D('fort', 'bastion', 'anchor', ['pointdef', 'plateH', null]);
  assert.deepEqual(validateDesign(hunter), []);
  assert.deepEqual(validateDesign(fort), []);
  for (const dx of [3, 9, 11]) {
    const b = new Battle({ seed: 1, sides: [{ designs: [hunter, fort], units: [pl('hunter', { kite: false, stance: 'holdPos' }), pl('hunter', { uid: 2, x: 44, kite: false, stance: 'holdPos' })] }, { designs: [hunter, fort], units: [pl('fort')] }] });
    // two squads of hunters (squads size by unit price) vs the fort
    const k = b.units[0], e = b.units[b.units.length - 1];
    assert.equal(b.units.length, 2 * computeStats(hunter).squad + 1);
    e.x = k.x + dx; e.y = k.y - 10; e.angle = Math.PI / 2;
    (b as unknown as { rebuildHash(): void }).rebuildHash();
    for (let i = 0; i < 30 * TICK_RATE && !b.done; i++) b.step(); // ATGMs reload in 8 s
    assert.equal(e.alive, false, `dx ${dx}: the PD fort survived 30 s of 16 ATGM launchers at ${e.hp.toFixed(1)} hp`);
  }
});

test('a fire-on-move walker with a gun and a melee weapon closes to contact and swings (not parked at 70% gun range)', () => {
  // the fire-on-move "hold at 70% of range" stop ignored that a melee weapon needs contact: legs / titan-legs hulls
  // with a gun plus a buzzsaw or titan fist parked out of reach and never swung (treads closed in fine)
  const walker = D('sawwalker', 'strider', 'legs', ['autocannon', 'buzzsaw', null]);
  const wall = D('sawwall', 'bastion', 'anchor', ['flak', 'plateM', 'plateM']); // air-only gun: can't shoot back
  assert.deepEqual(validateDesign(walker), []);
  assert.deepEqual(validateDesign(wall), []);
  const { b, k } = duel([walker, wall], { designId: 'sawwalker', kite: false }, { designId: 'sawwall' }, 20);
  let swings = 0;
  for (let i = 0; i < 40 * TICK_RATE && !b.done; i++) {
    b.step();
    for (const ev of b.events) if (ev.t === 'fire' && ev.unit === k.id && ev.mount === 1) swings++;
  }
  assert.ok(swings > 0, 'the buzzsaw never swung');
});

test('a fire-on-move titan whose guns sit behind its centre keeps closing until one reaches (no park with nothing in range)', () => {
  // the 70% stop is measured from the hull centre, ranges from the mounts: this layout puts the laser 2.5 cells aft,
  // so the walker parked at 70% of the laser's range with every gun out of reach and never fired
  const titan = D('reartitan', 'titan', 'titanlegs', ['shotgun', 'twinmg', 'shotgun', 'laser', 'mg']);
  const wall = D('rearwall', 'bastion', 'anchor', ['flak', 'plateM', 'plateM']); // air-only gun: can't shoot back
  assert.deepEqual(validateDesign(titan), []);
  const { b, k, e } = duel([titan, wall], { designId: 'reartitan', kite: false }, { designId: 'rearwall' }, 25);
  let shots = 0;
  for (let i = 0; i < 40 * TICK_RATE && !b.done; i++) {
    b.step();
    for (const ev of b.events) if (ev.t === 'fire' && ev.unit === k.id) shots++;
  }
  assert.ok(shots > 0 && e.hp < e.maxHp, 'the titan never fired');
});

test('the contact pivot swings a gun that can fire at contact range, not a longer one held back by its minimum range', () => {
  // same nose-in as the land-train test above, plus a howitzer: the pivot picked the longest-ranged gun (the howitzer,
  // mounted near the centre, so no pivot at all), although its 8-cell minimum range never lets it fire there
  const train = D('trainH', 'centipede', 'halftrack', ['howitzer', null, 'shieldH', 'flamer']);
  const fort = D('fort', 'leviathan', 'anchor', [null, null, 'flak', null]);
  assert.deepEqual(validateDesign(train), []);
  const { b, k } = duel([train, fort], { designId: 'trainH', kite: false, focus: false }, { designId: 'fort' }, 20);
  let flames = 0;
  for (let i = 0; i < 40 * TICK_RATE && !b.done; i++) {
    b.step();
    for (const ev of b.events) if (ev.t === 'fire' && ev.unit === k.id && ev.mount === 3) flames++;
  }
  assert.ok(flames > 0, 'the rear flamer never got on the emplacement');
});

test('blocks that escort each other (A -> B, B -> A) fight normally instead of huddling for the whole battle', () => {
  const bul = STARTER_DESIGNS.find((d) => d.id === 'starter-bulwark')!, tb = STARTER_DESIGNS.find((d) => d.id === 'starter-tankbuster')!;
  const designs = [bul, tb];
  const b = new Battle({ seed: 3, sides: [
    { designs, units: [pl(bul.id, { uid: 1, x: 30, y: 2, escort: 2 }), pl(tb.id, { uid: 2, x: 50, y: 2, escort: 1 })] },
    { designs, units: [pl(bul.id, { uid: 1, x: 40, y: 2, stance: 'holdPos' }), pl(tb.id, { uid: 2, x: 60, y: 2, stance: 'holdPos' })] },
  ] });
  while (!b.done) b.step();
  const s = b.summary();
  assert.ok(s.damageDealt[0] > 0, `the escort pair never engaged (battle ended at ${s.ticks / TICK_RATE}s)`);
});

// ---------------------------------------------------------------- bug-fix pass: sim / server / rules

test('server input checks accept every legal design: the 10-mount superfortress, a full board of upgrades', async () => {
  const { sanitizeDeck, sanitizeGarage, sanitizeAction } = await import('../src/server/validate.ts');
  const sf = D('sf', 'superfortress', 'jet', ['bombs', 'bombs', 'bombs', 'bombs', 'bombs', 'bombs', 'mg', 'mg', null, null]);
  assert.deepEqual(validateDesign(sf), []);
  // the server used to cap mount lists at 8: a deck with one was a 400, and a garage with one failed to sync at all
  assert.equal(sanitizeDeck([sf])[0].mounts.length, 10);
  assert.deepEqual(sanitizeGarage({ designs: [sf], deck: ['sf'] }).deck, ['sf']);
  assert.throws(() => sanitizeDeck([{ ...sf, mounts: [...sf.mounts, null] }]), /mounts/);
  // validateDeploy takes a level-up for every block on the board in one turn (60 blocks x 2 levels)
  const upgrade = Array.from({ length: 120 }, (_, i) => 1 + (i % 60));
  assert.equal(sanitizeAction({ round: 3, place: [], upgrade }).upgrade.length, 120);
});

test('a jet on hold position circles over its post (it used to hang motionless in mid-air), and circling is no activity', () => {
  const jet = D('jet', 'interceptor', 'jet', ['mg', 'mg']), tank = D('tank', 'warden', 'treads', ['autocannon', null]);
  const arty = D('arty', 'longarm', 'halftrack', ['howitzer']);
  // out of each other's reach: the jets circle their post, and the battle ends as a quiet standoff (not after 180 s)
  const b = new Battle({ seed: 1, sides: [{ designs: [jet], units: [pl('jet', { x: 40, y: 10, stance: 'holdPos' })] }, { designs: [tank], units: [pl('tank', { x: 50, y: 10, stance: 'holdPos' })] }] });
  const jets = b.units.filter((u) => u.side === 0), start = jets.map((u) => ({ x: u.x, y: u.y }));
  let minStep = Infinity;
  for (let t = 0; t < 5 * TICK_RATE; t++) {
    const before = jets.map((u) => ({ x: u.x, y: u.y }));
    b.step();
    jets.forEach((u, i) => { minStep = Math.min(minStep, Math.hypot(u.x - before[i].x, u.y - before[i].y)); });
  }
  assert.ok(minStep > 0.05, `a holdPos jet stood still in the air (step ${minStep})`);
  jets.forEach((u, i) => assert.ok(Math.hypot(u.x - start[i].x, u.y - start[i].y) < 12, 'a holdPos jet left its post'));
  while (!b.done) b.step();
  assert.ok(b.tick < 20 * TICK_RATE, `circling holdPos jets kept a dead standoff going (${b.tick / TICK_RATE}s)`);
  // likewise jets circling the parked unit they escort
  const e = new Battle({ seed: 1, sides: [{ designs: [jet, arty], units: [pl('arty', { x: 40, y: 18, stance: 'holdPos' }), pl('jet', { uid: 2, x: 10, y: 10, escort: 1 })] }, { designs: [tank], units: [pl('tank', { x: 50, y: 10, stance: 'holdPos' })] }] });
  while (!e.done) e.step();
  assert.ok(e.tick < 20 * TICK_RATE, `jets orbiting their charge kept a dead standoff going (${e.tick / TICK_RATE}s)`);
  // a jet waiting out a start delay circles too
  const d = new Battle({ seed: 1, sides: [{ designs: [jet], units: [pl('jet', { x: 40, y: 10, delay: 6 })] }, { designs: [tank], units: [pl('tank', { x: 50, y: 10 })] }] });
  const dj = d.units[0], x0 = dj.x, y0 = dj.y;
  for (let t = 0; t < 2 * TICK_RATE; t++) d.step();
  assert.ok(Math.hypot(dj.x - x0, dj.y - y0) > 0.5 && dj.moving, 'a jet hung still in the air during its start delay');
});

test('a squad of long hulls holding formation keeps its deployed spacing in the fight, like round hulls', () => {
  const needle = D('needle', 'mantis', 'legs', ['mg', 'mg']), wall = D('wall', 'bastion', 'anchor', ['plateH', 'plateH', 'repairM']);
  assert.equal(computeStats(needle).squad, 4);
  assert.notEqual(computeStats(needle).fw, computeStats(needle).fh);
  const b = new Battle({ seed: 1, sides: [{ designs: [needle], units: [pl('needle', { y: 2, spacing: 2, hold: true })] }, { designs: [wall], units: [pl('wall', { y: 2 })] }] });
  for (let t = 0; t < 30 * TICK_RATE && !b.done; t++) b.step();
  const sq = b.units.filter((u) => u.side === 0 && u.alive);
  let min = Infinity;
  for (let i = 0; i < sq.length; i++) for (let j = i + 1; j < sq.length; j++) min = Math.min(min, Math.hypot(sq[i].x - sq[j].x, sq[i].y - sq[j].y));
  // formation pitch 1 + 2 cells; separation keeps 95% of it (capped at 2.9) -- they used to close up to ~1 cell
  assert.ok(sq.length === 4 && min > 2.5, `the holding squad closed up to ${min.toFixed(2)} cells`);
});

test('a slow titan deployed behind a long row of its own emplacements works its way round (no rocking in place)', () => {
  const titan = D('titan', 'titan', 'megatracks', ['ac40', 'ac40', 'autocannon', 'autocannon', 'autocannon']);
  const post = D('post', 'hunter', 'anchor', ['twinlaser', 'mg']), tank = D('tank', 'warden', 'treads', ['autocannon', null]);
  const foe = D('foe', 'warden', 'treads', ['autocannon', null]);
  // a 12-cell wall of emplacements right in front of a 7-cell titan, a tank behind it: it has to slide ~8 cells sideways,
  // which takes longer than the 1.5 s the dodge used to keep its side before flipping (it rocked in place for a minute)
  const posts = Array.from({ length: 6 }, (_, i) => pl('post', { uid: 10 + i, x: 64 + i * 2, y: 0 }));
  const b = new Battle({ seed: 11, sides: [
    { designs: [titan, post, tank], units: [pl('titan', { uid: 1, x: 67, y: 2 }), pl('tank', { uid: 2, x: 69, y: 10 }), ...posts] },
    { designs: [foe], units: [pl('foe', { x: 40, y: 20, stance: 'holdPos' })] },
  ] });
  const t = b.units[0], rowY = b.units.find((u) => u.design.id === 'post')!.y;
  let k = 0;
  while (!b.done && t.y > rowY - 5 && k < 60 * TICK_RATE) { b.step(); k++; }
  assert.ok(k < 35 * TICK_RATE, `the titan took ${k / TICK_RATE}s to get past its own emplacements`);
});

test('a charging unit with a gun and a melee weapon closes to contact and swings (not parked at 40% gun range)', () => {
  const brute = D('brute', 'warlord', 'spider', ['mortar', 'buzzsaw', 'buzzsaw', null]), wall = D('wall', 'bastion', 'anchor', ['plateH', 'plateH', 'repairM']);
  const b = new Battle({ seed: 1, sides: [{ designs: [brute], units: [pl('brute', { y: 2, stance: 'charge' })] }, { designs: [wall], units: [pl('wall', { y: 2 })] }] });
  let swings = 0;
  for (let t = 0; t < 60 * TICK_RATE && !b.done; t++) {
    b.step();
    for (const ev of b.events) if (ev.t === 'hit' && ev.moduleId === 'buzzsaw') swings++;
  }
  assert.ok(swings > 0, 'the charging brute never got its buzzsaws on the target');
});
