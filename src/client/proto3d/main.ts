// Standalone 3D prototype: a battlefield slice with starter designs built procedurally from their part data.
// Not wired into the game. Build: `npm run build:proto3d` -> public/proto3d.js, open public/proto3d.html.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { STARTER_DESIGNS } from '../../shared/starters.ts';
import { CHASSIS_BY_ID, MOBILITY_BY_ID } from '../../shared/parts.ts';
import { TEAM_PAL } from '../render/palette.ts';
import { buildUnit, type Unit3D } from './units3d.ts';
import { rng } from './materials.ts';
import type { Turret } from './weapons3d.ts';

const params = new URLSearchParams(location.search);
const has = (k: string, d = false) => (params.has(k) ? params.get(k) !== '0' : d);

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // hard-edged sun shadows
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a2c27');
scene.fog = new THREE.Fog('#2a2c27', 90, 220);
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.32;

// ---- camera: low-FOV perspective at a Mechabellum-like tilt ------------------------------------
const camera = new THREE.PerspectiveCamera(Number(params.get('fov') ?? 24), 1, 1, 400);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = THREE.MathUtils.degToRad(82);
controls.minDistance = 6;
controls.maxDistance = 160;
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
function setView(tx: number, tz: number, dist: number, tiltDeg = 58, yawDeg = 0) {
  const tilt = THREE.MathUtils.degToRad(tiltDeg), yaw = THREE.MathUtils.degToRad(yawDeg);
  controls.target.set(tx, 0, tz);
  camera.position.set(tx + Math.sin(yaw) * Math.cos(tilt) * dist, Math.sin(tilt) * dist, tz + Math.cos(yaw) * Math.cos(tilt) * dist);
  controls.update();
}
(window as unknown as Record<string, unknown>).setView = setView;
setView(Number(params.get('x') ?? -3), Number(params.get('z') ?? 0), Number(params.get('d') ?? 62), Number(params.get('tilt') ?? 58), Number(params.get('yaw') ?? 0));

// ---- sun ---------------------------------------------------------------------------------------
const sun = new THREE.DirectionalLight('#fff0d8', 3.1);
sun.position.set(-34, 46, -22);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = -44; sc.right = 44; sc.top = 44; sc.bottom = -44; sc.near = 10; sc.far = 130;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);
scene.add(new THREE.HemisphereLight('#a8bccb', '#4a4332', 0.55));

