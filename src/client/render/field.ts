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
import { battleSfx, setPanFlip, setSfxView } from '../audio.ts';
import { DEPLOY_D, FIELD_H, FIELD_W, METERS_PER_CELL } from '../../shared/grid.ts';
import { moduleTier } from '../../shared/parts.ts';
import { boreOf, calibreMm } from './weaponsize.ts';
import { bodyScale } from '../../shared/mountgeo.ts';
import { Camera, CameraControls } from './camera.ts';
import type { Battle } from '../../shared/sim/battle.ts';
import type { BattleEvent, DeathKind, SimProjectile, SimUnit, WreckLevel } from '../../shared/sim/types.ts';
import { DT } from '../../shared/sim/types.ts';
import type { Design, Side } from '../../shared/types.ts';
import { Fx, modOf, visualOf } from './fx.ts';
import { fireTex, glowTex, hash1, mixHex } from './vfx.ts';
import { MAPS, SURROUND, groundCanvas, groundRegion, surroundCanvas, type MapTheme } from './ground.ts';
import { TEAM_PAL, clamp, ctx2d, hash01, lerp, lerpAngle, rgba, roundRect, shade, softDot, type Ctx, type Team } from './palette.ts';
import { loadTextures, tex, tinted } from './textures.ts';
import { moduleGlow } from './turrets.ts';
import { titanFeet } from './giantart.ts';
import { TILT_COS, TILT_TAN, flyHeight, hullHeight } from './tilt.ts';

const P2 = Math.PI * 2;
/** cells of flight over which a round's drawn position slides from the barrel tip onto its simulated path */
const MUZZLE_BLEND = 2.5;
import {
  drawUnit, drawUnitShadow, layoutOf, mountPoints, muzzlePos, unitSprites, silhouette, wreckSprite, wreckHotspots,
  type MountPose, type UnitLayout, type UnitPose, type ViewDirs,
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
  /** visual-only knockback / recoil offset of the drawn sprite (cells), decays quickly */
  kx?: number;
  ky?: number;
  /** spin-up guns (ModuleDef.spinUp), per mount: 0..1 barrel speed as drawn (mirrors the sim: rises while it keeps
   *  firing, winds down after) and the battle time (s) of the last shot */
  spin?: number[];
  lastFire?: number[];
  /** focusing beams (ModuleDef.ramp), per mount: unit focused, battle time focus began and of the last pulse */
  ramp?: ({ t: number; start: number; last: number } | undefined)[];
  /** per mount: spin-up time (s) of a spin-up gun, 0 otherwise */
  spinT?: number[];
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
  /** sim progress when first seen (flash rounds estimate where they end from it) */
  k0?: number;
  /** barrel-tip offset at spawn, faded out over the first cells of flight */
  ox?: number;
  oy?: number;
  lx: number;
  ly: number;
  kind: string;
  moduleId: string;
  side: Side;
  born: number;
  /** cluster bomblet (spawned where its carrier shell burst, not at a barrel) */
  bomblet?: boolean;
}

/** fixed resolution (device px per cell) of the cached base ground and the decal layer */
const GROUND_PX = 24;
const DECAL_PX = 32;

