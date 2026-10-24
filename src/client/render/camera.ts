// Camera for the FieldView: smooth pan/zoom state plus built-in input handling (mouse, touch, keyboard).
//
// The camera works in "visual" coordinates: world cells after the viewer's 180° rotation (for side 0 they are
// identical to world coordinates, for side 1 vx = FIELD_W - x). FieldView converts.
//
//   k  = CSS pixels per cell (current, eased)      tk = target
//   cx, cy = visual cell shown at the viewport center  (target: tcx, tcy)
//   ay = vertical foreshortening of the ground plane (cos of the camera tilt; 1 = straight down). One cell is k px
//   wide and k * ay px tall on screen.
//   yaw = the view's turn about the look-at point (radians; 0 = the classic view, field rows run across the screen).
//   Screen right is the visual direction (cos yaw, sin yaw), screen down (-sin yaw, cos yaw). Only views that can draw
//   a turned field (the 3D view) ever set it; CameraControls.rotate gates the right-drag orbit.

/** a left-button press with Ctrl or Option held: the Mac stand-in for a right-button press (macOS turns Ctrl+click into
 *  a right-click, and trackpads / one-button mice have no other way to right-drag) */
export const secondaryLeft = (e: { button: number; ctrlKey: boolean; altKey: boolean }): boolean => e.button === 0 && (e.ctrlKey || e.altKey);

export const MAX_K = 170; // a size-1 unit (1 cell) is ~170 CSS px at full zoom (close enough to read a scout's details)
/** cells the camera may travel past the top/bottom (Y) and side (X) edges of the field */
const EDGE_Y = 5;
const EDGE_X = 2.5;

const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** a - b wrapped into -PI..PI */
export const angleDiff = (a: number, b: number) => { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI; return d; };

export class Camera {
  cx: number;
  cy: number;
  k = 1;
  tcx: number;
  tcy: number;
  tk = 1;
  /** view turn about the look-at point (radians, eased toward tyaw) */
  yaw = 0;
  tyaw = 0;
  vw = 300;
  vh = 400;
  minK = 1;
  maxK = MAX_K;
  /** ground-plane vertical scale (cos of the tilt) at the fit view */
  ay = 1;
  /** optional zoom-dependent foreshortening (a perspective view whose pitch changes with zoom): ay as a function of
   *  z = k / minK. Must return `ay` at z = 1 (minK is fitted with it). null = constant ay. */
  ayFn: ((z: number) => number) | null = null;
  /** ground-plane vertical scale at scale k */
  ayAt(k: number): number { return this.ayFn ? this.ayFn(k / this.minK) : this.ay; }
  /** exponential smoothing rate (1/s) */
  smooth = 13;
  /** seconds since the camera last moved (used to decide when to re-render hi-res ground) */
  still = 0;
  /** performance.now() of the player's last own camera input (drag, pinch, wheel, camera keys / buttons); the auto
   *  camera stays off once the player has taken control */
  userAt = 0;
  /** continuous key pan direction, -1..1 (screen axes) */
  keyX = 0;
  keyY = 0;
  private anchor: { sx: number; sy: number; vx: number; vy: number } | null = null;
  private velX = 0; // inertia, visual cells / s
  private velY = 0;

  readonly fw: number;
  readonly fh: number;

  constructor(fw: number, fh: number) {
    this.fw = fw;
    this.fh = fh;
    this.cx = this.tcx = fw / 2;
    this.cy = this.tcy = fh / 2;
  }

  /** Set the viewport size (CSS px). Keeps the fit view fitted. */
  setViewport(w: number, h: number): void {
    const wasFit = this.vw > 0 && this.tk <= this.minK * 1.001;
    this.vw = Math.max(1, w);
    this.vh = Math.max(1, h);
    this.minK = Math.max(0.5, Math.min(this.vw / this.fw, this.vh / (this.fh * this.ay)));
    this.maxK = Math.max(MAX_K, this.minK * 1.5);
    if (wasFit) this.k = this.tk = this.minK;
    this.k = clampN(this.k, this.minK, this.maxK);
    this.tk = clampN(this.tk, this.minK, this.maxK);
    this.clampTarget();
    this.clampCurrent();
  }

