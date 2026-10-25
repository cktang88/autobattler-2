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
import { blockDims, blockInZone, blocksOverlap, DEPLOY_D, DEPLOY_W, hasSpacing, type BlockShape } from './grid.ts';
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

/** Lay out `specs` (each n blocks of a design) for one side in local deploy-zone coordinates (y = 0 is the front).
 *  Every block gets the role's spot, spacing and orders; blocks that fit nowhere are left out. */
export function smartDeploy(specs: DeploySpec[], uid0 = 1): Placement[] {
  const occ: { x: number; y: number; spacing?: number; shape: BlockShape }[] = [];
  const out: Placement[] = [];
  let uid = uid0;
  const blocks: { d: Design; role: DeployRole; shape: BlockShape }[] = [];
  for (const s of specs) {
    const role = deployRole(s.d), shape = computeStats(s.d);
    for (let k = 0; k < s.n; k++) blocks.push({ d: s.d, role, shape });
  }
  const fits = (x: number, y: number, shape: BlockShape, spacing: number) =>
    blockInZone(x, y, shape, spacing) && !occ.some((o) => blocksOverlap({ x, y, spacing }, shape, o, o.shape));
  /** place at the free spot nearest (x, y) (rows first: keeps a line a line) */
  const put = (b: { d: Design; shape: BlockShape }, x: number, y: number, extra: Partial<Placement>, spacing: number): Placement | null => {
    const sp = hasSpacing(b.shape) ? spacing : 0;
    const { w, h } = blockDims(b.shape, sp);
    const x0 = Math.round(Math.min(DEPLOY_W - w, Math.max(0, x))), y0 = Math.round(Math.min(DEPLOY_D - h, Math.max(0, y)));
    let best: { x: number; y: number } | null = null, bd = Infinity;
    for (let yy = 0; yy + h <= DEPLOY_D; yy++) for (let xx = 0; xx + w <= DEPLOY_W; xx++) {
      const dd = Math.abs(xx - x0) + 2.5 * Math.abs(yy - y0);
      if (dd < bd && fits(xx, yy, b.shape, sp)) { bd = dd; best = { x: xx, y: yy }; }
    }
    if (!best) return null;
    occ.push({ ...best, spacing: sp, shape: b.shape });
    const p: Placement = { uid: uid++, designId: b.d.id, x: best.x, y: best.y, level: 1, round: 1, spacing: sp, ...extra };
    out.push(p);
    return p;
  };
  const of = (r: DeployRole) => blocks.filter((b) => b.role === r);
  const width = (bs: typeof blocks, sp: number, gap: number) => bs.reduce((a, b) => a + blockDims(b.shape, hasSpacing(b.shape) ? sp : 0).w + gap, 0);
  /** a centred line of blocks at row y */
  const line = (bs: typeof blocks, y: number, sp: number, gap: number, extra: (b: (typeof blocks)[number]) => Partial<Placement>, centre = DEPLOY_W / 2) => {
    let x = centre - width(bs, sp, gap) / 2;
    const placed: Placement[] = [];
    for (const b of bs) {
      const w = blockDims(b.shape, hasSpacing(b.shape) ? sp : 0).w;
      const p = put(b, x, y, extra(b), sp);
      if (p) placed.push(p);
      x += w + gap;
    }
    return placed;
  };
  const depth = (bs: typeof blocks, sp: number) => Math.max(0, ...bs.map((b) => blockDims(b.shape, hasSpacing(b.shape) ? sp : 0).h));

  const chaff = of('chaff'), armor = of('armor'), riot = of('riot'), melee = of('melee');
  const ranged = of('ranged'), support = of('support'), arty = of('artillery'), air = of('air');
  // rows, front to back
  const chaffY = 0, gapAhead = chaff.length ? 2 : 0;
  const armorY = chaff.length ? depth(chaff, 1) + gapAhead : 0;
  const armorLine = line(armor, armorY, 0, 1, () => ({ hold: true }));
  const armorW = Math.max(16, width(armor, 0, 1));
  // the chaff screen: directly in front of the armour, at least as wide as the armour line
  const chaffGap = chaff.length > 1 ? Math.max(1, (armorW - width(chaff, 1, 0)) / (chaff.length - 1)) : 1;
  line(chaff, chaffY, 1, Math.min(4, chaffGap), () => ({ hold: true }));
  // chaff clear: level with the armour line's ends, then right behind it
  const behindArmor = armorY + Math.max(2, depth(armor, 0)) + 1;
  riot.forEach((b, i) => {
    const side = i % 2 === 0 ? -1 : 1, k = Math.floor(i / 2);
    if (k === 0 && armor.length) put(b, DEPLOY_W / 2 + side * (armorW / 2 + 1) - (side < 0 ? blockDims(b.shape, 1).w : 0), armorY, {}, 1);
    else put(b, DEPLOY_W / 2 + side * 4 * k, armor.length ? behindArmor : armorY, {}, 1);
  });
  // melee on the flanks, held a moment so the armour engages first
  melee.forEach((b, i) => {
    const side = i % 2 === 0 ? -1 : 1, k = Math.floor(i / 2);
    put(b, side < 0 ? 2 + 6 * k : DEPLOY_W - 2 - blockDims(b.shape, 1).w - 6 * k, armorY, { delay: 3 }, 1);
  });
  // fast / fragile ranged units and support behind the armour, escorting it
  const escortOf = (i: number) => (armorLine.length ? { escort: armorLine[i % armorLine.length].uid } : { delay: 3 });
  const rangedY = (armor.length ? behindArmor : armorY) + (riot.length > 2 ? 3 : 0);
  line(ranged, rangedY, 1, 1, () => ({}));
  out.filter((p) => ranged.some((b) => b.d.id === p.designId)).forEach((p, i) => Object.assign(p, escortOf(i)));
  line(support, rangedY + depth(ranged, 1) + 1, 0, 2, () => (armorLine.length ? { escort: armorLine[0].uid } : {}));
  // artillery spread across the back (gaps against splash), aircraft held back behind it
  const backY = DEPLOY_D - Math.max(2, depth(arty, 1));
  line(arty, backY, 1, Math.max(2, Math.min(8, (DEPLOY_W - width(arty, 1, 0)) / Math.max(1, arty.length + 1))), () => ({}));
  line(air, Math.max(0, backY - depth(air, 1) - 1), 1, 2, () => ({ delay: 6 }));
  return out;
}
