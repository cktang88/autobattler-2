// Walker hulls: Strider (hard-surface humanoid skirmisher mech: dark skeleton + armour shells, pistons, hose bundles,
// three-plate pauldrons, arm gun pods; see chassis/hs-kit.ts)
// and Orbwalker / arachnid (glass orb cockpit on a neck collar ahead of an armoured abdomen, four arching legs).

import * as THREE from 'three';
import type { P2, V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { strutGeo, type Bld } from '../geo.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar, dome, exhaust, glow, hazard, sensor } from './shapes.ts';
import { shell, tbeam, wristRing } from './creatures.ts';
import {
  antenna, armorPlate, cableBundle, crewHatch, exhaustBox, fineFor, frame, frameLimb, handrail, hexSec, hose, jointDrum, ladder, piston, plateStack, recessPanel, rectP,
  trapP,
} from './hs-kit.ts';
import { archShell, claw, eyeCluster, mandibles, shellGeo, shingles, spike } from './hs-kit-organic.ts';

const norm3 = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** point a fraction f from a to c, plus an offset */
const mid3 = (a: V3, c: V3, f: number, off: V3 = [0, 0, 0]): V3 => [a[0] + (c[0] - a[0]) * f + off[0], a[1] + (c[1] - a[1]) * f + off[1], a[2] + (c[2] - a[2]) * f + off[2]];

/** humanoid arm: shoulder drum, upper arm down to the elbow, forearm weapon pod (top face at podTop) */
export function mechArm(b: Bld, kit: Kit, side: number, sh: V3, el: V3, pod0: V3, podL: number, podW: number, podH: number, t: number): number {
  b.cylb(kit.metal, t * 1.05, t * 1.5, t * 0.18, [sh[0], sh[1], sh[2] - side * t * 0.75], side > 0 ? 'z' : '-z', 14);
  beam(b, kit.trim, sh, el, t * 1.25, t * 1.25, [1, 0, 0]);
  beam(b, kit.hull, [sh[0] + t * 0.45, sh[1] - t * 0.3, sh[2] + side * t * 0.1], [el[0] + t * 0.45, el[1] + t * 0.3, el[2] + side * t * 0.1], t * 0.7, t * 1.45, [0, 0, side]);
  b.cylb(kit.metal, t * 0.8, t * 1.4, t * 0.12, [el[0], el[1], el[2] - side * t * 0.7], side > 0 ? 'z' : '-z', 12);
  // forearm pod: chunky armoured housing, nose chamfered, glow strip along the outer face
  const [px, py, pz] = pod0;
  block(b, kit.trim, px, py, pz, podL * 0.92, podW * 0.8, podH * 0.4, { ch: podW * 0.2 });
  block(b, kit.hull, px + podL * 0.03, py + podH * 0.25, pz, podL, podW, podH * 0.75, { top: [0.86, 0.84], shift: [-podL * 0.04, 0], ch: podW * 0.24, bev: podH * 0.16, bot: podH * 0.08 });
  glow(b, kit, px + podL * 0.05, py + podH * 0.55, pz + side * podW * 0.5, podL * 0.5, podH * 0.08, podW * 0.05);
  return py + podH;
}

/** hard-surface arm: shoulder joint drum, twin-strut upper arm with an outer armour shell, elbow drum + actuator
 *  piston, forearm weapon pod (dark core, top and outer armour plates). Returns the pod top (weapon seat). */
export function mechArmHS(b: Bld, kit: Kit, side: number, sh: V3, el: V3, pod0: V3, podL: number, podW: number, podH: number, t: number, fine: boolean): number {
  jointDrum(b, kit, sh, t * 1.05, t * 1.5, 'z');
  frameLimb(b, kit, sh, el, t * 0.32, [t * 0.42, 0, 0]);
  const mid: V3 = [(sh[0] + el[0]) / 2, (sh[1] + el[1]) / 2, (sh[2] + el[2]) / 2];
  const len = Math.hypot(el[0] - sh[0], el[1] - sh[1], el[2] - sh[2]);
  armorPlate(b, kit, kit.armor, frame([mid[0], mid[1], mid[2] + side * t * 0.42], [0, 0, side], [el[0] - sh[0], el[1] - sh[1], el[2] - sh[2]]), rectP(len * 0.7, t * 1.7, t * 0.25), t * 0.3, { standoff: t * 0.1, gap: t * 0.2 });
  jointDrum(b, kit, el, t * 0.8, t * 1.4, 'z');
  const [px, py, pz] = pod0;
  // forearm pod: dark core, a top armour plate (the weapon seats on it), outer cheek plate, glow strip
  block(b, kit.mech, px, py, pz, podL * 0.94, podW * 0.82, podH * 0.78, { top: [0.92, 0.9], shift: [-podL * 0.02, 0], ch: podW * 0.14, bev: podH * 0.06 });
  const top = py + podH * 0.78;
  const so = podH * 0.04, th = podH * 0.13;
  armorPlate(b, kit, kit.armor, frame([px + podL * 0.02, top, pz], [0, 1, 0]), trapP(podL * 0.96, podW * 0.8, podW, podW * 0.12), th, { standoff: so, gap: podW * 0.07 });
  armorPlate(b, kit, kit.armor2, frame([px, py + podH * 0.42, pz + side * podW * 0.41], [0, 0, side]), rectP(podL * 0.82, podH * 0.5, podH * 0.08), podH * 0.1, { standoff: podH * 0.03 });
  glow(b, kit, px + podL * 0.1, py + podH * 0.22, pz + side * podW * 0.46, podL * 0.36, podH * 0.05, podW * 0.04);
  // elbow actuator: piston from the upper arm frame to the pod back
  piston(b, kit, [sh[0] - t * 0.2, sh[1] - len * 0.3, sh[2] - side * t * 0.5], [px - podL * 0.42, py + podH * 0.62, pz - side * podW * 0.3], t * 0.24, 0.55, fine);
  return top + so + th;
}

function strider(c: ChassisCtx): ChassisOut {
  // Hard-surface skirmisher mech (chassis/hs-kit.ts): a dark skeleton (pelvis frame, spine column, twin-strut limbs,
  // exposed joint drums) carrying separate armour shells on shadow gaps: a two-layer chest stack, side shells, a
  // codpiece and tassets, three-plate pauldrons. Backpack power cells feed the torso through hose bundles; exhaust
  // grille, handrail and hatch on the pack. Asymmetric: cockpit offset left with an antenna on the left, a three-lens
  // sensor cluster on the right, an ammo feed cable from the backpack to the right arm pod.
  const { b, kit, W, L, stance, S } = c;
  const u = Math.min(L, W) / 2; // 1 for the 2x2 strider
  const fine = fineFor(S);
  const t = stance.legs === 'biped' ? stance.thick : 0.15 * u;
  const pelvisY = stance.legs === 'biped' ? stance.hipY : Math.max(stance.yt, stance.hipY) + 0.1 * u;
  if (stance.legs !== 'biped') block(b, kit.mech, -0.02 * u, stance.y0 - 0.02, 0, 0.62 * u, 0.62 * u, pelvisY - stance.y0 + 0.04, { top: [0.8, 0.8], ch: 0.12 * u });
  // ---- pelvis: dark frame block between the hip drums, armoured codpiece and two tassets hanging off it
  block(b, kit.mech, -0.03 * u, pelvisY - 0.16 * u, 0, 0.42 * u, 0.4 * u, 0.3 * u, { top: [0.86, 1.05], ch: 0.07 * u, bev: 0.02 * u });
  armorPlate(b, kit, kit.armor, frame([0.19 * u, pelvisY - 0.04 * u, 0], [1, -0.25, 0], [0, 0, 1]), trapP(0.26 * u, 0.2 * u, 0.3 * u, 0.04 * u), 0.04 * u, { standoff: 0.02 * u });
  both((s) => armorPlate(b, kit, kit.armor2, frame([0.08 * u, pelvisY - 0.1 * u, s * 0.2 * u], [0.55, -0.15, s * 0.85], [0, 1, 0]), rectP(0.22 * u, 0.2 * u, 0.03 * u), 0.03 * u, { standoff: 0.015 * u }));
  // ---- spine column (waist): exposed actuator column with twin stabiliser rams
  const ty0 = pelvisY + 0.1 * u, th = 0.46 * u, ty1 = ty0 + th;
  b.cylb(kit.joint, 0.11 * u, ty0 - pelvisY + 0.06 * u, 0.02 * u, [-0.04 * u, pelvisY - 0.02 * u, 0], 'y', 10);
  b.cyl(kit.mech, 0.17 * u, 0.17 * u, 0.04 * u, [-0.04 * u, pelvisY + 0.04 * u, 0], 'y', 12);
  both((s) => piston(b, kit, [0.06 * u, pelvisY - 0.02 * u, s * 0.14 * u], [0.08 * u, ty0 + 0.06 * u, s * 0.12 * u], 0.025 * u, 0.55, fine));
  // ---- torso core (dark) + armour shells
  block(b, kit.mech, -0.04 * u, ty0, 0, 0.5 * u, 0.48 * u, th, { top: [0.82, 0.86], shift: [0.03 * u, 0], ch: 0.09 * u, bev: 0.03 * u });
  const chest: P2[] = [[-0.25, -0.2], [0.25, -0.2], [0.3, 0.1], [0.2, 0.24], [-0.2, 0.24], [-0.3, 0.1]].map(([x, z]) => [x * u, z * u] as P2);
  const CF = frame([0.24 * u, ty0 + th * 0.48, 0], [0.92, 0.38, 0], [0, 0, 1]);
  plateStack(b, kit, kit.armor, CF, chest, [
    { inset: 0, thick: 0.045 * u, standoff: 0.02 * u },
    { inset: 0.06 * u, thick: 0.035 * u, shift: [0, 0.05 * u], mat: kit.armor2 },
  ], { gap: 0.03 * u });
  glow(b, kit, 0.3 * u, ty0 + th * 0.22, 0, 0.03 * u, 0.05 * u, 0.12 * u, [0, 0, -0.4]);
  both((s) => armorPlate(b, kit, kit.armor, frame([-0.05 * u, ty0 + th * 0.5, s * 0.235 * u], [0, 0.12, s], [1, 0, 0]), trapP(0.44 * u, th * 0.7, th * 0.82, 0.04 * u), 0.04 * u, { standoff: 0.015 * u }));
  // belly plate under the chest
  armorPlate(b, kit, kit.armor2, frame([0.2 * u, ty0 + 0.05 * u, 0], [0.75, -0.45, 0], [0, 0, 1]), rectP(0.34 * u, 0.12 * u, 0.03 * u), 0.03 * u, { standoff: 0.01 * u });
  // ---- cockpit head (offset left), visor slit, sensor cluster on the right, antenna on the left
  const hz = -0.08 * u;
  block(b, kit.armor, 0.2 * u, ty1 - 0.07 * u, hz, 0.24 * u, 0.2 * u, 0.15 * u, { top: [0.6, 0.8], shift: [-0.04 * u, 0], ch: 0.05 * u, bev: 0.02 * u });
  b.box(kit.glass, 0.03 * u, 0.04 * u, 0.15 * u, 0.32 * u, ty1 - 0.01 * u, hz, 0.006, [0, 0, -0.7]);
  b.box(kit.mech, 0.12 * u, 0.1 * u, 0.1 * u, 0.2 * u, ty1 - 0.03 * u, 0.1 * u, 0.015 * u);
  for (const [dy, dz, r] of [[0.02, 0.07, 0.03], [0.02, 0.13, 0.022], [-0.03, 0.1, 0.02]] as [number, number, number][]) {
    b.cyl(kit.mech, r * u * 1.2, r * u * 1.2, 0.04 * u, [0.25 * u, ty1 - 0.03 * u + dy * u, dz * u], 'x', 8);
    b.cyl(kit.lamp, r * u, r * u, 0.012 * u, [0.29 * u, ty1 - 0.03 * u + dy * u, dz * u], 'x', 8);
  }
  antenna(b, kit, -0.02 * u, ty1, -0.2 * u, 0.55 * u, 0.006 * u, [-0.25, 0, -0.05]);
  // ---- backpack: twin power cells on a frame, hose bundles to the torso, exhaust grille, handrail + hatch
  b.box(kit.mech, 0.12 * u, th * 0.8, 0.42 * u, -0.34 * u, ty0 + th * 0.5, 0, 0.02 * u);
  for (const s of [-1, 1]) {
    b.cylb(kit.joint, 0.14 * u, th * 0.9, 0.025 * u, [-0.46 * u, ty0 + 0.04 * u, s * 0.16 * u], 'y', 10);
    for (const f of [0.3, 0.62]) b.cyl(kit.mech, 0.148 * u, 0.148 * u, 0.025 * u, [-0.46 * u, ty0 + th * f, s * 0.16 * u], 'y', 10);
    b.cyl(kit.glow, 0.15 * u, 0.15 * u, 0.018 * u, [-0.46 * u, ty0 + th * 0.46, s * 0.16 * u], 'y', 10);
    b.cyl(kit.hot, 0.07 * u, 0.07 * u, 0.01, [-0.46 * u, ty0 + th * 0.94, s * 0.16 * u], 'y', 8);
    if (fine) hose(b, kit, [-0.4 * u, ty0 + th * 0.75, s * 0.28 * u], [-0.16 * u, ty0 + th * 0.65, s * 0.25 * u], 0.014 * u, 0.1);
  }
  recessPanel(b, kit, frame([-0.61 * u, ty0 + th * 0.45, 0], [-1, 0, 0], [0, 0, 1]), 0.18 * u, th * 0.5, 0.025 * u, { slats: 4 });
  if (fine) handrail(b, kit, [[-0.6 * u, ty1 + 0.03 * u, -0.12 * u], [-0.6 * u, ty1 + 0.03 * u, 0.12 * u]], 0.006 * u, 0.06 * u);
  crewHatch(b, kit, frame([-0.3 * u, ty1 - 0.005, -0.06 * u], [0, 1, 0]), 0.045 * u, fine);
  // ---- shoulders + arms (arm pods are anatomy under the arm mounts: forearm guns at z ~ +-0.68)
  const armMounts = c.mounts.filter((m) => Math.abs(m.z) > 0.45 * u);
  const podTop = new Map<MountSpec, number>();
  both((s) => {
    const m = armMounts.find((q) => Math.sign(q.z) === s);
    const az = m ? m.z : s * 0.66 * u, ax = m ? m.x : 0.06 * u;
    const shY = ty1 - 0.14 * u;
    const sh: V3 = [-0.12 * u, shY, s * 0.46 * u], el: V3 = [-0.12 * u, ty0 + 0.02 * u, az - s * 0.02 * u];
    const podW = Math.max(0.3 * u, (m?.r ?? 0.15) * 2.0);
    const top = mechArmHS(b, kit, s, sh, el, [ax + 0.08 * u, ty0 - 0.14 * u, az], 0.64 * u, podW, 0.26 * u, t * 0.6, fine);
    if (m) podTop.set(m, top);
    // pauldron: three overlapping plates stepping down and out over the shoulder drum
    for (let i = 0; i < 3; i++) {
      const a = 0.25 + i * 0.42;
      const F = frame([-0.15 * u, shY + 0.15 * u - i * 0.075 * u, s * (0.46 + i * 0.07) * u], [0, Math.cos(a), s * Math.sin(a)], [1, 0, 0]);
      armorPlate(b, kit, i === 1 ? kit.armor2 : kit.armor, F, trapP((0.48 - i * 0.05) * u, (0.4 - i * 0.06) * u, (0.24 - i * 0.02) * u, 0.04 * u), 0.04 * u, { standoff: 0.03 * u, gap: 0.03 * u });
      if (i === 0) b.g(new THREE.BoxGeometry(0.3 * u, 0.01 * u, 0.035 * u), kit.accent, F.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.075 * u, s * 0.0)));
    }
  });
  // ammo feed: armoured cable bundle from the backpack round to the right arm pod (asymmetric)
  const rm = armMounts.find((q) => q.z > 0);
  if (rm) cableBundle(b, kit, [-0.44 * u, ty0 + th * 0.2, 0.3 * u], [rm.x - 0.2 * u, ty0 - 0.02 * u, rm.z - 0.1 * u], 0.018 * u, [0, 1, 0], fine ? 2 : 1, 0.06);
  const hips: Hip[] | undefined = stance.legs === 'biped' ? ([-1, 1] as const).map((s) => ({
    p: [-0.03 * u, stance.hipY, s * 0.3 * u] as V3, side: s, t, foot: [-0.02 * u, 0, s * 0.34 * u] as V3, phase: s > 0 ? Math.PI : 0,
  })) : undefined;
  const deck = (x: number, z: number) => (Math.abs(z) < 0.42 * u && x > -0.5 * u && x < 0.38 * u ? ty1 : -1);
  return {
    deckAt: deck, top: ty1, hips, custom: true,
    seat: (m) => {
      const pt = podTop.get(m);
      if (pt !== undefined) return { y: wristRing(b, kit, m.x, pt, m.z, m.r), socket: true };
      // shoulder / back mount: on the torso top with a raised collar
      collar(b, kit, m.x, ty1 + 0.05 * u, m.z, m.r, ty1 - 0.04 * u, 16);
      return { y: ty1 + 0.05 * u, socket: true };
    },
  };
}

