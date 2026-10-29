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
import { aim, Bld, mtx, strutGeo, type MatLike, type P2, type V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerChassis, registerTorso, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { MODULE_BY_ID } from '../../../shared/parts.ts';
import { PART_REST } from '../../../shared/mountgeo.ts';
import { beam, block, both, collar, exhaust, glow, hazard } from './shapes.ts';
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

/** glowing core seen through a ribbed dark cage (vertical): emissive drum, n dark ribs round it, dark rims */
function coreCage(b: Bld, kit: Kit, x: number, y: number, z: number, r: number, h: number, n: number, mat: MatLike = kit.plasma): void {
  b.cyl(mat, r * 0.84, r * 0.84, h, [x, y, z], 'y', Math.max(8, n));
  const tw = ((Math.PI * 2 * r) / n) * 0.5;
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    b.g(new THREE.BoxGeometry(r * 0.32, h, tw), kit.mech, new THREE.Matrix4().makeRotationY(-a).setPosition(x + Math.cos(a) * r * 0.9, y + h / 2, z + Math.sin(a) * r * 0.9));
  }
}

/** turret-ish launch / melee weapons carry their trunnion higher in the housing than guns (weapons3d) */
const TALL_VIS = new Set(['rocketPod', 'missileRack', 'cruise', 'mortar', 'artillery', 'charge']);
const pitchEst = (m: MountSpec) => m.r * (TALL_VIS.has(m.mod.visual ?? '') || isMelee(m) ? 0.62 : 0.38);

/** Saucer gun crown stations (cells, crown frame: origin on the swivel bearing, +x forward). The two medium guns ride
 *  armoured sponsons hung off the crown's flanks, far enough apart that two M housings (1.5 cells) stand side by side
 *  with clear space; the small slot stands on a raised dorsal pylon behind them, high enough to fire over the spine. */
const SAUCER_SP = 0.86, SAUCER_SPY = 0.33, SAUCER_DX = -0.86, SAUCER_DY = 0.7;

/**
 * The rotating gun crown of the Saucer Disc (it twists as one with its weapons). A low dark faceted core with a team
 * carapace and a bone spine plate, a forward beak with a V of hot visor slits, two big armoured sponsons on the flanks
 * (dark core, team shell, outer armour plate with a glowing vent, front glacis, chin keel, bearing plate the gun stands
 * on), a raised dorsal pylon at the back for the small gun, two blade fins raking back with hot exhaust tips. y0 lifts
 * everything (0 inside the torso frame; the crown height when drawn static on a hull with no weapon). heroSt: which
 * station the hero (whose own yaw base is dropped) stands on, so it gets a base block like a pod's.
 */
