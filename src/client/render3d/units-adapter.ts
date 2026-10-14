// The ONLY module that touches src/client/proto3d/*. Turns the prototype's per-design builder into cheap, instanced units:
//
//  * One template per (design, team) built with buildUnit() (shared geometry + the shared per-team "uber" material).
//  * Every unit on the field is a Rig: a bag of transforms (no scene-graph, no meshes) that mirrors the template's
//    articulated nodes (turrets, legs, wheels, rotors). Animation is computed on the template and copied across.
//  * Rendering is instanced: one InstancedMesh per template mesh per "look" (normal / ghost / invalid / wreck / cloak), so a
//    300-unit battle costs roughly (distinct designs x ~15) draw calls instead of (units x ~15).
//  * Per-instance colour is a multiplicative tint (hit flash, burning, stun flicker).
//
// When the proto3d API changes, update this file only.

import * as THREE from 'three';
import { MODULE_BY_ID } from '../../shared/parts.ts';
import { mountOffsets } from '../../shared/mountgeo.ts';
import type { Design } from '../../shared/types.ts';
import { aimTurret, buildUnit, recoilKick, recoilRelax, type Turret, type Unit3D } from '../proto3d/index.ts';

export { buildTerrain, createRenderer, setupPost, setupStage, type Post, type Stage } from '../proto3d/index.ts';

export type Look = 'normal' | 'ghost' | 'invalid' | 'wreck' | 'cloak';
const LOOKS: Look[] = ['normal', 'ghost', 'invalid', 'wreck', 'cloak'];

const lookMats: Record<Exclude<Look, 'normal'>, THREE.Material> = {
  ghost: new THREE.MeshStandardMaterial({ color: '#9fe8c0', transparent: true, opacity: 0.5, roughness: 0.6, metalness: 0.1, depthWrite: false }),
  invalid: new THREE.MeshStandardMaterial({ color: '#ff5050', transparent: true, opacity: 0.55, roughness: 0.6, metalness: 0.1, depthWrite: false }),
  wreck: new THREE.MeshStandardMaterial({ color: '#201d1a', roughness: 0.96, metalness: 0.25, envMapIntensity: 0.5 }),
  cloak: new THREE.MeshStandardMaterial({ color: '#8fb8d0', transparent: true, opacity: 0.32, roughness: 0.5, metalness: 0.1, depthWrite: false }),
};

interface TNode {
  src: THREE.Object3D;
  parent: number;
  /** needs per-unit transform updates (turret rig, animated gear, or a descendant of one) */
  dyn: boolean;
  /** local matrix changes every frame (turret / animated node), as opposed to a fixed child of a moving node */
  live: boolean;
  /** source node keeps its own .matrix (IK legs) instead of position/quaternion/scale */
  manual: boolean;
  /** index into template meshes, -1 = not a mesh */
  mesh: number;
  /** matrix relative to the unit root at rest (static nodes) */
  rel: THREE.Matrix4;
}

interface Template {
  key: string;
  unit: Unit3D;
  nodes: TNode[];
  /** dynamic node indices, parents before children */
  dynOrder: number[];
  animated: number[];
  meshes: THREE.Mesh[];
  /** template mesh index -> node index */
  meshNode: number[];
  isBlob: boolean[];
  mountTurret: number[];
  height: number;
  /** a turret node -> template turret index */
  turretNodes: Map<number, number>;
  /** how far (cells of body travel) one unit of animate()-time is, per mobility, so feet/wheels don't skate */
  phaseK: number;
  animates: boolean;
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _tmpV = new THREE.Vector3();

/** One placed unit. Cheap to create (a few dozen Object3D) and recycle. */
export class Rig {
  readonly tpl: Template;
  readonly root = new THREE.Group();
  readonly turrets: (Turret | null)[];
  readonly all: Turret[];
  private objs: (THREE.Object3D | null)[];
  look: Look = 'normal';
  readonly L: number; readonly W: number; readonly S: number;
  readonly flying: boolean;
  readonly height: number;
  readonly radius: number;
  /** locomotion state */
  mv = 0;
  odo = 0;
  /** tint multiplier (hit flash etc.) */
  tr = 1; tg = 1; tb = 1;
  /** true for rigs that never move again (wrecks): transforms are not recomputed */
  frozen = false;
  private settle = 2;

