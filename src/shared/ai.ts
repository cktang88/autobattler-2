// AI opponent: deck building + per-round deployment. Pure & deterministic (seeded by match seed, round and side).
//
// Approach
//  - Designs are profiled from the part catalog (aiprofile.ts): roles (swarm, frontline, anti-armour, anti-air,
//    artillery, flyer, support, skirmisher), weapons, armour / shields / cloaks.
//  - aiDeck: 'easy' mixes starters with procedurally generated designs (legacyDeck). 'normal' / 'hard' draw 9 distinct
//    designs from the AI design pool (aipool.ts: ~25 curated, cost-efficient designs that grows with designs learned
//    from players), seeded per match, always covering ground anti-air, flyers, long range, frontline, anti-armour and
//    a cheap swarm.
//  - aiDeploy works only from redactFor(m, side) (no peeking: the opponent's board as it last fought, their deck).
//    'easy' buys randomly (legacy planner). 'normal' (smartPlan) reads the opponent's army (readIntel) and scores
//    every deck design by its Lanchester matchup against it (kill rate x survival per supply, through the sim's
//    armour / shield / splash / cloak / smoke / ECM / reach rules), weighted by what our army still needs (a front
//    line before artillery, anti-air vs air...). It interleaves buys with upgrades of the blocks that did the most
//    damage per supply last round (re-simulated from the round history), spends all its supply (except when saving
//    for its giant), places by role (tanks front facing the enemy's mass, artillery back, AA covering, flankers wide)
//    and re-tunes orders (targets, stances, spacing) against what the opponent fields.
//  - 'hard' drafts its deck: 5 seeded pool draws, each tried in one simulated battle against an army of the opponent's
//    deck (public in the match), keeping the best. Each round it re-simulates the last battle for per-design damage
//    (its own designs' observed efficiency corrects the matchup model; the enemy designs that hurt most weigh more),
//    rarely upgrades (per supply a new block is worth more than a level: measured), sells dead weight, predicts the
//    opponent's additions (our planner from their side with their estimated supply; plus a noisier second guess),
//    builds up to 10 candidate plans (flanks, spread, role-favoured, upgrade-heavier...) and simulates them against
//    the predictions within a deterministic time budget (estimated from unit counts x battle length, ~1 s on a
//    laptop), keeping the best (a candidate must beat the base plan by a margin).
//  - The result is always checked with validateDeploy; on failure it degrades (drop upgrades, then units) down to an
//    empty action, which is always legal while the side may deploy.

import { CHASSIS, MOBILITY, MODULES, pairingError } from './parts.ts';
import { dropExtraWeapons, isValidDesign, levelMult, MAX_LEVEL, slotError, validateDesign, type DefaultOrders } from './stats.ts';
import { DEPLOY_D, DEPLOY_W, MAX_SPACING, blockDims, blockInZone, hasSpacing, normSpacing, rectsOverlap } from './grid.ts';
import { makeRng, mixSeed, type Rng } from './rng.ts';
import { Battle, runBattle } from './sim/battle.ts';
import { STARTER_DESIGNS } from './starters.ts';
import { DECK_SIZE, MAX_BLOCKS, MAX_SIM_UNITS, battleInputFor, newMatch, newPlayer, designCost, placementValue, sellValue, redactFor, roundDamage, supplyForRound, totalSupplyThrough, upgradeCost, validateDeploy } from './match.ts';
import { designKey, isHealer, profile, weaponDps, type Profile, type Role } from './aiprofile.ts';
import { defaultPool, drawDeck, type AiPool } from './aipool.ts';
import type { DeployAction, Design, MatchState, ModuleDef, Placement, Side, Stance, TargetPriority, UnitConfig } from './types.ts';

export { profile, classify, type Profile, type Role } from './aiprofile.ts';

export type AiDifficulty = 'easy' | 'normal' | 'hard';

// ---------------------------------------------------------------------------------------------
// Design profiling

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

