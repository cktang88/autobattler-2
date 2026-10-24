// Giant and titan bombers (size 4-5 aircraft): each one is its own airframe, not a stretched strato bomber.
//
//   strategic      size 4 jet: long slender fuselage, shoulder wings swept to the tips with a slight droop, four
//                  twin-engine pods slung ahead of the leading edge (eight glowing exhausts), a tall swept fin, a
//                  long belly bay with its doors hanging open, glazed chin and tail gun blisters
//   superfortress  size 5 jet: a vast straight tapered wing, a fat fuselage with a glazed greenhouse nose and a
//                  stepped flight deck, six pusher nacelles burning out of the trailing edge plus twin jet pods
//                  outboard, an H-tail; belly and wing-root bays, waist gun blisters on top of the wing
//   dreadnought    size 5 grav airship: twin ribbed gasbags with cruciform tail fins and big rear ducted propulsors,
//                  an armoured keel between them carrying the bow gun, a bridge castle and the bays (bombs drop from
//                  under the keel, guns ride the deck), gun blisters on top of the bags, grav pods under both bags
//
// Bombs (resupply weapons) always hang from the belly / keel at their mount point; defensive guns sit in blisters
// (collars) where the mount table puts them. Frame and conventions as chassis/air.ts.

import { atlasUV } from '../materials.ts';
import type { V3 } from '../geo.ts';
import { registerChassis, type ChassisCtx, type MountSpec, type Seat } from './registry.ts';
import { block, collar, pod, stationHull } from './shapes.ts';
import { fuse, type AirOut, type Lift } from '../mobility/air.ts';
import { at, fin, hang, load, mirror, navLights, out, wing, type Station } from './air.ts';

/** superellipse fuselage stations [x, cy, ry, rz] -> top / bottom height and half width at x */
function fuseAt(st: [number, number, number, number][], x: number): { top: number; bot: number; w: number; cy: number } {
  let i = 0;
  while (i < st.length - 2 && st[i + 1][0] > x) i++;
  const p = st[i], q = st[i + 1];
  const f = Math.max(0, Math.min(1, (p[0] - x) / (p[0] - q[0] || 1)));
  const cy = p[1] + (q[1] - p[1]) * f, ry = p[2] + (q[2] - p[2]) * f, rz = p[3] + (q[3] - p[3]) * f;
  return { top: cy + ry, bot: cy - ry, w: rz, cy };
}

/** open bomb-bay doors hanging down both sides of a bay slot (x0..x1 along the belly at height y, half width w) */
function bayDoors(c: ChassisCtx, x0: number, x1: number, y: number, w: number, z = 0): void {
  const { b, kit } = c;
  const l = Math.abs(x1 - x0), x = (x0 + x1) / 2, d = w * 1.1;
  b.box(kit.trim, l, 0.03, w * 2, x, y + 0.012, z, 0.008); // dark bay well
  for (const s of [-1, 1]) b.box(kit.hull2, l * 0.96, 0.02, d, x, y - d * 0.42, z + s * (w + d * 0.12), 0.006, [s * 1.15, 0, 0]);
}

/** glazed gun blister: a glass dome with a framed ring, opening up (dir 1) or down (dir -1) */
function blister(c: ChassisCtx, x: number, y: number, z: number, r: number, dir: 1 | -1): void {
  const { b, kit } = c;
  b.lathe(kit.glass, [[0, 0], [r, 0], [r * 0.92, r * 0.42 * dir], [r * 0.6, r * 0.75 * dir], [0, r * 0.85 * dir]], [x, y, z], 'y', 12);
  b.cylb(kit.trim, r * 1.08, r * 0.14, r * 0.04, [x, y - r * 0.07, z], 'y', 12);
}

