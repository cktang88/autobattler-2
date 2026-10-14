// Stylized hard-surface shape kit for chassis / mobility builders: chunky chamfered blocks with tapered tops, plan-
// polygon slabs, low-poly domes and pods, turret collars, glow strips, vents and hazard bands. All write into a Bld
// (merged per material), flat-shaded so every chamfer catches the light as a painted edge highlight.

import * as THREE from 'three';
import { aim, bevBox, Bld, ellRing, type P2, type V3 } from '../geo.ts';
import type { Kit, MatLike } from '../materials.ts';

/** octagonal ring (rectangle l x w with cut corners c) at height y, centred (cx, cz) */
function oct(cx: number, y: number, cz: number, l: number, w: number, c: number): V3[] {
  const x = l / 2, z = w / 2;
  c = Math.max(0.0005, Math.min(c, x * 0.95, z * 0.95));
  return [[cx - x + c, y, cz - z], [cx + x - c, y, cz - z], [cx + x, y, cz - z + c], [cx + x, y, cz + z - c],
    [cx + x - c, y, cz + z], [cx - x + c, y, cz + z], [cx - x, y, cz + z - c], [cx - x, y, cz - z + c]];
}

export interface BlockOpts {
  /** top size as fraction of bottom [l, w] (taper) */
  top?: [number, number];
  /** top centre shift along x / z (lean the block forward/back), cells */
  shift?: [number, number];
  /** vertical-edge chamfer (cells) */
  ch?: number;
  /** top bevel height (cells); the top face is inset by the same amount */
  bev?: number;
  /** bottom bevel (cells) */
  bot?: number;
  /** extra rings: [frac of height, l-frac, w-frac] between bottom and top (bulges, waists) */
  mid?: [number, number, number][];
}

/** Chunky block: bottom at y, height h, footprint l (x) by w (z), tapering/leaning to its top, every edge chamfered. */
export function block(b: Bld, mat: MatLike, x: number, y: number, z: number, l: number, w: number, h: number, o: BlockOpts = {}): void {
  const [tl, tw] = o.top ?? [1, 1];
  const [sx, sz] = o.shift ?? [0, 0];
  const ch = o.ch ?? Math.min(l, w) * 0.14;
  const bev = Math.min(o.bev ?? Math.min(l, w, h) * 0.12, h * 0.45);
  const bot = Math.min(o.bot ?? 0, h * 0.3);
  const rings: V3[][] = [];
  if (bot > 0) {
    rings.push(oct(x, y, z, l - bot * 2, w - bot * 2, ch * 0.7));
    rings.push(oct(x, y + bot, z, l, w, ch));
  } else rings.push(oct(x, y, z, l, w, ch));
  for (const [f, lf, wf] of o.mid ?? []) rings.push(oct(x + sx * f, y + h * f, z + sz * f, l * lf, w * wf, ch * Math.min(lf, wf)));
  const L2 = l * tl, W2 = w * tw;
  rings.push(oct(x + sx, y + h - bev, z + sz, L2, W2, ch * Math.min(tl, tw)));
  rings.push(oct(x + sx, y + h, z + sz, Math.max(0.002, L2 - bev * 2), Math.max(0.002, W2 - bev * 2), ch * Math.min(tl, tw) * 0.8));
  b.loft(mat, rings);
}

/** Hull from plan stations along x: each [x, halfW at shoulder, y bottom, y shoulder, y top, top half-width frac].
 *  Gives sloped glacis / rear plates and chamfered shoulders in one closed loft (8-point rings). */
export function stationHull(b: Bld, mat: MatLike, st: [number, number, number, number, number, number][], z = 0, belly = 0.82): void {
  b.loft(mat, st.map(([x, hw, y0, y1, y2, tf]) => {
    const wt = hw * tf, wb = hw * belly, ym = y1 + (y2 - y1) * 0.45;
    return [[x, y0, z - wb], [x, y0, z + wb], [x, y1, z + hw], [x, ym, z + hw], [x, y2, z + wt], [x, y2, z - wt], [x, ym, z - hw], [x, y1, z - hw]] as V3[];
  }));
}

/** Top height of a stationHull at (x, z), -1 when outside. */
export function stationTop(st: [number, number, number, number, number, number][], x: number, z: number, zc = 0): number {
  if (x < st[0][0] || x > st[st.length - 1][0]) return -1;
  let i = 0;
  while (i < st.length - 2 && st[i + 1][0] < x) i++;
  const a = st[i], c = st[i + 1];
  const f = (x - a[0]) / (c[0] - a[0] || 1);
  const hw = a[1] + (c[1] - a[1]) * f, y2 = a[4] + (c[4] - a[4]) * f, tf = a[5] + (c[5] - a[5]) * f, y1 = a[3] + (c[3] - a[3]) * f;
  const az = Math.abs(z - zc), wt = hw * tf;
  if (az <= wt) return y2;
  if (az <= hw) { const ym = y1 + (y2 - y1) * 0.45; return y2 - ((y2 - ym) * (az - wt)) / (hw - wt || 1); }
  return -1;
}

/** Prism from a plan polygon (x, z) at y with height h and chamfer bev. */
export function plate(b: Bld, mat: MatLike, poly: P2[], y: number, h: number, bev = 0.02, rot?: V3, at: V3 = [0, 0, 0]): void {
  b.slab(mat, poly, h, bev, at[0], at[1] + y, at[2], rot);
}

