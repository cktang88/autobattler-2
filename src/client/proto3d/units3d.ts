// Procedural 3D unit assembly from a Design: mobility (running gear) -> hull tiers -> turrets at mountOffsets().
// Unit-local frame: +X = forward, +Y = up, +Z = right (sim +y). 1 unit = 1 cell (5 m).

import * as THREE from 'three';
import { CHASSIS_BY_ID, MODULE_BY_ID, MOBILITY_BY_ID } from '../../shared/parts.ts';
import { mountOffsets } from '../../shared/mountgeo.ts';
import type { Design } from '../../shared/types.ts';
import { makeKit, rng, type Kit } from './materials.ts';
import { buildTurret, type Turret } from './weapons3d.ts';

type Pt = [number, number];

export interface Unit3D {
  root: THREE.Group;
  design: Design;
  team: 0 | 1;
  turrets: Turret[];
  L: number; W: number; S: number;
  flying: boolean;
  /** per-frame idle/locomotion animation */
  animate(t: number, dt: number, moving: number): void;
  /** world-space turret mount for tracer origin etc. */
  radius: number;
}

// ---- small geometry helpers ------------------------------------------------------------------
const shadowed = <T extends THREE.Mesh>(m: T): T => { m.castShadow = m.receiveShadow = true; return m; };
function add(parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = shadowed(new THREE.Mesh(g, m));
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}
/** box with bottom at y */
const box = (parent: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) =>
  add(parent, new THREE.BoxGeometry(w, h, d), m, x, y + h / 2, z);
const cylX = (rt: number, rb: number, len: number) => new THREE.CylinderGeometry(rt, rb, len, 16).rotateZ(Math.PI / 2);
/** cylinder with axis along Z (wheels) */
const cylZ = (r: number, len: number, seg = 18) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);

function inPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** prism from a footprint polygon (points: x fwd, y right), bottom at y0 */
function prism(poly: Pt[], y0: number, h: number, m: THREE.Material, parent: THREE.Object3D, bevel = 0.04): THREE.Mesh {
  const s = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, -y)));
  const b = Math.min(bevel, h * 0.3);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.01, h - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, b, 0);
  return add(parent, g, m, 0, y0, 0);
}

