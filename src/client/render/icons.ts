// Standalone part icons for pickers, tooltips and unit panels.
//
//   drawPartIcon(canvas, 'chassis' | 'mobility' | 'module', id, { color?, team?, rotate? })
//
// Renders the same procedural art the battlefield uses, auto-cropped to its bounds and fitted (centered, with
// padding) into the canvas on a transparent background. Canvas pixel size is taken from its CSS size x
// devicePixelRatio when it is laid out, otherwise from canvas.width/height.

import { CHASSIS, CHASSIS_BY_ID, MOBILITY_BY_ID, MODULE_BY_ID } from '../../shared/parts.ts';
import type { Design } from '../../shared/types.ts';
import { TEAM_PAL, ctx2d, makeCanvas, mix, shade, type Ctx, type TeamPal } from './palette.ts';
import { CATEGORY_COLOR, drawTurret, drawTurretDynamic } from './turrets.ts';
import { GIANT_SHAPES, drawGiantFx } from './giantart.ts';
import { weaponD } from './weaponsize.ts';
import {
  drawAnchorPlate, drawMobility, drawPartsStatic, drawPlates, hullDetails, hullPathL, hullUnderlay, layoutOf, paintHull, rotorBlur, type UnitLayout,
} from './unitart.ts';

export type PartKind = 'chassis' | 'mobility' | 'module';

export interface PartIconOpts {
  /** base hull colour (hex). Default: viewer team blue. */
  color?: string;
  /** use a team palette instead of `color` (0 = friendly blue, 1 = enemy red) */
  team?: 0 | 1;
  /** padding fraction of the canvas (default 0.08) */
  pad?: number;
  /** draw a faint category-coloured backdrop disc (modules only) */
  backdrop?: boolean;
}

/** A paint scheme from a UI colour: the colour becomes the stripe/light accent over a faintly tinted military
 *  finish (never a full-body fill). */
export function palFromColor(color: string): TeamPal {
  const body = mix(TEAM_PAL[0].body, color, 0.12);
  return {
    body, light: shade(body, 0.3), dark: shade(body, -0.36), deep: shade(body, -0.64), camo: shade(body, -0.12),
    accent: color, glow: shade(color, 0.5), glowRgb: '200,230,255', bar: color, rim: color,
  };
}

/** Category accent colour of a module (for UI chips). */
export function moduleCategoryColor(id: string): string {
  const m = MODULE_BY_ID.get(id);
  return (m && CATEGORY_COLOR[m.category]) || '#b0b8c0';
}

const cropCache = new Map<string, HTMLCanvasElement>();
const PX = 96; // render resolution (px per cell) before fitting

