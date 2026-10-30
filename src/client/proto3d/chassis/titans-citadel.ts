// Citadel Fortress (size 5, 10 x 10 footprint, art 10 wide x 9.2 long): a castle that walks, built round its twin
// titan guns. The two XL housings (5.25 cells each, units3d DRAW_D) ARE the front of the fortress: each rides a colossal
// battered twelve-sided BASTION exactly its housing wide, standing on the front track pods and rising above the curtain
// walls (dark plinth, a plated drum with ERA on its front arc and gun slits, a machicolated corbel ring, an overhanging
// crown with a glowing band, a great armoured spur raking forward-out from its foot). The two drums all but touch on
// the centreline: between them, set back, the GATEHOUSE (dark arch, glowing portcullis, the small gun on its roof) over
// a ram glacis. From above the plan is two huge discs leading a waisted bailey: the curtain walls run back from the
// drums, pinch in at the waist and end at two tall rear towers (the medium guns), and in the middle of the bailey the
// KEEP climbs in three faceted stages (buttresses, slit bands, corbelled crown) until its roof - where the giant gun
// stands - is above the titan guns' housings: the giant gun superfires over the bastions. Reactor between the
// bastions' tails feeding them with coolant runs; banners and a radar mast astern.
// Hard-surface pass (hs-kit.ts / hs-kit-titan.ts): steep curtain walls with a chamfered shoulder and appliqué plates,
// crenellated parapets, railed walkway, ladders on the waist walls and the tower shafts. SIGNATURE: the twin titan-gun
// bastions flanking the gate, the keep and its giant gun towering behind them. Distinct from the titan walker
// (humanoid), the lance (one spinal gun) and the arachne (a spider's twisting mantle).

import type { P2, V3 } from '../geo.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar, glow, hazard } from './shapes.ts';
import { banner, inPoly, reactor } from './giants-kit.ts';
import { armorPlate, crewHatch, eraGrid, fineFor, frame, ladder, piston, recessPanel, rectP } from './hs-kit.ts';
import { armourWalls, facePlateHS, latticeMast, ngonT, octBarbette, octTower, parapet, planLoftT, railLoop, searchlight } from './hs-kit-titan.ts';
import { inside, faceSlit, mirror, pipeRun, sensorDome, wallFace } from './titan-greebles.ts';

