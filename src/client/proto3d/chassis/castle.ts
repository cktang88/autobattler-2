// Tug of war castle (shared/tug.ts castleDesign: a Monolith on an anchor in the sim, design id 'tug-castle', one gun
// of ANY class). Concept: the side's mothership, set down for good and turned into a forward base.
//   * a smooth, wedge-nosed carrier hull jacked up on four splayed hydraulic landing legs, bow toward the enemy;
//   * the bow ramp lowered to the ground as the base's gate, a glowing hangar mouth behind it;
//   * the folded wing panels planted in the ground along both flanks as armoured ramparts;
//   * twin engine nacelles astern with lit cores, plasma lips and turbine vanes; a carrier-style command island
//     off-centre astern with a lit bridge band, mast, sensor dome and comms dish;
//   * the exposed reactor on the spine: a glowing core in a ring of glowing coils, the thing worth defending;
//   * light-lines along the hull, lit landing pads, a camp of crates, fuel tanks and a beacon round the legs;
//   * amidships on the spine, an armoured gun cupola that turns with the gun (torso mode). The castle buys bigger and
//     smaller guns during a game, so the cupola is sized round the equipped gun's class (DRAW_D): a slim dome under a
//     heavy MG, a broad dome on a raised drum under a titan gun. The gun itself stays its class size.
// Everything round is round: 36-point hull sections and 40-48 segment lathes (no octagons standing in for circles).
// Top-down: an arrowhead hull between two wall slabs, four lit leg pads at the corners, unlike any other hull.

import { DRAW_D } from '../weapons3d.ts';
import { MODULE_BY_ID } from '../../../shared/parts.ts';
import type { MountClass } from '../../../shared/types.ts';
import type { Bld, P2, V3 } from '../geo.ts';
import type { ChassisCtx, ChassisOut, MountSpec } from './registry.ts';
import { beam, block, both, glow, hazard } from './shapes.ts';
import { armorPlate, fineFor, frame, piston, rectP } from './hs-kit.ts';
import { whip } from './titan-greebles.ts';

/** shared/tug.ts castleDesign's id (not imported: the proto3d bundle stays free of the game rules) */
export const CASTLE_ID = 'tug-castle';
/** is this the castle? ('tug-castle#n': several in one proto3d lab lineup) */
export const isCastle = (id: string): boolean => id === CASTLE_ID || id.startsWith(CASTLE_ID + '#');

const TAU = Math.PI * 2;
/** mesh simplification error for the castle (geo.ts Bld.simp; the default is 0.004) */
const CASTLE_SIMP = 0.0008;
/** signed power: superellipse sections (p < 1 squares the circle off, 1 is an ellipse) */
const sp = (u: number, p: number) => Math.sign(u) * Math.pow(Math.abs(u), p);
const smooth = (t: number) => t * t * (3 - 2 * t);
/** a torus as a lathe: a circle of radius r centred `R` out from the axis */
const torusP = (R: number, r: number, n = 14): P2[] => {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * TAU - Math.PI / 2; out.push([R + Math.cos(a) * r, Math.sin(a) * r]); }
  return out;
};
/** a rounded dome profile (radius R, wall height h, shoulder radius rr, flat top) */
const domeP = (R: number, h: number, rr: number, n = 8): P2[] => {
  const out: P2[] = [[0, 0], [R, 0], [R, h - rr]];
  for (let i = 1; i <= n; i++) { const a = (i / n) * (Math.PI / 2); out.push([R - rr + Math.cos(a) * rr, h - rr + Math.sin(a) * rr]); }
  out.push([0, h]);
  return out;
};

