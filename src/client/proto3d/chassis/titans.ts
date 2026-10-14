// Titan hulls (size 5): BOSSES. Each one is unmistakably bigger and more dramatic than any giant: towering height,
// a glowing signature feature, masts / banners, huge weapon housings. (citadel: titans-citadel.ts, arachne:
// titans-arachne.ts.)
//
// Titan Walker ("colossal"): a towering humanoid war machine on titan legs. Keel-fronted chest leaning forward with a
// big caged reactor core, a small crested head sunk in a gorget, enormous layered hexagonal pauldrons, arms ending
// in massive forearm weapon housings (the titan / giant guns ride on top, mountOffsets z ~ +-2.56), a hanging
// armoured kilt over the hips, and a reactor backpack with twin smoke stacks, a team banner and an antenna mast.
// On tracks / anchor / spider it rides a turntable waist on a pedestal hull.

import type { P2, V3 } from '../geo.ts';
import type { Bld } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar, exhaust, glow, hazard, sensor, vent } from './shapes.ts';
import { banner, glowGrille, mast, ngon, planLoft, reactor } from './giants-kit.ts';

/** titan arm: shoulder drum, armoured upper arm to the elbow, forearm weapon housing along +x; returns housing top */
export function titanArm(b: Bld, kit: Kit, s: number, sh: V3, el: V3, px: number, pz: number, py: number, podL: number, podW: number, podH: number, t: number): number {
  b.cylb(kit.metal, t * 1.2, t * 1.6, t * 0.2, [sh[0], sh[1], sh[2] - s * t * 0.8], s > 0 ? 'z' : '-z', 14);
  beam(b, kit.trim, sh, el, t * 1.3, t * 1.3, [1, 0, 0]);
  beam(b, kit.hull, [sh[0] + t * 0.5, sh[1] - t * 0.5, sh[2] + s * t * 0.15], [el[0] + t * 0.5, el[1] + t * 0.5, el[2] + s * t * 0.15], t * 0.8, t * 1.6, [0, 0, s]);
  b.cylb(kit.metal, t * 0.95, t * 1.5, t * 0.14, [el[0], el[1], el[2] - s * t * 0.75], s > 0 ? 'z' : '-z', 12);
  // forearm housing: dark core, armoured shell with chamfered nose, glow strip, knuckle claws under the muzzle end
  block(b, kit.trim, px, py, pz, podL * 0.9, podW * 0.8, podH * 0.45, { ch: podW * 0.2 });
  block(b, kit.hull, px + podL * 0.03, py + podH * 0.22, pz, podL, podW, podH * 0.78, { top: [0.84, 0.82], shift: [-podL * 0.05, 0], ch: podW * 0.26, bev: podH * 0.14, bot: podH * 0.08 });
  block(b, kit.panel, px - podL * 0.15, py + podH * 0.5, pz + s * podW * 0.42, podL * 0.5, podW * 0.22, podH * 0.4, { ch: podW * 0.06 });
  glow(b, kit, px + podL * 0.1, py + podH * 0.62, pz + s * podW * 0.52, podL * 0.5, podH * 0.07, podW * 0.05);
  hazard(b, kit, px + podL * 0.44, py + podH, pz, podW * 0.7, podL * 0.08, 4, Math.PI / 2);
  for (const dz of [-0.28, 0, 0.28]) beam(b, kit.metal, [px + podL * 0.42, py + podH * 0.2, pz + dz * podW], [px + podL * 0.62, py - podH * 0.15, pz + dz * podW * 1.1], podW * 0.16, podW * 0.2);
  return py + podH;
}

