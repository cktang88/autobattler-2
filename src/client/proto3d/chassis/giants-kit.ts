// Boss-scale shape helpers shared by the giant and titan hulls (giants.ts, titans.ts): plan-polygon lofts, round
// bastion towers with merlons, antenna masts, team banners, glowing reactor cores, side-hung armour skirts.

import * as THREE from 'three';
import type { Bld, P2, V3 } from '../geo.ts';
import type { Kit, MatLike } from '../materials.ts';
import { block, glow } from './shapes.ts';

/** n-gon / ellipse plan (x, z), radii rx (x) and rz (z), first vertex at angle a0 */
export function ngon(n: number, rx: number, rz: number, a0 = Math.PI / n): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) { const a = a0 + (i / n) * Math.PI * 2; out.push([Math.cos(a) * rx, Math.sin(a) * rz]); }
  return out;
}

/** loft a convex plan polygon through levels [y, scale, dx?, dz?] (scale about the polygon origin) */
export function planLoft(b: Bld, mat: MatLike, poly: P2[], levels: [number, number, number?, number?][], at: [number, number] = [0, 0]): void {
  b.loft(mat, levels.map(([y, s, dx = 0, dz = 0]) => poly.map(([px, pz]) => [at[0] + dx + px * s, y, at[1] + dz + pz * s] as V3)));
}

/** loft through per-level polygons (same vertex count, convex) */
export function polyLoft(b: Bld, mat: MatLike, rings: [number, P2[]][]): void {
  b.loft(mat, rings.map(([y, poly]) => poly.map(([px, pz]) => [px, y, pz] as V3)));
}

/** point-in-convex-polygon test for deck queries */
export function inPoly(poly: P2[], x: number, z: number): boolean {
  let sgn = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
    const c = (bx - ax) * (z - az) - (bz - az) * (x - ax);
    if (Math.abs(c) < 1e-9) continue;
    const s = Math.sign(c);
    if (sgn === 0) sgn = s; else if (s !== sgn) return false;
  }
  return true;
}

/** round bastion tower: battered base, shaft, overhanging parapet ring with merlons; returns the walkway height */
export function tower(b: Bld, kit: Kit, x: number, y0: number, z: number, r: number, h: number, o: { seg?: number; merlons?: number; band?: boolean } = {}): number {
  const seg = o.seg ?? 12;
  b.lathe(kit.hull, [[0, 0], [r * 1.12, 0], [r * 1.02, h * 0.3], [r, h * 0.82], [r * 1.16, h * 0.9], [r * 1.16, h], [0, h]], [x, y0, z], 'y', seg);
  if (o.band !== false) b.lathe(kit.trim, [[r * 0.995, 0], [r * 1.03, 0], [r * 1.03, h * 0.06], [r * 0.995, h * 0.06]], [x, y0 + h * 0.55, z], 'y', seg);
  const n = o.merlons ?? 8, top = y0 + h;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    b.box(kit.panel, r * 0.34, r * 0.26, r * 0.22, x + Math.cos(a) * r * 1.02, top + r * 0.13, z + Math.sin(a) * r * 1.02, r * 0.05, [0, -a, 0]);
  }
  return top;
}

/** lattice antenna mast with crossbars and a warm beacon on top */
export function mast(b: Bld, kit: Kit, x: number, y: number, z: number, h: number, r = 0.05): void {
  b.cylb(kit.trim, r * 2.6, r * 2.2, r * 0.6, [x, y, z], 'y', 8);
  b.cyl(kit.steel, r, r * 0.45, h, [x, y, z], 'y', 6);
  for (const f of [0.45, 0.72]) b.box(kit.metal, r * 0.8, r * 0.8, h * (0.42 - f * 0.25), x, y + h * f, z, r * 0.2);
  b.box(kit.metal, h * 0.14, r * 0.7, r * 0.7, x, y + h * 0.6, z, r * 0.2);
  b.cyl(kit.lamp, r * 1.3, r * 1.3, r * 1.6, [x, y + h, z], 'y', 6);
}

