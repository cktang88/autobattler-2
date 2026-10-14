// Walker hulls: Strider (humanoid skirmisher mech: squat torso slung between thick legs, big pauldrons, arm gun pods)
// and Orbwalker / arachnid (glass orb cockpit on a neck collar ahead of an armoured abdomen, four arching legs).

import type { V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import type { Bld } from '../geo.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar, dome, exhaust, glow, hazard, pod, sensor, vent } from './shapes.ts';

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

function strider(c: ChassisCtx): ChassisOut {
  const { b, kit, W, L, stance } = c;
  const u = Math.min(L, W) / 2; // 1 for the 2x2 strider
  const t = stance.legs === 'biped' ? stance.thick : 0.15 * u;
  // pelvis / torso heights: legged = slung on the hips; anchored / spider = on a pedestal
  const pelvisY = stance.legs === 'biped' ? stance.hipY : Math.max(stance.yt, stance.hipY) + 0.1 * u;
  if (stance.legs !== 'biped') block(b, kit.trim, -0.02 * u, stance.y0 - 0.02, 0, 0.62 * u, 0.62 * u, pelvisY - stance.y0 + 0.04, { top: [0.8, 0.8], ch: 0.12 * u });
  // pelvis: dark core between the hip drums, armoured codpiece / tassets
  block(b, kit.trim, -0.02 * u, pelvisY - 0.2 * u, 0, 0.5 * u, 0.42 * u, 0.36 * u, { top: [0.9, 1.1], ch: 0.1 * u });
  block(b, kit.hull, 0.2 * u, pelvisY - 0.18 * u, 0, 0.16 * u, 0.34 * u, 0.3 * u, { top: [0.6, 0.8], shift: [-0.04 * u, 0], ch: 0.05 * u });
  const ty0 = pelvisY + 0.06 * u, th = 0.48 * u, ty1 = ty0 + th;
  // waist + torso: tapered chest block leaning forward, layered chest plate, back armour
  block(b, kit.metal, -0.04 * u, pelvisY + 0.04 * u, 0, 0.42 * u, 0.4 * u, 0.12 * u, { ch: 0.1 * u });
  block(b, kit.hull, -0.05 * u, ty0, 0, 0.84 * u, 0.86 * u, th, { top: [0.86, 0.92], shift: [0.03 * u, 0], ch: 0.16 * u, bev: 0.07 * u, bot: 0.06 * u, mid: [[0.45, 1.06, 1.04]] });
  block(b, kit.panel, 0.3 * u, ty0 + 0.08 * u, 0, 0.3 * u, 0.7 * u, th * 0.68, { top: [0.5, 0.86], shift: [0.07 * u, 0], ch: 0.12 * u, bev: 0.04 * u });
  // cockpit head sunk between the shoulders: sloped visor block with a glowing visor slit
  block(b, kit.hull, 0.36 * u, ty1 - 0.14 * u, 0, 0.34 * u, 0.42 * u, 0.24 * u, { top: [0.62, 0.8], shift: [-0.04 * u, 0], ch: 0.1 * u, bev: 0.04 * u });
  glow(b, kit, 0.5 * u, ty1 - 0.02 * u, 0, 0.05 * u, 0.05 * u, 0.3 * u, [0, 0, -0.9]);
  b.box(kit.glass, 0.04 * u, 0.06 * u, 0.36 * u, 0.53 * u, ty1 - 0.06 * u, 0, 0.01, [0, 0, -0.75]);
  // chest glow core + vents
  glow(b, kit, 0.47 * u, ty0 + th * 0.36, 0, 0.04 * u, 0.12 * u, 0.12 * u);
  for (const s of [-1, 1]) vent(b, kit, 0.45 * u, ty0 + th * 0.2, s * 0.22 * u, 0.04 * u, 0.16 * u, 2, 'z');
  // backpack: power pack with twin exhausts
  block(b, kit.trim, -0.56 * u, ty0 + 0.06 * u, 0, 0.24 * u, 0.6 * u, th * 0.8, { top: [0.8, 0.9], ch: 0.08 * u });
  for (const s of [-1, 1]) { b.cylb(kit.metal, 0.07 * u, 0.2 * u, 0.02, [-0.66 * u, ty0 + th * 0.5, s * 0.17 * u], 'y', 10); b.cyl(kit.hot, 0.05 * u, 0.05 * u, 0.01, [-0.66 * u, ty0 + th * 0.5 + 0.2 * u, s * 0.17 * u], 'y', 10); }
  // shoulders + arms: arm pods are anatomy under the arm mounts (mountOffsets: forearm guns at z ~ +-0.68)
  const armMounts = c.mounts.filter((m) => Math.abs(m.z) > 0.45 * u);
  const podTop = new Map<MountSpec, number>();
  both((s) => {
    const m = armMounts.find((q) => Math.sign(q.z) === s);
    const az = m ? m.z : s * 0.66 * u, ax = m ? m.x : 0.06 * u;
    const shY = ty1 - 0.14 * u;
    const sh: V3 = [-0.12 * u, shY, s * 0.48 * u], el: V3 = [-0.12 * u, ty0 + 0.04 * u, az - s * 0.02 * u];
    const podW = Math.max(0.3 * u, (m?.r ?? 0.15) * 2.0);
    const top = mechArm(b, kit, s, sh, el, [ax + 0.08 * u, ty0 - 0.14 * u, az], 0.64 * u, podW, 0.26 * u, t * 0.6);
    if (m) podTop.set(m, top);
    // pauldron: big layered shoulder armour set back over the shoulder joint, team accent stripe
    block(b, kit.hull, -0.17 * u, shY - 0.08 * u, s * 0.5 * u, 0.5 * u, 0.32 * u, 0.3 * u, { top: [0.8, 0.66], shift: [-0.02 * u, s * 0.03 * u], ch: 0.1 * u, bev: 0.06 * u, bot: 0.04 * u });
    block(b, kit.panel, -0.17 * u, shY + 0.18 * u, s * 0.52 * u, 0.36 * u, 0.18 * u, 0.07 * u, { top: [0.86, 0.7], ch: 0.05 * u, bev: 0.02 * u });
    b.box(kit.accent, 0.3 * u, 0.012 * u, 0.04 * u, -0.17 * u, shY + 0.21 * u, s * 0.6 * u, 0.004);
  });
  const hips: Hip[] | undefined = stance.legs === 'biped' ? ([-1, 1] as const).map((s) => ({
    p: [-0.03 * u, stance.hipY, s * 0.3 * u] as V3, side: s, t, foot: [-0.02 * u, 0, s * 0.34 * u] as V3, phase: s > 0 ? Math.PI : 0,
  })) : undefined;
  const deck = (x: number, z: number) => (Math.abs(z) < 0.42 * u && x > -0.5 * u && x < 0.38 * u ? ty1 : -1);
  return {
    deckAt: deck, top: ty1, hips, custom: true,
    seat: (m) => {
      const pt = podTop.get(m);
      if (pt !== undefined) { collar(b, kit, m.x, pt, m.z, m.r, pt - 0.06 * u, 14); return { y: pt, socket: true }; }
      // shoulder / back mount: on the torso top with a raised collar
      collar(b, kit, m.x, ty1 + 0.05 * u, m.z, m.r, ty1 - 0.04 * u, 16);
      return { y: ty1 + 0.05 * u, socket: true };
    },
  };
}

function orbwalker(c: ChassisCtx): ChassisOut {
  const { b, kit, W, L, stance } = c;
  const u = Math.min(L, W) / 2;
  const t = stance.thick || 0.13 * u;
  const by = stance.legs === 'spider' ? stance.hipY : stance.legs === 'biped' ? stance.hipY + 0.05 * u : stance.yt + 0.18 * u;
  if (stance.legs === null) block(b, kit.trim, -0.15 * u, stance.y0 - 0.02, 0, 0.6 * u, 0.6 * u, by - stance.y0, { top: [0.8, 0.8], ch: 0.14 * u });
  // abdomen: armoured egg with a flat dorsal deck for the twin mounts
  const ax = -0.2 * u, ay = by + 0.12 * u;
  pod(b, kit.trim, [ax, ay - 0.06 * u, 0], 0.52 * u, 0.26 * u, 0.44 * u, 10, 6, 2.4, 0.3);
  pod(b, kit.hull, [ax + 0.02 * u, ay + 0.02 * u, 0], 0.56 * u, 0.24 * u, 0.5 * u, 12, 6, 2.6, 0.6);
  const deckY = ay + 0.24 * u;
  block(b, kit.hull, ax - 0.06 * u, ay + 0.08 * u, 0, 0.78 * u, 0.82 * u, deckY - ay - 0.08 * u, { top: [0.84, 0.88], ch: 0.22 * u, bev: 0.05 * u });
  block(b, kit.panel, ax - 0.38 * u, ay + 0.02 * u, 0, 0.26 * u, 0.6 * u, deckY - ay - 0.02 * u, { top: [0.6, 0.86], shift: [-0.04 * u, 0], ch: 0.12 * u, bev: 0.04 * u });
  // rear spinneret / power cell glow + tail lights
  glow(b, kit, ax - 0.56 * u, ay + 0.06 * u, 0, 0.04 * u, 0.1 * u, 0.24 * u);
  for (const s of [-1, 1]) glow(b, kit, ax, deckY - 0.03 * u, s * 0.42 * u, 0.4 * u, 0.04 * u, 0.04 * u, [0, s * 0.15, 0]);
  // neck collar + orb cockpit
  const hx = 0.4 * u, hy = by + 0.16 * u, hr = 0.3 * u;
  b.cylb(kit.metal, 0.17 * u, 0.32 * u, 0.03 * u, [0.05 * u, hy, 0], 'x', 12);
  b.cylb(kit.trim, 0.2 * u, 0.06 * u, 0.02 * u, [0.12 * u, hy, 0], 'x', 12);
  // lower armoured bowl, glass upper dome, glowing equator ring and eye
  b.lathe(kit.hull, [[0, -hr * 0.85], [hr * 0.55, -hr * 0.82], [hr * 0.92, -hr * 0.45], [hr * 1.04, 0], [hr * 1.04, hr * 0.08], [0, hr * 0.08]], [hx, hy, 0], 'y', 16);
  dome(b, kit.glass, [hx, hy + hr * 0.08, 0], hr * 0.96, hr * 0.92, 16, 3);
  b.lathe(kit.glow, [[hr * 0.98, -0.01], [hr * 1.07, -0.01], [hr * 1.07, 0.012 * u], [hr * 0.98, 0.012 * u]], [hx, hy + hr * 0.04, 0], 'y', 16);
  sensor(b, kit, hx + hr * 0.82, hy - hr * 0.3, 0, 0.12 * u);
  // mandibles: two short armoured prongs under the orb
  for (const s of [-1, 1]) beam(b, kit.trim, [hx + hr * 0.4, hy - hr * 0.6, s * hr * 0.4], [hx + hr * 1.25, hy - hr * 0.95, s * hr * 0.55], 0.07 * u, 0.09 * u);
  // hips: 4 legs from heavy side housings, diagonal gait pairs
  let hips: Hip[] | undefined;
  if (stance.legs === 'spider') {
    hips = [];
    for (const [hx0, fx, fz, ph] of [[0.12, 0.78, 1.08, 0], [-0.42, -0.95, 1.02, Math.PI]] as [number, number, number, number][]) for (const s of [-1, 1] as const) {
      const p: V3 = [hx0 * u, by + 0.04 * u, s * 0.36 * u];
      hips.push({ p, side: s, t, foot: [fx * u, 0, s * fz * u], phase: ph + (s > 0 ? Math.PI : 0) });
      block(b, kit.trim, p[0], by - 0.12 * u, s * 0.3 * u, 0.26 * u, 0.2 * u, 0.3 * u, { ch: 0.06 * u });
    }
  } else if (stance.legs === 'biped') {
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.15 * u, stance.hipY, s * 0.3 * u] as V3, side: s, t, foot: [-0.12 * u, 0, s * 0.34 * u] as V3, phase: s > 0 ? Math.PI : 0 }));
  }
  const deck = (x: number, z: number) => (Math.abs(z) < 0.36 * u && x > ax - 0.36 * u && x < ax + 0.3 * u ? deckY : -1);
  return {
    deckAt: deck, top: deckY, hips, custom: true,
    seat: (m) => { collar(b, kit, m.x, deckY + 0.03 * u, m.z, m.r, deckY - 0.02, 14); return { y: deckY + 0.03 * u, socket: true }; },
  };
}