/** sloped armour block: bottom outline -> smaller top outline, flat-shaded (reads as welded plate, not a rounded blob) */
function frustum(bot: Pt[], top: Pt[], y0: number, h: number, m: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
  const pos: number[] = [];
  const n = bot.length;
  const v = (p: Pt, y: number) => pos.push(p[0], y, p[1]);
  // winding: outline is given x fwd / y right; build with outward normals via sign of area
  let area = 0;
  for (let i = 0; i < n; i++) { const a = bot[i], b = bot[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = bot[i], b = bot[j], c = top[j], d = top[i];
    if (area > 0) { v(a, y0); v(c, y0 + h); v(b, y0); v(a, y0); v(d, y0 + h); v(c, y0 + h); }
    else { v(a, y0); v(b, y0); v(c, y0 + h); v(a, y0); v(c, y0 + h); v(d, y0 + h); }
  }
  const tri = THREE.ShapeUtils.triangulateShape(top.map((p) => new THREE.Vector2(p[0], p[1])), []);
  for (const t of tri) {
    const tt = area > 0 ? [t[0], t[2], t[1]] : [t[0], t[1], t[2]];
    for (const k of tt) v(top[k], y0 + h);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return add(parent, g, m);
}

// ---- hull outlines (unit square, x fwd -1..1, y right -1..1) ----------------------------------
const P: Record<string, Pt[]> = {
  wedge: [[1, 0], [0.45, 0.8], [-0.85, 1], [-1, 0.6], [-1, -0.6], [-0.85, -1], [0.45, -0.8]],
  box: [[1, 0.55], [0.72, 1], [-0.8, 1], [-1, 0.78], [-1, -0.78], [-0.8, -1], [0.72, -1], [1, -0.55]],
  oct: [[1, 0.42], [0.62, 1], [-0.62, 1], [-1, 0.55], [-1, -0.55], [-0.62, -1], [0.62, -1], [1, -0.42]],
  long: [[1, 0.35], [0.8, 0.9], [-0.9, 1], [-1, 0.7], [-1, -0.7], [-0.9, -1], [0.8, -0.9], [1, -0.35]],
  cross: [[1, 0.32], [0.62, 0.5], [0.34, 1], [-0.42, 1], [-0.62, 0.58], [-1, 0.5], [-1, -0.5], [-0.62, -0.58], [-0.42, -1], [0.34, -1], [0.62, -0.5], [1, -0.32]],
  circ: Array.from({ length: 16 }, (_, i) => [Math.cos((i / 16) * Math.PI * 2), Math.sin((i / 16) * Math.PI * 2)] as Pt),
  armored: [[1, 0.5], [0.8, 0.78], [0.55, 1], [-0.7, 1], [-0.9, 0.86], [-1, 0.6], [-1, -0.6], [-0.9, -0.86], [-0.7, -1], [0.55, -1], [0.8, -0.78], [1, -0.5]],
  giant: [[1, 0.36], [0.74, 0.7], [0.5, 1], [-0.6, 1], [-0.86, 0.84], [-1, 0.52], [-1, -0.52], [-0.86, -0.84], [-0.6, -1], [0.5, -1], [0.74, -0.7], [1, -0.36]],
};
interface TierSpec { p: string; k: number; dx?: number; slope?: number; h: number; m: 'body' | 'light' | 'dark' | 'camo' }
const TIERS: Record<string, TierSpec[]> = {
  wedge: [{ p: 'wedge', k: 1, h: 0.2, m: 'body' }, { p: 'wedge', k: 0.5, dx: -0.1, h: 0.12, m: 'light' }],
  box: [{ p: 'box', k: 1, h: 0.2, m: 'body' }, { p: 'box', k: 0.62, dx: -0.12, h: 0.14, m: 'camo' }],
  hex: [{ p: 'oct', k: 1, h: 0.2, m: 'body' }, { p: 'oct', k: 0.74, dx: -0.04, h: 0.1, m: 'camo' }],
  long: [{ p: 'long', k: 1, h: 0.2, m: 'body' }, { p: 'box', k: 0.42, dx: -0.48, h: 0.16, m: 'camo' }],
  cross: [{ p: 'cross', k: 1, h: 0.2, m: 'body' }, { p: 'oct', k: 0.55, dx: -0.1, h: 0.1, m: 'camo' }],
  round: [{ p: 'circ', k: 1, h: 0.22, m: 'body' }, { p: 'circ', k: 0.56, h: 0.14, m: 'light' }],
  fortress: [{ p: 'oct', k: 1, h: 0.17, m: 'body' }, { p: 'oct', k: 0.82, h: 0.13, m: 'camo' }, { p: 'oct', k: 0.56, h: 0.1, m: 'light' }],
  titan: [{ p: 'armored', k: 1, h: 0.17, m: 'body' }, { p: 'armored', k: 0.84, dx: -0.04, h: 0.12, m: 'camo' }, { p: 'oct', k: 0.5, dx: -0.1, h: 0.1, m: 'light' }],
  goliath: [{ p: 'giant', k: 1, h: 0.2, m: 'body' }, { p: 'giant', k: 0.84, dx: -0.05, h: 0.14, m: 'camo' }, { p: 'giant', k: 0.55, dx: -0.12, h: 0.11, m: 'light' }],
  colossal: [{ p: 'giant', k: 1, h: 0.2, m: 'body' }, { p: 'giant', k: 0.84, dx: -0.04, h: 0.18, m: 'camo' }, { p: 'giant', k: 0.58, dx: -0.1, h: 0.17, m: 'light' }, { p: 'oct', k: 0.3, dx: -0.12, h: 0.1, m: 'body' }],
};

interface Placed { poly: Pt[]; top: number }

// ---- running gear -----------------------------------------------------------------------------
interface Gear { y0: number; update?: (t: number, moving: number) => void; flying?: boolean; hover?: number }

function track(g: THREE.Object3D, kit: Kit, L: number, h: number, w: number, z: number, y: number, skirt: boolean) {
  const r = Math.min(h * 0.48, L * 0.2);
  const s = new THREE.Shape();
  const hl = L / 2;
  s.moveTo(-hl + r, 0); s.lineTo(hl - r, 0);
  s.absarc(hl - r, r, r, -Math.PI / 2, 0.2, false); // front sprocket arc to slightly rising run
  s.lineTo(hl - r * 0.4, h - r * 0.35); s.lineTo(hl - r * 1.3, h);
  s.lineTo(-hl + r * 1.3, h); s.lineTo(-hl + r * 0.4, h - r * 0.35);
  s.absarc(-hl + r, r, r, Math.PI - 0.2, 1.5 * Math.PI, false);
  const b = Math.min(0.03, w * 0.2);
  const geo = new THREE.ExtrudeGeometry(s, { depth: w - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b * 0.8, bevelSegments: 1, curveSegments: 8 });
  geo.translate(0, 0, -(w - 2 * b) / 2);
  add(g, geo, kit.rubber, 0, y, z);
  // cleats along top and bottom runs
  const nC = Math.max(6, Math.floor(L / (h * 0.28)));
  const cl = new THREE.InstancedMesh(new THREE.BoxGeometry(h * 0.1, h * 0.05, w * 1.02), kit.metal, nC * 2);
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < nC; i++) {
    const x = -hl + r * 1.3 + ((L - r * 2.6) * (i + 0.5)) / nC;
    mtx.makeTranslation(x, y + h + 0.004, z); cl.setMatrixAt(i, mtx);
    mtx.makeTranslation(x, y - 0.004, z); cl.setMatrixAt(nC + i, mtx);
  }
  cl.castShadow = true;
  g.add(cl);
  // road wheels + sprocket/idler on the outer face
  const nW = Math.max(3, Math.round(L / (h * 0.9)));
  const side = z >= 0 ? 1 : -1;
  for (let i = 0; i < nW; i++) {
    const x = -hl + r + ((L - 2 * r) * i) / (nW - 1);
    const wr = i === 0 || i === nW - 1 ? r * 0.92 : h * 0.34;
    add(g, cylZ(wr, 0.04), kit.metal, x, y + (i === 0 || i === nW - 1 ? r : h * 0.36), z + side * (w / 2 + 0.002));
    add(g, cylZ(wr * 0.42, 0.06), kit.steel, x, y + (i === 0 || i === nW - 1 ? r : h * 0.36), z + side * (w / 2 + 0.012));
  }
  if (skirt) box(g, kit.dark, L * 0.78, h * 0.34, 0.03, 0, y + h * 0.56, z + side * (w / 2 + 0.03));
}

function buildGear(g: THREE.Group, mobId: string, L: number, W: number, S: number, kit: Kit, rnd: () => number): Gear & { legs?: Leg[] } {
  const hf = Math.min(L, W);
  switch (mobId) {
    case 'treads': case 'halftrack': {
      const h = 0.2 + 0.11 * S, w = Math.max(0.16, W * 0.2);
      const z = W / 2 - w / 2 - 0.02;
      if (mobId === 'treads') {
        for (const sg of [-1, 1]) track(g, kit, L * 0.97, h, w, sg * z, 0, S >= 2);
      } else {
        // wheels up front, short tracks behind
        for (const sg of [-1, 1]) {
          track(g, kit, L * 0.5, h, w, sg * z, 0, false);
          const wr = h * 0.5;
          for (const dx of [0.2]) {
            add(g, cylZ(wr, w * 0.9), kit.rubber, L * 0.3 + dx * L * 0.1, wr, sg * z);
            add(g, cylZ(wr * 0.5, w * 0.95), kit.steel, L * 0.3 + dx * L * 0.1, wr, sg * z);
          }
        }
        add(g, new THREE.CylinderGeometry(0.02, 0.02, W * 0.7, 8).rotateX(Math.PI / 2), kit.metal, L * 0.3, h * 0.5, 0);
      }
      return { y0: h * 0.55 };
    }
    case 'wheels': {
      const wr = 0.1 + 0.08 * S, w = wr * 0.7;
      const xs = S >= 2 ? [0.3, -0.3] : [0.28, -0.28];
      const wheels: THREE.Object3D[] = [];
      for (const xf of xs) for (const sg of [-1, 1]) {
        const grp = new THREE.Group();
        grp.position.set(xf * L, wr, sg * (W / 2 - w / 2 + 0.01));
        add(grp, cylZ(wr, w, 20), kit.rubber);
        add(grp, cylZ(wr * 0.55, w * 1.05, 14), kit.steel);
        // lug nuts
        for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; add(grp, new THREE.CylinderGeometry(0.012, 0.012, w * 1.15, 6).rotateX(Math.PI / 2), kit.deep, Math.cos(a) * wr * 0.3, Math.sin(a) * wr * 0.3, 0); }
        g.add(grp);
        wheels.push(grp);
      }
      for (const xf of xs) add(g, new THREE.CylinderGeometry(0.025, 0.025, W - w, 8).rotateX(Math.PI / 2), kit.metal, xf * L, wr, 0);
      return { y0: wr * 1.05, update: (t, mv) => wheels.forEach((w2) => { w2.children.forEach((c) => (c.rotation.z = -t * 6 * mv)); }) };
    }
    case 'megatracks': {
      // four huge track assemblies, two per side, hull rides on top
      const h = 0.38 + 0.2 * S, w = W * 0.15;
      const zs = [-0.405, -0.215, 0.215, 0.405];
      for (const zf of zs) track(g, kit, L * 0.94, h, w, zf * W, 0, true);
      // cross axle housing
      box(g, kit.dark, L * 0.5, h * 0.35, W * 0.7, 0, h * 0.6, 0);
      return { y0: h * 0.72 };
    }
    case 'legs': case 'spider': case 'titanlegs': case 'jumpjets': {
      const legs: Leg[] = [];
      const spider = mobId === 'spider';
      const hy = (spider ? 0.38 : 0.55) * hf + 0.18 * S;
      const nLegs = spider ? 6 : 2;
      const thick = (spider ? 0.035 : 0.07) * Math.min(S, 3) + 0.025;
      for (let i = 0; i < nLegs; i++) {
        const sg = i % 2 ? 1 : -1;
        const row = spider ? Math.floor(i / 2) - 1 : 0;
        const hipX = spider ? row * L * 0.3 : -0.04 * L;
        const hipZ = sg * (spider ? W * 0.3 : W * 0.28);
        const footX = hipX + (spider ? row * L * 0.2 : 0);
        const footZ = sg * (spider ? W * 0.5 + hy * 0.95 : W * 0.3);
        legs.push(makeLeg(g, kit, new THREE.Vector3(hipX, hy, hipZ), new THREE.Vector3(footX, 0, footZ), thick, spider ? new THREE.Vector3(0, 1, sg * 0.35) : new THREE.Vector3(1, 0.1, 0), spider ? (i % 2 ? 0 : Math.PI) + row * 2.1 : (i % 2) * Math.PI));
      }
      return {
        y0: hy - 0.04, legs,
        update: (t, mv) => legs.forEach((lg) => lg.step(t, mv)),
      };
    }
    case 'anchor': {
      box(g, kit.dark, L * 0.95, 0.12, W * 0.95, 0, 0, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, new THREE.CylinderGeometry(0.1, 0.14, 0.16, 8), kit.metal, sx * L * 0.42, 0.08, sz * W * 0.42);
      return { y0: 0.12 };
    }
    case 'rotor': case 'gravlift': case 'jet': {
      return { y0: 0, flying: true };
    }
    default: {
      // hover skirt / unknown: low skirt with fan intakes
      const hgt = 0.12 + 0.05 * S;
      prism(P.oct.map(([x, y]) => [x * L * 0.5, y * W * 0.5] as Pt), 0, hgt, kit.rubber, g, 0.03);
      return { y0: hgt * 0.8 };
    }
  }
}

