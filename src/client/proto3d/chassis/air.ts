// Aircraft: every flying chassis gets its own stylized airframe and places its own lift units (AirOut.lift, rendered by
// mobility/air.ts) according to its mobility and how heavily it is loaded (chassis + module weight vs. the mobility's
// capacity for this size): more / bigger fans, rotors, nozzles or grav pods for heavier frames.
//
//   drone        bug-eyed egg pod on four ducted fans in an X
//   gunship      slim tandem-canopy attack heli on a coaxial rotor, stub wings with tip pylons, twin endplate tail
//   heavyheli    long rounded-box tandem-rotor hauler with a tall aft rotor tower and side sponsons (grav: outrigger pods)
//   bomberhull   hooded-visor lifting body with an upswept tail and four tilting ducted fans (grav: four to six pods)
//   carrier      wide manta flying fortress: keel hull, swept wing-hulls with tip nacelles, offset bridge tower, grav pods
//   interceptor  needle fighter with forward-swept wings, canards, twin canted fins, one engine
//   strikejet    twin-boom fighter-bomber: bubble-canopy central pod, engines in the booms, high tail between fin tops
//   deltawing    ogival tailless delta with one tall fin and twin buried engines
//   stratobomber sawtooth flying wing with a cockpit hump, four engine humps and a tail stinger
//
// Frame: belly reference y0 = stance.y0 (the render lifts the unit to cruise altitude). Weapons are fixed pods hung
// from pylons under wings / fuselage at the exact mount points (seat() builds the pylon, socket = true); carrier deck
// guns sit on collars.

import { atlasUV } from '../materials.ts';
import type { Bld, MatLike, V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerChassis, type ChassisCtx, type MountSpec, type Seat } from './registry.ts';
import { block, collar, pod } from './shapes.ts';
import { fuse, type AirOut, type Lift } from '../mobility/air.ts';

type Station = [number, number, number, number, number]; // [leading-edge x, y, z, chord, thickness]

/** aerofoil ring: leading edge at le, chord along -x, thickness along `up` ('y' wings, 'z' fins) */
function foil(le: V3, c: number, t: number, up: 'y' | 'z' = 'y'): V3[] {
  const p = (a: number, b: number): V3 => (up === 'y' ? [le[0] - a * c, le[1] + b * t, le[2]] : [le[0] - a * c, le[1], le[2] + b * t]);
  return [p(0, 0), p(0.1, 0.55), p(0.4, 1), p(0.8, 0.55), p(1, 0), p(0.8, -0.35), p(0.4, -0.6), p(0.1, -0.4)];
}
/** wing / tailplane panel through spanwise stations */
function wing(b: Bld, mat: MatLike, st: Station[]): void {
  b.loft(mat, st.map(([x, y, z, c, t]) => foil([x, y, z], c, t, 'y')));
}
/** fin through stations ordered root -> tip; each station [le x, y, z, chord, thickness] with thickness along z */
function fin(b: Bld, mat: MatLike, st: Station[]): void {
  b.loft(mat, st.map(([x, y, z, c, t]) => foil([x, y, z], c, t, 'z')));
}
/** interpolate a station table at span coordinate z (abs) -> [lex, y, chord, thick] */
function at(st: Station[], z: number): [number, number, number, number] {
  const a = Math.abs(z);
  let i = 0;
  while (i < st.length - 2 && Math.abs(st[i + 1][2]) < a) i++;
  const p = st[i], q = st[i + 1];
  const f = Math.max(0, Math.min(1, (a - Math.abs(p[2])) / (Math.abs(q[2]) - Math.abs(p[2]) || 1)));
  return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[3] + (q[3] - p[3]) * f, p[4] + (q[4] - p[4]) * f];
}
const mirror = (st: Station[], s: number): Station[] => st.map(([x, y, z, c, t]) => [x, y, z * s, c, t]);

/** fixed weapon pod hung below yUnder on a pylon at the mount point */
function hang(c: ChassisCtx, m: MountSpec, yUnder: number, drop = 0.8): Seat {
  const { b, kit } = c;
  const d = m.r * drop;
  const y = yUnder - d;
  const ph = yUnder - (y + d * 0.55) + 0.02;
  b.box(kit.trim, Math.max(0.08, m.r * 1.3), ph, Math.max(0.025, m.r * 0.22), m.x - m.r * 0.05, yUnder - ph / 2 + 0.01, m.z, 0.008);
  b.box(kit.metal, Math.max(0.06, m.r * 0.9), 0.02 + m.r * 0.05, Math.max(0.03, m.r * 0.5), m.x, y + d * 0.55 + 0.005, m.z, 0.005);
  return { y, socket: true };
}
/** red/green-ish nav lights (team accent left, glow right) at a wingtip pair */
function navLights(b: Bld, kit: Kit, x: number, y: number, z: number, s: number): void {
  b.box(kit.accent, s * 1.6, s, s, x, y, -z, s * 0.3);
  b.box(kit.glow, s * 1.6, s, s, x, y, z, s * 0.3);
}
/** load ratio: (chassis + modules weight) / mobility capacity at this size */
function load(c: ChassisCtx): number {
  const w = c.ch.weight + c.mounts.reduce((a, m) => a + (m.mod.weight ?? 0), 0);
  const cap = c.mob.capacity?.[c.S - 1] ?? 0;
  return cap > 0 ? w / cap : 0.6;
}
const out = (top: number, lift: Lift[], seat: (m: MountSpec) => Seat): AirOut => ({ deckAt: () => -1, top, custom: true, seat, lift });

