// Procedural 3D weapon turrets from ModuleDef (visual family, mount class, calibre, barrel count).
// Turret frame: +X = muzzle direction, +Y = up, origin on the deck at the turret ring centre.

import * as THREE from 'three';
import { approxTurretD } from '../../shared/mountgeo.ts';
import type { ModuleDef } from '../../shared/types.ts';
import type { Kit } from './materials.ts';

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
}

const cyl = (rt: number, rb: number, h: number, seg = 14) => new THREE.CylinderGeometry(rt, rb, h, seg);

function mesh(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = o.receiveShadow = true;
  parent.add(o);
  return o;
}

/** barrel along +X from x0 to x1, centre height y, lateral z */
function barrel(parent: THREE.Object3D, m: THREE.Material, x0: number, x1: number, rad: number, y: number, z: number, tip?: number): THREE.Mesh {
  const g = cyl(rad, rad, x1 - x0, 12);
  g.rotateZ(-Math.PI / 2);
  const o = mesh(g, m, parent, (x0 + x1) / 2, y, z);
  if (tip) {
    const t = cyl(rad * 1.35, rad * 1.35, tip, 12);
    t.rotateZ(-Math.PI / 2);
    mesh(t, m, parent, x1 - tip / 2, y, z);
  }
  return o;
}

