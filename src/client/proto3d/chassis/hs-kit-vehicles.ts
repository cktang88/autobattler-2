// Hard-surface kit, vehicle additions (ground hulls: light.ts, tanks.ts, generic.ts). Builds on chassis/hs-kit.ts and
// follows its rules: a dark structural core with separate thick armour plates on shadow gaps, faceted sections (never
// rounded / bulged lofts), functional parts in named slots, 2-3 one-sided features per unit, everything merged per
// material through the unit's Bld (triangles, never draw calls).
//
//   facetHull   faceted hull loft from stations (flat belly, vertical side band, sloped shoulder, flat deck), the lower
//               hull clamped inside the running gear like light.ts hull8; returns the deck query
//   facePlate   armour plate laid on a sloped face between two points (glacis, shoulders, casemate fronts)
//   ringSeat    low armoured turret-ring guard + collar (turret sits low, like a real MBT)
//   wheelArch   faceted mudguard / armoured wheel-well over a road wheel
//   spareWheel  spare tyre on a bracket (rear plate / deck)
//   sensorMast  telescopic mast with an optics head (recon / fire control)
//   dish        comms / radar dish on a short pivot
//   outrigger   hydraulic jack: box arm, piston, ground pad (siege platforms, artillery)
//   spade       recoil spade / dozer-style plate with ribs
//   slatCage    slat (cage) armour: frame + horizontal bars, stands off a flank
//   bullBar     tubular brush guard across a nose
//   periscopes  row of vision blocks on a hatch rim / cab roof
//   sandbags    sandbag course (ragtag / light units)
//   trussRun    lattice girder (two chords + diagonals) between two points

import * as THREE from 'three';
import { aim, bevBox, strutGeo, type MatLike, type P2, type V3 } from '../geo.ts';
import type { Bld } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { armorPlate, frame, hexSec, piston, rectP, sub, type Frame, type PlateOpts } from './hs-kit.ts';
import type { ChassisCtx, MountSpec } from './registry.ts';
import { collar } from './shapes.ts';

const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vcross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vdot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vlen = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const vlerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---- faceted hull --------------------------------------------------------------------------------------------------
/** Hull station (heights above stance.y0, half widths): x, belly y, side band bottom / top, deck y; belly half width,
 *  side half width, deck half width. Side band = vertical flank; shoulder slopes from (ws, ys1) to (wt, yt). */
export type FSt = [x: number, yb: number, ys0: number, ys1: number, yt: number, wb: number, ws: number, wt: number];
export interface FacetHull {
  /** deck query: flat deck inside wt, sloped shoulder to ws, -1 outside */
  deck: (x: number, z: number) => number;
  /** absolute stations after clamping (for slot placement) */
  rows: { x: number; yb: number; ys0: number; ys1: number; yt: number; wb: number; ws: number; wt: number }[];
  /** interpolated station at x (absolute heights) */
  at: (x: number) => { yb: number; ys0: number; ys1: number; yt: number; wb: number; ws: number; wt: number } | null;
}
/** Faceted hull loft (hexSec rings: sharp shoulders, flat deck, flat belly). The lower hull is clamped inside the
 *  running gear (stance.wi) and anything wider than that starts at the fender line (stance.yt), as light.ts hull8. */
export function facetHull(c: ChassisCtx, mat: MatLike, st: FSt[], zc = 0, clamp = true): FacetHull {
  const { b, stance } = c;
  const y0 = stance.y0, wi = stance.wi;
  const rows = st.map(([x, yb, ys0, ys1, yt, wb, ws, wt]) => {
    let a0 = y0 + ys0;
    if (clamp && ws > wi + 0.02 && !stance.legs) a0 = Math.max(a0, stance.yt + 0.005);
    const a1 = Math.max(y0 + ys1, a0 + 0.005), at = Math.max(y0 + yt, a1 + 0.005);
    return { x, yb: y0 + yb, ys0: a0, ys1: a1, yt: at, wb: clamp ? Math.min(wb, wi) : wb, ws, wt };
  });
  b.loft(mat, rows.map((r) => hexSec(r.x, r.yb, r.wb, r.ws, r.ys0, r.ys1, r.wt, r.yt, zc)));
  const at = (x: number) => {
    if (x < rows[0].x || x > rows[rows.length - 1].x) return null;
    let i = 0;
    while (i < rows.length - 2 && rows[i + 1].x < x) i++;
    const p = rows[i], q = rows[i + 1], f = (x - p.x) / (q.x - p.x || 1);
    const l = (a: number, b2: number) => a + (b2 - a) * f;
    return { yb: l(p.yb, q.yb), ys0: l(p.ys0, q.ys0), ys1: l(p.ys1, q.ys1), yt: l(p.yt, q.yt), wb: l(p.wb, q.wb), ws: l(p.ws, q.ws), wt: l(p.wt, q.wt) };
  };
  const deck = (x: number, z: number) => {
    const r = at(x);
    if (!r) return -1;
    const az = Math.abs(z - zc);
    if (az <= r.wt) return r.yt;
    if (az <= r.ws) return r.yt - ((r.yt - r.ys1) * (az - r.wt)) / (r.ws - r.wt || 1);
    return -1;
  };
  return { deck, rows, at };
}