  /** change the ground foreshortening (tilt on/off); keeps the fit view fitted */
  setAspect(ay: number): void {
    if (ay === this.ay) return;
    const wasFit = this.tk <= this.minK * 1.001;
    this.ay = ay;
    this.setViewport(this.vw, this.vh);
    if (wasFit) { this.k = this.tk = this.minK; this.cx = this.tcx = this.fw / 2; this.cy = this.tcy = this.fh / 2; }
  }

  get isFit(): boolean {
    return this.tk <= this.minK * 1.02;
  }

  /** `edge` = extra cells the view may travel past the field edge, so the board's edges (and the land around it)
   *  can be brought fully into view even when the whole field already fits on screen. */
  private clampAxis(c: number, half: number, field: number, edge: number): number {
    if (half * 2 >= field) {
      const slack = Math.max(0, edge - (half - field / 2));
      return clampN(c, field / 2 - slack, field / 2 + slack);
    }
    // the extra zoomed-in travel fades out as the view approaches the whole field, so the range meets the
    // fitted case's `edge` slack continuously (a step there snapped the view by several cells when zooming out)
    const pad = Math.min(half * 0.35, half * 0.08 * clampN((field / 2 - half) / (field * 0.1), 0, 1) + edge);
    const lo = half - pad, hi = field - half + pad;
    if (lo >= hi) return field / 2;
    return clampN(c, lo, hi);
  }

  /** half extents (cells) of the view along the visual x / y axes at scale k and turn yaw (the screen rect's bounds) */
  private halves(k: number, yaw: number): [number, number] {
    const hw = this.vw / (2 * k), hh = this.vh / (2 * k * this.ayAt(k));
    if (!yaw) return [hw, hh];
    const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
    return [c * hw + s * hh, s * hw + c * hh];
  }

  private clampTarget(): void {
    const [hx, hy] = this.halves(this.tk, this.tyaw);
    this.tcx = this.clampAxis(this.tcx, hx, this.fw, EDGE_X);
    this.tcy = this.clampAxis(this.tcy, hy, this.fh, EDGE_Y);
  }

  private clampCurrent(): boolean {
    const [hx, hy] = this.halves(this.k, this.yaw);
    const x = this.clampAxis(this.cx, hx, this.fw, EDGE_X);
    const y = this.clampAxis(this.cy, hy, this.fh, EDGE_Y);
    const hit = x !== this.cx || y !== this.cy;
    this.cx = x;
    this.cy = y;
    return hit;
  }

  /** a screen-axis offset (cells along screen right / down) -> visual cells, at turn `yaw` */
  private turn(u: number, v: number, yaw = this.yaw): { x: number; y: number } {
    if (!yaw) return { x: u, y: v };
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return { x: u * c - v * s, y: u * s + v * c };
  }

  /** screen offset from the viewport centre (CSS px) -> visual offset (cells) at scale k */
  private screenDelta(dx: number, dy: number, k = this.k, yaw = this.yaw): { x: number; y: number } {
    return this.turn(dx / k, dy / (k * this.ayAt(k)), yaw);
  }

  /** visual cells -> screen CSS px */
  toScreen(vx: number, vy: number): { x: number; y: number } {
    const dx = vx - this.cx, dy = vy - this.cy, c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return { x: this.vw / 2 + (dx * c + dy * s) * this.k, y: this.vh / 2 + (-dx * s + dy * c) * this.k * this.ayAt(this.k) };
  }

  fromScreen(sx: number, sy: number): { x: number; y: number } {
    const d = this.screenDelta(sx - this.vw / 2, sy - this.vh / 2);
    return { x: this.cx + d.x, y: this.cy + d.y };
  }

