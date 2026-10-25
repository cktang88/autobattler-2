// Weapon niches (the weapon pass): every weapon has a clear job, and the numbers that make it so stay pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/shared/sim/battle.ts';
import { TICK_RATE } from '../src/shared/sim/types.ts';
import { blockDims, DEPLOY_D, DEPLOY_W, rectsOverlap } from '../src/shared/grid.ts';
import { MODULE_BY_ID, MODULES } from '../src/shared/parts.ts';
import { burstOf, computeStats, loadTurnFactor, validateDesign, weaponDps, weaponValue } from '../src/shared/stats.ts';
import { STARTER_DESIGNS } from '../src/shared/starters.ts';
import type { Design, Placement } from '../src/shared/types.ts';

const W = (id: string) => MODULE_BY_ID.get(id)!;
const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id, chassis, mobility, mounts });
const starter = (id: string) => STARTER_DESIGNS.find((d) => d.id === `starter-${id}`)!;

/** blocks of `list` packed row by row into the deploy zone */
function pack(list: Design[]): Placement[] {
  const out: Placement[] = []; const occ: { x: number; y: number; w: number; h: number }[] = []; let uid = 1;
  for (const d of list) {
    const { w, h } = blockDims(computeStats(d), 1);
    let placed = false;
    for (let y = 0; y + h <= DEPLOY_D && !placed; y++) for (let x = 0; x + w <= DEPLOY_W && !placed; x++) {
      if (occ.some((o) => rectsOverlap(x, y, w, h, o.x, o.y, o.w, o.h))) continue;
      occ.push({ x, y, w, h }); out.push({ uid: uid++, designId: d.id, x, y, level: 1, round: 1, spacing: 1 }); placed = true;
    }
  }
  return out;
}
/** Equal-supply margin of `a` vs `b` (role-check style: surviving share of own supply minus theirs, both sides of the
 *  field, `seeds` seeds): +1 = a won without a scratch, -1 = a wiped out for nothing. `ratio`: b gets that many times
 *  a's supply (dedicated AA crushes an equal supply of any air, so AA comparisons give the air side more). */
function margin(a0: Design, b0: Design, budget: number, seeds = 3, ratio = 1): number {
  const a = { ...a0, id: 'mA' }, b = { ...b0, id: 'mB' };
  const ca = computeStats(a).cost, cb = computeStats(b).cost;
  const T = Math.max(budget, ca, cb);
  const na = Math.max(1, Math.round(T / ca)), nb = Math.max(1, Math.round((T * ratio) / cb));
  const spend = [na * ca, nb * cb];
  let m = 0, n = 0;
  for (let k = 0; k < seeds; k++) for (const side of [0, 1] as const) {
    const mine = { designs: [a], units: pack(Array(na).fill(a)) }, theirs = { designs: [b], units: pack(Array(nb).fill(b)) };
    const bt = new Battle({ seed: 1 + k * 7 + side, sides: side === 0 ? [mine, theirs] : [theirs, mine] });
    while (!bt.done) bt.step();
    const left = [0, 0];
    for (const u of bt.units) if (u.alive) left[u.side === side ? 0 : 1] += (u.hp / u.maxHp) * u.stats.unitCost;
    m += left[0] / spend[0] - left[1] / spend[1]; n++;
  }
  return m / n;
}

test('howitzer vs barrage: the howitzer outranges and out-alphas it, the barrage beats it against swarms', () => {
  const how = W('howitzer'), bar = W('barrage');
  assert.ok(how.range! >= bar.range! + 10, `reach ${how.range} vs ${bar.range}`);
  assert.ok(burstOf(how).damage > 1.5 * burstOf(bar).damage, `alpha ${burstOf(how).damage} vs ${burstOf(bar).damage}`);
  assert.ok((how.splashEdge ?? 0) > 0.5 && how.spinal != null, 'one flat-blast shell from a fixed, hull-aimed gun');
  assert.ok(weaponDps(bar) > 1.25 * weaponDps(how) && bar.cooldown! < 0.5 * how.cooldown!, 'the barrage is the rapid one');
  const swarm = D('swarm16', 'scout', 'wheels', ['shotgun']); // a 16-unit light swarm
  const hm = margin(D('how', 'warden', 'treads', ['howitzer', 'plateL']), swarm, 700);
  const bm = margin(D('bar', 'warden', 'treads', ['barrage', 'plateL']), swarm, 700);
  assert.equal(computeStats(swarm).squad, 16);
  assert.ok(bm > hm + 0.2, `vs a light swarm: barrage ${bm.toFixed(2)} vs howitzer ${hm.toFixed(2)}`);
});

