// Wheeled running gear, hard-surface style: faceted off-road tyres on dark dished steel rims (no bright caps), one
// spinning group per axle (both wheels share the axis, so ~1 animated node per axle), a static axle beam.
// Axle layouts follow the hull: carriage = one big gun axle, long hulls (L >= 2.5) and the hunter = three axles,
// otherwise two.
// Half-track: front wheel axle + compact rear track bogies with a few big cleats and road wheels, low-poly for squads.

import * as THREE from 'three';
import { Bld, type P2 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerMobility, type MobilityCtx, type Stance, type StanceIn } from '../chassis/registry.ts';
import { cbox } from '../chassis/light.ts';
import { block } from '../chassis/shapes.ts';
import { fineFor, trackSystem } from '../chassis/hs-kit.ts';
import { place, XBld } from '../chassis/tanks-kit.ts';

const BASE = { tracked: false, legs: null, thick: 0, hipY: 0 } as const;

export function wheelDims(s: { shape: string; S: number; W: number }) {
  // real-vehicle proportions: tyres ~1.1-1.4 m on a 5 m cell, narrow (the old fat toy tyres were 1.7 m and square)
  const wr = s.shape === 'carriage' ? 0.14 + 0.06 * s.S : 0.08 + 0.05 * s.S;
  const w = wr * (s.shape === 'carriage' ? 0.55 : 0.68);
  return { wr, w };
}

export function wheelStance(s: StanceIn): Stance {
  const { wr, w } = wheelDims(s);
  if (s.shape === 'carriage') return { ...BASE, y0: wr * 0.75, yt: wr * 1.2, wi: s.W / 2 - w - 0.03 };
  return { ...BASE, y0: wr * 0.8, yt: wr * 1.7, wi: s.W / 2 - w - 0.02 };
}

/** one tyre on an axle group (axle-local frame, wheel centre at (0, 0, z)): faceted off-road tyre with a tread band,
 *  dished dark steel rim, hub with a bolt ring (no bright caps: the wheel is a mechanical part, not a toy) */
function tyre(b: Bld, kit: Kit, wr: number, w: number, z: number, seg = 10): void {
  const side = z >= 0 ? 1 : -1;
  b.lathe(kit.rubber, [[wr * 0.5, -w / 2], [wr * 0.86, -w / 2], [wr, -w * 0.22], [wr, w * 0.22], [wr * 0.86, w / 2], [wr * 0.5, w / 2]], [0, 0, z], 'z', seg);
  const ax = side > 0 ? 'z' : '-z';
  b.lathe(kit.metal, [[0, w * 0.32], [wr * 0.6, w * 0.32], [wr * 0.32, w * 0.4], [0, w * 0.48]], [0, 0, z], ax, 8);
  b.cyl(kit.trim, wr * 0.55, wr * 0.55, w * 0.8, [0, 0, z - side * w * 0.46], ax, 6);
}

interface Axle { x: number; zs: number[]; wr: number; w: number }

function axles(c: MobilityCtx): Axle[] {
  const { wr, w } = wheelDims(c);
  const zo = c.W / 2 - w / 2;
  // scout: narrower front track (arrowhead plan; chassis/light.ts WEDGE_FRONT_TRACK)
  if (c.shape === 'wedge') return [{ x: c.L * 0.31, zs: [-zo * 0.78, zo * 0.78], wr, w }, { x: -c.L * 0.31, zs: [-zo, zo], wr, w }];
  if (c.shape === 'carriage') return [{ x: 0, zs: [-zo - w * 0.2, zo + w * 0.2], wr, w }];
  if (c.L >= 2.5 || c.shape === 'hunter') return [0.34, 0, -0.34].map((f) => ({ x: f * c.L, zs: [-zo, zo], wr, w }));
  return [0.31, -0.31].map((f) => ({ x: f * c.L, zs: [-zo, zo], wr, w }));
}

/** builds spinning axle groups into root; returns the updater */
export function buildAxles(c: MobilityCtx, list: Axle[], hb: Bld): (t: number, mv: number) => void {
  const groups: THREE.Group[] = [];
  for (const a of list) {
    const g = new THREE.Group();
    g.position.set(a.x, a.wr, 0);
    const b = new Bld();
    for (const z of a.zs) tyre(b, c.kit, a.wr, a.w, z, c.S >= 2 ? 10 : 8);
    b.mount(g);
    c.root.add(g);
    groups.push(g);
    // static axle beam + suspension blocks
    if (a.zs.length > 1) hb.cyl(c.kit.metal, a.wr * 0.16, a.wr * 0.16, Math.abs(a.zs[1] - a.zs[0]), [a.x, a.wr, a.zs[0]], 'z', 6);
    else cbox(hb, c.kit.metal, a.wr * 0.3, a.wr * 0.3, a.w * 1.5, a.x, a.wr, a.zs[0], 0.01);
  }
  return (t, mv) => { for (const g of groups) g.rotation.z = -t * 6 * mv; };
}