/** faceted turret housing: chamfered, front-sloped block (length along X) */
function housing(parent: THREE.Object3D, m: THREE.Material, len: number, wid: number, hgt: number, x = 0, y = 0): THREE.Mesh {
  const hw = wid / 2, hl = len / 2, c = Math.min(hw, hl) * 0.45;
  const s = new THREE.Shape();
  s.moveTo(-hl, -hw + c * 0.6); s.lineTo(-hl + c * 0.6, -hw); s.lineTo(hl - c, -hw * 0.9);
  s.lineTo(hl, -hw * 0.55); s.lineTo(hl, hw * 0.55); s.lineTo(hl - c, hw * 0.9);
  s.lineTo(-hl + c * 0.6, hw); s.lineTo(-hl, hw - c * 0.6); s.closePath();
  const bev = Math.min(hgt * 0.22, 0.03 + len * 0.025);
  const g = new THREE.ExtrudeGeometry(s, { depth: hgt - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.8, bevelSegments: 2, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bev, 0);
  return mesh(g, m, parent, x, y, 0);
}

export function buildTurret(mod: ModuleDef, S: number, kit: Kit, fixed = false): Turret {
  const D = approxTurretD(mod.mount, S);
  const r = D / 2;
  const c = mod.caliber ?? 0.5;
  const nb = mod.barrels ?? 1;
  const yaw = new THREE.Group();
  const pitch = new THREE.Group();
  const recoil = new THREE.Group();
  yaw.add(pitch);
  pitch.add(recoil);
  const t: Turret = { yaw, pitch, recoil, muzzles: [], fixed, shot: 'tracer', rate: 0.5, r };
  const v = mod.visual;
  const addMuzzle = (x: number, y: number, z: number) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    recoil.add(o);
    t.muzzles.push(o);
  };
  const hh = r * 0.52; // housing height
  const ringR = fixed ? 0 : r * 0.95;
  if (!fixed && v !== 'plate') {
    mesh(cyl(ringR, ringR * 1.04, r * 0.1, 20), kit.deep, yaw, 0, r * 0.05, 0);
  }
  const y0 = fixed ? 0 : r * 0.1;

  switch (v) {
    case 'gun': case 'shotgun': case 'flak': case 'pointdef': {
      const bl = D * (0.62 + 0.8 * c), br = D * (0.035 + 0.05 * c);
      housing(yaw, kit.body, r * 1.35, r * (1.0 + c * 0.2), hh * (0.7 + c * 0.3), -r * 0.12, y0);
      pitch.position.set(r * 0.45, y0 + hh * 0.5, 0);
      const sp = nb > 1 ? br * 2.7 : 0;
      for (let i = 0; i < nb; i++) {
        const z = nb > 1 ? (i - (nb - 1) / 2) * sp : 0;
        barrel(recoil, kit.metal, 0, bl, br, 0, z, br * 1.5);
        mesh(cyl(br * 1.7, br * 1.7, bl * 0.28, 12).rotateZ(-Math.PI / 2), kit.dark, recoil, bl * 0.2, 0, z);
        addMuzzle(bl + 0.01, 0, z);
      }
      t.rate = 0.18 + (1 - c) * 0.1;
      break;
    }
    case 'gatling': {
      const bl = D * 0.95, cr = r * 0.28;
      housing(yaw, kit.body, r * 1.5, r * 1.25, hh * 0.9, -r * 0.1, y0);
      pitch.position.set(r * 0.5, y0 + hh * 0.5, 0);
      const spin = new THREE.Group();
      recoil.add(spin);
      t.spin = spin;
      const n = Math.max(3, nb);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        barrel(spin, kit.metal, 0, bl, r * 0.045, Math.sin(a) * cr, Math.cos(a) * cr);
      }
      for (const x of [bl * 0.35, bl * 0.7, bl]) {
        const ring = cyl(cr + r * 0.07, cr + r * 0.07, r * 0.07, 16);
        ring.rotateZ(-Math.PI / 2);
        mesh(ring, kit.steel, spin, x, 0, 0);
      }
      mesh(cyl(cr * 0.5, cr * 0.5, bl, 10).rotateZ(-Math.PI / 2), kit.dark, spin, bl / 2, 0, 0);
      addMuzzle(bl, 0, 0);
      t.rate = 0.07;
      break;
    }
    case 'cannon': case 'gauss': case 'sniper': {
      const bl = D * (1.0 + 0.75 * c), br = D * (0.05 + 0.045 * c);
      housing(yaw, kit.body, r * 1.7, r * 1.55, hh * 1.0, -r * 0.1, y0);
      pitch.position.set(r * 0.62, y0 + hh * 0.55, 0);
      mesh(new THREE.BoxGeometry(r * 0.3, hh * 0.8, r * 1.1), kit.dark, recoil, 0.02, 0, 0); // mantlet
      barrel(recoil, kit.metal, 0, bl, br, 0, 0);
      mesh(cyl(br * 1.6, br * 1.6, bl * 0.2, 14).rotateZ(-Math.PI / 2), kit.dark, recoil, bl * 0.5, 0, 0); // fume extractor
      mesh(new THREE.BoxGeometry(br * 5, br * 3.4, br * 3.2), kit.metal, recoil, bl - br * 2, 0, 0); // muzzle brake
      addMuzzle(bl + br * 0.4, 0, 0);
      // commander cupola + hatch
      mesh(cyl(r * 0.16, r * 0.18, r * 0.12, 12), kit.deep, yaw, -r * 0.45, y0 + hh + r * 0.06, -r * 0.3);
      t.shot = 'shell';
      t.rate = 1.2;
      break;
    }
    case 'artillery': case 'mortar': {
      const art = v === 'artillery';
      const bl = D * (art ? 1.7 : 0.7), br = D * (art ? 0.07 : 0.1);
      housing(yaw, kit.body, r * 1.6, r * 1.5, hh * 0.8, -r * 0.2, y0);
      pitch.position.set(-r * 0.05, y0 + hh * 0.75, 0);
      pitch.rotation.z = art ? 0.45 : 1.05;
      barrel(recoil, kit.metal, 0, bl, br, 0, 0, br * 0.8);
      mesh(cyl(br * 1.5, br * 1.5, bl * 0.35, 14).rotateZ(-Math.PI / 2), kit.dark, recoil, bl * 0.28, 0, 0);
      if (art) mesh(new THREE.BoxGeometry(bl * 0.2, br * 3, br * 7), kit.dark, yaw, r * 0.1, y0 + hh * 0.5, 0); // cradle/trunnion plate
      addMuzzle(bl, 0, 0);
      t.shot = 'shell';
      t.rate = art ? 2.4 : 1.4;
      break;
    }
    case 'rail': {
      const bl = D * 1.35;
      housing(yaw, kit.body, r * 1.5, r * 1.3, hh * 0.8, -r * 0.2, y0);
      pitch.position.set(r * 0.3, y0 + hh * 0.62, 0);
      for (const z of [-r * 0.17, r * 0.17]) mesh(new THREE.BoxGeometry(bl, r * 0.2, r * 0.13), kit.steel, recoil, bl / 2, 0, z);
      mesh(new THREE.BoxGeometry(bl * 0.96, r * 0.06, r * 0.2), kit.rail, recoil, bl / 2, 0, 0);
      for (let i = 1; i < 5; i++) mesh(new THREE.BoxGeometry(r * 0.1, r * 0.34, r * 0.52), kit.dark, recoil, (bl * i) / 5, 0, 0);
      mesh(new THREE.BoxGeometry(r * 0.6, r * 0.34, r * 0.9), kit.dark, yaw, -r * 0.55, y0 + hh * 0.9, 0); // capacitor bank
      addMuzzle(bl, 0, 0);
      t.shot = 'beam';
      t.rate = 2.0;
      break;
    }
    case 'rocketPod': case 'missileRack': case 'cruise': {
      const tubes = Math.max(1, nb);
      const cols = tubes >= 4 ? 2 : 1, rows = Math.ceil(tubes / cols);
      const pw = r * (0.55 + 0.35 * cols), ph = r * (0.4 + 0.25 * rows), pl = r * 1.4;
      housing(yaw, kit.dark, r * 1.2, r * 1.2, hh * 0.45, -r * 0.1, y0);
      pitch.position.set(0, y0 + hh * 0.45 + ph / 2, 0);
      pitch.rotation.z = 0.18;
      mesh(new THREE.BoxGeometry(pl, ph, pw), kit.body, recoil, pl * 0.35, 0, 0);
      let k = 0;
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols && k < tubes; j++, k++) {
        const z = cols > 1 ? (j - 0.5) * pw * 0.5 : 0, y = rows > 1 ? (i - (rows - 1) / 2) * ph * 0.5 : 0;
        const tubeR = Math.min(pw / (cols * 2.5), ph / (rows * 2.5), r * 0.16);
        const tg = cyl(tubeR, tubeR, 0.04).rotateZ(-Math.PI / 2);
        mesh(tg, kit.deep, recoil, pl * 0.35 + pl / 2 + 0.005, y, z);
        mesh(new THREE.CircleGeometry(tubeR * 0.8, 10).rotateY(Math.PI / 2), kit.hot, recoil, pl * 0.35 + pl / 2 + 0.03, y, z);
        addMuzzle(pl * 0.85, y, z);
      }
      t.shot = 'rocket';
      t.rate = 0.9;
      break;
    }
    case 'laser': case 'heatray': case 'slowbeam': case 'sonic': case 'emp': case 'gravity': case 'tesla': {
      housing(yaw, kit.light, r * 1.3, r * 1.1, hh * 0.8, -r * 0.1, y0);
      pitch.position.set(r * 0.4, y0 + hh * 0.5, 0);
      const bl = D * 0.8;
      for (let i = 0; i < Math.max(1, nb); i++) {
        const z = nb > 1 ? (i - (nb - 1) / 2) * r * 0.32 : 0;
        barrel(recoil, kit.steel, 0, bl, r * 0.1, 0, z);
        mesh(cyl(r * 0.16, r * 0.1, r * 0.3, 14).rotateZ(-Math.PI / 2), kit.dark, recoil, bl, 0, z);
        mesh(new THREE.SphereGeometry(r * 0.1, 10, 8), kit.glow, recoil, bl + r * 0.14, 0, z);
        addMuzzle(bl + r * 0.2, 0, z);
      }
      t.shot = 'beam';
      t.rate = 0.7;
      break;
    }
    case 'plasma': {
      housing(yaw, kit.body, r * 1.6, r * 1.4, hh * 0.85, -r * 0.2, y0);
      pitch.position.set(r * 0.35, y0 + hh * 0.6, 0);
      const bl = D * 1.0;
      for (let i = 0; i < Math.max(1, Math.min(2, nb)); i++) {
        const z = nb > 1 ? (i - 0.5) * r * 0.55 : 0;
        barrel(recoil, kit.steel, 0, bl, r * 0.13, 0, z);
        for (let k = 1; k <= 3; k++) mesh(new THREE.TorusGeometry(r * 0.2, r * 0.045, 8, 16).rotateY(Math.PI / 2), kit.plasma, recoil, (bl * k) / 3.4, 0, z);
        mesh(new THREE.SphereGeometry(r * 0.17, 12, 10), kit.plasma, recoil, bl + r * 0.05, 0, z);
        addMuzzle(bl + r * 0.15, 0, z);
      }
      t.shot = 'orb';
      t.rate = 1.6;
      break;
    }
    case 'flamer': {
      housing(yaw, kit.dark, r * 1.2, r * 1.1, hh * 0.6, -r * 0.1, y0);
      pitch.position.set(r * 0.3, y0 + hh * 0.4, 0);
      barrel(recoil, kit.metal, 0, D * 0.7, r * 0.08, 0, 0);
      mesh(cyl(r * 0.14, r * 0.1, r * 0.2, 10).rotateZ(-Math.PI / 2), kit.hot, recoil, D * 0.7, 0, 0);
      for (const z of [-r * 0.32, r * 0.32]) mesh(cyl(r * 0.16, r * 0.16, r * 0.9, 12).rotateZ(-Math.PI / 2), kit.camo, yaw, -r * 0.45, y0 + hh * 0.62, z);
      addMuzzle(D * 0.8, 0, 0);
      t.shot = 'flame';
      t.rate = 0.12;
      break;
    }
    case 'plate': {
      // passive armour slab, no traverse
      const w = r * 1.8;
      mesh(new THREE.BoxGeometry(r * 0.45, r * 0.9, w), kit.light, yaw, r * 0.6, r * 0.45, 0);
      mesh(new THREE.BoxGeometry(r * 0.2, r * 0.7, w * 0.8), kit.dark, yaw, r * 0.38, r * 0.45, 0);
      t.shot = 'none';
      t.rate = 99;
      break;
    }
    default: {
      // utility / support (repair, shield, sensor, dome, uplink, ...): mast with dish and a glowing core
      mesh(cyl(r * 0.5, r * 0.6, r * 0.28, 16), kit.body, yaw, 0, y0 + r * 0.14, 0);
      mesh(cyl(r * 0.07, r * 0.09, r * 0.8, 8), kit.steel, yaw, 0, y0 + r * 0.6, 0);
      const dish = new THREE.SphereGeometry(r * 0.55, 18, 6, 0, Math.PI * 2, 0, Math.PI / 2.4);
      dish.rotateZ(-Math.PI / 2.6);
      mesh(dish, kit.light, pitch, 0, 0, 0);
      pitch.position.set(0, y0 + r * 1.0, 0);
      mesh(new THREE.SphereGeometry(r * 0.1, 10, 8), kit.glow, pitch, r * 0.16, 0, 0);
      t.shot = 'none';
      t.rate = 99;
    }
  }
  // team accent: a thin stripe on the housing roof
  if (v !== 'plate' && !fixed) mesh(new THREE.BoxGeometry(r * 0.55, 0.012, r * 0.09), kit.accent, yaw, -r * 0.25, y0 + hh * 0.96 + 0.01, r * 0.28);
  return t;
}
