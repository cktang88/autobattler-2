// Battlefield effects: particles, beams, lightning, explosions, ground decals and camera shake.
// Everything lives in world-cell coordinates; the owner (FieldView) sets the world transform before drawing.

import { MODULE_BY_ID } from '../../shared/parts.ts';
import type { ModuleDef, ModuleVisual } from '../../shared/types.ts';
import { clamp, ctx2d, makeCanvas, rgba, softDot, type Ctx } from './palette.ts';
import { tex, tinted } from './textures.ts';

export const modOf = (id: string | null | undefined): ModuleDef | undefined => (id ? MODULE_BY_ID.get(id) : undefined);
export const visualOf = (id: string | null | undefined): ModuleVisual | undefined => modOf(id)?.visual;

const SPARK = 0, SMOKE = 1, FIRE = 2, GLOW = 3, DEBRIS = 4, RING = 5, HEAL = 6, DUST = 7, EMBER = 8, STAR = 9, HEX = 10, BOLT = 11;

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
}

type BeamKind = 'laser' | 'plasma' | 'repair' | 'rail' | 'heat' | 'slow' | 'scramble' | 'gravity' | 'lightning' | 'sniper';
interface Beam {
  kind: BeamKind;
  pts: number[];
  life: number;
  max: number;
  color: string;
  width: number;
  seed: number;
}

interface Decal {
  kind: 'scorch' | 'crater' | 'wreck' | 'burn';
  x: number; y: number; r: number; a: number;
  img?: HTMLCanvasElement;
  ext?: number;
}

const MAX_P = 2600;
const rnd = Math.random;
const rr = (a: number, b: number) => a + (b - a) * rnd();

export class Fx {
  parts: Particle[] = [];
  beams: Beam[] = [];
  private later: { t: number; fn: () => void }[] = [];
  trauma = 0;
  time = 0;
  // decals
  decals: Decal[] = [];
  decalCanvas: HTMLCanvasElement | null = null;
  private decalPx = 0;
  private fieldW = 0;
  private fieldH = 0;

  clear(): void {
    this.parts.length = 0;
    this.beams.length = 0;
    this.later.length = 0;
    this.decals.length = 0;
    this.trauma = 0;
    if (this.decalCanvas) ctx2d(this.decalCanvas).clearRect(0, 0, this.decalCanvas.width, this.decalCanvas.height);
  }

  /** load factor 0..1: shed optional particles when busy */
  get busy(): number {
    return this.parts.length / MAX_P;
  }

  private add(k: number, x: number, y: number, o: Partial<Particle>): void {
    if (this.parts.length >= MAX_P) return;
    this.parts.push({
      k, x, y, z: o.z ?? 0, vx: o.vx ?? 0, vy: o.vy ?? 0, vz: o.vz ?? 0,
      life: o.max ?? 0.5, max: o.max ?? 0.5, size: o.size ?? 0.2, grow: o.grow ?? 0,
      color: o.color ?? '#ffffff', rot: o.rot ?? rnd() * 6.28, vr: o.vr ?? 0, drag: o.drag ?? 0, alpha: o.alpha ?? 1,
    });
  }

  schedule(delay: number, fn: () => void): void {
    this.later.push({ t: this.time + delay, fn });
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /* ---------------------------------------------------------------------------------------- spawners */

  sparks(x: number, y: number, n: number, color: string, speed = 4, ang?: number, spread = Math.PI, life = 0.25): void {
    n = Math.round(n * (this.busy > 0.6 ? 0.4 : 1));
    for (let i = 0; i < n; i++) {
      const a = ang === undefined ? rnd() * Math.PI * 2 : ang + rr(-spread, spread);
      const v = speed * rr(0.35, 1);
      this.add(SPARK, x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: life * rr(0.6, 1.2), size: rr(0.02, 0.045), color, drag: 3 });
    }
  }

  glow(x: number, y: number, r: number, color: string, life = 0.12, alpha = 1): void {
    this.add(GLOW, x, y, { size: r, max: life, color, alpha });
  }

  star(x: number, y: number, r: number, color: string, ang: number, life = 0.07): void {
    this.add(STAR, x, y, { size: r, max: life, color, rot: ang, alpha: 1 });
  }