// ---- 2-bone IK legs ---------------------------------------------------------------------------
interface Leg { step(t: number, moving: number): void }
function makeLeg(g: THREE.Object3D, kit: Kit, hip: THREE.Vector3, foot: THREE.Vector3, thick: number, bend: THREE.Vector3, phase: number): Leg {
  const d0 = hip.distanceTo(foot);
  const l1 = d0 * 0.74, l2 = d0 * 0.74;
  const segGeo = (r0: number, r1: number) => new THREE.CylinderGeometry(r1, r0, 1, 10).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  const upper = add(g, segGeo(thick * 1.1, thick), kit.dark);
  const lower = add(g, segGeo(thick, thick * 0.7), kit.body);
  const knee = add(g, new THREE.SphereGeometry(thick * 1.1, 12, 10), kit.dark);
  const hipJ = add(g, new THREE.SphereGeometry(thick * 1.15, 12, 10), kit.dark, hip.x, hip.y, hip.z);
  const pad = add(g, new THREE.CylinderGeometry(thick * 1.2, thick * 1.5, thick * 0.8, 10), kit.deep);
  void hipJ;
  const f = new THREE.Vector3(), k = new THREE.Vector3(), dir = new THREE.Vector3(), perp = new THREE.Vector3();
  const stride = d0 * 0.32, lift = d0 * 0.22;
  const place = (a: THREE.Vector3, b: THREE.Vector3, m: THREE.Object3D) => {
    m.position.copy(a);
    const dd = b.clone().sub(a);
    const len = dd.length();
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dd.divideScalar(len || 1));
    m.scale.set(1, 1, len);
  };
  return {
    step(t, moving) {
      const ph = t * 3.2 + phase;
      f.copy(foot);
      f.x += -Math.sin(ph) * stride * moving;
      f.y += Math.max(0, Math.cos(ph)) * lift * moving;
      dir.copy(f).sub(hip);
      let d = dir.length();
      d = Math.min(d, l1 + l2 - 1e-3);
      dir.normalize();
      const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
      const hgt = Math.sqrt(Math.max(0, l1 * l1 - a * a));
      perp.copy(bend).addScaledVector(dir, -bend.dot(dir)).normalize();
      k.copy(hip).addScaledVector(dir, a).addScaledVector(perp, hgt);
      place(hip, k, upper);
      place(k, f, lower);
      knee.position.copy(k);
      pad.position.copy(f).y += thick * 0.4;
    },
  };
}

