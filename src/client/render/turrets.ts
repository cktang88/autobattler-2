// Turret / module art. One drawing per ModuleVisual family, varied by `barrels` and `caliber`.
// Drawn in turret-local cell units: pivot at origin, barrels pointing +x. `d` = turret base diameter (cells).

import type { ModuleDef, ModuleVisual } from '../../shared/types.ts';
import { METAL, OUTLINE, shade, rgba, roundRect, type Ctx, type TeamPal } from './palette.ts';

/** Glow colour used by a weapon family (beams, lenses, projectiles). null = use team glow. */
export function visualGlow(v: ModuleVisual | undefined, pal: TeamPal): string {
  switch (v) {
    case 'laser': return pal.glow;
    case 'heatray': return '#ff7a2a';
    case 'plasma': return '#e070ff';
    case 'rail': case 'gauss': return '#9fe8ff';
    case 'tesla': case 'emp': return '#a8d8ff';
    case 'slowbeam': return '#b47cff';
    case 'repair': return '#6dff9a';
    case 'shield': return '#7fd8ff';
    case 'flamer': return '#ffa040';
    case 'sonic': return '#5ec8ff';
    case 'gravity': return '#b070ff';
    case 'blade': return pal.glow;
    case 'pointdef': return '#ff6060';
    case 'prod': return '#a8d8ff';
    default: return '#ffd27a';
  }
}

/** Per-module glow colour (id overrides on top of the visual family). */
export function moduleGlow(m: ModuleDef | undefined, pal: TeamPal): string {
  switch (m?.id) {
    case 'laser': return '#ff4058';
    case 'twinlaser': return '#ff5ab0';
    case 'disarm': return '#ffe84a';
    case 'empcannon': return '#5aa0ff';
    case 'stungun': return '#cfeaff';
    case 'plasmaorb': return '#ff60e0';
    case 'pointdef': return '#ff6060';
  }
  return visualGlow(m?.visual, pal);
}

/** Distance from pivot to the muzzle, as a multiple of d (for muzzle flashes / beam origins). */
export function muzzleLen(m: ModuleDef | undefined): number {
  if (!m) return 0.8;
  const c = m.caliber ?? 0.5;
  switch (m.visual) {
    case 'gun': return 0.95 + c * 0.45;
    case 'gatling': return 1.05;
    case 'shotgun': return 0.9;
    case 'cannon': return 1.25;
    case 'gauss': return 1.3;
    case 'sniper': return 1.45;
    case 'rail': return 1.4;
    case 'artillery': return (m.barrels ?? 1) > 1 ? 1.2 : 1.5;
    case 'laser': return 0.95;
    case 'heatray': return 0.6;
    case 'plasma': return 1.1;
    case 'flamer': return 0.85;
    case 'tesla': return 0.25;
    case 'emp': return 0.75;
    case 'slowbeam': return 0.7;
    case 'flak': return 0.95;
    case 'repair': return 0.6;
    case 'mortar': return 0.25;
    case 'sonic': return 1.3;
    case 'saw': return 1.3;
    case 'chainsaw': return 2.0;
    case 'hammer': return 1.5;
    case 'claw': return 1.6;
    case 'blade': return 2.0;
    case 'drill': return 1.9;
    case 'prod': return 1.85;
    case 'ram': return 1.2;
    case 'pointdef': return 0.7;
    case 'gravity': return 1.1;
    case 'rocketPod': case 'missileRack': case 'cruise': return 0.6;
    default: return 0.6;
  }
}

/** Half-extent of the turret sprite, as a multiple of d. */
export const TURRET_EXT = 1.75;

type Fill = string | CanvasGradient;
const lw = (g: Ctx, w: number) => { g.lineWidth = w; };

function shape(g: Ctx, fill: Fill, outline: number, path: () => void): void {
  g.beginPath();
  path();
  g.fillStyle = fill;
  g.fill();
  if (outline > 0) {
    lw(g, outline);
    g.strokeStyle = OUTLINE;
    g.stroke();
  }
}

/** A barrel from x0 to x1 at lateral offset y, width w. Metallic with a highlight line. */
function barrel(g: Ctx, x0: number, x1: number, y: number, w: number, o: number, color = METAL.base): void {
  shape(g, color, o, () => roundRect(g, x0, y - w / 2, x1 - x0, w, w * 0.3));
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.fillRect(x0 + w * 0.3, y - w * 0.32, (x1 - x0) - w * 0.6, w * 0.22);
}

function muzzle(g: Ctx, x: number, y: number, w: number, len: number, o: number): void {
  shape(g, METAL.dark, o, () => roundRect(g, x - len, y - w / 2, len, w, w * 0.2));
}

function teamGrad(g: Ctx, pal: TeamPal, r: number): CanvasGradient {
  const gr = g.createLinearGradient(-r, -r, r, r);
  gr.addColorStop(0, shade(pal.light, 0.3));
  gr.addColorStop(0.5, shade(pal.light, -0.05));
  gr.addColorStop(1, shade(pal.body, -0.1));
  return gr;
}

function metalGrad(g: Ctx, r: number, base = METAL.base): CanvasGradient {
  const gr = g.createLinearGradient(-r, -r, r, r);
  gr.addColorStop(0, shade(base, 0.35));
  gr.addColorStop(0.6, base);
  gr.addColorStop(1, shade(base, -0.45));
  return gr;
}

function hatch(g: Ctx, x: number, y: number, r: number, o: number): void {
  shape(g, METAL.dark, o * 0.6, () => g.arc(x, y, r, 0, Math.PI * 2));
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.beginPath();
  g.arc(x - r * 0.25, y - r * 0.25, r * 0.45, 0, Math.PI * 2);
  g.fill();
}

function glowDot(g: Ctx, x: number, y: number, r: number, color: string): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, r * 2.4);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(0.25, color);
  gr.addColorStop(1, rgba(color.length === 7 ? color : '#ffffff', 0));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r * 2.4, 0, Math.PI * 2);
  g.fill();
}

