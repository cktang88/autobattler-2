// Procedural top-down unit art composed from a Design's parts.
//
// Local frame: nose toward +x, +y to the unit's right, units = cells. S = chassis size (footprint S x S cells).
// Static layers (mobility frames, hull, shadow, silhouettes, turrets) are baked into offscreen canvases per
// design + team + device-pixels-per-cell; per frame a unit costs a handful of drawImage calls plus a few
// dynamic strokes (rotor blades, thruster flames, status effects).

import { CHASSIS_BY_ID, MOBILITY_BY_ID, MODULE_BY_ID, moduleTier } from '../../shared/parts.ts';
import { computeStats } from '../../shared/stats.ts';
import type { ChassisDef, Design, MobilityDef, ModuleDef, MountClass } from '../../shared/types.ts';
import { MAT, METAL, OUTLINE, TEAM_PAL, clamp, ctx2d, makeCanvas, mirrorPoly, poly, rgba, roundRect, shade, softDot, strHash, type Ctx, type Team, type TeamPal } from './palette.ts';
import { TURRET_EXT, drawTurret, drawTurretDynamic, muzzleLen } from './turrets.ts';
import { CREATURE_SHAPES, creatureDetails, creatureHullPath, creatureUnderlay, drawCreatureFx, drawSpiderLegs, mountOnPart, partMounts, partXfs, partsOf, type AnimIn, type Xf } from './creatures.ts';
import { armourTier, buildProfile, drawOutriggers, drawProfile, shieldShell, type BuildProfile } from './profile.ts';
import { setDetailPx } from './titandetail.ts';
import { FOOT, footDetails, footHullPath, footMobility, footUnderlay } from './footart.ts';
import { drawSuperstructure, drawTurretSeats, type SuperIn } from './superstructure.ts';
import { CLASS_RANK, sizeKey, slotD, weaponD } from './weaponsize.ts';
import { PART_SHAPES, RANK, artBox, hardpointsOf, meleeFront, mountPerm, unitK } from '../../shared/mountgeo.ts';
import { GIANT_SHAPES, emis, drawBarbette, drawGiantFx, drawGravlift, drawMegatracks, drawTitanLegs, giantHullDetails, giantHullPath, giantTopLayer } from './giantart.ts';

type Shape = ChassisDef['shape'];
const P2U = Math.PI * 2;

export interface MountSlot {
  x: number;
  y: number;
  slot: MountClass;
  mod: ModuleDef | null;
  /** turret base diameter, cells: sized to the module mounted (weapon class + calibre), not the slot */
  d: number;
  /** armoured socket diameter of the hardpoint itself (slot class), cells */
  sd: number;
  /** turret sprite drawn (false for armor plates / empty) */
  turret: boolean;
}

export interface UnitLayout {
  key: string;
  S: number;
  chassis: ChassisDef;
  mob: MobilityDef;
  shape: Shape;
  /** hull half width (fraction of S; hw * S = half width in cells) */
  hw: number;
  /** art box: X = length along the facing (cells), Y = width across (cells); square chassis X = Y = S. Usually the
   *  footprint; ChassisDef.art when the drawn unit needs a different box to sit inside its footprint */
  X: number;
  Y: number;
  /** footprint (cells): FX along the facing, FY across (collision / deploy box, selection outline) */
  FX: number;
  FY: number;
  /** largest footprint edge (overall visual size) */
  D: number;
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
  /** wheel axle count (wheels mobility), derived from size + load */
  axles: number;
  /** index of the centreline main gun (hull-level centrepiece), -1 if none */
  main: number;
}

const SHAPE_HW: Record<Shape, number> = {
  wedge: 0.26, pod: 0.24, box: 0.28, hex: 0.3, cross: 0.3, long: 0.2, round: 0.34, airframe: 0.14, fortress: 0.4, titan: 0.3,
  goliath: 0.36, leviathan: 0.3, carrier: 0.42, colossal: 0.27, citadel: 0.42,
  mantis: 0.14, mech: 0.28, arachnid: 0.22, crab: 0.4, saucer: 0.44, delta: 0.2, warlord: 0.28, scorpion: 0.22, centipede: 0.16, broodmother: 0.34, arachne: 0.33,
  carriage: 0.2, siegeplat: 0.33, riot: 0.36, hunter: 0.2, juggernaut: 0.44, interceptor: 0.12, bomber: 0.3,
  strikejet: 0.16, stratobomber: 0.2, heavyheli: 0.2,
};

// hardpoint tables (MOUNT_PTS / footprint FOOT_MOUNTS), RANK, PART_SHAPES and the mount solver live in
// shared/mountgeo.ts so the sim measures weapon ranges from the same mount points the art draws.

/** Per-chassis turret scale so guns don't bury slender bodies. */
const MOUNT_SCALE_I: Record<string, number[]> = { scorpion: [0.72, 0.8, 0.8] };
const MOUNT_SCALE: Record<string, number> = {
  mantis: 0.72, strider: 0.85, arachnid: 0.85, crab: 0.75, saucer: 0.9, deltawing: 0.85, warlord: 0.9, scorpion: 0.85, centipede: 0.72,
  broodmother: 0.92, arachne: 0.95, juggernaut: 0.9, interceptor: 0.8, hunter: 0.9, carriage: 1.0, siegeplat: 1.0, bomberhull: 0.85,
};

/** Weapon presence: the centreline main gun of a big hull is its centrepiece; then clear any turret overlaps. */
function scaleMounts(mounts: MountSlot[], S: number): number {
  let main = -1;
  if (S >= 2 && S < 4) {
    // only when the centreline gun is also the heaviest weapon aboard (otherwise the flank guns are the centrepiece)
    let top = 0;
    for (const m of mounts) if (m.turret && m.mod?.kind === 'weapon') top = Math.max(top, RANK[m.mod.mount]);
    for (let i = 0; i < mounts.length; i++) {
      const m = mounts[i];
      if (!m.turret || m.mod?.kind !== 'weapon' || Math.abs(m.y) > 0.08 * S || RANK[m.mod.mount] < top) continue;
      if (main < 0 || m.d > mounts[main].d) main = i;
    }
    if (main >= 0) mounts[main].d *= S >= 3 ? 1.1 : 1.06;
  }
  for (let i = 0; i < mounts.length; i++) for (let j = i + 1; j < mounts.length; j++) {
    const a = mounts[i], b = mounts[j];
    if (!a.turret || !b.turret) continue;
    const dist = Math.hypot(a.x - b.x, a.y - b.y), need = (a.d + b.d) * 0.5 * 0.92;
    if (dist >= need) continue;
    const k = Math.max(0.72, dist / need);
    if (a.d < b.d) a.d *= k; else b.d *= k;
  }
  return main;
}

/** Per-chassis slender-body scale, compressed so it can never flip the weapon-class ordering across chassis
 *  (class bands are >= 11% apart; the compressed scale moves a turret by at most ~9%). */
const chassisK = (ms: number) => 1 - (1 - ms) * 0.3;

/** Strict visual ordering on one unit: a weapon of a higher class (or higher calibre in the same class) is always
 *  drawn larger than a lower one, whatever per-hardpoint scaling, main-gun emphasis or overlap clearing did. */
function enforceOrder(mounts: MountSlot[]): void {
  const ts = mounts.filter((m) => m.turret && m.mod).map((m) => ({ m, k: sizeKey(m.mod!, CLASS_RANK[m.mod!.mount] > CLASS_RANK[m.slot] && m.mod!.kind !== 'weapon' ? m.slot : m.mod!.mount) }));
  ts.sort((a, b) => b.k - a.k);
  for (let i = 1; i < ts.length; i++) {
    for (let j = 0; j < i; j++) {
      const hi = ts[j], lo = ts[i];
      if (hi.k - lo.k < 1e-6) { if (hi.m.mod === lo.m.mod) hi.m.d = lo.m.d = Math.min(hi.m.d, lo.m.d); continue; }
      const step = Math.floor(hi.k) > Math.floor(lo.k) ? 1.1 : 1.03;
      if (lo.m.d * step > hi.m.d) lo.m.d = hi.m.d / step;
    }
  }
}

const layoutCache = new Map<string, UnitLayout>();
export const designKey = (d: Design) => `${d.chassis}|${d.mobility}|${d.mounts.map((m) => m ?? '-').join(',')}`;

const layoutByObj = new WeakMap<Design, { mounts: (string | null)[]; L: UnitLayout }>();
const sameMounts = (a: (string | null)[], b: (string | null | undefined)[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== (b[i] ?? null)) return false;
  return true;
};

export function layoutOf(d: Design): UnitLayout {
  const hit = layoutByObj.get(d);
  // designs are plain data; re-check the key cheaply in case a caller mutated the object
  if (hit && hit.L.chassis.id === d.chassis && hit.L.mob.id === d.mobility && sameMounts(hit.mounts, d.mounts)) return hit.L;
  const key = designKey(d);
  let L = layoutCache.get(key);
  if (L) { layoutByObj.set(d, { mounts: d.mounts.map((m) => m ?? null), L }); return L; }
  const chassis = CHASSIS_BY_ID.get(d.chassis) ?? CHASSIS_BY_ID.get('scout')!;
  const mob = MOBILITY_BY_ID.get(d.mobility) ?? MOBILITY_BY_ID.get('wheels')!;
  const S = chassis.size;
  const shape = chassis.shape;
  // art box: Y = width across, X = length along the facing (square chassis: S x S); the footprint may be larger
  const [Y, X] = artBox(chassis);
  const F = FOOT[shape];
  const pts = hardpointsOf(chassis);
  const mods = chassis.mounts.map((_, i) => { const id = d.mounts[i] ?? null; return id ? MODULE_BY_ID.get(id) ?? null : null; });
  // layout solver: which hardpoint each module occupies (anatomical frames keep their fixed points)
  const perm = mountPerm(chassis, pts, mods);
  const mounts: MountSlot[] = chassis.mounts.map((slot, i) => {
    const mod = mods[i];
    const j = perm[i];
    const cap = chassis.mounts[j] ?? slot;
    // utilities are sized to the hardpoint they were moved to; weapons always fit theirs
    let cls = mod?.mount ?? slot;
    if (mod && mod.kind !== 'weapon' && RANK[cls] > RANK[cap]) cls = cap;
    const p = pts[j] ?? [0, 0];
    const ms = chassisK(F?.scale ? (F.scale[j] ?? F.scale[0]) : MOUNT_SCALE_I[chassis.id]?.[j] ?? MOUNT_SCALE[chassis.id] ?? 1);
    const k = unitK(S) * ms;
    const dd = (mod ? weaponD(mod, cls) : slotD(cap)) * k;
    return { x: PART_SHAPES.has(shape) ? p[0] * X : meleeFront(mod, p[0] * X, X), y: p[1] * Y, slot: cap, mod, d: dd, sd: slotD(cap) * k, turret: !!mod && mod.kind !== 'armor' && mod.visual !== 'plate' };
  });
  const main = PART_SHAPES.has(shape) ? -1 : scaleMounts(mounts, S);
  enforceOrder(mounts);
  const air = mob.kind === 'air';
  // running gear is sized to what it carries: heavier / overloaded builds get more rotors, engines, axles
  let load = 0.7;
  try { load = computeStats(d).load; } catch { /* invalid design */ }
  const heavyLift = load > 0.88;
  const quad = mob.id === 'rotor' && !F?.rotors && (heavyLift && S >= 2 && shape !== 'delta' && shape !== 'interceptor' && shape !== 'airframe' || chassis.id === 'drone' || shape === 'pod' || shape === 'round' || shape === 'saucer' || shape === 'crab' || shape === 'arachnid' || shape === 'mantis');
  let rotors: UnitLayout['rotors'] = [];
  let nozzles: UnitLayout['nozzles'] = [];
  if (mob.id === 'rotor' && F?.rotors) rotors = F.rotors(X, Y, S, heavyLift);
  else if (mob.id === 'rotor') {
    const R = Math.max(X, Y);
    if (quad) for (const sx of [-1, 1]) for (const sy of [-1, 1]) rotors.push({ x: sx * (heavyLift ? 0.36 : 0.32) * X, y: sy * (heavyLift ? 0.38 : 0.32) * Y, r: (heavyLift ? 0.23 : 0.2) * Math.min(X, Y), blades: load > 1 ? 4 : heavyLift ? 3 : 2 });
    else rotors.push({ x: 0, y: 0, r: 0.52 * R, blades: 3 });
  }
  if (mob.id === 'jet' && F?.nozzles) nozzles = F.nozzles(X, Y, S);
  else if (mob.id === 'jet') {
    if (S === 1 && !heavyLift) nozzles.push({ x: -0.5 * X, y: 0, w: 0.11 * S });
    else if (S >= 3 || load > 1) for (const sy of [-1, 1]) for (const k of [0.1, 0.24]) nozzles.push({ x: -0.5 * X, y: sy * k * Y, w: 0.075 * S });
    else for (const sy of [-1, 1]) nozzles.push({ x: -0.5 * X, y: sy * 0.13 * Y, w: 0.09 * S });
  }
  if (mob.id === 'jumpjets') for (const sy of [-1, 1]) nozzles.push({ x: -0.4 * X, y: sy * 0.15 * Y, w: 0.07 * S });
  const legged = mob.id === 'legs' || mob.id === 'spider' || mob.id === 'jumpjets' || mob.id === 'titanlegs';
  const rolled = mob.id === 'treads' || mob.id === 'wheels' || mob.id === 'halftrack' || mob.id === 'megatracks';
  L = {
    key, S, chassis, mob, shape, hw: F ? (F.hw * Y) / S : SHAPE_HW[shape] ?? 0.28, X, Y, FX: chassis.footprint?.[1] ?? S, FY: chassis.footprint?.[0] ?? S, D: Math.max(X, Y), mounts, air, quad, rotors, nozzles, main,
    axles: Math.min(6, Math.max(2, Math.round(X * 1.1) + 1 + (heavyLift ? 1 : 0) - (X >= 3 ? 1 : 0))),
    ext: 0.8 * Math.max(X, Y) + (F?.extPad ?? 0) * S,
    frames: legged ? 8 : mob.id === 'megatracks' ? 6 : rolled ? 4 : 1,
    cycle: mob.id === 'titanlegs' ? 0.7 * S : mob.id === 'megatracks' ? 0.06 * S : mob.id === 'legs' ? 0.75 * S : mob.id === 'spider' ? 0.55 * S : mob.id === 'jumpjets' ? 0.8 * S : mob.id === 'treads' || mob.id === 'halftrack' ? 0.09 * S : 0.06 * S,
  };
  // anatomical frames with a footprint: hardpoints riding a part sit where that part's weapon point rests
  if (F && PART_SHAPES.has(shape)) {
    const pd = partsOf(L), rx = partXfs(pd, null);
    pd.forEach((p, j) => {
      if (!p.mounts || !p.mountAt) return;
      const c = Math.cos(rx[j].r), sn = Math.sin(rx[j].r);
      for (const mi of p.mounts) if (L!.mounts[mi]) { L!.mounts[mi].x = rx[j].x + c * p.mountAt[0] - sn * p.mountAt[1]; L!.mounts[mi].y = rx[j].y + sn * p.mountAt[0] + c * p.mountAt[1]; }
    });
  }
  layoutCache.set(key, L);
  layoutByObj.set(d, { mounts: d.mounts.map((m) => m ?? null), L });
  return L;
}

