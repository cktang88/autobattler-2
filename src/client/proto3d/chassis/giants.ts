// Giant hulls (size 4). Each one has a strong plan shape that is NOT the footprint box:
//   (goliath lives in chassis/heavies.ts)
//   leviathan              land battleship: long hull with a raked prow and tapered stern, two big centreline turrets
//                          either side of a tall stepped bridge tower with a mast, sponson guns, funnel.
//   broodmother            matriarch spider: armoured cephalothorax + head with eye cluster, a huge segmented egg-sac
//                          abdomen with glowing pods, eight legs.
// Hard-surface pass (chassis/hs-kit.ts + hs-kit-organic.ts): every hull is a dark faceted core plated face by face with
// separate armour on shadow gaps (quadPlate over the loft faces), functional parts in named slots (smoke dischargers,
// caged lamps, ladders, handrails, tow hooks, stowage, mufflers, cranes), and 2-3 one-sided features per hull.

import { strutGeo, type MatLike, type P2, type V3 } from '../geo.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type Hip, type MountSpec } from './registry.ts';
import { beam, block, both, collar, exhaust, glow, hazard, pod, sensor, stationHull, stationTop } from './shapes.ts';
import { glowGrille, inPoly, mast, ngon, planLoft, reactor } from './giants-kit.ts';
import {
  armorPlate, cableBundle, cagedLamp, cupola, exhaustBox, fineFor, frame, frameLimb, handrail, inset, jointDrum, ladder, piston, plateStack,
  recessPanel, rectP, skirtRun, smokeLaunchers, stowBox, towHooks, trapP,
} from './hs-kit.ts';
import { archShell, boneFrame, claw, deckFrame, eyeCluster, limbShell, quadPlate, shingles, spike, stationQuads } from './hs-kit-organic.ts';

type St = [number, number, number, number, number, number][];

/** generic raised seat: armoured pedestal from `base` up to y + collar (for mounts that land off the designed spots) */
function pedestal(c: ChassisCtx, m: MountSpec, base: number, y: number): { y: number; socket: boolean } {
  const { b, kit } = c;
  if (y - base > 0.06) {
    // dark riser with an armour skirt band
    block(b, kit.mech, m.x, base - 0.02, m.z, m.r * 2.4, m.r * 2.4, y - base + 0.02, { top: [0.86, 0.86], ch: m.r * 0.6, bev: 0.03 });
    b.cylb(kit.armor2, m.r * 1.45, Math.min(0.12, (y - base) * 0.5), 0.015, [m.x, base + (y - base) * 0.2, m.z], 'y', 8);
  }
  collar(b, kit, m.x, y, m.z, m.r, y - 0.08, 18);
  return { y, socket: true };
}

// ---- LEVIATHAN -----------------------------------------------------------------------------------------------------
/** dark box core with armour plates on its four walls and a roof plate (bridge decks, funnels); returns the roof top */
function platedBox(c: ChassisCtx, x: number, y: number, z: number, l: number, w: number, h: number, mat: MatLike, t: number, roof: MatLike | null = mat): number {
  const { b, kit } = c;
  block(b, kit.mech, x, y, z, l, w, h, { top: [0.94, 0.94], ch: Math.min(l, w) * 0.12, bev: t * 0.3 });
  for (const s of [-1, 1]) {
    armorPlate(b, kit, mat, frame([x, y + h * 0.5, z + s * w * 0.5], [0, 0, s], [1, 0, 0]), rectP(l * 0.86, h * 0.7, t), t, { standoff: t * 0.4 });
    armorPlate(b, kit, s > 0 ? kit.armor2 : mat, frame([x + s * l * 0.5, y + h * 0.5, z], [s, 0, 0], [0, 0, 1]), rectP(w * 0.8, h * 0.7, t), t, { standoff: t * 0.4 });
  }
  return roof ? y + h + armorPlate(b, kit, roof, frame([x, y + h, z], [0, 1, 0], [1, 0, 0]), rectP(l * 0.92, w * 0.92, l * 0.1), t, { standoff: t * 0.3 }) : y + h;
}

