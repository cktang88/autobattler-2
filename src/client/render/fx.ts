// Battlefield effects: particles, beams, lightning, explosions, ground decals and camera shake.
// Everything lives in world-cell coordinates; the owner (FieldView) sets the world transform before drawing.
//
// Look: additive light (bloom, ground light pools) over grounded, muted smoke/dust; fire follows a colour
// temperature ramp (white-hot -> yellow -> orange -> red -> smoke). Effects are front-loaded (max size and
// brightness in the first frames, then a fast ease-out) so impacts feel punchy. Sprites are cached (vfx.ts), the
// particle pool is globally capped and sheds optional particles as it fills.

import { MODULE_BY_ID } from '../../shared/parts.ts';
import type { ModuleDef, ModuleVisual } from '../../shared/types.ts';
import { clamp, ctx2d, makeCanvas, rgba, softDot, type Ctx } from './palette.ts';
import { tex, tinted } from './textures.ts';
import { coneTex, easeOut, fireTex, glowTex, hash1, mixHex, puffTex, ringTex, starTex } from './vfx.ts';

export const modOf = (id: string | null | undefined): ModuleDef | undefined => (id ? MODULE_BY_ID.get(id) : undefined);
export const visualOf = (id: string | null | undefined): ModuleVisual | undefined => modOf(id)?.visual;

const SPARK = 0, SMOKE = 1, FIRE = 2, GLOW = 3, DEBRIS = 4, RING = 5, HEAL = 6, DUST = 7, EMBER = 8, STAR = 9, HEX = 10, BOLT = 11,
  FBALL = 12, CONE = 13, LIGHT = 14, HOT = 15, PATCH = 16, DRING = 17;

interface Particle {
  k: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number; grow: number;
  color: string;
  rot: number; vr: number;
  drag: number;
  alpha: number;
  /** gravity (cells/s^2) on the height axis; 0 = none */
  grav: number;
  /** small integer variant (sprite pick) */
  seed: number;
  /** end radius for rings, width for cones */
  r1: number;
  /** debris: 1 = smoke trail, 2 = glowing hot chunk */
  flag: number;
  /** just spawned: skips its first update so even a 1-frame flash is drawn at full intensity once */
  fresh: boolean;
}

type BeamKind = 'laser' | 'plasma' | 'repair' | 'rail' | 'heat' | 'slow' | 'scramble' | 'gravity' | 'lightning' | 'sniper' | 'ion';
interface Beam {
  kind: BeamKind;
  pts: number[];
  life: number;
  max: number;
  color: string;
  width: number;
  seed: number;
  /** focusing beams: 0..1 focus (thicker, hotter, whiter as it builds) */
  ramp?: number;
  /** lightning: re-randomised polyline + forks, rebuilt every few frames */
  bolt?: number[];
  forks?: number[][];
  boltStep?: number;
}

interface Decal {
  kind: 'scorch' | 'crater' | 'wreck' | 'burn';
  x: number; y: number; r: number; a: number;
  img?: HTMLCanvasElement;
  ext?: number;
}

/** A burnt-out hulk: drawn live (crisp at any zoom), smouldering while it cools. Lives until the battle ends. */
interface Wreck {
  x: number; y: number; a: number; sc: number; S: number;
  t0: number; life: number;
  ext: number;
  get: (px: number) => HTMLCanvasElement;
  hot: number[];
  scorch: number[];
  smokeT: number;
}

/** A firebomb's burning ground patch (sim 'fireField' event): lives for its sim duration, flickers, throws flames. */
interface FireField {
  x: number; y: number; r: number;
  t0: number; dur: number;
  seed: number;
  /** flame-tongue emission accumulator */
  acc: number;
}

const MAX_P = 2600;
/** global cap on wreck smoke: puffs per second across all wrecks (token bucket) */
const WRECK_SMOKE_RATE = 22;
const rnd = Math.random;
const rr = (a: number, b: number) => a + (b - a) * rnd();
const PI2 = Math.PI * 2;

export class Fx {
  parts: Particle[] = [];
  beams: Beam[] = [];
  private later: { t: number; fn: () => void }[] = [];
  trauma = 0;
  time = 0;
  /** battle (sim) clock in seconds, set by the owner each frame: things that last a sim duration (fire fields) age on
   *  it, so they burn out exactly when the sim's do at any playback speed */
  simT = 0;
  /** full-screen flash (0..1) and its colour, for titan-class weapon moments */
  flashA = 0;
  flashC = '#ffffff';
  // decals
  decals: Decal[] = [];
  wrecks: Wreck[] = [];
  fields: FireField[] = [];
  /** screen-up direction in world space (smoke rises this way); set by the owner each frame */
  up = { x: 0, y: -1 };
  /** world units a point 1 cell above the ground rises on screen (tilt) */
  liftK = 0.53;
  /** photosensitivity: the 'flashes' setting (0..1). Scales ground light pools / big glows and slows lightning flicker. */
  flashK = 1;
  /** visible world rectangle (cull); null = no cull */
  view: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** gentle wind pushing smoke (cells/s) */
  wind = { x: 0.28, y: -0.04 };
  private smokeTokens = 0;
  decalCanvas: HTMLCanvasElement | null = null;
  private decalPx = 0;
  private fieldW = 0;
  private fieldH = 0;

  clear(): void {
    this.parts.length = 0;
    this.beams.length = 0;
    this.later.length = 0;
    this.decals.length = 0;
    this.wrecks.length = 0;
    this.fields.length = 0;
    this.trauma = 0;
    this.flashA = 0;
    this.lastFlashT = -9;
    if (this.decalCanvas) ctx2d(this.decalCanvas).clearRect(0, 0, this.decalCanvas.width, this.decalCanvas.height);
  }

  /** load factor 0..1: shed optional particles when busy */
  get busy(): number {
    return this.parts.length / MAX_P;
  }
  /** spawn-quality multiplier: full when idle, thinner as the pool fills */
  get q(): number {
    const b = this.busy;
    return b > 0.85 ? 0.25 : b > 0.6 ? 0.5 : 1;
  }
  /** intensity of ground light pools / big glows (reduced by the flashes setting) */
  get lightGain(): number {
    return 0.25 + 0.75 * clamp(this.flashK, 0, 1);
  }

  private add(k: number, x: number, y: number, o: Partial<Particle>): void {
    if (this.parts.length >= MAX_P) return;
    this.parts.push({
      k, x, y, z: o.z ?? 0, vx: o.vx ?? 0, vy: o.vy ?? 0, vz: o.vz ?? 0,
      life: o.max ?? 0.5, max: o.max ?? 0.5, size: o.size ?? 0.2, grow: o.grow ?? 0,
      color: o.color ?? '#ffffff', rot: o.rot ?? rnd() * 6.28, vr: o.vr ?? 0, drag: o.drag ?? 0, alpha: o.alpha ?? 1,
      grav: o.grav ?? 0, seed: o.seed ?? ((rnd() * 4) | 0), r1: o.r1 ?? 0, flag: o.flag ?? 0, fresh: true,
    });
  }

  schedule(delay: number, fn: () => void): void {
    this.later.push({ t: this.time + delay, fn });
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Blinding full-screen flash. */
  flash(a: number, color = '#ffffff'): void {
    // photosensitivity: at most one full-screen flash per second globally (no strobing / double flashes)
    if (this.time - this.lastFlashT < 1) return;
    this.lastFlashT = this.time;
    this.flashC = color;
    this.flashA = Math.min(1, Math.max(this.flashA, a));
  }
  private lastFlashT = -9;

  /* ---------------------------------------------------------------------------------------- spawners */

  /** Streak sparks. `arc` makes them hop up and fall back (gravity), like molten or struck metal. */
  sparks(x: number, y: number, n: number, color: string, speed = 4, ang?: number, spread = Math.PI, life = 0.25, arc = false): void {
    n = Math.round(n * this.q);
    for (let i = 0; i < n; i++) {
      const a = ang === undefined ? rnd() * PI2 : ang + rr(-spread, spread);
      const v = speed * rr(0.35, 1);
      this.add(SPARK, x, y, {
        vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: life * rr(0.6, 1.2), size: rr(0.02, 0.045), color, drag: 3,
        ...(arc ? { z: 0.15, vz: rr(0.6, 2.6), grav: 9 } : {}),
      });
    }
  }

  glow(x: number, y: number, r: number, color: string, life = 0.12, alpha = 1): void {
    this.add(GLOW, x, y, { size: r, max: life, color, alpha });
  }

  /** Ground light pool: a wide, soft warm light on the terrain (and whatever stands on it). Scaled by the flashes setting. */
  light(x: number, y: number, r: number, color: string, life = 0.35, alpha = 0.5): void {
    this.add(LIGHT, x, y, { size: r, max: life, color, alpha });
  }

  /** Glowing hot ground (fresh scorch): lingers and cools. */
  hot(x: number, y: number, r: number, life = 2.5): void {
    if (this.busy > 0.8) return;
    this.add(HOT, x, y, { size: r, max: life, color: '#ff8030', alpha: 0.6 });
  }

  /** Burning ground: pulsing glow that keeps throwing small flames and smoke. */
  patch(x: number, y: number, r: number, life = 3): void {
    if (this.busy > 0.75) return;
    this.add(PATCH, x, y, { size: r, max: life, color: '#ff7a20', alpha: 0.7 });
  }

  star(x: number, y: number, r: number, color: string, ang: number, life = 0.07): void {
    this.add(STAR, x, y, { size: r, max: life, color, rot: ang, alpha: 1 });
  }

  /** Directional muzzle / launch flame: bright root at (x, y) flaring along `ang`. */
  cone(x: number, y: number, ang: number, len: number, width: number, color: string, life = 0.06): void {
    this.add(CONE, x, y, { size: len, r1: width, max: life, color, rot: ang });
  }

  /** Smoke puff. `vz` makes it rise (height), `z` is its start height. */
  smoke(x: number, y: number, r: number, life = 1.2, color = '#2a2622', vx = 0, vy = 0, alpha = 0.5, vz = 0, z = 0): void {
    if (this.busy > 0.8 && rnd() < 0.5) return;
    this.add(SMOKE, x, y, { size: r, grow: r * 1.4, max: life * rr(0.8, 1.2), color, vx: vx + rr(-0.15, 0.15), vy: vy + rr(-0.15, 0.15), drag: 1.2, alpha, vr: rr(-0.6, 0.6), vz, z });
  }

  dust(x: number, y: number, r: number, n = 3, life = 0.8): void {
    n = Math.max(1, Math.round(n * (this.busy > 0.7 ? 0.5 : 1)));
    for (let i = 0; i < n; i++) {
      const a = rnd() * PI2, v = rr(0.3, 1.2) * r * 1.6;
      this.add(DUST, x, y, { size: r * rr(0.4, 0.8), grow: r * 1.2, max: life * rr(0.7, 1.2), vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 3, color: '#bfb196', alpha: 0.55 });
    }
  }

  /** Flame puff (flamers, burning units, wreck fires): additive, colour ramps from yellow to red as it rises. */
  fire(x: number, y: number, r: number, life = 0.45, vx = 0, vy = 0, vz = 0, z = 0): void {
    this.add(FIRE, x, y, { size: r, grow: r * 0.6, max: life * rr(0.7, 1.2), vx, vy, vz, z, drag: 2.5, vr: rr(-2, 2) });
  }

  /** Explosion fireball lobe: pops with an overshoot, white-hot -> yellow -> orange -> red while it expands. */
  fball(x: number, y: number, r: number, life: number, vx = 0, vy = 0, vz = 0, z = 0, drag = 2.6): void {
    this.add(FBALL, x, y, { size: r, grow: 0.35, max: life, vx, vy, vz, z, drag, vr: rr(-1.5, 1.5) });
  }

  /** Expanding ground ring with a hard leading edge; radius eases out (fast at first). */
  ring(x: number, y: number, r0: number, r1: number, color: string, life = 0.35, alpha = 0.8): void {
    if (r1 < 3) return; // only big blasts get a visible shock ring; small ones looked like glassy discs
    alpha *= 0.45;
    this.add(RING, x, y, { size: r0, r1, max: life, color, alpha });
  }

  /** Dusty ground ring (normal blend): the displaced dirt wave. */
  dustRing(x: number, y: number, r0: number, r1: number, life = 0.6, alpha = 0.55, color = '#c8baa0'): void {
    if (this.busy > 0.85) return;
    this.add(DRING, x, y, { size: r0, r1, max: life, color, alpha });
  }

  /** Flying chunks. trail: 0 none, 1 smoke trail, 2 glowing hot chunk with a smoke trail. */
  debris(x: number, y: number, n: number, color: string, speed = 3, size = 0.08, trail = 0): void {
    n = Math.round(n * (this.busy > 0.6 ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const a = rnd() * PI2, v = speed * rr(0.3, 1);
      this.add(DEBRIS, x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rr(2.5, 6), z: 0.1, max: rr(0.9, 1.6), size: size * rr(0.5, 1.4), color, vr: rr(-12, 12), drag: 0.8, grav: 14, flag: trail });
    }
  }

  embers(x: number, y: number, n: number, r: number): void {
    n = Math.round(n * this.q);
    for (let i = 0; i < n; i++) {
      const a = rnd() * PI2, v = rr(0.5, 2.5) * r;
      this.add(EMBER, x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rr(0.8, 2.6), z: 0.1, max: rr(0.6, 1.5), size: rr(0.03, 0.06), color: '#ffb050', drag: 1.5 });
    }
  }

