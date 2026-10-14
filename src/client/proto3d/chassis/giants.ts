// Giant hulls. Goliath ("Warhulk"): a hulking brawler on quad tracks. Wide lower hull with a sloped armoured face
// (glowing eye lamps, hazard-striped shoulders), a narrow raised citadel carrying the giant gun, side sponsons for the
// flank heavies, a command bridge, and a raised engine deck with big stacks for the rear mount.

import { registerChassis, type ChassisCtx, type ChassisOut, type MountSpec } from './registry.ts';
import { block, both, collar, exhaust, glow, hazard, sensor, stationHull, stationTop, vent } from './shapes.ts';

type St = [number, number, number, number, number, number][];
/** stations authored for a 5 x 4 hull on y0 = 0.62 / yt = 1.1, rescaled to (L, W) and the stance */
function fit(st: St, kx: number, kz: number, dy0: number, dyt: number): St {
  return st.map(([x, hw, a, b, c, tf]) => [x * kx, hw * kz, a + dy0, b + dyt, c + dyt, tf]);
}

function goliath(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const kx = L / 5, kz = W / 4, k = Math.min(kx, kz);
  const dy0 = stance.y0 - 0.62, dyt = Math.max(stance.yt, stance.y0 + 0.2) - 1.1;
  const st = fit([
    [-2.45, 1.78, 0.64, 1.1, 1.7, 0.86],
    [-2.3, 1.9, 0.62, 1.1, 1.82, 0.9],
    [1.45, 1.9, 0.62, 1.1, 1.86, 0.9],
    [2.05, 1.84, 0.64, 1.1, 1.6, 0.82],
    [2.48, 1.5, 0.72, 1.06, 1.24, 0.74],
  ], kx, kz, dy0, dyt);
  stationHull(b, kit.hull, st, 0, Math.min(0.95, stance.wi / (1.9 * kz)));
  const lowY = stationTop(st, 0, 0);
  // raised citadel down the spine (narrow, so the flank sponsons sit on open shoulders)
  const cit = fit([
    [-1.2, 0.72, 1.8, 1.8, 2.24, 0.8],
    [-1.05, 0.82, 1.8, 1.8, 2.34, 0.84],
    [1.0, 0.82, 1.8, 1.8, 2.36, 0.84],
    [1.5, 0.74, 1.8, 1.8, 2.0, 0.76],
  ], kx, kz, dy0, dyt);
  stationHull(b, kit.hull, cit, 0, 1);
  const citY = stationTop(cit, 0, 0);
  // armoured face: dark lower plate, glowing eye lamps under brow plates, central grille
  block(b, kit.trim, 2.32 * kx, stance.y0, 0, 0.36 * kx, 2.6 * kz, st[4][3] - stance.y0 + 0.05, { top: [0.5, 0.92], shift: [0.08 * kx, 0], ch: 0.12 * k });
  vent(b, kit, 2.3 * kx, stationTop(st, 2.3 * kx, 0) - 0.02, 0, 0.3 * kx, 1.0 * kz, 4, 'z');
  both((s) => {
    const ex = 2.18 * kx, ez = s * 1.1 * kz, ey = stationTop(st, ex, ez);
    block(b, kit.trim, ex, ey - 0.06, ez, 0.42 * kx, 0.5 * kz, 0.16, { top: [0.7, 0.9], ch: 0.08 * k });
    glow(b, kit, ex + 0.12 * kx, ey + 0.06, ez, 0.18 * kx, 0.08, 0.36 * kz, [0, 0, -0.45]);
    block(b, kit.panel, ex - 0.08 * kx, ey + 0.08, ez, 0.3 * kx, 0.58 * kz, 0.1, { top: [0.6, 0.9], shift: [0.05 * kx, 0], ch: 0.06 * k });
    // hazard-striped front shoulders
    hazard(b, kit, 1.75 * kx, stationTop(st, 1.75 * kx, s * 1.62 * kz) + 0.01, s * 1.62 * kz, 0.7 * kx, 0.36 * kz, 5, 0);
    b.box(kit.lamp, 0.05, 0.08, 0.18 * kz, 2.48 * kx, st[4][4] - 0.05, s * 0.9 * kz, 0.015);
    // flank glow strips and spaced side armour
    glow(b, kit, -0.5 * kx, st[2][3] + (st[2][4] - st[2][3]) * 0.6, s * 1.9 * kz, 2.2 * kx, 0.05, 0.05, [s * 0.4, 0, 0]);
    for (let i = 0; i < 3; i++) block(b, i === 1 ? kit.panel : kit.hull, (-1.5 + i * 1.15) * kx, st[2][3] - 0.12, s * 1.98 * kz, 1.0 * kx, 0.12 * kz, 0.42, { top: [0.95, 0.6], ch: 0.04 * k, bev: 0.03 * k, bot: 0.03 * k });
    // citadel flank glow
    glow(b, kit, 0.0, citY - 0.22, s * 0.8 * kz, 1.6 * kx, 0.04, 0.04, [s * 0.5, 0, 0]);
  });
  // command bridge between the giant gun and the rear mount: visor block + sensor mast
  const bx = -0.62 * kx, bY = citY + 0.36;
  block(b, kit.hull, bx, citY - 0.02, 0, 0.9 * kx, 1.0 * kz, bY - citY + 0.02, { top: [0.72, 0.8], shift: [-0.06 * kx, 0], ch: 0.18 * k, bev: 0.05 });
  glow(b, kit, bx + 0.36 * kx, citY + 0.24, 0, 0.05, 0.06, 0.7 * kz, [0, 0, -0.8]);
  b.box(kit.glass, 0.05, 0.1, 0.78 * kz, bx + 0.39 * kx, citY + 0.2, 0, 0.01, [0, 0, -0.7]);
  sensor(b, kit, bx - 0.15 * kx, bY + 0.1, 0.25 * kz, 0.18);
  b.cyl(kit.steel, 0.025, 0.015, 0.9, [bx - 0.25 * kx, bY, -0.3 * kz], 'y', 5);
  b.cyl(kit.lamp, 0.04, 0.04, 0.05, [bx - 0.25 * kx, bY + 0.9, -0.3 * kz], 'y', 6);
  // raised engine deck at the rear: vents and two big stacks
  const ey = lowY + 0.28;
  block(b, kit.hull, -1.85 * kx, lowY - 0.02, 0, 1.15 * kx, 2.4 * kz, ey - lowY + 0.02, { top: [0.9, 0.92], ch: 0.3 * k, bev: 0.06 });
  both((s) => {
    vent(b, kit, -2.0 * kx, ey, s * 0.78 * kz, 0.6 * kx, 0.42 * kz, 3, 'x');
    exhaust(b, kit, -2.25 * kx, lowY - 0.02, s * 1.45 * kz, 0.14 * k, 0.5);
  });
  // seats: giant gun on the citadel, flank heavies on sponson blocks, rear heavy on the engine deck
  const bigR = Math.max(...c.mounts.map((m) => m.r), 0);
  const big = c.mounts.find((m) => m.r === bigR && m.cls !== 'M') ?? c.mounts.find((m) => Math.abs(m.z) < 0.2 && m.x > 0);
  const deck = (x: number, z: number) => Math.max(stationTop(st, x, z), stationTop(cit, x, z));
  return {
    deckAt: deck, top: bY, custom: true,
    seat: (m: MountSpec) => {
      if (m === big) { const y = citY + 0.06; collar(b, kit, m.x, y, m.z, m.r, citY - 0.1, 22); return { y, socket: true }; }
      if (m.x < -1.2 * kx && Math.abs(m.z) < 0.6 * kz) { const y = ey + 0.06; collar(b, kit, m.x, y, m.z, m.r, ey - 0.04, 18); return { y, socket: true }; }
      const top = deck(m.x, m.z);
      const y = Math.max(top, lowY) + 0.24;
      block(b, kit.hull, m.x, lowY - 0.02, m.z, m.r * 2.6, m.r * 2.5, y - lowY - 0.02, { top: [0.88, 0.88], ch: m.r * 0.7, bev: 0.04 });
      collar(b, kit, m.x, y, m.z, m.r, y - 0.08, 18);
      return { y, socket: true };
    },
  };
}

registerChassis('goliath', goliath);