function rivets(g: Ctx, pts: number[], r: number): void {
  g.fillStyle = 'rgba(0,0,0,0.45)';
  for (let i = 0; i < pts.length; i += 2) {
    g.beginPath();
    g.arc(pts[i], pts[i + 1], r, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(255,255,255,0.25)';
  for (let i = 0; i < pts.length; i += 2) {
    g.beginPath();
    g.arc(pts[i] - r * 0.3, pts[i + 1] - r * 0.3, r * 0.5, 0, Math.PI * 2);
    g.fill();
  }
}

function joint(g: Ctx, x: number, y: number, r: number, o: number): void {
  shape(g, METAL.dark, o * 0.6, () => g.arc(x, y, r, 0, Math.PI * 2));
}

function vents2(g: Ctx, x: number, y: number, w: number, h: number, n: number, o: number): void {
  shape(g, 'rgba(0,0,0,0.5)', 0, () => roundRect(g, x - w / 2, y - h / 2, w, h, w * 0.1));
  g.strokeStyle = 'rgba(255,255,255,0.2)'; lw(g, o * 0.4);
  g.beginPath(); for (let i = 1; i < n; i++) { const yy = y - h / 2 + (h * i) / n; g.moveTo(x - w * 0.4, yy); g.lineTo(x + w * 0.4, yy); } g.stroke();
}


/* ------------------------------------------------------------------------------------ per-id overrides */

function housing(g: Ctx, pal: TeamPal, x: number, y: number, w: number, h: number, rad: number, o: number): void {
  shape(g, teamGrad(g, pal, Math.max(w, h) / 2), o, () => roundRect(g, x, y, w, h, rad));
}

function drum(g: Ctx, x: number, y: number, r: number, o: number): void {
  shape(g, METAL.dark, o, () => g.arc(x, y, r, 0, Math.PI * 2));
  g.strokeStyle = 'rgba(255,255,255,0.25)'; lw(g, r * 0.15);
  g.beginPath(); g.arc(x, y, r * 0.6, 0, Math.PI * 2); g.stroke();
}

function lyingMissile(g: Ctx, x: number, y: number, len: number, w: number, nose: string, o: number): void {
  shape(g, '#e4e2da', o * 0.5, () => roundRect(g, x, y - w / 2, len, w, w / 2));
  g.fillStyle = nose;
  g.beginPath(); g.moveTo(x + len, y); g.lineTo(x + len - w * 1.2, y - w / 2); g.lineTo(x + len - w * 1.2, y + w / 2); g.closePath(); g.fill();
  g.fillStyle = '#8b8b84';
  g.beginPath(); g.moveTo(x, y - w * 0.95); g.lineTo(x + w * 0.9, y - w * 0.4); g.lineTo(x + w * 0.9, y + w * 0.4); g.lineTo(x, y + w * 0.95); g.closePath(); g.fill();
}

function cellGrid(g: Ctx, pal: TeamPal, cols: number, rows: number, cell: number, o: number, lid: string): void {
  const w = cols * cell, h = rows * cell, x0 = -w / 2 + cell * 0.2;
  housing(g, pal, x0 - cell * 0.18, -h / 2 - cell * 0.18, w + cell * 0.36, h + cell * 0.36, cell * 0.25, o);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const cx = x0 + j * cell, cy = -h / 2 + i * cell;
    shape(g, METAL.dark, o * 0.4, () => roundRect(g, cx + cell * 0.08, cy + cell * 0.08, cell * 0.84, cell * 0.84, cell * 0.12));
    shape(g, lid, 0, () => roundRect(g, cx + cell * 0.22, cy + cell * 0.22, cell * 0.56, cell * 0.56, cell * 0.1));
  }
}

function hazard(g: Ctx, x: number, y: number, w: number, h: number): void {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = '#f0c020'; g.fillRect(x, y, w, h);
  g.strokeStyle = '#151515'; lw(g, Math.min(w, h) * 0.22);
  g.beginPath();
  for (let i = -6; i < 12; i++) { const xx = x + i * Math.min(w, h) * 0.45; g.moveTo(xx, y + h); g.lineTo(xx + h, y); }
  g.stroke();
  g.restore();
}

function drawSpecial(g: Ctx, m: ModuleDef, pal: TeamPal, r: number, o: number, glow: string): boolean {
  switch (m.id) {
    case 'mg': {
      barrel(g, 0, r * 1.75, 0, r * 0.13, o);
      shape(g, METAL.dark, o * 0.5, () => roundRect(g, r * 1.55, -r * 0.1, r * 0.22, r * 0.2, r * 0.05));
      housing(g, pal, -r * 0.7, -r * 0.5, r * 1.15, r * 1.0, r * 0.3, o);
      shape(g, METAL.dark, o * 0.5, () => roundRect(g, -r * 0.45, r * 0.5, r * 0.5, r * 0.3, r * 0.06));
      return true;
    }
    case 'twinmg': {
      for (const y of [-0.24, 0.24]) barrel(g, 0, r * 1.75, y * r, r * 0.13, o);
      housing(g, pal, -r * 0.75, -r * 0.62, r * 1.25, r * 1.24, r * 0.3, o);
      shape(g, METAL.dark, o * 0.5, () => roundRect(g, r * 0.3, -r * 0.4, r * 0.2, r * 0.8, r * 0.05));
      return true;
    }
    case 'hmg': {
      barrel(g, 0, r * 1.95, 0, r * 0.24, o);
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 1.75, -r * 0.2, r * 0.32, r * 0.4, r * 0.06));
      g.fillStyle = METAL.deep; g.fillRect(r * 1.82, -r * 0.2, r * 0.05, r * 0.4); g.fillRect(r * 1.95, -r * 0.2, r * 0.05, r * 0.4);
      shape(g, METAL.base, o * 0.6, () => roundRect(g, r * 0.6, -r * 0.18, r * 0.5, r * 0.36, r * 0.08));
      housing(g, pal, -r * 0.8, -r * 0.6, r * 1.4, r * 1.2, r * 0.25, o);
      shape(g, '#4a5a3a', o * 0.6, () => roundRect(g, -r * 0.55, r * 0.35, r * 0.75, r * 0.55, r * 0.06));
      g.fillStyle = '#c9a040'; for (let i = 0; i < 4; i++) g.fillRect(-r * 0.45 + i * r * 0.16, r * 0.25, r * 0.08, r * 0.14);
      return true;
    }
    case 'ac20': {
      barrel(g, 0, r * 1.35, 0, r * 0.3, o);
      muzzle(g, r * 1.5, 0, r * 0.38, r * 0.22, o * 0.6);
      housing(g, pal, -r * 0.8, -r * 0.65, r * 1.35, r * 1.3, r * 0.35, o);
      drum(g, -r * 0.2, r * 0.0, r * 0.42, o);
      return true;
    }
    case 'autocannon': {
      barrel(g, 0, r * 2.05, 0, r * 0.26, o);
      // slotted flash hider
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 1.85, -r * 0.2, r * 0.42, r * 0.4, r * 0.08));
      g.fillStyle = METAL.deep; for (let i = 0; i < 3; i++) g.fillRect(r * (1.92 + i * 0.11), -r * 0.2, r * 0.04, r * 0.4);
      housing(g, pal, -r * 0.9, -r * 0.75, r * 1.65, r * 1.5, r * 0.3, o);
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.5, -r * 0.4, r * 0.3, r * 0.8, r * 0.08));
      hatch(g, -r * 0.4, -r * 0.3, r * 0.24, o);
      return true;
    }
    case 'twin30': {
      for (const y of [-0.38, 0.38]) {
        barrel(g, 0, r * 2.0, y * r, r * 0.24, o);
        shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 1.82, y * r - r * 0.18, r * 0.36, r * 0.36, r * 0.07));
      }
      housing(g, pal, -r * 0.95, -r * 0.9, r * 1.75, r * 1.8, r * 0.3, o);
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.55, -r * 0.65, r * 0.3, r * 1.3, r * 0.08));
      hatch(g, -r * 0.45, 0, r * 0.28, o);
      return true;
    }
    case 'ac40': {
      // open mount: ring base, gun shield, long barrel with flared flash cone
      shape(g, METAL.dark, o, () => g.arc(-r * 0.1, 0, r * 0.95, 0, Math.PI * 2));
      shape(g, METAL.base, o * 0.6, () => g.arc(-r * 0.1, 0, r * 0.75, 0, Math.PI * 2));
      barrel(g, -r * 0.3, r * 2.3, 0, r * 0.26, o);
      shape(g, METAL.light, o * 0.7, () => { g.moveTo(r * 2.2, -r * 0.14); g.lineTo(r * 2.65, -r * 0.3); g.lineTo(r * 2.65, r * 0.3); g.lineTo(r * 2.2, r * 0.14); g.closePath(); });
      shape(g, teamGrad(g, pal, r), o, () => { g.moveTo(r * 0.35, -r * 0.85); g.lineTo(r * 0.6, -r * 0.3); g.lineTo(r * 0.6, r * 0.3); g.lineTo(r * 0.35, r * 0.85); g.lineTo(r * 0.15, r * 0.8); g.lineTo(r * 0.3, 0); g.lineTo(r * 0.15, -r * 0.8); g.closePath(); });
      shape(g, '#c9a040', o * 0.5, () => roundRect(g, -r * 0.55, -r * 0.18, r * 0.5, r * 0.36, r * 0.05));
      return true;
    }
    case 'quad20': {
      for (const y of [-0.62, -0.22, 0.22, 0.62]) barrel(g, 0, r * 1.75, y * r, r * 0.17, o);
      for (const y of [-0.62, -0.22, 0.22, 0.62]) shape(g, METAL.dark, o * 0.4, () => roundRect(g, r * 1.65, y * r - r * 0.12, r * 0.2, r * 0.24, r * 0.04));
      housing(g, pal, -r * 0.95, -r * 0.95, r * 1.6, r * 1.9, r * 0.3, o);
      // radar dish
      shape(g, metalGrad(g, r * 0.5, METAL.light), o * 0.7, () => g.ellipse(-r * 0.45, 0, r * 0.28, r * 0.62, 0, 0, Math.PI * 2));
      g.strokeStyle = METAL.dark; lw(g, r * 0.06);
      g.beginPath(); g.moveTo(-r * 0.45, -r * 0.55); g.lineTo(-r * 0.45, r * 0.55); g.moveTo(-r * 0.45, 0); g.lineTo(-r * 0.05, 0); g.stroke();
      glowDot(g, -r * 0.05, 0, r * 0.06, '#ff5050');
      return true;
    }
    case 'cannon75': {
      barrel(g, 0, r * 2.1, 0, r * 0.26, o);
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 2.0, -r * 0.18, r * 0.25, r * 0.36, r * 0.1));
      shape(g, teamGrad(g, pal, r), o, () => g.ellipse(-r * 0.1, 0, r * 0.95, r * 0.82, 0, 0, Math.PI * 2));
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.55, -r * 0.3, r * 0.3, r * 0.6, r * 0.1));
      hatch(g, -r * 0.4, -r * 0.25, r * 0.26, o);
      return true;
    }
    case 'atgm': {
      // single launch tube + guide-wire spool
      shape(g, '#5a6a4a', o, () => roundRect(g, -r * 0.5, -r * 0.24, r * 2.2, r * 0.48, r * 0.22));
      shape(g, METAL.deep, 0, () => g.ellipse(r * 1.68, 0, r * 0.07, r * 0.2, 0, 0, Math.PI * 2));
      g.fillStyle = '#c0392b'; g.fillRect(r * 1.35, -r * 0.24, r * 0.12, r * 0.48);
      housing(g, pal, -r * 0.85, -r * 0.6, r * 0.75, r * 1.2, r * 0.2, o);
      shape(g, '#b08040', o * 0.6, () => g.arc(-r * 0.45, r * 0.55, r * 0.26, 0, Math.PI * 2));
      g.strokeStyle = '#5a3a10'; lw(g, r * 0.05);
      g.beginPath(); g.arc(-r * 0.45, r * 0.55, r * 0.15, 0, Math.PI * 2); g.stroke();
      shape(g, METAL.light, o * 0.4, () => roundRect(g, -r * 0.3, -r * 0.62, r * 0.45, r * 0.2, r * 0.05));
      return true;
    }
    case 'aamissile': {
      g.strokeStyle = METAL.dark; lw(g, r * 0.12);
      g.beginPath(); g.moveTo(-r * 0.3, -r * 0.55); g.lineTo(-r * 0.3, r * 0.55); g.stroke();
      for (const y of [-0.55, 0.55]) lyingMissile(g, -r * 0.8, y * r, r * 2.1, r * 0.2, '#3a8ad8', o);
      housing(g, pal, -r * 0.7, -r * 0.3, r * 0.75, r * 0.6, r * 0.15, o);
      glowDot(g, -r * 0.3, 0, r * 0.06, '#3a8ad8');
      return true;
    }
    case 'sam': {
      cellGrid(g, pal, 2, 2, r * 0.78, o, '#d8d4c8');
      g.fillStyle = '#c0392b';
      for (const [x, y] of [[0, -0.39], [0.78, -0.39], [0, 0.39], [0.78, 0.39]]) { g.beginPath(); g.arc(x * r - r * 0.39 + r * 0.55, y * r, r * 0.1, 0, Math.PI * 2); g.fill(); }
      return true;
    }
    case 'swarm': {
      cellGrid(g, pal, 4, 2, r * 0.5, o, '#e0b040');
      return true;
    }
    case 'incendiary': {
      drawFamily(g, m, pal, r, m.caliber ?? 0.5, m.barrels ?? 4, o, glow);
      // orange incendiary tips + flame stripe
      const cell = r * 0.62, x0 = -cell + r * 0.25;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        shape(g, '#ff8a1a', 0, () => g.arc(x0 + (j + 0.5) * cell + cell * 0.08, -cell + (i + 0.5) * cell, cell * 0.17, 0, Math.PI * 2));
      }
      shape(g, '#ff5a10', 0, () => g.rect(x0 - cell * 0.15, -cell - cell * 0.15, cell * 2.3, cell * 0.12));
      return true;
    }
    case 'howitzer': {
      // recoil spades trailing behind
      for (const s of [-1, 1]) {
        g.strokeStyle = OUTLINE; lw(g, r * 0.22);
        g.beginPath(); g.moveTo(-r * 0.4, s * r * 0.4); g.lineTo(-r * 1.55, s * r * 0.85); g.stroke();
        g.strokeStyle = METAL.dark; lw(g, r * 0.14); g.stroke();
        shape(g, METAL.base, o * 0.6, () => roundRect(g, -r * 1.75, s * r * 0.85 - r * 0.18, r * 0.25, r * 0.36, r * 0.05));
      }
      drawFamily(g, m, pal, r, m.caliber ?? 0.9, 1, o, glow);
      return true;
    }
    case 'barrage': {
      for (const y of [-0.5, 0, 0.5]) { barrel(g, 0, r * 1.9, y * r, r * 0.3, o); shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 1.8, y * r - r * 0.2, r * 0.25, r * 0.4, r * 0.06)); }
      housing(g, pal, -r * 1.05, -r * 0.95, r * 1.55, r * 1.9, r * 0.2, o);
      for (const y of [-0.5, 0, 0.5]) shape(g, METAL.dark, o * 0.5, () => roundRect(g, -r * 0.8, y * r - r * 0.12, r * 0.9, r * 0.24, r * 0.06));
      return true;
    }
    case 'plasmaorb': {
      barrel(g, 0, r * 1.5, 0, r * 0.36, o, METAL.dark);
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 1.35, -r * 0.3, r * 0.25, r * 0.6, r * 0.1));
      housing(g, pal, -r * 0.95, -r * 0.8, r * 1.4, r * 1.6, r * 0.45, o);
      // orb chamber
      shape(g, '#1a0a24', o, () => g.arc(-r * 0.2, 0, r * 0.58, 0, Math.PI * 2));
      glowDot(g, -r * 0.2, 0, r * 0.25, '#e070ff');
      g.strokeStyle = '#b060e0'; lw(g, r * 0.05);
      g.beginPath(); g.arc(-r * 0.2, 0, r * 0.45, 0.4, 2.6); g.arc(-r * 0.2, 0, r * 0.45, 3.5, 5.8); g.stroke();
      return true;
    }
    case 'napalm': {
      const len = r * 1.7;
      shape(g, METAL.base, o, () => { g.moveTo(r * 0.1, -r * 0.22); g.lineTo(len, -r * 0.4); g.lineTo(len, r * 0.4); g.lineTo(r * 0.1, r * 0.22); g.closePath(); });
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, len - r * 0.25, -r * 0.42, r * 0.3, r * 0.84, r * 0.08));
      glowDot(g, len + r * 0.08, 0, r * 0.07, '#ff9030');
      housing(g, pal, -r * 0.45, -r * 0.55, r * 0.85, r * 1.1, r * 0.25, o);
      for (const y of [-0.5, 0.5]) {
        shape(g, '#3f8a2a', o, () => roundRect(g, -r * 1.2, y * r - r * 0.3, r * 0.95, r * 0.6, r * 0.3));
        g.fillStyle = 'rgba(190,255,120,0.55)'; g.fillRect(-r * 1.05, y * r - r * 0.18, r * 0.6, r * 0.1);
      }
      return true;
    }
    case 'arclance': {
      // big spire: radiating prongs around a tall coil
      shape(g, teamGrad(g, pal, r), o, () => { for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const f = i === 0 ? g.moveTo.bind(g) : g.lineTo.bind(g); f(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95); } g.closePath(); });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.strokeStyle = OUTLINE; lw(g, r * 0.16);
        g.beginPath(); g.moveTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3); g.lineTo(Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15); g.stroke();
        g.strokeStyle = '#c88a3c'; lw(g, r * 0.09); g.stroke();
        glowDot(g, Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15, r * 0.06, '#a8d8ff');
      }
      for (const rr of [0.55, 0.4]) { g.strokeStyle = '#c88a3c'; lw(g, r * 0.1); g.beginPath(); g.arc(0, 0, r * rr, 0, Math.PI * 2); g.stroke(); }
      shape(g, '#e8f6ff', o * 0.6, () => g.arc(0, 0, r * 0.25, 0, Math.PI * 2));
      glowDot(g, 0, 0, r * 0.2, '#a8d8ff');
      return true;
    }
    case 'stungun': {
      for (const s of [-1, 1]) {
        barrel(g, r * 0.1, r * 1.5, s * r * 0.22, r * 0.1, o, METAL.light);
        glowDot(g, r * 1.5, s * r * 0.22, r * 0.07, '#bfe4ff');
      }
      housing(g, pal, -r * 0.75, -r * 0.5, r * 1.0, r * 1.0, r * 0.4, o);
      shape(g, '#f0d020', o * 0.4, () => { g.moveTo(-r * 0.1, -r * 0.35); g.lineTo(-r * 0.35, r * 0.05); g.lineTo(-r * 0.2, r * 0.05); g.lineTo(-r * 0.35, r * 0.35); g.lineTo(-r * 0.0, -r * 0.05); g.lineTo(-r * 0.15, -r * 0.05); g.closePath(); });
      return true;
    }
    case 'empcannon': {
      barrel(g, 0, r * 1.6, 0, r * 0.3, o, METAL.dark);
      for (let i = 0; i < 3; i++) shape(g, '#3a6ab0', o * 0.5, () => roundRect(g, r * (0.5 + i * 0.35), -r * 0.24, r * 0.12, r * 0.48, r * 0.04));
      glowDot(g, r * 1.62, 0, r * 0.1, '#a8d8ff');
      housing(g, pal, -r * 0.9, -r * 0.8, r * 1.3, r * 1.6, r * 0.4, o);
      shape(g, '#0a1830', o, () => g.arc(-r * 0.25, 0, r * 0.55, 0, Math.PI * 2));
      glowDot(g, -r * 0.25, 0, r * 0.28, '#5aa0ff');
      return true;
    }
    case 'disarm': {
      // yellow scrambler emitter: flat panel array with yellow lens
      shape(g, METAL.dark, o, () => roundRect(g, r * 0.0, -r * 0.18, r * 1.1, r * 0.36, r * 0.08));
      shape(g, metalGrad(g, r, METAL.light), o, () => { g.moveTo(r * 0.9, -r * 0.7); g.lineTo(r * 1.25, -r * 0.55); g.lineTo(r * 1.25, r * 0.55); g.lineTo(r * 0.9, r * 0.7); g.closePath(); });
      glowDot(g, r * 1.25, 0, r * 0.14, '#ffe84a');
      housing(g, pal, -r * 0.85, -r * 0.65, r * 1.05, r * 1.3, r * 0.3, o);
      shape(g, '#ffe84a', o * 0.4, () => g.arc(-r * 0.3, 0, r * 0.2, 0, Math.PI * 2));
      g.strokeStyle = '#151515'; lw(g, r * 0.05);
      g.beginPath(); g.moveTo(-r * 0.45, -r * 0.15); g.lineTo(-r * 0.15, r * 0.15); g.moveTo(-r * 0.15, -r * 0.15); g.lineTo(-r * 0.45, r * 0.15); g.stroke();
      return true;
    }
    case 'railgun': {
      drawFamily(g, m, pal, r, 0.9, 1, o, glow);
      for (const x of [0.75, 1.3, 1.85]) shape(g, rgba('#9fe8ff', 0.85), 0, () => roundRect(g, x * r, -r * 0.42, r * 0.08, r * 0.84, r * 0.03));
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, -r * 1.25, -r * 0.45, r * 0.3, r * 0.9, r * 0.08));
      return true;
    }
    case 'shieldH': {
      drawFamily(g, m, pal, r, 0.9, 1, o, glow);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.52; shape(g, '#7fd8ff', o * 0.4, () => g.arc(Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05, r * 0.11, 0, Math.PI * 2)); }
      g.strokeStyle = rgba('#7fd8ff', 0.6); lw(g, r * 0.05);
      g.beginPath(); g.arc(0, 0, r * 1.05, 0, Math.PI * 2); g.stroke();
      return true;
    }
    case 'shieldL': {
      shape(g, METAL.dark, o, () => roundRect(g, -r * 0.7, -r * 0.7, r * 1.4, r * 1.4, r * 0.3));
      const gr = g.createRadialGradient(-r * 0.2, -r * 0.2, 0, 0, 0, r * 0.55);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#7fd8ff'); gr.addColorStop(1, '#1a4a6a');
      shape(g, gr, o * 0.5, () => g.arc(0, 0, r * 0.5, 0, Math.PI * 2));
      return true;
    }
    case 'hardened': {
      housing(g, pal, -r * 0.8, -r * 0.7, r * 1.6, r * 1.4, r * 0.15, o);
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, -r * 0.6, -r * 0.5, r * 1.2, r * 1.0, r * 0.1));
      g.strokeStyle = '#d0d4d8'; lw(g, r * 0.08);
      g.beginPath(); g.moveTo(-r * 0.4, -r * 0.3); g.lineTo(r * 0.4, -r * 0.3); g.lineTo(-r * 0.4, r * 0.3); g.lineTo(r * 0.4, r * 0.3); g.stroke();
      rivets(g, [-r * 0.7, -r * 0.6, r * 0.7, -r * 0.6, -r * 0.7, r * 0.6, r * 0.7, r * 0.6], r * 0.07);
      return true;
    }
    case 'autoloader': {
      housing(g, pal, -r * 0.8, -r * 0.6, r * 1.5, r * 1.2, r * 0.2, o);
      for (let i = 0; i < 5; i++) {
        shape(g, '#c9a040', o * 0.4, () => roundRect(g, -r * 0.65 + i * r * 0.27, -r * 0.35, r * 0.2, r * 0.7, r * 0.08));
        g.fillStyle = '#8a5a20'; g.fillRect(-r * 0.65 + i * r * 0.27, r * 0.2, r * 0.2, r * 0.12);
      }
      return true;
    }
    case 'overclock': {
      housing(g, pal, -r * 0.85, -r * 0.75, r * 1.7, r * 1.5, r * 0.3, o);
      g.strokeStyle = '#3a8ab0'; lw(g, r * 0.12);
      g.beginPath(); g.moveTo(-r * 0.7, -r * 0.5); g.bezierCurveTo(-r * 0.2, -r * 0.9, r * 0.4, -r * 0.2, r * 0.7, -r * 0.5); g.moveTo(-r * 0.7, r * 0.5); g.bezierCurveTo(-r * 0.2, r * 0.9, r * 0.4, r * 0.2, r * 0.7, r * 0.5); g.stroke();
      shape(g, '#2a0a0a', o * 0.6, () => roundRect(g, -r * 0.35, -r * 0.35, r * 0.7, r * 0.7, r * 0.1));
      glowDot(g, 0, 0, r * 0.2, '#ff4a2a');
      return true;
    }
    case 'targeting': {
      housing(g, pal, -r * 0.7, -r * 0.5, r * 1.1, r * 1.0, r * 0.25, o);
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.1, -r * 0.2, r * 0.7, r * 0.4, r * 0.1));
      shape(g, '#ff3a3a', o * 0.4, () => g.arc(r * 0.8, 0, r * 0.14, 0, Math.PI * 2));
      g.strokeStyle = '#ff3a3a'; lw(g, r * 0.05);
      g.beginPath(); g.arc(-r * 0.2, 0, r * 0.28, 0, Math.PI * 2); g.moveTo(-r * 0.55, 0); g.lineTo(r * 0.15, 0); g.moveTo(-r * 0.2, -r * 0.35); g.lineTo(-r * 0.2, r * 0.35); g.stroke();
      return true;
    }
    case 'phantom': {
      shape(g, teamGrad(g, pal, r), o, () => g.arc(0, 0, r * 0.9, 0, Math.PI * 2));
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.75);
      gr.addColorStop(0, '#f8e8ff'); gr.addColorStop(0.5, '#8a5ac8'); gr.addColorStop(1, '#1a0a2a');
      shape(g, gr, o * 0.5, () => g.arc(0, 0, r * 0.7, 0, Math.PI * 2));
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.78; shape(g, '#c8a8ff', o * 0.4, () => g.arc(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9, r * 0.1, 0, Math.PI * 2)); }
      g.strokeStyle = 'rgba(230,210,255,0.6)'; lw(g, r * 0.05);
      for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(0, 0, r * (0.2 + i * 0.16), -i, 2.5 - i); g.stroke(); }
      return true;
    }
    case 'selfdestruct': {
      shape(g, '#2a2a2a', o, () => roundRect(g, -r * 0.8, -r * 0.65, r * 1.6, r * 1.3, r * 0.12));
      hazard(g, -r * 0.72, -r * 0.57, r * 1.44, r * 0.28);
      hazard(g, -r * 0.72, r * 0.29, r * 1.44, r * 0.28);
      shape(g, '#a02020', o * 0.5, () => g.arc(0, 0, r * 0.22, 0, Math.PI * 2));
      glowDot(g, 0, 0, r * 0.1, '#ff3030');
      return true;
    }
    case 'gyro': return false;
  }
  return false;
}

