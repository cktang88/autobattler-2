// Giant and titan bombers (size 4-5 aircraft): each one is its own airframe, not a stretched strato bomber. Built from
// the aero kit (chassis/aero-kit.ts) with the jets' paint plan: light-grey shell on fuselage and wings, muted team
// armour on the tail surfaces, wingtips and nacelle bands, near-black mechanics at intakes / bays / seams, full-chroma
// accent only on small top-surface stripes, chevrons and roundels.
//
//   strategic      size 4 jet: long slender faceted fuselage, shoulder wings swept to the tips with a slight droop,
//                  four twin-engine pods slung ahead of the leading edge (eight exhausts), a tall swept fin, a long
//                  belly bay with its doors hanging open, glazed chin and tail gun blisters
//   superfortress  size 5 jet: a vast straight tapered wing, a fat fuselage with a framed greenhouse nose and a
//                  stepped flight deck, six pusher nacelles burning out of the trailing edge plus twin jet pods
//                  outboard, an H-tail; belly and wing-root bays, waist gun blisters on top of the wing
//   dreadnought    size 5 grav airship: twin rib-framed gasbags with cruciform tail fins and big rear ducted
//                  propulsors, an armoured keel between them carrying the bow gun, a bridge castle and the bays (bombs
//                  drop from under the keel, guns ride the deck), gun blisters on top of the bags, grav pods under both
//
// Bombs (resupply weapons) always hang from the belly / keel at their mount point; defensive guns sit in blisters
// (collars) where the mount table puts them. Frame and conventions as chassis/air.ts.

import { atlasUV } from '../materials.ts';
import type { V3 } from '../geo.ts';
import { registerChassis, type ChassisCtx, type MountSpec, type Seat } from './registry.ts';
import { collar, stationHull } from './shapes.ts';
import { type AirOut, type Lift } from '../mobility/air.ts';
import { at, hang, load, out, over } from './air.ts';
import {
  Fuse, SEC_BOX, SEC_ROUND, aeroFin, aeroWing, bladeAntenna, bx, canopy, fuselage, gearDoors, mirrorSt, nacelle, overSkin,
  panelBreak, pitot, ribbon, sides, skinPanel, soot, spinePanel, type Station,
} from './aero-kit.ts';

/** open bomb-bay doors hanging down both sides of a bay slot (x0..x1 along the belly at height y, half width w) */
function bayDoors(c: ChassisCtx, x0: number, x1: number, y: number, w: number, z = 0): void {
  const { b, kit } = c;
  const l = Math.abs(x1 - x0), x = (x0 + x1) / 2, d = w * 1.1;
  b.box(kit.mech, l, 0.03, w * 2, x, y + 0.012, z, 0.008); // dark bay well
  for (const s of [-1, 1]) {
    b.box(kit.shell, l * 0.96, 0.016, d, x, y - d * 0.42, z + s * (w + d * 0.12), 0.004, [s * 1.15, 0, 0]);
    // door actuator arms
    for (const f of [-0.3, 0.3]) b.strut(kit.joint, [x + f * l, y, z + s * w * 0.8], [x + f * l, y - d * 0.55, z + s * (w + d * 0.2)], 0.008, 0.008, 4);
  }
}

/** glazed gun blister: a glass dome with a framed ring and frame bows, opening up (dir 1) or down (dir -1) */
function blister(c: ChassisCtx, x: number, y: number, z: number, r: number, dir: 1 | -1): void {
  const { b, kit } = c;
  b.lathe(kit.glass, [[0, 0], [r, 0], [r * 0.92, r * 0.42 * dir], [r * 0.6, r * 0.75 * dir], [0, r * 0.85 * dir]], [x, y, z], 'y', 12);
  b.cylb(kit.mech, r * 1.08, r * 0.14, r * 0.04, [x, y - r * 0.07, z], 'y', 12);
  for (const a of [0, Math.PI / 2]) bx(b, kit.shell, r * 1.7 * Math.abs(Math.cos(a)) + r * 0.05, r * 0.05, r * 1.7 * Math.abs(Math.sin(a)) + r * 0.05, x, y + r * 0.82 * dir, z);
}

