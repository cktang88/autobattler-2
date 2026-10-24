// Creature-machine hulls (mechanical, not literal animals; think salvage-robot fauna and droid crawlers), built with the
// hard-surface kit (chassis/hs-kit.ts) and its organic extension (chassis/hs-kit-organic.ts): dark structural cores,
// separate armour with real thickness on shadow gaps, exposed joint drums, rams and sinew cables, parts in named slots.
//   * Bunker Crawler (crab):  a wide, low pillbox on legs: wall plates around a dark core, an overhanging roof shell with
//                             a vision-block hatch ring, a heavy brow over a glowing visor band, two excavator arms
//                             reaching forward to big fist housings that carry the guns.
//   * Tailgun Crawler (scorpion): a long armadillo of shingled carapace bands with a wedge prow; a box-section crane
//                             boom on lift rams rises from mid-back and arches over the rear to cradle the heavy weapon;
//                             two pincer arms out front.
//   * Saucer Disc (saucer):   a disc with a ring of separate armour petals over a glowing rim band, a raised turret
//                             plateau and a ribbed cockpit canopy; on legs it becomes a tripod.
//   * Landtrain (centipede):  an articulated armoured train: a locomotive (hood, cab, plough on rams, caged lamps), four
//                             plated gun cars that sway on their couplers (animated groups), and a caboose.
// Shared helpers: superellipse-plan shells (planRing / shell) and forward-reaching manipulator arms (reachArmHS) whose
// wrist housing carries a weapon; melee weapons get an open jaw so the tool reads as a claw at the end of an arm.

import * as THREE from 'three';
import { aim, Bld, strutGeo, type MatLike, type P2, type V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { block, both, collar, dome, exhaust, glow, hazard } from './shapes.ts';
import {
  antenna, armorPlate, cableBundle, cagedLamp, crewHatch, exhaustBox, fineFor, frame, frameLimb, hexSec, hose, inset, jointDrum, piston, plateStack, recessPanel,
  rectP, smokeLaunchers, stowBox, sub, trapP, visionBlocks,
} from './hs-kit.ts';
import { boneFrame, claw, eyeCluster, limbSegs, limbShell, quadPlate, shellGeo, shingles } from './hs-kit-organic.ts';

/** point a fraction f from a to c, plus an offset */
const mid3 = (a: V3, c: V3, f: number, off: V3 = [0, 0, 0]): V3 => [a[0] + (c[0] - a[0]) * f + off[0], a[1] + (c[1] - a[1]) * f + off[1], a[2] + (c[2] - a[2]) * f + off[2]];

// ---- shared shape helpers ---------------------------------------------------------------------------------------------

/** superellipse ring in the XZ plane at height y: front half-length rxF, rear half-length rxB, half-width rz */
export function planRing(cx: number, y: number, cz: number, rxF: number, rxB: number, rz: number, n = 12, pw = 2.4, prow = false): V3[] {
  const out: V3[] = [];
  const e = 2 / pw;
  for (let i = 0; i < n; i++) {
    // half-step offset: a flat facet faces forward (reads as a plate); prow = a vertex points forward instead
    const a = ((i + (prow ? 0 : 0.5)) / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const x = Math.sign(c) * Math.pow(Math.abs(c), e) * (c > 0 ? rxF : rxB);
    out.push([cx + x, y, cz - Math.sign(s) * Math.pow(Math.abs(s), e) * rz]);
  }
  return out;
}

/** Shell: a loft of plan rings. levels = [y, scale, dx?]; scale shrinks the ring about its centre (dx shifts it). */
export function shell(b: Bld, mat: MatLike, cx: number, cz: number, rxF: number, rxB: number, rz: number, levels: [number, number, number?][], n = 12, pw = 2.4, prow = false): void {
  b.loft(mat, levels.map(([y, k, dx]) => planRing(cx + (dx ?? 0), y, cz, rxF * k, rxB * k, rz * k, n, pw, prow)));
}

/** cheap unbevelled box (12 tris) for tiny parts: glow chips, fins, strips */
export function tbox(b: Bld, mat: MatLike, w: number, h: number, d: number, x: number, y: number, z: number, rot?: V3): void {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...(rot ?? [0, 0, 0])));
  b.g(new THREE.BoxGeometry(w, h, d), mat, m.setPosition(x, y, z));
}
/** cheap unbevelled beam from a to c (w across, h along up) */
export function tbeam(b: Bld, mat: MatLike, a: V3, c: V3, w: number, h: number, up: V3 = [0, 1, 0]): void {
  const d: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  b.g(new THREE.BoxGeometry(w, h, len).translate(0, 0, len / 2), mat, aim(a, d, up));
}

/** slim wrist ring a turret sits in on an arm / fist housing (a full collar reads as a plate stuck on the arm) */
export function wristRing(b: Bld, kit: Kit, x: number, y: number, z: number, r: number, seg = 12): number {
  b.lathe(kit.trim, [[0, -r * 0.14], [r * 1.02, -r * 0.14], [r * 1.06, -r * 0.06], [r * 1.06, r * 0.04], [0, r * 0.04]], [x, y, z], 'y', seg);
  return y + r * 0.04;
}

export const isMelee = (m?: MountSpec) => !!m && (m.mod.category === 'melee' || m.mod.projectile === 'melee');

export interface ArmOpts {
  /** arm thickness */
  t: number;
  /** wrist housing length / width / height */
  podL: number; podW: number; podH: number;
  /** jaw prongs ahead of the housing (melee tools read as claws) */
  jaw?: boolean;
  /** shoulder drum radius factor */
  drum?: number;
}

/**
 * Hard-surface manipulator arm (chassis/hs-kit.ts): shoulder joint drum, a dark twin-strut upper arm under an armour
 * shell, a hydraulic ram under it, elbow drum, twin-strut forearm under a second shell, and a wrist housing (dark core,
 * armour lid the weapon seats on, outer cheek plate, team glow) at wr (pod centre, bottom at wr[1]). Melee tools get an
 * open jaw (two hooked prongs); guns get a knuckle cuff. organic: chitin shells (limbShell) and sinew cables instead of
 * the flat plates and the ram. Returns the housing top height (the weapon seat).
 */
