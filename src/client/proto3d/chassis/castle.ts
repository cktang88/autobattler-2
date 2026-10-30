// Tug of war castle (shared/tug.ts castleDesign: a Monolith on an anchor in the sim, design id 'tug-castle', one gun
// of ANY class). Concept: the side's mothership, set down for good and turned into a forward base.
//   * a wedge-nosed carrier hull jacked up on four splayed hydraulic landing legs, bow toward the enemy;
//   * the bow ramp lowered to the ground as the base's gate, a glowing hangar mouth behind it;
//   * the folded wing panels planted in the ground along both flanks as armoured ramparts;
//   * twin engine nacelles astern, cooling (embers in the nozzles), a carrier-style command island off-centre astern
//     with a bridge glow band, mast and comms dish;
//   * the exposed reactor ring on the spine, glowing: the heart of the base, the thing worth defending;
//   * a camp round the legs: cargo containers, fuel tanks, a beacon;
//   * amidships on the spine, an armoured gun cupola that turns with the gun (torso mode). The castle buys bigger and
//     smaller guns during a game, so the cupola is sized round the equipped gun's class (DRAW_D): a slim cap under a
//     heavy MG, a broad dome on a raised drum under a titan gun. The gun itself stays its class size.
// Top-down: an arrowhead hull between two wall slabs, four leg pads at the corners, unlike any other hull.

import { DRAW_D } from '../weapons3d.ts';
import { MODULE_BY_ID } from '../../../shared/parts.ts';
import type { MountClass } from '../../../shared/types.ts';
import type { P2, V3 } from '../geo.ts';
import type { ChassisCtx, ChassisOut, MountSpec } from './registry.ts';
import { beam, block, both, glow, hazard, stationHull } from './shapes.ts';
import { ngon, planLoft } from './giants-kit.ts';
import { armorPlate, cagedLamp, fineFor, frame, piston, rectP } from './hs-kit.ts';
import { sensorDome, whip } from './titan-greebles.ts';

/** shared/tug.ts castleDesign's id (not imported: the proto3d bundle stays free of the game rules) */
export const CASTLE_ID = 'tug-castle';
/** is this the castle? ('tug-castle#n': several in one proto3d lab lineup) */
export const isCastle = (id: string): boolean => id === CASTLE_ID || id.startsWith(CASTLE_ID + '#');

