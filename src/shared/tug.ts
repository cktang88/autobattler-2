// Tug of war: a real-time mode on one endless battlefield. Each side has a castle at its back edge and earns gold
// over time. Gold buys blocks from the player's tug roster, dropped anywhere on their own half while the fight runs;
// they march straight up their lane, fight whatever comes within reach and shell the enemy castle when they get
// there. Gold can also be invested in a higher income rate or in unlocking the next hull tier (size class).
// Destroy the enemy castle to win.
//
// Everything here is deterministic: both players (and the server's command log) feed the same TugCommands at the
// same ticks into a TugGame, so every client runs the identical fight (lockstep). See server/tug.ts, client/ui/tug.ts.

import { Battle } from './sim/battle.ts';
import { DT, TICK_RATE } from './sim/types.ts';
import { DEPLOY_D, FIELD_H, FIELD_W, blockDims, setField, squadOffsets, type FieldSize } from './grid.ts';
import { computeStats, validateDesign } from './stats.ts';
import type { Design, Side, Size } from './types.ts';

export const TUG = {
  /** gold each side starts with */
  startGold: 350,
  /** gold per second at income level 0, and what each invested level adds */
  baseIncome: 8,
  incomeStep: 4,
  maxIncomeLevel: 8,
  /** hull size classes buildable from the start, and the largest one */
  startTier: 2 as Size,
  maxTier: 5 as Size,
  castleHp: 20000,
  /** overtime: from this many seconds on both castles crumble by `overtimeDecay` hp/s, so the more battered one
   *  falls first and no game drags on for ever */
  overtimeAt: 600,
  overtimeDecay: 50,
  /** units alive per side at most (keeps the sim fast in long games) */
  maxAlive: 180,
  /** designs in a tug roster at most */
  rosterSize: 9,
  /** the tug field: half the standard width, a quarter longer, and a shallower deploy zone per side (blocks drop
   *  anywhere in your own zone) so the lanes are narrow and the march is long */
  field: { w: 48, h: 115, deploy: 28 } as FieldSize,
} as const;

/** price of the next income level (from level `lvl`) */
export const incomeCost = (lvl: number): number => 150 + 125 * lvl;
/** price to unlock hull tier `size` (from the tier below it) */
export const TIER_COST: Record<Size, number> = { 1: 0, 2: 0, 3: 400, 4: 900, 5: 1600 };
export const incomeRate = (lvl: number): number => TUG.baseIncome + TUG.incomeStep * lvl;
export const TIER_NAMES: Record<Size, string> = { 1: 'Light', 2: 'Medium', 3: 'Heavy', 4: 'Giant', 5: 'Titan' };

/** The castle: an anchored Monolith fortress with a rotary cannon that shoots air and ground. Not a legal player
 *  design (anchors are retired); the sim takes it as trusted. */
export const CASTLE_DESIGN: Design = { id: 'tug-castle', name: 'Castle', chassis: 'monolith', mobility: 'anchor', mounts: ['avenger', null] };
/** castle centre (world cells) per side: at the middle of the side's back edge */
export const castlePos = (side: Side): { x: number; y: number } => ({ x: FIELD_W / 2, y: side === 0 ? FIELD_H - 6 : 6 });
const CASTLE_CLEAR = 6.5; // cells around the castle centre where nothing may be dropped

export type TugCommand =
  /** buy a block of a roster design and drop it with its centre at world (x, y); rot turns a squad 90° */
  | { t: 'buy'; designId: string; x: number; y: number; rot?: boolean }
  | { t: 'income' }
  | { t: 'tier' }
  | { t: 'surrender' };

/** a command and when it takes effect: applied before step() advances battle.tick past `tick` */
export interface TugOrder { tick: number; side: Side; cmd: TugCommand }

export interface TugSideState {
  gold: number;
  incomeLvl: number;
  tier: Size;
  /** blocks bought so far */
  bought: number;
  /** gold spent on units */
  spent: number;
}

export function validateRoster(r: Design[]): string[] {
  const errs: string[] = [];
  if (!r.length) errs.push('The roster is empty');
  if (r.length > TUG.rosterSize) errs.push(`A roster holds at most ${TUG.rosterSize} designs`);
  const ids = new Set<string>();
  for (const d of r) {
    if (ids.has(d.id)) errs.push(`Duplicate design ${d.id}`);
    ids.add(d.id);
    const e = validateDesign(d);
    if (e.length) errs.push(`${d.name}: ${e.join(', ')}`);
  }
  return errs;
}

