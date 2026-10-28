// Shared weapon-building kit for the stylized 3D turrets (weapons3d.ts + weapons/*.ts).
// Turret frame: +X = muzzle direction, +Y = up, origin on the deck at the turret ring centre.
// Rig groups: b = yaw (traverse, static housing), p = pitch (elevating cradle / mantlet), rc = recoil (barrels, launch
// boxes: everything that kicks back), sp = spin (gatling clusters, saw discs, drills; rotated about its local +X).
//
// Style rules (chunky toy-like, cel shaded, few big forms):
//   * housings are lofts of 8-point sections (wedges, casemates, hexes) or low-poly lathes (balls, drums), not boxes;
//   * small parts use cbox (32 tris) or plain boxes (12 tris), never the extruded bevel box (60+ tris);
//   * radial segments: 6-8 for barrels and small drums, 10-14 for big drums; one team accent per turret.
//   * paint plan (materials.ts PAINT_PLAN): housings are light shell (kit.panel), side boxes / shields / pods carry the
//     team colour (kit.hull), mantlets and receivers are dark (kit.trim), barrels bare metal (kit.metal: gunmetal or the
//     weapon's finish, finish3d.ts), breech rings / fume extractors kit.fitting.

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
  /** main-gun barrel length wanted from the HULL (cells; 0 = not the unit's main gun / unknown): real tank guns are
   *  ~0.85 x hull length, far longer than the housing-relative default (see mainLen in guns.ts) */
  mainL: number;
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

/** octagonal (chamfered-rectangle) section in the y-z plane at x: h tall, w wide, centred (y, z) */
function oct8(x: number, y: number, z: number, h: number, w: number, c = 0.3): V3[] {
  const H = h / 2, W = w / 2, ch = Math.min(H, W) * c * 2;
  return [[x, y + H, z - W + ch], [x, y + H, z + W - ch], [x, y + H - ch, z + W], [x, y - H + ch, z + W],
    [x, y - H, z + W - ch], [x, y - H, z - W + ch], [x, y - H + ch, z - W], [x, y + H - ch, z - W]];
}
/** armoured jacket segment along +X: octagonal section, chamfered (narrower) ends */
export function jacket(B: Bld, mat: MatLike, x0: number, x1: number, y: number, z: number, h: number, w: number, taper = 0.92): void {
  const e = Math.min((x1 - x0) * 0.18, h * 0.3);
  B.loft(mat, [oct8(x0, y, z, h * 0.78, w * 0.82), oct8(x0 + e, y, z, h, w), oct8(x1 - e, y, z, h * taper, w * taper), oct8(x1, y, z, h * taper * 0.8, w * taper * 0.84)]);
}

/** Barrel along +X from x0, in the armoured sci-fi style: a bare inner tube that only shows toward the muzzle, an
 *  angular octagonal shroud over the breech two-thirds in two stepped segments (light receiver jacket, darker forward
 *  jacket) on a dark gap, a top rail, dark vent slots and a team glow strip along the side, and an angular ported block
 *  muzzle brake. Adds a muzzle. (sleeve: longer shroud; evac: a third short collar segment near the muzzle.) */
