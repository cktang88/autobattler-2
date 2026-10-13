// Camera for the FieldView: smooth pan/zoom state plus built-in input handling (mouse, touch, keyboard).
//
// The camera works in "visual" coordinates: world cells after the viewer's 180° rotation (for side 0 they are
// identical to world coordinates, for side 1 vx = FIELD_W - x). FieldView converts.
//
//   k  = CSS pixels per cell (current, eased)      tk = target
//   cx, cy = visual cell shown at the viewport center  (target: tcx, tcy)

export const MAX_K = 80; // a size-1 unit (1 cell) is ~80 CSS px at full zoom

const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class Camera {
  cx: number;
  cy: number;
  k = 1;
  tcx: number;
  tcy: number;
  tk = 1;
  vw = 300;
  vh = 400;
  minK = 1;
  maxK = MAX_K;
  /** exponential smoothing rate (1/s) */
  smooth = 13;
  /** seconds since the camera last moved (used to decide when to re-render hi-res ground) */
  still = 0;
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
    this.minK = Math.max(0.5, Math.min(this.vw / this.fw, this.vh / this.fh));
    this.maxK = Math.max(MAX_K, this.minK * 1.5);
    if (wasFit) this.k = this.tk = this.minK;
    this.k = clampN(this.k, this.minK, this.maxK);
    this.tk = clampN(this.tk, this.minK, this.maxK);
    this.clampTarget();
    this.clampCurrent();
  }

  get isFit(): boolean {
    return this.tk <= this.minK * 1.02;
  }

  private clampAxis(c: number, k: number, view: number, field: number): number {
    const half = view / (2 * k);
    if (half * 2 >= field) return field / 2;
    const pad = half * 0.35;
    const lo = half - pad, hi = field - half + pad;
    if (lo >= hi) return field / 2;
    return clampN(c, lo, hi);
  }

  private clampTarget(): void {
    this.tcx = this.clampAxis(this.tcx, this.tk, this.vw, this.fw);
    this.tcy = this.clampAxis(this.tcy, this.tk, this.vh, this.fh);
  }

  private clampCurrent(): boolean {
    const x = this.clampAxis(this.cx, this.k, this.vw, this.fw);
    const y = this.clampAxis(this.cy, this.k, this.vh, this.fh);
    const hit = x !== this.cx || y !== this.cy;
    this.cx = x;
    this.cy = y;
    return hit;
  }

  /** visual cells -> screen CSS px */
  toScreen(vx: number, vy: number): { x: number; y: number } {
    return { x: this.vw / 2 + (vx - this.cx) * this.k, y: this.vh / 2 + (vy - this.cy) * this.k };
  }

  fromScreen(sx: number, sy: number): { x: number; y: number } {
    return { x: this.cx + (sx - this.vw / 2) / this.k, y: this.cy + (sy - this.vh / 2) / this.k };
  }

  stopInertia(): void {
    this.velX = this.velY = 0;
  }

  /** Direct manipulation: pan by a screen delta, immediately (no easing). */
  panByScreen(dx: number, dy: number): void {
    this.anchor = null;
    this.cx -= dx / this.k;
    this.cy -= dy / this.k;
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
    this.cx = w.x - (sx - this.vw / 2) / nk;
    this.cy = w.y - (sy - this.vh / 2) / nk;
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
    this.tcx = w.x - (sx - this.vw / 2) / nk;
    this.tcy = w.y - (sy - this.vh / 2) / nk;
    this.clampTarget();
    this.stopInertia();
    this.still = 0;
  }

  /** Eased move to a view (visual coords). k in CSS px per cell. */
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

  fit(instant = false): void {
    this.setTarget(this.fw / 2, this.fh / 2, this.minK, instant);
  }

  /** Fling after a drag; velocity in screen px / s. */
  fling(vxPx: number, vyPx: number): void {
    this.velX = -vxPx / this.k;
    this.velY = -vyPx / this.k;
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
      this.tcx += this.keyX * sp * dt;
      this.tcy += this.keyY * sp * dt;
      this.clampTarget();
      moving = true;
    }
    const lk = Math.log(this.k), ltk = Math.log(this.tk);
    if (Math.abs(ltk - lk) > 0.0005) {
      this.k = Math.exp(lk + (ltk - lk) * f);
      moving = true;
    } else this.k = this.tk;
    if (this.anchor) {
      const a = this.anchor;
      this.cx = a.vx - (a.sx - this.vw / 2) / this.k;
      this.cy = a.vy - (a.sy - this.vh / 2) / this.k;
      if (this.k === this.tk) this.anchor = null;
    } else {
      const ex = this.tcx - this.cx, ey = this.tcy - this.cy;
      if (Math.abs(ex) * this.k > 0.05 || Math.abs(ey) * this.k > 0.05) {
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
const TOUCH_DRAG_PX = 8;

/** Mouse / touch / keyboard handling for a Camera, attached to a canvas. */
export class CameraControls {
  private _enabled = true;
  /** double click / double tap zooms in on the point (or back to fit). Screens may switch this off temporarily. */
  doubleClickZoom = true;
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
      this.panning = this.pinching = false;
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
      this.rightDragged = false;
      this.samples = [];
    }
    const p = this.pos(e);
    this.ptrs.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, type: e.pointerType, button: e.button, t0: performance.now() });
    this.cam.stopInertia();
    if (e.button === 1) e.preventDefault();
    if (this.ptrs.size === 2) this.startPinch();
    else if (this.ptrs.size === 1 && (e.button === 1 || e.button === 2)) { this.panning = true; this.dragged = true; }
  }

  private startPinch(): void {
    const [a, b] = [...this.ptrs.values()];
    this.pinching = true;
    this.panning = false;
    this.dragged = true;
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
      this.pinchDist = d;
      this.pinchMidX = mx;
      this.pinchMidY = my;
      e.preventDefault();
      return;
    }
    if (this.ptrs.size !== 1) return;
    if (!this.panning) {
      if (q.button !== 0) return;
      const thr = q.type === 'mouse' ? MOUSE_DRAG_PX : TOUCH_DRAG_PX;
      if (Math.hypot(p.x - q.sx, p.y - q.sy) <= thr) return;
      this.panning = true;
      this.dragged = true;
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
    this.cam.zoomBy(f, p.x, p.y);
  }

  /* keyboard */
  private static PAN = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

  private keyOk(e: KeyboardEvent): boolean {
    if (!this._enabled || e.ctrlKey || e.metaKey || e.altKey) return false;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return false;
    if (document.querySelector('.modal-back')) return false;
    return true;
  }

  private keyDown(e: KeyboardEvent): void {
    if (!this.keyOk(e)) return;
    const k = e.key.toLowerCase();
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
