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
// viewerSide 1 the field is rotated 180°. worldToScreen/screenToWorld use canvas CSS pixels.

import { battleSfx, setPanFlip } from '../audio.ts';
import { DEPLOY_D, FIELD_H, FIELD_W } from '../../shared/grid.ts';
import type { Battle } from '../../shared/sim/battle.ts';
import type { BattleEvent, SimProjectile, SimUnit } from '../../shared/sim/types.ts';
import { DT } from '../../shared/sim/types.ts';
import type { Design, Side } from '../../shared/types.ts';
import { Fx, modOf, visualOf } from './fx.ts';
import { groundCanvas } from './ground.ts';
import { TEAM_PAL, clamp, ctx2d, hash01, lerp, lerpAngle, rgba, softDot, type Ctx, type Team } from './palette.ts';
import { loadTextures, tex, tinted } from './textures.ts';
import { moduleGlow } from './turrets.ts';
import {
  drawUnit, drawUnitShadow, layoutOf, muzzlePos, unitSprites, silhouette, wreckSprite,
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
  hover?: { col: number; row: number; size: number; valid: boolean } | null;
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
  hpShown: number;
  swing: number[];
  seen: number;
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
  lx: number;
  ly: number;
  kind: string;
  moduleId: string;
  side: Side;
  born: number;
}

const forwardAngle = (side: Side) => (side === 0 ? -Math.PI / 2 : Math.PI / 2);

/**
 * Draws the battlefield on a canvas. The viewer's side is always at the bottom (side 1 sees the
 * field rotated 180°). Handles devicePixelRatio and fits the whole field into the canvas.
 */
export class FieldView {
  canvas: HTMLCanvasElement;
  viewerSide: Side;
  /** when true, battle events produce no sound (e.g. menu background skirmish) */
  muted = false;
  private g: Ctx;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  /** CSS px per cell */
  private k = 1;
  private ox = 0;
  private oy = 0;
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

  constructor(canvas: HTMLCanvasElement, viewerSide: Side) {
    this.canvas = canvas;
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
    this.k = Math.max(0.5, Math.min(cw / FIELD_W, ch / FIELD_H));
    this.ox = (cw - FIELD_W * this.k) / 2;
    this.oy = (ch - FIELD_H * this.k) / 2;
    this.vignette = null;
    this.fx.setDecalSpace(FIELD_W, FIELD_H, this.k * dpr);
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
    g.fillStyle = '#121416';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.setWorld(sx, sy);
    // drop shadow frame around the field
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(-0.25, -0.25, FIELD_W + 0.5, FIELD_H + 0.5);
    g.drawImage(groundCanvas(this.px), 0, 0, FIELD_W, FIELD_H);
    if (this.fx.decalCanvas) g.drawImage(this.fx.decalCanvas, 0, 0, FIELD_W, FIELD_H);
    // deploy zones
    const myTop = this.viewerSide === 0 ? FIELD_H - DEPLOY_D : 0;
    const enTop = this.viewerSide === 0 ? 0 : FIELD_H - DEPLOY_D;
    const mine = TEAM_PAL[0], theirs = TEAM_PAL[1];
    g.fillStyle = rgba(theirs.body, 0.07);
    g.fillRect(0, enTop, FIELD_W, DEPLOY_D);
    g.fillStyle = rgba(mine.body, showZone ? 0.16 : 0.07);
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
    g.strokeStyle = rgba(mine.accent, showZone ? 0.75 : 0.35);
    g.beginPath(); g.moveTo(0, myFront); g.lineTo(FIELD_W, myFront); g.stroke();
    g.strokeStyle = rgba(theirs.accent, 0.3);
    g.beginPath(); g.moveTo(0, enFront); g.lineTo(FIELD_W, enFront); g.stroke();
    g.setLineDash([]);
    // field border
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = lw * 1.5;
    g.strokeRect(0, 0, FIELD_W, FIELD_H);
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
    this.drawGround(!!overlay.showZone, 0, 0);
    const px = this.px;
    // hover footprint
    const hv = overlay.hover;
    if (hv) {
      const col = hv.valid ? '#46e88a' : '#ff4a4a';
      g.fillStyle = rgba(col, 0.22 + 0.06 * Math.sin(time * 6));
      g.fillRect(hv.col, hv.row, hv.size, hv.size);
      g.strokeStyle = rgba(col, 0.9);
      g.lineWidth = 2 / this.k;
      g.strokeRect(hv.col + 0.04, hv.row + 0.04, hv.size - 0.08, hv.size - 0.08);
    }
    const poses: { u: BoardUnit; p: UnitPose; air: boolean }[] = [];
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
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
          const S = layoutOf(u.design).S;
          g.strokeStyle = rgba(TEAM_PAL[0].accent, 0.6 + 0.3 * Math.sin(time * 5));
          g.lineWidth = 2 / this.k;
          g.beginPath();
          g.arc(u.x, u.y, S * 0.58, 0, Math.PI * 2);
          g.stroke();
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
    for (const { u } of poses) if (u.level > 1 && !u.ghost) this.drawPips(u.x, u.y, layoutOf(u.design).S, u.level, 1);
    this.drawVignette();
  }