/** Weight a module for a target role. 0 = never. Uses ModuleDef.category plus raw weapon fields. */
function moduleWeight(m: ModuleDef, role: Role, firstSlot: boolean): number {
  const isW = m.kind === 'weapon';
  const hitsGround = isW && m.targetsGround !== false;
  const dps = weaponDps(m);
  const cat = m.category;
  const armorW = m.kind === 'armor' && !firstSlot;
  switch (role) {
    case 'antiAir':
      if (cat === 'antiair') return 4;
      return isW && m.targetsAir ? 1 + (m.airBonus ?? 1) * (hitsGround ? 1 : 2) : armorW ? 0.5 : 0;
    case 'antiArmor':
      if (cat === 'cannon' || (cat === 'missile' && m.targetsGround !== false && (m.ap ?? 0) >= 0.5)) return 4;
      return hitsGround && (m.ap ?? 0) >= 0.5 ? 2 + (m.ap ?? 0) * 2 : armorW ? 0.6 : m.rangeBonus && !firstSlot ? 0.5 : 0;
    case 'artillery':
      if (cat === 'artillery') return 5;
      if (m.rangeBonus && !firstSlot) return 1.5;
      return hitsGround && (m.range ?? 0) >= 8 ? 2.5 : 0;
    case 'frontline':
      if (armorW) return 2;
      if (m.shield) return 1.5;
      if (cat === 'flame' || cat === 'disruption') return 1.4;
      return hitsGround && (m.range ?? 0) <= 7 ? 1.3 : 0;
    case 'support':
      if (m.heal) return firstSlot ? 4 : 1.5;
      return m.shield ? 1 : isW ? 0.8 : 0;
    case 'flyer':
      if (cat === 'artillery') return 0;
      return hitsGround ? 1 + dps / 80 + (cat === 'rocket' ? 0.8 : 0) : 0;
    case 'swarm':
      return hitsGround && m.mount === 'S' && m.cost <= 20 ? 2 + (cat === 'machinegun' || cat === 'flame' ? 1 : 0) : 0;
    default:
      if (cat === 'disruption' && !firstSlot) return 1.2;
      return isW ? 1 + dps / 100 : armorW ? 0.4 : m.rangeBonus && !firstSlot ? 0.4 : 0;
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
export function generateDesign(rng: Rng, role: Role, id: string, giant = false): Design | null {
  for (let attempt = 0; attempt < (giant ? 200 : 60); attempt++) {
    const chassisPool = CHASSIS.filter((c) => {
      if (giant) return c.size >= 4 && !c.traits.includes('airOnly');
      if (c.size >= 4) return false; // giants/titans are added deliberately by aiDeck
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
      return true;
    });
    if (!mobPool.length) continue;
    const mob = pick(rng, mobPool);
    const mounts: (string | null)[] = c.mounts.map((slot, i) => {
      const cands = MODULES.filter((m) => !m.retired && !slotError(c, mob.id, i, m))
        .map((m) => ({ item: m.id, w: moduleWeight(m, role, i === 0) * (m.mount === slot ? 1.6 : 0.6) }));
      return weightedPick(rng, cands);
    });
    // Leave trailing slots empty sometimes to save weight.
    const d: Design = { id, name: `${pick(rng, DESIGN_NAMES_A)}${pick(rng, DESIGN_NAMES_B)}`, chassis: c.id, mobility: mob.id, mounts };
    dropExtraWeapons(d); // the hull's weapon cap: the weakest extra weapons leave (their sockets stay free for utilities)
    for (let k = mounts.length - 1; k > 0 && !(giant ? acceptableGiant(d) : acceptable(d, role)); k--) d.mounts[k] = null;
    if (giant ? acceptableGiant(d) : acceptable(d, role)) return d;
  }
  return null;
}

function acceptableGiant(d: Design): boolean {
  if (validateDesign(d).length) return false;
  const p = profile(d);
  return p.stats.load <= 1.1 && p.groundDps > 0 && p.heal <= 0;
}

function acceptable(d: Design, role: Role): boolean {
  if (validateDesign(d).length) return false;
  const p = profile(d);
  if (p.stats.load > 1.1) return false;
  if (p.groundDps + p.aaDps + p.heal <= 0) return false;
  if (role === 'flyer') return p.flying && p.groundDps > 0;
  if (role === 'antiAir') return p.aaDps > 0;
  return p.role === role || (role === 'frontline' && p.toughPerCost >= 15) || (role === 'skirmisher' && !p.flying);
}

// ---------------------------------------------------------------------------------------------
// Deck

const DECK_ROLES: Role[] = ['frontline', 'antiArmor', 'antiAir', 'artillery', 'flyer', 'swarm', 'support', 'skirmisher', 'flyer'];

/** Build an AI deck of up to DECK_SIZE valid designs (deterministic for a seed). 'normal' / 'hard' draw from `pool`
 *  (the browser's learned pool; default: the curated pool). */
export function aiDeck(seed: number, difficulty: AiDifficulty, pool?: AiPool, oppDeck?: Design[]): Design[] {
  if (difficulty !== 'easy') {
    const P = pool ?? defaultPool();
    const deck = drawDeck(P, mixSeed(seed >>> 0, 0x40a1), DECK_SIZE, 1.5);
    const opp = (oppDeck ?? []).filter((d) => { try { return isValidDesign(d); } catch { return false; } });
    if (difficulty === 'hard' && opp.length && deck.length >= 6) return draftDeck(P, seed, deck, opp);
    if (deck.length >= 6) return deck;
  }
  return legacyDeck(seed, difficulty);
}

/** Hard drafts: draw DRAFT_DECKS candidate decks and keep the one whose army does best against an army of the
 *  opponent's deck (each side planned by smartPlan with DRAFT_SUPPLY, countering the other's deck; one battle). The
 *  opponent's deck is public in the match anyway. Well under 1 s, once per match. */
const DRAFT_DECKS = 5;
const DRAFT_SUPPLY = 900;
/** draft battles stop after 60 s of battle time (bounds the cost: ~0.1-0.3 s per deck on a laptop) */
const DRAFT_TICKS = 1200;
function draftDeck(pool: AiPool, seed: number, first: Design[], opp: Design[]): Design[] {
  let best = first, bestScore = -Infinity;
  for (let k = 0; k < DRAFT_DECKS; k++) {
    const deck = k === 0 ? first : drawDeck(pool, mixSeed(seed >>> 0, 0x40a1 + 7919 * k), DECK_SIZE, 1.5);
    if (deck.length < 6) continue;
    let score = -1e9;
    try {
      const m = newMatch('draft', 'ai', mixSeed(seed >>> 0, 0xd4a), newPlayer('ai', deck, true), newPlayer('opp', opp.map((d) => ({ ...d, mounts: [...d.mounts] })), true));
      m.players[0].supply = m.players[1].supply = DRAFT_SUPPLY;
      const opts = (r: number): SmartOpts => ({ rng: makeRng(mixSeed(seed >>> 0, r)), hard: false, upgradeBias: 0.1, flank: 0, jitter: 0, spread: 0 });
      const a0 = sanitize(m, 0, smartPlan(redactFor(m, 0), 0, [], m.players[1].deck, opts(11)));
      const a1 = sanitize(m, 1, smartPlan(redactFor(m, 1), 1, [], m.players[0].deck, opts(12)));
      // a capped battle (the first minute decides most fights): damage dealt minus taken, both in supply terms
      const b = new Battle({ seed: mixSeed(seed >>> 0, 13), sides: [{ designs: m.players[0].deck, units: applyToBoard([], a0) }, { designs: m.players[1].deck, units: applyToBoard([], a1) }] });
      while (!b.done && b.tick < DRAFT_TICKS) b.step();
      const dealt = b.summary().damageDealt;
      score = (dealt[0] - dealt[1]) / Math.max(1, dealt[0] + dealt[1]);
    } catch { /* keep the others */ }
    if (score > bestScore) { bestScore = score; best = deck; }
  }
  return best;
}

/** The original deck builder: starters + procedurally generated designs, picked to cover every role. */
function legacyDeck(seed: number, difficulty: AiDifficulty): Design[] {
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
  // Normal/hard decks carry one giant or titan to save up for.
  if (difficulty !== 'easy' && (difficulty === 'hard' || rng() < 0.5)) {
    const g = generateDesign(rng, 'frontline', `giant`, true);
    if (g) {
      if (deck.length >= DECK_SIZE) deck.pop();
      add(g);
    }
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
  /** value of splash-capable units (artillery, rockets, flame...) */
  splashy: number;
}

function analyze(board: Placement[], deck: Design[]): Threat {
  const byId = new Map(deck.map((d) => [d.id, d] as const));
  const t: Threat = { total: 0, air: 0, heavy: 0, swarm: 0, artillery: 0, aa: 0, ground: 0, splashy: 0 };
  for (const u of board) {
    const d = byId.get(u.designId);
    if (!d) continue;
    const p = profile(d);
    const v = p.cost * (1 + 0.5 * (u.level - 1));
    t.total += v;
    if (p.flying) t.air += v; else t.ground += v;
    if (!p.flying && p.stats.armor >= 9) t.heavy += v;
    if (p.unitCost <= 15) t.swarm += v;
    if (p.splashRadius > 0 || p.role === 'artillery') t.splashy += v;
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
  const dpsPerCost = (p.groundDps + p.aaDps * 0.5) / p.unitCost;
  let s = 1 + dpsPerCost * 0.5 + p.toughPerCost * 0.024; // per-price ratios: prices are raw / PRICE_DIV
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
  if (round <= 1 && p.cost > supplyForRound(1) * 0.4) s *= 0.6;
  void mine;
  return Math.max(0.01, s);
}

// ---------------------------------------------------------------------------------------------
// Placement

function preferredRow(p: Profile, h: number, rng: Rng): number {
  const back = DEPLOY_D - h;
  if (p.flying) return Math.floor(rng() * (back + 1));
  if (p.role === 'artillery' || p.range >= 9) return back;
  if (p.role === 'support') return Math.min(back, 3);
  if (p.role === 'frontline' || p.range <= 4.5 || p.role === 'swarm') return 0;
  if (p.range >= 7) return Math.min(back, 4);
  return Math.min(back, 2);
}

/** Squad spacing by role and by how splashy the enemy is: spread vs splash, packed otherwise. */
export function chooseSpacing(p: Profile, oppSplashShare: number): number {
  if (!hasSpacing(p.stats)) return 0;
  let sp = p.melee || p.role === 'swarm' || p.role === 'skirmisher' ? 1 : 0;
  if (oppSplashShare > 0.5) sp = 3;
  else if (oppSplashShare > 0.2) sp = Math.max(sp, 2);
  else if (oppSplashShare > 0.08) sp = Math.max(sp, 1);
  if (p.role === 'artillery') sp = Math.max(sp, oppSplashShare > 0.08 ? 2 : 1);
  return Math.min(MAX_SPACING, sp);
}

export interface Behavior {
  target: TargetPriority;
  hold: boolean;
  kite: boolean;
  focus: boolean;
  stance: Stance;
  /** seconds before the block starts moving (0, 3, 6) */
  delay: number;
  retreat: boolean;
  /** mount index whose weapon range a kiting unit keeps to (absent = longest-range weapon) */
  kiteMount?: number;
}

export interface BehaviorCtx {
  /** the AI's deck contains a repair unit (so falling back to heal is worthwhile) */
  hasRepair: boolean;
  /** flanking blocks alternate sides: increments per flanker */
  flankCount: number;
}

/** Battle settings by role:
 *  - artillery: holds position (or kites) and hunts dangerous / long-range / valuable targets;
 *  - anti-air: aircraft; anti-tank: armored; snipers: support / valuable / longest-range, kiting, starting late behind the tanks;
 *  - melee & swarms charge, fast skirmishers flank (alternating sides); flyers raid the back line;
 *  - spread squads vs splash hold formation; expensive ground units retreat when a repair unit is around.
 *  (Supports escort a frontline block: assigned by pickEscort in plan, since it needs the other placements.) */
export function chooseBehavior(p: Profile, spacing: number, oppSplashShare: number, rng: Rng, ctx: BehaviorCtx = { hasRepair: false, flankCount: 0 }): Behavior {
  let target: TargetPriority = 'closest';
  let stance: Stance = 'advance';
  let delay = 0;
  switch (p.role) {
    case 'artillery': {
      const r = rng();
      target = r < 0.35 ? 'highestDps' : r < 0.65 ? 'longestRange' : r < 0.85 ? 'valuable' : 'lowestHp';
      break;
    }
    case 'antiArmor': target = rng() < 0.75 ? 'armored' : 'highestHp'; break;
    case 'antiAir': target = 'aircraft'; break;
    case 'flyer': { const r = rng(); target = r < 0.3 ? 'lowestHp' : r < 0.55 ? 'highestDps' : r < 0.8 ? 'longestRange' : 'support'; break; }
    case 'skirmisher':
      if (p.range >= 7) target = p.ap >= 0.3 ? (rng() < 0.5 ? 'support' : 'valuable') : rng() < 0.5 ? 'longestRange' : 'lowestHp';
      else target = rng() < 0.4 ? 'threat' : 'closest';
      break;
    case 'support': target = 'threat'; break;
    case 'swarm': target = rng() < 0.4 ? 'swarm' : 'closest'; break;
    default: target = 'closest';
  }
  const mobile = !p.flying;
  // kite / focus follow the design defaults (the same rule the sim and the garage use)
  let kite = p.defaults.kite;
  if (p.role === 'artillery' && mobile && !p.melee) {
    // artillery with a real standoff range either sits still or kites
    if (rng() < 0.5) { stance = 'holdPos'; kite = false; }
  } else if (mobile && p.melee) {
    stance = 'charge';
  } else if (mobile && p.role === 'swarm' && p.range <= 4.5 && rng() < 0.5) {
    stance = 'charge';
  } else if (mobile && (p.role === 'skirmisher' || p.role === 'swarm') && p.stats.speed >= 3 && !kite) {
    stance = ctx.flankCount % 2 === 0 ? 'flankLeft' : 'flankRight';
  }
  if (stance === 'charge') kite = false;
  // back-line shooters wait a moment so the tanks lead
  if (mobile && stance === 'advance' && p.range >= 7 && (p.role === 'artillery' || p.role === 'skirmisher' || p.role === 'antiArmor')) delay = rng() < 0.5 ? 3 : 6;
  // keep spread by default (blasts punish clumps); a charging squad closes up
  const hold = hasSpacing(p.stats) && stance !== 'charge';
  const focus = p.defaults.focus;
  const retreat = mobile && ctx.hasRepair && p.unitCost >= 20 && p.role !== 'support' && p.role !== 'artillery' && rng() < 0.7;
  if (stance === 'flankLeft' || stance === 'flankRight') ctx.flankCount++;
  return { target, hold, kite: kite && stance !== 'holdPos', focus, stance, delay, retreat };
}

/** For a kiting unit with mixed weapons: the (non-melee) weapon mount carrying the most dps, unless that is
 *  already the longest-range weapon (the sim default). */
function withKiteMount(b: Behavior, d: Design): Behavior {
  if (!b.kite) return b;
  let best = -1, bestDps = 0, longest = -1, longestR = 0;
  d.mounts.forEach((id, i) => {
    const m = id ? MODULES.find((x) => x.id === id) : undefined;
    if (!m || m.kind !== 'weapon' || m.projectile === 'melee' || !(m.range ?? 0)) return;
    const dps = weaponDps(m);
    if (dps > bestDps) { bestDps = dps; best = i; }
    if ((m.range ?? 0) > longestR) { longestR = m.range ?? 0; longest = i; }
  });
  if (best >= 0 && best !== longest) b.kiteMount = best;
  return b;
}

/** Writes b onto pl; kite / focus only when they differ from the design's defaults (unset = default). */
function applyBehavior(pl: Placement | UnitConfig, b: Behavior, defs: DefaultOrders): void {
  if (b.kite && b.kiteMount !== undefined) pl.kiteMount = b.kiteMount;
  if (b.target !== 'closest') pl.target = b.target;
  if (!b.hold) pl.hold = false; // unset = keep spread
  if (b.kite !== defs.kite) pl.kite = b.kite;
  if (b.focus !== defs.focus) pl.focus = b.focus;
  if (b.stance !== 'advance') pl.stance = b.stance;
  if (b.delay > 0) pl.delay = b.delay;
  if (b.retreat) pl.retreat = true;
}

/** Support units (healers, repair chassis) escort the most valuable frontline block: highest cost x level among
 *  armed, mobile, non-support ground blocks (prefers the frontline role). Returns a uid or undefined. */
function pickEscort(blocks: { uid: number; p: Profile; level: number }[], selfUid: number): number | undefined {
  let best: number | undefined, bestV = -1;
  for (const b of blocks) {
    if (b.uid === selfUid || b.p.flying || b.p.heal > 0 || b.p.groundDps <= 0) continue;
    const v = b.p.cost * (1 + 0.5 * (b.level - 1)) * (b.p.role === 'frontline' ? 1.5 : 1);
    if (v > bestV) { bestV = v; best = b.uid; }
  }
  return best;
}


interface Foot { x: number; y: number; w: number; h: number }

function fits(x: number, y: number, w: number, h: number, occ: Foot[]): boolean {
  for (const f of occ) if (rectsOverlap(x, y, w, h, f.x, f.y, f.w, f.h)) return false;
  return true;
}

function findSpot(p: Profile, w: number, h: number, occ: Foot[], rng: Rng, randomPlace: boolean, flank: number): { x: number; y: number } | null {
  const prefY = preferredRow(p, h, rng);
  let best: { x: number; y: number } | null = null;
  let bestScore = -Infinity;
  const center = DEPLOY_W / 2;
  for (let y = 0; y + h <= DEPLOY_D; y++) {
    for (let x = 0; x + w <= DEPLOY_W; x++) {
      if (!fits(x, y, w, h, occ)) continue;
      let score: number;
      if (randomPlace) score = rng();
      else {
        const cx = x + w / 2, cy = y + h / 2;
        let nearest = 99;
        let sameRowCount = 0;
        for (const o of occ) {
          const dx = Math.abs(o.x + o.w / 2 - cx), dy = Math.abs(o.y + o.h / 2 - cy);
          nearest = Math.min(nearest, Math.max(dx - (w + o.w) / 2, dy - (h + o.h) / 2));
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
  const occ: Foot[] = me.board.map((u) => {
    const pd = byId.get(u.designId);
    const pp = pd ? profile(pd) : null;
    return { x: u.x, y: u.y, ...blockDims(pp ? pp.stats : { size: 2, squad: 1 }, u.spacing, !!u.rot) };
  });
  let simUnits = me.board.reduce((n, u) => n + (byId.get(u.designId) ? profile(byId.get(u.designId)!).stats.squad : 1), 0);
  const splashShare = opp.total > 0 ? opp.splashy / opp.total : 0;
  let nextUid = me.nextUid;
  let units = me.board.length;
  const easy = o.difficulty === 'easy';
  const hasRepair = deck.some((d) => isHealer(profile(d)));
  const ctx: BehaviorCtx = { hasRepair, flankCount: o.flank > 0 ? 1 : 0 };

  // --- upgrades: prefer units that survived last round and are valuable ---
  if (!easy && o.upgradeBias > 0 && m.round >= 2 && me.board.length) {
    const last = m.history[m.history.length - 1];
    const surv = new Set(last ? last.result.survivors[side] : []);
    const levels = new Map(me.board.map((u) => [u.uid, u.level] as const));
    const upBudget = Math.floor(budget * Math.min(0.6, 0.25 * o.upgradeBias + (units >= MAX_BLOCKS - 4 || simUnits >= MAX_SIM_UNITS - 16 ? 0.5 : 0) + (occ.length > 22 ? 0.2 : 0)));
    let spent = 0;
    const cands = me.board
      .map((u) => {
        const d = byId.get(u.designId);
        if (!d) return null;
        const sc = designScore(d, opp, mine, roles, m.round) * (surv.has(u.uid) ? 1.4 : 1) * (profile(d).cost >= 80 ? 1.2 : 0.8);
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

  // --- saving for the deck's giant/titan: hold supply when it is within reach next round ---
  const giantD = !easy && o.difficulty !== 'easy' ? deck.filter((d) => profile(d).size >= 4).sort((a, b) => designCost(a) - designCost(b))[0] : undefined;
  let saveForGiant = false;
  if (giantD && m.round >= 2 && m.round <= 11 && me.board.length >= 3) {
    const owned = me.board.some((u) => u.designId === giantD.id);
    const gc = designCost(giantD);
    if (!owned && budget < gc && budget + supplyForRound(m.round + 1) >= gc) saveForGiant = true;
  }
  const giantReady = !!giantD && !me.board.some((u) => u.designId === giantD.id) && designCost(giantD) <= budget;

  // --- purchases ---
  const minCost = Math.min(...deck.map((d) => designCost(d)));
  let guard = 0;
  while (!saveForGiant && budget >= minCost && units < MAX_BLOCKS && guard++ < 80) {
    const afford = deck.filter((d) => designCost(d) <= budget && simUnits + profile(d).stats.squad <= MAX_SIM_UNITS);
    if (!afford.length) break;
    let choice: Design | null;
    if (easy) {
      choice = pick(o.rng, afford);
      if (o.rng() < 0.2) break; // easy leaves supply on the table
    } else {
      const scored = afford.map((d) => {
        let w = designScore(d, opp, mine, roles, m.round);
        if (giantReady && d === giantD) w *= 6;
        if (o.favor && profile(d).role === o.favor) w *= 1.8;
        return { item: d, w: w * w };
      });
      choice = o.difficulty === 'hard'
        ? scored.reduce((a, b) => (b.w * (0.8 + o.rng() * 0.4) > a.w ? b : a)).item
        : weightedPick(o.rng, scored);
    }
    if (!choice) break;
    const p = profile(choice);
    const spacing = easy ? Math.floor(o.rng() * 3) * (hasSpacing(p.stats) ? 1 : 0) : chooseSpacing(p, splashShare);
    let sp = normSpacing(p.stats, spacing);
    // a spread squad is (8+7s) wide: when no spot is left at this spacing, tighten up before giving up
    let foot = blockDims(p.stats, sp);
    let spot = findSpot(p, foot.w, foot.h, occ, o.rng, easy, o.flank);
    while (!spot && sp > 0) {
      sp--;
      foot = blockDims(p.stats, sp);
      spot = findSpot(p, foot.w, foot.h, occ, o.rng, easy, o.flank);
    }
    if (!spot) {
      // no room for this size; try to stop buying this design
      deck.splice(deck.indexOf(choice), 1);
      if (!deck.length) break;
      continue;
    }
    if (!blockInZone(spot.x, spot.y, p.stats, sp)) break;
    occ.push({ x: spot.x, y: spot.y, ...foot });
    const pl: Placement = { uid: nextUid++, designId: choice.id, x: spot.x, y: spot.y, level: 1, round: m.round };
    if (hasSpacing(p.stats)) pl.spacing = sp;
    if (!easy) applyBehavior(pl, withKiteMount(chooseBehavior(p, sp, splashShare, o.rng, ctx), choice), p.defaults);
    action.place.push(pl);
    simUnits += p.stats.squad;
    roles.set(p.role, (roles.get(p.role) ?? 0) + 1);
    budget -= p.cost;
    units++;
  }

  // --- escorts + reconfigure existing units against what the enemy fields now ---
  if (!easy) {
    const blocks = [
      ...me.board.map((u) => ({ uid: u.uid, p: byId.has(u.designId) ? profile(byId.get(u.designId)!) : null, level: u.level })),
      ...action.place.map((u) => ({ uid: u.uid, p: profile(byId.get(u.designId)!), level: 1 })),
    ].filter((x): x is { uid: number; p: Profile; level: number } => !!x.p);
    for (const pl of action.place) {
      const pr = profile(byId.get(pl.designId)!);
      if (!isHealer(pr)) continue;
      const e = pickEscort(blocks, pl.uid);
      if (e !== undefined) { pl.escort = e; delete pl.stance; delete pl.delay; delete pl.kiteMount; if (pr.defaults.kite) pl.kite = false; else delete pl.kite; }
    }
    if (m.round >= 2) {
      for (const u of me.board) {
        const d = byId.get(u.designId);
        if (!d || o.rng() >= 0.3) continue;
        const pr = profile(d);
        const b = withKiteMount(chooseBehavior(pr, u.spacing ?? 0, splashShare, o.rng, ctx), d);
        const cfg: UnitConfig = { uid: u.uid };
        if (isHealer(pr)) {
          if (u.escort === undefined) { const e = pickEscort(blocks, u.uid); if (e !== undefined) cfg.escort = e; }
        } else {
          if (b.target !== (u.target ?? 'closest')) cfg.target = b.target;
          if (b.hold !== (u.hold !== false) && hasSpacing(pr.stats)) cfg.hold = b.hold;
          if (b.kite !== (u.kite ?? pr.defaults.kite)) cfg.kite = b.kite;
          if (b.kite && b.kiteMount !== undefined && b.kiteMount !== u.kiteMount) cfg.kiteMount = b.kiteMount;
          else if (!b.kite && u.kiteMount !== undefined) cfg.kiteMount = -1;
          if (b.focus !== (u.focus ?? pr.defaults.focus)) cfg.focus = b.focus;
          if (b.stance !== (u.stance ?? 'advance')) cfg.stance = b.stance;
          if (b.delay !== (u.delay ?? 0)) cfg.delay = b.delay;
          if (b.retreat !== !!u.retreat) cfg.retreat = b.retreat;
        }
        if (Object.keys(cfg).length > 1) (action.configure ??= []).push(cfg);
      }
    }
  }

  // --- leftover supply -> upgrades (non-easy) ---
  if (!easy && budget > 0 && !saveForGiant) {
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

// ---------------------------------------------------------------------------------------------
// Normal / hard: intel on the opponent

/** One kind of enemy unit the planner expects to fight, with its share of the enemy army's value. */
interface Foe {
  p: Profile;
  /** level multiplier (hp and damage) */
  lm: number;
  /** share of the enemy army's value (0..1) */
  share: number;
  /** supply value of ONE unit of it (block value / squad) */
  unitValue: number;
}

export interface Intel {
  foes: Foe[];
  /** the visible board was empty: foes are the opponent's deck, evenly weighted */
  guess: boolean;
  /** value-weighted shares of the enemy army */
  air: number;
  heavy: number;
  swarm: number;
  splash: number;
  longRange: number;
  fast: number;
  cloaked: number;
  /** the enemy can see cloaked units (sensor masts) */
  detect: boolean;
  /** value-weighted reach of the enemy's ground-hitting guns, and its average speed */
  groundRange: number;
  speed: number;
  /** enemy ground mass centre in OUR local x (cells), or null */
  centreX: number | null;
}

/** Visible enemy board (+ a share of their deck for what they may still add) as foes. */
export function readIntel(board: Placement[], deck: Design[], threat?: Map<string, number>): Intel {
  const byId = new Map(deck.map((d) => [d.id, d] as const));
  const raw: { p: Profile; lm: number; value: number; x: number; w: number }[] = [];
  // designs that did a lot of damage per supply last round count for more (what hurts us gets countered first)
  const tw = (id: string) => (threat?.has(id) ? Math.sqrt(Math.max(0.3, Math.min(3, threat.get(id)!))) : 1);
  for (const u of board) {
    const d = byId.get(u.designId);
    if (!d || !isValidDesign(d)) continue;
    const p = profile(d);
    const lv = Math.max(1, Math.min(MAX_LEVEL, u.level));
    const { w } = blockDims(p.stats, u.spacing ?? 0, !!u.rot);
    raw.push({ p, lm: levelMult(lv), value: placementValue(d, lv) * tw(d.id), x: DEPLOY_W - u.x - w + w / 2, w });
  }
  const guess = raw.length === 0;
  const valid = deck.filter((d) => isValidDesign(d));
  // the deck: everything if the board is unknown, else a 20% hedge on what they could add
  const boardValue = raw.reduce((t, r) => t + r.value, 0);
  const hedge = guess ? 1 : boardValue * PLAN_TUNING.hedge;
  for (const d of valid) raw.push({ p: profile(d), lm: 1, value: hedge / valid.length, x: NaN, w: 0 });
  const total = raw.reduce((t, r) => t + r.value, 0) || 1;
  const merged = new Map<string, Foe>();
  const it: Intel = { foes: [], guess, air: 0, heavy: 0, swarm: 0, splash: 0, longRange: 0, fast: 0, cloaked: 0, detect: false, groundRange: 6, speed: 2, centreX: null };
  let rangeW = 0, rangeSum = 0, speedSum = 0, cx = 0, cw = 0;
  for (const r of raw) {
    const share = r.value / total;
    const key = `${designKeyOf(r.p)}|${r.lm}`;
    const f = merged.get(key);
    if (f) f.share += share;
    else merged.set(key, { p: r.p, lm: r.lm, share, unitValue: Math.max(1, r.p.unitCost * (1 + (r.lm - 1) * 1.67)) });
    const p = r.p;
    if (p.flying) it.air += share;
    if (!p.flying && p.stats.armor >= 9) it.heavy += share;
    if (p.stats.squad >= 8) it.swarm += share;
    if (p.splashRadius > 0 || p.splashDps > p.groundDps * 0.5) it.splash += share;
    if (!p.flying && p.range >= 12) it.longRange += share;
    if (p.stats.speed >= 3 || p.flying) it.fast += share;
    if (p.cloak) it.cloaked += share;
    if (p.detect) it.detect = true;
    if (p.groundDps > 0) { rangeW += share; rangeSum += share * p.range; }
    speedSum += share * p.stats.speed;
    if (!p.flying && Number.isFinite(r.x)) { cx += r.x * r.value; cw += r.value; }
  }
  it.foes = [...merged.values()];
  if (rangeW > 0) it.groundRange = rangeSum / rangeW;
  it.speed = speedSum;
  it.centreX = cw > 0 ? cx / cw : null;
  return it;
}

const designKeyOf = (p: Profile) => `${p.stats.size}|${p.cost}|${p.stats.hp}|${p.range}|${p.groundDps}|${p.aaDps}`;

/** Share of one `b` unit destroyed per second by one `a` unit (levels as multipliers): the armour / shield / cloak /
 *  splash maths of the sim, roughly. `detect` = a's side reveals cloaks. */
function killRate(a: Profile, la: number, b: Profile, lb: number, detect: boolean): number {
  let raw = 0, arm = 0, hitWeight = 0;
  const armor = b.stats.armor;
  const evasive = b.stats.traits.includes('evasive');
  const sq = b.stats.squad;
  for (const w of a.weapons) {
    if (w.dps <= 0 || (b.flying ? !w.air : !w.ground)) continue;
    let dps = w.dps * la * (evasive ? 0.75 + 0.25 * w.acc : w.acc);
    if (w.splash > 0 && sq >= 4) dps *= 1 + Math.min(2, w.splash * (sq >= 8 ? 1.1 : 0.55));
    if (b.cloak && !detect) dps *= b.cloak === 'phantom' ? 0.45 : w.range > 3 ? 0.55 : 0.9;
    if (b.smoke && w.range > 4) dps *= 0.9;
    if (b.jammer) dps *= w.missile ? 0.5 : 0.85;
    if (b.reactive > 0 && w.explosive) dps *= 0.8;
    if (b.energyResist > 0 && w.energy) dps *= 1 - b.energyResist;
    if (w.melee && !b.flying) dps *= a.stats.speed >= 2.5 ? 0.8 : 0.6; // brawlers have to get there
    if (w.minRange > 0 && (b.stats.speed >= 3 || b.melee)) dps *= 0.75;
    const hit = Math.max(1, w.hit * la);
    hitWeight += dps * hit;
    raw += dps;
    arm += dps * Math.max(0.15, (hit - armor * (1 - w.ap)) / hit);
  }
  if (arm <= 0) return 0;
  // reach: a target that out-ranges and out-paces (kites) a ground unit is rarely caught
  if (!a.flying && !b.flying && b.range > a.range + 2) {
    if (b.defaults.kite && b.stats.speed >= a.stats.speed * 0.85) { raw *= 0.45; arm *= 0.45; }
  }
  // overkill: a big single hit on a small unit wastes the rest
  const pool = (b.stats.shield + b.stats.hp) * lb;
  const over = raw > 0 && hitWeight > 0 ? Math.min(1, 0.4 + 0.6 * pool / (hitWeight / raw)) : 1;
  return over / ((b.stats.shield * lb) / raw + (b.stats.hp * lb) / arm);
}

interface Merit { kill: number; loss: number }

/** Lanchester matchup of one design against the expected enemy army, per supply: kill = enemy value destroyed per
 *  second per supply of it, loss = its value lost per second per enemy supply. */
function matchup(p: Profile, it: Intel, myDetect: boolean): Merit {
  let kill = 0, loss = 0;
  for (const f of it.foes) {
    kill += f.share * killRate(p, 1, f.p, f.lm, myDetect) * f.unitValue;
    loss += f.share * killRate(f.p, f.lm, p, 1, it.detect) / f.unitValue;
  }
  kill /= Math.max(1, p.unitCost);
  loss *= Math.max(1, p.unitCost);
  // reach: out-ranging a slow army is free damage; walking a short gun into long guns costs
  if (!p.flying && p.groundDps > 0) {
    const gap = p.range - it.groundRange;
    if (gap > 3) kill *= 1 + Math.min(0.35, gap / 30) * (it.speed < 2.6 ? 1 : 0.4);
    else if (gap < -3 && p.stats.speed < 2.2) loss *= 1.15;
  }
  return { kill, loss };
}

/** Relative merit (mean 1 over `designs`) of each design against the intel. */
export function merits(designs: Design[], it: Intel, myDetect: boolean): Map<string, number> {
  const ms = designs.map((d) => matchup(profile(d), it, myDetect));
  const losses = ms.map((m) => m.loss).filter((x) => x > 0).sort((a, b) => a - b);
  const floor = (losses[Math.floor(losses.length / 2)] ?? 1) * 0.2 || 1e-9;
  const raw = ms.map((m) => Math.sqrt(m.kill / Math.max(floor, m.loss)));
  const mean = raw.reduce((a, b) => a + b, 0) / Math.max(1, raw.length) || 1;
  return new Map(designs.map((d, i) => [d.id, Math.max(0.02, raw[i] / mean)] as const));
}

// ---------------------------------------------------------------------------------------------
// Normal / hard: last round's performance

/** What last round taught us. Values are relative (1 = that side's average per supply). */
export interface RoundPerf {
  /** our blocks: damage dealt per supply */
  block: Map<number, number>;
  /** our designs: damage dealt per supply */
  mine: Map<string, number>;
  /** the enemy's designs: damage they dealt per supply (what hurts us) */
  threat: Map<string, number>;
}
const noPerf = (): RoundPerf => ({ block: new Map(), mine: new Map(), threat: new Map() });

function relative<K>(rows: { k: K; v: number; w: number }[]): Map<K, number> {
  const acc = new Map<K, { v: number; w: number }>();
  for (const r of rows) { const a = acc.get(r.k) ?? { v: 0, w: 0 }; a.v += r.v; a.w += r.w; acc.set(r.k, a); }
  let tv = 0, tw = 0;
  for (const a of acc.values()) { tv += a.v; tw += a.w; }
  const mean = tw > 0 ? tv / tw : 0;
  const out = new Map<K, number>();
  for (const [k, a] of acc) out.set(k, mean > 0 && a.w > 0 ? a.v / a.w / mean : 1);
  return out;
}

/** Re-simulate the last recorded round (deterministic; both boards are public once fought): damage per supply of every
 *  block and design on both sides. */
function lastRoundPerf(view: MatchState, side: Side): RoundPerf {
  const rec = view.history[view.history.length - 1];
  if (!rec) return noPerf();
  try {
    const b = new Battle(battleInputFor(view, rec));
    while (!b.done) b.step();
    const rows = (s: Side) => {
      const byId = new Map(view.players[s].deck.map((d) => [d.id, d] as const));
      return rec.boards[s].flatMap((u) => {
        const d = byId.get(u.designId);
        return d && !isHealer(profile(d)) ? [{ uid: u.uid, k: d.id, v: b.blockDamage(s, u.uid), w: Math.max(1, placementValue(d, u.level)) }] : [];
      });
    };
    const mine = rows(side), theirs = rows(side === 0 ? 1 : 0);
    return { block: relative(mine.map((r) => ({ k: r.uid, v: r.v, w: r.w }))), mine: relative(mine), threat: relative(theirs) };
  } catch { return noPerf(); }
}

/** Cheap stand-in for lastRoundPerf: survival of each block / design last round (wiped 0.75 .. intact 1.3). */
function survivalPerf(view: MatchState, side: Side): RoundPerf {
  const rec = view.history[view.history.length - 1];
  if (!rec) return noPerf();
  const rows = (s: Side) => {
    const alive = new Set(rec.result.survivors[s]);
    return rec.boards[s].map((u) => ({ uid: u.uid, k: u.designId, v: alive.has(u.uid) ? 1.3 : 0.75, w: 1 }));
  };
  const mine = rows(side), theirs = rows(side === 0 ? 1 : 0);
  const block = new Map(mine.map((r) => [r.uid, r.v] as const));
  const avg = (rs: { k: string; v: number }[]) => {
    const m = new Map<string, number[]>();
    for (const r of rs) m.set(r.k, [...(m.get(r.k) ?? []), r.v]);
    return new Map([...m].map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length] as const));
  };
  return { block, mine: avg(mine), threat: avg(theirs) };
}

/** Estimated ms of one battle on a laptop: ~1.1 us per unit per tick (fitted on mid-game AI armies). */
const MS_PER_UNIT_TICK = 0.0011;
function unitCount(pl: Placement[], deck: Design[]): number {
  const byId = new Map(deck.map((d) => [d.id, d] as const));
  return pl.reduce((k, u) => { const d = byId.get(u.designId); return k + (d && isValidDesign(d) ? profile(d).stats.squad : 1); }, 0);
}

// ---------------------------------------------------------------------------------------------
// Normal / hard: the planner

/** Planner tuning (defaults = the shipped values; scripts/aibench.ts experiments override them). */
export const PLAN_TUNING = { divSame: 0.12, divRole: 0.04, meritPow: 1, frontBoost: 1.15, hedge: 0.2 };

/** A block whose design's matchup merit (mean 1) falls below this, and below 40% of the best buy, is sold. */
const SELL_MERIT = 0.6;

export interface SmartOpts {
  rng: Rng;
  hard: boolean;
  /** multiplier on the value of upgrades vs new units */
  upgradeBias: number;
  /** extra weight for designs with this role (candidate variety) */
  favor?: Role;
  /** lateral shift of the whole formation (cells) */
  flank: number;
  /** random jitter on design scores (0 = deterministic best) */
  jitter: number;
  /** extra squad spacing (vs splash) */
  spread: number;
  /** the opponent's estimated supply this round (prediction of the opponent; unused for our own plans) */
  skipGiantSave?: boolean;
  /** sell dead-weight blocks */
  sell?: boolean;
  /** what last round showed (lastRoundPerf / survivalPerf) */
  perf?: RoundPerf;
}

/** Row a role prefers (0 = front of the zone). */
function smartRow(p: Profile, h: number, it: Intel): number {
  const back = DEPLOY_D - h;
  if (p.flying) return Math.max(0, back - 2);
  if (isHealer(p) || p.dome) return Math.min(back, 4);
  if (p.range >= 12 || p.minRange > 0) return back;
  if (p.role === 'antiAir') return Math.min(back, it.air > 0.15 ? 5 : 8);
  if (p.melee || p.role === 'frontline' || p.role === 'swarm' || p.range <= 5) return 0;
  if (p.range >= 9) return Math.min(back, 6);
  if (p.range >= 7) return Math.min(back, 3);
  return Math.min(back, 1);
}

function smartSpot(p: Profile, w: number, h: number, occ: Foot[], rng: Rng, targetX: number, it: Intel): { x: number; y: number } | null {
  const prefY = smartRow(p, h, it);
  let best: { x: number; y: number } | null = null;
  let bestScore = -Infinity;
  for (let y = 0; y + h <= DEPLOY_D; y++) {
    for (let x = 0; x + w <= DEPLOY_W; x++) {
      if (!fits(x, y, w, h, occ)) continue;
      const cx = x + w / 2, cy = y + h / 2;
      let nearest = 99, crowd = 0;
      for (const o of occ) {
        const dx = Math.abs(o.x + o.w / 2 - cx), dy = Math.abs(o.y + o.h / 2 - cy);
        nearest = Math.min(nearest, Math.max(dx - (w + o.w) / 2, dy - (h + o.h) / 2));
        if (dy < 1.5) crowd += Math.max(0, 1 - dx / 8);
      }
      const gapWant = it.splash > 0.25 ? 3 : 1.5;
      const score = -1.6 * Math.abs(y - prefY) + Math.min(gapWant, nearest) * 0.8 - crowd * 0.15 - 0.07 * Math.abs(cx - targetX) + rng() * 0.5;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  return best;
}

/** Lateral aim of a block: brawlers and tanks face the enemy's ground mass; fast flankers go wide of it; the rest
 *  stay around the centre of the line. */
function aimX(p: Profile, it: Intel, flank: number): number {
  const c = DEPLOY_W / 2 + flank;
  if (it.centreX === null) return c;
  const mass = Math.max(10, Math.min(DEPLOY_W - 10, it.centreX));
  if (p.flying) return c;
  if (p.role === 'frontline' || p.melee || p.role === 'antiArmor') return (mass * 2 + c) / 3;
  if (p.stats.speed >= 3 && p.range <= 8) return mass < DEPLOY_W / 2 ? Math.min(DEPLOY_W - 8, mass + 30) : Math.max(8, mass - 30);
  return (mass + c * 2) / 3;
}

/** Normal / hard deployment: buy the designs with the best matchup against the opponent's army (Lanchester merit x
 *  army-composition needs), interleaved with upgrades of the blocks that performed, spending all supply; place by role;
 *  adapt every block's orders to the opponent. */
function smartPlan(view: MatchState, side: Side, oppBoard: Placement[], oppDeck: Design[], o: SmartOpts): DeployAction {
  const me = view.players[side];
  const action: DeployAction = { round: view.round, place: [], upgrade: [] };
  const deck = me.deck.filter((d) => isValidDesign(d));
  if (!deck.length) return action;
  const byId = new Map(me.deck.map((d) => [d.id, d] as const));
  const perf = o.perf ?? noPerf();
  const it = readIntel(oppBoard, oppDeck, perf.threat);
  const myDetect = deck.some((d) => profile(d).detect) && me.board.some((u) => { const d = byId.get(u.designId); return !!d && profile(d).detect; });
  const merit = merits(deck, it, myDetect || deck.some((d) => profile(d).detect && it.cloaked > 0.1));
  // what we saw our own designs do last round corrects the model
  for (const d of deck) if (perf.mine.has(d.id)) merit.set(d.id, merit.get(d.id)! * Math.sqrt(Math.max(0.35, Math.min(1.8, perf.mine.get(d.id)!))));
  let budget = me.supply;
  // sell blocks that have become dead weight against this enemy (e.g. anti-air when it has no aircraft left) when
  // there is something clearly better to buy: 75% back
  const sold = new Set<number>();
  if (o.sell && view.round >= 2) {
    const bestBuy = Math.max(...deck.map((d) => merit.get(d.id) ?? 0));
    const dead = me.board
      .map((u) => ({ u, d: byId.get(u.designId) }))
      .filter((x): x is { u: Placement; d: Design } => !!x.d && !isHealer(profile(x.d)) && (merit.get(x.d.id) ?? 1) < Math.min(SELL_MERIT, 0.4 * bestBuy))
      .sort((x, y) => (merit.get(x.d.id) ?? 1) - (merit.get(y.d.id) ?? 1) || x.u.uid - y.u.uid);
    for (const x of dead.slice(0, 4)) { sold.add(x.u.uid); budget += sellValue(x.d, x.u.level); }
    if (sold.size) action.sell = [...sold];
  }
  const board = me.board.filter((u) => !sold.has(u.uid));
  const occ: Foot[] = board.map((u) => {
    const pd = byId.get(u.designId);
    return { x: u.x, y: u.y, ...blockDims(pd ? profile(pd).stats : { size: 2, squad: 1 }, u.spacing, !!u.rot) };
  });
  let simUnits = board.reduce((n, u) => n + (byId.get(u.designId) ? profile(byId.get(u.designId)!).stats.squad : 1), 0);
  let blocks = board.length;
  // our army so far, by value
  const army = { total: 0, front: 0, long: 0, air: 0, aa: 0, support: 0 };
  const perDesign = new Map<string, number>();
  const roleN = new Map<Role, number>();
  const count = (p: Profile, d: Design, value: number) => {
    army.total += value;
    if (!p.flying && (p.role === 'frontline' || p.melee || (p.size >= 2 && p.toughPerCost >= 14 && p.range <= 9) || p.size >= 4)) army.front += value;
    if (!p.flying && p.range >= 12) army.long += value;
    if (p.flying) army.air += value;
    if (p.aaDps > p.groundDps * 0.6) army.aa += value;
    if (isHealer(p) || p.dome) army.support++;
    perDesign.set(d.id, (perDesign.get(d.id) ?? 0) + 1);
    roleN.set(p.role, (roleN.get(p.role) ?? 0) + 1);
  };
  for (const u of board) { const d = byId.get(u.designId); if (d) count(profile(d), d, placementValue(d, u.level)); }

  /** score of one more block of d (value per supply, ~1 = an average design) */
  const buyScore = (d: Design): number => {
    const p = profile(d);
    let s = Math.pow(merit.get(d.id) ?? 0.02, PLAN_TUNING.meritPow);
    const T = army.total + 1;
    const frontShare = army.front / T;
    const isFront = !p.flying && (p.role === 'frontline' || p.melee || (p.size >= 2 && p.toughPerCost >= 14 && p.range <= 9) || p.size >= 4);
    if (isFront && frontShare < 0.25 && it.air < 0.6) s *= PLAN_TUNING.frontBoost + (0.25 - frontShare);
    if (!p.flying && p.range >= 12 && frontShare < 0.15 && blocks + action.place.length > 0) s *= 0.75;
    if ((isHealer(p) || p.dome) && (blocks < 5 || army.support >= 1 + blocks / 8)) s *= 0.3;
    if (p.groundDps < 0.5 * p.aaDps && it.air < 0.05) s *= 0.5;
    if (it.air > 0.25 && p.aaDps > 0 && army.aa / T < it.air * 0.6) s *= 1.15;
    s /= 1 + PLAN_TUNING.divSame * (perDesign.get(d.id) ?? 0) + PLAN_TUNING.divRole * (roleN.get(p.role) ?? 0);
    // late game the sim-unit cap is the scarce resource: big squads of cheap units crowd out better blocks
    const pressure = simUnits / MAX_SIM_UNITS;
    if (pressure > 0.35) s *= 1 - Math.min(0.75, (pressure - 0.35) * 1.6 * (p.stats.squad / 16));
    if (o.favor && p.role === o.favor) s *= 1.6;
    if (view.round <= 1 && p.cost > supplyForRound(1) * 0.5) s *= 0.6;
    if (o.jitter > 0) s *= 1 - o.jitter / 2 + o.rng() * o.jitter;
    return s;
  };

  // --- save for the deck's giant when it is in reach next round ---
  const giantD = deck.filter((d) => profile(d).size >= 4).sort((a, b) => designCost(a) - designCost(b))[0];
  const ownsGiant = !!giantD && board.some((u) => u.designId === giantD.id);
  let reserve = 0;
  if (giantD && !ownsGiant && !o.skipGiantSave && view.round >= 2 && view.round <= 11 && board.length >= 3 && (merit.get(giantD.id) ?? 0) >= 0.8) {
    const gc = designCost(giantD);
    if (budget < gc && budget + supplyForRound(view.round + 1) >= gc) reserve = budget;
  }

  // --- interleaved buys and upgrades ---
  const levels = new Map(board.map((u) => [u.uid, u.level] as const));
  const ctx: BehaviorCtx = { hasRepair: deck.some((d) => isHealer(profile(d))), flankCount: o.flank > 0 ? 1 : 0 };
  const removed = new Set<string>();
  for (let guard = 0; guard < 120; guard++) {
    const spend = budget - reserve;
    if (spend <= 0) break;
    const crowded = blocks >= MAX_BLOCKS - 2 || simUnits >= MAX_SIM_UNITS - 8;
    // best purchase
    let buy: Design | null = null, buyV = 0;
    if (!crowded) for (const d of deck) {
      if (removed.has(d.id) || designCost(d) > spend || simUnits + profile(d).stats.squad > MAX_SIM_UNITS) continue;
      const v = buyScore(d) * (giantD && d === giantD && !ownsGiant ? 1.6 : 1);
      if (v > buyV) { buyV = v; buy = d; }
    }
    // best upgrade
    let up: Placement | null = null, upV = 0;
    if (view.round >= 2) for (const u of board) {
      const d = byId.get(u.designId);
      const lv = levels.get(u.uid) ?? u.level;
      if (!d || lv >= MAX_LEVEL || upgradeCost(d, lv) > spend) continue;
      const pf = Math.max(0.6, Math.min(1.6, perf.block.get(u.uid) ?? 1));
      const v = Math.pow(merit.get(d.id) ?? 0.02, PLAN_TUNING.meritPow) * Math.sqrt(pf) * (lv === 1 ? 0.62 : 0.5) * Math.max(0.01, o.upgradeBias) * (crowded ? 3 : 1) * (isHealer(profile(d)) ? 0.6 : 1);
      if (v > upV) { upV = v; up = u; }
    }
    if (!buy && !up) break;
    if (up && (!buy || upV > buyV)) {
      const d = byId.get(up.designId)!;
      const lv = levels.get(up.uid) ?? up.level;
      action.upgrade.push(up.uid);
      levels.set(up.uid, lv + 1);
      budget -= upgradeCost(d, lv);
      continue;
    }
    const p = profile(buy!);
    let sp = normSpacing(p.stats, Math.min(MAX_SPACING, chooseSpacing(p, it.splash) + o.spread));
    let foot = blockDims(p.stats, sp);
    const tx = aimX(p, it, o.flank);
    let spot = smartSpot(p, foot.w, foot.h, occ, o.rng, tx, it);
    while (!spot && sp > 0) { sp--; foot = blockDims(p.stats, sp); spot = smartSpot(p, foot.w, foot.h, occ, o.rng, tx, it); }
    if (!spot || !blockInZone(spot.x, spot.y, p.stats, sp)) { removed.add(buy!.id); continue; }
    occ.push({ x: spot.x, y: spot.y, ...foot });
    const pl: Placement = { uid: me.nextUid + action.place.length, designId: buy!.id, x: spot.x, y: spot.y, level: 1, round: view.round };
    if (hasSpacing(p.stats)) pl.spacing = sp;
    applyBehavior(pl, withKiteMount(adaptBehavior(chooseBehavior(p, sp, it.splash, o.rng, ctx), p, it), buy!), p.defaults);
    action.place.push(pl);
    simUnits += p.stats.squad;
    blocks++;
    budget -= p.cost;
    count(p, buy!, p.cost);
  }

  // --- escorts, and every block's orders re-tuned against the enemy we see now ---
  const all = [
    ...board.map((u) => ({ uid: u.uid, p: byId.has(u.designId) ? profile(byId.get(u.designId)!) : null, level: levels.get(u.uid) ?? u.level })),
    ...action.place.map((u) => ({ uid: u.uid, p: profile(byId.get(u.designId)!), level: 1 })),
  ].filter((x): x is { uid: number; p: Profile; level: number } => !!x.p);
  for (const pl of action.place) {
    const pr = profile(byId.get(pl.designId)!);
    if (!isHealer(pr)) continue;
    const e = pickEscort(all, pl.uid);
    if (e !== undefined) { pl.escort = e; delete pl.stance; delete pl.delay; delete pl.kiteMount; if (pr.defaults.kite) pl.kite = false; else delete pl.kite; }
  }
  if (view.round >= 2) {
    for (const u of board) {
      const d = byId.get(u.designId);
      if (!d) continue;
      const pr = profile(d);
      const cfg: UnitConfig = { uid: u.uid };
      if (isHealer(pr)) {
        if (u.escort === undefined) { const e = pickEscort(all, u.uid); if (e !== undefined) cfg.escort = e; }
      } else {
        // keep what worked; re-roll the orders of blocks that underperformed (and sometimes the rest)
        const pf = perf.block.get(u.uid) ?? 1;
        const want = adaptBehavior(chooseBehavior(pr, u.spacing ?? 0, it.splash, o.rng, ctx), pr, it);
        const reroll = pf < 0.7 ? o.rng() < 0.8 : o.rng() < 0.15;
        const b = withKiteMount(reroll ? want : { ...want, stance: u.stance ?? 'advance', delay: u.delay ?? 0, kite: u.kite ?? pr.defaults.kite, retreat: !!u.retreat, hold: u.hold !== false }, d);
        if (b.target !== (u.target ?? 'closest')) cfg.target = b.target;
        if (b.hold !== (u.hold !== false) && hasSpacing(pr.stats)) cfg.hold = b.hold;
        if (b.kite !== (u.kite ?? pr.defaults.kite)) cfg.kite = b.kite;
        if (b.kite && b.kiteMount !== undefined && b.kiteMount !== u.kiteMount) cfg.kiteMount = b.kiteMount;
        else if (!b.kite && u.kiteMount !== undefined) cfg.kiteMount = -1;
        if (b.focus !== (u.focus ?? pr.defaults.focus)) cfg.focus = b.focus;
        if (b.stance !== (u.stance ?? 'advance')) cfg.stance = b.stance;
        if (b.delay !== (u.delay ?? 0)) cfg.delay = b.delay;
        if (b.retreat !== !!u.retreat) cfg.retreat = b.retreat;
      }
      if (Object.keys(cfg).length > 1) (action.configure ??= []).push(cfg);
    }
  }
  return action;
}

/** Target / stance tweaks from the intel: anti-air hunts aircraft only when there are some, long guns go for the
 *  enemy's artillery when it has any, flankers flank away from the enemy's mass. */
function adaptBehavior(b: Behavior, p: Profile, it: Intel): Behavior {
  if (p.aaDps > 0 && p.role === 'antiAir') b.target = it.air > 0.02 ? 'aircraft' : 'closest';
  else if (b.target === 'aircraft' && it.air <= 0.02) b.target = 'closest';
  if (!p.flying && p.range >= 12 && it.longRange > 0.2 && b.target !== 'aircraft') b.target = 'longestRange';
  if (p.ap >= 0.6 && it.heavy > 0.25 && p.role !== 'antiAir') b.target = 'armored';
  if (p.splashRadius > 0 && it.swarm > 0.35 && !p.flying && p.role !== 'antiAir') b.target = 'swarm';
  if ((b.stance === 'flankLeft' || b.stance === 'flankRight') && it.centreX !== null) b.stance = it.centreX < DEPLOY_W / 2 ? 'flankRight' : 'flankLeft';
  return b;
}

/** Make sure the action is legal; strip parts until it is. */
function sanitize(m: MatchState, side: Side, a: DeployAction): DeployAction {
  if (validateDeploy(m, side, a) === null) return a;
  const b: DeployAction = { round: m.round, place: [...a.place], upgrade: [...a.upgrade] };
  if (a.sell?.length) b.sell = [...a.sell];
  if (a.configure) { b.configure = a.configure; if (validateDeploy(m, side, b) !== null) delete b.configure; }
  while (b.upgrade.length && validateDeploy(m, side, b) !== null) b.upgrade.pop();
  while (b.place.length && validateDeploy(m, side, b) !== null) {
    const gone = b.place.pop()!;
    if (b.configure) for (const c of b.configure) if (c.escort === gone.uid) delete c.escort;
    for (const p of b.place) if (p.escort === gone.uid) delete p.escort;
  }
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
    spent += placementValue(d, u.level);
  }
  return Math.max(0, totalSupplyThrough(view.round) - spent);
}

function applyToBoard(board: Placement[], a: DeployAction): Placement[] {
  const sold = new Set(a.sell ?? []);
  const out = board.filter((u) => !sold.has(u.uid)).map((u) => ({ ...u }));
  for (const uid of a.upgrade) {
    const u = out.find((x) => x.uid === uid);
    if (u) u.level = Math.min(MAX_LEVEL, u.level + 1);
  }
  for (const c of a.configure ?? []) {
    const u = out.find((x) => x.uid === c.uid);
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
  for (const p of a.place) out.push({ ...p });
  return out;
}

function evaluate(view: MatchState, side: Side, myBoard: Placement[], oppBoard: Placement[], seed: number): { score: number; ticks: number } {
  const oppSide: Side = side === 0 ? 1 : 0;
  const sides: [{ designs: Design[]; units: Placement[] }, { designs: Design[]; units: Placement[] }] = side === 0
    ? [{ designs: view.players[0].deck, units: myBoard }, { designs: view.players[1].deck, units: oppBoard }]
    : [{ designs: view.players[0].deck, units: oppBoard }, { designs: view.players[1].deck, units: myBoard }];
  const sum = runBattle({ seed, sides });
  const boards: [Placement[], Placement[]] = [sides[0].units, sides[1].units];
  const dmg = roundDamage(view, view.round, sum.winner, sum.survivors, boards, sum.aliveFraction);
  // positive is good for us: damage dealt minus damage taken, plus a bonus for winning outright
  return { score: dmg[oppSide] - dmg[side] + (sum.winner === side ? 5 : sum.winner === oppSide ? -5 : 0), ticks: sum.ticks };
}

/** Simulation budget of one hard decision, in estimated laptop ms (MS_PER_UNIT_TICK): last-round analysis + candidate
 *  battles. Plans themselves cost a few ms each on top. */
export const HARD_MS_BUDGET = 900;
const HARD_MAX_CANDIDATES = 10;
/** Hard tuning, found with scripts/aibench.ts (mirrored matches vs normal). Exported so experiments can override it;
 *  game code never changes it. sell: sell dead-weight blocks; predictMerit: score designs against the predicted
 *  rather than the visible enemy board (0 none / 1 half the candidates / 2 all: measured worse); search: simulate
 *  candidates; second: also score each against a second, noisier guess of the opponent; perfSim: re-simulate last
 *  round for per-design damage; j0 / flank0 / ub0: base plan's jitter, random flank, upgrade bias; margin: hp a
 *  candidate must beat the base plan by. */
export const HARD_KNOBS = { sell: true, predictMerit: 0, search: true, second: true, jitter: 1, perfSim: true, j0: 0, flank0: 0, ub0: 0.1, margin: 2 };

/** Decide the AI's deployment for the current round. Must pass validateDeploy. */
export function aiDeploy(m: MatchState, side: Side, difficulty: AiDifficulty): DeployAction {
  const empty: DeployAction = { round: m.round, place: [], upgrade: [] };
  if (m.status !== 'deploy' || m.players[side].ready) return empty;
  const view = redactFor(m, side);
  const oppSide: Side = side === 0 ? 1 : 0;
  const opp = view.players[oppSide];
  const baseSeed = mixSeed(mixSeed(m.seed, m.round * 2 + side), 0xa1);
  const rng = makeRng(baseSeed);

  if (difficulty === 'easy') {
    const a = plan(view, side, opp.board, opp.deck, { rng, difficulty, upgradeBias: 0, save: 0.25, flank: (rng() - 0.5) * 6 });
    return sanitize(m, side, a);
  }
  const last = view.history[view.history.length - 1];
  const lastMs = last ? (unitCount(last.boards[0], view.players[0].deck) + unitCount(last.boards[1], view.players[1].deck)) * last.result.ticks * MS_PER_UNIT_TICK : 0;
  // hard re-simulates last round for per-block damage when that is cheap; normal uses survival
  const perfSim = HARD_KNOBS.perfSim && difficulty === 'hard' && last !== undefined && lastMs <= 250;
  const perf = perfSim ? lastRoundPerf(view, side) : survivalPerf(view, side);
  if (difficulty === 'normal') {
    const a = smartPlan(view, side, opp.board, opp.deck, { rng, hard: false, upgradeBias: 1, flank: (rng() - 0.5) * 8, jitter: 0.25, spread: 0, perf });
    return sanitize(m, side, a);
  }

  // Hard: predict what the opponent adds this round (our normal planner with their estimated supply, countering our
  // visible board), then simulate candidate plans against that and keep the best.
  const oppView: MatchState = structuredClone(view);
  oppView.players[oppSide].supply = estimateOppSupply(view, oppSide);
  oppView.players[oppSide].ready = false;
  const myVisible = view.history.length ? view.players[side].board.filter((u) => u.round < view.round) : [];
  let predicted = opp.board;
  try {
    const guess = smartPlan(oppView, oppSide, myVisible, view.players[side].deck, {
      rng: makeRng(mixSeed(baseSeed, 77)), hard: false, upgradeBias: 1, flank: 0, jitter: 0, spread: 0, skipGiantSave: true,
    });
    predicted = applyToBoard(opp.board, guess);
  } catch { /* fall back to the visible board */ }
  // a second, noisier guess (another way they might spend) makes the comparison of candidates more robust
  let predicted2: Placement[] | null = null;
  if (HARD_KNOBS.second) try {
    const r2 = makeRng(mixSeed(baseSeed, 78));
    const guess2 = smartPlan(oppView, oppSide, myVisible, view.players[side].deck, {
      rng: r2, hard: false, upgradeBias: 1, flank: (r2() - 0.5) * 16, jitter: 0.4, spread: 0, skipGiantSave: true,
    });
    predicted2 = applyToBoard(opp.board, guess2);
  } catch { /* one guess only */ }

  // upgrades are worth less than new blocks per supply (a level is +30% hp and damage for 50-60% of the price, a new
  // block +100% for 100%): hard upgrades mainly when it runs out of room (measured with scripts/aibench.ts)
  const variants: Omit<SmartOpts, 'rng' | 'hard' | 'perf'>[] = [
    { upgradeBias: HARD_KNOBS.ub0, flank: HARD_KNOBS.flank0 ? (rng() - 0.5) * 8 : 0, jitter: HARD_KNOBS.j0, spread: 0 },
    { upgradeBias: 0.1, flank: 0, jitter: 0.15, spread: 0 },
    { upgradeBias: 0.4, flank: 0, jitter: 0.1, spread: 0 },
    { upgradeBias: 0.1, flank: -12, jitter: 0.15, spread: 1 },
    { upgradeBias: 0.1, flank: 12, jitter: 0.15, spread: 0 },
    { upgradeBias: 0.1, flank: 0, jitter: 0.15, spread: 0, favor: 'frontline' },
    { upgradeBias: 0.1, flank: 0, jitter: 0.15, spread: 0, favor: 'antiAir' },
    { upgradeBias: 0.1, flank: 0, jitter: 0.15, spread: 0, favor: 'antiArmor' },
    { upgradeBias: 0.1, flank: 0, jitter: 0.15, spread: 0, favor: 'flyer' },
    { upgradeBias: 0.1, flank: 0, jitter: 0.15, spread: 1, favor: 'artillery' },
    { upgradeBias: 0.1, flank: 0, jitter: 0.15, spread: 0, favor: 'swarm' },
    { upgradeBias: 0.1, flank: 0, jitter: 0.3, spread: 0, skipGiantSave: true },
  ];
  const order = [0, 1, 2, ...shuffled(rng, variants.map((_, i) => i).slice(3))];
  const cands: DeployAction[] = [];
  const seen = new Set<string>();
  for (const i of order) {
    if (cands.length >= HARD_MAX_CANDIDATES) break;
    const usePred = HARD_KNOBS.predictMerit === 2 || (HARD_KNOBS.predictMerit === 1 && cands.length % 2 === 1);
    const v = variants[i];
    const c = sanitize(m, side, smartPlan(view, side, usePred ? predicted : opp.board, opp.deck, { ...v, sell: HARD_KNOBS.sell, jitter: v.jitter * HARD_KNOBS.jitter, rng: makeRng(mixSeed(baseSeed, 1000 + i)), hard: true, perf }));
    const key = JSON.stringify([c.place.map((p) => [p.designId, p.x, p.y, p.spacing]), c.upgrade]);
    if (seen.has(key)) continue;
    seen.add(key);
    cands.push(c);
  }
  if (cands.length === 1 || !HARD_KNOBS.search) return cands[0];
  // budget: one battle per candidate vs the prediction (+ one vs the visible board while cheap). Battle length is
  // estimated from last round, then from the battles already run (all deterministic: no wall clock).
  let spent = perfSim ? lastMs : 0;
  let ticksEst = Math.max(600, (last?.result.ticks ?? 1200) * 1.2);
  const oppUnits = unitCount(predicted, opp.deck);
  // two guesses per candidate while at least 5 candidates still fit the budget that way
  const est0 = (unitCount(applyToBoard(view.players[side].board, cands[0]), view.players[side].deck) + oppUnits) * ticksEst * MS_PER_UNIT_TICK;
  const second = !!predicted2 && spent + est0 * 2 * Math.min(5, cands.length) <= HARD_MS_BUDGET;
  let best = cands[0], bestScore = -Infinity;
  for (let i = 0; i < cands.length; i++) {
    const myBoard = applyToBoard(view.players[side].board, cands[i]);
    const units = unitCount(myBoard, view.players[side].deck);
    const est = (units + oppUnits) * ticksEst * MS_PER_UNIT_TICK;
    if (i >= 2 && spent + est * (second ? 2 : 1) > HARD_MS_BUDGET) break;
    let score: number;
    try {
      const ev = evaluate(view, side, myBoard, predicted, mixSeed(baseSeed, 5000 + i));
      spent += (units + oppUnits) * ev.ticks * MS_PER_UNIT_TICK;
      ticksEst = Math.max(ticksEst * 0.5, ev.ticks * 1.1);
      score = ev.score;
      if (second) {
        const ev2 = evaluate(view, side, myBoard, predicted2!, mixSeed(baseSeed, 6000 + i));
        spent += (units + oppUnits) * ev2.ticks * MS_PER_UNIT_TICK;
        score = (score + ev2.score) / 2;
      }
    } catch { score = -1e9; }
    // the base plan (candidate 0) is the default: another must beat it by a margin (one battle is a noisy estimate)
    if (score > bestScore + (i > 0 ? HARD_KNOBS.margin : 0)) { bestScore = score; best = cands[i]; }
  }
  return best;
}