// ---- ground ------------------------------------------------------------------------------------
const FX = 60, FZ = 38; // field slice, cells
function makeGround(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const PPC = 56;
  const w = FX * PPC, h = FZ * PPC;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const b = document.createElement('canvas'); b.width = w; b.height = h;
  const g = c.getContext('2d')!, gb = b.getContext('2d')!;
  const r = rng(99);
  g.fillStyle = '#625e49'; g.fillRect(0, 0, w, h);
  gb.fillStyle = '#808080'; gb.fillRect(0, 0, w, h);
  // large soft terrain variation
  for (let i = 0; i < 260; i++) {
    const x = r() * w, y = r() * h, rad = 60 + r() * 260;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const t = r();
    gr.addColorStop(0, t < 0.4 ? 'rgba(108,96,66,0.22)' : t < 0.75 ? 'rgba(78,84,58,0.18)' : 'rgba(128,118,92,0.2)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    const gg = gb.createRadialGradient(x, y, 0, x, y, rad);
    gg.addColorStop(0, `rgba(${r() < 0.5 ? 255 : 0},${r() < 0.5 ? 255 : 0},128,0.08)`); gg.addColorStop(1, 'rgba(128,128,128,0)');
    gb.fillStyle = gg; gb.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // gravel speckle
  for (let i = 0; i < 350000; i++) {
    const v = r();
    const x = r() * w, y = r() * h, s = 0.8 + r() * r() * 2.2;
    g.fillStyle = v < 0.5 ? `rgba(30,28,20,${0.08 + r() * 0.12})` : `rgba(200,190,160,${0.05 + r() * 0.1})`;
    g.fillRect(x, y, s, s);
    gb.fillStyle = v < 0.5 ? 'rgba(60,60,60,0.35)' : 'rgba(210,210,210,0.3)';
    gb.fillRect(x, y, s, s);
  }
  // craters
  for (let i = 0; i < 14; i++) {
    const x = r() * w, y = r() * h, rad = 30 + r() * 70;
    const gr = g.createRadialGradient(x, y, rad * 0.2, x, y, rad);
    gr.addColorStop(0, 'rgba(30,26,18,0.55)'); gr.addColorStop(0.7, 'rgba(40,34,24,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
    const gg = gb.createRadialGradient(x, y, 0, x, y, rad * 1.1);
    gg.addColorStop(0, 'rgba(20,20,20,0.7)'); gg.addColorStop(0.8, 'rgba(60,60,60,0.5)'); gg.addColorStop(0.92, 'rgba(235,235,235,0.6)'); gg.addColorStop(1, 'rgba(128,128,128,0)');
    gb.fillStyle = gg; gb.beginPath(); gb.arc(x, y, rad * 1.1, 0, 7); gb.fill();
  }
  // deployment zones (tinted), then the cell grid
  const zw = FX * PPC * 0.22;
  g.fillStyle = 'rgba(70,160,200,0.10)'; g.fillRect(0, 0, zw, h);
  g.fillStyle = 'rgba(220,100,50,0.10)'; g.fillRect(w - zw, 0, zw, h);
  g.setLineDash([14, 10]); g.lineWidth = 3;
  g.strokeStyle = 'rgba(120,220,255,0.55)'; g.beginPath(); g.moveTo(zw, 0); g.lineTo(zw, h); g.stroke();
  g.strokeStyle = 'rgba(255,140,90,0.55)'; g.beginPath(); g.moveTo(w - zw, 0); g.lineTo(w - zw, h); g.stroke();
  g.setLineDash([]);
  for (let i = 0; i <= FX; i++) { g.strokeStyle = i % 5 === 0 ? 'rgba(235,235,215,0.16)' : 'rgba(235,235,215,0.07)'; g.lineWidth = i % 5 === 0 ? 2 : 1; g.beginPath(); g.moveTo(i * PPC, 0); g.lineTo(i * PPC, h); g.stroke(); }
  for (let j = 0; j <= FZ; j++) { g.strokeStyle = j % 5 === 0 ? 'rgba(235,235,215,0.16)' : 'rgba(235,235,215,0.07)'; g.lineWidth = j % 5 === 0 ? 2 : 1; g.beginPath(); g.moveTo(0, j * PPC); g.lineTo(w, j * PPC); g.stroke(); }
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 16;
  const bump = new THREE.CanvasTexture(b); bump.anisotropy = 8;
  return { map, bump };
}
{
  const { map, bump } = makeGround();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(FX, FZ).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 0.9, roughness: 0.96, metalness: 0 }));
  ground.receiveShadow = true;
  scene.add(ground);
  // surrounding dark apron so the slice does not float
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3a382d', roughness: 1 }));
  apron.position.y = -0.02; apron.receiveShadow = true;
  scene.add(apron);
}

// rocks (instanced) and a couple of concrete barriers
{
  const r = rng(7);
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) { const k = 0.8 + 0.4 * Math.sin(pos.getX(i) * 3.1 + pos.getZ(i) * 2.3); pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.7, pos.getZ(i) * k); }
  geo.computeVertexNormals();
  const N = 70;
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#7d7765', roughness: 0.95, flatShading: true }), N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < N; i++) {
    let x = (r() - 0.5) * FX * 0.98, z = (r() - 0.5) * FZ * 0.98;
    if (Math.abs(z) < 12 && Math.abs(x) < 24) { z = (z < 0 ? -1 : 1) * (14 + r() * 4); }
    const s = 0.12 + r() * r() * 0.6;
    e.set(0, r() * 7, 0); q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, s * 0.2, z), q, new THREE.Vector3(s * (1 + r()), s, s * (1 + r())));
    im.setMatrixAt(i, m);
  }
  im.castShadow = im.receiveShadow = true;
  scene.add(im);
}