// =====================================================================================================================
function strategic(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.16;
  const fs: [number, number, number, number][] = [
    [2.42, cy + 0.0, 0.03, 0.03], [2.3, cy + 0.01, 0.13, 0.12], [2.05, cy + 0.04, 0.24, 0.21], [1.6, cy + 0.06, 0.3, 0.25], [0.5, cy + 0.08, 0.32, 0.26],
    [-0.8, cy + 0.08, 0.3, 0.25], [-1.7, cy + 0.12, 0.21, 0.17], [-2.2, cy + 0.16, 0.12, 0.1], [-2.42, cy + 0.17, 0.05, 0.05],
  ];
  fuse(b, kit.hull, fs, 12, 2.4);
  // stepped cockpit: glazing under a panel brow, a dorsal spine fairing with a glow seam
  pod(b, kit.glass, [1.78, cy + 0.27, 0], 0.32, 0.12, 0.19, 10, 6, 2.2);
  block(b, kit.panel, 1.42, cy + 0.27, 0, 0.5, 0.36, 0.11, { top: [0.7, 0.75], shift: [0.08, 0], ch: 0.08, bev: 0.025 });
  block(b, kit.panel, -0.2, cy + 0.33, 0, 2.6, 0.24, 0.08, { top: [0.9, 0.6], ch: 0.08, bev: 0.025 });
  b.box(kit.glow, 1.9, 0.015, 0.03, -0.2, cy + 0.415, 0, 0.004);
  // shoulder wing, swept to the tips with a slight droop, tip pods on the end
  const ws: Station[] = [[1.0, cy + 0.22, 0.2, 1.45, 0.16], [0.12, cy + 0.2, 1.4, 0.92, 0.1], [-0.84, cy + 0.12, 2.95, 0.42, 0.045]];
  const lift: Lift[] = [];
  for (const s of [-1, 1] as const) {
    wing(b, kit.hull, mirror(ws, s));
    // leading-edge strip and flap line in the shell colour, team stripe near the tip
    for (const [z0, z1] of [[0.4, 1.0], [1.25, 1.8], [2.1, 2.85]]) {
      const a = at(ws, z0), e = at(ws, z1);
      b.loft(kit.panel, [[a[0] - 0.02, a[1] + a[3] * 0.55, s * z0], [e[0] - 0.02, e[1] + e[3] * 0.55, s * z1]].map(([x, y, z]) => [[x, y, z - 0.001], [x - 0.12, y + 0.012, z], [x - 0.12, y - 0.01, z + 0.001]] as V3[]), true, true);
    }
    { const t = at(ws, 2.55); b.box(kit.accent, 0.3, 0.012, 0.16, t[0] - t[2] * 0.45, t[1] + t[3] * 0.62, s * 2.55, 0.004, [0, s * 0.62, 0]); }
    { const t = at(ws, 2.92); pod(b, kit.panel, [t[0] - 0.22, t[1] - 0.02, s * 2.92], 0.32, 0.055, 0.055, 8, 5, 2.2); navLights(b, kit, t[0] - 0.22, t[1] + 0.06, 2.92, 0.025); }
    // twin-engine pods hung on pylons ahead of the leading edge
    for (const z of [1.1, 1.98]) {
      const [lex, wy, ch] = at(ws, z);
      const ny = wy - 0.24, nx = lex - 0.06;
      b.box(kit.trim, 0.6, wy - ny - 0.04, 0.04, nx + 0.0, (wy + ny) / 2, s * z, 0.01);
      for (const d of [-0.11, 0.11]) {
        const zz = s * z + d;
        pod(b, kit.panel, [nx, ny, zz], 0.5, 0.095, 0.095, 10, 6, 2.2);
        b.cylb(kit.trim, 0.085, 0.05, 0.012, [nx + 0.43, ny, zz], 'x', 10);
        b.cyl(kit.accent, 0.097, 0.097, 0.07, [nx + 0.24, ny, zz], 'x', 10);
        lift.push({ kind: 'jet', p: [nx - 0.5, ny, zz], r: 0.07, len: 0.11 });
      }
      void ch;
    }
    // tailplane
    wing(b, kit.hull, mirror([[-1.82, cy + 0.2, 0.08, 0.52, 0.05], [-2.22, cy + 0.2, 0.88, 0.22, 0.025]], s));
  }
  // tall swept fin with a team-coloured rudder band and a beacon
  fin(b, kit.hull, [[-1.5, cy + 0.3, 0, 0.92, 0.07], [-2.16, cy + 1.28, 0, 0.42, 0.035]]);
  b.box(kit.accent, 0.46, 0.12, 0.08, -2.25, cy + 1.0, 0, 0.01);
  b.box(kit.glow, 0.04, 0.04, 0.05, -2.06, cy + 1.3, 0, 0.006);
  // long belly bay with its doors hanging open, glazed chin and tail blisters
  const belly = fuseAt(fs, 0).bot;
  bayDoors(c, 1.42, -1.5, belly + 0.01, 0.15);
  blister(c, 2.02, fuseAt(fs, 2.02).bot + 0.04, 0, 0.12, -1);
  blister(c, -2.26, fuseAt(fs, -2.26).bot + 0.03, 0, 0.09, -1);
  b.box(kit.lamp, 0.03, 0.03, 0.08, 2.4, cy + 0.02, 0, 0.006);
  b.decal(0.42, 0.42, -0.2, at(ws, 1.6)[1] + 0.06, 1.6, atlasUV(3), 0);
  b.decal(0.42, 0.42, -0.2, at(ws, 1.6)[1] + 0.06, -1.6, atlasUV(3), 0);
  return out(cy + 1.3, lift, (m) => {
    const f = fuseAt(fs, m.x);
    if (m.mod.resupply) return hang(c, m, f.bot + 0.02, 0.55);
    return hang(c, m, f.bot - 0.06, 0.45); // defensive guns under their glazed blisters
  });
}

