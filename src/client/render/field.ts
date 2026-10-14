// FieldView: draws the battlefield (deploy board and live battle) on a canvas.
//
// USAGE (battle playback)
//   const view = new FieldView(canvas, mySide);
//   each animation frame:
//     for (n ticks to advance this frame) { battle.step(); view.pushEvents(battle.events); }
//     view.drawBattle(battle, frameDt);
//
//   - pushEvents(events) MUST be called after EVERY battle.step() so no events are lost when several ticks run
//     per frame (fast-forward). Events are queued and turned into effects + sound on the next drawBattle().
//   - drawBattle(battle, dt) only renders: it consumes the queued events and draws the current state, smoothly
//     interpolating units/projectiles between the last two sim ticks it saw.
//   - Fallback: if pushEvents has never been called on this view, drawBattle reads battle.events itself once per
//     new tick (events of skipped ticks are then lost). Once pushEvents is used, drawBattle never reads
//     battle.events, so nothing is processed twice.
//   - A new Battle object (or battle.tick going backwards) resets effects, wrecks and interpolation state.
//
// Coordinates: world units are cells (FIELD_W x FIELD_H). The viewer's side is always at the bottom; for
// viewerSide 1 the field is rotated 180°. worldToScreen/screenToWorld use canvas CSS pixels and include the camera.
//
// CAMERA: `view.cam` eases (frame-rate independent) toward a target center + zoom. Built-in input (wheel / pinch zoom
// toward cursor, drag/touch pan with inertia, WASD/arrows, +/-, Home/F, double-click/tap) is attached to the canvas
// unless `new FieldView(canvas, side, { interactive: false })` or `view.controls.enabled = false`.
//   view.fit() | view.frameDeploy() | view.focusOn(x, y, zoom?) | view.zoomBy(f, sx?, sy?)  (zoom: 1 = whole field fits)
//   view.consumeDrag() / view.controls.wasDrag: true when the pointer gesture that just ended was a pan/pinch;
//   call it from a pointerup/click handler to ignore that gesture (controls' listeners run before yours).

import { CREATURE_SHAPES } from './creatures.ts';
import { battleSfx, setPanFlip } from '../audio.ts';
import { DEPLOY_D, FIELD_H, FIELD_W, METERS_PER_CELL } from '../../shared/grid.ts';
import { Camera, CameraControls } from './camera.ts';
import type { Battle } from '../../shared/sim/battle.ts';
import type { BattleEvent, SimProjectile, SimUnit } from '../../shared/sim/types.ts';
import { DT } from '../../shared/sim/types.ts';
import type { Design, Side } from '../../shared/types.ts';
import { Fx, modOf, visualOf } from './fx.ts';
import { MAPS, SURROUND, groundCanvas, groundRegion, surroundCanvas, type MapTheme } from './ground.ts';
import { TEAM_PAL, clamp, ctx2d, hash01, lerp, lerpAngle, rgba, roundRect, shade, softDot, type Ctx, type Team } from './palette.ts';
import { loadTextures, tex, tinted } from './textures.ts';
import { moduleGlow } from './turrets.ts';
import { titanFeet } from './giantart.ts';

const P2 = Math.PI * 2;
/** cells of flight over which a round's drawn position slides from the barrel tip onto its simulated path */
const MUZZLE_BLEND = 2.5;
import {
  drawUnit, drawUnitShadow, layoutOf, mountPoints, muzzlePos, unitSprites, silhouette, wreckSprite,
  type MountPose, type UnitPose, type ViewDirs,
} from './unitart.ts';

export { drawPartIcon, moduleCategoryColor, type PartKind, type PartIconOpts } from './icons.ts';

export interface BoardUnit {
  side: Side;
  design: Design;
  /** world center (cells) */
  x: number;
  y: number;
  level: number;
  /** semi-transparent placement preview */
  ghost?: boolean;
  /** ghost drawn in red (illegal spot) */
  invalid?: boolean;
  /** selected / highlighted */
  selected?: boolean;
  /** drawn dimmed (e.g. locked units from earlier rounds when that matters) */
  dim?: boolean;
}

export interface BoardOverlay {
  /** tint the viewer's deploy zone */
  showZone?: boolean;
  /** cells to highlight, world cell coords */
  /** footprint highlight; w x h (cells) when given, else size x size */
  hover?: { col: number; row: number; size: number; w?: number; h?: number; valid: boolean } | null;
}

interface USnap {
  x: number;
  y: number;
  angle: number;
  mounts: number[];
  odo: number;
}

interface UVis {
  shieldT: number;
  /** last time the unit took damage (hit event or hp/shield drop) */
  dmgT: number;
  /** last time the unit was healed */
  healT: number;
  hpLast: number;
  shLast: number;
  hpShown: number;
  swing: number[];
  seen: number;
  lastPh?: number;
  /** per-mount sustained-fire heat (annihilator warm-up) */
  heat?: number[];
}

interface PSnap {
  x: number;
  y: number;
  z: number;
  angle: number;
  progress: number;
}

interface PTrack {
  sx: number;
  sy: number;
  /** barrel-tip offset at spawn, faded out over the first cells of flight */
  ox?: number;
  oy?: number;
  lx: number;
  ly: number;
  kind: string;
  moduleId: string;
  side: Side;
  born: number;
}

/** fixed resolution (device px per cell) of the cached base ground and the decal layer */
const GROUND_PX = 24;
const DECAL_PX = 20;

const forwardAngle = (side: Side) => (side === 0 ? -Math.PI / 2 : Math.PI / 2);

/**
 * Draws the battlefield on a canvas. The viewer's side is always at the bottom (side 1 sees the
 * field rotated 180°). Handles devicePixelRatio and fits the whole field into the canvas.
 */
/** max camera shake offset, CSS px (only reached when zoomed in close) */
const SHAKE_CAP = 2.5;
/** max full-screen flash opacity */
const FLASH_CAP = 0.25;

export class FieldView {
  canvas: HTMLCanvasElement;
  viewerSide: Side;
  /** when true, battle events produce no sound (e.g. menu background skirmish) */
  muted = false;
  private g: Ctx;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  readonly cam = new Camera(FIELD_W, FIELD_H);
  readonly controls: CameraControls;
  /** when true a small scale bar is drawn in the bottom-left corner */
  scaleBar = true;
  /** accessibility multipliers (0..1) for camera shake and full-screen flashes (settings: "Screen shake", "Flashes") */
  shakeScale = 1;
  flashScale = 1;
  /** show every HP/shield bar permanently (otherwise bars appear for a few seconds after damage, or while Alt is held) */
  alwaysShowHealth = false;
  /** Alt held (Zero-K style "show all bars"), tracked only when controls are interactive */
  private altHeld = false;
  private keyOff: (() => void) | null = null;
  private detail: { c: HTMLCanvasElement; x0: number; y0: number; x1: number; y1: number; px: number } | null = null;
  /** terrain theme of the current map */
  private map: MapTheme = MAPS[0];
  /** switch the battlefield terrain (maps rotate per round) */
  setMap(map: MapTheme): void {
    if (map.id === this.map.id) return;
    this.map = map;
    this.detail = null;
  }
  get mapTheme(): MapTheme { return this.map; }
  readonly fx = new Fx();
  private dirs: ViewDirs;
  private vignette: CanvasGradient | null = null;
  // battle state
  private battle: Battle | null = null;
  private lastTick = -1;
  private sinceTick = 0;
  private tickInterval = DT;
  private prevU = new Map<number, USnap>();
  private curU = new Map<number, USnap>();
  private prevP = new Map<number, PSnap>();
  private curP = new Map<number, PSnap>();
  private ptrack = new Map<number, PTrack>();
  private units = new Map<number, SimUnit>();
  private vis = new Map<number, UVis>();
  private pending: BattleEvent[] = [];
  private usePush = false;
  private time = 0;
  private alpha = 1;