function orbwalker(c: ChassisCtx): ChassisOut {
  // Alien walker pod (chassis/hs-kit-organic.ts): an armoured abdomen built as a dark core under four shingled chitin
  // bands (each lifted at its rear lip) with a flat dorsal saddle for the twin mounts, a segmented tail spike ending in a
  // caged power node, a neck of stacked joint rings and sinew cables carrying a glass orb cockpit in a faceted armoured
  // bowl with three ribs over the canopy, mandibles under the orb, and armoured hip housings. Asymmetric: a sensor whip on
  // the left of the orb, a single sinew run down the right flank, one antenna fin on the left of the tail.
  const { b, kit, W, L, stance } = c;
  const u = Math.min(L, W) / 2;
  const fine = fineFor(c.S);
  const t = stance.thick || 0.13 * u;
  const by = stance.legs === 'spider' ? stance.hipY : stance.legs === 'biped' ? stance.hipY + 0.05 * u : stance.yt + 0.18 * u;
  if (stance.legs === null) {
    block(b, kit.mech, -0.15 * u, stance.y0 - 0.02, 0, 0.56 * u, 0.56 * u, by - stance.y0, { top: [0.8, 0.8], ch: 0.12 * u });
    b.cylb(kit.armor2, 0.4 * u, 0.08 * u, 0.02 * u, [-0.15 * u, stance.y0 + 0.02, 0], 'y', 8);
  }
  const ax = -0.2 * u, ay = by + 0.12 * u;
  const deckY = ay + 0.24 * u;
  // abdomen: dark core (teardrop, tapering to the rear) + chitin bands
  shell(b, kit.mech, ax, 0, 0.36 * u, 0.58 * u, 0.4 * u, [[ay - 0.16 * u, 0.6], [ay - 0.02 * u, 0.94], [ay + 0.12 * u, 0.92], [deckY - 0.04 * u, 0.62]], 8, 2.2);
  shingles(b, [kit.armor, kit.armor2], ax + 0.4 * u, ax - 0.66 * u, 4, 0.03 * u, (f) => [0.47 * u * (1 - f * f * 0.45), 0.13 * u * (1 - f * 0.3), ay + 0.03 * u - f * 0.05 * u], { cols: 5, pw: 2.6, drop: 0.13 * u, lift: 0.035 * u });
  // dorsal saddle: flat armour plate across the twin mounts on a dark riser
  block(b, kit.mech, ax - 0.08 * u, deckY - 0.08 * u, 0, 0.5 * u, 0.5 * u, 0.06 * u, { ch: 0.06 * u });
  armorPlate(b, kit, kit.shell, frame([ax - 0.08 * u, deckY - 0.03 * u, 0], [0, 1, 0], [1, 0, 0]), rectP(0.56 * u, 0.6 * u, 0.1 * u), 0.025 * u, { standoff: 0.005 * u });
  // flank glow slits between the bands
  for (const s of [-1, 1]) for (const f of [0.18, -0.08]) b.g(new THREE.BoxGeometry(0.03 * u, 0.02 * u, 0.1 * u), kit.glow, new THREE.Matrix4().makeRotationY(s * 0.3).setPosition(ax + f * u, ay + 0.04 * u, s * 0.44 * u));
  // tail spike: three tapering chitin segments up and back, a caged power node at the tip, an antenna fin (left)
  let tx = ax - 0.5 * u, tyy = ay + 0.06 * u;
  for (let i = 0; i < 3; i++) {
    const len = (0.2 - i * 0.03) * u, w = (0.09 - i * 0.02) * u;
    b.g(strutGeo([tx, tyy, 0], [tx - len, tyy + len * 0.65, 0], w * 0.7, w * 0.55, 5), kit.mech);
    archShell(b, i % 2 ? kit.armor2 : kit.armor, { x: tx - len * 0.5, len: len * 1.1, y0: tyy + len * 0.32, w: w * 1.05, h: w * 0.5, thick: 0.014 * u, cols: 3, pw: 1.8, drop: w * 0.4, lift: len * 0.6, rows: 2 });
    tx -= len; tyy += len * 0.65;
  }
  b.g(new THREE.OctahedronGeometry(0.045 * u, 0), kit.glow, new THREE.Matrix4().makeTranslation(tx - 0.02 * u, tyy + 0.02 * u, 0));
  for (const a of [0, Math.PI / 2]) b.g(new THREE.BoxGeometry(0.012 * u, 0.12 * u, 0.012 * u), kit.joint, new THREE.Matrix4().makeRotationX(a).setPosition(tx - 0.02 * u, tyy + 0.02 * u, 0));
  armorPlate(b, kit, kit.shell, frame([ax - 0.62 * u, ay + 0.2 * u, -0.05 * u], [0, 0.2, -1], [-1, 0.6, 0]), trapP(0.18 * u, 0.04 * u, 0.1 * u, 0.02 * u), 0.008 * u, { standoff: 0.002 * u, back: null });
  // neck: stacked joint rings (dark / gunmetal), two sinew cables from the abdomen into the orb bowl
  const hx = 0.4 * u, hy = by + 0.16 * u, hr = 0.3 * u;
  b.cylb(kit.joint, 0.16 * u, 0.3 * u, 0.025 * u, [0.04 * u, hy, 0], 'x', 10);
  for (const f of [0.08, 0.16, 0.24]) b.cyl(kit.mech, 0.19 * u, 0.19 * u, 0.03 * u, [f * u, hy, 0], 'x', 10);
  for (const s of [-1, 1]) hose(b, kit, [ax + 0.3 * u, ay + 0.16 * u, s * 0.14 * u], [hx - hr * 0.6, hy + hr * 0.35, s * hr * 0.4], 0.018 * u, 0.06, 3, s > 0 ? kit.joint : kit.rubber);
  // orb cockpit: faceted armoured bowl, glass canopy, three armour ribs arching over it, glow equator, sensor eye
  b.lathe(kit.armor, [[0, -hr * 0.85], [hr * 0.55, -hr * 0.82], [hr * 0.92, -hr * 0.45], [hr * 1.04, 0], [hr * 1.04, hr * 0.08], [0, hr * 0.08]], [hx, hy, 0], 'y', 10);
  b.lathe(kit.mech, [[hr * 0.6, -hr * 0.9], [hr * 0.78, -hr * 0.66], [hr * 0.5, -hr * 0.66], [hr * 0.3, -hr * 0.9]], [hx, hy, 0], 'y', 10);
  dome(b, kit.glass, [hx, hy + hr * 0.08, 0], hr * 0.94, hr * 0.9, 10, 3);
  // canopy spine: a thick faceted armour band front-to-back over the crown of the glass
  const oc: V3 = [hx, hy + hr * 0.08, 0];
  for (const zf of [0]) {
    const R0 = hr * 0.97, z0 = zf * R0, rr = Math.sqrt(R0 * R0 - z0 * z0), w = 0.07 * u;
    const rows: V3[][] = [];
    for (let i = 0; i <= 5; i++) {
      const th = 0.75 + (i / 5) * 2.2;
      rows.push([-1, 1].map((e) => [oc[0] + Math.cos(th) * rr, oc[1] + Math.sin(th) * rr * 0.93, z0 + e * w] as V3));
    }
    b.g(shellGeo(rows, 0.03 * u, (q) => { const d: V3 = [oc[0] - q[0], oc[1] - q[1], -q[2] * 0.3]; const l = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / l, d[1] / l, d[2] / l]; }), kit.armor);
  }
  b.lathe(kit.glow, [[hr * 0.98, -0.01], [hr * 1.07, -0.01], [hr * 1.07, 0.012 * u], [hr * 0.98, 0.012 * u]], [hx, hy + hr * 0.04, 0], 'y', 10);
  eyeCluster(b, kit, frame([hx + hr * 0.86, hy - hr * 0.3, 0], [0, 1, 0], [1, 0, 0]), [[0, 0, 0.05 * u], [0.09 * u, -0.03 * u, 0.025 * u], [-0.09 * u, -0.03 * u, 0.025 * u]]);
  b.g(strutGeo([hx - hr * 0.3, hy + hr * 0.5, -hr * 0.6], [hx - hr * 0.9, hy + hr * 1.4, -hr * 0.9], 0.006 * u, 0.003 * u, 4), kit.steel);
  // mandibles under the orb
  mandibles(b, kit, [hx + hr * 0.4, hy - hr * 0.62, 0], 0.32 * u, 0.04 * u, hr * 0.38, 0.3);
  // sinew run down the right flank (asymmetric)
  if (fine) cableBundle(b, kit, [ax + 0.3 * u, ay - 0.04 * u, 0.4 * u], [ax - 0.42 * u, ay - 0.02 * u, 0.34 * u], 0.014 * u, [0, 1, 0], 2, 0.06);
  // hips: 4 legs from armoured side housings, diagonal gait pairs
  let hips: Hip[] | undefined;
  if (stance.legs === 'spider') {
    hips = [];
    for (const [hx0, fx, fz, ph] of [[0.12, 0.78, 1.08, 0], [-0.42, -0.95, 1.02, Math.PI]] as [number, number, number, number][]) for (const s of [-1, 1] as const) {
      const p: V3 = [hx0 * u, by + 0.04 * u, s * 0.36 * u];
      hips.push({ p, side: s, t, foot: [fx * u, 0, s * fz * u], phase: ph + (s > 0 ? Math.PI : 0) });
      block(b, kit.mech, p[0], by - 0.12 * u, s * 0.3 * u, 0.24 * u, 0.18 * u, 0.28 * u, { ch: 0.05 * u });
      archShell(b, kit.armor2, { x: p[0], len: 0.3 * u, y0: by + 0.08 * u, w: 0.12 * u, h: 0.06 * u, thick: 0.022 * u, cz: s * 0.32 * u, cols: 3, drop: 0.12 * u, rows: 2 });
    }
  } else if (stance.legs === 'biped') {
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.15 * u, stance.hipY, s * 0.3 * u] as V3, side: s, t, foot: [-0.12 * u, 0, s * 0.34 * u] as V3, phase: s > 0 ? Math.PI : 0 }));
  }
  const deck = (x: number, z: number) => (Math.abs(z) < 0.36 * u && x > ax - 0.36 * u && x < ax + 0.3 * u ? deckY : -1);
  return {
    deckAt: deck, top: deckY, hips, custom: true, dressed: true,
    seat: (m) => { collar(b, kit, m.x, deckY + 0.03 * u, m.z, m.r, deckY - 0.02, 12); return { y: deckY + 0.03 * u, socket: true }; },
  };
}