// =====================================================================================================================
function superfortress(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.24;
  const fs: [number, number, number, number][] = [
    [2.9, cy + 0.05, 0.06, 0.06], [2.78, cy + 0.05, 0.27, 0.27], [2.45, cy + 0.06, 0.42, 0.41], [1.8, cy + 0.08, 0.5, 0.46], [0.0, cy + 0.1, 0.52, 0.47],
    [-1.4, cy + 0.12, 0.44, 0.39], [-2.3, cy + 0.18, 0.26, 0.22], [-2.9, cy + 0.2, 0.1, 0.1],
  ];
  fuse(b, kit.hull, fs, 12, 2.3);
  // glazed greenhouse nose with frame bands, stepped flight-deck canopy, dorsal ridge with glow seam
  pod(b, kit.glass, [2.7, cy + 0.06, 0], 0.26, 0.27, 0.27, 12, 6, 2.0);
  for (const x of [2.62, 2.74]) b.cylb(kit.trim, 0.29 - (x - 2.62) * 0.4, 0.02, 0.006, [x, cy + 0.06, 0], 'x', 12);
  pod(b, kit.glass, [2.12, cy + 0.5, 0], 0.36, 0.13, 0.26, 10, 6, 2.2);
  block(b, kit.panel, 1.72, cy + 0.5, 0, 0.5, 0.5, 0.1, { top: [0.7, 0.8], shift: [0.08, 0], ch: 0.1, bev: 0.03 });
  block(b, kit.panel, -0.3, cy + 0.56, 0, 3.0, 0.36, 0.1, { top: [0.9, 0.6], ch: 0.1, bev: 0.03 });
  b.box(kit.glow, 2.4, 0.015, 0.03, -0.3, cy + 0.665, 0, 0.004);
  // the great wing: straight-ish taper, mid-mounted, slight dihedral
  const ws: Station[] = [[1.1, cy + 0.0, 0.4, 2.28, 0.3], [0.6, cy + 0.06, 2.2, 1.6, 0.18], [0.33, cy + 0.12, 4.0, 0.66, 0.06]];
  const lift: Lift[] = [];
  for (const s of [-1, 1] as const) {
    wing(b, kit.hull, mirror(ws, s));
    // leading-edge strip, flap band, team stripe and tip pod
    for (const [z0, z1] of [[0.55, 3.9]]) {
      const a = at(ws, z0), e = at(ws, z1);
      b.loft(kit.panel, [[a[0] - 0.01, a[1] + a[3] * 0.5, s * z0], [e[0] - 0.01, e[1] + e[3] * 0.5, s * z1]].map(([x, y, z]) => [[x, y, z - 0.001], [x - 0.16, y + 0.02, z], [x - 0.16, y - 0.015, z + 0.001]] as V3[]), true, true);
      b.loft(kit.trim, [[a[0] - a[2] * 0.82, a[1] + a[3] * 0.32, s * z0], [e[0] - e[2] * 0.82, e[1] + e[3] * 0.32, s * z1]].map(([x, y, z]) => [[x, y, z - 0.001], [x - 0.04, y + 0.01, z], [x - 0.04, y - 0.004, z + 0.001]] as V3[]), true, true);
    }
    { const t = at(ws, 3.55); b.box(kit.accent, 0.42, 0.014, 0.24, t[0] - t[2] * 0.45, t[1] + t[3] * 0.6, s * 3.55, 0.004); }
    { const t = at(ws, 3.98); pod(b, kit.panel, [t[0] - 0.3, t[1], s * 3.98], 0.42, 0.07, 0.07, 8, 5, 2.2); navLights(b, kit, t[0] - 0.3, t[1] + 0.08, 3.98, 0.03); }
    // three pusher nacelles through the wing: intake lip ahead of the leading edge, exhaust burning past the trailing edge
    for (const z of [0.96, 1.76, 2.56]) {
      const [lex, wy, ch] = at(ws, z);
      const x0 = lex + 0.32, x1 = lex - ch - 0.42, nx = (x0 + x1) / 2, len = (x0 - x1) / 2, r = 0.19 - z * 0.012;
      pod(b, kit.panel, [nx, wy - 0.02, s * z], len, r, r, 12, 7, 2.6);
      b.cylb(kit.trim, r * 0.86, 0.05, 0.015, [x0 - 0.07, wy - 0.02, s * z], 'x', 12);
      b.cyl(kit.accent, r * 1.02, r * 1.02, 0.08, [x0 - 0.3, wy - 0.02, s * z], 'x', 12);
      b.box(kit.trim, 0.3, 0.05, 0.03, nx - 0.1, wy - 0.02 - r * 0.85, s * z, 0.008); // cooling scoop
      lift.push({ kind: 'jet', p: [x1 + 0.02, wy - 0.02, s * z], r: r * 0.62, len: 0.14 });
    }
    // outboard twin jet pod on a pylon
    {
      const z = 3.28, [lex, wy] = at(ws, z), ny = wy - 0.2, nx = lex - 0.12;
      b.box(kit.trim, 0.5, wy - ny - 0.03, 0.04, nx, (wy + ny) / 2, s * z, 0.01);
      for (const d of [-0.1, 0.1]) {
        pod(b, kit.panel, [nx, ny, s * z + d], 0.42, 0.085, 0.085, 10, 6, 2.2);
        b.cylb(kit.trim, 0.075, 0.04, 0.01, [nx + 0.36, ny, s * z + d], 'x', 10);
        lift.push({ kind: 'jet', p: [nx - 0.42, ny, s * z + d], r: 0.06, len: 0.1 });
      }
    }
    // waist gun blister fairing on top of the wing, wing-root bay doors
    {
      const [lex, wy, ch, t] = at(ws, 3.2);
      block(b, kit.panel, -0.81, wy + t * 0.5, s * 3.2, 0.62, 0.42, 0.1, { top: [0.8, 0.8], ch: 0.1, bev: 0.03 });
      void lex; void ch;
    }
    { const [, wy, , t] = at(ws, 1.6); bayDoors(c, 0.32, -0.32, wy - t * 0.45, 0.14, s * 1.6); }
    // H-tail: tailplane with tall endplate fins
    wing(b, kit.hull, mirror([[-1.9, cy + 0.26, 0.15, 0.78, 0.07], [-2.18, cy + 0.26, 1.78, 0.42, 0.04]], s));
    fin(b, kit.hull, [[-1.98, cy + 0.2, s * 1.74, 0.62, 0.05], [-2.38, cy + 1.02, s * 1.78, 0.32, 0.03]]);
    fin(b, kit.hull, [[-2.0, cy + 0.26, s * 1.74, 0.55, 0.045], [-2.2, cy - 0.12, s * 1.74, 0.3, 0.03]]);
    b.box(kit.accent, 0.32, 0.12, 0.075, -2.44, cy + 0.72, s * 1.76, 0.01);
    b.box(kit.glow, 0.04, 0.04, 0.05, -2.36, cy + 1.03, s * 1.78, 0.006);
  }
  // long belly bay (doors open), glazed chin and tail blisters, landing lamps
  const belly = fuseAt(fs, 0).bot;
  bayDoors(c, 1.86, -1.76, belly + 0.02, 0.2);
  blister(c, 2.55, fuseAt(fs, 2.55).bot + 0.05, 0, 0.14, -1);
  blister(c, -2.73, fuseAt(fs, -2.73).bot + 0.04, 0, 0.1, -1);
  for (const s of [-1, 1]) b.box(kit.lamp, 0.03, 0.03, 0.06, 2.42, cy - 0.18, s * 0.3, 0.006);
  b.decal(0.6, 0.6, -0.2, at(ws, 2.3)[1] + at(ws, 2.3)[3] * 0.6 + 0.01, 2.3, atlasUV(3), 0);
  b.decal(0.6, 0.6, -0.2, at(ws, 2.3)[1] + at(ws, 2.3)[3] * 0.6 + 0.01, -2.3, atlasUV(3), 0);
  return out(cy + 1.1, lift, (m) => {
    if (m.mod.resupply) {
      if (Math.abs(m.z) > 0.6) { const [, wy, , t] = at(ws, m.z); return hang(c, m, wy - t * 0.45, 0.55); }
      return hang(c, m, fuseAt(fs, m.x).bot + 0.03, 0.55);
    }
    if (Math.abs(m.z) > 2) {
      // waist guns ride the blister fairing on top of the wing
      const [, wy, , t] = at(ws, m.z), y = wy + t * 0.5 + 0.1;
      collar(b, kit, m.x, y, m.z, m.r, y - 0.08, 14);
      return { y, socket: true };
    }
    return hang(c, m, fuseAt(fs, m.x).bot - 0.08, 0.45);
  });
}

