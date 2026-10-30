// Effects for the 3D battlefield: GPU-instanced billboard particles (additive glows and velocity-stretched spark streaks,
// lobed flipbook fireballs that cool into soot, sun-lit flipbook smoke / dust with a soft fade against the ground),
// chunky tumbling debris in the dead hull's paint, one crisp shock ring per blast, persistent soft scorch decals,
// camera-facing soft ribbons for beams / lightning / tracers, shell / rocket projectile bodies. The flipbooks come from
// public/assets/fx/fx_atlas.webp (scripts/gen-fx-atlas.py), loaded asynchronously; until then a procedural canvas atlas
// keeps the older soft look. Everything is a handful of draw calls regardless of how much is going on.
// Pure three.js: knows nothing about the sim. FieldView3D feeds it world positions (x, y = height, z).

import * as THREE from 'three';
import { uploadPrefix } from './upload.ts';

const R = (a: number, b: number) => a + Math.random() * (b - a);
const _rc = new THREE.Color();
/** share of blast / hit / muzzle smoke and dust puffs actually emitted (see Fx3D.puff) */
const PUFF_KEEP = 0.45;
/** light breeze the lingering smoke trails drift off with (world x, z per s) */
const WIND_X = 0.22, WIND_Z = 0.09;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------------------------------------------------ colour ramps */

