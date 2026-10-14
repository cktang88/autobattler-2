// Tank hulls: Warden (sturdy line MBT: tall sloped hull, raised turret plinth, ram horns, engine deck) and Bastion
// (fortress tank: octagonal citadel hull, spaced flank armour, twin rear sponson towers, front gun on a raised keep).

import { atlasUV } from '../materials.ts';
import { registerChassis, type ChassisCtx, type ChassisOut } from './registry.ts';
import { block, both, collar, exhaust, glow, hazard, stationHull, stationTop, vent } from './shapes.ts';

type St = [number, number, number, number, number, number][];

/** scale a station table authored for a hull of length 2 / width 2 to (L, W), lifting it onto the stance */
function fit(st: St, L: number, W: number, y0: number, yt: number, hk: number): St {
  return st.map(([x, hw, a, b2, c, tf]) => [x * L / 2, hw * W / 2, y0 + (a - 0.2) * hk, yt + (b2 - 0.46) * hk, yt + (c - 0.46) * hk, tf]);
}

function warden(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const k = W / 2; // authored at 2x2
  const hk = k * 1.0;
  const y0 = stance.y0, yt = Math.max(stance.yt, y0 + 0.12 * k);
  // lower hull up to the fender-top deck, then a narrower sloped upper hull: a clear two-tier silhouette from above
  const st = fit([
    [-1.0, 0.86, 0.22, 0.46, 0.62, 0.86],
    [-0.92, 0.9, 0.2, 0.46, 0.66, 0.92],
    [0.42, 0.9, 0.2, 0.46, 0.68, 0.9],
    [0.7, 0.86, 0.22, 0.46, 0.62, 0.82],
    [0.98, 0.64, 0.28, 0.44, 0.5, 0.7],
  ], L, W, y0, yt, hk);
  stationHull(b, kit.hull, st, 0, Math.min(0.95, stance.wi / (0.9 * k)));
  const lowY = stationTop(st, 0, 0);
  const up = fit([
    [-0.9, 0.62, 0.62, 0.62, 0.84, 0.76],
    [-0.8, 0.7, 0.62, 0.62, 0.9, 0.8],
    [0.25, 0.7, 0.62, 0.62, 0.92, 0.8],
    [0.62, 0.6, 0.62, 0.62, 0.7, 0.72],
  ], L, W, y0, yt, hk);
  stationHull(b, kit.hull, up, 0, 1);
  const deckY = stationTop(up, 0, 0);
  // glacis armour insets in the lighter panel colour
  both((s) => block(b, kit.panel, 0.8 * k, stationTop(st, 0.8 * k, 0) - 0.04 * k, s * 0.36 * k, 0.26 * k, 0.5 * k, 0.07 * k, { top: [0.8, 0.9], ch: 0.05 * k, bev: 0.02 * k }));
  // lower nose plate (darker) and rear plate
  block(b, kit.trim, 0.92 * k, y0, 0, 0.16 * k, 1.04 * k, (st[4][3] - y0) * 1.05, { top: [0.5, 0.9], shift: [0.04 * k, 0], ch: 0.06 * k });
  block(b, kit.trim, -0.98 * k, y0 + 0.02 * k, 0, 0.08 * k, 1.4 * k, (st[0][4] - y0) * 0.86, { ch: 0.03 * k });
  // turret plinth: raised armoured ring base under the main gun
  const main = c.mounts.reduce((a, m) => (m.r > a.r ? m : a), c.mounts[0] ?? { x: 0.08 * k, z: 0, r: 0.29 * k, i: -1 } as never);
  const plY = deckY + 0.07 * k;
  block(b, kit.hull, (main?.x ?? 0.08 * k) - 0.04 * k, deckY - 0.02 * k, 0, 0.86 * k, 0.9 * k, plY - deckY + 0.02 * k, { top: [0.9, 0.9], ch: 0.2 * k, bev: 0.03 * k });
  // ram horns: chunky armour wedges over the front of the tracks (Warden's 2D forks)
  both((s) => {
    block(b, kit.hull, 0.86 * k, yt - 0.06 * k, s * 0.74 * k, 0.4 * k, 0.24 * k, 0.26 * k, { top: [0.55, 0.8], shift: [0.08 * k, -s * 0.01 * k], ch: 0.07 * k, bev: 0.04 * k });
    block(b, kit.panel, 0.98 * k, yt - 0.02 * k, s * 0.74 * k, 0.12 * k, 0.2 * k, 0.12 * k, { top: [0.4, 0.8], shift: [0.05 * k, 0], ch: 0.04 * k });
    // head lamps on the glacis corners
    b.box(kit.lamp, 0.03 * k, 0.05 * k, 0.1 * k, 0.97 * k, st[4][4] - 0.04 * k, s * 0.42 * k, 0.01);
    // side glow strip along the upper-hull flank, and a tail light
    glow(b, kit, -0.25 * k, lowY + (deckY - lowY) * 0.55, s * 0.72 * k, 0.8 * k, 0.025 * k, 0.025 * k, [s * 0.5, 0, 0]);
    b.box(kit.glow, 0.02 * k, 0.04 * k, 0.12 * k, -1.0 * k, st[0][4] - 0.1 * k, s * 0.56 * k, 0.008);
    // engine deck exhausts at the rear corners
    exhaust(b, kit, -0.92 * k, lowY - 0.02 * k, s * 0.7 * k, 0.065 * k, 0.12 * k);
    // stowage bins on the lower-hull shoulders, beside the upper hull
    block(b, kit.panel, -0.45 * k, lowY - 0.02 * k, s * 0.8 * k, 0.5 * k, 0.15 * k, 0.12 * k, { ch: 0.04 * k, bev: 0.02 * k });
    block(b, kit.trim, 0.25 * k, lowY - 0.02 * k, s * 0.8 * k, 0.3 * k, 0.14 * k, 0.1 * k, { ch: 0.04 * k, bev: 0.02 * k });
  });
  vent(b, kit, -0.66 * k, stationTop(up, -0.66 * k, 0) - 0.01 * k, 0, 0.2 * k, 0.5 * k, 3, 'x');
  // driver hatch + periscopes ahead of the plinth, on the glacis top
  b.cylb(kit.trim, 0.08 * k, 0.04 * k, 0.01, [0.56 * k, stationTop(st, 0.56 * k, 0.5 * k), 0.5 * k], 'y', 10);
  b.decal(0.2 * k, 0.2 * k, -0.62 * k, lowY + 0.003, 0.8 * k, atlasUV(1), 0);
  const deck = (x: number, z: number) => Math.max(stationTop(st, x, z), stationTop(up, x, z));
  return {
    deckAt: deck, top: plY, custom: true,
    seat: (m) => {
      if (m === main) { collar(b, kit, m.x, plY, m.z, m.r, plY - 0.04 * k, 20); return { y: plY, socket: true }; }
      const y = Math.max(deck(m.x, m.z), deckY) + 0.05 * k;
      collar(b, kit, m.x, y, m.z, m.r, deckY - 0.02 * k, 16);
      return { y, socket: true };
    },
  };
}

