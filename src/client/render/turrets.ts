// Turret / module art. One drawing per ModuleVisual family, varied by `barrels` and `caliber`.
// Drawn in turret-local cell units: pivot at origin, barrels pointing +x. `d` = turret base diameter (cells).

import type { ModuleDef, ModuleVisual } from '../../shared/types.ts';
import { MAT, METAL, OUTLINE, clamp, mix, shade, rgba, roundRect, softDot, type Ctx, type TeamPal } from './palette.ts';
import { boreFrac, calibreMm } from './weaponsize.ts';

/**
 * Barrel width for a module drawn at turret radius r: from its real calibre (weaponsize.ts), not hand-tuned. Big bores
 * are slimmed (an outer barrel is ~2x the bore, but drawn at the raw bore fraction a 120 mm gun read as a pipe): small
 * calibres stay as they are so MGs remain visible, 100 mm+ guns come out ~2/3 as wide - long, slim tubes.
 */
const boreW = (m: ModuleDef, r: number) => {
  const f = boreFrac(m);
  return r * f * clamp(1 - (f - 0.15) * 1.3, 0.62, 1);
};

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
const MUZZLE_BY_ID: Record<string, number> = {
  siege240: 1.65, avenger: 1.55, missilebattery: 0.7, siegeplasma: 1.3, skyfortress: 1.28, stormtower: 0.3, inferno: 1.15, grinder: 1.1,
  massdriver: 1.72, doomsday: 1.6, annihilator: 1.5, tactnuke: 1.0, titanfist: 1.75, stormcore: 0.3,
};
/** Muzzle distance (x d) of the hand-drawn gun specials, whose barrels are not stretched. */
const SPECIAL_MUZZLE: Record<string, number> = { mg: 0.9, twinmg: 0.9, hmg: 1.03, ac20: 0.92, autocannon: 1.12, twin30: 1.1, ac40: 1.15, quad20: 0.93, cannon75: 1.33, barrage: 1.2, empcannon: 0.82, disarm: 0.64, plasmaorb: 0.8 };
export function muzzleLen(m: ModuleDef | undefined): number {
  if (m && SPECIAL_MUZZLE[m.id] !== undefined) return SPECIAL_MUZZLE[m.id];
  return baseMuzzle(m) * barrelStretch(m);
}

/** 0..1 by weapon range (5 cells or less = 0, 16+ = 1). */
const rangeF = (m: ModuleDef) => clamp(((m.range ?? 6) - 5) / 11, 0, 1);

/**
 * Barrel length multiplier (applied about the pivot to the barrel group): parts look like their job - artillery and
 * precision guns get long barrels, and longer range = longer barrel within each family.
 */
export function barrelStretch(m: ModuleDef | undefined): number {
  if (!m) return 1;
  if (m.id === 'doomsday') return 1.2;
  if (MUZZLE_BY_ID[m.id] !== undefined) return 1;
  const rf = rangeF(m);
  switch (m.visual) {
    case 'artillery': return (m.barrels ?? 1) > 1 ? 1.15 + 0.1 * rf : 1.2 + 0.12 * rf;
    case 'sniper': return 1.2 + 0.1 * rf;
    case 'rail': case 'gauss': return 1.12 + 0.1 * rf;
    case 'cannon': return 1.05 + 0.12 * rf;
    case 'gun': return 0.95 + 0.15 * rf;
    default: return 1;
  }
}

/** Run a barrel-drawing block stretched along +x by the module's barrel multiplier. */
function stretched(g: Ctx, m: ModuleDef, fn: () => void): void {
  const f = barrelStretch(m);
  if (f === 1) { fn(); return; }
  g.save();
  g.scale(f, 1);
  fn();
  g.restore();
}

function baseMuzzle(m: ModuleDef | undefined): number {
  if (!m) return 0.8;
  if (MUZZLE_BY_ID[m.id] !== undefined) return MUZZLE_BY_ID[m.id];
  const c = m.caliber ?? 0.5;
  switch (m.visual) {
    case 'gun': return 1.02;
    case 'gatling': return 1.04;
    case 'shotgun': return 0.9;
    case 'cannon': return 1.41;
    case 'gauss': return 1.3;
    case 'sniper': return 1.45;
    case 'rail': return 1.4;
    case 'artillery': return (m.barrels ?? 1) > 1 ? 1.2 : 1.5;
    case 'laser': return 0.98;
    case 'heatray': return 0.6;
    case 'plasma': return 1.1;
    case 'flamer': return 0.85;
    case 'tesla': return 0.25;
    case 'emp': return 0.75;
    case 'slowbeam': return 0.7;
    case 'flak': return 1.15;
    case 'repair': return 0.6;
    case 'mortar': return 0.25;
    case 'sonic': return 0.68;
    case 'saw': return 1.3;
    case 'chainsaw': return 2.0;
    case 'hammer': return 1.5;
    case 'claw': return 1.6;
    case 'blade': return 2.0;
    case 'drill': return 1.9;
    case 'prod': return 1.85;
    case 'ram': return 1.2;
    case 'pointdef': return 0.7;
    case 'gravity': return 0.8;
    case 'rocketPod': case 'missileRack': case 'cruise': return 0.6;
    default: return 0.6;
  }
}

/** Half-extent of the turret sprite, as a multiple of d. */
export const TURRET_EXT = 2.15;

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
function barrel(g: Ctx, x0: number, x1: number, y: number, w: number, o: number, color = GUN): void {
  // cylindrical gun-steel: dark flanks, bright sheen band, crisp specular line
  const gr = g.createLinearGradient(0, y - w / 2, 0, y + w / 2);
  gr.addColorStop(0, shade(color, -0.25));
  gr.addColorStop(0.28, shade(color, 0.55));
  gr.addColorStop(0.55, color);
  gr.addColorStop(1, shade(color, -0.55));
  shape(g, gr, o, () => roundRect(g, x0, y - w / 2, x1 - x0, w, w * 0.3));
  g.fillStyle = 'rgba(235,242,248,0.55)';
  g.fillRect(x0 + w * 0.3, y - w * 0.27, (x1 - x0) - w * 0.6, Math.max(w * 0.09, o * 0.45));
}

/** Gun steel (barrels): bare blued steel with a sheen. Housings: the hull paint over cast/composite armour. */
const GUN = '#5f686f';

function muzzle(g: Ctx, x: number, y: number, w: number, len: number, o: number): void {
  shape(g, METAL.dark, o, () => roundRect(g, x - len, y - w / 2, len, w, w * 0.2));
}

/** Perforated cooling jacket around an MG barrel (x0..x1, width w): the MG tell at any zoom. */
function coolingJacket(g: Ctx, x0: number, x1: number, y: number, w: number, o: number): void {
  barrel(g, x0, x1, y, w, o * 0.7, METAL.base);
  const n = Math.max(2, Math.round((x1 - x0) / (w * 0.75)));
  g.fillStyle = 'rgba(5,7,10,0.85)';
  for (let i = 0; i < n; i++) {
    const x = x0 + (x1 - x0) * ((i + 0.5) / n);
    g.beginPath(); g.ellipse(x, y, w * 0.13, w * 0.22, 0, 0, Math.PI * 2); g.fill();
  }
}

/** Slotted muzzle brake at x (front face), centred on y, for a barrel of width bw. */
function brake(g: Ctx, x: number, y: number, bw: number, wide: number, len: number, slots: number, o: number): void {
  shape(g, METAL.dark, o, () => roundRect(g, x - len, y - (bw * wide) / 2, len, bw * wide, bw * 0.25));
  g.fillStyle = '#05070a';
  for (let k = 0; k < slots; k++) g.fillRect(x - len + len * ((k + 0.6) / (slots + 0.4)) - bw * 0.07, y - (bw * wide) / 2, bw * 0.14, bw * wide);
  g.fillStyle = 'rgba(255,255,255,0.2)';
  g.fillRect(x - len, y - (bw * wide) / 2 + bw * 0.08, len, bw * 0.1);
}

/**
 * Rotary barrel cluster seen from above: n thin barrels on radius R round the spin axis (y = 0), x0..x1, held by clamp
 * rings. `phase` turns the cluster (drawTurretDynamic spins it while the gun fires); back barrels are darker.
 */
function rotaryCluster(g: Ctx, x0: number, x1: number, n: number, R: number, bw: number, rings: number[], ringW: number, phase: number, o: number): void {
  const H = R + bw * 0.6;
  // dark core: the axle and the gaps between barrels (also hides the baked rest frame under a spinning overlay)
  shape(g, METAL.deep, o * 0.6, () => roundRect(g, x0, -H, x1 - x0, H * 2, bw * 0.4));
  const bs: { y: number; z: number }[] = [];
  for (let i = 0; i < n; i++) { const a = phase + (i / n) * Math.PI * 2 + Math.PI / n; bs.push({ y: R * Math.sin(a), z: Math.cos(a) }); }
  bs.sort((a, b) => a.z - b.z);
  for (const b of bs) barrel(g, x0, x1, b.y, bw * (0.85 + 0.15 * b.z), o * 0.5, shade(GUN, 0.12 * b.z - 0.12));
  for (const x of rings) {
    shape(g, METAL.base, o * 0.7, () => roundRect(g, x, -H - bw * 0.25, ringW, (H + bw * 0.25) * 2, ringW * 0.3));
    g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(x + ringW * 0.2, -H - bw * 0.1, ringW * 0.25, (H + bw * 0.1) * 2);
  }
  // muzzle ends of the front barrels
  g.fillStyle = '#05070a';
  for (const b of bs) if (b.z > -0.3) { g.beginPath(); g.ellipse(x1 - bw * 0.05, b.y, bw * 0.12, bw * 0.3, 0, 0, Math.PI * 2); g.fill(); }
}

/** Rotary MG barrels (tip at 2.08 r = muzzleLen 1.04 d). Also redrawn spinning by drawTurretDynamic. */
function minigunCluster(g: Ctx, m: ModuleDef, r: number, o: number, phase: number): void {
  rotaryCluster(g, r * 0.5, r * 2.08, m.barrels ?? 6, r * 0.2, r * 0.1, [r * 0.5, r * 1.3, r * 1.9], r * 0.13, phase, o);
}

/** Hellstorm rotary cannon barrels (tip at 3.1 r = muzzleLen 1.55 d). */
function avengerCluster(g: Ctx, m: ModuleDef, r: number, o: number, phase: number): void {
  rotaryCluster(g, r * 1.0, r * 3.1, m.barrels ?? 7, r * 0.4, r * 0.15, [r * 1.0, r * 1.85, r * 2.55, r * 2.9], r * 0.2, phase, o);
}

/** Turret housing material: the faction paint over composite armour, a touch lighter than the hull (raised, it
 *  catches more of the key light), lit from the upper left. */
