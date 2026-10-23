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
import { bodyScale, mountOffsets } from '../../shared/mountgeo.ts';
import type { Design } from '../../shared/types.ts';
import { flyHeight } from '../render/tilt.ts';
import { aimTurret, buildUnit, contactShadow, recoilKick, recoilRelax, withSurfaceDetail, type Turret, type Unit3D } from '../proto3d/index.ts';
import { OUTLINE_LAYER } from './outline3d.ts';

export { buildTerrain, createRenderer, setupPost, setupStage, setSurfaceDetail, type Post, type Stage } from '../proto3d/index.ts';
import { TEAM_PAINT } from '../proto3d/materials.ts';

/** linear rgb of a team's primary hull paint (debris of a blown-up hull is painted with it) */
export function teamHullRgb(team: 0 | 1): [number, number, number] {
  const c = new THREE.Color(TEAM_PAINT[team][0]);
  return [c.r, c.g, c.b];
}

export type Look = 'normal' | 'ghost' | 'invalid' | 'wreck' | 'cloak';
const LOOKS: Look[] = ['normal', 'ghost', 'invalid', 'wreck', 'cloak'];

const lookMats: Record<Exclude<Look, 'normal'>, THREE.Material> = {
  ghost: new THREE.MeshStandardMaterial({ color: '#9fe8c0', transparent: true, opacity: 0.5, roughness: 0.6, metalness: 0.1, depthWrite: false }),
  invalid: new THREE.MeshStandardMaterial({ color: '#ff5050', transparent: true, opacity: 0.55, roughness: 0.6, metalness: 0.1, depthWrite: false }),
  // burnt-out hull: same plate seams / grime as the living paint, scorched darker
  wreck: withSurfaceDetail(new THREE.MeshStandardMaterial({ color: '#3a352f', roughness: 0.95, metalness: 0.12, envMapIntensity: 0.6 }), { det: 1, grime: 1.4 }),
  cloak: new THREE.MeshStandardMaterial({ color: '#8fb8d0', transparent: true, opacity: 0.32, roughness: 0.5, metalness: 0.1, depthWrite: false }),
};

// ---- charred wrecks: each unit material gets a wreck twin running the same program (team paint, plate detail, decals)
// with a char pass on top: desaturated, darkened, soot-black on upper surfaces and in noisy burnt patches, lamps out,
// and glowing ember cracks while the hull is hot. For the wreck look the per-instance colour is NOT a tint but data:
//   r = char amount 0..1, g = heat 0..1 (ember glow), b = per-wreck seed 0..1.
const CHAR_VERT_DECL = '\nvarying vec3 vChP; varying vec3 vChN;';
const CHAR_FRAG_DECL = /* glsl */ `
varying vec3 vChP; varying vec3 vChN;
float chH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float chN(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(chH(i), chH(i + vec3(1, 0, 0)), f.x), mix(chH(i + vec3(0, 1, 0)), chH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(chH(i + vec3(0, 0, 1)), chH(i + vec3(1, 0, 1)), f.x), mix(chH(i + vec3(0, 1, 1)), chH(i + vec3(1, 1, 1)), f.x), f.y), f.z); }`;
const CHAR_COLOR = /* glsl */ `
  #if defined( USE_COLOR_ALPHA ) || defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
    vec3 chK = vColor.rgb;
  #else
    vec3 chK = vec3(0.8, 0.0, 0.0);
  #endif
  vec3 chP = vChP * 2.2 + chK.b * 23.0;
  float chNs = chN(chP) * 0.6 + chN(chP * 2.7) * 0.4;
  vec3 chWn = normalize(vChN);
  float chTop = smoothstep(-0.3, 0.9, chWn.y);
  float chSoot = clamp(chK.r * (0.62 + 0.4 * chTop) + (chNs - 0.5) * 0.9 * chK.r, 0.0, 1.0);
  float chL = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  // paint survives faintly under the soot; burnt-through patches go black, the rest heat-tinted brown-grey metal
  vec3 chC = mix(vec3(chL), diffuseColor.rgb, 0.55 - 0.25 * chK.r) * (1.0 - 0.82 * chSoot);
  chC = mix(chC, vec3(0.03, 0.026, 0.022), smoothstep(0.6, 0.95, chSoot));
  chC = mix(chC, chC * vec3(1.12, 0.96, 0.82), 0.5 * chK.r);
  diffuseColor.rgb = chC;`;
const CHAR_EMBER = /* glsl */ `
  totalEmissiveRadiance = vec3(0.0);
  float chCrack = smoothstep(0.58, 0.78, chN(vChP * 4.6 + chK.b * 41.0)) * smoothstep(0.35, 0.7, chSoot + 0.2);
  totalEmissiveRadiance += vec3(2.4, 0.62, 0.1) * chK.g * chK.g * (chCrack * 1.8 + 0.08 * chSoot);
  #include <lights_fragment_begin>`;