// ---- hull -------------------------------------------------------------------------------------
function buildHull(g: THREE.Group, shape: string, L: number, W0: number, y0: number, kit: Kit, wk = 1): { placed: Placed[]; top: number } {
  const W = W0 * wk;
  const hf = Math.pow(Math.min(L, W), 0.85);
  const recipe = TIERS[shape] ?? TIERS.box;
  const placed: Placed[] = [];
  let y = y0;
  for (const t of recipe) {
    const base = P[t.p] ?? P.box;
    const poly = base.map(([x, yy]) => [(x * t.k + (t.dx ?? 0)) * L * 0.5, yy * t.k * W * 0.5] as Pt);
    const h = Math.max(0.06, t.h * hf * 0.66);
    const m = kit[t.m];
    const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    const sl = 1 - (t.slope ?? 0.07) * Math.min(1, h / 0.6 + 0.3);
    const topPoly = poly.map(([px, pz]) => [cx + (px - cx) * (1 - (1 - sl) * (0.6 + 0.4 * Math.abs(px - cx) / (L * 0.5 + 1e-6)) * 0.9) , cz + (pz - cz) * (1 - (1 - sl) * 1.6 * Math.min(1, 0.4 + Math.abs(pz - cz) / (W * 0.5 + 1e-6)))] as Pt);
    frustum(poly, topPoly, y, h, m, g);
    // top deck plate seam: thin lighter inset line is provided by the triplanar texture
    y += h;
    placed.push({ poly, top: y });
  }
  return { placed, top: y };
}

