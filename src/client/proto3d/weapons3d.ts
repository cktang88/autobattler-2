// Procedural 3D weapon turrets from ModuleDef (visual family, mount class, calibre, barrel count).
// Turret frame: +X = muzzle direction, +Y = up, origin on the deck at the turret ring centre.
// Static parts are merged into one mesh per material per rig group (yaw / pitch / recoil / spin).

import * as THREE from 'three';
import { approxTurretD } from '../../shared/mountgeo.ts';
import type { ModuleDef } from '../../shared/types.ts';
import { atlasUV, type Kit, type MatLike } from './materials.ts';
import { Bld, loft, sec8, mtx, type P2, type V3 } from './geo.ts';

export interface Turret {
  /** yaw group: rotate .rotation.y for traverse */
  yaw: THREE.Group;
  /** pitch group (barrels hang off this) */
  pitch: THREE.Group;
  /** barrel assembly that kicks back on firing */
  recoil: THREE.Group;
  muzzles: THREE.Object3D[];
  /** spinning barrel cluster (gatling) */
  spin?: THREE.Object3D;
  /** weapon fires fixed forward (aircraft hardpoints) */
  fixed: boolean;
  /** visual projectile style */
  shot: 'tracer' | 'shell' | 'beam' | 'orb' | 'rocket' | 'flame' | 'none';
  /** cooldown seconds between visual shots */
  rate: number;
  /** turret radius (cells) */
  r: number;
  /** triangle count (for stats) */
  tris: number;
}

interface Ctx { b: Bld; p: Bld; rc: Bld; sp: Bld; kit: Kit; r: number; c: number; nb: number; D: number; bv: number; t: Turret; muzzle: (x: number, y: number, z: number) => void }

type BrakeKind = 'slot' | 'flash' | 'none';
/** gun barrel along +X from x=0: breech, tapered core, thermal sleeve with bands, bore evacuator, muzzle device */
function barrel(C: Ctx, B: Bld, len: number, br: number, y: number, z: number, o: { sleeve?: boolean; extractor?: boolean; brake?: BrakeKind; breech?: number } = {}) {
  const { kit } = C;
  const at: V3 = [0, y, z];
  const bl = o.breech ?? 1.35;
  const brakeLen = o.brake && o.brake !== 'none' ? Math.max(br * 4, len * 0.07) : 0;
  const coreEnd = len - brakeLen * 0.4;
  B.lathe(kit.metal, [[0, 0], [br * bl, 0], [br * bl, len * 0.08], [br * 1.1, len * 0.13], [br, len * 0.17], [br, coreEnd], [0, coreEnd]], at, 'x', 12);
  if (o.sleeve) {
    const a = len * 0.2, e = len * 0.62, sr = br * 1.38, s = br * 0.14;
    B.lathe(kit.trim, [[0, a], [sr - s, a], [sr, a + s], [sr, e - s], [sr - s, e], [0, e]], at, 'x', 14);
    for (const f of [0.3, 0.5, 0.7]) B.lathe(kit.steel, [[0, a + (e - a) * f - br * 0.12], [sr * 1.06, a + (e - a) * f - br * 0.12], [sr * 1.06, a + (e - a) * f + br * 0.12], [0, a + (e - a) * f + br * 0.12]], at, 'x', 14);
  }
  if (o.extractor) {
    const a = len * 0.7, e = len * 0.8, er = br * 1.55;
    B.lathe(kit.metal, [[0, a], [br * 1.1, a], [er, a + (e - a) * 0.3], [er, e - (e - a) * 0.3], [br * 1.1, e], [0, e]], at, 'x', 12);
  }
  if (brakeLen > 0) {
    const m = len - brakeLen, bR = br * 1.65;
    if (o.brake === 'slot') {
      const L = brakeLen;
      B.lathe(kit.steel, [[0, m], [bR, m], [bR, m + L * 0.22], [br * 1.25, m + L * 0.22], [br * 1.25, m + L * 0.34], [bR, m + L * 0.34], [bR, m + L * 0.56], [br * 1.25, m + L * 0.56], [br * 1.25, m + L * 0.68], [bR, m + L * 0.68], [bR, m + L], [br * 0.8, m + L], [0, m + L * 0.9]], at, 'x', 12);
    } else {
      B.lathe(kit.metal, [[0, m], [br * 1.1, m], [bR * 1.1, m + brakeLen * 0.6], [bR, m + brakeLen], [br * 0.7, m + brakeLen], [0, m + brakeLen * 0.8]], at, 'x', 12);
    }
  }
  C.muzzle(len + br * 0.2, y, z);
}

