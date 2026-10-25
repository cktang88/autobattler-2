// Drive identities: speed, turning, reverse, pivot / arc / omni handling, hover immunities (sim steer, fires, splash).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle, HOVER_SPLASH } from '../src/shared/sim/battle.ts';
import { DT } from '../src/shared/sim/types.ts';
import { SQUAD_TIERS, computeStats } from '../src/shared/stats.ts';
import type { Design, Placement } from '../src/shared/types.ts';
import type { SimUnit } from '../src/shared/sim/types.ts';

// single medium units (no squads), so each placement is one unit
SQUAD_TIERS[2] = [[Infinity, 1]];

const D = (id: string, mobility: string, mounts: (string | null)[] = ['autocannon', null]): Design => ({ id, name: id, chassis: 'warden', mobility, mounts });
const DRIVES = ['wheels', 'halftrack', 'treads', 'legs', 'spider', 'hover', 'jumpjets'];
const DESIGNS: Design[] = [...DRIVES.map((m) => D(m, m)), D('dummy', 'halftrack')];

interface Int { u: SimUnit; lvx: number; lvy: number }
type Steer = (I: Int, gx: number, gy: number, stop: number, goal: number) => void;

let uid = 1;
const P = (designId: string, x: number, y: number): Placement => ({ uid: uid++, designId, x, y, level: 1, round: 1 });

/** one unit of `id` on side 0 (far from everything), a dummy enemy far away on side 1 */
function rig(ids: string[]) {
  const b = new Battle({ seed: 1, sides: [{ designs: DESIGNS, units: ids.map((id, i) => P(id, 4 + i * 14, 2)) }, { designs: DESIGNS, units: [P('dummy', 4, 2)] }] });
  const bb = b as unknown as { ints: Int[]; steer: Steer; fires: unknown[]; updateFires(): void; splash(...a: unknown[]): void; groundBurst: boolean };
  const ints = bb.ints;
  /** drive unit k toward (dx, dy) relative to where it started, for `secs`; returns displacement and heading */
  const drive = (k: number, angle: number, dx: number, dy: number, secs: number, goal = -1, keep = false) => {
    const I = ints[k], u = I.u;
    if (!keep) { u.angle = angle; I.lvx = 0; I.lvy = 0; }
    const x0 = u.x, y0 = u.y, gx = x0 + dx, gy = y0 + dy;
    for (let t = 0; t < Math.round(secs / DT); t++) {
      const px = u.x, py = u.y;
      bb.steer(I, gx, gy, 0, goal);
      I.lvx = (u.x - px) / DT; I.lvy = (u.y - py) / DT;
    }
    const mx = u.x - x0, my = u.y - y0;
    return { dist: Math.hypot(mx, my), mx, my, angle: u.angle };
  };
  return { b, bb, ints, drive };
}

test('drive stats: wheels fastest on the ground and quickest to turn, legs much slower, treads slowest to turn', () => {
  const s = Object.fromEntries(DRIVES.map((m) => [m, computeStats(D(m, m))]));
  assert.ok(s.wheels.speed > s.hover.speed && s.hover.speed > s.halftrack.speed, 'wheels > hover > halftrack');
  assert.ok(s.wheels.speed > 2.5 * s.legs.speed, `wheels ${s.wheels.speed} vs legs ${s.legs.speed}`);
  assert.ok(s.spider.speed < s.legs.speed, 'spider is the slowest small walker');
  for (const m of DRIVES) if (m !== 'wheels') assert.ok(s.wheels.turn > s[m].turn, `wheels turn best (vs ${m})`);
  for (const m of DRIVES) if (m !== 'treads') assert.ok(s.treads.turn < s[m].turn, `treads turn slowest (vs ${m})`);
  assert.equal(s.wheels.reverse, 0.5);
  assert.equal(s.spider.reverse, 1);
  assert.equal(s.hover.reverse, 1);
  assert.ok(s.treads.traits.includes('pivot') && s.spider.traits.includes('omni') && s.hover.traits.includes('hover'));
});