  constructor(canvas: HTMLCanvasElement, viewerSide: Side, opts?: { interactive?: boolean }) {
    this.canvas = canvas;
    const interactive = opts?.interactive !== false;
    this.scaleBar = interactive;
    this.controls = new CameraControls(this.cam, canvas, interactive);
    if (interactive && typeof window !== 'undefined') {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Alt') { this.altHeld = e.type === 'keydown' && this.controls.enabled; if (e.type === 'keydown') e.preventDefault(); }
      };
      const onBlur = () => { this.altHeld = false; };
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKey);
      window.addEventListener('blur', onBlur);
      this.keyOff = () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('blur', onBlur); };
    }
    this.viewerSide = viewerSide;
    this.g = ctx2d(canvas);
    this.dirs = viewerSide === 0 ? { sx: 0.55, sy: 0.85, ux: 0, uy: -1 } : { sx: -0.55, sy: -0.85, ux: 0, uy: 1 };
    loadTextures();
    try { setPanFlip(viewerSide === 1); } catch { /* audio optional */ }
    this.resize();
  }

  /** call when the canvas' CSS size changes */
  resize(): void {
    const dpr = Math.min(3, typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);
    const cw = this.canvas.clientWidth || this.canvas.width / dpr || 300;
    const ch = this.canvas.clientHeight || this.canvas.height / dpr || 400;
    this.dpr = dpr;
    this.cssW = cw;
    this.cssH = ch;
    const w = Math.max(1, Math.round(cw * dpr)), h = Math.max(1, Math.round(ch * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.cam.setViewport(cw, ch);
    this.vignette = null;
    this.detail = null;
    this.fx.setDecalSpace(FIELD_W, FIELD_H, DECAL_PX);
  }

  /** CSS px per cell (camera zoom) */
  private get k(): number {
    return this.cam.k;
  }

  /** screen position (CSS px) of the visual (rotated) field's top-left corner */
  private get ox(): number {
    return this.cssW / 2 - this.cam.cx * this.cam.k;
  }

  private get oy(): number {
    return this.cssH / 2 - this.cam.cy * this.cam.k;
  }

  /** quantized device px per cell for sprite caches (avoids thrashing while zooming) */
  private get spritePx(): number {
    const raw = Math.max(4, this.k * this.dpr);
    return Math.min(96, Math.round(2 ** (Math.round(Math.log2(raw) * 3) / 3)));
  }

  /* ---------------------------------------------------------------------------------------- camera API */

  private toVisual(x: number, y: number): { x: number; y: number } {
    return this.viewerSide === 1 ? { x: FIELD_W - x, y: FIELD_H - y } : { x, y };
  }

  /** whole field fits (minimum zoom) */
  fit(instant = false): void {
    this.cam.fit(instant);
  }

  /** frame the viewer's own deploy zone plus some of no-man's land */
  frameDeploy(instant = false): void {
    this.checkSize();
    const c = this.cam;
    const rows = DEPLOY_D + 6;
    let k = Math.min(c.vw / FIELD_W, c.vh / rows);
    if (c.vw < 640) k = Math.max(k, 11); // phones: bigger units, pan sideways
    k = Math.max(c.minK, k);
    c.setTarget(FIELD_W / 2, FIELD_H - c.vh / (2 * k) + 0.4, k, instant);
  }

  /** center on world point (x, y); zoom is relative to fit (1 = whole field, omitted = keep current) */
  focusOn(x: number, y: number, zoom?: number, instant = false): void {
    const v = this.toVisual(x, y);
    this.cam.setTarget(v.x, v.y, zoom === undefined ? this.cam.tk : this.cam.minK * zoom, instant);
  }

  /** multiply zoom by f about a screen point (CSS px; default viewport center) */
  zoomBy(f: number, screenX?: number, screenY?: number): void {
    this.cam.zoomBy(f, screenX, screenY);
  }

  /** true if the pointer gesture that just ended was a pan/pinch; clears the flag */
  consumeDrag(): boolean {
    return this.controls.consumeDrag();
  }

  get wasDrag(): boolean {
    return this.controls.wasDrag;
  }

  private stepCamera(dt: number): void {
    this.cam.update(dt);
  }

  private checkSize(): void {
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    const dpr = Math.min(3, typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);
    if ((cw && cw !== this.cssW) || (ch && ch !== this.cssH) || dpr !== this.dpr) this.resize();
  }

  /** device px per cell */
  private get px(): number {
    return this.k * this.dpr;
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    if (this.viewerSide === 1) return { x: this.ox + (FIELD_W - x) * this.k, y: this.oy + (FIELD_H - y) * this.k };
    return { x: this.ox + x * this.k, y: this.oy + y * this.k };
  }

  /** canvas CSS px (e.g. from offsetX/offsetY) -> world cells */
  screenToWorld(px: number, py: number): { x: number; y: number } {
    const wx = (px - this.ox) / this.k, wy = (py - this.oy) / this.k;
    if (this.viewerSide === 1) return { x: FIELD_W - wx, y: FIELD_H - wy };
    return { x: wx, y: wy };
  }

  /** Queue a step's events (call after EVERY battle.step()). */
  pushEvents(events: BattleEvent[]): void {
    this.usePush = true;
    for (const e of events) this.pending.push(e);
    if (this.pending.length > 6000) this.pending.splice(0, this.pending.length - 6000);
  }

  private setWorld(shakeX = 0, shakeY = 0): void {
    const d = this.dpr, k = this.k;
    if (this.viewerSide === 1) this.g.setTransform(-k * d, 0, 0, -k * d, (this.ox + FIELD_W * k + shakeX) * d, (this.oy + FIELD_H * k + shakeY) * d);
    else this.g.setTransform(k * d, 0, 0, k * d, (this.ox + shakeX) * d, (this.oy + shakeY) * d);
  }

  private setScreen(): void {
    this.g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private teamOf(side: Side): Team {
    return side === this.viewerSide ? 0 : 1;
  }

  /* ----------------------------------------------------------------------------------------- ground */

  private drawGround(showZone: boolean, sx: number, sy: number): void {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = this.map.void;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.setWorld(sx, sy);
    // the land around the board, darkened, then a soft shadow lip and the field itself
    g.drawImage(surroundCanvas(this.map), -SURROUND, -SURROUND, FIELD_W + SURROUND * 2, FIELD_H + SURROUND * 2);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(-0.3, -0.3, FIELD_W + 0.6, FIELD_H + 0.6);
    g.drawImage(groundCanvas(GROUND_PX, this.map), 0, 0, FIELD_W, FIELD_H);
    this.drawDetail();
    if (this.fx.decalCanvas) g.drawImage(this.fx.decalCanvas, 0, 0, FIELD_W, FIELD_H);
    // deploy zones
    const myTop = this.viewerSide === 0 ? FIELD_H - DEPLOY_D : 0;
    const enTop = this.viewerSide === 0 ? 0 : FIELD_H - DEPLOY_D;
    const mine = TEAM_PAL[0], theirs = TEAM_PAL[1];
    g.fillStyle = rgba(theirs.rim, 0.045);
    g.fillRect(0, enTop, FIELD_W, DEPLOY_D);
    g.fillStyle = rgba(mine.rim, showZone ? 0.14 : 0.045);
    g.fillRect(0, myTop, FIELD_W, DEPLOY_D);
    const lw = 1 / this.k;
    if (showZone) {
      g.strokeStyle = rgba(mine.accent, 0.13);
      g.lineWidth = lw;
      g.beginPath();
      for (let x = 1; x < FIELD_W; x++) { g.moveTo(x, myTop); g.lineTo(x, myTop + DEPLOY_D); }
      for (let y = 1; y < DEPLOY_D; y++) { g.moveTo(0, myTop + y); g.lineTo(FIELD_W, myTop + y); }
      g.stroke();
    }
    // zone front lines
    const myFront = this.viewerSide === 0 ? myTop : DEPLOY_D;
    const enFront = this.viewerSide === 0 ? DEPLOY_D : FIELD_H - DEPLOY_D;
    g.lineWidth = lw * (showZone ? 2 : 1.5);
    g.setLineDash([0.5, 0.3]);
    g.strokeStyle = rgba(mine.rim, showZone ? 0.8 : 0.5);
    g.beginPath(); g.moveTo(0, myFront); g.lineTo(FIELD_W, myFront); g.stroke();
    g.strokeStyle = rgba(theirs.rim, 0.5);
    g.beginPath(); g.moveTo(0, enFront); g.lineTo(FIELD_W, enFront); g.stroke();
    g.setLineDash([]);
    // field border
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = lw * 1.5;
    g.strokeRect(0, 0, FIELD_W, FIELD_H);
  }

  /** hi-res ground patch for the visible area when zoomed in; rebuilt once the camera settles */
  private drawDetail(): void {
    const px = this.px;
    if (px < GROUND_PX * 1.2) { this.detail = null; return; }
    const g = this.g;
    // visible world rect
    const a = this.screenToWorld(0, 0), b = this.screenToWorld(this.cssW, this.cssH);
    const vx0 = Math.max(0, Math.min(a.x, b.x)), vx1 = Math.min(FIELD_W, Math.max(a.x, b.x));
    const vy0 = Math.max(0, Math.min(a.y, b.y)), vy1 = Math.min(FIELD_H, Math.max(a.y, b.y));
    let d = this.detail;
    const covers = !!d && vx0 >= d.x0 - 1e-6 && vx1 <= d.x1 + 1e-6 && vy0 >= d.y0 - 1e-6 && vy1 <= d.y1 + 1e-6;
    const sharp = !!d && d.px >= px * 0.8 && d.px <= px * 1.6;
    if ((!d || !covers || !sharp) && this.cam.still > 0.12) {
      const mx = (vx1 - vx0) * 0.3, my = (vy1 - vy0) * 0.3;
      const x0 = Math.max(0, vx0 - mx), x1 = Math.min(FIELD_W, vx1 + mx);
      const y0 = Math.max(0, vy0 - my), y1 = Math.min(FIELD_H, vy1 + my);
      const dpx = Math.min(px, 3800 / (x1 - x0), 3800 / (y1 - y0));
      d = this.detail = { c: groundRegion(dpx, x0, y0, x1, y1, this.map), x0, y0, x1, y1, px: dpx };
    }
    if (d && vx0 >= d.x0 - 1e-6 && vx1 <= d.x1 + 1e-6 && vy0 >= d.y0 - 1e-6 && vy1 <= d.y1 + 1e-6) {
      g.drawImage(d.c, d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    }
  }

  /** scale bar (bottom-left): a round number of metres */
  private drawScaleBar(): void {
    if (!this.scaleBar) return;
    const g = this.g;
    this.setScreen();
    const pxPerM = this.k / METERS_PER_CELL;
    let m = 5;
    for (const c of [5, 10, 25, 50, 100, 200, 250]) { m = c; if (c * pxPerM >= 56) break; }
    const len = m * pxPerM;
    const x = 12, y = this.cssH - 12;
    g.save();
    g.lineCap = 'butt';
    g.font = '600 11px system-ui, sans-serif';
    g.textBaseline = 'bottom';
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x, y); g.lineTo(x + len, y); g.lineTo(x + len, y - 5); g.stroke();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x, y); g.lineTo(x + len, y); g.lineTo(x + len, y - 5); g.stroke();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.strokeText(`${m} m`, x + 2, y - 4);
    g.fillText(`${m} m`, x + 2, y - 4);
    g.restore();
  }

  private drawVignette(): void {
    const g = this.g;
    this.setScreen();
    if (!this.vignette) {
      const cx = this.cssW / 2, cy = this.cssH / 2;
      const r = Math.hypot(cx, cy);
      const gr = g.createRadialGradient(cx, cy, r * 0.45, cx, cy, r * 1.05);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(1, 'rgba(0,0,0,0.45)');
      this.vignette = gr;
    }
    g.fillStyle = this.vignette;
    g.fillRect(0, 0, this.cssW, this.cssH);
  }

  /* ------------------------------------------------------------------------------------------ board */

  /** Deploy phase: static units and overlay. Call every frame (animates idle details). */
  drawBoard(units: BoardUnit[], overlay: BoardOverlay, time: number): void {
    this.checkSize();
    const g = this.g;
    const dt = this.time ? clamp(time - this.time, 0, 0.1) : 0;
    this.time = time;
    this.fx.update(dt);
    this.stepCamera(dt);
    this.drawGround(!!overlay.showZone, 0, 0);
    const px = this.spritePx;
    // hover footprint
    const hv = overlay.hover;
    if (hv) {
      const col = hv.valid ? '#46e88a' : '#ff4a4a';
      g.fillStyle = rgba(col, 0.22 + 0.06 * Math.sin(time * 6));
      const hw = hv.w ?? hv.size, hh = hv.h ?? hv.size;
      g.fillRect(hv.col, hv.row, hw, hh);
      g.strokeStyle = rgba(col, 0.9);
      g.lineWidth = 2 / this.k;
      g.strokeRect(hv.col + 0.04, hv.row + 0.04, hw - 0.08, hh - 0.08);
    }
    const poses: { u: BoardUnit; p: UnitPose; air: boolean }[] = [];
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const LS = layoutOf(u.design).S;
      if (LS >= 4 && !u.ghost && !u.dim) {
        const key = `${u.side}|${u.x}|${u.y}|${u.design.chassis}`;
        if (!this.landed.has(key)) {
          this.landed.add(key);
          this.fx.shockwave(u.x, u.y, 0.9 * LS, '#d8c8a0', 0.8);
          this.fx.shake(0.12 + 0.03 * LS);
        }
      }
      const seed = hash01(i * 7919 + Math.round(u.x * 13 + u.y * 101)) * 10;
      const p: UnitPose = {
        design: u.design, team: this.teamOf(u.side), x: u.x, y: u.y, angle: forwardAngle(u.side), time, seed,
        alpha: u.ghost ? 0.5 : u.dim ? 0.45 : 1, moving: false, odometer: 0,
      };
      poses.push({ u, p, air: layoutOf(u.design).air });
    }
    for (const pass of [false, true]) {
      for (const { u, p, air } of poses) {
        if (air !== pass) continue;
        drawUnitShadow(g, p, px, this.dirs);
        if (u.selected) {
          // footprint-shaped selection outline, rotated with the unit
          const LL = layoutOf(u.design);
          g.strokeStyle = rgba(TEAM_PAL[0].accent, 0.6 + 0.3 * Math.sin(time * 5));
          g.lineWidth = 2 / this.k;
          const tr = g.getTransform();
          g.translate(u.x, u.y); g.rotate(p.angle);
          const hx = LL.X * 0.5 + 0.12, hy = LL.Y * 0.5 + 0.12;
          g.beginPath();
          roundRect(g, -hx, -hy, hx * 2, hy * 2, Math.min(hx, hy) * 0.45);
          g.stroke();
          g.setTransform(tr);
        }
        drawUnit(g, p, px, this.dirs);
        if (u.invalid) {
          const s = unitSprites(u.design, p.team, px);
          g.globalAlpha = 0.55;
          const cs = Math.cos(p.angle), sn = Math.sin(p.angle);
          const tr = g.getTransform();
          g.transform(cs, sn, -sn, cs, u.x, u.y);
          g.drawImage(silhouette(s, '#ff3030'), -s.ext, -s.ext, s.ext * 2, s.ext * 2);
          g.setTransform(tr);
          g.globalAlpha = 1;
        }
      }
    }
    this.fx.draw(g, px, this.dirs.ux, this.dirs.uy);
    // level pips
    this.setScreen();
    for (const { u, p } of poses) if (u.level > 1 && !u.ghost) this.drawPips(u.x, u.y, boxHalf(u.design, p.angle).hy, u.level, 1);
    this.drawVignette();
    this.drawScaleBar();
  }

  /** level pips under the unit; hy = half height (cells) of the unit's rotated footprint on screen */
  private drawPips(x: number, y: number, hy: number, level: number, alpha: number): void {
    const g = this.g;
    const p = this.worldToScreen(x, y);
    const half = hy * this.k * 0.9;
    const sz = Math.max(3, Math.min(6, this.k * 0.18));
    const by = p.y + half + sz * 0.3;
    g.globalAlpha = alpha;
    for (let i = 0; i < level - 1; i++) {
      const cx = p.x + (i - (level - 2) / 2) * sz * 1.5;
      g.beginPath();
      g.moveTo(cx - sz * 0.6, by);
      g.lineTo(cx, by + sz * 0.55);
      g.lineTo(cx + sz * 0.6, by);
      g.lineTo(cx + sz * 0.6, by - sz * 0.4);
      g.lineTo(cx, by + sz * 0.15);
      g.lineTo(cx - sz * 0.6, by - sz * 0.4);
      g.closePath();
      g.fillStyle = '#ffd24a';
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /* ----------------------------------------------------------------------------------------- battle */

  private reset(b: Battle): void {
    this.battle = b;
    this.lastTick = -1;
    this.prevU.clear();
    this.curU.clear();
    this.prevP.clear();
    this.curP.clear();
    this.ptrack.clear();
    this.vis.clear();
    this.fx.clear();
    this.sinceTick = 0;
  }

  private snapshot(b: Battle): void {
    this.prevU = this.curU;
    this.curU = new Map();
    this.units.clear();
    for (const u of b.units) {
      this.units.set(u.id, u);
      if (!u.alive) continue;
      this.curU.set(u.id, { x: u.x, y: u.y, angle: u.angle, mounts: u.mounts.map((m) => m.angle), odo: u.odometer });
    }
    this.prevP = this.curP;
    this.curP = new Map();
    for (const p of b.projectiles) {
      this.curP.set(p.id, { x: p.x, y: p.y, z: p.z, angle: p.angle, progress: p.progress });
      if (!this.ptrack.has(p.id)) {
        // projectiles spawn at their first observed position; start interpolation there
        // the sim spawns rounds at the hull edge; draw them leaving the barrel tip and blend onto the true path
        const tip = p.src !== undefined && p.mount !== undefined && p.z <= 0.5 ? this.muzzleOf(p.src, p.mount) : null;
        this.ptrack.set(p.id, { sx: p.x, sy: p.y, lx: p.x, ly: p.y, kind: p.kind, moduleId: p.moduleId, side: p.side, born: this.time, ox: tip ? tip.x - p.x : 0, oy: tip ? tip.y - p.y : 0 });
      }
    }
  }

  /** Battle phase: draw the sim's current state and spawn fx/sfx for queued events. */
  drawBattle(battle: Battle, frameDt: number): void {
    this.checkSize();
    const dt = clamp(frameDt, 0, 0.1);
    this.time += dt;
    if (battle !== this.battle || battle.tick < this.lastTick) this.reset(battle);
    let newTicks: BattleEvent[] | null = null;
    if (battle.tick !== this.lastTick) {
      if (this.lastTick >= 0) {
        const interval = this.sinceTick / Math.max(1, battle.tick - this.lastTick);
        this.tickInterval = clamp(lerp(this.tickInterval, Math.max(interval, 1 / 240) * Math.max(1, battle.tick - this.lastTick), 0.3), 1 / 120, 0.25);
      }
      this.snapshot(battle);
      if (this.lastTick < 0) this.prevU = new Map(this.curU);
      this.handleVanished(battle);
      this.lastTick = battle.tick;
      this.sinceTick = 0;
      if (!this.usePush) newTicks = battle.events;
    } else this.sinceTick += dt;
    this.alpha = clamp(this.sinceTick / this.tickInterval, 0, 1);

    const events = newTicks ?? this.pending;
    if (events.length) {
      for (const e of events) this.handleEvent(e);
      if (!this.muted) try { battleSfx(events); } catch { /* audio optional */ }
      if (!newTicks) this.pending = [];
    }
    this.fx.update(dt);
    this.stepCamera(dt);
    for (const v of this.vis.values()) {
      for (let i = 0; i < v.swing.length; i++) v.swing[i] = Math.max(0, v.swing[i] - dt * 3.5);
      if (v.heat) for (let i = 0; i < v.heat.length; i++) v.heat[i] = Math.max(0, v.heat[i] - dt * 0.9);
    }

    const g = this.g;
    const { sx, sy } = this.shakeOffset();
    this.drawGround(false, sx, sy);
    const px = this.spritePx;

    // poses
    const ground: UnitPose[] = [], air: UnitPose[] = [];
    const bars: { u: SimUnit; p: UnitPose }[] = [];
    for (const u of battle.units) {
      if (!u.alive) continue;
      const p = this.poseOf(u);
      const LL = layoutOf(u.design);
      if (LL.mob.id === 'titanlegs' && LL.S >= 4 && p.moving) {
        const vv = this.visOf(u);
        const ph = ((p.odometer ?? 0) / LL.cycle) % 1;
        const lp = vv.lastPh;
        if (lp !== undefined && ph !== lp) {
          for (const c of [0.25, 0.75]) {
            const a = lp <= ph ? lp < c && ph >= c : lp < c || ph >= c;
            if (a && Math.abs(ph - lp) < 0.5) {
              // titan footfall: a real jolt of the camera and a dust ring where the foot came down
              this.fx.shake(0.12 + 0.08 * LL.S);
              const cs = Math.cos(p.angle), sn = Math.sin(p.angle);
              for (const f of titanFeet(LL, c, false)) {
                if (f.a > 0.25 && f.a < P2 - 0.25) continue;
                const fx = p.x + cs * f.x - sn * f.y, fy = p.y + sn * f.x + cs * f.y;
                this.fx.dust(fx, fy, 0.35 * LL.S * 0.4, 7, 1.0);
                this.fx.ring(fx, fy, 0.2, 0.55 * LL.S * 0.5, '#d8c8a0', 0.45, 0.45);
                this.fx.decal('scorch', fx, fy, 0.18 * LL.S * 0.5);
              }
            }
          }
        }
        vv.lastPh = ph;
      }
      (u.flying ? air : ground).push(p);
      bars.push({ u, p });
    }
    // arc markers on the ground
    this.drawArcMarkers(g, battle.projectiles);
    for (const p of ground) drawUnitShadow(g, p, px, this.dirs);
    for (const p of ground) drawUnit(g, p, px, this.dirs);
    this.drawShields(g, bars.filter((b) => !b.u.flying));
    this.drawProjectiles(g, battle.projectiles, false, dt);
    for (const p of air) drawUnitShadow(g, p, px, this.dirs);
    for (const p of air) drawUnit(g, p, px, this.dirs);
    this.drawShields(g, bars.filter((b) => b.u.flying));
    this.drawProjectiles(g, battle.projectiles, true, dt);
    this.fx.draw(g, px, this.dirs.ux, this.dirs.uy);
    // overlays
    this.setScreen();
    for (const { u, p } of bars) this.drawBar(u, p, dt);
    this.drawVignette();
    this.drawFlash();
    this.drawScaleBar();
  }

  /**
   * Camera shake (CSS px). Photosensitivity-safe: none at the fit / zoomed-out view, ramping in only when zoomed in
   * close, hard-capped at SHAKE_CAP px no matter how many sources stack (trauma saturates at 1), and driven by smooth
   * low-frequency sines (2-5 Hz) instead of per-frame random jitter.
   */
  private shakeOffset(): { sx: number; sy: number } {
    const tr = this.fx.trauma * this.fx.trauma;
    if (tr <= 0.001 || this.shakeScale <= 0) return { sx: 0, sy: 0 };
    const z = this.cam.k / this.cam.minK;
    const zf = Math.max(0, Math.min(1, (z - 1.6) / 2.4));
    const amp = SHAKE_CAP * Math.min(1, tr) * zf * Math.max(0, Math.min(1, this.shakeScale));
    if (amp <= 0.01) return { sx: 0, sy: 0 };
    const t = this.time;
    const nx = Math.sin(t * 2 * Math.PI * 3.1) * 0.6 + Math.sin(t * 2 * Math.PI * 4.7 + 1.3) * 0.4;
    const ny = Math.sin(t * 2 * Math.PI * 2.6 + 0.7) * 0.6 + Math.sin(t * 2 * Math.PI * 4.3 + 2.1) * 0.4;
    return { sx: nx * amp, sy: ny * amp };
  }

  /** Full-screen flash for titan weapon moments (nuke, mass driver, doomsday, titan deaths): soft, short, rate-limited. */
  private drawFlash(): void {
    const a = this.fx.flashA * Math.max(0, Math.min(1, this.flashScale));
    if (a <= 0.01) return;
    const g = this.g;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = Math.min(FLASH_CAP, a * FLASH_CAP);
    g.fillStyle = this.fx.flashC;
    g.fillRect(0, 0, this.cssW, this.cssH);
    g.restore();
  }

  private landed = new Set<string>();
  /** heat of the annihilator that fired most recently (fire event precedes its beam event) */
  private beamHeat = 0;

  private visOf(u: SimUnit): UVis {
    let v = this.vis.get(u.id);
    if (!v) {
      v = { shieldT: -9, dmgT: -99, healT: -99, hpLast: u.hp, shLast: u.shield, hpShown: u.hp, swing: u.mounts.map(() => 0), seen: this.time };
      this.vis.set(u.id, v);
    }
    return v;
  }

  private poseOf(u: SimUnit): UnitPose {
    const a = this.alpha;
    const c = this.curU.get(u.id);
    const pr = this.prevU.get(u.id) ?? c;
    const v = this.visOf(u);
    let x = u.x, y = u.y, ang = u.angle, odo = u.odometer;
    let mounts: MountPose[];
    if (c && pr) {
      x = lerp(pr.x, c.x, a);
      y = lerp(pr.y, c.y, a);
      if (Math.hypot(c.x - pr.x, c.y - pr.y) > 3) { x = c.x; y = c.y; }
      ang = lerpAngle(pr.angle, c.angle, a);
      odo = lerp(pr.odo, c.odo, a);
      mounts = u.mounts.map((m, i) => ({
        angle: this.barrelAim(u, i, x, y, ang, lerpAngle(pr.mounts[i] ?? m.angle, c.mounts[i] ?? m.angle, a)),
        flash: m.flash, swing: v.swing[i] ?? 0, reloading: m.reloading, cd: m.cooldown, armed: m.target >= 0, heat: v.heat?.[i] ?? 0,
      }));
    } else mounts = u.mounts.map((m, i) => ({ angle: this.barrelAim(u, i, x, y, ang, m.angle), flash: m.flash, swing: v.swing[i] ?? 0, reloading: m.reloading, cd: m.cooldown, armed: m.target >= 0, heat: v.heat?.[i] ?? 0 }));
    const ext = u as SimUnit & { cloaked?: boolean };
    return {
      design: u.design, team: this.teamOf(u.side), x, y, angle: ang, time: this.time, odometer: odo, moving: u.moving,
      leap: u.leap, flying: u.flying, hitFlash: u.hitFlash, mounts, seed: (u.id * 0.618) % 10,
      stun: u.stun, slow: u.slow, burning: u.burning, disarm: u.disarm,
      cloak: ext.cloaked ? (u.side === this.viewerSide ? 'own' : 'enemy') : undefined,
    };
  }

  private drawShields(g: Ctx, list: { u: SimUnit; p: UnitPose }[]): void {
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    for (const { u, p } of list) {
      if (u.shield <= 0) continue;
      const v = this.visOf(u);
      const since = this.time - v.shieldT;
      const hit = since < 0.6 ? 1 - since / 0.6 : 0;
      const frac = u.maxShield > 0 ? u.shield / u.maxShield : 0.5;
      const a = 0.07 + 0.05 * frac + hit * 0.45;
      if (p.cloak === 'enemy') continue;
      const r = 0.58 * layoutOf(u.design).D;
      const lx = p.x + this.dirs.ux * (u.flying ? 0.12 : 0), ly = p.y + this.dirs.uy * (u.flying ? 0.12 : 0);
      g.globalAlpha = a;
      const hexT = tinted('hex', '#7fd8ff');
      if (hexT && hit > 0.05) {
        g.save();
        g.beginPath();
        g.arc(lx, ly, r, 0, Math.PI * 2);
        g.clip();
        g.drawImage(hexT, lx - r, ly - r, r * 2, r * 2);
        g.restore();
      }
      g.drawImage(softDot('rgba(127,216,255,0.35)', 0.6), lx - r, ly - r, r * 2, r * 2);
      g.strokeStyle = '#9fe4ff';
      g.lineWidth = Math.max(1 / this.k, 0.035);
      g.globalAlpha = Math.min(1, a * 2.2);
      g.beginPath();
      g.arc(lx, ly, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = prev;
  }

  private drawBar(u: SimUnit, p: UnitPose, dt: number): void {
    const v = this.visOf(u);
    v.hpShown = v.hpShown > u.hp ? Math.max(u.hp, v.hpShown - (u.maxHp * 0.6 + (v.hpShown - u.hp) * 3) * dt) : u.hp;
    // damage / heal detection from state (burn, splash, auras) on top of 'hit' events
    if (u.hp < v.hpLast - 0.01 || u.shield < v.shLast - 0.01) v.dmgT = this.time;
    else if (u.hp > v.hpLast + 0.5) v.healT = this.time;
    v.hpLast = u.hp;
    v.shLast = u.shield;
    if (p.cloak === 'enemy') return;
    const S = layoutOf(u.design).S;
    // footprint: bar width follows the unit's mean edge, and it sits just above the rotated footprint box
    const bh = boxHalf(u.design, p.angle);
    if (u.level > 1) this.drawPips(p.x, p.y, bh.hy, u.level, 0.9);
    const vis = this.barAlpha(v, S);
    if (vis <= 0.01) return;
    const g = this.g;
    g.globalAlpha = vis;
    if (S >= 4) { this.drawBossBar(u, p, v, S, bh); g.globalAlpha = 1; return; }
    const s = this.worldToScreen(p.x, p.y);
    const lift = u.flying ? 0.12 * this.k : 0;
    const w = Math.max(14, bh.w * this.k * 0.78);
    const h = S >= 2 ? 4 : 3;
    const x = Math.round(s.x - w / 2);
    const y = Math.round(s.y - bh.hy * this.k * 1.04 - h - 3 - lift);
    g.fillStyle = 'rgba(0,0,0,0.88)';
    g.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
    const f = clamp(u.hp / u.maxHp, 0, 1), fs = clamp(v.hpShown / u.maxHp, 0, 1);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(x, y, w * fs, h);
    const team = this.teamOf(u.side);
    g.fillStyle = f < 0.3 ? (team === 0 ? '#ffd24a' : '#ff3a2a') : TEAM_PAL[team].bar;
    g.fillRect(x, y, w * f, h);
    if (u.maxShield > 0 && u.shield > 0) {
      g.fillStyle = '#8fe0ff';
      g.fillRect(x, y - 2, w * clamp(u.shield / u.maxShield, 0, 1), 1.5);
    }
    g.globalAlpha = 1;
  }

  /** Bar opacity: visible ~3 s after the last damage (giants ~5 s), ~1.2 s after a heal, then a 0.7 s fade. */
  private barAlpha(v: UVis, S: number): number {
    if (this.alwaysShowHealth || this.altHeld) return 1;
    const hold = S >= 4 ? 5 : 3, fade = 0.7;
    const f = (since: number, h: number) => (since < h ? 1 : since < h + fade ? 1 - (since - h) / fade : 0);
    return Math.max(f(this.time - v.dmgT, hold), f(this.time - v.healT, 1.2));
  }

  /** Wide segmented 'boss' bar for giants and titans (shown after damage, like the small bars), team-coloured frame, white trailing chip. */
  private drawBossBar(u: SimUnit, p: UnitPose, v: UVis, S: number, bh: { hy: number; w: number }): void {
    const g = this.g;
    const s = this.worldToScreen(p.x, p.y);
    const lift = u.flying ? 0.12 * this.k : 0;
    const team = this.teamOf(u.side);
    const col = TEAM_PAL[team].bar;
    const w = Math.max(40, bh.w * this.k * 1.0), h = S >= 5 ? 9 : 7;
    const x = Math.round(s.x - w / 2);
    const y = Math.round(s.y - bh.hy * this.k * 1.1 - h - 5 - lift);
    g.fillStyle = 'rgba(0,0,0,0.9)';
    g.fillRect(x - 3, y - 3, w + 6, h + 6);
    g.strokeStyle = TEAM_PAL[team].rim;
    g.lineWidth = 1.5;
    g.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5);
    const f = clamp(u.hp / u.maxHp, 0, 1), fs = clamp(v.hpShown / u.maxHp, 0, 1);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(x, y, w * fs, h);
    const gr = g.createLinearGradient(0, y, 0, y + h);
    const base = f < 0.3 ? (team === 0 ? '#ffd24a' : '#ff3a2a') : col;
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, base); gr.addColorStop(1, shade(base, -0.4));
    g.fillStyle = gr;
    g.fillRect(x, y, w * f, h);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    for (let i = 1; i < 10; i++) g.fillRect(Math.round(x + (w * i) / 10), y, 1, h);
    if (u.maxShield > 0 && u.shield > 0) {
      g.fillStyle = '#8fe0ff';
      g.fillRect(x, y - 4, w * clamp(u.shield / u.maxShield, 0, 1), 2);
    }
    // corner ticks
    g.fillStyle = TEAM_PAL[team].rim;
    g.fillRect(x - 5, y - 1, 3, h + 2);
    g.fillRect(x + w + 2, y - 1, 3, h + 2);
  }

  /* ------------------------------------------------------------------------------------ projectiles */

  private projPos(p: SimProjectile): PSnap {
    const c = this.curP.get(p.id);
    const pr = this.prevP.get(p.id);
    if (!c) return p;
    if (!pr) return c;
    const a = this.alpha;
    return { x: lerp(pr.x, c.x, a), y: lerp(pr.y, c.y, a), z: lerp(pr.z, c.z, a), angle: lerpAngle(pr.angle, c.angle, a), progress: lerp(pr.progress, c.progress, a) };
  }

  /** Projectiles that disappeared since the last tick without a nearby hit/explosion: ground impact puff. */
  private handleVanished(b: Battle): void {
    if (!this.prevP.size) return;
    const evs = this.usePush ? this.pending : b.events;
    for (const [id, last] of this.prevP) {
      if (this.curP.has(id)) continue;
      const t = this.ptrack.get(id);
      this.ptrack.delete(id);
      if (!t) continue;
      if (t.kind !== 'bullet' && t.kind !== 'shell' && t.kind !== 'rocket') continue;
      // extrapolate one tick forward to where it would land
      const x = last.x, y = last.y;
      let near = false;
      for (const e of evs) {
        if ((e.t === 'hit' || e.t === 'explode') && Math.abs(e.x - x) < 1.6 && Math.abs(e.y - y) < 1.6) { near = true; break; }
      }
      if (near) continue;
      if (x < 0 || y < 0 || x > FIELD_W || y > FIELD_H) continue;
      this.fx.dust(x, y, t.kind === 'shell' ? 0.3 : 0.15, t.kind === 'shell' ? 4 : 2, 0.6);
      this.fx.sparks(x, y, 3, '#ffd890', 2.5, undefined, Math.PI, 0.18);
      if (t.kind !== 'bullet') this.fx.decal('scorch', x, y, 0.2);
    }
  }

  private drawArcMarkers(g: Ctx, list: SimProjectile[]): void {
    for (const p of list) {
      if (p.kind !== 'arc') continue;
      const t = this.ptrack.get(p.id);
      if (!t) continue;
      const pos = this.projPos(p);
      // shadow on the ground under the shell
      const h = pos.z;
      const r = 0.12 + 0.06 * h;
      g.globalAlpha = clamp(0.5 - h * 0.05, 0.15, 0.5);
      g.drawImage(softDot('rgba(0,0,0,0.9)', 0.3), pos.x + this.dirs.sx * h * 0.3 - r, pos.y + this.dirs.sy * h * 0.3 - r, r * 2, r * 2);
      g.globalAlpha = 1;
      const pr = pos.progress;
      if (pr < 0.04) continue;
      const lx = t.sx + (pos.x - t.sx) / pr, ly = t.sy + (pos.y - t.sy) / pr;
      const mod = modOf(p.moduleId);
      const rad = Math.max(0.5, mod?.splash ?? 1);
      const enemy = p.side !== this.viewerSide;
      const col = enemy ? '#ff5a30' : '#4fe8ff';
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 10 + p.id);
      g.globalAlpha = (enemy ? 0.55 : 0.4) * (0.4 + 0.6 * pr);
      g.fillStyle = rgba(col, 0.2 + 0.14 * pr);
      g.beginPath();
      g.arc(lx, ly, rad * (1.05 - pr * 0.05), 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 0.95 * (0.6 + 0.4 * pulse);
      g.lineWidth = Math.max(3.2 / this.k, 0.08);
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.beginPath(); g.arc(lx, ly, rad * pr, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = col;
      g.lineWidth = Math.max(1.8 / this.k, 0.05);
      g.beginPath();
      g.arc(lx, ly, rad * pr, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([0.2, 0.15]);
      g.beginPath();
      g.arc(lx, ly, rad, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
  }

  private drawProjectiles(g: Ctx, list: SimProjectile[], elevated: boolean, dt: number): void {
    const prevOp = g.globalCompositeOperation;
    const minW = 1.5 / this.px;
    for (const p of list) {
      const kind = p.kind as string;
      const isHigh = kind === 'arc' || kind === 'missile';
      if (isHigh !== elevated) continue;
      let pos = this.projPos(p);
      const t = this.ptrack.get(p.id);
      if (t && (t.ox || t.oy)) {
        const f = Math.max(0, 1 - Math.hypot(pos.x - t.sx, pos.y - t.sy) / MUZZLE_BLEND);
        if (f > 0) pos = { ...pos, x: pos.x + t.ox! * f, y: pos.y + t.oy! * f };
      }
      const mod = modOf(p.moduleId);
      const vis = mod?.visual;
      const cal = mod?.caliber ?? 0.5;
      const cs = Math.cos(pos.angle), sn = Math.sin(pos.angle);
      const lift = kind === 'missile' ? Math.min(0.6, pos.z * 0.4) : kind === 'arc' ? pos.z * 0.45 : 0;
      const x = pos.x + this.dirs.ux * lift, y = pos.y + this.dirs.uy * lift;
      const glowC = mod ? moduleGlow(mod, TEAM_PAL[this.teamOf(p.side)]) : '#ffd27a';
      // dark soft backing (normal blend) so additive tracers/shells stay visible on any ground
      if (kind === 'bullet' || kind === 'shell' || kind === 'rocket' || kind === 'missile' || kind === 'arc') {
        const len = kind === 'bullet' ? 0.4 : kind === 'rocket' ? 0.3 : kind === 'missile' ? 0.35 : 0.2;
        g.globalCompositeOperation = prevOp;
        g.globalAlpha = 0.5;
        g.strokeStyle = '#05070a';
        g.lineCap = 'round';
        g.lineWidth = Math.max(4 / this.px, kind === 'arc' ? 0.28 : 0.12);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * len, y - sn * len); g.stroke();
        g.globalAlpha = 1;
      }
      g.globalCompositeOperation = 'lighter';
      switch (kind) {
        case 'bullet': {
          const sniper = vis === 'sniper';
          const big = mod ? (mod.mount === 'M' ? 1.4 : mod.mount === 'H' ? 1.8 : 1) * (0.6 + cal) : 1;
          const len = sniper ? 0.9 : 0.22 + 0.2 * big;
          const w = sniper ? 0.05 : 0.025 + 0.022 * big;
          const col = sniper ? '#ff5050' : mod?.category === 'autocannon' ? '#ffb050' : '#ffe27a';
          g.strokeStyle = col;
          g.globalAlpha = 0.5;
          g.lineWidth = Math.max(minW * 2, w * 2.2);
          g.lineCap = 'round';
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * len, y - sn * len); g.stroke();
          g.globalAlpha = 1;
          g.strokeStyle = '#fff8e0';
          g.lineWidth = Math.max(minW, w * 0.8);
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * len * 0.6, y - sn * len * 0.6); g.stroke();
          break;
        }
        case 'shell': {
          if (vis === 'gauss') {
            g.strokeStyle = '#9fe8ff';
            g.globalAlpha = 0.45;
            g.lineWidth = Math.max(minW * 3, 0.14);
            g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * 1.6, y - sn * 1.6); g.stroke();
            g.globalAlpha = 1;
            g.strokeStyle = '#ffffff';
            g.lineWidth = Math.max(minW, 0.05);
            g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * 0.9, y - sn * 0.9); g.stroke();
            if (t && Math.random() < dt * 30) this.fx.ring(x, y, 0.05, 0.4, '#40ffc0', 0.3, 0.5);
          } else if (vis === 'flak') {
            const blink = 0.75 + 0.25 * Math.sin(this.time * 12 + p.id);
            g.globalAlpha = blink;
            g.drawImage(softDot('#ffd080', 0.3), x - 0.12, y - 0.12, 0.24, 0.24);
          } else {
            const r = 0.07 + 0.08 * cal * (mod?.mount === 'H' ? 1.3 : 1);
            g.drawImage(softDot('rgba(255,170,80,0.8)'), x - r * 3, y - r * 3, r * 6, r * 6);
            g.strokeStyle = '#ffe8c0';
            g.lineWidth = Math.max(minW, r * 1.1);
            g.lineCap = 'round';
            g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * r * 3, y - sn * r * 3); g.stroke();
          }
          break;
        }
        case 'rocket': {
          const incend = mod?.id === 'incendiary';
          g.globalCompositeOperation = prevOp;
          g.strokeStyle = '#d8d4c8';
          g.lineWidth = Math.max(minW * 1.5, 0.06);
          g.lineCap = 'round';
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * 0.22, y - sn * 0.22); g.stroke();
          g.globalCompositeOperation = 'lighter';
          const fl = 0.1 + Math.random() * 0.05;
          g.drawImage(softDot(incend ? 'rgba(255,120,30,0.9)' : 'rgba(255,90,40,0.9)'), x - cs * 0.25 - fl, y - sn * 0.25 - fl, fl * 2, fl * 2);
          this.trail(p.id, pos.x, pos.y, 0.12, '#3a342e', 0.06);
          break;
        }
        case 'missile': {
          const cruise = vis === 'cruise';
          const nuke = mod?.id === 'tactnuke';
          const sz = nuke ? 1.3 : cruise ? 0.5 : mod?.id === 'swarm' ? 0.16 : mod?.id === 'missilebattery' ? 0.3 : 0.26;
          // ground shadow
          g.globalCompositeOperation = prevOp;
          g.globalAlpha = 0.3;
          g.drawImage(softDot('rgba(0,0,0,0.9)', 0.3), pos.x + this.dirs.sx * lift - sz * 0.5, pos.y + this.dirs.sy * lift - sz * 0.5, sz, sz);
          g.globalAlpha = 1;
          g.strokeStyle = '#eeeae0';
          g.lineWidth = Math.max(minW * 1.5, sz * 0.28);
          g.lineCap = 'round';
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * sz, y - sn * sz); g.stroke();
          g.strokeStyle = cruise ? '#c0392b' : '#ff6a3a';
          g.lineWidth = Math.max(minW, sz * 0.2);
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * sz * 0.2, y - sn * sz * 0.2); g.stroke();
          g.globalCompositeOperation = 'lighter';
          const fr = sz * (0.4 + Math.random() * 0.2);
          const col = mod?.targetsAir && !mod.targetsGround ? 'rgba(120,170,255,0.9)' : 'rgba(255,220,120,0.9)';
          g.drawImage(softDot(col), x - cs * sz * 1.1 - fr, y - sn * sz * 1.1 - fr, fr * 2, fr * 2);
          if (nuke) { g.drawImage(softDot('rgba(255,120,40,0.9)'), x - cs * sz * 1.3 - fr * 1.6, y - sn * sz * 1.3 - fr * 1.6, fr * 3.2, fr * 3.2); g.drawImage(softDot('rgba(150,255,90,0.6)'), x - cs * sz * 0.5 - sz * 0.5, y - sn * sz * 0.5 - sz * 0.5, sz, sz); }
          this.trail(p.id, x - cs * sz, y - sn * sz, nuke ? 0.6 : cruise ? 0.3 : 0.14, nuke ? '#aaa49a' : '#8a8680', nuke ? 0.07 : cruise ? 0.04 : 0.05);
          break;
        }
        case 'flame': {
          const napalm = mod?.id === 'napalm';
          const prog = clamp(pos.progress, 0, 1);
          const r = (0.15 + prog * 0.45) * (napalm ? 1.3 : 1);
          g.globalAlpha = 0.85 * (1 - prog * 0.5);
          const img = tex('fireball') ?? softDot('rgba(255,130,40,0.9)');
          const rot = p.id * 1.7 + this.time * 3;
          const tr = g.getTransform();
          g.transform(Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot), x, y);
          g.drawImage(img, -r, -r, r * 2, r * 2);
          g.setTransform(tr);
          g.globalAlpha = 0.6 * (1 - prog);
          g.drawImage(softDot('rgba(255,240,180,1)'), x - r * 0.4, y - r * 0.4, r * 0.8, r * 0.8);
          if (Math.random() < dt * 8 && this.fx.busy < 0.5) this.fx.smoke(x, y, r * 0.5, 0.8, '#2a2420', 0, 0, 0.3);
          break;
        }
        case 'arc': {
          const sc = 1 + pos.z * 0.12;
          const r = (0.09 + 0.07 * cal) * sc;
          g.globalCompositeOperation = prevOp;
          g.fillStyle = '#2a2a28';
          g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#9a9a90';
          g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, Math.PI * 2); g.fill();
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = 0.6;
          g.drawImage(softDot('rgba(255,180,90,0.7)'), x - r * 2, y - r * 2, r * 4, r * 4);
          this.trail(p.id, x, y, 0.08 * sc, '#5a554e', 0.08);
          break;
        }
        case 'orb': {
          if (vis === 'sonic') {
            const r = 0.25 + clamp(pos.progress, 0, 1) * 0.5;
            const ring = tinted('shockwave', '#5ec8ff');
            g.globalAlpha = 0.85;
            if (ring) g.drawImage(ring, x - r, y - r, r * 2, r * 2);
            else { g.strokeStyle = '#5ec8ff'; g.lineWidth = 0.05; g.beginPath(); g.arc(x, y, r, pos.angle - 0.9, pos.angle + 0.9); g.stroke(); }
          } else if (vis === 'emp') {
            const r = 0.3;
            const img = tex('eball');
            const rot = this.time * 9 + p.id;
            if (img) {
              const tr = g.getTransform();
              g.transform(Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot), x, y);
              g.drawImage(img, -r, -r, r * 2, r * 2);
              g.setTransform(tr);
            } else g.drawImage(softDot('#7ab8ff', 0.3), x - r, y - r, r * 2, r * 2);
            if (Math.random() < dt * 20) this.fx.sparks(x, y, 1, '#cfe9ff', 2, undefined, Math.PI, 0.12);
          } else {
            const r = (0.18 + 0.12 * cal) * (mod?.mount === 'G' ? 2.1 : 1);
            g.drawImage(softDot(rgba(glowC.length === 7 ? glowC : '#e070ff', 0.6)), x - r * 2.5, y - r * 2.5, r * 5, r * 5);
            g.drawImage(softDot('#ffffff', 0.4), x - r * 0.6, y - r * 0.6, r * 1.2, r * 1.2);
            this.trail(p.id, x, y, r * 0.8, '#e070ff', 0.05, true);
          }
          break;
        }
        default: {
          g.drawImage(softDot('#ffe0a0', 0.3), x - 0.08, y - 0.08, 0.16, 0.16);
        }
      }
      g.globalAlpha = 1;
    }
    g.globalCompositeOperation = prevOp;
  }

  /** Emit trail particles along a projectile's path since it was last drawn. */
  private trail(id: number, x: number, y: number, r: number, color: string, spacing: number, glow = false): void {
    const t = this.ptrack.get(id);
    if (!t) return;
    const dx = x - t.lx, dy = y - t.ly;
    const d = Math.hypot(dx, dy);
    if (d > 4) { t.lx = x; t.ly = y; return; }
    const sp = spacing * (this.fx.busy > 0.6 ? 2.5 : 1);
    const n = Math.floor(d / sp);
    for (let i = 1; i <= n; i++) {
      const f = (i * sp) / d;
      const px = t.lx + dx * f, py = t.ly + dy * f;
      if (glow) this.fx.glow(px, py, r, color, 0.25, 0.5);
      else this.fx.smoke(px, py, r, 0.9, color, 0, 0, 0.35);
    }
    if (n > 0) { t.lx += (dx * n * sp) / d; t.ly += (dy * n * sp) / d; }
  }

  /* ----------------------------------------------------------------------------------------- events */

  private unitRender(id: number): { u: SimUnit; x: number; y: number; angle: number } | null {
    const u = this.units.get(id);
    if (!u) return null;
    const c = this.curU.get(id), pr = this.prevU.get(id) ?? c;
    if (c && pr) return { u, x: lerp(pr.x, c.x, this.alpha), y: lerp(pr.y, c.y, this.alpha), angle: lerpAngle(pr.angle, c.angle, this.alpha) };
    return { u, x: u.x, y: u.y, angle: u.angle };
  }

  /** Barrel heading as drawn. The sim aims every mount from the hull centre; turrets sit off-centre, so while a mount
   *  is tracking its target the drawn barrel swings onto it from its real pivot (the sim only fires once aligned). */
  private barrelAim(u: SimUnit, i: number, x: number, y: number, hull: number, simAng: number): number {
    const tid = u.mounts[i]?.target ?? -1;
    if (tid < 0) return simAng;
    const t = this.unitRender(tid);
    const mp = layoutOf(u.design).mounts[i];
    if (!t || !t.u.alive || !mp) return simAng;
    const cs = Math.cos(hull), sn = Math.sin(hull);
    const px = x + cs * mp.x - sn * mp.y, py = y + sn * mp.x + cs * mp.y;
    const center = Math.atan2(t.y - y, t.x - x);
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const k = clamp(1 - Math.abs(wrap(simAng - center)) / 0.5, 0, 1);
    return simAng + wrap(Math.atan2(t.y - py, t.x - px) - center) * k;
  }

  /** World position of a mount's barrel tip right now (as drawn), and the barrel heading. */
  private muzzleOf(unitId: number, mount: number): { x: number; y: number; d: number; aim: number } | null {
    const ur = this.unitRender(unitId);
    if (!ur || mount < 0 || !ur.u.mounts[mount]) return null;
    const aim = this.barrelAim(ur.u, mount, ur.x, ur.y, ur.angle, ur.u.mounts[mount].angle);
    const m = muzzlePos(ur.u.design, mount, ur.x, ur.y, ur.angle, aim);
    let mx = m.x, my = m.y;
    if (ur.u.flying) { mx += this.dirs.ux * 0.12; my += this.dirs.uy * 0.12; }
    return { x: mx, y: my, d: m.d, aim };
  }

  private handleEvent(e: BattleEvent): void {
    const fx = this.fx;
    switch (e.t) {
      case 'fire': {
        const mod = modOf(e.moduleId);
        const vis = mod?.visual;
        const ur = this.unitRender(e.unit);
        let mx = e.x, my = e.y, d = 0.3;
        const tip = this.muzzleOf(e.unit, e.mount);
        if (tip) e = { ...e, angle: tip.aim }; // flash / smoke follow the drawn barrel
        if (ur) {
          if (tip) { mx = tip.x; my = tip.y; d = tip.d; }
          const v = this.visOf(ur.u);
          if (mod?.category === 'melee') v.swing[e.mount] = 1;
          if (mod?.id === 'annihilator') {
            if (!v.heat) v.heat = ur.u.mounts.map(() => 0);
            v.heat[e.mount] = Math.min(1, (v.heat[e.mount] ?? 0) + 0.3);
            this.beamHeat = v.heat[e.mount];
          }
        }
        const cs = Math.cos(e.angle), sn = Math.sin(e.angle);
        const cal = mod?.caliber ?? 0.5;
        const glowC = moduleGlow(mod, TEAM_PAL[ur ? this.teamOf(ur.u.side) : 0]);
        if (mod && (mod.mount === 'G' || mod.mount === 'T') && mod.kind === 'weapon' && mod.category !== 'melee') {
          const T = mod.mount === 'T';
          const cc = mod.id === 'massdriver' ? '#9fe8ff' : mod.id === 'annihilator' || mod.id === 'siegeplasma' ? '#e070ff' : mod.id === 'stormcore' || mod.id === 'stormtower' ? '#a8d8ff' : '#ffd890';
          fx.glow(mx, my, (T ? 1.8 : 1.0) * (mod.cooldown && mod.cooldown < 0.2 ? 0.4 : 1), cc, 0.16);
          if (mod.cooldown === undefined || mod.cooldown >= 0.2) {
            fx.ring(mx, my, 0.1, T ? 2.4 : 1.4, cc, 0.3, 0.7);
            if (mod.id === 'doomsday' || mod.id === 'siege240') {
              fx.shockwave(mx, my, T ? 3.2 : 1.8, '#e0c8a0', 0.6); fx.shake(T ? 0.55 : 0.2);
              for (let i = 0; i < (T ? 10 : 6); i++) fx.smoke(mx + cs * 0.3, my + sn * 0.3, T ? 0.6 : 0.4, T ? 2.2 : 1.6, '#6a6660', cs * (T ? 2.4 : 1.5) + (Math.random() - 0.5) * 1.5, sn * (T ? 2.4 : 1.5) + (Math.random() - 0.5) * 1.5, 0.5);
              if (T) {
                // doomsday: a muzzle blast the size of a tank — twin fire cones, blinding star, ground ring
                fx.flash(0.28, '#ffe8c0');
                const sx = -sn, sy = cs;
                for (const k of [-0.55, 0.55]) {
                  const bx = mx + sx * k * d * 0.5, by = my + sy * k * d * 0.5;
                  for (let j = 0; j < 4; j++) fx.star(bx + cs * (0.4 + j * 1.1), by + sn * (0.4 + j * 1.1), 2.8 - j * 0.55, j ? '#ffc070' : '#fff0c0', e.angle, 0.14 + j * 0.03);
                  for (const sd of [-1, 1]) for (let j = 0; j < 3; j++) fx.smoke(bx, by, 0.45, 1.6, '#8a8278', sx * sd * (2.5 + j) + cs * 0.6, sy * sd * (2.5 + j) + sn * 0.6, 0.6);
                  fx.glow(bx + cs * 0.8, by + sn * 0.8, 2.4, '#ffb060', 0.3, 0.9);
                  for (let i = 0; i < 9; i++) { const a = e.angle + (Math.random() - 0.5) * 0.7, v = 3 + Math.random() * 6; fx.fire(bx + cs * 0.3, by + sn * 0.3, 0.35 + Math.random() * 0.35, 0.35 + Math.random() * 0.25, Math.cos(a) * v, Math.sin(a) * v); }
                }
                fx.glow(mx, my, 3.6, '#ffffff', 0.12);
                fx.ring(mx, my, 0.3, 4.5, '#fff0d0', 0.45, 0.7);
                fx.sparks(mx, my, 24, '#ffd890', 9, e.angle, 0.5, 0.4);
                fx.dust(mx - cs * 1.2, my - sn * 1.2, 1.4, 10, 1.2);
              }
            }
            else if (mod.id === 'tactnuke') { fx.flash(0.18, '#ffd8a0'); fx.glow(mx, my, 2.4, '#ffb060', 0.35); for (let i = 0; i < 14; i++) fx.smoke(mx - cs * 0.6, my - sn * 0.6, 0.6, 2.8, '#8a8680', -cs * 2 + (Math.random() - 0.5) * 3, -sn * 2 + (Math.random() - 0.5) * 3, 0.65); fx.dust(mx, my, 1.4, 10, 1.4); fx.shake(0.45); }
            else if (T) fx.shake(0.25);
          }
        }
        switch (vis) {
          case 'gun': case 'gatling': case 'shotgun': case 'sniper': case 'flak': case 'cannon': case 'artillery': case 'gauss': {
            const heavy = vis === 'cannon' || vis === 'artillery' || vis === 'gauss';
            const r = d * (0.6 + cal * 0.8) * (heavy ? 1.5 : 1) * (vis === 'shotgun' ? 1.4 : 1);
            fx.star(mx + cs * r * 0.3, my + sn * r * 0.3, r, vis === 'gauss' ? '#9fe8ff' : '#ffd890', e.angle, heavy ? 0.1 : 0.06);
            fx.glow(mx, my, r * 1.3, vis === 'gauss' ? '#9fe8ff' : '#ffb060', heavy ? 0.14 : 0.07, 0.8);
            if (heavy || vis === 'shotgun') {
              fx.sparks(mx, my, heavy ? 6 : 4, '#ffd890', 5, e.angle, 0.35, 0.18);
              for (let i = 0; i < (heavy ? 3 : 1); i++) fx.smoke(mx + cs * 0.15, my + sn * 0.15, r * 0.5, 1.0, '#4a4640', cs * 1.2, sn * 1.2, 0.45);
              if (heavy && mod?.mount === 'H') fx.shake(0.12);
              if (heavy) fx.dust(mx - cs * d, my - sn * d, d * 0.8, 2, 0.5);
            } else if (fx.busy < 0.4 && Math.random() < 0.25) fx.debris(mx - cs * d, my - sn * d, 1, '#d8b040', 1.5, 0.02);
            break;
          }
          case 'rocketPod': case 'missileRack': case 'cruise': {
            const big = vis === 'cruise';
            fx.glow(mx, my, big ? 0.8 : 0.35, '#ffa050', 0.12);
            for (let i = 0; i < (big ? 6 : 2); i++) fx.smoke(mx - cs * d * 0.8, my - sn * d * 0.8, big ? 0.35 : 0.18, big ? 1.8 : 1, '#6a6660', -cs * 1.5 + (Math.random() - 0.5), -sn * 1.5 + (Math.random() - 0.5), 0.5);
            if (big) { fx.dust(mx, my, 0.8, 5); fx.shake(0.1); }
            break;
          }
          case 'mortar': {
            fx.glow(mx, my, 0.35, '#ffb060', 0.1);
            fx.ring(mx, my, 0.05, 0.5, '#ffe0b0', 0.2, 0.5);
            for (let i = 0; i < 3; i++) fx.smoke(mx, my, 0.18, 1.2, '#6a6660', 0, 0, 0.5);
            break;
          }
          case 'sonic':
            fx.ring(mx + cs * 0.2, my + sn * 0.2, 0.1, 0.9, '#5ec8ff', 0.25, 0.9);
            break;
          case 'flamer':
            fx.glow(mx, my, 0.18, '#ff9030', 0.08, 0.7);
            break;
          case 'repair': case 'pointdef':
            fx.glow(mx, my, 0.12, glowC, 0.08, 0.7);
            break;
          case 'saw': case 'chainsaw': case 'hammer': case 'claw': case 'blade': case 'drill': case 'prod': case 'ram':
            fx.sparks(mx, my, vis === 'hammer' ? 10 : 6, vis === 'blade' ? glowC : vis === 'prod' ? '#bfe4ff' : '#ffd890', 4, e.angle, 1.1, 0.25);
            if (vis === 'hammer' || vis === 'ram') { fx.dust(mx, my, 0.4, 3); fx.shake(vis === 'hammer' ? 0.15 : 0.05); }
            if (vis === 'prod') fx.bolt(mx, my, 0.3, '#bfe4ff', 0.15);
            break;
          default:
            fx.glow(mx, my, 0.2 + d * 0.3, glowC, 0.1, 0.8);
        }
        break;
      }
      case 'beam': {
        const mod = modOf(e.moduleId);
        const vis = mod?.visual;
        const glowC = moduleGlow(mod, TEAM_PAL[this.teamOf(e.side)]);
        const tip = e.unit !== undefined && e.mount !== undefined ? this.muzzleOf(e.unit, e.mount) : null;
        const pts = tip ? [tip.x, tip.y, e.x2, e.y2] : [e.x1, e.y1, e.x2, e.y2];
        let impact = true;
        switch (vis) {
          case 'heatray': fx.beam('heat', pts, '#ff6a1a', 0.07, 0.14); break;
          case 'plasma': {
            if (mod?.id === 'annihilator') {
              // warm-up: starts as a thin flickering lance and swells into a blinding river over ~1.5 s of fire
              const h = this.beamHeat;
              fx.beam('plasma', pts, '#e070ff', 0.08 + 0.34 * h * h, 0.24);
              fx.glow(e.x1, e.y1, 0.6 + 1.4 * h, '#ff80f0', 0.12, 0.9);
              fx.glow(e.x2, e.y2, 0.5 + 1.3 * h, '#ff90ff', 0.14, 0.9);
              if (h > 0.6) { fx.sparks(e.x2, e.y2, 5, '#ffd0ff', 6, undefined, Math.PI, 0.3); if (Math.random() < 0.3) fx.decal('scorch', e.x2, e.y2, 0.5); }
              if (h > 0.85) fx.shake(0.04);
            } else fx.beam('plasma', pts, '#e070ff', 0.09, 0.17);
            break;
          }
          case 'slowbeam': fx.beam('slow', pts, '#b47cff', 0.05, 0.22); break;
          case 'repair': fx.beam('repair', pts, '#6dff9a', 0.05, 0.25); impact = false; if (Math.random() < 0.3) fx.heal(e.x2, e.y2); break;
          case 'emp': fx.beam('scramble', pts, glowC, 0.05, 0.22); break;
          case 'gravity': {
            fx.beam('gravity', pts, '#b070ff', 0.07, 0.3);
            const dx = e.x1 - e.x2, dy = e.y1 - e.y2;
            for (let i = 0; i < 5; i++) {
              const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 0.4;
              fx.sparks(e.x2 + Math.cos(a) * r, e.y2 + Math.sin(a) * r, 1, '#c890ff', 2, Math.atan2(e.y2 - (e.y2 + Math.sin(a) * r), e.x2 - (e.x2 + Math.cos(a) * r)), 0.1, 0.3);
            }
            fx.sparks(e.x2, e.y2, 2, '#c890ff', 3, Math.atan2(dy, dx), 0.3, 0.3);
            impact = false;
            break;
          }
          case 'rail': {
            const heavy = (mod?.caliber ?? 0.5) > 0.7;
            const huge = mod?.mount === 'T';
            fx.beam('rail', pts, '#9fe8ff', huge ? 0.5 : heavy ? 0.1 : 0.06, huge ? 0.9 : heavy ? 0.5 : 0.35);
            if (huge) {
              // spinal mass driver: blinding flash, ionised trail, the ground torn up along the line
              fx.flash(0.5, '#d8f6ff');
              fx.glow(e.x1, e.y1, 3.2, '#ffffff', 0.18);
              const len = Math.hypot(e.x2 - e.x1, e.y2 - e.y1), n = Math.min(14, Math.floor(len / 1.4));
              for (let i = 1; i <= n; i++) {
                const f = i / (n + 1), qx = e.x1 + (e.x2 - e.x1) * f, qy = e.y1 + (e.y2 - e.y1) * f;
                fx.schedule(i * 0.012, () => { fx.dust(qx, qy, 0.5, 2, 0.9); fx.glow(qx, qy, 0.7, '#9fe8ff', 0.25, 0.6); });
              }
              fx.boom(e.x2, e.y2, 1.0, 'plasma');
            }
            fx.glow(e.x1, e.y1, huge ? 1.6 : heavy ? 0.7 : 0.45, '#9fe8ff', huge ? 0.35 : 0.2);
            fx.sparks(e.x2, e.y2, huge ? 24 : 10, '#cff4ff', huge ? 8 : 5, undefined, Math.PI, 0.3);
            if (huge) { fx.shockwave(e.x2, e.y2, 1.6, '#9fe8ff', 0.5); fx.ring(e.x1, e.y1, 0.2, 1.8, '#cff4ff', 0.35, 0.9); }
            if (huge) fx.shake(0.4); else if (heavy) fx.shake(0.18);
            break;
          }
          case 'pointdef': fx.beam('laser', pts, '#ff6060', 0.025, 0.08); impact = false; break;
          case 'sniper': fx.beam('sniper', pts, '#ff5050', 0.04, 0.2); break;
          default: fx.beam('laser', pts, glowC, 0.035, 0.12);
        }
        if (impact && fx.busy < 0.7) {
          fx.glow(e.x2, e.y2, 0.25, glowC, 0.1, 0.8);
          if (Math.random() < 0.6) fx.sparks(e.x2, e.y2, 3, glowC, 3, undefined, Math.PI, 0.2);
        }
        break;
      }
      case 'chain': {
        const mod = modOf(e.moduleId);
        const heavy = (mod?.caliber ?? 0.5) > 0.7;
        const col = mod?.visual === 'emp' ? '#cfeaff' : '#8fb8ff';
        const pts: number[] = [];
        for (const p of e.points) pts.push(p.x, p.y);
        const tip = e.unit !== undefined && e.mount !== undefined ? this.muzzleOf(e.unit, e.mount) : null;
        if (tip && pts.length >= 2) { pts[0] = tip.x; pts[1] = tip.y; }
        if (pts.length >= 4) fx.beam('lightning', pts, col, heavy ? 0.05 : 0.035, heavy ? 0.24 : 0.18);
        for (let i = 2; i < pts.length; i += 2) {
          fx.glow(pts[i], pts[i + 1], heavy ? 0.5 : 0.35, col, 0.15);
          fx.sparks(pts[i], pts[i + 1], 4, '#e0f0ff', 3, undefined, Math.PI, 0.2);
        }
        if (pts.length >= 2) fx.glow(pts[0], pts[1], 0.3, col, 0.12);
        break;
      }
      case 'hit': {
        const ur = this.units.get(e.unit);
        const mod = modOf(e.moduleId);
        if (!ur) {
          fx.dust(e.x, e.y, 0.2, 2, 0.6);
          fx.sparks(e.x, e.y, 3, '#ffd890', 2.5, undefined, Math.PI, 0.18);
          break;
        }
        if (e.damage > 0) this.visOf(ur).dmgT = this.time;
        if (e.shieldHit) {
          const v = this.visOf(ur);
          v.shieldT = this.time;
          if (fx.busy < 0.7) fx.hex(ur.x, ur.y, 0.58 * layoutOf(ur.design).D, e.x, e.y);
          fx.sparks(e.x, e.y, 3, '#bfefff', 2.5, undefined, Math.PI, 0.2);
          break;
        }
        const vis = mod?.visual;
        if (vis === 'flamer' || vis === 'heatray' || vis === 'repair') break;
        const n = clamp(Math.round(2 + Math.sqrt(e.damage) * 0.5), 2, 12);
        fx.sparks(e.x, e.y, n, '#ffe0a0', 3.5, undefined, Math.PI, 0.22);
        if (e.damage > 60) fx.glow(e.x, e.y, 0.3 + Math.min(0.5, e.damage / 400), '#ffc070', 0.1);
        break;
      }
      case 'explode': {
        const mod = modOf(e.moduleId);
        const vis = mod?.visual;
        const r = e.radius;
        const air = mod ? !mod.targetsGround && !!mod.targetsAir : false;
        if (mod?.id === 'tactnuke') fx.nuke(e.x, e.y, Math.max(2, r * 0.8));
        else if (mod?.id === 'doomsday') { fx.boom(e.x, e.y, r * 0.8, 'big'); fx.shake(0.45); }
        else if (vis === 'flak' || air) fx.boom(e.x, e.y, Math.max(0.4, r * 0.7), 'flak', false);
        else if (vis === 'emp') fx.boom(e.x, e.y, Math.max(0.4, r), 'emp');
        else if (vis === 'plasma') fx.boom(e.x, e.y, Math.max(0.4, r * 0.8), 'plasma');
        else if (vis === 'sonic') fx.boom(e.x, e.y, Math.max(0.5, r), 'sonic');
        else if (vis === 'pointdef') fx.boom(e.x, e.y, 0.25, 'flak', false);
        else if (mod?.burn || mod?.id === 'incendiary' || mod?.id === 'napalm') fx.boom(e.x, e.y, Math.max(0.35, r * 0.75), 'napalm');
        else if (r < 0.35) {
          fx.glow(e.x, e.y, 0.35, '#ffb060', 0.1);
          fx.sparks(e.x, e.y, 5, '#ffd890', 3, undefined, Math.PI, 0.2);
          fx.smoke(e.x, e.y, 0.15, 0.7, '#3a3430');
        } else {
          fx.boom(e.x, e.y, r * 0.8, vis === 'cruise' ? 'big' : 'fire');
          if (r >= 1.5) fx.shake(Math.min(0.5, r * 0.15));
        }
        break;
      }
      case 'heal': {
        const u = this.units.get(e.unit);
        if (u && Math.random() < 0.5) fx.heal(u.x, u.y);
        break;
      }
      case 'death': {
        const u = this.units.get(e.unit);
        const S = e.size || 1;
        const team = u ? this.teamOf(u.side) : 1;
        const x = e.x, y = e.y;
        const pal = TEAM_PAL[team];
        if (e.flying && S >= 4) {
          fx.megaDeath(x, y, S, pal.dark);
          if (u) fx.decal('wreck', x, y, 0, wreckSprite(u.design, team, DECAL_PX), unitSprites(u.design, team, DECAL_PX).ext * 0.9, u.angle + 0.6);
        } else if (e.flying) {
          fx.boom(x + this.dirs.ux * 0.3, y + this.dirs.uy * 0.3, 0.5 * S, 'fire', false);
          fx.debris(x, y, 6 * S, pal.dark, 2.5, 0.07 * S);
          fx.schedule(0.35, () => {
            fx.boom(x, y, 0.6 * S, 'fire');
            if (u) fx.decal('wreck', x, y, 0, wreckSprite(u.design, team, DECAL_PX), unitSprites(u.design, team, DECAL_PX).ext * 0.8, u.angle + 0.6);
          });
        } else if (S >= 4) {
          fx.megaDeath(x, y, S, pal.dark);
          if (u) fx.decal('wreck', x, y, 0, wreckSprite(u.design, team, DECAL_PX), unitSprites(u.design, team, DECAL_PX).ext, u.angle);
        } else {
          fx.boom(x, y, 0.55 + 0.45 * S, S >= 3 ? 'big' : 'fire');
          fx.debris(x, y, 5 + 5 * S, pal.dark, 3 + S, 0.06 * S);
          fx.debris(x, y, 3 + 2 * S, '#2a2622', 3, 0.05 * S);
          fx.embers(x, y, 6 * S, S * 0.6);
          if (u) fx.decal('wreck', x, y, 0, wreckSprite(u.design, team, DECAL_PX), unitSprites(u.design, team, DECAL_PX).ext, u.angle);
          for (let i = 0; i < S; i++) fx.schedule(0.15 + i * 0.2, () => fx.boom(x + (Math.random() - 0.5) * S * 0.6, y + (Math.random() - 0.5) * S * 0.6, 0.3 + 0.2 * S, 'fire'));
          // lingering smoke column
          for (let i = 0; i < 4; i++) fx.schedule(0.4 + i * 0.5, () => fx.smoke(x, y, 0.3 * S, 2.5, '#1e1c1a', 0.2, -0.3, 0.45));
        }
        fx.shake(0.1 + 0.12 * S);
        break;
      }
      case 'leap': {
        const u = this.units.get(e.unit);
        if (u) {
          const S = layoutOf(u.design).S;
          fx.dust(u.x, u.y, 0.4 * S, 6, 0.8);
          fx.ring(u.x, u.y, 0.2, 0.8 * S, '#d8c8a0', 0.3, 0.4);
        }
        break;
      }
      default: {
        const ev = e as { t: string; x?: number; y?: number; radius?: number; duration?: number };
        if (ev.t === 'smoke' && ev.x !== undefined && ev.y !== undefined) {
          const r = ev.radius ?? 1.5, dur = ev.duration ?? 5;
          const n = Math.round(6 + r * 5);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r * 0.8;
            fx.smoke(ev.x + Math.cos(a) * d, ev.y + Math.sin(a) * d, r * 0.45, dur, '#8a8a86', Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.7);
          }
          fx.ring(ev.x, ev.y, 0.2, r, '#c8c8c0', 0.4, 0.3);
        }
      }
    }
  }

  destroy(): void {
    this.keyOff?.();
    this.keyOff = null;
    this.controls.destroy();
    this.detail = null;
    this.fx.clear();
    this.battle = null;
    this.prevU.clear();
    this.curU.clear();
    this.units.clear();
    this.vis.clear();
    this.pending = [];
  }
}

