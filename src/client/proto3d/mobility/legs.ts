// Legged locomotion: bipeds (legs, jumpjets, titanlegs) and multi-leg spiders. Thick, load-bearing legs built from
// chunky segments: a big hip drum, an armoured thigh with a hydraulic ram, a knee drum + knee cap, an armoured shin
// with a calf ram, and broad feet (three-toed stompers for bipeds, splayed claw pads for spiders). 2-bone IK per leg.
//
// Each leg is three groups (thigh, shin, foot) with manual matrices, so the render adapter instances them as animated
// nodes. Hip positions come from the chassis (ChassisOut.hips) or the defaults below.

import * as THREE from 'three';
import { Bld, type V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerMobility, type Hip, type Stance, type StanceIn } from '../chassis/registry.ts';
import { block } from '../chassis/shapes.ts';

export interface Leg { step(t: number, moving: number): void }

/** half-stride (cells) that keeps planted feet from skating under render3d's odometer clock (units-adapter phaseFor) */
export function strideFor(mobId: string, S: number): number {
  return mobId === 'spider' ? 0.14 + 0.17 * S : 0.2 + 0.2 * S;
}

export function legStance(s: StanceIn): Stance {
  const m = Math.min(s.L, s.W);
  if (s.mobId === 'spider') {
    const hipY = 0.19 * m + 0.1, t = 0.05 * m + 0.035;
    return { y0: hipY - t * 1.3, yt: hipY + t * 0.4, wi: s.W * 0.34, tracked: false, legs: 'spider', thick: t, hipY };
  }
  // titan-class legs carry far more mass: thicker for the same reach
  const hipY = 0.4 * m + 0.12, t = (0.062 * m + 0.04) * (s.mobId === 'titanlegs' ? 1.2 : 1);
  return { y0: hipY - t * 0.5, yt: hipY + t * 0.6, wi: s.W * 0.34, tracked: false, legs: 'biped', thick: t, hipY };
}

/** default hips for hulls that do not place their own */
export function defaultHips(st: Stance, L: number, W: number): Hip[] {
  const t = st.thick;
  if (st.legs === 'spider') {
    const out: Hip[] = [];
    for (let row = -1; row <= 1; row++) for (const side of [-1, 1] as const) {
      const x = row * L * 0.3, z = side * W * 0.36;
      out.push({ p: [x, st.hipY, z], side, t, foot: [x + row * L * 0.16, 0, side * (W * 0.5 + st.hipY * 1.15)], phase: ((row + 1) % 2 === (side > 0 ? 1 : 0) ? 0 : Math.PI) });
    }
    return out;
  }
  return ([-1, 1] as const).map((side) => ({ p: [-0.02 * L, st.hipY, side * W * 0.27] as V3, side, t, foot: [-0.02 * L, 0, side * W * 0.31] as V3, phase: side > 0 ? Math.PI : 0 }));
}

// ---- segment geometry (local frame: +Z along the bone, +Y toward the knee/bend side, X across) ----------------------
const ring = (z: number, wx: number, wy: number, c = 0.3): V3[] => [
  [-wx * (1 - c), -wy, z], [wx * (1 - c), -wy, z], [wx, -wy * (1 - c), z], [wx, wy * (1 - c), z],
  [wx * (1 - c), wy, z], [-wx * (1 - c), wy, z], [-wx, wy * (1 - c), z], [-wx, -wy * (1 - c), z],
];

function thigh(b: Bld, kit: Kit, l: number, t: number, spider: boolean) {
  // core: a tapering armoured box
  b.loft(kit.trim, [ring(0, t * 0.8, t * 0.85), ring(l * 0.5, t * 0.78, t * 0.8), ring(l, t * 0.62, t * 0.62)]);
  // armour shell on the knee side, proud of the core, chamfered edges, slight bulge
  b.loft(kit.hull, [ring(l * 0.04, t * 1.0, t * 0.3, 0.45).map(([x, y, z]) => [x, y + t * 0.75, z] as V3),
    ring(l * 0.42, t * 1.12, t * 0.4, 0.45).map(([x, y, z]) => [x, y + t * 0.82, z] as V3),
    ring(l * 0.86, t * 0.86, t * 0.3, 0.45).map(([x, y, z]) => [x, y + t * 0.66, z] as V3)]);
  // side plates (panel colour) for a layered read (bipeds; spiders keep the budget)
  if (!spider) for (const sx of [-1, 1]) b.g(new THREE.BoxGeometry(t * 0.2, t * 0.9, l * 0.5), kit.panel, new THREE.Matrix4().makeTranslation(sx * t * 0.86, t * 0.1, l * 0.45));
  // hydraulic ram on the back: fat sleeve + bright rod
  b.strut(kit.metal, [0, -t * 0.95, l * 0.12], [0, -t * 0.85, l * 0.6], t * 0.3, t * 0.3, 6);
  b.strut(kit.steel, [0, -t * 0.85, l * 0.56], [0, -t * 0.78, l * 0.9], t * 0.15, t * 0.15, 5);
  // hip drum (axis across), with hub caps
  const hr = t * (spider ? 1.15 : 1.3), hw = t * (spider ? 1.7 : 2.0);
  b.cylb(kit.metal, hr, hw, hr * 0.18, [-hw / 2, 0, 0], 'x', spider ? 10 : 12);
  for (const sx of [-1, 1]) b.cyl(kit.hull, hr * 0.7, hr * 0.6, t * 0.14, [sx * (hw / 2 - t * 0.02), 0, 0], sx > 0 ? 'x' : '-x', 8);
  // knee drum
  const kr = t * 0.82, kw = t * 1.75;
  b.cylb(kit.metal, kr, kw, kr * 0.18, [-kw / 2, 0, l], 'x', spider ? 8 : 10);
  for (const sx of [-1, 1]) b.cyl(kit.steel, kr * 0.45, kr * 0.4, t * 0.06, [sx * kw / 2, 0, l], sx > 0 ? 'x' : '-x', 6);
}

