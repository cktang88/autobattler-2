// Jump legs: reverse-jointed ("chicken walker") biped legs with jump thrusters. Same stance and stride as the plain
// biped legs (legs.ts legStance / strideFor) so every walker hull fits both, but a very different read: the knee points
// backward, each thigh carries a thruster pod with a hot nozzle, each calf a downward booster, and a hip jet pack sits
// on the outside of every hip drum. Raider / melee personality: springy, forward-leaning, lots of hot orange.
// Hard-surface segments (legs.ts hsThigh / hsShin / hsFoot rolled so the armour faces forward), thruster pods built as
// dark cores under armour shells on shadow gaps (chassis/hs-kit.ts).

import * as THREE from 'three';
import { Bld, strutGeo, type V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerMobility } from '../chassis/registry.ts';
import { block } from '../chassis/shapes.ts';
import { armorPlate, frame, hose, rectP, sub, trapP } from '../chassis/hs-kit.ts';
import { defaultHips, legStance, legStyleFor, liteLegs, makeLeg, strideFor } from './legs.ts';

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
    const seg = lite ? 6 : 8, fine = (kind === 'spider' ? c.S >= 3 : c.S >= 2) && !lite;
    const legs = hips.map((h) => makeLeg(c.root, c.kit, h, {
      kind, stride, lift: st.hipY * (kind === 'spider' ? 0.4 : 0.32), lite, fine, style: legStyleFor(c.shape), bend: kind === 'biped' ? 'back' : undefined, reach: kind === 'biped' ? 1.1 : 1,
      extra: {
        // thigh thruster pod on the front face (+Y after the reverse-knee flip): dark housing under an armour shell on a
        // shadow gap, nozzle pointing down the bone, feed hose to the hip
        thigh: (b, l, t) => {
          if (lite) return;
          b.box(c.kit.mech, t * 0.95, t * 0.5, l * 0.46, 0, t * 1.12, l * 0.42, t * 0.08);
          armorPlate(b, c.kit, c.kit.armor, frame([0, t * 1.36, l * 0.4], [0, 1, 0], [0, 0, 1]), trapP(l * 0.5, t * 0.95, t * 1.2, t * 0.14), t * 0.16, { standoff: t * 0.06 });
          nozzle(b, c.kit, [0, t * 1.12, l * 0.64], t * 0.3, t * 0.55, seg);
          if (fine) hose(b, c.kit, [t * 0.45, t * 1.0, l * 0.2], [t * 0.4, t * 0.6, -t * 0.2], t * 0.07, 0.1, 3);
        },
        // calf booster on the back of the shin, pointing at the ground, braced by a strut
        shin: (b, l, t) => {
          if (kind !== 'biped' || lite) return;
          b.box(c.kit.mech, t * 0.9, t * 0.5, l * 0.4, 0, -t * 0.68, l * 0.3, t * 0.08);
          armorPlate(b, c.kit, c.kit.armor2, frame([0, -t * 0.93, l * 0.28], [0, -1, 0], [0, 0, 1]), trapP(l * 0.42, t * 0.8, t * 1.0, t * 0.12), t * 0.14, { standoff: t * 0.04 });
          nozzle(b, c.kit, [0, -t * 0.7, l * 0.5], t * 0.32, t * 0.55, seg);
        },
      },
    }));
    // hip jet packs: hung outside and behind each hip drum on a dark frame arm, a dark thruster core under two armour
    // shells (top + outer cheek) on shadow gaps, a louvred intake on the back, twin hot nozzles underneath, team stripe
    const b = new Bld();
    for (const h of hips) {
      const [x, y, z] = h.p, t = h.t, s = h.side;
      const px = x - t * 1.9, pz = z + s * t * 1.5;
      b.strut(c.kit.mech, [x, y, z + s * t], [px, y - t * 0.3, pz], t * 0.3, t * 0.24, 6);
      b.g(strutGeo([x - t * 0.3, y - t * 0.7, z + s * t * 0.8], [px + t * 0.4, y - t * 1.2, pz - s * t * 0.3], t * 0.12, t * 0.12, 5), c.kit.joint);
      block(b, c.kit.mech, px, y - t * 1.2, pz, t * 1.6, t * 1.15, t * 2.5, { top: [0.6, 0.8], shift: [-t * 0.7, 0], ch: t * 0.3, bev: t * 0.06 });
      // top shell (sloped back) + outer cheek shell
      armorPlate(b, c.kit, c.kit.armor, frame([px - t * 0.35, y + t * 1.1, pz], [0.5, 1, 0], [-1, 0.5, 0]), trapP(t * 1.6, t * 0.95, t * 1.3, t * 0.2), t * 0.22, { standoff: t * 0.08 });
      if (!lite) armorPlate(b, c.kit, c.kit.armor2, frame([px - t * 0.1, y - t * 0.1, pz + s * t * 0.6], [0, 0, s], [1, 0, 0]), rectP(t * 1.5, t * 1.6, t * 0.22), t * 0.16, { standoff: t * 0.06 });
      b.g(new THREE.BoxGeometry(t * 0.14, t * 1.6, t * 0.08), c.kit.accent, new THREE.Matrix4().makeRotationZ(0.32).setPosition(px + t * 0.45, y + t * 0.1, pz + s * t * (lite ? 0.62 : 0.86)));
      // louvred intake on the back face: dark recess with three slats
      if (!lite) {
        const F = frame([px - t * 1.02, y - t * 0.15, pz], [-1, 0.35, 0], [0, 0, 1]);
        b.g(new THREE.BoxGeometry(t * 0.85, t * 0.08, t * 0.95), c.kit.mech, F);
        for (const f of [-0.3, 0, 0.3]) b.g(new THREE.BoxGeometry(t * 0.75, t * 0.1, t * 0.16), c.kit.joint, sub(F, 0, t * 0.06, f * t, 0.5, 0, 0));
      }
      for (const dz of lite ? [0] : [-0.3, 0.3]) {
        b.cyl(c.kit.joint, t * 0.3, t * 0.38, t * 0.42, [px, y - t * 1.62, pz + dz * t], 'y', 6);
        b.cyl(c.kit.hot, t * 0.27, t * 0.27, t * 0.04, [px, y - t * 1.64, pz + dz * t], 'y', seg);
      }
    }
    b.mount(c.root);
    return (t, mv) => { for (const l of legs) l.step(t, mv); };
  },
});