/** Wedge-faced cast turret: sloped cheeks, bustle at the rear, front plate (the shape that reads as a tank turret). */
function turretShell(C: Ctx, o: { len?: number; wid?: number; hgt?: number; front?: number; mat?: MatLike; x?: number; y?: number } = {}) {
  const { r, b, kit } = C;
  const L = (o.len ?? 1.9) * r / 2, W = (o.wid ?? 1) * r, h = (o.hgt ?? 0.5) * r, fr = o.front ?? 0.4;
  const x = o.x ?? 0, y = o.y ?? r * 0.08;
  const st = (px: number, w: number, hh: number, lift: number) =>
    sec8(x + px * L, w * W * 0.8, w * W * 0.9, w * W * 0.6, y + lift * h, y + (lift + 0.15) * h, y + hh * h * 0.72, y + hh * h);
  const rings = [st(-1, 0.62, 0.92, 0), st(-0.9, 0.8, 1, 0), st(-0.2, 1.0, 1, 0), st(0.35, 0.92, 0.9, 0), st(0.9, fr + 0.15, 0.72, 0.08), st(1.0, fr, 0.64, 0.1)];
  b.loft(o.mat ?? kit.hull, rings);
  return { L, W, h, y };
}

function cupola(C: Ctx, x: number, y: number, z: number, s: number) {
  const { b, kit } = C;
  b.cylb(kit.trim, s, s * 0.7, s * 0.12, [x, y, z], 'y', 12);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; b.box(kit.glass, s * 0.22, s * 0.16, s * 0.22, x + Math.cos(a) * s * 0.95, y + s * 0.5, z + Math.sin(a) * s * 0.95, 0.004, [0, -a, 0]); }
  b.cylb(kit.metal, s * 0.72, s * 0.14, s * 0.04, [x, y + s * 0.7, z], 'y', 10);
}
function smokeLaunchers(C: Ctx, x: number, y: number, z: number, n: number, s: number) {
  for (let i = 0; i < n; i++) C.b.cyl(C.kit.metal, s, s, s * 3, [x + i * s * 2.3, y, z], 'y', 6);
}
function roofMarks(C: Ctx, x: number, y: number, z: number, w: number, tile = 1) {
  void C; void x; void y; void z; void w; void tile; void atlasUV;
}