export function barrel(C: WCtx, B: Bld, o: {
  len: number; rad: number; x0?: number; y?: number; z?: number; seg?: number; mat?: MatLike;
  sleeve?: boolean; evac?: boolean; brake?: 'slot' | 'cone' | 'flash' | 'block' | 'none'; taper?: number; noMuzzle?: boolean;
}): number {
  const { kit } = C;
  const x0 = o.x0 ?? 0, y = o.y ?? 0, z = o.z ?? 0, R = o.rad, L = o.len, seg = Math.min(o.seg ?? 8, 8);
  const brake = o.brake ?? 'none';
  const bl = brake === 'none' ? R * 1.6 : brake === 'flash' ? R * 2.4 : R * 3.0;
  // inner tube (bare metal) all the way to the brake
  B.lathe(o.mat ?? kit.metal, [[0, 0], [R * 0.9, 0], [R * 0.82, L - bl * 0.8], [0, L - bl * 0.8]], [x0, y, z], 'x', Math.max(6, seg));
  // shroud: two stepped octagonal segments, wider than tall
  const sEnd = L * (o.sleeve ? 0.72 : 0.64), cut = sEnd * 0.42, g = R * 0.35;
  const h0 = R * 2.5, w0 = R * 2.9;
  jacket(B, kit.panel, x0, x0 + cut - g / 2, y, z, h0, w0, 0.96);
  jacket(B, kit.trim, x0 + cut + g / 2, x0 + sEnd, y, z, h0 * 0.86, w0 * 0.86, 0.88);
  B.lathe(kit.trim, [[0, 0], [R * 1.2, 0], [R * 1.2, g * 1.2], [0, g * 1.2]], [x0 + cut - g * 0.6, y, z], 'x', 6); // dark gap core
  if (o.evac) jacket(B, kit.fitting, x0 + L * 0.74, x0 + L * 0.8, y, z, h0 * 0.7, w0 * 0.7, 0.9);
  // top rail along the receiver jacket, vent slots on its flanks, a small glow strip
  bx(B, kit.trim, x0 + cut * 0.5, y + h0 * 0.5 + R * 0.12, z, cut * 0.8, R * 0.24, R * 0.7);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) bx(B, kit.trim, x0 + cut * (0.22 + i * 0.22), y, z + s * w0 * 0.5, cut * 0.12, h0 * 0.42, R * 0.12);
    if (s > 0) bx(B, kit.glow, x0 + cut + (sEnd - cut) * 0.5, y + h0 * 0.08, z + s * w0 * 0.43, (sEnd - cut) * 0.55, R * 0.16, R * 0.08);
  }
  // muzzle: angular block brake with side ports (all brake kinds; 'none' = short collar)
  const m0 = L - bl;
  if (brake === 'none') jacket(B, kit.metal, x0 + m0, x0 + L, y, z, R * 1.9, R * 2.1, 0.9);
  else {
    jacket(B, kit.metal, x0 + m0, x0 + L, y, z, R * 2.3, R * (brake === 'flash' ? 2.4 : 3.0), 0.92);
    for (const f of brake === 'flash' ? [0.5] : [0.3, 0.7]) bx(B, kit.trim, x0 + m0 + bl * f, y, z, bl * 0.14, R * 1.5, R * (brake === 'flash' ? 2.5 : 3.1));
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
export function deckRing(C: WCtx, k = 0.8): void {
  const { b, kit, r } = C;
  b.lathe(kit.trim, [[0, 0], [r * k, 0], [r * k, r * 0.07], [r * k * 0.9, r * 0.1], [0, r * 0.1]], [0, 0, 0], 'y', C.tier >= 4 ? 16 : 12);
}

/** Team accent panel lying on a face (horizontal by default). */
export function accent(C: WCtx, x: number, y: number, z: number, l: number, w: number, rot?: V3, B: Bld = C.b): void {
  C.acc = true;
  // restrained team accent: a stripe, never a big painted panel
  const lo = C.r * 0.11, hi = C.r * 0.5;
  if (l >= w) { l = Math.min(l, hi); w = Math.min(w, lo); } else { w = Math.min(w, hi); l = Math.min(l, lo); }
  bx(B, C.kit.accent, x, y, z, l, Math.max(0.004, C.r * 0.02), w, rot);
}

/** Yellow/dark hazard bands around a cylinder along x (n alternating rings). */
export function hazardRings(B: Bld, kit: Kit, x: number, y: number, z: number, R: number, len: number, n = 3, seg = 8): void {
  const t = len / n;
  for (let i = 0; i < n; i++) band(B, i % 2 ? kit.trim : kit.hazard, x + t * (i + 0.5), y, z, R, t, seg);
}

/** Angular launcher / gun base: a faceted armoured plinth (radius k x r, height h x r) with a dark skirt and two yoke
 *  cheeks. Replaces round lathed pedestals. */
export function plinth(C: WCtx, k = 0.6, h = 0.22): void {
  const { b, kit, r, y0 } = C, R = r * k, H = r * h;
  bx(b, kit.trim, 0, y0 + H * 0.15, 0, R * 1.6, H * 0.3, R * 1.5);
  shell(b, kit.panel, [[-R, R * 0.7, R * 0.52, H], [-R * 0.5, R * 0.86, R * 0.66, H], [R * 0.6, R * 0.86, R * 0.66, H], [R, R * 0.6, R * 0.42, H * 0.8]], y0 + H * 0.1);
  for (const s of [-1, 1]) cbox(b, kit.hull, -R * 0.1, y0 + H * 1.2, s * R * 0.74, R * 0.9, H * 1.3, r * 0.1, r * 0.03, undefined, 0.8);
}

/** Armoured sci-fi turret housing (Mechabellum-style): a faceted light core wedge, thick team-colour cheek armour
 *  slabs running forward past the mantlet, a layered dark roof plate, a sensor block with a glowing lens, dark heat-sink
 *  fins across the back. l / w / h: length, half-width, height (cells); fwd: how far the cheeks reach forward (x r).
 *  Returns the roof height. */
export function mechHousing(C: WCtx, l: number, w: number, h: number, fwd = 1.05, sensorZ = -1): number {
  const { b, kit, r, y0 } = C;
  shell(b, kit.panel, [[-l * 0.55, w * 0.62, w * 0.46, h * 0.82], [-l * 0.32, w, w * 0.76, h], [l * 0.2, w, w * 0.76, h], [l * 0.48, w * 0.7, w * 0.42, h * 0.72]], y0);
  for (const s of [-1, 1]) {
    // cheek slab: long, thick, leaning in a little, chamfered top; a dark seam strip under it
    const cl = l * 0.55 + r * fwd * 0.5, cx = -l * 0.3 + cl / 2;
    cbox(b, kit.hull, cx, y0 + h * 0.52, s * (w * 0.98 + r * 0.06), cl, h * 0.9, r * 0.16, r * 0.05, [s * 0.06, 0, 0], 0.86);
    bx(b, kit.trim, cx, y0 + h * 0.06, s * (w * 0.98 + r * 0.06), cl * 0.92, h * 0.1, r * 0.17);
    // armour step: a smaller plate layered on the cheek's front half
    cbox(b, kit.hull2, cx + cl * 0.22, y0 + h * 0.6, s * (w * 0.98 + r * 0.15), cl * 0.42, h * 0.5, r * 0.05, r * 0.02);
  }
  // layered roof plate, sensor block with a glowing lens facing forward
  cbox(b, kit.hull2, -l * 0.08, y0 + h + r * 0.02, -sensorZ * w * 0.18, l * 0.5, r * 0.05, w * 0.7, r * 0.015);
  cbox(b, kit.trim, -l * 0.12, y0 + h + r * 0.11, sensorZ * w * 0.48, r * 0.36, r * 0.16, r * 0.24, r * 0.04);
  bx(b, kit.glow, -l * 0.12 + r * 0.185, y0 + h + r * 0.11, sensorZ * w * 0.48, r * 0.02, r * 0.07, r * 0.14);
  // heat-sink fins across the back
  for (let i = 0; i < 4; i++) bx(b, kit.trim, -l * 0.56 - r * 0.04, y0 + h * 0.48, (i - 1.5) * w * 0.38, r * 0.12, h * 0.66, r * 0.05);
  C.acc = true;
  return y0 + h;
}

