// Pure, deterministic match rules shared by the server (PvP) and the client (vs AI).
//
// Flow: newMatch -> (pvp: status 'waiting' until joinMatch) -> status 'deploy', round 1.
// Each round both players submit a DeployAction (validateDeploy + applyDeploy marks them ready);
// once both are ready resolveRound simulates the battle on a snapshot of both boards, damages the
// loser, records history, and either finishes the match or advances to the next round.
//
// Waiting PvP representation: a pvp match created with only p0 has status 'waiting', round 0, and
// players[1] is a PLACEHOLDER from newPlayer('', []) — empty name, empty deck, hp START_HP,
// supply 0. Use isPlaceholder(m.players[1]) or m.status === 'waiting' to detect it. joinMatch
// replaces the placeholder, starts round 1 and grants supply to both players.
//
// Units persist between rounds (killed units come back at full hp next round at their placement).
// No Math.random / Date: callers pass `now` for timestamps.

import { computeStats, levelMult, MAX_LEVEL, roundCost, validateDesign } from './stats.ts';
import { MAX_SPACING, blockInZone, blocksOverlap, hasSpacing, normSpacing, squadSize } from './grid.ts';
import { mixSeed } from './rng.ts';
import { MODULE_BY_ID } from './parts.ts';
import { runBattle } from './sim/battle.ts';
import type { BattleInput } from './sim/types.ts';
import { STANCES, START_DELAYS, TARGET_PRIORITIES } from './types.ts';
import type { Size, DeployAction, Design, MatchMode, MatchState, Placement, PlayerState, RoundRecord, Side } from './types.ts';

export const DECK_SIZE = 9;
export const START_HP = 100;
/** Supply granted in round 1 and added each further round. Unspent supply carries over. */
export const START_SUPPLY = 3000;
/** After this round resolves the match ends regardless; higher hp wins. */
export const MAX_ROUNDS = 15;
/** Hard cap on blocks (placements) per side. */
export const MAX_UNITS = 40;
export const MAX_BLOCKS = MAX_UNITS;
/** Hard cap on simulated units per side, counting every unit of every squad (bounds simulation cost). */
export const MAX_SIM_UNITS = 240;
export const MAX_PLAYER_NAME = 24;

const ROUND_SUPPLY_BASE = START_SUPPLY;
const ROUND_SUPPLY_GROWTH = 600;

/** Supply granted at the start of `round` (1-based). Unspent supply carries over. */
export function supplyForRound(round: number): number {
  if (round < 1) return 0;
  return ROUND_SUPPLY_BASE + ROUND_SUPPLY_GROWTH * (round - 1);
}

/** Total supply granted from round 1 through `round` inclusive. */
export function totalSupplyThrough(round: number): number {
  let t = 0;
  for (let r = 1; r <= round; r++) t += supplyForRound(r);
  return t;
}

/** Supply cost of one BLOCK of a design (same as computeStats().cost; already rounded). */
export function designCost(design: Design): number {
  return computeStats(design).cost;
}

/** Cost to raise a unit from `level` to `level + 1`: 50% of design cost for L1->2, 60% for L2->3. */
export function upgradeCost(design: Design, level: number): number {
  return roundCost(designCost(design) * (0.4 + 0.1 * level));
}

/** Total supply invested in a placement (design + upgrades up to its level). */
export function placementValue(design: Design, level: number): number {
  let v = designCost(design);
  for (let l = 1; l < level; l++) v += upgradeCost(design, l);
  return v;
}

/** Base damage the loser of `round` takes, before surviving-unit damage. */
export function baseDamage(round: number): number {
  return 2 + round;
}

/** Survivor divisor: block value (supply) per point of damage. */
const SURVIVOR_DIV = 450;

/** Damage contributed by one surviving enemy block; `fraction` = share of its squad still alive (0..1]. */
export function survivorDamage(design: Design, level: number, fraction = 1): number {
  return (designCost(design) * levelMult(level) * fraction) / SURVIVOR_DIV;
}

// ---------------------------------------------------------------------------------------------

export function newPlayer(name: string, deck: Design[], isAI?: boolean): PlayerState {
  const p: PlayerState = {
    name,
    deck: deck.map(cloneDesign),
    hp: START_HP,
    supply: 0,
    board: [],
    nextUid: 1,
    ready: false,
  };
  if (isAI) p.isAI = true;
  return p;
}

/** True for the empty players[1] slot of a waiting pvp match. */
export function isPlaceholder(p: PlayerState): boolean {
  return p.deck.length === 0 && p.name === '';
}