function teamGrad(g: Ctx, pal: TeamPal, r: number): CanvasGradient {
  const gr = g.createLinearGradient(-r, -r, r, r);
  gr.addColorStop(0, shade(mix(pal.light, MAT.composite, 0.2), 0.08));
  gr.addColorStop(0.5, mix(pal.body, MAT.composite, 0.15));
  gr.addColorStop(1, shade(pal.dark, -0.1));
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
  if (drawGiantTurret(g, m, pal, r, o, glow)) return true;
  switch (m.id) {
    case 'mg': {
      // thin barrel in a perforated cooling jacket, small cone flash hider, compact receiver + side ammo box
      const W = boreW(m, r);
      barrel(g, 0, r * 1.8, 0, W, o);
      coolingJacket(g, r * 0.45, r * 1.3, 0, W * 2.0, o);
      shape(g, METAL.dark, o * 0.5, () => roundRect(g, r * 1.62, -W * 0.8, r * 0.18, W * 1.6, W * 0.35));
      housing(g, pal, -r * 0.7, -r * 0.45, r * 1.15, r * 0.9, r * 0.3, o);
      shape(g, METAL.dark, o * 0.5, () => roundRect(g, -r * 0.45, r * 0.45, r * 0.5, r * 0.3, r * 0.06));
      return true;
    }
    case 'twinmg': {
      const W = boreW(m, r);
      for (const y of [-0.26, 0.26]) {
        barrel(g, 0, r * 1.8, y * r, W, o);
        coolingJacket(g, r * 0.5, r * 1.3, y * r, W * 1.9, o);
        shape(g, METAL.dark, o * 0.5, () => roundRect(g, r * 1.64, y * r - W * 0.75, r * 0.16, W * 1.5, W * 0.3));
      }
      housing(g, pal, -r * 0.75, -r * 0.6, r * 1.25, r * 1.2, r * 0.3, o);
      shape(g, METAL.dark, o * 0.5, () => roundRect(g, r * 0.3, -r * 0.42, r * 0.2, r * 0.84, r * 0.05));
      return true;
    }
    case 'hmg': {
      // heavy barrel with the M2's perforated jacket at the receiver and a two-baffle muzzle brake
      const W = boreW(m, r);
      barrel(g, 0, r * 2.06, 0, W, o);
      coolingJacket(g, r * 0.5, r * 1.2, 0, W * 1.8, o);
      brake(g, r * 2.06, 0, W, 1.7, r * 0.3, 2, o * 0.6);
      housing(g, pal, -r * 0.8, -r * 0.55, r * 1.35, r * 1.1, r * 0.25, o);
      shape(g, '#4a5a3a', o * 0.6, () => roundRect(g, -r * 0.55, r * 0.3, r * 0.75, r * 0.55, r * 0.06));
      g.fillStyle = '#c9a040'; for (let i = 0; i < 4; i++) g.fillRect(-r * 0.45 + i * r * 0.16, r * 0.2, r * 0.08, r * 0.14);
      return true;
    }
    case 'ac20': {
      const W = boreW(m, r);
      barrel(g, 0, r * 1.84, 0, W, o);
      brake(g, r * 1.84, 0, W, 1.45, r * 0.24, 2, o * 0.6);
      housing(g, pal, -r * 0.8, -r * 0.62, r * 1.3, r * 1.24, r * 0.35, o);
      drum(g, -r * 0.2, r * 0.0, r * 0.4, o);
      return true;
    }
    case 'autocannon': {
      const W = boreW(m, r);
      barrel(g, 0, r * 2.05, 0, W, o);
      // slotted flash hider
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 1.85, -W * 0.8, r * 0.42, W * 1.6, W * 0.3));
      g.fillStyle = METAL.deep; for (let i = 0; i < 3; i++) g.fillRect(r * (1.92 + i * 0.11), -W * 0.8, r * 0.04, W * 1.6);
      housing(g, pal, -r * 0.85, -r * 0.62, r * 1.5, r * 1.24, r * 0.3, o);
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.45, -r * 0.32, r * 0.28, r * 0.64, r * 0.08));
      hatch(g, -r * 0.4, -r * 0.22, r * 0.22, o);
      return true;
    }
    case 'twin30': {
      const W = boreW(m, r);
      for (const y of [-0.38, 0.38]) {
        barrel(g, 0, r * 2.0, y * r, W, o);
        shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 1.82, y * r - W * 0.75, r * 0.36, W * 1.5, W * 0.3));
      }
      housing(g, pal, -r * 0.9, -r * 0.78, r * 1.6, r * 1.56, r * 0.3, o);
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.5, -r * 0.58, r * 0.28, r * 1.16, r * 0.08));
      hatch(g, -r * 0.45, 0, r * 0.28, o);
      return true;
    }
    case 'ac40': {
      // open mount: ring base, gun shield, long barrel with flared flash cone
      shape(g, METAL.dark, o, () => g.arc(-r * 0.1, 0, r * 0.95, 0, Math.PI * 2));
      shape(g, METAL.base, o * 0.6, () => g.arc(-r * 0.1, 0, r * 0.75, 0, Math.PI * 2));
      const W = boreW(m, r);
      barrel(g, -r * 0.3, r * 2.0, 0, W, o);
      shape(g, METAL.light, o * 0.7, () => { g.moveTo(r * 1.92, -W * 0.55); g.lineTo(r * 2.3, -W * 1.1); g.lineTo(r * 2.3, W * 1.1); g.lineTo(r * 1.92, W * 0.55); g.closePath(); });
      shape(g, teamGrad(g, pal, r), o, () => { g.moveTo(r * 0.35, -r * 0.85); g.lineTo(r * 0.6, -r * 0.3); g.lineTo(r * 0.6, r * 0.3); g.lineTo(r * 0.35, r * 0.85); g.lineTo(r * 0.15, r * 0.8); g.lineTo(r * 0.3, 0); g.lineTo(r * 0.15, -r * 0.8); g.closePath(); });
      shape(g, '#c9a040', o * 0.5, () => roundRect(g, -r * 0.55, -r * 0.18, r * 0.5, r * 0.36, r * 0.05));
      return true;
    }
    case 'quad20': {
      const W = boreW(m, r);
      for (const y of [-0.62, -0.22, 0.22, 0.62]) barrel(g, 0, r * 1.75, y * r, W, o);
      for (const y of [-0.62, -0.22, 0.22, 0.62]) shape(g, METAL.dark, o * 0.4, () => roundRect(g, r * 1.65, y * r - W * 0.7, r * 0.2, W * 1.4, W * 0.25));
      housing(g, pal, -r * 0.95, -r * 0.95, r * 1.6, r * 1.9, r * 0.3, o);
      // radar dish
      shape(g, metalGrad(g, r * 0.5, METAL.light), o * 0.7, () => g.ellipse(-r * 0.45, 0, r * 0.28, r * 0.62, 0, 0, Math.PI * 2));
      g.strokeStyle = METAL.dark; lw(g, r * 0.06);
      g.beginPath(); g.moveTo(-r * 0.45, -r * 0.55); g.lineTo(-r * 0.45, r * 0.55); g.moveTo(-r * 0.45, 0); g.lineTo(-r * 0.05, 0); g.stroke();
      glowDot(g, -r * 0.05, 0, r * 0.06, '#ff5050');
      return true;
    }
    case 'cannon75': {
      const W = boreW(m, r);
      barrel(g, 0, r * 2.6, 0, W, o);
      barrel(g, r * 1.25, r * 1.6, 0, W * 1.25, o * 0.7, METAL.base);
      brake(g, r * 2.66, 0, W, 1.5, r * 0.3, 2, o * 0.6);
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
      // the rocket pod with orange incendiary noses (drawFamily) + a flame stripe along the top plate
      drawFamily(g, m, pal, r, m.caliber ?? 0.5, m.barrels ?? 4, o, glow);
      shape(g, '#ff5a10', 0, () => g.rect(-r * 0.7, -r * 0.08, r * 0.9, r * 0.16));
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
      // three long, slim tubes side by side, each with a slotted brake
      const W = Math.min(boreW(m, r), r * 0.26);
      for (const y of [-0.5, 0, 0.5]) { barrel(g, 0, r * 2.4, y * r, W, o); brake(g, r * 2.4, y * r, W, 1.45, r * 0.3, 2, o * 0.6); }
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

/** true while baking a unit turret sprite: parts animated by drawTurretDynamic (the nuke) are left out. */
let BAKE = false;

/** Draw a turret for module m with base diameter d (cells). o = outline width (cells). bake = unit sprite (skip
 *  parts drawTurretDynamic animates). */
export function drawTurret(g: Ctx, m: ModuleDef, pal: TeamPal, d: number, o: number, bake = false): void {
  BAKE = bake;
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
  artillery: '#c8a060', bomb: '#e07850', energy: '#d070ff', flame: '#ff8a20', disruption: '#80a8ff', antiair: '#a0ff70', melee: '#ff3060',
  support: '#5aff9a', defense: '#7fd8ff', stealth: '#a0a0c8', systems: '#e0e0a0', armor: '#b0b8c0',
};

function categoryTick(g: Ctx, m: ModuleDef, r: number, o: number): void {
  const col = CATEGORY_COLOR[m.category];
  if (!col) return;
  // role-coloured stripe plate on the turret's rear: reads at a glance which job the weapon does
  shape(g, col, o * 0.6, () => roundRect(g, -r * 1.06, -r * 0.34, r * 0.2, r * 0.68, r * 0.06));
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.fillRect(-r * 1.02, -r * 0.3, r * 0.05, r * 0.6);
}

function drawFamily(g: Ctx, m: ModuleDef, pal: TeamPal, r: number, c: number, n: number, o: number, glow: string): void {
  switch (m.visual) {
    case 'gun': {
      const bw = boreW(m, r);
      const len = r * 1.85;
      const offs = n >= 4 ? [-0.42, -0.14, 0.14, 0.42].map((v) => v * r * 1.6) : spreadOffsets(n, r * 0.75);
      stretched(g, m, () => {
        for (const y of offs) {
          barrel(g, 0, len, y, bw, o);
          if (calibreMm(m) >= 20) muzzle(g, len, y, bw * 1.45, bw * 1.4, o * 0.7);
        }
      });
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
      // a cluster of thin barrels round a spin axis, held by clamp rings (spun by drawTurretDynamic while firing)
      minigunCluster(g, m, r, o, 0);
      shape(g, teamGrad(g, pal, r), o, () => g.arc(-r * 0.15, 0, r * 0.72, 0, Math.PI * 2));
      // ammo feed chute from the side box
      shape(g, METAL.base, o * 0.6, () => roundRect(g, -r * 0.45, -r * 0.88, r * 0.62, r * 0.32, r * 0.08));
      g.fillStyle = '#c9a040'; for (let i = 0; i < 4; i++) g.fillRect(-r * 0.38 + i * r * 0.13, -r * 0.8, r * 0.07, r * 0.16);
      hatch(g, -r * 0.3, r * 0.12, r * 0.22, o);
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
      const bw = boreW(m, r);
      const len = r * 2.75;
      stretched(g, m, () => {
        for (const y of spreadOffsets(n, r * 0.75)) {
          barrel(g, 0, len, y, bw, o);
          // bore evacuator + muzzle brake
          barrel(g, len * 0.48, len * 0.62, y, bw * 1.3, o * 0.7, METAL.base);
          brake(g, len + bw * 0.3, y, bw, 1.5, bw * 1.3, 2, o * 0.7);
        }
      });
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
      stretched(g, m, () => {
        // slim accelerator tube ringed by copper coils (coils get closer toward the muzzle)
        shape(g, METAL.dark, o, () => roundRect(g, 0, -r * 0.2, len, r * 0.4, r * 0.1));
        g.strokeStyle = glow; lw(g, r * 0.07);
        g.beginPath(); g.moveTo(r * 0.2, 0); g.lineTo(len - r * 0.05, 0); g.stroke();
        for (let i = 0; i < 6; i++) {
          const x = r * (0.5 + i * 0.36 - i * i * 0.012);
          shape(g, '#c27a3a', o * 0.5, () => roundRect(g, x, -r * 0.3, r * 0.12, r * 0.6, r * 0.04));
        }
      });
      glowDot(g, len * barrelStretch(m), 0, r * 0.12, glow);
      shape(g, teamGrad(g, pal, r), o, () => { g.moveTo(r * 0.7, -r * 0.6); g.lineTo(-r * 0.4, -r * 0.95); g.lineTo(-r * 1.0, -r * 0.6); g.lineTo(-r * 1.0, r * 0.6); g.lineTo(-r * 0.4, r * 0.95); g.lineTo(r * 0.7, r * 0.6); g.closePath(); });
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, -r * 0.75, -r * 0.35, r * 0.7, r * 0.7, r * 0.1));
      glowDot(g, -r * 0.4, 0, r * 0.12, glow);
      break;
    }
    case 'sniper': {
      const len = r * 2.9;
      stretched(g, m, () => {
        const W = boreW(m, r);
        barrel(g, 0, len, 0, W, o);
        muzzle(g, len, 0, W * 1.75, r * 0.3, o * 0.7);
        // bipod-style barrel support collar halfway down
        shape(g, METAL.dark, o * 0.5, () => roundRect(g, len * 0.55, -r * 0.13, r * 0.14, r * 0.26, r * 0.04));
      });
      shape(g, METAL.deep, o * 0.6, () => roundRect(g, r * 0.1, -r * 0.42, r * 0.9, r * 0.2, r * 0.08));
      shape(g, '#7fd0ff', 0, () => g.arc(r * 1.0, -r * 0.32, r * 0.07, 0, Math.PI * 2));
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.85, -r * 0.55, r * 1.25, r * 1.1, r * 0.3));
      shape(g, METAL.dark, o * 0.5, () => roundRect(g, -r * 0.6, r * 0.15, r * 0.5, r * 0.25, r * 0.06));
      break;
    }
    case 'rail': {
      const len = r * (2.3 + c * 0.5);
      stretched(g, m, () => {
        shape(g, METAL.deep, 0, () => g.rect(r * 0.3, -r * 0.14, len - r * 0.3, r * 0.28));
        g.strokeStyle = glow; lw(g, r * 0.1);
        g.beginPath(); g.moveTo(r * 0.3, 0); g.lineTo(len, 0); g.stroke();
        for (const y of [-0.24, 0.24]) barrel(g, 0, len, y * r, r * 0.2, o, METAL.light);
        for (let i = 0; i < 4; i++) shape(g, '#c27a3a', o * 0.5, () => roundRect(g, r * (0.6 + i * 0.5), -r * 0.4, r * 0.12, r * 0.8, r * 0.04));
      });
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 1.0, -r * 0.8, r * 1.5, r * 1.6, r * 0.18));
      for (const y of [-0.5, 0.5]) shape(g, METAL.dark, o * 0.5, () => roundRect(g, -r * 0.85, y * r - r * 0.18, r * 1.0, r * 0.36, r * 0.06));
      glowDot(g, -r * 0.35, -r * 0.5, r * 0.08, glow);
      glowDot(g, -r * 0.35, r * 0.5, r * 0.08, glow);
      break;
    }
    case 'rocketPod': {
      // a launcher box elevated toward the front (not tubes staring straight up): long top plate, then the
      // foreshortened front face where the tube mouths and rocket noses show, on a cradle with rear blast vents
      const across = n >= 12 ? 4 : n >= 4 ? 2 : 1;
      const layers = Math.max(1, Math.ceil(n / across));
      const W = r * (n >= 12 ? 1.5 : n >= 4 ? 1.05 : 0.6);
      const L = r * (n >= 12 ? 1.3 : 1.0);
      const x0 = -r * 0.75, cw = W / across;
      // depth of the visible front face: deep enough that every tube mouth shows as a near-round hole (the pod tell)
      const fd = Math.min(cw * 0.8 * layers, r * 0.95);
      // cradle and trunnion under the rear of the box
      shape(g, METAL.dark, o, () => roundRect(g, -r * 0.65, -W * 0.32, r * 0.75, W * 0.64, r * 0.08));
      // top plate
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, x0, -W / 2, L, W, r * 0.08));
      g.strokeStyle = 'rgba(0,0,0,0.35)'; lw(g, r * 0.04);
      g.beginPath();
      for (let j = 1; j < across; j++) { const y = -W / 2 + j * cw; g.moveTo(x0 + r * 0.08, y); g.lineTo(x0 + L - r * 0.04, y); }
      g.moveTo(x0 + L * 0.35, -W / 2 + r * 0.04); g.lineTo(x0 + L * 0.35, W / 2 - r * 0.04);
      g.stroke();
      // rear blast vents
      g.fillStyle = METAL.deep;
      for (let j = 0; j < across; j++) g.fillRect(x0 + r * 0.04, -W / 2 + (j + 0.25) * cw, r * 0.1, cw * 0.5);
      // front face with the tube mouths (seen at an angle: squashed along the facing)
      const fx = x0 + L;
      shape(g, METAL.light, o * 0.6, () => roundRect(g, fx, -W / 2, fd, W, r * 0.04));
      const lh = fd / layers;
      for (let k = 0; k < layers; k++) for (let j = 0; j < across; j++) {
        const cx = fx + lh * (k + 0.5), cy = -W / 2 + (j + 0.5) * cw;
        g.fillStyle = '#121416';
        g.beginPath(); g.ellipse(cx, cy, lh * 0.4, cw * 0.38, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = m.id === 'incendiary' ? '#ff9a1a' : '#d0452f';
        g.beginPath(); g.ellipse(cx + lh * 0.05, cy, lh * 0.2, cw * 0.19, 0, 0, Math.PI * 2); g.fill();
      }
      shape(g, pal.accent, 0, () => g.rect(x0 + L * 0.35 - r * 0.05, -W / 2, r * 0.1, W));
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
      // transporter-erector: a long sealed launch canister on an erector rail (the missile itself stays inside)
      const len = r * 2.9, cw = r * 0.62, x0 = -r * 1.3;
      // erector rail + hinge block under the canister
      shape(g, METAL.dark, o, () => roundRect(g, x0 - r * 0.1, -r * 0.22, len * 0.85, r * 0.44, r * 0.06));
      shape(g, METAL.deep, o * 0.6, () => roundRect(g, x0 - r * 0.25, -r * 0.42, r * 0.45, r * 0.84, r * 0.08));
      // the canister: dull metal with a faint team tint, ribbed clamp bands, a frangible front cap and a rear vent
      shape(g, metalGrad(g, cw), o, () => roundRect(g, x0, -cw / 2, len, cw, r * 0.1));
      g.globalAlpha = 0.35;
      shape(g, teamGrad(g, pal, r), 0, () => roundRect(g, x0 + r * 0.05, -cw / 2 + r * 0.05, len - r * 0.1, cw - r * 0.1, r * 0.08));
      g.globalAlpha = 1;
      for (const f of [0.18, 0.5, 0.82]) shape(g, METAL.dark, o * 0.4, () => g.rect(x0 + len * f - r * 0.06, -cw / 2 - r * 0.04, r * 0.12, cw + r * 0.08));
      shape(g, METAL.deep, o * 0.5, () => roundRect(g, x0 + len - r * 0.16, -cw / 2 + r * 0.04, r * 0.16, cw - r * 0.08, r * 0.05));
      shape(g, '#2a2c2e', 0, () => roundRect(g, x0 - r * 0.02, -cw * 0.3, r * 0.1, cw * 0.6, r * 0.03));
      // stencil stripe
      shape(g, pal.accent, 0, () => g.rect(x0 + len * 0.62, -cw / 2 + r * 0.06, r * 0.08, cw - r * 0.12));
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
      const bw = Math.min(boreW(m, r), r * (multi ? 0.3 : 0.5));
      stretched(g, m, () => {
        for (const y of spreadOffsets(n, r * 0.9)) {
          barrel(g, 0, len, y, bw, o);
          // fume extractor + slotted muzzle brake
          barrel(g, len * 0.55, len * 0.68, y, bw * 1.3, o * 0.7, METAL.base);
          // big double-baffle muzzle brake: the artillery tell
          brake(g, len + bw * 0.3, y, bw, multi ? 1.7 : 2.1, bw * 1.6, 2, o * 0.7);
          // recoil sled rails
          if (!multi) for (const s of [-1, 1]) shape(g, METAL.light, o * 0.5, () => roundRect(g, r * 0.4, y + s * bw * 0.85 - bw * 0.2, r * 0.95, bw * 0.4, bw * 0.2));
        }
      });
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 1.1, -r * 0.9, r * 1.8, r * 1.8, r * 0.25));
      shape(g, METAL.dark, o * 0.7, () => roundRect(g, r * 0.25, -r * 0.65, r * 0.6, r * 1.3, r * 0.15));
      g.strokeStyle = rgba(pal.deep, 0.5); lw(g, o * 0.5);
      for (const x of [-0.6, -0.15]) { g.beginPath(); g.moveTo(x * r, -r * 0.85); g.lineTo(x * r, r * 0.85); g.stroke(); }
      rivets(g, [-r * 0.9, -r * 0.7, -r * 0.9, r * 0.7, r * 0.5, -r * 0.75, r * 0.5, r * 0.75], r * 0.06);
      break;
    }
    case 'laser': {
      // slim emitter tube: a block of heat-sink fins behind a lens collar, glowing lens at the tip
      const len = r * 1.95;
      for (const y of spreadOffsets(n, r * 0.8)) {
        shape(g, METAL.dark, o, () => roundRect(g, 0, y - r * 0.11, len, r * 0.22, r * 0.1));
        for (let i = 0; i < 4; i++) shape(g, METAL.light, o * 0.4, () => roundRect(g, r * (0.78 + i * 0.17), y - r * 0.24, r * 0.08, r * 0.48, r * 0.03));
        shape(g, METAL.base, o * 0.6, () => roundRect(g, len - r * 0.3, y - r * 0.16, r * 0.3, r * 0.32, r * 0.08));
        shape(g, rgba(glow, 0.95), 0, () => g.ellipse(len - r * 0.02, y, r * 0.05, r * 0.12, 0, 0, Math.PI * 2));
        glowDot(g, len, y, r * 0.1, glow);
      }
      shape(g, teamGrad(g, pal, r), o, () => g.arc(-r * 0.08, 0, r * 0.74, 0, Math.PI * 2));
      shape(g, rgba(glow, 0.9), o * 0.5, () => g.ellipse(-r * 0.2, 0, r * 0.3, r * 0.2, 0, 0, Math.PI * 2));
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
      const bw = boreW(m, r);
      // long AA barrels (high muzzle velocity) with cone flash hiders
      const len = r * 2.3;
      for (const y of spreadOffsets(nb, r * (nb >= 3 ? 1.0 : 0.55))) {
        barrel(g, 0, len, y, bw, o);
        shape(g, METAL.dark, o * 0.6, () => { g.moveTo(len - bw * 1.3, y - bw * 0.55); g.lineTo(len, y - bw * 0.9); g.lineTo(len, y + bw * 0.9); g.lineTo(len - bw * 1.3, y + bw * 0.55); g.closePath(); });
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
      glowDot(g, r * 0.6, -r * 0.45, r * 0.06, m.stun ? '#7fc8ff' : '#ff3030');
      if (m.stun) {
        // stun / EMP bombs: electric-blue bands round the casings and a crackling arc instead of the red fuse
        g.strokeStyle = '#86adff'; lw(g, r * 0.08);
        for (const x of [-0.45, 0, 0.45]) { g.beginPath(); g.moveTo(x * r - r * 0.18, 0); g.lineTo(x * r + r * 0.18, 0); g.stroke(); }
        glowDot(g, 0, 0, r * 0.12, '#a8d8ff');
      }
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

/* ===================================================================================================
 * Giant (G) and Titan (T) class turrets. r = d / 2. Everything points +x; sprite half-extent is 3.5 r.
 * ================================================================================================ */

const P2 = Math.PI * 2;
const GOLD = '#e8c25a';

function baseRing(g: Ctx, r: number, o: number, cx = 0, rad = 1.1, col = METAL.dark): void {
  shape(g, col, o, () => g.arc(cx, 0, r * rad, 0, P2));
  g.strokeStyle = 'rgba(255,255,255,0.18)'; lw(g, o * 0.6);
  g.beginPath(); g.arc(cx, 0, r * rad * 0.9, 0, P2); g.stroke();
}

function bolts(g: Ctx, r: number, n: number, rad: number, cx = 0, cy = 0, br = 0.045): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * P2 + 0.3;
    rivets(g, [cx + Math.cos(a) * r * rad, cy + Math.sin(a) * r * rad], r * br);
  }
}