function saucerCrown(t: Bld, kit: Kit, fine: boolean, y0: number, heroSt: number, heroR: number): void {
  const Y = (y: number) => y0 + y;
  const SP = SAUCER_SP, SY = SAUCER_SPY;
  // core pod: a narrow dark hull between the guns (it fits between the two housings), a keel round the bearing
  block(t, kit.mech, -0.08, Y(-0.1), 0, 1.36, 0.56, 0.42, { top: [0.84, 0.86], shift: [-0.04, 0], ch: 0.14, bev: 0.03, bot: 0.05 });
  block(t, kit.armor2, -0.04, Y(-0.18), 0, 0.7, 0.62, 0.1, { top: [1.1, 0.9], ch: 0.12, bev: 0.02 });
  // carapace: a team shell with a glowing seam along its foot, a bone spine plate stepping down to the beak
  block(t, kit.armor, -0.16, Y(0.26), 0, 1.06, 0.52, 0.36, { top: [0.66, 0.62], shift: [-0.1, 0], ch: 0.12, bev: 0.03, bot: 0.015, mid: [[0.45, 0.94, 0.98]] });
  both((s) => glow(t, kit, -0.12, Y(0.27), s * 0.255, 0.8, 0.04, 0.03, undefined, kit.plasma));
  block(t, kit.shell, -0.3, Y(0.62), 0, 0.5, 0.22, 0.045, { top: [0.8, 0.7], ch: 0.05, bev: 0.012 });
  both((s) => block(t, kit.armor2, -0.2, Y(0.4), s * 0.17, 0.62, 0.14, 0.2, { top: [0.6, 0.6], shift: [-0.12, s * 0.02], ch: 0.04, bev: 0.012 }));
  // beak: a team wedge leaning forward over a dark chin, a V of hot visor slits, a lamp
  block(t, kit.mech, 0.62, Y(-0.06), 0, 0.34, 0.42, 0.28, { top: [0.6, 0.8], shift: [-0.04, 0], ch: 0.08, bev: 0.02 });
  block(t, kit.armor, 0.5, Y(0.14), 0, 0.56, 0.5, 0.32, { top: [0.3, 0.6], shift: [-0.17, 0], ch: 0.1, bev: 0.02, bot: 0.01 });
  both((s) => t.g(new THREE.BoxGeometry(0.16, 0.035, 0.035), kit.hot, mtx([0.71, Y(0.18), s * 0.085], [0, s * 0.5, -0.5])));
  t.cyl(kit.lamp, 0.035, 0.035, 0.03, [0.8, Y(0.04), 0], 'x', 8);
  both((s) => {
    const z = s * SP;
    // sponson arm: a dark box beam out of the core flank, a ram under it
    beam(t, kit.mech, [-0.1, Y(0.1), s * 0.22], [-0.04, Y(SY - 0.12), z], 0.5, 0.16);
    piston(t, kit, [0.14, Y(-0.06), s * 0.26], [0.14, Y(SY - 0.2), z - s * 0.24], 0.035, 0.55, fine);
    // cradle under the gun (narrower than the housing: the gun overhangs it), bearing plate on top
    block(t, kit.mech, -0.02, Y(SY - 0.2), z, 0.86, 0.6, 0.18, { top: [0.9, 0.9], ch: 0.1, bev: 0.02, bot: 0.03 });
    t.cylb(kit.joint, 0.36, 0.035, 0.008, [0, Y(SY - 0.03), z], 'y', 16);
    // pauldron: layered armour hanging down and out from the cradle's outer edge (a shoulder under the gun),
    // team plate over a dark backing, bone top layer, glow vent, hazard band on its nose
    block(t, kit.armor2, -0.04, Y(SY - 0.34), z + s * 0.06, 0.9, 0.5, 0.18, { top: [1.04, 1.2], shift: [0, s * 0.06], ch: 0.08, bev: 0.02, bot: 0.03 });
    const pd = frame([-0.06, Y(SY - 0.27), z + s * 0.36], [0, 1, s * 0.75], [1, 0, 0]);
    plateStack(t, kit, kit.armor, pd, trapP(1.0, 0.4, 0.5, 0.09), [
      { inset: 0, thick: 0.06, standoff: 0.03 },
      { inset: 0.07, thick: 0.04, shift: [-0.06, 0.02], mat: kit.armor2 },
    ], { gap: 0.04 });
    glow(t, kit, -0.1, Y(SY - 0.33), z + s * 0.5, 0.56, 0.035, 0.035, [0.9 * s, 0, 0]);
    hazard(t, kit, 0.38, Y(SY - 0.2), z + s * 0.3, 0.07, 0.24, 3, Math.PI / 2);
  });
  // dorsal pylon behind the core for the small gun: a raked dark column under a team cap, a glowing slot
  beam(t, kit.mech, [-0.56, Y(0.06), 0], [SAUCER_DX, Y(SAUCER_DY - 0.16), 0], 0.26, 0.24);
  block(t, kit.armor, SAUCER_DX + 0.02, Y(SAUCER_DY - 0.2), 0, 0.44, 0.36, 0.16, { top: [0.86, 0.86], ch: 0.09, bev: 0.02, bot: 0.02 });
  glow(t, kit, -0.66, Y(0.26), 0, 0.12, 0.04, 0.27, [0, 0, -0.6], kit.plasma);
  t.cylb(kit.joint, 0.17, 0.03, 0.006, [SAUCER_DX, Y(SAUCER_DY - 0.03), 0], 'y', 12);
  // blade fins raking back from the core's shoulders, hot exhaust tips
  both((s) => {
    beam(t, kit.armor2, [-0.42, Y(0.22), s * 0.2], [-1.0, Y(0.42), s * 0.36], 0.09, 0.07);
    t.cyl(kit.hot, 0.035, 0.035, 0.02, [-1.02, Y(0.43), s * 0.365], 'x', 8);
    if (fine) t.g(new THREE.BoxGeometry(0.34, 0.12, 0.02), kit.armor, mtx([-0.7, Y(0.38), s * 0.3], [0, s * 0.27, 0.4]));
  });
  // the hero's housing base (its own yaw base is dropped in torso mode): a block shaped like a pod's base
  if (heroSt >= 0) {
    const [x, y, z] = heroSt < 2 ? [0, SY, (heroSt ? 1 : -1) * SP] : [SAUCER_DX, SAUCER_DY, 0];
    block(t, kit.mech, x - heroR * 0.06, Y(y), z, heroR * 1.2, heroR * 1.0, heroR * 0.34, { top: [0.86, 0.8], ch: heroR * 0.2, bev: heroR * 0.04 });
  }
}