export function reachArmHS(b: Bld, kit: Kit, side: number, sh: V3, el: V3, wr: V3, o: ArmOpts & { fine?: boolean; organic?: boolean }): number {
  const { t, podL, podW, podH } = o;
  const fine = o.fine ?? true;
  const dr = t * (o.drum ?? 1.2);
  jointDrum(b, kit, sh, dr, t * 1.6, 'z');
  // upper arm: skeleton + shell (+ ram underneath)
  frameLimb(b, kit, sh, el, t * 0.26, [t * 0.36, 0, 0]);
  const ua = boneFrame(sh, el, [0, 1, 0]);
  const lu = Math.hypot(el[0] - sh[0], el[1] - sh[1], el[2] - sh[2]);
  if (o.organic) {
    limbShell(b, kit.armor, lu * 0.12, lu * 0.9, t * 0.9, t * 0.4, t * 0.3, t * 0.22, { m: ua, tp: 0.8 });
    cableBundle(b, kit, [sh[0] + t * 0.3, sh[1] - t * 0.7, sh[2]], [el[0], el[1] - t * 0.6, el[2]], t * 0.09, [1, 0, 0], 1, 0.06);
  } else {
    armorPlate(b, kit, kit.armor, ua.clone().multiply(new THREE.Matrix4().makeTranslation(0, t * 0.32, lu * 0.5)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)), trapP(lu * 0.72, t * 1.25, t * 1.5, t * 0.2), t * 0.2, { standoff: t * 0.08 });
    piston(b, kit, [sh[0] + t * 0.3, sh[1] - t * 0.75, sh[2]], [el[0] - t * 0.2, el[1] - t * 0.65, el[2]], t * 0.2, 0.55, fine);
  }
  // elbow: plain drum with a dark hub (the shoulder carries the full joint drum)
  b.cylb(kit.joint, t * 0.85, t * 1.4, t * 0.1, [el[0], el[1], el[2] - t * 0.7], 'z', 10);
  b.cyl(kit.mech, t * 0.5, t * 0.5, t * 1.6, [el[0], el[1], el[2] - t * 0.8], 'z', 6);
  // forearm down to the wrist
  const wt: V3 = [wr[0] - podL * 0.3, wr[1] + podH * 0.5, wr[2]];
  frameLimb(b, kit, el, wt, t * 0.24, [t * 0.32, 0, 0]);
  const fa = boneFrame(el, wt, [1, 0.6, 0]);
  const lf = Math.hypot(wt[0] - el[0], wt[1] - el[1], wt[2] - el[2]);
  if (o.organic) limbSegs(b, [kit.armor2, kit.armor], lf * 0.08, lf * 0.86, 2, t * 0.85, t * 0.36, t * 0.3, t * 0.2, 0.8, 3, fa);
  else armorPlate(b, kit, kit.armor2, fa.clone().multiply(new THREE.Matrix4().makeTranslation(0, t * 0.3, lf * 0.48)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)), trapP(lf * 0.74, t * 1.0, t * 1.3, t * 0.18), t * 0.18, { standoff: t * 0.08 });
  // wrist housing: dark core, armour lid, outer cheek plate, glow strip
  block(b, kit.mech, wr[0], wr[1], wr[2], podL * 0.92, podW * 0.82, podH * 0.74, { top: [0.9, 0.9], ch: podW * 0.14, bev: podH * 0.05 });
  const lid = wr[1] + podH * 0.74;
  const lt = podH * 0.14, ls = podH * 0.04;
  armorPlate(b, kit, kit.armor, frame([wr[0] - podL * 0.02, lid, wr[2]], [0, 1, 0], [1, 0, 0]), trapP(podL, podW * 0.8, podW, podW * 0.14), lt, { standoff: ls, gap: podW * 0.06 });
  armorPlate(b, kit, kit.armor2, frame([wr[0] - podL * 0.04, wr[1] + podH * 0.4, wr[2] + side * podW * 0.41], [0, 0, side], [1, 0, 0]), rectP(podL * 0.8, podH * 0.5, podH * 0.08), podH * 0.1, { standoff: podH * 0.03 });
  glow(b, kit, wr[0] + podL * 0.08, wr[1] + podH * 0.2, wr[2] + side * podW * 0.47, podL * 0.34, podH * 0.05, podW * 0.04);
  if (o.jaw) {
    // open jaw: two heavy hooked prongs ahead of the fist, upper and lower, a ram between them
    for (const dy of [-1, 1]) {
      const a: V3 = [wr[0] + podL * 0.4, wr[1] + podH * (0.45 + dy * 0.22), wr[2]];
      const k: V3 = [wr[0] + podL * 0.8, wr[1] + podH * (0.45 + dy * 0.55), wr[2] + side * podW * 0.08];
      const tip: V3 = [wr[0] + podL * 1.05, wr[1] + podH * (0.45 + dy * 0.2), wr[2] + side * podW * 0.1];
      b.g(strutGeo(a, k, podH * 0.16, podH * 0.13, 5), kit.mech);
      claw(b, kit.joint, k, [k[0] + podL * 0.12, k[1] - dy * podH * 0.05, k[2]], tip, podH * 0.12);
      armorPlate(b, kit, kit.armor2, boneFrame(a, k, [0, dy, 0]).multiply(new THREE.Matrix4().makeTranslation(0, podH * 0.1, podL * 0.2)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)), trapP(podL * 0.36, podH * 0.24, podH * 0.34, podH * 0.05), podH * 0.06, { standoff: podH * 0.02, back: null });
    }
    piston(b, kit, [wr[0] + podL * 0.3, wr[1] + podH * 0.45, wr[2] - side * podW * 0.3], [wr[0] + podL * 0.62, wr[1] + podH * 0.78, wr[2] - side * podW * 0.2], podH * 0.07, 0.55, fine);
  } else {
    // knuckle cuff: a sloped armour plate over the fist nose on a dark bracket
    block(b, kit.mech, wr[0] + podL * 0.44, wr[1] + podH * 0.08, wr[2], podL * 0.14, podW * 0.8, podH * 0.62, { ch: podW * 0.1 });
    armorPlate(b, kit, kit.armor, frame([wr[0] + podL * 0.52, wr[1] + podH * 0.4, wr[2]], [1, 0.35, 0], [0, 0, 1]), rectP(podW * 0.86, podH * 0.62, podH * 0.1), podH * 0.1, { standoff: podH * 0.02 });
  }
  return lid + ls + lt;
}

// ---- Bunker Crawler ---------------------------------------------------------------------------------------------------

/** outward wall faces of an octagonal plan ring (planRing n=8) at heights y0..y1: centre, outward normal, edge vector */
function ringFaces(cx: number, cz: number, rxF: number, rxB: number, rz: number, y0: number, y1: number, n = 8, pw = 2): { c: V3; n: V3; e: V3; w: number }[] {
  const r = planRing(cx, 0, cz, rxF, rxB, rz, n, pw);
  const out: { c: V3; n: V3; e: V3; w: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = r[i], q = r[(i + 1) % n];
    const e: V3 = [q[0] - a[0], 0, q[2] - a[2]], w = Math.hypot(e[0], e[2]);
    const c: V3 = [(a[0] + q[0]) / 2, (y0 + y1) / 2, (a[2] + q[2]) / 2];
    let nn: V3 = [e[2] / w, 0, -e[0] / w];
    if (nn[0] * (c[0] - cx) + nn[2] * (c[2] - cz) < 0) nn = [-nn[0], 0, -nn[2]];
    out.push({ c, n: nn, e, w });
  }
  return out;
}

