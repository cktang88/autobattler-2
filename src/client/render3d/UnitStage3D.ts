// UnitStage3D: one unit on a patch of battlefield ground, drawn exactly as the battlefield draws it, for the garage's
// designer stage (ui/garage.ts). Reuses the battle renderer's parts: the instanced unit layer (units-adapter: same
// template builder, team paint, wreck-free normal look, contact blobs, flyer height), the stage lights / sky / fog,
// the post chain (AO, bloom, grade) with the unit contact outline + edge light (outline3d), the fixed-sun shadow map
// (shadow3d) and the camera constants (view3d: FOV, pitch curve, sun).
//
//  * Render on demand: frame() draws only when the camera eases / is dragged, the design or a highlight changed, the
//    unit animates (rotors) or async textures arrive; otherwise the last frame stays on the canvas. The sun never moves,
//    so the shadow map is redrawn only when the unit changes.
//  * Sockets: every chassis mount gets a hull-local point (turret housing centre for a fitted mount, the deck under an
//    empty hardpoint, found by a ray down onto the hull) that is projected to CSS px after each render (geom()), with a
//    screen radius and an occlusion flag (ray from the camera hits the hull first), for the garage's HTML socket rings.
//  * Highlights: the hovered / targeted socket's turret meshes get an additive tint (plus a faint x-ray pass so a
//    turret behind the hull still shows); an empty socket gets a glowing ring on the deck.
//  * One WebGL context, released by dispose().

import * as THREE from 'three';
import type { Design } from '../../shared/types.ts';
import { CHASSIS_BY_ID } from '../../shared/parts.ts';
import { approxTurretD, bodyScale, mountOffsets } from '../../shared/mountgeo.ts';
import { flyHeight } from '../render/tilt.ts';
import { MAPS, type MapTheme } from '../render/ground.ts';
import { TEAM_PAL } from '../render/palette.ts';
import { UnitLayer, buildTerrain, createRenderer, setSurfaceDetail, setupPost, setupStage, surfaceDetailReady, type Post, type Rig } from './units-adapter.ts';
import { UnitOutline } from './outline3d.ts';
import { SunShadow } from './shadow3d.ts';
import { FOV, SUN } from './view3d.ts';
import { OrbitCam, fitK, project, radiusPx, type V3 } from './stage-math.ts';

/** a socket on screen: centre + ring radius (CSS px), hidden behind the hull from this angle */
export interface StageMount { x: number; y: number; r: number; occ: boolean }
/** same shape as render/field.ts PreviewGeom (the garage's socket placement reads either) */
export interface StageGeom {
  px: number; cx: number; cy: number; mounts: StageMount[]; S: number; fw: number; fl: number; half: number;
}
export interface StageRing { r: number; min: number; color: string; label: string; mounts: number[]; melee: boolean }
export type HighlightTone = 'hover' | 'hot' | 'bad' | 'active';
const TONE: Record<HighlightTone, string> = { hover: '#35d6bf', hot: '#ffb21e', bad: '#ff4a3a', active: '#ffb21e' };

/** the unit faces up the screen at the default turn, as the side-0 player's units do */
const FACING = -Math.PI / 2;
/** auto-turn speed while the player has not touched the stage yet (rad/s) and its frame interval (ms) */
const SPIN = 0.16;
const ANIM_MS = 33;
/** unit templates kept before the layer is rebuilt (see setDesign) */
const MAX_TEMPLATES = 12;

interface MountPt {
  /** template-local point (cells, before body scale) */
  p: THREE.Vector3;
  /** ring radius, template-local */
  r: number;
  /** template mesh indices of this mount's turret (empty: no module fitted) */
  meshes: number[];
  /** template meshes that never count as occluders for this socket (its own turret) */
  own: Set<THREE.Object3D>;
}

