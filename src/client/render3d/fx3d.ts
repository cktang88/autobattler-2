// Effects for the 3D battlefield: GPU-instanced billboard particles (additive fire / sparks / glows, alpha smoke / dust),
// tumbling debris, ground shock rings, persistent scorch decals, additive beams (core + glow) with jagged lightning,
// tracer / shell / rocket projectile pools. Everything is a handful of draw calls regardless of how much is going on.
// Pure three.js: knows nothing about the sim. FieldView3D feeds it world positions (x, y = height, z).

import * as THREE from 'three';

const R = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------------------------------------------------ colour ramps */

/** 3-stop colour ramp (rgba x 3) at particle age 0, 0.35, 1. rgb > 1 is HDR (blooms). */
export type Ramp = readonly number[];
export const RAMPS = {
  fire: [2.5, 1.9, 1.0, 0.85, 1.7, 0.6, 0.13, 0.7, 0.28, 0.07, 0.02, 0],
  flame: [2.6, 1.7, 0.6, 0.9, 1.9, 0.6, 0.12, 0.7, 0.3, 0.06, 0.02, 0],
  plasma: [2.8, 1.6, 3.2, 1, 1.6, 0.5, 2.4, 0.85, 0.2, 0.05, 0.4, 0],
  emp: [2.4, 3.0, 4.0, 1, 0.9, 1.8, 3.2, 0.8, 0.1, 0.3, 0.8, 0],
  spark: [3.5, 2.6, 1.2, 1, 2.5, 1.0, 0.25, 0.9, 1.0, 0.25, 0.05, 0],
  flash: [3.4, 2.8, 1.8, 1, 2.2, 1.3, 0.5, 0.6, 1.0, 0.45, 0.12, 0],
  smoke: [0.15, 0.14, 0.13, 0.5, 0.22, 0.2, 0.18, 0.36, 0.3, 0.28, 0.26, 0],
  smokeLight: [0.45, 0.44, 0.42, 0.32, 0.45, 0.45, 0.43, 0.2, 0.45, 0.45, 0.45, 0],
  heal: [0.7, 2.8, 1.1, 1, 0.3, 1.6, 0.6, 0.6, 0.1, 0.8, 0.3, 0],
  shield: [1.2, 2.6, 3.4, 1, 0.5, 1.5, 2.6, 0.7, 0.2, 0.6, 1.2, 0],
  bolt: [2.8, 3.4, 4.5, 1, 1.6, 2.4, 4.0, 0.8, 0.3, 0.7, 2.0, 0],
} as const satisfies Record<string, Ramp>;

/* -------------------------------------------------------------------------------------------------- atlas */

