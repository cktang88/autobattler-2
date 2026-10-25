// The AI's design pool: a curated set of strong, cost-efficient designs covering every role, from which the normal
// and hard AIs draw a fresh 9-design deck each match (seeded, so it rotates match to match), and which LEARNS from the
// players it fights (evolvePool, run by the client after each vs-AI match and persisted per browser).
//
//  - Every entry keeps a running effectiveness score (decayed average of its per-match performance; 1 = average).
//  - Roles: ai.ts / aiprofile.ts classify (swarm, frontline, antiArmor, antiAir, artillery, flyer, support,
//    skirmisher). Coverage tags (designTags) add the variants the deck draw guarantees or the quotas protect:
//    ground anti-air, interceptors, long range, shielded, armoured, stealth, giant.
//  - Dedupe: designs are keyed on chassis + mobility + SORTED mounts (name / id ignored); near-duplicates (same hull,
//    drive and weapons, differing only in utilities / armour) share one "slot": never two of them in the pool.
//  - Pure and deterministic (no Math.random); the stored format is versioned and validated (sanitizePool).
//
// Cost-efficiency of the curated designs: scripts/aipool-check.ts (equal-supply mixed armies, ~50% = priced right).

import { classify, profile, ROLES, type Role } from './aiprofile.ts';
import { MODULE_BY_ID } from './parts.ts';
import { isValidDesign, MAX_LEVEL } from './stats.ts';
import { DECK_SIZE, battleInputFor, placementValue } from './match.ts';
import { makeRng, mixSeed, type Rng } from './rng.ts';
import { Battle } from './sim/battle.ts';
import type { Design, MatchState, RoundRecord, Side } from './types.ts';

const D = (id: string, name: string, chassis: string, mobility: string, mounts: (string | null)[]): Design => ({ id, name, chassis, mobility, mounts });

