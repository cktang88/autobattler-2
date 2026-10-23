// Creature-machine hulls (mechanical, not literal animals; think salvage-robot fauna and droid crawlers):
//   * Bunker Crawler (crab):  a wide, low armoured dome like a pillbox on legs, a heavy brow over a glowing visor band,
//                             two excavator-style arms reaching forward to big fist housings that carry the guns.
//   * Tailgun Crawler (scorpion): a long armadillo of overlapping armour bands with a wedge prow; a box-section crane
//                             boom rises from mid-back and arches over the rear to cradle the heavy weapon; two pincer
//                             arms out front.
//   * Saucer Disc (saucer):   a flying-saucer disc with a glowing rim band, raised turret plateau and a cockpit bubble;
//                             on legs it becomes a tripod.
//   * Landtrain (centipede):  an articulated armoured train: a rounded locomotive head with a plough and headlamp eye,
//                             four barrel-shaped gun cars that sway on their couplers (animated groups), and a tail cap.
// Shared helpers: superellipse-plan shells (planRing / shell) and forward-reaching manipulator arms (reachArm) whose
// wrist housing carries a weapon; melee weapons get an open jaw so the tool reads as a claw at the end of an arm.

import * as THREE from 'three';
import { aim, Bld, type MatLike, type V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar, dome, exhaust, glow, hazard, sensor, vent } from './shapes.ts';

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
 * Forward-reaching manipulator arm: shoulder drum at sh, upper arm to the elbow el (raised, out to the side), forearm
 * down to a wrist housing whose top-front carries the weapon (pod centre at wr, bottom at wr[1]). Returns the housing
 * top height. Side = sign of z.
 */
export function reachArm(b: Bld, kit: Kit, side: number, sh: V3, el: V3, wr: V3, o: ArmOpts): number {
  const { t, podL, podW, podH } = o;
  const dr = t * (o.drum ?? 1.2);
  b.cylb(kit.metal, dr, t * 1.6, dr * 0.2, [sh[0], sh[1], sh[2] - side * t * 0.8], side > 0 ? 'z' : '-z', 12);
  b.cyl(kit.hull, dr * 0.7, dr * 0.6, t * 0.2, [sh[0], sh[1], sh[2] + side * t * 0.8], side > 0 ? 'z' : '-z', 8);
  // upper arm: dark core + armour spine on top
  beam(b, kit.trim, sh, el, t * 1.1, t * 1.1);
  beam(b, kit.panel, [sh[0], sh[1] + t * 0.45, sh[2]], [el[0], el[1] + t * 0.45, el[2]], t * 1.3, t * 0.55);
  // hydraulic ram under the upper arm
  b.strut(kit.steel, [sh[0] + t * 0.3, sh[1] - t * 0.8, sh[2]], [el[0] - t * 0.2, el[1] - t * 0.7, el[2]], t * 0.18, t * 0.18, 6);
  b.cylb(kit.metal, t * 0.85, t * 1.4, t * 0.12, [el[0], el[1], el[2] - side * t * 0.7], side > 0 ? 'z' : '-z', 10);
  // forearm down to the wrist
  const wt: V3 = [wr[0] - podL * 0.3, wr[1] + podH * 0.5, wr[2]];
  beam(b, kit.trim, el, wt, t * 0.95, t * 0.95);
  beam(b, kit.trim, [el[0], el[1] + t * 0.4, el[2]], [wt[0], wt[1] + t * 0.4, wt[2]], t * 1.1, t * 0.45);
  // wrist housing: armoured fist, chamfered nose, team glow on the outer flank
  block(b, kit.trim, wr[0], wr[1], wr[2], podL * 0.9, podW * 0.82, podH * 0.4, { ch: podW * 0.2 });
  block(b, kit.hull, wr[0], wr[1] + podH * 0.22, wr[2], podL, podW, podH * 0.78, { top: [0.84, 0.86], shift: [-podL * 0.05, 0], ch: podW * 0.26, bev: podH * 0.16, bot: podH * 0.08 });
  glow(b, kit, wr[0] - podL * 0.05, wr[1] + podH * 0.55, wr[2] + side * podW * 0.5, podL * 0.5, podH * 0.1, podW * 0.05);
  if (o.jaw) {
    // open jaw: two heavy prongs ahead of the fist, upper and lower, angled apart
    for (const dy of [-1, 1]) {
      const a: V3 = [wr[0] + podL * 0.38, wr[1] + podH * (0.45 + dy * 0.22), wr[2]];
      const tip: V3 = [wr[0] + podL * 0.95, wr[1] + podH * (0.45 + dy * 0.5), wr[2] + side * podW * 0.1];
      beam(b, kit.metal, a, tip, podW * 0.5, podH * 0.22);
      b.box(kit.steel, podL * 0.18, podH * 0.14, podW * 0.42, tip[0], tip[1] - dy * podH * 0.12, tip[2], podH * 0.04);
    }
  } else {
    // armoured cuff over the knuckles
    block(b, kit.panel, wr[0] + podL * 0.42, wr[1] + podH * 0.1, wr[2], podL * 0.2, podW * 0.9, podH * 0.7, { top: [0.6, 0.86], shift: [-podL * 0.04, 0], ch: podW * 0.15, bev: podH * 0.08 });
  }
  return wr[1] + podH;
}

