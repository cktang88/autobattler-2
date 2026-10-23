// Units standing still must look still: no gear animation toggling on and off and no turret slewing back and forth
// while nothing about the fight changes. These pin the sim-side causes found for "units vibrate / turrets turn like
// crazy while they're staying still".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/shared/sim/battle.ts';
import { DT } from '../src/shared/sim/types.ts';
import type { Design, Placement } from '../src/shared/types.ts';

const D = (id: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name: id, chassis, mobility, mounts });
const DESIGNS: Design[] = [
  D('buzz', 'scout', 'wheels', ['mg']), // squad of 16
  D('walker', 'raider', 'legs', ['laser', null]), // light legged squad (8 at current prices)
  D('mortar', 'carriage', 'wheels', ['mortar']),
];
let uid = 1;
const P = (designId: string, x: number, y: number): Placement => ({ uid: uid++, designId, x, y, level: 1, round: 1, stance: 'holdPos' });
const angDiff = (a: number, b: number) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI; return d; };

/** A parked squad (holdPos) crammed into a third of its deploy spacing, so separation shoves its members apart for
 *  the first second or so, and a parked mortar 14 cells away that has it in range from the first tick. */
function crammed(squad: string): { b: Battle; squadIds: number[]; mortar: number } {
  const b = new Battle({ seed: 7, sides: [{ designs: DESIGNS, units: [P('mortar', 30, 0)] }, { designs: DESIGNS, units: [P(squad, 30, 0)] }] });
  const sq = b.units.filter((u) => u.side === 1), m = b.units.find((u) => u.side === 0)!;
  const cx = sq.reduce((s, u) => s + u.x, 0) / sq.length, cy = sq.reduce((s, u) => s + u.y, 0) / sq.length;
  for (const u of sq) { u.x = cx + (u.x - cx) * 0.35; u.y = cy + (u.y - cy) * 0.35; }
  m.x = cx; m.y = cy + 14;
  (b as unknown as { rebuildHash(): void }).rebuildHash();
  return { b, squadIds: sq.map((u) => u.id), mortar: m.id };
}

for (const squad of ['buzz', 'walker']) {
  test(`a parked ${squad} squad being shoved apart by separation is not "moving" (no gear animation toggling)`, () => {
    const { b, squadIds } = crammed(squad);
    let shoved = 0, moving = 0;
    const px = new Map(squadIds.map((i) => [i, [b.units[i].x, b.units[i].y]]));
    for (let t = 0; t < 60; t++) {
      b.step();
      for (const i of squadIds) {
        const u = b.units[i], [x0, y0] = px.get(i)!;
        if (!u.alive) continue;
        if (Math.hypot(u.x - x0, u.y - y0) > 0.002) shoved++;
        if (u.moving) moving++;
        px.set(i, [u.x, u.y]);
      }
    }
    assert.ok(shoved > 50, `setup: separation should shove the crammed squad (${shoved} shoved unit-ticks)`);
    assert.equal(moving, 0, `parked units flagged as moving on ${moving} unit-ticks`);
  });
}

test('a mortar does not lead a parked target along the shoves separation gives it', () => {
  // The lead used the target's last-tick displacement, which includes separation shoves; times a mortar's multi-second
  // flight that put the aim point a cell or more off a unit that was not going anywhere, and as the shoves inside a
  // squad change direction tick to tick the lead point -- and the parked mortar's barrel -- swung back and forth.
  const { b, squadIds, mortar } = crammed('buzz');
  type Aim = { aimPoint(I: unknown, w: unknown, t: unknown, mx: number, my: number): { x: number; y: number }; ints: { wpns: unknown[] }[] };
  const B = b as unknown as Aim, I = B.ints[mortar], M = b.units[mortar];
  let checked = 0, worst = 0;
  for (let t = 0; t < 30; t++) {
    const px = squadIds.map((i) => [b.units[i].x, b.units[i].y]);
    b.step();
    squadIds.forEach((i, k) => {
      const o = b.units[i];
      if (!o.alive || Math.hypot(o.x - px[k][0], o.y - px[k][1]) < 0.005) return; // only units shoved this tick
      const p = B.aimPoint(I, I.wpns[0], o, M.x, M.y);
      worst = Math.max(worst, Math.hypot(p.x - o.x, p.y - o.y));
      checked++;
    });
  }
  assert.ok(checked > 20, `setup: separation should shove squad members (${checked})`);
  assert.ok(worst < 1e-9, `aim point led ${worst.toFixed(3)} cells off a parked target`);
});

test('a parked mortar battery under attack by a weaving squad: hulls hold still, barrels do not saw back and forth', () => {
  // 3 mortar blocks on holdPos at the back of their zone, 3 squads of 16 wheeled raiders charging them (the squads weave
  // around each other on the way in). Over the whole fight: no hull turns at all, and the barrels' back-swing while
  // they hold one target stays bounded (a target flip-flop or aim wrap-around bug shows up as tens of deg/s).
  // (The mortar's turret is slower than its carriage, so a parked hull may turn to help it aim: that is allowed, but
  // the hull must not saw back and forth either.)
  const sideA: Placement[] = [], sideB: Placement[] = [];
  for (let k = 0; k < 3; k++) sideA.push(P('mortar', 20 + k * 8, 13));
  for (let k = 0; k < 3; k++) sideB.push({ ...P('buzz', 26 + k * 7, 0), stance: undefined });
  const b = new Battle({ seed: 3, sides: [{ designs: DESIGNS, units: sideA }, { designs: DESIGNS, units: sideB }] });
  const ms = b.units.filter((u) => u.side === 0);
  const prev = ms.map((u) => ({ hull: u.angle, a: u.mounts[0].angle, d: 0, t: -1, hd: 0 }));
  let hullBack = 0, back = 0, held = 0;
  for (let t = 0; t < 120 / DT && !b.done; t++) {
    b.step();
    ms.forEach((u, k) => {
      const q = prev[k], m = u.mounts[0];
      if (!u.alive) return;
      const hd = angDiff(q.hull, u.angle);
      if (Math.abs(hd) > 1e-4 && Math.abs(q.hd) > 1e-4 && Math.sign(hd) !== Math.sign(q.hd)) hullBack += Math.min(Math.abs(hd), Math.abs(q.hd));
      q.hd = hd;
      const d = angDiff(q.a, m.angle);
      if (m.target >= 0 && m.target === q.t) {
        held++;
        if (Math.abs(d) > 1e-4 && Math.abs(q.d) > 1e-4 && Math.sign(d) !== Math.sign(q.d)) back += Math.min(Math.abs(d), Math.abs(q.d));
      }
      q.hull = u.angle; q.a = m.angle; q.d = d; q.t = m.target;
    });
  }
  assert.ok(held * DT > 20, `setup: the mortars should spend a while on targets (${(held * DT).toFixed(1)} s)`);
  assert.ok((hullBack * 180 / Math.PI) / (held * DT) < 4.5, `parked hulls sawed back and forth (${((hullBack * 180 / Math.PI) / (held * DT)).toFixed(2)} deg/s)`);
  const rate = (back * 180 / Math.PI) / (held * DT);
  // measured 5.4 deg/s when shots led separation shoves, 3.9 now (what is left comes from the attackers' own
  // stop-and-go and weaving on the way in, which a leading gunner follows)
  assert.ok(rate < 4.5, `barrel back-swing ${rate.toFixed(2)} deg/s while holding one target`);
});
