// AI opponent: deck building + per-round deployment. Pure & deterministic (seeded by match seed,
// round and side), so the server and the client produce the same decisions.
//
// Approach
//  - Every design is profiled from the part catalog (no hard-coded module ids): anti-air,
//    anti-armor, splash, artillery, frontline toughness, flyer, swarm, support.
//  - aiDeck: starters + procedurally generated designs, picked to cover every role.
//  - aiDeploy: works only from redactFor(m, side) (no peeking). Scores each deck design against
//    the opponent's visible board (counter bonuses) and our own composition, greedily buys units
//    and upgrades, and places them by role (tanks front, artillery back, spread horizontally).
//  - 'hard' builds several candidate deployments and simulates each with runBattle against the
//    opponent's visible board plus a predicted deployment of their estimated unspent supply,
//    keeping the best. 'easy' buys randomly and places randomly.
//  - The result is always checked with validateDeploy; on failure it degrades (drop units) down to
//    an empty action, which is always legal while the side may deploy.

import { CHASSIS, MOBILITY, MODULES, fitsMount, pairingError } from './parts.ts';
import { computeStats, designModules, MAX_LEVEL, validateDesign } from './stats.ts';
import { DEPLOY_D, DEPLOY_W, inDeployZone, overlaps } from './grid.ts';
import { makeRng, mixSeed, type Rng } from './rng.ts';
import { runBattle } from './sim/battle.ts';
import { STARTER_DESIGNS } from './starters.ts';
import { DECK_SIZE, MAX_UNITS, designCost, redactFor, roundDamage, totalSupplyThrough, upgradeCost, validateDeploy } from './match.ts';
import type { DeployAction, Design, MatchState, ModuleDef, Placement, Side, UnitStats } from './types.ts';

export type AiDifficulty = 'easy' | 'normal' | 'hard';

// ---------------------------------------------------------------------------------------------
// Design profiling

export interface Profile {
  stats: UnitStats;
  cost: number;
  size: number;
  /** dps usable vs air */
  aaDps: number;
  /** dps usable vs ground */
  groundDps: number;
  /** dps-weighted armor pierce of ground weapons (0..1) */
  ap: number;
  /** dps from splash/chain weapons */
  splashDps: number;
  minRange: number;
  range: number;
  /** effective toughness rating per cost */
  toughPerCost: number;
  ehp: number;
  flying: boolean;
  isStatic: boolean;
  heal: number;
  role: Role;
}

export type Role = 'swarm' | 'frontline' | 'antiArmor' | 'antiAir' | 'artillery' | 'flyer' | 'support' | 'skirmisher';

const profileCache = new Map<string, Profile>();
const designKey = (d: Design) => `${d.chassis}|${d.mobility}|${d.mounts.join(',')}`;

export function profile(d: Design): Profile {
  const key = designKey(d);
  const hit = profileCache.get(key);
  if (hit) return hit;
  const s = computeStats(d);
  const mods = designModules(d);
  let aaDps = 0, groundDps = 0, apSum = 0, splashDps = 0, minRange = 0;
  for (const m of mods) {
    if (m.kind !== 'weapon') continue;
    const dps = weaponDps(m);
    if (m.targetsAir) aaDps += dps * (m.airBonus ?? 1);
    if (m.targetsGround !== false) {
      groundDps += dps;
      apSum += dps * (m.ap ?? 0);
    }
    if ((m.splash ?? 0) >= 0.8 || (m.chain ?? 0) > 0 || m.pierce) splashDps += dps * (1 + (m.splash ?? 0) + (m.chain ?? 0) * 0.5);
    if (m.minRange) minRange = Math.max(minRange, m.minRange);
  }
  const ehp = (s.hp + s.shield) * (1 + s.armor / 12) * (s.traits.includes('evasive') ? 1.3 : 1);
  const p: Profile = {
    stats: s, cost: s.cost, size: s.size, aaDps, groundDps, ap: groundDps > 0 ? apSum / groundDps : 0,
    splashDps, minRange, range: s.range, toughPerCost: ehp / Math.max(1, s.cost), ehp,
    flying: s.flying, isStatic: s.isStatic, heal: s.heal, role: 'skirmisher',
  };
  p.role = classify(p);
  profileCache.set(key, p);
  return p;
}