function saucerDisc(c: ChassisCtx): ChassisOut {
  // A spinning-top gunship: a static alien disc below (dark faceted underside bowl with an emitter ring, a ring of eight
  // armour petals over a glowing rim band, a deck for utilities), a glowing core in a ribbed cage as the waist, and on it
  // a rotating gun crown that is built round its two medium guns: they ride armoured sponsons on the crown's flanks,
  // wider than the disc, with clear space between them, the small gun on a dorsal pylon behind (saucerCrown). All the
  // weapons turn with the crown (mech torso mode). On legs the disc is a tripod on armoured hip housings.
  const { b, kit, stance, L, W, ch } = c;
  const R = (ch.art?.[0] ?? Math.min(L, W)) / 2; // 0.875
  const u = R / 0.875;
  const fine = fineFor(c.S);
  const legged = stance.legs !== null;
  const by = legged ? stance.hipY + 0.26 * u : stance.y0 + 0.2 * u;
  const deckY = by + 0.18 * u;
  // underside: dark faceted bowl + core skirt under the petals
  b.lathe(kit.mech, [[0, by - 0.2 * u], [0.32 * u, by - 0.2 * u], [0.62 * u, by - 0.13 * u], [0.84 * u, by - 0.03 * u], [0.86 * u, by], [0, by]], [0, 0, 0], 'y', 16);
  b.lathe(kit.mech, [[0, by - 0.005], [0.84 * u, by - 0.005], [0.8 * u, by + 0.06 * u], [0.62 * u, deckY - 0.03 * u], [0, deckY - 0.03 * u]], [0, 0, 0], 'y', 16);
  // glowing rim band (shows under the petal lips) + belly emitter ring
  b.lathe(kit.glow, [[0.84 * u, by - 0.03 * u], [0.875 * u, by - 0.025 * u], [0.875 * u, by - 0.005 * u], [0.84 * u, by - 0.005 * u]], [0, 0, 0], 'y', 16);
  b.lathe(kit.glow, [[0.16 * u, by - 0.21 * u], [0.26 * u, by - 0.21 * u], [0.26 * u, by - 0.2 * u], [0.16 * u, by - 0.2 * u]], [0, 0, 0], 'y', 10);
  b.lathe(kit.joint, [[0.12 * u, by - 0.2 * u], [0.3 * u, by - 0.2 * u], [0.3 * u, by - 0.23 * u], [0.12 * u, by - 0.23 * u]], [0, 0, 0], 'y', 10);
  // armour petals: eight trapezoids on the sloped skirt, alternating shades
  const sl = Math.atan2(deckY - 0.03 * u - (by + 0.02 * u), 0.84 * u - 0.62 * u);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const ca = Math.cos(a), sa = Math.sin(a);
    const rm = 0.74 * u, ym = (by + deckY) / 2 + 0.005 * u;
    const n: V3 = [ca * Math.sin(sl), Math.cos(sl), sa * Math.sin(sl)];
    const F = frame([ca * rm, ym, sa * rm], n, [-sa, 0, ca]);
    const petal: P2[] = [[-0.3 * u, -0.13 * u], [0.3 * u, -0.13 * u], [0.2 * u, 0.12 * u], [-0.2 * u, 0.12 * u]];
    armorPlate(b, kit, i % 2 ? kit.armor2 : kit.armor, F, petal, 0.035 * u, { standoff: 0.014 * u, gap: 0.03 * u });
  }
  // deck: a team drum ring round the waist, dark seam, louvred vents and a hatch on it
  b.lathe(kit.armor, [[0.3 * u, 0], [0.6 * u, 0], [0.62 * u, 0.05 * u], [0.58 * u, 0.08 * u], [0.3 * u, 0.08 * u]], [0, deckY - 0.06 * u, 0], 'y', 16);
  both((s) => recessPanel(b, kit, frame([-0.44 * u, deckY + 0.02 * u, s * 0.2 * u], [0, 1, 0], [0, 0, 1]), 0.16 * u, 0.1 * u, 0.015 * u, { slats: fine ? 3 : 0 }));
  eyeCluster(b, kit, frame([0.8 * u, by + 0.02 * u, 0], [0, 1, 0], [1, 0, 0]), [[0, 0, 0.03 * u], [-0.08 * u, 0, 0.018 * u], [0.08 * u, 0, 0.018 * u]]);
  antenna(b, kit, -0.66 * u, deckY - 0.06 * u, 0.42 * u, 0.36 * u, 0.008 * u, [-0.5, 0, 0.2]);
  // waist: a glowing core in a ribbed cage between the deck and the crown bearing (the crown swivels on it); taller when
  // utilities stand on the deck, so the crown and its sponsons swing clear over them
  const hero = c.mounts.filter((m) => m.mod.kind === 'weapon').reduce<MountSpec | undefined>((a, m) => (!a || m.r > a.r ? m : a), undefined);
  const crownY = deckY + Math.max(0.5 * u, ...c.mounts.filter((m) => m !== hero).map((m) => 0.22 * u + m.r * 1.45));
  b.cylb(kit.mech, 0.34 * u, 0.06 * u, 0.012 * u, [0, deckY + 0.01 * u, 0], 'y', 14);
  coreCage(b, kit, 0, deckY + 0.06 * u, 0, 0.26 * u, crownY - deckY - 0.1 * u, 10);
  b.cylb(kit.joint, 0.3 * u, 0.05 * u, 0.01 * u, [0, crownY - 0.05 * u, 0], 'y', 14);
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
  // the crown stations: M slots on the sponsons (slot 0 left, 1 right), the S slot on the dorsal pylon
  const st = (i: number): V3 => (i < 2 ? [0, SAUCER_SPY, (i ? 1 : -1) * SAUCER_SP] : [SAUCER_DX, SAUCER_DY, 0]);
  if (!hero) saucerCrown(b, kit, fine, crownY, -1, 0); // no weapon: the crown stands still
  const deck = (x: number, z: number) => { const r = Math.hypot(x, z); return r < 0.62 * u ? deckY + 0.02 * u : r < 0.86 * u ? by + 0.1 * u : -1; };
  return {
    deckAt: deck, top: crownY + 0.5, hips, custom: true, dressed: true,
    // utilities stand on the deck under the crown; the hero's own seat is replaced by the torso
    seat: (m) => {
      if (m === hero) return { y: crownY, socket: true };
      const y = Math.max(deck(m.x, m.z), deckY) + 0.02 * u;
      collar(b, kit, m.x, y, m.z, m.r, y - 0.06 * u, 14);
      return { y, socket: true };
    },
    torso: hero ? (t) => {
      // pods are the other weapons in slot order: each takes its slot's station
      const pods = c.design.mounts.map((id, i) => (i !== hero.i && id && MODULE_BY_ID.get(id)?.kind === 'weapon' ? i : -1)).filter((i) => i >= 0);
      saucerCrown(t, kit, fine, 0, Math.min(hero.i, 2), hero.r);
      const h0 = st(Math.min(hero.i, 2));
      return { hp: [[h0[0], h0[1] + pitchEst(hero), h0[2]], ...pods.map((i) => st(Math.min(i, 2)))], at: [0, crownY, 0] };
    } : undefined,
  };
}