// =====================================================================================================================
function drone(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.12;
  pod(b, kit.hull, [0, cy, 0], 0.2, 0.11, 0.15, 10, 6, 2.2, 0.2);
  pod(b, kit.panel, [-0.04, cy + 0.06, 0], 0.15, 0.07, 0.12, 10, 5, 2.4);
  // big round eye
  b.cylb(kit.trim, 0.072, 0.04, 0.01, [0.15, cy + 0.01, 0], 'x', 12);
  b.cyl(kit.glow, 0.05, 0.045, 0.012, [0.19, cy + 0.01, 0], 'x', 12);
  b.cyl(kit.lamp, 0.016, 0.016, 0.006, [0.2, cy + 0.025, 0.015], 'x', 6);
  // dorsal whip antenna, tail fin
  b.strut(kit.steel, [-0.08, cy + 0.12, 0.05], [-0.16, cy + 0.3, 0.07], 0.007, 0.004, 5);
  fin(b, kit.trim, [[-0.12, cy + 0.08, 0, 0.12, 0.02], [-0.19, cy + 0.17, 0, 0.06, 0.012]]);
  const lift: Lift[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const ex = sx * 0.27, ez = sz * 0.27;
    block(b, kit.trim, sx * 0.05, cy - 0.02, sz * 0.05, 0.08, 0.08, 0.04, { ch: 0.02 });
    b.strut(kit.trim, [sx * 0.08, cy + 0.02, sz * 0.08], [ex, cy + 0.06, ez], 0.026, 0.02, 6);
    b.box(kit.accent, 0.05, 0.022, 0.022, sx * 0.16, cy + 0.065, sz * 0.16, 0.004, [0, -Math.atan2(sz, sx), 0]);
    // landing claw
    b.strut(kit.metal, [ex * 0.5, cy - 0.03, ez * 0.5], [ex * 0.62, Y - 0.08, ez * 0.62], 0.012, 0.008, 5);
    lift.push({ kind: 'duct', p: [ex, cy + 0.06, ez], r: 0.1, blades: 5, dir: (sx * sz) as 1 | -1, roll: sz * 0.12, tilt: -sx * 0.08 });
  }
  b.decal(0.08, 0.08, -0.06, cy + 0.135, 0, atlasUV(3), 0);
  return out(cy + 0.2, lift, (m) => hang(c, m, cy - 0.08, 0.7));
}

// =====================================================================================================================
function gunship(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.24;
  fuse(b, kit.hull, [
    [1.38, cy - 0.06, 0.04, 0.04], [1.24, cy - 0.03, 0.15, 0.12], [0.95, cy, 0.25, 0.19], [0.45, cy + 0.02, 0.29, 0.22],
    [-0.1, cy + 0.03, 0.29, 0.23], [-0.5, cy + 0.05, 0.2, 0.16], [-0.85, cy + 0.08, 0.1, 0.085], [-1.32, cy + 0.1, 0.065, 0.055], [-1.46, cy + 0.1, 0.04, 0.035],
  ], 10, 2.6, 0, 0.15);
  // stepped tandem bubble canopies
  pod(b, kit.glass, [0.96, cy + 0.14, 0], 0.22, 0.12, 0.14, 10, 6, 2.2);
  pod(b, kit.glass, [0.56, cy + 0.21, 0], 0.22, 0.12, 0.15, 10, 6, 2.2);
  b.box(kit.trim, 0.03, 0.05, 0.3, 0.76, cy + 0.27, 0, 0.008);
  // chin sensor ball with team eye
  pod(b, kit.trim, [1.16, cy - 0.2, 0], 0.08, 0.08, 0.08, 8, 5);
  b.cyl(kit.glow, 0.035, 0.035, 0.01, [1.235, cy - 0.2, 0], 'x', 8);
  // engine nacelles on the shoulders, intakes and hot exhausts
  for (const s of [-1, 1]) {
    pod(b, kit.panel, [-0.12, cy + 0.24, s * 0.2], 0.36, 0.1, 0.09, 10, 6, 2.4);
    b.cyl(kit.trim, 0.06, 0.06, 0.02, [0.23, cy + 0.24, s * 0.2], 'x', 8);
    b.cyl(kit.hot, 0.055, 0.05, 0.015, [-0.49, cy + 0.25, s * 0.21], '-x', 8);
  }
  // stub wings (anhedral) with tip pylons
  const sw: Station[] = [[0.36, cy - 0.04, 0.16, 0.46, 0.06], [0.32, cy - 0.1, 0.8, 0.32, 0.04]];
  for (const s of [-1, 1]) {
    wing(b, kit.hull, mirror(sw, s));
    b.box(kit.trim, 0.36, 0.08, 0.05, 0.18, cy - 0.1, s * 0.8, 0.01);
    b.box(kit.accent, 0.08, 0.03, 0.055, 0.34, cy - 0.08, s * 0.8, 0.006);
  }
  // tail: horizontal stab with endplate fins, ventral fin
  wing(b, kit.hull, [[-1.18, cy + 0.08, -0.4, 0.2, 0.03], [-1.12, cy + 0.08, 0, 0.26, 0.035], [-1.18, cy + 0.08, 0.4, 0.2, 0.03]]);
  for (const s of [-1, 1]) {
    fin(b, kit.hull, [[-1.14, cy + 0.0, s * 0.4, 0.24, 0.02], [-1.26, cy + 0.26, s * 0.44, 0.15, 0.016]]);
    b.box(kit.glow, 0.05, 0.02, 0.02, -1.2, cy + 0.22, s * 0.445, 0.004);
  }
  fin(b, kit.trim, [[-1.3, cy + 0.06, 0, 0.16, 0.02], [-1.38, cy - 0.12, 0, 0.1, 0.015]]);
  // rotor mast fairing + coax rotor
  pod(b, kit.trim, [0.05, cy + 0.33, 0], 0.2, 0.08, 0.1, 8, 5);
  b.decal(0.16, 0.16, -0.25, cy + 0.315, 0, atlasUV(3), 0);
  const R = 1.12;
  const lift: Lift[] = [{ kind: 'coax', p: [0.05, cy + 0.46, 0], r: R, blades: load(c) > 0.7 ? 4 : 3 }];
  return out(cy + 0.5, lift, (m) => hang(c, m, cy - 0.12));
}