function citadel(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  // plan unit: cells of the 9.2 x 10 art box (the hardpoint fractions in mountgeo.ts are laid out on it)
  const kx = L / 9.2, kz = W / 10, k = Math.min(kx, kz);
  const fine = fineFor(c.S);
  const legged = stance.legs !== null;
  const y0 = stance.y0;
  const yt = legged ? y0 + 0.5 * k : Math.max(stance.yt, y0 + 0.4);
  const deckY = yt + 1.7 * k;
  const u = 0.12 * k; // plate unit
  const sc = (pts: P2[]): P2[] => pts.map(([x, z]) => [x * kx, z * kz] as P2);
  const scl = (pts: P2[], s: number): P2[] => pts.map(([x, z]) => [x * s, z * s] as P2);
  const nearMount = (x: number, z: number, pad: number) => c.mounts.some((m) => Math.hypot(m.x - x, m.z - z) < m.r * 1.7 + pad);

  // ---- the twin titan-gun bastions: fixed by the XL hardpoints (mountgeo citadel [0.22, +-0.26]); built even when a
  // slot is empty, since they are the fortress's front
  const BX = 0.22 * L, BZ = 0.26 * W, BR = 2.3 * k; // drum radius under the 5.25-wide housing (seat narrower than gun)
  const yB = deckY + 1.6 * k; // gun deck on the bastion crowns
  const bastions: [number, number][] = [[BX, -BZ], [BX, BZ]];
  const inBastion = (x: number, z: number, pad = 0) => bastions.some(([bx, bz]) => Math.hypot(x - bx, z - bz) < BR * 1.12 + pad);
  // rear corner towers (the medium guns)
  const TW: [number, number][] = [[-3.25 * kx, -3.6 * kz], [-3.25 * kx, 3.6 * kz]];
  // keep: centred on the giant-gun hardpoint (mountgeo [-0.27, 0])
  const KX = -0.27 * L;

  // lower hull between the running gear
  const wi = Math.min(stance.wi, 2.6 * kz);
  planLoftT(b, kit.mech, [[4.0 * kx, -wi * 0.6], [4.0 * kx, wi * 0.6], [3.1 * kx, wi], [-3.6 * kx, wi], [-4.3 * kx, wi * 0.6], [-4.3 * kx, -wi * 0.6], [-3.6 * kx, -wi], [3.1 * kx, -wi]], [[y0, 0.94], [yt + 0.1, 1.0]]);

  // ---- bailey: steep curtain walls with a chamfered shoulder, running back from the bastions, pinched at the waist
  const B = sc(mirror([[3.3, 0], [3.05, -0.95], [1.2, -2.95], [-0.55, -2.95], [-0.95, -2.45], [-2.0, -2.45], [-2.35, -3.1], [-3.95, -3.1], [-4.5, -1.9], [-4.5, 0]]));
  const shY = deckY - 0.26 * k;
  planLoftT(b, kit.armor, B, [[yt - 0.05, 0.93], [yt + 0.3 * k, 1.0], [shY, 0.975], [deckY, 0.9]]);
  planLoftT(b, kit.mech, B, [[yt + 0.24 * k, 1.012], [yt + 0.38 * k, 1.01]]);
  const rimP = scl(B, 0.9);
  armourWalls(b, kit, B, [yt + 0.4 * k, 0.996], [shY - 0.04 * k, 0.977], {
    u, pitch: 1.6 * k, fill: 0.7, slits: true, front: 0.75,
    skip: (p) => inBastion(p[0], p[2], 0.1) || TW.some(([tx, tz]) => Math.hypot(p[0] - tx, p[2] - tz) < 1.25 * k),
  });
  // waist walls: a ladder from the skirt to the rampart
  for (let i = 0; i < B.length; i++) {
    const f = wallFace(B, i, [yt + 0.3 * k, 1.0], [deckY, 0.9]);
    if (Math.abs(f.n.z) < 0.97 || f.w < 0.8 * k) continue;
    const a = f.c.clone().addScaledVector(f.u, f.w * 0.36).addScaledVector(f.v, -f.h * 0.5);
    const e = f.c.clone().addScaledVector(f.u, f.w * 0.36).addScaledVector(f.v, f.h * 0.5);
    ladder(b, kit, [a.x, a.y, a.z], [e.x, e.y + 0.1 * k, e.z], 0.34 * k, [f.u.x, f.u.y, f.u.z], [f.n.x, f.n.y, f.n.z], 0.12 * k);
  }
  // rampart: crenellated parapet plates along the rim (skipping the bastions and towers), a railed walk inside it
  function inTower(x: number, z: number) { return TW.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < 1.35 * k); }
  for (let i = 0; i < rimP.length; i++) {
    const [ax, az] = rimP[i], [bx, bz] = rimP[(i + 1) % rimP.length];
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(len / (0.7 * k)));
    const ang = Math.atan2(bz - az, bx - ax);
    let nx = Math.sin(ang), nz = -Math.cos(ang);
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
    for (let j = 0; j < n; j++) {
      const f = (j + 0.5) / n, x = ax + (bx - ax) * f, z = az + (bz - az) * f;
      if (inBastion(x, z, 0.15) || inTower(x, z) || x > 2.6 * kx) continue;
      parapet(b, kit, x, deckY - 0.02, z, nx, nz, (len / n) * 0.62, 0.34 * k, 0.1 * k, j % 2 ? kit.armor2 : kit.armor);
    }
  }
  if (fine) railLoop(b, kit, scl(B, 0.78), deckY + 0.34 * k, 0.6 * k, (x, z) => inBastion(x, z, 0.3) || inTower(x, z) || x > 2.2 * kx || nearMount(x, z, 0.3), 0.022 * k, 0.3 * k);

  // ---- bastions (SIGNATURE): plinth on the track pod, plated drum, corbel ring, overhanging crown with a glow band
  const P12 = ngonT(12, BR, BR);
  const yb0 = legged ? yt - 0.6 * k : yt - 0.08;
  const yBand = yb0 + 0.55 * k, yCor = yB - 0.85 * k, yCr = yB - 0.1 * k;
  for (const [x, z] of bastions) {
    const sz = Math.sign(z) as -1 | 1;
    planLoftT(b, kit.armor2, P12, [[yb0, 1.17], [yBand, 1.1]], [x, z]);
    planLoftT(b, kit.mech, P12, [[yBand - 0.03, 1.075], [yBand + 0.14 * k, 1.075]], [x, z]);
    planLoftT(b, kit.armor, P12, [[yBand + 0.1 * k, 1.065], [yCor, 0.97]], [x, z]);
    // corbel ring stepping out to the crown, brackets under it
    planLoftT(b, kit.mech, P12, [[yCor - 0.02, 0.965], [yCor + 0.2 * k, 1.1]], [x, z]);
    planLoftT(b, kit.armor2, P12, [[yCor + 0.18 * k, 1.11], [yCr, 1.11], [yB, 1.04]], [x, z]);
    planLoftT(b, kit.glow, P12, [[yCor + 0.36 * k, 1.118], [yCor + 0.46 * k, 1.118]], [x, z]);
    planLoftT(b, kit.mech, ngonT(12, BR * 0.96, BR * 0.96), [[yB - 0.06 * k, 1.0], [yB + 0.02, 1.0]], [x, z]);
    for (let i = 0; i < 12; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 6, ca = Math.cos(a), sa = Math.sin(a);
      const ap = BR * 0.97 * Math.cos(Math.PI / 12);
      b.box(kit.mech, 0.3 * k, 0.34 * k, 0.16 * k, x + ca * (ap + 0.08 * k), yCor - 0.12 * k, z + sa * (ap + 0.08 * k), 0.02 * k, [0, -a, 0]);
    }
    // drum faces: stacked plates + ERA on the front arc, plates with gun slits round the rest (the inner faces, where
    // the twin drums meet, are left bare: they read as one gate block)
    armourWalls(b, kit, P12, [yBand + 0.16 * k, 1.06], [yCor - 0.05 * k, 0.972], {
      at: [x, z], u, pitch: 1.3 * k, fill: 0.72, front: 0.55, rear: -2, slits: true,
      skip: (p) => (p[2] - z) * sz < -0.75 * BR,
    });
    // plinth: a glowing seam and heavy feet plates
    for (let i = 0; i < 12; i++) {
      const f = wallFace(P12, i, [yb0 + 0.05 * k, 1.17], [yBand - 0.05 * k, 1.1], [x, z]);
      if (f.n.z * sz < -0.7) continue;
      facePlateHS(b, kit, f, 0, 0, f.w * 0.8, f.h * 0.62, u * 0.9, i % 2 ? kit.armor : kit.armor2, u * 0.4);
    }
    // forward spur: an armoured buttress raking forward-out from the drum's foot, hazard-striped prow
    const a = sz * 0.62, ca = Math.cos(a), sa = Math.sin(a);
    const top: V3 = [x + ca * BR * 0.92, yCor - 0.35 * k, z + sa * BR * 0.92], foot: V3 = [x + ca * (BR + 1.05 * k), yb0 + 0.2 * k, z + sa * (BR + 1.05 * k)];
    beam(b, kit.armor, top, foot, 0.9 * k, 0.55 * k, [ca, 1.2, sa]);
    beam(b, kit.armor2, [top[0] + ca * 0.12 * k, top[1] - 0.25 * k, top[2] + sa * 0.12 * k], [foot[0] + ca * 0.06 * k, foot[1] - 0.06 * k, foot[2] + sa * 0.06 * k], 1.05 * k, 0.32 * k, [ca, 1.2, sa]);
    hazard(b, kit, foot[0] - ca * 0.35 * k, foot[1] + 0.32 * k, foot[2] - sa * 0.35 * k, 0.75 * k, 0.14 * k, 3, -a + Math.PI / 2);
    // aft flank: a sloped armour buttress tying the drum into the curtain wall
    const ab = sz * 1.95, cb = Math.cos(ab), sb = Math.sin(ab);
    beam(b, kit.armor, [x + cb * BR * 0.9, yCor - 0.25 * k, z + sb * BR * 0.9], [x + cb * (BR + 0.55 * k), yb0 + 0.3 * k, z + sb * (BR + 0.55 * k)], 0.75 * k, 0.5 * k, [cb, 1.2, sb]);
    // no titan gun on this bastion (a utility or nothing): a crenellated crown, the module stands inside it
    const gun = c.mounts.find((m) => Math.hypot(m.x - x, m.z - z) < 0.8 * k);
    if (!gun || gun.mod.kind !== 'weapon') {
      const Pm = ngonT(12, BR * 1.06, BR * 1.06);
      for (let i = 0; i < 12; i += 1) {
        if (i % 2) continue;
        const [ax, az] = Pm[i], [bx2, bz2] = Pm[(i + 1) % 12], mx = (ax + bx2) / 2, mz = (az + bz2) / 2, l = Math.hypot(mx, mz);
        parapet(b, kit, x + mx, yB - 0.02, z + mz, mx / l, mz / l, BR * 0.4, 0.5 * k, 0.14 * k, kit.armor);
      }
    }
    // searchlight + lamp on the spur
    searchlight(b, kit, top[0] + ca * 0.1 * k, top[1] + 0.2 * k, top[2] + sa * 0.1 * k, a, 0.24 * k, fine);
  }
  // coolant runs from the reactor into each bastion's inner face
  const RX = 0.2 * kx, deck2 = deckY + 0.42 * k;
  if (fine) both((s) => pipeRun(b, kit, [[RX + 0.3 * k, deck2 + 0.12 * k, s * 0.42 * k], [RX + 0.75 * k, deck2 + 0.25 * k, s * 0.75 * k], [BX - BR * 0.62, yBand + 0.9 * k, s * (BZ - BR * 0.8)]], 0.07 * k, kit.joint));

  // ---- gatehouse between the bastions: a squat armoured block set back between the drums, dark arch and glowing
  // portcullis, the small gun on its roof; ram glacis under it
  const GX = 0.45 * L - 0.3 * k, gTop = deckY + 0.55 * k;
  block(b, kit.armor2, GX, yt - 0.1, 0, 1.55 * k, 1.35 * k, gTop - yt + 0.1, { top: [0.9, 0.82], shift: [-0.08 * k, 0], ch: 0.18 * k, bev: 0.05 * k });
  block(b, kit.armor, GX - 0.05 * k, gTop - 0.32 * k, 0, 1.6 * k, 1.42 * k, 0.32 * k, { top: [0.95, 0.92], ch: 0.16 * k, bev: 0.04 * k });
  {
    const fx = GX + 0.74 * k, ay = (yt + gTop) / 2 - 0.15 * k;
    recessPanel(b, kit, frame([fx, ay, 0], [1, 0, 0], [0, 0, 1]), 0.85 * k, gTop - yt - 0.35 * k, 0.16 * k, { slats: 0 });
    for (const dz of [-0.26, 0, 0.26]) glow(b, kit, fx - 0.06 * k, ay, dz * k, 0.06 * k, (gTop - yt) * 0.55, 0.07 * k);
    for (const dy of [-0.2, 0.25]) glow(b, kit, fx - 0.06 * k, ay + dy * k, 0, 0.06 * k, 0.07 * k, 0.7 * k);
    hazard(b, kit, fx - 0.1 * k, gTop - 0.16 * k, 0, 1.1 * k, 0.14 * k, 4, Math.PI / 2);
  }
  if (!legged) {
    block(b, kit.joint, 4.1 * kx, 0.15, 0, 0.75 * kx, 2.2 * kz, yt - 0.05, { top: [0.4, 0.95], shift: [0.2 * kx, 0], ch: 0.15 * k, bev: 0.05 });
    hazard(b, kit, 4.4 * kx, yt * 0.55, 0, 1.8 * kz, 0.3 * kx, 7, Math.PI / 2);
  }

  // ---- inner terrace: the deck steps up once round the keep (plated walls)
  const T: P2[] = sc(mirror([[0.95, 0], [0.75, -1.25], [-0.6, -1.95], [-4.0, -1.95], [-4.2, 0]]));
  planLoftT(b, kit.mech, T, [[deckY - 0.02, 1.05], [deckY + 0.08 * k, 1.05]]);
  planLoftT(b, kit.shell, T, [[deckY + 0.06 * k, 1.03], [deck2 - 0.06 * k, 1.0], [deck2, 0.97]]);
  for (let i = 0; i < T.length; i++) {
    const f = wallFace(T, i, [deckY + 0.1 * k, 1.03], [deck2 - 0.06 * k, 1.0]);
    if (f.w < 0.5 * k) continue;
    const n = Math.max(1, Math.round(f.w / (1.6 * k)));
    for (let j = 0; j < n; j++) facePlateHS(b, kit, f, (j + 0.5 - n / 2) * (f.w / n), 0, (f.w / n) * 0.84, f.h * 0.7, u * 0.7, kit.armor2, u * 0.3);
  }

  // ---- rear towers: faceted shafts over the rear pods, crowned above the bastions; ladders on the inboard faces
  const tR = 1.1 * k;
  const towers: V3[] = [];
  const rTop = deckY + 3.0 * k;
  for (const [tx, tz] of TW) {
    const base = legged ? yt : Math.max(yt - 0.1, 1.0);
    octTower(b, kit, tx, base, tz, tR, rTop, { u: u * 0.8, brackets: true });
    const P = ngonT(8, tR * 1.2, tR * 1.2);
    for (let i = 0; i < 8; i += 2) {
      const [ax, az] = P[i], [bx, bz] = P[(i + 1) % 8], mx = (ax + bx) / 2, mz = (az + bz) / 2, l = Math.hypot(mx, mz);
      parapet(b, kit, tx + mx * 0.93, rTop - 0.02, tz + mz * 0.93, mx / l, mz / l, tR * 0.62, 0.26 * k, 0.08 * k, kit.armor2);
    }
    const ai = Math.atan2(tz, tx) + Math.PI, ca = Math.cos(ai), sa = Math.sin(ai);
    const r0 = tR * 0.98;
    ladder(b, kit, [tx + ca * r0, deckY, tz + sa * r0], [tx + ca * r0, rTop - (rTop - base) * 0.2, tz + sa * r0], 0.28 * k, [-sa, 0, ca], [ca, 0, sa], 0.06 * k);
    towers.push([tx, rTop, tz]);
  }

  // ---- the keep: three faceted stages climbing above the bastions' guns (the giant gun superfires over them)
  const s1 = deck2 + 1.8 * k, s2 = s1 + 1.55 * k, s3 = s2 + 0.38 * k;
  const K1 = ngonT(8, 1.45 * kx, 1.75 * kz), K2 = ngonT(8, 1.12 * kx, 1.3 * kz);
  planLoftT(b, kit.armor, K1, [[deck2 - 0.05, 1.04], [deck2 + 0.22 * k, 1.0], [s1 - 0.24 * k, 0.96], [s1, 0.86]], [KX, 0]);
  armourWalls(b, kit, K1, [deck2 + 0.24 * k, 1.0], [s1 - 0.26 * k, 0.96], { at: [KX, 0], u: u * 0.9, pitch: 1.7 * k, fill: 0.72, slits: true, front: 0.9, rear: -0.9 });
  planLoftT(b, kit.mech, K2, [[s1 - 0.02, 1.08], [s1 + 0.12 * k, 1.08]], [KX + 0.05 * kx, 0]);
  planLoftT(b, kit.shell, K2, [[s1 + 0.1 * k, 1.0], [s2 - 0.2 * k, 0.97], [s2, 0.93]], [KX + 0.05 * kx, 0]);
  for (let i = 0; i < 8; i++) {
    const g = wallFace(K2, i, [s1 + 0.14 * k, 1.0], [s2 - 0.2 * k, 0.97], [KX + 0.05 * kx, 0]);
    if (g.n.x > 0.3) faceSlit(b, kit, g, 0, g.h * 0.25, g.w * 0.45, u * 0.4, kit.glass);
    else facePlateHS(b, kit, g, 0, -g.h * 0.08, g.w * 0.72, g.h * 0.6, u * 0.8, i % 2 ? kit.armor2 : kit.armor, u * 0.35);
  }
  // corbelled crown the giant gun stands on: dark corbel, overhanging armour ring, glow band
  planLoftT(b, kit.mech, K2, [[s2 - 0.02, 0.93], [s2 + 0.14 * k, 1.04]], [KX + 0.05 * kx, 0]);
  planLoftT(b, kit.armor2, K2, [[s2 + 0.12 * k, 1.06], [s3 - 0.06 * k, 1.06], [s3, 1.0]], [KX + 0.05 * kx, 0]);
  planLoftT(b, kit.glow, K2, [[s2 + 0.2 * k, 1.068], [s2 + 0.26 * k, 1.068]], [KX + 0.05 * kx, 0]);
  // keep buttresses on the diagonals: thick fin plates from the terrace to the first stage's roof
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a);
    const x = KX + ca * 1.55 * kx, z = sa * 1.85 * kz;
    beam(b, kit.armor2, [x + ca * 0.25 * k, deck2 + 0.05 * k, z + sa * 0.25 * k], [KX + ca * 1.1 * kx, s1 - 0.08 * k, sa * 1.35 * kz], 0.26 * k, 0.34 * k, [ca, 0.6, sa]);
  }
  both((s) => glow(b, kit, KX, s1 - 0.36 * k, s * 1.58 * kz, 1.2 * kx, 0.06, 0.06));
  // stage-1 roof: radar mast (right), sensor dome (left), grilles
  latticeMast(b, kit, KX - 0.85 * kx, s1 - 0.02, 0.95 * kz, 1.9 * k, 0.18 * k, 0.5);
  sensorDome(b, kit, KX - 0.85 * kx, s1 + 0.02 * k, -0.95 * kz, 0.32 * k);
  both((s) => recessPanel(b, kit, frame([KX + 0.95 * kx, s1, s * 0.75 * kz], [0, 1, 0]), 0.45 * kx, 0.5 * kz, 0.05 * k, { slats: 3 }));
  // reactor between the bastions' tails, in front of the keep: the fortress's glowing heart
  reactor(b, kit, [RX, deck2 - 0.02, 0], 0.48 * k, 'y', 4);
  planLoftT(b, kit.mech, ngonT(8, 0.68 * k, 0.68 * k), [[deck2 - 0.04, 1.0], [deck2 + 0.12 * k, 0.95]], [RX, 0]);

  // ---- deck furniture: hatches on the side decks, banners on the rear towers, stacks astern
  both((s) => {
    crewHatch(b, kit, frame([KX + 0.2 * kx, deckY, s * 2.25 * kz], [0, 1, 0]), 0.2 * k, fine);
    armorPlate(b, kit, kit.shell, frame([-4.0 * kx, deckY - 0.01, s * 1.05 * kz], [0, 1, 0], [1, 0, 0]), rectP(0.5 * kx, 0.7 * kz, 0.06 * k), u, { standoff: u * 0.4 });
    banner(b, kit, TW[0][0] - tR * 0.4, rTop, s * 3.6 * kz, 2.6 * k, 0.9 * k, s);
    // titan-gun ammo feeds: armoured trunking from the keep's flanks to each bastion's tail
    beam(b, kit.armor2, [KX + 1.0 * kx, deck2 + 0.35 * k, s * 1.55 * kz], [BX - BR * 0.95, yBand + 0.55 * k, s * (BZ + 0.3 * k)], 0.42 * k, 0.4 * k);
    glow(b, kit, (KX + 1.0 * kx + BX - BR * 0.95) / 2, (deck2 + yBand) / 2 + 0.72 * k, s * (1.55 * kz + BZ + 0.3 * k) / 2, 0.06 * k, 0.06 * k, 0.06 * k);
  });
  eraGrid(b, kit, frame([-4.3 * kx, deckY - 0.3 * k, 0], [-1, 0, 0], [0, 0, 1]), 1, 3, 0.55 * k, 0.4 * k, u * 0.6);

  const isTower = (m: MountSpec) => towers.find(([tx, , tz]) => Math.hypot(m.x - tx, m.z - tz) < tR * 1.2);
  // free tower tops: a sensor dome, a searchlight and a mast
  for (const tw of towers) if (!c.mounts.some((m) => Math.hypot(m.x - tw[0], m.z - tw[2]) < tR * 1.2)) {
    sensorDome(b, kit, tw[0], tw[1], tw[2], 0.42 * k);
    searchlight(b, kit, tw[0] + 0.45 * k, tw[1], tw[2] - Math.sign(tw[2]) * 0.3 * k, 0, 0.18 * k, fine);
    latticeMast(b, kit, tw[0] - 0.35 * k, tw[1], tw[2] + Math.sign(tw[2]) * 0.3 * k, 1.1 * k, 0.1 * k);
  }
  const K2top = ngonT(8, 1.12 * kx, 1.3 * kz).map(([px, pz]) => [px + KX + 0.05 * kx, pz] as P2);
  const K1top = ngonT(8, 1.45 * kx * 0.86, 1.75 * kz * 0.86).map(([px, pz]) => [px + KX, pz] as P2);
  const deck = (x: number, z: number) => {
    for (const [tx, ty, tz] of towers) if (Math.hypot(x - tx, z - tz) < tR) return ty;
    for (const [bx, bz] of bastions) if (Math.hypot(x - bx, z - bz) < BR) return yB;
    if (inPoly(K2top, x, z)) return s3;
    if (inPoly(K1top, x, z)) return s1;
    if (inside(T, x, z)) return deck2;
    return inside(rimP, x, z) ? deckY : -1;
  };
  let hips: Hip[] | undefined;
  if (stance.legs === 'biped') {
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.6 * kx, stance.hipY, s * 2.1 * kz] as V3, side: s, t: stance.thick, foot: [-0.6 * kx, 0, s * 2.5 * kz] as V3, phase: s > 0 ? Math.PI : 0 }));
    both((s) => {
      planLoftT(b, kit.mech, [[0.9 * kx, 0.55 * kz], [-0.9 * kx, 0.55 * kz], [-0.9 * kx, -0.55 * kz], [0.9 * kx, -0.55 * kz]], [[y0 - 0.3 * k, 0.8], [y0 + 0.1 * k, 1.0], [y0 + 0.3 * k, 0.86]], [-0.6 * kx, s * 2.1 * kz]);
      for (const dx of [-0.6, 0.6]) piston(b, kit, [-0.6 * kx + dx * kx, y0 - 0.05 * k, s * 2.1 * kz], [-0.6 * kx + dx * 1.6 * kx, yt - 0.05, s * 1.95 * kz], 0.12 * k, 0.55, fine);
    });
  }
  return {
    deckAt: deck, top: s3, custom: true, hips,
    seat: (m: MountSpec) => {
      const tw = isTower(m);
      if (tw) { collar(b, kit, m.x, tw[1] + 0.04, m.z, m.r, tw[1] - 0.1, 16); return { y: tw[1] + 0.04, socket: true }; }
      if (bastions.some(([bx, bz]) => Math.hypot(m.x - bx, m.z - bz) < 0.8 * k)) { collar(b, kit, m.x, yB, m.z, Math.min(m.r, BR), yB - 0.12, 24); return { y: yB, socket: true }; }
      if (Math.hypot(m.x - KX, m.z) < 0.8 * k) { const y = s3 + 0.02; collar(b, kit, m.x, y, m.z, m.r, s3 - 0.2, 20); return { y, socket: true }; }
      if (m.x > GX - 0.6 * k && Math.abs(m.z) < 0.6 * k) {
        // the small gun on the gatehouse roof
        collar(b, kit, m.x, gTop, m.z, m.r, gTop - 0.1 * k, 16);
        return { y: gTop, socket: true };
      }
      const d = deck(m.x, m.z), base = d > 0 ? d : deckY;
      const y = octBarbette(b, kit, m.x, base - 0.02, m.z, m.r * 1.3, 0.32 * k, { mat: kit.armor, plates: false });
      collar(b, kit, m.x, y, m.z, m.r, y - 0.1 * k, 16);
      return { y, socket: true };
    },
  };
}

registerChassis('citadel', citadel);
