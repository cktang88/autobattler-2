// Titan hulls (size 5): BOSSES. (citadel: titans-citadel.ts, arachne: titans-arachne.ts, lance: titans-lance.ts,
// monolith: titans-monolith.ts; shared titan-scale parts: hs-kit-titan.ts.)
//
// Titan Walker ("colossal", 10 wide x 9 long): the humanoid all-rounder, built round its titan gun. The XL weapon
// (a 5.25-cell housing) rides the RIGHT SHOULDER as a shoulder-carried titan cannon: the whole right shoulder is its
// cradle (a deep armoured saddle on a shoulder drum, a breech guard fin inboard, a stepped pauldron hanging outboard
// under the gun), so the gun IS the top of the silhouette. Everything else fits round it: the giant (L) gun is the
// LEFT FOREARM (an armoured forearm housing on a twin-strut upper arm), a medium rides the left pauldron deck, the
// other two the backpack (a raised barbette on its left, a rear sponson under the titan gun's breech). Mech torso
// mode (registerTorso): the chest, both shoulders, the head and the backpack twist on the waist with the guns.
// A titan fist in the titan slot is carried as a hanging right arm instead of on the shoulder.
// Underneath: a keel-fronted chest with a caged reactor, a low command cabin sunk between gun and pauldron, the
// workshop backpack (twin reactor housings, stacks, a folded jib crane on the left, tool lockers), a kilted pelvis on
// a faceted turntable waist. On tracks / anchor / spider it rides an armoured pedestal hull.

import * as THREE from 'three';
import { Bld, type P2, type V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerChassis, registerTorso, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar, glow, hazard } from './shapes.ts';
import { banner, reactor } from './giants-kit.ts';
import {
  armorPlate, cableBundle, eraGrid, fineFor, frame, frameLimb, jointDrum, ladder, piston, plateStack, recessPanel,
  rectP, stowBox, trapP,
} from './hs-kit.ts';
import { armourWalls, latticeMast, ngonT, octBarbette, octStack, planLoftT, searchlight, titanLift } from './hs-kit-titan.ts';
import type { Lift } from '../mobility/air.ts';
import { faceFrame, faceSlit, pipeRun, wallFace } from './titan-greebles.ts';
import { torsoHP, torsoSlots } from './torso-kit.ts';

/** A Bld that forwards everything into another Bld through a fixed transform: lets a torso (built in the hero's yaw
 *  frame) be authored in hull coordinates (Shift(t, translation(-pivot))). */
export class Shift extends Bld {
  private t: Bld;
  private M: THREE.Matrix4;
  constructor(t: Bld, M: THREE.Matrix4) { super(); this.t = t; this.M = M; }
  override g(geo: THREE.BufferGeometry, matl: Parameters<Bld['g']>[1], m?: THREE.Matrix4): this {
    this.t.g(geo, matl, m ? this.M.clone().multiply(m) : this.M.clone());
    return this;
  }
}
export const shiftTo = (t: Bld, p: V3) => new Shift(t, new THREE.Matrix4().makeTranslation(-p[0], -p[1], -p[2]));

export const isMelee = (m?: MountSpec) => !!m && m.mod.kind === 'weapon' && (m.mod as { category?: string }).category === 'melee';

