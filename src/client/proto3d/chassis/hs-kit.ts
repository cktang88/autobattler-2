// Hard-surface kit: "stylized realistic" construction parts for the chassis and mobility builders.
//
// The older shape kits (shapes.ts block(), tanks-kit frustum / xLoft) build every mass as one closed, uniformly
// chamfered solid, which reads as moulded plastic (a toy). This kit builds machines the way the reference games do
// (Phantom Brigade, BattleTech, Iron Harvest): a dark structural CORE, with separate ARMOUR PLATES that have real
// thickness, a small bevel, stand proud of the core on a dark backing (a shadow gap shows under every edge), and
// overlap in stepped stacks; plus FUNCTIONAL parts that imply how the machine works and how big it is (road wheels
// on suspension arms, return rollers, toothed sprockets, pistons with clevis eyes, hoses, smoke-grenade launchers,
// vision blocks, hatches, tow hooks, handrails, ladders, caged lamps, stowage).
//
// RULES
//   * Every part has a reason (it moves, carries, protects, vents or lets a person in) and goes in a NAMED SLOT of the
//     chassis (glacis, cheek, sponson, rear plate, engine deck, joint...), never in a random scatter.
//   * 2-3 deliberately asymmetric features per unit (cupola / hatch, exhaust, stowage, antenna on one side only).
//   * Faceted sections (facetLoft / hexSec) instead of rounded / bulged ones.
//   * Everything writes into the unit's Bld, so it merges per material: detail costs triangles, never draw calls.
//   * Detail level: the renderer has no LOD switch (one template per design, instanced), so `fine` (= tertiary parts:
//     bolts, hoses, handrails, vision blocks, cage bars) is decided per unit from its size class with `fineFor(S)`;
//     tiny repeated parts are plain 12-triangle boxes.
//   * Materials: only the kit's role materials (armor / armor2 / shell / mech / joint / steel / rubber / glass / lamp /
//     hot / hazard / accent / canvas), so palette changes in materials.ts apply automatically.
//
// FRAMES: surface parts are placed with a local frame F = frame(origin, normal, along): local +x = `along`, +y = the
// outward normal, +z = x cross y. Plate outlines are 2D polygons in local (x, z).