/** 3-stop colour ramp (rgba x 3) at particle age 0, 0.35, 1. rgb > 1 is HDR (blooms). */
export type Ramp = readonly number[];
export const RAMPS = {
  fire: [3.8, 2.7, 1.1, 0.9, 2.7, 1.1, 0.16, 0.8, 0.5, 0.12, 0.02, 0],
  flame: [3.6, 2.3, 0.6, 0.95, 2.7, 0.95, 0.12, 0.8, 0.45, 0.08, 0.02, 0],
  plasma: [2.8, 1.6, 3.2, 1, 1.6, 0.5, 2.4, 0.85, 0.2, 0.05, 0.4, 0],
  emp: [2.4, 3.0, 4.0, 1, 0.9, 1.8, 3.2, 0.8, 0.1, 0.3, 0.8, 0],
  spark: [5.0, 3.6, 1.3, 1, 3.6, 1.5, 0.25, 0.95, 1.4, 0.3, 0.05, 0],
  flash: [4.3, 3.5, 2.3, 1, 2.9, 1.7, 0.6, 0.65, 1.2, 0.5, 0.13, 0],
  smoke: [0.15, 0.14, 0.13, 0.5, 0.22, 0.2, 0.18, 0.36, 0.3, 0.28, 0.26, 0],
  smokeLight: [0.22, 0.215, 0.205, 0.26, 0.2, 0.195, 0.185, 0.16, 0.2, 0.195, 0.19, 0],
  /** gameplay smoke screen: stays a readable light grey */
  screen: [0.34, 0.33, 0.31, 0.3, 0.34, 0.33, 0.32, 0.2, 0.34, 0.34, 0.33, 0],
  /** rocket / missile exhaust: a thin light-grey streak that fades fast */
  exhaustSmoke: [0.6, 0.6, 0.58, 0.3, 0.5, 0.5, 0.49, 0.18, 0.45, 0.45, 0.44, 0],
  /** flipbook fireball tint: the atlas carries the temperature, this sets the hue and brightness */
  fireball: [4.6, 2.7, 0.7, 1, 3.6, 1.6, 0.25, 1, 1.7, 0.5, 0.08, 0],
  /** explosion smoke: fades in while the fire burns, lingers grey-brown, lit by the sun */
  blastSmoke: [0.08, 0.075, 0.07, 0.05, 0.1, 0.095, 0.09, 0.55, 0.13, 0.125, 0.12, 0],
  heal: [0.7, 2.8, 1.1, 1, 0.3, 1.6, 0.6, 0.6, 0.1, 0.8, 0.3, 0],
  shield: [1.2, 2.6, 3.4, 1, 0.5, 1.5, 2.6, 0.7, 0.2, 0.6, 1.2, 0],
  bolt: [2.8, 3.4, 4.5, 1, 1.6, 2.4, 4.0, 0.8, 0.3, 0.7, 2.0, 0],
  /** slow / freeze: icy glints and mist */
  frost: [1.6, 2.4, 3.0, 0.9, 0.7, 1.4, 2.0, 0.6, 0.4, 0.7, 1.0, 0],
  frostMist: [0.78, 0.92, 1.0, 0.42, 0.72, 0.88, 1.0, 0.28, 0.7, 0.85, 0.95, 0],
  /** disarm: amber sputter */
  jam: [3.0, 2.2, 0.4, 1, 2.0, 1.1, 0.1, 0.8, 0.6, 0.2, 0, 0],
  /** gauss slug: blue-white */
  gauss: [1.8, 2.6, 4.0, 1, 0.8, 1.4, 3.0, 0.7, 0.2, 0.4, 1.2, 0],
  /** rail muzzle / impact: white-hot, then electric blue */
  railFlash: [4.0, 4.4, 5.0, 1, 1.4, 2.2, 4.4, 0.8, 0.25, 0.5, 1.6, 0],
  /** flak burst: oily black puffs */
  flakSmoke: [0.05, 0.05, 0.05, 0.8, 0.09, 0.09, 0.09, 0.6, 0.14, 0.14, 0.14, 0],
  /** flak airburst puff: near-black and dense at first, thinning to a dark grey as it hangs and drifts */
  flakPuff: [0.035, 0.034, 0.033, 0.92, 0.06, 0.058, 0.056, 0.7, 0.12, 0.118, 0.115, 0],
  /** rocket motor flame: orange, hot but not blown out */
  exhaust: [2.2, 1.2, 0.35, 0.9, 1.4, 0.45, 0.08, 0.6, 0.4, 0.08, 0.02, 0],
  /** missile contrail: thin white */
  contrail: [0.92, 0.92, 0.9, 0.55, 0.86, 0.86, 0.85, 0.36, 0.8, 0.8, 0.8, 0],
  /** napalm / incendiary: sticky deep orange + dark smoke */
  ember: [4.2, 2.2, 0.4, 1, 3.2, 1.0, 0.08, 0.95, 0.7, 0.15, 0, 0],
  molten: [3.2, 2.0, 0.8, 1, 2.4, 0.9, 0.15, 0.9, 0.8, 0.15, 0.02, 0],
  gravity: [1.4, 0.6, 2.6, 1, 0.7, 0.25, 1.8, 0.8, 0.15, 0.02, 0.5, 0],
  /** fallout: sickly radioactive green glow and haze */
  rad: [1.2, 3.2, 0.6, 1, 0.5, 2.0, 0.3, 0.7, 0.1, 0.6, 0.1, 0],
  radHaze: [0.35, 0.6, 0.22, 0.4, 0.3, 0.5, 0.2, 0.25, 0.25, 0.4, 0.18, 0],
  needle: [2.6, 3.0, 3.4, 1, 1.4, 1.8, 2.4, 0.8, 0.3, 0.4, 0.6, 0],
  /** barrel heat (spin-up guns): dull red to orange */
  heat: [1.6, 0.42, 0.08, 0.9, 1.4, 0.32, 0.05, 0.7, 0.8, 0.12, 0.02, 0],
  sonic: [1.4, 1.5, 1.3, 0.55, 0.9, 1.0, 0.9, 0.3, 0.3, 0.35, 0.3, 0],
  /** damage wisps (thin, rising): coolant / hydraulic steam hissing out of a joint */
  steam: [0.7, 0.71, 0.72, 0.45, 0.64, 0.65, 0.66, 0.3, 0.6, 0.61, 0.62, 0],
  /** oily engine smoke: brown-black, a little denser */
  oilSmoke: [0.09, 0.08, 0.07, 0.5, 0.13, 0.12, 0.1, 0.38, 0.2, 0.19, 0.17, 0],
  /** thick black smoke of a critically damaged / burning hull */
  blackSmoke: [0.05, 0.045, 0.04, 0.42, 0.08, 0.075, 0.07, 0.32, 0.15, 0.14, 0.13, 0],
  /** electrical smoke off high-tech hulls: blue-grey */
  elecSmoke: [0.32, 0.38, 0.5, 0.4, 0.3, 0.34, 0.44, 0.3, 0.3, 0.32, 0.36, 0],
  /** hot shaped-charge jet: white core, blue-white edge */
  jet: [4.0, 3.6, 3.0, 1, 2.6, 1.6, 0.7, 0.8, 0.8, 0.3, 0.08, 0],
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

/* ------------------------------------------------------------------------------------------- flipbook atlas */

// public/assets/fx/fx_atlas.webp (scripts/gen-fx-atlas.py): fireball + smoke flipbooks (8x8 frames each, RG = screen
// normal, B = temperature / thinness, A = density) and a row of misc sprites. Loaded once, asynchronously; until it
// arrives (or if it is missing) every effect keeps the procedural canvas atlas above.
let fxBase = 'assets/fx/';
/** Override the effect texture folder (relative to the page). */
export function setFxTextureBase(path: string): void { fxBase = path.endsWith('/') ? path : path + '/'; }
let fxAtlas: THREE.Texture | null = null;
let fxAtlasState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
const fxAtlasWaiters: ((t: THREE.Texture) => void)[] = [];
function whenFxAtlas(cb: (t: THREE.Texture) => void): void {
  if (fxAtlas) { cb(fxAtlas); return; }
  fxAtlasWaiters.push(cb);
  if (fxAtlasState !== 'idle' || typeof document === 'undefined' || typeof Image === 'undefined') return;
  fxAtlasState = 'loading';
  new THREE.TextureLoader().load(fxBase + 'fx_atlas.webp', (t) => {
    t.colorSpace = THREE.NoColorSpace; // packed data (normals / temperature), not colour
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = 4;
    t.needsUpdate = true;
    fxAtlas = t; fxAtlasState = 'ready';
    for (const w of fxAtlasWaiters.splice(0)) w(t);
  }, undefined, () => { fxAtlasState = 'failed'; });
}
/** misc sprite tiles of the atlas (bottom half, 8 x 4 tiles of 1/8 x 1/8) */
const MISC = { glow: 0, streak: 1, star: 2, dot: 3, ring: 4, scorch: 5, chip: 6, disc: 7 } as const;
function miscUv(tex: THREE.Texture, tile: number): THREE.Texture {
  const t = tex.clone();
  t.repeat.set(1 / 8, 1 / 8);
  t.offset.set((tile % 8) / 8, 0.5 - (Math.floor(tile / 8) + 1) / 8);
  t.needsUpdate = true;
  return t;
}

/** shared per-frame view uniforms for every effect shader */
const fxView = {
  /** world direction toward the sun (lights the smoke) */
  uSun: { value: new THREE.Vector3(-0.55, 0.62, 0.35).normalize() },
  /** world size of one screen pixel per unit of view distance (2 tan(fov/2) / viewport px): keeps thin streaks >= ~1 px */
  uPxK: { value: 0.0015 },
};

/* ---------------------------------------------------------------------------------------------- particles */

/** Particle tiles (emit `tex`): 0 glow, 1 + 2 billowing puff (fire pool: fireball flipbook, otherwise smoke flipbook;
 *  2 is the mirrored variant), 3 spark (a streak stretched along its velocity once the atlas is in), 4 star flare,
 *  6 muzzle tongue (a flame petal rooted at its position, pointing along its velocity, |velocity| = length / width;
 *  it does not move). */
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
  private aVel: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;

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
    this.aPos = mk(3); this.aSR = mk(2); this.aCol = mk(4); this.aTex = mk(1); this.aVel = mk(3);
    geo.setAttribute('iPos', this.aPos); geo.setAttribute('iSR', this.aSR); geo.setAttribute('iCol', this.aCol); geo.setAttribute('iTex', this.aTex); geo.setAttribute('iVel', this.aVel);
    geo.instanceCount = 0;
    this.geo = geo;
    const kind = mode === 'add' ? 0 : mode === 'fire' ? 1 : 2;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: atlas }, uMode: { value: 0 }, uSun: fxView.uSun, uPxK: fxView.uPxK },
      defines: { KIND: kind },
      vertexShader: /* glsl */ `
        attribute vec3 iPos; attribute vec2 iSR; attribute vec4 iCol; attribute float iTex; attribute vec3 iVel;
        uniform float uMode; uniform vec3 uSun; uniform float uPxK;
        varying vec2 vUv; varying vec4 vCol; varying float vT; varying float vTile; varying vec2 vRot; varying vec3 vSunV;
        varying float vSoft; varying float vGain;
        void main() {
          float tile = floor(iTex + 1e-3);
          vT = clamp(iTex - tile, 0.0, 1.0);
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float c = cos(iSR.y), s = sin(iSR.y);
          vec2 ax = vec2(c, s), ay = vec2(-s, c);
          vec2 q = position.xy * iSR.x;
          vGain = 1.0;
          float dist = length(cameraPosition - iPos);
          if (uMode > 0.5 && tile > 2.5 && tile < 3.5) {
            // spark: a streak along its screen-space velocity, long when fast; at least ~1.3 px thick
            vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
            float sp = length(vv.xy);
            if (sp > 0.25) {
              ax = vv.xy / sp; ay = vec2(-ax.y, ax.x);
              float len = iSR.x * 1.6 + length(iVel) * 0.075;
              float w = iSR.x * 0.5, wMin = uPxK * dist * 2.6;
              vGain = min(1.0, w / wMin) * 1.6;
              q = vec2(position.x * len, position.y * max(w, wMin));
              tile = 5.0; // streak sprite
            }
          }
          if (tile > 5.5 && tile < 6.5) {
            // muzzle tongue: rooted at iPos, along iVel (screen-projected, so a flash toward the camera foreshortens
            // into a round burst), |iVel| = length / width
            vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
            float vl = length(vv), sp = length(vv.xy);
            ax = sp > 1e-4 ? vv.xy / sp : vec2(1.0, 0.0); ay = vec2(-ax.y, ax.x);
            float wd = iSR.x / max(1.0, vl);
            float len = max(iSR.x * (vl > 1e-4 ? sp / vl : 0.0), wd * 1.1);
            q = vec2((position.x + 0.5) * len, position.y * wd);
          }
          vec2 o = ax * q.x + ay * q.y;
          vec3 wp = iPos + right * o.x + up * o.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
          vRot = ax;
          // soft particles against the ground plane: fade as the billboard nears y = 0 along the view ray
          vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
          vSoft = (wp.y / max(0.3, -fwd.y)) / max(0.04, iSR.x * 0.3);
          vSunV = normalize((viewMatrix * vec4(uSun, 0.0)).xyz);
          vTile = tile;
          vUv = uv;
          vCol = iCol;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform float uMode;
        varying vec2 vUv; varying vec4 vCol; varying float vT; varying float vTile; varying vec2 vRot; varying vec3 vSunV;
        varying float vSoft; varying float vGain;
        vec2 miscUv(float m, vec2 uv) { return vec2((mod(m, 8.0) + uv.x) / 8.0, 0.5 - (floor(m / 8.0) + 1.0 - uv.y) / 8.0); }
        vec2 flipUv(float region, float fr, vec2 uv) {
          float col = mod(fr, 8.0), row = floor(fr / 8.0);
          return vec2((region * 8.0 + col + uv.x) / 16.0, 1.0 - (row + 1.0 - uv.y) / 16.0);
        }
        void main() {
          vec3 rgb = vCol.rgb; float a;
          if (vTile > 5.5) {
            // muzzle tongue: narrow neck at the muzzle, fat body a third of the way out, pointed tip; white-hot along the
            // axis near the root
            float x = vUv.x, y = vUv.y * 2.0 - 1.0;
            float prof = pow(x, 0.45) * pow(1.0 - x, 0.9) * 2.3;
            float d = abs(y) / max(prof, 1e-3);
            a = (1.0 - smoothstep(0.4, 1.0, d)) * smoothstep(0.0, 0.05, x) * vCol.a;
            // white-hot along the axis near the root, burning out to orange-yellow at the edges and the tip
            float core = exp(-d * d * 5.0) * (1.0 - 0.75 * x);
            rgb = mix(rgb * vec3(0.62, 0.42, 0.2), rgb * 1.05, core);
          } else if (uMode < 0.5) {
            // procedural fallback atlas (2 x 2)
            float t = vTile > 3.5 ? 0.0 : vTile;
            vec2 cell = vec2(mod(t, 2.0), floor(t / 2.0));
            a = texture2D(map, (cell + vUv) * 0.5).a * vCol.a;
          } else if (vTile > 0.5 && vTile < 2.5) {
            // billowing flipbook puff, two frames blended
            vec2 uv = vTile > 1.5 ? vec2(1.0 - vUv.x, vUv.y) : vUv;
            float fr = vT * 62.999, f0 = floor(fr);
            float region = ${kind === 1 ? '0.0' : '1.0'};
            vec4 tx = mix(texture2D(map, flipUv(region, f0, uv)), texture2D(map, flipUv(region, min(f0 + 1.0, 63.0), uv)), fr - f0);
            vec2 nxy = tx.rg * 2.0 - 1.0;
            if (vTile > 1.5) nxy.x = -nxy.x;
            nxy = vec2(nxy.x * vRot.x - nxy.y * vRot.y, nxy.x * vRot.y + nxy.y * vRot.x);
            vec3 n = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
            float ndl = dot(n, vSunV);
            float lit = clamp(ndl * 0.62 + 0.42, 0.0, 1.0);
            float soft = clamp(vSoft, 0.0, 1.0);
            a = tx.a * vCol.a * soft;
            #if KIND == 1
              // fireball: emission by temperature (tinted by the particle colour), cold parts are lit soot
              float T = tx.b;
              float hot = smoothstep(0.04, 0.5, T);
              vec3 emit = rgb * (0.1 + 0.8 * T * T) * hot + vec3(1.0, 0.75, 0.4) * smoothstep(0.88, 1.0, T) * 0.7 * min(1.0, dot(rgb, vec3(0.33)));
              vec3 soot = vec3(0.075, 0.068, 0.062) * (0.35 + 1.5 * lit) + vec3(0.12, 0.05, 0.01) * hot;
              rgb = mix(soot, emit, hot);
            #elif KIND == 2
              // smoke / dust: lit by the sun (wrap diffuse), thin wisps let a little light through
              rgb *= (0.3 + 1.05 * lit) * vec3(1.08, 1.0, 0.88) + tx.b * 0.1;
            #else
              a *= 0.8;
            #endif
          } else {
            if (vTile > 4.5) {
              // velocity streak: gaussian across, hot head, long tapering tail
              vec2 c = vUv * 2.0 - 1.0;
              a = exp(-c.y * c.y * 6.0) * smoothstep(1.0, 0.75, c.x) * smoothstep(-1.0, 0.2, c.x) * (0.45 + 0.55 * (c.x * 0.5 + 0.5)) * vCol.a * vGain;
            } else {
              float m = vTile < 0.5 ? ${MISC.glow}.0 : vTile < 3.5 ? ${MISC.dot}.0 : ${MISC.star}.0;
              a = texture2D(map, miscUv(m, vUv)).a * vCol.a * vGain;
            }
          }
          if (a < 0.003) discard;
          ${mode === 'fire' ? 'gl_FragColor = vec4(rgb * a, a);' : 'gl_FragColor = vec4(rgb, a);'}
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, depthTest: true,
      blending: mode === 'add' ? THREE.AdditiveBlending : mode === 'fire' ? THREE.CustomBlending : THREE.NormalBlending,
      ...(mode === 'fire' ? { blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor } : {}),
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = mode === 'add' ? 8 : mode === 'fire' ? 7 : 6;
  }

  /** switch to the flipbook atlas */
  useAtlas(t: THREE.Texture): void { this.mat.uniforms.map.value = t; this.mat.uniforms.uMode.value = 1; }

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
      if (this.tex[i] > 5.5) { i++; continue; } // muzzle tongues stay put (their velocity is a direction)
      const dk = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= dk; this.vy[i] = this.vy[i] * dk + this.grav[i] * dt; this.vz[i] *= dk;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.03 && this.grav[i] < 0) { this.py[i] = 0.03; this.vy[i] = 0; this.vx[i] *= 0.5; this.vz[i] *= 0.5; }
      i++;
    }
    const aP = this.aPos.array as Float32Array, aS = this.aSR.array as Float32Array, aC = this.aCol.array as Float32Array, aT = this.aTex.array as Float32Array, aV = this.aVel.array as Float32Array;
    for (let j = 0; j < this.n; j++) {
      const t = this.age[j] / this.life[j];
      aP[j * 3] = this.px[j]; aP[j * 3 + 1] = this.py[j]; aP[j * 3 + 2] = this.pz[j];
      aV[j * 3] = this.vx[j]; aV[j * 3 + 1] = this.vy[j]; aV[j * 3 + 2] = this.vz[j];
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
      // tile in the integer part, life fraction (flipbook frame) in the fraction
      aT[j] = this.tex[j] + Math.min(0.999, t);
    }
    this.geo.instanceCount = this.n;
    for (const a of this.attrs) uploadPrefix(a, this.n);
  }

  private get attrs() { return [this.aPos, this.aSR, this.aCol, this.aTex, this.aVel]; }
  private copy(from: number, to: number): void {
    // runs per particle death: no per-call array
    this.px[to] = this.px[from]; this.py[to] = this.py[from]; this.pz[to] = this.pz[from];
    this.vx[to] = this.vx[from]; this.vy[to] = this.vy[from]; this.vz[to] = this.vz[from];
    this.age[to] = this.age[from]; this.life[to] = this.life[from]; this.s0[to] = this.s0[from]; this.s1[to] = this.s1[from];
    this.rot[to] = this.rot[from]; this.spin[to] = this.spin[from]; this.drag[to] = this.drag[from]; this.grav[to] = this.grav[from];
    this.tex[to] = this.tex[from];
    for (let k = 0; k < 12; k++) this.ramp[to * 12 + k] = this.ramp[from * 12 + k];
  }

  clear(): void { this.n = 0; this.geo.instanceCount = 0; }
  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}

/* ------------------------------------------------------------------------------------------ flat decal pool */

/** ground-plane quads (shock rings, light pools) with life + per-instance colour fade */
class Flats {
  readonly mesh: THREE.InstancedMesh;
  n = 0;
  private d: { x: number; z: number; y: number; s0: number; s1: number; rot: number; age: number; life: number; r: number; g: number; b: number }[] = [];
  readonly cap: number;
  /** hold: snap out to s1 in the first 18% of the life and stay there while fading (an area marker, not a shock ring) */
  private hold: boolean;
  constructor(cap: number, geo: THREE.BufferGeometry, mat: THREE.Material, order: number, hold = false) {
    this.cap = cap;
    this.hold = hold;
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
      const t = e.age / e.life;
      const ts = this.hold ? Math.min(1, t / 0.18) : t;
      const sc = e.s0 + (e.s1 - e.s0) * (1 - (1 - ts) * (1 - ts));
      q.setFromAxisAngle(up, e.rot);
      m.compose(p.set(e.x, e.y, e.z), q, s.set(sc, 1, sc));
      m.toArray(this.mesh.instanceMatrix.array as unknown as number[], w * 16);
      const f = this.hold ? (t < 0.18 ? 0.6 + 0.4 * ts : 1 - (t - 0.18) / 0.82) : (1 - t) * (1 - t);
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

/** chunky angular shard: a flattened, irregular low-poly lump (reads as a torn plate or a rock at any angle) */
function shardGeometry(): THREE.BufferGeometry {
  const g = new THREE.DodecahedronGeometry(0.62, 0);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  let s = 7;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const jit = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let j = jit.get(k);
    if (j === undefined) { j = 0.75 + rnd() * 0.5; jit.set(k, j); }
    p.setXYZ(i, p.getX(i) * j * 1.15, p.getY(i) * j * 0.5, p.getZ(i) * j * 0.9);
  }
  g.computeVertexNormals();
  return g;
}

/** Short-lived flying fragments: chunky shards in the dead unit's paint (or dirt / rock), glowing hot for their first
 *  half second, tumbling, bouncing and shrinking away. */
class Debris {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private cap: number;
  private a: Float32Array; // x y z vx vy vz rx ry rz wx wy wz size life age heat
  private heatAttr: THREE.InstancedBufferAttribute;
  constructor(cap: number) {
    this.cap = cap;
    this.a = new Float32Array(cap * 16);
    const geo = shardGeometry();
    this.heatAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.heatAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iHeat', this.heatAttr);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.62, metalness: 0.45, flatShading: true });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float iHeat; varying float vHeat;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = iHeat;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vHeat;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(2.6, 0.9, 0.22) * vHeat * vHeat * 2.0;');
    };
    mat.customProgramCacheKey = () => 'fxDebris1';
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.castShadow = true;
    this.colors = new Float32Array(cap * 3);
  }
  private colors: Float32Array;
  /** tone: grey level, or an rgb paint colour; heat 0..1: glows orange-hot, cooling over ~0.6 s */
  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, tone: number | readonly [number, number, number], heat = 0): void {
    const i = this.n < this.cap ? this.n++ : Math.floor(Math.random() * this.cap);
    const o = i * 16, a = this.a;
    a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = vx; a[o + 4] = vy; a[o + 5] = vz;
    a[o + 6] = Math.random() * 6; a[o + 7] = Math.random() * 6; a[o + 8] = Math.random() * 6;
    a[o + 9] = R(-9, 9); a[o + 10] = R(-9, 9); a[o + 11] = R(-9, 9);
    a[o + 12] = size; a[o + 13] = R(1.6, 3.2); a[o + 14] = 0; a[o + 15] = heat;
    if (typeof tone === 'number') { this.colors[i * 3] = tone; this.colors[i * 3 + 1] = tone * 0.92; this.colors[i * 3 + 2] = tone * 0.85; }
    else { this.colors[i * 3] = tone[0]; this.colors[i * 3 + 1] = tone[1]; this.colors[i * 3 + 2] = tone[2]; }
  }
  update(dt: number): void {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
    const col = this.mesh.instanceColor!.array as Float32Array, ht = this.heatAttr.array as Float32Array;
    let i = 0;
    while (i < this.n) {
      const o = i * 16, a = this.a;
      a[o + 14] += dt;
      if (a[o + 14] >= a[o + 13]) { // swap-remove
        const l = (this.n - 1) * 16;
        for (let k = 0; k < 16; k++) a[o + k] = a[l + k];
        this.colors[i * 3] = this.colors[(this.n - 1) * 3]; this.colors[i * 3 + 1] = this.colors[(this.n - 1) * 3 + 1]; this.colors[i * 3 + 2] = this.colors[(this.n - 1) * 3 + 2];
        this.n--;
        continue;
      }
      a[o + 4] -= 14 * dt;
      a[o] += a[o + 3] * dt; a[o + 1] += a[o + 4] * dt; a[o + 2] += a[o + 5] * dt;
      a[o + 15] = Math.max(0, a[o + 15] - dt * 1.6);
      const half = a[o + 12] * 0.25;
      if (a[o + 1] < half) {
        a[o + 1] = half;
        if (a[o + 4] < -1) a[o + 4] *= -0.32; else a[o + 4] = 0;
        a[o + 3] *= 0.7; a[o + 5] *= 0.7; a[o + 9] *= 0.6; a[o + 10] *= 0.6; a[o + 11] *= 0.6;
      }
      a[o + 6] += a[o + 9] * dt; a[o + 7] += a[o + 10] * dt; a[o + 8] += a[o + 11] * dt;
      i++;
    }
    for (let j = 0; j < this.n; j++) {
      const o = j * 16, a = this.a;
      const k = a[o + 13] - a[o + 14] < 0.5 ? Math.max(0.01, (a[o + 13] - a[o + 14]) / 0.5) : 1;
      q.setFromEuler(e.set(a[o + 6], a[o + 7], a[o + 8]));
      m.compose(p.set(a[o], a[o + 1], a[o + 2]), q, s.setScalar(a[o + 12] * k));
      m.toArray(this.mesh.instanceMatrix.array as unknown as number[], j * 16);
      col[j * 3] = this.colors[j * 3]; col[j * 3 + 1] = this.colors[j * 3 + 1]; col[j * 3 + 2] = this.colors[j * 3 + 2];
      ht[j] = a[o + 15];
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    this.heatAttr.needsUpdate = true;
  }
  clear(): void { this.n = 0; this.mesh.count = 0; }
}

/* ------------------------------------------------------------------------------------------------- scrap */

/** Wreck scrap that stays for the rest of the battle: torn plates and chunks thrown out by a hull that blew apart.
 *  Pieces fly ballistically, then lie flat where they land; only flying pieces cost per-frame work. */
class Scrap {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private flying = 0;
  private cap: number;
  private a: Float32Array; // x y z vx vy vz ry rx rz sx sy sz flying
  constructor(cap: number) {
    this.cap = cap;
    this.a = new Float32Array(cap * 13);
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0.3 }), cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.castShadow = true; this.mesh.receiveShadow = true;
  }
  /** a piece of size s (cells) thrown from (x, y, z) to land about `d` cells away at heading `ang`; tone = grey level */
  add(x: number, y: number, z: number, ang: number, d: number, s: number, tone: number, plate: boolean, rgb: THREE.Color | null = null): void {
    // past the cap a random old piece is recycled
    const i = this.n < this.cap ? this.n++ : Math.floor(Math.random() * this.cap);
    const o = i * 13, a = this.a, vy = R(3, 6.5), t = (vy + Math.sqrt(vy * vy + 28 * y)) / 14;
    a[o] = x; a[o + 1] = y; a[o + 2] = z;
    a[o + 3] = Math.cos(ang) * d / t; a[o + 4] = vy; a[o + 5] = Math.sin(ang) * d / t;
    a[o + 6] = Math.random() * 6.28; a[o + 7] = R(-3, 3); a[o + 8] = R(-3, 3);
    a[o + 9] = s * R(0.7, 1.4); a[o + 10] = plate ? s * R(0.12, 0.25) : s * R(0.4, 0.8); a[o + 11] = s * R(0.5, 1.1); a[o + 12] = 1;
    const c = this.mesh.instanceColor!.array as Float32Array;
    if (rgb) { c[i * 3] = rgb.r; c[i * 3 + 1] = rgb.g; c[i * 3 + 2] = rgb.b; } else { c[i * 3] = tone * R(0.95, 1.15); c[i * 3 + 1] = tone; c[i * 3 + 2] = tone * R(0.85, 0.95); }
    this.mesh.instanceColor!.needsUpdate = true;
    this.flying++;
    this.put(i);
    this.mesh.count = this.n;
  }
  private put(i: number): void {
    const o = i * 13, a = this.a;
    _q.setFromEuler(_e.set(a[o + 7], a[o + 6], a[o + 8], 'YXZ'));
    _sm.compose(_p.set(a[o], a[o + 1], a[o + 2]), _q, _s.set(a[o + 9], a[o + 10], a[o + 11]));
    _sm.toArray(this.mesh.instanceMatrix.array as unknown as number[], i * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  update(dt: number): void {
    if (!this.flying) return;
    let fl = 0;
    for (let i = 0; i < this.n; i++) {
      const o = i * 13, a = this.a;
      if (!a[o + 12]) continue;
      a[o + 4] -= 14 * dt;
      a[o] += a[o + 3] * dt; a[o + 1] += a[o + 4] * dt; a[o + 2] += a[o + 5] * dt;
      a[o + 7] += a[o + 3] * dt * 2; a[o + 8] += a[o + 5] * dt * 2;
      // landed: lie (nearly) flat, half sunk into the dirt
      if (a[o + 1] <= a[o + 10] * 0.3) { a[o + 1] = a[o + 10] * 0.3; a[o + 7] = R(-0.15, 0.15); a[o + 8] = R(-0.15, 0.15); a[o + 12] = 0; } else fl++;
      this.put(i);
    }
    this.flying = fl;
  }
  clear(): void { this.n = 0; this.flying = 0; this.mesh.count = 0; }
}
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _sm = new THREE.Matrix4();

/* ----------------------------------------------------------------------------------------------- beams / bolts */

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _mid = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _bm = new THREE.Matrix4();

/** Camera-facing soft ribbons (tracers, beams, lightning): each segment is one instanced quad turned toward the eye,
 *  with a gaussian cross-section (white-hot core inside a coloured glow), round soft caps and an optional bright head
 *  at the b end. Never thinner than ~1.3 px (thinner ones widen and dim instead, so distant tracers don't shimmer). */
class Ribbons {
  readonly mesh: THREE.Mesh;
  n = 0;
  readonly cap: number;
  private geo: THREE.InstancedBufferGeometry;
  private aA: THREE.InstancedBufferAttribute; private aB: THREE.InstancedBufferAttribute; private aC: THREE.InstancedBufferAttribute;
  constructor(cap: number, order: number) {
    this.cap = cap;
    const quad = new THREE.PlaneGeometry(1, 2).translate(0.5, 0, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const mk = (k: number) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * k), k); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.aA = mk(4); this.aB = mk(4); this.aC = mk(4);
    geo.setAttribute('iA', this.aA); geo.setAttribute('iB', this.aB); geo.setAttribute('iC', this.aC);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uPxK: fxView.uPxK },
      vertexShader: /* glsl */ `
        attribute vec4 iA; attribute vec4 iB; attribute vec4 iC;
        uniform float uPxK;
        varying float vV; varying float vAlong; varying float vLen; varying float vW; varying vec4 vCol; varying float vHead; varying float vCore;
        void main() {
          vec3 A = iA.xyz, B = iB.xyz;
          vec3 d = B - A; float len = max(1e-4, length(d)); d /= len;
          float w = iA.w;
          vec3 P = mix(A, B, position.x);
          float dist = length(cameraPosition - P);
          float wMin = uPxK * dist * 1.3;
          float we = max(w, wMin);
          vec3 side = normalize(cross(d, cameraPosition - P) + vec3(1e-5, 0.0, 0.0));
          // caps: stretch the quad past both ends by the width
          float ext = (position.x * 2.0 - 1.0) * we;
          P += d * ext + side * position.y * we;
          vAlong = position.x * len + ext; vLen = len; vW = we;
          vV = position.y;
          vCol = vec4(iC.rgb * min(1.0, w / we), 1.0);
          vHead = iB.w; vCore = iC.w;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(P, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vV; varying float vAlong; varying float vLen; varying float vW; varying vec4 vCol; varying float vHead; varying float vCore;
        void main() {
          float e = max(-vAlong, vAlong - vLen) / vW;
          // the gaussians are still a few % at the quad's border: window them to exactly 0 there (bright, wide bolts such
          // as the rail crackle otherwise show a faint hard-edged box)
          float cap = exp(-max(e, 0.0) * max(e, 0.0) * 3.0) * smoothstep(1.0, 0.6, e) * smoothstep(1.0, 0.6, abs(vV));
          float v2 = vV * vV;
          float core = exp(-v2 * 22.0 / max(0.15, vCore)), glow = exp(-v2 * 3.5) * 0.55;
          float x = clamp(vAlong / vLen, 0.0, 1.0);
          float k = mix(1.0, mix(0.25, 1.35, x * x), vHead);
          vec3 c = vCol.rgb * glow + mix(vCol.rgb, vec3(max(vCol.r, max(vCol.g, vCol.b))), 0.55) * core * 1.4;
          gl_FragColor = vec4(c * cap * k, 1.0);
        }`,
      // the quad is turned toward the eye in the shader, so its winding depends on the segment's direction: without
      // DoubleSide about half of all beams, bolts and tracers were back-face culled (invisible)
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = order;
  }
  begin(): void { this.n = 0; }
  /** a soft line from a to b, half-width w; head: 1 = brighter toward b (a tracer's tail fades); core: 1 = normal core width */
  seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, r: number, g: number, b: number, head = 0, core = 1): void {
    if (this.n >= this.cap || !(w > 0)) return;
    const i = this.n++, A = this.aA.array as Float32Array, B = this.aB.array as Float32Array, C = this.aC.array as Float32Array;
    A[i * 4] = ax; A[i * 4 + 1] = ay; A[i * 4 + 2] = az; A[i * 4 + 3] = w;
    B[i * 4] = bx; B[i * 4 + 1] = by; B[i * 4 + 2] = bz; B[i * 4 + 3] = head;
    C[i * 4] = r; C[i * 4 + 1] = g; C[i * 4 + 2] = b; C[i * 4 + 3] = core;
  }
  end(): void {
    this.geo.instanceCount = this.n;
    uploadPrefix(this.aA, this.n); uploadPrefix(this.aB, this.n); uploadPrefix(this.aC, this.n);
  }
}

/** Railgun beams: camera-facing ribbons with one smooth glow (white-hot core fading through blue to nothing across
 *  the width), soft round caps, and a decay pass: after the shot the ionised channel breaks up from the muzzle
 *  forward, the line wisps sideways in drifting noise and the glow thins out until the air is clear again.
 *  The quad is built in the vertex shader: turned toward the eye per vertex (so it never shows its edge at the far end
 *  of a long beam under a close camera) and stretched past both ends so the glow ends in a soft rounded cap instead
 *  of a square cut. Every term is windowed to exactly zero at the quad's edge (the drifting wisps and the wide halo
 *  used to reach it, which showed as a hard-edged rectangle on the mass driver), and it fades into the ground instead
 *  of being clipped by it in a straight line. */
const RAIL_VERT = `
uniform vec3 uA, uB; uniform float uHW;
varying float vAl, vV, vY;
void main() {
  vec3 d = uB - uA; float L = max(1e-3, length(d)); d /= L;
  // caps: a little past the muzzle (it sits in the barrel), a full half-width past the impact
  float s = mix(-0.6 * uHW, L + uHW, uv.x), v = uv.y * 2.0 - 1.0;
  vec3 P = uA + d * s;
  vec3 side = normalize(cross(d, cameraPosition - P) + vec3(1e-5, 0.0, 0.0));
  P += side * v * uHW;
  vAl = s; vV = v; vY = P.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}`;
const RAIL_FRAG = `
varying float vAl, vV, vY;
uniform vec3 uColor; uniform float uT, uLen, uSeed, uHdr, uAge, uHW;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float u = clamp(vAl / uLen, 0.0, 1.0), v = vV, t = uT;
  // distance past either end, in half-widths: the glow rounds off over the caps
  float e = max(0.0, max(-vAl, vAl - uLen) / uHW);
  float r2 = e * e + v * v;
  // window: 1 on the axis, smoothly 0 at the quad's edge and the cap's rim (no term can reach the border)
  float win = max(0.0, 1.0 - r2); win *= win;
  float capFall = exp(-e * e * 2.5);
  // the white-hot core tapers to a point at the muzzle and the impact
  float ends = smoothstep(0.0, min(0.5, 0.7 / uLen), u) * smoothstep(0.0, min(0.5, 0.45 / uLen), 1.0 - u) * step(e, 0.0);
  // the channel deionises from the muzzle forward, with a ragged noisy front
  float front = smoothstep(0.2, 1.0, t) * 1.2 - 0.1 + (vnoise(vec2(u * uLen * 0.8, uSeed)) - 0.5) * 0.25 * t;
  float lit = smoothstep(front - 0.02, front + 0.18, u);
  // wisping: the line drifts and frays sideways more as it decays (kept inside the window)
  float n1 = vnoise(vec2(u * uLen * 1.3 - uAge * 1.5, uSeed + uAge * 2.0));
  float n2 = vnoise(vec2(u * uLen * 3.1 + uAge * 2.5, uSeed * 1.7 - uAge * 3.0));
  float vv = v + (n1 - 0.5) * 0.8 * t;
  float core = exp(-vv * vv * 160.0) * (1.0 - t) * ends;
  float glow = exp(-vv * vv * 14.0) * (0.95 - 0.5 * t);
  float halo = exp(-v * v * 4.0) * 0.35 * (1.0 - t * 0.8);
  float wisp = exp(-vv * vv * 5.0) * smoothstep(0.45, 0.85, n2) * t * 0.8;
  // soft against the ground: fade out as the ribbon dips toward y = 0 instead of being cut off by the depth test
  float ground = smoothstep(0.0, clamp(uHW * 0.5, 0.12, 0.7), vY);
  float a = (core * 1.6 + (glow + halo + wisp) * capFall) * win * ground * mix(1.0, lit, 0.85) * (1.0 - smoothstep(0.75, 1.0, t));
  vec3 col = mix(uColor, vec3(1.0), clamp(core * 1.3, 0.0, 1.0));
  gl_FragColor = vec4(col * a * uHdr, 1.0);
}`;
class RailBeams {
  readonly group = new THREE.Group();
  private pool: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; age: number; life: number; on: boolean }[] = [];
  /** unit quad (u along the beam, v across); the vertex shader places it */
  private geo = new THREE.PlaneGeometry(1, 1);
  add(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, life: number, color: THREE.Color, hdr: number): void {
    let b = this.pool.find((x) => !x.on);
    if (!b) {
      if (this.pool.length >= 32) b = this.pool.reduce((p, q) => (q.age / q.life > p.age / p.life ? q : p));
      else {
        const mat = new THREE.ShaderMaterial({
          vertexShader: RAIL_VERT, fragmentShader: RAIL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
          uniforms: {
            uColor: { value: new THREE.Color() }, uT: { value: 0 }, uLen: { value: 1 }, uSeed: { value: 0 }, uHdr: { value: 1 }, uAge: { value: 0 },
            uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uHW: { value: 0.5 },
          },
        });
        const mesh = new THREE.Mesh(this.geo, mat);
        mesh.frustumCulled = false; mesh.renderOrder = 10;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        b = { mesh, mat, age: 0, life: 1, on: false };
        this.pool.push(b);
      }
    }
    b.age = 0; b.life = life; b.on = true;
    const U = b.mat.uniforms;
    U.uColor.value.copy(color);
    U.uSeed.value = Math.random() * 100;
    U.uHdr.value = hdr;
    U.uA.value.set(ax, ay, az);
    U.uB.value.set(bx, by, bz);
    U.uHW.value = w / 2;
    U.uLen.value = Math.max(0.5, Math.hypot(bx - ax, by - ay, bz - az));
    U.uT.value = 0; U.uAge.value = 0;
    b.mesh.visible = true;
  }
  /** advance every beam (each one faces the camera in its vertex shader) */
  update(dt: number): void {
    for (const b of this.pool) {
      if (!b.on) continue;
      b.age += dt;
      if (b.age >= b.life) { b.on = false; b.mesh.visible = false; continue; }
      b.mat.uniforms.uT.value = b.age / b.life;
      b.mat.uniforms.uAge.value = b.age;
    }
  }
}

interface BoltFx {
  kind: 'beam' | 'bolt';
  ax: number; ay: number; az: number; bx: number; by: number; bz: number;
  r: number; g: number; b: number; w: number;
  life: number; max: number; seed: number; roll: number; pts: number[]; wob: number;
  /** beams: seconds the head takes to reach b (a pulse shooting out of the emitter); 0 = all at once */
  grow?: number;
  /** beams: core width (1 normal, larger = a fatter white-hot core) */
  core?: number;
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

const _shadowRamp = [0, 0, 0, 0.3, 0, 0, 0, 0.3, 0, 0, 0, 0];

/** Paint scheme of a big shell (per instance): how its band colour is laid over the body. */
export const SHELL_PAT = { plain: 0, hazard: 1, driving: 2, pulse: 3, rings: 4, rad: 5, molten: 6 } as const;
/** A big round's look: body paint, band paint + scheme, glow colour (base tracer, and the nose with `heat` > 0). Linear rgb;
 *  band / glow may exceed 1 (they're emissive). Shared constants: no per-shell allocation. */
export interface ShellLook {
  readonly body: readonly [number, number, number];
  readonly band: readonly [number, number, number];
  readonly pat: number;
  readonly glow: readonly [number, number, number];
  /** 0..1: how hot the nose glows (siege / doomsday shells) */
  readonly heat: number;
}
export type ShellShape = 'ogive' | 'bomb' | 'rocket';

/** lathe profile [axis 0..1 from tail to nose, radius (0.5 = full calibre)] turned so the round points down +x, centred */
function latheX(profile: readonly (readonly [number, number])[], seg: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([a, r]) => new THREE.Vector2(r, a - 0.5)), seg).rotateZ(-Math.PI / 2);
  g.deleteAttribute('uv');
  return g;
}
/** four thin fins at the tail: x0..x1 along the axis, radially r0..r1 */
function fins(x0: number, x1: number, r0: number, r1: number, t: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const b = new THREE.BoxGeometry(x1 - x0, r1 - r0, t).translate((x0 + x1) / 2, (r0 + r1) / 2, 0).rotateX((k * Math.PI) / 2 + Math.PI / 4);
    b.deleteAttribute('uv');
    out.push(b.toNonIndexed());
  }
  return out;
}
/** merge body + fins into one geometry with a per-vertex `part` (0 body, 1 fin) the shell shader paints by */
function withParts(body: THREE.BufferGeometry, fin: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = [body.index ? body.toNonIndexed() : body, ...fin];
  let n = 0;
  for (const g of parts) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), part = new Float32Array(n);
  let o = 0;
  parts.forEach((g, i) => {
    const c = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    part.fill(i ? 1 : 0, o, o + c);
    o += c;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('part', new THREE.BufferAttribute(part, 1));
  return out;
}
/** artillery / siege shell: boat tail, driving band, long body, pointed ogive nose */
function ogiveGeometry(): THREE.BufferGeometry {
  const p: [number, number][] = [[0, 0], [0, 0.34], [0.06, 0.43], [0.1, 0.48], [0.13, 0.5], [0.58, 0.5]];
  for (let i = 1; i <= 7; i++) { const t = i / 7; p.push([0.58 + 0.42 * t, 0.5 * Math.sqrt(Math.max(0, 1 - t * t)) * (1 - 0.1 * t) + (i === 7 ? 0.018 : 0)]); }
  p.push([1, 0]);
  return withParts(latheX(p, 14), []);
}
/** mortar bomb / aerial bomb: a teardrop with a tail boom and four fins */
function bombGeometry(): THREE.BufferGeometry {
  const p: [number, number][] = [[0, 0], [0, 0.13], [0.3, 0.13], [0.46, 0.36], [0.62, 0.5], [0.76, 0.48], [0.88, 0.4], [0.96, 0.25], [1, 0]];
  return withParts(latheX(p, 12), fins(-0.5, -0.17, 0.06, 0.52, 0.035));
}
/** rocket / big missile: slim tube, cone nose, nozzle and four wide tail fins */
function rocketGeometry(): THREE.BufferGeometry {
  const p: [number, number][] = [[0, 0], [0, 0.4], [0.03, 0.5], [0.74, 0.5], [0.86, 0.38], [0.95, 0.18], [1, 0]];
  return withParts(latheX(p, 10), fins(-0.5, -0.24, 0.3, 0.95, 0.06));
}

/** shared material for the big shells: standard lit metal, painted per instance (band scheme + colour, base tracer,
 *  heat-glow nose, pulsing energy band) in the shader from the round's local position. One program for all shapes. */
function shellMaterial(uTime: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.48, metalness: 0.5 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 iBand; attribute vec4 iGlow; attribute float part;
varying vec4 vBand; varying vec4 vGlow; varying vec3 vLoc; varying float vPart; varying float vSeed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vBand = iBand; vGlow = iGlow; vLoc = position; vPart = part; vSeed = float(gl_InstanceID);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
varying vec4 vBand; varying vec4 vGlow; varying vec3 vLoc; varying float vPart; varying float vSeed;
float sBand(float x, float c, float w) { return 1.0 - smoothstep(w * 0.75, w, abs(x - c)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float shX = vLoc.x, shA = atan(vLoc.z, vLoc.y);
int shPat = int(vBand.w + 0.5);
float shFin = step(0.5, vPart);
float shBody = (1.0 - shFin) * smoothstep(-0.42, -0.38, shX) * (1.0 - smoothstep(0.1, 0.14, shX));
float shM = 0.0, shE = 0.0, shDark = 0.0;
if (shPat == 1) { // hazard: diagonal black / yellow stripes wound round the body, yellow fins
  shM = shBody * step(0.5, fract(shX * 4.5 + shA * 0.3183)) + shFin;
} else if (shPat == 2) { // driving bands: two bright copper-orange rings at the base, a thin one under the nose
  shM = (sBand(shX, -0.34, 0.05) + sBand(shX, -0.24, 0.03) + sBand(shX, 0.12, 0.02)) * (1.0 - shFin);
  shE = shM * 0.45;
} else if (shPat == 3) { // pulsing energy band round the waist (and glowing fin edges)
  float pu = 0.55 + 0.45 * sin(uTime * 15.0 + vSeed * 1.7);
  shM = sBand(shX, 0.08, 0.09) * (1.0 - shFin) + shFin * step(0.42, length(vLoc.yz));
  shE = shM * (0.6 + 2.2 * pu);
} else if (shPat == 4) { // hazard rings: two bands under the nose, one at the base, painted fins
  shM = (sBand(shX, 0.16, 0.035) + sBand(shX, 0.06, 0.025) + sBand(shX, -0.32, 0.035)) * (1.0 - shFin) + shFin;
} else if (shPat == 5) { // radiation: a yellow waist band with black trefoil blades, yellow fins
  float wb = sBand(shX, -0.02, 0.17) * (1.0 - shFin);
  float blade = wb * step(0.45, cos(3.0 * shA)) * step(0.035, abs(shX + 0.02)) * step(abs(shX + 0.02), 0.13);
  float hub = wb * step(abs(shX + 0.02), 0.022);
  shM = wb + shFin; shDark = max(blade, hub);
} else if (shPat == 6) { // molten: the whole casing flickers with licking flame
  float fl = 0.5 + 0.5 * sin(shX * 26.0 + shA * 3.0 + uTime * 21.0 + vSeed * 2.3) * sin(shX * 11.0 - shA * 2.0 - uTime * 13.0);
  shM = fl * (1.0 - shFin * 0.5); shE = shM * 1.6 + 0.15;
}
shM = clamp(shM, 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, vBand.rgb, shM) * (1.0 - 0.9 * shDark);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float shTail = (1.0 - shFin) * (1.0 - smoothstep(-0.5, -0.43, shX));
float shNose = vGlow.w * smoothstep(0.22, 0.5, shX) * (1.0 - shFin);
totalEmissiveRadiance += vBand.rgb * shE * (1.0 - shDark) + vGlow.rgb * (shTail * 1.6 + shNose * (1.3 + 0.3 * sin(uTime * 9.0 + vSeed)));`);
  };
  m.customProgramCacheKey = () => 'shell3d';
  return m;
}

