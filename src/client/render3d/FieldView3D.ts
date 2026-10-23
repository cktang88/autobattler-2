// FieldView3D: three.js battlefield renderer implementing BattleView (see render/view.ts).
// Orthographic camera tilted ~58 degrees so the 2D ground mapping (Camera/CameraControls from render/camera.ts) stays
// exact: worldToScreen/screenToWorld and match.ts's 2D overlays (range rings, labels) line up with the 3D ground.
// Scene axes: three x = field x (cells), three z = field y, three y = up (cells).
//
// Layers: terrain (proto3d buildTerrain, restyled per map) -> instanced units (units-adapter) -> effects (fx3d) -> post
// (AO / bloom / grade) -> screen-space overlay (health bars, paralysis meters, level pips; ui3d).

import * as THREE from 'three';
import { battleSfx, setPanFlip } from '../audio.ts';
import { DEPLOY_D, FIELD_H, FIELD_W } from '../../shared/grid.ts';
import { MODULE_BY_ID } from '../../shared/parts.ts';
import type { Battle } from '../../shared/sim/battle.ts';
import { DT, type BattleEvent, type SimProjectile, type SimUnit } from '../../shared/sim/types.ts';
import type { ModuleDef, Side } from '../../shared/types.ts';
import { Camera, CameraControls } from '../render/camera.ts';
import type { BoardOverlay, BoardUnit } from '../render/field.ts';
import { MAPS, type MapTheme } from '../render/ground.ts';
import { TEAM_PAL } from '../render/palette.ts';
import { flyHeight } from '../render/tilt.ts';
import type { BattleView } from '../render/view.ts';
import { buildTerrain, createRenderer, setupPost, setupStage, type Post, type Stage } from './units-adapter.ts';
import { UnitLayer, templateKey, type Look, type Rig } from './units-adapter.ts';
import { Fx3D, RAMPS, type MuzzleKind, type Ramp, type TrailKind } from './fx3d.ts';
import { Overlay, ShieldPool, rgb } from './ui3d.ts';

const ELEV = (58 * Math.PI) / 180;
const GUN_H = 0.55;
const SHAKE_CAP = 3;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const normAng = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a: number, b: number, t: number) => a + normAng(b - a) * t;

interface Snap { x: number; y: number; angle: number; mounts: number[] }
interface PSnap { x: number; y: number; z: number; angle: number; progress: number }
/** per-unit presentation state */
interface UView {
  rig: Rig;
  lx: number; ly: number; seen: boolean;
  dmgT: number; healT: number; hpLast: number; shLast: number; hpShown: number;
  shT: number; hx: number; hy: number; hz: number;
  hits: number;
  /** rig transforms are current (posed last frame); culled / hidden rigs keep stale muzzle positions */
  posed: boolean;
}
interface Wreck { rig: Rig; x: number; z: number; smoke: number; S: number }
interface ProjRec {
  y0: number; lastH: number; px: number; py: number; bright: boolean; hEnd: number; air: boolean; st: WStyle; k: number; bomblet: boolean;
  /** smoothed 3D flight direction, the last trail emission point, launch time, wobble phase */
  dx: number; dy: number; dz: number; ex: number; ey: number; ez: number; born: number; seed: number;
}

/** straight round fired at an aircraft: the sim flies those at z = 1 (arcing shells and missiles have their own z) */
const airShot = (p: SimProjectile) => (p.kind === 'bullet' || p.kind === 'shell' || p.kind === 'rocket' || p.kind === 'orb' || p.kind === 'missile') && Math.abs(p.z - 1) < 1e-6;

/** beams / bolts: colour + width + life by module visual */
function beamStyle(moduleId: string): { color: string; w: number; life: number; wob: number } {
  const def = MODULE_BY_ID.get(moduleId), v = def?.visual;
  if (def?.disarm) return { color: '#ffb02a', w: 0.05, life: 0.2, wob: 0.15 }; // amber jamming beam
  if (v === 'gravity') return { color: '#9a5cff', w: 0.1, life: 0.14, wob: 0.45 };
  switch (v) {
    case 'laser': return { color: '#ff4a3a', w: 0.05, life: 0.1, wob: 0 };
    case 'heatray': return { color: '#ff8a2a', w: 0.13, life: 0.12, wob: 0.25 };
    case 'plasma': return { color: '#e070ff', w: 0.15, life: 0.12, wob: 0.2 };
    case 'tesla': case 'emp': return { color: '#9fc8ff', w: 0.05, life: 0.2, wob: 0 };
    case 'slowbeam': case 'sonic': return { color: '#5ec8ff', w: 0.09, life: 0.12, wob: 0.35 };
    case 'rail': case 'gauss': return { color: '#9fb8ff', w: 0.07, life: 0.24, wob: 0 };
    case 'repair': case 'nanite': return { color: '#7dff9a', w: 0.06, life: 0.12, wob: 0.2 };
    default: return { color: '#ffd890', w: 0.05, life: 0.1, wob: 0 };
  }
}

/** Weapon families for the effects: every weapon gets a readable signature (tracer / round, muzzle flash, impact). */
type Fam =
  | 'mg' | 'twinmg' | 'hmg' | 'gatling' | 'shotgun' | 'flechette' | 'ac' | 'apc' | 'he' | 'gauss' | 'sniper' | 'rail'
  | 'rocket' | 'incend' | 'missile' | 'bigMissile' | 'grenade' | 'mortar' | 'howitzer' | 'cluster' | 'firebomb' | 'bomb'
  | 'flak' | 'laser' | 'focus' | 'heatray' | 'plasma' | 'plasmaOrb' | 'empOrb' | 'sonic' | 'chain' | 'slow' | 'disarm'
  | 'gravity' | 'flame' | 'melee' | 'heal' | 'pd' | 'other';
interface WStyle {
  fam: Fam;
  /** effect size: ~0.25 light gun .. ~1.25 titan gun (mount class x calibre) */
  s: number;
  def: ModuleDef | undefined;
  muzzle: MuzzleKind | null;
}
const CLASS_S: Record<string, number> = { S: 0.3, M: 0.5, L: 0.8, XL: 1 };

function famOf(def: ModuleDef | undefined): Fam {
  if (!def) return 'other';
  if (def.pointDefense) return 'pd';
  if (def.heal) return 'heal';
  const v = def.visual, pk = def.projectile ?? 'bullet', pellets = def.pellets ?? 1;
  if (def.category === 'melee') return 'melee';
  if (def.fireField && pk === 'arc') return 'firebomb';
  if (def.cluster) return 'cluster';
  switch (def.category) {
    case 'machinegun':
      if (def.spinUp || v === 'gatling') return 'gatling';
      if (pellets > 1) return def.pierce ? 'flechette' : 'shotgun';
      return def.slow ? 'twinmg' : (def.ap ?? 0) >= 0.4 ? 'hmg' : 'mg';
    case 'autocannon': return def.spinUp || v === 'gatling' ? 'gatling' : 'ac';
    case 'cannon': return v === 'gauss' ? 'gauss' : def.impulse && (def.splash ?? 0) >= 1 ? 'he' : 'apc';
    case 'precision': return pk === 'rail' ? 'rail' : 'sniper';
    case 'rocket': return def.burn ? 'incend' : 'rocket';
    case 'missile': return v === 'cruise' || (def.splash ?? 0) >= 2 ? 'bigMissile' : 'missile';
    case 'artillery': return def.requires === 'air' ? 'bomb' : v === 'mortar' ? (def.mount === 'S' ? 'grenade' : 'mortar') : 'howitzer';
    case 'antiair': return 'flak';
    case 'flame': return 'flame';
    default: break;
  }
  if (pk === 'orb') return v === 'emp' ? 'empOrb' : v === 'sonic' ? 'sonic' : 'plasmaOrb';
  if (pk === 'lightning') return 'chain';
  if (def.ramp) return 'focus';
  if (def.disarm) return 'disarm';
  if (def.slow || v === 'slowbeam') return 'slow';
  if (v === 'gravity') return 'gravity';
  if (v === 'heatray') return 'heatray';
  if (v === 'plasma') return 'plasma';
  if (v === 'rail' || v === 'gauss') return 'rail';
  if (pk === 'beam') return 'laser';
  return 'other';
}

const MUZZLE: Partial<Record<Fam, MuzzleKind>> = {
  mg: 'gun', twinmg: 'gun', hmg: 'gun', gatling: 'gatling', shotgun: 'blast', flechette: 'darts', ac: 'ac', apc: 'cannon', he: 'he',
  gauss: 'gauss', sniper: 'sniper', rocket: 'rocket', incend: 'rocket', missile: 'missile', bigMissile: 'missile', grenade: 'mortar',
  mortar: 'mortar', firebomb: 'mortar', howitzer: 'cannon', cluster: 'cannon', flak: 'flak', other: 'gun',
};

const STYLES = new Map<string, WStyle>();
function styleOf(id: string): WStyle {
  let st = STYLES.get(id);
  if (!st) {
    const def = MODULE_BY_ID.get(id);
    const fam = famOf(def);
    const s = (CLASS_S[def?.mount ?? 'M'] ?? 0.5) * (0.75 + 0.5 * (def?.caliber ?? 0.5));
    st = { fam, s, def, muzzle: MUZZLE[fam] ?? null };
    STYLES.set(id, st);
  }
  return st;
}
/** families whose beam / bolt event draws its own impact (their 'hit' only flares a shield) */
const SELF_IMPACT = new Set<Fam>(['laser', 'focus', 'heatray', 'slow', 'disarm', 'gravity', 'heal', 'pd']);

const _v3 = new THREE.Vector3();
const _col = new THREE.Color();
const _c2 = new THREE.Color();

/** Terrain generation is a ~1 s CPU job (fbm per pixel), so built maps are cached and shared across views (menu backdrop, match, ...). */
interface BuiltTerrain { group: THREE.Group; ground: THREE.Mesh; tint: THREE.Color }
const terrainCache = new Map<string, BuiltTerrain>();
function terrainFor(map: MapTheme): BuiltTerrain {
  let t = terrainCache.get(map.id);
  if (t) { terrainCache.delete(map.id); terrainCache.set(map.id, t); return t; }
  const b = buildTerrain(FIELD_H, FIELD_W, { seed: map.seed * 13 + 5, ppc: 14, grid: true, zoneFrac: DEPLOY_D / FIELD_H, props: false });
  // restyle per map: multiply the sandy base by the 2D theme's mid ramp colour (relative to the base's own tone)
  const c1 = new THREE.Color().setRGB(map.ramp[1][0] / 255, map.ramp[1][1] / 255, map.ramp[1][2] / 255, THREE.SRGBColorSpace);
  const ref = new THREE.Color().setRGB(120 / 255, 108 / 255, 84 / 255, THREE.SRGBColorSpace);
  const tint = new THREE.Color(clamp(c1.r / ref.r, 0.35, 2), clamp(c1.g / ref.g, 0.35, 2), clamp(c1.b / ref.b, 0.35, 2));
  b.group.children.forEach((o, i) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m?.color) m.color.copy(tint).multiplyScalar(i === 0 ? 1 : 0.8);
  });
  t = { group: b.group, ground: b.ground, tint };
  terrainCache.set(map.id, t);
  // keep the two most recent maps; older ones free their textures
  while (terrainCache.size > 2) {
    const [k, old] = terrainCache.entries().next().value as [string, BuiltTerrain];
    terrainCache.delete(k);
    old.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.MeshStandardMaterial | undefined;
      if (mat) { mat.map?.dispose(); mat.bumpMap?.dispose(); mat.dispose(); }
    });
  }
  return t;
}

