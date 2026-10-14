// Aircraft: jet fuselage lofts with tapered swept wings, intakes and nozzles; quad-rotor drones; helicopters with twisted blades.

import * as THREE from 'three';
import { Bld, ellRing, type V3 } from './geo.ts';
import { atlasUV, type Kit } from './materials.ts';

export interface Air { top: number; update: (t: number) => void; hpX?: (x: number, z: number) => number; /** weapon origin height for a hardpoint at (x,z) */ hpY: (x: number, z: number) => number }

/** aerofoil section ring at a span station: le = leading edge, chord runs along chordDir, thickness along thickDir */
function foil(le: V3, chordDir: V3, thickDir: V3, c: number, t: number): V3[] {
  const p = (a: number, b: number): V3 => [le[0] + chordDir[0] * a * c + thickDir[0] * b * t, le[1] + chordDir[1] * a * c + thickDir[1] * b * t, le[2] + chordDir[2] * a * c + thickDir[2] * b * t];
  return [p(0, 0), p(0.12, 0.62), p(0.45, 1), p(0.85, 0.5), p(1, 0), p(0.85, -0.4), p(0.45, -0.75), p(0.12, -0.5)];
}

export function buildJet(b: Bld, kit: Kit, L: number, W: number, S: number): Air {
  const hl = L / 2;
  const R = L * 0.062;
  // fuselage: x stations nose -> tail
  const st: [number, number, number, number][] = [ // [x, ry, rz, cy]
    [hl, 0.04, 0.04, -0.01], [hl * 0.86, 0.34, 0.3, -0.01], [hl * 0.62, 0.72, 0.68, 0.02], [hl * 0.3, 0.98, 0.95, 0.04],
    [-hl * 0.1, 1, 1, 0.04], [-hl * 0.55, 0.92, 0.98, 0.02], [-hl * 0.92, 0.7, 0.9, 0], [-hl, 0.66, 0.84, 0],
  ];
  b.loft(kit.hull, st.map(([x, ry, rz, cy]) => ellRing(x, cy * L, 0, ry * R, rz * R * 1.05, 12, 2.6, 0.3)));
  // spine / dorsal fairing darker
  b.loft(kit.trim, [[-hl * 0.15, 0.7], [-hl * 0.45, 0.8], [-hl * 0.8, 0.6]].map(([x, k]) => ellRing(x, R * 0.9, 0, R * 0.32 * k, R * 0.5 * k, 8, 2.4)));
  // canopy: faceted glass bubble + frame
  b.loft(kit.glass, [[0.62, 0.15], [0.5, 0.42], [0.32, 0.5], [0.1, 0.4], [-0.02, 0.1]].map(([f, k]) => ellRing(hl * f, R * 0.85 + R * 0.08 * k, 0, R * 0.5 * k, R * 0.5 * k * 1.05, 10, 2.2)));
  b.box(kit.trim, 0.025, R * 0.08, R * 0.7, hl * 0.4, R * 1.28, 0, 0.004);
  // pitot probe
  b.strut(kit.steel, [hl * 0.97, -0.01 * L, 0], [hl + L * 0.07, -0.01 * L, 0], 0.006, 0.003, 5);
  // wings: swept, tapered, thin; stations root -> tip
  const wy = -R * 0.12;
  for (const sg of [-1, 1]) {
    const rings: V3[][] = [];
    const span = W * 0.5;
    for (const [f, lex, ch, th] of [[0.08, -hl * 0.02, L * 0.5, R * 0.34], [0.5, -hl * 0.4, L * 0.3, R * 0.2], [1, -hl * 0.78, L * 0.13, R * 0.1]] as [number, number, number, number][]) {
      rings.push(foil([lex, wy + (1 - f) * 0.0 + f * R * 0.1, sg * span * f], [-1, 0, 0], [0, 1, 0], ch, th));
    }
    b.loft(kit.hull, rings);
    // wingtip rail + nav light
    b.box(kit.trim, L * 0.14, R * 0.12, 0.02, -hl * 0.78 - L * 0.06, wy + R * 0.1, sg * span, 0.004);
    b.cyl(sg < 0 ? kit.accent : kit.glow, 0.012, 0.012, 0.02, [-hl * 0.78 - L * 0.06, wy + R * 0.1, sg * (span + 0.012)], 'z', 6);
    // roundel
    b.decal(R * 1.1, R * 1.1, -hl * 0.38, wy + R * 0.3 + 0.004, sg * span * 0.58, atlasUV(3), 0);
    // air intake: box with dark inner and splitter
    b.box(kit.hull, L * 0.22, R * 0.6, R * 0.5, hl * 0.18, -R * 0.1, sg * R * 1.0, 0.012);
    b.box(kit.metal, 0.02, R * 0.46, R * 0.38, hl * 0.18 + L * 0.11 - 0.006, -R * 0.1, sg * R * 1.0, 0.004);
    // tail: canted vertical fin + tailplane
    const fin: V3[][] = [];
    for (const [f, lex, ch] of [[0, -hl * 0.7, L * 0.28], [1, -hl * 0.92, L * 0.12]] as [number, number, number][]) {
      const base: V3 = [lex, R * 0.5 + f * R * 3.6, sg * (R * 0.9 + f * R * 0.9)];
      fin.push(foil(base, [-1, 0, 0], [0, 0, 1], ch, R * 0.14 * (1 - f * 0.4)));
    }
    b.loft(kit.hull, fin);
    const tp: V3[][] = [];
    for (const [f, lex, ch] of [[0, -hl * 0.82, L * 0.22], [1, -hl * 1.0, L * 0.1]] as [number, number, number][])
      tp.push(foil([lex, R * 0.1, sg * (R * 0.7 + f * R * 3)], [-1, 0, 0], [0, 1, 0], ch, R * 0.1));
    b.loft(kit.hull, tp);
    // nozzle
    const nz = -hl - 0.0, nzz = sg * R * 0.6;
    b.lathe(kit.metal, [[R * 0.52, 0], [R * 0.52, L * 0.04], [R * 0.4, L * 0.08], [R * 0.4, L * 0.12], [R * 0.34, L * 0.12], [R * 0.36, L * 0.04]], [nz + L * 0.03, 0.0, nzz], '-x', 14);
    b.cyl(kit.hot, R * 0.3, R * 0.3, 0.006, [nz - L * 0.085, 0, nzz], 'x', 10);
    b.cylb(kit.steel, R * 0.55, L * 0.04, 0.004, [nz + L * 0.06, 0, nzz], '-x', 12);
  }
  b.decal(R * 2, R * 0.9, -hl * 0.1, R * 1.06, 0, atlasUV(2), Math.PI / 2 * 0);
  b.decal(R * 0.7, R * 0.7, -hl * 0.52, R * 0.92 + 0.004, 0, atlasUV(4 + (Math.floor(L * 7) % 10)), 0);
  void S;
  const lerpK = (f: number, k: [number, number][]) => { for (let i = 0; i < k.length - 1; i++) if (f <= k[i + 1][0]) { const t = (f - k[i][0]) / (k[i + 1][0] - k[i][0]); return k[i][1] + (k[i + 1][1] - k[i][1]) * t; } return k[k.length - 1][1]; };
  const hpX = (x: number, z: number) => {
    if (Math.abs(z) < 0.15) return x;
    const f = Math.min(1, Math.abs(z) / (W * 0.5));
    return lerpK(f, [[0.08, -hl * 0.02], [0.5, -hl * 0.4], [1, -hl * 0.78]]) - lerpK(f, [[0.08, L * 0.5], [0.5, L * 0.3], [1, L * 0.13]]) * 0.4;
  };
  return { top: R, update: () => {}, hpY: (_x, z) => (Math.abs(z) < 0.15 ? -R * 0.55 : wy - R * 0.2), hpX };
}