// ---- Landtrain ------------------------------------------------------------------------------------------------------------

/** One gun car of the Landtrain in its own frame (centreline z = 0, gun at z = s * zg): a dark bogie frame and coupler,
 *  and a casemate built round the gun: a dark wedge across the car whose roof climbs from the far side up to the gun
 *  side and leans out over the running gear there (top-heavy, the weapon on its crest), team armour on the slope, a
 *  dark outer wall plate with a glow slit, a bone crest plate the gun's bearing ring sits on; a low armoured reactor
 *  bunker on the far side (under the neighbouring guns' housings) with a glowing window. Seen from above the cars form
 *  a saw-tooth of alternating wedges down the train. */
function trainCar(cb: Bld, kit: Kit, fine: boolean, by: number, ys: number, s: number, zg: number, r: number, big: boolean, last: boolean): void {
  const L = 0.62, zb = s * zg;
  // bogie frame + coupler to the car behind
  block(cb, kit.mech, 0, by - 0.2, 0, L * 0.9, 0.96, 0.24, { top: [1.04, 1.04], ch: 0.08, bev: 0.02, bot: 0.03 });
  if (!last) {
    cb.cylb(kit.joint, 0.09, 0.2, 0.02, [-L / 2 - 0.12, by - 0.08, 0], 'x', 8);
    if (fine) hose(cb, kit, [-L / 2, by + 0.02, -s * 0.2], [-L / 2 - 0.1, by - 0.02, -s * 0.2], 0.016, 0.2, 3);
  }
  // casemate wedge: bottom across the car, the crest over the gun side
  const y0 = by - 0.02, h = ys - 0.05 - y0, wb = 0.55;
  const zt0 = s * 0.18, zt1 = s * (zg + 0.3), tw = Math.abs(zt1 - zt0), tc = (zt0 + zt1) / 2;
  block(cb, kit.mech, 0, y0, 0, L, wb * 2, h, { top: [0.94, tw / (wb * 2)], shift: [0, tc], ch: 0.07, bev: 0.02 });
  // slope armour (far side, climbing to the crest): team plate, a second darker layer, a hazard band at its foot
  const dz = Math.abs(zt0 + s * wb);
  const sm: V3 = [0, y0 + h * 0.56, (zt0 - s * wb) / 2 + s * 0.02];
  const sF = frame(sm, [0, dz, -s * h], [1, 0, 0]);
  const sl = Math.hypot(dz, h);
  plateStack(cb, kit, big ? kit.armor : kit.armor2, sF, rectP(L * 0.9, sl * 0.74, 0.05), [
    { inset: 0, thick: 0.04, standoff: 0.015 },
    { inset: 0.06, thick: 0.03, shift: [0, s * sl * 0.12], mat: big ? kit.armor2 : kit.armor },
  ], { gap: 0.025 });
  // outer wall leaning out over the running gear: dark-team plate, glow slit, team lip under the crest
  const ow = Math.abs(zt1) - wb;
  const oF = frame([0, y0 + h * 0.5, s * (wb + ow * 0.5 + 0.02)], [0, -ow, s * h], [1, 0, 0]);
  const ol = Math.hypot(ow, h);
  plateStack(cb, kit, kit.armor, oF, rectP(L * 0.92, ol * 0.8, 0.06), [
    { inset: 0, thick: 0.04, standoff: 0.015 },
    { inset: 0.05, thick: 0.03, shift: [0, -ol * 0.14], mat: kit.armor2 },
  ], { gap: 0.025 });
  glow(cb, kit, 0, y0 + h * 0.3, s * (wb + ow * 0.3 + 0.075), L * 0.56, 0.045, 0.03, [s * Math.atan2(ow, h), 0, 0]);
  block(cb, kit.shell, 0, ys - 0.15, s * (Math.abs(zt1) - 0.05), L * 0.96, 0.14, 0.1, { top: [0.9, 0.7], ch: 0.04, bev: 0.015 });
  // gun deck cantilevered fore and aft off the crest (over the neighbours' low far sides), so the weapon's housing
  // stands on armour of nearly its own size: dark brackets under it, team deck slab, bone crest plate
  const dl = 1.04, dw = Math.min(tw * 1.12, 0.9), dc = s * (Math.abs(tc) + 0.02);
  for (const f of [-1, 1]) beam(cb, kit.mech, [f * L * 0.3, ys - 0.42, dc], [f * dl * 0.44, ys - 0.17, dc], 0.12, dw * 0.6);
  block(cb, kit.armor, 0, ys - 0.19, dc, dl, dw, 0.155, { top: [0.96, 0.96], ch: 0.1, bev: 0.02, bot: 0.03 });
  block(cb, kit.shell, 0, ys - 0.045, dc, dl * 0.8, dw * 0.76, 0.04, { top: [0.9, 0.9], ch: 0.08, bev: 0.012 });
  both((f) => glow(cb, kit, f * dl * 0.49, ys - 0.12, dc, 0.03, 0.04, dw * 0.5, undefined, kit.plasma));
  // far side: low reactor bunker under the neighbours' guns, glowing window
  const zf = -s * 0.4;
  block(cb, kit.armor2, 0, by - 0.04, zf, L * 0.84, 0.36, 0.3, { top: [0.86, 0.6], shift: [0, -s * 0.06], ch: 0.06, bev: 0.02, bot: 0.015 });
  cb.box(kit.plasma, L * 0.42, 0.06, 0.02, 0, by + 0.08, -s * 0.585, 0.006);
  if (fine) recessPanel(cb, kit, frame([0, by + 0.25, zf - s * 0.08], [0, 1, -s * 0.5], [1, 0, 0]), L * 0.5, 0.12, 0.015, { slats: 3 });
  // bearing ring the weapon turns on (well inside the housing: the gun overhangs its crest)
  cb.lathe(kit.trim, [[0, -0.05], [r * 0.42, -0.05], [r * 0.44, -0.02], [r * 0.42, -0.004], [0, -0.004]], [0, ys, zb], 'y', 14);
}