/** The curated default pool. Each line: role (classify) / what it is for; mixed-army win rate from aipool-check. */
export const AI_POOL: Design[] = [
  // ---- cheap swarms ----
  D('pool-lasertick', 'Lasertick', 'scout', 'legs', ['laser']), //                      swarm: 8 laser walkers, hit air too
  D('pool-hailrunner', 'Hailrunner', 'scout', 'wheels', ['hmg']), //                    swarm: 16 fast 12.7mm buggies (AP, AA)
  D('pool-chatterbug', 'Chatterbug', 'scout', 'wheels', ['twinmg']), //                 cheap ground AA swarm: suppressor MGs pin
  // ---- frontline (armoured / shielded / smoke) ----
  D('pool-arcwarden', 'Arc Warden', 'warden', 'treads', ['tesla', 'plateL']), //        armoured tesla brawler, chains through clumps
  D('pool-shieldwarden', 'Shieldwarden', 'warden', 'treads', ['shield', 'hmg']), //      shielded line holder, 12.7mm
  D('pool-pyrewall', 'Pyrewall', 'juggernaut', 'treads', ['napalm', 'hardened']), //    heavy armour wall with napalm, stun-proof
  D('pool-bastion', 'Aegis Bastion', 'bastion', 'treads', ['shieldH', 'cannon75', 'plateH']), // heavy barrier + plate, 75mm
  D('pool-smokecrab', 'Smokecrab', 'crab', 'treads', ['napalm', 'plateH', 'smoke']), // plated flamer, smoke vs long guns
  // ---- anti-armour ----
  D('pool-gunsled', 'Gunsled', 'carriage', 'halftrack', ['cannon75']), //               cheap 75mm gun carriages (8)
  D('pool-ghosthunter', 'Ghost Hunter', 'hunter', 'hover', ['stealth', 'atgm']), //     cloaked ATGM raider
  D('pool-gausslance', 'Gauss Lance', 'longarm', 'spider', ['gauss']), //               long-range anti-armour, hits air
  // ---- anti-air ----
  D('pool-flakdisc', 'Flak Disc', 'saucer', 'hover', ['flak', 'flak', 'hmg']), //       ground AA: twin flak
  D('pool-skyspear', 'Skyspear', 'strider', 'legs', ['sam', 'aamissile', 'aamissile']), // ground AA: SAM walker
  D('pool-interceptor', 'Talon', 'interceptor', 'jet', ['aamissile', 'aamissile']), //  interceptor flyers (air superiority)
  // ---- artillery / long range ----
  D('pool-cruisewalker', 'Cruise Walker', 'longarm', 'spider', ['cruise']), //          cruise-missile carrier, ~170 m reach
  D('pool-rocketcart', 'Rocket Cart', 'carriage', 'halftrack', ['rockets']), //         rocket artillery carts (8)
  D('pool-railstrider', 'Railstrider', 'striker', 'spider', ['lightrail', 'lightrail', 'targeting']), // twin rails, long range
  D('pool-shade', 'Wraith', 'striker', 'halftrack', ['lightrail', 'stealth', 'sniper']), // cloaked sniper
  D('pool-siegebattery', 'Siege Battery', 'siegeplat', 'spider', ['barrage', 'mortar']), // barrage + mortar artillery
  // ---- flyers ----
  D('pool-laserdrone', 'Laser Drone', 'drone', 'rotor', ['laser']), //                  laser drones (4)
  D('pool-clusterdart', 'Cluster Dart', 'deltawing', 'jet', ['clusterbombs', 'hmg', 'hmg']), // cluster-bomb jets
  D('pool-stormcopter', 'Stormcopter', 'gunship', 'rotor', ['tesla', 'heatray']), //    tesla / heat-ray gunship
  // ---- support / stealth / giant ----
  D('pool-domecar', 'Dome Car', 'striker', 'halftrack', ['dome', 'uplink', 'hmg']), //  shield dome + fire-rate uplink
  D('pool-jamstrider', 'Jamstrider', 'strider', 'legs', ['jammer', 'laser', 'laser']), // ECM laser walker
  D('pool-infernohulk', 'Inferno Hulk', 'goliath', 'megatracks', ['inferno', 'tesla', 'plateH', 'plateH']), // giant flame / tesla wall
];

/** Starting effectiveness of the curated designs: 0.5 + 0.6 x their mixed-army win rate in scripts/aipool-check.ts
 *  (5 seeds; 50% = priced right). The match-by-match scores take over from there. */
export const POOL_PRIOR: Record<string, number> = {
  'pool-lasertick': 1.1, 'pool-hailrunner': 1.1, 'pool-chatterbug': 1.1, 'pool-pyrewall': 1.1, 'pool-flakdisc': 1.1, 'pool-laserdrone': 1.1,
  'pool-skyspear': 1.09, 'pool-jamstrider': 1.09, 'pool-arcwarden': 1.07, 'pool-clusterdart': 1.07, 'pool-infernohulk': 1.07,
  'pool-interceptor': 1.03, 'pool-stormcopter': 1.03, 'pool-ghosthunter': 0.97, 'pool-domecar': 0.97, 'pool-shieldwarden': 0.96,
  'pool-smokecrab': 0.96, 'pool-gunsled': 0.95, 'pool-cruisewalker': 0.95, 'pool-rocketcart': 0.95, 'pool-railstrider': 0.94,
  'pool-gausslance': 0.94, 'pool-shade': 0.94, 'pool-bastion': 0.92, 'pool-siegebattery': 0.83,
};

// ---------------------------------------------------------------------------------------------
// Keys, tags, quotas

/** Identity of a design: hull + drive + sorted mounts (name, id and mount order ignored). */
export function poolKey(d: Design): string {
  return `${d.chassis}|${d.mobility}|${[...d.mounts].map((x) => x ?? '-').sort().join(',')}`;
}
/** Near-duplicate slot: hull + drive + sorted weapons (utilities and armour ignored). */
export function slotKey(d: Design): string {
  const w = d.mounts.filter((x): x is string => !!x && MODULE_BY_ID.get(x)?.kind === 'weapon').sort();
  return `${d.chassis}|${d.mobility}|${w.join(',')}`;
}

