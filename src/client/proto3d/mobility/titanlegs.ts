// Boss-scale biped legs for 'titanlegs': columnar, armoured, elephant-solid. Each leg is a huge hip ball joint, a
// thigh wrapped in layered armour with a hydraulic ram, a big knee drum under a pointed knee guard with a team glow
// lamp, a shin greave that flares toward the ankle, twin calf rams, and a broad four-toed stomper with a heel claw.
// Same 2-bone IK, gait clock and stride convention as mobility/legs.ts (planted feet do not skate). Registered after
// legs.ts (chassis/index.ts import order), so this builder owns 'titanlegs'.

import * as THREE from 'three';
import { Bld, type V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerMobility, type Hip, type Stance, type StanceIn } from '../chassis/registry.ts';
import { block } from '../chassis/shapes.ts';
import { hsFoot, hsShin, hsThigh } from './legs.ts';

/** titan stance: tall hips (big units stride over the field), thick legs */
export function titanStance(s: StanceIn): Stance {
  const m = Math.min(s.L, s.W);
  const hipY = (s.S >= 5 ? 0.49 : 0.42) * m + 0.12, t = (0.062 * m + 0.04) * (s.S >= 5 ? 1.35 : 1.2);
  return { y0: hipY - t * 0.5, yt: hipY + t * 0.6, wi: s.W * 0.34, tracked: false, legs: 'biped', thick: t, hipY };
}

const ring = (z: number, wx: number, wy: number, c = 0.3, oy = 0): V3[] => [
  [-wx * (1 - c), -wy + oy, z], [wx * (1 - c), -wy + oy, z], [wx, -wy * (1 - c) + oy, z], [wx, wy * (1 - c) + oy, z],
  [wx * (1 - c), wy + oy, z], [-wx * (1 - c), wy + oy, z], [-wx, wy * (1 - c) + oy, z], [-wx, -wy * (1 - c) + oy, z],
];

// local frame: +Z along the bone (hip -> knee -> ankle), +Y toward the bend side (front), X across
function thigh(b: Bld, kit: Kit, l: number, t: number) {
  b.loft(kit.metal, [ring(0, t * 0.85, t * 0.9), ring(l * 0.5, t * 0.82, t * 0.85), ring(l, t * 0.66, t * 0.66)]);
  // front armour: two overlapping plates, proud of the core
  b.loft(kit.hull2, [ring(l * 0.02, t * 1.12, t * 0.34, 0.45, t * 0.78), ring(l * 0.36, t * 1.22, t * 0.44, 0.45, t * 0.9), ring(l * 0.62, t * 1.06, t * 0.34, 0.45, t * 0.78)]);
  b.loft(kit.panel, [ring(l * 0.5, t * 1.0, t * 0.3, 0.45, t * 0.72), ring(l * 0.72, t * 1.04, t * 0.36, 0.45, t * 0.78), ring(l * 0.92, t * 0.84, t * 0.28, 0.45, t * 0.6)]);
  // side cheek plates
  for (const sx of [-1, 1]) b.g(new THREE.BoxGeometry(t * 0.22, t * 1.2, l * 0.6), kit.hull, new THREE.Matrix4().makeTranslation(sx * t * 0.92, t * 0.05, l * 0.4));
  // ram on the back
  b.strut(kit.metal, [0, -t * 1.0, l * 0.1], [0, -t * 0.9, l * 0.6], t * 0.34, t * 0.34, 8);
  b.strut(kit.steel, [0, -t * 0.9, l * 0.55], [0, -t * 0.8, l * 0.92], t * 0.17, t * 0.17, 6);
  // hip ball joint: a fat drum with armoured caps
  const hr = t * 1.45, hw = t * 2.2;
  b.cylb(kit.metal, hr, hw, hr * 0.2, [-hw / 2, 0, 0], 'x', 14);
  for (const sx of [-1, 1]) b.cyl(kit.hull, hr * 0.8, hr * 0.62, t * 0.2, [sx * (hw / 2 - t * 0.02), 0, 0], sx > 0 ? 'x' : '-x', 10);
  // knee drum
  const kr = t * 0.9, kw = t * 1.9;
  b.cylb(kit.metal, kr, kw, kr * 0.18, [-kw / 2, 0, l], 'x', 12);
  for (const sx of [-1, 1]) b.cyl(kit.steel, kr * 0.45, kr * 0.38, t * 0.07, [sx * kw / 2, 0, l], sx > 0 ? 'x' : '-x', 8);
}

