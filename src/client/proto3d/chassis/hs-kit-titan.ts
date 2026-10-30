// Titan-scale hard-surface kit: the parts the titan hulls (titans*.ts) share on top of chassis/hs-kit.ts.
//
// At titan scale a wall is a building facade, so the parts are about construction and crew access:
//   * wall dressing by ARC (armourWalls): every wall face of a planLoft gets thick appliqué plates on shadow gaps;
//     the front arc gets two-deep plate stacks with an ERA brick grid, the rear arc recessed louvre grilles and
//     an exhaust slit, the flanks single plates (alternating paint roles) with vision slits on forward faces
//   * faceted barbettes / towers (octBarbette, octTower): 8-sided planLoft drums with plates on every face, a dark
//     ring band and bolt ring; no round lathed drums on the big masses
//   * crew scale: railed walkways round a deck edge broken where something stands (railLoop), searchlights on
//     yoke posts, lattice sensor masts with a radar bar, faceted exhaust stacks with clamp bands
//   * machinery: coolant pipe runs (titan-greebles pipeRun), cable bundles and pistons (hs-kit)
// Everything writes into the unit's Bld (merged per material): triangles, never draw calls.

import * as THREE from 'three';
import type { Bld, MatLike, P2, V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { armorPlate, cagedLamp, eraGrid, frame, handrail, inset, plateStack, recessPanel, rectP } from './hs-kit.ts';
import { faceBox, faceFrame, faceSlit, wallFace, type Face } from './titan-greebles.ts';
import { beam } from './shapes.ts';
import type { Lift } from '../mobility/air.ts';

/** regular n-gon plan (local copy so the titans do not depend on the giants kit for it) */
export function ngonT(n: number, rx: number, rz: number, a0 = Math.PI / n): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) { const a = a0 + (i / n) * Math.PI * 2; out.push([Math.cos(a) * rx, Math.sin(a) * rz]); }
  return out;
}
/** loft a plan polygon through levels [y, scale, dx?, dz?] (scale about the polygon origin), offset to `at` */
export function planLoftT(b: Bld, mat: MatLike, poly: P2[], levels: [number, number, number?, number?][], at: [number, number] = [0, 0]): void {
  b.loft(mat, levels.map(([y, s, dx = 0, dz = 0]) => poly.map(([px, pz]) => [at[0] + dx + px * s, y, at[1] + dz + pz * s] as V3)));
}

/** hard-surface plate on a wall face (face coordinates: du along the edge, dv up the slope) */
export const facePlateHS = (b: Bld, kit: Kit, f: Face, du: number, dv: number, w: number, d: number, t: number, mat: MatLike, so = t * 0.45): number =>
  armorPlate(b, kit, mat, faceFrame(f, du, dv, 0), rectP(w, d, Math.min(w, d) * 0.08), t, { standoff: so, gap: t * 1.1 });
/** recessed louvre grille on a wall face */
export const faceGrille = (b: Bld, kit: Kit, f: Face, du: number, dv: number, w: number, d: number, n: number): void =>
  recessPanel(b, kit, faceFrame(f, du, dv, 0), w, d, Math.min(w, d) * 0.12, { slats: n });