// =====================================================================================================================
function heavyheli(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.32;
  const grav = c.mob.id === 'gravlift';
  const st: [number, number, number, number][] = [
    [1.98, cy - 0.16, 0.1, 0.14], [1.84, cy - 0.1, 0.24, 0.3], [1.55, cy - 0.03, 0.33, 0.37], [1.0, cy, 0.37, 0.39],
    [-1.15, cy + 0.02, 0.37, 0.39], [-1.6, cy + 0.07, 0.3, 0.33], [-1.9, cy + 0.13, 0.17, 0.24],
  ];
  fuse(b, kit.hull, st, 12, 3.4, 0, 0.3);
  // wraparound glazing on the nose, framed
  pod(b, kit.glass, [1.7, cy + 0.02, 0], 0.26, 0.17, 0.3, 12, 6, 2.6);
  b.box(kit.trim, 0.03, 0.04, 0.5, 1.64, cy + 0.17, 0, 0.008);
  // dorsal spine between the rotor pylons
  block(b, kit.trim, -0.15, cy + 0.32, 0, 2.2, 0.34, 0.1, { top: [0.95, 0.7], ch: 0.1, bev: 0.03 });
  // rear ramp hint + hazard band
  b.box(kit.trim, 0.04, 0.3, 0.5, -1.93, cy + 0.08, 0, 0.01, [0, 0, -0.5]);
  b.box(kit.hazard, 0.6, 0.03, 0.04, -0.4, cy - 0.06, 0.39, 0.006);
  b.box(kit.hazard, 0.6, 0.03, 0.04, -0.4, cy - 0.06, -0.39, 0.006);
  // side sponsons with stub pylons to the weapons
  const sw: Station[] = [[0.14, cy - 0.16, 0.42, 0.42, 0.06], [0.12, cy - 0.18, 0.78, 0.32, 0.045]];
  for (const s of [-1, 1]) {
    pod(b, kit.panel, [-0.15, cy - 0.17, s * 0.4], 0.75, 0.16, 0.13, 10, 6, 2.6);
    wing(b, kit.hull, mirror(sw, s));
    b.box(kit.trim, 0.3, 0.06, 0.05, -0.04, cy - 0.19, s * 0.76, 0.01);
    // round portholes
    for (const x of [0.6, 0.15, -0.3]) b.cyl(kit.glass, 0.045, 0.045, 0.012, [x, cy + 0.12, s * 0.385], s > 0 ? 'z' : '-z', 8);
  }
  b.box(kit.lamp, 0.03, 0.03, 0.08, 1.95, cy - 0.08, 0, 0.006);
  const lift: Lift[] = [];
  if (!grav) {
    // forward rotor hump and tall aft rotor tower, twin engines beside the tower
    block(b, kit.hull, 1.12, cy + 0.26, 0, 0.6, 0.36, 0.18, { top: [0.6, 0.6], ch: 0.1, bev: 0.04 });
    block(b, kit.hull, -1.45, cy + 0.24, 0, 0.95, 0.46, 0.66, { top: [0.55, 0.42], shift: [-0.16, 0], ch: 0.13, bev: 0.05 });
    for (const s of [-1, 1]) b.box(kit.glow, 0.3, 0.03, 0.02, -1.5, cy + 0.6, s * 0.15, 0.006, [0, 0, 0.5]);
    for (const s of [-1, 1]) {
      pod(b, kit.panel, [-1.0, cy + 0.42, s * 0.3], 0.42, 0.11, 0.11, 10, 6, 2.4);
      b.cyl(kit.trim, 0.07, 0.07, 0.02, [-0.6, cy + 0.42, s * 0.3], 'x', 10);
      b.cyl(kit.hot, 0.065, 0.06, 0.015, [-1.42, cy + 0.43, s * 0.31], '-x', 10);
    }
    const n = load(c) > 0.75 ? 4 : 3;
    lift.push({ kind: 'rotor', p: [1.12, cy + 0.52, 0], r: 1.25, blades: n, dir: 1 });
    lift.push({ kind: 'rotor', p: [-1.6, cy + 0.98, 0], r: 1.25, blades: n, dir: -1 });
  } else {
    // flat engine deck and outrigger grav pods
    block(b, kit.hull, -0.3, cy + 0.26, 0, 1.8, 0.4, 0.1, { top: [0.9, 0.7], ch: 0.1, bev: 0.03 });
    const xs = load(c) > 0.7 ? [1.2, 0.5, -1.25] : [1.15, -1.25];
    for (const x of xs) for (const s of [-1, 1]) {
      block(b, kit.trim, x, cy - 0.14, s * 0.52, 0.22, 0.36, 0.1, { ch: 0.05, bev: 0.02 });
      lift.push({ kind: 'grav', p: [x, cy - 0.12, s * 0.74], r: 0.27, len: 0.24, dir: s as 1 | -1 });
    }
  }
  b.decal(0.24, 0.24, 0.3, cy + 0.37, 0, atlasUV(3), 0);
  return out(cy + 0.6, lift, (m) => (m.x > 1.2 ? hang(c, m, cy - 0.22, 0.6) : hang(c, m, cy - 0.2)));
}