function titanWalker(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const u = Math.min(L, W) / 7; // authored in cells for the 7 x 7 titan
  const biped = stance.legs === 'biped';
  const t = biped ? stance.thick : 0.5 * u;
  let pelvisY: number;
  if (biped) pelvisY = stance.hipY;
  else if (stance.legs === 'spider') {
    pelvisY = stance.hipY + 0.6 * u;
    planLoft(b, kit.trim, ngon(8, 1.8 * u, 1.8 * u), [[stance.y0 - 0.1, 0.8], [stance.hipY, 1.0], [pelvisY, 0.8]], [-0.3 * u, 0]);
  } else {
    // pedestal hull over the running gear: an octagonal armoured deck plus a turntable waist
    pelvisY = stance.yt + 0.9 * u;
    const dy = stance.yt + 0.36 * u;
    planLoft(b, kit.trim, ngon(8, L * 0.4, W * 0.3), [[stance.y0, 0.95], [stance.yt, 1.0]], [-0.2 * u, 0]);
    planLoft(b, kit.hull, ngon(8, L * 0.47, W * 0.4), [[stance.yt - 0.1 * u, 0.94], [stance.yt + 0.12 * u, 1.0], [dy, 0.9]], [-0.2 * u, 0]);
    both((s) => { hazard(b, kit, 2.3 * u, dy + 0.01 * u, s * 1.2 * u, 0.9 * u, 0.36 * u, 5, 0); vent(b, kit, -2.3 * u, dy, s * 1.1 * u, 0.9 * u, 0.6 * u, 3, 'x'); });
    b.cylb(kit.trim, 1.6 * u, 0.14 * u, 0.04 * u, [-0.2 * u, dy, 0], 'y', 20);
    b.cylb(kit.metal, 1.2 * u, pelvisY - dy, 0.1 * u, [-0.2 * u, dy, 0], 'y', 20);
  }
  // pelvis core between the hip joints + hanging armoured kilt (front, back, hip plates)
  block(b, kit.trim, -0.2 * u, pelvisY - 0.6 * u, 0, 1.6 * u, 1.7 * u, 1.15 * u, { top: [0.86, 1.04], ch: 0.32 * u, bev: 0.06 * u });
  block(b, kit.hull, 0.6 * u, pelvisY - 0.85 * u, 0, 0.36 * u, 1.3 * u, 1.3 * u, { top: [0.5, 0.86], shift: [-0.14 * u, 0], ch: 0.16 * u, bev: 0.05 * u });
  hazard(b, kit, 0.62 * u, pelvisY - 0.3 * u, 0, 0.9 * u, 0.12 * u, 4, Math.PI / 2);
  block(b, kit.hull, -1.05 * u, pelvisY - 0.75 * u, 0, 0.34 * u, 1.3 * u, 1.2 * u, { top: [0.5, 0.86], shift: [0.12 * u, 0], ch: 0.16 * u, bev: 0.05 * u });
  if (biped) both((s) => block(b, kit.panel, -0.25 * u, pelvisY - 0.35 * u, s * 1.95 * u, 1.2 * u, 0.24 * u, 0.95 * u, { top: [0.9, 0.6], shift: [0, -s * 0.2 * u], ch: 0.1 * u, bev: 0.05 * u }));
  // waist
  b.cylb(kit.metal, 0.75 * u, 0.6 * u, 0.08 * u, [-0.3 * u, pelvisY + 0.3 * u, 0], 'y', 14);
  // torso: keel-fronted hexagonal chest, leaning forward, widening up to the shoulders
  const ty0 = pelvisY + 0.7 * u, th = 2.4 * u, ty1 = ty0 + th;
  const chest: P2[] = [[1.25 * u, 0], [0.8 * u, 1.5 * u], [-0.9 * u, 1.6 * u], [-1.35 * u, 0.9 * u], [-1.35 * u, -0.9 * u], [-0.9 * u, -1.6 * u], [0.8 * u, -1.5 * u]];
  planLoft(b, kit.hull, chest, [[ty0, 0.7, -0.25 * u], [ty0 + 0.6 * u, 0.94, -0.15 * u], [ty0 + 1.55 * u, 1.04, 0], [ty1 - 0.12 * u, 0.98, 0.04 * u], [ty1, 0.86, 0.04 * u]], [-0.35 * u, 0]);
  // abdominal plates (stacked, dark gaps) below the chest
  for (let i = 0; i < 2; i++) block(b, kit.panel, 0.42 * u - i * 0.08 * u, ty0 - 0.05 * u + i * 0.3 * u, 0, 0.4 * u, (1.3 - i * 0.1) * u, 0.26 * u, { top: [0.7, 0.9], ch: 0.12 * u, bev: 0.04 * u });
  // reactor core in the chest: the boss's glowing heart
  reactor(b, kit, [0.78 * u, ty0 + 1.15 * u, 0], 0.46 * u, 'x', 3);
  // upper chest plates either side of the core
  both((s) => {
    block(b, kit.panel, 0.48 * u, ty0 + 1.45 * u, s * 0.82 * u, 0.6 * u, 0.85 * u, 0.55 * u, { top: [0.5, 0.86], shift: [0.12 * u, 0], ch: 0.2 * u, bev: 0.05 * u });
    glowGrille(b, kit, 0.62 * u, ty0 + 0.65 * u, s * 0.95 * u, 0.5 * u, 0.4 * u, 3);
    glow(b, kit, -0.5 * u, ty1 - 0.3 * u, s * 1.62 * u, 1.3 * u, 0.06 * u, 0.06 * u);
  });
  // head: small, sunk in a gorget, glowing visor, accent crest fin, sensor horns
  const hy = ty1 - 0.05 * u;
  block(b, kit.trim, 0.3 * u, ty1 - 0.35 * u, 0, 1.1 * u, 1.3 * u, 0.5 * u, { top: [0.8, 0.8], ch: 0.3 * u });
  block(b, kit.hull, 0.62 * u, hy, 0, 0.9 * u, 0.85 * u, 0.62 * u, { top: [0.6, 0.72], shift: [-0.1 * u, 0], ch: 0.24 * u, bev: 0.06 * u });
  glow(b, kit, 1.02 * u, hy + 0.33 * u, 0, 0.07 * u, 0.09 * u, 0.62 * u, [0, 0, -0.9]);
  b.box(kit.glass, 0.06 * u, 0.12 * u, 0.7 * u, 1.05 * u, hy + 0.27 * u, 0, 0.02, [0, 0, -0.7]);
  block(b, kit.accent, 0.5 * u, hy + 0.55 * u, 0, 0.8 * u, 0.1 * u, 0.32 * u, { top: [0.4, 1], shift: [-0.25 * u, 0], ch: 0.03 * u, bev: 0.02 * u });
  both((s) => beam(b, kit.steel, [0.55 * u, hy + 0.45 * u, s * 0.36 * u], [0.25 * u, hy + 1.0 * u, s * 0.5 * u], 0.06 * u, 0.06 * u));
  // reactor backpack: twin upright reactor drums with glowing bands either side of an armoured spine; smoke stacks
  // rise from the drums, the rear heavy rides on the spine between them
  const bpX = -2.0 * u, bpY = ty1 + 0.2 * u;
  block(b, kit.trim, bpX + 0.2 * u, ty0 + 0.2 * u, 0, 1.2 * u, 1.1 * u, bpY - ty0 - 0.2 * u, { top: [0.86, 0.9], ch: 0.3 * u, bev: 0.08 * u });
  both((s) => {
    const dz = s * 0.85 * u, dh = bpY - ty0 - 0.3 * u;
    b.lathe(kit.hull, [[0, 0], [0.62 * u, 0], [0.7 * u, 0.2 * u], [0.7 * u, dh - 0.2 * u], [0.55 * u, dh], [0, dh]], [bpX - 0.15 * u, ty0 + 0.1 * u, dz], 'y', 16);
    for (const f of [0.35, 0.62]) b.lathe(kit.glow, [[0.69 * u, 0], [0.73 * u, 0], [0.73 * u, 0.08 * u], [0.69 * u, 0.08 * u]], [bpX - 0.15 * u, ty0 + 0.1 * u + dh * f, dz], 'y', 16);
    exhaust(b, kit, bpX - 0.25 * u, bpY - 0.12 * u, dz + s * 0.15 * u, 0.22 * u, 1.1 * u);
  });
  // the boss's colours: a tall team banner on the left of the pack, an antenna mast on the right
  banner(b, kit, bpX - 0.8 * u, bpY - 0.5 * u, -1.0 * u, 3.0 * u, 0.8 * u, -1);
  mast(b, kit, bpX - 0.75 * u, bpY - 0.3 * u, 1.0 * u, 2.3 * u, 0.06 * u);
  // shoulders + arms carrying the forearm weapon housings under the arm mounts
  const armM = c.mounts.filter((m) => Math.abs(m.z) > 2.0 * u);
  const podTop = new Map<MountSpec, number>();
  const shY = ty1 - 0.5 * u;
  both((s) => {
    const m = armM.find((q) => Math.sign(q.z) === s);
    const az = m ? m.z : s * 2.56 * u, ax = m ? m.x : 0.98 * u;
    const podW = Math.max(1.25 * u, (m?.r ?? 0.6 * u) * 2.2);
    const el: V3 = [-0.55 * u, ty0 - 0.05 * u, az - s * 0.05 * u];
    const top = titanArm(b, kit, s, [-0.4 * u, shY, s * 1.75 * u], el, ax + 0.1 * u, az, ty0 - 0.95 * u, 2.7 * u, podW, 0.95 * u, 0.55 * u);
    if (m) podTop.set(m, top);
    // pauldron: a huge hexagonal shell over the shoulder, a raised second layer, accent stripe, hazard leading edge
    const pz = s * 2.25 * u;
    planLoft(b, kit.hull, ngon(6, 1.05 * u, 0.85 * u, 0), [[shY - 0.55 * u, 0.88], [shY + 0.15 * u, 1.0], [shY + 0.6 * u, 0.82], [shY + 0.78 * u, 0.5]], [-0.45 * u, pz]);
    planLoft(b, kit.panel, ngon(6, 0.8 * u, 0.55 * u, 0), [[shY + 0.6 * u, 0.9], [shY + 0.95 * u, 0.7], [shY + 1.02 * u, 0.4]], [-0.55 * u, pz + s * 0.08 * u]);
    b.box(kit.accent, 1.5 * u, 0.06 * u, 0.16 * u, -0.45 * u, shY + 0.42 * u, s * 3.0 * u, 0.02, [s * 0.5, 0, 0]);
    hazard(b, kit, 0.5 * u, shY + 0.25 * u, pz, 1.0 * u, 0.3 * u, 4, Math.PI / 2 + s * 0.15);
    b.box(kit.lamp, 0.08 * u, 0.12 * u, 0.3 * u, 0.58 * u, shY + 0.05 * u, pz + s * 0.25 * u, 0.02);
    // swept armour fin rising off the pauldron
    block(b, kit.panel, -0.75 * u, shY + 0.8 * u, pz + s * 0.25 * u, 0.9 * u, 0.14 * u, 0.6 * u, { top: [0.3, 0.8], shift: [-0.4 * u, s * 0.12 * u], ch: 0.05 * u, bev: 0.03 * u });
  });
  const hips: Hip[] | undefined = biped ? ([-1, 1] as const).map((s) => ({
    p: [-0.25 * u, stance.hipY, s * 1.3 * u] as V3, side: s, t, foot: [-0.15 * u, 0, s * 1.55 * u] as V3, phase: s > 0 ? Math.PI : 0,
  })) : undefined;
  const deck = (x: number, z: number) => (Math.abs(z) < 1.4 * u && x > -1.6 * u && x < 0.9 * u ? ty1 : -1);
  return {
    deckAt: deck, top: bpY, hips, custom: true,
    seat: (m) => {
      const pt = podTop.get(m);
      if (pt !== undefined) { b.lathe(kit.trim, [[0, -0.06 * u], [m.r * 1.08, -0.06 * u], [m.r * 1.08, 0.03 * u], [0, 0.03 * u]], [m.x, pt, m.z], 'y', 20); return { y: pt + 0.03 * u, socket: true }; }
      if (m.x < -1.9 * u) { collar(b, kit, m.x, bpY + 0.1 * u, m.z, m.r, bpY - 0.1 * u, 18); return { y: bpY + 0.1 * u, socket: true }; }
      // shoulder-blade mounts: raised armoured bases on the upper back
      const y = ty1 + 0.3 * u;
      block(b, kit.hull, m.x, ty1 - 0.2 * u, m.z, m.r * 2.6, m.r * 2.4, y - ty1 + 0.2 * u, { top: [0.82, 0.82], ch: m.r * 0.7, bev: 0.05 * u });
      collar(b, kit, m.x, y, m.z, m.r, y - 0.1 * u, 18);
      return { y, socket: true };
    },
  };
}

registerChassis('colossal', titanWalker);
void sensor;