/** Create a match. For 'pvp' the second player may be filled later via joinMatch (status 'waiting'). */
export function newMatch(id: string, mode: MatchMode, seed: number, p0: PlayerState, p1?: PlayerState, now?: number): MatchState {
  const t = now ?? 0;
  const m: MatchState = {
    id,
    mode,
    status: 'waiting',
    round: 0,
    seed: seed >>> 0,
    players: [p0, p1 ?? newPlayer('', [])],
    history: [],
    createdAt: t,
    updatedAt: t,
  };
  if (p1) startRound(m, 1);
  return m;
}

export function joinMatch(m: MatchState, p1: PlayerState, now?: number): void {
  if (m.status !== 'waiting') throw new Error('Match is not waiting for a player');
  m.players[1] = p1;
  startRound(m, 1);
  if (now !== undefined) m.updatedAt = now;
}

function startRound(m: MatchState, round: number): void {
  m.status = 'deploy';
  m.round = round;
  for (const p of m.players) {
    p.supply += supplyForRound(round);
    p.ready = false;
  }
}

// ---------------------------------------------------------------------------------------------

export function validateDeck(deck: Design[]): string[] {
  const errs: string[] = [];
  if (!Array.isArray(deck)) return ['Deck must be a list of designs'];
  if (deck.length < 1) errs.push('Deck needs at least one design');
  if (deck.length > DECK_SIZE) errs.push(`Deck can hold at most ${DECK_SIZE} designs`);
  const ids = new Set<string>();
  for (const d of deck) {
    const de = validateDesign(d);
    const label = d && typeof d === 'object' && typeof d.name === 'string' ? d.name : '?';
    for (const e of de) errs.push(`${label}: ${e}`);
    if (d && typeof d === 'object' && d.behavior !== undefined) {
      const be = behaviorError(d.behavior);
      if (be) errs.push(`${label}: ${be}`);
    }
    if (d && typeof d === 'object') {
      if (ids.has(d.id)) errs.push(`Duplicate design id ${d.id}`);
      ids.add(d.id);
    }
  }
  return errs;
}

/** Error string for a bad {target, hold, kite, focus, stance, delay, retreat} settings object, else null. */
function behaviorError(b: unknown): string | null {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return 'Bad behavior';
  const o = b as Record<string, unknown>;
  if (o.target !== undefined && !TARGET_PRIORITIES.includes(o.target as never)) return 'Bad target priority';
  if (o.hold !== undefined && typeof o.hold !== 'boolean') return 'Bad hold flag';
  if (o.kite !== undefined && typeof o.kite !== 'boolean') return 'Bad kite flag';
  if (o.focus !== undefined && typeof o.focus !== 'boolean') return 'Bad focus flag';
  if (o.retreat !== undefined && typeof o.retreat !== 'boolean') return 'Bad retreat flag';
  if (o.kiteMount !== undefined && (!isInt(o.kiteMount) || o.kiteMount < -1)) return 'Bad kite weapon';
  if (o.stance !== undefined && !STANCES.includes(o.stance as never)) return 'Bad stance';
  if (o.delay !== undefined && !(START_DELAYS as readonly unknown[]).includes(o.delay)) return 'Bad start delay';
  return null;
}