// =====================================================================================================================
function bomberhull(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.3;
  const grav = c.mob.id === 'gravlift';
  // faceted chined lifting body (hex sections): narrow keel, wide chine, sloped shoulders, a flat ridge; the belly
  // sweeps up into a blunt ramp tail
  const body: [number, number, number, number][] = [ // [x, y bottom, height, half width]
    [1.98, cy - 0.12, 0.16, 0.16], [1.7, cy - 0.24, 0.42, 0.5], [1.15, cy - 0.3, 0.6, 0.7], [0.2, cy - 0.32, 0.64, 0.78],
    [-0.8, cy - 0.28, 0.6, 0.66], [-1.5, cy - 0.12, 0.5, 0.46], [-1.96, cy + 0.02, 0.4, 0.34],
  ];
  b.loft(kit.hull, body.map(([x, y, h, w]) => [[x, y, -w * 0.45], [x, y, w * 0.45], [x, y + h * 0.32, w], [x, y + h * 0.78, w * 0.74], [x, y + h, w * 0.32], [x, y + h, -w * 0.32], [x, y + h * 0.78, -w * 0.74], [x, y + h * 0.32, -w]] as V3[]));
  // chine strakes in the lighter panel colour
  for (const s of [-1, 1]) b.loft(kit.panel, [[1.5, 0.42], [0.2, 0.8], [-1.3, 0.52]].map(([x, w]) => [[x, cy - 0.12, s * (w - 0.02)], [x, cy - 0.1, s * (w + 0.06)], [x, cy - 0.06, s * (w - 0.02)]] as V3[]), true, true);
  // hooded cockpit: visor glass under an armoured brow
  b.loft(kit.glass, [[1.86, 0.2, 0.05], [1.72, 0.4, 0.14], [1.5, 0.48, 0.2]].map(([x, w, h]) => [[x, cy + 0.04, -w * 0.9], [x, cy + 0.04, w * 0.9], [x, cy + 0.04 + h, w * 0.6], [x, cy + 0.04 + h, -w * 0.6]] as V3[]));
  block(b, kit.panel, 1.34, cy + 0.2, 0, 0.5, 0.82, 0.12, { top: [0.7, 0.8], shift: [0.1, 0], ch: 0.14, bev: 0.03 });
  // dorsal spine ridge + glow strip
  block(b, kit.trim, -0.3, cy + 0.3, 0, 1.6, 0.4, 0.1, { top: [0.86, 0.6], ch: 0.1, bev: 0.03 });
  b.box(kit.glow, 1.0, 0.02, 0.03, -0.3, cy + 0.405, 0, 0.005);
  // bomb bay doors
  for (const s of [-1, 1]) b.box(kit.trim, 1.3, 0.02, 0.26, 0.1, cy - 0.325, s * 0.15, 0.006);
  // main wings to the weapon pylons
  const mw: Station[] = [[0.42, cy - 0.08, 0.55, 0.95, 0.1], [0.3, cy - 0.11, 1.04, 0.62, 0.06]];
  // twin canted tail fins on the upswept tail
  for (const s of [-1, 1]) {
    wing(b, kit.hull, mirror(mw, s));
    b.box(kit.accent, 0.16, 0.05, 0.08, 0.22, cy - 0.04, s * 1.04, 0.008);
    fin(b, kit.hull, [[-1.4, cy + 0.26, s * 0.22, 0.42, 0.04], [-1.7, cy + 0.62, s * 0.38, 0.22, 0.03]]);
  }
  b.box(kit.lamp, 0.03, 0.035, 0.1, 1.95, cy - 0.04, 0, 0.006);
  const lift: Lift[] = [];
  const front: V3 = [1.0, cy + 0.02, 1.08], rear: V3 = [-1.12, cy + 0.12, 1.1];
  for (const s of [-1, 1]) {
    // canard stub to the front fan, rear wing to the rear fan
    wing(b, kit.hull, mirror([[1.12, cy, 0.5, 0.36, 0.06], [1.12, front[1] - 0.04, 0.8, 0.3, 0.05]], s));
    wing(b, kit.hull, mirror([[-0.88, cy + 0.08, 0.4, 0.5, 0.07], [-0.95, rear[1] - 0.04, 0.78, 0.36, 0.05]], s));
    if (!grav) {
      lift.push({ kind: 'duct', p: [front[0], front[1], s * front[2]], r: 0.29, blades: 7, dir: s as 1 | -1, tilt: 0.14 });
      lift.push({ kind: 'duct', p: [rear[0], rear[1], s * rear[2]], r: 0.31, blades: 7, dir: -s as 1 | -1, tilt: 0.14 });
    } else {
      lift.push({ kind: 'grav', p: [front[0], front[1] - 0.06, s * (front[2] - 0.12)], r: 0.25, len: 0.2, dir: s as 1 | -1 });
      lift.push({ kind: 'grav', p: [rear[0], rear[1] - 0.06, s * (rear[2] - 0.12)], r: 0.27, len: 0.22, dir: -s as 1 | -1 });
      if (load(c) > 0.75) lift.push({ kind: 'grav', p: [-0.4, cy - 0.32, s * 0.42], r: 0.2, len: 0.16, dir: s as 1 | -1 });
    }
  }
  b.decal(0.3, 0.3, 0.2, cy - 0.0 + 0.06, 0.82, atlasUV(3), 0);
  b.decal(0.3, 0.3, 0.2, cy - 0.0 + 0.06, -0.82, atlasUV(3), 0);
  return out(cy + 0.5, lift, (m) => (m.x > 1 ? hang(c, m, cy - 0.3, 0.6) : hang(c, m, cy - 0.14)));
}