function deckAt(placed: Placed[], x: number, z: number, fallback: number): number {
  let top = -Infinity;
  for (const p of placed) if (inPoly([x, z], p.poly)) top = Math.max(top, p.top);
  return top === -Infinity ? fallback : top;
}

// ---- greebles ---------------------------------------------------------------------------------
function greeble(g: THREE.Group, placed: Placed[], L: number, W: number, S: number, kit: Kit, rnd: () => number, mounts: Pt[], mountR: number[], skipTop: boolean) {
  const free = (x: number, z: number, rad: number) => mounts.every((m, i) => Math.hypot(m[0] - x, m[1] - z) > mountR[i] + rad);
  const n = Math.round(4 + 6 * S);
  for (let i = 0; i < n; i++) {
    const x = (rnd() - 0.5) * L * 0.8, z = (rnd() - 0.5) * W * 0.8;
    const top = deckAt(placed, x, z, -1);
    if (top < 0 || !free(x, z, 0.12)) continue;
    const kind = rnd();
    const u = 0.05 + 0.025 * S;
    if (kind < 0.35) { // hatch
      add(g, new THREE.CylinderGeometry(u * 0.9, u * 1.05, u * 0.4, 12), kit.dark, x, top + u * 0.2, z);
    } else if (kind < 0.7) { // vent grille
      const w = u * 3, d = u * 2;
      box(g, kit.deep, w, u * 0.3, d, x, top, z);
      for (let k = 0; k < 4; k++) box(g, kit.metal, w * 0.9, u * 0.35, u * 0.12, x, top + 0.005, z - d * 0.38 + (k * d * 0.76) / 3);
    } else if (kind < 0.88) { // crate / stowage box
      box(g, rnd() < 0.5 ? kit.camo : kit.dark, u * 2.4, u * 1.4, u * 1.8, x, top, z);
    } else { // antenna
      add(g, new THREE.CylinderGeometry(0.006, 0.012, u * 5, 6), kit.steel, x, top + u * 2.5, z);
    }
  }
  void skipTop;
}

