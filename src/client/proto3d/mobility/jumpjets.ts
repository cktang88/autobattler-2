// Jump legs: reverse-jointed ("chicken walker") biped legs with jump thrusters. Same stance and stride as the plain
// biped legs (legs.ts legStance / strideFor) so every walker hull fits both, but a very different read: the knee points
// backward, each thigh carries a thruster pod with a hot nozzle, each calf a downward booster, and a hip jet pack sits
// on the outside of every hip drum. Raider / melee personality: springy, forward-leaning, lots of hot orange.

import { Bld, type V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerMobility } from '../chassis/registry.ts';
import { block } from '../chassis/shapes.ts';
import { defaultHips, legStance, liteLegs, makeLeg, strideFor } from './legs.ts';

/** booster nozzle along local +Z (bone direction) at p: bell + hot core */
function nozzle(b: Bld, kit: Kit, p: V3, r: number, len: number, seg: number) {
  b.lathe(kit.metal, [[0, 0], [r * 0.7, 0], [r, len * 0.7], [r * 1.08, len], [r * 0.8, len], [0, len * 0.6]], p, 'z', seg);
  b.cyl(kit.hot, r * 0.62, r * 0.62, len * 0.08, [p[0], p[1], p[2] + len * 0.86], 'z', seg);
}

registerMobility('jumpjets', {
  stance: legStance,
  build(c) {
    const st = c.stance;
    const hips = c.hips && c.hips.length ? c.hips : defaultHips(st, c.L, c.W);
    const kind = st.legs ?? 'biped';
    const stride = Math.min(strideFor(c.mobId, c.S), st.hipY * (kind === 'spider' ? 0.7 : 0.55));
    const lite = liteLegs(c.S, hips.length, kind);
    const seg = lite ? 6 : 8;
    const legs = hips.map((h) => makeLeg(c.root, c.kit, h, {
      kind, stride, lift: st.hipY * (kind === 'spider' ? 0.4 : 0.32), lite, bend: kind === 'biped' ? 'back' : undefined,
      extra: {
        // thigh thruster pod on the front face (+Y after the reverse-knee flip), nozzle pointing down the bone
        thigh: (b, l, t) => {
          b.box(c.kit.trim, t * 1.1, t * 0.6, l * 0.5, 0, t * 0.95, l * 0.4, t * 0.15);
          nozzle(b, c.kit, [0, t * 1.15, l * 0.62], t * 0.32, t * 0.6, seg);
        },
        // calf booster on the back of the shin, pointing at the ground
        shin: (b, l, t) => {
          if (kind !== 'biped') return;
          b.box(c.kit.hull, t * 1.1, t * 0.5, l * 0.42, 0, -t * 0.7, l * 0.3, t * 0.12);
          nozzle(b, c.kit, [0, -t * 0.78, l * 0.5], t * 0.36, t * 0.6, seg);
        },
      },
    }));
    // hip jet packs: armoured pods on the outside of each hip drum, twin hot nozzles pointing down and back
    const b = new Bld();
    for (const h of hips) {
      const [x, y, z] = h.p, t = h.t, s = h.side;
      const px = x - t * 0.5, pz = z + s * t * 1.45;
      block(b, c.kit.hull, px, y - t * 1.1, pz, t * 2.2, t * 1.0, t * 2.0, { top: [0.7, 0.8], shift: [-t * 0.3, 0], ch: t * 0.35, bev: t * 0.12 });
      b.box(c.kit.accent, t * 1.4, t * 0.1, t * 0.08, px - t * 0.1, y + t * 0.6, pz + s * t * 0.5, t * 0.03);
      for (const dz of lite ? [0] : [-0.24, 0.24]) {
        b.cylb(c.kit.metal, t * 0.34, t * 0.5, t * 0.06, [px - t * 0.7, y - t * 1.55, pz + dz * t], 'y', seg);
        b.cyl(c.kit.hot, t * 0.24, t * 0.24, t * 0.04, [px - t * 0.7, y - t * 1.57, pz + dz * t], 'y', seg);
      }
    }
    b.mount(c.root);
    return (t, mv) => { for (const l of legs) l.step(t, mv); };
  },
});