function bunkerCrawler(c: ChassisCtx): ChassisOut {
  // A wide, low pillbox on legs (hard-surface): a dark faceted core, a ring of separate wall plates around it on shadow
  // gaps (thicker and doubled across the front arc), a faceted roof shell overhanging the walls, a roof hatch ring with
  // vision blocks (it is a pillbox), a heavy two-layer brow over a recessed visor band, two excavator arms (joint drums,
  // twin-strut bones under chitin shells, sinew cables) reaching forward to fist housings that carry the guns.
  // Functional slots: smoke dischargers on the brow corners, caged lamps under the visor, an exhaust muffler and louvred
  // engine grille at the rear. Asymmetric: the roof hatch and an antenna on the left, a stowage bin on the rear right.
  const { b, kit, stance, L, W } = c;
  const u = Math.min(L, W) / 3; // authored for the 3 x 3 footprint (art 3 wide x 2 long)
  const fine = fineFor(c.S);
  const legged = stance.legs !== null;
  const by = legged ? stance.hipY + 0.02 * u : Math.max(stance.y0 + 0.24 * u, stance.yt);
  const cx = -0.08 * u;
  const rxF = 0.78 * u, rxB = 0.92 * u, rz = 1.18 * u;
  // dark core: belly, wall band and roof (the armour below is all separate plates on it)
  const rW = 0.93, yW0 = by - 0.06 * u, yW1 = by + 0.34 * u, yR = by + 0.46 * u, rR = 0.72, yC = by + 0.5 * u, rC = 0.58;
  shell(b, kit.mech, cx, 0, rxF, rxB, rz, [[by - 0.24 * u, 0.7], [yW0, rW], [yW1, rW], [yR, rR, -0.04 * u], [yC, rC, -0.06 * u]], 8, 2);
  // wall plates: one per face, a second layer on the three front faces
  const faces = ringFaces(cx, 0, rxF * rW, rxB * rW, rz * rW, yW0, yW1);
  let visorX = cx + rxF;
  faces.forEach((f, i) => {
    if (f.n[0] > 0.9) {
      // the front face: a low glacis plate under the visor slit (the brow covers the top)
      armorPlate(b, kit, kit.armor, frame([f.c[0], by - 0.0 * u, f.c[2]], f.n, f.e), rectP(f.w * 0.92, 0.14 * u, 0.03 * u), 0.07 * u, { standoff: 0.035 * u });
      visorX = f.c[0];
      return;
    }
    const front = f.n[0] > 0.5;
    const F = frame(f.c, f.n, f.e);
    const t = (front ? 0.07 : 0.055) * u;
    const top = armorPlate(b, kit, i % 2 ? kit.armor2 : kit.armor, F, rectP(f.w * 0.9, 0.36 * u, 0.04 * u), t, { standoff: 0.035 * u, gap: 0.04 * u });
    if (front) armorPlate(b, kit, kit.armor, sub(F, 0, top, 0.02 * u), rectP(f.w * 0.66, 0.2 * u, 0.03 * u), 0.04 * u, { standoff: 0.012 * u });
  });
  // roof: eight sector plates on the sloped roof faces (gaps between them show the dark core), a cap plate on top
  const ringW = planRing(cx, yW1, 0, rxF * rW, rxB * rW, rz * rW, 8, 2), ringR = planRing(cx - 0.04 * u, yR, 0, rxF * rR, rxB * rR, rz * rR, 8, 2);
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8, m = [(ringW[i][0] + ringW[j][0]) / 2 - cx, 0, (ringW[i][2] + ringW[j][2]) / 2];
    quadPlate(b, kit, i % 2 ? kit.armor : kit.armor2, [ringW[i], ringW[j], ringR[j], ringR[i]], 0.05 * u, [m[0], 0.8, m[2]], { margin: 0.035 * u, standoff: 0.03 * u, back: null });
  }
  const cap = planRing(0, 0, 0, rxF * rC, rxB * rC, rz * rC, 8, 2).map((p) => [p[0], p[2]] as P2);
  armorPlate(b, kit, kit.shell, frame([cx - 0.06 * u, yC, 0], [0, 1, 0], [1, 0, 0]), inset(cap, 0.03 * u), 0.04 * u, { standoff: 0.02 * u });
  const topY = yC + 0.06 * u;
  // roof: hatch ring with vision blocks (left of centre), a raised armour cap, an antenna on the left
  const rhx = cx - 0.1 * u, rhz = -0.5 * u;
  b.cylb(kit.armor2, 0.2 * u, 0.06 * u, 0.012 * u, [rhx, topY - 0.02 * u, rhz], 'y', 10);
  visionBlocks(b, kit, rhx, topY + 0.02 * u, rhz, 0.17 * u, 5, 0.05 * u, fine);
  crewHatch(b, kit, frame([rhx, topY + 0.04 * u, rhz], [0, 1, 0]), 0.11 * u, fine);
  antenna(b, kit, cx - 0.5 * u, topY - 0.06 * u, -0.62 * u, 0.9 * u, 0.012 * u, [-0.2, 0, -0.05]);
  // brow: two stepped armour layers overhanging the visor, hazard band on top
  const fx = visorX + 0.05 * u;
  plateStack(b, kit, kit.armor2, frame([fx - 0.02 * u, by + 0.28 * u, 0], [0.7, 1, 0], [0, 0, 1]), trapP(1.3 * u, 0.26 * u, 0.36 * u, 0.08 * u), [
    { inset: 0, thick: 0.06 * u, standoff: 0.03 * u },
    { inset: 0.05 * u, thick: 0.05 * u, shift: [0, -0.03 * u], mat: kit.armor },
  ], { gap: 0.04 * u });
  hazard(b, kit, fx - 0.1 * u, by + 0.4 * u, 0, 0.1 * u, 0.6 * u, 5, Math.PI / 2);
  // visor slit: dark recess + glowing eye band between the glacis and the brow, caged lamps under the glacis
  b.box(kit.mech, 0.06 * u, 0.1 * u, 0.62 * u, fx - 0.02 * u, by + 0.14 * u, 0, 0.015 * u);
  glow(b, kit, fx + 0.0 * u, by + 0.14 * u, 0, 0.03 * u, 0.035 * u, 0.5 * u);
  both((s) => cagedLamp(b, kit, frame([fx + 0.02 * u, by - 0.16 * u, s * 0.24 * u], [0, 1, 0], [1, 0, 0]), 0.08 * u, fine));
  smokeLaunchers(b, kit, frame([fx - 0.18 * u, by + 0.42 * u, 0.62 * u], [0, 1, 0], [Math.cos(0.6), 0, Math.sin(0.6)]), 3, 0.03 * u);
  // rear: louvred engine grille, muffler box on the right, stowage bin
  recessPanel(b, kit, frame([cx - rxB * 0.7, by + 0.42 * u, 0], [-0.6, 1, 0], [0, 0, 1]), 0.7 * u, 0.26 * u, 0.04 * u, { slats: 4 });
  exhaustBox(b, kit, frame([cx - rxB * 0.92, by + 0.12 * u, 0.5 * u], [-1, 0, 0], [0, 0, -1]), 0.07 * u, fine);
  stowBox(b, kit, frame([cx - rxB * 0.5, by + 0.4 * u, 0.62 * u], [-0.3, 1, 0.3], [1, 0, -0.5]), 0.3 * u, 0.1 * u, 0.16 * u);
  // arms: shoulders under the rim at the front flanks, elbows out and up, fists at the arm mounts
  const arms = c.mounts.filter((m) => Math.abs(m.z) > 0.8 * u);
  const podTop = new Map<MountSpec, number>();
  both((s) => {
    const m = arms.find((q) => Math.sign(q.z) === s);
    const mx = m ? m.x : 0.76 * u, mz = m ? m.z : s * 1.24 * u, r = m?.r ?? 0.29 * u;
    const jaw = isMelee(m);
    const podL = Math.max(0.62 * u, r * 2.3), podW = Math.max(0.4 * u, r * 1.6), podH = 0.28 * u;
    const px = jaw ? mx - podL * 0.25 : mx;
    const wy = by - 0.12 * u;
    // shoulder mount: a dark bracket on the wall the drum turns in
    block(b, kit.mech, cx + 0.3 * u, by + 0.12 * u, s * 0.82 * u, 0.3 * u, 0.2 * u, 0.32 * u, { ch: 0.05 * u });
    const top = reachArmHS(b, kit, s, [cx + 0.3 * u, by + 0.3 * u, s * 0.9 * u], [cx + 0.12 * u, by + 0.78 * u, s * 1.36 * u], [px, wy, mz], { t: 0.11 * u, podL, podW, podH, jaw, fine, organic: true });
    if (m) podTop.set(m, top);
  });
  let hips: Hip[] | undefined;
  if (legged) {
    hips = [];
    for (const [hx, fx2, fz, ph] of [[-0.02, 0.25, 2.05, 0], [-0.55, -1.15, 1.9, Math.PI]] as [number, number, number, number][]) for (const s of [-1, 1] as const) {
      const p: V3 = [hx * u, by - 0.04 * u, s * 0.86 * u];
      hips.push({ p, side: s, t: stance.thick, foot: [fx2 * u, 0, s * fz * u], phase: ph + (s > 0 ? Math.PI : 0) });
    }
  }
  const deck = (x: number, z: number) => {
    const dx = (x - cx) / (x > cx ? rxF : rxB), dz = z / rz;
    const d = dx * dx + dz * dz;
    return d < 1 ? by + 0.12 * u + (topY - by - 0.12 * u) * Math.max(0, 1 - d * 1.3) : -1;
  };
  return {
    deckAt: deck, top: topY, hips, custom: true, dressed: true,
    seat: (m) => {
      const pt = podTop.get(m);
      if (pt !== undefined) return { y: wristRing(b, kit, m.x, pt, m.z, m.r), socket: true };
      const y = Math.max(deck(m.x, m.z), by + 0.4 * u) + 0.06 * u;
      collar(b, kit, m.x, y, m.z, m.r, y - 0.2 * u, 16);
      return { y, socket: true };
    },
  };
}