  heal(x: number, y: number): void {
    for (let i = 0; i < 2; i++) this.add(HEAL, x + rr(-0.3, 0.3), y + rr(-0.3, 0.3), { vy: -0.5, max: 0.8, size: rr(0.08, 0.13), color: '#6dff9a' });
  }

  hex(x: number, y: number, r: number, hx: number, hy: number): void {
    // the hit direction rides in r1 (vx/vy are velocities: storing the hit point there sent the effect flying off)
    this.add(HEX, x, y, { size: r, max: 0.45, color: '#7fd8ff', r1: Math.atan2(hy - y, hx - x), alpha: 1 });
  }

  bolt(x: number, y: number, r: number, color: string, life = 0.25): void {
    this.add(BOLT, x, y, { size: r, max: life, color, vr: rr(-3, 3) });
  }

  beam(kind: BeamKind, pts: number[], color: string, width: number, life: number, ramp?: number): void {
    if (this.beams.length > 300) this.beams.shift();
    // thin gameplay widths read as hairlines under the tilt: give every beam body a believable thickness
    const k = kind === 'laser' || kind === 'sniper' ? 2.1 : kind === 'heat' ? 1.9 : kind === 'plasma' ? 1.5 : kind === 'lightning' || kind === 'scramble' ? 2.2 : kind === 'rail' || kind === 'ion' ? 1.3 : 1.5;
    this.beams.push({ kind, pts, life, max: life, color, width: width * k, seed: (rnd() * 1e6) | 0, ramp });
  }

  /** A firebomb's burning patch: lasts `dur` s (the sim's own duration), drawn under the units (see drawFields). */
  fireField(x: number, y: number, r: number, dur: number): void {
    if (this.fields.length > 60) this.fields.shift();
    this.fields.push({ x, y, r, t0: this.simT, dur, seed: (rnd() * 1e4) | 0, acc: 0 });
    this.decal('burn', x, y, r * 0.95);
  }

  /** Grenade: a sharp, small frag blast — white pop, a dark grey puff, a fast spray of fragments, no rolling fireball. */
  frag(x: number, y: number, r: number): void {
    const q = this.q;
    this.glow(x, y, r * 0.7, '#ffffff', 0.05, 1);
    this.glow(x, y, r * 1.2, '#ffc070', 0.12, 0.6);
    this.star(x, y, r * 1.1, '#fff0c8', rnd() * 6, 0.06);
    this.light(x, y, r * 1.6, '#ffb060', 0.18, 0.25);
    this.fball(x, y, r * 0.42, 0.22, 0, 0, 0.2);
    this.sparks(x, y, 16 * q, '#ffe0a0', 7 * r + 2, undefined, Math.PI, 0.18);
    this.sparks(x, y, 6 * q, '#ffd080', 3, undefined, Math.PI, 0.35, true);
    this.dustRing(x, y, r * 0.2, r * 1.3, 0.45, 0.45);
    for (let i = 0; i < 3; i++) this.smoke(x + rr(-0.2, 0.2) * r, y + rr(-0.2, 0.2) * r, r * 0.35, 1.3, i ? '#4a4640' : '#2e2b28', this.wind.x * 0.4, 0, 0.55, rr(0.3, 0.7), 0.1);
    this.schedule(0.08, () => this.decal('scorch', x, y, r * 0.55));
  }

  /** One cluster bomblet going off: a quick pop with a small fireball, sparks and a scorch. Cheap (carpets of them). */
  bomblet(x: number, y: number, r: number): void {
    const busy = this.busy;
    this.glow(x, y, r * 0.9, '#fff2d0', 0.05, 0.9);
    this.fball(x, y, r * 0.55, 0.3, 0, 0, 0.4);
    if (busy < 0.6) { this.fball(x + rr(-0.15, 0.15) * r, y + rr(-0.15, 0.15) * r, r * 0.38, 0.35, rr(-0.5, 0.5) * r, rr(-0.5, 0.5) * r, rr(0.4, 0.9)); this.light(x, y, r * 1.6, '#ffa850', 0.2, 0.2); }
    this.sparks(x, y, 7, '#ffcf70', 4 * r + 1.5, undefined, Math.PI, 0.3, true);
    this.dust(x, y, r * 0.4, 2, 0.8);
    if (busy < 0.7) this.smoke(x, y, r * 0.3, 1.6, '#2e2a26', this.wind.x * 0.5, 0, 0.45, 0.6, 0.15);
    this.schedule(0.1, () => this.decal('scorch', x, y, r * 0.5));
  }

