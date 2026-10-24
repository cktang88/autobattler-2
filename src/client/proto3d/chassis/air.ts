// Aircraft: every flying chassis gets its own airframe built from the aero kit (chassis/aero-kit.ts) and places its
// own lift units (AirOut.lift, rendered by mobility/air.ts) according to its mobility and how heavily it is loaded
// (chassis + module weight vs. the mobility's capacity for this size): more / bigger fans, rotors, nozzles or grav
// pods for heavier frames.
//
//   drone        compact quad-fan recon drone: faceted avionics body, sensor turret, four ducted fans on box arms
//   gunship      Ka-50-style coaxial attack heli: faceted armoured tandem cockpit, shoulder turboshafts, tail boom
//                with twin endplate fins, anhedral stub wings with tip pods
//   heavyheli    tandem-rotor hauler (Chinook-like): boxy cabin, framed nose glazing, side sponsons, tall aft pylon
//                with twin turboshafts (grav: reactor hump, H-tail and outrigger pods)
//   bomberhull   chined lifting-body bomber with a hooded cockpit, four tilting ducted fans (grav: four to six pods)
//   carrier      wide manta flying fortress: keel hull, swept wing-hulls with tip nacelles, offset bridge, grav pods
//   interceptor  slender single-engine fighter: forward-swept wings, canards, twin canted fins, side intakes
//   strikejet    twin-boom fighter-bomber: bubble-canopy central pod, engines in the booms, high tail between them
//   deltawing    ogival tailless delta with one tall fin, a chin intake and twin buried engines
//   stratobomber sawtooth flying wing with a cockpit hump, dorsal engine humps and exhaust troughs, tail stinger
//   (the giant / titan bombers - strategic, superfortress, dreadnought airship - live in bombers.ts)
//
// Paint (per real aircraft, see aero-kit.ts): jets wear light-grey shell on fuselage and wings with the muted team
// armour on fins, wingtips and radome-adjacent panels; helicopters and rotor craft wear the muted team armour (their
// "camo") with grey shell cowlings; mechanics (intakes, nozzles, seams, walkways) are near-black; full-chroma team
// accent only on small top-surface stripes, chevrons and roundels.
//
// Frame: belly reference y0 = stance.y0 (the render lifts the unit to cruise altitude). Weapons are fixed pods hung
// from pylons under wings / fuselage at the exact mount points (seat() builds the pylon, socket = true); carrier deck
// guns sit on collars.

import { atlasUV } from '../materials.ts';
import type { Bld, MatLike, V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerChassis, type ChassisCtx, type MountSpec, type Seat } from './registry.ts';
import { collar } from './shapes.ts';
import { type AirOut, type Lift } from '../mobility/air.ts';
import {
  Fuse, SEC_BOX, SEC_JET, aeroFin, bx, aeroWing, bladeAntenna, canopy, foil, fuselage, gearDoors, intake, mirrorSt, nacelle,
  overSkin, panelBreak, pitot, pylon, ribbon, sensorBall, sides, skinPanel, soot, spinePanel, stAt, wingSkin, type Station,
} from './aero-kit.ts';

export type { Station } from './aero-kit.ts';

/** wing / tailplane panel through spanwise stations (plain loft, no surface breaks) */
export function wing(b: Bld, mat: MatLike, st: Station[]): void {
  b.loft(mat, st.map(([x, y, z, c, t]) => foil([x, y, z], c, t, 'y')));
}
/** fin through stations ordered root -> tip; each station [le x, y, z, chord, thickness] with thickness along z */
export function fin(b: Bld, mat: MatLike, st: Station[]): void {
  b.loft(mat, st.map(([x, y, z, c, t]) => foil([x, y, z], c, t, 'z')));
}
/** interpolate a station table at span coordinate z (abs) -> [lex, y, chord, thick] */
export function at(st: Station[], z: number): [number, number, number, number] {
  const [x, y, , c, t] = stAt(st, z);
  return [x, y, c, t];
}
export const mirror = mirrorSt;
/** underside of a wing at span z (pylon root height) */
export const under = (st: Station[], z: number) => { const [, y, , t] = at(st, z); return y - t * 0.6; };
/** top skin of a wing at span z (40% chord: the thickest point) */
export const over = (st: Station[], z: number) => { const [, y, , t] = at(st, z); return y + t; };

/** fixed weapon pod hung below yUnder on a swept pylon at the mount point */
export function hang(c: ChassisCtx, m: MountSpec, yUnder: number, drop = 0.8): Seat {
  const { b, kit } = c;
  const d = m.r * drop;
  const y = yUnder - d;
  pylon(b, kit, m.x - m.r * 0.05, yUnder, y + d * 0.55 + 0.012, m.z, Math.max(0.09, m.r * 1.4), Math.max(0.018, m.r * 0.2));
  return { y, socket: true };
}
/** nav lights (team accent left, glow right) at a wingtip pair */
export function navLights(b: Bld, kit: Kit, x: number, y: number, z: number, s: number): void {
  bx(b, kit.accent, s * 1.6, s, s, x, y, -z);
  bx(b, kit.glow, s * 1.6, s, s, x, y, z);
}
/** load ratio: (chassis + modules weight) / mobility capacity at this size */
export function load(c: ChassisCtx): number {
  const w = c.ch.weight + c.mounts.reduce((a, m) => a + (m.mod.weight ?? 0), 0);
  const cap = c.mob.capacity?.[c.S - 1] ?? 0;
  return cap > 0 ? w / cap : 0.6;
}
export const out = (top: number, lift: Lift[], seat: (m: MountSpec) => Seat): AirOut => ({ deckAt: () => -1, top, custom: true, seat, lift });
/** flat roundel / chevron decal on a top surface */
const roundel = (b: Bld, s: number, x: number, y: number, z: number) => b.decal(s, s, x, y + 0.004, z, atlasUV(3), 0);
const chevron = (b: Bld, s: number, x: number, y: number, z: number) => b.decal(s, s, x, y + 0.004, z, atlasUV(1), 0);

