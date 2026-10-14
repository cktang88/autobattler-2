// Light / medium non-tank ground hulls. Each one breaks the box with its own plan + height profile and one big
// signature feature (read from the ~58 deg RTS camera first, then the 3/4 view):
//   scout    (wedge)    arrowhead dart buggy: needle nose, wide rear haunches, offset bubble canopy, whip antenna, spoiler
//   raider   (box)      trident catamaran: two pointed gun nacelles flanking a low cockpit pod, rear wing joins the booms
//   carriage (carriage) field-gun carriage: open cradle, notched gun shield wrapped round the front, splayed trail arms
//   hunter   (hunter)   greyhound: long low needle nose, arched spine rising to a rear hump, swept dorsal sensor fin
//   riot     (riot)     bulldozer brute: full-width curved riot plow with a glowing visor slit, twin armoured shoulders
//   striker  (cross)    cross-plan gunship: spear fuselage with a chin gun, stubby wing spar carrying two sponson pods
//   aegis    (round)    turtle medic: domed round shell on a bumper ring, side repair dish mast, glowing halo band
// Hulls work on every mobility: lower hull is clamped inside the running gear (stance.wi) and the wide shoulders start at
// the fender line (stance.yt); legged stances get a hip keel under the belly.

import type { P2, V3 } from '../geo.ts';
import { ellRing, sec8 } from '../geo.ts';
import type { Bld } from '../geo.ts';
import type { Kit, MatLike } from '../materials.ts';
import { registerChassis, type ChassisCtx, type ChassisOut, type MountSpec } from './registry.ts';
import { beam, block, both, collar, dome, glow, hazard, plate, pod, sensor, vent } from './shapes.ts';

/** hull station: [x, yb, y1, y2, yt (heights above y0), wb, wm, wt (half widths)] */
type St = [number, number, number, number, number, number, number, number];

/** chamfered 8-point loft hull from stations; lower hull clamped inside the running gear */
function hull8(c: ChassisCtx, mat: MatLike, st: St[], zc = 0): (x: number, z: number) => number {
  const { b, stance } = c;
  const y0 = stance.y0, wi = stance.wi;
  const rows = st.map(([x, yb, y1, y2, yt, wb, wm, wt]) => {
    let a1 = y0 + y1;
    if (wm > wi + 0.02 && !stance.legs) a1 = Math.max(a1, stance.yt + 0.01);
    const a2 = Math.max(y0 + y2, a1 + 0.01), at = Math.max(y0 + yt, a2 + 0.01);
    return { x, yb: y0 + yb, y1: a1, y2: a2, yt: at, wb: Math.min(wb, wi), wm, wt };
  });
  b.loft(mat, rows.map((r) => sec8(r.x, r.wb, r.wm, r.wt, r.yb, r.y1, r.y2, r.yt).map(([x, y, z]) => [x, y, z + zc] as V3)));
  return (x, z) => {
    if (x < rows[0].x || x > rows[rows.length - 1].x) return -1;
    let i = 0;
    while (i < rows.length - 2 && rows[i + 1].x < x) i++;
    const p = rows[i], q = rows[i + 1], f = (x - p.x) / (q.x - p.x || 1);
    const wt = p.wt + (q.wt - p.wt) * f, wm = p.wm + (q.wm - p.wm) * f, yt = p.yt + (q.yt - p.yt) * f, y2 = p.y2 + (q.y2 - p.y2) * f;
    const az = Math.abs(z - zc);
    if (az <= wt) return yt;
    if (az <= wm) return yt - ((yt - y2) * (az - wt)) / (wm - wt || 1);
    return -1;
  };
}

/** rounded tube along x through stations [x, cy, ry, rz] (superellipse rings) */
function tube(b: Bld, mat: MatLike, z: number, st: [number, number, number, number][], n = 8, pw = 2.6, flat = 0.3): void {
  b.loft(mat, st.map(([x, cy, ry, rz]) => ellRing(x, cy, z, Math.max(0.003, ry), Math.max(0.003, rz), n, pw, flat)));
}

/** vertical fin / plate in the XY plane from a side profile [x, y] (absolute), thickness th, centred on z */
function fin(b: Bld, mat: MatLike, prof: P2[], z: number, th: number, bev = 0.008): void {
  // plate() extrudes a plan polygon along +y; rotating +90 deg about x maps plan z -> -y and height -> +z
  plate(b, mat, prof.map(([x, y]) => [x, -y] as P2), 0, th, bev, [Math.PI / 2, 0, 0], [0, 0, z - th / 2]);
}

/** strip laid on a shield panel: at height fraction f, size h, proud by d, length fraction lf */
interface Strip { f: number; h: number; mat: MatLike; d: number; lf: number; panels?: number[] }

