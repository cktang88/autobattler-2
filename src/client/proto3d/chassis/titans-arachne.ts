// Weaver Titan / arachne (size 5, 10 x 10 footprint, body art ~7): a colossal spider-tank - alien in silhouette,
// machine in construction. A ten-faceted carapace of overlapping armour scales (thick plates on shadow gaps, a skirt
// ring under them, radial fin ribs with glow seams between) carries the titan gun on a faceted turret tower crowned by
// swept fin plates. SIGNATURE: the head - a heavy armoured prow with a huge glowing cyclops lens in an octagonal
// armoured socket, ringed by smaller eyes and sensor whiskers, with hydraulic chelicerae (twin-strut arms, rams,
// claw blades) under it, flanked by two plated pedipalp weapon housings for the giant guns (ERA on their front
// faces). Behind it a segmented faceted abdomen (each segment an 8-sided armour ring with a dorsal plate, dark
// articulation bands and cable bundles between) ends in a faceted spinneret reactor with coolant runs forward. Hip
// housings on exposed rams round the rim; eight hard-surface legs (mobility/titanlegs.ts) whose knees tower over the
// body. Asymmetric: lattice mast left, team banner right, a sensor pod on the left palp.

import type { P2, V3 } from '../geo.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, both, collar, glow, hazard } from './shapes.ts';
import { banner, inPoly, reactor } from './giants-kit.ts';
import { armorPlate, cableBundle, eraGrid, fineFor, frame, frameLimb, jointDrum, piston, plateStack, recessPanel, rectP, trapP } from './hs-kit.ts';
import { facePlateHS, latticeMast, ngonT, octBarbette, planLoftT, xPrism } from './hs-kit-titan.ts';
import { pipeRun, sensorDome, wallFace, whip } from './titan-greebles.ts';

function arachne(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const u = Math.min(L, W) / 10;
  const fine = fineFor(c.S);
  const pu = 0.08 * u;
  const spider = stance.legs === 'spider';
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
  // ---- turret tower for the titan gun: faceted, plated faces, glow band, crown of swept fin plates
  const tY = cTop + 1.35 * u;
  const TP = ngonT(8, 1.15 * u, 1.15 * u);
  planLoftT(b, kit.armor, TP, [[cTop - 0.3 * u, 1.0], [cTop + 0.5 * u, 0.86], [tY - 0.12 * u, 0.82], [tY, 0.76]], [cx, 0]);
  for (let i = 0; i < 8; i++) {
    const f = wallFace(TP, i, [cTop + 0.55 * u, 0.86], [tY - 0.14 * u, 0.82], [cx, 0]);
    facePlateHS(b, kit, f, 0, -f.h * 0.08, f.w * 0.74, f.h * 0.62, pu, i % 2 ? kit.armor2 : kit.shell, pu * 0.4);
  }
  planLoftT(b, kit.glow, TP, [[cTop + 0.5 * u, 0.875], [cTop + 0.58 * u, 0.87]], [cx, 0]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6, rx = Math.cos(a), rz = Math.sin(a);
    const base: V3 = [cx + rx * 1.05 * u, cTop + 0.15 * u, rz * 1.05 * u];
    armorPlate(b, kit, i % 2 ? kit.armor2 : kit.accent, frame([cx + rx * 1.28 * u, cTop + 0.75 * u, rz * 1.28 * u], [-rz, 0, rx], [rx * 0.35, 1, rz * 0.35]),
      [[-0.65 * u, -0.1 * u], [0.75 * u, 0.2 * u], [0.6 * u, 0.42 * u], [-0.65 * u, 0.12 * u]], 0.07 * u, { back: null, standoff: 0 });
    if (fine && i % 2) piston(b, kit, base, [cx + rx * 1.3 * u, cTop + 0.95 * u, rz * 1.3 * u], 0.05 * u, 0.55, fine);
  }
  both((s) => hazard(b, kit, cx + 0.75 * u, tY - 0.2 * u, s * 0.45 * u, 0.5 * u, 0.16 * u, 3, 0.5 * s));

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
    if (!(m.x > 0.9 * u && Math.abs(m.z) > 0.6 * u)) continue;
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
  return {
    deckAt: deck, top: tY, custom: true, hips,
    seat: (m: MountSpec) => {
      const pt = palp.get(m);
      if (pt !== undefined) { collar(b, kit, m.x, pt, m.z, m.r, pt - 0.1 * u, 16); return { y: pt, socket: true }; }
      if (Math.hypot(m.x - cx, m.z) < 0.9 * u) { collar(b, kit, m.x, tY, m.z, m.r, tY - 0.15 * u, 20); return { y: tY, socket: true }; }
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
  };
}

registerChassis('arachne', arachne);
