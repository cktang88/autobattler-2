// Greeble kit for the titan hulls (titans*.ts): surface detail that follows sloped armour. A `Face` is a planar frame
// on one wall of a planLoft (u = along the edge, v = up the slope, n = outward normal); plates, rivet rows, slits,
// vents and ladders are placed in face coordinates so they sit flush on battered / overhanging walls. Everything goes
// into the unit's Bld (merged per material, so detail costs triangles, not draw calls); tiny repeated parts (rivets,
// rungs, brackets) use plain 12-triangle boxes. Plates and vents follow the hard-surface kit (hs-kit.ts: plate
// thickness, shadow gaps, recessed grilles); titan-scale assemblies built from these live in hs-kit-titan.ts.

import * as THREE from 'three';
import { bevBox, type Bld, type MatLike, type P2, type V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { armorPlate, recessPanel, rectP } from './hs-kit.ts';

export interface Face {
  /** centre of the wall quad */
  c: THREE.Vector3;
  /** along the bottom edge (horizontal), up the slope, outward normal */
  u: THREE.Vector3; v: THREE.Vector3; n: THREE.Vector3;
  /** edge length (average of bottom/top) and slant height */
  w: number; h: number;
  /** bottom edge length and top edge length */
  wb: number; wt: number;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** mirrored plan from a half outline listed nose -> tail on one side (first and last points on the centreline) */
export const mirror = (half: P2[]): P2[] => [...half, ...half.slice(1, -1).reverse().map(([x, z]) => [x, -z] as P2)];

/** even-odd point in polygon (works for concave, waisted plans) */
export function inside(poly: P2[], x: number, z: number): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-9) + xi) r = !r;
  }
  return r;
}

/** frame of wall i (edge poly[i] -> poly[i+1]) of planLoft(poly, levels, at) between two of its levels [y, scale] */
export function wallFace(poly: P2[], i: number, lo: [number, number], hi: [number, number], at: [number, number] = [0, 0]): Face {
  const p = poly[i], q = poly[(i + 1) % poly.length];
  const P = (pt: P2, [y, s]: [number, number]) => V(at[0] + pt[0] * s, y, at[1] + pt[1] * s);
  const a0 = P(p, lo), b0 = P(q, lo), a1 = P(p, hi), b1 = P(q, hi);
  const m0 = a0.clone().add(b0).multiplyScalar(0.5), m1 = a1.clone().add(b1).multiplyScalar(0.5);
  const c = m0.clone().add(m1).multiplyScalar(0.5);
  const u = b0.clone().sub(a0).normalize();
  const v = m1.clone().sub(m0).normalize();
  const n = new THREE.Vector3().crossVectors(u, v).normalize();
  const out = V(c.x - at[0], 0, c.z - at[1]);
  if (n.dot(out) < 0) { n.negate(); }
  // keep (u, n, u x n) right-handed with v = +-(u x n)
  return { c, u, v, n, w: (a0.distanceTo(b0) + a1.distanceTo(b1)) / 2, h: m0.distanceTo(m1), wb: a0.distanceTo(b0), wt: a1.distanceTo(b1) };
}

/** a point on the face: du along u, dv along v (from the centre), off along n */
export function facePt(f: Face, du: number, dv: number, off = 0): V3 {
  const p = f.c.clone().addScaledVector(f.u, du).addScaledVector(f.v, dv).addScaledVector(f.n, off);
  return [p.x, p.y, p.z];
}

function faceMtx(f: Face, du: number, dv: number, off: number, roll = 0): THREE.Matrix4 {
  const z = new THREE.Vector3().crossVectors(f.u, f.n);
  const p = facePt(f, du, dv, off);
  const m = new THREE.Matrix4().makeBasis(f.u, f.n, z).setPosition(p[0], p[1], p[2]);
  if (roll) m.multiply(new THREE.Matrix4().makeRotationY(roll));
  return m;
}

/** local frame on the face (x along the edge, y = outward normal, z up/down the slope) at (du, dv), lifted by off */
export const faceFrame = (f: Face, du: number, dv: number, off = 0): THREE.Matrix4 => faceMtx(f, du, dv, off);

/** chamfered plate lying on the face: w along the edge, d up the slope, t thick (proud of the face by off) */
export function facePlate(b: Bld, mat: MatLike, f: Face, du: number, dv: number, w: number, d: number, t: number, off = 0, bev = Math.min(w, d, t) * 0.3): void {
  b.g(bevBox(w, t, d, bev), mat, faceMtx(f, du, dv, off + t / 2));
}

/** cheap 12-triangle box on the face (rivets, rungs, brackets, slits) */
export function faceBox(b: Bld, mat: MatLike, f: Face, du: number, dv: number, w: number, d: number, t: number, off = 0): void {
  b.g(new THREE.BoxGeometry(w, t, d), mat, faceMtx(f, du, dv, off + t / 2));
}

/** rivet row on the face from du0 to du1 at dv */
export function faceRivets(b: Bld, mat: MatLike, f: Face, du0: number, du1: number, dv: number, n: number, r: number, off = 0): void {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    faceBox(b, mat, f, du0 + (du1 - du0) * t, dv, r, r, r * 0.7, off);
  }
}

/** layered armour plate (hard-surface: real thickness, standing proud on a dark inset backing so a shadow gap shows
 *  under every edge; see hs-kit armorPlate); bolt heads along its top and bottom edges when `rivets` */
