// FieldView3D: three.js battlefield renderer implementing BattleView (see render/view.ts).
// Perspective camera (narrow FOV) looking down at ~60 degrees from the viewer's side of the board, so nearer units read
// bigger and you look out across the field at the enemy. Camera/CameraControls (render/camera.ts) keep the pan/zoom
// state: k = CSS px per cell at the view centre. worldToScreen/screenToWorld project through the real camera (exact
// picking); scaleAt gives the local ground scale for match.ts's 2D overlays (range rings).
// Scene axes: three x = field x (cells), three z = field y, three y = up (cells).
//
// Layers: terrain (proto3d buildTerrain, restyled per map) -> instanced units (units-adapter) -> effects (fx3d) -> post
// (AO / bloom / grade) -> screen-space overlay (health bars, paralysis meters, level pips; ui3d).

import * as THREE from 'three';
import { battleSfx, setPanFlip } from '../audio.ts';
import { DEPLOY_D, FIELD_H, FIELD_W } from '../../shared/grid.ts';
import { MODULE_BY_ID } from '../../shared/parts.ts';
import type { Battle } from '../../shared/sim/battle.ts';
import { DT, type BattleEvent, type DeathKind, type SimProjectile, type SimUnit, type WreckLevel } from '../../shared/sim/types.ts';
import type { ModuleDef, Side } from '../../shared/types.ts';
import { Camera, CameraControls } from '../render/camera.ts';
import type { BoardOverlay, BoardUnit } from '../render/field.ts';
import { MAPS, type MapTheme } from '../render/ground.ts';
import { drawnBore } from '../proto3d/weapons3d.ts';
import { TEAM_PAL } from '../render/palette.ts';
import { flyHeight } from '../render/tilt.ts';
import type { BattleView } from '../render/view.ts';
import { buildTerrain, createRenderer, setSurfaceDetail, setupPost, setupStage, type Post, type Stage } from './units-adapter.ts';
import { UnitLayer, teamHullRgb, templateKey, type Look, type Rig } from './units-adapter.ts';
import { Fx3D, RAMPS, SHELL_PAT, type MuzzleKind, type Ramp, type ShellLook, type TrailKind, type WispKind } from './fx3d.ts';
import { Overlay, ShieldPool, rgb } from './ui3d.ts';
import { UnitOutline } from './outline3d.ts';
import { SunShadow } from './shadow3d.ts';
import { CameraShake, setActiveShake } from './shake3d.ts';
import { ELEV, FOV, SUN, pitchAt } from './view3d.ts';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const GUN_H = 0.55;
/** shadow-map caster tiers (UnitLayer.setShadowTier): a unit casts a sun shadow when its tier (size, +1 flying, +1 tall)
 *  is at least the current minimum; smaller units keep only their soft contact blob */
const SHADOW_TIER = 2;
/** zoom (CSS px per cell) below which units switch to their low-detail build (fit views run ~8-25 px per cell; a 16-sided
 *  barrel is a few px across there) and above which they switch back (hysteresis) */
const LOD_FAR_K = 26;
const LOD_NEAR_K = 30;
/** mobility that does not touch the ground (no travel dust) */
const NO_DUST = new Set(['hover', 'gravlift', 'anchor', 'rotor', 'jet']);
const R2 = (a: number, b: number) => a + Math.random() * (b - a);
const normAng = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a: number, b: number, t: number) => a + normAng(b - a) * t;

interface Snap { x: number; y: number; angle: number; mounts: number[] }
interface PSnap { x: number; y: number; z: number; angle: number; progress: number }
/** per-unit presentation state */
interface UView {
  rig: Rig;
  lx: number; ly: number; seen: boolean;
  /** heading drawn last frame (gear animation: walkers step round while turning on the spot) */
  la?: number;
  dmgT: number; healT: number; hpLast: number; shLast: number; hpShown: number;
  shT: number; hx: number; hy: number; hz: number;
  /** last 4 shield-bubble hits (x, y, z, time) and the ring index, for the dome ripples */
  shHits?: number[]; shN?: number;
  hits: number;
  /** rig transforms are current (posed last frame); culled / hidden rigs keep stale muzzle positions */
  posed: boolean;
  /** damage smoke emitters (hull-local points + look), built on first damage */
  dmg?: DmgPt[];
  /** travel dust emission accumulator (heavy ground units) */
  dustAcc?: number;
}
/** a damage smoke emitter on a hull: hull-local offset (x fwd, z right, y up; turret: rides that mount's turret ring),
 *  what leaks out of it, and per-emitter variation (rate, size), so units don't all smoke alike */
interface DmgPt { x: number; y: number; z: number; mount: number; kind: WispKind; rate: number; size: number; order: number }
/** a burning aircraft falling out of the sky (the sim already removed it): flown by the view until it hits the ground */
interface Faller {
  rig: Rig; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  yaw: number; pitch: number; roll: number; wy: number; wp: number; wr: number;
  heli: boolean; S: number; lv: WreckLevel; kind: DeathKind; t: number; g: number; fire: number; paint?: [number, number, number];
}
/** rig null: the unit was blown to smithereens, only scorch, scattered scrap and smoke remain. smoke / fire: seconds of
 *  smoke and flames left; heat 0..1: ember glow of a melted (energy) or freshly blasted hull, cooling; char: how burnt
 *  the hull looks 0..1; seed: varies the soot pattern (units-adapter wreck look) */
interface Wreck {
  rig: Rig | null; x: number; z: number; smoke: number; S: number; fire: number; heat: number; char: number; seed: number; hx: number; hz: number; deck: number;
  /** wreck level, initial smoke seconds, hull heading (smoke comes out of holes / hatches / the engine deck) */
  lv: WreckLevel; smoke0: number; ang: number;
}
interface ProjRec {
  y0: number; lastH: number; px: number; py: number; bright: boolean; hEnd: number; air: boolean; st: WStyle; k: number; bomblet: boolean;
  /** bomblets: height their cargo shell split at (a hull's roof, else 0): they fall from there to their landing point */
  bh: number;
  /** smoothed 3D flight direction, the last trail emission point, launch time, wobble phase */
  dx: number; dy: number; dz: number; ex: number; ey: number; ez: number; born: number; seed: number;
  /** offset from the sim's launch point to the barrel / tube tip it left (eased out over the first few frames) */
  ox: number; oz: number;
  /** bright tracer round (every Nth round of a fast gun) and where the round started (streaks never reach behind it) */
  tracer: boolean; sx: number; sz: number; team: 0 | 1;
  /** one-shot path effect (sniper beam + smoke wake) already laid */
  laid?: boolean;
  /** sim position and progress when first seen (to estimate where a round ends: flash rounds race ahead of the sim) */
  fx0: number; fz0: number; k0: number;
  /** the round's module, side and sim kind (to match it to the 'explode' / 'hit' that ends it) */
  mod: string; side: Side; kind: SimProjectile['kind'];
  /** where the drawn round went into an enemy hull's hit box (it is no longer drawn from then on) */
  hit?: Impact;
  /** the impact point worked out for the event that ended it (null: it burst on the ground), shared by its explode / hit */
  imp?: Impact | null;
}

/** Rough hit box of a drawn unit (hullBox): a rotated box a little inside its solid parts and the sim's footprint.
 *  x, z: drawn centre; ca, sa: facing; cx, cz: box centre offset (unit-local, x forward); hx, hz: half extents; y0, y1: base
 *  and top heights (world). */
interface HullBox { x: number; z: number; ca: number; sa: number; cx: number; cz: number; hx: number; hz: number; y0: number; y1: number }
/** where a round struck a hull (world x, height y, world z), its travel direction on the ground (nx, nz) and the unit;
 *  top: it came down on the roof */
interface Impact { x: number; y: number; z: number; nx: number; nz: number; unit: number; top: boolean }
/** sim round kinds that burst on (or stop at) the first enemy hull they reach, as the sim's contact sweep has them */
const HULL_KINDS = new Set<SimProjectile['kind']>(['shell', 'rocket', 'missile', 'arc', 'orb']);
/** the sim's ROCKET_OVERFLY: a rocket lofted higher than this flies over ground units */
const ROCKET_OVERFLY = 1;
/** rayBox's answer: the line's entry and exit parameters and the axis it enters through (0 x, 1 y = roof / floor, 2 z) */
const RB = { t0: 0, t1: 0, ax: 0 };
/** Does the line p + d t meet the box? Fills RB (t over the whole line, so t0 < 0 when p is inside or past it). */
function rayBox(b: HullBox, px: number, py: number, pz: number, dx: number, dy: number, dz: number): boolean {
  const ox = px - b.x, oz = pz - b.z;
  const o = [ox * b.ca + oz * b.sa - b.cx, py, -ox * b.sa + oz * b.ca - b.cz];
  const d = [dx * b.ca + dz * b.sa, dy, -dx * b.sa + dz * b.ca];
  const lo = [-b.hx, b.y0, -b.hz], hi = [b.hx, b.y1, b.hz];
  let t0 = -Infinity, t1 = Infinity, ax = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) return false; continue; }
    let a = (lo[i] - o[i]) / d[i], c = (hi[i] - o[i]) / d[i];
    if (a > c) { const q = a; a = c; c = q; }
    if (a > t0) { t0 = a; ax = i; }
    if (c < t1) t1 = c;
    if (t0 > t1) return false;
  }
  RB.t0 = t0; RB.t1 = t1; RB.ax = ax;
  return true;
}
/** is the ground point (x, z) over the box's footprint, grown by pad? */
function inBox(b: HullBox, x: number, z: number, pad: number): boolean {
  const ox = x - b.x, oz = z - b.z;
  return Math.abs(ox * b.ca + oz * b.sa - b.cx) <= b.hx + pad && Math.abs(-ox * b.sa + oz * b.ca - b.cz) <= b.hz + pad;
}

/** straight round fired at an aircraft: the sim flies those at z = 1 (arcing shells and missiles have their own z) */
const airShot = (p: SimProjectile) => (p.kind === 'bullet' || p.kind === 'shell' || p.kind === 'rocket' || p.kind === 'orb' || p.kind === 'missile') && Math.abs(p.z - 1) < 1e-6;

/** beams / bolts: colour + width + life by module visual */
function beamStyle(moduleId: string): { color: string; w: number; life: number; wob: number } {
  const def = MODULE_BY_ID.get(moduleId), v = def?.visual;
  if (def?.disarm) return { color: '#ffb02a', w: 0.07, life: 0.26, wob: 0.15 }; // amber jamming beam
  if (def?.ramp) return { color: '#ff4a3a', w: 0.05, life: 0.15, wob: 0 }; // focusing twin laser: thin, fattens on target
  if (def?.lifesteal) return { color: '#ff2a5a', w: 0.09, life: 0.18, wob: 0.2 }; // leech: crimson
  if (def?.split) return { color: '#b8f4ff', w: 0.065, life: 0.18, wob: 0 }; // prism: thin cyan-white
  if (def?.pctHp) return { color: '#7a2aff', w: 0.22, life: 0.36, wob: 0.1 }; // void lance: fat violet
  if (def?.shred) return { color: '#c8e83a', w: 0.08, life: 0.16, wob: 0.3 }; // entropy: corrosive yellow-green
  if (v === 'gravity') return { color: '#9a5cff', w: 0.11, life: 0.18, wob: 0.45 };
  switch (v) {
    case 'laser': return { color: '#ff4a3a', w: 0.11, life: 0.3, wob: 0 };
    case 'heatray': return { color: '#ff8a2a', w: 0.14, life: 0.16, wob: 0.25 };
    case 'plasma': return { color: '#e070ff', w: 0.16, life: 0.18, wob: 0.2 };
    case 'tesla': case 'emp': return { color: '#9fc8ff', w: 0.06, life: 0.22, wob: 0 };
    case 'slowbeam': case 'sonic': return { color: '#5ec8ff', w: 0.1, life: 0.16, wob: 0.35 };
    case 'rail': case 'gauss': return { color: '#9fb8ff', w: 0.07, life: 0.24, wob: 0 };
    case 'repair': case 'nanite': return { color: '#7dff9a', w: 0.06, life: 0.14, wob: 0.2 };
    default: return { color: '#ffd890', w: 0.06, life: 0.14, wob: 0 };
  }
}

/** Weapon families for the effects: every weapon gets a readable signature (tracer / round, muzzle flash, impact). */
type Fam =
  | 'mg' | 'twinmg' | 'hmg' | 'gatling' | 'shotgun' | 'flechette' | 'ac' | 'apc' | 'he' | 'gauss' | 'sniper' | 'rail'
  | 'rocket' | 'incend' | 'missile' | 'bigMissile' | 'grenade' | 'mortar' | 'howitzer' | 'cluster' | 'firebomb' | 'bomb'
  | 'flak' | 'laser' | 'focus' | 'leech' | 'prism' | 'void' | 'entropy' | 'heatray' | 'plasma' | 'plasmaOrb' | 'empOrb' | 'sonic' | 'chain' | 'slow' | 'disarm'
  | 'gravity' | 'flame' | 'melee' | 'heal' | 'pd' | 'other';
interface WStyle {
  fam: Fam;
  /** effect size: ~0.25 light gun .. ~1.25 titan gun (mount class x calibre) */
  s: number;
  /** drawn round diameter (cells): ~0.75 x the bore of the barrel that fires it (7.62 mm ~0.015 .. 240 mm ~0.14) */
  rw: number;
  /** linear rgb of the round's glow: by family, with a subtle per-module shift so similar guns differ a little */
  tint: [number, number, number];
  def: ModuleDef | undefined;
  muzzle: MuzzleKind | null;
}
// effect size per weapon class in the same ratios as the drawn guns (proto3d DRAW_D 0.75 / 1.5 / 3 / 4.5): a titan
// gun's flash, round and blast are as big as the gun that fires them
const CLASS_S: Record<string, number> = { S: 0.3, M: 0.6, L: 1.2, XL: 1.8 };

function famOf(def: ModuleDef | undefined): Fam {
  if (!def) return 'other';
  if (def.pointDefense) return 'pd';
  if (def.heal) return 'heal';
  const v = def.visual, pk = def.projectile ?? 'bullet', pellets = def.pellets ?? 1;
  if (def.category === 'melee') return 'melee';
  if (def.fireField && pk === 'arc' && def.mount !== 'XL') return 'firebomb'; // the doomsday's burning craters keep its artillery look
  if (def.cluster) return 'cluster';
  switch (def.category) {
    case 'machinegun':
      if (def.spinUp || v === 'gatling') return 'gatling';
      if (pellets > 1) return def.pierce ? 'flechette' : 'shotgun';
      return def.slow ? 'twinmg' : (def.ap ?? 0) >= 0.4 ? 'hmg' : 'mg';
    case 'autocannon': return def.spinUp || v === 'gatling' ? 'gatling' : 'ac';
    case 'cannon': return v === 'gauss' ? 'gauss' : def.impulse && (def.splash ?? 0) >= 1 ? 'he' : 'apc';
    case 'precision': return pk === 'rail' ? 'rail' : 'sniper';
    case 'rocket': return def.burn ? 'incend' : 'rocket';
    case 'missile': return v === 'cruise' || (def.splash ?? 0) >= 2 ? 'bigMissile' : 'missile';
    case 'bomb': return 'bomb';
    case 'artillery': return v === 'mortar' ? (def.mount === 'S' ? 'grenade' : 'mortar') : 'howitzer';
    case 'antiair': return 'flak';
    case 'flame': return 'flame';
    default: break;
  }
  if (pk === 'orb') return v === 'emp' ? 'empOrb' : v === 'sonic' ? 'sonic' : 'plasmaOrb';
  if (pk === 'lightning') return 'chain';
  if (def.ramp) return 'focus';
  if (def.lifesteal) return 'leech';
  if (def.split) return 'prism';
  if (def.pctHp) return 'void';
  if (def.shred) return 'entropy';
  if (def.disarm) return 'disarm';
  if (def.slow || v === 'slowbeam') return 'slow';
  if (v === 'gravity') return 'gravity';
  if (v === 'heatray') return 'heatray';
  if (v === 'plasma') return 'plasma';
  if (v === 'rail' || v === 'gauss') return 'rail';
  if (pk === 'beam') return 'laser';
  return 'other';
}

const MUZZLE: Partial<Record<Fam, MuzzleKind>> = {
  mg: 'gun', twinmg: 'gun', hmg: 'gun', gatling: 'gatling', shotgun: 'blast', flechette: 'darts', ac: 'ac', apc: 'cannon', he: 'he',
  gauss: 'gauss', sniper: 'sniper', rocket: 'rocket', incend: 'rocket', missile: 'missile', bigMissile: 'missile', grenade: 'mortar',
  mortar: 'mortar', firebomb: 'mortar', howitzer: 'cannon', cluster: 'cannon', flak: 'flak', other: 'gun',
};

const STYLES = new Map<string, WStyle>();
function styleOf(id: string): WStyle {
  let st = STYLES.get(id);
  if (!st) {
    const def = MODULE_BY_ID.get(id);
    const fam = famOf(def);
    const s = (CLASS_S[def?.mount ?? 'M'] ?? 0.5) * (0.75 + 0.5 * (def?.caliber ?? 0.5));
    // the round is as wide as the drawn barrel it leaves (battlefield body scale ~0.78)
    const rw = def ? Math.max(0.012, 0.8 * drawnBore(def)) : 0.03;
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    const j = ((h % 1000) / 1000 - 0.5) * 0.12; // +-6% per module
    const base = ROUND_TINT[fam] ?? [1, 0.75, 0.4];
    st = { fam, s, rw, tint: [base[0], clamp(base[1] * (1 + j), 0, 1), clamp(base[2] * (1 - j), 0, 1)], def, muzzle: MUZZLE[fam] ?? null };
    STYLES.set(id, st);
  }
  return st;
}
/** Recoil per family: barrel kick (x the base), run-out rate (1/s), hull rock impulse (rad/s at s = 1) and whether
 *  the muzzle blast kicks up dust off the ground (heavy guns). */
const RECOIL: Partial<Record<Fam, [number, number, number, boolean]>> = {
  mg: [0.6, 14, 0, false], twinmg: [0.6, 14, 0, false], hmg: [0.8, 12, 0, false], gatling: [0.5, 14, 0, false],
  shotgun: [1, 10, 0, false], flechette: [1, 10, 0, false], ac: [1, 11, 0.05, false], flak: [1.2, 8, 0.15, false],
  apc: [2.1, 4, 0.55, true], he: [2.3, 3.6, 0.7, true], gauss: [1.4, 4, 0.45, false], sniper: [1.3, 6, 0.05, false],
  rail: [1.6, 3.5, 0.6, false], howitzer: [2.8, 2.4, 0.9, true], cluster: [2.6, 2.6, 0.85, true],
  mortar: [1.6, 5, 0.35, true], firebomb: [1.6, 5, 0.35, true], grenade: [1.2, 8, 0.1, false],
};
/** Warhead size of an explosive round (~0.2 20 mm HE .. 1.6 heavy bomb), for the impact blast on the hull it struck */
function warheadOf(def: ModuleDef | undefined): number {
  return clamp(Math.sqrt(Math.max(1, def?.damage ?? 50) / 100) * 0.5, 0.18, 1.6);
}
/** explosive families: their hits blow up on the hull */
const EXPLOSIVE = new Set<Fam>(['ac', 'apc', 'he', 'rocket', 'incend', 'missile', 'bigMissile', 'grenade', 'mortar', 'howitzer', 'cluster', 'bomb', 'flak', 'firebomb', 'plasmaOrb', 'empOrb']);
/** tracer every Nth round, by fire rate (fast guns: most rounds are dim ball ammo between the tracers) */
function tracerEvery(def: ModuleDef | undefined): number {
  const cd = def?.cooldown ?? 0.3, br = Math.max(1, def?.barrels ?? 1);
  const per = cd / (def?.spinUp ? 1 : Math.min(2, br)); // seconds between rounds
  return per <= 0.05 ? 6 : per <= 0.1 ? 5 : per <= 0.18 ? 4 : per <= 0.3 ? 3 : 1;
}
/** linear rgb of a round's glow by family: MGs warm yellow-orange, heavy MG paler amber, rotaries hot orange, the
 *  suppressor cold blue-white, autocannons whiter, the sniper white-blue. Enemy rounds burn a shade redder. */
const ROUND_TINT: Partial<Record<Fam, [number, number, number]>> = {
  mg: [1, 0.7, 0.3], hmg: [1, 0.8, 0.5], gatling: [1, 0.56, 0.22], twinmg: [0.72, 0.85, 1], shotgun: [1, 0.82, 0.52],
  flechette: [0.72, 0.88, 1], ac: [1, 0.88, 0.7], sniper: [0.86, 0.94, 1], apc: [1, 0.36, 0.16], he: [1, 0.5, 0.18],
  flak: [1, 0.62, 0.26], gauss: [0.45, 0.65, 1],
};
/** Big rounds' paint (linear rgb: body, band + scheme, base-tracer / hot-nose glow): every artillery, siege, bomb and
 *  rocket family gets its own colours on its own silhouette, so you can tell what's incoming. */