export interface WallOpts {
  /** plan offset of the loft */
  at?: [number, number];
  /** plate thickness unit */
  u: number;
  /** target plate pitch along a face */
  pitch: number;
  /** min face width that gets dressed */
  minW?: number;
  /** n.x above this = front arc (stacks + ERA); default 0.8 */
  front?: number;
  /** n.x below this = rear arc (grilles); default -0.85 */
  rear?: number;
  /** ERA bricks on the front arc (default true) */
  era?: boolean;
  /** vision slits on forward-facing faces (n.x > 0.3) */
  slits?: boolean;
  /** rear arc: grilles (default) or plain plates */
  rearGrille?: boolean;
  /** plate height as a fraction of the face height (default 0.66) */
  fill?: number;
  /** skip a plate whose centre (hull space) is here */
  skip?: (p: V3, f: Face) => boolean;
  /** paint roles to alternate on flank plates */
  mats?: MatLike[];
}
/** Dress every wall face of planLoft(poly, ...) between levels lo and hi by arc. Returns the faces. */
export function armourWalls(b: Bld, kit: Kit, poly: P2[], lo: [number, number], hi: [number, number], o: WallOpts): Face[] {
  const faces: Face[] = [];
  const u = o.u, fill = o.fill ?? 0.66, fr = o.front ?? 0.8, rr = o.rear ?? -0.85;
  const mats = o.mats ?? [kit.armor2, kit.shell];
  for (let i = 0; i < poly.length; i++) {
    const f = wallFace(poly, i, lo, hi, o.at);
    faces.push(f);
    if (f.w < (o.minW ?? 0.5 * o.pitch)) continue;
    const front = f.n.x > fr, rear = f.n.x < rr;
    const n = Math.max(1, Math.round(f.w / o.pitch));
    if (rear && o.rearGrille !== false) {
      faceGrille(b, kit, f, 0, f.h * 0.02, f.w * 0.62, f.h * 0.55, Math.max(3, Math.round(f.h / (u * 3))));
      faceSlit(b, kit, f, 0, -f.h * 0.38, f.w * 0.46, u * 0.45, kit.hot);
      continue;
    }
    for (let j = 0; j < n; j++) {
      const du = (j + 0.5 - n / 2) * (f.w / n), pw = (f.w / n) * 0.86 - u * 0.4;
      const c = f.c.clone().addScaledVector(f.u, du);
      if (o.skip?.([c.x, c.y, c.z], f)) continue;
      if (front) {
        const top = plateStack(b, kit, kit.armor, faceFrame(f, du, -f.h * 0.04, 0), rectP(pw, f.h * (fill + 0.06), u), [
          { inset: 0, thick: u * 1.2, standoff: u * 0.5 }, { inset: u * 1.4, thick: u * 0.9, mat: kit.armor2 },
        ], { gap: u * 1.2 });
        if (o.era !== false) {
          const cols = Math.max(2, Math.round(pw / (u * 4.2))), rows = Math.max(2, Math.round(f.h * fill / (u * 4.6)));
          eraGrid(b, kit, faceFrame(f, du, -f.h * 0.04, top), rows, cols, (pw - u * 3) / cols, (f.h * fill - u * 3) / rows, u * 0.55, kit.armor2);
        }
      } else facePlateHS(b, kit, f, du, -f.h * 0.04, pw, f.h * fill, u * 1.05, mats[(i + j) % mats.length]);
      if (o.slits && f.n.x > 0.3 && !front) faceSlit(b, kit, f, du, f.h * 0.4, pw * 0.45, u * 0.4);
    }
  }
  return faces;
}

/** Faceted (8-sided) armoured barbette: battered skirt, plates on every face, dark ring band, bolts. Returns its top. */
export function octBarbette(b: Bld, kit: Kit, x: number, yb: number, z: number, R: number, h: number, o: { mat?: MatLike; plates?: boolean; n?: number; slits?: boolean } = {}): number {
  const n = o.n ?? 8, P = ngonT(n, R, R);
  const top = yb + h;
  planLoftT(b, o.mat ?? kit.armor, P, [[yb, 1.12], [yb + h * 0.22, 1.08], [top - h * 0.16, 1.0], [top, 0.93]], [x, z]);
  planLoftT(b, kit.mech, P, [[yb + h * 0.2, 1.1], [yb + h * 0.3, 1.1]], [x, z]);
  if (o.plates !== false) {
    const u = R * 0.05;
    for (let i = 0; i < n; i++) {
      const f = wallFace(P, i, [yb + h * 0.32, 1.06], [top - h * 0.16, 1.0], [x, z]);
      facePlateHS(b, kit, f, 0, 0, f.w * 0.78, f.h * 0.72, u, i % 2 ? kit.armor2 : kit.shell, u * 0.4);
      if (o.slits && f.n.x > 0.5) faceSlit(b, kit, f, 0, f.h * 0.42, f.w * 0.4, u * 0.6);
    }
  }
  return top;
}

