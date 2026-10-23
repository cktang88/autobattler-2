// Lance Dreadnought / lance (4 wide x 8 long): a gun-ship on legs, built around ONE spinal weapon. A long, narrow
// monitor hull with a knife prow; down its centreline runs a raised spinal accelerator - twin rails threaded through
// armoured coil hoops over a glowing channel - ending in a muzzle ring at the prow. The titan gun sits on a tall
// barbette at the breech of the spine, a slim swept bridge tower stands behind it, and the medium turret rides the
// aft deck between two engine nacelles. From above the hull is waisted, not a plank: a slim knife-nosed gun section,
// a pinched midships under the bridge, and swept aft engine wings carrying outboard thruster pods. Plated, riveted
// flanks with gun ports; conduits along the spine. (Monolith: titans-monolith.ts.)

import type { P2, V3 } from '../geo.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar, exhaust, glow, hazard, sensor, vent } from './shapes.ts';
import { banner, glowGrille, mast, planLoft, skirt } from './giants-kit.ts';
import { armourPlate, faceRivets, faceSlit, inside, lamp, mirror, pipeRun, sensorDome, wallFace, whip } from './titan-greebles.ts';

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
  const hp: P2[] = mirror([[4.0 * kx, 0], [3.0 * kx, -0.66 * kz], [1.35 * kx, -1.5 * kz], [-0.85 * kx, -1.36 * kz], [-2.25 * kx, -1.96 * kz], [-3.4 * kx, -1.96 * kz], [-3.95 * kx, -1.0 * kz], [-3.95 * kx, 0]]);
  planLoft(b, kit.hull, hp, [[yt - 0.05, 0.88], [yt + 0.3 * k, 1.0], [deckY - 0.12 * k, 0.97], [deckY, 0.92]]);
  planLoft(b, kit.trim, hp, [[yt + 0.26 * k, 1.006], [yt + 0.36 * k, 1.006]]);
  const deckPoly = hp.map(([x, z]) => [x * 0.92, z * 0.92] as P2);
  // flank glow lines, hanging armour skirts (between the track pods when tracked)
  both((s) => {
    glow(b, kit, 0.2 * kx, deckY - 0.3 * k, s * 1.38 * kz, 2.0 * kx, 0.06, 0.06);
    skirt(b, kit, -0.75 * kx, tracked ? 1.1 * kx : 1.25 * kx, yt + 0.28 * k, s * 1.46 * kz, 0.55 * k, 0.1 * kz, 3, s);
    // outboard thruster pods on the aft wings: armoured nacelles with hot nozzles and a dorsal fin
    const pz = s * 1.72 * kz, py = deckY - 0.25 * k;
    b.lathe(kit.hull, [[0, 0], [0.3 * k, 0], [0.36 * k, 0.4 * k], [0.36 * k, 1.1 * kx], [0.3 * k, 1.35 * kx], [0, 1.35 * kx]], [-2.15 * kx, py, pz], '-x', 10);
    b.cylb(kit.trim, 0.3 * k, 0.25 * k, 0.03, [-3.5 * kx, py, pz], '-x', 10);
    b.cyl(kit.hot, 0.22 * k, 0.2 * k, 0.04, [-3.5 * kx - 0.25 * k, py, pz], '-x', 10);
    for (const f of [0.35, 0.7]) b.cylb(kit.trim, 0.38 * k, 0.06 * k, 0.01, [-2.15 * kx - f * 1.35 * kx, py, pz], '-x', 10);
    block(b, kit.panel, -2.95 * kx, py + 0.25 * k, pz, 1.0 * kx, 0.08 * kz, 0.55 * k, { top: [0.35, 1], shift: [-0.35 * kx, 0], ch: 0.02, bev: 0.02 });
    lamp(b, kit, -2.1 * kx, py, pz + s * 0.3 * k, 0.12 * k, s * Math.PI / 2);
    // spine conduits
    pipeRun(b, kit, [[-0.4 * kx, deckY + 0.08 * k, s * 0.85 * kz], [1.0 * kx, deckY + 0.08 * k, s * 0.82 * kz], [2.6 * kx, deckY + 0.08 * k, s * 0.6 * kz]], 0.05 * k);
  });
  // flank plating: layered riveted plates and gun ports on every hull wall
  for (let i = 0; i < hp.length; i++) {
    const f = wallFace(hp, i, [yt + 0.38 * k, 1.0], [deckY - 0.14 * k, 0.97]);
    if (f.w < 0.6 * k) continue;
    const n = Math.max(1, Math.round(f.w / (1.1 * k)));
    for (let j = 0; j < n; j++) {
      const du = (j + 0.5 - n / 2) * (f.w / n);
      armourPlate(b, kit, f, du, 0, (f.w / n) * 0.82, f.h * 0.6, 0.08 * k, j % 2 ? kit.panel : kit.hull);
      if (j % 2 === 0) faceSlit(b, kit, f, du, f.h * 0.38, (f.w / n) * 0.35, 0.04 * k);
    }
    faceRivets(b, kit.metal, f, -f.w * 0.45, f.w * 0.45, -f.h * 0.44, Math.max(3, Math.round(f.w / (0.3 * k))), 0.05 * k);
  }
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
  sensorDome(b, kit, bx - 0.05 * kx, b1 - 0.02, -0.62 * kz, 0.2 * k);
  whip(b, kit, bx - 0.9 * kx, b1 - 0.02, -0.5 * kz, 1.3 * k);
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
    return inside(deckPoly, x, z) ? deckY : -1;
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

registerChassis('lance', lance);