/** curved armour shield from plan points (x, z) left->right: leaning panels of height h from y, lean (rad, + = back) */
function shield(b: Bld, mat: MatLike, pts: P2[], y: number, h: number | number[], th: number, lean: number, strips: Strip[] = []): void {
  const cl = Math.cos(lean), sl = Math.sin(lean);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz) || 1;
    const nx = dz / len, nz = -dx / len; // outward normal (toward +x for a left->right run)
    const yaw = Math.atan2(dx, dz);
    const hh = Array.isArray(h) ? h[i] : h;
    const at = (f: number, d: number): V3 => [(x0 + x1) / 2 - nx * (sl * hh * f - d), y + cl * hh * f, (z0 + z1) / 2 - nz * (sl * hh * f - d)];
    const p = at(0.5, 0);
    b.box(mat, th, hh, len * 1.04, p[0], p[1], p[2], Math.min(th, len) * 0.3, [0, yaw, lean]);
    for (const s of strips) {
      if (s.panels && !s.panels.includes(i)) continue;
      const q = at(s.f, th * 0.5 + s.d);
      b.box(s.mat, th * 0.5, s.h, len * s.lf, q[0], q[1], q[2], Math.min(s.h, th) * 0.25, [0, yaw, lean]);
    }
  }
}

/** hip keel for legged stances: armoured belly block reaching down to the hip drums */
function keel(c: ChassisCtx, l: number, x = 0): void {
  const { b, kit, stance, W } = c;
  if (!stance.legs) return;
  const t = stance.thick;
  const w = stance.legs === 'spider' ? W * 0.5 : Math.max(W * 0.3, W * 0.54 - t * 1.6);
  block(b, kit.trim, x, stance.hipY - t * 0.9, 0, l, w, stance.y0 - stance.hipY + t * 0.95, { top: [1.06, 1.08], ch: t * 0.5, bev: t * 0.12, bot: t * 0.25 });
}

const onGround = (c: ChassisCtx) => c.mob.id === 'wheels' || c.mob.id === 'halftrack' || c.mob.id === 'anchor' || c.mob.id === 'treads';

// ---- scout: arrowhead dart buggy ------------------------------------------------------------------------------------
function scout(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const y0 = stance.y0;
  const X = (f: number) => f * L, Z = (f: number) => f * W;
  const deck = hull8(c, kit.hull, [
    [X(-0.47), 0.03, 0.06, 0.11, 0.16, Z(0.2), Z(0.3), Z(0.22)],
    [X(-0.3), 0, 0.05, 0.12, 0.19, Z(0.24), Z(0.34), Z(0.25)],
    [X(0.06), 0, 0.05, 0.1, 0.16, Z(0.18), Z(0.25), Z(0.15)],
    [X(0.34), 0.03, 0.06, 0.08, 0.1, Z(0.08), Z(0.13), Z(0.07)],
    [X(0.53), 0.06, 0.07, 0.075, 0.08, Z(0.015), Z(0.03), Z(0.012)],
  ]);
  keel(c, L * 0.5, -L * 0.05);
  const topY = y0 + 0.19;
  // rear haunches: fat fender blisters over the drive wheels (the wide end of the arrowhead)
  both((s) => {
    pod(b, kit.hull, [X(-0.3), Math.max(stance.yt, y0 + 0.08) + 0.02, s * Z(0.36)], X(0.2), 0.075, Z(0.1), 8, 5, 2.4, 0.5);
    b.box(kit.glow, X(0.02), 0.03, Z(0.08), X(-0.49), y0 + 0.12, s * Z(0.3), 0.006);
  });
  // gun hump: short armoured cowl under the single mount
  const m = c.mounts[0];
  const mx = m?.x ?? X(0.02), mr = m?.r ?? 0.1;
  const humpY = y0 + 0.215;
  block(b, kit.hull, mx - 0.02, y0 + 0.1, 0, mr * 2.6, mr * 2.3, humpY - y0 - 0.1, { top: [0.8, 0.85], shift: [-0.02, 0], ch: mr * 0.6, bev: 0.015 });
  // offset bubble canopy (left) and a whip antenna (right): asymmetric toy read
  const cx = X(-0.22), cz = -Z(0.14);
  dome(b, kit.trim, [cx, topY - 0.02, cz], 0.1, 0.03, 8, 1);
  dome(b, kit.glass, [cx, topY, cz], 0.085, 0.08, 8, 2);
  b.strut(kit.metal, [X(-0.36), topY - 0.02, Z(0.16)], [X(-0.44), topY + 0.36, Z(0.17)], 0.008, 0.004, 4);
  b.box(kit.accent, 0.07, 0.04, 0.006, X(-0.41), topY + 0.3, Z(0.17), 0.003);
  // rear spoiler wing on two posts, team accent
  both((s) => b.box(kit.trim, 0.03, 0.08, 0.025, X(-0.43), topY + 0.02, s * Z(0.17), 0.006));
  b.box(kit.accent, X(0.1), 0.025, Z(0.52), X(-0.45), topY + 0.07, 0, 0.008, [0, 0, 0.18]);
  // twin exhausts and a nose lamp bar
  both((s) => b.cyl(kit.hot, 0.022, 0.022, 0.02, [X(-0.49), y0 + 0.08, s * Z(0.1)], 'x', 6));
  both((s) => b.box(kit.lamp, 0.03, 0.025, 0.04, X(0.36), y0 + 0.095, s * Z(0.06), 0.006, [0, -s * 0.5, 0]));
  glow(b, kit, X(0.18), y0 + 0.15, 0, X(0.24), 0.012, 0.03, [0, 0, -0.18]);
  // trike: fork fairing over the single front wheel
  if (c.mob.id === 'wheels') {
    const wr = 0.11 + 0.06 * c.S;
    pod(b, kit.hull, [X(0.32), wr * 2 + 0.02, 0], wr * 1.2, 0.045, Z(0.09), 8, 5, 2.4, 0.4);
    both((s) => beam(b, kit.metal, [X(0.3), wr * 2, s * Z(0.07)], [X(0.32), wr, s * Z(0.07)], 0.025, 0.03));
  }
  return {
    deckAt: deck, top: humpY, custom: true,
    seat: (mm) => { collar(b, kit, mm.x, humpY, mm.z, mm.r, humpY - 0.04, 12); return { y: humpY, socket: true }; },
  };
}