function hexPath(g: Ctx, x: number, y: number, R: number, rot = 0): void {
  for (let i = 0; i < 6; i++) { const a = rot + (i / 6) * P2; if (i === 0) g.moveTo(x + Math.cos(a) * R, y + Math.sin(a) * R); else g.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R); }
  g.closePath();
}

function hexGrid(g: Ctx, R: number, cell: number, col: string, w: number): void {
  g.strokeStyle = col; lw(g, w);
  g.beginPath();
  const h = cell * Math.sqrt(3) / 2;
  for (let row = -6; row <= 6; row++) for (let c = -6; c <= 6; c++) {
    const x = c * cell * 1.5, y = row * h * 2 + (c & 1 ? h : 0);
    if (Math.hypot(x, y) > R + cell) continue;
    hexPath(g, x, y, cell * 0.95, 0);
  }
  g.stroke();
}

function domeGlass(g: Ctx, R: number, c0: string, c1: string, o: number, hx = 0): void {
  const gr = g.createRadialGradient(-R * 0.3 + hx, -R * 0.3, R * 0.05, hx, 0, R);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, c0); gr.addColorStop(1, c1);
  shape(g, gr, o, () => g.arc(hx, 0, R, 0, P2));
  g.save(); g.beginPath(); g.arc(hx, 0, R, 0, P2); g.clip();
  g.translate(hx, 0);
  hexGrid(g, R, R * 0.3, 'rgba(255,255,255,0.35)', R * 0.025);
  g.restore();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath(); g.ellipse(hx - R * 0.32, -R * 0.4, R * 0.28, R * 0.13, -0.6, 0, P2); g.fill();
}