  /** Direct manipulation: turn the view about its centre by `da` radians, immediately. */
  rotateBy(da: number): void {
    if (!da) return;
    this.anchor = null;
    this.yaw = angleDiff(this.yaw + da, 0);
    this.tyaw = this.yaw;
    this.clampCurrent();
    this.tcx = this.cx;
    this.tcy = this.cy;
    this.tk = this.k;
    this.still = 0;
  }

  /** Eased turn by `da` radians (keys). */
  turnBy(da: number): void {
    this.tyaw = angleDiff(this.tyaw + da, 0);
    this.clampTarget();
    this.still = 0;
  }

  /** Eased turn back to the classic (unturned) view. */
  resetYaw(): void {
    this.tyaw = 0;
    this.clampTarget();
    this.still = 0;
  }

  stopInertia(): void {
    this.velX = this.velY = 0;
  }

  /** Direct manipulation: pan by a screen delta, immediately (no easing). */
  panByScreen(dx: number, dy: number): void {
    this.anchor = null;
    const d = this.screenDelta(dx, dy);
    this.cx -= d.x;
    this.cy -= d.y;
    this.clampCurrent();
    this.tcx = this.cx;
    this.tcy = this.cy;
    this.tk = this.k;
    this.still = 0;
  }

  /** Direct manipulation: zoom about a screen point, immediately. */
  zoomAtInstant(f: number, sx: number, sy: number): void {
    this.anchor = null;
    const w = this.fromScreen(sx, sy);
    const nk = clampN(this.k * f, this.minK, this.maxK);
    this.k = nk;
    const d = this.screenDelta(sx - this.vw / 2, sy - this.vh / 2, nk);
    this.cx = w.x - d.x;
    this.cy = w.y - d.y;
    this.clampCurrent();
    this.tcx = this.cx;
    this.tcy = this.cy;
    this.tk = this.k;
    this.still = 0;
  }

  /** Eased zoom about a screen point (wheel, buttons). Default point: viewport center. */
  zoomBy(f: number, sx = this.vw / 2, sy = this.vh / 2): void {
    const nk = clampN(this.tk * f, this.minK, this.maxK);
    if (nk === this.tk) return;
    // world point under the cursor right now stays under it for the whole animation
    const w = this.fromScreen(sx, sy);
    this.anchor = { sx, sy, vx: w.x, vy: w.y };
    this.tk = nk;
    const d = this.screenDelta(sx - this.vw / 2, sy - this.vh / 2, nk);
    this.tcx = w.x - d.x;
    this.tcy = w.y - d.y;
    this.clampTarget();
    this.stopInertia();
    this.still = 0;
  }

  /** Eased move to a view (visual coords). k in CSS px per cell. */
  /** Auto camera: ease toward framing a visual-space box (cells) with `margin` cells around it; the box is never
   *  treated as smaller than `minSize` cells, so the last few units of a fight fill the view without absurd zoom. */
  frameBox(x0: number, y0: number, x1: number, y1: number, margin = 6, minSize = 20): void {
    // a turned view frames the box's extent along the screen axes (the bounds of the turned rectangle)
    const c = Math.abs(Math.cos(this.tyaw)), s = Math.abs(Math.sin(this.tyaw)), bw = x1 - x0, bh = y1 - y0;
    const w = Math.max(minSize, c * bw + s * bh + 2 * margin), h = Math.max(minSize * 0.75, s * bw + c * bh + 2 * margin);
    let k = Math.min(this.vw / w, this.vh / (h * this.ay));
    // foreshortening depends on the zoom: refine (converges in a couple of steps, ay changes slowly with k)
    if (this.ayFn) for (let i = 0; i < 3; i++) k = Math.min(this.vw / w, this.vh / (h * this.ayAt(k)));
    this.setTarget((x0 + x1) / 2, (y0 + y1) / 2, k, false);
  }