// =====================================================================================================================
function drone(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.12;
  // faceted avionics body: boxy, a raked nose with the sensor turret under it, flat top deck
  const F = new Fuse([[0.21, cy - 0.01, 0.035, 0.07], [0.17, cy, 0.075, 0.12], [0.05, cy + 0.01, 0.09, 0.14], [-0.12, cy + 0.01, 0.085, 0.13], [-0.2, cy + 0.01, 0.06, 0.09]], 0, SEC_BOX);
  fuselage(b, kit.armor, F);
  spinePanel(b, kit.shell, F, 0.14, -0.17, 0.003, 0.006);
  panelBreak(b, kit, F, 0.09, 0.008);
  panelBreak(b, kit, F, -0.08, 0.008);
  sensorBall(b, kit, 0.13, F.bot(0.13) + 0.01, 0, 0.045);
  // battery / avionics hatch with a vent, GPS puck, whip antenna, tail fin
  bx(b, kit.mech, 0.07, 0.008, 0.08, -0.04, F.top(-0.04) + 0.006, 0);
  b.cyl(kit.joint, 0.016, 0.016, 0.01, [0.06, F.top(0.06) + 0.004, 0.05], 'y', 8);
  b.strut(kit.steel, [-0.1, F.top(-0.1), -0.05], [-0.16, F.top(-0.1) + 0.2, -0.065], 0.005, 0.003, 4);
  aeroFin(b, kit, [[-0.13, F.top(-0.15) - 0.01, 0, 0.1, 0.014], [-0.19, F.top(-0.15) + 0.08, 0, 0.05, 0.008]], { mat: kit.armor2 });
  bx(b, kit.lamp, 0.012, 0.012, 0.03, 0.2, cy + 0.02, 0);
  const lift: Lift[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const ex = sx * 0.27, ez = sz * 0.27;
    // box-section arm out to the fan, a stripe on the front arms, landing skid leg
    const a: V3 = [sx * 0.07, cy + 0.02, sz * 0.08], e: V3 = [ex, cy + 0.05, ez];
    b.strut(kit.shell, a, e, 0.017, 0.014, 4);
    b.strut(kit.mech, [a[0], a[1] - 0.012, a[2]], [e[0] * 0.92, e[1] - 0.014, e[2] * 0.92], 0.008, 0.008, 4);
    if (sx > 0) bx(b, kit.accent, 0.04, 0.01, 0.02, sx * 0.17, cy + 0.054, sz * 0.17, [0, -Math.atan2(sz, sx), 0]);
    b.strut(kit.joint, [ex * 0.42, cy - 0.04, ez * 0.42], [ex * 0.56, Y - 0.08, ez * 0.56], 0.007, 0.005, 4);
    lift.push({ kind: 'duct', p: [ex, cy + 0.06, ez], r: 0.1, blades: 5, dir: (sx * sz) as 1 | -1, roll: sz * 0.12, tilt: -sx * 0.08 });
  }
  for (const sz of [-1, 1]) b.strut(kit.joint, [0.15, Y - 0.08, sz * 0.15], [-0.15, Y - 0.08, sz * 0.15], 0.006, 0.006, 4);
  roundel(b, 0.07, -0.05, F.top(-0.05) + 0.003, 0);
  return out(cy + 0.2, lift, (m) => hang(c, m, F.bot(m.x) + 0.02, 0.7));
}

// =====================================================================================================================
function gunship(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.24;
  // faceted armoured fuselage: pointed chin, tandem cockpit, slim tail boom (boxy heli section)
  const F = new Fuse([
    [1.36, cy - 0.08, 0.035, 0.04], [1.24, cy - 0.04, 0.12, 0.1], [0.95, cy, 0.22, 0.16], [0.45, cy + 0.02, 0.26, 0.2],
    [-0.1, cy + 0.03, 0.26, 0.21], [-0.45, cy + 0.05, 0.17, 0.14], [-0.8, cy + 0.08, 0.085, 0.07], [-1.32, cy + 0.1, 0.06, 0.05], [-1.46, cy + 0.1, 0.04, 0.035],
  ], 0, SEC_BOX);
  fuselage(b, kit.armor, F);
  overSkin(b, kit.armor2, F, 1.36, 1.2, 0.003);
  for (const x of [1.18, 0.32, -0.38, -0.82, -1.15]) panelBreak(b, kit, F, x, 0.012);
  // stepped tandem cockpits (gunner low in front, pilot raised behind), flat armoured glass with heavy frames
  canopy(b, kit, 1.18, 0.86, F.top(1.0) - 0.04, 0.12, 0.13, { bows: 1, frame: kit.armor2, rake: 0.4 });
  canopy(b, kit, 0.8, 0.42, F.top(0.6) - 0.01, 0.13, 0.15, { bows: 1, frame: kit.armor2, rake: 0.4 });
  // chin sensor turret, nose pitot, cheek armour / ammo bays
  sensorBall(b, kit, 1.18, F.bot(1.18) + 0.03, 0, 0.08);
  pitot(b, kit, 1.3, cy - 0.02, 0.06, 0.14, 0.006);
  sides((s) => skinPanel(b, kit.armor2, F, 0.3, -0.25, s > 0 ? 2 : 8, s > 0 ? 3 : 9, 0.004, 0.008));
  // shoulder turboshafts: shell cowls, black intakes with dust filters, hot exhausts angled out, soot on the boom
  const lift: Lift[] = [];
  sides((s) => {
    const z = s * 0.19, ny = F.top(0) + 0.06;
    const N = new Fuse([[0.26, ny, 0.06, 0.06], [0.2, ny, 0.085, 0.08], [-0.25, ny, 0.09, 0.085], [-0.46, ny + 0.01, 0.065, 0.06]], z, SEC_BOX);
    fuselage(b, kit.shell, N);
    panelBreak(b, kit, N, 0.0, 0.01);
    bx(b, kit.mech, 0.02, 0.1, 0.11, 0.265, ny, z);
    bx(b, kit.joint, 0.014, 0.07, 0.08, 0.275, ny, z);
    b.cyl(kit.mech, 0.055, 0.05, 0.08, [-0.44, ny + 0.01, z], '-x', 8);
    b.cyl(kit.hot, 0.04, 0.04, 0.01, [-0.52, ny + 0.01, z], '-x', 8);
    soot(b, kit, F, -0.55, -1.1, s * 0.035, 0.03);
  });
  // anhedral stub wings with tip countermeasure pods
  const sw: Station[] = [[0.36, cy - 0.04, 0.16, 0.44, 0.055], [0.3, cy - 0.11, 0.8, 0.3, 0.035]];
  sides((s) => {
    aeroWing(b, kit, mirrorSt(sw, s), { mat: kit.armor, flaps: [[0.4, 0.7]], stripe: [0.58, 0.64] });
    const t = at(sw, 0.8);
    const P = new Fuse([[t[0] + 0.06, t[1] - 0.01, 0.025, 0.025], [t[0] - 0.02, t[1] - 0.01, 0.045, 0.04], [t[0] - 0.3, t[1] - 0.01, 0.04, 0.035]], s * 0.81, SEC_BOX);
    fuselage(b, kit.shell, P);
    bx(b, kit.glow, 0.02, 0.016, 0.016, t[0] + 0.05, t[1] - 0.01, s * 0.81);
  });
  // tail: tailplane with endplate fins, ventral fin with tail bumper
  sides((s) => {
    aeroWing(b, kit, [[-1.12, cy + 0.08, 0, 0.26, 0.035], [-1.18, cy + 0.08, s * 0.4, 0.2, 0.026]], { mat: kit.armor, flaps: [[0.06, 0.36]] });
    aeroFin(b, kit, [[-1.12, cy - 0.01, s * 0.4, 0.25, 0.022], [-1.26, cy + 0.27, s * 0.44, 0.15, 0.016]], { mat: kit.armor2, rudder: [0.1, 0.9], band: [0.6, 0.78] });
  });
  aeroFin(b, kit, [[-1.3, cy + 0.06, 0, 0.16, 0.02], [-1.38, cy - 0.12, 0, 0.1, 0.015]], { mat: kit.armor2 });
  bladeAntenna(b, kit, -0.6, F.top(-0.6) - 0.005, 0, 0.07);
  bladeAntenna(b, kit, 0.2, F.bot(0.2) + 0.005, 0, 0.06, true);
  // rotor mast fairing (dark) + coax rotor
  const my = F.top(0.05) + 0.06;
  b.lathe(kit.mech, [[0, -0.08], [0.11, -0.08], [0.09, 0.04], [0.05, 0.1], [0, 0.11]], [0.05, my, 0], 'y', 8);
  roundel(b, 0.14, -0.3, F.top(-0.3), 0);
  chevron(b, 0.12, 0.25, F.top(0.25) + 0.002, 0);
  const R = 1.12;
  lift.push({ kind: 'coax', p: [0.05, cy + 0.46, 0], r: R, blades: load(c) > 0.7 ? 4 : 3 });
  return out(cy + 0.5, lift, (m) => hang(c, m, under(sw, m.z) + 0.01));
}