  constructor(tpl: Template) {
    this.tpl = tpl;
    const u = tpl.unit;
    this.L = u.L; this.W = u.W; this.S = u.S; this.flying = u.flying; this.height = tpl.height; this.radius = u.radius;
    this.objs = tpl.nodes.map((n) => {
      if (!n.dyn) return null;
      const o = new THREE.Group();
      o.matrixAutoUpdate = false;
      o.matrixWorldAutoUpdate = false;
      o.position.copy(n.src.position); o.quaternion.copy(n.src.quaternion); o.scale.copy(n.src.scale);
      if (n.manual) o.matrix.copy(n.src.matrix); else o.updateMatrix();
      return o;
    });
    const map = new Map<THREE.Object3D, THREE.Object3D>();
    tpl.nodes.forEach((n, i) => { const o = this.objs[i]; if (o) map.set(n.src, o); });
    this.all = u.turrets.map((tu) => ({
      ...tu,
      yaw: map.get(tu.yaw) as THREE.Group, pitch: map.get(tu.pitch) as THREE.Group, recoil: map.get(tu.recoil) as THREE.Group,
      muzzles: tu.muzzles.map((m) => map.get(m)!), spin: tu.spin ? map.get(tu.spin) : undefined,
    }));
    this.turrets = tpl.mountTurret.map((i) => (i >= 0 ? this.all[i] : null));
  }

  /** Advance gear animation (legs / wheels / rotors). t is the unit's own phase clock, moving 0..1. */
  animate(t: number, dt: number, moving: number): void {
    const tpl = this.tpl;
    tpl.unit.animate(t, dt, moving);
    for (const k of tpl.animated) {
      const s = tpl.nodes[k], d = this.objs[k]!;
      if (s.manual) d.matrix.copy(s.src.matrix);
      else { d.position.copy(s.src.position); d.quaternion.copy(s.src.quaternion); d.scale.copy(s.src.scale); }
    }
  }

  /** locomotion: call once per frame with the distance travelled this frame and whether the sim says it's moving */
  locomote(dist: number, moving: boolean, t: number, dt: number): void {
    const tpl = this.tpl;
    const target = moving ? 1 : 0;
    this.mv += (target - this.mv) * Math.min(1, dt * 7);
    if (this.mv < 0.01) this.mv = 0;
    this.odo += dist;
    if (!tpl.animates) return;
    if (this.flying) { this.animate(t, dt, 1); return; }
    if (this.mv > 0) { this.settle = 2; this.animate(this.odo * tpl.phaseK, dt, this.mv); }
    else if (this.settle > 0) { this.settle--; this.animate(this.odo * tpl.phaseK, dt, 0); }
  }

  /** Point turret i at a direction in the unit's local frame (angle 0 = forward, +ve toward +z/right) */
  aim(i: number, localAngle: number, dt: number): void {
    const tu = this.turrets[i];
    if (!tu || tu.fixed) return;
    const x0 = tu.yaw.position.x, z0 = tu.yaw.position.z;
    aimTurret(tu, x0 + Math.cos(localAngle) * 10, z0 + Math.sin(localAngle) * 10, dt, 22);
  }
  kick(i: number): void { const tu = this.turrets[i]; if (tu) recoilKick(tu); }

  /** recompute transforms of the turret rigs / animated nodes after pose changes (root must already be positioned) */
  update(dt: number): void {
    if (this.frozen) return;
    for (const tu of this.all) recoilRelax(tu, dt);
    this.root.updateMatrix();
    const rm = this.root.matrix;
    const tpl = this.tpl;
    for (const i of tpl.dynOrder) {
      const n = tpl.nodes[i], o = this.objs[i]!;
      if (n.live && !n.manual) o.updateMatrix();
      else if (n.live) { /* matrix copied in animate() */ }
      const p = n.parent;
      if (p === 0) o.matrixWorld.multiplyMatrices(rm, o.matrix);
      else if (tpl.nodes[p].dyn) o.matrixWorld.multiplyMatrices(this.objs[p]!.matrixWorld, o.matrix);
      else { _m.multiplyMatrices(rm, tpl.nodes[p].rel); o.matrixWorld.multiplyMatrices(_m, o.matrix); }
    }
  }

  muzzleWorld(mount: number, out: THREE.Vector3): THREE.Vector3 | null {
    const m = this.turrets[mount]?.muzzles[0];
    if (!m) return null;
    return out.setFromMatrixPosition(m.matrixWorld);
  }

  /** world position of turret i's ring centre */
  turretWorld(mount: number, out: THREE.Vector3): THREE.Vector3 | null {
    const t = this.turrets[mount];
    if (!t) return null;
    return out.setFromMatrixPosition(t.yaw.matrixWorld);
  }

