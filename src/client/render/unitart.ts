// Procedural top-down unit art composed from a Design's parts.
//
// Local frame: nose toward +x, +y to the unit's right, units = cells. S = chassis size (footprint S x S cells).
// Static layers (mobility frames, hull, shadow, silhouettes, turrets) are baked into offscreen canvases per
// design + team + device-pixels-per-cell; per frame a unit costs a handful of drawImage calls plus a few
// dynamic strokes (rotor blades, thruster flames, status effects).

import { CHASSIS_BY_ID, MOBILITY_BY_ID, MODULE_BY_ID } from '../../shared/parts.ts';
import type { ChassisDef, Design, MobilityDef, ModuleDef, MountClass } from '../../shared/types.ts';
import { METAL, OUTLINE, TEAM_PAL, clamp, ctx2d, makeCanvas, mirrorPoly, poly, rgba, roundRect, shade, softDot, type Ctx, type Team, type TeamPal } from './palette.ts';
import { TURRET_EXT, drawTurret, drawTurretDynamic, muzzleLen } from './turrets.ts';
import { GIANT_SHAPES, emis, drawBarbette, drawGiantFx, drawGravlift, drawMegatracks, drawTitanLegs, giantHullDetails, giantHullPath, giantTopLayer } from './giantart.ts';

type Shape = ChassisDef['shape'];

export interface MountSlot {
  x: number;
  y: number;
  slot: MountClass;
  mod: ModuleDef | null;
  /** turret base diameter, cells */
  d: number;
  /** turret sprite drawn (false for armor plates / empty) */
  turret: boolean;
}

export interface UnitLayout {
  key: string;
  S: number;
  chassis: ChassisDef;
  mob: MobilityDef;
  shape: Shape;
  /** hull half width (fraction of S) */
  hw: number;
  mounts: MountSlot[];
  /** sprite half-extent in cells */
  ext: number;
  air: boolean;
  quad: boolean;
  /** rotor hubs (cells, local) with blade radius */
  rotors: { x: number; y: number; r: number; blades: number }[];
  /** thruster nozzles (cells, local) for jets / jump legs */
  nozzles: { x: number; y: number; w: number }[];
  /** grav lifter pods */
  pods?: boolean;
  frames: number;
  /** cells of travel per animation cycle */
  cycle: number;
}

const SHAPE_HW: Record<Shape, number> = {
  wedge: 0.26, pod: 0.24, box: 0.28, hex: 0.3, cross: 0.3, long: 0.2, round: 0.34, airframe: 0.14, fortress: 0.4, titan: 0.3,
  goliath: 0.36, leviathan: 0.3, carrier: 0.42, colossal: 0.27, citadel: 0.42,
  mantis: 0.2, mech: 0.3, arachnid: 0.28, crab: 0.42, saucer: 0.42, delta: 0.16, warlord: 0.32, scorpion: 0.3, centipede: 0.18, broodmother: 0.32, arachne: 0.32,
  carriage: 0.2, siegeplat: 0.36, riot: 0.34, hunter: 0.24, juggernaut: 0.44, interceptor: 0.14, bomber: 0.2,
};

/** Mount points per chassis, fractions of S. */
const MOUNT_PTS: Record<string, [number, number][]> = {
  scout: [[0.02, 0]],
  drone: [[0.04, 0]],
  raider: [[0.06, -0.14], [0.06, 0.14]],
  warden: [[0.05, 0], [-0.25, 0.15]],
  striker: [[-0.02, -0.25], [-0.02, 0.25], [0.22, 0]],
  longarm: [[0.04, 0]],
  aegis: [[0.06, 0], [-0.22, 0]],
  gunship: [[-0.03, -0.28], [-0.03, 0.28]],
  bastion: [[0.06, 0], [-0.24, -0.25], [-0.24, 0.25]],
  colossus: [[0.0, -0.31], [0.0, 0.31], [0.18, 0], [-0.24, 0]],
  // giants / titans: turrets sit ON the hull with clear deck between them (hull dominates the silhouette)
  goliath: [[0.08, 0], [-0.07, -0.34], [-0.07, 0.34], [-0.31, 0]],
  leviathan: [[0.27, 0], [-0.28, 0], [0.0, -0.205], [0.0, 0.205]],
  carrier: [[0.33, 0], [-0.07, -0.31], [-0.37, -0.25], [-0.37, 0.25]],
  // titan walker: T on the right forearm, G on the left forearm, heavies on the shoulder blades, M on the backpack
  titan: [[0.15, 0.37], [0.15, -0.37], [-0.115, -0.165], [-0.115, 0.165], [-0.34, 0]],
  citadel: [[0.235, -0.235], [0.235, 0.235], [-0.17, 0], [-0.385, -0.385], [-0.385, 0.385], [0.385, -0.385]],
};

const CLASS_D: Record<MountClass, number> = { L: 0.36, M: 0.5, H: 0.64, G: 0.95, T: 1.1 };
/** Turret base diameters (cells) on giant/titan hulls: big guns, but sized like real turrets on a huge hull. */
const GIANT_D: Record<MountClass, number> = { L: 0.4, M: 0.52, H: 0.68, G: 0.86, T: 1.14 };

const layoutCache = new Map<string, UnitLayout>();
export const designKey = (d: Design) => `${d.chassis}|${d.mobility}|${d.mounts.map((m) => m ?? '-').join(',')}`;

export function layoutOf(d: Design): UnitLayout {
  const key = designKey(d);
  let L = layoutCache.get(key);
  if (L) return L;
  const chassis = CHASSIS_BY_ID.get(d.chassis) ?? CHASSIS_BY_ID.get('scout')!;
  const mob = MOBILITY_BY_ID.get(d.mobility) ?? MOBILITY_BY_ID.get('wheels')!;
  const S = chassis.size;
  const shape = chassis.shape;
  const pts = MOUNT_PTS[chassis.id] ?? chassis.mounts.map((_, i, a) => [0.05 - 0.25 * Math.floor(i / 2), a.length === 1 ? 0 : (i % 2 ? 0.2 : -0.2)] as [number, number]);
  const mounts: MountSlot[] = chassis.mounts.map((slot, i) => {
    const id = d.mounts[i] ?? null;
    const mod = id ? MODULE_BY_ID.get(id) ?? null : null;
    const cls = mod?.mount ?? slot;
    const cal = mod?.caliber ?? 0.5;
    const p = pts[i] ?? [0, 0];
    const dd = S >= 4 ? GIANT_D[cls] * (0.88 + 0.12 * cal) * (S >= 5 ? 1.06 : 1) : CLASS_D[cls] * (0.8 + 0.4 * cal) * (1 + 0.12 * (S - 1));
    return { x: p[0] * S, y: p[1] * S, slot, mod, d: dd, turret: !!mod && mod.kind !== 'armor' && mod.visual !== 'plate' };
  });
  const air = mob.kind === 'air';
  const quad = mob.id === 'rotor' && (chassis.id === 'drone' || shape === 'pod' || shape === 'round');
  const rotors: UnitLayout['rotors'] = [];
  const nozzles: UnitLayout['nozzles'] = [];
  if (mob.id === 'rotor') {
    if (quad) for (const sx of [-1, 1]) for (const sy of [-1, 1]) rotors.push({ x: sx * 0.32 * S, y: sy * 0.32 * S, r: 0.2 * S, blades: 2 });
    else if (S >= 2 && shape === 'airframe') {
      rotors.push({ x: 0.22 * S, y: 0, r: 0.42 * S, blades: 3 });
      rotors.push({ x: -0.3 * S, y: 0, r: 0.38 * S, blades: 3 });
    } else rotors.push({ x: 0, y: 0, r: 0.52 * S, blades: 3 });
  }
  if (mob.id === 'jet') for (const sy of [-1, 1]) nozzles.push({ x: -0.5 * S, y: sy * 0.13 * S, w: 0.09 * S });
  if (mob.id === 'jumpjets') for (const sy of [-1, 1]) nozzles.push({ x: -0.4 * S, y: sy * 0.15 * S, w: 0.07 * S });
  const legged = mob.id === 'legs' || mob.id === 'spider' || mob.id === 'jumpjets' || mob.id === 'titanlegs';
  const rolled = mob.id === 'treads' || mob.id === 'wheels' || mob.id === 'halftrack' || mob.id === 'megatracks';
  L = {
    key, S, chassis, mob, shape, hw: SHAPE_HW[shape] ?? 0.28, mounts, air, quad, rotors, nozzles,
    ext: 0.8 * S,
    frames: legged ? 8 : mob.id === 'megatracks' ? 6 : rolled ? 4 : 1,
    cycle: mob.id === 'titanlegs' ? 0.7 * S : mob.id === 'megatracks' ? 0.06 * S : mob.id === 'legs' ? 0.75 * S : mob.id === 'spider' ? 0.55 * S : mob.id === 'jumpjets' ? 0.8 * S : mob.id === 'treads' || mob.id === 'halftrack' ? 0.09 * S : 0.06 * S,
  };
  layoutCache.set(key, L);
  return L;
}

/* ------------------------------------------------------------------------------------------------ hull */