// ---- Bunker Crawler ---------------------------------------------------------------------------------------------------

function bunkerCrawler(c: ChassisCtx): ChassisOut {
  const { b, kit, stance, L, W } = c;
  const u = Math.min(L, W) / 3; // authored for the 3 x 3 footprint (art 3 wide x 2 long)
  const legged = stance.legs !== null;
  const by = legged ? stance.hipY + 0.02 * u : Math.max(stance.y0 + 0.24 * u, stance.yt);
  const cx = -0.08 * u;
  const rxF = 0.78 * u, rxB = 0.92 * u, rz = 1.18 * u;
  // belly + armoured skirt band
  shell(b, kit.trim, cx, 0, rxF, rxB, rz, [[by - 0.24 * u, 0.72], [by - 0.06 * u, 0.95], [by + 0.02 * u, 0.97]], 8, 2);
  // pillbox carapace: faceted octagonal wall band, sloped roof, flat top
  shell(b, kit.hull, cx, 0, rxF, rxB, rz, [[by, 1.0], [by + 0.2 * u, 1.03], [by + 0.25 * u, 0.98], [by + 0.44 * u, 0.7, -0.04 * u], [by + 0.5 * u, 0.56, -0.06 * u]], 8, 2);
  const topY = by + 0.56 * u;
  // roof hatch plate (panel) + accent ring
  shell(b, kit.panel, cx - 0.1 * u, 0, 0.42 * u, 0.42 * u, 0.6 * u, [[by + 0.46 * u, 1.0], [by + 0.53 * u, 0.98], [by + 0.56 * u, 0.86]], 8, 2);
  both((s) => glow(b, kit, cx + 0.1 * u, by + 0.22 * u, s * 1.2 * u, 0.5 * u, 0.04 * u, 0.04 * u, [0, -s * 0.38, 0]));
  // brow: heavy armour lip over the visor, hazard band on top
  const fx = cx + rxF;
  block(b, kit.panel, fx - 0.12 * u, by + 0.12 * u, 0, 0.4 * u, 1.2 * u, 0.26 * u, { top: [0.6, 0.9], shift: [0.1 * u, 0], ch: 0.16 * u, bev: 0.05 * u });
  hazard(b, kit, fx - 0.06 * u, by + 0.38 * u, 0, 0.16 * u, 0.8 * u, 5, Math.PI / 2);
  // visor slit: dark recess + glowing eye band + twin lamps
  b.box(kit.trim, 0.08 * u, 0.1 * u, 1.0 * u, fx + 0.02 * u, by + 0.02 * u, 0, 0.02 * u);
  glow(b, kit, fx + 0.06 * u, by + 0.03 * u, 0, 0.03 * u, 0.04 * u, 0.8 * u);
  both((s) => b.cyl(kit.lamp, 0.06 * u, 0.06 * u, 0.03 * u, [fx + 0.06 * u, by - 0.08 * u, s * 0.36 * u], 'x', 8));
  // rear: vents + exhausts
  both((s) => { vent(b, kit, cx - 0.55 * u, by + 0.35 * u, s * 0.42 * u, 0.26 * u, 0.3 * u, 2, 'z'); exhaust(b, kit, cx - 0.7 * u, by + 0.2 * u, s * 0.62 * u, 0.06 * u, 0.2 * u); });
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
    const top = reachArm(b, kit, s, [cx + 0.3 * u, by + 0.3 * u, s * 0.8 * u], [cx + 0.12 * u, by + 0.78 * u, s * 1.36 * u], [px, wy, mz], { t: 0.11 * u, podL, podW, podH, jaw });
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
    deckAt: deck, top: topY, hips, custom: true,
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

function tailgunCrawler(c: ChassisCtx): ChassisOut {
  const { b, kit, stance, L, W } = c;
  const u = Math.min(W / 3, L / 5); // authored for 3 x 5 (art 3 x 4)
  const legged = stance.legs !== null;
  const by = legged ? stance.hipY + 0.04 * u : Math.max(stance.y0 + 0.22 * u, stance.yt);
  // overlapping armour bands, front to back, leaning back like shingles: [centre x, length, width, height]
  const bands: [number, number, number, number][] = [
    [1.02, 0.95, 1.2, 0.42], [0.3, 0.95, 1.62, 0.6], [-0.46, 0.9, 1.5, 0.54], [-1.16, 0.8, 1.16, 0.44], [-1.72, 0.55, 0.76, 0.3],
  ];
  block(b, kit.trim, -0.3 * u, by - 0.24 * u, 0, 3.0 * u, 1.1 * u, 0.26 * u, { ch: 0.3 * u, bot: 0.06 * u });
  bands.forEach(([x, l, w, h], i) => {
    block(b, kit.hull, x * u, by - 0.06 * u, 0, l * u, w * u, (h + 0.06) * u, { top: [0.62, 0.7], shift: [-l * 0.16 * u, 0], ch: w * 0.28 * u, bev: 0.05 * u, bot: 0.04 * u, mid: [[0.5, 1.0, 1.02]] });
    // ridge cap plate on every other band, glow seam at the rear lip
    if (i % 2) block(b, kit.panel, (x - l * 0.1) * u, by + (h - 0.02) * u, 0, l * 0.5 * u, w * 0.32 * u, 0.06 * u, { top: [0.8, 0.8], ch: w * 0.1 * u, bev: 0.02 * u });
    if (i > 0 && i < 4) tbox(b, kit.glow, 0.03 * u, 0.03 * u, w * 0.62 * u, (x - l * 0.45) * u, by + h * 0.62 * u, 0);
  });
  // prow: wedge ram with a glowing triple-eye band
  const px = 1.62 * u;
  block(b, kit.hull, 1.4 * u, by - 0.18 * u, 0, 0.5 * u, 1.0 * u, 0.36 * u, { top: [0.4, 0.8], shift: [0.12 * u, 0], ch: 0.2 * u, bev: 0.05 * u });
  hazard(b, kit, 1.5 * u, by + 0.2 * u, 0, 0.12 * u, 0.6 * u, 5, Math.PI / 2);
  for (const dz of [-0.24, 0, 0.24]) b.cyl(kit.glow, 0.055 * u, 0.055 * u, 0.04 * u, [1.42 * u, by + 0.3 * u, dz * u], 'x', 8);
  sensor(b, kit, px, by - 0.02 * u, 0, 0.14 * u, kit.lamp);
  // crane boom: turret drum on the mid back, box beam up and back to an elbow, second beam down to the cradle
  const tail = c.mounts.find((m) => m.x < -0.8 * u);
  const tx = tail ? tail.x : -1.54 * u, tz = tail ? tail.z : -0.8 * u, tr = tail?.r ?? 0.39 * u;
  const baseP: V3 = [-0.35 * u, by + 0.66 * u, -0.28 * u];
  const elbow: V3 = [-0.75 * u, by + 2.05 * u, (-0.28 - 0.3) * u];
  const cradleY = by + 1.25 * u;
  const tipP: V3 = [tx + 0.12 * u, cradleY - 0.05 * u, tz];
  b.cylb(kit.trim, 0.3 * u, 0.12 * u, 0.04 * u, [baseP[0], by + 0.5 * u, baseP[2]], 'y', 14);
  block(b, kit.hull, baseP[0], by + 0.58 * u, baseP[2], 0.46 * u, 0.36 * u, 0.24 * u, { top: [0.8, 0.8], ch: 0.1 * u, bev: 0.04 * u });
  b.cylb(kit.metal, 0.13 * u, 0.42 * u, 0.03 * u, [baseP[0], baseP[1] + 0.06 * u, baseP[2] - 0.21 * u], 'z', 12);
  beam(b, kit.panel, baseP, elbow, 0.22 * u, 0.26 * u, [1, 0, 0]);
  beam(b, kit.trim, [baseP[0] + 0.02 * u, baseP[1] - 0.04 * u, baseP[2]], [elbow[0] + 0.02 * u, elbow[1] - 0.04 * u, elbow[2]], 0.16 * u, 0.3 * u, [1, 0, 0]);
  b.strut(kit.steel, [baseP[0] + 0.25 * u, by + 0.6 * u, baseP[2]], [baseP[0] + (elbow[0] - baseP[0]) * 0.6 + 0.12 * u, baseP[1] + (elbow[1] - baseP[1]) * 0.6, baseP[2] + (elbow[2] - baseP[2]) * 0.6], 0.05 * u, 0.05 * u, 6);
  b.cylb(kit.metal, 0.15 * u, 0.36 * u, 0.03 * u, [elbow[0], elbow[1], elbow[2] - 0.18 * u], 'z', 12);
  hazard(b, kit, elbow[0] + 0.12 * u, elbow[1] + 0.12 * u, elbow[2], 0.3 * u, 0.2 * u, 4, -0.9);
  beam(b, kit.panel, elbow, tipP, 0.2 * u, 0.22 * u, [1, 0, 0]);
  glow(b, kit, (elbow[0] + tipP[0]) / 2, (elbow[1] + tipP[1]) / 2 + 0.12 * u, (elbow[2] + tipP[2]) / 2, 0.06 * u, 0.04 * u, 0.04 * u);
  // cradle: armoured weapon saddle at the boom tip
  block(b, kit.trim, tx, cradleY - 0.24 * u, tz, tr * 2.1, tr * 2.1, 0.2 * u, { top: [0.8, 0.8], ch: tr * 0.5, bev: 0.03 * u });
  // pincer arms out front
  const arms = c.mounts.filter((m) => m.x > 1.0 * u);
  const podTop = new Map<MountSpec, number>();
  both((s) => {
    const m = arms.find((q) => Math.sign(q.z) === s);
    const mx = m ? m.x : 1.83 * u, mz = m ? m.z : s * 0.99 * u, r = m?.r ?? 0.39 * u;
    const jaw = isMelee(m);
    const podL = Math.max(0.7 * u, r * 2.1), podW = Math.max(0.42 * u, r * 1.5), podH = 0.3 * u;
    const top = reachArm(b, kit, s, [1.0 * u, by + 0.12 * u, s * 0.62 * u], [1.25 * u, by + 0.5 * u, s * 1.08 * u], [jaw ? mx - podL * 0.25 : mx, by - 0.08 * u, mz], { t: 0.11 * u, podL, podW, podH, jaw });
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
    deckAt: deck, top: elbow[1], hips, custom: true,
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
  const { b, kit, stance, L, W, ch } = c;
  const R = (ch.art?.[0] ?? Math.min(L, W)) / 2; // 0.875
  const u = R / 0.875;
  const legged = stance.legs !== null;
  const by = legged ? stance.hipY + 0.32 * u : stance.y0 + 0.2 * u;
  // disc: underside bowl, sharp rim, sloped upper skirt, flat turret plateau
  const deckY = by + 0.18 * u;
  b.lathe(kit.trim, [[0, by - 0.2 * u], [0.32 * u, by - 0.2 * u], [0.62 * u, by - 0.13 * u], [0.84 * u, by - 0.03 * u], [0.88 * u, by], [0, by]], [0, 0, 0], 'y', 24);
  b.lathe(kit.hull, [[0, by - 0.005], [0.88 * u, by - 0.005], [0.9 * u, by + 0.03 * u], [0.8 * u, by + 0.1 * u], [0.68 * u, deckY - 0.01 * u], [0.62 * u, deckY], [0, deckY]], [0, 0, 0], 'y', 24);
  // glowing rim band + belly emitter ring
  b.lathe(kit.glow, [[0.86 * u, by - 0.035 * u], [0.895 * u, by - 0.03 * u], [0.895 * u, by - 0.005 * u], [0.86 * u, by - 0.005 * u]], [0, 0, 0], 'y', 24);
  b.lathe(kit.glow, [[0.16 * u, by - 0.21 * u], [0.26 * u, by - 0.21 * u], [0.26 * u, by - 0.2 * u], [0.16 * u, by - 0.2 * u]], [0, 0, 0], 'y', 12);
  // rim armour teeth: 8 chunky blocks around the edge (skip the front where the cockpit bubble sits)
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * 0.8 * u, z = Math.sin(a) * 0.8 * u;
    b.box(k % 2 ? kit.panel : kit.accent, 0.12 * u, 0.06 * u, 0.2 * u, x, by + 0.07 * u, z, 0.02 * u, [0, -a, 0]);
  }
  // cockpit bubble at the front edge with a sensor eye
  b.lathe(kit.hull, [[0, 0], [0.19 * u, 0], [0.19 * u, 0.04 * u], [0, 0.04 * u]], [0.62 * u, deckY - 0.04 * u, 0], 'y', 12);
  dome(b, kit.glass, [0.62 * u, deckY, 0], 0.16 * u, 0.13 * u, 12, 2);
  glow(b, kit, 0.77 * u, deckY - 0.02 * u, 0, 0.03 * u, 0.03 * u, 0.12 * u);
  // rear antenna whiskers
  both((s) => {
    b.strut(kit.metal, [-0.66 * u, deckY - 0.04 * u, s * 0.42 * u], [-1.0 * u, deckY + 0.24 * u, s * 0.58 * u], 0.016 * u, 0.008 * u, 5);
    b.box(kit.lamp, 0.03 * u, 0.03 * u, 0.03 * u, -1.0 * u, deckY + 0.24 * u, s * 0.58 * u, 0.008 * u);
  });
  let hips: Hip[] | undefined;
  if (legged) {
    // tripod: one leg forward, two swept back
    const t = stance.thick;
    hips = [
      { p: [0.3 * u, by - 0.16 * u, 0.02], side: 1, t, foot: [1.2 * u, 0, 0.05 * u], phase: 0 },
      { p: [-0.18 * u, by - 0.16 * u, -0.28 * u], side: -1, t, foot: [-0.66 * u, 0, -1.12 * u], phase: (Math.PI * 2) / 3 },
      { p: [-0.18 * u, by - 0.16 * u, 0.28 * u], side: 1, t, foot: [-0.66 * u, 0, 1.12 * u], phase: (Math.PI * 4) / 3 },
    ];
    for (const h of hips) b.cylb(kit.metal, t * 1.1, t * 0.9, t * 0.15, [h.p[0], by - 0.2 * u - t * 0.9, h.p[2]], 'y', 10);
  }
  const deck = (x: number, z: number) => { const r = Math.hypot(x, z); return r < 0.62 * u ? deckY : r < 0.88 * u ? by + 0.1 * u : -1; };
  return {
    deckAt: deck, top: deckY, hips, custom: true,
    seat: (m) => { collar(b, kit, m.x, deckY + 0.02 * u, m.z, m.r, deckY - 0.04 * u, 14); return { y: deckY + 0.02 * u, socket: true }; },
  };
}

// ---- Landtrain ------------------------------------------------------------------------------------------------------------

function landtrain(c: ChassisCtx): ChassisOut {
  const { b, kit, stance, L, W } = c;
  const u = Math.min(W / 2, L / 5);
  const legged = stance.legs !== null;
  const by = legged ? stance.hipY + 0.06 * u : Math.max(stance.y0 + 0.14 * u, stance.yt);
  // car centres from the spine mounts (fall back to the rest pose)
  const xs = [0.608, -0.0665, -0.741, -1.4155].map((x, i) => c.mounts.find((m) => m.i === i)?.x ?? x * u);
  const carH = 0.46 * u, carZ = 0.62 * u, carX = 0.25 * u;
  const topY = by + carH;
  // spine: coupler beam under the whole train (static)
  b.cylb(kit.metal, 0.08 * u, (xs[0] - xs[3]) + 1.0 * u, 0.02 * u, [xs[3] - 0.6 * u, by + 0.04 * u, 0], 'x', 8);
  // locomotive: low armoured chassis, a long sloped hood to a blunt wedge nose, raised cab at the back with window slits
  const hx = xs[0] + 0.95 * u;
  block(b, kit.trim, hx, by - 0.16 * u, 0, 1.1 * u, 1.1 * u, 0.24 * u, { top: [1, 1], ch: 0.26 * u, bev: 0.04 * u });
  block(b, kit.hull, hx + 0.02 * u, by + 0.06 * u, 0, 1.12 * u, 1.2 * u, 0.3 * u, { top: [0.86, 0.9], shift: [-0.04 * u, 0], ch: 0.3 * u, bev: 0.06 * u, bot: 0.03 * u });
  block(b, kit.panel, hx + 0.22 * u, by + 0.34 * u, 0, 0.6 * u, 0.86 * u, 0.12 * u, { top: [0.7, 0.8], shift: [-0.04 * u, 0], ch: 0.2 * u, bev: 0.04 * u });
  vent(b, kit, hx + 0.24 * u, by + 0.46 * u, 0, 0.3 * u, 0.4 * u, 3, 'z');
  const cabX = hx - 0.32 * u;
  block(b, kit.hull, cabX, by + 0.34 * u, 0, 0.42 * u, 0.94 * u, 0.36 * u, { top: [0.72, 0.84], shift: [-0.04 * u, 0], ch: 0.18 * u, bev: 0.05 * u });
  b.box(kit.glass, 0.05 * u, 0.08 * u, 0.62 * u, cabX + 0.17 * u, by + 0.6 * u, 0, 0.012 * u, [0, 0, -0.8]);
  both((s) => b.box(kit.glass, 0.24 * u, 0.07 * u, 0.04 * u, cabX, by + 0.58 * u, s * 0.4 * u, 0.012 * u));
  both((s) => exhaust(b, kit, cabX - 0.12 * u, by + 0.66 * u, s * 0.26 * u, 0.05 * u, 0.2 * u));
  // nose: twin headlamps in armoured housings + low plough wedge with hazard stripes
  both((s) => {
    b.box(kit.trim, 0.12 * u, 0.12 * u, 0.18 * u, hx + 0.55 * u, by + 0.18 * u, s * 0.36 * u, 0.03 * u);
    b.cyl(kit.lamp, 0.045 * u, 0.045 * u, 0.02 * u, [hx + 0.61 * u, by + 0.18 * u, s * 0.36 * u], 'x', 8);
  });
  b.slab(kit.trim, [[0.34 * u, -0.16 * u], [0.34 * u, 0.16 * u], [0.06 * u, 0.62 * u], [-0.08 * u, 0.62 * u], [-0.08 * u, -0.62 * u], [0.06 * u, -0.62 * u]], 0.12 * u, 0.025 * u, hx + 0.52 * u, by - 0.24 * u, 0);
  for (const s of [-1, 1]) hazard(b, kit, hx + 0.66 * u, by - 0.11 * u, s * 0.22 * u, 0.24 * u, 0.1 * u, 3, s * -0.95);
  glow(b, kit, hx + 0.5 * u, by + 0.3 * u, 0, 0.03 * u, 0.03 * u, 0.5 * u);
  // tail: small wedge caboose with tail lamps
  const tx = xs[3] - 0.56 * u;
  block(b, kit.hull, tx, by - 0.1 * u, 0, 0.36 * u, 0.9 * u, 0.42 * u, { top: [0.6, 0.8], shift: [0.06 * u, 0], ch: 0.16 * u, bev: 0.04 * u, bot: 0.04 * u });
  both((s) => b.box(kit.glow, 0.04 * u, 0.06 * u, 0.14 * u, tx - 0.18 * u, by + 0.08 * u, s * 0.28 * u, 0.01 * u));
  // gun cars: each its own animated group (pivoting about its mount point, so turrets stay seated)
  const cars: THREE.Group[] = [];
  const seated = new Set<MountSpec>();
  xs.forEach((x, i) => {
    const cb = new Bld();
    const big = i % 2 === 0;
    const z = carZ * (big ? 1 : 0.9), h = carH * (big ? 1 : 0.92);
    // octagonal armoured drum car: dark chassis, faceted flanks, flat gun deck
    shell(cb, kit.trim, 0, 0, carX * 1.1, carX * 1.1, z * 0.86, [[by - 0.16 * u, 0.86], [by + 0.04 * u, 1.0]], 8, 2);
    shell(cb, big ? kit.hull : kit.panel, 0, 0, carX * 1.2, carX * 1.2, z, [[by + 0.02 * u, 0.92], [by + h * 0.45, 1.0], [by + h * 0.8, 0.96], [by + h, 0.7]], 8, 2);
    // side armour skirts with a glow slit
    both((s) => {
      cb.box(kit.trim, carX * 2.0, 0.2 * u, 0.06 * u, 0, by + 0.04 * u, s * z * 0.97, 0.025 * u, [s * 0.18, 0, 0]);
      glow(cb, kit, 0, by + h * 0.6, s * z * 0.985, carX * 1.2, 0.03 * u, 0.03 * u);
    });
    if (big) cb.box(kit.accent, 0.06 * u, 0.012 * u, z * 1.1, -carX * 0.9, by + h * 0.88, 0, 0.004);
    // coupler housing to the next car back
    cb.cylb(kit.metal, 0.12 * u, 0.22 * u, 0.02 * u, [-carX * 1.2 - 0.18 * u, by + 0.16 * u, 0], 'x', 8);
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
    deckAt: deck, top: by + 0.7 * u, hips, custom: true,
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