// =====================================================================================================================
function heavyheli(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.32;
  const grav = c.mob.id === 'gravlift';
  const F = new Fuse([
    [1.98, cy - 0.16, 0.1, 0.14], [1.84, cy - 0.1, 0.24, 0.3], [1.55, cy - 0.03, 0.33, 0.37], [1.0, cy, 0.37, 0.39],
    [-1.15, cy + 0.02, 0.37, 0.39], [-1.6, cy + 0.07, 0.3, 0.33], [-1.9, cy + 0.13, 0.17, 0.24],
  ], 0, SEC_BOX);
  fuselage(b, kit.armor, F);
  for (const x of [1.45, 0.75, 0.05, -0.65, -1.3]) panelBreak(b, kit, F, x, 0.016);
  // framed nose glazing (chin windows below), shell nose cap
  overSkin(b, kit.shell, F, 1.98, 1.86, 0.004);
  canopy(b, kit, 1.86, 1.48, F.top(1.7) - 0.12, 0.3, 0.14, { bows: 2, frame: kit.armor2, rake: 0.45 });
  sides((s) => bx(b, kit.glass, 0.16, 0.08, 0.02, 1.78, cy - 0.12, s * 0.27, [0, -s * 0.5, 0]));
  // roof walkway between the rotor pylons (dark anti-slip strip with a team stripe) and a hazard band at the door
  // two-tone: grey roof (shoulders + spine) over the team-coloured cabin sides
  skinPanel(b, kit.shell, F, 1.44, -1.88, 4, 7, 0.004, 0.01);
  ribbon(b, kit.mech, [[0.9, F.top(0.9) + 0.016, 0], [-0.9, F.top(-0.9) + 0.016, 0]], 0.07, 0.07, 0.004);
  sides((s) => bx(b, kit.accent, 0.08, 0.008, 0.2, 0.1, F.top(0.1) + 0.02, s * 0.2));
  sides((s) => {
    // side sponsons (fuel / gear), stub pylons to the weapons, square windows, door outline
    const P = new Fuse([[0.55, cy - 0.17, 0.06, 0.06], [0.35, cy - 0.17, 0.14, 0.11], [-0.6, cy - 0.17, 0.14, 0.11], [-0.85, cy - 0.17, 0.07, 0.06]], s * 0.4, SEC_BOX);
    fuselage(b, kit.armor2, P);
    panelBreak(b, kit, P, -0.15, 0.012);
    aeroWing(b, kit, mirrorSt([[0.12, cy - 0.15, 0.48, 0.38, 0.05], [0.1, cy - 0.17, 0.78, 0.3, 0.04]], s), { mat: kit.armor });
    for (const x of [0.6, 0.15, -0.3]) bx(b, kit.glass, 0.09, 0.08, 0.012, x, cy + 0.12, s * (F.w(x) + 0.003));
    bx(b, kit.mech, 0.3, 0.38, 0.008, 1.1, cy - 0.02, s * (F.w(1.1) + 0.003));
    bx(b, kit.hazard, 0.32, 0.03, 0.01, 1.1, cy + 0.19, s * (F.w(1.1) + 0.005));
    gearDoors(b, kit, -0.15, F.bot(-0.15) + 0.004, s * 0.4, 0.4, 0.14);
  });
  // rear loading ramp outline + hazard band
  bx(b, kit.mech, 0.04, 0.3, 0.5, -1.93, cy + 0.08, 0, [0, 0, -0.5]);
  bx(b, kit.hazard, 0.05, 0.04, 0.46, -1.92, cy - 0.06, 0, [0, 0, -0.5]);
  bx(b, kit.lamp, 0.03, 0.03, 0.08, 1.96, cy - 0.12, 0);
  bladeAntenna(b, kit, 0.4, F.bot(0.4) + 0.005, 0, 0.1, true);
  bladeAntenna(b, kit, -0.3, F.top(-0.3), 0.12, 0.1);
  const lift: Lift[] = [];
  if (!grav) {
    // forward rotor pylon and tall aft rotor tower (faceted, dark mast fairings), twin turboshafts on the tower
    const fp = new Fuse([[1.45, F.top(1.12) - 0.02, 0.04, 0.12], [1.3, F.top(1.12) + 0.08, 0.12, 0.16], [0.9, F.top(1.12) + 0.08, 0.12, 0.16], [0.75, F.top(1.12) - 0.02, 0.04, 0.12]], 0, SEC_BOX);
    fuselage(b, kit.armor, fp);
    b.lathe(kit.mech, [[0, 0], [0.12, 0], [0.08, 0.1], [0, 0.12]], [1.12, F.top(1.12) + 0.18, 0], 'y', 8);
    const ty = F.top(-1.45);
    const tp = new Fuse([[-0.95, ty - 0.02, 0.06, 0.2], [-1.15, ty + 0.25, 0.3, 0.25], [-1.7, ty + 0.3, 0.34, 0.22], [-1.95, ty + 0.15, 0.2, 0.16]], 0, SEC_BOX);
    fuselage(b, kit.armor, tp);
    panelBreak(b, kit, tp, -1.4, 0.014);
    b.lathe(kit.mech, [[0, 0], [0.13, 0], [0.09, 0.12], [0, 0.14]], [-1.6, tp.top(-1.6) - 0.02, 0], 'y', 8);
    for (const s of [-1, 1]) {
      const z = s * 0.32, ny = cy + 0.42;
      const N = new Fuse([[-0.58, ny, 0.07, 0.07], [-0.66, ny, 0.11, 0.11], [-1.25, ny, 0.11, 0.11], [-1.42, ny + 0.01, 0.075, 0.075]], z, SEC_BOX);
      fuselage(b, kit.shell, N);
      panelBreak(b, kit, N, -0.95, 0.014);
      bx(b, kit.mech, 0.02, 0.15, 0.15, -0.575, ny, z);
      bx(b, kit.joint, 0.012, 0.11, 0.11, -0.565, ny, z);
      b.cyl(kit.mech, 0.07, 0.062, 0.06, [-1.42, ny + 0.01, z], '-x', 8);
      b.cyl(kit.hot, 0.05, 0.05, 0.01, [-1.48, ny + 0.01, z], '-x', 8);
      b.strut(kit.joint, [-0.9, ny - 0.09, z * 0.9], [-0.9, F.top(-0.9), z * 0.6], 0.016, 0.016, 4);
    }
    const n = load(c) > 0.75 ? 4 : 3;
    lift.push({ kind: 'rotor', p: [1.12, cy + 0.52, 0], r: 1.25, blades: n, dir: 1 });
    lift.push({ kind: 'rotor', p: [-1.6, cy + 0.98, 0], r: 1.25, blades: n, dir: -1 });
  } else {
    // reactor hump amidships with louvred vents, H-tail on the upswept rear, outrigger grav pods
    const H = new Fuse([[0.45, cy + 0.33, 0.03, 0.2], [0.3, cy + 0.42, 0.12, 0.3], [-0.6, cy + 0.42, 0.12, 0.3], [-0.85, cy + 0.33, 0.03, 0.2]], 0, SEC_BOX);
    fuselage(b, kit.armor2, H);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) bx(b, kit.mech, 0.1, 0.012, 0.13, 0.15 - i * 0.18, H.top(0) + 0.004, s * 0.14);
      bx(b, kit.glow, 0.6, 0.012, 0.02, -0.15, H.top(0) + 0.006, s * 0.25);
      aeroWing(b, kit, mirrorSt([[-1.5, cy + 0.3, 0.0, 0.42, 0.04], [-1.6, cy + 0.32, 0.6, 0.3, 0.03]], s), { mat: kit.armor, flaps: [[0.2, 0.55]] });
      aeroFin(b, kit, [[-1.52, cy + 0.12, s * 0.6, 0.4, 0.035], [-1.72, cy + 0.6, s * 0.66, 0.24, 0.025]], { mat: kit.armor2, rudder: [0.1, 0.9], band: [0.55, 0.75], beacon: 0.025 });
    }
    const xs = load(c) > 0.7 ? [1.2, 0.5, -1.25] : [1.15, -1.25];
    for (const x of xs) for (const s of [-1, 1]) {
      bx(b, kit.mech, 0.2, 0.08, 0.36, x, cy - 0.1, s * 0.52);
      bx(b, kit.joint, 0.12, 0.05, 0.3, x, cy - 0.04, s * 0.5);
      lift.push({ kind: 'grav', p: [x, cy - 0.12, s * 0.74], r: 0.27, len: 0.24, dir: s as 1 | -1 });
    }
  }
  roundel(b, 0.22, 0.4, F.top(0.4) + 0.014, 0.2);
  roundel(b, 0.22, 0.4, F.top(0.4) + 0.014, -0.2);
  if (grav) chevron(b, 0.2, 1.3, F.top(1.3) + 0.016, 0);
  return out(cy + 0.6, lift, (m) => (m.x > 1.2 ? hang(c, m, F.bot(m.x) + 0.02, 0.6) : hang(c, m, cy - 0.2)));
}