// ---- aircraft ---------------------------------------------------------------------------------
function buildJet(g: THREE.Group, L: number, W: number, kit: Kit): { placed: Placed[]; top: number; update: (t: number) => void } {
  // fuselage (lofted), delta wings, twin tails, canopy, nozzles
  const hl = L / 2;
  const fus = new THREE.Shape();
  fus.moveTo(hl, 0); fus.lineTo(hl * 0.55, W * 0.07); fus.lineTo(-hl * 0.2, W * 0.12); fus.lineTo(-hl * 0.95, W * 0.1);
  fus.lineTo(-hl, W * 0.06); fus.lineTo(-hl, -W * 0.06); fus.lineTo(-hl * 0.95, -W * 0.1); fus.lineTo(-hl * 0.2, -W * 0.12); fus.lineTo(hl * 0.55, -W * 0.07); fus.closePath();
  const fg = new THREE.ExtrudeGeometry(fus, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.05, bevelSegments: 3 });
  fg.rotateX(-Math.PI / 2);
  add(g, fg, kit.body, 0, 0, 0);
  // fuselage upper spine
  const sp = new THREE.Shape();
  sp.moveTo(hl * 0.45, 0); sp.lineTo(-hl * 0.1, W * 0.06); sp.lineTo(-hl * 0.85, W * 0.05); sp.lineTo(-hl * 0.85, -W * 0.05); sp.lineTo(-hl * 0.1, -W * 0.06); sp.closePath();
  const sg = new THREE.ExtrudeGeometry(sp, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.03, bevelSegments: 2 });
  sg.rotateX(-Math.PI / 2);
  add(g, sg, kit.camo, 0, 0.3, 0);
  // wings
  const wing = new THREE.Shape();
  wing.moveTo(hl * 0.1, 0); wing.lineTo(-hl * 0.55, W * 0.5); wing.lineTo(-hl * 0.85, W * 0.5); wing.lineTo(-hl * 0.8, 0.1); wing.lineTo(-hl * 0.8, -0.1); wing.lineTo(-hl * 0.85, -W * 0.5); wing.lineTo(-hl * 0.55, -W * 0.5); wing.closePath();
  const wg = new THREE.ExtrudeGeometry(wing, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 1 });
  wg.rotateX(-Math.PI / 2);
  add(g, wg, kit.light, 0, 0.12, 0);
  // tails
  for (const sg2 of [-1, 1]) {
    const tail = new THREE.Shape();
    tail.moveTo(0, 0); tail.lineTo(-0.5, 0); tail.lineTo(-0.28, 0.5); tail.lineTo(-0.12, 0.5); tail.closePath();
    const tg = new THREE.ExtrudeGeometry(tail, { depth: 0.015, bevelEnabled: false });
    const m = add(g, tg, kit.dark, -hl * 0.72, 0.28, sg2 * W * 0.12);
    m.rotation.x = sg2 * 0.28;
    m.position.z = sg2 * W * 0.13;
  }
  // canopy
  add(g, new THREE.SphereGeometry(1, 16, 10).scale(L * 0.15, 0.1, W * 0.06), kit.glass, hl * 0.18, 0.3, 0);
  // nozzles with afterburner glow
  for (const sg2 of [-1, 1]) {
    add(g, cylX(0.07, 0.09, 0.3), kit.steel, -hl - 0.05, 0.2, sg2 * 0.1);
    add(g, new THREE.CircleGeometry(0.06, 12).rotateY(-Math.PI / 2), kit.hot, -hl - 0.2, 0.2, sg2 * 0.1);
  }
  const placed: Placed[] = [{ poly: [[hl * 0.5, 0.2], [-hl * 0.5, 0.4], [-hl * 0.5, -0.4], [hl * 0.5, -0.2]], top: 0.1 }];
  return { placed, top: 0.1, update: () => {} };
}

