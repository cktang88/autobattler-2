// FieldView3D: three.js battlefield renderer implementing BattleView (see render/view.ts).
// Orthographic camera tilted ~58 degrees so the 2D ground mapping (Camera/CameraControls from render/camera.ts) stays
// exact: worldToScreen/screenToWorld and match.ts's 2D overlays (range rings, labels) line up with the 3D ground.
// Scene axes: three x = field x (cells), three z = field y, three y = up (cells).

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { battleSfx, setPanFlip } from '../audio.ts';
import { DEPLOY_D, FIELD_H, FIELD_W } from '../../shared/grid.ts';
import { MODULE_BY_ID } from '../../shared/parts.ts';
import type { Battle } from '../../shared/sim/battle.ts';
import { DT, type BattleEvent, type SimProjectile, type SimUnit } from '../../shared/sim/types.ts';
import type { Side } from '../../shared/types.ts';
import { Camera, CameraControls } from '../render/camera.ts';
import type { BoardOverlay, BoardUnit } from '../render/field.ts';
import { MAPS, groundCanvas, surroundCanvas, SURROUND, type MapTheme } from '../render/ground.ts';
import { TEAM_PAL } from '../render/palette.ts';
import { flyHeight } from '../render/tilt.ts';
import type { BattleView } from '../render/view.ts';
import { instantiate, templateKey, type UnitInst } from './units-adapter.ts';

const ELEV = (58 * Math.PI) / 180;
const GUN_H = 0.55;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const normAng = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a: number, b: number, t: number) => a + normAng(b - a) * t;