export function hullPath(shape: Shape, S: number): Path2D {
  const p = new Path2D();
  switch (shape) {
    case 'wedge': poly(p, mirrorPoly([0.44, 0, 0.12, -0.16, -0.18, -0.26, -0.36, -0.26, -0.42, -0.17, -0.4, 0]), S); break;
    case 'pod': p.ellipse(0, 0, 0.3 * S, 0.24 * S, 0, 0, Math.PI * 2); break;
    case 'box': poly(p, mirrorPoly([0.39, -0.17, 0.3, -0.28, -0.36, -0.28, -0.41, -0.22]), S); break;
    case 'hex': poly(p, mirrorPoly([0.43, -0.1, 0.27, -0.3, -0.33, -0.3, -0.43, -0.16]), S); break;
    case 'cross': poly(p, mirrorPoly([0.45, -0.08, 0.34, -0.15, 0.13, -0.15, 0.1, -0.36, -0.15, -0.36, -0.18, -0.15, -0.38, -0.15, -0.44, -0.08]), S); break;
    case 'long': poly(p, mirrorPoly([0.47, -0.07, 0.38, -0.18, -0.38, -0.2, -0.46, -0.12]), S); break;
    case 'round': p.arc(0, 0, 0.34 * S, 0, Math.PI * 2); break;
    case 'airframe': poly(p, mirrorPoly([0.49, 0, 0.38, -0.08, 0.12, -0.13, 0.04, -0.4, -0.12, -0.42, -0.15, -0.13, -0.34, -0.08, -0.42, -0.21, -0.49, -0.21, -0.47, -0.05, -0.48, 0]), S); break;
    case 'fortress': poly(p, mirrorPoly([0.45, -0.2, 0.35, -0.41, -0.36, -0.41, -0.45, -0.3]), S); break;
    case 'titan': poly(p, mirrorPoly([0.33, -0.12, 0.22, -0.2, 0.2, -0.45, -0.18, -0.45, -0.21, -0.22, -0.36, -0.17, -0.42, -0.08]), S); break;
    default: return giantHullPath(shape, S) ?? p;
  }
  return p;
}

export function paintHull(g: Ctx, path: Path2D, pal: TeamPal, S: number, o: number, hw: number): void {
  // base + shading
  const gr = g.createLinearGradient(-0.3 * S, -hw * S * 1.2, 0.3 * S, hw * S * 1.2);
  gr.addColorStop(0, pal.light);
  gr.addColorStop(0.45, pal.body);
  gr.addColorStop(1, pal.dark);
  g.fillStyle = gr;
  g.fill(path);
  g.save();
  g.clip(path);
  // top light
  const rg = g.createRadialGradient(-0.05 * S, -0.08 * S, 0, 0, 0, 0.55 * S);
  rg.addColorStop(0, 'rgba(255,255,255,0.18)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(-S, -S, 2 * S, 2 * S);
  // weathering speckle (deterministic)
  let seed = 17 + S * 31;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40 * S; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.07)';
    const x = (rnd() - 0.5) * S, y = (rnd() - 0.5) * S, r = (0.004 + rnd() * 0.014) * S;
    g.fillRect(x, y, r, r);
  }
  // inner bevel: thick dark stroke clipped = rim shadow
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 0.06 * S;
  g.stroke(path);
  g.restore();
  // inner highlight
  g.save();
  g.scale(0.84, 0.84);
  g.strokeStyle = 'rgba(255,255,255,0.16)';
  g.lineWidth = o * 0.6;
  g.stroke(path);
  g.restore();
  g.strokeStyle = OUTLINE;
  g.lineWidth = o;
  g.lineJoin = 'round';
  g.stroke(path);
}

function line(g: Ctx, pts: number[], S: number, color: string, w: number): void {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.beginPath();
  for (let i = 0; i < pts.length; i += 4) {
    g.moveTo(pts[i] * S, pts[i + 1] * S);
    g.lineTo(pts[i + 2] * S, pts[i + 3] * S);
  }
  g.stroke();
}

