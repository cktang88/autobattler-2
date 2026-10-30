// Walker hulls, all built in mech torso mode round their fixed-size weapons (the upper body twists with the guns):
//   strider  (mech)      heavy assault mech: the main gun is the right forearm under a massive pauldron, a light gun
//                        on the left forearm, a second one in a launcher bay on the left shoulder
//   mantis   (mantis)    lean predator: long thorax thrust forward, the main light gun slung under a wedge head between
//                        raptorial forelimbs with scythe blades, the second on a flaring dorsal hump between swept
//                        blade fins, a segmented abdomen trailing behind (one cell wide: both guns on the centre line)
//   arachnid (arachnid)  orb walker: an armoured orb on a four-legged hub, twin medium guns on shoulder sockets
// and the Warlord (a heavy assault walker: its arm guns are the forearms, a dorsal shoulder cannon, see below).

import * as THREE from 'three';
import type { P2, V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { lathe as latheGeo, mtx, slabGeo, strutGeo, type MatLike } from '../geo.ts';
import { Bld } from '../geo.ts';
import { registerChassis, registerTorso, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar, exhaust, glow, hazard, sensor } from './shapes.ts';
import {
  antenna, armorPlate, cableBundle, crewHatch, exhaustBox, fineFor, frame, frameLimb, hexSec, hose, jointDrum, ladder, piston, plateStack, rectP, trapP,
} from './hs-kit.ts';
import { archShell, claw, eyeCluster, shellGeo } from './hs-kit-organic.ts';
import { torsoSlots } from './torso-kit.ts';

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

// ---- shared mech-torso plumbing ------------------------------------------------------------------------------------------
// All three walkers build their upper body in mech torso mode (ChassisOut.torso, see `raider` in chassis/mechframes.ts):
// the torso twists with its weapons, and the builder places the fixed-size weapons (units3d DRAW_D: S 0.75, M 1.5) at
// hardpoints it designed round them. The static body under the pivot is the pelvis / leg hub only.

const XA: V3 = [1, 0, 0];
const pbox = (b: Bld, mat: MatLike, w: number, h: number, d: number, x: number, y: number, z: number, rot?: V3) => b.g(new THREE.BoxGeometry(w, h, d), mat, mtx([x, y, z], rot));

/** flat plate in the x-y plane (a fin / blade / side cheek): poly in world (x, y), thickness th centred on z */
function fin(b: Bld, mat: MatLike, poly: P2[], z: number, th: number, bev = th * 0.3, yaw = 0): void {
  const g = slabGeo(poly, th, Math.min(bev, th * 0.45));
  // slab: poly in (x, z) extruded along +y; rotate so poly z -> world y and the thickness runs along -z
  b.g(g, mat, new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeTranslation(0, 0, z + th / 2)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)));
}

/** glowing core in a ribbed dark cage (vertical swivel / waist): emissive drum, n ribs, dark rims */
function cage(b: Bld, kit: Kit, x: number, y: number, z: number, r: number, h: number, n: number): void {
  b.cyl(kit.plasma, r * 0.8, r * 0.8, h, [x, y, z], 'y', Math.max(8, n));
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    b.g(new THREE.BoxGeometry(r * 0.34, h, ((Math.PI * 2 * r) / n) * 0.5), kit.mech, new THREE.Matrix4().makeRotationY(-a).setPosition(x + Math.cos(a) * r * 0.88, y + h / 2, z + Math.sin(a) * r * 0.88));
  }
  for (const yy of [y - r * 0.05, y + h - r * 0.08]) b.cylb(kit.mech, r * 1.04, r * 0.13, r * 0.04, [x, yy, z], 'y', Math.max(8, n));
}

/** closed shell band of an ellipsoid (radii rx, ry, rz) between latitudes a0..a1 (radians), thickness th, at c */
function orbBand(b: Bld, mat: MatLike, c: V3, rx: number, ry: number, rz: number, a0: number, a1: number, th: number, n = 6, seg = 18): void {
  const out: P2[] = [], inn: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([Math.cos(a), Math.sin(a)]);
  }
  for (let i = n; i >= 0; i--) inn.push([out[i][0] * (1 - th), out[i][1] * (1 - th)]);
  const prof = [...out, ...inn, out[0]].map(([r, y]) => [Math.max(0, r), y] as P2);
  b.g(latheGeo(prof, seg), mat, new THREE.Matrix4().makeTranslation(c[0], c[1], c[2]).multiply(new THREE.Matrix4().makeScale(rx, ry, rz)));
}

/** the weapon-carrying chassis output: a torso when there is a weapon to carry it, else the same upper body built static
 *  (all-utility fits) with the utilities on masts at their mounts */
function torsoOut(c: ChassisCtx, at: V3, build: (t: Bld, heroR: number, podR: number[]) => V3[], top: number, base: Omit<ChassisOut, 'torso' | 'top'>): ChassisOut {
  const { b, kit } = c;
  const hero = c.mounts.filter((m) => m.mod.kind === 'weapon').reduce<MountSpec | undefined>((a, m) => (!a || m.r > a.r ? m : a), undefined);
  if (!hero) {
    const tb = new Bld(), g = new THREE.Group();
    g.position.set(...at);
    build(tb, 0.375, []);
    tb.mount(g);
    c.body.add(g);
  }
  return {
    ...base, top, custom: true, dressed: true,
    seat: (m) => {
      if (m === hero) return { y: at[1], socket: true };
      // a utility (shield, repair rig, ...) stands on a dark mast at its own mount, over the torso
      const y = top + 0.02;
      block(b, kit.mech, m.x, at[1] - 0.05, m.z, m.r * 0.5, m.r * 0.5, y - at[1] + 0.03, { ch: m.r * 0.12, bev: m.r * 0.04 });
      collar(b, kit, m.x, y, m.z, m.r, y - 0.04, 12);
      return { y, socket: true };
    },
    torso: hero ? (t, r) => ({ hp: build(t, r.heroR, r.podR), at }) : undefined,
  };
}