// ---- raider: trident catamaran ---------------------------------------------------------------------------------------
function raider(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const y0 = stance.y0;
  const X = (f: number) => f * L, Z = (f: number) => f * W;
  const ny = Math.max(stance.yt + 0.05, y0 + 0.11); // nacelle centre line sits on the fender line
  const nacTop = new Map<MountSpec, number>();
  keel(c, L * 0.5, -L * 0.05);
  // centre cockpit pod: low, pointed, glass bubble
  tube(b, kit.trim, 0, [[X(-0.42), y0 + 0.07, 0.04, Z(0.06)], [X(-0.3), y0 + 0.08, 0.07, Z(0.12)], [X(0.12), y0 + 0.08, 0.075, Z(0.12)], [X(0.4), y0 + 0.07, 0.05, Z(0.07)], [X(0.54), y0 + 0.06, 0.015, Z(0.02)]], 8, 2.4, 0.4);
  pod(b, kit.glass, [X(0.02), y0 + 0.14, 0], X(0.16), 0.06, Z(0.08), 8, 5, 2.2, 0.6);
  // gun nacelles: long pointed booms, mounts on their backs
  both((s) => {
    const m = c.mounts.find((q) => Math.sign(q.z) === s);
    const z = m?.z ?? s * Z(0.24);
    tube(b, kit.hull, z, [[X(-0.48), ny - 0.01, 0.045, Z(0.06)], [X(-0.36), ny, 0.085, Z(0.1)], [X(0.12), ny + 0.005, 0.09, Z(0.105)], [X(0.36), ny - 0.01, 0.065, Z(0.075)], [X(0.56), ny - 0.025, 0.012, Z(0.015)]], 8, 2.6, 0.3);
    // panel cheek and accent tip
    b.box(kit.panel, X(0.3), 0.04, 0.02, X(-0.12), ny + 0.01, z + s * Z(0.1), 0.008, [s * 0.25, 0, 0]);
    b.box(kit.accent, X(0.08), 0.03, Z(0.06), X(0.42), ny + 0.035, z, 0.008, [0, 0, -0.25]);
    b.cyl(kit.hot, 0.04, 0.04, 0.02, [X(-0.5), ny, z], 'x', 8);
    b.box(kit.lamp, 0.02, 0.025, 0.035, X(0.45), ny - 0.01, z, 0.005);
    if (m) nacTop.set(m, ny + 0.085);
  });
  // bridge spar between the booms and a rear wing joining their tails
  block(b, kit.trim, X(-0.12), ny - 0.06, 0, X(0.26), Z(0.5), 0.06, { ch: 0.03, bev: 0.01 });
  b.box(kit.hull, X(0.14), 0.025, Z(0.62), X(-0.42), ny + 0.12, 0, 0.008, [0, 0, 0.2]);
  both((s) => b.box(kit.trim, 0.04, 0.09, 0.025, X(-0.42), ny + 0.07, s * Z(0.22), 0.006));
  glow(b, kit, X(-0.42), ny + 0.135, 0, X(0.03), 0.01, Z(0.36));
  const top = ny + 0.09;
  return {
    deckAt: (x, z) => (Math.abs(x) < X(0.4) && Math.abs(Math.abs(z) - Z(0.24)) < Z(0.1) ? top : -1), top, custom: true,
    seat: (m) => {
      const y = nacTop.get(m) ?? top;
      collar(b, kit, m.x, y + 0.01, m.z, m.r, y - 0.04, 12);
      return { y: y + 0.01, socket: true };
    },
  };
}

