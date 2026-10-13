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

import { computeStats, levelMult, MAX_LEVEL, validateDesign } from './stats.ts';
import { inDeployZone, overlaps } from './grid.ts';
import { mixSeed } from './rng.ts';
import { runBattle } from './sim/battle.ts';
import type { BattleInput } from './sim/types.ts';
import type { DeployAction, Design, MatchMode, MatchState, Placement, PlayerState, RoundRecord, Side } from './types.ts';

export const DECK_SIZE = 9;
export const START_HP = 100;
/** After this round resolves the match ends regardless; higher hp wins. */
export const MAX_ROUNDS = 15;
/** Hard cap on units per side (bounds simulation cost). */
export const MAX_UNITS = 40;
export const MAX_PLAYER_NAME = 24;

const ROUND_SUPPLY_BASE = 300;
const ROUND_SUPPLY_GROWTH = 50;

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

const round5 = (n: number) => Math.ceil(n / 5) * 5;

/** Supply cost of a design (same as computeStats().cost). */
export function designCost(design: Design): number {
  return computeStats(design).cost;
}

/** Cost to raise a unit from `level` to `level + 1`: 50% of design cost for L1->2, 60% for L2->3. */
export function upgradeCost(design: Design, level: number): number {
  return round5(designCost(design) * (0.4 + 0.1 * level));
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

/** Damage contributed by one surviving enemy unit. */
export function survivorDamage(design: Design, level: number): number {
  return (designCost(design) * levelMult(level)) / 45;
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
    if (d && typeof d === 'object') {
      if (ids.has(d.id)) errs.push(`Duplicate design id ${d.id}`);
      ids.add(d.id);
    }
  }
  return errs;
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
  if (p.board.length + a.place.length > MAX_UNITS) return `Too many units (max ${MAX_UNITS})`;

  const designs = new Map(p.deck.map((d) => [d.id, d] as const));
  let cost = 0;
  const seenUids = new Set<number>(p.board.map((u) => u.uid));
  const footprints: { x: number; y: number; s: number }[] = p.board.map((u) => ({ x: u.x, y: u.y, s: sizeOf(designs.get(u.designId)) }));

  for (const pl of a.place) {
    if (!pl || typeof pl !== 'object') return 'Bad placement';
    const d = designs.get(pl.designId);
    if (!d) return `Unknown design ${String(pl.designId)}`;
    if (!isInt(pl.uid) || pl.uid < p.nextUid) return `Bad unit id ${String(pl.uid)}`;
    if (seenUids.has(pl.uid)) return `Duplicate unit id ${pl.uid}`;
    seenUids.add(pl.uid);
    if (pl.level !== 1) return 'New units start at level 1';
    if (pl.round !== m.round) return 'Placement round mismatch';
    const s = sizeOf(d);
    if (!isInt(pl.x) || !isInt(pl.y) || !inDeployZone(pl.x, pl.y, s as 1 | 2 | 3)) return `${d.name} is outside the deploy zone`;
    for (const f of footprints) if (overlaps(pl.x, pl.y, s, f.x, f.y, f.s)) return `${d.name} overlaps another unit`;
    footprints.push({ x: pl.x, y: pl.y, s });
    cost += designCost(d);
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
  for (const pl of a.place) {
    p.board.push({ uid: pl.uid, designId: pl.designId, x: pl.x, y: pl.y, level: 1, round: m.round });
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
export function roundDamage(m: MatchState, round: number, winner: Side | -1, survivors: [number[], number[]], boards: [Placement[], Placement[]]): [number, number] {
  const sv = (s: Side) => {
    const designs = new Map(m.players[s].deck.map((d) => [d.id, d] as const));
    const alive = new Set(survivors[s]);
    let v = 0;
    for (const u of boards[s]) {
      if (!alive.has(u.uid)) continue;
      const d = designs.get(u.designId);
      if (d) v += survivorDamage(d, u.level);
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
  const damage = roundDamage(m, round, sum.winner, survivors, boards);
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
    .map((u) => ({ ...u, level: prevLevel.get(u.uid) ?? u.level }));
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

function sizeOf(d: Design | undefined): number {
  if (!d) return 1;
  try { return computeStats(d).size; } catch { return 1; }
}
function clonePlacement(p: Placement): Placement {
  return { uid: p.uid, designId: p.designId, x: p.x, y: p.y, level: p.level, round: p.round };
}
function cloneDesign(d: Design): Design {
  return { id: d.id, name: d.name, chassis: d.chassis, mobility: d.mobility, mounts: [...d.mounts] };
}