export function castle(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W } = c;
  // drawn a little past its 7-cell sim footprint: the base has to read as the biggest, most valuable thing on the
  // field (the drop zone keeps a clear ring round it, so nothing parks inside the overhang)
  const k = (Math.min(L, W) / 7) * 1.15;
  const fine = fineFor(c.S);
  const gun = c.design.mounts[0] ? MODULE_BY_ID.get(c.design.mounts[0]!) : undefined;
  const D = DRAW_D[(gun?.mount ?? 'S') as MountClass];

  // ---- heights: the hull rides high on its legs
  const yBelly = 1.0 * k, yShoulder = 1.75 * k, yDeck = 2.25 * k;

  // ---- the hull: an arrowhead carrier body, stations from the stern (-x) to the bow (+x)
  stationHull(b, kit.hull, [
    [-3.15 * k, 1.05 * k, yBelly + 0.15 * k, yShoulder - 0.05 * k, yDeck - 0.15 * k, 0.78],
    [-2.4 * k, 1.35 * k, yBelly, yShoulder, yDeck, 0.82],
    [0.2 * k, 1.45 * k, yBelly, yShoulder, yDeck, 0.84],
    [1.9 * k, 1.1 * k, yBelly + 0.1 * k, yShoulder - 0.1 * k, yDeck - 0.25 * k, 0.7],
    [3.0 * k, 0.55 * k, yBelly + 0.35 * k, yShoulder - 0.3 * k, yDeck - 0.75 * k, 0.5],
    [3.42 * k, 0.18 * k, yBelly + 0.6 * k, yShoulder - 0.45 * k, yDeck - 1.05 * k, 0.4],
  ], 0, 0.8);
  // belly keel (dark) and a team-colour band along the shoulders
  stationHull(b, kit.trim, [
    [-2.9 * k, 0.75 * k, yBelly - 0.12 * k, yBelly + 0.1 * k, yBelly + 0.15 * k, 1],
    [2.2 * k, 0.6 * k, yBelly - 0.12 * k, yBelly + 0.1 * k, yBelly + 0.15 * k, 1],
  ], 0, 0.9);
  both((s) => {
    b.box(kit.accent, 4.6 * k, 0.12 * k, 0.05 * k, -0.35 * k, yShoulder + 0.02 * k, s * 1.43 * k, 0.01);
    // flank armour: stacked plates with shadow gaps, lit ports between them
    for (const x of [-2.0, -0.7, 0.6]) {
      armorPlate(b, kit, (x === -0.7 ? kit.shell : kit.armor2), frame([x * k, (yBelly + yShoulder) / 2 + 0.05 * k, s * 1.43 * k], [0, 0, s], [1, 0, 0]), rectP(1.1 * k, 0.5 * k, 0.06 * k), 0.07 * k, { standoff: 0.03 * k });
      glow(b, kit, (x + 0.65) * k, (yBelly + yShoulder) / 2 + 0.05 * k, s * 1.46 * k, 0.12 * k, 0.08 * k, 0.03 * k, undefined, kit.lamp);
    }
  });
  // deck plating on the spine, hazard stripes at the bow
  block(b, kit.armor2, -0.4 * k, yDeck - 0.02, 0, 4.6 * k, 1.9 * k, 0.12 * k, { ch: 0.3 * k });
  hazard(b, kit, 1.9 * k, yDeck - 0.22 * k, 0, 0.12 * k, 1.5 * k, 6, Math.PI / 2);

  // ---- bow: the ramp lowered to the ground as the gate, the hangar mouth glowing behind it
  const rampTop: V3 = [2.55 * k, yBelly + 0.12 * k, 0], rampFoot: V3 = [3.45 * k, 0.04, 0];
  {
    const dx = rampFoot[0] - rampTop[0], dy = rampFoot[1] - rampTop[1], len = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    b.box(kit.armor, len, 0.1 * k, 1.25 * k, (rampTop[0] + rampFoot[0]) / 2, (rampTop[1] + rampFoot[1]) / 2, 0, 0.02, [0, 0, a]);
    for (let i = 0; i < 4; i++) {
      const f = (i + 0.5) / 4;
      b.box(kit.trim, 0.06 * k, 0.03 * k, 1.1 * k, rampTop[0] + dx * f, rampTop[1] + dy * f + 0.06 * k, 0, 0.005, [0, 0, a]);
    }
    both((s) => glow(b, kit, (rampTop[0] + rampFoot[0]) / 2, (rampTop[1] + rampFoot[1]) / 2 + 0.07 * k, s * 0.6 * k, len * 0.95, 0.04 * k, 0.05 * k, [0, 0, a]));
    // hangar mouth: a dark recess with a lit interior strip
    b.box(kit.trim, 0.3 * k, 0.6 * k, 1.1 * k, 2.45 * k, yBelly + 0.42 * k, 0, 0.03);
    glow(b, kit, 2.56 * k, yBelly + 0.5 * k, 0, 0.04 * k, 0.32 * k, 0.9 * k, undefined, kit.lamp);
  }
  // bow prow: armoured beak over the ramp, twin headlamps
  block(b, kit.armor, 2.6 * k, yShoulder - 0.35 * k, 0, 1.4 * k, 1.3 * k, 0.5 * k, { top: [0.6, 0.7], shift: [0.25 * k, 0], ch: 0.25 * k });
  both((s) => cagedLamp(b, kit, frame([3.05 * k, yShoulder - 0.25 * k, s * 0.38 * k], [1, 0.2, 0], [0, 0, 1]), 0.13 * k, fine));

  // ---- landing legs: four splayed hydraulic legs from the hull's hardpoints to broad pads dug into the ground
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const hip: V3 = [sx * 1.7 * k - 0.2 * k, yBelly + 0.15 * k, sz * 1.15 * k];
    const knee: V3 = [sx * 2.35 * k - 0.2 * k, 0.75 * k, sz * 2.2 * k];
    const foot: V3 = [sx * 2.5 * k - 0.2 * k, 0.12 * k, sz * 2.55 * k];
    block(b, kit.mech, hip[0], yBelly - 0.15 * k, hip[2], 0.55 * k, 0.55 * k, 0.4 * k, { top: [0.8, 0.8], ch: 0.12 * k });
    b.strut(kit.mech, hip, knee, 0.24 * k, 0.2 * k, 8);
    b.strut(kit.mech, knee, foot, 0.2 * k, 0.17 * k, 8);
    // armoured covers over both leg segments, a big knee drum
    const mid = (p: V3, q: V3, f: number): V3 => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
    beam(b, kit.armor, mid(hip, knee, 0.12), mid(hip, knee, 0.85), 0.4 * k, 0.3 * k, [0, 1, 0]);
    beam(b, kit.armor2, mid(knee, foot, 0.15), mid(knee, foot, 0.7), 0.32 * k, 0.24 * k, [0, 1, 0]);
    b.lathe(kit.joint, [[0, -0.2 * k], [0.26 * k, -0.2 * k], [0.26 * k, 0.2 * k], [0, 0.2 * k]], knee, 'z', 14);
    piston(b, kit, [hip[0], hip[1] - 0.2 * k, hip[2] * 0.8], [(knee[0] + foot[0]) / 2, (knee[1] + foot[1]) / 2, (knee[2] + foot[2]) / 2], 0.06 * k, 0.55, fine);
    // pad: a broad octagonal foot, half sunk, ringed by a dark berm (it has stood here a long time)
    planLoft(b, kit.trim, ngon(8, 0.62 * k, 0.62 * k), [[-0.02, 1.15], [0.06 * k, 1.0]], [foot[0], foot[2]]);
    planLoft(b, kit.mech, ngon(8, 0.48 * k, 0.48 * k), [[0.04 * k, 1.0], [0.2 * k, 0.86]], [foot[0], foot[2]]);
    hazard(b, kit, foot[0], 0.2 * k, foot[2], 0.5 * k, 0.1 * k, 3, sz * 0.8);
  }

  // ---- wing ramparts: the folded wings planted along both flanks as armoured walls, raked outward
  both((s) => {
    const zi = s * 1.6 * k, zo = s * 3.2 * k;
    // three armoured wing panels with dark gaps between them, a bright edge strip along each panel's top
    const ring = (x: number, lift: number): V3[] => [[x, 0.02, zo], [x, 0.02, zo - s * 0.32 * k], [x, yShoulder - 0.2 * k + lift, zi], [x, yShoulder + lift, zi + s * 0.14 * k]];
    for (const [x0, x1] of [[-1.9, -0.88], [-0.78, 0.25], [0.35, 1.4]] as const) {
      b.loft(kit.armor2, [ring(x0 * k, 0), ring(x1 * k, 0)]);
      b.loft(kit.armor, [ring((x0 + 0.08) * k, 0.03 * k).map(([x, y, z]) => [x, y, z + s * 0.02 * k] as V3).slice(2).concat([[(x0 + 0.08) * k, yShoulder - 0.45 * k, zi + s * 0.32 * k], [(x0 + 0.08) * k, yShoulder - 0.3 * k, zi + s * 0.38 * k]]),
        ring((x1 - 0.08) * k, 0.03 * k).map(([x, y, z]) => [x, y, z + s * 0.02 * k] as V3).slice(2).concat([[(x1 - 0.08) * k, yShoulder - 0.45 * k, zi + s * 0.32 * k], [(x1 - 0.08) * k, yShoulder - 0.3 * k, zi + s * 0.38 * k]])]);
    }
    b.box(kit.trim, 3.3 * k, 0.04 * k, Math.abs(zo - zi) * 0.95, -0.25 * k, 0.02, (zi + zo) / 2, 0.005);
    // the wing's leading edge cap, nav light at its tip, braces and a glow seam where it hinges
    block(b, kit.armor2, 1.55 * k, 0.02, (zi + zo) / 2, 0.35 * k, Math.abs(zo - zi) * 0.95, 0.9 * k, { top: [0.6, 0.6], ch: 0.08 * k });
    glow(b, kit, 1.7 * k, 0.75 * k, zo - s * 0.15 * k, 0.12 * k, 0.12 * k, 0.12 * k, undefined, s > 0 ? kit.glow : kit.hot);
    for (const x of [-1.2, -0.25, 0.7]) {
      const a: V3 = [x * k, 0.05, zo - s * 0.15 * k], e: V3 = [x * k, yShoulder - 0.05 * k, zi + s * 0.08 * k];
      b.strut(kit.trim, a, e, 0.05 * k, 0.05 * k, 6);
    }
    glow(b, kit, -0.25 * k, yShoulder - 0.08 * k, zi + s * 0.05 * k, 3.0 * k, 0.05 * k, 0.06 * k, undefined, kit.plasma);
  });

  // ---- stern: twin engine nacelles, cooling (embers in the nozzles)
  both((s) => {
    const z = s * 0.95 * k, y = yShoulder - 0.15 * k;
    b.lathe(kit.armor2, [[0, 0], [0.42 * k, 0], [0.55 * k, 0.5 * k], [0.58 * k, 1.5 * k], [0.5 * k, 1.9 * k], [0, 1.9 * k]], [-1.4 * k, y, z], 'x', 16, [0, 0, Math.PI]);
    b.cyl(kit.trim, 0.44 * k, 0.36 * k, 0.25 * k, [-3.55 * k, y, z], 'x', 16);
    b.cyl(kit.hot, 0.3 * k, 0.3 * k, 0.03 * k, [-3.58 * k, y, z], 'x', 14);
    for (const f of [0.3, 0.7]) b.cylb(kit.accent, 0.585 * k, 0.07 * k, 0.01, [-1.4 * k - (1.5 * f + 0.2) * k, y, z], 'x', 16);
  });

  // ---- the reactor on the spine (astern of the gun): an armoured ring round a glowing core, braces
  const rx = -1.95 * k;
  b.lathe(kit.armor2, [[0.42 * k, 0], [0.62 * k, 0], [0.62 * k, 0.35 * k], [0.5 * k, 0.45 * k], [0.42 * k, 0.45 * k]], [rx, yDeck, 0], 'y', 18);
  b.lathe(kit.plasma, [[0, 0], [0.42 * k, 0], [0.4 * k, 0.32 * k], [0.25 * k, 0.5 * k], [0, 0.55 * k]], [rx, yDeck, 0], 'y', 16);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.box(kit.mech, 0.12 * k, 0.5 * k, 0.12 * k, rx + Math.cos(a) * 0.66 * k, yDeck + 0.2 * k, Math.sin(a) * 0.66 * k, 0.02);
  }

  // ---- command island: off-centre astern (starboard), bridge glow band, mast, sensor dome
  const ix = -2.35 * k, iz = 1.0 * k, iTop = yDeck + 2.1 * k;
  block(b, kit.hull, ix, yDeck - 0.05, iz, 1.1 * k, 0.7 * k, iTop - yDeck, { top: [0.75, 0.8], shift: [-0.12 * k, 0], ch: 0.15 * k, bev: 0.04 });
  block(b, kit.armor, ix + 0.08 * k, iTop - 0.42 * k, iz, 1.25 * k, 0.82 * k, 0.32 * k, { top: [0.86, 0.9], ch: 0.15 * k });
  glow(b, kit, ix + 0.6 * k, iTop - 0.28 * k, iz, 0.06 * k, 0.12 * k, 0.65 * k, undefined, kit.lamp);
  both((s) => glow(b, kit, ix + 0.1 * k, iTop - 0.28 * k, iz + s * 0.42 * k, 0.9 * k, 0.12 * k, 0.04 * k, undefined, kit.lamp));
  whip(b, kit, ix - 0.25 * k, iTop - 0.05, iz, 1.4 * k);
  sensorDome(b, kit, ix + 0.2 * k, iTop - 0.1 * k, iz - 0.15 * k, 0.18 * k);
  // comms dish on a post on the port side astern
  {
    const dx0 = -2.55 * k, dz0 = -0.95 * k, dy0 = yDeck;
    b.cylb(kit.metal, 0.08 * k, 0.6 * k, 0.01, [dx0, dy0, dz0], 'y', 8);
    b.lathe(kit.shell, [[0, 0], [0.45 * k, 0.12 * k], [0.47 * k, 0.16 * k], [0, 0.06 * k]], [dx0, dy0 + 0.62 * k, dz0], 'y', 16, [0, 0, 0.9]);
    b.cylb(kit.lamp, 0.05 * k, 0.1 * k, 0.01, [dx0 + 0.15 * k, dy0 + 0.8 * k, dz0], 'y', 6);
  }

  // ---- the camp round the legs: cargo containers, fuel tanks, a beacon
  const crate = (x: number, y: number, z: number, ry: number, mat = kit.shell) => {
    b.box(mat, 0.75 * k, 0.4 * k, 0.4 * k, x, y + 0.2 * k, z, 0.03, [0, ry, 0]);
    b.box(kit.trim, 0.77 * k, 0.05 * k, 0.42 * k, x, y + 0.3 * k, z, 0.01, [0, ry, 0]);
  };
  crate(-3.0 * k, 0, 2.6 * k, 0.15);
  crate(-3.05 * k, 0, 2.12 * k, -0.1, kit.armor);
  crate(-3.0 * k, 0.4 * k, 2.38 * k, 0.05, kit.armor2);
  both((s) => {
    for (const dz of [0, 0.42]) {
      const z = s * (2.75 - dz) * k;
      b.cylb(kit.armor2, 0.18 * k, 0.55 * k, 0.04, [2.0 * k, 0, z], 'y', 12);
      b.cylb(kit.hazard, 0.185 * k, 0.06 * k, 0.005, [2.0 * k, 0.4 * k, z], 'y', 12);
    }
  });
  b.cylb(kit.metal, 0.05 * k, 1.1 * k, 0.01, [-3.15 * k, 0, -2.75 * k], 'y', 6);
  glow(b, kit, -3.15 * k, 1.12 * k, -2.75 * k, 0.14 * k, 0.14 * k, 0.14 * k);

  // ---- the gun cupola: amidships on the spine, sized round the equipped gun (a big one rides a raised drum)
  const cr = D * 0.58 + 0.15 * k; // cupola radius: S ~0.6, M ~1.0, L ~1.9, XL ~3.2 cells
  const ch = D * 0.3 + 0.12 * k; // cupola height
  const neck = cr > 2.2 * k ? 1.0 * k : cr > 1.5 * k ? 0.45 * k : 0.08 * k;
  const gx = 0.45 * k; // the cupola's pivot along the spine
  const rn = Math.min(cr * 0.8, 1.25 * k);
  planLoft(b, kit.trim, ngon(16, rn, rn), [[yDeck - 0.04, 1.1], [yDeck + neck * 0.35, 1.0], [yDeck + neck, 1.0]], [gx, 0]);
  if (neck > 0.2) planLoft(b, kit.accent, ngon(16, rn, rn), [[yDeck + neck * 0.5, 1.01], [yDeck + neck * 0.64, 1.01]], [gx, 0]);
  const at: V3 = [gx, yDeck + neck, 0];
  const hp0: V3 = [cr * 0.12, ch * 1.02, 0];
  const cupola = (t: typeof b) => {
    const Pc: P2[] = ngon(8, cr, cr);
    planLoft(t, kit.armor, Pc, [[0, 0.92], [0.12 * ch, 1.0], [0.62 * ch, 1.0], [0.9 * ch, 0.86], [ch, 0.74]]);
    planLoft(t, kit.mech, Pc, [[0.12 * ch, 1.012], [0.2 * ch, 1.012]]);
    both((s) => {
      armorPlate(t, kit, kit.armor2, frame([cr * 0.1, ch * 0.42, s * cr * 0.98], [0, 0.15, s], [1, 0, 0]), rectP(cr * 0.8, ch * 0.4, cr * 0.06), cr * 0.04, { standoff: cr * 0.02 });
      glow(t, kit, cr * 0.75, ch * 0.4, s * cr * 0.55, cr * 0.06, ch * 0.07, cr * 0.32);
    });
    block(t, kit.armor2, -cr * 0.48, ch * 0.96, 0, cr * 0.42, cr * 0.5, ch * 0.16, { top: [0.8, 0.8], ch: cr * 0.06 });
    hazard(t, kit, -cr * 0.95, ch * 0.2, 0, cr * 0.6, ch * 0.08, 4, Math.PI / 2);
  };

  return {
    deckAt: (x, z) => (Math.abs(z) < 1.2 * k && x > -3 * k && x < 2 * k ? yDeck : -1), top: Math.max(yDeck + 1.6 * k, at[1] + ch + 0.5), custom: true, dressed: true,
    ownGround: true,
    seat: (m: MountSpec) => ({ y: m === c.mounts[0] ? at[1] : yDeck + 0.2 * k, socket: true }),
    torso: (t) => {
      cupola(t);
      return { hp: [hp0], at };
    },
  };
}