// ---- Needle Frame (mantis) ---------------------------------------------------------------------------------------------
// A lanky fencer droid: slim spindle body, a hammerhead sensor head with a glowing slit, a long needle tail boom for
// balance, and two raised blade arms whose wrists carry the guns with straight lance blades reaching past them.
function needle(c: ChassisCtx): ChassisOut {
  const { b, kit, W, L, stance } = c;
  const k = Math.min(W, L / 2); // authored for the 1 x 2 frame
  const biped = stance.legs === 'biped', spider = stance.legs === 'spider';
  const bp = biped ? stance.hipY : spider ? stance.hipY + 0.08 * k : stance.y0 + 0.12 * k;
  // pelvis drum between the hips + belly keel
  b.cylb(kit.metal, 0.085 * k, 0.26 * k, 0.015 * k, [-0.1 * k, bp, -0.13 * k], 'z', 10);
  // spindle body: dark keel + armoured shell, nose up
  pod(b, kit.trim, [-0.02 * k, bp + 0.12 * k, 0], 0.28 * k, 0.09 * k, 0.11 * k, 8, 5, 2.2);
  pod(b, kit.hull, [0.02 * k, bp + 0.2 * k, 0], 0.32 * k, 0.1 * k, 0.13 * k, 10, 5, 2.4, 0.4);
  b.box(kit.accent, 0.3 * k, 0.012 * k, 0.04 * k, -0.02 * k, bp + 0.3 * k, 0, 0.004);
  // tail needle: tapering boom with vanes and a glowing tip
  b.strut(kit.hull, [-0.2 * k, bp + 0.22 * k, 0], [-0.98 * k, bp + 0.46 * k, 0], 0.055 * k, 0.012 * k, 6);
  b.strut(kit.trim, [-0.2 * k, bp + 0.17 * k, 0], [-0.62 * k, bp + 0.3 * k, 0], 0.04 * k, 0.02 * k, 6);
  both((s) => b.box(kit.panel, 0.16 * k, 0.012 * k, 0.12 * k, -0.6 * k, bp + 0.36 * k, s * 0.07 * k, 0.004, [0, s * 0.35, 0.3]));
  glow(b, kit, -0.98 * k, bp + 0.46 * k, 0, 0.05 * k, 0.03 * k, 0.03 * k);
  // neck + hammerhead: wide flat wedge, glowing slit across the front, swept-back antennae
  beam(b, kit.trim, [0.22 * k, bp + 0.22 * k, 0], [0.44 * k, bp + 0.38 * k, 0], 0.06 * k, 0.06 * k);
  block(b, kit.hull, 0.46 * k, bp + 0.34 * k, 0, 0.24 * k, 0.32 * k, 0.1 * k, { top: [0.55, 0.7], shift: [-0.04 * k, 0], ch: 0.08 * k, bev: 0.02 * k });
  glow(b, kit, 0.575 * k, bp + 0.38 * k, 0, 0.02 * k, 0.025 * k, 0.22 * k);
  both((s) => b.strut(kit.metal, [0.4 * k, bp + 0.42 * k, s * 0.1 * k], [0.16 * k, bp + 0.58 * k, s * 0.17 * k], 0.01 * k, 0.006 * k, 4));
  // blade arms: shoulder drum, upper arm raised, forearm diving to the wrist gun, lance blade past the wrist
  const podTop = new Map<MountSpec, number>();
  both((s) => {
    const m = c.mounts.find((q) => Math.sign(q.z) === s && Math.abs(q.z) > 0.15 * k);
    const mx = m ? m.x : 0.54 * k, mz = m ? m.z : s * 0.3 * k;
    const sh: V3 = [0.14 * k, bp + 0.24 * k, s * 0.14 * k], el: V3 = [0.22 * k, bp + 0.5 * k, s * 0.26 * k];
    const wy = bp + 0.04 * k;
    b.cylb(kit.metal, 0.05 * k, 0.07 * k, 0.01 * k, [sh[0], sh[1], sh[2]], s > 0 ? 'z' : '-z', 8);
    beam(b, kit.hull, sh, el, 0.06 * k, 0.07 * k, [1, 0, 0]);
    b.cylb(kit.metal, 0.04 * k, 0.07 * k, 0.01 * k, [el[0], el[1], el[2] - s * 0.035 * k], s > 0 ? 'z' : '-z', 8);
    beam(b, kit.trim, el, [mx - 0.04 * k, wy + 0.06 * k, mz], 0.05 * k, 0.05 * k);
    beam(b, kit.panel, [el[0] + 0.02 * k, el[1] + 0.03 * k, el[2]], [mx - 0.06 * k, wy + 0.1 * k, mz], 0.07 * k, 0.03 * k);
    // wrist gun cradle
    block(b, kit.hull, mx, wy, mz, 0.24 * k, 0.2 * k, 0.08 * k, { top: [0.8, 0.85], ch: 0.05 * k, bev: 0.015 * k });
    // lance blade: from under the elbow down past the wrist, well ahead of the gun
    const melee = m && (m.mod.category === 'melee' || m.mod.projectile === 'melee');
    const tip: V3 = [mx + (melee ? 0.5 : 0.36) * k, wy - 0.12 * k, mz + s * 0.02 * k];
    beam(b, kit.steel, [el[0] + 0.06 * k, el[1] - 0.06 * k, el[2]], tip, 0.018 * k, 0.07 * k, [0, 0, s]);
    if (m) podTop.set(m, wy + 0.08 * k);
  });
  let hips: Hip[] | undefined;
  if (biped) {
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.1 * k, stance.hipY, s * 0.13 * k] as V3, side: s, t: stance.thick, foot: [-0.08 * k, 0, s * 0.17 * k] as V3, phase: s > 0 ? Math.PI : 0 }));
  } else if (spider) {
    hips = [];
    for (const [hx, fx, fz, ph] of [[0.06, 0.42, 0.55, 0], [-0.24, -0.66, 0.5, Math.PI]] as [number, number, number, number][]) for (const s of [-1, 1] as const) {
      hips.push({ p: [hx * k, stance.hipY, s * 0.1 * k], side: s, t: stance.thick, foot: [fx * k, 0, s * fz * k], phase: ph + (s > 0 ? Math.PI : 0) });
    }
  }
  const top = bp + 0.3 * k;
  return {
    deckAt: (x, z) => (Math.abs(z) < 0.1 * k && Math.abs(x) < 0.25 * k ? top : -1), top: bp + 0.46 * k, hips, custom: true,
    seat: (m) => {
      const pt = podTop.get(m);
      if (pt !== undefined) { collar(b, kit, m.x, pt, m.z, m.r, pt - 0.03 * k, 12); return { y: pt, socket: true }; }
      collar(b, kit, m.x, top, m.z, m.r, top - 0.05 * k, 12);
      return { y: top, socket: true };
    },
  };
}