  /** Cluster carrier shell opening above the target: a sharp white pop, a ring of ejected sub-munitions glinting outward
   *  and a hanging grey puff (the carpet of bomblets does the real damage a moment later). */
  clusterBurst(x: number, y: number, r: number, lift: { x: number; y: number }): void {
    const bx = x + lift.x, by = y + lift.y;
    this.glow(bx, by, r * 0.8, '#ffffff', 0.06, 1);
    this.glow(bx, by, r * 1.4, '#ffd080', 0.15, 0.6);
    this.star(bx, by, r * 1.5, '#fff0d0', rnd() * 6, 0.09);
    this.light(x, y, r * 2.2, '#ffb060', 0.3, 0.3);
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI2 + rr(-0.2, 0.2), v = rr(2.5, 4.5) * r;
      this.add(SPARK, bx, by, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: rr(0.25, 0.4), size: 0.05, color: '#ffe8b0', drag: 3.5 });
    }
    for (let i = 0; i < 4; i++) this.smoke(bx + rr(-0.3, 0.3) * r, by + rr(-0.3, 0.3) * r, r * rr(0.35, 0.5), rr(1.8, 2.6), i % 2 ? '#5a554e' : '#3e3a35', this.wind.x * 0.4, 0, 0.55, 0.2, 0.3);
    this.ring(x, y, r * 0.2, r * 2.6, '#ffe8c0', 0.3, 0.5);
    this.dustRing(x, y, r * 0.3, r * 2.0, 0.6, 0.35);
  }

  /** Armour-piercing strike: a hard white star at the entry, and a narrow jet of white-hot spall punching on through
   *  the hull along the shot line (reads as penetration rather than a splash of sparks). */
  apHit(x: number, y: number, ang: number, damage: number, color = '#fff2d8'): void {
    const k = clamp(Math.sqrt(damage) / 14, 0.35, 1.3);
    this.star(x, y, 0.35 + 0.45 * k, '#ffffff', ang, 0.07);
    this.glow(x, y, 0.2 + 0.25 * k, '#fff4e0', 0.07, 1);
    this.glow(x, y, 0.4 + 0.4 * k, '#ff9a40', 0.14, 0.5);
    // spall jet: fast, narrow, forward
    this.sparks(x + Math.cos(ang) * 0.1, y + Math.sin(ang) * 0.1, Math.round(6 + 6 * k), color, 7 + 4 * k, ang, 0.22, 0.22);
    // a few sparks bounce back off the entry hole
    this.sparks(x, y, 3, '#ffd890', 3, ang + Math.PI, 0.9, 0.2, true);
    if (damage >= 70 && this.busy < 0.7) this.smoke(x, y, 0.12 * k, 1.2, '#46403a', this.wind.x * 0.4, 0, 0.4, 0.5, 0.25);
  }

  /** Round passing through a unit (flechette darts, gauss slug): exit glint and a forward spray of fragments on the
   *  far side of the hull. */
  pierceExit(x: number, y: number, ang: number, color: string, big = false): void {
    const ex = x + Math.cos(ang) * (big ? 0.35 : 0.2), ey = y + Math.sin(ang) * (big ? 0.35 : 0.2);
    this.glow(ex, ey, big ? 0.45 : 0.16, color, big ? 0.1 : 0.06, 0.9);
    this.sparks(ex, ey, big ? 10 : 3, color, big ? 8 : 5.5, ang, big ? 0.3 : 0.18, big ? 0.28 : 0.16);
    if (big) this.star(x, y, 0.7, '#ffffff', ang, 0.08);
  }

  /** Knockback: dirt shoved out from under a unit along the push direction (skid dust + a ground scrape). */
  knockDust(x: number, y: number, ang: number, S: number, k = 1): void {
    if (this.busy > 0.8) return;
    const cs = Math.cos(ang), sn = Math.sin(ang), r = 0.18 + 0.12 * S;
    const n = Math.max(2, Math.round((3 + S) * this.q * k));
    for (let i = 0; i < n; i++) {
      const sd = (i % 2 ? 1 : -1) * rr(0.2, 0.5) * r * 2, v = rr(1.2, 2.6) * k;
      this.add(DUST, x - sn * sd - cs * r * 0.5, y + cs * sd - sn * r * 0.5, { size: r * rr(0.5, 0.8), grow: r * 1.4, max: rr(0.7, 1.1), vx: cs * v + rr(-0.3, 0.3), vy: sn * v + rr(-0.3, 0.3), drag: 3.2, color: '#c3b494', alpha: 0.6 });
    }
  }

  /* ----------------------------------------------------------------------------------- shot / hit helpers */

  /** Muzzle blast: sharp directional flash (1-2 frames) + lingering smoke; heavy guns kick up a ground dust ring. */
  muzzle(x: number, y: number, ang: number, size: number, color = '#ffd890', heavy = false): void {
    const cs = Math.cos(ang), sn = Math.sin(ang);
    // short, hard directional blast; heavy guns add a brief orange ground light and a smoke puff (no starburst)
    this.cone(x, y, ang, size * (heavy ? 1.3 : 1.2), size * (heavy ? 0.6 : 0.45), color, heavy ? 0.05 : 0.035);
    this.glow(x, y, size * 0.7, '#ffe6b0', heavy ? 0.05 : 0.035, 0.8);
    if (heavy) {
      this.light(x + cs * size * 0.6, y + sn * size * 0.6, size * 1.8, '#ff9a40', 0.1, 0.22);
      for (let i = 0; i < 3; i++) this.smoke(x + cs * size * 0.4, y + sn * size * 0.4, size * 0.5, 1.4, '#6a665e', cs * rr(1, 2.6) + rr(-0.3, 0.3), sn * rr(1, 2.6) + rr(-0.3, 0.3), 0.45, 0.3);
    } else if (this.busy < 0.5) this.smoke(x + cs * size * 0.4, y + sn * size * 0.4, size * 0.35, 0.8, '#77736b', cs * 0.8, sn * 0.8, 0.28, 0.2);
  }

  /** Spent brass: a small bright chip that hops out sideways and bounces. */
  casing(x: number, y: number, ang: number): void {
    if (this.busy > 0.5) return;
    const s = ang + Math.PI / 2 * (rnd() < 0.5 ? 1 : -1), v = rr(0.8, 1.8);
    this.add(DEBRIS, x, y, { vx: Math.cos(s) * v, vy: Math.sin(s) * v, vz: rr(1.2, 2.4), z: 0.15, max: 0.7, size: 0.018, color: '#d8b040', vr: rr(-20, 20), drag: 0.6, grav: 14 });
  }

  /** Small-arms impact on ground: dirt kick + a few bouncing sparks. */
  dirtKick(x: number, y: number, s = 1): void {
    this.dust(x, y, 0.11 * s, 2, 0.5);
    this.sparks(x, y, 3, '#ffd890', 3.2, undefined, Math.PI, 0.2, true);
    this.glow(x, y, 0.16 * s, '#ffd8a0', 0.05, 0.8);
  }

  /** Impact on armour: fast, sharp spark spray with a white pop. Scaled by damage. */
  armorHit(x: number, y: number, damage: number, color = '#ffe0a0'): void {
    const n = clamp(Math.round(2 + Math.sqrt(damage) * 0.5), 2, 12);
    this.sparks(x, y, n, color, 4.5, undefined, Math.PI, 0.2, true);
    this.glow(x, y, 0.12 + Math.min(0.25, damage / 800), '#fff0d0', 0.05, 0.9);
    if (damage > 60) this.glow(x, y, 0.25 + Math.min(0.35, damage / 600), '#ff9a40', 0.1, 0.6);
    if (damage >= 70 && this.busy < 0.7) {
      // heavy strike: hard ring, flung metal and a puff of smoke
      const k = Math.min(1, damage / 400);
      this.debris(x, y, 1 + Math.round(k * 3), '#4a4540', 2.4, 0.04);
      this.smoke(x, y, 0.1 + 0.14 * k, 1.2, '#46403a', this.wind.x * 0.4, 0, 0.4, 0.5, 0.25);
    }
  }

  /** A shell striking the ground / a hull with no explosion of its own: pop, ring scaled by calibre, dust cloud, chunks, scorch. */
  shellImpact(x: number, y: number, cal: number): void {
    cal = Math.min(1.2, cal * 1.3);
    if (cal > 0.4) this.fball(x, y, 0.16 + 0.3 * cal, 0.28 + 0.2 * cal, 0, 0, 0.3);
    if (cal > 0.5) this.star(x, y, 0.5 + 0.8 * cal, '#fff0d0', rnd() * 6, 0.08);
    this.glow(x, y, 0.3 + 0.6 * cal, '#ffd8a0', 0.08, 0.9);
    this.light(x, y, 1.2 + 2.4 * cal, '#ffb060', 0.25, 0.3);
    this.ring(x, y, 0.05, 0.4 + 1.1 * cal, '#ffe0b0', 0.22 + 0.1 * cal, 0.7);
    this.dustRing(x, y, 0.1, 0.5 + 1.5 * cal, 0.4 + 0.35 * cal, 0.42);
    this.dust(x, y, 0.2 + 0.35 * cal, 3 + Math.round(cal * 5), 0.8 + cal * 0.9);
    this.sparks(x, y, 5 + cal * 9, '#ffd890', 4.5, undefined, Math.PI, 0.3, true);
    this.debris(x, y, 1 + Math.round(cal * 4), '#4a4034', 2.6, 0.045, cal > 0.6 ? 1 : 0);
    this.smoke(x, y, 0.14 + 0.22 * cal, 1.6 + cal, '#3a342e', this.wind.x * 0.5, 0, 0.5, 0.7, 0.2);
    this.decal('scorch', x, y, 0.2 + 0.3 * cal);
  }

  /** Glowing droplets thrown off a melting surface (heat ray / plasma / welding). */
  molten(x: number, y: number, n: number, color = '#ff9a40'): void {
    this.sparks(x, y, n, color, 2.6, undefined, Math.PI, 0.5, true);
  }

  /** Flames taking hold on the target: a few rising tongues, smoke above, and a scorched burning patch. */
  flameHit(x: number, y: number, S = 1): void {
    if (this.busy > 0.7) return;
    this.fire(x + rr(-0.15, 0.15), y + rr(-0.15, 0.15), 0.16 * S, 0.5, 0, 0, rr(0.6, 1.2), 0.1);
    if (rnd() < 0.5) this.smoke(x, y, 0.15 * S, 1.4, '#2a2622', 0, 0, 0.3, 0.9, 0.3);
    if (rnd() < 0.08) this.patch(x, y, 0.35 * S, 2.5);
  }

  /** A unit on fire: tongues of flame from the hull and a thin smoke column. */
  burning(x: number, y: number, S: number): void {
    if (this.busy > 0.75) return;
    const r = Math.sqrt(S);
    this.fire(x + rr(-0.3, 0.3) * S, y + rr(-0.3, 0.3) * S, 0.1 * r, 0.5, 0, 0, rr(0.7, 1.4), 0.15);
    if (rnd() < 0.35) this.smoke(x + rr(-0.2, 0.2) * S, y + rr(-0.2, 0.2) * S, 0.09 * r, 1.6, '#2a2622', 0, 0, 0.3, 1.0, 0.3);
  }

  /* ----------------------------------------------------------------------------------------- explosions */

  /**
   * A sized explosion. Stages: (1) instant white-hot pop + ground light pool + shock ring, (2) fireball lobes with a
   * turbulent edge that pop with an overshoot and cool white -> yellow -> orange -> red, (3) dust ring + flying
   * chunks + sparks + embers, (4) a dark smoke column that rolls upward and lingers, over a glowing scorch.
   */
  boom(x: number, y: number, r: number, style: 'fire' | 'flak' | 'emp' | 'plasma' | 'sonic' | 'napalm' | 'small' | 'big' = 'fire', ground = true): void {
    r = Math.max(0.15, r);
    const q = this.q, L = this.lightGain;
    if (style === 'emp') {
      // a hard electric crack, not a glowing ball: brief white core, arcs and sparks do the rest
      this.glow(x, y, r * 0.5, '#ffffff', 0.05, 0.9);
      this.glow(x, y, r * 1.0, '#9fd0ff', 0.18, 0.5);
      this.light(x, y, r * 1.8, '#8ab8ff', 0.25, 0.22);
      const nb = r > 1 ? 4 : 3;
      for (let i = 0; i < nb; i++) this.bolt(x + rr(-r, r) * 0.5, y + rr(-r, r) * 0.5, r * rr(0.7, 1.1), '#bfe4ff', rr(0.25, 0.45));
      this.sparks(x, y, 14 * q, '#cfe9ff', 5 * r, undefined, Math.PI, 0.3, true);
      return;
    }
    if (style === 'plasma') {
      this.glow(x, y, r * 0.6, '#ffffff', 0.06);
      this.glow(x, y, r * 1.2, '#e070ff', 0.25, 0.6);
      this.light(x, y, r * 2.0, '#c060ff', 0.45, 0.25);
      this.star(x, y, r * 1.6, '#ffd0ff', rnd() * 6, 0.1);
      this.sparks(x, y, 16 * q, '#f0a0ff', 5 * r, undefined, Math.PI, 0.4, true);
      for (let i = 0; i < 3; i++) this.smoke(x, y, r * 0.5, 1.4, '#2a1830', 0, 0, 0.45, 0.5);
      if (r > 1.2) {
        this.glow(x, y, r * 3, '#ff90ff', 0.5, 0.8);
        this.shockwave(x, y, r * 1.8, '#e070ff', 0.7);
        for (let i = 0; i < 8; i++) { const a = (i / 8) * PI2; this.bolt(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, r * 0.7, '#f0a0ff', 0.3); }
        this.shake(0.35);
      }
      if (ground) { this.decal('scorch', x, y, r * 0.7); this.hot(x, y, r * 0.7, 1.6); }
      return;
    }
    if (style === 'sonic') {
      this.ring(x, y, r * 0.2, r * 1.7, '#5ec8ff', 0.3, 0.9);
      this.ring(x, y, r * 0.1, r * 1.2, '#bfefff', 0.22, 0.7);
      this.dustRing(x, y, r * 0.3, r * 1.5, 0.5, 0.4);
      this.dust(x, y, r * 0.8, 5);
      return;
    }
    if (style === 'flak') {
      // airburst: sharp white pop, dark smoke puffs that hang in the air, fragment sparks flying out
      this.glow(x, y, r * 1.2, '#fff0c0', 0.06, 1);
      this.glow(x, y, r * 1.8, '#ffb050', 0.12, 0.7);
      this.star(x, y, r * 1.2, '#ffe0a0', rnd() * 6, 0.07);
      this.sparks(x, y, 20 * q, '#ffc050', 7 * r, undefined, Math.PI, 0.3);
      this.sparks(x, y, 6 * q, '#ffffff', 4 * r, undefined, Math.PI, 0.15);
      for (let i = 0; i < 4; i++) this.smoke(x + rr(-0.4, 0.4) * r, y + rr(-0.4, 0.4) * r, r * rr(0.5, 0.8), rr(1.6, 2.6), i ? '#2e2824' : '#4a423a', this.wind.x * 0.3, 0, 0.6, rr(0.1, 0.4), 0.6);
      return;
    }
    const big = style === 'big' || r > 1.4;
    const huge = r >= 2.4;
    const rs = Math.sqrt(r);
    const life = (0.4 + 0.2 * rs) * (big ? 1.25 : 1);
    // (1) instant: white pop, light pool, hard ring
    this.glow(x, y, r * 0.8, '#ffffff', 0.07, 0.9);
    this.glow(x, y, r * 1.5, '#ffb060', 0.18 + 0.03 * r, 0.55);
    this.light(x, y, r * (big ? 1.9 : 1.6), '#ffa850', 0.25 + 0.05 * rs, 0.2);
    this.ring(x, y, r * 0.25, r * (big ? 2.7 : 2.0), '#ffe2b0', 0.26 + 0.06 * rs, 0.85);
    // (2) fireball: central white-hot ball + turbulent lobes thrown outward
    this.fball(x, y, r * 0.8, life * 0.6, 0, 0, 0.3);
    const nf = Math.min(18, Math.round((4 + r * 5) * q));
    for (let i = 0; i < nf; i++) {
      const a = (i / nf) * PI2 + rr(-0.4, 0.4), d = r * rr(0.15, 0.55), v = rr(1.0, 2.8) * r;
      this.fball(x + Math.cos(a) * d, y + Math.sin(a) * d, r * rr(0.28, 0.55), life * rr(0.7, 1.1), Math.cos(a) * v, Math.sin(a) * v, rr(0, 0.8));
    }
    // second wave rolls up: lobes lifting off the ground
    const nu = Math.min(8, Math.round((1 + r * 2) * q));
    this.schedule(0.06, () => {
      for (let i = 0; i < nu; i++) {
        const a = rnd() * PI2, d = rnd() * r * 0.4;
        this.fball(x + Math.cos(a) * d, y + Math.sin(a) * d, r * rr(0.35, 0.6), life * rr(0.6, 0.95), Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, rr(0.9, 1.9) * (0.6 + 0.4 * rs), 0.15, 2.0);
      }
    });
    // (3) displaced dirt, chunks, sparks, embers
    if (ground) {
      this.dustRing(x, y, r * 0.3, r * (big ? 2.9 : 2.2), (big ? 0.85 : 0.55) + 0.1 * rs);
      this.dust(x, y, r * (big ? 0.8 : 0.55), Math.min(12, Math.round((3 + r * 3) * q)), big ? 1.6 : 0.9);
    }
    this.sparks(x, y, (8 + r * 9) * q, '#ffcf70', 6 * rs, undefined, Math.PI, 0.45, true);
    if (r >= 0.5) this.embers(x, y, 3 + r * 4, r);
    if (r >= 0.55) this.debris(x, y, Math.min(14, Math.round(2 + r * 4)), '#2a2622', 3.5 * rs, 0.05 + 0.02 * rs, r >= 1 ? 1 : 0);
    // (4) smoke column rolling up and lingering
    const ns = Math.min(12, Math.round((3 + r * 3.5) * q));
    const sl = (2.0 + 0.8 * rs) * (big ? 1.2 : 1);
    for (let i = 0; i < ns; i++) {
      this.add(SMOKE, x + rr(-0.35, 0.35) * r, y + rr(-0.35, 0.35) * r, {
        size: r * rr(0.24, 0.42), grow: r * rr(0.45, 0.75), max: sl * rr(0.75, 1.15), color: i % 3 ? '#2c2824' : '#3d3730',
        vx: this.wind.x + rr(-0.2, 0.2), vy: this.wind.y + rr(-0.2, 0.2), vz: rr(0.7, 1.5) * (0.7 + 0.3 * rs), z: rr(0.1, 0.4) * rs, drag: 0.8, alpha: 0.5, vr: rr(-0.5, 0.5),
      });
    }
    // a lighter cap of smoke follows a moment later
    if (r >= 0.5) {
      this.schedule(0.22, () => {
        for (let i = 0; i < Math.min(5, Math.round((2 + r) * q)); i++) {
          this.add(SMOKE, x + rr(-0.3, 0.3) * r, y + rr(-0.3, 0.3) * r, {
            size: r * rr(0.3, 0.45), grow: r * rr(0.45, 0.7), max: sl * rr(0.8, 1.1), color: '#5b554e',
            vx: this.wind.x + rr(-0.15, 0.15), vy: this.wind.y + rr(-0.15, 0.15), vz: rr(0.6, 1.2) * (0.7 + 0.3 * rs), z: 0.5 * rs, drag: 0.8, alpha: 0.4, vr: rr(-0.4, 0.4),
          });
        }
      });
    }
    if (style === 'napalm') {
      this.embers(x, y, 8, r);
      for (let i = 0; i < 3; i++) this.schedule(0.15 + i * 0.25, () => { for (let k = 0; k < 3; k++) this.fire(x + rr(-0.6, 0.6) * r, y + rr(-0.6, 0.6) * r, r * 0.35, 0.7, 0, 0, rr(0.4, 1)); });
      if (ground) this.patch(x, y, r * 0.8, 3.5);
    }
    if (ground) {
      // the scorch appears as the fireball clears, not under the first white flash
      this.schedule(0.12, () => {
        this.decal(r > 0.7 ? 'crater' : 'scorch', x, y, r * 0.75);
        if (style === 'napalm') this.decal('burn', x, y, r * 0.9);
      });
      if (r >= 0.4) this.hot(x, y, r * 0.8, 2 + r);
    }
    if (huge) {
      this.shockwave(x, y, r * 1.7, '#ffd8a0', 0.8);
      this.schedule(0.1, () => this.ring(x, y, r * 0.3, r * 3.4, '#ffe8c0', 0.8, 0.5));
      this.glow(x, y, r * 3, '#ffe0b0', 0.3, 0.8 * L);
      this.shake(0.5);
    }
  }

  /** Ground shockwave: expanding dusty ring plus a bright leading edge. */
  shockwave(x: number, y: number, r: number, color = '#ffe0b0', life = 0.7): void {
    this.ring(x, y, r * 0.1, r, color, life, 0.9);
    this.ring(x, y, r * 0.05, r * 0.75, '#ffffff', life * 0.6, 0.55);
    this.dustRing(x, y, r * 0.1, r * 1.05, life * 1.3, 0.5);
    this.dust(x, y, r * 0.5, 8, life * 1.4);
  }

  /** Tactical nuke: blinding flash, double shockwave, rising fireball, mushroom of rolling smoke, embers and a huge crater. */
  nuke(x: number, y: number, r: number): void {
    const L = this.lightGain;
    this.shake(1);
    this.flash(0.95, '#fff4e0');
    this.schedule(0.08, () => this.flash(0.6, '#ffd8a0'));
    this.glow(x, y, r * 3.2, '#ffffff', 0.4, L);
    this.glow(x, y, r * 2.2, '#ffe0a0', 0.7, 0.9 * L);
    this.glow(x, y, r * 1.6, '#ff9a40', 1.2, 0.7 * L);
    this.light(x, y, r * 7, '#ffb060', 1.6, 0.6);
    this.shockwave(x, y, r * 1.6, '#fff0d0', 0.9);
    this.schedule(0.12, () => this.shockwave(x, y, r * 1.2, '#ffb060', 1.0));
    this.schedule(0.3, () => this.ring(x, y, r * 0.2, r * 2.4, '#ffd8a0', 1.2, 0.5));
    this.schedule(0.55, () => this.ring(x, y, r * 0.2, r * 3.1, '#ffc080', 1.5, 0.35));
    this.fball(x, y, r * 1.5, 1.4, 0, 0, 0.5, 0, 1.6);
    for (let i = 0; i < 22; i++) {
      const a = rnd() * PI2, d = rnd() * r * 0.7, v = rr(0.4, 1.4) * r;
      this.fball(x + Math.cos(a) * d, y + Math.sin(a) * d, r * rr(0.45, 0.9), rr(0.8, 1.5), Math.cos(a) * v * 0.6, Math.sin(a) * v * 0.6, rr(0.3, 1.4), 0, 1.6);
    }
    this.sparks(x, y, 40, '#ffcf70', 11 * Math.sqrt(r), undefined, Math.PI, 0.7, true);
    this.embers(x, y, 30, r);
    this.debris(x, y, 26, '#2a2622', 7 * r, 0.1, 1);
    // mushroom: the stem climbs, then a cap billows out
    for (let i = 0; i < 9; i++) this.schedule(0.2 + i * 0.12, () => this.add(SMOKE, x + rr(-0.15, 0.15) * r, y, { size: r * (0.35 + 0.02 * i), grow: r * 0.5, max: 4.2, color: '#3a322c', vx: this.wind.x * 0.3, vz: 1.3 * r, z: i * 0.12 * r, drag: 0.5, alpha: 0.7 }));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * PI2;
      this.schedule(1.0 + i * 0.02, () => this.add(SMOKE, x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.25, { size: r * 0.6, grow: r * 0.6, max: 4.6, color: i % 2 ? '#4a4038' : '#2a2420', vx: Math.cos(a) * r * 0.5, vy: Math.sin(a) * r * 0.2, vz: 0.2 * r, z: r * 1.6, drag: 0.8, alpha: 0.65 }));
    }
    this.schedule(0.5, () => this.glow(x, y, r * 1.3, '#ff7a30', 1.3, 0.6 * L));
    this.decal('crater', x, y, r * 1.1);
    this.decal('burn', x, y, r * 1.5);
    this.decal('scorch', x, y, r * 1.8);
    this.hot(x, y, r * 1.4, 6);
  }

  /** Multi-stage death of a giant / titan: chain of blasts, reactor flash, debris rain, long smoke. */
  megaDeath(x: number, y: number, S: number, color: string): void {
    const R = 0.35 * S, L = this.lightGain;
    this.shake(0.9);
    this.glow(x, y, R * 5, '#ffffff', 0.2, L);
    this.glow(x, y, R * 3.2, '#ffb060', 0.55, 0.8 * L);
    this.light(x, y, R * 8, '#ffa850', 1.0, 0.55);
    this.shockwave(x, y, R * 4, '#ffe0b0', 0.8);
    this.boom(x, y, R * 2.4, 'big');
    this.debris(x, y, 14 * S, color, 6 + S, 0.09 * S, 1);
    this.debris(x, y, 10 * S, '#2a2622', 5, 0.07 * S, 1);
    this.embers(x, y, 14 * S, S * 0.7);
    // chain of secondary blasts walking across the hull
    for (let i = 0; i < 6 + S; i++) {
      const a = rnd() * PI2, d = rnd() * R * 2.2;
      this.schedule(0.15 + i * 0.16, () => {
        this.boom(x + Math.cos(a) * d, y + Math.sin(a) * d, R * rr(0.7, 1.3), 'fire', i % 2 === 0);
        if (i % 3 === 0) this.shake(0.3);
      });
    }
    this.flash(0.35, '#ffe8c8');
    this.schedule(0.2 + (4 + S) * 0.16, () => {
      // reactor goes: bright pop, extended shockwave pair, rising fireball
      this.flash(0.55, '#fff0d8');
      this.glow(x, y, R * 6, '#ffffff', 0.28, L);
      this.light(x, y, R * 10, '#ffc080', 1.2, 0.6);
      this.shockwave(x, y, R * 6.5, '#fff0d0', 1.0);
      this.schedule(0.12, () => this.ring(x, y, R * 0.5, R * 9.5, '#ffe0b0', 1.3, 0.45));
      this.boom(x, y, R * 3.2, 'big');
      this.fball(x, y - 0.0, R * 2.4, 1.3, 0, 0, 1.1, 0.3, 1.5);
      this.shake(1);
      this.debris(x, y, 16 * S, color, 9, 0.1 * S, 1);
    });
    for (let i = 0; i < 8; i++) this.schedule(0.5 + i * 0.5, () => this.add(SMOKE, x + rr(-0.4, 0.4) * R, y + rr(-0.4, 0.4) * R, { size: R * 0.9, grow: R * 1.2, max: 4.2, color: '#1e1c1a', vx: this.wind.x, vy: this.wind.y, vz: rr(0.5, 0.9), z: 0.3, drag: 0.6, alpha: 0.55, vr: rr(-0.4, 0.4) }));
    this.decal('crater', x, y, R * 3);
    this.decal('burn', x, y, R * 3.6);
    this.hot(x, y, R * 2.5, 6);
  }

  /* ------------------------------------------------------------------------------------------ wrecks */

  /** Register a wreck: `get(px)` returns its charred sprite at a device-px-per-cell scale, `hot` the ember points
   *  (hull-local cells). Bigger hulks smoulder longer and heavier. */
  wreck(x: number, y: number, a: number, S: number, ext: number, get: (px: number) => HTMLCanvasElement, hot: number[], sc = 1): void {
    const scorch: number[] = [];
    const n = 11, R = (0.42 + 0.08 * Math.min(S, 3)) * S * sc + 0.15;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2, r = R * rr(0.7, 1.15);
      scorch.push(Math.cos(t) * r, Math.sin(t) * r * rr(0.8, 1));
    }
    this.wrecks.push({ x, y, a, sc, S, t0: this.time, life: S >= 4 ? 48 : 14 + 5 * S, ext, get, hot, scorch, smokeT: rr(0.2, 0.8) });
    if (this.wrecks.length > 260) this.wrecks.shift();
  }

  private updateWrecks(dt: number): void {
    this.smokeTokens = Math.min(6, this.smokeTokens + dt * WRECK_SMOKE_RATE);
    for (const w of this.wrecks) {
      const age = this.time - w.t0, k = 1 - age / w.life;
      if (k <= 0) continue;
      const rS = Math.sqrt(w.S);
      // early fire: small flickering flames licking out of the cracks for the first seconds
      if (age < 2.5 + w.S && rnd() < dt * (2 + w.S) && this.busy < 0.7 && w.hot.length) {
        const i = Math.floor(rnd() * (w.hot.length / 2)) * 2, p = this.toWorld(w, w.hot[i], w.hot[i + 1]);
        this.fire(p.x, p.y, 0.07 * rS, 0.35, this.up.x * 0.3, this.up.y * 0.3);
      }
      w.smokeT -= dt;
      if (w.smokeT > 0) continue;
      w.smokeT = rr(0.6, 1.2) / ((0.5 + 0.45 * w.S) * (0.25 + 0.75 * k));
      if (this.smokeTokens < 1 || this.busy > 0.6) continue;
      this.smokeTokens -= 1;
      // thin light-grey plume: rises (screen up), drifts with a light wind, thins as the wreck cools
      const p = w.hot.length ? this.toWorld(w, w.hot[0], w.hot[1]) : { x: w.x, y: w.y };
      const life = (2.2 + 0.5 * Math.min(w.S, 5)) * rr(0.85, 1.15);
      this.add(SMOKE, p.x + rr(-0.1, 0.1) * rS, p.y + rr(-0.1, 0.1) * rS, {
        size: 0.09 * rS, grow: 0.22 * rS, max: life, color: '#8f8c87', alpha: 0.12 + 0.2 * k,
        vx: this.up.x * 0.38 + 0.14 + rr(-0.05, 0.05), vy: this.up.y * 0.38 + rr(-0.05, 0.05), drag: 0.15, vr: rr(-0.4, 0.4),
      });
    }
  }

  /** 0..1 strength of a fire field now (quick fade-in, burns down over its last second); <= 0 once out */
  private fieldK(f: FireField): number {
    const age = this.simT - f.t0, left = f.dur - age;
    if (left <= 0) return 0;
    return Math.min(1, age / 0.25 + 0.2, left / 1.2);
  }

  private updateFields(dt: number): void {
    if (!this.fields.length) return;
    this.fields = this.fields.filter((f) => this.simT - f.t0 < f.dur && this.simT >= f.t0 - 0.5);
    const busy = this.busy;
    for (const f of this.fields) {
      const k = this.fieldK(f);
      if (k <= 0 || busy > 0.8) continue;
      // flame tongues rise all over the patch (fewer when the pool is busy); smoke now and then
      f.acc += dt * (5 + f.r * 7) * k * (busy > 0.5 ? 0.4 : 1);
      while (f.acc >= 1) {
        f.acc -= 1;
        const a = rnd() * PI2, d = Math.sqrt(rnd()) * f.r * 0.85;
        const x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d;
        this.fire(x, y, rr(0.12, 0.22) * Math.sqrt(f.r), rr(0.4, 0.7), this.wind.x * 0.3, 0, rr(0.7, 1.5), 0.05);
        if (rnd() < 0.18) this.smoke(x, y, 0.18 + f.r * 0.1, 2.2, '#2a2622', this.wind.x * 0.6, this.wind.y * 0.6, 0.32, 0.9, 0.4);
        if (rnd() < 0.12) this.add(EMBER, x, y, { vx: rr(-0.4, 0.4), vy: rr(-0.4, 0.4), vz: rr(1, 2.4), z: 0.1, max: rr(0.6, 1.2), size: rr(0.03, 0.05), color: '#ffb050', drag: 1.5 });
      }
    }
  }

  /** Ground pass (under live units): every burning fire field — a charred bed, a pulsing hot glow and a mat of
   *  flickering flame tongues (drawn from cached sprites, no particles), so the patch reads as "do not drive here". */
  drawFields(g: Ctx, px: number): void {
    if (!this.fields.length) return;
    const vw = this.view, time = this.time;
    const prev = g.globalCompositeOperation;
    for (const f of this.fields) {
      const k = this.fieldK(f);
      if (k <= 0) continue;
      if (vw && (f.x < vw.x0 - f.r || f.x > vw.x1 + f.r || f.y < vw.y0 - f.r || f.y > vw.y1 + f.r)) continue;
      // charred bed
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 0.5 * Math.min(1, k * 2);
      const R = f.r * 1.15;
      g.drawImage(softDot('rgba(14,8,4,1)'), f.x - R, f.y - R, R * 2, R * 2);
      g.globalCompositeOperation = 'lighter';
      const pulse = 0.82 + 0.18 * Math.sin(time * 7 + f.seed) * Math.sin(time * 3.1 + f.seed * 0.7);
      // hot glow across the whole patch, brighter core
      g.globalAlpha = clamp(0.6 * k * pulse * this.lightGain + 0.25 * k, 0, 1);
      g.drawImage(glowTex('#ff5410'), f.x - f.r * 1.35, f.y - f.r * 1.35, f.r * 2.7, f.r * 2.7);
      g.globalAlpha = clamp(0.45 * k * pulse, 0, 1);
      g.drawImage(glowTex('#ffa040'), f.x - f.r * 0.7, f.y - f.r * 0.7, f.r * 1.4, f.r * 1.4);
      // flickering tongues: fixed spots in the patch, each with its own flicker phase and fire stage
      if (f.r * px < 6) continue;
      const n = Math.min(22, Math.round(7 + f.r * 6));
      for (let i = 0; i < n; i++) {
        const h1 = hash1(f.seed + i * 7.3), h2 = hash1(f.seed * 3 + i * 11.1), h3 = hash1(f.seed + i * 19.7);
        const a = h1 * PI2, d = Math.sqrt(h2) * f.r * 0.85;
        const fl = 0.5 + 0.5 * Math.sin(time * (8 + h3 * 9) + i * 2.1);
        const s = (0.18 + 0.18 * h3) * Math.sqrt(f.r) * (0.75 + 0.4 * fl) * (0.6 + 0.4 * k);
        const x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d - s * 0.3;
        g.globalAlpha = clamp((0.35 + 0.55 * fl) * k, 0, 1);
        g.drawImage(fireTex(fl > 0.7 ? 1 : 2, i), x - s, y - s, s * 2, s * 2);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = prev;
  }

  private toWorld(w: Wreck, lx: number, ly: number): { x: number; y: number } {
    const c = Math.cos(w.a), s = Math.sin(w.a);
    return { x: w.x + (c * lx - s * ly) * w.sc, y: w.y + (s * lx + c * ly) * w.sc };
  }

  /** Ground pass (under live units): crisp scorch, the hulk, then ember glow in its cracks while it is hot. */
  drawWrecks(g: Ctx, px: number): void {
    if (!this.wrecks.length) return;
    for (const w of this.wrecks) {
      const tr = g.getTransform();
      g.translate(w.x, w.y);
      g.rotate(w.a);
      g.fillStyle = 'rgba(16,13,10,0.42)';
      g.beginPath();
      for (let i = 0; i < w.scorch.length; i += 2) g.lineTo(w.scorch[i], w.scorch[i + 1]);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(10,8,6,0.3)';
      g.save(); g.scale(0.62, 0.62); g.fill(); g.restore();
      const e = w.ext * w.sc;
      g.drawImage(w.get(px * w.sc), -e, -e, e * 2, e * 2);
      g.setTransform(tr);
    }
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    const hotA = softDot('rgba(255,110,30,1)'), hotB = softDot('rgba(255,214,140,1)');
    for (const w of this.wrecks) {
      const k = 1 - (this.time - w.t0) / w.life;
      if (k <= 0) continue;
      const rS = Math.sqrt(Math.min(w.S, 4));
      for (let i = 0; i < w.hot.length; i += 2) {
        const f = 0.6 + 0.4 * Math.sin(this.time * (5 + i) + i * 2.3) * Math.sin(this.time * 2.1 + i);
        const p = this.toWorld(w, w.hot[i], w.hot[i + 1]);
        const r = (0.05 + 0.03 * f) * rS;
        g.globalAlpha = clamp(Math.pow(k, 1.4) * f * 0.85, 0, 1);
        g.drawImage(hotA, p.x - r, p.y - r, r * 2, r * 2);
        g.globalAlpha = clamp(Math.pow(k, 2) * f, 0, 1);
        g.drawImage(hotB, p.x - r * 0.35, p.y - r * 0.35, r * 0.7, r * 0.7);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = prev;
  }

  /* ------------------------------------------------------------------------------------------ decals */

  setDecalSpace(fieldW: number, fieldH: number, px: number): void {
    px = Math.max(4, Math.round(px));
    if (this.decalCanvas && px === this.decalPx && fieldW === this.fieldW && fieldH === this.fieldH) return;
    this.decalPx = px;
    this.fieldW = fieldW;
    this.fieldH = fieldH;
    this.decalCanvas = makeCanvas(fieldW * px, fieldH * px);
    for (const d of this.decals) this.paintDecal(d);
  }

  decal(kind: Decal['kind'], x: number, y: number, r: number, img?: HTMLCanvasElement, ext?: number, a = rnd() * Math.PI * 2): void {
    const d: Decal = { kind, x, y, r, a, img, ext };
    this.decals.push(d);
    if (this.decals.length > 500) {
      // keep wrecks, drop the oldest scorch
      const i = this.decals.findIndex((q) => q.kind !== 'wreck');
      this.decals.splice(i >= 0 ? i : 0, 1);
    }
    this.paintDecal(d);
  }

  private paintDecal(d: Decal): void {
    const c = this.decalCanvas;
    if (!c) return;
    const g = ctx2d(c);
    const px = this.decalPx;
    g.setTransform(px, 0, 0, px, 0, 0);
    if (d.kind === 'wreck' && d.img && d.ext) {
      g.save();
      g.translate(d.x, d.y);
      g.rotate(d.a);
      g.globalAlpha = 0.85;
      g.drawImage(d.img, -d.ext, -d.ext, d.ext * 2, d.ext * 2);
      g.restore();
      g.globalAlpha = 1;
      return;
    }
    const r = d.r;
    // crisp, irregular scorch: a hard-edged outer char ring and a darker core (no blotchy texture)
    const jag = (rad: number) => {
      g.beginPath();
      const n = 12;
      for (let i = 0; i < n; i++) { const a = d.a + (i / n) * Math.PI * 2, rr2 = rad * (0.78 + 0.32 * Math.abs(Math.sin(i * 2.7 + d.a * 3))); g.lineTo(d.x + Math.cos(a) * rr2, d.y + Math.sin(a) * rr2); }
      g.closePath();
      g.fill();
    };
    if (d.kind === 'burn') {
      g.fillStyle = 'rgba(20,14,10,0.3)'; jag(r);
      g.fillStyle = 'rgba(12,9,7,0.25)'; jag(r * 0.6);
      return;
    }
    g.fillStyle = d.kind === 'crater' ? 'rgba(14,12,10,0.38)' : 'rgba(16,13,10,0.3)';
    jag(r * 1.15);
    g.fillStyle = d.kind === 'crater' ? 'rgba(8,7,6,0.35)' : 'rgba(10,9,8,0.25)';
    jag(r * 0.62);
    if (d.kind === 'crater') {
      g.strokeStyle = 'rgba(150,130,100,0.18)';
      g.lineWidth = r * 0.12;
      g.beginPath();
      g.arc(d.x, d.y, r * 0.55, d.a, d.a + 4);
      g.stroke();
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.arc(d.x, d.y, r * 0.4, 0, Math.PI * 2);
      g.fill();
      // radial streaks
      g.strokeStyle = 'rgba(10,8,6,0.14)';
      g.lineWidth = r * 0.1;
      g.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = d.a + i * 0.9 + Math.sin(i * 3.1) * 0.3;
        g.moveTo(d.x + Math.cos(a) * r * 0.5, d.y + Math.sin(a) * r * 0.5);
        g.lineTo(d.x + Math.cos(a) * r * 1.25, d.y + Math.sin(a) * r * 1.25);
      }
      g.stroke();
    }
  }


  /* ------------------------------------------------------------------------------------------ update */

  update(dt: number): void {
    this.time += dt;
    if (this.later.length) {
      const due = this.later.filter((l) => l.t <= this.time);
      if (due.length) {
        this.later = this.later.filter((l) => l.t > this.time);
        for (const l of due) l.fn();
      }
    }
    this.updateWrecks(dt);
    this.updateFields(dt);
    this.trauma = Math.max(0, this.trauma - dt * 2.4);
    this.flashA = Math.max(0, this.flashA - dt * 4);
    const P = this.parts;
    const calm = this.busy > 0.6;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      if (p.fresh) { p.fresh = false; continue; }
      p.life -= dt;
      if (p.life <= 0) {
        P[i] = P[P.length - 1];
        P.pop();
        continue;
      }
      const k = p.k;
      if (k === RING || k === DRING || k === LIGHT || k === HOT || k === GLOW || k === STAR || k === CONE) continue;
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr;
      p.vy *= dr;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (k !== FBALL) p.size += p.grow * dt;
      if (k === DEBRIS || p.grav) {
        p.vz -= (p.grav || 14) * dt;
        p.z += p.vz * dt;
        if (p.z <= 0) {
          p.z = 0;
          if (p.vz < -1.5) p.vz = -p.vz * 0.3;
          else if (k === DEBRIS) { p.vz = 0; p.vx *= 0.8; p.vy *= 0.8; p.vr *= 0.8; }
          else p.life = 0;
        }
        // chunks in flight trail a thin wisp of smoke
        if (k === DEBRIS && p.flag > 0 && p.z > 0.15 && !calm && rnd() < dt * 16) {
          this.add(SMOKE, p.x, p.y, { z: p.z, size: p.size * 0.8, grow: p.size * 2.2, max: 0.7, color: '#3a3430', alpha: 0.4, vz: 0.15, drag: 1.5 });
        }
      } else if (p.vz) {
        p.z += p.vz * dt;
        p.vz *= dr;
      }
      if (k === PATCH && !calm && rnd() < dt * p.size * 16) {
        const a = rnd() * PI2, d = Math.sqrt(rnd()) * p.size * 0.8;
        this.fire(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 0.1 + p.size * 0.18, 0.5, 0, 0, rr(0.6, 1.3), 0.05);
        if (rnd() < 0.3) this.smoke(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 0.12 + p.size * 0.1, 1.8, '#2a2622', this.wind.x * 0.5, 0, 0.3, 0.9, 0.3);
      }
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      if (b.life <= 0) this.beams.splice(i, 1);
    }
  }

  /* ------------------------------------------------------------------------------------------- draw */

  /** liftX/liftY: world vector for "screen up" (debris height). px = device pixels per cell. */
  draw(g: Ctx, px: number, liftX: number, liftY: number): void {
    const minW = 1 / px, K = this.liftK, vw = this.view, time = this.time;
    const lx = liftX * K, ly = liftY * K;
    const P = this.parts;
    // normal-blend pass: dust, smoke, debris, dust rings
    for (let n = 0; n < P.length; n++) {
      const p = P[n];
      const k = p.k;
      if (k !== DUST && k !== SMOKE && k !== DEBRIS && k !== DRING) continue;
      const m = p.size + 2;
      if (vw && (p.x < vw.x0 - m || p.x > vw.x1 + m || p.y < vw.y0 - m || p.y > vw.y1 + m)) continue;
      const t = p.life / p.max;
      if (k === DRING) {
        const u = 1 - t, s = p.size + (p.r1 - p.size) * easeOut(u);
        if (s * px < 2) continue;
        // a billowing ring of dust: soft irregular puffs around the circumference (a solid ring texture read as a disc)
        const n = 9, a0 = (p.seed ?? 0) * 7.1, img = glowTex(p.color);
        for (let i = 0; i < n; i++) {
          const h = hash1((p.seed ?? 0) * 13 + i);
          const a = a0 + (i / n) * PI2 + h * 0.5, rr2 = s * (0.82 + 0.3 * h), bs = s * (0.28 + 0.2 * h);
          g.globalAlpha = clamp(p.alpha * 0.55 * Math.pow(t, 1.2) * (0.6 + 0.4 * h), 0, 1);
          g.drawImage(img, p.x + Math.cos(a) * rr2 - bs, p.y + Math.sin(a) * rr2 - bs, bs * 2, bs * 2);
        }
      } else if (k === DEBRIS) {
        g.globalAlpha = Math.min(1, t * 3);
        const x = p.x + lx * p.z, y = p.y + ly * p.z;
        if (p.flag > 0) {
          g.strokeStyle = '#2a2622';
          g.globalAlpha = Math.min(0.5, t * 2);
          g.lineWidth = Math.max(minW, p.size * 0.9);
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x - (p.vx + lx * p.vz) * 0.06, y - (p.vy + ly * p.vz) * 0.06);
          g.stroke();
          g.globalAlpha = Math.min(1, t * 3);
        }
        const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
        const tr = g.getTransform();
        g.transform(cs, sn, -sn, cs, x, y);
        g.fillStyle = p.color;
        g.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2);
        g.setTransform(tr);
      } else {
        const s = p.size;
        if (s * px < 1.2) continue;
        const a = p.alpha * Math.min(1, t * 1.6) * (k === SMOKE ? Math.min(1, (1 - t) * 6 + 0.3) : 1);
        g.globalAlpha = clamp(a, 0, 1);
        const img = puffTex(p.color, p.seed);
        const x = p.x + lx * p.z, y = p.y + ly * p.z;
        if (k === SMOKE && s * px > 7) {
          const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
          const tr = g.getTransform();
          g.transform(cs, sn, -sn, cs, x, y);
          g.drawImage(img, -s, -s, s * 2, s * 2);
          g.setTransform(tr);
        } else g.drawImage(img, x - s, y - s, s * 2, s * 2);
      }
    }
    g.globalAlpha = 1;
    // additive pass
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    this.drawBeams(g, minW);
    const LG = this.lightGain;
    for (let n = 0; n < P.length; n++) {
      const p = P[n];
      const k = p.k;
      if (k === SMOKE || k === DUST || k === DEBRIS || k === DRING) continue;
      const m = p.size * (k === CONE ? 1 : 1) + 2.5;
      if (vw && (p.x < vw.x0 - m || p.x > vw.x1 + m || p.y < vw.y0 - m || p.y > vw.y1 + m)) continue;
      const t = p.life / p.max;
      const x = p.x + lx * p.z, y = p.y + ly * p.z;
      switch (k) {
        case SPARK: {
          g.globalAlpha = Math.min(1, t * 2.2);
          g.strokeStyle = t > 0.7 ? '#ffe2a0' : p.color;
          g.lineWidth = Math.max(minW * 0.8, p.size * 0.75);
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x - (p.vx + lx * p.vz) * 0.03, y - (p.vy + ly * p.vz) * 0.03);
          g.stroke();
          break;
        }
        case FIRE: {
          // soft additive flame: red-orange body that darkens as it rises, yellow-white core that dies first
          const u = 1 - t, s = p.size;
          if (s * px < 1.2) break;
          const a = t > 0.8 ? (1 - t) * 5 : t * 1.25;
          g.globalAlpha = clamp(a * 0.75, 0, 1);
          g.drawImage(glowTex(u < 0.45 ? '#ff9a38' : u < 0.75 ? '#e0521c' : '#a02c10'), x - s * 1.5, y - s * 1.5, s * 3, s * 3);
          if (u < 0.6) {
            g.globalAlpha = clamp(a * (1 - u / 0.6), 0, 1);
            g.drawImage(glowTex('#ffe090'), x - s * 0.75, y - s * 0.75, s * 1.5, s * 1.5);
          }
          break;
        }
        case FBALL: {
          const u = 1 - t;
          // pop: leaps to full size within ~15% of its life with a small overshoot, then keeps swelling
          const pop = u < 0.15 ? 0.45 + 0.67 * easeOut(u / 0.15) : 1.12 - 0.12 * Math.min(1, (u - 0.15) / 0.3);
          const s = p.size * pop * (1 + p.grow * u);
          if (s * px < 1.5) break;
          const fade = t < 0.3 ? t / 0.3 : 1;
          const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
          const tr = g.getTransform();
          g.transform(cs, sn, -sn, cs, x, y);
          g.globalAlpha = clamp(0.55 * fade * Math.min(1, t * 2.2), 0, 1);
          g.drawImage(fireTex(3, p.seed), -s * 1.1, -s * 1.1, s * 2.2, s * 2.2);
          const ao = (1 - u / 0.75) * fade;
          if (ao > 0.03) { g.globalAlpha = Math.min(0.9, ao); g.drawImage(fireTex(2, p.seed + 1), -s, -s, s * 2, s * 2); }
          const ay = (1 - u / 0.42) * fade;
          if (ay > 0.03) { g.globalAlpha = Math.min(0.75, ay); g.drawImage(fireTex(1, p.seed + 2), -s * 0.62, -s * 0.62, s * 1.24, s * 1.24); }
          const aw = (1 - u / 0.18);
          if (aw > 0.03) { g.globalAlpha = Math.min(1, aw); g.drawImage(fireTex(0, p.seed + 3), -s * 0.4, -s * 0.4, s * 0.8, s * 0.8); }
          g.setTransform(tr);
          break;
        }
        case GLOW: {
          const s = p.size;
          if (s * px < 1.2) break;
          g.globalAlpha = clamp(p.alpha * t * t * (s > 1.5 ? LG : 1), 0, 1);
          g.drawImage(glowTex(p.color), p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
        case LIGHT: {
          const s = p.size * (0.85 + 0.15 * (1 - t));
          if (s * px < 3) break;
          g.globalAlpha = clamp(p.alpha * LG * t * t, 0, 1);
          g.drawImage(glowTex(p.color), p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
        case HOT: {
          const s = p.size;
          if (s * px < 2) break;
          const fl = 0.78 + 0.22 * Math.sin(time * 9 + p.seed * 3 + p.x * 7);
          g.globalAlpha = clamp(p.alpha * Math.pow(t, 0.9) * fl, 0, 1);
          g.drawImage(glowTex('#ff6a1c'), p.x - s, p.y - s, s * 2, s * 2);
          g.globalAlpha = clamp(p.alpha * t * t * fl * 0.7, 0, 1);
          g.drawImage(glowTex('#ffc060'), p.x - s * 0.4, p.y - s * 0.4, s * 0.8, s * 0.8);
          break;
        }
        case PATCH: {
          const s = p.size * (0.9 + 0.1 * Math.sin(time * 14 + p.seed));
          if (s * px < 2) break;
          g.globalAlpha = clamp(p.alpha * Math.min(1, t * 2), 0, 1);
          g.drawImage(glowTex('#ff7a20'), p.x - s * 1.3, p.y - s * 1.3, s * 2.6, s * 2.6);
          break;
        }
        case STAR: {
          const s = p.size;
          if (s * px < 2) break;
          g.globalAlpha = t;
          const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
          const tr = g.getTransform();
          g.transform(cs, sn, -sn, cs, p.x, p.y);
          g.drawImage(starTex(p.color), -s, -s, s * 2, s * 2);
          g.setTransform(tr);
          break;
        }
        case CONE: {
          const len = p.size * (0.7 + 0.3 * (1 - t)), w = p.r1;
          if (len * px < 2) break;
          g.globalAlpha = clamp(Math.pow(t, 0.6), 0, 1);
          const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
          const tr = g.getTransform();
          g.transform(cs, sn, -sn, cs, p.x, p.y);
          g.drawImage(coneTex(p.color), -len * 0.0625, -w / 2, len, w);
          g.setTransform(tr);
          break;
        }
        case RING: {
          const u = 1 - t, s = p.size + (p.r1 - p.size) * easeOut(u);
          if (s * px < 2) break;
          g.globalAlpha = clamp(p.alpha * Math.pow(t, 1.1) * (s > 1.5 ? 0.4 + 0.6 * LG : 1), 0, 1);
          g.drawImage(ringTex(p.color), p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
        case EMBER: {
          const s = p.size * 2.4;
          if (s * px < 1) break;
          g.globalAlpha = t;
          g.drawImage(glowTex(p.color), x - s, y - s, s * 2, s * 2);
          break;
        }
        case HEAL: {
          g.globalAlpha = Math.min(1, t * 2);
          g.fillStyle = p.color;
          const s = p.size;
          g.fillRect(p.x - s, p.y - s * 0.3, s * 2, s * 0.6);
          g.fillRect(p.x - s * 0.3, p.y - s, s * 0.6, s * 2);
          break;
        }
        case HEX: {
          // shield hit: the side of the shield facing the shot flashes (bright rim arc + a soft gradient fading inward)
          const s = p.size, a = p.r1;
          const hx = p.x + Math.cos(a) * s, hy = p.y + Math.sin(a) * s;
          g.save();
          g.beginPath();
          g.arc(p.x, p.y, s, 0, PI2);
          g.clip();
          const gr = g.createRadialGradient(hx, hy, 0, hx, hy, s * 1.1);
          gr.addColorStop(0, rgba('#9fe4ff', 0.42 * t));
          gr.addColorStop(0.45, rgba('#7fd8ff', 0.14 * t));
          gr.addColorStop(1, rgba('#7fd8ff', 0));
          g.globalAlpha = 1;
          g.fillStyle = gr;
          g.fillRect(p.x - s, p.y - s, s * 2, s * 2);
          g.restore();
          g.strokeStyle = '#d8f6ff';
          g.lineCap = 'round';
          for (let k = 0; k < 3; k++) {
            const span = 0.3 + 0.32 * k;
            g.globalAlpha = t * (0.75 - 0.22 * k);
            g.lineWidth = Math.max(minW, s * (0.05 - 0.012 * k));
            g.beginPath(); g.arc(p.x, p.y, s, a - span, a + span); g.stroke();
          }
          break;
        }
        case BOLT: {
          g.globalAlpha = t;
          const img = tex('wbolt');
          const s = p.size;
          if (img) {
            const a = p.rot + (((time * 14) | 0) % 4) * 1.57;
            const cs = Math.cos(a), sn = Math.sin(a);
            const tr = g.getTransform();
            g.transform(cs, sn, -sn, cs, p.x, p.y);
            g.drawImage(tinted('wbolt', p.color) ?? img, -s, -s, s * 2, s * 2);
            g.setTransform(tr);
          } else g.drawImage(glowTex(p.color), p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = prev;
  }

  /** Crackling arcs crawling over a stunned unit's hull (additive; call with 'lighter' active). Re-randomised at ~14 Hz
   *  (7 Hz and lower contrast when flashes are reduced). */
  drawShock(g: Ctx, cx: number, cy: number, rx: number, ry: number, rot: number, seed: number, minW: number): void {
    const calm = this.flashK < 0.6;
    const step = (this.time * (calm ? 7 : 14)) | 0;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const arcs = 3;
    for (let a = 0; a < arcs; a++) {
      const base = hash1(seed * 13 + step * 7 + a) * PI2, span = 0.8 + hash1(seed + step * 3 + a * 5) * 0.9;
      const pts: number[] = [];
      const n = 7;
      for (let i = 0; i <= n; i++) {
        const ang = base + (span * i) / n;
        const j = 1 + (hash1(seed * 31 + step * 11 + a * 17 + i) - 0.5) * 0.28;
        const ex = Math.cos(ang) * rx * j, ey = Math.sin(ang) * ry * j;
        pts.push(cx + ex * cs - ey * sn, cy + ex * sn + ey * cs);
      }
      stroke(g, pts, '#8fa8ff', Math.max(minW * 3, 0.07), calm ? 0.2 : 0.3);
      stroke(g, pts, calm ? '#cfe0ff' : '#ffffff', Math.max(minW, 0.022), calm ? 0.6 : 0.9);
    }
    // a pale violet ionised haze over the whole hull
    g.globalAlpha = calm ? 0.1 : 0.16;
    const s = Math.max(rx, ry) * 1.35;
    g.drawImage(glowTex('#8f9cff'), cx - s, cy - s, s * 2, s * 2);
    g.globalAlpha = 1;
  }

  /** Slowed unit (additive): a cold violet haze over the hull and a slowly turning, segmented violet ring on the ground
   *  around it. `k` 0..1 = how strongly it is slowed. */
  drawSlow(g: Ctx, gx: number, gy: number, hx: number, hy: number, r: number, k: number, minW: number): void {
    const a0 = this.time * 0.7;
    g.lineCap = 'round';
    g.strokeStyle = '#b47cff';
    g.lineWidth = Math.max(minW * 2, r * 0.07);
    g.globalAlpha = clamp(0.3 + 0.5 * k, 0, 1);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const s = a0 + (i / n) * PI2;
      g.beginPath(); g.ellipse(gx, gy, r, r * 0.8, 0, s, s + (PI2 / n) * 0.55); g.stroke();
    }
    g.strokeStyle = '#e8d8ff';
    g.lineWidth = Math.max(minW, r * 0.025);
    g.globalAlpha = clamp(0.25 + 0.4 * k, 0, 1);
    for (let i = 0; i < n; i++) {
      const s = a0 + (i / n) * PI2;
      g.beginPath(); g.ellipse(gx, gy, r, r * 0.8, 0, s, s + (PI2 / n) * 0.55); g.stroke();
    }
    g.globalAlpha = clamp(0.12 + 0.2 * k, 0, 1);
    g.drawImage(glowTex('#9a6cff'), hx - r * 1.1, hy - r * 1.1, r * 2.2, r * 2.2);
    g.globalAlpha = 1;
  }

  /** Disarmed unit (additive): a flickering red "no fire" sign (circle with a slash) hovering over the hull. */
  drawDisarm(g: Ctx, x: number, y: number, r: number, seed: number, minW: number): void {
    const fl = 0.7 + 0.3 * hash1(seed + ((this.time * 12) | 0));
    g.lineCap = 'round';
    g.globalAlpha = 0.35 * fl;
    g.drawImage(glowTex('#ff2040'), x - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2);
    for (const [c, w, al] of [['#ff3050', 0.2, 0.55], ['#ffd0d8', 0.08, 0.95]] as const) {
      g.strokeStyle = c;
      g.lineWidth = Math.max(minW * (w > 0.1 ? 3 : 1.2), r * w);
      g.globalAlpha = al * fl;
      g.beginPath(); g.arc(x, y, r, 0, PI2); g.stroke();
      g.beginPath(); g.moveTo(x - r * 0.7, y + r * 0.7); g.lineTo(x + r * 0.7, y - r * 0.7); g.stroke();
    }
    g.globalAlpha = 1;
  }

  private bloom(g: Ctx, x: number, y: number, r: number, color: string, a: number): void {
    if (a <= 0.01) return;
    g.globalAlpha = clamp(a, 0, 1);
    g.drawImage(glowTex(color), x - r, y - r, r * 2, r * 2);
  }

  private drawBeams(g: Ctx, minW: number): void {
    // dark soft backing under every beam (normal blend) so additive light still reads against the ground
    const add = g.globalCompositeOperation;
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const b of this.beams) {
      if (b.kind === 'ion' || b.kind === 'lightning') continue;
      const t = b.life / b.max;
      stroke(g, b.pts, '#05070a', Math.max(minW * 5, b.width * 5.5), 0.3 * Math.pow(t, 1.5));
    }
    g.globalCompositeOperation = add;
    const LG = this.lightGain, time = this.time;
    for (const b of this.beams) {
      const t = b.life / b.max;
      const fade = Math.pow(t, 1.4);
      const p = b.pts;
      const x1 = p[0], y1 = p[1], x2 = p[p.length - 2], y2 = p[p.length - 1];
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
      const flick = 0.86 + 0.28 * hash1(b.seed + ((time * 50) | 0));
      g.lineCap = 'round';
      g.lineJoin = 'round';
      switch (b.kind) {
        case 'laser':
        case 'sniper': {
          // a hard, thin line of light: narrow coloured sheath, white-hot core, small burn spot where it bites
          // focusing beams (ramp): the line swells, heats from red toward white and the burn spot grows as focus builds
          const rp = b.ramp ?? 0;
          const w = b.width * flick * (0.6 + 0.4 * t) * (1 + 1.3 * rp);
          const c = rp > 0 ? mixHex(b.color, '#ffb27a', rp * 0.75) : b.color;
          if (rp > 0.35) stroke(g, p, b.color, Math.max(minW * 6, w * 9), 0.12 * fade * rp);
          stroke(g, p, c, Math.max(minW * 3.2, w * 4.5), (0.16 + 0.14 * rp) * fade);
          stroke(g, p, c, Math.max(minW * 1.8, w * 1.9), 0.7 * fade);
          stroke(g, p, '#fff4ee', Math.max(minW * 0.9, w * (0.7 + 0.3 * rp)), fade);
          this.bloom(g, x1, y1, 0.08 + w * 2.5, '#ffffff', 0.7 * fade);
          this.bloom(g, x1, y1, 0.15 + w * 4, c, 0.35 * fade);
          this.bloom(g, x2, y2, 0.08 + w * 2.5, '#fff0d0', 0.85 * fade * flick);
          this.bloom(g, x2, y2, 0.2 + w * 5, c, (0.45 + 0.3 * rp) * fade);
          this.bloom(g, x2, y2, 0.45 + w * 8, c, (0.12 + 0.2 * rp) * fade * LG);
          break;
        }
        case 'plasma': {
          // a dense rope of ionised gas: violet sheath, white core, a slow churn of brighter knots along it
          const w = b.width * (0.7 + 0.3 * t) * (0.9 + 0.2 * hash1(b.seed + ((time * 40) | 0)));
          stroke(g, p, b.color, Math.max(minW * 3, w * 3), 0.2 * fade);
          stroke(g, p, b.color, Math.max(minW * 1.8, w * 1.5), 0.7 * fade);
          stroke(g, p, '#fff0ff', Math.max(minW * 0.9, w * 0.55), fade);
          if (len < 40 && this.busy < 0.7) {
            const nm = Math.min(6, Math.ceil(len * 0.8));
            for (let i = 0; i < nm; i++) {
              const f = (i + ((time * 3 + hash1(b.seed + i)) % 1)) / nm;
              this.bloom(g, x1 + (x2 - x1) * f, y1 + (y2 - y1) * f, w * 1.6, '#ffd8ff', 0.35 * fade);
            }
          }
          this.bloom(g, x1, y1, 0.1 + w * 2, '#ffffff', 0.6 * fade);
          this.bloom(g, x2, y2, 0.12 + w * 2.5, '#ffffff', 0.7 * fade);
          this.bloom(g, x2, y2, 0.3 + w * 4.5, b.color, 0.4 * fade);
          this.bloom(g, x2, y2, 0.6 + w * 6, b.color, 0.12 * fade * LG);
          break;
        }
        case 'heat': {
          // a shimmering rope of heat: white-yellow at the muzzle, orange then red with distance
          const n = 12;
          const pts: number[] = [];
          for (let i = 0; i <= n; i++) {
            const f = i / n;
            const wob = Math.sin(f * 16 + time * 40 + b.seed) * 0.035 * f;
            pts.push(x1 + (x2 - x1) * f + nx * wob, y1 + (y2 - y1) * f + ny * wob);
          }
          const w = b.width * flick;
          const gr = g.createLinearGradient(x1, y1, x2, y2);
          gr.addColorStop(0, rgba('#ffffe0', fade));
          gr.addColorStop(0.35, rgba('#ffb030', fade * 0.9));
          gr.addColorStop(1, rgba('#ff3a00', fade * 0.5));
          stroke(g, pts, '#ff2a00', Math.max(minW * 5, w * 7), 0.16 * fade);
          stroke(g, pts, '#ff6a1a', Math.max(minW * 3, w * 3.4), 0.3 * fade);
          strokeStyle(g, pts, gr, Math.max(minW, w * 1.3));
          stroke(g, [x1, y1, x1 + (x2 - x1) * 0.45, y1 + (y2 - y1) * 0.45], '#ffffff', Math.max(minW, w * 0.6), 0.9 * fade);
          // haze: faint distorted copies drifting beside the ray (heat shimmer)
          for (const sgn of [-1, 1]) {
            const sh = wavy(x1, y1, x2, y2, 14, 0.05 * sgn, time * 24 + b.seed * sgn);
            for (let i = 0; i < sh.length; i += 2) { sh[i] += nx * w * 3 * sgn; sh[i + 1] += ny * w * 3 * sgn; }
            stroke(g, sh, '#ffb060', Math.max(minW, w * 1.2), 0.1 * fade);
          }
          this.bloom(g, x1, y1, 0.2 + w * 5, '#fff0b0', 0.8 * fade);
          this.bloom(g, x1, y1, 0.4 + w * 8, '#ff7a20', 0.4 * fade);
          // the spot being burned: white-hot centre, orange halo, red glow on the ground that lingers a moment
          this.bloom(g, x2, y2, 0.18 + w * 5, '#fff4c0', 0.9 * fade * flick);
          this.bloom(g, x2, y2, 0.5 + w * 9, '#ff7a20', 0.7 * fade);
          this.bloom(g, x2, y2, 1.1 + w * 12, '#ff4010', 0.25 * fade * LG);
          break;
        }
        case 'slow': {
          const pts = wavy(x1, y1, x2, y2, 12, 0.06, time * 25 + b.seed);
          stroke(g, pts, '#8a00b0', Math.max(minW * 3, b.width * 4), 0.35 * fade);
          stroke(g, pts, b.color, Math.max(minW * 1.5, b.width * 1.6), 0.85 * fade);
          stroke(g, p, '#f0d8ff', Math.max(minW, b.width * 0.5), fade);
          this.bloom(g, x1, y1, 0.25, b.color, 0.5 * fade);
          this.bloom(g, x2, y2, 0.4, b.color, 0.6 * fade);
          break;
        }
        case 'repair': {
          const pts = wavy(x1, y1, x2, y2, 10, 0.05, time * 18 + b.seed);
          stroke(g, pts, b.color, Math.max(minW * 2, b.width * 3), 0.3 * fade);
          stroke(g, pts, '#d8ffe4', Math.max(minW, b.width), 0.9 * fade);
          this.bloom(g, x2, y2, 0.35, b.color, 0.5 * fade);
          break;
        }
        case 'scramble':
        case 'lightning': {
          this.drawBolt(g, b, minW, t, fade);
          break;
        }
        case 'gravity': {
          const pts = wavy(x1, y1, x2, y2, 14, 0.09, -time * 30 + b.seed);
          stroke(g, p, '#3a0066', Math.max(minW * 4, b.width * 5), 0.5 * fade);
          stroke(g, pts, b.color, Math.max(minW * 1.5, b.width * 1.4), 0.8 * fade);
          stroke(g, wavy(x1, y1, x2, y2, 14, -0.09, -time * 30 + b.seed), '#ff80ff', Math.max(minW, b.width * 0.6), 0.6 * fade);
          this.bloom(g, x2, y2, 0.6, '#b070ff', 0.4 * fade);
          break;
        }
        case 'rail': {
          // instant, hard, bright: a white-blue line that collapses fast
          const f2 = t * t;
          const w = b.width * (0.25 + 0.75 * f2);
          stroke(g, p, b.color, Math.max(minW * 3, w * 4), 0.2 * f2);
          stroke(g, p, mixHex(b.color, '#ffffff', 0.5), Math.max(minW * 1.6, w * 1.6), 0.75 * f2);
          stroke(g, p, '#ffffff', Math.max(minW * 0.9, w * 0.7), Math.min(1, f2 * 1.6));
          this.bloom(g, x1, y1, 0.15 + b.width * 2.5, '#ffffff', 0.8 * f2);
          this.bloom(g, x1, y1, 0.3 + b.width * 4, b.color, 0.4 * f2);
          this.bloom(g, x2, y2, 0.15 + b.width * 2.5, '#ffffff', 0.8 * f2);
          this.bloom(g, x2, y2, 0.35 + b.width * 4, b.color, 0.4 * f2);
          break;
        }
        case 'ion': {
          // fading ionised trail: soft glow, sparkling motes and thin rings of displaced air along the path
          const w = b.width;
          stroke(g, p, b.color, Math.max(minW * 3, w * 3), 0.1 * t);
          stroke(g, p, mixHex(b.color, '#ffffff', 0.4), Math.max(minW * 1.5, w * 1.2), 0.3 * t * t);
          const nm = Math.min(24, Math.ceil(len * 2.5));
          g.fillStyle = '#d8f6ff';
          for (let i = 0; i < nm; i++) {
            const h = hash1(b.seed + i * 17 + ((time * 18) | 0));
            if (h > 0.45) continue;
            const f = hash1(b.seed + i * 7) , o = (hash1(b.seed + i * 3 + ((time * 18) | 0)) - 0.5) * w * 4;
            const s = Math.max(minW, 0.018);
            g.globalAlpha = 0.7 * t;
            g.fillRect(x1 + (x2 - x1) * f + nx * o - s, y1 + (y2 - y1) * f + ny * o - s, s * 2, s * 2);
          }
          break;
        }
      }
    }
    g.globalAlpha = 1;
  }

  /** Branching lightning: a jagged main bolt re-randomised every few frames, forked side-branches, an ionised violet-blue
   *  halo around the path and flares where it touches. With reduced flashes it re-rolls slower with lower contrast. */
  private drawBolt(g: Ctx, b: Beam, minW: number, t: number, fade: number): void {
    const calm = this.flashK < 0.6;
    const p = b.pts;
    const step = (this.time * (calm ? 9 : 22)) | 0;
    if (!b.bolt || b.boltStep !== step) {
      b.boltStep = step;
      const main: number[] = [];
      const seed = b.seed + step * 7919;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const l = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
        const seg = jag(p[i], p[i + 1], p[i + 2], p[i + 3], Math.max(5, Math.min(14, Math.round(l * 6))), 0.15, seed + i * 31);
        for (let k = i === 0 ? 0 : 2; k < seg.length; k++) main.push(seg[k]);
      }
      const forks: number[][] = [];
      const nv = main.length / 2;
      const maxF = this.busy > 0.6 ? 2 : 5;
      for (let v = 2; v < nv - 1 && forks.length < maxF; v += 2 + ((hash1(seed + v) * 3) | 0)) {
        const x = main[v * 2], y = main[v * 2 + 1];
        const dx = main[v * 2 + 2] - main[v * 2 - 2], dy = main[v * 2 + 3] - main[v * 2 - 1];
        const base = Math.atan2(dy, dx) + (hash1(seed + v * 5) < 0.5 ? -1 : 1) * (0.5 + hash1(seed + v * 11) * 0.7);
        const L = 0.3 + hash1(seed + v * 13) * 0.55;
        const f = jag(x, y, x + Math.cos(base) * L, y + Math.sin(base) * L, 4, 0.22, seed + v);
        forks.push(f);
        if (hash1(seed + v * 17) < 0.35 && f.length >= 6) {
          const a2 = base + (hash1(seed + v * 19) - 0.5) * 1.6;
          forks.push(jag(f[4], f[5], f[4] + Math.cos(a2) * L * 0.5, f[5] + Math.sin(a2) * L * 0.5, 3, 0.25, seed + v * 3));
        }
      }
      b.bolt = main;
      b.forks = forks;
    }
    const main = b.bolt, forks = b.forks ?? [];
    const c = calm ? 0.8 : 1;
    const halo = mixHex(b.color, '#5a4cff', 0.65);
    // ionised air: a wide pale halo, then the coloured glow
    stroke(g, main, halo, Math.max(minW * 9, b.width * 20), 0.09 * fade * c);
    stroke(g, main, b.color, Math.max(minW * 4, b.width * 6.5), 0.3 * fade * c);
    for (const f of forks) stroke(g, f, b.color, Math.max(minW * 1.6, b.width * 1.3), 0.55 * fade * c);
    stroke(g, main, calm ? mixHex(b.color, '#ffffff', 0.75) : '#ffffff', Math.max(minW * 1.2, b.width * 1.2), fade * (calm ? 0.8 : 1));
    for (const f of forks) stroke(g, f, calm ? b.color : '#e8f0ff', Math.max(minW, b.width * 0.5), 0.6 * fade * c);
    // flares at the ends, ionisation glow around them
    for (let i = 0; i < p.length; i += 2) {
      const r = i === 0 ? 0.3 : 0.45;
      this.bloom(g, p[i], p[i + 1], r, '#ffffff', 0.35 * fade * c);
      this.bloom(g, p[i], p[i + 1], r * 2.2, halo, 0.28 * fade * c);
      if (i > 0) this.bloom(g, p[i], p[i + 1], r * 4, halo, 0.12 * fade * this.lightGain);
    }
  }
}

function stroke(g: Ctx, pts: number[], color: string, w: number, a: number): void {
  if (a <= 0.01) return;
  g.globalAlpha = clamp(a, 0, 1);
  g.strokeStyle = color;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.stroke();
}

function strokeStyle(g: Ctx, pts: number[], style: CanvasGradient, w: number): void {
  g.globalAlpha = 1;
  g.strokeStyle = style;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.stroke();
}

/** Deterministic jagged polyline (midpoint jitter) between two points. */
export function jag(x1: number, y1: number, x2: number, y2: number, n: number, amp: number, seed: number): number[] {
  const out = [x1, y1];
  const dx = x2 - x1, dy = y2 - y1;
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l, ny = dx / l;
  let s = (seed | 0) * 2654435761;
  for (let i = 1; i < n; i++) {
    s = (s ^ (s >>> 13)) * 1274126177;
    const r = ((s >>> 0) % 1000) / 1000 - 0.5;
    const f = i / n;
    const o = r * amp * Math.min(l, 3) * 2 * Math.sin(f * Math.PI);
    out.push(x1 + dx * f + nx * o, y1 + dy * f + ny * o);
  }
  out.push(x2, y2);
  return out;
}

function wavy(x1: number, y1: number, x2: number, y2: number, n: number, amp: number, phase: number): number[] {
  const out: number[] = [];
  const dx = x2 - x1, dy = y2 - y1;
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l, ny = dx / l;
  const waves = Math.max(1, l * 1.5);
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const o = Math.sin(f * waves * Math.PI * 2 + phase) * amp * Math.sin(f * Math.PI);
    out.push(x1 + dx * f + nx * o, y1 + dy * f + ny * o);
  }
  return out;
}