function spire(g: Ctx, a: number, r0: number, r1: number, w: number, o: number, tip: string): void {
  g.save();
  g.rotate(a);
  g.beginPath(); g.moveTo(r0, -w); g.lineTo(r1, -w * 0.25); g.lineTo(r1, w * 0.25); g.lineTo(r0, w); g.closePath();
  g.fillStyle = metalGrad(g, r1, METAL.light); g.fill(); lw(g, o * 0.8); g.strokeStyle = OUTLINE; g.stroke();
  for (let i = 1; i <= 3; i++) {
    const x = r0 + (r1 - r0) * (i / 4.2);
    shape(g, '#c88a3c', o * 0.4, () => roundRect(g, x, -w * (1 - 0.6 * (i / 4)) - w * 0.2, (r1 - r0) * 0.07, (w * (1 - 0.6 * (i / 4)) + w * 0.2) * 2, w * 0.1));
  }
  glowDot(g, r1, 0, w * 0.5, tip);
  g.restore();
}

function jag(g: Ctx, x0: number, y0: number, x1: number, y1: number, seed: number, amp: number, col: string, w: number): void {
  const n = 5;
  g.beginPath(); g.moveTo(x0, y0);
  for (let i = 1; i < n; i++) {
    const f = i / n;
    const nx = -(y1 - y0), ny = x1 - x0, l = Math.hypot(nx, ny) || 1;
    const j = Math.sin(seed * 12.9898 + i * 78.233) * amp;
    g.lineTo(x0 + (x1 - x0) * f + (nx / l) * j, y0 + (y1 - y0) * f + (ny / l) * j);
  }
  g.lineTo(x1, y1);
  g.strokeStyle = rgba(col.length === 7 ? col : '#a8d8ff', 0.35); lw(g, w * 3); g.stroke();
  g.strokeStyle = '#ffffff'; lw(g, w); g.stroke();
}

/** Spinning grinder wheel (also redrawn rotated each frame by drawTurretDynamic). */
export function grinderWheel(g: Ctx, R: number, o: number, rot: number, hot = '#ff8a30'): void {
  g.save();
  g.rotate(rot);
  const N = 16;
  g.beginPath();
  for (let i = 0; i < N; i++) {
    const a = (i / N) * P2, b = ((i + 0.5) / N) * P2, c = ((i + 1) / N) * P2;
    if (i === 0) g.moveTo(Math.cos(a) * R * 0.86, Math.sin(a) * R * 0.86);
    g.lineTo(Math.cos(a + 0.01) * R * 0.86, Math.sin(a + 0.01) * R * 0.86);
    g.lineTo(Math.cos(b) * R * 1.02, Math.sin(b) * R * 1.02);
    g.lineTo(Math.cos(c - 0.01) * R * 0.86, Math.sin(c - 0.01) * R * 0.86);
  }
  g.closePath();
  const gr = g.createLinearGradient(-R, -R, R, R);
  gr.addColorStop(0, '#d8dee4'); gr.addColorStop(0.5, '#7d8790'); gr.addColorStop(1, '#3a4148');
  g.fillStyle = gr; g.fill(); lw(g, o); g.strokeStyle = OUTLINE; g.stroke();
  // cut-outs
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * P2;
    g.beginPath(); g.arc(0, 0, R * 0.68, a + 0.12, a + P2 / 6 - 0.12); g.arc(0, 0, R * 0.36, a + P2 / 6 - 0.12, a + 0.12, true); g.closePath();
    g.fillStyle = '#0d1013'; g.fill();
  }
  g.strokeStyle = hot; lw(g, R * 0.04); g.globalAlpha = 0.7;
  g.beginPath(); g.arc(0, 0, R * 0.8, 0, P2); g.stroke(); g.globalAlpha = 1;
  shape(g, METAL.dark, o, () => g.arc(0, 0, R * 0.26, 0, P2));
  shape(g, METAL.light, o * 0.6, () => g.arc(0, 0, R * 0.13, 0, P2));
  g.restore();
}