function dotAt(g: Ctx, x: number, y: number, r: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function vents(g: Ctx, x: number, y: number, w: number, h: number, n: number, o: number): void {
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.beginPath();
  roundRect(g, x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.2)';
  g.lineWidth = o * 0.35;
  g.beginPath();
  for (let i = 1; i < n; i++) {
    const xx = x - w / 2 + (w * i) / n;
    g.moveTo(xx, y - h / 2 + h * 0.15);
    g.lineTo(xx, y + h / 2 - h * 0.15);
  }
  g.stroke();
}

function headlights(g: Ctx, x: number, y: number, r: number): void {
  dotAt(g, x, -y, r * 1.6, 'rgba(0,0,0,0.5)');
  dotAt(g, x, y, r * 1.6, 'rgba(0,0,0,0.5)');
  dotAt(g, x, -y, r, '#fff3c4');
  dotAt(g, x, y, r, '#fff3c4');
}

/** Panel lines, hatches, vents and team trim per silhouette. */
export function hullDetails(g: Ctx, L: UnitLayout, pal: TeamPal, o: number): void {
  const S = L.S;
  if (GIANT_SHAPES.has(L.shape)) { giantHullDetails(g, L, pal, o); return; }
  const pl = 'rgba(0,0,0,0.38)';
  const hl = 'rgba(255,255,255,0.14)';
  const t = o * 0.45;
  switch (L.shape) {
    case 'wedge':
      line(g, [0.3, 0, -0.1, -0.2, 0.3, 0, -0.1, 0.2], S, pl, t);
      line(g, [-0.3, -0.2, -0.3, 0.2], S, pl, t);
      vents(g, -0.36 * S, 0, 0.06 * S, 0.26 * S, 4, o);
      line(g, [0.2, -0.04, 0.0, -0.13, 0.2, 0.04, 0.0, 0.13], S, pal.accent, o * 0.9);
      break;
    case 'pod':
      g.strokeStyle = pl; g.lineWidth = t;
      g.beginPath(); g.ellipse(0, 0, 0.21 * S, 0.16 * S, 0, 0, Math.PI * 2); g.stroke();
      dotAt(g, 0.22 * S, 0, 0.05 * S, '#10161c');
      dotAt(g, 0.22 * S, 0, 0.028 * S, pal.glow);
      line(g, [-0.27, -0.07, -0.27, 0.07], S, pal.accent, o * 0.9);
      break;
    case 'box':
      line(g, [0.28, -0.26, 0.28, 0.26, -0.26, -0.26, -0.26, 0.26, 0.28, 0, -0.26, 0], S, pl, t);
      vents(g, -0.33 * S, 0, 0.07 * S, 0.3 * S, 5, o);
      headlights(g, 0.36 * S, 0.19 * S, 0.025 * S);
      line(g, [0.33, -0.27, 0.33, -0.12, 0.33, 0.27, 0.33, 0.12], S, pal.accent, o * 1.0);
      break;
    case 'hex':
      line(g, [0.27, -0.28, -0.33, -0.28, 0.27, 0.28, -0.33, 0.28, 0.3, -0.2, 0.3, 0.2], S, hl, t);
      line(g, [0.3, -0.2, 0.3, 0.2, -0.38, -0.12, -0.38, 0.12, 0.3, -0.2, 0.38, -0.08, 0.3, 0.2, 0.38, 0.08], S, pl, t);
      vents(g, -0.36 * S, -0.0, 0.06 * S, 0.22 * S, 4, o);
      headlights(g, 0.4 * S, 0.07 * S, 0.018 * S);
      line(g, [-0.2, -0.29, 0.1, -0.29, -0.2, 0.29, 0.1, 0.29], S, pal.accent, o * 0.9);
      break;
    case 'cross':
      line(g, [0.12, -0.15, 0.12, 0.15, -0.16, -0.15, -0.16, 0.15, 0.1, -0.33, -0.15, -0.33, 0.1, 0.33, -0.15, 0.33], S, pl, t);
      vents(g, -0.36 * S, 0, 0.06 * S, 0.18 * S, 4, o);
      headlights(g, 0.42 * S, 0.05 * S, 0.016 * S);
      line(g, [0.08, -0.36, 0.08, -0.14, 0.08, 0.36, 0.08, 0.14], S, pal.accent, o * 0.9);
      break;
    case 'long':
      line(g, [0.3, -0.17, 0.3, 0.17, -0.1, -0.19, -0.1, 0.19, -0.3, -0.19, -0.3, 0.19, 0.3, 0, 0.45, 0], S, pl, t);
      vents(g, -0.4 * S, 0, 0.05 * S, 0.2 * S, 4, o);
      for (let i = 0; i < 3; i++) dotAt(g, (-0.2 + i * 0.08) * S, 0.14 * S, 0.012 * S, 'rgba(0,0,0,0.5)');
      line(g, [0.36, -0.15, 0.42, -0.06, 0.36, 0.15, 0.42, 0.06], S, pal.accent, o * 0.9);
      break;
    case 'round':
      g.strokeStyle = pl; g.lineWidth = t;
      g.beginPath(); g.arc(0, 0, 0.27 * S, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = hl;
      g.beginPath(); g.arc(0, 0, 0.255 * S, Math.PI * 1.0, Math.PI * 1.6); g.stroke();
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2; dotAt(g, Math.cos(a) * 0.3 * S, Math.sin(a) * 0.3 * S, 0.012 * S, 'rgba(0,0,0,0.5)'); }
      g.strokeStyle = pal.accent; g.lineWidth = o;
      g.beginPath(); g.arc(0, 0, 0.31 * S, -0.5, 0.5); g.stroke();
      headlights(g, 0.31 * S, 0.06 * S, 0.016 * S);
      break;
    case 'airframe':
      // canopy
      g.fillStyle = '#132230';
      g.beginPath(); g.ellipse(0.31 * S, 0, 0.08 * S, 0.045 * S, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = rgba(pal.glow, 0.55);
      g.beginPath(); g.ellipse(0.33 * S, -0.012 * S, 0.04 * S, 0.018 * S, 0, 0, Math.PI * 2); g.fill();
      line(g, [0.1, -0.12, 0.1, 0.12, -0.15, -0.12, -0.15, 0.12, 0.04, -0.38, -0.1, -0.38, 0.04, 0.38, -0.1, 0.38], S, pl, t);
      line(g, [0.0, -0.4, -0.08, -0.4, 0.0, 0.4, -0.08, 0.4], S, pal.accent, o * 1.1);
      line(g, [-0.44, -0.19, -0.44, 0.19], S, pal.accent, o * 0.8);
      break;
    case 'fortress':
      line(g, [0.32, -0.36, 0.32, 0.36, -0.32, -0.36, -0.32, 0.36, 0.32, -0.36, -0.32, -0.36, 0.32, 0.36, -0.32, 0.36], S, pl, t);
      line(g, [0.31, -0.35, -0.31, -0.35], S, hl, t);
      vents(g, -0.39 * S, -0.17 * S, 0.05 * S, 0.16 * S, 4, o);
      vents(g, -0.39 * S, 0.17 * S, 0.05 * S, 0.16 * S, 4, o);
      for (const x of [0.38, -0.39]) for (const y of [-0.37, 0.37]) dotAt(g, x * S, y * S, 0.014 * S, 'rgba(0,0,0,0.55)');
      headlights(g, 0.43 * S, 0.12 * S, 0.016 * S);
      line(g, [0.4, -0.3, 0.4, -0.18, 0.4, 0.3, 0.4, 0.18], S, pal.accent, o * 1.2);
      break;
    case 'titan':
      line(g, [0.2, -0.2, -0.2, -0.2, 0.2, 0.2, -0.2, 0.2, 0.2, -0.44, -0.18, -0.44, 0.2, 0.44, -0.18, 0.44], S, pl, t);
      vents(g, -0.36 * S, 0, 0.05 * S, 0.2 * S, 4, o);
      g.fillStyle = '#10161c';
      g.beginPath(); g.ellipse(0.28 * S, 0, 0.035 * S, 0.08 * S, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = pal.glow;
      g.beginPath(); g.ellipse(0.29 * S, 0, 0.015 * S, 0.06 * S, 0, 0, Math.PI * 2); g.fill();
      line(g, [0.18, -0.43, 0.18, -0.24, 0.18, 0.43, 0.18, 0.24], S, pal.accent, o * 1.1);
      break;
  }
}

/** Armor plate modules: hull plating patterns per module id, plus side skirts for medium/heavy plating. */
export function drawPlates(g: Ctx, L: UnitLayout, pal: TeamPal, o: number): void {
  const S = L.S;
  let skirts = 0;
  let reactive = false;
  for (const m of L.mounts) {
    if (!m.mod || m.turret) continue;
    if (m.mod.id === 'plateM') skirts = Math.max(skirts, 1);
    if (m.mod.id === 'plateH') skirts = Math.max(skirts, 2);
    if (m.mod.id === 'plateG') skirts = Math.max(skirts, 3);
    if (m.mod.id === 'plateT') skirts = 4;
    if (m.mod.id === 'reactive') reactive = true;
  }
  const plateCol = shade(pal.body, -0.15);
  const hw = Math.min(L.hw, 0.36);
  const len = L.shape === 'airframe' ? 0.3 : 0.62;
  if (skirts) {
    const th = skirts === 4 ? 0.12 : skirts === 3 ? 0.1 : skirts === 2 ? 0.08 : 0.055;
    for (const s of [-1, 1]) {
      const y = s * (hw + th * 0.3) * S;
      g.beginPath();
      roundRect(g, -len / 2 * S, y - (th / 2) * S, len * S, th * S, th * 0.25 * S);
      g.fillStyle = skirts >= 2 ? shade(plateCol, -0.1) : plateCol;
      g.fill();
      g.lineWidth = o * 0.8;
      g.strokeStyle = OUTLINE;
      g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      g.lineWidth = o * 0.35;
      g.beginPath();
      const segs = skirts >= 2 ? 3 : 5;
      for (let i = 1; i < segs; i++) { const x = (-len / 2 + (len * i) / segs) * S; g.moveTo(x, y - (th / 2) * S); g.lineTo(x, y + (th / 2) * S); }
      g.stroke();
      if (skirts >= 2) for (let i = 0; i < segs; i++) dotAt(g, (-len / 2 + (len * (i + 0.5)) / segs) * S, y, th * 0.18 * S, 'rgba(0,0,0,0.55)');
    }
    if (skirts >= 2) {
      const nx = L.shape === 'titan' ? 0.27 : L.shape === 'round' ? 0.29 : 0.36;
      g.beginPath();
      roundRect(g, (nx - 0.05) * S, -0.18 * S, 0.085 * S, 0.36 * S, 0.02 * S);
      g.fillStyle = shade(plateCol, -0.1);
      g.fill();
      g.lineWidth = o * 0.8;
      g.strokeStyle = OUTLINE;
      g.stroke();
    }
  }
  if (reactive) {
    // explosive reactive tiles along both flanks
    const n = Math.max(3, Math.round(len * 8));
    const tw = (len / n) * S;
    for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
      const x = -len / 2 * S + i * tw, y = s * (hw - 0.02) * S;
      g.beginPath(); roundRect(g, x + tw * 0.08, y - tw * 0.42, tw * 0.84, tw * 0.84, tw * 0.12);
      g.fillStyle = '#7a7a52'; g.fill(); g.lineWidth = o * 0.5; g.strokeStyle = OUTLINE; g.stroke();
      dotAt(g, x + tw * 0.5, y, tw * 0.12, '#c0392b');
    }
  }
  for (const m of L.mounts) {
    if (!m.mod || m.turret) continue;
    const id = m.mod.id;
    const w = m.d * 1.3, h = m.d * 1.1;
    const P2 = Math.PI * 2;
    g.save();
    g.translate(m.x, m.y);
    if (id === 'reactive') {
      for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
        const tx = -w / 2 + (j * w) / 3, ty = -h / 2 + (i * h) / 2;
        g.beginPath(); roundRect(g, tx + w * 0.02, ty + h * 0.03, w / 3 - w * 0.04, h / 2 - h * 0.06, w * 0.04);
        g.fillStyle = (i + j) % 2 ? '#7a7a52' : '#6a6a46'; g.fill(); g.lineWidth = o * 0.6; g.strokeStyle = OUTLINE; g.stroke();
        dotAt(g, tx + w / 6, ty + h / 4, m.d * 0.05, '#c0392b');
      }
    } else if (id === 'mirror') {
      g.beginPath(); roundRect(g, -w / 2, -h / 2, w, h, h * 0.25);
      const gr = g.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
      gr.addColorStop(0, '#f4f8fc'); gr.addColorStop(0.35, '#9aa8b8'); gr.addColorStop(0.5, '#ffffff'); gr.addColorStop(0.65, '#8a98a8'); gr.addColorStop(1, '#c8d4e0');
      g.fillStyle = gr; g.fill(); g.lineWidth = o * 0.8; g.strokeStyle = OUTLINE; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = o * 0.6;
      g.beginPath(); g.moveTo(-w * 0.3, h * 0.35); g.lineTo(w * 0.1, -h * 0.35); g.moveTo(-w * 0.05, h * 0.35); g.lineTo(w * 0.3, -h * 0.25); g.stroke();
    } else if (id === 'plateM') {
      // layered composite: three stacked strips
      for (let i = 0; i < 3; i++) {
        const yy = -h / 2 + (i * h) / 3;
        g.beginPath(); roundRect(g, -w / 2 + (i === 1 ? w * 0.06 : 0), yy, w - (i === 1 ? w * 0.06 : 0), h / 3, h * 0.06);
        g.fillStyle = i === 1 ? shade(pal.dark, 0.05) : shade(pal.light, -0.15); g.fill(); g.lineWidth = o * 0.6; g.strokeStyle = OUTLINE; g.stroke();
      }
    } else if (id === 'plateG' || id === 'plateT') {
      const T = id === 'plateT';
      const gold = '#e8c25a';
      const W = w * 1.15, H = h * 1.15;
      for (let k = 2; k >= 0; k--) {
        const sc2 = 1 - k * 0.12;
        g.beginPath(); roundRect(g, -W / 2 * sc2 - k * 0.0, -H / 2 * sc2, W * sc2, H * sc2, H * 0.1);
        const gr = g.createLinearGradient(-W / 2, -H / 2, W / 2, H / 2);
        gr.addColorStop(0, shade(pal.light, -0.3 + (2 - k) * 0.08)); gr.addColorStop(1, shade(pal.deep, 0.12 + (2 - k) * 0.06));
        g.fillStyle = gr; g.fill(); g.lineWidth = o * (1.3 - k * 0.2); g.strokeStyle = OUTLINE; g.stroke();
      }
      g.strokeStyle = T ? gold : 'rgba(0,0,0,0.5)'; g.lineWidth = o * (T ? 1.3 : 0.7);
      g.beginPath(); roundRect(g, -W * 0.37, -H * 0.37, W * 0.74, H * 0.74, H * 0.06); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = o * 0.6;
      g.beginPath(); g.moveTo(0, -H * 0.37); g.lineTo(0, H * 0.37); g.moveTo(-W * 0.37, 0); g.lineTo(W * 0.37, 0); g.stroke();
      const rv = Math.max(0.016, m.d * 0.04);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        dotAt(g, sx * W * 0.43, sy * H * 0.43, rv * 1.5, 'rgba(0,0,0,0.65)');
        dotAt(g, sx * W * 0.43 - rv * 0.4, sy * H * 0.43 - rv * 0.4, rv * 0.7, T ? gold : 'rgba(255,255,255,0.4)');
      }
      for (const sy of [-1, 1]) {
        g.save(); g.beginPath(); g.rect(-W * 0.3, sy * H * 0.46 - H * 0.04, W * 0.6, H * 0.08); g.clip();
        g.fillStyle = '#e8b81c'; g.fillRect(-W, -H, W * 2, H * 2);
        g.strokeStyle = '#17140c'; g.lineWidth = H * 0.05; g.beginPath();
        for (let i = -8; i < 8; i++) { g.moveTo(i * H * 0.1, sy * H * 0.5); g.lineTo(i * H * 0.1 + H * 0.1, sy * H * 0.42); } g.stroke(); g.restore();
      }
      if (T) { g.strokeStyle = gold; g.lineWidth = o * 1.4; g.beginPath(); g.arc(0, 0, H * 0.16, 0, P2); g.stroke(); dotAt(g, 0, 0, H * 0.07, gold); }
    } else if (id === 'plateH') {
      g.beginPath(); roundRect(g, -w * 0.6, -h * 0.6, w * 1.2, h * 1.2, h * 0.12);
      const gr = g.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
      gr.addColorStop(0, shade(pal.light, -0.25)); gr.addColorStop(1, shade(pal.deep, 0.1));
      g.fillStyle = gr; g.fill(); g.lineWidth = o * 1.1; g.strokeStyle = OUTLINE; g.stroke();
      g.beginPath(); roundRect(g, -w * 0.42, -h * 0.42, w * 0.84, h * 0.84, h * 0.08);
      g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = o * 0.6; g.stroke();
      const rv = Math.max(0.014, m.d * 0.055);
      for (let i = 0; i < 4; i++) for (const sy of [-1, 1]) {
        const x = -w * 0.5 + (i + 0.5) * (w / 4);
        dotAt(g, x, sy * h * 0.51, rv, 'rgba(0,0,0,0.6)');
        dotAt(g, x - rv * 0.3, sy * h * 0.51 - rv * 0.3, rv * 0.5, 'rgba(255,255,255,0.35)');
      }
    } else {
      // plateL (and fallback): single riveted wedge slab
      g.beginPath();
      g.moveTo(-w / 2 + h * 0.2, -h / 2); g.lineTo(w / 2, -h / 2); g.lineTo(w / 2, h / 2); g.lineTo(-w / 2 + h * 0.2, h / 2); g.lineTo(-w / 2, 0); g.closePath();
      const gr = g.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
      gr.addColorStop(0, shade(pal.light, -0.1));
      gr.addColorStop(1, shade(pal.dark, -0.1));
      g.fillStyle = gr;
      g.fill();
      g.lineWidth = o * 0.8;
      g.strokeStyle = OUTLINE;
      g.stroke();
      const rv = Math.max(0.012, m.d * 0.05);
      for (const [x, y] of [[-0.3, -0.38], [0.4, -0.38], [-0.3, 0.38], [0.4, 0.38]]) {
        dotAt(g, x * w, y * h, rv, 'rgba(0,0,0,0.55)');
        dotAt(g, x * w - rv * 0.3, y * h - rv * 0.3, rv * 0.5, 'rgba(255,255,255,0.35)');
      }
    }
    g.restore();
  }
}

