// Weaver Titan / arachne (size 5, 10 x 10 footprint, body art ~7): a colossal spider-tank - alien in silhouette,
// machine in construction. A ten-faceted carapace of overlapping armour scales (thick plates on shadow gaps, a skirt
// ring under them, radial fin ribs with glow seams between) carries a weapon MANTLE on a plated waist drum: the whole
// battery twists as one (torso mode, buildMantle below) - the titan gun laid in a deep keel between two shoulder masses
// that each carry a giant gun abreast of it (its trunnion bearings on their inner walls, swept pauldrons astern), a
// command spine lifting the medium gun over the titan gun's breech. The palp housings below are only built for
// utilities in the giant slots (weapons ride the mantle). SIGNATURE: the head - a heavy armoured prow with a huge glowing cyclops lens in an octagonal
// armoured socket, ringed by smaller eyes and sensor whiskers, with hydraulic chelicerae (twin-strut arms, rams,
// claw blades) under it, flanked by two plated pedipalp weapon housings for the giant guns (ERA on their front
// faces). Behind it a segmented faceted abdomen (each segment an 8-sided armour ring with a dorsal plate, dark
// articulation bands and cable bundles between) ends in a faceted spinneret reactor with coolant runs forward. Hip
// housings on exposed rams round the rim; eight hard-surface legs (mobility/titanlegs.ts) whose knees tower over the
// body. Asymmetric: lattice mast left, team banner right, a sensor pod on the left palp.

import type { Bld, P2, V3 } from '../geo.ts';
import { registerChassis, registerTorso, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar, glow, hazard } from './shapes.ts';
import { banner, inPoly, reactor } from './giants-kit.ts';
import { armorPlate, cableBundle, eraGrid, fineFor, frame, frameLimb, jointDrum, piston, plateStack, recessPanel, rectP, trapP } from './hs-kit.ts';
import { armourWalls, facePlateHS, latticeMast, ngonT, octBarbette, planLoftT, xPrism } from './hs-kit-titan.ts';
import { mirror, pipeRun, sensorDome, wallFace, whip } from './titan-greebles.ts';
import { torsoHP, torsoSlots, type TorsoSlots } from './torso-kit.ts';