// =====================================================================================================================
function bomberhull(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.3;
  const grav = c.mob.id === 'gravlift';
  // chined lifting body: narrow keel, wide chine, sloped shoulders, a flat ridge; the belly sweeps up into a blunt tail
  const LB = { kw: 0.45, lw: 0.8, ly: -0.75, chy: -0.36, sh: 0.74, shy: 0.56, tw: 0.32 };
  const body: [number, number, number, number][] = [ // [x, y bottom, height, half width]
    [1.98, cy - 0.12, 0.16, 0.16], [1.7, cy - 0.24, 0.42, 0.5], [1.15, cy - 0.3, 0.6, 0.7], [0.2, cy - 0.32, 0.64, 0.78],
    [-0.8, cy - 0.28, 0.6, 0.66], [-1.5, cy - 0.12, 0.5, 0.46], [-1.96, cy + 0.02, 0.4, 0.34],
  ];
  const F = new Fuse(body.map(([x, y, h, w]) => [x, y + h / 2, h / 2, w]), 0, LB);
  fuselage(b, kit.armor, F);
  for (const x of [1.45, 0.75, -0.1, -0.9, -1.55]) panelBreak(b, kit, F, x, 0.016);
  // chine strakes in shell grey, dorsal ridge panel in shell with a dark walkway and team stripes
  sides((s) => skinPanel(b, kit.shell, F, 1.6, -1.7, s > 0 ? 2 : 8, s > 0 ? 3 : 9, 0.004, 0.01));
  // two-tone: the whole upper deck (shoulders + ridge) in shell grey over the team-coloured flanks
  skinPanel(b, kit.shell, F, 1.3, -1.85, 4, 7, 0.004, 0.012);
  ribbon(b, kit.mech, F.xs(0.9, -1.5).map((x) => [x, F.top(x) + 0.017, 0] as V3), 0.05, 0.05, 0.003);
  for (const x of [0.55, 0.42]) bx(b, kit.accent, 0.06, 0.008, 0.36, x, F.top(x) + 0.02, 0);
  // hooded cockpit: framed visor glass under an armoured brow
  canopy(b, kit, 1.88, 1.5, F.top(1.7) - 0.1, 0.24, 0.13, { bows: 2, frame: kit.armor2, rake: 0.5 });
  const BR = new Fuse([[1.58, F.top(1.45) + 0.0, 0.03, 0.28], [1.45, F.top(1.45) + 0.06, 0.07, 0.36], [1.1, F.top(1.1) + 0.04, 0.06, 0.34], [0.95, F.top(0.95), 0.02, 0.3]], 0, SEC_BOX);
  fuselage(b, kit.armor2, BR);
  // bomb bay: dark seams around flush shell doors along the belly
  gearDoors(b, kit, 0.1, F.bot(0.1) + 0.004, 0, 1.3, 0.5);
  bx(b, kit.lamp, 0.03, 0.035, 0.1, 1.95, cy - 0.04, 0);
  bladeAntenna(b, kit, -0.5, F.top(-0.5) + 0.01, 0.25, 0.1);
  bladeAntenna(b, kit, 0.6, F.bot(0.6), 0, 0.09, true);
  // main wings to the weapon pylons, twin canted tail fins on the upswept tail
  const mw: Station[] = [[0.42, cy - 0.08, 0.55, 0.95, 0.1], [0.3, cy - 0.11, 1.04, 0.62, 0.06]];
  sides((s) => {
    aeroWing(b, kit, mirrorSt(mw, s), { mat: kit.shell, tip: 0.94, flaps: [[0.62, 0.98]], slat: [0.6, 1.0], stripe: [0.78, 0.86] });
    aeroFin(b, kit, [[-1.4, cy + 0.26, s * 0.22, 0.42, 0.04], [-1.7, cy + 0.62, s * 0.38, 0.22, 0.03]], { rudder: [0.1, 0.9], band: [0.6, 0.8], beacon: 0.025 });
  });
  const lift: Lift[] = [];
  const front: V3 = [1.0, cy + 0.02, 1.08], rear: V3 = [-1.12, cy + 0.12, 1.1];
  sides((s) => {
    // canard stub to the front fan, rear wing to the rear fan
    aeroWing(b, kit, mirrorSt([[1.12, cy, 0.5, 0.36, 0.06], [1.12, front[1] - 0.04, 0.8, 0.3, 0.05]], s), { mat: kit.shell });
    aeroWing(b, kit, mirrorSt([[-0.88, cy + 0.08, 0.4, 0.5, 0.07], [-0.95, rear[1] - 0.04, 0.78, 0.36, 0.05]], s), { mat: kit.shell, flaps: [[0.45, 0.75]] });
    soot(b, kit, F, -1.3, -1.9, s * 0.2, 0.05);
    if (!grav) {
      lift.push({ kind: 'duct', p: [front[0], front[1], s * front[2]], r: 0.29, blades: 7, dir: s as 1 | -1, tilt: 0.14 });
      lift.push({ kind: 'duct', p: [rear[0], rear[1], s * rear[2]], r: 0.31, blades: 7, dir: -s as 1 | -1, tilt: 0.14 });
    } else {
      lift.push({ kind: 'grav', p: [front[0], front[1] - 0.06, s * (front[2] - 0.12)], r: 0.25, len: 0.2, dir: s as 1 | -1 });
      lift.push({ kind: 'grav', p: [rear[0], rear[1] - 0.06, s * (rear[2] - 0.12)], r: 0.27, len: 0.22, dir: -s as 1 | -1 });
      if (load(c) > 0.75) lift.push({ kind: 'grav', p: [-0.4, cy - 0.32, s * 0.42], r: 0.2, len: 0.16, dir: s as 1 | -1 });
    }
  });
  roundel(b, 0.28, 0.25, over(mw, 0.82), 0.82);
  roundel(b, 0.28, 0.25, over(mw, 0.82), -0.82);
  chevron(b, 0.26, 1.2, F.top(1.2) + 0.02, 0);
  return out(cy + 0.5, lift, (m) => (m.x > 1 ? hang(c, m, cy - 0.3, 0.6) : hang(c, m, cy - 0.14)));
}