import * as THREE from 'three';
import { bevBox, Bld, chamRect, slabGeo, strutGeo, type MatLike, type P2, type V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';

export type Frame = THREE.Matrix4;

/** tertiary detail (bolts, hoses, handrails, vision blocks, cage bars) only on units big enough to show it */
export const fineFor = (S: number) => S >= 2;

const v3 = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** local frame at p: +y = outward normal n, +x = `along` (made perpendicular to n), +z = x cross y */
export function frame(p: V3, n: V3, along: V3 = [1, 0, 0]): Frame {
  const y = v3(n).normalize();
  const x = v3(along).addScaledVector(y, -v3(along).dot(y));
  if (x.lengthSq() < 1e-8) x.set(0, 0, 1).addScaledVector(y, -y.z);
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(p[0], p[1], p[2]);
}
/** frame on the plane through three points a (origin), b (along +x) and c (third point, any side); normal points to `out` */
export function planeFrame(a: V3, b: V3, c: V3, out: V3): Frame {
  const u = v3(b).sub(v3(a)), w = v3(c).sub(v3(a));
  const n = new THREE.Vector3().crossVectors(u, w).normalize();
  if (n.dot(v3(out)) < 0) n.negate();
  return frame(a, [n.x, n.y, n.z], [u.x, u.y, u.z]);
}
/** point in a frame's local coordinates -> hull space */
export function at(F: Frame, x: number, y: number, z: number): V3 {
  const p = new THREE.Vector3(x, y, z).applyMatrix4(F);
  return [p.x, p.y, p.z];
}
/** sub-frame: offset (x, y, z) in F, then rotate about local x / y / z (radians) */
export function sub(F: Frame, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Frame {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')).setPosition(x, y, z);
  return F.clone().multiply(m);
}

// ---- polygons --------------------------------------------------------------------------------------------------------
/** rectangle w (x) by d (z) with cut corners c, centred at (cx, cz) */
export const rectP = (w: number, d: number, c = 0, cx = 0, cz = 0): P2[] => chamRect(w, d, c).map(([x, z]) => [x + cx, z + cz] as P2);
/** trapezoid: length l along x, width wf at +x end and wb at -x end, corner cut c */
export function trapP(l: number, wf: number, wb: number, c = 0): P2[] {
  const x = l / 2;
  if (c <= 0) return [[-x, -wb / 2], [x, -wf / 2], [x, wf / 2], [-x, wb / 2]];
  return [[-x, -wb / 2 + c], [-x + c, -wb / 2], [x - c, -wf / 2], [x, -wf / 2 + c], [x, wf / 2 - c], [x - c, wf / 2], [-x + c, wb / 2], [-x, wb / 2 - c]];
}
/** inset a convex polygon by d (true edge offset, so thin plates keep their shape) */
export function inset(p: P2[], d: number): P2[] {
  const n = p.length;
  // orientation
  let area = 0;
  for (let i = 0; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const s = area > 0 ? 1 : -1;
  const lines = p.map((a, i) => {
    const b = p[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    // inward normal for CCW (area>0) is (-dz, dx)
    const nx = (-dz / l) * s, nz = (dx / l) * s;
    return { px: a[0] + nx * d, pz: a[1] + nz * d, dx, dz };
  });
  return p.map((q, i) => {
    const A = lines[(i + n - 1) % n], B = lines[i];
    const den = A.dx * B.dz - A.dz * B.dx;
    if (Math.abs(den) < 1e-9) return [B.px, B.pz] as P2;
    const t = ((B.px - A.px) * B.dz - (B.pz - A.pz) * B.dx) / den;
    void q;
    return [A.px + A.dx * t, A.pz + A.dz * t] as P2;
  });
}

// ---- armour --------------------------------------------------------------------------------------------------------------
export interface PlateOpts {
  /** bevel on the top edges (default 0.22 x thick: a crisp edge, not a toy chamfer) */
  bev?: number;
  /** height of the plate above the frame origin (the dark backing fills it): shows as a shadow line */
  standoff?: number;
  /** how far the backing is inset from the plate edge (the overhang / shadow gap) */
  gap?: number;
  /** backing material (default kit.mech); null = no backing */
  back?: MatLike | null;
  /** top face scale (<1 = sloped plate edges, a cast / welded look) */
  taper?: number;
}
/** Armour plate with real thickness standing proud of the surface on a dark inset backing. poly in local (x, z). */
export function armorPlate(b: Bld, kit: Kit, mat: MatLike, F: Frame, poly: P2[], thick: number, o: PlateOpts = {}): number {
  const so = o.standoff ?? thick * 0.45;
  const gap = o.gap ?? thick * 0.9;
  const back = o.back === undefined ? kit.mech : o.back;
  if (back && so > 0.0005) b.g(slabGeo(inset(poly, gap), so + thick * 0.2, 0), back, F);
  const bev = Math.min(o.bev ?? thick * 0.22, thick * 0.45);
  if (o.taper !== undefined && o.taper < 1) {
    const top = inset(poly, (1 - o.taper) * 0.5 * Math.min(spanOf(poly, 0), spanOf(poly, 1)));
    b.loft(mat, [poly.map(([x, z]) => [x, so, z] as V3), poly.map(([x, z]) => [x, so + thick * 0.55, z] as V3), top.map(([x, z]) => [x, so + thick, z] as V3)], true, true, F);
  } else b.g(slabGeo(poly, thick, bev), mat, F.clone().multiply(new THREE.Matrix4().makeTranslation(0, so, 0)));
  return so + thick;
}
const spanOf = (p: P2[], k: 0 | 1) => Math.max(...p.map((q) => q[k])) - Math.min(...p.map((q) => q[k]));

export interface Layer { mat?: MatLike; inset: number; thick: number; shift?: [number, number]; standoff?: number }
/** Stepped plate stack: each layer sits on top of the previous, inset and shifted (turret cheeks, glacis, pauldrons). */
export function plateStack(b: Bld, kit: Kit, mat: MatLike, F: Frame, poly: P2[], layers: Layer[], o: PlateOpts = {}): number {
  let y = 0;
  layers.forEach((L, i) => {
    const [sx, sz] = L.shift ?? [0, 0];
    const p = inset(poly, L.inset).map(([x, z]) => [x + sx, z + sz] as P2);
    y += armorPlate(b, kit, L.mat ?? mat, sub(F, 0, y, 0), p, L.thick, { ...o, standoff: L.standoff ?? (i === 0 ? o.standoff : L.thick * 0.35) });
  });
  return y;
}

/** Recessed panel: raised frame ring around a dark sunken floor (reads as a cavity at distance), optional louvres. */
export function recessPanel(b: Bld, kit: Kit, F: Frame, w: number, d: number, depth: number, o: { frame?: MatLike; floor?: MatLike; slats?: number; rim?: number; slatMat?: MatLike } = {}): void {
  const rim = o.rim ?? Math.min(w, d) * 0.12;
  const fm = o.frame ?? kit.armor2;
  for (const s of [-1, 1]) {
    b.g(bevBox(w, depth, rim, rim * 0.25), fm, sub(F, 0, depth / 2, s * (d / 2 - rim / 2)));
    b.g(bevBox(rim, depth, d - rim * 2, rim * 0.25), fm, sub(F, s * (w / 2 - rim / 2), depth / 2, 0));
  }
  b.g(new THREE.BoxGeometry(w - rim * 1.6, depth * 0.3, d - rim * 1.6), o.floor ?? kit.mech, sub(F, 0, depth * 0.15, 0));
  const n = o.slats ?? 0;
  for (let i = 0; i < n; i++) {
    const z = -d / 2 + rim + ((d - rim * 2) * (i + 0.5)) / n;
    b.g(new THREE.BoxGeometry(w - rim * 2.2, depth * 0.16, ((d - rim * 2) / n) * 0.62), o.slatMat ?? kit.joint, sub(F, 0, depth * 0.62, z, 0.5, 0, 0));
  }
}

/** Faceted hull section (6 points, sharp shoulders): flat bottom half-width wb at yb, vertical side ws from ys0 to ys1,
 *  sloped shoulder to the flat top half-width wt at yt. */
export function hexSec(x: number, yb: number, wb: number, ws: number, ys0: number, ys1: number, wt: number, yt: number, zc = 0): V3[] {
  return [[x, yb, zc - wb], [x, yb, zc + wb], [x, ys0, zc + ws], [x, ys1, zc + ws], [x, yt, zc + wt], [x, yt, zc - wt], [x, ys1, zc - ws], [x, ys0, zc - ws]];
}

// ---- running gear ----------------------------------------------------------------------------------------------------------
function hull2d(pts: P2[]): P2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P2[] = [], up: P2[] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop();
  return [...lo, ...up]; // CCW in (x, y)
}

export interface TrackSys {
  /** track length (x), height (top run top), width (z) */
  L: number; h: number; w: number;
  /** lateral centre and outer side (+1 right / -1 left) */
  z: number; side: number;
  /** road wheels per side (default from length, 5-7) */
  wheels?: number;
  /** return rollers (default 3; 0 = flat top run on the wheels, e.g. big-wheel suspensions) */
  rollers?: number;
  /** segmented side skirt over the upper part of the run: panel count (0 = none) */
  skirt?: number;
  /** skirt reach below the top run, fraction of h (default 0.45) */
  skirtDrop?: number;
  /** thin fender over the top run */
  fender?: boolean;
  /** tertiary detail (bump stops, hub bolts, skirt bolts) */
  fine?: boolean;
  /** heavier links / bigger sprocket teeth */
  heavy?: boolean;
  /** fewer, larger road wheels (exposed carriages, bogies) */
  bigWheels?: boolean;
  /** the top run is hidden under a sponson / fender: skip its link shoes */
  coverTop?: boolean;
  /** skirt material (default kit.armor2) */
  skirtMat?: MatLike;
}
/** Track system: segmented link belt, toothed rear drive sprocket, raised front idler, 5-7 road wheels on trailing
 *  suspension arms, return rollers on the hull rail, optional segmented skirt and fender. Local frame: track centred
 *  at x = 0, ground at y = 0, +x forward. Returns the outline (CCW, x/y) for callers that need it. */
export function trackSystem(b: Bld, kit: Kit, o: TrackSys): P2[] {
  const { L, h, w, z, side } = o;
  const t = Math.max(0.016, h * 0.075);
  let rw = h * 0.25, wy = t + rw;
  const Rs = h * 0.27, xs = -L / 2 + Rs + t, ys = h * 0.6;
  const Ri = h * 0.22, xi = L / 2 - Ri - t, yi = h * 0.55;
  const x0 = xs + Rs * 0.75 + rw, x1 = xi - Ri * 0.5 - rw;
  const span = Math.max(0, x1 - x0);
  const nW = o.wheels ?? Math.max(2, Math.min(7, Math.round(span / (rw * 2.15)) + 1));
  // big-wheel (Christie-style) suspensions: fewer, larger wheels carrying the top run directly
  if (o.bigWheels) { rw = Math.min(h * 0.36, (span + rw * 2) / (nW * 2.05)); wy = t + rw; }
  const wheelsX = nW === 1 || span < 1e-3 ? [(x0 + x1) / 2] : Array.from({ length: nW }, (_, i) => x0 + (span * i) / Math.max(1, nW - 1));
  const nR = o.rollers ?? 3, rr = h * 0.075;
  const yr = ys + Rs - rr + h * 0.005;
  const rollersX = Array.from({ length: nR }, (_, i) => x0 + ((x1 - x0) * (i + 0.5 + (nR === 3 ? 0 : 0))) / nR);
  // ---- belt outline: convex hull of the wheels it wraps (expanded by the link thickness)
  const circ: [number, number, number][] = [[xs, ys, Rs], [xi, yi, Ri], ...wheelsX.map((x) => [x, wy, rw] as [number, number, number]), ...rollersX.map((x) => [x, yr, rr] as [number, number, number])];
  const samp: P2[] = [];
  for (const [cx, cy, r] of circ) for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; samp.push([cx + Math.cos(a) * (r + t), cy + Math.sin(a) * (r + t)]); }
  const hull = hull2d(samp);
  // resample at the link pitch
  const pitch = Math.max(0.028, h * (o.heavy ? 0.16 : 0.14));
  const loop = [...hull, hull[0]];
  const lens = [0];
  for (let i = 1; i < loop.length; i++) lens.push(lens[i - 1] + Math.hypot(loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1]));
  const total = lens[lens.length - 1];
  const nL = Math.max(12, Math.round(total / pitch));
  const P: P2[] = [], T: P2[] = [];
  let sg = 0;
  for (let i = 0; i < nL; i++) {
    const s = (i / nL) * total;
    while (sg < lens.length - 2 && lens[sg + 1] < s) sg++;
    const f = (s - lens[sg]) / (lens[sg + 1] - lens[sg] || 1);
    const [ax, ay] = loop[sg], [cx, cy] = loop[sg + 1];
    P.push([ax + (cx - ax) * f, ay + (cy - ay) * f]);
    const l = Math.hypot(cx - ax, cy - ay) || 1;
    T.push([(cx - ax) / l, (cy - ay) / l]);
  }
  // belt band (rubber-dark steel), a closed ribbon: outer face, inner face, two side walls
  const pos: number[] = [];
  const hw = w / 2;
  const quad = (a: V3, b2: V3, c: V3, d: V3) => pos.push(...a, ...b2, ...c, ...a, ...c, ...d);
  for (let i = 0; i < nL; i++) {
    const j = (i + 1) % nL;
    const [ax, ay] = P[i], [bx, by] = P[j];
    // outward normal of a CCW loop: (ty, -tx)
    const na: P2 = [T[i][1], -T[i][0]], nb: P2 = [T[j][1], -T[j][0]];
    const ia: P2 = [ax - na[0] * t * 0.55, ay - na[1] * t * 0.55], ib: P2 = [bx - nb[0] * t * 0.55, by - nb[1] * t * 0.55];
    // windings: outer face out, inner face in (toward the loop centre), side walls +-z
    quad([ax, ay, z - hw], [bx, by, z - hw], [bx, by, z + hw], [ax, ay, z + hw]);
    quad([ax, ay, z + hw], [bx, by, z + hw], [ib[0], ib[1], z + hw], [ia[0], ia[1], z + hw]);
    quad([ax, ay, z - hw], [ia[0], ia[1], z - hw], [ib[0], ib[1], z - hw], [bx, by, z - hw]);
  }
  const band = new THREE.BufferGeometry();
  band.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  band.computeVertexNormals();
  b.g(band, kit.rubber);
  // link shoes: one raised pad per pitch (gaps between them = readable links), a centre guide horn on the inside run
  const coverY = o.coverTop ? Math.max(...hull.map((q) => q[1])) - t * 3 : 1e9;
  for (let i = 0; i < nL; i++) {
    const [px, py] = P[i], [tx, ty] = T[i];
    if (py > coverY) continue;
    const ang = Math.atan2(ty, tx), nx = ty, ny = -tx;
    b.g(new THREE.BoxGeometry(pitch * 0.66, t * 0.62, w * 1.04), kit.joint, new THREE.Matrix4().makeRotationZ(ang).setPosition(px + nx * t * 0.22, py + ny * t * 0.22, z));
  }
  // ---- wheels (outer face toward `side`)
  const ax = side > 0 ? 'z' : '-z';
  const zo = z + side * hw;
  // road wheel: rubber-tyred dual wheel across the belt, dished steel disc and hub cap on the outer face
  for (const x of wheelsX) {
    b.lathe(kit.rubber, [[0, 0], [rw, 0], [rw, w * 0.94], [0, w * 0.94]], [x, wy, z - side * w * 0.47], ax, 10);
    b.lathe(kit.joint, [[0, 0], [rw * 0.84, 0], [rw * 0.5, w * 0.07], [rw * 0.26, w * 0.14], [0, w * 0.14]], [x, wy, zo - side * w * 0.04], ax, 8);
    // trailing suspension arm on the inner face: hub -> pivot on the hull rail ahead of the wheel
    const zi = z - side * (hw + w * 0.06);
    b.g(strutGeo([x, wy, zi], [x + rw * 0.95, wy + rw * 0.75, zi], rw * 0.17, rw * 0.13, 5), kit.mech);
    b.g(new THREE.BoxGeometry(rw * 0.5, rw * 0.4, w * 0.18), kit.mech, new THREE.Matrix4().makeTranslation(x + rw * 0.95, wy + rw * 0.75, zi - side * w * 0.04));
    if (o.fine) b.g(new THREE.BoxGeometry(rw * 0.3, rw * 0.22, w * 0.3), kit.joint, new THREE.Matrix4().makeTranslation(x, wy + rw * 1.25, zi));
  }
  // return rollers on short stub axles
  for (const x of rollersX) {
    b.lathe(kit.joint, [[0, 0], [rr, 0], [rr, w * 0.7], [0, w * 0.7]], [x, yr, z - side * w * 0.35], ax, 6);
    b.g(strutGeo([x, yr, z - side * w * 0.35], [x, yr, z - side * (hw + w * 0.2)], rr * 0.3, rr * 0.3, 5), kit.mech);
  }
  // drive sprocket (rear): toothed outer ring proud of the belt, hub, final-drive housing behind it
  const nT = o.heavy ? 12 : 10;
  b.lathe(kit.joint, [[0, 0], [Rs * 0.92, 0], [Rs * 0.92, w * 0.22], [Rs * 0.4, w * 0.34], [0, w * 0.42]], [xs, ys, zo - side * w * 0.2], ax, 10);
  b.lathe(kit.joint, [[0, 0], [Rs * 0.92, 0], [Rs * 0.92, w * 0.16], [0, w * 0.16]], [xs, ys, z - side * w * 0.5], ax, 10);
  for (let k = 0; k < nT; k++) {
    const a = (k / nT) * Math.PI * 2;
    b.g(new THREE.BoxGeometry(Rs * 0.26, Rs * 0.3, w * 0.12), kit.steel, new THREE.Matrix4().makeRotationZ(a).setPosition(xs + Math.cos(a) * (Rs + t * 0.35), ys + Math.sin(a) * (Rs + t * 0.35), zo - side * w * 0.09));
  }
  b.lathe(kit.mech, [[0, 0], [Rs * 0.62, 0], [Rs * 0.5, w * 0.3], [0, w * 0.3]], [xs, ys, z - side * (hw + w * 0.28)], ax, 8);
  // idler (front, raised): spoked disc look via a deep dish, track-tension arm to the hull
  b.lathe(kit.joint, [[0, 0], [Ri * 0.95, 0], [Ri * 0.95, w * 0.12], [Ri * 0.5, w * 0.06], [Ri * 0.2, w * 0.2], [0, w * 0.2]], [xi, yi, zo - side * w * 0.1], ax, 10);
  b.lathe(kit.rubber, [[0, 0], [Ri * 0.96, 0], [Ri * 0.96, w * 0.86], [0, w * 0.86]], [xi, yi, z - side * w * 0.45], ax, 10);
  b.g(strutGeo([xi, yi, z - side * (hw + w * 0.05)], [xi - Ri * 1.6, yi + Ri * 0.2, z - side * (hw + w * 0.05)], Ri * 0.22, Ri * 0.18, 6), kit.mech);
  // ---- fender + skirt
  const yTop = Math.max(...hull.map((q) => q[1]));
  if (o.fender) {
    const fl = L * 0.94;
    b.g(slabGeo(rectP(fl, w * 1.1, w * 0.04), h * 0.035, h * 0.008), kit.armor2, new THREE.Matrix4().makeTranslation(-L * 0.01, yTop + h * 0.02, z));
    b.g(bevBox(h * 0.38, h * 0.03, w * 1.06, h * 0.006), kit.armor2, new THREE.Matrix4().makeRotationZ(-0.5).setPosition(L * 0.47 + h * 0.12, yTop - h * 0.06, z));
  }
  if (o.skirt && o.skirt > 0) {
    skirtRun(b, kit, { x0: -L * 0.46, x1: L * 0.44, yTop: yTop + h * 0.04, h: h * (o.skirtDrop ?? 0.45), z: zo + side * h * 0.035, side, n: o.skirt, thick: Math.max(0.012, h * 0.045), fine: o.fine, mat: o.skirtMat });
  }
  return hull;
}
export interface SkirtOpts { x0: number; x1: number; yTop: number; h: number; z: number; side: number; n: number; thick: number; fine?: boolean; mat?: MatLike; lean?: number }
/** Segmented side skirt: n separate armour panels with gaps, hung from a dark rail, rubber flap strip along the bottom. */
export function skirtRun(b: Bld, kit: Kit, o: SkirtOpts): void {
  const { x0, x1, yTop, h, z, side, n, thick } = o;
  const pl = (x1 - x0) / n, gap = Math.min(pl * 0.06, thick * 1.2);
  const lean = o.lean ?? 0.06;
  // rail (dark) along the top: the panels hang off it
  b.g(bevBox(x1 - x0, thick * 1.6, thick * 1.4, thick * 0.3), kit.mech, new THREE.Matrix4().makeTranslation((x0 + x1) / 2, yTop - thick * 0.8, z - side * thick * 0.3));
  for (let i = 0; i < n; i++) {
    const cx = x0 + pl * (i + 0.5);
    // front panel angled up at the nose (sloped leading edge)
    const first = i === n - 1;
    const poly: P2[] = first ? [[-pl / 2 + gap / 2, -h / 2], [pl / 2 - gap / 2 - h * 0.35, -h / 2], [pl / 2 - gap / 2, h / 2], [-pl / 2 + gap / 2, h / 2]] : rectP(pl - gap, h);
    // frame: +y = outward (side), +x = along x, local z = x cross y -> for side +1 (n=+z) local z = -y(world)
    // local z = -side * world y, so flip the outline; lean = rotate about local x so the bottom kicks out a little
    const F = frame([cx, yTop - h / 2 - thick, z], [0, 0, side], [1, 0, 0]).multiply(new THREE.Matrix4().makeRotationX(-side * lean));
    const polyW = poly.map(([x, zz]) => [x, -side * zz] as P2);
    armorPlate(b, kit, o.mat ?? kit.armor2, F, polyW, thick, { standoff: thick * 0.2, gap: thick * 1.2, bev: thick * 0.25 });
    if (o.fine) for (const dx of [-0.32, 0.32]) b.g(new THREE.BoxGeometry(thick * 1.1, thick * 1.1, thick * 0.8), kit.joint, new THREE.Matrix4().makeTranslation(cx + dx * pl, yTop - thick * 2.6, z + side * thick * 1.45));
  }
  // rubber mud flap strip under the panels
  b.g(new THREE.BoxGeometry(x1 - x0 - gap, h * 0.14, thick * 0.6), kit.rubber, new THREE.Matrix4().makeTranslation((x0 + x1) / 2, yTop - h - thick - h * 0.06, z + side * thick * 0.6));
}

// ---- mechanisms ------------------------------------------------------------------------------------------------------------
/** Hydraulic piston from a to c: fat cylinder body (joint), thin bright rod (steel), clevis eye + pin at each end.
 *  ext = fraction of the length that is cylinder body. */
export function piston(b: Bld, kit: Kit, a: V3, c: V3, r: number, ext = 0.55, fine = true): void {
  const m = lerp3(a, c, ext);
  b.g(strutGeo(lerp3(a, c, 0.06), m, r, r * 1.12, 7), kit.joint);
  b.g(strutGeo(m, lerp3(a, c, 0.94), r * 0.45, r * 0.45, 5), kit.steel);
  if (fine) for (const p of [a, c]) clevis(b, kit, p, c[0] - a[0], c[1] - a[1], c[2] - a[2], r);
}
/** clevis eye + pin: a small fork block with a pin across it (axis perpendicular to the piston and to world up if possible) */
export function clevis(b: Bld, kit: Kit, p: V3, dx: number, dy: number, dz: number, r: number): void {
  const d = new THREE.Vector3(dx, dy, dz).normalize();
  let ax = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0));
  if (ax.lengthSq() < 1e-4) ax = new THREE.Vector3(1, 0, 0);
  ax.normalize();
  const m = new THREE.Matrix4().makeBasis(ax, new THREE.Vector3().crossVectors(d, ax), d).setPosition(p[0], p[1], p[2]);
  b.g(new THREE.BoxGeometry(r * 2.2, r * 1.5, r * 1.6), kit.mech, m);
  b.g(new THREE.CylinderGeometry(r * 0.55, r * 0.55, r * 2.8, 5, 1, true).rotateZ(Math.PI / 2), kit.steel, m);
}
/** Sagging hose from a to c (rubber), seg segments, sag below the chord. */
export function hose(b: Bld, kit: Kit, a: V3, c: V3, r: number, sag = 0.15, seg = 4, mat: MatLike = kit.rubber): void {
  const len = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  let prev = a;
  for (let i = 1; i <= seg; i++) {
    const t = i / seg;
    const p = lerp3(a, c, t);
    p[1] -= Math.sin(t * Math.PI) * sag * len;
    b.g(strutGeo(prev, p, r, r, 4), mat);
    prev = p;
  }
}
/** 2-3 parallel hoses (cable bundle) from a to c, spread across `across` */
export function cableBundle(b: Bld, kit: Kit, a: V3, c: V3, r: number, across: V3, n = 3, sag = 0.12): void {
  for (let i = 0; i < n; i++) {
    const f = (i - (n - 1) / 2) * r * 2.4;
    hose(b, kit, add(a, across, f), add(c, across, f * 0.7), r, sag * (1 + i * 0.25), 4, i === 1 ? kit.joint : kit.rubber);
  }
}
/** Exposed mech joint: dark clevis yoke with a fat drum (actuator housing), pin caps on both sides. axis = 'x'|'z'. */
export function jointDrum(b: Bld, kit: Kit, p: V3, r: number, wdt: number, axis: 'x' | 'z' = 'z'): void {
  const ax = axis === 'z' ? 'z' : 'x';
  const o: V3 = axis === 'z' ? [p[0], p[1], p[2] - wdt / 2] : [p[0] - wdt / 2, p[1], p[2]];
  b.cylb(kit.joint, r, wdt, r * 0.12, o, ax, 10);
  for (const s of [-1, 1]) {
    const q: V3 = axis === 'z' ? [p[0], p[1], p[2] + s * wdt / 2] : [p[0] + s * wdt / 2, p[1], p[2]];
    // pin cap: a stepped boss (one lathe: armoured ring, then the steel pin end)
    b.lathe(kit.mech, [[0, 0], [r * 0.62, 0], [r * 0.5, r * 0.18], [r * 0.24, r * 0.18], [0, r * 0.26]], q, (axis === 'z' ? (s > 0 ? 'z' : '-z') : (s > 0 ? 'x' : '-x')), 7);
  }
}
/** Frame limb: a dark twin-strut structural member from a to c (the skeleton an armour shell bolts onto). */
export function frameLimb(b: Bld, kit: Kit, a: V3, c: V3, r: number, spread: V3): void {
  for (const s of [-1, 1]) b.g(strutGeo(add(a, spread, s), add(c, spread, s * 0.8), r, r * 0.85, 6), kit.mech);
  // cross ties
  for (const t of [0.3, 0.7]) b.g(strutGeo(add(lerp3(a, c, t), spread, -0.9), add(lerp3(a, c, t), spread, 0.9), r * 0.5, r * 0.5, 4), kit.joint);
}