// ---- carriage: field-gun carriage ---------------------------------------------------------------------------------------
function carriage(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const y0 = stance.y0;
  const X = (f: number) => f * L, Z = (f: number) => f * W;
  const m = c.mounts[0];
  const mr = m?.r ?? 0.16, mx = m?.x ?? 0;
  keel(c, L * 0.4);
  // cradle: dark box between the wheels, lighter turntable deck on top
  block(b, kit.trim, X(-0.04), y0, 0, X(0.46), Math.min(Z(0.36), stance.wi * 2), 0.1, { top: [0.9, 0.9], ch: 0.04, bev: 0.012 });
  const deckY = y0 + 0.15;
  b.cylb(kit.hull, mr * 1.35, deckY - y0 - 0.08, 0.015, [mx, y0 + 0.08, 0], 'y', 8);
  // trail arms splayed back to spades (on the ground when the carriage is parked on wheels / anchored)
  const ty = onGround(c) ? 0.03 : y0 - 0.01;
  both((s) => {
    beam(b, kit.hull, [X(-0.16), y0 + 0.06, s * Z(0.09)], [X(-0.6), ty + 0.04, s * Z(0.3)], 0.05, 0.06);
    block(b, kit.hazard, X(-0.62), ty, s * Z(0.31), 0.05, 0.1, 0.09, { top: [0.6, 1], shift: [-0.02, 0], ch: 0.012, bev: 0.008 });
    b.box(kit.panel, 0.1, 0.05, 0.06, X(-0.38), y0 + 0.05 - (y0 + 0.02 - ty) * 0.5, s * Z(0.2), 0.01, [0, s * 0.45, 0]);
  });
  // notched gun shield wrapped round the front: the carriage's whole silhouette
  const R = Math.max(mr * 1.7, Z(0.32));
  const pts: P2[] = [];
  for (let i = 0; i <= 5; i++) { const a = -1.15 + (i / 5) * 2.3; pts.push([mx + Math.cos(a) * R * 0.85, Math.sin(a) * R]); }
  shield(b, kit.panel, pts, y0 + 0.04, [0.27, 0.3, 0.17, 0.3, 0.27], 0.035, 0.25);
  both((s) => b.box(kit.accent, 0.04, 0.03, 0.06, mx + Math.cos(0.92) * R * 0.85 - 0.05, y0 + 0.31, s * Math.sin(0.92) * R, 0.006, [0, 0, 0.25]));
  sensor(b, kit, mx + R * 0.7, y0 + 0.27, -Z(0.2), 0.05, kit.lamp);
  // ammo crate on the left trail
  block(b, kit.canvas, X(-0.36), y0 + 0.02, -Z(0.13), 0.14, 0.1, 0.07, { ch: 0.02, bev: 0.01 });
  return {
    deckAt: (x, z) => (Math.hypot(x - mx, z) < mr * 1.3 ? deckY : -1), top: deckY, custom: true,
    seat: (mm) => { collar(b, kit, mm.x, deckY, mm.z, mm.r, deckY - 0.05, 12); return { y: deckY, socket: true }; },
  };
}

