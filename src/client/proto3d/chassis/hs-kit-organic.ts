// Organic / creature extension of the hard-surface kit (chassis/hs-kit.ts) for the walkers, creature-machines and
// giants: the same "real machine" construction (a dark structural core, separate armour with real thickness standing
// proud on a shadow gap, exposed joints and actuators), but with the shell vocabulary of chitin rather than welded plate:
//   * shellGeo / archShell: thick, FACETED arched shells (a carapace segment, a dorsal plate, a shoulder shell) built as
//     one closed solid with an explicit inner face and edge walls, so the plate thickness and its overhang read from
//     every side. Shingled runs of them make a segmented carapace (overlapping bands, each lifted at the rear lip).
//   * limbShell / limbSegs: the same shell wrapped over one side of a limb bone (leg local frames: +Z along the bone,
//     +Y toward the bend / dorsal side), segmented along the bone like an arthropod leg.
//   * spike, claw, mandible: tapering faceted points (4-sided), never cones or balls.
//   * eyeCluster: lens housings (dark cups) with small emissive lenses, in a named slot.
//   * deckFrame: a surface frame sampled from a hull's deck query (for plates on lofted hulls).
//   * sinew runs are hs-kit cableBundle / hose (rubber + gunmetal), not new geometry.
// Everything writes into the unit's Bld (merges per material: no extra draw calls).

import * as THREE from 'three';
import { strutGeo, type Bld, type MatLike, type P2, type V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { armorPlate, frame, inset, type Frame, type PlateOpts } from './hs-kit.ts';

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addk = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const avg = (...p: V3[]): V3 => { const c: V3 = [0, 0, 0]; for (const q of p) { c[0] += q[0]; c[1] += q[1]; c[2] += q[2]; } return [c[0] / p.length, c[1] / p.length, c[2] / p.length]; };
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Thick shell from an outer surface grid rows[i][j] (rows along the length, columns across). The inner surface is the
 *  outer one pushed by `thick` along inward(p) (unit vector). Closed solid: outer face, inner face, four edge walls.
 *  Flat shaded and explicitly oriented (outer face points away from inward). */
export function shellGeo(rows: V3[][], thick: number, inward: (p: V3) => V3): THREE.BufferGeometry {
  const R = rows.length, C = rows[0].length;
  const inner = rows.map((r) => r.map((p) => addk(p, inward(p), thick)));
  const pos: number[] = [];
  const tri = (a: V3, b: V3, c: V3, out: V3) => {
    const n = cross(sub(b, a), sub(c, a));
    if (dot(n, n) < 1e-16) return;
    if (dot(n, out) < 0) { const t = b; b = c; c = t; }
    pos.push(...a, ...b, ...c);
  };
  const quad = (a: V3, b: V3, c: V3, d: V3, out: V3) => { tri(a, b, c, out); tri(a, c, d, out); };
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < C - 1; j++) {
    const o = [rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]], n = [inner[i][j], inner[i][j + 1], inner[i + 1][j + 1], inner[i + 1][j]];
    const w = inward(avg(...o));
    quad(o[0], o[1], o[2], o[3], [-w[0], -w[1], -w[2]]);
    quad(n[0], n[1], n[2], n[3], w);
  }
  for (const [i, oi] of [[0, 1], [R - 1, R - 2]]) for (let j = 0; j < C - 1; j++) {
    const out = sub(avg(rows[i][j], rows[i][j + 1]), avg(rows[oi][j], rows[oi][j + 1]));
    quad(rows[i][j], rows[i][j + 1], inner[i][j + 1], inner[i][j], out);
  }
  for (const [j, oj] of [[0, 1], [C - 1, C - 2]]) for (let i = 0; i < R - 1; i++) {
    const out = sub(avg(rows[i][j], rows[i + 1][j]), avg(rows[i][oj], rows[i + 1][oj]));
    quad(rows[i][j], rows[i + 1][j], inner[i + 1][j], inner[i][j], out);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** arch profile point across t in [-1, 1]: half width w, rise h above the edge line (pw: flatter top when larger) */
const archY = (t: number, h: number, pw: number) => h * (1 - Math.pow(Math.abs(t), pw));

export interface ArchOpts {
  /** centre x, length along x, edge (springing) height, half width, rise above the edges, plate thickness */
  x: number; len: number; y0: number; w: number; h: number; thick: number;
  /** centre z (default 0) */
  cz?: number;
  /** facets across (default 4; odd counts put a ridge on the centre line) */
  cols?: number;
  /** profile exponent (default 2.2) */
  pw?: number;
  /** front / rear scale of the section (a shell that narrows toward its ends; default 0.84 / 0.96) */
  taperF?: number; taperB?: number;
  /** rear lip raised by this much (shingled bands overlap the next one back) */
  lift?: number;
  /** side skirts: the edges drop this far below y0 (default 0) */
  drop?: number;
  /** extra rows (default 3 rows: front, mid, rear; 2 = straight band) */
  rows?: 2 | 3;
}
/** Faceted arched carapace segment along x (a shell band over a body core). Returns the crest height. */
export function archShell(b: Bld, mat: MatLike, o: ArchOpts): number {
  const C = (o.cols ?? 4) + 1, cz = o.cz ?? 0, pw = o.pw ?? 2.2, drop = o.drop ?? 0;
  const sF = o.taperF ?? 0.84, sB = o.taperB ?? 0.96, lift = o.lift ?? 0;
  const base = o.y0 - drop, H = o.h + drop;
  const row = (x: number, s: number, dy: number): V3[] => Array.from({ length: C }, (_, j) => {
    const t = -1 + (2 * j) / (C - 1);
    return [x, base + dy + archY(t, H, pw) * s, cz + o.w * t * s] as V3;
  });
  const rows = o.rows === 2
    ? [row(o.x + o.len / 2, sF, 0), row(o.x - o.len / 2, sB, lift)]
    : [row(o.x + o.len / 2, sF, 0), row(o.x, 1, lift * 0.4), row(o.x - o.len / 2, sB, lift)];
  const ay = base - H * 0.35;
  b.g(shellGeo(rows, o.thick, (p) => norm([0, ay - p[1], cz - p[2]])), mat);
  return base + H + lift * 0.4;
}

/** Run of overlapping carapace bands from x0 (front) back to x1: each band is lifted at its rear lip and overlaps the
 *  next. prof(f) (f = 0 front .. 1 rear) gives [half width, rise, edge height]. Alternating materials. */
export function shingles(b: Bld, mats: MatLike[], x0: number, x1: number, n: number, thick: number, prof: (f: number) => [number, number, number], o: { cols?: number; pw?: number; overlap?: number; lift?: number; drop?: number; cz?: number } = {}): void {
  const step = (x0 - x1) / n, ov = o.overlap ?? 0.28;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n, [w, h, y0] = prof(f);
    const x = x0 - step * (i + 0.5);
    archShell(b, mats[i % mats.length], { x, len: step * (1 + ov), y0, w, h, thick, cols: o.cols, pw: o.pw, taperF: 0.9, taperB: 1.0, lift: o.lift ?? thick * 1.2, drop: o.drop, cz: o.cz });
  }
}