function landtrain(c: ChassisCtx): ChassisOut {
  // An articulated armoured battle train (hard-surface) built round its four medium guns: they stand staggered right /
  // left down the train (one per car, alternating sides), so every M housing (1.5 cells) stands clear of its neighbours
  // and each gun has its own armoured barbette tower; the far side of each car is a low reactor bunker that the
  // neighbouring guns swing over. Front: a locomotive (dark chassis, a long armoured hood with a louvred grille, a
  // raised armoured cab with vision slits, caged headlamps, a dozer plough on rams) kept low under the front guns'
  // barrels; rear: a caboose with tail lamps and exhaust stacks. The gun cars sway on their couplers (animated groups,
  // pivoting about their gun points so the turrets stay seated).
  const { b, kit, stance, L, W } = c;
  const u = Math.min(W / 2, L / 5);
  const fine = fineFor(c.S);
  const legged = stance.legs !== null;
  const by = legged ? stance.hipY + 0.06 * u : Math.max(stance.y0 + 0.14 * u, stance.yt);
  const rest = PART_REST.centipede!;
  const cars = rest.map((p, i) => {
    const m = c.mounts.find((q) => q.i === i);
    return { x: m?.x ?? p![0], z: m?.z ?? p![1], m };
  });
  // gun collar heights: a battery climbing toward the rear (superfiring: each gun's barrel clears the housing of the
  // gun two cars ahead on its side)
  const ysOf = (i: number) => by + 0.5 + 0.12 * i;
  // spine: coupler beam under the whole train (static)
  const x0 = cars[3].x - 0.75, x1 = cars[0].x + 0.7;
  b.cylb(kit.joint, 0.07, x1 - x0, 0.02, [x0, by - 0.08, 0], 'x', 8);
  // ---- locomotive: kept under the front guns' barrels (its roof stays below the collars behind it)
  const lx = cars[0].x + 0.44; // rear of the loco
  block(b, kit.mech, lx + 0.56, by - 0.2, 0, 1.12, 1.0, 0.3, { top: [1, 1], ch: 0.2, bev: 0.03 });
  // rear coupling block (under gun 0's housing): a low dark tender with a glowing reactor slot
  block(b, kit.mech, lx + 0.18, by + 0.02, 0, 0.42, 1.0, 0.3, { top: [0.9, 0.9], ch: 0.1, bev: 0.02 });
  block(b, kit.armor2, lx + 0.18, by + 0.2, -0.24, 0.38, 0.44, 0.2, { top: [0.8, 0.8], ch: 0.06, bev: 0.02 });
  b.box(kit.plasma, 0.04, 0.05, 0.6, lx + 0.4, by + 0.2, 0, 0.008);
  // cab: dark box under a forward-raked team brow and a roof plate, vision slits, roof hatch, exhaust stacks
  const cabX = lx + 0.62;
  block(b, kit.mech, cabX, by + 0.08, 0, 0.42, 0.9, 0.5, { top: [0.82, 0.86], shift: [-0.04, 0], ch: 0.12, bev: 0.02 });
  plateStack(b, kit, kit.armor, frame([cabX + 0.17, by + 0.46, 0], [1, 0.7, 0], [0, 0, 1]), rectP(0.88, 0.26, 0.07), [
    { inset: 0, thick: 0.05, standoff: 0.02 },
    { inset: 0.05, thick: 0.035, shift: [0, -0.02], mat: kit.armor2 },
  ], { gap: 0.03 });
  armorPlate(b, kit, kit.armor2, frame([cabX - 0.06, by + 0.58, 0], [0, 1, 0], [1, 0, 0]), rectP(0.36, 0.8, 0.06), 0.04, { standoff: 0.01 });
  b.box(kit.glass, 0.03, 0.04, 0.62, cabX + 0.22, by + 0.38, 0, 0.008, [0, 0, -0.6]);
  both((s) => b.box(kit.glass, 0.2, 0.04, 0.02, cabX, by + 0.42, s * 0.45, 0.006));
  crewHatch(b, kit, frame([cabX - 0.1, by + 0.63, -0.18], [0, 1, 0]), 0.07, fine);
  both((s) => exhaust(b, kit, cabX - 0.18, by + 0.3, s * 0.4, 0.045, 0.42));
  antenna(b, kit, cabX - 0.12, by + 0.6, 0.22, 0.6, 0.008, [-0.3, 0, 0]);
  // hood: long dark core under stepped armour plates, side plates, louvred grille, stowage bin
  const hx = cabX + 0.56;
  block(b, kit.mech, hx, by + 0.02, 0, 0.72, 0.86, 0.32, { top: [0.86, 0.9], ch: 0.14, bev: 0.02 });
  both((s) => armorPlate(b, kit, kit.armor2, frame([hx, by + 0.17, s * 0.44], [0, 0.1, s], [1, 0, 0]), trapP(0.74, 0.18, 0.22, 0.04), 0.04, { standoff: 0.015 }));
  plateStack(b, kit, kit.armor, frame([hx + 0.04, by + 0.3, 0], [0.2, 1, 0], [1, 0, 0]), trapP(0.7, 0.56, 0.8, 0.12), [
    { inset: 0, thick: 0.05, standoff: 0.02 },
    { inset: 0.12, thick: 0.035, shift: [0.05, 0], mat: kit.armor2 },
  ], { gap: 0.03 });
  recessPanel(b, kit, frame([hx - 0.12, by + 0.37, 0], [0, 1, 0], [1, 0, 0]), 0.22, 0.34, 0.025, { slats: fine ? 3 : 0 });
  stowBox(b, kit, frame([hx - 0.05, by + 0.34, -0.36], [0, 1, 0], [1, 0, 0]), 0.3, 0.07, 0.11);
  // nose: caged headlamps, glow bar, dozer plough on two rams with hazard chevrons
  const nx = hx + 0.38;
  both((s) => cagedLamp(b, kit, frame([nx, by + 0.12, s * 0.3], [0, 1, 0], [1, 0, 0]), 0.09, fine));
  glow(b, kit, nx + 0.02, by + 0.04, 0, 0.03, 0.03, 0.4);
  b.slab(kit.armor2, [[0.3, -0.16], [0.3, 0.16], [0.06, 0.58], [-0.08, 0.58], [-0.08, -0.58], [0.06, -0.58]], 0.12, 0.02, nx + 0.1, by - 0.3, 0);
  both((s) => {
    hazard(b, kit, nx + 0.22, by - 0.17, s * 0.22, 0.22, 0.1, 3, s * -0.95);
    piston(b, kit, [nx - 0.14, by - 0.06, s * 0.3], [nx + 0.08, by - 0.22, s * 0.34], 0.03, 0.55, fine);
  });
  // ---- caboose: dark wedge, team cap, tail lamps, twin stacks (kept low: the rear gun's housing swings over it)
  const tx = cars[3].x - 0.7;
  block(b, kit.mech, tx, by - 0.18, 0, 0.5, 0.96, 0.52, { top: [0.66, 0.84], shift: [-0.06, 0], ch: 0.14, bev: 0.02 });
  armorPlate(b, kit, kit.armor, frame([tx - 0.08, by + 0.26, 0], [-0.6, 1, 0], [0, 0, 1]), rectP(0.84, 0.3, 0.06), 0.04, { standoff: 0.015 });
  both((s) => b.box(kit.glow, 0.04, 0.06, 0.12, tx - 0.25, by + 0.02, s * 0.3, 0.01));
  exhaustBox(b, kit, frame([tx - 0.06, by + 0.3, 0.32], [0, 1, 0], [-1, 0, 0]), 0.07, fine);
  // ---- gun cars: each its own animated group pivoting about its gun point (the turret stays seated on its collar)
  const groups: THREE.Group[] = [];
  const seated = new Set<MountSpec>();
  cars.forEach((cr, i) => {
    const cb = new Bld();
    const s = cr.z < 0 ? -1 : 1, zg = Math.abs(cr.z);
    trainCar(cb, kit, fine, by, ysOf(i), s, zg, cr.m?.r ?? 0.75, i % 2 === 0, i === cars.length - 1);
    if (cr.m) seated.add(cr.m);
    const g = new THREE.Group(), inner = new THREE.Group();
    g.position.set(cr.x, 0, cr.z);
    inner.position.set(0, 0, -cr.z);
    cb.mount(inner);
    g.add(inner);
    c.body.add(g);
    groups.push(g);
  });
  // sway: a travelling yaw wave down the train while moving (small, so turrets stay on their collars)
  c.updates.push((t, _dt, mv) => {
    groups.forEach((g, i) => { g.rotation.y = Math.sin(t * 1.6 - i * 1.1) * 0.05 * mv; g.rotation.x = Math.sin(t * 3.2 - i * 1.1) * 0.02 * mv; });
  });
  let hips: Hip[] | undefined;
  if (legged) {
    hips = [];
    cars.forEach((cr, i) => {
      for (const s of [-1, 1] as const) hips!.push({ p: [cr.x, by - 0.02 * u, s * 0.42 * u], side: s, t: stance.thick, foot: [cr.x + 0.05 * u, 0, s * 1.38 * u], phase: i * (Math.PI / 2) + (s > 0 ? Math.PI : 0) });
    });
  }
  const deck = (x: number, z: number) => (Math.abs(z) < 0.55 && cars.some((cr) => Math.abs(x - cr.x) < 0.3) ? by + 0.38 : -1);
  return {
    deckAt: deck, top: ysOf(3) + 0.1, hips, custom: true, dressed: true,
    seat: (m) => {
      const ys = ysOf(Math.min(m.i, 3));
      if (!seated.has(m)) collar(b, kit, m.x, ys, m.z, m.r, ys - 0.1, 14);
      return { y: ys, socket: true };
    },
  };
}

registerChassis('crab', bunkerCrawler);
registerChassis('scorpion', tailgunCrawler);
registerChassis('saucer', saucerDisc);
registerTorso('saucer');
registerChassis('centipede', landtrain);

