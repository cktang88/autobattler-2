// Smart deployment: how a sensible human lays out a mixed army (Mechabellum-style), used by the balance tooling on
// both sides so prices are measured against smart play, not naive placement.
//
// Timed against the clash (clashPoint: where and when our armour line meets the enemy front), so every role spends as
// little time under fire and as much time firing as it can:
//
//   front (y = 0)  ── chaff screen: cheap swarms spread wide just ahead of the armour, ESCORTING it (chaff is fast:
//                     left to itself it ran across alone and died before the armour arrived); it keeps by the armour
//                     and goes for whatever the armour is about to fight, so both hit the enemy as one wave
//                  ── armour line, front and centre; chaff-clear (riot) units level with its ends and right behind it,
//                     escorting it too, so they reach the enemy chaff when the lines meet; melee on the flanks, held
//                     until they would arrive just after the armour engages
//                  ── fast / fragile ranged units and support behind the armour (escorting it)
//   back           ── artillery as far back as it can sit and still reach the enemy front at the clash (walking up in
//                     time if it moves), spread against splash; aircraft at the back, held so they come in just after
//                     the ground lines engage instead of meeting fresh anti-air first
import { blockDims, blockInZone, blocksOverlap, DEPLOY_D, DEPLOY_W, hasSpacing, MAX_SPACING, type BlockShape } from './grid.ts';
import { MODULE_BY_ID } from './parts.ts';
import { computeStats, weaponDps } from './stats.ts';
import type { Design, ModuleDef, Placement, UnitStats } from './types.ts';
import { START_DELAYS } from './types.ts';

export type DeployRole = 'chaff' | 'armor' | 'riot' | 'melee' | 'ranged' | 'support' | 'artillery' | 'air';

/** A weapon that clears chaff efficiently: blast, flame, pellets, chain lightning, a multi-beam prism or a spinning hose. */
export function isChaffClear(w: ModuleDef): boolean {
  if (w.kind !== 'weapon' || w.heal || w.targetsGround === false) return false; // flak can't clear ground chaff
  return (w.splash ?? 0) >= 0.8 || w.projectile === 'flame' || (w.pellets ?? 1) > 1 || (w.chain ?? 0) >= 2 || (w.split ?? 1) > 1 || !!w.spinUp || (w.cluster != null);
}

/** The battlefield job a design gets deployed for (see the layout above). */
export function deployRole(d: Design): DeployRole {
  const s = computeStats(d);
  const ws = d.mounts.map((id) => (id ? MODULE_BY_ID.get(id) : undefined)).filter((m): m is ModuleDef => !!m && m.kind === 'weapon');
  if (s.flying) return 'air';
  if (ws.length && ws.every((w) => w.projectile === 'melee')) return 'melee';
  const longest = Math.max(0, ...ws.map((w) => (w.range ?? 0) * (w.projectile === 'melee' ? 1 : s.rangeMult)));
  // artillery: most of the firepower reaches 14+ (a long gun on a brawler, e.g. a railgun beside a cannon, doesn't send
  // the brawler to the back row), or an arcing gun with a minimum range
  const longDps = ws.filter((w) => (w.range ?? 0) * s.rangeMult >= 14).reduce((a, w) => a + weaponDps(w), 0);
  const allDps = ws.reduce((a, w) => a + weaponDps(w), 0);
  if ((longest >= 14 && longDps >= 0.5 * allDps) || ws.some((w) => (w.minRange ?? 0) >= 3 && (w.range ?? 0) * s.rangeMult >= 14)) return 'artillery';
  if (!ws.length || s.heal > 0) return 'support';
  if (s.size === 1 && s.squad >= 8) return 'chaff';
  if (s.size >= 3) return 'armor';
  const riot = ws.filter(isChaffClear).reduce((a, w) => a + weaponDps(w), 0), all = ws.reduce((a, w) => a + weaponDps(w), 0);
  if (all > 0 && riot >= 0.5 * all && longest <= 10) return 'riot';
  if (s.size >= 2 && (s.armor >= 8 || s.hp / s.squad >= 600)) return 'armor';
  return 'ranged';
}

export interface DeploySpec { d: Design; n: number }

/** One block to lay out: its design, and optionally the uid and squad spacing it must keep. */
export interface DeployBlock { d: Design; uid?: number; spacing?: number }

