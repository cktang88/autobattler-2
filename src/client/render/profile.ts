// Build profile: a per-design read of what the unit IS (how heavy, how fragile, which whole-body systems, which
// battlefield role) that drives the hull art so a unit can be read at a glance without its stats. Everything here
// is baked into the cached hull sprite (or one cached shell sprite), so it costs nothing per frame.
// Local frame: nose +x, +y right, units = cells, S = chassis size.

import { computeStats } from '../../shared/stats.ts';
import type { Design, ModuleDef } from '../../shared/types.ts';
import { METAL, OUTLINE, makeCanvas, ctx2d, rgba, roundRect, shade, type Ctx, type TeamPal } from './palette.ts';

export type RoleStyle = 'raider' | 'skirmisher' | 'assault' | 'tank' | 'artillery' | 'riot' | 'support' | 'flyer' | 'chaff' | 'stealth' | 'giant';

export interface BuildProfile {
  /** 0..1 armour heaviness (armour per size, plating) */
  heavy: number;
  /** fragile open-frame build (scouts, drones, carriages, interceptors, siege platforms) */
  skeletal: boolean;
  /** weight / capacity */
  load: number;
  role: RoleStyle;
  /** 0..1 strongest shield module */
  shield: number;
  stealth: boolean;
  mirror: boolean;
  hardened: boolean;
  nanite: boolean;
  turbo: boolean;
  gyro: boolean;
  selfdestruct: boolean;
  sensor: boolean;
  overclock: boolean;
  emitter: boolean;
  /** stencil number 10..99 (stable per design) */
  serial: number;
}

const cache = new Map<string, BuildProfile>();

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function buildProfile(d: Design, key: string, size: number, chassisRoles: string[], mods: (ModuleDef | null)[]): BuildProfile {
  const hit = cache.get(key);
  if (hit) return hit;
  let armor = 0, hp = 0, load = 0.7, cost = 100;
  try { const st = computeStats(d); armor = st.armor; hp = st.hp; load = st.load; cost = st.unitCost; } catch { /* invalid design: defaults */ }
  const S = size;
  const ap = armor / (6 * S);
  const heavy = Math.max(0, Math.min(1, (ap - 0.35) / 1.2));
  const frag = hp / (200 * Math.pow(S, 1.6));
  const skeletal = S <= 3 && ap < 0.25 && frag < 0.8;
  const ids = new Set(mods.filter((m): m is ModuleDef => !!m).map((m) => m.id));
  const cats = mods.filter((m): m is ModuleDef => !!m).map((m) => m.category);
  const shield = ids.has('bulwarkshield') ? 1 : ids.has('shieldH') ? 0.85 : ids.has('shield') ? 0.6 : ids.has('shieldL') ? 0.4 : 0;
  const stealth = ids.has('stealth') || ids.has('phantom');
  // role style: chassis intent first, then what the loadout says
  const r0 = chassisRoles[0] ?? 'assault';
  let role: RoleStyle;
  const nArt = mods.filter((m) => !!m && (m.visual === 'artillery' || m.visual === 'mortar' || m.visual === 'cruise' || (m.category === 'rocket' && (m.barrels ?? 1) >= 12))).length;
  if (S >= 4) role = 'giant';
  else if (stealth) role = 'stealth';
  else if (cats.includes('support') || chassisRoles.includes('support')) role = 'support';
  else if (nArt > 0 || chassisRoles.includes('artillery')) role = 'artillery';
  else if (r0 === 'flyer' || r0 === 'bomber') role = 'flyer';
  else if (S === 1 && cost < 70 && (r0 === 'scout' || r0 === 'raider')) role = 'chaff';
  else if (r0 === 'riot' || cats.filter((c) => c === 'melee' || c === 'flame').length >= 2) role = 'riot';
  else if (r0 === 'tank' || heavy > 0.55) role = 'tank';
  else if (r0 === 'raider' || r0 === 'scout') role = 'raider';
  else if (r0 === 'skirmisher' || r0 === 'antiair') role = 'skirmisher';
  else role = 'assault';
  const p: BuildProfile = {
    heavy, skeletal, load, role, shield, stealth,
    mirror: ids.has('mirror'), hardened: ids.has('hardened'), nanite: ids.has('nanite'), turbo: ids.has('turbo'), gyro: ids.has('gyro'),
    selfdestruct: ids.has('selfdestruct'), sensor: ids.has('sensor') || ids.has('targeting'), overclock: ids.has('overclock') || ids.has('autoloader'),
    emitter: ids.has('dome') || ids.has('uplink') || ids.has('domeG') || ids.has('aegisT') || ids.has('jammer'),
    serial: 10 + (hashStr(key) % 90),
  };
  cache.set(key, p);
  return p;
}