const look = (body: [number, number, number], band: [number, number, number], pat: number, glow: [number, number, number] = [0, 0, 0], heat = 0): ShellLook => ({ body, band, pat, glow, heat });
/** energy-ball halos tinted to the ball (the stock plasma ramp is near white-hot, which washed the balls out) */
const ORB_HALO: Record<'plasma' | 'siege' | 'emp', Ramp> = {
  plasma: [1.7, 0.3, 2.0, 0.85, 1.0, 0.12, 1.3, 0.6, 0.25, 0.02, 0.4, 0],
  siege: [0.35, 1.6, 2.0, 0.8, 0.12, 0.9, 1.3, 0.6, 0.02, 0.25, 0.45, 0],
  emp: [0.9, 1.5, 2.4, 0.8, 0.4, 0.8, 1.6, 0.6, 0.05, 0.2, 0.5, 0],
};
/** energy-ball colours (linear, HDR): EMP pale blue, plasma cannon magenta, siege projector cyan */
const ORB_COL = { emp: [0.45, 0.8, 1.7], plasma: [1.4, 0.2, 1.5], siege: [0.2, 1.25, 1.6] } as const;
const LOOK = {
  /** Long Tom 155 mm: olive drab, yellow hazard bands, a hot base tracer */
  longTom: look([0.13, 0.15, 0.07], [1, 0.7, 0.04], SHELL_PAT.rings, [2.4, 0.95, 0.25]),
  /** barrage: grey steel with bright copper-orange driving bands */
  barrage: look([0.4, 0.42, 0.46], [1.5, 0.5, 0.08], SHELL_PAT.driving, [1.8, 0.7, 0.2]),
  /** shock mortar: gunmetal finned bomb with a pulsing electric-blue band */
  shock: look([0.13, 0.15, 0.18], [0.3, 0.75, 2.4], SHELL_PAT.pulse),
  mortar: look([0.2, 0.23, 0.13], [0.95, 0.72, 0.08], SHELL_PAT.rings),
  /** firebomb: a casing already alight, flickering orange-red */
  fire: look([0.3, 0.05, 0.02], [2.4, 0.8, 0.12], SHELL_PAT.molten, [2.6, 0.9, 0.2]),
  /** cluster cargo shell: dull grey canister, yellow bands */
  cluster: look([0.24, 0.25, 0.22], [1, 0.78, 0.08], SHELL_PAT.rings, [1.6, 0.6, 0.15]),
  /** 240 mm siege / doomsday: black with yellow hazard stripes and a heat-glow nose */
  siege: look([0.03, 0.03, 0.03], [1, 0.76, 0.03], SHELL_PAT.hazard, [2.6, 0.75, 0.12], 0.75),
  doom: look([0.025, 0.025, 0.025], [1, 0.68, 0.02], SHELL_PAT.hazard, [3.2, 0.9, 0.15], 1),
  /** tactical nuke: white warhead, radiation-yellow band with a black trefoil, yellow fins */
  nuke: look([0.9, 0.9, 0.84], [1, 0.8, 0.04], SHELL_PAT.rad),
  cruise: look([0.62, 0.64, 0.66], [0.75, 0.1, 0.06], SHELL_PAT.rings),
  /** rockets: olive with a yellow band; MLRS dark grey with red; incendiary flickering red-orange */
  rocket: look([0.3, 0.33, 0.2], [0.95, 0.72, 0.1], SHELL_PAT.rings),
  mlrs: look([0.18, 0.2, 0.19], [0.85, 0.1, 0.05], SHELL_PAT.rings),
  incend: look([0.4, 0.08, 0.03], [2, 0.6, 0.1], SHELL_PAT.molten),
  /** aerial bombs: olive iron bomb with yellow nose bands and fins; blockbuster black-and-yellow; stun / EMP pale blue */
  bomb: look([0.2, 0.23, 0.13], [0.95, 0.75, 0.1], SHELL_PAT.rings),
  bigBomb: look([0.05, 0.05, 0.05], [1, 0.74, 0.04], SHELL_PAT.hazard),
  stunBomb: look([0.5, 0.6, 0.72], [0.45, 0.95, 2.6], SHELL_PAT.pulse),
} as const;

/** families whose rounds are drawn as near-instant flashes: a thin bright line that sweeps a chunk of the path to the
 *  target in a frame or three and is gone (real bullets are far too fast to watch fly; the hit lands on the sim's time) */
const FLASH = new Set<Fam>(['mg', 'hmg', 'gatling', 'twinmg', 'sniper']);
/** seconds a flash round's head takes from the muzzle to the target */
const FLASH_T = 0.05;

/** families whose beam / bolt event draws its own impact (their 'hit' only flares a shield) */
const SELF_IMPACT = new Set<Fam>(['laser', 'focus', 'leech', 'prism', 'void', 'entropy', 'heatray', 'slow', 'disarm', 'gravity', 'heal', 'pd', 'rail']);

const _v3 = new THREE.Vector3();
const CORNERS: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
/** shake per blast radius by explosion family (others 1): small-arms pops barely, flak bursts in the air, HE hits hard */
const BLAST_SHAKE: Partial<Record<Fam, number>> = {
  mg: 0.15, hmg: 0.15, gatling: 0.15, ac: 0.15, twinmg: 0.15, shotgun: 0.15, sniper: 0.15, apc: 0.15, grenade: 0.3, firebomb: 0.3, pd: 0,
  he: 1.25, flak: 0.35, empOrb: 0.6, chain: 0.6, sonic: 0.8, cluster: 0.75, melee: 0.4,
};
const _col = new THREE.Color();
const _c2 = new THREE.Color();

/** Terrain generation is a ~1 s CPU job (fbm per pixel), so built maps are cached and shared across views (menu backdrop, match, ...). */
interface BuiltTerrain { group: THREE.Group; ground: THREE.Mesh; tint: THREE.Color }
const terrainCache = new Map<string, BuiltTerrain>();
function terrainFor(map: MapTheme): BuiltTerrain {
  let t = terrainCache.get(map.id);
  if (t) { terrainCache.delete(map.id); terrainCache.set(map.id, t); return t; }
  // no baked cell grid: the board reads as a place during battle; the placement grid is an overlay shown while deploying
  const b = buildTerrain(FIELD_H, FIELD_W, { seed: map.seed * 13 + 5, ppc: 14, grid: false, zoneFrac: DEPLOY_D / FIELD_H, props: false });
  // restyle per map: multiply the sandy base by the 2D theme's mid ramp colour (relative to the base's own tone)
  const c1 = new THREE.Color().setRGB(map.ramp[1][0] / 255, map.ramp[1][1] / 255, map.ramp[1][2] / 255, THREE.SRGBColorSpace);
  const ref = new THREE.Color().setRGB(120 / 255, 108 / 255, 84 / 255, THREE.SRGBColorSpace);
  const tint = new THREE.Color(clamp(c1.r / ref.r, 0.35, 2), clamp(c1.g / ref.g, 0.35, 2), clamp(c1.b / ref.b, 0.35, 2));
  b.group.children.forEach((o, i) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m?.color) m.color.copy(tint).multiplyScalar(i === 0 ? 1 : 0.8);
  });
  t = { group: b.group, ground: b.ground, tint };
  terrainCache.set(map.id, t);
  // keep the two most recent maps; older ones free their textures
  while (terrainCache.size > 2) {
    const [k, old] = terrainCache.entries().next().value as [string, BuiltTerrain];
    terrainCache.delete(k);
    old.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.MeshStandardMaterial | undefined;
      if (mat) { mat.map?.dispose(); mat.bumpMap?.dispose(); mat.dispose(); }
    });
  }
  return t;
}

