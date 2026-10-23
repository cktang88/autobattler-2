// Lance Dreadnought + Monolith (size 5): the two specialist titans.
//
// Lance Dreadnought / lance (4 wide x 8 long): a gun-ship on legs, built around ONE spinal weapon. A long, narrow
// monitor hull with a knife prow; down its centreline runs a raised spinal accelerator - twin rails threaded through
// armoured coil hoops over a glowing channel - ending in a muzzle ring at the prow. The titan gun sits on a tall
// barbette at the breech of the spine, a slim swept bridge tower stands behind it, and the medium turret rides the
// aft deck between two engine nacelles.
//
// Monolith / monolith (7 x 7): a walking bunker. A squat, square, battered block of layered slab armour (two
// stacked slabs with a dark seam between them, a sloped plate proud of every face), a second stepped tier carrying
// the giant gun in a heavy roof cupola, a commander's block behind it, tiny glowing vision slits, and one small
// casemate on the rear quarter for the medium gun. Lots of blank armour, very few guns.

import type { P2, V3 } from '../geo.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar, exhaust, glow, hazard, sensor, vent } from './shapes.ts';
import { banner, glowGrille, inPoly, mast, ngon, planLoft, skirt } from './giants-kit.ts';

const mirror = (half: P2[]): P2[] => [...half, ...half.slice(1, -1).reverse().map(([x, z]) => [x, -z] as P2)];