function bastion(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const k = W / 2; // authored at 2 -> 3x3 bastion = 1.5
  const y0 = stance.y0, yt = Math.max(stance.yt, y0 + 0.12 * k);
  const st = fit([
    [-0.99, 0.8, 0.22, 0.46, 0.8, 0.74],
    [-0.86, 0.9, 0.2, 0.46, 0.92, 0.82],
    [0.46, 0.9, 0.2, 0.46, 0.94, 0.82],
    [0.76, 0.84, 0.22, 0.46, 0.76, 0.72],
    [0.99, 0.6, 0.26, 0.44, 0.56, 0.66],
  ], L, W, y0, yt, k);
  stationHull(b, kit.hull, st, 0, Math.min(0.95, stance.wi / (0.9 * k)));
  const deckY = stationTop(st, 0, 0);
  // spaced flank armour: three big panel slabs per side, standing off the hull on the shoulders
  both((s) => {
    for (let i = 0; i < 3; i++) {
      const x = (-0.62 + i * 0.5) * k;
      block(b, i === 1 ? kit.panel : kit.hull, x, yt - 0.08 * k, s * 0.92 * k, 0.46 * k, 0.1 * k, (deckY - yt) * 0.9, { top: [0.94, 0.6], shift: [0, -s * 0.03 * k], ch: 0.03 * k, bev: 0.025 * k, bot: 0.02 * k });
    }
    hazard(b, kit, 0.84 * k, st[3][4] + 0.01 * k, s * 0.5 * k, 0.28 * k, 0.16 * k, 4, 0.5 * s);
    b.box(kit.lamp, 0.03 * k, 0.05 * k, 0.1 * k, 0.99 * k, st[4][4] - 0.04 * k, s * 0.4 * k, 0.01);
    exhaust(b, kit, -0.9 * k, st[0][4] - 0.04 * k, s * 0.3 * k, 0.07 * k, 0.2 * k);
  });
  // citadel keep under the front gun, sponson towers under the rear pair
  const sorted = [...c.mounts].sort((a, q) => q.x - a.x);
  const front = sorted[0];
  const keepY = deckY + 0.16 * k;
  block(b, kit.hull, (front?.x ?? 0.1 * k) - 0.06 * k, deckY - 0.02 * k, 0, 0.9 * k, 0.86 * k, keepY - deckY + 0.02 * k, { top: [0.88, 0.86], ch: 0.24 * k, bev: 0.04 * k });
  glow(b, kit, (front?.x ?? 0.1 * k) + 0.38 * k, deckY + 0.08 * k, 0, 0.03 * k, 0.04 * k, 0.4 * k, [0, 0, -0.6]);
  const towerY = deckY + 0.1 * k;
  for (const m of sorted.slice(1)) block(b, kit.hull, m.x, deckY - 0.02 * k, m.z, m.r * 2.4, m.r * 2.4, towerY - deckY + 0.02 * k, { top: [0.86, 0.86], ch: m.r * 0.6, bev: 0.03 * k });
  vent(b, kit, -0.8 * k, deckY - 0.01 * k, 0, 0.18 * k, 0.4 * k, 3, 'x');
  const deck = (x: number, z: number) => stationTop(st, x, z);
  return {
    deckAt: deck, top: keepY, custom: true,
    seat: (m) => {
      const y = m === front ? keepY : towerY;
      collar(b, kit, m.x, y, m.z, m.r, y - 0.05 * k, m === front ? 20 : 16);
      return { y, socket: true };
    },
  };
}

registerChassis('hex', warden);
registerChassis('fortress', bastion);