// =====================================================================================================================
function carrier(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.36;
  const keel: [number, number, number, number][] = [
    [1.98, cy, 0.12, 0.22], [1.6, cy + 0.04, 0.34, 0.5], [0.8, cy + 0.06, 0.46, 0.7], [-0.6, cy + 0.08, 0.48, 0.72], [-1.5, cy + 0.08, 0.4, 0.6], [-1.98, cy + 0.06, 0.24, 0.4],
  ];
  const K = new Fuse(keel, 0, { kw: 0.5, lw: 0.86, ly: -0.62, chy: 0.0, sh: 0.9, shy: 0.6, tw: 0.62 });
  fuselage(b, kit.armor, K);
  for (const x of [1.55, 0.9, 0.2, -0.5, -1.2, -1.75]) panelBreak(b, kit, K, x, 0.02);
  const deckY = (x: number) => K.top(x);
  // flight deck: shell plating, dark runway centreline with lamps, team chevrons at the bow, hazard band at the end
  spinePanel(b, kit.shell, K, 1.5, -1.85, 0.004, 0.012);
  ribbon(b, kit.mech, K.xs(1.4, -1.0).map((x) => [x, deckY(x) + 0.017, 0] as V3), 0.12, 0.12, 0.003);
  for (const x of [1.2, 0.6, 0, -0.6]) bx(b, kit.lamp, 0.1, 0.008, 0.02, x, deckY(x) + 0.022, 0);
  chevron(b, 0.36, 1.25, deckY(1.25) + 0.02, 0);
  bx(b, kit.hazard, 0.06, 0.008, 0.6, -1.8, deckY(-1.8) + 0.02, 0);
  // hangar mouth at the bow
  bx(b, kit.mech, 0.06, 0.2, 0.42, 1.86, cy + 0.02, 0, [0, 0, 0.4]);
  bx(b, kit.lamp, 0.03, 0.03, 0.36, 1.9, cy + 0.14, 0, [0, 0, 0.4]);
  // swept wing-hulls
  const ws: Station[] = [[1.1, cy - 0.06, 0.5, 2.6, 0.36], [0.2, cy - 0.02, 1.9, 1.62, 0.24], [-0.4, cy + 0.04, 2.7, 1.05, 0.18]];
  sides((s) => {
    aeroWing(b, kit, mirrorSt(ws, s), { mat: kit.shell, tip: 2.3, slat: [0.9, 2.5], flaps: [[0.9, 1.6], [1.7, 2.45]], stripe: [2.05, 2.18], walk: 1.6 });
    // tip nacelle with intake and exhaust
    const N = nacelle(b, kit, 0.0, -1.5, cy + 0.04, s * 2.72, 0.22, { mat: kit.armor2 });
    soot(b, kit, N, -1.25, -1.5, s * 2.72, 0.06);
    b.cyl(kit.hot, 0.14, 0.12, 0.015, [-1.5, cy + 0.04, s * 2.72], '-x', 12);
    // outboard tail fins on the nacelles, canted out
    aeroFin(b, kit, [[-0.8, cy + 0.12, s * 2.72, 0.7, 0.05], [-1.2, cy + 0.62, s * 2.86, 0.32, 0.03]], { rudder: [0.1, 0.9], band: [0.55, 0.8], beacon: 0.035 });
    // armoured shoulder ridge where the wing meets the keel: faceted, with a dark seam and a hatch row
    const SR = new Fuse([[0.95, cy + 0.12, 0.02, 0.12], [0.75, cy + 0.27, 0.15, 0.17], [-1.35, cy + 0.27, 0.15, 0.17], [-1.55, cy + 0.15, 0.03, 0.12]], s * 0.72, SEC_BOX);
    fuselage(b, kit.shell, SR);
    for (const x of [0.3, -0.4, -1.0]) panelBreak(b, kit, SR, x, 0.016);
    for (const x of [0.5, 0.0, -0.6]) bx(b, kit.mech, 0.14, 0.01, 0.1, x, SR.top(x) + 0.004, s * 0.72);
    // keel rear thrusters
    b.cyl(kit.mech, 0.13, 0.11, 0.06, [-1.95, cy + 0.04, s * 0.2], '-x', 10);
    b.cyl(kit.hot, 0.11, 0.09, 0.02, [-1.99, cy + 0.04, s * 0.2], '-x', 10);
  });
  b.cyl(kit.mech, 0.15, 0.12, 0.06, [-1.95, cy + 0.04, 0], '-x', 10);
  b.cyl(kit.hot, 0.13, 0.1, 0.02, [-1.99, cy + 0.04, 0], '-x', 10);
  // offset bridge island (starboard): faceted block, glazed band, radar mast with a rotating-dish bar and beacon
  const tx = -1.2, tz = 0.56, ty = deckY(tx) - 0.02;
  const T = new Fuse([[tx + 0.36, ty + 0.17, 0.17, 0.2], [tx + 0.2, ty + 0.2, 0.2, 0.25], [tx - 0.36, ty + 0.18, 0.18, 0.22]], tz, SEC_BOX);
  fuselage(b, kit.armor2, T);
  bx(b, kit.glass, 0.06, 0.07, 0.36, tx + 0.36, ty + 0.3, tz, [0, 0, -0.3]);
  bx(b, kit.shell, 0.4, 0.2, 0.3, tx - 0.06, ty + 0.48, tz);
  bx(b, kit.glass, 0.04, 0.05, 0.24, tx + 0.15, ty + 0.5, tz);
  b.strut(kit.joint, [tx - 0.1, ty + 0.58, tz], [tx - 0.12, ty + 0.95, tz], 0.016, 0.01, 6);
  bx(b, kit.joint, 0.05, 0.06, 0.34, tx - 0.12, ty + 0.85, tz);
  bx(b, kit.lamp, 0.03, 0.03, 0.03, tx - 0.12, ty + 0.97, tz);
  roundel(b, 0.5, -0.1, over(ws, 1.6) + 0.01, 1.6);
  roundel(b, 0.5, -0.1, over(ws, 1.6) + 0.01, -1.6);
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
    else y = over(ws, m.z) + 0.04;
    collar(b, kit, m.x, y, m.z, m.r, y - 0.1, 18);
    return { y, socket: true };
  });
}