export type Tag = 'swarm' | 'frontline' | 'antiArmor' | 'aaGround' | 'interceptor' | 'flyer' | 'longRange' | 'support' | 'shield' | 'armor' | 'stealth' | 'giant';

const tagCache = new Map<string, Set<Tag>>();
/** What a design covers, for deck coverage and pool quotas. */
export function designTags(d: Design): Set<Tag> {
  const k = poolKey(d);
  const hit = tagCache.get(k);
  if (hit) return hit;
  const p = profile(d);
  const t = new Set<Tag>();
  const ground = !p.flying;
  if (ground && p.stats.squad >= 8 && p.groundDps > 0) t.add('swarm');
  if (ground && p.groundDps > 0 && p.range <= 9 && (p.role === 'frontline' || (p.size >= 2 && p.toughPerCost >= 14) || p.size >= 4)) t.add('frontline');
  if (ground && p.groundDps > 0 && (p.role === 'antiArmor' || p.ap >= 0.6)) t.add('antiArmor');
  if (ground && p.aaDps > 0 && (p.role === 'antiAir' || d.mounts.some((id) => { const m = id ? MODULE_BY_ID.get(id) : undefined; return !!m && m.kind === 'weapon' && (m.targetsGround === false || (m.airBonus ?? 1) > 1); }))) t.add('aaGround');
  if (p.flying && p.aaDps > 0 && p.aaDps >= 0.8 * p.groundDps) t.add('interceptor');
  if (p.flying && p.groundDps > 0) t.add('flyer');
  if (ground && p.groundDps > 0 && p.range >= 12) t.add('longRange');
  if (p.heal > 0 || p.dome || p.stats.traits.includes('repairAura')) t.add('support');
  if (p.stats.shield >= 100 || p.dome) t.add('shield');
  if (ground && p.stats.armor >= 10) t.add('armor');
  if (p.cloak || p.jammer || p.smoke) t.add('stealth');
  if (p.size >= 4) t.add('giant');
  tagCache.set(k, t);
  return t;
}

/** Tags every deck the normal / hard AI draws must cover. */
export const DECK_TAGS: readonly Tag[] = ['aaGround', 'flyer', 'longRange', 'frontline', 'antiArmor', 'swarm'];
/** Pool floors per tag: removing an entry may never take a tag below this. */
export const TAG_MIN: Partial<Record<Tag, number>> = { aaGround: 2, flyer: 2, longRange: 2, frontline: 3, antiArmor: 2, swarm: 2, interceptor: 1, shield: 1, armor: 1, stealth: 1, support: 1 };
/** Per-role floors and ceilings (classify roles) so no role empties or floods the pool. */
export const ROLE_MIN: Record<Role, number> = { swarm: 1, frontline: 2, antiArmor: 1, antiAir: 1, artillery: 2, flyer: 2, support: 0, skirmisher: 0 };
export const ROLE_MAX: Record<Role, number> = { swarm: 7, frontline: 10, antiArmor: 7, antiAir: 7, artillery: 9, flyer: 9, support: 4, skirmisher: 8 };
/** The pool grows with adopted designs up to this many entries; then the weakest make room. */
export const POOL_CAP = 50;
/** Never prune below this many entries. */
export const POOL_FLOOR = 18;
/** Weight of one match in an entry's running score. */
export const SCORE_ALPHA = 0.3;
/** A player design is adopted when the player won, or when it did at least this much better than the AI's own
 *  designs of the same role. */
export const ADOPT_RATIO = 1.3;
/** An entry with at least PRUNE_GAMES matches whose score falls below this share of its role's median is pruned. */
export const PRUNE_RATIO = 0.6;
export const PRUNE_GAMES = 3;