  smoke(x: number, y: number, r: number, life = 1.2, color = '#2a2622', vx = 0, vy = 0, alpha = 0.5): void {
    if (this.busy > 0.8 && rnd() < 0.5) return;
    this.add(SMOKE, x, y, { size: r, grow: r * 1.4, max: life * rr(0.8, 1.2), color, vx: vx + rr(-0.15, 0.15), vy: vy + rr(-0.15, 0.15), drag: 1.2, alpha, vr: rr(-0.6, 0.6) });
  }

  dust(x: number, y: number, r: number, n = 3, life = 0.8): void {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, v = rr(0.3, 1.2) * r;
      this.add(DUST, x, y, { size: r * rr(0.4, 0.8), grow: r * 1.2, max: life * rr(0.7, 1.2), vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 3, color: '#8a7a62', alpha: 0.45 });
    }
  }

  fire(x: number, y: number, r: number, life = 0.45, vx = 0, vy = 0): void {
    this.add(FIRE, x, y, { size: r, grow: r * 0.6, max: life * rr(0.7, 1.2), vx, vy, drag: 2.5, color: '#ff9a40', vr: rr(-2, 2) });
  }

  ring(x: number, y: number, r0: number, r1: number, color: string, life = 0.35, alpha = 0.8): void {
    this.add(RING, x, y, { size: r0, grow: (r1 - r0) / life, max: life, color, alpha });
  }

  debris(x: number, y: number, n: number, color: string, speed = 3, size = 0.08): void {
    n = Math.round(n * (this.busy > 0.6 ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, v = speed * rr(0.3, 1);
      this.add(DEBRIS, x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rr(2, 5), z: 0.1, max: rr(0.9, 1.6), size: size * rr(0.5, 1.4), color, vr: rr(-12, 12), drag: 0.8 });
    }
  }

  embers(x: number, y: number, n: number, r: number): void {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, v = rr(0.5, 2.5) * r;
      this.add(EMBER, x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: rr(0.5, 1.2), size: rr(0.03, 0.06), color: '#ffb050', drag: 1.5 });
    }
  }

  heal(x: number, y: number): void {
    for (let i = 0; i < 2; i++) this.add(HEAL, x + rr(-0.3, 0.3), y + rr(-0.3, 0.3), { vy: -0.5, max: 0.8, size: rr(0.08, 0.13), color: '#6dff9a' });
  }

  hex(x: number, y: number, r: number, hx: number, hy: number): void {
    this.add(HEX, x, y, { size: r, max: 0.45, color: '#7fd8ff', vx: hx, vy: hy, alpha: 1 });
  }

  bolt(x: number, y: number, r: number, color: string, life = 0.25): void {
    this.add(BOLT, x, y, { size: r, max: life, color, vr: rr(-3, 3) });
  }

  beam(kind: BeamKind, pts: number[], color: string, width: number, life: number): void {
    if (this.beams.length > 400) this.beams.shift();
    this.beams.push({ kind, pts, life, max: life, color, width, seed: (rnd() * 1e6) | 0 });
  }

  /** A sized explosion. style picks colours/shape. */
  boom(x: number, y: number, r: number, style: 'fire' | 'flak' | 'emp' | 'plasma' | 'sonic' | 'napalm' | 'small' | 'big' = 'fire', ground = true): void {
    r = Math.max(0.15, r);
    const q = this.busy > 0.6 ? 0.5 : 1;
    if (style === 'emp') {
      this.glow(x, y, r * 1.8, '#9fd0ff', 0.25);
      this.ring(x, y, r * 0.2, r * 1.3, '#a8d8ff', 0.35);
      for (let i = 0; i < 3; i++) this.bolt(x + rr(-r, r) * 0.5, y + rr(-r, r) * 0.5, r * rr(0.7, 1.1), '#bfe4ff', rr(0.2, 0.4));
      this.sparks(x, y, 12 * q, '#cfe9ff', 5 * r);
      return;
    }
    if (style === 'plasma') {
      this.glow(x, y, r * 2, '#e070ff', 0.3);
      this.glow(x, y, r * 0.9, '#ffffff', 0.12);
      this.ring(x, y, r * 0.2, r * 1.4, '#e070ff', 0.3);
      this.sparks(x, y, 14 * q, '#f0a0ff', 5 * r);
      for (let i = 0; i < 3; i++) this.smoke(x, y, r * 0.5, 1, '#2a1830');
      if (ground) this.decal('scorch', x, y, r * 0.7);
      return;
    }
    if (style === 'sonic') {
      this.ring(x, y, r * 0.2, r * 1.6, '#5ec8ff', 0.3, 0.9);
      this.ring(x, y, r * 0.1, r * 1.1, '#bfefff', 0.22, 0.7);
      this.dust(x, y, r * 0.8, 5);
      return;
    }
    if (style === 'flak') {
      this.glow(x, y, r * 1.1, '#ffd080', 0.12);
      this.star(x, y, r * 0.9, '#ffe0a0', rnd() * 6, 0.1);
      this.sparks(x, y, 18 * q, '#ffb333', 4 * r, undefined, Math.PI, 0.25);
      for (let i = 0; i < 3; i++) this.smoke(x + rr(-0.2, 0.2) * r, y + rr(-0.2, 0.2) * r, r * 0.45, 1.2, '#3a2c22', 0, 0, 0.55);
      return;
    }
    // fire family
    const big = style === 'big' || r > 1.4;
    this.glow(x, y, r * 2.4, '#ffb060', 0.18, 0.9);
    this.glow(x, y, r * 1.0, '#fff4d0', 0.16);
    this.glow(x, y, r * 0.5, '#ffffff', 0.1);
    const nf = Math.round((4 + r * 5) * q);
    for (let i = 0; i < nf; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * r * 0.5, v = rr(0.5, 1.6) * r;
      this.fire(x + Math.cos(a) * d, y + Math.sin(a) * d, r * rr(0.4, 0.75), rr(0.35, 0.6) * (big ? 1.4 : 1), Math.cos(a) * v, Math.sin(a) * v);
    }
    this.sparks(x, y, (8 + r * 8) * q, '#ffcf70', 6 * Math.sqrt(r), undefined, Math.PI, 0.35);
    if (r >= 0.5) this.ring(x, y, r * 0.3, r * 1.7, '#ffd8a0', 0.3, 0.55);
    const ns = Math.round((2 + r * 3) * q);
    for (let i = 0; i < ns; i++) this.smoke(x + rr(-0.4, 0.4) * r, y + rr(-0.4, 0.4) * r, r * rr(0.4, 0.7), rr(1.2, 2.2) * (big ? 1.4 : 1), '#24201c', 0, 0, 0.55);
    if (style === 'napalm') {
      this.embers(x, y, 8 * q, r);
      for (let i = 0; i < 3; i++) this.schedule(0.15 + i * 0.25, () => { for (let k = 0; k < 3; k++) this.fire(x + rr(-0.6, 0.6) * r, y + rr(-0.6, 0.6) * r, r * 0.35, 0.6); });
    }
    if (ground) {
      this.dust(x, y, r * 0.7, 3);
      this.decal(r > 0.7 ? 'crater' : 'scorch', x, y, r * 0.75);
      if (style === 'napalm') this.decal('burn', x, y, r * 0.9);
    }
    if (big) this.debris(x, y, Math.round(r * 3), '#2a2622', 3 * r, 0.06);
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
    if (d.kind === 'burn') {
      const t = tinted('burn', '#3a1a08');
      g.globalAlpha = 0.5;
      if (t) g.drawImage(t, d.x - r, d.y - r, r * 2, r * 2);
      g.globalAlpha = 1;
      return;
    }
    const gr = g.createRadialGradient(d.x, d.y, 0, d.x, d.y, r * 1.3);
    gr.addColorStop(0, d.kind === 'crater' ? 'rgba(8,7,6,0.6)' : 'rgba(10,9,8,0.45)');
    gr.addColorStop(0.5, 'rgba(14,12,10,0.3)');
    gr.addColorStop(1, 'rgba(14,12,10,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(d.x, d.y, r * 1.3, 0, Math.PI * 2);
    g.fill();
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
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const P = this.parts;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.life -= dt;
      if (p.life <= 0) {
        P[i] = P[P.length - 1];
        P.pop();
        continue;
      }
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr;
      p.vy *= dr;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.size += p.grow * dt;
      if (p.k === DEBRIS) {
        p.vz -= 14 * dt;
        p.z += p.vz * dt;
        if (p.z <= 0) {
          p.z = 0;
          if (p.vz < -1.5) p.vz = -p.vz * 0.3;
          else { p.vz = 0; p.vx *= 0.8; p.vy *= 0.8; p.vr *= 0.8; }
        }
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
    const minW = 1 / px;
    // normal-blend pass: dust, smoke, debris
    for (const p of this.parts) {
      const t = p.life / p.max;
      if (p.k === DUST || p.k === SMOKE) {
        const a = p.alpha * Math.min(1, t * 1.6) * (p.k === SMOKE ? Math.min(1, (1 - t) * 6 + 0.3) : 1);
        g.globalAlpha = clamp(a, 0, 1);
        const img = p.k === SMOKE ? tinted('smoke', p.color) ?? softDot(rgba(p.color, 0.8)) : softDot(rgba(p.color, 0.7));
        const s = p.size;
        if (p.k === SMOKE) {
          const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
          const tr = g.getTransform();
          g.transform(cs, sn, -sn, cs, p.x, p.y);
          g.drawImage(img, -s, -s, s * 2, s * 2);
          g.setTransform(tr);
        } else g.drawImage(img, p.x - s, p.y - s, s * 2, s * 2);
      } else if (p.k === DEBRIS) {
        g.globalAlpha = Math.min(1, t * 3);
        const x = p.x + liftX * p.z, y = p.y + liftY * p.z;
        const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
        const tr = g.getTransform();
        g.transform(cs, sn, -sn, cs, x, y);
        g.fillStyle = p.color;
        g.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2);
        g.setTransform(tr);
      }
    }
    g.globalAlpha = 1;
    // additive pass
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    this.drawBeams(g, minW);
    for (const p of this.parts) {
      const t = p.life / p.max;
      switch (p.k) {
        case SPARK: {
          g.globalAlpha = Math.min(1, t * 2);
          g.strokeStyle = p.color;
          g.lineWidth = Math.max(minW, p.size);
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
          g.stroke();
          break;
        }
        case FIRE: {
          const a = t > 0.8 ? (1 - t) * 5 : t * 1.25;
          g.globalAlpha = clamp(a, 0, 1);
          const img = tex('fireball') ?? softDot('rgba(255,140,50,0.9)');
          const s = p.size;
          const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
          const tr = g.getTransform();
          g.transform(cs, sn, -sn, cs, p.x, p.y);
          g.drawImage(img, -s, -s, s * 2, s * 2);
          g.setTransform(tr);
          break;
        }
        case GLOW: {
          g.globalAlpha = p.alpha * t * t;
          const s = p.size;
          g.drawImage(softDot(p.color), p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
        case STAR: {
          g.globalAlpha = t;
          const img = tinted('spark', p.color);
          const s = p.size;
          if (img) {
            const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
            const tr = g.getTransform();
            g.transform(cs, sn, -sn, cs, p.x, p.y);
            g.drawImage(img, -s, -s, s * 2, s * 2);
            g.setTransform(tr);
          } else g.drawImage(softDot(p.color, 0.2), p.x - s * 0.6, p.y - s * 0.6, s * 1.2, s * 1.2);
          break;
        }
        case RING: {
          g.globalAlpha = p.alpha * t;
          const img = tinted('shockwave', p.color);
          const s = p.size;
          if (img) g.drawImage(img, p.x - s, p.y - s, s * 2, s * 2);
          else {
            g.strokeStyle = p.color;
            g.lineWidth = Math.max(minW, s * 0.08);
            g.beginPath();
            g.arc(p.x, p.y, s * 0.9, 0, Math.PI * 2);
            g.stroke();
          }
          break;
        }
        case EMBER: {
          g.globalAlpha = t;
          const s = p.size * 2;
          g.drawImage(softDot(p.color, 0.3), p.x - s, p.y - s, s * 2, s * 2);
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
          g.globalAlpha = t * 0.9;
          const img = tinted('hex', p.color);
          const s = p.size;
          g.save();
          g.beginPath();
          g.arc(p.x, p.y, s, 0, Math.PI * 2);
          g.clip();
          if (img) g.drawImage(img, p.x - s, p.y - s, s * 2, s * 2);
          // ripple toward the hit point (vx, vy hold the hit position)
          const gr = g.createRadialGradient(p.vx, p.vy, 0, p.vx, p.vy, s * (1.4 - t));
          gr.addColorStop(0, rgba('#bfefff', 0.8));
          gr.addColorStop(1, rgba('#7fd8ff', 0));
          g.fillStyle = gr;
          g.fillRect(p.x - s, p.y - s, s * 2, s * 2);
          g.restore();
          g.strokeStyle = rgba('#9fe4ff', 0.7);
          g.lineWidth = Math.max(minW, s * 0.04);
          g.beginPath();
          g.arc(p.x, p.y, s, 0, Math.PI * 2);
          g.stroke();
          break;
        }
        case BOLT: {
          g.globalAlpha = t;
          const img = tex('wbolt');
          const s = p.size;
          if (img) {
            const cs = Math.cos(p.rot + (((this.time * 20) | 0) % 4) * 1.57), sn = Math.sin(p.rot + (((this.time * 20) | 0) % 4) * 1.57);
            const tr = g.getTransform();
            g.transform(cs, sn, -sn, cs, p.x, p.y);
            g.drawImage(tinted('wbolt', p.color) ?? img, -s, -s, s * 2, s * 2);
            g.setTransform(tr);
          }
          break;
        }
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = prev;
  }

  private drawBeams(g: Ctx, minW: number): void {
    // dark soft backing under every beam (normal blend) so additive light still reads against the ground
    const add = g.globalCompositeOperation;
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const b of this.beams) {
      const t = b.life / b.max;
      stroke(g, b.pts, '#05070a', Math.max(minW * 5, b.width * 5.5), 0.42 * Math.pow(t, 1.5));
    }
    g.globalCompositeOperation = add;
    for (const b of this.beams) {
      const t = b.life / b.max;
      const fade = Math.pow(t, 1.5);
      const p = b.pts;
      const x1 = p[0], y1 = p[1], x2 = p[p.length - 2], y2 = p[p.length - 1];
      g.lineCap = 'round';
      g.lineJoin = 'round';
      switch (b.kind) {
        case 'laser':
        case 'sniper': {
          stroke(g, p, b.color, Math.max(minW * 3, b.width * 3 * (0.5 + 0.5 * t)), 0.35 * fade);
          stroke(g, p, '#ffffff', Math.max(minW, b.width * (0.5 + 0.5 * t)), fade);
          break;
        }
        case 'plasma': {
          const w = b.width * (0.6 + 0.4 * t);
          stroke(g, p, b.color, Math.max(minW * 4, w * 4), 0.25 * fade);
          stroke(g, p, b.color, Math.max(minW * 2, w * 1.8), 0.7 * fade);
          stroke(g, p, '#ffe8ff', Math.max(minW, w * 0.6), fade);
          break;
        }
        case 'heat': {
          // shimmering rope that fades with distance
          const n = 10;
          const pts: number[] = [];
          for (let i = 0; i <= n; i++) {
            const f = i / n;
            const wob = Math.sin(f * 14 + this.time * 40 + b.seed) * 0.04 * f;
            const nx = -(y2 - y1), ny = x2 - x1, l = Math.hypot(nx, ny) || 1;
            pts.push(x1 + (x2 - x1) * f + (nx / l) * wob, y1 + (y2 - y1) * f + (ny / l) * wob);
          }
          const gr = g.createLinearGradient(x1, y1, x2, y2);
          gr.addColorStop(0, rgba('#ffff60', fade));
          gr.addColorStop(0.5, rgba('#ff6a1a', fade * 0.8));
          gr.addColorStop(1, rgba('#ff1a00', fade * 0.25));
          stroke(g, pts, '#ff3a00', Math.max(minW * 3, b.width * 3.5), 0.22 * fade);
          strokeStyle(g, pts, gr, Math.max(minW, b.width * 1.2));
          break;
        }
        case 'slow': {
          const pts = wavy(x1, y1, x2, y2, 12, 0.06, this.time * 25 + b.seed);
          stroke(g, pts, '#8a00b0', Math.max(minW * 3, b.width * 4), 0.35 * fade);
          stroke(g, pts, b.color, Math.max(minW * 1.5, b.width * 1.6), 0.85 * fade);
          stroke(g, p, '#f0d8ff', Math.max(minW, b.width * 0.5), fade);
          break;
        }
        case 'repair': {
          const pts = wavy(x1, y1, x2, y2, 10, 0.05, this.time * 18 + b.seed);
          stroke(g, pts, b.color, Math.max(minW * 2, b.width * 3), 0.3 * fade);
          stroke(g, pts, '#d8ffe4', Math.max(minW, b.width), 0.9 * fade);
          break;
        }
        case 'scramble': {
          const pts = jag(x1, y1, x2, y2, 9, 0.12, b.seed + ((this.time * 30) | 0));
          stroke(g, pts, b.color, Math.max(minW * 2.5, b.width * 3), 0.35 * fade);
          stroke(g, pts, '#ffffff', Math.max(minW, b.width * 0.8), fade);
          break;
        }
        case 'gravity': {
          const pts = wavy(x1, y1, x2, y2, 14, 0.09, -this.time * 30 + b.seed);
          stroke(g, p, '#3a0066', Math.max(minW * 4, b.width * 5), 0.5 * fade);
          stroke(g, pts, b.color, Math.max(minW * 1.5, b.width * 1.4), 0.8 * fade);
          stroke(g, wavy(x1, y1, x2, y2, 14, -0.09, -this.time * 30 + b.seed), '#ff80ff', Math.max(minW, b.width * 0.6), 0.6 * fade);
          break;
        }
        case 'rail': {
          const w = b.width * (0.3 + 0.7 * t);
          stroke(g, p, b.color, Math.max(minW * 5, w * 6), 0.25 * fade);
          stroke(g, p, b.color, Math.max(minW * 2, w * 2), 0.6 * fade);
          stroke(g, p, '#ffffff', Math.max(minW, w * 0.8), fade);
          // helix
          const n = Math.max(6, Math.round(Math.hypot(x2 - x1, y2 - y1) * 3));
          const nx = -(y2 - y1), ny = x2 - x1, l = Math.hypot(nx, ny) || 1;
          g.fillStyle = b.color;
          g.globalAlpha = fade * 0.8;
          for (let i = 0; i < n; i++) {
            const f = i / n;
            const o = Math.sin(f * n * 1.3 + b.seed) * 0.12 * (1.5 - t);
            const s = Math.max(minW, 0.03);
            g.fillRect(x1 + (x2 - x1) * f + (nx / l) * o - s, y1 + (y2 - y1) * f + (ny / l) * o - s, s * 2, s * 2);
          }
          g.globalAlpha = 1;
          break;
        }
        case 'lightning': {
          const pts: number[] = [];
          const reseed = b.seed + ((this.time * 30) | 0);
          for (let i = 0; i + 3 < p.length; i += 2) {
            const seg = jag(p[i], p[i + 1], p[i + 2], p[i + 3], 8, 0.16, reseed + i * 31);
            for (let k = i === 0 ? 0 : 2; k < seg.length; k++) pts.push(seg[k]);
          }
          stroke(g, pts, b.color, Math.max(minW * 3, b.width * 4), 0.35 * fade);
          stroke(g, pts, '#ffffff', Math.max(minW, b.width), fade);
          // forks
          if (t > 0.4) {
            for (let i = 4; i + 1 < pts.length; i += 6) {
              const a = (reseed * 0.37 + i) % 6.28;
              const fx = pts[i] + Math.cos(a) * 0.35, fy = pts[i + 1] + Math.sin(a) * 0.35;
              stroke(g, jag(pts[i], pts[i + 1], fx, fy, 3, 0.2, reseed + i), b.color, Math.max(minW, b.width * 0.6), 0.7 * fade);
            }
          }
          break;
        }
      }
    }
    g.globalAlpha = 1;
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
