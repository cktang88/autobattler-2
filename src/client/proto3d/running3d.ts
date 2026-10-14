// Legacy running gear still used by mobility/generic.ts: wheels, hover skirt, anchor plates (+ the old photoreal track
// assembly). Legs live in mobility/legs.ts, stylized tracks in mobility/tracks.ts.

import * as THREE from 'three';
import { Bld, loft, mtx, type V3 } from './geo.ts';
import type { Kit } from './materials.ts';

export interface Gear {
  /** y of the hull underside */
  y0: number;
  /** y of the hull shoulder (track top / fender level) */
  yt: number;
  /** half distance between inner track faces at the hull underside (hull bottom half-width) */
  wi: number;
  tracked: boolean;
  update?: (t: number, moving: number) => void;
}

const rr = (k: number) => k;

/** one track assembly in the XY plane, centred at (0, y), lateral z */
export function trackAssembly(b: Bld, kit: Kit, L: number, h: number, w: number, z: number, y: number, opts: { skirt?: boolean; outerSide: number; fender?: boolean; heavy?: boolean }) {
  const R = h / 2;
  const hl = L / 2;
  const xr = -hl + R, xf = hl - R * 0.9;
  const t = Math.max(0.018, R * 0.2);
  // loop outline (counter-clockwise): bottom run, front arc, top run, rear arc
  const outline = (rad: number): [number, number][] => {
    const pts: [number, number][] = [];
    const seg = 9;
    for (let i = 0; i <= seg; i++) { const a = -Math.PI / 2 + (i / seg) * Math.PI; pts.push([xf + Math.cos(a) * rad, R + Math.sin(a) * rad]); }
    for (let i = 0; i <= seg; i++) { const a = Math.PI / 2 + (i / seg) * Math.PI; pts.push([xr + Math.cos(a) * rad, R + Math.sin(a) * rad]); }
    return pts;
  };
  const outer = outline(R), inner = outline(R - t);
  const shape = new THREE.Shape(outer.map(([x, yy]) => new THREE.Vector2(x, yy)));
  shape.holes.push(new THREE.Path(inner.map(([x, yy]) => new THREE.Vector2(x, yy)).reverse()));
  const bw = Math.min(0.012, w * 0.08);
  const eg = new THREE.ExtrudeGeometry(shape, { depth: w - 2 * bw, bevelEnabled: true, bevelThickness: bw, bevelSize: bw, bevelOffset: -bw, bevelSegments: 1, curveSegments: 1 });
  b.g(eg, kit.rubber, mtx([0, y, z - (w - 2 * bw) / 2]));
  // links along the outer loop
  const ring = outline(R - t * 0.3);
  ring.push(ring[0]);
  const lens: number[] = [0];
  for (let i = 1; i < ring.length; i++) lens.push(lens[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]));
  const total = lens[lens.length - 1];
  const pitch = Math.max(0.05, R * (opts.heavy ? 0.34 : 0.3));
  const n = Math.round(total / pitch);
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n) * total;
    while (seg < lens.length - 2 && lens[seg + 1] < s) seg++;
    const f = (s - lens[seg]) / (lens[seg + 1] - lens[seg] || 1);
    const px = ring[seg][0] + (ring[seg + 1][0] - ring[seg][0]) * f, py = ring[seg][1] + (ring[seg + 1][1] - ring[seg][1]) * f;
    const ang = Math.atan2(ring[seg + 1][1] - ring[seg][1], ring[seg + 1][0] - ring[seg][0]);
    b.g(new THREE.BoxGeometry(pitch * 0.82, t * 1.5, w * 1.01), kit.metal, mtx([px, y + py, z], [0, 0, ang]));
    // grouser ridge on the ground-contact face
    if (i % 2 === 0) b.g(new THREE.BoxGeometry(pitch * 0.18, t * 1.0, w * 1.0), kit.metal, mtx([px, y + py - Math.cos(ang) * t * 0.9, z], [0, 0, ang]));
  }
  // wheels inside the loop, double rims on the outer face
  const side = opts.outerSide;
  const nW = Math.max(3, Math.round((xf - xr) / (R * 1.5)) + 1);
  const wr = R * 0.78;
  const wheel = (x: number, yy: number, rad: number, big: boolean) => {
    for (const dz of [-0.24, 0.24]) {
      const zz = z + dz * w;
      b.lathe(kit.rubber, [[0, -w * 0.2], [rad - 0.004, -w * 0.2], [rad, -w * 0.16], [rad, w * 0.16], [rad - 0.004, w * 0.2], [0, w * 0.2]], [x, y + yy, zz], 'z', 16);
      b.lathe(kit.steel, [[0, 0], [rad * 0.62, 0], [rad * 0.62, w * 0.2], [rad * 0.3, w * 0.24], [0, w * 0.26]], [x, y + yy, zz], 'z', 12);
    }
    b.cylb(kit.metal, rad * 0.46, w * 0.95, 0.004, [x, y + yy, z - w * 0.475], 'z', 10);
    void big;
  };
  for (let i = 0; i < nW; i++) wheel(xr + ((xf - xr) * i) / (nW - 1), R, wr * (i === 0 || i === nW - 1 ? 0.92 : 1), false);
  // sprocket teeth (rear) and idler hub (front) on the outer face
  const sx = xr;
  b.lathe(kit.steel, [[0, 0], [R * 0.74, 0], [R * 0.74, w * 0.05], [0, w * 0.05]], [sx, y + R, z + side * (w * 0.5 + 0.002)], 'z', 14);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; b.box(kit.steel, R * 0.2, R * 0.12, w * 0.32, sx + Math.cos(a) * R * 0.86, y + R + Math.sin(a) * R * 0.86, z, 0.004, [0, 0, a]); }
  // return rollers under the top run
  for (const f of [0.35, 0.62]) b.lathe(kit.metal, [[0, 0], [R * 0.2, 0], [R * 0.2, w * 0.8], [0, w * 0.8]], [xr + (xf - xr) * f, y + h - R * 0.28, z - w * 0.4], 'z', 8);
  // fender over the track and a sloped mudguard at the nose
  if (opts.fender !== false) {
    const fw = w * 1.18;
    b.box(kit.hull, L * 0.78, h * 0.06, fw, -L * 0.04, y + h + h * 0.06, z, Math.min(0.012, h * 0.04));
    b.box(kit.hull, R * 1.1, h * 0.05, fw, hl - R * 0.5, y + h + h * 0.06 - R * 0.28, z, 0.01, [0, 0, -0.5]);
  }
  if (opts.skirt) {
    // hanging side-armour plates covering the upper half of the wheels, slight overlap and outward tilt
    const ns = Math.max(3, Math.round(L / (R * 2.2)));
    const sl = (L * 0.86) / ns;
    for (let i = 0; i < ns; i++) {
      const sxc = -L * 0.43 + sl * (i + 0.5);
      b.box(i % 3 === 1 ? kit.panel : kit.hull, sl * 0.94, h * 0.62, w * 0.1, sxc, y + h * 0.66, z + side * (w * 0.5 + w * 0.12), Math.min(0.012, w * 0.05), [side * 0.06, 0, 0]);
    }
  }
}

