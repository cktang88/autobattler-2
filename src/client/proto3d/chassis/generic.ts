// Fallback hull for chassis without a dedicated builder, hard-surface style: the faceted recipe loft from hulls3d.ts
// (flat deck, sharp shoulder, glacis break), a glacis plate and shoulder plates on shadow gaps (hs-kit), a casemate
// on the best free deck stretch, bridge on giants, and functional parts placed by slot (hs-kit autoDress: smoke banks,
// caged lamps, exhaust one side, cans + antenna the other, bins / spare track, hatch) instead of a random scatter.
// On legs it gets a deeper hull and a belly pod between the hips so it never reads as a slab on stilts.

import { atlasUV } from '../materials.ts';
import { addBridge, addCasemate, buildHull, deckAt, giantDetails, type Mount } from '../hulls3d.ts';
import { autoDress } from './hs-kit.ts';
import { facePlate } from './hs-kit-vehicles.ts';
import { registerChassis, type ChassisCtx, type ChassisOut } from './registry.ts';
import { block } from './shapes.ts';

// deck heights ~18% lower than the old toy proportions (low hulls read as machines)
const DECK_H = [0, 0.14, 0.2, 0.3, 0.41, 0.53];

export function genericHull(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, S, stance, rnd } = c;
  const legged = stance.legs !== null;
  const Hd = DECK_H[Math.min(5, S)] * (legged ? 1.7 : 1.15);
  const hull = buildHull(b, kit, c.ch.shape, L, W, stance.y0, stance.yt, Hd, stance.wi, stance.tracked);
  const mounts: Mount[] = c.mounts.map((m) => ({ x: m.x, z: m.z, r: m.r }));
  if (legged) {
    // belly pod slung between the hips (biped) or under the body (spider): mass where the legs attach
    const t = stance.thick;
    const pw = stance.legs === 'spider' ? W * 0.5 : Math.max(W * 0.2, W * 0.54 - t * 2.4);
    block(b, kit.trim, 0, stance.y0 - t * 1.1, 0, L * 0.6, pw, t * 1.2 + 0.02, { top: [1.08, 1.1], ch: t * 0.5, bev: t * 0.15, bot: t * 0.3 });
    block(b, kit.hull, L * 0.05, stance.y0 - t * 0.5, 0, L * 0.5, pw * 1.12, t * 0.55, { ch: t * 0.4, bev: t * 0.1 });
  }
  if (S >= 2) {
    const rcase = Math.min(S === 2 ? 0.16 * L : 0.12 * L, 0.5), hw = Math.min(W * (S === 2 ? 0.17 : 0.2), 0.22 * S);
    let best = 0, bx = 0;
    for (let k = 0; k < 24; k++) {
      const cx = -L * 0.42 + k * L * 0.026;
      if (S === 2 && cx > -L * 0.12) continue;
      const clear = Math.min(...mounts.map((m) => Math.max(Math.abs(m.x - cx) - rcase, Math.abs(m.z) - hw) - m.r * 0.95), 5);
      if (clear > best && deckAt(hull, cx - rcase, 0) > 0 && deckAt(hull, cx + rcase, 0) > 0) { best = clear; bx = cx; }
    }
    if (best > 0.02) {
      addCasemate(b, kit, hull, bx, rcase, hw, Hd * (S >= 3 ? 0.75 : 0.55));
      mounts.push({ x: bx, z: 0, r: Math.max(rcase, hw) * 1.1 });
      if (S >= 4) addBridge(b, kit, hull, bx - rcase * 0.1, S * 0.55);
    }
  }
  // armour plates on the glacis (last two stations) and on both shoulders of the flat mid section
  const pts = hull.lofts[0].pts, n = pts.length, T = 0.012 + 0.008 * S;
  const ga = pts[n - 2], gc = pts[n - 1];
  if (ga.y3 - gc.y3 > 0.02) facePlate(b, kit, kit.armor2, [gc.x, gc.y3, 0], [ga.x, ga.y3, 0], [0, 0, 1], Math.min(ga.wt, gc.wt * 1.6) * 1.7, T, [1, 1, 0], { standoff: T * 0.4, gap: T * 0.8, fill: 0.86 });
  const m1 = pts[1], m2 = pts[n - 3];
  for (const s of [-1, 1]) {
    if (m2.x - m1.x < 0.2) break;
    facePlate(b, kit, kit.armor2, [(m1.x + m2.x) / 2, m1.y2, s * m1.wm], [(m1.x + m2.x) / 2, m1.y3, s * m1.wt], [1, 0, 0], (m2.x - m1.x) * 0.8, T * 0.8, [0, 0.5, s], { standoff: T * 0.3, gap: T * 0.6, fill: 0.84 });
  }
  autoDress({ b, kit, L, W, S, mounts }, (x, z) => deckAt(hull, x, z), { skip: ['tow'] });
  void rnd;
  if (S >= 4) giantDetails(b, kit, hull, S, rnd, mounts);
  // head lamps, tail lights, one team chevron
  const p = hull.lofts[0].pts;
  const nose = p[p.length - 2], rear = p[0];
  for (const sg of [-1, 1]) {
    b.box(kit.lamp, 0.03, 0.025 + 0.01 * S, 0.04 + 0.012 * S, nose.x + 0.02, nose.y3 - 0.01, sg * nose.wt * 0.7, 0.004);
    b.box(kit.hot, 0.02, 0.02, 0.04 + 0.01 * S, rear.x - 0.012, rear.y3 * 0.78 + stance.y0 * 0.2, sg * rear.wm * 0.8, 0.003);
  }
  const ds = 0.1 + 0.05 * S;
  const dk2 = deckAt(hull, L * 0.12, -W * 0.2);
  if (dk2 > 0 && S <= 3 && mounts.every((m) => Math.hypot(m.x - L * 0.12, m.z + W * 0.2) > m.r + ds * 0.7)) b.decal(ds * 1.1, ds * 1.1, L * 0.12, dk2 + 0.003, -W * 0.2, atlasUV(1), 0);
  return {
    deckAt: (x, z) => deckAt(hull, x, z),
    top: hull.top, dressed: true,
    seat: (m) => {
      let y = deckAt(hull, m.x, m.z);
      if (y < 0) y = hull.top;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, d = deckAt(hull, m.x + Math.cos(a) * m.r * 0.85, m.z + Math.sin(a) * m.r * 0.85);
        if (d >= 0) y = Math.max(y, d);
      }
      return { y, socket: false };
    },
  };
}

registerChassis('generic', genericHull);
