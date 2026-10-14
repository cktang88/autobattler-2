// Asset lab: standalone viewer that evaluates downloaded third-party models (assets-src/) next to our procedural units.
// NOT wired into the game. Build: `npm run build:assetlab`; serve repo root and open /public/assetlab.html?set=mechs&remat=1
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { STARTER_DESIGNS } from '../../shared/starters.ts';
import { buildUnit } from '../proto3d/units3d.ts';
import { createRenderer, setupStage } from '../proto3d/stage3d.ts';

const params = new URLSearchParams(location.search);
const set = params.get('set') ?? 'mechs';
const remat = params.get('remat') === '1';
const BASE = params.get('base') ?? '../assets-src/';

interface Entry { name: string; url: string; kind: 'glb' | 'gltf' | 'fbx' | 'dae'; size: number; /** target longest horizontal/vertical extent */ yaw?: number; tex?: string }
const Q = 'quaternius-animated-mech/x/Animated Mech Pack - March 2021/FBX/';
const K = 'kenney-space-kit/x/Models/GLTF format/';
const E = 'quaternius-scifi-essentials/x/glTF/';
const SETS: Record<string, { procedural: string[]; items: Entry[] }> = {
  mechs: {
    procedural: ['starter-juggernaut', 'starter-warlord', 'starter-lancer'],
    items: ['Mike', 'Stan', 'George', 'Leela'].map((n) => ({ name: 'Q.mech ' + n, url: Q + n + '.fbx', kind: 'fbx' as const, size: 4, tex: Q + '../Textures/' + n + '_Texture.png' })),
  },
  vehicles: {
    procedural: ['starter-bulwark', 'starter-tankbuster', 'starter-behemoth'],
    items: [
      { name: '32kda heavy_tank', url: 'heavy-tank-32kda/x/heavy_tank00.glb', kind: 'glb', size: 4 },
      { name: 'pixelmannen Body', url: 'tank-and-props-pixelmannen/x/Tanks/Body.dae', kind: 'dae', size: 3.5 },
      { name: 'pixelmannen Gun', url: 'tank-and-props-pixelmannen/x/Tanks/Gun.dae', kind: 'dae', size: 3.5 },
      { name: 'Kenney speederA', url: K + 'craft_speederA.glb', kind: 'glb', size: 4 },
      { name: 'Kenney racer', url: K + 'craft_racer.glb', kind: 'glb', size: 4 },
      { name: 'Kenney miner', url: K + 'craft_miner.glb', kind: 'glb', size: 4 },
      { name: 'Kenney cargoA', url: K + 'craft_cargoA.glb', kind: 'glb', size: 4 },
    ],
  },
  creatures: {
    procedural: ['starter-hunter', 'starter-thunderhead', 'starter-hornet'],
    items: ['Enemy_QuadShell', 'Enemy_Trilobite', 'Enemy_EyeDrone'].map((n) => ({ name: 'Q.essentials ' + n, url: E + n + '.gltf', kind: 'gltf' as const, size: 3.5 })),
  },
  turrets: {
    procedural: ['starter-lancer', 'starter-bulwark'],
    items: [
      { name: 'Kenney turret_double', url: K + 'turret_double.glb', kind: 'glb', size: 4 },
      { name: 'Kenney turret_single', url: K + 'turret_single.glb', kind: 'glb', size: 4 },
      { name: 'Kenney weapon_gun', url: K + 'weapon_gun.glb', kind: 'glb', size: 4 },
      { name: 'Kenney weapon_rifle', url: K + 'weapon_rifle.glb', kind: 'glb', size: 4 },
      { name: '32kda Gun', url: 'tank-and-props-pixelmannen/x/Tanks/Gun.dae', kind: 'dae', size: 4 },
    ],
  },
  props: {
    procedural: [],
    items: [
      ...['rock_largeA', 'rock_crystalsLargeA', 'structure_detailed', 'satelliteDish', 'rocket_baseA', 'machine_generator', 'pipe_cross'].map((n) => ({ name: 'Kenney ' + n, url: K + n + '.glb', kind: 'glb' as const, size: 3.5 })),
      ...['Prop_SatelliteDish', 'Prop_Crate_Large', 'Prop_Barrel1'].map((n) => ({ name: 'Q.essentials ' + n, url: E + n + '.gltf', kind: 'gltf' as const, size: 4 })),
    ],
  },
};

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = createRenderer(canvas);
const scene = new THREE.Scene();
const stage = setupStage(renderer, scene, { fog: false });
const camera = new THREE.PerspectiveCamera(24, 1, 1, 500);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#7d7860', roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

