// The ONLY module that touches src/client/proto3d/*. Turns its per-design builder into cheap instances:
// a template is built once per (design, team) and each unit on the field is a clone that shares geometry and
// materials. When the proto3d API changes, update this file only.

import * as THREE from 'three';
import { buildUnit, type Unit3D } from '../proto3d/units3d.ts';
import { MODULE_BY_ID } from '../../shared/parts.ts';
import { mountOffsets } from '../../shared/mountgeo.ts';
import type { Design } from '../../shared/types.ts';

export interface TurretInst {
  yaw: THREE.Object3D;
  recoil: THREE.Object3D;
  muzzles: THREE.Object3D[];
  spin?: THREE.Object3D;
  r: number;
  fixed: boolean;
}

export type Look = 'normal' | 'ghost' | 'invalid' | 'wreck' | 'cloak';

export interface UnitInst {
  key: string;
  root: THREE.Group;
  /** one entry per design mount (null = empty mount) */
  turrets: (TurretInst | null)[];
  L: number; W: number; S: number;
  flying: boolean;
  /** approximate height of the hull top (cells) */
  height: number;
  look: Look;
  setLook(look: Look): void;
}

interface Template {
  unit: Unit3D;
  meshes: THREE.Mesh[];
  mountTurret: number[];
  height: number;
}

const templates = new Map<string, Template>();

const sig = (d: Design, team: number) => `${team}|${d.id}|${d.chassis}|${d.mobility}|${d.mounts.join(',')}`;

const looks: Record<Exclude<Look, 'normal'>, THREE.Material> = {
  ghost: new THREE.MeshStandardMaterial({ color: '#9fe8c0', transparent: true, opacity: 0.5, roughness: 0.6, depthWrite: false }),
  invalid: new THREE.MeshStandardMaterial({ color: '#ff5050', transparent: true, opacity: 0.55, roughness: 0.6, depthWrite: false }),
  wreck: new THREE.MeshStandardMaterial({ color: '#1c1a18', roughness: 0.95, metalness: 0.2 }),
  cloak: new THREE.MeshStandardMaterial({ color: '#8fb8d0', transparent: true, opacity: 0.35, roughness: 0.5, depthWrite: false }),
};

function template(design: Design, team: 0 | 1): Template {
  const key = sig(design, team);
  let t = templates.get(key);
  if (t) return t;
  const unit = buildUnit(design, team);
  unit.root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  unit.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  // design mount i -> index into unit.turrets (mounts without a module / offset get no turret)
  const offs = mountOffsets(design);
  const mountTurret: number[] = [];
  let n = 0;
  design.mounts.forEach((mid, i) => {
    const mod = mid ? MODULE_BY_ID.get(mid) : null;
    mountTurret.push(mod && offs[i] ? n++ : -1);
  });
  const box = new THREE.Box3().setFromObject(unit.root);
  t = { unit, meshes, mountTurret, height: Math.max(0.4, box.max.y) };
  templates.set(key, t);
  return t;
}

export function instantiate(design: Design, team: 0 | 1): UnitInst {
  const t = template(design, team);
  const root = t.unit.root.clone(true) as THREE.Group;
  // map template nodes -> clone nodes (clone(true) preserves traversal order)
  const a: THREE.Object3D[] = [], b: THREE.Object3D[] = [];
  t.unit.root.traverse((o) => a.push(o));
  root.traverse((o) => b.push(o));
  const map = new Map<THREE.Object3D, THREE.Object3D>();
  a.forEach((o, i) => map.set(o, b[i]));
  const tur: TurretInst[] = t.unit.turrets.map((tu) => ({
    yaw: map.get(tu.yaw)!, recoil: map.get(tu.recoil)!, muzzles: tu.muzzles.map((m) => map.get(m)!),
    spin: tu.spin ? map.get(tu.spin) : undefined, r: tu.r, fixed: tu.fixed,
  }));
  const meshes: THREE.Mesh[] = [];
  const orig: (THREE.Material | THREE.Material[])[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { meshes.push(o as THREE.Mesh); orig.push((o as THREE.Mesh).material); } });
  const inst: UnitInst = {
    key: sig(design, team), root,
    turrets: t.mountTurret.map((i) => (i >= 0 ? tur[i] : null)),
    L: t.unit.L, W: t.unit.W, S: t.unit.S, flying: t.unit.flying, height: t.height,
    look: 'normal',
    setLook(look) {
      if (look === inst.look) return;
      inst.look = look;
      meshes.forEach((m, i) => {
        m.material = look === 'normal' ? orig[i] : looks[look];
        m.castShadow = look === 'normal' || look === 'wreck';
      });
    },
  };
  return inst;
}

export const templateKey = (d: Design, team: number) => sig(d, team);