// ---- Warlord Mech -------------------------------------------------------------------------------------------------------
// A hunched heavy brute: huge rounded pauldrons, a sunken head with two glowing eyes under a heavy brow, the chin gun on
// a jutting jaw ledge, the main cannon on a dorsal hump, long arms ending in massive forearm gauntlets that nearly
// drag (the arm weapons ride on them), and a cross-mounted reactor drum on the back.
function warlord(c: ChassisCtx): ChassisOut {
  const { b, kit, W, L, stance } = c;
  const k = Math.min(W / 4, L / 3);
  const biped = stance.legs === 'biped';
  const t = biped ? stance.thick : 0.24 * k;
  let pelvisY: number;
  if (biped) pelvisY = stance.hipY;
  else {
    pelvisY = stance.legs === 'spider' ? stance.hipY + 0.4 * k : stance.y0 + 0.55 * k;
    // pedestal: armoured drum the torso turns on
    b.cylb(kit.trim, 0.62 * k, pelvisY - stance.y0 + 0.02, 0.06 * k, [-0.1 * k, stance.y0 - 0.02, 0], 'y', 14);
  }
  // pelvis + tassets
  block(b, kit.trim, -0.12 * k, pelvisY - 0.28 * k, 0, 0.7 * k, 0.8 * k, 0.48 * k, { top: [0.86, 1.08], ch: 0.14 * k, bev: 0.03 * k });
  block(b, kit.hull, 0.25 * k, pelvisY - 0.26 * k, 0, 0.2 * k, 0.6 * k, 0.4 * k, { top: [0.55, 0.85], shift: [-0.04 * k, 0], ch: 0.07 * k });
  block(b, kit.metal, -0.15 * k, pelvisY + 0.12 * k, 0, 0.6 * k, 0.7 * k, 0.16 * k, { ch: 0.14 * k });
  const ty0 = pelvisY + 0.22 * k, th = 0.95 * k, ty1 = ty0 + th;
  // barrel chest, hunched forward, mid bulge
  block(b, kit.hull, -0.08 * k, ty0, 0, 1.15 * k, 1.5 * k, th, { top: [0.78, 0.84], shift: [0.12 * k, 0], ch: 0.3 * k, bev: 0.08 * k, bot: 0.06 * k, mid: [[0.42, 1.08, 1.06]] });
  block(b, kit.panel, 0.38 * k, ty0 + 0.1 * k, 0, 0.36 * k, 1.1 * k, th * 0.62, { top: [0.5, 0.8], shift: [0.08 * k, 0], ch: 0.16 * k, bev: 0.04 * k });
  // jaw ledge (chin gun seat)
  const jawY = ty0 + 0.36 * k;
  block(b, kit.hull, 0.52 * k, ty0 + 0.02 * k, 0, 0.42 * k, 0.62 * k, jawY - ty0 - 0.02 * k, { top: [0.9, 0.86], shift: [0.04 * k, 0], ch: 0.12 * k, bev: 0.04 * k, bot: 0.04 * k });
  hazard(b, kit, 0.74 * k, ty0 + 0.12 * k, 0, 0.06 * k, 0.4 * k, 4, Math.PI / 2);
  // dorsal hump (main cannon platform)
  pod(b, kit.hull, [-0.28 * k, ty1 - 0.12 * k, 0], 0.62 * k, 0.4 * k, 0.6 * k, 12, 6, 2.4, 0.4);
  const humpY = ty1 + 0.24 * k;
  // sunken head: heavy brow over two glowing eyes
  const hy = ty1 - 0.36 * k;
  block(b, kit.trim, 0.36 * k, hy, 0, 0.42 * k, 0.48 * k, 0.32 * k, { top: [0.7, 0.8], ch: 0.1 * k, bev: 0.03 * k });
  both((s) => glow(b, kit, 0.57 * k, hy + 0.18 * k, s * 0.1 * k, 0.03 * k, 0.06 * k, 0.09 * k));
  block(b, kit.hull, 0.4 * k, hy + 0.24 * k, 0, 0.44 * k, 0.6 * k, 0.14 * k, { top: [0.7, 0.86], shift: [0.06 * k, 0], ch: 0.1 * k, bev: 0.03 * k });
  // reactor drum across the back + stacks
  b.cylb(kit.trim, 0.3 * k, 1.1 * k, 0.05 * k, [-0.78 * k, ty0 + 0.42 * k, -0.55 * k], 'z', 16);
  both((s) => { b.cyl(kit.glow, 0.2 * k, 0.2 * k, 0.03 * k, [-0.78 * k, ty0 + 0.42 * k, s * 0.56 * k], s > 0 ? 'z' : '-z', 12); exhaust(b, kit, -0.78 * k, ty0 + 0.66 * k, s * 0.3 * k, 0.07 * k, 0.32 * k); });
  // pauldrons + arms with forearm gauntlets carrying the arm weapons
  const armM = c.mounts.filter((m) => Math.abs(m.z) > 0.9 * k);
  const podTop = new Map<MountSpec, number>();
  both((s) => {
    const m = armM.find((q) => Math.sign(q.z) === s);
    const az = m ? m.z : s * 1.34 * k, ax = m ? m.x : 0.11 * k;
    const melee = !!m && (m.mod.category === 'melee' || m.mod.projectile === 'melee');
    const shY = ty1 - 0.24 * k;
    const podL = 1.05 * k, podW = Math.max(0.5 * k, (m?.r ?? 0.39 * k) * 2.0), podH = 0.42 * k;
    const px = melee ? ax - podL * 0.2 : ax + 0.15 * k;
    const top = mechArm(b, kit, s, [-0.12 * k, shY, s * 0.92 * k], [-0.2 * k, ty0 - 0.02 * k, az - s * 0.04 * k], [px, ty0 - 0.62 * k, az], podL, podW, podH, 0.17 * k);
    if (m) podTop.set(m, top);
    // knuckles: three heavy fingers curled under the gauntlet nose (claw spread when the arm carries a melee tool)
    for (const dz of [-0.3, 0, 0.3]) {
      const f0: V3 = [px + podL * 0.42, ty0 - 0.5 * k, az + dz * podW];
      beam(b, kit.metal, f0, [f0[0] + (melee ? 0.34 : 0.12) * k, f0[1] - (melee ? 0.1 : 0.2) * k, f0[2] + dz * (melee ? 0.3 : 0.05) * k], 0.1 * k, 0.12 * k);
    }
    // pauldron: big rounded shell, panel cap, accent stripe
    pod(b, kit.hull, [-0.12 * k, shY + 0.12 * k, s * 1.0 * k], 0.5 * k, 0.32 * k, 0.4 * k, 12, 6, 2.2, 0.5);
    pod(b, kit.panel, [-0.14 * k, shY + 0.32 * k, s * 1.04 * k], 0.36 * k, 0.12 * k, 0.26 * k, 10, 4, 2.2, 0.8);
    b.box(kit.accent, 0.5 * k, 0.03 * k, 0.06 * k, -0.12 * k, shY + 0.3 * k, s * 1.36 * k, 0.01, [s * 0.5, 0, 0]);
  });
  // asymmetric kit: a sensor mast on the left pauldron, hazard band on the right
  b.strut(kit.metal, [-0.3 * k, ty1 + 0.2 * k, -1.02 * k], [-0.45 * k, ty1 + 0.85 * k, -1.08 * k], 0.025 * k, 0.012 * k, 5);
  sensor(b, kit, -0.42 * k, ty1 + 0.72 * k, -1.07 * k, 0.1 * k, kit.lamp);
  hazard(b, kit, -0.12 * k, ty1 + 0.2 * k, 1.0 * k, 0.5 * k, 0.16 * k, 4, 0);
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
    deckAt: deck, top: humpY, hips, custom: true,
    seat: (m) => {
      const pt = podTop.get(m);
      if (pt !== undefined) { collar(b, kit, m.x, pt, m.z, m.r, pt - 0.08 * k, 14); return { y: pt, socket: true }; }
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