// ---- crew / function parts -----------------------------------------------------------------------------------------------
/** Smoke-grenade launcher bank: bracket + n tubes fanned in an arc, angled up, firing along F's +x. */
export function smokeLaunchers(b: Bld, kit: Kit, F: Frame, n: number, r: number): void {
  b.g(bevBox(r * 3, r * 1.6, r * 2.6 * n * 0.8, r * 0.3), kit.mech, sub(F, -r * 0.4, r * 0.8, 0));
  for (let i = 0; i < n; i++) {
    const f = (i - (n - 1) / 2);
    const T = sub(F, r * 0.4, r * 1.7, f * r * 2.15, 0, -f * 0.12, 0.45);
    b.g(new THREE.CylinderGeometry(r, r * 0.92, r * 3.2, 8).rotateZ(-Math.PI / 2), kit.armor2, T);
    b.g(new THREE.CylinderGeometry(r * 0.72, r * 0.72, r * 0.2, 8).rotateZ(-Math.PI / 2), kit.mech, sub(T, r * 1.62, 0, 0));
  }
}
/** Ring of vision blocks (periscope glass) on a cupola ring of radius R at height y about (x, z). */
export function visionBlocks(b: Bld, kit: Kit, x: number, y: number, z: number, R: number, n: number, s: number, fine = true): void {
  if (!fine) { b.lathe(kit.glass, [[R * 0.98, 0], [R * 1.04, 0], [R * 1.04, s * 0.8], [R * 0.98, s * 0.8]], [x, y, z], 'y', 10); return; }
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const m = new THREE.Matrix4().makeRotationY(-a).setPosition(x + Math.cos(a) * R, y + s * 0.4, z + Math.sin(a) * R);
    b.g(new THREE.BoxGeometry(s * 0.7, s * 0.85, s * 1.3), kit.mech, m);
    b.g(new THREE.BoxGeometry(s * 0.2, s * 0.5, s * 1.0), kit.glass, m.clone().multiply(new THREE.Matrix4().makeTranslation(s * 0.32, 0, 0)));
  }
}
/** Commander's cupola: armoured ring, vision blocks, a hatch lid swung open, and a pintle MG. Returns the top height. */
export function cupola(b: Bld, kit: Kit, x: number, y: number, z: number, r: number, o: { fine?: boolean; mg?: boolean; yaw?: number; mat?: MatLike } = {}): number {
  const fine = o.fine ?? true, yaw = o.yaw ?? 0;
  b.lathe(o.mat ?? kit.armor, [[0, 0], [r * 1.12, 0], [r * 1.1, r * 0.35], [r * 0.98, r * 0.52], [0, r * 0.52]], [x, y, z], 'y', 12);
  visionBlocks(b, kit, x, y + r * 0.08, z, r * 0.98, 6, r * 0.24, fine);
  const top = y + r * 0.52;
  b.lathe(kit.armor2, [[0, 0], [r * 0.78, 0], [r * 0.74, r * 0.08], [0, r * 0.12]], [x, top, z], 'y', 10);
  // open hatch lid, hinged at the rear
  const hx = x - Math.cos(yaw) * r * 0.7, hz = z + Math.sin(yaw) * r * 0.7;
  b.g(slabGeo(rectP(r * 0.9, r * 1.0, r * 0.2), r * 0.1, r * 0.03), kit.armor2, new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationZ(1.35)).setPosition(hx, top + r * 0.04, hz));
  if (o.mg !== false) {
    const mx = x + Math.cos(yaw) * r * 0.4, mz = z - Math.sin(yaw) * r * 0.4;
    b.g(new THREE.BoxGeometry(r * 0.22, r * 0.5, r * 0.22), kit.mech, new THREE.Matrix4().makeTranslation(mx, top + r * 0.25, mz));
    b.g(new THREE.BoxGeometry(r * 0.55, r * 0.2, r * 0.18), kit.joint, new THREE.Matrix4().makeRotationY(yaw).setPosition(mx, top + r * 0.52, mz));
    b.g(new THREE.CylinderGeometry(r * 0.045, r * 0.045, r * 1.2, 5).rotateZ(-Math.PI / 2), kit.joint, new THREE.Matrix4().makeRotationY(yaw).setPosition(mx + Math.cos(yaw) * r * 0.8, top + r * 0.56, mz - Math.sin(yaw) * r * 0.8));
  }
  return top + r * 0.12;
}
/** Flush crew hatch with hinge and grab handle (scale cue: a person fits through it). */
export function crewHatch(b: Bld, kit: Kit, F: Frame, r: number, fine = true): void {
  b.g(new THREE.CylinderGeometry(r * 1.15, r * 1.2, r * 0.16, 10), kit.mech, sub(F, 0, r * 0.08, 0));
  b.g(new THREE.CylinderGeometry(r * 0.95, r, r * 0.2, 10), kit.armor2, sub(F, 0, r * 0.18, 0));
  if (fine) {
    b.g(new THREE.BoxGeometry(r * 0.25, r * 0.22, r * 0.9), kit.joint, sub(F, -r * 1.0, r * 0.2, 0));
    b.g(new THREE.BoxGeometry(r * 0.12, r * 0.12, r * 0.6), kit.steel, sub(F, r * 0.45, r * 0.33, 0));
  }
}
/** Open-frame stowage basket (bustle rack) of w (x) x d (z) x h on F, with a tarp roll and a crate in it. */
export function bustleRack(b: Bld, kit: Kit, F: Frame, w: number, d: number, h: number, fine = true): void {
  const r = Math.min(w, d) * 0.03;
  for (const sz of [-1, 1]) for (const yy of fine ? [h * 0.5, h] : [h]) b.g(new THREE.BoxGeometry(w, r * 1.4, r * 1.4), kit.joint, sub(F, 0, yy, sz * d / 2));
  for (const sx of [-1, 1]) b.g(new THREE.BoxGeometry(r * 1.4, r * 1.4, d), kit.joint, sub(F, sx * w / 2, h, 0));
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) b.g(new THREE.BoxGeometry(r * 1.4, h, r * 1.4), kit.joint, sub(F, sx * w / 2, h / 2, sz * d / 2));
  b.g(new THREE.BoxGeometry(w * 0.96, r * 0.8, d * 0.96), kit.mech, sub(F, 0, r * 0.4, 0));
  // contents: rolled tarp (canvas) + crate
  b.g(new THREE.CylinderGeometry(h * 0.42, h * 0.42, d * 0.8, 8).rotateX(Math.PI / 2), kit.canvas, sub(F, -w * 0.22, h * 0.45, 0));
  b.g(bevBox(w * 0.36, h * 0.7, d * 0.5, h * 0.05), kit.armor2, sub(F, w * 0.24, h * 0.36, -d * 0.12));
}
/** Pair of tow hooks + shackle on a (rear) plate frame F (+y out of the plate, +x along it). */
export function towHooks(b: Bld, kit: Kit, F: Frame, spacing: number, s: number): void {
  for (const sx of [-1, 1]) {
    b.g(new THREE.BoxGeometry(s * 1.4, s * 0.9, s * 1.6), kit.mech, sub(F, sx * spacing / 2, s * 0.45, 0));
    b.g(new THREE.TorusGeometry(s * 0.55, s * 0.18, 4, 8), kit.joint, sub(F, sx * spacing / 2, s * 1.2, 0, Math.PI / 2, 0, 0));
  }
}
/** Handrail along points (already offset above the surface), posts dropping `postH` at every point. */
export function handrail(b: Bld, kit: Kit, pts: V3[], r: number, postH: number, mat?: MatLike): void {
  for (let i = 0; i < pts.length - 1; i++) b.g(strutGeo(pts[i], pts[i + 1], r, r, 4), mat ?? kit.steel);
  for (const p of pts) b.g(new THREE.BoxGeometry(r * 1.6, postH, r * 1.6), mat ?? kit.joint, new THREE.Matrix4().makeTranslation(p[0], p[1] - postH / 2, p[2]));
}
/** Ladder from a (bottom) to c (top), w wide across `across`, standing off the wall by `off` along `out`. */
export function ladder(b: Bld, kit: Kit, a: V3, c: V3, w: number, across: V3, out: V3, off = w * 0.15): void {
  const r = w * 0.07;
  const A = add(a, out, off), C = add(c, out, off);
  for (const s of [-1, 1]) b.g(strutGeo(add(A, across, s * w / 2), add(C, across, s * w / 2), r, r, 4), kit.joint);
  const len = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const n = Math.max(2, Math.round(len / (w * 0.45)));
  for (let i = 1; i < n; i++) { const p = lerp3(A, C, i / n); b.g(strutGeo(add(p, across, -w / 2), add(p, across, w / 2), r * 0.7, r * 0.7, 4), kit.steel); }
  for (const p of [A, C]) b.g(strutGeo(p, add(p, out, -off), r * 0.8, r * 0.8, 4), kit.joint);
}
/** Headlamp / searchlight in a wire cage (human-scale cue), lens facing F's +x. */
export function cagedLamp(b: Bld, kit: Kit, F: Frame, s: number, fine = true): void {
  b.g(new THREE.CylinderGeometry(s * 0.5, s * 0.42, s * 0.9, 8).rotateZ(-Math.PI / 2), kit.mech, sub(F, 0, s * 0.55, 0));
  b.g(new THREE.CylinderGeometry(s * 0.4, s * 0.4, s * 0.08, 8).rotateZ(-Math.PI / 2), kit.lamp, sub(F, s * 0.46, s * 0.55, 0));
  b.g(new THREE.BoxGeometry(s * 0.3, s * 0.2, s * 0.3), kit.mech, sub(F, -s * 0.1, s * 0.05, 0));
  if (fine) {
    // wire cage: three bars across the lens, two hoops over it
    for (const a of [-0.28, 0, 0.28]) b.g(new THREE.BoxGeometry(s * 0.05, s * 0.05, s * 0.95), kit.joint, sub(F, s * 0.62, s * 0.55 + a * s, 0));
    for (const zz of [-0.45, 0.45]) b.g(new THREE.BoxGeometry(s * 0.7, s * 0.95, s * 0.05), kit.joint, sub(F, s * 0.3, s * 0.55, zz * s));
  }
}
/** Jerry cans in a rack (n side by side along F's +z), standing on F. */
export function jerryCans(b: Bld, kit: Kit, F: Frame, n: number, s: number): void {
  for (let i = 0; i < n; i++) {
    const zz = (i - (n - 1) / 2) * s * 0.62;
    b.g(bevBox(s * 0.9, s * 1.2, s * 0.5, s * 0.08), kit.canvas, sub(F, 0, s * 0.6, zz));
    b.g(new THREE.BoxGeometry(s * 0.3, s * 0.14, s * 0.2), kit.mech, sub(F, s * 0.2, s * 1.25, zz));
  }
  b.g(new THREE.BoxGeometry(s * 1.0, s * 0.08, s * 0.62 * n), kit.joint, sub(F, 0, s * 0.8, 0));
}
/** Stowage box (tool / ammo bin) with lid line and latch. */
export function stowBox(b: Bld, kit: Kit, F: Frame, w: number, h: number, d: number, mat?: MatLike): void {
  b.g(bevBox(w, h, d, Math.min(w, h, d) * 0.12), mat ?? kit.armor2, sub(F, 0, h / 2, 0));
  b.g(new THREE.BoxGeometry(w * 1.02, h * 0.1, d * 1.02), kit.mech, sub(F, 0, h * 0.78, 0));
  b.g(new THREE.BoxGeometry(w * 0.12, h * 0.25, d * 0.08), kit.steel, sub(F, 0, h * 0.62, d / 2));
}
/** Spare track links clipped to a plate: n link shoes along F's +x. */
export function spareTrack(b: Bld, kit: Kit, F: Frame, n: number, w: number, pitch: number): void {
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * pitch;
    b.g(bevBox(pitch * 0.82, pitch * 0.22, w, pitch * 0.06), kit.joint, sub(F, x, pitch * 0.11, 0));
    b.g(new THREE.BoxGeometry(pitch * 0.25, pitch * 0.3, w * 0.2), kit.mech, sub(F, x, pitch * 0.3, 0));
  }
  b.g(new THREE.BoxGeometry(pitch * n, pitch * 0.12, w * 0.12), kit.steel, sub(F, 0, pitch * 0.34, w * 0.3));
}
/** ERA brick grid on a plate frame: rows x cols tiles of cw x cd, thickness t. */
export function eraGrid(b: Bld, kit: Kit, F: Frame, rows: number, cols: number, cw: number, cd: number, t: number, mat?: MatLike): void {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    b.g(bevBox(cw * 0.9, t, cd * 0.88, t * 0.25), mat ?? kit.armor2, sub(F, (c - (cols - 1) / 2) * cw, t / 2, (r - (rows - 1) / 2) * cd));
  }
}
/** Bolt row (tiny boxes) along F's x from x0 to x1 at local z. Only for `fine` units. */
export function boltRow(b: Bld, kit: Kit, F: Frame, x0: number, x1: number, z: number, n: number, s: number, y = 0): void {
  for (let i = 0; i < n; i++) b.g(new THREE.BoxGeometry(s, s * 0.6, s), kit.joint, sub(F, x0 + ((x1 - x0) * i) / Math.max(1, n - 1), y + s * 0.3, z));
}
/** Exhaust: muffler box with heat shield slats and an outlet pipe ending in a hot mouth, outlet pointing along F's +x. */
export function exhaustBox(b: Bld, kit: Kit, F: Frame, s: number, fine = true): void {
  b.g(bevBox(s * 2.4, s * 1.2, s * 1.3, s * 0.12), kit.joint, sub(F, 0, s * 0.6, 0));
  if (fine) for (let i = 0; i < 4; i++) b.g(new THREE.BoxGeometry(s * 0.14, s * 0.1, s * 1.4), kit.mech, sub(F, (i - 1.5) * s * 0.5, s * 1.24, 0));
  b.g(new THREE.CylinderGeometry(s * 0.34, s * 0.34, s * 0.9, 8).rotateZ(-Math.PI / 2), kit.joint, sub(F, s * 1.5, s * 0.6, 0));
  b.g(new THREE.CylinderGeometry(s * 0.26, s * 0.26, s * 0.05, 8).rotateZ(-Math.PI / 2), kit.hot, sub(F, s * 1.96, s * 0.6, 0));
}
/** Whip antenna on an armoured base (thin and long: a scale cue). */
export function antenna(b: Bld, kit: Kit, x: number, y: number, z: number, h: number, r: number, lean: V3 = [0, 0, 0]): void {
  b.cylb(kit.mech, r * 3, r * 3, r, [x, y, z], 'y', 6);
  b.g(strutGeo([x, y, z], [x + lean[0] * h, y + h, z + lean[2] * h], r, r * 0.4, 4), kit.steel);
}