// =====================================================================================================================
function strategic(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.16;
  const F = new Fuse([
    [2.42, cy + 0.0, 0.03, 0.03], [2.3, cy + 0.01, 0.13, 0.12], [2.05, cy + 0.04, 0.24, 0.21], [1.6, cy + 0.06, 0.3, 0.25], [0.5, cy + 0.08, 0.32, 0.26],
    [-0.8, cy + 0.08, 0.3, 0.25], [-1.7, cy + 0.12, 0.21, 0.17], [-2.2, cy + 0.16, 0.12, 0.1], [-2.42, cy + 0.17, 0.05, 0.05],
  ], 0, SEC_ROUND);
  fuselage(b, kit.shell, F);
  overSkin(b, kit.armor2, F, 2.42, 2.22, 0.004);
  for (const x of [2.15, 1.3, 0.6, -0.1, -0.9, -1.6, -2.1]) panelBreak(b, kit, F, x, 0.016);
  // stepped cockpit glazing, spine walkway with a team stripe, antennas
  canopy(b, kit, 2.06, 1.62, F.top(1.85) - 0.05, 0.19, 0.12, { bows: 2, rake: 0.42 });
  pitot(b, kit, 2.36, cy + 0.04, 0.08, 0.16, 0.006);
  ribbon(b, kit.mech, F.xs(1.3, -1.5).map((x) => [x, F.top(x) + 0.003, 0] as V3), 0.05, 0.05, 0.004);
  ribbon(b, kit.accent, F.xs(-1.55, -1.75).map((x) => [x, F.top(x) + 0.003, 0] as V3), 0.12, 0.1, 0.004);
  bladeAntenna(b, kit, 0.9, F.top(0.9), 0, 0.1);
  bladeAntenna(b, kit, -0.5, F.bot(-0.5), 0.12, 0.08, true);
  // shoulder wing, swept to the tips with a slight droop, tip pods on the end
  const ws: Station[] = [[1.0, cy + 0.22, 0.2, 1.45, 0.16], [0.12, cy + 0.2, 1.4, 0.92, 0.1], [-0.84, cy + 0.12, 2.95, 0.42, 0.045]];
  const lift: Lift[] = [];
  for (const s of [-1, 1] as const) {
    aeroWing(b, kit, mirrorSt(ws, s), { tip: 2.6, slat: [0.45, 2.85], flaps: [[0.3, 1.2], [1.3, 2.05], [2.15, 2.8]], stripe: [2.32, 2.45], walk: 1.0 });
    { const t = at(ws, 2.92); const P = new Fuse([[t[0] + 0.05, t[1] - 0.02, 0.02, 0.02], [t[0] - 0.05, t[1] - 0.02, 0.05, 0.05], [t[0] - 0.5, t[1] - 0.02, 0.045, 0.045], [t[0] - 0.58, t[1] - 0.02, 0.02, 0.02]], s * 2.94, SEC_ROUND); fuselage(b, kit.armor, P); }
    { const t = at(ws, 2.92); bx(b, s < 0 ? kit.accent : kit.glow, 0.05, 0.03, 0.03, t[0] + 0.04, t[1] - 0.02, s * 2.94); }
    // twin-engine pods hung on pylons ahead of the leading edge
    for (const z of [1.1, 1.98]) {
      const [lex, wy] = at(ws, z);
      const ny = wy - 0.24, nx = lex - 0.06;
      skinPylon(c, nx + 0.1, wy - 0.02, ny + 0.06, s * z, 0.62, 0.04);
      for (const d of [-0.11, 0.11]) {
        const zz = s * z + d;
        const N = nacelle(b, kit, nx + 0.48, nx - 0.46, ny, zz, 0.09);
        soot(b, kit, N, nx - 0.3, nx - 0.46, zz, 0.03);
        lift.push({ kind: 'jet', p: [nx - 0.5, ny, zz], r: 0.07, len: 0.11 });
      }
    }
    // tailplane with elevators
    aeroWing(b, kit, mirrorSt([[-1.82, cy + 0.2, 0.08, 0.52, 0.05], [-2.22, cy + 0.2, 0.88, 0.22, 0.025]], s), { tip: 0.7, flaps: [[0.15, 0.82]] });
  }
  // tall swept fin with rudder, team band and a beacon
  aeroFin(b, kit, [[-1.5, cy + 0.3, 0, 0.92, 0.07], [-2.16, cy + 1.28, 0, 0.42, 0.035]], { rudder: [0.06, 0.94], band: [0.62, 0.8], beacon: 0.04 });
  // long belly bay with its doors hanging open, glazed chin and tail blisters, nose-gear doors
  bayDoors(c, 1.42, -1.5, F.bot(0) + 0.01, 0.15);
  gearDoors(b, kit, 1.8, F.bot(1.8) + 0.004, 0, 0.3, 0.14);
  blister(c, 2.02, F.bot(2.02) + 0.04, 0, 0.12, -1);
  blister(c, -2.26, F.bot(-2.26) + 0.03, 0, 0.09, -1);
  bx(b, kit.lamp, 0.03, 0.03, 0.08, 2.4, cy + 0.02, 0);
  b.decal(0.42, 0.42, -0.2, over(ws, 1.6) + 0.006, 1.6, atlasUV(3), 0);
  b.decal(0.42, 0.42, -0.2, over(ws, 1.6) + 0.006, -1.6, atlasUV(3), 0);
  b.decal(0.3, 0.3, 1.3, F.top(1.3) + 0.008, 0, atlasUV(1), 0);
  return out(cy + 1.3, lift, (m) => {
    if (m.mod.resupply) return hang(c, m, F.bot(m.x) + 0.02, 0.55);
    return hang(c, m, F.bot(m.x) - 0.06, 0.45); // defensive guns under their glazed blisters
  });
}

