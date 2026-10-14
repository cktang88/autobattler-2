// Giant hulls (size 4). Each one has a strong plan shape that is NOT the footprint box:
//   goliath ("Warhulk")    charging-bull brawler: hexagonal hull that hunches up to a high armoured brow over the giant
//                          gun, a dozer ram between the front pods, tusks, shoulder sponsons, raked exhaust stacks.
//   leviathan              land battleship: long hull with a raked prow and tapered stern, two big centreline turrets
//                          either side of a tall stepped bridge tower with a mast, sponson guns, funnel.
//   broodmother            matriarch spider: armoured cephalothorax + head with eye cluster, a huge segmented egg-sac
//                          abdomen with glowing pods, eight legs.

import type { P2, V3 } from '../geo.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar, exhaust, glow, hazard, pod, sensor, stationHull, stationTop, vent } from './shapes.ts';
import { glowGrille, inPoly, mast, ngon, planLoft, reactor, skirt } from './giants-kit.ts';

type St = [number, number, number, number, number, number][];

/** generic raised seat: armoured pedestal from `base` up to y + collar (for mounts that land off the designed spots) */
function pedestal(c: ChassisCtx, m: MountSpec, base: number, y: number): { y: number; socket: boolean } {
  const { b, kit } = c;
  if (y - base > 0.06) block(b, kit.hull, m.x, base - 0.02, m.z, m.r * 2.5, m.r * 2.5, y - base + 0.02, { top: [0.84, 0.84], ch: m.r * 0.7, bev: 0.04 });
  collar(b, kit, m.x, y, m.z, m.r, y - 0.08, 18);
  return { y, socket: true };
}