export function castle(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W } = c;
  // round parts must stay round: the default mesh simplification (relative to the merged mesh's size) cut this
  // 8-cell hull's 40-segment circles down to ~9-gons
  b.simp = CASTLE_SIMP;
  // drawn a little past its 7-cell sim footprint: the base has to read as the biggest, most valuable thing on the
  // field. The sim widens its collision circle to match (shared/tug.ts CASTLE_RADIUS 3.5 cells, x bodyScale 0.78 in
  // the game: walls, legs and pads all stay inside it, so units walk round the base, not through its legs)
  const k = (Math.min(L, W) / 7) * 1.1;
  const fine = fineFor(c.S);
  const gun = c.design.mounts[0] ? MODULE_BY_ID.get(c.design.mounts[0]!) : undefined;
  const D = DRAW_D[(gun?.mount ?? 'S') as MountClass];

  // ---- the hull: a smooth arrowhead body. Control stations (x, half width, belly y, top y), stern (-x) to bow (+x),
  // eased between, swept as 36-point superellipse sections
  const CP: [number, number, number, number][] = [
    [-3.25, 0.95, 1.15, 2.05], [-2.8, 1.3, 1.0, 2.3], [-1.5, 1.45, 0.95, 2.42], [0.5, 1.45, 0.95, 2.4],
    [1.8, 1.15, 1.02, 2.15], [2.8, 0.7, 1.2, 1.78], [3.42, 0.22, 1.42, 1.52],
  ];
  const prof = (x: number): [number, number, number] => {
    const xs = x / k;
    if (xs <= CP[0][0]) return [CP[0][1] * k, CP[0][2] * k, CP[0][3] * k];
    for (let i = 0; i < CP.length - 1; i++) {
      const a = CP[i], e = CP[i + 1];
      if (xs <= e[0]) { const t = smooth((xs - a[0]) / (e[0] - a[0])); return [(a[1] + (e[1] - a[1]) * t) * k, (a[2] + (e[2] - a[2]) * t) * k, (a[3] + (e[3] - a[3]) * t) * k]; }
    }
    const l = CP[CP.length - 1];
    return [l[1] * k, l[2] * k, l[3] * k];
  };
  const NS = 36;
  /** a point on the hull skin at x, section angle a (0 = +z side, PI/2 = top) */
  const skin = (x: number, a: number, grow = 0, p = 0.62): V3 => {
    const [hw, y0, y1] = prof(x), yc = (y0 + y1) / 2, ry = (y1 - y0) / 2;
    return [x, yc + (ry + grow) * sp(Math.sin(a), p), (hw + grow) * sp(Math.cos(a), p)];
  };
  const ring = (x: number, grow = 0, a0 = -Math.PI / 2, a1 = Math.PI * 1.5, n = NS, p = 0.62): V3[] => {
    const out: V3[] = [];
    for (let i = 0; i < n; i++) out.push(skin(x, a0 + ((a1 - a0) * i) / n, grow, p));
    return out;
  };
  const sweep = (mat: Parameters<Bld['loft']>[0], x0: number, x1: number, n: number, grow = 0, p = 0.62) => {
    const rings: V3[][] = [];
    for (let i = 0; i <= n; i++) rings.push(ring(x0 + ((x1 - x0) * i) / n, grow, -Math.PI / 2, Math.PI * 1.5, NS, p));
    b.loft(mat, rings);
  };
  const xS = -3.25 * k, xB = 3.42 * k;
  sweep(kit.hull, xS, xB, 22);
  const top = (x: number) => prof(x)[2];
  const belly = (x: number) => prof(x)[1];
  const half = (x: number) => prof(x)[0];

  // armour belts: raised bands of the skin itself (a slightly bigger section over a short run), dark keel below
  for (const [x0, x1, mat] of [[-2.9, -1.95, kit.armor2], [-1.7, -0.25, kit.shell], [0.0, 1.45, kit.armor2]] as const) sweep(mat, x0 * k, x1 * k, 6, 0.045 * k);
  {
    const rings: V3[][] = [];
    for (let i = 0; i <= 14; i++) {
      const x = -2.9 * k + (5.2 * k * i) / 14, [hw, y0] = prof(x), w = hw * 0.55;
      const r: V3[] = [];
      for (let j = 0; j < 24; j++) { const a = (j / 24) * TAU; r.push([x, y0 + 0.02 * k + 0.16 * k * sp(Math.sin(a), 0.7), w * sp(Math.cos(a), 0.7)]); }
      rings.push(r);
    }
    b.loft(kit.trim, rings);
  }
  // the spine: a raised flat-topped deck along the top, its edges lit
  const spX0 = -2.75 * k, spX1 = 1.7 * k, spH = 0.14 * k;
  {
    const rings: V3[][] = [];
    for (let i = 0; i <= 14; i++) {
      const x = spX0 + ((spX1 - spX0) * i) / 14, w = half(x) * 0.58, y = top(x) - 0.06 * k;
      const r: V3[] = [];
      for (let j = 0; j < 28; j++) { const a = (j / 28) * TAU; r.push([x, y + spH / 2 + (spH / 2) * sp(Math.sin(a), 0.35), w * sp(Math.cos(a), 0.35)]); }
      rings.push(r);
    }
    b.loft(kit.armor2, rings);
  }
  const deck = (x: number) => top(x) - 0.06 * k + spH;
  /** a continuous glowing band laid along the hull skin at section angle a (chunky enough to bloom, never a string):
   *  a flat ribbon `w` wide standing `h` proud of the skin, swept from x0 to x1 */
  const band = (mat: Parameters<Bld['loft']>[0], a: number, x0: number, x1: number, w: number, h: number, n = 24) => {
    const rings: V3[][] = [];
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, p = skin(x, a, 0), q = skin(x, a, 0.1);
      const nn: V3 = [(q[0] - p[0]) / 0.1, (q[1] - p[1]) / 0.1, (q[2] - p[2]) / 0.1];
      const u0 = skin(x, a - 0.02, 0), u1 = skin(x, a + 0.02, 0);
      const ul = Math.hypot(u1[1] - u0[1], u1[2] - u0[2]) || 1, u: V3 = [0, (u1[1] - u0[1]) / ul, (u1[2] - u0[2]) / ul];
      const P = (sw: number, sh: number): V3 => [p[0] + nn[0] * sh, p[1] + u[1] * sw + nn[1] * sh, p[2] + u[2] * sw + nn[2] * sh];
      rings.push([P(-w, -0.01), P(w, -0.01), P(w, h), P(-w, h)]);
    }
    b.loft(mat, rings);
  };
  // light-lines: a broad glowing team band along both shoulders, a dark channel it sits in, a warm row of ports below
  both((s) => {
    const a = s > 0 ? 0.6 : Math.PI - 0.6;
    band(kit.trim, a, -3.05 * k, 2.85 * k, 0.09 * k, 0.03 * k);
    band(kit.glow, a, -2.95 * k, 2.75 * k, 0.05 * k, 0.05 * k);
    for (let i = 0; i < 9; i++) {
      const x = (-2.6 + i * 0.52) * k, p = skin(x, s > 0 ? 0.28 : Math.PI - 0.28, 0.05 * k);
      b.cyl(kit.lamp, 0.06 * k, 0.06 * k, 0.03 * k, [p[0], p[1], p[2]], s > 0 ? 'z' : '-z', 16);
    }
    // flank armour plates riding the belts
    for (const x of [-2.4, -1.0, 0.7]) {
      const p = skin(x * k, s > 0 ? 0.12 : Math.PI - 0.12, 0.08 * k);
      armorPlate(b, kit, x === -1.0 ? kit.armor : kit.armor2, frame(p, [0, 0.12, s], [1, 0, 0]), rectP(0.9 * k, 0.42 * k, 0.08 * k), 0.06 * k, { standoff: 0.02 * k });
    }
  });
  hazard(b, kit, 1.95 * k, deck(1.95 * k) - 0.04 * k, 0, 0.12 * k, 1.1 * k, 6, Math.PI / 2);

  // ---- bow: the ramp lowered to the ground as the gate, the hangar mouth glowing behind it, a lit prow
  const rampTop: V3 = [2.55 * k, belly(2.55 * k) + 0.12 * k, 0], rampFoot: V3 = [3.5 * k, 0.04, 0];
  {
    const dx = rampFoot[0] - rampTop[0], dy = rampFoot[1] - rampTop[1], len = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    b.box(kit.armor, len, 0.1 * k, 1.25 * k, (rampTop[0] + rampFoot[0]) / 2, (rampTop[1] + rampFoot[1]) / 2, 0, 0.03, [0, 0, a]);
    for (let i = 0; i < 5; i++) {
      const f = (i + 0.5) / 5;
      b.box(kit.trim, 0.05 * k, 0.03 * k, 1.05 * k, rampTop[0] + dx * f, rampTop[1] + dy * f + 0.06 * k, 0, 0.005, [0, 0, a]);
    }
    both((s) => {
      glow(b, kit, (rampTop[0] + rampFoot[0]) / 2, (rampTop[1] + rampFoot[1]) / 2 + 0.07 * k, s * 0.6 * k, len * 0.95, 0.05 * k, 0.1 * k, [0, 0, a]);
      for (let i = 0; i < 4; i++) { const f = (i + 0.5) / 4; b.cyl(kit.lamp, 0.045 * k, 0.045 * k, 0.03 * k, [rampTop[0] + dx * f, rampTop[1] + dy * f + 0.06 * k, s * 0.66 * k], 'y', 14); }
    });
    // hangar mouth: a dark rounded recess, the bay lit inside
    b.box(kit.trim, 0.35 * k, 0.62 * k, 1.12 * k, 2.42 * k, belly(2.42 * k) + 0.42 * k, 0, 0.12 * k);
    glow(b, kit, 2.6 * k, belly(2.6 * k) + 0.5 * k, 0, 0.04 * k, 0.36 * k, 0.92 * k, undefined, kit.lamp);
  }
  // prow: a glowing sensor eye in a rounded armour cowl, twin lit headlamps
  b.lathe(kit.armor, domeP(0.36 * k, 0.32 * k, 0.24 * k, 10), [3.0 * k, top(3.0 * k) - 0.1 * k, 0], 'x', 40);
  b.lathe(kit.plasma, domeP(0.2 * k, 0.12 * k, 0.1 * k, 8), [3.3 * k, top(3.0 * k) - 0.1 * k, 0], 'x', 32);
  both((s) => {
    const p = skin(2.75 * k, s > 0 ? 0.35 : Math.PI - 0.35, 0.02 * k);
    b.lathe(kit.trim, [[0, 0], [0.12 * k, 0], [0.13 * k, 0.06 * k], [0.1 * k, 0.08 * k], [0, 0.08 * k]], p, 'x', 32);
    b.cyl(kit.lamp, 0.09 * k, 0.09 * k, 0.02 * k, [p[0] + 0.07 * k, p[1], p[2]], 'x', 32);
  });

  // ---- landing legs: four splayed hydraulic legs from the hull's hardpoints to lit pads sunk into the ground
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const hx = sx * 1.7 * k - 0.2 * k;
    const hip: V3 = [hx, belly(hx) + 0.2 * k, sz * 1.1 * k];
    const knee: V3 = [sx * 2.25 * k - 0.2 * k, 0.8 * k, sz * 2.1 * k];
    const foot: V3 = [sx * 2.38 * k - 0.2 * k, 0.16 * k, sz * 2.4 * k];
    b.lathe(kit.armor2, [[0, -0.3 * k], [0.3 * k, -0.3 * k], [0.34 * k, -0.1 * k], [0.34 * k, 0.15 * k], [0.26 * k, 0.25 * k], [0, 0.25 * k]], [hip[0], hip[1] - 0.25 * k, hip[2]], 'y', 40);
    b.strut(kit.mech, hip, knee, 0.22 * k, 0.19 * k, 24);
    b.strut(kit.mech, knee, foot, 0.19 * k, 0.16 * k, 24);
    const mid = (p: V3, q: V3, f: number): V3 => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
    beam(b, kit.armor, mid(hip, knee, 0.12), mid(hip, knee, 0.85), 0.42 * k, 0.32 * k, [0, 1, 0]);
    beam(b, kit.armor2, mid(knee, foot, 0.15), mid(knee, foot, 0.7), 0.34 * k, 0.26 * k, [0, 1, 0]);
    // knee: a big drum with a glowing hub ring
    b.lathe(kit.armor2, [[0, -0.22 * k], [0.27 * k, -0.22 * k], [0.3 * k, -0.18 * k], [0.3 * k, 0.18 * k], [0.27 * k, 0.22 * k], [0, 0.22 * k]], [knee[0], knee[1], knee[2] - 0.22 * k * 0], 'z', 40);
    b.lathe(kit.glow, torusP(0.2 * k, 0.03 * k, 10), [knee[0], knee[1], knee[2] + sz * 0.23 * k], 'z', 40);
    piston(b, kit, [hip[0], hip[1] - 0.25 * k, hip[2] * 0.8], mid(knee, foot, 0.5), 0.065 * k, 0.55, fine);
    // pad: a broad round foot, half sunk, ringed by a dark berm and a band of lights
    b.lathe(kit.trim, [[0, -0.02], [0.78 * k, -0.02], [0.7 * k, 0.07 * k], [0, 0.07 * k]], [foot[0], 0, foot[2]], 'y', 48);
    b.lathe(kit.mech, [[0, 0], [0.55 * k, 0], [0.56 * k, 0.12 * k], [0.46 * k, 0.24 * k], [0, 0.26 * k]], [foot[0], 0.04 * k, foot[2]], 'y', 48);
    b.lathe(kit.glow, torusP(0.63 * k, 0.025 * k, 8), [foot[0], 0.08 * k, foot[2]], 'y', 48);
    hazard(b, kit, foot[0], 0.3 * k, foot[2], 0.42 * k, 0.08 * k, 3, sz * 0.8);
  }

  // ---- wing ramparts: the folded wings planted along both flanks as armoured walls, lit along their crest
  both((s) => {
    const zi = s * 1.62 * k, zo = s * 3.2 * k, yTop = 1.62 * k;
    const sec = (x: number, lift: number): V3[] => [[x, 0.02, zo], [x, 0.02, zo - s * 0.32 * k], [x, yTop - 0.22 * k + lift, zi], [x, yTop + lift, zi + s * 0.14 * k]];
    for (const [x0, x1] of [[-1.9, -0.88], [-0.78, 0.25], [0.35, 1.4]] as const) {
      b.loft(kit.armor2, [sec(x0 * k, 0), sec(x1 * k, 0)]);
      // a raised armour panel on the outer face of each wing segment
      const cz = (zi + zo) / 2, cy = yTop * 0.5;
      armorPlate(b, kit, kit.armor, frame([((x0 + x1) / 2) * k, cy, cz + s * 0.12 * k], [0, Math.abs(zo - zi) / Math.hypot(yTop, zo - zi), s * yTop / Math.hypot(yTop, zo - zi)], [1, 0, 0]), rectP((x1 - x0) * 0.82 * k, Math.hypot(yTop, zo - zi) * 0.62, 0.08 * k), 0.05 * k, { standoff: 0.03 * k });
    }
    glow(b, kit, -0.25 * k, yTop + 0.04 * k, zi + s * 0.07 * k, 3.3 * k, 0.06 * k, 0.12 * k);
    b.box(kit.trim, 3.3 * k, 0.04 * k, Math.abs(zo - zi) * 0.95, -0.25 * k, 0.02, (zi + zo) / 2, 0.005);
    // the wing tip: a rounded leading-edge cap with a nav light (green starboard, red port)
    b.lathe(kit.armor, domeP(0.2 * k, 0.4 * k, 0.18 * k, 8), [1.42 * k, 0.5 * k, (zi + zo) / 2], 'x', 32);
    b.lathe(s > 0 ? kit.glow : kit.hot, domeP(0.09 * k, 0.08 * k, 0.08 * k, 6), [1.78 * k, 0.5 * k, (zi + zo) / 2], 'x', 24);
  });

  // ---- stern: twin engine nacelles, round and lit: intake lip, banded body, nozzle with turbine vanes, a hot core,
  // a plasma lip and a short glow cone astern
  both((s) => {
    const z = s * 1.0 * k, y = top(-2.6 * k) - 0.55 * k, xn = -3.7 * k;
    const R = 0.55 * k;
    // body: from the nozzle (aft, x = xn) forward to the intake
    b.lathe(kit.armor2, [[0.3 * k, 0], [0.42 * k, 0], [0.5 * k, 0.12 * k], [R, 0.45 * k], [R * 1.04, 1.2 * k], [R, 1.8 * k], [0.46 * k, 2.15 * k], [0.36 * k, 2.3 * k], [0.36 * k, 2.25 * k], [0.3 * k, 2.2 * k]], [xn, y, z], 'x', 48);
    for (const f of [0.55, 1.65]) b.lathe(kit.accent, [[R * 0.9, 0], [R * 1.09, 0.02 * k], [R * 1.09, 0.12 * k], [R * 0.9, 0.14 * k]], [xn + f * k, y, z], 'x', 48);
    b.lathe(kit.glow, [[R * 0.9, 0], [R * 1.08, 0.02 * k], [R * 1.08, 0.1 * k], [R * 0.9, 0.12 * k]], [xn + 1.1 * k, y, z], 'x', 48);
    // intake: a dark mouth with a spinner
    b.lathe(kit.trim, [[0, 0], [0.32 * k, 0], [0.32 * k, 0.05 * k], [0, 0.05 * k]], [xn + 2.18 * k, y, z], 'x', 40);
    b.lathe(kit.joint, domeP(0.14 * k, 0.12 * k, 0.12 * k, 8), [xn + 2.2 * k, y, z], 'x', 32);
    // nozzle: dark inner wall, turbine vanes, glowing core and plasma lip, and a glow cone trailing astern
    b.lathe(kit.trim, [[0.4 * k, 0.02 * k], [0.36 * k, 0.35 * k], [0, 0.4 * k]], [xn, y, z], 'x', 40);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      b.box(kit.metal, 0.05 * k, 0.03 * k, 0.3 * k, xn + 0.24 * k, y + Math.sin(a) * 0.17 * k, z + Math.cos(a) * 0.17 * k, 0.005, [a, 0, 0.3]);
    }
    b.lathe(kit.hot, domeP(0.2 * k, 0.12 * k, 0.1 * k, 8), [xn + 0.32 * k, y, z], '-x', 32);
    b.lathe(kit.plasma, torusP(0.4 * k, 0.035 * k, 10), [xn + 0.02 * k, y, z], 'x', 48);
    b.lathe(kit.hot, [[0, 0], [0.3 * k, 0], [0.12 * k, 0.32 * k], [0, 0.38 * k]], [xn - 0.01 * k, y, z], '-x', 32);
    // pylon down to the hull
    beam(b, kit.armor, [xn + 0.9 * k, y, z * 0.55], [xn + 1.9 * k, y + 0.1 * k, z * 0.4], 0.3 * k, 0.5 * k, [0, 1, 0]);
  });

  // ---- the reactor on the spine (astern of the gun): a glowing core sphere in a cage of glowing coil rings
  const rx = -1.85 * k, ry0 = deck(rx);
  b.lathe(kit.armor2, [[0, 0], [0.78 * k, 0], [0.8 * k, 0.12 * k], [0.66 * k, 0.2 * k], [0, 0.2 * k]], [rx, ry0, 0], 'y', 48);
  {
    const pr: P2[] = [];
    for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + (i / 12) * Math.PI; pr.push([Math.cos(a) * 0.4 * k, 0.6 * k + Math.sin(a) * 0.4 * k]); }
    b.lathe(kit.plasma, pr, [rx, ry0, 0], 'y', 40);
  }
  for (const [h, R] of [[0.32, 0.6], [0.6, 0.66], [0.88, 0.6]] as const) b.lathe(kit.glow, torusP(R * k, 0.045 * k, 10), [rx, ry0 + h * k, 0], 'y', 48);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    b.strut(kit.mech, [rx + Math.cos(a) * 0.72 * k, ry0 + 0.15 * k, Math.sin(a) * 0.72 * k], [rx + Math.cos(a) * 0.5 * k, ry0 + 1.12 * k, Math.sin(a) * 0.5 * k], 0.05 * k, 0.04 * k, 12);
  }
  b.lathe(kit.armor, [[0, 0], [0.55 * k, 0], [0.5 * k, 0.08 * k], [0, 0.1 * k]], [rx, ry0 + 1.1 * k, 0], 'y', 48);
  b.lathe(kit.lamp, domeP(0.08 * k, 0.1 * k, 0.08 * k, 6), [rx, ry0 + 1.2 * k, 0], 'y', 24);

  // ---- command island: off-centre astern (starboard), rounded tower with a lit bridge ring, mast and comms dish
  {
    const ix = -2.45 * k, iz = 1.0 * k, iy = deck(ix) - 0.04 * k, ih = 2.0 * k;
    b.lathe(kit.hull, [[0, 0], [0.42 * k, 0], [0.4 * k, ih * 0.6], [0.36 * k, ih * 0.66], [0, ih * 0.66]], [ix, iy, iz], 'y', 40);
    b.lathe(kit.accent, [[0.405 * k, ih * 0.2], [0.41 * k, ih * 0.2], [0.41 * k, ih * 0.26], [0.405 * k, ih * 0.26]], [ix, iy, iz], 'y', 40);
    // bridge: a wider drum with a glowing window band, a domed roof
    b.lathe(kit.armor, [[0, 0], [0.5 * k, 0], [0.58 * k, 0.12 * k], [0.58 * k, 0.42 * k], [0.5 * k, 0.5 * k], [0, 0.5 * k]], [ix, iy + ih * 0.62, iz], 'y', 48);
    b.lathe(kit.lamp, [[0.585 * k, 0.2 * k], [0.59 * k, 0.2 * k], [0.59 * k, 0.32 * k], [0.585 * k, 0.32 * k]], [ix, iy + ih * 0.62, iz], 'y', 48);
    b.lathe(kit.armor2, domeP(0.42 * k, 0.24 * k, 0.2 * k, 8), [ix, iy + ih * 0.62 + 0.5 * k, iz], 'y', 40);
    whip(b, kit, ix - 0.12 * k, iy + ih * 0.62 + 0.72 * k, iz, 1.3 * k);
    b.lathe(kit.glow, domeP(0.05 * k, 0.06 * k, 0.05 * k, 6), [ix - 0.12 * k, iy + ih * 0.62 + 2.02 * k, iz], 'y', 16);
    // comms dish on a post, port side astern: a real parabolic bowl with a glowing feed
    const dx0 = -2.6 * k, dz0 = -0.95 * k, dy0 = deck(dx0);
    b.cylb(kit.metal, 0.07 * k, 0.65 * k, 0.01, [dx0, dy0, dz0], 'y', 16);
    const bowl: P2[] = [];
    for (let i = 0; i <= 10; i++) { const r = (i / 10) * 0.5 * k; bowl.push([r, 0.5 * (r * r) / (0.5 * k)]); }
    for (let i = 10; i >= 0; i--) { const r = (i / 10) * 0.48 * k; bowl.push([r, 0.5 * (r * r) / (0.5 * k) + 0.03 * k]); }
    b.lathe(kit.shell, bowl, [dx0, dy0 + 0.66 * k, dz0], 'y', 40, [0, 0, 0.8]);
    b.strut(kit.metal, [dx0, dy0 + 0.7 * k, dz0], [dx0 - 0.25 * k, dy0 + 0.92 * k, dz0], 0.02 * k, 0.02 * k, 8);
    b.lathe(kit.glow, domeP(0.05 * k, 0.05 * k, 0.05 * k, 6), [dx0 - 0.25 * k, dy0 + 0.9 * k, dz0], 'y', 16);
  }

  // ---- the camp round the legs: cargo containers, round fuel tanks with lit gauges, a beacon
  const crate = (x: number, y: number, z: number, ry: number, mat = kit.shell) => {
    b.box(mat, 0.75 * k, 0.4 * k, 0.4 * k, x, y + 0.2 * k, z, 0.04, [0, ry, 0]);
    b.box(kit.trim, 0.77 * k, 0.05 * k, 0.42 * k, x, y + 0.3 * k, z, 0.01, [0, ry, 0]);
    b.box(kit.lamp, 0.12 * k, 0.05 * k, 0.43 * k, x + 0.25 * k, y + 0.12 * k, z, 0.005, [0, ry, 0]);
  };
  crate(-3.0 * k, 0, 2.6 * k, 0.15);
  crate(-3.05 * k, 0, 2.12 * k, -0.1, kit.armor);
  crate(-3.0 * k, 0.4 * k, 2.38 * k, 0.05, kit.armor2);
  both((s) => {
    for (const dz of [0, 0.44]) {
      const z = s * (2.75 - dz) * k;
      b.lathe(kit.armor2, domeP(0.19 * k, 0.6 * k, 0.12 * k, 8), [2.05 * k, 0, z], 'y', 32);
      b.lathe(kit.hazard, [[0.195 * k, 0.38 * k], [0.2 * k, 0.38 * k], [0.2 * k, 0.44 * k], [0.195 * k, 0.44 * k]], [2.05 * k, 0, z], 'y', 32);
      b.cyl(kit.glow, 0.035 * k, 0.035 * k, 0.02 * k, [2.05 * k + 0.19 * k, 0.25 * k, z], 'x', 12);
    }
  });
  b.cylb(kit.metal, 0.05 * k, 1.1 * k, 0.01, [-3.15 * k, 0, -2.75 * k], 'y', 16);
  b.lathe(kit.glow, domeP(0.1 * k, 0.16 * k, 0.1 * k, 8), [-3.15 * k, 1.1 * k, -2.75 * k], 'y', 24);

  // ---- the gun cupola: amidships on the spine, sized round the equipped gun (a big one rides a raised drum)
  const cr = D * 0.58 + 0.15 * k; // cupola radius: S ~0.6, M ~1.0, L ~1.9, XL ~3.2 cells
  const ch = D * 0.3 + 0.12 * k; // cupola height
  const gx = 0.45 * k; // the cupola's pivot along the spine
  const yG = deck(gx);
  const neck = cr > 2.2 * k ? 1.0 * k : cr > 1.5 * k ? 0.45 * k : 0.06 * k;
  const rn = Math.min(cr * 0.8, 1.25 * k);
  b.lathe(kit.trim, [[0, -0.05 * k], [rn * 1.1, -0.05 * k], [rn, neck * 0.3], [rn, neck], [0, neck]], [gx, yG, 0], 'y', 48);
  if (neck > 0.2) b.lathe(kit.glow, torusP(rn * 1.005, 0.03 * k, 8), [gx, yG + neck * 0.6, 0], 'y', 48);
  const at: V3 = [gx, yG + neck, 0];
  const hp0: V3 = [cr * 0.12, ch * 1.02, 0];
  const cupola = (t: Bld) => {
    // a round armoured dome: skirt, wall, rounded shoulder, flat crown; a glowing ring round its waist
    t.lathe(kit.armor, domeP(cr, ch, Math.min(ch * 0.55, cr * 0.4), 10), [0, 0, 0], 'y', 48);
    t.lathe(kit.mech, [[cr * 1.0, 0.06 * ch], [cr * 1.03, 0.08 * ch], [cr * 1.03, 0.2 * ch], [cr * 1.0, 0.22 * ch]], [0, 0, 0], 'y', 48);
    t.lathe(kit.glow, torusP(cr * 1.035, Math.max(0.02, cr * 0.02), 8), [0, 0.14 * ch, 0], 'y', 48);
    // cheek plates either side of the gun slot, lit sight lenses forward, a hatch and vents astern
    both((s) => {
      armorPlate(t, kit, kit.armor2, frame([cr * 0.1, ch * 0.45, s * cr * 0.97], [0, 0.15, s], [1, 0, 0]), rectP(cr * 0.8, ch * 0.4, cr * 0.08), cr * 0.04, { standoff: cr * 0.02 });
      t.lathe(kit.lamp, domeP(cr * 0.07, cr * 0.03, cr * 0.03, 4), [cr * 0.86, ch * 0.5, s * cr * 0.4], 'x', 24);
    });
    t.lathe(kit.armor2, domeP(cr * 0.24, ch * 0.12, ch * 0.08, 6), [-cr * 0.45, ch * 0.97, 0], 'y', 32);
    hazard(t, kit, -cr * 0.97, ch * 0.3, 0, cr * 0.5, ch * 0.07, 4, Math.PI / 2);
  };

  return {
    deckAt: (x, z) => (Math.abs(z) < half(x) * 0.55 && x > spX0 && x < spX1 ? deck(x) : -1), top: Math.max(deck(0) + 1.8 * k, at[1] + ch + 0.5), custom: true, dressed: true,
    ownGround: true,
    seat: (m: MountSpec) => ({ y: m === c.mounts[0] ? at[1] : deck(m.x) + 0.2 * k, socket: true }),
    torso: (t) => {
      t.simp = CASTLE_SIMP;
      cupola(t);
      return { hp: [hp0], at };
    },
  };
}
