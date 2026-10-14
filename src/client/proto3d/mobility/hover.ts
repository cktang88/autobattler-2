// Hover skirt, stylized: a fat inflated skirt bag following the hull plan (squircle, or a teardrop for pointed hulls),
// a dark rim band on top, team-glow lift ring underneath and two rear thrust fans whose rotors spin.

import * as THREE from 'three';
import { Bld, type V3 } from '../geo.ts';
import { registerMobility, type Stance, type StanceIn } from '../chassis/registry.ts';

export function hoverStance(s: StanceIn): Stance {
  const y0 = 0.1 + 0.035 * s.S;
  return { y0, yt: y0 + 0.05, wi: s.W * 0.44, tracked: false, legs: null, thick: 0, hipY: 0 };
}

const POINTY = new Set(['wedge', 'hunter', 'cross', 'box']);

/** plan ring at height y: squircle / teardrop of half-length a, half-width c */
function planRing(y: number, a: number, c: number, pointy: boolean, n = 16): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2, ct = Math.cos(t), st = Math.sin(t);
    const e = 2 / 3.2;
    let x = Math.sign(ct) * Math.abs(ct) ** e * a;
    let z = Math.sign(st) * Math.abs(st) ** e * c;
    if (pointy && x > 0) { const f = x / a; z *= 1 - 0.55 * f * f; x *= 1.04; }
    out.push([x, y, z]);
  }
  return out;
}

registerMobility('hover', {
  stance: hoverStance,
  build(c) {
    const b = new Bld();
    const { y0 } = c.stance;
    const pointy = POINTY.has(c.shape);
    const a = c.L * 0.49, w = c.W * 0.49;
    // skirt bag: tucked bottom, bulging middle, top meets the hull underside
    b.loft(c.kit.rubber, [planRing(0.02, a * 0.9, w * 0.88, pointy), planRing(y0 * 0.45, a, w, pointy), planRing(y0 + 0.01, a * 0.95, w * 0.94, pointy)]);
    b.loft(c.kit.trim, [planRing(y0 - 0.005, a * 0.975, w * 0.97, pointy), planRing(y0 + 0.035, a * 0.965, w * 0.96, pointy)]);
    // lift glow just under the bag
    b.loft(c.kit.glow, [planRing(0.006, a * 0.86, w * 0.84, pointy), planRing(0.012, a * 0.82, w * 0.8, pointy)]);
    // rear thrust fans: duct ring on a pylon, spinning rotor
    const fr = Math.min(0.08 + 0.05 * c.S, c.W * 0.16);
    const fx = -a * 0.92, fy = y0 + 0.06 + fr;
    const rotors: THREE.Group[] = [];
    for (const s of [-1, 1]) {
      const z = s * w * 0.48;
      b.lathe(c.kit.hull, [[fr * 0.86, 0], [fr * 1.12, 0], [fr * 1.16, fr * 0.6], [fr * 0.9, fr * 0.6]], [fx, fy, z], '-x', 10);
      b.box(c.kit.trim, fr * 0.5, fy - y0, fr * 0.3, fx + fr * 0.3, (fy + y0) / 2, z, 0.01);
      const g = new THREE.Group();
      g.position.set(fx - fr * 0.3, fy, z);
      const rb = new Bld();
      rb.cyl(c.kit.metal, fr * 0.22, fr * 0.22, fr * 0.2, [0, 0, 0], 'x', 6);
      for (let k = 0; k < 3; k++) rb.box(c.kit.metal, fr * 0.04, fr * 1.6, fr * 0.22, 0, 0, 0, 0.004, [(k / 3) * Math.PI, 0, 0]);
      rb.mount(g);
      c.root.add(g);
      rotors.push(g);
    }
    b.mount(c.root);
    return (t, mv) => { for (const g of rotors) g.rotation.x = t * (8 + 14 * mv); };
  },
});