export const roleOf = (d: Design): Role => profile(d).role;

// ---------------------------------------------------------------------------------------------
// Stored pool

export const POOL_VERSION = 1;
export interface PoolEntry {
  design: Design;
  /** running effectiveness (decayed average; 1 = an average design in the matches it played) */
  score: number;
  /** matches it has been scored in */
  games: number;
  /** adopted from a player */
  learned?: boolean;
}
export interface AiPool { v: typeof POOL_VERSION; entries: PoolEntry[]; matches: number }

export function defaultPool(): AiPool {
  return { v: POOL_VERSION, entries: AI_POOL.map((d) => ({ design: cleanDesign(d), score: POOL_PRIOR[d.id] ?? 1, games: 0 })), matches: 0 };
}

function cleanDesign(d: Design): Design {
  return { id: String(d.id).slice(0, 40), name: String(d.name).slice(0, 24), chassis: d.chassis, mobility: d.mobility, mounts: [...d.mounts] };
}

function validEntryDesign(d: unknown): d is Design {
  if (!d || typeof d !== 'object') return false;
  const x = d as Design;
  if (typeof x.id !== 'string' || typeof x.name !== 'string' || typeof x.chassis !== 'string' || typeof x.mobility !== 'string' || !Array.isArray(x.mounts)) return false;
  if (!x.mounts.every((m) => m === null || typeof m === 'string')) return false;
  try { return isValidDesign(x); } catch { return false; }
}

/** A stored pool, validated: unknown / corrupt data, a wrong version, invalid designs or a pool that no longer covers
 *  every deck tag fall back to the curated default. Invalid entries are dropped, duplicates merged. */
export function sanitizePool(raw: unknown): AiPool {
  if (!raw || typeof raw !== 'object') return defaultPool();
  const r = raw as Partial<AiPool>;
  if (r.v !== POOL_VERSION || !Array.isArray(r.entries)) return defaultPool();
  const entries: PoolEntry[] = [];
  const keys = new Set<string>(), slots = new Set<string>();
  for (const e of r.entries.slice(0, POOL_CAP * 2)) {
    if (!e || typeof e !== 'object' || !validEntryDesign(e.design)) continue;
    const score = Number.isFinite(e.score) ? Math.max(0, Math.min(5, e.score)) : 1;
    const games = Number.isInteger(e.games) && e.games >= 0 ? e.games : 0;
    const d = cleanDesign(e.design);
    if (keys.has(poolKey(d)) || slots.has(slotKey(d))) continue;
    keys.add(poolKey(d)); slots.add(slotKey(d));
    const pe: PoolEntry = { design: d, score, games };
    if (e.learned) pe.learned = true;
    entries.push(pe);
  }
  const pool: AiPool = { v: POOL_VERSION, entries: entries.slice(0, POOL_CAP), matches: Number.isInteger(r.matches) && r.matches! >= 0 ? r.matches! : 0 };
  if (!DECK_TAGS.every((t) => pool.entries.some((e) => designTags(e.design).has(t))) || pool.entries.length < DECK_SIZE) return defaultPool();
  return pool;
}

// ---------------------------------------------------------------------------------------------
// Deck draw

/** Draw `size` distinct designs from the pool (seeded): first one per DECK_TAGS tag, then by weight; weights favour
 *  higher-scoring entries (score^sharp), spread the deck over roles and allow at most one giant. `bias` (optional)
 *  multiplies an entry's weight (e.g. its matchup against the opponent's deck). */
