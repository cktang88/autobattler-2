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
      kind, stride, lift: st.hipY * (kind === 'spider' ? 0.4 : 0.32), lite, bend: kind === 'biped' ? 'back' : undefined, reach: kind === 'biped' ? 1.1 : 1,
      extra: {
        // thigh thruster pod on the front face (+Y after the reverse-knee flip), nozzle pointing down the bone
        thigh: (b, l, t) => {
          if (lite) return;
          b.box(c.kit.trim, t * 1.1, t * 0.6, l * 0.5, 0, t * 0.95, l * 0.4, t * 0.15);
          nozzle(b, c.kit, [0, t * 1.15, l * 0.62], t * 0.32, t * 0.6, seg);
        },
        // calf booster on the back of the shin, pointing at the ground
        shin: (b, l, t) => {
          if (kind !== 'biped' || lite) return;
          b.box(c.kit.hull, t * 1.1, t * 0.5, l * 0.42, 0, -t * 0.7, l * 0.3, t * 0.12);
          nozzle(b, c.kit, [0, -t * 0.78, l * 0.5], t * 0.36, t * 0.6, seg);
        },
      },
    }));
    // hip jet pods: fat armoured thruster pods hung outside and behind each hip drum, leaning back, twin hot nozzles
    // underneath, accent stripe and a swept fin on top (they read from the RTS camera as two "ears" behind the hull)
    const b = new Bld();
    for (const h of hips) {
      const [x, y, z] = h.p, t = h.t, s = h.side;
      const px = x - t * 1.9, pz = z + s * t * 1.5;
      b.strut(c.kit.metal, [x, y, z + s * t], [px, y - t * 0.3, pz], t * 0.32, t * 0.26, 6);
      if (!lite) block(b, c.kit.trim, px, y - t * 1.5, pz, t * 1.5, t * 1.3, t * 0.5, { ch: t * 0.3 });
      block(b, c.kit.hull, px, y - t * 1.1, pz, t * 1.8, t * 1.4, t * 2.8, { top: [0.55, 0.7], shift: [-t * 0.8, s * t * 0.15], ch: t * 0.42, bev: t * 0.14, bot: t * 0.1 });
      b.box(c.kit.accent, t * 0.14, t * 2.0, t * 0.1, px + t * 0.5, y + t * 0.2, pz + s * t * 0.66, t * 0.03, [0, 0, 0.32]);
      if (!lite) b.box(c.kit.panel, t * 1.3, t * 0.9, t * 0.14, px - t * 1.2, y + t * 1.5, pz, t * 0.04, [0, 0, -0.6]);
      for (const dz of lite ? [0] : [-0.32, 0.32]) {
        b.cylb(c.kit.metal, t * 0.38, t * 0.45, t * 0.06, [px, y - t * 1.9, pz + dz * t], 'y', seg);
        b.cyl(c.kit.hot, t * 0.29, t * 0.29, t * 0.04, [px, y - t * 1.92, pz + dz * t], 'y', seg);
      }
    }
    b.mount(c.root);
    return (t, mv) => { for (const l of legs) l.step(t, mv); };
  },
});