// ---- plates ----------------------------------------------------------------------------------------------------------
export interface FaceOpts extends PlateOpts { fill?: number; cut?: number; shift?: number; slide?: number }
/** Armour plate on the sloped face through p0 -> p1 (the slope direction), `width` along `along`, normal toward `out`.
 *  fill = fraction of the slope length covered; slide = shift along the slope (+ toward p1); shift = along `along`. */
export function facePlate(b: Bld, kit: Kit, mat: MatLike, p0: V3, p1: V3, along: V3, width: number, thick: number, out: V3, o: FaceOpts = {}): Frame {
  const d = vsub(p1, p0), len = vlen(d);
  let n = vcross(along, d);
  const nl = vlen(n) || 1;
  n = [n[0] / nl, n[1] / nl, n[2] / nl];
  if (vdot(n, out) < 0) n = [-n[0], -n[1], -n[2]];
  const m = vlerp(p0, p1, 0.5 + (o.slide ?? 0));
  const al = vlen(along) || 1;
  const sh = o.shift ?? 0;
  const F = frame([m[0] + (along[0] / al) * sh, m[1] + (along[1] / al) * sh, m[2] + (along[2] / al) * sh], n, along);
  armorPlate(b, kit, mat, F, rectP(width, len * (o.fill ?? 0.9), o.cut ?? Math.min(width, len) * 0.08), thick, o);
  return F;
}

// ---- turret seats ----------------------------------------------------------------------------------------------------
/** Low armoured turret-ring guard flush on the deck + the collar the turret sits in. Returns the seat height. */
export function ringSeat(b: Bld, kit: Kit, m: MountSpec, deck: number, lift: number, seg = 14, mat?: MatLike): number {
  const y = deck + lift;
  b.lathe(mat ?? kit.armor2, [[0, 0], [m.r * 1.3, 0], [m.r * 1.28, Math.max(0.004, lift - 0.01)], [m.r * 1.16, lift], [0, lift]], [m.x, deck - 0.004, m.z], 'y', seg);
  collar(b, kit, m.x, y, m.z, m.r, y - Math.max(0.012, lift * 0.6), seg);
  return y;
}