// ---- hunter: greyhound ---------------------------------------------------------------------------------------------------
function hunter(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const y0 = stance.y0;
  const X = (f: number) => f * L / 2, Z = (f: number) => f * W; // authored at L=2, W=1
  const deck = hull8(c, kit.hull, [
    [X(-0.96), 0.05, 0.1, 0.2, 0.28, Z(0.18), Z(0.28), Z(0.18)],
    [X(-0.8), 0, 0.08, 0.22, 0.34, Z(0.26), Z(0.38), Z(0.26)],
    [X(-0.4), 0, 0.07, 0.18, 0.27, Z(0.27), Z(0.39), Z(0.25)],
    [X(0.1), 0, 0.06, 0.15, 0.23, Z(0.25), Z(0.36), Z(0.22)],
    [X(0.55), 0.02, 0.06, 0.11, 0.15, Z(0.18), Z(0.27), Z(0.15)],
    [X(0.88), 0.05, 0.07, 0.09, 0.105, Z(0.08), Z(0.14), Z(0.07)],
    [X(1.02), 0.07, 0.075, 0.085, 0.09, Z(0.02), Z(0.04), Z(0.015)],
  ]);
  keel(c, L * 0.42, -L * 0.1);
  const sorted = [...c.mounts].sort((a, q) => q.x - a.x);
  const front = sorted[0], rear = sorted[1];
  // swept dorsal sensor fin between the guns: the hunter's signature
  const fx0 = (rear ? rear.x + rear.r * 1.3 : X(-0.4)), fx1 = (front ? front.x - front.r * 1.4 : X(-0.05));
  const fy = deck((fx0 + fx1) / 2, 0) - 0.02;
  fin(b, kit.hull, [[fx0, fy], [fx1, fy], [fx0 + (fx1 - fx0) * 0.2, fy + 0.34], [fx0 - 0.02, fy + 0.34]], 0, 0.04);
  b.box(kit.accent, 0.12, 0.05, 0.05, fx0 + 0.03, fy + 0.33, 0, 0.008);
  glow(b, kit, (fx0 + fx1) / 2 - 0.02, fy + 0.12, 0, (fx1 - fx0) * 0.5, 0.015, 0.05, [0, 0, 0.9]);
  // cheek intakes and a long glow line down each flank; lamp eyes in the needle nose
  both((s) => {
    b.box(kit.trim, X(0.3), 0.06, 0.03, X(0.2), y0 + 0.12, s * Z(0.37), 0.01, [0, s * 0.12, 0]);
    glow(b, kit, X(-0.2), y0 + 0.17, s * Z(0.355), X(0.9), 0.014, 0.014, [s * 0.5, 0, 0]);
    b.box(kit.lamp, 0.03, 0.02, 0.04, X(0.86), y0 + 0.1, s * Z(0.07), 0.005, [0, -s * 0.5, 0]);
    b.cyl(kit.hot, 0.03, 0.03, 0.02, [X(-0.98), y0 + 0.17, s * Z(0.1)], 'x', 6);
  });
  vent(b, kit, X(-0.86), deck(X(-0.86), 0) - 0.005, 0, 0.1, Z(0.3), 2, 'x');
  const top = deck(X(-0.8), 0);
  return {
    deckAt: deck, top: top + 0.06, custom: true,
    seat: (m) => {
      const base = Math.max(deck(m.x, m.z), deck(m.x + m.r * 0.8, 0), deck(m.x - m.r * 0.8, 0));
      const y = base + (m === front ? 0.05 : 0.03);
      if (m === front) block(b, kit.hull, m.x, base - 0.04, m.z, m.r * 2.4, m.r * 2.2, y - base + 0.04, { top: [0.86, 0.86], ch: m.r * 0.6, bev: 0.012 });
      collar(b, kit, m.x, y, m.z, m.r, base - 0.02, 14);
      return { y, socket: true };
    },
  };
}

