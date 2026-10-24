// Titan hulls (size 5): BOSSES. (citadel: titans-citadel.ts, arachne: titans-arachne.ts, lance: titans-lance.ts,
// monolith: titans-monolith.ts; shared titan-scale parts: hs-kit-titan.ts.)
//
// Titan Walker ("colossal"): the humanoid all-rounder that keeps the line running - a walking field workshop.
// Hard-surface build: a dark mechanical skeleton (pelvis core, faceted waist turntable on four exposed rams, chest
// core, shoulder drums, twin-strut upper arms) carrying thick armour shells on shadow gaps: a keel-fronted chest with
// two-deep plate stacks and ERA on the front arc around a caged reactor, stacked three-layer pauldrons with drop
// plates, a hanging kilt of overlapping tassets, and forearm weapon housings plated on top (the arm guns sit there,
// mountOffsets z ~ +-2.56). The low faceted command cabin is sunk between the pauldrons behind a brow plate.
// SIGNATURE: the repair workshop on its back - a tall jib crane folded up off the right reactor housing with a hook
// block on its cable, a folded manipulator arm and tool lockers on the backpack flanks. Twin faceted reactor
// housings with coolant runs to the chest, two exhaust stacks of different heights, a lattice sensor mast and the
// team banner on the left, a railed walkway round the shoulder deck and a ladder down the backpack (building-scale
// cues). Asymmetric: crane right / mast + banner left, one pauldron searchlight, one tall stack.
// On tracks / anchor / spider it rides a faceted turntable waist on an armoured pedestal hull.

import * as THREE from 'three';
import type { P2, V3 } from '../geo.ts';
import type { Bld } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, both, collar, glow, hazard } from './shapes.ts';
import { banner, reactor } from './giants-kit.ts';
import {
  armorPlate, cableBundle, crewHatch, eraGrid, fineFor, frame, frameLimb, hose, jointDrum, ladder, piston, plateStack, recessPanel,
  rectP, stowBox, trapP,
} from './hs-kit.ts';
import { armourWalls, latticeMast, ngonT, octBarbette, octStack, planLoftT, railLoop, searchlight } from './hs-kit-titan.ts';
import { faceFrame, faceSlit, pipeRun, wallFace } from './titan-greebles.ts';

/** titan arm: shoulder drum, twin-strut upper arm with an armour shell, elbow drum + ram, plated forearm weapon
 *  housing along +x; returns the housing top (where the arm gun seats) */