// =====================================================================================================================
function interceptor(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.1;
  const F = new Fuse([
    [1.02, cy - 0.005, 0.01, 0.01], [0.88, cy, 0.045, 0.045], [0.62, cy + 0.012, 0.075, 0.072], [0.38, cy + 0.02, 0.092, 0.09],
    [0.1, cy + 0.015, 0.098, 0.12], [-0.3, cy + 0.01, 0.096, 0.118], [-0.72, cy, 0.084, 0.098], [-0.9, cy, 0.078, 0.084],
  ], 0, SEC_JET);
  fuselage(b, kit.shell, F);
  overSkin(b, kit.armor2, F, 1.02, 0.8, 0.002);
  for (const x of [0.5, 0.05, -0.4, -0.72]) panelBreak(b, kit, F, x, 0.008);
  canopy(b, kit, 0.68, 0.3, F.top(0.5) - 0.025, 0.05, 0.07, { bows: 1 });
  pitot(b, kit, 1.0, cy - 0.005, 0, 0.13, 0.004);
  // side intakes with splitter plates, engine-bay heat panel at the tail
  sides((s) => intake(b, kit, 0.28, cy - 0.015, s * 0.15, 0.055, 0.08, 0.34, { side: -s }));
  skinPanel(b, kit.joint, F, -0.66, -0.9, 3, 8, 0.002, 0.003);
  // forward-swept main wings, canards, twin canted fins
  const ws: Station[] = [[-0.25, cy - 0.02, 0.07, 0.48, 0.036], [0.15, cy + 0.0, 0.5, 0.17, 0.014]];
  sides((s) => {
    aeroWing(b, kit, mirrorSt(ws, s), { tip: 0.42, flaps: [[0.13, 0.27], [0.28, 0.41]], stripe: [0.33, 0.37], lights: 0.012, slat: [0.12, 0.42] });
    aeroWing(b, kit, mirrorSt([[0.52, cy + 0.025, 0.07, 0.2, 0.016], [0.45, cy + 0.035, 0.22, 0.08, 0.008]], s), { mat: kit.shell });
    aeroFin(b, kit, [[-0.56, cy + 0.07, s * 0.065, 0.3, 0.016], [-0.78, cy + 0.27, s * 0.13, 0.12, 0.01]], { rudder: [0.12, 0.88], band: [0.6, 0.8] });
  });
  bladeAntenna(b, kit, -0.15, F.top(-0.15), 0, 0.04);
  gearDoors(b, kit, 0.1, F.bot(0.1) + 0.003, 0, 0.3, 0.07);
  roundel(b, 0.08, -0.08, over(ws, 0.3), 0.3);
  roundel(b, 0.08, -0.08, over(ws, 0.3), -0.3);
  chevron(b, 0.07, 0.15, F.top(0.15) + 0.002, 0);
  const lift: Lift[] = [{ kind: 'jet', p: [-0.95, cy, 0], r: 0.07, len: 0.12 }];
  return out(cy + 0.25, lift, (m) => hang(c, m, under(ws, m.z), 0.6));
}