// ---- units -------------------------------------------------------------------------------------
const byId = new Map(STARTER_DESIGNS.map((d) => [d.id, d]));
interface Placement { id: string; x: number; z: number; team: 0 | 1; patrol?: number; alt?: number; orbit?: [number, number, number] }
const SCENE: Placement[] = [
  // blue (team 0) faces +X
  { id: 'starter-buzzsaw', x: -22, z: -8, team: 0 }, { id: 'starter-buzzsaw', x: -22, z: -6.2, team: 0 }, { id: 'starter-buzzsaw', x: -22, z: -4.4, team: 0 },
  { id: 'starter-torchbug', x: -22, z: 3.4, team: 0 }, { id: 'starter-torchbug', x: -22, z: 5.2, team: 0 }, { id: 'starter-torchbug', x: -22, z: 7, team: 0 },
  { id: 'starter-lancer', x: -18, z: -1.2, team: 0 }, { id: 'starter-lancer', x: -18, z: 1.2, team: 0 },
  { id: 'starter-hunter', x: -16, z: -11, team: 0, patrol: 1.2 }, { id: 'starter-hunter', x: -16, z: 12, team: 0, patrol: 1.2 },
  { id: 'starter-bulwark', x: -14, z: -6, team: 0 },
  { id: 'starter-tankbuster', x: -14.5, z: 7, team: 0, patrol: 1.4 },
  { id: 'starter-thunderhead', x: -20, z: 13, team: 0, patrol: 0.8 },
  { id: 'starter-behemoth', x: -8, z: 11.5, team: 0 },
  { id: 'starter-juggernaut', x: -7, z: -9.5, team: 0 },
  { id: 'starter-warlord', x: -5, z: 1, team: 0 },
  { id: 'starter-hornet', x: -12, z: 0, team: 0, alt: 4.5, orbit: [-10, 0, 2.2] },
  { id: 'starter-strafer', x: 0, z: 0, team: 0, alt: 6, orbit: [-2, -2, 11] },
  // red (team 1) faces -X
  { id: 'starter-lancer', x: 17, z: -3, team: 1 }, { id: 'starter-lancer', x: 17, z: 3, team: 1 },
  { id: 'starter-bulwark', x: 14, z: -9, team: 1 }, { id: 'starter-bulwark', x: 14, z: 9, team: 1 },
  { id: 'starter-juggernaut', x: 10, z: 0.5, team: 1 },
  { id: 'starter-hornet', x: 8, z: -8, team: 1, alt: 4, orbit: [8, -8, 2.5] },
];
const units: { u: Unit3D; p: Placement; baseAngle: number; label?: HTMLElement }[] = [];
const labelBox = document.getElementById('labels')!;
const named = new Set<string>();
for (const p of SCENE) {
  const d = byId.get(p.id)!;
  const u = buildUnit(d, p.team);
  u.root.position.set(p.x, p.alt ?? 0, p.z);
  const baseAngle = p.team === 0 ? 0 : Math.PI;
  u.root.rotation.y = -baseAngle;
  scene.add(u.root);
  // soft contact shadow under ground vehicles (cheap ambient occlusion stand-in)
  if (!u.flying) {
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), blobMat());
    blob.scale.set(u.L * 1.25, 1, u.W * 1.25);
    blob.position.y = 0.015;
    u.root.add(blob);
  }
  let label: HTMLElement | undefined;
  if (!named.has(p.id) && p.team === 0 || (p.team === 1 && p.id === 'starter-juggernaut')) {
    named.add(p.id);
    label = document.createElement('div');
    label.className = 'lab';
    const ch = CHASSIS_BY_ID.get(d.chassis)!, mb = MOBILITY_BY_ID.get(d.mobility)!;
    label.innerHTML = `<b>${d.name}</b><span>${ch.name} / ${mb.name}</span>`;
    labelBox.appendChild(label);
  }
  units.push({ u, p, baseAngle, label });
}
function blobMat(): THREE.Material {
  blobMat.m ??= (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 20, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  })();
  return blobMat.m;
}
blobMat.m = null as THREE.Material | null;