function drawGiantTurret(g: Ctx, m: ModuleDef, pal: TeamPal, r: number, o: number, glow: string): boolean {
  switch (m.id) {
    case 'siege240': {
      baseRing(g, r, o, -r * 0.1, 1.2);
      for (const y of [-0.52, 0.52]) { barrel(g, r * 0.4, r * 1.9, y * r, r * 0.17, o, METAL.light); barrel(g, r * 0.2, r * 1.0, y * r, r * 0.3, o, METAL.dark); }
      // one long, slim siege barrel: thick recoil collar at the mantlet, bore evacuator, three-baffle brake
      barrel(g, 0, r * 3.15, 0, r * 0.3, o);
      shape(g, METAL.dark, o * 0.7, () => roundRect(g, r * 0.7, -r * 0.27, r * 0.45, r * 0.54, r * 0.08));
      // bore evacuator
      shape(g, metalGrad(g, r * 0.4, METAL.light), o, () => roundRect(g, r * 1.75, -r * 0.24, r * 0.5, r * 0.48, r * 0.12));
      g.strokeStyle = METAL.deep; lw(g, r * 0.035);
      g.beginPath(); for (let i = 1; i < 4; i++) { g.moveTo(r * (1.75 + i * 0.125), -r * 0.21); g.lineTo(r * (1.75 + i * 0.125), r * 0.21); } g.stroke();
      // muzzle brake
      shape(g, METAL.dark, o, () => roundRect(g, r * 2.85, -r * 0.36, r * 0.6, r * 0.72, r * 0.1));
      for (let i = 0; i < 3; i++) shape(g, '#05070a', 0, () => g.rect(r * (2.95 + i * 0.16), -r * 0.36, r * 0.07, r * 0.72));
      shape(g, METAL.light, o * 0.5, () => roundRect(g, r * 2.83, -r * 0.38, r * 0.08, r * 0.76, r * 0.02));
      // bustle
      shape(g, teamGrad(g, pal, r), o, () => {
        g.moveTo(r * 0.95, -r * 0.7); g.lineTo(r * 0.6, -r * 1.05); g.lineTo(-r * 0.9, -r * 1.05); g.lineTo(-r * 1.2, -r * 0.6);
        g.lineTo(-r * 1.2, r * 0.6); g.lineTo(-r * 0.9, r * 1.05); g.lineTo(r * 0.6, r * 1.05); g.lineTo(r * 0.95, r * 0.7); g.closePath();
      });
      g.strokeStyle = rgba(pal.deep, 0.55); lw(g, o * 0.6);
      g.beginPath(); g.moveTo(-r * 0.3, -r * 1.0); g.lineTo(-r * 0.3, r * 1.0); g.moveTo(r * 0.3, -r * 0.98); g.lineTo(r * 0.3, r * 0.98); g.stroke();
      hazard(g, -r * 1.16, -r * 0.4, r * 0.22, r * 0.8);
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.6, -r * 0.5, r * 0.4, r * 1.0, r * 0.1));
      hatch(g, -r * 0.55, -r * 0.55, r * 0.26, o); hatch(g, -r * 0.55, r * 0.55, r * 0.2, o);
      shape(g, METAL.light, o * 0.5, () => roundRect(g, -r * 0.1, -r * 0.2, r * 0.45, r * 0.4, r * 0.08));
      glowDot(g, r * 0.2, 0, r * 0.05, '#ff5030');
      rivets(g, [-r * 0.8, -r * 0.85, -r * 0.8, r * 0.85, r * 0.5, -r * 0.88, r * 0.5, r * 0.88], r * 0.06);
      return true;
    }
    case 'avenger': {
      // ammo drum behind
      shape(g, metalGrad(g, r, METAL.dark), o, () => g.arc(-r * 0.75, 0, r * 1.0, 0, P2));
      g.strokeStyle = 'rgba(255,255,255,0.25)'; lw(g, r * 0.06);
      for (const k of [0.8, 0.55, 0.3]) { g.beginPath(); g.arc(-r * 0.75, 0, r * k, 0, P2); g.stroke(); }
      for (let i = 0; i < 12; i++) { const a = (i / 12) * P2; g.beginPath(); g.moveTo(-r * 0.75 + Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3); g.lineTo(-r * 0.75 + Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8); g.stroke(); }
      shape(g, '#c9a040', o * 0.5, () => g.arc(-r * 0.75, 0, r * 0.2, 0, P2));
      // seven thin barrels round the spin axis in clamp rings (spun by drawTurretDynamic while firing)
      avengerCluster(g, m, r, o, 0);
      // belt
      for (let i = 0; i < 7; i++) shape(g, '#c9a040', o * 0.3, () => roundRect(g, -r * 0.3 + i * r * 0.1, r * 0.45 + Math.sin(i * 0.9) * r * 0.05, r * 0.08, r * 0.22, r * 0.02));
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.2, -r * 1.0, r * 1.3, r * 2.0, r * 0.35));
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.55, -r * 0.55, r * 0.35, r * 1.1, r * 0.1));
      hatch(g, r * 0.1, -r * 0.45, r * 0.24, o);
      shape(g, pal.accent, 0, () => roundRect(g, -r * 0.15, -r * 0.1, r * 0.15, r * 0.2, r * 0.03));
      return true;
    }
    case 'missilebattery': {
      baseRing(g, r, o, 0, 1.25);
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 1.1, -r * 1.1, r * 2.3, r * 2.2, r * 0.18));
      shape(g, METAL.dark, o * 0.7, () => roundRect(g, r * 1.05, -r * 1.12, r * 0.22, r * 2.24, r * 0.05));
      const cell = r * 0.48, x0 = -r * 0.85, y0 = -r * 0.96;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const cx = x0 + j * cell, cy = y0 + i * cell;
        shape(g, '#0a0c0e', o * 0.5, () => roundRect(g, cx + cell * 0.04, cy + cell * 0.04, cell * 0.92, cell * 0.92, cell * 0.14));
        shape(g, j >= 3 ? '#e4e0d4' : '#c8c4b8', 0, () => roundRect(g, cx + cell * 0.14, cy + cell * 0.14, cell * 0.72, cell * 0.72, cell * 0.12));
        g.strokeStyle = '#c0392b'; lw(g, cell * 0.07);
        g.beginPath(); g.arc(cx + cell * 0.5, cy + cell * 0.5, cell * 0.25, 0, P2); g.stroke();
        shape(g, '#ff7ab0', 0, () => g.arc(cx + cell * 0.5, cy + cell * 0.5, cell * 0.1, 0, P2));
      }
      const gr = g.createLinearGradient(-r * 0.85, 0, r * 1.1, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)');
      g.fillStyle = gr; g.fillRect(-r * 0.9, -r * 1.0, r * 2.0, r * 2.0);
      hazard(g, -r * 1.08, -r * 0.9, r * 0.16, r * 1.8);
      // sensor mast
      shape(g, METAL.light, o * 0.6, () => g.ellipse(-r * 0.95, -r * 0.95, r * 0.18, r * 0.12, 0, 0, P2));
      glowDot(g, -r * 0.95, -r * 0.95, r * 0.05, '#ff4040');
      return true;
    }
    case 'siegeplasma': {
      baseRing(g, r, o, 0, 1.2);
      shape(g, metalGrad(g, r, METAL.dark), o, () => { g.moveTo(r * 0.6, -r * 0.4); g.lineTo(r * 2.35, -r * 0.7); g.lineTo(r * 2.35, r * 0.7); g.lineTo(r * 0.6, r * 0.4); g.closePath(); });
      for (let i = 0; i < 4; i++) { const x = r * (0.95 + i * 0.37), h = r * (0.45 + i * 0.1); shape(g, '#7a3aa8', o * 0.5, () => roundRect(g, x, -h, r * 0.14, h * 2, r * 0.04)); glowDot(g, x + r * 0.07, -h, r * 0.04, '#e070ff'); glowDot(g, x + r * 0.07, h, r * 0.04, '#e070ff'); }
      glowDot(g, r * 2.4, 0, r * 0.24, '#e070ff');
      for (const s of [-1, 1]) shape(g, metalGrad(g, r * 0.4, METAL.base), o, () => roundRect(g, -r * 1.0, s * r * 0.9 - r * 0.2, r * 1.5, r * 0.4, r * 0.2));
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 1.15, -r * 0.85, r * 1.9, r * 1.7, r * 0.4));
      // containment sphere
      shape(g, '#14081c', o, () => g.arc(-r * 0.1, 0, r * 0.7, 0, P2));
      const gr = g.createRadialGradient(-r * 0.1, 0, 0, -r * 0.1, 0, r * 0.62);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.3, '#ff80f0'); gr.addColorStop(0.7, '#7a2aa8'); gr.addColorStop(1, '#14081c');
      shape(g, gr, 0, () => g.arc(-r * 0.1, 0, r * 0.62, 0, P2));
      for (const a of [0, 1.05, 2.1]) { g.save(); g.translate(-r * 0.1, 0); g.rotate(a); g.strokeStyle = METAL.light; lw(g, r * 0.07); g.beginPath(); g.ellipse(0, 0, r * 0.78, r * 0.3, 0, 0, P2); g.stroke(); lw(g, r * 0.025); g.strokeStyle = '#e070ff'; g.stroke(); g.restore(); }
      return true;
    }
    case 'skyfortress': {
      baseRing(g, r, o, 0, 1.25);
      for (const y of [-0.68, -0.23, 0.23, 0.68]) {
        barrel(g, 0, r * 2.35, y * r, r * 0.2, o);
        shape(g, METAL.dark, o * 0.6, () => { g.moveTo(r * 2.2, y * r - r * 0.12); g.lineTo(r * 2.62, y * r - r * 0.24); g.lineTo(r * 2.62, y * r + r * 0.24); g.lineTo(r * 2.2, y * r + r * 0.12); g.closePath(); });
        shape(g, METAL.base, o * 0.5, () => roundRect(g, r * 1.0, y * r - r * 0.15, r * 0.22, r * 0.3, r * 0.05));
      }
      for (const s of [-1, 1]) { shape(g, metalGrad(g, r * 0.4, '#6a5a2a'), o, () => roundRect(g, -r * 0.9, s * r * 0.98 - r * 0.2, r * 1.2, r * 0.4, r * 0.18)); }
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 1.05, -r * 0.95, r * 1.95, r * 1.9, r * 0.4));
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.5, -r * 0.88, r * 0.3, r * 1.76, r * 0.1));
      // radar dish
      shape(g, METAL.dark, o * 0.6, () => g.arc(-r * 0.4, 0, r * 0.2, 0, P2));
      shape(g, metalGrad(g, r * 0.5, METAL.light), o * 0.7, () => g.ellipse(-r * 0.4, 0, r * 0.28, r * 0.72, 0, 0, P2));
      g.strokeStyle = METAL.dark; lw(g, r * 0.05);
      g.beginPath(); g.moveTo(-r * 0.4, -r * 0.65); g.lineTo(-r * 0.4, r * 0.65); g.moveTo(-r * 0.4, 0); g.lineTo(0, 0); g.stroke();
      glowDot(g, 0, 0, r * 0.06, '#ff5050');
      hatch(g, r * 0.25, -r * 0.5, r * 0.18, o); hatch(g, r * 0.25, r * 0.5, r * 0.18, o);
      return true;
    }
    case 'stormtower': {
      dot2(g, r * 0.12, r * 0.14, r * 1.05, 'rgba(0,0,0,0.35)');
      baseRing(g, r, o, 0, 1.15);
      const layers = 5;
      for (let k = 0; k < layers; k++) {
        const R = r * (1.0 - k * 0.16), cx = -k * r * 0.04, cy = -k * r * 0.05;
        const coil = k % 2 === 0;
        const gr = g.createRadialGradient(cx - R * 0.3, cy - R * 0.3, 0, cx, cy, R);
        gr.addColorStop(0, coil ? '#f0b868' : '#e6eef4'); gr.addColorStop(1, coil ? '#8a5a20' : '#6c7a88');
        shape(g, gr, o * 0.8, () => g.arc(cx, cy, R, 0, P2));
        if (coil) { g.strokeStyle = 'rgba(60,30,0,0.5)'; lw(g, R * 0.04); for (let q = 1; q < 4; q++) { g.beginPath(); g.arc(cx, cy, R * (1 - q * 0.08), 0, P2); g.stroke(); } }
        else { g.strokeStyle = 'rgba(255,255,255,0.5)'; lw(g, R * 0.03); g.beginPath(); g.arc(cx, cy, R * 0.9, 3.3, 4.7); g.stroke(); }
      }
      const tx = -layers * r * 0.04, ty = -layers * r * 0.05;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * P2 + 0.785;
        const x1 = Math.cos(a) * r * 1.25, y1 = Math.sin(a) * r * 1.25;
        g.strokeStyle = OUTLINE; lw(g, r * 0.15); g.beginPath(); g.moveTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55); g.lineTo(x1, y1); g.stroke();
        g.strokeStyle = METAL.light; lw(g, r * 0.08); g.stroke();
        glowDot(g, x1, y1, r * 0.08, '#a8d8ff');
        jag(g, x1, y1, tx, ty, i + 1, r * 0.2, '#a8d8ff', r * 0.03);
      }
      shape(g, '#e8f6ff', o * 0.6, () => g.arc(tx, ty, r * 0.2, 0, P2));
      glowDot(g, tx, ty, r * 0.18, '#a8d8ff');
      return true;
    }
    case 'inferno': {
      baseRing(g, r, o, 0, 1.25);
      for (const s of [-1, 1]) {
        shape(g, '#c8432a', o, () => roundRect(g, -r * 1.3, s * r * 1.0 - r * 0.38, r * 1.7, r * 0.76, r * 0.38));
        const gr = g.createLinearGradient(0, s * r * 1.0 - r * 0.38, 0, s * r * 1.0 + r * 0.38);
        gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)');
        g.fillStyle = gr; g.beginPath(); roundRect(g, -r * 1.3, s * r * 1.0 - r * 0.38, r * 1.7, r * 0.76, r * 0.38); g.fill();
        hazard(g, -r * 0.8, s * r * 1.0 - r * 0.38, r * 0.3, r * 0.76);
        shape(g, '#ffa040', 0, () => { g.moveTo(-r * 0.2, s * r); g.lineTo(-r * 0.05, s * r * 1.0 - r * 0.2); g.lineTo(r * 0.1, s * r); g.lineTo(-r * 0.05, s * r + r * 0.2); g.closePath(); });
        g.strokeStyle = METAL.dark; lw(g, r * 0.12); g.beginPath(); g.moveTo(r * 0.3, s * r * 0.95); g.lineTo(r * 0.6, s * r * 0.5); g.stroke();
        // nozzle
        shape(g, metalGrad(g, r * 0.4, METAL.dark), o, () => { g.moveTo(r * 0.5, s * r * 0.5 - r * 0.2); g.lineTo(r * 2.2, s * r * 0.5 - r * 0.34); g.lineTo(r * 2.2, s * r * 0.5 + r * 0.34); g.lineTo(r * 0.5, s * r * 0.5 + r * 0.2); g.closePath(); });
        shape(g, METAL.light, o * 0.6, () => roundRect(g, r * 2.05, s * r * 0.5 - r * 0.4, r * 0.2, r * 0.8, r * 0.05));
        for (const x of [1.0, 1.5]) shape(g, METAL.base, o * 0.5, () => roundRect(g, r * x, s * r * 0.5 - r * 0.3, r * 0.1, r * 0.6, r * 0.03));
        glowDot(g, r * 2.28, s * r * 0.5, r * 0.15, '#ffa040');
      }
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.7, -r * 0.8, r * 1.6, r * 1.6, r * 0.3));
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.3, -r * 0.5, r * 0.4, r, r * 0.1));
      hatch(g, -r * 0.3, 0, r * 0.28, o);
      shape(g, '#2a2a2a', o * 0.5, () => g.arc(-r * 0.3, -r * 0.5, r * 0.15, 0, P2));
      return true;
    }
    case 'grinder': {
      baseRing(g, r, o, 0, 1.15);
      for (const s of [-1, 1]) {
        g.strokeStyle = OUTLINE; lw(g, r * 0.36); g.beginPath(); g.moveTo(r * 0.3, s * r * 0.55); g.lineTo(r * 2.05, s * r * 0.2); g.stroke();
        g.strokeStyle = METAL.base; lw(g, r * 0.26); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.25)'; lw(g, r * 0.07); g.stroke();
      }
      g.save(); g.translate(r * 2.1, 0); grinderWheel(g, r * 1.05, o, 0); g.restore();
      shape(g, teamGrad(g, pal, r), o, () => { g.moveTo(r * 0.8, -r * 0.7); g.lineTo(-r * 0.7, -r * 0.95); g.lineTo(-r * 1.1, -r * 0.5); g.lineTo(-r * 1.1, r * 0.5); g.lineTo(-r * 0.7, r * 0.95); g.lineTo(r * 0.8, r * 0.7); g.closePath(); });
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, -r * 0.7, -r * 0.4, r * 1.0, r * 0.8, r * 0.14));
      hazard(g, -r * 1.05, -r * 0.25, r * 0.2, r * 0.5);
      glowDot(g, r * 0.0, 0, r * 0.1, '#ff8a30');
      return true;
    }
    case 'bulwarkshield': {
      shape(g, METAL.dark, o, () => hexPath(g, 0, 0, r * 1.2, 0.52));
      shape(g, teamGrad(g, pal, r), o * 0.8, () => hexPath(g, 0, 0, r * 1.05, 0.52));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * P2; shape(g, METAL.light, o * 0.5, () => roundRect(g, Math.cos(a) * r * 1.05 - r * 0.12, Math.sin(a) * r * 1.05 - r * 0.12, r * 0.24, r * 0.24, r * 0.05)); glowDot(g, Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05, r * 0.07, '#7fd8ff'); }
      domeGlass(g, r * 0.78, '#9fe8ff', '#1a5a8a', o);
      g.strokeStyle = rgba('#7fd8ff', 0.8); lw(g, r * 0.05); g.beginPath(); g.arc(0, 0, r * 0.92, 0, P2); g.stroke();
      return true;
    }
    case 'domeG': {
      baseRing(g, r, o, 0, 1.3, METAL.dark);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * P2 + 0.2; g.save(); g.rotate(a); shape(g, metalGrad(g, r * 0.4, METAL.light), o * 0.6, () => roundRect(g, r * 0.95, -r * 0.1, r * 0.4, r * 0.2, r * 0.05)); glowDot(g, r * 1.42, 0, r * 0.07, '#5aff9a'); g.restore(); }
      shape(g, teamGrad(g, pal, r), o, () => g.arc(0, 0, r * 1.0, 0, P2));
      domeGlass(g, r * 0.82, '#a0ffc8', '#1a7a50', o);
      g.strokeStyle = rgba('#5aff9a', 0.9); lw(g, r * 0.05);
      for (const k of [0.65, 0.92]) { g.beginPath(); g.arc(0, 0, r * k, 0, P2); g.stroke(); }
      shape(g, METAL.dark, o * 0.7, () => g.arc(0, 0, r * 0.2, 0, P2));
      glowDot(g, 0, 0, r * 0.14, '#5aff9a');
      return true;
    }
    case 'massdriver': {
      baseRing(g, r, o, -r * 0.3, 1.15);
      // rails
      shape(g, '#0a1830', o, () => roundRect(g, r * 0.2, -r * 0.5, r * 3.2, r * 1.0, r * 0.12));
      for (const y of [-0.36, 0.36]) barrel(g, r * 0.1, r * 3.45, y * r, r * 0.28, o, METAL.light);
      g.strokeStyle = glow; lw(g, r * 0.14); g.beginPath(); g.moveTo(r * 0.4, 0); g.lineTo(r * 3.4, 0); g.stroke();
      g.strokeStyle = '#ffffff'; lw(g, r * 0.04); g.stroke();
      for (let i = 0; i < 6; i++) { const x = r * (0.65 + i * 0.5); shape(g, '#c27a3a', o * 0.6, () => roundRect(g, x, -r * 0.62, r * 0.17, r * 1.24, r * 0.05)); g.fillStyle = glow; g.fillRect(x + r * 0.03, -r * 0.62, r * 0.11, r * 0.06); g.fillRect(x + r * 0.03, r * 0.56, r * 0.11, r * 0.06); }
      glowDot(g, r * 3.45, 0, r * 0.2, glow);
      // capacitor bank
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 1.35, -r * 1.05, r * 1.9, r * 2.1, r * 0.3));
      for (let i = 0; i < 3; i++) { const y = (i - 1) * r * 0.62; shape(g, '#0a1830', o * 0.7, () => roundRect(g, -r * 1.15, y - r * 0.24, r * 1.3, r * 0.48, r * 0.24)); g.fillStyle = rgba('#9fe8ff', 0.8); g.fillRect(-r * 1.0, y - r * 0.08, r * 1.0, r * 0.16); glowDot(g, r * 0.1, y, r * 0.06, glow); }
      hazard(g, -r * 1.3, -r * 0.95, r * 0.18, r * 1.9);
      g.strokeStyle = METAL.dark; lw(g, r * 0.1); g.beginPath(); g.moveTo(r * 0.55, -r * 0.62); g.lineTo(r * 0.55, -r * 0.4); g.moveTo(r * 0.55, r * 0.62); g.lineTo(r * 0.55, r * 0.4); g.stroke();
      return true;
    }
    case 'doomsday': {
      for (const s of [-1, 1]) {
        g.strokeStyle = OUTLINE; lw(g, r * 0.3); g.beginPath(); g.moveTo(-r * 0.5, s * r * 0.5); g.lineTo(-r * 1.9, s * r * 1.15); g.stroke();
        g.strokeStyle = METAL.dark; lw(g, r * 0.18); g.stroke();
        shape(g, METAL.base, o * 0.7, () => roundRect(g, -r * 2.15, s * r * 1.15 - r * 0.3, r * 0.35, r * 0.6, r * 0.06));
        hazard(g, -r * 2.1, s * r * 1.15 - r * 0.25, r * 0.16, r * 0.5);
      }
      baseRing(g, r, o, -r * 0.1, 1.25);
      stretched(g, m, () => {
        for (const y of [-0.55, 0.55]) {
          barrel(g, 0, r * 3.1, y * r, r * 0.36, o);
          barrel(g, r * 1.2, r * 1.65, y * r, r * 0.48, o * 0.7, METAL.base);
          brake(g, r * 3.4, y * r, r * 0.36, 2.0, r * 0.6, 2, o);
        }
      });
      shape(g, METAL.dark, o * 0.7, () => roundRect(g, r * 0.5, -r * 1.0, r * 0.4, r * 2.0, r * 0.1));
      shape(g, teamGrad(g, pal, r), o, () => { g.moveTo(r * 0.5, -r * 1.2); g.lineTo(-r * 0.9, -r * 1.2); g.lineTo(-r * 1.2, -r * 0.7); g.lineTo(-r * 1.2, r * 0.7); g.lineTo(-r * 0.9, r * 1.2); g.lineTo(r * 0.5, r * 1.2); g.closePath(); });
      g.strokeStyle = rgba(pal.deep, 0.5); lw(g, o * 0.6); g.beginPath(); g.moveTo(-r * 0.3, -r * 1.15); g.lineTo(-r * 0.3, r * 1.15); g.stroke();
      hatch(g, -r * 0.5, -r * 0.7, r * 0.28, o); hatch(g, -r * 0.5, r * 0.7, r * 0.28, o);
      shape(g, '#4a5a3a', o * 0.6, () => roundRect(g, -r * 0.9, -r * 0.3, r * 0.9, r * 0.6, r * 0.08));
      g.fillStyle = '#c9a040'; for (let i = 0; i < 5; i++) g.fillRect(-r * 0.8 + i * r * 0.17, -r * 0.2, r * 0.1, r * 0.4);
      return true;
    }
    case 'annihilator': {
      baseRing(g, r, o, -r * 0.2, 1.2);
      const tip = r * 2.35;
      for (const s of [-1, 1]) {
        shape(g, metalGrad(g, r * 0.4, METAL.dark), o, () => { g.moveTo(r * 0.3, s * r * 0.5 - r * 0.2); g.lineTo(tip, s * r * 0.45 - r * 0.32); g.lineTo(tip, s * r * 0.45 + r * 0.32); g.lineTo(r * 0.3, s * r * 0.5 + r * 0.2); g.closePath(); });
        for (let i = 0; i < 4; i++) { const x = r * (0.7 + i * 0.4), h = r * (0.26 + i * 0.03); shape(g, '#7a3aa8', o * 0.5, () => roundRect(g, x, s * r * 0.48 - h, r * 0.13, h * 2, r * 0.04)); }
        glowDot(g, tip + r * 0.05, s * r * 0.45, r * 0.16, '#e070ff');
        g.strokeStyle = rgba('#e070ff', 0.6); lw(g, r * 0.04); g.beginPath(); g.moveTo(tip + r * 0.05, s * r * 0.45); g.lineTo(r * 2.95, 0); g.stroke();
        g.strokeStyle = METAL.base; lw(g, r * 0.09); g.beginPath(); g.moveTo(tip - r * 0.1, s * r * 0.45); g.lineTo(r * 2.75, s * r * 0.2); g.stroke();
      }
      // focusing lens
      shape(g, METAL.dark, o, () => g.arc(r * 2.95, 0, r * 0.5, 0, P2));
      shape(g, METAL.light, o * 0.6, () => g.arc(r * 2.95, 0, r * 0.4, 0, P2));
      const gr = g.createRadialGradient(r * 2.95, 0, 0, r * 2.95, 0, r * 0.34);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.4, '#ff80f0'); gr.addColorStop(1, '#5a1a80');
      shape(g, gr, o * 0.5, () => g.arc(r * 2.95, 0, r * 0.34, 0, P2));
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 1.2, -r * 1.0, r * 1.9, r * 2.0, r * 0.4));
      for (const s of [-1, 1]) { shape(g, '#14081c', o, () => g.arc(-r * 0.2, s * r * 0.5, r * 0.36, 0, P2)); glowDot(g, -r * 0.2, s * r * 0.5, r * 0.2, '#e070ff'); }
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.35, -r * 0.8, r * 0.3, r * 1.6, r * 0.08));
      return true;
    }
    case 'tactnuke': {
      baseRing(g, r, o, -r * 0.8, 1.1);
      // erector rails
      for (const s of [-1, 1]) {
        shape(g, METAL.dark, o, () => roundRect(g, -r * 0.9, s * r * 0.68 - r * 0.1, r * 3.0, r * 0.2, r * 0.05));
        g.fillStyle = '#e8b81c'; for (let i = 0; i < 6; i++) g.fillRect(-r * 0.7 + i * r * 0.5, s * r * 0.68 - r * 0.06, r * 0.18, r * 0.12);
      }
      // hydraulic ram (animated with the missile on unit sprites)
      if (!BAKE) {
        g.strokeStyle = OUTLINE; lw(g, r * 0.2); g.beginPath(); g.moveTo(-r * 0.9, r * 0.2); g.lineTo(r * 0.5, r * 0.62); g.stroke();
        g.strokeStyle = METAL.light; lw(g, r * 0.1); g.stroke();
      }
      if (!BAKE) nukeMissile(g, r, o, 0);
      // clamps
      for (const x of [0.2, 1.8]) shape(g, METAL.dark, o * 0.8, () => roundRect(g, r * x, -r * 0.62, r * 0.28, r * 1.24, r * 0.06));
      // pivot housing
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 1.4, -r * 0.95, r * 1.1, r * 1.9, r * 0.3));
      hatch(g, -r * 0.95, -r * 0.5, r * 0.2, o);
      hazard(g, -r * 1.35, r * 0.3, r * 0.9, r * 0.2);
      return true;
    }
    case 'titanfist': {
      baseRing(g, r, o, -r * 0.3, 1.25);
      // piston arms
      for (const y of [-0.38, 0.38]) { barrel(g, r * 0.4, r * 1.9, y * r, r * 0.32, o, METAL.light); barrel(g, r * 0.4, r * 1.1, y * r, r * 0.46, o, METAL.dark); }
      // shoulder ball
      shape(g, teamGrad(g, pal, r), o, () => g.arc(-r * 0.35, 0, r * 1.0, 0, P2));
      g.strokeStyle = GOLD; lw(g, r * 0.07); g.beginPath(); g.arc(-r * 0.35, 0, r * 0.82, 0, P2); g.stroke();
      hatch(g, -r * 0.35, 0, r * 0.3, o);
      // elbow + forearm
      shape(g, METAL.dark, o, () => roundRect(g, r * 1.7, -r * 0.66, r * 0.45, r * 1.32, r * 0.14));
      shape(g, teamGrad(g, pal, r), o, () => { g.moveTo(r * 1.95, -r * 0.7); g.lineTo(r * 2.95, -r * 0.62); g.lineTo(r * 2.95, r * 0.62); g.lineTo(r * 1.95, r * 0.7); g.closePath(); });
      g.strokeStyle = GOLD; lw(g, r * 0.05); g.beginPath(); g.moveTo(r * 2.05, -r * 0.55); g.lineTo(r * 2.85, -r * 0.5); g.moveTo(r * 2.05, r * 0.55); g.lineTo(r * 2.85, r * 0.5); g.stroke();
      // fist
      shape(g, metalGrad(g, r, METAL.light), o, () => roundRect(g, r * 2.75, -r * 0.82, r * 0.85, r * 1.64, r * 0.28));
      g.strokeStyle = 'rgba(0,0,0,0.6)'; lw(g, r * 0.05);
      g.beginPath(); for (const y of [-0.41, 0, 0.41]) { g.moveTo(r * 2.95, y * r); g.lineTo(r * 3.58, y * r); } g.stroke();
      for (const y of [-0.62, -0.2, 0.2, 0.62]) { shape(g, '#2a2f34', o * 0.6, () => g.arc(r * 3.55, y * r, r * 0.13, 0, P2)); shape(g, METAL.light, 0, () => g.arc(r * 3.52, y * r - r * 0.03, r * 0.06, 0, P2)); }
      shape(g, metalGrad(g, r * 0.5, METAL.base), o, () => roundRect(g, r * 2.85, r * 0.78, r * 0.7, r * 0.34, r * 0.16));
      rivets(g, [r * 2.95, -r * 0.7, r * 2.95, r * 0.7], r * 0.06);
      return true;
    }
    case 'stormcore': {
      baseRing(g, r, o, 0, 1.2);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * P2;
        spire(g, a, r * 0.6, r * 1.55, r * 0.17, o, '#a8d8ff');
      }
      shape(g, teamGrad(g, pal, r), o, () => hexPath(g, 0, 0, r * 0.95, 0.52));
      for (let i = 0; i < 3; i++) { const a = (i / 3) * P2 + P2 / 6; g.strokeStyle = rgba(pal.deep, 0.6); lw(g, o * 0.8); g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9); g.stroke(); }
      shape(g, '#06101c', o, () => g.arc(0, 0, r * 0.58, 0, P2));
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.5);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, '#a8d8ff'); gr.addColorStop(1, '#1a4a9a');
      shape(g, gr, 0, () => g.arc(0, 0, r * 0.5, 0, P2));
      g.strokeStyle = '#c8e8ff'; lw(g, r * 0.04);
      g.beginPath(); g.arc(0, 0, r * 0.5, 0.3, 2.0); g.arc(0, 0, r * 0.5, 3.4, 5.1); g.stroke();
      for (let i = 0; i < 3; i++) { const a = (i / 3) * P2; jag(g, Math.cos(a) * r * 1.55, Math.sin(a) * r * 1.55, Math.cos(a + P2 / 3) * r * 1.55, Math.sin(a + P2 / 3) * r * 1.55, i + 3, r * 0.25, '#a8d8ff', r * 0.025); }
      return true;
    }
    case 'aegisT': {
      shape(g, GOLD, o, () => g.arc(0, 0, r * 1.3, 0, P2));
      const gg = g.createLinearGradient(-r, -r, r, r);
      gg.addColorStop(0, '#fff2b0'); gg.addColorStop(0.5, '#c8982a'); gg.addColorStop(1, '#6a4a10');
      shape(g, gg, o * 0.7, () => g.arc(0, 0, r * 1.25, 0, P2));
      shape(g, METAL.dark, o * 0.7, () => g.arc(0, 0, r * 1.05, 0, P2));
      for (let i = 0; i < 12; i++) { const a = (i / 12) * P2; shape(g, i % 3 === 0 ? '#5affc0' : '#7fd8ff', o * 0.4, () => g.arc(Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15, r * 0.07, 0, P2)); }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * P2 + 0.785;
        g.save(); g.rotate(a);
        shape(g, gg, o * 0.8, () => { g.moveTo(r * 0.5, -r * 0.12); g.lineTo(r * 1.45, 0); g.lineTo(r * 0.5, r * 0.12); g.closePath(); });
        glowDot(g, r * 1.45, 0, r * 0.08, '#bfefff');
        g.restore();
      }
      shape(g, teamGrad(g, pal, r), o, () => g.arc(0, 0, r * 0.95, 0, P2));
      domeGlass(g, r * 0.8, '#cffaff', '#1a6a9a', o);
      g.strokeStyle = GOLD; lw(g, r * 0.06); g.beginPath(); g.arc(0, 0, r * 0.6, 0, P2); g.stroke();
      // crystal
      shape(g, '#e8fcff', o * 0.6, () => { g.moveTo(r * 0.25, 0); g.lineTo(0, -r * 0.2); g.lineTo(-r * 0.25, 0); g.lineTo(0, r * 0.2); g.closePath(); });
      glowDot(g, 0, 0, r * 0.15, '#bfefff');
      return true;
    }
  }
  return false;
}

