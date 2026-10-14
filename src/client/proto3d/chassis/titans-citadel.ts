// Citadel Fortress (size 5, 8 wide x 7 long): a castle that walks. Four round bastion towers stand on the four
// corner track pods (each tower rides its own pod); an octagonal battlemented bailey between them carries the twin
// titan guns on round bastions behind a glowing gate and a ram glacis; a stepped central keep is crowned by the giant
// gun, with a caged reactor in front of it, a command spire behind it and team banners flying from the rear towers.

import type { P2, V3 } from '../geo.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { block, both, collar, exhaust, glow, hazard, sensor, vent } from './shapes.ts';
import { banner, glowGrille, inPoly, mast, ngon, planLoft, reactor, skirt, tower } from './giants-kit.ts';

function citadel(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const kx = L / 7, kz = W / 8, k = Math.min(kx, kz);
  const legged = stance.legs !== null;
  const y0 = stance.y0;
  const yt = legged ? y0 + 0.5 * k : Math.max(stance.yt, y0 + 0.4);
  const deckY = yt + 1.15 * k;
  // lower hull between the running gear
  const wi = Math.min(stance.wi, 2.2 * kz);
  planLoft(b, kit.trim, [[3.1 * kx, -wi * 0.6], [3.1 * kx, wi * 0.6], [2.4 * kx, wi], [-2.4 * kx, wi], [-3.1 * kx, wi * 0.6], [-3.1 * kx, -wi * 0.6], [-2.4 * kx, -wi], [2.4 * kx, -wi]], [[y0, 0.94], [yt + 0.1, 1.0]]);
  // bailey: octagonal battered wall block, corner cuts where the towers stand
  const oct: P2[] = [[3.8 * kx, 0], [3.05 * kx, 1.85 * kz], [1.7 * kx, 3.3 * kz], [-1.7 * kx, 3.3 * kz], [-3.35 * kx, 1.7 * kz], [-3.35 * kx, -1.7 * kz], [-1.7 * kx, -3.3 * kz], [1.7 * kx, -3.3 * kz], [3.05 * kx, -1.85 * kz]];
  planLoft(b, kit.hull, oct, [[yt - 0.05, 0.9], [yt + 0.35 * k, 1.0], [deckY - 0.12 * k, 0.97], [deckY, 0.94]]);
  // a dark plinth band and a glow line ring the bailey walls
  planLoft(b, kit.trim, oct, [[yt + 0.3 * k, 1.005], [yt + 0.42 * k, 1.005]]);
  both((s) => {
    glow(b, kit, 0, deckY - 0.35 * k, s * 3.22 * kz, 2.8 * kx, 0.06, 0.06);
    skirt(b, kit, -1.5 * kx, 1.5 * kx, yt + 0.25 * k, s * 3.3 * kz, 0.5 * k, 0.1 * kz, 4, s);
  });
  // battlements: merlons along the bailey rim (skipping the gun bastions)
  const rim = oct.map(([x, z]) => [x * 0.94, z * 0.94] as P2);
  for (let i = 0; i < rim.length; i++) {
    const [ax, az] = rim[i], [bx, bz] = rim[(i + 1) % rim.length];
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(len / (0.75 * k)));
    const ang = Math.atan2(bz - az, bx - ax);
    for (let j = 0; j < n; j++) {
      const f = (j + 0.5) / n, x = ax + (bx - ax) * f, z = az + (bz - az) * f;
      if (c.mounts.some((m) => Math.hypot(m.x - x, m.z - z) < m.r * 1.6 + 0.2)) continue;
      b.box(j % 2 ? kit.panel : kit.hull, len / n * 0.55, 0.26 * k, 0.24 * k, x, deckY + 0.11 * k, z, 0.04 * k, [0, -ang, 0]);
    }
  }
  // front: ram glacis between the front pods, hazard bands, headlamps, and a glowing gate in the bailey face
  if (!legged) {
    block(b, kit.metal, 3.15 * kx, 0.15, 0, 0.5 * kx, 2.6 * kz, yt - 0.1, { top: [0.4, 0.95], shift: [0.15 * kx, 0], ch: 0.15 * k, bev: 0.05 });
    hazard(b, kit, 3.42 * kx, yt * 0.55, 0, 2.2 * kz, 0.3 * kx, 7, Math.PI / 2);
  }
  // prow: glowing gate slits on both prow faces, an armoured beak plate on top, headlamps
  const pa = Math.atan2(1.85 * kz, 0.75 * kx);
  both((s) => {
    const fx = 3.42 * kx, fz = s * 0.92 * kz;
    for (let i = 0; i < 3; i++) glow(b, kit, fx, yt + (0.45 + i * 0.22) * k, fz, 0.06, 0.08 * k, 1.3 * kz, [0, s * (Math.PI / 2 - pa), 0]);
    b.box(kit.lamp, 0.1, 0.16 * k, 0.3 * kz, fx + 0.12 * kx, yt + 0.15 * k, fz * 0.6, 0.02, [0, s * (Math.PI / 2 - pa), 0]);
  });
  block(b, kit.panel, 2.9 * kx, deckY - 0.02, 0, 1.2 * kx, 1.6 * kz, 0.18 * k, { top: [0.6, 0.6], shift: [0.2 * kx, 0], ch: 0.5 * k, bev: 0.06 });
  // corner towers standing on the corner pods; their walkway is the seat for the corner guns
  const tR = 0.9 * k, tTop = deckY + 1.5 * k;
  const towers: V3[] = [];
  for (const sx of [1, -1]) for (const sz of [-1, 1]) {
    const tx = sx * 2.45 * kx, tz = sz * 2.85 * kz;
    const base = legged ? yt : Math.max(yt - 0.1, 1.0);
    tower(b, kit, tx, base, tz, tR, tTop - base, { seg: 14, merlons: 8 });
    glow(b, kit, tx + Math.cos(Math.atan2(tz, tx)) * tR * 1.0, deckY - 0.1, tz + Math.sin(Math.atan2(tz, tx)) * tR * 1.0, 0.05, 0.28 * k, 0.12, [0, -Math.atan2(tz, tx), 0]);
    towers.push([tx, tTop, tz]);
  }
  // twin titan-gun bastions behind the gate
  const bast = (x: number, z: number, r: number) => { b.lathe(kit.hull, [[0, 0], [r * 1.5, 0], [r * 1.42, 0.38 * k], [r * 1.3, 0.48 * k], [0, 0.48 * k]], [x, deckY - 0.02, z], 'y', 20); return deckY + 0.46 * k; };
  // central keep: two stepped octagonal stages, glass slit band, the giant gun on top
  const kxC = -1.15 * kx;
  const s1 = deckY + 1.3 * k, s2 = s1 + 1.1 * k;
  planLoft(b, kit.hull, ngon(8, 1.55 * kx, 1.65 * kz), [[deckY - 0.05, 1.0], [s1 - 0.1 * k, 0.96], [s1, 0.9]], [kxC, 0]);
  planLoft(b, kit.panel, ngon(8, 1.1 * kx, 1.2 * kz), [[s1 - 0.02, 1.0], [s2 - 0.1 * k, 0.94], [s2, 0.86]], [kxC + 0.05 * kx, 0]);
  glow(b, kit, kxC + 1.43 * kx, deckY + 0.6 * k, 0, 0.05, 0.08 * k, 0.9 * kz);
  b.box(kit.glass, 0.06, 0.14 * k, 0.8 * kz, kxC + 1.04 * kx, s1 + 0.45 * k, 0, 0.01);
  both((s) => { vent(b, kit, kxC - 0.4 * kx, s1 + 0.01, s * 1.05 * kz, 0.6 * kx, 0.4 * kz, 3, 'x'); glow(b, kit, kxC, s1 - 0.25 * k, s * 1.6 * kz, 1.4 * kx, 0.05, 0.05); });
  // reactor in front of the keep, between the titan guns: the fortress's glowing heart
  reactor(b, kit, [0.55 * kx, deckY - 0.02, 0], 0.62 * k, 'y', 4);
  // shield-generator spire behind the keep: a tapered pylon ringed by floating glow halos, beacon on top
  const spX = kxC - 1.35 * kx, spH = 4.4 * k;
  b.cylb(kit.trim, 0.42 * k, 0.4 * k, 0.06, [spX, deckY - 0.02, 0], 'y', 12);
  b.cyl(kit.hull, 0.26 * k, 0.1 * k, spH, [spX, deckY, 0], 'y', 10);
  for (const [f, r] of [[0.55, 0.62], [0.78, 0.46]] as [number, number][]) {
    const y = deckY + spH * f;
    b.lathe(kit.glow, [[r * k, -0.04 * k], [(r + 0.08) * k, -0.04 * k], [(r + 0.08) * k, 0.04 * k], [r * k, 0.04 * k]], [spX, y, 0], 'y', 18);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; b.box(kit.metal, r * k, 0.05 * k, 0.05 * k, spX + Math.cos(a) * r * k * 0.5, y, Math.sin(a) * r * k * 0.5, 0.01, [0, -a, 0]); }
  }
  b.cyl(kit.lamp, 0.1 * k, 0.1 * k, 0.14 * k, [spX, deckY + spH, 0], 'y', 8);
  sensor(b, kit, kxC - 1.0 * kx, deckY + 0.25 * k, -1.0 * kz, 0.36 * k);
  mast(b, kit, kxC - 1.0 * kx, deckY, 1.0 * kz, 2.2 * k, 0.05 * k);
  both((s) => exhaust(b, kit, -2.9 * kx, deckY - 0.1, s * 1.2 * kz, 0.22 * k, 0.9 * k));
  // banners flying from the rear towers
  both((s) => banner(b, kit, -2.45 * kx - tR * 0.3, tTop, s * 2.85 * kz, 2.6 * k, 0.9 * k, s));
  const isTower = (m: MountSpec) => towers.find(([tx, , tz]) => Math.hypot(m.x - tx, m.z - tz) < tR * 1.1);
  // free tower tops get a beacon dish
  for (const tw of towers) if (!c.mounts.some((m) => Math.hypot(m.x - tw[0], m.z - tw[2]) < tR * 1.1)) {
    b.cylb(kit.trim, tR * 0.6, 0.2 * k, 0.04, [tw[0], tTop, tw[2]], 'y', 12);
    mast(b, kit, tw[0], tTop + 0.2 * k, tw[2], 1.4 * k, 0.05 * k);
    b.lathe(kit.panel, [[0, 0], [tR * 0.55, 0.12 * k], [tR * 0.6, 0.18 * k], [0, 0.06 * k]], [tw[0], tTop + 0.9 * k, tw[2]], 'y', 12, [0, 0, 0.5]);
  }
  const deck = (x: number, z: number) => {
    for (const [tx, ty, tz] of towers) if (Math.hypot(x - tx, z - tz) < tR) return ty;
    if (inPoly(ngon(8, 1.1 * kx, 1.2 * kz).map(([px, pz]) => [px + kxC, pz] as P2), x, z)) return s2;
    return inPoly(oct, x, z) ? deckY : -1;
  };
  let hips: Hip[] | undefined;
  if (stance.legs === 'biped') hips = ([-1, 1] as const).map((s) => ({ p: [-0.2 * kx, stance.hipY, s * 1.7 * kz] as V3, side: s, t: stance.thick, foot: [-0.2 * kx, 0, s * 2.0 * kz] as V3, phase: s > 0 ? Math.PI : 0 }));
  return {
    deckAt: deck, top: s2, custom: true, hips,
    seat: (m: MountSpec) => {
      const tw = isTower(m);
      if (tw) { collar(b, kit, m.x, tw[1] + 0.04, m.z, m.r, tw[1] - 0.1, 16); return { y: tw[1] + 0.04, socket: true }; }
      if (Math.hypot(m.x - kxC, m.z) < 0.6 * k) { const y = s2 + 0.04; collar(b, kit, m.x, y, m.z, m.r, s2 - 0.2, 22); return { y, socket: true }; }
      if (m.cls === 'XL' || (m.x > 0.8 * kx && Math.abs(m.z) > 1.2 * kz)) { const y = bast(m.x, m.z, m.r); collar(b, kit, m.x, y, m.z, m.r, y - 0.1, 22); return { y, socket: true }; }
      const d = deck(m.x, m.z), base = d > 0 ? d : deckY;
      if (base + 0.3 * k > deckY) block(b, kit.hull, m.x, base - 0.02, m.z, m.r * 2.6, m.r * 2.6, 0.3 * k, { top: [0.86, 0.86], ch: m.r * 0.7, bev: 0.04 });
      collar(b, kit, m.x, base + 0.3 * k, m.z, m.r, base + 0.2 * k, 18);
      return { y: base + 0.3 * k, socket: true };
    },
  };
}

registerChassis('citadel', citadel);