/* ------------------------------------------------------------------------------------------------ helpers */

function dot(g: Ctx, x: number, y: number, r: number, c: string): void {
  g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}
function rivets(g: Ctx, x0: number, y0: number, x1: number, y1: number, n: number, r: number): void {
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    const x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f;
    dot(g, x, y, r, 'rgba(0,0,0,0.55)');
    dot(g, x - r * 0.3, y - r * 0.3, r * 0.5, 'rgba(255,255,255,0.4)');
  }
}
function slab(g: Ctx, x: number, y: number, w: number, h: number, fill: string | CanvasGradient, o: number): void {
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath(); roundRect(g, x + o * 0.8, y + o * 1.2, w, h, Math.min(w, h) * 0.18); g.fill();
  const p = new Path2D(); roundRect(p, x, y, w, h, Math.min(w, h) * 0.18);
  g.fillStyle = fill; g.fill(p);
  g.save(); g.clip(p);
  g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = o * 1.6;
  g.translate(o * 0.8, o * 0.8); g.stroke(p);
  g.restore();
  g.lineWidth = o * 0.8; g.strokeStyle = OUTLINE; g.stroke(p);
}
function hazardBox(g: Ctx, x: number, y: number, w: number, h: number, o: number): void {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = '#e8b81c'; g.fillRect(x, y, w, h);
  g.strokeStyle = '#17140c'; const u = Math.min(w, h); g.lineWidth = u * 0.3;
  g.beginPath(); for (let i = -4; i < 12; i++) { g.moveTo(x + i * u * 0.6, y + h); g.lineTo(x + i * u * 0.6 + h, y); } g.stroke();
  g.restore();
  g.lineWidth = o * 0.7; g.strokeStyle = OUTLINE; g.strokeRect(x, y, w, h);
}