interface Snap { x: number; y: number; angle: number; mounts: number[] }
interface UView { inst: UnitInst; key: string }
interface Fx { obj: THREE.Object3D; life: number; max: number; s0: number; s1: number; vel?: THREE.Vector3; kind: 'sprite' | 'beam' | 'ring'; a0: number }

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** beam / tracer colour by module visual */
function beamStyle(moduleId: string): { color: string; w: number } {
  const v = MODULE_BY_ID.get(moduleId)?.visual;
  switch (v) {
    case 'laser': return { color: '#ff5a4a', w: 0.07 };
    case 'heatray': return { color: '#ff8a2a', w: 0.14 };
    case 'plasma': return { color: '#e070ff', w: 0.16 };
    case 'tesla': case 'emp': return { color: '#9fc8ff', w: 0.07 };
    case 'slowbeam': case 'sonic': case 'gravity': return { color: '#5ec8ff', w: 0.1 };
    case 'rail': case 'gauss': return { color: '#9fb8ff', w: 0.09 };
    case 'repair': return { color: '#7dff9a', w: 0.07 };
    default: return { color: '#ffd890', w: 0.07 };
  }
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
  private dpr = 1;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2000);
  private sun = new THREE.DirectionalLight('#fff0d8', 3.1);
  private map: MapTheme = MAPS[0];
  private groundMesh: THREE.Mesh;
  private surroundMesh: THREE.Mesh;
  private groundTex: THREE.CanvasTexture | null = null;
  private surroundTex: THREE.CanvasTexture | null = null;
  private myZone: THREE.Mesh;
  private foeZone: THREE.Mesh;
  private grid: THREE.LineSegments;
  private hoverFill: THREE.Mesh;
  private hoverLine: THREE.LineLoop;
  private selLines: THREE.LineLoop[] = [];
  private glow = glowTexture();
  // unit pool + live instances
  private free = new Map<string, UnitInst[]>();
  private deployUsed: UnitInst[] = [];
  private bu = new Map<number, UView>();
  private wrecks: UnitInst[] = [];
  // battle state
  private battle: Battle | null = null;
  private lastTick = -1;
  private sinceTick = 0;
  private tickInterval = DT;
  private alpha = 1;
  private prevU = new Map<number, Snap>();
  private curU = new Map<number, Snap>();
  private prevP = new Map<number, { x: number; y: number; z: number; angle: number }>();
  private curP = new Map<number, { x: number; y: number; z: number; angle: number }>();
  private pending: BattleEvent[] = [];
  private usePush = false;
  private projMeshes = new Map<number, THREE.Object3D>();
  private fx: Fx[] = [];
  private time = 0;
  private flashA = 0;
  private shadowOn = true;
  private lastDraw = 0;

  constructor(canvas: HTMLCanvasElement, viewerSide: Side, opts?: { interactive?: boolean }) {
    this.canvas = canvas;
    this.viewerSide = viewerSide;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.controls = new CameraControls(this.cam, canvas, opts?.interactive !== false);
    this.cam.setAspect(this.ay);
    try { setPanFlip(viewerSide === 1); } catch { /* audio optional */ }

    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.32;
    pm.dispose();
    this.scene.add(new THREE.HemisphereLight('#a8bccb', '#4a4332', 0.55));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    const flat = (w: number, h: number, color: string, opacity: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.renderOrder = 2;
      return m;
    };
    this.groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_W, FIELD_H).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }));
    this.groundMesh.position.set(FIELD_W / 2, 0, FIELD_H / 2);
    this.groundMesh.receiveShadow = true;
    const SW = FIELD_W + SURROUND * 2, SH = FIELD_H + SURROUND * 2;
    this.surroundMesh = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }));
    this.surroundMesh.position.set(FIELD_W / 2, -0.04, FIELD_H / 2);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(FIELD_W + 0.6, 1.2, FIELD_H + 0.6), new THREE.MeshStandardMaterial({ color: '#1b1f23', roughness: 0.9 }));
    slab.position.set(FIELD_W / 2, -0.62, FIELD_H / 2);
    this.scene.add(this.surroundMesh, slab, this.groundMesh);

    const myTop = viewerSide === 0 ? FIELD_H - DEPLOY_D : 0;
    const enTop = viewerSide === 0 ? 0 : FIELD_H - DEPLOY_D;
    this.myZone = flat(FIELD_W, DEPLOY_D, TEAM_PAL[0].rim, 0.05);
    this.myZone.position.set(FIELD_W / 2, 0.03, myTop + DEPLOY_D / 2);
    this.foeZone = flat(FIELD_W, DEPLOY_D, TEAM_PAL[1].rim, 0.05);
    this.foeZone.position.set(FIELD_W / 2, 0.03, enTop + DEPLOY_D / 2);
    this.scene.add(this.myZone, this.foeZone);
    // zone front lines
    const line = (z: number, color: string) => {
      const l = flat(FIELD_W, 0.14, color, 0.7);
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
    this.grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: TEAM_PAL[0].accent, transparent: true, opacity: 0.16, depthWrite: false }));
    this.grid.visible = false;
    this.scene.add(this.grid);
    this.hoverFill = flat(1, 1, '#46e88a', 0.3);
    this.hoverFill.visible = false;
    this.hoverLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, z]) => new THREE.Vector3(x, 0.06, z))), new THREE.LineBasicMaterial({ color: '#46e88a' }));
    this.hoverLine.visible = false;
    this.scene.add(this.hoverFill, this.hoverLine);

    this.setMapNow(this.map);
    this.resize();
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
  private setMapNow(map: MapTheme): void {
    this.map = map;
    this.groundTex?.dispose();
    this.surroundTex?.dispose();
    const mk = (c: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    };
    this.groundTex = mk(groundCanvas(24, map));
    this.surroundTex = mk(surroundCanvas(map));
    (this.groundMesh.material as THREE.MeshStandardMaterial).map = this.groundTex;
    (this.groundMesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
    (this.surroundMesh.material as THREE.MeshStandardMaterial).map = this.surroundTex;
    (this.surroundMesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
    this.scene.background = new THREE.Color(map.void);
  }

  /* ---------------------------------------------------------------------------------------------- camera */

  resize(): void {
    const dpr = Math.min(1.5, typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);
    const cw = this.canvas.clientWidth || 300, ch = this.canvas.clientHeight || 400;
    this.dpr = dpr; this.cssW = cw; this.cssH = ch;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cw, ch, false);
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

  /** place the three camera + shadow frustum from the Camera state */
  private syncCamera(): void {
    const c = this.cam, k = c.k;
    const t = this.toVisual(c.cx, c.cy); // symmetric: visual centre -> world centre
    const e = this.tiltOn ? ELEV : Math.PI / 2;
    const s = this.viewerSide === 1 ? -1 : 1;
    const D = 400;
    this.camera.position.set(t.x, D * Math.sin(e), t.y + s * D * Math.cos(e));
    this.camera.up.set(0, 0, -s);
    this.camera.lookAt(t.x, 0, t.y);
    this.camera.left = -this.cssW / (2 * k); this.camera.right = this.cssW / (2 * k);
    this.camera.top = this.cssH / (2 * k); this.camera.bottom = -this.cssH / (2 * k);
    this.camera.updateProjectionMatrix();
    // sun follows the view so shadows stay sharp; mirrored for the flipped view
    const half = clamp(Math.max(this.cssW, this.cssH) / (2 * k) * 1.15, 14, 70);
    this.sun.position.set(t.x - s * 34, 46, t.y + s * 22);
    this.sun.target.position.set(t.x, 0, t.y);
    const sc = this.sun.shadow.camera;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 5; sc.far = 140;
    sc.updateProjectionMatrix();
  }

  private render(units: number): void {
    this.sun.castShadow = units <= 140;
    this.syncCamera();
    this.renderer.toneMappingExposure = 1.05 + this.flashA * 0.5 * clamp(this.flashScale, 0, 1);
    this.renderer.render(this.scene, this.camera);
  }

  /* ------------------------------------------------------------------------------------------ unit pool */

  private take(design: BoardUnit['design'], team: 0 | 1): UnitInst {
    const key = templateKey(design, team);
    const inst = this.free.get(key)?.pop() ?? instantiate(design, team);
    inst.setLook('normal');
    inst.root.visible = true;
    inst.root.position.set(0, 0, 0);
    inst.root.rotation.set(0, 0, 0);
    if (!inst.root.parent) this.scene.add(inst.root);
    return inst;
  }
  private give(inst: UnitInst): void {
    inst.root.visible = false;
    let l = this.free.get(inst.key);
    if (!l) this.free.set(inst.key, (l = []));
    l.push(inst);
  }
  private teamOf(side: Side): 0 | 1 { return side === this.viewerSide ? 0 : 1; }
  private clearBattle(): void {
    for (const v of this.bu.values()) this.give(v.inst);
    this.bu.clear();
    for (const w of this.wrecks) this.scene.remove(w.root);
    this.wrecks = [];
    for (const m of this.projMeshes.values()) this.scene.remove(m);
    this.projMeshes.clear();
    for (const f of this.fx) this.scene.remove(f.obj);
    this.fx = [];
    this.prevU.clear(); this.curU.clear(); this.prevP.clear(); this.curP.clear();
    this.pending = [];
  }

  /* ---------------------------------------------------------------------------------------------- board */

  drawBoard(units: BoardUnit[], overlay: BoardOverlay, time: number): void {
    this.checkSize();
    const dt = this.time ? clamp(time - this.time, 0, 0.1) : 0;
    this.time = time;
    if (this.battle) { this.battle = null; this.lastTick = -1; this.clearBattle(); }
    this.cam.update(dt);
    this.updateFx(dt);
    (this.myZone.material as THREE.MeshBasicMaterial).opacity = overlay.showZone ? 0.14 : 0.05;
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
    for (const i of this.deployUsed) this.give(i);
    this.deployUsed = [];
    let nSel = 0;
    for (const u of units) {
      const team = this.teamOf(u.side);
      const inst = this.take(u.design, team);
      this.deployUsed.push(inst);
      const ang = u.side === 0 ? -Math.PI / 2 : Math.PI / 2;
      inst.root.position.set(u.x, inst.flying ? flyHeight(inst.S) + 0.4 : 0, u.y);
      inst.root.rotation.y = -ang;
      inst.setLook(u.invalid ? 'invalid' : u.ghost ? 'ghost' : u.dim ? 'cloak' : 'normal');
      if (u.selected) this.selectionRing(nSel++, u.x, u.y, inst, ang, time);
    }
    this.hideSelRings(nSel);
    for (const w of this.wrecks) w.root.visible = false;
    this.render(units.length);
  }

  private selectionRing(i: number, x: number, y: number, inst: UnitInst, ang: number, time: number): void {
    let l = this.selLines[i];
    if (!l) {
      l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(a, 0.07, b))), new THREE.LineBasicMaterial({ color: TEAM_PAL[0].accent }));
      this.selLines[i] = l;
      this.scene.add(l);
    }
    l.visible = true;
    l.position.set(x, 0, y);
    l.rotation.y = -ang;
    l.scale.set(inst.L * 0.5 + 0.12, 1, inst.W * 0.5 + 0.12);
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
    this.clearBattle();
    this.battle = b;
    this.lastTick = -1;
    this.sinceTick = 0;
    this.grid.visible = false;
    this.hoverFill.visible = this.hoverLine.visible = false;
    this.hideSelRings(0);
    for (const i of this.deployUsed) this.give(i);
    this.deployUsed = [];
  }

  drawBattle(battle: Battle, frameDt: number): void {
    this.checkSize();
    const dt = clamp(frameDt, 0, 0.1);
    this.time += dt;
    if (battle !== this.battle || battle.tick < this.lastTick) this.reset(battle);
    let newTicks: BattleEvent[] | null = null;
    if (battle.tick !== this.lastTick) {
      if (this.lastTick >= 0) {
        const n = Math.max(1, battle.tick - this.lastTick);
        this.tickInterval = clamp(lerp(this.tickInterval, Math.max(this.sinceTick / n, 1 / 240) * n, 0.3), 1 / 120, 0.25);
      }
      this.prevU = this.curU; this.curU = new Map();
      for (const u of battle.units) if (u.alive) this.curU.set(u.id, { x: u.x, y: u.y, angle: u.angle, mounts: u.mounts.map((m) => m.angle) });
      if (this.lastTick < 0) this.prevU = new Map(this.curU);
      this.prevP = this.curP; this.curP = new Map();
      for (const p of battle.projectiles) this.curP.set(p.id, { x: p.x, y: p.y, z: p.z, angle: p.angle });
      this.lastTick = battle.tick;
      this.sinceTick = 0;
      if (!this.usePush) newTicks = battle.events;
    } else this.sinceTick += dt;
    this.alpha = clamp(this.sinceTick / this.tickInterval, 0, 1);

    const byId = new Map<number, SimUnit>();
    for (const u of battle.units) byId.set(u.id, u);
    const events = newTicks ?? this.pending;
    if (events.length) {
      for (const e of events) this.handleEvent(e, byId);
      if (!this.muted) try { battleSfx(events); } catch { /* audio optional */ }
      if (!newTicks) this.pending = [];
    }
    this.cam.update(dt);
    this.updateFx(dt);

    // units
    let alive = 0;
    for (const u of battle.units) {
      if (!u.alive) {
        const v = this.bu.get(u.id);
        if (v) { this.give(v.inst); this.bu.delete(u.id); }
        continue;
      }
      alive++;
      let v = this.bu.get(u.id);
      if (!v) {
        v = { inst: this.take(u.design, this.teamOf(u.side)), key: '' };
        this.bu.set(u.id, v);
      }
      this.poseUnit(u, v.inst);
    }
    this.syncProjectiles(battle.projectiles);
    this.flashA = Math.max(0, this.flashA - dt * 3);
    this.render(alive);
  }

  private poseUnit(u: SimUnit, inst: UnitInst): void {
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
    inst.root.visible = !enemyCloak;
    inst.setLook(ext.cloaked ? 'cloak' : 'normal');
    const h = u.flying ? flyHeight(inst.S) + 0.4 + Math.sin(this.time * 2.1 + u.id) * 0.05 : u.leap * 1.8 * inst.S;
    inst.root.position.set(x, h, y);
    inst.root.rotation.y = -ang;
    u.mounts.forEach((_, i) => {
      const t = inst.turrets[i];
      if (!t) return;
      if (!t.fixed) t.yaw.rotation.y = -normAng(mounts[i] - ang);
      t.recoil.position.x *= 0.88;
    });
  }

  private muzzleWorld(unit: number, mount: number, byId: Map<number, SimUnit>): THREE.Vector3 | null {
    const su = byId.get(unit), v = this.bu.get(unit);
    if (!su || !v) return null;
    const t = v.inst.turrets[mount];
    const m = t?.muzzles[0];
    if (!t || !m) return null;
    v.inst.root.updateMatrixWorld(true);
    return m.getWorldPosition(new THREE.Vector3());
  }

  /* ---------------------------------------------------------------------------------- projectiles / fx */

  private projPos(p: SimProjectile) {
    const c = this.curP.get(p.id), pr = this.prevP.get(p.id);
    if (!c) return p;
    if (!pr) return c;
    const a = this.alpha;
    return { x: lerp(pr.x, c.x, a), y: lerp(pr.y, c.y, a), z: lerp(pr.z, c.z, a), angle: lerpAngle(pr.angle, c.angle, a) };
  }

  private projMesh(p: SimProjectile): THREE.Object3D {
    const hot = p.kind === 'orb' ? '#7dffe6' : p.kind === 'flame' ? '#ff8a2a' : p.kind === 'shell' || p.kind === 'arc' ? '#ffb058' : p.kind === 'rocket' || p.kind === 'missile' ? '#ffd0a0' : '#ffe08a';
    const col = new THREE.Color(hot).multiplyScalar(2.5);
    const mat = new THREE.MeshBasicMaterial({ color: col, toneMapped: false });
    const cal = MODULE_BY_ID.get(p.moduleId)?.caliber ?? 0.5;
    let g: THREE.BufferGeometry;
    switch (p.kind) {
      case 'orb': g = new THREE.SphereGeometry(0.2 + 0.2 * cal, 10, 8); break;
      case 'flame': g = new THREE.SphereGeometry(0.25 + 0.2 * cal, 8, 6); break;
      case 'shell': case 'arc': g = new THREE.SphereGeometry(0.14 + 0.16 * cal, 10, 8); break;
      case 'rocket': case 'missile': g = new THREE.BoxGeometry(0.7, 0.12, 0.12); break;
      default: g = new THREE.BoxGeometry(0.8, 0.05 + 0.05 * cal, 0.05 + 0.05 * cal);
    }
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = 5;
    return m;
  }

  private syncProjectiles(list: SimProjectile[]): void {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let m = this.projMeshes.get(p.id);
      if (!m) { m = this.projMesh(p); this.projMeshes.set(p.id, m); this.scene.add(m); }
      const pos = this.projPos(p);
      m.position.set(pos.x, pos.z > 0.05 ? pos.z : GUN_H, pos.y);
      m.rotation.y = -pos.angle;
    }
    for (const [id, m] of this.projMeshes) {
      if (seen.has(id)) continue;
      this.scene.remove(m);
      const mesh = m as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.projMeshes.delete(id);
    }
  }

  private sprite(p: THREE.Vector3, size: number, color: string, life: number, grow = 1, vel?: THREE.Vector3, opacity = 1, additive = true): void {
    const mat = new THREE.SpriteMaterial({ map: this.glow, color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    const s = new THREE.Sprite(mat);
    s.position.copy(p);
    s.scale.setScalar(size);
    s.renderOrder = 6;
    this.scene.add(s);
    this.fx.push({ obj: s, life, max: life, s0: size, s1: size * grow, vel, kind: 'sprite', a0: opacity });
  }

  private beam(a: THREE.Vector3, b: THREE.Vector3, color: string, w: number, life = 0.12): void {
    const len = a.distanceTo(b);
    if (len < 0.01) return;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    m.position.copy(a).lerp(b, 0.5);
    m.scale.set(len, w, w);
    m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    m.rotation.z = Math.asin(clamp((b.y - a.y) / len, -1, 1));
    m.rotation.order = 'YZX';
    m.renderOrder = 6;
    this.scene.add(m);
    this.fx.push({ obj: m, life, max: life, s0: w, s1: w, kind: 'beam', a0: 1 });
  }

  private explosion(x: number, y: number, r: number): void {
    const p = new THREE.Vector3(x, 0.5 + r * 0.25, y);
    this.sprite(p, r * 3.2, '#fff2c0', 0.12, 1.3);
    this.sprite(p, r * 3.0, '#ff8a2a', 0.45, 1.5);
    for (let i = 0; i < 4 + Math.round(r * 2); i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * r * 0.7;
      this.sprite(new THREE.Vector3(x + Math.cos(a) * d, 0.4 + Math.random() * r * 0.4, y + Math.sin(a) * d), r * (1 + Math.random()), '#ff5a1a', 0.35 + Math.random() * 0.3, 1.5);
      this.sprite(new THREE.Vector3(x + Math.cos(a) * d, 0.6, y + Math.sin(a) * d), r * (1.4 + Math.random()), '#2a2724', 1.2 + Math.random() * 0.8, 2, new THREE.Vector3(0, 0.8, 0), 0.6, false);
    }
    // ground shockwave
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd8a0', transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.position.set(x, 0.08, y);
    this.scene.add(ring);
    this.fx.push({ obj: ring, life: 0.5, max: 0.5, s0: r * 0.3, s1: r * 1.6, kind: 'ring', a0: 0.6 });
    this.flashA = Math.min(1, this.flashA + Math.min(0.5, r * 0.08));
  }

  private handleEvent(e: BattleEvent, byId: Map<number, SimUnit>): void {
    switch (e.t) {
      case 'fire': {
        const m = this.muzzleWorld(e.unit, e.mount, byId) ?? new THREE.Vector3(e.x, GUN_H, e.y);
        const cal = MODULE_BY_ID.get(e.moduleId)?.caliber ?? 0.5;
        this.sprite(m, 0.4 + cal * 0.9, '#ffd890', 0.08);
        const t = this.bu.get(e.unit)?.inst.turrets[e.mount];
        if (t) t.recoil.position.x = -t.r * 0.18;
        break;
      }
      case 'beam': {
        const a = (e.unit !== undefined && e.mount !== undefined ? this.muzzleWorld(e.unit, e.mount, byId) : null) ?? new THREE.Vector3(e.x1, GUN_H, e.y1);
        const st = beamStyle(e.moduleId);
        this.beam(a, new THREE.Vector3(e.x2, GUN_H, e.y2), st.color, st.w);
        this.sprite(new THREE.Vector3(e.x2, GUN_H, e.y2), 0.5, st.color, 0.12);
        break;
      }
      case 'chain': {
        const st = beamStyle(e.moduleId);
        for (let i = 1; i < e.points.length; i++) {
          const p0 = e.points[i - 1], p1 = e.points[i];
          this.beam(new THREE.Vector3(p0.x, GUN_H, p0.y), new THREE.Vector3(p1.x, GUN_H + (Math.random() - 0.5) * 0.3, p1.y), st.color, st.w);
        }
        break;
      }
      case 'hit':
        this.sprite(new THREE.Vector3(e.x, 0.5, e.y), e.shieldHit ? 0.9 : 0.5, e.shieldHit ? '#7fd8ff' : '#ffc070', 0.15);
        break;
      case 'explode':
        this.explosion(e.x, e.y, Math.max(0.5, e.radius));
        break;
      case 'death': {
        const v = this.bu.get(e.unit);
        this.explosion(e.x, e.y, 0.8 + e.size * 0.7);
        if (v && !e.flying) {
          // the hull stays as a charred wreck for the rest of the battle
          this.bu.delete(e.unit);
          v.inst.setLook('wreck');
          v.inst.root.position.y = -0.05;
          this.wrecks.push(v.inst);
        } else if (v) { this.give(v.inst); this.bu.delete(e.unit); }
        void byId;
        break;
      }
      default:
    }
  }

  private updateFx(dt: number): void {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      const k = clamp(1 - f.life / f.max, 0, 1);
      if (f.kind === 'sprite') {
        const sp = f.obj as THREE.Sprite;
        sp.scale.setScalar(lerp(f.s0, f.s1, k));
        sp.material.opacity = f.a0 * (1 - k) * (1 - k * 0.3);
        if (f.vel) sp.position.addScaledVector(f.vel, dt);
      } else if (f.kind === 'beam') {
        ((f.obj as THREE.Mesh).material as THREE.Material).opacity = 1 - k;
      } else {
        f.obj.scale.setScalar(lerp(f.s0, f.s1, k));
        ((f.obj as THREE.Mesh).material as THREE.Material).opacity = f.a0 * (1 - k);
      }
      if (f.life <= 0) {
        this.scene.remove(f.obj);
        const o = f.obj as THREE.Mesh;
        if (f.kind !== 'sprite') o.geometry.dispose();
        (o.material as THREE.Material).dispose();
        this.fx.splice(i, 1);
      }
    }
  }

  destroy(): void {
    this.controls.destroy();
    this.groundTex?.dispose();
    this.surroundTex?.dispose();
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch { /* */ }
  }
}
