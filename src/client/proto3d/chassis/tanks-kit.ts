// Shape helpers for the tank hulls (chassis/tanks.ts) and track gear (mobility/tracks.ts): plan-polygon frustums
// (hexes, octagons, arrowheads, teardrops lofted with taper and lean), rounded cross-section lofts along x (hover-
// tank / teardrop hulls with a height profile), and a transforming Bld proxy so any builder can be placed rotated.

import * as THREE from 'three';
import { Bld, type MatLike, type P2, type V3 } from '../geo.ts';

/** Bld proxy that applies a matrix to everything written through it (geometry still merges into `base`). */
export class XBld extends Bld {
  base: Bld;
  T: THREE.Matrix4;
  constructor(base: Bld, T: THREE.Matrix4) { super(); this.base = base; this.T = T; this.segK = base.segK; }
  override g(geo: THREE.BufferGeometry, matl: MatLike, m?: THREE.Matrix4): this {
    this.base.g(geo, matl, m ? this.T.clone().multiply(m) : this.T);
    return this;
  }
}
/** translate + yaw (radians, about +y) matrix */
export const place = (x: number, y: number, z: number, yaw = 0) => new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);

// ---- plan polygons (x forward, z right), counter-clockwise not required (lofts orient themselves) --------------------
/** regular-ish n-gon with radii rx/rz, rotated by rot (0 = a vertex on +x) */
export function ngon(n: number, rx: number, rz = rx, rot = 0, cx = 0, cz = 0): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]); }
  return out;
}
/** teardrop / bullet plan: front half-length f (superellipse power pf), rear half-length r (power pr), half-width hw */
export function dropPlan(f: number, r: number, hw: number, n = 16, pf = 2, pr = 3, cx = 0): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const front = c >= 0, p = front ? pf : pr, e = 2 / p;
    out.push([cx + Math.sign(c) * Math.pow(Math.abs(c), e) * (front ? f : r), Math.sign(s) * Math.pow(Math.abs(s), e) * hw]);
  }
  return out;
}
/** symmetric plan from a half outline [x, halfWidth] listed nose -> tail */
export function mirrorPlan(half: P2[]): P2[] {
  const r = half.map(([x, w]) => [x, w] as P2);
  const l = [...half].reverse().map(([x, w]) => [x, -w] as P2);
  return [...r, ...l];
}
const centroid = (p: P2[]): P2 => { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; };
/** scale a plan about its centroid (sx, sz), then shift */
export function scalePlan(p: P2[], sx: number, sz = sx, dx = 0, dz = 0): P2[] {
  const [cx, cz] = centroid(p);
  return p.map(([x, z]) => [cx + (x - cx) * sx + dx, cz + (z - cz) * sz + dz]);
}
/** approximate inset by d (moves each vertex toward the centroid) */
export function insetPlan(p: P2[], d: number): P2[] {
  const [cx, cz] = centroid(p);
  return p.map(([x, z]) => { const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1; const k = Math.max(0.05, (l - d) / l); return [cx + dx * k, cz + dz * k]; });
}
/** point in convex polygon */
export function inPlan(p: P2[], x: number, z: number): boolean {
  let sgn = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(c) < 1e-9) continue;
    const s = Math.sign(c);
    if (sgn && s !== sgn) return false;
    sgn = s;
  }
  return true;
}

export interface FrustumOpts {
  /** top scale [x, z] relative to the base plan */
  top?: [number, number];
  /** top shift [x, z] (lean) */
  shift?: [number, number];
  /** top bevel (height and inset of the top ring) */
  bev?: number;
  /** bottom bevel */
  bot?: number;
  /** intermediate rings: [height frac, scale x, scale z] */
  mid?: [number, number, number][];
}
/** Chamfered frustum from a convex plan polygon: bottom at y, height h, tapering/leaning to the top. */
export function frustum(b: Bld, mat: MatLike, plan: P2[], y: number, h: number, o: FrustumOpts = {}): void {
  const [tx, tz] = o.top ?? [1, 1];
  const [sx, sz] = o.shift ?? [0, 0];
  const bev = Math.min(o.bev ?? h * 0.15, h * 0.45);
  const bot = Math.min(o.bot ?? 0, h * 0.3);
  const ring = (p: P2[], yy: number): V3[] => p.map(([x, z]) => [x, yy, z]);
  const rings: V3[][] = [];
  if (bot > 0) { rings.push(ring(insetPlan(plan, bot), y)); rings.push(ring(plan, y + bot)); } else rings.push(ring(plan, y));
  for (const [f, mx, mz] of o.mid ?? []) rings.push(ring(scalePlan(plan, mx, mz, sx * f, sz * f), y + h * f));
  const tp = scalePlan(plan, tx, tz, sx, sz);
  rings.push(ring(tp, y + h - bev));
  rings.push(ring(insetPlan(tp, bev), y + h));
  b.loft(mat, rings);
}

// ---- x-lofts: rounded cross-sections along the hull length ------------------------------------------------------------
/** one station: x, half width (max), bottom y, top y, crown (top half-width as a fraction), belly (bottom fraction) */
export interface Sec { x: number; hw: number; yb: number; yt: number; crown?: number; belly?: number; zc?: number }
/** 10-point rounded section: flat belly, bulged flank at ~35% height, rounded shoulder, flat crown */
export function secRing(s: Sec): V3[] {
  const c = s.crown ?? 0.6, be = s.belly ?? 0.8, zc = s.zc ?? 0;
  const h = s.yt - s.yb, wt = s.hw * c, ws = wt + (s.hw - wt) * 0.7;
  const half: P2[] = [[s.hw * be, 0], [s.hw, h * 0.3], [s.hw, h * 0.5], [ws, h * 0.84], [wt, h]];
  const out: V3[] = [];
  for (const [z, y] of half) out.push([s.x, s.yb + y, zc + z]);
  for (const [z, y] of [...half].reverse()) out.push([s.x, s.yb + y, zc - z]);
  return out;
}
export function xLoft(b: Bld, mat: MatLike, st: Sec[]): void { b.loft(mat, st.map(secRing)); }
/** top height of an xLoft at (x, z), -1 outside */
export function xTop(st: Sec[], x: number, z: number): number {
  if (x < st[0].x || x > st[st.length - 1].x) return -1;
  let i = 0;
  while (i < st.length - 2 && st[i + 1].x < x) i++;
  const a = st[i], c = st[i + 1], f = (x - a.x) / (c.x - a.x || 1);
  const L = (p: number, q: number) => p + (q - p) * f;
  const hw = L(a.hw, c.hw), yb = L(a.yb, c.yb), yt = L(a.yt, c.yt), cr = L(a.crown ?? 0.6, c.crown ?? 0.6), zc = L(a.zc ?? 0, c.zc ?? 0);
  const az = Math.abs(z - zc), wt = hw * cr;
  if (az <= wt) return yt;
  if (az <= hw) return yt - (yt - (yb + (yt - yb) * 0.5)) * ((az - wt) / (hw - wt || 1));
  return -1;
}

/** Revolved drum (tower / turntable) with chamfered top edge, radius r, from y0 to y1, at (x, z). */
export function drum(b: Bld, mat: MatLike, x: number, z: number, r: number, y0: number, y1: number, seg = 16, flare = 1.06): void {
  const h = y1 - y0, c = Math.min(r * 0.14, h * 0.3);
  b.lathe(mat, [[0, 0], [r * flare, 0], [r * flare, h * 0.15], [r, h * 0.3], [r, h - c], [r - c, h], [0, h]], [x, y0, z], 'y', seg);
}
