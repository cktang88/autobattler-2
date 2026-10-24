// Lance Dreadnought / lance (4 wide x 8 long): a lean gun-ship on legs, built around ONE spinal weapon. A long,
// narrow monitor hull with a knife prow; down its centreline runs the SIGNATURE: a raised faceted gun deck carrying
// the spinal accelerator - twin thin rails threaded through octagonal armoured coil hoops over a glowing channel,
// capacitor banks and cable runs alongside, ending in a slotted muzzle brake at the prow. The titan gun sits on a
// faceted barbette at the breech, a slim plated bridge tower stands behind it, and the medium turret rides the aft
// deck between two engine nacelles. From above the hull is waisted: a slim knife-nosed gun section, a pinched
// midships under the bridge, and swept aft wings carrying faceted thruster pods.
// Hard-surface pass (hs-kit.ts / hs-kit-titan.ts): steep plated flanks (thick appliqué plates on shadow gaps,
// stacks + ERA on the prow faces, grilles astern), hanging skirt plates, railed side walkways with ladders down the
// flanks, searchlights and a lattice radar mast on the bridge, coolant runs from the nacelles to the capacitors.
// Asymmetric: radar mast left / sensor dome + searchlight right of the bridge, one exhaust stack (left), an ammo
// locker stack on the right of the aft deck.

import type { P2, V3 } from '../geo.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar, glow, hazard } from './shapes.ts';
import { banner, glowGrille } from './giants-kit.ts';
import { armorPlate, cableBundle, cagedLamp, crewHatch, fineFor, frame, hexSec, ladder, piston, recessPanel, rectP, stowBox } from './hs-kit.ts';
import { armourWalls, facePlateHS, latticeMast, ngonT, octBarbette, octStack, planLoftT, railLoop, searchlight, xPrism } from './hs-kit-titan.ts';
import { faceSlit, inside, mirror, pipeRun, sensorDome, wallFace } from './titan-greebles.ts';