// ---- Strider: heavy assault mech ---------------------------------------------------------------------------------------
// War Robots / BattleTech heavy built round its guns: the main (M) weapon is the whole right forearm, hanging under a
// massive layered pauldron; a slimmer left arm carries the first light gun on its forearm; the second light gun rides a
// launcher bay on the left shoulder (Timber Wolf). The torso is hunched forward: a high armoured hump with the shoulders
// above a low dark head (a V of hot visor slits), a reactor pack with exhaust horns on the back. Top-heavy and
// asymmetric: big gun right, two small guns stacked left.
function strider(c: ChassisCtx): ChassisOut {
  const { b, kit, W, L, stance, S } = c;
  const u = Math.min(L, W) / 2; // authored at 2 x 2
  const fine = fineFor(S);
  const biped = stance.legs === 'biped', spider = stance.legs === 'spider';
  let P: number, hips: Hip[] | undefined;
  if (biped) {
    const hy = stance.hipY, t = stance.thick;
    // pelvis: dark frame block, armoured codpiece, hip drums, team tassets hanging over the thighs
    block(b, kit.mech, -0.05 * u, hy - t * 1.0, 0, 0.42 * u, 0.44 * u, t + 0.16 * u, { top: [0.86, 1.0], ch: 0.08 * u, bev: 0.02 * u });
    block(b, kit.armor2, 0.17 * u, hy - t * 1.35, 0, 0.14 * u, 0.2 * u, t * 1.5, { top: [0.6, 0.8], shift: [0.03 * u, 0], ch: 0.04 * u, bev: 0.012 * u, bot: 0.01 * u });
    pbox(b, kit.glow, 0.012 * u, 0.06 * u, 0.05 * u, 0.23 * u, hy - t * 0.55, 0);
    both((s) => {
      jointDrum(b, kit, [-0.05 * u, hy, s * 0.25 * u], t * 0.8, 0.1 * u, 'z');
      block(b, kit.armor, -0.03 * u, hy - t * 1.1, s * 0.44 * u, 0.32 * u, 0.06 * u, t * 2.0, { top: [0.82, 0.9], shift: [0.02 * u, -s * 0.015 * u], ch: 0.025 * u, bev: 0.012 * u });
      block(b, kit.shell, -0.03 * u, hy + t * 0.85, s * 0.43 * u, 0.24 * u, 0.09 * u, 0.035 * u, { top: [0.8, 0.8], ch: 0.02 * u, bev: 0.008 * u });
    });
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.05 * u, hy, s * 0.34 * u] as V3, side: s, t, foot: [-0.02 * u, 0, s * 0.42 * u] as V3, phase: s > 0 ? Math.PI : 0 }));
    P = hy + 0.27 * u;
  } else if (spider) {
    // four-legged assault frame: an armoured leg hub, the torso on top
    const hy = stance.hipY, t = stance.thick;
    block(b, kit.mech, -0.04 * u, hy - t * 1.4, 0, 0.8 * u, 0.74 * u, t * 2.6, { top: [0.86, 0.86], ch: 0.16 * u, bev: 0.02 * u, bot: 0.02 * u });
    block(b, kit.armor2, -0.04 * u, hy + t * 1.1, 0, 0.66 * u, 0.6 * u, 0.06 * u, { top: [0.9, 0.9], ch: 0.12 * u, bev: 0.015 * u });
    hips = [];
    for (const [hx, fx, ph] of [[0.26, 0.82, 0], [-0.32, -0.92, Math.PI]] as [number, number, number][]) for (const s of [-1, 1] as const) {
      hips.push({ p: [hx * u, hy, s * 0.36 * u], side: s, t, foot: [fx * u, 0, s * 0.98 * u], phase: ph + (s > 0 ? Math.PI : 0) });
      block(b, kit.armor, hx * u, hy - t * 0.9, s * 0.36 * u, 0.24 * u, 0.16 * u, t * 2.2, { top: [0.8, 0.85], ch: 0.04 * u, bev: 0.012 * u });
    }
    P = hy + t * 1.1 + 0.16 * u;
  } else {
    P = stance.y0 + 0.3 * u;
    block(b, kit.mech, -0.04 * u, stance.y0 - 0.02, 0, 0.7 * u, 0.7 * u, P - 0.12 * u - stance.y0 + 0.02, { top: [0.86, 0.86], ch: 0.16 * u, bev: 0.02 * u });
  }
  const at: V3 = [-0.04 * u, P, 0];
  // waist: glowing core in a ribbed cage, the swivel the upper body twists on
  const wb = biped ? stance.hipY + 0.08 * u : P - 0.14 * u;
  cage(b, kit, at[0], wb, 0, 0.15 * u, P - wb, 10);
  if (biped) both((s) => piston(b, kit, [0.06 * u, stance.hipY - 0.02 * u, s * 0.15 * u], [0.04 * u, P - 0.02 * u, s * 0.13 * u], 0.024 * u, 0.55, fine));
  b.cylb(kit.joint, 0.17 * u, 0.025 * u, 0.008 * u, [at[0], P - 0.024 * u, 0], 'y', 14);

  const build = (t: Bld, heroR: number, podR: number[]): V3[] => {
    // ---- the hero arm: the main weapon is the right forearm; its trunnion just outside the chest flank
    const hz = 0.3 * u + heroR * 0.78, hy = 0.0, hx = 0.14 * u;
    const zc = -0.12 * u; // the torso sits left of the pivot, the big gun right of it
    // ---- core: swivel collar, dark abdomen, dark chest core (narrow at gun height, the shoulders widen above it)
    t.cylb(kit.mech, 0.2 * u, 0.06 * u, 0.012 * u, [0, 0, 0], 'y', 14);
    block(t, kit.mech, -0.06 * u, 0.03 * u, zc + 0.04 * u, 0.5 * u, 0.5 * u, 0.26 * u, { top: [1.06, 1.08], ch: 0.08 * u, bev: 0.02 * u });
    block(t, kit.mech, -0.1 * u, 0.24 * u, zc - 0.02 * u, 0.8 * u, 0.74 * u, 0.42 * u, { top: [0.9, 0.92], ch: 0.1 * u, bev: 0.02 * u });
    // belly armour: a team plate stepping out under the chest, glowing core slot above it
    block(t, kit.armor2, 0.14 * u, 0.05 * u, zc + 0.04 * u, 0.26 * u, 0.42 * u, 0.22 * u, { top: [0.6, 0.85], shift: [0.05 * u, 0], ch: 0.06 * u, bev: 0.015 * u, bot: 0.01 * u });
    pbox(t, kit.plasma, 0.03 * u, 0.06 * u, 0.32 * u, 0.27 * u, 0.3 * u, zc + 0.04 * u, [0, 0, -0.5]);
    // ---- the hump: a high armoured carapace, highest at the back, sloping down to the face (hunched forward)
    block(t, kit.armor, -0.12 * u, 0.46 * u, zc - 0.02 * u, 1.04 * u, 1.08 * u, 0.5 * u, { top: [0.48, 0.62], shift: [-0.22 * u, 0], ch: 0.13 * u, bev: 0.03 * u, bot: 0.02 * u, mid: [[0.36, 0.95, 1.02]] });
    block(t, kit.armor2, -0.34 * u, 0.94 * u, zc - 0.02 * u, 0.46 * u, 0.6 * u, 0.06 * u, { top: [0.8, 0.82], shift: [-0.03 * u, 0], ch: 0.07 * u, bev: 0.015 * u });
    block(t, kit.shell, -0.36 * u, 0.995 * u, zc - 0.02 * u, 0.32 * u, 0.36 * u, 0.04 * u, { top: [0.7, 0.75], ch: 0.04 * u, bev: 0.01 * u });
    // the face: a dark visor band across the sloped front with a V of hot slits, an overhanging team brow over it,
    // layered plates above, and a jutting dark beak below
    const fF = frame([0.33 * u, 0.62 * u, zc - 0.02 * u], [0.78, 0.62, 0], [0, 0, 1]);
    armorPlate(t, kit, kit.mech, fF, trapP(0.5 * u, 0.12 * u, 0.12 * u, 0.03 * u), 0.03 * u, { standoff: 0.008 * u, back: null });
    both((sd) => t.g(new THREE.BoxGeometry(0.17 * u, 0.02 * u, 0.032 * u), kit.hot, fF.clone().multiply(new THREE.Matrix4().makeTranslation(sd * 0.1 * u, 0.04 * u, -0.012 * u)).multiply(new THREE.Matrix4().makeRotationY(sd * 0.32))));
    plateStack(t, kit, kit.armor2, frame([0.22 * u, 0.76 * u, zc - 0.02 * u], [0.72, 0.7, 0], [0, 0, 1]), trapP(0.62 * u, 0.2 * u, 0.3 * u, 0.06 * u), [
      { inset: 0, thick: 0.04 * u, standoff: 0.015 * u },
      { inset: 0.06 * u, thick: 0.03 * u, shift: [0, -0.04 * u], mat: kit.shell },
    ], { gap: 0.02 * u });
    block(t, kit.armor, 0.38 * u, 0.66 * u, zc - 0.02 * u, 0.12 * u, 0.6 * u, 0.06 * u, { top: [0.5, 0.86], shift: [0.05 * u, 0], ch: 0.04 * u, bev: 0.012 * u, bot: 0.01 * u });
    block(t, kit.armor2, 0.42 * u, 0.24 * u, zc - 0.02 * u, 0.24 * u, 0.3 * u, 0.3 * u, { top: [0.3, 0.55], shift: [0.08 * u, 0], ch: 0.08 * u, bev: 0.014 * u, bot: 0.012 * u });
    pbox(t, kit.plasma, 0.03 * u, 0.05 * u, 0.12 * u, 0.53 * u, 0.36 * u, zc - 0.02 * u, [0, 0, -0.6]);
    both((sd) => armorPlate(t, kit, kit.armor, frame([0.42 * u, 0.36 * u, zc - 0.02 * u + sd * 0.2 * u], [0.5, 0.0, sd], XA), trapP(0.3 * u, 0.16 * u, 0.3 * u, 0.03 * u), 0.03 * u, { standoff: 0.012 * u }));
    // ---- shoulder yoke: a dark bar right across the top, carrying both shoulders
    block(t, kit.mech, -0.16 * u, 0.6 * u, zc + 0.1 * u, 0.36 * u, 1.72 * u, 0.18 * u, { top: [0.9, 0.96], ch: 0.06 * u, bev: 0.015 * u });
    // ---- reactor pack on the back: dark block, glowing vent stack, two exhaust horns raking up and back
    block(t, kit.mech, -0.66 * u, 0.24 * u, zc, 0.26 * u, 0.56 * u, 0.56 * u, { top: [0.8, 0.9], shift: [-0.03 * u, 0], ch: 0.06 * u, bev: 0.015 * u });
    for (const f of [0.36, 0.5, 0.64]) pbox(t, kit.plasma, 0.02 * u, 0.05 * u, 0.4 * u, -0.8 * u, f * u, zc);
    for (const f of [0.29, 0.43, 0.57, 0.71]) pbox(t, kit.mech, 0.035 * u, 0.03 * u, 0.44 * u, -0.8 * u, f * u, zc);
    both((sd) => {
      const z = zc + sd * 0.2 * u;
      beam(t, kit.armor2, [-0.7 * u, 0.7 * u, z], [-0.88 * u, 1.08 * u, z + sd * 0.03 * u], 0.1 * u, 0.1 * u);
      t.cyl(kit.hot, 0.04 * u, 0.04 * u, 0.012 * u, [-0.887 * u, 1.098 * u, z + sd * 0.03 * u], 'y', 8);
      if (fine) hose(t, kit, [-0.58 * u, 0.32 * u, z + sd * 0.1 * u], [-0.24 * u, 0.12 * u, z + sd * 0.2 * u], 0.02 * u, 0.12);
    });
    // ---- right shoulder + arm: joint drum in the yoke, a massive layered pauldron over the gun, the upper arm down to
    // an elbow on the gun's back (the gun IS the forearm)
    const shR: V3 = [-0.16 * u, 0.6 * u, hz - 0.3 * u], elR: V3 = [-0.4 * u, hy + heroR * 0.5, hz];
    jointDrum(t, kit, shR, 0.17 * u, 0.22 * u, 'z');
    beam(t, kit.mech, shR, elR, 0.17 * u, 0.16 * u, [0, 0, 1]);
    piston(t, kit, [-0.06 * u, 0.58 * u, hz - 0.12 * u], [elR[0] + 0.14 * u, elR[1] + 0.03 * u, hz - 0.08 * u], 0.026 * u, 0.55, fine);
    jointDrum(t, kit, elR, 0.12 * u, 0.26 * u, 'z');
    const pz = hz;
    block(t, kit.armor2, -0.24 * u, 0.62 * u, pz, 1.0 * u, 0.7 * u, 0.14 * u, { top: [0.94, 0.94], ch: 0.1 * u, bev: 0.015 * u });
    block(t, kit.armor, -0.24 * u, 0.74 * u, pz + 0.02 * u, 1.02 * u, 0.7 * u, 0.3 * u, { top: [0.56, 0.62], shift: [-0.12 * u, 0.06 * u], ch: 0.13 * u, bev: 0.03 * u, bot: 0.015 * u, mid: [[0.4, 0.92, 0.98]] });
    block(t, kit.shell, -0.34 * u, 1.03 * u, pz + 0.08 * u, 0.38 * u, 0.26 * u, 0.045 * u, { top: [0.6, 0.8], shift: [-0.04 * u, 0], ch: 0.04 * u, bev: 0.01 * u });
    // front lip of the pauldron hanging over the gun, glowing slot under it
    block(t, kit.armor2, 0.2 * u, 0.6 * u, pz, 0.14 * u, 0.6 * u, 0.16 * u, { top: [0.4, 0.9], shift: [-0.04 * u, 0], ch: 0.05 * u, bev: 0.012 * u, bot: 0.01 * u });
    pbox(t, kit.accent, 0.5 * u, 0.012 * u, 0.07 * u, -0.3 * u, 1.02 * u, pz + 0.21 * u, [0, 0, 0.1]);
    fin(t, kit.armor2, [[-0.4 * u, 0.98 * u], [-0.86 * u, 1.1 * u], [-1.0 * u, 1.26 * u], [-0.6 * u, 1.02 * u]], pz + 0.22 * u, 0.035 * u);
    pbox(t, kit.glow, 0.5 * u, 0.025 * u, 0.012 * u, -0.22 * u, 0.7 * u, pz + 0.356 * u);
    // ---- left arm: shoulder drum, upper arm, elbow, an armoured forearm the first light gun is seated in (its ring sunk
    // into the forearm, only the lip shows)
    const r1 = podR[0] ?? 0.375, lz = -(0.62 * u + r1 * 0.4), ly = 0.0, ftop = ly + r1 * 0.4;
    const shL: V3 = [-0.14 * u, 0.6 * u, -0.66 * u], elL: V3 = [-0.26 * u, ly + 0.02 * u, lz];
    jointDrum(t, kit, shL, 0.14 * u, 0.2 * u, 'z');
    beam(t, kit.mech, shL, elL, 0.12 * u, 0.13 * u, [0, 0, -1]);
    armorPlate(t, kit, kit.armor, frame([(shL[0] + elL[0]) / 2, (shL[1] + elL[1]) / 2, lz - 0.08 * u], [0, 0, -1], [elL[0] - shL[0], elL[1] - shL[1], 0]), rectP(0.44 * u, 0.17 * u, 0.03 * u), 0.03 * u, { standoff: 0.012 * u });
    jointDrum(t, kit, elL, 0.1 * u, 0.22 * u, 'z');
    block(t, kit.mech, 0.04 * u, ly - 0.24 * u, lz, 0.64 * u, r1 * 1.5, ftop - ly + 0.23 * u, { top: [0.94, 0.94], ch: 0.07 * u, bev: 0.015 * u });
    block(t, kit.armor, 0.08 * u, ly - 0.2 * u, lz - 0.03 * u, 0.62 * u, r1 * 1.5, 0.24 * u, { top: [0.82, 0.86], shift: [0.03 * u, -0.01 * u], ch: 0.08 * u, bev: 0.02 * u, bot: 0.012 * u });
    pbox(t, kit.glow, 0.32 * u, 0.025 * u, 0.012 * u, 0.08 * u, ly - 0.1 * u, lz - r1 * 0.75 - 0.035 * u);
    block(t, kit.shell, 0.34 * u, ly - 0.22 * u, lz, 0.1 * u, r1 * 1.1, 0.16 * u, { top: [0.5, 0.9], shift: [0.03 * u, 0], ch: 0.03 * u, bev: 0.01 * u });
    // ---- left shoulder: a launcher bay the second light gun is sunk into, or a three-plate pauldron without one
    const r2 = podR[1] ?? 0.375, bz = -0.62 * u, bx = -0.2 * u, bY = 0.9 * u, btop = bY + r2 * 0.4;
    if (podR.length > 1) {
      block(t, kit.mech, bx, 0.62 * u, bz, 0.5 * u, r2 * 1.5, btop - 0.62 * u - 0.02 * u, { top: [0.94, 0.94], ch: 0.07 * u, bev: 0.012 * u });
      block(t, kit.armor, bx - 0.02 * u, 0.66 * u, bz - 0.02 * u, 0.6 * u, r2 * 1.56, btop - 0.66 * u - 0.07 * u, { top: [0.86, 0.9], shift: [-0.02 * u, 0], ch: 0.08 * u, bev: 0.018 * u, bot: 0.01 * u });
      for (const f of [0.74, 0.8]) pbox(t, kit.plasma, 0.3 * u, 0.025 * u, 0.012 * u, bx - 0.04 * u, f * u, bz - r2 * 0.78 - 0.03 * u);
      fin(t, kit.armor2, [[bx - 0.1 * u, btop - 0.04 * u], [bx - 0.5 * u, btop + 0.05 * u], [bx - 0.6 * u, btop + 0.16 * u], [bx - 0.3 * u, btop]], bz - r2 * 0.78 - 0.02 * u, 0.03 * u);
    } else {
      for (let i = 0; i < 3; i++) {
        const a = 0.3 + i * 0.4;
        const F = frame([-0.16 * u, 0.8 * u - i * 0.08 * u, -(0.66 + i * 0.08) * u], [0, Math.cos(a), -Math.sin(a)], XA);
        armorPlate(t, kit, i === 1 ? kit.armor2 : kit.armor, F, trapP((0.56 - i * 0.06) * u, (0.36 - i * 0.04) * u, (0.28 - i * 0.03) * u, 0.04 * u), 0.04 * u, { standoff: 0.02 * u, gap: 0.025 * u });
      }
    }
    // waist rams from the abdomen to the chest
    both((sd) => piston(t, kit, [0.04 * u, 0.05 * u, zc + sd * 0.22 * u], [0.02 * u, 0.34 * u, zc + sd * 0.3 * u], 0.022 * u, 0.5, fine));
    if (fine) antenna(t, kit, -0.5 * u, 0.94 * u, zc + 0.24 * u, 0.42 * u, 0.006 * u, [-0.3, 0, 0.05]);
    return [[hx, hy, hz], [0.16 * u, ly, lz], [bx + 0.02 * u, bY, bz]];
  };
  return torsoOut(c, at, build, P + 1.0 * u, {
    hips,
    deckAt: (x, z) => (Math.abs(x) < 0.4 * u && Math.abs(z) < 0.4 * u ? P : -1),
  });
}