/** Stencilled role insignia (pale paint) centred at (x, y), size u. */
function insignia(g: Ctx, role: RoleStyle, x: number, y: number, u: number, serial: number, pal: TeamPal): void {
  const paint = 'rgba(232,236,240,0.62)';
  g.save();
  g.translate(x, y);
  g.fillStyle = paint; g.strokeStyle = paint; g.lineWidth = u * 0.22; g.lineCap = 'butt'; g.lineJoin = 'miter';
  switch (role) {
    case 'raider': for (const k of [-0.5, 0.25]) { g.beginPath(); g.moveTo(k * u - u * 0.35, -u * 0.6); g.lineTo(k * u + u * 0.25, 0); g.lineTo(k * u - u * 0.35, u * 0.6); g.stroke(); } break;
    case 'artillery': g.beginPath(); g.arc(0, 0, u * 0.55, 0, Math.PI * 2); g.moveTo(-u * 0.9, 0); g.lineTo(u * 0.9, 0); g.moveTo(0, -u * 0.9); g.lineTo(0, u * 0.9); g.lineWidth = u * 0.16; g.stroke(); break;
    case 'support': g.fillStyle = 'rgba(240,240,240,0.75)'; g.fillRect(-u * 0.6, -u * 0.18, u * 1.2, u * 0.36); g.fillRect(-u * 0.18, -u * 0.6, u * 0.36, u * 1.2); g.fillStyle = 'rgba(210,40,40,0.85)'; g.fillRect(-u * 0.45, -u * 0.1, u * 0.9, u * 0.2); g.fillRect(-u * 0.1, -u * 0.45, u * 0.2, u * 0.9); break;
    case 'riot': g.beginPath(); g.moveTo(u * 0.55, -u * 0.6); g.lineTo(-u * 0.2, -u * 0.6); g.quadraticCurveTo(-u * 0.75, 0, -u * 0.2, u * 0.6); g.lineTo(u * 0.55, u * 0.6); g.closePath(); g.lineWidth = u * 0.16; g.stroke(); break;
    case 'tank': for (const k of [-0.45, 0, 0.45]) g.fillRect(k * u - u * 0.1, -u * 0.6, u * 0.2, u * 1.2); break;
    case 'assault': g.beginPath(); g.moveTo(u * 0.7, 0); g.lineTo(-u * 0.5, -u * 0.6); g.lineTo(-u * 0.2, 0); g.lineTo(-u * 0.5, u * 0.6); g.closePath(); g.fill(); break;
    case 'skirmisher': g.beginPath(); g.moveTo(u * 0.6, 0); g.lineTo(0, -u * 0.55); g.lineTo(-u * 0.6, 0); g.lineTo(0, u * 0.55); g.closePath(); g.lineWidth = u * 0.16; g.stroke(); dot(g, 0, 0, u * 0.14, paint); break;
    case 'flyer': g.beginPath(); g.moveTo(u * 0.5, 0); g.lineTo(-u * 0.4, -u * 0.7); g.moveTo(u * 0.5, 0); g.lineTo(-u * 0.4, u * 0.7); g.stroke(); break;
    case 'stealth': g.strokeStyle = 'rgba(160,170,190,0.4)'; g.lineWidth = u * 0.12; g.beginPath(); g.moveTo(u * 0.6, 0); g.lineTo(-u * 0.4, -u * 0.5); g.lineTo(-u * 0.2, 0); g.lineTo(-u * 0.4, u * 0.5); g.closePath(); g.stroke(); break;
    case 'chaff':
    case 'giant': {
      // stencil serial number, reading along the hull
      g.rotate(Math.PI / 2);
      g.font = `bold ${u * 1.25}px monospace`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = role === 'giant' ? rgba(pal.light, 0.5) : paint;
      g.fillText(String(serial), 0, 0);
      break;
    }
  }
  g.restore();
}

/* ------------------------------------------------------------------------------------------------- drawing */

/**
 * Whole-body build art over the painted hull (clipped to the hull path where it is a surface treatment).
 * creature = odd-shaped frame (fewer generic add-ons: its own anatomy carries the look).
 */