// ---- half-track ------------------------------------------------------------------------------------------------------
function htDims(s: { S: number; W: number; L: number }) {
  const h = 0.18 + 0.1 * s.S;
  const w = Math.max(0.14, s.W * 0.21);
  return { h, w, zo: s.W / 2 - w / 2 - 0.01 };
}

export function halftrackStance(s: StanceIn): Stance {
  const { h, w } = htDims(s);
  return { ...BASE, tracked: true, y0: h * 0.45, yt: h * 1.0, wi: Math.max(0.16, s.W / 2 - w - 0.01) };
}

/** compact low-poly track bogie centred at (xc, z): solid loop, a few big cleats, three road wheels, fender */
export function bogie(b: Bld, kit: Kit, xc: number, len: number, h: number, w: number, z: number, side: number): void {
  const R = h * 0.5, Ri = h * 0.38;
  const xr = xc - len / 2 + R, xf = xc + len / 2 - Ri;
  const pts: P2[] = [];
  for (let i = 0; i <= 4; i++) { const a = Math.PI / 2 + (i / 4) * Math.PI; pts.push([xr + Math.cos(a) * R, R + Math.sin(a) * R]); }
  for (let i = 0; i <= 4; i++) { const a = -Math.PI * 0.55 + (i / 4) * Math.PI * 1.05; pts.push([xf + Math.cos(a) * Ri, h - Ri + Math.sin(a) * Ri]); }
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const eg = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false, curveSegments: 1 });
  b.g(eg, kit.rubber, new THREE.Matrix4().makeTranslation(0, 0, z - w / 2));
  // big cleats along the ground run and the top run
  const n = Math.max(3, Math.round((xf - xr) / (h * 0.55)));
  for (let i = 0; i < n; i++) {
    const x = xr + ((xf - xr) * (i + 0.5)) / n;
    cbox(b, kit.metal, h * 0.18, h * 0.08, w * 1.06, x, h * 0.02, z, h * 0.02);
  }
  // road wheels / sprocket on the outer face
  const zo = z + side * (w / 2 + 0.003), ax = side > 0 ? 'z' : '-z';
  const disc = (x: number, y: number, r: number, mat = kit.metal) => b.lathe(mat, [[0, 0], [r, 0], [r * 0.84, w * 0.14], [0, w * 0.14]], [x, y, zo], ax, 8);
  disc(xr, R, R * 0.82, kit.panel);
  disc(xf, h - Ri, Ri * 0.8);
  disc((xr + xf) / 2, R * 0.72, R * 0.62);
  b.cyl(kit.trim, R * 0.2, R * 0.16, w * 0.06, [xr, R, zo + side * w * 0.13], ax, 6);
  // chunky fender over the run, sloped at the front
  block(b, kit.panel, xc - len * 0.02, h * 0.96, z, len * 0.9, w * 1.04, h * 0.1, { ch: h * 0.06, bev: h * 0.035 });
}

registerMobility('wheels', {
  stance: wheelStance,
  build(c) {
    const hb = new Bld();
    const upd = buildAxles(c, axles(c), hb);
    hb.mount(c.root);
    return upd;
  },
});

registerMobility('halftrack', {
  stance: halftrackStance,
  build(c) {
    const b = new Bld();
    const { h, w, zo } = htDims(c);
    const len = c.L * 0.56, xc = -c.L * 0.2;
    // size 1: the compact low-poly bogie; bigger hulls get the hard-surface track system (hs-kit trackSystem)
    if (c.S >= 2) for (const s of [-1, 1]) trackSystem(new XBld(b, place(xc, 0, 0)), c.kit, { L: len, h, w, z: s * zo, side: s, fender: true, coverTop: true, fine: fineFor(c.S), rollers: 2 });
    else for (const s of [-1, 1]) bogie(b, c.kit, xc, len, h, w, s * zo, s);
    const wr = h * 0.52;
    const upd = buildAxles(c, [{ x: c.L * 0.32, zs: [-zo, zo], wr, w: w * 0.92 }], b);
    // front mudguards
    // front mudguards: three-facet arc over each front tyre
    for (const s of [-1, 1]) for (const a of [0.45, Math.PI / 2, Math.PI - 0.45]) {
      const r = wr * 1.14;
      cbox(b, c.kit.armor2, wr * 0.82, h * 0.07, w * 1.12, c.L * 0.32 + Math.cos(a) * r, wr + Math.sin(a) * r, s * zo, h * 0.025, [0, 0, a - Math.PI / 2]);
    }
    b.mount(c.root);
    return upd;
  },
});
