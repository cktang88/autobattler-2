// Screen-constant overlays for the 3D view: a batched quad/triangle painter for health bars, paralysis meters and level pips
// (drawn after post-processing so colours stay exact), and pooled shield bubbles with a hit ripple.

import * as THREE from 'three';

type RGB = readonly [number, number, number];
export const rgb = (hex: string): RGB => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

export class Overlay {
  readonly scene = new THREE.Scene();
  private pos: Float32Array;
  private col: Float32Array;
  private geo = new THREE.BufferGeometry();
  private n = 0;
  private right = new THREE.Vector3();
  private upv = new THREE.Vector3();
  private inv = 1;
  readonly mesh: THREE.Mesh;

  private cap: number;
  constructor(cap = 14000) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 12);
    this.col = new Float32Array(cap * 16);
    const idx = new Uint32Array(cap * 6);
    for (let i = 0; i < cap; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    const pa = new THREE.BufferAttribute(this.pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
    const ca = new THREE.BufferAttribute(this.col, 4); ca.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', pa);
    this.geo.setAttribute('color', ca);
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 100;
    this.scene.add(this.mesh);
  }

  /** start a frame: k = CSS px per world unit; offsets below are in CSS px along the camera's right / up axes */
  begin(camera: THREE.Camera, k: number): void {
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    this.right.set(e[0], e[1], e[2]);
    this.upv.set(e[4], e[5], e[6]);
    this.inv = 1 / k;
    this.n = 0;
  }
  private v(i: number, ax: number, ay: number, az: number, ox: number, oy: number): void {
    const o = (this.n * 4 + i) * 3, s = this.inv;
    this.pos[o] = ax + (this.right.x * ox + this.upv.x * oy) * s;
    this.pos[o + 1] = ay + (this.right.y * ox + this.upv.y * oy) * s;
    this.pos[o + 2] = az + (this.right.z * ox + this.upv.z * oy) * s;
  }
  private c(i: number, c: RGB, a: number): void {
    const o = (this.n * 4 + i) * 4;
    this.col[o] = c[0]; this.col[o + 1] = c[1]; this.col[o + 2] = c[2]; this.col[o + 3] = a;
  }
  /** rectangle with its lower-left corner at (ox, oy) px from the world anchor */
  rect(ax: number, ay: number, az: number, ox: number, oy: number, w: number, h: number, c: RGB, a = 1): void {
    if (this.n >= this.cap || a <= 0.005 || w <= 0) return;
    this.v(0, ax, ay, az, ox, oy); this.v(1, ax, ay, az, ox + w, oy); this.v(2, ax, ay, az, ox + w, oy + h); this.v(3, ax, ay, az, ox, oy + h);
    for (let i = 0; i < 4; i++) this.c(i, c, a);
    this.n++;
  }
  tri(ax: number, ay: number, az: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB, a = 1): void {
    if (this.n >= this.cap || a <= 0.005) return;
    this.v(0, ax, ay, az, x0, y0); this.v(1, ax, ay, az, x1, y1); this.v(2, ax, ay, az, x2, y2); this.v(3, ax, ay, az, x2, y2);
    for (let i = 0; i < 4; i++) this.c(i, c, a);
    this.n++;
  }
  quad(ax: number, ay: number, az: number, p: readonly number[], c: RGB, a = 1): void {
    if (this.n >= this.cap || a <= 0.005) return;
    for (let i = 0; i < 4; i++) { this.v(i, ax, ay, az, p[i * 2], p[i * 2 + 1]); this.c(i, c, a); }
    this.n++;
  }
  end(): void {
    this.geo.setDrawRange(0, this.n * 6);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.mesh.visible = this.n > 0;
  }
  get quads(): number { return this.n; }
}

/* --------------------------------------------------------------------------------------------- shield bubbles */

const shieldVS = /* glsl */ `
  varying vec3 vN; varying vec3 vP;
  void main() {
    vP = normalize(position);
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const shieldFS = /* glsl */ `
  varying vec3 vN; varying vec3 vP;
  uniform float uBase; uniform float uHit; uniform vec3 uHitDir; uniform float uAge; uniform float uTime; uniform vec3 uCol;
  void main() {
    float f = 1.0 - abs(dot(normalize(vN), vec3(0.0, 0.0, 1.0)));
    float rim = pow(f, 2.2);
    float scan = 0.5 + 0.5 * sin(vP.y * 28.0 - uTime * 1.6 + vP.x * 6.0);
    float a = uBase * (0.35 + 0.65 * rim) + rim * 0.12 + scan * 0.012 * uBase * 8.0;
    // hit ripple: an expanding ring around the impact direction
    float ang = acos(clamp(dot(normalize(vP), uHitDir), -1.0, 1.0));
    float rr = uAge * 2.4;
    float ring = exp(-pow((ang - rr) * 5.0, 2.0)) * uHit;
    float core = exp(-pow(ang * 2.4, 2.0)) * uHit * 0.55;
    float al = a + ring * 0.9 + core;
    gl_FragColor = vec4(uCol * (1.0 + ring * 1.6), min(1.0, al));
  }`;

export interface Bubble { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }

export class ShieldPool {
  readonly group = new THREE.Group();
  private items: Bubble[] = [];
  private used = 0;
  private geo = new THREE.SphereGeometry(1, 28, 16);
  constructor() { this.group.name = 'shields'; }
  begin(): void { this.used = 0; }
  next(): Bubble {
    let b = this.items[this.used];
    if (!b) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: shieldVS, fragmentShader: shieldFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uBase: { value: 0.1 }, uHit: { value: 0 }, uHitDir: { value: new THREE.Vector3(0, 1, 0) }, uAge: { value: 0 }, uTime: { value: 0 }, uCol: { value: new THREE.Color(0.35, 0.85, 1.2) } },
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.renderOrder = 9; mesh.frustumCulled = false;
      this.group.add(mesh);
      b = { mesh, mat };
      this.items.push(b);
    }
    b.mesh.visible = true;
    this.used++;
    return b;
  }
  end(): void { for (let i = this.used; i < this.items.length; i++) this.items[i].mesh.visible = false; }
  dispose(): void { for (const b of this.items) b.mat.dispose(); this.geo.dispose(); }
}