/** Long outrigger feet on the longarm platform and wing pylons are part of the hull layer. */
export function hullUnderlay(g: Ctx, L: UnitLayout, pal: TeamPal, o: number): void {
  const S = L.S;
  if (L.shape === 'long') {
    g.strokeStyle = METAL.dark;
    g.lineWidth = 0.06 * S;
    g.beginPath();
    for (const s of [-1, 1]) { g.moveTo(0.22 * S, s * 0.12 * S); g.lineTo(0.3 * S, s * 0.36 * S); g.moveTo(-0.26 * S, s * 0.12 * S); g.lineTo(-0.34 * S, s * 0.36 * S); }
    g.stroke();
    for (const s of [-1, 1]) for (const x of [0.3, -0.34]) {
      g.beginPath(); g.arc(x * S, s * 0.37 * S, 0.05 * S, 0, Math.PI * 2);
      g.fillStyle = METAL.base; g.fill(); g.lineWidth = o * 0.7; g.strokeStyle = OUTLINE; g.stroke();
    }
  }
  if (L.shape === 'titan') {
    // shoulder joints
    for (const s of [-1, 1]) {
      g.beginPath(); g.arc(0, s * 0.22 * S, 0.08 * S, 0, Math.PI * 2);
      g.fillStyle = METAL.dark; g.fill(); g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
    }
  }
  void pal;
}

/* ------------------------------------------------------------------------------------------- mobility */

function rubberBand(g: Ctx, x0: number, x1: number, y: number, w: number, phase: number, sp: number, o: number): void {
  const band = new Path2D();
  roundRect(band, x0, y - w / 2, x1 - x0, w, w * 0.45);
  g.fillStyle = METAL.rubber;
  g.fill(band);
  g.save();
  g.clip(band);
  g.strokeStyle = METAL.rubberHi;
  g.lineWidth = sp * 0.45;
  g.beginPath();
  for (let x = x0 - sp + phase * sp; x < x1 + sp; x += sp) { g.moveTo(x, y - w / 2); g.lineTo(x, y + w / 2); }
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(x0, y - w / 2, x1 - x0, w * 0.25);
  g.restore();
  g.lineWidth = o;
  g.strokeStyle = OUTLINE;
  g.stroke(band);
}

function wheel(g: Ctx, x: number, y: number, len: number, w: number, phase: number, o: number): void {
  rubberBand(g, x - len / 2, x + len / 2, y, w, phase, len / 4, o);
  g.fillStyle = METAL.light;
  g.beginPath();
  g.ellipse(x, y, len * 0.18, w * 0.3, 0, 0, Math.PI * 2);
  g.fill();
}

function limb(g: Ctx, pts: number[], w: number, color: string, o: number): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.strokeStyle = OUTLINE;
  g.lineWidth = w + o * 2;
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = w;
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = w * 0.3;
  g.stroke();
}

function joint(g: Ctx, x: number, y: number, r: number, color: string, o: number): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = o * 0.7;
  g.strokeStyle = OUTLINE;
  g.stroke();
}

function foot(g: Ctx, x: number, y: number, len: number, w: number, lift: number, o: number, color = METAL.base): void {
  const k = 1 + lift * 0.18;
  g.beginPath();
  roundRect(g, x - (len * k) / 2, y - (w * k) / 2, len * k, w * k, w * 0.35);
  g.fillStyle = lift > 0.05 ? shade(color, 0.15 * lift) : color;
  g.fill();
  g.lineWidth = o * 0.8;
  g.strokeStyle = OUTLINE;
  g.stroke();
}