/* ------------------------------------------------------------------------------------------------ hull */

const hullCache = new Map<string, Path2D>();
/** Hull outline in cells: footprint-designed outline (unit box) stretched to X (length) x Y (width). */
export function hullPath(shape: Shape, S: number, X = S, Y = S): Path2D {
  const key = `${shape}|${S}|${X}|${Y}`;
  let p = hullCache.get(key);
  if (p) return p;
  const unit = footHullPath(shape) ?? rawHullPath(shape, 1);
  p = new Path2D();
  p.addPath(unit, new DOMMatrix([X, 0, 0, Y, 0, 0]));
  hullCache.set(key, p);
  return p;
}
export const hullPathL = (L: UnitLayout): Path2D => hullPath(L.shape, L.S, L.X, L.Y);

function rawHullPath(shape: Shape, S: number): Path2D {
  const p = new Path2D();
  switch (shape) {
    case 'wedge': poly(p, mirrorPoly([0.44, 0, 0.12, -0.16, -0.18, -0.26, -0.36, -0.26, -0.42, -0.17, -0.4, 0]), S); break;
    // faceted drone pod with stub fins and a sensor snout
    case 'pod': poly(p, mirrorPoly([0.34, 0, 0.3, -0.06, 0.26, -0.13, 0.17, -0.2, 0.05, -0.235, -0.1, -0.235, -0.18, -0.19, -0.26, -0.24, -0.34, -0.22, -0.31, -0.12, -0.34, -0.05, -0.3, 0]), S); break;
    // twin gun-pod skirmisher: narrow nose, pods out on the flanks
    case 'box': poly(p, mirrorPoly([0.45, -0.05, 0.34, -0.09, 0.28, -0.11, 0.33, -0.19, 0.29, -0.29, 0.05, -0.29, -0.06, -0.19, -0.22, -0.17, -0.33, -0.26, -0.43, -0.24, -0.41, -0.1, -0.43, 0]), S); break;
    // sponson tank: sloped glacis, stepped side sponsons
    case 'hex': poly(p, mirrorPoly([0.5, -0.03, 0.47, -0.09, 0.39, -0.13, 0.35, -0.2, 0.27, -0.22, 0.24, -0.33, 0.15, -0.36, 0.11, -0.315, -0.01, -0.315, -0.05, -0.36, -0.21, -0.36, -0.26, -0.3, -0.31, -0.3, -0.35, -0.37, -0.46, -0.355, -0.49, -0.2, -0.45, -0.14, -0.48, -0.05]), S); break;
    case 'cross': poly(p, mirrorPoly([0.45, -0.08, 0.34, -0.15, 0.13, -0.15, 0.1, -0.36, -0.15, -0.36, -0.18, -0.15, -0.38, -0.15, -0.44, -0.08]), S); break;
    case 'long': {
      // lance with a gun turntable bulge
      const h = [0.5, 0, 0.42, -0.06, 0.26, -0.085];
      for (let i = 0; i <= 10; i++) { const a = -0.36 - (i / 10) * (Math.PI - 0.82); h.push(Math.cos(a) * 0.255, Math.sin(a) * 0.255); }
      h.push(-0.32, -0.11, -0.44, -0.16, -0.48, -0.11, -0.48, 0);
      poly(p, mirrorPoly(h), S);
      break;
    }
    case 'round': {
      // field-support crawler: faceted octagonal core, a short command prow, four emitter outrigger arms with pads
      const pts: number[] = [];
      const R = 0.29, w = 0.055;
      const at = (a: number, r: number, off = 0) => pts.push(Math.cos(a) * r - Math.sin(a) * off, Math.sin(a) * r + Math.cos(a) * off);
      for (let k = 0; k < 8; k++) {
        const a0 = (k / 8) * Math.PI * 2 + Math.PI / 8;
        at(a0, R);
        const mid = a0 + Math.PI / 8;
        const ci = Math.cos(Math.PI / 8) * R;
        if (k % 2 === 0) { at(mid, ci, -w); at(mid, 0.42, -w); at(mid, 0.43, -w * 1.9); at(mid, 0.5, -w * 1.5); at(mid, 0.5, w * 1.5); at(mid, 0.43, w * 1.9); at(mid, 0.42, w); at(mid, ci, w); }
        else if (k === 7) { at(mid, ci, -0.1); at(mid, 0.38, -0.06); at(mid, 0.4, 0); at(mid, 0.38, 0.06); at(mid, ci, 0.1); }
        else if (k === 3) { at(mid, ci, -0.12); at(mid, 0.36, -0.1); at(mid, 0.36, 0.1); at(mid, ci, 0.12); }
      }
      poly(p, pts, S);
      break;
    }
    case 'airframe': poly(p, mirrorPoly([0.49, 0, 0.38, -0.08, 0.12, -0.13, 0.04, -0.4, -0.12, -0.42, -0.15, -0.13, -0.34, -0.08, -0.42, -0.21, -0.49, -0.21, -0.47, -0.05, -0.48, 0]), S); break;
    // star fort: corner bastions jut out diagonally
    case 'fortress': poly(p, mirrorPoly([0.6, 0, 0.6, -0.06, 0.5, -0.09, 0.46, -0.16, 0.42, -0.27, 0.52, -0.38, 0.38, -0.52, 0.27, -0.42, 0.21, -0.42, 0.18, -0.47, 0.04, -0.47, 0.01, -0.4, -0.09, -0.4, -0.12, -0.47, -0.24, -0.47, -0.27, -0.42, -0.38, -0.52, -0.52, -0.38, -0.43, -0.29, -0.47, -0.26, -0.52, -0.18, -0.52, -0.08, -0.47, -0.06, -0.47, 0]), S); break;
    case 'titan': poly(p, mirrorPoly([0.38, 0, 0.36, -0.06, 0.33, -0.12, 0.22, -0.2, 0.24, -0.3, 0.2, -0.47, 0.06, -0.47, 0.02, -0.42, -0.14, -0.45, -0.18, -0.45, -0.21, -0.22, -0.3, -0.24, -0.36, -0.17, -0.44, -0.14, -0.42, -0.08, -0.47, -0.03, -0.45, 0]), S); break;
    default: return creatureHullPath(shape, S) ?? giantHullPath(shape, S) ?? p;
  }
  return p;
}

export function paintHull(g: Ctx, path: Path2D, pal: TeamPal, S: number, o: number, hw: number, X = S, Y = S): void {
  // base paint: flat military finish, then light / camo / weathering passes clipped to the hull
  const gr = g.createLinearGradient(-0.3 * X, -hw * S * 1.2, 0.3 * X, hw * S * 1.2);
  gr.addColorStop(0, shade(pal.body, 0.1));
  gr.addColorStop(0.5, pal.body);
  gr.addColorStop(1, shade(pal.body, -0.14));
  g.fillStyle = gr;
  g.fill(path);
  g.save();
  g.clip(path);
  let seed = 17 + Math.round(S * 31 + X * 7 + Y * 3);
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  paintCamo(g, pal, X, Y, rnd);
  // key light from above: the crown of the hull catches it, the flanks roll off into shade
  const rg = g.createRadialGradient(-0.06 * X, -0.06 * Y, 0, 0, 0, 0.62 * Math.max(X, Y));
  rg.addColorStop(0, 'rgba(255,255,255,0.13)');
  rg.addColorStop(0.55, 'rgba(255,255,255,0.03)');
  rg.addColorStop(1, 'rgba(0,0,0,0.16)');
  g.fillStyle = rg;
  g.fillRect(-X, -Y, 2 * X, 2 * Y);
  // fine surface texture: tiny paint/metal flecks (very low contrast)
  for (let i = 0; i < 46 * Math.sqrt(X * Y); i++) {
    g.fillStyle = rnd() < 0.55 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)';
    const x = (rnd() - 0.5) * X, y = (rnd() - 0.5) * Y, r = (0.004 + rnd() * 0.012) * S;
    g.fillRect(x, y, r, r);
  }
  // dust kicked up by the running gear: settles on the flanks and the rear (subtle, warm)
  g.strokeStyle = rgba(MAT.dust, 0.2);
  g.lineWidth = 0.09 * S;
  g.stroke(path);
  const dg = g.createLinearGradient(-0.5 * X, 0, -0.1 * X, 0);
  dg.addColorStop(0, rgba(MAT.dust, 0.2));
  dg.addColorStop(1, rgba(MAT.dust, 0));
  g.fillStyle = dg;
  g.fillRect(-X, -Y, X, 2 * Y);
  // ambient occlusion along the hull edge (the plates curve away from the light)
  g.strokeStyle = 'rgba(0,0,0,0.26)';
  g.lineWidth = 0.045 * S;
  g.stroke(path);
  // bevel: lit upper-left lip, shaded lower-right lip (hard-edged)
  g.save();
  g.translate(o * 0.9, o * 0.9);
  g.strokeStyle = 'rgba(255,255,255,0.2)';
  g.lineWidth = o * 1.2;
  g.stroke(path);
  g.restore();
  // edge wear: bare-metal chips along the rim
  g.save();
  g.translate(-o * 0.5, -o * 0.5);
  g.setLineDash([0.008 * S, 0.06 * S, 0.02 * S, 0.1 * S]);
  g.strokeStyle = rgba(MAT.steel, 0.4);
  g.lineWidth = o * 0.8;
  g.stroke(path);
  g.setLineDash([]);
  g.restore();
  g.restore();
  // faint separation edge only (no comic outline)
  g.strokeStyle = 'rgba(12,14,16,0.45)';
  g.lineWidth = o * 0.8;
  g.lineJoin = 'round';
  g.stroke(path);
}

/** Disruptive camouflage: hard-edged irregular blotches in a second paint tone (cheap: drawn once per sprite). The
 *  viewer's slate scheme uses large soft-contrast blocks, the enemy's olive scheme adds a darker third tone. */