function arachne(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const u = Math.min(L, W) / 10;
  const fine = fineFor(c.S);
  const pu = 0.08 * u;
  const spider = stance.legs === 'spider';
  const ts = torsoSlots(c);
  const by = spider ? stance.hipY * 1.75 : stance.legs === 'biped' ? stance.hipY + 0.2 * u : Math.max(stance.yt, 0.6) + 1.0 * u;
  if (!spider && stance.legs !== 'biped') planLoftT(b, kit.mech, ngonT(10, 2.4 * u, 2.4 * u), [[0, 1.1], [by - 0.4 * u, 1.0], [by, 0.85]], [-0.4 * u, 0]);
  // ---- carapace: ten-faceted shell over a dark belly; scale plates on every upper facet, a skirt ring below
  const cx = -0.4 * u, cp = ngonT(10, 2.65 * u, 2.85 * u, 0);
  const cTop = by + 1.6 * u;
  const yR = by + 0.45 * u, yS = by + 1.12 * u;
  planLoftT(b, kit.mech, cp, [[by - 0.75 * u, 0.62], [by - 0.2 * u, 0.94], [by + 0.1 * u, 1.0]], [cx, 0]);
  planLoftT(b, kit.armor2, cp, [[by + 0.05 * u, 1.04], [yR, 1.05], [yS, 0.84], [cTop, 0.48]], [cx, 0]);
  const head = (a: number) => Math.cos(a) > 0.8;
  for (let i = 0; i < 10; i++) {
    const am = (i + 0.5) / 10 * Math.PI * 2;
    if (head(am)) continue;
    // upper scale: a thick plate, then a second shorter plate stepped up the slope (overlapping scales)
    const f = wallFace(cp, i, [yR + 0.04 * u, 1.05], [yS - 0.02 * u, 0.84], [cx, 0]);
    facePlateHS(b, kit, f, 0, -f.h * 0.05, f.w * 0.8, f.h * 0.8, pu * 1.4, i % 2 ? kit.armor : kit.shell, pu * 0.6);
    const g = wallFace(cp, i, [yS + 0.02 * u, 0.84], [cTop - 0.08 * u, 0.52], [cx, 0]);
    facePlateHS(b, kit, g, 0, -g.h * 0.1, g.w * 0.72, g.h * 0.62, pu * 1.1, kit.armor, pu * 0.5);
    // skirt ring under the scales
    const s = wallFace(cp, i, [by + 0.08 * u, 1.04], [yR - 0.02 * u, 1.05], [cx, 0]);
    facePlateHS(b, kit, s, 0, 0, s.w * 0.84, s.h * 0.62, pu, kit.armor2, pu * 0.5);
  }
  // radial fin ribs on the facet edges, glow seams in the skirt between them
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    if (head(a) || head(a + 0.3) || head(a - 0.3)) continue;
    const rx = Math.cos(a), rz = Math.sin(a);
    beam(b, kit.armor, [cx + rx * 1.35 * u, cTop - 0.1 * u, rz * 1.45 * u], [cx + rx * 2.78 * u, yR + 0.08 * u, rz * 2.98 * u], 0.16 * u, 0.3 * u, [rx, 2.2, rz]);
    const a2 = a + Math.PI / 10;
    if (!head(a2)) glow(b, kit, cx + Math.cos(a2) * 2.78 * u, by + 0.28 * u, Math.sin(a2) * 2.96 * u, 0.42 * u, 0.05 * u, 0.05 * u, [0, -a2 + Math.PI / 2, 0]);
  }
  // ---- waist: the swivel the weapon mantle turns on (a battered faceted drum on the carapace crown, plated faces, glow
  // band, bearing ring). The mantle above it carries the titan gun and every other weapon (torso, below).
  const WP = ngonT(10, 1.0, 1.0);
  const yW = cTop + 0.42 * u;
  planLoftT(b, kit.armor, WP, [[yS - 0.06 * u, 2.25 * u], [cTop - 0.1 * u, 2.0 * u], [cTop + 0.2 * u, 1.86 * u], [yW - 0.08 * u, 1.8 * u]], [cx, 0]);
  for (let i = 0; i < 10; i++) {
    const f = wallFace(WP, i, [cTop - 0.08 * u, 1.99 * u], [cTop + 0.18 * u, 1.87 * u], [cx, 0]);
    facePlateHS(b, kit, f, 0, 0, f.w * 0.76, f.h * 0.8, pu * 0.9, i % 2 ? kit.armor2 : kit.shell, pu * 0.4);
  }
  planLoftT(b, kit.glow, WP, [[cTop + 0.22 * u, 1.87 * u], [cTop + 0.3 * u, 1.85 * u]], [cx, 0]);
  b.cylb(kit.joint, 1.7 * u, 0.12 * u, 0.02 * u, [cx, yW - 0.06 * u, 0], 'y', 20);

  // ---- head (SIGNATURE): armoured prow, cyclops lens in an octagonal socket, eye ring, whiskers, chelicerae
  const hx = 2.3 * u, hy = by + 0.15 * u;
  const HP: P2[] = [[1.25 * u, 0], [0.7 * u, 0.95 * u], [-0.6 * u, 1.05 * u], [-0.8 * u, 0], [-0.6 * u, -1.05 * u], [0.7 * u, -0.95 * u]];
  planLoftT(b, kit.armor, HP, [[hy - 0.6 * u, 0.7], [hy - 0.25 * u, 1.0], [hy + 0.45 * u, 0.97], [hy + 0.75 * u, 0.72]], [hx, 0]);
  for (let i = 0; i < HP.length; i++) {
    const f = wallFace(HP, i, [hy - 0.2 * u, 1.0], [hy + 0.42 * u, 0.97], [hx, 0]);
    if (f.n.x > 0.5 || f.w < 0.5 * u) continue; // the lens face stays clear
    plateStack(b, kit, kit.armor2, frame([f.c.x, f.c.y, f.c.z], [f.n.x, f.n.y, f.n.z], [f.u.x, f.u.y, f.u.z]), rectP(f.w * 0.8, f.h * 0.78, pu), [
      { inset: 0, thick: pu * 1.3, standoff: pu * 0.5 }, { inset: pu * 1.4, thick: pu, mat: kit.shell },
    ], { gap: pu * 1.1 });
  }
  reactor(b, kit, [hx + 0.95 * u, hy + 0.12 * u, 0], 0.42 * u, 'x', 2);
  {
    // octagonal armoured socket round the lens
    const P = ngonT(8, 0.6 * u, 0.6 * u);
    for (let i = 0; i < 8; i++) {
      const [ay, az] = P[i], [by2, bz] = P[(i + 1) % 8];
      b.strut(kit.mech, [hx + 1.12 * u, hy + 0.12 * u + ay, az], [hx + 1.12 * u, hy + 0.12 * u + by2, bz], 0.09 * u, 0.09 * u, 4);
    }
  }
  const eyes: [number, number, number][] = [[0.75, 0.62, 0.48], [0.75, 0.62, -0.48], [0.95, -0.3, 0.62], [0.95, -0.3, -0.62], [0.55, 0.78, 0.18], [0.55, 0.78, -0.18]];
  for (const [ex, ey, ez] of eyes) {
    b.cyl(kit.mech, 0.15 * u, 0.15 * u, 0.08 * u, [hx + ex * u, hy + ey * u, ez * u], 'x', 6);
    b.cyl(kit.glow, 0.1 * u, 0.08 * u, 0.14 * u, [hx + ex * u + 0.04 * u, hy + ey * u, ez * u], 'x', 6);
  }
  // brow: stepped plates over the eyes, sensor whiskers swept back
  plateStack(b, kit, kit.armor, frame([hx + 0.1 * u, hy + 0.72 * u, 0], [0.2, 1, 0], [1, 0, 0]), trapP(1.1 * u, 0.8 * u, 1.4 * u, 0.15 * u), [
    { inset: 0, thick: pu * 1.4, standoff: pu * 0.5 }, { inset: pu * 2, thick: pu, mat: kit.armor2, shift: [-0.12 * u, 0] },
  ]);
  both((s) => {
    for (const [dz, l] of [[0.32, 1.4], [0.5, 1.0]]) b.strut(kit.steel, [hx + 0.5 * u, hy + 0.85 * u, s * dz * u], [hx - 0.6 * u, hy + 0.85 * u + l * 0.6 * u, s * (dz + 0.35) * u], 0.025 * u, 0.012 * u, 4);
    // chelicerae: twin-strut arm on a joint drum, a ram, a claw blade
    const j: V3 = [hx + 0.75 * u, hy - 0.4 * u, s * 0.38 * u], e: V3 = [hx + 1.45 * u, hy - 0.95 * u, s * 0.46 * u];
    jointDrum(b, kit, j, 0.16 * u, 0.26 * u, 'z');
    frameLimb(b, kit, j, e, 0.06 * u, [0, 0, 0.08 * u]);
    jointDrum(b, kit, e, 0.12 * u, 0.24 * u, 'z');
    piston(b, kit, [hx + 0.55 * u, hy - 0.05 * u, s * 0.46 * u], [hx + 1.2 * u, hy - 0.75 * u, s * 0.5 * u], 0.05 * u, 0.55, fine);
    beam(b, kit.joint, e, [hx + 1.6 * u, hy - 1.55 * u, s * 0.28 * u], 0.16 * u, 0.2 * u);
    armorPlate(b, kit, kit.armor2, frame([hx + 1.3 * u, hy - 0.68 * u, s * 0.42 * u], [0.6, 0.8, 0], [1, -0.8, 0]), trapP(0.75 * u, 0.2 * u, 0.32 * u, 0.04 * u), 0.05 * u, { standoff: 0.02 * u });
  });

  // ---- abdomen: segmented faceted armour rings tapering back, articulation bands and cables, spinneret reactor
  const ax0 = -2.7 * u;
  xPrism(b, kit.mech, 8, [[ax0 + 0.15 * u, 0.6 * u, 0.6 * u], [ax0 - 0.3 * u, 0.55 * u, 0.55 * u]], [by + 0.3 * u, 0]);
  const segs: { x: number; y: number; ry: number; rz: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const x = ax0 - 0.55 * u - i * 0.75 * u, f = 1 - i * 0.16, y = by + 0.65 * u - i * 0.14 * u;
    const ry = 0.5 * u * 1.6 * f, rz = 1.3 * u * f;
    segs.push({ x, y, ry, rz });
    // armour ring: front lip, full section, trailing taper; a dark band where it overlaps the next segment
    xPrism(b, i % 2 ? kit.armor : kit.armor2, 8, [[x + 0.42 * u, ry * 0.78, rz * 0.8], [x + 0.3 * u, ry, rz], [x - 0.2 * u, ry * 0.96, rz * 0.96], [x - 0.42 * u, ry * 0.76, rz * 0.78]], [y, 0]);
    xPrism(b, kit.mech, 8, [[x - 0.4 * u, ry * 0.8, rz * 0.82], [x - 0.5 * u, ry * 0.74, rz * 0.76]], [y, 0]);
    armorPlate(b, kit, i % 2 ? kit.shell : kit.armor, frame([x, y + ry * 0.94, 0], [0, 1, 0], [1, 0, 0]), rectP(0.62 * u, rz * 0.9, 0.08 * u), pu * 1.2, { standoff: pu * 0.6 });
    if (i < 2) both((s) => glow(b, kit, x - 0.44 * u, y, s * rz * 0.8, 0.05 * u, ry * 0.5, 0.05 * u));
  }
  if (fine) both((s) => cableBundle(b, kit, [ax0 + 0.4 * u, by + 0.75 * u, s * 0.9 * u], [ax0 - 1.6 * u, by + 0.75 * u, s * 0.95 * u], 0.04 * u, [0, 1, 0], 2, 0.06));
  const spx = ax0 - 2.75 * u, spy = by + 0.35 * u;
  xPrism(b, kit.mech, 8, [[spx + 0.55 * u, 0.48 * u, 0.48 * u], [spx + 0.2 * u, 0.52 * u, 0.52 * u], [spx - 0.05 * u, 0.36 * u, 0.36 * u]], [spy, 0]);
  for (const x of [0.38, 0.12]) xPrism(b, kit.joint, 8, [[spx + x * u, 0.56 * u, 0.56 * u], [spx + x * u - 0.06 * u, 0.56 * u, 0.56 * u]], [spy, 0]);
  b.cyl(kit.hot, 0.3 * u, 0.2 * u, 0.1 * u, [spx - 0.04 * u, spy, 0], '-x', 8);
  if (fine) both((s) => pipeRun(b, kit, [[spx + 0.4 * u, spy + 0.45 * u, s * 0.35 * u], [segs[1].x, segs[1].y + segs[1].ry * 0.7, s * 0.55 * u], [ax0, by + 0.95 * u, s * 0.6 * u]], 0.045 * u, kit.joint));
  // masts and banner on the rear of the carapace (asymmetric), grilles either side of the tower
  latticeMast(b, kit, cx - 1.45 * u, by + 0.75 * u, -1.15 * u, 2.4 * u, 0.15 * u, 0.4);
  whip(b, kit, cx - 1.75 * u, by + 0.6 * u, -0.6 * u, 1.6 * u);
  banner(b, kit, cx - 1.1 * u, by + 0.75 * u, 1.55 * u, 2.4 * u, 0.8 * u, 1);
  both((s) => recessPanel(b, kit, frame([cx - 0.9 * u, by + 1.05 * u, s * 0.95 * u], [-0.5, 1, s * 0.35], [1, 0, 0]), 0.6 * u, 0.42 * u, 0.06 * u, { slats: 3 }));

  // ---- pedipalp weapon housings at the giant-gun mounts (front flanks of the head)
  const palp = new Map<MountSpec, number>();
  for (const m of c.mounts) {
    if (m.i === ts.hero || !(m.x > 0.9 * u && Math.abs(m.z) > 0.6 * u)) continue;
    const s = Math.sign(m.z) as -1 | 1, top = by + 1.3 * u;
    const pl = 2.2 * u, pw = m.r * 2.5, px = m.x + 0.45 * u;
    // arm from the head root to the housing: twin struts + a joint drum
    jointDrum(b, kit, [hx - 0.5 * u, by - 0.2 * u, s * 0.85 * u], 0.24 * u, 0.36 * u, 'z');
    frameLimb(b, kit, [hx - 0.5 * u, by - 0.2 * u, s * 0.85 * u], [m.x, by - 0.1 * u, m.z], 0.09 * u, [0, 0.14 * u, 0]);
    b.box(kit.mech, 1.5 * u, 0.42 * u, 0.9 * u, m.x, by - 0.04 * u, m.z, 0.06 * u);
    // housing: dark core, thick top plate (the gun deck), stacked outboard cheek with ERA, front port
    b.box(kit.mech, pl * 0.9, top - by - 0.15 * u, pw * 0.8, px, (top + by + 0.05 * u) / 2 - 0.05 * u, m.z, 0.06 * u);
    const tt = 0.12 * u, so = 0.04 * u;
    armorPlate(b, kit, kit.armor, frame([px, top - tt - so, m.z], [0, 1, 0], [1, 0, 0]), trapP(pl, pw * 0.86, pw, pw * 0.12), tt, { standoff: so });
    const ch = plateStack(b, kit, kit.armor2, frame([px, by + 0.65 * u, m.z + s * pw * 0.4], [0, 0, s], [1, 0, 0]), rectP(pl * 0.86, (top - by) * 0.6, 0.08 * u), [
      { inset: 0, thick: pu * 1.2, standoff: pu * 0.5 }, { inset: pu * 1.6, thick: pu, mat: kit.armor },
    ]);
    eraGrid(b, kit, frame([px + pl * 0.2, by + 0.65 * u, m.z + s * (pw * 0.4 + ch)], [0, 0, s], [1, 0, 0]), 2, 3, pl * 0.12, (top - by) * 0.2, pu * 0.6);
    recessPanel(b, kit, frame([px + pl * 0.46, by + 0.7 * u, m.z], [1, 0, 0], [0, 0, 1]), pw * 0.6, (top - by) * 0.45, 0.06 * u, { slats: 2 });
    glow(b, kit, px - pl * 0.1, by + 0.25 * u, m.z + s * pw * 0.42, pl * 0.45, 0.05 * u, 0.04 * u);
    if (s < 0) sensorDome(b, kit, px - pl * 0.35, top, m.z - s * pw * 0.32, 0.2 * u);
    palp.set(m, top);
  }
  // ---- hips: eight legs round the carapace rim (alternating tetrapod gait); hip housings hung on exposed rams
  let hips: Hip[] | undefined;
  if (spider) {
    hips = [];
    const rows: [number, number, number, number][] = [[1.2, 2.2, 4.1, 3.7], [0.25, 2.7, 1.5, 4.8], [-1.05, 2.7, -1.5, 4.8], [-2.05, 2.1, -4.0, 3.8]];
    rows.forEach(([hxr, hz, fx, fz], i) => {
      for (const s of [-1, 1] as const) {
        const p: V3 = [cx + hxr * u, by, s * hz * u];
        hips!.push({ p, side: s, t: stance.thick * 1.15, foot: [fx * u, 0, s * fz * u], phase: ((i % 2) ^ (s > 0 ? 1 : 0)) ? Math.PI : 0 });
        planLoftT(b, kit.mech, ngonT(6, 0.4 * u, 0.36 * u), [[by - 0.85 * u, 0.8], [by - 0.5 * u, 1.0], [by + 0.25 * u, 0.9]], [p[0], s * (hz - 0.2) * u]);
        piston(b, kit, [p[0] + 0.15 * u, by - 0.55 * u, s * (hz - 0.45) * u], [p[0] + 0.15 * u, by + 0.35 * u, s * (hz - 1.05) * u], 0.07 * u, 0.55, fine);
      }
    });
  } else if (stance.legs === 'biped') {
    hips = ([-1, 1] as const).map((s) => ({ p: [cx, stance.hipY, s * 1.6 * u] as V3, side: s, t: stance.thick, foot: [cx, 0, s * 1.9 * u] as V3, phase: s > 0 ? Math.PI : 0 }));
  }
  const deck = (x: number, z: number) => (inPoly(cp.map(([px, pz]) => [px * 0.5 + cx, pz * 0.5] as P2), x, z) ? cTop : -1);
  const heroSeat = ts.hero >= 0 ? c.mounts.find((m) => m.i === ts.hero) : undefined;
  return {
    deckAt: deck, top: yW + 2.4, custom: true, hips,
    seat: (m: MountSpec) => {
      // the hero's yaw is the mantle's swivel (torso: at = the waist top)
      if (m === heroSeat) return { y: yW, socket: true };
      const pt = palp.get(m);
      if (pt !== undefined) { collar(b, kit, m.x, pt, m.z, m.r, pt - 0.1 * u, 16); return { y: pt, socket: true }; }
      if (Math.hypot(m.x - cx, m.z) < 0.9 * u) { collar(b, kit, m.x, yW, m.z, m.r, yW - 0.15 * u, 20); return { y: yW, socket: true }; }
      if (m.x < ax0 + 0.3 * u) {
        // tail gun on a faceted plinth over the abdomen
        const sg = segs.reduce((a, q) => (Math.abs(q.x - m.x) < Math.abs(a.x - m.x) ? q : a), segs[0]);
        const yb = sg.y + sg.ry * 0.7, y = by + 1.55 * u;
        octBarbette(b, kit, m.x, yb, m.z, m.r * 1.25, y - yb, { mat: kit.armor, plates: false });
        collar(b, kit, m.x, y, m.z, m.r, y - 0.12 * u, 16);
        return { y, socket: true };
      }
      const d = deck(m.x, m.z), y = (d > 0 ? d : by + 0.9 * u) + 0.1 * u;
      collar(b, kit, m.x, y, m.z, m.r, y - 0.4 * u, 16);
      return { y, socket: true };
    },
    torso: heroSeat ? (t, { heroR }) => { buildMantle(t, c, ts, fine, heroR); return { hp: torsoHP(ts, slotBase, heroR), at: [cx, yW, 0] }; } : undefined,
  };
}