function lance(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const kx = L / 8, kz = W / 4, k = Math.min(kx, kz);
  const legged = stance.legs !== null;
  const tracked = stance.tracked;
  const y0 = stance.y0;
  const yt = legged ? y0 + 0.45 * k : Math.max(stance.yt, y0 + 0.4);
  const deckY = yt + 0.85 * k;
  // keel between the running gear
  const wi = Math.min(stance.wi, 1.25 * kz);
  planLoft(b, kit.trim, [[3.3 * kx, 0], [2.7 * kx, wi], [-3.1 * kx, wi], [-3.6 * kx, 0], [-3.1 * kx, -wi], [2.7 * kx, -wi]], [[y0, 0.9], [yt + 0.1, 1.0]]);
  // main hull: long knife-prowed monitor hull, sloped all round
  const hp: P2[] = mirror([[4.0 * kx, 0], [3.1 * kx, -0.62 * kz], [1.4 * kx, -1.62 * kz], [-2.7 * kx, -1.72 * kz], [-3.75 * kx, -1.3 * kz], [-3.95 * kx, -0.55 * kz], [-3.95 * kx, 0]]);
  planLoft(b, kit.hull, hp, [[yt - 0.05, 0.88], [yt + 0.3 * k, 1.0], [deckY - 0.12 * k, 0.97], [deckY, 0.92]]);
  planLoft(b, kit.trim, hp, [[yt + 0.26 * k, 1.006], [yt + 0.36 * k, 1.006]]);
  const deckPoly = hp.map(([x, z]) => [x * 0.92, z * 0.92] as P2);
  // flank glow lines, hanging armour skirts (between the track pods when tracked)
  both((s) => {
    glow(b, kit, -0.5 * kx, deckY - 0.35 * k, s * 1.67 * kz, 3.6 * kx, 0.06, 0.06);
    if (tracked) skirt(b, kit, -1.15 * kx, 1.15 * kx, yt + 0.28 * k, s * 1.73 * kz, 0.55 * k, 0.1 * kz, 3, s);
    else skirt(b, kit, -2.6 * kx, 1.3 * kx, yt + 0.28 * k, s * 1.73 * kz, 0.55 * k, 0.1 * kz, 6, s);
  });
  // prow: ram beak under the knife bow, hazard chevrons, headlamps
  block(b, kit.metal, 3.55 * kx, Math.max(0.15, yt - 0.45 * k), 0, 1.0 * kx, 0.8 * kz, 0.6 * k, { top: [0.55, 0.8], shift: [0.25 * kx, 0], ch: 0.2 * kz, bev: 0.05 });
  both((s) => {
    hazard(b, kit, 2.15 * kx, deckY + 0.005, s * 0.95 * kz, 0.9 * kx, 0.2 * kz, 4, -s * 0.5);
    b.box(kit.lamp, 0.12, 0.12 * k, 0.22 * kz, 3.45 * kx, yt + 0.2 * k, s * 0.42 * kz, 0.02, [0, s * 0.6, 0]);
  });
  // ---- the spine: a raised gun deck running from the breech to the prow, carrying the accelerator
  const sp0 = -0.55 * kx, sp1 = 3.65 * kx, spTop = deckY + 0.3 * k;
  block(b, kit.hull, (sp0 + sp1) / 2, deckY - 0.02, 0, sp1 - sp0, 1.5 * kz, 0.32 * k, { top: [0.97, 0.78], ch: 0.3 * kz, bev: 0.06 });
  const ry = spTop + 0.16 * k;
  // glowing channel between twin rails
  glow(b, kit, 2.2 * kx, spTop + 0.02, 0, 3.2 * kx, 0.05, 0.22 * kz);
  both((s) => beam(b, kit.metal, [0.75 * kx, ry, s * 0.36 * kz], [3.95 * kx, ry - 0.04 * k, s * 0.3 * kz], 0.17 * kz, 0.32 * k));
  // coil hoops threaded over the rails (armoured, a glowing band on each)
  for (let i = 0; i < 5; i++) {
    const x = 1.25 * kx + i * 0.6 * kx, r = (0.6 - i * 0.02) * k;
    b.lathe(kit.trim, [[r, 0], [r + 0.13 * k, 0], [r + 0.13 * k, 0.2 * k], [r, 0.2 * k]], [x, ry, 0], 'x', 14);
    b.lathe(kit.glow, [[r + 0.12 * k, 0.07 * k], [r + 0.15 * k, 0.07 * k], [r + 0.15 * k, 0.13 * k], [r + 0.12 * k, 0.13 * k]], [x, ry, 0], 'x', 14);
  }
  // muzzle ring + lens at the prow
  b.cylb(kit.metal, 0.5 * k, 0.28 * k, 0.05, [3.68 * kx, ry, 0], 'x', 16);
  b.cyl(kit.glow, 0.3 * k, 0.26 * k, 0.05, [3.96 * kx, ry, 0], 'x', 14);
  // ---- bridge: a slim, swept tower behind the breech
  const bx = -1.35 * kx, b1 = deckY + 0.95 * k, b2 = b1 + 0.6 * k;
  block(b, kit.hull, bx, deckY - 0.02, 0, 1.7 * kx, 1.9 * kz, b1 - deckY + 0.02, { top: [0.72, 0.7], shift: [-0.2 * kx, 0], ch: 0.35 * kz, bev: 0.06 });
  block(b, kit.panel, bx - 0.25 * kx, b1 - 0.02, 0, 1.0 * kx, 1.1 * kz, b2 - b1, { top: [0.62, 0.78], shift: [-0.15 * kx, 0], ch: 0.25 * kz, bev: 0.05 });
  b.box(kit.glass, 0.06, 0.12 * k, 0.9 * kz, bx + 0.18 * kx, b1 + 0.28 * k, 0, 0.01, [0, 0, -0.55]);
  glow(b, kit, bx + 0.62 * kx, deckY + 0.5 * k, 0, 0.05, 0.07 * k, 1.1 * kz, [0, 0, -0.4]);
  block(b, kit.accent, bx - 0.4 * kx, b2 - 0.02, 0, 0.8 * kx, 0.1 * kz, 0.3 * k, { top: [0.4, 1], shift: [-0.2 * kx, 0], ch: 0.03, bev: 0.02 });
  sensor(b, kit, bx + 0.05 * kx, b2 + 0.05 * k, 0.3 * kz, 0.26 * k);
  mast(b, kit, bx - 0.45 * kx, b2 - 0.05, -0.3 * kz, 2.0 * k, 0.05 * k);
  banner(b, kit, bx - 0.75 * kx, b1 - 0.1, 0.55 * kz, 2.0 * k, 0.65 * k, 1);
  both((s) => {
    exhaust(b, kit, -2.05 * kx, deckY - 0.05, s * 1.12 * kz, 0.17 * k, 0.75 * k);
    vent(b, kit, -0.15 * kx, deckY, s * 1.12 * kz, 0.8 * kx, 0.45 * kz, 3, 'x');
  });
  // ---- aft: raised deck for the medium turret, two engine nacelles glowing astern
  const ax = -2.9 * kx, aTop = deckY + 0.28 * k;
  block(b, kit.hull, ax, deckY - 0.02, 0, 1.4 * kx, 1.7 * kz, aTop - deckY + 0.02, { top: [0.86, 0.84], ch: 0.3 * kz, bev: 0.05 });
  both((s) => {
    const nz = s * 0.9 * kz, ny = yt + 0.45 * k;
    b.cylb(kit.trim, 0.42 * k, 0.5 * k, 0.05, [-3.45 * kx, ny, nz], '-x', 14);
    b.cyl(kit.hot, 0.3 * k, 0.26 * k, 0.04, [-3.45 * kx - 0.5 * k, ny, nz], '-x', 12);
    glowGrille(b, kit, -3.63 * kx, deckY - 0.1 * k, s * 0.3 * kz, 0.4 * kz, 0.3 * k, 2, -1);
  });
  // hips: biped legs under the hull's centre of mass (just behind the breech)
  let hips: Hip[] | undefined;
  if (stance.legs === 'biped') {
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.3 * kx, stance.hipY, s * 1.15 * kz] as V3, side: s, t: stance.thick, foot: [-0.3 * kx, 0, s * 1.4 * kz] as V3, phase: s > 0 ? Math.PI : 0 }));
    both((s) => block(b, kit.trim, -0.3 * kx, y0 - 0.25 * k, s * 1.15 * kz, 1.0 * kx, 0.6 * kz, 0.5 * k, { top: [0.8, 0.8], ch: 0.15 * k }));
  }
  const deck = (x: number, z: number) => {
    if (x > sp0 && x < sp1 && Math.abs(z) < 0.6 * kz) return spTop;
    if (Math.abs(x - ax) < 0.6 * kx && Math.abs(z) < 0.7 * kz) return aTop;
    return inPoly(deckPoly, x, z) ? deckY : -1;
  };
  return {
    deckAt: deck, top: b2, custom: true, hips,
    seat: (m: MountSpec) => {
      if (m.x > sp0 && m.x < sp1 && Math.abs(m.z) < 0.8 * kz) {
        // breech barbette: a tall armoured drum on the spine, its own glow band
        const y = spTop + 0.32 * k, R = m.r * 1.4;
        b.lathe(kit.hull, [[0, 0], [R * 1.12, 0], [R * 1.05, 0.12 * k], [R, y - spTop], [0, y - spTop]], [m.x, spTop - 0.02, m.z], 'y', 20);
        b.lathe(kit.glow, [[R * 1.06, 0], [R * 1.1, 0], [R * 1.1, 0.06 * k], [R * 1.06, 0.06 * k]], [m.x, spTop + 0.08 * k, m.z], 'y', 20);
        collar(b, kit, m.x, y, m.z, m.r, y - 0.1, 20);
        return { y, socket: true };
      }
      const d = deck(m.x, m.z), base = d > 0 ? d : deckY;
      collar(b, kit, m.x, base + 0.12 * k, m.z, m.r, base - 0.02, 18);
      return { y: base + 0.12 * k, socket: true };
    },
  };
}