export function paintCamo(g: Ctx, pal: TeamPal, X: number, Y: number, rnd: () => number): void {
  const n = Math.round(5 + 5 * Math.sqrt(X * Y));
  const blob = (col: string, k: number) => {
    const cx = (rnd() - 0.5) * X, cy = (rnd() - 0.5) * Y, r = (0.1 + rnd() * 0.12) * Math.sqrt(X * Y) * k;
    const pts = 6 + Math.floor(rnd() * 3), a0 = rnd() * 6.28;
    g.beginPath();
    for (let i = 0; i < pts; i++) {
      const a = a0 + (i / pts) * Math.PI * 2, rr = r * (0.55 + rnd() * 0.6);
      g.lineTo(cx + Math.cos(a) * rr * 1.4, cy + Math.sin(a) * rr);
    }
    g.closePath();
    g.fillStyle = col;
    g.fill();
  };
  for (let i = 0; i < n; i++) blob(rgba(pal.camo, 0.7), 1);
  if (pal.camo === TEAM_PAL[1].camo) for (let i = 0; i < n * 0.6; i++) blob(rgba(pal.deep, 0.22), 0.7);
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
  if (footDetails(g, L, pal, o)) return;
  if (L.X !== L.S || L.Y !== L.S) {
    // footprint chassis without footprint art: square-designed details, uniformly scaled to fit
    const k = Math.min(L.X, L.Y) / L.S;
    g.save(); g.scale(k, k);
    hullDetails(g, { ...L, X: L.S, Y: L.S }, pal, o / k);
    g.restore();
    return;
  }
  const S = L.S;
  if (CREATURE_SHAPES.has(L.shape)) { creatureDetails(g, L, pal, o, hullPathL(L)); return; }
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
      line(g, [0.28, -0.11, -0.2, -0.11, 0.28, 0.11, -0.2, 0.11, 0.42, 0, -0.38, 0], S, pl, t);
      for (const s of [-1, 1]) {
        line(g, [0.3, s * 0.2, 0.0, s * 0.2, 0.0, s * 0.12, 0.0, s * 0.28], S, pl, t);
        line(g, [0.26, s * 0.28, 0.06, s * 0.28], S, pal.accent, o * 1.1);
      }
      vents(g, -0.33 * S, 0, 0.06 * S, 0.16 * S, 4, o);
      headlights(g, 0.31 * S, 0.2 * S, 0.022 * S);
      g.fillStyle = '#132230'; g.beginPath(); g.ellipse(0.3 * S, 0, 0.06 * S, 0.03 * S, 0, 0, Math.PI * 2); g.fill();
      break;
    case 'hex':
      line(g, [0.22, -0.3, -0.2, -0.3, 0.22, 0.3, -0.2, 0.3, 0.3, -0.18, 0.3, 0.18], S, hl, t);
      line(g, [0.3, -0.18, 0.3, 0.18, -0.38, -0.12, -0.38, 0.12, 0.3, -0.18, 0.4, -0.06, 0.3, 0.18, 0.4, 0.06, 0.24, -0.21, -0.27, -0.21, 0.24, 0.21, -0.27, 0.21], S, pl, t);
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
      g.strokeStyle = pl; g.lineWidth = t;
      g.beginPath(); g.arc(0, 0, 0.2 * S, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = pal.accent; g.lineWidth = o;
      g.beginPath(); g.arc(0, 0, 0.225 * S, -2.3, -0.8); g.arc(0, 0, 0.225 * S, 0.8, 2.3); g.stroke();
      line(g, [0.3, -0.06, 0.3, 0.06, -0.3, -0.1, -0.3, 0.1, 0.25, 0, 0.47, 0], S, pl, t);
      vents(g, -0.4 * S, 0, 0.05 * S, 0.2 * S, 4, o);
      for (let i = 0; i < 3; i++) dotAt(g, (-0.2 + i * 0.08) * S, 0.14 * S, 0.012 * S, 'rgba(0,0,0,0.5)');
      line(g, [0.36, -0.06, 0.44, -0.03, 0.36, 0.06, 0.44, 0.03], S, pal.accent, o * 0.9);
      break;
    case 'round': {
      // emitter outriggers: conduit down each arm to a glowing pad; octagonal core seam; command prow
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const c = Math.cos(a), sn = Math.sin(a);
        g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 0.03 * S;
        g.beginPath(); g.moveTo(c * 0.3 * S, sn * 0.3 * S); g.lineTo(c * 0.45 * S, sn * 0.45 * S); g.stroke();
        g.strokeStyle = rgba(pal.glow, 0.85); g.lineWidth = o * 0.8; g.stroke();
        dotAt(g, c * 0.465 * S, sn * 0.465 * S, 0.04 * S, '#10161c');
        dotAt(g, c * 0.465 * S, sn * 0.465 * S, 0.024 * S, pal.glow);
        dotAt(g, c * 0.46 * S, sn * 0.46 * S, 0.01 * S, '#fff');
      }
      g.strokeStyle = pl; g.lineWidth = t;
      g.beginPath();
      for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; const x = Math.cos(a) * 0.23 * S, y = Math.sin(a) * 0.23 * S; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      line(g, [0.27, -0.09, 0.37, -0.05, 0.27, 0.09, 0.37, 0.05], S, pal.accent, o * 0.9);
      headlights(g, 0.36 * S, 0.035 * S, 0.014 * S);
      vents(g, -0.31 * S, 0, 0.05 * S, 0.16 * S, 4, o);
      break;
    }
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
    case 'fortress': {
      // star fort: chamfered keep, corner bastion towers with vision slits, flank casemates, a prow gun deck
      const keep = new Path2D();
      poly(keep, mirrorPoly([0.36, -0.2, 0.22, -0.34, -0.22, -0.34, -0.36, -0.2]), S);
      g.strokeStyle = pl; g.lineWidth = t * 1.4; g.stroke(keep);
      g.save(); g.translate(o * 0.7, o * 0.7); g.strokeStyle = hl; g.lineWidth = t; g.stroke(keep); g.restore();
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) line(g, [sx * 0.29, sy * 0.27, sx * 0.37, sy * 0.35], S, pl, t * 1.4);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const cx = sx * 0.43 * S, cy = sy * 0.43 * S, R = 0.07 * S;
        const tw = new Path2D();
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; tw.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); }
        tw.closePath();
        g.save(); g.translate(o * 0.6, o); g.fillStyle = 'rgba(0,0,0,0.45)'; g.fill(tw); g.restore();
        const tg = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
        tg.addColorStop(0, shade(pal.light, -0.05)); tg.addColorStop(1, shade(pal.dark, -0.1));
        g.fillStyle = tg; g.fill(tw); g.lineWidth = o * 0.8; g.strokeStyle = OUTLINE; g.stroke(tw);
        // outward-facing vision slit
        g.save(); g.translate(cx, cy); g.rotate(Math.atan2(sy, sx));
        g.fillStyle = '#04070a'; g.fillRect(R * 0.35, -R * 0.45, R * 0.28, R * 0.9);
        g.fillStyle = pal.glow; g.fillRect(R * 0.42, -R * 0.35, R * 0.1, R * 0.7);
        g.restore();
        dotAt(g, cx, cy, R * 0.25, METAL.dark);
      }
      for (const sy of [-1, 1]) for (const [x0, x1] of [[0.04, 0.18], [-0.24, -0.12]]) {
        const p2 = new Path2D(); roundRect(p2, x0 * S, (sy > 0 ? 0.395 : -0.455) * S, (x1 - x0) * S, 0.06 * S, 0.01 * S);
        g.fillStyle = shade(pal.dark, 0.05); g.fill(p2); g.lineWidth = o * 0.7; g.strokeStyle = OUTLINE; g.stroke(p2);
        g.fillStyle = '#04070a'; g.fillRect((x0 + 0.02) * S, (sy > 0 ? 0.44 : -0.45) * S, (x1 - x0 - 0.04) * S, 0.012 * S);
      }
      const prow = new Path2D(); roundRect(prow, 0.44 * S, -0.05 * S, 0.15 * S, 0.1 * S, 0.015 * S);
      g.fillStyle = shade(pal.light, -0.1); g.fill(prow); g.lineWidth = o * 0.8; g.strokeStyle = OUTLINE; g.stroke(prow);
      line(g, [0.48, -0.04, 0.55, 0, 0.48, 0.04, 0.55, 0], S, pal.accent, o * 1.1);
      headlights(g, 0.47 * S, 0.12 * S, 0.016 * S);
      break;
    }
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
  const hw = Math.min(L.hw, 0.36);
  const len = L.shape === 'airframe' ? 0.3 : 0.62;
  void skirts;
  if (reactive) {
    // explosive reactive armour: neat two-row brick grid along both flanks
    const n = Math.max(3, Math.round(len * 8 * L.X / S));
    const tw = Math.min((len / n) * L.X, 0.1 * S);
    for (const s of [-1, 1]) for (let row = 0; row < 2; row++) for (let i = 0; i < n - row; i++) {
      const x = -len / 2 * L.X + (i + row * 0.5) * (len * L.X / n), y = s * (hw - 0.02 - row * 0.055) * S;
      g.save(); g.translate(o * 0.5, o * 0.8);
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x + tw * 0.06, y - tw * 0.36, tw * 0.88, tw * 0.72);
      g.restore();
      g.beginPath(); roundRect(g, x + tw * 0.06, y - tw * 0.36, tw * 0.88, tw * 0.72, tw * 0.1);
      const gr = g.createLinearGradient(x, y - tw * 0.4, x, y + tw * 0.4);
      gr.addColorStop(0, '#8a8a60'); gr.addColorStop(1, '#5e5e3e');
      g.fillStyle = gr; g.fill(); g.lineWidth = o * 0.5; g.strokeStyle = OUTLINE; g.stroke();
      dotAt(g, x + tw * 0.5, y, tw * 0.09, '#c0392b');
    }
  }
  const hpClip = hullPathL(L);
  for (const m of L.mounts) {
    if (!m.mod || m.turret) continue;
    const id = m.mod.id;
    g.save();
    if (id !== 'reactive' && id !== 'mirror') g.clip(hpClip);
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
      // spaced armour: one panel standing off the hull on four bolted brackets (shadow gap shows the standoff)
      for (const [bx, by] of [[-0.42, -0.5], [0.42, -0.5], [-0.42, 0.5], [0.42, 0.5]]) {
        g.fillStyle = METAL.dark; g.beginPath(); roundRect(g, bx * w - w * 0.06, by * h - h * 0.12, w * 0.12, h * 0.24, w * 0.02); g.fill();
        g.lineWidth = o * 0.5; g.strokeStyle = OUTLINE; g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); roundRect(g, -w * 0.46 + o * 1.5, -h * 0.4 + o * 2.2, w * 0.92, h * 0.8, h * 0.1); g.fill();
      chamferPlate(g, w * 0.92, h * 0.8, h * 0.16, shade(pal.light, -0.08), shade(pal.dark, -0.05), o);
      const rv = Math.max(0.012, m.d * 0.045);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        dotAt(g, sx * w * 0.36, sy * h * 0.28, rv, 'rgba(0,0,0,0.6)');
        dotAt(g, sx * w * 0.36 - rv * 0.3, sy * h * 0.28 - rv * 0.3, rv * 0.5, 'rgba(255,255,255,0.4)');
      }
    } else if (id === 'plateG' || id === 'plateT') {
      // massive cast armour block: one chamfered piece with lit facets, bolt rows and a hazard lip
      const T = id === 'plateT';
      const gold = '#e8c25a';
      const W = w * 1.15, H = h * 1.15;
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); roundRect(g, -W / 2 + o * 1.2, -H / 2 + o * 2, W, H, H * 0.2); g.fill();
      chamferPlate(g, W, H, H * 0.24, shade(pal.light, -0.18), shade(pal.deep, 0.12), o * 1.3);
      g.strokeStyle = T ? gold : 'rgba(0,0,0,0.45)'; g.lineWidth = o * (T ? 1.2 : 0.6);
      g.beginPath(); roundRect(g, -W * 0.3, -H * 0.3, W * 0.6, H * 0.6, H * 0.06); g.stroke();
      const rv = Math.max(0.016, m.d * 0.04);
      for (const sy of [-1, 1]) for (let i = 0; i < 5; i++) {
        const x = -W * 0.32 + (i * W * 0.64) / 4;
        dotAt(g, x, sy * H * 0.39, rv * 1.3, 'rgba(0,0,0,0.65)');
        dotAt(g, x - rv * 0.4, sy * H * 0.39 - rv * 0.4, rv * 0.6, T ? gold : 'rgba(255,255,255,0.4)');
      }
      g.save(); g.beginPath(); g.rect(W * 0.36, -H * 0.3, W * 0.08, H * 0.6); g.clip();
      g.fillStyle = '#e8b81c'; g.fillRect(-W, -H, W * 2, H * 2);
      g.strokeStyle = '#17140c'; g.lineWidth = H * 0.05; g.beginPath();
      for (let i = -8; i < 8; i++) { g.moveTo(W * 0.3, i * H * 0.1); g.lineTo(W * 0.5, i * H * 0.1 + H * 0.1); } g.stroke(); g.restore();
      if (T) { g.strokeStyle = gold; g.lineWidth = o * 1.4; g.beginPath(); g.arc(0, 0, H * 0.16, 0, P2); g.stroke(); dotAt(g, 0, 0, H * 0.07, gold); }
    } else if (id === 'plateH') {
      // thick welded block: chamfered edges catch the light, bolted along both long sides
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); roundRect(g, -w * 0.6 + o, -h * 0.6 + o * 1.8, w * 1.2, h * 1.2, h * 0.15); g.fill();
      chamferPlate(g, w * 1.2, h * 1.2, h * 0.24, shade(pal.light, -0.2), shade(pal.deep, 0.1), o * 1.1);
      const rv = Math.max(0.014, m.d * 0.05);
      for (let i = 0; i < 4; i++) for (const sy of [-1, 1]) {
        const x = -w * 0.42 + (i * w * 0.84) / 3;
        dotAt(g, x, sy * h * 0.41, rv, 'rgba(0,0,0,0.6)');
        dotAt(g, x - rv * 0.3, sy * h * 0.41 - rv * 0.3, rv * 0.5, 'rgba(255,255,255,0.35)');
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
    g.restore();
  }
}

/** One-piece chamfered armour plate centred at the origin: flat top face plus four lit/shaded bevel facets. */
function chamferPlate(g: Ctx, w: number, h: number, c: number, lit: string, dark: string, o: number): void {
  const x0 = -w / 2, y0 = -h / 2, x1 = w / 2, y1 = h / 2, i = c * 0.75;
  const outer = new Path2D();
  outer.moveTo(x0 + c, y0); outer.lineTo(x1 - c, y0); outer.lineTo(x1, y0 + c); outer.lineTo(x1, y1 - c); outer.lineTo(x1 - c, y1); outer.lineTo(x0 + c, y1); outer.lineTo(x0, y1 - c); outer.lineTo(x0, y0 + c); outer.closePath();
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, lit); gr.addColorStop(1, dark);
  g.fillStyle = gr; g.fill(outer);
  // facets: top/left lit, bottom/right shaded
  g.save(); g.clip(outer);
  g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0); g.lineTo(x1 - i, y0 + i); g.lineTo(x0 + i, y0 + i); g.lineTo(x0 + i, y1 - i); g.lineTo(x0, y1); g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x0, y1); g.lineTo(x0 + i, y1 - i); g.lineTo(x1 - i, y1 - i); g.lineTo(x1 - i, y0 + i); g.lineTo(x1, y0); g.closePath(); g.fill();
  g.restore();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = o * 0.45; g.beginPath(); g.rect(x0 + i, y0 + i, w - 2 * i, h - 2 * i); g.stroke();
  g.lineWidth = o * 0.8; g.strokeStyle = OUTLINE; g.stroke(outer);
}

/** Side skirts / fenders over the running gear, sized by armour class (drawn under the hull: they hang off its sides).
 *  tier 1: short skirts with the road wheels showing, 2: deep skirts, 3: full-depth skirts with a heavy lip. */