// ---- slot dressing ---------------------------------------------------------------------------------------------------------
/** Named functional slots on a hull (hull-local points on the surface; any may be omitted). Builders that do not
 *  hand-place the kit pass their slots to dressHull, which places the functional parts by role. */
export interface HullSlots {
  /** nose corners on the deck edge (left z<0, right z>0): smoke-grenade banks + caged headlamps */
  noseL?: V3; noseR?: V3;
  /** rear plate: centre point, outward normal (default -x), half width */
  rear?: { p: V3; n?: V3; hw: number };
  /** rear deck corners: exhaust on the right, jerry cans + antenna on the left (asymmetric) */
  deckRearL?: V3; deckRearR?: V3;
  /** deck-edge runs (from, to) on each flank: tool bins on the right, spare track on the left */
  flankL?: [V3, V3]; flankR?: [V3, V3];
  /** a hatch spot (offset to one side) */
  hatch?: V3;
}
export interface DressOpts {
  /** size unit (cells): part scale */
  k: number;
  fine: boolean;
  /** 'mbt' smoke + lamps + stowage; 'support' antennas + lamps; 'artillery' stowage + no smoke */
  role?: 'mbt' | 'support' | 'artillery';
  /** skip parts: 'smoke', 'lamps', 'exhaust', 'cans', 'antenna', 'tow', 'bins', 'track', 'hatch' */
  skip?: string[];
}
/** Place the functional kit into a hull's named slots (no random scatter; one-sided parts give the asymmetry). */
export function dressHull(b: Bld, kit: Kit, sl: HullSlots, o: DressOpts): void {
  const { k, fine } = o, role = o.role ?? 'mbt', no = (s: string) => !!o.skip?.includes(s);
  for (const [p, s] of [[sl.noseL, -1], [sl.noseR, 1]] as [V3 | undefined, number][]) {
    if (!p) continue;
    if (role === 'mbt' && !no('smoke')) smokeLaunchers(b, kit, frame(p, [0, 1, 0], [Math.cos(0.5), 0, s * Math.sin(0.5)]), 3, 0.026 * k);
    if (!no('lamps')) cagedLamp(b, kit, frame([p[0] + 0.06 * k, p[1], p[2] - s * 0.12 * k], [0, 1, 0], [1, 0, 0]), 0.065 * k, fine);
  }
  if (sl.rear && !no('tow')) towHooks(b, kit, frame(sl.rear.p, sl.rear.n ?? [-1, 0, 0], [0, 0, 1]), sl.rear.hw * 1.6, 0.04 * k);
  if (sl.deckRearR && !no('exhaust')) exhaustBox(b, kit, frame(sl.deckRearR, [0, 1, 0], [0, 0, 1]), 0.05 * k, fine);
  if (sl.deckRearL) {
    const p = sl.deckRearL;
    if (!no('cans')) jerryCans(b, kit, frame(p, [0, 1, 0]), 2, 0.08 * k);
    if (!no('antenna')) antenna(b, kit, p[0] + 0.14 * k, p[1], p[2] + 0.04 * k, (role === 'support' ? 0.9 : 0.6) * k, 0.008 * k, [-0.15, 0, 0]);
  }
  if (role === 'support' && sl.deckRearR && !no('antenna')) antenna(b, kit, sl.deckRearR[0] + 0.2 * k, sl.deckRearR[1], sl.deckRearR[2], 0.7 * k, 0.008 * k, [-0.1, 0, 0.05]);
  if (sl.flankR && !no('bins')) {
    const [a, e] = sl.flankR, len = Math.hypot(e[0] - a[0], e[2] - a[2]);
    stowBox(b, kit, frame(lerp3(a, e, 0.5), [0, 1, 0], [e[0] - a[0], 0, e[2] - a[2]]), len * 0.9, 0.07 * k, 0.1 * k, role === 'artillery' ? kit.canvas : undefined);
  }
  if (sl.flankL && !no('track') && role !== 'support') {
    const [a, e] = sl.flankL;
    spareTrack(b, kit, frame(lerp3(a, e, 0.5), [0, 1, 0], [e[0] - a[0], 0, e[2] - a[2]]), 3, 0.18 * k, 0.065 * k);
  }
  if (sl.hatch && !no('hatch')) crewHatch(b, kit, frame(sl.hatch, [0, 1, 0]), 0.07 * k, fine);
}