test('mg vs Suppressor: the 7.62 mm outranges and outdamages it; the Suppressor pins', () => {
  const mg = W('mg'), sup = W('twinmg');
  assert.ok(mg.range! > sup.range! + 1.5, `${mg.range} vs ${sup.range}`);
  assert.ok((mg.spread ?? 0) < (sup.spread ?? 0), 'the mg is the accurate one');
  assert.ok(weaponDps(mg) > weaponDps(sup), `dps ${weaponDps(mg)} vs ${weaponDps(sup)}`);
  assert.ok((sup.slow ?? 0) > 0 && !mg.slow, 'only the Suppressor slows');
});

test('clip weapons: a burst of at least 150 damage delivered within 1.5 s, sustained dps well below the burst rate', () => {
  const clips = MODULES.filter((m) => m.kind === 'weapon' && m.magazine && m.reload && !m.resupply);
  assert.ok(clips.length >= 7, clips.map((m) => m.id).join(','));
  for (const m of clips) {
    const b = burstOf(m);
    assert.ok(b.damage >= 150, `${m.id}: burst ${b.damage}`);
    assert.ok(b.time <= 1.5, `${m.id}: burst takes ${b.time} s`);
    assert.ok(b.reload >= 2.5 * Math.max(0.4, b.time), `${m.id}: reload ${b.reload} s vs ${b.time} s to empty`);
    assert.ok(weaponDps(m) < 0.6 * (b.damage / Math.max(0.5, b.time)), `${m.id}: sustained ${weaponDps(m)} vs burst rate`);
  }
});

test('grenade clip: one magazine wrecks a packed light cluster', () => {
  const gl = D('gl', 'raider', 'halftrack', ['grenade', null]);
  const cl = D('cl', 'scout', 'halftrack', ['flamer']); // a 16-scout torch squad (5-cell flamers: they can't reach it)
  assert.deepEqual(validateDesign(gl), []);
  const designs = [gl, cl];
  const b = new Battle({ seed: 2, sides: [{ designs, units: [{ uid: 1, designId: 'gl', x: 20, y: 2, level: 1, round: 1, stance: 'holdPos' }] }, { designs, units: [{ uid: 1, designId: 'cl', x: 20, y: 2, level: 1, round: 1, stance: 'holdPos', spacing: 0 }] }] });
  const me = b.units.find((u) => u.side === 0)!;
  const foes = b.units.filter((u) => u.side === 1);
  // park the squad of 16 unarmed scouts as a tight cluster 8 cells in front of the launcher
  const fwd = me.y > foes[0].y ? -1 : 1;
  foes.forEach((u, i) => { u.x = me.x - 1.5 + (i % 4); u.y = me.y + fwd * (8 + Math.floor(i / 4)); });
  (b as unknown as { rebuildHash(): void }).rebuildHash();
  const hp0 = foes.reduce((a, u) => a + u.hp, 0);
  let t0 = -1;
  for (let i = 0; i < 10 * TICK_RATE && !b.done; i++) {
    b.step();
    if (t0 < 0 && b.events.some((e) => e.t === 'fire' && e.unit === me.id)) t0 = i;
    if (t0 >= 0 && i > t0 + 2.5 * TICK_RATE) break; // one magazine (4 rounds in 1.35 s) plus flight time
  }
  const dealt = hp0 - foes.reduce((a, u) => a + (u.alive ? u.hp : 0), 0);
  const dead = foes.filter((u) => !u.alive).length;
  assert.ok(t0 >= 0, 'fired');
  assert.ok(dealt > 1.5 * burstOf(W('grenade')).damage, `splash across the cluster: ${dealt.toFixed(0)} damage from one clip`);
  assert.ok(dead >= 1, `kills from one clip: ${dead}`);
});