// ---- riot: bulldozer brute -----------------------------------------------------------------------------------------------
function riot(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const y0 = stance.y0;
  const X = (f: number) => f * L / 2, Z = (f: number) => f * W / 3; // authored at L=2, W=3
  const deck = hull8(c, kit.hull, [
    [X(-0.98), 0.06, 0.1, 0.22, 0.3, Z(0.5), Z(0.62), Z(0.45)],
    [X(-0.78), 0, 0.09, 0.26, 0.4, Z(0.8), Z(0.98), Z(0.72)],
    [X(-0.2), 0, 0.09, 0.28, 0.44, Z(1.0), Z(1.22), Z(0.92)],
    [X(0.6), 0.03, 0.1, 0.26, 0.38, Z(1.0), Z(1.3), Z(0.86)],
  ]);
  keel(c, L * 0.5, -L * 0.1);
  const topY = deck(0, 0);
  // the plow: full-width curved riot shield leaning back, taller in the middle, a visor slit and hazard teeth
  const pts: P2[] = [];
  const n = 6, half = Z(1.48);
  for (let i = 0; i <= n; i++) { const z = -half + (2 * half * i) / n; pts.push([X(0.86) - X(0.22) * (z / half) ** 2, z]); }
  const ph = [0.46, 0.56, 0.62, 0.62, 0.56, 0.46].map((h) => h * Math.max(1, W / 3) * 1.0);
  shield(b, kit.panel, pts, y0 - 0.02, ph, 0.09, 0.42, [
    { f: 0.74, h: 0.08, mat: kit.trim, d: 0, lf: 0.98, panels: [1, 2, 3, 4] },
    { f: 0.74, h: 0.028, mat: kit.glow, d: 0.012, lf: 0.86, panels: [1, 2, 3, 4] },
    { f: 0.1, h: 0.07, mat: kit.hazard, d: 0, lf: 0.45 },
    { f: 0.1, h: 0.069, mat: kit.trim, d: -0.002, lf: 0.98 },
  ]);
  // twin armoured shoulders under the guns (octagonal drums), a sunken spine between them, engine block behind
  const shY = topY + 0.1;
  for (const m of c.mounts) {
    b.lathe(kit.hull, [[0, -0.12], [m.r * 1.65, -0.12], [m.r * 1.65, -0.03], [m.r * 1.38, 0.0], [0, 0.0]], [m.x, shY, m.z], 'y', 8);
    b.box(kit.accent, m.r * 0.9, 0.02, 0.05, m.x - m.r * 1.1, shY - 0.04, m.z + Math.sign(m.z) * m.r * 1.55, 0.006, [0, Math.sign(m.z) * 0.35, 0]);
  }
  block(b, kit.trim, X(-0.86), topY - 0.04, 0, X(0.26), Z(0.9), 0.12, { top: [0.8, 0.9], ch: 0.06, bev: 0.02 });
  vent(b, kit, X(-0.86), topY + 0.08, 0, X(0.18), Z(0.66), 3, 'x');
  both((s) => {
    // side bumpers: fat rubber rams at the front corners
    b.cylb(kit.rubber, 0.09, X(0.3), 0.03, [X(0.42), y0 + 0.16, s * Z(1.36)], 'x', 8);
    b.box(kit.lamp, 0.03, 0.05, 0.07, X(0.62), y0 + 0.28, s * Z(1.0), 0.01);
    b.cyl(kit.hot, 0.04, 0.04, 0.02, [X(-0.98), topY - 0.05, s * Z(0.3)], 'x', 8);
    b.box(kit.glow, 0.02, 0.03, Z(0.3), X(-0.97), topY - 0.14, s * Z(0.8), 0.006);
  });
  return {
    deckAt: deck, top: shY, custom: true,
    seat: (m) => { collar(b, kit, m.x, shY, m.z, m.r, shY - 0.05, 14); return { y: shY, socket: true }; },
  };
}