export class FieldView3D implements BattleView {
  readonly canvas: HTMLCanvasElement;
  viewerSide: Side;
  muted = false;
  shakeScale = 1;
  flashScale = 1;
  alwaysShowHealth = false;
  readonly cam = new Camera(FIELD_W, FIELD_H);
  readonly controls: CameraControls;
  private tiltOn = true;
  private cssW = 300;
  private cssH = 400;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 100, 800);
  private stage: Stage;
  private sun: THREE.DirectionalLight;
  private post: Post;
  private map: MapTheme = MAPS[0];
  private terrain: { group: THREE.Group; ground: THREE.Mesh } | null = null;
  private rocks: THREE.Object3D[] = [];
  private myZone: THREE.Mesh;
  private foeZone: THREE.Mesh;
  private grid: THREE.LineSegments;
  private hoverFill: THREE.Mesh;
  private hoverLine: THREE.LineLoop;
  private selLines: THREE.LineLoop[] = [];
  private layer = new UnitLayer();
  private fx = new Fx3D();
  private shields = new ShieldPool();
  private ui = new Overlay();
  private fxRoot = new THREE.Group();
  // live instances
  private deployUsed: Rig[] = [];
  private bu = new Map<number, UView>();
  private wrecks: Wreck[] = [];
  // battle state
  private battle: Battle | null = null;
  private lastTick = -1;
  private sinceTick = 0;
  /** render clock (in ticks), same scheme as the 2D view: advances at the observed tick rate, eased toward one tick
   *  behind the estimated sim time and clamped to the snapshot pair it interpolates (prevTick..curTick), so units move
   *  by the same amount every frame at any speed and uneven ticks per frame don't judder */
  private rt = 0;
  private tickRate = 1 / DT;
  private prevTick = 0;
  private curTick = 0;
  private rateWin = { n: 0, t: 0 };
  private alpha = 1;
  private prevU = new Map<number, Snap>();
  private curU = new Map<number, Snap>();
  private prevP = new Map<number, PSnap>();
  private curP = new Map<number, PSnap>();
  private projRec = new Map<number, ProjRec>();
  private pending: BattleEvent[] = [];
  private usePush = false;
  private time = 0;
  private altHeld = false;
  private hitBudget = 0;
  /** where the beam / arc that just struck a unit came from, and the last blast (this event batch): hits the sim reports
   *  at a unit's centre (beams, arcs, splash) are moved out to the side facing them */
  private shotFrom = new Map<number, { x: number; y: number }>();
  private lastBlast: { x: number; y: number; r: number } | null = null;
  /** rotary guns (ModuleDef.spinUp): spin estimate per unit * 16 + mount, rebuilt from the fire cadence */
  private spin = new Map<number, { k: number; t: number }>();
  /** focusing beams (ModuleDef.ramp): time on the current target per unit * 16 + mount */
  private ramp = new Map<number, { start: number; last: number; x: number; y: number }>();
  /** where cluster shells just burst (their bomblets are drawn as bomblets) */
  private clusterPts: { x: number; y: number; t: number }[] = [];
  // quality
  /** 'auto' scales AO / bloom / shadows / resolution from frame time; a number pins the level (0 best) */
  quality: 'auto' | 0 | 1 | 2 | 3 = 'auto';
  private level = 0;
  private ema = 16;
  private lastRender = 0;
  private slowT = 0;
  private fastT = 0;
  private dprNow = 1;
  private lastUnits = 0;
  private lastShadowKey = '';
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private onBlur: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, viewerSide: Side, opts?: { interactive?: boolean }) {
    this.canvas = canvas;
    this.viewerSide = viewerSide;
    const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('r3dq');
    if (q === 'high') this.quality = 0; else if (q === 'low') this.quality = 3; else if (q && /^[0-3]$/.test(q)) this.quality = Number(q) as 0 | 1 | 2 | 3;
    this.renderer = createRenderer(canvas);
    this.renderer.info.autoReset = false;
    this.dprNow = this.dprFor(0);
    this.renderer.setPixelRatio(this.dprNow);
    this.controls = new CameraControls(this.cam, canvas, opts?.interactive !== false);
    this.cam.setAspect(this.ay);
    try { setPanFlip(viewerSide === 1); } catch { /* audio optional */ }

    this.stage = setupStage(this.renderer, this.scene, { fog: false, shadowRes: 2048 });
    this.sun = this.stage.sun;
    this.post = setupPost(this.renderer, this.scene, this.camera, 512, 512, { ao: true, bloom: true, grade: true });
    // AO must not treat billboards / beams / bubbles as geometry: hide the fx root during its normal pass
    const g = this.post.gtao as unknown as { _overrideVisibility?: () => void; _visibilityCache?: THREE.Object3D[] } | null;
    if (g && typeof g._overrideVisibility === 'function' && Array.isArray(g._visibilityCache)) {
      const orig = g._overrideVisibility.bind(g);
      g._overrideVisibility = () => {
        orig();
        if (this.fxRoot.visible) { this.fxRoot.visible = false; g._visibilityCache!.push(this.fxRoot); }
      };
    }

    const flat = (w: number, h: number, color: string, opacity: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.renderOrder = 2;
      return m;
    };
    const myTop = viewerSide === 0 ? FIELD_H - DEPLOY_D : 0;
    const enTop = viewerSide === 0 ? 0 : FIELD_H - DEPLOY_D;
    this.myZone = flat(FIELD_W, DEPLOY_D, TEAM_PAL[0].rim, 0);
    this.myZone.position.set(FIELD_W / 2, 0.03, myTop + DEPLOY_D / 2);
    this.foeZone = flat(FIELD_W, DEPLOY_D, TEAM_PAL[1].rim, 0.0);
    this.foeZone.position.set(FIELD_W / 2, 0.03, enTop + DEPLOY_D / 2);
    this.scene.add(this.myZone, this.foeZone);
    // zone front lines
    const line = (z: number, color: string) => {
      const l = flat(FIELD_W, 0.12, color, 0.6);
      l.position.set(FIELD_W / 2, 0.04, z);
      this.scene.add(l);
    };
    line(viewerSide === 0 ? myTop : myTop + DEPLOY_D, TEAM_PAL[0].rim);
    line(viewerSide === 0 ? enTop + DEPLOY_D : enTop, TEAM_PAL[1].rim);
    // placement grid over the viewer's zone
    const pts: number[] = [];
    for (let x = 0; x <= FIELD_W; x++) pts.push(x, 0.05, myTop, x, 0.05, myTop + DEPLOY_D);
    for (let y = 0; y <= DEPLOY_D; y++) pts.push(0, 0.05, myTop + y, FIELD_W, 0.05, myTop + y);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: TEAM_PAL[0].accent, transparent: true, opacity: 0.2, depthWrite: false }));
    this.grid.visible = false;
    this.scene.add(this.grid);
    this.hoverFill = flat(1, 1, '#46e88a', 0.3);
    this.hoverFill.visible = false;
    this.hoverLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, z]) => new THREE.Vector3(x, 0.06, z))), new THREE.LineBasicMaterial({ color: '#46e88a', depthTest: false, transparent: true }));
    // a block's footprint is about the size of its hull: draw the outline over the models or it hides under them
    this.hoverLine.renderOrder = 3;
    this.hoverLine.visible = false;
    this.scene.add(this.hoverFill, this.hoverLine);

    this.fxRoot.add(this.fx.group, this.shields.group);
    this.scene.add(this.layer.group, this.fxRoot);

    this.setMapNow(this.map);
    this.resize();

    // Alt shows every health bar (same as the 2D view)
    if (typeof window !== 'undefined') {
      this.onKey = (e) => { if (e.key === 'Alt') { this.altHeld = e.type === 'keydown' && this.controls.enabled; if (e.type === 'keydown') e.preventDefault(); } };
      this.onBlur = () => { this.altHeld = false; };
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('keyup', this.onKey);
      window.addEventListener('blur', this.onBlur);
    }
  }

  /* ------------------------------------------------------------------------------------------ settings */

  get ay(): number { return this.tiltOn ? Math.sin(ELEV) : 1; }
  get tilted(): boolean { return this.tiltOn; }
  setTilt(on: boolean): void {
    if (on === this.tiltOn) return;
    this.tiltOn = on;
    this.cam.setAspect(this.ay);
  }
  get mapTheme(): MapTheme { return this.map; }
  setMap(map: MapTheme): void {
    if (map.id !== this.map.id) this.setMapNow(map);
  }

  /** Terrain from proto3d, restyled per map: seed + a colour tint from the 2D theme ramp, map void as the background. */
  private setMapNow(map: MapTheme): void {
    this.map = map;
    if (this.terrain) this.scene.remove(this.terrain.group);
    for (const r of this.rocks) { this.scene.remove(r); (r as THREE.InstancedMesh).geometry.dispose(); }
    this.rocks = [];
    const built = terrainFor(map);
    // the cached build is shared between views (textures live as long as the cache entry): each view gets a cheap clone
    const group = built.group.clone(true);
    // terrain is authored with deployment zones at its local +-x ends; our zones run along field y, so turn it a quarter
    // and put team 0 (the viewer's colour) at the viewer's end.
    group.rotation.y = this.viewerSide === 0 ? Math.PI / 2 : -Math.PI / 2;
    group.position.set(FIELD_W / 2, 0, FIELD_H / 2);
    this.scene.add(group);
    this.terrain = { group, ground: built.ground };
    this.scatterRocks(map, built.tint);
    this.scene.background = new THREE.Color(map.void);
    this.fx.setGround([clamp(map.ramp[1][0] / 255 * 0.9, 0, 1), clamp(map.ramp[1][1] / 255 * 0.9, 0, 1), clamp(map.ramp[1][2] / 255 * 0.9, 0, 1)]);
  }

  /** boulders around the field edge and pebbles on it (cheap instanced noise-icosahedra; tinted from the map) */
  private scatterRocks(map: MapTheme, tint: THREE.Color): void {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const pos = geo.getAttribute('position');
    const seen = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) {
      const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      let j = seen.get(k);
      if (j === undefined) { j = 0.78 + Math.random() * 0.4; seen.set(k, j); }
      pos.setXYZ(i, pos.getX(i) * j, pos.getY(i) * j * 0.7, pos.getZ(i) * j);
    }
    geo.computeVertexNormals();
    let s = map.seed * 7919 + 3;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0, envMapIntensity: 0.7 });
    const base = new THREE.Color().setRGB(map.ramp[2][0] / 255, map.ramp[2][1] / 255, map.ramp[2][2] / 255, THREE.SRGBColorSpace).multiplyScalar(0.55);
    void tint;
    const mk = (n: number, place: (m: THREE.Matrix4) => boolean, cast: boolean): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(geo, mat, n);
      const m = new THREE.Matrix4(), col = new THREE.Color();
      let k = 0;
      for (let i = 0; i < n; i++) if (place(m)) { im.setMatrixAt(k, m); im.setColorAt(k, col.copy(base).multiplyScalar(0.7 + rnd() * 0.6)); k++; }
      im.count = k; im.castShadow = cast; im.receiveShadow = true;
      this.scene.add(im);
      this.rocks.push(im);
      return im;
    };
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    mk(70, (m) => {
      // ring just outside the field
      const side = rnd();
      let x: number, z: number;
      if (side < 0.5) { x = rnd() < 0.5 ? -1 - rnd() * 14 : FIELD_W + 1 + rnd() * 14; z = rnd() * FIELD_H; }
      else { x = rnd() * FIELD_W; z = rnd() < 0.5 ? -1 - rnd() * 14 : FIELD_H + 1 + rnd() * 14; }
      const sc = 0.25 + rnd() * rnd() * 1.6;
      e.set(rnd() * 0.4, rnd() * 7, rnd() * 0.4); q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, sc * 0.2, z), q, new THREE.Vector3(sc * (1 + rnd() * 0.6), sc * (0.8 + rnd() * 0.5), sc * (1 + rnd() * 0.6)));
      return true;
    }, true);
    mk(380, (m) => {
      const x = rnd() * FIELD_W, z = rnd() * FIELD_H, sc = 0.03 + rnd() * 0.07;
      e.set(0, rnd() * 7, 0); q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, sc * 0.15, z), q, new THREE.Vector3(sc * (1 + rnd()), sc, sc * (1 + rnd())));
      return true;
    }, false);
  }

  /* ---------------------------------------------------------------------------------------------- camera */

  private dprFor(level: number): number {
    const d = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    return Math.min(level >= 2 ? 1 : 1.5, d);
  }

  resize(): void {
    const cw = this.canvas.clientWidth || 300, ch = this.canvas.clientHeight || 400;
    this.cssW = cw; this.cssH = ch;
    this.renderer.setPixelRatio(this.dprNow);
    this.renderer.setSize(cw, ch, false);
    this.post.setSize(cw, ch);
    this.cam.setViewport(cw, ch);
  }
  private checkSize(): void {
    if ((this.canvas.clientWidth && this.canvas.clientWidth !== this.cssW) || (this.canvas.clientHeight && this.canvas.clientHeight !== this.cssH)) this.resize();
  }
  private toVisual(x: number, y: number) { return this.viewerSide === 1 ? { x: FIELD_W - x, y: FIELD_H - y } : { x, y }; }
  fit(instant = false): void { this.cam.fit(instant); }
  frameDeploy(instant = false): void {
    this.checkSize();
    const c = this.cam;
    const rows = DEPLOY_D + 6;
    let k = Math.min(c.vw / FIELD_W, c.vh / (rows * c.ay));
    if (c.vw < 640) k = Math.max(k, 11);
    k = Math.max(c.minK, k);
    c.setTarget(FIELD_W / 2, FIELD_H - c.vh / (2 * k * c.ay) + 0.4, k, instant);
  }
  focusOn(x: number, y: number, zoom?: number, instant = false): void {
    const v = this.toVisual(x, y);
    this.cam.setTarget(v.x, v.y, zoom === undefined ? this.cam.tk : this.cam.minK * zoom, instant);
  }
  zoomBy(f: number, sx?: number, sy?: number): void { this.cam.zoomBy(f, sx, sy); }
  consumeDrag(): boolean { return this.controls.consumeDrag(); }
  get wasDrag(): boolean { return this.controls.wasDrag; }

  private get ox(): number { return this.cssW / 2 - this.cam.cx * this.cam.k; }
  private get oy(): number { return this.cssH / 2 - this.cam.cy * this.cam.k * this.ay; }
  worldToScreen(x: number, y: number): { x: number; y: number } {
    const k = this.cam.k, ky = k * this.ay;
    if (this.viewerSide === 1) return { x: this.ox + (FIELD_W - x) * k, y: this.oy + (FIELD_H - y) * ky };
    return { x: this.ox + x * k, y: this.oy + y * ky };
  }
  screenToWorld(px: number, py: number): { x: number; y: number } {
    const wx = (px - this.ox) / this.cam.k, wy = (py - this.oy) / (this.cam.k * this.ay);
    return this.viewerSide === 1 ? { x: FIELD_W - wx, y: FIELD_H - wy } : { x: wx, y: wy };
  }

  /** photosensitivity-safe shake: nothing at the fit view, ramps in when zoomed close, hard-capped (CSS px) */
  private shakeOffset(): { sx: number; sy: number } {
    const tr = this.fx.trauma * this.fx.trauma;
    if (tr <= 0.001 || this.shakeScale <= 0) return { sx: 0, sy: 0 };
    const zf = clamp((this.cam.k / this.cam.minK - 1.6) / 2.4, 0, 1);
    const amp = SHAKE_CAP * Math.min(1, tr) * zf * clamp(this.shakeScale, 0, 1);
    if (amp <= 0.01) return { sx: 0, sy: 0 };
    const t = this.time;
    return {
      sx: (Math.sin(t * 19.5) * 0.6 + Math.sin(t * 29.5 + 1.3) * 0.4) * amp,
      sy: (Math.sin(t * 16.3 + 0.7) * 0.6 + Math.sin(t * 27 + 2.1) * 0.4) * amp,
    };
  }

  /** place the three camera + sun shadow frustum from the Camera state */
  private syncCamera(): void {
    const c = this.cam, k = c.k;
    const t = this.toVisual(c.cx, c.cy); // symmetric: visual centre -> world centre
    const e = this.tiltOn ? ELEV : Math.PI / 2;
    const s = this.viewerSide === 1 ? -1 : 1;
    const D = 400;
    const sh = this.shakeOffset();
    this.camera.position.set(t.x, D * Math.sin(e), t.y + s * D * Math.cos(e));
    this.camera.up.set(0, 0, -s);
    this.camera.lookAt(t.x, 0, t.y);
    this.camera.left = -this.cssW / (2 * k); this.camera.right = this.cssW / (2 * k);
    this.camera.top = this.cssH / (2 * k); this.camera.bottom = -this.cssH / (2 * k);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    if (sh.sx || sh.sy) {
      const me = this.camera.matrixWorld.elements;
      this.camera.position.x += (me[0] * sh.sx + me[4] * sh.sy) / k;
      this.camera.position.y += (me[1] * sh.sx + me[5] * sh.sy) / k;
      this.camera.position.z += (me[2] * sh.sx + me[6] * sh.sy) / k;
      this.camera.updateMatrixWorld();
    }
    // shadow frustum follows the visible ground (snapped so shadows don't shimmer as the camera glides)
    const hw = this.cssW / (2 * k), hh = this.cssH / (2 * k * this.ay);
    const radius = clamp(Math.ceil(Math.hypot(hw, hh) * 1.08 / 4) * 4, 16, 72);
    const cx = Math.round(t.x * 2) / 2, cz = Math.round(t.y * 2) / 2;
    const key = `${cx},${cz},${radius},${s}`;
    if (key !== this.lastShadowKey) {
      this.lastShadowKey = key;
      this.stage.fitShadow(cx, cz, radius);
      // keep the light up-left on screen whichever way the camera faces
      this.sun.position.set(cx - s * 30, 40, cz + s * 20);
      this.sun.target.updateMatrixWorld();
    }
  }

  /* ------------------------------------------------------------------------------------------ quality / render */

  /** Frame-time driven level: 0 = AO + bloom + shadows, 1 = no AO, 2 = no bloom + 1x pixels, 3 = no shadows + direct render. */
  private updateQuality(units: number, load: number): { ao: boolean; bloom: boolean; shadow: boolean; direct: boolean } {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dtMs = this.lastRender ? now - this.lastRender : 16;
    this.lastRender = now;
    // gaps over a second are stalls / background tabs; anything shorter is a real (maybe very slow) frame and must count,
    // or a GPU that only manages a few fps would never step the quality down
    if (dtMs < 1000) this.ema += (Math.min(dtMs, 150) - this.ema) * 0.08;
    if (this.quality === 'auto') {
      if (this.ema > 26) { this.slowT += dtMs; this.fastT = 0; } else if (this.ema < 15) { this.fastT += dtMs; this.slowT = 0; } else { this.slowT = this.fastT = 0; }
      if (this.slowT > 1500 && this.level < 3) { this.level++; this.slowT = 0; this.ema = 16; }
      else if (this.fastT > 9000 && this.level > 0) { this.level--; this.fastT = 0; }
    } else this.level = this.quality;
    const L = this.level;
    const dpr = this.dprFor(L);
    if (dpr !== this.dprNow) { this.dprNow = dpr; this.resize(); }
    // AO only pays off when zoomed in and the scene is light
    const aoZoom = this.cam.k >= 9;
    const ao = L === 0 && aoZoom && load <= 120;
    this.fx.lod = L >= 2 ? 0.5 : units > 160 ? 0.6 : 1;
    // very crowded zoomed-out views drop unit shadows first (they double the triangle load); wrecks are full hulls too,
    // so they count, or shadows switch back on mid-battle as units die and the triangle load doubles
    const shadow = L <= 2 && !(load > 250 && this.cam.k < 12);
    return { ao, bloom: L <= 1, shadow, direct: L >= 3 };
  }

  private render(units: number): void {
    this.lastUnits = units;
    this.layer.flush();
    const q = this.updateQuality(units, units + this.wrecks.length);
    this.syncCamera();
    this.sun.castShadow = q.shadow;
    this.renderer.shadowMap.enabled = q.shadow;
    const hdr = lerp(0.35, 1, clamp(this.flashScale, 0, 1));
    this.fx.hdr = hdr;
    this.renderer.toneMappingExposure = 1 + this.fx.flashA * 0.5 * clamp(this.flashScale, 0, 1);
    this.renderer.info.reset();
    if (q.direct) this.renderer.render(this.scene, this.camera);
    else {
      if (this.post.gtao) this.post.gtao.enabled = q.ao;
      if (this.post.bloom) { this.post.bloom.enabled = q.bloom; this.post.bloom.strength = 0.2 + 0.14 * clamp(this.flashScale, 0, 1); }
      this.post.render();
    }
    // overlay on top of the finished frame (exact colours, no tone mapping)
    const r = this.renderer, ac = r.autoClear;
    r.autoClear = false;
    r.clearDepth();
    r.render(this.ui.scene, this.camera);
    r.autoClear = ac;
  }

  /** diagnostics for the last frame (all passes: shadow, AO normals, main, bloom, output, overlay) */
  get stats() {
    const i = this.renderer.info;
    return {
      calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures,
      units: this.lastUnits, particles: this.fx.particleCount, level: this.level, frameMs: this.ema, templates: this.layer.stats.templates,
      instancedMeshes: this.layer.liveMeshes, overlayQuads: this.ui.quads,
    };
  }

  /* ------------------------------------------------------------------------------------------- unit pool */

  private teamOf(side: Side): 0 | 1 { return side === this.viewerSide ? 0 : 1; }
  private clearBattle(): void {
    for (const v of this.bu.values()) this.layer.release(v.rig);
    this.bu.clear();
    for (const w of this.wrecks) this.layer.release(w.rig);
    this.wrecks = [];
    this.fx.clear();
    this.projRec.clear();
    this.spin.clear(); this.ramp.clear(); this.clusterPts.length = 0;
    this.prevU.clear(); this.curU.clear(); this.prevP.clear(); this.curP.clear();
    this.pending = [];
  }
  private releaseBoard(): void {
    for (const r of this.deployUsed) this.layer.release(r);
    this.deployUsed = [];
  }

  /* ---------------------------------------------------------------------------------------------- board */

  drawBoard(units: BoardUnit[], overlay: BoardOverlay, time: number): void {
    this.checkSize();
    const dt = this.time ? clamp(time - this.time, 0, 0.1) : 0;
    this.time = time;
    if (this.battle) { this.battle = null; this.lastTick = -1; this.clearBattle(); }
    this.cam.update(dt);
    this.fx.update(dt);
    this.fx.trauma = Math.max(0, this.fx.trauma - dt * 1.6);
    this.fx.flashA = Math.max(0, this.fx.flashA - dt * 3);
    (this.myZone.material as THREE.MeshBasicMaterial).opacity = overlay.showZone ? 0.055 : 0;
    this.grid.visible = !!overlay.showZone;
    const hv = overlay.hover;
    this.hoverFill.visible = this.hoverLine.visible = !!hv;
    if (hv) {
      const col = hv.valid ? '#46e88a' : '#ff4a4a';
      const w = hv.w ?? hv.size, h = hv.h ?? hv.size;
      (this.hoverFill.material as THREE.MeshBasicMaterial).color.set(col);
      (this.hoverFill.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.07 * Math.sin(time * 6);
      (this.hoverLine.material as THREE.LineBasicMaterial).color.set(col);
      this.hoverFill.scale.set(w, 1, h);
      this.hoverFill.position.set(hv.col + w / 2, 0.05, hv.row + h / 2);
      this.hoverLine.scale.set(w, 1, h);
      this.hoverLine.position.set(hv.col, 0, hv.row);
    }
    this.releaseBoard();
    this.syncCamera();
    this.ui.begin(this.camera, this.cam.k);
    this.shields.begin();
    let nSel = 0;
    for (const u of units) {
      const team = this.teamOf(u.side);
      const rig = this.layer.acquire(u.design, team);
      this.deployUsed.push(rig);
      const ang = u.side === 0 ? -Math.PI / 2 : Math.PI / 2;
      rig.root.position.set(u.x, rig.flying ? flyHeight(rig.S) + 0.4 : 0, u.y);
      rig.root.rotation.y = -ang;
      if (rig.flying && !u.ghost) rig.locomote(0, false, time + u.x * 0.37, dt);
      rig.update(dt);
      const look: Look = u.invalid ? 'invalid' : u.ghost ? 'ghost' : u.dim ? 'cloak' : 'normal';
      rig.look = look;
      this.layer.submit(rig, look);
      if (u.selected) this.selectionRing(nSel++, u.x, u.y, rig, ang, time);
      if (u.level > 1 && !u.ghost) this.drawPips(u.x, u.y, rig, ang, u.level, 1);
    }
    this.shields.end();
    this.ui.end();
    this.hideSelRings(nSel);
    this.syncProjectiles([]);
    this.render(units.length);
  }

  private selectionRing(i: number, x: number, y: number, rig: Rig, ang: number, time: number): void {
    let l = this.selLines[i];
    if (!l) {
      l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(a, 0.07, b))), new THREE.LineBasicMaterial({ color: TEAM_PAL[0].accent, transparent: true }));
      this.selLines[i] = l;
      this.scene.add(l);
    }
    l.visible = true;
    l.position.set(x, 0, y);
    l.rotation.y = -ang;
    l.scale.set(rig.L * 0.5 + 0.12, 1, rig.W * 0.5 + 0.12);
    (l.material as THREE.LineBasicMaterial).opacity = 0.6 + 0.3 * Math.sin(time * 5);
  }
  private hideSelRings(from: number): void { for (let i = from; i < this.selLines.length; i++) this.selLines[i].visible = false; }

  /* --------------------------------------------------------------------------------------------- battle */

  pushEvents(events: BattleEvent[]): void {
    this.usePush = true;
    for (const e of events) this.pending.push(e);
    if (this.pending.length > 6000) this.pending.splice(0, this.pending.length - 6000);
  }

  private reset(b: Battle): void {
    // events pushed for this battle before its first draw (match.ts steps, pushes, then draws) belong to it
    const pending = this.pending;
    this.clearBattle();
    this.pending = pending;
    this.battle = b;
    this.lastTick = -1;
    this.sinceTick = 0;
    this.rt = this.prevTick = this.curTick = 0;
    this.rateWin.n = this.rateWin.t = 0;
    this.grid.visible = false;
    (this.myZone.material as THREE.MeshBasicMaterial).opacity = 0;
    this.hoverFill.visible = this.hoverLine.visible = false;
    this.hideSelRings(0);
    this.releaseBoard();
  }

  drawBattle(battle: Battle, frameDt: number): void {
    this.checkSize();
    const dt = clamp(frameDt, 0, 0.1);
    this._lastFrameDt = dt || 1 / 60;
    this.time += dt;
    if (battle !== this.battle || battle.tick < this.lastTick) this.reset(battle);
    let newTicks: BattleEvent[] | null = null;
    // a big jump (SKIP to the end) is shown as-is: units that died unseen leave their hulks like the 2D view
    let jump = false;
    const newTick = battle.tick !== this.lastTick;
    if (newTick) {
      const n = battle.tick - this.lastTick;
      jump = this.lastTick >= 0 && n > 40;
      // ticks per second as observed by this view (speed x frame pacing), measured over >= 0.2 s windows; the time since
      // the previous snapshot includes this frame; long gaps (pause, background tab) say nothing about the rate
      const span = this.sinceTick + dt;
      if (this.lastTick < 0 || jump || span >= 0.4) this.rateWin.n = this.rateWin.t = 0;
      else if (span >= 0.05 && (n / span > this.tickRate * 1.7 || n / span < this.tickRate * 0.6)) {
        this.tickRate = clamp(n / span, 1, 600);
        this.rateWin.n = this.rateWin.t = 0;
      } else {
        this.rateWin.n += n;
        this.rateWin.t += span;
        const r = this.rateWin.n / this.rateWin.t;
        const changed = this.rateWin.t >= 0.05 && (r > this.tickRate * 1.7 || r < this.tickRate * 0.6);
        if (this.rateWin.t >= 0.2 || changed) {
          this.tickRate = clamp(changed ? r : lerp(this.tickRate, r, 0.6), 1, 600);
          this.rateWin.n = this.rateWin.t = 0;
        }
      }
      const snapJump = this.lastTick < 0 || jump;
      this.prevTick = snapJump ? battle.tick : this.curTick;
      this.curTick = battle.tick;
      if (snapJump) this.rt = battle.tick;
      this.prevU = this.curU; this.curU = new Map();
      for (const u of battle.units) if (u.alive) this.curU.set(u.id, { x: u.x, y: u.y, angle: u.angle, mounts: u.mounts.map((m) => m.angle) });
      if (snapJump) this.prevU = new Map(this.curU);
      this.prevP = this.curP; this.curP = new Map();
      for (const p of battle.projectiles) this.curP.set(p.id, { x: p.x, y: p.y, z: p.z, angle: p.angle, progress: p.progress });
      if (snapJump) this.prevP = new Map(this.curP);
      this.lastTick = battle.tick;
      this.sinceTick = 0;
      if (!this.usePush) newTicks = battle.events;
    } else this.sinceTick += dt;
    const target = this.curTick + this.sinceTick * this.tickRate - 1;
    this.rt += dt * this.tickRate;
    this.rt += (target - this.rt) * 0.05;
    this.rt = clamp(this.rt, this.prevTick, this.curTick);
    this.alpha = this.curTick > this.prevTick ? (this.rt - this.prevTick) / (this.curTick - this.prevTick) : 1;

    const byId = new Map<number, SimUnit>();
    for (const u of battle.units) byId.set(u.id, u);
    for (const u of battle.units) {
      if (!u.alive) continue;
      if (!this.bu.has(u.id)) this.bu.set(u.id, { rig: this.layer.acquire(u.design, this.teamOf(u.side)), lx: u.x, ly: u.y, seen: false, dmgT: -99, healT: -99, hpLast: u.hp, shLast: u.shield, hpShown: u.hp, shT: -99, hx: 0, hy: 0, hz: 0, hits: 0, posed: false });
    }
    this.hitBudget = 60;
    const events = newTicks ?? this.pending;
    if (events.length) {
      for (const e of events) this.handleEvent(e, byId);
      this.shotFrom.clear(); this.lastBlast = null;
      if (!this.muted) try { battleSfx(events); } catch { /* audio optional */ }
      if (!newTicks) this.pending = [];
    }
    this.cam.update(dt);
    this.syncCamera();
    this.ui.begin(this.camera, this.cam.k);
    this.shields.begin();

    // units
    let alive = 0;
    for (const u of battle.units) {
      if (!u.alive) {
        const v = this.bu.get(u.id);
        if (v && jump && !u.flying) this.toWreck(u.id, v, u.x, u.y, u.angle, 0);
        else if (v) { this.layer.release(v.rig); this.bu.delete(u.id); }
        continue;
      }
      alive++;
      const v = this.bu.get(u.id)!;
      this.poseUnit(u, v, dt);
    }
    this.syncWrecks(dt);
    this.syncProjectiles(battle.projectiles, byId);
    this.shields.end();
    this.ui.end();
    this.fx.update(dt);
    this.fx.trauma = Math.max(0, this.fx.trauma - dt * 1.6);
    this.fx.flashA = Math.max(0, this.fx.flashA - dt * 3);
    this.render(alive);
  }

  /** true if a ground point is far enough outside the viewport that nothing of a unit there can be seen */
  private offscreen(x: number, y: number, margin: number): boolean {
    const p = this.worldToScreen(x, y), m = margin * this.cam.k;
    return p.x < -m || p.x > this.cssW + m || p.y < -m * this.ay - 60 || p.y > this.cssH + m * this.ay + 60;
  }

  private poseUnit(u: SimUnit, v: UView, dt: number): void {
    const rig = v.rig;
    const a = this.alpha;
    const c = this.curU.get(u.id), pr = this.prevU.get(u.id) ?? c;
    let x = u.x, y = u.y, ang = u.angle;
    let mounts = u.mounts.map((m) => m.angle);
    if (c && pr) {
      x = lerp(pr.x, c.x, a); y = lerp(pr.y, c.y, a);
      if (Math.hypot(c.x - pr.x, c.y - pr.y) > 3) { x = c.x; y = c.y; }
      ang = lerpAngle(pr.angle, c.angle, a);
      mounts = u.mounts.map((m, i) => lerpAngle(pr.mounts[i] ?? m.angle, c.mounts[i] ?? m.angle, a));
    }
    const ext = u as SimUnit & { cloaked?: boolean };
    const enemyCloak = !!ext.cloaked && u.side !== this.viewerSide;
    const dist = v.seen ? Math.min(2, Math.hypot(x - v.lx, y - v.ly)) : 0;
    v.lx = x; v.ly = y; v.seen = true;
    this.trackVis(u, v);
    v.posed = false;
    if (enemyCloak || this.offscreen(x, y, rig.radius + 5)) return;
    const h = u.flying ? flyHeight(rig.S) + 0.4 + Math.sin(this.time * 2.1 + u.id) * 0.05 : u.leap * 1.8 * rig.S;
    rig.root.position.set(x, h, y);
    rig.root.rotation.y = -ang;
    rig.locomote(dist, u.moving, this.time + u.id * 0.37, dt);
    for (let i = 0; i < u.mounts.length; i++) rig.aim(i, normAng(mounts[i] - ang), dt);

    // status tint: hit flash, burning flicker, stun crackle
    let tr = 1, tg = 1, tb = 1;
    if (u.hitFlash > 0.02) { const f = u.hitFlash; tr += f * 1.7; tg += f * 1.3; tb += f * 0.9; }
    if (u.burning > 0) { const f = 0.12 + 0.1 * Math.sin(this.time * 17 + u.id); tr += f * 2; tg += f * 0.6; }
    if (u.stun > 0) { const f = 0.5 + 0.5 * Math.sin(this.time * 43 + u.id * 2.1); tr += f * 0.3; tg += f * 0.9; tb += f * 1.8; }
    // slowed: frosted over (cold blue-white); disarmed: a slow amber warning pulse
    const sk = u.slow > 0.02 ? clamp(u.slow / 0.6, 0.25, 1) : 0;
    if (sk) { tr *= 1 - 0.25 * sk; tg *= 1 + 0.05 * sk; tb += 0.7 * sk; }
    if (u.disarm > 0) { const f = 0.5 + 0.5 * Math.sin(this.time * 9 + u.id); tr += f * 0.45; tg += f * 0.28; }
    rig.tr = tr; rig.tg = tg; rig.tb = tb;
    rig.update(dt);
    v.posed = true;
    this.layer.submit(rig, ext.cloaked ? 'cloak' : 'normal');

    // status effects
    const S = rig.S;
    if (u.burning > 0) {
      // licking flames over the whole hull (rate scales with its footprint), lit from within by a flickering glow
      const hx = rig.L * 0.42, hz = rig.W * 0.42, ca = Math.cos(ang), sa = Math.sin(ang);
      let acc = dt * (8 + 12 * rig.L * rig.W) * Math.max(0.5, this.fx.lod);
      while (acc > 0) {
        if (acc < 1 && Math.random() > acc) break;
        acc--;
        // a random point on the rotated footprint
        const lx = (Math.random() * 2 - 1) * hx, lz = (Math.random() * 2 - 1) * hz;
        this.fx.burning(x + lx * ca - lz * sa, h + rig.height * (0.45 + 0.45 * Math.random()), y + lx * sa + lz * ca, 0.05 + rig.L * 0.08, 0.05 + rig.W * 0.08);
      }
      if (Math.random() < dt * 8) this.fx.glow(x, h + rig.height * 0.7, y, 0.6 + Math.max(rig.L, rig.W) * 0.7, 0.18, RAMPS.fire);
    }
    if (u.stun > 0 && Math.random() < dt * 5) this.fx.arcs(x, h + rig.height * 0.55, y, rig.L * 0.42, rig.W * 0.42);
    else if (u.para > 0 && Math.random() < dt * 8 * clamp(u.para / u.maxHp, 0.1, 1)) this.fx.paraSpark(x, h + rig.height * 0.6, y, rig.L * 0.4, rig.W * 0.4);
    if (sk && Math.random() < dt * (4 + 8 * sk) * (0.6 + 0.2 * S) * this.fx.lod) this.fx.frost(x, h + rig.height * 0.75, y, rig.L * 0.45, rig.W * 0.45, sk);
    if (u.disarm > 0 && Math.random() < dt * 7 * this.fx.lod) {
      const i = Math.floor(Math.random() * u.mounts.length);
      const m = u.mounts[i]?.moduleId ? rig.muzzleWorld(i, _v3) : null;
      if (m) this.fx.jam(m.x, m.y, m.z); else this.fx.jam(x, h + rig.height * 0.8, y);
    }
    this.heat(u, rig);

    this.drawShield(u, v, x, h, y);
    this.drawBars(u, v, x, h, y, ang, dt);
  }

  /** rotary guns that have been firing glow at the muzzle, brighter the further they have spun up */
  private heat(u: SimUnit, rig: Rig): void {
    if (!this.spin.size) return;
    const now = this.curTick * DT;
    for (let i = 0; i < u.mounts.length; i++) {
      const sp = this.spin.get(u.id * 16 + i);
      if (!sp || sp.k < 0.15) continue;
      const since = now - sp.t;
      if (since > 1.2) continue;
      const m = rig.muzzleWorld(i, _v3);
      if (!m) continue;
      const st = styleOf(u.mounts[i].moduleId ?? '');
      this.fx.heatGlow(m.x, m.y, m.z, st.s, sp.k * (1 - since / 1.2));
    }
  }

  /** a rotary gun fired: advance its spin estimate (sim: +DT / spinUp per tick on target, the same back down off it) */
  private spinShot(unit: number, mount: number, su: number): number {
    const key = unit * 16 + mount, now = this.curTick * DT;
    let sp = this.spin.get(key);
    if (!sp) { sp = { k: 0, t: now }; this.spin.set(key, sp); }
    const gap = now - sp.t;
    sp.k = gap > 0.45 ? Math.max(0, sp.k - gap / su) : Math.min(1, sp.k + gap / su);
    sp.t = now;
    return sp.k;
  }

  /** a focusing beam fired: 0..1 of its build-up on this target (sim: RAMP_TIME 2.5 s, reset by a switch or a 1 s gap) */
  private rampShot(unit: number, mount: number, x: number, y: number): number {
    const key = unit * 16 + mount, now = this.curTick * DT;
    let rp = this.ramp.get(key);
    if (!rp) { rp = { start: now, last: now, x, y }; this.ramp.set(key, rp); }
    if (now - rp.last > 1 || Math.hypot(x - rp.x, y - rp.y) > 1.6) rp.start = now;
    rp.last = now; rp.x = x; rp.y = y;
    return clamp((now - rp.start) / 2.5, 0, 1);
  }

  /** hp / shield change detection (burn, splash, auras) on top of 'hit' events, for the bar visibility timers */
  private trackVis(u: SimUnit, v: UView): void {
    if (u.hp < v.hpLast - 0.01 || u.shield < v.shLast - 0.01) v.dmgT = this.time;
    else if (u.hp > v.hpLast + 0.5) v.healT = this.time;
    v.hpLast = u.hp; v.shLast = u.shield;
  }

  private drawShield(u: SimUnit, v: UView, x: number, h: number, y: number): void {
    if (u.shield <= 0) return;
    const rig = v.rig;
    const R = Math.max(rig.L, rig.W) * 0.58 + 0.18, Hh = Math.max(0.45, rig.height * 0.85 + 0.12);
    const b = this.shields.next();
    b.mesh.position.set(x, h + Hh * 0.42, y);
    b.mesh.scale.set(R, Hh, R);
    const since = this.time - v.shT;
    const hit = since < 0.55 ? 1 - since / 0.55 : 0;
    const frac = u.maxShield > 0 ? u.shield / u.maxShield : 0.5;
    const un = b.mat.uniforms;
    un.uBase.value = (0.05 + 0.07 * frac) * clamp(0.6 + 0.4 * this.flashScale, 0, 1) + hit * 0.1;
    un.uHit.value = hit;
    un.uAge.value = since < 0.55 ? since / 0.55 : 1;
    un.uTime.value = this.time;
    (un.uHitDir.value as THREE.Vector3).set((v.hx - x) / R, (v.hy - (h + Hh * 0.42)) / Hh, (v.hz - y) / R).normalize();
  }

  /* ----------------------------------------------------------------------------------- bars / meters / pips */

  private barAlpha(v: UView, S: number): number {
    if (this.alwaysShowHealth || this.altHeld) return 1;
    const hold = S >= 4 ? 5 : 3, fade = 0.7;
    const f = (since: number, hd: number) => (since < hd ? 1 : since < hd + fade ? 1 - (since - hd) / fade : 0);
    return Math.max(f(this.time - v.dmgT, hold), f(this.time - v.healT, 1.2));
  }

  /** half height (cells) of the unit's rotated footprint on screen */
  private halfY(rig: Rig, ang: number): number { return (Math.abs(Math.sin(ang)) * rig.L + Math.abs(Math.cos(ang)) * rig.W) / 2; }

  private drawBars(u: SimUnit, v: UView, x: number, h: number, y: number, ang: number, dt: number): void {
    const rig = v.rig, ui = this.ui, k = this.cam.k;
    const S = rig.S;
    v.hpShown = v.hpShown > u.hp ? Math.max(u.hp, v.hpShown - (u.maxHp * 0.6 + (v.hpShown - u.hp) * 3) * dt) : u.hp;
    const hy = this.halfY(rig, ang);
    if (u.level > 1) this.drawPips(x, y, rig, ang, u.level, 0.9, h);
    const slowed = u.slow > 0.02, disarmed = u.disarm > 0;
    const vis = Math.max(this.barAlpha(v, S), u.para > 0 || slowed || disarmed ? 1 : 0);
    if (vis <= 0.01) return;
    const top = h + rig.height + 0.05;
    const boss = S >= 4;
    const team = this.teamOf(u.side);
    const w = boss ? Math.max(40, ((rig.L + rig.W) / 2) * k * 1.0) : Math.max(14, ((rig.L + rig.W) / 2) * k * 0.78);
    const bh = boss ? (S >= 5 ? 9 : 7) : S >= 2 ? 4 : 3;
    const x0 = -w / 2;
    const y0 = hy * k * this.ay * (boss ? 1.1 : 1.04) + 4;
    // status glyphs left of the bar: a snowflake while slowed, a crossed-out gun (amber X) while disarmed
    let gx = x0 - 7;
    const gy = y0 + bh / 2;
    if (disarmed) {
      const r = 3.6, t = 1.1;
      for (const sg of [1, -1]) {
        ui.quad(x, top, y, [gx - r - t, gy - sg * r, gx - r + t, gy - sg * r - t * 1.4, gx + r + t, gy + sg * r, gx + r - t, gy + sg * r + t * 1.4], BLACK, 0.8);
        ui.quad(x, top, y, [gx - r, gy - sg * r, gx - r + t * 0.7, gy - sg * r - t * 0.7, gx + r, gy + sg * r, gx + r - t * 0.7, gy + sg * r + t * 0.7], JAM_COL, 1);
      }
      gx -= 9;
    }
    if (slowed) {
      const r = 3.8;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI + Math.PI / 2, c = Math.cos(a) * r, sn = Math.sin(a) * r, px = -Math.sin(a) * 0.8, py = Math.cos(a) * 0.8;
        ui.quad(x, top, y, [gx - c - px * 1.8, gy - sn - py * 1.8, gx - c + px * 1.8, gy - sn + py * 1.8, gx + c + px * 1.8, gy + sn + py * 1.8, gx + c - px * 1.8, gy + sn - py * 1.8], BLACK, 0.7);
        ui.quad(x, top, y, [gx - c - px, gy - sn - py, gx - c + px, gy - sn + py, gx + c + px, gy + sn + py, gx + c - px, gy + sn - py], ICE_HI, 1);
      }
    }
    const f = clamp(u.hp / u.maxHp, 0, 1), fs = clamp(v.hpShown / u.maxHp, 0, 1);
    const pad = boss ? 3 : 1.5;
    ui.rect(x, top, y, x0 - pad, y0 - pad, w + pad * 2, bh + pad * 2, boss ? BAR_COL[team] : BLACK, boss ? 0.95 * vis : 0.88 * vis);
    if (boss) ui.rect(x, top, y, x0 - pad + 1.2, y0 - pad + 1.2, w + pad * 2 - 2.4, bh + pad * 2 - 2.4, BLACK, 0.92 * vis);
    ui.rect(x, top, y, x0, y0, w * fs, bh, WHITE, 0.85 * vis);
    ui.rect(x, top, y, x0, y0, w * f, bh, f < 0.3 ? (team === 0 ? YELLOW : RED) : BAR_COL[team], vis);
    if (boss) for (let i = 1; i < 10; i++) ui.rect(x, top, y, x0 + (w * i) / 10 - 0.5, y0, 1, bh, BLACK, 0.6 * vis);
    if (u.maxShield > 0 && u.shield > 0) ui.rect(x, top, y, x0, y0 + bh + 0.5, w * clamp(u.shield / u.maxShield, 0, 1), 1.6, SHIELD_COL, vis);
    // paralysis (Zero-K style): blue meter under the hp bar, pulsing + bolt glyph while stunned
    if (u.para > 0) {
      const pf = clamp(u.para / u.maxHp, 0, 1), stunned = u.stun > 0;
      const py = y0 - bh - 3.5;
      ui.rect(x, top, y, x0 - 1.5, py - 1, w + 3, 4.5, BLACK, 0.88);
      ui.rect(x, top, y, x0, py, w * pf, 2.5, stunned ? (Math.sin(this.time * 14) > 0 ? ICE_HI : ICE_LO) : PARA_COL, 1);
      if (stunned) { // bolt glyph beside the meter
        const bx = x0 + w + 6, by = py + 1.2;
        ui.tri(x, top, y, bx + 2, by + 6, bx - 2, by - 1, bx + 1, by - 1, ICE_HI, 1);
        ui.tri(x, top, y, bx + 1, by - 1, bx - 1, by - 7, bx + 4, by + 1, ICE_HI, 1);
      }
    }
  }

  /** level pips under the unit's footprint */
  private drawPips(x: number, y: number, rig: Rig, ang: number, level: number, alpha: number, baseY = 0): void {
    const ui = this.ui, k = this.cam.k;
    const sz = clamp(k * 0.18, 3, 6);
    const hy = this.halfY(rig, ang) * k * this.ay * 0.9;
    const by = -hy - sz * 0.9;
    for (let i = 0; i < level - 1; i++) {
      const cx = (i - (level - 2) / 2) * sz * 1.5;
      const wing = (m: number, pad: number, c: RGB, a: number) => {
        const s = sz + pad;
        ui.quad(x, baseY, y, [cx, by - 0.15 * s, cx + m * 0.6 * s, by + 0.4 * s, cx + m * 0.6 * s, by, cx, by - 0.55 * s], c, a);
      };
      wing(-1, 1.2, BLACK, 0.75 * alpha); wing(1, 1.2, BLACK, 0.75 * alpha);
      wing(-1, 0, GOLD, alpha); wing(1, 0, GOLD, alpha);
    }
  }

  /* ------------------------------------------------------------------------------------------ projectiles */

  private projPos(p: SimProjectile) {
    const c = this.curP.get(p.id), pr = this.prevP.get(p.id);
    if (!c) return p;
    if (!pr) return c;
    const a = this.alpha;
    return { x: lerp(pr.x, c.x, a), y: lerp(pr.y, c.y, a), z: lerp(pr.z, c.z, a), angle: lerpAngle(pr.angle, c.angle, a), progress: lerp(pr.progress, c.progress, a) };
  }

  private syncProjectiles(list: SimProjectile[], byId?: Map<number, SimUnit>): void {
    const proj = this.fx.proj;
    proj.begin();
    const seen = this.projRec;
    const alive = new Set<number>();
    const dt = 1 / 60;
    const fdt = this.frameDt();
    const lod = this.fx.lod;
    for (const p of list) {
      alive.add(p.id);
      let rec = seen.get(p.id);
      const pos = this.projPos(p);
      if (!rec) {
        // launch height: the barrel tip that fired it
        let y0 = GUN_H;
        if (p.src !== undefined && p.mount !== undefined) {
          const rig = this.posedRig(p.src);
          if (rig && rig.muzzleWorld(p.mount, _v3)) y0 = _v3.y;
        }
        // straight rounds end at the body height of the first enemy along their path (aircraft fly well above the ground);
        // rounds fired at aircraft (the sim flies them at z = 1) climb to the first aircraft along their path
        const air = airShot(p);
        const hEnd = !byId ? 0.42
          : air ? this.aimHeightAlong(pos.x, pos.y, pos.angle, byId, p.side, p.z + 0.12, true)
          : p.z > 0.05 ? 0.42 : this.aimHeightAlong(pos.x, pos.y, pos.angle, byId, p.side, 0.42, false);
        const st = styleOf(p.moduleId);
        // rotary guns: how far the barrels had spun up when this round left them
        const k = st.fam === 'gatling' && p.src !== undefined && p.mount !== undefined ? this.spin.get(p.src * 16 + p.mount)?.k ?? 1 : 1;
        const bomblet = st.fam === 'cluster' && this.clusterPts.some((c) => Math.abs(c.x - p.x) < 0.7 && Math.abs(c.y - p.y) < 0.7);
        if (bomblet || st.fam === 'bomb') y0 = pos.z + 0.12;
        const ca = Math.cos(pos.angle), sa = Math.sin(pos.angle);
        rec = {
          y0, lastH: y0, px: pos.x, py: pos.y, bright: p.id % 3 === 0, hEnd, air, st, k, bomblet,
          dx: ca, dy: p.kind === 'arc' && !bomblet && st.fam !== 'bomb' ? 0.8 : 0, dz: sa, ex: pos.x, ey: y0, ez: pos.y, born: this.time, seed: (p.id * 0.618) % 1 * 6.283,
        };
        seen.set(p.id, rec);
        // every rocket / missile leaves its own tube: a launch flash, a backblast jet and a smoke cloud behind the pod
        if ((p.kind === 'rocket' || p.kind === 'missile') && !this.offscreen(pos.x, pos.y, 3)) {
          this.fx.launch(pos.x, y0, pos.y, ca, sa, st.s, p.kind === 'missile' ? (st.fam === 'bigMissile' ? 2 : 1) : 0);
        }
      }
      if (this.offscreen(pos.x, pos.y, 4)) { rec.px = rec.ex = pos.x; rec.py = rec.ez = pos.y; continue; }
      // homing anti-air missiles turn onto their target after launch: keep re-reading its height along the heading
      if (rec.air && p.kind === 'missile' && byId) rec.hEnd = this.aimHeightAlong(pos.x, pos.y, pos.angle, byId, p.side, rec.hEnd, true);
      const st = rec.st, sz = st.s;
      const kp = clamp(pos.progress, 0, 1);
      const age = this.time - rec.born;
      // height (from the interpolated snapshot: the sim's own z / progress are a tick ahead of x, y). Lofted rounds
      // (shells, rockets, missiles) ride their sim altitude on top of the line from the barrel down to the ground
      const lofts = !rec.air && (p.kind === 'arc' || p.kind === 'rocket' || p.kind === 'missile');
      let H: number;
      if (rec.bomblet || st.fam === 'bomb') H = pos.z + 0.12;
      else if (lofts) H = lerp(rec.y0, 0.15, kp) + pos.z;
      else H = lerp(rec.y0, rec.hEnd, kp);
      let X = pos.x, Z = pos.y;
      // rockets and swarm missiles don't fly on rails: a little corkscrew wobble round the true path (none at the ends)
      if (p.kind === 'rocket' || (p.kind === 'missile' && st.def?.id === 'swarm')) {
        const env = Math.sin(Math.PI * kp), ca = Math.cos(pos.angle), sa = Math.sin(pos.angle);
        const w = (p.kind === 'rocket' ? 0.07 : 0.05) * env;
        const ph = age * 19 + rec.seed;
        X += -sa * Math.sin(ph) * w; Z += ca * Math.sin(ph) * w;
        H += Math.cos(ph * 0.83) * w * 0.7;
      }
      // orientation: along the round's actual 3D velocity (smoothed), so lofted rounds pitch up, over and down. The
      // heading is the sim's; climb and sideways drift come from the motion since the last frame, measured only while it
      // moves forward (a new tick's snapshot can step the interpolation back a hair)
      {
        const ca = Math.cos(pos.angle), sa = Math.sin(pos.angle);
        const mx = X - rec.px, my = H - rec.lastH, mz = Z - rec.py;
        const fwd = mx * ca + mz * sa;
        let tx = ca, ty = 0, tz = sa;
        if (fwd > 1e-4 && fwd < 3) {
          const lat = clamp((-mx * sa + mz * ca) / fwd, -0.6, 0.6), slope = clamp(my / fwd, -4, 4);
          tx = ca - sa * lat; ty = slope; tz = sa + ca * lat;
        } else ty = rec.dy / Math.max(0.2, Math.hypot(rec.dx, rec.dz));
        const tl = Math.hypot(tx, ty, tz);
        const s = Math.min(1, 0.5 * fdt * 60 + 0.1);
        rec.dx += (tx / tl - rec.dx) * s; rec.dy += (ty / tl - rec.dy) * s; rec.dz += (tz / tl - rec.dz) * s;
        const l = Math.hypot(rec.dx, rec.dy, rec.dz) || 1;
        rec.dx /= l; rec.dy /= l; rec.dz /= l;
      }
      const dx = rec.dx, dy = rec.dy, dz = rec.dz;
      const emit = Math.random() < Math.min(1, fdt * 60);
      /** point `b` cells behind the head along the flight direction */
      const bx = (b: number) => X - dx * b, by = (b: number) => H - dy * b, bz = (b: number) => Z - dz * b;
      const tracer = (len: number, w: number, r: number, g: number, b: number) => proj.streak(bx(len), by(len), bz(len), X, H, Z, w, r, g, b);
      /** trail puffs laid every `sp` cells along the path since the last frame, from `back` cells behind the head */
      const trailAlong = (back: number, kind: TrailKind, size: number, sp: number) => {
        const tx = bx(back), ty = by(back), tz = bz(back);
        const ex = tx - rec.ex, ey = ty - rec.ey, ez = tz - rec.ez, d = Math.hypot(ex, ey, ez);
        if (d > 6) { rec.ex = tx; rec.ey = ty; rec.ez = tz; return; }
        const step = sp / Math.max(0.35, lod);
        const n = Math.min(10, Math.floor(d / step));
        for (let i = 1; i <= n; i++) {
          const f = (i * step) / d;
          this.fx.trail(rec.ex + ex * f, rec.ey + ey * f, rec.ez + ez * f, kind, size);
        }
        if (n > 0) { const f = (n * step) / d; rec.ex += ex * f; rec.ey += ey * f; rec.ez += ez * f; }
      };
      switch (p.kind) {
        case 'bullet': {
          switch (st.fam) {
            case 'gatling': { // rotary: short dim tracers at first, a hose of long bright ones once spun up
              const k = rec.k, f = 0.7 + sz;
              tracer((0.3 + 0.9 * k) * f * (rec.bright ? 1.3 : 1), (0.022 + 0.03 * k) * f, 1, 0.5 + 0.35 * k, 0.15 + 0.35 * k);
              break;
            }
            case 'shotgun': tracer(0.16, 0.04 + sz * 0.03, 1, 0.85, 0.55); break; // a spray of short pellet dots
            case 'flechette': tracer(0.85, 0.018, 0.7, 0.88, 1); break; // long thin steel needles
            case 'ac': tracer(0.35 + 0.4 * sz, 0.05 + 0.06 * sz, 1, 0.36, 0.12); break; // fat red-orange HE tracer
            case 'hmg': tracer(0.9 + 0.4 * sz, 0.05, 1, 0.6, 0.22); break; // every round a heavy orange tracer
            case 'sniper': tracer(3.2, 0.03, 0.8, 0.92, 1); break; // one long white-blue streak
            case 'twinmg': tracer(rec.bright ? 0.9 : 0.45, 0.035, 0.7, 0.88, 1); break; // cold pale tracers (it slows)
            default: tracer(rec.bright ? 0.9 + sz * 0.6 : 0.4 + sz * 0.3, 0.03 + sz * 0.05, 1, 0.8, 0.35); break;
          }
          break;
        }
        case 'shell': {
          if (st.fam === 'gauss') { // magnetic slug: a long blue streak, glowing head and an ionised sparkle trail
            tracer(2.4, 0.08, 0.45, 0.65, 1);
            this.fx.glow(X, H, Z, 0.35 + sz * 0.3, dt * 2.2, RAMPS.gauss);
            trailAlong(0.4, 'gauss', 0.8 + sz, 0.3);
          } else if (st.fam === 'flak') { // small dark shell with a fuse spark
            proj.body(X, H, Z, dx, dy, dz, 0.18 + 0.2 * sz, 0.06 + 0.05 * sz, 0.25, 0.25, 0.22);
            tracer(0.3, 0.03, 1, 0.6, 0.25);
          } else if (st.fam === 'he') { // fat olive HE shell, short orange tracer, a smoke wisp
            proj.body(X, H, Z, dx, dy, dz, 0.3 + 0.35 * sz, 0.1 + 0.1 * sz, 0.55, 0.55, 0.35);
            proj.streak(bx(0.5), by(0.5), bz(0.5), X, H, Z, 0.06 + sz * 0.05, 1, 0.5, 0.15);
            trailAlong(0, 'shell', 0.6 + sz, 0.35);
          } else { // AP shot: slim bright penetrator with a hot red tank tracer
            proj.body(X, H, Z, dx, dy, dz, 0.3 + 0.35 * sz, 0.05 + 0.06 * sz, 0.9, 0.8, 0.55);
            tracer(1.0 + sz * 0.6, 0.05 + 0.04 * sz, 1, 0.32, 0.14);
          }
          break;
        }
        case 'arc': {
          switch (st.fam) {
            case 'grenade': { // small olive grenade tumbling end over end with a fuse spark
              const a = age * 14 + rec.seed, c = Math.cos(a);
              proj.body(X, H, Z, dx * c, Math.sin(a), dz * c, 0.13, 0.1, 0.35, 0.42, 0.25);
              trailAlong(0, 'spark', 0.8, 0.25);
              break;
            }
            case 'firebomb': // incendiary shell glowing and trailing flame
              proj.body(X, H, Z, dx, dy, dz, 0.24, 0.14, 0.7, 0.35, 0.15);
              this.fx.glow(X, H, Z, 0.4, dt * 2.2, RAMPS.ember);
              trailAlong(0, 'firebomb', 1, 0.2);
              break;
            case 'bomb': // dropped bomb: dark, nose tipping down as it falls, no trail
              proj.body(X, H, Z, dx, dy, dz, 0.3, 0.13, 0.3, 0.32, 0.3);
              break;
            case 'cluster':
              if (rec.bomblet) { // bomblet: a tiny dark pellet tumbling, with a spark trail
                const a = age * 20 + rec.seed, c = Math.cos(a);
                proj.body(X, H, Z, dx * c, Math.sin(a), dz * c, 0.1, 0.08, 0.3, 0.3, 0.28);
                trailAlong(0, 'spark', 0.9, 0.25);
              } else { // big yellow-banded cargo shell with a faint tracer and a smoke streamer
                proj.body(X, H, Z, dx, dy, dz, 0.4 + 0.4 * sz, 0.12 + 0.1 * sz, 0.8, 0.7, 0.3);
                proj.streak(bx(0.7 + sz * 0.4), by(0.7 + sz * 0.4), bz(0.7 + sz * 0.4), bx(0.15), by(0.15), bz(0.15), 0.05 + sz * 0.04, 0.9, 0.45, 0.12);
                trailAlong(0.2, 'heavyShell', 0.8 + sz, 0.3);
              }
              break;
            case 'mortar': // finned bomb lobbed high: a glowing fuse tail and a thin smoke line
              proj.body(X, H, Z, dx, dy, dz, 0.32 + 0.2 * sz, 0.13 + 0.06 * sz, 0.4, 0.43, 0.36);
              proj.streak(bx(0.55), by(0.55), bz(0.55), bx(0.12), by(0.12), bz(0.12), 0.045 + sz * 0.03, 1, 0.45, 0.12);
              this.fx.glow(bx(0.14), by(0.14), bz(0.14), 0.22 + 0.1 * sz, dt * 2.2, RAMPS.exhaust);
              trailAlong(0.15, 'heavyShell', 0.55 + sz, 0.2);
              break;
            default: // howitzer / barrage: heavy shell, a glowing base-bleed tracer and a lazy grey streamer
              proj.body(X, H, Z, dx, dy, dz, 0.35 + 0.4 * sz, 0.1 + 0.1 * sz, 0.62, 0.6, 0.52);
              proj.streak(bx(0.9 + sz * 0.5), by(0.9 + sz * 0.5), bz(0.9 + sz * 0.5), bx(0.18), by(0.18), bz(0.18), 0.05 + sz * 0.05, 1, 0.5, 0.15);
              trailAlong(0.2, 'heavyShell', 0.8 + sz, 0.2);
              break;
          }
          break;
        }
        case 'rocket': { // stubby rocket: a flickering flame tongue and a thick, curving, lingering smoke trail
          const inc = st.fam === 'incend';
          const len = 0.36 + 0.22 * sz;
          proj.body(X, H, Z, dx, dy, dz, len, 0.07 + 0.06 * sz, 0.5, 0.5, 0.44);
          // burn: the motor roars hardest early on, the flame tongue flickers every frame
          const fl = (0.7 + 0.6 * Math.random()) * (1.2 - 0.35 * kp);
          const t0 = len * 0.5, t1 = t0 + (0.22 + 0.2 * sz) * fl;
          proj.streak(bx(t1), by(t1), bz(t1), bx(t0), by(t0), bz(t0), (0.03 + sz * 0.025) * fl, 1, inc ? 0.3 : 0.5, 0.1);
          this.fx.glow(bx(t0 + 0.08), by(t0 + 0.08), bz(t0 + 0.08), (0.22 + 0.18 * sz) * fl, dt * 2.2, inc ? RAMPS.ember : RAMPS.exhaust);
          trailAlong(t0 + 0.12, inc ? 'incend' : 'rocket', 0.8 + sz * 0.8, 0.16);
          break;
        }
        case 'missile': { // slim white missile: a white-hot exhaust plume (fierce in the boost) and a long contrail
          const big = st.fam === 'bigMissile';
          const len = (big ? 0.6 : 0.4) + 0.3 * sz;
          proj.body(X, H, Z, dx, dy, dz, len, (big ? 0.1 : 0.05) + 0.05 * sz, 0.95, 0.95, 0.92);
          const boost = Math.max(0, 1 - age / (big ? 0.9 : 0.6));
          const fl = (0.8 + 0.4 * Math.random()) * (1 + 0.9 * boost);
          const t0 = len * 0.5, t1 = t0 + (big ? 0.45 : 0.25) * (0.6 + sz) * fl;
          proj.streak(bx(t1), by(t1), bz(t1), bx(t0), by(t0), bz(t0), (0.025 + sz * 0.03) * fl * (big ? 1.6 : 1), 1, 0.9, 0.7);
          this.fx.glow(bx(t0 + 0.06), by(t0 + 0.06), bz(t0 + 0.06), (big ? 0.45 : 0.24) * (0.6 + sz) * fl, dt * 2.2, RAMPS.flash);
          trailAlong(t0 + 0.08, big ? 'bigMissile' : 'missile', (0.8 + sz) * (1 + 0.6 * boost), big ? 0.2 : 0.14);
          break;
        }
        case 'flame': // two puffs a frame: a dense, rolling jet
          if (emit) this.fx.flameJet(X, H, Z, kp, 0.7 + sz, st.def?.id === 'napalm' || st.def?.id === 'inferno');
          if (emit && Math.random() < 0.6 * lod) this.fx.flameJet(X - dx * 0.2, H, Z - dz * 0.2, clamp(pos.progress - 0.05, 0, 1), 0.7 + sz, false);
          break;
        case 'orb': {
          if (st.fam === 'sonic') { // pressure wave: a pale shimmering ball that leaves ripples
            this.fx.glow(X, H, Z, 0.4 + sz * 0.6, dt * 2.2, RAMPS.sonic);
            if (Math.random() < fdt * 9) this.fx.sonicPulse(X, H, Z, 0.6 + sz);
            break;
          }
          const ramp: Ramp = st.fam === 'empOrb' ? RAMPS.emp : RAMPS.plasma;
          this.fx.glow(X, H, Z, 0.4 + sz * 0.7, dt * 2.2, ramp);
          if (emit) this.fx.trail(X, H, Z, 'orb', 0.5 + sz * 0.6, ramp);
          if (st.fam === 'empOrb' && Math.random() < fdt * 10) this.fx.arcs(X, H, Z, 0.25 + sz * 0.3, 0.25 + sz * 0.3);
          break;
        }
        default: break;
      }
      // lofted rounds cast a soft shadow on the ground under them: it reads the arc's height from above
      if (lofts && pos.z > 0.25 && !rec.bomblet) this.fx.shadow(X, Z, (p.kind === 'arc' ? 0.28 : 0.22) + 0.15 * sz, 0.32 / (1 + 0.35 * pos.z), fdt);
      rec.lastH = H; rec.px = X; rec.py = Z;
    }
    proj.end();
    for (const id of seen.keys()) if (!alive.has(id)) seen.delete(id);
    if (this.clusterPts.length && this.time - this.clusterPts[0].t > 0.6) this.clusterPts = this.clusterPts.filter((c) => this.time - c.t <= 0.6);
  }

  private _lastFrameDt = 1 / 60;
  private frameDt(): number { return this._lastFrameDt; }

  /* ---------------------------------------------------------------------------------------------- wrecks */

  private syncWrecks(dt: number): void {
    for (const w of this.wrecks) {
      if (this.offscreen(w.x, w.z, w.rig.radius + 3)) continue;
      this.layer.submit(w.rig, 'wreck');
      if (w.smoke > 0) {
        w.smoke -= dt;
        if (Math.random() < dt * (2.5 + w.S) * this.fx.lod) this.fx.wreckSmoke(w.x, w.z, w.S);
      }
    }
  }

  /* ------------------------------------------------------------------------------------------------ events */

  private unitHeight(unit: number, byId: Map<number, SimUnit>, fallback = 0.45): number {
    const v = this.bu.get(unit), su = byId.get(unit);
    if (!v || !su) return fallback;
    return su.flying ? flyHeight(v.rig.S) + 0.4 + v.rig.midY : Math.min(v.rig.height * 0.6, Math.max(0.7, v.rig.height * 0.35));
  }

  /** body height of the first enemy (of a shooter on `side`) whose hull lies across a ray from (x, y) at `ang`; only
   *  units of the round's own layer (the sim's air rounds only hit aircraft, ground rounds only ground units) */
  private aimHeightAlong(x: number, y: number, ang: number, byId: Map<number, SimUnit>, side: Side, fallback: number, air: boolean): number {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let best = Infinity, id = -1;
    for (const u of byId.values()) {
      if (!u.alive || u.side === side || u.flying !== air) continue;
      const rx = u.x - x, ry = u.y - y, t = rx * dx + ry * dy;
      if (t <= 0 || t >= best) continue;
      const v = this.bu.get(u.id);
      if (Math.abs(rx * dy - ry * dx) < 0.5 + (v ? v.rig.radius : 0.5)) { best = t; id = u.id; }
    }
    return id >= 0 ? this.unitHeight(id, byId, fallback) : fallback;
  }

  /** body height of the enemy (of a shooter on `side`) unit nearest to a ground point, for beam / bolt end points */
  private aimHeightAt(x: number, y: number, byId: Map<number, SimUnit>, side: Side | undefined, fallback = GUN_H): number {
    let best = Infinity, id = -1;
    for (const u of byId.values()) {
      if (!u.alive || u.side === side) continue;
      const d = Math.hypot(u.x - x, u.y - y);
      const v = this.bu.get(u.id);
      if (d < best && d < 1 + (v ? v.rig.radius : 1)) { best = d; id = u.id; }
    }
    return id >= 0 ? this.unitHeight(id, byId, fallback) : fallback;
  }

  /** A shot from (x1, y1) that the sim ends on a unit's centre (x2, y2): where it is drawn to end (that unit's shield
   *  bubble or hull side facing the shooter). Remembers the origin for the 'hit' that follows. */
  private shotEnd(x1: number, y1: number, x2: number, y2: number, byId: Map<number, SimUnit>): { x: number; y: number } {
    let best = 0.3 * 0.3, t: SimUnit | null = null;
    for (const u of byId.values()) { const d = (u.x - x2) ** 2 + (u.y - y2) ** 2; if (d < best) { best = d; t = u; } }
    const v = t && this.bu.get(t.id);
    if (!t || !v) return { x: x2, y: y2 };
    this.shotFrom.set(t.id, { x: x1, y: y1 });
    // the model is drawn interpolated (a tick behind the sim): end on it, not where the sim already has it
    const c = this.drawnAt(t);
    const d = Math.hypot(x1 - c.x, y1 - c.y);
    const r = t.shield > 0 || t.auraShield > 0 ? Math.max(v.rig.L, v.rig.W) * 0.58 + 0.18 : Math.min(v.rig.L, v.rig.W) * 0.42;
    if (d <= r) return c;
    return { x: c.x + ((x1 - c.x) / d) * r, y: c.y + ((y1 - c.y) / d) * r };
  }

  /** where a live unit is drawn this frame (the same interpolation poseUnit uses) */
  private drawnAt(u: SimUnit): { x: number; y: number } {
    const c = this.curU.get(u.id), pr = this.prevU.get(u.id) ?? c;
    if (!c || !pr || Math.hypot(c.x - pr.x, c.y - pr.y) > 3) return { x: u.x, y: u.y };
    return { x: lerp(pr.x, c.x, this.alpha), y: lerp(pr.y, c.y, this.alpha) };
  }

  /** a unit's rig, only if its transforms are current (muzzle positions of culled rigs are stale or at the origin) */
  private posedRig(id: number | undefined): Rig | undefined {
    const v = id === undefined ? undefined : this.bu.get(id);
    return v?.posed ? v.rig : undefined;
  }

  private handleEvent(e: BattleEvent, byId: Map<number, SimUnit>): void {
    const fx = this.fx;
    switch (e.t) {
      case 'fire': {
        const v = this.bu.get(e.unit);
        const st = styleOf(e.moduleId);
        // rotary guns track their spin even off screen (the tracers and barrel glow read it)
        const k = st.fam === 'gatling' ? this.spinShot(e.unit, e.mount, st.def?.spinUp ?? 1.5) : 1;
        if (!v || this.offscreen(e.x, e.y, 3)) break;
        v.rig.kick(e.mount);
        if (!st.muzzle) break; // beams / bolts / flame / melee draw their own flare
        const m = v.posed ? v.rig.muzzleWorld(e.mount, _v3) : null;
        if (m) fx.muzzleFx(m.x, m.y, m.z, Math.cos(e.angle), Math.sin(e.angle), st.s, st.muzzle, k);
        else fx.muzzleFx(e.x, GUN_H, e.y, Math.cos(e.angle), Math.sin(e.angle), st.s, st.muzzle, k);
        break;
      }
      case 'beam': {
        const st = styleOf(e.moduleId);
        const bs = beamStyle(e.moduleId);
        const rk = st.fam === 'focus' && e.unit !== undefined && e.mount !== undefined ? this.rampShot(e.unit, e.mount, e.x2, e.y2) : 0;
        const rig = this.posedRig(e.unit);
        const m = rig && e.mount !== undefined ? rig.muzzleWorld(e.mount, new THREE.Vector3()) : null;
        if (!m && this.offscreen(e.x1, e.y1, 3) && this.offscreen(e.x2, e.y2, 3)) break;
        const ay = m ? m.y : GUN_H;
        const sx = m ? m.x : e.x1, sz = m ? m.z : e.y1;
        // stop on the target's hull side / shield bubble, not inside the model (its impact flare would be hidden)
        const end = this.shotEnd(sx, sz, e.x2, e.y2, byId);
        const by = this.aimHeightAt(e.x2, e.y2, byId, e.side);
        const col = _col.set(bs.color).clone();
        let w = bs.w * (0.7 + st.s * 0.8), life = bs.life;
        if (st.fam === 'focus') {
          // focusing: the beam fattens and burns from red to white-hot as it holds one target
          col.lerp(_c2.setRGB(1, 0.9, 0.75), rk * 0.8);
          w *= 1 + 3.5 * rk;
          life += 0.1 * rk;
          if (rk > 0.4) fx.glow(sx, ay, sz, 0.2 + rk * 0.5, 0.14, RAMPS.molten);
        }
        fx.beam(sx, ay, sz, end.x, by, end.y, col, w, life, bs.wob);
        const s = st.s;
        switch (st.fam) {
          case 'laser': fx.burnHit(end.x, by, end.y, s, 0.8); break;
          case 'focus': fx.burnHit(end.x, by, end.y, s, 0.6 + 1.9 * rk); break;
          case 'heatray': fx.burnHit(end.x, by, end.y, s, 1.4); break;
          case 'slow': fx.beamMotes(sx, ay, sz, end.x, by, end.y, RAMPS.frost, 3); fx.frostHit(end.x, by, end.y, s); break;
          case 'disarm': fx.beamMotes(sx, ay, sz, end.x, by, end.y, RAMPS.jam, 4); fx.jamHit(end.x, by, end.y, s); break;
          case 'gravity': fx.beamMotes(end.x, by, end.y, sx, ay, sz, RAMPS.gravity, 5); break;
          case 'rail': fx.railTrail(sx, ay, sz, end.x, by, end.y, RAMPS.gauss, s); break;
          case 'plasma': fx.railTrail(sx, ay, sz, end.x, by, end.y, RAMPS.plasma, s * 0.6); break;
          default: break;
        }
        break;
      }
      case 'chain': {
        const st = beamStyle(e.moduleId);
        const col = new THREE.Color(st.color);
        const rig = this.posedRig(e.unit);
        const m = rig && e.mount !== undefined ? rig.muzzleWorld(e.mount, new THREE.Vector3()) : null;
        const w = 0.04 + styleOf(e.moduleId).s * 0.04;
        let hPrev = GUN_H;
        for (let i = 1; i < e.points.length; i++) {
          const p0 = e.points[i - 1], p1 = e.points[i];
          const h1 = this.aimHeightAt(p1.x, p1.y, byId, e.side);
          const sx = i === 1 && m ? m.x : p0.x, sy = i === 1 && m ? m.y : hPrev, sz = i === 1 && m ? m.z : p0.y;
          const end = this.shotEnd(sx, sz, p1.x, p1.y, byId);
          fx.lightning(sx, sy, sz, end.x, h1, end.y, col, w, 0.2);
          hPrev = h1;
        }
        break;
      }
      case 'hit': {
        const v = this.bu.get(e.unit);
        const yh = this.unitHeight(e.unit, byId);
        const su = byId.get(e.unit);
        const d0 = v && su ? Math.hypot(e.x - su.x, e.y - su.y) : 0;
        // direction the shot was travelling when it struck (AP sparks and darts carry on along it)
        let tdx = 0, tdz = 0;
        if (v && su) {
          // hits reported at (about) the centre (beams, arcs, splash) go to the hull side facing the shot or blast;
          // shield hits always flare on the bubble, not inside it
          const lb = this.lastBlast;
          const from = d0 < 0.3 ? this.shotFrom.get(e.unit) ?? (lb && Math.hypot(lb.x - su.x, lb.y - su.y) <= lb.r + 3 ? lb : null) : null;
          // drawn a tick behind the sim (interpolation): the flare goes on the model as drawn
          const c = this.drawnAt(su);
          if (from || e.shieldHit) {
            const a = from && Math.hypot(from.x - c.x, from.y - c.y) > 0.05 ? Math.atan2(from.y - c.y, from.x - c.x)
              : d0 > 0.05 ? Math.atan2(e.y - su.y, e.x - su.x) : Math.random() * Math.PI * 2;
            const r = e.shieldHit ? Math.max(v.rig.L, v.rig.W) * 0.58 + 0.18 : Math.min(v.rig.L, v.rig.W) * 0.42;
            e = { ...e, x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
            tdx = -Math.cos(a); tdz = -Math.sin(a);
          } else {
            if (d0 > 0.05) { tdx = (su.x - e.x) / d0; tdz = (su.y - e.y) / d0; }
            e = { ...e, x: e.x + c.x - su.x, y: e.y + c.y - su.y };
          }
        }
        if (!tdx && !tdz) { const a = Math.random() * Math.PI * 2; tdx = Math.cos(a); tdz = Math.sin(a); }
        if (v) {
          v.dmgT = this.time;
          if (e.shieldHit) { v.shT = this.time; v.hx = e.x; v.hy = yh; v.hz = e.y; }
        }
        if (this.hitBudget-- <= 0 || this.offscreen(e.x, e.y, 2)) break;
        const st = styleOf(e.moduleId), s = st.s;
        if (e.shieldHit) { fx.shieldHit(e.x, yh, e.y); break; }
        // knockback weapons shove the hull: dust kicked up under it
        if (st.def?.impulse && st.def.impulse > 0 && su && !su.flying && v && Math.random() < 0.7) fx.dustPuff(e.x, e.y, 0.3 + v.rig.S * 0.12);
        if (SELF_IMPACT.has(st.fam)) break;
        switch (st.fam) {
          case 'mg': case 'gatling': fx.impact(e.x, yh, e.y, 0.1 + s * 0.4, true); break;
          case 'twinmg': fx.impact(e.x, yh, e.y, 0.1 + s * 0.3, true); if (Math.random() < 0.35) fx.frostHit(e.x, yh, e.y, 0.15); break;
          case 'hmg': case 'sniper': case 'apc': fx.apHit(e.x, yh, e.y, tdx, tdz, s); break;
          case 'gauss': case 'rail': fx.apHit(e.x, yh, e.y, tdx, tdz, s, RAMPS.gauss); break;
          case 'shotgun': fx.pelletHit(e.x, yh, e.y); break;
          case 'flechette': fx.dartHit(e.x, yh, e.y, tdx, tdz); break;
          case 'ac': fx.impact(e.x, yh, e.y, 0.1, true); break; // its 'explode' pops right after
          case 'plasma': case 'plasmaOrb': fx.plasmaHit(e.x, yh, e.y, s); break;
          case 'chain': case 'empOrb': fx.empHit(e.x, yh, e.y, s); break;
          case 'flame': break; // the flames and the burn say it all
          case 'melee': {
            const vis = st.def?.visual;
            if (vis === 'prod') fx.empHit(e.x, yh, e.y, s);
            else if (vis === 'blade') fx.plasmaHit(e.x, yh, e.y, s);
            else if (vis === 'claw') { fx.grind(e.x, yh, e.y, s); fx.jamHit(e.x, yh, e.y, s * 0.6); }
            else if (vis === 'hammer' || vis === 'ram') { fx.impact(e.x, yh, e.y, 0.5 + s * 0.5, false); fx.shockwave(e.x, e.y, 0.3 + s * 0.4); }
            else fx.grind(e.x, yh, e.y, s);
            break;
          }
          default: fx.impact(e.x, yh, e.y, 0.1 + s * 0.35, true); break;
        }
        break;
      }
      case 'explode': {
        this.lastBlast = { x: e.x, y: e.y, r: e.radius };
        const st = styleOf(e.moduleId), r = Math.max(0.3, e.radius);
        if (st.fam === 'cluster' && e.radius >= 1.1) this.clusterPts.push({ x: e.x, y: e.y, t: this.time });
        if (this.offscreen(e.x, e.y, e.radius + 4)) { fx.trauma = Math.min(1, fx.trauma + 0.02); break; }
        // air bursts and missiles striking an aircraft go off at its altitude, not on the ground below (as in 2D)
        let ey = 0;
        if (st.def?.targetsAir) {
          let bd = 1.2 * 1.2, best = -1;
          for (const u of byId.values()) {
            if (!u.flying || !this.bu.has(u.id)) continue;
            const d = (u.x - e.x) ** 2 + (u.y - e.y) ** 2;
            if (d < bd) { bd = d; best = u.id; }
          }
          if (best >= 0) ey = Math.max(0, this.unitHeight(best, byId) - 0.15);
        }
        // the area the blast actually damaged (the sim's splash radius), marked on the ground / at the burst height
        if (st.fam !== 'pd') fx.aoeRing(e.x, st.fam === 'flak' ? (ey > 0 ? ey : 1.3) : ey, e.y, e.radius, st.fam === 'plasmaOrb' || st.fam === 'plasma' || st.fam === 'empOrb' || st.fam === 'chain' || st.fam === 'sonic');
        switch (st.fam) {
          case 'mg': case 'hmg': case 'gatling': case 'ac': case 'twinmg': case 'shotgun': case 'sniper':
            fx.pop(e.x, ey, e.y, r * 0.8); break; // autocannon HE round: a sharp little pop
          case 'apc': fx.pop(e.x, ey, e.y, r * 0.7); break; // AP shell's small bursting charge (the hit throws the AP sparks)
          case 'he': fx.explosion(e.x, e.y, r * 1.25, 'fire', ey); fx.shockwave(e.x, e.y, r * 1.1); break; // HE: big blast + knockback dust
          case 'grenade': fx.pop(e.x, ey, e.y, r * 0.65); fx.dirtGeyser(e.x, e.y, r * 0.45); break;
          case 'mortar': case 'howitzer': case 'bomb': fx.explosion(e.x, e.y, r, 'fire', ey); if (!ey) fx.dirtGeyser(e.x, e.y, r * 0.7); break;
          case 'cluster':
            if (e.radius >= 1.1) { fx.clusterBurst(e.x, e.y, r); fx.explosion(e.x, e.y, r * 0.75, 'fire', 0, false, 0.6); } // the cargo shell splits
            else { fx.explosion(e.x, e.y, r * 0.8, 'fire', 0, false, 0.4); fx.dirtGeyser(e.x, e.y, r * 0.35); } // one of the bomblet carpet
            break;
          case 'firebomb': fx.pop(e.x, ey, e.y, r * 0.8, RAMPS.ember); break; // the burning patch ('fireField') follows
          case 'incend': fx.explosion(e.x, e.y, r, 'fire', ey); fx.fireSplash(e.x, e.y, r * 0.8); break;
          case 'flak': fx.airBurst(e.x, ey > 0 ? ey : 1.3, e.y, r * 0.75); break;
          case 'plasmaOrb': case 'plasma': fx.explosion(e.x, e.y, r, 'plasma', ey); break;
          case 'empOrb': case 'chain': {
            fx.explosion(e.x, e.y, r, 'emp', ey, false, 0.7);
            for (let i = 0; i < 4; i++) fx.arcs(e.x, ey + 0.3, e.y, r * 0.8, r * 0.8);
            break;
          }
          case 'sonic': fx.shockwave(e.x, e.y, r); fx.sonicPulse(e.x, 0.4, e.y, r * 1.4); break;
          case 'pd': fx.pop(e.x, 1, e.y, 0.25, RAMPS.fire, false); break;
          case 'melee': {
            const vis = st.def?.visual;
            if (vis === 'blade') fx.pop(e.x, 0.3, e.y, r * 0.6, RAMPS.plasma, false);
            else if (vis === 'hammer' || vis === 'ram') { fx.shockwave(e.x, e.y, r); fx.dustPuff(e.x, e.y, r); }
            else fx.grind(e.x, 0.4, e.y, r);
            break;
          }
          default: fx.explosion(e.x, e.y, r, 'fire', ey); break;
        }
        break;
      }
      case 'death': {
        const v = this.bu.get(e.unit);
        const vis = !this.offscreen(e.x, e.y, 6);
        if (vis) {
          if (e.flying) fx.bigExplosion(e.x, e.y, Math.max(1, e.size * 0.8), v ? flyHeight(v.rig.S) + 0.2 + v.rig.midY : 1);
          else fx.bigExplosion(e.x, e.y, e.size);
        }
        if (v && !e.flying) this.toWreck(e.unit, v, e.x, e.y, byId.get(e.unit)?.angle ?? 0, 10 + e.size * 4);
        else if (v) { this.layer.release(v.rig); this.bu.delete(e.unit); }
        break;
      }
      case 'heal': {
        const v = this.bu.get(e.unit);
        // culled / never-drawn rigs keep a stale (or origin) transform: only units drawn last frame sparkle
        if (v) { v.healT = this.time; if (v.posed && Math.random() < 0.5) fx.heal(v.rig.root.position.x, v.rig.root.position.y + v.rig.height * 0.5, v.rig.root.position.z); }
        break;
      }
      case 'leap': {
        const v = this.bu.get(e.unit);
        if (v?.posed) fx.dustPuff(v.rig.root.position.x, v.rig.root.position.z, 0.5 + v.rig.S * 0.2);
        break;
      }
      case 'smoke':
        fx.smokeScreen(e.x, e.y, e.radius, e.duration);
        break;
      case 'fireField':
        fx.fireField(e.x, e.y, e.radius, e.duration);
        break;
      default:
    }
  }

  /** the hull stays as a charred wreck for the rest of the battle */
  private toWreck(id: number, v: UView, x: number, y: number, angle: number, smoke: number): void {
    this.bu.delete(id);
    const rig = v.rig;
    rig.look = 'wreck';
    rig.tr = rig.tg = rig.tb = 1;
    rig.root.position.set(x, -0.03, y);
    rig.root.rotation.y = -angle;
    rig.root.rotation.z = (Math.random() - 0.5) * 0.06; rig.root.rotation.x = (Math.random() - 0.5) * 0.06;
    for (const tu of rig.all) { if (!tu.fixed) tu.yaw.rotation.y += (Math.random() - 0.5) * 1.2; tu.yaw.updateMatrix(); tu.recoil.position.x = 0; tu.recoil.updateMatrix(); }
    rig.update(0);
    rig.frozen = true;
    this.wrecks.push({ rig, x, z: y, smoke, S: rig.S });
  }

  destroy(): void {
    this.controls.destroy();
    if (typeof window !== 'undefined') {
      if (this.onKey) { window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKey); }
      if (this.onBlur) window.removeEventListener('blur', this.onBlur);
    }
    // Free this renderer's GPU copies of everything it drew. Many of these resources are module-level caches shared by
    // every view (terrain builds, unit materials / geometry, look materials); the renderer registers 'dispose' listeners
    // on them that would otherwise keep each destroyed renderer + its WebGL context alive for the rest of the session.
    // Only one view lives at a time (screens are destroyed before the next is built) and the next one has its own context,
    // so this costs nothing: the CPU-side data stays and is uploaded again on first use.
    const done = new Set<object>();
    const free = (o: { dispose(): void } | null | undefined) => { if (o && !done.has(o)) { done.add(o); o.dispose(); } };
    const visit = (obj: THREE.Object3D) => obj.traverse((o) => {
      const m = o as THREE.Mesh;
      free(m.geometry);
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) free(v as THREE.Texture);
        // own uniforms (ShaderMaterial) and the renderer's per-material ones (e.g. three's global DFG LUT)
        const ru = (this.renderer.properties.get(mat) as { uniforms?: Record<string, THREE.IUniform> }).uniforms;
        for (const un of [(mat as THREE.ShaderMaterial).uniforms, ru]) {
          if (un) for (const u of Object.values(un)) if ((u?.value as THREE.Texture)?.isTexture) free(u.value as THREE.Texture);
        }
        free(mat);
      }
    });
    try {
      visit(this.scene); visit(this.ui.scene);
      if (this.scene.environment) free(this.scene.environment);
    } catch { /* best effort */ }
    this.layer.dispose();
    this.fx.dispose();
    this.shields.dispose();
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch { /* */ }
  }
}

const BLACK = [0, 0, 0] as const;
const WHITE = [1, 1, 1] as const;
const RED = rgb('#ff3a2a');
const YELLOW = rgb('#ffd24a');
const GOLD = rgb('#ffd24a');
const SHIELD_COL = rgb('#8fe0ff');
const PARA_COL = rgb('#4aa8ff');
const ICE_HI = rgb('#e6f6ff');
const ICE_LO = rgb('#7fd0ff');
const JAM_COL = rgb('#ffb02a');
const BAR_COL = [rgb(TEAM_PAL[0].bar), rgb(TEAM_PAL[1].bar)] as const;
type RGB = readonly [number, number, number];
void templateKey;