// ---- Tailgun Crawler ----------------------------------------------------------------------------------------------------

/** box-section crane boom from a to c: two dark side beams with cross ties (a twin-strut frame), an armour cap plate
 *  along the top, a hose run along one side */
function craneBoom(b: Bld, kit: Kit, a: V3, c: V3, w: number, h: number, fine: boolean, capMat: MatLike): void {
  frameLimb(b, kit, a, c, h * 0.32, [0, 0, w * 0.5]);
  const F = boneFrame(a, c, [0, 1, 0]);
  const l = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  armorPlate(b, kit, capMat, F.clone().multiply(new THREE.Matrix4().makeTranslation(0, h * 0.42, l * 0.5)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)), trapP(l * 0.84, w * 1.15, w * 1.3, w * 0.2), h * 0.16, { standoff: h * 0.06 });
  armorPlate(b, kit, kit.armor2, F.clone().multiply(new THREE.Matrix4().makeTranslation(0, -h * 0.4, l * 0.5)).multiply(new THREE.Matrix4().makeRotationX(Math.PI)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)), rectP(l * 0.6, w * 0.9, w * 0.15), h * 0.1, { standoff: h * 0.04 });
  if (fine) hose(b, kit, [a[0], a[1] - h * 0.2, a[2] + w * 0.75], [c[0], c[1] - h * 0.2, c[2] + w * 0.75], h * 0.08, 0.04, 4);
}