function shin(b: Bld, kit: Kit, l: number, t: number) {
  b.loft(kit.metal, [ring(0, t * 0.7, t * 0.74), ring(l * 0.55, t * 0.64, t * 0.66), ring(l, t * 0.62, t * 0.6)]);
  // greave: big front plate that flares toward the ankle
  b.loft(kit.panel, [ring(l * 0.08, t * 0.9, t * 0.32, 0.45, t * 0.62), ring(l * 0.55, t * 0.98, t * 0.38, 0.45, t * 0.66), ring(l * 0.92, t * 1.18, t * 0.34, 0.45, t * 0.72)]);
  // knee guard: pointed cap over the knee drum + team glow lamp
  b.loft(kit.panel, [ring(-t * 0.6, t * 0.5, t * 0.2, 0.5, t * 0.95), ring(-t * 0.1, t * 1.0, t * 0.36, 0.45, t * 1.0), ring(t * 0.7, t * 0.9, t * 0.3, 0.45, t * 0.85)]);
  b.g(new THREE.BoxGeometry(t * 0.5, t * 0.12, t * 0.26), kit.glow, new THREE.Matrix4().makeTranslation(0, t * 1.33, t * 0.1));
  // twin calf rams
  for (const sx of [-1, 1]) {
    b.strut(kit.metal, [sx * t * 0.4, -t * 0.74, l * 0.08], [sx * t * 0.4, -t * 0.7, l * 0.55], t * 0.2, t * 0.2, 6);
    b.strut(kit.steel, [sx * t * 0.4, -t * 0.7, l * 0.5], [sx * t * 0.4, -t * 0.6, l * 0.88], t * 0.1, t * 0.1, 5);
  }
  b.cylb(kit.metal, t * 0.66, t * 1.5, t * 0.1, [-t * 0.75, 0, l], 'x', 10);
}

function foot(b: Bld, kit: Kit, t: number) {
  const L = t * 4.6, Wd = t * 3.0;
  block(b, kit.rubber, t * 0.3, 0, 0, L * 0.92, Wd, t * 0.26, { ch: t * 0.6, bev: t * 0.07 });
  block(b, kit.trim, t * 0.05, t * 0.24, 0, L * 0.66, Wd * 0.88, t * 0.75, { top: [0.6, 0.7], shift: [-t * 0.3, 0], ch: t * 0.5, bev: t * 0.18 });
  // four armoured toes fanning forward
  for (const [dz, ry] of [[-1.05, -0.32], [-0.36, -0.1], [0.36, 0.1], [1.05, 0.32]] as [number, number][]) {
    block(b, kit.metal, t * 1.7 + Math.cos(ry) * t * 0.4, 0, dz * t, t * 1.3, t * 0.62, t * 0.55, { top: [0.5, 0.8], shift: [t * 0.3, 0], ch: t * 0.18, bev: t * 0.08 });
  }
  block(b, kit.panel, t * 0.9, t * 0.2, 0, t * 1.2, Wd * 0.7, t * 0.4, { top: [0.6, 0.85], shift: [t * 0.2, 0], ch: t * 0.3, bev: t * 0.08 });
  block(b, kit.metal, -t * 1.75, 0, 0, t * 1.1, t * 1.1, t * 0.5, { top: [0.5, 0.7], shift: [-t * 0.3, 0], ch: t * 0.3, bev: t * 0.08 });
  for (const sz of [-1, 1]) b.box(kit.trim, t * 1.0, t * 1.0, t * 0.3, 0, t * 0.95, sz * t * 0.7, t * 0.1);
}

