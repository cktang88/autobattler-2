// Shared weapon-building kit for the stylized 3D turrets (weapons3d.ts + weapons/*.ts).
// Turret frame: +X = muzzle direction, +Y = up, origin on the deck at the turret ring centre.
// Rig groups: b = yaw (traverse, static housing), p = pitch (elevating cradle / mantlet), rc = recoil (barrels, launch
// boxes: everything that kicks back), sp = spin (gatling clusters, saw discs, drills; rotated about its local +X).
//
// Style rules (chunky toy-like, cel shaded, few big forms):
//   * housings are lofts of 8-point sections (wedges, casemates, hexes) or low-poly lathes (balls, drums), not boxes;
//   * small parts use cbox (32 tris) or plain boxes (12 tris), never the extruded bevel box (60+ tris);
//   * radial segments: 6-8 for barrels and small drums, 10-14 for big drums; one team accent per turret.

import * as THREE from 'three';
import type { ModuleDef } from '../../../shared/types.ts';
import { Bld, sec8, mtx, type V3 } from '../geo.ts';
import type { Kit, MatLike } from '../materials.ts';
import type { Turret } from '../weapons3d.ts';

export interface WCtx {
  /** yaw (static housing) */ b: Bld;
  /** pitch cradle */ p: Bld;
  /** recoiling barrels */ rc: Bld;
  /** spinning cluster (about local +X of t.spin) */ sp: Bld;
  kit: Kit;
  mod: ModuleDef;
  /** housing radius (cells) = D / 2 */ r: number;
  D: number;
  /** 0..1 position inside the size class (calibre, then weight) */ c: number;
  /** absolute barrel outer radius (cells) from the real calibre */ bore: number;
  /** size tier 1..5 (S, M, M-heavy, L, XL) */ tier: number;
  nb: number;
  /** turret ring top (housings sit on this) */ y0: number;
  fixed: boolean;
  /** bevel size for small parts */ bv: number;
  t: Turret;
  /** set once a team accent was placed */
  acc?: boolean;
  muzzle(x: number, y: number, z: number): void;
  /** make the spin group (optionally re-axed: 'z' spins about the turret's lateral axis, e.g. saw discs) */
  spin(axis?: 'x' | 'z', at?: V3): void;
}

const boxG = new THREE.BoxGeometry(1, 1, 1);

/** plain box (12 tris), centred, l along x, h along y, w along z */
export function bx(B: Bld, mat: MatLike, x: number, y: number, z: number, l: number, h: number, w: number, rot?: V3): void {
  B.g(boxG, mat, mtx([x, y, z], rot, [l, h, w]));
}

/** cheap chamfered box (32 tris): top and bottom edges chamfered by e, vertical edges sharp. Centred. */
export function cbox(B: Bld, mat: MatLike, x: number, y: number, z: number, l: number, h: number, w: number, e = Math.min(l, h, w) * 0.16, rot?: V3, top = 1): void {
  e = Math.min(e, l * 0.4, w * 0.4, h * 0.45);
  const L = l / 2, W = w / 2, H = h / 2;
  const rect = (yy: number, ll: number, ww: number): V3[] => [[-ll, yy, -ww], [ll, yy, -ww], [ll, yy, ww], [-ll, yy, ww]];
  const tl = L * top, tw = W * top;
  const rings = [rect(-H, L - e, W - e), rect(-H + e, L, W), rect(H - e, tl, tw), rect(H, Math.max(0.001, tl - e), Math.max(0.001, tw - e))];
  B.loft(mat, rings, true, true, mtx([x, y, z], rot));
}

/** One housing section station: [x, half-width at the waist, half-width at the roof, height]. */
export type Station = [number, number, number, number];

/** Housing loft from plan stations along x (8-point sections: chamfered skirt, straight waist, sloped cheeks, flat roof). */
export function shell(B: Bld, mat: MatLike, st: Station[], y: number, z = 0, m?: THREE.Matrix4): void {
  B.loft(mat, st.map(([x, w, wt, h]) => sec8(x, w * 0.86, w, wt, y, y + h * 0.16, y + h * 0.58, y + h).map((v) => [v[0], v[1], v[2] + z] as V3)), true, true, m);
}