export interface DeployOpts {
  /** blocks already on the board (earlier rounds): kept where they are, the new blocks form up around them */
  existing?: { d: Design; p: Placement }[];
  /** first uid for blocks without one */
  uid0?: number;
  /** round written on the placements */
  round?: number;
  /** lateral centre of the formation (default: the middle of the zone, or the existing armour line's middle) */
  centre?: number;
  /** what is known of the enemy front (speed, row in its zone, gun reach); default: a mirror of our armour line */
  foe?: { speed?: number; row?: number; range?: number };
}

/** rows of no man's land between the two deploy zones (FIELD_H - 2 * DEPLOY_D) */
const NO_MANS = 44;
/** the start delay (START_DELAYS) nearest to `t` seconds */
export function nearestDelay(t: number): number {
  let best = 0;
  for (const d of START_DELAYS) if (Math.abs(d - t) < Math.abs(best - t)) best = d;
  return best;
}

/** When and where the front lines meet, in this side's local rows (y = 0 our zone's front, negative = no man's land
 *  toward the enemy, whose zone front is at y = -NO_MANS): our armour line (row `armorY`, speed `va`, guns reaching
 *  `r`) walks toward an enemy front assumed to mirror it (same speed, row and reach) unless told otherwise. */
export interface Clash { t: number; enemyY: number }
export function clashPoint(armorY: number, va: number, r: number, foe: { speed?: number; row?: number; range?: number } = {}): Clash {
  const vb = foe.speed ?? va, eRow = foe.row ?? armorY, reach = Math.max(r, foe.range ?? r);
  const gap = NO_MANS + armorY + eRow;
  const t = Math.max(0, gap - reach) / Math.max(0.3, va + vb);
  return { t, enemyY: -NO_MANS - eRow + vb * t };
}

/** The formation's clock: the clash (clashPoint) of an armour line at row `armorY` (its slowest hull sets the pace,
 *  its median gun the reach; no armour: the other ground blocks lead), and `arrive`, the start delay that brings a
 *  unit of speed v from row y to the enemy front `lag` s after the lines meet. */
export function formationClock(armour: UnitStats[], others: UnitStats[], armorY: number, foe?: DeployOpts['foe']) {
  const front = armour.length ? armour : others.filter((x) => !x.flying && !x.isStatic);
  // the line moves at its slowest hull, ~20% slower in practice with its escorts crowding round it
  const va = 0.8 * (front.length ? Math.min(...front.map((x) => x.speed)) : 1.4);
  const ranges = front.map((x) => x.range).sort((a, b) => a - b);
  const clash = clashPoint(armorY, va, Math.min(14, ranges.length ? ranges[Math.floor(ranges.length / 2)] : 8), foe?.speed !== undefined ? { ...foe, speed: 0.8 * foe.speed } : foe);
  const arrive = (v: number, y: number, lag: number) => nearestDelay(clash.t + lag - Math.max(0, y - clash.enemyY) / Math.max(0.3, v));
  /** aircraft: arrive AIR_LAG s after the clash; with no ground line to wait for (an all-air army, or only artillery
   *  behind it) they go at once — holding back would only hand the enemy free time */
  const airDelay = (v: number, y: number) => (front.length ? arrive(v, y, AIR_LAG) : 0);
  return { clash, arrive, airDelay };
}

/** aircraft reach the enemy front this long after the lines meet (not into fresh anti-air); melee a moment after the
 *  armour engages */
export const AIR_LAG = 6, MELEE_LAG = 1;

/** Re-time the formation's start delays for a whole board (the armour line may have grown or slowed since a block
 *  was placed): uid -> delay for every aircraft and melee block. */
export function formationDelays(board: { d: Design; p: Placement }[], foe?: DeployOpts['foe']): Map<number, number> {
  const out = new Map<number, number>();
  const roles = board.map((b) => deployRole(b.d)), st = board.map((b) => computeStats(b.d));
  const arm = board.filter((_, i) => roles[i] === 'armor');
  // the armour row; without armour, the row smartDeployBlocks would give it (2 behind the chaff screen, else the front)
  const ch = board.filter((_, i) => roles[i] === 'chaff');
  const armorY = arm.length ? Math.min(...arm.map((b) => b.p.y))
    : ch.length ? Math.max(...ch.map((b) => b.p.y + blockDims(computeStats(b.d), b.p.spacing, b.p.rot).h)) + 2 : 0;
  const { arrive, airDelay } = formationClock(st.filter((_, i) => roles[i] === 'armor'), st.filter((_, i) => roles[i] !== 'air' && roles[i] !== 'artillery' && roles[i] !== 'support'), armorY, foe);
  board.forEach((b, i) => {
    if (roles[i] === 'air') out.set(b.p.uid, airDelay(st[i].speed, b.p.y));
    else if (roles[i] === 'melee') out.set(b.p.uid, arrive(st[i].speed, armorY, MELEE_LAG));
  });
  return out;
}