export function drawSkirts(g: Ctx, L: UnitLayout, tier: number, pal: TeamPal, o: number): void {
  const S = L.S, id = L.mob.id;
  if (!tier || S >= 4 || L.air || L.shape === 'riot' || CREATURE_SHAPES.has(L.shape) && L.shape !== 'juggernaut' && L.shape !== 'hunter' && L.shape !== 'siegeplat') return;
  const panel = (x0: number, x1: number, yc: number, ww: number, s: number, chamferFront: boolean) => {
    const p = new Path2D();
    const yi = yc - s * ww / 2, yo = yc + s * ww / 2;
    const cf = chamferFront ? ww * 0.6 : 0;
    p.moveTo(x0, yi); p.lineTo(x1, yi); p.lineTo(x1 - cf, yo); p.lineTo(x0 + ww * 0.15, yo); p.closePath();
    g.save(); g.translate(o * 0.6, o); g.fillStyle = 'rgba(0,0,0,0.45)'; g.fill(p); g.restore();
    const gr = g.createLinearGradient(0, yi, 0, yo);
    gr.addColorStop(0, shade(pal.light, -0.12)); gr.addColorStop(0.6, shade(pal.body, -0.05)); gr.addColorStop(1, shade(pal.dark, -0.05));
    g.fillStyle = gr; g.fill(p);
    // heavy lip along the outer edge
    g.save(); g.clip(p);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x0, s > 0 ? yo - ww * 0.22 : yo, x1 - x0, ww * 0.22);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x0, s > 0 ? yi : yi - o, x1 - x0, o * 1.0);
    g.restore();
    g.lineWidth = o * 0.8; g.strokeStyle = OUTLINE; g.lineJoin = 'round'; g.stroke(p);
    const bx0 = x0 + ww * 0.3, bx1 = x1 - ww * 0.3 - cf, nb = Math.max(2, Math.round((bx1 - bx0) / (0.09 * S)));
    for (let i = 0; i <= nb; i++) { const x = bx0 + ((bx1 - bx0) * i) / nb; dotAt(g, x, yc - s * ww * 0.18, Math.max(o * 0.5, ww * 0.06), 'rgba(0,0,0,0.55)'); }
  };
  const cover = tier >= 3 ? 1.06 : tier >= 2 ? 0.82 : 0.52;
  if (id === 'treads' || id === 'halftrack') {
    const tg = trackGeo(L);
    const tc = tg.tc, tw = tg.tw;
    const xa = tg.xa, xb = id === 'treads' ? tg.xb : 0.05 * L.X;
    const ww = tw * cover, segs = Math.max(2, Math.round((xb - xa) / (0.26 * S)) + (tier >= 2 ? 1 : 0));
    for (const s of [-1, 1]) {
      const yc = s * (tc + tw / 2 - ww / 2 + (tier >= 3 ? 0.012 * S : 0));
      const sl = (xb - xa) / segs;
      for (let k = 0; k < segs; k++) panel(xa + k * sl + o * 0.4, xa + (k + 1) * sl - o * 0.4, yc, ww, s, k === segs - 1);
      // team stripe on the front panel
      g.fillStyle = rgba(pal.accent, 0.85); g.fillRect(xb - sl * 0.75, yc - ww * 0.06, sl * 0.4, ww * 0.12);
    }
  } else if (id === 'wheels') {
    // armoured wheel arches over each axle
    const wg = wheelGeo(L);
    for (const x of wg.xs) for (const s of [-1, 1]) panel(x - wg.wl * 0.62, x + wg.wl * 0.62, s * (wg.y + 0.065 * S - 0.13 * S * cover * 0.5), 0.13 * S * cover, s, x === wg.xs[wg.xs.length - 1]);
  }
}

/** Track band geometry (cells): centre line offset, band width, rear / front ends. */
export function trackGeo(L: UnitLayout): { tc: number; tw: number; xa: number; xb: number } {
  const S = L.S, big = S >= 4;
  const tw = Math.min((big ? 0.15 : 0.19) * S, 0.3 * L.Y + 0.08);
  const hwc = L.hw * S;
  const tc = Math.min((big ? 0.48 : 0.38) * L.Y, Math.max(0.3 * L.Y, hwc + 0.06 * S), 0.5 * L.Y - tw * 0.3);
  return { tc: Math.max(tc, hwc * 0.6 + tw * 0.35), tw, xa: -0.47 * L.X, xb: 0.47 * L.X };
}

/** Wheel geometry (cells): axle x positions, lateral offset, tyre length. */
export function wheelGeo(L: UnitLayout): { xs: number[]; y: number; wl: number; ww: number } {
  const n = L.axles, span = (L.X <= 1 ? 0.54 : 0.68) * L.X - (L.X > L.S ? 0.1 : 0);
  const xs = Array.from({ length: n }, (_, i) => -span / 2 + (span * i) / (n - 1));
  const ww = 0.13 * Math.min(L.S, L.Y * 1.3);
  const y = Math.max(0.34 * L.Y, Math.min(L.hw * L.S + ww * 0.3, 0.5 * L.Y - ww * 0.3));
  return { xs, y, wl: Math.min(0.22 * L.S, (span / (n - 1)) * 0.88), ww };
}

/** Long outrigger feet on the longarm platform and wing pylons are part of the hull layer. */
export function hullUnderlay(g: Ctx, L: UnitLayout, pal: TeamPal, o: number): void {
  if (footUnderlay(g, L, pal, o)) return;
  const S = L.S;
  if (CREATURE_SHAPES.has(L.shape)) { creatureUnderlay(g, L, pal, o); return; }
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

/** Animated parts drawn directly in their rest pose (icons). */
export function drawPartsStatic(g: Ctx, L: UnitLayout, pal: TeamPal, o: number, layer: 'under' | 'over'): void {
  const pd = partsOf(L), rx = partXfs(pd, null);
  for (let j = 0; j < pd.length; j++) {
    if (pd[j].layer !== layer) continue;
    g.save();
    g.translate(rx[j].x, rx[j].y);
    g.rotate(rx[j].r);
    pd[j].draw(g, pal, o);
    g.restore();
  }
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
  const S = L.S, X = L.X, Y = L.Y;
  const id = L.mob.id;
  const P = Math.PI * 2;
  if (footMobility(g, L, pal, phase, rest, o)) return;
  if (id === 'treads') {
    const big = S >= 4;
    const { tc, tw, xa, xb } = trackGeo(L);
    for (const s of [-1, 1]) {
      if (big) {
        const sp = 0.065 * S;
        rubberBand(g, xa, xb, s * tc, tw, phase, sp, o);
        g.fillStyle = 'rgba(0,0,0,0.4)';
        g.fillRect(xa + 0.03 * X, s * tc - tw * 0.3, (xb - xa) - 0.06 * X, tw * 0.6);
        const nw = Math.max(4, Math.round(X * 1.4));
        for (let i = 0; i < nw; i++) { const x = xa + 0.09 * X + (i * ((xb - xa) - 0.18 * X)) / (nw - 1); g.fillStyle = METAL.base; g.beginPath(); g.arc(x, s * tc, tw * 0.3, 0, P); g.fill(); g.lineWidth = o * 0.7; g.strokeStyle = OUTLINE; g.stroke(); g.fillStyle = METAL.light; g.beginPath(); g.arc(x, s * tc, tw * 0.12, 0, P); g.fill(); }
        for (const x of [xa + 0.03 * X, xb - 0.03 * X]) { g.fillStyle = METAL.dark; g.beginPath(); g.arc(x, s * tc, tw * 0.42, 0, P); g.fill(); g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke(); }
        continue;
      }
      rubberBand(g, xa, xb, s * tc, tw, phase, 0.09 * S, o);
      const nw = Math.max(2, Math.round(X / S * 2));
      for (let i = 0; i < nw; i++) { const x = (xa + 0.07 * X) + (i * ((xb - xa) - 0.14 * X)) / Math.max(1, nw - 1); g.fillStyle = METAL.base; g.beginPath(); g.arc(x, s * tc, tw * 0.28, 0, P); g.fill(); }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(xa + 0.05 * X, s * tc - tw * 0.08, (xb - xa) - 0.1 * X, tw * 0.16);
    }
  } else if (id === 'wheels') {
    const wg = wheelGeo(L);
    g.strokeStyle = METAL.dark;
    g.lineWidth = 0.05 * S;
    g.beginPath();
    for (const x of wg.xs) { g.moveTo(x, -wg.y); g.lineTo(x, wg.y); }
    g.stroke();
    for (const x of wg.xs) for (const s of [-1, 1]) wheel(g, x, s * wg.y, wg.wl, wg.ww, phase, o);
  } else if (id === 'halftrack') {
    const y = Math.min(0.36 * Y, L.hw * S + 0.05 * S, 0.5 * Y - 0.06 * S);
    const tw = Math.min(0.16 * S, 0.3 * Y);
    for (const s of [-1, 1]) rubberBand(g, -0.47 * X, 0.06 * X, s * y, tw, phase, 0.08 * S, o);
    const wy = Math.min(0.3 * Y + 0.0, 0.5 * Y - 0.05 * S);
    g.strokeStyle = METAL.dark; g.lineWidth = 0.05 * S;
    g.beginPath(); g.moveTo(0.29 * X, -wy); g.lineTo(0.29 * X, wy); g.stroke();
    for (const s of [-1, 1]) wheel(g, 0.29 * X, s * wy, 0.2 * S, Math.min(0.12 * S, 0.25 * Y), phase, o);
  } else if (id === 'legs' || id === 'jumpjets') {
    const jump = id === 'jumpjets';
    // humanoid / insect bodies: legs tucked under a narrow torso, long stride so the feet step out fore and aft
    const biped = L.shape === 'mech' || L.shape === 'warlord' || L.shape === 'mantis';
    const hy = (biped ? 0.11 : 0.2) * Y, fy = (biped ? 0.15 : jump ? 0.31 : 0.3) * Y, stride = (biped ? (jump ? 0.24 : 0.32) : jump ? 0.14 : 0.19) * X;
    for (const s of [-1, 1]) {
      const ph = phase * P + (s > 0 ? Math.PI : 0);
      const fx = rest ? (s > 0 ? 0.04 : -0.04) * X : Math.sin(ph) * stride;
      const lift = rest ? 0 : Math.max(0, Math.cos(ph));
      const kx = fx * 0.4 + (jump ? -0.12 : 0.06) * S, ky = s * (fy + (biped ? 0.05 : 0.07) * S);
      limb(g, [0, s * hy, kx, ky, fx, s * fy], (jump ? 0.1 : 0.075) * S, jump ? METAL.dark : METAL.base, o);
      if (jump) limb(g, [kx * 0.5, s * hy, kx - 0.04 * S, ky - s * 0.02 * S], 0.035 * S, METAL.light, o * 0.6);
      joint(g, kx, ky, 0.055 * S * (1 + lift * 0.15), jump ? pal.dark : METAL.light, o);
      foot(g, fx + 0.03 * S, s * fy, (biped ? 0.22 : jump ? 0.2 : 0.18) * S, (biped ? 0.11 : 0.1) * S, lift, o, jump ? METAL.dark : biped ? pal.dark : METAL.base);
      if (biped) { g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = o * 0.6; g.beginPath(); g.moveTo(fx + 0.08 * S, s * fy - 0.04 * S); g.lineTo(fx + 0.08 * S, s * fy + 0.04 * S); g.stroke(); }
    }
    if (jump) for (const n of L.nozzles) {
      g.beginPath(); roundRect(g, n.x, n.y - n.w, 0.16 * S, n.w * 2, n.w * 0.5);
      g.fillStyle = METAL.dark; g.fill(); g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
      dotAt(g, n.x + 0.02 * S, n.y, n.w * 0.6, '#0a0a0a');
    }
  } else if (id === 'spider') {
    drawSpiderLegs(g, L, pal, phase, rest, o);
  } else if (id === 'megatracks') {
    drawMegatracks(g, L, pal, phase, o);
  } else if (id === 'titanlegs') {
    drawTitanLegs(g, L, pal, phase, rest, o);
  } else if (id === 'gravlift') {
    drawGravlift(g, L, pal, o);
  } else if (id === 'hover') {
    const sk = new Path2D();
    if (L.shape === 'saucer' || L.shape === 'round' || L.shape === 'crab') sk.ellipse(-0.01 * X, 0, (L.shape === 'crab' ? 0.36 : 0.49) * X, 0.47 * Y, 0, 0, Math.PI * 2);
    else { const hy = L.shape === 'riot' ? 0.48 * Y : Math.min(0.37 * Y, L.hw * S + 0.13 * S); roundRect(sk, -0.46 * X, -hy, 0.9 * X, 2 * hy, Math.min(0.22 * S, hy * 0.7)); }
    g.fillStyle = '#202326';
    g.fill(sk);
    g.save();
    g.clip(sk);
    g.strokeStyle = '#34383c';
    g.lineWidth = 0.02 * S;
    g.beginPath();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * P; g.moveTo(0, 0); g.lineTo(Math.cos(a) * L.D, Math.sin(a) * L.D); }
    g.stroke();
    g.restore();
    g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke(sk);
    g.save(); g.scale(0.93, 0.92); g.strokeStyle = rgba(pal.accent, 0.5); g.lineWidth = o * 0.6; g.stroke(sk); g.restore();
    for (const s of [-1, 1]) {
      const cx = -0.4 * X, cy = s * Math.min(0.2 * Y, L.hw * S + 0.02 * S), r = (L.hw < 0.2 ? 0.08 : 0.11) * S;
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
    } else {
      // rotor masts: an armoured pylon to each hub that is off the fuselage centreline
      for (const r of L.rotors) {
        if (Math.abs(r.y) > 0.02 * S) {
          g.lineCap = 'round';
          g.strokeStyle = OUTLINE; g.lineWidth = 0.07 * S;
          g.beginPath(); g.moveTo(r.x + 0.03 * S, Math.sign(r.y) * 0.04 * S); g.lineTo(r.x, r.y); g.stroke();
          g.strokeStyle = pal.dark; g.lineWidth = 0.045 * S; g.stroke();
          g.beginPath(); roundRect(g, r.x - 0.13 * S, r.y - 0.045 * S, 0.24 * S, 0.09 * S, 0.045 * S);
          g.fillStyle = METAL.dark; g.fill(); g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
        }
        joint(g, r.x, r.y, Math.max(0.04 * S, r.r * 0.09), METAL.base, o);
      }
    }
  } else if (id === 'jet') {
    // the airframe is the wing: engine cans at the nozzles
    for (const n of L.nozzles) {
      g.beginPath(); roundRect(g, n.x, n.y - n.w * 0.75, 0.2 * S, n.w * 1.5, n.w * 0.6);
      g.fillStyle = METAL.dark; g.fill(); g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke();
    }
  }
}