// ---- striker: cross-plan gunship ------------------------------------------------------------------------------------------
function striker(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const y0 = stance.y0;
  const X = (f: number) => f * L / 3, Z = (f: number) => f * W / 2; // authored at L=3, W=2
  const deck = hull8(c, kit.hull, [
    [X(-1.48), 0.06, 0.12, 0.24, 0.32, Z(0.24), Z(0.32), Z(0.22)],
    [X(-1.2), 0, 0.1, 0.27, 0.4, Z(0.3), Z(0.4), Z(0.28)],
    [X(0.25), 0, 0.1, 0.27, 0.42, Z(0.3), Z(0.4), Z(0.27)],
    [X(0.95), 0.02, 0.1, 0.22, 0.32, Z(0.24), Z(0.34), Z(0.2)],
    [X(1.35), 0.05, 0.1, 0.15, 0.19, Z(0.12), Z(0.19), Z(0.1)],
    [X(1.55), 0.08, 0.1, 0.11, 0.12, Z(0.03), Z(0.05), Z(0.02)],
  ]);
  keel(c, L * 0.4, -L * 0.05);
  const sorted = [...c.mounts].sort((a, q) => Math.abs(a.z) - Math.abs(q.z));
  const nose = sorted[0]?.cls === 'S' || (sorted[0] && Math.abs(sorted[0].z) < 0.2) ? sorted[0] : undefined;
  const side = c.mounts.filter((m) => m !== nose);
  // wing spar + sponson pods: the cross arms, riding just above the fender line
  const sy = Math.max(stance.yt + 0.1, y0 + 0.2);
  const podTop = new Map<MountSpec, number>();
  block(b, kit.trim, X(-0.05), sy - 0.07, 0, X(0.5), Z(1.3), 0.1, { top: [0.8, 0.96], ch: 0.06, bev: 0.02 });
  both((s) => {
    const m = side.find((q) => Math.sign(q.z) === s);
    const z = m?.z ?? s * Z(0.66), mx = m?.x ?? 0;
    const ry = 0.13, rz = Z(0.17);
    tube(b, kit.hull, z, [[mx - X(0.62), sy, 0.06, rz * 0.5], [mx - X(0.48), sy + 0.01, ry, rz], [mx + X(0.3), sy + 0.01, ry, rz], [mx + X(0.55), sy - 0.01, ry * 0.6, rz * 0.6], [mx + X(0.68), sy - 0.02, 0.02, 0.02]], 8, 2.6, 0.35);
    b.box(kit.panel, X(0.5), 0.03, rz * 0.6, mx - X(0.1), sy + ry * 0.4, z + s * rz * 0.75, 0.008, [s * 0.6, 0, 0]);
    b.cyl(kit.glow, 0.035, 0.035, 0.02, [mx + X(0.6), sy - 0.015, z], 'x', 8);
    b.cyl(kit.hot, 0.045, 0.045, 0.02, [mx - X(0.64), sy, z], '-x', 8);
    if (m) podTop.set(m, sy + ry + 0.005);
  });
  // chin gun cowl on the nose, offset canopy, mast, twin rear nozzles
  const nx = nose?.x ?? X(0.9);
  const ny = deck(nx, 0) + 0.04;
  block(b, kit.hull, nx - 0.02, deck(nx, 0) - 0.05, 0, (nose?.r ?? 0.12) * 2.6, (nose?.r ?? 0.12) * 2.3, 0.09, { top: [0.82, 0.86], ch: 0.04, bev: 0.012 });
  pod(b, kit.glass, [X(0.45), deck(X(0.45), 0) - 0.01, -Z(0.13)], X(0.26), 0.07, Z(0.1), 8, 5, 2.2, 0.6);
  b.strut(kit.metal, [X(-0.9), deck(X(-0.9), 0), Z(0.18)], [X(-1.0), deck(X(-0.9), 0) + 0.45, Z(0.18)], 0.01, 0.005, 4);
  both((s) => {
    b.cylb(kit.metal, 0.07, 0.1, 0.015, [X(-1.5), y0 + 0.2, s * Z(0.13)], '-x', 8);
    b.cyl(kit.hot, 0.05, 0.05, 0.01, [X(-1.6), y0 + 0.2, s * Z(0.13)], '-x', 8);
    glow(b, kit, X(0.2), deck(X(0.2), 0) - 0.06, s * Z(0.36), X(0.9), 0.016, 0.016, [s * 0.5, 0, 0]);
    b.box(kit.lamp, 0.02, 0.025, 0.05, X(1.36), y0 + 0.16, s * Z(0.11), 0.005, [0, -s * 0.5, 0]);
  });
  hazard(b, kit, X(1.15), deck(X(1.15), 0) + 0.005, 0, X(0.2), Z(0.12), 3);
  vent(b, kit, X(-1.15), deck(X(-1.15), 0) - 0.005, 0, X(0.24), Z(0.36), 3, 'x');
  return {
    deckAt: deck, top: deck(0, 0), custom: true,
    seat: (m) => {
      const pt = podTop.get(m);
      if (pt !== undefined) { collar(b, kit, m.x, pt, m.z, m.r, pt - 0.06, 14); return { y: pt, socket: true }; }
      collar(b, kit, m.x, ny, m.z, m.r, ny - 0.06, 12);
      return { y: ny, socket: true };
    },
  };
}