/** The tactical nuke on its erector. k = 0 lying on the rails .. 1 raised near vertical (foreshortened, closer to
 *  the camera so slightly larger, nose toward the viewer). Pivot at the missile's tail. */
function nukeMissile(g: Ctx, r: number, o: number, k: number): void {
  const th = k * 1.2;
  const L = r * 3.7, x0 = -r * 0.2;
  const len = L * Math.cos(th) + r * 0.25 * Math.sin(th);
  const grow = 1 + 0.38 * Math.sin(th);
  const w0 = r * 0.38, w1 = r * 0.38 * grow;
  if (k > 0.02) {
    // shadow cast along the rails while raised
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); roundRect(g, x0 + r * 0.3 * k, -w0 + r * 0.25 * k, L * (1 - 0.15 * k), w0 * 2, w0); g.fill();
  }
  const xN = x0 + len;
  // body (tapers wider toward the nose as it rises toward the camera)
  shape(g, '#d8d6c8', o, () => { g.moveTo(x0, -w0); g.lineTo(xN - w1 * 0.8, -w1); g.lineTo(xN - w1 * 0.8, w1); g.lineTo(x0, w0); g.closePath(); });
  const mg = g.createLinearGradient(0, -w1, 0, w1);
  mg.addColorStop(0, 'rgba(255,255,255,0.45)'); mg.addColorStop(0.5, 'rgba(255,255,255,0)'); mg.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = mg; g.beginPath(); g.moveTo(x0, -w0); g.lineTo(xN - w1 * 0.8, -w1); g.lineTo(xN - w1 * 0.8, w1); g.lineTo(x0, w0); g.closePath(); g.fill();
  const at = (f: number) => x0 + (xN - w1 * 0.8 - x0) * f;
  const wAt = (f: number) => w0 + (w1 - w0) * f;
  g.fillStyle = '#e8b81c';
  g.fillRect(at(0.7), -wAt(0.7), r * 0.18 * (1 - k * 0.5), wAt(0.7) * 2);
  g.fillRect(at(0.6), -wAt(0.6), r * 0.08 * (1 - k * 0.5), wAt(0.6) * 2);
  // nose cone: a long red cone lying down, a red disc with a bright tip when pointing at the camera
  shape(g, '#c0392b', o, () => { g.moveTo(xN - w1 * 0.8, -w1); g.lineTo(xN - w1 * 0.8 + r * 0.72 * Math.cos(th), 0); g.lineTo(xN - w1 * 0.8, w1); g.closePath(); });
  if (k > 0.5) {
    shape(g, '#c0392b', o * 0.8, () => g.arc(xN - w1 * 0.6, 0, w1 * 0.95, 0, P2));
    shape(g, '#ff6a50', 0, () => g.arc(xN - w1 * 0.75, -w1 * 0.2, w1 * 0.4, 0, P2));
  }
  // fins
  shape(g, '#7a7a74', o * 0.7, () => { g.moveTo(x0, -w0 * 1.05); g.lineTo(x0 + r * 0.7 * Math.cos(th), -r * 0.95); g.lineTo(x0 + r * 0.9 * Math.cos(th), -w0 * 1.05); g.closePath(); });
  shape(g, '#7a7a74', o * 0.7, () => { g.moveTo(x0, w0 * 1.05); g.lineTo(x0 + r * 0.7 * Math.cos(th), r * 0.95); g.lineTo(x0 + r * 0.9 * Math.cos(th), w0 * 1.05); g.closePath(); });
  // trefoil
  const tx = at(0.42), tw = wAt(0.42) * 0.82;
  shape(g, '#e8b81c', o * 0.6, () => g.arc(tx, 0, tw, 0, P2));
  g.fillStyle = '#151515';
  for (let i = 0; i < 3; i++) { const a = (i / 3) * P2 + Math.PI / 2 + 0.2; g.beginPath(); g.moveTo(tx, 0); g.arc(tx, 0, tw * 0.87, a, a + 1.0); g.closePath(); g.fill(); }
  shape(g, '#e8b81c', 0, () => g.arc(tx, 0, tw * 0.22, 0, P2));
}