export function titanArm(b: Bld, kit: Kit, s: number, sh: V3, el: V3, px: number, pz: number, py: number, podL: number, podW: number, podH: number, t: number, fine = true): number {
  jointDrum(b, kit, [sh[0], sh[1], sh[2] + s * t * 0.1], t * 1.25, t * 1.5, 'z');
  frameLimb(b, kit, sh, el, t * 0.32, [t * 0.5, 0, 0]);
  // upper-arm shell on the outboard side (stands off the struts on a dark backing)
  const mid: V3 = [(sh[0] + el[0]) / 2, (sh[1] + el[1]) / 2, (sh[2] + el[2]) / 2 + s * t * 0.62];
  armorPlate(b, kit, kit.armor2, frame(mid, [0, 0, s], [el[0] - sh[0], el[1] - sh[1], 0]), rectP(Math.hypot(el[0] - sh[0], el[1] - sh[1]) * 0.78, t * 1.7, t * 0.25), t * 0.22, { standoff: t * 0.18 });
  jointDrum(b, kit, el, t * 0.95, t * 1.35, 'z');
  // forearm housing: dark core box, a thick top plate (the gun deck), stacked outboard cheek plate with ERA,
  // a lighter inboard plate, muzzle-end ports, a bicep ram from the upper arm onto the housing
  const top = py + podH, cx = px + podL * 0.02;
  b.box(kit.mech, podL * 0.92, podH * 0.84, podW * 0.82, cx, py + podH * 0.42, pz, podH * 0.08);
  const tt = podH * 0.13, so = podH * 0.05;
  armorPlate(b, kit, kit.armor, frame([cx, top - tt - so, pz], [0, 1, 0], [1, 0, 0]), trapP(podL, podW * 0.94, podW * 1.02, podW * 0.12), tt, { standoff: so, gap: tt * 0.8 });
  const cheek = plateStack(b, kit, kit.armor, frame([cx - podL * 0.04, py + podH * 0.42, pz + s * podW * 0.41], [0, 0, s], [1, 0, 0]), rectP(podL * 0.86, podH * 0.66, podH * 0.1), [
    { inset: 0, thick: podH * 0.1, standoff: podH * 0.04 }, { inset: podH * 0.12, thick: podH * 0.07, mat: kit.armor2 },
  ]);
  eraGrid(b, kit, frame([cx + podL * 0.18, py + podH * 0.42, pz + s * (podW * 0.41 + cheek)], [0, 0, s], [1, 0, 0]), 2, 3, podL * 0.13, podH * 0.24, podH * 0.06);
  armorPlate(b, kit, kit.shell, frame([cx - podL * 0.1, py + podH * 0.45, pz - s * podW * 0.41], [0, 0, -s], [1, 0, 0]), rectP(podL * 0.6, podH * 0.56, podH * 0.08), podH * 0.08);
  // muzzle face: recessed ports + accent stripe on the cheek
  recessPanel(b, kit, frame([cx + podL * 0.47, py + podH * 0.44, pz], [1, 0, 0], [0, 0, 1]), podW * 0.66, podH * 0.5, podH * 0.08, { slats: 3 });
  glow(b, kit, cx - podL * 0.1, py + podH * 0.12, pz + s * podW * 0.42, podL * 0.45, podH * 0.05, podW * 0.04);
  piston(b, kit, [el[0] + t * 0.2, el[1] + t * 0.9, el[2] - s * t * 0.5], [cx - podL * 0.2, top - podH * 0.2, pz - s * podW * 0.3], t * 0.2, 0.55, fine);
  // manipulator claws under the muzzle end (repair work / close assault)
  for (const dz of [-0.3, 0, 0.3]) {
    const a: V3 = [cx + podL * 0.4, py + podH * 0.12, pz + dz * podW], m: V3 = [cx + podL * 0.6, py - podH * 0.12, pz + dz * podW * 1.08];
    beam(b, kit.joint, a, m, podW * 0.12, podW * 0.15);
    beam(b, kit.steel, m, [cx + podL * 0.66, py - podH * 0.38, pz + dz * podW * 0.9], podW * 0.08, podW * 0.1);
  }
  return top;
}

