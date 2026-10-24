// Pure maths for the garage's 3D unit stage (UnitStage3D): which preview to use, the orbit camera, and projecting mount
// points to the screen for the socket overlay. No three.js / DOM, so it is unit-testable (test/stage3d.test.ts).
//
// The orbit camera follows the battlefield camera's conventions (render/camera.ts, FieldView3D.placeCamera):
//   * k = CSS px per cell at the look-at point; the camera sits at the distance where that holds for FOV
//   * yaw turns the view about the look-at point (0 = looking "up" the field, as the side-0 player does)
//   * pitch eases from 60 deg (zoomed out) to 43 deg (zoomed in) with the zoom (view3d.pitchAt), and the player can tilt
//     it within that same range by dragging vertically
//   * exponential easing at the battle camera's rate, drag orbit at its speed (ORBIT_RAD_PER_PX)

import { ELEV, ELEV_CLOSE, FOV, pitchAt } from './view3d.ts';

export type StageMode = '2d' | '3d';

/** The designer shows the unit in 3D when the battlefield does (Settings.renderer) and WebGL works; otherwise the classic
 *  2D blueprint. A 3D stage that failed to start (or lost its context) also falls back to 2D. */
export function stageMode(renderer: string | undefined, webgl: boolean, failed = false): StageMode {
  return renderer === '3d' && webgl && !failed ? '3d' : '2d';
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** a - b wrapped into -PI..PI */
const angleDiff = (a: number, b: number) => { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI; return d; };

/** zoom range relative to the fit view (same as the 2D blueprint) */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 5;
/** battle camera: right-drag orbit speed (render/camera.ts ORBIT_RAD_PER_PX) and easing rate (Camera.smooth) */
export const ORBIT_RAD_PER_PX = 0.004;
export const SMOOTH = 13;
/** default turn: a three-quarter view of the unit's front right (the sun-lit nose and the flank in its shade, for form) */
export const DEFAULT_YAW = -(Math.PI - 0.75);

/** Zoom-dependent pitch: the battlefield's pitch curve over the designer's zoom range (60 deg zoomed out, ~50 deg at the
 *  fit view, 43 deg from ~1.75x in). */
export const stagePitch = (zoom: number) => pitchAt(zoom / ZOOM_MIN);

export type V3 = [number, number, number];

export class OrbitCam {
  yaw = DEFAULT_YAW;
  tyaw = DEFAULT_YAW;
  zoom = 1;
  tzoom = 1;
  /** player tilt on top of the zoom pitch (radians) */
  tilt = 0;
  ttilt = 0;
  /** px per cell of the fit view (follows the unit's size) */
  fitK = 60;
  tfitK = 60;
  /** pan of the look-at point (cells, world x / z) */
  px = 0; pz = 0; tpx = 0; tpz = 0;
  /** pan limit (cells from the unit) */
  panMax = 3;

  get k(): number { return this.fitK * this.zoom; }
  /** pitch now (radians), always inside the battlefield's range */
  pitch(): number { return clamp(stagePitch(this.zoom) + this.tilt, ELEV_CLOSE, ELEV); }

  /** drag orbit: horizontal turns (battle orbit speed), vertical tilts within the pitch range; immediate, like the
   *  battle camera's direct manipulation */
  orbit(dx: number, dy: number): void {
    this.yaw = this.tyaw = angleDiff(this.yaw + dx * ORBIT_RAD_PER_PX, 0);
    const base = stagePitch(this.zoom);
    this.tilt = this.ttilt = clamp(this.tilt + dy * ORBIT_RAD_PER_PX, ELEV_CLOSE - base, ELEV - base);
  }
  /** eased turn by da (keys / buttons) */
  turnBy(da: number): void { this.tyaw = angleDiff(this.tyaw + da, 0); }
  zoomBy(f: number): void { this.tzoom = clamp(this.tzoom * f, ZOOM_MIN, ZOOM_MAX); }
  setZoom(z: number): void { this.tzoom = clamp(z, ZOOM_MIN, ZOOM_MAX); }
  /** move the look-at point by a screen drag (px): the ground under the pointer follows it */
  panBy(dx: number, dy: number): void {
    const k = this.k, e = this.pitch();
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // screen right = (cy, 0, sy), screen down on the ground = (-sy, 0, cy) (foreshortened by sin(pitch))
    const u = -dx / k, v = -dy / (k * Math.max(0.2, Math.sin(e)));
    this.tpx = this.px = clamp(this.px + u * cy - v * sy, -this.panMax, this.panMax);
    this.tpz = this.pz = clamp(this.pz + u * sy + v * cy, -this.panMax, this.panMax);
  }
  /** eased return to the default view (double-click / Fit) */
  reset(): void { this.tyaw = DEFAULT_YAW; this.tzoom = 1; this.ttilt = 0; this.tpx = this.tpz = 0; }
  recentre(): void { this.tpx = this.tpz = 0; }
  /** snap every eased value to its target */
  settle(): void { this.yaw = this.tyaw; this.zoom = this.tzoom; this.tilt = this.ttilt; this.fitK = this.tfitK; this.px = this.tpx; this.pz = this.tpz; }

  /** Advance the easing; true while anything moved. */
  update(dt: number): boolean {
    dt = clamp(dt, 0, 0.1);
    const f = 1 - Math.exp(-dt * SMOOTH);
    let moving = false;
    const dy = angleDiff(this.tyaw, this.yaw);
    if (Math.abs(dy) > 1e-4) { this.yaw = angleDiff(this.yaw + dy * f, 0); moving = true; } else this.yaw = this.tyaw;
    const ez = (a: number, b: number): number => {
      const la = Math.log(a), lb = Math.log(b);
      if (Math.abs(lb - la) > 0.0005) { moving = true; return Math.exp(la + (lb - la) * f); }
      return b;
    };
    this.zoom = ez(this.zoom, this.tzoom);
    this.fitK = ez(this.fitK, this.tfitK);
    const lin = (a: number, b: number, eps: number): number => {
      if (Math.abs(b - a) > eps) { moving = true; return a + (b - a) * f; }
      return b;
    };
    this.tilt = lin(this.tilt, this.ttilt, 1e-4);
    this.px = lin(this.px, this.tpx, 1e-3);
    this.pz = lin(this.pz, this.tpz, 1e-3);
    // the tilt range moves with the zoom pitch: keep the result inside 43..60 deg
    const base = stagePitch(this.zoom);
    this.tilt = clamp(this.tilt, ELEV_CLOSE - base, ELEV - base);
    this.ttilt = clamp(this.ttilt, ELEV_CLOSE - base, ELEV - base);
    return moving;
  }

  /** camera distance for the current k in a viewport `cssH` px tall */
  distance(cssH: number): number { return cssH / (2 * this.k * Math.tan((FOV * Math.PI) / 360)); }

  /** Camera position and up vector looking at `target` (FieldView3D.placeCamera for the side-0 viewer). */
  pose(cssH: number, target: V3): { pos: V3; up: V3; D: number } {
    const D = this.distance(cssH), e = this.pitch();
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const t: V3 = [target[0] + this.px, target[1], target[2] + this.pz];
    return { pos: [t[0] - sy * D * Math.cos(e), t[1] + D * Math.sin(e), t[2] + cy * D * Math.cos(e)], up: [sy, 0, -cy], D };
  }
}

/** px per cell that fits a unit `ext` cells across into the smaller viewport edge (the 2D blueprint's fit) */
export const fitK = (w: number, h: number, ext: number) => Math.max(1, Math.min(w, h)) / Math.max(0.5, ext);

/** Project a world point through a column-major view-projection matrix (three.js Matrix4.elements) to CSS px.
 *  `w` is the clip w (view depth); w <= 0 = behind the camera. */
export function project(m: ArrayLike<number>, p: V3, cssW: number, cssH: number): { x: number; y: number; w: number } {
  const [x, y, z] = p;
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  const iw = cw !== 0 ? 1 / cw : 0;
  return { x: (cx * iw + 1) * 0.5 * cssW, y: (1 - cy * iw) * 0.5 * cssH, w: cw };
}

/** on-screen radius (CSS px) of a sphere of world radius r at view depth `depth` (perspective, vertical FOV in degrees) */
export function radiusPx(r: number, depth: number, cssH: number, fovDeg = FOV): number {
  if (depth <= 1e-6) return 0;
  return (r * cssH) / (2 * depth * Math.tan((fovDeg * Math.PI) / 360));
}

/** Hull-local mount point (x forward, y right, h up; cells, template scale) -> world for a unit at `pos` facing `ang`
 *  (battlefield angle: 0 = +x, side 0 faces -PI/2) drawn at body scale `bs`. Matches Rig: root.rotation.y = -ang. */
export function mountWorld(x: number, y: number, h: number, pos: V3, ang: number, bs: number): V3 {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [pos[0] + (c * x - s * y) * bs, pos[1] + h * bs, pos[2] + (s * x + c * y) * bs];
}
