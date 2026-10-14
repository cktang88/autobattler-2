// Anchor mount (static emplacement), stylized: octagonal plinth with a lighter top plate and hazard edge, four splayed
// outrigger legs with pistons down to round foot pads outside the footprint corners. Reads "dug in" from above.

import { Bld } from '../geo.ts';
import { registerMobility, type Stance, type StanceIn } from '../chassis/registry.ts';
import { beam, block } from '../chassis/shapes.ts';

export function anchorStance(s: StanceIn): Stance {
  const y0 = 0.14 + 0.05 * s.S;
  return { y0, yt: y0 + 0.04, wi: s.W * 0.45, tracked: false, legs: null, thick: 0, hipY: 0 };
}

registerMobility('anchor', {
  stance: anchorStance,
  build(c) {
    const b = new Bld();
    const { kit, L, W, S } = c;
    const { y0 } = c.stance;
    const m = Math.min(L, W);
    // plinth: dark octagon, then a lighter top plate the hull sits on
    block(b, kit.trim, 0, 0, 0, L * 0.86, W * 0.86, y0 * 0.62, { top: [0.94, 0.94], ch: m * 0.24, bev: y0 * 0.08, bot: y0 * 0.1 });
    block(b, kit.panel, 0, y0 * 0.6, 0, L * 0.8, W * 0.8, y0 * 0.42, { top: [0.96, 0.96], ch: m * 0.22, bev: y0 * 0.08 });
    // hazard chevrons on the front and rear faces
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
      const z = (-0.3 + i * 0.2) * W;
      b.box(i % 2 ? kit.trim : kit.hazard, 0.02, y0 * 0.25, W * 0.18, sx * L * 0.43, y0 * 0.36, z, 0.004);
    }
    // outriggers: splayed legs to foot pads, piston on each
    const t = 0.04 + 0.025 * S;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const a: [number, number, number] = [sx * L * 0.3, y0 * 0.75, sz * W * 0.3];
      const f: [number, number, number] = [sx * (L * 0.5 + t * 0.6), t * 0.5, sz * (W * 0.5 + t * 0.6)];
      beam(b, kit.hull, a, f, t * 1.1, t);
      b.strut(kit.steel, [a[0] * 0.7, y0 * 0.95, a[2] * 0.7], [(a[0] + f[0]) / 2, (a[1] + f[1]) / 2 + t * 0.4, (a[2] + f[2]) / 2], t * 0.22, t * 0.22, 5);
      b.cylb(kit.metal, t * 1.4, t * 0.5, t * 0.15, [f[0], 0, f[2]], 'y', 8);
    }
    b.mount(c.root);
  },
});