test('fixed-arc (spinal) guns commit: a target off to the side takes far longer to engage than with a turret', () => {
  const how = W('howitzer');
  const spinal = how.spinal;
  const firstShot = (): number => {
    const a = D('howtank', 'warden', 'treads', ['howitzer', 'plateL']), t = D('target', 'bastion', 'treads', ['plateH', 'plateM', 'cannon']); // its 10-cell gun can't reach back
    const designs = [a, t];
    const b = new Battle({ seed: 1, sides: [{ designs, units: [{ uid: 1, designId: 'howtank', x: 40, y: 2, level: 1, round: 1, stance: 'holdPos' }] }, { designs, units: [{ uid: 1, designId: 'target', x: 40, y: 2, level: 1, round: 1, stance: 'holdPos' }] }] });
    const me = b.units[0], tg = b.units.find((u) => u.side === 1)!;
    // the flanker: off the howitzer's quarter, well inside its reach and outside its minimum range
    me.x = 40; me.y = 46; me.angle = -Math.PI / 2; tg.x = 40 + 19; tg.y = 46 + 11; tg.hp = tg.maxHp = 1e6; // 120 degrees off the bow
    me.mounts[0].cooldown = 0; // loaded: only the aiming counts
    (b as unknown as { rebuildHash(): void }).rebuildHash();
    for (let i = 0; i < 20 * TICK_RATE; i++) { b.step(); if (b.events.some((e) => e.t === 'fire' && e.unit === me.id)) return i / TICK_RATE; }
    return Infinity;
  };
  const fixed = firstShot();
  try { delete (how as { spinal?: number }).spinal; (how as { turretTurn?: number }).turretTurn = 1.6; } finally { /* restored below */ }
  let turret: number;
  try { turret = firstShot(); } finally { how.spinal = spinal; delete (how as { turretTurn?: number }).turretTurn; }
  assert.ok(Number.isFinite(fixed), 'the hull swings round and the spinal gun fires in the end');
  assert.ok(fixed > turret + 0.5, `first shot at a flanker: spinal ${fixed.toFixed(2)} s vs turret ${turret.toFixed(2)} s`);
});

test('stun bomb: paralyses a clustered light squad, never past the stun cap', () => {
  const bomber = D('stunner', 'strikejet', 'jet', ['stunbomb', null, null]);
  const sq = D('sq', 'scout', 'halftrack', ['flamer']); // 16 ground-only scouts: they can't shoot back at the jet
  assert.deepEqual(validateDesign(bomber), []);
  const designs = [bomber, sq];
  const b = new Battle({ seed: 4, sides: [{ designs, units: [{ uid: 1, designId: 'stunner', x: 20, y: 2, level: 1, round: 1 }] }, { designs, units: [{ uid: 1, designId: 'sq', x: 20, y: 2, level: 1, round: 1, stance: 'holdPos', spacing: 0 }] }] });
  const foes = b.units.filter((u) => u.side === 1);
  let most = 0, maxStun = 0;
  for (let i = 0; i < 30 * TICK_RATE && !b.done; i++) {
    b.step();
    const stunned = foes.filter((u) => u.alive && u.stun > 0).length;
    most = Math.max(most, stunned);
    for (const u of foes) maxStun = Math.max(maxStun, u.stun);
  }
  assert.ok(most >= 4, `scouts paralysed at once: ${most}`);
  assert.ok(maxStun <= 4 + 1e-6, `stun capped at 4 s: ${maxStun.toFixed(2)}`);
  // control, not damage: far less killing power than the iron bombs it replaces
  assert.ok(weaponDps(W('stunbomb')) < 0.25 * weaponDps(W('bombs')));
});