/** height (cells) of the gun line above the ground: where bullets, beams and muzzle flashes leave a ground unit */
const GUN_H = 0.55;
/** hull side-wall colour per team (shaded paint, drawn as stacked cached silhouettes under the lifted hull) */
const WALL: [string, string] = [shade(TEAM_PAL[0].dark, -0.32), shade(TEAM_PAL[1].dark, -0.32)];
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
  /** camera tilt (2.5D look, see tilt.ts); default on */
  private tiltOn = true;
  /** vertical foreshortening of the ground plane: cos(tilt), 1 when the tilt is off */
  get ay(): number { return this.tiltOn ? TILT_COS : 1; }
  get tilted(): boolean { return this.tiltOn; }
  setTilt(on: boolean): void {
    if (on === this.tiltOn) return;
    this.tiltOn = on;
    this.cam.setAspect(this.ay);
    this.detail = null;
  }
  /** world-space shift for a point `h` cells above the ground (along the viewer's screen-up) */
  private liftVec(h: number): { x: number; y: number } {
    const l = this.tiltOn ? h * TILT_TAN : 0;
    return { x: this.dirs.ux * l, y: this.dirs.uy * l };
  }
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
  /** render clock (fractional sim ticks): advances smoothly at the observed tick rate, about one tick behind the newest
   *  snapshot, and is clamped between the two snapshots it interpolates (prevTick..curTick) */
  private rt = 0;
  private tickRate = 1 / DT;
  private prevTick = 0;
  private curTick = 0;
  private rateWin = { n: 0, t: 0 };
  private prevU = new Map<number, USnap>();
  private curU = new Map<number, USnap>();
  private prevP = new Map<number, PSnap>();
  private curP = new Map<number, PSnap>();
  private ptrack = new Map<number, PTrack>();
  private units = new Map<number, SimUnit>();
  /** origin of the latest beam / arc at each unit this tick, so its 'hit' sparks land on the facing hull edge */
  private shotFrom = new Map<number, { x: number; y: number }>();
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
    this.cam.setAspect(this.ay);
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
    return this.cssH / 2 - this.cam.cy * this.cam.k * this.ay;
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
    let k = Math.min(c.vw / FIELD_W, c.vh / (rows * c.ay));
    if (c.vw < 640) k = Math.max(k, 11); // phones: bigger units, pan sideways
    k = Math.max(c.minK, k);
    c.setTarget(FIELD_W / 2, FIELD_H - c.vh / (2 * k * c.ay) + 0.4, k, instant);
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
    const ky = this.k * this.ay;
    if (this.viewerSide === 1) return { x: this.ox + (FIELD_W - x) * this.k, y: this.oy + (FIELD_H - y) * ky };
    return { x: this.ox + x * this.k, y: this.oy + y * ky };
  }

  scaleAt(_x: number, _y: number): { k: number; ay: number } {
    return { k: this.k, ay: this.ay };
  }

  centerOn(x: number, y: number): void { const v = this.toVisual(x, y); this.cam.centerOn(v.x, v.y); }
  frameWorldBox(x0: number, y0: number, x1: number, y1: number): void {
    const a = this.toVisual(x0, y0), b = this.toVisual(x1, y1);
    this.cam.frameBox(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
  }

  /** canvas CSS px (e.g. from offsetX/offsetY) -> world cells */
  screenToWorld(px: number, py: number): { x: number; y: number } {
    const wx = (px - this.ox) / this.k, wy = (py - this.oy) / (this.k * this.ay);
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
    const d = this.dpr, k = this.k, ky = k * this.ay;
    if (this.viewerSide === 1) this.g.setTransform(-k * d, 0, 0, -ky * d, (this.ox + FIELD_W * k + shakeX) * d, (this.oy + FIELD_H * ky + shakeY) * d);
    else this.g.setTransform(k * d, 0, 0, ky * d, (this.ox + shakeX) * d, (this.oy + shakeY) * d);
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
    if (this.tiltOn) {
      // the board is a slab: its near edge shows a dark front face
      const t = 0.7 * TILT_TAN, y0 = this.viewerSide === 0 ? FIELD_H : -t;
      const gr = g.createLinearGradient(0, y0, 0, y0 + t);
      gr.addColorStop(this.viewerSide === 0 ? 0 : 1, '#2a2f34');
      gr.addColorStop(this.viewerSide === 0 ? 1 : 0, '#0a0c0e');
      g.fillStyle = gr;
      g.fillRect(0, y0, FIELD_W, t);
    }
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
    // the patch's resolution is capped (3800 device px a side): judge sharpness against what a rebuild could reach,
    // or on big hi-dpi canvases every frame rebuilds a patch that can never get sharper (~400 ms a frame)
    const reach = Math.min(px, 3800 / Math.max(1e-6, (vx1 - vx0) * 1.6), 3800 / Math.max(1e-6, (vy1 - vy0) * 1.6));
    const sharp = !!d && d.px >= reach * 0.8 && d.px <= px * 1.6;
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
    g.font = '600 13px system-ui, sans-serif';
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

  /* ------------------------------------------------------------------------------------- unit height */

  private shDirs: ViewDirs = { sx: 0, sy: 0, ux: 0, uy: 0 };

  /** height (cells) of a unit's hull top above the ground: hull body for ground units, altitude for flyers */
  private heightOf(p: UnitPose, L: UnitLayout): number {
    if (L.air || p.flying) return flyHeight(L.S, L.mob.id === 'jet') + Math.sin(p.time * 2.1 + (p.seed ?? 0)) * 0.05;
    let h = hullHeight(L.S);
    if (L.mob.id === 'spider' || L.mob.id === 'titanlegs' || CREATURE_SHAPES.has(L.shape)) h *= 0.8;
    else if (L.mob.id === 'hover') h = h * 0.75 + 0.08;
    return h + (p.leap ?? 0) * 1.8 * L.S;
  }

  /** ground shadow; with the tilt on, cast further along the light the taller the unit is (flyers keep their soft altitude shadow) */
  private drawShadowOf(p: UnitPose, px: number): void {
    this.bodyScaled(p, px, (q) => this.drawShadowRaw(p, q));
  }

  /** draw a unit at its battlefield body scale (shared/mountgeo bodyScale): scaled about its centre, sprites cached
   *  at the scaled pixel density so they stay crisp */
  private bodyScaled(p: UnitPose, px: number, draw: (px: number) => void): void {
    const bs = bodyScale(layoutOf(p.design).S);
    const g = this.g, tr = g.getTransform();
    g.translate(p.x, p.y); g.scale(bs, bs); g.translate(-p.x, -p.y);
    draw(px * bs);
    g.setTransform(tr);
  }

  private drawShadowRaw(p: UnitPose, px: number): void {
    if (!this.tiltOn) { drawUnitShadow(this.g, p, px, this.dirs); return; }
    const L = layoutOf(p.design);
    if (L.air || p.flying || (p.leap ?? 0) > 0.02) { drawUnitShadow(this.g, p, px, this.dirs); return; }
    const m = clamp((0.6 * this.heightOf(p, L)) / Math.min(0.16, 0.05 * Math.min(L.S, 3)), 1, 9);
    const d = this.shDirs, s = this.dirs;
    d.sx = s.sx * m; d.sy = s.sy * m; d.ux = s.ux; d.uy = s.uy;
    drawUnitShadow(this.g, p, px, d);
  }

  /** the unit, raised off the ground by its height with a dark side wall (stacked cached silhouettes) joining it to the ground */
  private drawUnitOf(p: UnitPose, px: number): void {
    this.bodyScaled(p, px, (q) => this.drawUnitRaw(p, q));
  }

  private drawUnitRaw(p: UnitPose, px: number): void {
    const g = this.g;
    if (!this.tiltOn) { drawUnit(g, p, px, this.dirs); return; }
    const L = layoutOf(p.design);
    const h = this.heightOf(p, L);
    const lift = h * TILT_TAN, ux = this.dirs.ux, uy = this.dirs.uy;
    const flying = L.air || !!p.flying;
    if (!flying && (p.leap ?? 0) < 0.05 && px >= 12 && p.cloak !== 'enemy') {
      const s = unitSprites(p.design, p.team, px);
      const sil = silhouette(s, WALL[p.team]);
      const ang = L.mob.id === 'anchor' && L.X === L.Y ? 0 : p.angle;
      const cs = Math.cos(ang), sn = Math.sin(ang);
      const steps = clamp(Math.ceil((lift * this.ay * this.px) / 1.6), 1, 12);
      g.globalAlpha = (p.alpha ?? 1) * (p.cloak === 'own' ? 0.4 : 1);
      const tr = g.getTransform();
      for (let i = 0; i < steps; i++) {
        const f = (lift * i) / steps;
        g.setTransform(tr);
        g.transform(cs, sn, -sn, cs, p.x + ux * f, p.y + uy * f);
        g.drawImage(sil, -s.ext, -s.ext, s.ext * 2, s.ext * 2);
      }
      g.setTransform(tr);
      g.globalAlpha = 1;
    }
    const x0 = p.x, y0 = p.y;
    p.x = x0 + ux * lift;
    p.y = y0 + uy * lift;
    p.turretLift = lift * 0.45;
    drawUnit(g, p, px, this.dirs);
    p.x = x0;
    p.y = y0;
  }

  /** painter's order: farther (smaller screen y) first */
  private depthSort<T>(list: T[], pos: (t: T) => number): void {
    const sgn = this.viewerSide === 1 ? -1 : 1;
    list.sort((a, b) => sgn * (pos(a) - pos(b)));
  }

  /* ------------------------------------------------------------------------------------------ board */

  /** Deploy phase: static units and overlay. Call every frame (animates idle details). */
  drawBoard(units: BoardUnit[], overlay: BoardOverlay, time: number): void {
    this.checkSize();
    const g = this.g;
    const dt = this.time ? clamp(time - this.time, 0, 0.1) : 0;
    this.time = time;
    // back to deploy: last round's wrecks, scorch marks, craters and smoke never carry over
    if (this.battle) { this.battle = null; this.lastTick = -1; this.fx.clear(); }
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
    const giants = new Map<string, number>();
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const LS = layoutOf(u.design).S;
      if (LS >= 4 && !u.ghost && !u.dim) {
        const key = `${u.side}|${u.x}|${u.y}|${u.design.chassis}`;
        // only a newly placed giant lands with a thump: one dragged to a new spot (same count as last frame) does not
        // shake the camera at every cell it passes
        const gk = `${u.side}|${u.design.id}`, n = (giants.get(gk) ?? 0) + 1;
        giants.set(gk, n);
        if (!this.landed.has(key)) {
          this.landed.add(key);
          if (n > (this.giantsShown.get(gk) ?? 0)) {
            this.fx.shockwave(u.x, u.y, 0.9 * LS, '#d8c8a0', 0.8);
            this.fx.shake(0.12 + 0.03 * LS);
          }
        }
      }
      const seed = hash01(i * 7919 + Math.round(u.x * 13 + u.y * 101)) * 10;
      const p: UnitPose = {
        design: u.design, team: this.teamOf(u.side), x: u.x, y: u.y, angle: forwardAngle(u.side), time, seed, groundRing: true,
        alpha: u.ghost ? 0.5 : u.dim ? 0.45 : 1, moving: false, odometer: 0,
      };
      poses.push({ u, p, air: layoutOf(u.design).air });
    }
    this.giantsShown = giants;
    this.depthSort(poses, (q) => q.p.y);
    for (const pass of [false, true]) {
      for (const { air, p } of poses) if (air === pass) this.drawShadowOf(p, px);
      for (const { u, p, air } of poses) {
        if (air !== pass) continue;
        if (u.selected) {
          // footprint-shaped selection outline, rotated with the unit
          const LL = layoutOf(u.design);
          g.strokeStyle = rgba(TEAM_PAL[0].accent, 0.6 + 0.3 * Math.sin(time * 5));
          g.lineWidth = 2 / this.k;
          const tr = g.getTransform();
          g.translate(u.x, u.y); g.rotate(p.angle);
          const hx = LL.FX * 0.5 + 0.12, hy = LL.FY * 0.5 + 0.12;
          g.beginPath();
          roundRect(g, -hx, -hy, hx * 2, hy * 2, Math.min(hx, hy) * 0.45);
          g.stroke();
          g.setTransform(tr);
        }
        this.drawUnitOf(p, px);
        if (u.invalid) {
          // red silhouette over the unit as drawn: same body scale and lift (bodyScaled) as drawUnitOf
          this.bodyScaled(p, px, (q) => {
            const s = unitSprites(u.design, p.team, q);
            g.globalAlpha = 0.55;
            const cs = Math.cos(p.angle), sn = Math.sin(p.angle);
            const tr = g.getTransform();
            const lv = this.liftVec(this.heightOf(p, layoutOf(u.design)));
            g.transform(cs, sn, -sn, cs, u.x + lv.x, u.y + lv.y);
            g.drawImage(silhouette(s, '#ff3030'), -s.ext, -s.ext, s.ext * 2, s.ext * 2);
            g.setTransform(tr);
            g.globalAlpha = 1;
          });
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
    const half = hy * this.k * this.ay * 0.9;
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

  /** A destroyed unit leaves a smouldering hulk for the rest of this battle (cleared with the battle's fx). */
  private addWreck(u: { design: Design }, team: Team, x: number, y: number, angle: number, k: number, lv: WreckLevel = 1, kind: DeathKind = 'explosive'): void {
    const d = u.design;
    const S = layoutOf(d).S;
    const ext = unitSprites(d, team, DECAL_PX).ext;
    wreckSprite(d, team, DECAL_PX);
    this.fx.wreck(x, y, angle, S, ext, (px) => wreckSprite(d, team, px), wreckHotspots(d), k, lv, kind);
  }

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
    this.rt = this.prevTick = this.curTick = 0;
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
        // cluster bomblets start where the carrier burst, far from any barrel: no muzzle blend for them
        const src = p.src !== undefined ? this.units.get(p.src) : undefined;
        const bomblet = p.kind === 'arc' && !!modOf(p.moduleId)?.cluster && (!src || Math.hypot(src.x - p.x, src.y - p.y) > 6);
        const tip = !bomblet && p.src !== undefined && p.mount !== undefined && p.z <= 0.5 ? this.muzzleOf(p.src, p.mount) : null;
        this.ptrack.set(p.id, { sx: p.x, sy: p.y, k0: p.progress, lx: p.x, ly: p.y, kind: p.kind, moduleId: p.moduleId, side: p.side, born: this.time, ox: tip ? tip.x - p.x - this.liftVec(GUN_H).x : 0, oy: tip ? tip.y - p.y - this.liftVec(GUN_H).y : 0, bomblet });
        if ((p.kind === 'rocket' || p.kind === 'missile') && this.fx.busy < 0.8) {
          // every tube of a ripple-firing battery: its own ignition flash and a backblast puff thrown out behind
          const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
          this.fx.glow(p.x, p.y, 0.28, p.kind === 'missile' ? '#fff0d0' : '#ffb060', 0.09, 0.8);
          this.fx.smoke(p.x - ca * 0.3, p.y - sa * 0.3, 0.2, 1.3, '#b4aea4', -ca * 1.6 + this.fx.wind.x * 0.5, -sa * 1.6 + this.fx.wind.y * 0.5, 0.32, 0.15, GUN_H);
        }
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
    const newTick = battle.tick !== this.lastTick;
    if (newTick) {
      const n = battle.tick - this.lastTick;
      // a jump (first frame, skip, catch-up after a stall) is shown as-is instead of being slid across
      const jump = this.lastTick < 0 || n > 40;
      // ticks per second as observed by this view (speed setting x frame pacing); the time since the previous snapshot
      // includes this frame. Long gaps (pause, background tab) say nothing about the rate and are ignored.
      // Measured over windows of >= 0.2 s so uneven tick counts per frame (1,1,2 at 4x) don't make it wobble.
      const span = this.sinceTick + dt;
      if (jump || span >= 0.4) this.rateWin.n = this.rateWin.t = 0;
      else if (span >= 0.05 && (n / span > this.tickRate * 1.7 || n / span < this.tickRate * 0.6)) {
        // a speed change shows up as a big jump: adopt it at once instead of easing over a second of judder
        this.tickRate = clamp(n / span, 1, 600);
        this.rateWin.n = this.rateWin.t = 0;
      } else {
        this.rateWin.n += n;
        this.rateWin.t += span;
        const r = this.rateWin.n / this.rateWin.t;
        const changed = this.rateWin.t >= 0.05 && (r > this.tickRate * 1.7 || r < this.tickRate * 0.6);
        if (this.rateWin.t >= 0.2 || changed) {
          this.tickRate = clamp(changed ? r : lerp(this.tickRate, r, 0.6), 1, 600);
          this.rateWin.n = this.rateWin.t = 0;
        }
      }
      this.prevTick = jump ? battle.tick : this.curTick;
      this.curTick = battle.tick;
      if (jump) this.rt = battle.tick;
      this.sinceTick = 0;
    } else this.sinceTick += dt;
    // advance the render clock and ease it toward one tick behind the estimated sim time, then keep it inside the
    // snapshot pair; fixed-rate ticks then move units by the same amount every frame at any speed (no judder)
    const target = this.curTick + this.sinceTick * this.tickRate - 1;
    this.rt += dt * this.tickRate;
    this.rt += (target - this.rt) * 0.05;
    this.rt = clamp(this.rt, this.prevTick, this.curTick);
    this.alpha = this.curTick > this.prevTick ? (this.rt - this.prevTick) / (this.curTick - this.prevTick) : 1;
    this.fx.simT = this.rt * DT;
    if (newTick) {
      const before = this.curU;
      this.snapshot(battle);
      if (this.prevTick === this.curTick) {
        // jumped (skip): units that died unseen still leave their hulks; nothing to interpolate from; forget rounds
        // that came and went unseen (no impact puffs for them)
        for (const id of before.keys()) {
          const u = this.units.get(id);
          if (u && !u.alive) this.addWreck(u, this.teamOf(u.side), u.x, u.y, u.angle + (u.flying ? 0.6 : 0), u.flying ? 0.8 : 1);
        }
        this.prevU = new Map(this.curU);
        this.prevP = new Map(this.curP);
        for (const id of this.ptrack.keys()) if (!this.curP.has(id)) this.ptrack.delete(id);
      } else this.handleVanished(battle);
      this.lastTick = battle.tick;
      if (!this.usePush) newTicks = battle.events;
    }

    const events = newTicks ?? this.pending;
    if (events.length) {
      this.blasts.length = 0;
      for (const e of events) if (e.t === 'explode') this.blasts.push(e);
      for (const e of events) this.handleEvent(e);
      this.shotFrom.clear();
      this.gone.length = 0;
      this.flying = null;
      if (!this.muted) try { setSfxView(this.cam.k / this.cam.minK); battleSfx(events); } catch { /* audio optional */ }
      if (!newTicks) this.pending = [];
    }
    this.fx.up = { x: this.dirs.ux, y: this.dirs.uy };
    this.fx.liftK = this.tiltOn ? TILT_TAN : 0.45;
    this.fx.flashK = Math.max(0, Math.min(1, this.flashScale));
    {
      const va = this.screenToWorld(0, 0), vb = this.screenToWorld(this.cssW, this.cssH);
      this.fx.view = { x0: Math.min(va.x, vb.x) - 2, x1: Math.max(va.x, vb.x) + 2, y0: Math.min(va.y, vb.y) - 3, y1: Math.max(va.y, vb.y) + 3 };
    }
    this.fx.update(dt);
    this.stepCamera(dt);
    const kd = Math.exp(-dt * 10);
    for (const v of this.vis.values()) {
      if (v.kx !== undefined) { v.kx *= kd; v.ky = (v.ky ?? 0) * kd; if (Math.abs(v.kx) + Math.abs(v.ky) < 0.001) { v.kx = undefined; v.ky = undefined; } }
      for (let i = 0; i < v.swing.length; i++) v.swing[i] = Math.max(0, v.swing[i] - dt * 3.5);
      if (v.heat) for (let i = 0; i < v.heat.length; i++) v.heat[i] = Math.max(0, v.heat[i] - dt * 0.9);
      if (v.spin) {
        // spin-up guns: the barrels keep spinning up while shots keep coming, and wind down without them (sim time)
        const sdt = dt * this.tickRate * DT, now = this.fx.simT;
        for (let i = 0; i < v.spin.length; i++) {
          const su = v.spinT?.[i] ?? 0;
          if (!su) continue;
          const on = now - (v.lastFire?.[i] ?? -9) < 0.35;
          v.spin[i] = clamp(v.spin[i] + (on ? sdt : -sdt) / su, 0, 1);
        }
      }
    }

    const g = this.g;
    const { sx, sy } = this.shakeOffset();
    this.drawGround(false, sx, sy);
    const px = this.spritePx;
    this.fx.drawWrecks(g, px);
    this.fx.drawFields(g, px);

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
    this.depthSort(ground, (q) => q.y);
    this.depthSort(air, (q) => q.y);
    for (const p of ground) this.drawShadowOf(p, px);
    for (const p of ground) this.drawUnitOf(p, px);
    this.drawShields(g, bars.filter((b) => !b.u.flying));
    this.drawProjectiles(g, battle.projectiles, false, dt);
    for (const p of air) this.drawShadowOf(p, px);
    for (const p of air) this.drawUnitOf(p, px);
    this.drawShields(g, bars.filter((b) => b.u.flying));
    this.drawProjectiles(g, battle.projectiles, true, dt);
    this.fx.draw(g, px, this.dirs.ux, this.dirs.uy);
    this.drawStatusFx(g, bars, dt);
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
  /** giants per side|design drawn by the last drawBoard */
  private giantsShown = new Map<string, number>();
  /** heat of the annihilator that fired most recently (fire event precedes its beam event) */
  private beamHeat = 0;
  /** rounds that vanished since the last processed events (their last heading tells hits which way a round flew) */
  private gone: { x: number; y: number; angle: number; moduleId: string }[] = [];
  /** 'explode' events of the batch being handled (knockback dust needs the blast centre for each splash hit) */
  private blasts: { x: number; y: number; radius: number; moduleId: string }[] = [];

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
    if (v.kx !== undefined) { x += v.kx; y += v.ky ?? 0; }
    const ext = u as SimUnit & { cloaked?: boolean };
    return {
      design: u.design, team: this.teamOf(u.side), x, y, angle: ang, time: this.time, odometer: odo, moving: u.moving, groundRing: true,
      leap: u.leap, flying: u.flying, hitFlash: u.hitFlash, mounts, seed: (u.id * 0.618) % 10,
      stun: u.stun, slow: u.slow, burning: u.burning, disarm: u.disarm,
      cloak: ext.cloaked ? (u.side === this.viewerSide ? 'own' : 'enemy') : undefined,
    };
  }

  /** Status looks (each status its own colour, matching its weapons): stunned units crackle with blue-white arcs,
   *  burning units throw flames over an orange underglow, slowed units sit in a turning violet ring with a cold haze,
   *  disarmed units carry a flickering red "no fire" sign. Spin-up guns glow at the barrels as they heat up. */
  private drawStatusFx(g: Ctx, list: { u: SimUnit; p: UnitPose }[], dt: number): void {
    const px = this.px;
    if (px < 5) return;
    let any = false, nBurn = 0;
    for (const { u, p } of list) {
      if (p.cloak === 'enemy') continue;
      if (u.burning > 0) {
        nBurn++;
        const S = layoutOf(u.design).S;
        const lv = this.liftVec(this.heightOf(p, layoutOf(u.design)) * 0.5);
        if (Math.random() < dt * (6 + 3 * S)) this.fx.burning(p.x + lv.x, p.y + lv.y, S);
      }
      // damaged hulls leak smoke (thin grey wisps below 75 % hp, dark smoke below 50 %, flames and sparks below 25 %)
      const hf = u.maxHp > 0 ? u.hp / u.maxHp : 1;
      if (hf < 0.75 && list.length < 160) {
        const S = layoutOf(u.design).S, lv = this.liftVec(this.heightOf(p, layoutOf(u.design)) * 0.7);
        const ox = ((u.id * 0.618) % 1 - 0.5) * 0.4 * S, oy = ((u.id * 0.414) % 1 - 0.5) * 0.4 * S;
        const hx = p.x + lv.x + ox, hy = p.y + lv.y + oy;
        if (Math.random() < dt * (hf < 0.25 ? 6 : hf < 0.5 ? 4 : 2.2)) {
          this.fx.smoke(hx, hy, (0.08 + (hf < 0.5 ? 0.1 : 0.04)) * (0.7 + 0.3 * S), 1.4, hf < 0.5 ? '#1c1a18' : '#9a9690', this.fx.wind.x * 0.5, -0.25, hf < 0.5 ? 0.45 : 0.28, 0.6);
        }
        if (hf < 0.25 && Math.random() < dt * 5) this.fx.fire(hx, hy, 0.07 + 0.03 * S, 0.35, 0, -0.3, 0.5);
        if (hf < 0.5 && Math.random() < dt * 0.8) this.fx.sparks(hx, hy, 2, '#ffd890', 2.5, undefined, Math.PI, 0.2, true);
      }
      if (u.stun > 0 || u.burning > 0 || u.slow > 0.01 || u.disarm > 0 || this.vis.get(u.id)?.spin) any = true;
    }
    if (!any) return;
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    const minW = 1 / px;
    for (const { u, p } of list) {
      if (p.cloak === 'enemy') continue;
      const L = layoutOf(u.design);
      const bs = bodyScale(L.S);
      if (u.stun > 0) {
        const lv = this.liftVec(this.heightOf(p, L) * 0.55);
        this.fx.drawShock(g, p.x + lv.x, p.y + lv.y, 0.46 * L.X * bs, 0.46 * L.Y * bs, p.angle, u.id, minW);
        if (Math.random() < dt * 5) this.fx.sparks(p.x + lv.x + (Math.random() - 0.5) * L.X * bs * 0.6, p.y + lv.y + (Math.random() - 0.5) * L.Y * bs * 0.6, 2, '#cfe0ff', 2.2, undefined, Math.PI, 0.15, true);
      }
      const R = Math.max(L.X, L.Y) * 0.5 * bs;
      if (u.burning > 0) {
        // on fire: the flames light the ground below, and tongues of flame lick up off the hull (scaled to it)
        const f = 0.8 + 0.2 * Math.sin(this.time * 11 + u.id);
        g.globalAlpha = 0.3 * f;
        g.drawImage(glowTex('#ff6a20'), p.x - R * 1.3, p.y - R * 1.3, R * 2.6, R * 2.6);
        const lv = this.liftVec(this.heightOf(p, L) * 0.7);
        this.fx.drawBurning(g, p.x + lv.x, p.y + lv.y, R * 0.9, u.id, clamp(u.burning / 0.6, 0.35, 1), nBurn > 60);
      }
      if (u.slow > 0.01) {
        const lv = this.liftVec(this.heightOf(p, L) * 0.5);
        this.fx.drawSlow(g, p.x, p.y, p.x + lv.x, p.y + lv.y, R * 1.05 + 0.08, clamp(u.slow / 0.6, 0, 1), minW);
      }
      if (u.disarm > 0) {
        const lv = this.liftVec(this.heightOf(p, L) + 0.35);
        this.fx.drawDisarm(g, p.x + lv.x, p.y + lv.y, 0.16 + 0.05 * L.S, u.id, minW);
      }
      const v = this.vis.get(u.id);
      if (v?.spin) {
        // spin-up guns: barrels glow dull red, then orange-yellow as the cluster spins to full speed
        for (let i = 0; i < v.spin.length; i++) {
          const k = v.spin[i];
          if (k < 0.05) continue;
          const tip = this.muzzleOf(u.id, i);
          if (!tip) continue;
          const mod = modOf(u.mounts[i]?.moduleId);
          const sz = (mod && moduleTier(mod) >= 4 ? 0.45 : 0.28) * (0.6 + 0.6 * k);
          const bx = tip.x - Math.cos(tip.aim) * sz * 0.6, by = tip.y - Math.sin(tip.aim) * sz * 0.6;
          g.globalAlpha = clamp(0.2 + 0.7 * k * k, 0, 1);
          g.drawImage(glowTex(k > 0.75 ? '#ff9a40' : '#ff4a1a'), bx - sz, by - sz, sz * 2, sz * 2);
          if (k > 0.6) {
            g.globalAlpha = clamp((k - 0.6) * 2, 0, 1) * 0.8;
            g.drawImage(glowTex('#ffe0a0'), bx - sz * 0.4, by - sz * 0.4, sz * 0.8, sz * 0.8);
          }
          // a heat shimmer of smoke off the barrels once it is hot
          if (k > 0.7 && this.fx.busy < 0.5 && Math.random() < dt * 4 * k) this.fx.smoke(bx, by, sz * 0.5, 1.2, '#6a6560', this.fx.up.x * 0.4, this.fx.up.y * 0.4, 0.18, 0.3, 0.3);
        }
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = prev;
  }

  /** Shield: a faint thin rim hugging the hull that flares briefly when hit (hits draw their own local hex ripple). */
  private drawShields(g: Ctx, list: { u: SimUnit; p: UnitPose }[]): void {
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = '#9fe4ff';
    for (const { u, p } of list) {
      if (u.shield <= 0 || p.cloak === 'enemy') continue;
      const v = this.visOf(u);
      const since = this.time - v.shieldT;
      const hit = since < 0.4 ? 1 - since / 0.4 : 0;
      const frac = u.maxShield > 0 ? u.shield / u.maxShield : 0.5;
      const L = layoutOf(u.design);
      const r = shieldR(L);
      // drawn at ground level (aircraft: around the drawn body), the same place shield-hit flashes are drawn
      const al = this.airLift(u);
      const lx = p.x + al.x, ly = p.y + al.y;
      g.globalAlpha = 0.05 + 0.06 * frac + hit * 0.35;
      g.lineWidth = Math.max(1 / this.k, 0.025 + 0.03 * hit);
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
    // bars stay up while a unit carries paralysis, so stun build-up is always readable
    const vis = Math.max(this.barAlpha(v, S), u.para > 0 ? 1 : 0);
    const status = u.burning > 0 || u.slow > 0.05 || u.disarm > 0;
    if (vis <= 0.01 && !status) return;
    const g = this.g;
    if (S >= 4) { if (vis > 0.01) { g.globalAlpha = vis; this.drawBossBar(u, p, v, S, bh); g.globalAlpha = 1; } return; }
    const s = this.worldToScreen(p.x, p.y);
    const lift = this.barLift(u, p);
    const w = Math.max(14, bh.w * this.k * 0.78);
    const h = S >= 2 ? 4 : 3;
    const x = Math.round(s.x - w / 2);
    const y = Math.round(s.y - bh.hy * this.k * this.ay * 1.04 - h - 3 - lift);
    // status glyphs (burning / slowed / disarmed) to the left of the bar, shown even when the bar itself is hidden
    if (status && this.k > 14) this.drawStatusIcons(u, x - 5, y + h / 2);
    if (vis <= 0.01) return;
    g.globalAlpha = vis;
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
    this.drawPara(u, x, y + h + 1.5, w);
    g.globalAlpha = 1;
  }

  /** Small screen-space status glyphs, right-aligned at (x, cy): flame (burning), snowflake (slowed), no-fire sign
   *  (disarmed). Colours match the status looks on the field. */
  private drawStatusIcons(u: SimUnit, x: number, cy: number): void {
    const g = this.g;
    g.globalAlpha = 1;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    let cx = x - 4;
    const pip = (draw: () => void) => {
      g.fillStyle = 'rgba(0,0,0,0.78)';
      g.beginPath(); g.arc(cx, cy, 5.5, 0, P2); g.fill();
      draw();
      cx -= 12;
    };
    if (u.disarm > 0) pip(() => {
      g.strokeStyle = '#ff4a64'; g.lineWidth = 1.6;
      g.beginPath(); g.arc(cx, cy, 3.6, 0, P2); g.stroke();
      g.beginPath(); g.moveTo(cx - 2.5, cy + 2.5); g.lineTo(cx + 2.5, cy - 2.5); g.stroke();
    });
    if (u.slow > 0.05) pip(() => {
      g.strokeStyle = '#c8a0ff'; g.lineWidth = 1.3;
      g.beginPath();
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI; g.moveTo(cx - Math.cos(a) * 3.8, cy - Math.sin(a) * 3.8); g.lineTo(cx + Math.cos(a) * 3.8, cy + Math.sin(a) * 3.8); }
      g.stroke();
    });
    if (u.burning > 0) pip(() => {
      g.fillStyle = Math.sin(this.time * 12 + u.id) > 0 ? '#ff8a2a' : '#ffb040';
      g.beginPath();
      g.moveTo(cx, cy - 4.2); g.quadraticCurveTo(cx + 3.6, cy, cx + 2.4, cy + 2.4); g.quadraticCurveTo(cx, cy + 4.4, cx - 2.4, cy + 2.4); g.quadraticCurveTo(cx - 3.6, cy, cx, cy - 4.2);
      g.fill();
      g.fillStyle = '#ffe8a0';
      g.beginPath(); g.arc(cx, cy + 1.4, 1.3, 0, P2); g.fill();
    });
  }

  /** Paralysis (Zero-K style) under the hp bar: a blue meter filling toward a stun; while stunned it pulses and shows the
   *  seconds left next to a bolt. */
  private drawPara(u: SimUnit, x: number, y: number, w: number): void {
    if (u.para <= 0) return;
    const g = this.g;
    const f = clamp(u.para / u.maxHp, 0, 1);
    const stunned = u.stun > 0;
    g.fillStyle = 'rgba(0,0,0,0.88)';
    g.fillRect(x - 1.5, y, w + 3, 4.5);
    g.fillStyle = stunned ? (Math.sin(this.time * 14) > 0 ? '#e6f6ff' : '#7fd0ff') : '#4aa8ff';
    g.fillRect(x, y + 1, w * f, 2.5);
    if (!stunned) return;
    const tx = x + w + 4, ty = y + 2;
    g.fillStyle = '#9fe0ff';
    g.beginPath(); // bolt glyph
    g.moveTo(tx + 3, ty - 6); g.lineTo(tx - 1, ty + 1); g.lineTo(tx + 2, ty + 1); g.lineTo(tx, ty + 7); g.lineTo(tx + 5, ty - 1); g.lineTo(tx + 2, ty - 1); g.closePath();
    g.fill();
    g.font = '700 12px "Barlow Condensed", system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    const txt = `${u.stun.toFixed(1)}s`;
    g.strokeText(txt, tx + 8, ty + 0.5);
    g.fillStyle = '#dff4ff';
    g.fillText(txt, tx + 8, ty + 0.5);
  }

  /** screen px the unit's top is raised above its ground footprint (bars ride on top of it) */
  private barLift(u: SimUnit, p: UnitPose): number {
    if (!this.tiltOn) return u.flying ? 0.12 * this.k : 0;
    return (this.heightOf(p, layoutOf(u.design)) + (u.flying ? 0.12 : 0)) * TILT_TAN * this.ay * this.k;
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
    const lift = this.barLift(u, p);
    const team = this.teamOf(u.side);
    const col = TEAM_PAL[team].bar;
    const w = Math.max(40, bh.w * this.k * 1.0), h = S >= 5 ? 9 : 7;
    const x = Math.round(s.x - w / 2);
    const y = Math.round(s.y - bh.hy * this.k * this.ay * 1.1 - h - 5 - lift);
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
    g.fillRect(x + w + 2, y - 1, 3, h + 2);    this.drawPara(u, x, y + h + 3.5, w);
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
      if (this.gone.length < 400) this.gone.push({ x: last.x, y: last.y, angle: last.angle, moduleId: t.moduleId });
      // a fire round landing in its own weapon's burning patch keeps it alight (the sim tops it up without an event)
      const ff = modOf(t.moduleId)?.fireField;
      if (ff) this.fx.topUpField(last.x, last.y, ff.duration, t.moduleId);
      if (t.kind !== 'bullet' && t.kind !== 'shell' && t.kind !== 'rocket') continue;
      // extrapolate one tick forward to where it would land
      const x = last.x, y = last.y;
      let near = false;
      for (const e of evs) {
        if ((e.t === 'hit' || e.t === 'explode') && Math.abs(e.x - x) < 1.6 && Math.abs(e.y - y) < 1.6) { near = true; break; }
      }
      if (near) continue;
      if (x < 0 || y < 0 || x > FIELD_W || y > FIELD_H) continue;
      const fx = this.fx, cal = modOf(t.moduleId)?.caliber ?? 0.5;
      if (t.kind === 'bullet') { fx.dirtKick(x, y, 0.8 + cal); continue; }
      if (t.kind === 'shell' && modOf(t.moduleId)?.pierce) { fx.dirtKick(x, y, 1.6); continue; } // a piercing slug spent at the end of its line: no blast
      if (t.kind === 'shell') {
        fx.shellImpact(x, y, cal);
        continue;
      }
      fx.dust(x, y, 0.15, 2, 0.6);
      fx.sparks(x, y, 3, '#ffd890', 2.5, undefined, Math.PI, 0.18, true);
      fx.decal('scorch', x, y, 0.2);
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
      const r = (0.12 + 0.06 * h) * (t.bomblet ? 0.45 : 1);
      g.globalAlpha = clamp(0.5 - h * 0.05, 0.15, 0.5);
      g.drawImage(softDot('rgba(0,0,0,0.9)', 0.3), pos.x + this.dirs.sx * h * 0.3 - r, pos.y + this.dirs.sy * h * 0.3 - r, r * 2, r * 2);
      g.globalAlpha = 1;
      const pr = pos.progress;
      if (pr < 0.04 || t.bomblet) continue; // bomblets: no target rings (their carrier already marked the carpet)
      const lx = t.sx + (pos.x - t.sx) / pr, ly = t.sy + (pos.y - t.sy) / pr;
      const mod = modOf(p.moduleId);
      // cluster carriers mark the whole carpet their bomblets will cover
      const rad = mod?.cluster ? mod.cluster.radius + mod.cluster.splash * 0.5 : Math.max(0.5, mod?.splash ?? 1);
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
      const isHigh = kind === 'arc' || kind === 'missile' || (kind === 'rocket' && p.z > 0.05);
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
      // height above the ground (cells): the gun line, plus the round's own altitude (shells and missiles arc up the screen)
      const hz = this.tiltOn ? GUN_H + pos.z * (kind === 'arc' || kind === 'missile' || kind === 'rocket' ? 0.8 : 0.5) : 0;
      const lift = this.tiltOn ? hz * TILT_TAN : kind === 'missile' || kind === 'rocket' ? Math.min(0.6, pos.z * 0.4) : kind === 'arc' ? pos.z * 0.45 : 0;
      let x = pos.x + this.dirs.ux * lift, y = pos.y + this.dirs.uy * lift;
      if (kind === 'rocket' || (kind === 'missile' && mod?.id === 'swarm')) {
        // rockets don't fly on rails: a little wobble round the true path (none at the ends)
        const w = (kind === 'rocket' ? 0.07 : 0.05) * Math.sin(Math.PI * clamp(pos.progress, 0, 1)) * Math.sin(this.time * 19 + p.id * 2.3);
        x -= sn * w; y += cs * w;
      }
      const glowC = mod ? moduleGlow(mod, TEAM_PAL[this.teamOf(p.side)]) : '#ffd27a';
      // dark soft backing (normal blend) so additive tracers/shells stay visible on any ground
      // drawn round diameter (cells): ~0.75 x the bore of the barrel that fires it
      const rw = mod ? Math.max(0.012, 0.75 * boreOf(calibreMm(mod))) : 0.03;
      // machine guns, rotaries and the sniper fire flash rounds (a thin line sweeping the path in a few frames)
      const flash = kind === 'bullet' && !!mod && vis !== 'shotgun' && (mod.category === 'machinegun' || vis === 'gatling' || vis === 'sniper');
      if (kind === 'bullet' && !flash) {
        g.globalCompositeOperation = prevOp;
        g.globalAlpha = 0.35;
        g.strokeStyle = '#05070a';
        g.lineCap = 'round';
        g.lineWidth = Math.max(2.5 / this.px, rw * 2);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * rw * 6, y - sn * rw * 6); g.stroke();
        g.globalAlpha = 1;
      } else if (kind === 'shell' || kind === 'rocket' || kind === 'missile' || kind === 'arc') {
        const len = kind === 'shell' ? Math.min(0.2, rw * 4) : kind === 'rocket' ? 0.3 : kind === 'missile' ? 0.35 : 0.2;
        g.globalCompositeOperation = prevOp;
        g.globalAlpha = 0.5;
        g.strokeStyle = '#05070a';
        g.lineCap = 'round';
        g.lineWidth = Math.max(4 / this.px, kind === 'arc' ? 0.28 : kind === 'shell' ? rw * 1.6 : 0.12);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * len, y - sn * len); g.stroke();
        g.globalAlpha = 1;
      }
      g.globalCompositeOperation = 'lighter';
      switch (kind) {
        case 'bullet': {
          const sniper = vis === 'sniper';
          if (vis === 'shotgun') {
            if (mod?.pierce) {
              // flechette: a long, thin steel dart with a cold glint at the tip (every dart drawn; they fly on through)
              g.strokeStyle = '#8fb8e0';
              g.globalAlpha = 0.5;
              g.lineCap = 'round';
              g.lineWidth = Math.max(minW * 1.6, 0.05);
              g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * 0.75, y - sn * 0.75); g.stroke();
              g.globalAlpha = 1;
              g.strokeStyle = '#f4faff';
              g.lineWidth = Math.max(minW, 0.024);
              g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * 0.42, y - sn * 0.42); g.stroke();
              g.globalAlpha = 0.85;
              g.drawImage(glowTex('#d8f0ff'), x - 0.07, y - 0.07, 0.14, 0.14);
            } else {
              // buckshot: a spray of small hot pellets (round dots with a stub of streak), no tracers
              g.strokeStyle = '#ffd8a0';
              g.globalAlpha = 0.6;
              g.lineCap = 'round';
              g.lineWidth = Math.max(minW * 1.4, 0.045);
              g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * 0.16, y - sn * 0.16); g.stroke();
              g.globalAlpha = 0.9;
              g.drawImage(glowTex('#fff0d0'), x - 0.06, y - 0.06, 0.12, 0.12);
            }
            break;
          }
          const rotary = vis === 'gatling', ac = mod?.category === 'autocannon';
          const apMg = mod?.category === 'machinegun' && (mod.ap ?? 0) >= 0.4;
          // tracer colour by family: MG warm yellow-orange, suppressor violet (slows), heavy MG paler amber (AP), rotary
          // hot orange, autocannon whiter, sniper white-blue
          const col = sniper ? '#d8ecff' : rotary ? (ac ? '#ff9a50' : '#ff9a48') : ac ? '#ffe0b0' : mod?.slow ? '#c8a8ff' : apMg ? '#ffe2a8' : '#ffd070';
          // which rounds carry a tracer: every 4th (MG), every 3rd (rotary), every 2nd (heavy MG), all (HE autocannon,
          // sniper). Tracers are the same size as the ball rounds between them, just brighter.
          const tracer = sniper || (ac && !rotary) || (rotary ? p.id % 3 === 0 : apMg ? (p.id & 1) === 0 : (p.id & 3) === 0);
          // width from the calibre (never under ~1.5 px), a short tail of a few widths
          let hx = x, hy = y, tx: number, ty: number, fade = 1;
          if (flash && t) {
            // flash round: the head races from the muzzle to the target in FLASH_T, the line spans a chunk of the path
            const kp = clamp(pos.progress, 0, 1), dk = kp - (t.k0 ?? 0);
            const left = dk > 0.02 ? (1 - kp) * (Math.hypot(pos.x - t.sx, pos.y - t.sy) / dk) : (mod?.range ?? 8) * (1 - kp);
            const lx = x - pos.x, ly = y - pos.y; // lift (tilt) offset
            const sx0 = t.sx + (t.ox ?? 0) + lx, sy0 = t.sy + (t.oy ?? 0) + ly;
            const ex = pos.x + cs * left + lx, ey = pos.y + sn * left + ly;
            const L = Math.max(0.1, Math.hypot(ex - sx0, ey - sy0));
            const th = (this.time - t.born) / 0.05, tt = th - clamp(0.4 * L, 0.6, 3.5) / L;
            if (tt >= 1) break;
            const a0 = Math.max(0, tt), a1 = Math.min(1, th);
            hx = sx0 + (ex - sx0) * a1; hy = sy0 + (ey - sy0) * a1;
            tx = sx0 + (ex - sx0) * a0; ty = sy0 + (ey - sy0) * a0;
            fade = 1 - 0.5 * clamp(tt, 0, 1);
          } else {
            const L2 = rw * (ac ? (tracer ? 12 : 9) : 8);
            tx = x - cs * L2; ty = y - sn * L2;
          }
          g.strokeStyle = col;
          g.lineCap = 'round';
          g.globalAlpha = (tracer ? 0.75 : 0.35) * fade;
          g.lineWidth = Math.max(minW, rw * 1.3);
          g.beginPath(); g.moveTo(hx, hy); g.lineTo(tx, ty); g.stroke();
          g.globalAlpha = (tracer ? 1 : 0.55) * fade;
          g.strokeStyle = tracer ? '#fff8e0' : col;
          g.lineWidth = Math.max(minW * 0.6, rw * 0.6);
          g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + (tx - hx) * 0.6, hy + (ty - hy) * 0.6); g.stroke();
          break;
        }
        case 'shell': {
          if (vis === 'gauss') {
            g.strokeStyle = '#9fe8ff';
            g.globalAlpha = 0.45;
            g.lineWidth = Math.max(minW * 1.5, rw * 1.2);
            g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * rw * 14, y - sn * rw * 14); g.stroke();
            g.globalAlpha = 1;
            g.strokeStyle = '#ffffff';
            g.lineWidth = Math.max(minW, rw * 0.5);
            g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * rw * 8, y - sn * rw * 8); g.stroke();
            if (t && Math.random() < dt * 30) this.fx.ring(x, y, 0.05, 0.4, '#40ffc0', 0.3, 0.5);
            // ionised wake: a fading cyan streak left along its line
            this.trail(p.id, x, y, 0.14, '#5fd8ff', 0.18, true);
          } else if (vis === 'flak') {
            const blink = 0.75 + 0.25 * Math.sin(this.time * 12 + p.id);
            g.globalAlpha = blink;
            const fr = Math.max(1.5 / this.px, rw * 1.5);
            g.drawImage(softDot('#ffd080', 0.3), x - fr, y - fr, fr * 2, fr * 2);
          } else if (mod?.impulse) {
            // HE shell: an orange-red round the size of the bore with a hot nose and a smoky wake (vs the white AP needle)
            const r = rw / 2;
            g.globalAlpha = 0.5;
            g.strokeStyle = '#ff6a28';
            g.lineCap = 'round';
            g.lineWidth = Math.max(minW * 1.5, r * 2.4);
            g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * r * 7, y - sn * r * 7); g.stroke();
            g.globalAlpha = 0.8;
            g.drawImage(glowTex('#ff7a30'), x - r * 4, y - r * 4, r * 8, r * 8);
            g.globalAlpha = 1;
            g.drawImage(glowTex('#ffd0a0'), x - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2);
            this.trail(p.id, x, y, Math.max(0.04, r * 1.2), '#6e6860', 0.11, false, 1.0, 0.3);
          } else {
            const r = rw / 2;
            // AP tracer: a slim white-hot penetrator with a short hot tail and a small bright head
            g.globalAlpha = 0.45;
            g.strokeStyle = '#ff9a40';
            g.lineCap = 'round';
            g.lineWidth = Math.max(minW * 1.5, r * 1.8);
            g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * r * 10, y - sn * r * 10); g.stroke();
            g.globalAlpha = 1;
            g.drawImage(glowTex('#ffc080'), x - r * 2.6, y - r * 2.6, r * 5.2, r * 5.2);
            g.strokeStyle = '#ffffff';
            g.lineWidth = Math.max(minW, r * 0.9);
            g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * r * 6, y - sn * r * 6); g.stroke();
            if (cal > 0.65) this.trail(p.id, x, y, 0.07 * cal, '#7a746c', 0.14, false, 0.8, 0.25);
          }
          break;
        }
        case 'rocket': {
          const incend = mod?.id === 'incendiary';
          g.globalCompositeOperation = prevOp;
          if (pos.z > 0.2) {
            // lofted: its shadow on the ground below reads the height of the arc
            const so = this.tiltOn ? pos.z * 0.4 : lift;
            g.globalAlpha = 0.25;
            g.drawImage(softDot('rgba(0,0,0,0.9)', 0.3), pos.x + this.dirs.sx * so - 0.12, pos.y + this.dirs.sy * so - 0.12, 0.24, 0.24);
            g.globalAlpha = 1;
          }
          g.strokeStyle = '#d8d4c8';
          g.lineWidth = Math.max(minW * 1.5, 0.06);
          g.lineCap = 'round';
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * 0.22, y - sn * 0.22); g.stroke();
          g.globalCompositeOperation = 'lighter';
          // the motor roars hardest early in the burn and flickers every frame
          const fl = (0.11 + Math.random() * 0.07) * (1.25 - 0.4 * clamp(pos.progress, 0, 1));
          g.drawImage(glowTex(incend ? '#ff7820' : '#ff9a40'), x - cs * 0.27 - fl * 1.6, y - sn * 0.27 - fl * 1.6, fl * 3.2, fl * 3.2);
          g.drawImage(glowTex('#fff2c8'), x - cs * 0.24 - fl * 0.6, y - sn * 0.24 - fl * 0.6, fl * 1.2, fl * 1.2);
          // smoke trail that persists and drifts with the wind (incendiary: darker, with burning gel dripping off)
          this.trail(p.id, x - cs * 0.25, y - sn * 0.25, 0.09, incend ? '#5a524a' : '#a29d94', 0.07, false, 2.2, 0.38, 0.12);
          if (incend && this.fx.busy < 0.6 && Math.random() < dt * 25) this.fx.fire(x - cs * 0.3, y - sn * 0.3, 0.1, 0.4, -cs * 0.5, -sn * 0.5, 0.2, hz);
          break;
        }
        case 'missile': {
          const cruise = vis === 'cruise';
          const nuke = mod?.id === 'tactnuke';
          const sz = nuke ? 1.3 : cruise ? 0.5 : mod?.id === 'swarm' ? 0.16 : mod?.id === 'missilebattery' ? 0.3 : 0.26;
          if (mod?.id === 'atgm' && p.src !== undefined && p.mount !== undefined) {
            // wire-guided: a faint guidance wire paid out from the launcher
            const tip = this.muzzleOf(p.src, p.mount);
            if (tip) {
              g.globalCompositeOperation = prevOp;
              g.strokeStyle = '#d8dce0';
              g.globalAlpha = 0.35;
              g.lineWidth = Math.max(minW * 0.6, 0.012);
              g.beginPath(); g.moveTo(tip.x, tip.y); g.quadraticCurveTo((tip.x + x) / 2 + this.dirs.sx * 0.3, (tip.y + y) / 2 + this.dirs.sy * 0.3, x - cs * sz, y - sn * sz); g.stroke();
              g.globalAlpha = 1;
            }
          }
          // ground shadow
          g.globalCompositeOperation = prevOp;
          g.globalAlpha = 0.3;
          const so = this.tiltOn ? pos.z * 0.4 : lift;
          g.drawImage(softDot('rgba(0,0,0,0.9)', 0.3), pos.x + this.dirs.sx * so - sz * 0.5, pos.y + this.dirs.sy * so - sz * 0.5, sz, sz);
          g.globalAlpha = 1;
          g.strokeStyle = '#eeeae0';
          g.lineWidth = Math.max(minW * 1.5, sz * 0.28);
          g.lineCap = 'round';
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * sz, y - sn * sz); g.stroke();
          g.strokeStyle = cruise ? '#c0392b' : '#ff6a3a';
          g.lineWidth = Math.max(minW, sz * 0.2);
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * sz * 0.2, y - sn * sz * 0.2); g.stroke();
          g.globalCompositeOperation = 'lighter';
          // boost: a fierce plume while the motor accelerates the missile off the rail, settling to a cruise flame
          const boost = t ? Math.max(0, 1 - (this.time - t.born) / (cruise || nuke || mod?.id === 'missilebattery' ? 0.9 : 0.6)) : 0;
          const fr = sz * (0.4 + Math.random() * 0.2) * (1 + 0.9 * boost);
          const col = mod?.targetsAir && !mod.targetsGround ? 'rgba(120,170,255,0.9)' : 'rgba(255,220,120,0.9)';
          g.drawImage(glowTex(mod?.targetsAir && !mod.targetsGround ? '#78aaff' : '#ffc060'), x - cs * sz * 1.1 - fr * 1.8, y - sn * sz * 1.1 - fr * 1.8, fr * 3.6, fr * 3.6);
          g.drawImage(glowTex('#fff4d0'), x - cs * sz * 1.0 - fr * 0.6, y - sn * sz * 1.0 - fr * 0.6, fr * 1.2, fr * 1.2);
          if (nuke) { g.drawImage(softDot('rgba(255,120,40,0.9)'), x - cs * sz * 1.3 - fr * 1.6, y - sn * sz * 1.3 - fr * 1.6, fr * 3.2, fr * 3.2); g.drawImage(softDot('rgba(150,255,90,0.6)'), x - cs * sz * 0.5 - sz * 0.5, y - sn * sz * 0.5 - sz * 0.5, sz, sz); }
          this.trail(p.id, x - cs * sz, y - sn * sz, nuke ? 0.6 : cruise ? 0.3 : 0.14, nuke ? '#aaa49a' : '#b0aba2', nuke ? 0.12 : cruise ? 0.08 : 0.07, false, nuke ? 5 : cruise ? 3.8 : 2.8, nuke ? 0.55 : 0.4, 0.1);
          break;
        }
        case 'flame': {
          // a rope of fire: each round is drawn as a stretched, turbulent segment of the jet (they overlap into one
          // stream) — a thin white-yellow rope at the nozzle that widens into a rolling orange-red front, lifting as
          // it goes, with black smoke curling off. Bodies are normal-blended (deep colour), only the core is additive,
          // so a dozen jets on one target stay fire-coloured instead of blowing out to white.
          const napalm = mod?.id === 'napalm' || (mod?.caliber ?? 0) >= 0.9;
          const prog = clamp(pos.progress, 0, 1);
          const w = (0.09 + prog * 0.4) * (napalm ? 1.25 : 1) * (0.7 + 0.5 * cal);
          const L = Math.max(0.6, w * 2.8);
          const rise = prog * prog * 0.45;
          const fx0 = x + this.dirs.ux * rise, fy0 = y + this.dirs.uy * rise;
          const flick = ((this.time * 9) | 0) + p.id;
          const tr = g.getTransform();
          g.transform(cs, sn, -sn, cs, fx0, fy0);
          g.globalCompositeOperation = prevOp;
          g.globalAlpha = clamp(0.62 * (1 - prog * 0.35), 0, 1);
          g.drawImage(fireTex(prog < 0.45 ? 2 : 3, flick), -L * 0.8, -w, L, w * 2);
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = clamp(0.55 * (1 - prog * 0.7), 0, 1);
          g.drawImage(fireTex(prog < 0.3 ? 0 : 1, flick + 1), -L * 0.7, -w * 0.55, L * 0.85, w * 1.1);
          if (prog > 0.35) { g.globalAlpha = 0.35 * (1 - prog * 0.5); g.drawImage(fireTex(2, flick + 2), -L * 0.4, -w * 1.15, L * 0.6, w * 2.3); }
          g.setTransform(tr);
          if (prog > 0.25 && Math.random() < dt * 12 && this.fx.busy < 0.55) this.fx.fire(pos.x, pos.y, w * 0.8, 0.42, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 0.6 + Math.random(), hz + rise);
          if (prog > 0.4 && Math.random() < dt * 10 && this.fx.busy < 0.5) this.fx.smoke(pos.x, pos.y, w * 0.9, 1.5, '#221e1a', this.fx.wind.x * 0.4, 0, 0.38, 0.9, hz + rise);
          if (prog > 0.3 && Math.random() < dt * 5 && this.fx.busy < 0.5) this.fx.sparks(pos.x, pos.y, 1, '#ffb050', 1.5, undefined, Math.PI, 0.5, true);
          break;
        }
        case 'arc': {
          const sc = 1 + pos.z * 0.12;
          if (t?.bomblet) {
            // cluster bomblet: a tiny dark canister with a blinking red arming light, tumbling out of the burst
            const r = 0.055 * sc;
            g.globalCompositeOperation = prevOp;
            g.fillStyle = '#26241f';
            g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
            g.globalCompositeOperation = 'lighter';
            const on = Math.sin(this.time * 30 + p.id) > 0;
            g.globalAlpha = on ? 1 : 0.35;
            g.drawImage(glowTex('#ff4a30'), x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
            break;
          }
          if (vis === 'mortar' && cal < 0.4) {
            // grenade: a small olive-drab egg tumbling end over end, a blinking fuse, a thin wisp of smoke
            const r = 0.055 * sc, rot = this.time * 14 + p.id;
            g.globalCompositeOperation = prevOp;
            g.fillStyle = '#3e4a2a';
            g.beginPath(); g.ellipse(x, y, r * 1.35, r * 0.9, rot, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#8a9a68';
            g.beginPath(); g.arc(x - r * 0.35, y - r * 0.3, r * 0.35, 0, Math.PI * 2); g.fill();
            g.globalCompositeOperation = 'lighter';
            g.globalAlpha = Math.sin(this.time * 24 + p.id) > 0 ? 0.9 : 0.3;
            g.drawImage(glowTex('#ffd080'), x - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2);
            this.trail(p.id, x, y, 0.05, '#9a958c', 0.12, false, 0.7, 0.2, 0.05);
            break;
          }
          if (mod?.fireField && !mod.fireField.rad && mod.mount !== 'XL' && mod.category !== 'energy') {
            // firebomb: a canister already alight, trailing flame and black smoke
            const r = (0.08 + 0.07 * cal) * sc;
            g.globalAlpha = 0.85;
            g.drawImage(glowTex('#ff6a18'), x - r * 3.4, y - r * 3.4, r * 6.8, r * 6.8);
            g.globalAlpha = 1;
            g.drawImage(fireTex(1, p.id), x - r * 1.4, y - r * 1.4, r * 2.8, r * 2.8);
            if (this.fx.busy < 0.6 && Math.random() < dt * 40) this.fx.fire(pos.x, pos.y, r * 1.2, 0.35, 0, 0, 0, hz);
            this.trail(p.id, x, y, 0.09 * sc, '#2a2622', 0.1, false, 1.4, 0.35, 0.1);
            break;
          }
          const r = (0.09 + 0.07 * cal) * sc * (mod?.cluster ? 1.25 : 1);
          g.globalCompositeOperation = prevOp;
          g.fillStyle = '#2a2a28';
          g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#9a9a90';
          g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, Math.PI * 2); g.fill();
          if (mod?.cluster) {
            // cluster carrier: a yellow band round the body (sub-munitions inside)
            g.strokeStyle = '#e8c040';
            g.lineWidth = Math.max(minW, r * 0.35);
            g.beginPath(); g.arc(x, y, r * 0.8, 0, Math.PI * 2); g.stroke();
          }
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = 0.6;
          g.drawImage(glowTex('#ffb060'), x - r * 2.4, y - r * 2.4, r * 4.8, r * 4.8);
          this.trail(p.id, x, y, 0.08 * sc, '#6a655d', 0.09, false, 1.6, 0.3, 0.05);
          break;
        }
        case 'orb': {
          if (vis === 'sonic') {
            // a pressure wave: a few faint arcs bowed forward along the line of travel (no flying disc)
            const r = 0.3 + clamp(pos.progress, 0, 1) * 0.45;
            g.strokeStyle = '#bfe8ff';
            g.lineCap = 'round';
            for (let k = 0; k < 3; k++) {
              const rk = r * (1 - k * 0.22);
              g.globalAlpha = 0.32 * (1 - k * 0.3);
              g.lineWidth = Math.max(minW, 0.035 * (1 - k * 0.25));
              g.beginPath(); g.arc(x - cs * k * 0.12, y - sn * k * 0.12, rk, pos.angle - 0.75, pos.angle + 0.75); g.stroke();
            }
          } else if (vis === 'emp') {
            // a small crackling charge: hot white-blue core with flickering arcs, not a glowing ball
            const r = 0.12;
            g.globalAlpha = 0.8;
            g.drawImage(glowTex('#8ab8ff'), x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
            g.globalAlpha = 1;
            g.drawImage(glowTex('#ffffff'), x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
            g.strokeStyle = '#dff0ff';
            g.lineWidth = Math.max(minW, 0.018);
            g.globalAlpha = 0.85;
            for (let k = 0; k < 2; k++) {
              const a0 = this.time * 37 + p.id * 1.7 + k * 2.4;
              g.beginPath(); g.moveTo(x, y);
              g.lineTo(x + Math.cos(a0) * r * 1.6, y + Math.sin(a0) * r * 1.6);
              g.lineTo(x + Math.cos(a0 + 0.6) * r * 2.6, y + Math.sin(a0 + 0.6) * r * 2.6);
              g.stroke();
            }
          } else {
            // plasma bolt: a short elongated slug of white-hot gas in a violet sheath, with a fading wake
            const big = mod && moduleTier(mod) >= 3 ? 1.8 : 1;
            const r = (0.07 + 0.05 * cal) * big;
            const pc = '#c25cff';
            const tl = r * 9;
            const gr = g.createLinearGradient(x, y, x - cs * tl, y - sn * tl);
            gr.addColorStop(0, rgba(pc, 0.55));
            gr.addColorStop(1, rgba(pc, 0));
            g.globalAlpha = 1;
            g.strokeStyle = gr;
            g.lineCap = 'round';
            g.lineWidth = r * 1.6;
            g.beginPath(); g.moveTo(x, y); g.lineTo(x - cs * tl, y - sn * tl); g.stroke();
            g.strokeStyle = '#f6e8ff';
            g.lineWidth = r * 0.9;
            g.beginPath(); g.moveTo(x + cs * r, y + sn * r); g.lineTo(x - cs * r * 2.2, y - sn * r * 2.2); g.stroke();
            g.globalAlpha = 0.5;
            g.drawImage(glowTex(pc), x - r * 2.4, y - r * 2.4, r * 4.8, r * 4.8);
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
  private trail(id: number, x: number, y: number, r: number, color: string, spacing: number, glow = false, life = 0.9, alpha = 0.35, rise = 0): void {
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
      else this.fx.smoke(px, py, r, life, color, this.fx.wind.x * 0.5, this.fx.wind.y * 0.5, alpha, rise);
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

  /** Barrel heading as drawn: the sim aims each mount from its own pivot, so the drawn barrel just follows it. */
  private barrelAim(u: SimUnit, i: number, _x: number, _y: number, _hull: number, simAng: number): number {
    void u; void i;
    return simAng;
  }

  /** World position of a mount's barrel tip right now (as drawn), and the barrel heading. */
  private muzzleOf(unitId: number, mount: number): { x: number; y: number; d: number; aim: number } | null {
    const ur = this.unitRender(unitId);
    if (!ur || mount < 0 || !ur.u.mounts[mount]) return null;
    const aim = this.barrelAim(ur.u, mount, ur.x, ur.y, ur.angle, ur.u.mounts[mount].angle);
    const m = muzzlePos(ur.u.design, mount, ur.x, ur.y, ur.angle, aim);
    const bs = bodyScale(layoutOf(ur.u.design).S);
    let mx = ur.x + (m.x - ur.x) * bs, my = ur.y + (m.y - ur.y) * bs;
    if (ur.u.flying) { mx += this.dirs.ux * 0.12; my += this.dirs.uy * 0.12; }
    if (this.tiltOn) {
      // barrel sits on top of the raised hull; ground rounds are then drawn from the shared gun line (see drawProjectiles)
      const L = layoutOf(ur.u.design);
      const h = ur.u.flying || L.air ? flyHeight(L.S, L.mob.id === 'jet') : hullHeight(L.S) * (L.mob.id === 'spider' || L.mob.id === 'titanlegs' || CREATURE_SHAPES.has(L.shape) ? 0.8 : 1) * 1.45;
      const lv = this.liftVec(h);
      mx += lv.x; my += lv.y;
    }
    return { x: mx, y: my, d: m.d, aim };
  }

  /** Unit whose centre sits at (x, y): the sim reports beam / chain / direct-hit endpoints at target centres. Units that
   *  died since the last snapshot count too (the killing shot's beam still ends on the hull it destroyed). */
  private unitNear(x: number, y: number): SimUnit | null {
    let best: SimUnit | null = null, bd = 0.36;
    for (const u of this.units.values()) {
      if (!u.alive && !this.prevU.has(u.id)) continue;
      const d = (u.x - x) ** 2 + (u.y - y) ** 2;
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  /** Focusing beam state of a mount (mirrors the sim's ramp: RAMP_TIME 2.5 s on one target, reset by a switch or a pause
   *  over 1 s): 0..1 focus after this pulse. */
  private rampOf(unit: number, mount: number, target: number, ramp: number): number {
    const u = this.units.get(unit);
    if (!u) return 0;
    const v = this.visOf(u), now = this.fx.simT;
    if (!v.ramp) v.ramp = [];
    let r = v.ramp[mount];
    if (!r || r.t !== target || now - r.last > 1) r = v.ramp[mount] = { t: target, start: now, last: now };
    r.last = now;
    return ramp > 1 ? clamp((now - r.start) / 2.5, 0, 1) : 0;
  }

  /** The blast of `moduleId` in this event batch nearest (x, y) (splash hits are reported at the struck unit). */
  private blastNear(moduleId: string, x: number, y: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null, bd = 9;
    for (const b of this.blasts) {
      if (b.moduleId !== moduleId) continue;
      const d = (b.x - x) ** 2 + (b.y - y) ** 2;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  /** rounds in flight by module, built lazily once per event batch (piercing rounds fly on after a hit) */
  private flying: Map<string, SimProjectile[]> | null = null;

  /** Heading of the round of `moduleId` that struck near (x, y): one that vanished there since the last batch, or one
   *  still in flight close by (piercing). NaN when there is none. */
  private hitDir(moduleId: string, x: number, y: number): number {
    let best = NaN, bd = 2.5 * 2.5;
    for (const q of this.gone) {
      if (q.moduleId !== moduleId) continue;
      const d = (q.x - x) ** 2 + (q.y - y) ** 2;
      if (d < bd) { bd = d; best = q.angle; }
    }
    if (!this.flying) {
      this.flying = new Map();
      for (const p of this.battle?.projectiles ?? []) {
        if (p.kind !== 'bullet' && p.kind !== 'shell') continue;
        let l = this.flying.get(p.moduleId);
        if (!l) this.flying.set(p.moduleId, (l = []));
        l.push(p);
      }
    }
    for (const p of this.flying.get(moduleId) ?? []) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = p.angle; }
    }
    return best;
  }

  /** Where a shot from (fx, fy) meets unit u's drawn hull (a rounded box), so beams and sparks land on armour instead of
   *  the middle of the sprite. Render only: the sim still resolves the hit against the whole unit. */
  private hullEdge(u: SimUnit, fx: number, fy: number, cx = u.x, cy = u.y): { x: number; y: number } {
    const L = layoutOf(u.design);
    const dx = fx - cx, dy = fy - cy;
    const c = Math.cos(u.angle), sn = Math.sin(u.angle);
    const lx = Math.abs(dx * c + dy * sn), ly = Math.abs(-dx * sn + dy * c);
    const bs = bodyScale(L.S), hx = L.X * 0.42 * bs, hy = L.Y * 0.42 * bs;
    if (lx < 1e-6 && ly < 1e-6) return { x: cx, y: cy };
    const box = Math.min(lx > 1e-6 ? hx / lx : Infinity, ly > 1e-6 ? hy / ly : Infinity);
    const ell = 1 / Math.hypot(lx / hx, ly / hy);
    const f = (box + ell) / 2;
    if (f >= 1) return { x: cx, y: cy };
    return { x: cx + dx * f, y: cy + dy * f };
  }

  /** World offset from an aircraft's ground position to its drawn body (altitude under the tilt, plus the small
   *  airborne lift drawUnit adds); zero for ground units. Hits, bursts and shields on flyers are drawn there. */
  private airLift(u: SimUnit): { x: number; y: number } {
    if (!u.flying && !layoutOf(u.design).air) return { x: 0, y: 0 };
    const h = 0.12 + (this.tiltOn ? flyHeight(layoutOf(u.design).S, u.design.mobility === 'jet') * TILT_TAN : 0);
    return { x: this.dirs.ux * h, y: this.dirs.uy * h };
  }

  /** Where a shot ending at (x2, y2) is drawn to end: the hull edge (or shield) of the unit there, raised to the gun
   *  line (ground units) or to the aircraft's body (flyers). Remembers the origin for the matching 'hit'. */
  private shotEnd(x1: number, y1: number, x2: number, y2: number): { x: number; y: number } {
    const t = this.unitNear(x2, y2);
    const end = this.clipToHull(x1, y1, x2, y2, t);
    const l = t && (t.flying || layoutOf(t.design).air) ? this.airLift(t) : this.liftVec(GUN_H);
    return { x: end.x + l.x, y: end.y + l.y };
  }

  /** Clip a segment ending on a unit's centre to that unit's hull edge; remembers the origin for the matching 'hit'. */
  private clipToHull(x1: number, y1: number, x2: number, y2: number, t = this.unitNear(x2, y2)): { x: number; y: number } {
    if (!t) return { x: x2, y: y2 };
    this.shotFrom.set(t.id, { x: x1, y: y1 });
    // the hull is drawn interpolated (a tick behind the sim): clip to it as drawn
    const c = this.unitRender(t.id) ?? t;
    if (t.shield > 0 || t.auraShield > 0) {
      // shielded: stop on the bubble (same radius the shield hex flashes at)
      const r = shieldR(layoutOf(t.design)), d = Math.hypot(x1 - c.x, y1 - c.y);
      if (d > r) return { x: c.x + ((x1 - c.x) / d) * r, y: c.y + ((y1 - c.y) / d) * r };
    }
    return this.hullEdge(t, x1, y1, c.x, c.y);
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
          if (mod?.spinUp) {
            // spin-up guns: remember the shot; the drawn barrel speed / heat follows (see drawBattle)
            const n = ur.u.mounts.length;
            if (!v.spin) { v.spin = new Array(n).fill(0); v.lastFire = new Array(n).fill(-9); v.spinT = new Array(n).fill(0); }
            v.spinT![e.mount] = mod.spinUp;
            v.lastFire![e.mount] = this.fx.simT;
          }
        }
        const spin = ur && mod?.spinUp ? this.visOf(ur.u).spin?.[e.mount] ?? 0 : 0;
        const cs = Math.cos(e.angle), sn = Math.sin(e.angle);
        const cal = mod?.caliber ?? 0.5;
        const glowC = moduleGlow(mod, TEAM_PAL[ur ? this.teamOf(ur.u.side) : 0]);
        if (mod && moduleTier(mod) >= 4 && mod.kind === 'weapon' && mod.category !== 'melee') {
          const T = moduleTier(mod) === 5;
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
        const S0 = ur ? layoutOf(ur.u.design).S : 1;
        const gunKick = (k: number) => { if (!ur) return; const v = this.visOf(ur.u); v.kx = (v.kx ?? 0) - cs * k / Math.max(1, S0 * 0.8); v.ky = (v.ky ?? 0) - sn * k / Math.max(1, S0 * 0.8); };
        switch (vis) {
          case 'gun': case 'gatling': case 'shotgun': case 'sniper': case 'flak': case 'cannon': case 'artillery': case 'gauss': {
            const heavy = vis === 'cannon' || vis === 'artillery' || vis === 'gauss';
            const dart = vis === 'shotgun' && !!mod?.pierce;
            const r = Math.max(0.2, d * (0.5 + cal * 0.7)) * (heavy ? 1.1 : 1) * (vis === 'shotgun' ? (dart ? 1.1 : 1.4) : 1) * (vis === 'gatling' ? 0.7 + 0.5 * spin : 1);
            const col = vis === 'gauss' ? '#9fe8ff' : vis === 'sniper' ? '#ffe6c0' : dart ? '#e8f4ff' : mod?.slow ? '#e8d8ff' : mod?.category === 'autocannon' ? '#ffb858' : '#ffd890';
            fx.muzzle(mx, my, e.angle, r, col, heavy);
            if (vis === 'gun' || vis === 'gatling' || vis === 'shotgun') { if (Math.random() < (vis === 'gatling' ? 0.25 + 0.5 * spin : dart ? 0 : 0.45)) fx.casing(mx - cs * d * 0.6, my - sn * d * 0.6, e.angle); }
            if (vis === 'shotgun') {
              // scatter guns: a short, wide blast; flechettes add a cold glint of steel leaving in a cone
              fx.cone(mx, my, e.angle, r * 0.9, r * 1.3, dart ? '#d8ecff' : '#ffc070', 0.05);
              if (dart) fx.sparks(mx + cs * 0.1, my + sn * 0.1, 6, '#e8f6ff', 8, e.angle, 0.45, 0.12);
            } else if (vis === 'gatling' && spin > 0.45) {
              // rotary at speed: a continuous, flickering ring of fire round the barrel cluster
              fx.glow(mx, my, r * 1.1, spin > 0.85 ? '#ffd080' : '#ffb050', 0.05, 0.35 + 0.4 * spin);
            } else if (vis === 'gun' && mod?.category === 'autocannon') {
              // muzzle brake: the blast vents sideways as well as forward
              for (const sd of [-1, 1]) fx.cone(mx - cs * r * 0.1, my - sn * r * 0.1, e.angle + sd * 1.75, r * 0.65, r * 0.32, col, 0.035);
            }
            if (heavy || vis === 'shotgun' || vis === 'sniper') {
              fx.sparks(mx, my, heavy ? 8 : 4, vis === 'gauss' ? '#bff0ff' : '#ffd890', 6, e.angle, 0.3, 0.2);
              if (mod && moduleTier(mod) === 3) fx.shake(0.12);
            }
            if (heavy && ur) {
              // the blast kicks a ring of dust off the ground below the barrel; the whole hull rocks back
              const big = cal >= 0.8;
              fx.dustRing(ur.x + cs * d * 0.7, ur.y + sn * d * 0.7, 0.1, 0.5 + cal * (big ? 1.6 : 0.9), 0.4, 0.38);
              fx.dust(ur.x + cs * d * 0.5, ur.y + sn * d * 0.5, 0.2 + 0.25 * cal, big ? 4 : 2, 0.7);
              gunKick(0.03 + 0.05 * cal);
              if (vis === 'gauss') { fx.ring(mx, my, 0.1, 0.9, '#9fe8ff', 0.25, 0.8); }
            }
            break;
          }
          case 'rocketPod': case 'missileRack': case 'cruise': {
            const big = vis === 'cruise';
            // launch: bright back-flame, smoke puffs that hang, a hint of ground blast
            fx.cone(mx, my, e.angle + Math.PI, big ? 1.8 : 0.7, big ? 0.7 : 0.3, '#ffb060', 0.09);
            fx.glow(mx, my, big ? 0.9 : 0.4, '#ffd8a0', 0.08, 0.9);
            fx.light(mx, my, big ? 3 : 1.4, '#ffa050', 0.25, 0.4);
            for (let i = 0; i < (big ? 6 : 2); i++) fx.smoke(mx - cs * d * 0.8, my - sn * d * 0.8, big ? 0.35 : 0.16, big ? 2.4 : 1.4, '#8a867e', -cs * 1.5 + (Math.random() - 0.5), -sn * 1.5 + (Math.random() - 0.5), 0.5, 0.3, 0.2);
            if (big) { fx.dust(mx, my, 0.8, 5); fx.dustRing(mx, my, 0.2, 1.8, 0.5, 0.4); fx.shake(0.1); }
            break;
          }
          case 'mortar': {
            if (cal < 0.4) {
              // grenade launcher: a soft 'thunk', a little puff, no blast
              fx.cone(mx, my, e.angle, 0.22, 0.14, '#ffd8a0', 0.035);
              fx.smoke(mx + cs * 0.1, my + sn * 0.1, 0.1, 1.0, '#8a867e', cs * 0.6, sn * 0.6, 0.4, 0.4, 0.2);
              break;
            }
            fx.muzzle(mx, my, e.angle, 0.28, mod?.fireField ? '#ff9a40' : '#ffc070', true);
            fx.ring(mx, my, 0.05, 0.6, '#ffe0b0', 0.2, 0.5);
            fx.smoke(mx, my, 0.18, 1.6, '#77736b', 0, 0, 0.5, 0.7, 0.3);
            if (mod?.fireField) { fx.embers(mx, my, 4, 0.3); fx.glow(mx, my, 0.4, '#ff7a20', 0.15, 0.7); }
            break;
          }
          case 'sonic':
            fx.ring(mx + cs * 0.2, my + sn * 0.2, 0.1, 1.0, '#5ec8ff', 0.25, 0.9);
            fx.ring(mx + cs * 0.1, my + sn * 0.1, 0.05, 0.6, '#ffffff', 0.16, 0.6);
            break;
          case 'flamer': {
            // ignition: bright orange cone and a puff of black smoke at the nozzle
            const big = cal >= 0.8;
            fx.cone(mx, my, e.angle, 0.7 + cal * 1.2, 0.35 + cal * 0.5, '#ff9a30', 0.1);
            fx.glow(mx, my, 0.25 + cal * 0.4, '#ffb050', 0.1, 0.8);
            if (Math.random() < 0.3) fx.smoke(mx + cs * 0.2, my + sn * 0.2, 0.12 + cal * 0.1, 1.0, '#2a2622', cs * 0.8, sn * 0.8, 0.35, 0.5, 0.3);
            if (big && Math.random() < 0.3) fx.fire(mx + cs * 0.4, my + sn * 0.4, 0.3, 0.4, cs * 4, sn * 4, 0.3);
            break;
          }
          case 'repair': case 'pointdef':
            fx.glow(mx, my, 0.14, glowC, 0.08, 0.8);
            break;
          case 'saw': case 'chainsaw': case 'hammer': case 'claw': case 'blade': case 'drill': case 'prod': case 'ram': {
            const titan = !!mod && (mod.mount === 'XL' || moduleTier(mod) >= 4);
            const col = vis === 'blade' ? glowC : vis === 'prod' ? '#bfe4ff' : vis === 'drill' ? '#fff0c8' : '#ffc060';
            // grinding / striking: a hot shower of bouncing sparks and a bright contact flash
            fx.sparks(mx, my, (vis === 'hammer' ? 14 : vis === 'saw' || vis === 'chainsaw' || vis === 'drill' ? 12 : 8) * (titan ? 2 : 1), col, 5, e.angle, 1.2, 0.3, true);
            fx.glow(mx, my, 0.22 + cal * 0.3, col, 0.07, 0.9);
            if (vis === 'hammer' || vis === 'ram') {
              fx.dust(mx, my, 0.4 + (titan ? 0.5 : 0), 3 + (titan ? 6 : 0));
              fx.shake(vis === 'hammer' ? 0.15 : 0.05);
              fx.ring(mx, my, 0.1, titan ? 2.8 : 1.0, '#e8d4a8', titan ? 0.5 : 0.28, 0.7);
              fx.dustRing(mx, my, 0.1, titan ? 3.2 : 1.2, titan ? 0.8 : 0.4, 0.45);
              if (titan) {
                fx.light(mx, my, 3.4, '#ffb060', 0.3, 0.35);
                fx.debris(mx, my, 8, '#3a3630', 4, 0.07, 1);
                fx.decal('crater', mx, my, 0.8);
                fx.star(mx, my, 1.4, '#fff0d0', Math.random() * 6, 0.08);
              }
            }
            if (vis === 'prod') { fx.bolt(mx, my, 0.3, '#bfe4ff', 0.18); fx.glow(mx, my, 0.4, '#8fb8ff', 0.15, 0.8); }
            if (vis === 'saw' || vis === 'chainsaw' || vis === 'drill') fx.glow(mx, my, 0.3 + cal * 0.4, '#ff9a40', 0.12, 0.6);
            break;
          }
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
        const sx = tip ? tip.x : e.x1, sy = tip ? tip.y : e.y1;
        // beams that end on a unit stop at its hull; the piercing lance (ends past the target) is left alone
        const tgt = this.unitNear(e.x2, e.y2);
        const end = this.clipToHull(sx, sy, e.x2, e.y2, tgt);
        const gl = tgt && (tgt.flying || layoutOf(tgt.design).air) ? this.airLift(tgt) : this.liftVec(GUN_H);
        const gx = end.x, gy = end.y; // where it touches the ground / hull edge (unlifted)
        e = { ...e, x2: end.x + gl.x, y2: end.y + gl.y };
        const pts = [sx, sy, e.x2, e.y2];
        const dirA = Math.atan2(e.y2 - sy, e.x2 - sx);
        const back = dirA + Math.PI;
        let impact = true;
        const q = fx.busy < 0.7;
        // the exotic energy weapons: each reads differently at a glance
        if (mod?.lifesteal) { // leech: crimson beam, life motes flowing back to the shooter
          fx.beam('laser', pts, '#ff2a5a', 0.06, 0.14);
          if (q) { fx.glow(e.x2, e.y2, 0.3, '#ff3a6a', 0.15, 0.8); if (Math.random() < 0.5) fx.glow(sx, sy, 0.35, '#7dff9a', 0.25, 0.5); }
          break;
        }
        if (mod?.split) { // prism: thin cyan-white beams
          fx.beam('laser', pts, '#b8f4ff', 0.035, 0.12);
          if (q) fx.glow(e.x2, e.y2, 0.22, '#c8f8ff', 0.12, 0.8);
          break;
        }
        if (mod?.pctHp) { // void lance: a fat black-violet beam that swallows light
          fx.beam('gravity', pts, '#6a1aff', 0.14, 0.3);
          if (q) { fx.glow(e.x2, e.y2, 0.7, '#4a00c8', 0.4, 0.7); fx.ring(e.x2, e.y2, 0.7, 0.05, '#b08aff', 0.35, 0.7); }
          break;
        }
        if (mod?.shred) { // entropy: sickly yellow-green corrosion
          fx.beam('heat', pts, '#c8e83a', 0.05, 0.12);
          if (q && Math.random() < 0.5) fx.molten(e.x2, e.y2, 1, '#d8ff5a');
          break;
        }
        switch (vis) {
          case 'heatray': {
            fx.beam('heat', pts, '#ff6a1a', 0.07, 0.14);
            if (q) {
              // molten droplets, rising smoke, a scorch that glows and lingers
              if (Math.random() < 0.7) fx.molten(e.x2, e.y2, 2, '#ffb040');
              if (Math.random() < 0.25) fx.smoke(gx, gy, 0.12, 1.4, '#3a342e', 0, 0, 0.3, 0.8, 0.3);
              if (Math.random() < 0.12) { fx.hot(gx, gy, 0.5, 1.6); fx.decal('scorch', gx, gy, 0.22); }
            }
            break;
          }
          case 'plasma': {
            if (mod?.id === 'annihilator') {
              // warm-up: starts as a thin flickering lance and swells into a blinding river over ~1.5 s of fire
              const h = this.beamHeat;
              fx.beam('plasma', pts, '#e070ff', 0.08 + 0.34 * h * h, 0.24);
              fx.glow(sx, sy, 0.6 + 1.4 * h, '#ff80f0', 0.12, 0.9); // at the drawn barrel tip
              if (h > 0.6) { fx.sparks(e.x2, e.y2, 5, '#ffd0ff', 6, undefined, Math.PI, 0.35, true); if (Math.random() < 0.3) { fx.decal('scorch', gx, gy, 0.5); fx.hot(gx, gy, 0.8, 2); } }
              if (h > 0.85) fx.shake(0.04);
            } else {
              fx.beam('plasma', pts, '#c25cff', 0.06, 0.15);
              if (q && Math.random() < 0.5) fx.molten(e.x2, e.y2, 2, '#f0a0ff');
              if (q && Math.random() < 0.1) { fx.decal('scorch', gx, gy, 0.3); fx.hot(gx, gy, 0.5, 1.4); }
            }
            break;
          }
          case 'slowbeam': fx.beam('slow', pts, '#b47cff', 0.05, 0.22); break;
          case 'repair': fx.beam('repair', pts, '#6dff9a', 0.05, 0.25); impact = false; if (Math.random() < 0.3) fx.heal(e.x2, e.y2); break;
          case 'emp': {
            if (mod?.disarm) {
              // disarm ray: a jagged crimson scrambler; the struck hull spits red static
              fx.beam('scramble', pts, '#ff3a5a', 0.05, 0.28);
              fx.sparks(e.x2, e.y2, 5, '#ff7088', 3.5, back, 1.4, 0.25, true);
              fx.glow(e.x2, e.y2, 0.45, '#ff2040', 0.2, 0.6);
              impact = false;
            } else fx.beam('scramble', pts, glowC, 0.05, 0.28);
            break;
          }
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
            const huge = !!mod && moduleTier(mod) === 5;
            const w = huge ? 0.5 : heavy ? 0.16 : 0.09;
            fx.beam('rail', pts, '#9fe8ff', w, huge ? 0.9 : heavy ? 0.5 : 0.35);
            // the hot line leaves a fading ion trail and rings of displaced air along its path
            fx.beam('ion', pts, '#8fdcff', w, huge ? 1.4 : heavy ? 0.9 : 0.6);
            if (huge) {
              // spinal mass driver: blinding flash, ionised trail, the ground torn up along the line
              fx.flash(0.5, '#d8f6ff');
              fx.glow(sx, sy, 3.2, '#ffffff', 0.18);
              // ground torn up along the line: ground-level ends (mount, unlifted impact point)
              const len = Math.hypot(gx - e.x1, gy - e.y1), n = Math.min(14, Math.floor(len / 1.4));
              for (let i = 1; i <= n; i++) {
                const f = i / (n + 1), qx = e.x1 + (gx - e.x1) * f, qy = e.y1 + (gy - e.y1) * f;
                fx.schedule(i * 0.012, () => { fx.dust(qx, qy, 0.5, 2, 0.9); fx.glow(qx, qy, 0.7, '#9fe8ff', 0.25, 0.6); });
              }
              fx.boom(gx, gy, 1.0, 'plasma');
            }
            fx.muzzle(sx, sy, dirA, huge ? 1.2 : heavy ? 0.5 : 0.3, '#bff0ff', heavy);
            // heavy impact punch
            fx.sparks(e.x2, e.y2, huge ? 24 : heavy ? 14 : 8, '#cff4ff', huge ? 8 : 6, back, 1.1, 0.3, true);
            fx.ring(gx, gy, 0.1, huge ? 2.0 : heavy ? 1.1 : 0.7, '#bff0ff', 0.25, 0.8);
            if (heavy || huge) { fx.dust(gx, gy, huge ? 0.7 : 0.35, huge ? 6 : 3, 0.8); fx.decal('scorch', gx, gy, huge ? 0.8 : 0.3); }
            if (huge) { fx.shockwave(gx, gy, 1.6, '#9fe8ff', 0.5); fx.ring(sx, sy, 0.2, 1.8, '#cff4ff', 0.35, 0.9); }
            if (huge) fx.shake(0.4); else if (heavy) fx.shake(0.18);
            impact = false;
            break;
          }
          case 'pointdef': fx.beam('laser', pts, '#ff6060', 0.025, 0.08); impact = false; break;
          case 'sniper': fx.beam('sniper', pts, '#ff5050', 0.04, 0.2); break;
          default: {
            if (mod?.ramp && e.unit !== undefined && e.mount !== undefined) {
              // focusing beam: one held line that swells, whitens and burns deeper the longer it stays on one target
              const k = this.rampOf(e.unit, e.mount, tgt ? tgt.id : -1, mod.ramp);
              fx.beam('laser', pts, '#ff3322', 0.03, 0.17, k);
              fx.glow(sx, sy, 0.12 + 0.22 * k, k > 0.7 ? '#fff0e0' : '#ff8a70', 0.1, 0.5 + 0.4 * k);
              if (q && Math.random() < 0.25 + 0.6 * k) fx.molten(e.x2, e.y2, 1 + Math.round(2 * k), k > 0.6 ? '#fff0c0' : '#ffd090');
              if (q && Math.random() < 0.03 + 0.15 * k) { fx.hot(gx, gy, 0.25 + 0.3 * k, 1.2); if (k > 0.8) fx.decal('scorch', gx, gy, 0.18); }
              if (q && k > 0.6 && Math.random() < 0.15) fx.smoke(gx, gy, 0.1, 1.2, '#3a342e', 0, 0, 0.3, 0.8, 0.3);
              break;
            }
            // pulse lasers: a short, hard red pulse (team colour read from the hull, not the beam)
            fx.beam('laser', pts, '#ff3322', 0.03, 0.09);
            if (q && Math.random() < 0.35) fx.molten(e.x2, e.y2, 1, '#ffd090');
            if (q && Math.random() < 0.06) fx.hot(gx, gy, 0.3, 1.0);
          }
        }
        if (impact && q && Math.random() < 0.6) fx.sparks(e.x2, e.y2, 3, '#ffc080', 3.5, back, 1.3, 0.2, true);
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
        // each arc jumps hull edge to hull edge: clip the end of a segment to its unit, start the next from there
        for (let i = 2; i + 1 < pts.length; i += 2) {
          const end = this.shotEnd(pts[i - 2], pts[i - 1], pts[i], pts[i + 1]);
          pts[i] = end.x; pts[i + 1] = end.y;
        }
        if (pts.length >= 4) fx.beam('lightning', pts, col, heavy ? 0.05 : 0.035, heavy ? 0.26 : 0.2);
        // strikes: a few hot sparks off each struck hull and a flash of ionised air
        for (let i = 2; i < pts.length; i += 2) {
          fx.sparks(pts[i], pts[i + 1], 3, '#e0f0ff', 3.5, undefined, Math.PI, 0.2, true);
          fx.star(pts[i], pts[i + 1], heavy ? 0.7 : 0.5, '#cfe0ff', Math.random() * 6, 0.06);
        }
        if (pts.length >= 2) { fx.glow(pts[0], pts[1], heavy ? 0.7 : 0.4, '#dfe8ff', 0.08, 0.8); fx.ring(pts[0], pts[1], 0.05, 0.6, col, 0.18, 0.5); }
        break;
      }
      case 'hit': {
        const ur = this.units.get(e.unit);
        const mod = modOf(e.moduleId);
        if (!ur) {
          fx.dirtKick(e.x, e.y, 1);
          break;
        }
        if (e.damage > 0) this.visOf(ur).dmgT = this.time;
        // the hull is drawn interpolated (a tick behind the sim): hits flash on it as drawn
        const dr = this.unitRender(ur.id) ?? ur;
        // which way the round was flying (projectile weapons whose look depends on it: AP, piercing, knockback)
        const dirMod = !!mod && !mod.spinUp && (mod.projectile === 'bullet' || mod.projectile === 'shell') && (!!mod.pierce || !!mod.impulse || (mod.ap ?? 0) >= 0.45);
        const flew = dirMod ? this.hitDir(mod!.id, e.x, e.y) : NaN;
        // direct hits (beams, rails, arcs, splash) are reported at the unit centre: move them to the edge facing the shooter
        if ((e.x - ur.x) ** 2 + (e.y - ur.y) ** 2 < 0.01) {
          const from = this.shotFrom.get(ur.id);
          const a = from ? Math.atan2(from.y - dr.y, from.x - dr.x) : !Number.isNaN(flew) ? flew + Math.PI : Math.random() * Math.PI * 2;
          const far = { x: dr.x + Math.cos(a) * 50, y: dr.y + Math.sin(a) * 50 };
          const r = shieldR(layoutOf(ur.design));
          const p = e.shieldHit ? { x: dr.x + Math.cos(a) * r, y: dr.y + Math.sin(a) * r } : this.hullEdge(ur, far.x, far.y, dr.x, dr.y);
          e = { ...e, x: p.x, y: p.y };
        } else e = { ...e, x: e.x + dr.x - ur.x, y: e.y + dr.y - ur.y };
        // aircraft are drawn at altitude: their hits flash on the drawn body, not on the ground below it
        const al = this.airLift(ur);
        const hx0 = e.x, hy0 = e.y; // hit point on the ground plane (knockback direction)
        if (al.x || al.y) e = { ...e, x: e.x + al.x, y: e.y + al.y };
        if (e.shieldHit) {
          const v = this.visOf(ur);
          v.shieldT = this.time;
          if (fx.busy < 0.7) fx.hex(dr.x + al.x, dr.y + al.y, shieldR(layoutOf(ur.design)), e.x, e.y);
          fx.sparks(e.x, e.y, 3, '#bfefff', 2.5, undefined, Math.PI, 0.2);
          break;
        }
        const vis = mod?.visual;
        // heavy hits shove the drawn sprite away from the shooter (render only; heavier hulls barely move)
        if (e.damage > 25) {
          const from = this.shotFrom.get(ur.id) ?? ((hx0 - ur.x) ** 2 + (hy0 - ur.y) ** 2 > 0.04 ? { x: hx0, y: hy0 } : undefined);
          if (from) {
            const a = Math.atan2(ur.y - from.y, ur.x - from.x), v = this.visOf(ur), S = layoutOf(ur.design).S;
            const k = clamp(Math.sqrt(e.damage) * 0.0045, 0, 0.07) / Math.max(1, S * 0.9);
            v.kx = (v.kx ?? 0) + Math.cos(a) * k;
            v.ky = (v.ky ?? 0) + Math.sin(a) * k;
          }
        }
        if (vis === 'repair') break;
        if (vis === 'flamer') { fx.flameHit(e.x, e.y, 0.6 + (mod?.caliber ?? 0.3)); break; }
        if (vis === 'heatray') break;
        const S = layoutOf(ur.design).S;
        // knockback (impulse weapons, ground units): dirt shoved out from under the hull along the push
        if (mod?.impulse && !ur.flying && mod.category !== 'melee') {
          const bl = this.blastNear(mod.id, hx0, hy0);
          const pa = bl ? Math.atan2(ur.y - bl.y, ur.x - bl.x) : flew;
          if (!Number.isNaN(pa) && (!bl || (ur.x - bl.x) ** 2 + (ur.y - bl.y) ** 2 > 0.01)) fx.knockDust(dr.x, dr.y, pa, S, mod.impulse * 1.5);
        }
        if (mod?.pierce && (vis === 'shotgun' || vis === 'gauss')) {
          // piercing rounds: they go in, and on out the far side
          const a = Number.isNaN(flew) ? Math.atan2(dr.y - e.y, dr.x - e.x) : flew;
          const big = vis === 'gauss';
          fx.sparks(e.x, e.y, big ? 5 : 2, big ? '#dff8ff' : '#e8f4ff', 3, a + Math.PI, 1, 0.15, true);
          fx.pierceExit(dr.x + al.x + Math.cos(a) * 0.25 * S * bodyScale(S), dr.y + al.y + Math.sin(a) * 0.25 * S * bodyScale(S), a, big ? '#9fe8ff' : '#dcecff', big);
          if (big) { fx.ring(e.x, e.y, 0.05, 0.7, '#9fe8ff', 0.22, 0.8); fx.glow(e.x, e.y, 0.5, '#9fe8ff', 0.12, 0.7); }
          break;
        }
        if (!Number.isNaN(flew) && (mod?.ap ?? 0) >= 0.45 && !mod?.impulse && !mod?.spinUp && mod?.category !== 'autocannon') {
          // armour-piercing: a hard white star and spall punching on through (small for the heavy MG / sniper)
          if (mod!.category === 'machinegun') { fx.armorHit(e.x, e.y, e.damage, '#fff0d0'); fx.sparks(e.x, e.y, 2, '#ffffff', 6, flew, 0.15, 0.12); }
          else fx.apHit(e.x, e.y, flew, e.damage);
          break;
        }
        // explosive warheads with no blast radius (AT missiles) burst on the hull they hit (a kill adds its own blast)
        if (mod && (mod.projectile === 'missile' || mod.projectile === 'rocket') && !mod.splash) {
          fx.boom(e.x, e.y, 0.3 + Math.min(0.5, Math.sqrt(e.damage) * 0.025), 'fire', false);
          fx.sparks(e.x, e.y, 6, '#fff0c0', 7, Number.isNaN(flew) ? undefined : flew, 0.5, 0.18, true);
          break;
        }
        const col = mod?.disarm ? '#ff7088' : mod?.slow ? '#d8c0ff' : mod?.category === 'energy' ? '#ffd8a0' : vis === 'tesla' || vis === 'emp' ? '#dfe8ff' : '#ffe0a0';
        fx.armorHit(e.x, e.y, e.damage, col);
        // status-weapon touches: violet chill (slow), red static (disarm), crackle (paralysis), flames catching (burn)
        if (mod?.slow && fx.busy < 0.7 && Math.random() < 0.6) fx.glow(e.x, e.y, 0.3, '#a070ff', 0.15, 0.55);
        if (mod?.stun && fx.busy < 0.7) fx.bolt(e.x, e.y, 0.22, '#cfe4ff', 0.18);
        if (mod?.burn) fx.flameHit(e.x, e.y, 0.7);
        if (mod && (mod.category === 'cannon' || mod.category === 'artillery') && e.damage >= 60 && !mod.splash && !mod.projectile) fx.shellImpact(e.x, e.y, (mod.caliber ?? 0.5) * 0.9);
        break;
      }
      case 'explode': {
        const mod = modOf(e.moduleId);
        const vis = mod?.visual;
        const r = e.radius;
        const air = mod ? !mod.targetsGround && !!mod.targetsAir : false;
        if (mod?.targetsAir) {
          // air bursts and missiles striking an aircraft go off at its drawn altitude, not on the ground below
          let best: SimUnit | null = null, bd = 1.2 * 1.2;
          for (const u of this.units.values()) {
            if (!u.flying || (!u.alive && !this.prevU.has(u.id))) continue;
            const d = (u.x - e.x) ** 2 + (u.y - e.y) ** 2;
            if (d < bd) { bd = d; best = u; }
          }
          if (best) { const al = this.airLift(best); e = { ...e, x: e.x + al.x, y: e.y + al.y }; }
        }
        // the area the blast actually damaged: a ring at exactly the sim's splash radius
        if (mod?.projectile !== 'flame' && vis !== 'pointdef') fx.aoe(e.x, e.y, r, vis === 'emp' || vis === 'plasma' || vis === 'sonic' ? '#8fd0ff' : '#ffb060');
        if (mod?.projectile === 'flame') {
          // a flame jet's splash: the jet itself, its hits and the burning ground carry the look; a blast flash per
          // round (10 a second per flamer) only blew a dozen jets on one target out to a white ball
          if (fx.busy < 0.6 && Math.random() < 0.35) fx.fire(e.x + (Math.random() - 0.5) * r, e.y + (Math.random() - 0.5) * r, 0.12 + r * 0.12, 0.5, 0, 0, 0.8 + Math.random() * 0.6, 0.1);
        } else if (mod?.cluster) {
          // cluster shell: the carrier bursts open over the target, then each bomblet pops where it lands (a carpet)
          if (r <= mod.cluster.splash + 0.01) fx.bomblet(e.x, e.y, Math.max(0.35, r * 0.7));
          else { fx.clusterBurst(e.x, e.y, Math.max(0.5, r * 0.6), this.liftVec(1.4)); fx.boom(e.x, e.y, r * 0.35, 'fire'); }
        } else if (mod?.fireField && !mod.fireField.rad && mod.mount !== 'XL' && mod.category !== 'energy') {
          // firebomb: a burst of burning gel splashed outward (the patch itself comes with the 'fireField' event)
          fx.boom(e.x, e.y, Math.max(0.35, r * 0.5), 'fire');
          fx.light(e.x, e.y, r * 2.2, '#ff8030', 0.5, 0.35);
          for (let i = 0; i < 10; i++) {
            const a = Math.random() * Math.PI * 2, v = 1.5 + Math.random() * 2.5;
            fx.fire(e.x, e.y, 0.14 + Math.random() * 0.12, 0.5 + Math.random() * 0.3, Math.cos(a) * v, Math.sin(a) * v, 0.5 + Math.random(), 0.1);
          }
          fx.embers(e.x, e.y, 10, r);
        } else if (vis === 'mortar' && (mod?.caliber ?? 1) < 0.4) fx.frag(e.x, e.y, Math.max(0.45, r * 0.75));
        else if (mod?.impulse && mod.category === 'cannon') {
          // HE shell: a bigger, wider blast whose pressure wave throws a ring of dust (the knockback)
          fx.boom(e.x, e.y, r * 0.9, 'fire');
          fx.shockwave(e.x, e.y, r * 1.7, '#e8d4b0', 0.5);
          fx.shake(0.12);
        } else if (mod?.id === 'tactnuke') fx.nuke(e.x, e.y, Math.max(2, r * 0.8));
        else if (mod?.id === 'doomsday') { fx.boom(e.x, e.y, r * 0.8, 'big'); fx.shake(0.45); }
        else if (vis === 'flak' || air) fx.boom(e.x, e.y, Math.max(0.6, r * 0.9), 'flak', false);
        else if (vis === 'emp') fx.boom(e.x, e.y, Math.max(0.4, r), 'emp');
        else if (vis === 'plasma') fx.boom(e.x, e.y, Math.max(0.4, r * 0.8), 'plasma');
        else if (vis === 'sonic') fx.boom(e.x, e.y, Math.max(0.5, r), 'sonic');
        else if (vis === 'pointdef') fx.boom(e.x, e.y, 0.25, 'flak', false);
        else if (mod?.burn || mod?.id === 'incendiary' || mod?.id === 'napalm') fx.boom(e.x, e.y, Math.max(0.35, r * 0.75), 'napalm');
        else if (r < 0.35) {
          if (mod && (mod.category === 'cannon' || mod.category === 'artillery' || mod.category === 'precision')) fx.shellImpact(e.x, e.y, (mod.caliber ?? 0.5) * 0.9);
          else {
            fx.glow(e.x, e.y, 0.35, '#ffd090', 0.07, 0.9);
            fx.sparks(e.x, e.y, 6, '#ffd890', 4, undefined, Math.PI, 0.22, true);
            fx.smoke(e.x, e.y, 0.13, 0.9, '#3a3430', fx.wind.x * 0.4, 0, 0.35, 0.5, 0.2);
          }
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
        // destruction level (sim): 0 a riddled whole hull, 1 burnt and broken, 2 blown apart, 3 vaporised
        const lv = e.wreck, kind = e.kind, energy = kind === 'energy';
        if (e.flying && S >= 4) {
          fx.megaDeath(x, y, S, pal.dark);
          if (u) this.addWreck(u, team, x, y, u.angle + 0.6, 0.9, lv, kind);
        } else if (e.flying) {
          // blows up in the air where it is drawn, then the hulk hits the ground
          const al = u ? this.airLift(u) : { x: this.dirs.ux * 0.3, y: this.dirs.uy * 0.3 };
          fx.boom(x + al.x, y + al.y, (0.4 + 0.12 * lv) * S, energy ? 'plasma' : 'fire', false);
          fx.debris(x + al.x, y + al.y, (3 + 2.5 * lv) * S, pal.dark, 2 + lv, 0.07 * S);
          fx.schedule(0.35, () => {
            fx.boom(x, y, 0.6 * S, 'fire');
            if (u) this.addWreck(u, team, x, y, u.angle + 0.6, 0.8, lv, kind);
          });
        } else if (S >= 4) {
          fx.megaDeath(x, y, S, pal.dark);
          if (lv === 3) fx.debris(x, y, 12 * S, '#2a2622', 9, 0.08 * S, 1);
          if (u) this.addWreck(u, team, x, y, u.angle, 1, lv, kind);
        } else {
          // a riddled hull just coughs fire; the bigger the blow, the bigger the blast and the further the bits fly
          const kb = lv === 0 ? 0.65 : 1 + 0.25 * (lv - 1);
          fx.boom(x, y, (0.55 + 0.45 * S) * kb, energy ? 'plasma' : S >= 3 || lv >= 2 ? 'big' : 'fire');
          fx.debris(x, y, (5 + 5 * S) * (lv === 0 ? 0.4 : lv), pal.dark, (3 + S) * (lv === 3 ? 2 : lv === 2 ? 1.4 : 1), 0.06 * S, lv >= 2 ? 1 : 0);
          fx.debris(x, y, (3 + 2 * S) * Math.max(0.5, lv), '#2a2622', 3 + lv, 0.05 * S);
          fx.embers(x, y, 6 * S * (energy ? 2 : 1), S * 0.6);
          if (energy && lv) fx.molten(x, y, 4 + 3 * S);
          if (lv === 3) { fx.shockwave(x, y, 0.6 + 0.5 * S); fx.decal('crater', x, y, 0.4 + 0.35 * S); }
          if (u) this.addWreck(u, team, x, y, u.angle, 1, lv, kind);
          for (let i = 0; i < S * (lv === 0 ? 0.5 : 1); i++) fx.schedule(0.15 + i * 0.2, () => fx.boom(x + (Math.random() - 0.5) * S * 0.6, y + (Math.random() - 0.5) * S * 0.6, 0.3 + 0.2 * S, 'fire'));
          // lingering smoke column
          for (let i = 0; i < 4; i++) fx.schedule(0.4 + i * 0.5, () => fx.smoke(x, y, 0.3 * S, 2.5, '#1e1c1a', 0.2, -0.3, 0.45));
        }
        fx.shake((0.1 + 0.12 * S) * (lv === 0 ? 0.7 : 1 + 0.2 * Math.max(0, lv - 1)));
        break;
      }
      case 'fireField': {
        // fallout zone: a lingering green glow with slow pulses instead of flames
        if (e.rad) { fx.glow(e.x, e.y, e.radius * 1.2, '#7dff4a', e.duration, 0.28); for (let k = 0; k < 4; k++) fx.ring(e.x, e.y, e.radius * 0.3, e.radius, '#9dff6a', 2 + k * 3, 0.35); break; }
        fx.fireField(e.x, e.y, e.radius, e.duration, e.moduleId);
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

/** Shield radius (cells): just outside the hull's mean half-extent, so long hulls don't get a giant bubble. */
function shieldR(L: { X: number; Y: number; S: number }): number {
  return 0.36 * (L.X + L.Y) * bodyScale(L.S) + 0.15;
}

/** Half extents (cells) of a unit's footprint box rotated to `ang` (screen-axis aligned) at the battlefield body scale
 *  it is drawn at (bars and pips sit on the drawn hull, not on the full footprint cell), plus its unscaled mean edge
 *  (bar width: kept readable). */
function boxHalf(d: Design, ang: number): { hx: number; hy: number; w: number } {
  const L = layoutOf(d), bs = bodyScale(L.S);
  const c = Math.abs(Math.cos(ang)), sn = Math.abs(Math.sin(ang));
  return { hx: (c * L.FX + sn * L.FY) / 2 * bs, hy: (sn * L.FX + c * L.FY) / 2 * bs, w: (L.FX + L.FY) / 2 };
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
  /** footprint in cells: fw across (screen x when the nose points up), fl along the facing */
  fw: number;
  fl: number;
  /** rough half-extent of the drawn sprite (CSS px) */
  half: number;
}

/** Draw a design centred in the canvas. `minExtent` (cells) keeps small units small so a backdrop grid reads at true scale;
 *  `still` stops the walk cycle so mount markers stay put. Returns the on-screen geometry. */
/** Largest sprite edge (device px) the preview bakes: sprites are re-baked per resolution, so an uncapped zoom on a titan
 *  at hi-dpi asked for ~6000 px sprite sets (a dozen 140 MB canvases per zoom step) and stalled or crashed the tab. */
const PREVIEW_SPRITE_MAX = 2048;
const PREVIEW_MAX_PIXELS = 2.2e6;
/** Sprite resolution ladder (device px per cell): 2^(k/2), so a continuous zoom only re-bakes at a handful of steps. */
function previewSpritePx(px: number, ext: number): number {
  const cap = PREVIEW_SPRITE_MAX / (2 * ext);
  const step = Math.pow(2, Math.ceil(Math.log2(Math.max(4, px)) * 2) / 2);
  return Math.max(4, Math.round(Math.min(step, Math.max(cap, 4))));
}

export function drawUnitPreview(canvas: HTMLCanvasElement, design: Design, opts?: {
  side?: Side; time?: number; angle?: number; minExtent?: number; still?: boolean; zoom?: number; pan?: { x: number; y: number };
  /** zoom whose resolution the sprites are baked at (default `zoom`): the garage holds it while a zoom gesture or its
   *  ease is running, so the sprites are rebuilt once when it settles instead of every animation frame */
  detailZoom?: number;
  /** only compute the geometry this call would draw at (canvas untouched): the garage CSS-scales the last frame with it
   *  while a pan/zoom gesture runs on a machine that can't redraw a big hull every frame */
  measureOnly?: boolean;
}): PreviewGeom | null {
  let g: Ctx;
  try { g = ctx2d(canvas); } catch { return null; }
  const measure = !!opts?.measureOnly;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  // backing store: at most 2x and ~2.2 Mpx (a full-screen hi-dpi bench is re-blitted every frame, layer by layer)
  let dpr = Math.min(2, typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);
  if (cw * ch * dpr * dpr > PREVIEW_MAX_PIXELS) dpr = Math.max(1, Math.sqrt(PREVIEW_MAX_PIXELS / (cw * ch)));
  let W = canvas.width, H = canvas.height;
  if (cw > 0 && ch > 0) {
    W = Math.round(cw * dpr); H = Math.round(ch * dpr);
    if (!measure && canvas.width !== W) canvas.width = W;
    if (!measure && canvas.height !== H) canvas.height = H;
  }
  if (!measure) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
  }
  let L;
  try { L = layoutOf(design); } catch { return null; }
  const time = opts?.time ?? 0;
  const ext0 = L.D * (L.S >= 4 ? (L.air ? 1.5 : L.mob.id === 'spider' ? 1.62 : L.S >= 5 ? 1.55 : 1.38) : L.air ? 1.25 : L.mob.id === 'spider' || CREATURE_SHAPES.has(L.shape) ? 1.36 : 1.1);
  const ext = Math.max(opts?.minExtent ?? 0, ext0);
  // zoom > 1 magnifies; pan (cells) moves the view centre off the unit
  const px = (Math.min(W, H) / ext) * (opts?.zoom ?? 1);
  const pnx = opts?.pan?.x ?? 0, pny = opts?.pan?.y ?? 0;
  const ox = W / 2 - pnx * px, oy = H / 2 - pny * px;
  const team: Team = (opts?.side ?? 0) === 1 ? 1 : 0;
  const angle = opts?.angle ?? -Math.PI / 2;
  const pose: UnitPose = {
    design, team, x: 0, y: L.air ? 0.1 * L.S : 0, angle, time,
    // the Needle Frame alternates running (arms folded) and standing (arms deployed) in animated previews
    moving: !opts?.still && L.mob.kind !== 'static' && (L.shape !== 'mantis' || time % 5 < 2.2), odometer: opts?.still ? 0 : time * Math.max(0.6, L.cycle * 1.5), seed: 1,
    still: !!opts?.still,
  };
  const dirs: ViewDirs = { sx: 0.45, sy: 0.75, ux: 0, uy: -1 };
  // sprite resolution: quantised, capped, and taken from the settled zoom (the transform above still uses the live px)
  const spx = previewSpritePx((Math.min(W, H) / ext) * (opts?.detailZoom ?? opts?.zoom ?? 1), Math.max(L.ext, 0.5));
  if (!measure) {
    g.setTransform(px, 0, 0, px, ox, oy);
    drawUnitShadow(g, pose, spx, dirs);
    drawUnit(g, pose, spx, dirs);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
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
  return { px: px * k, cx: (ox + ux * px) * k, cy: (oy + uy * px) * k, mounts, S: L.S, fw: L.FY, fl: L.FX, half: (ext0 / 2) * 0.92 * px * k };
}
