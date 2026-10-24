// Citadel Fortress (size 5, 8 wide x 7 long): a castle that walks. From above it is a waisted, star-like trace, not a
// slab: four tall faceted towers (battered bases, plated shafts, overhanging machicolated crowns) stand out beyond a
// bailey whose curtain walls pinch in between them; the twin titan guns ride faceted ravelin bastions that bulge out
// of the forward walls; a ram prow juts between the front towers. Inside, the deck steps up twice: a raised inner
// terrace, then a three-stage buttressed keep crowned by the giant gun, with a caged reactor in front of it, the
// shield spire behind it and banners on the rear towers (taller than the front pair: the skyline climbs astern).
// Hard-surface pass (hs-kit.ts / hs-kit-titan.ts): steep curtain walls with a chamfered shoulder; every wall carries
// thick appliqué plates on shadow gaps, stacked two deep with ERA bricks on the front arc, recessed louvre grilles
// on the rear arc; crenellated parapet plates and a railed walkway round the rampart; ladders up the waist walls
// and the tower shafts; searchlights on the gate and tower crowns; coolant runs from the reactor to the keep; rams
// on the hip housings. SIGNATURE: the twin titan-gun bastions flanking the gate, under the spire. Asymmetric: an ammo
// hoist crane on the left of the terrace, a radar mast on the right of the keep, exhaust stacks on the right rear.

import type { P2, V3 } from '../geo.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar, glow, hazard } from './shapes.ts';
import { banner, inPoly, reactor } from './giants-kit.ts';
import { armorPlate, crewHatch, fineFor, frame, jointDrum, ladder, piston, recessPanel, rectP, stowBox } from './hs-kit.ts';
import {
  armourWalls, facePlateHS, latticeMast, ngonT, octBarbette, octStack, octTower, parapet, planLoftT, railLoop, searchlight,
} from './hs-kit-titan.ts';
import { inside, faceSlit, mirror, pipeRun, sensorDome, wallFace } from './titan-greebles.ts';