/** Barrel along +X from x0: optional breech block, tapered tube, sleeve, bore evacuator and muzzle device; adds a muzzle. */
export function barrel(C: WCtx, B: Bld, o: {
  len: number; rad: number; x0?: number; y?: number; z?: number; seg?: number; mat?: MatLike;
  sleeve?: boolean; evac?: boolean; brake?: 'slot' | 'cone' | 'flash' | 'block' | 'none'; taper?: number; noMuzzle?: boolean;
}): number {
  const { kit } = C;
  const x0 = o.x0 ?? 0, y = o.y ?? 0, z = o.z ?? 0, R = o.rad, L = o.len, seg = o.seg ?? 8;
  const tp = o.taper ?? 0.82;
  const at: V3 = [x0, y, z];
  const brake = o.brake ?? 'none';
  const bl = brake === 'none' ? 0 : brake === 'flash' ? R * 3 : R * 3.6;
  const tubeEnd = L - bl * 0.85;
  // tube: thick root (collar), taper to the muzzle
  B.lathe(o.mat ?? kit.metal, [[0, 0], [R * 1.25, 0], [R * 1.25, L * 0.1], [R, L * 0.14], [R * tp, tubeEnd], [0, tubeEnd]], at, 'x', seg);
  if (o.sleeve) B.lathe(kit.trim, [[0, L * 0.18], [R * 1.22, L * 0.18], [R * 1.3, L * 0.22], [R * 1.3, L * 0.5], [R * 1.12, L * 0.54], [0, L * 0.54]], at, 'x', seg);
  if (o.evac) { const a = L * 0.62, e = L * 0.72; B.lathe(kit.metal, [[0, a], [R * 1.05, a], [R * 1.55, a + (e - a) * 0.3], [R * 1.55, e - (e - a) * 0.25], [R * 1.0, e], [0, e]], at, 'x', seg); }
  const m0 = L - bl;
  if (brake === 'slot') {
    // chunky double-baffle brake: two fat drums with a dark gap
    const bR = R * 1.75;
    B.lathe(kit.steel, [[0, m0], [bR, m0], [bR, m0 + bl * 0.4], [R * 1.1, m0 + bl * 0.4], [R * 1.1, m0 + bl * 0.55], [bR, m0 + bl * 0.55], [bR, L], [R * 0.6, L], [0, L - bl * 0.1]], at, 'x', seg);
  } else if (brake === 'block') {
    cbox(B, kit.steel, x0 + m0 + bl / 2, y, z, bl, R * 2.6, R * 3.2, R * 0.4);
  } else if (brake === 'cone' || brake === 'flash') {
    const bR = brake === 'cone' ? R * 1.9 : R * 1.45;
    B.lathe(kit.metal, [[0, m0], [R * 1.05, m0], [bR, L], [R * 0.55, L], [0, L - bl * 0.3]], at, 'x', seg);
  }
  if (!o.noMuzzle) C.muzzle(x0 + L + R * 0.3, y, z);
  return L;
}

/** Thin ring band around +X (coil rings, barrel clamps). */
export function band(B: Bld, mat: MatLike, x: number, y: number, z: number, R: number, w: number, seg = 8): void {
  B.lathe(mat, [[0, 0], [R, 0], [R, w], [0, w]], [x - w / 2, y, z], 'x', seg);
}

/** Low-poly ball / squashed sphere of radius R (vertical squash k), centred. */
export function ball(B: Bld, mat: MatLike, x: number, y: number, z: number, R: number, k = 1, seg = 10, axis: 'x' | 'y' = 'y'): void {
  const prof: [number, number][] = [[0, -R * k], [R * 0.62, -R * k * 0.78], [R * 0.95, -R * k * 0.3], [R * 0.95, R * k * 0.3], [R * 0.62, R * k * 0.78], [0, R * k]];
  B.lathe(mat, prof, [x, y, z], axis, seg);
}

/** Pressure tank / capsule along an axis: rounded ends. */
export function capsule(B: Bld, mat: MatLike, x: number, y: number, z: number, R: number, len: number, axis: 'x' | 'y' | 'z' = 'x', seg = 8): void {
  const e = Math.min(R * 0.7, len * 0.3);
  const prof: [number, number][] = [[0, 0], [R * 0.6, e * 0.15], [R, e], [R, len - e], [R * 0.6, len - e * 0.15], [0, len]];
  const at: V3 = axis === 'x' ? [x - len / 2, y, z] : axis === 'y' ? [x, y - len / 2, z] : [x, y, z - len / 2];
  B.lathe(mat, prof, at, axis, seg);
}

/** Turret ring (deck bearing) under non-fixed weapons. */
export function deckRing(C: WCtx, k = 0.95): void {
  const { b, kit, r } = C;
  b.lathe(kit.trim, [[0, 0], [r * k, 0], [r * k, r * 0.07], [r * k * 0.9, r * 0.1], [0, r * 0.1]], [0, 0, 0], 'y', C.tier >= 4 ? 16 : 12);
}

/** Team accent panel lying on a face (horizontal by default). */
export function accent(C: WCtx, x: number, y: number, z: number, l: number, w: number, rot?: V3, B: Bld = C.b): void {
  C.acc = true;
  bx(B, C.kit.accent, x, y, z, l, Math.max(0.004, C.r * 0.02), w, rot);
}

/** Yellow/dark hazard bands around a cylinder along x (n alternating rings). */
export function hazardRings(B: Bld, kit: Kit, x: number, y: number, z: number, R: number, len: number, n = 3, seg = 8): void {
  const t = len / n;
  for (let i = 0; i < n; i++) band(B, i % 2 ? kit.trim : kit.hazard, x + t * (i + 0.5), y, z, R, t, seg);
}