/** Faceted tower: flared battered base, shaft, overhanging crown (8-sided), plates on the shaft. Returns the crown top. */
export function octTower(b: Bld, kit: Kit, x: number, yb: number, z: number, r: number, top: number, o: { slitsTo?: number; u: number; brackets?: boolean }): number {
  const h = top - yb, P = ngonT(8, r, r);
  const yS = yb + h * 0.24, yC = yb + h * 0.8;
  // battered base, shaft, corbel step, overhanging crown
  planLoftT(b, kit.armor, P, [[yb, 1.36], [yS, 1.12], [yS + h * 0.04, 0.98], [yC, 0.94], [yC + h * 0.02, 1.2], [top - h * 0.02, 1.2], [top, 1.14]], [x, z]);
  planLoftT(b, kit.mech, P, [[yS, 1.14], [yS + h * 0.035, 1.14]], [x, z]);
  planLoftT(b, kit.accent, P, [[top - h * 0.1, 1.215], [top - h * 0.065, 1.215]], [x, z]);
  const ao = o.slitsTo ?? Math.atan2(z, x);
  for (let i = 0; i < 8; i++) {
    const f = wallFace(P, i, [yS + h * 0.05, 0.98], [yC - h * 0.02, 0.94], [x, z]);
    const out = Math.cos(Math.atan2(f.n.z, f.n.x) - ao);
    facePlateHS(b, kit, f, 0, -f.h * 0.06, f.w * 0.76, f.h * 0.66, o.u, i % 2 ? kit.armor2 : kit.shell, o.u * 0.4);
    if (out > 0.3) faceSlit(b, kit, f, 0, f.h * 0.38, f.w * 0.34, o.u * 0.5);
    // machicolation brackets under the crown
    if (o.brackets !== false) {
      const g = wallFace(P, i, [yC - h * 0.05, 0.94], [yC + h * 0.02, 1.2], [x, z]);
      for (const e of [-0.32, 0.32]) faceBox(b, kit.mech, g, e * g.w, 0, g.w * 0.12, g.h * 0.9, o.u * 2.5);
    }
  }
  return top;
}

/** Railed walkway: a handrail following the (inset) deck edge at height y, broken wherever blocked(x, z). */
export function railLoop(b: Bld, kit: Kit, poly: P2[], y: number, step: number, blocked: (x: number, z: number) => boolean, r: number, postH: number, closed = true): void {
  let run: V3[] = [];
  const flush = () => { if (run.length > 1) handrail(b, kit, run, r, postH); run = []; };
  const n0 = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < n0; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
    for (let j = 0; j <= n; j++) {
      const x = ax + ((bx - ax) * j) / n, z = az + ((bz - az) * j) / n;
      if (blocked(x, z)) flush();
      else if (!run.length || Math.hypot(run[run.length - 1][0] - x, run[run.length - 1][2] - z) > 1e-4) run.push([x, y, z]);
    }
  }
  flush();
}

/** Searchlight on a short post with a yoke, lens facing yaw (0 = +x). */
export function searchlight(b: Bld, kit: Kit, x: number, y: number, z: number, yaw: number, s: number, fine = true): void {
  b.g(new THREE.BoxGeometry(s * 0.28, s * 0.9, s * 0.28), kit.mech, new THREE.Matrix4().makeTranslation(x, y + s * 0.45, z));
  const d: V3 = [Math.cos(yaw), 0, Math.sin(yaw)];
  cagedLamp(b, kit, frame([x, y + s * 0.62, z], [0, 1, 0], d), s, fine);
}

/** Lattice sensor mast: three legs with cross ties, a radar bar and a lamp at the top. */
export function latticeMast(b: Bld, kit: Kit, x: number, y: number, z: number, h: number, w: number, yaw = 0): number {
  const legs: V3[] = [0, 1, 2].map((i) => { const a = yaw + (i / 3) * Math.PI * 2; return [Math.cos(a) * w, 0, Math.sin(a) * w]; });
  const r = w * 0.09;
  for (const l of legs) b.strut(kit.joint, [x + l[0], y, z + l[2]], [x + l[0] * 0.35, y + h, z + l[2] * 0.35], r, r * 0.8, 4);
  for (const f of [0.3, 0.62]) {
    const s = 1 - f * 0.65;
    for (let i = 0; i < 3; i++) {
      const a = legs[i], c = legs[(i + 1) % 3];
      b.strut(kit.mech, [x + a[0] * s, y + h * f, z + a[2] * s], [x + c[0] * s, y + h * f, z + c[2] * s], r * 0.6, r * 0.6, 4);
    }
  }
  // radar bar + lamp
  b.g(new THREE.BoxGeometry(w * 0.3, w * 0.22, w * 2.6), kit.mech, new THREE.Matrix4().makeRotationY(-yaw).setPosition(x, y + h + w * 0.1, z));
  b.g(new THREE.BoxGeometry(w * 0.12, w * 0.16, w * 2.3), kit.shell, new THREE.Matrix4().makeRotationY(-yaw).setPosition(x + w * 0.16, y + h + w * 0.1, z));
  b.g(new THREE.BoxGeometry(w * 0.18, w * 0.18, w * 0.18), kit.lamp, new THREE.Matrix4().makeTranslation(x, y + h + w * 0.34, z));
  return y + h;
}