// =====================================================================================================================
function strikejet(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.12;
  const F = new Fuse([
    [1.42, cy - 0.02, 0.015, 0.015], [1.22, cy, 0.1, 0.09], [0.85, cy + 0.025, 0.17, 0.15], [0.3, cy + 0.03, 0.19, 0.17],
    [-0.3, cy + 0.02, 0.16, 0.15], [-0.7, cy + 0.01, 0.08, 0.08], [-0.84, cy, 0.03, 0.03],
  ], 0, SEC_JET);
  fuselage(b, kit.shell, F);
  overSkin(b, kit.armor2, F, 1.42, 1.18, 0.003);
  for (const x of [1.1, 0.42, -0.2, -0.55]) panelBreak(b, kit, F, x, 0.01);
  canopy(b, kit, 1.0, 0.48, F.top(0.75) - 0.035, 0.085, 0.1, { bows: 1 });
  pitot(b, kit, 1.4, cy - 0.02, 0, 0.14, 0.005);
  sensorBall(b, kit, 1.0, F.bot(1.0) + 0.01, 0, 0.045);
  bladeAntenna(b, kit, 0.1, F.top(0.1), 0, 0.05);
  gearDoors(b, kit, 0.6, F.bot(0.6) + 0.004, 0, 0.3, 0.1);
  // straight tapered wing
  const ws: Station[] = [[0.36, cy - 0.02, 0.12, 0.82, 0.07], [0.08, cy + 0.025, 1.0, 0.42, 0.03]];
  const bz = 0.45;
  sides((s) => {
    aeroWing(b, kit, mirrorSt(ws, s), { tip: 0.88, slat: [0.54, 0.96], flaps: [[0.16, 0.37], [0.54, 0.86]], stripe: [0.72, 0.78], walk: 0.38, lights: 0.018 });
    // engine boom: intake, faceted engine body, heat panel and soot at the exhaust
    const B = new Fuse([
      [0.6, cy - 0.01, 0.06, 0.055], [0.48, cy - 0.005, 0.095, 0.09], [0.0, cy, 0.105, 0.098], [-0.6, cy + 0.01, 0.09, 0.085], [-1.1, cy + 0.02, 0.072, 0.067], [-1.42, cy + 0.02, 0.07, 0.065],
    ], s * bz, { kw: 0.42, lw: 0.86, ly: -0.62, chy: 0, sh: 0.86, shy: 0.58, tw: 0.42 });
    fuselage(b, kit.shell, B);
    b.lathe(kit.shell, [[0.04, 0], [0.058, 0.01], [0.06, 0.04], [0.045, 0.04]], [0.6, cy - 0.01, s * bz], 'x', 10);
    b.cyl(kit.mech, 0.046, 0.046, 0.01, [0.6, cy - 0.01, s * bz], '-x', 10);
    for (const x of [0.2, -0.45, -0.95]) panelBreak(b, kit, B, x, 0.01);
    skinPanel(b, kit.joint, B, -1.12, -1.42, 3, 8, 0.002, 0.003);
    // fins on the boom ends
    aeroFin(b, kit, [[-1.06, cy + 0.06, s * bz, 0.36, 0.024], [-1.26, cy + 0.36, s * bz, 0.18, 0.016]], { rudder: [0.12, 0.88], band: [0.55, 0.78] });
    // high tailplane half between the fin tops (elevator)
    aeroWing(b, kit, [[-1.18, cy + 0.33, 0, 0.19, 0.024], [-1.2, cy + 0.33, s * bz, 0.17, 0.022]], { mat: kit.armor, flaps: [[0.03, bz - 0.03]] });
  });
  roundel(b, 0.12, -0.12, over(ws, 0.72), 0.72);
  roundel(b, 0.12, -0.12, over(ws, 0.72), -0.72);
  chevron(b, 0.12, 0.25, F.top(0.25) + 0.002, 0);
  const lift: Lift[] = [-1, 1].map((s) => ({ kind: 'jet', p: [-1.46, cy + 0.02, s * bz], r: 0.065, len: 0.12 } as Lift));
  return out(cy + 0.4, lift, (m) => (Math.abs(m.z) < 0.2 ? hang(c, m, F.bot(m.x) + 0.01, 0.65) : hang(c, m, under(ws, m.z), 0.6)));
}