/** 2x2 atlas: 0 soft glow, 1 + 2 cloudy puffs, 3 hot spark dot */
function makeAtlas(): THREE.CanvasTexture {
  const T = 128, c = document.createElement('canvas');
  c.width = c.height = T * 2;
  const g = c.getContext('2d')!;
  const tile = (i: number) => [(i % 2) * T, (1 - Math.floor(i / 2)) * T] as const;
  { // glow
    const [x, y] = tile(0);
    const gr = g.createRadialGradient(x + 64, y + 64, 0, x + 64, y + 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x, y, T, T);
  }
  let seed = 17;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (const i of [1, 2]) { // cloudy puffs: many soft blobs inside a radial window
    const [x, y] = tile(i);
    const t = document.createElement('canvas'); t.width = t.height = T;
    const tg = t.getContext('2d')!;
    for (let k = 0; k < 46; k++) {
      const a = rnd() * 6.283, d = Math.pow(rnd(), 0.7) * 0.34 * T, r = (0.1 + rnd() * 0.2) * T;
      const px = T / 2 + Math.cos(a) * d, py = T / 2 + Math.sin(a) * d;
      const gr = tg.createRadialGradient(px, py, 0, px, py, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      tg.fillStyle = gr; tg.fillRect(0, 0, T, T);
    }
    tg.globalCompositeOperation = 'destination-in';
    const win = tg.createRadialGradient(T / 2, T / 2, T * 0.12, T / 2, T / 2, T * 0.5);
    win.addColorStop(0, 'rgba(0,0,0,1)'); win.addColorStop(0.7, 'rgba(0,0,0,0.6)'); win.addColorStop(1, 'rgba(0,0,0,0)');
    tg.fillStyle = win; tg.fillRect(0, 0, T, T);
    g.drawImage(t, x, y);
  }
  { // spark
    const [x, y] = tile(3);
    const gr = g.createRadialGradient(x + 64, y + 64, 0, x + 64, y + 64, 40);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x, y, T, T);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ---------------------------------------------------------------------------------------------- particles */

class Particles {
  readonly mesh: THREE.Mesh;
  n = 0;
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private age: Float32Array; private life: Float32Array; private s0: Float32Array; private s1: Float32Array;
  private rot: Float32Array; private spin: Float32Array; private drag: Float32Array; private grav: Float32Array;
  private tex: Float32Array; private ramp: Float32Array;
  private aPos: THREE.InstancedBufferAttribute; private aSR: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute; private aTex: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;

  readonly cap: number;
  constructor(cap: number, atlas: THREE.Texture, mode: 'add' | 'alpha' | 'fire') {
    this.cap = cap;
    const f = (k: number) => new Float32Array(cap * k);
    this.px = f(1); this.py = f(1); this.pz = f(1); this.vx = f(1); this.vy = f(1); this.vz = f(1);
    this.age = f(1); this.life = f(1); this.s0 = f(1); this.s1 = f(1); this.rot = f(1); this.spin = f(1);
    this.drag = f(1); this.grav = f(1); this.tex = f(1); this.ramp = f(12);
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const mk = (k: number) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * k), k); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.aPos = mk(3); this.aSR = mk(2); this.aCol = mk(4); this.aTex = mk(1);
    geo.setAttribute('iPos', this.aPos); geo.setAttribute('iSR', this.aSR); geo.setAttribute('iCol', this.aCol); geo.setAttribute('iTex', this.aTex);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: atlas } },
      vertexShader: /* glsl */ `
        attribute vec3 iPos; attribute vec2 iSR; attribute vec4 iCol; attribute float iTex;
        varying vec2 vUv; varying vec4 vCol;
        void main() {
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          float c = cos(iSR.y), s = sin(iSR.y);
          vec2 q = position.xy * iSR.x;
          mv.xy += vec2(q.x * c - q.y * s, q.x * s + q.y * c);
          gl_Position = projectionMatrix * mv;
          vec2 cell = vec2(mod(iTex, 2.0), floor(iTex / 2.0));
          vUv = (cell + uv) * 0.5;
          vCol = iCol;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; varying vec2 vUv; varying vec4 vCol;
        void main() {
          float a = texture2D(map, vUv).a * vCol.a;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vCol.rgb, a);
          ${mode === 'fire' ? 'gl_FragColor = vec4(vCol.rgb * a, a * 0.5);' : ''}
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, depthTest: true,
      blending: mode === 'add' ? THREE.AdditiveBlending : mode === 'fire' ? THREE.CustomBlending : THREE.NormalBlending,
      ...(mode === 'fire' ? { blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor } : {}),
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = mode === 'add' ? 8 : mode === 'fire' ? 7 : 6;
  }

  get full(): boolean { return this.n >= this.cap; }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, spin: number, drag: number, grav: number, tex: number, ramp: Ramp, hdr = 1): void {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.rot[i] = Math.random() * 6.283; this.spin[i] = spin; this.drag[i] = drag; this.grav[i] = grav; this.tex[i] = tex;
    const o = i * 12;
    for (let k = 0; k < 12; k++) this.ramp[o + k] = (k & 3) === 3 ? ramp[k] : ramp[k] * hdr;
  }

  update(dt: number): void {
    let i = 0;
    const last = () => this.n - 1;
    while (i < this.n) {
      const a = (this.age[i] += dt);
      if (a >= this.life[i]) {
        const l = last();
        if (i !== l) this.copy(l, i);
        this.n--;
        continue;
      }
      const dk = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= dk; this.vy[i] = this.vy[i] * dk + this.grav[i] * dt; this.vz[i] *= dk;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.03 && this.grav[i] < 0) { this.py[i] = 0.03; this.vy[i] = 0; this.vx[i] *= 0.5; this.vz[i] *= 0.5; }
      i++;
    }
    const aP = this.aPos.array as Float32Array, aS = this.aSR.array as Float32Array, aC = this.aCol.array as Float32Array, aT = this.aTex.array as Float32Array;
    for (let j = 0; j < this.n; j++) {
      const t = this.age[j] / this.life[j];
      aP[j * 3] = this.px[j]; aP[j * 3 + 1] = this.py[j]; aP[j * 3 + 2] = this.pz[j];
      this.rot[j] += this.spin[j] * dt;
      aS[j * 2] = this.s0[j] + (this.s1[j] - this.s0[j]) * Math.sqrt(t);
      aS[j * 2 + 1] = this.rot[j];
      const o = j * 12;
      let f: number, a0: number, a1: number;
      if (t < 0.35) { f = t / 0.35; a0 = o; a1 = o + 4; } else { f = (t - 0.35) / 0.65; a0 = o + 4; a1 = o + 8; }
      const fade = Math.min(1, t / 0.06);
      const r = this.ramp;
      aC[j * 4] = r[a0] + (r[a1] - r[a0]) * f; aC[j * 4 + 1] = r[a0 + 1] + (r[a1 + 1] - r[a0 + 1]) * f; aC[j * 4 + 2] = r[a0 + 2] + (r[a1 + 2] - r[a0 + 2]) * f;
      aC[j * 4 + 3] = (r[a0 + 3] + (r[a1 + 3] - r[a0 + 3]) * f) * fade;
      aT[j] = this.tex[j];
    }
    this.geo.instanceCount = this.n;
    this.aPos.needsUpdate = this.aSR.needsUpdate = this.aCol.needsUpdate = this.aTex.needsUpdate = true;
  }

  private copy(from: number, to: number): void {
    for (const a of [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.age, this.life, this.s0, this.s1, this.rot, this.spin, this.drag, this.grav, this.tex]) a[to] = a[from];
    for (let k = 0; k < 12; k++) this.ramp[to * 12 + k] = this.ramp[from * 12 + k];
  }

  clear(): void { this.n = 0; this.geo.instanceCount = 0; }
  dispose(): void { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

/* ------------------------------------------------------------------------------------------ flat decal pool */

/** ground-plane quads (shock rings, light pools) with life + per-instance colour fade */
class Flats {
  readonly mesh: THREE.InstancedMesh;
  n = 0;
  private d: { x: number; z: number; y: number; s0: number; s1: number; rot: number; age: number; life: number; r: number; g: number; b: number }[] = [];
  readonly cap: number;
  constructor(cap: number, geo: THREE.BufferGeometry, mat: THREE.Material, order: number) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.renderOrder = order;
  }
  add(x: number, z: number, y: number, s0: number, s1: number, life: number, r: number, g: number, b: number): void {
    if (this.d.length >= this.cap) this.d.shift();
    this.d.push({ x, z, y, s0, s1, rot: Math.random() * 6.28, age: 0, life, r, g, b });
  }
  update(dt: number): void {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = this.mesh.instanceColor!.array as Float32Array;
    let w = 0;
    for (let i = 0; i < this.d.length; i++) {
      const e = this.d[i];
      e.age += dt;
      if (e.age >= e.life) continue;
      this.d[w] = e;
      const t = e.age / e.life, sc = e.s0 + (e.s1 - e.s0) * (1 - (1 - t) * (1 - t));
      q.setFromAxisAngle(up, e.rot);
      m.compose(p.set(e.x, e.y, e.z), q, s.set(sc, 1, sc));
      m.toArray(this.mesh.instanceMatrix.array as unknown as number[], w * 16);
      const f = (1 - t) * (1 - t);
      col[w * 3] = e.r * f; col[w * 3 + 1] = e.g * f; col[w * 3 + 2] = e.b * f;
      w++;
    }
    this.d.length = w;
    this.n = w;
    this.mesh.count = w;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
  clear(): void { this.d.length = 0; this.n = 0; this.mesh.count = 0; }
}

/* ------------------------------------------------------------------------------------------------- debris */

class Debris {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private cap: number;
  private a: Float32Array; // x y z vx vy vz rx ry rz wx wy wz size life age
  constructor(cap: number) {
    this.cap = cap;
    this.a = new Float32Array(cap * 15);
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.6, 0.8), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0.5 }), cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.castShadow = true;
    this.colors = new Float32Array(cap * 3);
  }
  private colors: Float32Array;
  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, tone: number): void {
    const i = this.n < this.cap ? this.n++ : Math.floor(Math.random() * this.cap);
    const o = i * 15, a = this.a;
    a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = vx; a[o + 4] = vy; a[o + 5] = vz;
    a[o + 6] = Math.random() * 6; a[o + 7] = Math.random() * 6; a[o + 8] = Math.random() * 6;
    a[o + 9] = R(-9, 9); a[o + 10] = R(-9, 9); a[o + 11] = R(-9, 9);
    a[o + 12] = size; a[o + 13] = R(1.6, 3.2); a[o + 14] = 0;
    this.colors[i * 3] = tone; this.colors[i * 3 + 1] = tone * 0.92; this.colors[i * 3 + 2] = tone * 0.85;
  }
  update(dt: number): void {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
    const col = this.mesh.instanceColor!.array as Float32Array;
    let i = 0;
    while (i < this.n) {
      const o = i * 15, a = this.a;
      a[o + 14] += dt;
      if (a[o + 14] >= a[o + 13]) { // swap-remove
        const l = (this.n - 1) * 15;
        for (let k = 0; k < 15; k++) a[o + k] = a[l + k];
        this.colors[i * 3] = this.colors[(this.n - 1) * 3]; this.colors[i * 3 + 1] = this.colors[(this.n - 1) * 3 + 1]; this.colors[i * 3 + 2] = this.colors[(this.n - 1) * 3 + 2];
        this.n--;
        continue;
      }
      a[o + 4] -= 14 * dt;
      a[o] += a[o + 3] * dt; a[o + 1] += a[o + 4] * dt; a[o + 2] += a[o + 5] * dt;
      const half = a[o + 12] * 0.3;
      if (a[o + 1] < half) {
        a[o + 1] = half;
        if (a[o + 4] < -1) a[o + 4] *= -0.32; else a[o + 4] = 0;
        a[o + 3] *= 0.7; a[o + 5] *= 0.7; a[o + 9] *= 0.6; a[o + 10] *= 0.6; a[o + 11] *= 0.6;
      }
      a[o + 6] += a[o + 9] * dt; a[o + 7] += a[o + 10] * dt; a[o + 8] += a[o + 11] * dt;
      i++;
    }
    for (let j = 0; j < this.n; j++) {
      const o = j * 15, a = this.a;
      const k = a[o + 13] - a[o + 14] < 0.5 ? Math.max(0.01, (a[o + 13] - a[o + 14]) / 0.5) : 1;
      q.setFromEuler(e.set(a[o + 6], a[o + 7], a[o + 8]));
      m.compose(p.set(a[o], a[o + 1], a[o + 2]), q, s.setScalar(a[o + 12] * k));
      m.toArray(this.mesh.instanceMatrix.array as unknown as number[], j * 16);
      col[j * 3] = this.colors[j * 3]; col[j * 3 + 1] = this.colors[j * 3 + 1]; col[j * 3 + 2] = this.colors[j * 3 + 2];
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
  clear(): void { this.n = 0; this.mesh.count = 0; }
}

/* ----------------------------------------------------------------------------------------------- beams / bolts */

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _mid = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _bm = new THREE.Matrix4();

/** instanced box segments, rebuilt every frame */
class Segments {
  readonly mesh: THREE.InstancedMesh;
  n = 0;
  readonly cap: number;
  constructor(cap: number, additive: boolean, order: number) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({
      color: '#ffffff', toneMapped: false, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }), cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.renderOrder = order;
  }
  begin(): void { this.n = 0; }
  seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, h: number, r: number, g: number, b: number): void {
    if (this.n >= this.cap) return;
    _x.set(bx - ax, by - ay, bz - az);
    const len = _x.length();
    if (len < 1e-4) return;
    _x.multiplyScalar(1 / len);
    _z.crossVectors(_x, Math.abs(_x.y) > 0.98 ? _mid.set(1, 0, 0) : _up).normalize();
    _y.crossVectors(_z, _x);
    _bm.makeBasis(_x.multiplyScalar(len), _y.multiplyScalar(h), _z.multiplyScalar(w));
    _bm.setPosition((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    _bm.toArray(this.mesh.instanceMatrix.array as unknown as number[], this.n * 16);
    const c = this.mesh.instanceColor!.array as Float32Array;
    c[this.n * 3] = r; c[this.n * 3 + 1] = g; c[this.n * 3 + 2] = b;
    this.n++;
  }
  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}

interface BoltFx {
  kind: 'beam' | 'bolt';
  ax: number; ay: number; az: number; bx: number; by: number; bz: number;
  r: number; g: number; b: number; w: number;
  life: number; max: number; seed: number; roll: number; pts: number[]; wob: number;
}

function mulberry(a: number) { return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** jagged path a -> b with a few side branches; returns flat [x,y,z,...] polyline segments as pairs */
function jag(f: BoltFx, rnd: () => number, out: number[]): void {
  out.length = 0;
  const dx = f.bx - f.ax, dy = f.by - f.ay, dz = f.bz - f.az;
  const len = Math.hypot(dx, dy, dz);
  const n = clamp(Math.round(len / 0.45), 4, 16);
  // perpendicular basis
  const nx = dx / len, ny = dy / len, nz = dz / len;
  let px = -nz, py = 0, pz = nx;
  const pl = Math.hypot(px, pz) || 1; px /= pl; pz /= pl;
  const qx = ny * pz - nz * py, qy = nz * px - nx * pz, qz = nx * py - ny * px;
  const amp = Math.min(0.5, 0.06 + len * 0.045);
  let lx = f.ax, ly = f.ay, lz = f.az;
  const pts: number[][] = [[f.ax, f.ay, f.az]];
  for (let i = 1; i <= n; i++) {
    const t = i / n, e = i === n ? 0 : Math.sin(t * Math.PI) ** 0.6;
    const a = (rnd() - 0.5) * 2 * amp * e, b = (rnd() - 0.5) * 2 * amp * e;
    const x = f.ax + dx * t + px * a + qx * b, y = f.ay + dy * t + py * a + qy * b, z = f.az + dz * t + pz * a + qz * b;
    out.push(lx, ly, lz, x, Math.max(0.05, y), z);
    lx = x; ly = Math.max(0.05, y); lz = z;
    pts.push([x, ly, z]);
  }
  // branches
  const nb = len > 2 ? 1 + Math.floor(rnd() * 3) : rnd() < 0.5 ? 1 : 0;
  for (let k = 0; k < nb; k++) {
    const s = pts[1 + Math.floor(rnd() * (pts.length - 2))] ?? pts[1];
    const ang = rnd() * 6.283, bl = len * (0.12 + rnd() * 0.18);
    const bdx = nx * 0.7 + (px * Math.cos(ang) + qx * Math.sin(ang)) * 0.7, bdy = ny * 0.7 + (py * Math.cos(ang) + qy * Math.sin(ang)) * 0.7, bdz = nz * 0.7 + (pz * Math.cos(ang) + qz * Math.sin(ang)) * 0.7;
    let ux = s[0], uy = s[1], uz = s[2];
    for (let i = 1; i <= 3; i++) {
      const x = s[0] + bdx * bl * (i / 3) + (rnd() - 0.5) * amp * 0.8, y = Math.max(0.05, s[1] + bdy * bl * (i / 3) + (rnd() - 0.5) * amp * 0.6), z = s[2] + bdz * bl * (i / 3) + (rnd() - 0.5) * amp * 0.8;
      out.push(ux, uy, uz, x, y, z);
      ux = x; uy = y; uz = z;
    }
  }
}

/* ------------------------------------------------------------------------------------------------ projectiles */

export class ProjLayer {
  readonly group = new THREE.Group();
  private streaks = new Segments(1600, true, 9);
  private glow = new Segments(1600, true, 9);
  private bodies: THREE.InstancedMesh;
  private nb = 0;
  constructor() {
    this.bodies = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45, metalness: 0.8, emissive: '#ff6a20', emissiveIntensity: 0.6 }), 1200);
    this.bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bodies.setColorAt(0, new THREE.Color(1, 1, 1));
    this.bodies.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.bodies.frustumCulled = false; this.bodies.count = 0;
    this.group.add(this.bodies, this.glow.mesh, this.streaks.mesh);
  }
  begin(): void { this.streaks.begin(); this.glow.begin(); this.nb = 0; }
  /** bright streak (tracer round / energy bolt) from tail to head */
  streak(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, r: number, g: number, b: number): void {
    this.streaks.seg(ax, ay, az, bx, by, bz, w * 0.45, w * 0.45, 3.2 * Math.min(1, r + 0.4), 2.9 * Math.min(1, g + 0.4), 2.4 * Math.min(1, b + 0.4));
    this.glow.seg(ax, ay, az, bx, by, bz, w * 1.8, w * 1.8, r * 0.7, g * 0.7, b * 0.7);
  }
  /** solid body (shell / rocket) centred at c, pointing along (dx,dy,dz) */
  body(cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, len: number, d: number, r: number, g: number, b: number): void {
    if (this.nb >= 1200) return;
    const l = Math.hypot(dx, dy, dz) || 1;
    _x.set(dx / l, dy / l, dz / l);
    _z.crossVectors(_x, Math.abs(_x.y) > 0.98 ? _mid.set(1, 0, 0) : _up).normalize();
    _y.crossVectors(_z, _x);
    _bm.makeBasis(_x.multiplyScalar(len), _y.multiplyScalar(d), _z.multiplyScalar(d)).setPosition(cx, cy, cz);
    _bm.toArray(this.bodies.instanceMatrix.array as unknown as number[], this.nb * 16);
    const c = this.bodies.instanceColor!.array as Float32Array;
    c[this.nb * 3] = r; c[this.nb * 3 + 1] = g; c[this.nb * 3 + 2] = b;
    this.nb++;
  }
  end(): void {
    this.streaks.end(); this.glow.end();
    this.bodies.count = this.nb;
    this.bodies.instanceMatrix.needsUpdate = true; this.bodies.instanceColor!.needsUpdate = true;
  }
}

/* ----------------------------------------------------------------------------------------------------- Fx3D */

export interface GlowDef { x: number; y: number; z: number; size: number; life: number; ramp?: Ramp }

export class Fx3D {
  readonly group = new THREE.Group();
  readonly proj = new ProjLayer();
  /** camera shake trauma 0..1 and full-screen flash 0..1; the view decays and applies them */
  trauma = 0;
  flashA = 0;
  /** multiplies HDR brightness of flashes (flashScale accessibility) 0.35..1 */
  hdr = 1;
  /** budget scale 0.3..1 (the view lowers it when the frame rate sags) */
  lod = 1;
  private atlas = makeAtlas();
  private add = new Particles(4000, this.atlas, 'add');
  private fire = new Particles(3000, this.atlas, 'fire');
  private alpha = new Particles(4500, this.atlas, 'alpha');
  private rings: Flats;
  private pools: Flats;
  private debris = new Debris(500);
  private scorch: THREE.InstancedMesh;
  private scorchN = 0;
  private beamsCore = new Segments(2400, true, 10);
  private beamsGlow = new Segments(2400, true, 10);
  private bolts: BoltFx[] = [];
  private later: { t: number; fn: () => void }[] = [];
  private smokes: { x: number; z: number; r: number; left: number; acc: number }[] = [];
  private time = 0;
  /** recent blast count (decays): stacked explosions dim each other so mass deaths don't blow out to white */
  private heat = 0;
  private dust: number[] = [0.55, 0.46, 0.34, 0.5, 0.5, 0.42, 0.32, 0.3, 0.45, 0.38, 0.3, 0];

  constructor() {
    this.group.name = 'fx';
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.rings = new Flats(160, new THREE.RingGeometry(0.955, 1, 48).rotateX(-Math.PI / 2), ringMat, 7);
    const poolTex = this.atlas.clone();
    poolTex.repeat.set(0.5, 0.5); poolTex.offset.set(0, 0); poolTex.needsUpdate = true;
    const poolMat = new THREE.MeshBasicMaterial({ color: '#ffffff', map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.pools = new Flats(120, new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, 7);
    // scorch decals
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(8,6,4,0.85)'); gr.addColorStop(0.5, 'rgba(10,8,6,0.55)'); gr.addColorStop(1, 'rgba(10,8,6,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 26; i++) { // ragged blast streaks
      const a = Math.random() * 6.283, l = 18 + Math.random() * 40;
      g.strokeStyle = `rgba(8,6,4,${0.12 + Math.random() * 0.2})`; g.lineWidth = 1 + Math.random() * 3;
      g.beginPath(); g.moveTo(64 + Math.cos(a) * 14, 64 + Math.sin(a) * 14); g.lineTo(64 + Math.cos(a) * l, 64 + Math.sin(a) * l); g.stroke();
    }
    const st = new THREE.CanvasTexture(c);
    st.colorSpace = THREE.SRGBColorSpace;
    this.scorch = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 256);
    this.scorch.frustumCulled = false; this.scorch.count = 0; this.scorch.renderOrder = 2;
    this.debris.mesh.renderOrder = 3;
    for (const o of [this.scorch, this.debris.mesh, this.alpha.mesh, this.pools.mesh, this.rings.mesh, this.fire.mesh, this.add.mesh, this.beamsGlow.mesh, this.beamsCore.mesh, this.proj.group]) this.group.add(o);
  }

  /** tint ground dust to the map */
  setGround(rgb: [number, number, number]): void {
    const k = 1.05;
    this.dust = [rgb[0] * k, rgb[1] * k, rgb[2] * k, 0.5, rgb[0] * k * 0.92, rgb[1] * k * 0.92, rgb[2] * k * 0.92, 0.3, rgb[0] * 0.8, rgb[1] * 0.8, rgb[2] * 0.8, 0];
  }

  clear(): void {
    this.add.clear(); this.fire.clear(); this.alpha.clear(); this.rings.clear(); this.pools.clear(); this.debris.clear();
    this.scorchN = 0; this.scorch.count = 0;
    this.bolts.length = 0; this.later.length = 0; this.smokes.length = 0;
    this.trauma = 0; this.flashA = 0;
  }

  get particleCount(): number { return this.add.n + this.fire.n + this.alpha.n; }

  /* ---------------------------------------------------------------------------------------------- helpers */

  private lodN(n: number): number { return Math.max(1, Math.round(n * this.lod)); }

  glow(x: number, y: number, z: number, size: number, life: number, ramp: Ramp = RAMPS.flash, tex = 0): void {
    this.add.emit(x, y, z, 0, 0, 0, life, size, size * 1.25, 0, 0, 0, tex, ramp, this.hdr);
  }

  /* ----------------------------------------------------------------------------------------------- shooting */

  /** muzzle flash at a barrel tip: a hot core, a forward spike and (big guns) a puff of smoke */
  muzzle(x: number, y: number, z: number, dx: number, dz: number, cal: number): void {
    const s = 0.28 + cal * 0.75;
    this.add.emit(x, y, z, 0, 0, 0, 0.07, s * 1.1, s * 0.6, 0, 0, 0, 0, RAMPS.flash, this.hdr);
    const l = Math.hypot(dx, dz) || 1, nx = dx / l, nz = dz / l;
    this.add.emit(x + nx * s * 0.45, y, z + nz * s * 0.45, nx * 3, 0, nz * 3, 0.06, s * 0.7, s * 0.3, 0, 2, 0, 3, RAMPS.flash, this.hdr);
    if (cal > 0.55) {
      for (let i = 0; i < 2; i++) this.alpha.emit(x + nx * 0.2, y, z + nz * 0.2, nx * R(0.8, 2) + R(-0.3, 0.3), R(0.2, 0.7), nz * R(0.8, 2) + R(-0.3, 0.3), R(0.7, 1.3), s * 0.5, s * 1.7, R(-0.6, 0.6), 1.6, 0, 1 + (i & 1), RAMPS.smokeLight);
    }
  }

  /** small impact: sparks + a dust puff (hull or ground) */
  impact(x: number, y: number, z: number, big = 0.5, hot = true): void {
    const n = this.lodN(3 + Math.round(big * 6));
    for (let i = 0; i < n; i++) this.add.emit(x, y, z, R(-3, 3), R(1, 4.5), R(-3, 3), R(0.18, 0.4), 0.07 + big * 0.06, 0.02, 0, 1.5, -12, 3, RAMPS.spark, this.hdr);
    this.add.emit(x, y, z, 0, 0, 0, 0.1, 0.35 + big * 0.5, 0.15, 0, 0, 0, 0, RAMPS.flash, hot ? this.hdr : this.hdr * 0.6);
    if (big > 0.3) this.alpha.emit(x, y + 0.1, z, R(-0.3, 0.3), R(0.3, 0.9), R(-0.3, 0.3), R(0.5, 0.9), 0.3 + big * 0.3, 0.7 + big * 0.7, R(-1, 1), 1.5, 0, 1, this.dust);
  }

  /** shield hit: a cyan flare */
  shieldHit(x: number, y: number, z: number): void {
    this.add.emit(x, y, z, 0, 0, 0, 0.18, 0.7, 1.2, 0, 0, 0, 0, RAMPS.shield, this.hdr);
    for (let i = 0; i < 4; i++) this.add.emit(x, y, z, R(-2.5, 2.5), R(0.4, 2.5), R(-2.5, 2.5), R(0.2, 0.4), 0.09, 0.03, 0, 1.5, -4, 3, RAMPS.shield, this.hdr);
  }

  heal(x: number, y: number, z: number): void {
    for (let i = 0; i < 3; i++) this.add.emit(x + R(-0.25, 0.25), y, z + R(-0.25, 0.25), 0, R(0.5, 1.3), 0, R(0.6, 1.0), 0.16, 0.05, 0, 0, 0, 0, RAMPS.heal, this.hdr);
  }

  /** a particle of rocket / shell / orb trail (call every frame per projectile; throttles itself) */
  trail(x: number, y: number, z: number, kind: 'rocket' | 'shell' | 'orb' | 'flame' | 'bullet', size = 1, ramp?: Ramp): void {
    switch (kind) {
      case 'rocket':
        this.add.emit(x, y, z, 0, 0, 0, 0.12, 0.34 * size, 0.1, 0, 0, 0, 0, RAMPS.fire, this.hdr);
        if (Math.random() < 0.8) this.alpha.emit(x, y, z, R(-0.15, 0.15), R(0.05, 0.3), R(-0.15, 0.15), R(0.9, 1.5), 0.22 * size, 0.7 * size, R(-1, 1), 1.2, 0, 1 + (Math.random() < 0.5 ? 1 : 0), RAMPS.smokeLight);
        break;
      case 'shell':
        if (Math.random() < 0.5) this.alpha.emit(x, y, z, 0, 0, 0, R(0.5, 0.9), 0.12 * size, 0.4 * size, R(-1, 1), 1.5, 0, 1, RAMPS.smokeLight);
        this.add.emit(x, y, z, 0, 0, 0, 0.1, 0.3 * size, 0.12, 0, 0, 0, 0, RAMPS.flame, this.hdr);
        break;
      case 'orb':
        this.add.emit(x, y, z, R(-0.3, 0.3), R(-0.2, 0.3), R(-0.3, 0.3), 0.28, 0.55 * size, 0.1, 0, 2, 0, 0, ramp ?? RAMPS.plasma, this.hdr);
        break;
      case 'flame':
        this.fire.emit(x + R(-0.1, 0.1), y, z + R(-0.1, 0.1), R(-0.4, 0.4), R(0.2, 1.0), R(-0.4, 0.4), R(0.25, 0.45), 0.3 * size, 0.9 * size, R(-3, 3), 1, 0, 1 + (Math.random() < 0.5 ? 1 : 0), RAMPS.flame, this.hdr);
        break;
      default: break;
    }
  }

  /* ------------------------------------------------------------------------------------------ beams / bolts */

  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: THREE.Color, w: number, life = 0.12, wob = 0): void {
    this.bolts.push({ kind: 'beam', ax, ay, az, bx, by, bz, r: color.r, g: color.g, b: color.b, w, life, max: life, seed: 0, roll: -1, pts: [], wob });
    if (this.bolts.length > 600) this.bolts.shift();
    // muzzle + impact flares
    this.add.emit(ax, ay, az, 0, 0, 0, life * 0.8, w * 5, w * 3, 0, 0, 0, 0, [color.r * 2.5, color.g * 2.5, color.b * 2.5, 1, color.r, color.g, color.b, 0.6, 0, 0, 0, 0], this.hdr);
    this.add.emit(bx, by, bz, 0, 0, 0, life * 1.2, w * 7, w * 3, 0, 0, 0, 0, [color.r * 3, color.g * 3, color.b * 3, 1, color.r * 1.2, color.g * 1.2, color.b * 1.2, 0.6, 0, 0, 0, 0], this.hdr);
    if (Math.random() < 0.5) this.add.emit(bx, by, bz, R(-2, 2), R(0.5, 3), R(-2, 2), R(0.15, 0.3), 0.07, 0.02, 0, 1.5, -10, 3, RAMPS.spark, this.hdr);
  }

  lightning(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: THREE.Color, w = 0.07, life = 0.2): void {
    // a zero-length arc has no direction: jag() would fill the instance buffer with NaN
    if (!(Math.hypot(bx - ax, by - ay, bz - az) > 1e-4)) return;
    this.bolts.push({ kind: 'bolt', ax, ay, az, bx, by, bz, r: color.r, g: color.g, b: color.b, w, life, max: life, seed: (Math.random() * 1e9) | 0, roll: -1, pts: [], wob: 0 });
    if (this.bolts.length > 600) this.bolts.shift();
    this.add.emit(bx, by, bz, 0, 0, 0, life, 0.6, 1.0, 0, 0, 0, 0, RAMPS.bolt, this.hdr);
  }

  /** short crackle of arcs crawling over a stunned hull */
  arcs(x: number, y: number, z: number, hx: number, hz: number): void {
    if (this.bolts.length > 380) return;
    const a = Math.random() * 6.283, b = a + R(0.8, 2.4);
    const col = _col.set('#9fd0ff');
    this.lightning(x + Math.cos(a) * hx, y + R(-0.1, 0.25), z + Math.sin(a) * hz, x + Math.cos(b) * hx, y + R(-0.1, 0.25), z + Math.sin(b) * hz, col, 0.035, 0.1);
  }

  /* --------------------------------------------------------------------------------------------- status */

  burning(x: number, y: number, z: number, S: number): void {
    const s = 0.25 + S * 0.12;
    this.fire.emit(x + R(-1, 1) * s, y, z + R(-1, 1) * s, R(-0.2, 0.2), R(0.8, 1.6), R(-0.2, 0.2), R(0.35, 0.6), s * 1.5, s * 0.6, R(-2, 2), 0.8, 0, 1 + (Math.random() < 0.5 ? 1 : 0), RAMPS.flame, this.hdr);
    if (Math.random() < 0.6) this.alpha.emit(x + R(-1, 1) * s, y + 0.1, z + R(-1, 1) * s, R(-0.2, 0.2), R(0.8, 1.6), R(-0.2, 0.2), R(1.1, 2.0), s * 1.2, s * 3.2, R(-1, 1), 0.6, 0, 1 + (Math.random() < 0.5 ? 1 : 0), RAMPS.smoke);
  }
  wreckSmoke(x: number, z: number, S: number): void {
    this.alpha.emit(x + R(-0.2, 0.2) * S, 0.35 + 0.1 * S, z + R(-0.2, 0.2) * S, R(-0.1, 0.1), R(0.7, 1.4), R(-0.1, 0.1), R(1.6, 2.8), 0.3 + S * 0.12, 0.9 + S * 0.35, R(-0.6, 0.6), 0.4, 0, 1 + (Math.random() < 0.5 ? 1 : 0), RAMPS.smoke);
    if (Math.random() < 0.3) this.fire.emit(x + R(-0.15, 0.15) * S, 0.3, z + R(-0.15, 0.15) * S, 0, R(0.3, 0.8), 0, R(0.3, 0.5), 0.2 + S * 0.05, 0.1, 0, 0, 0, 1, RAMPS.flame, this.hdr);
  }
  dustPuff(x: number, z: number, r: number): void {
    const n = this.lodN(4 + Math.round(r * 4));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = R(0.6, 1.8) * r;
      this.alpha.emit(x + Math.cos(a) * r * 0.3, 0.12, z + Math.sin(a) * r * 0.3, Math.cos(a) * s, R(0.1, 0.5), Math.sin(a) * s, R(0.6, 1.1), r * 0.35, r * 1.0, R(-1, 1), 3.2, 0, 1 + (i & 1), this.dust);
    }
  }
  /** a lingering smoke screen (sim 'smoke' event) */
  smokeScreen(x: number, z: number, r: number, dur: number): void { this.smokes.push({ x, z, r, left: dur, acc: 0 }); }

  /* ------------------------------------------------------------------------------------------- explosions */

  /** Fireball + shock ring + smoke column + debris + scorch, scaled by radius r (cells). style picks the palette. */
  explosion(x: number, z: number, r: number, style: 'fire' | 'plasma' | 'emp' = 'fire', y = 0, debris = true): void {
    r = clamp(r, 0.3, 9);
    const fire = style === 'plasma' ? RAMPS.plasma : style === 'emp' ? RAMPS.emp : RAMPS.fire;
    const cy = y + 0.15 + r * 0.22;
    const kq = 1 / (1 + this.heat * 0.45);
    this.heat += 1;
    this.add.emit(x, cy, z, 0, 0, 0, 0.11, r * 2.0, r * 1.5, 0, 0, 0, 0, RAMPS.flash, this.hdr * kq);
    this.pools.add(x, z, y + 0.04, r * 1.2, r * 3.0, 0.45, 1.0 * this.hdr * kq, 0.5 * this.hdr * kq, 0.15 * this.hdr * kq);
    // fireball puffs
    const nf = this.lodN(4 + Math.round(r * 3.2));
    for (let i = 0; i < nf; i++) {
      const a = Math.random() * 6.283, el = R(0.1, 1.2), sp = r * R(0.9, 2.6);
      const d = Math.random() * r * 0.4;
      this.fire.emit(x + Math.cos(a) * d, cy + R(0, r * 0.3), z + Math.sin(a) * d, Math.cos(a) * sp * 0.6, el * sp * 0.9 + 0.6, Math.sin(a) * sp * 0.6, R(0.45, 0.9) * (0.8 + r * 0.1), r * R(0.5, 0.9), r * R(1.3, 1.9), R(-1.5, 1.5), 2.6, 0.5, 1 + (i & 1), fire, this.hdr * (0.55 + 0.45 * kq));
    }
    // smoke column
    const ns = this.lodN(3 + Math.round(r * 2.6));
    for (let i = 0; i < ns; i++) {
      const a = Math.random() * 6.283, d = Math.random() * r * 0.5;
      this.alpha.emit(x + Math.cos(a) * d, y + 0.3 + r * 0.25, z + Math.sin(a) * d, R(-0.5, 0.5), R(1.0, 2.0) + r * 0.25, R(-0.5, 0.5), R(1.6, 3.1) * (0.75 + r * 0.12), r * R(0.5, 0.9), r * R(1.8, 3.0), R(-0.7, 0.7), 0.5, 0.3, 1 + (i & 1), i % 3 === 0 ? RAMPS.smokeLight : RAMPS.smoke);
    }
    // ground-hugging dust shock
    const nd = this.lodN(4 + Math.round(r * 3));
    for (let i = 0; i < nd; i++) {
      const a = (i / nd) * 6.283 + Math.random() * 0.4, sp = r * R(2.2, 4.2);
      this.alpha.emit(x, 0.14, z, Math.cos(a) * sp, R(0, 0.4), Math.sin(a) * sp, R(0.55, 1.0), r * 0.4, r * 1.1, R(-1, 1), 3.4, 0, 1 + (i & 1), this.dust);
    }
    // sparks
    const nk = this.lodN(6 + Math.round(r * 6));
    for (let i = 0; i < nk; i++) {
      const a = Math.random() * 6.283, sp = R(2, 6) + r * 1.5;
      this.add.emit(x, cy, z, Math.cos(a) * sp, R(2.5, 7) + r * 0.8, Math.sin(a) * sp, R(0.45, 1.0), 0.09 + r * 0.025, 0.02, 0, 0.9, -12, 3, RAMPS.spark, this.hdr);
    }
    this.rings.add(x, z, y + 0.07, r * 0.4, r * 2.6, 0.45 + r * 0.04, 0.6 * this.hdr * kq, 0.42 * this.hdr * kq, 0.24 * this.hdr * kq);
    if (debris) {
      const nc = this.lodN(2 + Math.round(r * 2.5));
      for (let i = 0; i < nc; i++) {
        const a = Math.random() * 6.283, sp = R(1.5, 4.5) + r * 1.2;
        this.debris.add(x, cy, z, Math.cos(a) * sp, R(4, 9) + r * 0.7, Math.sin(a) * sp, R(0.05, 0.14) * (0.7 + r * 0.35), R(0.18, 0.4));
      }
    }
    this.addScorch(x, z, r * R(1.0, 1.35));
    this.trauma = Math.min(1, this.trauma + 0.05 + r * 0.07);
    if (r > 3.2) this.flashA = Math.min(1, this.flashA + Math.min(0.55, (r - 3) * 0.14));
  }

  /** multi-stage blast for big hulls: chain of secondaries, a rolling fireball and a final cook-off */
  bigExplosion(x: number, z: number, size: number, y = 0): void {
    const r = 0.6 + size * 0.7;
    this.explosion(x, z, r, 'fire', y);
    const stages = Math.min(8, Math.max(0, size - 1) * 2);
    for (let i = 0; i < stages; i++) {
      const t = 0.12 + i * 0.17 + R(0, 0.1);
      const a = Math.random() * 6.283, d = Math.random() * size * 0.45;
      this.later.push({ t: this.time + t, fn: () => this.explosion(x + Math.cos(a) * d, z + Math.sin(a) * d, r * R(0.4, 0.75), 'fire', y, true) });
    }
    if (size >= 4) {
      this.later.push({ t: this.time + 0.25 + stages * 0.17, fn: () => { this.explosion(x, z, r * 1.25, 'fire', y); this.trauma = Math.min(1, this.trauma + 0.35); this.flashA = Math.min(1, this.flashA + 0.45); } });
      this.smokeScreen(x, z, size * 0.5, 3);
    }
  }

  private addScorch(x: number, z: number, r: number): void {
    const i = this.scorchN % 256;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(_up, Math.random() * 6.28);
    m.compose(new THREE.Vector3(x, 0.02 + (i % 7) * 0.0004, z), q, new THREE.Vector3(r * 2.4, 1, r * 2.4));
    m.toArray(this.scorch.instanceMatrix.array as unknown as number[], i * 16);
    this.scorchN++;
    this.scorch.count = Math.min(256, this.scorchN);
    this.scorch.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------------------------------------------------------------------------ update */

  update(dt: number): void {
    this.time += dt;
    this.heat = Math.max(0, this.heat - dt * 4);
    for (let i = this.later.length - 1; i >= 0; i--) if (this.later[i].t <= this.time) { const f = this.later[i].fn; this.later.splice(i, 1); f(); }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.left -= dt;
      if (s.left <= 0) { this.smokes.splice(i, 1); continue; }
      s.acc += dt * (6 + s.r * 3) * this.lod;
      while (s.acc >= 1) {
        s.acc--;
        const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * s.r;
        this.alpha.emit(s.x + Math.cos(a) * d, R(0.2, 0.8), s.z + Math.sin(a) * d, R(-0.2, 0.2), R(0.05, 0.3), R(-0.2, 0.2), R(1.8, 3.2), s.r * 0.4, s.r * 0.75, R(-0.4, 0.4), 0.3, 0, 1 + (Math.random() < 0.5 ? 1 : 0), RAMPS.smokeLight);
      }
    }
    this.add.update(dt);
    this.fire.update(dt);
    this.alpha.update(dt);
    this.rings.update(dt);
    this.pools.update(dt);
    this.debris.update(dt);
    // bolts: rebuilt each frame; lightning re-rolls its jag every 45 ms
    this.beamsCore.begin(); this.beamsGlow.begin();
    const tmp: number[] = [];
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const f = this.bolts[i];
      f.life -= dt;
      if (f.life <= 0) { this.bolts.splice(i, 1); continue; }
      const k = f.life / f.max, a = k < 0.5 ? k * 2 : 1;
      if (f.kind === 'beam') {
        const w = f.w * (1 + (f.wob ? Math.sin(this.time * 55 + i) * f.wob : 0)) * (0.6 + 0.4 * a);
        this.beamsGlow.seg(f.ax, f.ay, f.az, f.bx, f.by, f.bz, w * 3.2, w * 3.2, f.r * 0.5 * a * this.hdr, f.g * 0.5 * a * this.hdr, f.b * 0.5 * a * this.hdr);
        this.beamsCore.seg(f.ax, f.ay, f.az, f.bx, f.by, f.bz, w, w, (0.6 + f.r * 2.2) * a * this.hdr, (0.6 + f.g * 2.2) * a * this.hdr, (0.6 + f.b * 2.2) * a * this.hdr);
      } else {
        const roll = Math.floor((f.max - f.life) / 0.045);
        if (roll !== f.roll) { f.roll = roll; jag(f, mulberry(f.seed + roll * 7919), f.pts); }
        const p = f.pts;
        for (let j = 0; j + 5 < p.length; j += 6) {
          const main = j < 16 * 6 && j / 6 < clamp(Math.round(Math.hypot(f.bx - f.ax, f.by - f.ay, f.bz - f.az) / 0.45), 4, 16);
          const w = main ? f.w : f.w * 0.6;
          this.beamsGlow.seg(p[j], p[j + 1], p[j + 2], p[j + 3], p[j + 4], p[j + 5], w * 3.5, w * 3.5, f.r * 0.45 * a * this.hdr, f.g * 0.45 * a * this.hdr, f.b * 0.45 * a * this.hdr);
          this.beamsCore.seg(p[j], p[j + 1], p[j + 2], p[j + 3], p[j + 4], p[j + 5], w, w, (0.9 + f.r * 2.0) * a * this.hdr, (0.9 + f.g * 2.0) * a * this.hdr, (0.9 + f.b * 2.0) * a * this.hdr);
        }
      }
    }
    void tmp;
    this.beamsCore.end(); this.beamsGlow.end();
  }

  dispose(): void {
    this.add.dispose(); this.fire.dispose(); this.alpha.dispose();
    this.atlas.dispose();
  }
}

const _col = new THREE.Color();