// ---- wheels / running-gear dressing -------------------------------------------------------------------------------------
/** Faceted mudguard over a road wheel (3 flat plates on an arc, the last one angled down at the front). */
export function wheelArch(b: Bld, kit: Kit, mat: MatLike, x: number, cy: number, z: number, r: number, w: number, th: number, segs: [number, number][] = [[0.75, 1.5], [1.5, 2.35]]): void {
  for (const [a0, a1] of segs) {
    const p0: V3 = [x + Math.cos(a0) * r, cy + Math.sin(a0) * r, z], p1: V3 = [x + Math.cos(a1) * r, cy + Math.sin(a1) * r, z];
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    b.g(new THREE.BoxGeometry(len * 1.04, th, w), mat, new THREE.Matrix4().makeRotationZ(ang + Math.PI).setPosition((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, z));
  }
}
/** Spare tyre on a bracket, axle along `axis` (the face it is strapped to), centred at p. */
export function spareWheel(b: Bld, kit: Kit, p: V3, axis: 'x' | '-x' | 'z' | '-z' | 'y', r: number, w: number): void {
  b.lathe(kit.rubber, [[r * 0.45, -w / 2], [r * 0.8, -w / 2], [r, -w * 0.25], [r, w * 0.25], [r * 0.8, w / 2], [r * 0.45, w / 2]], p, axis, 10);
  b.lathe(kit.joint, [[0, -w * 0.3], [r * 0.5, -w * 0.3], [r * 0.5, w * 0.3], [r * 0.2, w * 0.42], [0, w * 0.42]], p, axis, 8);
}

// ---- masts, dishes, antennas ------------------------------------------------------------------------------------------
/** Telescopic sensor mast from base p up h: three stepped tubes, an optics head (box + two glass lenses facing +x of
 *  `yaw`), a clamp collar. */
export function sensorMast(b: Bld, kit: Kit, p: V3, h: number, r: number, yaw = 0, head = 1): number {
  const segs = [[0, 0.42, 1], [0.4, 0.74, 0.75], [0.72, 1, 0.55]];
  for (const [f0, f1, k] of segs) b.g(strutGeo([p[0], p[1] + h * f0, p[2]], [p[0], p[1] + h * f1, p[2]], r * k, r * k, 6), f0 === 0 ? kit.mech : kit.joint);
  b.g(new THREE.CylinderGeometry(r * 1.6, r * 1.8, r * 1.4, 6), kit.mech, new THREE.Matrix4().makeTranslation(p[0], p[1] + r * 0.7, p[2]));
  const s = r * 3.2 * head, top = p[1] + h;
  const M = new THREE.Matrix4().makeRotationY(yaw).setPosition(p[0], top + s * 0.35, p[2]);
  b.g(bevBox(s * 1.3, s * 0.7, s * 1.5, s * 0.1), kit.armor2, M);
  for (const dz of [-0.35, 0.35]) b.g(new THREE.CylinderGeometry(s * 0.2, s * 0.2, s * 0.12, 8).rotateZ(Math.PI / 2), kit.glass, M.clone().multiply(new THREE.Matrix4().makeTranslation(s * 0.68, 0, dz * s)));
  return top + s * 0.7;
}
/** Comms / radar dish on a short pivot post at p, facing yaw (radians about y), tilted up by tilt. */
export function dish(b: Bld, kit: Kit, p: V3, r: number, yaw = 0, tilt = 0.6, post = r * 0.8): void {
  b.g(strutGeo(p, [p[0], p[1] + post, p[2]], r * 0.12, r * 0.1, 6), kit.joint);
  const M = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2 + tilt)).setPosition(p[0], p[1] + post + r * 0.2, p[2]);
  const g = new THREE.LatheGeometry([new THREE.Vector2(0.001, -r * 0.25), new THREE.Vector2(r * 0.55, -r * 0.13), new THREE.Vector2(r, 0.0), new THREE.Vector2(r * 0.94, r * 0.04), new THREE.Vector2(r * 0.5, -r * 0.08), new THREE.Vector2(0.001, -r * 0.16)], 10);
  b.g(g, kit.shell, M);
  b.g(new THREE.CylinderGeometry(r * 0.05, r * 0.05, r * 0.55, 5).translate(0, r * 0.27, 0), kit.joint, M);
}

// ---- artillery / siege -------------------------------------------------------------------------------------------------
/** Hydraulic outrigger: box arm from a (hull) to the jack head, a piston from the hull above a to the arm middle, a jack
 *  leg down to a ground pad at foot (pad flat on y = foot[1]). */
export function outrigger(b: Bld, kit: Kit, a: V3, foot: V3, r: number, fine = true, padMat?: MatLike): void {
  const head: V3 = [foot[0], Math.max(foot[1] + r * 3, a[1] - r * 0.5), foot[2]];
  const d = vsub(head, a), len = vlen(d);
  b.g(bevBox(r * 1.6, r * 1.3, len, r * 0.2).translate(0, 0, len / 2), kit.armor2, aim(a, d, [0, 1, 0]));
  piston(b, kit, [a[0], a[1] + r * 1.6, a[2]], vlerp([a[0], a[1] + r * 0.6, a[2]], [head[0], head[1] + r * 0.6, head[2]], 0.6), r * 0.42, 0.5, fine);
  // jack: cylinder down to the pad, pad = dark octagon disc with a hazard band ring
  b.g(strutGeo(head, [foot[0], foot[1] + r * 0.5, foot[2]], r * 0.55, r * 0.5, 6), kit.joint);
  b.g(new THREE.CylinderGeometry(r * 0.75, r * 0.75, r * 1.2, 6), kit.mech, new THREE.Matrix4().makeTranslation(head[0], head[1], head[2]));
  b.g(new THREE.CylinderGeometry(r * 1.5, r * 1.8, r * 0.45, 8), padMat ?? kit.mech, new THREE.Matrix4().makeTranslation(foot[0], foot[1] + r * 0.22, foot[2]));
}
/** Recoil spade: a flat blade (local x across, y down the blade) with two ribs, hung from F (blade faces F's +z). */
export function spade(b: Bld, kit: Kit, F: Frame, w: number, h: number, th: number, mat?: MatLike): void {
  const poly: P2[] = [[-w / 2, 0], [w / 2, 0], [w / 2, h * 0.65], [w * 0.2, h], [-w * 0.2, h], [-w / 2, h * 0.65]];
  // blade lies in local (x, y) plane: slab is extruded along its local y, so rotate it upright
  const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, -y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, -th / 2);
  b.g(g, mat ?? kit.armor2, F);
  for (const s of [-0.28, 0.28]) b.g(new THREE.BoxGeometry(th * 1.4, h * 0.8, th * 2.6), kit.mech, sub(F, s * w, -h * 0.42, -th * 1.6));
}