function makeTitanLeg(g: THREE.Object3D, kit: Kit, hip: Hip, stride: number, lift: number, hs = true) {
  const t = hip.t;
  const hipV = new THREE.Vector3(...hip.p), footV = new THREE.Vector3(...hip.foot);
  const d0 = hipV.distanceTo(footV);
  const l1 = d0 * 0.6, l2 = d0 * 0.6;
  const bendV = new THREE.Vector3(1, 0.12, 0);
  const mk = (fn: (b: Bld) => void) => { const grp = new THREE.Group(); const b = new Bld(); fn(b); b.mount(grp); grp.matrixAutoUpdate = false; g.add(grp); return grp; };
  // hard-surface heavy segments (legs.ts hsThigh / hsShin / hsFoot): dark core + skeleton, stacked armour shells,
  // exposed joint drums, paired rams and hose runs; the older moulded segments below stay for reference / fallback
  const upper = mk((b) => (hs ? hsThigh(b, kit, l1, t, true, true) : thigh(b, kit, l1, t)));
  const lower = mk((b) => (hs ? hsShin(b, kit, l2, t * 0.94, true, true) : shin(b, kit, l2, t * 0.94)));
  const footG = mk((b) => (hs ? hsFoot(b, kit, t, true, true) : foot(b, kit, t)));
  const f = new THREE.Vector3(), k = new THREE.Vector3(), dir = new THREE.Vector3(), perp = new THREE.Vector3(), tmp = new THREE.Vector3(), xa = new THREE.Vector3(), ya = new THREE.Vector3();
  const place = (a: THREE.Vector3, bb: THREE.Vector3, m: THREE.Object3D) => {
    tmp.copy(bb).sub(a).normalize();
    ya.copy(perp).addScaledVector(tmp, -perp.dot(tmp)).normalize();
    xa.crossVectors(ya, tmp);
    m.matrix.makeBasis(xa, ya, tmp).setPosition(a);
    m.matrixWorldNeedsUpdate = true;
  };
  const step = (time: number, moving: number) => {
    const ph = time * 3.2 + hip.phase;
    f.copy(footV);
    f.x += -Math.sin(ph) * stride * moving;
    const up = Math.max(0, Math.cos(ph));
    f.y += up * up * lift * moving;
    dir.copy(f).sub(hipV);
    const d = Math.min(dir.length(), (l1 + l2) * 0.999);
    dir.normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    perp.copy(bendV).addScaledVector(dir, -bendV.dot(dir)).normalize();
    k.copy(hipV).addScaledVector(dir, a).addScaledVector(perp, h);
    place(hipV, k, upper);
    place(k, f, lower);
    footG.matrix.makeRotationZ(up * moving * 0.2).setPosition(f);
    footG.matrixWorldNeedsUpdate = true;
  };
  step(0, 0);
  return step;
}

registerMobility('titanlegs', {
  stance: titanStance,
  build(c) {
    const st = c.stance;
    const hips: Hip[] = c.hips && c.hips.length ? c.hips : ([-1, 1] as const).map((side) => ({ p: [-0.02 * c.L, st.hipY, side * c.W * 0.27] as V3, side, t: st.thick, foot: [-0.02 * c.L, 0, side * c.W * 0.31] as V3, phase: side > 0 ? Math.PI : 0 }));
    // same half-stride rule as legs.ts strideFor (render3d odometer clock), capped by hip height
    const stride = Math.min(0.2 + 0.2 * c.S, st.hipY * 0.55);
    const legs = hips.map((h) => makeTitanLeg(c.root, c.kit, h, stride, st.hipY * 0.22));
    return (t, mv) => { for (const l of legs) l(t, mv); };
  },
});