export class FieldView3D implements BattleView {
  readonly canvas: HTMLCanvasElement;
  viewerSide: Side;
  muted = false;
  shakeScale = 1;
  flashScale = 1;
  /** camera shake: `view.shake.add(x, z, power)`, or shakeAt() from shake3d.ts while this view draws */
  readonly shake = new CameraShake();
  /** this view can draw a turned field (Camera.yaw): screens enable right-drag orbit for it */
  readonly canRotate = true;
  /** sun shadow maps (off = soft contact blobs only); the quality level can still drop them */
  private shadowsOn = true;
  setShadows(on: boolean): void { this.shadowsOn = on; }
  private sunShadow: SunShadow;
  private shadowTier = SHADOW_TIER;
  /** visible-region probe for the shadow fit (world x,y,z triplets) */
  private shadowPts = new Float32Array(8 * 3);
  alwaysShowHealth = false;
  readonly cam = new Camera(FIELD_W, FIELD_H);
  readonly controls: CameraControls;
  private tiltOn = true;
  private cssW = 300;
  private cssH = 400;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 1, 2000);
  /** camera state the perspective camera was last placed for (cx, cy, k, w, h, tilt, side, yaw); NaN = re-place */
  private camAt = [NaN, 0, 0, 0, 0, 0, 0, 0];
  private readonly v3 = new THREE.Vector3();
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private stage: Stage;
  private sun: THREE.DirectionalLight;
  private post: Post;
  /** dark contact edge around unit silhouettes (post pass fed by a unit coverage mask) */
  private outline = new UnitOutline();
  private map: MapTheme = MAPS[0];
  private terrain: { group: THREE.Group; ground: THREE.Mesh } | null = null;
  private rocks: THREE.Object3D[] = [];
  private myZone: THREE.Mesh;
  private foeZone: THREE.Mesh;
  private grid: THREE.LineSegments;
  private hoverFill: THREE.Mesh;
  private hoverLine: THREE.LineLoop;
  private selLines: THREE.LineLoop[] = [];
  private layer = new UnitLayer();
  private fx = new Fx3D();
  private shields = new ShieldPool();
  private ui = new Overlay();
  private fxRoot = new THREE.Group();
  // live instances
  private deployUsed: Rig[] = [];
  private bu = new Map<number, UView>();
  private wrecks: Wreck[] = [];
  // battle state
  private battle: Battle | null = null;
  private lastTick = -1;
  private sinceTick = 0;
  /** render clock (in ticks), same scheme as the 2D view: advances at the observed tick rate, eased toward one tick
   *  behind the estimated sim time and clamped to the snapshot pair it interpolates (prevTick..curTick), so units move
   *  by the same amount every frame at any speed and uneven ticks per frame don't judder */
  private rt = 0;
  private tickRate = 1 / DT;
  private prevTick = 0;
  private curTick = 0;
  private rateWin = { n: 0, t: 0 };
  private alpha = 1;
  private prevU = new Map<number, Snap>();
  private curU = new Map<number, Snap>();
  private prevP = new Map<number, PSnap>();
  private curP = new Map<number, PSnap>();
  private projRec = new Map<number, ProjRec>();
  /** this frame's hull hit boxes by unit id (null: not drawn) */
  private boxes = new Map<number, HullBox | null>();
  private pending: BattleEvent[] = [];
  private usePush = false;
  private time = 0;
  private altHeld = false;
  private hitBudget = 0;
  /** where the beam / arc that just struck a unit came from, and the last blast (this event batch): hits the sim reports
   *  at a unit's centre (beams, arcs, splash) are moved out to the side facing them */
  private shotFrom = new Map<number, { x: number; y: number }>();
  private lastBlast: { x: number; y: number; r: number } | null = null;
  /** rotary guns (ModuleDef.spinUp): spin estimate per unit * 16 + mount, rebuilt from the fire cadence */
  private spin = new Map<number, { k: number; t: number }>();
  /** focusing beams (ModuleDef.ramp): time on the current target per unit * 16 + mount */
  private ramp = new Map<number, { start: number; last: number; x: number; y: number }>();
  /** where cluster shells just burst (their bomblets are drawn as bomblets) */
  private clusterPts: { x: number; y: number; t: number; h: number }[] = [];
  /** aircraft going down in flames */
  private fallers: Faller[] = [];
  /** per unit * 16 + mount: the barrel the last shot left (rounds / beams start at that tip) and rounds fired (tracer count) */
  private lastBarrel = new Map<number, number>();
  private shotN = new Map<number, number>();
  /** damage-smoke emission scale this frame (crowded battles thin it out) */
  private dmgK = 1;
  // quality
  /** 'auto' scales AO / bloom / shadows / resolution from frame time; a number pins the level (0 best) */
  quality: 'auto' | 0 | 1 | 2 | 3 = 'auto';
  /** textured unit surfaces (plate seams, wear, grime); the lowest quality level drops them too */
  unitTextures = true;
  setUnitTextures(on: boolean): void { this.unitTextures = on; }
  private level = 0;
  private ema = 16;
  private lastRender = 0;
  private slowT = 0;
  private fastT = 0;
  private dprNow = 1;
  private lastUnits = 0;
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private onBlur: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, viewerSide: Side, opts?: { interactive?: boolean }) {
    this.canvas = canvas;
    this.viewerSide = viewerSide;
    const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('r3dq');
    if (q === 'high') this.quality = 0; else if (q === 'low') this.quality = 3; else if (q && /^[0-3]$/.test(q)) this.quality = Number(q) as 0 | 1 | 2 | 3;
    this.renderer = createRenderer(canvas);
    this.renderer.info.autoReset = false;
    this.dprNow = this.dprFor(0);
    this.renderer.setPixelRatio(this.dprNow);
    this.controls = new CameraControls(this.cam, canvas, opts?.interactive !== false);
    this.cam.setAspect(this.ay);
    this.cam.ayFn = (z) => Math.sin(pitchAt(z));
    try { setPanFlip(viewerSide === 1); } catch { /* audio optional */ }

    // sun up-left and a little BEHIND the field as the viewer sees it: lit tops and left flanks, darker faces toward the
    // camera, glints on the painted plates, shadows falling toward the viewer's lower right
    const ss = viewerSide === 1 ? -1 : 1;
    this.stage = setupStage(this.renderer, this.scene, { fog: true, shadowRes: 2048, sun: [-ss * SUN[0], SUN[1], ss * SUN[2]] });
    this.sun = this.stage.sun;
    this.outline.sun = this.sun;
    // one shadow map, fitted every frame to the ground in view (shadow3d.ts); the light itself stays put in the world
    this.sunShadow = new SunShadow(this.sun, [-ss * SUN[0], SUN[1], ss * SUN[2]], [FIELD_W / 2, 0, FIELD_H / 2]);
    // the shadow map is drawn once per frame (render() asks for it): the AO / outline passes re-render the scene and
    // must not redraw it each time
    this.renderer.shadowMap.autoUpdate = false;
    this.post = setupPost(this.renderer, this.scene, this.camera, 512, 512, { ao: true, bloom: true, grade: true });
    this.outline.install(this.post.composer.passes, (p, i) => this.post.composer.insertPass(p, i));
    // AO must not treat billboards / beams / bubbles as geometry: hide the fx root during its normal pass
    const g = this.post.gtao as unknown as { _overrideVisibility?: () => void; _visibilityCache?: THREE.Object3D[] } | null;
    if (g && typeof g._overrideVisibility === 'function' && Array.isArray(g._visibilityCache)) {
      const orig = g._overrideVisibility.bind(g);
      g._overrideVisibility = () => {
        orig();
        if (this.fxRoot.visible) { this.fxRoot.visible = false; g._visibilityCache!.push(this.fxRoot); }
      };
    }

    const flat = (w: number, h: number, color: string, opacity: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.renderOrder = 2;
      return m;
    };
    const myTop = viewerSide === 0 ? FIELD_H - DEPLOY_D : 0;
    const enTop = viewerSide === 0 ? 0 : FIELD_H - DEPLOY_D;
    this.myZone = flat(FIELD_W, DEPLOY_D, TEAM_PAL[0].rim, 0);
    this.myZone.position.set(FIELD_W / 2, 0.03, myTop + DEPLOY_D / 2);
    this.foeZone = flat(FIELD_W, DEPLOY_D, TEAM_PAL[1].rim, 0.0);
    this.foeZone.position.set(FIELD_W / 2, 0.03, enTop + DEPLOY_D / 2);
    this.scene.add(this.myZone, this.foeZone);
    // zone front lines
    const line = (z: number, color: string) => {
      const l = flat(FIELD_W, 0.12, color, 0.6);
      l.position.set(FIELD_W / 2, 0.04, z);
      this.scene.add(l);
    };
    line(viewerSide === 0 ? myTop : myTop + DEPLOY_D, TEAM_PAL[0].rim);
    line(viewerSide === 0 ? enTop + DEPLOY_D : enTop, TEAM_PAL[1].rim);
    // placement grid over the viewer's zone
    const pts: number[] = [];
    for (let x = 0; x <= FIELD_W; x++) pts.push(x, 0.05, myTop, x, 0.05, myTop + DEPLOY_D);
    for (let y = 0; y <= DEPLOY_D; y++) pts.push(0, 0.05, myTop + y, FIELD_W, 0.05, myTop + y);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: TEAM_PAL[0].accent, transparent: true, opacity: 0.2, depthWrite: false }));
    this.grid.visible = false;
    this.scene.add(this.grid);
    this.hoverFill = flat(1, 1, '#46e88a', 0.3);
    this.hoverFill.visible = false;
    this.hoverLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, z]) => new THREE.Vector3(x, 0.06, z))), new THREE.LineBasicMaterial({ color: '#46e88a', depthTest: false, transparent: true }));
    // a block's footprint is about the size of its hull: draw the outline over the models or it hides under them
    this.hoverLine.renderOrder = 3;
    this.hoverLine.visible = false;
    this.scene.add(this.hoverFill, this.hoverLine);

    this.fxRoot.add(this.fx.group, this.shields.group);
    this.scene.add(this.layer.group, this.fxRoot);

    this.setMapNow(this.map);
    this.resize();

    // Alt shows every health bar (same as the 2D view)
    if (typeof window !== 'undefined') {
      this.onKey = (e) => { if (e.key === 'Alt') { this.altHeld = e.type === 'keydown' && this.controls.enabled; if (e.type === 'keydown') e.preventDefault(); } };
      this.onBlur = () => { this.altHeld = false; };
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('keyup', this.onKey);
      window.addEventListener('blur', this.onBlur);
    }
  }

  /* ------------------------------------------------------------------------------------------ settings */

  /** ground foreshortening at the fit view (the Camera's base aspect) */
  get ay(): number { return this.tiltOn ? Math.sin(ELEV) : 1; }
  /** ground foreshortening at the current zoom (the pitch eases lower as you zoom in) */
  private get ayNow(): number { return this.cam.ayAt(this.cam.k); }
  get tilted(): boolean { return this.tiltOn; }
  setTilt(on: boolean): void {
    if (on === this.tiltOn) return;
    this.tiltOn = on;
    this.cam.ayFn = on ? (z) => Math.sin(pitchAt(z)) : null;
    this.cam.setAspect(this.ay);
  }
  get mapTheme(): MapTheme { return this.map; }
  setMap(map: MapTheme): void {
    if (map.id !== this.map.id) this.setMapNow(map);
  }

  /** Terrain from proto3d, restyled per map: seed + a colour tint from the 2D theme ramp, map void as the background. */
  private setMapNow(map: MapTheme): void {
    this.map = map;
    if (this.terrain) this.scene.remove(this.terrain.group);
    // (both rock meshes share one geometry and material; InstancedMesh.dispose frees the instance buffers)
    for (const r of this.rocks) { const im = r as THREE.InstancedMesh; this.scene.remove(im); im.geometry.dispose(); (im.material as THREE.Material).dispose(); im.dispose(); }
    this.rocks = [];
    const built = terrainFor(map);
    // the cached build is shared between views (textures live as long as the cache entry): each view gets a cheap clone
    const group = built.group.clone(true);
    // terrain is authored with deployment zones at its local +-x ends; our zones run along field y, so turn it a quarter
    // and put team 0 (the viewer's colour) at the viewer's end.
    group.rotation.y = this.viewerSide === 0 ? Math.PI / 2 : -Math.PI / 2;
    group.position.set(FIELD_W / 2, 0, FIELD_H / 2);
    this.scene.add(group);
    this.terrain = { group, ground: built.ground };
    this.scatterRocks(map, built.tint);
    // atmospheric haze: distance fog toward a light sky-tinted version of the map's void colour (also the background)
    const haze = new THREE.Color(map.void).lerp(new THREE.Color('#a7b6c4'), 0.5);
    this.scene.background = haze;
    if (this.scene.fog) (this.scene.fog as THREE.Fog).color.copy(haze);
    this.fx.setGround([clamp(map.ramp[1][0] / 255 * 0.9, 0, 1), clamp(map.ramp[1][1] / 255 * 0.9, 0, 1), clamp(map.ramp[1][2] / 255 * 0.9, 0, 1)]);
  }

  /** boulders around the field edge and pebbles on it (cheap instanced noise-icosahedra; tinted from the map) */
  private scatterRocks(map: MapTheme, tint: THREE.Color): void {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const pos = geo.getAttribute('position');
    const seen = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) {
      const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      let j = seen.get(k);
      if (j === undefined) { j = 0.78 + Math.random() * 0.4; seen.set(k, j); }
      pos.setXYZ(i, pos.getX(i) * j, pos.getY(i) * j * 0.7, pos.getZ(i) * j);
    }
    geo.computeVertexNormals();
    let s = map.seed * 7919 + 3;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0, envMapIntensity: 0.7 });
    const base = new THREE.Color().setRGB(map.ramp[2][0] / 255, map.ramp[2][1] / 255, map.ramp[2][2] / 255, THREE.SRGBColorSpace).multiplyScalar(0.55);
    void tint;
    const mk = (n: number, place: (m: THREE.Matrix4) => boolean, cast: boolean): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(geo, mat, n);
      const m = new THREE.Matrix4(), col = new THREE.Color();
      let k = 0;
      for (let i = 0; i < n; i++) if (place(m)) { im.setMatrixAt(k, m); im.setColorAt(k, col.copy(base).multiplyScalar(0.7 + rnd() * 0.6)); k++; }
      im.count = k; im.castShadow = cast; im.receiveShadow = true;
      this.scene.add(im);
      this.rocks.push(im);
      return im;
    };
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    mk(70, (m) => {
      // ring just outside the field
      const side = rnd();
      let x: number, z: number;
      if (side < 0.5) { x = rnd() < 0.5 ? -1 - rnd() * 14 : FIELD_W + 1 + rnd() * 14; z = rnd() * FIELD_H; }
      else { x = rnd() * FIELD_W; z = rnd() < 0.5 ? -1 - rnd() * 14 : FIELD_H + 1 + rnd() * 14; }
      const sc = 0.25 + rnd() * rnd() * 1.6;
      e.set(rnd() * 0.4, rnd() * 7, rnd() * 0.4); q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, sc * 0.2, z), q, new THREE.Vector3(sc * (1 + rnd() * 0.6), sc * (0.8 + rnd() * 0.5), sc * (1 + rnd() * 0.6)));
      return true;
    }, true);
    mk(380, (m) => {
      const x = rnd() * FIELD_W, z = rnd() * FIELD_H, sc = 0.03 + rnd() * 0.07;
      e.set(0, rnd() * 7, 0); q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, sc * 0.15, z), q, new THREE.Vector3(sc * (1 + rnd()), sc, sc * (1 + rnd())));
      return true;
    }, false);
  }

  /* ---------------------------------------------------------------------------------------------- camera */

  private dprFor(level: number): number {
    const d = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    return Math.min(level >= 2 ? 1 : 1.5, d);
  }

  resize(): void {
    const cw = this.canvas.clientWidth || 300, ch = this.canvas.clientHeight || 400;
    this.cssW = cw; this.cssH = ch;
    this.renderer.setPixelRatio(this.dprNow);
    this.renderer.setSize(cw, ch, false);
    this.post.setSize(cw, ch);
    this.cam.setViewport(cw, ch);
  }
  private checkSize(): void {
    if ((this.canvas.clientWidth && this.canvas.clientWidth !== this.cssW) || (this.canvas.clientHeight && this.canvas.clientHeight !== this.cssH)) this.resize();
  }
  private toVisual(x: number, y: number) { return this.viewerSide === 1 ? { x: FIELD_W - x, y: FIELD_H - y } : { x, y }; }
  fit(instant = false): void { this.cam.fit(instant); }
  frameDeploy(instant = false): void {
    this.checkSize();
    const c = this.cam;
    c.tyaw = 0; // deploying is done on the unturned board
    if (instant) c.yaw = 0;
    const rows = DEPLOY_D + 6;
    let k = Math.min(c.vw / FIELD_W, c.vh / (rows * c.ay));
    for (let i = 0; i < 3; i++) k = Math.min(c.vw / FIELD_W, c.vh / (rows * c.ayAt(k)));
    if (c.vw < 640) k = Math.max(k, 11);
    k = Math.max(c.minK, k);
    c.setTarget(FIELD_W / 2, FIELD_H - c.vh / (2 * k * c.ayAt(k)) + 0.4, k, instant);
  }
  focusOn(x: number, y: number, zoom?: number, instant = false): void {
    const v = this.toVisual(x, y);
    this.cam.setTarget(v.x, v.y, zoom === undefined ? this.cam.tk : this.cam.minK * zoom, instant);
  }
  zoomBy(f: number, sx?: number, sy?: number): void { this.cam.zoomBy(f, sx, sy); }
  consumeDrag(): boolean { return this.controls.consumeDrag(); }
  get wasDrag(): boolean { return this.controls.wasDrag; }

  private get ox(): number { return this.cssW / 2 - this.cam.cx * this.cam.k; }
  private get oy(): number { return this.cssH / 2 - this.cam.cy * this.cam.k * this.ayNow; }
  worldToScreen(x: number, y: number): { x: number; y: number } {
    this.placeCamera();
    const v = this.v3.set(x, 0, y).project(this.camera);
    return { x: (v.x + 1) * 0.5 * this.cssW, y: (1 - v.y) * 0.5 * this.cssH };
  }
  screenToWorld(px: number, py: number): { x: number; y: number } {
    this.placeCamera();
    this.ndc.set((px / Math.max(1, this.cssW)) * 2 - 1, 1 - (py / Math.max(1, this.cssH)) * 2);
    this.ray.setFromCamera(this.ndc, this.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    const t = Math.abs(d.y) > 1e-6 ? -o.y / d.y : 0;
    return { x: o.x + d.x * t, y: o.z + d.z * t };
  }
  scaleAt(x: number, y: number): { k: number; ay: number } {
    const a = this.worldToScreen(x, y), b = this.worldToScreen(x + 1, y), c = this.worldToScreen(x, y + 1);
    const k = Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y));
    return { k, ay: Math.hypot(c.x - a.x, c.y - a.y) / k };
  }
  centerOn(x: number, y: number): void { const v = this.toVisual(x, y); this.cam.centerOn(v.x, v.y); }
  frameWorldBox(x0: number, y0: number, x1: number, y1: number): void {
    const a = this.toVisual(x0, y0), b = this.toVisual(x1, y1);
    this.cam.frameBox(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
  }
  /** Position the perspective camera from the Camera state (no shake): looking at the view centre from the
   *  viewer's side at ELEV, at the distance where one cell spans k CSS px across the centre. Cached per state. */
  private placeCamera(): void {
    const c = this.cam, k = c.k;
    const a = this.camAt, tilt = this.tiltOn ? 1 : 0;
    if (a[0] === c.cx && a[1] === c.cy && a[2] === k && a[3] === this.cssW && a[4] === this.cssH && a[5] === tilt && a[6] === this.viewerSide && a[7] === c.yaw) return;
    a[0] = c.cx; a[1] = c.cy; a[2] = k; a[3] = this.cssW; a[4] = this.cssH; a[5] = tilt; a[6] = this.viewerSide; a[7] = c.yaw;
    const t = this.toVisual(c.cx, c.cy); // symmetric: visual centre -> world centre
    const e = this.tiltOn ? pitchAt(k / c.minK) : Math.PI / 2 - 1e-3;
    const s = this.viewerSide === 1 ? -1 : 1;
    const D = this.cssH / (2 * k * Math.tan((FOV * Math.PI) / 360));
    this.camera.aspect = this.cssW / Math.max(1, this.cssH);
    this.camera.near = Math.max(0.5, D * 0.05);
    this.camera.far = D * 4 + 300;
    // turned view (Camera.yaw): the camera orbits the look-at point; screen down is the visual (-sin, cos) direction,
    // which the side-1 flip turns into s * that in the world
    const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    this.camera.position.set(t.x - s * sy * D * Math.cos(e), D * Math.sin(e), t.y + s * cy * D * Math.cos(e));
    this.camera.up.set(s * sy, 0, -s * cy);
    this.camera.lookAt(t.x, 0, t.y);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** photosensitivity-safe shake (shake3d.ts): nothing at the fit view, strongest zoomed in, hard-capped (CSS px) */
  private shakeOffset(): { sx: number; sy: number } {
    this.shake.scale = this.shakeScale;
    return this.shake.offset(this.time);
  }

  /** Camera shake for the booms in this frame's events: located, sized by the blast (see shake3d.ts). Kept apart from
   *  the effects so the effect code stays free to change. */
  private shakeFor(e: BattleEvent): void {
    const sh = this.shake;
    switch (e.t) {
      case 'fire': {
        // the biggest guns kick the camera a little where they fire
        const def = MODULE_BY_ID.get(e.moduleId);
        if ((def?.mount === 'XL' || def?.mount === 'L') && (def.category === 'cannon' || def.category === 'artillery')) sh.add(e.x, e.y, def.mount === 'XL' ? 1.1 : 0.45);
        break;
      }
      case 'beam': {
        const st = styleOf(e.moduleId);
        if (st.fam === 'rail') sh.add(e.x2, e.y2, st.def?.mount === 'XL' ? 3.2 : 0.4 + st.s * 0.8);
        break;
      }
      case 'explode': {
        const st = styleOf(e.moduleId), r = Math.max(0.3, e.radius);
        sh.add(e.x, e.y, r * (BLAST_SHAKE[st.fam] ?? 1) * (st.fam === 'cluster' && e.radius < 1.1 ? 0.55 : 1) * (e.air ? 0.5 : 1));
        break;
      }
      case 'death': {
        const lv = e.wreck, sz = e.size * (e.flying ? 0.7 : 1);
        sh.add(e.x, e.y, lv === 0 ? 0.3 + sz * 0.3 : sz * (0.55 + 0.3 * lv));
        // the giant hulls' delayed cook-off (fx bigExplosion) lands a second jolt
        if (lv > 0 && e.size >= 4 && !e.flying) sh.add(e.x, e.y, sz * 0.9, 0.25 + Math.min(8, (sz + (lv - 1) * 0.6 - 1) * 2) * 0.17);
        break;
      }
    }
  }

  /** place the three camera + sun shadow frustum from the Camera state */
  private syncCamera(): void {
    const c = this.cam, k = c.k;
    const t = this.toVisual(c.cx, c.cy);
    const sh = this.shakeOffset();
    this.camAt[0] = NaN; // re-place (a previous frame's shake moved the camera)
    this.placeCamera();
    this.fitShadow(); // to the steady view, before any shake
    if (sh.sx || sh.sy) {
      this.camAt[0] = NaN; // shaken: the next mapping call re-places it
      const me = this.camera.matrixWorld.elements;
      this.camera.position.x += (me[0] * sh.sx + me[4] * sh.sy) / k;
      this.camera.position.y += (me[1] * sh.sx + me[5] * sh.sy) / k;
      this.camera.position.z += (me[2] * sh.sx + me[6] * sh.sy) / k;
      this.camera.updateMatrixWorld();
    }
    // haze scales with the camera distance: the far side of the view fades a little, more as the pitch drops
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog) {
      const D = this.cssH / (2 * k * Math.tan((FOV * Math.PI) / 360));
      fog.near = D * 0.8; fog.far = D * 3.2;
    }
    const hw = this.cssW / (2 * k), hh = this.cssH / (2 * k * this.ayNow);
    this.shake.setView(t.x, t.y, Math.hypot(hw, hh), k / c.minK);
  }

  /** Fit the sun's shadow map to what the (unshaken) camera sees: the ground and the unit tops standing on it, taken
   *  where the four screen corners' rays meet the planes y = 0 and y = 2.2, kept to the field and its rim. */
  private fitShadow(): void {
    const cam = this.camera;
    const pts = this.shadowPts;
    let n = 0;
    for (const [px, py] of CORNERS) {
      this.ndc.set(px, py);
      this.ray.setFromCamera(this.ndc, cam);
      const o = this.ray.ray.origin, d = this.ray.ray.direction;
      for (const h of [0, 2.2]) {
        // rays above the horizon (never at these pitches) stop at the far haze
        const t = d.y < -1e-3 ? Math.min((h - o.y) / d.y, cam.far) : cam.far;
        pts[n++] = clamp(o.x + d.x * t, -20, FIELD_W + 20);
        pts[n++] = h;
        pts[n++] = clamp(o.z + d.z * t, -20, FIELD_H + 20);
      }
    }
    this.sunShadow.fit(pts);
  }

  /* ------------------------------------------------------------------------------------------ quality / render */

  /** Frame-time driven level: 0 = AO + bloom + shadows (a 4096 map where the GPU takes it), 1 = no AO, 2 = no bloom +
   *  1x pixels + only the bigger units cast, 3 = no shadow maps (contact blobs only) + direct render. */
  private updateQuality(units: number, load: number): { ao: boolean; bloom: boolean; shadow: boolean; direct: boolean } {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dtMs = this.lastRender ? now - this.lastRender : 16;
    this.lastRender = now;
    // gaps over a second are stalls / background tabs; anything shorter is a real (maybe very slow) frame and must count,
    // or a GPU that only manages a few fps would never step the quality down
    if (dtMs < 1000) this.ema += (Math.min(dtMs, 150) - this.ema) * 0.08;
    if (this.quality === 'auto') {
      if (this.ema > 26) { this.slowT += dtMs; this.fastT = 0; } else if (this.ema < 15) { this.fastT += dtMs; this.slowT = 0; } else { this.slowT = this.fastT = 0; }
      if (this.slowT > 1500 && this.level < 3) { this.level++; this.slowT = 0; this.ema = 16; }
      else if (this.fastT > 9000 && this.level > 0) { this.level--; this.fastT = 0; }
    } else this.level = this.quality;
    const L = this.level;
    setSurfaceDetail(this.unitTextures && L < 3);
    const dpr = this.dprFor(L);
    if (dpr !== this.dprNow) { this.dprNow = dpr; this.resize(); }
    // AO only pays off when zoomed in and the scene is light
    const aoZoom = this.cam.k >= 9;
    const ao = L === 0 && aoZoom && load <= 120;
    this.fx.lod = L >= 2 ? 0.5 : units > 160 ? 0.6 : 1;
    // shadow casters: small units only ever get their contact blob; level 2 and very crowded zoomed-out views keep
    // shadows for the bigger hulls and aircraft only (casters cost the shadow pass their triangles). Wrecks are full
    // hulls too, so they count toward the crowding. The map itself stays on (switching it off recompiles every
    // material: a hitch mid-battle) until level 3.
    const shadow = this.shadowsOn && L <= 2;
    const wide = this.cam.k < 12;
    this.shadowTier = SHADOW_TIER + (L >= 2 ? 1 : 0) + (wide && load > 250 ? 1 : 0) + (wide && load > 420 ? 1 : 0);
    this.layer.setShadowTier(shadow ? this.shadowTier : Infinity);
    this.sunShadow.setMapSize(L === 0 && this.bigShadowOk() ? 4096 : 2048);
    return { ao, bloom: L <= 1, shadow, direct: L >= 3 };
  }

  private bigShadowOk(): boolean {
    try { return this.renderer.capabilities.maxTextureSize >= 8192; } catch { return false; }
  }

  /** units drawn with their far-view (low-detail) geometry: on below LOD_FAR_K px per cell, off again above LOD_NEAR_K */
  private lodFar = false;
  private render(units: number): void {
    this.lastUnits = units;
    this.lodFar = this.cam.k < (this.lodFar ? LOD_NEAR_K : LOD_FAR_K);
    this.layer.setFar(this.lodFar);
    this.layer.flush();
    const q = this.updateQuality(units, units + this.wrecks.length);
    this.syncCamera();
    this.sun.castShadow = q.shadow;
    this.renderer.shadowMap.enabled = q.shadow;
    this.renderer.shadowMap.needsUpdate = q.shadow;
    const hdr = lerp(0.35, 1, clamp(this.flashScale, 0, 1));
    this.fx.hdr = hdr;
    this.renderer.toneMappingExposure = 1 + this.fx.flashA * 0.5 * clamp(this.flashScale, 0, 1);
    this.renderer.info.reset();
    if (q.direct) this.renderer.render(this.scene, this.camera);
    else {
      if (this.post.gtao) this.post.gtao.enabled = q.ao;
      if (this.post.bloom) { this.post.bloom.enabled = q.bloom; this.post.bloom.strength = 0.3 + 0.25 * clamp(this.flashScale, 0, 1); }
      this.outline.renderMask(this.renderer, this.scene, this.camera);
      this.post.render();
    }
    // overlay on top of the finished frame (exact colours, no tone mapping)
    const r = this.renderer, ac = r.autoClear;
    r.autoClear = false;
    r.clearDepth();
    r.render(this.ui.scene, this.camera);
    r.autoClear = ac;
  }

  /** diagnostics for the last frame (all passes: shadow, AO normals, main, bloom, output, overlay) */
  get stats() {
    const i = this.renderer.info;
    return {
      calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures,
      units: this.lastUnits, particles: this.fx.particleCount, level: this.level, frameMs: this.ema, templates: this.layer.stats.templates,
      instancedMeshes: this.layer.liveMeshes, overlayQuads: this.ui.quads, lodFar: this.lodFar,
    };
  }

  /* ------------------------------------------------------------------------------------------- unit pool */

  private teamOf(side: Side): 0 | 1 { return side === this.viewerSide ? 0 : 1; }
  private paints: [number, number, number][] = [];
  /** linear rgb of a side's team body paint (blown-up hull debris) */
  private paintOf(side: Side): [number, number, number] {
    const t = this.teamOf(side);
    if (!this.paints[t]) this.paints[t] = teamHullRgb(t);
    return this.paints[t];
  }
  private clearBattle(): void {
    for (const v of this.bu.values()) this.layer.release(v.rig);
    this.bu.clear();
    for (const w of this.wrecks) if (w.rig) this.layer.release(w.rig);
    this.wrecks = [];
    for (const f of this.fallers) this.layer.release(f.rig);
    this.fallers = [];
    this.lastBarrel.clear(); this.shotN.clear();
    this.fx.clear();
    this.shake.clear();
    this.projRec.clear();
    this.spin.clear(); this.ramp.clear(); this.clusterPts.length = 0;
    this.prevU.clear(); this.curU.clear(); this.prevP.clear(); this.curP.clear();
    this.pending = [];
  }
  private releaseBoard(): void {
    for (const r of this.deployUsed) this.layer.release(r);
    this.deployUsed = [];
  }

  /* ---------------------------------------------------------------------------------------------- board */

  drawBoard(units: BoardUnit[], overlay: BoardOverlay, time: number): void {
    this.checkSize();
    const dt = this.time ? clamp(time - this.time, 0, 0.1) : 0;
    this.time = time;
    if (this.battle) { this.battle = null; this.lastTick = -1; this.clearBattle(); }
    this.cam.update(dt);
    this.fx.eye.copy(this.camera.position);
    this.fx.viewFrom(this.camera, this.renderer.domElement.height, this.sun);
    this.fx.update(dt);
    // shake comes from shake3d (located, sized jolts); the effects' own unlocated trauma is not used
    this.fx.trauma = 0;
    this.shake.update(dt);
    this.fx.flashA = Math.max(0, this.fx.flashA - dt * 3);
    (this.myZone.material as THREE.MeshBasicMaterial).opacity = overlay.showZone ? 0.055 : 0;
    this.grid.visible = !!overlay.showZone;
    const hv = overlay.hover;
    this.hoverFill.visible = this.hoverLine.visible = !!hv;
    if (hv) {
      const col = hv.valid ? '#46e88a' : '#ff4a4a';
      const w = hv.w ?? hv.size, h = hv.h ?? hv.size;
      (this.hoverFill.material as THREE.MeshBasicMaterial).color.set(col);
      (this.hoverFill.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.07 * Math.sin(time * 6);
      (this.hoverLine.material as THREE.LineBasicMaterial).color.set(col);
      this.hoverFill.scale.set(w, 1, h);
      this.hoverFill.position.set(hv.col + w / 2, 0.05, hv.row + h / 2);
      this.hoverLine.scale.set(w, 1, h);
      this.hoverLine.position.set(hv.col, 0, hv.row);
    }
    this.releaseBoard();
    this.syncCamera();
    this.ui.begin(this.camera, this.cam.k);
    this.shields.begin();
    let nSel = 0;
    for (const u of units) {
      const team = this.teamOf(u.side);
      const rig = this.layer.acquire(u.design, team);
      this.deployUsed.push(rig);
      const ang = u.side === 0 ? -Math.PI / 2 : Math.PI / 2;
      rig.root.position.set(u.x, rig.flying ? flyHeight(rig.S, rig.jet) + 0.4 : 0, u.y);
      rig.root.rotation.y = -ang;
      if (rig.flying && !u.ghost) rig.locomote(0, false, time + u.x * 0.37, dt);
      rig.update(dt);
      const look: Look = u.invalid ? 'invalid' : u.ghost ? 'ghost' : u.dim ? 'cloak' : 'normal';
      rig.look = look;
      this.layer.submit(rig, look);
      if (u.selected) this.selectionRing(nSel++, u.x, u.y, rig, ang, time);
      if (u.level > 1 && !u.ghost) this.drawPips(u.x, u.y, rig, ang, u.level, 1);
    }
    this.shields.end();
    this.ui.end();
    this.hideSelRings(nSel);
    this.syncProjectiles([]);
    this.render(units.length);
  }

  private selectionRing(i: number, x: number, y: number, rig: Rig, ang: number, time: number): void {
    let l = this.selLines[i];
    if (!l) {
      l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(a, 0.07, b))), new THREE.LineBasicMaterial({ color: TEAM_PAL[0].accent, transparent: true }));
      this.selLines[i] = l;
      this.scene.add(l);
    }
    l.visible = true;
    l.position.set(x, 0, y);
    l.rotation.y = -ang;
    l.scale.set(rig.L * 0.5 + 0.12, 1, rig.W * 0.5 + 0.12);
    (l.material as THREE.LineBasicMaterial).opacity = 0.6 + 0.3 * Math.sin(time * 5);
  }
  private hideSelRings(from: number): void { for (let i = from; i < this.selLines.length; i++) this.selLines[i].visible = false; }

  /* --------------------------------------------------------------------------------------------- battle */

  pushEvents(events: BattleEvent[]): void {
    this.usePush = true;
    for (const e of events) this.pending.push(e);
    if (this.pending.length > 6000) this.pending.splice(0, this.pending.length - 6000);
  }

  private reset(b: Battle): void {
    // events pushed for this battle before its first draw (match.ts steps, pushes, then draws) belong to it
    const pending = this.pending;
    this.clearBattle();
    this.pending = pending;
    this.battle = b;
    this.lastTick = -1;
    this.sinceTick = 0;
    this.rt = this.prevTick = this.curTick = 0;
    this.rateWin.n = this.rateWin.t = 0;
    this.grid.visible = false;
    (this.myZone.material as THREE.MeshBasicMaterial).opacity = 0;
    this.hoverFill.visible = this.hoverLine.visible = false;
    this.hideSelRings(0);
    this.releaseBoard();
  }

  drawBattle(battle: Battle, frameDt: number): void {
    this.checkSize();
    const dt = clamp(frameDt, 0, 0.1);
    this._lastFrameDt = dt || 1 / 60;
    this.time += dt;
    if (battle !== this.battle || battle.tick < this.lastTick) this.reset(battle);
    let newTicks: BattleEvent[] | null = null;
    // a big jump (SKIP to the end) is shown as-is: units that died unseen leave their hulks like the 2D view
    let jump = false;
    const newTick = battle.tick !== this.lastTick;
    if (newTick) {
      const n = battle.tick - this.lastTick;
      jump = this.lastTick >= 0 && n > 40;
      // ticks per second as observed by this view (speed x frame pacing), measured over >= 0.2 s windows; the time since
      // the previous snapshot includes this frame; long gaps (pause, background tab) say nothing about the rate
      const span = this.sinceTick + dt;
      if (this.lastTick < 0 || jump || span >= 0.4) this.rateWin.n = this.rateWin.t = 0;
      else if (span >= 0.05 && (n / span > this.tickRate * 1.7 || n / span < this.tickRate * 0.6)) {
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
      const snapJump = this.lastTick < 0 || jump;
      this.prevTick = snapJump ? battle.tick : this.curTick;
      this.curTick = battle.tick;
      if (snapJump) this.rt = battle.tick;
      this.prevU = this.curU; this.curU = new Map();
      for (const u of battle.units) if (u.alive) this.curU.set(u.id, { x: u.x, y: u.y, angle: u.angle, mounts: u.mounts.map((m) => m.angle) });
      if (snapJump) this.prevU = new Map(this.curU);
      this.prevP = this.curP; this.curP = new Map();
      for (const p of battle.projectiles) this.curP.set(p.id, { x: p.x, y: p.y, z: p.z, angle: p.angle, progress: p.progress });
      if (snapJump) this.prevP = new Map(this.curP);
      this.lastTick = battle.tick;
      this.sinceTick = 0;
      if (!this.usePush) newTicks = battle.events;
    } else this.sinceTick += dt;
    const target = this.curTick + this.sinceTick * this.tickRate - 1;
    this.rt += dt * this.tickRate;
    this.rt += (target - this.rt) * 0.05;
    this.rt = clamp(this.rt, this.prevTick, this.curTick);
    this.alpha = this.curTick > this.prevTick ? (this.rt - this.prevTick) / (this.curTick - this.prevTick) : 1;
    this.boxes.clear();

    const byId = new Map<number, SimUnit>();
    for (const u of battle.units) byId.set(u.id, u);
    for (const u of battle.units) {
      if (!u.alive) continue;
      if (!this.bu.has(u.id)) this.bu.set(u.id, { rig: this.layer.acquire(u.design, this.teamOf(u.side)), lx: u.x, ly: u.y, seen: false, dmgT: -99, healT: -99, hpLast: u.hp, shLast: u.shield, hpShown: u.hp, shT: -99, hx: 0, hy: 0, hz: 0, hits: 0, posed: false });
    }
    this.hitBudget = 60;
    const events = newTicks ?? this.pending;
    if (events.length) {
      setActiveShake(this.shake);
      for (const e of events) { this.shakeFor(e); this.handleEvent(e, byId); }
      this.shotFrom.clear(); this.lastBlast = null;
      if (!this.muted) try { battleSfx(events); } catch { /* audio optional */ }
      if (!newTicks) this.pending = [];
    }
    this.cam.update(dt);
    this.syncCamera();
    this.ui.begin(this.camera, this.cam.k);
    this.shields.begin();

    // units
    let alive = 0;
    for (const u of battle.units) if (u.alive) alive++;
    // damage smoke: full rate up to ~90 units on the field, thinned out beyond (and with the effect LOD)
    this.dmgK = Math.min(1, 90 / Math.max(1, alive)) * this.fx.lod;
    alive = 0;
    for (const u of battle.units) {
      if (!u.alive) {
        const v = this.bu.get(u.id);
        if (v && jump && !u.flying) this.toWreck(u.id, v.rig, u.x, u.y, u.angle, 1, 'kinetic', true);
        else if (v) { this.layer.release(v.rig); this.bu.delete(u.id); }
        continue;
      }
      alive++;
      const v = this.bu.get(u.id)!;
      this.poseUnit(u, v, dt);
    }
    this.syncWrecks(dt);
    this.syncFallers(dt);
    this.syncProjectiles(battle.projectiles, byId);
    this.shields.end();
    this.ui.end();
    this.fx.eye.copy(this.camera.position);
    this.fx.viewFrom(this.camera, this.renderer.domElement.height, this.sun);
    this.fx.update(dt);
    // shake comes from shake3d (located, sized jolts); the effects' own unlocated trauma is not used
    this.fx.trauma = 0;
    this.shake.update(dt);
    this.fx.flashA = Math.max(0, this.fx.flashA - dt * 3);
    this.render(alive);
  }

  /** true if a ground point is far enough outside the viewport that nothing of a unit there can be seen */
  private offscreen(x: number, y: number, margin: number): boolean {
    const p = this.worldToScreen(x, y), m = margin * this.cam.k;
    return p.x < -m || p.x > this.cssW + m || p.y < -m * this.ayNow - 60 || p.y > this.cssH + m * this.ayNow + 60;
  }

  private poseUnit(u: SimUnit, v: UView, dt: number): void {
    const rig = v.rig;
    const a = this.alpha;
    const c = this.curU.get(u.id), pr = this.prevU.get(u.id) ?? c;
    let x = u.x, y = u.y, ang = u.angle;
    let mounts = u.mounts.map((m) => m.angle);
    if (c && pr) {
      x = lerp(pr.x, c.x, a); y = lerp(pr.y, c.y, a);
      if (Math.hypot(c.x - pr.x, c.y - pr.y) > 3) { x = c.x; y = c.y; }
      ang = lerpAngle(pr.angle, c.angle, a);
      mounts = u.mounts.map((m, i) => lerpAngle(pr.mounts[i] ?? m.angle, c.mounts[i] ?? m.angle, a));
    }
    const ext = u as SimUnit & { cloaked?: boolean };
    const enemyCloak = !!ext.cloaked && u.side !== this.viewerSide;
    const dist = v.seen ? Math.min(2, Math.hypot(x - v.lx, y - v.ly)) : 0;
    // travel this frame in the hull frame (forward / toward local +z = the field's +90 deg side): walkers stride the
    // way they move (a spider strafing, legs backing up), wheels roll backwards in reverse
    const mdx = dist > 0 ? x - v.lx : 0, mdy = dist > 0 ? y - v.ly : 0, ca0 = Math.cos(ang), sa0 = Math.sin(ang);
    const turn = v.seen && v.la !== undefined ? Math.atan2(Math.sin(ang - v.la), Math.cos(ang - v.la)) : 0;
    v.lx = x; v.ly = y; v.la = ang; v.seen = true;
    this.trackVis(u, v);
    v.posed = false;
    if (enemyCloak || this.offscreen(x, y, rig.radius + 5)) return;
    const h = u.flying ? flyHeight(rig.S, rig.jet) + 0.4 + Math.sin(this.time * 2.1 + u.id) * 0.05 : u.leap * 1.8 * rig.S;
    rig.root.position.set(x, h, y);
    // (heavy guns rock the hull: Rig.update tilts the quaternion, so the full rotation is reset here every frame)
    rig.root.rotation.set(0, -ang, 0);
    rig.locomote(dist, u.moving, this.time + u.id * 0.37, dt, mdx * ca0 + mdy * sa0, -mdx * sa0 + mdy * ca0, Math.abs(turn) < 0.5 ? turn : 0);
    // heavy ground units (size >= 3, on tracks / wheels / legs) kick up a little sandy dust behind them while moving
    if (rig.S >= 3 && !u.flying && dt > 1e-4 && dist > 1e-4 && !NO_DUST.has(u.design.mobility)) {
      const k = clamp(dist / dt / 1.2, 0, 1); // heavies crawl: ~1.2 cells/s = full
      v.dustAcc = (v.dustAcc ?? 0) + dt * (4 + 3 * rig.S) * k * this.fx.lod;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      while (v.dustAcc >= 1) {
        v.dustAcc--;
        const side = (Math.random() - 0.5) * rig.W * 0.8, back = rig.L * R2(0.45, 0.65);
        this.fx.trackDust(x - ca * back - sa * side, y - sa * back + ca * side, -ca, -sa, rig.S, k);
      }
    }
    for (let i = 0; i < u.mounts.length; i++) rig.aim(i, normAng(mounts[i] - ang), dt);

    // status tint: hit flash, burning flicker, stun crackle
    let tr = 1, tg = 1, tb = 1;
    if (u.hitFlash > 0.02) { const f = u.hitFlash; tr += f * 1.7; tg += f * 1.3; tb += f * 0.9; }
    if (u.burning > 0) { const f = 0.12 + 0.1 * Math.sin(this.time * 17 + u.id); tr += f * 2; tg += f * 0.6; }
    if (u.stun > 0) { const f = 0.5 + 0.5 * Math.sin(this.time * 43 + u.id * 2.1); tr += f * 0.3; tg += f * 0.9; tb += f * 1.8; }
    // slowed: frosted over (cold blue-white); disarmed: a slow amber warning pulse
    const sk = u.slow > 0.02 ? clamp(u.slow / 0.6, 0.25, 1) : 0;
    if (sk) { tr *= 1 - 0.25 * sk; tg *= 1 + 0.05 * sk; tb += 0.7 * sk; }
    if (u.disarm > 0) { const f = 0.5 + 0.5 * Math.sin(this.time * 9 + u.id); tr += f * 0.45; tg += f * 0.28; }
    // critically damaged: the hull darkens, with the odd flicker of fire light from inside
    const hpF = u.maxHp > 0 ? u.hp / u.maxHp : 1;
    if (hpF < 0.25) {
      const fl = Math.max(0, Math.sin(this.time * 23 + u.id * 3.1) * Math.sin(this.time * 7.7 + u.id)) * 0.35;
      tr *= 0.78 + fl; tg *= 0.74 + fl * 0.45; tb *= 0.72;
    } else if (hpF < 0.5) { tr *= 0.9; tg *= 0.88; tb *= 0.86; }
    rig.tr = tr; rig.tg = tg; rig.tb = tb;
    rig.update(dt);
    v.posed = true;
    this.layer.submit(rig, ext.cloaked ? 'cloak' : 'normal');

    // status effects
    const S = rig.S;
    if (u.burning > 0) {
      // licking flames over the whole hull (rate scales with its footprint), lit from within by a flickering glow
      const hx = rig.L * 0.42, hz = rig.W * 0.42, ca = Math.cos(ang), sa = Math.sin(ang);
      let acc = dt * (8 + 12 * rig.L * rig.W) * Math.max(0.5, this.fx.lod);
      while (acc > 0) {
        if (acc < 1 && Math.random() > acc) break;
        acc--;
        // a random point on the rotated footprint
        const lx = (Math.random() * 2 - 1) * hx, lz = (Math.random() * 2 - 1) * hz;
        this.fx.burning(x + lx * ca - lz * sa, h + rig.height * (0.45 + 0.45 * Math.random()), y + lx * sa + lz * ca, 0.05 + rig.L * 0.08, 0.05 + rig.W * 0.08);
      }
      if (Math.random() < dt * 8) this.fx.glow(x, h + rig.height * 0.7, y, 0.6 + Math.max(rig.L, rig.W) * 0.7, 0.18, RAMPS.fire);
    }
    if (u.stun > 0 && Math.random() < dt * 5) this.fx.arcs(x, h + rig.height * 0.55, y, rig.L * 0.42, rig.W * 0.42);
    else if (u.para > 0 && Math.random() < dt * 8 * clamp(u.para / u.maxHp, 0.1, 1)) this.fx.paraSpark(x, h + rig.height * 0.6, y, rig.L * 0.4, rig.W * 0.4);
    if (sk && Math.random() < dt * (4 + 8 * sk) * (0.6 + 0.2 * S) * this.fx.lod) this.fx.frost(x, h + rig.height * 0.75, y, rig.L * 0.45, rig.W * 0.45, sk);
    if (u.disarm > 0 && Math.random() < dt * 7 * this.fx.lod) {
      const i = Math.floor(Math.random() * u.mounts.length);
      const m = u.mounts[i]?.moduleId ? rig.muzzleWorld(i, _v3) : null;
      if (m) this.fx.jam(m.x, m.y, m.z); else this.fx.jam(x, h + rig.height * 0.8, y);
    }
    this.heat(u, rig);
    if (hpF < 0.75) this.damageSmoke(u, v, x, h, y, ang, hpF, dt);

    this.drawShield(u, v, x, h, y);
    this.drawBars(u, v, x, h, y, ang, dt);
  }

  /** Emitter points for a unit's damage smoke: 2-4 seams / joints picked from its build (turret rings, the engine
   *  deck, hips / track sprockets) with what leaks out of each (coolant steam, oily engine smoke, electrical smoke on
   *  high-tech hulls, grit on brawlers), plus per-emitter variation. Deterministic per unit id. */
  private dmgPoints(u: SimUnit, rig: Rig): DmgPt[] {
    let sd = (u.id * 2654435761) >>> 0;
    const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
    const d = u.design, mob = d.mobility;
    const legs = mob === 'legs' || mob === 'titanlegs' || mob === 'jumpjets' || mob === 'spider';
    const tech = mob === 'hover' || mob === 'gravlift' || d.mounts.some((m) => { const c = m ? MODULE_BY_ID.get(m)?.category : undefined; return c === 'energy' || c === 'disruption'; });
    const brawler = d.mounts.some((m) => (m ? MODULE_BY_ID.get(m)?.category === 'melee' : false));
    const L = rig.L, W = rig.W, H = rig.height;
    const pts: DmgPt[] = [];
    const add = (x: number, y: number, z: number, mount: number, kind: WispKind) =>
      pts.push({ x, y, z, mount, kind, rate: 0.75 + 0.5 * rnd(), size: 0.8 + 0.4 * rnd(), order: rnd() });
    // the engine deck at the back: oily smoke (electrical on high-tech hulls)
    add(-L * (0.28 + 0.1 * rnd()), H * 0.62, (rnd() - 0.5) * W * 0.4, -1, tech ? 'elec' : 'oil');
    // the first turret's ring: coolant / hydraulics
    if (rig.turrets.some((t) => t)) add(0, 0, 0, rig.turrets.findIndex((t) => t), tech ? 'elec' : 'steam');
    // joints: hips (walkers) or a track sprocket / wheel hub (vehicles); brawlers shed grit
    const sz = rnd() < 0.5 ? -1 : 1;
    if (legs) add((rnd() - 0.5) * L * 0.3, H * 0.42, sz * W * 0.36, -1, tech ? 'elec' : 'steam');
    else add(L * (0.15 + 0.25 * rnd()), H * 0.3, sz * W * 0.42, -1, brawler ? 'dust' : 'steam');
    if (rig.S >= 3) add(L * (rnd() - 0.5) * 0.6, H * 0.7, -sz * W * 0.3, -1, tech ? 'elec' : 'oil');
    pts.sort((a, b) => a.order - b.order);
    return pts;
  }

  /** Damaged hulls leak smoke from their seams and joints: light damage (< 75 % hp) a thin wisp or two, heavy (< 50 %)
   *  every joint smoking, darker, with sparks, critical (< 25 %) a fire licking out of one hole, thick black smoke off
   *  the engine and sparks (the tint flickers in poseUnit). */
  private damageSmoke(u: SimUnit, v: UView, x: number, h: number, y: number, ang: number, f: number, dt: number): void {
    const rig = v.rig, pts = (v.dmg ??= this.dmgPoints(u, rig));
    const stage = f < 0.25 ? 3 : f < 0.5 ? 2 : 1;
    const ca = Math.cos(ang), sa = Math.sin(ang), K = this.dmgK, S = rig.S;
    const sz = 0.55 + 0.25 * Math.min(4, S);
    const n = stage === 1 ? Math.min(2, pts.length) : pts.length;
    // the deck: where the first turret sits on the hull (the model's full height includes its turrets and antennae,
    // so hull points placed by height alone ended up inside the hull, their smoke hidden)
    const t0 = rig.turrets.findIndex((t) => t);
    const deck = t0 >= 0 && rig.turretWorld(t0, _v3) ? Math.max(h + 0.15, _v3.y) : h + rig.height * 0.6;
    // critical: the fire burns out of the engine deck
    const fireAt = pts.find((q) => q.mount < 0 && (q.kind === 'oil' || q.kind === 'elec')) ?? pts[0];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      let px: number, py: number, pz: number;
      const tw = p.mount >= 0 ? rig.turretWorld(p.mount, _v3) : null;
      if (tw) { px = tw.x; py = tw.y + 0.08; pz = tw.z; }
      else { px = x + p.x * ca - p.z * sa; py = deck + 0.05; pz = y + p.x * sa + p.z * ca; }
      let kind = p.kind;
      // heavier damage: the engine's oil smoke goes black, steam turns to dirty smoke
      if (stage >= 2 && kind === 'oil') kind = 'black';
      if (stage === 3 && kind === 'steam' && i > 0) kind = 'oil';
      const rate = (stage === 1 ? 6 : stage === 2 ? 9 : 11) * p.rate * K;
      for (let r = rate * dt; r > 0; r--) if (Math.random() < r) this.fx.wisp(px, py, pz, kind, (stage === 1 ? 0.25 : stage === 2 ? 0.55 : 0.85) * p.size * sz);
      if (stage >= 2 && Math.random() < (stage === 2 ? 0.35 : 0.8) * K * dt) this.fx.damageSpark(px, py, pz, p.kind === 'elec');
      if (stage === 3 && p === fireAt && Math.random() < 14 * K * dt) this.fx.smallFire(px, py, pz, 0.2 + 0.08 * Math.min(4, S));
    }
  }

  /** rotary guns that have been firing glow at the muzzle, brighter the further they have spun up */
  private heat(u: SimUnit, rig: Rig): void {
    if (!this.spin.size) return;
    const now = this.curTick * DT;
    for (let i = 0; i < u.mounts.length; i++) {
      const sp = this.spin.get(u.id * 16 + i);
      if (!sp || sp.k < 0.15) continue;
      const since = now - sp.t;
      if (since > 1.2) continue;
      const m = rig.muzzleWorld(i, _v3);
      if (!m) continue;
      const st = styleOf(u.mounts[i].moduleId ?? '');
      this.fx.heatGlow(m.x, m.y, m.z, st.s, sp.k * (1 - since / 1.2));
    }
  }

  /** a rotary gun fired: advance its spin estimate (sim: +DT / spinUp per tick on target, the same back down off it) */
  private spinShot(unit: number, mount: number, su: number): number {
    const key = unit * 16 + mount, now = this.curTick * DT;
    let sp = this.spin.get(key);
    if (!sp) { sp = { k: 0, t: now }; this.spin.set(key, sp); }
    const gap = now - sp.t;
    sp.k = gap > 0.45 ? Math.max(0, sp.k - gap / su) : Math.min(1, sp.k + gap / su);
    sp.t = now;
    return sp.k;
  }

  /** a focusing beam fired: 0..1 of its build-up on this target (sim: RAMP_TIME 2.5 s, reset by a switch or a 1 s gap) */
  private rampShot(unit: number, mount: number, x: number, y: number): number {
    const key = unit * 16 + mount, now = this.curTick * DT;
    let rp = this.ramp.get(key);
    if (!rp) { rp = { start: now, last: now, x, y }; this.ramp.set(key, rp); }
    if (now - rp.last > 1 || Math.hypot(x - rp.x, y - rp.y) > 1.6) rp.start = now;
    rp.last = now; rp.x = x; rp.y = y;
    return clamp((now - rp.start) / 2.5, 0, 1);
  }

  /** hp / shield change detection (burn, splash, auras) on top of 'hit' events, for the bar visibility timers */
  private trackVis(u: SimUnit, v: UView): void {
    if (u.hp < v.hpLast - 0.01 || u.shield < v.shLast - 0.01) v.dmgT = this.time;
    else if (u.hp > v.hpLast + 0.5) v.healT = this.time;
    v.hpLast = u.hp; v.shLast = u.shield;
  }

  private drawShield(u: SimUnit, v: UView, x: number, h: number, y: number): void {
    if (u.shield <= 0) return;
    const rig = v.rig;
    const R = Math.max(rig.L, rig.W) * 0.58 + 0.18, Hh = Math.max(0.45, rig.height * 0.85 + 0.12);
    const b = this.shields.next();
    b.mesh.position.set(x, h + Hh * 0.42, y);
    b.mesh.scale.set(R, Hh, R);
    const since = this.time - v.shT;
    const hit = since < 0.55 ? 1 - since / 0.55 : 0;
    const frac = u.maxShield > 0 ? u.shield / u.maxShield : 0.5;
    const un = b.mat.uniforms;
    un.uBase.value = (0.08 + 0.08 * frac) * clamp(0.6 + 0.4 * this.flashScale, 0, 1) + hit * 0.05;
    un.uTime.value = this.time;
    // the last 4 hits ripple at once; directions relative to the bubble's centre in its unit-sphere space
    const hs = un.uHits.value as THREE.Vector4[], cy = h + Hh * 0.42;
    for (let i = 0; i < 4; i++) {
      const o = i * 4, age = v.shHits ? (this.time - v.shHits[o + 3]) / 0.8 : 1;
      if (!v.shHits || age >= 1 || age < 0) { hs[i].w = 1; continue; }
      _v3.set((v.shHits[o] - x) / R, (v.shHits[o + 1] - cy) / Hh, (v.shHits[o + 2] - y) / R).normalize();
      hs[i].set(_v3.x, _v3.y, _v3.z, age);
    }
  }

  /* ----------------------------------------------------------------------------------- bars / meters / pips */

  private barAlpha(v: UView, S: number): number {
    if (this.alwaysShowHealth || this.altHeld) return 1;
    const hold = S >= 4 ? 5 : 3, fade = 0.7;
    const f = (since: number, hd: number) => (since < hd ? 1 : since < hd + fade ? 1 - (since - hd) / fade : 0);
    return Math.max(f(this.time - v.dmgT, hold), f(this.time - v.healT, 1.2));
  }

  /** half height (cells) of the unit's rotated footprint on screen */
  private halfY(rig: Rig, ang: number): number { ang -= this.cam.yaw; return (Math.abs(Math.sin(ang)) * rig.L + Math.abs(Math.cos(ang)) * rig.W) / 2; }

  private drawBars(u: SimUnit, v: UView, x: number, h: number, y: number, ang: number, dt: number): void {
    const rig = v.rig, ui = this.ui, k = this.cam.k;
    const S = rig.S;
    v.hpShown = v.hpShown > u.hp ? Math.max(u.hp, v.hpShown - (u.maxHp * 0.6 + (v.hpShown - u.hp) * 3) * dt) : u.hp;
    const hy = this.halfY(rig, ang);
    if (u.level > 1) this.drawPips(x, y, rig, ang, u.level, 0.9, h);
    const slowed = u.slow > 0.02, disarmed = u.disarm > 0;
    const vis = Math.max(this.barAlpha(v, S), u.para > 0 || slowed || disarmed ? 1 : 0);
    if (vis <= 0.01) return;
    const top = h + rig.height + 0.05;
    const boss = S >= 4;
    const team = this.teamOf(u.side);
    const w = boss ? Math.max(40, ((rig.L + rig.W) / 2) * k * 1.0) : Math.max(14, ((rig.L + rig.W) / 2) * k * 0.78);
    const bh = boss ? (S >= 5 ? 9 : 7) : S >= 2 ? 4 : 3;
    const x0 = -w / 2;
    const y0 = hy * k * this.ayNow * (boss ? 1.1 : 1.04) + 4;
    // status glyphs left of the bar: a snowflake while slowed, a crossed-out gun (amber X) while disarmed
    let gx = x0 - 7;
    const gy = y0 + bh / 2;
    if (disarmed) {
      const r = 3.6, t = 1.1;
      for (const sg of [1, -1]) {
        ui.quad(x, top, y, [gx - r - t, gy - sg * r, gx - r + t, gy - sg * r - t * 1.4, gx + r + t, gy + sg * r, gx + r - t, gy + sg * r + t * 1.4], BLACK, 0.8);
        ui.quad(x, top, y, [gx - r, gy - sg * r, gx - r + t * 0.7, gy - sg * r - t * 0.7, gx + r, gy + sg * r, gx + r - t * 0.7, gy + sg * r + t * 0.7], JAM_COL, 1);
      }
      gx -= 9;
    }
    if (slowed) {
      const r = 3.8;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI + Math.PI / 2, c = Math.cos(a) * r, sn = Math.sin(a) * r, px = -Math.sin(a) * 0.8, py = Math.cos(a) * 0.8;
        ui.quad(x, top, y, [gx - c - px * 1.8, gy - sn - py * 1.8, gx - c + px * 1.8, gy - sn + py * 1.8, gx + c + px * 1.8, gy + sn + py * 1.8, gx + c - px * 1.8, gy + sn - py * 1.8], BLACK, 0.7);
        ui.quad(x, top, y, [gx - c - px, gy - sn - py, gx - c + px, gy - sn + py, gx + c + px, gy + sn + py, gx + c - px, gy + sn - py], ICE_HI, 1);
      }
    }
    const f = clamp(u.hp / u.maxHp, 0, 1), fs = clamp(v.hpShown / u.maxHp, 0, 1);
    const pad = boss ? 3 : 1.5;
    ui.rect(x, top, y, x0 - pad, y0 - pad, w + pad * 2, bh + pad * 2, boss ? BAR_COL[team] : BLACK, boss ? 0.95 * vis : 0.88 * vis);
    if (boss) ui.rect(x, top, y, x0 - pad + 1.2, y0 - pad + 1.2, w + pad * 2 - 2.4, bh + pad * 2 - 2.4, BLACK, 0.92 * vis);
    ui.rect(x, top, y, x0, y0, w * fs, bh, WHITE, 0.85 * vis);
    ui.rect(x, top, y, x0, y0, w * f, bh, f < 0.3 ? (team === 0 ? YELLOW : RED) : BAR_COL[team], vis);
    if (boss) for (let i = 1; i < 10; i++) ui.rect(x, top, y, x0 + (w * i) / 10 - 0.5, y0, 1, bh, BLACK, 0.6 * vis);
    if (u.maxShield > 0 && u.shield > 0) ui.rect(x, top, y, x0, y0 + bh + 0.5, w * clamp(u.shield / u.maxShield, 0, 1), 1.6, SHIELD_COL, vis);
    // paralysis (Zero-K style): blue meter under the hp bar, pulsing + bolt glyph while stunned
    if (u.para > 0) {
      const pf = clamp(u.para / u.maxHp, 0, 1), stunned = u.stun > 0;
      const py = y0 - bh - 3.5;
      ui.rect(x, top, y, x0 - 1.5, py - 1, w + 3, 4.5, BLACK, 0.88);
      ui.rect(x, top, y, x0, py, w * pf, 2.5, stunned ? (Math.sin(this.time * 14) > 0 ? ICE_HI : ICE_LO) : PARA_COL, 1);
      if (stunned) { // bolt glyph beside the meter
        const bx = x0 + w + 6, by = py + 1.2;
        ui.tri(x, top, y, bx + 2, by + 6, bx - 2, by - 1, bx + 1, by - 1, ICE_HI, 1);
        ui.tri(x, top, y, bx + 1, by - 1, bx - 1, by - 7, bx + 4, by + 1, ICE_HI, 1);
      }
    }
  }

  /** level pips under the unit's footprint */
  private drawPips(x: number, y: number, rig: Rig, ang: number, level: number, alpha: number, baseY = 0): void {
    const ui = this.ui, k = this.cam.k;
    const sz = clamp(k * 0.18, 3, 6);
    const hy = this.halfY(rig, ang) * k * this.ayNow * 0.9;
    const by = -hy - sz * 0.9;
    for (let i = 0; i < level - 1; i++) {
      const cx = (i - (level - 2) / 2) * sz * 1.5;
      const wing = (m: number, pad: number, c: RGB, a: number) => {
        const s = sz + pad;
        ui.quad(x, baseY, y, [cx, by - 0.15 * s, cx + m * 0.6 * s, by + 0.4 * s, cx + m * 0.6 * s, by, cx, by - 0.55 * s], c, a);
      };
      wing(-1, 1.2, BLACK, 0.75 * alpha); wing(1, 1.2, BLACK, 0.75 * alpha);
      wing(-1, 0, GOLD, alpha); wing(1, 0, GOLD, alpha);
    }
  }

  /* ------------------------------------------------------------------------------------------ projectiles */

  private projPos(p: SimProjectile) {
    const c = this.curP.get(p.id), pr = this.prevP.get(p.id);
    if (!c) return p;
    if (!pr) return c;
    const a = this.alpha;
    return { x: lerp(pr.x, c.x, a), y: lerp(pr.y, c.y, a), z: lerp(pr.z, c.z, a), angle: lerpAngle(pr.angle, c.angle, a), progress: lerp(pr.progress, c.progress, a) };
  }

  private syncProjectiles(list: SimProjectile[], byId?: Map<number, SimUnit>): void {
    const proj = this.fx.proj;
    proj.begin(this.time);
    const seen = this.projRec;
    const alive = new Set<number>();
    const dt = 1 / 60;
    const fdt = this.frameDt();
    const lod = this.fx.lod;
    for (const p of list) {
      alive.add(p.id);
      let rec = seen.get(p.id);
      const pos = this.projPos(p);
      if (!rec) {
        // launch point: the barrel tip that fired it (guns: the barrel the 'fire' event took; pods and racks: the next
        // tube in turn, so a salvo ripples across the launcher face). The sim launches from the mount's muzzle reach,
        // the view starts the round at the real tip and eases it onto the sim's path over the first frames.
        let y0 = GUN_H, ox = 0, oz = 0;
        const st0 = styleOf(p.moduleId);
        const key = p.src !== undefined && p.mount !== undefined ? p.src * 16 + p.mount : -1;
        if (key >= 0) {
          const rig = this.posedRig(p.src);
          const tube = p.kind === 'rocket' || p.kind === 'missile';
          const bi = rig ? (tube ? rig.nextBarrel(p.mount!) : this.lastBarrel.get(key) ?? 0) : 0;
          if (rig && rig.muzzleWorld(p.mount!, _v3, bi)) {
            y0 = _v3.y;
            const dx = _v3.x - pos.x, dz = _v3.z - pos.y;
            if (dx * dx + dz * dz < 6) { ox = dx; oz = dz; }
          }
        }
        const shots = key >= 0 ? (this.shotN.get(key) ?? 0) + 1 : p.id;
        if (key >= 0) this.shotN.set(key, shots);
        const every = st0.fam === 'shotgun' || st0.fam === 'flechette' ? 0 : tracerEvery(st0.def);
        // straight rounds end at the body height of the first enemy along their path (aircraft fly well above the ground);
        // rounds fired at aircraft (the sim flies them at z = 1) climb to the first aircraft along their path
        const air = airShot(p);
        const hEnd = !byId ? 0.42
          : air ? this.aimHeightAlong(pos.x, pos.y, pos.angle, byId, p.side, p.z + 0.12, true)
          : p.z > 0.05 ? 0.42 : this.aimHeightAlong(pos.x, pos.y, pos.angle, byId, p.side, 0.42, false);
        const st = styleOf(p.moduleId);
        // rotary guns: how far the barrels had spun up when this round left them
        const k = st.fam === 'gatling' && p.src !== undefined && p.mount !== undefined ? this.spin.get(p.src * 16 + p.mount)?.k ?? 1 : 1;
        const cp = st.fam === 'cluster' ? this.clusterPts.find((c) => Math.abs(c.x - p.x) < 0.7 && Math.abs(c.y - p.y) < 0.7) : undefined;
        const bomblet = !!cp, bh = cp?.h ?? 0;
        if (bomblet || st.fam === 'bomb') y0 = pos.z + 0.12 + bh;
        const ca = Math.cos(pos.angle), sa = Math.sin(pos.angle);
        rec = {
          y0, lastH: y0, px: pos.x + ox, py: pos.y + oz, bright: p.id % 3 === 0, hEnd, air, st, k, bomblet, bh,
          dx: ca, dy: p.kind === 'arc' && !bomblet && st.fam !== 'bomb' ? 0.8 : 0, dz: sa, ex: pos.x + ox, ey: y0, ez: pos.y + oz, born: this.time, seed: (p.id * 0.618) % 1 * 6.283,
          ox, oz, tracer: every > 0 && shots % every === 0, sx: pos.x + ox, sz: pos.y + oz, team: this.teamOf(p.side),
          fx0: pos.x, fz0: pos.y, k0: clamp(pos.progress, 0, 1), mod: p.moduleId, side: p.side, kind: p.kind,
        };
        seen.set(p.id, rec);
        // every rocket / missile leaves its own tube: a launch flash, a backblast jet and a smoke cloud behind the pod
        if ((p.kind === 'rocket' || p.kind === 'missile') && !this.offscreen(pos.x, pos.y, 3)) {
          this.fx.launch(pos.x + ox, y0, pos.y + oz, ca, sa, st.s, p.kind === 'missile' ? (st.fam === 'bigMissile' ? 2 : 1) : 0);
        }
      }
      if (rec.hit) continue; // burst on a hull (drawn by the event that ends it in the sim)
      if (this.offscreen(pos.x, pos.y, 4)) { rec.px = rec.ex = pos.x; rec.py = rec.ez = pos.y; continue; }
      // homing missiles turn onto their target after launch: keep re-reading its body height along the heading (they
      // dive into the hull at that height, not at its feet: a titan stands several cells tall)
      if (p.kind === 'missile' && byId) rec.hEnd = this.aimHeightAlong(pos.x, pos.y, pos.angle, byId, p.side, rec.hEnd, rec.air);
      const st = rec.st, sz = st.s;
      const kp = clamp(pos.progress, 0, 1);
      const age = this.time - rec.born;
      // height (from the interpolated snapshot: the sim's own z / progress are a tick ahead of x, y). Lofted rounds
      // (shells, rockets, missiles) ride their sim altitude on top of the line from the barrel down to the ground
      // (missiles: down to their target's body height)
      const lofts = !rec.air && (p.kind === 'arc' || p.kind === 'rocket' || p.kind === 'missile');
      let H: number;
      if (rec.bomblet || st.fam === 'bomb') H = pos.z + 0.12 + rec.bh * (1 - kp);
      else if (lofts) H = lerp(rec.y0, p.kind === 'missile' ? rec.hEnd : 0.15, kp) + pos.z;
      else H = lerp(rec.y0, rec.hEnd, kp);
      // eased from the barrel tip onto the sim's path over the first ~0.15 s
      const ease = age < 0.15 ? 1 - age / 0.15 : 0;
      let X = pos.x + rec.ox * ease * ease, Z = pos.y + rec.oz * ease * ease;
      // rockets and swarm missiles don't fly on rails: a little corkscrew wobble round the true path (none at the ends)
      if (p.kind === 'rocket' || (p.kind === 'missile' && st.def?.id === 'swarm')) {
        const env = Math.sin(Math.PI * kp), ca = Math.cos(pos.angle), sa = Math.sin(pos.angle);
        const w = (p.kind === 'rocket' ? 0.07 : 0.05) * env;
        const ph = age * 19 + rec.seed;
        X += -sa * Math.sin(ph) * w; Z += ca * Math.sin(ph) * w;
        H += Math.cos(ph * 0.83) * w * 0.7;
      }
      // a round that reaches an enemy hull's hit box stops there: it doesn't fly on through the model (the sim's contact
      // test has already burst it, or will within a tick)
      if (byId && age > 0.05 && this.stopsOnHulls(p, rec, kp, pos.z)) {
        // arcing rounds fly a straight ground track to their aim point: extrapolated from where they were first seen
        const f = p.kind === 'arc' && kp - rec.k0 > 0.05 ? (1 - rec.k0) / (kp - rec.k0) : NaN;
        const hit = this.boxHit(rec, X, H, Z, byId, rec.fx0 + (pos.x - rec.fx0) * f, rec.fz0 + (pos.y - rec.fz0) * f);
        if (hit) { rec.hit = hit; continue; }
      }
      // orientation: along the round's actual 3D velocity (smoothed), so lofted rounds pitch up, over and down. The
      // heading is the sim's; climb and sideways drift come from the motion since the last frame, measured only while it
      // moves forward (a new tick's snapshot can step the interpolation back a hair)
      {
        const ca = Math.cos(pos.angle), sa = Math.sin(pos.angle);
        const mx = X - rec.px, my = H - rec.lastH, mz = Z - rec.py;
        const fwd = mx * ca + mz * sa;
        let tx = ca, ty = 0, tz = sa;
        if (fwd > 1e-4 && fwd < 3) {
          const lat = clamp((-mx * sa + mz * ca) / fwd, -0.6, 0.6), slope = clamp(my / fwd, -4, 4);
          tx = ca - sa * lat; ty = slope; tz = sa + ca * lat;
        } else ty = rec.dy / Math.max(0.2, Math.hypot(rec.dx, rec.dz));
        const tl = Math.hypot(tx, ty, tz);
        const s = Math.min(1, 0.5 * fdt * 60 + 0.1);
        rec.dx += (tx / tl - rec.dx) * s; rec.dy += (ty / tl - rec.dy) * s; rec.dz += (tz / tl - rec.dz) * s;
        const l = Math.hypot(rec.dx, rec.dy, rec.dz) || 1;
        rec.dx /= l; rec.dy /= l; rec.dz /= l;
      }
      const dx = rec.dx, dy = rec.dy, dz = rec.dz;
      const emit = Math.random() < Math.min(1, fdt * 60);
      /** point `b` cells behind the head along the flight direction */
      const bx = (b: number) => X - dx * b, by = (b: number) => H - dy * b, bz = (b: number) => Z - dz * b;
      // streaks never reach back behind the barrel the round left
      const flown = Math.hypot(X - rec.sx, Z - rec.sz) + 0.05;
      const tracer = (len: number, w: number, r: number, g: number, b: number) => { len = Math.min(len, flown); proj.streak(bx(len), by(len), bz(len), X, H, Z, w, r, g, b); };
      /** a calibre-sized round: a short soft streak `len` long behind the head, half-width w, colour as given */
      const roundT = (len: number, w: number, r: number, g: number, b: number) => { len = Math.min(len, flown); proj.round(bx(len), by(len), bz(len), X, H, Z, w, r, g, b); };
      /** trail puffs laid every `sp` cells along the path since the last frame, from `back` cells behind the head */
      const trailAlong = (back: number, kind: TrailKind, size: number, sp: number) => {
        const tx = bx(back), ty = by(back), tz = bz(back);
        const ex = tx - rec.ex, ey = ty - rec.ey, ez = tz - rec.ez, d = Math.hypot(ex, ey, ez);
        if (d > 6) { rec.ex = tx; rec.ey = ty; rec.ez = tz; return; }
        const step = sp / Math.max(0.35, lod);
        const n = Math.min(10, Math.floor(d / step));
        for (let i = 1; i <= n; i++) {
          const f = (i * step) / d;
          this.fx.trail(rec.ex + ex * f, rec.ey + ey * f, rec.ez + ez * f, kind, size);
        }
        if (n > 0) { const f = (n * step) / d; rec.ex += ex * f; rec.ey += ey * f; rec.ez += ez * f; }
      };
      switch (p.kind) {
        case 'bullet': {
          // Rounds are sized by the calibre of the gun that fires them (width ~ the barrel's bore) and carry only a short
          // tail. Fast guns load a tracer every Nth round (by fire rate): same size as the ball rounds between them,
          // just brighter. Machine guns / rotaries / the sniper fire FLASH rounds (see FLASH).
          const T = rec.tracer, w = st.rw * 0.6, tn = st.tint;
          const red = rec.team === 1 ? 0.85 : 1;
          const gk = st.fam === 'gatling' ? 0.6 + 0.4 * rec.k : 1;
          const lum = (T ? 2.6 : 1.1) * gk;
          const r = tn[0] * lum, g = tn[1] * lum * red, bl = tn[2] * lum * red;
          if (FLASH.has(st.fam)) {
            // where the round ends: from the sim's progress since first seen (straight line, constant speed)
            const ca = Math.cos(pos.angle), sa = Math.sin(pos.angle);
            const dk = kp - rec.k0;
            const travelled = Math.hypot(pos.x - rec.fx0, pos.y - rec.fz0);
            const left = dk > 0.02 ? (1 - kp) * (travelled / dk) : (st.def?.range ?? 8) * (1 - kp);
            const ex = pos.x + ca * left, ez = pos.y + sa * left;
            const sx = rec.sx, sy = rec.y0, sz0 = rec.sz;
            const L = Math.max(0.1, Math.hypot(ex - sx, ez - sz0));
            if (st.fam === 'sniper' && !rec.laid) { rec.laid = true; this.fx.sniperShot(sx, sy, sz0, ex, rec.hEnd, ez, rec.team === 1); }
            const chunk = clamp(0.5 * L, 1.0, 4.5) / L; // fraction of the path the flash spans
            const th = age / FLASH_T, tt = th - chunk;
            if (tt < 1) {
              const a0 = Math.max(0, tt), a1 = Math.min(1, th);
              const fade = 1 - 0.5 * clamp(tt, 0, 1);
              const ax = lerp(sx, ex, a0), ay = lerp(sy, rec.hEnd, a0), az = lerp(sz0, ez, a0), hx = lerp(sx, ex, a1), hy = lerp(sy, rec.hEnd, a1), hz = lerp(sz0, ez, a1);
              // a wide warm glow under a hot core: the tracer reads as a glowing bolt, not a hairline
              proj.round(ax, ay, az, hx, hy, hz, w * 3.2, r * fade * 0.35, g * fade * 0.3, bl * fade * 0.25);
              proj.round(ax, ay, az, hx, hy, hz, w * 1.2, r * fade, g * fade, bl * fade);
            }
            break;
          }
          switch (st.fam) {
            case 'shotgun': roundT(st.rw * 3, w, r, g, bl); break; // a spray of short pellet dashes
            case 'flechette': roundT(st.rw * 12, w * 0.5, r, g, bl); break; // thin steel needles
            case 'ac': roundT(st.rw * (T ? 12 : 9), w, r, g * 0.9, bl * 0.8); break; // HE autocannon: every round a glowing slug
            default: roundT(st.rw * 8, w * 2.6, r * 0.3, g * 0.26, bl * 0.22); roundT(st.rw * 10, w, r, g, bl); break;
          }
          break;
        }
        case 'shell': {
          // shells: a body the size of the bore (rw) and a short base-tracer streak behind it
          const rw = st.rw;
          if (st.fam === 'gauss') { // magnetic slug: a bright blue streak, glowing head and an ionised sparkle trail
            roundT(rw * 14, rw * 0.6, 0.6, 0.85, 1.6);
            this.fx.glow(X, H, Z, 0.2 + sz * 0.15, dt * 2.2, RAMPS.gauss);
            trailAlong(0.4, 'gauss', 0.8 + sz, 0.3);
          } else if (st.fam === 'flak') { // small dark shell with a fuse spark
            proj.body(X, H, Z, dx, dy, dz, rw * 3, rw, 0.25, 0.25, 0.22);
            roundT(rw * 2.5, rw * 0.45, 1.6, 0.95, 0.4);
          } else if (st.fam === 'he') { // olive HE shell, short orange tracer, a smoke wisp
            proj.body(X, H, Z, dx, dy, dz, rw * 3.2, rw, 0.55, 0.55, 0.35);
            roundT(rw * 4, rw * 0.45, 1.7, 0.85, 0.3);
            trailAlong(0, 'shell', 0.4 + sz * 0.6, 0.35);
          } else if (st.def?.id === 'siege240') { // 240 mm siege shell: black with yellow hazard stripes, a heat-glow nose, hot tracer
            proj.shell('ogive', X, H, Z, dx, dy, dz, rw * 4.2, rw, 0, LOOK.siege);
            roundT(rw * 7, rw * 0.5, 1.9, 0.65, 0.2);
            trailAlong(rw * 2, 'shell', 0.5 + sz * 0.5, 0.35);
          } else { // AP shot: slim bright penetrator with a hot red tank tracer
            proj.body(X, H, Z, dx, dy, dz, rw * 3.5, rw * 0.8, 0.9, 0.8, 0.55);
            roundT(rw * 5, rw * 0.45, 1.8, 0.6, 0.25);
          }
          break;
        }
        case 'arc': {
          switch (st.fam) {
            case 'grenade': { // small olive grenade tumbling end over end with a fuse spark
              const a = age * 14 + rec.seed, c = Math.cos(a);
              proj.body(X, H, Z, dx * c, Math.sin(a), dz * c, 0.13, 0.1, 0.35, 0.42, 0.25);
              trailAlong(0, 'spark', 0.8, 0.25);
              break;
            }
            case 'firebomb': { // incendiary bomb already alight: a flickering orange-red casing, a flame tongue off the tail, embers
              const d = Math.max(0.13, st.rw * 2), len = d * 2.6;
              proj.shell('bomb', X, H, Z, dx, dy, dz, len, d, age * 6 + rec.seed, LOOK.fire);
              const fl = 0.7 + 0.6 * Math.random(), t0 = len * 0.4, t1 = t0 + 0.3 * fl;
              proj.streak(bx(t1), by(t1), bz(t1), bx(t0), by(t0), bz(t0), d * 0.3 * fl, 1.2, 0.32, 0.05);
              this.fx.glow(bx(len * 0.6), by(len * 0.6), bz(len * 0.6), 0.32, dt * 2.2, RAMPS.ember);
              trailAlong(len * 0.8, 'firebomb', 0.85, 0.2);
              if (emit && Math.random() < 0.6 * lod) this.fx.trail(bx(len * 0.5), by(len * 0.5), bz(len * 0.5), 'spark', 1.3);
              break;
            }
            case 'bomb': { // dropped bomb, nose tipping down as it falls, its fins turning it slowly; stun / EMP bombs crackle
              const stun = !!st.def?.stun, wh = warheadOf(st.def);
              const d = 0.08 + 0.07 * wh * (st.def?.pellets ? 0.5 : 1), len = d * 3;
              proj.shell('bomb', X, H, Z, dx, dy, dz, len, d, age * 3 + rec.seed, stun ? LOOK.stunBomb : wh > 1.2 ? LOOK.bigBomb : LOOK.bomb);
              if (stun) {
                this.fx.glow(X, H, Z, d * 3, dt * 2.2, ORB_HALO.emp);
                if (Math.random() < fdt * (st.def?.pellets ? 2 : 6)) this.fx.arcs(X, H, Z, d * 1.4, d * 1.4);
              }
              break;
            }
            case 'cluster':
              if (rec.bomblet) { // bomblet: a tiny dark pellet tumbling, with a spark trail
                const a = age * 20 + rec.seed, c = Math.cos(a);
                proj.body(X, H, Z, dx * c, Math.sin(a), dz * c, 0.1, 0.08, 0.3, 0.3, 0.28);
                trailAlong(0, 'spark', 0.9, 0.25);
              } else { // grey yellow-banded cargo canister with a faint tracer and a smoke streamer: it splits open on the way down
                const d = st.rw * 1.35, len = d * 4.2;
                const split = clamp((kp - 0.72) / 0.28, 0, 1);
                if (split <= 0) {
                  proj.shell('ogive', X, H, Z, dx, dy, dz, len, d, 0, LOOK.cluster);
                  proj.streak(bx(len * 0.5 + 0.5 + sz * 0.4), by(len * 0.5 + 0.5 + sz * 0.4), bz(len * 0.5 + 0.5 + sz * 0.4), bx(len * 0.45), by(len * 0.45), bz(len * 0.45), 0.05 + sz * 0.04, 0.9, 0.45, 0.12);
                } else {
                  // the casing halves peel apart sideways, the bomblets spill out and fan between them (the sim scatters
                  // the real bomblets where the cargo shell lands)
                  const ca = Math.cos(pos.angle), sa = Math.sin(pos.angle), o = split * (0.15 + 0.6 * split);
                  for (let s = -1; s <= 1; s += 2) {
                    proj.shell('ogive', X - sa * s * o, H + 0.1 * split, Z + ca * s * o, dx - sa * s * split * 0.9, dy + 0.3 * split, dz + ca * s * split * 0.9, len, d * 0.75, s * split * 2, LOOK.cluster);
                  }
                  for (let i = 0; i < 6; i++) {
                    const a = rec.seed + i * 1.047 + age * 3, r = o * (0.5 + 0.12 * (i % 3)), b = (i - 2.5) * 0.06 * split;
                    const c = Math.cos(a), sn = Math.sin(a);
                    const t = age * 18 + i;
                    proj.body(X - sa * c * r - dx * b, H + sn * r * 0.7 - dy * b, Z + ca * c * r - dz * b, Math.cos(t), Math.sin(t), 0.4, 0.08, 0.06, 0.26, 0.26, 0.22);
                  }
                  this.fx.glow(X, H, Z, 0.3 + 0.4 * (1 - split), dt * 2.2, RAMPS.flash);
                }
                trailAlong(0.2, 'heavyShell', 0.8 + sz, 0.3);
              }
              break;
            case 'mortar': { // stubby finned bomb lobbed high, turning on its fins; the shock mortar's waist band pulses electric blue
              const shock = !!st.def?.stun;
              const d = Math.max(0.09, st.rw * 1.45), len = d * 2.7;
              proj.shell('bomb', X, H, Z, dx, dy, dz, len, d, age * 8 + rec.seed, shock ? LOOK.shock : LOOK.mortar);
              if (shock) {
                this.fx.glow(X, H, Z, 0.2 + 0.1 * sz, dt * 2.2, ORB_HALO.emp);
                if (Math.random() < fdt * 3) this.fx.arcs(X, H, Z, d * 1.2, d * 1.2);
              } else this.fx.glow(bx(len * 0.5), by(len * 0.5), bz(len * 0.5), 0.18 + 0.1 * sz, dt * 2.2, RAMPS.exhaust);
              trailAlong(len * 0.5, 'heavyShell', 0.55 + sz, 0.2);
              break;
            }
            default: { // howitzer / barrage / doomsday: a big painted shell, a glowing base-bleed tracer and a lazy grey streamer
              const doom = st.def?.mount === 'XL', bar = (st.def?.pellets ?? 1) > 1;
              const d = st.rw * (bar ? 1.2 : 1.3), len = d * (doom ? 4.4 : bar ? 3.6 : 5);
              proj.shell('ogive', X, H, Z, dx, dy, dz, len, d, 0, doom ? LOOK.doom : bar ? LOOK.barrage : LOOK.longTom);
              const t0 = len * 0.45, t1 = t0 + (bar ? 0.35 : 0.7 + sz * 0.5);
              proj.round(bx(t1), by(t1), bz(t1), bx(t0), by(t0), bz(t0), d * (bar ? 0.4 : 0.45), 1.7, bar ? 0.75 : 0.6, 0.14);
              if (doom) this.fx.glow(bx(len * 0.55), by(len * 0.55), bz(len * 0.55), d * 2.4, dt * 2.2, RAMPS.ember); // its incendiary fill burning at the base
              trailAlong(len * 0.5, 'heavyShell', (bar ? 0.6 : 0.8) + sz, 0.2);
              break;
            }
          }
          break;
        }
        case 'rocket': { // stubby rocket: a flickering flame tongue and a thin, fast-fading exhaust streak (by warhead size)
          const inc = st.fam === 'incend';
          const len = 0.36 + 0.22 * sz;
          proj.shell('rocket', X, H, Z, dx, dy, dz, len, 0.07 + 0.06 * sz, age * 7 + rec.seed, inc ? LOOK.incend : st.def?.id === 'mlrs' ? LOOK.mlrs : LOOK.rocket);
          // burn: the motor roars hardest early on, the flame tongue flickers every frame
          const fl = (0.7 + 0.6 * Math.random()) * (1.2 - 0.35 * kp);
          const t0 = len * 0.5, t1 = t0 + (0.22 + 0.2 * sz) * fl;
          proj.streak(bx(t1), by(t1), bz(t1), bx(t0), by(t0), bz(t0), (0.03 + sz * 0.025) * fl, 1, inc ? 0.3 : 0.5, 0.1);
          this.fx.glow(bx(t0 + 0.08), by(t0 + 0.08), bz(t0 + 0.08), (0.22 + 0.18 * sz) * fl, dt * 2.2, inc ? RAMPS.ember : RAMPS.exhaust);
          trailAlong(t0 + 0.12, inc ? 'incend' : 'rocket', 0.5 + warheadOf(st.def) * 0.8, 0.12);
          break;
        }
        case 'missile': { // slim white missile: a white-hot exhaust plume (fierce in the boost) and a thin exhaust streak (by warhead size)
          const big = st.fam === 'bigMissile', nuke = st.def?.id === 'tactnuke';
          const len = ((big ? 0.6 : 0.4) + 0.3 * sz) * (nuke ? 1.15 : 1);
          const md = ((big ? 0.1 : 0.05) + 0.05 * sz) * (nuke ? 1.5 : 1);
          if (big) { // cruise missile / tactical nuke: a finned body in its own paint (the nuke wrapped in a sickly glow)
            proj.shell('rocket', X, H, Z, dx, dy, dz, len, md, nuke ? age * 1.5 : 0, nuke ? LOOK.nuke : LOOK.cruise);
            if (nuke) this.fx.glow(X, H, Z, len * (1 + 0.15 * Math.sin(age * 6)), dt * 2.2, RAMPS.rad);
          } else proj.body(X, H, Z, dx, dy, dz, len, md, 0.95, 0.95, 0.92);
          const boost = Math.max(0, 1 - age / (big ? 0.9 : 0.6));
          const fl = (0.8 + 0.4 * Math.random()) * (1 + 0.9 * boost);
          const t0 = len * 0.5, t1 = t0 + (big ? 0.45 : 0.25) * (0.6 + sz) * fl;
          proj.streak(bx(t1), by(t1), bz(t1), bx(t0), by(t0), bz(t0), (0.025 + sz * 0.03) * fl * (big ? 1.6 : 1), 1, 0.9, 0.7);
          this.fx.glow(bx(t0 + 0.06), by(t0 + 0.06), bz(t0 + 0.06), (big ? 0.45 : 0.24) * (0.6 + sz) * fl, dt * 2.2, RAMPS.flash);
          trailAlong(t0 + 0.08, big ? 'bigMissile' : 'missile', (0.5 + warheadOf(st.def) * 0.8) * (1 + 0.3 * boost), big ? 0.14 : 0.1);
          break;
        }
        case 'flame': // two puffs a frame: a dense, rolling jet
          if (emit) this.fx.flameJet(X, H, Z, kp, 0.7 + sz, st.def?.id === 'napalm' || st.def?.id === 'inferno');
          if (emit && Math.random() < 0.6 * lod) this.fx.flameJet(X - dx * 0.2, H, Z - dz * 0.2, clamp(pos.progress - 0.05, 0, 1), 0.7 + sz, false);
          break;
        case 'orb': {
          if (st.fam === 'sonic') { // pressure wave: a pale shimmering ball that leaves ripples
            this.fx.glow(X, H, Z, 0.4 + sz * 0.6, dt * 2.2, RAMPS.sonic);
            if (Math.random() < fdt * 9) this.fx.sonicPulse(X, H, Z, 0.6 + sz);
            break;
          }
          // the energy ball itself (white-hot core, shimmering rim) in a halo of its own hue and a short shimmering wake:
          // EMP pale blue (crackling), the plasma cannon magenta, the siege projector a big cyan mass
          const emp = st.fam === 'empOrb', siege = !emp && st.def?.mount !== 'M' && st.def?.mount !== 'S';
          const ramp: Ramp = emp ? ORB_HALO.emp : siege ? ORB_HALO.siege : ORB_HALO.plasma;
          const orr = (emp ? 0.07 : 0.08) + sz * (siege ? 0.14 : 0.08);
          const oc = emp ? ORB_COL.emp : siege ? ORB_COL.siege : ORB_COL.plasma;
          proj.orb(X, H, Z, orr * (1 + 0.08 * Math.sin(age * 31 + rec.seed)), oc[0], oc[1], oc[2]);
          const sh = 0.75 + 0.25 * Math.sin(age * 43 + rec.seed), tl = orr * (siege ? 6 : 5);
          proj.round(bx(tl), by(tl), bz(tl), bx(orr * 0.5), by(orr * 0.5), bz(orr * 0.5), orr * 0.7 * sh, oc[0] * 0.45, oc[1] * 0.45, oc[2] * 0.45);
          // the halo: kept a little wider than the ball, so the coloured energy ball itself stays readable
          this.fx.glow(X, H, Z, orr * (siege ? 3.6 : 2.6) + 0.1, dt * 2.2, ramp);
          if (emit) this.fx.trail(bx(orr * 2), by(orr * 2), bz(orr * 2), 'orb', 0.35 + sz * 0.4, ramp);
          if (st.fam === 'empOrb' && Math.random() < fdt * 10) this.fx.arcs(X, H, Z, 0.25 + sz * 0.3, 0.25 + sz * 0.3);
          break;
        }
        default: break;
      }
      // lofted rounds cast a soft shadow on the ground under them: it reads the arc's height from above
      if (lofts && pos.z > 0.25 && !rec.bomblet) this.fx.shadow(X, Z, (p.kind === 'arc' ? 0.28 : 0.22) + 0.15 * sz, 0.32 / (1 + 0.35 * pos.z), fdt);
      rec.lastH = H; rec.px = X; rec.py = Z;
    }
    proj.end();
    for (const id of seen.keys()) if (!alive.has(id)) seen.delete(id);
    if (this.clusterPts.length && this.time - this.clusterPts[0].t > 0.6) this.clusterPts = this.clusterPts.filter((c) => this.time - c.t <= 0.6);
  }

  private _lastFrameDt = 1 / 60;
  private frameDt(): number { return this._lastFrameDt; }

  /* ---------------------------------------------------------------------------------------------- wrecks */

  private syncWrecks(dt: number): void {
    for (const w of this.wrecks) {
      if (w.heat > 0) w.heat = Math.max(0, w.heat - dt * 0.16);
      if (w.fire > 0) w.fire -= dt;
      if (w.smoke > 0) w.smoke -= dt;
      if (this.offscreen(w.x, w.z, (w.rig?.radius ?? w.S) + 3)) continue;
      if (w.rig) {
        // the wreck look reads the instance colour as data: char amount, ember heat, soot-pattern seed
        w.rig.tr = w.char; w.rig.tg = w.heat; w.rig.tb = (w.lv + w.seed * 0.98) / 4;
        this.layer.submit(w.rig, 'wreck');
      }
      if (w.smoke > 0) {
        // thin columns out of two or three holes / hatches (seeded per wreck): black and oily while fresh, thinning to
        // a grey wisp as it burns out
        const k = w.smoke / Math.max(1, w.smoke0), n = w.lv === 0 ? 2 : 3;
        const ca = Math.cos(w.ang), sa = Math.sin(w.ang);
        for (let i = 0; i < n; i++) {
          const r1 = (w.seed * 7.31 + i * 0.618) % 1, r2 = (w.seed * 3.17 + i * 0.382) % 1;
          if (Math.random() > dt * (0.9 + 0.35 * w.S) * (0.4 + 0.6 * k) * (i === 0 ? 1.4 : 0.8) * this.fx.lod) continue;
          const lx = (r1 - 0.5) * w.hx * 1.3, lz = (r2 - 0.5) * w.hz * 1.3;
          this.fx.wisp(w.x + lx * ca - lz * sa, w.deck + 0.05, w.z + lx * sa + lz * ca, k > 0.55 ? 'black' : k > 0.25 ? 'oil' : 'steam', (0.4 + 0.6 * k) * (0.6 + 0.2 * Math.min(4, w.S)));
        }
      }
      if (w.fire > 0 && Math.random() < dt * (3 + w.hx * w.hz * 6) * this.fx.lod) this.fx.burning(w.x, w.deck, w.z, w.hx, w.hz);
    }
  }

  /* ----------------------------------------------------------------------------------------- falling aircraft */

  /** An aircraft killed short of being blown to bits: a burst at its altitude, then it keeps its momentum and falls
   *  burning (jets glide on, nose dropping and rolling over; helicopters lose lift and spin down), trailing fire and
   *  black smoke, and blows up again where it hits the ground, leaving a wreck. */
  private startFall(e: Extract<BattleEvent, { t: 'death' }>, v: UView, du: SimUnit | undefined): void {
    const rig = v.rig, fx = this.fx, lv = e.wreck;
    const p = rig.root.position;
    const heli = du ? du.design.mobility !== 'jet' : true;
    const paint = du ? this.paintOf(du.side) : undefined;
    // momentum: the drawn motion over the last snapshot pair, in cells per real second
    const c = this.curU.get(e.unit), pr = this.prevU.get(e.unit);
    let vx = 0, vz = 0;
    if (c && pr && this.curTick > this.prevTick) {
      const k = this.tickRate / (this.curTick - this.prevTick);
      vx = (c.x - pr.x) * k; vz = (c.y - pr.y) * k;
    }
    const ang = du?.angle ?? -rig.root.rotation.y;
    const sp = Math.hypot(vx, vz);
    if (!heli && sp < 3) { vx = Math.cos(ang) * 4.5; vz = Math.sin(ang) * 4.5; }
    if (heli) { vx *= 0.6; vz *= 0.6; }
    // the hit that killed it: a burst at altitude (bigger the more it broke up)
    const y = p.y + rig.midY;
    if (lv === 0) { fx.warheadHit(p.x, y, p.z, vx, vz, 0.35 + rig.S * 0.15, 'he', true); }
    else fx.explosion(p.x, p.z, 0.45 + rig.S * (lv === 2 ? 0.45 : 0.3), 'fire', y - 0.1, true, lv === 2 ? 1 : 0.7, paint, true);
    if (lv === 2) fx.scatter(p.x, p.z, y, Math.round(4 + rig.S * 2), rig.radius * 1.6 + 0.4, 0.12 + rig.S * 0.06, 0, paint);
    const R0 = (a: number, b: number) => a + Math.random() * (b - a);
    rig.root.rotation.order = 'YXZ';
    this.fallers.push({
      rig, x: p.x, y: p.y, z: p.z, vx, vy: heli ? R0(-0.3, 0.3) : R0(0.2, 0.8), vz,
      yaw: ang, pitch: 0, roll: 0,
      wy: heli ? R0(2.5, 4) * (Math.random() < 0.5 ? -1 : 1) : R0(-0.4, 0.4),
      wp: heli ? R0(-0.3, 0.3) : -R0(0.5, 0.9), wr: heli ? R0(-0.6, 0.6) : R0(1.4, 3.2) * (Math.random() < 0.5 ? -1 : 1),
      heli, S: rig.S, lv, kind: e.kind, t: 0, g: heli ? 5.5 : 3.6, fire: lv === 0 ? 0.6 : 1, paint,
    });
  }

  private syncFallers(dt: number): void {
    if (!this.fallers.length) return;
    const fx = this.fx;
    for (let i = this.fallers.length - 1; i >= 0; i--) {
      const f = this.fallers[i], rig = f.rig;
      f.t += dt;
      // gravity (a jet's wings still give a little lift while it is level), air drag, tumbling
      const lift = f.heli ? 0 : Math.max(0, Math.cos(f.pitch)) * Math.max(0, 1 - f.t * 0.5) * 0.45;
      f.vy -= f.g * (1 - lift) * dt;
      const drag = Math.max(0, 1 - dt * (f.heli ? 0.8 : 0.25));
      f.vx *= drag; f.vz *= drag;
      f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
      if (f.heli) f.wy *= 1 + dt * 0.9; // autorotating faster and faster
      f.yaw += f.wy * dt; f.roll += f.wr * dt;
      f.pitch = Math.max(-1.1, f.pitch + f.wp * dt);
      f.fire = Math.min(1, f.fire + dt * 0.8);
      const ground = 0.05;
      if (f.y <= ground) {
        // impact: a second, bigger blast, dirt thrown up, the wreck left nose-in where it came down
        if (!this.offscreen(f.x, f.z, 4)) {
          fx.explosion(f.x, f.z, 0.55 + f.S * 0.45, 'fire', 0, true, 1, f.paint);
          fx.dirtGeyser(f.x, f.z, 0.5 + f.S * 0.3);
          fx.shockwave(f.x, f.z, 0.4 + f.S * 0.25);
          // the wreck slamming in is a second boom (the death event only shook for the burst at altitude)
          this.shake.add(f.x, f.z, 0.7 + f.S * 0.4);
        }
        this.fallers.splice(i, 1);
        const lv: WreckLevel = f.lv >= 2 ? 2 : 1;
        const sp = Math.hypot(f.vx, f.vz);
        // jets plough a little way on and dig their nose in; helicopters drop flat and break up
        if (!f.heli && sp > 0.5) { f.x += (f.vx / sp) * 0.4; f.z += (f.vz / sp) * 0.4; }
        fx.scorchMark(f.x, f.z, 0.5 + f.S * 0.35);
        this.toWreck(-1, rig, f.x, f.z, f.yaw, lv, 'explosive', false, f.heli ? 0 : -0.22);
        continue;
      }
      if (this.offscreen(f.x, f.z, rig.radius + 4)) continue;
      rig.root.position.set(f.x, f.y, f.z);
      rig.root.rotation.set(f.roll, -f.yaw, f.pitch);
      rig.locomote(0, false, this.time, dt);
      const fl = 0.25 * Math.max(0, Math.sin(this.time * 31 + i * 3));
      rig.tr = 0.42 + fl; rig.tg = 0.36 + fl * 0.5; rig.tb = 0.33;
      rig.update(dt);
      this.layer.submit(rig, 'normal');
      // fire and smoke streaming off it (laid along the path so a fast jet leaves a continuous trail)
      const n = Math.min(4, Math.ceil(dt * 50 * this.fx.lod));
      for (let k = 0; k < n; k++) {
        const b = (k / n) * dt;
        fx.crashTrail(f.x - f.vx * b, f.y + rig.midY - f.vy * b, f.z - f.vz * b, Math.min(2.5, f.S), f.fire);
      }
    }
  }

  /* ------------------------------------------------------------------------------------------------ events */

  private unitHeight(unit: number, byId: Map<number, SimUnit>, fallback = 0.45): number {
    const v = this.bu.get(unit), su = byId.get(unit);
    if (!v || !su) return fallback;
    return su.flying ? flyHeight(v.rig.S, v.rig.jet) + 0.4 + v.rig.midY : Math.min(v.rig.height * 0.6, Math.max(0.7, v.rig.height * 0.35));
  }

  /** A drawn unit's rough hit box for rounds (cached per frame): a rotated rectangle inside both its solid parts (80%)
   *  and the sim's footprint box (hullK x footprint), from the ground (aircraft: 15% up the airframe) to 85% of its
   *  height. Where it is drawn this frame (interpolated), like the model. */
  private hullBox(u: SimUnit): HullBox | null {
    let b = this.boxes.get(u.id);
    if (b !== undefined) return b;
    const v = this.bu.get(u.id);
    b = null;
    if (v) {
      const rig = v.rig, c = this.curU.get(u.id), pr = this.prevU.get(u.id) ?? c;
      let x = u.x, y = u.y, ang = u.angle;
      if (c && pr) {
        const a = this.alpha;
        if (Math.hypot(c.x - pr.x, c.y - pr.y) > 3) { x = c.x; y = c.y; } else { x = lerp(pr.x, c.x, a); y = lerp(pr.y, c.y, a); }
        ang = lerpAngle(pr.angle, c.angle, a);
      }
      const [x0, x1, y0, y1, z0, z1] = rig.hull;
      const base = u.flying ? flyHeight(rig.S, rig.jet) + 0.4 : u.leap * 1.8 * rig.S;
      const lo = u.flying ? y0 : Math.max(0, y0), h = Math.max(0.3, y1 - lo);
      b = {
        x, z: y, ca: Math.cos(ang), sa: Math.sin(ang),
        cx: clamp((x0 + x1) / 2, -0.1 * rig.L, 0.1 * rig.L), cz: clamp((z0 + z1) / 2, -0.1 * rig.W, 0.1 * rig.W),
        hx: Math.max(0.15, Math.min(0.4 * (x1 - x0), 0.45 * rig.L)), hz: Math.max(0.15, Math.min(0.4 * (z1 - z0), 0.45 * rig.W)),
        y0: base + lo + (u.flying ? 0.15 * h : 0), y1: base + lo + 0.85 * h,
      };
    }
    this.boxes.set(u.id, b);
    return b;
  }

  /** which drawn rounds stop at an enemy hull they fly into, by the sim's contact rules: missiles, shells and orbs at
   *  any (not piercing ones), rockets once down low enough to touch (ROCKET_OVERFLY), arcing shells and bombs only on
   *  their way down onto the hull they land on */
  private stopsOnHulls(p: SimProjectile, rec: ProjRec, k: number, z: number): boolean {
    if (!HULL_KINDS.has(p.kind) || rec.st.def?.pierce) return false;
    if (p.kind === 'rocket') return z <= ROCKET_OVERFLY && k > 0.3;
    if (p.kind === 'arc') return rec.bomblet || rec.st.fam === 'bomb' || k > 0.5;
    return true;
  }

  /** The enemy hull hit box (of the round's layer) the drawn round's last step (from where it was drawn last frame to
   *  X, H, Z) went into, and where. Arcing rounds only count the hull they land on (the sim bursts them at the aim
   *  point, estimated from their straight ground track). */
  private boxHit(rec: ProjRec, X: number, H: number, Z: number, byId: Map<number, SimUnit>, lx = NaN, lz = NaN): Impact | null {
    const px = rec.px, py = rec.lastH, pz = rec.py, dx = X - px, dy = H - py, dz = Z - pz;
    let best: Impact | null = null, bt = Infinity;
    for (const u of byId.values()) {
      if (!u.alive || u.side === rec.side || u.flying !== rec.air) continue;
      const v = this.bu.get(u.id);
      if (!v) continue;
      const reach = Math.max(v.rig.L, v.rig.W) * 0.75 + 1.5;
      if ((u.x - X) ** 2 + (u.y - Z) ** 2 > reach * reach) continue;
      const b = this.hullBox(u);
      if (!b || !rayBox(b, px, py, pz, dx, dy, dz) || RB.t1 < 0 || RB.t0 > 1) continue;
      if (!Number.isNaN(lx) && !inBox(b, lx, lz, 0.5)) continue;
      const t = Math.max(0, RB.t0), ex = px + dx * t, ez = pz + dz * t;
      // square hulls are a circle to the sim (hullK x size): a round clipping a box corner flies on past
      const sr = v.rig.L === v.rig.W ? 0.5 * v.rig.L : Infinity;
      if (t < bt && (ex - b.x) ** 2 + (ez - b.z) ** 2 <= sr * sr) {
        bt = t;
        const gl = Math.hypot(dx, dz) || 1;
        best = { x: ex, y: py + dy * t, z: ez, nx: dx / gl, nz: dz / gl, unit: u.id, top: RB.ax === 1 && dy < 0 };
      }
    }
    return best;
  }

  /** Where an air burst the sim set off at (x, y) is drawn: beside the aircraft it caught (the nearest flyer within its
   *  reach), at that hull's altitude and pulled in onto its drawn (interpolated) position, so the burst visibly hits the
   *  airframe; with no flyer near (a shell that ran out its flight), at the height its drawn round had climbed to. */
  private airBurstAt(x: number, y: number, R: number, moduleId: string, byId: Map<number, SimUnit>): { x: number; y: number; z: number } {
    let best: SimUnit | null = null, bd = Infinity;
    for (const u of byId.values()) {
      const v = u.flying ? this.bu.get(u.id) : undefined;
      if (!v) continue;
      const d = Math.hypot(u.x - x, u.y - y) - v.rig.radius;
      if (d < R + 1.2 && d < bd) { bd = d; best = u; }
    }
    if (best) {
      const v = this.bu.get(best.id)!, c = this.drawnAt(best);
      let ox = x - best.x, oz = y - best.y;
      const d = Math.hypot(ox, oz), lim = v.rig.radius * 0.75 + 0.2;
      if (d > lim) { ox *= lim / d; oz *= lim / d; }
      return { x: c.x + ox, y: this.unitHeight(best.id, byId) - 0.15 + (Math.random() - 0.5) * 0.3, z: c.y + oz };
    }
    let h = flyHeight(1.5) + 0.4, bd2 = 3.5 * 3.5;
    for (const [id, r] of this.projRec) {
      if (r.mod !== moduleId || this.curP.has(id)) continue;
      const d = (r.px - x) ** 2 + (r.py - y) ** 2;
      if (d < bd2) { bd2 = d; h = Math.max(0.8, r.lastH); }
    }
    return { x, y: h, z: y };
  }

  /** Where a shell / rocket / missile / orb that the sim burst at (x, y) struck a hull, on that hull's hit box: where its
   *  drawn flight (the round's record, gone from the sim this tick) enters the box, else the burst point brought onto the
   *  box. null: no such round, or it burst on open ground. `unit`: the unit a 'hit' event names (only that hull, and
   *  only with the round's record). The answer is kept on the record, so a round's 'explode' and 'hit' agree. */
  private impactFor(x: number, y: number, moduleId: string, byId: Map<number, SimUnit>, unit = -1): Impact | null {
    const kind = MODULE_BY_ID.get(moduleId)?.projectile as SimProjectile['kind'] | undefined;
    if (!kind || !HULL_KINDS.has(kind)) return null;
    const hv = unit >= 0 ? this.bu.get(unit) : undefined;
    const lim = 3.5 + (hv ? Math.max(hv.rig.L, hv.rig.W) * 0.5 : 0);
    let rec: ProjRec | null = null, bd = lim * lim;
    for (const [id, r] of this.projRec) {
      if (r.mod !== moduleId || this.curP.has(id)) continue;
      const qx = r.hit ? r.hit.x : r.px, qz = r.hit ? r.hit.z : r.py;
      const d = (qx - x) ** 2 + (qz - y) ** 2;
      if (d < bd) { bd = d; rec = r; }
    }
    if (rec && rec.imp !== undefined) return unit < 0 || rec.imp?.unit === unit ? rec.imp : null;
    if (!rec && unit >= 0) return null;
    // the struck hull: the burst point (sim) on its box (drawn a moment behind), a little padded
    let su: SimUnit | null = null, sb: HullBox | null = null, sd = Infinity;
    const air = rec ? rec.air : false;
    for (const u of unit >= 0 ? [byId.get(unit)!] : byId.values()) {
      const uv = u && this.bu.get(u.id);
      if (!u || !uv || (rec && u.side === rec.side) || (unit < 0 && u.flying !== air)) continue;
      const reach = Math.max(uv.rig.L, uv.rig.W) + 1;
      if ((u.x - x) ** 2 + (u.y - y) ** 2 > reach * reach) continue;
      const b = this.hullBox(u);
      if (!b) continue;
      const qx = x + b.x - u.x, qz = y + b.z - u.y;
      if (!inBox(b, qx, qz, unit >= 0 ? 0.8 : 0.35)) continue;
      const d = (qx - b.x) ** 2 + (qz - b.z) ** 2;
      if (d < sd) { sd = d; su = u; sb = b; }
    }
    let imp: Impact | null = null;
    if (su && sb) {
      const b = sb;
      if (rec?.hit && rec.hit.unit === su.id) imp = rec.hit;
      else if (rec && rayBox(b, rec.px, rec.lastH, rec.py, rec.dx, rec.dy, rec.dz) && RB.t0 > -6 && RB.t0 < 6) {
        // on along the drawn flight from where the round was last drawn (or back along it, if it was drawn inside)
        const gl = Math.hypot(rec.dx, rec.dz) || 1;
        imp = { x: rec.px + rec.dx * RB.t0, y: rec.lastH + rec.dy * RB.t0, z: rec.py + rec.dz * RB.t0, nx: rec.dx / gl, nz: rec.dz / gl, unit: su.id, top: RB.ax === 1 && rec.dy < 0 };
      } else {
        // no drawn flight to follow: the burst point brought onto the box -- the roof for rounds coming down, else its
        // side at the round's height (or 60% up)
        const top = kind === 'arc' && (!rec || rec.dy < -0.3);
        const ox = x - su.x, oz = y - su.y; // the burst point relative to the hull (sim), applied to the drawn box
        const lx = clamp(ox * b.ca + oz * b.sa - b.cx, -b.hx * 0.9, b.hx * 0.9) + b.cx, lz = clamp(-ox * b.sa + oz * b.ca - b.cz, -b.hz * 0.9, b.hz * 0.9) + b.cz;
        const gx = lx * b.ca - lz * b.sa, gz = lx * b.sa + lz * b.ca, gl = Math.hypot(gx, gz) || 1;
        const hy = top ? b.y1 : clamp(rec ? rec.lastH : b.y0 + 0.6 * (b.y1 - b.y0), b.y0 + 0.25 * (b.y1 - b.y0), b.y1);
        imp = { x: b.x + gx, y: hy, z: b.z + gz, nx: rec ? rec.dx : -gx / gl, nz: rec ? rec.dz : -gz / gl, unit: su.id, top };
      }
    }
    if (rec) rec.imp = imp;
    return imp;
  }

  /** body height of the first enemy (of a shooter on `side`) whose hull lies across a ray from (x, y) at `ang`; only
   *  units of the round's own layer (the sim's air rounds only hit aircraft, ground rounds only ground units) */
  private aimHeightAlong(x: number, y: number, ang: number, byId: Map<number, SimUnit>, side: Side, fallback: number, air: boolean): number {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let best = Infinity, id = -1;
    for (const u of byId.values()) {
      if (!u.alive || u.side === side || u.flying !== air) continue;
      const rx = u.x - x, ry = u.y - y, t = rx * dx + ry * dy;
      if (t <= 0 || t >= best) continue;
      const v = this.bu.get(u.id);
      if (Math.abs(rx * dy - ry * dx) < 0.5 + (v ? v.rig.radius : 0.5)) { best = t; id = u.id; }
    }
    if (id < 0 && air) {
      // a round aimed at aircraft with none right on its line (it leads a moving flyer): it still climbs to the
      // altitude of the flyer nearest its line ahead, not along the ground
      let bl = Infinity;
      for (const u of byId.values()) {
        if (!u.alive || u.side === side || !u.flying) continue;
        const rx = u.x - x, ry = u.y - y, t = rx * dx + ry * dy, lat = Math.abs(rx * dy - ry * dx);
        if (t > 0 && lat < bl && lat < 0.6 * t + 3) { bl = lat; id = u.id; }
      }
    }
    return id >= 0 ? this.unitHeight(id, byId, fallback) : fallback;
  }

  /** body height of the enemy (of a shooter on `side`) unit nearest to a ground point, for beam / bolt end points */
  private aimHeightAt(x: number, y: number, byId: Map<number, SimUnit>, side: Side | undefined, fallback = GUN_H): number {
    let best = Infinity, id = -1;
    for (const u of byId.values()) {
      if (!u.alive || u.side === side) continue;
      const d = Math.hypot(u.x - x, u.y - y);
      const v = this.bu.get(u.id);
      if (d < best && d < 1 + (v ? v.rig.radius : 1)) { best = d; id = u.id; }
    }
    return id >= 0 ? this.unitHeight(id, byId, fallback) : fallback;
  }

  /** A shot from (x1, y1) that the sim ends on a unit's centre (x2, y2): where it is drawn to end (that unit's shield
   *  bubble or hull side facing the shooter). Remembers the origin for the 'hit' that follows. */
  private shotEnd(x1: number, y1: number, x2: number, y2: number, byId: Map<number, SimUnit>): { x: number; y: number } {
    let best = 0.3 * 0.3, t: SimUnit | null = null;
    for (const u of byId.values()) { const d = (u.x - x2) ** 2 + (u.y - y2) ** 2; if (d < best) { best = d; t = u; } }
    const v = t && this.bu.get(t.id);
    if (!t || !v) return { x: x2, y: y2 };
    this.shotFrom.set(t.id, { x: x1, y: y1 });
    // the model is drawn interpolated (a tick behind the sim): end on it, not where the sim already has it
    const c = this.drawnAt(t);
    const d = Math.hypot(x1 - c.x, y1 - c.y);
    const r = t.shield > 0 || t.auraShield > 0 ? Math.max(v.rig.L, v.rig.W) * 0.58 + 0.18 : Math.min(v.rig.L, v.rig.W) * 0.42;
    if (d <= r) return c;
    return { x: c.x + ((x1 - c.x) / d) * r, y: c.y + ((y1 - c.y) / d) * r };
  }

  /** where a live unit is drawn this frame (the same interpolation poseUnit uses) */
  private drawnAt(u: SimUnit): { x: number; y: number } {
    const c = this.curU.get(u.id), pr = this.prevU.get(u.id) ?? c;
    if (!c || !pr || Math.hypot(c.x - pr.x, c.y - pr.y) > 3) return { x: u.x, y: u.y };
    return { x: lerp(pr.x, c.x, this.alpha), y: lerp(pr.y, c.y, this.alpha) };
  }

  /** a unit's rig, only if its transforms are current (muzzle positions of culled rigs are stale or at the origin) */
  private posedRig(id: number | undefined): Rig | undefined {
    const v = id === undefined ? undefined : this.bu.get(id);
    return v?.posed ? v.rig : undefined;
  }

  private handleEvent(e: BattleEvent, byId: Map<number, SimUnit>): void {
    const fx = this.fx;
    switch (e.t) {
      case 'fire': {
        const v = this.bu.get(e.unit);
        const st = styleOf(e.moduleId);
        // rotary guns track their spin even off screen (the tracers and barrel glow read it)
        const k = st.fam === 'gatling' ? this.spinShot(e.unit, e.mount, st.def?.spinUp ?? 1.5) : 1;
        if (!v) break;
        // multi-barrel guns take turns (the round and the flash leave the barrel that fired); pods and racks pick
        // their tube per round as the rounds appear
        const key = e.unit * 16 + e.mount;
        const launcher = st.fam === 'rocket' || st.fam === 'incend' || st.fam === 'missile' || st.fam === 'bigMissile';
        this.lastBarrel.set(key, launcher ? 0 : v.rig.nextBarrel(e.mount));
        if (this.offscreen(e.x, e.y, 3)) break;
        // recoil: the barrel slams back and runs out (slowly on heavy guns), heavy guns rock the whole hull
        const rc = RECOIL[st.fam] ?? [1, 9, 0, false];
        v.rig.kick(e.mount, rc[0] * (0.8 + 0.4 * Math.min(1.2, st.s)), rc[1]);
        // launchers: the warheads / missile / bombs leave the rack and are back once the weapon has reloaded
        if (st.def) v.rig.spent(e.mount, Math.max(st.def.cooldown ?? 1, st.def.reload ?? 0) * 0.9);
        const su = byId.get(e.unit);
        if (rc[2] > 0 && su && !su.flying && v.posed) v.rig.rock(normAng(e.angle - su.angle), rc[2] * st.s * 1.5 / Math.sqrt(Math.max(1, v.rig.S)));
        if (!st.muzzle) break; // beams / bolts / flame / melee draw their own flare
        const m = v.posed ? v.rig.muzzleWorld(e.mount, _v3, this.lastBarrel.get(key) ?? 0) : null;
        const ca = Math.cos(e.angle), sa = Math.sin(e.angle);
        if (m) fx.muzzleFx(m.x, m.y, m.z, ca, sa, st.s, st.muzzle, k);
        else fx.muzzleFx(e.x, GUN_H, e.y, ca, sa, st.s, st.muzzle, k);
        // heavy guns: the blast slaps the ground under the muzzle
        if (rc[3] && st.s >= 0.45) {
          const mx = m ? m.x : e.x, mz = m ? m.z : e.y, my = m ? m.y : GUN_H;
          if (my < 2.6) fx.gunDust(mx + ca * 0.2, mz + sa * 0.2, ca, sa, st.s * (st.fam === 'mortar' || st.fam === 'firebomb' ? 0.6 : 1));
        }
        break;
      }
      case 'beam': {
        const st = styleOf(e.moduleId);
        const bs = beamStyle(e.moduleId);
        const rk = st.fam === 'focus' && e.unit !== undefined && e.mount !== undefined ? this.rampShot(e.unit, e.mount, e.x2, e.y2) : 0;
        const rig = this.posedRig(e.unit);
        const m = rig && e.mount !== undefined ? rig.muzzleWorld(e.mount, new THREE.Vector3(), this.lastBarrel.get(e.unit! * 16 + e.mount) ?? 0) : null;
        if (!m && this.offscreen(e.x1, e.y1, 3) && this.offscreen(e.x2, e.y2, 3)) break;
        const ay = m ? m.y : GUN_H;
        const sx = m ? m.x : e.x1, sz = m ? m.z : e.y1;
        // stop on the target's hull side / shield bubble, not inside the model (its impact flare would be hidden)
        const end = this.shotEnd(sx, sz, e.x2, e.y2, byId);
        const by = this.aimHeightAt(e.x2, e.y2, byId, e.side);
        const col = _col.set(bs.color).clone();
        let w = bs.w * (0.7 + st.s * 0.8), life = bs.life;
        if (st.fam === 'focus') {
          // focusing: the beam fattens and burns from red to white-hot as it holds one target
          col.lerp(_c2.setRGB(1, 0.9, 0.75), rk * 0.8);
          w *= 1 + 1.4 * rk;
          life += 0.05 * rk;
          if (rk > 0.4) fx.glow(sx, ay, sz, 0.2 + rk * 0.5, 0.14, RAMPS.molten);
        }
        const s = st.s;
        if (st.fam === 'rail') {
          // railguns get their own big signature (core + sheath + muzzle blast + ion corkscrew + impact + kick)
          const def = MODULE_BY_ID.get(e.moduleId);
          fx.railShot(sx, ay, sz, end.x, by, end.y, 0.3 + (def?.beamWidth ?? 0.1) * 2.2, def?.mount === 'XL'); // width follows the slug's hit width: rail rifle ~0.4, railgun ~0.55, mass driver ~1.3
          break;
        }
        if (st.fam === 'laser') {
          // pulse laser: one heavy, precise pulse (75 per shot every 1.6 s) -- a thick white-hot bolt that shoots out of
          // the lens, flashes at both ends and leaves a glowing burn and spatter on the hull
          fx.beam(sx, ay, sz, end.x, by, end.y, col, w, life, 0, 0.05, 3.2);
          fx.glow(sx, ay, sz, 0.55 + s * 0.6, 0.16, RAMPS.flash);
          fx.glow(end.x, by, end.y, 0.7 + s * 0.8, 0.22, RAMPS.flash);
          fx.burnHit(end.x, by, end.y, s * 1.6, 2.4);
          fx.warheadHit(end.x, by, end.y, end.x - sx, end.y - sz, 0.25, 'plasma');
          break;
        }
        fx.beam(sx, ay, sz, end.x, by, end.y, col, w, life, bs.wob);
        switch (st.fam) {
          case 'focus': fx.burnHit(end.x, by, end.y, s, 0.6 + 1.9 * rk); break;
          case 'heatray': fx.burnHit(end.x, by, end.y, s, 1.4); break;
          case 'slow': fx.beamMotes(sx, ay, sz, end.x, by, end.y, RAMPS.frost, 3); fx.frostHit(end.x, by, end.y, s); break;
          case 'disarm': fx.beamMotes(sx, ay, sz, end.x, by, end.y, RAMPS.jam, 4); fx.jamHit(end.x, by, end.y, s); break;
          case 'gravity': fx.beamMotes(end.x, by, end.y, sx, ay, sz, RAMPS.gravity, 5); break;
          // leech: life motes flow back along the beam into the shooter
          case 'leech': fx.burnHit(end.x, by, end.y, s, 0.6); fx.beamMotes(end.x, by, end.y, sx, ay, sz, RAMPS.heal, 4); break;
          case 'prism': fx.burnHit(end.x, by, end.y, s * 0.6, 0.5); break;
          case 'void': fx.beamMotes(sx, ay, sz, end.x, by, end.y, RAMPS.gravity, 6); fx.glow(end.x, by, end.y, 0.6 + s * 0.4, 0.3, RAMPS.gravity); break;
          case 'entropy': fx.beamMotes(sx, ay, sz, end.x, by, end.y, RAMPS.jam, 3); fx.burnHit(end.x, by, end.y, s, 0.5); break;
          case 'plasma': fx.railTrail(sx, ay, sz, end.x, by, end.y, RAMPS.plasma, s * 0.6); break;
          default: break;
        }
        break;
      }
      case 'chain': {
        const st = beamStyle(e.moduleId), sty = styleOf(e.moduleId);
        const col = new THREE.Color(st.color);
        const rig = this.posedRig(e.unit);
        const m = rig && e.mount !== undefined ? rig.muzzleWorld(e.mount, new THREE.Vector3(), this.lastBarrel.get(e.unit! * 16 + e.mount) ?? 0) : null;
        if (!m && e.points.every((q) => this.offscreen(q.x, q.y, 3))) break;
        // heavy arcs (arc lance, storm tower / core) are thick and doubled; every arc lingers long enough to see
        const s = sty.s, heavy = (sty.def?.damage ?? 0) >= 100;
        const w = 0.025 + s * 0.035 + (heavy ? 0.012 : 0), life = 0.24 + s * 0.12;
        let hPrev = GUN_H;
        for (let i = 1; i < e.points.length; i++) {
          const p0 = e.points[i - 1], p1 = e.points[i];
          const h1 = this.aimHeightAt(p1.x, p1.y, byId, e.side);
          const sx = i === 1 && m ? m.x : p0.x, sy = i === 1 && m ? m.y : hPrev, sz = i === 1 && m ? m.z : p0.y;
          const end = this.shotEnd(sx, sz, p1.x, p1.y, byId);
          fx.lightning(sx, sy, sz, end.x, h1, end.y, col, w, life);
          if (heavy) fx.lightning(sx, sy, sz, end.x, h1, end.y, col, w * 0.55, life * 0.7);
          fx.empHit(end.x, h1, end.y, s * (i === 1 ? 1 : 0.7));
          if (i === 1) fx.glow(sx, sy, sz, 0.35 + s * 0.5, 0.18, RAMPS.bolt);
          hPrev = h1;
        }
        break;
      }
      case 'hit': {
        const v = this.bu.get(e.unit);
        let yh = this.unitHeight(e.unit, byId);
        const su = byId.get(e.unit);
        const d0 = v && su ? Math.hypot(e.x - su.x, e.y - su.y) : 0;
        // direction the shot was travelling when it struck (AP sparks and darts carry on along it)
        let tdx = 0, tdz = 0;
        // shells, rockets, missiles: on the hull's hit box, where the drawn round flew into it
        const imp = v && su && !e.shieldHit ? this.impactFor(e.x, e.y, e.moduleId, byId, e.unit) : null;
        if (imp) {
          e = { ...e, x: imp.x, y: imp.z };
          yh = imp.y; tdx = imp.nx; tdz = imp.nz;
        } else if (v && su) {
          // hits reported at (about) the centre (beams, arcs, splash) go to the hull side facing the shot or blast;
          // shield hits always flare on the bubble, not inside it
          const lb = this.lastBlast;
          const from = d0 < 0.3 ? this.shotFrom.get(e.unit) ?? (lb && Math.hypot(lb.x - su.x, lb.y - su.y) <= lb.r + 3 ? lb : null) : null;
          // drawn a tick behind the sim (interpolation): the flare goes on the model as drawn
          const c = this.drawnAt(su);
          if (from || e.shieldHit) {
            const a = from && Math.hypot(from.x - c.x, from.y - c.y) > 0.05 ? Math.atan2(from.y - c.y, from.x - c.x)
              : d0 > 0.05 ? Math.atan2(e.y - su.y, e.x - su.x) : Math.random() * Math.PI * 2;
            const r = e.shieldHit ? Math.max(v.rig.L, v.rig.W) * 0.58 + 0.18 : Math.min(v.rig.L, v.rig.W) * 0.42;
            e = { ...e, x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
            tdx = -Math.cos(a); tdz = -Math.sin(a);
          } else {
            if (d0 > 0.05) { tdx = (su.x - e.x) / d0; tdz = (su.y - e.y) / d0; }
            e = { ...e, x: e.x + c.x - su.x, y: e.y + c.y - su.y };
          }
        }
        if (!tdx && !tdz) { const a = Math.random() * Math.PI * 2; tdx = Math.cos(a); tdz = Math.sin(a); }
        if (v) {
          v.dmgT = this.time;
          if (e.shieldHit) {
            v.shT = this.time; v.hx = e.x; v.hy = yh; v.hz = e.y;
            // ring buffer of the last 4 bubble hits (x, y, z, time) for the dome's ripples
            const sh = (v.shHits ??= [0, 0, 0, -99, 0, 0, 0, -99, 0, 0, 0, -99, 0, 0, 0, -99]);
            const o = (v.shN = ((v.shN ?? 0) + 1) % 4) * 4;
            sh[o] = e.x; sh[o + 1] = yh; sh[o + 2] = e.y; sh[o + 3] = this.time;
          }
        }
        if (this.hitBudget-- <= 0 || this.offscreen(e.x, e.y, 2)) break;
        const st = styleOf(e.moduleId), s = st.s;
        if (e.shieldHit) { fx.shieldHit(e.x, yh, e.y); break; }
        // knockback weapons shove the hull: dust kicked up under it
        if (st.def?.impulse && st.def.impulse > 0 && su && !su.flying && v && Math.random() < 0.7) fx.dustPuff(e.x, e.y, 0.3 + v.rig.S * 0.12);
        if (SELF_IMPACT.has(st.fam)) break;
        // explosive rounds without a blast radius (AT missiles) burst on the plate they hit; AP shells punch in with a
        // penetrator flash. (Rounds with a splash radius get theirs in 'explode', placed on the hull they struck.)
        if (EXPLOSIVE.has(st.fam) && !(st.def?.splash && st.def.splash > 0) && su && !su.flying) {
          fx.warheadHit(e.x, yh, e.y, tdx, tdz, warheadOf(st.def), st.fam === 'plasmaOrb' ? 'plasma' : st.fam === 'empOrb' ? 'emp' : st.fam === 'missile' || st.fam === 'apc' ? 'heat' : 'he');
          break;
        }
        switch (st.fam) {
          case 'mg': case 'gatling': fx.impact(e.x, yh, e.y, 0.1 + s * 0.4, true); break;
          case 'twinmg': fx.impact(e.x, yh, e.y, 0.1 + s * 0.3, true); if (Math.random() < 0.35) fx.frostHit(e.x, yh, e.y, 0.15); break;
          case 'hmg': case 'sniper': case 'apc': fx.apHit(e.x, yh, e.y, tdx, tdz, s); break;
          case 'gauss': case 'rail': fx.apHit(e.x, yh, e.y, tdx, tdz, s, RAMPS.gauss); break;
          case 'shotgun': fx.pelletHit(e.x, yh, e.y); break;
          case 'flechette': fx.dartHit(e.x, yh, e.y, tdx, tdz); break;
          case 'ac': fx.impact(e.x, yh, e.y, 0.1, true); break; // its 'explode' pops right after
          case 'flak': fx.flakHit(e.x, yh, e.y, tdx, tdz, s); break; // shrapnel from the burst beside it (drawn by 'explode')
          case 'plasma': case 'plasmaOrb': fx.plasmaHit(e.x, yh, e.y, s); break;
          case 'chain': case 'empOrb': fx.empHit(e.x, yh, e.y, s); break;
          case 'flame': break; // the flames and the burn say it all
          case 'melee': {
            const vis = st.def?.visual;
            if (vis === 'prod') fx.empHit(e.x, yh, e.y, s);
            else if (vis === 'blade') fx.plasmaHit(e.x, yh, e.y, s);
            else if (vis === 'claw') { fx.grind(e.x, yh, e.y, s); fx.jamHit(e.x, yh, e.y, s * 0.6); }
            else if (vis === 'hammer' || vis === 'ram') { fx.impact(e.x, yh, e.y, 0.5 + s * 0.5, false); fx.shockwave(e.x, e.y, 0.3 + s * 0.4); }
            else fx.grind(e.x, yh, e.y, s);
            break;
          }
          default: fx.impact(e.x, yh, e.y, 0.1 + s * 0.35, true); break;
        }
        break;
      }
      case 'explode': {
        this.lastBlast = { x: e.x, y: e.y, r: e.radius };
        const st = styleOf(e.moduleId), r = Math.max(0.3, e.radius);
        // a cluster shell that comes down on a hull splits on its roof (its bomblets fall from there), not under the model
        const cargo = st.fam === 'cluster' && e.radius >= 1.1;
        const roof = cargo ? this.impactFor(e.x, e.y, e.moduleId, byId) : null;
        if (cargo) this.clusterPts.push({ x: e.x, y: e.y, t: this.time, h: roof ? roof.y : 0 });
        if (this.offscreen(e.x, e.y, e.radius + 4)) { fx.trauma = Math.min(1, fx.trauma + 0.02); break; }
        // an air burst (a round fired at aircraft: a flak shell's proximity burst, an AA missile striking a flyer) goes
        // off at the aircraft's altitude on the hull it caught, and nothing of it reaches the ground: no damage ring,
        // scorch, dust or shock ring under it
        if (e.air || (st.def?.targetsAir && !st.def.targetsGround)) {
          const at = this.airBurstAt(e.x, e.y, e.radius, e.moduleId, byId);
          if (st.fam === 'flak') fx.flakBurst(at.x, at.y, at.z, r, (st.def?.caliber ?? 0.5) >= 0.8);
          else if (r < 0.6) fx.pop(at.x, at.y, at.z, Math.max(0.25, r * 0.8), RAMPS.fire, false);
          else fx.explosion(at.x, at.z, r * 0.8, st.fam === 'plasmaOrb' || st.fam === 'plasma' ? 'plasma' : st.fam === 'empOrb' || st.fam === 'chain' ? 'emp' : 'fire', at.y - 0.1 - r * 0.25, false, 0.7, undefined, true);
          break;
        }
        // a round that burst on a hull goes off where its drawn flight met the hull's hit box (the side it flew into, or
        // the roof it came down on), not on the ground at the sim's burst point inside / under the model: the warhead's
        // blast on the plate and the fireball around it. (The cargo shell of a cluster round splits in the air.)
        let ex = e.x, ez = e.y, ey = 0;
        const imp = EXPLOSIVE.has(st.fam) && st.fam !== 'flak' && !(st.fam === 'cluster' && e.radius >= 1.1) ? this.impactFor(e.x, e.y, e.moduleId, byId) : null;
        if (imp) {
          const w = warheadOf(st.def) * (st.fam === 'cluster' ? 0.6 : 1);
          fx.warheadHit(imp.x, imp.y, imp.z, imp.nx, imp.nz, w, st.fam === 'plasmaOrb' ? 'plasma' : st.fam === 'empOrb' || (st.fam === 'bomb' && st.def?.stun) ? 'emp' : 'he');
          ex = imp.x; ez = imp.z;
          ey = Math.max(0, imp.y - 0.1 - (imp.top ? 0 : 0.3 * r));
        }
        // the area the blast actually damaged (the sim's splash radius), marked on the ground
        if (st.fam !== 'pd') fx.aoeRing(e.x, 0, e.y, e.radius, st.fam === 'plasmaOrb' || st.fam === 'plasma' || st.fam === 'empOrb' || st.fam === 'chain' || st.fam === 'sonic');
        switch (st.fam) {
          case 'mg': case 'hmg': case 'gatling': case 'ac': case 'twinmg': case 'shotgun': case 'sniper':
            fx.pop(ex, ey, ez, r * 0.8); break; // autocannon HE round: a sharp little pop
          case 'apc': fx.pop(ex, ey, ez, r * 0.7); break; // AP shell's small bursting charge (the hit throws the AP sparks)
          case 'he': fx.explosion(ex, ez, r * 1.25, 'fire', ey); fx.shockwave(e.x, e.y, r * 1.1); break; // HE: big blast + knockback dust
          case 'grenade': fx.pop(ex, ey, ez, r * 0.65); fx.dirtGeyser(e.x, e.y, r * 0.45); break;
          case 'mortar': case 'howitzer': case 'bomb':
            if (st.def?.stun && st.fam === 'bomb') {
              // stun / EMP bombs: an electric burst crawling with arcs instead of a fireball
              fx.explosion(ex, ez, r * (st.def.pellets ? 0.8 : 1), 'emp', ey, false, st.def.pellets ? 0.4 : 0.8);
              for (let i = 0; i < (st.def.pellets ? 1 : 4); i++) fx.arcs(ex, ey + 0.3, ez, r * 0.8, r * 0.8);
              break;
            }
            fx.explosion(ex, ez, r, 'fire', ey); if (!ey) fx.dirtGeyser(e.x, e.y, r * 0.7); break;
          case 'cluster':
            if (e.radius >= 1.1) { // the cargo shell splits (in the air, or on the roof it came down on)
              const rx = roof ? roof.x : e.x, rz = roof ? roof.z : e.y, ry = roof ? roof.y : 0;
              fx.clusterBurst(rx, rz, r, ry); fx.explosion(rx, rz, r * 0.75, 'fire', ry, false, 0.6);
            }
            else { fx.explosion(ex, ez, r * 0.8, 'fire', ey, false, 0.4); if (!ey) fx.dirtGeyser(e.x, e.y, r * 0.35); } // one of the bomblet carpet
            break;
          case 'firebomb': fx.pop(ex, ey, ez, r * 0.8, RAMPS.ember); break; // the burning patch ('fireField') follows
          case 'incend': fx.explosion(ex, ez, r, 'fire', ey); fx.fireSplash(e.x, e.y, r * 0.8); break;
          case 'flak': { const at = this.airBurstAt(e.x, e.y, e.radius, e.moduleId, byId); fx.flakBurst(at.x, at.y, at.z, r, (st.def?.caliber ?? 0.5) >= 0.8); break; }
          case 'plasmaOrb': case 'plasma': fx.explosion(ex, ez, r, 'plasma', ey); break;
          case 'empOrb': case 'chain': {
            fx.explosion(ex, ez, r, 'emp', ey, false, 0.7);
            for (let i = 0; i < 4; i++) fx.arcs(ex, ey + 0.3, ez, r * 0.8, r * 0.8);
            break;
          }
          case 'sonic': fx.shockwave(e.x, e.y, r); fx.sonicPulse(e.x, 0.4, e.y, r * 1.4); break;
          case 'pd': fx.pop(e.x, 1, e.y, 0.25, RAMPS.fire, false); break;
          case 'melee': {
            const vis = st.def?.visual;
            if (vis === 'blade') fx.pop(e.x, 0.3, e.y, r * 0.6, RAMPS.plasma, false);
            else if (vis === 'hammer' || vis === 'ram') { fx.shockwave(e.x, e.y, r); fx.dustPuff(e.x, e.y, r); }
            else fx.grind(e.x, 0.4, e.y, r);
            break;
          }
          default: fx.explosion(e.x, e.y, r, 'fire', ey); break;
        }
        break;
      }
      case 'death': {
        const v = this.bu.get(e.unit);
        const vis = !this.offscreen(e.x, e.y, 6);
        const lv = e.wreck, sz = e.size;
        // the hull's team paint: its debris and scrap show it
        const du = byId.get(e.unit);
        const paint = du ? this.paintOf(du.side) : undefined;
        // aircraft not blown to bits catch fire and fall out of the sky (syncFallers flies them down)
        if (e.flying && v && lv < 3 && vis && v.posed) {
          this.bu.delete(e.unit);
          this.startFall(e, v, du);
          break;
        }
        if (vis) {
          const y = e.flying ? (v ? flyHeight(v.rig.S, v.rig.jet) + 0.2 + v.rig.midY : 1) : 0;
          // the blast grows with the destruction: a perforated hull just coughs fire, a vaporised one goes up whole
          if (lv === 0) fx.explosion(e.x, e.y, 0.45 + sz * 0.4, e.kind === 'energy' ? 'plasma' : 'fire', y, e.kind !== 'kinetic', 0.7, paint, e.flying);
          else fx.bigExplosion(e.x, e.y, e.flying ? Math.max(1, sz * 0.8) : sz + (lv - 1) * 0.6, y, paint, e.flying);
          if (e.kind === 'energy' && lv > 0) fx.explosion(e.x, e.y, 0.5 + sz * 0.45, 'plasma', y, false, 0.6, undefined, e.flying);
          if (lv === 3) { fx.dirtGeyser(e.x, e.y, 0.6 + sz * 0.4); fx.trauma = Math.min(1, fx.trauma + 0.1 + sz * 0.04); }
        }
        // blown apart: torn scrap all around (aircraft rain theirs onto the ground below)
        if (lv >= 2) {
          const r0 = v?.rig.radius ?? 0.3 + sz * 0.3;
          fx.scatter(e.x, e.y, e.flying ? 1.2 : 0.2, Math.round((lv === 3 ? 10 : 5) + sz * (lv === 3 ? 5 : 2.5)), r0 * (lv === 3 ? 3.2 : 2) + 0.4, 0.14 + sz * 0.07, e.kind === 'energy' ? 0.5 : 0, paint);
        }
        if (v && !e.flying) this.toWreck(e.unit, v.rig, e.x, e.y, byId.get(e.unit)?.angle ?? 0, lv, e.kind);
        else if (v) { this.layer.release(v.rig); this.bu.delete(e.unit); }
        break;
      }
      case 'heal': {
        const v = this.bu.get(e.unit);
        // culled / never-drawn rigs keep a stale (or origin) transform: only units drawn last frame sparkle
        if (v) { v.healT = this.time; if (v.posed && Math.random() < 0.5) fx.heal(v.rig.root.position.x, v.rig.root.position.y + v.rig.height * 0.5, v.rig.root.position.z); }
        break;
      }
      case 'leap': {
        const v = this.bu.get(e.unit);
        if (v?.posed) fx.dustPuff(v.rig.root.position.x, v.rig.root.position.z, 0.5 + v.rig.S * 0.2);
        break;
      }
      case 'smoke':
        fx.smokeScreen(e.x, e.y, e.radius, e.duration);
        break;
      case 'fireField':
        if (e.rad) fx.radField(e.x, e.y, e.radius, e.duration); else fx.fireField(e.x, e.y, e.radius, e.duration);
        break;
      default:
    }
  }

  /** The hull stays as a wreck for the rest of the battle, as broken as the killing blow (sim WreckLevel): 0 a whole,
   *  perforated hull; 1 burnt, sagging, its main turret blown off; 2 crumpled and sunk with every turret thrown clear;
   *  3 nothing left but a scorch mark and the scrap scattered by the death blast. catchUp: found dead after a seek (no fresh smoke / fire). */
  private toWreck(id: number, rig: Rig, x: number, y: number, angle: number, lv: WreckLevel, kind: DeathKind, catchUp = false, nose = 0): void {
    this.bu.delete(id);
    const S = rig.S, rnd = (k: number) => (Math.random() - 0.5) * k;
    const hx = rig.L * 0.5, hz = rig.W * 0.5;
    const fire = catchUp ? 0 : kind === 'fire' ? 5 + S * 2 : kind === 'explosive' && lv >= 1 ? 2 + S * lv : kind === 'energy' && lv >= 1 ? 1.5 + S : 0;
    // (a whole hull smokes too: a thin column out of its holes for a good while)
    const smoke = catchUp ? 0 : (14 + S * 5) * (lv === 3 ? 0.5 : 1);
    if (lv === 3) {
      this.layer.release(rig);
      this.fx.scorchMark(x, y, 0.3 + rig.radius * 0.75);
      this.wrecks.push({ rig: null, x, z: y, smoke, S, fire: 0, heat: 0, char: 1, seed: 0, hx, hz, deck: 0.1, lv, smoke0: smoke, ang: angle });
      return;
    }
    rig.look = 'wreck';
    rig.root.rotation.order = 'XYZ';
    // even a whole hull settles dead: sunk a little, slumped onto one side (a track / leg gave way), nose or tail down
    rig.root.position.set(x, -0.05 - (lv === 2 ? rig.height * 0.22 : lv === 1 ? 0.07 : 0.02) - (kind === 'energy' && lv ? rig.height * 0.08 : 0), y);
    rig.root.rotation.set(0, -angle, 0);
    const tilt = lv === 0 ? 0.1 : lv === 1 ? 0.2 : 0.42;
    const side = Math.random() < 0.5 ? -1 : 1;
    rig.root.rotation.x = side * tilt * (0.6 + 0.4 * Math.random()); rig.root.rotation.z = rnd(tilt) + nose;
    // crumpled: flattened and splayed
    if (lv === 2) rig.root.scale.set(rig.root.scale.x * 1.06, rig.root.scale.y * 0.62, rig.root.scale.z * 1.1);
    const L = rig.tpl.unit.L, W = rig.tpl.unit.W;
    rig.all.forEach((tu, i) => {
      // level 1 loses its biggest (first) turret, level 2 all of them; they land a little way off, tipped over
      if (!tu.fixed && (lv === 2 || (lv === 1 && i === 0))) {
        const a = Math.random() * 6.283, d = (lv === 2 ? 0.75 : 0.6) + Math.random() * 0.5;
        rig.dropTurret(i, Math.cos(a) * L * d, Math.sin(a) * W * d * 1.4, 0.5 + Math.random() * 1.1, Math.random() * 6.283);
      } else if (!tu.fixed) {
        // knocked askew on its ring, barrel drooping onto the deck
        tu.yaw.rotation.y += (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.9);
        tu.pitch.rotation.z = -(0.12 + Math.random() * 0.16); tu.pitch.updateMatrix();
      }
      tu.yaw.updateMatrix(); tu.recoil.position.x = 0; tu.recoil.updateMatrix();
    });
    rig.update(0);
    rig.frozen = true;
    // a bullet-riddled hull stays steel grey (but soot-streaked and holed, unmistakably dead), burnt and blasted ones go black
    const char = lv === 0 ? (kind === 'kinetic' || kind === 'crush' ? 0.6 : kind === 'fire' ? 0.88 : 0.72) : lv === 1 ? 0.88 : 0.97;
    // still glowing: melted (energy), blown up or burnt out hulls show ember cracks that cool over a few seconds
    const heat = catchUp ? 0 : kind === 'energy' ? (lv ? 1 : 0.75) : kind === 'explosive' ? (lv ? 0.55 + 0.15 * lv : 0.4) : kind === 'fire' ? 0.6 : 0.3;
    this.wrecks.push({ rig, x, z: y, smoke, S, fire, heat, char, seed: Math.random(), hx, hz, deck: Math.max(0.15, rig.height * (lv === 2 ? 0.35 : 0.55)), lv, smoke0: smoke, ang: angle });
  }

  destroy(): void {
    this.controls.destroy();
    this.outline.dispose();
    if (typeof window !== 'undefined') {
      if (this.onKey) { window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKey); }
      if (this.onBlur) window.removeEventListener('blur', this.onBlur);
    }
    // Free this renderer's GPU copies of everything it drew. Many of these resources are module-level caches shared by
    // every view (terrain builds, unit materials / geometry, look materials); the renderer registers 'dispose' listeners
    // on them that would otherwise keep each destroyed renderer + its WebGL context alive for the rest of the session.
    // Only one view lives at a time (screens are destroyed before the next is built) and the next one has its own context,
    // so this costs nothing: the CPU-side data stays and is uploaded again on first use.
    const done = new Set<object>();
    const free = (o: { dispose(): void } | null | undefined) => { if (o && !done.has(o)) { done.add(o); o.dispose(); } };
    const visit = (obj: THREE.Object3D) => obj.traverse((o) => {
      const m = o as THREE.Mesh;
      free(m.geometry);
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) free(v as THREE.Texture);
        // own uniforms (ShaderMaterial) and the renderer's per-material ones (e.g. three's global DFG LUT)
        const ru = (this.renderer.properties.get(mat) as { uniforms?: Record<string, THREE.IUniform> }).uniforms;
        for (const un of [(mat as THREE.ShaderMaterial).uniforms, ru]) {
          if (un) for (const u of Object.values(un)) if ((u?.value as THREE.Texture)?.isTexture) free(u.value as THREE.Texture);
        }
        free(mat);
      }
    });
    try {
      visit(this.scene); visit(this.ui.scene);
      if (this.scene.environment) free(this.scene.environment);
    } catch { /* best effort */ }
    this.layer.dispose();
    this.fx.dispose();
    this.shields.dispose();
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch { /* */ }
  }
}

const BLACK = [0, 0, 0] as const;
const WHITE = [1, 1, 1] as const;
const RED = rgb('#ff3a2a');
const YELLOW = rgb('#ffd24a');
const GOLD = rgb('#ffd24a');
const SHIELD_COL = rgb('#8fe0ff');
const PARA_COL = rgb('#4aa8ff');
const ICE_HI = rgb('#e6f6ff');
const ICE_LO = rgb('#7fd0ff');
const JAM_COL = rgb('#ffb02a');
const BAR_COL = [rgb(TEAM_PAL[0].bar), rgb(TEAM_PAL[1].bar)] as const;
type RGB = readonly [number, number, number];
void templateKey;