/** an instanced set of one big-round shape with its per-instance paint attributes */
class ShellSet {
  readonly mesh: THREE.InstancedMesh;
  n = 0;
  private band: THREE.InstancedBufferAttribute; private glow: THREE.InstancedBufferAttribute;
  readonly cap: number;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number) {
    this.cap = cap;
    const mk = () => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.band = mk(); this.glow = mk();
    geo.setAttribute('iBand', this.band); geo.setAttribute('iGlow', this.glow);
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
  }
  add(m: THREE.Matrix4, L: ShellLook, tint: number): void {
    if (this.n >= this.cap) return;
    const i = this.n++;
    m.toArray(this.mesh.instanceMatrix.array as unknown as number[], i * 16);
    const c = this.mesh.instanceColor!.array as Float32Array;
    c[i * 3] = L.body[0] * tint; c[i * 3 + 1] = L.body[1] * tint; c[i * 3 + 2] = L.body[2] * tint;
    const b = this.band.array as Float32Array, g = this.glow.array as Float32Array;
    b[i * 4] = L.band[0]; b[i * 4 + 1] = L.band[1]; b[i * 4 + 2] = L.band[2]; b[i * 4 + 3] = L.pat;
    g[i * 4] = L.glow[0]; g[i * 4 + 1] = L.glow[1]; g[i * 4 + 2] = L.glow[2]; g[i * 4 + 3] = L.heat;
  }
  end(): void {
    this.mesh.count = this.n;
    uploadPrefix(this.mesh.instanceMatrix, this.n); uploadPrefix(this.mesh.instanceColor!, this.n);
    uploadPrefix(this.band, this.n); uploadPrefix(this.glow, this.n);
    this.n = 0;
  }
}

/** energy ball: additive fresnel sphere, a white-hot core in a rim of the instance colour, its surface shimmering */
function orbMaterial(uTime: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vCol; varying vec3 vP; varying float vSeed;
      void main() {
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        vV = cameraPosition - wp.xyz;
        vCol = instanceColor; vP = position; vSeed = float(gl_InstanceID);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vN; varying vec3 vV; varying vec3 vCol; varying vec3 vP; varying float vSeed;
      void main() {
        float f = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
        float t = uTime * 1.0 + vSeed * 3.1;
        float sw = 0.5 + 0.5 * sin(vP.x * 9.0 + t * 11.0) * sin(vP.y * 8.0 - t * 9.0 + vP.z * 7.0);
        vec3 rim = vCol * pow(1.0 - f, 1.4) * 1.3;
        vec3 core = mix(vCol, vec3(1.0), 0.45) * pow(f, 4.0) * 1.3;
        gl_FragColor = vec4(rim + core + vCol * (0.25 + 0.5 * sw) * f, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

export class ProjLayer {
  readonly group = new THREE.Group();
  private streaks = new Ribbons(2400, 9);
  private bodies: THREE.InstancedMesh;
  private nb = 0;
  /** seconds, for the shells' pulsing / flickering paint and the orbs' shimmer */
  private readonly uTime = { value: 0 };
  private readonly shells: Record<ShellShape, ShellSet>;
  private orbs: THREE.InstancedMesh;
  private no = 0;
  constructor() {
    this.bodies = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45, metalness: 0.8, emissive: '#ff6a20', emissiveIntensity: 0.22 }), 1200);
    this.bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bodies.setColorAt(0, new THREE.Color(1, 1, 1));
    this.bodies.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.bodies.frustumCulled = false; this.bodies.count = 0;
    const mat = shellMaterial(this.uTime);
    this.shells = { ogive: new ShellSet(ogiveGeometry(), mat, 600), bomb: new ShellSet(bombGeometry(), mat, 600), rocket: new ShellSet(rocketGeometry(), mat, 800) };
    this.orbs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 2), orbMaterial(this.uTime), 300);
    this.orbs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.orbs.setColorAt(0, new THREE.Color(1, 1, 1));
    this.orbs.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.orbs.frustumCulled = false; this.orbs.count = 0; this.orbs.renderOrder = 8;
    this.group.add(this.bodies, this.shells.ogive.mesh, this.shells.bomb.mesh, this.shells.rocket.mesh, this.orbs, this.streaks.mesh);
  }
  begin(time?: number): void { this.streaks.begin(); this.nb = 0; this.no = 0; if (time !== undefined) this.uTime.value = time; }
  /** bright streak (tracer round / energy bolt) from tail to head */
  streak(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, r: number, g: number, b: number): void {
    // one soft ribbon: a white-hot core in a coloured glow, brightest at the head
    this.streaks.seg(ax, ay, az, bx, by, bz, w * 1.9, 2.6 * (r + 0.15), 2.6 * (g + 0.12), 2.6 * (b + 0.1), 1, 1.3);
  }
  /** calibre-sized round (bullet / shell tracer) from tail to head: half-width w as given (no widening), white-hot
   *  core in a glow of the given (linear, may exceed 1) colour, brightest at the head */
  round(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, r: number, g: number, b: number): void {
    this.streaks.seg(ax, ay, az, bx, by, bz, w, 2 * r, 2 * g, 2 * b, 1, 1.4);
  }
  /** basis for a round centred at c pointing along d (len along it, diameter dia), rolled `roll` rad about its axis */
  private basis(cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, len: number, dia: number, roll: number): THREE.Matrix4 {
    const l = Math.hypot(dx, dy, dz) || 1;
    _x.set(dx / l, dy / l, dz / l);
    _z.crossVectors(_x, Math.abs(_x.y) > 0.98 ? _mid.set(1, 0, 0) : _up).normalize();
    _y.crossVectors(_z, _x);
    if (roll) {
      const c = Math.cos(roll), s = Math.sin(roll);
      _mid.copy(_y).multiplyScalar(c).addScaledVector(_z, s);
      _z.multiplyScalar(c).addScaledVector(_y, -s);
      _y.copy(_mid);
    }
    return _bm.makeBasis(_x.multiplyScalar(len), _y.multiplyScalar(dia), _z.multiplyScalar(dia)).setPosition(cx, cy, cz);
  }
  /** solid body (shell / rocket) centred at c, pointing along (dx,dy,dz) */
  body(cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, len: number, d: number, r: number, g: number, b: number): void {
    if (this.nb >= 1200) return;
    this.basis(cx, cy, cz, dx, dy, dz, len, d, 0).toArray(this.bodies.instanceMatrix.array as unknown as number[], this.nb * 16);
    const c = this.bodies.instanceColor!.array as Float32Array;
    c[this.nb * 3] = r; c[this.nb * 3 + 1] = g; c[this.nb * 3 + 2] = b;
    this.nb++;
  }
  /** a big painted round (artillery / siege shell, finned bomb, rocket) centred at c, pointing along (dx,dy,dz), spun
   *  `roll` rad about its axis; `tint` darkens / brightens the body paint (team shade) */
  shell(shape: ShellShape, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, len: number, d: number, roll: number, look: ShellLook, tint = 1): void {
    this.shells[shape].add(this.basis(cx, cy, cz, dx, dy, dz, len, d, roll), look, tint);
  }
  /** an energy ball of radius rad: white-hot core, rim of the given linear colour (may exceed 1), shimmering surface */
  orb(cx: number, cy: number, cz: number, rad: number, r: number, g: number, b: number): void {
    if (this.no >= 300) return;
    const d = rad * 2;
    _bm.makeScale(d, d, d).setPosition(cx, cy, cz);
    _bm.toArray(this.orbs.instanceMatrix.array as unknown as number[], this.no * 16);
    const c = this.orbs.instanceColor!.array as Float32Array;
    c[this.no * 3] = r; c[this.no * 3 + 1] = g; c[this.no * 3 + 2] = b;
    this.no++;
  }
  end(): void {
    this.streaks.end();
    this.bodies.count = this.nb;
    uploadPrefix(this.bodies.instanceMatrix, this.nb); uploadPrefix(this.bodies.instanceColor!, this.nb);
    this.shells.ogive.end(); this.shells.bomb.end(); this.shells.rocket.end();
    this.orbs.count = this.no;
    uploadPrefix(this.orbs.instanceMatrix, this.no); uploadPrefix(this.orbs.instanceColor!, this.no);
  }
}

/* ---------------------------------------------------------------------------------------- burning ground */

/** Burning ground patches: one instanced ground quad per patch with an animated noise-flame shader (a bed of
 *  licking flames and glowing embers, flaring on landing and guttering out at the end). One draw call for all. */
class GroundFire {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private aA: THREE.InstancedBufferAttribute; // x, z, r, seed
  private aB: THREE.InstancedBufferAttribute; // intensity
  private mat: THREE.ShaderMaterial;
  readonly cap: number;
  constructor(cap: number) {
    this.cap = cap;
    const quad = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); this.aA.setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1); this.aB.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iA', this.aA); geo.setAttribute('iB', this.aB);
    geo.instanceCount = 0;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uHdr: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec4 iA; attribute float iB;
        varying vec2 vUv; varying float vSeed; varying float vI;
        void main() {
          float r = iA.z * 1.25;
          vec3 p = vec3(iA.x + position.x * r, 0.045, iA.y + position.z * r);
          vUv = position.xz * 1.25; vSeed = iA.w; vI = iB;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uHdr;
        varying vec2 vUv; varying float vSeed; varying float vI;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int k = 0; k < 4; k++) { s += a * n(p); p = p * 2.03 + 3.1; a *= 0.5; } return s; }
        void main() {
          float d = length(vUv);
          vec2 q = vUv * 2.6 + vSeed * 17.0;
          // two noise layers drifting different ways: flames 'lick' instead of scrolling
          float f1 = fbm(q + vec2(uTime * 0.7, -uTime * 1.6));
          float f2 = fbm(q * 1.7 - vec2(uTime * 1.1, uTime * 0.9));
          float body = smoothstep(1.02, 0.45, d + (f1 - 0.5) * 0.55);
          float tongues = smoothstep(0.42, 0.85, f1 * 0.6 + f2 * 0.6) * body;
          float embers = smoothstep(0.6, 0.95, n(q * 4.0 + vec2(0.0, uTime * 0.3))) * body;
          float flick = 0.85 + 0.15 * sin(uTime * 13.0 + vSeed * 40.0) * sin(uTime * 7.3 + vSeed * 9.0);
          vec3 col = vec3(0.55, 0.08, 0.01) * body * 0.9            // dull red bed
                   + vec3(2.6, 1.05, 0.2) * tongues * flick           // orange flame tongues
                   + vec3(2.2, 1.9, 1.0) * pow(tongues, 3.0) * 1.5    // yellow-white cores
                   + vec3(1.6, 0.4, 0.05) * embers * 0.6;
          float a = clamp(body * 0.55 + tongues * 0.6, 0.0, 1.0) * vI;
          if (a < 0.004) discard;
          gl_FragColor = vec4(col * vI * uHdr * a, a * 0.55);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }
  /** write the live patches (intensity 0..~1.3 each) */
  set(list: readonly { x: number; z: number; r: number; seed: number; k: number }[], time: number, hdr: number): void {
    const A = this.aA.array as Float32Array, B = this.aB.array as Float32Array;
    const n = Math.min(this.cap, list.length);
    for (let i = 0; i < n; i++) { const f = list[i]; A[i * 4] = f.x; A[i * 4 + 1] = f.z; A[i * 4 + 2] = f.r; A[i * 4 + 3] = f.seed; B[i] = f.k; }
    this.geo.instanceCount = n;
    this.aA.needsUpdate = this.aB.needsUpdate = true;
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uHdr.value = hdr;
  }
  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}

/* ------------------------------------------------------------------------------------- fallback decal sprites */

function makeRingTexture(): THREE.Texture {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d')!, m = N / 2, R = m * 0.9;
  const wash = g.createRadialGradient(m, m, R * 0.2, m, m, R);
  wash.addColorStop(0, 'rgba(255,255,255,0)'); wash.addColorStop(1, 'rgba(255,255,255,0.18)');
  g.fillStyle = wash; g.beginPath(); g.arc(m, m, R, 0, 6.2832); g.fill();
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 3; g.beginPath(); g.arc(m, m, R, 0, 6.2832); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}