function weaponDps(w: ModuleDef): number {
  if (w.kind !== 'weapon' || !w.damage || !w.cooldown) return 0;
  return (w.damage * (w.burst ?? 1) * (w.pellets ?? 1)) / w.cooldown;
}

function classify(p: Profile): Role {
  if (p.flying) return 'flyer';
  if (p.heal > 0) return 'support';
  if (p.range >= 9 && (p.minRange > 0 || p.groundDps === 0 || p.aaDps < p.groundDps * 0.5)) return 'artillery';
  if (p.aaDps > 0 && (p.groundDps === 0 || p.aaDps >= p.groundDps * 1.4)) return 'antiAir';
  if (p.ap >= 0.55 && p.groundDps > 0) return 'antiArmor';
  if (p.cost <= 75) return 'swarm';
  if (p.size >= 2 && p.toughPerCost >= 3.5) return 'frontline';
  return 'skirmisher';
}

// ---------------------------------------------------------------------------------------------
// Procedural designs

const DESIGN_NAMES_A = ['Rust', 'Iron', 'Cinder', 'Volt', 'Grim', 'Brass', 'Storm', 'Ash', 'Hex', 'Night', 'Scrap', 'Steel', 'Dread', 'Ember', 'Gale'];
const DESIGN_NAMES_B = ['hound', 'jaw', 'fang', 'wasp', 'ram', 'warden', 'mantis', 'beetle', 'hawk', 'golem', 'viper', 'crab', 'lance', 'maul', 'kite'];

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffled<T>(rng: Rng, arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Weight a module for a target role. 0 = never. */
function moduleWeight(m: ModuleDef, role: Role, firstSlot: boolean): number {
  const isW = m.kind === 'weapon';
  const dps = weaponDps(m);
  switch (role) {
    case 'antiAir': return isW && m.targetsAir ? 1 + (m.airBonus ?? 1) * (m.targetsGround ? 1 : 2) : m.kind === 'armor' && !firstSlot ? 0.5 : 0;
    case 'antiArmor': return isW && (m.ap ?? 0) >= 0.5 && m.targetsGround !== false ? 2 + (m.ap ?? 0) * 2 : m.kind === 'armor' && !firstSlot ? 0.6 : 0;
    case 'artillery': return isW && (m.range ?? 0) >= 8 && m.targetsGround !== false ? 3 : 0;
    case 'frontline': return m.kind === 'armor' && !firstSlot ? 2 : isW && m.targetsGround !== false && (m.range ?? 0) <= 7 ? 1.5 : m.shield ? 1.5 : 0;
    case 'support': return m.heal ? (firstSlot ? 4 : 1) : isW ? 0.8 : m.shield ? 1 : 0;
    case 'flyer': return isW && m.targetsGround !== false ? 1 + dps / 80 : 0;
    case 'swarm': return isW && m.targetsGround !== false && m.cost <= 20 ? 2 : 0;
    default: return isW ? 1 + dps / 100 : m.kind === 'armor' && !firstSlot ? 0.4 : 0;
  }
}

function weightedPick<T>(rng: Rng, items: { item: T; w: number }[]): T | null {
  const total = items.reduce((s, i) => s + i.w, 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const i of items) {
    r -= i.w;
    if (r <= 0) return i.item;
  }
  return items[items.length - 1].item;
}

/** Try to generate a valid design aiming at `role`. Returns null if nothing suitable was found. */
export function generateDesign(rng: Rng, role: Role, id: string): Design | null {
  for (let attempt = 0; attempt < 60; attempt++) {
    const chassisPool = CHASSIS.filter((c) => {
      if (role === 'swarm') return c.size === 1;
      if (role === 'frontline') return c.size >= 2;
      if (role === 'support') return c.traits.includes('repairAura') || c.size >= 2;
      return true;
    });
    if (!chassisPool.length) return null;
    const c = pick(rng, chassisPool);
    const mobPool = MOBILITY.filter((mb) => {
      if (pairingError(c.id, mb.id)) return false;
      if (role === 'flyer') return mb.kind === 'air';
      if (mb.kind === 'air') return role === 'antiArmor' ? false : rng() < 0.15;
      if (mb.kind === 'static') return role === 'artillery' || role === 'antiAir' ? rng() < 0.35 : false;
      return true;
    });
    if (!mobPool.length) continue;
    const mob = pick(rng, mobPool);
    const mounts: (string | null)[] = c.mounts.map((slot, i) => {
      const cands = MODULES.filter((m) => fitsMount(slot, m.mount))
        .map((m) => ({ item: m.id, w: moduleWeight(m, role, i === 0) * (m.mount === slot ? 1.6 : 0.6) }));
      return weightedPick(rng, cands);
    });
    // Leave trailing slots empty sometimes to save weight.
    const d: Design = { id, name: `${pick(rng, DESIGN_NAMES_A)}${pick(rng, DESIGN_NAMES_B)}`, chassis: c.id, mobility: mob.id, mounts };
    for (let k = mounts.length - 1; k > 0 && !acceptable(d, role); k--) d.mounts[k] = null;
    if (acceptable(d, role)) return d;
  }
  return null;
}

function acceptable(d: Design, role: Role): boolean {
  if (validateDesign(d).length) return false;
  const p = profile(d);
  if (p.stats.load > 1.1) return false;
  if (p.groundDps + p.aaDps + p.heal <= 0) return false;
  if (role === 'flyer') return p.flying && p.groundDps > 0;
  if (role === 'antiAir') return p.aaDps > 0;
  return p.role === role || (role === 'frontline' && p.toughPerCost >= 3) || (role === 'skirmisher' && !p.flying);
}

// ---------------------------------------------------------------------------------------------
// Deck

const DECK_ROLES: Role[] = ['frontline', 'antiArmor', 'antiAir', 'artillery', 'flyer', 'swarm', 'support', 'skirmisher', 'flyer'];

/** Build an AI deck of up to DECK_SIZE valid designs (deterministic for a seed). */
export function aiDeck(seed: number, difficulty: AiDifficulty): Design[] {
  const rng = makeRng(mixSeed(seed >>> 0, 0xdec4));
  const starters = shuffled(rng, STARTER_DESIGNS.filter((d) => validateDesign(d).length === 0));
  const deck: Design[] = [];
  const used = new Set<string>();
  const add = (d: Design) => {
    if (deck.length >= DECK_SIZE || used.has(designKey(d))) return false;
    used.add(designKey(d));
    deck.push({ ...d, mounts: [...d.mounts], id: `ai-${deck.length}-${d.id}`.slice(0, 40) });
    return true;
  };
  // Generated share: easy uses more random designs; harder AIs lean on curated starters.
  const genChance = difficulty === 'easy' ? 0.6 : difficulty === 'normal' ? 0.3 : 0.25;
  let gen = 0;
  for (const role of DECK_ROLES) {
    const fromStarter = starters.find((d) => !used.has(designKey(d)) && profile(d).role === role);
    if (fromStarter && rng() >= genChance) { add(fromStarter); continue; }
    const g = generateDesign(rng, role, `gen${gen++}`);
    if (g) add(g);
    else if (fromStarter) add(fromStarter);
  }
  // Fill any gaps.
  for (const d of starters) if (deck.length < DECK_SIZE) add(d);
  for (let i = 0; deck.length < DECK_SIZE && i < 20; i++) {
    const g = generateDesign(rng, pick(rng, DECK_ROLES), `gen${gen++}`);
    if (g) add(g);
  }
  return deck;
}

// ---------------------------------------------------------------------------------------------
// Board analysis

interface Threat {
  total: number;
  air: number;
  heavy: number; // value of armored ground units
  swarm: number;
  artillery: number;
  aa: number; // our flyers fear this
  ground: number;
}

function analyze(board: Placement[], deck: Design[]): Threat {
  const byId = new Map(deck.map((d) => [d.id, d] as const));
  const t: Threat = { total: 0, air: 0, heavy: 0, swarm: 0, artillery: 0, aa: 0, ground: 0 };
  for (const u of board) {
    const d = byId.get(u.designId);
    if (!d) continue;
    const p = profile(d);
    const v = p.cost * (1 + 0.5 * (u.level - 1));
    t.total += v;
    if (p.flying) t.air += v; else t.ground += v;
    if (!p.flying && p.stats.armor >= 9) t.heavy += v;
    if (p.cost <= 75) t.swarm += v;
    if (p.role === 'artillery') t.artillery += v;
    if (p.aaDps > 0) t.aa += v * Math.min(1, p.aaDps / Math.max(1, p.aaDps + p.groundDps) * 1.5);
  }
  return t;
}

/** How much we want one more of design `d`, given the threat and our current composition. */
function designScore(d: Design, opp: Threat, mine: Threat, mineRoles: Map<Role, number>, round: number): number {
  const p = profile(d);
  const T = Math.max(1, opp.total);
  const airShare = opp.air / T, heavyShare = opp.heavy / T, swarmShare = opp.swarm / T, artyShare = opp.artillery / T;
  const aaShare = opp.aa / T;
  // Base efficiency: power per cost.
  const dpsPerCost = (p.groundDps + p.aaDps * 0.5) / p.cost;
  let s = 1 + dpsPerCost * 2.5 + p.toughPerCost * 0.12;
  if (opp.total > 0) {
    if (p.aaDps > 0) s += airShare * 4 * Math.min(1.5, p.aaDps / Math.max(20, p.groundDps + p.aaDps) * 2);
    if (airShare > 0.3 && p.aaDps === 0) s *= 0.75;
    if (p.groundDps === 0 && airShare < 0.1) s *= 0.15;
    s += heavyShare * 3 * p.ap;
    s += swarmShare * 3 * Math.min(1, p.splashDps / Math.max(1, p.groundDps));
    if (artyShare > 0.2 && (p.flying || p.stats.speed >= 3)) s += artyShare * 3;
    if (p.flying) s *= 1 - Math.min(0.7, aaShare * 1.2);
  } else {
    if (p.groundDps === 0) s *= 0.3; // pure AA with no air threat known
  }
  // Composition balance: want a frontline, then ranged behind it.
  const count = (r: Role) => mineRoles.get(r) ?? 0;
  const total = [...mineRoles.values()].reduce((a, b) => a + b, 0);
  if (p.role === 'frontline' && count('frontline') < 1 + total / 5) s *= 1.5;
  if (p.role === 'artillery' && count('frontline') + count('skirmisher') + count('antiArmor') < 2) s *= 0.5;
  if (p.role === 'support' && total < 4) s *= 0.4;
  s /= 1 + 0.25 * count(p.role);
  if (round <= 1 && p.cost > 350) s *= 0.6;
  void mine;
  return Math.max(0.01, s);
}

// ---------------------------------------------------------------------------------------------
// Placement

function preferredRow(p: Profile, rng: Rng): number {
  const back = DEPLOY_D - p.size;
  if (p.flying) return Math.floor(rng() * (back + 1));
  if (p.role === 'artillery' || p.range >= 9) return back;
  if (p.role === 'support') return Math.min(back, 3);
  if (p.role === 'frontline' || p.range <= 4.5 || p.role === 'swarm') return 0;
  if (p.range >= 7) return Math.min(back, 4);
  return Math.min(back, 2);
}

interface Foot { x: number; y: number; s: number }

function fits(x: number, y: number, s: number, occ: Foot[]): boolean {
  if (!inDeployZone(x, y, s as 1 | 2 | 3)) return false;
  for (const f of occ) if (overlaps(x, y, s, f.x, f.y, f.s)) return false;
  return true;
}

function findSpot(p: Profile, occ: Foot[], rng: Rng, randomPlace: boolean, flank: number): { x: number; y: number } | null {
  const s = p.size;
  const prefY = preferredRow(p, rng);
  let best: { x: number; y: number } | null = null;
  let bestScore = -Infinity;
  const center = DEPLOY_W / 2;
  for (let y = 0; y + s <= DEPLOY_D; y++) {
    for (let x = 0; x + s <= DEPLOY_W; x++) {
      if (!fits(x, y, s, occ)) continue;
      let score: number;
      if (randomPlace) score = rng();
      else {
        const cx = x + s / 2, cy = y + s / 2;
        let nearest = 99;
        let sameRowCount = 0;
        for (const f of occ) {
          const dx = Math.abs(f.x + f.s / 2 - cx), dy = Math.abs(f.y + f.s / 2 - cy);
          nearest = Math.min(nearest, Math.max(dx, dy) - (s + f.s) / 2);
          if (dy < 1.5) sameRowCount += Math.max(0, 1 - dx / 8);
        }
        score = -1.6 * Math.abs(y - prefY)
          + Math.min(2.5, nearest) * 0.8
          - sameRowCount * 0.15
          - 0.06 * Math.abs(cx - (center + flank))
          + rng() * 0.6;
      }
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Deployment planning

interface PlanOpts {
  rng: Rng;
  difficulty: AiDifficulty;
  /** multiplier on how much supply to spend on upgrades (0 = none) */
  upgradeBias: number;
  /** fraction of supply to keep unspent */
  save: number;
  /** extra weight for one role (candidate variety) */
  favor?: Role;
  flank: number;
}

function plan(m: MatchState, side: Side, oppBoard: Placement[], oppDeck: Design[], o: PlanOpts): DeployAction {
  const me = m.players[side];
  const deck = me.deck.filter((d) => validateDesign(d).length === 0);
  const action: DeployAction = { round: m.round, place: [], upgrade: [] };
  if (!deck.length) return action;
  const byId = new Map(me.deck.map((d) => [d.id, d] as const));
  let budget = Math.floor(me.supply * (1 - o.save));
  const opp = analyze(oppBoard, oppDeck);
  const mine = analyze(me.board, me.deck);
  const roles = new Map<Role, number>();
  for (const u of me.board) {
    const d = byId.get(u.designId);
    if (d) { const r = profile(d).role; roles.set(r, (roles.get(r) ?? 0) + 1); }
  }
  const occ: Foot[] = me.board.map((u) => ({ x: u.x, y: u.y, s: byId.get(u.designId) ? profile(byId.get(u.designId)!).size : 1 }));
  let nextUid = me.nextUid;
  let units = me.board.length;
  const easy = o.difficulty === 'easy';

  // --- upgrades: prefer units that survived last round and are valuable ---
  if (!easy && o.upgradeBias > 0 && m.round >= 2 && me.board.length) {
    const last = m.history[m.history.length - 1];
    const surv = new Set(last ? last.result.survivors[side] : []);
    const levels = new Map(me.board.map((u) => [u.uid, u.level] as const));
    const upBudget = Math.floor(budget * Math.min(0.6, 0.25 * o.upgradeBias + (units >= MAX_UNITS - 4 ? 0.5 : 0) + (occ.length > 22 ? 0.2 : 0)));
    let spent = 0;
    const cands = me.board
      .map((u) => {
        const d = byId.get(u.designId);
        if (!d) return null;
        const sc = designScore(d, opp, mine, roles, m.round) * (surv.has(u.uid) ? 1.4 : 1) * (profile(d).cost >= 150 ? 1.2 : 0.8);
        return { u, d, sc };
      })
      .filter((x): x is { u: Placement; d: Design; sc: number } => !!x)
      .sort((a, b) => b.sc - a.sc || a.u.uid - b.u.uid);
    for (const c of cands) {
      const lv = levels.get(c.u.uid)!;
      if (lv >= MAX_LEVEL) continue;
      const cost = upgradeCost(c.d, lv);
      if (spent + cost > upBudget) continue;
      if (o.rng() < 0.25) continue;
      action.upgrade.push(c.u.uid);
      levels.set(c.u.uid, lv + 1);
      spent += cost;
    }
    budget -= spent;
  }

  // --- purchases ---
  const minCost = Math.min(...deck.map((d) => designCost(d)));
  let guard = 0;
  while (budget >= minCost && units < MAX_UNITS && guard++ < 80) {
    const afford = deck.filter((d) => designCost(d) <= budget);
    if (!afford.length) break;
    let choice: Design | null;
    if (easy) {
      choice = pick(o.rng, afford);
      if (o.rng() < 0.2) break; // easy leaves supply on the table
    } else {
      const scored = afford.map((d) => {
        let w = designScore(d, opp, mine, roles, m.round);
        if (o.favor && profile(d).role === o.favor) w *= 1.8;
        return { item: d, w: w * w };
      });
      choice = o.difficulty === 'hard'
        ? scored.reduce((a, b) => (b.w * (0.8 + o.rng() * 0.4) > a.w ? b : a)).item
        : weightedPick(o.rng, scored);
    }
    if (!choice) break;
    const p = profile(choice);
    const spot = findSpot(p, occ, o.rng, easy, o.flank);
    if (!spot) {
      // no room for this size; try to stop buying this design
      const smaller = deck.filter((d) => profile(d).size < p.size);
      if (!smaller.length) break;
      deck.splice(deck.indexOf(choice), 1);
      if (!deck.length) break;
      continue;
    }
    occ.push({ x: spot.x, y: spot.y, s: p.size });
    action.place.push({ uid: nextUid++, designId: choice.id, x: spot.x, y: spot.y, level: 1, round: m.round });
    roles.set(p.role, (roles.get(p.role) ?? 0) + 1);
    budget -= p.cost;
    units++;
  }

  // --- leftover supply -> upgrades (non-easy) ---
  if (!easy && budget > 0) {
    const levels = new Map(me.board.map((u) => [u.uid, u.level] as const));
    for (const uid of action.upgrade) levels.set(uid, levels.get(uid)! + 1);
    const sorted = [...me.board].sort((a, b) => designCost(byId.get(b.designId)!) - designCost(byId.get(a.designId)!) || a.uid - b.uid);
    for (const u of sorted) {
      const d = byId.get(u.designId);
      if (!d) continue;
      const lv = levels.get(u.uid)!;
      if (lv >= MAX_LEVEL) continue;
      const c = upgradeCost(d, lv);
      if (c <= budget) { action.upgrade.push(u.uid); levels.set(u.uid, lv + 1); budget -= c; }
    }
  }
  return action;
}

/** Make sure the action is legal; strip parts until it is. */
function sanitize(m: MatchState, side: Side, a: DeployAction): DeployAction {
  if (validateDeploy(m, side, a) === null) return a;
  const b: DeployAction = { round: m.round, place: [...a.place], upgrade: [] };
  while (b.place.length && validateDeploy(m, side, b) !== null) b.place.pop();
  if (validateDeploy(m, side, b) === null) return b;
  return { round: m.round, place: [], upgrade: [] };
}

// ---------------------------------------------------------------------------------------------
// Hard: simulate candidates

/** Estimate the opponent's unspent supply from what is visible (deterministic economy). */
function estimateOppSupply(view: MatchState, oppSide: Side): number {
  const opp = view.players[oppSide];
  const byId = new Map(opp.deck.map((d) => [d.id, d] as const));
  let spent = 0;
  for (const u of opp.board) {
    const d = byId.get(u.designId);
    if (!d) continue;
    spent += designCost(d);
    for (let l = 1; l < u.level; l++) spent += upgradeCost(d, l);
  }
  return Math.max(0, totalSupplyThrough(view.round) - spent);
}

function applyToBoard(board: Placement[], a: DeployAction): Placement[] {
  const out = board.map((u) => ({ ...u }));
  for (const uid of a.upgrade) {
    const u = out.find((x) => x.uid === uid);
    if (u) u.level = Math.min(MAX_LEVEL, u.level + 1);
  }
  for (const p of a.place) out.push({ ...p });
  return out;
}

function evaluate(view: MatchState, side: Side, myBoard: Placement[], oppBoard: Placement[], seed: number): number {
  const oppSide: Side = side === 0 ? 1 : 0;
  const sides: [{ designs: Design[]; units: Placement[] }, { designs: Design[]; units: Placement[] }] = side === 0
    ? [{ designs: view.players[0].deck, units: myBoard }, { designs: view.players[1].deck, units: oppBoard }]
    : [{ designs: view.players[0].deck, units: oppBoard }, { designs: view.players[1].deck, units: myBoard }];
  const sum = runBattle({ seed, sides });
  const boards: [Placement[], Placement[]] = [sides[0].units, sides[1].units];
  const dmg = roundDamage(view, view.round, sum.winner, sum.survivors, boards);
  // Positive is good for us: damage dealt minus damage taken, plus a small bonus for winning outright.
  return dmg[oppSide] - dmg[side] + (sum.winner === side ? 5 : sum.winner === oppSide ? -5 : 0);
}

const HARD_CANDIDATES = 6;

/** Decide the AI's deployment for the current round. Must pass validateDeploy. */
export function aiDeploy(m: MatchState, side: Side, difficulty: AiDifficulty): DeployAction {
  const empty: DeployAction = { round: m.round, place: [], upgrade: [] };
  if (m.status !== 'deploy' || m.players[side].ready) return empty;
  const view = redactFor(m, side);
  const oppSide: Side = side === 0 ? 1 : 0;
  const opp = view.players[oppSide];
  const baseSeed = mixSeed(mixSeed(m.seed, m.round * 2 + side), 0xa1);
  const rng = makeRng(baseSeed);

  if (difficulty !== 'hard') {
    const a = plan(view, side, opp.board, opp.deck, {
      rng, difficulty, upgradeBias: difficulty === 'normal' ? 1 : 0, save: difficulty === 'easy' ? 0.25 : 0,
      flank: (rng() - 0.5) * 6,
    });
    return sanitize(m, side, a);
  }

  // Predict what the opponent adds this round: a 'normal' plan with their estimated supply.
  const oppView: MatchState = structuredClone(view);
  oppView.players[oppSide].supply = estimateOppSupply(view, oppSide);
  oppView.players[oppSide].ready = false;
  const myVisible = view.history.length ? view.players[side].board.filter((u) => u.round < view.round) : [];
  let predicted = opp.board;
  try {
    const guess = plan(oppView, oppSide, myVisible, view.players[side].deck, {
      rng: makeRng(mixSeed(baseSeed, 77)), difficulty: 'normal', upgradeBias: 1, save: 0, flank: 0,
    });
    predicted = applyToBoard(opp.board, guess);
  } catch { /* fall back to visible board */ }

  const variants: Partial<PlanOpts>[] = [
    { upgradeBias: 1 },
    { upgradeBias: 0 },
    { upgradeBias: 2.2 },
    { upgradeBias: 0.5, favor: 'frontline' },
    { upgradeBias: 0.5, favor: 'antiAir' },
    { upgradeBias: 0.5, favor: 'antiArmor' },
    { upgradeBias: 0.5, favor: 'flyer' },
    { upgradeBias: 0.5, favor: 'artillery' },
    { upgradeBias: 0.5, favor: 'swarm' },
  ];
  let best: DeployAction | null = null;
  let bestScore = -Infinity;
  const n = Math.min(variants.length, HARD_CANDIDATES);
  // Always include the first three (core) variants; pick the rest by seed.
  const order = [0, 1, 2, ...shuffled(rng, [3, 4, 5, 6, 7, 8])].slice(0, n);
  for (let i = 0; i < order.length; i++) {
    const v = variants[order[i]];
    const cand = sanitize(m, side, plan(view, side, opp.board, opp.deck, {
      rng: makeRng(mixSeed(baseSeed, 1000 + i)), difficulty: 'hard', upgradeBias: v.upgradeBias ?? 1, save: 0,
      favor: v.favor, flank: (i % 3 - 1) * 3,
    }));
    const myBoard = applyToBoard(view.players[side].board, cand);
    let score = 0;
    try {
      score = evaluate(view, side, myBoard, predicted, mixSeed(baseSeed, 5000 + i));
      if (predicted !== opp.board && opp.board.length) score = score * 0.7 + 0.3 * evaluate(view, side, myBoard, opp.board, mixSeed(baseSeed, 6000 + i));
    } catch { score = 0; }
    if (score > bestScore) { bestScore = score; best = cand; }
  }
  return sanitize(m, side, best ?? empty);
}