function tailgunCrawler(c: ChassisCtx): ChassisOut {
  // A long armoured crawler (hard-surface + chitin): a dark keel core under five shingled carapace bands (each lifted at
  // its rear lip, with side skirts and glow seams between), a wedge prow (glacis stack, hazard lip, triple-eye cluster);
  // a crane boom (box-section: twin dark side beams with an armour cap) rises from a turntable on the mid-back on two
  // lift rams and arches over the rear to a saddle cradling the heavy weapon; two pincer arms out front (chitin shells,
  // sinew cables). Asymmetric: the turntable and boom sit left of the centre line, a muffler on the right flank, an
  // antenna on the right of the prow.
  const { b, kit, stance, L, W } = c;
  const u = Math.min(W / 3, L / 5); // authored for 3 x 5 (art 3 x 4)
  const fine = fineFor(c.S);
  const legged = stance.legs !== null;
  const by = legged ? stance.hipY + 0.04 * u : Math.max(stance.y0 + 0.22 * u, stance.yt);
  // keel core: dark faceted loft the bands sit on
  b.loft(kit.mech, [
    hexSec(1.3 * u, by - 0.22 * u, 0.32 * u, 0.42 * u, by - 0.1 * u, by + 0.12 * u, 0.32 * u, by + 0.26 * u),
    hexSec(0.3 * u, by - 0.3 * u, 0.5 * u, 0.66 * u, by - 0.14 * u, by + 0.18 * u, 0.5 * u, by + 0.44 * u),
    hexSec(-1.0 * u, by - 0.28 * u, 0.44 * u, 0.56 * u, by - 0.12 * u, by + 0.14 * u, 0.4 * u, by + 0.36 * u),
    hexSec(-1.9 * u, by - 0.14 * u, 0.2 * u, 0.26 * u, by - 0.06 * u, by + 0.06 * u, 0.18 * u, by + 0.16 * u),
  ]);
  // carapace: five shingled bands (front to back), widest mid-body
  const prof = (f: number): [number, number, number] => {
    const w = (0.62 + 0.24 * Math.sin(Math.min(1, f * 1.6) * Math.PI * 0.9) - Math.max(0, f - 0.6) * 0.7) * u;
    return [w, (0.2 + 0.1 * Math.sin(f * Math.PI)) * u, by + (0.22 + 0.08 * Math.sin(f * Math.PI)) * u];
  };
  shingles(b, [kit.armor, kit.armor2], 1.3 * u, -1.95 * u, 5, 0.06 * u, prof, { cols: 4, pw: 1.5, drop: 0.24 * u, lift: 0.12 * u, overlap: 0.16 });
  // dorsal ridge plate on every band (a darker spine stepping down the back, shadow line under each)
  for (let i = 0; i < 5; i++) {
    const f = (i + 0.5) / 5, x = (1.3 - 3.25 * f) * u, [w, h, y0] = prof(f);
    armorPlate(b, kit, i % 2 ? kit.shell : kit.armor2, frame([x - 0.04 * u, y0 + h + 0.035 * u, 0], [0.12, 1, 0], [1, 0, 0]), trapP(0.5 * u, w * 0.34, w * 0.46, 0.05 * u), 0.04 * u, { standoff: 0.015 * u });
  }
  for (let i = 1; i < 4; i++) {
    const x = (1.3 - (3.25 * i) / 5) * u, [w, , y0] = prof(i / 5);
    both((s) => glow(b, kit, x, y0 - 0.06 * u, s * w * 0.98, 0.04 * u, 0.04 * u, 0.04 * u));
  }
  // prow: dark wedge, two-layer glacis, hazard lip, triple-eye cluster, antenna on the right
  block(b, kit.mech, 1.42 * u, by - 0.2 * u, 0, 0.5 * u, 0.9 * u, 0.34 * u, { top: [0.5, 0.8], shift: [0.1 * u, 0], ch: 0.16 * u, bev: 0.03 * u });
  plateStack(b, kit, kit.armor, frame([1.5 * u, by + 0.02 * u, 0], [0.75, 1, 0], [0, 0, 1]), trapP(0.9 * u, 0.6 * u, 0.36 * u, 0.1 * u), [
    { inset: 0, thick: 0.06 * u, standoff: 0.03 * u },
    { inset: 0.06 * u, thick: 0.05 * u, mat: kit.armor2 },
  ], { gap: 0.04 * u });
  hazard(b, kit, 1.68 * u, by - 0.12 * u, 0, 0.08 * u, 0.5 * u, 5, Math.PI / 2);
  eyeCluster(b, kit, frame([1.66 * u, by + 0.04 * u, 0], [0, 1, 0], [1, 0, 0]), [[-0.2 * u, 0, 0.05 * u], [0, 0.02 * u, 0.06 * u], [0.2 * u, 0, 0.05 * u]]);
  antenna(b, kit, 1.1 * u, by + 0.42 * u, 0.42 * u, 0.8 * u, 0.012 * u, [-0.3, 0, 0.05]);
  // crane boom: turntable drum + yoke on the mid back, boom up and back to an elbow drum, second boom down to the cradle
  const tail = c.mounts.find((m) => m.x < -0.8 * u);
  const tx = tail ? tail.x : -1.54 * u, tz = tail ? tail.z : -0.8 * u, tr = tail?.r ?? 0.39 * u;
  const baseP: V3 = [-0.35 * u, by + 0.66 * u, -0.28 * u];
  const elbow: V3 = [-0.75 * u, by + 2.05 * u, (-0.28 - 0.3) * u];
  const cradleY = by + 1.25 * u;
  const tipP: V3 = [tx + 0.12 * u, cradleY - 0.05 * u, tz];
  b.cylb(kit.joint, 0.3 * u, 0.1 * u, 0.03 * u, [baseP[0], by + 0.46 * u, baseP[2]], 'y', 12);
  block(b, kit.mech, baseP[0], by + 0.54 * u, baseP[2], 0.42 * u, 0.36 * u, 0.2 * u, { top: [0.8, 0.8], ch: 0.08 * u, bev: 0.02 * u });
  jointDrum(b, kit, [baseP[0], baseP[1] + 0.04 * u, baseP[2]], 0.13 * u, 0.42 * u, 'z');
  craneBoom(b, kit, baseP, elbow, 0.22 * u, 0.28 * u, fine, kit.armor);
  for (const dz of [-0.12, 0.12]) piston(b, kit, [baseP[0] + 0.24 * u, by + 0.6 * u, baseP[2] + dz * u], mid3(baseP, elbow, 0.55, [0.1 * u, -0.04 * u, dz * u]), 0.04 * u, 0.55, fine);
  jointDrum(b, kit, elbow, 0.15 * u, 0.36 * u, 'z');
  hazard(b, kit, elbow[0] + 0.13 * u, elbow[1] + 0.13 * u, elbow[2], 0.26 * u, 0.18 * u, 4, -0.9);
  craneBoom(b, kit, elbow, tipP, 0.2 * u, 0.24 * u, fine, kit.armor2);
  // cradle: dark weapon saddle with armour cheeks at the boom tip
  block(b, kit.mech, tx, cradleY - 0.24 * u, tz, tr * 2.0, tr * 2.0, 0.2 * u, { top: [0.8, 0.8], ch: tr * 0.4, bev: 0.02 * u });
  both((s) => armorPlate(b, kit, kit.armor, frame([tx, cradleY - 0.16 * u, tz + s * tr * 1.02], [0, 0.2, s], [1, 0, 0]), trapP(tr * 2.0, 0.16 * u, 0.2 * u, 0.04 * u), 0.04 * u, { standoff: 0.01 * u }));
  // right flank muffler (asymmetric)
  exhaustBox(b, kit, frame([-1.1 * u, by + 0.1 * u, 0.62 * u], [0, 0.3, 1], [-1, 0, 0]), 0.08 * u, fine);
  // pincer arms out front
  const arms = c.mounts.filter((m) => m.x > 1.0 * u);
  const podTop = new Map<MountSpec, number>();
  both((s) => {
    const m = arms.find((q) => Math.sign(q.z) === s);
    const mx = m ? m.x : 1.83 * u, mz = m ? m.z : s * 0.99 * u, r = m?.r ?? 0.39 * u;
    const jaw = isMelee(m);
    const podL = Math.max(0.7 * u, r * 2.1), podW = Math.max(0.42 * u, r * 1.5), podH = 0.3 * u;
    const top = reachArmHS(b, kit, s, [1.0 * u, by + 0.12 * u, s * 0.62 * u], [1.25 * u, by + 0.5 * u, s * 1.08 * u], [jaw ? mx - podL * 0.25 : mx, by - 0.08 * u, mz], { t: 0.11 * u, podL, podW, podH, jaw, fine, organic: true });
    if (m) podTop.set(m, top);
  });
  let hips: Hip[] | undefined;
  if (legged) {
    hips = [];
    const rows: [number, number, number][] = [[0.55, 1.0, 0], [-0.2, -0.15, Math.PI], [-0.95, -1.7, 0]];
    for (const [hx, fx, ph] of rows) for (const s of [-1, 1] as const) {
      const p: V3 = [hx * u, by - 0.02 * u, s * 0.6 * u];
      hips.push({ p, side: s, t: stance.thick, foot: [fx * u, 0, s * 1.95 * u], phase: ph + (s > 0 ? Math.PI : 0) });
    }
  }
  const deckTop = by + 0.6 * u;
  const deck = (x: number, z: number) => (x > -2 * u && x < 1.6 * u && Math.abs(z) < 0.7 * u ? deckTop : -1);
  return {
    deckAt: deck, top: elbow[1], hips, custom: true, dressed: true,
    seat: (m) => {
      const pt = podTop.get(m);
      if (pt !== undefined) return { y: wristRing(b, kit, m.x, pt, m.z, m.r), socket: true };
      if (m === tail) { collar(b, kit, m.x, cradleY, m.z, m.r, cradleY - 0.08 * u, 16); return { y: cradleY, socket: true }; }
      collar(b, kit, m.x, deckTop, m.z, m.r, deckTop - 0.2 * u, 16);
      return { y: deckTop, socket: true };
    },
  };
}