function makeScorchTexture(): THREE.Texture {
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 60);
  gr.addColorStop(0, 'rgba(22,17,12,0.85)'); gr.addColorStop(0.55, 'rgba(26,20,14,0.5)'); gr.addColorStop(1, 'rgba(30,24,16,0)');
  g.fillStyle = gr; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * 6.283, l = 26 + Math.random() * 30;
    g.strokeStyle = `rgba(20,15,10,${0.1 + Math.random() * 0.18})`; g.lineWidth = 1 + Math.random() * 3;
    g.beginPath(); g.moveTo(64 + Math.cos(a) * 18, 64 + Math.sin(a) * 18); g.lineTo(64 + Math.cos(a) * l, 64 + Math.sin(a) * l); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const _scrapRgb = new THREE.Color();
const LIGHT_NEUTRAL = [0.62, 0.63, 0.6] as const, GUNMETAL = [0.1, 0.11, 0.12] as const;
/** colour of one fragment of a blown-up hull: mostly its team paint, some light armour shell, some dark mechanics,
 *  all a little scorched; dirt / rock when there's no hull */
function paintChip(paint: readonly [number, number, number] | undefined, dirt: readonly [number, number, number]): readonly [number, number, number] {
  const u = Math.random();
  if (!paint) return u < 0.5 ? dirt : [0.16, 0.15, 0.14];
  const c = u < 0.5 ? paint : u < 0.75 ? LIGHT_NEUTRAL : GUNMETAL, k = R(0.55, 0.85);
  return [c[0] * k, c[1] * k, c[2] * k];
}

/* ----------------------------------------------------------------------------------------------------- Fx3D */