test('flak is the long-range air-swarm answer: beats the same supply of AA missiles against a drone swarm', () => {
  const flak = W('flak');
  for (const id of ['mg', 'laser', 'aamissile', 'quad20']) assert.ok(flak.range! > W(id).range!, `flak outranges ${id}`);
  assert.ok((flak.proximity ?? 0) > 0, 'proximity fuse');
  const drones = D('sgdrone', 'drone', 'rotor', ['shotgun']); // a 16-strong drone swarm
  // equal supply on the AA side; the swarm gets 4x (at 1:1 any dedicated AA wipes it without loss)
  assert.equal(computeStats(drones).squad, 16);
  const fm = margin(D('fk', 'warden', 'treads', ['flak', 'plateL']), drones, 800, 2, 4);
  const am = margin(D('am', 'raider', 'halftrack', ['aamissile', 'aamissile']), drones, 800, 2, 4);
  assert.ok(fm > am + 0.3, `vs a drone swarm: flak ${fm.toFixed(2)} vs AA missiles ${am.toFixed(2)}`);
  // and the heavy single bomber is the missiles' job: they beat flak against strato bombers
  const strato = D('strato', 'stratobomber', 'jet', ['bombs', 'bombs', null, 'shieldL']);
  const fb = margin(D('fk', 'warden', 'treads', ['flak', 'plateL']), strato, 800, 2, 2.5);
  const ab = margin(D('am', 'raider', 'halftrack', ['aamissile', 'aamissile']), strato, 800, 2, 2.5);
  assert.ok(ab > fb + 0.2, `vs strato bombers: AA missiles ${ab.toFixed(2)} vs flak ${fb.toFixed(2)}`);
});

test('rails hit aircraft at a penalty; the pulse laser is a dual-role gun, not an AA specialist', () => {
  for (const id of ['railgun', 'lightrail']) assert.ok((W(id).airBonus ?? 1) < 1, id);
  assert.ok((W('laser').airBonus ?? 1) < (W('flak').airBonus ?? 1));
  assert.ok((W('aamissile').airBonus ?? 1) > (W('laser').airBonus ?? 1));
});

test('load: a light build turns faster than a heavy one, an overloaded one slower than at capacity', () => {
  assert.ok(loadTurnFactor(0.3) > 1.1 && loadTurnFactor(1) === 1 && loadTurnFactor(1.3) < 0.7);
  const light = computeStats(D('l', 'warden', 'halftrack', ['mg' as string, null]));
  const heavy = computeStats(D('h', 'warden', 'halftrack', ['twin120', 'hmg']));
  assert.ok(light.load < heavy.load);
  assert.ok(light.turn > heavy.turn * 1.1, `turn ${light.turn.toFixed(2)} vs ${heavy.turn.toFixed(2)}`);
  for (const [lo, hi] of [[0.2, 0.8], [0.8, 1], [1, 1.2], [1.2, 1.5]]) assert.ok(loadTurnFactor(lo) > loadTurnFactor(hi), `${lo} vs ${hi}`);
});

test('price model: slow shells, dead zones and fixed arcs cost value; a flat blast and a proximity fuse add it', () => {
  const how = W('howitzer');
  const v = (patch: object) => weaponValue({ ...how, ...patch });
  assert.ok(v({ projectileSpeed: 9 }) < v({ projectileSpeed: 16 }) * 0.95, 'slow shells dodge');
  assert.ok(v({ minRange: 18 }) < v({ minRange: 6 }), 'a bigger dead zone');
  assert.ok(v({ spinal: 0.35 }) < v({ spinal: undefined }), 'fixed arc');
  assert.ok(v({ splashEdge: 0.6 }) > v({ splashEdge: 0.3 }), 'flat blast');
  const flak = W('flak');
  assert.ok(weaponValue(flak) > weaponValue({ ...flak, proximity: undefined }), 'proximity fuse');
});