// =====================================================================================================================
function carrier(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.36;
  const keel: [number, number, number, number][] = [
    [1.98, cy, 0.12, 0.22], [1.6, cy + 0.04, 0.34, 0.5], [0.8, cy + 0.06, 0.46, 0.7], [-0.6, cy + 0.08, 0.48, 0.72], [-1.5, cy + 0.08, 0.4, 0.6], [-1.98, cy + 0.06, 0.24, 0.4],
  ];
  fuse(b, kit.hull, keel, 12, 2.8, 0, 0.35);
  const deckY = (x: number) => { let i = 0; while (i < keel.length - 2 && keel[i + 1][0] > x) i++; const p = keel[i], q = keel[i + 1]; const f = (p[0] - x) / (p[0] - q[0]); return p[1] + p[2] + (q[1] + q[2] - p[1] - p[2]) * f; };
  // flight deck plate with runway glow
  block(b, kit.panel, -0.2, deckY(-0.2) - 0.06, 0, 3.2, 0.7, 0.08, { top: [0.96, 0.9], ch: 0.2, bev: 0.02 });
  for (const x of [1.2, 0.6, 0, -0.6, -1.2]) b.box(kit.glow, 0.18, 0.012, 0.03, x, deckY(-0.2) + 0.022, 0, 0.004);
  // hangar mouth at the bow
  b.box(kit.trim, 0.06, 0.2, 0.42, 1.86, cy + 0.02, 0, 0.01, [0, 0, 0.4]);
  b.box(kit.lamp, 0.03, 0.03, 0.36, 1.9, cy + 0.14, 0, 0.006, [0, 0, 0.4]);
  // swept wing-hulls
  const ws: Station[] = [[1.1, cy - 0.06, 0.5, 2.6, 0.36], [0.2, cy - 0.02, 1.9, 1.62, 0.24], [-0.4, cy + 0.04, 2.7, 1.05, 0.18]];
  for (const s of [-1, 1]) {
    wing(b, kit.hull, mirror(ws, s));
    // tip nacelle with intake and glow ring
    pod(b, kit.panel, [-0.75, cy + 0.04, s * 2.72], 0.75, 0.24, 0.22, 12, 6, 2.6);
    b.cylb(kit.trim, 0.16, 0.04, 0.01, [-0.04, cy + 0.04, s * 2.72], 'x', 12);
    b.cyl(kit.hot, 0.14, 0.12, 0.015, [-1.5, cy + 0.04, s * 2.72], '-x', 12);
    navLights(b, kit, -0.75, cy + 0.3, s * 2.72, 0.04);
    // armour plates along the wing root, stripe
    block(b, kit.trim, 0.3, cy + 0.1, s * 1.0, 1.2, 0.28, 0.09, { top: [0.8, 0.7], ch: 0.08, bev: 0.02 });
    b.box(kit.accent, 0.5, 0.02, 0.12, -0.1, cy + 0.15, s * 2.25, 0.006, [0, s * 0.5, 0]);
    // keel rear thrusters
    b.cyl(kit.hot, 0.11, 0.09, 0.02, [-1.99, cy + 0.04, s * 0.2], '-x', 10);
  }
  b.cyl(kit.hot, 0.13, 0.1, 0.02, [-1.99, cy + 0.04, 0], '-x', 10);
  // offset bridge tower (starboard) with glazed band and radar mast
  const tx = -1.2, tz = 0.56, ty = deckY(tx) - 0.06;
  block(b, kit.hull, tx, ty, tz, 0.72, 0.36, 0.5, { top: [0.7, 0.7], shift: [-0.06, 0.02], ch: 0.1, bev: 0.04 });
  b.box(kit.glass, 0.48, 0.07, 0.3, tx + 0.04, ty + 0.38, tz, 0.01);
  block(b, kit.panel, tx - 0.04, ty + 0.5, tz, 0.42, 0.22, 0.12, { top: [0.8, 0.8], ch: 0.06 });
  b.strut(kit.steel, [tx - 0.08, ty + 0.6, tz], [tx - 0.1, ty + 0.95, tz], 0.018, 0.01, 6);
  b.box(kit.metal, 0.06, 0.08, 0.34, tx - 0.1, ty + 0.85, tz, 0.01);
  b.box(kit.glow, 0.03, 0.03, 0.03, tx - 0.1, ty + 0.97, tz, 0.006);
  b.decal(0.5, 0.5, -0.1, cy + 0.16, 1.6, atlasUV(3), 0);
  b.decal(0.5, 0.5, -0.1, cy + 0.16, -1.6, atlasUV(3), 0);
  // grav pods: bow pair, stern pair, wingtip pair (+ mid-wing pair when heavily loaded)
  const lift: Lift[] = [];
  for (const s of [-1, 1] as const) {
    lift.push({ kind: 'grav', p: [1.2, cy - 0.42, s * 0.7], r: 0.3, len: 0.24, dir: s });
    lift.push({ kind: 'grav', p: [-1.45, cy - 0.38, s * 1.15], r: 0.32, len: 0.26, dir: -s as 1 | -1 });
    lift.push({ kind: 'grav', p: [-0.75, cy - 0.3, s * 2.72], r: 0.36, len: 0.28, dir: s });
    if (load(c) > 0.85) lift.push({ kind: 'grav', p: [0.1, cy - 0.3, s * 1.9], r: 0.28, len: 0.22, dir: -s as 1 | -1 });
  }
  return out(cy + 1, lift, (m) => {
    let y: number;
    if (Math.abs(m.z) < 0.5) y = deckY(m.x) + 0.03;
    else { const [lex, wy, ch, t] = at(ws, m.z); void lex; void ch; y = wy + t + 0.04; }
    collar(b, kit, m.x, y, m.z, m.r, y - 0.1, 18);
    return { y, socket: true };
  });
}