/** Faceted exhaust stack: 8-sided pipe with clamp bands, a heat-shield plate on one side and a hot mouth. */
export function octStack(b: Bld, kit: Kit, x: number, yb: number, z: number, r: number, h: number, shield: V3 = [1, 0, 0]): void {
  const P = ngonT(8, r, r);
  planLoftT(b, kit.joint, P, [[yb, 1.1], [yb + h * 0.08, 1.0], [yb + h, 1.0]], [x, z]);
  for (const f of [0.3, 0.58, 0.86]) planLoftT(b, kit.mech, P, [[yb + h * f, 1.16], [yb + h * f + r * 0.35, 1.16]], [x, z]);
  planLoftT(b, kit.mech, P, [[yb + h - r * 0.02, 1.14], [yb + h + r * 0.12, 1.14]], [x, z]);
  b.g(new THREE.CylinderGeometry(r * 0.78, r * 0.78, r * 0.06, 8), kit.hot, new THREE.Matrix4().makeTranslation(x, yb + h + r * 0.06, z));
  const n = new THREE.Vector3(...shield).normalize();
  armorPlate(b, kit, kit.armor2, frame([x + n.x * r * 1.05, yb + h * 0.55, z + n.z * r * 1.05], [n.x, 0, n.z], [0, 1, 0]), rectP(h * 0.6, r * 1.6, r * 0.2), r * 0.16, { standoff: r * 0.12, gap: r * 0.1 });
}

/** Ring of raised roof plates following a roof outline at height y (stepped inward), skipping blocked spots. */
export function roofPlates(b: Bld, kit: Kit, roof: P2[], y: number, k: number, blocked: (x: number, z: number) => boolean, pitch = 1.1 * k): void {
  const c = roof.reduce((a, p) => [a[0] + p[0] / roof.length, a[1] + p[1] / roof.length], [0, 0]);
  for (let i = 0; i < roof.length; i++) {
    const [ax, az] = roof[i], [bx, bz] = roof[(i + 1) % roof.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.6 * k) continue;
    const ang = Math.atan2(bz - az, bx - ax), nx = -Math.sin(ang), nz = Math.cos(ang);
    const n = Math.max(1, Math.round(len / pitch));
    for (let j = 0; j < n; j++) {
      const f = (j + 0.5) / n;
      let x = ax + (bx - ax) * f, z = az + (bz - az) * f;
      const sg = nx * (c[0] - x) + nz * (c[1] - z) > 0 ? 1 : -1;
      x += nx * sg * 0.3 * k; z += nz * sg * 0.3 * k;
      if (blocked(x, z)) continue;
      armorPlate(b, kit, j % 2 ? kit.armor2 : kit.armor, frame([x, y - 0.01, z], [0, 1, 0], [Math.cos(ang), 0, Math.sin(ang)]), rectP((len / n) * 0.84, 0.46 * k, 0.05 * k), 0.08 * k, { standoff: 0.035 * k, gap: 0.07 * k });
    }
  }
}

/** Upright parapet plate (crenel) standing on a deck edge at (x, y, z), facing outward along (nx, nz). */
export function parapet(b: Bld, kit: Kit, x: number, y: number, z: number, nx: number, nz: number, w: number, h: number, t: number, mat: MatLike): void {
  armorPlate(b, kit, mat, frame([x, y + h / 2, z], [nx, 0, nz], [0, 1, 0]), rectP(h, w, Math.min(w, h) * 0.12), t, { standoff: 0, back: null });
}

/** offset a polygon inward by d (convex or mildly concave plans) */
export const shrink = (p: P2[], d: number): P2[] => inset(p, d);