// ---- weapon mantle (torso): the whole battery twists on the waist as one weapon system ----------------------------
// Yaw frame (origin = waist top, +x forward), world cells. Weapons have a fixed size per class (units3d DRAW_D: XL
// 5.25, L 3.0, M 1.5; the titan gun's own body is ~4 wide in torso mode), so the mantle is laid out round them: the
// titan gun is the SPINE of the mantle, laid in a deep channel down the middle between two massive shoulder blocks
// whose inner walls are its cradle (trunnion bearing posts on them, the axle into the gun); each shoulder carries a
// giant gun abreast of the titan gun, a swept pauldron behind it; a command spine astern lifts the medium gun over the
// titan gun's breech. Only armed slots get their shoulder / spine.
const P_XL: V3 = [0.1, 0.55, 0];
/** half width of the channel the titan gun lies in (its body is <= ~2 half-wide) */
const CH = 2.08;
const P_L = (s: number): V3 => [0.3, 1.2, s * 3.3];
const P_M: V3 = [-3.75, 2.45, 0];
const slotBase = (i: number): V3 => (i === 0 ? P_XL : i === 1 ? P_L(-1) : i === 2 ? P_L(1) : i === 3 ? P_M : [-1.2, 1.4, 0]);

function buildMantle(t: Bld, c: ChassisCtx, ts: TorsoSlots, fine: boolean, heroR: number): void {
  const { kit } = c;
  const pu = 0.06;
  // swivel: dark bearing drum and a bright race
  t.cyl(kit.mech, 1.45, 1.6, 0.24, [0, 0.12, 0], 'y', 18);
  t.cylb(kit.joint, 1.65, 0.06, 0.01, [0, 0.22, 0], 'y', 18);
  // keel: the long faceted gun bed the titan gun is laid in (nose glacis forward, tail aft), plated walls, ERA forward
  const KP = mirror([[2.45, 0], [1.95, -1.45], [0.9, -CH], [-2.3, -CH], [-3.3, -1.4], [-3.7, 0]]);
  planLoftT(t, kit.armor2, KP, [[0.1, 0.8], [0.3, 1.0], [0.6, 0.98], [0.72, 0.92]]);
  armourWalls(t, kit, KP, [0.3, 1.0], [0.6, 0.98], { u: pu, pitch: 1.0, fill: 0.72, front: 0.75, rear: -0.9 });
  // the bed under the gun: a dark trough with a glowing feed core showing between the gun and the keel
  planLoftT(t, kit.mech, ngonT(8, 1.95, 1.05), [[0.68, 1.0], [0.77, 0.96]], [-0.4, 0]);
  glow(t, kit, -0.4, 0.79, 0, 2.7, 0.05, 0.55, undefined, kit.plasma);
  both((s) => glow(t, kit, -2.6, 0.67, s * 1.25, 1.0, 0.06, 0.07, [0, s * 0.5, 0], kit.plasma));
  // trunnion: where the titan gun's pitch axle meets its cradle
  const bx = P_XL[0] + 0.19 * heroR, byy = P_XL[1] + 0.46 * heroR;
  both((s) => {
    const slot = s < 0 ? 1 : 2;
    const [lx, ly, lz0] = P_L(s);
    const lz = Math.abs(lz0);
    if (ts.armed(slot)) {
      // shoulder: a deep armoured block from the channel wall out, its sloped glacis forward, its deck the giant gun's
      // seat; the inner wall is the titan gun's cradle
      const zc = (CH + lz + 1.2) / 2, w = lz + 1.2 - CH;
      block(t, kit.armor, -0.15, 0.12, s * zc, 3.6, w, ly - 0.12, { top: [0.8, 0.94], shift: [-0.3, s * 0.03], ch: 0.32, bev: 0.06, bot: 0.06 });
      block(t, kit.mech, -1.75, 0.2, s * zc, 0.9, w * 0.8, ly - 0.3, { ch: 0.2, bev: 0.03 });
      // deck well round the giant gun's seat: the pod ring sinks into it
      planLoftT(t, kit.mech, ngonT(10, 0.95, 0.95), [[ly - 0.16, 1.0], [ly + 0.02, 1.0]], [lx, s * lz]);
      // outer cheek: stepped dark plates with a glow seam under them
      plateStack(t, kit, kit.armor2, frame([-0.1, ly * 0.5, s * (lz + 1.22)], [0, 0, s], [1, 0, 0]), rectP(3.0, ly * 0.66, 0.1), [
        { inset: 0, thick: pu * 1.4, standoff: pu * 0.5 }, { inset: pu * 2.2, thick: pu, mat: kit.armor, shift: [-0.25, 0] },
      ], { gap: pu * 1.1 });
      glow(t, kit, -0.15, 0.22, s * (lz + 1.21), 2.7, 0.09, 0.07);
      // glacis: ERA bricks on the sloped front face
      eraGrid(t, kit, frame([1.6, ly * 0.5, s * zc], [0.75, 0.66, 0], [0, 0, 1]), 2, 4, 0.5, 0.3, pu * 0.7, kit.armor2);
      // pauldron: a big swept armour mass rising behind the giant gun's breech, raking out and back, a bone cap and a fin
      const px = -2.45, pz = s * (lz + 0.2);
      block(t, kit.armor, px, ly - 0.15, pz, 1.4, 1.45, 1.25, { top: [0.4, 0.55], shift: [-0.55, s * 0.25], ch: 0.22, bev: 0.04, mid: [[0.5, 0.82, 0.92]] });
      block(t, kit.shell, px - 0.4, ly + 1.08, pz + s * 0.25, 0.6, 0.66, 0.06, { top: [0.6, 0.7], shift: [-0.12, s * 0.04], ch: 0.1, bev: 0.015 });
      block(t, kit.armor2, px - 0.35, ly + 0.3, pz + s * 0.72, 1.2, 0.12, 0.95, { top: [0.2, 0.6], shift: [-0.6, s * 0.1], ch: 0.04, bev: 0.015 });
      glow(t, kit, px + 0.05, ly + 0.42, pz + s * 0.72, 0.7, 0.06, 0.05, [0, 0, 0.5]);
      if (fine) piston(t, kit, [-1.2, 0.3, s * (lz + 1.1)], [px + 0.2, ly + 0.25, s * (lz + 0.9)], 0.07, 0.55, fine);
    } else {
      // unarmed side: a low armour skirt so the keel still reads as a mantle (and the titan gun keeps its cradle)
      block(t, kit.armor, -0.2, 0.12, s * (CH + 0.5), 2.8, 1.0, 0.75, { top: [0.9, 0.7], ch: 0.2, bev: 0.04 });
    }
    if (ts.armed(0)) {
      // titan gun trunnion bearing: an upright armoured post on the channel wall, the axle into the gun
      block(t, kit.armor2, bx, 0.6, s * (CH + 0.12), 1.0, 0.36, byy + 0.32 - 0.6, { top: [0.7, 0.85], ch: 0.1, bev: 0.03 });
      t.cyl(kit.joint, 0.28, 0.28, 0.42, [bx, byy, s * (CH - 0.12)], 'z', 14);
      t.cyl(kit.plasma, 0.15, 0.15, 0.06, [bx, byy, s * (CH + 0.32)], 'z', 10);
      hazard(t, kit, bx, byy + 0.2, s * (CH + 0.31), 0.7, 0.1, 3);
    }
  });
  if (ts.armed(3)) {
    // command spine astern: a stepped armoured hump rising from the keel's tail behind the titan gun's breech up to the
    // medium gun's seat (the skyline climbs aft), a bone glacis plate on its slope, fins and glowing slots on its flanks
    const [mx, my] = P_M;
    block(t, kit.armor, mx - 0.05, 0.55, 0, 1.5, 1.6, my - 0.55, { top: [0.66, 0.72], shift: [-0.1, 0], ch: 0.3, bev: 0.05, mid: [[0.45, 0.9, 0.95]] });
    armorPlate(t, kit, kit.shell, frame([mx + 0.55, 1.55, 0], [0.95, 0.3, 0], [0, 0, 1]), rectP(1.05, 1.0, 0.12), pu * 1.3, { standoff: pu * 0.6 });
    both((s) => {
      plateStack(t, kit, kit.armor2, frame([mx - 0.1, (my + 0.55) / 2 - 0.1, s * 0.75], [0, 0, s], [1, 0, 0]), rectP(1.05, (my - 0.55) * 0.6, 0.08), [
        { inset: 0, thick: pu * 1.2, standoff: pu * 0.4 }, { inset: pu * 1.6, thick: pu, mat: kit.armor },
      ], { gap: pu });
      glow(t, kit, mx + 0.25, my - 0.55, s * 0.62, 0.06, 0.55, 0.05, undefined, kit.plasma);
      // radiator fins down the back
      for (let k = 0; k < 3; k++) t.box(kit.mech, 0.06, 0.8, 0.4, mx - 0.72, 0.95 + k * 0.4, s * 0.34, 0.01, [0, 0, 0.45]);
    });
    hazard(t, kit, mx + 0.58, my - 0.18, 0, 0.6, 0.12, 3, Math.PI / 2);
  }
}

registerChassis('arachne', arachne);
registerTorso('arachne');