export function buildTurret(mod: ModuleDef, S: number, kit: Kit, fixed = false): Turret {
  const D = approxTurretD(mod.mount, S) * (S > 2 ? 1 + 0.22 * (S - 2) : 1);
  const r = D / 2;
  const c = mod.caliber ?? 0.5;
  const nb = mod.barrels ?? 1;
  const yaw = new THREE.Group(), pitch = new THREE.Group(), recoil = new THREE.Group(), spinG = new THREE.Group();
  yaw.add(pitch); pitch.add(recoil);
  const t: Turret = { yaw, pitch, recoil, muzzles: [], fixed, shot: 'tracer', rate: 0.5, r, tris: 0 };
  const C: Ctx = {
    b: new Bld(), p: new Bld(), rc: new Bld(), sp: new Bld(), kit, r, c, nb, D, bv: Math.max(0.006, r * 0.04), t,
    muzzle: (x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); recoil.add(o); t.muzzles.push(o); },
  };
  const { b, p, rc, sp } = C;
  const v = mod.visual;
  const ringR = r * 0.95;
  const y0 = fixed ? 0 : r * 0.1;
  if (!fixed && v !== 'plate') {
    b.cylb(kit.trim, ringR, r * 0.1, r * 0.03, [0, 0, 0], 'y', 24);
    b.lathe(kit.metal, [[0, r * 0.0], [ringR * 1.02, r * 0.0], [ringR * 1.02, r * 0.02], [0, r * 0.02]], [0, r * 0.09, 0], 'y', 24);
  }
  const bv = C.bv;

  switch (v) {
    case 'gun': case 'shotgun': case 'flak': case 'pointdef': {
      const heavy = c > 0.45 || v === 'flak';
      const sh = turretShell(C, { len: heavy ? 1.7 : 1.45, wid: heavy ? 0.95 : 0.8, hgt: heavy ? 0.52 : 0.42, front: 0.55 });
      const py = y0 + sh.h * 0.5;
      pitch.position.set(r * 0.62, py, 0);
      const bl = D * (0.55 + 0.7 * c), br = D * (0.03 + 0.045 * c);
      const sp2 = nb > 1 ? br * 3.4 : 0;
      p.box(kit.trim, r * 0.3, sh.h * 0.62, nb > 1 ? sp2 * nb + br * 3 : br * 5, 0.02, 0, 0, bv); // mantlet / gun shroud
      for (let i = 0; i < nb; i++) {
        const z = nb > 1 ? (i - (nb - 1) / 2) * sp2 : 0;
        barrel(C, rc, bl, br, 0, z, { sleeve: bl > D * 0.9, brake: c > 0.3 ? 'flash' : 'none', breech: 1.7 });
      }
      // ammo box and feed
      b.box(kit.panel, r * 0.5, sh.h * 0.5, r * 0.28, -r * 0.2, y0 + sh.h * 0.85, r * 0.55, bv);
      b.box(kit.trim, r * 0.25, sh.h * 0.18, r * 0.18, r * 0.2, y0 + sh.h * 0.75, r * 0.42, bv * 0.6);
      cupola(C, -r * 0.5, y0 + sh.h * 0.95, -r * 0.22, r * 0.14);
      smokeLaunchers(C, r * 0.15, y0 + sh.h * 0.8, -r * 0.5, 3, r * 0.025);
      roofMarks(C, -r * 0.05, y0 + sh.h * 1.002, 0, r * 0.45, 1);
      t.rate = 0.18 + (1 - c) * 0.1;
      if (v === 'flak') { for (const z of [-r * 0.5, r * 0.5]) b.cyl(kit.metal, r * 0.05, r * 0.05, r * 0.5, [-r * 0.3, y0 + sh.h, z], 'y', 6); }
      break;
    }
    case 'gatling': {
      const sh = turretShell(C, { len: 1.5, wid: 1.0, hgt: 0.55, front: 0.6 });
      const py = y0 + sh.h * 0.5;
      pitch.position.set(r * 0.62, py, 0);
      const bl = D * 0.9, cr = r * 0.2, n = Math.max(4, nb);
      p.box(kit.trim, r * 0.35, sh.h * 0.8, r * 0.75, 0, 0, 0, bv);
      p.cylb(kit.metal, cr * 1.9, r * 0.45, cr * 0.2, [0, 0, 0], 'x', 16);
      rc.cylb(kit.trim, cr * 1.6, bl * 0.2, cr * 0.15, [r * 0.1, 0, 0], 'x', 16);
      recoil.add(spinG);
      t.spin = spinG;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; sp.cyl(kit.metal, r * 0.04, r * 0.04, bl, [0, Math.sin(a) * cr, Math.cos(a) * cr], 'x', 8); }
      for (const f of [0.28, 0.65, 1]) sp.cylb(kit.steel, cr + r * 0.07, r * 0.07, r * 0.015, [bl * f - r * 0.07, 0, 0], 'x', 16);
      sp.cyl(kit.trim, cr * 0.5, cr * 0.5, bl, [0, 0, 0], 'x', 8);
      C.muzzle(bl, 0, 0);
      // drum magazine on the side and feed chute
      b.cylb(kit.panel, r * 0.32, r * 0.5, r * 0.05, [-r * 0.15, y0 + sh.h * 0.55, r * 0.72], 'y', 14);
      b.box(kit.trim, r * 0.12, r * 0.12, r * 0.5, r * 0.1, y0 + sh.h * 0.55, r * 0.5, bv * 0.5);
      cupola(C, -r * 0.55, y0 + sh.h * 0.98, -r * 0.3, r * 0.13);
      t.rate = 0.07;
      break;
    }
    case 'cannon': case 'gauss': case 'sniper': {
      const big = mod.mount === 'XL' || mod.mount === 'L';
      const sh = turretShell(C, { len: 1.9, wid: 1.05, hgt: big ? 0.5 : 0.56, front: 0.42 });
      const py = y0 + sh.h * 0.5;
      pitch.position.set(r * 0.9, py, 0);
      const bl = D * (0.95 + 0.7 * c), br = D * (0.045 + 0.04 * c);
      // mantlet: shaped block around the barrel root
      p.box(kit.trim, r * 0.28, sh.h * 0.78, r * 0.62, 0.03 * r, 0, 0, bv * 1.2);
      p.box(kit.hull, r * 0.12, sh.h * 0.5, r * 0.42, 0.14 * r, sh.h * 0.05, 0, bv);
      barrel(C, rc, bl, br, 0, 0, { sleeve: true, extractor: v !== 'sniper', brake: v === 'gauss' ? 'none' : 'slot' });
      // coax + sight box
      rc.cyl(kit.metal, br * 0.3, br * 0.3, r * 0.55, [r * 0.0, -br * 0.1, br * 2.6], 'x', 6);
      p.box(kit.metal, r * 0.12, r * 0.1, r * 0.12, 0, sh.h * 0.45, -br * 3.2, 0.006);
      cupola(C, -r * 0.55, y0 + sh.h * 0.97, -r * 0.34, r * 0.2);
      // loader hatch + mg ring
      b.cylb(kit.trim, r * 0.18, r * 0.05, r * 0.012, [-r * 0.5, y0 + sh.h, r * 0.3], 'y', 12);
      smokeLaunchers(C, r * 0.18, y0 + sh.h * 0.72, r * 0.62 + r * 0.14, 4, r * 0.03);
      b.g(new THREE.BoxGeometry(1, 1, 1), kit.canvas, mtx([-sh.L - r * 0.12, y0 + sh.h * 0.4, 0], [0, 0, 0], [r * 0.5, sh.h * 0.55, r * 1.0]));
      for (const z of [-0.4, -0.15, 0.15, 0.4]) b.strut(kit.metal, [-sh.L - r * 0.4, y0 + sh.h * 0.15, z * r], [-sh.L - r * 0.4, y0 + sh.h * 0.65, z * r], r * 0.012, r * 0.012, 4);
      for (const z of [-0.2, 0.2]) b.cylb(kit.hot, r * 0.012, r * 0.01, 0, [r * 0.8, y0 + sh.h * 0.55, z * r + r * 0.4], 'x', 5);
      roofMarks(C, -r * 0.2, y0 + sh.h * 1.002, 0, r * 0.5, 14);
      t.shot = 'shell';
      t.rate = 1.2;
      break;
    }
    case 'artillery': case 'mortar': {
      const art = v === 'artillery';
      const bl = D * (art ? 1.55 : 0.62), br = D * (art ? 0.055 : 0.1);
      const hgt = r * (art ? 0.5 : 0.38);
      b.slab(kit.hull, [[-r * 0.85, -r * 0.7], [r * 0.2, -r * 0.8], [r * 0.5, -r * 0.5], [r * 0.5, r * 0.5], [r * 0.2, r * 0.8], [-r * 0.85, r * 0.7]], hgt, bv * 1.2, 0, y0, 0);
      pitch.position.set(-r * 0.05, y0 + hgt * (art ? 0.85 : 0.9), 0);
      pitch.rotation.z = art ? 0.42 : 1.05;
      // trunnion cheeks
      for (const z of [-r * 0.4, r * 0.4]) b.box(kit.trim, r * 0.5, r * (art ? 0.55 : 0.4), r * 0.12, -r * 0.05, y0 + hgt + r * 0.1, z, bv);
      barrel(C, rc, bl, br, 0, 0, { sleeve: art, extractor: false, brake: art ? 'slot' : 'none', breech: 1.8 });
      if (art) {
        for (const z of [-br * 2.6, br * 2.6]) p.cyl(kit.steel, br * 0.5, br * 0.5, bl * 0.4, [bl * 0.05, br * 0.4, z], 'x', 8); // recoil cylinders
        p.box(kit.hull, r * 0.12, r * 0.55, r * 0.9, r * 0.25, 0, 0, bv); // shield
        b.box(kit.panel, r * 0.5, r * 0.18, r * 0.42, -r * 0.55, y0 + hgt + r * 0.09, r * 0.4, bv);
      } else {
        b.cylb(kit.metal, r * 0.55, r * 0.05, bv * 0.5, [-r * 0.05, y0 + hgt, 0], 'y', 16);
      }
      cupola(C, -r * 0.6, y0 + hgt, -r * 0.4, r * 0.14);
      t.shot = 'shell';
      t.rate = art ? 2.4 : 1.4;
      break;
    }
    case 'rail': {
      const sh = turretShell(C, { len: 1.55, wid: 0.95, hgt: 0.5, front: 0.5, mat: kit.hull });
      const py = y0 + sh.h * 0.55;
      pitch.position.set(r * 0.6, py, 0);
      const bl = D * 1.35;
      for (const z of [-r * 0.17, r * 0.17]) rc.box(kit.steel, bl, r * 0.2, r * 0.12, bl / 2, 0, z, bv * 0.8);
      rc.box(kit.rail, bl * 0.92, r * 0.025, r * 0.2, bl * 0.5, 0, 0, 0.002);
      for (let i = 1; i < 6; i++) rc.cylb(kit.trim, r * 0.24, r * 0.09, r * 0.02, [(bl * i) / 6.4, 0, 0], 'x', 12);
      for (const z of [-r * 0.35, r * 0.35]) { b.cylb(kit.panel, r * 0.2, r * 0.5, r * 0.04, [-r * 0.5, y0 + sh.h, z], 'y', 12); b.cylb(kit.metal, r * 0.14, r * 0.04, 0.003, [-r * 0.5, y0 + sh.h + r * 0.5, z], 'y', 10); }
      p.box(kit.trim, r * 0.3, sh.h * 0.7, r * 0.7, 0, 0, 0, bv);
      C.muzzle(bl, 0, 0);
      cupola(C, -r * 0.2, y0 + sh.h * 0.98, r * 0.3, r * 0.1);
      t.shot = 'beam';
      t.rate = 2.0;
      break;
    }
    case 'rocketPod': case 'missileRack': case 'cruise': {
      const tubes = Math.max(1, nb);
      const big = v === 'cruise';
      const cols = big ? 1 : tubes >= 4 ? 2 : tubes >= 2 ? 2 : 1, rows = Math.max(1, Math.ceil(tubes / cols));
      const tubeR = Math.min(r * (big ? 0.3 : 0.17), (r * 0.9) / (cols * 2.3));
      const pw = cols * tubeR * 2.5 + r * 0.14, ph = rows * tubeR * 2.5 + r * 0.14, pl = r * (big ? 2.1 : 1.35);
      b.box(kit.trim, r * 0.9, r * 0.2, r * 0.85, -r * 0.1, y0 + r * 0.1, 0, bv);
      for (const z of [-pw / 2 - r * 0.04, pw / 2 + r * 0.04]) b.box(kit.hull, r * 0.12, ph * 0.9, r * 0.1, 0, y0 + r * 0.2 + ph * 0.5, z, bv);
      pitch.position.set(0, y0 + r * 0.2 + ph * 0.5, 0);
      pitch.rotation.z = v === 'missileRack' ? 0.2 : 0.14;
      // launcher box
      const ox = pl * 0.3;
      rc.box(kit.hull, pl, ph, pw, ox, 0, 0, bv * 1.4);
      rc.box(kit.trim, pl * 0.2, ph * 0.9, pw * 1.06, ox - pl * 0.34, 0, 0, bv);
      let k = 0;
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols && k < tubes; j++, k++) {
        const z = cols > 1 ? (j - (cols - 1) / 2) * tubeR * 2.5 : 0, y = rows > 1 ? (i - (rows - 1) / 2) * tubeR * 2.5 : 0;
        // recessed tube: rim ring + dark bore + warhead tip
        rc.lathe(kit.steel, [[tubeR * 1.12, 0], [tubeR * 1.12, 0.012], [tubeR * 0.9, 0.012], [tubeR * 0.9, 0]], [ox + pl / 2 - 0.008, y, z], 'x', 12);
        rc.lathe(kit.metal, [[0, 0], [tubeR * 0.9, 0], [tubeR * 0.9, -pl * 0.18], [0, -pl * 0.18]], [ox + pl / 2 - 0.004, y, z], 'x', 12);
        if (v !== 'rocketPod') rc.cyl(kit.steel, tubeR * 0.55, tubeR * 0.1, tubeR * 1.4, [ox + pl / 2 - tubeR * 1.5, y, z], 'x', 8);
        else rc.cyl(kit.hot, tubeR * 0.55, tubeR * 0.55, 0.004, [ox + pl / 2 - 0.02, y, z], 'x', 8);
        C.muzzle(ox + pl / 2 + 0.01, y, z);
      }
      for (let i = 0; i < 4; i++) rc.box(kit.metal, pl * 0.04, ph * 0.5, pw * 0.7, ox - pl * 0.5 - 0.004, 0, 0, 0.002, [0, 0, 0]);
      t.shot = 'rocket';
      t.rate = 0.9;
      break;
    }
    case 'laser': case 'heatray': case 'slowbeam': case 'sonic': case 'emp': case 'gravity': case 'tesla': {
      const tesla = v === 'tesla';
      const sh = turretShell(C, { len: 1.35, wid: 0.9, hgt: 0.46, front: 0.55, mat: kit.hull });
      const py = y0 + sh.h * 0.55;
      if (tesla) {
        for (let i = 0; i < 4; i++) b.cylb(i % 2 ? kit.steel : kit.trim, r * (0.3 - i * 0.04), r * 0.2, r * 0.02, [0, y0 + sh.h + i * r * 0.17, 0], 'y', 14);
        b.lathe(kit.metal, [[0, 0], [r * 0.16, 0], [r * 0.2, r * 0.1], [0, r * 0.18]], [0, y0 + sh.h + r * 0.7, 0], 'y', 14);
        b.cyl(kit.rail, r * 0.04, r * 0.04, r * 0.3, [0, y0 + sh.h + r * 0.85, 0], 'y', 8);
        pitch.position.set(r * 0.45, py, 0);
        for (const z of [-r * 0.12, r * 0.12]) rc.cyl(kit.steel, r * 0.04, r * 0.03, D * 0.7, [0, 0, z], 'x', 6);
        C.muzzle(D * 0.7, 0, 0);
      } else if (v === 'heatray' || v === 'emp' || v === 'sonic' || v === 'gravity') {
        pitch.position.set(r * 0.5, py, 0);
        rc.lathe(kit.metal, [[0, 0], [r * 0.12, 0], [r * 0.12, r * 0.4], [0, r * 0.4]], [0, 0, 0], 'x', 10);
        const dr = r * 0.5;
        rc.lathe(kit.hull, [[0, r * 0.4], [r * 0.14, r * 0.4], [dr * 0.8, r * 0.55], [dr, r * 0.7], [dr * 0.9, r * 0.72], [r * 0.12, r * 0.52], [0, r * 0.5]], [0, 0, 0], 'x', 18);
        rc.cyl(kit.plasma, r * 0.08, r * 0.08, r * 0.04, [r * 0.5, 0, 0], 'x', 10);
        C.muzzle(r * 0.78, 0, 0);
      } else {
        pitch.position.set(r * 0.5, py, 0);
        const bl = D * 0.8;
        p.box(kit.trim, r * 0.3, sh.h * 0.7, r * 0.6, 0, 0, 0, bv);
        for (let i = 0; i < Math.max(1, nb); i++) {
          const z = nb > 1 ? (i - (nb - 1) / 2) * r * 0.34 : 0;
          rc.cyl(kit.steel, r * 0.07, r * 0.07, bl, [0, 0, z], 'x', 10);
          rc.cylb(kit.hull, r * 0.12, bl * 0.35, r * 0.02, [0, 0, z], 'x', 12);
          for (const f of [0.55, 0.75, 0.92]) rc.cylb(kit.trim, r * 0.115, r * 0.045, r * 0.01, [bl * f, 0, z], 'x', 12);
          rc.cyl(kit.rail, r * 0.045, r * 0.045, r * 0.03, [bl + r * 0.01, 0, z], 'x', 8);
          C.muzzle(bl + r * 0.08, 0, z);
        }
      }
      cupola(C, -r * 0.45, y0 + sh.h * 0.97, -r * 0.3, r * 0.1);
      t.shot = 'beam';
      t.rate = 0.7;
      break;
    }
    case 'plasma': {
      const sh = turretShell(C, { len: 1.7, wid: 1.05, hgt: 0.55, front: 0.5, mat: kit.hull });
      const py = y0 + sh.h * 0.55;
      pitch.position.set(r * 0.55, py, 0);
      const bl = D * 1.0;
      p.box(kit.trim, r * 0.3, sh.h * 0.8, r * 0.7, 0.02, 0, 0, bv);
      for (let i = 0; i < Math.max(1, Math.min(2, nb)); i++) {
        const z = nb > 1 ? (i - 0.5) * r * 0.6 : 0;
        rc.lathe(kit.steel, [[0, 0], [r * 0.15, 0], [r * 0.13, bl * 0.9], [r * 0.2, bl * 0.9], [r * 0.2, bl], [0, bl]], [0, 0, z], 'x', 14);
        for (let k = 1; k <= 4; k++) rc.cylb(kit.trim, r * 0.19, r * 0.035, r * 0.008, [(bl * k) / 5.2, 0, z], 'x', 14); // cooling fins
        rc.cyl(kit.plasma, r * 0.1, r * 0.1, r * 0.03, [bl + r * 0.005, 0, z], 'x', 10);
        C.muzzle(bl + r * 0.12, 0, z);
      }
      for (const z of [-r * 0.5, r * 0.5]) b.cylb(kit.panel, r * 0.17, r * 0.7, r * 0.03, [-r * 0.5, y0 + sh.h * 0.5, z], 'x', 12);
      cupola(C, -r * 0.4, y0 + sh.h * 0.97, 0, r * 0.12);
      t.shot = 'orb';
      t.rate = 1.6;
      break;
    }
    case 'flamer': {
      b.box(kit.trim, r * 1.0, r * 0.3, r * 0.8, -r * 0.1, y0 + r * 0.15, 0, bv);
      pitch.position.set(r * 0.3, y0 + r * 0.4, 0);
      rc.cyl(kit.metal, r * 0.07, r * 0.07, D * 0.7, [0, 0, 0], 'x', 8);
      rc.lathe(kit.steel, [[0, 0], [r * 0.1, 0], [r * 0.16, r * 0.14], [r * 0.12, r * 0.18], [0, r * 0.18]], [D * 0.68, 0, 0], 'x', 10);
      rc.cyl(kit.hot, r * 0.03, r * 0.03, 0.01, [D * 0.86, 0, 0], 'x', 6);
      for (const z of [-r * 0.36, r * 0.36]) {
        b.cylb(kit.hull, r * 0.17, r * 0.9, r * 0.04, [-r * 0.85, y0 + r * 0.5, z], 'x', 12);
        for (const f of [0.25, 0.7]) b.cylb(kit.steel, r * 0.18, r * 0.05, 0.004, [-r * 0.85 + r * 0.9 * f, y0 + r * 0.5, z], 'x', 12);
      }
      C.muzzle(D * 0.82, 0, 0);
      t.shot = 'flame';
      t.rate = 0.12;
      break;
    }
    case 'plate': {
      // passive armour slab: sloped wedge plates with a grid of reactive tiles
      const w = r * 1.8;
      b.slab(kit.hull, [[-r * 0.1, -w / 2], [r * 0.55, -w / 2 + r * 0.1], [r * 0.55, w / 2 - r * 0.1], [-r * 0.1, w / 2]], r * 0.95, bv * 1.4, 0, 0, 0);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 6; j++) {
        b.box(kit.trim, r * 0.07, r * 0.2, r * 0.22, r * 0.58, r * 0.2 + i * r * 0.26, (j - 2.5) * r * 0.27, 0.006);
      }
      b.box(kit.trim, r * 0.1, r * 0.08, w, 0, r * 0.95, 0, bv);
      t.shot = 'none';
      t.rate = 99;
      break;
    }
    case 'saw': case 'chainsaw': case 'hammer': case 'claw': case 'drill': case 'blade': case 'prod': case 'ram': {
      // hydraulic arm with a tool head
      b.box(kit.trim, r * 0.9, r * 0.3, r * 0.8, -r * 0.1, y0 + r * 0.15, 0, bv);
      b.cylb(kit.metal, r * 0.2, r * 0.5, r * 0.04, [-r * 0.2, y0 + r * 0.3, 0], 'y', 12);
      pitch.position.set(-r * 0.2, y0 + r * 0.7, 0);
      p.box(kit.hull, r * 0.9, r * 0.16, r * 0.2, r * 0.4, 0, 0, bv);
      p.strut(kit.steel, [0, r * 0.12, r * 0.2], [r * 0.7, r * 0.06, r * 0.2], r * 0.035, r * 0.035, 6);
      if (v === 'saw' || v === 'chainsaw') { rc.lathe(kit.steel, [[0, -r * 0.02], [r * 0.6, -r * 0.02], [r * 0.6, r * 0.02], [0, r * 0.02]], [r * 0.9, 0, 0], 'z', 20); for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; rc.box(kit.metal, r * 0.08, r * 0.06, r * 0.04, r * 0.9 + Math.cos(a) * r * 0.6, 0, Math.sin(a) * r * 0.6, 0.003, [0, -a, 0]); } }
      else if (v === 'hammer') { rc.box(kit.metal, r * 0.5, r * 0.5, r * 0.8, r * 1.0, 0, 0, bv * 2); rc.box(kit.steel, r * 0.1, r * 0.44, r * 0.74, r * 1.28, 0, 0, bv); }
      else if (v === 'drill') rc.lathe(kit.steel, [[0, 0], [r * 0.25, 0], [r * 0.2, r * 0.5], [0, r * 0.95]], [r * 0.7, 0, 0], 'x', 12);
      else if (v === 'claw') for (const z of [-r * 0.2, r * 0.2]) rc.slab(kit.steel, [[0, -r * 0.05], [r * 0.7, -r * 0.01], [r * 0.9, r * 0.05], [0, r * 0.08]], r * 0.1, 0.004, r * 0.7, -r * 0.05, z);
      else rc.lathe(kit.steel, [[0, 0], [r * 0.06, 0], [r * 0.03, r * 0.7], [0, r * 0.75]], [r * 0.7, 0, 0], 'x', 8);
      t.shot = 'none';
      t.rate = 99;
      break;
    }
    case 'charge': {
      // bomb rack: three finned bombs under a pylon
      for (let i = 0; i < 3; i++) {
        const z = (i - 1) * r * 0.5;
        b.lathe(kit.canvas, [[0, 0], [r * 0.14, r * 0.05], [r * 0.2, r * 0.3], [r * 0.2, r * 0.6], [r * 0.1, r * 0.95], [0, r * 1.0]], [-r * 0.5, 0, z], 'x', 12);
        b.box(kit.trim, r * 0.15, r * 0.02, r * 0.4, -r * 0.5 + r * 0.05, 0, z, 0.002);
      }
      b.box(kit.trim, r * 1.3, r * 0.1, r * 1.3, 0, r * 0.2, 0, bv);
      t.shot = 'none';
      t.rate = 99;
      break;
    }
    default: {
      // utility / support (repair, shield, sensor, dome, uplink, jammer, cloak ...): armoured base, mast and dish / dome
      b.cylb(kit.hull, r * 0.55, r * 0.3, r * 0.05, [0, y0, 0], 'y', 16);
      if (v === 'dome' || v === 'shield') {
        b.lathe(kit.steel, [[r * 0.5, 0], [r * 0.5, r * 0.05], [r * 0.38, r * 0.3], [r * 0.2, r * 0.5], [0, r * 0.55]], [0, y0 + r * 0.3, 0], 'y', 16);
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; b.strut(kit.metal, [Math.cos(a) * r * 0.45, y0 + r * 0.32, Math.sin(a) * r * 0.45], [0, y0 + r * 0.9, 0], r * 0.012, r * 0.012, 4); }
        b.cyl(kit.glow, r * 0.07, r * 0.07, r * 0.05, [0, y0 + r * 0.9, 0], 'y', 8);
      } else if (v === 'repair') {
        b.cyl(kit.metal, r * 0.06, r * 0.06, r * 0.8, [0, y0 + r * 0.3, 0], 'y', 8);
        pitch.position.set(0, y0 + r * 1.05, 0);
        p.strut(kit.steel, [0, 0, 0], [r * 0.55, r * 0.15, 0], r * 0.05, r * 0.04, 8);
        p.cylb(kit.hazard, r * 0.09, r * 0.3, r * 0.02, [r * 0.5, r * 0.1, 0], 'x', 10);
        p.cyl(kit.glow, r * 0.05, r * 0.05, 0.01, [r * 0.8, r * 0.15, 0], 'x', 8);
      } else {
        b.cyl(kit.metal, r * 0.06, r * 0.08, r * 0.8, [0, y0 + r * 0.3, 0], 'y', 8);
        pitch.position.set(0, y0 + r * 1.05, 0);
        // parabolic dish facing +X
        p.lathe(kit.panel, [[0, 0], [r * 0.12, 0.002], [r * 0.3, r * 0.03], [r * 0.5, r * 0.12], [r * 0.5, r * 0.14], [r * 0.3, r * 0.05], [r * 0.12, r * 0.02], [0, 0.0]], [0, 0, 0], 'x', 18, [0, 0, 0]);
        p.strut(kit.steel, [0, 0, 0], [r * 0.4, 0, 0], r * 0.012, r * 0.012, 4);
        p.cyl(kit.glow, r * 0.05, r * 0.05, r * 0.06, [r * 0.38, 0, 0], 'x', 8);
      }
      t.shot = 'none';
      t.rate = 99;
    }
  }
  // team accent: a small stripe on the roof of the turret
  if (v !== 'plate' && !fixed && t.shot !== 'none') b.box(kit.accent, r * 0.35, r * 0.012, r * 0.06, -r * 0.35, y0 + r * 0.5, r * 0.3, 0.002);

  const tris0 = b.tris;
  b.mount(yaw);
  p.mount(pitch);
  rc.mount(recoil);
  sp.mount(spinG);
  t.tris = b.tris - tris0 + p.tris + rc.tris + sp.tris;
  return t;
}

export { loft };
export type { P2 };