function lance(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const kx = L / 8, kz = W / 4, k = Math.min(kx, kz);
  const fine = fineFor(c.S);
  const legged = stance.legs !== null;
  const tracked = stance.tracked;
  const y0 = stance.y0;
  const yt = legged ? y0 + 0.45 * k : Math.max(stance.yt, y0 + 0.4);
  const deckY = yt + 0.85 * k;
  const u = 0.08 * k;
  // keel between the running gear
  const wi = Math.min(stance.wi, 1.25 * kz);
  planLoftT(b, kit.mech, [[3.3 * kx, 0], [2.7 * kx, wi], [-3.1 * kx, wi], [-3.6 * kx, 0], [-3.1 * kx, -wi], [2.7 * kx, -wi]], [[y0, 0.9], [yt + 0.1, 1.0]]);
  // main hull: long knife-prowed monitor hull, steep plated flanks with a chamfered shoulder
  const hp: P2[] = mirror([[4.0 * kx, 0], [3.0 * kx, -0.66 * kz], [1.35 * kx, -1.5 * kz], [-0.85 * kx, -1.36 * kz], [-2.25 * kx, -1.96 * kz], [-3.4 * kx, -1.96 * kz], [-3.95 * kx, -1.0 * kz], [-3.95 * kx, 0]]);
  const shY = deckY - 0.18 * k;
  planLoftT(b, kit.armor, hp, [[yt - 0.05, 0.9], [yt + 0.26 * k, 1.0], [shY, 0.985], [deckY, 0.93]]);
  planLoftT(b, kit.mech, hp, [[yt + 0.22 * k, 1.008], [yt + 0.32 * k, 1.008]]);
  const deckPoly = hp.map(([x, z]) => [x * 0.93, z * 0.93] as P2);
  armourWalls(b, kit, hp, [yt + 0.34 * k, 0.998], [shY - 0.03 * k, 0.986], { u, pitch: 1.1 * k, fill: 0.72, front: 0.4, slits: true, rear: -0.9 });
  // hanging skirt plates (between the track pods when tracked), flank glow lines
  both((s) => {
    glow(b, kit, 0.2 * kx, shY + 0.06 * k, s * 1.42 * kz, 2.0 * kx, 0.04, 0.04);
    const x0 = -0.75 * kx - (tracked ? 1.1 : 1.25) * kx, x1 = -0.75 * kx + (tracked ? 1.1 : 1.25) * kx, n = 3;
    for (let i = 0; i < n; i++) {
      const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
      armorPlate(b, kit, i % 2 ? kit.armor2 : kit.shell, frame([x, yt + 0.02, s * 1.5 * kz], [0, -0.1, s], [1, 0, 0]), rectP(((x1 - x0) / n) * 0.9, 0.5 * k, 0.05 * k), u * 1.1, { standoff: u });
    }
  });
  // ---- outboard thruster pods on the aft wings: faceted nacelles, clamp bands, hot nozzles, dorsal fin, struts
  both((s) => {
    const pz = s * 1.72 * kz, py = deckY - 0.25 * k;
    xPrism(b, kit.armor, 8, [[-2.15 * kx, 0.26 * k, 0.26 * k], [-2.4 * kx, 0.36 * k, 0.36 * k], [-3.25 * kx, 0.36 * k, 0.36 * k], [-3.45 * kx, 0.3 * k, 0.3 * k]], [py, pz]);
    for (const x of [-2.6, -3.0]) xPrism(b, kit.mech, 8, [[x * kx, 0.39 * k, 0.39 * k], [x * kx - 0.08 * k, 0.39 * k, 0.39 * k]], [py, pz]);
    xPrism(b, kit.joint, 8, [[-3.45 * kx, 0.26 * k, 0.26 * k], [-3.62 * kx, 0.22 * k, 0.22 * k]], [py, pz]);
    b.cyl(kit.hot, 0.18 * k, 0.18 * k, 0.03, [-3.63 * kx, py, pz], '-x', 8);
    armorPlate(b, kit, kit.armor2, frame([-2.9 * kx, py + 0.33 * k, pz], [0, 0, 1], [1, 0, 0]), [[0.55 * kx, 0], [-0.5 * kx, 0], [-0.6 * kx, 0.5 * k], [-0.2 * kx, 0.5 * k]], 0.05 * k, { back: null, standoff: 0 });
    // coolant run from the pod forward along the deck edge to the capacitor bank
    if (fine) pipeRun(b, kit, [[-2.2 * kx, py + 0.2 * k, pz * 0.9], [-1.0 * kx, deckY + 0.06 * k, s * 1.05 * kz], [0.4 * kx, deckY + 0.06 * k, s * 0.86 * kz]], 0.045 * k, kit.joint);
    searchlight(b, kit, -2.1 * kx, py + 0.3 * k, pz + s * 0.1 * k, s * 1.4, 0.13 * k, fine);
  });
  // prow: ram beak under the knife bow, hazard chevrons, caged headlamps
  block(b, kit.joint, 3.55 * kx, Math.max(0.15, yt - 0.45 * k), 0, 1.0 * kx, 0.8 * kz, 0.6 * k, { top: [0.55, 0.8], shift: [0.25 * kx, 0], ch: 0.2 * kz, bev: 0.05 });
  both((s) => {
    hazard(b, kit, 2.15 * kx, deckY + 0.005, s * 0.95 * kz, 0.9 * kx, 0.2 * kz, 4, -s * 0.5);
    cagedLamp(b, kit, frame([3.3 * kx, yt + 0.12 * k, s * 0.5 * kz], [0, 1, 0], [Math.cos(s * 0.5), 0, Math.sin(s * 0.5)]), 0.16 * k, fine);
  });

  // ---- SIGNATURE: the spinal accelerator on a raised faceted gun deck from the breech to the prow
  const sp0 = -0.55 * kx, sp1 = 3.65 * kx, spTop = deckY + 0.3 * k;
  b.loft(kit.armor2, [hexSec(sp0, deckY - 0.02, 0.72 * kz, 0.75 * kz, deckY + 0.05 * k, spTop - 0.12 * k, 0.55 * kz, spTop), hexSec(sp1, deckY - 0.02, 0.52 * kz, 0.55 * kz, deckY + 0.05 * k, spTop - 0.12 * k, 0.4 * kz, spTop)]);
  // flank plates along the gun deck sides
  both((s) => {
    for (let i = 0; i < 4; i++) {
      const x = sp0 + (sp1 - sp0) * (i + 0.5) / 4, wz = 0.75 * kz - (0.2 * kz * (x - sp0)) / (sp1 - sp0);
      armorPlate(b, kit, i % 2 ? kit.armor : kit.shell, frame([x, deckY + 0.13 * k, s * wz], [0, 0, s], [1, 0, 0]), rectP((sp1 - sp0) / 4 * 0.86, 0.17 * k, 0.03 * k), 0.05 * k, { standoff: 0.025 * k });
    }
  });
  const ry = spTop + 0.16 * k;
  glow(b, kit, 2.2 * kx, spTop + 0.02, 0, 3.2 * kx, 0.04, 0.18 * kz);
  // twin rails: long and thin, on pedestal blocks
  both((s) => {
    beam(b, kit.joint, [0.75 * kx, ry, s * 0.3 * kz], [3.95 * kx, ry - 0.04 * k, s * 0.26 * kz], 0.1 * kz, 0.2 * k);
    beam(b, kit.steel, [0.85 * kx, ry + 0.11 * k, s * 0.28 * kz], [3.92 * kx, ry + 0.07 * k, s * 0.24 * kz], 0.05 * kz, 0.03 * k);
    for (let i = 0; i < 5; i++) b.box(kit.mech, 0.14 * k, ry - spTop, 0.16 * kz, 1.0 * kx + i * 0.65 * kx, (ry + spTop) / 2 - 0.05 * k, s * 0.3 * kz, 0.02 * k);
  });
  // octagonal coil hoops (armoured, a glowing band in each), capacitor banks between them on both sides, cable runs
  for (let i = 0; i < 5; i++) {
    const x = 1.25 * kx + i * 0.6 * kx, r = (0.6 - i * 0.025) * k;
    b.lathe(kit.armor, [[r, 0], [r + 0.15 * k, 0], [r + 0.17 * k, 0.04 * k], [r + 0.17 * k, 0.18 * k], [r + 0.15 * k, 0.22 * k], [r, 0.22 * k]], [x, ry, 0], 'x', 8);
    b.lathe(kit.glow, [[r + 0.16 * k, 0.08 * k], [r + 0.19 * k, 0.08 * k], [r + 0.19 * k, 0.14 * k], [r + 0.16 * k, 0.14 * k]], [x, ry, 0], 'x', 8);
    // hoop foot: a clamp block down to the gun deck
    b.box(kit.mech, 0.24 * k, ry - r - spTop + 0.08 * k, 0.5 * kz, x + 0.11 * k, spTop + (ry - r - spTop) / 2, 0, 0.02 * k);
    if (i < 4) both((s) => {
      const cx = x + 0.3 * kx, cz = s * 0.42 * kz;
      stowBox(b, kit, frame([cx, spTop - 0.01, cz], [0, 1, 0], [1, 0, 0]), 0.3 * kx, 0.16 * k, 0.16 * kz, kit.armor2);
      b.box(kit.glow, 0.2 * kx, 0.02 * k, 0.02 * kz, cx, spTop + 0.1 * k, cz + s * 0.085 * kz, 0.003);
    });
  }
  if (fine) both((s) => cableBundle(b, kit, [0.95 * kx, spTop + 0.08 * k, s * 0.5 * kz], [3.4 * kx, spTop + 0.06 * k, s * 0.4 * kz], 0.022 * k, [0, 0, 1], 2, 0.03));
  // slotted muzzle brake + lens at the prow (faceted)
  xPrism(b, kit.joint, 8, [[3.62 * kx, 0.42 * k, 0.42 * k], [3.68 * kx, 0.48 * k, 0.48 * k], [4.05 * kx, 0.48 * k, 0.48 * k], [4.1 * kx, 0.42 * k, 0.42 * k]], [ry, 0]);
  both((s) => { for (const x of [3.78, 3.94]) b.box(kit.mech, 0.07 * kx, 0.3 * k, 0.06 * k, x * kx, ry, s * 0.47 * k, 0.01); });
  b.cyl(kit.glow, 0.28 * k, 0.24 * k, 0.04, [4.08 * kx, ry, 0], 'x', 8);

  // ---- bridge: a slim, swept, plated tower behind the breech; window band, brow plate, radar mast left, sensor dome
  // and searchlight right, banner astern
  const bx = -1.35 * kx, b1 = deckY + 0.95 * k, b2 = b1 + 0.6 * k;
  const BP: P2[] = [[0.75 * kx, 0], [0.4 * kx, 0.95 * kz], [-0.85 * kx, 0.95 * kz], [-1.0 * kx, 0.5 * kz], [-1.0 * kx, -0.5 * kz], [-0.85 * kx, -0.95 * kz], [0.4 * kx, -0.95 * kz]];
  planLoftT(b, kit.armor, BP, [[deckY - 0.02, 1.0], [b1 - 0.25 * k, 0.86, -0.08 * kx], [b1, 0.74, -0.14 * kx]], [bx, 0]);
  for (let i = 0; i < BP.length; i++) {
    const f = wallFace(BP.map(([x, z]) => [x - 0.04 * kx, z] as P2), i, [deckY + 0.1 * k, 0.98], [b1 - 0.3 * k, 0.87], [bx, 0]);
    if (f.w < 0.4 * k) continue;
    facePlateHS(b, kit, f, 0, -f.h * 0.05, f.w * 0.8, f.h * 0.7, u * 0.9, i % 2 ? kit.armor2 : kit.shell, u * 0.4);
    if (f.n.x > 0.2) faceSlit(b, kit, f, 0, f.h * 0.42, f.w * 0.5, u * 0.45, kit.glass);
  }
  const BP2: P2[] = [[0.35 * kx, 0], [0.15 * kx, 0.55 * kz], [-0.55 * kx, 0.55 * kz], [-0.6 * kx, 0], [-0.55 * kx, -0.55 * kz], [0.15 * kx, -0.55 * kz]];
  planLoftT(b, kit.shell, BP2, [[b1 - 0.02, 1.0], [b2 - 0.15 * k, 0.94], [b2, 0.8]], [bx - 0.25 * kx, 0]);
  b.box(kit.glass, 0.05, 0.1 * k, 0.75 * kz, bx + 0.1 * kx, b1 + 0.3 * k, 0, 0.01, [0, 0, -0.55]);
  armorPlate(b, kit, kit.armor2, frame([bx - 0.2 * kx, b2, 0], [0.15, 1, 0], [1, 0, 0]), rectP(0.75 * kx, 0.9 * kz, 0.08 * k), u, { standoff: u * 0.4 });
  b.box(kit.accent, 0.6 * kx, 0.05 * k, 0.1 * kz, bx - 0.25 * kx, b2 + 0.16 * k, 0, 0.01);
  latticeMast(b, kit, bx - 0.5 * kx, b2 + 0.12 * k, -0.25 * kz, 1.7 * k, 0.12 * k, 0.3);
  sensorDome(b, kit, bx - 0.05 * kx, b1 - 0.02, 0.62 * kz, 0.2 * k);
  searchlight(b, kit, bx + 0.25 * kx, b1 - 0.02, -0.45 * kz, -0.3, 0.14 * k, fine);
  banner(b, kit, bx - 0.85 * kx, b1 - 0.1, 0.55 * kz, 2.0 * k, 0.65 * k, 1);
  crewHatch(b, kit, frame([bx - 0.95 * kx, deckY, -0.7 * kz], [0, 1, 0]), 0.14 * k, fine);
  // exhaust stack on the left only; grilles either side of the bridge
  octStack(b, kit, -2.05 * kx, deckY - 0.05, -1.12 * kz, 0.14 * k, 0.75 * k, [0, 0, -1]);
  both((s) => recessPanel(b, kit, frame([-0.15 * kx, deckY, s * 1.05 * kz], [0, 1, 0]), 0.8 * kx, 0.42 * kz, 0.05 * k, { slats: 4 }));
  // ---- aft: faceted raised deck for the medium turret, two engine nacelles glowing astern, ammo lockers right
  const ax = -2.9 * kx, aTop = deckY + 0.28 * k;
  planLoftT(b, kit.armor2, ngonT(8, 0.75 * kx, 0.88 * kz), [[deckY - 0.02, 1.0], [aTop - 0.08 * k, 0.97], [aTop, 0.9]], [ax, 0]);
  for (const [dx, dy] of [[0, 0], [0.3, 0], [0.15, 0.2]]) stowBox(b, kit, frame([ax + (0.1 + dx) * kx, deckY + dy * k, 1.15 * kz], [0, 1, 0], [1, 0, 0]), 0.28 * kx, 0.2 * k, 0.28 * kz, kit.shell);
  both((s) => {
    const nz = s * 0.9 * kz, ny = yt + 0.45 * k;
    xPrism(b, kit.mech, 8, [[-3.4 * kx, 0.42 * k, 0.42 * k], [-3.55 * kx, 0.46 * k, 0.46 * k], [-3.7 * kx, 0.44 * k, 0.44 * k]], [ny, nz]);
    b.cyl(kit.hot, 0.3 * k, 0.26 * k, 0.04, [-3.7 * kx, ny, nz], '-x', 8);
    glowGrille(b, kit, -3.63 * kx, deckY - 0.1 * k, s * 0.3 * kz, 0.4 * kz, 0.3 * k, 2, -1);
  });
  // ---- side walkways along the deck edges with ladders down the flanks (crew scale)
  if (fine) {
    railLoop(b, kit, deckPoly.map(([x, z]) => [x * 0.97, z * 0.95] as P2), deckY + 0.28 * k, 0.5 * k, (x, z) => x > 2.4 * kx || x < -3.4 * kx || Math.abs(z) < 0.95 * kz && x > -2.2 * kx
      || c.mounts.some((m) => Math.hypot(m.x - x, m.z - z) < m.r * 1.5 + 0.3 * k), 0.018 * k, 0.26 * k);
    both((s) => {
      const f = wallFace(hp, s < 0 ? 2 : hp.length - 3, [yt + 0.26 * k, 1.0], [deckY, 0.93]);
      const a = f.c.clone().addScaledVector(f.v, -f.h * 0.5), e = f.c.clone().addScaledVector(f.v, f.h * 0.5);
      ladder(b, kit, [a.x, a.y - 0.25 * k, a.z], [e.x, e.y + 0.08 * k, e.z], 0.26 * k, [f.u.x, f.u.y, f.u.z], [f.n.x, f.n.y, f.n.z], 0.1 * k);
    });
  }
  // hips: biped legs under the hull's centre of mass (just behind the breech), hip housings on rams
  let hips: Hip[] | undefined;
  if (stance.legs === 'biped') {
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.3 * kx, stance.hipY, s * 1.15 * kz] as V3, side: s, t: stance.thick, foot: [-0.3 * kx, 0, s * 1.4 * kz] as V3, phase: s > 0 ? Math.PI : 0 }));
    both((s) => {
      planLoftT(b, kit.mech, [[0.5 * kx, 0.3 * kz], [-0.5 * kx, 0.3 * kz], [-0.5 * kx, -0.3 * kz], [0.5 * kx, -0.3 * kz]], [[y0 - 0.25 * k, 0.8], [y0 + 0.1 * k, 1.0], [y0 + 0.25 * k, 0.86]], [-0.3 * kx, s * 1.15 * kz]);
      for (const dx of [-0.4, 0.4]) piston(b, kit, [-0.3 * kx + dx * kx, y0 - 0.05 * k, s * 1.15 * kz], [-0.3 * kx + dx * 1.5 * kx, yt - 0.05, s * 1.05 * kz], 0.07 * k, 0.55, fine);
    });
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
        // breech barbette: a tall faceted armoured drum on the spine with its own glow band
        const R = m.r * 1.4, y = octBarbette(b, kit, m.x, spTop - 0.02, m.z, R, 0.34 * k, { mat: kit.armor });
        planLoftT(b, kit.glow, ngonT(8, R, R), [[spTop + 0.1 * k, 1.09], [spTop + 0.15 * k, 1.09]], [m.x, m.z]);
        collar(b, kit, m.x, y, m.z, m.r, y - 0.1, 16);
        return { y, socket: true };
      }
      const d = deck(m.x, m.z), base = d > 0 ? d : deckY;
      collar(b, kit, m.x, base + 0.12 * k, m.z, m.r, base - 0.02, 16);
      return { y: base + 0.12 * k, socket: true };
    },
  };
}

registerChassis('lance', lance);