/** Anchor base plate (drawn axis-aligned, does not rotate with the hull). */
export function drawAnchorPlate(g: Ctx, L: UnitLayout, pal: TeamPal, o: number): void {
  const S = Math.min(L.X, L.Y), ax = L.X / S, ay = L.Y / S;
  const p = new Path2D();
  poly(p, [0.47 * ax, -0.3 * ay, 0.47 * ax, 0.3 * ay, 0.47 * ax - 0.17, 0.47 * ay, -0.47 * ax + 0.17, 0.47 * ay, -0.47 * ax, 0.3 * ay, -0.47 * ax, -0.3 * ay, -0.47 * ax + 0.17, -0.47 * ay, 0.47 * ax - 0.17, -0.47 * ay], S);
  g.fillStyle = '#3a3f44';
  g.fill(p);
  g.save();
  g.clip(p);
  g.strokeStyle = 'rgba(240,190,40,0.55)';
  g.lineWidth = 0.05 * S;
  g.beginPath();
  for (let i = -36; i < 36; i++) { const x = i * 0.1 * S; g.moveTo(x, -0.6 * L.Y); g.lineTo(x + 1.2 * L.Y, 0.6 * L.Y); }
  g.stroke();
  g.beginPath();
  poly(g, [0.39 * ax, -0.25 * ay, 0.39 * ax, 0.25 * ay, 0.39 * ax - 0.14, 0.39 * ay, -0.39 * ax + 0.14, 0.39 * ay, -0.39 * ax, 0.25 * ay, -0.39 * ax, -0.25 * ay, -0.39 * ax + 0.14, -0.39 * ay, 0.39 * ax - 0.14, -0.39 * ay], S);
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

/** Build profile of a design (cached per layout key). */
export function profileOf(d: Design, L: UnitLayout): BuildProfile {
  return buildProfile(d, L.key, L.S, L.chassis.roles, L.mounts.map((m) => m.mod));
}

const rearCache = new Map<string, number>();
let scratch: Ctx | null = null;
/** x (fraction of S) of the hull's rear edge on the centreline. */
function rearX(L: UnitLayout, hp: Path2D): number {
  const k = `${L.shape}|${L.S}|${L.X}|${L.Y}`;
  const hit = rearCache.get(k);
  if (hit !== undefined) return hit;
  scratch ??= ctx2d(makeCanvas(2, 2));
  let r = -0.42 * L.X / L.S;
  for (let x = -0.55; x < 0; x += 0.01) if (scratch.isPointInPath(hp, x * L.X, 0)) { r = x * L.X / L.S; break; }
  rearCache.set(k, r);
  return r;
}

export interface UnitSprites {
  px: number;
  ext: number;
  hull: HTMLCanvasElement;
  mob: (HTMLCanvasElement | undefined)[];
  rest: HTMLCanvasElement;
  /** crisp, hard-edged black silhouette (ground drop shadow) */
  shadow: HTMLCanvasElement;
  /** blurred version of the shadow, built on first use (flyers and airborne leapers only) */
  soft?: HTMLCanvasElement;
  /** dark outline + crisp team rim line, drawn under the unit (no glow) */
  halo: HTMLCanvasElement;
  haloExt: number;
  sil: Map<string, HTMLCanvasElement>;
  anchor?: HTMLCanvasElement;
  /** parts drawn above the turrets (titan pauldrons) */
  top?: HTMLCanvasElement;
  /** shield shimmer envelope (designs with a shield module) */
  shell?: HTMLCanvasElement;
  /** animated parts (limbs, claws, tail/body segments): sprite + its own halo, centred on the part pivot */
  parts: { c: HTMLCanvasElement; ext: number; halo: HTMLCanvasElement; haloExt: number; sil: Map<string, HTMLCanvasElement> }[];
  /** screen-space key-light rim overlays per local light-direction bucket (built on demand, see litOverlay) */
  lit?: (HTMLCanvasElement | undefined)[];
}

const spriteCache = new Map<string, UnitSprites>();
/** below this many device px per cell, animated parts are baked into the static hull sprite */
const PART_LOD_PX = 14;
const turretCache = new Map<string, HTMLCanvasElement>();
const MAX_SPRITES = 400;
/** Backing-store budget (pixels) for the sprite cache: a few close-zoom designer sets (2048² canvases) must not pile up. */
const MAX_SPRITE_PIXELS = 4.0e7;
let spritePixels = 0;
const spritePx = new Map<string, number>();
function spriteSetPixels(s: UnitSprites): number {
  let n = s.hull.width * s.hull.height * 4 + s.halo.width * s.halo.height;
  if (s.top) n += s.top.width * s.top.height;
  if (s.anchor) n += s.anchor.width * s.anchor.height;
  if (s.shell) n += s.shell.width * s.shell.height;
  for (const q of s.parts) n += q.c.width * q.c.height + q.halo.width * q.halo.height;
  return n;
}
/** Evict the oldest sets until `need` more pixels fit the budget (battlefield-sized sets are tiny and rarely touched). */
function spriteRoom(need: number): void {
  for (const [k] of spriteCache) {
    if (spritePixels + need <= MAX_SPRITE_PIXELS) break;
    const s = spriteCache.get(k)!;
    spriteCache.delete(k);
    spritePixels -= spritePx.get(k) ?? 0;
    spritePx.delete(k);
    if (litOwners.delete(s)) for (const c of s.lit ?? []) if (c) litPixels -= c.width * c.height;
  }
}

function beginSprite(px: number, ext: number): { c: HTMLCanvasElement; g: Ctx } {
  const size = Math.ceil(2 * ext * px);
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  g.translate(size / 2, size / 2);
  g.scale(px, px);
  return { c, g };
}

/** Outline width in cells: a thin proportional line at close zoom, never below ~1.1 device px so it stays legible
 *  when the whole field is visible (sprite px ~ screen px). */
const outlineW = (px: number, S: number) => Math.max(1.1 / px, 0.0055 * Math.min(S, 2.5));

export function unitSprites(design: Design, team: Team, px: number): UnitSprites {
  px = Math.max(4, Math.round(px));
  const L = layoutOf(design);
  const key = `${L.key}|${team}|${px}`;
  let s = spriteCache.get(key);
  if (s) return s;
  if (spriteCache.size > MAX_SPRITES) { spriteCache.clear(); spritePx.clear(); spritePixels = 0; }
  // make room before baking a big set (the estimate: ~6 hull-sized canvases)
  const est = Math.ceil(2 * L.ext * px) ** 2 * 6;
  if (spritePixels + est > MAX_SPRITE_PIXELS) spriteRoom(est);
  const pal = TEAM_PAL[team];
  const o = outlineW(px, L.S);
  const ext = L.ext;
  const hull = beginSprite(px, ext);
  const allParts = partsOf(L);
  // LOD: when a unit is only a few pixels per cell, parts are baked (rest pose) into the hull -> no per-part blits
  const bake = px < PART_LOD_PX;
  const pdefs = bake ? [] : allParts;
  const riding = partMounts(pdefs);
  const restX = partXfs(pdefs, null);
  const prof = profileOf(design, L);
  const creature = CREATURE_SHAPES.has(L.shape);
  const legged = L.mob.id === 'legs' || L.mob.id === 'spider' || L.mob.id === 'jumpjets' || L.mob.id === 'titanlegs';
  if (prof.role === 'artillery' && (L.mob.id === 'treads' || L.mob.id === 'wheels' || L.mob.id === 'halftrack') && !creature && L.shape !== 'long' && L.shape !== 'siegeplat' && L.shape !== 'carriage') drawOutriggers(hull.g, L.S, Math.min(L.hw, 0.36), o, L.X);
  hullUnderlay(hull.g, L, pal, o);
  if (bake) drawPartsStatic(hull.g, L, pal, o, 'under');
  // armour class shapes the hull itself: light builds are slimmer, heavy ones wider with skirts over the running gear
  const tier = armourTier(prof);
  const kY = !creature && !GIANT_SHAPES.has(L.shape) && !L.air ? [0.93, 1, 1.04, 1.08][tier] : 1;
  const hp0 = hullPathL(L);
  let hp = hp0;
  if (kY !== 1) { hp = new Path2D(); hp.addPath(hp0, new DOMMatrix().scale(1, kY)); }
  if (!L.air && L.mob.id !== 'anchor') drawSkirts(hull.g, L, tier, pal, o);
  paintHull(hull.g, hp, pal, L.S, o, L.hw * kY, L.X, L.Y);
  setDetailPx(px);
  hullDetails(hull.g, L, pal, o);
  if (bake) drawPartsStatic(hull.g, L, pal, o, 'over');
  drawPlates(hull.g, L, pal, o);
  drawProfile(hull.g, prof, hp, L.S, Math.min(L.hw, 0.42), pal, o, emis(pal), { creature, air: L.air, legged, rearX: rearX(L, hp0), X: L.X, Y: L.Y });
  teamMarkings(hull.g, L, hp, pal, o, px, creature);
  const sin: SuperIn = {
    S: L.S, X: L.X, Y: L.Y, shape: `${L.shape}|${kY}|${L.X}|${L.Y}`, mob: L.mob.id, air: L.air, mounts: L.mounts, riding, hull: hp, P: prof, pal, o, E: emis(pal), px,
    muzzle: L.mounts.map((m) => (m.mod ? muzzleLen(m.mod) : 0)),
  };
  if (!PART_SHAPES.has(L.shape)) {
    drawSuperstructure(hull.g, sin);
    drawTurretSeats(hull.g, sin);
  }
  // turret rings let into the hull under every turret (they read as seated, not stuck on)
  if (L.S < 4) for (const [mi, m] of L.mounts.entries()) if (m.turret && !riding.has(mi)) {
    // a smaller weapon in a bigger hardpoint: the slot's armoured socket shows around an adapter plate
    if (m.sd > m.d * 1.08) adapterPlate(hull.g, m.x, m.y, m.sd * 0.5, m.d * 0.5, pal, o);
    dotAt(hull.g, m.x, m.y, m.d * 0.5, 'rgba(0,0,0,0.5)');
    hull.g.strokeStyle = METAL.light; hull.g.lineWidth = o * 0.7;
    hull.g.beginPath(); hull.g.arc(m.x, m.y, m.d * 0.47, Math.PI * 0.8, Math.PI * 1.75); hull.g.stroke();
  }
  // empty mount sockets
  if (L.S >= 4) {
    for (const m of L.mounts) if (m.turret && m.sd > m.d * 1.08) adapterPlate(hull.g, m.x, m.y, m.sd * 0.5, m.d * 0.6, pal, o);
    for (const m of L.mounts) if (m.turret || !m.mod) drawBarbette(hull.g, m.x, m.y, m.d * (m.turret ? 0.6 : 0.42), pal, o, !m.mod);
  } else for (const [mi, m] of L.mounts.entries()) if (!m.mod && !riding.has(mi)) armoredCap(hull.g, m.x, m.y, m.d * 0.34, pal, o);
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
  // shadow: union of mobility + hull silhouettes, flat black with a hard edge (flyers blur it on demand: softShadow)
  const sh = beginSprite(px, ext);
  sh.g.setTransform(1, 0, 0, 1, 0, 0);
  // parts (sprite + sockets for empty mounts riding them)
  const parts: UnitSprites['parts'] = pdefs.map((d, j) => {
    const sp = beginSprite(px, d.ext);
    const R = restX[j];
    sp.g.save();
    sp.g.rotate(-R.r);
    d.draw(sp.g, pal, o);
    sp.g.restore();
    for (const mi of d.mounts ?? []) {
      const m = L.mounts[mi];
      if (m.mod) continue;
      const c = Math.cos(-R.r), sn = Math.sin(-R.r), dx = m.x - R.x, dy = m.y - R.y;
      const qx = c * dx - sn * dy, qy = sn * dx + c * dy;
      dotAt(sp.g, qx, qy, m.d * 0.32, 'rgba(0,0,0,0.5)');
      dotAt(sp.g, qx, qy, m.d * 0.18, 'rgba(255,255,255,0.1)');
    }
    const hl = buildHalo(sp.c, d.ext, px, pal);
    return { c: sp.c, ext: d.ext, halo: hl.c, haloExt: hl.ext, sil: new Map() };
  });
  if (anchor) sh.g.drawImage(anchor, 0, 0);
  sh.g.drawImage(rest.c, 0, 0);
  sh.g.drawImage(hull.c, 0, 0);
  if (top) sh.g.drawImage(top, 0, 0);
  for (let j = 0; j < parts.length; j++) stampPart(sh.g, parts[j].c, parts[j].ext, restX[j], px, sh.c.width);
  sh.g.globalCompositeOperation = 'source-in';
  sh.g.fillStyle = '#000';
  sh.g.fillRect(0, 0, sh.c.width, sh.c.height);
  s = { px, ext, hull: hull.c, mob: new Array(L.frames), rest: rest.c, shadow: sh.c, halo: sh.c, haloExt: ext, sil: new Map(), anchor, top, parts };
  if (prof.shield > 0) s.shell = shieldShell(hp, L.S, ext, px, prof.shield, pal.glow);
  const hl = buildHalo(silhouette(s, '#000'), ext, px, pal);
  s.halo = hl.c;
  s.haloExt = hl.ext;
  const n = spriteSetPixels(s);
  spriteCache.set(key, s);
  spritePx.set(key, n);
  spritePixels += n;
  return s;
}

/** Slot-class armoured socket (octagon, R) with a recessed adapter plate stepping down to a smaller weapon ring (r). */
function adapterPlate(g: Ctx, x: number, y: number, R: number, r: number, pal: TeamPal, o: number): void {
  const oct = (rad: number) => {
    const p = new Path2D();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; p.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
    p.closePath();
    return p;
  };
  const p = oct(R);
  g.fillStyle = METAL.dark; g.fill(p);
  g.lineWidth = o; g.strokeStyle = OUTLINE; g.stroke(p);
  // hard-edged inner bevel: lit upper-left lip, shadowed lower-right lip
  g.save(); g.clip(p);
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fill(oct(R * 0.86));
  g.restore();
  const q = oct((R + r) / 2);
  g.fillStyle = METAL.base; g.fill(q);
  g.lineWidth = o * 0.7; g.strokeStyle = OUTLINE; g.stroke(q);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; dotAt(g, x + Math.cos(a) * (R + r) * 0.47, y + Math.sin(a) * (R + r) * 0.47, Math.max(o * 0.6, (R - r) * 0.08), 'rgba(0,0,0,0.6)'); }
  g.strokeStyle = rgba(pal.accent, 0.55); g.lineWidth = o * 0.6;
  g.beginPath(); g.arc(x, y, R * 0.93, Math.PI * 0.9, Math.PI * 1.6); g.stroke();
}