/** Half extents (cells) of a unit's footprint box rotated to `ang` (screen-axis aligned), plus its mean edge. */
function boxHalf(d: Design, ang: number): { hx: number; hy: number; w: number } {
  const L = layoutOf(d);
  const c = Math.abs(Math.cos(ang)), sn = Math.abs(Math.sin(ang));
  return { hx: (c * L.X + sn * L.Y) / 2, hy: (sn * L.X + c * L.Y) / 2, w: (L.X + L.Y) / 2 };
}

/** Render a single design centered in a canvas (garage preview, cards). `time` animates rotors/legs. */
export interface PreviewGeom {
  /** CSS pixels per cell (1 cell = METERS_PER_CELL metres) */
  px: number;
  /** unit centre in CSS pixels */
  cx: number;
  cy: number;
  /** mount centres (CSS px) and turret radius (CSS px) */
  mounts: { x: number; y: number; r: number }[];
  /** chassis size in cells */
  S: number;
  /** rough half-extent of the drawn sprite (CSS px) */
  half: number;
}

/** Draw a design centred in the canvas. `minExtent` (cells) keeps small units small so a backdrop grid reads at true scale;
 *  `still` stops the walk cycle so mount markers stay put. Returns the on-screen geometry. */
export function drawUnitPreview(canvas: HTMLCanvasElement, design: Design, opts?: { side?: Side; time?: number; angle?: number; minExtent?: number; still?: boolean; zoom?: number; pan?: { x: number; y: number } }): PreviewGeom | null {
  let g: Ctx;
  try { g = ctx2d(canvas); } catch { return null; }
  const dpr = Math.min(3, typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (cw > 0 && ch > 0) {
    const w = Math.round(cw * dpr), h = Math.round(ch * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }
  const W = canvas.width, H = canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  let L;
  try { L = layoutOf(design); } catch { return null; }
  const time = opts?.time ?? 0;
  const ext0 = L.D * (L.S >= 4 ? (L.air ? 1.5 : L.mob.id === 'spider' ? 1.62 : L.S >= 5 ? 1.55 : 1.38) : L.air ? 1.25 : L.mob.id === 'spider' || CREATURE_SHAPES.has(L.shape) ? 1.36 : 1.1);
  const ext = Math.max(opts?.minExtent ?? 0, L.D * (L.S >= 4 ? (L.air ? 1.5 : L.mob.id === 'spider' ? 1.62 : L.S >= 5 ? 1.55 : 1.38) : L.air ? 1.25 : L.mob.id === 'spider' || CREATURE_SHAPES.has(L.shape) ? 1.36 : 1.1));
  // zoom > 1 magnifies; pan (cells) moves the view centre off the unit
  const px = (Math.min(W, H) / ext) * (opts?.zoom ?? 1);
  const pnx = opts?.pan?.x ?? 0, pny = opts?.pan?.y ?? 0;
  const ox = W / 2 - pnx * px, oy = H / 2 - pny * px;
  g.setTransform(px, 0, 0, px, ox, oy);
  const team: Team = (opts?.side ?? 0) === 1 ? 1 : 0;
  const angle = opts?.angle ?? -Math.PI / 2;
  const pose: UnitPose = {
    design, team, x: 0, y: L.air ? 0.1 * L.S : 0, angle, time,
    // the Needle Frame alternates running (arms folded) and standing (arms deployed) in animated previews
    moving: !opts?.still && L.mob.kind !== 'static' && (L.shape !== 'mantis' || time % 5 < 2.2), odometer: opts?.still ? 0 : time * Math.max(0.6, L.cycle * 1.5), seed: 1,
  };
  const dirs: ViewDirs = { sx: 0.45, sy: 0.75, ux: 0, uy: -1 };
  drawUnitShadow(g, pose, px, dirs);
  drawUnit(g, pose, px, dirs);
  g.setTransform(1, 0, 0, 1, 0, 0);
  // same placement maths as drawUnit's turret pass (lift + airborne scale)
  const k = cw > 0 ? cw / W : 1 / dpr;
  const lift = L.air ? 0.12 : 0;
  const sc = L.air ? 1.04 : 1;
  const ux = pose.x + dirs.ux * lift, uy = pose.y + dirs.uy * lift;
  const cs = Math.cos(angle), sn = Math.sin(angle);
  const mounts = mountPoints(design).map((m) => ({
    x: (ox + (ux + (cs * m.x - sn * m.y) * sc) * px) * k,
    y: (oy + (uy + (sn * m.x + cs * m.y) * sc) * px) * k,
    r: m.r * sc * px * k,
  }));
  return { px: px * k, cx: (ox + ux * px) * k, cy: (oy + uy * px) * k, mounts, S: L.S, half: (ext0 / 2) * 0.92 * px * k };
}