function leviathan(c: ChassisCtx): ChassisOut {
  // Land battleship (hard-surface): a dark faceted keel and ship hull plated face by face (deck plates, sheer-strake
  // plates, a belt of wall plates with a glow line), a steel ram on the stem, two superfiring barbettes (dark drums with
  // armour bands) for the big guns, a stepped bridge tower of plated decks (vision band, bridge wings with searchlights,
  // a lattice mast with a radar yard, a dish), a plated funnel with a hot cap, sponson blisters for the medium guns.
  // Functional slots: deck-edge handrails, a ladder up the tower, smoke dischargers on the bow, stowage lockers, tow
  // hooks at the stern, a muffler box on the aft deck. Asymmetric: a deck crane aft on the left, the radar dish on the
  // right of the bridge roof, the ladder on the left of the tower.
  const { b, kit, L, W, stance } = c;
  const kx = L / 6, kz = W / 3, k = Math.min(kx, kz), v = Math.min(1.1, (kx + kz) / 2);
  const fine = fineFor(c.S);
  const legged = stance.legs !== null;
  const y0 = stance.y0, yt = legged ? y0 + 0.3 : Math.max(stance.yt, y0 + 0.3);
  const wi = Math.min(stance.wi, 0.95 * kz);
  stationHull(b, kit.mech, [
    [-2.7 * kx, wi * 0.7, y0 + 0.1, yt - 0.05, yt + 0.05, 0.9],
    [-2.3 * kx, wi, y0, yt - 0.05, yt + 0.05, 0.95],
    [2.2 * kx, wi, y0, yt - 0.05, yt + 0.05, 0.95],
    [2.75 * kx, wi * 0.5, y0 + 0.2, yt - 0.05, yt + 0.05, 0.9],
  ], 0, 0.8);
  // ship hull: square-ish stern, widest at the sponsons, long fine bow rising (sheer) to a raked stem
  const st: St = [
    [-2.95 * kx, 0.8 * kz, yt - 0.05, yt + 0.12 * v, yt + 0.42 * v, 0.84],
    [-2.3 * kx, 1.08 * kz, yt - 0.1, yt + 0.14 * v, yt + 0.46 * v, 0.88],
    [-0.4 * kx, 1.25 * kz, yt - 0.12, yt + 0.18 * v, yt + 0.5 * v, 0.88],
    [1.0 * kx, 1.18 * kz, yt - 0.12, yt + 0.2 * v, yt + 0.56 * v, 0.86],
    [2.3 * kx, 0.8 * kz, yt - 0.08, yt + 0.3 * v, yt + 0.78 * v, 0.8],
    [3.2 * kx, 0.12 * kz, yt + 0.25, yt + 0.62 * v, yt + 1.02 * v, 0.6],
  ];
  stationHull(b, kit.mech, st, 0, 0.8);
  const deck0 = (x: number, z: number) => stationTop(st, x, z);
  const pt = 0.06 * k, so = 0.03 * k, PH = pt + so;
  const deck = (x: number, z: number) => { const d = deck0(x, z); return d > 0 ? d + PH : d; };
  // plating: deck plates in two strakes, sheer strakes on the shoulders, wall belt
  for (let i = 0; i < st.length - 1; i++) {
    const q = stationQuads(st, i);
    const bow = i === st.length - 2;
    if (!bow) {
      const [a0, a1, a2, a3] = q.top;
      const m0: V3 = [(a0[0] + a3[0]) / 2, a0[1], (a0[2] + a3[2]) / 2], m1: V3 = [(a1[0] + a2[0]) / 2, a1[1], (a1[2] + a2[2]) / 2];
      quadPlate(b, kit, kit.armor2, [a0, a1, m1, m0], pt, [0, 1, 0], { margin: 0.05 * k, standoff: so });
      quadPlate(b, kit, kit.armor2, [m0, m1, a2, a3], pt, [0, 1, 0], { margin: 0.05 * k, standoff: so });
    } else quadPlate(b, kit, kit.armor, q.top, pt, [0, 1, 0], { margin: 0.03 * k, standoff: so });
    for (const s of [0, 1]) {
      const sg = s ? 1 : -1;
      quadPlate(b, kit, kit.armor, q.sh[s], pt, [0, 1, sg], { margin: 0.05 * k, standoff: so });
      quadPlate(b, kit, i % 2 ? kit.shell : kit.armor, q.wall[s], pt * 1.2, [0, 0, sg], { margin: 0.04 * k, standoff: so });
    }
  }
  // steel ram along the stem, hazard chevrons on the foredeck, bow smoke dischargers
  beam(b, kit.steel, [2.3 * kx, yt - 0.1, 0], [3.3 * kx, yt + 0.3, 0], 0.12 * k, 0.3 * v);
  hazard(b, kit, 2.45 * kx, deck(2.45 * kx, 0) + 0.005, 0, 0.6 * kz, 0.22 * kx, 4, Math.PI / 2);
  both((s) => smokeLaunchers(b, kit, frame([2.2 * kx, deck(2.2 * kx, s * 0.5 * kz), s * 0.5 * kz], [0, 1, 0], [Math.cos(0.4), 0, s * Math.sin(0.4)]), 3, 0.045 * k));
  // armour belt glow line
  both((s) => glow(b, kit, -0.2 * kx, yt + 0.32 * v, s * 1.27 * kz, 3.6 * kx, 0.04, 0.04));
  // superfiring barbettes for the two big guns: dark drum, armour band, a dark ring at the top
  const fwdX = 1.62 * kx, aftX = -1.68 * kx;
  const bar = (x: number, h: number) => {
    const y = deck(x, 0) - 0.04;
    b.lathe(kit.mech, [[0, 0], [0.6 * k, 0], [0.56 * k, h], [0, h]], [x, y, 0], 'y', 14);
    b.lathe(kit.armor, [[0.58 * k, h * 0.12], [0.66 * k, h * 0.16], [0.64 * k, h * 0.8], [0.58 * k, h * 0.86]], [x, y, 0], 'y', 14);
    return y + h;
  };
  const fwdY = bar(fwdX, 0.3 * v), aftY = bar(aftX, 0.42 * v);
  // bridge tower: stepped plated decks between the big guns, glass band, wings with searchlights, mast, radar
  const bx = -0.2 * kx, d0 = deck(bx, 0);
  const t1 = platedBox(c, bx, d0 - 0.04, 0, 1.5 * kx, 0.95 * kz, 0.75 * v, kit.armor, 0.05 * k, kit.armor2);
  const t2 = platedBox(c, bx - 0.05 * kx, t1, 0, 1.05 * kx, 0.78 * kz, 0.62 * v, kit.shell, 0.04 * k, null);
  const t3 = platedBox(c, bx + 0.05 * kx, t2, 0, 0.8 * kx, 0.92 * kz, 0.46 * v, kit.armor, 0.04 * k);
  b.box(kit.glass, 0.05, 0.1 * v, 0.8 * kz, bx + 0.44 * kx, t2 + 0.22 * v, 0, 0.01, [0, 0, -0.5]);
  glow(b, kit, bx + 0.46 * kx, t2 + 0.08 * v, 0, 0.04, 0.04, 0.74 * kz, [0, 0, -0.5]);
  both((s) => {
    platedBox(c, bx + 0.25 * kx, t2 + 0.06 * v, s * 0.66 * kz, 0.4 * kx, 0.4 * kz, 0.14 * v, kit.armor2, 0.025 * k);
    cagedLamp(b, kit, frame([bx + 0.35 * kx, t2 + 0.24 * v, s * 0.74 * kz], [0, 1, 0], [1, 0, s * 0.3]), 0.12 * k, fine);
  });
  mast(b, kit, bx - 0.1 * kx, t3, 0, 1.7 * v, 0.05);
  b.box(kit.joint, 0.06, 0.06, 1.1 * kz, bx - 0.1 * kx, t3 + 1.1 * v, 0, 0.01);
  b.box(kit.joint, 0.05, 0.05, 0.7 * kz, bx - 0.1 * kx, t3 + 1.4 * v, 0, 0.01);
  b.lathe(kit.shell, [[0, 0], [0.3 * k, 0.1 * k], [0.34 * k, 0.16 * k], [0, 0.05 * k]], [bx + 0.15 * kx, t3 + 0.25 * v, 0.25 * kz], 'y', 10, [0, 0, 0.6]);
  b.cyl(kit.joint, 0.04, 0.04, 0.25 * v, [bx + 0.15 * kx, t3, 0.25 * kz], 'y', 6);
  sensor(b, kit, bx + 0.1 * kx, t3 + 0.08 * v, -0.2 * kz, 0.2 * k);
  ladder(b, kit, [bx - 0.4 * kx, d0, -0.5 * kz], [bx - 0.4 * kx, t1, -0.5 * kz], 0.24 * k, [1, 0, 0], [0, 0, -1], 0.04 * k);
  if (fine) handrail(b, kit, [[bx - 0.6 * kx, t1 + 0.12 * k, -0.42 * kz], [bx + 0.6 * kx, t1 + 0.12 * k, -0.42 * kz]], 0.012 * k, 0.12 * k);
  // plated funnel with a hot cap behind the bridge
  const fx = -0.95 * kx, fy = deck(fx, 0);
  platedBox(c, fx - 0.06 * kx, fy - 0.03, 0, 0.66 * kx, 0.6 * kz, 1.2 * v, kit.armor2, 0.035 * k, null);
  b.box(kit.mech, 0.5 * kx, 0.06, 0.46 * kz, fx - 0.06 * kx, fy + 1.2 * v, 0, 0.01);
  b.box(kit.hot, 0.38 * kx, 0.03, 0.34 * kz, fx - 0.06 * kx, fy + 1.24 * v, 0, 0.01);
  b.box(kit.accent, 0.7 * kx, 0.1 * v, 0.64 * kz, fx - 0.06 * kx, fy + 0.95 * v, 0, 0.01);
  // aft deck: louvred grilles, muffler (right), deck crane (left), stowage, flag pole, tow hooks
  both((s) => recessPanel(b, kit, deckFrame(deck, -2.5 * kx, s * 0.55 * kz, [1, 0, 0]), 0.5 * kx, 0.38 * kz, 0.05 * k, { slats: 4 }));
  exhaustBox(b, kit, frame([-2.1 * kx, deck(-2.1 * kx, 0.8 * kz), 0.8 * kz], [0, 1, 0], [-1, 0, 0]), 0.09 * k, fine);
  {
    const cb: V3 = [-2.2 * kx, deck(-2.2 * kx, -0.75 * kz), -0.75 * kz];
    b.cylb(kit.joint, 0.12 * k, 0.12 * k, 0.02 * k, cb, 'y', 8);
    const jib: V3 = [cb[0] + 0.7 * kx, cb[1] + 0.9 * v, cb[2] + 0.1 * kz];
    frameLimb(b, kit, [cb[0], cb[1] + 0.12 * k, cb[2]], jib, 0.03 * k, [0, 0, 0.06 * k]);
    piston(b, kit, [cb[0] + 0.1 * kx, cb[1] + 0.12 * k, cb[2]], [cb[0] + 0.4 * kx, cb[1] + 0.55 * v, cb[2] + 0.05 * kz], 0.03 * k, 0.55, fine);
    b.g(strutGeo(jib, [jib[0], jib[1] - 0.5 * v, jib[2]], 0.008 * k, 0.008 * k, 4), kit.steel);
    b.box(kit.hazard, 0.08 * k, 0.1 * k, 0.08 * k, jib[0], jib[1] - 0.55 * v, jib[2], 0.01);
  }
  stowBox(b, kit, frame([0.55 * kx, deck(0.55 * kx, -0.8 * kz), -0.8 * kz], [0, 1, 0], [1, 0, 0]), 0.6 * kx, 0.12 * k, 0.24 * kz);
  b.cyl(kit.steel, 0.02, 0.015, 0.6 * v, [-2.85 * kx, deck(-2.85 * kx, 0), 0], 'y', 5);
  towHooks(b, kit, frame([-2.97 * kx, yt + 0.2 * v, 0], [-1, 0, 0], [0, 0, 1]), 0.6 * kz, 0.06 * k);
  // deck-edge handrails along the waist
  if (fine) both((s) => handrail(b, kit, [-2.0, -1.2, 0.2, 1.0].map((x) => [x * kx, deck(x * kx, s * 0.95 * kz) + 0.12 * k, s * 0.95 * kz] as V3), 0.012 * k, 0.12 * k));
  let hips: Hip[] | undefined;
  if (stance.legs === 'biped') {
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.1 * kx, stance.hipY, s * 0.95 * kz] as V3, side: s, t: stance.thick, foot: [-0.1 * kx, 0, s * 1.1 * kz] as V3, phase: s > 0 ? Math.PI : 0 }));
  }
  return {
    deckAt: deck, top: t3, custom: true, dressed: true, hips,
    seat: (m: MountSpec) => {
      if (Math.abs(m.z) < 0.3 * kz && Math.abs(m.x - fwdX) < 0.4 * kx) { collar(b, kit, m.x, fwdY, m.z, m.r, fwdY - 0.06, 20); return { y: fwdY, socket: true }; }
      if (Math.abs(m.z) < 0.3 * kz && Math.abs(m.x - aftX) < 0.4 * kx) { collar(b, kit, m.x, aftY, m.z, m.r, aftY - 0.06, 20); return { y: aftY, socket: true }; }
      const d = deck(m.x, m.z);
      if (Math.abs(m.z) > 0.6 * kz) {
        // sponson: a faceted blister on the flank (dark core, armour band)
        const s = Math.sign(m.z), y = Math.max(d, yt + 0.4 * v) + 0.12;
        b.lathe(kit.mech, [[0, 0], [m.r * 1.3, 0], [m.r * 1.25, y - yt - 0.15], [m.r * 1.12, y - yt], [0, y - yt]], [m.x, yt, m.z + s * 0.05], 'y', 12);
        b.lathe(kit.armor, [[m.r * 1.28, (y - yt) * 0.15], [m.r * 1.42, (y - yt) * 0.2], [m.r * 1.36, (y - yt) * 0.78], [m.r * 1.2, (y - yt) * 0.86]], [m.x, yt, m.z + s * 0.05], 'y', 12);
        collar(b, kit, m.x, y, m.z, m.r, y - 0.06, 18);
        return { y, socket: true };
      }
      return pedestal(c, m, d > 0 ? d : yt, (d > 0 ? d : yt) + 0.14);
    },
  };
}
registerChassis('leviathan', leviathan);