test('wheels outrun legs', () => {
  const { drive } = rig(['wheels', 'legs']);
  const w = drive(0, Math.PI / 2, 0, 40, 3), l = drive(1, Math.PI / 2, 0, 40, 3);
  assert.ok(w.dist > 2.5 * l.dist, `wheels ${w.dist.toFixed(1)} vs legs ${l.dist.toFixed(1)} cells in 3 s`);
});

test('treads turn far slower than wheels, and pivot on the spot while wheels roll through the turn', () => {
  const { drive } = rig(['wheels', 'treads']);
  // a far goal straight behind: both turn round to face it
  const w = drive(0, 0, -30, 0.01, 0.5), t = drive(1, 0, -30, 0.01, 0.5);
  assert.ok(Math.abs(w.angle) > 2.5 * Math.abs(t.angle), `turned ${w.angle.toFixed(2)} vs ${t.angle.toFixed(2)} rad in 0.5 s`);
  assert.ok(w.dist > 0.3, `wheels keep rolling through the turn: ${w.dist.toFixed(2)}`);
  assert.ok(t.dist < 1e-9, `treads pivot in place: ${t.dist}`);
});

test('reverse: wheels back up at half speed, spider and hover at full speed', () => {
  for (const [id, lo, hi] of [['wheels', 0.4, 0.6], ['halftrack', 0.5, 0.7], ['spider', 0.95, 1.05], ['hover', 0.95, 1.05]] as const) {
    const { drive } = rig([id, id]);
    // a short move straight behind the nose (a kiting step) vs the same move straight ahead
    const back = drive(0, 0, -3.9, 0, 0.4), fwd = drive(1, 0, 3.9, 0, 0.4);
    assert.ok(back.mx < 0, `${id} moved backward`);
    assert.ok(Math.cos(back.angle) > 1 - 1e-9, `${id} kept its nose pointing forward while backing up: ${back.angle}`);
    const r = back.dist / fwd.dist;
    assert.ok(r > lo && r < hi, `${id}: reverse / forward = ${r.toFixed(2)}`);
  }
});

test('a long move behind the unit turns it round instead of reversing all the way', () => {
  const { drive } = rig(['wheels']);
  const r = drive(0, 0, -30, 0, 3);
  assert.ok(Math.abs(Math.abs(r.angle) - Math.PI) < 0.05, `faces the move: ${r.angle.toFixed(2)}`);
  assert.ok(r.dist > 8, `and drives it at speed: ${r.dist.toFixed(1)}`);
});

test('spider walks sideways at full speed without turning', () => {
  const { drive } = rig(['spider', 'spider']);
  const side = drive(0, 0, 0, 3.9, 0.6), fwd = drive(1, 0, 3.9, 0, 0.6);
  assert.equal(side.angle, 0, 'no turn');
  assert.ok(side.my > 0 && Math.abs(side.mx) < 1e-9, `moved straight sideways: ${side.mx}, ${side.my}`);
  assert.ok(Math.abs(side.dist / fwd.dist - 1) < 0.02, `full speed: ${side.dist.toFixed(2)} vs ${fwd.dist.toFixed(2)}`);
  // a halftrack has to turn to go sideways
  const { drive: d2 } = rig(['halftrack']);
  assert.ok(Math.abs(d2(0, 0, 0, 3.9, 0.6).angle) > 0.5);
});

test('hover: drifts through a turn (its velocity lags its heading), a halftrack does not', () => {
  for (const [id, drifts] of [['hover', true], ['halftrack', false]] as const) {
    const { drive } = rig([id]);
    drive(0, 0, 40, 0, 1.5); // up to speed heading +x
    // then a far goal off to the left: the first 0.2 s still slide along the old course
    const r = drive(0, NaN, 0, 40, 0.2, -1, true);
    assert.equal(r.mx > 0.25, drifts, `${id}: ${r.mx.toFixed(2)} cells on along the old course`);
  }
});