// ---- Needle Frame (mantis): lean predator ------------------------------------------------------------------------------
// A praying-mantis gunship, one cell wide with both guns on its centre line: a long thorax thrust forward of the hips,
// the main gun slung low under a small wedge head (a V of hot eyes) and clasped by two raptorial forelimbs with hooked
// scythe blades; behind the shoulders the back rises into a flaring hump whose crown cradles the second gun between two
// tall swept blade fins; the segmented abdomen with its stinger (static) trails behind the hips.
function needle(c: ChassisCtx): ChassisOut {
  const { b, kit, W, L, stance } = c;
  const k = Math.min(W, L / 2); // authored for the 1 x 2 frame
  const biped = stance.legs === 'biped', spider = stance.legs === 'spider';
  let P: number, hips: Hip[] | undefined;
  if (biped) {
    const hy = stance.hipY, t = stance.thick;
    block(b, kit.mech, -0.12 * k, hy - t * 0.9, 0, 0.26 * k, 0.24 * k, t * 0.9 + 0.1 * k, { top: [0.86, 1.0], ch: 0.06 * k, bev: 0.012 * k });
    both((s) => jointDrum(b, kit, [-0.12 * k, hy, s * 0.13 * k], t * 0.75, 0.06 * k, 'z'));
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.12 * k, hy, s * 0.17 * k] as V3, side: s, t, foot: [-0.08 * k, 0, s * 0.22 * k] as V3, phase: s > 0 ? Math.PI : 0 }));
    P = hy + 0.13 * k;
  } else if (spider) {
    const hy = stance.hipY, t = stance.thick;
    block(b, kit.mech, -0.14 * k, hy - t * 1.2, 0, 0.5 * k, 0.26 * k, t * 2.2, { top: [0.86, 0.86], ch: 0.08 * k, bev: 0.012 * k });
    hips = [];
    for (const [hx, fx, fz, ph] of [[0.0, 0.4, 0.62, 0], [-0.3, -0.66, 0.56, Math.PI]] as [number, number, number, number][]) for (const s of [-1, 1] as const) {
      hips.push({ p: [hx * k, hy, s * 0.12 * k], side: s, t, foot: [fx * k, 0, s * fz * k], phase: ph + (s > 0 ? Math.PI : 0) });
    }
    P = hy + t * 1.0 + 0.08 * k;
  } else {
    // hover: a dark keel over the lift fans
    P = stance.y0 + 0.24 * k;
    block(b, kit.mech, -0.2 * k, stance.y0, 0, 0.9 * k, 0.3 * k, P - 0.04 * k - stance.y0, { top: [0.9, 0.9], ch: 0.08 * k, bev: 0.015 * k });
  }
  const at: V3 = [-0.1 * k, P, 0];
  const wb = P - 0.1 * k;
  cage(b, kit, at[0], wb, 0, 0.08 * k, 0.1 * k, 8);
  // ---- abdomen (static): three tapering armoured segments trailing back from the hips, dark gaps, glow between them
  const ay = P - 0.02 * k;
  const seg: [number, number, number, number, number][] = [[-0.3, 0.2, 0.24, ay + 0.02 * k, 0.15], [-0.52, 0.2, 0.2, ay + 0.04 * k, 0.13], [-0.74, 0.18, 0.15, ay + 0.03 * k, 0.1]];
  for (const [x, l, w, y, h] of seg) {
    block(b, kit.mech, x * k, y - h * 0.55 * k, 0, l * 1.05 * k, w * 0.8 * k, h * 0.8 * k, { ch: 0.04 * k, bev: 0.01 * k });
    block(b, kit.armor, x * k, y - h * 0.3 * k, 0, l * k, w * k, h * k, { top: [0.8, 0.62], shift: [-0.02 * k, 0], ch: 0.05 * k, bev: 0.015 * k, bot: 0.01 * k });
    pbox(b, kit.shell, l * 0.6 * k, 0.012 * k, w * 0.35 * k, x * k - 0.01 * k, y + h * 0.7 * k + 0.004 * k, 0);
  }
  for (const x of [-0.41, -0.63]) pbox(b, kit.plasma, 0.025 * k, 0.07 * k, 0.12 * k, x * k, ay + 0.02 * k, 0);
  // stinger: a dark spike out of the last segment, hot tip
  b.strut(kit.mech, [-0.82 * k, ay + 0.06 * k, 0], [-0.98 * k, ay + 0.16 * k, 0], 0.035 * k, 0.01 * k, 6);
  pbox(b, kit.hot, 0.02 * k, 0.02 * k, 0.02 * k, -0.95 * k, ay + 0.14 * k, 0);

  const build = (t: Bld, heroR: number, podR: number[]): V3[] => {
    const r1 = podR[0] ?? 0.375;
    // the main gun is slung under the head, clasped by the raptorial forelimbs; the second gun rides a raised dorsal
    // saddle over the shoulders. Both on the centre line: the frame stays one cell wide.
    const gx = 0.46 * k, gy = -0.02 * k, gz = 0;
    const dx = -0.24 * k, dy = 0.34 * k, dtop = dy + r1 * 0.4;
    // ---- thorax: a long narrow dark core leaning forward, layered team shells, glowing spine slit
    t.cylb(kit.mech, 0.1 * k, 0.04 * k, 0.008 * k, [0, 0, 0], 'y', 10);
    beam(t, kit.mech, [-0.2 * k, 0.12 * k, 0], [0.36 * k, 0.16 * k, 0], 0.22 * k, 0.2 * k);
    block(t, kit.armor, 0.02 * k, 0.06 * k, 0, 0.5 * k, 0.32 * k, 0.24 * k, { top: [0.66, 0.6], shift: [-0.04 * k, 0], ch: 0.08 * k, bev: 0.018 * k, bot: 0.012 * k, mid: [[0.4, 1.02, 1.06]] });
    block(t, kit.armor2, 0.24 * k, 0.16 * k, 0, 0.24 * k, 0.24 * k, 0.12 * k, { top: [0.6, 0.7], shift: [0.04 * k, 0], ch: 0.05 * k, bev: 0.012 * k });
    pbox(t, kit.plasma, 0.16 * k, 0.025 * k, 0.03 * k, 0.12 * k, 0.29 * k, 0, [0, 0, -0.2]);
    // ---- head: low triangular wedge over the gun, a V of hot eyes, mandible blades either side of the barrel
    const hx = 0.54 * k, hY = gy + Math.max(0.17 * k, heroR * 0.5);
    block(t, kit.mech, hx - 0.12 * k, hY - 0.02 * k, 0, 0.2 * k, 0.16 * k, 0.1 * k, { ch: 0.03 * k, bev: 0.01 * k });
    block(t, kit.armor, hx, hY, 0, 0.26 * k, 0.24 * k, 0.12 * k, { top: [0.3, 0.55], shift: [0.08 * k, 0], ch: 0.07 * k, bev: 0.012 * k, bot: 0.008 * k });
    block(t, kit.armor2, hx - 0.06 * k, hY + 0.1 * k, 0, 0.2 * k, 0.2 * k, 0.05 * k, { top: [0.4, 0.6], shift: [0.06 * k, 0], ch: 0.05 * k, bev: 0.01 * k });
    both((sd) => {
      pbox(t, kit.hot, 0.014 * k, 0.02 * k, 0.07 * k, hx + 0.11 * k, hY + 0.08 * k, sd * 0.04 * k, [0, sd * 0.55, -sd * 0.45]);
      t.strut(kit.joint, [hx + 0.06 * k, hY + 0.01 * k, sd * 0.1 * k], [hx + 0.24 * k, hY - 0.06 * k, sd * 0.06 * k], 0.016 * k, 0.004 * k, 5);
    });
    // ---- raptorial forelimbs: shoulder drums at the thorax front, the upper limb dropping to an elbow beside the gun,
    // the forearm clasping the gun's flank, a hooked scythe blade hanging forward under it
    both((sd) => {
      const cz = sd * (Math.max(0.12 * k, heroR * 0.36) + 0.06 * k);
      const sh: V3 = [0.22 * k, 0.12 * k, sd * 0.17 * k], el: V3 = [gx - 0.22 * k, gy - 0.02 * k, cz];
      jointDrum(t, kit, sh, 0.07 * k, 0.08 * k, 'z');
      beam(t, kit.mech, sh, el, 0.07 * k, 0.08 * k, [0, 0, sd]);
      armorPlate(t, kit, kit.armor, frame([(sh[0] + el[0]) / 2, (sh[1] + el[1]) / 2, (sh[2] + el[2]) / 2 + sd * 0.045 * k], [0, 0, sd], [el[0] - sh[0], el[1] - sh[1], 0]), rectP(0.2 * k, 0.1 * k, 0.02 * k), 0.02 * k, { standoff: 0.008 * k });
      jointDrum(t, kit, el, 0.055 * k, 0.1 * k, 'z');
      beam(t, kit.armor2, el, [gx + 0.12 * k, gy - 0.04 * k, cz], 0.07 * k, 0.09 * k, [0, 1, 0]);
      fin(t, kit.shell, [[gx - 0.14 * k, gy - 0.08 * k], [gx + 0.14 * k, gy - 0.08 * k], [gx + 0.3 * k, gy - 0.2 * k], [gx + 0.28 * k, gy - 0.34 * k], [gx + 0.2 * k, gy - 0.2 * k], [gx - 0.06 * k, gy - 0.14 * k]], cz + sd * 0.012 * k - 0.0125 * k, 0.025 * k);
      pbox(t, kit.glow, 0.14 * k, 0.014 * k, 0.012 * k, gx - 0.02 * k, gy - 0.04 * k, cz + sd * 0.04 * k);
    });
    // ---- hunched back: the thorax rises behind the shoulders into a flaring armoured hump (wider at the top than at
    // its root) whose crown is the cradle the second gun's ring is sunk into; dark flank plates over glowing slots
    block(t, kit.mech, dx + 0.02 * k, 0.06 * k, 0, 0.44 * k, 0.26 * k, dtop - 0.12 * k, { top: [1.1, 1.8], shift: [-0.02 * k, 0], ch: 0.06 * k, bev: 0.012 * k });
    block(t, kit.armor, dx, 0.12 * k, 0, 0.52 * k, 0.34 * k, dtop - 0.12 * k, { top: [1.16, r1 * 1.66 / (0.34 * k)], shift: [-0.06 * k, 0], ch: 0.1 * k, bev: 0.02 * k, bot: 0.012 * k, mid: [[0.4, 1.12, 1.5], [0.75, 1.2, 1.86]] });
    // bone keel plate down the hump's front slope, dark louvres either side
    armorPlate(t, kit, kit.shell, frame([dx + 0.27 * k, (0.12 * k + dtop) / 2 + 0.02 * k, 0], [0.9, 0.3, 0], [0, 1, 0]), trapP(dtop - 0.22 * k, 0.1 * k, 0.16 * k, 0.02 * k), 0.02 * k, { standoff: 0.01 * k });

    pbox(t, kit.plasma, 0.025 * k, 0.04 * k, 0.24 * k, dx + 0.34 * k, dtop - 0.08 * k, 0, [0, 0, 0.5]);
    both((sd) => {
      const F = frame([dx - 0.04 * k, 0.24 * k, sd * 0.24 * k], [0, -0.35, sd], XA);
      pbox(t, kit.plasma, 0.3 * k, 0.03 * k, 0.012 * k, dx - 0.04 * k, 0.24 * k, sd * 0.215 * k, [sd * 0.35, 0, 0]);
      armorPlate(t, kit, kit.armor2, F, trapP(0.44 * k, 0.1 * k, 0.12 * k, 0.025 * k), 0.022 * k, { standoff: 0.012 * k, gap: 0.012 * k });
    });

    // tall blade fins swept back off the saddle's flanks, glow strips along them; wing-case vanes off the thorax
    both((sd) => {
      const fz = sd * (r1 * 0.83 + 0.015 * k);
      fin(t, kit.armor2, [[dx + 0.2 * k, dtop - 0.14 * k], [dx - 0.26 * k, dtop - 0.14 * k], [dx - 0.5 * k, dtop + 0.26 * k], [dx - 0.36 * k, dtop + 0.22 * k], [dx + 0.06 * k, dtop - 0.02 * k]], fz - 0.0125 * k, 0.025 * k);
      pbox(t, kit.glow, 0.24 * k, 0.014 * k, 0.034 * k, dx - 0.2 * k, dtop + 0.06 * k, fz, [0, 0, -0.72]);
      fin(t, kit.armor, [[0.1 * k, 0.18 * k], [-0.34 * k, 0.12 * k], [-0.52 * k, 0.0], [-0.2 * k, 0.06 * k]], sd * 0.17 * k - 0.01 * k, 0.02 * k);
    });
    return [[gx, gy, gz], [dx, dy, 0]];
  };
  return torsoOut(c, at, build, P + 0.45 * k, {
    hips,
    deckAt: (x, z) => (Math.abs(z) < 0.15 * k && x > -0.8 * k && x < 0.4 * k ? P : -1),
  });
}