// ---- GOLIATH -------------------------------------------------------------------------------------------------------
function goliath(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const kx = L / 5, kz = W / 4, k = Math.min(kx, kz);
  const legged = stance.legs !== null;
  const y0 = stance.y0, yt = legged ? stance.y0 + 0.35 * k : Math.max(stance.yt, y0 + 0.3);
  // lower hull between the running gear
  const wi = Math.min(stance.wi, 1.25 * kz);
  stationHull(b, kit.trim, [
    [-2.3 * kx, wi * 0.7, y0 + 0.12, yt - 0.05, yt + 0.05, 0.9],
    [-1.9 * kx, wi, y0, yt - 0.05, yt + 0.05, 0.95],
    [1.9 * kx, wi, y0, yt - 0.05, yt + 0.05, 0.95],
    [2.35 * kx, wi * 0.7, y0 + 0.15, yt - 0.05, yt + 0.05, 0.9],
  ], 0, 0.8);
  // hunched upper hull: hexagonal plan (widest at the shoulders, narrow nose and tail) rising to a high brow
  const v = k;
  const st: St = [
    [-2.45 * kx, 0.9 * kz, yt - 0.06, yt + 0.1 * v, yt + 0.32 * v, 0.6],
    [-2.0 * kx, 1.25 * kz, yt - 0.08, yt + 0.14 * v, yt + 0.5 * v, 0.66],
    [-0.75 * kx, 1.62 * kz, yt - 0.1, yt + 0.2 * v, yt + 0.85 * v, 0.66],
    [0.45 * kx, 1.72 * kz, yt - 0.1, yt + 0.24 * v, yt + 1.32 * v, 0.6],
    [1.35 * kx, 1.5 * kz, yt - 0.08, yt + 0.22 * v, yt + 1.28 * v, 0.56],
    [2.15 * kx, 1.05 * kz, yt - 0.06, yt + 0.14 * v, yt + 0.7 * v, 0.56],
  ];
  stationHull(b, kit.hull, st, 0, 0.92);
  // armoured brow / face: a dark sloped visor plate with a wide glowing eye slit under a heavy brow ridge
  const fx = 1.95 * kx, fy = yt + 0.2 * v;
  block(b, kit.trim, fx, yt - 0.04, 0, 0.5 * kx, 1.9 * kz, 0.5 * v, { top: [0.4, 0.9], shift: [0.1 * kx, 0], ch: 0.2 * k, bev: 0.04 });
  glow(b, kit, fx + 0.2 * kx, fy + 0.12 * v, 0, 0.06, 0.07 * v, 1.2 * kz, [0, 0, -0.75]);
  both((s) => glow(b, kit, fx + 0.12 * kx, fy + 0.1 * v, s * 0.78 * kz, 0.06, 0.06 * v, 0.24 * kz, [s * 0.35, 0, -0.75]));
  block(b, kit.panel, 1.62 * kx, stationTop(st, 1.62 * kx, 0) - 0.06, 0, 0.7 * kx, 1.6 * kz, 0.16 * v, { top: [0.7, 0.85], shift: [0.08 * kx, 0], ch: 0.2 * k, bev: 0.05 });
  // dozer ram between the front pods: angled blade, hazard band, tusks at the corners
  if (!legged) {
    const rx = 2.42 * kx, rw = Math.min(2.2 * kz, wi * 2.05);
    block(b, kit.metal, rx - 0.15 * kx, 0.1, 0, 0.36 * kx, rw * 0.8, y0 + 0.2, { ch: 0.1 * k });
    block(b, kit.hull, rx, 0.08, 0, 0.26 * kx, rw, yt - 0.02, { top: [0.6, 1.0], shift: [0.12 * kx, 0], ch: 0.08 * k, bev: 0.04, bot: 0.04 });
    hazard(b, kit, rx + 0.1 * kx, yt * 0.62, 0, rw * 0.9, 0.2 * kx, 6, Math.PI / 2);
    both((s) => {
      beam(b, kit.steel, [rx - 0.05 * kx, 0.35, s * rw * 0.42], [rx + 0.55 * kx, 0.2, s * rw * 0.5], 0.14 * k, 0.16 * k);
      beam(b, kit.metal, [rx - 0.5 * kx, y0 + 0.1, s * rw * 0.3], [rx - 0.05 * kx, yt * 0.6, s * rw * 0.4], 0.1 * k, 0.1 * k);
    });
  } else {
    both((s) => beam(b, kit.steel, [2.0 * kx, yt + 0.05, s * 0.9 * kz], [2.6 * kx, yt - 0.25, s * 1.05 * kz], 0.14 * k, 0.16 * k));
  }
  // shoulder sponsons hanging over the flanks between the pods (the flank heavies ride on them)
  const spY = yt + 0.78 * v;
  both((s) => {
    // rounded sponson pod bulging out of the flank, flat top deck for the heavy
    pod(b, kit.hull, [-0.45 * kx, yt + 0.42 * v, s * 1.5 * kz], 0.95 * kx, 0.42 * v, 0.55 * kz, 12, 6, 2.6, 0.2);
    block(b, kit.panel, -0.45 * kx, yt + 0.5 * v, s * 1.52 * kz, 1.0 * kx, 0.66 * kz, spY - yt - 0.5 * v, { top: [0.86, 0.86], ch: 0.25 * k, bev: 0.05 });
    skirt(b, kit, -1.2 * kx, 0.3 * kx, yt + 0.3 * v, s * 1.98 * kz, 0.5 * v, 0.1 * kz, 3, s);
    glow(b, kit, -0.45 * kx, yt + 0.42 * v, s * 2.04 * kz, 1.1 * kx, 0.05, 0.05);
    hazard(b, kit, 0.75 * kx, stationTop(st, 0.75 * kx, s * 1.45 * kz) + 0.01, s * 1.45 * kz, 0.55 * kx, 0.3 * kz, 4, 0.5 * s);
    b.box(kit.lamp, 0.06, 0.07, 0.2 * kz, 2.2 * kx, yt + 0.42 * v, s * 0.6 * kz, 0.015);
  });
  // engine deck: vents and two raked stacks, tail lights
  const eY = stationTop(st, -1.9 * kx, 0);
  both((s) => {
    vent(b, kit, -1.75 * kx, stationTop(st, -1.75 * kx, s * 0.55 * kz) - 0.01, s * 0.55 * kz, 0.55 * kx, 0.42 * kz, 3, 'x');
    exhaust(b, kit, -2.2 * kx, eY - 0.12, s * 0.75 * kz, 0.13 * k, 0.55 * v);
    glow(b, kit, -2.47 * kx, yt + 0.25 * v, s * 0.6 * kz, 0.05, 0.06, 0.3 * kz);
  });
  // dorsal spine ridge from the engine deck up to the hunch
  for (let i = 0; i < 3; i++) {
    const x = (-1.95 + i * 0.62) * kx;
    block(b, i % 2 ? kit.hull : kit.panel, x, stationTop(st, x, 0) - 0.05, 0, 0.5 * kx, 0.62 * kz, 0.16 * v, { top: [0.8, 0.7], shift: [0.05 * kx, 0], ch: 0.15 * k, bev: 0.04 });
  }
  // command cupola on the hunch, offset left: sensor + antenna
  const cx = -0.05 * kx, cz = -0.6 * kz, cY = stationTop(st, cx, cz);
  block(b, kit.hull, cx, cY - 0.04, cz, 0.6 * kx, 0.5 * kz, 0.24 * v, { top: [0.7, 0.75], ch: 0.15 * k, bev: 0.04 });
  b.box(kit.glass, 0.05, 0.07, 0.36 * kz, cx + 0.24 * kx, cY + 0.12 * v, cz, 0.01, [0, 0, -0.6]);
  sensor(b, kit, cx - 0.1 * kx, cY + 0.28 * v, cz, 0.16);
  mast(b, kit, -1.0 * kx, stationTop(st, -1.0 * kx, -0.95 * kz) - 0.02, -0.95 * kz, 1.0 * v, 0.03);
  const deck = (x: number, z: number) => stationTop(st, x, z);
  const top = stationTop(st, 0.55 * kx, 0);
  let hips: Hip[] | undefined;
  if (stance.legs === 'biped') {
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.2 * kx, stance.hipY, s * 1.15 * kz] as V3, side: s, t: stance.thick, foot: [-0.2 * kx, 0, s * 1.35 * kz] as V3, phase: s > 0 ? Math.PI : 0 }));
    both((s) => b.cylb(kit.trim, stance.thick * 1.4, 0.5 * kz, 0.05, [-0.2 * kx, stance.hipY, s * 0.95 * kz - 0.25 * kz], 'z', 14));
  }
  return {
    deckAt: deck, top, custom: true, hips,
    seat: (m: MountSpec) => {
      const d = deck(m.x, m.z);
      if (Math.abs(m.z) < 0.5 * kz && m.x > -0.6 * kx && m.x < 1.6 * kx) {
        // giant gun on the hunch: deep collar
        const y = deck(m.x, 0) + 0.06;
        collar(b, kit, m.x, y, m.z, m.r, y - 0.3, 22);
        return { y, socket: true };
      }
      if (Math.abs(m.z) > 0.9 * kz) return pedestal(c, m, spY - 0.05, spY + 0.12);
      return pedestal(c, m, d > 0 ? d : yt, (d > 0 ? d : yt) + 0.16);
    },
  };
}