function titanWalker(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const u = Math.min(L, W) / 7; // authored in cells for the 7 x 7 titan
  const fine = fineFor(c.S);
  const biped = stance.legs === 'biped';
  const t = biped ? stance.thick : 0.5 * u;
  const pu = 0.1 * u; // plate unit
  let pelvisY: number;
  if (biped) pelvisY = stance.hipY;
  else if (stance.legs === 'spider') {
    pelvisY = stance.hipY + 0.6 * u;
    planLoftT(b, kit.mech, ngonT(8, 1.8 * u, 1.8 * u), [[stance.y0 - 0.1, 0.8], [stance.hipY, 1.0], [pelvisY, 0.8]], [-0.3 * u, 0]);
  } else {
    // pedestal hull over the running gear: an armoured octagonal deck (plated walls) plus a faceted turntable waist
    pelvisY = stance.yt + 0.9 * u;
    const dy = stance.yt + 0.42 * u, P = ngonT(8, L * 0.47, W * 0.4);
    planLoftT(b, kit.mech, ngonT(8, L * 0.4, W * 0.3), [[stance.y0, 0.95], [stance.yt, 1.0]], [-0.2 * u, 0]);
    planLoftT(b, kit.armor, P, [[stance.yt - 0.1 * u, 0.95], [stance.yt + 0.05 * u, 1.0], [dy - 0.08 * u, 0.98], [dy, 0.92]], [-0.2 * u, 0]);
    armourWalls(b, kit, P, [stance.yt + 0.06 * u, 1.0], [dy - 0.09 * u, 0.98], { at: [-0.2 * u, 0], u: pu * 0.5, pitch: 1.3 * u, fill: 0.62, era: false });
    both((s) => { hazard(b, kit, 2.3 * u, dy + 0.01 * u, s * 1.2 * u, 0.9 * u, 0.36 * u, 5, 0); recessPanel(b, kit, frame([-2.3 * u, dy, s * 1.1 * u], [0, 1, 0]), 0.9 * u, 0.6 * u, 0.06 * u, { slats: 4 }); });
    planLoftT(b, kit.mech, ngonT(8, 1.6 * u, 1.6 * u), [[dy - 0.02, 1.0], [dy + 0.14 * u, 1.0]], [-0.2 * u, 0]);
    planLoftT(b, kit.joint, ngonT(8, 1.2 * u, 1.2 * u), [[dy, 1.0], [pelvisY, 1.0]], [-0.2 * u, 0]);
  }

  // ---- pelvis: dark core between the hip joints, hanging kilt of overlapping tassets (front stack, rear plate,
  // side plates outboard of the hips)
  const pc = -0.2 * u;
  planLoftT(b, kit.mech, ngonT(8, 0.9 * u, 1.0 * u), [[pelvisY - 0.65 * u, 0.8], [pelvisY - 0.35 * u, 1.0], [pelvisY + 0.35 * u, 1.0], [pelvisY + 0.5 * u, 0.86]], [pc, 0]);
  plateStack(b, kit, kit.armor, frame([0.62 * u, pelvisY - 0.35 * u, 0], [1, -0.28, 0], [0, 1, 0]), trapP(1.15 * u, 0.85 * u, 1.3 * u, 0.12 * u), [
    { inset: 0, thick: pu * 1.2, standoff: pu * 0.6 }, { inset: pu * 1.4, thick: pu * 0.9, mat: kit.armor2, shift: [-0.12 * u, 0] },
  ]);
  armorPlate(b, kit, kit.armor2, frame([-1.05 * u, pelvisY - 0.4 * u, 0], [-1, -0.25, 0], [0, 1, 0]), trapP(1.0 * u, 0.9 * u, 1.25 * u, 0.1 * u), pu * 1.1);
  if (biped) both((s) => {
    for (const [dx, dy, mat] of [[0.15, 0, kit.shell], [-0.55, -0.12, kit.armor2]] as const) {
      armorPlate(b, kit, mat, frame([pc + dx * u, pelvisY - 0.2 * u + dy * u, s * 1.98 * u], [0, -0.18, s], [1, 0, 0]), rectP(0.75 * u, 0.95 * u, 0.1 * u), pu, { standoff: pu * 0.8 });
    }
  });
  // ---- waist: faceted turntable ring on four exposed rams, cable bundles round the back
  const wy = pelvisY + 0.45 * u, ty0 = pelvisY + 0.7 * u;
  planLoftT(b, kit.joint, ngonT(8, 0.78 * u, 0.78 * u), [[wy - 0.05 * u, 1.0], [ty0 + 0.05 * u, 0.94]], [-0.3 * u, 0]);
  planLoftT(b, kit.mech, ngonT(8, 0.95 * u, 0.95 * u), [[wy - 0.02 * u, 1.0], [wy + 0.08 * u, 1.0]], [-0.3 * u, 0]);
  for (const [dx, dz] of [[0.55, 0.6], [0.55, -0.6], [-1.15, 0.6], [-1.15, -0.6]]) piston(b, kit, [pc + dx * u * 0.8, pelvisY + 0.3 * u, dz * u * 1.1], [pc + dx * u, ty0 + 0.25 * u, dz * u * 1.35], 0.08 * u, 0.55, fine);
  if (fine) cableBundle(b, kit, [-1.0 * u, pelvisY + 0.3 * u, 0.5 * u], [-1.25 * u, ty0 + 0.4 * u, 0.55 * u], 0.035 * u, [0, 0, 1], 3, 0.18);

  // ---- torso: keel-fronted chest core leaning forward, faceted (sharp shoulders, no bell)
  const th = 2.4 * u, ty1 = ty0 + th;
  const chest: P2[] = [[1.25 * u, 0], [0.8 * u, 1.5 * u], [-0.9 * u, 1.6 * u], [-1.35 * u, 0.9 * u], [-1.35 * u, -0.9 * u], [-0.9 * u, -1.6 * u], [0.8 * u, -1.5 * u]];
  const cAt: [number, number] = [-0.35 * u, 0];
  planLoftT(b, kit.armor2, chest, [[ty0, 0.72, -0.25 * u], [ty0 + 0.5 * u, 0.96, -0.12 * u], [ty1 - 0.4 * u, 1.0, 0.02 * u], [ty1 - 0.12 * u, 0.97, 0.04 * u], [ty1, 0.86, 0.04 * u]], cAt);
  // armour on the chest walls: keel faces get stacks + ERA either side of the reactor, flanks single plates
  const cLo: [number, number, number] = [ty0 + 0.55 * u, 0.965, -0.1 * u], cHi: [number, number, number] = [ty1 - 0.42 * u, 1.0, 0.02 * u];
  for (let i = 0; i < chest.length; i++) {
    const f = wallFace(chest.map(([x, z]) => [x + (cLo[2] + cHi[2]) / 2, z] as P2), i, [cLo[0], (cLo[1] + cHi[1]) / 2], [cHi[0], cHi[1]], cAt);
    if (f.n.x > 0.8) {
      // keel face: the outer half (the reactor sits on the keel line)
      const du = f.u.z * Math.sign(f.c.z) > 0 ? f.w * 0.22 : -f.w * 0.22;
      const top = plateStack(b, kit, kit.armor, faceFrame(f, du, 0, 0), rectP(f.w * 0.5, f.h * 0.86, pu), [
        { inset: 0, thick: pu * 1.3, standoff: pu * 0.6 }, { inset: pu * 1.5, thick: pu, mat: kit.armor2 },
      ], { gap: pu * 1.2 });
      eraGrid(b, kit, faceFrame(f, du, -f.h * 0.08, top), 3, 2, f.w * 0.18, f.h * 0.2, pu * 0.6, kit.armor2);
    } else if (f.n.x > -0.6) {
      armorPlate(b, kit, i % 2 ? kit.shell : kit.armor, faceFrame(f, 0, -f.h * 0.04, 0), rectP(f.w * 0.82, f.h * 0.8, pu), pu * 1.2, { standoff: pu * 0.5, gap: pu * 1.2 });
      if (f.n.x > 0) faceSlit(b, kit, f, 0, f.h * 0.3, f.w * 0.4, pu * 0.45);
    }
  }
  // reactor in the chest: the glowing heart, in a recessed octagonal cage frame with guard bars
  const rx = 0.78 * u, ry = ty0 + 1.15 * u;
  reactor(b, kit, [rx, ry, 0], 0.46 * u, 'x', 3);
  {
    const P = ngonT(8, 0.62 * u, 0.62 * u);
    for (let i = 0; i < 8; i++) {
      const [ay, az] = P[i], [by2, bz] = P[(i + 1) % 8];
      b.strut(kit.mech, [rx + 0.12 * u, ry + ay, az], [rx + 0.12 * u, ry + by2, bz], 0.07 * u, 0.07 * u, 4);
    }
    if (fine) for (const dy of [-0.22, 0.22]) b.strut(kit.steel, [rx + 0.5 * u, ry + dy * u, -0.5 * u], [rx + 0.5 * u, ry + dy * u, 0.5 * u], 0.03 * u, 0.03 * u, 4);
  }
  // abdominal plates under the chest (stacked, dark gaps)
  for (let i = 0; i < 2; i++) armorPlate(b, kit, kit.shell, frame([0.28 * u - i * 0.06 * u, ty0 + 0.12 * u + i * 0.3 * u, 0], [1, -0.35 + i * 0.2, 0], [0, 0, 1]), rectP((1.3 - i * 0.1) * u, 0.32 * u, 0.06 * u), pu, { standoff: pu * 0.6 });
  // ---- head: a low faceted command cabin sunk between the pauldrons, brow plate, recessed visor, searchlight right,
  // short sensor mast left (asymmetric)
  const hy = ty1 - 0.05 * u, hx = 0.55 * u;
  planLoftT(b, kit.mech, ngonT(6, 0.7 * u, 0.75 * u, 0), [[ty1 - 0.4 * u, 1.0], [ty1 + 0.02 * u, 1.0]], [0.3 * u, 0]);
  const cab: P2[] = [[0.62 * u, 0], [0.38 * u, 0.48 * u], [-0.48 * u, 0.5 * u], [-0.6 * u, 0.25 * u], [-0.6 * u, -0.25 * u], [-0.48 * u, -0.5 * u], [0.38 * u, -0.48 * u]];
  planLoftT(b, kit.armor, cab, [[hy, 1.0], [hy + 0.36 * u, 0.98], [hy + 0.6 * u, 0.74, -0.08 * u]], [hx, 0]);
  b.box(kit.glass, 0.05 * u, 0.12 * u, 0.62 * u, hx + 0.52 * u, hy + 0.3 * u, 0, 0.01, [0, 0, -0.7]);
  armorPlate(b, kit, kit.armor2, frame([hx + 0.1 * u, hy + 0.6 * u, 0], [0.25, 1, 0], [1, 0, 0]), trapP(0.95 * u, 0.55 * u, 0.9 * u, 0.08 * u), pu, { standoff: pu * 0.5 });
  b.box(kit.accent, 0.7 * u, 0.06 * u, 0.12 * u, hx - 0.05 * u, hy + 0.78 * u, 0, 0.02);
  searchlight(b, kit, hx - 0.1 * u, hy + 0.36 * u, 0.48 * u, 0.15, 0.2 * u, fine);
  latticeMast(b, kit, hx - 0.35 * u, hy + 0.5 * u, -0.32 * u, 0.9 * u, 0.09 * u, 0.4);

  // ---- reactor backpack + repair workshop
  const bpX = -2.0 * u, bpY = ty1 + 0.2 * u, dh = bpY - ty0 - 0.3 * u;
  planLoftT(b, kit.mech, [[0.6 * u, 0.55 * u], [-0.6 * u, 0.55 * u], [-0.6 * u, -0.55 * u], [0.6 * u, -0.55 * u]], [[ty0 + 0.2 * u, 1.0], [bpY - 0.2 * u, 1.0], [bpY, 0.88]], [bpX + 0.2 * u, 0]);
  armorPlate(b, kit, kit.armor, frame([bpX + 0.2 * u, bpY, 0], [0, 1, 0], [1, 0, 0]), rectP(1.1 * u, 0.9 * u, 0.12 * u), pu * 0.9, { standoff: pu * 0.3 });
  const rTop = new Map<number, number>();
  both((s) => {
    const dz = s * 0.85 * u, rxp = bpX - 0.15 * u;
    const top = octBarbette(b, kit, rxp, ty0 + 0.1 * u, dz, 0.62 * u, dh, { mat: kit.armor });
    planLoftT(b, kit.glow, ngonT(8, 0.62 * u, 0.62 * u), [[ty0 + 0.1 * u + dh * 0.26, 1.105], [ty0 + 0.1 * u + dh * 0.29, 1.105]], [rxp, dz]);
    rTop.set(s, top);
    // coolant run from the housing over the shoulder into the chest
    if (fine) pipeRun(b, kit, [[rxp + 0.5 * u, ty0 + dh * 0.8, dz * 0.92], [-1.25 * u, ty1 - 0.25 * u, s * 1.15 * u], [-0.2 * u, ty1 - 0.25 * u, s * 1.25 * u]], 0.06 * u, kit.joint);
  });
  // stacks: one tall (left), one short (right)
  octStack(b, kit, bpX - 0.3 * u, rTop.get(-1)! - 0.05 * u, -0.95 * u, 0.2 * u, 1.35 * u, [0, 0, -1]);
  octStack(b, kit, bpX - 0.3 * u, rTop.get(1)! - 0.05 * u, 0.62 * u, 0.17 * u, 0.7 * u, [-1, 0, 0]);
  // left: lattice sensor mast + team banner
  latticeMast(b, kit, bpX - 0.65 * u, bpY - 0.1 * u, -0.45 * u, 2.3 * u, 0.16 * u, 0.3);
  banner(b, kit, bpX - 0.85 * u, bpY - 0.5 * u, -1.15 * u, 3.0 * u, 0.8 * u, -1);
  // SIGNATURE: workshop jib crane on the right housing, folded up and back for the march: a slewing base, a box
  // boom on a lifting ram, a sheave head and a hook block hanging on its cable
  {
    const cz = 1.0 * u, cb: V3 = [bpX - 0.05 * u, rTop.get(1)!, cz];
    planLoftT(b, kit.mech, ngonT(8, 0.34 * u, 0.34 * u), [[cb[1] - 0.02, 1.0], [cb[1] + 0.3 * u, 0.9]], [cb[0], cb[2]]);
    jointDrum(b, kit, [cb[0], cb[1] + 0.42 * u, cz], 0.2 * u, 0.42 * u, 'z');
    const tip: V3 = [bpX - 1.55 * u, cb[1] + 2.75 * u, cz + 0.45 * u];
    const base: V3 = [cb[0], cb[1] + 0.42 * u, cz];
    // box boom: two flanges + a lighter web, slight taper
    for (const e of [-1, 1]) beam(b, kit.armor2, [base[0], base[1], base[2] + e * 0.12 * u], [tip[0], tip[1], tip[2] + e * 0.08 * u], 0.07 * u, 0.24 * u, [1, 0.5, 0]);
    beam(b, kit.hazard, [base[0] - 0.2 * u, base[1] + 0.35 * u, base[2]], [tip[0] + 0.05 * u, tip[1] - 0.08 * u, tip[2]], 0.18 * u, 0.12 * u, [1, 0.5, 0]);
    piston(b, kit, [cb[0] + 0.32 * u, cb[1] + 0.12 * u, cz], [base[0] + (tip[0] - base[0]) * 0.42, base[1] + (tip[1] - base[1]) * 0.42 - 0.08 * u, base[2] + (tip[2] - base[2]) * 0.42], 0.1 * u, 0.55, fine);
    jointDrum(b, kit, tip, 0.15 * u, 0.3 * u, 'z');
    const hook: V3 = [tip[0] - 0.12 * u, tip[1] - 1.45 * u, tip[2]];
    b.strut(kit.steel, [tip[0] - 0.12 * u, tip[1], tip[2]], [hook[0], hook[1] + 0.2 * u, hook[2]], 0.018 * u, 0.018 * u, 4);
    b.box(kit.hazard, 0.22 * u, 0.28 * u, 0.16 * u, hook[0], hook[1] + 0.12 * u, hook[2], 0.03 * u);
    beam(b, kit.joint, [hook[0], hook[1], hook[2]], [hook[0] + 0.1 * u, hook[1] - 0.18 * u, hook[2]], 0.06 * u, 0.06 * u);
  }
  // workshop flanks: tool lockers on the left of the pack, a folded manipulator arm on the right
  both((s) => {
    const z = s * 1.5 * u, x = bpX - 0.15 * u;
    if (s < 0) for (const [dx, dy] of [[0.25, 0.25], [-0.35, 0.25], [0, 1.0]]) stowBox(b, kit, frame([x + dx * u, ty0 + dy * u, z - 0.08 * u], [0, 0, -1], [1, 0, 0]), 0.55 * u, 0.22 * u, 0.6 * u, dy > 0.5 ? kit.shell : kit.armor2);
    else {
      const a: V3 = [x + 0.3 * u, ty0 + 1.3 * u, z], e: V3 = [x - 0.5 * u, ty0 + 0.45 * u, z + 0.05 * u], w: V3 = [x + 0.45 * u, ty0 + 0.25 * u, z + 0.08 * u];
      jointDrum(b, kit, a, 0.16 * u, 0.24 * u, 'z');
      frameLimb(b, kit, a, e, 0.05 * u, [0, 0, 0.07 * u]);
      jointDrum(b, kit, e, 0.12 * u, 0.22 * u, 'z');
      beam(b, kit.armor2, e, w, 0.14 * u, 0.16 * u);
      for (const dz of [-0.06, 0.06]) beam(b, kit.steel, w, [w[0] + 0.22 * u, w[1] + 0.05 * u, w[2] + dz * u], 0.04 * u, 0.05 * u);
      if (fine) hose(b, kit, [x + 0.2 * u, ty0 + 1.5 * u, z - 0.1 * u], e, 0.03 * u, 0.12);
    }
  });
  // crew access: ladder down the back of the pack, a hatch on the deck behind the cabin
  ladder(b, kit, [bpX - 0.62 * u, ty0 + 0.35 * u, 0.2 * u], [bpX - 0.62 * u, bpY, 0.2 * u], 0.3 * u, [0, 0, 1], [-1, 0, 0], 0.04 * u);
  crewHatch(b, kit, frame([-0.55 * u, ty1, 0.05 * u], [0, 1, 0]), 0.18 * u, fine);

  // ---- shoulders + arms carrying the forearm weapon housings under the arm mounts
  const armM = c.mounts.filter((m) => Math.abs(m.z) > 2.0 * u);
  const podTop = new Map<MountSpec, number>();
  const shY = ty1 - 0.5 * u;
  both((s) => {
    const m = armM.find((q) => Math.sign(q.z) === s);
    const az = m ? m.z : s * 2.56 * u, ax = m ? m.x : 0.98 * u;
    const podW = Math.max(1.25 * u, (m?.r ?? 0.6 * u) * 2.2);
    const el: V3 = [-0.55 * u, ty0 - 0.05 * u, az - s * 0.05 * u];
    const top = titanArm(b, kit, s, [-0.4 * u, shY, s * 1.75 * u], el, ax + 0.1 * u, az, ty0 - 0.95 * u, 2.7 * u, podW, 0.95 * u, 0.55 * u, fine);
    if (m) podTop.set(m, top);
    // pauldron: three stepped plates over the shoulder drum, tilted outboard, a drop plate down the outside, team
    // stripe and hazard leading edge
    const pz = s * 2.2 * u;
    const P = frame([-0.58 * u, shY + 0.45 * u, pz], [0, 1, s * 0.5], [1, 0, 0]);
    planLoftT(b, kit.mech, ngonT(6, 0.85 * u, 0.6 * u, 0), [[shY - 0.2 * u, 1.0], [shY + 0.45 * u, 0.9]], [-0.45 * u, s * 2.0 * u]);
    // a thick faceted shell (sloped edges), then two stepped plates on top
    const h0 = armorPlate(b, kit, kit.armor, P, trapP(2.0 * u, 1.3 * u, 1.75 * u, 0.22 * u), pu * 3.2, { standoff: pu * 0.8, taper: 0.72, gap: pu * 1.4 });
    plateStack(b, kit, kit.armor2, frame([-0.66 * u, shY + 0.45 * u, pz], [0, 1, s * 0.5], [1, 0, 0]).multiply(new THREE.Matrix4().makeTranslation(0, h0, 0)), trapP(1.5 * u, 0.8 * u, 1.05 * u, 0.15 * u), [
      { inset: 0, thick: pu * 1.1, standoff: pu * 0.3 }, { inset: pu * 1.8, thick: pu * 0.8, mat: kit.accent, shift: [-0.12 * u, 0] },
    ], { gap: pu });
    armorPlate(b, kit, kit.armor2, frame([-0.5 * u, shY - 0.1 * u, s * 2.95 * u], [0, -0.1, s], [1, 0, 0]), trapP(2.0 * u, 0.8 * u, 1.0 * u, 0.12 * u), pu * 1.3, { standoff: pu * 0.8 });
    hazard(b, kit, 0.38 * u, shY + 0.32 * u, s * 2.25 * u, 1.0 * u, 0.2 * u, 4, Math.PI / 2 + s * 0.15);
    if (s > 0) searchlight(b, kit, 0.2 * u, shY + 0.72 * u, s * 2.05 * u, 0.2, 0.22 * u, fine);
  });

  // ---- shoulder deck walkway (crew scale): a rail round the deck edge, broken at the cabin, the mounts and the pack
  if (fine) {
    const D: P2[] = [[0.5 * u, -1.45 * u], [0.5 * u, 1.45 * u], [-1.55 * u, 1.45 * u], [-1.55 * u, -1.45 * u]];
    railLoop(b, kit, D, ty1 + 0.3 * u, 0.5 * u, (x, z) => (x > -0.1 * u && Math.abs(z) < 0.8 * u) || x < -1.5 * u
      || c.mounts.some((mm) => Math.hypot(mm.x - x, mm.z - z) < mm.r * 1.6 + 0.3 * u), 0.022 * u, 0.3 * u);
  }

  const hips: Hip[] | undefined = biped ? ([-1, 1] as const).map((s) => ({
    p: [-0.25 * u, stance.hipY, s * 1.3 * u] as V3, side: s, t, foot: [-0.15 * u, 0, s * 1.55 * u] as V3, phase: s > 0 ? Math.PI : 0,
  })) : undefined;
  const deck = (x: number, z: number) => (Math.abs(z) < 1.4 * u && x > -1.6 * u && x < 0.9 * u ? ty1 : -1);
  return {
    deckAt: deck, top: bpY, hips, custom: true,
    seat: (m) => {
      const pt = podTop.get(m);
      if (pt !== undefined) { planLoftT(b, kit.mech, ngonT(8, m.r * 1.12, m.r * 1.12), [[pt - 0.05 * u, 1.0], [pt + 0.04 * u, 0.96]], [m.x, m.z]); return { y: pt + 0.04 * u, socket: true }; }
      if (m.x < -1.9 * u) { collar(b, kit, m.x, bpY + 0.1 * u, m.z, m.r, bpY - 0.1 * u, 16); return { y: bpY + 0.1 * u, socket: true }; }
      // shoulder-blade mounts: faceted armoured barbettes on the upper back
      const y = octBarbette(b, kit, m.x, ty1 - 0.2 * u, m.z, m.r * 1.25, 0.5 * u, { mat: kit.armor });
      collar(b, kit, m.x, y, m.z, m.r, y - 0.1 * u, 16);
      return { y, socket: true };
    },
  };
}

registerChassis('colossal', titanWalker);