test('hover floats over burning ground and takes half damage from ground bursts (direct hits unchanged)', () => {
  const { bb, ints } = rig(['hover', 'wheels']);
  const [H, W] = [ints[0].u, ints[1].u];
  const enemy = 1;
  for (const u of [H, W]) bb.fires.push({ x: u.x, y: u.y, r: 2, t: 5, dps: 40, side: enemy, src: -1, moduleId: 'firebomb', pulse: 0, rad: false });
  bb.updateFires();
  assert.equal(H.burning, 0, 'hover not set alight');
  assert.ok(W.burning > 0, 'wheels set alight');
  bb.fires.length = 0;
  // a howitzer shell bursting on the ground between them (ap 1: armour out of the picture)
  const hp = () => [H.hp, W.hp];
  const burst = (x: number, y: number, direct: number, ground: boolean) => {
    const [h0, w0] = hp();
    bb.groundBurst = ground;
    bb.splash(x, y, 3, 100, 1, 1, enemy, false, 'howitzer', direct, false);
    bb.groundBurst = false;
    return [h0 - H.hp, w0 - W.hp];
  };
  W.x = H.x + 14; // apart: one burst per unit, same distance
  const [h1] = burst(H.x + 1, H.y, -1, true);
  const [, w1] = burst(W.x + 1, W.y, -1, true);
  assert.ok(Math.abs(h1 - w1 * HOVER_SPLASH) < 1e-6, `ground splash: hover ${h1.toFixed(1)} vs wheels ${w1.toFixed(1)}`);
  const [h2] = burst(H.x, H.y, H.id, true);
  const [, w2] = burst(W.x, W.y, W.id, true);
  assert.ok(Math.abs(h2 - w2) < 1e-6 && h2 > 0, `direct hit unchanged: ${h2.toFixed(1)} vs ${w2.toFixed(1)}`);
});

test('standoff jet: an artillery jet circles its ground target inside its guns\' reach and keeps firing', async () => {
  const { TICK_RATE } = await import('../src/shared/sim/types.ts');
  const { jetStandoff, standoffOrbit } = await import('../src/shared/stats.ts');
  const sf: Design = { id: 'sf', name: 'sf', chassis: 'superfortress', mobility: 'jet', mounts: ['barrage', 'barrage', 'barrage', 'mlrs', null, null, 'mirror', 'pointdef', null, null] }; // 4 weapons: the titan cap
  const wall: Design = { id: 'wall', name: 'wall', chassis: 'bastion', mobility: 'treads', mounts: ['plateH', 'plateM', 'cannon'] }; // (ground-only gun: can't shoot back)
  assert.deepEqual(jetStandoff(sf), { range: 20, minRange: 6 }); // the barrage's 20-cell reach (MLRS min range 6)
  const R = standoffOrbit(sf);
  assert.ok(R > 6 && R < 20 * 0.9, `orbit ${R}`);
  // bombers keep their bomb runs, fighters their dogfights, gun jets their strafing passes
  for (const mounts of [['bombs', 'bombs', 'bombs', 'mg'], ['aamissile', 'aamissile', 'aamissile', 'mg'], ['autocannon', 'autocannon', 'mg', 'mg']]) {
    assert.equal(standoffOrbit({ id: 'x', name: 'x', chassis: 'stratobomber', mobility: 'jet', mounts }), 0, mounts.join(','));
  }
  const designs = [sf, wall];
  const b = new Battle({ seed: 3, sides: [{ designs, units: [P('sf', 40, 2)] }, { designs, units: [{ ...P('wall', 40, 2), stance: 'holdPos' }] }] });
  const me = b.units[0], tgt = b.units.find((u) => u.side === 1)!;
  tgt.x = 48; tgt.y = 46; tgt.hp = tgt.maxHp = 1e7; // an unkillable target mid-field (no edge to bounce the orbit off)
  (b as unknown as { rebuildHash(): void }).rebuildHash();
  let salvos = 0, near = Infinity, t0 = -1;
  for (let i = 0; i < 30 * TICK_RATE && !b.done; i++) {
    b.step();
    for (const e of b.events) if (e.t === 'fire' && e.unit === me.id && e.mount === 0) { salvos++; if (t0 < 0) t0 = i; }
    if (t0 >= 0) near = Math.min(near, Math.hypot(me.x - tgt.x, me.y - tgt.y));
  }
  // strafing passes managed 1-2 barrage salvos in 30 s (mostly spent looping round outside its 6-20 cell band)
  assert.ok(salvos >= 4, `barrage salvos in 30 s: ${salvos}`);
  assert.ok(near > 6, `stayed outside the minimum range once firing: ${near.toFixed(1)}`);
});