registerChassis('goliath', goliath);

// ---- LEVIATHAN -----------------------------------------------------------------------------------------------------
function leviathan(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const kx = L / 6, kz = W / 3, k = Math.min(kx, kz), v = Math.min(1.1, (kx + kz) / 2);
  const legged = stance.legs !== null;
  const y0 = stance.y0, yt = legged ? y0 + 0.3 : Math.max(stance.yt, y0 + 0.3);
  const wi = Math.min(stance.wi, 0.95 * kz);
  // lower hull / keel between the running gear
  stationHull(b, kit.trim, [
    [-2.7 * kx, wi * 0.7, y0 + 0.1, yt - 0.05, yt + 0.05, 0.9],
    [-2.3 * kx, wi, y0, yt - 0.05, yt + 0.05, 0.95],
    [2.2 * kx, wi, y0, yt - 0.05, yt + 0.05, 0.95],
    [2.75 * kx, wi * 0.5, y0 + 0.2, yt - 0.05, yt + 0.05, 0.9],
  ], 0, 0.8);
  // ship hull: square-ish stern, widest at the sponsons, long fine bow rising (sheer) to a raked stem
  const st: St = [
    [-2.95 * kx, 0.8 * kz, yt - 0.05, yt + 0.12 * v, yt + 0.42 * v, 0.84],
    [-2.3 * kx, 1.08 * kz, yt - 0.1, yt + 0.14 * v, yt + 0.46 * v, 0.88],
    [-0.4 * kx, 1.25 * kz, yt - 0.12, yt + 0.18 * v, yt + 0.5 * v, 0.88],
    [1.0 * kx, 1.18 * kz, yt - 0.12, yt + 0.2 * v, yt + 0.56 * v, 0.86],
    [2.3 * kx, 0.8 * kz, yt - 0.08, yt + 0.3 * v, yt + 0.78 * v, 0.8],
    [3.2 * kx, 0.12 * kz, yt + 0.25, yt + 0.62 * v, yt + 1.02 * v, 0.6],
  ];
  stationHull(b, kit.hull, st, 0, 0.8);
  const deck = (x: number, z: number) => stationTop(st, x, z);
  // steel ram along the stem + hazard chevrons on the foredeck, bow lamps
  beam(b, kit.steel, [2.3 * kx, yt - 0.1, 0], [3.3 * kx, yt + 0.3, 0], 0.12 * k, 0.3 * v);
  hazard(b, kit, 2.45 * kx, deck(2.45 * kx, 0) + 0.005, 0, 0.6 * kz, 0.22 * kx, 4, Math.PI / 2);
  both((s) => b.box(kit.lamp, 0.12, 0.06, 0.06, 2.6 * kx, yt + 0.5 * v, s * 0.42 * kz, 0.012, [0, s * 0.5, 0]));
  // armour belt: a dark band with a glow line along each flank, panel strakes
  both((s) => {
    glow(b, kit, -0.2 * kx, yt + 0.3 * v, s * 1.26 * kz, 3.6 * kx, 0.05, 0.05);
    skirt(b, kit, -2.4 * kx, 1.6 * kx, yt + 0.16, s * 1.24 * kz, 0.36 * v, 0.08, 5, s);
  });
  // superfiring barbettes for the two big guns
  const fwdX = 1.62 * kx, aftX = -1.68 * kx;
  const bar = (x: number, h: number) => { const y = deck(x, 0); b.lathe(kit.hull, [[0, 0], [0.62 * k, 0], [0.56 * k, h * 0.8], [0.6 * k, h], [0, h]], [x, y - 0.04, 0], 'y', 18); return y - 0.04 + h; };
  const fwdY = bar(fwdX, 0.3 * v), aftY = bar(aftX, 0.42 * v);
  // bridge tower: stepped pagoda between the big guns, glass bridge band, mast with radar yard
  const bx = -0.2 * kx, d0 = deck(bx, 0);
  const t1 = d0 + 0.6 * v, t2 = t1 + 0.55 * v, t3 = t2 + 0.4 * v;
  block(b, kit.hull, bx, d0 - 0.04, 0, 1.6 * kx, 1.0 * kz, t1 - d0 + 0.04, { top: [0.9, 0.86], ch: 0.3 * k, bev: 0.05, bot: 0.04 });
  block(b, kit.panel, bx - 0.05 * kx, t1 - 0.02, 0, 1.1 * kx, 0.8 * kz, t2 - t1 + 0.02, { top: [0.86, 0.84], shift: [-0.04 * kx, 0], ch: 0.24 * k, bev: 0.04 });
  block(b, kit.hull, bx + 0.05 * kx, t2 - 0.02, 0, 0.8 * kx, 0.95 * kz, t3 - t2 + 0.02, { top: [0.8, 0.86], shift: [0.04 * kx, 0], ch: 0.22 * k, bev: 0.05 });
  b.box(kit.glass, 0.05, 0.1 * v, 0.8 * kz, bx + 0.42 * kx, t2 + 0.18 * v, 0, 0.01, [0, 0, -0.5]);
  glow(b, kit, bx + 0.44 * kx, t2 + 0.06 * v, 0, 0.04, 0.04, 0.74 * kz, [0, 0, -0.5]);
  // bridge wings reaching out over the sponsons
  both((s) => { block(b, kit.hull, bx + 0.25 * kx, t2 + 0.1 * v, s * 0.62 * kz, 0.4 * kx, 0.42 * kz, 0.14 * v, { top: [0.8, 0.8], ch: 0.08 * k }); glow(b, kit, bx + 0.45 * kx, t2 + 0.17 * v, s * 0.62 * kz, 0.03, 0.04, 0.3 * kz); });
  mast(b, kit, bx - 0.1 * kx, t3, 0, 1.3 * v, 0.045);
  b.box(kit.metal, 0.06, 0.06, 0.9 * kz, bx - 0.1 * kx, t3 + 0.85 * v, 0, 0.01);
  sensor(b, kit, bx + 0.1 * kx, t3 + 0.08 * v, 0, 0.2 * k);
  // raked funnel behind the bridge
  const fx = -0.95 * kx, fy = deck(fx, 0);
  block(b, kit.trim, fx, fy - 0.03, 0, 0.75 * kx, 0.66 * kz, 1.25 * v, { top: [0.8, 0.8], shift: [-0.12 * kx, 0], ch: 0.2 * k, bev: 0.04 });
  b.box(kit.hot, 0.4 * kx, 0.03, 0.34 * kz, fx - 0.12 * kx, fy + 1.22 * v, 0, 0.01);
  b.box(kit.accent, 0.7 * kx, 0.1 * v, 0.6 * kz, fx - 0.09 * kx, fy + 0.9 * v, 0, 0.01);
  // aft deck: vents, flag pole
  both((s) => vent(b, kit, -2.5 * kx, deck(-2.5 * kx, s * 0.6 * kz), s * 0.6 * kz, 0.5 * kx, 0.4 * kz, 3, 'x'));
  b.cyl(kit.steel, 0.02, 0.015, 0.6 * v, [-2.85 * kx, deck(-2.85 * kx, 0), 0], 'y', 5);
  let hips: Hip[] | undefined;
  if (stance.legs === 'biped') {
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.1 * kx, stance.hipY, s * 0.95 * kz] as V3, side: s, t: stance.thick, foot: [-0.1 * kx, 0, s * 1.1 * kz] as V3, phase: s > 0 ? Math.PI : 0 }));
  }
  return {
    deckAt: deck, top: t3, custom: true, hips,
    seat: (m: MountSpec) => {
      if (Math.abs(m.z) < 0.3 * kz && Math.abs(m.x - fwdX) < 0.4 * kx) { collar(b, kit, m.x, fwdY, m.z, m.r, fwdY - 0.06, 22); return { y: fwdY, socket: true }; }
      if (Math.abs(m.z) < 0.3 * kz && Math.abs(m.x - aftX) < 0.4 * kx) { collar(b, kit, m.x, aftY, m.z, m.r, aftY - 0.06, 22); return { y: aftY, socket: true }; }
      const d = deck(m.x, m.z);
      if (Math.abs(m.z) > 0.6 * kz) {
        // sponson: a half-round bulge on the flank
        const s = Math.sign(m.z), y = Math.max(d, yt + 0.4 * v) + 0.12;
        b.lathe(kit.hull, [[0, 0], [m.r * 1.35, 0], [m.r * 1.3, y - yt - 0.15], [m.r * 1.15, y - yt], [0, y - yt]], [m.x, yt, m.z + s * 0.05], 'y', 16);
        collar(b, kit, m.x, y, m.z, m.r, y - 0.06, 18);
        return { y, socket: true };
      }
      return pedestal(c, m, d > 0 ? d : yt, (d > 0 ? d : yt) + 0.14);
    },
  };
}
registerChassis('leviathan', leviathan);