/** Lateral offsets for n parallel barrels within width span. */
function spreadOffsets(n: number, span: number): number[] {
  if (n <= 1) return [0];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(-span / 2 + (span * i) / (n - 1));
  return out;
}

/** Draw a turret for module m with base diameter d (cells). o = outline width (cells). */
export function drawTurret(g: Ctx, m: ModuleDef, pal: TeamPal, d: number, o: number): void {
  const r = d / 2;
  const c = m.caliber ?? 0.5;
  const n = m.barrels ?? 1;
  const glow = moduleGlow(m, pal);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (drawSpecial(g, m, pal, r, o, glow)) { categoryTick(g, m, r, o); return; }
  drawFamily(g, m, pal, r, c, n, o, glow);
  categoryTick(g, m, r, o);
}

/** Category accent colours: one hue per weapon role, used on turrets (rear tick) and part icons. */
export const CATEGORY_COLOR: Record<string, string> = {
  machinegun: '#ffd54a', autocannon: '#ffa23a', cannon: '#ff6a3a', precision: '#5ad8ff', rocket: '#ff4a4a', missile: '#ff7ab0',
  artillery: '#c8a060', energy: '#d070ff', flame: '#ff8a20', disruption: '#80a8ff', antiair: '#a0ff70', melee: '#ff3060',
  support: '#5aff9a', defense: '#7fd8ff', stealth: '#a0a0c8', systems: '#e0e0a0', armor: '#b0b8c0',
};