export function drawProfile(g: Ctx, P: BuildProfile, hull: Path2D, S: number, hw: number, pal: TeamPal, o: number, E: string, opts: { creature: boolean; air: boolean; legged: boolean; rearX: number }): void {
  const H = hw * S;
  const rx = opts.rearX * S;
  // ---- skeletal: open frame, lightening holes + truss bracing on the flanks
  if (P.skeletal) {
    g.save(); g.clip(hull);
    for (const s of [-1, 1]) {
      const y = s * H * 0.55, n = 4;
      for (let i = 0; i < n; i++) {
        const x0 = (-0.3 + i * 0.15) * S, x1 = x0 + 0.13 * S, up = i % 2 === 0;
        const tri = new Path2D();
        tri.moveTo(x0, y + (up ? 1 : -1) * H * 0.18); tri.lineTo(x1, y + (up ? 1 : -1) * H * 0.18); tri.lineTo((x0 + x1) / 2, y - (up ? 1 : -1) * H * 0.18); tri.closePath();
        g.fillStyle = 'rgba(4,6,8,0.85)'; g.fill(tri);
        g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = o * 0.5; g.stroke(tri);
      }
      g.strokeStyle = METAL.light; g.lineWidth = o * 0.7;
      g.beginPath(); g.moveTo(-0.32 * S, y - s * H * 0.2); g.lineTo(0.3 * S, y - s * H * 0.2); g.moveTo(-0.32 * S, y + s * H * 0.2); g.lineTo(0.3 * S, y + s * H * 0.2); g.stroke();
    }
    g.restore();
  }
  // ---- heavy: appliqué slabs on the flanks, thick glacis, heavier outline; more armour = more layers
  const layers = P.heavy > 0.66 ? 3 : P.heavy > 0.33 ? 2 : P.heavy > 0.12 ? 1 : 0;
  if (layers) {
    g.save(); g.clip(hull);
    const gl = g.createLinearGradient(0.5 * S, 0, 0.2 * S, 0);
    gl.addColorStop(0, shade(pal.light, -0.1)); gl.addColorStop(1, shade(pal.dark, -0.1));
    g.fillStyle = gl; g.fillRect((0.5 - 0.06 - layers * 0.035) * S, -S, S, 2 * S);
    g.strokeStyle = OUTLINE; g.lineWidth = o; g.beginPath(); g.moveTo((0.5 - 0.06 - layers * 0.035) * S, -S); g.lineTo((0.5 - 0.06 - layers * 0.035) * S, S); g.stroke();
    rivets(g, (0.47 - 0.06 - layers * 0.035) * S, -H * 0.7, (0.47 - 0.06 - layers * 0.035) * S, H * 0.7, 3 + layers, 0.012 * S);
    for (let k = 0; k < layers; k++) {
      const inset = 0.05 + k * 0.045, th = 0.06 - k * 0.008;
      for (const s of [-1, 1]) {
        const y = s > 0 ? H - inset * S - th * S * 0.2 : -H + inset * S - th * S * 0.8;
        const gr = g.createLinearGradient(0, y, 0, y + th * S);
        gr.addColorStop(0, shade(pal.light, -0.15 - k * 0.04)); gr.addColorStop(1, shade(pal.dark, -0.1));
        const len = 0.62 - k * 0.12;
        slab(g, -len / 2 * S - 0.04 * S, y, len * S, th * S, gr, o);
        rivets(g, (-len / 2 + 0.0) * S, y + th * S / 2, (len / 2 - 0.08) * S, y + th * S / 2, 3 + layers, 0.01 * S);
      }
    }
    g.restore();
    g.lineJoin = 'round'; g.strokeStyle = OUTLINE; g.lineWidth = o * (1 + layers * 0.45); g.stroke(hull);
  }
  // ---- coatings
  if (P.stealth) {
    g.save(); g.clip(hull);
    g.fillStyle = 'rgba(10,12,16,0.62)'; g.fillRect(-S, -S, 2 * S, 2 * S);
    g.strokeStyle = 'rgba(150,165,185,0.22)'; g.lineWidth = o * 0.6;
    g.beginPath();
    g.moveTo(0.5 * S, 0); g.lineTo(0.05 * S, -H); g.moveTo(0.5 * S, 0); g.lineTo(0.05 * S, H);
    g.moveTo(0.05 * S, -H); g.lineTo(-0.2 * S, 0); g.lineTo(0.05 * S, H);
    g.moveTo(-0.2 * S, 0); g.lineTo(-0.5 * S, -H); g.moveTo(-0.2 * S, 0); g.lineTo(-0.5 * S, H);
    g.stroke();
    g.restore();
  }
  if (P.mirror) {
    g.save(); g.clip(hull);
    const mg = g.createLinearGradient(-0.5 * S, -0.5 * S, 0.5 * S, 0.5 * S);
    for (const [f, a] of [[0, 0], [0.22, 0.5], [0.3, 0.05], [0.48, 0], [0.56, 0.35], [0.62, 0], [1, 0.1]] as [number, number][]) mg.addColorStop(f, `rgba(240,248,255,${a})`);
    g.fillStyle = mg; g.fillRect(-S, -S, 2 * S, 2 * S);
    g.restore();
  }
  if (P.hardened) {
    g.save(); g.clip(hull);
    g.strokeStyle = 'rgba(190,200,210,0.38)'; g.lineWidth = o * 0.45;
    g.beginPath();
    const st = 0.06 * S;
    for (let v = -S * 1.2; v < S * 1.2; v += st) { g.moveTo(v, -S); g.lineTo(v + S, S); g.moveTo(v, S); g.lineTo(v + S, -S); }
    g.stroke();
    g.restore();
  }
  if (P.nanite) {
    g.save(); g.clip(hull);
    let seed = P.serial * 7 + 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26 * S; i++) dot(g, (rnd() - 0.5) * S, (rnd() - 0.5) * 2 * H, (0.004 + rnd() * 0.006) * S, rnd() < 0.5 ? 'rgba(140,255,190,0.85)' : 'rgba(230,255,240,0.7)');
    g.restore();
  }
  // ---- role furniture
  if (!opts.creature && !opts.air) {
    if (P.role === 'raider') {
      g.strokeStyle = rgba(pal.accent, 0.8); g.lineWidth = o * 0.9; g.lineCap = 'butt';
      g.save(); g.clip(hull);
      g.beginPath(); for (const s of [-1, 1]) { g.moveTo(0.4 * S, s * H * 0.42); g.lineTo(-0.45 * S, s * H * 0.42); } g.stroke();
      g.restore();
    }
    if (P.role === 'riot') {
      g.save(); g.clip(hull);
      g.fillStyle = METAL.dark; g.fillRect(0.38 * S, -S, S, 2 * S);
      hazardBox(g, 0.4 * S, -H, 0.035 * S, 2 * H, o);
      g.restore();
    }
    if (P.role === 'artillery') {
      // ammo rack on the rear deck
      for (let i = 0; i < 4; i++) {
        const y = (-1.5 + i) * 0.045 * S;
        dot(g, rx + 0.07 * S, y, 0.017 * S, OUTLINE);
        dot(g, rx + 0.07 * S, y, 0.013 * S, '#c9a040');
        dot(g, rx + 0.075 * S, y - 0.004 * S, 0.005 * S, 'rgba(255,255,255,0.6)');
      }
    }
  }
  // ---- whole-body systems
  if (P.turbo) {
    for (const s of [-1, 1]) {
      const x = rx, y = s * H * 0.45;
      dot(g, x, y, 0.05 * S, OUTLINE);
      dot(g, x, y, 0.042 * S, METAL.base);
      dot(g, x, y, 0.03 * S, '#07080a');
      dot(g, x, y, 0.018 * S, 'rgba(255,140,50,0.9)');
    }
  }
  if (P.gyro) {
    g.strokeStyle = OUTLINE; g.lineWidth = o * 2.2;
    g.beginPath(); g.arc(0, 0, H * 0.72, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = METAL.light; g.lineWidth = o * 1.2; g.stroke();
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; dot(g, Math.cos(a) * H * 0.72, Math.sin(a) * H * 0.72, 0.022 * S, METAL.dark); dot(g, Math.cos(a) * H * 0.72, Math.sin(a) * H * 0.72, 0.01 * S, rgba(E, 0.9)); }
  }
  if (P.selfdestruct) {
    const w = 0.1 * S, h = 0.14 * S, x = rx + 0.05 * S;
    slab(g, x, -h / 2, w, h, '#3a3e42', o);
    hazardBox(g, x + w * 0.15, -h * 0.4, w * 0.7, h * 0.25, o * 0.6);
    dot(g, x + w * 0.5, h * 0.18, 0.014 * S, '#ff3030');
  }
  if (P.sensor) {
    g.lineCap = 'round';
    g.strokeStyle = OUTLINE; g.lineWidth = 0.022 * S;
    g.beginPath(); g.moveTo(rx + 0.12 * S, -H * 0.6); g.lineTo(rx - 0.12 * S, -H * 1.0); g.stroke();
    g.strokeStyle = METAL.light; g.lineWidth = 0.009 * S; g.stroke();
    dot(g, rx - 0.12 * S, -H * 1.0, 0.012 * S, '#ff5050');
    // sensor dish
    g.fillStyle = METAL.light; g.beginPath(); g.ellipse(rx + 0.12 * S, H * 0.55, 0.035 * S, 0.06 * S, 0.4, 0, Math.PI * 2); g.fill();
    g.lineWidth = o * 0.7; g.strokeStyle = OUTLINE; g.stroke();
    dot(g, rx + 0.12 * S, H * 0.55, 0.01 * S, METAL.dark);
  }
  if (P.overclock) {
    for (const s of [-1, 1]) {
      const x = -0.2 * S, y = s * H * 0.62, w = 0.14 * S, h = 0.035 * S;
      g.fillStyle = '#07080a'; g.fillRect(x, y - h / 2, w, h);
      for (let i = 0; i < 4; i++) { g.fillStyle = `rgba(255,${120 + i * 20},40,0.85)`; g.fillRect(x + w * (0.08 + i * 0.23), y - h * 0.32, w * 0.12, h * 0.64); }
      g.lineWidth = o * 0.6; g.strokeStyle = OUTLINE; g.strokeRect(x, y - h / 2, w, h);
    }
  }
  if (P.emitter) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const x = Math.cos(a) * 0.36 * S * 0.9, y = Math.sin(a) * H * 0.9;
      dot(g, x, y, 0.024 * S, OUTLINE); dot(g, x, y, 0.018 * S, METAL.base); dot(g, x, y, 0.01 * S, '#7fd8ff');
    }
  }
  // ---- role insignia stencil on the rear deck
  if (S >= 2 || P.role === 'chaff') insignia(g, P.role, rx + 0.17 * S, 0, 0.05 * S, P.serial, pal);
}