// =====================================================================================================================
function interceptor(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.1;
  fuse(b, kit.hull, [
    [1.0, cy - 0.01, 0.012, 0.012], [0.85, cy, 0.05, 0.05], [0.55, cy + 0.01, 0.09, 0.085], [0.2, cy + 0.01, 0.11, 0.11],
    [-0.3, cy, 0.105, 0.11], [-0.75, cy, 0.085, 0.095], [-0.9, cy, 0.078, 0.085],
  ], 10, 2.4);
  pod(b, kit.glass, [0.42, cy + 0.085, 0], 0.2, 0.07, 0.065, 10, 6, 2.2);
  b.box(kit.trim, 0.2, 0.06, 0.1, 0.22, cy - 0.1, 0, 0.01);
  b.box(kit.metal, 0.02, 0.05, 0.085, 0.32, cy - 0.1, 0, 0.004);
  b.strut(kit.steel, [0.98, cy - 0.01, 0], [1.1, cy - 0.01, 0], 0.006, 0.003, 5);
  // forward-swept main wings + canards
  const ws: Station[] = [[-0.25, cy - 0.02, 0.07, 0.48, 0.04], [0.15, cy + 0.0, 0.5, 0.18, 0.016]];
  for (const s of [-1, 1]) {
    wing(b, kit.hull, mirror(ws, s));
    b.box(kit.accent, 0.14, 0.02, 0.04, 0.08, cy + 0.003, s * 0.5, 0.004);
    wing(b, kit.hull, mirror([[0.5, cy + 0.02, 0.07, 0.2, 0.02], [0.4, cy + 0.03, 0.24, 0.08, 0.01]], s));
    // twin canted fins
    fin(b, kit.hull, [[-0.58, cy + 0.06, s * 0.06, 0.28, 0.02], [-0.78, cy + 0.26, s * 0.13, 0.12, 0.014]]);
  }
  navLights(b, kit, 0.12, cy + 0.01, 0.52, 0.016);
  b.decal(0.08, 0.08, -0.1, cy + 0.03, 0.3, atlasUV(3), 0);
  b.decal(0.08, 0.08, -0.1, cy + 0.03, -0.3, atlasUV(3), 0);
  const lift: Lift[] = [{ kind: 'jet', p: [-0.95, cy, 0], r: 0.07, len: 0.12 }];
  return out(cy + 0.25, lift, (m) => hang(c, m, at(ws, m.z)[1] - 0.02, 0.6));
}