function shin(b: Bld, kit: Kit, l: number, t: number, spider: boolean) {
  if (spider) {
    // strong tapering spar with an outer armour fin, ending in a spike
    b.loft(kit.trim, [ring(0, t * 0.72, t * 0.75), ring(l * 0.45, t * 0.6, t * 0.65), ring(l * 0.9, t * 0.34, t * 0.36)]);
    b.loft(kit.hull, [ring(l * 0.02, t * 0.86, t * 0.32, 0.45).map(([x, y, z]) => [x, y + t * 0.6, z] as V3),
      ring(l * 0.3, t * 0.9, t * 0.38, 0.45).map(([x, y, z]) => [x, y + t * 0.7, z] as V3),
      ring(l * 0.72, t * 0.5, t * 0.22, 0.45).map(([x, y, z]) => [x, y + t * 0.42, z] as V3)]);
    b.strut(kit.metal, [0, -t * 0.7, l * 0.08], [0, -t * 0.55, l * 0.45], t * 0.22, t * 0.2, 5);
    b.strut(kit.steel, [0, -t * 0.55, l * 0.42], [0, -t * 0.4, l * 0.66], t * 0.11, t * 0.11, 4);
    return;
  }
  b.loft(kit.trim, [ring(0, t * 0.66, t * 0.7), ring(l * 0.5, t * 0.6, t * 0.64), ring(l, t * 0.5, t * 0.52)]);
  // shin guard: big plate on the knee side, plus a knee cap overhanging the drum
  b.loft(kit.hull, [ring(l * 0.08, t * 0.86, t * 0.32, 0.45).map(([x, y, z]) => [x, y + t * 0.62, z] as V3),
    ring(l * 0.5, t * 0.8, t * 0.34, 0.45).map(([x, y, z]) => [x, y + t * 0.6, z] as V3),
    ring(l * 0.9, t * 0.62, t * 0.26, 0.45).map(([x, y, z]) => [x, y + t * 0.48, z] as V3)]);
  b.box(kit.panel, t * 1.3, t * 0.42, t * 1.1, 0, t * 0.82, -t * 0.12, t * 0.14, [0.35, 0, 0]);
  // calf ram
  b.strut(kit.metal, [0, -t * 0.72, l * 0.1], [0, -t * 0.66, l * 0.55], t * 0.24, t * 0.24, 6);
  b.strut(kit.steel, [0, -t * 0.66, l * 0.5], [0, -t * 0.56, l * 0.86], t * 0.12, t * 0.12, 5);
  // ankle drum
  b.cylb(kit.metal, t * 0.58, t * 1.3, t * 0.1, [-t * 0.65, 0, l], 'x', 8);
}