/** Artillery outrigger stabilisers (drawn under the hull). */
export function drawOutriggers(g: Ctx, S: number, hw: number, o: number): void {
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const ax = sx * 0.22 * S, ay = sy * hw * 0.8 * S, fx = sx * 0.34 * S, fy = sy * (hw + 0.17) * S;
    g.lineCap = 'round';
    g.strokeStyle = OUTLINE; g.lineWidth = 0.07 * S; g.beginPath(); g.moveTo(ax, ay); g.lineTo(fx, fy); g.stroke();
    g.strokeStyle = METAL.base; g.lineWidth = 0.045 * S; g.stroke();
    g.fillStyle = METAL.dark; g.beginPath(); g.arc(fx, fy, 0.055 * S, 0, Math.PI * 2); g.fill();
    g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
    g.strokeStyle = 'rgba(232,184,28,0.8)'; g.lineWidth = o * 0.8; g.beginPath(); g.arc(fx, fy, 0.036 * S, 0, Math.PI * 2); g.stroke();
  }
}

/** Shield shimmer shell: soft hex-patterned energy envelope around the hull silhouette (cached per sprite set). */
export function shieldShell(hull: Path2D, S: number, ext: number, px: number, strength: number, col: string): HTMLCanvasElement {
  const size = Math.ceil(2 * ext * px);
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  g.setTransform(px, 0, 0, px, size / 2, size / 2);
  g.lineJoin = 'round';
  const pad = (0.06 + 0.05 * strength) * S;
  g.strokeStyle = '#fff'; g.lineWidth = pad * 2; g.stroke(hull); g.fillStyle = '#fff'; g.fill(hull);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = rgba(col, 0.26 + 0.14 * strength); g.fillRect(-ext, -ext, ext * 2, ext * 2);
  // hex lattice
  g.globalCompositeOperation = 'source-atop';
  g.strokeStyle = rgba(col, 0.55 + 0.3 * strength); g.lineWidth = Math.max(1 / px, 0.01 * S);
  const r = 0.06 * S, w = r * Math.sqrt(3);
  g.beginPath();
  for (let yy = -ext, row = 0; yy < ext; yy += r * 1.5, row++) for (let xx = -ext + (row % 2 ? w / 2 : 0); xx < ext; xx += w) {
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + Math.PI / 6; const X = xx + Math.cos(a) * r, Y = yy + Math.sin(a) * r; k ? g.lineTo(X, Y) : g.moveTo(X, Y); }
    g.closePath();
  }
  g.stroke();
  // carve out the hull interior so the shell reads as an envelope, brightest at its rim
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = 'rgba(0,0,0,0.7)'; g.fill(hull);
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = rgba(col, 0.7); g.lineWidth = Math.max(1 / px, 0.012 * S);
  g.save(); g.scale(1 + pad / (0.45 * S), 1 + pad / (0.45 * S)); g.stroke(hull); g.restore();
  return c;
}