/** The hidden battle-setting fields a Placement / UnitConfig / design behavior can carry (escort excluded). */
const BEHAVIOR_KEYS = ['target', 'hold', 'kite', 'focus', 'stance', 'delay', 'retreat'] as const;
function behaviorOf(o: object): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const k of BEHAVIOR_KEYS) r[k] = (o as Record<string, unknown>)[k];
  return r;
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/** Returns an error string, or null when the action is legal for `side` right now. */
export function validateDeploy(m: MatchState, side: Side, a: DeployAction): string | null {
  if (m.status !== 'deploy') return 'Not in deployment phase';
  if (side !== 0 && side !== 1) return 'Bad side';
  const p = m.players[side];
  if (p.ready) return 'Already submitted this round';
  if (!a || typeof a !== 'object') return 'Bad action';
  if (a.round !== m.round) return `Wrong round (expected ${m.round})`;
  if (!Array.isArray(a.place) || !Array.isArray(a.upgrade)) return 'Bad action';
  if (p.board.length + a.place.length > MAX_BLOCKS) return `Too many blocks (max ${MAX_BLOCKS})`;

  const designs = new Map(p.deck.map((d) => [d.id, d] as const));
  let cost = 0;
  const seenUids = new Set<number>(p.board.map((u) => u.uid));
  // escort may reference any block already on the board or bought in this very action
  const knownUids = new Set<number>(seenUids);
  for (const pl of a.place) if (pl && typeof pl === 'object' && isInt(pl.uid)) knownUids.add(pl.uid);
  const footprints: { x: number; y: number; spacing?: number; size: Size }[] = p.board.map((u) => ({ x: u.x, y: u.y, spacing: u.spacing, size: sizeOf(designs.get(u.designId)) }));
  let simUnits = p.board.reduce((n, u) => n + squadSize(sizeOf(designs.get(u.designId))), 0);

  for (const pl of a.place) {
    if (!pl || typeof pl !== 'object') return 'Bad placement';
    const d = designs.get(pl.designId);
    if (!d) return `Unknown design ${String(pl.designId)}`;
    if (!isInt(pl.uid) || pl.uid < p.nextUid) return `Bad unit id ${String(pl.uid)}`;
    if (seenUids.has(pl.uid)) return `Duplicate unit id ${pl.uid}`;
    seenUids.add(pl.uid);
    if (pl.level !== 1) return 'New units start at level 1';
    if (pl.round !== m.round) return 'Placement round mismatch';
    const size = sizeOf(d);
    if (pl.spacing !== undefined) {
      if (!isInt(pl.spacing) || pl.spacing < 0 || pl.spacing > MAX_SPACING) return `Bad spacing for ${d.name}`;
      if (!hasSpacing(size) && pl.spacing !== 0) return `${d.name} can't be spaced`;
    }
    const be = behaviorError(behaviorOf(pl));
    if (be) return `${d.name}: ${be}`;
    if (pl.kiteMount !== undefined && !validKiteMount(d, pl.kiteMount, false)) return `${d.name}: Bad kite weapon`;
    if (pl.escort !== undefined && (!isInt(pl.escort) || pl.escort === pl.uid || !knownUids.has(pl.escort))) return `${d.name}: Bad escort target`;
    simUnits += squadSize(size);
    if (simUnits > MAX_SIM_UNITS) return `Too many units (max ${MAX_SIM_UNITS})`;
    if (!isInt(pl.x) || !isInt(pl.y) || !blockInZone(pl.x, pl.y, size, pl.spacing)) return `${d.name} is outside the deploy zone`;
    for (const f of footprints) if (blocksOverlap(pl, size, f, f.size)) return `${d.name} overlaps another unit`;
    footprints.push({ x: pl.x, y: pl.y, spacing: pl.spacing, size });
    cost += designCost(d);
  }

  if (a.configure !== undefined) {
    if (!Array.isArray(a.configure) || a.configure.length > 200) return 'Bad configure list';
    for (const c of a.configure) {
      if (!c || typeof c !== 'object' || !isInt(c.uid)) return 'Bad configure entry';
      if (!p.board.some((u) => u.uid === c.uid)) return `Can't configure unknown unit ${String(c.uid)}`;
      const be = behaviorError(behaviorOf(c));
      if (be) return be;
      if (c.kiteMount !== undefined) {
        const ub = p.board.find((u) => u.uid === c.uid)!;
        if (!validKiteMount(designs.get(ub.designId), c.kiteMount, true)) return 'Bad kite weapon';
      }
      if (c.escort !== undefined && (!isInt(c.escort) || (c.escort !== -1 && (c.escort === c.uid || !knownUids.has(c.escort))))) return 'Bad escort target';
    }
  }

  const pending = new Map<number, number>();
  for (const uid of a.upgrade) {
    const u = p.board.find((b) => b.uid === uid);
    if (!u) return `Can't upgrade unknown unit ${String(uid)}`;
    const d = designs.get(u.designId);
    if (!d) return 'Unit has unknown design';
    const extra = pending.get(uid) ?? 0;
    const lvl = u.level + extra;
    if (lvl >= MAX_LEVEL) return `${d.name} is already max level`;
    cost += upgradeCost(d, lvl);
    pending.set(uid, extra + 1);
  }

  if (cost > p.supply) return `Not enough supply (${cost} > ${p.supply})`;
  return null;
}

/** Cost of an action for `side` (assumes it is valid). */
export function actionCost(m: MatchState, side: Side, a: DeployAction): number {
  const p = m.players[side];
  const designs = new Map(p.deck.map((d) => [d.id, d] as const));
  let cost = 0;
  for (const pl of a.place) cost += designCost(designs.get(pl.designId)!);
  const lv = new Map(p.board.map((u) => [u.uid, u.level] as const));
  for (const uid of a.upgrade) {
    const u = p.board.find((b) => b.uid === uid)!;
    const l = lv.get(uid)!;
    cost += upgradeCost(designs.get(u.designId)!, l);
    lv.set(uid, l + 1);
  }
  return cost;
}