  setTarget(vx: number, vy: number, k: number, instant = false): void {
    this.anchor = null;
    this.stopInertia();
    this.tk = clampN(k, this.minK, this.maxK);
    this.tcx = vx;
    this.tcy = vy;
    this.clampTarget();
    if (instant) {
      this.k = this.tk;
      this.cx = this.tcx;
      this.cy = this.tcy;
    }
    this.still = 0;
  }

  /** glide the view centre to a visual point, keeping zoom and turn (minimap clicks) */
  centerOn(vx: number, vy: number): void {
    this.setTarget(vx, vy, this.tk, false);
    this.userAt = performance.now();
  }

  /** the whole field, unturned (the fit view is fitted to the unturned field) */
  fit(instant = false): void {
    this.tyaw = 0;
    if (instant) this.yaw = 0;
    this.setTarget(this.fw / 2, this.fh / 2, this.minK, instant);
  }

  /** Fling after a drag; velocity in screen px / s. */
  fling(vxPx: number, vyPx: number): void {
    const d = this.screenDelta(vxPx, vyPx);
    this.velX = -d.x;
    this.velY = -d.y;
  }

  /** Advance the animation. Returns true while the camera is moving. */
  update(dt: number): boolean {
    dt = clampN(dt, 0, 0.1);
    const f = 1 - Math.exp(-dt * this.smooth);
    let moving = false;
    // inertia
    if (this.velX || this.velY) {
      this.cx += this.velX * dt;
      this.cy += this.velY * dt;
      if (this.clampCurrent()) this.velX = this.velY = 0;
      this.tcx = this.cx;
      this.tcy = this.cy;
      const d = Math.exp(-dt * 3.2);
      this.velX *= d;
      this.velY *= d;
      if (Math.hypot(this.velX, this.velY) * this.k < 6) this.velX = this.velY = 0;
      moving = true;
    }
    // keyboard pan (eases through the target)
    if (this.keyX || this.keyY) {
      const sp = 560 / this.k;
      this.anchor = null;
      const d = this.turn(this.keyX * sp * dt, (this.keyY * sp * dt) / this.ayAt(this.k));
      this.tcx += d.x;
      this.tcy += d.y;
      this.clampTarget();
      moving = true;
    }
    const dy = angleDiff(this.tyaw, this.yaw);
    if (Math.abs(dy) > 1e-4) {
      this.yaw = angleDiff(this.yaw + dy * f, 0);
      moving = true;
    } else this.yaw = this.tyaw;
    const lk = Math.log(this.k), ltk = Math.log(this.tk);
    if (Math.abs(ltk - lk) > 0.0005) {
      this.k = Math.exp(lk + (ltk - lk) * f);
      moving = true;
    } else this.k = this.tk;
    if (this.anchor) {
      const a = this.anchor;
      const d = this.screenDelta(a.sx - this.vw / 2, a.sy - this.vh / 2);
      this.cx = a.vx - d.x;
      this.cy = a.vy - d.y;
      if (this.k === this.tk) this.anchor = null;
    } else {
      const ex = this.tcx - this.cx, ey = this.tcy - this.cy;
      if (Math.abs(ex) * this.k > 0.05 || Math.abs(ey) * this.k * this.ayAt(this.k) > 0.05) {
        this.cx += ex * f;
        this.cy += ey * f;
        moving = true;
      } else {
        this.cx = this.tcx;
        this.cy = this.tcy;
      }
    }
    this.clampCurrent();
    this.still = moving ? 0 : this.still + dt;
    return moving;
  }
}

/* ------------------------------------------------------------------------------------------ input */

interface Ptr {
  x: number;
  y: number;
  sx: number;
  sy: number;
  type: string;
  button: number;
  t0: number;
}

const MOUSE_DRAG_PX = 6;
/** right-drag orbit speed: a drag across ~800 px turns the view ~half way round */
export const ORBIT_RAD_PER_PX = 0.004;
const TOUCH_DRAG_PX = 8;