function foot(b: Bld, kit: Kit, t: number, spider: boolean) {
  if (spider) {
    // splayed claw pad: rubber sole, armoured hoof, three short claws
    b.cyl(kit.rubber, t * 0.95, t * 0.85, t * 0.2, [0, 0, 0], 'y', 8);
    block(b, kit.hull, 0, t * 0.18, 0, t * 1.4, t * 1.4, t * 0.6, { top: [0.55, 0.55], ch: t * 0.4, bev: t * 0.12 });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5;
      b.g(new THREE.BoxGeometry(t * 0.9, t * 0.26, t * 0.36), kit.metal, new THREE.Matrix4().makeRotationY(-a).setPosition(Math.cos(a) * t * 0.85, t * 0.13, Math.sin(a) * t * 0.85));
    }
    return;
  }
  // stomper: broad sole, armoured upper, three chunky toes forward and a heel spur
  const L = t * 4.2, Wd = t * 2.5;
  block(b, kit.rubber, t * 0.3, 0, 0, L * 0.9, Wd, t * 0.24, { ch: t * 0.5, bev: t * 0.06 });
  block(b, kit.hull, t * 0.1, t * 0.22, 0, L * 0.62, Wd * 0.86, t * 0.62, { top: [0.66, 0.74], shift: [-t * 0.25, 0], ch: t * 0.45, bev: t * 0.16 });
  for (const [dz, ry] of [[-0.8, -0.28], [0, 0], [0.8, 0.28]] as [number, number][]) {
    block(b, kit.metal, t * 1.5 + Math.cos(ry) * t * 0.5, 0.0, dz * t, t * 1.4, t * 0.7, t * 0.5, { top: [0.55, 0.8], shift: [t * 0.3, 0], ch: t * 0.2, bev: t * 0.08 });
  }
  block(b, kit.metal, -t * 1.6, 0, 0, t * 0.9, t * 0.9, t * 0.42, { top: [0.6, 0.7], shift: [-t * 0.2, 0], ch: t * 0.25, bev: t * 0.06 });
  // ankle yoke
  for (const sz of [-1, 1]) b.box(kit.trim, t * 0.9, t * 0.9, t * 0.26, 0, t * 0.85, sz * t * 0.62, t * 0.1);
}

export interface LegOpts { kind: 'biped' | 'spider'; stride: number; lift: number }

export function makeLeg(g: THREE.Object3D, kit: Kit, hip: Hip, o: LegOpts): Leg {
  const spider = o.kind === 'spider';
  const t = hip.t;
  const hipV = new THREE.Vector3(...hip.p), footV = new THREE.Vector3(...hip.foot);
  const d0 = hipV.distanceTo(footV);
  const l1 = d0 * (spider ? 0.7 : 0.6), l2 = d0 * (spider ? 0.84 : 0.6);
  const bendV = spider ? new THREE.Vector3(0, 1, hip.side * 0.3) : new THREE.Vector3(1, 0.12, 0);
  const mk = (fn: (b: Bld) => void) => { const grp = new THREE.Group(); const b = new Bld(); fn(b); b.mount(grp); grp.matrixAutoUpdate = false; g.add(grp); return grp; };
  const upper = mk((b) => thigh(b, kit, l1, t, spider));
  const lower = mk((b) => shin(b, kit, l2, t * (spider ? 0.95 : 0.92), spider));
  const footG = mk((b) => foot(b, kit, t * (spider ? 0.9 : 1), spider));
  if (spider) footG.matrixAutoUpdate = true;
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
    f.x += -Math.sin(ph) * o.stride * moving;
    const up = Math.max(0, Math.cos(ph));
    f.y += up * up * o.lift * moving;
    dir.copy(f).sub(hipV);
    let d = dir.length();
    d = Math.min(d, (l1 + l2) * 0.999);
    dir.normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    perp.copy(bendV).addScaledVector(dir, -bendV.dot(dir)).normalize();
    k.copy(hipV).addScaledVector(dir, a).addScaledVector(perp, h);
    place(hipV, k, upper);
    place(k, f, lower);
    if (spider) { footG.position.copy(f); footG.updateMatrix(); }
    else {
      // foot stays level, toes pitch up a little while swinging
      const pitch = up * moving * 0.25;
      footG.matrix.makeRotationZ(pitch).setPosition(f);
      footG.matrixWorldNeedsUpdate = true;
    }
  };
  step(0, 0);
  return { step };
}

registerMobility(['legs', 'jumpjets', 'titanlegs', 'spider'], {
  stance: legStance,
  build(c) {
    const st = c.stance;
    const hips = c.hips && c.hips.length ? c.hips : defaultHips(st, c.L, c.W);
    const kind = st.legs ?? 'biped';
    const stride = Math.min(strideFor(c.mobId, c.S), st.hipY * (kind === 'spider' ? 0.7 : 0.55));
    const legs = hips.map((h) => makeLeg(c.root, c.kit, h, { kind, stride, lift: st.hipY * (kind === 'spider' ? 0.32 : 0.26) }));
    if (c.mobId === 'jumpjets') {
      // jump thrusters on the hip drums: stubby nozzles with a hot core
      const b = new Bld();
      for (const h of hips) {
        const [x, y, z] = h.p;
        b.cylb(c.kit.metal, h.t * 0.55, h.t * 0.9, h.t * 0.1, [x - h.t * 1.4, y - h.t * 0.4, z], 'y', 10);
        b.cyl(c.kit.hot, h.t * 0.36, h.t * 0.36, h.t * 0.05, [x - h.t * 1.4, y - h.t * 0.42, z], 'y', 10);
      }
      b.mount(c.root);
    }
    return (t, mv) => { for (const l of legs) l.step(t, mv); };
  },
});