/** Apply a validated action, deduct supply, mark ready. */
export function applyDeploy(m: MatchState, side: Side, a: DeployAction): void {
  const p = m.players[side];
  p.supply -= actionCost(m, side, a);
  for (const uid of a.upgrade) {
    const u = p.board.find((b) => b.uid === uid);
    if (u) u.level = Math.min(MAX_LEVEL, u.level + 1);
  }
  for (const c of a.configure ?? []) {
    const u = p.board.find((b) => b.uid === c.uid);
    if (!u) continue;
    if (c.target !== undefined) u.target = c.target;
    if (c.hold !== undefined) u.hold = c.hold;
    if (c.kite !== undefined) u.kite = c.kite;
    if (c.kiteMount !== undefined) { if (c.kiteMount === -1) delete u.kiteMount; else u.kiteMount = c.kiteMount; }
    if (c.focus !== undefined) u.focus = c.focus;
    if (c.stance !== undefined) u.stance = c.stance;
    if (c.delay !== undefined) u.delay = c.delay;
    if (c.retreat !== undefined) u.retreat = c.retreat;
    if (c.escort !== undefined) { if (c.escort === -1) delete u.escort; else u.escort = c.escort; }
  }
  for (const pl of a.place) {
    const size = sizeOf(p.deck.find((d) => d.id === pl.designId));
    const b: Placement = { uid: pl.uid, designId: pl.designId, x: pl.x, y: pl.y, level: 1, round: m.round };
    if (hasSpacing(size)) b.spacing = normSpacing(size, pl.spacing);
    if (pl.target !== undefined) b.target = pl.target;
    if (pl.hold !== undefined) b.hold = pl.hold;
    if (pl.kite !== undefined) b.kite = pl.kite;
    if (pl.kiteMount !== undefined) b.kiteMount = pl.kiteMount;
    if (pl.focus !== undefined) b.focus = pl.focus;
    if (pl.stance !== undefined) b.stance = pl.stance;
    if (pl.delay !== undefined) b.delay = pl.delay;
    if (pl.retreat !== undefined) b.retreat = pl.retreat;
    if (pl.escort !== undefined) b.escort = pl.escort;
    p.board.push(b);
    p.nextUid = Math.max(p.nextUid, pl.uid + 1);
  }
  p.ready = true;
}

/**
 * Convenience for drivers/servers: validate, apply, and resolve the round if both are ready.
 * Returns an error string (state untouched) or null.
 */
export function submitDeploy(m: MatchState, side: Side, a: DeployAction, now?: number): string | null {
  const err = validateDeploy(m, side, a);
  if (err) return err;
  applyDeploy(m, side, a);
  if (now !== undefined) m.updatedAt = now;
  if (m.players[0].ready && m.players[1].ready) resolveRound(m, now);
  return null;
}

/** Damage each player takes given a battle outcome. Exported for UI previews / tests. */
export function roundDamage(m: MatchState, round: number, winner: Side | -1, survivors: [number[], number[]], boards: [Placement[], Placement[]], aliveFraction?: [Record<number, number>, Record<number, number>]): [number, number] {
  const sv = (s: Side) => {
    const designs = new Map(m.players[s].deck.map((d) => [d.id, d] as const));
    const alive = new Set(survivors[s]);
    let v = 0;
    for (const u of boards[s]) {
      if (!alive.has(u.uid)) continue;
      const d = designs.get(u.designId);
      if (d) v += survivorDamage(d, u.level, aliveFraction?.[s][u.uid] ?? 1);
    }
    return v;
  };
  const base = baseDamage(round);
  if (winner === 0) return [0, Math.ceil(base + sv(0))];
  if (winner === 1) return [Math.ceil(base + sv(1)), 0];
  // Draw (timeout or mutual wipe): both take half base plus half of the other's survivors.
  return [Math.ceil(base / 2 + sv(1) / 2), Math.ceil(base / 2 + sv(0) / 2)];
}