/** Arched shell plate over the +Y side of a limb bone (leg local frame: +Z along the bone), from z0 to z1. rx = half
 *  width, ry = rise, y = offset of the plate edges from the bone axis, tp = end scale at z1. */
export function limbShell(b: Bld, mat: MatLike, z0: number, z1: number, rx: number, ry: number, y: number, thick: number, o: { cols?: number; tp?: number; t0?: number; pw?: number; sign?: 1 | -1; m?: THREE.Matrix4 } = {}): void {
  const C = (o.cols ?? 3) + 1, tp = o.tp ?? 0.75, t0 = o.t0 ?? 1, pw = o.pw ?? 1.8, sg = o.sign ?? 1;
  const row = (z: number, s: number): V3[] => Array.from({ length: C }, (_, j) => {
    const t = -1 + (2 * j) / (C - 1);
    return [rx * t * s, sg * (y + archY(t, ry, pw)) * s, z] as V3;
  });
  const zm = (z0 + z1) / 2;
  const rows = [row(z0, t0), row(zm, (t0 + tp) / 2 + 0.06), row(z1, tp)];
  b.g(shellGeo(rows, thick, (p) => norm([-p[0] * 0.5, -p[1], 0])), mat, o.m);
}

/** Segmented arthropod limb armour: n overlapping limbShells along the bone from z0 to z1 (alternating materials). */
export function limbSegs(b: Bld, mats: MatLike[], z0: number, z1: number, n: number, rx: number, ry: number, y: number, thick: number, tp = 0.7, cols = 3, m?: THREE.Matrix4): void {
  const L = (z1 - z0) / n;
  for (let i = 0; i < n; i++) {
    const a = z0 + L * i, s0 = 1 - (1 - tp) * (i / n), s1 = 1 - (1 - tp) * ((i + 1) / n);
    limbShell(b, mats[i % mats.length], a - L * 0.08, a + L * 1.08, rx * s0, ry * s0, y * s0, thick, { tp: s1 / s0, cols, t0: 1, m });
  }
}

/** 4-sided tapering spike / claw from a to c (base radius r): faceted, not a cone */
export function spike(b: Bld, mat: MatLike, a: V3, c: V3, r: number, tip = 0.08): void {
  b.g(strutGeo(a, c, r, r * tip, 4), mat);
}

/** hooked claw: two spike segments (a -> knuckle -> tip) */
export function claw(b: Bld, mat: MatLike, a: V3, k: V3, c: V3, r: number): void {
  b.g(strutGeo(a, k, r, r * 0.7, 4), mat);
  b.g(strutGeo(k, c, r * 0.7, r * 0.06, 4), mat);
}

/** Eye / sensor cluster on frame F (lenses look along F's +x): each [dz, dy, r] gets a dark lens housing cup and an
 *  emissive lens. */
