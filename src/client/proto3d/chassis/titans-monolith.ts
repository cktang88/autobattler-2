// Monolith (size 5, 7 x 7): a walking bunker built round its giant (L) gun. The bunker IS the gun's mantlet: the upper
// casemate twists on the waist with its weapons (torso mode) and the giant gun lies in a deep slot cut into the
// casemate's front, between two armoured shield horns that rise above the roof and batter forward past the muzzle
// end of the housing, on a heavy chin cradle; only the barrel and the housing's top stand out of the block. The roof
// behind carries a commander's cupola, the medium on an armoured corner tower (rear right) and twin exhaust stacks on
// the back wall. Below, static: a battered skirt whose plan flares into four horns (front shield wings, rear engine
// wings) round a pinched waist, flying buttresses down the flanks, appliqué plates on shadow gaps, ERA on the front
// arc, louvre grilles astern, a ram blade under the glacis. Very few guns, all of it armour.

import * as THREE from 'three';
import type { P2, V3 } from '../geo.ts';
import { registerChassis, registerTorso, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar, glow, hazard, vent } from './shapes.ts';
import { banner, glowGrille, mast, ngon, planLoft } from './giants-kit.ts';
import { inside, faceFrame, faceSlit, hatch, mirror, pbox, pipeRun, sensorDome, wallFace, whip, type Face } from './titan-greebles.ts';
import { armorPlate, cagedLamp, eraGrid, fineFor, frame, ladder, piston, plateStack, recessPanel, rectP, trapP } from './hs-kit.ts';
import { octBarbette } from './hs-kit-titan.ts';
import { torsoHP, torsoSlots } from './torso-kit.ts';
import { shiftTo } from './titans.ts';
import type { Kit, MatLike } from '../materials.ts';
import type { Bld } from '../geo.ts';

/** hard-surface plate on a wall face (hs-kit armorPlate in face coordinates: thickness, bevel, shadow gap) */
const facePlateHS = (b: Bld, kit: Kit, f: Face, du: number, dv: number, w: number, d: number, t: number, mat: MatLike, so = t * 0.45) =>
  armorPlate(b, kit, mat, faceFrame(f, du, dv, 0), rectP(w, d, Math.min(w, d) * 0.08), t, { standoff: so, gap: t * 1.1 });
/** recessed louvre grille on a wall face */
const faceGrille = (b: Bld, kit: Kit, f: Face, du: number, dv: number, w: number, d: number, n: number) =>
  recessPanel(b, kit, faceFrame(f, du, dv, 0), w, d, Math.min(w, d) * 0.12, { slats: n });