  /** model matrix for template mesh j */
  meshMatrix(j: number, out: THREE.Matrix4): void {
    // meshNode[j] resolved lazily via tpl
    const i = this.tpl.meshNode[j];
    const n = this.tpl.nodes[i];
    if (n.dyn) out.copy(this.objs[i]!.matrixWorld);
    else out.multiplyMatrices(this.root.matrix, n.rel);
  }
}

class Pool {
  meshes: THREE.InstancedMesh[] = [];
  cap = 0;
  rigs: Rig[] = [];
  shown = false;
  constructor(readonly tpl: Template, readonly look: Look, readonly group: THREE.Group) {}

  private build(cap: number): void {
    for (const m of this.meshes) { this.group.remove(m); m.dispose(); }
    this.meshes = [];
    this.cap = cap;
    this.tpl.meshes.forEach((src, j) => {
      if (this.look !== 'normal' && this.tpl.isBlob[j]) { this.meshes.push(null as unknown as THREE.InstancedMesh); return; }
      const mat = this.look === 'normal' ? (src.material as THREE.Material) : lookMats[this.look];
      const im = new THREE.InstancedMesh(src.geometry, mat, cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, new THREE.Color(1, 1, 1));
      im.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.castShadow = !this.tpl.isBlob[j] && (this.look === 'normal' || this.look === 'wreck');
      im.receiveShadow = !this.tpl.isBlob[j];
      im.renderOrder = this.tpl.isBlob[j] ? 1 : 0;
      im.count = 0;
      this.group.add(im);
      this.meshes.push(im);
    });
  }

  flush(): void {
    const n = this.rigs.length;
    if (n === 0) {
      if (this.shown) { for (const m of this.meshes) if (m) m.count = 0; this.shown = false; }
      return;
    }
    if (n > this.cap) this.build(Math.max(16, this.cap * 2, n));
    this.shown = true;
    const meshes = this.meshes;
    for (let i = 0; i < n; i++) {
      const r = this.rigs[i];
      for (let j = 0; j < meshes.length; j++) {
        const im = meshes[j];
        if (!im) continue;
        r.meshMatrix(j, _m2);
        _m2.toArray(im.instanceMatrix.array as unknown as number[], i * 16);
        const c = im.instanceColor!.array as Float32Array;
        c[i * 3] = r.tr; c[i * 3 + 1] = r.tg; c[i * 3 + 2] = r.tb;
      }
    }
    for (const im of meshes) if (im) { im.count = n; im.instanceMatrix.needsUpdate = true; im.instanceColor!.needsUpdate = true; }
    this.rigs.length = 0;
  }

