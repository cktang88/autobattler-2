// Sun shadow map fitting for the battle camera.
//
// One directional shadow map covers exactly the ground the camera can see (plus the unit tops standing on it), rather
// than a square around the view centre: the perspective camera sees a trapezoid, and the light looks at it at an angle,
// so the bounds are taken in LIGHT space from the visible region's corners. The light itself never moves (fixed eye and
// direction for the whole match): only the orthographic bounds change, and they are snapped to whole shadow-map texels
// with their size quantised to quarter-octave steps. A shadow edge therefore sits on the same texel boundary frame after
// frame while the camera glides, pans or turns (no shimmering / crawling edges); the texel size only changes when the
// zoom crosses a step.
//
// Pure math (no renderer state) so it is unit-testable: `lightBasis` + `fitLightBounds`.

import * as THREE from 'three';

export type V3 = [number, number, number];

export interface LightBasis {
  /** light eye (world) */
  eye: V3;
  /** light-space axes in world coordinates (three.js camera convention: looks down -z, up ~ +y) */
  x: V3; y: V3; z: V3;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The basis three.js builds for a light at `eye` looking at `target` (Object3D.lookAt on a camera, up = +y). */
export function lightBasis(eye: V3, target: V3): LightBasis {
  const z = norm([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  let x = cross([0, 1, 0], z);
  if (Math.hypot(x[0], x[1], x[2]) < 1e-6) x = [1, 0, 0];
  x = norm(x);
  const y = cross(z, x);
  return { eye, x, y, z };
}

export interface LightBounds {
  left: number; right: number; bottom: number; top: number; near: number; far: number;
  /** world size of one shadow-map texel along the light's x / y */
  texelX: number; texelY: number;
}

/** quantise a size up to the next quarter-octave step (so the texel size only changes in ~19% jumps) */
export function quantSize(s: number): number {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(1e-3, s)) * 4) / 4);
}

/**
 * Orthographic bounds (light space) that hold every point in `pts` (flat x,y,z triplets, world), snapped to the texel
 * grid of a `mapSize` shadow map. `reach` extends the near plane toward the sun so casters taller than the fitted
 * points (titans, aircraft) still land in the map; `pad` (world units) widens the box a little on every side.
 */
export function fitLightBounds(pts: ArrayLike<number>, b: LightBasis, mapSize: number, reach = 30, pad = 1): LightBounds {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i + 2 < pts.length; i += 3) {
    const p: V3 = [pts[i] - b.eye[0], pts[i + 1] - b.eye[1], pts[i + 2] - b.eye[2]];
    const lx = dot(p, b.x), ly = dot(p, b.y), lz = -dot(p, b.z);
    if (lx < x0) x0 = lx; if (lx > x1) x1 = lx;
    if (ly < y0) y0 = ly; if (ly > y1) y1 = ly;
    if (lz < z0) z0 = lz; if (lz > z1) z1 = lz;
  }
  if (!(x1 >= x0)) { x0 = y0 = -1; x1 = y1 = 1; z0 = 1; z1 = 2; }
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  // size: quantised with room for the snap (one texel either side)
  const w = quantSize((x1 - x0) * 1.02 + 0.25), h = quantSize((y1 - y0) * 1.02 + 0.25);
  const tx = w / mapSize, ty = h / mapSize;
  // centre the box on the region, then snap its corner to the texel grid (fixed light eye => a fixed grid in the world)
  const left = Math.floor(((x0 + x1) / 2 - w / 2) / tx) * tx;
  const bottom = Math.floor(((y0 + y1) / 2 - h / 2) / ty) * ty;
  // depth: quantised too (a 4-unit grid), so the depth bias does not breathe as the view moves
  const near = Math.max(0.5, Math.floor((z0 - reach) / 4) * 4), far = Math.ceil((z1 + 2) / 4) * 4;
  return { left, right: left + w, bottom, top: bottom + h, near, far, texelX: tx, texelY: ty };
}

/** Owns the sun's shadow camera: fixed eye, per-frame snapped bounds, PCF softness kept roughly constant in world units. */
export class SunShadow {
  readonly sun: THREE.DirectionalLight;
  private basis: LightBasis;
  private key = '';
  /** penumbra width (world cells) the PCF kernel aims for */
  soft = 0.07;
  mapSize = 2048;

  /** `toSun`: direction to the sun (any length); `anchor`: a fixed point near the field centre the light looks at */
  constructor(sun: THREE.DirectionalLight, toSun: V3, anchor: V3, dist = 160) {
    this.sun = sun;
    const d = norm(toSun);
    const eye: V3 = [anchor[0] + d[0] * dist, anchor[1] + d[1] * dist, anchor[2] + d[2] * dist];
    this.basis = lightBasis(eye, anchor);
    sun.position.set(eye[0], eye[1], eye[2]);
    sun.target.position.set(anchor[0], anchor[1], anchor[2]);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
  }

  /** shadow map resolution (re-allocates the map when it changes) */
  setMapSize(n: number): void {
    if (n === this.mapSize && this.sun.shadow.mapSize.x === n) return;
    this.mapSize = n;
    this.sun.shadow.mapSize.set(n, n);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.key = '';
  }

  /** fit to the visible region (world x,y,z triplets); returns true when the bounds changed */
  fit(pts: ArrayLike<number>): boolean {
    const b = fitLightBounds(pts, this.basis, this.mapSize);
    const key = `${b.left},${b.right},${b.bottom},${b.top},${b.near},${b.far}`;
    if (key === this.key) return false;
    this.key = key;
    const c = this.sun.shadow.camera;
    c.left = b.left; c.right = b.right; c.bottom = b.bottom; c.top = b.top; c.near = b.near; c.far = b.far;
    c.updateProjectionMatrix();
    const s = this.sun.shadow;
    // PCF kernel radius is in texels: aim for a fixed world-space penumbra, within what 5 taps can cover cleanly
    s.radius = THREE.MathUtils.clamp(this.soft / Math.max(b.texelX, b.texelY), 1, 3.2);
    // depth bias is in [0, 1] depth units: keep it ~0.04 world units whatever the depth range
    s.bias = -0.04 / Math.max(1, b.far - b.near);
    // normal offset in world units: about a texel and a half (acne on curved hull plates), never less than a hair
    s.normalBias = THREE.MathUtils.clamp(Math.max(b.texelX, b.texelY) * 1.5, 0.008, 0.06);
    return true;
  }
}