export function drawDeck(pool: AiPool, seed: number, size = DECK_SIZE, sharp = 2, bias?: (d: Design) => number): Design[] {
  const rng = makeRng(mixSeed(seed >>> 0, 0x9001));
  const entries = pool.entries.filter((e) => validEntryDesign(e.design));
  const deck: PoolEntry[] = [];
  const keys = new Set<string>(), slots = new Set<string>();
  const roleN = new Map<Role, number>();
  const has = (t: Tag) => deck.some((e) => designTags(e.design).has(t));
  const ok = (e: PoolEntry) => !keys.has(poolKey(e.design)) && !slots.has(slotKey(e.design)) && !(designTags(e.design).has('giant') && has('giant'));
  const weight = (e: PoolEntry) => Math.pow(Math.max(0.05, e.score), sharp) / (1 + 0.6 * (roleN.get(roleOf(e.design)) ?? 0)) * (e.games === 0 ? 1 : 1 + Math.min(0.2, 0.02 * e.games)) * (bias ? bias(e.design) : 1);
  const take = (e: PoolEntry) => {
    deck.push(e); keys.add(poolKey(e.design)); slots.add(slotKey(e.design));
    roleN.set(roleOf(e.design), (roleN.get(roleOf(e.design)) ?? 0) + 1);
  };
  for (const t of shuffle(rng, DECK_TAGS)) {
    if (has(t) || deck.length >= size) continue;
    const e = weighted(rng, entries.filter((x) => ok(x) && designTags(x.design).has(t)), weight);
    if (e) take(e);
  }
  while (deck.length < size) {
    const e = weighted(rng, entries.filter(ok), weight);
    if (!e) break;
    take(e);
  }
  return deck.map((e, i) => ({ ...cleanDesign(e.design), id: `ai-${i}-${e.design.id}`.slice(0, 40) }));
}