function buildRotor(g: THREE.Group, chassisId: string, L: number, W: number, S: number, kit: Kit): { top: number; update: (t: number) => void } {
  const blades: THREE.Object3D[] = [];
  const discs: THREE.Mesh[] = [];
  const mkRotor = (x: number, y: number, z: number, R: number) => {
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    for (let i = 0; i < 2; i++) {
      const b = add(grp, new THREE.BoxGeometry(R * 2, 0.012, R * 0.12), kit.deep);
      b.rotation.y = (i * Math.PI) / 2;
    }
    add(grp, new THREE.CylinderGeometry(R * 0.07, R * 0.07, 0.05, 10), kit.steel);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#cfd5da', transparent: true, opacity: 0.1, depthWrite: false }));
    grp.add(disc);
    discs.push(disc);
    g.add(grp);
    blades.push(grp);
  };
  if (chassisId === 'drone') {
    // quad-rotor
    add(g, new THREE.SphereGeometry(1, 16, 12).scale(L * 0.2, 0.09, L * 0.2), kit.body, 0, 0.22, 0);
    add(g, new THREE.SphereGeometry(1, 12, 8).scale(L * 0.09, 0.05, L * 0.11), kit.glass, L * 0.14, 0.27, 0);
    add(g, cylX(0.015, 0.015, L * 0.36), kit.metal, 0, 0.2, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const arm = add(g, new THREE.BoxGeometry(L * 0.5, 0.025, 0.04), kit.metal, sx * L * 0.2, 0.22, sz * L * 0.2);
      arm.rotation.y = -sx * sz * Math.PI / 4;
      add(g, cylX(0.04, 0.04, 0.09).rotateZ(Math.PI / 2), kit.dark, sx * L * 0.4, 0.24, sz * L * 0.4);
      mkRotor(sx * L * 0.4, 0.32, sz * L * 0.4, L * 0.22);
    }
    return { top: 0.2, update: (t) => blades.forEach((b, i) => (b.rotation.y = t * 90 * (i % 2 ? 1 : -1))) };
  }
  // helicopter: fuselage + boom + main rotor
  add(g, new THREE.SphereGeometry(1, 20, 14).scale(L * 0.3, 0.28 * Math.sqrt(S), W * 0.24), kit.body, L * 0.05, 0.4, 0);
  add(g, new THREE.SphereGeometry(1, 14, 10).scale(L * 0.12, 0.18 * Math.sqrt(S), W * 0.16), kit.glass, L * 0.22, 0.44, 0);
  add(g, cylX(0.05, 0.03, L * 0.5), kit.body, -L * 0.38, 0.45, 0);
  mkRotor(L * 0.05, 0.4 + 0.28 * Math.sqrt(S) + 0.05, 0, L * 0.5);
  return { top: 0.4 + 0.2 * Math.sqrt(S), update: (t) => { blades[0].rotation.y = t * 70; } };
}

