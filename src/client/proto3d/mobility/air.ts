// Flying mobility (rotor, jet, gravlift): renders the lift units an airframe asks for. Each air chassis builder
// (chassis/air.ts) returns AirOut.lift, a list of lift points it placed for ITS mobility and load (how many rotors /
// fans / nozzles / grav pods, where, how big); this module turns them into hardware on the unit root:
//   rotor  open rotor head: thin twisted tapered blades with root cuffs and painted tips, hub + swashplate with
//          pitch links (main rotors), spins about its local y
//   coax   two counter-rotating rotor discs on one mast (no tail rotor needed)
//   tail   small anti-torque rotor spinning about z
//   duct   ducted fan: thick ring + many short blades + hub cone; tilt pitches the whole fan (tilt-rotor look)
//   jet    engine can + convergent nozzle petals facing -x, black liner, hot core and flame-holder ring, and a
//          flickering afterburner cone
//   grav   anti-grav pod: rounded can with a glowing emitter face downwards and a slowly orbiting fin ring
// Spinning parts are separate groups (one mesh per material per group) driven by the returned updater.
// Without a lift list (unregistered flyer) it falls back to a simple default per mobility id.

import * as THREE from 'three';
import { Bld, ellRing, mtx, type V3 } from '../geo.ts';
import type { Kit } from '../materials.ts';
import { registerMobility, type MobilityCtx, type Stance, type StanceIn } from '../chassis/registry.ts';
import type { ChassisOut } from '../chassis/registry.ts';

export type LiftKind = 'rotor' | 'coax' | 'tail' | 'duct' | 'jet' | 'grav';
export interface Lift {
  kind: LiftKind;
  /** hub / nozzle exit / pod centre, hull-local */
  p: V3;
  /** rotor radius, duct inner radius, nozzle radius, pod radius */
  r: number;
  blades?: number;
  /** spin direction */
  dir?: 1 | -1;
  /** duct: pitch forward (radians, about z); jet: nozzle droop */
  tilt?: number;
  /** duct: roll outward (radians, about x) */
  roll?: number;
  /** jet: nozzle length; grav: pod height */
  len?: number;
}
export interface AirOut extends ChassisOut { lift: Lift[] }
export interface AirMobCtx extends MobilityCtx { lift?: Lift[] }

/** flying stance: y0 = belly reference height the airframe is built around (the render adds cruise altitude) */
export function airStance(s: StanceIn): Stance {
  const y0 = (s.mobId === 'jet' ? 0.26 : 0.2) + 0.08 * s.S;
  return { y0, yt: y0 + 0.1, wi: s.W * 0.4, tracked: false, legs: null, thick: 0, hipY: 0 };
}