// =====================================================================================================================
function dreadnought(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.55;
  const BZ = 1.44; // gasbag centrelines (mount table: blisters at z = +-0.3 W)
  // gasbag stations: ogive nose, long parallel body, tapered tail
  const gs: [number, number, number, number][] = [
    [3.92, cy + 0.12, 0.05, 0.05], [3.75, cy + 0.12, 0.4, 0.4], [3.35, cy + 0.12, 0.66, 0.65], [2.6, cy + 0.12, 0.8, 0.78], [0.5, cy + 0.12, 0.84, 0.82],
    [-1.6, cy + 0.12, 0.8, 0.78], [-2.8, cy + 0.12, 0.62, 0.6], [-3.55, cy + 0.12, 0.34, 0.33], [-3.85, cy + 0.12, 0.08, 0.08],
  ];
  const lift: Lift[] = [];
  for (const s of [-1, 1] as const) {
    const z = s * BZ;
    fuse(b, kit.hull, gs, 14, 2.0, z);
    // ribbed skin: dark frame bands, a light dorsal walkway with a glow seam, a team stripe at the nose
    for (const x of [2.9, 1.9, 0.9, -0.1, -1.1, -2.1, -3.0]) { const f = fuseAt(gs, x); b.cyl(kit.trim, f.w + 0.018, f.w + 0.018, 0.05, [x + 0.025, f.cy, z], '-x', 16); }
    block(b, kit.panel, -0.2, fuseAt(gs, 0).top - 0.04, z, 5.4, 0.22, 0.07, { top: [0.96, 0.6], ch: 0.06, bev: 0.02 });
    b.box(kit.glow, 4.2, 0.012, 0.03, -0.2, fuseAt(gs, 0).top + 0.035, z, 0.004);
    { const r = fuseAt(gs, 3.4).w + 0.015; b.cyl(kit.trim, r, r, 0.05, [3.4, cy + 0.12, z], 'x', 16); }
    { const r = fuseAt(gs, 2.95).w + 0.02; b.cyl(kit.accent, r, r, 0.12, [2.95, cy + 0.12, z], 'x', 16); }
    // cruciform tail fins on the bag
    const tx = -2.95, f = fuseAt(gs, tx);
    fin(b, kit.hull, [[tx + 0.2, f.top - 0.08, z, 0.95, 0.06], [tx - 0.55, f.top + 0.55, z, 0.5, 0.035]]);
    fin(b, kit.hull, [[tx + 0.2, f.bot + 0.08, z, 0.95, 0.06], [tx - 0.4, f.bot - 0.4, z, 0.5, 0.035]]);
    wing(b, kit.hull, [[tx + 0.2, f.cy, z + s * 0.5, 0.95, 0.06], [tx - 0.55, f.cy, z + s * 1.05, 0.5, 0.035]]);
    b.box(kit.accent, 0.4, 0.1, 0.08, tx - 0.5, f.top + 0.36, z, 0.01);
    // engine gondolas under the bag, nose lamp
    for (const x of [1.6, -1.2]) {
      const gy = fuseAt(gs, x).bot + 0.02;
      b.box(kit.trim, 0.32, 0.18, 0.06, x, gy - 0.02, z + s * 0.42, 0.01);
      pod(b, kit.panel, [x, gy - 0.12, z + s * 0.62], 0.36, 0.12, 0.12, 10, 6, 2.2);
      b.cyl(kit.hot, 0.08, 0.06, 0.02, [x - 0.36, gy - 0.12, z + s * 0.62], '-x', 10);
    }
    b.box(kit.lamp, 0.03, 0.06, 0.06, 3.92, cy + 0.12, z, 0.008);
    navLights(b, kit, 2.6, fuseAt(gs, 2.6).top - 0.05, BZ + 0.0, 0.035);
    // big ducted propulsor astern, grav pods under the bag (more when loaded)
    lift.push({ kind: 'duct', p: [-3.95, cy + 0.12, z], r: 0.36, blades: 7, dir: s, tilt: Math.PI / 2 });
    for (const x of load(c) > 0.85 ? [2.6, 0.9, -0.8, -2.4] : [2.4, 0, -2.4]) lift.push({ kind: 'grav', p: [x, fuseAt(gs, x).bot - 0.12, z], r: 0.3, len: 0.24, dir: s });
  }
  // armoured keel between the bags: ram bow, flat gun deck, belly with the bay well
  const ky0 = cy - 0.5, ky1 = cy - 0.12, ky2 = cy + 0.22;
  stationHull(b, kit.hull2, [
    [4.0, 0.12, ky0 + 0.22, ky1 + 0.05, ky2 - 0.12, 0.6], [3.6, 0.42, ky0 + 0.06, ky1, ky2, 0.8], [2.8, 0.56, ky0, ky1, ky2, 0.88],
    [-2.8, 0.56, ky0, ky1, ky2, 0.88], [-3.5, 0.44, ky0 + 0.1, ky1, ky2 - 0.04, 0.8], [-3.9, 0.2, ky0 + 0.24, ky1 + 0.04, ky2 - 0.1, 0.6],
  ], 0, 0.82);
  // deck plating in the shell colour, a glowing deck seam, armour belts along both sides
  block(b, kit.panel, 0.2, ky2 - 0.01, 0, 6.2, 0.86, 0.04, { ch: 0.1, bev: 0.015 });
  b.box(kit.glow, 5.0, 0.012, 0.025, 0.2, ky2 + 0.035, 0, 0.004);
  for (const s of [-1, 1]) {
    b.box(kit.trim, 6.0, 0.08, 0.04, 0.0, ky1 - 0.02, s * 0.57, 0.01);
    b.box(kit.accent, 1.0, 0.05, 0.03, 3.0, ky1 + 0.12, s * 0.555, 0.008, [0, s * 0.06, 0]);
    // girders from the keel out to the bags
    for (const x of [2.9, 1.3, -0.6, -2.3]) b.box(kit.trim, 0.12, 0.1, BZ - 0.75, x, cy - 0.05, s * (0.55 + (BZ - 0.75) / 2), 0.015);
  }
  // bay well under the keel (doors open)
  bayDoors(c, 1.1, -1.1, ky0 + 0.01, 0.36);
  // bridge castle aft: stepped block, glazed band, mast with radar bar and beacon
  const bx = -2.4;
  block(b, kit.hull, bx, ky2, 0, 0.9, 0.7, 0.36, { top: [0.75, 0.75], shift: [-0.06, 0], ch: 0.12, bev: 0.04 });
  b.box(kit.glass, 0.5, 0.08, 0.5, bx + 0.12, ky2 + 0.27, 0, 0.012);
  block(b, kit.panel, bx - 0.06, ky2 + 0.36, 0, 0.5, 0.36, 0.14, { top: [0.8, 0.8], ch: 0.06 });
  b.strut(kit.steel, [bx - 0.1, ky2 + 0.48, 0], [bx - 0.14, ky2 + 0.95, 0], 0.022, 0.012, 6);
  b.box(kit.metal, 0.07, 0.08, 0.5, bx - 0.13, ky2 + 0.82, 0, 0.01);
  b.box(kit.glow, 0.04, 0.04, 0.04, bx - 0.14, ky2 + 0.97, 0, 0.006);
  // ram bow armour and hazard band
  b.box(kit.hazard, 0.06, 0.12, 0.5, 3.62, ky1 + 0.04, 0, 0.01);
  b.decal(0.55, 0.55, 0.6, fuseAt(gs, 0.6).top + 0.002, BZ, atlasUV(3), 0);
  b.decal(0.55, 0.55, 0.6, fuseAt(gs, 0.6).top + 0.002, -BZ, atlasUV(3), 0);
  return out(cy + 1.2, lift, (m: MountSpec): Seat => {
    if (m.mod.resupply) return hang(c, m, ky0 + 0.02, 0.55);
    if (Math.abs(m.z) > 1) {
      // gun blisters on top of the gasbags
      const y = fuseAt(gs, m.x).top + 0.02;
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