/** a swept engine pylon (wing underside down to a pod's spine), shell grey with a dark seam */
function skinPylon(c: ChassisCtx, x: number, yTop: number, yBot: number, z: number, l: number, t: number): void {
  const { b, kit } = c;
  const sec = (y: number, xs: number, cl: number): V3[] => [[xs + cl * 0.5, y, z], [xs + cl * 0.3, y, z + t / 2], [xs - cl * 0.5, y, z + t * 0.25], [xs - cl * 0.5, y, z - t * 0.25], [xs + cl * 0.3, y, z - t / 2]];
  b.loft(kit.shell, [sec(yTop, x - 0.08, l * 0.8), sec(yBot, x, l)]);
  bx(b, kit.mech, l * 0.9, 0.008, t * 1.1, x, (yTop + yBot) / 2, z);
}

// =====================================================================================================================
function superfortress(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.24;
  const F = new Fuse([
    [2.9, cy + 0.05, 0.06, 0.06], [2.78, cy + 0.05, 0.27, 0.27], [2.45, cy + 0.06, 0.42, 0.41], [1.8, cy + 0.08, 0.5, 0.46], [0.0, cy + 0.1, 0.52, 0.47],
    [-1.4, cy + 0.12, 0.44, 0.39], [-2.3, cy + 0.18, 0.26, 0.22], [-2.9, cy + 0.2, 0.1, 0.1],
  ], 0, SEC_ROUND);
  fuselage(b, kit.shell, F);
  for (const x of [2.3, 1.6, 0.9, 0.2, -0.5, -1.2, -1.9, -2.5]) panelBreak(b, kit, F, x, 0.02);
  // framed greenhouse nose (glass cone with frame bands and a spine), stepped flight-deck canopy, dorsal walkway
  overSkin(b, kit.glass, F, 2.9, 2.6, 0.004);
  for (const x of [2.83, 2.74, 2.64]) panelBreak(b, kit, F, x, 0.018, kit.shell);
  canopy(b, kit, 2.32, 1.88, F.top(2.1) - 0.07, 0.24, 0.13, { bows: 2, rake: 0.42 });
  ribbon(b, kit.mech, F.xs(1.6, -1.9).map((x) => [x, F.top(x) + 0.003, 0] as V3), 0.07, 0.07, 0.004);
  for (const x of [1.0, 0.86]) bx(b, kit.accent, 0.08, 0.008, 0.5, x, F.top(x) + 0.006, 0);
  bladeAntenna(b, kit, 0.4, F.top(0.4), 0.16, 0.12);
  bladeAntenna(b, kit, -1.0, F.top(-1.0), -0.14, 0.1);
  // the great wing: straight-ish taper, mid-mounted, slight dihedral
  const ws: Station[] = [[1.1, cy + 0.0, 0.4, 2.28, 0.3], [0.6, cy + 0.06, 2.2, 1.6, 0.18], [0.33, cy + 0.12, 4.0, 0.66, 0.06]];
  const lift: Lift[] = [];
  for (const s of [-1, 1] as const) {
    aeroWing(b, kit, mirrorSt(ws, s), { tip: 3.6, slat: [0.55, 3.9], flaps: [[0.55, 1.5], [1.55, 2.45], [2.6, 3.4], [3.45, 3.9]], stripe: [3.3, 3.45], walk: 2.6 });
    { const t = at(ws, 3.98); const P = new Fuse([[t[0] - 0.02, t[1], 0.02, 0.02], [t[0] - 0.12, t[1], 0.07, 0.07], [t[0] - 0.62, t[1], 0.06, 0.06], [t[0] - 0.72, t[1], 0.02, 0.02]], s * 4.0, SEC_ROUND); fuselage(b, kit.armor, P); bx(b, s < 0 ? kit.accent : kit.glow, 0.05, 0.035, 0.035, t[0] - 0.04, t[1], s * 4.0); }
    // three pusher nacelles through the wing: intake lip ahead of the leading edge, exhaust burning past the trailing edge
    for (const z of [0.96, 1.76, 2.56]) {
      const [lex, wy, ch] = at(ws, z);
      const x0 = lex + 0.32, x1 = lex - ch - 0.42, r = 0.19 - z * 0.012;
      const N = nacelle(b, kit, x0, x1, wy - 0.02, s * z, r);
      bx(b, kit.mech, 0.3, 0.05, 0.03, (x0 + x1) / 2 - 0.1, wy - 0.02 - r * 0.85, s * z); // cooling scoop
      soot(b, kit, N, x1 + 0.3, x1, s * z, r * 0.3);
      lift.push({ kind: 'jet', p: [x1 + 0.02, wy - 0.02, s * z], r: r * 0.62, len: 0.14 });
    }
    // outboard twin jet pod on a pylon
    {
      const z = 3.28, [lex, wy] = at(ws, z), ny = wy - 0.2, nx = lex - 0.12;
      skinPylon(c, nx, wy - 0.02, ny + 0.05, s * z, 0.5, 0.04);
      for (const d of [-0.1, 0.1]) {
        nacelle(b, kit, nx + 0.42, nx - 0.4, ny, s * z + d, 0.085);
        lift.push({ kind: 'jet', p: [nx - 0.42, ny, s * z + d], r: 0.06, len: 0.1 });
      }
    }
    // waist gun blister fairing on top of the wing, wing-root bay doors
    {
      const [, wy, , t] = at(ws, 3.2);
      const W = new Fuse([[-0.5, wy + t * 0.5, 0.02, 0.12], [-0.6, wy + t * 0.5 + 0.06, 0.08, 0.2], [-1.0, wy + t * 0.5 + 0.06, 0.08, 0.2], [-1.12, wy + t * 0.5, 0.02, 0.12]], s * 3.2, SEC_BOX);
      fuselage(b, kit.shell, W);
    }
    { const [, wy, , t] = at(ws, 1.6); bayDoors(c, 0.32, -0.32, wy - t * 0.45, 0.14, s * 1.6); }
    // H-tail: tailplane with tall endplate fins
    aeroWing(b, kit, mirrorSt([[-1.9, cy + 0.26, 0.15, 0.78, 0.07], [-2.18, cy + 0.26, 1.78, 0.42, 0.04]], s), { tip: 1.5, flaps: [[0.3, 1.6]] });
    aeroFin(b, kit, [[-1.98, cy + 0.2, s * 1.74, 0.62, 0.05], [-2.38, cy + 1.02, s * 1.78, 0.32, 0.03]], { rudder: [0.08, 0.92], band: [0.55, 0.75], beacon: 0.04 });
    aeroFin(b, kit, [[-2.0, cy + 0.26, s * 1.74, 0.55, 0.045], [-2.2, cy - 0.12, s * 1.74, 0.3, 0.03]], {});
  }
  // long belly bay (doors open), glazed chin and tail blisters, landing lamps, nose-gear doors
  bayDoors(c, 1.86, -1.76, F.bot(0) + 0.02, 0.2);
  blister(c, 2.55, F.bot(2.55) + 0.05, 0, 0.14, -1);
  blister(c, -2.73, F.bot(-2.73) + 0.04, 0, 0.1, -1);
  gearDoors(b, kit, 2.15, F.bot(2.15) + 0.004, 0, 0.36, 0.2);
  for (const s of [-1, 1]) bx(b, kit.lamp, 0.03, 0.03, 0.06, 2.42, cy - 0.18, s * 0.3);
  b.decal(0.6, 0.6, -0.2, over(ws, 2.3) + 0.012, 2.3, atlasUV(3), 0);
  b.decal(0.6, 0.6, -0.2, over(ws, 2.3) + 0.012, -2.3, atlasUV(3), 0);
  b.decal(0.4, 0.4, 1.4, F.top(1.4) + 0.008, 0, atlasUV(1), 0);
  return out(cy + 1.1, lift, (m) => {
    if (m.mod.resupply) {
      if (Math.abs(m.z) > 0.6) { const [, wy, , t] = at(ws, m.z); return hang(c, m, wy - t * 0.45, 0.55); }
      return hang(c, m, F.bot(m.x) + 0.03, 0.55);
    }
    if (Math.abs(m.z) > 2) {
      // waist guns ride the blister fairing on top of the wing
      const [, wy, , t] = at(ws, m.z), y = wy + t * 0.5 + 0.1;
      collar(b, kit, m.x, y, m.z, m.r, y - 0.08, 14);
      return { y, socket: true };
    }
    return hang(c, m, F.bot(m.x) - 0.08, 0.45);
  });
}