  private drawPips(x: number, y: number, S: number, level: number, alpha: number): void {
    const g = this.g;
    const p = this.worldToScreen(x, y);
    const half = S * this.k * 0.45;
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
        this.ptrack.set(p.id, { sx: p.x, sy: p.y, lx: p.x, ly: p.y, kind: p.kind, moduleId: p.moduleId, side: p.side, born: this.time });
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
    for (const v of this.vis.values()) for (let i = 0; i < v.swing.length; i++) v.swing[i] = Math.max(0, v.swing[i] - dt * 3.5);

    const g = this.g;
    const tr = this.fx.trauma * this.fx.trauma;
    const sx = tr ? (Math.random() * 2 - 1) * tr * 7 : 0, sy = tr ? (Math.random() * 2 - 1) * tr * 7 : 0;
    this.drawGround(false, sx, sy);
    const px = this.px;

    // poses
    const ground: UnitPose[] = [], air: UnitPose[] = [];
    const bars: { u: SimUnit; p: UnitPose }[] = [];
    for (const u of battle.units) {
      if (!u.alive) continue;
      const p = this.poseOf(u);
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
  }

  private visOf(u: SimUnit): UVis {
    let v = this.vis.get(u.id);
    if (!v) {
      v = { shieldT: -9, hpShown: u.hp, swing: u.mounts.map(() => 0), seen: this.time };
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
        angle: lerpAngle(pr.mounts[i] ?? m.angle, c.mounts[i] ?? m.angle, a),
        flash: m.flash, swing: v.swing[i] ?? 0, reloading: m.reloading,
      }));
    } else mounts = u.mounts.map((m, i) => ({ angle: m.angle, flash: m.flash, swing: v.swing[i] ?? 0, reloading: m.reloading }));
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
      const S = layoutOf(u.design).S;
      const r = 0.62 * S;
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
    if (p.cloak === 'enemy') return;
    const damaged = u.hp < u.maxHp - 0.5;
    const S = layoutOf(u.design).S;
    if (u.level > 1) this.drawPips(p.x, p.y, S, u.level, 0.9);
    if (!damaged && u.shield <= 0) return;
    const g = this.g;
    const s = this.worldToScreen(p.x, p.y);
    const lift = u.flying ? 0.12 * this.k : 0;
    const w = Math.max(14, S * this.k * 0.78);
    const h = S >= 2 ? 4 : 3;
    const x = Math.round(s.x - w / 2);
    const y = Math.round(s.y - S * this.k * 0.52 - h - 3 - lift);
    g.fillStyle = 'rgba(0,0,0,0.65)';
    g.fillRect(x - 1, y - 1, w + 2, h + 2);
    const f = clamp(u.hp / u.maxHp, 0, 1), fs = clamp(v.hpShown / u.maxHp, 0, 1);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillRect(x, y, w * fs, h);
    const team = this.teamOf(u.side);
    g.fillStyle = f < 0.3 ? (team === 0 ? '#ffd24a' : '#ff3a2a') : TEAM_PAL[team].bar;
    g.fillRect(x, y, w * f, h);
    if (u.maxShield > 0 && u.shield > 0) {
      g.fillStyle = '#8fe0ff';
      g.fillRect(x, y - 2, w * clamp(u.shield / u.maxShield, 0, 1), 1.5);
    }
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
      const col = enemy ? '#ff5a3a' : '#5ae8d0';
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 10 + p.id);
      g.globalAlpha = (enemy ? 0.45 : 0.22) * (0.4 + 0.6 * pr);
      g.fillStyle = rgba(col, 0.18 + 0.12 * pr);
      g.beginPath();
      g.arc(lx, ly, rad * (1.05 - pr * 0.05), 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = (enemy ? 0.9 : 0.45) * (0.5 + 0.5 * pulse);
      g.strokeStyle = col;
      g.lineWidth = Math.max(1.2 / this.k, 0.04);
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
    const minW = 1 / this.px;
    for (const p of list) {
      const kind = p.kind as string;
      const isHigh = kind === 'arc' || kind === 'missile';
      if (isHigh !== elevated) continue;
      const pos = this.projPos(p);
      const t = this.ptrack.get(p.id);
      const mod = modOf(p.moduleId);
      const vis = mod?.visual;
      const cal = mod?.caliber ?? 0.5;
      const cs = Math.cos(pos.angle), sn = Math.sin(pos.angle);
      const lift = kind === 'missile' ? Math.min(0.6, pos.z * 0.4) : kind === 'arc' ? pos.z * 0.45 : 0;
      const x = pos.x + this.dirs.ux * lift, y = pos.y + this.dirs.uy * lift;
      const glowC = mod ? moduleGlow(mod, TEAM_PAL[this.teamOf(p.side)]) : '#ffd27a';
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
            const blink = Math.sin(this.time * 40 + p.id) > 0 ? 1 : 0.5;
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
          const sz = cruise ? 0.5 : mod?.id === 'swarm' ? 0.16 : 0.26;
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
          this.trail(p.id, x - cs * sz, y - sn * sz, cruise ? 0.3 : 0.14, '#8a8680', cruise ? 0.04 : 0.05);
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
            const r = 0.18 + 0.12 * cal;
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

  private handleEvent(e: BattleEvent): void {
    const fx = this.fx;
    switch (e.t) {
      case 'fire': {
        const mod = modOf(e.moduleId);
        const vis = mod?.visual;
        const ur = this.unitRender(e.unit);
        let mx = e.x, my = e.y, d = 0.3;
        if (ur) {
          const m = muzzlePos(ur.u.design, e.mount, ur.x, ur.y, ur.angle, e.angle);
          mx = m.x; my = m.y; d = m.d;
          if (ur.u.flying) { mx += this.dirs.ux * 0.12; my += this.dirs.uy * 0.12; }
          const v = this.visOf(ur.u);
          if (mod?.category === 'melee') v.swing[e.mount] = 1;
        }
        const cs = Math.cos(e.angle), sn = Math.sin(e.angle);
        const cal = mod?.caliber ?? 0.5;
        const glowC = moduleGlow(mod, TEAM_PAL[ur ? this.teamOf(ur.u.side) : 0]);
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
        const pts = [e.x1, e.y1, e.x2, e.y2];
        let impact = true;
        switch (vis) {
          case 'heatray': fx.beam('heat', pts, '#ff6a1a', 0.07, 0.14); break;
          case 'plasma': fx.beam('plasma', pts, '#e070ff', 0.09, 0.17); break;
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
            fx.beam('rail', pts, '#9fe8ff', heavy ? 0.1 : 0.06, heavy ? 0.5 : 0.35);
            fx.glow(e.x1, e.y1, heavy ? 0.7 : 0.45, '#9fe8ff', 0.2);
            fx.sparks(e.x2, e.y2, 10, '#cff4ff', 5, undefined, Math.PI, 0.3);
            if (heavy) fx.shake(0.18);
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
        if (e.shieldHit) {
          const v = this.visOf(ur);
          v.shieldT = this.time;
          const S = layoutOf(ur.design).S;
          if (fx.busy < 0.7) fx.hex(ur.x, ur.y, 0.62 * S, e.x, e.y);
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
        if (vis === 'flak' || air) fx.boom(e.x, e.y, Math.max(0.4, r * 0.7), 'flak', false);
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
        if (e.flying) {
          fx.boom(x + this.dirs.ux * 0.3, y + this.dirs.uy * 0.3, 0.5 * S, 'fire', false);
          fx.debris(x, y, 6 * S, pal.dark, 2.5, 0.07 * S);
          fx.schedule(0.35, () => {
            fx.boom(x, y, 0.6 * S, 'fire');
            if (u) fx.decal('wreck', x, y, 0, wreckSprite(u.design, team, this.px), unitSprites(u.design, team, this.px).ext * 0.8, u.angle + 0.6);
          });
        } else {
          fx.boom(x, y, 0.55 + 0.45 * S, S >= 3 ? 'big' : 'fire');
          fx.debris(x, y, 5 + 5 * S, pal.dark, 3 + S, 0.06 * S);
          fx.debris(x, y, 3 + 2 * S, '#2a2622', 3, 0.05 * S);
          fx.embers(x, y, 6 * S, S * 0.6);
          if (u) fx.decal('wreck', x, y, 0, wreckSprite(u.design, team, this.px), unitSprites(u.design, team, this.px).ext, u.angle);
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
    this.fx.clear();
    this.battle = null;
    this.prevU.clear();
    this.curU.clear();
    this.units.clear();
    this.vis.clear();
    this.pending = [];
  }
}

/** Render a single design centered in a canvas (garage preview, cards). `time` animates rotors/legs. */
export function drawUnitPreview(canvas: HTMLCanvasElement, design: Design, opts?: { side?: Side; time?: number; angle?: number }): void {
  let g: Ctx;
  try { g = ctx2d(canvas); } catch { return; }
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
  try { L = layoutOf(design); } catch { return; }
  const time = opts?.time ?? 0;
  const ext = L.S * (L.air ? 1.25 : L.mob.id === 'spider' ? 1.18 : 1.1);
  const px = Math.min(W, H) / ext;
  g.setTransform(px, 0, 0, px, W / 2, H / 2);
  const team: Team = (opts?.side ?? 0) === 1 ? 1 : 0;
  const pose: UnitPose = {
    design, team, x: 0, y: L.air ? 0.1 * L.S : 0, angle: opts?.angle ?? -Math.PI / 2, time,
    moving: L.mob.kind !== 'static', odometer: time * Math.max(0.6, L.cycle * 1.5), seed: 1,
  };
  const dirs: ViewDirs = { sx: 0.45, sy: 0.75, ux: 0, uy: -1 };
  drawUnitShadow(g, pose, px, dirs);
  drawUnit(g, pose, px, dirs);
  g.setTransform(1, 0, 0, 1, 0, 0);
}