/** muzzle flash families (Fx3D.muzzleFx) */
export type TrailKind = 'rocket' | 'incend' | 'missile' | 'bigMissile' | 'shell' | 'heavyShell' | 'firebomb' | 'gauss' | 'spark' | 'orb' | 'flame' | 'bullet';
export type WispKind = 'steam' | 'oil' | 'black' | 'elec' | 'dust';
export type MuzzleKind = 'gun' | 'gatling' | 'blast' | 'darts' | 'cannon' | 'he' | 'gauss' | 'sniper' | 'rocket' | 'missile' | 'mortar' | 'flak' | 'ac';

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
  private alpha = new Particles(8000, this.atlas, 'alpha');
  private rings: Flats;
  /** splash-radius rings (sized exactly to the sim's blast radius) */
  private aoe: Flats;
  private pools: Flats;
  private debris = new Debris(500);
  private scrap = new Scrap(2400);
  private scorch: THREE.InstancedMesh;
  private scorchN = 0;
  /** fx time each scorch slot was laid at, and how long a scorch stays (Infinity: until its slot is reused) */
  private scorchT = new Float64Array(256);
  scorchLife = Infinity;
  private scorchSweep = 0;
  private beams = new Ribbons(4000, 10);
  private rails = new RailBeams();
  /** camera position (set by the view each frame) so rail beams can face it */
  readonly eye = new THREE.Vector3(0, 100, 0);
  private bolts: BoltFx[] = [];
  /** firebrands: burning chunks flung out of a blast, each trailing flame and a thin smoke streak (x y z vx vy vz life max size acc) */
  private brands: number[][] = [];
  private later: { t: number; fn: () => void }[] = [];
  private smokes: { x: number; z: number; r: number; left: number; acc: number }[] = [];
  /** burning ground patches (sim 'fireField') */
  private fields: { x: number; z: number; r: number; left: number; max: number; acc: number; seed: number; k: number; age: number }[] = [];
  private groundFire = new GroundFire(200);
  /** radioactive zones (sim 'fireField' with rad): green motes rising and a drifting haze, no flames */
  private radZones: { x: number; z: number; r: number; left: number; acc: number }[] = [];
  private time = 0;
  private disposed = false;
  /** the flipbook atlas is in (effects tuned for it; the fallback keeps the older look) */
  atlasReady = false;
  /** recent blast count (decays): stacked explosions dim each other so mass deaths don't blow out to white */
  private heat = 0;
  private dust: number[] = [0.55, 0.46, 0.34, 0.32, 0.5, 0.42, 0.32, 0.18, 0.45, 0.38, 0.3, 0];
  /** travel dust behind heavy ground units: the ground tone, lighter and airier than the hit / blast dust */
  private travelDust: number[] = [0.82, 0.74, 0.6, 0.3, 0.78, 0.7, 0.57, 0.18, 0.74, 0.66, 0.54, 0];
  /** darker, denser ground colour for thrown-up earth */
  private dirt: number[] = [0.3, 0.24, 0.17, 0.75, 0.32, 0.26, 0.19, 0.55, 0.36, 0.3, 0.22, 0];
  private dirtRgb: [number, number, number] = [0.3, 0.24, 0.17];

  constructor() {
    this.group.name = 'fx';
    // shock rings: one crisp thin line with a faint wash inside (atlas sprite; a canvas copy until it loads)
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', map: makeRingTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const ringGeo = new THREE.PlaneGeometry(2 / 0.9, 2 / 0.9).rotateX(-Math.PI / 2);
    this.rings = new Flats(220, ringGeo, ringMat, 7);
    // damage-radius markers: the same sprite, held at the sim's exact radius and kept faint
    const aoeMat = ringMat.clone();
    this.aoe = new Flats(160, ringGeo, aoeMat, 7, true);
    const poolTex = this.atlas.clone();
    poolTex.repeat.set(0.5, 0.5); poolTex.offset.set(0, 0); poolTex.needsUpdate = true;
    const poolMat = new THREE.MeshBasicMaterial({ color: '#ffffff', map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.pools = new Flats(220, new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, 7);
    // scorch decals: soft brown-black blots with radial streaks, ~60% opaque
    const scorchMat = new THREE.MeshBasicMaterial({ map: makeScorchTexture(), transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.scorch = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), scorchMat, 256);
    this.scorch.frustumCulled = false; this.scorch.count = 0; this.scorch.renderOrder = 2;
    this.debris.mesh.renderOrder = 3;
    whenFxAtlas((t) => {
      if (this.disposed) return;
      this.add.useAtlas(t); this.fire.useAtlas(t); this.alpha.useAtlas(t);
      ringMat.map = miscUv(t, MISC.ring); aoeMat.map = ringMat.map; poolMat.map = miscUv(t, MISC.glow); scorchMat.map = miscUv(t, MISC.scorch);
      for (const m of [ringMat, aoeMat, poolMat, scorchMat]) m.needsUpdate = true;
      this.atlasReady = true;
    });
    for (const o of [this.scorch, this.groundFire.mesh, this.debris.mesh, this.scrap.mesh, this.alpha.mesh, this.pools.mesh, this.rings.mesh, this.aoe.mesh, this.fire.mesh, this.add.mesh, this.beams.mesh, this.rails.group, this.proj.group]) this.group.add(o);
  }

  /** per-frame view state for the effect shaders: pixel footprint (streak / ribbon minimum width) and the sun direction
   *  (smoke lighting); heightPx = drawing-buffer height */
  viewFrom(camera: THREE.PerspectiveCamera, heightPx: number, sun?: THREE.DirectionalLight): void {
    fxView.uPxK.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, heightPx) / Math.max(1e-3, camera.zoom);
    if (sun) fxView.uSun.value.subVectors(sun.position, sun.target.position).normalize();
  }

  /** tint ground dust to the map */
  setGround(rgb: [number, number, number]): void {
    const k = 0.8;
    this.dust = [rgb[0] * k, rgb[1] * k, rgb[2] * k, 0.32, rgb[0] * k * 0.92, rgb[1] * k * 0.92, rgb[2] * k * 0.92, 0.18, rgb[0] * 0.8, rgb[1] * 0.8, rgb[2] * 0.8, 0];
    const lt = (c: number, w: number) => c * (1 - w) + w; // lifted toward white so it reads against its own ground
    this.travelDust = [lt(rgb[0], 0.4), lt(rgb[1], 0.4), lt(rgb[2], 0.4), 0.3, lt(rgb[0], 0.35), lt(rgb[1], 0.35), lt(rgb[2], 0.35), 0.18, lt(rgb[0], 0.3), lt(rgb[1], 0.3), lt(rgb[2], 0.3), 0];
    this.dirtRgb = [rgb[0] * 0.55, rgb[1] * 0.5, rgb[2] * 0.45];
    this.dirt = [rgb[0] * 0.5, rgb[1] * 0.45, rgb[2] * 0.4, 0.78, rgb[0] * 0.55, rgb[1] * 0.5, rgb[2] * 0.45, 0.55, rgb[0] * 0.6, rgb[1] * 0.55, rgb[2] * 0.5, 0];
  }

  clear(): void {
    this.add.clear(); this.fire.clear(); this.alpha.clear(); this.rings.clear(); this.aoe.clear(); this.pools.clear(); this.debris.clear(); this.scrap.clear();
    this.scorchN = 0; this.scorch.count = 0;
    this.bolts.length = 0; this.brands.length = 0; this.later.length = 0; this.smokes.length = 0; this.fields.length = 0; this.radZones.length = 0;
    this.trauma = 0; this.flashA = 0;
  }

  get particleCount(): number { return this.add.n + this.fire.n + this.alpha.n; }

  /* ---------------------------------------------------------------------------------------------- helpers */

  private lodN(n: number): number { return Math.max(1, Math.round(n * this.lod)); }

  glow(x: number, y: number, z: number, size: number, life: number, ramp: Ramp = RAMPS.flash, tex = 0): void {
    this.add.emit(x, y, z, 0, 0, 0, life, size, size * 1.25, 0, 0, 0, tex, ramp, this.hdr);
  }

  /* ----------------------------------------------------------------------------------------------- shooting */

  /** A smoke / dust puff from a blast, hit or gun, toned well down: only some are kept, and those are smaller and
   *  shorter-lived than asked (no big billowing clouds over the fight: a quick dark puff that is gone in a second). */
  private puff(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, spin: number, drag: number, grav: number, tex: number, ramp: Ramp): void {
    if (Math.random() > PUFF_KEEP) return;
    this.alpha.emit(x, y, z, vx * 0.75, vy, vz * 0.75, life * 0.45, s0 * 0.55, s1 * 0.4, spin, drag, grav, tex, ramp);
  }

  /** one flame tongue of a muzzle flash, rooted at (x, y, z) along the unit vector (ux, uy, uz): len long, len /
   *  aspect wide (Particles tile 6) */
  private tongue(x: number, y: number, z: number, ux: number, uy: number, uz: number, len: number, aspect: number, life: number, ramp: Ramp, h: number): void {
    this.add.emit(x, y, z, ux * aspect, uy * aspect, uz * aspect, life, len, len * 0.8, 0, 0, 0, 6, ramp, h);
  }

  /** A gun's muzzle flash, sized q (~ its tongue length): a small white-hot core, the main tongue straight out of the
   *  barrel (x plume), prongs out of the flash hider at a random roll every shot (so the star changes shot to shot), or
   *  with brake set two jets thrown sideways out of a muzzle brake, and a faint bloom of light. It is over in 2-3 frames. */
  private gunFlash(x: number, y: number, z: number, nx: number, nz: number, q: number, prongs: number, brake: boolean, h: number, plume = 1, life = 0.045, ramp: Ramp = RAMPS.flash): void {
    this.add.emit(x, y, z, 0, 0, 0, life * 0.8, q * 0.45, q * 0.25, 0, 0, 0, 0, ramp, h * 0.8);
    this.tongue(x, y, z, nx, 0, nz, q * R(1.25, 1.8) * plume, R(2.8, 3.6) * Math.sqrt(plume), life, ramp, h);
    const px = -nz, pz = nx, r0 = brake ? 0 : Math.random() * 6.283;
    for (let i = 0; i < prongs; i++) {
      const a = r0 + (i * 6.283) / prongs, c = Math.cos(a), sn = Math.sin(a), f = brake ? R(-0.25, -0.05) : R(0.05, 0.35);
      const ux = nx * f + px * c, uy = brake ? R(0, 0.15) : sn, uz = nz * f + pz * c, l = Math.hypot(ux, uy, uz);
      this.tongue(x, y, z, ux / l, uy / l, uz / l, q * (brake ? R(0.55, 0.75) : R(0.35, 0.65)), R(2.2, 3), life * 0.8, ramp, h);
    }
    this.add.emit(x + nx * q * 0.5, y, z + nz * q * 0.5, 0, 0, 0, life * 1.4, q * 1.6, q * 1.2, 0, 0, 0, 0, RAMPS.fire, h * 0.1);
  }

  /** muzzle flash at a barrel tip (machine guns and other small arms): a sharp star of flame and (big guns) a puff of
   *  smoke */
  muzzle(x: number, y: number, z: number, dx: number, dz: number, cal: number): void {
    const l = Math.hypot(dx, dz) || 1, nx = dx / l, nz = dz / l, s = 0.28 + cal * 0.75;
    this.gunFlash(x, y, z, nx, nz, 0.1 + cal * 0.7, Math.random() < 0.5 ? 4 : 3, false, this.hdr);
    if (cal > 0.55) {
      for (let i = 0; i < 2; i++) this.puff(x + nx * 0.2, y, z + nz * 0.2, nx * R(0.8, 2) + R(-0.3, 0.3), R(0.2, 0.7), nz * R(0.8, 2) + R(-0.3, 0.3), R(0.7, 1.3), s * 0.5, s * 1.7, R(-0.6, 0.6), 1.6, 0, 1 + (i & 1), RAMPS.smokeLight);
    }
  }

  /** small impact: sparks + a dust puff (hull or ground) */
  impact(x: number, y: number, z: number, big = 0.5, hot = true): void {
    const n = this.lodN(4 + Math.round(big * 9));
    for (let i = 0; i < n; i++) this.add.emit(x, y, z, R(-5, 5), R(1, 6), R(-5, 5), R(0.15, 0.35), 0.06 + big * 0.05, 0.02, 0, 1.5, -12, 3, RAMPS.spark, this.hdr);
    this.add.emit(x, y, z, 0, 0, 0, 0.1, 0.35 + big * 0.5, 0.15, 0, 0, 0, 0, RAMPS.flash, hot ? this.hdr : this.hdr * 0.6);
    if (big > 0.3) this.puff(x, y + 0.1, z, R(-0.3, 0.3), R(0.3, 0.9), R(-0.3, 0.3), R(0.5, 0.9), 0.3 + big * 0.3, 0.7 + big * 0.7, R(-1, 1), 1.5, 0, 1, this.dust);
  }

  /** shield hit: a cyan flare */
  shieldHit(x: number, y: number, z: number): void {
    this.add.emit(x, y, z, 0, 0, 0, 0.14, 0.4, 0.7, 0, 0, 0, 0, RAMPS.shield, this.hdr * 0.7);
    for (let i = 0; i < 4; i++) this.add.emit(x, y, z, R(-2.5, 2.5), R(0.4, 2.5), R(-2.5, 2.5), R(0.2, 0.4), 0.09, 0.03, 0, 1.5, -4, 3, RAMPS.shield, this.hdr);
  }

  heal(x: number, y: number, z: number): void {
    for (let i = 0; i < 3; i++) this.add.emit(x + R(-0.25, 0.25), y, z + R(-0.25, 0.25), 0, R(0.5, 1.3), 0, R(0.6, 1.0), 0.16, 0.05, 0, 0, 0, 0, RAMPS.heal, this.hdr);
  }

  /** a particle of rocket / shell / orb trail (call every frame per projectile; throttles itself) */
  trail(x: number, y: number, z: number, kind: TrailKind, size = 1, ramp?: Ramp): void {
    const pf = 1 + (Math.random() < 0.5 ? 1 : 0);
    switch (kind) {
      case 'rocket': // unguided rocket: sputtering orange flame and a thick, billowing grey smoke trail that lingers and drifts
        if (Math.random() < 0.6) this.fire.emit(x, y, z, R(-0.2, 0.2), R(-0.1, 0.2), R(-0.2, 0.2), R(0.1, 0.2), 0.26 * size, 0.1 * size, 0, 1, 0, pf, RAMPS.fire, this.hdr);
        this.alpha.emit(x, y, z, R(-0.05, 0.05) + WIND_X * 0.5, R(0.02, 0.1), R(-0.05, 0.05) + WIND_Z * 0.5, R(0.45, 0.8), 0.07 * size, 0.3 * size, R(-0.3, 0.3), 0.5, 0.01, pf, RAMPS.exhaustSmoke);
        break;
      case 'incend': // incendiary rocket: red-orange flame, embers and dark smoke
        this.fire.emit(x, y, z, R(-0.2, 0.2), R(0, 0.3), R(-0.2, 0.2), R(0.2, 0.35), 0.3 * size, 0.15 * size, 0, 1, 0, pf, RAMPS.ember, this.hdr);
        if (Math.random() < 0.5) this.add.emit(x, y, z, R(-0.8, 0.8), R(-0.2, 0.6), R(-0.8, 0.8), R(0.3, 0.6), 0.05, 0.02, 0, 1, -5, 3, RAMPS.ember, this.hdr);
        this.alpha.emit(x, y, z, R(-0.05, 0.05) + WIND_X * 0.5, R(0.05, 0.2), R(-0.05, 0.05) + WIND_Z * 0.5, R(0.5, 0.9), 0.07 * size, 0.3 * size, R(-0.6, 0.6), 0.5, 0.01, pf, RAMPS.smoke);
        break;
      case 'missile': // guided missile: a white-hot exhaust point and a thin light-grey exhaust streak that fades fast
        if (Math.random() < 0.6) this.add.emit(x, y, z, 0, 0, 0, 0.08, 0.2 * size, 0.08, 0, 0, 0, 0, RAMPS.flash, this.hdr * 1.4);
        this.alpha.emit(x, y, z, R(-0.03, 0.03) + WIND_X * 0.5, R(0.01, 0.06), R(-0.03, 0.03) + WIND_Z * 0.5, R(0.5, 0.85), 0.05 * size, 0.22 * size, R(-0.3, 0.3), 0.4, 0.01, pf, RAMPS.exhaustSmoke);
        break;
      case 'bigMissile': // cruise / nuke: a flame tongue and a somewhat thicker (still short-lived) grey exhaust
        this.add.emit(x, y, z, 0, 0, 0, 0.12, 0.35 * size, 0.15, 0, 0, 0, 0, RAMPS.flash, this.hdr);
        this.fire.emit(x, y, z, R(-0.15, 0.15), R(0, 0.15), R(-0.15, 0.15), R(0.12, 0.22), 0.22 * size, 0.12 * size, 0, 2, 0, pf, RAMPS.fire, this.hdr);
        this.alpha.emit(x, y, z, R(-0.05, 0.05) + WIND_X * 0.5, R(0.02, 0.1), R(-0.05, 0.05) + WIND_Z * 0.5, R(0.7, 1.1), 0.09 * size, 0.4 * size, R(-0.3, 0.3), 0.4, 0.01, pf, RAMPS.exhaustSmoke);
        break;
      case 'gauss': // magnetic slug: blue ionisation sparkle
        this.add.emit(x, y, z, R(-0.3, 0.3), R(-0.2, 0.3), R(-0.3, 0.3), R(0.2, 0.4), 0.14 * size, 0.03, 0, 2, 0, 3, RAMPS.gauss, this.hdr);
        break;
      case 'spark': // bomblet / grenade fuse: a tiny spark trail
        this.add.emit(x, y, z, R(-0.3, 0.3), R(-0.1, 0.3), R(-0.3, 0.3), R(0.12, 0.25), 0.06 * size, 0.02, 0, 1, -3, 3, RAMPS.spark, this.hdr);
        break;
      case 'firebomb': // incendiary shell: trailing flame and dark smoke
        this.fire.emit(x, y, z, R(-0.15, 0.15), R(0, 0.3), R(-0.15, 0.15), R(0.25, 0.45), 0.28 * size, 0.45 * size, R(-2, 2), 1, 0, pf, RAMPS.flame, this.hdr);
        if (Math.random() < 0.6) this.alpha.emit(x, y, z, R(-0.1, 0.1), R(0.1, 0.3), R(-0.1, 0.1), R(0.8, 1.3), 0.15 * size, 0.5 * size, R(-1, 1), 1, 0, pf, RAMPS.smoke);
        break;
      case 'heavyShell': // big artillery shell: a lazy grey smoke streamer
        if (Math.random() < 0.5) this.alpha.emit(x, y, z, R(-0.05, 0.05) + WIND_X * 0.6, R(0, 0.1), R(-0.05, 0.05) + WIND_Z * 0.6, R(0.5, 0.8), 0.06 * size, 0.25 * size, R(-1, 1), 0.6, 0, pf, RAMPS.smokeLight);
        if (Math.random() < 0.5) this.add.emit(x, y, z, 0, 0, 0, 0.08, 0.2 * size, 0.08, 0, 0, 0, 0, RAMPS.flame, this.hdr * 0.6);
        break;
      case 'shell':
        if (Math.random() < 0.3) this.alpha.emit(x, y, z, 0, 0, 0, R(0.3, 0.5), 0.06 * size, 0.2 * size, R(-1, 1), 1.5, 0, 1, RAMPS.smokeLight);
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

  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: THREE.Color, w: number, life = 0.12, wob = 0, grow = 0, core = 1.8): void {
    this.bolts.push({ kind: 'beam', ax, ay, az, bx, by, bz, r: color.r, g: color.g, b: color.b, w, life, max: life, seed: 0, roll: -1, pts: [], wob, grow, core });
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

  /** One lick of fire on a burning hull (call at a rate scaled to the hull's area): a tongue of flame climbing off a
   *  random spot of the hull (hx, hz = half extents, y = deck height), a hot yellow core and dark smoke above. */
  burning(x: number, y: number, z: number, hx: number, hz: number): void {
    const m = Math.min(hx, hz), px = x + R(-1, 1) * hx * 0.85, pz = z + R(-1, 1) * hz * 0.85, py = y + R(-0.15, 0.1);
    const pf = 1 + (Math.random() < 0.5 ? 1 : 0), s = (0.2 + m * 1.3) * 0.6;
    // a tongue: a fat base puff with a narrower, faster tip stacked above it, so the flame reads tall, not round
    const vy = R(1.1, 2.0), vx = R(-0.25, 0.25), vz = R(-0.25, 0.25);
    this.fire.emit(px, py, pz, vx, vy, vz, R(0.35, 0.6), s * R(0.9, 1.3), s * 0.3, R(-1, 1), 1.6, 1.2, pf, RAMPS.flame, this.hdr);
    this.fire.emit(px + vx * 0.1, py + s * 0.45, pz + vz * 0.1, vx * 1.3, vy * 1.4, vz * 1.3, R(0.22, 0.38), s * 0.6, s * 0.12, R(-1, 1), 1.6, 1.5, 3 - pf, RAMPS.flame, this.hdr);
    this.fire.emit(px + vx * 0.2, py + s * 0.8, pz + vz * 0.2, vx * 1.5, vy * 1.8, vz * 1.5, R(0.15, 0.25), s * 0.35, s * 0.08, 0, 1.6, 1.5, pf, RAMPS.flame, this.hdr);
    if (Math.random() < 0.45) this.add.emit(px, py + 0.05, pz, 0, R(0.6, 1.2), 0, R(0.12, 0.22), s * 0.6, s * 0.2, 0, 1, 0, 0, RAMPS.flash, this.hdr * 0.7);
    // a thin dark trail rising off the flame (narrow, fading fast), not a cloud
    if (Math.random() < 0.45) this.alpha.emit(px, py + 0.3 + s, pz, R(-0.08, 0.08) + WIND_X * 0.7, R(1.0, 1.6), R(-0.08, 0.08) + WIND_Z * 0.7, R(0.8, 1.4), s * 0.3, s * 1.0, R(-1, 1), 0.6, 0.15, pf, RAMPS.blackSmoke);
    if (Math.random() < 0.12) this.add.emit(px, py + 0.2, pz, R(-0.6, 0.6), R(1.2, 2.8), R(-0.6, 0.6), R(0.5, 1), 0.04, 0.02, 0, 0.6, 0.6, 3, RAMPS.ember, this.hdr);
  }

  /** a flamethrower jet particle at `prog` 0..1 of its reach: white-yellow and tight at the nozzle, billowing orange
   *  further out, rolling into dark smoke at the tip; napalm burns redder and sootier */
  flameJet(x: number, y: number, z: number, prog: number, size: number, napalm: boolean): void {
    const pf = 1 + (Math.random() < 0.5 ? 1 : 0), g = 0.3 + prog * 0.9;
    if (prog < 0.45) this.add.emit(x + R(-0.05, 0.05), y, z + R(-0.05, 0.05), R(-0.2, 0.2), R(0, 0.3), R(-0.2, 0.2), R(0.08, 0.14), 0.22 * size * (0.6 + prog), 0.1 * size, 0, 2, 0, 0, RAMPS.flash, this.hdr * 0.8);
    this.fire.emit(x + R(-0.1, 0.1) * g, y, z + R(-0.1, 0.1) * g, R(-0.5, 0.5) * g, R(0.3, 1.2) * g, R(-0.5, 0.5) * g, R(0.22, 0.4), 0.25 * size * g, 0.8 * size * g, R(-3, 3), 1.2, 0.8, pf, napalm ? RAMPS.ember : RAMPS.flame, this.hdr);
    if (prog > 0.55 && Math.random() < (napalm ? 0.45 : 0.25)) this.puff(x, y + 0.15, z, R(-0.2, 0.2), R(0.7, 1.3), R(-0.2, 0.2), R(0.9, 1.6), 0.25 * size, 0.9 * size, R(-1, 1), 0.8, 0.2, pf, RAMPS.smoke);
  }

  /** One wisp of travel dust kicked up behind a heavy ground unit (call at a rate set by size and speed): low, sandy,
   *  translucent, drifting back along the path and gone in well under a second. (bx, bz) = backward unit vector,
   *  S = hull size, k = 0..1 how fast it moves. */
  trackDust(x: number, z: number, bx: number, bz: number, S: number, k: number): void {
    const sp = R(0.3, 0.8) * (0.5 + k);
    this.alpha.emit(x, R(0.05, 0.15), z, bx * sp + R(-0.15, 0.15), R(0.08, 0.3), bz * sp + R(-0.15, 0.15), R(0.6, 1.0),
      0.15 + 0.05 * S, (0.4 + 0.18 * S) * (0.7 + 0.5 * k), R(-0.8, 0.8), 1.4, 0, 1 + (Math.random() < 0.5 ? 1 : 0), this.travelDust);
  }

  dustPuff(x: number, z: number, r: number): void {
    const n = this.lodN(4 + Math.round(r * 4));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = R(0.6, 1.8) * r;
      this.puff(x + Math.cos(a) * r * 0.3, 0.12, z + Math.sin(a) * r * 0.3, Math.cos(a) * s, R(0.1, 0.5), Math.sin(a) * s, R(0.6, 1.1), r * 0.35, r * 1.0, R(-1, 1), 3.2, 0, 1 + (i & 1), this.dust);
    }
  }
  /** a lingering smoke screen (sim 'smoke' event) */
  smokeScreen(x: number, z: number, r: number, dur: number): void { this.smokes.push({ x, z, r, left: dur, acc: 0 }); }

  /* --------------------------------------------------------------------------- weapon signatures (shooting) */

  /** Muzzle signature per weapon family at a barrel tip (dx, dz = firing direction on the ground, s = weapon size
   *  ~0.25 (light gun) .. 1.3 (titan gun)). k: spin-up fraction for rotary guns. */
  muzzleFx(x: number, y: number, z: number, dx: number, dz: number, s: number, kind: MuzzleKind, k = 1): void {
    const l = Math.hypot(dx, dz) || 1, nx = dx / l, nz = dz / l, h = this.hdr;
    const px = -nz, pz = nx; // side
    switch (kind) {
      case 'gatling': { // a ragged, rounder star (the barrels spin under it) that grows with the spin
        this.gunFlash(x, y, z, nx, nz, (0.1 + s * 0.6) * (0.6 + 0.5 * k), 5, false, h, 0.8, 0.04);
        if (Math.random() < 0.35 * k) this.add.emit(x, y, z, px * R(-2, 2) + nx, R(0.5, 2), pz * R(-2, 2) + nz, R(0.15, 0.3), 0.05, 0.02, 0, 1.5, -12, 3, RAMPS.spark, h);
        break;
      }
      case 'blast': case 'darts': { // shotgun / flechette: a wide fan of flame and a smoke cone
        const col = kind === 'darts' ? RAMPS.needle : RAMPS.flash;
        this.add.emit(x, y, z, 0, 0, 0, 0.08, s * 1.5, s * 0.8, 0, 0, 0, 0, col, h);
        for (let i = -2; i <= 2; i++) {
          const a = i * 0.22, cx = nx * Math.cos(a) - nz * Math.sin(a), cz = nz * Math.cos(a) + nx * Math.sin(a);
          this.add.emit(x + cx * s * 0.4, y, z + cz * s * 0.4, cx * 6, 0, cz * 6, 0.06, s * 0.55, s * 0.2, 0, 3, 0, 3, col, h);
        }
        const n = this.lodN(3);
        for (let i = 0; i < n; i++) this.puff(x + nx * 0.15, y, z + nz * 0.15, nx * R(1.5, 3) + px * R(-1, 1), R(0.1, 0.5), nz * R(1.5, 3) + pz * R(-1, 1), R(0.5, 0.9), s * 0.35, s * 1.3, R(-1, 1), 3, 0, 1 + (i & 1), RAMPS.smokeLight);
        break;
      }
      case 'cannon': case 'he': { // big flash, muzzle-brake side jets, a smoke ring and ground dust
        this.add.emit(x, y, z, 0, 0, 0, 0.12, s * 2.3, s * 1.0, 0, 0, 0, 0, RAMPS.flash, h);
        // the flash lights up the ground around the gun for an instant
        this.pools.add(x + nx * s * 0.5, z + nz * s * 0.5, 0.05, s * 1.6, s * 3.2, 0.16, 0.8 * h, 0.5 * h, 0.2 * h);
        this.add.emit(x + nx * s * 0.3, y, z + nz * s * 0.3, 0, 0, 0, 0.07, s * 2.6, s * 1.4, 0, 0, 0, 4, RAMPS.flash, h);
        this.tongue(x, y, z, nx, 0, nz, s * R(1.6, 2.1), 2.6, 0.09, RAMPS.flash, h);
        for (const sd of [-1, 1]) {
          const ux = px * sd - nx * 0.2, uz = pz * sd - nz * 0.2, l = Math.hypot(ux, uz);
          this.tongue(x, y, z, ux / l, 0.05, uz / l, s * R(0.8, 1.1), 2.4, 0.08, RAMPS.fire, h);
        }
        const n = this.lodN(kind === 'he' ? 6 : 4);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * 6.283;
          this.puff(x + nx * s * 0.4, y, z + nz * s * 0.4, nx * 1.4 + Math.cos(a) * 1.2, R(0.1, 0.6), nz * 1.4 + Math.sin(a) * 1.2, R(0.9, 1.6), s * 0.45, s * 1.6, R(-0.6, 0.6), 2.2, 0, 1 + (i & 1), i & 1 ? RAMPS.smokeLight : RAMPS.smoke);
        }
        for (let i = 0; i < 3; i++) this.puff(x + nx * s, 0.1, z + nz * s, nx * R(1, 2.5) + px * R(-1.5, 1.5), R(0, 0.3), nz * R(1, 2.5) + pz * R(-1.5, 1.5), R(0.5, 0.9), s * 0.5, s * 1.4, R(-1, 1), 3, 0, 1, this.dust);
        break;
      }
      case 'gauss': { // blue flash with a ring of electric sparks around the barrel
        this.add.emit(x, y, z, 0, 0, 0, 0.12, s * 1.6, s * 0.8, 0, 0, 0, 0, RAMPS.gauss, h);
        this.add.emit(x + nx * s * 0.5, y, z + nz * s * 0.5, nx * 7, 0, nz * 7, 0.08, s * 1.1, s * 0.3, 0, 3, 0, 3, RAMPS.bolt, h);
        const n = this.lodN(10);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * 6.283, c = Math.cos(a), sn = Math.sin(a);
          this.add.emit(x, y, z, px * c * 3 + nx, sn * 3, pz * c * 3 + nz, R(0.12, 0.25), 0.07, 0.02, 0, 3, 0, 3, RAMPS.gauss, h);
        }
        break;
      }
      case 'sniper': { // a long thin tongue, muzzle-brake side jets and a puff of dust
        this.gunFlash(x, y, z, nx, nz, 0.12 + s * 0.8, 2, true, h, 1.6, 0.06);
        this.puff(x + nx * 0.3, y, z + nz * 0.3, nx * 1.5, 0.2, nz * 1.5, R(0.6, 1.0), s * 0.4, s * 1.4, R(-1, 1), 2.5, 0, 1, RAMPS.smokeLight);
        break;
      }
      case 'rocket': { // flame burst and a backblast cloud thrown out behind the pod
        this.add.emit(x, y, z, 0, 0, 0, 0.1, s * 1.3, s * 0.7, 0, 0, 0, 0, RAMPS.fire, h);
        const n = this.lodN(4);
        for (let i = 0; i < n; i++) this.puff(x - nx * 0.3, y, z - nz * 0.3, -nx * R(2, 4) + px * R(-1, 1), R(0.2, 0.8), -nz * R(2, 4) + pz * R(-1, 1), R(0.8, 1.5), s * 0.4, s * 1.8, R(-1, 1), 2.4, 0, 1 + (i & 1), RAMPS.smokeLight);
        break;
      }
      case 'missile': { // white launch puff + hot ignition flare
        this.add.emit(x, y, z, 0, 0, 0, 0.12, s * 1.1, s * 0.5, 0, 0, 0, 0, RAMPS.flash, h * 1.2);
        const n = this.lodN(3);
        for (let i = 0; i < n; i++) this.puff(x, y, z, R(-0.8, 0.8), R(0.3, 0.9), R(-0.8, 0.8), R(0.9, 1.6), s * 0.45, s * 1.7, R(-1, 1), 1.8, 0, 1 + (i & 1), RAMPS.contrail);
        break;
      }
      case 'mortar': { // flash thrown upward and a smoke puff rising from the tube
        this.add.emit(x, y + s * 0.2, z, nx * 0.6, 3, nz * 0.6, 0.09, s * 1.2, s * 0.5, 0, 3, 0, 0, RAMPS.flash, h);
        const n = this.lodN(3);
        for (let i = 0; i < n; i++) this.puff(x, y + 0.1, z, nx * R(0.2, 0.8) + R(-0.3, 0.3), R(1.2, 2.2), nz * R(0.2, 0.8) + R(-0.3, 0.3), R(0.9, 1.6), s * 0.4, s * 1.6, R(-1, 1), 2, 0, 1 + (i & 1), RAMPS.smokeLight);
        break;
      }
      case 'flak': { // a hot flash out of the brake, dark smoke
        this.gunFlash(x, y, z, nx, nz, 0.15 + s * 0.8, 2, true, h, 1, 0.06, RAMPS.fire);
        this.puff(x + nx * 0.2, y, z + nz * 0.2, nx * 1.2, 0.5, nz * 1.2, R(0.7, 1.2), s * 0.4, s * 1.3, R(-1, 1), 2, 0, 1, RAMPS.smoke);
        break;
      }
      case 'ac': { // autocannon: a chunky tongue + muzzle-brake side jets, no smoke
        this.gunFlash(x, y, z, nx, nz, 0.14 + s * 0.8, 2, true, h, 1.1, 0.055);
        break;
      }
      default: this.muzzle(x, y, z, dx, dz, s); break;
    }
  }

  /** one rocket / missile leaving its tube (kind 0 rocket, 1 missile, 2 heavy missile): an ignition flash, a hot
   *  backblast jet out of the rear of the tube, a smoke cloud billowing behind the launcher and dust kicked off the
   *  ground beneath it */
  launch(x: number, y: number, z: number, dx: number, dz: number, s: number, kind: 0 | 1 | 2): void {
    const l = Math.hypot(dx, dz) || 1, nx = dx / l, nz = dz / l, h = this.hdr;
    const q = kind === 2 ? 1.6 : 1;
    this.add.emit(x, y, z, 0, 0, 0, 0.09, s * 1.1 * q, s * 0.5, 0, 0, 0, 0, kind ? RAMPS.flash : RAMPS.fire, h);
    this.fire.emit(x - nx * 0.25, y, z - nz * 0.25, -nx * 5, R(0, 0.4), -nz * 5, R(0.12, 0.2), s * 0.7 * q, s * 0.25, 0, 4, 0, 1, RAMPS.fire, h);
    const n = this.lodN(kind === 2 ? 6 : 3);
    for (let i = 0; i < n; i++) {
      this.alpha.emit(x - nx * 0.35, y, z - nz * 0.35, -nx * R(1.5, 3.5) + nz * R(-0.8, 0.8) + WIND_X, R(0.2, 0.8), -nz * R(1.5, 3.5) - nx * R(-0.8, 0.8) + WIND_Z,
        R(1.2, 2.2) * q, s * 0.4 * q, s * 1.9 * q, R(-0.8, 0.8), 2.2, 0, 1 + (i & 1), kind ? RAMPS.contrail : RAMPS.smokeLight);
    }
    if (y < 1.6) this.puff(x - nx * 0.6, 0.12, z - nz * 0.6, -nx * R(1, 2), R(0, 0.2), -nz * R(1, 2), R(0.6, 1.0), s * 0.5 * q, s * 1.6 * q, R(-1, 1), 3, 0, 1, this.dust);
  }

  /** a soft dark spot on the ground under an airborne round, for one frame (dt) */
  shadow(x: number, z: number, r: number, a: number, dt: number): void {
    _shadowRamp[3] = _shadowRamp[7] = _shadowRamp[11] = a;
    this.alpha.emit(x, 0.05, z, 0, 0, 0, dt * 1.5, r, r, 0, 0, 0, 0, _shadowRamp);
  }

  /** the blast's damage radius on the ground: a ring that snaps out to exactly `r` and fades (subtle for small
   *  splash, clear for big blasts); y > 0: an air burst, the ring drawn at that height */
  aoeRing(x: number, y: number, z: number, r: number, cool = false): void {
    if (r < 0.6) return;
    const k = clamp(0.1 + (r - 0.6) * 0.1, 0.1, 0.3) * this.hdr;
    const life = 0.55 + Math.min(0.6, r * 0.15);
    if (cool) this.aoe.add(x, z, y + 0.06, r * 0.55, r, life, 0.55 * k, 0.8 * k, 1.1 * k);
    else this.aoe.add(x, z, y + 0.06, r * 0.55, r, life, 1.2 * k, 0.62 * k, 0.24 * k);
  }

  /** a rotary gun's barrels glowing with heat (k 0..1); call once per frame per gun */
  heatGlow(x: number, y: number, z: number, s: number, k: number): void {
    this.add.emit(x, y, z, 0, 0, 0, 0.05, s * (0.25 + 0.45 * k), s * (0.25 + 0.45 * k), 0, 0, 0, 0, RAMPS.heat, this.hdr * k);
  }

  /* --------------------------------------------------------------------------- weapon signatures (impacts) */

  /** armour-piercing hit: a white-hot flash, a cone of sparks punching on through the hull along (dx, dz) and spall
   *  thrown back out of the entry hole */
  apHit(x: number, y: number, z: number, dx: number, dz: number, s: number, ramp: Ramp = RAMPS.spark): void {
    const l = Math.hypot(dx, dz) || 1, nx = dx / l, nz = dz / l, h = this.hdr;
    this.add.emit(x, y, z, 0, 0, 0, 0.09, 0.3 + s * 0.9, 0.12, 0, 0, 0, 0, RAMPS.flash, h * 1.2);
    const n = this.lodN(5 + Math.round(s * 8));
    for (let i = 0; i < n; i++) {
      const a = R(-0.45, 0.45), sp = R(5, 10), c = Math.cos(a), sn = Math.sin(a);
      this.add.emit(x, y, z, (nx * c - nz * sn) * sp, R(0, 2.5), (nz * c + nx * sn) * sp, R(0.12, 0.3), 0.06 + s * 0.05, 0.015, 0, 2.5, -8, 3, ramp, h);
    }
    const nb = this.lodN(3);
    for (let i = 0; i < nb; i++) this.add.emit(x, y, z, -nx * R(1, 3) + R(-1.5, 1.5), R(1, 3), -nz * R(1, 3) + R(-1.5, 1.5), R(0.3, 0.6), 0.06, 0.02, 0, 1, -12, 3, RAMPS.molten, h);
    this.puff(x, y, z, -nx * 0.4, 0.4, -nz * 0.4, R(0.4, 0.8), 0.15 + s * 0.2, 0.4 + s * 0.6, R(-1, 1), 2, 0, 1, RAMPS.smokeLight);
  }

  /** flechette darts zipping through a hull: thin bright needles continuing on and a glint */
  dartHit(x: number, y: number, z: number, dx: number, dz: number): void {
    const l = Math.hypot(dx, dz) || 1, nx = dx / l, nz = dz / l, h = this.hdr;
    this.add.emit(x, y, z, 0, 0, 0, 0.07, 0.3, 0.1, 0, 0, 0, 3, RAMPS.needle, h);
    for (let i = 0; i < 2; i++) this.add.emit(x, y, z, nx * R(7, 11) + R(-1, 1), R(-0.3, 1), nz * R(7, 11) + R(-1, 1), R(0.08, 0.16), 0.05, 0.02, 0, 1, -4, 3, RAMPS.needle, h);
    if (Math.random() < 0.5) this.add.emit(x, y, z, R(-2, 2), R(1, 3), R(-2, 2), R(0.15, 0.3), 0.05, 0.02, 0, 1.5, -12, 3, RAMPS.spark, h);
  }

  /** shotgun pellet: a pinprick of sparks */
  pelletHit(x: number, y: number, z: number): void {
    const h = this.hdr;
    this.add.emit(x, y, z, 0, 0, 0, 0.06, 0.2, 0.08, 0, 0, 0, 0, RAMPS.flash, h * 0.8);
    for (let i = 0; i < 2; i++) this.add.emit(x, y, z, R(-2.5, 2.5), R(0.5, 2.5), R(-2.5, 2.5), R(0.12, 0.25), 0.05, 0.02, 0, 1.5, -12, 3, RAMPS.spark, h);
  }

  /** laser / heat ray: a glowing molten spot, dripping slag and a curl of smoke (hot 0.5..2.5 scales it) */
  burnHit(x: number, y: number, z: number, s: number, hot = 1): void {
    const h = this.hdr;
    this.add.emit(x, y, z, 0, 0, 0, 0.14, 0.25 + s * 0.6 * hot, 0.15, 0, 0, 0, 0, RAMPS.molten, h * Math.min(1.6, hot));
    if (Math.random() < 0.4 + 0.2 * hot) this.add.emit(x, y, z, R(-0.8, 0.8), R(0, 1.2), R(-0.8, 0.8), R(0.3, 0.6), 0.06, 0.02, 0, 0.5, -9, 3, RAMPS.molten, h);
    if (Math.random() < 0.25 + 0.15 * hot) this.puff(x, y + 0.05, z, R(-0.1, 0.1), R(0.6, 1.1), R(-0.1, 0.1), R(0.7, 1.2), 0.08 + s * 0.1, 0.3 + s * 0.4, R(-1, 1), 1, 0, 1, RAMPS.smoke);
  }

  /** electric hit: a blue flare and a few crawling arcs */
  empHit(x: number, y: number, z: number, s: number): void {
    this.add.emit(x, y, z, 0, 0, 0, 0.16, 0.4 + s * 0.6, 0.2, 0, 0, 0, 0, RAMPS.emp, this.hdr);
    const n = Math.random() < 0.5 ? 2 : 1;
    for (let i = 0; i < n; i++) this.arcs(x, y, z, 0.2 + s * 0.3, 0.2 + s * 0.3);
  }

  /** slowing hit: icy flare and a burst of frost mist */
  frostHit(x: number, y: number, z: number, s: number): void {
    const h = this.hdr;
    this.add.emit(x, y, z, 0, 0, 0, 0.14, 0.3 + s * 0.5, 0.15, 0, 0, 0, 0, RAMPS.frost, h);
    const n = this.lodN(2);
    for (let i = 0; i < n; i++) this.alpha.emit(x + R(-0.15, 0.15), y, z + R(-0.15, 0.15), R(-0.5, 0.5), R(-0.2, 0.3), R(-0.5, 0.5), R(0.5, 0.9), 0.15, 0.45, R(-1, 1), 2, -0.5, 1 + (i & 1), RAMPS.frostMist);
    if (Math.random() < 0.6) this.add.emit(x, y, z, R(-1.5, 1.5), R(0.3, 1.5), R(-1.5, 1.5), R(0.25, 0.5), 0.05, 0.02, 0, 1.5, -3, 3, RAMPS.frost, h);
  }

  /** disarming hit: an amber glitch flash and sputtering sparks */
  jamHit(x: number, y: number, z: number, s: number): void {
    const h = this.hdr;
    this.add.emit(x, y, z, 0, 0, 0, 0.18, 0.35 + s * 0.6, 0.6 + s * 0.6, 0, 0, 0, 0, RAMPS.jam, h);
    const n = this.lodN(5);
    for (let i = 0; i < n; i++) this.add.emit(x, y, z, R(-2, 2), R(0.5, 3), R(-2, 2), R(0.25, 0.5), 0.06, 0.02, 0, 1.5, -10, 3, RAMPS.jam, h);
  }

  /** plasma splash: violet flare and molten droplets */
  plasmaHit(x: number, y: number, z: number, s: number): void {
    const h = this.hdr;
    this.add.emit(x, y, z, 0, 0, 0, 0.14, 0.35 + s * 0.8, 0.2, 0, 0, 0, 0, RAMPS.plasma, h);
    const n = this.lodN(3);
    for (let i = 0; i < n; i++) this.add.emit(x, y, z, R(-2, 2), R(0.5, 2.5), R(-2, 2), R(0.2, 0.4), 0.07, 0.02, 0, 1.5, -10, 3, RAMPS.plasma, h);
  }

  /** melee grinding: a fountain of sparks */
  grind(x: number, y: number, z: number, s: number): void {
    const h = this.hdr, n = this.lodN(4 + Math.round(s * 4));
    for (let i = 0; i < n; i++) this.add.emit(x, y, z, R(-3, 3), R(1, 4), R(-3, 3), R(0.2, 0.45), 0.06, 0.02, 0, 1, -14, 3, RAMPS.spark, h);
    this.add.emit(x, y, z, 0, 0, 0, 0.06, 0.25 + s * 0.3, 0.1, 0, 0, 0, 0, RAMPS.flash, h * 0.7);
  }

  /** blunt impact / knockback: dust shoved out along the ground and a pale shock ring */
  shockwave(x: number, z: number, r: number): void {
    const n = this.lodN(6 + Math.round(r * 5));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + Math.random() * 0.5, sp = r * R(4, 7);
      this.puff(x + Math.cos(a) * r * 0.3, 0.12, z + Math.sin(a) * r * 0.3, Math.cos(a) * sp, R(0.1, 0.6), Math.sin(a) * sp, R(0.5, 0.9), r * 0.4, r * 1.2, R(-1, 1), 4.5, 0, 1 + (i & 1), this.dust);
    }
    this.rings.add(x, z, 0.08, r * 0.3, r * 3.4, 0.3, 0.45 * this.hdr, 0.42 * this.hdr, 0.36 * this.hdr);
  }

  /** earth thrown up by a shell that buried itself before going off (artillery) */
  dirtGeyser(x: number, z: number, r: number): void {
    const n = this.lodN(4 + Math.round(r * 4));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, sp = R(0.3, 1.2) * r;
      this.alpha.emit(x, 0.15, z, Math.cos(a) * sp, R(3, 6) * (0.6 + r * 0.3), Math.sin(a) * sp, R(0.8, 1.4), r * 0.3, r * 0.9, R(-1, 1), 1.2, -6, 1 + (i & 1), this.dirt);
    }
    const nd = this.lodN(2 + Math.round(r * 2));
    for (let i = 0; i < nd; i++) {
      const a = Math.random() * 6.283, sp = R(1, 3) + r;
      this.debris.add(x, 0.2, z, Math.cos(a) * sp, R(5, 9), Math.sin(a) * sp, R(0.06, 0.12) * (0.7 + r * 0.3), this.dirtRgb);
    }
  }

  /** small high-explosive pop (autocannon round, grenade, an AP shell's bursting charge, bomblet): flash, a fist of
   *  flame, sparks and a puff; no smoke column or debris */
  pop(x: number, y: number, z: number, r: number, ramp: Ramp = RAMPS.fire, scorch = true): void {
    r = clamp(r, 0.15, 2);
    const h = this.hdr, kq = 1 / (1 + this.heat * 0.3);
    this.heat += 0.35;
    this.add.emit(x, y + 0.1, z, 0, 0, 0, 0.07, r * 1.6, r * 1.0, 0, 0, 0, 0, RAMPS.flash, h * kq);
    const fr = ramp === RAMPS.fire ? RAMPS.fireball : ramp;
    const nf = this.lodN(2 + Math.round(r * 3));
    for (let i = 0; i < nf; i++) {
      const a = Math.random() * 6.283, sp = r * R(0.8, 2);
      this.fire.emit(x + Math.cos(a) * r * 0.2, y + 0.1 + r * 0.25, z + Math.sin(a) * r * 0.2, Math.cos(a) * sp, R(0.5, 1.5) * (0.6 + r), Math.sin(a) * sp, R(0.4, 0.62), r * R(0.6, 0.85), r * R(1.3, 1.7), R(-1, 1), 4, 0, 1 + (i & 1), fr, h * (0.6 + 0.4 * kq));
    }
    const nk = this.lodN(4 + Math.round(r * 8));
    for (let i = 0; i < nk; i++) { const a = Math.random() * 6.283, sp = R(3, 8); this.add.emit(x, y + 0.1, z, Math.cos(a) * sp, R(1.5, 5.5), Math.sin(a) * sp, R(0.22, 0.5), 0.05 + r * 0.04, 0.02, 0, 1.0, -10, 3, RAMPS.spark, h); }
    this.puff(x, y + 0.15 + r * 0.2, z, R(-0.2, 0.2) + WIND_X, R(0.4, 0.9), R(-0.2, 0.2) + WIND_Z, R(1.2, 2.0), r * 0.7, r * 2.0, R(-0.4, 0.4), 1.2, 0, 1, RAMPS.blastSmoke);
    if (ramp === RAMPS.fire && r > 0.4 && Math.random() < r) this.firebrands(x, y + 0.1, z, 1 + Math.round(r), r * 0.6);
    if (scorch && y < 0.2) this.addScorch(x, z, r * 0.8);
    this.trauma = Math.min(1, this.trauma + 0.01 + r * 0.03);
  }

  /** Flak airburst at an aircraft's altitude (r: the shell's splash radius; heavy: heavy flak, a bigger burst): a white
   *  flash with a brief orange core, a ball of dark-grey / black smoke that hangs ~1 s and drifts with the breeze, and
   *  shrapnel streaks flung out in every direction. All from the shared particle pools; nothing reaches the ground (no
   *  scorch, ring or dust). */
  flakBurst(x: number, y: number, z: number, r: number, heavy = false): void {
    const k = clamp(r, 0.8, 3) * (heavy ? 1.3 : 1) * 0.5, h = this.hdr, kq = 1 / (1 + this.heat * 0.35);
    this.heat += heavy ? 0.6 : 0.4;
    // the detonation: a hard white flash, a softer warm bloom and a short-lived orange core
    this.add.emit(x, y, z, 0, 0, 0, 0.07, k * 2.4, k * 1.2, 0, 0, 0, 0, RAMPS.flash, h * 1.3 * kq);
    this.add.emit(x, y, z, 0, 0, 0, 0.16, k * 2.6, k * 3.2, 0, 0, 0, 0, RAMPS.fire, h * 0.35 * kq);
    const nf = this.lodN(heavy ? 3 : 2);
    for (let i = 0; i < nf; i++) this.fire.emit(x + R(-0.15, 0.15) * k, y + R(-0.1, 0.15) * k, z + R(-0.15, 0.15) * k, R(-1, 1) * k, R(-0.4, 0.8) * k, R(-1, 1) * k, R(0.16, 0.26), k * 0.55, k * 1.05, R(-1, 1), 5, 0, 1 + (i & 1), RAMPS.fireball, h * 0.8 * kq);
    // the classic flak puff: a tight ball of oily black smoke (not thinned like other puffs: it is the signature)
    const ns = this.lodN(heavy ? 6 : 4);
    for (let i = 0; i < ns; i++) {
      const a = Math.random() * 6.283, d = R(0, 0.35) * k;
      this.alpha.emit(x + Math.cos(a) * d, y + R(-0.2, 0.25) * k, z + Math.sin(a) * d, Math.cos(a) * R(0.3, 0.9) * k + WIND_X * 1.6, R(-0.05, 0.25), Math.sin(a) * R(0.3, 0.9) * k + WIND_Z * 1.6,
        R(0.95, 1.35) * (heavy ? 1.15 : 1), k * R(0.75, 1.0), k * R(1.8, 2.4), R(-0.5, 0.5), 2.2, 0.04, 1 + (i & 1), RAMPS.flakPuff);
    }
    // shrapnel: bright streaks radiating out in a full sphere, and a few slower glowing fragments that drop away
    const nk = this.lodN(heavy ? 22 : 14);
    for (let i = 0; i < nk; i++) {
      const a = Math.random() * 6.283, e = Math.asin(R(-0.85, 0.95)), sp = R(7, 13) * (heavy ? 1.15 : 1);
      this.add.emit(x, y, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp, R(0.14, 0.28), 0.07 + k * 0.03, 0.02, 0, 2.2, -5, 3, RAMPS.spark, h * 1.1);
    }
    const nb = this.lodN(heavy ? 5 : 3);
    for (let i = 0; i < nb; i++) { const a = Math.random() * 6.283; this.add.emit(x, y, z, Math.cos(a) * R(1.5, 3.5), R(0, 2), Math.sin(a) * R(1.5, 3.5), R(0.35, 0.6), 0.06, 0.02, 0, 1.2, -9, 3, RAMPS.molten, h); }
    this.trauma = Math.min(1, this.trauma + (heavy ? 0.03 : 0.015));
  }

  /** shrapnel striking an aircraft's hull (a flak burst beside it): a pinpoint flash and sparks skittering off the
   *  side facing the burst ((dx, dz): from the burst toward the hull) */
  flakHit(x: number, y: number, z: number, dx: number, dz: number, s: number): void {
    const l = Math.hypot(dx, dz) || 1, nx = dx / l, nz = dz / l, h = this.hdr;
    this.add.emit(x, y, z, 0, 0, 0, 0.06, 0.25 + s * 0.3, 0.1, 0, 0, 0, 0, RAMPS.flash, h);
    const n = this.lodN(4 + Math.round(s * 4));
    for (let i = 0; i < n; i++) {
      const a = R(-1.1, 1.1), sp = R(2.5, 6), c = Math.cos(a), sn = Math.sin(a);
      // glancing off: back out toward the burst side and along the skin
      this.add.emit(x, y, z, (-nx * c - nz * sn) * sp, R(-1, 2.5), (-nz * c + nx * sn) * sp, R(0.1, 0.24), 0.05, 0.015, 0, 2, -9, 3, RAMPS.spark, h);
    }
  }

  /** a cluster shell splitting open just above the ground: a bright crack and a ring of sparks (the bomblets follow) */
  clusterBurst(x: number, z: number, r: number, base = 0): void {
    const y = base > 0 ? base + 0.15 : 0.7 + r * 0.25, h = this.hdr;
    this.add.emit(x, y, z, 0, 0, 0, 0.12, 1.4 + r * 0.6, 0.6, 0, 0, 0, 0, RAMPS.flash, h * 1.2);
    const n = this.lodN(16);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + R(0, 0.3), sp = R(3, 6) * (0.6 + r * 0.25);
      this.add.emit(x, y, z, Math.cos(a) * sp, R(0.5, 2.5), Math.sin(a) * sp, R(0.3, 0.55), 0.08, 0.02, 0, 1.5, -10, 3, RAMPS.spark, h);
    }
    const ns = this.lodN(4);
    for (let i = 0; i < ns; i++) this.puff(x + R(-0.3, 0.3), y, z + R(-0.3, 0.3), R(-0.8, 0.8), R(0, 0.4), R(-0.8, 0.8), R(1.2, 2), 0.4, 1.4, R(-1, 1), 1.5, 0, 1 + (i & 1), RAMPS.smokeLight);
  }

  /** incendiary splash: burning globs flung out low, and a column of dark smoke */
  fireSplash(x: number, z: number, r: number): void {
    const h = this.hdr, n = this.lodN(6 + Math.round(r * 6));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, sp = R(1, 3) * r;
      this.fire.emit(x, 0.2, z, Math.cos(a) * sp, R(1.5, 3.5), Math.sin(a) * sp, R(0.7, 1.3), r * R(0.25, 0.45), r * R(0.15, 0.3), R(-2, 2), 1.5, -6, 1 + (i & 1), RAMPS.ember, h);
    }
    const ns = this.lodN(3);
    for (let i = 0; i < ns; i++) this.puff(x + R(-0.3, 0.3) * r, 0.4, z + R(-0.3, 0.3) * r, R(-0.3, 0.3), R(0.8, 1.6), R(-0.3, 0.3), R(1.6, 2.6), r * 0.5, r * 1.8, R(-0.6, 0.6), 0.5, 0.2, 1 + (i & 1), RAMPS.smoke);
  }

  /** a burning ground patch (sim 'fireField') that flickers for `dur` seconds */
  /** a radioactive fallout zone (sim 'fireField' with rad) that glows for `dur` seconds */
  radField(x: number, z: number, r: number, dur: number): void {
    if (this.radZones.length >= 24) this.radZones.shift();
    this.radZones.push({ x, z, r, left: dur, acc: 0 });
    this.addScorch(x, z, r * 0.9);
  }

  fireField(x: number, z: number, r: number, dur: number): void {
    // the sim tops up a patch that is hit again and re-announces it at the same spot: extend, don't stack
    for (const f of this.fields) {
      if (Math.abs(f.x - x) < 0.05 && Math.abs(f.z - z) < 0.05) { f.left = Math.max(f.left, dur); f.max = Math.max(f.max, f.left); f.r = Math.max(f.r, r); return; }
    }
    if (this.fields.length >= 200) this.fields.shift();
    this.fields.push({ x, z, r, left: dur, max: dur, acc: 0, seed: Math.random(), k: 0, age: 0 });
    this.addScorch(x, z, r * 0.75);
    if (r >= 1) this.fireSplash(x, z, Math.min(1.4, r * 0.6));
  }

  /* ----------------------------------------------------------------------------------- weapon signatures (trails) */

  /** Railgun shot (s = weapon scale ~0.5 rail rifle .. 1 railgun, mega = spinal mass driver): a white-hot core inside a
   *  wide electric-blue sheath that lingers and fades, a muzzle blast (flash, shockwave ring, sparks venting sideways
   *  out of the rails), a thick corkscrew of ionised air along the path, and a heavy impact burst. Bigger guns kick
   *  the camera. */
  railShot(ax: number, ay: number, az: number, bx: number, by: number, bz: number, s: number, mega = false): void {
    const h = this.hdr, k = mega ? 2.4 : 1;
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = dx / l, nz = dz / l;
    // core + sheath + afterglow
    // one smooth beam: white-hot core -> blue glow -> soft halo, then the channel deionises and wisps away
    _rc.setRGB(0.35, 0.55, 1);
    this.rails.add(ax, ay, az, bx, by, bz, (0.85 + 0.65 * s) * k, 0.8 + 0.35 * k, _rc, this.hdr);
    // muzzle blast: flash, ground shockwave, sparks venting sideways out of the rails
    this.add.emit(ax, ay, az, 0, 0, 0, 0.12 + 0.05 * k, (0.35 + 0.5 * s) * k, 0.15, 0, 0, 0, 0, RAMPS.railFlash, h);
    this.rings.add(ax, az, 0.08, 0.1 * s * k, (0.6 + 0.7 * s) * k, 0.28 + 0.1 * k, 0.12 * h, 0.22 * h, 0.5 * h);
    const nv = this.lodN(Math.round((6 + 10 * s) * k));
    for (let i = 0; i < nv; i++) {
      const side = i & 1 ? 1 : -1, sp = R(3, 8) * k, fwd = R(-0.5, 1.5);
      this.add.emit(ax, ay, az, (-nz * side * sp) + nx * fwd, R(0.2, 2), (nx * side * sp) + nz * fwd, R(0.12, 0.28), 0.06 + 0.04 * s, 0.015, 0, 2.5, -8, 3, RAMPS.gauss, h);
    }
    // ionised corkscrew + vapour puffs hanging on the line
    this.railTrail(ax, ay, az, bx, by, bz, RAMPS.gauss, Math.min(1.6, s * 1.3 * k));
    // electric crackle: short jagged arcs flickering along the slug's path (no end flares: there are several)
    const len = Math.hypot(dx, by - ay, dz);
    const na = Math.min(10, this.lodN(Math.round((2 + 3 * s) * k + len / 8)));
    for (let i = 0; i < na && this.bolts.length < 560; i++) {
      const t0 = Math.random() * 0.9, t1 = Math.min(1, t0 + R(1.2, 3) / Math.max(1, len));
      const o0 = R(-0.18, 0.18) * k, o1 = R(-0.18, 0.18) * k;
      const lf = R(0.12, 0.3);
      this.bolts.push({
        kind: 'bolt', ax: ax + dx * t0 - nz * o0, ay: ay + (by - ay) * t0 + R(-0.05, 0.15), az: az + dz * t0 + nx * o0,
        bx: ax + dx * t1 - nz * o1, by: ay + (by - ay) * t1 + R(-0.05, 0.15), bz: az + dz * t1 + nx * o1,
        r: 0.55, g: 0.75, b: 1, w: (0.02 + 0.015 * s) * k, life: lf, max: lf, seed: (Math.random() * 1e9) | 0, roll: -1, pts: [], wob: 0,
      });
    }
    // impact: white flash, blue shock ring, spray of sparks along the line of fire, molten debris
    this.add.emit(bx, by, bz, 0, 0, 0, 0.16 + 0.06 * k, (0.45 + 0.7 * s) * k, 0.2, 0, 0, 0, 0, RAMPS.railFlash, h * 1.1);
    this.rings.add(bx, bz, 0.08, 0.12 * s * k, (0.7 + 0.9 * s) * k, 0.34 + 0.1 * k, 0.14 * h, 0.26 * h, 0.55 * h);
    this.apHit(bx, by, bz, dx, dz, Math.min(2, (0.8 + s) * k), RAMPS.gauss);
    this.trauma = Math.min(1, this.trauma + (mega ? 0.35 : 0.03 + 0.07 * s));
  }

  /** rail slug path: an ionised streak of light puffs and sparkles left hanging along the line */
  railTrail(ax: number, ay: number, az: number, bx: number, by: number, bz: number, ramp: Ramp, s: number): void {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const n = this.lodN(Math.min(48, Math.round(len / 0.4)));
    for (let i = 0; i < n; i++) {
      const t = (i + Math.random()) / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      if (i % 2 === 0) this.puff(x, y, z, R(-0.1, 0.1), R(0.05, 0.25), R(-0.1, 0.1), R(0.8, 1.4), 0.1 + s * 0.12, 0.35 + s * 0.4, R(-1, 1), 1.5, 0, 1 + (i & 1), RAMPS.smoke);
      // ionised air: a corkscrew of glowing motes that hangs on the line after the slug has gone
      const ph = t * len * 2.2, rr = 0.06 + s * 0.08;
      this.add.emit(x + Math.cos(ph) * rr, y + Math.sin(ph) * rr, z + Math.sin(ph) * rr, 0, R(0.05, 0.2), 0, R(0.35, 0.7), 0.1 + s * 0.08, 0.03, 0, 1, 0, 0, ramp, this.hdr);
    }
  }

  /** Sniper round: a blue-white beam snapped along the whole path that fades over a third of a second, a star flare at
   *  the muzzle and at the hit, and a thin smoke wake that hangs on the line and drifts off. enemy: a warmer white. */
  sniperShot(ax: number, ay: number, az: number, bx: number, by: number, bz: number, enemy = false): void {
    const h = this.hdr;
    _col.setRGB(enemy ? 1 : 0.25, enemy ? 0.7 : 0.55, enemy ? 0.45 : 1);
    this.beam(ax, ay, az, bx, by, bz, _col, 0.045, 0.32, 0, 0, 1.2);
    const flare = enemy ? RAMPS.flash : RAMPS.railFlash;
    this.add.emit(ax, ay, az, 0, 0, 0, 0.12, 1.4, 0.5, 0, 0, 0, 4, flare, h);
    this.add.emit(bx, by, bz, 0, 0, 0, 0.16, 1.1, 0.4, 0, 0, 0, 4, flare, h);
    for (let i = 0; i < 6; i++) this.add.emit(bx, by, bz, R(-3, 3), R(0.5, 4), R(-3, 3), R(0.15, 0.35), 0.06, 0.02, 0, 1.5, -10, 3, enemy ? RAMPS.spark : RAMPS.gauss, h);
    const len = Math.hypot(bx - ax, by - ay, bz - az), n = this.lodN(Math.min(110, Math.round(len / 0.12)));
    for (let i = 0; i < n; i++) {
      const t = (i + Math.random()) / n;
      this.alpha.emit(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, R(-0.05, 0.05) + WIND_X, R(0.05, 0.2), R(-0.05, 0.05) + WIND_Z,
        R(0.8, 1.3), 0.12, R(0.28, 0.42), R(-1, 1), 0.8, 0, 1 + (i & 1), RAMPS.exhaustSmoke);
    }
  }

  /** motes streaming along a beam from a to b (disarm beam: toward the target; gravity beam: back to the projector) */
  beamMotes(ax: number, ay: number, az: number, bx: number, by: number, bz: number, ramp: Ramp, n = 3): void {
    const dx = bx - ax, dy = by - ay, dz = bz - az, l = Math.hypot(dx, dy, dz) || 1;
    const m = this.lodN(n);
    for (let i = 0; i < m; i++) {
      const t = Math.random(), sp = R(4, 8);
      this.add.emit(ax + dx * t, ay + dy * t, az + dz * t, (dx / l) * sp, (dy / l) * sp, (dz / l) * sp, R(0.12, 0.22), 0.09, 0.04, 0, 0, 0, 0, ramp, this.hdr);
    }
  }

  /** pressure pulse along a sonic orb's path: a pale swelling glow and a ground ripple */
  sonicPulse(x: number, y: number, z: number, s: number): void {
    this.add.emit(x, y, z, 0, 0, 0, 0.35, s * 0.4, s * 1.8, 0, 0, 0, 0, RAMPS.sonic, this.hdr);
    this.rings.add(x, z, 0.08, s * 0.2, s * 1.4, 0.35, 0.25 * this.hdr, 0.26 * this.hdr, 0.22 * this.hdr);
  }

  /* ------------------------------------------------------------------------------------ status indicators */

  /** slowed: frost mist sinking off the hull and ice glints; k = slow strength 0..1 */
  frost(x: number, y: number, z: number, hx: number, hz: number, k: number): void {
    const a = Math.random() * 6.283, px = x + Math.cos(a) * hx * R(0.3, 1), pz = z + Math.sin(a) * hz * R(0.3, 1);
    this.alpha.emit(px, y, pz, R(-0.15, 0.15), R(-0.35, -0.1), R(-0.15, 0.15), R(0.8, 1.4), 0.12 + hx * 0.2, 0.35 + hx * 0.5, R(-0.5, 0.5), 1, 0, 1 + (Math.random() < 0.5 ? 1 : 0), RAMPS.frostMist);
    if (Math.random() < 0.5 + k * 0.5) this.add.emit(px, y + R(0, 0.2), pz, 0, R(0, 0.2), 0, R(0.25, 0.5), 0.07 + k * 0.05, 0.02, 0, 0, 0, 3, RAMPS.frost, this.hdr);
  }

  /** disarmed: amber sparks sputtering out of a dead gun and a wisp of smoke */
  jam(x: number, y: number, z: number): void {
    const h = this.hdr;
    this.add.emit(x, y, z, 0, 0, 0, 0.12, 0.28, 0.4, 0, 0, 0, 0, RAMPS.jam, h * 0.8);
    for (let i = 0; i < 2; i++) this.add.emit(x, y, z, R(-1.5, 1.5), R(0.8, 2.5), R(-1.5, 1.5), R(0.2, 0.4), 0.05, 0.02, 0, 1.5, -10, 3, RAMPS.jam, h);
    if (Math.random() < 0.4) this.puff(x, y + 0.05, z, R(-0.1, 0.1), R(0.5, 0.9), R(-0.1, 0.1), R(0.6, 1.0), 0.08, 0.3, R(-1, 1), 1, 0, 1, RAMPS.smoke);
  }

  /** paralysis building up (not yet stunned): stray blue sparks */
  paraSpark(x: number, y: number, z: number, hx: number, hz: number): void {
    const a = Math.random() * 6.283;
    this.add.emit(x + Math.cos(a) * hx, y + R(-0.1, 0.2), z + Math.sin(a) * hz, R(-1, 1), R(0.5, 1.5), R(-1, 1), R(0.15, 0.3), 0.06, 0.02, 0, 1, -6, 3, RAMPS.emp, this.hdr);
  }

  /* ----------------------------------------------------------------------------------- damage / crashes */

  /** One wisp of damage smoke leaking out of a seam or joint (call at a rate set by the damage). Thin rising trails,
   *  not puffs: steam = light coolant / hydraulic hiss, oil = brown-black engine smoke, black = the thick smoke of a
   *  critically damaged hull, elec = blue-grey electrical smoke with the odd spark, dust = grit shaken loose.
   *  k 0..1 scales size and density; (vx, vz): drift (a moving hull leaves its wisps behind). */
  wisp(x: number, y: number, z: number, kind: WispKind, k: number, vx = 0, vz = 0): void {
    const pf = 1 + (Math.random() < 0.5 ? 1 : 0);
    const black = kind === 'black';
    const ramp = kind === 'steam' ? RAMPS.steam : kind === 'oil' ? RAMPS.oilSmoke : black ? RAMPS.blackSmoke : kind === 'elec' ? RAMPS.elecSmoke : this.dust;
    const s0 = 0.04 + 0.05 * k, s1 = black ? 0.18 + 0.3 * k : 0.14 + 0.25 * k;
    const life = kind === 'steam' ? R(0.5, 0.9) : R(0.9, 1.5) * (0.75 + 0.45 * k);
    const up = kind === 'steam' ? R(1.0, 1.7) : black ? R(0.8, 1.4) : R(0.55, 1.0);
    this.alpha.emit(x, y, z, vx + R(-0.07, 0.07) + WIND_X * 0.7, up, vz + R(-0.07, 0.07) + WIND_Z * 0.7, life, s0, s1, R(-0.8, 0.8), 0.8, 0.12, pf, ramp);
    if (kind === 'elec' && Math.random() < 0.3) this.add.emit(x, y, z, R(-1.5, 1.5), R(0.5, 2.2), R(-1.5, 1.5), R(0.12, 0.25), 0.05, 0.015, 0, 1.5, -9, 3, RAMPS.emp, this.hdr);
  }

  /** a short fizz of sparks out of a damaged joint (heavy / critical damage) */
  damageSpark(x: number, y: number, z: number, elec = false): void {
    const h = this.hdr, n = 2 + Math.floor(Math.random() * 3);
    if (Math.random() < 0.5) this.add.emit(x, y, z, 0, 0, 0, 0.06, 0.16, 0.06, 0, 0, 0, 0, elec ? RAMPS.emp : RAMPS.flash, h * 0.8);
    for (let i = 0; i < n; i++) this.add.emit(x, y, z, R(-2, 2), R(0.6, 2.8), R(-2, 2), R(0.15, 0.35), 0.045, 0.015, 0, 1.2, -11, 3, elec ? RAMPS.emp : RAMPS.spark, h);
  }

  /** a small fire licking out of a hole / hatch of a critically damaged hull: one flame tongue, now and then smoke */
  smallFire(x: number, y: number, z: number, s: number): void {
    const pf = 1 + (Math.random() < 0.5 ? 1 : 0), h = this.hdr;
    const vy = R(0.9, 1.6);
    this.fire.emit(x, y, z, R(-0.15, 0.15), vy, R(-0.15, 0.15), R(0.35, 0.55), s * R(1.1, 1.4), s * 0.5, R(-1, 1), 1.6, 1.2, pf, RAMPS.flame, h);
    this.fire.emit(x, y + s * 0.4, z, R(-0.15, 0.15), vy * 1.4, R(-0.15, 0.15), R(0.22, 0.36), s * 0.75, s * 0.2, R(-1, 1), 1.6, 1.4, 3 - pf, RAMPS.flame, h);
    if (Math.random() < 0.5) this.add.emit(x, y + 0.05, z, 0, 0.5, 0, R(0.12, 0.22), s * 1.4, s * 0.5, 0, 1, 0, 0, RAMPS.fire, h * 0.6);
  }

  /** a burning aircraft falling: flames streaming off it and a black smoke trail; k 0..1 = how hard it burns */
  crashTrail(x: number, y: number, z: number, s: number, k: number): void {
    const pf = 1 + (Math.random() < 0.5 ? 1 : 0), h = this.hdr;
    this.fire.emit(x + R(-0.15, 0.15) * s, y, z + R(-0.15, 0.15) * s, R(-0.3, 0.3), R(0.2, 0.8), R(-0.3, 0.3), R(0.25, 0.45), (0.3 + 0.25 * s) * (0.7 + 0.5 * k), 0.12 * s, R(-2, 2), 2, 0.5, pf, RAMPS.fireball, h);
    this.alpha.emit(x, y + 0.1, z, R(-0.15, 0.15) + WIND_X, R(0.3, 0.8), R(-0.15, 0.15) + WIND_Z, R(1.6, 2.8), 0.15 + 0.15 * s, (0.7 + 0.5 * s) * (0.6 + 0.5 * k), R(-0.6, 0.6), 0.5, 0.05, 3 - pf, RAMPS.blackSmoke);
    if (Math.random() < 0.25) this.add.emit(x, y, z, R(-2, 2), R(-0.5, 1.5), R(-2, 2), R(0.3, 0.6), 0.05, 0.02, 0, 0.6, -6, 3, RAMPS.ember, h);
  }

  /** Explosive warhead striking a hull that survives it (the kill gets its own, bigger blast): w = warhead size
   *  ~0.2 (20 mm HE) .. 1.6 (heavy bomb), (dx, dz) = direction of travel.
   *  heat: shaped charge / AT missile: a white-hot star, a jet of spall punching on through, molten spatter blown
   *        back out of the hole, a tight fireball clinging to the plate and a puff of dark smoke.
   *  he:   high-explosive shell / rocket: flash, a lobed fireball on the hull, a ring of sparks, grey-black smoke.
   *  plasma / emp: a coloured burst of the same size. */
  warheadHit(x: number, y: number, z: number, dx: number, dz: number, w: number, kind: 'heat' | 'he' | 'plasma' | 'emp', air = false): void {
    w = clamp(w, 0.15, 1.8);
    const l = Math.hypot(dx, dz) || 1, nx = dx / l, nz = dz / l, h = this.hdr;
    const kq = 1 / (1 + this.heat * 0.3);
    this.heat += 0.4 + w * 0.3;
    if (kind === 'plasma' || kind === 'emp') {
      const rp = kind === 'plasma' ? RAMPS.plasma : RAMPS.emp;
      this.add.emit(x, y, z, 0, 0, 0, 0.1, 0.5 + 1.3 * w, 0.3, 0, 0, 0, 4, rp, h * kq);
      this.add.emit(x, y, z, 0, 0, 0, 0.2, 0.4 + 1.0 * w, 0.9 + 1.4 * w, 0, 0, 0, 0, rp, h * kq * 0.8);
      const n = this.lodN(6 + Math.round(w * 8));
      for (let i = 0; i < n; i++) this.add.emit(x, y, z, R(-3, 3), R(0.5, 3.5), R(-3, 3), R(0.2, 0.45), 0.07, 0.02, 0, 1.5, -9, 3, rp, h);
      if (kind === 'emp') this.arcs(x, y, z, 0.25 + w * 0.4, 0.25 + w * 0.4);
      return;
    }
    // flash: a hard star + a soft bloom
    this.add.emit(x, y, z, 0, 0, 0, 0.1, (0.7 + 1.3 * w) * (kind === 'heat' ? 1.2 : 1), 0.3, 0, 0, 0, 4, kind === 'heat' ? RAMPS.jet : RAMPS.flash, h * kq);
    this.add.emit(x, y, z, 0, 0, 0, 0.16, 0.9 + 1.8 * w, 0.4 + 0.8 * w, 0, 0, 0, 0, RAMPS.flash, h * kq * 0.8);
    if (!air) this.pools.add(x, z, 0.05, 0.6 + w, 1.4 + 2 * w, 0.2, 0.7 * h * kq, 0.4 * h * kq, 0.15 * h * kq);
    if (kind === 'heat') {
      // the jet: hot spall streaking on through and out of the far side, in a narrow cone
      const n = this.lodN(8 + Math.round(w * 12));
      for (let i = 0; i < n; i++) {
        const a = R(-0.3, 0.3), sp = R(9, 17), c = Math.cos(a), sn = Math.sin(a);
        this.add.emit(x, y, z, (nx * c - nz * sn) * sp, R(-0.5, 2.5), (nz * c + nx * sn) * sp, R(0.12, 0.3), 0.07 + w * 0.04, 0.015, 0, 2, -6, 3, i & 1 ? RAMPS.jet : RAMPS.spark, h);
      }
      const nb = this.lodN(4 + Math.round(w * 3));
      for (let i = 0; i < nb; i++) this.add.emit(x, y, z, -nx * R(1, 3.5) + R(-1.5, 1.5), R(1, 3.5), -nz * R(1, 3.5) + R(-1.5, 1.5), R(0.35, 0.7), 0.06, 0.02, 0, 0.8, -12, 3, RAMPS.molten, h);
    } else {
      const n = this.lodN(6 + Math.round(w * 10));
      for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, sp = R(3, 8) * (0.7 + w * 0.4); this.add.emit(x, y, z, Math.cos(a) * sp - nx * 1.5, R(1, 5), Math.sin(a) * sp - nz * 1.5, R(0.25, 0.5), 0.05 + w * 0.04, 0.02, 0, 1, -10, 3, RAMPS.spark, h); }
    }
    // fireball clinging to the plate (blown back off it a little), cooling to soot
    const r = (kind === 'heat' ? 0.3 : 0.32) + (kind === 'heat' ? 0.42 : 0.55) * w;
    const nf = this.lodN(3 + Math.round(w * 3));
    for (let i = 0; i < nf; i++) {
      const a = Math.random() * 6.283, sp = r * R(0.6, 1.6);
      this.fire.emit(x - nx * r * 0.3 + Math.cos(a) * r * 0.2, y + r * 0.15, z - nz * r * 0.3 + Math.sin(a) * r * 0.2, Math.cos(a) * sp - nx * r, R(0.4, 1.2) * (0.6 + r), Math.sin(a) * sp - nz * r,
        R(0.35, 0.55) * (0.85 + w * 0.2), r * R(0.6, 0.85), r * R(1.4, 1.9), R(-1, 1), 4, 0, 1 + (i & 1), RAMPS.fireball, h * (0.6 + 0.4 * kq));
    }
    const ns = this.lodN(1 + Math.round(w * 2));
    for (let i = 0; i < ns; i++) this.puff(x - nx * r * 0.4, y + r * 0.3, z - nz * r * 0.4, R(-0.25, 0.25) - nx * 0.4 + WIND_X, R(0.5, 1.0), R(-0.25, 0.25) - nz * 0.4 + WIND_Z, R(1.2, 2.2), r * 0.6, r * 2.4, R(-0.4, 0.4), 1.1, 0, 1 + (i & 1), RAMPS.blastSmoke);
    if (w > 0.7 && !air) this.rings.add(x, z, Math.max(0.06, y - 0.2), r * 0.4, r * 2.6, 0.22, 0.4 * h * kq, 0.36 * h * kq, 0.3 * h * kq);
  }

  /** a heavy gun's muzzle blast slapping the ground under the barrel: a dust ring shoved out (mostly forward) and a
   *  faint shock ring; s = gun size */
  gunDust(x: number, z: number, nx: number, nz: number, s: number): void {
    const n = this.lodN(6 + Math.round(s * 8));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + Math.random() * 0.4, c = Math.cos(a), sn = Math.sin(a);
      const fw = 1 + 1.4 * Math.max(0, c * nx + sn * nz), sp = R(2.2, 4) * s * fw;
      this.puff(x + c * s * 0.3, 0.1, z + sn * s * 0.3, c * sp, R(0.1, 0.5), sn * sp, R(0.6, 1.2), s * 0.35, s * 1.3, R(-1, 1), 3.4, 0, 1 + (i & 1), this.dust);
    }
    this.rings.add(x, z, 0.07, s * 0.3, s * 2.4, 0.25, 0.3 * this.hdr, 0.28 * this.hdr, 0.24 * this.hdr);
  }

  /* ------------------------------------------------------------------------------------------- explosions */

  /** Explosion scaled by radius r (cells): a short white flash, a few big lobed flipbook fireballs that roll over into
   *  dark soot, a column of sun-lit smoke that lingers and drifts, a ground-hugging dust shove, long hot spark streaks,
   *  one crisp shock ring, chunky tumbling debris (in `paint` where a hull blew up) and a soft scorch. r > 3.2 (titan
   *  deaths, nukes) adds a rising fire column and a slow wide dust wave. style picks the palette. */
  /** air: it went off in the air (a round striking an aircraft, an aircraft blowing up): no light pool, dust, shock ring
   *  or scorch on the ground */
  explosion(x: number, z: number, r: number, style: 'fire' | 'plasma' | 'emp' = 'fire', y = 0, debris = true, q = 1, paint?: readonly [number, number, number], air = false): void {
    r = clamp(r, 0.3, 9);
    const lodN = (n: number) => this.lodN(n * q);
    const fire = style === 'plasma' ? RAMPS.plasma : style === 'emp' ? RAMPS.emp : RAMPS.fireball;
    const cy = y + 0.1 + r * 0.3;
    const kq = 1 / (1 + this.heat * 0.3);
    this.heat += 1;
    const h = this.hdr;
    this.add.emit(x, cy, z, 0, 0, 0, 0.09, r * 1.5, r * 1.1, 0, 0, 0, 0, RAMPS.flash, h * kq);
    // white-hot starburst: a flare and radial spikes that snap out and vanish, then a warm glow that lingers
    if (q >= 0.7) {
      this.add.emit(x, cy, z, 0, 0, 0, 0.13, r * 1.9, r * 1.1, 0, 0, 0, 4, RAMPS.flash, h * kq);
      const nsp = lodN(8 + Math.round(r * 4));
      for (let i = 0; i < nsp; i++) {
        const a = (i / nsp) * 6.283 + R(-0.2, 0.2), e = R(0.15, 1.2), sp = R(14, 24) * (0.6 + r * 0.25);
        this.add.emit(x, cy, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp, R(0.08, 0.14), 0.12 + r * 0.04, 0.05, 0, 6, 0, 3, RAMPS.flash, h * kq);
      }
    }
    this.add.emit(x, cy, z, 0, 0.3, 0, 0.4, r * 1.3, r * 1.7, 0, 0, 0, 0, RAMPS.fire, h * 0.22 * kq);
    if (style === 'fire') this.firebrands(x, cy, z, lodN(3 + Math.round(r * 4)), r);
    if (!air) this.pools.add(x, z, y + 0.04, r * 1.0, r * 2.3, 0.42, 0.85 * h * kq, 0.42 * h * kq, 0.12 * h * kq);
    // fireball: lobed flipbook puffs that expand, cool from the outside in and roll over into soot
    const nf = lodN(3 + Math.round(r * 2.2));
    for (let i = 0; i < nf; i++) {
      const a = Math.random() * 6.283, d = r * 0.38 * Math.sqrt(Math.random()), sp = r * R(0.5, 1.5);
      this.fire.emit(x + Math.cos(a) * d, cy + R(-0.15, 0.35) * r, z + Math.sin(a) * d, Math.cos(a) * sp * 0.5, R(0.3, 1.1) * r * 0.7 + 0.3, Math.sin(a) * sp * 0.5,
        R(0.8, 1.25) * (0.85 + r * 0.08), r * R(0.9, 1.3), r * R(1.9, 2.6), R(-0.4, 0.4), 2.2, 0.35, 1 + (i & 1), fire, h * (0.6 + 0.4 * kq));
    }
    // smoke column: fades in as the fire dies, rises, spreads and drifts off with the breeze
    const ns = lodN(1 + Math.round(r * 0.8));
    for (let i = 0; i < ns; i++) {
      const a = Math.random() * 6.283, d = Math.random() * r * 0.45;
      this.alpha.emit(x + Math.cos(a) * d, cy + R(0, 0.4) * r, z + Math.sin(a) * d, R(-0.3, 0.3) + WIND_X * 2, R(0.6, 1.3) + r * 0.2, R(-0.3, 0.3) + WIND_Z * 2,
        R(2.6, 4.4) * (0.8 + r * 0.1), r * R(0.7, 0.95), r * R(2.2, 3.2), R(-0.25, 0.25), 0.6, 0.12, 1 + (i & 1), style === 'fire' ? RAMPS.blastSmoke : RAMPS.smokeLight);
    }
    // ground-hugging dust shove
    const nd = air ? 0 : lodN(4 + Math.round(r * 3));
    for (let i = 0; i < nd; i++) {
      const a = (i / nd) * 6.283 + Math.random() * 0.4, sp = r * R(2.2, 4.2);
      this.puff(x, 0.14, z, Math.cos(a) * sp, R(0, 0.4), Math.sin(a) * sp, R(0.8, 1.4), r * 0.45, r * 1.3, R(-0.5, 0.5), 3.4, 0, 1 + (i & 1), this.dust);
    }
    // a tan dust dome billowing out around the fireball (not thinned like the puffs, so it reads behind the fire)
    const nm = air || q < 0.7 ? 0 : lodN(3 + Math.round(r * 1.5));
    for (let i = 0; i < nm; i++) {
      const a = (i / nm) * 6.283 + Math.random() * 0.5, sp = r * R(1.6, 2.6);
      this.alpha.emit(x + Math.cos(a) * r * 0.3, 0.2 + r * 0.25, z + Math.sin(a) * r * 0.3, Math.cos(a) * sp, R(0.3, 0.9), Math.sin(a) * sp, R(1.1, 1.7), r * 0.9, r * 2.1, R(-0.3, 0.3), 2.6, 0, 1 + (i & 1), this.dust);
    }
    // hot spark streaks flung out in every direction
    const nk = lodN(10 + Math.round(r * 8));
    for (let i = 0; i < nk; i++) {
      const a = Math.random() * 6.283, e = R(0.1, 1.3), sp = R(4, 11) + r * 2;
      this.add.emit(x, cy, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 1, Math.sin(a) * Math.cos(e) * sp, R(0.35, 0.8), 0.06 + r * 0.02, 0.03, 0, 0.7, -9, 3, RAMPS.spark, h);
    }
    // one crisp shock ring, quick (secondary blasts of a chain don't add their own)
    if (q >= 1 && !air) this.rings.add(x, z, y + 0.07, r * 0.35, r * 2.4, 0.24 + r * 0.03, 0.6 * h * kq, 0.56 * h * kq, 0.5 * h * kq);
    if (debris) {
      const nc = this.lodN(3 + Math.round(r * 2));
      for (let i = 0; i < nc; i++) {
        const a = Math.random() * 6.283, sp = R(1.5, 4.5) + r * 1.2;
        this.debris.add(x, cy, z, Math.cos(a) * sp, R(4, 9) + r * 0.7, Math.sin(a) * sp, R(0.08, 0.18) * (0.7 + r * 0.3), paintChip(paint, this.dirtRgb), Math.random() < 0.6 ? R(0.5, 1) : 0);
      }
    }
    if (r > 3.2) {
      // titan-scale: a column of fire climbing out of the blast and a slow, wide dust wave
      const nc = lodN(5 + Math.round(r));
      for (let i = 0; i < nc; i++) {
        const k = i / nc;
        this.fire.emit(x + R(-0.3, 0.3) * r * 0.3, cy + k * r * 0.5, z + R(-0.3, 0.3) * r * 0.3, R(-0.2, 0.2), R(1.2, 2.2) + k * r * 0.5, R(-0.2, 0.2),
          R(1.3, 1.9), r * R(0.4, 0.6), r * R(1.0, 1.4), R(-0.3, 0.3), 1.0, 0.1, 1 + (i & 1), fire, h * kq);
        this.puff(x, cy + k * r * 0.6, z, R(-0.3, 0.3) + WIND_X * 2, R(1.2, 2.2) + k * r * 0.4, R(-0.3, 0.3) + WIND_Z * 2, R(4, 6), r * 0.5, r * R(1.6, 2.4), R(-0.2, 0.2), 0.5, 0.05, 1 + (i & 1), RAMPS.blastSmoke);
      }
      const nw = air ? 0 : lodN(10 + Math.round(r * 2));
      for (let i = 0; i < nw; i++) {
        const a = (i / nw) * 6.283 + Math.random() * 0.3, sp = r * R(1.6, 2.4);
        this.puff(x + Math.cos(a) * r * 0.5, 0.2, z + Math.sin(a) * r * 0.5, Math.cos(a) * sp, R(0.2, 0.6), Math.sin(a) * sp, R(2, 3), r * 0.4, r * 1.2, R(-0.3, 0.3), 1.4, 0, 1 + (i & 1), this.dust);
      }
      if (!air) this.rings.add(x, z, y + 0.08, r * 0.6, r * 3.6, 0.8, 0.22 * h, 0.2 * h, 0.17 * h);
    }
    if (!air) this.addScorch(x, z, r * R(1.0, 1.35));
    this.trauma = Math.min(1, this.trauma + 0.05 + r * 0.07);
    if (r > 3.2) this.flashA = Math.min(1, this.flashA + Math.min(0.55, (r - 3) * 0.14));
  }

  /** n burning chunks flung out of a blast of radius r: they arc, bounce once or twice and burn out (see update) */
  private firebrands(x: number, y: number, z: number, n: number, r: number): void {
    for (let i = 0; i < n && this.brands.length < 160; i++) {
      const a = Math.random() * 6.283, sp = R(2.5, 6.5) + r * 1.4;
      const life = R(0.7, 1.5);
      this.brands.push([x, y, z, Math.cos(a) * sp, R(2.5, 6.5) + r * 0.8, Math.sin(a) * sp, life, life, (0.1 + r * 0.05) * R(0.7, 1.3), Math.random()]);
    }
  }

  /** multi-stage blast for big hulls: chain of secondaries, a rolling fireball and a final cook-off */
  bigExplosion(x: number, z: number, size: number, y = 0, paint?: readonly [number, number, number], air = false): void {
    const r = 0.6 + size * 0.7;
    this.explosion(x, z, r, 'fire', y, true, 1, paint, air);
    const stages = Math.min(8, Math.max(0, size - 1) * 2);
    for (let i = 0; i < stages; i++) {
      const t = 0.12 + i * 0.17 + R(0, 0.1);
      const a = Math.random() * 6.283, d = Math.random() * size * 0.45;
      this.later.push({ t: this.time + t, fn: () => this.explosion(x + Math.cos(a) * d, z + Math.sin(a) * d, r * R(0.4, 0.75), 'fire', y, true, 0.7, paint, air) });
    }
    if (size >= 4) {
      this.later.push({ t: this.time + 0.25 + stages * 0.17, fn: () => { this.explosion(x, z, r * 1.25, 'fire', y, true, 1, paint, air); this.trauma = Math.min(1, this.trauma + 0.35); this.flashA = Math.min(1, this.flashA + 0.45); } });
    }
  }

  /** A hull blown apart (wreck level 2-3): n pieces of scrap up to `reach` cells out that stay on the field, plus a
   *  shower of short-lived fragments. hot: share of glowing (melted) pieces for energy kills. paint: the hull's team
   *  colour (scraps and fragments show it, scorched). */
  scatter(x: number, z: number, y: number, n: number, reach: number, size: number, hot = 0, paint?: readonly [number, number, number]): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, d = reach * Math.sqrt(Math.random()), s = size * R(0.35, 1);
      const melt = Math.random() < hot;
      const tone = melt ? R(0.45, 0.7) : R(0.05, 0.14);
      const rgb = !melt && paint && Math.random() < 0.4 ? _scrapRgb.setRGB(paint[0] * 0.2 + 0.03, paint[1] * 0.2 + 0.03, paint[2] * 0.2 + 0.03) : null;
      this.scrap.add(x + R(-0.3, 0.3) * size, y + R(0.2, 0.6), z + R(-0.3, 0.3) * size, a, d, s, tone, Math.random() < 0.55, rgb);
      if (melt) this.add.emit(x, y + 0.3, z, Math.cos(a) * d * 1.4, R(3, 6), Math.sin(a) * d * 1.4, R(0.6, 1.2), 0.12 + s * 0.3, 0.03, 0, 0.6, -10, 3, RAMPS.ember, this.hdr);
    }
    const nc = this.lodN(n);
    for (let i = 0; i < nc; i++) {
      const a = Math.random() * 6.283, sp = R(2, 5) + reach;
      this.debris.add(x, y + 0.4, z, Math.cos(a) * sp, R(5, 10), Math.sin(a) * sp, size * R(0.3, 0.7), paintChip(paint, this.dirtRgb), Math.random() < 0.5 + hot * 0.5 ? R(0.6, 1) : 0);
    }
  }
  /** blackened ground under a wreck / where a unit was vaporised */
  scorchMark(x: number, z: number, r: number): void { this.addScorch(x, z, r); }

  private addScorch(x: number, z: number, r: number): void {
    const i = this.scorchN % 256;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(_up, Math.random() * 6.28);
    m.compose(new THREE.Vector3(x, 0.02 + (i % 7) * 0.0004, z), q, new THREE.Vector3(r * 1.5 * R(0.85, 1.15), 1, r * 1.5));
    m.toArray(this.scorch.instanceMatrix.array as unknown as number[], i * 16);
    this.scorchT[i] = this.time;
    this.scorchN++;
    this.scorch.count = Math.min(256, this.scorchN);
    this.scorch.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------------------------------------------------------------------------ update */

  update(dt: number): void {
    this.time += dt;
    // endless battles: scorch marks older than scorchLife are folded away (zero scale) every couple of seconds
    if (this.scorchLife !== Infinity && (this.scorchSweep -= dt) <= 0) {
      this.scorchSweep = 2;
      const arr = this.scorch.instanceMatrix.array as Float32Array;
      let any = false;
      for (let i = 0; i < this.scorch.count; i++) {
        if (this.time - this.scorchT[i] < this.scorchLife || arr[i * 16] === 0) continue;
        for (let j = 0; j < 16; j++) arr[i * 16 + j] = 0;
        any = true;
      }
      if (any) this.scorch.instanceMatrix.needsUpdate = true;
    }
    this.heat = Math.max(0, this.heat - dt * 4);
    for (let i = this.later.length - 1; i >= 0; i--) if (this.later[i].t <= this.time) { const f = this.later[i].fn; this.later.splice(i, 1); f(); }
    // rising flames over the patches share one budget, so a carpet of 160 napalm patches stays affordable
    let area = 0;
    for (const f of this.fields) area += 4 + f.r * f.r * 7;
    const share = Math.min(1, 700 / Math.max(1, area));
    for (let i = this.fields.length - 1; i >= 0; i--) {
      const f = this.fields[i];
      f.left -= dt; f.age += dt;
      if (f.left <= 0) { this.fields.splice(i, 1); continue; }
      // flare up on landing, burn steadily, gutter out over the last second
      const fade = Math.min(1, f.left / 1.2) * (0.8 + 0.4 * Math.max(0, 1 - f.age / 0.5));
      f.k = fade * Math.min(1, f.age / 0.12);
      f.acc += dt * (4 + f.r * f.r * 7) * share * this.lod * (0.4 + 0.6 * fade);
      while (f.acc >= 1) {
        f.acc--;
        const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * f.r;
        const px = f.x + Math.cos(a) * d, pz = f.z + Math.sin(a) * d, edge = 1 - (d / f.r) * 0.45;
        this.fire.emit(px, 0.06, pz, R(-0.15, 0.15), R(0.7, 1.5) * edge, R(-0.15, 0.15), R(0.35, 0.7), R(0.22, 0.4) * (0.6 + 0.4 * fade) * edge, R(0.08, 0.16), R(-2, 2), 1.2, 0.4, 1 + (Math.random() < 0.5 ? 1 : 0), RAMPS.flame, this.hdr);
        if (Math.random() < 0.18) this.puff(px, 0.5, pz, R(-0.1, 0.1), R(0.6, 1.2), R(-0.1, 0.1), R(1.4, 2.4), 0.25, 0.9, R(-0.5, 0.5), 0.4, 0, 1 + (Math.random() < 0.5 ? 1 : 0), RAMPS.smoke);
        if (Math.random() < 0.1) this.add.emit(px, 0.2, pz, R(-0.4, 0.4), R(1, 2.5), R(-0.4, 0.4), R(0.5, 1), 0.04, 0.02, 0, 0.5, 0.5, 3, RAMPS.ember, this.hdr);
      }
    }
    this.groundFire.set(this.fields, this.time, this.hdr);
    for (let i = this.radZones.length - 1; i >= 0; i--) {
      const f = this.radZones[i];
      f.left -= dt;
      if (f.left <= 0) { this.radZones.splice(i, 1); continue; }
      const fade = Math.min(1, f.left / 3);
      f.acc += dt * (6 + f.r * f.r * 2.5) * this.lod * fade;
      while (f.acc >= 1) {
        f.acc--;
        const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * f.r;
        const px = f.x + Math.cos(a) * d, pz = f.z + Math.sin(a) * d;
        // glowing motes drifting up, a low green haze, the odd bright crackle
        this.add.emit(px, 0.1, pz, R(-0.1, 0.1), R(0.3, 0.9), R(-0.1, 0.1), R(1.2, 2.4), R(0.05, 0.1), 0.02, 0, 0.2, 0.3, 3, RAMPS.rad, this.hdr);
        if (Math.random() < 0.25) this.alpha.emit(px, 0.3, pz, R(-0.15, 0.15), R(0.05, 0.25), R(-0.15, 0.15), R(2, 3.5), R(0.6, 1.1), R(1.4, 2.2), R(-0.3, 0.3), 0.3, 0, 1 + (Math.random() < 0.5 ? 1 : 0), RAMPS.radHaze);
      }
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.left -= dt;
      if (s.left <= 0) { this.smokes.splice(i, 1); continue; }
      s.acc += dt * (8 + s.r * 4) * this.lod;
      while (s.acc >= 1) {
        s.acc--;
        const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * s.r;
        this.alpha.emit(s.x + Math.cos(a) * d, R(0.15, 0.6), s.z + Math.sin(a) * d, R(-0.2, 0.2), R(0.05, 0.25), R(-0.2, 0.2), R(1.5, 2.6), s.r * 0.3, s.r * 0.55, R(-0.4, 0.4), 0.3, 0, 1 + (Math.random() < 0.5 ? 1 : 0), RAMPS.screen);
      }
    }
    for (let i = this.brands.length - 1; i >= 0; i--) {
      const b = this.brands[i];
      b[6] -= dt;
      if (b[6] <= 0) { this.brands[i] = this.brands[this.brands.length - 1]; this.brands.pop(); continue; }
      b[4] -= 11 * dt;
      const dr = Math.exp(-0.8 * dt);
      b[3] *= dr; b[5] *= dr;
      b[0] += b[3] * dt; b[1] += b[4] * dt; b[2] += b[5] * dt;
      if (b[1] < 0.05) { b[1] = 0.05; b[4] = b[4] < -1.5 ? -b[4] * 0.3 : 0; b[3] *= 0.5; b[5] *= 0.5; }
      const k = Math.min(1, b[6] / (b[7] * 0.6)), s = b[8] * (0.4 + 0.6 * k);
      // the hot head (one short-lived glow per frame), flame shed behind it, a thin pale smoke streak
      this.add.emit(b[0], b[1], b[2], 0, 0, 0, 0.05, s * 2.2, s * 2, 0, 0, 0, 0, RAMPS.fire, this.hdr * (0.5 + 0.5 * k));
      b[9] += dt * 50 * this.lod;
      while (b[9] >= 1) {
        b[9]--;
        this.fire.emit(b[0], b[1], b[2], R(-0.2, 0.2), R(0.2, 0.6), R(-0.2, 0.2), R(0.15, 0.28), s * 1.6, s * 0.4, R(-2, 2), 1, 0, 1 + (Math.random() < 0.5 ? 1 : 0), RAMPS.flame, this.hdr * (0.4 + 0.6 * k));
        this.alpha.emit(b[0], b[1], b[2], WIND_X * 0.5, R(0.05, 0.2), WIND_Z * 0.5, R(0.4, 0.75), s * 0.8, s * 1.8, R(-0.5, 0.5), 0.5, 0, 1, RAMPS.exhaustSmoke);
      }
    }
    this.add.update(dt);
    this.fire.update(dt);
    this.alpha.update(dt);
    this.rings.update(dt);
    this.aoe.update(dt);
    this.pools.update(dt);
    this.debris.update(dt);
    this.scrap.update(dt);
    this.rails.update(dt);
    // bolts: rebuilt each frame; lightning re-rolls its jag every 45 ms
    this.beams.begin();
    const tmp: number[] = [];
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const f = this.bolts[i];
      f.life -= dt;
      if (f.life <= 0) { this.bolts.splice(i, 1); continue; }
      const k = f.life / f.max, a = k < 0.5 ? k * 2 : 1;
      if (f.kind === 'beam') {
        const w = f.w * (1 + (f.wob ? Math.sin(this.time * 55 + i) * f.wob : 0)) * (0.6 + 0.4 * a);
        const k = a * this.hdr;
        // a pulse: the head shoots out to b, then the channel fades from the emitter end
        const g = f.grow ? Math.min(1, (f.max - f.life) / f.grow) : 1;
        const t0 = f.grow && g >= 1 ? Math.max(0, 1 - f.life / (f.max - f.grow)) * 0.85 : 0;
        const ex = f.ax + (f.bx - f.ax) * g, ey = f.ay + (f.by - f.ay) * g, ez = f.az + (f.bz - f.az) * g;
        const sx = f.ax + (f.bx - f.ax) * t0, sy = f.ay + (f.by - f.ay) * t0, sz = f.az + (f.bz - f.az) * t0;
        this.beams.seg(sx, sy, sz, ex, ey, ez, w * 2.4, (0.04 + f.r * 1.2) * k, (0.04 + f.g * 1.2) * k, (0.04 + f.b * 1.2) * k, f.grow ? 1 : 0, f.core ?? 1.8);
      } else {
        const roll = Math.floor((f.max - f.life) / 0.045);
        if (roll !== f.roll) { f.roll = roll; jag(f, mulberry(f.seed + roll * 7919), f.pts); }
        const p = f.pts;
        for (let j = 0; j + 5 < p.length; j += 6) {
          const main = j < 16 * 6 && j / 6 < clamp(Math.round(Math.hypot(f.bx - f.ax, f.by - f.ay, f.bz - f.az) / 0.45), 4, 16);
          const w = main ? f.w : f.w * 0.6;
          const k = a * this.hdr;
          this.beams.seg(p[j], p[j + 1], p[j + 2], p[j + 3], p[j + 4], p[j + 5], w * 2.6, (0.2 + f.r * 1.6) * k, (0.2 + f.g * 1.6) * k, (0.2 + f.b * 1.6) * k, 0, 1.4);
        }
      }
    }
    void tmp;
    this.beams.end();
  }

  dispose(): void {
    this.disposed = true;
    this.add.dispose(); this.fire.dispose(); this.alpha.dispose(); this.groundFire.dispose();
    this.atlas.dispose();
  }
}

const _col = new THREE.Color();