/** world centres of each unit of a block of `design` centred on (x, y), facing `side`'s enemy */
export function blockCenters(side: Side, design: Design, x: number, y: number, rot = false): { x: number; y: number }[] {
  const st = computeStats(design);
  const { w, h } = blockDims(st, 0, rot);
  // snap the block to whole cells like a normal deployment
  const col = Math.round(x - w / 2), row = Math.round(y - h / 2);
  return squadOffsets(st, 0, rot).map((o) => (side === 0 ? { x: col + o.x, y: row + o.y } : { x: col + w - o.x, y: row + h - o.y }));
}

/** where `side` may drop a block of this footprint (world box of the whole block): anywhere in its own deploy zone
 *  (the back DEPLOY_D rows of the tug field), clear of its castle. Returns null when allowed, else the reason. */
export function dropError(side: Side, design: Design, x: number, y: number, rot = false): string | null {
  const st = computeStats(design);
  const { w, h } = blockDims(st, 0, rot);
  const x0 = Math.round(x - w / 2), y0 = Math.round(y - h / 2), x1 = x0 + w, y1 = y0 + h;
  if (x0 < 0 || y0 < 0 || x1 > FIELD_W || y1 > FIELD_H) return 'Off the field';
  if (side === 0 ? y0 < FIELD_H - DEPLOY_D : y1 > DEPLOY_D) return 'Only in your own deploy zone';
  const c = castlePos(side);
  if (x1 > c.x - CASTLE_CLEAR && x0 < c.x + CASTLE_CLEAR && y1 > c.y - CASTLE_CLEAR && y0 < c.y + CASTLE_CLEAR) return 'Too close to your castle';
  return null;
}

/** the drop zone of a side as a world box (for drawing) */
export function dropZone(side: Side): { x0: number; y0: number; x1: number; y1: number } {
  return side === 0 ? { x0: 0, y0: FIELD_H - DEPLOY_D, x1: FIELD_W, y1: FIELD_H } : { x0: 0, y0: 0, x1: FIELD_W, y1: DEPLOY_D };
}

export class TugGame {
  readonly battle: Battle;
  readonly rosters: [Design[], Design[]];
  readonly sides: [TugSideState, TugSideState];
  /** castle unit ids */
  readonly castles: [number, number];
  surrendered: Side | null = null;
  private uid = 1;

  /** Switches the shared field to TUG.field (grid.ts setField): whoever ends the game puts STANDARD_FIELD back. */
  constructor(seed: number, rosters: [Design[], Design[]]) {
    setField(TUG.field);
    this.rosters = rosters;
    this.battle = new Battle({ seed, tug: true, sides: [{ designs: [], units: [] }, { designs: [], units: [] }] });
    const mk = (): TugSideState => ({ gold: TUG.startGold, incomeLvl: 0, tier: TUG.startTier, bought: 0, spent: 0 });
    this.sides = [mk(), mk()];
    const ids = ([0, 1] as Side[]).map((s) => {
      const id = this.battle.spawnBlock(s, 0, CASTLE_DESIGN, 1, [castlePos(s)])[0];
      const u = this.battle.units[id];
      u.hp = u.maxHp = TUG.castleHp;
      // a castle is a big target, not a wall of armour: small guns must still chip it
      u.stats = { ...u.stats, armor: 8 };
      return id;
    });
    this.castles = [ids[0], ids[1]];
    this.battle.cores = [ids[0], ids[1]];
  }

  get tick(): number { return this.battle.tick; }
  get done(): boolean { return this.battle.done || this.surrendered !== null; }
  /** winning side, -1 for a draw, null while running */
  get winner(): Side | -1 | null {
    if (this.surrendered !== null) return this.surrendered === 0 ? 1 : 0;
    return this.battle.done ? this.battle.winner : null;
  }

  castleHp(side: Side): number { return Math.max(0, this.battle.units[this.castles[side]].hp); }
  income(side: Side): number { return incomeRate(this.sides[side].incomeLvl); }
  aliveCount(side: Side): number {
    let n = 0;
    for (const u of this.battle.units) if (u.alive && u.side === side) n++;
    return n - (this.battle.units[this.castles[side]].alive ? 1 : 0);
  }