/** square plan with chamfered corners (half extent h, chamfer c), centred at (cx, 0) */
const sq = (h: number, c: number, cx = 0, hz = h): P2[] =>
  [[cx + h, -hz + c], [cx + h, hz - c], [cx + h - c, hz], [cx - h + c, hz], [cx - h, hz - c], [cx - h, -hz + c], [cx - h + c, -hz], [cx + h - c, -hz]];

function monolith(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const kx = L / 7, kz = W / 7, k = Math.min(kx, kz);
  const legged = stance.legs !== null;
  const y0 = stance.y0;
  const yt = legged ? y0 + 0.5 * k : Math.max(stance.yt, y0 + 0.4);
  // lower hull between the running gear
  const wi = Math.min(stance.wi, 2.4 * kz);
  planLoft(b, kit.trim, ngon(8, 3.0 * kx, wi), [[y0, 0.92], [yt + 0.1, 1.0]]);
  // ---- tier 1: two stacked battered armour slabs with a deep dark seam between them
  const p1 = sq(3.35 * kx, 0.7 * k, 0, 3.35 * kz);
  const s1 = yt + 1.0 * k, t1 = yt + 2.0 * k;
  planLoft(b, kit.hull, p1, [[yt - 0.1, 0.93], [yt + 0.2 * k, 1.0], [s1, 0.98]]);
  planLoft(b, kit.trim, p1, [[s1 - 0.01, 0.94], [s1 + 0.16 * k, 0.94]]);
  planLoft(b, kit.hull, p1, [[s1 + 0.15 * k, 0.975], [s1 + 0.28 * k, 0.97], [t1 - 0.14 * k, 0.9], [t1, 0.86]]);
  const top1 = p1.map(([x, z]) => [x * 0.86, z * 0.86] as P2);
  // appliqué slabs standing well proud of every face, leaning with the batter (front glacis heaviest)
  const fy = yt + 0.08;
  const pl = (x: number, z: number, l: number, w: number, h: number, sx: number, sz: number) => {
    block(b, kit.trim, x - sx * 0.6, fy + 0.1 * k, z - sz * 0.6, l + Math.abs(sz) * 2.2, w + Math.abs(sx) * 2.2, h - 0.2 * k, { top: [0.9, 0.9], shift: [-sx * 0.8, -sz * 0.8], ch: 0.1 * k, bev: 0.03 });
    block(b, kit.panel, x, fy, z, l, w, h, { top: [sx ? 0.7 : 0.94, sz ? 0.7 : 0.94], shift: [-sx, -sz], ch: 0.12 * k, bev: 0.07 });
  };
  pl(3.47 * kx, 0, 0.38 * kx, 3.9 * kz, 1.75 * k, 0.32 * kx, 0);
  both((s) => {
    pl(-3.47 * kx, s * 1.65 * kz, 0.36 * kx, 1.7 * kz, 1.6 * k, -0.3 * kx, 0);
    for (const x of [-1.2, 1.15]) pl(x * kx, s * 3.47 * kz, 2.0 * kx, 0.36 * kz, 1.65 * k, 0, s * 0.3 * kz);
    // corner buttresses: diamond pillars on the chamfers, tapering up past the roof edge
    for (const sx of [-1, 1]) planLoft(b, sx > 0 ? kit.hull : kit.panel, ngon(4, 0.7 * k, 0.7 * k, 0), [[yt - 0.05, 1.0], [t1 - 0.3 * k, 0.86], [t1 + 0.2 * k, 0.62], [t1 + 0.3 * k, 0.5]], [sx * 2.92 * kx, s * 2.92 * kz]);
    // seam glow, faint lines in the gap between slabs
    glow(b, kit, 0, s1 + 0.08 * k, s * 3.16 * kz, 1.2 * kx, 0.04, 0.04);
  });
  // vision slits in the glacis plate (tiny), headlamps under them
  for (const z of [-0.85, 0, 0.85]) glow(b, kit, 3.36 * kx, yt + 1.45 * k, z * kz, 0.05, 0.05 * k, 0.4 * kz, [0, 0, -0.18]);
  both((s) => b.box(kit.lamp, 0.1, 0.12 * k, 0.28 * kz, 3.5 * kx, yt + 0.25 * k, s * 1.4 * kz, 0.02));
  hazard(b, kit, 3.42 * kx, fy + 0.4 * k, 0, 3.4 * kz, 0.06 * kx, 9, Math.PI / 2);
  // ---- tier 2: a stepped roof block (giant gun cupola on top), commander's block behind it
  const p2 = sq(2.2 * kx, 0.95 * k, 0.1 * kx, 2.2 * kz);
  const t2 = t1 + 1.05 * k;
  planLoft(b, kit.trim, p2, [[t1 - 0.05, 1.04], [t1 + 0.12 * k, 1.04]]);
  planLoft(b, kit.hull, p2, [[t1 + 0.1 * k, 1.0], [t2 - 0.1 * k, 0.9], [t2, 0.86]], [0, 0]);
  const top2 = p2.map(([x, z]) => [0.1 * kx + (x - 0.1 * kx) * 0.86, z * 0.86] as P2);
  // tier-2 vision band: a dark recess with two short slits
  b.box(kit.trim, 0.1, 0.2 * k, 1.6 * kz, 2.12 * kx, t1 + 0.55 * k, 0, 0.02, [0, 0, -0.32]);
  both((s) => glow(b, kit, 2.15 * kx, t1 + 0.56 * k, s * 0.4 * kz, 0.05, 0.05 * k, 0.45 * kz, [0, 0, -0.32]));
  // team accent band across the roof edge, roof vents
  both((s) => { b.box(kit.accent, 3.0 * kx, 0.08 * k, 0.16 * kz, -0.2 * kx, t2 - 0.25 * k, s * 2.05 * kz, 0.02, [s * 0.38, 0, 0]); vent(b, kit, -1.1 * kx, t2, s * 1.05 * kz, 0.9 * kx, 0.6 * kz, 3, 'x'); });
  // commander's block: a low armoured box behind the cupola with a periscope, sensor and mast
  const cbx = -1.2 * kx, cbT = t2 + 0.55 * k;
  block(b, kit.panel, cbx, t2 - 0.02, 0, 1.2 * kx, 1.3 * kz, cbT - t2 + 0.02, { top: [0.72, 0.78], shift: [-0.1 * kx, 0], ch: 0.25 * k, bev: 0.05 });
  glow(b, kit, cbx + 0.45 * kx, t2 + 0.33 * k, 0, 0.05, 0.05 * k, 0.6 * kz, [0, 0, -0.6]);
  sensor(b, kit, cbx + 0.1 * kx, cbT + 0.08 * k, -0.25 * kz, 0.24 * k);
  mast(b, kit, cbx - 0.3 * kx, cbT - 0.05, 0.3 * kz, 1.8 * k, 0.05 * k);
  // ---- rear: reactor grilles in the back plate, twin squat stacks
  glowGrille(b, kit, -3.4 * kx, yt + 0.75 * k, 0, 1.1 * kz, 0.6 * k, 3, -1);
  both((s) => exhaust(b, kit, -2.45 * kx, t1 - 0.12 * k, s * 0.75 * kz, 0.2 * k, 0.6 * k));
  // ---- rear-quarter casemate for the medium gun (built at the mount, on the tier-1 roof)
  const cas = new Map<MountSpec, number>();
  for (const m of c.mounts) {
    if (Math.hypot(m.x - 0.1 * kx, m.z) < 1.2 * k) continue;
    const top = t1 + 0.55 * k;
    block(b, kit.hull, m.x + 0.1 * kx, t1 - 0.05, m.z, m.r * 3.0, m.r * 3.0, top - t1 + 0.05, { top: [0.8, 0.8], ch: m.r * 0.9, bev: 0.05 });
    cas.set(m, top);
  }
  let hips: Hip[] | undefined;
  if (stance.legs === 'biped') {
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.2 * kx, stance.hipY, s * 1.85 * kz] as V3, side: s, t: stance.thick, foot: [-0.2 * kx, 0, s * 2.15 * kz] as V3, phase: s > 0 ? Math.PI : 0 }));
    both((s) => block(b, kit.trim, -0.2 * kx, y0 - 0.3 * k, s * 1.85 * kz, 1.4 * kx, 0.9 * kz, 0.6 * k, { top: [0.8, 0.8], ch: 0.2 * k }));
  }
  const deck = (x: number, z: number) => {
    if (x > cbx - 0.45 * kx && x < cbx + 0.45 * kx && Math.abs(z) < 0.5 * kz) return cbT;
    if (inPoly(top2, x, z)) return t2;
    return inPoly(top1, x, z) ? t1 : -1;
  };
  return {
    deckAt: deck, top: cbT, custom: true, hips,
    seat: (m: MountSpec) => {
      const ct = cas.get(m);
      if (ct !== undefined) { collar(b, kit, m.x, ct, m.z, m.r, ct - 0.1, 18); return { y: ct, socket: true }; }
      // roof cupola: a heavy stepped ring drum rising out of the tier-2 roof
      const y = t2 + 0.3 * k, R = m.r * 1.35;
      b.lathe(kit.hull, [[0, 0], [R * 1.2, 0], [R * 1.12, 0.1 * k], [R, y - t2], [0, y - t2]], [m.x, t2 - 0.02, m.z], 'y', 22);
      b.lathe(kit.trim, [[R * 1.18, 0], [R * 1.24, 0], [R * 1.24, 0.08 * k], [R * 1.18, 0.08 * k]], [m.x, t2 + 0.02, m.z], 'y', 22);
      collar(b, kit, m.x, y, m.z, m.r, y - 0.1, 22);
      return { y, socket: true };
    },
  };
}

registerChassis('lance', lance);
registerChassis('monolith', monolith);
