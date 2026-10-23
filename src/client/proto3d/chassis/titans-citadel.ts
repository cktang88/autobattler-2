// Citadel Fortress (size 5, 8 wide x 7 long): a castle that walks. From above it is a waisted, star-like trace, not a
// slab: four tall hourglass towers (flared battered bases, slim shafts, overhanging machicolated crowns) stand out
// beyond a bailey whose curtain walls pinch in between them; the twin titan guns ride round ravelin bastions that
// bulge out of the forward walls; a ram prow juts between the front towers. Inside, the deck steps up twice: a raised
// inner terrace, then a three-stage buttressed keep crowned by the giant gun, with a caged reactor in front of it, a
// shield spire behind it and banners on the rear towers (which stand taller than the front pair, so the skyline
// climbs toward the stern). Walls carry layered riveted plates, slits and conduits; the deck has hatches, vents,
// lamps and antennas.

import type { P2, V3 } from '../geo.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { block, both, collar, exhaust, glow, hazard, sensor, vent } from './shapes.ts';
import { banner, glowGrille, inPoly, mast, ngon, planLoft, reactor, skirt } from './giants-kit.ts';
import {
  armourPlate, inside, boltRing, faceBox, faceLadder, faceRivets, faceSlit, faceVent, hatch, lamp, mirror, pbox, pipeRun,
  sensorDome, wallFace, whip,
} from './titan-greebles.ts';