function categoryTick(g: Ctx, m: ModuleDef, r: number, o: number): void {
  const col = CATEGORY_COLOR[m.category];
  if (!col) return;
  shape(g, col, o * 0.5, () => roundRect(g, -r * 1.02, -r * 0.16, r * 0.16, r * 0.32, r * 0.05));
}

function drawFamily(g: Ctx, m: ModuleDef, pal: TeamPal, r: number, c: number, n: number, o: number, glow: string): void {
  switch (m.visual) {
    case 'gun': {
      const bw = r * (0.2 + 0.28 * c) * (n >= 4 ? 0.75 : 1);
      const len = r * (1.7 + c * 0.9);
      const offs = n >= 4 ? [-0.42, -0.14, 0.14, 0.42].map((v) => v * r * 1.6) : spreadOffsets(n, r * 0.75);
      for (const y of offs) {
        barrel(g, 0, len, y, bw, o);
        if (c >= 0.45) muzzle(g, len, y, bw * 1.45, bw * 1.4, o * 0.7);
      }
      // mantlet + housing
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.95, -r * (n >= 2 ? 0.95 : 0.8), r * 1.75, r * (n >= 2 ? 1.9 : 1.6), r * 0.35));
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.55, -r * (n >= 2 ? 0.7 : 0.45), r * 0.4, r * (n >= 2 ? 1.4 : 0.9), r * 0.12));
      if (n >= 4) {
        // AA director dish
        shape(g, METAL.light, o * 0.6, () => g.ellipse(-r * 0.45, 0, r * 0.22, r * 0.45, 0, 0, Math.PI * 2));
      } else hatch(g, -r * 0.35, -r * 0.25, r * 0.28, o);
      // ammo feed box
      shape(g, shade(pal.dark, -0.2), o * 0.6, () => roundRect(g, -r * 0.8, r * 0.25, r * 0.6, r * 0.45, r * 0.08));
      break;
    }
    case 'gatling': {
      const len = r * 2.0;
      shape(g, metalGrad(g, r * 0.5, METAL.dark), o, () => roundRect(g, r * 0.2, -r * 0.42, len - r * 0.2, r * 0.84, r * 0.2));
      g.strokeStyle = METAL.light;
      lw(g, r * 0.07);
      for (const y of [-0.27, -0.09, 0.09, 0.27]) {
        g.beginPath(); g.moveTo(r * 0.5, y * r); g.lineTo(len - r * 0.05, y * r); g.stroke();
      }
      for (const x of [0.75, 1.45]) shape(g, METAL.base, o * 0.6, () => roundRect(g, x * r, -r * 0.5, r * 0.18, r, r * 0.05));
      shape(g, METAL.deep, 0, () => g.arc(len, 0, r * 0.18, 0, Math.PI * 2));
      shape(g, teamGrad(g, pal, r), o, () => g.arc(-r * 0.1, 0, r * 0.82, 0, Math.PI * 2));
      shape(g, METAL.base, o * 0.6, () => roundRect(g, -r * 0.4, -r * 0.95, r * 0.7, r * 0.35, r * 0.08));
      hatch(g, -r * 0.25, r * 0.15, r * 0.25, o);
      break;
    }
    case 'shotgun': {
      const len = r * 1.75;
      shape(g, METAL.base, o, () => { g.moveTo(r * 0.2, -r * 0.24); g.lineTo(len, -r * 0.38); g.lineTo(len, r * 0.38); g.lineTo(r * 0.2, r * 0.24); g.closePath(); });
      shape(g, METAL.deep, 0, () => g.ellipse(len - r * 0.05, 0, r * 0.08, r * 0.3, 0, 0, Math.PI * 2));
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.65, -r * 0.3, r * 0.45, r * 0.6, r * 0.1));
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.9, -r * 0.75, r * 1.4, r * 1.5, r * 0.3));
      rivets(g, [-r * 0.6, -r * 0.45, -r * 0.6, r * 0.45, r * 0.2, -r * 0.45, r * 0.2, r * 0.45], r * 0.07);
      break;
    }
    case 'cannon': {
      const bw = r * (0.24 + 0.12 * c);
      const len = r * 2.45;
      for (const y of spreadOffsets(n, r * 0.7)) {
        barrel(g, 0, len, y, bw, o);
        shape(g, METAL.base, o * 0.7, () => roundRect(g, len * 0.48, y - bw * 0.72, len * 0.16, bw * 1.44, bw * 0.4));
        muzzle(g, len + bw * 0.25, y, bw * 1.5, bw * 1.1, o * 0.7);
      }
      shape(g, teamGrad(g, pal, r), o, () => {
        g.moveTo(r * 0.85, -r * 0.55); g.lineTo(r * 0.6, -r * 0.92); g.lineTo(-r * 0.75, -r * 0.92); g.lineTo(-r * 1.0, -r * 0.5);
        g.lineTo(-r * 1.0, r * 0.5); g.lineTo(-r * 0.75, r * 0.92); g.lineTo(r * 0.6, r * 0.92); g.lineTo(r * 0.85, r * 0.55); g.closePath();
      });
      g.strokeStyle = rgba(pal.deep, 0.5); lw(g, o * 0.5);
      g.beginPath(); g.moveTo(-r * 0.2, -r * 0.88); g.lineTo(-r * 0.2, r * 0.88); g.stroke();
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.55, -r * 0.42 * (n > 1 ? 1.5 : 1), r * 0.35, r * 0.84 * (n > 1 ? 1.5 : 1), r * 0.1));
      hatch(g, -r * 0.55, -r * 0.4, r * 0.24, o);
      hatch(g, -r * 0.55, r * 0.4, r * 0.18, o);
      shape(g, pal.accent, 0, () => roundRect(g, -r * 0.95, -r * 0.12, r * 0.18, r * 0.24, r * 0.05));
      break;
    }
    case 'gauss': {
      const len = r * 2.55;
      shape(g, METAL.dark, o, () => roundRect(g, 0, -r * 0.3, len, r * 0.6, r * 0.12));
      g.strokeStyle = glow; lw(g, r * 0.08);
      g.beginPath(); g.moveTo(r * 0.2, 0); g.lineTo(len - r * 0.05, 0); g.stroke();
      for (let i = 0; i < 6; i++) {
        const x = r * (0.45 + i * 0.33);
        shape(g, '#c27a3a', o * 0.5, () => roundRect(g, x, -r * 0.38, r * 0.16, r * 0.76, r * 0.05));
      }
      glowDot(g, len, 0, r * 0.12, glow);
      shape(g, teamGrad(g, pal, r), o, () => { g.moveTo(r * 0.7, -r * 0.6); g.lineTo(-r * 0.4, -r * 0.95); g.lineTo(-r * 1.0, -r * 0.6); g.lineTo(-r * 1.0, r * 0.6); g.lineTo(-r * 0.4, r * 0.95); g.lineTo(r * 0.7, r * 0.6); g.closePath(); });
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, -r * 0.75, -r * 0.35, r * 0.7, r * 0.7, r * 0.1));
      glowDot(g, -r * 0.4, 0, r * 0.12, glow);
      break;
    }
    case 'sniper': {
      const len = r * 2.9;
      barrel(g, 0, len, 0, r * 0.16, o);
      muzzle(g, len, 0, r * 0.28, r * 0.3, o * 0.7);
      shape(g, METAL.deep, o * 0.6, () => roundRect(g, r * 0.1, -r * 0.42, r * 0.9, r * 0.2, r * 0.08));
      shape(g, '#7fd0ff', 0, () => g.arc(r * 1.0, -r * 0.32, r * 0.07, 0, Math.PI * 2));
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.85, -r * 0.55, r * 1.25, r * 1.1, r * 0.3));
      shape(g, METAL.dark, o * 0.5, () => roundRect(g, -r * 0.6, r * 0.15, r * 0.5, r * 0.25, r * 0.06));
      break;
    }
    case 'rail': {
      const len = r * (2.3 + c * 0.5);
      shape(g, METAL.deep, 0, () => g.rect(r * 0.3, -r * 0.14, len - r * 0.3, r * 0.28));
      g.strokeStyle = glow; lw(g, r * 0.1);
      g.beginPath(); g.moveTo(r * 0.3, 0); g.lineTo(len, 0); g.stroke();
      for (const y of [-0.24, 0.24]) barrel(g, 0, len, y * r, r * 0.2, o, METAL.light);
      for (let i = 0; i < 3; i++) shape(g, METAL.dark, o * 0.5, () => roundRect(g, r * (0.6 + i * 0.55), -r * 0.4, r * 0.12, r * 0.8, r * 0.04));
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 1.0, -r * 0.8, r * 1.5, r * 1.6, r * 0.18));
      for (const y of [-0.5, 0.5]) shape(g, METAL.dark, o * 0.5, () => roundRect(g, -r * 0.85, y * r - r * 0.18, r * 1.0, r * 0.36, r * 0.06));
      glowDot(g, -r * 0.35, -r * 0.5, r * 0.08, glow);
      glowDot(g, -r * 0.35, r * 0.5, r * 0.08, glow);
      break;
    }
    case 'rocketPod': {
      const cols = n >= 12 ? 4 : n >= 4 ? 2 : 1;
      const rows = Math.ceil(n / cols);
      const cell = r * (n >= 12 ? 0.48 : 0.62);
      const w = cols * cell, h = rows * cell;
      const x0 = -w / 2 + r * 0.25;
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, x0 - cell * 0.15, -h / 2 - cell * 0.15, w + cell * 0.3, h + cell * 0.3, cell * 0.2));
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        const cx = x0 + (j + 0.5) * cell, cy = -h / 2 + (i + 0.5) * cell;
        shape(g, METAL.deep, o * 0.4, () => g.arc(cx, cy, cell * 0.38, 0, Math.PI * 2));
        shape(g, j === cols - 1 ? '#d8d2c0' : '#9a9384', 0, () => g.arc(cx + cell * 0.06, cy, cell * 0.2, 0, Math.PI * 2));
        g.fillStyle = '#c0392b';
        g.beginPath(); g.arc(cx + cell * 0.1, cy, cell * 0.1, 0, Math.PI * 2); g.fill();
      }
      shape(g, pal.accent, 0, () => g.rect(x0 - cell * 0.15, -h / 2 - cell * 0.15, cell * 0.12, h + cell * 0.3));
      break;
    }
    case 'missileRack': {
      const rows = n >= 8 ? 4 : n >= 4 ? 2 : n;
      const per = n >= 8 ? 2 : n >= 4 ? 2 : 1;
      const ml = r * (n >= 8 ? 1.0 : 1.55);
      const mw = r * (n >= 8 ? 0.2 : 0.26);
      const span = rows * mw * 1.5;
      shape(g, METAL.dark, o, () => roundRect(g, -r * 0.85, -span / 2 - mw * 0.4, r * 1.6 + (per > 1 ? 0 : r * 0.2), span + mw * 0.8, mw * 0.4));
      for (let i = 0; i < rows; i++) {
        const y = -span / 2 + (i + 0.5) * mw * 1.5;
        for (let k = 0; k < per; k++) {
          const xs = per > 1 ? -r * 0.8 + k * ml * 1.02 : -r * 0.75;
          const len = per > 1 ? ml * 0.95 : ml;
          shape(g, '#e4e2da', o * 0.5, () => roundRect(g, xs, y - mw / 2, len, mw, mw / 2));
          g.fillStyle = k === per - 1 ? pal.accent : '#c0392b';
          g.beginPath(); g.moveTo(xs + len, y); g.lineTo(xs + len - mw * 1.1, y - mw / 2); g.lineTo(xs + len - mw * 1.1, y + mw / 2); g.closePath(); g.fill();
          g.fillStyle = '#8b8b84';
          g.fillRect(xs, y - mw * 0.75, mw * 0.6, mw * 1.5);
        }
      }
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 1.0, -r * 0.35, r * 0.4, r * 0.7, r * 0.1));
      break;
    }
    case 'cruise': {
      const len = r * 3.0;
      shape(g, METAL.dark, o, () => roundRect(g, -r * 1.2, -r * 0.55, r * 2.3, r * 1.1, r * 0.15));
      shape(g, '#dedbd0', o, () => roundRect(g, -r * 1.35, -r * 0.3, len, r * 0.6, r * 0.3));
      g.fillStyle = pal.accent;
      g.fillRect(-r * 0.2, -r * 0.3, r * 0.15, r * 0.6);
      g.fillStyle = '#b8352a';
      g.beginPath(); g.moveTo(len - r * 1.35, 0); g.lineTo(len - r * 1.9, -r * 0.3); g.lineTo(len - r * 1.9, r * 0.3); g.closePath(); g.fill();
      shape(g, '#a9a69c', o * 0.6, () => { g.moveTo(-r * 0.9, -r * 0.3); g.lineTo(-r * 1.35, -r * 0.75); g.lineTo(-r * 1.45, -r * 0.75); g.lineTo(-r * 1.3, -r * 0.3); g.closePath(); });
      shape(g, '#a9a69c', o * 0.6, () => { g.moveTo(-r * 0.9, r * 0.3); g.lineTo(-r * 1.35, r * 0.75); g.lineTo(-r * 1.45, r * 0.75); g.lineTo(-r * 1.3, r * 0.3); g.closePath(); });
      shape(g, '#a9a69c', o * 0.6, () => { g.moveTo(r * 0.5, -r * 0.3); g.lineTo(r * 0.25, -r * 0.55); g.lineTo(r * 0.1, -r * 0.55); g.lineTo(r * 0.15, -r * 0.3); g.closePath(); });
      shape(g, '#a9a69c', o * 0.6, () => { g.moveTo(r * 0.5, r * 0.3); g.lineTo(r * 0.25, r * 0.55); g.lineTo(r * 0.1, r * 0.55); g.lineTo(r * 0.15, r * 0.3); g.closePath(); });
      break;
    }
    case 'mortar': {
      shape(g, METAL.dark, o, () => { for (let i = 0; i < 3; i++) { const a = Math.PI * 0.66 * i + Math.PI; g.moveTo(0, 0); g.lineTo(Math.cos(a) * r * 1.0, Math.sin(a) * r * 1.0); } });
      g.strokeStyle = METAL.dark; lw(g, r * 0.14);
      g.beginPath(); for (let i = 0; i < 3; i++) { const a = Math.PI * 0.66 * i + Math.PI; g.moveTo(0, 0); g.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95); } g.stroke();
      shape(g, teamGrad(g, pal, r), o, () => g.arc(-r * 0.1, 0, r * 0.75, 0, Math.PI * 2));
      shape(g, metalGrad(g, r * 0.5), o, () => g.ellipse(r * 0.35, 0, r * 0.6, r * 0.52, 0, 0, Math.PI * 2));
      shape(g, METAL.deep, 0, () => g.ellipse(r * 0.45, 0, r * 0.36, r * 0.32, 0, 0, Math.PI * 2));
      g.strokeStyle = 'rgba(255,255,255,0.25)'; lw(g, r * 0.05);
      g.beginPath(); g.ellipse(r * 0.35, 0, r * 0.5, r * 0.43, 0, Math.PI * 1.1, Math.PI * 1.6); g.stroke();
      break;
    }
    case 'artillery': {
      const multi = n > 1;
      const len = r * (multi ? 2.25 : 2.9);
      const bw = r * (multi ? 0.2 : 0.3);
      for (const y of spreadOffsets(n, r * 0.9)) {
        barrel(g, 0, len, y, bw, o);
        muzzle(g, len + bw * 0.3, y, bw * 1.6, bw * 1.3, o * 0.7);
        if (!multi) for (const s of [-1, 1]) shape(g, METAL.light, o * 0.5, () => roundRect(g, r * 0.4, y + s * bw * 0.85 - bw * 0.2, r * 0.8, bw * 0.4, bw * 0.2));
      }
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 1.1, -r * 0.9, r * 1.8, r * 1.8, r * 0.25));
      shape(g, METAL.dark, o * 0.7, () => roundRect(g, r * 0.25, -r * 0.65, r * 0.6, r * 1.3, r * 0.15));
      g.strokeStyle = rgba(pal.deep, 0.5); lw(g, o * 0.5);
      for (const x of [-0.6, -0.15]) { g.beginPath(); g.moveTo(x * r, -r * 0.85); g.lineTo(x * r, r * 0.85); g.stroke(); }
      rivets(g, [-r * 0.9, -r * 0.7, -r * 0.9, r * 0.7, r * 0.5, -r * 0.75, r * 0.5, r * 0.75], r * 0.06);
      break;
    }
    case 'laser': {
      const len = r * 1.85;
      for (const y of spreadOffsets(n, r * 0.8)) {
        shape(g, METAL.dark, o, () => roundRect(g, 0, y - r * 0.16, len, r * 0.32, r * 0.14));
        g.strokeStyle = METAL.light; lw(g, r * 0.05);
        for (let i = 0; i < 4; i++) { const x = r * (0.6 + i * 0.25); g.beginPath(); g.moveTo(x, y - r * 0.15); g.lineTo(x, y + r * 0.15); g.stroke(); }
        glowDot(g, len, y, r * 0.11, glow);
      }
      shape(g, teamGrad(g, pal, r), o, () => g.arc(0, 0, r * 0.82, 0, Math.PI * 2));
      shape(g, rgba(glow, 0.9), o * 0.5, () => g.ellipse(-r * 0.15, 0, r * 0.32, r * 0.22, 0, 0, Math.PI * 2));
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.beginPath(); g.arc(-r * 0.25, -r * 0.08, r * 0.08, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'heatray': {
      shape(g, METAL.dark, o, () => roundRect(g, 0, -r * 0.15, r * 0.7, r * 0.3, r * 0.1));
      // parabolic dish
      shape(g, metalGrad(g, r, METAL.light), o, () => { g.moveTo(r * 0.45, -r * 0.95); g.quadraticCurveTo(r * 0.0, 0, r * 0.45, r * 0.95); g.lineTo(r * 0.62, r * 0.88); g.quadraticCurveTo(r * 0.25, 0, r * 0.62, -r * 0.88); g.closePath(); });
      g.strokeStyle = METAL.dark; lw(g, r * 0.06);
      g.beginPath(); g.moveTo(r * 0.5, -r * 0.8); g.lineTo(r * 1.05, 0); g.lineTo(r * 0.5, r * 0.8); g.stroke();
      glowDot(g, r * 1.05, 0, r * 0.14, glow);
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.95, -r * 0.6, r * 0.95, r * 1.2, r * 0.3));
      g.fillStyle = rgba('#ff7a2a', 0.8);
      for (const y of [-0.3, 0, 0.3]) g.fillRect(-r * 0.75, y * r - r * 0.05, r * 0.5, r * 0.1);
      break;
    }
    case 'plasma': {
      const big = c > 0.7;
      const len = r * (big ? 2.2 : 1.8);
      const bw = r * (big ? 0.42 : 0.5);
      shape(g, METAL.dark, o, () => roundRect(g, 0, -bw / 2, len, bw, bw * 0.4));
      for (let i = 0; i < (big ? 4 : 2); i++) {
        const x = r * (0.5 + i * 0.4);
        shape(g, '#8a3fb0', o * 0.5, () => roundRect(g, x, -bw * 0.68, r * 0.16, bw * 1.36, r * 0.06));
        g.fillStyle = rgba(glow, 0.9);
        g.fillRect(x + r * 0.04, -bw * 0.5, r * 0.08, bw);
      }
      glowDot(g, len, 0, r * (big ? 0.16 : 0.22), glow);
      shape(g, teamGrad(g, pal, r), o, () => g.ellipse(-r * 0.15, 0, r * 0.95, r * 0.85, 0, 0, Math.PI * 2));
      shape(g, METAL.dark, o * 0.6, () => g.arc(-r * 0.35, 0, r * 0.38, 0, Math.PI * 2));
      glowDot(g, -r * 0.35, 0, r * 0.16, glow);
      break;
    }
    case 'flamer': {
      const twin = c > 0.5;
      const len = r * 1.6;
      shape(g, METAL.base, o, () => { g.moveTo(r * 0.1, -r * 0.18); g.lineTo(len, -r * 0.26); g.lineTo(len, r * 0.26); g.lineTo(r * 0.1, r * 0.18); g.closePath(); });
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, len - r * 0.25, -r * 0.3, r * 0.3, r * 0.6, r * 0.08));
      glowDot(g, len + r * 0.08, r * 0.18, r * 0.06, '#ff9030');
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.5, -r * 0.6, r * 0.95, r * 1.2, r * 0.25));
      const tanks = twin ? [-0.42, 0.42] : [0];
      for (const y of tanks) {
        shape(g, '#b8552a', o, () => roundRect(g, -r * 1.15, y * r - r * 0.3, r * 0.85, r * 0.6, r * 0.3));
        g.fillStyle = 'rgba(255,255,255,0.3)';
        g.fillRect(-r * 1.0, y * r - r * 0.18, r * 0.55, r * 0.08);
        g.fillStyle = '#1a1a1a';
        for (const x of [-0.95, -0.62]) g.fillRect(x * r, y * r - r * 0.3, r * 0.06, r * 0.6);
      }
      break;
    }
    case 'tesla': {
      const big = c > 0.7;
      shape(g, teamGrad(g, pal, r), o, () => { for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; const f = i === 0 ? g.moveTo.bind(g) : g.lineTo.bind(g); f(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95); } g.closePath(); });
      for (let i = 0; i < (big ? 3 : 2); i++) {
        const rr = r * (0.75 - i * 0.2);
        g.strokeStyle = '#c88a3c'; lw(g, r * 0.11);
        g.beginPath(); g.arc(0, 0, rr, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = '#6a3e14'; lw(g, r * 0.03);
        g.beginPath(); g.arc(0, 0, rr, 0, Math.PI * 2); g.stroke();
      }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        shape(g, METAL.light, o * 0.4, () => g.arc(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85, r * 0.1, 0, Math.PI * 2));
      }
      shape(g, '#dff3ff', o * 0.6, () => g.arc(0, 0, r * 0.28, 0, Math.PI * 2));
      glowDot(g, 0, 0, r * 0.18, glow);
      break;
    }
    case 'emp': {
      const len = r * 1.45;
      for (const s of [-1, 1]) shape(g, METAL.light, o, () => { g.moveTo(r * 0.2, s * r * 0.15); g.lineTo(len, s * r * 0.32); g.lineTo(len, s * r * 0.18); g.lineTo(r * 0.35, s * r * 0.02); g.closePath(); });
      glowDot(g, len * 0.85, 0, r * 0.14, glow);
      shape(g, teamGrad(g, pal, r), o, () => g.arc(-r * 0.1, 0, r * 0.75, 0, Math.PI * 2));
      shape(g, '#1c2a3a', o * 0.6, () => g.arc(-r * 0.1, 0, r * 0.45, 0, Math.PI * 2));
      g.strokeStyle = glow; lw(g, r * 0.06);
      g.beginPath(); g.arc(-r * 0.1, 0, r * 0.32, 0, Math.PI * 2); g.stroke();
      glowDot(g, -r * 0.1, 0, r * 0.12, glow);
      break;
    }
    case 'slowbeam': {
      shape(g, METAL.dark, o, () => roundRect(g, 0, -r * 0.14, r * 1.1, r * 0.28, r * 0.1));
      for (const x of [0.45, 0.75]) shape(g, METAL.light, o * 0.4, () => g.ellipse(x * r, 0, r * 0.06, r * 0.3, 0, 0, Math.PI * 2));
      shape(g, rgba(glow, 0.95), o * 0.6, () => { g.moveTo(r * 1.45, 0); g.lineTo(r * 1.15, -r * 0.18); g.lineTo(r * 0.95, 0); g.lineTo(r * 1.15, r * 0.18); g.closePath(); });
      glowDot(g, r * 1.2, 0, r * 0.12, glow);
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.85, -r * 0.7, r * 1.15, r * 1.4, r * 0.45));
      shape(g, rgba(glow, 0.7), o * 0.4, () => g.arc(-r * 0.3, 0, r * 0.25, 0, Math.PI * 2));
      break;
    }
    case 'flak': {
      const nb = n > 1 ? n : 2;
      const bw = r * 0.22;
      const len = r * 1.75;
      for (const y of spreadOffsets(nb, r * (nb >= 3 ? 1.0 : 0.55))) {
        barrel(g, 0, len, y, bw, o);
        muzzle(g, len, y, bw * 1.5, bw * 1.6, o * 0.6);
      }
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.95, -r * 0.9, r * 1.5, r * 1.8, r * 0.5));
      // radar
      shape(g, METAL.light, o * 0.6, () => g.ellipse(-r * 0.55, 0, r * 0.18, r * 0.5, 0, 0, Math.PI * 2));
      g.strokeStyle = METAL.dark; lw(g, r * 0.05);
      g.beginPath(); g.moveTo(-r * 0.55, -r * 0.45); g.lineTo(-r * 0.55, r * 0.45); g.stroke();
      shape(g, pal.accent, 0, () => g.arc(r * 0.15, 0, r * 0.12, 0, Math.PI * 2));
      break;
    }
    case 'repair': {
      shape(g, METAL.base, o, () => roundRect(g, 0, -r * 0.13, r * 1.0, r * 0.26, r * 0.1));
      shape(g, METAL.dark, o * 0.6, () => g.arc(r * 1.0, 0, r * 0.2, 0, Math.PI * 2));
      glowDot(g, r * 1.05, 0, r * 0.1, glow);
      shape(g, teamGrad(g, pal, r), o, () => g.arc(-r * 0.1, 0, r * 0.78, 0, Math.PI * 2));
      shape(g, '#f2f2ea', o * 0.5, () => g.arc(-r * 0.1, 0, r * 0.5, 0, Math.PI * 2));
      g.fillStyle = '#2bd46a';
      g.fillRect(-r * 0.4, -r * 0.1, r * 0.6, r * 0.2);
      g.fillRect(-r * 0.2, -r * 0.3, r * 0.2, r * 0.6);
      break;
    }
    case 'shield': {
      shape(g, METAL.dark, o, () => g.arc(0, 0, r * 0.95, 0, Math.PI * 2));
      const gr = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.05, 0, 0, r * 0.8);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.35, glow);
      gr.addColorStop(1, shade(pal.dark, -0.2));
      shape(g, gr, o * 0.6, () => g.arc(0, 0, r * 0.72, 0, Math.PI * 2));
      g.strokeStyle = 'rgba(255,255,255,0.45)'; lw(g, r * 0.04);
      g.beginPath();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.moveTo(0, 0); g.lineTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72); }
      g.stroke();
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; shape(g, pal.accent, o * 0.4, () => g.arc(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, r * 0.08, 0, Math.PI * 2)); }
      break;
    }
    case 'sonic': {
      // wide-mouthed horn emitter
      shape(g, metalGrad(g, r, METAL.light), o, () => { g.moveTo(r * 0.1, -r * 0.25); g.lineTo(r * 1.3, -r * 0.8); g.quadraticCurveTo(r * 1.45, 0, r * 1.3, r * 0.8); g.lineTo(r * 0.1, r * 0.25); g.closePath(); });
      shape(g, METAL.deep, 0, () => g.ellipse(r * 1.28, 0, r * 0.12, r * 0.7, 0, 0, Math.PI * 2));
      g.strokeStyle = rgba(glow, 0.8); lw(g, r * 0.05);
      for (const x of [0.55, 0.85]) { g.beginPath(); g.ellipse(x * r, 0, r * 0.06, r * (0.25 + (x - 0.1) * 0.45), 0, 0, Math.PI * 2); g.stroke(); }
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.9, -r * 0.65, r * 1.1, r * 1.3, r * 0.35));
      shape(g, METAL.dark, o * 0.5, () => g.arc(-r * 0.35, 0, r * 0.3, 0, Math.PI * 2));
      shape(g, METAL.light, 0, () => g.arc(-r * 0.35, 0, r * 0.14, 0, Math.PI * 2));
      break;
    }
    case 'gravity': {
      // twin prongs with a dark graviton core
      for (const s of [-1, 1]) shape(g, METAL.dark, o, () => { g.moveTo(-r * 0.1, s * r * 0.35); g.lineTo(r * 1.5, s * r * 0.42); g.lineTo(r * 1.6, s * r * 0.22); g.lineTo(r * 0.5, s * r * 0.16); g.closePath(); });
      for (let i = 0; i < 3; i++) shape(g, '#5a2a8a', o * 0.5, () => g.ellipse(r * (0.6 + i * 0.3), 0, r * 0.07, r * 0.4, 0, 0, Math.PI * 2));
      const gg = g.createRadialGradient(r * 1.1, 0, 0, r * 1.1, 0, r * 0.35);
      gg.addColorStop(0, '#000000'); gg.addColorStop(0.5, '#3a0066'); gg.addColorStop(1, 'rgba(160,80,255,0)');
      g.fillStyle = gg; g.beginPath(); g.arc(r * 1.1, 0, r * 0.35, 0, Math.PI * 2); g.fill();
      shape(g, teamGrad(g, pal, r), o, () => { for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; const f = i === 0 ? g.moveTo.bind(g) : g.lineTo.bind(g); f(Math.cos(a) * r * 0.95 - r * 0.15, Math.sin(a) * r * 0.95); } g.closePath(); });
      shape(g, '#1a0a2a', o * 0.6, () => g.arc(-r * 0.15, 0, r * 0.45, 0, Math.PI * 2));
      glowDot(g, -r * 0.15, 0, r * 0.15, '#b070ff');
      break;
    }
    case 'saw': {
      shape(g, METAL.dark, o, () => roundRect(g, 0, -r * 0.16, r * 1.1, r * 0.32, r * 0.1));
      const R = r * 0.75, cx = r * 1.25;
      shape(g, metalGrad(g, R, '#9aa2aa'), o, () => { for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; const f = i === 0 ? g.moveTo.bind(g) : g.lineTo.bind(g); f(cx + Math.cos(a) * R, Math.sin(a) * R); f(cx + Math.cos(a + 0.2) * R * 0.85, Math.sin(a + 0.2) * R * 0.85); } g.closePath(); });
      shape(g, METAL.dark, o * 0.5, () => g.arc(cx, 0, R * 0.3, 0, Math.PI * 2));
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.8, -r * 0.6, r * 1.0, r * 1.2, r * 0.3));
      break;
    }
    case 'chainsaw': {
      const len = r * 2.1;
      shape(g, METAL.light, o, () => roundRect(g, r * 0.1, -r * 0.26, len, r * 0.52, r * 0.26));
      g.strokeStyle = METAL.dark; lw(g, r * 0.08); g.setLineDash([r * 0.1, r * 0.08]);
      g.beginPath(); roundRect(g, r * 0.12, -r * 0.24, len - r * 0.04, r * 0.48, r * 0.24); g.stroke(); g.setLineDash([]);
      shape(g, '#d4a020', o * 0.6, () => roundRect(g, -r * 0.2, -r * 0.4, r * 0.5, r * 0.8, r * 0.1));
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.85, -r * 0.55, r * 0.8, r * 1.1, r * 0.3));
      break;
    }
    case 'hammer': {
      shape(g, METAL.dark, o, () => roundRect(g, 0, -r * 0.12, r * 1.3, r * 0.24, r * 0.08));
      shape(g, metalGrad(g, r, METAL.base), o, () => roundRect(g, r * 1.1, -r * 0.6, r * 0.55, r * 1.2, r * 0.1));
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(r * 1.18, -r * 0.5, r * 0.1, r);
      shape(g, pal.accent, 0, () => g.rect(r * 1.1, -r * 0.6, r * 0.55, r * 0.12));
      shape(g, teamGrad(g, pal, r), o, () => g.arc(0, 0, r * 0.7, 0, Math.PI * 2));
      hatch(g, -r * 0.1, 0, r * 0.25, o);
      break;
    }
    case 'claw': {
      for (const s of [-1, 1]) {
        shape(g, METAL.base, o, () => { g.moveTo(r * 0.2, s * r * 0.2); g.lineTo(r * 1.0, s * r * 0.55); g.quadraticCurveTo(r * 1.7, s * r * 0.45, r * 1.75, s * r * 0.05); g.lineTo(r * 1.45, s * r * 0.15); g.quadraticCurveTo(r * 1.25, s * r * 0.3, r * 0.9, s * r * 0.25); g.lineTo(r * 0.3, s * r * 0.02); g.closePath(); });
      }
      joint(g, r * 0.95, -r * 0.42, r * 0.1, o);
      joint(g, r * 0.95, r * 0.42, r * 0.1, o);
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.85, -r * 0.6, r * 1.15, r * 1.2, r * 0.35));
      break;
    }
    case 'blade': {
      const len = r * 2.2;
      g.globalAlpha = 0.5; shape(g, glow, 0, () => { g.moveTo(r * 0.4, -r * 0.3); g.lineTo(len + r * 0.2, 0); g.lineTo(r * 0.4, r * 0.3); g.closePath(); }); g.globalAlpha = 1;
      shape(g, '#ffffff', 0, () => { g.moveTo(r * 0.5, -r * 0.12); g.lineTo(len, 0); g.lineTo(r * 0.5, r * 0.12); g.closePath(); });
      shape(g, METAL.dark, o, () => roundRect(g, r * 0.1, -r * 0.35, r * 0.4, r * 0.7, r * 0.1));
      shape(g, teamGrad(g, pal, r), o, () => g.arc(-r * 0.2, 0, r * 0.65, 0, Math.PI * 2));
      glowDot(g, -r * 0.2, 0, r * 0.12, glow);
      break;
    }
    case 'drill': {
      shape(g, metalGrad(g, r, METAL.light), o, () => { g.moveTo(r * 0.3, -r * 0.5); g.lineTo(r * 2.0, 0); g.lineTo(r * 0.3, r * 0.5); g.closePath(); });
      g.strokeStyle = METAL.dark; lw(g, r * 0.07);
      g.beginPath(); for (let i = 0; i < 5; i++) { const x = r * (0.45 + i * 0.3), h = r * 0.5 * (1 - (x - r * 0.3) / (r * 1.7)); g.moveTo(x, -h); g.lineTo(x + r * 0.18, h); } g.stroke();
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.85, -r * 0.65, r * 1.2, r * 1.3, r * 0.3));
      break;
    }
    case 'prod': {
      shape(g, METAL.dark, o, () => roundRect(g, 0, -r * 0.1, r * 1.7, r * 0.2, r * 0.08));
      for (const s of [-1, 1]) shape(g, METAL.light, o * 0.6, () => roundRect(g, r * 1.6, s * r * 0.18 - r * 0.05, r * 0.3, r * 0.1, r * 0.04));
      glowDot(g, r * 1.85, 0, r * 0.1, '#a8d8ff');
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.75, -r * 0.5, r * 1.0, r * 1.0, r * 0.3));
      break;
    }
    case 'ram': {
      shape(g, metalGrad(g, r, METAL.base), o, () => { g.moveTo(r * 0.2, -r * 1.0); g.lineTo(r * 0.9, -r * 0.8); g.lineTo(r * 1.25, 0); g.lineTo(r * 0.9, r * 0.8); g.lineTo(r * 0.2, r * 1.0); g.closePath(); });
      g.strokeStyle = 'rgba(240,190,40,0.8)'; lw(g, r * 0.12);
      g.beginPath(); for (let i = -2; i <= 2; i++) { g.moveTo(r * 0.45, i * r * 0.35 - r * 0.1); g.lineTo(r * 0.75, i * r * 0.35 + r * 0.1); } g.stroke();
      rivets(g, [r * 0.35, -r * 0.7, r * 0.35, r * 0.7, r * 0.35, 0], r * 0.07);
      break;
    }
    case 'cloak': {
      shape(g, teamGrad(g, pal, r), o, () => g.arc(0, 0, r * 0.8, 0, Math.PI * 2));
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.6);
      gr.addColorStop(0, '#e8f8ff'); gr.addColorStop(0.5, '#6aa8c8'); gr.addColorStop(1, '#1a2a38');
      shape(g, gr, o * 0.5, () => g.arc(0, 0, r * 0.55, 0, Math.PI * 2));
      g.strokeStyle = 'rgba(200,240,255,0.6)'; lw(g, r * 0.05);
      for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(0, 0, r * (0.2 + i * 0.13), i, i + 3.5); g.stroke(); }
      break;
    }
    case 'jammer': {
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.7, -r * 0.6, r * 1.2, r * 1.2, r * 0.25));
      shape(g, metalGrad(g, r, METAL.light), o, () => g.arc(r * 0.05, 0, r * 0.5, 0, Math.PI * 2));
      shape(g, METAL.dark, 0, () => g.arc(r * 0.05, 0, r * 0.3, 0, Math.PI * 2));
      g.strokeStyle = METAL.light; lw(g, r * 0.06);
      g.beginPath(); for (let i = 0; i < 3; i++) { const a = i * 2.09; g.moveTo(r * 0.05, 0); g.lineTo(r * 0.05 + Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85); } g.stroke();
      glowDot(g, r * 0.05, 0, r * 0.08, '#ff5050');
      break;
    }
    case 'smoke': {
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.7, -r * 0.7, r * 1.2, r * 1.4, r * 0.25));
      for (let i = 0; i < 4; i++) { const y = -r * 0.48 + i * r * 0.32; shape(g, METAL.dark, o * 0.5, () => g.arc(r * 0.25, y, r * 0.13, 0, Math.PI * 2)); shape(g, '#8a8a80', 0, () => g.arc(r * 0.27, y, r * 0.07, 0, Math.PI * 2)); }
      break;
    }
    case 'pointdef': {
      for (const y of [-r * 0.2, r * 0.2]) barrel(g, 0, r * 1.3, y, r * 0.14, o, METAL.dark);
      glowDot(g, r * 1.3, -r * 0.2, r * 0.06, '#ff6060');
      glowDot(g, r * 1.3, r * 0.2, r * 0.06, '#ff6060');
      shape(g, teamGrad(g, pal, r), o, () => g.arc(0, 0, r * 0.6, 0, Math.PI * 2));
      shape(g, METAL.light, o * 0.5, () => g.ellipse(-r * 0.15, 0, r * 0.12, r * 0.35, 0, 0, Math.PI * 2));
      break;
    }
    case 'engine': {
      shape(g, METAL.dark, o, () => roundRect(g, -r * 0.9, -r * 0.6, r * 1.6, r * 1.2, r * 0.2));
      for (const y of [-0.3, 0.3]) { shape(g, METAL.base, o * 0.6, () => g.arc(-r * 0.75, y * r, r * 0.22, 0, Math.PI * 2)); shape(g, '#2a1408', 0, () => g.arc(-r * 0.75, y * r, r * 0.13, 0, Math.PI * 2)); glowDot(g, -r * 0.75, y * r, r * 0.06, '#ff9030'); }
      vents2(g, r * 0.1, 0, r * 0.8, r * 0.9, 5, o);
      shape(g, pal.accent, 0, () => g.rect(r * 0.55, -r * 0.6, r * 0.12, r * 1.2));
      break;
    }
    case 'uplink': {
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.6, -r * 0.6, r * 1.2, r * 1.2, r * 0.2));
      g.strokeStyle = METAL.light; lw(g, r * 0.07);
      g.beginPath(); for (const [x, y] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) { g.moveTo(x * r, y * r); g.lineTo(x * r * 2.2, y * r * 2.2); } g.stroke();
      for (const [x, y] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) glowDot(g, x * r * 2.2, y * r * 2.2, r * 0.06, pal.glow);
      shape(g, METAL.light, o * 0.5, () => g.arc(0, 0, r * 0.25, 0, Math.PI * 2));
      break;
    }
    case 'charge': {
      shape(g, '#5a4a2a', o, () => roundRect(g, -r * 0.8, -r * 0.6, r * 1.6, r * 1.2, r * 0.15));
      for (const x of [-0.45, 0, 0.45]) shape(g, '#8a6a3a', o * 0.5, () => roundRect(g, x * r - r * 0.18, -r * 0.5, r * 0.36, r, r * 0.12));
      g.strokeStyle = '#c0392b'; lw(g, r * 0.06); g.beginPath(); g.moveTo(-r * 0.7, 0); g.bezierCurveTo(-r * 0.2, -r * 0.6, r * 0.2, r * 0.6, r * 0.7, 0); g.stroke();
      glowDot(g, r * 0.6, -r * 0.45, r * 0.06, '#ff3030');
      break;
    }
    case 'gyro': {
      shape(g, teamGrad(g, pal, r), o, () => g.arc(0, 0, r * 0.8, 0, Math.PI * 2));
      g.strokeStyle = METAL.light; lw(g, r * 0.08);
      g.beginPath(); g.ellipse(0, 0, r * 0.6, r * 0.25, 0.6, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.ellipse(0, 0, r * 0.6, r * 0.25, -0.6, 0, Math.PI * 2); g.stroke();
      shape(g, METAL.dark, o * 0.5, () => g.arc(0, 0, r * 0.18, 0, Math.PI * 2));
      break;
    }
    case 'coolant': {
      for (const y of [-0.35, 0.35]) shape(g, '#3a8ab0', o, () => roundRect(g, -r * 0.9, y * r - r * 0.25, r * 1.6, r * 0.5, r * 0.25));
      g.fillStyle = 'rgba(255,255,255,0.35)'; for (const y of [-0.35, 0.35]) g.fillRect(-r * 0.7, y * r - r * 0.15, r * 1.2, r * 0.08);
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.3, -r * 0.55, r * 0.5, r * 1.1, r * 0.1));
      break;
    }
    case 'dome': {
      shape(g, METAL.dark, o, () => { for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const f = i === 0 ? g.moveTo.bind(g) : g.lineTo.bind(g); f(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); });
      const gr = g.createRadialGradient(-r * 0.25, -r * 0.25, 0, 0, 0, r * 0.75);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.4, '#7fd8ff'); gr.addColorStop(1, '#1a4a6a');
      shape(g, gr, o * 0.6, () => g.arc(0, 0, r * 0.72, 0, Math.PI * 2));
      g.strokeStyle = 'rgba(255,255,255,0.5)'; lw(g, r * 0.04);
      g.beginPath(); g.arc(0, 0, r * 0.5, 0, Math.PI * 2); g.moveTo(-r * 0.72, 0); g.lineTo(r * 0.72, 0); g.moveTo(0, -r * 0.72); g.lineTo(0, r * 0.72); g.stroke();
      break;
    }
    case 'nanite': {
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.7, -r * 0.7, r * 1.4, r * 1.4, r * 0.4));
      shape(g, '#1a2a20', o * 0.5, () => g.arc(0, 0, r * 0.5, 0, Math.PI * 2));
      g.fillStyle = '#6dff9a';
      for (let i = 0; i < 9; i++) { const a = i * 2.4, d = r * 0.12 * Math.sqrt(i); g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, r * 0.06, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case 'sensor': {
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.7, -r * 0.55, r * 1.2, r * 1.1, r * 0.25));
      shape(g, metalGrad(g, r, METAL.light), o, () => { g.ellipse(r * 0.2, 0, r * 0.35, r * 0.85, 0, -Math.PI / 2, Math.PI / 2); g.closePath(); });
      g.strokeStyle = METAL.dark; lw(g, r * 0.06);
      g.beginPath(); g.moveTo(r * 0.2, 0); g.lineTo(r * 0.7, 0); g.stroke();
      glowDot(g, r * 0.72, 0, r * 0.08, '#ff5050');
      g.strokeStyle = METAL.light; lw(g, r * 0.05);
      g.beginPath(); g.moveTo(-r * 0.45, -r * 0.3); g.lineTo(-r * 0.45, -r * 0.9); g.stroke();
      break;
    }
    default: {
      // generic gun
      barrel(g, 0, r * 1.6, 0, r * 0.25, o);
      shape(g, teamGrad(g, pal, r), o, () => g.arc(0, 0, r * 0.8, 0, Math.PI * 2));
    }
  }
}