// ---- Orbwalker (arachnid) ---------------------------------------------------------------------------------------------
// War Robots Raijin: an armoured orb cockpit on a four-legged hub; the orb twists with its two medium guns slung on
// armoured shoulder sockets at its flanks. Dark core sphere under a team crown and a heavy hooded cowl running front to
// back, a bone chin bowl, a glowing core seam round the equator, a dark visor slot with three hot eyes, a caged power
// node on the back.
function orbwalker(c: ChassisCtx): ChassisOut {
  const { b, kit, W, L, stance, S } = c;
  const u = Math.min(L, W) / 2;
  const fine = fineFor(S);
  const biped = stance.legs === 'biped', spider = stance.legs === 'spider';
  let P: number, hips: Hip[] | undefined;
  if (spider) {
    const hy = stance.hipY, t = stance.thick;
    // leg hub: dark octagonal drum, team hip housings at the four corners, a glowing belly core
    block(b, kit.mech, 0, hy - t * 1.6, 0, 0.82 * u, 0.82 * u, t * 3.0, { top: [0.84, 0.84], ch: 0.24 * u, bev: 0.02 * u, bot: 0.03 * u });
    b.cyl(kit.plasma, 0.16 * u, 0.12 * u, 0.04 * u, [0, hy - t * 1.6 - 0.035 * u, 0], 'y', 10);
    hips = [];
    for (const [sx, ph] of [[1, 0], [-1, Math.PI]] as [number, number][]) for (const s of [-1, 1] as const) {
      const p: V3 = [sx * 0.32 * u, hy + 0.08 * u, s * 0.32 * u];
      hips.push({ p, side: s, t, foot: [sx * 1.0 * u, 0, s * 1.08 * u], phase: ph + (s > 0 ? Math.PI : 0) });

      const a = Math.atan2(s, sx);
      b.g(new THREE.BoxGeometry(0.26 * u, t * 2.4, 0.2 * u), kit.armor, new THREE.Matrix4().makeRotationY(-a).setPosition(sx * 0.28 * u, hy, s * 0.28 * u));
      pbox(b, kit.glow, 0.02 * u, t * 0.4, 0.12 * u, sx * 0.37 * u, hy + t * 0.6, s * 0.37 * u, [0, -a, 0]);
    }
    P = hy + t * 1.4 + 0.06 * u;
  } else if (biped) {
    const hy = stance.hipY, t = stance.thick;
    block(b, kit.mech, -0.04 * u, hy - t, 0, 0.42 * u, 0.5 * u, t + 0.1 * u, { top: [0.86, 1.0], ch: 0.08 * u, bev: 0.02 * u });
    both((s) => jointDrum(b, kit, [-0.04 * u, hy, s * 0.26 * u], t * 0.8, 0.1 * u, 'z'));
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.04 * u, hy, s * 0.34 * u] as V3, side: s, t, foot: [-0.02 * u, 0, s * 0.4 * u] as V3, phase: s > 0 ? Math.PI : 0 }));
    P = hy + 0.16 * u;
  } else {
    P = stance.y0 + 0.3 * u;
    block(b, kit.mech, 0, stance.y0 - 0.02, 0, 0.72 * u, 0.72 * u, P - 0.1 * u - stance.y0 + 0.02, { top: [0.86, 0.86], ch: 0.2 * u, bev: 0.02 * u });
  }
  const at: V3 = [0, P, 0];
  cage(b, kit, 0, P - 0.12 * u, 0, 0.2 * u, 0.12 * u, 10);

  const build = (t: Bld, heroR: number, podR: number[]): V3[] => {
    const r2 = podR[0] ?? heroR;
    // orb: an ellipsoid, narrow across (the guns sit close at its flanks)
    const rx = 0.8 * u, ry = 0.66 * u, rz = 0.54 * u, oy = 0.7 * u;
    const O: V3 = [0, oy, 0];
    // gun trunnions on the flanks a little above the equator
    const gz = rz + Math.max(heroR, r2) * 0.66, gy = oy - 0.24 * u, gx = 0.06 * u;
    // neck swivel + dark core sphere
    t.cylb(kit.joint, 0.24 * u, 0.06 * u, 0.01 * u, [0, 0, 0], 'y', 16);
    t.cyl(kit.mech, 0.2 * u, 0.26 * u, oy - ry * 0.7, [0, 0.04 * u, 0], 'y', 12);
    orbBand(t, kit.mech, O, rx * 0.97, ry * 0.97, rz * 0.97, -Math.PI / 2, Math.PI / 2, 0.15, 10, 20);
    // bone chin bowl, team mid band (cut at the visor), the crown
    orbBand(t, kit.shell, O, rx, ry, rz, -1.25, -0.5, 0.1, 4, 20);
    orbBand(t, kit.armor2, O, rx * 1.01, ry, rz * 1.01, -0.42, -0.08, 0.1, 3, 20);
    orbBand(t, kit.armor2, O, rx * 1.02, ry * 1.01, rz * 1.02, 0.2, 1.1, 0.12, 5, 20);
    // glowing core seam round the equator (seen through the gap between the bands)
    orbBand(t, kit.glow, O, rx * 0.99, ry * 0.99, rz * 0.99, 0.0, 0.1, 0.05, 2, 20);

    // the cowl: a heavy team hood arching over the crown from brow to tail, wider than the crown, bone stripe on it
    const cowl = (w: number, lift: number, mat: MatLike, a0: number, a1: number, th: number) => {
      const rows: V3[][] = [];
      for (let i = 0; i <= 7; i++) {
        const a = a0 + ((a1 - a0) * i) / 7;
        const x = Math.cos(a) * (rx + lift), y = oy + Math.sin(a) * (ry + lift);
        rows.push([[x, y, -w], [x, y, w]]);
      }
      t.g(shellGeo(rows, th, (q) => { const d: V3 = [O[0] - q[0], O[1] - q[1], -q[2] * 0.4]; const l = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / l, d[1] / l, d[2] / l]; }), mat);
    };
    cowl(0.38 * u, 0.04 * u, kit.armor, 0.26, 2.95, 0.08 * u);
    cowl(0.09 * u, 0.13 * u, kit.shell, 0.6, 2.6, 0.025 * u);
    // flank vents on the crown either side of the cowl: dark louvres over a glowing slot
    both((sd) => {
      const F = frame([-0.12 * u, oy + ry * 0.62, sd * rz * 0.68], [0, 0.55, sd], XA);
      t.g(new THREE.BoxGeometry(0.36 * u, 0.02 * u, 0.05 * u), kit.plasma, F);
      for (const f of [-0.12, 0, 0.12]) t.g(new THREE.BoxGeometry(0.03 * u, 0.04 * u, 0.07 * u), kit.mech, F.clone().multiply(new THREE.Matrix4().makeTranslation(f * u, 0.012 * u, 0)));
    });
    // visor: a dark slot across the face under the brow, three hot eyes in a triangle, brow lip
    orbBand(t, kit.mech, O, rx * 1.025, ry * 1.0, rz * 1.025, 0.02, 0.17, 0.08, 2, 20);
    // a V of hot slits under the cowl's brow, a lamp eye at its point
    both((sd) => pbox(t, kit.hot, 0.03 * u, 0.026 * u, 0.15 * u, rx * 1.0, oy + 0.09 * u, sd * 0.09 * u, [0, sd * 0.5, -sd * 0.38]));
    t.cyl(kit.lamp, 0.028 * u, 0.028 * u, 0.03 * u, [rx * 1.005, oy + 0.03 * u, 0], 'x', 8);

    // back armour: a stack of team plates down the orb's rear under the cowl's tail, glowing vent slots between them
    for (const [a, w, mat] of [[2.75, 0.5, kit.armor2], [3.05, 0.42, kit.armor]] as [number, number, MatLike][]) {
      const F = frame([Math.cos(a) * rx * 1.0, oy + Math.sin(a) * ry * 1.0, 0], [Math.cos(a) / rx, Math.sin(a) / ry, 0], [0, 0, 1]);
      armorPlate(t, kit, mat, F, trapP(w * u, 0.16 * u, 0.18 * u, 0.04 * u), 0.04 * u, { standoff: 0.015 * u });
    }
    both((sd) => pbox(t, kit.plasma, 0.02 * u, 0.12 * u, 0.04 * u, -rx * 0.98, oy + 0.1 * u, sd * 0.2 * u));
    // caged power node on the back of the orb, feed hoses
    const bx = -rx * 0.95;

    t.cylb(kit.mech, 0.17 * u, 0.12 * u, 0.02 * u, [bx + 0.03 * u, oy - 0.05 * u, 0], '-x', 12);
    cage(t, kit, bx - 0.12 * u, oy - 0.22 * u, 0, 0.11 * u, 0.3 * u, 8);
    if (fine) both((sd) => hose(t, kit, [bx - 0.05 * u, oy - 0.2 * u, sd * 0.1 * u], [-rx * 0.6, oy - 0.38 * u, sd * 0.25 * u], 0.016 * u, 0.1));
    // ---- shoulder sockets: a joint drum through the flank, a dark pylon out to an armoured cradle under each gun. The
    // pod's turret ring is sunk into its cradle (only the lip shows); the hero gets the same lip, so both sit alike
    both((sd) => {
      const r = sd > 0 ? heroR : r2, ct = gy - r * 0.11, cz = sd * gz;
      jointDrum(t, kit, [-0.04 * u, gy - 0.16 * u, sd * (rz * 0.9)], 0.18 * u, 0.18 * u, 'z');
      block(t, kit.mech, -0.04 * u, ct - r * 0.5, sd * (rz + 0.1 * u), 0.56 * u, 0.36 * u, r * 0.36, { top: [0.9, 0.9], ch: 0.08 * u, bev: 0.012 * u });
      // the shoulder: one solid team mass tapering up from a broad root to the cradle top (the ring sunk into it)
      block(t, kit.armor2, gx - 0.06 * u, ct - r * 0.46, cz - sd * r * 0.04, r * 1.86, r * 1.86, r * 0.46, { top: [0.92, 0.92], shift: [0.02 * u, sd * r * 0.04], ch: r * 0.5, bev: 0.02 * u, bot: 0.03 * u });
      block(t, kit.mech, gx - 0.08 * u, ct - r * 0.62, cz - sd * r * 0.1, r * 1.4, r * 1.3, r * 0.18, { ch: r * 0.4, bev: 0.008 * u });



      // outer cheek: team plate down the cradle's outer face, glow strip under its lip
      armorPlate(t, kit, kit.armor, frame([gx - 0.08 * u, ct - r * 0.24, cz + sd * r * 0.84], [0, 0.0, sd], XA), trapP(r * 1.3, r * 0.3, r * 0.36, 0.03 * u), 0.03 * u, { standoff: 0.012 * u });
      pbox(t, kit.glow, r * 0.9, 0.022 * u, 0.012 * u, gx - 0.08 * u, ct - r * 0.42, cz + sd * (r * 0.87 + 0.01 * u));
      // swept armour fin raking back off the cradle
      fin(t, kit.armor, [[gx - r * 0.5, ct - 0.02 * u], [gx - r * 0.9, ct - 0.02 * u], [gx - r * 1.4, ct + r * 0.32], [gx - r * 1.1, ct + r * 0.2]], cz + sd * r * 0.62 - 0.0125 * u, 0.025 * u);
    });
    t.lathe(kit.trim, [[0, 0], [heroR * 0.8, 0], [heroR * 0.8, heroR * 0.2], [heroR * 0.74, heroR * 0.24], [0, heroR * 0.24]], [gx, gy - heroR * 0.12, gz], 'y', 16);
    return [[gx, gy, gz], [gx, gy - r2 * 0.36, -gz]];

  };
  return torsoOut(c, at, build, P + 1.1 * u, {
    hips,
    deckAt: (x, z) => (Math.abs(x) < 0.4 * u && Math.abs(z) < 0.4 * u ? P : -1),
  });
}