const charCache = new WeakMap<THREE.Material, THREE.Material>();
function charred(src: THREE.Material): THREE.Material | null {
  const hit = charCache.get(src);
  if (hit) return hit;
  const s = src as THREE.Material & { isMeshStandardMaterial?: boolean; isMeshToonMaterial?: boolean; isMeshLambertMaterial?: boolean; isMeshPhongMaterial?: boolean };
  if (!(s.isMeshStandardMaterial || s.isMeshToonMaterial || s.isMeshLambertMaterial || s.isMeshPhongMaterial) || src.transparent) return null;
  const m = src.clone();
  const base = src.onBeforeCompile, key = src.customProgramCacheKey();
  m.onBeforeCompile = (sh, r) => {
    base.call(src, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>' + CHAR_VERT_DECL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvChP = position;')
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvChN = inverseTransformDirection(transformedNormal, viewMatrix);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>' + CHAR_FRAG_DECL)
      .replace('#include <color_fragment>', CHAR_COLOR)
      // after the unit program's own per-row roughness / metalness (soot is matte)
      .replace('#include <normal_fragment_begin>', '#if defined( STANDARD )\nroughnessFactor = mix(roughnessFactor, 0.95, chSoot);\nmetalnessFactor *= 1.0 - 0.6 * chSoot;\n#endif\n#include <normal_fragment_begin>')
      .replace('#include <lights_fragment_begin>', CHAR_EMBER);
  };
  m.customProgramCacheKey = () => key + '|char1';
  charCache.set(src, m);
  return m;
}
/** wreck twin of a unit part material (the plain burnt-out look for anything the char pass can't wrap) */
function wreckMat(src: THREE.Material): THREE.Material { return charred(src) ?? charred(lookMats.wreck) ?? lookMats.wreck; }

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
  /** centre height of the model's bounding box above the unit root (aircraft hang their airframe above the root) */
  midY: number;
  /** a turret node -> template turret index */
  turretNodes: Map<number, number>;
  /** how far (cells of body travel) one unit of animate()-time is, per mobility, so feet/wheels don't skate */
  phaseK: number;
  animates: boolean;
  /** instanced pools by look (index into LOOKS) */
  pool: (Pool | undefined)[];
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _tmpV = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _eu = new THREE.Euler();

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
  readonly midY: number;
  readonly radius: number;
  /** locomotion state */
  mv = 0;
  odo = 0;
  /** tint multiplier (hit flash etc.) */
  tr = 1; tg = 1; tb = 1;
  /** true for rigs that never move again (wrecks): transforms are not recomputed */
  frozen = false;
  private settle = 2;
  /** set once anything moved off the template's rest pose (gear animated, a turret aimed or kicked) */
  dirty = false;

  constructor(tpl: Template) {
    this.tpl = tpl;
    const u = tpl.unit;
    // battlefield body scale (shared/mountgeo bodyScale): the whole rig shrinks about its origin, sizes follow
    const bs = bodyScale(u.S);
    this.root.scale.setScalar(bs);
    this.L = u.L * bs; this.W = u.W * bs; this.S = u.S; this.flying = u.flying; this.height = tpl.height * bs; this.midY = tpl.midY * bs; this.radius = u.radius * bs;
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
    this.dirty = true;
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
    this.dirty = true;
    aimTurret(tu, x0 + Math.cos(localAngle) * 10, z0 + Math.sin(localAngle) * 10, dt, 22);
  }
  kick(i: number): void { const tu = this.turrets[i]; if (tu) { this.dirty = true; recoilKick(tu); } }

  /** Back to the template's rest pose: turrets facing forward, barrels home and not spinning, gear at its idle stance.
   *  Rigs are pooled per design, so without this a recycled rig kept the last pose of whatever unit used it before
   *  (a turret still laid on last round's target, a leg mid-stride). The deploy board re-acquires its rigs every frame
   *  and the pool hands them out in the opposite order each time, so same-design units swapped those stale poses
   *  frame to frame: their turrets and legs flickered between two poses while standing still. */
  restPose(): void {
    const tpl = this.tpl;
    if (tpl.animates) tpl.unit.animate(0, 0, 0);
    tpl.nodes.forEach((n, i) => {
      const o = this.objs[i];
      if (!o) return;
      o.position.copy(n.src.position); o.quaternion.copy(n.src.quaternion); o.scale.copy(n.src.scale);
      if (n.manual) o.matrix.copy(n.src.matrix); else o.updateMatrix();
    });
    for (const tu of this.all) tu.spinV = tu.idleSpin;
    this.settle = 2;
    this.dirty = false;
  }

  /** Wreck: knock turret ti off the hull onto the ground at hull-local (x, z) (template units), tipped over by `tip`
   *  radians and turned by `yaw`. restPose() puts it back when the rig is recycled. */
  dropTurret(ti: number, x: number, z: number, tip: number, yaw: number): void {
    const tpl = this.tpl, src = tpl.unit.turrets[ti]?.yaw;
    const k = tpl.nodes.findIndex((n) => n.src === src);
    const o = k >= 0 ? this.objs[k] : null;
    if (!o) return;
    this.dirty = true;
    // rest pose relative to the unit root, re-placed on the ground, then expressed in the parent's (rest) frame
    tpl.nodes[k].rel.decompose(_tmpV, _q, _s);
    _q.premultiply(_q2.setFromEuler(_eu.set(tip, yaw, tip * 0.4, 'YXZ')));
    _m.compose(_tmpV.set(x, 0.04, z), _q, _s);
    _m2.copy(tpl.nodes[tpl.nodes[k].parent].rel).invert().multiply(_m);
    _m2.decompose(o.position, o.quaternion, o.scale);
    o.updateMatrix();
  }

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
  readonly tpl: Template; readonly look: Look; readonly group: THREE.Group;
  constructor(tpl: Template, look: Look, group: THREE.Group) { this.tpl = tpl; this.look = look; this.group = group; }

  private build(cap: number): void {
    for (const m of this.meshes) if (m) { this.group.remove(m); m.dispose(); }
    this.meshes = [];
    this.cap = cap;
    this.tpl.meshes.forEach((src, j) => {
      if (this.look !== 'normal' && this.tpl.isBlob[j]) { this.meshes.push(null as unknown as THREE.InstancedMesh); return; }
      const mat = this.look === 'normal' ? (src.material as THREE.Material) : this.look === 'wreck' ? wreckMat(src.material as THREE.Material) : lookMats[this.look];
      const im = new THREE.InstancedMesh(src.geometry, mat, cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, new THREE.Color(1, 1, 1));
      im.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.castShadow = !this.tpl.isBlob[j] && (this.look === 'normal' || this.look === 'wreck');
      im.receiveShadow = !this.tpl.isBlob[j];
      im.renderOrder = this.tpl.isBlob[j] ? 1 : 0;
      // opaque parts of normal units get the dark contact edge (outline3d.ts); decals sit inside the silhouette anyway
      if (this.look === 'normal' && !this.tpl.isBlob[j] && !((mat as THREE.Material).alphaTest > 0)) im.layers.enable(OUTLINE_LAYER);
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
  const box = new THREE.Box3().setFromObject(root);
  // flyers: a soft contact blob on the ground right under the airframe (the rig flies at flyHeight + 0.4 above its root,
  // see FieldView3D), so an aircraft over ground of its own tone still has a dark mark that says where it is, even when
  // crowded views switch the sun shadows off. Ground units get theirs from buildUnit.
  if (unit.flying) {
    const bs = bodyScale(unit.S);
    const blob = contactShadow(unit.L * 0.85, unit.W * 0.85);
    // (+0.065: clear of the ground through the +-0.05 cruise bob)
    blob.position.y = (0.065 - (flyHeight(unit.S) + 0.4)) / bs;
    root.add(blob);
    root.updateMatrixWorld(true);
  }
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
  const isBlob = meshes.map((m) => (m.material as THREE.Material & { isMeshBasicMaterial?: boolean }).isMeshBasicMaterial === true);
  const tpl: Template = {
    key: sig(design, team), unit, nodes, dynOrder, animated: [...animated], meshes, meshNode, isBlob, mountTurret,
    height: Math.max(0.4, box.max.y), midY: Math.max(0.2, (box.min.y + box.max.y) / 2), turretNodes, phaseK: phaseFor(design.mobility, unit.S), animates: animated.size > 0, pool: [],
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
    if (r.dirty) r.restPose();
    r.look = 'normal'; r.frozen = false; r.mv = 0; r.odo = 0; r.tr = r.tg = r.tb = 1;
    r.root.position.set(0, 0, 0); r.root.rotation.set(0, 0, 0); r.root.scale.setScalar(bodyScale(t.unit.S)); // wrecks squash it
    return r;
  }
  release(r: Rig): void {
    let l = this.free.get(r.tpl.key);
    if (!l) this.free.set(r.tpl.key, (l = []));
    l.push(r);
  }

  /** queue a rig for drawing this frame (its transforms must be up to date) */
  submit(r: Rig, look: Look): void {
    const li = LOOKS.indexOf(look);
    let p = r.tpl.pool[li];
    if (!p) { p = new Pool(r.tpl, look, this.group); r.tpl.pool[li] = p; this.pools.set(r.tpl.key + '|' + look, p); }
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