/** Draw the mobility layer (under the hull). phase in [0,1); rest = idle stance. */
export function drawMobility(g: Ctx, L: UnitLayout, pal: TeamPal, phase: number, rest: boolean, o: number): void {
  const S = L.S;
  const id = L.mob.id;
  const P = Math.PI * 2;
  if (id === 'treads') {
    const big = S >= 4;
    const tc = Math.min(big ? 0.48 : 0.38, Math.max(0.3, L.hw + 0.06)) * S, tw = (big ? 0.15 : 0.19) * S;
    for (const s of [-1, 1]) {
      if (big) {
        const sp = 0.065 * S;
        rubberBand(g, -0.47 * S, 0.47 * S, s * tc, tw, phase, sp, o);
        g.fillStyle = 'rgba(0,0,0,0.4)';
        g.fillRect(-0.44 * S, s * tc - tw * 0.3, 0.88 * S, tw * 0.6);
        for (let i = 0; i < 6; i++) { const x = (-0.38 + i * 0.152) * S; g.fillStyle = METAL.base; g.beginPath(); g.arc(x, s * tc, tw * 0.3, 0, P); g.fill(); g.lineWidth = o * 0.7; g.strokeStyle = OUTLINE; g.stroke(); g.fillStyle = METAL.light; g.beginPath(); g.arc(x, s * tc, tw * 0.12, 0, P); g.fill(); }
        for (const x of [-0.44, 0.44]) { g.fillStyle = METAL.dark; g.beginPath(); g.arc(x * S, s * tc, tw * 0.42, 0, P); g.fill(); g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke(); }
        continue;
      }
      rubberBand(g, -0.47 * S, 0.47 * S, s * tc, tw, phase, 0.09 * S, o);
      for (const x of [-0.4, 0.4]) { g.fillStyle = METAL.base; g.beginPath(); g.arc(x * S, s * tc, tw * 0.28, 0, P); g.fill(); }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(-0.42 * S, s * tc - tw * 0.08, 0.84 * S, tw * 0.16);
    }
  } else if (id === 'wheels') {
    const xs = S === 1 ? [-0.27, 0.27] : [-0.32, 0, 0.32];
    const y = (S === 1 ? 0.3 : 0.34) * S;
    g.strokeStyle = METAL.dark;
    g.lineWidth = 0.05 * S;
    g.beginPath();
    for (const x of xs) { g.moveTo(x * S, -y); g.lineTo(x * S, y); }
    g.stroke();
    for (const x of xs) for (const s of [-1, 1]) wheel(g, x * S, s * y, 0.22 * S, 0.13 * S, phase, o);
  } else if (id === 'halftrack') {
    const y = Math.min(0.36, L.hw + 0.05) * S;
    for (const s of [-1, 1]) rubberBand(g, -0.47 * S, 0.06 * S, s * y, 0.16 * S, phase, 0.08 * S, o);
    g.strokeStyle = METAL.dark; g.lineWidth = 0.05 * S;
    g.beginPath(); g.moveTo(0.29 * S, -0.3 * S); g.lineTo(0.29 * S, 0.3 * S); g.stroke();
    for (const s of [-1, 1]) wheel(g, 0.29 * S, s * 0.3 * S, 0.2 * S, 0.12 * S, phase, o);
  } else if (id === 'legs' || id === 'jumpjets') {
    const jump = id === 'jumpjets';
    const hy = 0.2 * S, fy = (jump ? 0.31 : 0.3) * S, stride = (jump ? 0.14 : 0.19) * S;
    for (const s of [-1, 1]) {
      const ph = phase * P + (s > 0 ? Math.PI : 0);
      const fx = rest ? (s > 0 ? 0.04 : -0.04) * S : Math.sin(ph) * stride;
      const lift = rest ? 0 : Math.max(0, Math.cos(ph));
      const kx = fx * 0.4 + (jump ? -0.12 : 0.06) * S, ky = s * (fy + 0.07 * S);
      limb(g, [0, s * hy, kx, ky, fx, s * fy], (jump ? 0.1 : 0.075) * S, jump ? METAL.dark : METAL.base, o);
      if (jump) limb(g, [kx * 0.5, s * hy, kx - 0.04 * S, ky - s * 0.02 * S], 0.035 * S, METAL.light, o * 0.6);
      joint(g, kx, ky, 0.055 * S * (1 + lift * 0.15), jump ? pal.dark : METAL.light, o);
      foot(g, fx + 0.03 * S, s * fy, (jump ? 0.2 : 0.18) * S, 0.1 * S, lift, o, jump ? METAL.dark : METAL.base);
    }
    if (jump) for (const n of L.nozzles) {
      g.beginPath(); roundRect(g, n.x, n.y - n.w, 0.16 * S, n.w * 2, n.w * 0.5);
      g.fillStyle = METAL.dark; g.fill(); g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
      dotAt(g, n.x + 0.02 * S, n.y, n.w * 0.6, '#0a0a0a');
    }
  } else if (id === 'spider') {
    const angs = [0.55, 1.57, 2.55];
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      const grp = (i + (s > 0 ? 1 : 0)) % 2;
      const ph = phase * P + grp * Math.PI;
      const sw = rest ? 0 : Math.sin(ph) * 0.2;
      const lift = rest ? 0 : Math.max(0, Math.cos(ph));
      const a = s * angs[i] - s * sw;
      const ca = Math.cos(a), sa = Math.sin(a);
      const hx = ca * 0.16 * S, hy = sa * 0.16 * S;
      const kx = ca * (0.38 + lift * 0.03) * S, ky = sa * (0.38 + lift * 0.03) * S;
      const fx = ca * 0.52 * S, fy = sa * 0.52 * S;
      limb(g, [hx, hy, kx, ky], 0.065 * S, METAL.base, o);
      limb(g, [kx, ky, fx, fy], 0.045 * S, METAL.dark, o);
      joint(g, kx, ky, 0.045 * S * (1 + lift * 0.25), lift > 0.3 ? METAL.light : pal.dark, o);
      dotAt(g, fx, fy, 0.025 * S, OUTLINE);
    }
  } else if (id === 'megatracks') {
    drawMegatracks(g, L, pal, phase, o);
  } else if (id === 'titanlegs') {
    drawTitanLegs(g, L, pal, phase, rest, o);
  } else if (id === 'gravlift') {
    drawGravlift(g, L, pal, o);
  } else if (id === 'hover') {
    const sk = new Path2D();
    roundRect(sk, -0.46 * S, -0.37 * S, 0.9 * S, 0.74 * S, 0.22 * S);
    g.fillStyle = '#202326';
    g.fill(sk);
    g.save();
    g.clip(sk);
    g.strokeStyle = '#34383c';
    g.lineWidth = 0.02 * S;
    g.beginPath();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * P; g.moveTo(0, 0); g.lineTo(Math.cos(a) * S, Math.sin(a) * S); }
    g.stroke();
    g.restore();
    g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke(sk);
    g.save(); g.scale(0.93, 0.92); g.strokeStyle = rgba(pal.accent, 0.5); g.lineWidth = o * 0.6; g.stroke(sk); g.restore();
    for (const s of [-1, 1]) {
      const cx = -0.4 * S, cy = s * 0.2 * S, r = 0.11 * S;
      joint(g, cx, cy, r, METAL.dark, o);
      g.strokeStyle = METAL.light; g.lineWidth = 0.018 * S;
      g.beginPath();
      for (let i = 0; i < 5; i++) { const a = (i / 5) * P + s; g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85); }
      g.stroke();
      dotAt(g, cx, cy, r * 0.25, METAL.base);
    }
  } else if (id === 'rotor') {
    if (L.quad) {
      g.strokeStyle = OUTLINE; g.lineWidth = 0.075 * S;
      g.beginPath();
      for (const r of L.rotors) { g.moveTo(0, 0); g.lineTo(r.x, r.y); }
      g.stroke();
      g.strokeStyle = METAL.base; g.lineWidth = 0.05 * S;
      g.stroke();
      for (const r of L.rotors) joint(g, r.x, r.y, 0.07 * S, pal.dark, o);
    } else if (L.rotors.length === 1) {
      // tail boom + skids
      g.strokeStyle = METAL.dark; g.lineWidth = 0.035 * S;
      g.beginPath();
      for (const s of [-1, 1]) { g.moveTo(-0.24 * S, s * 0.22 * S); g.lineTo(0.26 * S, s * 0.22 * S); }
      g.stroke();
      g.beginPath();
      roundRect(g, -0.66 * S, -0.04 * S, 0.5 * S, 0.08 * S, 0.03 * S);
      g.fillStyle = pal.dark; g.fill(); g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
      g.beginPath();
      roundRect(g, -0.66 * S, -0.13 * S, 0.08 * S, 0.26 * S, 0.02 * S);
      g.fillStyle = pal.body; g.fill(); g.stroke();
      g.beginPath(); g.ellipse(-0.6 * S, 0.1 * S, 0.06 * S, 0.012 * S, 0, 0, P);
      g.fillStyle = 'rgba(30,30,30,0.7)'; g.fill();
    } else {
      // tandem rotor pylons
      for (const r of L.rotors) joint(g, r.x, r.y, 0.06 * S, METAL.dark, o);
    }
  } else if (id === 'jet') {
    const wing = new Path2D();
    poly(wing, mirrorPoly([0.12, -0.05, -0.18, -0.46, -0.3, -0.48, -0.3, -0.3, -0.36, -0.05]), S);
    const gr = g.createLinearGradient(0, -0.5 * S, 0, 0.5 * S);
    gr.addColorStop(0, shade(pal.dark, 0.1));
    gr.addColorStop(0.5, pal.dark);
    gr.addColorStop(1, shade(pal.dark, -0.3));
    g.fillStyle = gr;
    g.fill(wing);
    g.lineWidth = o; g.strokeStyle = OUTLINE; g.lineJoin = 'round'; g.stroke(wing);
    line(g, [-0.18, -0.44, -0.27, -0.46, -0.18, 0.44, -0.27, 0.46], S, pal.accent, o * 1.2);
    line(g, [0.0, -0.12, -0.26, -0.36, 0.0, 0.12, -0.26, 0.36], S, 'rgba(0,0,0,0.35)', o * 0.5);
    for (const n of L.nozzles) {
      g.beginPath(); roundRect(g, n.x, n.y - n.w * 0.75, 0.36 * S, n.w * 1.5, n.w * 0.6);
      g.fillStyle = METAL.dark; g.fill(); g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(n.x + 0.05 * S, n.y - n.w * 0.5, 0.25 * S, n.w * 0.25);
    }
  }
}

