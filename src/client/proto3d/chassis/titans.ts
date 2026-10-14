// Titan hulls. Titan Walker ("colossal"): a heroic humanoid war machine. Broad chest with a glowing reactor core, a
// small visor head sunk between towering shoulders, huge layered pauldrons, arms ending in forearm weapon platforms
// that carry the titan / giant guns (mountOffsets: forearms at z ~ +-2.57), shoulder-blade heavies and a reactor
// backpack with stacks for the rear mount. Stands on titan legs; on tracks / anchor it rides a waist pedestal.

import type { V3 } from '../geo.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { mechArm } from './walkers.ts';
import { block, both, collar, exhaust, glow, hazard, sensor, vent } from './shapes.ts';

function titanWalker(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const u = Math.min(L, W) / 7; // authored in cells for the 7 x 7 titan
  const biped = stance.legs === 'biped';
  const t = biped ? stance.thick : 0.42 * u;
  let pelvisY: number;
  if (biped) pelvisY = stance.hipY;
  else if (stance.legs === 'spider') {
    pelvisY = stance.hipY + 0.5 * u;
    block(b, kit.trim, -0.3 * u, stance.y0 - 0.05, 0, 3.4 * u, 3.4 * u, pelvisY - stance.y0, { top: [0.8, 0.8], ch: 1.0 * u, bev: 0.1 * u, bot: 0.2 * u });
  } else {
    // pedestal hull over the running gear: a wide armoured deck plus a turntable waist
    pelvisY = stance.yt + 0.75 * u;
    const dy = stance.yt + 0.26 * u;
    block(b, kit.trim, -0.2 * u, stance.y0, 0, L * 0.7, W * 0.46, dy - stance.y0 - 0.1 * u, { ch: 0.4 * u });
    block(b, kit.hull, -0.2 * u, stance.yt - 0.12 * u, 0, L * 0.74, W * 0.54, 0.38 * u, { top: [0.94, 0.9], ch: 0.6 * u, bev: 0.1 * u, bot: 0.06 * u });
    both((s) => { hazard(b, kit, 2.1 * u, dy + 0.01 * u, s * 1.3 * u, 0.9 * u, 0.36 * u, 5, 0); vent(b, kit, -2.0 * u, dy, s * 1.1 * u, 0.9 * u, 0.6 * u, 3, 'x'); });
    b.cylb(kit.trim, 1.45 * u, 0.12 * u, 0.04 * u, [-0.2 * u, dy, 0], 'y', 20);
    b.cylb(kit.metal, 1.15 * u, pelvisY - dy, 0.1 * u, [-0.2 * u, dy, 0], 'y', 20);
  }
  // pelvis: dark core between the hip drums with armoured tassets front and back
  block(b, kit.trim, -0.2 * u, pelvisY - 0.55 * u, 0, 1.5 * u, 1.45 * u, 1.0 * u, { top: [0.86, 1.06], ch: 0.3 * u, bev: 0.06 * u });
  block(b, kit.hull, 0.55 * u, pelvisY - 0.5 * u, 0, 0.4 * u, 1.1 * u, 0.9 * u, { top: [0.55, 0.85], shift: [-0.1 * u, 0], ch: 0.14 * u, bev: 0.05 * u });
  block(b, kit.hull, -0.95 * u, pelvisY - 0.45 * u, 0, 0.36 * u, 1.1 * u, 0.85 * u, { top: [0.55, 0.85], shift: [0.08 * u, 0], ch: 0.14 * u, bev: 0.05 * u });
  // waist
  block(b, kit.metal, -0.3 * u, pelvisY + 0.35 * u, 0, 1.2 * u, 1.3 * u, 0.35 * u, { ch: 0.3 * u });
  const ty0 = pelvisY + 0.6 * u, th = 1.75 * u, ty1 = ty0 + th;
  // torso: a broad tapered chest leaning forward, mid bulge, layered chest plates
  block(b, kit.hull, -0.35 * u, ty0, 0, 2.6 * u, 3.0 * u, th, { top: [0.86, 0.9], shift: [0.08 * u, 0], ch: 0.55 * u, bev: 0.14 * u, bot: 0.14 * u, mid: [[0.5, 1.06, 1.05]] });
  block(b, kit.panel, 0.72 * u, ty0 + 0.18 * u, 0, 0.7 * u, 2.3 * u, th * 0.72, { top: [0.45, 0.85], shift: [0.16 * u, 0], ch: 0.32 * u, bev: 0.08 * u });
  block(b, kit.hull, 0.6 * u, ty0 - 0.15 * u, 0, 0.6 * u, 1.6 * u, 0.6 * u, { top: [0.6, 0.9], shift: [0.05 * u, 0], ch: 0.2 * u, bev: 0.05 * u });
  // reactor core: recessed housing with a big glow lens
  b.cylb(kit.trim, 0.42 * u, 0.2 * u, 0.04 * u, [1.08 * u, ty0 + th * 0.48, 0], 'x', 16);
  b.cylb(kit.glow, 0.28 * u, 0.06 * u, 0.02 * u, [1.26 * u, ty0 + th * 0.48, 0], 'x', 16);
  both((s) => { vent(b, kit, 1.12 * u, ty0 + th * 0.25, s * 0.75 * u, 0.06 * u, 0.5 * u, 3, 'z'); glow(b, kit, 0.6 * u, ty1 - 0.25 * u, s * 1.28 * u, 1.4 * u, 0.06 * u, 0.06 * u, [s * 0.5, 0, 0]); });
  // head: small armoured cockpit sunk between the shoulders, glowing visor, sensor ears
  const hy = ty1 - 0.42 * u;
  block(b, kit.hull, 0.95 * u, hy, 0, 0.95 * u, 1.05 * u, 0.62 * u, { top: [0.62, 0.78], shift: [-0.1 * u, 0], ch: 0.26 * u, bev: 0.06 * u });
  glow(b, kit, 1.36 * u, hy + 0.34 * u, 0, 0.07 * u, 0.08 * u, 0.7 * u, [0, 0, -0.9]);
  b.box(kit.glass, 0.06 * u, 0.12 * u, 0.78 * u, 1.4 * u, hy + 0.28 * u, 0, 0.02, [0, 0, -0.7]);
  both((s) => sensor(b, kit, 0.8 * u, hy + 0.42 * u, s * 0.58 * u, 0.22 * u));
  // reactor backpack: tall block, vents, twin stacks; the rear heavy rides on top
  const bpY = ty1 + 0.15 * u;
  block(b, kit.trim, -2.15 * u, ty0 + 0.1 * u, 0, 1.3 * u, 2.2 * u, bpY - ty0 - 0.1 * u, { top: [0.86, 0.9], ch: 0.4 * u, bev: 0.08 * u });
  block(b, kit.hull, -2.2 * u, ty0 + 0.3 * u, 0, 1.36 * u, 1.6 * u, bpY - ty0 - 0.2 * u, { top: [0.9, 0.92], ch: 0.3 * u, bev: 0.08 * u });
  both((s) => {
    exhaust(b, kit, -2.55 * u, ty0 + th * 0.55, s * 1.25 * u, 0.2 * u, 1.0 * u);
    vent(b, kit, -2.86 * u, ty0 + th * 0.4, s * 0.45 * u, 0.06 * u, 0.5 * u, 3, 'z');
  });
  glow(b, kit, -2.9 * u, ty0 + th * 0.7, 0, 0.05 * u, 0.6 * u, 0.12 * u);
  // shoulders + arms carrying the forearm weapon platforms under the arm mounts
  const armM = c.mounts.filter((m) => Math.abs(m.z) > 2.0 * u);
  const podTop = new Map<MountSpec, number>();
  both((s) => {
    const m = armM.find((q) => Math.sign(q.z) === s);
    const az = m ? m.z : s * 2.57 * u, ax = m ? m.x : 0.98 * u;
    const shY = ty1 - 0.45 * u;
    const podW = Math.max(1.1 * u, (m?.r ?? 0.6 * u) * 2.15);
    const top = mechArm(b, kit, s, [-0.45 * u, shY, s * 1.65 * u], [-0.5 * u, ty0 - 0.1 * u, az - s * 0.1 * u], [ax + 0.25 * u, ty0 - 0.75 * u, az], 2.4 * u, podW, 0.8 * u, 0.5 * u);
    if (m) podTop.set(m, top);
    // pauldron: big layered shoulder armour with accent and hazard trim
    block(b, kit.hull, -0.85 * u, shY - 0.35 * u, s * 2.0 * u, 1.7 * u, 1.05 * u, 0.95 * u, { top: [0.82, 0.62], shift: [-0.05 * u, s * 0.1 * u], ch: 0.3 * u, bev: 0.16 * u, bot: 0.1 * u });
    block(b, kit.panel, -0.85 * u, shY + 0.5 * u, s * 1.92 * u, 1.3 * u, 0.6 * u, 0.22 * u, { top: [0.86, 0.7], ch: 0.16 * u, bev: 0.06 * u });
    b.box(kit.accent, 1.3 * u, 0.04 * u, 0.12 * u, -0.85 * u, shY + 0.6 * u, s * 2.36 * u, 0.02);
    hazard(b, kit, 0.02 * u, shY + 0.4 * u, s * 2.1 * u, 0.4 * u, 0.5 * u, 3, Math.PI / 2);
  });
  const hips: Hip[] | undefined = biped ? ([-1, 1] as const).map((s) => ({
    p: [-0.25 * u, stance.hipY, s * 1.22 * u] as V3, side: s, t, foot: [-0.2 * u, 0, s * 1.4 * u] as V3, phase: s > 0 ? Math.PI : 0,
  })) : undefined;
  const deck = (x: number, z: number) => (Math.abs(z) < 1.35 * u && x > -1.6 * u && x < 0.9 * u ? ty1 : -1);
  return {
    deckAt: deck, top: bpY, hips, custom: true,
    seat: (m) => {
      const pt = podTop.get(m);
      if (pt !== undefined) { b.lathe(kit.trim, [[0, -0.05 * u], [m.r * 1.04, -0.05 * u], [m.r * 1.04, 0.02 * u], [0, 0.02 * u]], [m.x, pt, m.z], 'y', 20); return { y: pt + 0.02 * u, socket: true }; }
      if (m.x < -2.0 * u) { collar(b, kit, m.x, bpY + 0.08 * u, m.z, m.r, bpY - 0.1 * u, 18); return { y: bpY + 0.08 * u, socket: true }; }
      const y = ty1 + 0.1 * u;
      collar(b, kit, m.x, y, m.z, m.r, ty1 - 0.12 * u, 18);
      return { y, socket: true };
    },
  };
}

registerChassis('colossal', titanWalker);