// ---- assembly ---------------------------------------------------------------------------------
export function buildUnit(design: Design, team: 0 | 1): Unit3D {
  const ch = CHASSIS_BY_ID.get(design.chassis)!;
  const mob = MOBILITY_BY_ID.get(design.mobility)!;
  const kit = makeKit(team);
  const S = ch.size;
  const W = ch.footprint?.[0] ?? S, L = ch.footprint?.[1] ?? S;
  const rnd = rng([...design.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7));
  const root = new THREE.Group();
  const body = new THREE.Group(); // hull + turrets (bobs); running gear lives in root
  root.add(body);
  const flying = (ch.domain ?? 'ground') !== 'ground' || mob.kind === 'air';
  const turrets: Turret[] = [];
  const updates: ((t: number, dt: number, mv: number) => void)[] = [];
  const offs = mountOffsets(design);
  let placed: Placed[] = [];
  let hullTop = 0;
  let baseY = 0;

  if (flying) {
    if (ch.domain === 'jet' || mob.id === 'jet') {
      const j = buildJet(body, L, W, kit);
      placed = j.placed; hullTop = j.top;
    } else {
      const r = buildRotor(body, ch.id, L, W, S, kit);
      hullTop = r.top;
      updates.push((t) => r.update(t));
    }
  } else {
    const gear = buildGear(root, mob.id, L, W, S, kit, rnd);
    baseY = gear.y0;
    if (gear.update) updates.push((t, _dt, mv) => gear.update!(t, mv));
    const hull = buildHull(body, ch.shape, L, W, baseY, kit, mob.id === 'megatracks' ? 0.9 : 1);
    placed = hull.placed; hullTop = hull.top;
    // rear engine deck: exhausts + radiator grille
    const ex = [-1, 1].map((s) => add(body, new THREE.CylinderGeometry(0.035 * S ** 0.7, 0.04 * S ** 0.7, 0.2 * Math.min(S, 3), 8), kit.metal, -L * 0.42, baseY + hull.top * 0.5 + 0.1, s * W * 0.2));
    void ex;
    // front lamps + team running lights (team colour = small details only)
    for (const s of [-1, 1]) {
      box(body, kit.lamp, 0.03, 0.03, 0.06 + 0.01 * S, L * 0.49, baseY + 0.12 * Math.sqrt(S), s * W * 0.2);
      box(body, kit.glow, 0.025, 0.03, 0.05, -L * 0.5, baseY + 0.14 * Math.sqrt(S), s * W * 0.3);
    }
    // team stripe across the rear deck
    const top1 = placed[0].top;
    box(body, kit.accent, L * 0.05, 0.012, W * 0.5, -L * 0.34, top1, 0);
  }

  const mountPts: Pt[] = offs.map((o) => [o.x, o.y]);
  const mountR: number[] = [];
  design.mounts.forEach((mid, i) => {
    const mod = mid ? MODULE_BY_ID.get(mid) : null;
    const o = offs[i];
    if (!mod || !o) { mountR.push(0.1); return; }
    const tu = buildTurret(mod, S, kit, flying && ch.domain === 'jet');
    mountR.push(tu.r);
    let y = flying ? (ch.domain === 'jet' ? 0.06 : hullTop - 0.1) : deckAt(placed, o.x, o.y, baseY + hullTop);
    if (!flying) {
      // the turret rests on the highest deck under its ring; a pedestal bridges any lower tier beneath it
      // barbette: where the ring overhangs a lower tier, a hull-coloured armoured base bridges the step
      let lo = y;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, d = deckAt(placed, o.x + Math.cos(a) * tu.r * 0.85, o.y + Math.sin(a) * tu.r * 0.85, -1);
        if (d >= 0) lo = Math.min(lo, d);
      }
      if (new URLSearchParams(location.search).has("dbg")) console.log("mount", design.id, i, o.x.toFixed(2), o.y.toFixed(2), "y", y.toFixed(2), "lo", lo.toFixed(2), "base", baseY.toFixed(2));
      if (y - lo > 0.04) {
        const ring = Array.from({ length: 10 }, (_, i) => [Math.cos((i / 10) * Math.PI * 2), Math.sin((i / 10) * Math.PI * 2)] as Pt);
        frustum(ring.map(([px, pz]) => [o.x + px * tu.r * 1.32, o.y + pz * tu.r * 1.32] as Pt), ring.map(([px, pz]) => [o.x + px * tu.r * 1.02, o.y + pz * tu.r * 1.02] as Pt), lo, y - lo, kit.body, body);
      }
    }
    tu.yaw.position.set(o.x, y, o.y);
    // pylon under aircraft weapons
    if (flying) body.add(tu.yaw);
    else {
      body.add(tu.yaw);
    }
    turrets.push(tu);
  });
  if (!flying) greeble(body, placed, L, W, S, kit, rnd, mountPts, mountR, false);

  // command tower on giant/titan hulls: sensor drum, dome and mast cluster on the topmost tier
  if (!flying && S >= 4 && placed.length) {
    const tp = placed[placed.length - 1], cx = tp.poly.reduce((a, p) => a + p[0], 0) / tp.poly.length, cz = 0;
    const u = 0.1 * S;
    add(body, new THREE.CylinderGeometry(u * 1.7, u * 2.0, u * 1.2, 10), kit.camo, cx, tp.top + u * 0.6, cz);
    add(body, new THREE.SphereGeometry(u * 1.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), kit.light, cx, tp.top + u * 1.2, cz);
    box(body, kit.glass, u * 0.5, u * 0.3, u * 2.2, cx + u * 1.8, tp.top + u * 0.5, cz); // visor slit
    for (const s2 of [-1, 1]) add(body, new THREE.CylinderGeometry(0.01, 0.02, u * 4, 6), kit.steel, cx - u * 0.8, tp.top + u * 2, s2 * u * 1.1);
    add(body, new THREE.SphereGeometry(u * 0.22, 8, 6), kit.glow, cx - u * 0.8, tp.top + u * 4.05, u * 1.1);
  }
  // mast + team pennant on big hulls
  if (!flying && S >= 3) {
    const mx = -L * 0.3, mz = W * 0.3, top = deckAt(placed, mx, mz, hullTop + baseY);
    add(body, new THREE.CylinderGeometry(0.012, 0.02, 0.5 + 0.1 * S, 6), kit.steel, mx, top + 0.25 + 0.05 * S, mz);
    box(body, kit.accent, 0.012, 0.1, 0.2, mx, top + 0.5 + 0.1 * S - 0.1, mz + 0.1);
  }

  const unit: Unit3D = {
    root, design, team, turrets, L, W, S, flying, radius: Math.max(L, W) / 2,
    animate(t, dt, moving) {
      for (const u of updates) u(t, dt, moving);
      // idle engine vibration
      if (!flying) body.position.y = Math.sin(t * 38 + L) * 0.0035 * (0.6 + moving) * Math.min(S, 3);
    },
  };
  return unit;
}