function dot2(g: Ctx, x: number, y: number, rad: number, c: string): void {
  g.fillStyle = c; g.beginPath(); g.arc(x, y, rad, 0, P2); g.fill();
}

/** Per-frame animated bits of giant/titan turrets, drawn over the baked sprite. Local frame: pivot at (mx, my), barrels along ang. */
export function drawTurretDynamic(g: Ctx, m: ModuleDef, pal: TeamPal, d: number, mx: number, my: number, ang: number, sc: number, t: number, flash: number, swing: number, px: number, alpha: number, ch?: number): void {
  const r = d / 2;
  const cs = Math.cos(ang) * sc, sn = Math.sin(ang) * sc;
  const tr = g.getTransform();
  g.transform(cs, sn, -sn, cs, mx, my);
  const prev = g.globalCompositeOperation;
  const pulse = 0.5 + 0.5 * Math.sin(t * 4);
  const glowAt = (x: number, y: number, rad: number, col: string, a: number) => {
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = alpha * Math.min(1, a);
    g.drawImage(softDot(col), x - rad, y - rad, rad * 2, rad * 2);
  };
  switch (m.id) {
    case 'grinder': {
      g.save(); g.translate(r * 2.1, 0); grinderWheel(g, r * 1.05, Math.max(1.1 / px, d * 0.04), t * (swing > 0 ? 38 : 11)); g.restore();
      glowAt(r * 2.1, 0, r * 1.3, 'rgba(255,140,50,0.8)', 0.12 + swing * 0.5);
      break;
    }
    case 'massdriver': {
      // charge: capacitors fill, coils light up one by one down the rails, arcs crackle, the muzzle goes white-hot
      const c = Math.max(0, ch ?? 0.2);
      const cc = c * c;
      const flick = 0.88 + 0.12 * Math.sin(t * 15);
      for (let i = 0; i < 3; i++) glowAt(-r * 0.45, (i - 1) * r * 0.62, r * (0.5 + 0.6 * c), '#9fe8ff', 0.2 + 0.8 * c * flick);
      for (let i = 0; i < 6; i++) {
        const on = clamp(c * 7 - i, 0, 1);
        if (on > 0) { glowAt(r * (0.73 + i * 0.5), -r * 0.6, r * 0.42, '#bff0ff', on * flick); glowAt(r * (0.73 + i * 0.5), r * 0.6, r * 0.42, '#bff0ff', on * flick); }
      }
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = alpha * (0.3 + 0.7 * c);
      g.strokeStyle = '#cff4ff'; g.lineCap = 'round';
      g.lineWidth = Math.max(1.5 / px, r * (0.08 + 0.18 * cc));
      g.beginPath(); g.moveTo(r * 0.4, 0); g.lineTo(r * 3.4, 0); g.stroke();
      if (c > 0.55) {
        const k = Math.floor(t * 24);
        for (const y of [-0.36, 0.36]) jag(g, r * (0.6 + ((k * 0.37) % 1) * 1.5), y * r, r * (1.6 + ((k * 0.61) % 1) * 1.6), -y * r * 0.2, k + (y > 0 ? 7 : 3), r * 0.25, '#e8faff', Math.max(1 / px, r * 0.035));
      }
      glowAt(r * 3.45, 0, r * (0.6 + 2.4 * cc + flash * 2.2), '#9fe8ff', 0.25 + 0.75 * c + flash);
      if (c > 0.25) {
        // wide charge bloom + an energy ring collapsing onto the muzzle
        glowAt(r * 3.0, 0, r * (1.5 + 4 * c), '#6ad8ff', 0.2 + 0.6 * c);
        glowAt(r * 1.8, 0, r * (1.2 + 2 * c), '#9fe8ff', 0.15 + 0.5 * c);
        g.globalCompositeOperation = 'lighter';
        const f = (t * 2.5) % 1;
        g.globalAlpha = alpha * c * f;
        g.strokeStyle = '#cff4ff';
        g.lineWidth = Math.max(1.5 / px, r * 0.12 * c);
        g.beginPath(); g.arc(r * 3.45, 0, r * (0.4 + 2.4 * (1 - f)), 0, P2); g.stroke();
      }
      if (c > 0.7 || flash > 0.1) glowAt(r * 3.45, 0, r * (0.4 + 1.2 * cc + flash), '#ffffff', (c - 0.7) * 3 + flash);
      glowAt(r * 0.1, 0, r * (1.0 + cc), '#6ac8ff', 0.1 + 0.4 * cc);
      break;
    }
    case 'annihilator': {
      const h = Math.max(0, ch ?? 0);
      const w = 0.3 + 0.3 * pulse + h + flash * 0.5;
      for (const s of [-1, 1]) glowAt(-r * 0.2, s * r * 0.5, r * (0.35 + 0.4 * h), '#e070ff', 0.3 + 0.7 * h);
      for (const s of [-1, 1]) for (let i = 0; i < 4; i++) glowAt(r * (0.76 + i * 0.4), s * r * 0.48, r * 0.22, '#ff80f0', clamp(h * 5 - i, 0, 1) * 0.9);
      glowAt(r * 2.95, 0, r * (0.8 + 1.6 * h + flash * 0.5), '#ff80f0', w);
      glowAt(r * 2.95, 0, r * (0.3 + 0.5 * h), '#ffffff', 0.4 + h + flash);
      break;
    }
    case 'tactnuke': {
      if (ch !== undefined) {
        g.globalCompositeOperation = prev;
        g.globalAlpha = alpha;
        const o = Math.max(1.1 / px, d * 0.07);
        if (ch >= 0) {
          // erector ram pushes the missile up
          const k = ch;
          g.strokeStyle = OUTLINE; g.lineWidth = r * 0.24; g.lineCap = 'round';
          g.beginPath(); g.moveTo(-r * 0.9, r * 0.2); g.lineTo(r * (0.5 + 0.2 * k) * Math.cos(k * 1.2) + r * 0.1, r * 0.55); g.stroke();
          g.strokeStyle = METAL.light; g.lineWidth = r * 0.12; g.stroke();
          nukeMissile(g, r, o, k);
          if (k > 0.05) {
            // warning strobe + hot exhaust venting while it rises
            // slow smooth pulse (1.5 Hz), never a hard strobe
            const on = 0.5 + 0.5 * Math.sin(t * Math.PI * 3);
            glowAt(-r * 1.25, -r * 0.8, r * 0.45, '#ff3020', 0.2 + 0.7 * on);
            glowAt(-r * 1.25, r * 0.8, r * 0.45, '#ff3020', 0.9 - 0.7 * on);
            glowAt(-r * 0.25, 0, r * (0.4 + 0.5 * k), '#ffb060', k * (0.45 + 0.25 * Math.sin(t * 40)));
          }
          glowAt(r * 1.3 * Math.cos(k * 1.2), 0, r * 0.6, '#9aff50', 0.25 + 0.25 * pulse + k * 0.3);
        }
      } else {
        glowAt(r * 1.3, 0, r * 0.7, '#9aff50', 0.3 + 0.25 * pulse);
        glowAt(r * 3.4, 0, r * 0.3, '#ff4030', 0.2 + 0.2 * pulse);
      }
      break;
    }
    case 'siegeplasma':
      glowAt(-r * 0.1, 0, r * 0.9, '#e070ff', 0.35 + 0.3 * pulse + flash);
      glowAt(r * 2.4, 0, r * 0.5, '#e070ff', 0.4 + 0.4 * flash + 0.2 * pulse);
      break;
    case 'stormcore': case 'stormtower': {
      glowAt(0, 0, r * 0.8, '#a8d8ff', 0.3 + 0.3 * pulse + flash);
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = alpha;
      const k = Math.floor(t * 18);
      const n = m.id === 'stormcore' ? 3 : 4;
      for (let i = 0; i < n; i++) {
        if ((k + i) % 3 === 0) continue;
        const a = m.id === 'stormcore' ? (i / 3) * P2 : (i / 4) * P2 + 0.785;
        const rad = m.id === 'stormcore' ? r * 1.55 : r * 1.25;
        jag(g, Math.cos(a) * rad, Math.sin(a) * rad, 0, 0, k + i * 3, r * 0.3, '#a8d8ff', Math.max(1 / px, r * 0.02));
      }
      break;
    }
    case 'inferno':
      for (const s of [-1, 1]) {
        const f = 0.7 + 0.3 * Math.sin(t * 23 + s) + (Math.sin(t * 41) > 0.5 ? 0.15 : 0);
        glowAt(r * 2.4, s * r * 0.5, r * 0.45 * f, '#ff9030', 0.55 + flash);
        glowAt(r * 2.35, s * r * 0.5, r * 0.18, '#fff0b0', 0.7);
      }
      break;
    case 'doomsday':
    case 'siege240': {
      const c = Math.max(0, ch ?? 0);
      if (c > 0 && m.id === 'doomsday') {
        // breech glow + loader lights as the next salvo is rammed home
        for (const y of [-0.55, 0.55]) glowAt(r * 0.3, y * r, r * (0.3 + 0.3 * c), '#ffb060', c * 0.7);
        const on = 0.5 + 0.5 * Math.sin(t * Math.PI * 3);
        glowAt(-r * 2.0, -r * 1.15, r * 0.35, '#ffcc40', 0.1 + (c - 0.1) * on);
        glowAt(-r * 2.0, r * 1.15, r * 0.35, '#ffcc40', 0.1 + (c - 0.1) * (1 - on));
      }
      if (flash > 0.15) {
        const bx = m.id === 'siege240' ? r * 3.4 : r * 3.45 * barrelStretch(m);
        const ys = m.id === 'siege240' ? [0] : [-0.55, 0.55];
        for (const y of ys) { glowAt(bx, y * r, r * (1.2 + flash * 1.6), '#ffd890', flash); glowAt(bx, y * r, r * 0.5, '#ffffff', flash); }
      }
      break;
    }
    case 'skyfortress': {
      const on = (t * 1.4) % 1 < 0.2;
      if (on) glowAt(0, 0, r * 0.3, '#ff4040', 0.9);
      break;
    }
    case 'bulwarkshield': case 'domeG': case 'aegisT': {
      const rad = (m.id === 'aegisT' ? 1.5 : m.id === 'domeG' ? 1.35 : 1.1) * r;
      const col = m.id === 'domeG' ? '#5aff9a' : '#7fd8ff';
      glowAt(0, 0, rad * (1.05 + 0.1 * pulse), col, 0.25 + 0.15 * pulse);
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = col; g.lineWidth = Math.max(1.2 / px, r * 0.05); g.lineCap = 'round';
      for (let k = 0; k < (m.id === 'aegisT' ? 3 : 2); k++) {
        const f = (t * 0.7 + k * 0.33) % 1;
        g.globalAlpha = alpha * (1 - f) * 0.8;
        g.beginPath(); g.arc(0, 0, rad * (0.5 + f * 0.9), 0, P2); g.stroke();
      }
      break;
    }
    case 'missilebattery':
      for (let i = 0; i < 4; i++) glowAt(-r * 0.95, -r * 0.45 + i * r * 0.3, r * 0.1, (Math.floor(t * 2) + i) % 4 === 0 ? '#ff4040' : '#40ff70', 0.9);
      break;
    case 'titanfist':
      glowAt(r * 3.1, 0, r * 1.2, '#ffd890', swing * 0.8);
      break;
    case 'avenger':
    case 'minigun': {
      // rotary barrels spin up while firing (idle = the baked rest frame, so nothing is redrawn)
      if (flash > 0.02) {
        g.globalCompositeOperation = prev;
        g.globalAlpha = alpha;
        const o = Math.max(1 / px, d * 0.045);
        const ph = t * (m.id === 'avenger' ? 14 : 22);
        if (m.id === 'avenger') avengerCluster(g, m, r, o, ph); else minigunCluster(g, m, r, o, ph);
        const tip = m.id === 'avenger' ? r * 3.1 : r * 2.08;
        glowAt(tip + r * 0.15, 0, r * (m.id === 'avenger' ? 0.5 + flash : 0.35 + 0.5 * flash), '#ffd27a', flash * 1.2);
      }
      break;
    }
  }
  g.setTransform(tr);
  g.globalCompositeOperation = prev;
  g.globalAlpha = alpha;
}