// ---- Saucer Disc --------------------------------------------------------------------------------------------------------

function saucerDisc(c: ChassisCtx): ChassisOut {
  // An alien disc built like a machine: a dark faceted underside bowl with an emitter ring, a ring of eight separate
  // armour petals on the sloped upper skirt (gaps between them, each standing proud on a dark backing), the glowing rim
  // band showing in the shadow line under the petals, a raised turret plateau (armour drum + cap plate), a cockpit
  // canopy on an armoured collar with two ribs, louvred vents at the rear. On legs it is a tripod on armoured hip
  // housings. Asymmetric: a sensor mast at the rear left, an antenna whisker at the rear right, a crew hatch on the right.
  const { b, kit, stance, L, W, ch } = c;
  const R = (ch.art?.[0] ?? Math.min(L, W)) / 2; // 0.875
  const u = R / 0.875;
  const fine = fineFor(c.S);
  const legged = stance.legs !== null;
  const by = legged ? stance.hipY + 0.32 * u : stance.y0 + 0.2 * u;
  const deckY = by + 0.18 * u;
  // underside: dark faceted bowl + core skirt under the petals
  b.lathe(kit.mech, [[0, by - 0.2 * u], [0.32 * u, by - 0.2 * u], [0.62 * u, by - 0.13 * u], [0.84 * u, by - 0.03 * u], [0.86 * u, by], [0, by]], [0, 0, 0], 'y', 16);
  b.lathe(kit.mech, [[0, by - 0.005], [0.84 * u, by - 0.005], [0.8 * u, by + 0.06 * u], [0.62 * u, deckY - 0.03 * u], [0, deckY - 0.03 * u]], [0, 0, 0], 'y', 16);
  // glowing rim band (shows under the petal lips) + belly emitter ring
  b.lathe(kit.glow, [[0.84 * u, by - 0.03 * u], [0.875 * u, by - 0.025 * u], [0.875 * u, by - 0.005 * u], [0.84 * u, by - 0.005 * u]], [0, 0, 0], 'y', 16);
  b.lathe(kit.glow, [[0.16 * u, by - 0.21 * u], [0.26 * u, by - 0.21 * u], [0.26 * u, by - 0.2 * u], [0.16 * u, by - 0.2 * u]], [0, 0, 0], 'y', 10);
  b.lathe(kit.joint, [[0.12 * u, by - 0.2 * u], [0.3 * u, by - 0.2 * u], [0.3 * u, by - 0.23 * u], [0.12 * u, by - 0.23 * u]], [0, 0, 0], 'y', 10);
  // armour petals: eight trapezoids on the sloped skirt (the front one split around the canopy), alternating shades
  const sl = Math.atan2(deckY - 0.03 * u - (by + 0.02 * u), 0.84 * u - 0.62 * u);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const ca = Math.cos(a), sa = Math.sin(a);
    const rm = 0.74 * u, ym = (by + deckY) / 2 + 0.005 * u;
    const n: V3 = [ca * Math.sin(sl), Math.cos(sl), sa * Math.sin(sl)];
    const F = frame([ca * rm, ym, sa * rm], n, [-sa, 0, ca]);
    // local +z runs up the slope (inward): narrow end there
    const petal: P2[] = [[-0.3 * u, -0.13 * u], [0.3 * u, -0.13 * u], [0.2 * u, 0.12 * u], [-0.2 * u, 0.12 * u]];
    armorPlate(b, kit, i % 2 ? kit.armor2 : kit.armor, F, petal, 0.035 * u, { standoff: 0.014 * u, gap: 0.03 * u });
  }
  // turret plateau: armoured drum, dark seam, cap plate
  b.lathe(kit.armor, [[0, 0], [0.6 * u, 0], [0.62 * u, 0.06 * u], [0.6 * u, 0.1 * u], [0, 0.1 * u]], [0, deckY - 0.08 * u, 0], 'y', 16);
  b.lathe(kit.mech, [[0.5 * u, 0], [0.61 * u, 0], [0.61 * u, 0.015 * u], [0.5 * u, 0.015 * u]], [0, deckY - 0.01 * u, 0], 'y', 16);
  // cockpit canopy at the front edge on an armoured collar, two ribs over the glass, sensor eye under it
  const cpx = 0.66 * u, cpy = deckY - 0.02 * u;
  b.lathe(kit.armor2, [[0, 0], [0.2 * u, 0], [0.19 * u, 0.05 * u], [0, 0.05 * u]], [cpx, cpy - 0.03 * u, 0], 'y', 10);
  dome(b, kit.glass, [cpx, cpy + 0.02 * u, 0], 0.16 * u, 0.13 * u, 10, 2);
  for (const zf of [-0.35, 0.35]) {
    const R0 = 0.165 * u, z0 = zf * R0, rr = Math.sqrt(R0 * R0 - z0 * z0);
    const rows: V3[][] = [];
    for (let i = 0; i <= 3; i++) { const th = 0.3 + (i / 3) * 2.5; rows.push([-1, 1].map((e) => [cpx + Math.cos(th) * rr, cpy + 0.02 * u + Math.sin(th) * rr * 0.8, z0 + e * 0.014 * u] as V3)); }
    b.g(shellGeo(rows, 0.012 * u, (q) => { const d: V3 = [cpx - q[0], cpy - q[1], 0]; const l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l, 0]; }), kit.armor);
  }
  eyeCluster(b, kit, frame([0.8 * u, by + 0.02 * u, 0], [0, 1, 0], [1, 0, 0]), [[0, 0, 0.03 * u], [-0.08 * u, 0, 0.018 * u], [0.08 * u, 0, 0.018 * u]]);
  // rear: two louvred vents on the skirt, sensor mast (left), whisker antenna (right), hatch (right)
  both((s) => recessPanel(b, kit, frame([-0.48 * u, deckY - 0.02 * u, s * 0.28 * u], [-0.3, 1, 0], [0, 0, 1]), 0.18 * u, 0.12 * u, 0.02 * u, { slats: fine ? 3 : 0 }));
  b.strut(kit.joint, [-0.5 * u, deckY - 0.04 * u, -0.46 * u], [-0.62 * u, deckY + 0.3 * u, -0.52 * u], 0.02 * u, 0.012 * u, 5);
  b.cyl(kit.mech, 0.04 * u, 0.04 * u, 0.06 * u, [-0.62 * u, deckY + 0.3 * u, -0.52 * u], 'y', 6);
  b.g(new THREE.BoxGeometry(0.03 * u, 0.02 * u, 0.03 * u), kit.lamp, new THREE.Matrix4().makeTranslation(-0.62 * u, deckY + 0.37 * u, -0.52 * u));
  antenna(b, kit, -0.66 * u, deckY - 0.06 * u, 0.42 * u, 0.5 * u, 0.008 * u, [-0.5, 0, 0.2]);
  crewHatch(b, kit, frame([-0.2 * u, deckY + 0.025 * u, 0.42 * u], [0, 1, 0]), 0.07 * u, fine);
  let hips: Hip[] | undefined;
  if (legged) {
    // tripod: one leg forward, two swept back, each from an armoured hip housing under the disc
    const t = stance.thick;
    hips = [
      { p: [0.3 * u, by - 0.16 * u, 0.02], side: 1, t, foot: [1.2 * u, 0, 0.05 * u], phase: 0 },
      { p: [-0.18 * u, by - 0.16 * u, -0.28 * u], side: -1, t, foot: [-0.66 * u, 0, -1.12 * u], phase: (Math.PI * 2) / 3 },
      { p: [-0.18 * u, by - 0.16 * u, 0.28 * u], side: 1, t, foot: [-0.66 * u, 0, 1.12 * u], phase: (Math.PI * 4) / 3 },
    ];
    for (const h of hips) {
      b.cylb(kit.mech, t * 1.1, t * 0.9, t * 0.12, [h.p[0], by - 0.2 * u - t * 0.9, h.p[2]], 'y', 8);
      b.cyl(kit.armor2, t * 1.25, t * 1.15, t * 0.2, [h.p[0], by - 0.2 * u - t * 0.3, h.p[2]], 'y', 8);
    }
  }
  const deck = (x: number, z: number) => { const r = Math.hypot(x, z); return r < 0.6 * u ? deckY + 0.02 * u : r < 0.86 * u ? by + 0.1 * u : -1; };
  return {
    deckAt: deck, top: deckY, hips, custom: true, dressed: true,
    seat: (m) => { collar(b, kit, m.x, deckY + 0.02 * u, m.z, m.r, deckY - 0.04 * u, 14); return { y: deckY + 0.02 * u, socket: true }; },
  };
}