// ---- aegis: turtle medic --------------------------------------------------------------------------------------------------
function aegis(c: ChassisCtx): ChassisOut {
  const { b, kit, L, W, stance } = c;
  const y0 = stance.y0;
  const u = Math.min(L, W) / 2;
  const cx = -0.08 * u;
  const lo = Math.max(stance.yt - y0, 0.06 * u);
  keel(c, L * 0.4, cx);
  // lower body inside the gear, bumper ring at the fender line, then the shell dome
  b.lathe(kit.trim, [[0, 0], [Math.min(0.7 * u, stance.wi), 0], [Math.min(0.78 * u, stance.wi + 0.05), lo], [0, lo]], [cx, y0, 0], 'y', 10);
  b.lathe(kit.panel, [[0, 0], [0.86 * u, 0], [0.96 * u, 0.04 * u], [0.96 * u, 0.1 * u], [0.88 * u, 0.13 * u], [0, 0.13 * u]], [cx, y0 + lo, 0], 'y', 12);
  const dy = y0 + lo + 0.12 * u;
  const prof: P2[] = [[0, 0], [0.88 * u, 0], [0.82 * u, 0.12 * u], [0.66 * u, 0.26 * u], [0.42 * u, 0.36 * u], [0, 0.4 * u]];
  b.lathe(kit.hull, prof, [cx, dy, 0], 'y', 12);
  // glowing halo band around the shell (repair aura)
  b.lathe(kit.glow, [[0.79 * u, 0.13 * u], [0.81 * u, 0.13 * u], [0.75 * u, 0.2 * u], [0.73 * u, 0.2 * u]], [cx, dy, 0], 'y', 12);
  // sensor face on the front slope
  b.box(kit.trim, 0.06 * u, 0.1 * u, 0.36 * u, cx + 0.74 * u, dy + 0.14 * u, 0, 0.015, [0, 0, -0.8]);
  b.box(kit.glow, 0.03 * u, 0.03 * u, 0.28 * u, cx + 0.77 * u, dy + 0.15 * u, 0, 0.006, [0, 0, -0.8]);
  both((s) => b.box(kit.lamp, 0.03, 0.04 * u, 0.07 * u, cx + 0.93 * u, y0 + lo + 0.07 * u, s * 0.42 * u, 0.006, [0, -s * 0.45, 0]));
  // medic cross plates on both flanks
  both((s) => {
    const px = cx - 0.05 * u, pz = s * 0.68 * u, py = dy + 0.2 * u;
    b.box(kit.panel, 0.26 * u, 0.04, 0.26 * u, px, py, pz, 0.01, [s * 0.6, 0, 0]);
    b.box(kit.accent, 0.18 * u, 0.05, 0.06 * u, px, py + 0.01, pz + s * 0.006, 0.004, [s * 0.6, 0, 0]);
    b.box(kit.accent, 0.06 * u, 0.05, 0.18 * u, px, py + 0.01, pz + s * 0.006, 0.004, [s * 0.6, 0, 0]);
  });
  // repair dish mast, offset right: the support silhouette
  const mx = cx - 0.3 * u, mz = 0.48 * u, my = dy + 0.28 * u;
  b.cylb(kit.trim, 0.09 * u, 0.06 * u, 0.01, [mx, my - 0.04 * u, mz], 'y', 8);
  b.strut(kit.metal, [mx, my, mz], [mx + 0.02 * u, my + 0.42 * u, mz], 0.03 * u, 0.025 * u, 6);
  const da: V3 = [mx + 0.06 * u, my + 0.44 * u, mz];
  b.lathe(kit.panel, [[0, -0.02 * u], [0.2 * u, 0.06 * u], [0.22 * u, 0.09 * u], [0.18 * u, 0.08 * u], [0, 0.0]], da, 'y', 10, [0, 0, -0.9]);
  b.strut(kit.steel, da, [da[0] + 0.14 * u, da[1] + 0.11 * u, mz], 0.01 * u, 0.008 * u, 4);
  b.cyl(kit.glow, 0.03 * u, 0.03 * u, 0.03 * u, [da[0] + 0.14 * u, da[1] + 0.1 * u, mz], 'y', 6);
  // whip antennas
  b.strut(kit.metal, [cx - 0.5 * u, dy + 0.2 * u, -0.4 * u], [cx - 0.62 * u, dy + 0.72 * u, -0.42 * u], 0.008, 0.004, 4);
  const dome0 = (x: number, z: number) => {
    const r = Math.hypot(x - cx, z);
    if (r > 0.96 * u) return -1;
    for (let i = 0; i < prof.length - 1; i++) if (r >= prof[i + 1][0]) {
      const [r0, h0] = prof[i + 1], [r1, h1] = prof[i];
      return dy + h0 + ((h1 - h0) * (r - r0)) / (r1 - r0 || 1);
    }
    return dy + 0.4 * u;
  };
  const sorted = [...c.mounts].sort((a, q) => q.x - a.x);
  return {
    deckAt: (x, z) => (dome0(x, z) < 0 ? -1 : Math.max(dome0(x, z), y0 + lo)), top: dy + 0.4 * u, custom: true,
    seat: (m) => {
      if (m === sorted[0]) {
        const y = dy + 0.41 * u;
        collar(b, kit, m.x, y, m.z, m.r, y - 0.06 * u, 14);
        return { y, socket: true };
      }
      // rear gun on a short armoured tower rising off the back of the shell
      const base = Math.max(dome0(m.x, m.z), y0 + lo + 0.1 * u);
      const y = Math.max(base + 0.1 * u, dy + 0.24 * u);
      block(b, kit.hull, m.x + 0.04 * u, y0 + lo + 0.1 * u, m.z, m.r * 2.6, m.r * 2.4, y - (y0 + lo + 0.1 * u), { top: [0.86, 0.9], ch: m.r * 0.6, bev: 0.015 });
      collar(b, kit, m.x, y, m.z, m.r, y - 0.05, 12);
      return { y, socket: true };
    },
  };
}

registerChassis('wedge', scout);
registerChassis('box', raider);
registerChassis('carriage', carriage);
registerChassis('hunter', hunter);
registerChassis('riot', riot);
registerChassis('cross', striker);
registerChassis('round', aegis);