// =====================================================================================================================
function strikejet(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.12;
  fuse(b, kit.hull, [
    [1.4, cy - 0.02, 0.02, 0.02], [1.2, cy, 0.1, 0.1], [0.8, cy + 0.02, 0.18, 0.17], [0.2, cy + 0.03, 0.21, 0.2],
    [-0.4, cy + 0.02, 0.17, 0.17], [-0.75, cy + 0.01, 0.08, 0.09], [-0.86, cy, 0.035, 0.04],
  ], 10, 2.4);
  pod(b, kit.glass, [0.72, cy + 0.16, 0], 0.32, 0.12, 0.12, 10, 6, 2.2);
  b.box(kit.trim, 0.03, 0.03, 0.18, 0.62, cy + 0.27, 0, 0.006);
  b.strut(kit.steel, [1.38, cy - 0.02, 0], [1.52, cy - 0.02, 0], 0.008, 0.004, 5);
  // straight tapered wing
  const ws: Station[] = [[0.32, cy - 0.02, 0.15, 0.75, 0.07], [0.02, cy + 0.03, 1.0, 0.4, 0.03]];
  const bz = 0.45;
  for (const s of [-1, 1]) {
    wing(b, kit.hull, mirror(ws, s));
    navLights(b, kit, -0.18, cy + 0.03, 1.0, 0.02);
    b.box(kit.accent, 0.3, 0.015, 0.06, -0.08, cy + 0.055, s * 0.85, 0.004, [0, 0, 0]);
    // engine boom: intake nose, bulged engine, tail
    fuse(b, kit.panel, [
      [0.6, cy - 0.01, 0.05, 0.05], [0.45, cy - 0.005, 0.1, 0.095], [0.0, cy, 0.11, 0.1], [-0.6, cy + 0.01, 0.1, 0.09], [-1.1, cy + 0.02, 0.075, 0.07], [-1.42, cy + 0.02, 0.07, 0.065],
    ], 10, 2.4, s * bz);
    b.cylb(kit.trim, 0.055, 0.03, 0.008, [0.6, cy - 0.01, s * bz], 'x', 10);
    // fins on the boom ends
    fin(b, kit.hull, [[-1.08, cy + 0.06, s * bz, 0.34, 0.025], [-1.25, cy + 0.34, s * bz, 0.18, 0.018]]);
    b.box(kit.glow, 0.04, 0.12, 0.02, -1.3, cy + 0.22, s * (bz + 0.01), 0.004);
  }
  // high tailplane between the fin tops
  wing(b, kit.hull, [[-1.18, cy + 0.32, -bz, 0.18, 0.025], [-1.16, cy + 0.32, 0, 0.2, 0.025], [-1.18, cy + 0.32, bz, 0.18, 0.025]]);
  b.decal(0.12, 0.12, -0.12, cy + 0.06, 0.72, atlasUV(3), 0);
  b.decal(0.12, 0.12, -0.12, cy + 0.06, -0.72, atlasUV(3), 0);
  const lift: Lift[] = [-1, 1].map((s) => ({ kind: 'jet', p: [-1.46, cy + 0.02, s * bz], r: 0.065, len: 0.12 } as Lift));
  return out(cy + 0.4, lift, (m) => (Math.abs(m.z) < 0.2 ? hang(c, m, cy - 0.18, 0.65) : hang(c, m, at(ws, m.z)[1] - 0.02, 0.6)));
}

// =====================================================================================================================
function deltawing(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.1;
  // ogival delta panel: curved leading edge, straight trailing edge
  const ws: Station[] = [[1.0, cy, 0.0, 2.3, 0.13], [0.62, cy, 0.25, 1.9, 0.11], [0.12, cy + 0.01, 0.5, 1.37, 0.075], [-0.45, cy + 0.02, 0.78, 0.78, 0.04], [-0.95, cy + 0.03, 1.0, 0.3, 0.02]];
  for (const s of [-1, 1]) {
    wing(b, kit.hull, mirror(ws, s));
    // leading-edge accent band and elevons
    b.box(kit.accent, 0.3, 0.012, 0.05, -0.9, cy + 0.04, s * 0.94, 0.004, [0, s * -0.0, 0]);
    b.box(kit.trim, 0.12, 0.015, 0.5, -1.26, cy + 0.02, s * 0.55, 0.004);
    navLights(b, kit, -1.12, cy + 0.03, 1.0, 0.018);
  }
  // blended spine, canopy, belly intake
  fuse(b, kit.panel, [
    [1.5, cy, 0.02, 0.02], [1.25, cy + 0.02, 0.09, 0.08], [0.8, cy + 0.05, 0.14, 0.13], [0.0, cy + 0.05, 0.16, 0.17], [-1.0, cy + 0.03, 0.13, 0.2], [-1.3, cy + 0.02, 0.11, 0.2],
  ], 10, 2.4);
  pod(b, kit.glass, [0.86, cy + 0.14, 0], 0.26, 0.09, 0.09, 10, 6, 2.2);
  b.strut(kit.steel, [1.48, cy, 0], [1.62, cy, 0], 0.008, 0.004, 5);
  block(b, kit.trim, 0.2, cy - 0.17, 0, 0.55, 0.22, 0.1, { top: [0.9, 1], shift: [-0.04, 0], ch: 0.04, bev: 0.02 });
  // one tall swept fin
  fin(b, kit.hull, [[-0.55, cy + 0.12, 0, 0.75, 0.04], [-1.08, cy + 0.6, 0, 0.26, 0.022]]);
  b.box(kit.accent, 0.18, 0.12, 0.05, -0.95, cy + 0.45, 0, 0.008);
  b.decal(0.2, 0.2, -0.45, cy + 0.065, 0.5, atlasUV(3), 0);
  b.decal(0.2, 0.2, -0.45, cy + 0.065, -0.5, atlasUV(3), 0);
  const lift: Lift[] = [-1, 1].map((s) => ({ kind: 'jet', p: [-1.33, cy + 0.02, s * 0.12], r: 0.075, len: 0.12 } as Lift));
  return out(cy + 0.6, lift, (m) => (Math.abs(m.z) < 0.2 ? hang(c, m, cy - 0.17, 0.6) : hang(c, m, at(ws, m.z)[1] - at(ws, m.z)[3] * 0.4, 0.6)));
}