function citadel(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const kx = L / 7, kz = W / 8, k = Math.min(kx, kz);
  const fine = fineFor(c.S);
  const legged = stance.legs !== null;
  const y0 = stance.y0;
  const yt = legged ? y0 + 0.4 * k : Math.max(stance.yt, y0 + 0.4);
  const deckY = yt + 1.2 * k;
  const u = 0.1 * k; // plate unit
  const sc = (pts: P2[]): P2[] => pts.map(([x, z]) => [x * kx, z * kz] as P2);
  const scl = (pts: P2[], s: number): P2[] => pts.map(([x, z]) => [x * s, z * s] as P2);
  const nearMount = (x: number, z: number, pad: number) => c.mounts.some((m) => Math.hypot(m.x - x, m.z - z) < m.r * 1.7 + pad);
  // lower hull between the running gear
  const wi = Math.min(stance.wi, 2.1 * kz);
  planLoftT(b, kit.mech, [[3.1 * kx, -wi * 0.6], [3.1 * kx, wi * 0.6], [2.4 * kx, wi], [-2.4 * kx, wi], [-3.1 * kx, wi * 0.6], [-3.1 * kx, -wi * 0.6], [-2.4 * kx, -wi], [2.4 * kx, -wi]], [[y0, 0.94], [yt + 0.1, 1.0]]);

  // ---- bailey: steep curtain walls with a chamfered shoulder, pinched between the tower pairs
  const B = sc(mirror([[3.35, 0], [3.1, -1.2], [2.2, -2.5], [1.05, -2.5], [0.3, -2.0], [-1.0, -2.0], [-1.75, -2.5], [-2.85, -2.4], [-3.45, -1.3], [-3.45, 0]]));
  const shY = deckY - 0.22 * k;
  planLoftT(b, kit.armor, B, [[yt - 0.05, 0.93], [yt + 0.28 * k, 1.0], [shY, 0.975], [deckY, 0.9]]);
  planLoftT(b, kit.mech, B, [[yt + 0.22 * k, 1.012], [yt + 0.36 * k, 1.01]]);
  const rimP = scl(B, 0.9);
  armourWalls(b, kit, B, [yt + 0.38 * k, 0.996], [shY - 0.04 * k, 0.977], {
    u, pitch: 1.25 * k, fill: 0.7, slits: true, front: 0.75,
    skip: (p) => Math.hypot(p[0] - 2.45 * kx, Math.abs(p[2]) - 2.85 * kz) < 0.9 * k || Math.hypot(p[0] + 2.45 * kx, Math.abs(p[2]) - 2.85 * kz) < 0.9 * k,
  });
  // waist walls: a recessed vent and a ladder from the skirt to the rampart
  for (let i = 0; i < B.length; i++) {
    const f = wallFace(B, i, [yt + 0.3 * k, 1.0], [deckY, 0.9]);
    if (Math.abs(f.n.z) < 0.97 || Math.abs(f.c.x) > 1.0 * kx) continue;
    const a = f.c.clone().addScaledVector(f.u, f.w * 0.42).addScaledVector(f.v, -f.h * 0.5);
    const e = f.c.clone().addScaledVector(f.u, f.w * 0.42).addScaledVector(f.v, f.h * 0.5);
    ladder(b, kit, [a.x, a.y, a.z], [e.x, e.y + 0.1 * k, e.z], 0.3 * k, [f.u.x, f.u.y, f.u.z], [f.n.x, f.n.y, f.n.z], 0.12 * k);
  }
  both((s) => {
    // waist conduits clamped to the wall, hanging skirt plates on shadow gaps between the tower pods
    const zc = s * 2.1 * kz, yc = yt + 0.32 * k;
    pipeRun(b, kit, [[1.3 * kx, yc, zc * 1.1], [0.3 * kx, yc, zc * 1.02], [-1.0 * kx, yc, zc * 1.02], [-1.8 * kx, yc, zc * 1.13]], 0.06 * k, kit.joint);
    for (const x of [-0.75, 0.05]) armorPlate(b, kit, kit.armor2, frame([x * kx, yt + 0.02, s * 2.08 * kz], [0, -0.12, s], [1, 0, 0]), rectP(0.75 * kx, 0.42 * k, 0.05 * k), u * 1.1, { standoff: u * 0.8 });
  });
  // rampart: crenellated parapet plates along the rim (skipping the bastions and towers), a railed walk inside it
  for (let i = 0; i < rimP.length; i++) {
    const [ax, az] = rimP[i], [bx, bz] = rimP[(i + 1) % rimP.length];
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(len / (0.62 * k)));
    const ang = Math.atan2(bz - az, bx - ax);
    let nx = Math.sin(ang), nz = -Math.cos(ang);
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
    for (let j = 0; j < n; j++) {
      const f = (j + 0.5) / n, x = ax + (bx - ax) * f, z = az + (bz - az) * f;
      if (nearMount(x, z, 0.25) || inTower(x, z)) continue;
      parapet(b, kit, x, deckY - 0.02, z, nx, nz, (len / n) * 0.62, 0.3 * k, 0.09 * k, j % 2 ? kit.armor2 : kit.armor);
    }
  }
  function inTower(x: number, z: number) { return Math.hypot(Math.abs(x) - 2.45 * kx, Math.abs(z) - 2.85 * kz) < 1.15 * k; }
  if (fine) railLoop(b, kit, scl(B, 0.78), deckY + 0.3 * k, 0.55 * k, (x, z) => nearMount(x, z, 0.35) || inTower(x, z) || x > 2.3 * kx, 0.02 * k, 0.28 * k);

  // ---- prow: ram glacis between the front pods, gate slits, beak plate, searchlights at the gate
  if (!legged) {
    block(b, kit.joint, 3.2 * kx, 0.15, 0, 0.7 * kx, 2.4 * kz, yt - 0.05, { top: [0.4, 0.95], shift: [0.2 * kx, 0], ch: 0.15 * k, bev: 0.05 });
    hazard(b, kit, 3.5 * kx, yt * 0.55, 0, 2.0 * kz, 0.3 * kx, 7, Math.PI / 2);
  }
  armorPlate(b, kit, kit.shell, frame([2.85 * kx, deckY - 0.02, 0], [0.3, 1, 0], [1, 0, 0]), [[0.9 * kx, 0], [0.2 * kx, 0.85 * kz], [-0.6 * kx, 0.85 * kz], [-0.6 * kx, -0.85 * kz], [0.2 * kx, -0.85 * kz]], u * 1.2, { standoff: u * 0.5 });
  hazard(b, kit, 3.0 * kx, deckY + 0.2 * k, 0, 0.8 * kz, 0.16 * kx, 4, Math.PI / 2);
  both((s) => searchlight(b, kit, 2.55 * kx, deckY + 0.05 * k, s * 1.3 * kz, s * 0.35, 0.2 * k, fine));

  // ---- inner terrace: the deck steps up once before the keep (plated walls)
  const T = scl(B, 0.5).map(([x, z]) => [x - 0.35 * kx, z] as P2);
  const deck2 = deckY + 0.38 * k;
  planLoftT(b, kit.mech, T, [[deckY - 0.02, 1.06], [deckY + 0.08 * k, 1.06]]);
  planLoftT(b, kit.shell, T, [[deckY + 0.06 * k, 1.03], [deck2 - 0.06 * k, 1.0], [deck2, 0.97]]);
  for (let i = 0; i < T.length; i++) {
    const f = wallFace(T, i, [deckY + 0.1 * k, 1.03], [deck2 - 0.06 * k, 1.0]);
    if (f.w < 0.5 * k) continue;
    const n = Math.max(1, Math.round(f.w / (0.8 * k)));
    for (let j = 0; j < n; j++) facePlateHS(b, kit, f, (j + 0.5 - n / 2) * (f.w / n), 0, (f.w / n) * 0.84, f.h * 0.7, u * 0.7, kit.armor2, u * 0.3);
  }

  // ---- corner towers: faceted shafts over the corner pods; rear pair taller; ladders on the inboard faces
  const tR = 0.88 * k;
  const towers: V3[] = [];
  const fTop = deckY + 1.35 * k, rTop = deckY + 1.95 * k;
  for (const sx of [1, -1]) for (const sz of [-1, 1]) {
    const base = legged ? yt : Math.max(yt - 0.1, 1.0), tx = sx * 2.45 * kx, tz = sz * 2.85 * kz, top = sx > 0 ? fTop : rTop;
    octTower(b, kit, tx, base, tz, tR, top, { u: u * 0.8 });
    // crown merlons: upright plates round the crown edge (the turret ring stands inside them)
    const P = ngonT(8, tR * 1.2, tR * 1.2);
    for (let i = 0; i < 8; i += 1) {
      if (i % 2) continue;
      const [ax, az] = P[i], [bx, bz] = P[(i + 1) % 8], mx = (ax + bx) / 2, mz = (az + bz) / 2, l = Math.hypot(mx, mz);
      parapet(b, kit, tx + mx * 0.93, top - 0.02, tz + mz * 0.93, mx / l, mz / l, tR * 0.62, 0.26 * k, 0.08 * k, kit.armor2);
    }
    const ai = Math.atan2(tz, tx) + Math.PI, ca = Math.cos(ai), sa = Math.sin(ai);
    const r0 = tR * 0.98;
    ladder(b, kit, [tx + ca * r0, deckY, tz + sa * r0], [tx + ca * r0, top - (top - base) * 0.2, tz + sa * r0], 0.26 * k, [-sa, 0, ca], [ca, 0, sa], 0.06 * k);
    towers.push([tx, top, tz]);
  }

  // twin titan-gun ravelins: faceted battered bastions bulging out of the forward walls
  const bast = (x: number, z: number, r: number) => {
    const R = Math.max(r * 1.2, 0.8 * k), h = deckY + 0.62 * k - (yt + 0.2 * k);
    const top = octBarbette(b, kit, x, yt + 0.2 * k, z, R, h, { mat: kit.armor, n: 10, slits: true });
    planLoftT(b, kit.mech, ngonT(10, R, R), [[top - 0.02, 0.9], [top + 0.06 * k, 0.9]], [x, z]);
    return top + 0.06 * k;
  };

  // ---- the keep: three faceted stages with corner buttresses, slit bands, giant gun on top
  const kxC = -1.15 * kx;
  const s1 = deck2 + 1.0 * k, s2 = s1 + 0.95 * k;
  const K1 = ngonT(8, 1.55 * kx, 1.6 * kz), K2 = ngonT(8, 1.12 * kx, 1.18 * kz);
  planLoftT(b, kit.armor, K1, [[deck2 - 0.05, 1.04], [deck2 + 0.2 * k, 1.0], [s1 - 0.22 * k, 0.96], [s1, 0.86]], [kxC, 0]);
  armourWalls(b, kit, K1, [deck2 + 0.22 * k, 1.0], [s1 - 0.24 * k, 0.96], { at: [kxC, 0], u: u * 0.9, pitch: 1.4 * k, fill: 0.72, slits: true, front: 0.9, rear: -0.9 });
  planLoftT(b, kit.mech, K2, [[s1 - 0.02, 1.08], [s1 + 0.1 * k, 1.08]], [kxC + 0.05 * kx, 0]);
  planLoftT(b, kit.shell, K2, [[s1 + 0.08 * k, 1.0], [s2 - 0.18 * k, 0.96], [s2, 0.86]], [kxC + 0.05 * kx, 0]);
  for (let i = 0; i < 8; i++) {
    const g = wallFace(K2, i, [s1 + 0.12 * k, 1.0], [s2 - 0.18 * k, 0.96], [kxC + 0.05 * kx, 0]);
    facePlateHS(b, kit, g, 0, -g.h * 0.12, g.w * 0.74, g.h * 0.5, u * 0.7, i % 2 ? kit.armor2 : kit.armor, u * 0.3);
    if (g.n.x > 0.3) faceSlit(b, kit, g, 0, g.h * 0.3, g.w * 0.45, u * 0.38, kit.glass);
  }
  // keep buttresses on the diagonals: thick fin plates from the terrace to the first stage's roof
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a);
    const x = kxC + ca * 1.62 * kx, z = sa * 1.68 * kz;
    if (c.mounts.some((m) => Math.hypot(m.x - x, m.z - z) < m.r * 1.5 + 0.2)) continue;
    beam(b, kit.armor2, [x + ca * 0.25 * k, deck2 + 0.05 * k, z + sa * 0.25 * k], [kxC + ca * 1.2 * kx, s1 - 0.08 * k, sa * 1.25 * kz], 0.24 * k, 0.3 * k, [ca, 0.6, sa]);
  }
  both((s) => { recessPanel(b, kit, frame([kxC - 0.45 * kx, s1, s * 1.0 * kz], [0, 1, 0]), 0.55 * kx, 0.36 * kz, 0.05 * k, { slats: 3 }); glow(b, kit, kxC, s1 - 0.3 * k, s * 1.52 * kz, 1.1 * kx, 0.05, 0.05); });
  // reactor in front of the keep, between the titan guns: the fortress's glowing heart, coolant runs into the keep
  reactor(b, kit, [0.75 * kx, deck2 - 0.02, 0], 0.55 * k, 'y', 4);
  planLoftT(b, kit.mech, ngonT(8, 0.8 * k, 0.8 * k), [[deck2 - 0.04, 1.0], [deck2 + 0.12 * k, 0.95]], [0.75 * kx, 0]);
  both((s) => pipeRun(b, kit, [[0.75 * kx, deck2 + 0.15 * k, s * 0.72 * k], [0.1 * kx, deck2 + 0.15 * k, s * 0.9 * kz], [kxC + 1.3 * kx, deck2 + 0.5 * k, s * 0.95 * kz]], 0.06 * k, kit.joint));
  // shield-generator spire behind the keep: a faceted tapered pylon on four fins, glow halo rings, beacon on top
  const spX = kxC - 1.45 * kx, spH = 4.6 * k;
  planLoftT(b, kit.mech, ngonT(8, 0.45 * k, 0.45 * k), [[deckY - 0.02, 1.0], [deckY + 0.3 * k, 0.86]], [spX, 0]);
  planLoftT(b, kit.armor, ngonT(8, 0.27 * k, 0.27 * k), [[deckY, 1.0], [deckY + spH * 0.45, 0.72], [deckY + spH, 0.36]], [spX, 0]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a);
    beam(b, kit.armor2, [spX + ca * 0.5 * k, deckY, sa * 0.5 * k], [spX + ca * 0.16 * k, deckY + spH * 0.4, sa * 0.16 * k], 0.07 * k, 0.22 * k, [ca, 0.3, sa]);
  }
  for (const [f, r] of [[0.5, 0.62], [0.72, 0.46], [0.88, 0.32]] as [number, number][]) {
    const y = deckY + spH * f;
    planLoftT(b, kit.glow, ngonT(8, r * k, r * k), [[y - 0.03 * k, 1.0], [y + 0.03 * k, 1.0]], [spX, 0]);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; b.box(kit.joint, r * k, 0.05 * k, 0.05 * k, spX + Math.cos(a) * r * k * 0.5, y, Math.sin(a) * r * k * 0.5, 0.01, [0, -a, 0]); }
  }
  b.cyl(kit.lamp, 0.1 * k, 0.1 * k, 0.14 * k, [spX, deckY + spH, 0], 'y', 8);

  // ---- deck furniture: crew hatches, grilles, a radar mast on the keep (right), an ammo hoist crane on the left of
  // the terrace, rear stacks on the right quarter, a glowing engine grille astern
  both((s) => {
    crewHatch(b, kit, frame([2.05 * kx, deckY, s * 0.75 * kz], [0, 1, 0]), 0.2 * k, fine);
    crewHatch(b, kit, frame([-2.85 * kx, deckY, s * 1.2 * kz], [0, 1, 0]), 0.18 * k, fine);
    recessPanel(b, kit, frame([0.15 * kx, deckY, s * 1.72 * kz], [0, 1, 0]), 0.7 * kx, 0.36 * kz, 0.05 * k, { slats: 3 });
  });
  latticeMast(b, kit, kxC - 0.55 * kx, s2 - 0.02, 0.5 * kz, 1.5 * k, 0.16 * k, 0.5);
  sensorDome(b, kit, kxC - 0.85 * kx, s1 + 0.05 * k, -0.95 * kz, 0.28 * k);
  {
    // ammo hoist: slewing post on the terrace, jib reaching out over the left rampart, hook on a cable, ammo crates
    const hx = -0.15 * kx, hz = -1.25 * kz;
    planLoftT(b, kit.mech, ngonT(8, 0.2 * k, 0.2 * k), [[deck2 - 0.02, 1.0], [deck2 + 0.85 * k, 0.8]], [hx, hz]);
    jointDrum(b, kit, [hx, deck2 + 0.9 * k, hz], 0.13 * k, 0.26 * k, 'x');
    const tip: V3 = [hx + 0.25 * kx, deck2 + 1.35 * k, hz - 1.15 * kz];
    beam(b, kit.hazard, [hx, deck2 + 0.9 * k, hz], tip, 0.11 * k, 0.16 * k, [0, 1, 0]);
    piston(b, kit, [hx, deck2 + 0.35 * k, hz - 0.1 * k], [hx + 0.12 * kx, deck2 + 1.1 * k, hz - 0.55 * kz], 0.05 * k, 0.55, fine);
    b.strut(kit.steel, tip, [tip[0], deckY + 0.55 * k, tip[2]], 0.012 * k, 0.012 * k, 4);
    b.box(kit.joint, 0.12 * k, 0.16 * k, 0.12 * k, tip[0], deckY + 0.5 * k, tip[2], 0.02 * k);
    for (const [dx, dz] of [[-0.35, -0.1], [0.05, -0.15]]) stowBox(b, kit, frame([hx + dx * kx, deck2, hz + dz * kz], [0, 1, 0], [1, 0, 0]), 0.32 * k, 0.24 * k, 0.4 * k, kit.armor2);
  }
  for (const [dz, h] of [[0.55, 1.15], [1.05, 0.8]]) octStack(b, kit, -3.0 * kx, deckY - 0.1, dz * kz, 0.18 * k, h * k, [-1, 0, 0]);
  recessPanel(b, kit, frame([-3.0 * kx, deckY, -0.8 * kz], [0, 1, 0]), 0.5 * kx, 0.6 * kz, 0.05 * k, { slats: 4 });
  // banners flying from the rear towers
  both((s) => banner(b, kit, -2.45 * kx - tR * 0.4, rTop, s * 2.85 * kz, 2.4 * k, 0.85 * k, s));
  const isTower = (m: MountSpec) => towers.find(([tx, , tz]) => Math.hypot(m.x - tx, m.z - tz) < tR * 1.1);
  // free tower tops: a sensor dome, a searchlight and a mast
  for (const tw of towers) if (!c.mounts.some((m) => Math.hypot(m.x - tw[0], m.z - tw[2]) < tR * 1.1)) {
    sensorDome(b, kit, tw[0], tw[1], tw[2], 0.42 * k);
    searchlight(b, kit, tw[0] + 0.45 * k, tw[1], tw[2] - Math.sign(tw[2]) * 0.3 * k, 0, 0.18 * k, fine);
    latticeMast(b, kit, tw[0] - 0.35 * k, tw[1], tw[2] + Math.sign(tw[2]) * 0.3 * k, 1.1 * k, 0.1 * k);
  }
  const K2top = ngonT(8, 1.12 * kx * 0.86, 1.18 * kz * 0.86).map(([px, pz]) => [px + kxC + 0.05 * kx, pz] as P2);
  const deck = (x: number, z: number) => {
    for (const [tx, ty, tz] of towers) if (Math.hypot(x - tx, z - tz) < tR) return ty;
    if (inPoly(K2top, x, z)) return s2;
    if (inside(T, x, z)) return deck2;
    return inside(rimP, x, z) ? deckY : -1;
  };
  let hips: Hip[] | undefined;
  if (stance.legs === 'biped') {
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.2 * kx, stance.hipY, s * 1.7 * kz] as V3, side: s, t: stance.thick, foot: [-0.2 * kx, 0, s * 2.0 * kz] as V3, phase: s > 0 ? Math.PI : 0 }));
    both((s) => {
      planLoftT(b, kit.mech, [[0.7 * kx, 0.45 * kz], [-0.7 * kx, 0.45 * kz], [-0.7 * kx, -0.45 * kz], [0.7 * kx, -0.45 * kz]], [[y0 - 0.3 * k, 0.8], [y0 + 0.1 * k, 1.0], [y0 + 0.3 * k, 0.86]], [-0.2 * kx, s * 1.7 * kz]);
      for (const dx of [-0.5, 0.5]) piston(b, kit, [-0.2 * kx + dx * kx, y0 - 0.05 * k, s * 1.7 * kz], [-0.2 * kx + dx * 1.6 * kx, yt - 0.05, s * 1.55 * kz], 0.1 * k, 0.55, fine);
    });
  }
  return {
    deckAt: deck, top: s2, custom: true, hips,
    seat: (m: MountSpec) => {
      const tw = isTower(m);
      if (tw) { collar(b, kit, m.x, tw[1] + 0.04, m.z, m.r, tw[1] - 0.1, 16); return { y: tw[1] + 0.04, socket: true }; }
      if (Math.hypot(m.x - kxC, m.z) < 0.6 * k) { const y = s2 + 0.04; collar(b, kit, m.x, y, m.z, m.r, s2 - 0.2, 20); return { y, socket: true }; }
      if (m.cls === 'XL' || (m.x > 0.8 * kx && Math.abs(m.z) > 1.2 * kz)) { const y = bast(m.x, m.z, m.r); collar(b, kit, m.x, y, m.z, m.r, y - 0.1, 20); return { y, socket: true }; }
      const d = deck(m.x, m.z), base = d > 0 ? d : deckY;
      const y = octBarbette(b, kit, m.x, base - 0.02, m.z, m.r * 1.3, 0.32 * k, { mat: kit.armor, plates: false });
      collar(b, kit, m.x, y, m.z, m.r, y - 0.1 * k, 16);
      return { y, socket: true };
    },
  };
}

registerChassis('citadel', citadel);