// ---- Needle Frame (mantis) ---------------------------------------------------------------------------------------------
// A slim, fast strider built like a lance: one long low armoured fuselage (dark keel under a team-painted body with a
// spine plate stack), a shoulder yoke across the front carrying two armoured sponsons the guns sit on, a blunt sensor
// prow between them (visor slit under a brow plate, cheek plates) and a compact engine pack at the back (heat-sink fins,
// exhaust glow). Every gun rides on solid hull; nothing hangs off struts.
function needle(c: ChassisCtx): ChassisOut {
  const { b, kit, W, L, stance } = c;
  const k = Math.min(W, L / 2); // authored for the 1 x 2 frame
  const biped = stance.legs === 'biped', spider = stance.legs === 'spider';
  const bp = biped ? stance.hipY - 0.04 * k : spider ? stance.hipY + 0.02 * k : stance.y0 + 0.1 * k;
  const bodyH = 0.17 * k, top = bp + bodyH;
  // fuselage: dark keel, team body tapering to the tail, spine plates, a light belly shell between the hips
  block(b, kit.mech, -0.04 * k, bp - 0.05 * k, 0, 1.2 * k, 0.24 * k, 0.07 * k, { top: [0.9, 0.9], ch: 0.06 * k, bev: 0.01 * k });
  block(b, kit.hull, -0.02 * k, bp, 0, 1.24 * k, 0.34 * k, bodyH, { top: [0.92, 0.78], shift: [0.03 * k, 0], ch: 0.1 * k, bev: 0.025 * k, bot: 0.02 * k });
  plateStack(b, kit, kit.armor2, frame([-0.06 * k, top, 0], [0, 1, 0], [1, 0, 0]), trapP(0.8 * k, 0.16 * k, 0.2 * k, 0.04 * k), [
    { inset: 0, thick: 0.02 * k, standoff: 0.006 * k },
    { inset: 0.03 * k, thick: 0.016 * k, shift: [-0.06 * k, 0], mat: kit.armor },
  ], { gap: 0.012 * k });
  for (const s of [-1, 1]) armorPlate(b, kit, kit.shell, frame([-0.12 * k, bp + bodyH * 0.45, s * 0.17 * k], [0, 0, s], [1, 0, 0]), rectP(0.6 * k, bodyH * 0.6, 0.03 * k), 0.014 * k, { standoff: 0.006 * k });
  glow(b, kit, -0.1 * k, top + 0.044 * k, 0, 0.3 * k, 0.008 * k, 0.02 * k);
  // shoulder yoke: a solid crossbeam the sponsons hang from, low on the fuselage's front third
  const yx = 0.5 * k;
  block(b, kit.mech, yx, bp + 0.01 * k, 0, 0.22 * k, 0.74 * k, 0.11 * k, { top: [0.9, 0.95], ch: 0.04 * k, bev: 0.012 * k });
  // sponsons: an armoured box under each gun with a lid plate; the gun's collar sits on the lid
  const seats = new Map<MountSpec, number>();
  both((s) => {
    const m = c.mounts.find((q) => Math.sign(q.z) === s && Math.abs(q.z) > 0.15 * k);
    const mx = m ? m.x : 0.54 * k, mz = m ? m.z : s * 0.295 * k;
    block(b, kit.hull, mx - 0.02 * k, bp - 0.02 * k, mz, 0.34 * k, 0.24 * k, bodyH + 0.02 * k, { top: [0.82, 0.84], shift: [-0.02 * k, 0], ch: 0.06 * k, bev: 0.02 * k, bot: 0.02 * k });
    armorPlate(b, kit, kit.armor2, frame([mx - 0.03 * k, bp + bodyH * 0.5, mz + s * 0.12 * k], [0, 0, s], [1, 0, 0]), trapP(0.3 * k, bodyH * 0.8, bodyH * 0.9, 0.03 * k), 0.016 * k, { standoff: 0.006 * k });
    b.box(kit.joint, 0.05 * k, 0.03 * k, 0.03 * k, mx + 0.15 * k, bp + bodyH * 0.55, mz, 0.008 * k); // nose lamp housing
    glow(b, kit, mx + 0.17 * k, bp + bodyH * 0.55, mz, 0.008 * k, 0.014 * k, 0.03 * k);
    if (m) seats.set(m, top);
  });
  // sensor prow: blunt, low and wide (reads as a head, not a barrel): dark core, brow plate over a visor slit, cheeks
  const px = 0.76 * k;
  block(b, kit.mech, px, bp, 0, 0.22 * k, 0.24 * k, 0.13 * k, { top: [0.7, 0.85], shift: [-0.03 * k, 0], ch: 0.07 * k, bev: 0.015 * k });
  plateStack(b, kit, kit.armor, frame([px - 0.03 * k, bp + 0.13 * k, 0], [0.35, 1, 0], [1, 0, 0]), trapP(0.18 * k, 0.18 * k, 0.26 * k, 0.04 * k), [
    { inset: 0, thick: 0.018 * k, standoff: 0.006 * k },
  ], { gap: 0.01 * k });
  b.box(kit.glow, 0.012 * k, 0.018 * k, 0.17 * k, px + 0.1 * k, bp + 0.075 * k, 0, 0.004 * k);
  for (const s of [-1, 1]) armorPlate(b, kit, kit.armor2, frame([px, bp + 0.065 * k, s * 0.12 * k], [0.3, 0, s], [1, 0, 0]), trapP(0.17 * k, 0.1 * k, 0.12 * k, 0.025 * k), 0.012 * k, { standoff: 0.004 * k, back: null });
  // engine pack: a squat armoured box over the tail with heat-sink fins and an exhaust glow (balances the guns up front)
  const ex = -0.62 * k;
  block(b, kit.mech, ex, bp + 0.02 * k, 0, 0.3 * k, 0.3 * k, bodyH + 0.04 * k, { top: [0.86, 0.86], ch: 0.06 * k, bev: 0.015 * k });
  armorPlate(b, kit, kit.armor, frame([ex + 0.02 * k, bp + bodyH + 0.06 * k, 0], [0, 1, 0], [1, 0, 0]), trapP(0.24 * k, 0.24 * k, 0.24 * k, 0.04 * k), 0.016 * k, { standoff: 0.006 * k, back: null });
  for (const s of [-1, 1]) for (const f of [-0.06, 0.02, 0.1]) b.box(kit.joint, 0.03 * k, 0.07 * k, 0.012 * k, ex + f * k, bp + 0.1 * k, s * 0.16 * k, 0.003 * k);
  b.box(kit.hot, 0.01 * k, 0.05 * k, 0.16 * k, ex - 0.155 * k, bp + 0.1 * k, 0, 0.004 * k);
  let hips: Hip[] | undefined;
  if (biped) {
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.1 * k, stance.hipY, s * 0.13 * k] as V3, side: s, t: stance.thick, foot: [-0.08 * k, 0, s * 0.17 * k] as V3, phase: s > 0 ? Math.PI : 0 }));
  } else if (spider) {
    hips = [];
    for (const [hx2, fx, fz, ph] of [[0.06, 0.42, 0.55, 0], [-0.24, -0.66, 0.5, Math.PI]] as [number, number, number, number][]) for (const s of [-1, 1] as const) {
      hips.push({ p: [hx2 * k, stance.hipY, s * 0.1 * k], side: s, t: stance.thick, foot: [fx * k, 0, s * fz * k], phase: ph + (s > 0 ? Math.PI : 0) });
    }
  }
  return {
    deckAt: (x, z) => (Math.abs(z) < 0.15 * k && x > -0.45 * k && x < 0.4 * k ? top : -1), top: top + 0.06 * k, hips, custom: true,
    seat: (m) => {
      const y = seats.get(m) ?? top;
      collar(b, kit, m.x, y + 0.012 * k, m.z, m.r, y - 0.02 * k, 10);
      return { y: y + 0.012 * k, socket: true };
    },
  };
}