// ---- effects: tracers, beams, orbs, muzzle flash ---------------------------------------------
const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,220,150,0.8)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
interface Fx { obj: THREE.Object3D; life: number; max: number; vel?: THREE.Vector3; kind: string }
const fx: Fx[] = [];
const tracerGeo = new THREE.BoxGeometry(1.1, 0.05, 0.05);
const mats = {
  tracer: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.85, 0.35).multiplyScalar(3), toneMapped: false }),
  shell: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.6, 0.25).multiplyScalar(3), toneMapped: false }),
  orb: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.0, 0.85).multiplyScalar(3), toneMapped: false }),
  beam: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.85, 1.0).multiplyScalar(3), toneMapped: false, transparent: true }),
};
function spawnFlash(p: THREE.Vector3, s: number) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sp.position.copy(p); sp.scale.setScalar(s);
  scene.add(sp);
  fx.push({ obj: sp, life: 0.09, max: 0.09, kind: 'flash' });
}
function fire(tu: Turret, target: THREE.Vector3) {
  const m = tu.muzzles[Math.floor(Math.random() * tu.muzzles.length)];
  if (!m) return;
  const from = new THREE.Vector3(); m.getWorldPosition(from);
  const dir = target.clone().sub(from);
  const dist = dir.length(); dir.normalize();
  spawnFlash(from, 0.5 + tu.r * 0.9);
  tu.recoil.position.x = -tu.r * 0.18;
  if (tu.shot === 'beam') {
    const len = Math.min(dist, 18);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 6).rotateX(Math.PI / 2).translate(0, 0, len / 2), mats.beam.clone());
    b.position.copy(from); b.lookAt(from.clone().add(dir));
    scene.add(b); fx.push({ obj: b, life: 0.14, max: 0.14, kind: 'beam' });
    return;
  }
  const o = tu.shot === 'orb' ? new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), mats.orb)
    : new THREE.Mesh(tracerGeo, tu.shot === 'shell' ? mats.shell : mats.tracer);
  if (tu.shot === 'shell') o.scale.set(1.5, 2, 2);
  o.position.copy(from);
  o.lookAt(from.clone().add(dir)); o.rotateY(-Math.PI / 2);
  scene.add(o);
  const speed = tu.shot === 'orb' ? 22 : tu.shot === 'rocket' ? 26 : 60;
  fx.push({ obj: o, life: Math.min(dist, 30) / speed, max: 1, vel: dir.multiplyScalar(speed), kind: 'shot' });
}

// ---- post --------------------------------------------------------------------------------------
let composer: EffectComposer | null = null;
let gtao: GTAOPass | null = null;
let bloom: UnrealBloomPass | null = null;
function setupPost() {
  const w = innerWidth, h = innerHeight;
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  if (has('ao', true)) { gtao = new GTAOPass(scene, camera, w, h); gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = 0.9; gtao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.5, thickness: 2, scale: 1.2, samples: 12 }); composer.addPass(gtao); }
  if (has('bloom', true)) { bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.5, 1.15); composer.addPass(bloom); }
  composer.addPass(new OutputPass());
}
if (has('post', true)) setupPost();

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  composer?.setSize(w, h);
}
addEventListener('resize', resize);
resize();