function citadel(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const kx = L / 7, kz = W / 8, k = Math.min(kx, kz);
  const legged = stance.legs !== null;
  const y0 = stance.y0;
  const yt = legged ? y0 + 0.4 * k : Math.max(stance.yt, y0 + 0.4);
  const deckY = yt + 1.2 * k;
  const u = 0.12 * k;
  const sc = (pts: P2[]): P2[] => pts.map(([x, z]) => [x * kx, z * kz] as P2);
  const scl = (pts: P2[], s: number): P2[] => pts.map(([x, z]) => [x * s, z * s] as P2);
  // lower hull between the running gear
  const wi = Math.min(stance.wi, 2.1 * kz);
  planLoft(b, kit.trim, [[3.1 * kx, -wi * 0.6], [3.1 * kx, wi * 0.6], [2.4 * kx, wi], [-2.4 * kx, wi], [-3.1 * kx, wi * 0.6], [-3.1 * kx, -wi * 0.6], [-2.4 * kx, -wi], [2.4 * kx, -wi]], [[y0, 0.94], [yt + 0.1, 1.0]]);

  // ---- bailey: battered curtain walls, pinched between the tower pairs
  const B = sc(mirror([[3.35, 0], [3.1, -1.2], [2.2, -2.5], [1.05, -2.5], [0.3, -2.0], [-1.0, -2.0], [-1.75, -2.5], [-2.85, -2.4], [-3.45, -1.3], [-3.45, 0]]));
  const LB: [number, number][] = [[yt - 0.05, 0.9], [yt + 0.3 * k, 1.0], [deckY - 0.1 * k, 0.88], [deckY, 0.86]];
  planLoft(b, kit.hull, B, LB);
  planLoft(b, kit.trim, B, [[yt + 0.25 * k, 1.012], [yt + 0.4 * k, 1.008]]);
  const rimP = scl(B, 0.86);
  // wall dressing: layered riveted plates, gun slits, conduits and ladders on the waist walls
  for (let i = 0; i < B.length; i++) {
    const f = wallFace(B, i, [yt + 0.42 * k, 0.985], [deckY - 0.12 * k, 0.885]);
    if (f.w < 0.6 * k) continue;
    const n = Math.max(1, Math.round(f.w / (1.25 * k)));
    for (let j = 0; j < n; j++) {
      const du = (j + 0.5 - n / 2) * (f.w / n);
      armourPlate(b, kit, f, du, -f.h * 0.04, (f.w / n) * 0.8, f.h * 0.58, u * 0.8, j % 2 ? kit.panel : kit.hull);
      faceSlit(b, kit, f, du, f.h * 0.36, (f.w / n) * 0.42, u * 0.38);
    }
    if (Math.abs(f.n.z) > 0.97 && Math.abs(f.c.x) < 1.0 * kx) {
      faceLadder(b, kit, f, f.w * 0.38, -f.h * 0.48, f.h * 0.5, 0.28 * k);
      faceVent(b, kit, f, -f.w * 0.05, -f.h * 0.05, f.w * 0.35, f.h * 0.4, 4);
    } else faceRivets(b, kit.metal, f, -f.w * 0.45, f.w * 0.45, -f.h * 0.46, Math.max(3, Math.round(f.w / (0.32 * k))), u * 0.5);
  }
  both((s) => {
    // waist conduits and hanging skirt plates between the tower pods
    const zc = s * 2.06 * kz, yc = yt + 0.45 * k;
    pipeRun(b, kit, [[1.3 * kx, yc, zc * 1.12], [0.3 * kx, yc, zc * 1.02], [-1.0 * kx, yc, zc * 1.02], [-1.8 * kx, yc, zc * 1.15]], 0.07 * k);
    skirt(b, kit, -0.9 * kx, 0.25 * kx, yt + 0.28 * k, s * 2.06 * kz, 0.5 * k, 0.1 * kz, 2, s);
    glow(b, kit, -0.35 * kx, deckY - 0.3 * k, s * 1.8 * kz, 1.1 * kx, 0.05, 0.05);
  });
  // battlements along the rim (skipping the bastions and towers)
  for (let i = 0; i < rimP.length; i++) {
    const [ax, az] = rimP[i], [bx, bz] = rimP[(i + 1) % rimP.length];
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(len / (0.62 * k)));
    const ang = Math.atan2(bz - az, bx - ax);
    for (let j = 0; j < n; j++) {
      const f = (j + 0.5) / n, x = ax + (bx - ax) * f, z = az + (bz - az) * f;
      if (c.mounts.some((m) => Math.hypot(m.x - x, m.z - z) < m.r * 1.7 + 0.25)) continue;
      pbox(b, j % 2 ? kit.panel : kit.hull, (len / n) * 0.55, 0.3 * k, 0.22 * k, x, deckY + 0.13 * k, z, -ang);
    }
  }

  // ---- prow: ram glacis between the front pods, gate slits, beak plate, headlamps
  if (!legged) {
    block(b, kit.metal, 3.2 * kx, 0.15, 0, 0.7 * kx, 2.4 * kz, yt - 0.05, { top: [0.4, 0.95], shift: [0.2 * kx, 0], ch: 0.15 * k, bev: 0.05 });
    hazard(b, kit, 3.5 * kx, yt * 0.55, 0, 2.0 * kz, 0.3 * kx, 7, Math.PI / 2);
  }
  const pa = Math.atan2(1.3 * kz, 0.9 * kx);
  both((s) => {
    const fx = 3.25 * kx, fz = s * 0.62 * kz;
    for (let i = 0; i < 3; i++) glow(b, kit, fx, yt + (0.5 + i * 0.22) * k, fz, 0.06, 0.08 * k, 1.0 * kz, [0, s * (Math.PI / 2 - pa), 0]);
    lamp(b, kit, fx + 0.1 * kx, yt + 0.2 * k, fz * 0.7, 0.16 * k, -s * 0.3);
  });
  block(b, kit.panel, 2.75 * kx, deckY - 0.02, 0, 1.3 * kx, 1.6 * kz, 0.22 * k, { top: [0.5, 0.5], shift: [0.3 * kx, 0], ch: 0.55 * k, bev: 0.06 });
  hazard(b, kit, 2.95 * kx, deckY + 0.21 * k, 0, 0.8 * kz, 0.2 * kx, 4, Math.PI / 2);

  // ---- inner terrace: the deck steps up once before the keep
  const T = scl(B, 0.5).map(([x, z]) => [x - 0.35 * kx, z] as P2);
  const deck2 = deckY + 0.38 * k;
  planLoft(b, kit.trim, T, [[deckY - 0.02, 1.06], [deckY + 0.08 * k, 1.06]]);
  planLoft(b, kit.panel, T, [[deckY + 0.06 * k, 1.03], [deck2 - 0.06 * k, 1.0], [deck2, 0.97]]);
  for (let i = 0; i < T.length; i++) {
    const f = wallFace(T, i, [deckY + 0.1 * k, 1.03], [deck2 - 0.06 * k, 1.0]);
    if (f.w > 0.5 * k) faceRivets(b, kit.metal, f, -f.w * 0.42, f.w * 0.42, 0, Math.max(2, Math.round(f.w / (0.3 * k))), u * 0.45);
  }

  // ---- corner towers: hourglass shafts over the corner pods; rear pair taller
  const tR = 0.88 * k;
  const towers: V3[] = [];
  const tower = (tx: number, tz: number, base: number, top: number) => {
    const h = top - base, r = tR;
    b.lathe(kit.hull, [[0, 0], [r * 1.34, 0], [r * 1.26, h * 0.2], [r * 0.9, h * 0.48], [r * 0.86, h * 0.76], [r * 1.18, h * 0.84], [r * 1.18, h], [0, h]], [tx, base, tz], 'y', 12);
    b.lathe(kit.trim, [[r * 0.95, 0], [r * 1.0, 0], [r * 0.98, h * 0.05], [r * 0.93, h * 0.05]], [tx, base + h * 0.5, tz], 'y', 12);
    b.lathe(kit.accent, [[r * 1.17, 0], [r * 1.2, 0], [r * 1.2, h * 0.04], [r * 1.17, h * 0.04]], [tx, base + h * 0.9, tz], 'y', 12);
    // machicolation brackets under the crown, merlons on top, slits facing out
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
      pbox(b, kit.trim, r * 0.3, h * 0.08, r * 0.16, tx + Math.cos(a) * r * 1.0, base + h * 0.8, tz + Math.sin(a) * r * 1.0, -a);
      if (i % 2) pbox(b, kit.panel, r * 0.22, r * 0.28, r * 0.36, tx + Math.cos(a) * r * 1.06, top + r * 0.14, tz + Math.sin(a) * r * 1.06, -a);
    }
    const ao = Math.atan2(tz, tx);
    for (const da of [-0.5, 0, 0.5]) {
      const a = ao + da;
      pbox(b, kit.glow, 0.05, 0.3 * k, 0.09 * k, tx + Math.cos(a) * r * 0.9, base + h * 0.64, tz + Math.sin(a) * r * 0.9, -a);
    }
    // ladder up the inboard side of the shaft
    const ai = ao + Math.PI;
    for (let i = 0; i < 6; i++) pbox(b, kit.steel, 0.05 * k, 0.03 * k, 0.32 * k, tx + Math.cos(ai) * r * 0.92, base + h * (0.5 + i * 0.05), tz + Math.sin(ai) * r * 0.92, -ai);
    towers.push([tx, top, tz]);
  };
  const fTop = deckY + 1.35 * k, rTop = deckY + 1.95 * k;
  for (const sx of [1, -1]) for (const sz of [-1, 1]) {
    const base = legged ? yt : Math.max(yt - 0.1, 1.0);
    tower(sx * 2.45 * kx, sz * 2.85 * kz, base, sx > 0 ? fTop : rTop);
  }

  // twin titan-gun ravelins: round battered bastions bulging out of the forward walls
  const bast = (x: number, z: number, r: number) => {
    const R = Math.max(r * 1.25, 0.8 * k), h = 0.62 * k;
    b.lathe(kit.hull, [[0, 0], [R * 1.2, 0], [R * 1.12, h * 0.7], [R * 1.02, h * 0.82], [R, h], [0, h]], [x, yt + 0.2 * k, z], 'y', 18);
    b.lathe(kit.hull, [[0, 0], [R * 1.12, 0], [R * 1.0, deckY + h - yt - 0.2 * k], [0, deckY + h - yt - 0.2 * k]], [x, yt + 0.2 * k, z], 'y', 18);
    b.lathe(kit.trim, [[R * 1.0, 0], [R * 1.06, 0], [R * 1.06, 0.1 * k], [R * 1.0, 0.1 * k]], [x, deckY + h - 0.25 * k, z], 'y', 18);
    boltRing(b, kit.metal, x, deckY + h, z, R * 0.9, 14, u * 0.5);
    return deckY + h;
  };

  // ---- the keep: three battered stages with corner buttresses, slit bands, giant gun on top
  const kxC = -1.15 * kx;
  const s1 = deck2 + 1.0 * k, s2 = s1 + 0.95 * k;
  const K1 = ngon(8, 1.55 * kx, 1.6 * kz), K2 = ngon(8, 1.12 * kx, 1.18 * kz);
  planLoft(b, kit.hull, K1, [[deck2 - 0.05, 1.04], [deck2 + 0.2 * k, 1.0], [s1 - 0.1 * k, 0.88], [s1, 0.84]], [kxC, 0]);
  planLoft(b, kit.trim, K2, [[s1 - 0.02, 1.08], [s1 + 0.1 * k, 1.08]], [kxC + 0.05 * kx, 0]);
  planLoft(b, kit.panel, K2, [[s1 + 0.08 * k, 1.0], [s2 - 0.1 * k, 0.9], [s2, 0.86]], [kxC + 0.05 * kx, 0]);
  for (let i = 0; i < 8; i++) {
    const f = wallFace(K1, i, [deck2 + 0.22 * k, 1.0], [s1 - 0.12 * k, 0.88], [kxC, 0]);
    armourPlate(b, kit, f, 0, -f.h * 0.05, f.w * 0.72, f.h * 0.55, u * 0.75, i % 2 ? kit.panel : kit.hull);
    if (f.n.x > -0.3) faceSlit(b, kit, f, 0, f.h * 0.36, f.w * 0.45, u * 0.38);
    const g = wallFace(K2, i, [s1 + 0.12 * k, 1.0], [s2 - 0.12 * k, 0.9], [kxC + 0.05 * kx, 0]);
    faceBox(b, kit.trim, g, 0, g.h * 0.1, g.w * 0.62, g.h * 0.22, u * 0.4);
    if (g.n.x > 0.3) faceSlit(b, kit, g, 0, g.h * 0.1, g.w * 0.45, u * 0.35, kit.glass);
  }
  // keep buttresses on the diagonals, from the terrace to the first stage's roof
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a);
    const x = kxC + ca * 1.55 * kx, z = sa * 1.6 * kz;
    if (c.mounts.some((m) => Math.hypot(m.x - x, m.z - z) < m.r * 1.5 + 0.2)) continue;
    b.loft(kit.panel, [
      [[x - 0.2 * k, deck2, z], [x + 0.2 * k, deck2, z], [x + 0.2 * k, deck2 + 0.25 * k, z], [x - 0.2 * k, deck2 + 0.25 * k, z]].map(([px, py, pz]) => [kxC + (px - kxC) * 1.12 + ca * 0.1, py, pz * 1.12 + sa * 0.1] as V3),
      [[x - 0.16 * k, deck2, z], [x + 0.16 * k, deck2, z], [x + 0.16 * k, s1 - 0.05, z], [x - 0.16 * k, s1 - 0.05, z]].map(([px, py, pz]) => [kxC + (px - kxC) * 0.86, py, pz * 0.86] as V3),
    ]);
  }
  both((s) => { vent(b, kit, kxC - 0.45 * kx, s1 + 0.01, s * 1.0 * kz, 0.55 * kx, 0.36 * kz, 3, 'x'); glow(b, kit, kxC, s1 - 0.3 * k, s * 1.5 * kz, 1.2 * kx, 0.05, 0.05); });
  // reactor in front of the keep, between the titan guns: the fortress's glowing heart
  reactor(b, kit, [0.75 * kx, deck2 - 0.02, 0], 0.55 * k, 'y', 4);
  // shield-generator spire behind the keep: a tapered pylon ringed by floating glow halos, beacon on top
  const spX = kxC - 1.45 * kx, spH = 4.6 * k;
  b.cylb(kit.trim, 0.42 * k, 0.4 * k, 0.06, [spX, deckY - 0.02, 0], 'y', 12);
  b.cyl(kit.hull, 0.26 * k, 0.1 * k, spH, [spX, deckY, 0], 'y', 10);
  for (const [f, r] of [[0.5, 0.62], [0.72, 0.46], [0.88, 0.32]] as [number, number][]) {
    const y = deckY + spH * f;
    b.lathe(kit.glow, [[r * k, -0.04 * k], [(r + 0.08) * k, -0.04 * k], [(r + 0.08) * k, 0.04 * k], [r * k, 0.04 * k]], [spX, y, 0], 'y', 16);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; b.box(kit.metal, r * k, 0.05 * k, 0.05 * k, spX + Math.cos(a) * r * k * 0.5, y, Math.sin(a) * r * k * 0.5, 0.01, [0, -a, 0]); }
  }
  b.cyl(kit.lamp, 0.1 * k, 0.1 * k, 0.14 * k, [spX, deckY + spH, 0], 'y', 8);

  // ---- deck furniture: hatches, vents, lamps, antennas, a sensor post; rear engine block with stacks
  both((s) => {
    hatch(b, kit, 2.05 * kx, deckY, s * 0.75 * kz, 0.22 * k);
    hatch(b, kit, -2.85 * kx, deckY, s * 1.2 * kz, 0.2 * k);
    vent(b, kit, 0.15 * kx, deckY, s * 1.75 * kz, 0.7 * kx, 0.36 * kz, 3, 'x');
    lamp(b, kit, 2.55 * kx, deckY + 0.08 * k, s * 1.5 * kz, 0.14 * k, s * 0.5);
    whip(b, kit, -0.3 * kx, deck2, s * 1.25 * kz, 1.5 * k);
    exhaust(b, kit, -3.0 * kx, deckY - 0.1, s * 0.75 * kz, 0.22 * k, 1.1 * k);
  });
  glowGrille(b, kit, -3.4 * kx, yt + 0.7 * k, 0, 1.3 * kz, 0.5 * k, 3, -1);
  sensor(b, kit, kxC - 0.95 * kx, s1 + 0.2 * k, -0.6 * kz, 0.3 * k);
  mast(b, kit, kxC - 0.6 * kx, s2 - 0.05, 0.5 * kz, 1.6 * k, 0.05 * k);
  // banners flying from the rear towers
  both((s) => banner(b, kit, -2.45 * kx - tR * 0.4, rTop, s * 2.85 * kz, 2.4 * k, 0.85 * k, s));
  const isTower = (m: MountSpec) => towers.find(([tx, , tz]) => Math.hypot(m.x - tx, m.z - tz) < tR * 1.1);
  // free tower tops get a sensor dome and a mast
  for (const tw of towers) if (!c.mounts.some((m) => Math.hypot(m.x - tw[0], m.z - tw[2]) < tR * 1.1)) {
    sensorDome(b, kit, tw[0], tw[1], tw[2], 0.42 * k);
    whip(b, kit, tw[0] - 0.3 * k, tw[1], tw[2] + 0.3 * k, 1.2 * k);
  }
  const K2top = ngon(8, 1.12 * kx * 0.86, 1.18 * kz * 0.86).map(([px, pz]) => [px + kxC + 0.05 * kx, pz] as P2);
  const deck = (x: number, z: number) => {
    for (const [tx, ty, tz] of towers) if (Math.hypot(x - tx, z - tz) < tR) return ty;
    if (inPoly(K2top, x, z)) return s2;
    if (inside(T, x, z)) return deck2;
    return inside(rimP, x, z) ? deckY : -1;
  };
  let hips: Hip[] | undefined;
  if (stance.legs === 'biped') {
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.2 * kx, stance.hipY, s * 1.7 * kz] as V3, side: s, t: stance.thick, foot: [-0.2 * kx, 0, s * 2.0 * kz] as V3, phase: s > 0 ? Math.PI : 0 }));
    both((s) => block(b, kit.trim, -0.2 * kx, y0 - 0.3 * k, s * 1.7 * kz, 1.4 * kx, 0.9 * kz, 0.6 * k, { top: [0.8, 0.8], ch: 0.2 * k }));
  }
  return {
    deckAt: deck, top: s2, custom: true, hips,
    seat: (m: MountSpec) => {
      const tw = isTower(m);
      if (tw) { collar(b, kit, m.x, tw[1] + 0.04, m.z, m.r, tw[1] - 0.1, 16); return { y: tw[1] + 0.04, socket: true }; }
      if (Math.hypot(m.x - kxC, m.z) < 0.6 * k) { const y = s2 + 0.04; collar(b, kit, m.x, y, m.z, m.r, s2 - 0.2, 22); return { y, socket: true }; }
      if (m.cls === 'XL' || (m.x > 0.8 * kx && Math.abs(m.z) > 1.2 * kz)) { const y = bast(m.x, m.z, m.r); collar(b, kit, m.x, y, m.z, m.r, y - 0.1, 22); return { y, socket: true }; }
      const d = deck(m.x, m.z), base = d > 0 ? d : deckY;
      block(b, kit.hull, m.x, base - 0.02, m.z, m.r * 2.6, m.r * 2.6, 0.3 * k, { top: [0.86, 0.86], ch: m.r * 0.7, bev: 0.04 });
      collar(b, kit, m.x, base + 0.3 * k, m.z, m.r, base + 0.2 * k, 18);
      return { y: base + 0.3 * k, socket: true };
    },
  };
}

registerChassis('citadel', citadel);