/** Armoured blanking cap over an empty mount: octagonal plate, bolts, team-trim ring. */
function armoredCap(g: Ctx, x: number, y: number, r: number, pal: TeamPal, o: number): void {
  const p = new Path2D();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; p.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  p.closePath();
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.save(); g.translate(o * 0.6, o); g.fill(p); g.restore();
  const gr = g.createLinearGradient(x - r, y - r, x + r, y + r);
  gr.addColorStop(0, METAL.light); gr.addColorStop(1, METAL.dark);
  g.fillStyle = gr; g.fill(p);
  g.lineWidth = o * 0.7; g.strokeStyle = OUTLINE; g.stroke(p);
  g.strokeStyle = rgba(pal.accent, 0.7); g.lineWidth = o * 0.6;
  g.beginPath(); g.arc(x, y, r * 0.62, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; dotAt(g, x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78, r * 0.09, 'rgba(0,0,0,0.6)'); }
  dotAt(g, x, y, r * 0.22, METAL.dark);
}

let scratchG: Ctx | null = null;
const inHull = (p: Path2D, x: number, y: number) => (scratchG ??= ctx2d(makeCanvas(2, 2))).isPointInPath(p, x, y);
/** Half-width of the hull path at station x (largest |y| inside on both sides), scanning inward from maxY. */
function edgeY(p: Path2D, x: number, maxY: number): number {
  for (let y = maxY; y > 0; y -= maxY / 48) if (inHull(p, x, y) && inHull(p, x, -y)) return y;
  return 0;
}

/**
 * Team identity as small painted / lit details only (Zero-K / Mechabellum style): a pair of team-colour bands on each
 * flank, team-colour running lights at the rear corners, and a small team decal on the rear deck (role stencils / serials come from the build profile).
 * Sizes have a device-pixel floor so the bands and lights still read at fit zoom.
 */
function teamMarkings(g: Ctx, L: UnitLayout, hp: Path2D, pal: TeamPal, _o: number, px: number, creature: boolean): void {
  const S = L.S, maxX = Math.max(L.X, L.Y, S) * 0.62;
  let fx = 0, rx = 0;
  for (let x = maxX; x > 0; x -= maxX / 90) if (inHull(hp, x, 0)) { fx = x; break; }
  for (let x = -maxX; x < 0; x += maxX / 90) if (inHull(hp, x, 0)) { rx = x; break; }
  const len = fx - rx;
  if (len <= 0.1) return;
  const maxY = Math.max(L.X, L.Y, S) * 0.62;
  const u = Math.max(0.026 * Math.min(S, 2.2), 1.8 / px);
  // flank bands (two parallel stripes across each side panel, clipped to the hull)
  if (!creature) {
    const sx = fx - len * 0.3, ey = edgeY(hp, sx, maxY);
    if (ey > u * 3) {
      g.save();
      g.clip(hp);
      for (const sd of [-1, 1]) for (const k of [0, 1]) {
        const x0 = sx - k * u * 1.9, y0 = sd > 0 ? ey * 0.66 : -ey * 1.3;
        g.fillStyle = pal.accent;
        g.fillRect(x0 - u / 2, y0, u, ey * 0.64);
        // worn paint: a few chips and a darker lower edge
        g.fillStyle = 'rgba(0,0,0,0.22)';
        g.fillRect(x0 + u * 0.25, y0, u * 0.25, ey * 0.64);
      }
      g.restore();
    }
  }
  // rear running lights (team glow): dark housing, coloured lens, hot core
  const lx = rx + len * 0.09, ly = edgeY(hp, lx, maxY) * 0.7;
  const lr = Math.max(0.02 * Math.min(S, 2.5), 1.2 / px);
  if (ly > lr * 2) for (const sd of [-1, 1]) {
    dotAt(g, lx, sd * ly, lr * 1.6, 'rgba(8,10,12,0.75)');
    dotAt(g, lx, sd * ly, lr, pal.glow);
    dotAt(g, lx - lr * 0.2, sd * ly - lr * 0.2, lr * 0.45, '#ffffff');
  }
  // forward sensor / visor light on the crown
  const vx = fx - len * 0.12;
  if (inHull(hp, vx, 0)) {
    dotAt(g, vx, 0, lr * 1.3, 'rgba(8,10,12,0.7)');
    dotAt(g, vx, 0, lr * 0.75, pal.glow);
  }
  // team decal on the rear-left deck
  const dx = rx + len * 0.27, dyE = edgeY(hp, dx, maxY), dy = -dyE * 0.58, dr = Math.max(0.035 * Math.min(S, 2.5), 2 / px);
  if (dyE > dr * 2.6 && !creature) {
    g.save();
    g.translate(dx, dy);
    g.beginPath();
    if (pal.camo === TEAM_PAL[1].camo) { g.moveTo(0, -dr * 1.2); g.lineTo(dr * 1.2, 0); g.lineTo(0, dr * 1.2); g.lineTo(-dr * 1.2, 0); g.closePath(); }
    else g.arc(0, 0, dr, 0, Math.PI * 2);
    g.fillStyle = 'rgba(14,16,18,0.7)'; g.fill();
    g.lineWidth = dr * 0.42; g.strokeStyle = pal.accent; g.stroke();
    g.restore();
  }
}

/** Screen-space key light: lit rim on the hull edges facing the light, shaded rim on the far edges. The hull sprite
 *  turns with the unit, so this overlay is built per local light-direction bucket and blitted on top; that keeps the
 *  light coming from the same screen direction for every unit, whichever way it faces. */
const LIT_N = 12;
let litPixels = 0;
const litOwners = new Set<UnitSprites>();
function litOverlay(s: UnitSprites, b: number): HTMLCanvasElement {
  s.lit ??= new Array(LIT_N);
  let c = s.lit[b];
  if (c) return c;
  const w = s.hull.width, h = s.hull.height;
  if (litPixels > 6e7) { for (const o of litOwners) o.lit = new Array(LIT_N); litOwners.clear(); litPixels = 0; s.lit = new Array(LIT_N); }
  const a = (b / LIT_N) * Math.PI * 2, d = Math.max(1.2, s.px * 0.022);
  const lx = Math.cos(a) * d, ly = Math.sin(a) * d;
  const rim = (sx: number, sy: number, fill: string) => {
    const r = makeCanvas(w, h), rg = ctx2d(r);
    rg.drawImage(s.hull, 0, 0);
    rg.globalCompositeOperation = 'destination-out';
    rg.drawImage(s.hull, sx, sy);
    rg.globalCompositeOperation = 'source-in';
    rg.fillStyle = fill;
    rg.fillRect(0, 0, w, h);
    return r;
  };
  c = rim(-lx, -ly, 'rgba(255,250,240,0.3)');
  ctx2d(c).drawImage(rim(lx * 1.4, ly * 1.4, 'rgba(0,0,0,0.3)'), 0, 0);
  s.lit[b] = c;
  litPixels += w * h;
  litOwners.add(s);
  return c;
}

/** Contact edge under the unit: a faint 1 device-px dark line just outside the silhouette so the machine separates from
 *  bright ground at any zoom. No team colour and no heavy outline: team identity lives in the small painted / lit
 *  details, the ground ring at fit zoom and the far-zoom markers. */
function buildHalo(src: HTMLCanvasElement, sext: number, px: number, _pal: TeamPal): { c: HTMLCanvasElement; ext: number } {
  const t = makeCanvas(src.width, src.height);
  const tg = ctx2d(t);
  tg.drawImage(src, 0, 0);
  tg.globalCompositeOperation = 'source-in';
  tg.fillStyle = 'rgb(14,15,16)';
  tg.fillRect(0, 0, t.width, t.height);
  const ow = 1;
  const pad = ow + 1;
  const ext = sext + pad / px;
  const size = Math.ceil(2 * ext * px);
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const off = (size - src.width) / 2;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.drawImage(t, off + Math.cos(a) * ow, off + Math.sin(a) * ow);
  }
  // keep it a hard, faint line: faint fringe dropped, the rest at a fixed low alpha
  const id = g.getImageData(0, 0, size, size), d = id.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] < 70 ? 0 : 92;
  g.putImageData(id, 0, 0);
  return { c, ext };
}

/** Blurred shadow for flyers / airborne leapers: the only blurred shadow in the game (cached per sprite set). */
function softShadow(s: UnitSprites, S: number): HTMLCanvasElement {
  if (s.soft) return s.soft;
  const c = makeCanvas(s.shadow.width, s.shadow.height);
  const g = ctx2d(c);
  g.filter = `blur(${Math.max(1, s.px * 0.05 * Math.min(S, 3))}px)`;
  g.drawImage(s.shadow, 0, 0);
  g.filter = 'none';
  s.soft = c;
  return c;
}

/** Draw a part sprite into a pixel-space canvas of the unit sprite (size x size, centred) at transform xf. */
function stampPart(g: Ctx, c: HTMLCanvasElement, pext: number, xf: Xf, px: number, size: number): void {
  const t = g.getTransform();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.translate(size / 2 + xf.x * px, size / 2 + xf.y * px);
  g.rotate(xf.r);
  g.drawImage(c, -pext * px, -pext * px, pext * 2 * px, pext * 2 * px);
  g.setTransform(t);
}