function monolith(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const kx = L / 7, kz = W / 7, k = Math.min(kx, kz);
  const legged = stance.legs !== null;
  const y0 = stance.y0;
  const yt = legged ? y0 + 0.3 * k : Math.max(stance.yt, y0 + 0.4);
  const sc = (pts: P2[]): P2[] => pts.map(([x, z]) => [x * kx, z * kz] as P2);
  const u = 0.12 * k; // greeble unit
  const fine = fineFor(c.S);
  const ts = torsoSlots(c);
  const heroM = ts.hero >= 0 ? c.mounts.find((m) => m.i === ts.hero) : undefined;

  // keel between the running gear
  const wi = Math.min(stance.wi, 2.3 * kz);
  planLoft(b, kit.trim, ngon(8, 2.9 * kx, wi), [[y0, 0.9], [yt + 0.1, 1.0]]);

  // ---- tier 1 (static): the battered skirt. Hourglass plan: front shield horns, a pinched waist, rear engine horns.
  const P1 = sc(mirror([[3.5, 0], [3.35, -1.0], [2.15, -3.48], [1.35, -3.3], [0.45, -2.3], [-0.9, -2.3], [-1.8, -3.3], [-2.55, -3.45], [-3.2, -2.35], [-3.5, -0.9], [-3.5, 0]]));
  const s1 = yt + 1.25 * k, sTop = 0.84;
  const sh1 = s1 - 0.28 * k;
  planLoft(b, kit.hull, P1, [[yt - 0.12, 0.9], [yt + 0.2 * k, 1.0], [sh1, 0.96], [s1, sTop]]);
  planLoft(b, kit.trim, P1, [[yt + 0.1 * k, 1.014], [yt + 0.26 * k, 1.014]]);
  for (let i = 0; i < P1.length; i++) {
    const f = wallFace(P1, i, [yt + 0.26 * k, 1.0], [sh1, 0.96]);
    if (f.w < 0.5 * k) continue;
    const front = f.n.x > 0.85, rear = f.n.x < -0.85;
    if (rear) {
      faceGrille(b, kit, f, 0, 0, f.w * 0.62, f.h * 0.55, 5);
      faceSlit(b, kit, f, 0, -f.h * 0.38, f.w * 0.5, u * 0.5, kit.hot);
      continue;
    }
    const n = Math.max(1, Math.round(f.w / (1.5 * k)));
    for (let j = 0; j < n; j++) {
      const du = (j + 0.5 - n / 2) * (f.w / n), pw = (f.w / n) * 0.86 - 0.05;
      if (front) {
        const top = plateStack(b, kit, kit.armor, faceFrame(f, du, -f.h * 0.04, 0), rectP(pw, f.h * 0.72, u), [
          { inset: 0, thick: u * 1.2, standoff: u * 0.5 }, { inset: u * 1.4, thick: u * 0.9, mat: kit.armor2 },
        ], { gap: u * 1.2 });
        eraGrid(b, kit, faceFrame(f, du, -f.h * 0.04, top), 3, 4, pw * 0.2, f.h * 0.16, u * 0.55, kit.armor2);
      } else facePlateHS(b, kit, f, du, -f.h * 0.04, pw, f.h * 0.66, u * 1.1, j % 2 ? kit.shell : kit.armor2);
    }
  }
  // ladders up the waist pinch onto the skirt top
  both((s) => {
    const i = P1.findIndex(([x, z]) => Math.abs(x - 0.45 * kx) < 1e-6 && Math.sign(z) === s);
    const j = P1.findIndex(([x, z]) => Math.abs(x + 0.9 * kx) < 1e-6 && Math.sign(z) === s);
    const f = wallFace(P1, s < 0 ? i : j, [yt + 0.2 * k, 1.0], [s1, sTop]);
    const a = f.c.clone().addScaledVector(f.u, f.w * 0.3).addScaledVector(f.v, -f.h * 0.5), e = a.clone().addScaledVector(f.v, f.h);
    ladder(b, kit, [a.x, a.y, a.z], [e.x, e.y + 0.1 * k, e.z], 0.3 * k, [f.u.x, f.u.y, f.u.z], [f.n.x, f.n.y, f.n.z], 0.08 * k);
  });
  // ---- waist (static): a dark recessed octagonal band the casemate turns on, with a bright race
  const wR = 2.35 * k;
  planLoft(b, kit.trim, ngon(10, wR * kx / k, wR * kz / k), [[s1 - 0.04, 1.0], [s1 + 0.4 * k, 1.0]]);
  planLoft(b, kit.metal, ngon(10, wR * kx / k, wR * kz / k), [[s1 + 0.3 * k, 1.04], [s1 + 0.38 * k, 1.04]]);

  // ---- flying buttresses down the flanks: from the waist band out beyond the skirt foot (static)
  both((s) => {
    const x = -0.22 * kx, zi = s * 1.75 * kz, zo = s * 2.95 * kz;
    const ring = (z: number, hw: number, lo: number, hi: number): V3[] => [
      [x - hw, lo, z], [x + hw, lo, z], [x + hw, hi - hw * 0.6, z], [x + hw * 0.35, hi, z], [x - hw * 0.35, hi, z], [x - hw, hi - hw * 0.6, z]];
    b.loft(kit.hull, [ring(zi, 0.42 * kx, s1 - 0.2 * k, s1 + 0.3 * k), ring(zo, 0.32 * kx, yt - 0.1, yt + 0.5 * k)]);
    b.strut(kit.trim, [x, s1 + 0.33 * k, zi], [x, yt + 0.53 * k, zo], 0.12 * k, 0.1 * k, 6);
    block(b, kit.trim, x, yt - 0.25 * k, zo - s * 0.1 * kz, 0.85 * kx, 0.5 * kz, 0.45 * k, { top: [0.8, 0.7], ch: 0.12 * k });
    const zc = s * 2.45 * kz, yc = s1 + 0.12 * k;
    pipeRun(b, kit, [[1.6 * kx, yc, zc * 0.95], [0.4 * kx, yc, zc * 0.92], [-0.6 * kx, yc + 0.05, zc * 0.92], [-1.7 * kx, yc, zc * 0.97]], 0.07 * k);
    glow(b, kit, 1.0 * kx, s1 + 0.02, s * 2.3 * kz, 1.2 * kx, 0.05, 0.05);
  });
  // ---- prow: ram blade under the glacis, hazard band, headlamps
  block(b, kit.metal, 3.25 * kx, Math.max(0.12, yt - 0.55 * k), 0, 0.9 * kx, 3.2 * kz, 0.85 * k, { top: [0.45, 0.9], shift: [-0.2 * kx, 0], ch: 0.25 * k, bev: 0.06 });
  for (let i = -3; i <= 3; i++) block(b, kit.steel, 3.62 * kx, Math.max(0.1, yt - 0.55 * k), i * 0.42 * kz, 0.3 * kx, 0.2 * kz, 0.3 * k, { top: [0.3, 0.6], shift: [0.08 * kx, 0], ch: 0.04 });
  hazard(b, kit, 3.36 * kx, yt + 0.18 * k, 0, 2.6 * kz, 0.08 * kx, 9, Math.PI / 2);
  both((s) => { for (const zz of [1.3, 0.95]) cagedLamp(b, kit, frame([3.38 * kx, yt + 0.3 * k, s * zz * kz], [0, 1, 0], [1, 0, 0]), 0.2 * k, fine); });
  // skirt-top deck furniture outside the casemate's sweep (radius ~ wR + overhang): hatches, vents, lamps
  both((s) => {
    hatch(b, kit, 2.6 * kx, s1, s * 1.65 * kz, 0.22 * k);
    vent(b, kit, -2.85 * kx, s1, s * 1.75 * kz, 0.5 * kx, 0.45 * kz, 3, 'x');
    hazard(b, kit, 2.85 * kx, s1 + 0.01, s * 0.7 * kz, 0.5 * kx, 0.1 * kz, 3, s * 0.62);
  });
  glowGrille(b, kit, -3.4 * kx, yt + 0.72 * k, 0, 1.2 * kz, 0.55 * k, 3, -1);

  // ---- tier 2 (the torso): the casemate, its front slotted for the giant gun
  const yW = s1 + 0.4 * k; // waist top = the twist pivot
  const t2 = yW + 2.0 * k; // roof
  const gw = 1.32 * kz; // half-width of the gun slot
  const base = (i: number): V3 => (i === 0 ? [1.0 * kx, t2 - 1.05 * k, 0] : i === 1 ? [-1.65 * kx, t2 + 0.5 * k, 1.45 * kz] : [-1.0 * kx, t2 + 0.3 * k, -1.2 * kz]);
  const casemate = (t: Bld, armed: (i: number) => boolean) => {
    const lip = yW + 0.25 * k, sh2 = t2 - 0.3 * k;
    // rear block: overhanging lip, then battered back in to the roof
    const PR = sc([[0.35, -2.3], [-1.5, -2.35], [-2.75, -1.65], [-2.75, 1.65], [-1.5, 2.35], [0.35, 2.3]]);
    const LR: [number, number][] = [[yW - 0.02, 0.86], [lip, 1.0], [lip + 0.2 * k, 1.0], [sh2, 0.95], [t2 - 0.06 * k, 0.84], [t2, 0.82]];
    planLoft(t, kit.hull, PR, LR);
    planLoft(t, kit.accent, PR, [[lip + 0.04 * k, 1.008], [lip + 0.14 * k, 1.008]]);
    // shield horns either side of the gun slot: battered walls, tops rising above the roof and raking forward
    const hornTop = t2 + 0.85 * k;
    both((s) => {
      const H: P2[] = [[0.3 * kx, s * gw], [3.05 * kx, s * gw], [3.0 * kx, s * (gw + 0.3 * kz)], [1.75 * kx, s * 2.2 * kz], [0.3 * kx, s * 2.3 * kz]];
      const Hs = s > 0 ? H : [...H].reverse();
      // loft the horn by plan levels (the inner wall stays upright over the slot)
      const cz = s * (gw + 0.5 * kz);
      const lv = (y: number, f: number, dx = 0): V3[] => Hs.map(([x, z]) => [x + dx, y, (z - cz) * (Math.abs(z) <= gw + 1e-6 ? 1 : f) + cz] as V3);
      t.loft(kit.hull, [lv(yW - 0.02, 0.8), lv(lip, 1.0), lv(lip + 0.2 * k, 1.0), lv(t2 - 0.3 * k, 0.94, 0.05 * kx), lv(hornTop - 0.12 * k, 0.78, -0.25 * kx), lv(hornTop, 0.66, -0.4 * kx)]);
      // horn armour: stacked plates with ERA on the front face, a plate down the outer face, a glow slit
      const front = frame([3.0 * kx + 0.02, (lip + t2) / 2, cz + s * 0.12 * kz], [1, 0.18, 0], [0, 0, 1]);
      const top = plateStack(t, kit, kit.armor, front, rectP(0.75 * kz, (t2 - lip) * 0.62, u), [{ inset: 0, thick: u * 1.1, standoff: u * 0.5 }, { inset: u * 1.2, thick: u * 0.8, mat: kit.armor2 }], { gap: u });
      eraGrid(t, kit, front.clone().multiply(new THREE.Matrix4().makeTranslation(0, top, 0)), 3, 2, 0.32 * kz, 0.4 * k, u * 0.55, kit.armor2);
      armorPlate(t, kit, kit.armor2, frame([0.95 * kx, (lip + t2) / 2, s * 2.25 * kz], [0.05, 0, s], [1, 0, 0]), rectP(1.1 * kx, (t2 - lip) * 0.6, 0.12 * k), u * 1.2, { standoff: u * 0.5 });
      faceSlit(t, kit, wallFace(Hs, s > 0 ? 2 : 1, [lip + 0.25 * k, 1.0], [t2 - 0.3 * k, 0.94], [0, 0]), 0, 0.35, 0.8 * k, u * 0.45);
      // inner wall of the slot: dark liner plate and a glowing feed seam along the gun
      t.box(kit.trim, 2.6 * kx, t2 - lip - 0.3 * k, 0.08 * kz, 1.7 * kx, (lip + t2) / 2 - 0.1 * k, s * (gw - 0.04 * kz), 0.02);
      glow(t, kit, 1.5 * kx, t2 - 1.25 * k, s * (gw - 0.09 * kz), 2.2 * kx, 0.08 * k, 0.05 * kz, undefined, kit.plasma);
      hazard(t, kit, 2.95 * kx, hornTop - 0.05 * k, cz, 0.12 * kx, 0.8 * kz, 4, Math.PI / 2);
    });
    // chin cradle under the gun: a heavy sloped block filling the slot floor, glacis forward
    block(t, kit.armor2, 1.65 * kx, yW - 0.02, 0, 2.7 * kx, 2 * gw - 0.06 * kz, t2 - 0.92 * k - yW, { top: [0.88, 1], shift: [-0.15 * kx, 0], ch: 0.08 * k, bev: 0.06 * k });
    armorPlate(t, kit, kit.shell, frame([2.95 * kx, (yW + t2 - 0.9 * k) / 2, 0], [1, 0.3, 0], [0, 0, 1]), rectP(2 * gw - 0.4 * kz, (t2 - yW) * 0.42, 0.1 * k), u * 1.2, { standoff: u * 0.5 });
    if (!armed(0)) block(t, kit.hull, 1.6 * kx, t2 - 0.95 * k, 0, 2.6 * kx, 2 * gw - 0.1 * kz, 0.9 * k, { top: [0.8, 0.9], ch: 0.2 * k });
    // walls of the rear block: plates proud of the walls, slits forward, grilles astern
    for (let i = 0; i < PR.length; i++) {
      const f = wallFace(PR, i, [lip + 0.25 * k, 1.0], [sh2, 0.95]);
      if (f.w < 0.6 * k) continue;
      if (f.n.x < -0.85) { faceGrille(t, kit, f, 0, 0, f.w * 0.5, f.h * 0.5, 4); continue; }
      const n = Math.max(1, Math.round(f.w / (1.4 * k)));
      for (let j = 0; j < n; j++) facePlateHS(t, kit, f, (j + 0.5 - n / 2) * (f.w / n), -f.h * 0.06, (f.w / n) * 0.84, f.h * 0.62, u * 0.95, j % 2 ? kit.armor2 : kit.shell);
    }
    // roof: commander's cupola (rear left), sensor dome, antennas, banner
    const [cx0, , cz0] = base(2);
    block(t, kit.trim, cx0, t2 - 0.02, cz0, 1.25 * kx, 1.25 * kz, 0.22 * k, { ch: 0.2 * k });
    block(t, kit.hull, cx0, t2 + 0.15 * k, cz0, 1.1 * kx, 1.1 * kz, 0.7 * k, { top: [0.72, 0.75], shift: [-0.12 * kx, 0], ch: 0.26 * k, bev: 0.06 });
    glow(t, kit, cx0 + 0.42 * kx, t2 + 0.55 * k, cz0, 0.05, 0.07 * k, 0.6 * kz, [0, 0, -0.55]);
    if (!armed(2)) sensorDome(t, kit, cx0 - 0.15 * kx, t2 + 0.83 * k, cz0, 0.3 * k);
    whip(t, kit, cx0 - 0.4 * kx, t2 + 0.8 * k, cz0 - 0.38 * kz, 1.7 * k);
    mast(t, kit, -0.2 * kx, t2 - 0.05, -1.75 * kz, 1.3 * k, 0.045 * k);
    banner(t, kit, -2.25 * kx, t2 - 0.1, -1.55 * kz, 1.9 * k, 0.6 * k, -1);
    // corner gun tower (rear right): an armoured octagonal barbette rising out of the roof, the medium's seat
    {
      const [mx, my, mz] = base(1);
      octBarbette(t, kit, mx, t2 - 0.4 * k, mz, 0.95 * k, my - t2 + 0.7 * k, { mat: kit.hull });
    }
    // twin exhaust stacks clamped to the back wall, coolant run to the cupola
    both((s) => {
      const x = -2.82 * kx, z = (s < 0 ? -1.15 : -0.25) * kz, yb = yW + 0.3 * k, h = t2 + 1.3 * k - yb, r = 0.26 * k;
      block(t, kit.trim, x, yb, z, 0.7 * kx, 0.7 * kz, 0.5 * k, { top: [0.85, 0.85], ch: 0.15 * k });
      t.cylb(kit.metal, r, h, r * 0.15, [x, yb, z], 'y', 12);
      for (const f of [0.4, 0.7]) t.cylb(kit.trim, r * 1.14, 0.07 * k, 0.01, [x, yb + h * f, z], 'y', 12);
      t.cyl(kit.hot, r * 0.62, r * 0.62, 0.03, [x, yb + h + 0.01, z], 'y', 10);
      pbox(t, kit.metal, 0.4 * kx, 0.08 * k, 0.12 * kz, x + 0.25 * kx, yb + h * 0.6, z);
    });
    pipeRun(t, kit, [[-2.55 * kx, t2 - 0.3 * k, -0.7 * kz], [-2.1 * kx, t2 + 0.12 * k, -0.7 * kz], [cx0 - 0.6 * kx, t2 + 0.12 * k, cz0 + 0.3 * kz]], 0.07 * k, kit.joint);
    ladder(t, kit, [-2.78 * kx, lip + 0.2 * k, 1.0 * kz], [-2.78 * kx, t2 + 0.1 * k, 1.0 * kz], 0.32 * k, [0, 0, 1], [-1, 0, 0], 0.03 * k);
    cagedLamp(t, kit, frame([0.15 * kx, t2, 1.9 * kz], [0, 1, 0], [1, 0, 0.4]), 0.2 * k, fine);
  };

  // ---- legs: hip housings slung under the skirt
  let hips: Hip[] | undefined;
  if (stance.legs === 'biped') {
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.2 * kx, stance.hipY, s * 1.85 * kz] as V3, side: s, t: stance.thick * 1.25, foot: [-0.2 * kx, 0, s * 2.2 * kz] as V3, phase: s > 0 ? Math.PI : 0 }));
    both((s) => {
      block(b, kit.mech, -0.2 * kx, y0 - 0.3 * k, s * 1.85 * kz, 1.4 * kx, 0.9 * kz, 0.6 * k, { top: [0.8, 0.8], ch: 0.2 * k });
      for (const dx of [-0.5, 0.5]) piston(b, kit, [-0.2 * kx + dx * kx, y0 - 0.05 * k, s * 1.85 * kz], [-0.2 * kx + dx * 1.6 * kx, yt - 0.05, s * 1.7 * kz], 0.1 * k, 0.55, fine);
    });
  }
  const at: V3 = [0, yW, 0];
  if (!heroM) casemate(b, (i) => c.mounts.some((m) => m.i === i && m.mod.kind === 'weapon'));
  const toYaw = (p: V3): V3 => [p[0] - at[0], p[1] - at[1], p[2] - at[2]];
  const top1 = P1.map(([x, z]) => [x * sTop, z * sTop] as P2);
  return {
    deckAt: (x, z) => (Math.hypot(x / kx, z / kz) < 2.3 ? t2 : inside(top1, x, z) ? s1 : -1), top: t2 + 1.3 * k, custom: true, dressed: true, hips,
    seat: (m: MountSpec) => {
      if (m === heroM) return { y: yW, socket: true };
      if (m.mod.kind === 'weapon') return { y: base(m.i)[1], socket: true };
      // a utility: on the static skirt-top ledge outside the casemate's sweep, or over the roof when it stands inside it
      const out = Math.hypot(m.x / kx, m.z / kz) > 2.9;
      const y = out ? s1 + 0.25 * k : t2 + 1.0 * k;
      if (out) block(b, kit.trim, m.x, s1 - 0.02, m.z, m.r * 1.6, m.r * 1.6, 0.27 * k, { ch: m.r * 0.3 });
      collar(b, kit, m.x, y, m.z, m.r, y - 0.05 * k, 12);
      return { y, socket: true };
    },
    torso: heroM ? (t, { heroR }) => {
      casemate(shiftTo(t, at), ts.armed);
      return { hp: torsoHP(ts, (i) => toYaw(base(i)), heroR), at };
    } : undefined,
  };
}

registerChassis('monolith', monolith);
registerTorso('monolith');