/** small battlefield-ground patch: built once per session (fbm terrain is CPU work) */
let groundCache: { group: THREE.Group; map: string } | null = null;
function groundFor(map: MapTheme): THREE.Group {
  if (groundCache?.map === map.id) return groundCache.group;
  const b = buildTerrain(14, 14, { seed: map.seed * 13 + 5, ppc: 14, grid: false, zoneFrac: 0, props: false });
  // the battlefield's per-map restyle (FieldView3D terrainFor): multiply the base by the theme's mid ramp colour
  const c1 = new THREE.Color().setRGB(map.ramp[1][0] / 255, map.ramp[1][1] / 255, map.ramp[1][2] / 255, THREE.SRGBColorSpace);
  const ref = new THREE.Color().setRGB(120 / 255, 108 / 255, 84 / 255, THREE.SRGBColorSpace);
  const cl = (v: number) => Math.max(0.35, Math.min(2, v));
  const tint = new THREE.Color(cl(c1.r / ref.r), cl(c1.g / ref.g), cl(c1.b / ref.b));
  b.group.children.forEach((o, i) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m?.color) m.color.copy(tint).multiplyScalar(i === 0 ? 1 : 0.8);
  });
  groundCache = { group: b.group, map: map.id };
  return b.group;
}

export class UnitStage3D {
  readonly canvas: HTMLCanvasElement;
  readonly cam = new OrbitCam();
  /** extra view extent (cells) the stage must fit, e.g. weapon ranges */
  minExtent = 3.4;
  /** pause the idle auto-turn (pointer over the stage, a part being dragged) */
  hold = false;
  /** set when the WebGL context is lost: the garage falls back to the 2D blueprint */
  onLost: (() => void) | null = null;
  lost = false;
  private auto = true;
  private autoAt = 0;
  private slowMs = 33;
  private slowN = 0;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 2000);
  private post: Post;
  private outline = new UnitOutline();
  private sunShadow: SunShadow;
  private sun: THREE.DirectionalLight;
  private layer = new UnitLayer();
  private shadowsOn: boolean;
  private textures: boolean;
  private rig: Rig | null = null;
  private sig = '';
  private design: Design | null = null;
  private pts: MountPt[] = [];
  private occluders: THREE.Mesh[] = [];
  private pos = new THREE.Vector3();
  private bs = 1;
  private target: V3 = [0, 0, 0];
  private unitExt = 3;
  private unitR = 1;
  private cssW = 0;
  private cssH = 0;
  private dirty = true;
  private shadowDirty = true;
  private lastNow = 0;
  private lastDraw = 0;
  private time = 0;
  /** keep redrawing now and then until this time (async surface / skin textures) */
  private refreshUntil = 0;
  private texReady = false;
  private occ: boolean[] = [];
  private occAt = -1e9;
  private occStale = true;
  private out: StageGeom | null = null;
  private hlKey = '';
  private hlMount: number | null = null;
  private hl = new THREE.Group();
  private hlMats = new Map<string, THREE.MeshBasicMaterial>();
  private ringGeo = new THREE.TorusGeometry(1, 0.07, 8, 48).rotateX(Math.PI / 2);
  private rings = new THREE.Group();
  private ringKey = '';
  private ringDefs: { c: V3; r: number; label: string; color: string }[] = [];
  private deco = new THREE.Group();
  private decoKey = '';
  private ray = new THREE.Raycaster();
  private v = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  private onLostEv: (e: Event) => void;

  constructor(canvas: HTMLCanvasElement, opts: { shadows?: boolean; textures?: boolean } = {}) {
    this.canvas = canvas;
    this.shadowsOn = opts.shadows !== false;
    this.textures = opts.textures !== false;
    this.renderer = createRenderer(canvas);
    const d = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    this.renderer.setPixelRatio(Math.min(1.5, d));
    const toSun: V3 = [-SUN[0], SUN[1], SUN[2]];
    const stage = setupStage(this.renderer, this.scene, { fog: true, shadowRes: 2048, sun: toSun });
    this.sun = stage.sun;
    this.outline.sun = this.sun;
    this.sunShadow = new SunShadow(this.sun, toSun, [0, 0, 0]);
    this.renderer.shadowMap.autoUpdate = false;
    this.post = setupPost(this.renderer, this.scene, this.camera, 512, 512, { ao: true, bloom: true, grade: true });
    this.outline.install(this.post.composer.passes, (p, i) => this.post.composer.insertPass(p, i));
    if (this.post.bloom) this.post.bloom.strength = 0.34;
    // ground: the battlefield's terrain look, tinted for the default map, with the battle haze
    const map = MAPS[0];
    const ground = groundFor(map).clone(true);
    this.scene.add(ground);
    const haze = new THREE.Color(map.void).lerp(new THREE.Color('#a7b6c4'), 0.5);
    this.scene.background = haze;
    if (this.scene.fog) (this.scene.fog as THREE.Fog).color.copy(haze);
    this.layer.setShadowTier(this.shadowsOn ? 0 : Infinity);
    this.scene.add(this.deco, this.layer.group, this.rings, this.hl);
    this.onLostEv = (e: Event) => { e.preventDefault(); this.lost = true; this.onLost?.(); };
    canvas.addEventListener('webglcontextlost', this.onLostEv);
  }

  /* ------------------------------------------------------------------------------------------------ design */

  /** Show `d` (rebuilds only when the hull / drive / fitted parts change). */
  setDesign(d: Design): void {
    const sig = `${d.id}|${d.chassis}|${d.mobility}|${d.mounts.join(',')}`;
    if (sig === this.sig && this.rig) { this.design = d; return; }
    this.sig = sig;
    this.design = d;
    if (this.rig) this.layer.release(this.rig);
    // every edit is a new template (geometry for the whole hull): start a fresh layer now and then, so a long design
    // session does not pile up dozens of unit models on the GPU
    if (this.layer.stats.templates >= MAX_TEMPLATES) this.newLayer();
    const rig = this.layer.acquire(d, 0);
    this.rig = rig;
    this.bs = bodyScale(rig.S);
    this.pos.set(0, rig.flying ? flyHeight(rig.S, rig.jet) + 0.4 : 0, 0);
    rig.root.position.copy(this.pos);
    rig.root.rotation.set(0, -FACING, 0);
    rig.update(0);
    this.buildMounts(d, rig);
    const tpl = rig.tpl;
    // framing: the hull's horizontal reach and height at battle scale
    const box = new THREE.Box3().setFromObject(tpl.unit.root);
    const R = Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z) * this.bs;
    const H = Math.max(0.3, box.max.y) * this.bs;
    this.unitR = Math.max(R, H * 0.6, 0.3);
    this.unitExt = Math.max(2.3 * R, 1.7 * H, 1.2);
    this.target = [0, rig.flying ? this.pos.y + rig.midY : Math.min(H * 0.42, 1.6), 0];
    this.fitShadow(R, H);
    this.decoKey = '';
    // highlights and rings belong to the old hull: drop them (the garage re-applies its current ones)
    this.setHighlight(null);
    const rings = this.ringKey;
    this.ringKey = rings ? 'stale' : '';
    this.occStale = true;
    this.dirty = this.shadowDirty = true;
    this.refreshUntil = performance.now() + 2500;
  }

  private newLayer(): void {
    const old = this.layer;
    const geos = new Set<THREE.BufferGeometry>();
    old.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) geos.add(m.geometry); });
    this.scene.remove(old.group);
    old.dispose();
    for (const g of geos) g.dispose();
    this.layer = new UnitLayer();
    this.layer.setShadowTier(this.shadowsOn ? 0 : Infinity);
    this.scene.add(this.layer.group);
    this.rig = null;
  }

  private buildMounts(d: Design, rig: Rig): void {
    const tpl = rig.tpl, u = tpl.unit;
    const ch = CHASSIS_BY_ID.get(d.chassis)!;
    const offs = mountOffsets(d);
    u.root.updateMatrixWorld(true);
    this.occluders = tpl.meshes.filter((m, j) => {
      const mat = m.material as THREE.Material;
      return !tpl.isBlob[j] && !mat.transparent && !(mat.alphaTest > 0);
    });
    const top = new THREE.Box3().setFromObject(u.root).max.y + 2;
    this.pts = ch.mounts.map((cls, i) => {
      const ti = tpl.mountTurret[i] ?? -1;
      const tu = ti >= 0 ? u.turrets[ti] : undefined;
      if (tu) {
        // this weapon's own parts only: not the pods riding it (their own sockets) nor a mech torso built into its yaw
        const others = new Set<THREE.Object3D>(u.turrets.filter((t) => t !== tu).map((t) => t.yaw));
        const b = new THREE.Box3();
        const own = new Set<THREE.Object3D>();
        const meshes: number[] = [];
        const walk = (o: THREE.Object3D): void => {
          if (others.has(o) || o.userData.torso) return;
          own.add(o);
          const j = tpl.meshes.indexOf(o as THREE.Mesh);
          if (j >= 0) { b.expandByObject(o, false); if (!tpl.isBlob[j]) meshes.push(j); }
          for (const c of o.children) walk(c);
        };
        walk(tu.yaw);
        const p = b.isEmpty() ? new THREE.Vector3().setFromMatrixPosition(tu.yaw.matrixWorld) : b.getCenter(new THREE.Vector3());
        // the ring sits on the housing (the barrel's length does not count): over the yaw pivot, or over the weapon's
        // trunnion when the weapon hangs off a torso away from the pivot
        const torso = tu.yaw.children.some((c) => c.userData.torso);
        const p2 = new THREE.Vector3().setFromMatrixPosition((torso ? tu.pitch : tu.yaw).matrixWorld);
        p.x = p2.x; p.z = p2.z;
        return { p, r: Math.max(0.12, tu.r), meshes, own };
      }
      const o = offs[i] ?? { x: 0, y: 0 };
      // the deck under the hardpoint: first hull surface straight down
      this.ray.set(this.v.set(o.x, top, o.y), new THREE.Vector3(0, -1, 0));
      this.ray.far = top + 5;
      const hit = this.ray.intersectObjects(this.occluders, false)[0];
      const y = hit ? hit.point.y + 0.03 : top * 0.4;
      return { p: new THREE.Vector3(o.x, y, o.y), r: Math.max(0.12, approxTurretD(cls, rig.S) * 0.5), meshes: [], own: new Set() };
    });
    this.occ = this.pts.map(() => false);
  }

  private fitShadow(R: number, H: number): void {
    const e = R + 2.5, pts: number[] = [];
    for (const [x, z] of [[-e, -e], [e, -e], [e, e], [-e, e]]) for (const y of [0, H + this.pos.y]) pts.push(x, y, z);
    this.sunShadow.fit(pts);
  }

  /* ---------------------------------------------------------------------------------------------- overlays */

  /** Light up one socket's turret (or deck ring when empty); null clears. */
  setHighlight(mount: number | null, tone: HighlightTone = 'hover'): void {
    const key = mount === null ? '' : `${this.sig}|${mount}|${tone}`;
    if (key === this.hlKey) return;
    this.hlKey = key;
    this.hlMount = mount;
    for (const c of [...this.hl.children]) { this.hl.remove(c); }
    this.dirty = true;
    const rig = this.rig, pt = mount === null ? undefined : this.pts[mount];
    if (!rig || !pt) return;
    const col = TONE[tone];
    if (pt.meshes.length) {
      for (const j of pt.meshes) {
        const src = rig.tpl.meshes[j];
        for (const xray of [false, true]) {
          const m = new THREE.Mesh(src.geometry, this.hlMat(col, xray));
          m.matrixAutoUpdate = false;
          m.matrixWorldAutoUpdate = false;
          m.frustumCulled = false;
          m.renderOrder = xray ? 6 : 5;
          m.userData.j = j;
          this.hl.add(m);
        }
      }
    } else {
      for (const xray of [false, true]) {
        const ring = new THREE.Mesh(this.ringGeo, this.hlMat(col, xray));
        ring.userData.ring = true;
        ring.renderOrder = xray ? 6 : 5;
        this.hl.add(ring);
      }
    }
  }

  private hlMat(col: string, xray: boolean): THREE.MeshBasicMaterial {
    const k = col + (xray ? 'x' : '');
    let m = this.hlMats.get(k);
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        color: col, transparent: true, opacity: xray ? 0.16 : 0.42, blending: THREE.AdditiveBlending, depthWrite: false,
        depthTest: !xray, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      });
      this.hlMats.set(k, m);
    }
    return m;
  }

  /** Weapon reach rings on the ground (null = off): measured from each weapon's mount, as on the battlefield. */
  setRings(rings: StageRing[] | null): void {
    const key = rings ? `${this.sig}|` + rings.map((o) => `${o.r},${o.min},${o.color},${o.label},${o.mounts.join(':')},${o.melee}`).join(';') : '';
    if (key === this.ringKey) return;
    this.ringKey = key;
    this.dirty = true;
    for (const c of [...this.rings.children]) { this.rings.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    this.ringDefs = [];
    if (!rings || !this.rig) return;
    const flat = (inner: number, outer: number, color: string, opacity: number) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(Math.max(0, inner), outer, 128, 1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.renderOrder = 2;
      return m;
    };
    rings.forEach((o) => {
      const ps = o.melee ? [] : o.mounts.map((i) => this.mountGround(i)).filter((p): p is V3 => !!p);
      const c: V3 = ps.length ? [ps.reduce((a, p) => a + p[0], 0) / ps.length, 0, ps.reduce((a, p) => a + p[2], 0) / ps.length] : [this.pos.x, 0, this.pos.z];
      const w = Math.max(0.035, o.r * 0.006);
      const g = new THREE.Group();
      g.position.set(c[0], 0.045, c[2]);
      g.add(flat(o.min, o.r, o.color, 0.1), flat(o.r - w, o.r + w, o.color, 0.9));
      if (o.min) g.add(flat(o.min - w * 0.6, o.min + w * 0.6, o.color, 0.6));
      this.rings.add(g);
      this.ringDefs.push({ c, r: o.r, label: o.label, color: o.color });
    });
  }

  /** ring label anchors (CSS px), staggered along the far side of each ring as seen now */
  ringLabels(): { x: number; y: number; label: string; color: string }[] {
    if (!this.ringDefs.length) return [];
    this.placeCamera();
    const vp = this.m4.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    const up = Math.atan2(-Math.cos(this.cam.yaw), Math.sin(this.cam.yaw)); // ground direction of screen-up
    return this.ringDefs.map((o, i) => {
      const a = up + (i % 2 ? 0.42 : -0.42) * Math.ceil(i / 2);
      const s = project(vp, [o.c[0] + Math.cos(a) * o.r, 0.05, o.c[2] + Math.sin(a) * o.r], this.cssW, this.cssH);
      return { x: s.x, y: s.y, label: o.label, color: o.color };
    });
  }

  /** battle-scale ground point under mount i */
  private mountGround(i: number): V3 | null {
    const pt = this.pts[i], rig = this.rig;
    if (!pt || !rig) return null;
    this.v.copy(pt.p).applyMatrix4(rig.root.matrix);
    return [this.v.x, 0, this.v.z];
  }

  /** footprint outline and a faint cell grid around it (the deploy grid's look), rebuilt per hull */
  private buildDeco(): void {
    const d = this.design, rig = this.rig;
    if (!d || !rig) return;
    const key = `${d.chassis}|${Math.ceil(this.unitExt)}`;
    if (key === this.decoKey) return;
    this.decoKey = key;
    for (const c of [...this.deco.children]) { this.deco.remove(c); const l = c as THREE.Line; l.geometry.dispose(); (l.material as THREE.Material).dispose(); }
    const ch = CHASSIS_BY_ID.get(d.chassis)!;
    const fw = ch.footprint?.[0] ?? ch.size, fl = ch.footprint?.[1] ?? ch.size;
    // nose up-screen (-z): the footprint's width runs along x
    const x0 = -fw / 2, z0 = -fl / 2, n = Math.ceil(this.unitExt / 2) + 3;
    const pts: number[] = [];
    for (let i = -n; i <= fw + n; i++) pts.push(x0 + i, 0.03, z0 - n, x0 + i, 0.03, z0 + fl + n);
    for (let j = -n; j <= fl + n; j++) pts.push(x0 - n, 0.03, z0 + j, x0 + fw + n, 0.03, z0 + j);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: TEAM_PAL[0].accent, transparent: true, opacity: 0.13, depthWrite: false }));
    const fg = new THREE.BufferGeometry().setFromPoints([[0, 0], [fw, 0], [fw, fl], [0, fl]].map(([a, b]) => new THREE.Vector3(x0 + a, 0.04, z0 + b)));
    const foot = new THREE.LineLoop(fg, new THREE.LineDashedMaterial({ color: '#ffb000', dashSize: 0.22, gapSize: 0.14, transparent: true, opacity: 0.75, depthWrite: false }));
    foot.computeLineDistances();
    // FRONT: a chevron arrow on the ground just ahead of the footprint, pointing the way the hull faces (-z)
    const s = Math.max(0.28, Math.min(1.2, Math.min(fw, fl) * 0.26)), az = z0 - 0.12 - s;
    const arrow = new THREE.Shape([
      [0, -s], [s * 0.9, 0], [s * 0.42, 0], [s * 0.42, s * 0.75], [-s * 0.42, s * 0.75], [-s * 0.42, 0], [-s * 0.9, 0],
    ].map(([x, y]) => new THREE.Vector2(x, y)));
    const ag = new THREE.ShapeGeometry(arrow);
    ag.rotateX(Math.PI / 2); // shape y -> world z (tip at -z)
    const am = new THREE.Mesh(ag, new THREE.MeshBasicMaterial({ color: '#ffb000', transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    am.position.set(0, 0.045, az);
    am.renderOrder = 2;
    this.deco.add(grid, foot, am);
  }

  /* ------------------------------------------------------------------------------------------------ input */

  /** the player took the camera: the idle auto-turn stops for good */
  touched(): void { this.auto = false; }
  orbit(dx: number, dy: number): void { this.touched(); this.cam.orbit(dx, dy); this.dirty = true; }
  pan(dx: number, dy: number): void { this.touched(); this.cam.panBy(dx, dy); this.dirty = true; }
  zoomBy(f: number): void { this.touched(); this.cam.zoomBy(f); }
  reset(): void { this.touched(); this.cam.reset(); }

  /* ----------------------------------------------------------------------------------------------- render */

  private checkSize(): boolean {
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (cw < 2 || ch < 2) return false;
    if (cw !== this.cssW || ch !== this.cssH) {
      this.cssW = cw; this.cssH = ch;
      this.renderer.setSize(cw, ch, false);
      this.post.setSize(cw, ch);
      this.dirty = true;
      this.occStale = true;
    }
    return true;
  }

  private placeCamera(): void {
    const c = this.camera, pose = this.cam.pose(this.cssH, this.target);
    c.aspect = this.cssW / Math.max(1, this.cssH);
    c.near = Math.max(0.3, pose.D * 0.05);
    c.far = pose.D * 4 + 300;
    c.position.set(...pose.pos);
    c.up.set(...pose.up);
    c.lookAt(this.target[0] + this.cam.px, this.target[1], this.target[2] + this.cam.pz);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }

  /** Advance the camera and draw if anything changed. Returns true when a new frame was drawn (sockets moved). */
  frame(now: number): boolean {
    if (this.lost || !this.rig || !this.checkSize()) { this.lastNow = now; return false; }
    const dt = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 0.016;
    this.lastNow = now;
    this.time += dt;
    // fit: the 2D blueprint's scale (small units stay small next to the grid), eased when the hull or ranges change
    this.cam.tfitK = fitK(this.cssW, this.cssH, Math.max(this.minExtent, this.unitExt));
    if (!this.out) this.cam.fitK = this.cam.tfitK;
    this.cam.panMax = Math.max(1.5, Math.max(this.minExtent, this.unitExt) / 2);
    let moving = this.cam.update(dt);
    if (this.auto && !this.hold) {
      if (!this.autoAt) this.autoAt = now;
      // start turning after a short look at the default view
      if (now - this.autoAt > 1500) { this.cam.yaw = this.cam.tyaw = this.cam.yaw + SPIN * dt; moving = true; }
    }
    const animates = this.rig.flying && this.rig.tpl.animates;
    const due = now - this.lastDraw >= ANIM_MS;
    if (!this.texReady && surfaceDetailReady()) { this.texReady = true; this.dirty = true; }
    const refresh = now < this.refreshUntil && now - this.lastDraw > 350;
    const idleMove = moving && this.auto && !this.hold && this.cam.zoom === this.cam.tzoom;
    if (!(this.dirty || (moving && (!idleMove || due)) || (animates && due) || refresh)) {
      // settled: one occlusion pass at rest (cheap enough once; throttled while moving)
      if (this.occStale) { this.occStale = false; this.updateOcclusion(); this.computeGeom(); return true; }
      return false;
    }
    // a machine that can't keep the idle turn smooth (software GL, weak GPU) stops it: the stage then only draws on input
    if (idleMove && this.lastDraw) {
      this.slowMs += (now - this.lastDraw - this.slowMs) * 0.2;
      if (this.slowMs > 70 && ++this.slowN > 8) this.auto = false;
    }
    this.draw(dt, animates);
    if (moving) this.occStale = true;
    if (this.occStale && now - this.occAt > 140) { this.occAt = now; this.updateOcclusion(); this.occStale = moving; }
    this.computeGeom();
    this.lastDraw = now;
    this.dirty = false;
    return true;
  }

  private draw(dt: number, animates: boolean): void {
    const rig = this.rig!;
    setSurfaceDetail(this.textures);
    this.buildDeco();
    this.placeCamera();
    const D = this.cam.distance(this.cssH);
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog) { fog.near = D * 0.8 + 10; fog.far = D * 3.2 + 40; }
    if (animates) { rig.locomote(0, false, this.time, dt); this.shadowDirty = true; }
    rig.update(dt);
    this.layer.submit(rig, 'normal');
    this.layer.flush();
    for (const o of this.hl.children) {
      const m = o as THREE.Mesh;
      if (m.userData.ring) {
        const pt = this.hlMount === null ? undefined : this.pts[this.hlMount];
        if (pt) {
          this.v.copy(pt.p).applyMatrix4(rig.root.matrix);
          m.position.copy(this.v);
          m.scale.setScalar(pt.r * this.bs * 1.05);
        }
      } else {
        rig.meshMatrix(m.userData.j as number, m.matrix);
        m.matrixWorld.copy(m.matrix);
      }
    }
    const shadow = this.shadowsOn;
    this.sun.castShadow = shadow;
    this.renderer.shadowMap.enabled = shadow;
    this.renderer.shadowMap.needsUpdate = shadow && this.shadowDirty;
    this.shadowDirty = false;
    this.outline.renderMask(this.renderer, this.scene, this.camera);
    this.post.render();
  }

  /** ray from the camera to each socket: does the hull (not the socket's own turret) get in the way? */
  private updateOcclusion(): void {
    const rig = this.rig;
    if (!rig || !this.cssW) return;
    this.placeCamera();
    const inv = this.m4.copy(rig.root.matrix).invert();
    const eye = new THREE.Vector3().copy(this.camera.position).applyMatrix4(inv);
    const dir = new THREE.Vector3();
    this.pts.forEach((pt, i) => {
      dir.copy(pt.p).sub(eye);
      const dist = dir.length();
      dir.divideScalar(dist || 1);
      this.ray.set(eye, dir);
      this.ray.far = Math.max(0, dist - Math.max(0.08, pt.r * 0.5));
      const hits = this.ray.intersectObjects(this.occluders, false);
      this.occ[i] = hits.some((h) => !pt.own.has(h.object));
    });
  }

  private computeGeom(): void {
    const rig = this.rig, d = this.design;
    if (!rig || !d) { this.out = null; return; }
    this.placeCamera();
    const vp = this.m4.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    const W = this.cssW, H = this.cssH;
    const mounts = this.pts.map((pt, i) => {
      this.v.copy(pt.p).applyMatrix4(rig.root.matrix);
      const s = project(vp, [this.v.x, this.v.y, this.v.z], W, H);
      return { x: s.x, y: s.y, r: radiusPx(pt.r * this.bs, s.w, H), occ: !!this.occ[i] };
    });
    const c = project(vp, [this.target[0], this.target[1], this.target[2]], W, H);
    const ch = CHASSIS_BY_ID.get(d.chassis)!;
    this.out = {
      px: this.cam.k, cx: c.x, cy: c.y, mounts, S: rig.S, fw: ch.footprint?.[0] ?? ch.size, fl: ch.footprint?.[1] ?? ch.size,
      half: radiusPx(this.unitR, c.w, H),
    };
  }

  /** socket geometry of the last drawn frame (after setDesign: computed now, without drawing) */
  geom(): StageGeom | null {
    if (!this.rig || !this.checkSize()) return null;
    if (!this.out || this.dirty) this.computeGeom();
    return this.out;
  }

  /** current zoom relative to the fit view (for the zoom readout) */
  get zoom(): number { return this.cam.tzoom; }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLostEv);
    this.outline.dispose();
    // free this renderer's GPU copies of everything it drew (shared caches keep their CPU data; see FieldView3D.destroy)
    const done = new Set<object>();
    const free = (o: { dispose(): void } | null | undefined) => { if (o && !done.has(o)) { done.add(o); o.dispose(); } };
    try {
      for (const c of [...this.hl.children]) this.hl.remove(c);
      this.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) free(m.geometry);
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) {
          for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) free(v as THREE.Texture);
          const ru = (this.renderer.properties.get(mat) as { uniforms?: Record<string, THREE.IUniform> }).uniforms;
          for (const un of [(mat as THREE.ShaderMaterial).uniforms, ru]) {
            if (un) for (const u of Object.values(un)) if ((u?.value as THREE.Texture)?.isTexture) free(u.value as THREE.Texture);
          }
          free(mat);
        }
      });
      if (this.scene.environment) free(this.scene.environment);
      for (const m of this.hlMats.values()) free(m);
      free(this.ringGeo);
    } catch { /* best effort */ }
    this.layer.dispose();
    this.post.composer.dispose();
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch { /* */ }
    this.rig = null;
  }
}