function partSil(p: UnitSprites['parts'][number], color: string): HTMLCanvasElement {
  let c = p.sil.get(color);
  if (c) return c;
  c = makeCanvas(p.c.width, p.c.height);
  const g = ctx2d(c);
  g.drawImage(p.c, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  p.sil.set(color, c);
  return c;
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

/** Hull-matched turret kit for the main gun: 1 = smoke dischargers + bustle rack (medium armour), 2 = + wedge add-on
 *  armour on the turret front (heavy). Only for housed gun turrets. */
const KIT_VISUALS = new Set(['gun', 'cannon', 'gauss', 'rail', 'gatling', 'shotgun', 'sniper', 'laser', 'plasma', 'heatray', 'flak', 'flamer']);
export function turretKit(L: UnitLayout, prof: BuildProfile, i: number): number {
  const m = L.mounts[i];
  if (i !== L.main || !m.mod || L.air || L.S >= 4 || !KIT_VISUALS.has(m.mod.visual)) return 0;
  const t = armourTier(prof);
  return t >= 2 ? 2 : t >= 1 || prof.role === 'tank' || prof.role === 'assault' ? 1 : 0;
}

function drawKit(g: Ctx, pal: TeamPal, r: number, o: number, kit: number, layer: 'under' | 'over'): void {
  if (layer === 'under') {
    // bustle rack: open stowage cage off the turret rear with a strapped bedroll
    const x0 = -r * 1.55, x1 = -r * 0.95, h = r * 0.8;
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x0 + o, -h + o * 1.5, x1 - x0, h * 2);
    g.strokeStyle = OUTLINE; g.lineWidth = o * 1.1;
    g.strokeRect(x0, -h, x1 - x0, h * 2);
    g.strokeStyle = METAL.light; g.lineWidth = o * 0.55; g.strokeRect(x0, -h, x1 - x0, h * 2);
    g.beginPath(); for (let k = 1; k < 4; k++) { const y = -h + (2 * h * k) / 4; g.moveTo(x0, y); g.lineTo(x1, y); } g.stroke();
    g.fillStyle = '#5d6646'; g.beginPath(); roundRect(g, x0 + r * 0.08, -h * 0.75, (x1 - x0) * 0.62, h * 0.9, r * 0.06); g.fill();
    g.lineWidth = o * 0.6; g.strokeStyle = OUTLINE; g.stroke();
    g.fillStyle = shade(pal.dark, 0.05); g.beginPath(); roundRect(g, x0 + r * 0.08, h * 0.25, (x1 - x0) * 0.75, h * 0.55, r * 0.06); g.fill(); g.stroke();
    return;
  }
  // smoke dischargers: a fan of three tubes on each front cheek
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const a = s * (0.55 + k * 0.28);
      const cx = Math.cos(a) * r * 0.98 - r * 0.15, cy = Math.sin(a) * r * 0.98;
      g.save(); g.translate(cx, cy); g.rotate(a);
      g.fillStyle = OUTLINE; g.beginPath(); roundRect(g, -r * 0.02, -r * 0.085, r * 0.26, r * 0.17, r * 0.04); g.fill();
      g.fillStyle = METAL.base; g.beginPath(); roundRect(g, 0, -r * 0.06, r * 0.22, r * 0.12, r * 0.03); g.fill();
      g.fillStyle = '#07080a'; g.beginPath(); g.arc(r * 0.2, 0, r * 0.04, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }
  if (kit >= 2) {
    // wedge add-on armour: arrowhead plates bolted on the turret cheeks
    for (const s of [-1, 1]) {
      const p = new Path2D();
      p.moveTo(r * 0.98, s * r * 0.3); p.lineTo(r * 0.22, s * r * 1.08); p.lineTo(-r * 0.12, s * r * 1.02); p.lineTo(r * 0.55, s * r * 0.3); p.closePath();
      g.save(); g.translate(o * 0.6, o); g.fillStyle = 'rgba(0,0,0,0.45)'; g.fill(p); g.restore();
      const gr = g.createLinearGradient(r, 0, -r * 0.1, s * r);
      gr.addColorStop(0, shade(pal.light, 0.05)); gr.addColorStop(1, shade(pal.body, -0.15));
      g.fillStyle = gr; g.fill(p); g.lineWidth = o * 0.8; g.strokeStyle = OUTLINE; g.lineJoin = 'round'; g.stroke(p);
      for (const f of [0.3, 0.65]) { const bx = r * 0.98 + (r * 0.22 - r * 0.98) * f - r * 0.12, by = s * (r * 0.3 + (r * 1.08 - r * 0.3) * f); g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.arc(bx, by, r * 0.045, 0, Math.PI * 2); g.fill(); }
    }
  }
}

export function turretSprite(m: ModuleDef, team: Team, d: number, px: number, kit = 0): HTMLCanvasElement {
  px = Math.max(4, Math.round(px));
  const dq = Math.round(d * 100) / 100;
  const key = `${m.id}|${team}|${dq}|${px}|${kit}`;
  let c = turretCache.get(key);
  if (c) return c;
  if (turretCache.size > 1200) turretCache.clear();
  const ext = TURRET_EXT * dq;
  const sp = beginSprite(px, ext);
  const o = Math.max(1 / px, dq * 0.045);
  // hard-edged contact shadow under the turret
  sp.g.fillStyle = 'rgba(0,0,0,0.35)';
  sp.g.beginPath();
  sp.g.arc(dq * 0.06, dq * 0.08, dq * 0.5, 0, Math.PI * 2);
  sp.g.fill();
  if (kit) drawKit(sp.g, TEAM_PAL[team], dq / 2, o, kit, 'under');
  drawTurret(sp.g, m, TEAM_PAL[team], dq, o, true);
  if (kit) drawKit(sp.g, TEAM_PAL[team], dq / 2, o, kit, 'over');
  turretCache.set(key, sp.c);
  return sp.c;
}

const shadowCache = new Map<string, HTMLCanvasElement>();
/** Crisp black silhouette of a turret sprite (hard-edged cast shadow onto the hull). */
export function turretShadow(m: ModuleDef, team: Team, d: number, px: number, kit = 0): HTMLCanvasElement {
  const src = turretSprite(m, team, d, px, kit);
  const key = `${m.id}|${team}|${Math.round(d * 100)}|${Math.max(4, Math.round(px))}|${kit}`;
  let c = shadowCache.get(key);
  if (c) return c;
  if (shadowCache.size > 1200) shadowCache.clear();
  c = makeCanvas(src.width, src.height);
  const g = ctx2d(c);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  shadowCache.set(key, c);
  return c;
}

/** Wreck sprite: hull silhouette charred, used for persistent battlefield decals. */
/** Hot-crack points (cells, hull-local) of the last wreck sprite built per design key: where embers glow. */
const wreckHot = new Map<string, number[]>();
export function wreckHotspots(design: Design): number[] { return wreckHot.get(layoutOf(design).key) ?? []; }

/**
 * Charred hulk of the unit's own silhouette: blackened metal (detail still faintly showing through), torn-off edge
 * chunks, burnt-through deck holes exposing the frame, dull heat cracks, and the main turret knocked askew. Hard-edged
 * throughout (no blotchy texture). Embers, smoke and fire are animated on top by Fx (see Fx.wreck).
 */
export function wreckSprite(design: Design, team: Team, px: number): HTMLCanvasElement {
  const s = unitSprites(design, team, px);
  let c = s.sil.get('#wreck');
  if (c) return c;
  const L = layoutOf(design);
  let seed = (strHash(L.key) % 2147483646) + 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const w = beginSprite(s.px, s.ext);
  const g = w.g;
  const body = makeCanvas(w.c.width, w.c.height);
  const bg = ctx2d(body);
  bg.drawImage(s.rest, 0, 0);
  bg.drawImage(s.hull, 0, 0);
  if (s.top) bg.drawImage(s.top, 0, 0);
  const pd = s.parts.length ? partsOf(L) : [], rx = partXfs(pd, null);
  for (let j = 0; j < s.parts.length; j++) stampPart(bg, s.parts[j].c, s.parts[j].ext, rx[j], s.px, body.width);
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(body, 0, 0); g.restore();
  // main turret blown off its ring and lying askew on the deck
  const mt = L.mounts[L.main];
  if (mt && mt.turret && mt.mod && L.S < 4) {
    const ts = turretSprite(mt.mod, team, mt.d, s.px);
    const e = TURRET_EXT * Math.round(mt.d * 100) / 100;
    g.save();
    g.translate(mt.x + (rnd() - 0.5) * mt.d * 0.6, mt.y + (rnd() - 0.5) * mt.d * 0.6);
    g.rotate(rnd() * Math.PI * 2);
    g.drawImage(ts, -e, -e, e * 2, e * 2);
    g.restore();
  }
  const S = L.S, X = L.X, Y = L.Y, D = L.D;
  // blackened: soot over everything, a little detail still reading through
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(26,24,22,0.8)';
  g.fillRect(-s.ext, -s.ext, s.ext * 2, s.ext * 2);
  // heat-blued / rust-brown streaks on the scorched plates (hard-edged bands)
  for (let i = 0; i < 3 + S; i++) {
    g.save();
    g.translate((rnd() - 0.5) * X * 0.7, (rnd() - 0.5) * Y * 0.7);
    g.rotate(rnd() * Math.PI);
    g.fillStyle = rnd() < 0.5 ? 'rgba(92,66,46,0.32)' : 'rgba(60,66,84,0.28)';
    g.fillRect(-0.12 * S, -0.02 * S, 0.24 * S, 0.04 * S);
    g.restore();
  }
  const jag = (path: Path2D, cx: number, cy: number, r: number) => {
    const n = 7 + Math.floor(rnd() * 4), a0 = rnd() * 6.28;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2, rr = r * (0.45 + rnd() * 0.7);
      path.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    path.closePath();
  };
  // torn-off chunks along the edge (the silhouette is broken)
  g.globalCompositeOperation = 'destination-out';
  const bites = new Path2D();
  for (let i = 0; i < 2 + Math.min(S, 4); i++) {
    const a = rnd() * Math.PI * 2;
    jag(bites, Math.cos(a) * X * 0.48, Math.sin(a) * Y * 0.42, (0.07 + rnd() * 0.07) * Math.min(S, 3));
  }
  g.fill(bites);
  // burnt-through deck holes: dark interior with the frame ribs showing
  g.globalCompositeOperation = 'source-atop';
  const holes = new Path2D();
  for (let i = 0; i < 1 + Math.min(S, 3); i++) jag(holes, (rnd() - 0.5) * X * 0.5, (rnd() - 0.5) * Y * 0.45, (0.06 + rnd() * 0.05) * Math.min(S, 3));
  g.fillStyle = '#0b0a09';
  g.fill(holes);
  g.save();
  g.clip(holes);
  g.strokeStyle = '#5a534c';
  g.lineWidth = Math.max(1 / s.px, 0.014 * S);
  g.beginPath();
  for (let k = -6; k <= 6; k++) { g.moveTo(k * 0.06 * S, -Y); g.lineTo(k * 0.06 * S, Y); }
  g.moveTo(-X, 0); g.lineTo(X, 0);
  g.stroke();
  g.restore();
  g.strokeStyle = 'rgba(150,140,128,0.35)';
  g.lineWidth = Math.max(0.8 / s.px, 0.006 * S);
  g.stroke(holes);
  // heat cracks (dull; Fx adds the ember glow at their ends while the wreck cools)
  const hot: number[] = [];
  g.strokeStyle = 'rgba(110,52,26,0.75)';
  g.lineWidth = Math.max(1 / s.px, 0.01 * S);
  g.lineCap = 'round';
  for (let i = 0; i < 3 + Math.min(S, 4) * 2; i++) {
    let x = (rnd() - 0.5) * X * 0.62, y = (rnd() - 0.5) * Y * 0.55;
    g.beginPath(); g.moveTo(x, y);
    const a0 = rnd() * Math.PI * 2;
    for (let k = 0; k < 3; k++) { const a = a0 + (rnd() - 0.5) * 1.4; x += Math.cos(a) * 0.05 * D; y += Math.sin(a) * 0.05 * D; g.lineTo(x, y); }
    g.stroke();
    hot.push(x, y);
  }
  g.globalCompositeOperation = 'source-over';
  wreckHot.set(L.key, hot);
  s.sil.set('#wreck', w.c);
  return w.c;
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
  /** field views: draw the fit-zoom team ground ring under the unit (not in previews / icons) */
  groundRing?: boolean;
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
  /** world-space mount angles; omitted = turrets rest pointing along the hull (no idle motion: a parked unit's guns
   *  hold still, in the designer, on the deploy board and in every preview) */
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
  /** hold every animated part (creature / walker arms, booms) at its rest pose: designer bench and previews, where
   *  the mount markers are drawn over the parts and an idling arm carried its weapon off its marker */
  still?: boolean;
  /** tilted views: extra world-space lift (along the view's up) of turrets above the hull, so they stand on top of it */
  turretLift?: number;
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
  // apply the rotation, draw, then apply the exact inverse (cheaper than get/setTransform, no DOMMatrix garbage)
  const cs = Math.cos(ang), sn = Math.sin(ang);
  g.transform(cs * scale, sn * scale, -sn * scale, cs * scale, x, y);
  g.drawImage(c, -ext, -ext, ext * 2, ext * 2);
  const k = 1 / scale;
  g.transform(cs * k, -sn * k, sn * k, cs * k, -(cs * x + sn * y) * k, -(-sn * x + cs * y) * k);
}

/** Visual altitude (cells) for a pose: flyers hover, leapers arc. */
export function altitudeOf(p: UnitPose, L: UnitLayout): number {
  if (L.air || p.flying) return 0.55 + 0.25 * L.S + Math.sin(p.time * 2.1 + (p.seed ?? 0)) * 0.05;
  if (p.leap) return p.leap * 1.4 * L.S;
  if (L.mob.id === 'hover') return 0.04 + Math.sin(p.time * 3 + (p.seed ?? 0)) * 0.015;
  return 0;
}

/** One shadow language: ground units (incl. hover, walkers, emplacements) cast a single crisp, hard-edged drop
 *  shadow offset a little down-right along the world light; flyers (and leapers while airborne) cast a soft, faint,
 *  light shadow pushed out by altitude - the only blurred shadow anywhere. */
export function drawUnitShadow(g: Ctx, p: UnitPose, px: number, dirs: ViewDirs = DEFAULT_DIRS): void {
  const L = layoutOf(p.design);
  const s = unitSprites(p.design, p.team, px);
  const alt = altitudeOf(p, L);
  const ang = L.mob.id === 'anchor' && L.X === L.Y ? 0 : p.angle;
  const flying = L.air || !!p.flying;
  const leap = p.leap ?? 0;
  // fit-zoom team cue: a thin team-colour ring on the ground under the unit, fading out as the camera closes in
  // (close up, the painted stripes and running lights carry the team; very far out, the markers take over)
  const rk = clamp((50 - px) / 16, 0, 1) * (p.alpha ?? 1);
  if (p.groundRing && rk > 0.02 && p.cloak !== 'enemy' && (p.alpha ?? 1) > 0.6) {
    const pal = TEAM_PAL[p.team];
    g.save();
    g.translate(p.x, p.y);
    g.rotate(ang);
    g.globalAlpha = (L.S <= 1 ? 0.32 : 0.5) * rk;
    g.strokeStyle = pal.rim;
    g.lineWidth = 1.6 / px;
    g.beginPath();
    g.ellipse(0, 0, L.X * 0.5 + 2.5 / px, L.Y * 0.5 + 2.5 / px, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    g.globalAlpha = 1;
  }
  if (flying || leap > 0.02) {
    const off = 0.06 * L.S + alt * 0.75;
    const a = flying ? (L.S >= 4 ? 0.3 : L.S >= 3 ? 0.26 : 0.22) : 0.3 - leap * 0.1;
    g.globalAlpha = (p.alpha ?? 1) * a;
    const sc = flying ? (L.S >= 4 ? 0.97 : 0.88) : 1 - leap * 0.15;
    blit(g, softShadow(s, L.S), p.x + dirs.sx * off, p.y + dirs.sy * off, ang, s.ext, sc);
    g.globalAlpha = 1;
    return;
  }
  // load: overloaded designs squat low on strained suspension (tight shadow), light ones ride high
  const lp = profileOf(p.design, L).load;
  const liftK = lp > 1 ? Math.max(0.55, 1 - (lp - 1) * 1.2) : lp < 0.6 ? 1.3 : 1;
  const off = Math.min(0.16, 0.05 * Math.min(L.S, 3) * liftK) + alt * 0.75;
  g.globalAlpha = (p.alpha ?? 1) * (L.S >= 4 ? 0.42 : 0.36);
  blit(g, s.shadow, p.x + dirs.sx * off, p.y + dirs.sy * off, ang, s.ext, 1);
  g.globalAlpha = 1;
}

export function rotorBlur(g: Ctx, x: number, y: number, r: number, blades: number, t: number, px: number): void {
  // readable at any zoom and in still previews: a tinted semi-opaque disc with a crisp rim, trailing motion-blur
  // sectors behind each blade and dark blade streaks (the disc itself stays see-through enough to show the hull)
  const P2 = Math.PI * 2;
  const disc = g.createRadialGradient(x, y, r * 0.15, x, y, r);
  disc.addColorStop(0, 'rgba(160,172,184,0.30)');
  disc.addColorStop(0.75, 'rgba(190,202,214,0.22)');
  disc.addColorStop(0.93, 'rgba(225,235,245,0.34)');
  disc.addColorStop(1, 'rgba(225,235,245,0.10)');
  g.fillStyle = disc;
  g.beginPath(); g.arc(x, y, r, 0, P2); g.fill();
  const lw = Math.max(1 / px, r * 0.03);
  g.lineWidth = lw;
  g.strokeStyle = 'rgba(10,12,14,0.55)';
  g.beginPath(); g.arc(x, y, r + lw, 0, P2); g.stroke();
  g.strokeStyle = 'rgba(235,242,250,0.6)';
  g.beginPath(); g.arc(x, y, r * 0.97, 0, P2); g.stroke();
  // tip-path ticks (blade tips smear into a dashed ring)
  g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = Math.max(1 / px, r * 0.05);
  g.setLineDash([r * 0.18, r * 0.12]);
  g.beginPath(); g.arc(x, y, r * 0.86, t * 3, t * 3 + P2); g.stroke();
  g.setLineDash([]);
  const spin = t * 31;
  // motion-blur sectors trailing each blade
  for (let i = 0; i < blades; i++) {
    const a = spin + (i / blades) * P2;
    for (let k = 0; k < 3; k++) {
      g.fillStyle = `rgba(215,225,235,${0.16 - k * 0.045})`;
      g.beginPath(); g.moveTo(x, y); g.arc(x, y, r * 0.96, a - 0.22 - k * 0.22, a - k * 0.22); g.closePath(); g.fill();
    }
  }
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(18,20,24,0.85)';
  g.lineWidth = Math.max(1.4 / px, r * 0.085);
  g.beginPath();
  for (let i = 0; i < blades; i++) {
    const a = spin + (i / blades) * P2;
    g.moveTo(x + Math.cos(a) * r * 0.12, y + Math.sin(a) * r * 0.12);
    g.lineTo(x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95);
  }
  g.stroke();
  g.strokeStyle = 'rgba(200,210,220,0.5)';
  g.lineWidth = Math.max(0.7 / px, r * 0.03);
  g.beginPath();
  for (let i = 0; i < blades; i++) {
    const a = spin + (i / blades) * P2 - 0.03;
    g.moveTo(x + Math.cos(a) * r * 0.2, y + Math.sin(a) * r * 0.2);
    g.lineTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
  }
  g.stroke();
  g.fillStyle = '#2b3035';
  g.beginPath(); g.arc(x, y, r * 0.14, 0, P2); g.fill();
  g.lineWidth = Math.max(0.8 / px, r * 0.02); g.strokeStyle = '#0b0d0f'; g.stroke();
  g.fillStyle = '#b0b8c0';
  g.beginPath(); g.arc(x - r * 0.03, y - r * 0.03, r * 0.06, 0, P2); g.fill();
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

  // hover fan wash: an actual light source (lift-fan exhaust), kept small and faint
  if (L.mob.id === 'hover') {
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = alpha * (0.22 + 0.06 * Math.sin(p.time * 9 + (p.seed ?? 0)));
    const r = 0.42 * L.D;
    g.drawImage(softDot(pal.glow), p.x - r, p.y - r, r * 2, r * 2);
    g.globalCompositeOperation = prev;
    g.globalAlpha = alpha;
  }
  // animated parts: per-frame transforms
  const pdefs = s.parts.length ? partsOf(L) : [];
  let pxf: Xf[] = [], prest: Xf[] = [];
  if (pdefs.length) {
    const odo = p.odometer ?? 0;
    let armed = false, fire = 0;
    if (p.mounts) for (const mp of p.mounts) { if (mp.armed) armed = true; if (mp.flash > fire) fire = mp.flash; }
    const ai: AnimIn = { t: p.time, odo, moving: !!p.moving && L.mob.kind !== 'static', seed: p.seed ?? 0, walk: (odo / L.cycle) * Math.PI * 2, armed, fire: Math.min(1, fire) };
    prest = partXfs(pdefs, null);
    pxf = p.still ? prest : partXfs(pdefs, ai);
  }
  const partBlit = (j: number, c: HTMLCanvasElement, e: number) => {
    const f = pxf[j];
    blit(g, c, x + (cs * f.x - sn * f.y) * sc, y + (sn * f.x + cs * f.y) * sc, ang + f.r, e, sc);
  };
  const drawParts = (layer: 'under' | 'over') => { for (let j = 0; j < pdefs.length; j++) if (pdefs[j].layer === layer) partBlit(j, s.parts[j].c, s.parts[j].ext); };
  const silAll = (color: string, dx = 0, k = 1) => {
    blit(g, silhouette(s, color), x + dx, y, ang, s.ext, sc * k);
    for (let j = 0; j < pdefs.length; j++) { const f = pxf[j]; blit(g, partSil(s.parts[j], color), x + dx + (cs * f.x - sn * f.y) * sc, y + (sn * f.x + cs * f.y) * sc, ang + f.r, s.parts[j].ext, sc * k); }
  };
  // outline + team rim/underglow (stays upright-agnostic: it is the silhouette, rotated with the unit)
  if (p.cloak !== 'enemy') {
    blit(g, s.halo, x, y, ang, s.haloExt, sc);
    for (let j = 0; j < pdefs.length; j++) partBlit(j, s.parts[j].halo, s.parts[j].haloExt);
  }
  // square anchor plates stay world-aligned; footprint plates turn with the hull
  if (s.anchor) blit(g, s.anchor, x, y, L.X === L.Y ? 0 : ang, s.ext, sc);
  // mobility
  let frame = s.rest;
  if (L.frames > 1 && p.moving !== false && p.odometer !== undefined && (p.moving || L.mob.id === 'treads' || L.mob.id === 'wheels' || L.mob.id === 'halftrack')) {
    const ph = (p.odometer / L.cycle) % 1;
    frame = mobFrame(p.design, p.team, s, Math.floor(ph * L.frames));
  }
  blit(g, frame, x, y, ang, s.ext, sc);
  // jets: afterburner
  if (L.mob.id === 'jet') {
    // parked (designer / still previews): a steady idle burn that stays inside the footprint (re-rolling it every
    // frame made a parked jet's tail flicker); full, flickering afterburner in flight
    const fl = p.moving === false ? 0.4 : 0.85 + Math.random() * 0.3;
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
  drawParts('under');
  blit(g, s.hull, x, y, ang, s.ext, sc);
  if (px >= 12 && p.cloak !== 'enemy') {
    const la = Math.atan2(-dirs.sy, -dirs.sx) - ang;
    const b = ((Math.round((la / (Math.PI * 2)) * LIT_N) % LIT_N) + LIT_N) % LIT_N;
    blit(g, litOverlay(s, b), x, y, ang, s.ext, sc);
  }
  drawParts('over');
  if (s.shell && p.cloak !== 'enemy') {
    // shield envelope: slow breathing shimmer, always on
    const prevOp = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = alpha * (0.7 + 0.25 * Math.sin(p.time * 1.6 + (p.seed ?? 0)));
    blit(g, s.shell, x, y, ang, s.ext, sc * 1.0);
    g.globalCompositeOperation = prevOp;
    g.globalAlpha = alpha;
  }
  if (CREATURE_SHAPES.has(L.shape) && p.cloak !== 'enemy' && px >= 8) drawCreatureFx(g, L, p.time, p.seed ?? 0, x, y, ang, sc, px, pal, alpha);
  if (GIANT_SHAPES.has(L.shape) || L.mob.id === 'gravlift' || L.mob.id === 'megatracks' || L.mob.id === 'titanlegs') {
    drawGiantFx(g, L, { time: p.time, seed: p.seed, moving: p.moving, odometer: p.odometer }, x, y, ang, sc, px, pal, alpha);
  }
  // turrets
  const prof = profileOf(p.design, L);
  for (let i = 0; i < L.mounts.length; i++) {
    const m = L.mounts[i];
    if (!m.turret || !m.mod) continue;
    const mp = p.mounts?.[i];
    const ta = mp ? mp.angle : ang;
    const fl = mp ? Math.max(0, Math.min(1, mp.flash)) : 0;
    let rec = fl * fl * m.d * (moduleTier(m.mod) >= 4 ? 0.34 : 0.18);
    let rot = 0;
    const sw = mp?.swing ?? 0;
    if (sw > 0 && m.mod.category === 'melee') {
      const k = Math.sin(sw * Math.PI);
      const v = m.mod.visual;
      if (v === 'hammer' || v === 'claw' || v === 'chainsaw' || v === 'blade') rot = Math.sin(sw * Math.PI * 2) * 0.7;
      rec = -k * m.d * (v === 'ram' || v === 'drill' || v === 'prod' ? 0.6 : 0.3);
    }
    const rp = pdefs.length ? mountOnPart(pdefs, prest, pxf, i, m.x, m.y) : null;
    const lx = rp ? rp.x : m.x, ly = rp ? rp.y : m.y;
    let mx = x + (cs * lx - sn * ly) * sc - Math.cos(ta) * rec;
    let my = y + (sn * lx + cs * ly) * sc - Math.sin(ta) * rec;
    const tl = p.turretLift ?? 0;
    const kit = turretKit(L, prof, i);
    const ts = turretSprite(m.mod, p.team, m.d, px, kit);
    // hard-edged cast shadow onto the hull so the turret reads as sitting on top (falls screen-down-right for either viewer)
    const tsh = turretShadow(m.mod, p.team, m.d, px, kit);
    const so = m.d * 0.09 * sc + tl * 0.6;
    g.globalAlpha = alpha * 0.38;
    blit(g, tsh, mx + dirs.sx * so, my + dirs.sy * so, ta + rot, TURRET_EXT * Math.round(m.d * 100) / 100, sc);
    g.globalAlpha = alpha;
    mx += dirs.ux * tl; my += dirs.uy * tl;
    const dis = (p.disarm ?? 0) > 0;
    if (dis) g.globalAlpha = alpha * (0.6 + 0.3 * Math.sin(p.time * 11 + i * 2));
    blit(g, ts, mx, my, ta + rot, TURRET_EXT * Math.round(m.d * 100) / 100, sc);
    g.globalAlpha = alpha;
    if (m.mod.id === 'grinder' || m.mod.visual === 'gatling' || moduleTier(m.mod) >= 4) drawTurretDynamic(g, m.mod, pal, m.d, mx, my, ta + rot, sc, p.time + (p.seed ?? 0) + i, fl, sw, px, alpha, chargeOf(m.mod, mp));
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
    // a faint warm tint: under sustained fire a strong white flash washed the whole hull out
    g.globalAlpha = alpha * Math.min(0.14, hf * 0.16);
    silAll('#ffe8c8');
    g.globalAlpha = alpha;
  }
  if ((p.stun ?? 0) > 0) {
    g.globalAlpha = alpha * (0.12 + 0.08 * Math.sin(p.time * 12));
    silAll('#7fc8ff');
    g.globalAlpha = alpha;
    drawSparks(g, x, y, 0.4 * L.D, p.time, px);
  }
  if ((p.slow ?? 0) > 0) {
    // slowed: a light violet tint on the hull instead of a dashed ring
    g.globalAlpha = alpha * Math.min(0.22, 0.1 + (p.slow ?? 0) * 0.3);
    silAll('#b47cff');
    g.globalAlpha = alpha;
  }
  if ((p.burning ?? 0) > 0) {
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3 + L.S; i++) {
      const a = i * 2.4 + (p.seed ?? 0);
      const rr = ((i * 0.37) % 1), la = Math.cos(a) * 0.3 * L.X * rr, lb = Math.sin(a) * 0.3 * L.Y * rr;
      const fx = x + cs * la - sn * lb, fy = y + sn * la + cs * lb;
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
    silAll('#9fdcff', Math.sin(p.time * 9) * 0.03, 1.02);
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
/** Rest-pose mount centres in hull-local cells (+x = forward), riding animated parts where they do; r = turret radius. */
export function mountPoints(design: Design): { x: number; y: number; r: number }[] {
  const L = layoutOf(design);
  const pdefs = partsOf(L);
  const rest = pdefs.length ? partXfs(pdefs, null) : [];
  return L.mounts.map((m, i) => {
    const rp = pdefs.length ? mountOnPart(pdefs, rest, rest, i, m.x, m.y) : null;
    return { x: rp ? rp.x : m.x, y: rp ? rp.y : m.y, r: m.d * 0.5 };
  });
}

export function muzzlePos(design: Design, i: number, x: number, y: number, angle: number, aim: number): { x: number; y: number; d: number } {
  const L = layoutOf(design);
  const m = L.mounts[i];
  if (!m) return { x, y, d: 0.3 };
  const cs = Math.cos(angle), sn = Math.sin(angle);
  const ml = muzzleLen(m.mod ?? undefined) * m.d;
  return { x: x + cs * m.x - sn * m.y + Math.cos(aim) * ml, y: y + sn * m.x + cs * m.y + Math.sin(aim) * ml, d: m.d };
}