export function eyeCluster(b: Bld, kit: Kit, F: Frame, eyes: [number, number, number][], lens: MatLike = kit.glow): void {
  for (const [dz, dy, r] of eyes) {
    const m = F.clone().multiply(new THREE.Matrix4().makeTranslation(0, dy, dz));
    b.g(new THREE.CylinderGeometry(r * 1.25, r * 1.45, r * 0.9, 6).rotateZ(-Math.PI / 2), kit.mech, m);
    b.g(new THREE.CylinderGeometry(r, r, r * 0.3, 6).rotateZ(-Math.PI / 2), lens, m.clone().multiply(new THREE.Matrix4().makeTranslation(r * 0.4, 0, 0)));
  }
}

/** Surface frame at (x, z) on a hull deck query (normal from the deck gradient), +x along `along`. */
export function deckFrame(deck: (x: number, z: number) => number, x: number, z: number, along: V3 = [1, 0, 0], e = 0.05, lift = 0): Frame {
  const y = deck(x, z);
  const dx = (deck(x + e, z) - deck(x - e, z)) / (2 * e), dz = (deck(x, z + e) - deck(x, z - e)) / (2 * e);
  return frame([x, y + lift, z], norm([-dx, 1, -dz]), along);
}

/** Mandible / pincer jaw pair ahead of p along +x: two hooked blades opening by `open` (radians), length l. */
export function mandibles(b: Bld, kit: Kit, p: V3, l: number, r: number, spread: number, open = 0.35): void {
  for (const s of [-1, 1]) {
    const a: V3 = [p[0], p[1], p[2] + s * spread];
    const k: V3 = [p[0] + l * 0.55, p[1] - l * 0.12, p[2] + s * (spread + l * Math.sin(open) * 0.6)];
    const c: V3 = [p[0] + l, p[1] - l * 0.28, p[2] + s * (spread * 0.4)];
    b.g(strutGeo(a, k, r, r * 0.8, 4), kit.joint);
    b.g(strutGeo(k, c, r * 0.8, r * 0.08, 4), kit.steel);
  }
}

/** bone frame from a to c: +Z along the bone, +Y toward `up` (made perpendicular), origin at a (for limbShell on arms) */
export function boneFrame(a: V3, c: V3, up: V3 = [0, 1, 0]): THREE.Matrix4 {
  const z = norm(sub(c, a));
  let y = sub(up, [z[0] * dot(up, z), z[1] * dot(up, z), z[2] * dot(up, z)]);
  if (dot(y, y) < 1e-8) y = [1, 0, 0];
  y = norm(y);
  const x = cross(y, z);
  return new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z)).setPosition(a[0], a[1], a[2]);
}

/** Armour plate covering the planar (or near-planar) quad q (four corners in order around), inset by `margin`, standing
 *  proud along `out` on a dark backing (hs-kit armorPlate). For plating lofted hull faces: the plate follows the face.
 *  Returns the plate's top height above the face. */
export function quadPlate(b: Bld, kit: Kit, mat: MatLike, q: V3[], thick: number, out: V3, o: PlateOpts & { margin?: number } = {}): number {
  const c = avg(...q);
  let n = norm(cross(sub(q[1], q[0]), sub(q[q.length - 1], q[0])));
  if (dot(n, out) < 0) n = [-n[0], -n[1], -n[2]];
  const F = frame(c, n, sub(q[1], q[0]));
  const inv = F.clone().invert();
  const poly = q.map((p) => { const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(inv); return [v.x, v.z] as P2; });
  return armorPlate(b, kit, mat, F, o.margin ? inset(poly, o.margin) : poly, thick, o);
}

/** Station-hull face quads (shapes.ts stationHull sections [x, hw, y0, y1, y2, tf]) between stations i and i + 1:
 *  top (flat deck), shoulder (+z / -z), side wall (+z / -z). zc = hull centre line. */
export function stationQuads(st: [number, number, number, number, number, number][], i: number, zc = 0): { top: V3[]; sh: [V3[], V3[]]; wall: [V3[], V3[]] } {
  const a = st[i], e = st[i + 1];
  const P = (s: [number, number, number, number, number, number], k: 'top' | 'ym' | 'y1', side: number): V3 => {
    const [x, hw, , y1, y2, tf] = s, ym = y1 + (y2 - y1) * 0.45;
    return k === 'top' ? [x, y2, zc + side * hw * tf] : k === 'ym' ? [x, ym, zc + side * hw] : [x, y1, zc + side * hw];
  };
  const sides = [-1, 1].map((s) => ({
    sh: [P(a, 'top', s), P(e, 'top', s), P(e, 'ym', s), P(a, 'ym', s)],
    wall: [P(a, 'ym', s), P(e, 'ym', s), P(e, 'y1', s), P(a, 'y1', s)],
  }));
  return { top: [P(a, 'top', -1), P(e, 'top', -1), P(e, 'top', 1), P(a, 'top', 1)], sh: [sides[0].sh, sides[1].sh], wall: [sides[0].wall, sides[1].wall] };
}