/** Keys typed into a form control or an open dropdown are not camera keys: a focused input / select / textarea /
 *  editable element or kit combobox (its type-ahead and arrows), an open kit dropdown popup (.k-pop) or a modal.
 *  (Mirrors the guards of the match / playground key handlers.) */
export function keyBlocked(t: { tagName?: string; isContentEditable?: boolean; getAttribute?(n: string): string | null } | null, open: (sel: string) => boolean): boolean {
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || t.getAttribute?.('role') === 'combobox')) return true;
  return open('.modal-back') || open('.k-pop');
}

/** Mouse / touch / keyboard handling for a Camera, attached to a canvas. */
export class CameraControls {
  private _enabled = true;
  /** double click / double tap zooms in on the point (or back to fit). Screens may switch this off temporarily. */
  doubleClickZoom = true;
  /** right-drag (and a two-finger twist, and Q / E) turns the view about its centre instead of panning. Only for
   *  views that can draw a turned field; screens switch it per phase (deploy keeps right-drag = pan). */
  rotate = false;
  private orbiting = false;
  private twist = 0;
  private pinchAng = 0;
  private ptrs = new Map<number, Ptr>();
  private panning = false;
  private pinching = false;
  private dragged = false;
  private pinchDist = 0;
  private pinchMidX = 0;
  private pinchMidY = 0;
  private samples: { t: number; x: number; y: number }[] = [];
  private lastTap: { t: number; x: number; y: number } | null = null;
  private keys = new Set<string>();
  private offs: (() => void)[] = [];

  private cam: Camera;
  private canvas: HTMLCanvasElement;