// ---- protection / crew ----------------------------------------------------------------------------------------------------
/** Slat (cage) armour panel standing off a flank: frame + n horizontal bars, local x along, y up, panel at z = 0 of F. */
export function slatCage(b: Bld, kit: Kit, F: Frame, len: number, h: number, n: number, r: number, mat?: MatLike): void {
  const m = mat ?? kit.joint;
  for (const s of [-1, 1]) b.g(new THREE.BoxGeometry(r * 2, h, r * 2), kit.mech, sub(F, s * len / 2, h / 2, 0));
  for (let i = 0; i < n; i++) b.g(new THREE.BoxGeometry(len, r * 1.3, r * 2.6), m, sub(F, 0, (h * (i + 0.5)) / n, 0));
  // stand-off brackets back to the hull
  for (const s of [-0.48, 0, 0.48]) b.g(new THREE.BoxGeometry(r * 1.6, r * 1.6, r * 9), kit.mech, sub(F, s * len, h * 0.5, -r * 4.5));
}
/** Tubular brush guard / bull bar across a nose: two uprights and two rails, width w (along z), at x, from y to y + h. */
export function bullBar(b: Bld, kit: Kit, x: number, y: number, z: number, w: number, h: number, r: number, lean = 0.25): void {
  const top = (zz: number): V3 => [x + h * Math.sin(lean) * 0.4, y + h, zz];
  for (const s of [-0.38, 0.38]) b.g(strutGeo([x - r * 4, y + h * 0.2, z + s * w], [x, y, z + s * w], r, r, 5), kit.joint);
  for (const s of [-0.38, 0.38]) b.g(strutGeo([x, y, z + s * w], top(z + s * w), r, r, 5), kit.joint);
  b.g(strutGeo(top(z - w / 2), top(z + w / 2), r, r, 5), kit.joint);
  b.g(strutGeo([x + h * Math.sin(lean) * 0.2, y + h * 0.45, z - w / 2], [x + h * Math.sin(lean) * 0.2, y + h * 0.45, z + w / 2], r, r, 5), kit.joint);
}
/** Row of n vision blocks (dark frame + glass) along z centred at (x, y, z), facing +x rotated by yaw. */
export function periscopes(b: Bld, kit: Kit, x: number, y: number, z: number, n: number, s: number, yaw = 0, gap = 1.3): void {
  for (let i = 0; i < n; i++) {
    const dz = (i - (n - 1) / 2) * s * gap;
    const M = new THREE.Matrix4().makeRotationY(yaw).setPosition(x - Math.sin(yaw) * dz, y + s * 0.3, z + Math.cos(yaw) * dz);
    b.g(new THREE.BoxGeometry(s * 0.9, s * 0.6, s), kit.mech, M);
    b.g(new THREE.BoxGeometry(s * 0.2, s * 0.36, s * 0.8), kit.glass, M.clone().multiply(new THREE.Matrix4().makeTranslation(s * 0.42, 0.0, 0)));
  }
}
/** Sandbag course along F's +x: n bags of size s (canvas), one row (plus a half row on top when rows = 2). */
export function sandbags(b: Bld, kit: Kit, F: Frame, n: number, s: number, rows = 1): void {
  for (let r = 0; r < rows; r++) for (let i = 0; i < n - r; i++) {
    const x = (i - (n - 1 - r) / 2) * s * 1.02;
    b.g(bevBox(s, s * 0.45, s * 0.62, s * 0.18), kit.canvas, sub(F, x, s * 0.22 + r * s * 0.42, 0, 0, (i % 2 ? 0.08 : -0.06), 0));
  }
}
/** Lattice girder from a to c: two chords (offset by +-spread) and zig-zag diagonals between them. */
export function trussRun(b: Bld, kit: Kit, a: V3, c: V3, spread: V3, r: number, n: number, mat?: MatLike): void {
  const m = mat ?? kit.joint;
  const A0: V3 = [a[0] - spread[0], a[1] - spread[1], a[2] - spread[2]], A1: V3 = [a[0] + spread[0], a[1] + spread[1], a[2] + spread[2]];
  const C0: V3 = [c[0] - spread[0], c[1] - spread[1], c[2] - spread[2]], C1: V3 = [c[0] + spread[0], c[1] + spread[1], c[2] + spread[2]];
  b.g(strutGeo(A0, C0, r, r, 4), kit.mech);
  b.g(strutGeo(A1, C1, r, r, 4), kit.mech);
  for (let i = 0; i < n; i++) {
    const p = vlerp(A0, C0, i / n), q = vlerp(A1, C1, (i + 0.5) / n), p2 = vlerp(A0, C0, (i + 1) / n);
    b.g(strutGeo(p, q, r * 0.6, r * 0.6, 4), m);
    b.g(strutGeo(q, p2, r * 0.6, r * 0.6, 4), m);
  }
}