  design(side: Side, id: string): Design | undefined { return this.rosters[side].find((d) => d.id === id); }

  /** why `side` can't do `cmd` right now (null: it can) */
  check(side: Side, cmd: TugCommand): string | null {
    if (this.done) return 'The game is over';
    const S = this.sides[side];
    switch (cmd.t) {
      case 'buy': {
        const d = this.design(side, cmd.designId);
        if (!d) return 'Not in your roster';
        const st = computeStats(d);
        if (st.size > S.tier) return `Unlock ${TIER_NAMES[st.size]} hulls first`;
        if (S.gold < st.cost) return 'Not enough gold';
        if (this.aliveCount(side) + st.squad > TUG.maxAlive) return 'Too many units on the field';
        if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y)) return 'Bad position';
        return dropError(side, d, cmd.x, cmd.y, !!cmd.rot && st.squad > 1);
      }
      case 'income':
        if (S.incomeLvl >= TUG.maxIncomeLevel) return 'Income is maxed';
        return S.gold < incomeCost(S.incomeLvl) ? 'Not enough gold' : null;
      case 'tier':
        if (S.tier >= TUG.maxTier) return 'Every tier is unlocked';
        return S.gold < TIER_COST[(S.tier + 1) as Size] ? 'Not enough gold' : null;
      case 'surrender':
        return null;
    }
    return 'Unknown command';
  }

  /** apply a command now (between steps); returns the refusal reason, null when applied */
  apply(side: Side, cmd: TugCommand): string | null {
    const err = this.check(side, cmd);
    if (err) return err;
    const S = this.sides[side];
    switch (cmd.t) {
      case 'buy': {
        const d = this.design(side, cmd.designId)!;
        const st = computeStats(d);
        S.gold -= st.cost;
        S.spent += st.cost;
        S.bought++;
        this.battle.spawnBlock(side, this.uid++, d, 1, blockCenters(side, d, cmd.x, cmd.y, !!cmd.rot && st.squad > 1));
        break;
      }
      case 'income': S.gold -= incomeCost(S.incomeLvl); S.incomeLvl++; break;
      case 'tier': S.tier = (S.tier + 1) as Size; S.gold -= TIER_COST[S.tier]; break;
      case 'surrender': this.surrendered = side; break;
    }
    return null;
  }

  /** advance one tick: income, then the fight */
  step(): void {
    if (this.done) return;
    for (const s of [0, 1] as Side[]) this.sides[s].gold += this.income(s) * DT;
    this.battle.coreDecay = this.overtime ? TUG.overtimeDecay : 0;
    this.battle.step();
  }

  get overtime(): boolean { return this.time >= TUG.overtimeAt; }

  /** seconds played */
  get time(): number { return this.battle.tick / TICK_RATE; }
}

/** Run a TugGame forward to `tick`, applying `orders` (sorted by tick, then arrival) as their ticks come up.
 *  `next` is the index of the first order not yet applied; returns the new index. */
export function advance(g: TugGame, orders: readonly TugOrder[], next: number, tick: number, onStep?: () => void): number {
  while (g.tick < tick && !g.done) {
    while (next < orders.length && orders[next].tick <= g.tick) { g.apply(orders[next].side, orders[next].cmd); next++; }
    if (g.done) break;
    g.step();
    onStep?.();
  }
  while (next < orders.length && orders[next].tick <= g.tick && !g.done) { g.apply(orders[next].side, orders[next].cmd); next++; }
  return next;
}

/** shape check of a command from the network (the game itself checks legality) */
export function sanitizeCommand(raw: unknown): TugCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (c.t === 'income' || c.t === 'tier' || c.t === 'surrender') return { t: c.t };
  if (c.t === 'buy' && typeof c.designId === 'string' && c.designId.length <= 64 && typeof c.x === 'number' && typeof c.y === 'number' && Number.isFinite(c.x) && Number.isFinite(c.y)) {
    return { t: 'buy', designId: c.designId, x: Math.round(c.x * 100) / 100, y: Math.round(c.y * 100) / 100, ...(c.rot === true ? { rot: true } : {}) };
  }
  return null;
}
