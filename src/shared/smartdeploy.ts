// Smart deployment: how a sensible human lays out a mixed army (Mechabellum-style), used by the balance tooling on
// both sides so prices are measured against smart play, not naive placement.
//
//   front (y = 0)  ── chaff screen: cheap swarms spread wide, a short gap ahead of the armour (soaks the first volleys,
//                     snipers and splash meant for the armour)
//                  ── armour line, front and centre; chaff-clear (riot) units level with its ends and right behind it,
//                     in reach of the enemy screen when the lines meet; melee on the flanks (held 3 s, so they close in
//                     after the armour engages)
//                  ── fast / fragile ranged units and support behind the armour (escorting it)
//   back           ── artillery and long guns spread out against splash; aircraft held back (6 s delay) so they come in
//                     after the ground lines engage instead of meeting fresh anti-air first
import { blockDims, blockInZone, blocksOverlap, DEPLOY_D, DEPLOY_W, hasSpacing, MAX_SPACING, type BlockShape } from './grid.ts';
import { MODULE_BY_ID } from './parts.ts';
import { computeStats, weaponDps } from './stats.ts';
import type { Design, ModuleDef, Placement } from './types.ts';

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
  if ((longest >= 14 && longDps >= 0.5 * allDps) || ws.some((w) => (w.minRange ?? 0) >= 3 && (w.range ?? 0) >= 14)) return 'artillery';
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
}

/** Lay out `specs` (each n blocks of a design) for one side in local deploy-zone coordinates (y = 0 is the front).
 *  Every block gets the role's spot, spacing and orders; blocks that fit nowhere are left out. */
export function smartDeploy(specs: DeploySpec[], uid0 = 1): Placement[] {
  return smartDeployBlocks(specs.flatMap((s) => Array.from({ length: s.n }, () => ({ d: s.d }))), { uid0 });
}

/** The formation's orders for a role: lines hold their spread, melee waits a moment, aircraft wait until the ground
 *  lines have met (ranged / support escorts are assigned by smartDeployBlocks, which knows the armour blocks). */
export function roleOrders(role: DeployRole): Partial<Placement> {
  if (role === 'armor' || role === 'chaff') return { hold: true };
  if (role === 'melee') return { delay: 3 };
  if (role === 'air') return { delay: 6 };
  return {};
}

/** smartDeploy for single blocks, optionally around blocks already on the board (incremental per-round deploys):
 *  existing blocks keep their spots and anchor the lines (the armour line's row and centre, the riot / melee sides
 *  already taken, the artillery already in the back row). Returns the placed new blocks; unplaceable ones are left out. */
export function smartDeployBlocks(input: DeployBlock[], o: DeployOpts = {}): Placement[] {
  type B = { d: Design; role: DeployRole; shape: BlockShape; uid?: number; sp?: number };
  const occ: { x: number; y: number; spacing?: number; rot?: boolean; shape: BlockShape; role: DeployRole; uid: number }[] = [];
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
  const chaffDepth = Math.max(depth(chaff, 1), exDepth(exChaff));
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
  // the chaff screen: directly in front of the armour, at least as wide as the armour line
  const chaffGap = chaff.length > 1 ? Math.max(1, (armorW - width(chaff, 1, 0)) / (chaff.length - 1)) : 1;
  line(chaff, 0, 1, Math.min(4, chaffGap), () => ({ hold: true }), centre, 6);
  // chaff clear: level with the armour line's ends, then right behind it
  const hasArmor = armorUids.length > 0;
  const behindArmor = armorY + Math.max(2, armorDepth) + 1;
  const riot0 = ex('riot').length;
  riot.forEach((b, j) => {
    const i = j + riot0, side = i % 2 === 0 ? -1 : 1, k = Math.floor(i / 2);
    if (k === 0 && hasArmor) put(b, centre + side * (armorW / 2 + 1) - (side < 0 ? dimsOf(b, 1).w : 0), armorY, {}, 1);
    else put(b, centre + side * 4 * k, hasArmor ? behindArmor : armorY, {}, 1);
  });
  // melee on the flanks, held a moment so the armour engages first
  const melee0 = ex('melee').length;
  melee.forEach((b, j) => {
    const i = j + melee0, side = i % 2 === 0 ? -1 : 1, k = Math.floor(i / 2);
    put(b, side < 0 ? 2 + 6 * k : DEPLOY_W - 2 - dimsOf(b, 1).w - 6 * k, armorY, { delay: 3 }, 1);
  });
  // fast / fragile ranged units and support behind the armour, escorting it
  let esc = ex('ranged').length;
  const escort = (): Partial<Placement> => (armorUids.length ? { escort: armorUids[esc++ % armorUids.length] } : { delay: 3 });
  const rangedY = (hasArmor ? behindArmor : armorY) + (riot.length + riot0 > 2 ? 3 : 0);
  line(ranged, rangedY, 1, 1, escort, centre);
  line(support, rangedY + depth(ranged, 1) + 1, 0, 2, () => (armorUids.length ? { escort: armorUids[0] } : {}), centre);
  // artillery spread across the back (gaps against splash), aircraft held back behind it
  const backY = DEPLOY_D - Math.max(2, depth(arty, 1), exDepth(ex('artillery')));
  const exArty = ex('artillery');
  if (!exArty.length) line(arty, backY, 1, Math.max(2, Math.min(8, (DEPLOY_W - width(arty, 1, 0)) / Math.max(1, arty.length + 1))), () => ({}), DEPLOY_W / 2);
  else for (const b of arty) {
    // the back-row spot farthest from the other guns (splash), near the middle
    const sp = spOf(b, 1), { w, h } = blockDims(b.shape, sp);
    let bx = -1, by = backY, bs = -Infinity;
    for (let yy = Math.max(0, backY - 3); yy + h <= DEPLOY_D; yy++) for (let xx = 0; xx + w <= DEPLOY_W; xx++) {
      if (!fits(xx, yy, b.shape, sp)) continue;
      const gap = Math.min(12, ...occ.filter((q) => q.role === 'artillery').map((q) => Math.abs(q.x + blockDims(q.shape, q.spacing, q.rot).w / 2 - xx - w / 2)));
      const s = gap - 0.08 * Math.abs(xx + w / 2 - DEPLOY_W / 2) - 1.5 * Math.abs(yy - backY);
      if (s > bs) { bs = s; bx = xx; by = yy; }
    }
    if (bx >= 0) put(b, bx, by, {}, sp);
  }
  line(air, Math.max(0, backY - depth(air, 1) - 1), 1, 2, () => ({ delay: 6 }), DEPLOY_W / 2);
  return out;
}