function cropAlpha(src: HTMLCanvasElement): HTMLCanvasElement {
  const g = ctx2d(src);
  const { width: w, height: h } = src;
  const data = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return src;
  const c = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
  ctx2d(c).drawImage(src, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

function sampleDesign(kind: PartKind, id: string): Design | null {
  if (kind === 'chassis') {
    const c = CHASSIS_BY_ID.get(id);
    if (!c) return null;
    return { id: 'icon', name: 'icon', chassis: id, mobility: 'anchor', mounts: c.mounts.map(() => null) };
  }
  if (kind === 'mobility') {
    const m = MOBILITY_BY_ID.get(id);
    if (!m) return null;
    const size = m.sizes.includes(1) ? 1 : m.sizes[0];
    const pref = id === 'gravlift' ? 'carrier' : id === 'megatracks' ? 'leviathan' : id === 'titanlegs' ? 'titan' : '';
    const chassis = (pref ? CHASSIS_BY_ID.get(pref) : undefined) ?? CHASSIS.find((c) => c.size === size && !c.traits.includes('airOnly') && c.shape === (size === 1 ? 'box' : 'hex'))
      ?? CHASSIS.find((c) => c.size === size)!;
    return { id: 'icon', name: 'icon', chassis: chassis.id, mobility: id, mounts: chassis.mounts.map(() => null) };
  }
  return null;
}

function renderPart(kind: PartKind, id: string, pal: TeamPal): HTMLCanvasElement | null {
  const E = 4; // cells of working space
  const c = makeCanvas(E * PX, E * PX);
  const g = ctx2d(c);
  g.translate(c.width / 2, c.height / 2);
  g.scale(PX, PX);
  const o = 1.2 / PX;
  if (kind === 'module') {
    const m = MODULE_BY_ID.get(id);
    if (!m) return null;
    // same physical sizing as on the field (icons are fitted to the canvas, so only proportions matter)
    const d = weaponD(m) * 1.6;
    if (m.kind === 'armor' || m.visual === 'plate') {
      // plating sample on a hull block
      const L = { S: 1, hw: 0.3, shape: 'box', mounts: [{ x: 0, y: 0, d: d * 0.9, mod: m, slot: m.mount, turret: false }] } as unknown as UnitLayout;
      g.beginPath();
      g.rect(-0.45, -0.32, 0.9, 0.64);
      g.fillStyle = pal.body;
      g.fill();
      g.lineWidth = o;
      g.strokeStyle = 'rgba(10,12,14,0.4)';
      g.stroke();
      drawPlates(g, L, pal, o);
    } else {
      g.rotate(-Math.PI / 4);
      drawTurret(g, m, pal, d, Math.max(o, d * 0.035));
      if (m.mount === 'G' || m.mount === 'T') drawTurretDynamic(g, m, pal, d, 0, 0, 0, 1, 0.35, 0, 0, PX, 1);
    }
    return cropAlpha(c);
  }
  const design = sampleDesign(kind, id);
  if (!design) return null;
  const L = layoutOf(design);
  g.rotate(-Math.PI / 2);
  const S = L.S;
  const sc = 1.4 / L.D;
  g.scale(sc, sc);
  const oo = o / sc;
  if (kind === 'chassis') {
    hullUnderlay(g, L, pal, oo);
    drawPartsStatic(g, L, pal, oo, 'under');
    paintHull(g, hullPathL(L), pal, S, oo, L.hw, L.X, L.Y);
    hullDetails(g, L, pal, oo);
    drawPartsStatic(g, L, pal, oo, 'over');
    if (GIANT_SHAPES.has(L.shape)) drawGiantFx(g, L, { time: 0.4 }, 0, 0, 0, 1, PX * sc, pal, 1);
  } else {
    if (L.mob.id === 'anchor') drawAnchorPlate(g, L, pal, oo);
    else drawMobility(g, L, pal, 0.15, false, oo);
    // ghosted hull outline so the running gear reads as a vehicle
    const hp = hullPathL(L);
    g.globalAlpha = 0.18;
    g.fillStyle = pal.light;
    g.fill(hp);
    g.globalAlpha = 0.6;
    g.setLineDash([0.04 * S, 0.03 * S]);
    g.strokeStyle = pal.light;
    g.lineWidth = oo;
    g.stroke(hp);
    g.setLineDash([]);
    g.globalAlpha = 1;
    for (const r of L.rotors) {
      rotorBlur(g, r.x, r.y, r.r, r.blades, 0.37, PX * sc);
      g.strokeStyle = '#c8d0d8';
      g.lineWidth = r.r * 0.1;
      g.lineCap = 'round';
      g.beginPath();
      for (let i = 0; i < r.blades; i++) { const a = 0.4 + (i / r.blades) * Math.PI * 2; g.moveTo(r.x, r.y); g.lineTo(r.x + Math.cos(a) * r.r, r.y + Math.sin(a) * r.r); }
      g.stroke();
    }
    if (L.mob.id === 'jet' || L.mob.id === 'jumpjets') {
      for (const n of L.nozzles) {
        const gr = g.createRadialGradient(n.x - 0.05 * S, n.y, 0, n.x - 0.05 * S, n.y, n.w * 2.5);
        gr.addColorStop(0, 'rgba(255,240,200,1)');
        gr.addColorStop(0.4, 'rgba(255,140,40,0.8)');
        gr.addColorStop(1, 'rgba(255,100,20,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(n.x - 0.05 * S, n.y, n.w * 2.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    if (L.mob.id === 'gravlift' || L.mob.id === 'megatracks' || L.mob.id === 'titanlegs') {
      drawGiantFx(g, { ...L, shape: 'wedge' } as UnitLayout, { time: 0.4, moving: true, odometer: 0.15 * L.cycle }, 0, 0, 0, 1, PX * sc, pal, 1);
    }
    if (L.mob.id === 'hover') {
      g.strokeStyle = 'rgba(134,243,255,0.6)';
      g.lineWidth = 0.03 * S;
      g.beginPath();
      g.ellipse(0, 0, 0.5 * L.X, 0.42 * L.Y, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  return cropAlpha(c);
}

function canvasPixelSize(canvas: HTMLCanvasElement): { w: number; h: number } {
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (cw > 0 && ch > 0) {
    const w = Math.round(cw * dpr), h = Math.round(ch * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }
  return { w: canvas.width, h: canvas.height };
}

/** Render a crisp standalone icon of a part into `canvas` (cleared, transparent background). */
export function drawPartIcon(canvas: HTMLCanvasElement, kind: PartKind, id: string, opts: PartIconOpts = {}): void {
  let g: Ctx;
  try {
    g = ctx2d(canvas);
  } catch {
    return;
  }
  const { w, h } = canvasPixelSize(canvas);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  const pal = opts.team !== undefined ? TEAM_PAL[opts.team] : opts.color ? palFromColor(opts.color) : TEAM_PAL[0];
  const key = `${kind}|${id}|${opts.team ?? ''}|${opts.color ?? ''}`;
  let art = cropCache.get(key);
  if (!art) {
    const r = renderPart(kind, id, pal);
    if (!r) return;
    art = r;
    if (cropCache.size > 600) cropCache.clear();
    cropCache.set(key, art);
  }
  if (opts.backdrop && kind === 'module') {
    const col = moduleCategoryColor(id);
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) / 2);
    gr.addColorStop(0, col + '40');
    gr.addColorStop(1, col + '00');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }
  const pad = (opts.pad ?? 0.08) * Math.min(w, h);
  const k = Math.min((w - pad * 2) / art.width, (h - pad * 2) / art.height);
  const dw = art.width * k, dh = art.height * k;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(art, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