// ---- BROODMOTHER ---------------------------------------------------------------------------------------------------
function broodmother(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  // authored for the 5 (long) x 7 (wide) footprint; art box ~3.75 x 4.9 holds the body, legs splay to the footprint
  const kx = L / 5, kz = W / 7, k = Math.min(kx, kz);
  const spider = stance.legs === 'spider';
  const by = spider ? stance.hipY : stance.legs === 'biped' ? stance.hipY + 0.1 : Math.max(stance.yt, 0.5) + 0.55 * k;
  if (!spider && stance.legs !== 'biped') {
    // anchored: squat armoured plinth under the body
    planLoft(b, kit.trim, ngon(8, 1.5 * kx, 1.5 * kz), [[0, 1.1], [by - 0.3, 1.0], [by, 0.85]], [-0.3 * kx, 0]);
  }
  // cephalothorax: octagonal armoured carapace, wider than long, domed up to the dorsal gun
  const cx = 0.0, cp = ngon(8, 1.15 * kx, 1.45 * kz, Math.PI / 8);
  const cy0 = by - 0.45 * k, cTop = by + 0.62 * k;
  planLoft(b, kit.trim, cp, [[cy0, 0.7], [by - 0.1 * k, 0.95], [by + 0.1 * k, 1.0]], [cx, 0]);
  planLoft(b, kit.hull, cp, [[by + 0.08 * k, 1.04], [by + 0.3 * k, 1.04], [cTop - 0.12 * k, 0.8], [cTop, 0.55]], [cx, 0]);
  // radial armour ribs on the carapace + glow seams
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI + Math.PI / 4;
    const zz = Math.sin(a) * 0.95 * kz, xx = Math.cos(a) * 0.75 * kx;
    for (const sg of [-1, 1]) block(b, kit.panel, cx + xx * sg, by + 0.28 * k, zz * sg, 0.45 * k, 0.32 * k, 0.24 * k, { top: [0.7, 0.6], ch: 0.1 * k, bev: 0.04 });
  }
  // head: lower, forward, with an eye cluster and big curved chelicerae
  const hx = 1.3 * kx, hy = by + 0.05 * k;
  pod(b, kit.hull, [hx, hy, 0], 0.55 * kx, 0.38 * k, 0.62 * kz, 12, 6, 2.4, 0.3);
  const eyes: [number, number, number][] = [[0.38, 0.12, 0.13], [0.38, 0.12, -0.13], [0.3, 0.26, 0.3], [0.3, 0.26, -0.3], [0.44, -0.02, 0.32], [0.44, -0.02, -0.32]];
  for (const [ex, ey, ez] of eyes) b.cyl(kit.glow, 0.075 * k, 0.065 * k, 0.12 * k, [hx + ex * kx, hy + ey * k, ez * kz], 'x', 8);
  both((s) => {
    beam(b, kit.metal, [hx + 0.35 * kx, hy - 0.15 * k, s * 0.3 * kz], [hx + 0.85 * kx, hy - 0.45 * k, s * 0.4 * kz], 0.16 * k, 0.2 * k);
    beam(b, kit.steel, [hx + 0.85 * kx, hy - 0.45 * k, s * 0.4 * kz], [hx + 1.0 * kx, hy - 0.85 * k, s * 0.22 * kz], 0.12 * k, 0.14 * k);
  });
  // abdomen: huge segmented egg-sac behind, glowing brood pods on its flanks
  const ax = -1.55 * kx, ay = by + 0.42 * k;
  b.cylb(kit.metal, 0.38 * k, 0.6 * kx, 0.06, [-0.75 * kx, by + 0.12 * k, 0], '-x', 12);
  pod(b, kit.trim, [ax, ay - 0.08 * k, 0], 1.05 * kx, 0.78 * k, 1.2 * kz, 12, 7, 2.2, 0.2);
  for (let i = 0; i < 3; i++) {
    const x = ax + (0.55 - i * 0.55) * kx, f = 1 - Math.abs(i - 1) * 0.18;
    pod(b, i === 1 ? kit.panel : kit.hull, [x, ay + 0.04 * k, 0], 0.32 * kx, 0.74 * k * f, 1.16 * kz * f, 12, 5, 2.4, 0.4);
  }
  both((s) => {
    for (let i = 0; i < 3; i++) {
      const x = ax + (0.5 - i * 0.5) * kx;
      pod(b, kit.glow, [x, ay - 0.12 * k, s * 1.1 * kz * (1 - Math.abs(i - 1) * 0.12)], 0.2 * kx, 0.2 * k, 0.16 * kz, 8, 4, 2.2);
    }
  });
  glow(b, kit, ax - 1.02 * kx, ay - 0.1 * k, 0, 0.05, 0.16 * k, 0.4 * kz);
  const abTop = ay + 0.7 * k;
  // hips: 8 legs from heavy coxa housings around the cephalothorax, alternating tetrapod gait
  let hips: Hip[] | undefined;
  if (spider) {
    hips = [];
    const rows: [number, number, number][] = [[0.75, 2.05, 2.55], [0.25, 0.75, 3.05], [-0.25, -0.65, 3.05], [-0.7, -1.9, 2.6]];
    rows.forEach(([hxr, fx, fz], i) => {
      for (const s of [-1, 1] as const) {
        const p: V3 = [hxr * kx, by, s * 1.12 * kz];
        hips!.push({ p, side: s, t: stance.thick * 0.92, foot: [fx * kx, 0, s * fz * kz], phase: ((i % 2) ^ (s > 0 ? 1 : 0)) ? Math.PI : 0 });
        block(b, kit.trim, p[0], by - 0.3 * k, s * 1.0 * kz, 0.4 * k, 0.4 * k, 0.5 * k, { top: [0.8, 0.8], ch: 0.1 * k });
      }
    });
  } else if (stance.legs === 'biped') {
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.1 * kx, stance.hipY, s * 1.1 * kz] as V3, side: s, t: stance.thick, foot: [-0.1 * kx, 0, s * 1.3 * kz] as V3, phase: s > 0 ? Math.PI : 0 }));
  }
  const deck = (x: number, z: number) => (inPoly(cp.map(([px, pz]) => [px * 0.6 + cx, pz * 0.6] as P2), x, z) ? cTop : -1);
  return {
    deckAt: deck, top: Math.max(cTop, abTop), custom: true, hips,
    seat: (m: MountSpec) => {
      if (m.x > 0.9 * kx) {
        // head turret between the eyes
        const y = hy + 0.36 * k;
        collar(b, kit, m.x, y, m.z, m.r, hy, 16);
        return { y, socket: true };
      }
      if (m.x < -1.0 * kx) {
        const y = ay + 0.74 * k * Math.sqrt(Math.max(0.1, 1 - ((m.x - ax) / (1.05 * kx)) ** 2)) + 0.02;
        collar(b, kit, m.x, y, m.z, m.r, y - 0.2, 16);
        return { y, socket: true };
      }
      if (Math.abs(m.z) > 0.8 * kz) {
        // flank guns on armoured shoulder humps
        const y = by + 0.5 * k;
        block(b, kit.hull, m.x, by, m.z, m.r * 2.6, m.r * 2.4, y - by, { top: [0.8, 0.8], ch: m.r * 0.7, bev: 0.05 });
        collar(b, kit, m.x, y, m.z, m.r, y - 0.08, 16);
        return { y, socket: true };
      }
      const y = cTop + 0.04;
      collar(b, kit, m.x, y, m.z, m.r, cTop - 0.2, 22);
      return { y, socket: true };
    },
  };
}
registerChassis('broodmother', broodmother);
void reactor; void glowGrille;