export function buildGear(parent: THREE.Group, mobId: string, L: number, W: number, S: number, kit: Kit, _legsOut: unknown[] = []): Gear {
  const b = new Bld();
  const hf = Math.min(L, W);
  let gear: Gear;
  switch (mobId) {
    case 'treads': case 'halftrack': case 'megatracks': {
      const mega = mobId === 'megatracks';
      const h = mega ? 0.34 + 0.2 * S : 0.2 + 0.11 * S;
      const w = mega ? W * 0.14 : Math.max(0.15, W * 0.2);
      const zs = mega ? [-0.43, -0.235, 0.235, 0.43].map((k) => k * W) : [-1, 1].map((s) => s * (W / 2 - w / 2 - 0.015));
      if (mobId === 'halftrack') {
        for (const z of zs) {
          trackAssembly(b, kit, L * 0.52, h, w, z, 0, { skirt: false, outerSide: Math.sign(z), fender: false });
        }
        // front wheels
        const wr = h * 0.52;
        for (const z of zs) {
          const x = L * 0.3, zz = z;
          b.lathe(kit.rubber, [[0, -w * 0.42], [wr - 0.01, -w * 0.42], [wr, -w * 0.3], [wr, w * 0.3], [wr - 0.01, w * 0.42], [0, w * 0.42]], [x, wr, zz], 'z', 18);
          b.lathe(kit.steel, [[0, 0], [wr * 0.6, 0], [wr * 0.6, w * 0.44], [wr * 0.25, w * 0.5], [0, w * 0.5]], [x, wr, zz + Math.sign(z) * 0.0], 'z', 12);
          for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; b.cyl(kit.metal, 0.012, 0.012, 0.02, [x + Math.cos(a) * wr * 0.36, wr + Math.sin(a) * wr * 0.36, zz + Math.sign(z) * (w * 0.5)], 'z', 5); }
          b.box(kit.hull, wr * 2.3, h * 0.07, w * 1.2, x, h * 1.12, zz, 0.01);
        }
        b.cyl(kit.metal, 0.03, 0.03, W * 0.7, [L * 0.3, h * 0.5, -W * 0.35], 'z', 8);
      } else {
        for (const z of zs) trackAssembly(b, kit, L * (mega ? 0.95 : 0.97), h, w, z, 0, { skirt: S >= 2 && !mega || (mega && Math.abs(z) > W * 0.3), outerSide: Math.sign(z), heavy: mega });
        if (mega) b.box(kit.trim, L * 0.6, h * 0.35, W * 0.7, 0, h * 0.6, 0, 0.03);
      }
      gear = { y0: h * (mega ? 0.62 : 0.5), yt: h * (mega ? 1.0 : 1.0), wi: Math.max(0.2, W / 2 - w - 0.01), tracked: true };
      break;
    }
    case 'wheels': {
      const wr = 0.1 + 0.08 * S, w = wr * 0.8;
      const xs = S >= 2 ? [0.32, -0.32] : [0.3, -0.3];
      const wheelGroups: THREE.Group[] = [];
      for (const xf of xs) for (const sg of [-1, 1]) {
        const grp = new THREE.Group();
        grp.position.set(xf * L, wr, sg * (W / 2 - w / 2 + 0.01));
        const wb = new Bld();
        wb.lathe(kit.rubber, [[0, -w / 2], [wr * 0.82, -w / 2], [wr * 0.94, -w * 0.36], [wr, -w * 0.2], [wr, w * 0.2], [wr * 0.94, w * 0.36], [wr * 0.82, w / 2], [0, w / 2]], [0, 0, 0], 'z', 20);
        wb.lathe(kit.steel, [[0, 0], [wr * 0.56, 0], [wr * 0.56, w * 0.52 * 0.9], [wr * 0.4, w * 0.56], [0, w * 0.56]], [0, 0, sg * w * 0.0], 'z', 14);
        for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; wb.cyl(kit.metal, wr * 0.03, wr * 0.03, w * 0.6, [Math.cos(a) * wr * 0.38, Math.sin(a) * wr * 0.38, 0], 'z', 5); }
        wb.mount(grp);
        parent.add(grp);
        wheelGroups.push(grp);
      }
      for (const xf of xs) b.cyl(kit.metal, 0.03, 0.03, W - w, [xf * L, wr, -(W - w) / 2], 'z', 8);
      // mudguards
      for (const xf of xs) for (const sg of [-1, 1]) b.box(kit.hull, wr * 2.5, 0.025, w * 1.25, xf * L, wr * 2.0 + 0.01, sg * (W / 2 - w / 2 + 0.01), 0.01);
      gear = { y0: wr * 1.15, yt: wr * 2.0, wi: W / 2 - w * 0.8, tracked: false, update: (t, mv) => wheelGroups.forEach((g) => g.rotation.z = -t * 6 * mv) };
      break;
    }
    case 'anchor': {
      b.box(kit.trim, L * 0.95, 0.1, W * 0.95, 0, 0.05, 0, 0.03);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        b.cylb(kit.metal, 0.14, 0.22, 0.03, [sx * L * 0.42, 0.1, sz * W * 0.42], 'y', 10);
        b.box(kit.hazard, 0.28, 0.02, 0.1, sx * L * 0.42, 0.33, sz * W * 0.42 + sz * 0.1, 0.004);
      }
      gear = { y0: 0.14, yt: 0.2, wi: W * 0.4, tracked: false };
      break;
    }
    case 'rotor': case 'gravlift': case 'jet': {
      gear = { y0: 0, yt: 0.1, wi: W * 0.4, tracked: false };
      break;
    }
    default: {
      // hover skirt: low flexible skirt ring with fan intakes
      const hgt = 0.12 + 0.05 * S;
      const rings: V3[][] = [];
      for (const [x, wd, y] of [[-0.5, 0.78, 0.0], [-0.45, 0.94, 0.04], [0.42, 0.94, 0.04], [0.5, 0.7, 0.0]] as [number, number, number][]) {
        const r: V3[] = [];
        for (const [yy, ww] of [[y, wd * 0.9], [y + hgt, wd]] as [number, number][]) { r.push([x * L, yy, -ww * W / 2]); }
        for (const [yy, ww] of [[y + hgt, wd], [y, wd * 0.9]] as [number, number][]) { r.push([x * L, yy, ww * W / 2]); }
        rings.push(r);
      }
      b.loft(kit.rubber, rings);
      gear = { y0: hgt * 0.9, yt: hgt * 1.4, wi: W * 0.4, tracked: false };
    }
  }
  void rr; void loft;
  b.mount(parent, undefined);
  return gear;
}