// =====================================================================================================================
function deltawing(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.1;
  // ogival delta panel: curved leading edge, straight trailing edge
  const ws: Station[] = [[1.0, cy, 0.0, 2.3, 0.12], [0.62, cy, 0.25, 1.9, 0.1], [0.12, cy + 0.01, 0.5, 1.37, 0.07], [-0.45, cy + 0.02, 0.78, 0.78, 0.04], [-0.95, cy + 0.03, 1.0, 0.3, 0.018]];
  sides((s) => {
    aeroWing(b, kit, mirrorSt(ws, s), { tip: 0.86, slat: [0.3, 0.9], flaps: [[0.22, 0.52], [0.54, 0.84]], stripe: [0.66, 0.72], walk: 0.45, lights: 0.018 });
  });
  // blended spine with radome and framed canopy, chin intake, engine bay heat panels
  const F = new Fuse([
    [1.5, cy, 0.015, 0.015], [1.25, cy + 0.02, 0.08, 0.075], [0.8, cy + 0.05, 0.13, 0.12], [0.0, cy + 0.05, 0.15, 0.16], [-1.0, cy + 0.03, 0.12, 0.19], [-1.3, cy + 0.02, 0.1, 0.19],
  ], 0, SEC_JET);
  fuselage(b, kit.shell, F);
  overSkin(b, kit.armor2, F, 1.5, 1.26, 0.003);
  for (const x of [1.15, 0.5, -0.2, -0.85]) panelBreak(b, kit, F, x, 0.01);
  canopy(b, kit, 1.08, 0.64, F.top(0.86) - 0.03, 0.07, 0.09, { bows: 1 });
  pitot(b, kit, 1.48, cy, 0, 0.14, 0.005);
  intake(b, kit, 0.55, cy - 0.13, 0, 0.24, 0.1, 0.7, { ramp: 0.5 });
  gearDoors(b, kit, -0.25, cy - 0.11, 0, 0.4, 0.16);
  skinPanel(b, kit.joint, F, -1.05, -1.3, 3, 8, 0.002, 0.003);
  bladeAntenna(b, kit, 0.3, F.top(0.3), 0, 0.05);
  // one tall swept fin (rudder, team band, beacon)
  aeroFin(b, kit, [[-0.5, cy + 0.13, 0, 0.78, 0.04], [-1.06, cy + 0.62, 0, 0.27, 0.022]], { rudder: [0.1, 0.86], band: [0.55, 0.8], beacon: 0.02 });
  roundel(b, 0.2, -0.45, over(ws, 0.5), 0.5);
  roundel(b, 0.2, -0.45, over(ws, 0.5), -0.5);
  chevron(b, 0.14, 0.35, F.top(0.35) + 0.002, 0);
  const lift: Lift[] = [-1, 1].map((s) => ({ kind: 'jet', p: [-1.33, cy + 0.02, s * 0.12], r: 0.075, len: 0.12 } as Lift));
  return out(cy + 0.6, lift, (m) => (Math.abs(m.z) < 0.2 ? hang(c, m, cy - 0.18, 0.6) : hang(c, m, under(ws, m.z), 0.6)));
}

// =====================================================================================================================
function stratobomber(c: ChassisCtx): AirOut {
  const { b, kit } = c;
  const Y = c.stance.y0, cy = Y + 0.12;
  // sawtooth flying wing: [le, y, z, chord, thick]; trailing edge zig-zags W
  const ws: Station[] = [[1.75, cy, 0.0, 3.75, 0.42], [1.17, cy, 0.5, 2.5, 0.3], [0.62, cy + 0.01, 1.0, 2.32, 0.17], [0.07, cy + 0.02, 1.5, 1.22, 0.09], [-0.45, cy + 0.04, 1.98, 0.32, 0.035]];
  const lift: Lift[] = [];
  sides((s) => {
    aeroWing(b, kit, mirrorSt(ws, s), { tip: 1.8, flaps: [[0.56, 0.98], [1.04, 1.46], [1.54, 1.92]], stripe: [1.62, 1.7], walk: 1.2, lights: 0.03 });
    // panel lines across the span
    for (const z of [0.5, 1.0, 1.5]) wingSkin(b, kit.mech, mirrorSt(ws, s), s * (z - 0.006), s * (z + 0.006), 0.03, 0.7, { th: 0.002 });
    // dorsal engine humps: faceted fairings, black intakes up front, exhaust troughs with soot behind
    for (const [x, z, k] of [[-0.15, 0.52, 1], [-0.35, 0.92, 0.82]] as [number, number, number][]) {
      const wy = over(ws, z) - 0.04;
      const H = new Fuse([[x + 0.72 * k, wy, 0.01, 0.1 * k], [x + 0.5 * k, wy + 0.1 * k, 0.1 * k, 0.17 * k], [x - 0.3 * k, wy + 0.1 * k, 0.09 * k, 0.17 * k], [x - 0.7 * k, wy + 0.02 * k, 0.03 * k, 0.12 * k]], s * z, SEC_JET);
      fuselage(b, kit.shell, H);
      intake(b, kit, x + 0.48 * k, wy + 0.17 * k, s * z, 0.24 * k, 0.07 * k, 0.4 * k, { ramp: 0.6 });
      ribbon(b, kit.joint, [[x - 0.66 * k, over(ws, z) + 0.002, s * z], [x - 1.05 * k, over(ws, z) - 0.03, s * z]], 0.1 * k, 0.12 * k, 0.004);
      lift.push({ kind: 'jet', p: [x - 0.72 * k, wy + 0.04 * k, s * z], r: 0.085 * k, len: 0.1 });
    }
    if (load(c) > 0.85) lift.push({ kind: 'jet', p: [-0.9, cy + 0.07, s * 1.3], r: 0.065, len: 0.1 });
  });
  // cockpit hump with a framed slit windscreen, dorsal team stripe, tail stinger with the gun
  const C = new Fuse([[1.75, cy + 0.02, 0.02, 0.06], [1.45, cy + 0.14, 0.13, 0.3], [1.0, cy + 0.17, 0.16, 0.36], [0.4, cy + 0.15, 0.12, 0.3], [-0.3, cy + 0.08, 0.05, 0.2]], 0, SEC_JET);
  fuselage(b, kit.shell, C);
  panelBreak(b, kit, C, 0.75, 0.014);
  canopy(b, kit, 1.52, 1.18, C.top(1.35) - 0.06, 0.2, 0.08, { bows: 2, rake: 0.55 });
  ribbon(b, kit.accent, [[0.6, C.top(0.6) + 0.002, 0], [0.0, C.top(0.0) + 0.002, 0]], 0.03, 0.03, 0.003);
  bladeAntenna(b, kit, 0.2, C.top(0.2), 0.15, 0.08);
  const T = new Fuse([[-1.56, cy - 0.03, 0.06, 0.07], [-1.72, cy - 0.03, 0.1, 0.12], [-2.02, cy - 0.04, 0.06, 0.07], [-2.12, cy - 0.04, 0.02, 0.02]], 0, SEC_JET);
  fuselage(b, kit.armor2, T);
  // bomb bays: dark seams around flush door pairs under the centreline
  for (const x of [1.12, 0.32, -0.88]) gearDoors(b, kit, x, cy - 0.255, 0, 0.55, 0.3);
  roundel(b, 0.32, -0.4, over(ws, 1.32), 1.32);
  roundel(b, 0.32, -0.4, over(ws, 1.32), -1.32);
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