function shuffle<T>(rng: Rng, arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function weighted<T>(rng: Rng, items: T[], w: (x: T) => number): T | null {
  const ws = items.map(w);
  const total = ws.reduce((a, b) => a + b, 0);
  if (!items.length || total <= 0) return null;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// ---------------------------------------------------------------------------------------------
// Match scoring

/** One design's record over a match (summed over rounds and blocks). */
export interface DesignPerf {
  side: Side;
  designId: string;
  /** supply invested, summed over the rounds it fought (purchase + upgrades of every block, per round) */
  invested: number;
  /** supply value of the enemy units it destroyed */
  killed: number;
  /** damage dealt (hull + shields) plus repairs done */
  dealt: number;
  /** effectiveness, relative to the match: 1 = average supply efficiency of both armies */
  eff: number;
}

export type RoundTally = Map<string, Omit<DesignPerf, 'eff'>>;

/** Re-simulate one recorded round (deterministic) and tally every design's investment, kills and damage. */
export function scoreRound(m: MatchState, rec: RoundRecord): RoundTally {
  const b = new Battle(battleInputFor(m, rec));
  while (!b.done) b.step();
  const units = b.units;
  const squadN = new Map<string, number>();
  for (const u of units) squadN.set(`${u.side}:${u.uid}`, (squadN.get(`${u.side}:${u.uid}`) ?? 0) + 1);
  const valueOf = units.map((u) => placementValue(u.design, Math.min(MAX_LEVEL, u.level)) / (squadN.get(`${u.side}:${u.uid}`) ?? 1));
  const out: RoundTally = new Map();
  for (const u of units) {
    const k = `${u.side}:${u.design.id}`;
    let e = out.get(k);
    if (!e) { e = { side: u.side, designId: u.design.id, invested: 0, killed: 0, dealt: 0 }; out.set(k, e); }
    const t = b.unitTally(u.id);
    e.invested += valueOf[u.id];
    e.dealt += t.dealt + t.healed;
    for (const v of t.kills) e.killed += valueOf[v] ?? 0;
  }
  return out;
}

/** Sum round tallies and rate every design against the match average. */
export function combinePerf(rounds: RoundTally[]): DesignPerf[] {
  const sum = new Map<string, Omit<DesignPerf, 'eff'>>();
  for (const r of rounds) for (const [k, v] of r) {
    const e = sum.get(k) ?? { side: v.side, designId: v.designId, invested: 0, killed: 0, dealt: 0 };
    e.invested += v.invested; e.killed += v.killed; e.dealt += v.dealt;
    sum.set(k, e);
  }
  let inv = 0, kil = 0, dea = 0;
  for (const v of sum.values()) { inv += v.invested; kil += v.killed; dea += v.dealt; }
  const trade = kil / Math.max(1, inv), dpc = dea / Math.max(1, inv);
  return [...sum.values()].map((v) => ({
    ...v,
    eff: v.invested > 0 ? 0.5 * (trade > 0 ? v.killed / v.invested / trade : 1) + 0.5 * (dpc > 0 ? v.dealt / v.invested / dpc : 1) : 0,
  }));
}

/** Every design's performance over a finished (or partly played) match: re-simulates all recorded rounds. */
export function scoreMatch(m: MatchState): DesignPerf[] {
  return combinePerf(m.history.map((rec) => scoreRound(m, rec)));
}

// ---------------------------------------------------------------------------------------------
// Evolution

const NAMES_A = ['Copy', 'Mimic', 'Echo', 'Ghost', 'Stolen', 'Shadow', 'Mirror', 'Rival', 'Twin', 'Phantom', 'Proxy', 'Clone'];
const NAMES_B = ['hound', 'fang', 'wasp', 'ram', 'mantis', 'beetle', 'hawk', 'golem', 'viper', 'lance', 'maul', 'kite', 'warden', 'spike'];
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** An adopted design keeps the player's parts but gets an AI id and name. */
export function adoptDesign(d: Design): Design {
  const h = hash(poolKey(d));
  return { id: `lrn-${h.toString(36)}`, name: `${NAMES_A[h % NAMES_A.length]}${NAMES_B[(h >>> 8) % NAMES_B.length]}`, chassis: d.chassis, mobility: d.mobility, mounts: [...d.mounts] };
}

const median = (xs: number[]) => {
  if (!xs.length) return 1;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Could `e` leave the pool without breaking a floor (pool size, roles, tags)? */
function removable(entries: PoolEntry[], e: PoolEntry, replacement?: Design): boolean {
  const rest = entries.filter((x) => x !== e).map((x) => x.design);
  if (replacement) rest.push(replacement);
  else if (rest.length < POOL_FLOOR) return false;
  const role = roleOf(e.design);
  if (rest.filter((d) => roleOf(d) === role).length < ROLE_MIN[role]) return false;
  for (const t of designTags(e.design)) if (rest.filter((d) => designTags(d).has(t)).length < (TAG_MIN[t] ?? 0)) return false;
  return true;
}

/** Fold a match into the pool: score the AI's designs, adopt the player's best designs when they earned it, prune the
 *  weakest. Pure: returns a new pool. `aiSide` = the AI's side (localdriver: 1); `perf` = scoreMatch(m) (pass it in
 *  when already computed). Never adds a duplicate (same key or slot), never takes a role / tag below its floor,
 *  never exceeds POOL_CAP. */
export function evolvePool(pool: AiPool, m: MatchState, aiSide: Side = 1, perf?: DesignPerf[]): AiPool {
  const base = sanitizePool(pool);
  const entries: PoolEntry[] = base.entries.map((e) => ({ ...e, design: cleanDesign(e.design) }));
  const out: AiPool = { v: POOL_VERSION, entries, matches: base.matches + 1 };
  if (!m || !Array.isArray(m.history) || !m.history.length || !m.players?.[0] || !m.players?.[1]) return out;
  let scores: DesignPerf[];
  try { scores = perf ?? scoreMatch(m); } catch { return out; }
  const pSide: Side = aiSide === 0 ? 1 : 0;
  const deckOf = (s: Side) => new Map(m.players[s].deck.map((d) => [d.id, d] as const));
  const aiDecks = deckOf(aiSide), pDecks = deckOf(pSide);
  const findKey = (d: Design) => entries.find((e) => poolKey(e.design) === poolKey(d));
  const findSlot = (d: Design) => entries.find((e) => slotKey(e.design) === slotKey(d));
  const blend = (e: PoolEntry, eff: number) => { e.score = e.score * (1 - SCORE_ALPHA) + SCORE_ALPHA * eff; e.games++; };

  // 1. the AI's own designs: running scores
  const aiPerf = scores.filter((s) => s.side === aiSide && s.invested > 0 && aiDecks.has(s.designId));
  for (const s of aiPerf) {
    const d = aiDecks.get(s.designId)!;
    const e = findKey(d) ?? findSlot(d);
    if (e) blend(e, s.eff);
  }

  // 2. the player's two best designs (with a real investment behind them)
  const pPerf = scores.filter((s) => s.side === pSide && pDecks.has(s.designId));
  const pTotal = pPerf.reduce((t, s) => t + s.invested, 0);
  const won = m.status === 'done' && m.winner === pSide;
  const best = pPerf.filter((s) => s.invested >= Math.max(1, 0.05 * pTotal)).sort((a, b) => b.eff - a.eff || (a.designId < b.designId ? -1 : 1)).slice(0, 2);
  for (const s of best) {
    const src = pDecks.get(s.designId)!;
    if (!validEntryDesign(src)) continue;
    const d = adoptDesign(src);
    if (!isValidDesign(d)) continue;
    const role = roleOf(d);
    const rivals = aiPerf.filter((a) => roleOf(aiDecks.get(a.designId)!) === role);
    const rivalEff = rivals.length
      ? rivals.reduce((t, a) => t + a.eff * a.invested, 0) / rivals.reduce((t, a) => t + a.invested, 0)
      : median(entries.filter((e) => roleOf(e.design) === role).map((e) => e.score));
    if (!won && !(s.eff >= ADOPT_RATIO * rivalEff)) continue;
    // already pooled (same parts in any order): merge
    const same = findKey(d);
    if (same) { blend(same, s.eff); continue; }
    // near-duplicate (same hull, drive, weapons): keep the better one in that slot
    const near = findSlot(d);
    if (near) {
      if (s.eff > near.score) { near.design = d; near.learned = true; }
      blend(near, s.eff);
      continue;
    }
    const fresh: PoolEntry = { design: d, score: Math.max(0.5, Math.min(3, s.eff)), games: 1, learned: true };
    const roleN = entries.filter((e) => roleOf(e.design) === role).length;
    if (roleN < ROLE_MAX[role] && entries.length < POOL_CAP) { entries.push(fresh); continue; }
    // full: replace the weakest that may go (same role when the role is full) and scores below the newcomer
    const victims = entries
      .filter((e) => (roleN >= ROLE_MAX[role] ? roleOf(e.design) === role : true) && e.score < fresh.score && removable(entries, e, d))
      .sort((a, b) => a.score - b.score || (poolKey(a.design) < poolKey(b.design) ? -1 : 1));
    if (victims.length) entries[entries.indexOf(victims[0])] = fresh;
  }

  // 3. prune one entry that has clearly fallen behind its role
  const medians = new Map(ROLES.map((r) => [r, median(entries.filter((e) => roleOf(e.design) === r).map((e) => e.score))] as const));
  const weak = entries
    .filter((e) => e.games >= PRUNE_GAMES && e.score < PRUNE_RATIO * medians.get(roleOf(e.design))! && removable(entries, e))
    .sort((a, b) => a.score / medians.get(roleOf(a.design))! - b.score / medians.get(roleOf(b.design))!);
  if (weak.length) entries.splice(entries.indexOf(weak[0]), 1);
  return out;
}

/** Roles present in a pool (for tests / tooling). */
export function roleCounts(pool: AiPool): Record<Role, number> {
  const c = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
  for (const e of pool.entries) c[roleOf(e.design)]++;
  return c;
}
export { classify };