  constructor(cam: Camera, canvas: HTMLCanvasElement, enabled = true) {
    this.cam = cam;
    this.canvas = canvas;
    this.enabled = enabled;
    const on = <E extends Event>(t: EventTarget, type: string, fn: (e: E) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.offs.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on<PointerEvent>(canvas, 'pointerdown', (e) => this.down(e));
    on<PointerEvent>(canvas, 'pointermove', (e) => this.move(e));
    on<PointerEvent>(canvas, 'pointerup', (e) => this.up(e, false));
    on<PointerEvent>(canvas, 'pointercancel', (e) => this.up(e, true));
    on<WheelEvent>(canvas, 'wheel', (e) => this.wheel(e), { passive: false });
    on<MouseEvent>(canvas, 'contextmenu', (e) => {
      if (this.enabled && this.rightDragged) { e.preventDefault(); e.stopImmediatePropagation(); }
      this.rightDragged = false;
    });
    on<MouseEvent>(canvas, 'auxclick', (e) => { if (this.enabled && e.button === 1) e.preventDefault(); });
    on<KeyboardEvent>(window, 'keydown', (e) => this.keyDown(e));
    on<KeyboardEvent>(window, 'keyup', (e) => this.keyUp(e));
    on<Event>(window, 'blur', () => { this.keys.clear(); this.syncKeys(); });
  }

  private rightDragged = false;

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(v: boolean) {
    this._enabled = v;
    if (!v) {
      this.ptrs.clear();
      this.keys.clear();
      this.syncKeys();
      this.panning = this.pinching = this.orbiting = false;
    }
    try { this.canvas.style.touchAction = v ? 'none' : ''; } catch { /* */ }
  }

  /** true if the pointer gesture that just ended was a pan / pinch (not a click or tap) */
  get wasDrag(): boolean {
    return this.dragged;
  }

  /** returns wasDrag and clears it; call from your pointerup/click handler to ignore the end of a pan */
  consumeDrag(): boolean {
    const d = this.dragged;
    this.dragged = false;
    return d;
  }

  destroy(): void {
    for (const f of this.offs) f();
    this.offs = [];
  }

  private pos(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent): void {
    if (!this._enabled) return;
    if (this.ptrs.size === 0) {
      this.dragged = false;
      this.panning = false;
      this.pinching = false;
      this.orbiting = false;
      this.rightDragged = false;
      this.samples = [];
    }
    const p = this.pos(e);
    // Ctrl / Option + left button stands in for the right button (Mac trackpads and one-button mice)
    const button = secondaryLeft(e) ? 2 : e.button;
    this.ptrs.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, type: e.pointerType, button, t0: performance.now() });
    this.cam.stopInertia();
    if (e.button === 1) e.preventDefault();
    if (this.ptrs.size === 2) this.startPinch();
    // right-drag orbits (where the view can turn): turning alone leaves the auto camera framing the fight
    else if (this.ptrs.size === 1 && button === 2 && this.rotate) { this.orbiting = true; this.dragged = true; }
    else if (this.ptrs.size === 1 && (button === 1 || button === 2)) { this.panning = true; this.dragged = true; this.cam.userAt = performance.now(); }
  }

  private startPinch(): void {
    const [a, b] = [...this.ptrs.values()];
    this.pinching = true;
    this.panning = false;
    this.orbiting = false;
    this.dragged = true;
    this.twist = 0;
    this.pinchAng = Math.atan2(b.y - a.y, b.x - a.x);
    this.cam.userAt = performance.now();
    this.pinchDist = Math.max(8, Math.hypot(a.x - b.x, a.y - b.y));
    this.pinchMidX = (a.x + b.x) / 2;
    this.pinchMidY = (a.y + b.y) / 2;
  }

  private move(e: PointerEvent): void {
    const q = this.ptrs.get(e.pointerId);
    if (!q || !this._enabled) return;
    const p = this.pos(e);
    const dx = p.x - q.x, dy = p.y - q.y;
    q.x = p.x;
    q.y = p.y;
    if (this.pinching && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.max(8, Math.hypot(a.x - b.x, a.y - b.y));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.cam.panByScreen(mx - this.pinchMidX, my - this.pinchMidY);
      this.cam.zoomAtInstant(d / this.pinchDist, mx, my);
      if (this.rotate) {
        // two-finger twist turns the view about the pinch centre, once it is clearly a twist and not a wobbly pinch
        const ang = Math.atan2(b.y - a.y, b.x - a.x), da = angleDiff(ang, this.pinchAng);
        this.pinchAng = ang;
        if (Math.abs(this.twist) < 0.15) this.twist += da;
        else this.turnAbout(-da, mx, my);
      }
      this.pinchDist = d;
      this.pinchMidX = mx;
      this.pinchMidY = my;
      e.preventDefault();
      return;
    }
    if (this.ptrs.size !== 1) return;
    if (this.orbiting) {
      this.cam.rotateBy(dx * ORBIT_RAD_PER_PX);
      if (q.button === 2) this.rightDragged = true;
      return;
    }
    if (!this.panning) {
      if (q.button !== 0) return;
      const thr = q.type === 'mouse' ? MOUSE_DRAG_PX : TOUCH_DRAG_PX;
      if (Math.hypot(p.x - q.sx, p.y - q.sy) <= thr) return;
      this.panning = true;
      this.dragged = true;
      this.cam.userAt = performance.now();
      this.cam.panByScreen(p.x - q.sx, p.y - q.sy);
    } else this.cam.panByScreen(dx, dy);
    if (q.button === 2) this.rightDragged = true;
    const t = performance.now();
    this.samples.push({ t, x: p.x, y: p.y });
    while (this.samples.length > 2 && t - this.samples[0].t > 100) this.samples.shift();
  }

  private up(e: PointerEvent, cancel: boolean): void {
    const q = this.ptrs.get(e.pointerId);
    if (!q) return;
    this.ptrs.delete(e.pointerId);
    if (!this._enabled) return;
    const now = performance.now();
    if (this.pinching) {
      if (this.ptrs.size === 1) {
        this.pinching = false;
        this.panning = true; // continue with the remaining finger
        this.samples = [];
      } else if (this.ptrs.size === 0) this.pinching = false;
      return;
    }
    if (this.ptrs.size > 0) return;
    if (this.orbiting) { this.orbiting = false; this.lastTap = null; return; }
    if (this.panning) {
      this.panning = false;
      if (!cancel) {
        const s = this.samples;
        if (s.length >= 2 && now - s[s.length - 1].t < 70) {
          const a = s[0], b = s[s.length - 1];
          const dt = (b.t - a.t) / 1000;
          if (dt > 0.012) {
            const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
            if (Math.hypot(vx, vy) > 120) this.cam.fling(clampN(vx, -3000, 3000), clampN(vy, -3000, 3000));
          }
        }
      }
      this.samples = [];
      this.lastTap = null;
      return;
    }
    // a tap / click
    if (cancel || q.button !== 0 || this.dragged) { this.lastTap = null; return; }
    const lt = this.lastTap;
    if (lt && now - lt.t < 350 && Math.hypot(q.x - lt.x, q.y - lt.y) < 30) {
      this.lastTap = null;
      if (this.doubleClickZoom) this.doubleTap(q.x, q.y);
    } else this.lastTap = { t: now, x: q.x, y: q.y };
  }

  /** turn the view by `da` keeping the ground under a screen point in place */
  private turnAbout(da: number, sx: number, sy: number): void {
    const c = this.cam, w = c.fromScreen(sx, sy);
    c.rotateBy(da);
    const p = c.toScreen(w.x, w.y);
    c.panByScreen(sx - p.x, sy - p.y);
  }

  private doubleTap(sx: number, sy: number): void {
    const c = this.cam;
    if (c.tk > c.minK * 1.6) c.fit();
    else {
      const w = c.fromScreen(sx, sy);
      c.setTarget(w.x, w.y, Math.min(c.maxK, Math.max(c.minK * 2.8, 22)));
    }
  }

  private wheel(e: WheelEvent): void {
    if (!this._enabled) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    const f = clampN(Math.exp(-dy * (e.ctrlKey ? 0.011 : 0.0016)), 0.6, 1.7);
    const p = this.pos(e);
    this.cam.userAt = performance.now();
    this.cam.zoomBy(f, p.x, p.y);
  }

  /* keyboard */
  private static PAN = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

  private keyOk(e: KeyboardEvent): boolean {
    if (!this._enabled || e.ctrlKey || e.metaKey || e.altKey) return false;
    return !keyBlocked(e.target as HTMLElement | null, (sel) => document.querySelector(sel) !== null);
  }

  private keyDown(e: KeyboardEvent): void {
    if (!this.keyOk(e)) return;
    const k = e.key.toLowerCase();
    if (CameraControls.PAN.has(k) || k === '+' || k === '=' || k === 'add' || k === '-' || k === '_' || k === 'subtract' || k === 'home' || k === 'f') this.cam.userAt = performance.now();
    if (CameraControls.PAN.has(k)) {
      this.keys.add(k);
      this.syncKeys();
      e.preventDefault();
    } else if (k === '+' || k === '=' || k === 'add') {
      this.cam.zoomBy(1.3);
      e.preventDefault();
    } else if (k === '-' || k === '_' || k === 'subtract') {
      this.cam.zoomBy(1 / 1.3);
      e.preventDefault();
    } else if (k === 'home' || k === 'f') {
      this.cam.fit();
      e.preventDefault();
    } else if (this.rotate && (k === 'q' || k === 'e')) {
      this.cam.turnBy(k === 'q' ? -Math.PI / 8 : Math.PI / 8);
      e.preventDefault();
    }
  }

  private keyUp(e: KeyboardEvent): void {
    if (this.keys.delete(e.key.toLowerCase())) this.syncKeys();
  }

  private syncKeys(): void {
    const h = (a: string, b: string) => (this.keys.has(a) ? 1 : 0) - (this.keys.has(b) ? 1 : 0);
    this.cam.keyX = clampN(h('d', 'a') + h('arrowright', 'arrowleft'), -1, 1);
    this.cam.keyY = clampN(h('s', 'w') + h('arrowdown', 'arrowup'), -1, 1);
  }
}