const ramp = (() => {
  const d = new Uint8Array([70, 160, 255]); // two cel steps + light
  const t = new THREE.DataTexture(d, 3, 1, THREE.RedFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
})();
const TEAM = new THREE.Color('#3f7fd0');

function reMaterial(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const old = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    const nm = new THREE.MeshToonMaterial({ vertexColors: !!m.geometry.attributes.color, color: old.color ? old.color.clone() : new THREE.Color('#8a8f7a'), map: old.map ?? null, gradientMap: ramp });
    nm.color.lerp(new THREE.Color('#8a8c78'), 0.15);
    m.material = nm;
  });
}
function triCount(root: THREE.Object3D) {
  let t = 0;
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { const g = m.geometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  return Math.round(t);
}
function loadAny(e: Entry): Promise<{ obj: THREE.Object3D; anims: THREE.AnimationClip[] }> {
  const url = BASE + e.url;
  return new Promise((res, rej) => {
    if (e.kind === 'fbx') new FBXLoader().load(url, (o) => res({ obj: o, anims: o.animations }), undefined, rej);
    else if (e.kind === 'dae') new ColladaLoader().load(url, (c) => res({ obj: c!.scene, anims: [] }), undefined, rej);
    else new GLTFLoader().load(url, (g) => res({ obj: g.scene, anims: g.animations }), undefined, rej);
  });
}

const cfg = SETS[set];
const mixers: THREE.AnimationMixer[] = [];
const info: Record<string, unknown>[] = [];
const labels = document.getElementById('labels')!;
const tagged: { pos: THREE.Vector3; el: HTMLElement }[] = [];
function tag(pos: THREE.Vector3, a: string, b: string) {
  const el = document.createElement('div'); el.className = 'lab'; el.innerHTML = `<b>${a}</b><span>${b}</span>`;
  labels.appendChild(el); tagged.push({ pos, el });
}
const units: ReturnType<typeof buildUnit>[] = [];
let cursor = 0; const GAP = Number(params.get('gap') ?? 1.2);
const place = (w: number) => { const x = cursor + w / 2; cursor += w + GAP; return x; };
cfg.procedural.forEach((id, i) => {
  const d = STARTER_DESIGNS.find((s) => s.id === id)!;
  const u = buildUnit(d, 0);
  const x = place(Math.max(u.L, u.W) * 1.05);
  u.root.position.set(x, 0, -5); scene.add(u.root); units.push(u);
  tag(new THREE.Vector3(x, 0, -5), 'OURS ' + d.name, u.tris + ' tris');
});
(async () => {
  for (let i = 0; i < cfg.items.length; i++) {
    const e = cfg.items[i];
    const x = place(e.size * 1.0);
    try {
      const { obj, anims } = await loadAny(e);
      if (e.tex) { const t = new THREE.TextureLoader().load(BASE + e.tex); t.colorSpace = THREE.SRGBColorSpace; obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) (Array.isArray(m.material) ? m.material : [m.material]).forEach((q) => { (q as THREE.MeshPhongMaterial).map = t; (q as THREE.MeshPhongMaterial).color.set('#ffffff'); q.needsUpdate = true; }); }); }
      const tris = triCount(obj);
      const mats = new Set<string>(); obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) (Array.isArray(m.material) ? m.material : [m.material]).forEach((q) => mats.add(q.name)); });
      let named = 0; obj.traverse(() => named++);
      const box = new THREE.Box3().setFromObject(obj);
      const sz = box.getSize(new THREE.Vector3());
      const s = e.size / Math.max(sz.x, sz.y, sz.z);
      const g = new THREE.Group(); g.add(obj); obj.scale.multiplyScalar(s);
      const b2 = new THREE.Box3().setFromObject(g);
      obj.position.y -= b2.min.y; obj.position.x -= (b2.min.x + b2.max.x) / 2; obj.position.z -= (b2.min.z + b2.max.z) / 2;
      g.position.set(x, 0, -5);
      if (remat) reMaterial(obj);
      obj.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      scene.add(g);
      if (anims.length) {
        const mx = new THREE.AnimationMixer(obj);
        const clip = anims.find((a) => /walk/i.test(a.name)) ?? anims.find((a) => /run/i.test(a.name)) ?? anims[0];
        mx.clipAction(clip).play(); mixers.push(mx);
      }
      let nodes = 0; obj.traverse(() => nodes++);
      let vc = false, hasMap = false; obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { if (m.geometry.attributes.color) vc = true; if (((Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial).map) hasMap = true; } });
      const rec = { vc, hasMap, name: e.name, tris, nodes, size: sz.toArray().map((v) => +v.toFixed(2)), materials: mats.size, anims: anims.map((a) => a.name) };
      info.push(rec);
      tag(new THREE.Vector3(x, 0, -5), e.name, `${tris} tris, ${anims.length} anim`);
    } catch (err) { info.push({ name: e.name, error: String(err) }); tag(new THREE.Vector3(x, 0, -5), e.name, 'LOAD FAILED'); }
  }
  resize(); stage.fitShadow(cursor / 2, -5, Math.max(14, cursor * 0.6));
  (window as unknown as Record<string, unknown>).__info = info;
  (window as unknown as Record<string, unknown>).__ready = true;
  console.log('ASSETINFO ' + JSON.stringify(info));
})();

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  const span = Math.max(cursor, 14);
  const dist = Math.max((span / 2 + 0.5) / (Math.tan(THREE.MathUtils.degToRad(12)) * camera.aspect), 8);
  const tilt = THREE.MathUtils.degToRad(Number(params.get('tilt') ?? 32)), yaw = THREE.MathUtils.degToRad(Number(params.get('yaw') ?? 0));
  camera.position.set(Math.sin(yaw) * Math.cos(tilt) * dist, Math.sin(tilt) * dist, -5 + Math.cos(yaw) * Math.cos(tilt) * dist);
  camera.position.x += cursor / 2; camera.lookAt(cursor / 2, 1.0, -5); camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

const clock = new THREE.Clock();
const v = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta(), t = clock.elapsedTime;
  for (const m of mixers) m.update(dt);
  for (const u of units) u.animate(t, dt, 0.5);
  renderer.render(scene, camera);
  for (const tg of tagged) {
    const { pos, el } = tg;
    v.copy(pos).add(new THREE.Vector3(0, 0, 1.8 + (tagged.indexOf(tg) % 2) * 1.0)).project(camera);
    el.style.display = 'block'; el.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth}px,${(-v.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,0)`;
  }
});