  dispose(): void { for (const m of this.meshes) if (m) { this.group.remove(m); m.dispose(); } this.meshes = []; }
}

const sig = (d: Design, team: number) => `${team}|${d.id}|${d.chassis}|${d.mobility}|${d.mounts.join(',')}`;
export const templateKey = sig;

/** rough body-travel -> animation-clock factor so legs / wheels roll with the ground instead of skating */
function phaseFor(mobility: string, S: number): number {
  switch (mobility) {
    case 'wheels': return 1 / (6 * (0.07 + 0.035 * Math.min(S, 4)));
    case 'legs': case 'titanlegs': case 'jumpjets': return 1 / (3.2 * (0.2 + 0.2 * S));
    case 'spider': return 1 / (3.2 * (0.14 + 0.17 * S));
    default: return 1;
  }
}

function buildTemplate(design: Design, team: 0 | 1): Template {
  const unit = buildUnit(design, team);
  const root = unit.root;
  root.updateMatrixWorld(true);
  const nodes: TNode[] = [];
  const index = new Map<THREE.Object3D, number>();
  const meshes: THREE.Mesh[] = [];
  const meshNode: number[] = [];
  const walk = (o: THREE.Object3D, parent: number): void => {
    const i = nodes.length;
    index.set(o, i);
    const isMesh = (o as THREE.Mesh).isMesh;
    nodes.push({ src: o, parent, dyn: false, live: false, manual: !o.matrixAutoUpdate, mesh: isMesh ? meshes.length : -1, rel: new THREE.Matrix4() });
    if (isMesh) { meshes.push(o as THREE.Mesh); meshNode.push(i); }
    for (const c of o.children) walk(c, i);
  };
  walk(root, -1);

  // turret rig nodes are live
  const turretNodes = new Map<number, number>();
  unit.turrets.forEach((tu, ti) => {
    for (const o of [tu.yaw, tu.pitch, tu.recoil, tu.spin, ...tu.muzzles]) {
      if (!o) continue;
      const i = index.get(o);
      if (i !== undefined) { nodes[i].dyn = nodes[i].live = true; turretNodes.set(i, ti); }
    }
  });

  // animated gear: nodes whose local matrix changes under animate()
  const snap = (): number[][] => nodes.map((n) => { if (n.src.matrixAutoUpdate) n.src.updateMatrix(); return Array.from(n.src.matrix.elements); });
  unit.animate(0, 0, 0);
  const rest = snap();
  const animated = new Set<number>();
  for (const [t, mv] of [[0.83, 1], [1.9, 1], [3.1, 0.6]] as [number, number][]) {
    unit.animate(t, 0.016, mv);
    snap().forEach((e, i) => {
      if (i === 0) return;
      const r = rest[i];
      // body bob is a sub-0.02 vertical wobble: not worth un-merging the hull for
      let big = 0;
      for (let k = 0; k < 16; k++) big = Math.max(big, Math.abs(e[k] - r[k]));
      if (big > 0.03) animated.add(i);
    });
  }
  unit.animate(0, 0, 0);
  for (const i of animated) nodes[i].dyn = nodes[i].live = true;
  // descendants of dynamic nodes are dynamic (their matrices ride along)
  nodes.forEach((n, i) => { if (i > 0 && !n.dyn && nodes[n.parent].dyn) n.dyn = true; });
  root.updateMatrixWorld(true);
  nodes.forEach((n) => { n.rel.copy(n.src.matrixWorld); });
  const dynOrder: number[] = [];
  nodes.forEach((n, i) => { if (i > 0 && n.dyn) dynOrder.push(i); });
  // children of the root that are dynamic need parent === 0 handled; static parents resolved via rel

  // design mount i -> index into unit.turrets (mounts without a module / offset get no turret)
  const offs = mountOffsets(design);
  const mountTurret: number[] = [];
  let tn = 0;
  design.mounts.forEach((mid, i) => {
    const mod = mid ? MODULE_BY_ID.get(mid) : null;
    mountTurret.push(mod && offs[i] ? tn++ : -1);
  });
  const box = new THREE.Box3().setFromObject(root);
  const isBlob = meshes.map((m) => (m.material as THREE.Material & { isMeshBasicMaterial?: boolean }).isMeshBasicMaterial === true);
  const tpl: Template = {
    key: sig(design, team), unit, nodes, dynOrder, animated: [...animated], meshes, meshNode, isBlob, mountTurret,
    height: Math.max(0.4, box.max.y), turretNodes, phaseK: phaseFor(design.mobility, unit.S), animates: animated.size > 0,
  };
  return tpl;
}

/** Owns templates, free lists and instanced pools. FieldView3D adds `group` to its scene. */
export class UnitLayer {
  readonly group = new THREE.Group();
  private templates = new Map<string, Template>();
  private free = new Map<string, Rig[]>();
  private pools = new Map<string, Pool>();
  /** distinct templates built / total instanced draw meshes currently shown (diagnostics) */
  stats = { templates: 0, tris: 0 };

  constructor() { this.group.name = 'units'; }

  private template(design: Design, team: 0 | 1): Template {
    const key = sig(design, team);
    let t = this.templates.get(key);
    if (!t) { t = buildTemplate(design, team); this.templates.set(key, t); this.stats.templates = this.templates.size; this.stats.tris += t.unit.tris; }
    return t;
  }

  acquire(design: Design, team: 0 | 1): Rig {
    const t = this.template(design, team);
    const r = this.free.get(t.key)?.pop() ?? new Rig(t);
    r.look = 'normal'; r.frozen = false; r.mv = 0; r.odo = 0; r.tr = r.tg = r.tb = 1;
    r.root.position.set(0, 0, 0); r.root.rotation.set(0, 0, 0);
    return r;
  }
  release(r: Rig): void {
    let l = this.free.get(r.tpl.key);
    if (!l) this.free.set(r.tpl.key, (l = []));
    l.push(r);
  }

  /** queue a rig for drawing this frame (its transforms must be up to date) */
  submit(r: Rig, look: Look): void {
    const key = r.tpl.key + '|' + look;
    let p = this.pools.get(key);
    if (!p) { p = new Pool(r.tpl, look, this.group); this.pools.set(key, p); }
    p.rigs.push(r);
  }
  /** write all queued instances; call once per frame after every submit() */
  flush(): void { for (const p of this.pools.values()) p.flush(); }

  /** count of instanced meshes with live instances (for diagnostics) */
  get liveMeshes(): number { let n = 0; for (const p of this.pools.values()) if (p.shown) n += p.meshes.filter(Boolean).length; return n; }

  dispose(): void { for (const p of this.pools.values()) p.dispose(); this.pools.clear(); }
}

export { LOOKS };
void _tmpV;