// ---- loop --------------------------------------------------------------------------------------
const clock = new THREE.Timer();
let tAbs = 0;
const tmp = new THREE.Vector3(), tgt = new THREE.Vector3();
const nextShot = new WeakMap<Turret, number>();
const frozen = has('freeze');
const statsEl = document.getElementById('stats')!;
let frames = 0, fpsT = 0;
function frame() {
  clock.update();
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!frozen) tAbs += dt;
  const t = tAbs + (frozen ? Number(params.get('t') ?? 3) : 0);
  for (const e of units) {
    const { u, p } = e;
    let moving = 0;
    if (p.orbit) {
      const [cx, cz, R] = p.orbit;
      const w = u.flying && u.design.chassis === 'strikejet' ? 0.32 : 0.7;
      const a = t * w + e.p.x;
      u.root.position.set(cx + Math.cos(a) * R, (p.alt ?? 4) + Math.sin(t * 1.3) * 0.12, cz + Math.sin(a) * R);
      const hdg = Math.atan2(Math.cos(a) * R, -Math.sin(a) * R); // tangent direction
      u.root.rotation.y = -(Math.atan2(Math.cos(a), -Math.sin(a)));
      u.root.rotation.z = u.design.chassis === 'strikejet' ? -0.38 : 0;
      u.root.rotation.x = 0;
      void hdg;
      moving = 1;
    } else if (p.patrol) {
      moving = 1;
      const s = Math.sin(t * 0.5);
      u.root.position.x = p.x + s * p.patrol * (p.team === 0 ? 1 : -1);
    }
    u.animate(t, dt, moving);
    // turrets: scan, then lock the nearest enemy on a slow cadence and fire
    for (const [i, tu] of u.turrets.entries()) {
      if (tu.shot === 'none') continue;
      const wp = tmp; tu.yaw.getWorldPosition(wp);
      let best: typeof units[number] | null = null, bd = 1e9;
      for (const o of units) if (o.p.team !== p.team && !(u.flying !== o.u.flying && false)) {
        const d = o.u.root.position.distanceTo(wp);
        if (d < bd) { bd = d; best = o; }
      }
      if (best && bd < 60 && !tu.fixed) {
        tgt.copy(best.u.root.position); tgt.y += 0.5;
        // aim in unit-local space for traverse
        const loc = u.root.worldToLocal(tgt.clone());
        const want = -Math.atan2(loc.z - tu.yaw.position.z, loc.x - tu.yaw.position.x);
        let diff = want - tu.yaw.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        tu.yaw.rotation.y += diff * Math.min(1, dt * 3);
        const gx = Math.abs(diff) < 0.25;
        const ns = nextShot.get(tu) ?? (t + 1 + ((i * 0.37 + p.x * 0.13) % 2));
        if (gx && t >= ns && !frozen) {
          fire(tu, tgt.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5)));
          nextShot.set(tu, t + tu.rate * (tu.rate < 0.3 ? 4 + Math.random() * 6 : 1.8 + Math.random() * 2.5));
        } else if (!nextShot.has(tu)) nextShot.set(tu, ns);
      } else if (!tu.fixed) {
        tu.yaw.rotation.y = Math.sin(t * 0.4 + i * 1.7 + p.x) * 0.5;
      }
      tu.recoil.position.x *= Math.max(0, 1 - dt * 9);
      if (tu.spin) tu.spin.rotation.x += dt * (tu.recoil.position.x < -0.01 ? 30 : 6);
    }
  }
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.life -= dt;
    if (f.kind === 'shot' && f.vel) f.obj.position.addScaledVector(f.vel, dt);
    else if (f.kind === 'flash') (f.obj as THREE.Sprite).material.opacity = Math.max(0, f.life / f.max);
    else if (f.kind === 'beam') ((f.obj as THREE.Mesh).material as THREE.Material).opacity = Math.max(0, f.life / f.max);
    if (f.life <= 0) { scene.remove(f.obj); fx.splice(i, 1); }
  }
  controls.update();
  if (composer) composer.render(); else renderer.render(scene, camera);
  // labels
  const w = innerWidth, h = innerHeight;
  for (const e of units) if (e.label) {
    tmp.copy(e.u.root.position); tmp.y += (e.u.flying ? 1.2 : 0.2 + e.u.S * 0.5); tmp.z += e.u.W * 0.5 + 0.4;
    tmp.project(camera);
    e.label.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px) translate(-50%, 0)`;
    e.label.style.display = tmp.z < 1 && has('labels', true) ? 'block' : 'none';
  }
  frames++; fpsT += dt;
  if (fpsT > 1) { statsEl.textContent = `${Math.round(frames / fpsT)} fps | ${renderer.info.render.calls} draw calls | ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris | ${units.length} units`; frames = 0; fpsT = 0; }
  requestAnimationFrame(frame);
}
void TEAM_PAL;
requestAnimationFrame(frame);
(window as unknown as Record<string, unknown>).ready = true;