/** Faceted prism along x: n-sided sections at stations [x, ry, rz] centred on (y, z) = at (nacelles, coil hoops). */
export function xPrism(b: Bld, mat: MatLike, n: number, stations: [number, number, number][], at: [number, number], a0 = Math.PI / n): void {
  const P = ngonT(n, 1, 1, a0);
  b.loft(mat, stations.map(([x, ry, rz]) => P.map(([py, pz]) => [x, at[0] + py * ry, at[1] + pz * rz] as V3)));
}

/** Lift gear for a titan flown on grav lifters or jets (a ground titan hull lifted into the air, units3d liftedTitan):
 *  the hull keeps its anatomy and the lift hangs off its flanks where the RTS camera sees it. Grav lifters: four
 *  outrigger nacelles on the plan's diagonals (a deep armoured pylon from the hull wall to an octagonal cowl with a
 *  glow band, the big grav pod hanging in it). Jets: two heavy thruster cans on pylons astern plus two smaller grav
 *  pods forward holding the bow up. Builds the nacelles into b and returns the Lift list (ChassisOut.lift) for
 *  mobility/air.ts. Plan ellipse (cx, rx, rz) = the hull wall the pylons start from; y = pod centre height, yA = pylon
 *  root height on the hull wall, r = grav pod radius, front / rear = angles of the forward / aft pods off the bow (rad). */
export function titanLift(b: Bld, kit: Kit, mobId: string, o: { cx: number; rx: number; rz: number; y: number; yA: number; r: number; front?: number; rear?: number }): Lift[] {
  const { cx, rx, rz, y, yA, r } = o;
  const lift: Lift[] = [];
  const pod = (a: number, rr: number, s: 1 | -1) => {
    const ca = Math.cos(a), sa = Math.sin(a), h = rr * 0.8;
    const ex = cx + ca * (rx + rr * 0.95), ez = sa * (rz + rr * 0.95);
    const cowl = ngonT(8, rr * 1.16, rr * 1.16);
    // pylon: a deep armoured beam from inside the hull wall out to the cowl's top, a dark rib under it
    const root: V3 = [cx + ca * rx * 0.8, yA, sa * rz * 0.8], tip: V3 = [ex, y + h * 0.62, ez];
    beam(b, kit.armor2, root, tip, rr * 0.7, rr * 0.55);
    beam(b, kit.mech, [root[0], root[1] - rr * 0.3, root[2]], [tip[0], tip[1] - rr * 0.3, tip[2]], rr * 0.38, rr * 0.4);
    // cowl over the pod: dark lip the pod's shell sits in, plated octagonal hood, glow band
    planLoftT(b, kit.mech, cowl, [[y + h * 0.24, 0.98], [y + h * 0.34, 1.0]], [ex, ez]);
    planLoftT(b, kit.armor, cowl, [[y + h * 0.32, 1.02], [y + h * 0.62, 1.0], [y + h * 0.86, 0.72]], [ex, ez]);
    planLoftT(b, kit.glow, cowl, [[y + h * 0.42, 1.045], [y + h * 0.5, 1.045]], [ex, ez]);
    lift.push({ kind: 'grav', p: [ex, y, ez], r: rr, len: h, dir: s });
  };
  const front = o.front ?? 0.75;
  if (mobId === 'jet') {
    for (const s of [-1, 1] as const) {
      // heavy thruster can astern (nozzle exit at x, the can runs forward of it) on a pylon from the hull's rear quarter
      const jr = r * 0.62, len = jr * 2.4, jx = cx - rx * 1.06 - jr * 0.3, jz = s * rz * 0.5, jy = Math.max(y, yA - jr * 0.2);
      beam(b, kit.armor2, [jx + len * 0.9, yA + jr * 0.2, jz * 0.6], [jx + len * 0.55, jy + jr * 1.05, jz], jr * 1.2, jr * 0.5);
      lift.push({ kind: 'jet', p: [jx, jy, jz], r: jr, len });
      pod(s * front, r * 0.75, s);
    }
    return lift;
  }
  for (const s of [-1, 1] as const) for (const a of [front, o.rear ?? Math.PI - 0.8]) pod(s * a, r, s);
  return lift;
}
