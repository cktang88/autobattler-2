// Wheeled running gear, stylized: fat low-poly tyres (chunky faceted rims read as toy rubber), bright hub caps with a
// team-accent centre, one spinning group per axle (both wheels share the axis, so ~1 animated node per axle).
// Axle layouts follow the hull: wedge = trike (single front wheel under a fork fairing), carriage = one big gun axle,
// long hulls (L >= 2.5) = three axles, otherwise two.
// Half-track: front wheel axle + compact rear track bogies with a few big cleats and road wheels, low-poly for squads.

import * as THREE from 'three';
import { Bld, type P2 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerMobility, type MobilityCtx, type Stance, type StanceIn } from '../chassis/registry.ts';
import { block } from '../chassis/shapes.ts';

const BASE = { tracked: false, legs: null, thick: 0, hipY: 0 } as const;

export function wheelDims(s: { shape: string; S: number; W: number }) {
  const wr = s.shape === 'carriage' ? 0.16 + 0.07 * s.S : 0.11 + 0.06 * s.S;
  const w = wr * (s.shape === 'carriage' ? 0.62 : 0.82);
  return { wr, w };
}

export function wheelStance(s: StanceIn): Stance {
  const { wr, w } = wheelDims(s);
  if (s.shape === 'carriage') return { ...BASE, y0: wr * 0.75, yt: wr * 1.2, wi: s.W / 2 - w - 0.03 };
  return { ...BASE, y0: wr * 0.8, yt: wr * 1.7, wi: s.W / 2 - w - 0.02 };
}

/** one tyre + hub on an axle group (axle-local frame, wheel centre at (0, 0, z)) */
function tyre(b: Bld, kit: Kit, wr: number, w: number, z: number, seg = 10): void {
  const side = z >= 0 ? 1 : -1;
  b.lathe(kit.rubber, [[0, -w / 2], [wr * 0.72, -w / 2], [wr, -w * 0.28], [wr, w * 0.28], [wr * 0.72, w / 2], [0, w / 2]], [0, 0, z], 'z', seg);
  const ax = side > 0 ? 'z' : '-z';
  b.lathe(kit.panel, [[0, w * 0.44], [wr * 0.58, w * 0.44], [wr * 0.5, w * 0.56], [wr * 0.24, w * 0.6], [0, w * 0.6]], [0, 0, z], ax, 8);
  b.cyl(kit.accent, wr * 0.16, wr * 0.13, w * 0.1, [0, 0, z + side * w * 0.58], ax, 6);
}

interface Axle { x: number; zs: number[]; wr: number; w: number }

function axles(c: MobilityCtx): Axle[] {
  const { wr, w } = wheelDims(c);
  const zo = c.W / 2 - w / 2;
  if (c.shape === 'wedge') return [{ x: c.L * 0.32, zs: [0], wr: wr * 0.92, w: w * 0.9 }, { x: -c.L * 0.3, zs: [-zo, zo], wr, w }];
  if (c.shape === 'carriage') return [{ x: 0, zs: [-zo - w * 0.2, zo + w * 0.2], wr, w }];
  if (c.L >= 2.5) return [0.34, 0, -0.34].map((f) => ({ x: f * c.L, zs: [-zo, zo], wr, w }));
  return [0.31, -0.31].map((f) => ({ x: f * c.L, zs: [-zo, zo], wr, w }));
}

/** builds spinning axle groups into root; returns the updater */
export function buildAxles(c: MobilityCtx, list: Axle[], hb: Bld): (t: number, mv: number) => void {
  const groups: THREE.Group[] = [];
  for (const a of list) {
    const g = new THREE.Group();
    g.position.set(a.x, a.wr, 0);
    const b = new Bld();
    for (const z of a.zs) tyre(b, c.kit, a.wr, a.w, z);
    b.mount(g);
    c.root.add(g);
    groups.push(g);
    // static axle beam + suspension blocks
    if (a.zs.length > 1) hb.cyl(c.kit.metal, a.wr * 0.16, a.wr * 0.16, Math.abs(a.zs[1] - a.zs[0]), [a.x, a.wr, a.zs[0]], 'z', 6);
    else hb.box(c.kit.metal, a.wr * 0.3, a.wr * 0.3, a.w * 1.5, a.x, a.wr, a.zs[0], 0.01);
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
  const n = Math.max(3, Math.round((xf - xr) / (h * 0.45)));
  for (let i = 0; i < n; i++) {
    const x = xr + ((xf - xr) * (i + 0.5)) / n;
    b.box(kit.metal, h * 0.18, h * 0.08, w * 1.06, x, h * 0.02, z, h * 0.02);
  }
  // road wheels / sprocket on the outer face
  const zo = z + side * (w / 2 + 0.003), ax = side > 0 ? 'z' : '-z';
  const disc = (x: number, y: number, r: number, mat = kit.metal) => b.lathe(mat, [[0, 0], [r, 0], [r * 0.84, w * 0.14], [0, w * 0.14]], [x, y, zo], ax, 8);
  disc(xr, R, R * 0.82, kit.panel);
  disc(xf, h - Ri, Ri * 0.8);
  disc((xr + xf) / 2, R * 0.72, R * 0.62);
  b.cyl(kit.accent, R * 0.2, R * 0.16, w * 0.06, [xr, R, zo + side * w * 0.13], ax, 6);
  // chunky fender over the run, sloped at the front
  block(b, kit.hull, xc - len * 0.02, h * 0.96, z + side * w * 0.04, len * 0.92, w * 1.16, h * 0.12, { ch: h * 0.06, bev: h * 0.035 });
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
    for (const s of [-1, 1]) bogie(b, c.kit, xc, len, h, w, s * zo, s);
    const wr = h * 0.52;
    const upd = buildAxles(c, [{ x: c.L * 0.32, zs: [-zo, zo], wr, w: w * 0.92 }], b);
    // front mudguards
    for (const s of [-1, 1]) block(b, c.kit.hull, c.L * 0.32, wr * 1.9, s * zo, wr * 2.3, w * 1.18, h * 0.1, { top: [0.8, 1], ch: h * 0.05, bev: h * 0.03 });
    b.mount(c.root);
    return upd;
  },
});