/** team banner: pole + a tall accent pennant hanging on the +-z side (dir), swallow-tailed */
export function banner(b: Bld, kit: Kit, x: number, y: number, z: number, h: number, w: number, dir: number = -1): void {
  b.cyl(kit.steel, h * 0.016, h * 0.012, h, [x, y, z], 'y', 6);
  b.cyl(kit.lamp, h * 0.03, h * 0.03, h * 0.03, [x, y + h, z], 'y', 6);
  b.box(kit.metal, h * 0.03, h * 0.02, w * 1.1, x, y + h * 0.95, z + dir * w * 0.5, 0.004);
  // flag plate: hanging from the crossbar, notched tail (two slabs)
  const fh = h * 0.5, t = Math.max(0.012, h * 0.012);
  const poly: P2[] = [[0, 0], [w, 0], [w, fh * 0.8], [w * 0.5, fh * 0.62], [0, fh]];
  const g = new THREE.Shape(poly.map(([px, py]) => new THREE.Vector2(px, py)));
  const geo = new THREE.ExtrudeGeometry(g, { depth: t, bevelEnabled: false });
  // shape x -> world z (dir), shape y -> down from the crossbar
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, dir), new THREE.Vector3(0, -1, 0), new THREE.Vector3(dir, 0, 0)).setPosition(x - t / 2 * dir, y + h * 0.94, z + dir * h * 0.02);
  b.g(geo, kit.accent, m);
  b.box(kit.hazard, t * 1.2, fh * 0.06, w * 0.9, x, y + h * 0.94 - fh * 0.2, z + dir * w * 0.5, 0.002);
}

/** glowing reactor core: armoured ring housing with a glow lens and cage ribs, facing along `axis` */
export function reactor(b: Bld, kit: Kit, at: V3, r: number, axis: 'x' | 'y' | '-x' = 'y', ribs = 4): void {
  const d = r * 0.5;
  b.cylb(kit.trim, r * 1.3, d, d * 0.2, at, axis, 16);
  const off: V3 = axis === 'y' ? [0, d, 0] : axis === 'x' ? [d, 0, 0] : [-d, 0, 0];
  const c: V3 = [at[0] + off[0], at[1] + off[1], at[2] + off[2]];
  b.cyl(kit.glow, r, r * 0.7, r * 0.5, [c[0] - off[0] * 0.5, c[1] - off[1] * 0.5, c[2] - off[2] * 0.5], axis, 14);
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI;
    if (axis === 'y') b.box(kit.metal, r * 2.3, r * 0.14, r * 0.14, c[0], c[1] + r * 0.22, c[2], r * 0.04, [0, a, 0]);
    else b.box(kit.metal, r * 0.14, r * 2.3, r * 0.14, c[0] + off[0] * 0.44, c[1], c[2], r * 0.04, [a, 0, 0]);
  }
}

/** row of hanging armour plates along x (skirt) on side s at height y */
export function skirt(b: Bld, kit: Kit, x0: number, x1: number, y: number, z: number, h: number, t: number, n: number, s: number): void {
  const pl = (x1 - x0) / n;
  for (let i = 0; i < n; i++) block(b, i % 2 ? kit.panel : kit.hull, x0 + pl * (i + 0.5), y - h, z, pl * 0.94, t, h, { top: [0.96, 0.7], shift: [0, -s * t * 0.15], ch: t * 0.3, bev: t * 0.25, bot: t * 0.25 });
}

/** glow vent grille on a vertical face facing +-x (dir): dark frame with n glowing slots */
export function glowGrille(b: Bld, kit: Kit, x: number, y: number, z: number, w: number, h: number, n: number, dir = 1): void {
  b.box(kit.trim, h * 0.2, h, w, x, y, z, h * 0.06);
  for (let i = 0; i < n; i++) glow(b, kit, x + dir * h * 0.08, y - h * 0.32 + (h * 0.64 * i) / Math.max(1, n - 1), z, h * 0.08, h * 0.08, w * 0.8);
}