// ---- Warlord Mech -------------------------------------------------------------------------------------------------------
// A hunched heavy brute (hard-surface: dark skeleton + layered armour, see chassis/hs-kit.ts): a dark pelvis frame with a
// codpiece and tassets, an exposed spine column with stabiliser rams, a barrel chest built as a dark faceted core under a
// three-layer chest stack and side shells, a sunken head (two eyes under an overhanging brow stack), the chin gun on a
// jutting jaw ledge, the main cannon on a dorsal hump (a thick faceted shell over a dark core), massive four-plate
// pauldrons, long arms on joint drums ending in forearm gauntlets that carry the arm weapons, and a reactor drum across
// the back feeding coolant hoses into the torso. Asymmetric: a sensor mast on the left pauldron, one tall exhaust on the
// left of the reactor and a muffler box on the right, a ladder up the right of the back, the hazard band on the right
// pauldron.
function warlord(c: ChassisCtx): ChassisOut {
  const { b, kit, W, L, stance } = c;
  const k = Math.min(W / 4, L / 3);
  const fine = fineFor(c.S);
  const biped = stance.legs === 'biped';
  const t = biped ? stance.thick : 0.24 * k;
  let pelvisY: number;
  if (biped) pelvisY = stance.hipY;
  else {
    pelvisY = stance.legs === 'spider' ? stance.hipY + 0.4 * k : stance.y0 + 0.55 * k;
    // pedestal: dark turntable drum with an armour skirt ring the torso turns on
    b.cylb(kit.mech, 0.62 * k, pelvisY - stance.y0 + 0.02, 0.06 * k, [-0.1 * k, stance.y0 - 0.02, 0], 'y', 12);
    b.cylb(kit.armor2, 0.7 * k, 0.12 * k, 0.03 * k, [-0.1 * k, pelvisY - 0.3 * k, 0], 'y', 12);
  }
  // ---- pelvis: dark frame block between the hip drums, armoured codpiece, two tassets
  block(b, kit.mech, -0.12 * k, pelvisY - 0.28 * k, 0, 0.66 * k, 0.76 * k, 0.48 * k, { top: [0.86, 1.06], ch: 0.12 * k, bev: 0.025 * k });
  armorPlate(b, kit, kit.armor, frame([0.24 * k, pelvisY - 0.1 * k, 0], [1, -0.3, 0], [0, 0, 1]), trapP(0.5 * k, 0.32 * k, 0.5 * k, 0.06 * k), 0.07 * k, { standoff: 0.03 * k });
  both((s) => armorPlate(b, kit, kit.armor2, frame([0.04 * k, pelvisY - 0.18 * k, s * 0.4 * k], [0.4, -0.2, s], [0, 1, 0]), rectP(0.36 * k, 0.36 * k, 0.05 * k), 0.05 * k, { standoff: 0.02 * k }));
  // ---- spine column (waist) + stabiliser rams
  b.cylb(kit.joint, 0.2 * k, 0.3 * k, 0.03 * k, [-0.15 * k, pelvisY + 0.02 * k, 0], 'y', 12);
  b.cyl(kit.mech, 0.3 * k, 0.3 * k, 0.06 * k, [-0.15 * k, pelvisY + 0.12 * k, 0], 'y', 12);
  both((s) => piston(b, kit, [0.08 * k, pelvisY - 0.05 * k, s * 0.26 * k], [0.06 * k, pelvisY + 0.3 * k, s * 0.24 * k], 0.045 * k, 0.55, fine));
  const ty0 = pelvisY + 0.22 * k, th = 0.95 * k, ty1 = ty0 + th;
  // ---- barrel chest: dark faceted core (hunched forward), chest stack, side shells, belly plate
  b.loft(kit.mech, [
    hexSec(-0.62 * k, ty0 + 0.04 * k, 0.5 * k, 0.62 * k, ty0 + 0.2 * k, ty1 - 0.32 * k, 0.4 * k, ty1 - 0.08 * k),
    hexSec(0.0, ty0, 0.6 * k, 0.76 * k, ty0 + 0.18 * k, ty1 - 0.26 * k, 0.5 * k, ty1),
    hexSec(0.46 * k, ty0 + 0.04 * k, 0.5 * k, 0.66 * k, ty0 + 0.2 * k, ty1 - 0.3 * k, 0.42 * k, ty1 - 0.12 * k),
  ]);
  // chest outline: x across the chest, z up it (narrower at the top)
  const chest: P2[] = [[-0.5, -0.36], [0.5, -0.36], [0.56, 0.12], [0.36, 0.4], [-0.36, 0.4], [-0.56, 0.12]].map(([x, z]) => [x * k, z * k] as P2);
  plateStack(b, kit, kit.armor, frame([0.52 * k, ty0 + th * 0.5, 0], [0.9, 0.42, 0], [0, 0, 1]), chest, [
    { inset: 0, thick: 0.08 * k, standoff: 0.04 * k },
    { inset: 0.09 * k, thick: 0.06 * k, shift: [0, 0.03 * k], mat: kit.armor2 },
    { inset: 0.22 * k, thick: 0.05 * k, shift: [0, 0.06 * k] },
  ], { gap: 0.05 * k });
  both((s) => {
    armorPlate(b, kit, kit.armor, frame([-0.08 * k, ty0 + th * 0.5, s * 0.78 * k], [0, 0.15, s], [1, 0, 0]), trapP(0.92 * k, th * 0.62, th * 0.78, 0.08 * k), 0.07 * k, { standoff: 0.03 * k });
    armorPlate(b, kit, kit.armor2, frame([-0.12 * k, ty0 + th * 0.48, s * 0.86 * k], [0, 0.1, s], [1, 0, 0]), rectP(0.5 * k, th * 0.36, 0.05 * k), 0.05 * k, { standoff: 0.01 * k });
  });
  armorPlate(b, kit, kit.armor2, frame([0.4 * k, ty0 + 0.04 * k, 0], [0.7, -0.6, 0], [0, 0, 1]), rectP(0.8 * k, 0.24 * k, 0.05 * k), 0.06 * k, { standoff: 0.02 * k });
  // ---- jaw ledge (chin gun seat): dark bracket under an armour shelf with a hazard lip
  const jawY = ty0 + 0.36 * k;
  block(b, kit.mech, 0.58 * k, ty0 + 0.02 * k, 0, 0.36 * k, 0.56 * k, jawY - ty0 - 0.08 * k, { top: [0.9, 0.86], ch: 0.08 * k, bev: 0.02 * k });
  armorPlate(b, kit, kit.armor, frame([0.6 * k, jawY - 0.07 * k, 0], [0, 1, 0], [1, 0, 0]), trapP(0.46 * k, 0.5 * k, 0.66 * k, 0.1 * k), 0.06 * k, { standoff: 0.01 * k });
  hazard(b, kit, 0.82 * k, ty0 + 0.12 * k, 0, 0.06 * k, 0.4 * k, 4, Math.PI / 2);
  // ---- dorsal hump (main cannon platform): dark core block + thick faceted shell with a raised rear lip
  block(b, kit.mech, -0.28 * k, ty1 - 0.2 * k, 0, 0.9 * k, 0.9 * k, 0.36 * k, { top: [0.8, 0.8], ch: 0.15 * k, bev: 0.03 * k });
  const humpY = ty1 + 0.24 * k;
  archShell(b, kit.armor, { x: -0.28 * k, len: 1.05 * k, y0: ty1 - 0.04 * k, w: 0.62 * k, h: 0.26 * k, thick: 0.06 * k, cols: 4, pw: 3, taperF: 0.86, taperB: 0.94, lift: 0.04 * k, drop: 0.1 * k });
  // ---- sunken head: dark core, two eyes, an overhanging brow stack, cheek guards
  const hy = ty1 - 0.36 * k;
  block(b, kit.mech, 0.36 * k, hy, 0, 0.42 * k, 0.48 * k, 0.32 * k, { top: [0.7, 0.8], ch: 0.08 * k, bev: 0.02 * k });
  eyeCluster(b, kit, frame([0.58 * k, hy + 0.18 * k, 0], [0, 1, 0], [1, 0, 0]), [[-0.1 * k, 0, 0.04 * k], [0.1 * k, 0, 0.04 * k]]);
  plateStack(b, kit, kit.armor, frame([0.42 * k, hy + 0.3 * k, 0], [0.25, 1, 0], [1, 0, 0]), trapP(0.5 * k, 0.5 * k, 0.66 * k, 0.1 * k), [
    { inset: 0, thick: 0.06 * k, standoff: 0.02 * k },
    { inset: 0.06 * k, thick: 0.05 * k, shift: [-0.04 * k, 0], mat: kit.armor2 },
  ], { gap: 0.04 * k });
  both((s) => armorPlate(b, kit, kit.armor2, frame([0.44 * k, hy + 0.12 * k, s * 0.26 * k], [0.3, 0, s], [1, 0, 0]), trapP(0.34 * k, 0.16 * k, 0.26 * k, 0.04 * k), 0.04 * k, { standoff: 0.01 * k }));
  // ---- reactor drum across the back: dark drum, glowing end caps behind cage ribs, coolant hoses into the torso
  const rx = -0.82 * k, ry = ty0 + 0.42 * k;
  b.cylb(kit.joint, 0.3 * k, 1.1 * k, 0.05 * k, [rx, ry, -0.55 * k], 'z', 12);
  for (const f of [-0.3, 0, 0.3]) b.cyl(kit.mech, 0.32 * k, 0.32 * k, 0.05 * k, [rx, ry, f * k], 'z', 12);
  both((s) => {
    b.cyl(kit.glow, 0.2 * k, 0.2 * k, 0.03 * k, [rx, ry, s * 0.56 * k], s > 0 ? 'z' : '-z', 10);
    for (const a of [Math.PI / 4, -Math.PI / 4]) b.g(new THREE.BoxGeometry(0.46 * k, 0.04 * k, 0.04 * k), kit.mech, new THREE.Matrix4().makeRotationZ(a).setPosition(rx, ry, s * 0.6 * k));
    cableBundle(b, kit, [rx + 0.12 * k, ry + 0.2 * k, s * 0.4 * k], [-0.5 * k, ty1 - 0.25 * k, s * 0.42 * k], 0.03 * k, [0, 0, 1], fine ? 2 : 1, 0.08);
  });
  exhaust(b, kit, rx - 0.04 * k, ty0 + 0.66 * k, -0.3 * k, 0.07 * k, 0.42 * k);
  exhaustBox(b, kit, frame([rx + 0.02 * k, ry + 0.3 * k, 0.32 * k], [0, 1, 0], [-1, 0, 0]), 0.09 * k, fine);
  if (fine) ladder(b, kit, [-0.7 * k, ty0 + 0.1 * k, 0.5 * k], [-0.58 * k, ty1, 0.5 * k], 0.16 * k, [0, 0, 1], [-1, 0, 0], 0.03 * k);
  crewHatch(b, kit, frame([-0.62 * k, ty1 - 0.06 * k, -0.28 * k], [-0.3, 1, 0]), 0.09 * k, fine);
  // ---- pauldrons + arms with forearm gauntlets carrying the arm weapons
  const armM = c.mounts.filter((m) => Math.abs(m.z) > 0.9 * k);
  const podTop = new Map<MountSpec, number>();
  both((s) => {
    const m = armM.find((q) => Math.sign(q.z) === s);
    const az = m ? m.z : s * 1.34 * k, ax = m ? m.x : 0.11 * k;
    const melee = !!m && (m.mod.category === 'melee' || m.mod.projectile === 'melee');
    const shY = ty1 - 0.24 * k;
    const podL = 1.05 * k, podW = Math.max(0.5 * k, (m?.r ?? 0.39 * k) * 2.0), podH = 0.42 * k;
    const px = melee ? ax - podL * 0.2 : ax + 0.15 * k;
    const top = mechArmHS(b, kit, s, [-0.12 * k, shY, s * 0.92 * k], [-0.2 * k, ty0 - 0.02 * k, az - s * 0.04 * k], [px, ty0 - 0.62 * k, az], podL, podW, podH, 0.17 * k, fine);
    if (m) podTop.set(m, top);
    // knuckles: three armoured fingers (dark bone + armour cap) curled under the gauntlet nose; spread as a claw with a
    // melee tool
    for (const dz of [-0.3, 0, 0.3]) {
      const f0: V3 = [px + podL * 0.42, ty0 - 0.5 * k, az + dz * podW];
      const f1: V3 = [f0[0] + (melee ? 0.34 : 0.12) * k, f0[1] - (melee ? 0.1 : 0.2) * k, f0[2] + dz * (melee ? 0.3 : 0.05) * k];
      b.g(strutGeo(f0, f1, 0.05 * k, 0.045 * k, 6), kit.mech);
      claw(b, kit.joint, f1, [f1[0] + 0.08 * k, f1[1] - 0.06 * k, f1[2]], [f1[0] + 0.1 * k, f1[1] - 0.16 * k, f1[2]], 0.045 * k);
    }
    // pauldron: four overlapping plates stepping down and out over the shoulder drum, accent stripe on the top plate
    for (let i = 0; i < 4; i++) {
      const a = 0.18 + i * 0.36;
      const F = frame([-0.14 * k, shY + 0.34 * k - i * 0.12 * k, s * (1.0 + i * 0.1) * k], [0, Math.cos(a), s * Math.sin(a)], [1, 0, 0]);
      armorPlate(b, kit, i % 2 ? kit.armor2 : kit.armor, F, trapP((0.82 - i * 0.07) * k, (0.62 - i * 0.07) * k, (0.4 - i * 0.04) * k, 0.07 * k), 0.07 * k, { standoff: 0.04 * k, gap: 0.05 * k });
      if (i === 0) b.g(new THREE.BoxGeometry(0.56 * k, 0.012 * k, 0.06 * k), kit.accent, F.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.112 * k, 0)));
    }
    // shoulder frame under the pauldron (the plates hang off it)
    b.g(strutGeo([-0.14 * k, shY + 0.1 * k, s * 0.7 * k], [-0.14 * k, shY + 0.26 * k, s * 1.08 * k], 0.06 * k, 0.05 * k, 6), kit.mech);
  });
  // asymmetric kit: a sensor mast on the left pauldron, hazard band on the right
  b.strut(kit.joint, [-0.3 * k, ty1 + 0.2 * k, -1.02 * k], [-0.45 * k, ty1 + 0.85 * k, -1.08 * k], 0.025 * k, 0.012 * k, 5);
  sensor(b, kit, -0.42 * k, ty1 + 0.72 * k, -1.07 * k, 0.1 * k, kit.lamp);
  hazard(b, kit, -0.12 * k, ty1 + 0.22 * k, 1.04 * k, 0.5 * k, 0.16 * k, 4, 0);
  const hips: Hip[] | undefined = biped ? ([-1, 1] as const).map((s) => ({
    p: [-0.15 * k, stance.hipY, s * 0.6 * k] as V3, side: s, t, foot: [-0.12 * k, 0, s * 0.72 * k] as V3, phase: s > 0 ? Math.PI : 0,
  })) : stance.legs === 'spider' ? (() => {
    const out: Hip[] = [];
    for (const [hx, fx, ph] of [[0.25, 0.95, 0], [-0.5, -1.25, Math.PI]] as [number, number, number][]) for (const s of [-1, 1] as const) {
      out.push({ p: [hx * k, stance.hipY, s * 0.5 * k], side: s, t: stance.thick, foot: [fx * k, 0, s * 1.35 * k], phase: ph + (s > 0 ? Math.PI : 0) });
    }
    return out;
  })() : undefined;
  const deck = (x: number, z: number) => (Math.abs(z) < 0.6 * k && x > -0.7 * k && x < 0.4 * k ? ty1 : -1);
  return {
    deckAt: deck, top: humpY, hips, custom: true, dressed: true,
    seat: (m) => {
      const pt = podTop.get(m);
      if (pt !== undefined) return { y: wristRing(b, kit, m.x, pt, m.z, m.r, 14), socket: true };
      if (m.x > 0.4 * k) { collar(b, kit, m.x, jawY, m.z, m.r, jawY - 0.08 * k, 14); return { y: jawY, socket: true }; }
      collar(b, kit, m.x, humpY, m.z, m.r, humpY - 0.2 * k, 16);
      return { y: humpY, socket: true };
    },
  };
}

registerChassis('mech', strider);
registerChassis('mantis', needle);
registerChassis('warlord', warlord);
registerChassis('arachnid', orbwalker);