/** What autoDress needs from a chassis build (a subset of ChassisCtx). */
export interface DressCtx { b: Bld; kit: Kit; L: number; W: number; S: number; mounts: { x: number; z: number; r: number }[] }
/** Find a hull's functional slots by probing its deck query (nose / rear corners, flank runs, a hatch spot), keeping
 *  clear of every turret ring, then dress them by role (dressHull). For hulls not yet hand-dressed with the kit. */
export function autoDress(c: DressCtx, deckAt: (x: number, z: number) => number, o: Omit<DressOpts, 'k' | 'fine'> & { k?: number; inset?: number } = {}): HullSlots {
  const k = o.k ?? Math.min(c.L, c.W) / 2, L = c.L, W = c.W, ins = o.inset ?? 0.07 * k;
  const clear = (x: number, z: number, m = 0.14 * k) => c.mounts.every((q) => Math.hypot(q.x - x, q.z - z) > q.r * 1.5 + m);
  const on = (x: number, z: number) => deckAt(x, z) > 0;
  const step = Math.min(L, W) / 48;
  const scanX = (z: number, from: number, dir: number): number | null => {
    for (let x = from; Math.abs(x) <= L * 0.6; x += dir * step) if (on(x, z)) return x;
    return null;
  };
  const edgeZ = (x: number, s: number): number | null => {
    let last: number | null = null;
    for (let z = 0; z <= W * 0.6; z += step) { if (on(x, s * z)) last = z; else if (last !== null) break; }
    return last;
  };
  const pt = (x: number, z: number): V3 => [x, deckAt(x, z), z];
  const sl: HullSlots = {};
  // nose corners: the frontmost deck point on lines 30-40% of the half width out, nudged inboard
  for (const s of [-1, 1]) {
    const ez = edgeZ(0, s);
    if (ez === null) continue;
    const z = s * Math.max(0.12 * k, ez * 0.66);
    const xf = scanX(z, L * 0.6, -1), xr = scanX(z, -L * 0.6, 1);
    if (xf !== null && clear(xf - ins, z)) (s < 0 ? (sl.noseL = pt(xf - ins, z)) : (sl.noseR = pt(xf - ins, z)));
    if (xr !== null && clear(xr + ins * 1.6, z)) (s < 0 ? (sl.deckRearL = pt(xr + ins * 1.6, z)) : (sl.deckRearR = pt(xr + ins * 1.6, z)));
    // flank run along the deck edge: the longest clear stretch in the middle third
    const fz = (edgeZ(-L * 0.1, s) ?? ez) - 0.08 * k;
    const a: number[] = [];
    for (let x = -L * 0.32; x <= L * 0.16; x += step) if (on(x, s * fz) && clear(x, s * fz, 0.1 * k)) a.push(x);
    if (a.length > 6) {
      // longest contiguous run
      let best: [number, number] = [a[0], a[0]], cur: [number, number] = [a[0], a[0]];
      for (let i = 1; i < a.length; i++) { if (a[i] - a[i - 1] <= step * 1.5) cur[1] = a[i]; else cur = [a[i], a[i]]; if (cur[1] - cur[0] > best[1] - best[0]) best = [...cur]; }
      if (best[1] - best[0] > 0.22 * k) {
        const run: [V3, V3] = [pt(best[0] + 0.03 * k, s * fz), pt(best[1] - 0.03 * k, s * fz)];
        if (Math.abs(run[0][1] - run[1][1]) < 0.03 * k) (s < 0 ? (sl.flankL = run) : (sl.flankR = run));
      }
    }
  }
  dressHull(c.b, c.kit, sl, { k, fine: fineFor(c.S), role: o.role, skip: [...(o.skip ?? []), 'tow'] });
  return sl;
}

/** hull shapes dressed automatically by units3d (autoDress), by role; hand-dressed hulls (warden, strider, monolith)
 *  are not listed */
export const AUTO_DRESS: Record<string, { role?: DressOpts['role']; skip?: string[] }> = {
  fortress: {}, titan: {}, juggernaut: { skip: ['smoke'] }, siegeplat: { role: 'artillery' }, long: { role: 'artillery', skip: ['lamps'] },
  cross: {}, riot: {}, hunter: { skip: ['cans'] }, round: { role: 'support' },
  crab: {}, scorpion: {}, centipede: { skip: ['smoke'] }, goliath: {}, leviathan: {},
};