/** Cheap recessed grille / door (plain boxes, ~12 tris each): frame ring, dark floor, optional louvre slats. Lies on F
 *  (+y out of the surface), w along F's x, d along F's z. For small hulls where recessPanel's bevelled frame is too dense. */
export function grille(b: Bld, kit: Kit, F: Frame, w: number, d: number, depth: number, slats = 0, frameMat?: MatLike): void {
  const rim = Math.min(w, d) * 0.14, fm = frameMat ?? kit.armor2;
  for (const s of [-1, 1]) {
    b.g(new THREE.BoxGeometry(w, depth, rim), fm, sub(F, 0, depth / 2, s * (d / 2 - rim / 2)));
    b.g(new THREE.BoxGeometry(rim, depth, d - rim * 2), fm, sub(F, s * (w / 2 - rim / 2), depth / 2, 0));
  }
  b.g(new THREE.BoxGeometry(w - rim * 1.6, depth * 0.3, d - rim * 1.6), kit.mech, sub(F, 0, depth * 0.15, 0));
  for (let i = 0; i < slats; i++) {
    const z = -d / 2 + rim + ((d - rim * 2) * (i + 0.5)) / slats;
    b.g(new THREE.BoxGeometry(w - rim * 2.2, depth * 0.16, ((d - rim * 2) / slats) * 0.62), kit.joint, sub(F, 0, depth * 0.62, z, 0.5, 0, 0));
  }
}

/** Armour plate on every sloped face of a plan-polygon frustum (bottom ring `plan` at y, height h, top ring scaled by
 *  `top` about the centroid, as tanks-kit frustum): an armour belt with shadow gaps. skip(i) leaves face i bare. */
export function frustumPlates(b: Bld, kit: Kit, mat: MatLike, plan: P2[], y: number, h: number, top: number, thick: number, o: FaceOpts & { widthK?: number; skip?: (i: number) => boolean; f0?: number; f1?: number } = {}): void {
  const n = plan.length;
  let cx = 0, cz = 0;
  for (const [x, z] of plan) { cx += x / n; cz += z / n; }
  const f0 = o.f0 ?? 0.1, f1 = o.f1 ?? 0.9;
  const ringAt = (p: P2, f: number): V3 => { const k = 1 - (1 - top) * f; return [cx + (p[0] - cx) * k, y + h * f, cz + (p[1] - cz) * k]; };
  for (let i = 0; i < n; i++) {
    if (o.skip?.(i)) continue;
    const a = plan[i], e = plan[(i + 1) % n];
    const m: P2 = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
    const p0 = ringAt(m, f0), p1 = ringAt(m, f1);
    const along: V3 = [e[0] - a[0], 0, e[1] - a[1]];
    const wid = Math.hypot(along[0], along[2]) * (1 - (1 - top) * (f0 + f1) / 2) * (o.widthK ?? 0.8);
    facePlate(b, kit, mat, p0, p1, along, wid, thick, [m[0] - cx, 0.2, m[1] - cz], { fill: 1, ...o });
  }
}