// ---- Landtrain ------------------------------------------------------------------------------------------------------------

function landtrain(c: ChassisCtx): ChassisOut {
  // An articulated armoured train (hard-surface): a locomotive (dark chassis frame, a long hood under stepped armour
  // plates with a louvred grille, a raised cab with vision slits and a roof hatch, caged headlamps on the nose, a dozer
  // plough on rams), four gun cars that sway on their couplers (each a dark octagonal drum under separate wall plates
  // and a roof plate, side skirts with glow slits, a coupler housing with a brake hose to the next car), and a caboose.
  // Asymmetric: the locomotive's exhaust stack and antenna on the left, a stowage bin on the right of the hood.
  const { b, kit, stance, L, W } = c;
  const u = Math.min(W / 2, L / 5);
  const fine = fineFor(c.S);
  const legged = stance.legs !== null;
  const by = legged ? stance.hipY + 0.06 * u : Math.max(stance.y0 + 0.14 * u, stance.yt);
  const xs = [0.608, -0.0665, -0.741, -1.4155].map((x, i) => c.mounts.find((m) => m.i === i)?.x ?? x * u);
  const carH = 0.46 * u, carZ = 0.62 * u, carX = 0.25 * u;
  const topY = by + carH;
  // spine: coupler beam under the whole train (static)
  b.cylb(kit.joint, 0.08 * u, (xs[0] - xs[3]) + 1.0 * u, 0.02 * u, [xs[3] - 0.6 * u, by + 0.04 * u, 0], 'x', 8);
  // ---- locomotive
  const hx = xs[0] + 0.95 * u;
  block(b, kit.mech, hx, by - 0.16 * u, 0, 1.1 * u, 1.0 * u, 0.3 * u, { top: [1, 1], ch: 0.2 * u, bev: 0.03 * u });
  // hood: dark core with side plates, a stepped top stack and a louvred grille
  block(b, kit.mech, hx + 0.1 * u, by + 0.1 * u, 0, 0.9 * u, 0.86 * u, 0.28 * u, { top: [0.9, 0.9], ch: 0.14 * u, bev: 0.02 * u });
  both((s) => armorPlate(b, kit, kit.armor2, frame([hx + 0.1 * u, by + 0.22 * u, s * 0.44 * u], [0, 0.1, s], [1, 0, 0]), trapP(0.92 * u, 0.2 * u, 0.24 * u, 0.04 * u), 0.04 * u, { standoff: 0.015 * u }));
  plateStack(b, kit, kit.armor, frame([hx + 0.14 * u, by + 0.38 * u, 0], [0.15, 1, 0], [1, 0, 0]), trapP(0.86 * u, 0.62 * u, 0.86 * u, 0.12 * u), [
    { inset: 0, thick: 0.05 * u, standoff: 0.02 * u },
    { inset: 0.12 * u, thick: 0.035 * u, shift: [0.06 * u, 0], mat: kit.armor2 },
  ], { gap: 0.03 * u });
  recessPanel(b, kit, frame([hx - 0.05 * u, by + 0.46 * u, 0], [0, 1, 0], [1, 0, 0]), 0.3 * u, 0.36 * u, 0.025 * u, { slats: fine ? 4 : 0 });
  stowBox(b, kit, frame([hx + 0.1 * u, by + 0.42 * u, 0.38 * u], [0, 1, 0], [1, 0, 0]), 0.36 * u, 0.08 * u, 0.12 * u);
  // cab: dark box under armour cheek plates and a roof plate, vision slits, roof hatch
  const cabX = hx - 0.42 * u;
  block(b, kit.mech, cabX, by + 0.24 * u, 0, 0.42 * u, 0.86 * u, 0.42 * u, { top: [0.8, 0.9], shift: [-0.03 * u, 0], ch: 0.12 * u, bev: 0.02 * u });
  armorPlate(b, kit, kit.armor, frame([cabX + 0.2 * u, by + 0.48 * u, 0], [1, 0.6, 0], [0, 0, 1]), rectP(0.86 * u, 0.24 * u, 0.06 * u), 0.04 * u, { standoff: 0.02 * u });
  armorPlate(b, kit, kit.armor2, frame([cabX - 0.04 * u, by + 0.67 * u, 0], [0, 1, 0], [1, 0, 0]), rectP(0.44 * u, 0.86 * u, 0.06 * u), 0.04 * u, { standoff: 0.01 * u });
  b.box(kit.glass, 0.03 * u, 0.04 * u, 0.6 * u, cabX + 0.28 * u, by + 0.52 * u, 0, 0.008 * u, [0, 0, -0.6]);
  both((s) => b.box(kit.glass, 0.22 * u, 0.04 * u, 0.02 * u, cabX, by + 0.54 * u, s * 0.44 * u, 0.006 * u));
  crewHatch(b, kit, frame([cabX - 0.06 * u, by + 0.73 * u, 0.18 * u], [0, 1, 0]), 0.07 * u, fine);
  exhaust(b, kit, cabX - 0.16 * u, by + 0.5 * u, -0.3 * u, 0.045 * u, 0.36 * u);
  antenna(b, kit, cabX - 0.16 * u, by + 0.7 * u, -0.1 * u, 0.7 * u, 0.008 * u, [-0.3, 0, 0]);
  // nose: caged headlamps + dozer plough on two rams, hazard chevrons
  both((s) => cagedLamp(b, kit, frame([hx + 0.5 * u, by + 0.2 * u, s * 0.32 * u], [0, 1, 0], [1, 0, 0]), 0.09 * u, fine));
  b.slab(kit.armor2, [[0.34 * u, -0.16 * u], [0.34 * u, 0.16 * u], [0.06 * u, 0.6 * u], [-0.08 * u, 0.6 * u], [-0.08 * u, -0.6 * u], [0.06 * u, -0.6 * u]], 0.12 * u, 0.02 * u, hx + 0.62 * u, by - 0.26 * u, 0);
  both((s) => {
    hazard(b, kit, hx + 0.76 * u, by - 0.13 * u, s * 0.22 * u, 0.24 * u, 0.1 * u, 3, s * -0.95);
    piston(b, kit, [hx + 0.36 * u, by - 0.04 * u, s * 0.3 * u], [hx + 0.6 * u, by - 0.18 * u, s * 0.34 * u], 0.03 * u, 0.55, fine);
  });
  glow(b, kit, hx + 0.56 * u, by + 0.08 * u, 0, 0.03 * u, 0.03 * u, 0.4 * u);
  // caboose: dark wedge with an armour cap, tail lamps
  const tx = xs[3] - 0.56 * u;
  block(b, kit.mech, tx, by - 0.1 * u, 0, 0.36 * u, 0.86 * u, 0.38 * u, { top: [0.6, 0.8], shift: [0.06 * u, 0], ch: 0.14 * u, bev: 0.02 * u });
  armorPlate(b, kit, kit.armor, frame([tx - 0.06 * u, by + 0.22 * u, 0], [-0.6, 1, 0], [0, 0, 1]), rectP(0.8 * u, 0.3 * u, 0.06 * u), 0.04 * u, { standoff: 0.015 * u });
  both((s) => b.box(kit.glow, 0.04 * u, 0.06 * u, 0.12 * u, tx - 0.18 * u, by + 0.06 * u, s * 0.28 * u, 0.01 * u));
  // ---- gun cars: each its own animated group (pivoting about its mount point, so turrets stay seated)
  const cars: THREE.Group[] = [];
  const seated = new Set<MountSpec>();
  xs.forEach((x, i) => {
    const cb = new Bld();
    const big = i % 2 === 0;
    const z = carZ * (big ? 1 : 0.9), h = carH * (big ? 1 : 0.92);
    // dark octagonal drum core
    shell(cb, kit.mech, 0, 0, carX * 1.1, carX * 1.1, z * 0.9, [[by - 0.16 * u, 0.86], [by + 0.04 * u, 1.0], [by + h * 0.8, 0.98], [by + h - 0.02 * u, 0.74]], 8, 2);
    // separate wall plates on the eight faces, roof plate, team accent on the big cars
    for (const f of ringFaces(0, 0, carX * 1.12, carX * 1.12, z * 0.92, by + 0.06 * u, by + h * 0.78)) {
      if (Math.abs(f.n[0]) > 0.9) continue; // front / back faces carry the couplers
      armorPlate(cb, kit, Math.abs(f.n[2]) > 0.9 ? (big ? kit.armor : kit.armor2) : kit.shell, frame(f.c, f.n, f.e), rectP(f.w * 0.9, h * 0.62, 0.03 * u), 0.035 * u, { standoff: 0.015 * u, gap: 0.025 * u });
    }
    armorPlate(cb, kit, big ? kit.armor : kit.armor2, frame([0, by + h - 0.02 * u, 0], [0, 1, 0], [1, 0, 0]), rectP(carX * 1.7, z * 1.2, carX * 0.4), 0.03 * u, { standoff: 0.01 * u });
    if (big) cb.box(kit.accent, 0.05 * u, 0.012 * u, z * 1.1, -carX * 0.86, by + h + 0.02 * u, 0, 0.004);
    // side skirts with a glow slit
    both((s) => {
      armorPlate(cb, kit, kit.armor2, frame([0, by - 0.02 * u, s * z * 1.0], [0, 0.15, s], [1, 0, 0]), rectP(carX * 2.0, 0.18 * u, 0.03 * u), 0.03 * u, { standoff: 0.012 * u });
      glow(cb, kit, 0, by + h * 0.58, s * z * 1.0, carX * 0.9, 0.025 * u, 0.025 * u);
    });
    // coupler housing to the next car back + a brake hose
    cb.cylb(kit.joint, 0.11 * u, 0.22 * u, 0.02 * u, [-carX * 1.2 - 0.18 * u, by + 0.16 * u, 0], 'x', 8);
    if (fine && i < 3) hose(cb, kit, [-carX * 1.1, by + 0.28 * u, 0.14 * u], [-carX * 1.2 - 0.3 * u, by + 0.22 * u, 0.12 * u], 0.016 * u, 0.2, 3);
    // turret collar rides the car
    const m = c.mounts.find((q) => Math.abs(q.x - x) < 0.05);
    if (m) { seated.add(m); collar(cb, kit, 0, topY, m.z, m.r, topY - 0.1 * u, 14); }
    const g = new THREE.Group();
    g.position.set(x, 0, 0);
    cb.mount(g);
    c.body.add(g);
    cars.push(g);
  });
  // sway: a travelling yaw wave down the train while moving (small, so turrets stay on their collars)
  c.updates.push((t, _dt, mv) => {
    cars.forEach((g, i) => { g.rotation.y = Math.sin(t * 1.6 - i * 1.1) * 0.07 * mv; g.rotation.x = Math.sin(t * 3.2 - i * 1.1) * 0.03 * mv; });
  });
  let hips: Hip[] | undefined;
  if (legged) {
    hips = [];
    xs.forEach((x, i) => {
      for (const s of [-1, 1] as const) hips!.push({ p: [x, by - 0.02 * u, s * 0.42 * u], side: s, t: stance.thick, foot: [x + 0.05 * u, 0, s * 1.38 * u], phase: i * (Math.PI / 2) + (s > 0 ? Math.PI : 0) });
    });
  }
  const deck = (x: number, z: number) => (Math.abs(z) < carZ * 0.6 && xs.some((cx) => Math.abs(x - cx) < carX) ? topY : -1);
  return {
    deckAt: deck, top: by + 0.7 * u, hips, custom: true, dressed: true,
    seat: (m) => {
      if (!seated.has(m)) collar(b, kit, m.x, topY, m.z, m.r, topY - 0.1 * u, 14);
      return { y: topY, socket: true };
    },
  };
}

registerChassis('crab', bunkerCrawler);
registerChassis('scorpion', tailgunCrawler);
registerChassis('saucer', saucerDisc);
registerChassis('centipede', landtrain);