// =====================================================================================================================
function stratobomber(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.12;
  // sawtooth flying wing: [le, y, z, chord, thick]; trailing edge zig-zags W
  const ws: Station[] = [[1.75, cy, 0.0, 3.75, 0.42], [1.17, cy, 0.5, 2.5, 0.3], [0.62, cy + 0.01, 1.0, 2.32, 0.17], [0.07, cy + 0.02, 1.5, 1.22, 0.09], [-0.45, cy + 0.04, 1.98, 0.32, 0.035]];
  for (const s of [-1, 1]) {
    wing(b, kit.hull, mirror(ws, s));
    navLights(b, kit, -0.6, cy + 0.06, 1.98, 0.03);
    b.box(kit.accent, 0.4, 0.015, 0.1, -0.45, cy + 0.07, s * 1.75, 0.005, [0, s * 0.6, 0]);
    // engine humps with top intakes
    for (const [x, z, k] of [[-0.15, 0.52, 1], [-0.35, 0.92, 0.82]] as [number, number, number][]) {
      pod(b, kit.panel, [x, cy + 0.1 * k + 0.04, s * z], 0.72 * k, 0.12 * k, 0.2 * k, 10, 6, 2.4);
      b.box(kit.trim, 0.12, 0.05 * k, 0.26 * k, x + 0.42 * k, cy + 0.17 * k + 0.02, s * z, 0.01, [0, 0, -0.3]);
    }
  }
  // cockpit hump with slit windows, dorsal glow
  pod(b, kit.hull, [0.95, cy + 0.2, 0], 0.72, 0.16, 0.36, 12, 6, 2.6);
  for (const s of [-1, 1]) b.box(kit.glass, 0.12, 0.03, 0.14, 1.28, cy + 0.33, s * 0.12, 0.006, [s * 0.3, 0, -0.35]);
  b.box(kit.glow, 0.9, 0.02, 0.03, 0.2, cy + 0.3, 0, 0.005);
  // tail stinger fairing
  pod(b, kit.hull, [-1.82, cy - 0.02, 0], 0.32, 0.1, 0.13, 10, 6, 2.4);
  // bomb bay doors under the centreline
  for (const x of [1.12, 0.32, -0.88]) for (const s of [-1, 1]) b.box(kit.trim, 0.5, 0.02, 0.15, x, cy - 0.27, s * 0.085, 0.006);
  b.decal(0.35, 0.35, -0.4, cy + 0.1, 1.35, atlasUV(3), 0);
  b.decal(0.35, 0.35, -0.4, cy + 0.1, -1.35, atlasUV(3), 0);
  const lift: Lift[] = [];
  for (const s of [-1, 1]) {
    lift.push({ kind: 'jet', p: [-0.86, cy + 0.14, s * 0.52], r: 0.095, len: 0.1 });
    lift.push({ kind: 'jet', p: [-0.94, cy + 0.11, s * 0.92], r: 0.08, len: 0.1 });
    if (load(c) > 0.85) lift.push({ kind: 'jet', p: [-0.9, cy + 0.07, s * 1.3], r: 0.065, len: 0.1 });
  }
  return out(cy + 0.4, lift, (m) => (m.x < -1.5 ? hang(c, m, cy - 0.1, 0.55) : hang(c, m, cy - 0.27, 0.55)));
}

registerChassis('drone', drone);
registerChassis('gunship', gunship);
registerChassis('heavyheli', heavyheli);
registerChassis('bomberhull', bomberhull);
registerChassis('carrier', carrier);
registerChassis('interceptor', interceptor);
registerChassis('strikejet', strikejet);
registerChassis('deltawing', deltawing);
registerChassis('stratobomber', stratobomber);