/** Anchor base plate (drawn axis-aligned, does not rotate with the hull). */
export function drawAnchorPlate(g: Ctx, L: UnitLayout, pal: TeamPal, o: number): void {
  const S = L.S;
  const p = new Path2D();
  poly(p, [0.47, -0.3, 0.47, 0.3, 0.3, 0.47, -0.3, 0.47, -0.47, 0.3, -0.47, -0.3, -0.3, -0.47, 0.3, -0.47], S);
  g.fillStyle = '#3a3f44';
  g.fill(p);
  g.save();
  g.clip(p);
  g.strokeStyle = 'rgba(240,190,40,0.55)';
  g.lineWidth = 0.05 * S;
  g.beginPath();
  for (let i = -12; i < 12; i++) { const x = i * 0.1 * S; g.moveTo(x, -0.6 * S); g.lineTo(x + 1.2 * S, 0.6 * S); }
  g.stroke();
  g.beginPath();
  poly(g, [0.39, -0.25, 0.39, 0.25, 0.25, 0.39, -0.25, 0.39, -0.39, 0.25, -0.39, -0.25, -0.25, -0.39, 0.25, -0.39], S);
  g.fillStyle = '#41474d';
  g.fill();
  g.restore();
  g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke(p);
  g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = o * 0.5;
  g.beginPath(); g.arc(0, 0, 0.3 * S, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = rgba(pal.accent, 0.5);
  g.beginPath(); g.arc(0, 0, 0.32 * S, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * 0.41 * S, y = Math.sin(a) * 0.41 * S;
    dotAt(g, x, y, 0.028 * S, '#1b1e21');
    dotAt(g, x - 0.006 * S, y - 0.006 * S, 0.016 * S, '#9aa2aa');
  }
}

/* ------------------------------------------------------------------------------------------- sprites */

export interface UnitSprites {
  px: number;
  ext: number;
  hull: HTMLCanvasElement;
  mob: (HTMLCanvasElement | undefined)[];
  rest: HTMLCanvasElement;
  shadow: HTMLCanvasElement;
  /** dark outline + team rim + soft glow, drawn under the unit */
  halo: HTMLCanvasElement;
  haloExt: number;
  sil: Map<string, HTMLCanvasElement>;
  anchor?: HTMLCanvasElement;
  /** parts drawn above the turrets (titan pauldrons) */
  top?: HTMLCanvasElement;
}

const spriteCache = new Map<string, UnitSprites>();
const turretCache = new Map<string, HTMLCanvasElement>();
const MAX_SPRITES = 400;

function beginSprite(px: number, ext: number): { c: HTMLCanvasElement; g: Ctx } {
  const size = Math.ceil(2 * ext * px);
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  g.translate(size / 2, size / 2);
  g.scale(px, px);
  return { c, g };
}

/** Outline width in cells: thick enough to read at small sizes. */
const outlineW = (px: number, S: number) => Math.max(1.3 / px, 0.03 * Math.min(S, 2));

export function unitSprites(design: Design, team: Team, px: number): UnitSprites {
  px = Math.max(4, Math.round(px));
  const L = layoutOf(design);
  const key = `${L.key}|${team}|${px}`;
  let s = spriteCache.get(key);
  if (s) return s;
  if (spriteCache.size > MAX_SPRITES) spriteCache.clear();
  const pal = TEAM_PAL[team];
  const o = outlineW(px, L.S);
  const ext = L.ext;
  const hull = beginSprite(px, ext);
  hullUnderlay(hull.g, L, pal, o);
  const hp = hullPath(L.shape, L.S);
  paintHull(hull.g, hp, pal, L.S, o, L.hw);
  hullDetails(hull.g, L, pal, o);
  drawPlates(hull.g, L, pal, o);
  // empty mount sockets
  if (L.S >= 4) {
    for (const m of L.mounts) if (m.turret || !m.mod) drawBarbette(hull.g, m.x, m.y, m.d * (m.turret ? 0.6 : 0.42), pal, o, !m.mod);
  } else for (const m of L.mounts) if (!m.mod) {
    dotAt(hull.g, m.x, m.y, m.d * 0.32, 'rgba(0,0,0,0.45)');
    dotAt(hull.g, m.x, m.y, m.d * 0.18, 'rgba(255,255,255,0.08)');
  }
  let top: HTMLCanvasElement | undefined;
  if (GIANT_SHAPES.has(L.shape)) {
    const tp = beginSprite(px, ext);
    if (giantTopLayer(tp.g, L, pal, o)) top = tp.c;
  }
  const rest = beginSprite(px, ext);
  if (L.mob.id !== 'anchor') drawMobility(rest.g, L, pal, 0, true, o);
  let anchor: HTMLCanvasElement | undefined;
  if (L.mob.id === 'anchor') {
    const a = beginSprite(px, ext);
    drawAnchorPlate(a.g, L, pal, o);
    anchor = a.c;
  }
  // shadow: union of mobility + hull silhouettes, darkened & blurred
  const sh = beginSprite(px, ext);
  sh.g.setTransform(1, 0, 0, 1, 0, 0);
  sh.g.filter = `blur(${Math.max(1, px * 0.04 * L.S)}px)`;
  if (anchor) sh.g.drawImage(anchor, 0, 0);
  sh.g.drawImage(rest.c, 0, 0);
  sh.g.drawImage(hull.c, 0, 0);
  if (top) sh.g.drawImage(top, 0, 0);
  sh.g.filter = 'none';
  sh.g.globalCompositeOperation = 'source-in';
  sh.g.fillStyle = '#000';
  sh.g.fillRect(0, 0, sh.c.width, sh.c.height);
  s = { px, ext, hull: hull.c, mob: new Array(L.frames), rest: rest.c, shadow: sh.c, halo: sh.c, haloExt: ext, sil: new Map(), anchor, top };
  const hl = buildHalo(s, pal);
  s.halo = hl.c;
  s.haloExt = hl.ext;
  spriteCache.set(key, s);
  return s;
}

/** Dark outline + bright team rim + soft underglow around the whole unit silhouette. Widths are in device px
 *  (sprite px is ~screen px) so they stay legible when the whole field is visible. */
function buildHalo(s: UnitSprites, pal: TeamPal): { c: HTMLCanvasElement; ext: number } {
  const px = s.px;
  const ow = clamp(px * 0.035, 1, 2.4); // dark outline
  const rw = clamp(px * 0.07, 1.5, 3.4); // team rim
  const gw = clamp(px * 0.18, 3, 9); // glow reach
  const pad = ow + rw + gw + 2;
  const ext = s.ext + pad / px;
  const size = Math.ceil(2 * ext * px);
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const off = (size - s.hull.width) / 2;
  const stamp = (col: string, r: number, n: number) => {
    const sil = silhouette(s, col);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      g.drawImage(sil, off + Math.cos(a) * r, off + Math.sin(a) * r);
    }
  };
  // soft glow
  g.filter = `blur(${gw * 0.45}px)`;
  g.globalAlpha = 0.4;
  stamp(pal.rim, ow + rw, 12);
  g.filter = 'none';
  g.globalAlpha = 1;
  // rim ring
  stamp(pal.rim, ow + rw, 20);
  stamp(pal.rim, ow + rw * 0.5, 16);
  // dark outline directly around the unit
  stamp(OUTLINE, ow, 16);
    g.drawImage(silhouette(s, OUTLINE), off, off);
  return { c, ext };
}

export function mobFrame(design: Design, team: Team, s: UnitSprites, idx: number): HTMLCanvasElement {
  const L = layoutOf(design);
  if (L.frames <= 1 || L.mob.id === 'anchor') return s.rest;
  idx = ((idx % L.frames) + L.frames) % L.frames;
  let c = s.mob[idx];
  if (c) return c;
  const sp = beginSprite(s.px, s.ext);
  drawMobility(sp.g, L, TEAM_PAL[team], idx / L.frames, false, outlineW(s.px, L.S));
  s.mob[idx] = sp.c;
  return sp.c;
}