// ---- Warlord Mech -------------------------------------------------------------------------------------------------------
// A hunched heavy assault walker (War Robots Behemoth / Fafnir, BattleTech Timber Wolf) built round its medium guns in
// mech torso mode: the whole upper body twists with the weapons. Static: a dark pelvis frame with a codpiece, tassets and
// hip drums, a waist spine with stabiliser rams. The torso: a barrel chest (dark faceted core under a three-layer chest
// stack and side shells), a sunken head with two eyes under an overhanging brow, massive four-plate pauldrons wider
// than the stance, an angular reactor pack on the back with exhaust stacks. The weapons ARE its limbs: an arm gun is the
// forearm (its ring sunk in an armoured gauntlet cradle under it, the upper arm coming down from the shoulder drum to an
// elbow on the gun's back, knuckle claws under the muzzle); without a gun the arm ends in a heavy fist. The centre
// slot is a dorsal shoulder cannon in a raised bay between the pauldrons, the light slot a chin gun on the jaw ledge.
// Utilities stand on dark masts over the torso at their own mounts (the walker convention). Asymmetric: a sensor mast on
// the left pauldron, the hazard band on the right one, one tall exhaust on the left of the pack.
function warlord(c: ChassisCtx): ChassisOut {
  const { b, kit, W, L, stance } = c;
  const k = Math.min(W / 4, L / 3);
  const fine = fineFor(c.S);
  const biped = stance.legs === 'biped', spider = stance.legs === 'spider';
  const t = biped ? stance.thick : 0.24 * k;
  const ts = torsoSlots(c);
  let pelvisY: number;
  if (biped) pelvisY = stance.hipY;
  else {
    pelvisY = spider ? stance.hipY + 0.4 * k : stance.y0 + 0.55 * k;
    // pedestal: an angular dark leg hub / mount block under the pelvis (no round disc)
    block(b, kit.mech, -0.12 * k, stance.y0 - 0.02, 0, 1.1 * k, 1.1 * k, pelvisY - stance.y0 - 0.2 * k, { top: [0.86, 0.86], ch: 0.2 * k, bev: 0.025 * k, bot: 0.03 * k });
    both((s) => block(b, kit.armor2, -0.12 * k, pelvisY - 0.62 * k, s * 0.5 * k, 0.8 * k, 0.16 * k, 0.4 * k, { top: [0.8, 0.8], ch: 0.06 * k, bev: 0.015 * k }));
  }
  // ---- pelvis: dark frame block between the hip drums, armoured codpiece, two tassets
  block(b, kit.mech, -0.12 * k, pelvisY - 0.28 * k, 0, 0.66 * k, 0.76 * k, 0.44 * k, { top: [0.86, 1.06], ch: 0.12 * k, bev: 0.025 * k });
  armorPlate(b, kit, kit.armor, frame([0.24 * k, pelvisY - 0.1 * k, 0], [1, -0.3, 0], [0, 0, 1]), trapP(0.5 * k, 0.32 * k, 0.5 * k, 0.06 * k), 0.07 * k, { standoff: 0.03 * k });
  both((s) => armorPlate(b, kit, kit.armor2, frame([0.04 * k, pelvisY - 0.18 * k, s * 0.4 * k], [0.4, -0.2, s], [0, 1, 0]), rectP(0.36 * k, 0.36 * k, 0.05 * k), 0.05 * k, { standoff: 0.02 * k }));
  // ---- waist: an armoured spine block (the swivel), stabiliser rams
  const ax = -0.12 * k, P = pelvisY + 0.2 * k;
  block(b, kit.joint, ax, pelvisY + 0.02 * k, 0, 0.42 * k, 0.5 * k, P - pelvisY - 0.04 * k, { top: [0.9, 0.9], ch: 0.1 * k, bev: 0.015 * k });
  both((s) => piston(b, kit, [0.08 * k, pelvisY - 0.05 * k, s * 0.26 * k], [0.06 * k, P - 0.02 * k, s * 0.24 * k], 0.045 * k, 0.55, fine));

  // ---- the torso (twists with the weapons); frame origin on the waist swivel, +x forward
  const ty0 = 0.04 * k, th = 0.95 * k, ty1 = ty0 + th;
  const gz = 1.38 * k, gx = 0.16 * k, gy = ty0 + 0.06 * k; // arm-gun trunnions: just outside the chest flank
  const dx = -0.34 * k, dy = ty1 + 0.4 * k; // dorsal cannon trunnion
  const jawY = ty0 + 0.36 * k, cx = 0.66 * k; // chin gun
  const humpTop = ty1 + 0.28 * k;
  const station = (i: number, r: number): V3 => (i === 0 ? [dx, dy, 0] : i === 3 ? [cx, jawY + r * 0.36, 0] : [gx, gy, (i === 1 ? -1 : 1) * gz]);
  const build = (tb: Bld, heroR: number, podR: number[]): V3[] => {
    const rOf = (i: number) => (i === ts.hero ? heroR : podR[ts.pods.indexOf(i)] ?? 0.375 * k);
    tb.cylb(kit.mech, 0.3 * k, 0.06 * k, 0.012 * k, [0, -0.02 * k, 0], 'y', 12);
    // ---- barrel chest: dark faceted core (hunched forward), chest stack, side shells, belly plate
    tb.loft(kit.mech, [
      hexSec(-0.62 * k, ty0 + 0.04 * k, 0.5 * k, 0.62 * k, ty0 + 0.2 * k, ty1 - 0.32 * k, 0.4 * k, ty1 - 0.08 * k),
      hexSec(0.0, ty0, 0.6 * k, 0.76 * k, ty0 + 0.18 * k, ty1 - 0.26 * k, 0.5 * k, ty1),
      hexSec(0.46 * k, ty0 + 0.04 * k, 0.5 * k, 0.66 * k, ty0 + 0.2 * k, ty1 - 0.3 * k, 0.42 * k, ty1 - 0.12 * k),
    ]);
    const chest: P2[] = [[-0.5, -0.36], [0.5, -0.36], [0.56, 0.12], [0.36, 0.4], [-0.36, 0.4], [-0.56, 0.12]].map(([x, z]) => [x * k, z * k] as P2);
    plateStack(tb, kit, kit.armor, frame([0.52 * k, ty0 + th * 0.5, 0], [0.9, 0.42, 0], [0, 0, 1]), chest, [
      { inset: 0, thick: 0.08 * k, standoff: 0.04 * k },
      { inset: 0.09 * k, thick: 0.06 * k, shift: [0, 0.03 * k], mat: kit.armor2 },
      { inset: 0.22 * k, thick: 0.05 * k, shift: [0, 0.06 * k] },
    ], { gap: 0.05 * k });
    both((s) => {
      armorPlate(tb, kit, kit.armor, frame([-0.08 * k, ty0 + th * 0.55, s * 0.74 * k], [0, 0.15, s], [1, 0, 0]), trapP(0.92 * k, th * 0.5, th * 0.66, 0.08 * k), 0.07 * k, { standoff: 0.03 * k });
      pbox(tb, kit.plasma, 0.5 * k, 0.04 * k, 0.02 * k, -0.1 * k, ty0 + th * 0.3, s * 0.8 * k);
    });
    armorPlate(tb, kit, kit.armor2, frame([0.4 * k, ty0 + 0.04 * k, 0], [0.7, -0.6, 0], [0, 0, 1]), rectP(0.8 * k, 0.24 * k, 0.05 * k), 0.06 * k, { standoff: 0.02 * k });
    // ---- jaw ledge (chin gun seat): dark bracket under an armour shelf with a hazard lip
    tb.loft(kit.mech, [hexSec(0.42 * k, ty0 + 0.02 * k, 0.4 * k, 0.5 * k, ty0 + 0.1 * k, jawY - 0.12 * k, 0.44 * k, jawY - 0.06 * k), hexSec(0.78 * k, ty0 + 0.04 * k, 0.3 * k, 0.4 * k, ty0 + 0.1 * k, jawY - 0.14 * k, 0.36 * k, jawY - 0.08 * k)]);
    armorPlate(tb, kit, kit.armor, frame([0.62 * k, jawY - 0.07 * k, 0], [0, 1, 0], [1, 0, 0]), trapP(0.46 * k, 0.5 * k, 0.66 * k, 0.1 * k), 0.06 * k, { standoff: 0.01 * k });
    hazard(tb, kit, 0.86 * k, ty0 + 0.12 * k, 0, 0.06 * k, 0.4 * k, 4, Math.PI / 2);
    // ---- sunken head: dark core, two eyes, an overhanging brow stack, cheek guards
    const hy = ty1 - 0.36 * k;
    block(tb, kit.mech, 0.36 * k, hy, 0, 0.42 * k, 0.48 * k, 0.32 * k, { top: [0.7, 0.8], ch: 0.08 * k, bev: 0.02 * k });
    eyeCluster(tb, kit, frame([0.58 * k, hy + 0.18 * k, 0], [0, 1, 0], [1, 0, 0]), [[-0.1 * k, 0, 0.04 * k], [0.1 * k, 0, 0.04 * k]]);
    plateStack(tb, kit, kit.armor, frame([0.42 * k, hy + 0.3 * k, 0], [0.25, 1, 0], [1, 0, 0]), trapP(0.5 * k, 0.5 * k, 0.66 * k, 0.1 * k), [
      { inset: 0, thick: 0.06 * k, standoff: 0.02 * k },
      { inset: 0.06 * k, thick: 0.05 * k, shift: [-0.04 * k, 0], mat: kit.armor2 },
    ], { gap: 0.04 * k });
    both((s) => armorPlate(tb, kit, kit.armor2, frame([0.44 * k, hy + 0.12 * k, s * 0.26 * k], [0.3, 0, s], [1, 0, 0]), trapP(0.34 * k, 0.16 * k, 0.26 * k, 0.04 * k), 0.04 * k, { standoff: 0.01 * k }));
    // ---- dorsal hump between the pauldrons: dark core block + faceted shell; with the cannon a raised bay it sinks into
    block(tb, kit.mech, -0.32 * k, ty1 - 0.22 * k, 0, 0.92 * k, 0.86 * k, 0.4 * k, { top: [0.8, 0.8], ch: 0.15 * k, bev: 0.03 * k });
    archShell(tb, kit.armor, { x: -0.32 * k, len: 1.05 * k, y0: ty1 - 0.06 * k, w: 0.6 * k, h: 0.24 * k, thick: 0.06 * k, cols: 4, pw: 3, taperF: 0.86, taperB: 0.94, lift: 0.04 * k, drop: 0.1 * k });
    if (ts.armed(0)) {
      const r = rOf(0), ct = dy - r * 0.11;
      block(tb, kit.mech, dx, ty1 + 0.02 * k, 0, 0.7 * k, 0.7 * k, ct - r * 0.5 - ty1, { top: [0.9, 0.9], ch: 0.12 * k, bev: 0.015 * k });
      block(tb, kit.armor2, dx - 0.04 * k, ct - r * 0.5, 0, r * 1.9, r * 1.7, r * 0.5, { top: [0.92, 0.92], ch: r * 0.45, bev: 0.02 * k, bot: 0.03 * k });
      both((s) => {
        armorPlate(tb, kit, kit.armor, frame([dx - 0.06 * k, ct - r * 0.26, s * r * 0.86], [0, 0, s], XA), trapP(r * 1.6, r * 0.34, r * 0.4, 0.03 * k), 0.035 * k, { standoff: 0.012 * k });
        pbox(tb, kit.glow, r * 1.1, 0.022 * k, 0.012 * k, dx - 0.06 * k, ct - r * 0.44, s * (r * 0.9 + 0.01 * k));
      });
      if (ts.hero === 0) tb.lathe(kit.trim, [[0, 0], [r * 0.8, 0], [r * 0.8, r * 0.2], [r * 0.74, r * 0.24], [0, r * 0.24]], [dx, ct - r * 0.12, 0], 'y', 16);
    }
    // ---- reactor pack on the back: an angular dark block, glowing vent stack, exhaust stacks, coolant hoses
    const rx = -0.86 * k;
    block(tb, kit.mech, rx, ty0 + 0.12 * k, 0, 0.4 * k, 1.0 * k, 0.66 * k, { top: [0.8, 0.9], shift: [-0.05 * k, 0], ch: 0.1 * k, bev: 0.02 * k });
    block(tb, kit.armor2, rx - 0.04 * k, ty0 + 0.5 * k, 0, 0.32 * k, 1.08 * k, 0.2 * k, { top: [0.8, 0.9], shift: [-0.04 * k, 0], ch: 0.08 * k, bev: 0.015 * k });
    for (const f of [0.26, 0.36, 0.46]) pbox(tb, kit.plasma, 0.02 * k, 0.04 * k, 0.7 * k, rx - 0.205 * k, ty0 + f * k, 0);
    exhaust(tb, kit, rx - 0.04 * k, ty0 + 0.7 * k, -0.34 * k, 0.07 * k, 0.42 * k);
    exhaustBox(tb, kit, frame([rx + 0.02 * k, ty0 + 0.7 * k, 0.32 * k], [0, 1, 0], [-1, 0, 0]), 0.09 * k, fine);
    if (fine) both((s) => cableBundle(tb, kit, [rx + 0.12 * k, ty0 + 0.5 * k, s * 0.4 * k], [-0.5 * k, ty1 - 0.25 * k, s * 0.42 * k], 0.03 * k, [0, 0, 1], 2, 0.08));
    // ---- shoulders + arms: the arm guns are the forearms
    const shY = ty1 - 0.24 * k;
    for (const i of [1, 2]) {
      const s = i === 1 ? -1 : 1, z = s * gz, armed = ts.armed(i);
      const r = armed ? rOf(i) : 0.75 * k / 2, ct = gy - r * 0.11;
      const sh: V3 = [-0.14 * k, shY, s * 0.94 * k];
      jointDrum(tb, kit, sh, 0.2 * k, 0.24 * k, 'z');
      // upper arm: a dark bone from the shoulder drum down to an elbow on the gun's back, armour plate on its outside
      const el: V3 = [gx - r * 1.1, ct + r * 0.62, z - s * r * 0.15];
      beam(tb, kit.mech, sh, el, 0.18 * k, 0.17 * k, [0, 0, 1]);
      armorPlate(tb, kit, kit.armor, frame([(sh[0] + el[0]) / 2, (sh[1] + el[1]) / 2, (sh[2] + el[2]) / 2 + s * 0.1 * k], [0, 0, s], [el[0] - sh[0], el[1] - sh[1], 0]), rectP(0.5 * k, 0.24 * k, 0.04 * k), 0.04 * k, { standoff: 0.015 * k });
      jointDrum(tb, kit, el, 0.14 * k, 0.28 * k, 'z');
      piston(tb, kit, [sh[0] + 0.06 * k, sh[1] - 0.2 * k, s * 0.86 * k], [el[0] + 0.14 * k, el[1] + 0.04 * k, el[2] - s * 0.1 * k], 0.035 * k, 0.55, fine);
      // gauntlet: the armoured cradle under the gun (the pod's ring sunk in it), outer cheek plate, glow strip
      block(tb, kit.mech, gx - 0.16 * k, ct - r * 0.82, z, r * 1.5, r * 1.0, r * 0.36, { top: [0.9, 0.9], ch: r * 0.25, bev: 0.012 * k });
      block(tb, kit.armor2, gx - 0.08 * k, ct - r * 0.5, z, r * 1.75, r * 1.4, r * 0.5, { top: [0.9, 0.9], ch: r * 0.4, bev: 0.02 * k, bot: 0.03 * k, mid: [[0.5, 1.04, 1.04]] });
      armorPlate(tb, kit, kit.armor, frame([gx - 0.12 * k, ct - r * 0.3, z + s * r * 0.72], [0, 0.1, s], XA), trapP(r * 1.5, r * 0.36, r * 0.44, 0.04 * k), 0.04 * k, { standoff: 0.015 * k });
      pbox(tb, kit.glow, r * 1.0, 0.025 * k, 0.012 * k, gx - 0.12 * k, ct - r * 0.52, z + s * (r * 0.74 + 0.012 * k));
      // knuckles: three armoured claws curled under the gauntlet's nose (spread wide on an empty fist)
      for (const dz of [-0.3, 0, 0.3]) {
        const f0: V3 = [gx + r * 0.7, ct - r * 0.7, z + dz * r * 1.1];
        const f1: V3 = [f0[0] + (armed ? 0.12 : 0.3) * k, f0[1] - 0.16 * k, f0[2] + dz * (armed ? 0.05 : 0.3) * k];
        tb.g(strutGeo(f0, f1, 0.06 * k, 0.05 * k, 6), kit.mech);
        claw(tb, kit.joint, f1, [f1[0] + 0.08 * k, f1[1] - 0.06 * k, f1[2]], [f1[0] + 0.1 * k, f1[1] - 0.18 * k, f1[2]], 0.05 * k);
      }
      if (!armed) {
        // no gun: a heavy armoured fist block on the gauntlet
        block(tb, kit.armor, gx - 0.04 * k, ct - 0.02 * k, z, r * 1.6, r * 1.3, r * 0.6, { top: [0.7, 0.8], ch: r * 0.3, bev: 0.02 * k });
      } else if (i === ts.hero) tb.lathe(kit.trim, [[0, 0], [r * 0.8, 0], [r * 0.8, r * 0.2], [r * 0.74, r * 0.24], [0, r * 0.24]], [gx, ct - r * 0.12, z], 'y', 16);
      // pauldron: four overlapping plates stepping down and out over the shoulder drum (wider than the stance)
      for (let j = 0; j < 4; j++) {
        const a = 0.18 + j * 0.36;
        const F = frame([-0.16 * k, shY + 0.36 * k - j * 0.12 * k, s * (1.02 + j * 0.11) * k], [0, Math.cos(a), s * Math.sin(a)], [1, 0, 0]);
        armorPlate(tb, kit, j % 2 ? kit.armor2 : kit.armor, F, trapP((0.86 - j * 0.07) * k, (0.66 - j * 0.07) * k, (0.42 - j * 0.04) * k, 0.07 * k), 0.07 * k, { standoff: 0.04 * k, gap: 0.05 * k });
        if (j === 0) tb.g(new THREE.BoxGeometry(0.56 * k, 0.012 * k, 0.06 * k), kit.accent, F.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.112 * k, 0)));
      }
      tb.g(strutGeo([-0.16 * k, shY + 0.1 * k, s * 0.7 * k], [-0.16 * k, shY + 0.28 * k, s * 1.1 * k], 0.06 * k, 0.05 * k, 6), kit.mech);
      // a swept blade fin raking back off the pauldron
      fin(tb, kit.armor2, [[-0.4 * k, shY + 0.42 * k], [-0.9 * k, shY + 0.5 * k], [-1.06 * k, shY + 0.66 * k], [-0.6 * k, shY + 0.52 * k]], s * 1.0 * k - 0.0175 * k, 0.035 * k);
    }
    // chin gun: a raised lip on the jaw ledge
    if (ts.armed(3)) {
      const r = rOf(3);
      block(tb, kit.armor2, cx, jawY - 0.02 * k, 0, r * 1.7, r * 1.7, r * 0.3, { top: [0.92, 0.92], ch: r * 0.45, bev: 0.012 * k });
    }
    // asymmetric kit: a sensor mast on the left pauldron, hazard band on the right
    tb.strut(kit.joint, [-0.3 * k, ty1 + 0.2 * k, -1.06 * k], [-0.45 * k, ty1 + 0.85 * k, -1.12 * k], 0.025 * k, 0.012 * k, 5);
    sensor(tb, kit, -0.42 * k, ty1 + 0.72 * k, -1.11 * k, 0.1 * k, kit.lamp);
    hazard(tb, kit, -0.12 * k, ty1 + 0.24 * k, 1.08 * k, 0.5 * k, 0.16 * k, 4, 0);
    const hero = station(ts.hero >= 0 ? ts.hero : 0, heroR);
    return [hero, ...ts.pods.map((i) => { const p = station(i, rOf(i)); return [p[0], p[1] - rOf(i) * 0.36, p[2]] as V3; })];
  };
  const at: V3 = [ax, P, 0];
  if (ts.hero < 0) {
    const tbb = new Bld(), g = new THREE.Group();
    g.position.set(...at);
    build(tbb, 0.375 * k, []);
    tbb.mount(g);
    c.body.add(g);
  }
  const hips: Hip[] | undefined = biped ? ([-1, 1] as const).map((s) => ({
    p: [-0.15 * k, stance.hipY, s * 0.6 * k] as V3, side: s, t, foot: [-0.12 * k, 0, s * 0.72 * k] as V3, phase: s > 0 ? Math.PI : 0,
  })) : spider ? (() => {
    const out: Hip[] = [];
    for (const [hx, fx, ph] of [[0.25, 0.95, 0], [-0.5, -1.25, Math.PI]] as [number, number, number][]) for (const s of [-1, 1] as const) {
      out.push({ p: [hx * k, stance.hipY, s * 0.5 * k], side: s, t: stance.thick, foot: [fx * k, 0, s * 1.35 * k], phase: ph + (s > 0 ? Math.PI : 0) });
    }
    return out;
  })() : undefined;
  const top = P + humpTop;
  return {
    deckAt: (x, z) => (Math.abs(z) < 0.5 * k && Math.abs(x - ax) < 0.4 * k ? P : -1), top, hips, custom: true, dressed: true,
    seat: (m) => {
      if (m.i === ts.hero) return { y: P, socket: true };
      // utilities are static at their own mounts: the dorsal slot is on the twist axis, so its utility sits right on
      // the hump; an arm-slot one rides a short dark stub just over the pauldron's outer edge, the light slot's over the
      // brow (at rest they read as mounted on the shoulder / head)
      const y = m.i === 0 ? top + 0.02 * k : Math.abs(m.z) > 0.6 * k ? P + ty1 + 0.2 * k : P + ty1 + 0.12 * k;
      if (m.i !== 0) block(b, kit.mech, m.x, y - 0.3 * k, m.z, m.r * 0.5, m.r * 0.5, 0.33 * k, { ch: m.r * 0.12, bev: m.r * 0.04 });
      collar(b, kit, m.x, y, m.z, m.r, y - 0.04 * k, 12);
      return { y, socket: true };
    },
    torso: ts.hero >= 0 ? (tt, r) => ({ hp: build(tt, r.heroR, r.podR), at }) : undefined,
  };
}

registerChassis('mech', strider);
registerChassis('mantis', needle);
registerChassis('warlord', warlord);
registerChassis('arachnid', orbwalker);
registerTorso(['mech', 'mantis', 'arachnid', 'warlord']);