function titanWalker(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const u = Math.min(L / 9, W / 10); // authored in cells for the 10 x 9 titan
  const fine = fineFor(c.S);
  const biped = stance.legs === 'biped';
  const pu = 0.12 * u; // plate unit
  const ts = torsoSlots(c);
  const heroM = ts.hero >= 0 ? c.mounts.find((m) => m.i === ts.hero) : undefined;
  const fist = isMelee(heroM) && ts.hero === 0;

  // ---- lower body (static): pelvis on the legs, or an armoured pedestal on tracks / anchor / spider legs
  let pelvisY: number;
  let lift: Lift[] | undefined;
  if (biped) pelvisY = stance.hipY;
  else if (stance.legs === 'spider') {
    pelvisY = stance.hipY + 0.9 * u;
    planLoftT(b, kit.mech, ngonT(8, 2.3 * u, 2.3 * u), [[stance.y0 - 0.1, 0.8], [stance.hipY, 1.0], [pelvisY, 0.8]], [-0.3 * u, 0]);
  } else {
    const y1 = Math.max(stance.yt, 0.4), dy = y1 + 1.2 * u, P = ngonT(8, L * 0.46, W * 0.36);
    pelvisY = dy + 0.45 * u;
    planLoftT(b, kit.mech, ngonT(8, L * 0.38, W * 0.28), [[stance.y0, 0.95], [y1, 1.0]], [-0.2 * u, 0]);
    planLoftT(b, kit.armor, P, [[y1 - 0.1 * u, 0.95], [y1 + 0.05 * u, 1.0], [dy - 0.1 * u, 0.98], [dy, 0.9]], [-0.2 * u, 0]);
    armourWalls(b, kit, P, [y1 + 0.06 * u, 1.0], [dy - 0.11 * u, 0.98], { at: [-0.2 * u, 0], u: pu * 0.6, pitch: 1.6 * u, fill: 0.62, era: false });
    both((s) => { hazard(b, kit, 3.0 * u, dy + 0.01, s * 1.6 * u, 1.1 * u, 0.4 * u, 5, 0); recessPanel(b, kit, frame([-3.0 * u, dy, s * 1.5 * u], [0, 1, 0]), 1.2 * u, 0.8 * u, 0.08 * u, { slats: 4 }); });
    // a raised armoured hip deck the waist stands on (not a column)
    planLoftT(b, kit.armor2, ngonT(8, 2.4 * u, 2.2 * u), [[dy - 0.05, 1.0], [dy + 0.3 * u, 0.94], [dy + 0.42 * u, 0.86]], [-0.3 * u, 0]);
    // flown (grav lifters / jets): the pedestal becomes the lift deck, outrigger nacelles on its diagonals
    if (c.mob.kind === 'air') lift = titanLift(b, kit, c.mob.id, { cx: -0.2 * u, rx: L * 0.42, rz: W * 0.33, y: y1 + 0.3 * u, yA: (y1 + dy) / 2, r: 1.05 * u });
  }
  // pelvis: dark core between the hip joints, hanging kilt (front stack, rear plate, side tassets)
  const pc = -0.3 * u;
  planLoftT(b, kit.mech, ngonT(8, 1.25 * u, 1.35 * u), [[pelvisY - 0.85 * u, 0.8], [pelvisY - 0.45 * u, 1.0], [pelvisY + 0.45 * u, 1.0], [pelvisY + 0.65 * u, 0.86]], [pc, 0]);
  if (biped) plateStack(b, kit, kit.armor, frame([0.85 * u, pelvisY - 0.45 * u, 0], [1, -0.28, 0], [0, 1, 0]), trapP(1.5 * u, 1.1 * u, 1.7 * u, 0.16 * u), [
    { inset: 0, thick: pu * 1.2, standoff: pu * 0.6 }, { inset: pu * 1.4, thick: pu * 0.9, mat: kit.armor2, shift: [-0.15 * u, 0] },
  ]);
  if (biped) armorPlate(b, kit, kit.armor2, frame([-1.45 * u, pelvisY - 0.5 * u, 0], [-1, -0.25, 0], [0, 1, 0]), trapP(1.3 * u, 1.2 * u, 1.6 * u, 0.12 * u), pu * 1.1);
  if (biped) both((s) => {
    for (const [dx, dy, mat] of [[0.2, 0, kit.shell], [-0.7, -0.15, kit.armor2]] as const) {
      armorPlate(b, kit, mat, frame([pc + dx * u, pelvisY - 0.25 * u + dy * u, s * 2.6 * u], [0, -0.18, s], [1, 0, 0]), rectP(1.0 * u, 1.25 * u, 0.12 * u), pu, { standoff: pu * 0.8 });
    }
  });
  // waist: faceted turntable ring on four exposed rams; the torso twists on it
  const yP = pelvisY + 1.0 * u, wy = pelvisY + 0.6 * u;
  planLoftT(b, kit.joint, ngonT(8, 1.05 * u, 1.05 * u), [[wy - 0.05 * u, 1.0], [yP, 0.94]], [pc, 0]);
  planLoftT(b, kit.mech, ngonT(8, 1.3 * u, 1.3 * u), [[wy - 0.02 * u, 1.0], [wy + 0.12 * u, 1.0]], [pc, 0]);
  for (const [dx, dz] of [[0.75, 0.8], [0.75, -0.8], [-1.3, 0.8], [-1.3, -0.8]]) piston(b, kit, [pc + dx * u * 0.8, pelvisY + 0.4 * u, dz * u * 1.2], [pc + dx * u, yP - 0.05 * u, dz * u * 1.45], 0.1 * u, 0.55, fine);
  if (fine) cableBundle(b, kit, [pc - 1.2 * u, pelvisY + 0.35 * u, 0.6 * u], [pc - 1.45 * u, yP - 0.05 * u, 0.7 * u], 0.045 * u, [0, 0, 1], 3, 0.18);

  // ---- weapon hardpoints in the hull frame (the torso pivot is at [pc, yP, 0]; units3d gets them in the yaw frame)
  const Y0 = yP;
  const yS = Y0 + 3.05 * u; // titan-gun saddle top
  const gz = 2.65 * u; // titan gun on the right shoulder
  const fz = 3.45 * u; // titan fist: the right arm hangs outboard of the chest
  const lz = -3.6 * u, yF = Y0 + 0.8 * u; // giant gun: the left forearm's deck
  const BASE: V3[] = [
    fist ? [0.35 * u, Y0 - 0.05 * u, fz] : [0.05 * u, yS - 0.3 * u, gz],
    [0.35 * u, yF - 0.38 * u, lz],
    [-0.55 * u, Y0 + 3.55 * u, -3.0 * u],
    [-2.75 * u, Y0 + 3.45 * u, -1.15 * u],
    [-4.15 * u, Y0 + 2.0 * u, 0.9 * u],
  ];
  const base = (i: number): V3 => BASE[i] ?? [-1.0 * u, Y0 + 3.4 * u, 0];

  // ---- the twisting upper body (built in hull coordinates through a Shift into the torso frame)
  const upper = (t: Bld, armed: (i: number) => boolean) => {
    // chest: keel-fronted, leaning forward, narrow at the gun arm, widening to the shoulders
    const chest: P2[] = [[1.55 * u, 0], [1.0 * u, 1.55 * u], [-1.3 * u, 1.7 * u], [-1.95 * u, 1.0 * u], [-1.95 * u, -1.0 * u], [-1.3 * u, -1.7 * u], [1.0 * u, -1.55 * u]];
    const cAt: [number, number] = [-0.35 * u, 0], ty1 = Y0 + 3.0 * u;
    planLoftT(t, kit.armor2, chest, [[Y0 - 0.02, 0.7, -0.25 * u], [Y0 + 0.6 * u, 0.94, -0.12 * u], [ty1 - 0.5 * u, 1.0, 0.05 * u], [ty1 - 0.15 * u, 0.97, 0.06 * u], [ty1, 0.86, 0.06 * u]], cAt);
    const cLo: [number, number] = [Y0 + 0.65 * u, 0.95], cHi: [number, number] = [ty1 - 0.55 * u, 1.0];
    for (let i = 0; i < chest.length; i++) {
      const f = wallFace(chest.map(([x, z]) => [x - 0.04 * u, z] as P2), i, cLo, cHi, cAt);
      if (f.n.x > 0.8) {
        const du = f.u.z * Math.sign(f.c.z) > 0 ? f.w * 0.22 : -f.w * 0.22;
        const top = plateStack(t, kit, kit.armor, faceFrame(f, du, 0, 0), rectP(f.w * 0.5, f.h * 0.86, pu), [
          { inset: 0, thick: pu * 1.3, standoff: pu * 0.6 }, { inset: pu * 1.5, thick: pu, mat: kit.armor2 },
        ], { gap: pu * 1.2 });
        eraGrid(t, kit, faceFrame(f, du, -f.h * 0.08, top), 3, 2, f.w * 0.18, f.h * 0.2, pu * 0.6, kit.armor2);
      } else if (f.n.x > -0.6) {
        armorPlate(t, kit, i % 2 ? kit.shell : kit.armor, faceFrame(f, 0, -f.h * 0.04, 0), rectP(f.w * 0.82, f.h * 0.8, pu), pu * 1.2, { standoff: pu * 0.5, gap: pu * 1.2 });
        if (f.n.x > 0) faceSlit(t, kit, f, 0, f.h * 0.3, f.w * 0.4, pu * 0.45);
      }
    }
    // reactor heart in a caged octagonal frame on the keel
    const rx = 1.05 * u, ry = Y0 + 1.35 * u;
    reactor(t, kit, [rx, ry, 0], 0.55 * u, 'x', 3);
    const P8 = ngonT(8, 0.75 * u, 0.75 * u);
    for (let i = 0; i < 8; i++) {
      const [ay, az] = P8[i], [by2, bz] = P8[(i + 1) % 8];
      t.strut(kit.mech, [rx + 0.14 * u, ry + ay, az], [rx + 0.14 * u, ry + by2, bz], 0.085 * u, 0.085 * u, 4);
    }
    for (let i = 0; i < 2; i++) armorPlate(t, kit, kit.shell, frame([0.4 * u - i * 0.08 * u, Y0 + 0.15 * u + i * 0.36 * u, 0], [1, -0.35 + i * 0.2, 0], [0, 0, 1]), rectP((1.6 - i * 0.12) * u, 0.38 * u, 0.06 * u), pu, { standoff: pu * 0.6 });

    // head: a low faceted command cabin, sunk left of the titan gun's breech; V visor, brow plate
    const hx = 0.75 * u, hz = -0.55 * u, hy = ty1 - 0.08 * u;
    const cab: P2[] = [[0.75 * u, 0], [0.45 * u, 0.6 * u], [-0.6 * u, 0.62 * u], [-0.75 * u, 0.3 * u], [-0.75 * u, -0.3 * u], [-0.6 * u, -0.62 * u], [0.45 * u, -0.6 * u]];
    planLoftT(t, kit.mech, ngonT(6, 0.8 * u, 0.8 * u, 0), [[ty1 - 0.4 * u, 1.0], [ty1 + 0.02 * u, 1.0]], [hx - 0.2 * u, hz]);
    planLoftT(t, kit.armor, cab, [[hy, 1.0], [hy + 0.45 * u, 0.98], [hy + 0.75 * u, 0.72, -0.1 * u]], [hx, hz]);
    both((s) => glow(t, kit, hx + 0.6 * u, hy + 0.33 * u, hz + s * 0.2 * u, 0.08 * u, 0.1 * u, 0.4 * u, [0, s * 0.55, s * 0.25]));
    armorPlate(t, kit, kit.armor2, frame([hx + 0.12 * u, hy + 0.75 * u, hz], [0.25, 1, 0], [1, 0, 0]), trapP(1.15 * u, 0.7 * u, 1.1 * u, 0.1 * u), pu, { standoff: pu * 0.5 });
    t.box(kit.accent, 0.85 * u, 0.07 * u, 0.14 * u, hx - 0.05 * u, hy + 0.98 * u, hz, 0.02);
    latticeMast(t, kit, hx - 0.45 * u, hy + 0.62 * u, hz - 0.4 * u, 1.1 * u, 0.1 * u, 0.4);

    // ---- RIGHT SHOULDER = the titan gun's cradle: a shoulder drum into the chest, a deep saddle block under the gun,
    // a breech guard fin inboard, a hanging stepped pauldron outboard, rams from the chest into the saddle
    if (armed(0) && !fist) {
      jointDrum(t, kit, [-0.4 * u, Y0 + 2.2 * u, 1.75 * u], 0.75 * u, 0.7 * u, 'z');
      // saddle: battered armoured block, its top the cradle the gun's belly rests over
      block(t, kit.armor, -0.35 * u, Y0 + 1.25 * u, gz, 3.9 * u, 2.6 * u, yS - Y0 - 1.25 * u, { top: [0.92, 0.9], ch: 0.32 * u, bev: 0.08 * u, mid: [[0.35, 1.06, 1.08]] });
      planLoftT(t, kit.mech, rectP(3.2 * u, 1.9 * u, 0.25 * u), [[yS - 0.04 * u, 1.0], [yS + 0.06 * u, 0.96]], [-0.35 * u, gz]);
      glow(t, kit, -0.35 * u, yS - 0.18 * u, gz + 1.32 * u, 2.6 * u, 0.1 * u, 0.06 * u, undefined, kit.plasma);
      // front glacis ERA and a hazard lip under the muzzle side
      eraGrid(t, kit, frame([1.62 * u, Y0 + 2.15 * u, gz], [0.85, 0.5, 0], [0, 0, 1]), 2, 3, 0.62 * u, 0.36 * u, pu * 0.7, kit.armor2);
      hazard(t, kit, 1.5 * u, yS - 0.02 * u, gz, 0.2 * u, 2.2 * u, 6, Math.PI / 2);
      // outboard pauldron hanging under the gun: three stepped plates sloping out and down
      const P = frame([-0.45 * u, Y0 + 2.05 * u, gz + 1.45 * u], [0, 0.35, 1], [1, 0, 0]);
      const h0 = armorPlate(t, kit, kit.armor, P, trapP(3.4 * u, 1.5 * u, 1.9 * u, 0.25 * u), pu * 2.4, { standoff: pu * 0.8, taper: 0.8 });
      plateStack(t, kit, kit.armor2, P.clone().multiply(new THREE.Matrix4().makeTranslation(-0.2 * u, h0, 0.1 * u)), trapP(2.6 * u, 1.0 * u, 1.3 * u, 0.15 * u), [
        { inset: 0, thick: pu * 1.1, standoff: pu * 0.3 }, { inset: pu * 1.8, thick: pu * 0.8, mat: kit.accent, shift: [-0.15 * u, 0] },
      ], { gap: pu });
      // breech guard fin inboard of the gun (between the head and the gun), swept back
      block(t, kit.armor2, -1.0 * u, ty1 - 0.1 * u, 0.0, 2.6 * u, 0.3 * u, yS - ty1 + 0.95 * u, { top: [0.55, 1], shift: [-0.7 * u, 0], ch: 0.08 * u, bev: 0.04 * u });
      glow(t, kit, -1.35 * u, yS + 0.3 * u, 0.0, 1.0 * u, 0.12 * u, 0.33 * u, [0, 0, 0.5]);
      for (const dx of [0.6, -1.3]) piston(t, kit, [dx * u, Y0 + 0.9 * u, 1.35 * u], [dx * u - 0.2 * u, yS - 0.35 * u, 1.9 * u], 0.12 * u, 0.55, fine);
    } else if (armed(0) && fist) {
      // titan fist: a massive right arm hanging outboard, shoulder drum, twin-strut upper arm, elbow drum over the fist
      const sh: V3 = [-0.4 * u, Y0 + 2.5 * u, 2.25 * u], el: V3 = [-0.1 * u, Y0 + 1.45 * u, fz];
      jointDrum(t, kit, sh, 0.85 * u, 0.9 * u, 'z');
      frameLimb(t, kit, sh, el, 0.24 * u, [0.35 * u, 0, 0]);
      armorPlate(t, kit, kit.armor2, frame([-0.25 * u, Y0 + 2.0 * u, fz + 0.55 * u], [0, 0, 1], [0.3, -1, 0]), rectP(1.3 * u, 1.3 * u, 0.15 * u), pu * 1.5, { standoff: pu });
      jointDrum(t, kit, el, 0.7 * u, 1.0 * u, 'z');
      const P = frame([-0.4 * u, Y0 + 3.0 * u, 2.6 * u], [0, 1, 0.5], [1, 0, 0]);
      const h0 = armorPlate(t, kit, kit.armor, P, trapP(2.7 * u, 1.6 * u, 2.1 * u, 0.25 * u), pu * 2.6, { standoff: pu * 0.8, taper: 0.75 });
      armorPlate(t, kit, kit.accent, P.clone().multiply(new THREE.Matrix4().makeTranslation(-0.15 * u, h0, 0)), trapP(1.8 * u, 0.8 * u, 1.1 * u, 0.1 * u), pu * 0.9, { standoff: pu * 0.3 });
    } else {
      // unarmed: a plain armoured right pauldron
      jointDrum(t, kit, [-0.4 * u, Y0 + 2.2 * u, 1.75 * u], 0.75 * u, 0.7 * u, 'z');
      block(t, kit.armor, -0.4 * u, Y0 + 1.7 * u, 2.3 * u, 2.6 * u, 1.6 * u, 1.6 * u, { top: [0.8, 0.7], shift: [-0.2 * u, 0.15 * u], ch: 0.25 * u });
    }

    // ---- LEFT ARM: shoulder drum, twin-strut upper arm, elbow, the armoured forearm housing whose deck seats the
    // giant gun; a big three-tier pauldron above whose flat top seats a medium
    const sh: V3 = [-0.5 * u, Y0 + 2.45 * u, -2.2 * u], el: V3 = [-0.75 * u, Y0 + 0.45 * u, -3.35 * u];
    jointDrum(t, kit, [sh[0], sh[1], sh[2] - 0.1 * u], 0.8 * u, 0.85 * u, 'z');
    frameLimb(t, kit, sh, el, 0.22 * u, [0.35 * u, 0, 0]);
    armorPlate(t, kit, kit.armor2, frame([-0.62 * u, Y0 + 1.45 * u, -3.75 * u], [0, 0, -1], [0.1, 1, 0]), rectP(1.7 * u, 1.2 * u, 0.12 * u), pu * 1.4, { standoff: pu });
    jointDrum(t, kit, el, 0.6 * u, 1.0 * u, 'z');
    if (armed(1)) {
      const fl = 3.0 * u, fw = 2.25 * u, fh = 1.5 * u, fx = 0.3 * u, fy0 = yF - fh;
      t.box(kit.mech, fl * 0.92, fh * 0.84, fw * 0.82, fx, fy0 + fh * 0.42, lz, fh * 0.08);
      armorPlate(t, kit, kit.armor, frame([fx, yF - pu * 1.4 - 0.05 * u, lz], [0, 1, 0], [1, 0, 0]), trapP(fl, fw * 0.94, fw * 1.02, fw * 0.12), pu * 1.4, { standoff: 0.05 * u, gap: pu });
      const ck = plateStack(t, kit, kit.armor, frame([fx - fl * 0.04, fy0 + fh * 0.42, lz - fw * 0.41], [0, 0, -1], [1, 0, 0]), rectP(fl * 0.86, fh * 0.66, fh * 0.1), [
        { inset: 0, thick: fh * 0.1, standoff: fh * 0.04 }, { inset: fh * 0.12, thick: fh * 0.07, mat: kit.armor2 },
      ]);
      eraGrid(t, kit, frame([fx + fl * 0.18, fy0 + fh * 0.42, lz - fw * 0.41 - ck], [0, 0, -1], [1, 0, 0]), 2, 3, fl * 0.13, fh * 0.24, fh * 0.06);
      armorPlate(t, kit, kit.shell, frame([fx - fl * 0.1, fy0 + fh * 0.45, lz + fw * 0.41], [0, 0, 1], [1, 0, 0]), rectP(fl * 0.6, fh * 0.56, fh * 0.08), fh * 0.08);
      recessPanel(t, kit, frame([fx + fl * 0.47, fy0 + fh * 0.44, lz], [1, 0, 0], [0, 0, 1]), fw * 0.66, fh * 0.5, fh * 0.08, { slats: 3 });
      glow(t, kit, fx - fl * 0.1, fy0 + fh * 0.12, lz - fw * 0.42, fl * 0.45, fh * 0.05, fw * 0.04);
      piston(t, kit, [el[0] + 0.25 * u, el[1] + 0.9 * u, el[2] + 0.4 * u], [fx - fl * 0.2, yF - fh * 0.2, lz + fw * 0.3], 0.16 * u, 0.55, fine);
    } else {
      // unarmed forearm: an armoured fist-less cuff
      block(t, kit.armor, -0.2 * u, Y0 - 0.5 * u, -3.4 * u, 2.0 * u, 1.3 * u, 1.0 * u, { top: [0.8, 0.85], ch: 0.2 * u });
    }
    // left pauldron: a thick faceted shell with two stepped plates and a flat deck (the medium's seat)
    const pz = -3.0 * u, pTop = Y0 + 3.9 * u;
    block(t, kit.mech, -0.55 * u, Y0 + 2.1 * u, -2.6 * u, 2.0 * u, 1.4 * u, 1.3 * u, { ch: 0.2 * u });
    block(t, kit.armor, -0.55 * u, Y0 + 2.6 * u, pz, 2.9 * u, 2.3 * u, pTop - Y0 - 2.6 * u, { top: [0.82, 0.8], shift: [-0.12 * u, -0.1 * u], ch: 0.35 * u, bev: 0.07 * u, bot: 0.12 * u });
    armorPlate(t, kit, kit.armor2, frame([-0.5 * u, Y0 + 2.5 * u, pz - 1.25 * u], [0, -0.12, -1], [1, 0, 0]), trapP(2.8 * u, 1.0 * u, 1.3 * u, 0.15 * u), pu * 1.5, { standoff: pu * 0.8 });
    armorPlate(t, kit, kit.shell, frame([0.95 * u, Y0 + 3.1 * u, pz], [1, 0.45, 0], [0, 0, 1]), rectP(1.9 * u, 0.9 * u, 0.12 * u), pu * 1.2, { standoff: pu * 0.6 });
    hazard(t, kit, 0.75 * u, pTop - 0.02 * u, pz, 0.2 * u, 1.6 * u, 4, Math.PI / 2);
    if (!armed(2)) armorPlate(t, kit, kit.accent, frame([-0.6 * u, pTop, pz], [0, 1, 0], [1, 0, 0]), rectP(1.5 * u, 1.2 * u, 0.15 * u), pu * 0.8, { standoff: pu * 0.3 });
    searchlight(t, kit, 0.6 * u, pTop - 0.4 * u, pz - 1.05 * u, -0.3, 0.3 * u, fine);

    // ---- backpack: the field workshop. Reactor housings, stacks, a jib crane folded on the left, tool lockers
    const bpX = -2.95 * u, bpT = Y0 + 3.15 * u;
    block(t, kit.mech, bpX, Y0 + 0.3 * u, -0.2 * u, 1.9 * u, 3.4 * u, bpT - Y0 - 0.3 * u, { ch: 0.3 * u });
    armorPlate(t, kit, kit.armor, frame([bpX, bpT, -0.2 * u], [0, 1, 0], [1, 0, 0]), rectP(1.7 * u, 3.0 * u, 0.2 * u), pu, { standoff: pu * 0.3 });
    both((s) => {
      const dz = s * 1.15 * u - 0.2 * u;
      const top = octBarbette(t, kit, bpX - 0.35 * u, Y0 + 0.2 * u, dz, 0.78 * u, 2.4 * u, { mat: kit.armor });
      planLoftT(t, kit.glow, ngonT(8, 0.78 * u, 0.78 * u), [[Y0 + 0.85 * u, 1.105], [Y0 + 0.93 * u, 1.105]], [bpX - 0.35 * u, dz]);
      if (s < 0) octStack(t, kit, bpX - 0.55 * u, top - 0.05 * u, dz - 0.2 * u, 0.24 * u, 1.5 * u, [0, 0, -1]);
      if (fine) pipeRun(t, kit, [[bpX + 0.6 * u, Y0 + 2.2 * u, dz * 0.9], [-1.6 * u, ty1 - 0.3 * u, s * 1.35 * u], [-0.4 * u, ty1 - 0.3 * u, s * 1.45 * u]], 0.08 * u, kit.joint);
    });
    // jib crane folded up the left of the pack (the workshop signature): slewing base, box boom, ram, hook block
    {
      const cz = -2.0 * u, cb: V3 = [bpX - 0.2 * u, Y0 + 1.2 * u, cz];
      block(t, kit.mech, cb[0], cb[1] - 0.6 * u, cz, 0.8 * u, 0.7 * u, 0.6 * u, { ch: 0.12 * u });
      jointDrum(t, kit, cb, 0.28 * u, 0.55 * u, 'z');
      const tip: V3 = [bpX - 1.3 * u, Y0 + 4.6 * u, cz - 0.35 * u];
      for (const e of [-1, 1]) beam(t, kit.armor2, [cb[0], cb[1], cz + e * 0.15 * u], [tip[0], tip[1], tip[2] + e * 0.1 * u], 0.09 * u, 0.3 * u, [1, 0.3, 0]);
      beam(t, kit.hazard, [cb[0] - 0.1 * u, cb[1] + 0.5 * u, cz], [tip[0] + 0.05 * u, tip[1] - 0.1 * u, tip[2]], 0.22 * u, 0.15 * u, [1, 0.3, 0]);
      piston(t, kit, [cb[0] + 0.4 * u, cb[1] - 0.3 * u, cz], [cb[0] + (tip[0] - cb[0]) * 0.45, cb[1] + (tip[1] - cb[1]) * 0.45, cz], 0.12 * u, 0.55, fine);
      jointDrum(t, kit, tip, 0.2 * u, 0.4 * u, 'z');
      const hook: V3 = [tip[0] - 0.15 * u, tip[1] - 1.7 * u, tip[2]];
      t.strut(kit.steel, tip, [hook[0], hook[1] + 0.25 * u, hook[2]], 0.025 * u, 0.025 * u, 4);
      t.box(kit.hazard, 0.28 * u, 0.36 * u, 0.2 * u, hook[0], hook[1] + 0.15 * u, hook[2], 0.03 * u);
    }
    for (const [dx, dy] of [[0.3, 0.4], [-0.4, 0.4], [0, 1.3]]) stowBox(t, kit, frame([bpX + dx * u, Y0 + dy * u, 1.6 * u], [0, 0, 1], [1, 0, 0]), 0.7 * u, 0.28 * u, 0.75 * u, dy > 1 ? kit.shell : kit.armor2);
    ladder(t, kit, [bpX - 0.97 * u, Y0 + 0.45 * u, 0.5 * u], [bpX - 0.97 * u, bpT, 0.5 * u], 0.36 * u, [0, 0, 1], [-1, 0, 0], 0.05 * u);
    banner(t, kit, bpX - 0.4 * u, bpT - 0.1 * u, -1.75 * u, 3.4 * u, 0.9 * u, -1);
    // pod seats on the pack: a raised barbette on its top left, a rear sponson under the titan gun's breech
    if (armed(3)) { const [x, y, z] = base(3); octBarbette(t, kit, x, bpT - 0.05 * u, z, 0.62 * u, y - bpT + 0.33 * u, { mat: kit.armor2, plates: false }); }
    if (armed(4)) {
      const [x, y, z] = base(4);
      block(t, kit.armor, x + 0.3 * u, Y0 + 0.7 * u, z, 1.7 * u, 1.5 * u, y - Y0 - 0.7 * u + 0.3 * u, { top: [0.9, 0.9], shift: [0.1 * u, 0], ch: 0.2 * u, bev: 0.05 * u, bot: 0.25 * u });
    }
  };

  // ---- legs
  const hips: Hip[] | undefined = biped ? ([-1, 1] as const).map((s) => ({
    p: [pc, stance.hipY, s * 1.85 * u] as V3, side: s, t: stance.thick * 1.3, foot: [pc + 0.1 * u, 0, s * 2.25 * u] as V3, phase: s > 0 ? Math.PI : 0,
  })) : undefined;
  const at: V3 = [pc, yP, 0];
  const tFrame = (t: Bld) => shiftTo(t, at);
  const top = yS + 2.2 * u;
  if (!heroM) {
    // no torso (an all-utility fit): the same upper body, static, every slot built
    upper(b, (i) => c.mounts.some((m) => m.i === i && m.mod.kind === 'weapon'));
  }
  const toYaw = (p: V3): V3 => [p[0] - at[0], p[1] - at[1], p[2] - at[2]];
  return {
    deckAt: (x, z) => (Math.abs(z) < 1.4 * u && x > -2.0 * u && x < 1.0 * u ? Y0 + 3.0 * u : -1), top, hips, lift, custom: true, dressed: true,
    seat: (m) => {
      if (m === heroM) return { y: yP, socket: true };
      if (m.mod.kind === 'weapon') {
        // no torso: each weapon on its own designed seat height
        const p = base(m.i);
        return { y: p[1], socket: true };
      }
      // utilities ride the static waist: an outrigger bracket from the turntable to a compact module plinth
      const y = pelvisY + 0.55 * u;
      beam(b, kit.mech, [pc, y - 0.25 * u, 0], [m.x, y - 0.25 * u, m.z], 0.4 * u, 0.3 * u);
      block(b, kit.armor2, m.x, y - 0.5 * u, m.z, m.r * 1.6, m.r * 1.6, 0.5 * u, { ch: m.r * 0.3, bev: 0.04 * u });
      collar(b, kit, m.x, y, m.z, m.r, y - 0.05 * u, 12);
      return { y, socket: true };
    },
    torso: heroM ? (t, { heroR }) => {
      upper(tFrame(t), ts.armed);
      return { hp: torsoHP(ts, (i) => toYaw(base(i)), heroR), at };
    } : undefined,
  };
}

registerChassis('colossal', titanWalker);
registerTorso('colossal');