/** Solid-colour silhouette of hull + mobility (hit flash, ghost tint, wreck). */
export function silhouette(s: UnitSprites, color: string): HTMLCanvasElement {
  let c = s.sil.get(color);
  if (c) return c;
  c = makeCanvas(s.hull.width, s.hull.height);
  const g = ctx2d(c);
  g.drawImage(s.rest, 0, 0);
  g.drawImage(s.hull, 0, 0);
  if (s.top) g.drawImage(s.top, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  s.sil.set(color, c);
  return c;
}

export function turretSprite(m: ModuleDef, team: Team, d: number, px: number): HTMLCanvasElement {
  px = Math.max(4, Math.round(px));
  const dq = Math.round(d * 100) / 100;
  const key = `${m.id}|${team}|${dq}|${px}`;
  let c = turretCache.get(key);
  if (c) return c;
  if (turretCache.size > 1200) turretCache.clear();
  const ext = TURRET_EXT * dq;
  const sp = beginSprite(px, ext);
  // soft contact shadow under the turret
  sp.g.fillStyle = 'rgba(0,0,0,0.35)';
  sp.g.beginPath();
  sp.g.arc(dq * 0.06, dq * 0.08, dq * 0.5, 0, Math.PI * 2);
  sp.g.fill();
  drawTurret(sp.g, m, TEAM_PAL[team], dq, Math.max(1.1 / px, dq * 0.07), true);
  turretCache.set(key, sp.c);
  return sp.c;
}

/** Wreck sprite: hull silhouette charred, used for persistent battlefield decals. */
export function wreckSprite(design: Design, team: Team, px: number): HTMLCanvasElement {
  const s = unitSprites(design, team, px);
  let c = s.sil.get('#wreck');
  if (c) return c;
  c = makeCanvas(s.hull.width, s.hull.height);
  const g = ctx2d(c);
  g.drawImage(s.rest, 0, 0);
  g.drawImage(s.hull, 0, 0);
  if (s.top) g.drawImage(s.top, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  // desaturate + near-black so a wreck never reads as a live unit
  g.fillStyle = 'rgba(20,21,22,0.93)';
  g.fillRect(0, 0, c.width, c.height);
  // burn streaks
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * c.width, y = Math.random() * c.height, r = c.width * (0.06 + Math.random() * 0.1);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(0,0,0,0.7)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  s.sil.set('#wreck', c);
  return c;
}

/* ------------------------------------------------------------------------------------------ drawing */

export interface MountPose {
  angle: number;
  flash: number;
  /** 0..1 melee strike animation (1 = just struck) */
  swing?: number;
  /** magazine reloading */
  reloading?: boolean;
  /** seconds until the mount can fire again (sim MountState.cooldown) */
  cd?: number;
  /** mount has a target */
  armed?: boolean;
  /** 0..1 sustained-fire heat (beam warm-up), tracked by the field view */
  heat?: number;
}

export interface UnitPose {
  design: Design;
  team: Team;
  x: number;
  y: number;
  angle: number;
  time: number;
  odometer?: number;
  moving?: boolean;
  leap?: number;
  flying?: boolean;
  hitFlash?: number;
  /** world-space mount angles; omitted = point along the hull with idle sway */
  mounts?: MountPose[];
  alpha?: number;
  /** status effects (optional sim fields) */
  stun?: number;
  slow?: number;
  burning?: number;
  disarm?: number;
  /** cloaked: 'own' = viewer's cloaked unit (ghosted), 'enemy' = barely visible shimmer */
  cloak?: 'own' | 'enemy';
  /** stable per-unit seed for idle variation */
  seed?: number;
}

/** Screen-space directions expressed in world units (they flip when the view is rotated 180°). */
export interface ViewDirs {
  /** world vector pointing screen-down-right (shadow direction) */
  sx: number;
  sy: number;
  /** world vector pointing screen-up (altitude lift) */
  ux: number;
  uy: number;
}

export const DEFAULT_DIRS: ViewDirs = { sx: 0.6, sy: 0.8, ux: 0, uy: -1 };

function blit(g: Ctx, c: HTMLCanvasElement, x: number, y: number, ang: number, ext: number, scale = 1): void {
  const cs = Math.cos(ang) * scale, sn = Math.sin(ang) * scale;
  const t = g.getTransform();
  g.transform(cs, sn, -sn, cs, x, y);
  g.drawImage(c, -ext, -ext, ext * 2, ext * 2);
  g.setTransform(t);
}

/** Visual altitude (cells) for a pose: flyers hover, leapers arc. */
export function altitudeOf(p: UnitPose, L: UnitLayout): number {
  if (L.air || p.flying) return 0.55 + 0.25 * L.S + Math.sin(p.time * 2.1 + (p.seed ?? 0)) * 0.05;
  if (p.leap) return p.leap * 1.4 * L.S;
  if (L.mob.id === 'hover') return 0.04 + Math.sin(p.time * 3 + (p.seed ?? 0)) * 0.015;
  return 0;
}

export function drawUnitShadow(g: Ctx, p: UnitPose, px: number, dirs: ViewDirs = DEFAULT_DIRS): void {
  const L = layoutOf(p.design);
  const s = unitSprites(p.design, p.team, px);
  const alt = altitudeOf(p, L);
  const off = 0.09 * L.S + alt * 0.75;
  const a = (p.alpha ?? 1) * (L.air || p.flying ? (L.S >= 4 ? 0.62 : L.S >= 3 ? 0.5 : 0.38) : p.leap ? 0.55 - p.leap * 0.15 : L.S >= 4 ? 0.72 : 0.62);
  g.globalAlpha = a;
  const sc = L.air || p.flying ? (L.S >= 4 ? 0.97 : 0.85) : 1 - (p.leap ?? 0) * 0.15;
  blit(g, s.shadow, p.x + dirs.sx * off, p.y + dirs.sy * off, L.mob.id === 'anchor' ? 0 : p.angle, s.ext, sc);
  g.globalAlpha = 1;
}

export function rotorBlur(g: Ctx, x: number, y: number, r: number, blades: number, t: number, px: number): void {
  g.fillStyle = 'rgba(210,220,230,0.07)';
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(220,230,240,0.22)';
  g.lineWidth = Math.max(1 / px, r * 0.035);
  g.beginPath();
  g.arc(x, y, r * 0.95, 0, Math.PI * 2);
  g.stroke();
  const spin = t * 31;
  g.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    g.strokeStyle = k === 0 ? 'rgba(25,28,32,0.75)' : `rgba(190,200,210,${0.22 - k * 0.06})`;
    g.lineWidth = Math.max(1.4 / px, r * (k === 0 ? 0.09 : 0.14));
    g.beginPath();
    for (let i = 0; i < blades; i++) {
      const a = spin - k * 0.3 + (i / blades) * Math.PI * 2;
      g.moveTo(x + Math.cos(a) * r * 0.12, y + Math.sin(a) * r * 0.12);
      g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.stroke();
  }
  g.fillStyle = '#2b3035';
  g.beginPath();
  g.arc(x, y, r * 0.13, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#b0b8c0';
  g.beginPath();
  g.arc(x - r * 0.03, y - r * 0.03, r * 0.06, 0, Math.PI * 2);
  g.fill();
}

export function flame(g: Ctx, x: number, y: number, ang: number, len: number, w: number, hot: string): void {
  const prev = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter';
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const dot = softDot(hot);
  const core = softDot('rgba(255,255,240,0.9)');
  for (let i = 0; i < 3; i++) {
    const d = (i / 3) * len;
    const r = w * (1.4 - i * 0.35);
    g.drawImage(dot, x + cs * d - r, y + sn * d - r, r * 2, r * 2);
  }
  g.drawImage(core, x - w * 0.6, y - w * 0.6, w * 1.2, w * 1.2);
  g.globalCompositeOperation = prev;
}

/** Draw the unit itself (no shadow, no bars). g is in world-cell coordinates. */
export function drawUnit(g: Ctx, p: UnitPose, px: number, dirs: ViewDirs = DEFAULT_DIRS): void {
  const L = layoutOf(p.design);
  const s = unitSprites(p.design, p.team, px);
  const alt = altitudeOf(p, L);
  const lift = L.air || p.flying ? 0.12 : alt * 0.35;
  const x = p.x + dirs.ux * lift, y = p.y + dirs.uy * lift;
  const sc = 1 + (p.leap ?? 0) * 0.3 + (L.air ? 0.04 : 0);
  const pal = TEAM_PAL[p.team];
  const ang = p.angle;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  let alpha = p.alpha ?? 1;
  if (p.cloak === 'own') alpha *= 0.4 + 0.08 * Math.sin(p.time * 5 + (p.seed ?? 0));
  else if (p.cloak === 'enemy') alpha *= 0.06 + 0.05 * Math.max(0, Math.sin(p.time * 3.3 + (p.seed ?? 0)));
  g.globalAlpha = alpha;

  // hover glow beneath
  if (L.mob.id === 'hover') {
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = alpha * (0.45 + 0.1 * Math.sin(p.time * 9 + (p.seed ?? 0)));
    const r = 0.55 * L.S;
    g.drawImage(softDot(pal.glow), p.x - r, p.y - r, r * 2, r * 2);
    g.globalCompositeOperation = prev;
    g.globalAlpha = alpha;
  }
  // giants: a pulsing pool of team light on the ground beneath them, so the eye goes to them first
  if (L.S >= 4 && p.cloak !== 'enemy') {
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = alpha * (0.16 + 0.06 * Math.sin(p.time * 2.2 + (p.seed ?? 0)));
    const r = 0.95 * L.S;
    g.drawImage(softDot(emis(pal)), p.x - r, p.y - r, r * 2, r * 2);
    g.globalCompositeOperation = prev;
    g.globalAlpha = alpha;
  }
  // outline + team rim/underglow (stays upright-agnostic: it is the silhouette, rotated with the unit)
  if (p.cloak !== 'enemy') blit(g, s.halo, x, y, ang, s.haloExt, sc);
  if (s.anchor) blit(g, s.anchor, x, y, 0, s.ext, sc);
  // mobility
  let frame = s.rest;
  if (L.frames > 1 && p.moving !== false && p.odometer !== undefined && (p.moving || L.mob.id === 'treads' || L.mob.id === 'wheels' || L.mob.id === 'halftrack')) {
    const ph = (p.odometer / L.cycle) % 1;
    frame = mobFrame(p.design, p.team, s, Math.floor(ph * L.frames));
  }
  blit(g, frame, x, y, ang, s.ext, sc);
  // jets: afterburner
  if (L.mob.id === 'jet') {
    const fl = 0.85 + Math.random() * 0.3;
    for (const n of L.nozzles) {
      const nx = x + (cs * (n.x - 0.02) - sn * n.y) * sc, ny = y + (sn * (n.x - 0.02) + cs * n.y) * sc;
      flame(g, nx, ny, ang + Math.PI, 0.35 * L.S * fl, n.w * 1.1, 'rgba(255,150,60,0.8)');
    }
  }
  if (L.mob.id === 'jumpjets' && (p.leap ?? 0) > 0.02) {
    for (const n of L.nozzles) {
      const nx = x + (cs * n.x - sn * n.y) * sc, ny = y + (sn * n.x + cs * n.y) * sc;
      flame(g, nx, ny, ang + Math.PI, 0.3 * L.S * (0.5 + (p.leap ?? 0)), n.w * 1.4, 'rgba(255,170,70,0.85)');
    }
  }
  // hull
  blit(g, s.hull, x, y, ang, s.ext, sc);
  if (GIANT_SHAPES.has(L.shape) || L.mob.id === 'gravlift' || L.mob.id === 'megatracks' || L.mob.id === 'titanlegs') {
    drawGiantFx(g, L, { time: p.time, seed: p.seed, moving: p.moving, odometer: p.odometer }, x, y, ang, sc, px, pal, alpha);
  }
  // turrets
  for (let i = 0; i < L.mounts.length; i++) {
    const m = L.mounts[i];
    if (!m.turret || !m.mod) continue;
    const mp = p.mounts?.[i];
    const sway = Math.sin(p.time * 0.7 + i * 1.7 + (p.seed ?? 0)) * 0.25;
    const ta = mp ? mp.angle : ang + sway;
    const fl = mp ? Math.max(0, Math.min(1, mp.flash)) : 0;
    let rec = fl * fl * m.d * (m.mod.mount === 'T' || m.mod.mount === 'G' ? 0.34 : 0.18);
    let rot = 0;
    const sw = mp?.swing ?? 0;
    if (sw > 0 && m.mod.category === 'melee') {
      const k = Math.sin(sw * Math.PI);
      const v = m.mod.visual;
      if (v === 'hammer' || v === 'claw' || v === 'chainsaw' || v === 'blade') rot = Math.sin(sw * Math.PI * 2) * 0.7;
      rec = -k * m.d * (v === 'ram' || v === 'drill' || v === 'prod' ? 0.6 : 0.3);
    }
    const mx = x + (cs * m.x - sn * m.y) * sc - Math.cos(ta) * rec;
    const my = y + (sn * m.x + cs * m.y) * sc - Math.sin(ta) * rec;
    const ts = turretSprite(m.mod, p.team, m.d, px);
    const dis = (p.disarm ?? 0) > 0;
    if (dis) g.globalAlpha = alpha * (0.55 + 0.45 * (Math.sin(p.time * 37 + i * 2) > 0 ? 1 : 0.3));
    blit(g, ts, mx, my, ta + rot, TURRET_EXT * Math.round(m.d * 100) / 100, sc);
    g.globalAlpha = alpha;
    if (m.mod.id === 'grinder' || m.mod.mount === 'T' || m.mod.mount === 'G') drawTurretDynamic(g, m.mod, pal, m.d, mx, my, ta + rot, sc, p.time + (p.seed ?? 0) + i, fl, sw, px, alpha, chargeOf(m.mod, mp));
    if ((m.mod.visual === 'saw' || m.mod.visual === 'drill') && m.mod.id !== 'grinder') {
      // spinning blade / bore highlight
      const ml = muzzleLen(m.mod) * m.d * (m.mod.visual === 'saw' ? 0.95 : 0.7);
      const bx = mx + Math.cos(ta) * ml * sc, by = my + Math.sin(ta) * ml * sc;
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = Math.max(1 / px, m.d * 0.05);
      g.beginPath();
      const sp = p.time * (sw > 0 ? 40 : 12);
      const rr = m.d * (m.mod.visual === 'saw' ? 0.36 : 0.2);
      g.arc(bx, by, rr, sp, sp + 1.2);
      g.stroke();
    }
    if (dis) {
      g.strokeStyle = '#ffe84a';
      g.lineWidth = Math.max(1 / px, 0.02);
      g.beginPath();
      const ph = Math.floor(p.time * 15 + i * 3);
      for (let k = 0; k < 2; k++) {
        const a = ph * 2.4 + k * 3.1;
        const r0 = m.d * 0.25, r1 = m.d * 0.6;
        g.moveTo(mx + Math.cos(a) * r0, my + Math.sin(a) * r0);
        g.lineTo(mx + Math.cos(a + 0.4) * (r0 + r1) / 2, my + Math.sin(a + 0.4) * (r0 + r1) / 2);
        g.lineTo(mx + Math.cos(a - 0.1) * r1, my + Math.sin(a - 0.1) * r1);
      }
      g.stroke();
    }
    if (mp?.reloading) {
      g.strokeStyle = `rgba(255,190,80,${0.35 + 0.25 * Math.sin(p.time * 8 + i)})`;
      g.lineWidth = Math.max(1 / px, m.d * 0.06);
      g.beginPath();
      g.arc(mx, my, m.d * 0.5, p.time * 4, p.time * 4 + 2.2);
      g.stroke();
    }
    if (m.mod.visual === 'tesla' || m.mod.visual === 'shield') {
      const prev = g.globalCompositeOperation;
      g.globalCompositeOperation = 'lighter';
      const pulse = 0.35 + 0.25 * Math.sin(p.time * (m.mod.visual === 'tesla' ? 13 : 3) + i);
      g.globalAlpha = alpha * pulse;
      const r = m.d * 0.7;
      g.drawImage(softDot(m.mod.visual === 'tesla' ? '#a8d8ff' : '#7fd8ff'), mx - r, my - r, r * 2, r * 2);
      g.globalAlpha = alpha;
      g.globalCompositeOperation = prev;
    }
  }
  if (s.top) blit(g, s.top, x, y, ang, s.ext, sc);
  // rotors on top
  for (const r of L.rotors) {
    const rx = x + (cs * r.x - sn * r.y) * sc, ry = y + (sn * r.x + cs * r.y) * sc;
    rotorBlur(g, rx, ry, r.r * sc, r.blades, p.time + (p.seed ?? 0) + r.x, px);
  }
  // hit flash / status tints
  const hf = p.hitFlash ?? 0;
  if (hf > 0.02) {
    g.globalAlpha = alpha * Math.min(0.5, hf * 0.55);
    blit(g, silhouette(s, '#ffffff'), x, y, ang, s.ext, sc);
    g.globalAlpha = alpha;
  }
  if ((p.stun ?? 0) > 0) {
    g.globalAlpha = alpha * (0.12 + 0.1 * Math.sin(p.time * 40));
    blit(g, silhouette(s, '#7fc8ff'), x, y, ang, s.ext, sc);
    g.globalAlpha = alpha;
    drawSparks(g, x, y, 0.45 * L.S, p.time, px);
  }
  if ((p.slow ?? 0) > 0) {
    g.strokeStyle = `rgba(180,124,255,${0.35 + (p.slow ?? 0)})`;
    g.lineWidth = Math.max(1.5 / px, 0.05);
    g.setLineDash([0.12, 0.1]);
    g.lineDashOffset = p.time * 0.4;
    g.beginPath();
    g.arc(x, y, 0.55 * L.S, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  if ((p.burning ?? 0) > 0) {
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3 + L.S; i++) {
      const a = i * 2.4 + (p.seed ?? 0);
      const rr = 0.25 * L.S * ((i * 0.37) % 1);
      const fx = x + Math.cos(a) * rr, fy = y + Math.sin(a) * rr;
      const fl = 0.5 + 0.5 * Math.sin(p.time * 15 + i * 3.1);
      const r = (0.12 + 0.1 * fl) * Math.sqrt(L.S);
      g.globalAlpha = alpha * (0.5 + 0.4 * fl);
      g.drawImage(softDot('rgba(255,120,30,1)'), fx - r, fy - r, r * 2, r * 2);
      g.drawImage(softDot('rgba(255,230,140,1)'), fx - r * 0.4, fy - r * 0.4, r * 0.8, r * 0.8);
    }
    g.globalCompositeOperation = prev;
    g.globalAlpha = alpha;
  }
  if (p.cloak) {
    // refractive shimmer outline
    g.globalAlpha = (p.cloak === 'own' ? 0.25 : 0.12) * (0.6 + 0.4 * Math.sin(p.time * 7 + (p.seed ?? 0)));
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    blit(g, silhouette(s, '#9fdcff'), x + Math.sin(p.time * 9) * 0.03, y, ang, s.ext, sc * 1.02);
    g.globalCompositeOperation = prev;
  }
  // team marker at small scale: circle = friendly, diamond = enemy (shape + colour + luminance cue)
  if (px < 17 && p.cloak !== 'enemy') {
    const k = clamp((17 - px) / 6, 0, 1);
    const r = Math.max(1.7 / px, 0.07 * Math.sqrt(L.S));
    const my = y;
    g.globalAlpha = alpha * Math.max(0.55, k);
    g.fillStyle = OUTLINE;
    markerPath(g, p.team, x, my, r * 1.4);
    g.fill();
    g.fillStyle = pal.rim;
    markerPath(g, p.team, x, my, r);
    g.fill();
  }
  g.globalAlpha = 1;
}

/** 0..1 weapon-moment state for titan guns: mass-driver charge over the last second of its cooldown, nuke erector
 *  raise over the last two seconds (or while it has a target), annihilator beam heat while firing. */
function chargeOf(m: ModuleDef, mp: MountPose | undefined): number {
  if (!mp) return m.id === 'tactnuke' ? 0 : 0.15;
  const cd = mp.cd ?? 0;
  switch (m.id) {
    case 'massdriver': return mp.armed || cd > 0 ? clamp(1 - cd, 0, 1) : 0.2;
    case 'tactnuke': {
      const full = m.cooldown ?? 20;
      if (cd > full - 1.6) return -1; // just launched: rails empty
      return cd < 2 ? (mp.armed || cd > 0 ? clamp(1 - cd / 2, 0, 1) : 0) : 0;
    }
    case 'doomsday': case 'siege240': return cd < 1 && (mp.armed || cd > 0) ? clamp(1 - cd, 0, 1) : 0;
    case 'annihilator': return clamp(mp.heat ?? 0, 0, 1);
  }
  return 0;
}

function markerPath(g: Ctx, team: Team, x: number, y: number, r: number): void {
  g.beginPath();
  if (team === 0) g.arc(x, y, r, 0, Math.PI * 2);
  else { g.moveTo(x, y - r * 1.2); g.lineTo(x + r * 1.2, y); g.lineTo(x, y + r * 1.2); g.lineTo(x - r * 1.2, y); g.closePath(); }
}

function drawSparks(g: Ctx, x: number, y: number, r: number, t: number, px: number): void {
  g.strokeStyle = '#d8f0ff';
  g.lineWidth = Math.max(1 / px, 0.025);
  g.beginPath();
  const n = 3;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(t * 20 + i * 7) * 2.39996;
    let px0 = x + Math.cos(a) * r * 0.3, py0 = y + Math.sin(a) * r * 0.3;
    g.moveTo(px0, py0);
    for (let k = 1; k <= 3; k++) {
      const rr = r * (0.3 + k * 0.25);
      const aa = a + (((i * 13 + k * 7 + Math.floor(t * 20)) % 5) - 2) * 0.15;
      px0 = x + Math.cos(aa) * rr;
      py0 = y + Math.sin(aa) * rr;
      g.lineTo(px0, py0);
    }
  }
  g.stroke();
}

/** World position of mount i's muzzle for a unit at (x, y, angle) aiming `aim`. */
export function muzzlePos(design: Design, i: number, x: number, y: number, angle: number, aim: number): { x: number; y: number; d: number } {
  const L = layoutOf(design);
  const m = L.mounts[i];
  if (!m) return { x, y, d: 0.3 };
  const cs = Math.cos(angle), sn = Math.sin(angle);
  const ml = muzzleLen(m.mod ?? undefined) * m.d;
  return { x: x + cs * m.x - sn * m.y + Math.cos(aim) * ml, y: y + sn * m.x + cs * m.y + Math.sin(aim) * ml, d: m.d };
}