/** Lay out `specs` (each n blocks of a design) for one side in local deploy-zone coordinates (y = 0 is the front).
 *  Every block gets the role's spot, spacing and orders; blocks that fit nowhere are left out. */
export function smartDeploy(specs: DeploySpec[], uid0 = 1): Placement[] {
  return smartDeployBlocks(specs.flatMap((s) => Array.from({ length: s.n }, () => ({ d: s.d }))), { uid0 });
}

/** smartDeploy for single blocks, optionally around blocks already on the board (incremental per-round deploys):
 *  existing blocks keep their spots and anchor the lines (the armour line's row and centre, the riot / melee sides
 *  already taken, the other guns new artillery spreads away from). Returns the placed new blocks; unplaceable ones are
 *  left out. */
export function smartDeployBlocks(input: DeployBlock[], o: DeployOpts = {}): Placement[] {
  type B = { d: Design; role: DeployRole; shape: UnitStats; uid?: number; sp?: number };
  const occ: { x: number; y: number; spacing?: number; rot?: boolean; shape: UnitStats; role: DeployRole; uid: number }[] = [];
  const out: Placement[] = [];
  let uid = o.uid0 ?? 1;
  const round = o.round ?? 1;
  const roleCache = new Map<Design, DeployRole>();
  const roleOfD = (d: Design) => { let r = roleCache.get(d); if (!r) roleCache.set(d, (r = deployRole(d))); return r; };
  for (const e of o.existing ?? []) occ.push({ x: e.p.x, y: e.p.y, spacing: e.p.spacing, rot: e.p.rot, shape: computeStats(e.d), role: roleOfD(e.d), uid: e.p.uid });
  const blocks: B[] = input.map((b) => ({ d: b.d, role: roleOfD(b.d), shape: computeStats(b.d), uid: b.uid, sp: b.spacing }));
  const spOf = (b: B, def: number) => (hasSpacing(b.shape) ? Math.max(0, Math.min(MAX_SPACING, Math.round(b.sp ?? def))) : 0);
  const fits = (x: number, y: number, shape: BlockShape, spacing: number) =>
    blockInZone(x, y, shape, spacing) && !occ.some((q) => blocksOverlap({ x, y, spacing }, shape, q, q.shape));
  /** place at the free spot nearest (x, y); rowW weighs rows against columns (higher keeps a line a line) */
  const put = (b: B, x: number, y: number, extra: Partial<Placement>, spacing: number, rowW = 2.5): Placement | null => {
    const sp = spOf(b, spacing);
    const { w, h } = blockDims(b.shape, sp);
    const x0 = Math.round(Math.min(DEPLOY_W - w, Math.max(0, x))), y0 = Math.round(Math.min(DEPLOY_D - h, Math.max(0, y)));
    let best: { x: number; y: number } | null = null, bd = Infinity;
    for (let yy = 0; yy + h <= DEPLOY_D; yy++) for (let xx = 0; xx + w <= DEPLOY_W; xx++) {
      const dd = Math.abs(xx - x0) + rowW * Math.abs(yy - y0);
      if (dd < bd && fits(xx, yy, b.shape, sp)) { bd = dd; best = { x: xx, y: yy }; }
    }
    if (!best) return null;
    const id = b.uid ?? uid++;
    occ.push({ ...best, spacing: sp, shape: b.shape, role: b.role, uid: id });
    const p: Placement = { uid: id, designId: b.d.id, x: best.x, y: best.y, level: 1, round, ...extra };
    if (hasSpacing(b.shape)) p.spacing = sp;
    out.push(p);
    return p;
  };
  const of = (r: DeployRole) => blocks.filter((b) => b.role === r);
  const ex = (r: DeployRole) => occ.filter((q) => q.role === r);
  const dimsOf = (b: B, sp: number) => blockDims(b.shape, spOf(b, sp));
  const width = (bs: B[], sp: number, gap: number) => bs.reduce((a, b) => a + dimsOf(b, sp).w + gap, 0);
  /** a centred line of blocks at row y */
  const line = (bs: B[], y: number, sp: number, gap: number, extra: (b: B) => Partial<Placement>, centre: number, rowW = 2.5) => {
    let x = centre - width(bs, sp, gap) / 2;
    const placed: Placement[] = [];
    for (const b of bs) {
      const p = put(b, x, y, extra(b), sp, rowW);
      if (p) placed.push(p);
      x += dimsOf(b, sp).w + gap;
    }
    return placed;
  };
  const depth = (bs: B[], sp: number) => Math.max(0, ...bs.map((b) => dimsOf(b, sp).h));
  const exDepth = (qs: typeof occ) => Math.max(0, ...qs.map((q) => blockDims(q.shape, q.spacing, q.rot).h));

  const chaff = of('chaff'), armor = of('armor'), riot = of('riot'), melee = of('melee');
  const ranged = of('ranged'), support = of('support'), arty = of('artillery'), air = of('air');
  const exArmor = ex('armor'), exChaff = ex('chaff');
  const anyChaff = chaff.length + exChaff.length > 0;
  // rows, front to back (an armour line already on the board keeps its row)
  // the screen's back edge (a chaff block already on the board may sit behind row 0), as formationDelays measures it
  const chaffDepth = Math.max(depth(chaff, 1), ...exChaff.map((q) => q.y + blockDims(q.shape, q.spacing, q.rot).h));
  const armorY = exArmor.length ? Math.min(...exArmor.map((q) => q.y)) : anyChaff ? chaffDepth + 2 : 0;
  // armour: the existing line's centre, new armour extends it sideways (alternating ends)
  let centre = o.centre ?? DEPLOY_W / 2;
  const extent = () => {
    const as = occ.filter((q) => q.role === 'armor');
    if (!as.length) return null;
    return { l: Math.min(...as.map((q) => q.x)), r: Math.max(...as.map((q) => q.x + blockDims(q.shape, q.spacing, q.rot).w)) };
  };
  const e0 = extent();
  if (e0) centre = (e0.l + e0.r) / 2;
  if (!e0) line(armor, armorY, 0, 1, () => ({ hold: true }), centre, 6);
  else armor.forEach((b, i) => {
    const e = extent()!, w = dimsOf(b, 0).w;
    put(b, i % 2 === 0 ? e.r + 1 : e.l - 1 - w, armorY, { hold: true }, 0, 6);
  });
  const armorUids = occ.filter((q) => q.role === 'armor').map((q) => q.uid);
  const ext = extent();
  if (ext) centre = (ext.l + ext.r) / 2;
  const armorW = Math.max(16, ext ? ext.r - ext.l : 0);
  const armorDepth = exDepth(occ.filter((q) => q.role === 'armor'));
  const hasArmor = armorUids.length > 0;
  // timing: when / where our armour line meets the enemy front (clashPoint; a mirror enemy unless o.foe says otherwise)
  const { clash, arrive, airDelay } = formationClock(occ.filter((q) => q.role === 'armor').map((q) => q.shape),
    [...occ, ...blocks].filter((q) => q.role !== 'air' && q.role !== 'artillery' && q.role !== 'support').map((q) => q.shape), armorY, o.foe);
  /** the armour block nearest x (escort target) */
  const nearArmor = (x: number) => {
    let best = -1, bd = Infinity;
    for (const q of occ) if (q.role === 'armor') { const dd = Math.abs(q.x + blockDims(q.shape, q.spacing, q.rot).w / 2 - x); if (dd < bd) { bd = dd; best = q.uid; } }
    return best;
  };
  // the chaff screen: directly in front of the armour, at least as wide as the armour line. Chaff is fast: it escorts
  // the armour (keeps by it and goes for whatever the armour is about to fight), so it meets the enemy just ahead of
  // the armour instead of running across alone and dying before the armour gets there
  const chaffGap = chaff.length > 1 ? Math.max(1, (armorW - width(chaff, 1, 0)) / (chaff.length - 1)) : 1;
  const chaffP = line(chaff, 0, 1, Math.min(4, chaffGap), () => ({ hold: true }), centre, 6);
  if (hasArmor) for (const p of chaffP) p.escort = nearArmor(p.x + 1);
  // chaff clear: level with the armour line's ends, then right behind it, escorting the armour (they reach the enemy
  // chaff when the lines meet, not ahead of the armour)
  const behindArmor = armorY + Math.max(2, armorDepth) + 1;
  const riot0 = ex('riot').length;
  riot.forEach((b, j) => {
    const i = j + riot0, side = i % 2 === 0 ? -1 : 1, k = Math.floor(i / 2);
    const p = k === 0 && hasArmor ? put(b, centre + side * (armorW / 2 + 1) - (side < 0 ? dimsOf(b, 1).w : 0), armorY, {}, 1)
      : put(b, centre + side * 4 * k, hasArmor ? behindArmor : armorY, {}, 1);
    if (p && hasArmor) p.escort = nearArmor(p.x);
  });
  // melee on the flanks, held a moment so the armour engages first
  const melee0 = ex('melee').length;
  melee.forEach((b, j) => {
    const i = j + melee0, side = i % 2 === 0 ? -1 : 1, k = Math.floor(i / 2);
    put(b, side < 0 ? 2 + 6 * k : DEPLOY_W - 2 - dimsOf(b, 1).w - 6 * k, armorY, { delay: arrive(b.shape.speed, armorY, MELEE_LAG) }, 1);
  });
  // fast / fragile ranged units and support behind the armour, escorting it
  let esc = ex('ranged').length;
  const escort = (): Partial<Placement> => (armorUids.length ? { escort: armorUids[esc++ % armorUids.length] } : { delay: 3 });
  const rangedY = (hasArmor ? behindArmor : armorY) + (riot.length + riot0 > 2 ? 3 : 0);
  line(ranged, rangedY, 1, 1, escort, centre);
  line(support, rangedY + depth(ranged, 1) + 1, 0, 2, () => (armorUids.length ? { escort: armorUids[0] } : {}), centre);
  // artillery: as far back as it can stay while still reaching the enemy front when the lines meet (a mover walks up
  // until its guns reach and parks there, so it only needs to get there in time; an emplacement must already reach,
  // clear of its minimum range), always behind the armour; guns spread apart against splash. Aircraft at the back.
  const backY = DEPLOY_D - Math.max(2, depth(arty, 1), exDepth(ex('artillery')));
  const artyY = (b: B) => {
    const R = b.shape.range - 1.5, mv = b.shape.isStatic ? 0 : b.shape.speed;
    const minR = Math.max(0, ...b.d.mounts.map((id) => (id ? MODULE_BY_ID.get(id)?.minRange ?? 0 : 0)));
    const h = dimsOf(b, 1).h;
    let y = Math.floor(clash.enemyY + R + mv * clash.t);
    if (mv === 0) y = Math.max(y, Math.ceil(clash.enemyY + minR + 1));
    return Math.max(Math.min(DEPLOY_D - h, hasArmor ? behindArmor : armorY + 3), Math.min(DEPLOY_D - h, y));
  };
  for (const b of arty) {
    const ty = artyY(b), sp = spOf(b, 1), { w, h } = blockDims(b.shape, sp);
    let bx = -1, by = ty, bs = -Infinity;
    for (let yy = ty; yy + h <= DEPLOY_D; yy++) for (let xx = 0; xx + w <= DEPLOY_W; xx++) {
      if (!fits(xx, yy, b.shape, sp)) continue;
      const gap = Math.min(12, ...occ.filter((q) => q.role === 'artillery').map((q) => Math.hypot(q.x + blockDims(q.shape, q.spacing, q.rot).w / 2 - xx - w / 2, 0.5 * (q.y - yy))));
      const s = gap - 0.08 * Math.abs(xx + w / 2 - DEPLOY_W / 2) - 1.5 * (yy - ty);
      if (s > bs) { bs = s; bx = xx; by = yy; }
    }
    if (bx >= 0) put(b, bx, by, {}, sp);
  }
  const airY = Math.max(0, backY - depth(air, 1) - 1);
  // timed from the row each block actually landed on (the same clock formationDelays re-times a board with)
  let ax = DEPLOY_W / 2 - width(air, 1, 2) / 2;
  for (const b of air) {
    const p = put(b, ax, airY, {}, 1);
    if (p) p.delay = airDelay(b.shape.speed, p.y);
    ax += dimsOf(b, 1).w + 2;
  }
  return out;
}
