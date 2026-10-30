// Screen-constant overlays for the 3D view: a batched quad/triangle painter for health bars, paralysis meters and level pips
// (drawn after post-processing so colours stay exact), and pooled hex-lattice shield domes with hit ripples.

import * as THREE from 'three';
import { uploadPrefix } from './upload.ts';

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
    // 4 vertices a quad
    uploadPrefix(this.geo.attributes.position as THREE.BufferAttribute, this.n * 4);
    uploadPrefix(this.geo.attributes.color as THREE.BufferAttribute, this.n * 4);
    this.mesh.visible = this.n > 0;
  }
  get quads(): number { return this.n; }
}

/* --------------------------------------------------------------------------------------------- shield bubbles */

// An energy dome: a hex lattice (projected from above, so the cells read evenly from the battle camera) that ripples
// like water, a bright fresnel rim, a glowing band where it meets the ground, shimmering cells, and up to 4 hit
// ripples at once (rings racing out from each impact, lighting the hex edges as they pass). Additive, both faces (the
// far inside wall adds depth at a third of the strength).
const shieldVS = /* glsl */ `
  varying vec3 vN; varying vec3 vP; varying vec3 vV;
  void main() {
    vP = position;
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const shieldFS = /* glsl */ `
  varying vec3 vN; varying vec3 vP; varying vec3 vV;
  uniform float uBase; uniform float uTime; uniform vec3 uCol; uniform vec4 uHits[4]; uniform float uSeed;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  // nearest hex cell: xy = offset from its centre, zw = cell id
  vec4 hexCell(vec2 uv) {
    const vec2 s = vec2(1.0, 1.7320508);
    vec4 c = floor(vec4(uv, uv - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
    vec4 h = vec4(uv - c.xy * s, uv - (c.zw + 0.5) * s);
    return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, c.xy) : vec4(h.zw, c.zw + 0.5);
  }
  void main() {
    vec3 p = normalize(vP);
    // ripples: hit rings plus a slow ambient swell, also used to warp the lattice (water-like)
    float ring = 0.0, flash = 0.0, warp = 0.0;
    for (int i = 0; i < 4; i++) {
      vec4 hh = uHits[i];
      if (hh.w >= 1.0) continue;
      float ang = acos(clamp(dot(p, hh.xyz), -1.0, 1.0));
      float k = 1.0 - hh.w;
      float d = ang - (0.08 + hh.w * 2.6);
      ring += (exp(-d * d * 140.0) + 0.5 * exp(-(d + 0.3) * (d + 0.3) * 200.0)) * k;
      flash += exp(-ang * ang * 40.0) * k * k;
      warp += sin(d * 26.0) * exp(-d * d * 12.0) * k;
    }
    vec2 uv = vP.xz * 3.6 + vec2(sin(vP.z * 9.0 + uTime * 1.3), cos(vP.x * 8.0 - uTime * 1.1)) * 0.06 + p.xz * warp * 0.35;
    vec4 hx = hexCell(uv);
    float hd = max(dot(abs(hx.xy), vec2(0.8660254, 0.5)), abs(hx.y));
    float edge = smoothstep(0.36, 0.48, hd);
    float rid = h21(hx.zw + uSeed);
    float shimmer = smoothstep(0.82, 1.0, sin(uTime * (1.2 + rid * 2.0) + rid * 40.0)) * 0.6;
    float fres = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float rim = pow(fres, 2.6);
    float ground = exp(-pow((vP.y + 0.42) * 10.0, 2.0));
    float face = gl_FrontFacing ? 1.0 : 0.35;
    float a = uBase * (0.2 + 0.9 * rim + edge * (0.9 + 1.6 * rim) + shimmer * (1.0 - edge) * 0.3)
            + rim * 0.06 + ground * uBase * 2.2
            + ring * (0.25 + edge * 1.6) + flash * 0.4;
    vec3 col = uCol * (1.0 + ring * 1.4 + flash) + vec3(0.6, 0.8, 1.0) * (ring * edge + flash * 0.6);
    gl_FragColor = vec4(col * a * face, 1.0);
  }`;

export interface Bubble { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }

export class ShieldPool {
  readonly group = new THREE.Group();
  private items: Bubble[] = [];
  private used = 0;
  private geo = new THREE.SphereGeometry(1, 40, 24);
  constructor() { this.group.name = 'shields'; }
  begin(): void { this.used = 0; }
  next(): Bubble {
    let b = this.items[this.used];
    if (!b) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: shieldVS, fragmentShader: shieldFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
        uniforms: {
          uBase: { value: 0.1 }, uTime: { value: 0 }, uCol: { value: new THREE.Color(0.3, 0.72, 1.7) }, uSeed: { value: Math.random() * 50 },
          uHits: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 1, 0, 1)) },
        },
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