// =====================================================================================================================
function dreadnought(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.55;
  const BZ = 1.44; // gasbag centrelines (mount table: blisters at z = +-0.3 W)
  // gasbag stations: ogive nose, long parallel body, tapered tail (12-sided-ish faceted envelope)
  const gs: [number, number, number, number][] = [
    [3.92, cy + 0.12, 0.05, 0.05], [3.75, cy + 0.12, 0.4, 0.4], [3.35, cy + 0.12, 0.66, 0.65], [2.6, cy + 0.12, 0.8, 0.78], [0.5, cy + 0.12, 0.84, 0.82],
    [-1.6, cy + 0.12, 0.8, 0.78], [-2.8, cy + 0.12, 0.62, 0.6], [-3.55, cy + 0.12, 0.34, 0.33], [-3.85, cy + 0.12, 0.08, 0.08],
  ];
  const ENV = { kw: 0.4, lw: 0.82, ly: -0.66, chy: 0.0, sh: 0.86, shy: 0.6, tw: 0.42 };
  const lift: Lift[] = [];
  for (const s of [-1, 1] as const) {
    const z = s * BZ;
    const G = new Fuse(gs, z, ENV);
    // envelope in light shell grey, the nose cap and tail cone in the muted team colour, dark rib frames
    fuselage(b, kit.shell, G);
    overSkin(b, kit.armor, G, 3.92, 3.38, 0.006);
    overSkin(b, kit.armor, G, -3.0, -3.85, 0.006);
    for (const x of [2.9, 2.2, 1.5, 0.8, 0.1, -0.6, -1.3, -2.0, -2.7]) panelBreak(b, kit, G, x, 0.035);
    // dorsal catwalk with handrail posts, a team band behind the nose cap
    ribbon(b, kit.mech, G.xs(2.8, -2.8).map((x) => [x, G.top(x) + 0.01, z] as V3), 0.09, 0.09, 0.006);
    for (const x of [2.4, 1.2, 0, -1.2, -2.4]) bx(b, kit.joint, 0.02, 0.06, 0.02, x, G.top(x) + 0.04, z + 0.1);
    skinPanel(b, kit.accent, G, 3.25, 3.05, 4, 7, 0.008, 0.008);
    // cruciform tail fins on the bag
    const tx = -2.95;
    aeroFin(b, kit, [[tx + 0.2, G.top(tx) - 0.08, z, 0.95, 0.06], [tx - 0.55, G.top(tx) + 0.55, z, 0.5, 0.035]], { rudder: [0.15, 0.9], band: [0.45, 0.7], beacon: 0.04 });
    aeroFin(b, kit, [[tx + 0.2, G.bot(tx) + 0.08, z, 0.95, 0.06], [tx - 0.4, G.bot(tx) - 0.4, z, 0.5, 0.035]], { rudder: [0.15, 0.9] });
    aeroWing(b, kit, [[tx + 0.2, G.cy(tx), z + s * 0.5, 0.95, 0.06], [tx - 0.55, G.cy(tx), z + s * 1.05, 0.5, 0.035]], { mat: kit.armor, flaps: [[0.55, 1.0]] });
    // engine gondolas under the bag on dark struts, nose lamp
    for (const x of [1.6, -1.2]) {
      const gy = G.bot(x) + 0.02;
      b.strut(kit.mech, [x + 0.1, gy, z + s * 0.38], [x + 0.1, gy - 0.12, z + s * 0.55], 0.03, 0.03, 4);
      b.strut(kit.mech, [x - 0.15, gy, z + s * 0.38], [x - 0.15, gy - 0.12, z + s * 0.55], 0.03, 0.03, 4);
      const N = nacelle(b, kit, x + 0.36, x - 0.36, gy - 0.12, z + s * 0.62, 0.12, { mat: kit.armor2, band: null });
      void N;
      b.cyl(kit.hot, 0.08, 0.06, 0.02, [x - 0.37, gy - 0.12, z + s * 0.62], '-x', 10);
    }
    bx(b, kit.lamp, 0.03, 0.06, 0.06, 3.92, cy + 0.12, z);
    bx(b, s < 0 ? kit.accent : kit.glow, 0.06, 0.035, 0.035, 2.6, G.top(2.6) - 0.05, z + s * 0.62);
    // big ducted propulsor astern, grav pods under the bag (more when loaded)
    lift.push({ kind: 'duct', p: [-3.95, cy + 0.12, z], r: 0.36, blades: 7, dir: s, tilt: Math.PI / 2 });
    for (const x of load(c) > 0.85 ? [2.6, 0.9, -0.8, -2.4] : [2.4, 0, -2.4]) lift.push({ kind: 'grav', p: [x, G.bot(x) - 0.12, z], r: 0.3, len: 0.24, dir: s });
  }
  // armoured keel between the bags: ram bow, flat gun deck, belly with the bay well
  const ky0 = cy - 0.5, ky1 = cy - 0.12, ky2 = cy + 0.22;
  stationHull(b, kit.armor, [
    [4.0, 0.12, ky0 + 0.22, ky1 + 0.05, ky2 - 0.12, 0.6], [3.6, 0.42, ky0 + 0.06, ky1, ky2, 0.8], [2.8, 0.56, ky0, ky1, ky2, 0.88],
    [-2.8, 0.56, ky0, ky1, ky2, 0.88], [-3.5, 0.44, ky0 + 0.1, ky1, ky2 - 0.04, 0.8], [-3.9, 0.2, ky0 + 0.24, ky1 + 0.04, ky2 - 0.1, 0.6],
  ], 0, 0.82);
  // deck plating in shell grey with dark plank seams, a team chevron at the bow, armour belts along both sides
  b.box(kit.shell, 6.2, 0.04, 0.86, 0.2, ky2 + 0.015, 0, 0.012);
  for (const x of [2.4, 1.4, 0.4, -0.6, -1.6]) bx(b, kit.mech, 0.02, 0.008, 0.84, x, ky2 + 0.037, 0);
  b.decal(0.6, 0.6, 3.0, ky2 + 0.04, 0, atlasUV(1), 0);
  for (const s of [-1, 1]) {
    b.box(kit.mech, 6.0, 0.08, 0.04, 0.0, ky1 - 0.02, s * 0.57, 0.01);
    bx(b, kit.accent, 1.0, 0.05, 0.03, 3.0, ky1 + 0.12, s * 0.555, [0, s * 0.06, 0]);
    // trussed girders from the keel out to the bags
    for (const x of [2.9, 1.3, -0.6, -2.3]) {
      b.box(kit.armor2, 0.12, 0.1, BZ - 0.75, x, cy - 0.05, s * (0.55 + (BZ - 0.75) / 2), 0.015);
      b.strut(kit.joint, [x, cy - 0.1, s * 0.56], [x, cy + 0.2, s * (BZ - 0.75)], 0.012, 0.012, 4);
    }
  }
  // bay well under the keel (doors open)
  bayDoors(c, 1.1, -1.1, ky0 + 0.01, 0.36);
  // bridge castle aft: stepped faceted block, framed glazed band, mast with radar bar and beacon
  const bx0 = -2.4;
  const T = new Fuse([[bx0 + 0.45, ky2 + 0.25, 0.25, 0.3], [bx0 + 0.3, ky2 + 0.3, 0.3, 0.36], [bx0 - 0.45, ky2 + 0.28, 0.28, 0.34]], 0, SEC_BOX);
  fuselage(b, kit.armor2, T);
  bx(b, kit.glass, 0.08, 0.08, 0.5, bx0 + 0.45, ky2 + 0.36, 0, [0, 0, -0.3]);
  b.box(kit.shell, 0.5, 0.18, 0.4, bx0 - 0.06, ky2 + 0.66, 0, 0.02);
  bx(b, kit.glass, 0.04, 0.05, 0.3, bx0 + 0.2, ky2 + 0.68, 0);
  b.strut(kit.joint, [bx0 - 0.1, ky2 + 0.72, 0], [bx0 - 0.14, ky2 + 1.05, 0], 0.02, 0.012, 6);
  bx(b, kit.joint, 0.07, 0.08, 0.5, bx0 - 0.13, ky2 + 0.92, 0);
  bx(b, kit.lamp, 0.04, 0.04, 0.04, bx0 - 0.14, ky2 + 1.07, 0);
  bladeAntenna(b, kit, bx0 - 0.3, ky2 + 0.75, 0.15, 0.12);
  // ram bow hazard band
  bx(b, kit.hazard, 0.06, 0.12, 0.5, 3.62, ky1 + 0.04, 0);
  b.decal(0.55, 0.55, 0.6, gs[4][1] + gs[4][2] + 0.02, BZ, atlasUV(3), 0);
  b.decal(0.55, 0.55, 0.6, gs[4][1] + gs[4][2] + 0.02, -BZ, atlasUV(3), 0);
  return out(cy + 1.2, lift, (m: MountSpec): Seat => {
    if (m.mod.resupply) return hang(c, m, ky0 + 0.02, 0.55);
    if (Math.abs(m.z) > 1) {
      // gun blisters on top of the gasbags
      const G = new Fuse(gs, Math.sign(m.z) * BZ, ENV);
      const y = G.top(m.x) + 0.02;
      collar(b, kit, m.x, y, m.z, m.r, y - 0.1, 14);
      return { y, socket: true };
    }
    const y = ky2 + 0.04;
    collar(b, kit, m.x, y, m.z, m.r, y - 0.08, 16);
    return { y, socket: true };
  });
}

registerChassis('strategic', strategic);
registerChassis('superfortress', superfortress);
registerChassis('dreadnought', dreadnought);