// shared faint blur disc (one material for every rotor of every unit)
let discMat: THREE.MeshBasicMaterial | null = null;
function blurDisc(R: number): THREE.Mesh {
  discMat ??= new THREE.MeshBasicMaterial({ color: '#cfd5d8', transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(new THREE.CircleGeometry(R, 24).rotateX(-Math.PI / 2), discMat);
  m.renderOrder = 2;
  return m;
}

/** one tapered, twisted blade along +z from the hub (chord along x), written into b with transform m: four lens sections
 *  washing out from root pitch to a near-flat tip, a dark root cuff and a painted tip band */
function blade(b: Bld, kit: Kit, R: number, chord: number, r0: number, m: THREE.Matrix4, pitch = 0.26) {
  const rings: V3[][] = [];
  for (const f of [0, 0.3, 0.78, 1]) {
    const z = r0 + (R - r0) * f, c = chord * (f < 0.3 ? 0.8 + f * 0.66 : 1 - 0.3 * (f - 0.3)), t = chord * 0.12 * (1 - 0.45 * f), a = pitch * (1 - 0.85 * f);
    const ca = Math.cos(a), sa = Math.sin(a);
    const pts: [number, number][] = [[c * 0.5, 0], [c * 0.2, t], [-c * 0.35, t * 0.55], [-c * 0.5, 0], [-c * 0.35, -t * 0.35], [c * 0.2, -t * 0.55]];
    rings.push(pts.map(([x, y]) => [x * ca - y * sa, x * sa + y * ca, z] as V3));
  }
  b.loft(kit.trim, rings, true, true, m);
  // root cuff + grip
  b.g(new THREE.BoxGeometry(chord * 0.75, chord * 0.32, (R - r0) * 0.1), kit.metal, m.clone().multiply(mtx([0, 0, r0 + (R - r0) * 0.03])));
  // painted tip band
  b.g(new THREE.BoxGeometry(chord * 0.9, chord * 0.1, (R - r0) * 0.06), kit.hazard, m.clone().multiply(mtx([chord * 0.05, 0, R - (R - r0) * 0.04], [0, 0, pitch * 0.15])));
}

interface Spinner { g: THREE.Object3D; spd: number; axis: 'y' | 'z' }

function rotorHead(kit: Kit, R: number, n: number, spinners: Spinner[], parent: THREE.Object3D, at: V3, spd: number, tail = false): THREE.Group {
  const g = new THREE.Group();
  g.position.set(...at);
  const b = new Bld();
  const chord = R * (tail ? 0.18 : 0.062) + 0.01;
  const r0 = R * 0.11;
  for (let i = 0; i < n; i++) blade(b, kit, R, chord, r0, mtx([0, 0, 0], [0, (i / n) * Math.PI * 2, 0]));
  // hub: blade grips on a dark yoke, a hub cap, and under it the swashplate (two plates) with a pitch link per blade
  b.lathe(kit.metal, [[0, -R * 0.03], [R * 0.08, -R * 0.03], [R * 0.095, 0], [R * 0.075, R * 0.035], [0, R * 0.05]], [0, 0, 0], 'y', 8);
  b.cyl(kit.trim, R * 0.03, R * 0.022, R * 0.05, [0, R * 0.04, 0], 'y', 6);
  if (!tail) {
    const sw = -R * 0.085;
    b.cyl(kit.trim, R * 0.075, R * 0.075, R * 0.014, [0, sw, 0], 'y', 10);
    b.cyl(kit.metal, R * 0.06, R * 0.06, R * 0.012, [0, sw + R * 0.016, 0], 'y', 10);
    b.cyl(kit.metal, R * 0.022, R * 0.022, -sw, [0, sw, 0], 'y', 6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.35, ca = Math.cos(a), sa = Math.sin(a);
      b.strut(kit.steel, [sa * R * 0.06, sw + R * 0.02, ca * R * 0.06], [sa * R * 0.085, -R * 0.01, ca * R * 0.085], R * 0.006, R * 0.006, 4);
    }
  }
  b.mount(g);
  g.add(blurDisc(R * 0.98));
  parent.add(g);
  spinners.push({ g, spd, axis: 'y' });
  return g;
}

/** build lift hardware; returns the per-frame updater */
export function buildLift(root: THREE.Group, kit: Kit, lift: Lift[]): (t: number, mv: number) => void {
  const b = new Bld();
  const spinners: Spinner[] = [];
  const flames: THREE.Object3D[] = [];
  for (const l of lift) {
    const [x, y, z] = l.p, r = l.r, dir = l.dir ?? 1;
    switch (l.kind) {
      case 'rotor': {
        // mast collar under the head
        b.cylb(kit.trim, r * 0.06, r * 0.12, r * 0.02, [x, y - r * 0.12, z], 'y', 10);
        rotorHead(kit, r, l.blades ?? 3, spinners, root, [x, y, z], 26 * dir);
        break;
      }
      case 'coax': {
        const gap = r * 0.12;
        b.cylb(kit.trim, r * 0.07, r * 0.1, r * 0.02, [x, y - r * 0.08, z], 'y', 10);
        b.cyl(kit.steel, r * 0.035, r * 0.035, gap + r * 0.04, [x, y, z], 'y', 8);
        rotorHead(kit, r, l.blades ?? 3, spinners, root, [x, y, z], 24);
        rotorHead(kit, r * 0.94, l.blades ?? 3, spinners, root, [x, y + gap, z], -24);
        b.lathe(kit.metal, [[0, 0], [r * 0.06, 0], [r * 0.04, r * 0.07], [0, r * 0.09]], [x, y + gap + r * 0.05, z], 'y', 8);
        break;
      }
      case 'tail': {
        const g = new THREE.Group();
        g.position.set(x, y, z);
        g.rotation.x = Math.PI / 2;
        const inner = new THREE.Group();
        g.add(inner);
        root.add(g);
        rotorHead(kit, r, l.blades ?? 4, spinners, inner, [0, 0, 0], 60 * dir, true);
        break;
      }
      case 'duct': {
        // outer frame tilted as a unit; the fan spins inside it
        const frame = new THREE.Group();
        frame.position.set(x, y, z);
        frame.rotation.set(l.roll ?? 0, 0, -(l.tilt ?? 0), 'XYZ');
        root.add(frame);
        const fb = new Bld();
        const h = r * 0.5, R1 = r * 1.28;
        // thick ring (closed profile: inner wall, flat bottom, rounded outer skin, flared intake lip), accent band,
        // stator spokes and hub cone
        const sg = r < 0.16 ? 12 : 18;
        fb.lathe(kit.panel, [[r * 1.02, h * 0.4], [r, h * 0.28], [r, -h * 0.5], [R1 * 0.96, -h * 0.5], [R1, -h * 0.1], [R1 * 0.98, h * 0.35], [r * 1.14, h * 0.55], [r * 1.02, h * 0.4]], [0, 0, 0], 'y', sg);
        fb.lathe(kit.hull, [[R1 * 0.9, -h * 0.12], [R1 * 1.012, -h * 0.12], [R1 * 1.012, h * 0.06], [R1 * 0.9, h * 0.06]], [0, 0, 0], 'y', sg);
        // dark inner duct wall (inward-facing tube)
        fb.lathe(kit.trim, [[r * 0.995, h * 0.26], [r * 0.995, -h * 0.48]], [0, 0, 0], 'y', sg);
        for (let i = 0; i < 3; i++) fb.g(new THREE.BoxGeometry(r * 0.08, h * 0.12, r * 1.95), kit.metal, mtx([0, -h * 0.32, 0], [0, (i / 3) * Math.PI, 0]));
        fb.lathe(kit.metal, [[0, -h * 0.75], [r * 0.2, -h * 0.4], [r * 0.24, h * 0.1], [0, h * 0.3]], [0, 0, 0], 'y', 8);
        fb.mount(frame);
        const fan = new THREE.Group();
        const bb = new Bld();
        const n = l.blades ?? 7;
        for (let i = 0; i < n; i++) {
          const m = mtx([0, 0, 0], [0, (i / n) * Math.PI * 2, 0]);
          bb.g(new THREE.BoxGeometry(r * 0.28, r * 0.03, r * 0.74), kit.trim, m.clone().multiply(mtx([0, 0, r * 0.6], [0, 0, 0.5])));
        }
        bb.mount(fan);
        fan.add(blurDisc(r * 0.97));
        frame.add(fan);
        spinners.push({ g: fan, spd: 34 * dir, axis: 'y' });
        break;
      }
      case 'jet': {
        const len = l.len ?? r * 1.6;
        // engine can (dark), convergent nozzle petals (gunmetal) flaring out to the exit, black liner, turbine face
        // with a hot core deep inside and a hot flame-holder ring
        b.lathe(kit.trim, [[r * 1.02, 0], [r * 1.12, len * 0.5], [r * 1.12, len], [0, len]], [x + len, y, z], '-x', 12);
        const np = r < 0.09 ? 10 : 14;
        for (let i = 0; i < np; i++) {
          const a = (i / np) * Math.PI * 2;
          const m = new THREE.Matrix4().makeTranslation(x + len * 0.18, y, z)
            .multiply(new THREE.Matrix4().makeRotationX(a))
            .multiply(new THREE.Matrix4().makeTranslation(0, r * 0.98, 0))
            .multiply(new THREE.Matrix4().makeRotationZ(0.1));
          b.g(new THREE.BoxGeometry(len * 0.62, r * 0.07, ((Math.PI * 2 * r) / np) * 1.02), kit.metal, m);
        }
        b.lathe(kit.trim, [[r * 0.9, len * 0.85], [r * 0.9, -len * 0.02]], [x + len, y, z], '-x', 10);
        b.cyl(kit.hot, r * 0.7, r * 0.55, len * 0.02, [x + len * 0.62, y, z], '-x', 10);
        b.cylb(kit.hot, r * 0.42, len * 0.04, r * 0.01, [x + len * 0.45, y, z], '-x', 8);
        const fl = new THREE.Group();
        fl.position.set(x - len * 0.0, y, z);
        const fb = new Bld();
        fb.lathe(kit.hot, [[0, 0], [r * 0.62, 0], [r * 0.3, len * 0.8], [0, len * 1.25]], [0, 0, 0], '-x', 8);
        fb.mount(fl, undefined, { shadow: false });
        root.add(fl);
        flames.push(fl);
        break;
      }
      case 'grav': {
        const h = l.len ?? r * 0.7;
        // rounded can: hull shell, dark waist, glowing emitter dish facing down
        b.lathe(kit.panel, [[0, h * 0.5], [r * 0.7, h * 0.5], [r * 0.95, h * 0.3], [r, 0], [r * 0.92, -h * 0.25], [r * 0.74, -h * 0.36], [0, -h * 0.36]], [x, y, z], 'y', 16);
        b.cylb(kit.trim, r * 1.03, h * 0.16, h * 0.04, [x, y - h * 0.12, z], 'y', 16);
        b.lathe(kit.glow, [[0, -h * 0.5], [r * 0.6, -h * 0.4], [r * 0.7, -h * 0.36], [0, -h * 0.36]], [x, y, z], 'y', 14);
        b.cyl(kit.metal, r * 0.22, r * 0.22, h * 0.12, [x, y + h * 0.5, z], 'y', 8);
        // orbiting fin ring with glow notches
        const ring = new THREE.Group();
        ring.position.set(x, y - h * 0.28, z);
        const rb = new Bld();
        const nf = 6;
        for (let i = 0; i < nf; i++) {
          const a = (i / nf) * Math.PI * 2, cx = Math.cos(a) * r * 1.22, cz = Math.sin(a) * r * 1.22;
          rb.g(new THREE.BoxGeometry(r * 0.42, h * 0.12, r * 0.14), kit.trim, mtx([cx, 0, cz], [0, -a + Math.PI / 2, 0]));
          rb.g(new THREE.BoxGeometry(r * 0.08, h * 0.14, r * 0.08), kit.glow, mtx([cx, 0, cz], [0, -a, 0]));
        }
        rb.mount(ring);
        root.add(ring);
        spinners.push({ g: ring, spd: 1.4 * dir, axis: 'y' });
        break;
      }
    }
  }
  b.mount(root);
  return (t, mv) => {
    for (let i = 0; i < spinners.length; i++) {
      const s = spinners[i];
      if (s.axis === 'y') s.g.rotation.y = t * s.spd + i * 0.7;
      else s.g.rotation.z = t * s.spd + i * 0.7;
    }
    for (let i = 0; i < flames.length; i++) {
      const k = 0.85 + 0.15 * Math.sin(t * 47 + i * 2.1) + 0.2 * mv;
      flames[i].scale.set(k, 1, 1);
    }
  };
}

/** default lift for an airframe that did not place its own */
function defaultLift(mobId: string, L: number, W: number, S: number): Lift[] {
  const y = 0.3 + 0.1 * S;
  if (mobId === 'jet') return [{ kind: 'jet', p: [-L / 2, y, 0], r: 0.06 + 0.03 * S }];
  if (mobId === 'gravlift') return [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ kind: 'grav', p: [sx * L * 0.3, y - 0.1, sz * W * 0.35], r: 0.12 * S } as Lift)));
  return [{ kind: 'rotor', p: [0, y + 0.3, 0], r: L * 0.5, blades: 3 }];
}

registerMobility(['rotor', 'jet', 'gravlift'], {
  stance: airStance,
  build(c) {
    const ac = c as AirMobCtx;
    return buildLift(c.root, c.kit, ac.lift ?? defaultLift(c.mobId, c.L, c.W, c.S));
  },
});

/** fuselage loft helper re-exported for airframes: superellipse stations [x, cy, ry, rz] */
export function fuse(b: Bld, mat: Parameters<Bld['loft']>[0], st: [number, number, number, number][], n = 10, pw = 2.4, cz = 0, flat = 0): void {
  b.loft(mat, st.map(([x, cy, ry, rz]) => ellRing(x, cy, cz, Math.max(0.002, ry), Math.max(0.002, rz), n, pw, flat)));
}