// ---- BROODMOTHER ---------------------------------------------------------------------------------------------------
function broodmother(c: ChassisCtx): ChassisOut {
  // Matriarch spider, a walking fortress built like a machine-creature (chassis/hs-kit-organic.ts): an octagonal
  // cephalothorax (dark core) under a carapace of separate chitin plates (eight wall plates, eight roof sectors stepping
  // up to a dorsal cap, gaps between them showing the core), a head with a faceted brow shell, a six-lens eye cluster and
  // hooked chelicerae on rams, a pedicel joint drum carrying sinew cables back to a huge abdomen of shingled carapace
  // bands with glowing brood pods in dark cups along the flanks and spinnerets at the tail, eight legs from armoured coxa
  // housings. Asymmetric: a sensor mast on the left of the carapace, a vent stack on the right of the abdomen, a crew
  // ladder up the right coxa.
  const { b, kit, L, W, stance } = c;
  // authored for the 5 (long) x 7 (wide) footprint; art box ~3.75 x 4.9 holds the body, legs splay to the footprint
  const kx = L / 5 * 1.12, kz = W / 7 * 1.12, k = Math.min(kx, kz);
  const fine = fineFor(c.S);
  const spider = stance.legs === 'spider';
  const by = spider ? stance.hipY * 1.3 : stance.legs === 'biped' ? stance.hipY + 0.1 : Math.max(stance.yt, 0.5) + 0.55 * k;
  if (!spider && stance.legs !== 'biped') {
    // anchored: squat dark plinth under the body with an armour ring
    planLoft(b, kit.mech, ngon(8, 1.5 * kx, 1.5 * kz), [[0, 1.1], [by - 0.3, 1.0], [by, 0.85]], [-0.3 * kx, 0]);
    planLoft(b, kit.armor2, ngon(8, 1.5 * kx, 1.5 * kz), [[0.05, 1.16], [0.35, 1.12]], [-0.3 * kx, 0]);
  }
  // ---- cephalothorax: dark core + chitin carapace plates
  const cx = 0.0, cp = ngon(8, 1.15 * kx, 1.45 * kz, Math.PI / 8);
  const cy0 = by - 0.45 * k, cW0 = by + 0.08 * k, cW1 = by + 0.3 * k, cR = by + 0.5 * k, cTop = by + 0.62 * k;
  planLoft(b, kit.mech, cp, [[cy0, 0.7], [by - 0.1 * k, 0.95], [cW0, 0.98], [cW1, 0.98], [cR, 0.78], [cTop - 0.06 * k, 0.56]], [cx, 0]);
  const ring = (y: number, s: number): V3[] => cp.map(([px, pz]) => [cx + px * s, y, pz * s] as V3);
  const rL = ring(by - 0.1 * k, 0.95), rW0 = ring(cW0, 0.98), rW1 = ring(cW1, 0.98), rR = ring(cR, 0.78), rT = ring(cTop - 0.06 * k, 0.56);
  const pt = 0.07 * k, so = 0.035 * k;
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    const mx = (cp[i][0] + cp[j][0]) / 2, mz = (cp[i][1] + cp[j][1]) / 2;
    quadPlate(b, kit, i % 2 ? kit.armor2 : kit.armor, [rL[i], rL[j], rW1[j], rW1[i]], pt, [mx, 0, mz], { margin: 0.06 * k, standoff: so });
    quadPlate(b, kit, i % 2 ? kit.armor : kit.armor2, [rW1[i], rW1[j], rR[j], rR[i]], pt, [mx, 0.6, mz], { margin: 0.06 * k, standoff: so });
    quadPlate(b, kit, kit.shell, [rR[i], rR[j], rT[j], rT[i]], pt * 0.8, [mx, 1.4, mz], { margin: 0.07 * k, standoff: so });
  }
  void rW0;
  // dorsal cap plate (the giant gun turns on it)
  armorPlate(b, kit, kit.armor, frame([cx, cTop - 0.06 * k, 0], [0, 1, 0], [1, 0, 0]), inset(cp.map(([px, pz]) => [px * 0.56, pz * 0.56] as P2), 0.05 * k), 0.05 * k, { standoff: 0.02 * k });
  const capY = cTop + 0.01 * k;
  // ---- head: dark core, faceted brow shell, eye cluster, chelicerae on rams, mandibles
  const hx = 1.3 * kx, hy = by + 0.05 * k;
  block(b, kit.mech, hx - 0.05 * kx, hy - 0.3 * k, 0, 0.9 * kx, 1.0 * kz, 0.56 * k, { top: [0.7, 0.8], shift: [0.08 * kx, 0], ch: 0.2 * k, bev: 0.04 * k });
  archShell(b, kit.armor, { x: hx, len: 1.0 * kx, y0: hy + 0.06 * k, w: 0.6 * kz, h: 0.22 * k, thick: 0.07 * k, cols: 5, pw: 2.4, taperF: 0.7, taperB: 1.0, lift: 0.08 * k, drop: 0.18 * k });
  eyeCluster(b, kit, frame([hx + 0.42 * kx, hy + 0.02 * k, 0], [0, 1, 0], [1, 0, 0]),
    [[0.13 * kz, 0.1 * k, 0.07 * k], [-0.13 * kz, 0.1 * k, 0.07 * k], [0.3 * kz, 0.2 * k, 0.05 * k], [-0.3 * kz, 0.2 * k, 0.05 * k], [0.34 * kz, -0.04 * k, 0.045 * k], [-0.34 * kz, -0.04 * k, 0.045 * k]]);
  both((s) => {
    const a: V3 = [hx + 0.35 * kx, hy - 0.18 * k, s * 0.3 * kz], kn: V3 = [hx + 0.85 * kx, hy - 0.45 * k, s * 0.4 * kz], tip: V3 = [hx + 1.0 * kx, hy - 0.88 * k, s * 0.2 * kz];
    b.g(strutGeo(a, kn, 0.11 * k, 0.09 * k, 6), kit.mech);
    limbShell(b, kit.armor2, 0.05 * k, 0.5 * k, 0.12 * k, 0.06 * k, 0.07 * k, 0.04 * k, { m: boneFrame(a, kn, [0, 1, 0]), tp: 0.8 });
    claw(b, kit.joint, kn, [kn[0] + 0.15 * kx, kn[1] - 0.2 * k, kn[2] - s * 0.05 * kz], tip, 0.09 * k);
    piston(b, kit, [hx + 0.1 * kx, hy - 0.05 * k, s * 0.2 * kz], [kn[0] - 0.1 * kx, kn[1] + 0.06 * k, kn[2] - s * 0.04 * kz], 0.045 * k, 0.55, fine);
  });
  // ---- pedicel: joint drum + sinew cables to the abdomen
  jointDrum(b, kit, [-0.95 * kx, by + 0.12 * k, 0], 0.34 * k, 0.8 * kz, 'z');
  both((s) => cableBundle(b, kit, [-0.7 * kx, by + 0.3 * k, s * 0.3 * kz], [-1.1 * kx, by + 0.36 * k, s * 0.42 * kz], 0.05 * k, [0, 1, 0], fine ? 2 : 1, 0.08));
  // ---- abdomen: dark core, shingled carapace bands, brood pods in dark cups, spinnerets
  const ax = -1.55 * kx, ay = by + 0.42 * k;
  pod(b, kit.mech, [ax, ay - 0.1 * k, 0], 1.0 * kx, 0.7 * k, 1.12 * kz, 10, 6, 2.2, 0.2);
  shingles(b, [kit.armor, kit.armor2], ax + 0.95 * kx, ax - 1.05 * kx, 4, 0.07 * k,
    (f) => { const e = Math.sin((0.15 + f * 0.8) * Math.PI); return [1.18 * kz * (0.7 + 0.32 * e), 0.42 * k * (0.6 + 0.4 * e), ay - 0.02 * k + 0.12 * k * e]; },
    { cols: 6, pw: 2.2, drop: 0.32 * k, lift: 0.09 * k, overlap: 0.18 });
  both((s) => {
    for (let i = 0; i < 3; i++) {
      const x = ax + (0.5 - i * 0.5) * kx, zz = s * 1.12 * kz * (1 - Math.abs(i - 1) * 0.14);
      b.cyl(kit.mech, 0.17 * k, 0.21 * k, 0.12 * k, [x, ay - 0.22 * k, zz], s > 0 ? 'z' : '-z', 6);
      pod(b, kit.glow, [x, ay - 0.22 * k, zz + s * 0.06 * kz], 0.13 * kx, 0.13 * k, 0.09 * kz, 6, 3, 2.2);
    }
  });
  for (const dz of [-0.16, 0, 0.16]) spike(b, dz ? kit.joint : kit.armor2, [ax - 0.95 * kx, ay - 0.1 * k, dz * kz], [ax - 1.25 * kx, ay - 0.28 * k, dz * 1.5 * kz], 0.07 * k);
  glow(b, kit, ax - 1.02 * kx, ay - 0.08 * k, 0, 0.05, 0.12 * k, 0.3 * kz);
  const abTop = ay + 0.7 * k;
  // asymmetric kit: sensor mast on the left of the carapace, vent stack on the right of the abdomen
  mast(b, kit, -0.35 * kx, cR - 0.04 * k, -0.95 * kz, 1.1 * k, 0.035);
  exhaust(b, kit, ax + 0.3 * kx, ay + 0.3 * k, 0.75 * kz, 0.09 * k, 0.5 * k, 0.3);
  // ---- hips: 8 legs from heavy coxa housings around the cephalothorax, alternating tetrapod gait
  let hips: Hip[] | undefined;
  if (spider) {
    hips = [];
    const rows: [number, number, number][] = [[0.75, 2.05, 2.55], [0.25, 0.75, 3.05], [-0.25, -0.65, 3.05], [-0.7, -1.9, 2.6]];
    rows.forEach(([hxr, fx, fz], i) => {
      for (const s of [-1, 1] as const) {
        const p: V3 = [hxr * kx, by, s * 1.12 * kz];
        hips!.push({ p, side: s, t: stance.thick * 0.92, foot: [fx * kx, 0, s * fz * kz], phase: ((i % 2) ^ (s > 0 ? 1 : 0)) ? Math.PI : 0 });
        block(b, kit.mech, p[0], by - 0.3 * k, s * 1.0 * kz, 0.4 * k, 0.4 * k, 0.5 * k, { top: [0.8, 0.8], ch: 0.08 * k });
        armorPlate(b, kit, kit.armor2, frame([p[0], by + 0.2 * k, s * 1.08 * kz], [0, 1, s * 0.5], [1, 0, 0]), rectP(0.46 * k, 0.36 * k, 0.08 * k), 0.05 * k, { standoff: 0.02 * k });
      }
    });
    if (fine) ladder(b, kit, [0.0, 0.1, 1.32 * kz], [0.0, by + 0.25 * k, 1.2 * kz], 0.26 * k, [1, 0, 0], [0, 0, 1], 0.05 * k);
  } else if (stance.legs === 'biped') {
    hips = ([-1, 1] as const).map((s) => ({ p: [-0.1 * kx, stance.hipY, s * 1.1 * kz] as V3, side: s, t: stance.thick, foot: [-0.1 * kx, 0, s * 1.3 * kz] as V3, phase: s > 0 ? Math.PI : 0 }));
  }
  const deck = (x: number, z: number) => (inPoly(cp.map(([px, pz]) => [px * 0.6 + cx, pz * 0.6] as P2), x, z) ? capY : -1);
  return {
    deckAt: deck, top: Math.max(capY, abTop), custom: true, dressed: true, hips,
    seat: (m: MountSpec) => {
      if (m.x > 0.9 * kx) {
        // head turret between the eyes, on the brow shell
        const y = hy + 0.36 * k;
        collar(b, kit, m.x, y, m.z, m.r, hy, 16);
        return { y, socket: true };
      }
      if (m.x < -1.0 * kx) {
        const y = ay + 0.76 * k * Math.sqrt(Math.max(0.1, 1 - ((m.x - ax) / (1.05 * kx)) ** 2)) + 0.04;
        collar(b, kit, m.x, y, m.z, m.r, y - 0.24, 16);
        return { y, socket: true };
      }
      if (Math.abs(m.z) > 0.8 * kz) {
        // flank guns on armoured shoulder humps: dark core, armour cap
        const y = by + 0.5 * k;
        block(b, kit.mech, m.x, by, m.z, m.r * 2.5, m.r * 2.3, y - by - 0.06 * k, { top: [0.8, 0.8], ch: m.r * 0.5, bev: 0.04 });
        armorPlate(b, kit, kit.armor, frame([m.x, y - 0.06 * k, m.z], [0, 1, 0], [1, 0, 0]), rectP(m.r * 2.4, m.r * 2.2, m.r * 0.5), 0.04 * k, { standoff: 0.01 * k });
        collar(b, kit, m.x, y, m.z, m.r, y - 0.08, 16);
        return { y, socket: true };
      }
      const y = capY + 0.04;
      collar(b, kit, m.x, y, m.z, m.r, capY - 0.2, 20);
      return { y, socket: true };
    },
  };
}
registerChassis('broodmother', broodmother);
void reactor; void glowGrille;