export function armourPlate(b: Bld, kit: Kit, f: Face, du: number, dv: number, w: number, d: number, t: number, mat: MatLike = kit.shell, rivets = false): void {
  armorPlate(b, kit, mat, faceFrame(f, du, dv, 0), rectP(w, d, Math.min(w, d) * 0.08), t, { standoff: t * 0.45, gap: t * 1.1 });
  if (rivets) {
    const n = Math.max(2, Math.round(w / (t * 3.2)));
    const r = t * 0.45;
    for (const e of [-1, 1]) faceRivets(b, kit.joint, f, du - w * 0.4, du + w * 0.4, dv + e * d * 0.38, n, r, t * 1.45);
  }
}

/** vision slit / glowing port on the face */
export function faceSlit(b: Bld, kit: Kit, f: Face, du: number, dv: number, w: number, d: number, mat: MatLike = kit.glow): void {
  faceBox(b, kit.trim, f, du, dv, w * 1.25, d * 2.2, d * 0.8, 0);
  faceBox(b, mat, f, du, dv, w, d, d * 0.5, d * 0.6);
}

/** louvred vent on the face: a recessed grille (raised frame round a dark floor, angled slats) */
export function faceVent(b: Bld, kit: Kit, f: Face, du: number, dv: number, w: number, d: number, n = 4, mat: MatLike = kit.joint): void {
  recessPanel(b, kit, faceFrame(f, du, dv, 0), w, d, Math.min(w, d) * 0.12, { slats: n, slatMat: mat });
}

/** ladder on the face, from dv0 to dv1 */
export function faceLadder(b: Bld, kit: Kit, f: Face, du: number, dv0: number, dv1: number, w: number): void {
  const r = w * 0.09, off = w * 0.12;
  for (const e of [-1, 1]) faceBox(b, kit.metal, f, du + e * w / 2, (dv0 + dv1) / 2, r, Math.abs(dv1 - dv0), r, off);
  const n = Math.max(2, Math.round(Math.abs(dv1 - dv0) / (w * 0.42)));
  for (let i = 0; i <= n; i++) faceBox(b, kit.steel, f, du, dv0 + ((dv1 - dv0) * i) / n, w, r * 0.8, r * 0.8, off);
}

/** plain box (12 tris) in hull space */
export function pbox(b: Bld, mat: MatLike, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): void {
  const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
  b.g(new THREE.BoxGeometry(w, h, d), mat, m);
}

/** conduit run through points with clamp brackets at every joint */
export function pipeRun(b: Bld, kit: Kit, pts: V3[], r: number, mat: MatLike = kit.metal): void {
  for (let i = 0; i < pts.length - 1; i++) b.strut(mat, pts[i], pts[i + 1], r, r, 6);
  for (const p of pts) pbox(b, kit.trim, r * 2.6, r * 2.6, r * 2.6, p[0], p[1], p[2]);
}

/** round roof hatch with hinge and handle */
export function hatch(b: Bld, kit: Kit, x: number, y: number, z: number, r: number): void {
  b.cylb(kit.trim, r * 1.15, r * 0.18, r * 0.06, [x, y, z], 'y', 10);
  b.cylb(kit.panel, r, r * 0.3, r * 0.1, [x, y + r * 0.05, z], 'y', 10);
  pbox(b, kit.metal, r * 0.9, r * 0.12, r * 0.14, x, y + r * 0.4, z);
  pbox(b, kit.metal, r * 0.3, r * 0.2, r * 0.6, x - r * 1.0, y + r * 0.2, z);
}

/** sensor dome on a short collar */
export function sensorDome(b: Bld, kit: Kit, x: number, y: number, z: number, r: number, mat: MatLike = kit.panel): void {
  b.cylb(kit.trim, r * 1.15, r * 0.35, r * 0.08, [x, y, z], 'y', 10);
  b.lathe(mat, [[0, 0], [r, 0], [r * 0.92, r * 0.42], [r * 0.66, r * 0.78], [r * 0.3, r * 0.96], [0, r]], [x, y + r * 0.33, z], 'y', 12);
  b.cyl(kit.glow, r * 0.18, r * 0.18, r * 0.12, [x + r * 0.85, y + r * 0.62, z], 'x', 6);
}

/** whip antenna on a small base */
export function whip(b: Bld, kit: Kit, x: number, y: number, z: number, h: number, r = h * 0.012): void {
  b.cylb(kit.trim, r * 3.5, r * 3, r, [x, y, z], 'y', 6);
  b.cyl(kit.steel, r, r * 0.5, h, [x, y, z], 'y', 4);
  pbox(b, kit.lamp, r * 2.2, r * 2.2, r * 2.2, x, y + h, z);
}

/** spot / work light: small housing with a lens facing yaw (0 = +x) */
export function lamp(b: Bld, kit: Kit, x: number, y: number, z: number, s: number, yaw = 0): void {
  pbox(b, kit.trim, s * 1.2, s, s, x, y, z, -yaw);
  b.cyl(kit.lamp, s * 0.38, s * 0.38, s * 0.15, [x + Math.cos(yaw) * s * 0.6, y, z + Math.sin(yaw) * s * 0.6], 'x', 8);
}

/** bolt ring (n bolt heads) around a circle on a horizontal face */
export function boltRing(b: Bld, mat: MatLike, x: number, y: number, z: number, r: number, n: number, s: number): void {
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pbox(b, mat, s, s * 0.6, s, x + Math.cos(a) * r, y + s * 0.3, z + Math.sin(a) * r, -a); }
}

/** rivets along a horizontal line in hull space */
export function rivetLine(b: Bld, mat: MatLike, a: V3, c: V3, n: number, s: number): void {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    pbox(b, mat, s, s, s, a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t);
  }
}