/** Low-poly dome (hemisphere-ish) of radius r and height h on y. */
export function dome(b: Bld, mat: MatLike, at: V3, r: number, h: number, seg = 12, rings = 3): void {
  const prof: P2[] = [[0, 0], [r, 0]];
  for (let i = 1; i <= rings; i++) { const a = (i / (rings + 1)) * Math.PI / 2; prof.push([r * Math.cos(a), h * Math.sin(a)]); }
  prof.push([0, h]);
  b.lathe(mat, prof, at, 'y', seg);
}

/** Squashed sphere / egg along x: ellipsoid pod centred at c with radii (rx, ry, rz). */
export function pod(b: Bld, mat: MatLike, c: V3, rx: number, ry: number, rz: number, n = 10, k = 6, pw = 2.2, flatBottom = 0): void {
  const rings: V3[][] = [];
  for (let i = 1; i < k; i++) {
    const a = -Math.PI / 2 + (i / k) * Math.PI;
    const s = Math.cos(a);
    rings.push(ellRing(c[0] + Math.sin(a) * rx, c[1], c[2], Math.max(0.002, ry * s), Math.max(0.002, rz * s), n, pw, flatBottom));
  }
  b.loft(mat, rings);
}

/** Turret collar: armoured ring the turret sits in (top at y), radius r (turret ring radius), skirt down to y0. */
export function collar(b: Bld, kit: Kit, x: number, y: number, z: number, r: number, y0 = y - r * 0.35, seg = 18): void {
  const R = r * 1.18;
  b.lathe(kit.hull, [[0, y0 - y], [R * 1.08, y0 - y], [R * 1.08, -r * 0.16], [R, 0], [r * 1.0, 0], [r * 0.98, -0.01], [0, -0.01]], [x, y, z], 'y', seg);
  b.lathe(kit.trim, [[0, -0.004], [r * 1.02, -0.004], [r * 1.02, 0.012], [0, 0.012]], [x, y, z], 'y', seg);
}

/** Emissive strip (team glow) lying on a face; rotation optional. */
export function glow(b: Bld, kit: Kit, x: number, y: number, z: number, l: number, h: number, w: number, rot?: V3, mat?: MatLike): void {
  b.box(mat ?? kit.glow, l, h, w, x, y, z, Math.min(l, h, w) * 0.3, rot);
}

/** Recessed vent: dark plate with n chunky slats, lying on a horizontal face at y (centre x,z; l along x). */
export function vent(b: Bld, kit: Kit, x: number, y: number, z: number, l: number, w: number, n = 3, along: 'x' | 'z' = 'z'): void {
  b.box(kit.trim, l, Math.min(l, w) * 0.12, w, x, y + Math.min(l, w) * 0.04, z, Math.min(l, w) * 0.05);
  const s = Math.min(l, w) * 0.11;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n - 0.5;
    if (along === 'z') b.box(kit.metal, l * 0.86, s, w / n * 0.5, x, y + s * 0.9, z + f * w * 0.92, s * 0.3, [0.45, 0, 0]);
    else b.box(kit.metal, l / n * 0.5, s, w * 0.86, x + f * l * 0.92, y + s * 0.9, z, s * 0.3, [0, 0, 0.45]);
  }
}

/** Yellow hazard band: alternating hazard / trim tiles along x on a horizontal face (stylized, no texture). */
export function hazard(b: Bld, kit: Kit, x: number, y: number, z: number, l: number, w: number, n = 4, rotY = 0): void {
  const t = l / n;
  for (let i = 0; i < n; i++) {
    const cx = -l / 2 + t * (i + 0.5);
    const p = new THREE.Vector3(cx, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    b.box(i % 2 ? kit.trim : kit.hazard, t * 0.98, Math.min(t, w) * 0.16, w, x + p.x, y, z + p.z, Math.min(t, w) * 0.05, [0, rotY, 0]);
  }
}

/** Big chunky exhaust stack: armoured box base, round pipe, hot rim. */
export function exhaust(b: Bld, kit: Kit, x: number, y: number, z: number, r: number, h: number, tilt = 0.15): void {
  b.box(kit.trim, r * 3, r * 1.4, r * 2.6, x, y + r * 0.7, z, r * 0.3);
  b.cylb(kit.metal, r, h, r * 0.2, [x - r * 0.2, y + r * 0.6, z], 'y', 10);
  b.cyl(kit.trim, r * 0.75, r * 0.75, r * 0.06, [x - r * 0.2, y + r * 0.6 + h - r * 0.03, z], 'y', 10);
  b.cyl(kit.hot, r * 0.45, r * 0.45, r * 0.03, [x - r * 0.2, y + r * 0.6 + h + r * 0.01, z], 'y', 8);
  void tilt;
}

/** Sensor head / lamp cluster: small chamfered box with a glowing lens facing +x. */
export function sensor(b: Bld, kit: Kit, x: number, y: number, z: number, s: number, lens: MatLike = kit.glow): void {
  b.box(kit.trim, s * 1.2, s * 0.8, s, x, y, z, s * 0.18);
  b.cyl(lens, s * 0.3, s * 0.3, s * 0.08, [x + s * 0.6, y, z], 'x', 8);
}

/** Chamfered beam from a to c (cross-section w across x, h along `up`), e.g. arm segments and struts. */
export function beam(b: Bld, mat: MatLike, a: V3, c: V3, w: number, h: number, up: V3 = [0, 1, 0], bev = Math.min(w, h) * 0.2): void {
  const d: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  const g = bevBox(w, h, len, bev).translate(0, 0, len / 2);
  b.g(g, mat, aim(a, d, up));
}

/** Mirror helper: run fn for side = -1 (left) and +1 (right). */
export const both = (fn: (s: -1 | 1) => void) => { fn(-1); fn(1); };