// ---- rotorcraft -------------------------------------------------------------------------------------
function blade(b: Bld, kit: Kit, R: number, chord: number, twist = 0.35) {
  const rings: V3[][] = [];
  for (const f of [0.08, 0.3, 0.6, 1]) {
    const th = twist * (1 - f);
    const cd: V3 = [Math.cos(th), 0, Math.sin(th) * 0.0];
    void cd;
    rings.push(foil([-chord * 0.25 * (1 - f * 0.3), Math.sin(th) * chord * 0.2, f * R], [1, 0, 0], [0, 1, 0], chord * (1 - f * 0.45), chord * 0.1 * (1 - 0.4 * f)).map((p) => [p[0], p[1], p[2]] as V3));
  }
  b.loft(kit.trim, rings);
}

export function buildRotor(b: Bld, kit: Kit, parent: THREE.Group, chassisId: string, L: number, W: number, S: number): Air {
  const rotors: { g: THREE.Group; dir: number; spd: number }[] = [];
  const mkRotor = (x: number, y: number, z: number, R: number, nBlades: number, dir = 1, spd = 70, tail = false) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const rb = new Bld();
    for (let i = 0; i < nBlades; i++) {
      const sub = new Bld();
      blade(sub, kit, R, R * (tail ? 0.2 : 0.11), tail ? 0.2 : 0.3);
      const bg = new THREE.Group(); bg.rotation.y = (i / nBlades) * Math.PI * 2;
      sub.mount(bg);
      g.add(bg);
    }
    rb.cylb(kit.metal, R * 0.07, R * 0.06, R * 0.012, [0, -R * 0.02, 0], 'y', 10);
    rb.cylb(kit.steel, R * 0.035, R * 0.05, 0.003, [0, R * 0.03, 0], 'y', 8);
    rb.mount(g);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#c9ced1', transparent: true, opacity: 0.07, depthWrite: false }));
    disc.position.y = R * 0.01;
    g.add(disc);
    parent.add(g);
    rotors.push({ g, dir, spd });
  };
  if (chassisId === 'drone') {
    // quad-rotor: faceted body pod, four arms with motor housings, gimbal camera, skids
    const R = L * 0.2;
    b.loft(kit.hull, [[-1, 0.5], [-0.5, 0.9], [0.4, 1], [1, 0.6]].map(([x, k]) => ellRing(x * L * 0.17, 0.22, 0, 0.07 * k, 0.1 * k, 10, 2.5, 0.3)));
    b.loft(kit.glass, [[0.4, 0.5], [0.8, 0.9], [1.2, 0.5]].map(([x, k]) => ellRing(x * L * 0.13, 0.25, 0, 0.04 * k, 0.05 * k, 8, 2.2)));
    b.box(kit.trim, L * 0.34, 0.025, L * 0.12, 0, 0.3, 0, 0.006);
    b.lathe(kit.metal, [[0, 0], [0.04, 0.01], [0.05, 0.04], [0.03, 0.07], [0, 0.07]], [L * 0.12, 0.15, 0], 'y', 10, [0, 0, Math.PI]);
    b.cyl(kit.glass, 0.02, 0.02, 0.02, [L * 0.15, 0.135, 0], 'x', 8);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const ex = sx * L * 0.4, ez = sz * L * 0.4;
      b.strut(kit.trim, [sx * L * 0.06, 0.24, sz * L * 0.06], [ex, 0.26, ez], 0.022, 0.016, 6);
      b.cylb(kit.hull, 0.055, 0.075, 0.012, [ex, 0.22, ez], 'y', 10);
      b.cyl(sx > 0 && sz > 0 ? kit.accent : kit.glow, 0.012, 0.012, 0.012, [ex + sx * 0.045, 0.27, ez], 'x', 6);
      mkRotor(ex, 0.31, ez, R, 2, sx * sz, 90);
      b.strut(kit.steel, [sx * L * 0.1, 0.2, sz * L * 0.08], [sx * L * 0.14, 0.04, sz * L * 0.11], 0.01, 0.01, 4);
    }
    for (const sz of [-1, 1]) b.strut(kit.metal, [-L * 0.2, 0.035, sz * L * 0.1], [L * 0.2, 0.035, sz * L * 0.1], 0.012, 0.012, 5);
    b.decal(0.12, 0.12, -L * 0.04, 0.3 + 0.013, 0, atlasUV(3), 0);
    return { top: 0.3, update: (t) => rotors.forEach((r, i) => (r.g.rotation.y = t * r.spd * r.dir + i)), hpY: () => 0.08 };
  }
  // helicopter: teardrop fuselage, glazed nose, tail boom + fin, rotor mast, skids
  const heavy = S >= 3, k = Math.sqrt(S);
  const fh = 0.2 * k, fw = W * 0.2;
  const stn: [number, number, number][] = [[0.5, 0.35, 0.4], [0.36, 0.78, 0.8], [0.1, 1, 1], [-0.25, 0.95, 0.9], [-0.5, 0.6, 0.62]];
  b.loft(kit.hull, stn.map(([x, ry, rz]) => ellRing(x * L * 0.6, 0.4, 0, fh * ry, fw * rz, 12, 2.4, 0.2)));
  b.loft(kit.glass, [[0.5, 0.35, 0.4], [0.42, 0.7, 0.7], [0.3, 0.9, 0.88], [0.2, 0.7, 0.7]].map(([x, ry, rz]) => ellRing(x * L * 0.6 + 0.01, 0.42 + fh * 0.12, 0, fh * ry * 0.7, fw * rz * 0.96, 10, 2.2)));
  b.loft(kit.hull, [[-0.4, 0.5], [-0.9, 0.3], [-1.4, 0.18]].map(([x, s]) => ellRing(x * L * 0.5, 0.45 + (heavy ? 0.04 : 0.02), 0, fh * s * 0.7, fw * s * 0.7, 8, 2.4)));
  const tx = -L * 0.66;
  const fin: V3[][] = [];
  for (const [f, lex, ch] of [[0, tx, L * 0.16], [1, tx - L * 0.08, L * 0.07]] as [number, number, number][]) fin.push(foil([lex, 0.46 + f * fh * 1.6, 0], [-1, 0, 0], [0, 0, 1], ch, 0.02));
  b.loft(kit.hull, fin);
  b.loft(kit.hull, [0, 1].map((f) => foil([tx - L * 0.04, 0.5, (f ? 1 : -1) * fw * 0.9], [-1, 0, 0], [0, 1, 0], L * 0.11, 0.02)));
  mkRotor(tx - L * 0.02, 0.5 + fh * 0.5, fw * 0.12, fh * 0.9, 4, 1, 120, true);
  rotors[rotors.length - 1].g.rotation.x = Math.PI / 2;
  // engine cowl + exhausts, mast
  b.loft(kit.trim, [[-0.2, 0.5], [0.05, 0.8], [0.22, 0.6]].map(([x, s]) => ellRing(x * L * 0.6, 0.4 + fh * 0.95, 0, fh * 0.3 * s, fw * 0.6 * s, 8, 2.4)));
  b.cylb(kit.metal, 0.03 * k, 0.07 * k, 0.008, [L * 0.0, 0.4 + fh * 1.05, 0], 'y', 8);
  for (const sg of [-1, 1]) b.cyl(kit.metal, 0.025 * k, 0.03 * k, 0.1 * k, [-L * 0.2, 0.4 + fh * 1.0, sg * fw * 0.35], '-x', 8);
  // stub wings with pylons
  for (const sg of [-1, 1]) {
    b.loft(kit.hull, [0, 1].map((f) => foil([L * 0.02 - f * 0.05, 0.35 + f * 0.02, sg * (fw * 0.85 + f * W * 0.3)], [-1, 0, 0], [0, 1, 0], L * 0.2 * (1 - f * 0.3), 0.03)));
    b.box(kit.trim, 0.05, 0.1, 0.03, 0, 0.3, sg * (fw + W * 0.2), 0.005);
  }
  // skids
  for (const sg of [-1, 1]) {
    b.strut(kit.metal, [-L * 0.22, 0.08, sg * fw * 0.8], [L * 0.28, 0.08, sg * fw * 0.8], 0.014 * k, 0.014 * k, 6);
    for (const x of [-0.12, 0.14]) b.strut(kit.metal, [L * x, 0.08, sg * fw * 0.8], [L * x, 0.3, sg * fw * 0.55], 0.014 * k, 0.014 * k, 5);
  }
  mkRotor(L * 0.0, 0.4 + fh * 1.1 + 0.02, 0, L * 0.55, 4, 1, 55);
  b.decal(0.3 * k, 0.3 * k, L * 0.02, 0.4 + fh + 0.004, 0, atlasUV(2), 0);
  return { top: 0.4 + fh, update: (t) => rotors.forEach((r) => { if (r.g.rotation.x === 0) r.g.rotation.y = t * r.spd; else r.g.rotation.y = t * r.spd; }), hpY: () => 0.3 };
}