/** When both players are ready: simulate, apply damage, record history, advance round or finish. */
export function resolveRound(m: MatchState, now?: number): void {
  if (m.status !== 'deploy' || !m.players[0].ready || !m.players[1].ready) return;
  const round = m.round;
  const boards: [Placement[], Placement[]] = [m.players[0].board.map(clonePlacement), m.players[1].board.map(clonePlacement)];
  const seed = mixSeed(m.seed, round);
  const input: BattleInput = {
    seed,
    sides: [
      { designs: m.players[0].deck, units: boards[0] },
      { designs: m.players[1].deck, units: boards[1] },
    ],
  };
  const sum = runBattle(input);
  const survivors: [number[], number[]] = [[...sum.survivors[0]], [...sum.survivors[1]]];
  const damage = roundDamage(m, round, sum.winner, survivors, boards, sum.aliveFraction);
  m.players[0].hp = Math.max(0, m.players[0].hp - damage[0]);
  m.players[1].hp = Math.max(0, m.players[1].hp - damage[1]);
  m.history.push({ round, seed, boards, result: { winner: sum.winner, survivors, damage, ticks: sum.ticks } });
  if (now !== undefined) m.updatedAt = now;

  const [h0, h1] = [m.players[0].hp, m.players[1].hp];
  if (h0 <= 0 || h1 <= 0 || round >= MAX_ROUNDS) {
    m.status = 'done';
    m.winner = h0 > h1 ? 0 : h1 > h0 ? 1 : -1;
    m.players[0].ready = false;
    m.players[1].ready = false;
    return;
  }
  startRound(m, round + 1);
}

/** Copy of the match as `viewer` may see it: hides the opponent's not-yet-resolved placements & supply. */
export function redactFor(m: MatchState, viewer: Side): MatchState {
  const c: MatchState = structuredClone(m);
  if (c.status !== 'deploy') return c;
  const opp = c.players[viewer === 0 ? 1 : 0];
  const oppSide: Side = viewer === 0 ? 1 : 0;
  // Levels as of the start of this round (hides this round's pending upgrades).
  const last = c.history[c.history.length - 1];
  const prevLevel = new Map<number, number>();
  if (last) for (const u of last.boards[oppSide]) prevLevel.set(u.uid, u.level);
  opp.board = opp.board
    .filter((u) => u.round < c.round)
    .map((u) => {
      const v = { ...u, level: prevLevel.get(u.uid) ?? u.level };
      delete v.target; delete v.hold; delete v.kite; delete v.kiteMount; delete v.focus; delete v.stance; delete v.delay; delete v.retreat; delete v.escort;
      return v;
    });
  for (const d of opp.deck) delete d.behavior;
  opp.supply = -1;
  opp.nextUid = opp.board.reduce((mx, u) => Math.max(mx, u.uid + 1), 1);
  return c;
}

/** Rebuild the exact BattleInput a recorded round was simulated with (for client replay). */
export function battleInputFor(m: MatchState, rec: RoundRecord): BattleInput {
  return {
    seed: rec.seed,
    sides: [
      { designs: m.players[0].deck, units: rec.boards[0] },
      { designs: m.players[1].deck, units: rec.boards[1] },
    ],
  };
}

// ---------------------------------------------------------------------------------------------

/** kiteMount must index an occupied weapon mount of the design (-1 = clear, configure only). */
function validKiteMount(d: Design | undefined, i: unknown, allowClear: boolean): boolean {
  if (!isInt(i)) return false;
  if (i === -1) return allowClear;
  const id = d && i >= 0 && i < d.mounts.length ? d.mounts[i] : null;
  return !!id && MODULE_BY_ID.get(id)?.kind === 'weapon';
}

function sizeOf(d: Design | undefined): Size {
  if (!d) return 1;
  try { return computeStats(d).size; } catch { return 1; }
}
function clonePlacement(p: Placement): Placement {
  const c: Placement = { uid: p.uid, designId: p.designId, x: p.x, y: p.y, level: p.level, round: p.round };
  if (p.spacing !== undefined) c.spacing = p.spacing;
  if (p.target !== undefined) c.target = p.target;
  if (p.hold !== undefined) c.hold = p.hold;
  if (p.kite !== undefined) c.kite = p.kite;
  if (p.kiteMount !== undefined) c.kiteMount = p.kiteMount;
  if (p.focus !== undefined) c.focus = p.focus;
  if (p.stance !== undefined) c.stance = p.stance;
  if (p.delay !== undefined) c.delay = p.delay;
  if (p.retreat !== undefined) c.retreat = p.retreat;
  if (p.escort !== undefined) c.escort = p.escort;
  return c;
}
function cloneDesign(d: Design): Design {
  const c: Design = { id: d.id, name: d.name, chassis: d.chassis, mobility: d.mobility, mounts: [...d.mounts] };
  if (d.behavior) c.behavior = { ...d.behavior };
  return c;
}
