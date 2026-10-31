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
import { CHASSIS, MOBILITY, MODULES, MODULE_BY_ID, pairingError } from './parts.ts';
import { dropExtraWeapons, isValidDesign, MAX_LEVEL, replaceRetiredModules, slotError } from './stats.ts';
import { DECK_SIZE, battleInputFor, placementValue } from './match.ts';
import { makeRng, mixSeed, type Rng } from './rng.ts';
import { Battle } from './sim/battle.ts';
import { deployRole } from './smartdeploy.ts';
import type { Design, MatchState, ModuleDef, RoundRecord, Side } from './types.ts';
import type { BattleSummary } from './sim/types.ts';

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
  D('pool-flakdisc', 'Flak Disc', 'saucer', 'hover', ['flak', 'flak', 'shieldL']), // ground AA: twin flak
  D('pool-skyspear', 'Skyspear', 'strider', 'legs', ['sam', 'aamissile', 'targeting']), // ground AA: SAM walker
  D('pool-interceptor', 'Talon', 'interceptor', 'jet', ['aamissile', 'aamissile']), //  interceptor flyers (air superiority)
  // ---- artillery / long range ----
  D('pool-cruisewalker', 'Cruise Walker', 'longarm', 'spider', ['cruise']), //          cruise-missile carrier, ~170 m reach
  D('pool-rocketcart', 'Rocket Cart', 'carriage', 'halftrack', ['rockets']), //         rocket artillery carts (8)
  D('pool-railstrider', 'Railstrider', 'striker', 'spider', ['lightrail', 'lightrail', 'targeting']), // twin rails, long range
  D('pool-shade', 'Wraith', 'striker', 'halftrack', ['lightrail', 'stealth', 'sniper']), // cloaked sniper
  D('pool-siegebattery', 'Siege Battery', 'siegeplat', 'spider', ['barrage', 'mortar']), // barrage + mortar artillery
  // ---- flyers ----
  D('pool-laserdrone', 'Laser Drone', 'drone', 'rotor', ['laser']), //                  laser drones (4)
  D('pool-clusterdart', 'Cluster Dart', 'deltawing', 'jet', ['clusterbombs', 'hmg', 'shieldL']), // cluster-bomb jets
  D('pool-painter', 'Spotter', 'raider', 'halftrack', ['laser', 'painter']), //         laser spotter: marks targets for the army
  D('pool-berserker', 'Ravager', 'mantis', 'legs', ['buzzsaw', 'berserker']), //       melee berserker: hits hardest when hurt
  D('pool-longgun', 'Long Gun', 'warden', 'spider', ['cannon', 'longbarrel']), //      long-barrel tank killer
  D('pool-stundart', 'Stun Dart', 'deltawing', 'jet', ['stuncluster', 'hmg', 'shieldL']), // stun-cluster jets: lock down swarms ahead of the push
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
  'pool-skyspear': 1.09, 'pool-jamstrider': 1.09, 'pool-arcwarden': 1.07, 'pool-clusterdart': 1.07, 'pool-stundart': 1, 'pool-painter': 1, 'pool-berserker': 1, 'pool-longgun': 1, 'pool-infernohulk': 1.07,
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

/** 2: the pool is global (server-side); per-browser v1 pools from before are discarded.
 *  3: two tiers: `entries` (tested) and `candidates`; v2 pools migrate (their entries become the tested tier). */
export const POOL_VERSION = 3;
/** One verdict of a design in one AI match (match id, did well / did badly). */
export interface Verdict { m: string; good: boolean }
export interface PoolEntry {
  design: Design;
  /** running effectiveness (decayed average; 1 = an average design in the matches it played) */
  score: number;
  /** matches it has been scored in */
  games: number;
  /** adopted from a player */
  learned?: boolean;
  /** a tweaked variant of an ineffective AI design (mutateWeak) */
  mutant?: boolean;
  /** its clear verdicts in its last AI matches (distinct match ids, newest last, at most VERDICT_WINDOW) */
  rec?: Verdict[];
  /** when it entered the candidate tier (ms) */
  addedAt?: number;
  /** when it was promoted to the tested tier (ms) */
  promotedAt?: number;
  /** where it came from (absent = curated default) */
  origin?: 'curated' | 'adopted' | 'mutant';
  /** adopted: the reporting player's display name ('guest' when not signed in) */
  creator?: string;
  /** mutant: the parent design's name */
  parent?: string;
}

/** Something that happened to a pool entry (foldMatch reports them; the server time-stamps and logs them). */
export interface PoolEvent {
  kind: 'joined' | 'promoted' | 'demoted' | 'kicked' | 'mutated' | 'pruned' | 'replaced' | 'dropped';
  /** the design's poolKey and name */
  key: string;
  name: string;
  /** tier it was in (kicked / dropped / pruned / replaced: the tier it left) */
  tier: 'tested' | 'candidate';
  /** human-readable reason / detail */
  detail?: string;
}
/** entries: the tested tier (proven designs, at most POOL_CAP); candidates: designs on trial (at most MAX_CANDIDATES),
 *  dealt into decks a slot or two at a time until they graduate or get kicked out. */
export interface AiPool { v: typeof POOL_VERSION; entries: PoolEntry[]; candidates: PoolEntry[]; matches: number }

/** most designs on trial at once (the oldest / weakest drop out first) */
export const MAX_CANDIDATES = 30;
/** verdicts remembered per design */
export const VERDICT_WINDOW = 6;

export function defaultPool(): AiPool {
  return { v: POOL_VERSION, entries: AI_POOL.map((d) => ({ design: cleanDesign(d), score: POOL_PRIOR[d.id] ?? 1, games: 0 })), candidates: [], matches: 0 };
}

function cleanDesign(d: Design): Design {
  return { id: String(d.id).slice(0, 40), name: String(d.name).slice(0, 24), chassis: d.chassis, mobility: d.mobility, mounts: [...d.mounts] };
}

export function validEntryDesign(d: unknown): d is Design {
  if (!d || typeof d !== 'object') return false;
  const x = d as Design;
  if (typeof x.id !== 'string' || typeof x.name !== 'string' || typeof x.chassis !== 'string' || typeof x.mobility !== 'string' || !Array.isArray(x.mounts)) return false;
  if (!x.mounts.every((m) => m === null || typeof m === 'string')) return false;
  try { return isValidDesign(x); } catch { return false; }
}

function cleanEntry(e: unknown, keys: Set<string>, slots: Set<string>): PoolEntry | null {
  if (!e || typeof e !== 'object') return null;
  const x0 = e as Partial<PoolEntry>;
  // stored before the weapon cap (rules 7): the weakest extra weapons leave instead of the whole entry being dropped
  let design: unknown = x0.design;
  if (design && typeof design === 'object' && Array.isArray((design as Design).mounts)) {
    const capped = { ...(design as Design), mounts: [...(design as Design).mounts] };
    if (replaceRetiredModules(capped).length + dropExtraWeapons(capped).length) design = capped;
  }
  const x: Partial<PoolEntry> = { ...x0, design: design as Design };
  if (!validEntryDesign(x.design)) return null;
  const d = cleanDesign(x.design);
  if (keys.has(poolKey(d)) || slots.has(slotKey(d))) return null;
  keys.add(poolKey(d)); slots.add(slotKey(d));
  const pe: PoolEntry = {
    design: d,
    score: typeof x.score === 'number' && Number.isFinite(x.score) ? Math.max(0, Math.min(5, x.score)) : 1,
    games: typeof x.games === 'number' && Number.isInteger(x.games) && x.games >= 0 ? x.games : 0,
  };
  if (x.learned) pe.learned = true;
  if (x.mutant) pe.mutant = true;
  if (Array.isArray(x.rec)) {
    const rec = x.rec.filter((v): v is Verdict => !!v && typeof v === 'object' && typeof v.m === 'string' && v.m.length <= 80 && typeof v.good === 'boolean').map((v) => ({ m: v.m, good: v.good })).slice(-VERDICT_WINDOW);
    if (rec.length) pe.rec = rec;
  }
  if (typeof x.addedAt === 'number' && Number.isFinite(x.addedAt)) pe.addedAt = x.addedAt;
  if (typeof x.promotedAt === 'number' && Number.isFinite(x.promotedAt)) pe.promotedAt = x.promotedAt;
  if (x.origin === 'adopted' || x.origin === 'mutant' || x.origin === 'curated') pe.origin = x.origin;
  else if (x.mutant) pe.origin = 'mutant';
  else if (x.learned) pe.origin = 'adopted';
  if (typeof x.creator === 'string') pe.creator = x.creator.slice(0, 24);
  if (typeof x.parent === 'string') pe.parent = x.parent.slice(0, 40);
  return pe;
}

/** One stored entry, validated (null when invalid). */
export const sanitizeEntry = (raw: unknown): PoolEntry | null => cleanEntry(raw, new Set(), new Set());

/** A stored pool, validated: unknown / corrupt data, an unknown version, invalid designs or a tested tier that no longer
 *  covers every deck tag fall back to the curated default; a v2 pool migrates (its entries become the tested tier).
 *  Invalid entries are dropped; duplicates (in or across the tiers) merged away. */
export function sanitizePool(raw: unknown): AiPool {
  if (!raw || typeof raw !== 'object') return defaultPool();
  const r = raw as { v?: unknown; entries?: unknown; candidates?: unknown; matches?: unknown };
  if ((r.v !== POOL_VERSION && r.v !== 2) || !Array.isArray(r.entries)) return defaultPool();
  const keys = new Set<string>(), slots = new Set<string>();
  const entries: PoolEntry[] = [];
  for (const e of r.entries.slice(0, POOL_CAP * 2)) { const c = cleanEntry(e, keys, slots); if (c) entries.push(c); }
  const candidates: PoolEntry[] = [];
  if (r.v === POOL_VERSION && Array.isArray(r.candidates)) {
    for (const e of r.candidates.slice(0, MAX_CANDIDATES * 2)) { const c = cleanEntry(e, keys, slots); if (c) candidates.push(c); }
  }
  const matches = typeof r.matches === 'number' && Number.isInteger(r.matches) && r.matches >= 0 ? r.matches : 0;
  const pool: AiPool = { v: POOL_VERSION, entries: entries.slice(0, POOL_CAP), candidates: candidates.slice(0, MAX_CANDIDATES), matches };
  if (!DECK_TAGS.every((t) => pool.entries.some((e) => designTags(e.design).has(t))) || pool.entries.length < DECK_SIZE) return defaultPool();
  return pool;
}

// ---------------------------------------------------------------------------------------------
// Deck draw

/** Candidate slots per deck: one, sometimes two (when the candidate tier has designs). */
export const CANDIDATE_SLOTS = [1, 2] as const;

/** Draw `size` distinct designs from the pool (seeded): one tested design per DECK_TAGS tag first (coverage), then
 *  1-2 candidates on trial (so they get played and measured), then tested designs by weight. Weights favour
 *  higher-scoring entries (score^sharp), spread the deck over roles and allow at most one giant. `bias` (optional)
 *  multiplies an entry's weight. `chaffClear`: also guarantee one chaff-clear design (smartdeploy.ts 'riot') when the
 *  pool has one. */
export function drawDeck(pool: AiPool, seed: number, size = DECK_SIZE, sharp = 2, bias?: (d: Design) => number, chaffClear = false): Design[] {
  const rng = makeRng(mixSeed(seed >>> 0, 0x9001));
  const tested = pool.entries.filter((e) => validEntryDesign(e.design));
  const trial = (pool.candidates ?? []).filter((e) => validEntryDesign(e.design));
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
    const e = weighted(rng, tested.filter((x) => ok(x) && designTags(x.design).has(t)), weight);
    if (e) take(e);
  }
  // a chaff-clear (riot) design, when the pool has one: the army keeps ~15-25% of its value in it (ai.ts)
  if (chaffClear && deck.length < size && !deck.some((e) => deployRole(e.design) === 'riot')) {
    const e = weighted(rng, tested.filter((x) => ok(x) && deployRole(x.design) === 'riot'), weight);
    if (e) take(e);
  }
  const trialSlots = trial.length ? CANDIDATE_SLOTS[Math.floor(rng() * CANDIDATE_SLOTS.length)] : 0;
  for (let k = 0; k < trialSlots && deck.length < size; k++) {
    // candidates are drawn evenly (their scores are unproven), least-played first
    const e = weighted(rng, trial.filter(ok), (x) => 1 / (1 + x.games));
    if (e) take(e);
  }
  while (deck.length < size) {
    const e = weighted(rng, tested.filter(ok), weight);
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
  return simRound(m, rec).tally;
}

/** scoreRound plus the battle's summary (the server checks it against the reported result). */
export function simRound(m: MatchState, rec: RoundRecord): { tally: RoundTally; summary: BattleSummary } {
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
  return { tally: out, summary: b.summary() };
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
// Evolution (building blocks shared by the local evolvePool and the server's global pool, src/server/aipool.ts)

const NAMES_A = ['Copy', 'Mimic', 'Echo', 'Ghost', 'Stolen', 'Shadow', 'Mirror', 'Rival', 'Twin', 'Phantom', 'Proxy', 'Clone'];
const NAMES_B = ['hound', 'fang', 'wasp', 'ram', 'mantis', 'beetle', 'hawk', 'golem', 'viper', 'lance', 'maul', 'kite', 'warden', 'spike'];
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** An adopted design keeps the player's parts but gets an AI id and name. */
export function adoptDesign(d: Design): Design {
  const h = hash(poolKey(d));
  return { id: `lrn-${h.toString(36)}`, name: `${NAMES_A[h % NAMES_A.length]}${NAMES_B[(h >>> 8) % NAMES_B.length]}`, chassis: d.chassis, mobility: d.mobility, mounts: [...d.mounts] };
}

export const median = (xs: number[]) => {
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

/** Blend one match's effectiveness into an entry's running score. */
export function blendScore(e: PoolEntry, eff: number, alpha = SCORE_ALPHA): void {
  e.score = e.score * (1 - alpha) + alpha * Math.max(0, Math.min(5, eff));
  e.games++;
}
export const findByKey = (entries: PoolEntry[], d: Design) => entries.find((e) => poolKey(e.design) === poolKey(d));
export const findBySlot = (entries: PoolEntry[], d: Design) => entries.find((e) => slotKey(e.design) === slotKey(d));

/** The AI side's fielded designs with their match performance (only those the pool knows). */
function aiFielded(m: MatchState, aiSide: Side, scores: DesignPerf[]): { d: Design; s: DesignPerf }[] {
  const deck = new Map(m.players[aiSide].deck.map((d) => [d.id, d] as const));
  return scores.filter((s) => s.side === aiSide && s.invested > 0 && deck.has(s.designId)).map((s) => ({ d: deck.get(s.designId)!, s }));
}

/** 1. Running scores of the AI's own designs (in place). */
export function updateAiScores(entries: PoolEntry[], m: MatchState, aiSide: Side, scores: DesignPerf[], alpha = SCORE_ALPHA): void {
  for (const { d, s } of aiFielded(m, aiSide, scores)) {
    const e = findByKey(entries, d) ?? findBySlot(entries, d);
    if (e) blendScore(e, s.eff, alpha);
  }
}

/** A player design that earned adoption in one match. */
export interface Candidate { design: Design; eff: number }

/** 2. The player's two best designs (with a real investment behind them) that earned adoption: the player won, or
 *  the design did ADOPT_RATIO x better than the AI's own designs of its role. Designs come back renamed (adoptDesign). */
export function playerCandidates(entries: PoolEntry[], m: MatchState, aiSide: Side, scores: DesignPerf[]): Candidate[] {
  const pSide: Side = aiSide === 0 ? 1 : 0;
  const pDeck = new Map(m.players[pSide].deck.map((d) => [d.id, d] as const));
  const ai = aiFielded(m, aiSide, scores);
  const pPerf = scores.filter((s) => s.side === pSide && pDeck.has(s.designId));
  const pTotal = pPerf.reduce((t, s) => t + s.invested, 0);
  const won = m.status === 'done' && m.winner === pSide;
  const best = pPerf.filter((s) => s.invested >= Math.max(1, 0.05 * pTotal)).sort((a, b) => b.eff - a.eff || (a.designId < b.designId ? -1 : 1)).slice(0, 2);
  const out: Candidate[] = [];
  for (const s of best) {
    const src = pDeck.get(s.designId)!;
    if (!validEntryDesign(src)) continue;
    const d = adoptDesign(src);
    if (!isValidDesign(d)) continue;
    const role = roleOf(d);
    const rivals = ai.filter((a) => roleOf(a.d) === role);
    const rivalEff = rivals.length
      ? rivals.reduce((t, a) => t + a.s.eff * a.s.invested, 0) / rivals.reduce((t, a) => t + a.s.invested, 0)
      : median(entries.filter((e) => roleOf(e.design) === role).map((e) => e.score));
    if (won || s.eff >= ADOPT_RATIO * rivalEff) out.push({ design: d, eff: s.eff });
  }
  return out;
}

/** 3. Put a design into the pool (in place): merge into an identical entry; keep the better of a near-duplicate pair;
 *  else grow (role ceiling and POOL_CAP permitting) or replace the weakest entry that may go and scores below it.
 *  Returns what happened. */
export function insertEntry(entries: PoolEntry[], fresh: PoolEntry, eff = fresh.score, removed?: PoolEntry[]): 'merged' | 'slot' | 'added' | 'replaced' | 'rejected' {
  const d = fresh.design;
  const same = findByKey(entries, d);
  if (same) { blendScore(same, eff); return 'merged'; }
  const near = findBySlot(entries, d);
  if (near) {
    if (eff > near.score) { near.design = d; if (fresh.learned) near.learned = true; if (fresh.mutant) near.mutant = true; else delete near.mutant; }
    blendScore(near, eff);
    return 'slot';
  }
  const role = roleOf(d);
  const roleN = entries.filter((e) => roleOf(e.design) === role).length;
  if (roleN < ROLE_MAX[role] && entries.length < POOL_CAP) { entries.push(fresh); return 'added'; }
  const victims = entries
    .filter((e) => (roleN >= ROLE_MAX[role] ? roleOf(e.design) === role : true) && e.score < fresh.score && removable(entries, e, d))
    .sort((a, b) => a.score - b.score || (poolKey(a.design) < poolKey(b.design) ? -1 : 1));
  if (!victims.length) return 'rejected';
  removed?.push(victims[0]);
  entries[entries.indexOf(victims[0])] = fresh;
  return 'replaced';
}

/** 4. Prune one entry that has clearly fallen behind its role (in place). Returns it, if any. */
export function pruneWeakest(entries: PoolEntry[]): PoolEntry | null {
  const medians = new Map(ROLES.map((r) => [r, median(entries.filter((e) => roleOf(e.design) === r).map((e) => e.score))] as const));
  const weak = entries
    .filter((e) => e.games >= PRUNE_GAMES && e.score < PRUNE_RATIO * medians.get(roleOf(e.design))! && removable(entries, e))
    .sort((a, b) => a.score / medians.get(roleOf(a.design))! - b.score / medians.get(roleOf(b.design))!);
  if (weak.length) { entries.splice(entries.indexOf(weak[0]), 1); return weak[0]; }
  return null;
}

// ---- mutation: the AI's clearly ineffective designs spawn slightly tweaked variants ----

/** At most this many mutants per match / report. */
export const MUTANTS_PER_MATCH = 1;
/** Unproven mutants (fewer than PRUNE_GAMES matches) the pool may hold at once. */
export const MAX_UNPROVEN_MUTANTS = 6;
/** Starting score of a mutant: modest, below an average design, so it has to prove itself. */
export const MUTANT_PRIOR = 0.85;
/** A fielded AI design is "clearly ineffective" below this share of its role's median effectiveness in the match
 *  (or of 1 when it is alone in its role), and below MUTATE_ABS overall. */
export const MUTATE_REL = 0.5;
export const MUTATE_ABS = 0.5;

const isWeapon = (m: ModuleDef) => m.kind === 'weapon';
/** Same family for a weapon swap: same mount class, same air / ground reach, melee stays melee. */
const sameFamily = (a: ModuleDef, b: ModuleDef) => a.mount === b.mount && !!a.targetsAir === !!b.targetsAir && (a.targetsGround !== false) === (b.targetsGround !== false) && (a.projectile === 'melee') === (b.projectile === 'melee');

/** One random, small, legal tweak of `d` keeping its role and coverage tags: a same-family weapon swap, a utility /
 *  armour swap, a different legal drive, or (rarely) a same-size chassis. Null if nothing legal was found. */
export function mutateDesign(d: Design, rng: Rng, id: string): Design | null {
  const role = roleOf(d);
  const tags = [...designTags(d)].filter((t) => DECK_TAGS.includes(t));
  const chassis = CHASSIS.find((c) => c.id === d.chassis);
  if (!chassis) return null;
  const flies = MOBILITY.find((x) => x.id === d.mobility)?.kind === 'air';
  for (let attempt = 0; attempt < 40; attempt++) {
    const r = rng();
    const out: Design = { id, name: d.name, chassis: d.chassis, mobility: d.mobility, mounts: [...d.mounts] };
    const c = CHASSIS.find((x) => x.id === out.chassis)!;
    if (r < 0.45) {
      const slots = out.mounts.map((m, i) => ({ m: MODULE_BY_ID.get(m ?? ''), i })).filter((x) => x.m && isWeapon(x.m));
      if (!slots.length) continue;
      const s = slots[Math.floor(rng() * slots.length)];
      const opts = MODULES.filter((m) => isWeapon(m) && !m.retired && m.id !== s.m!.id && sameFamily(m, s.m!) && !slotError(c, out.mobility, s.i, m));
      if (!opts.length) continue;
      out.mounts[s.i] = opts[Math.floor(rng() * opts.length)].id;
    } else if (r < 0.7) {
      const slots = out.mounts.map((m, i) => ({ m: m ? MODULE_BY_ID.get(m) : undefined, i })).filter((x) => !x.m || !isWeapon(x.m));
      if (!slots.length) continue;
      const s = slots[Math.floor(rng() * slots.length)];
      const opts = MODULES.filter((m) => !isWeapon(m) && !m.retired && m.id !== s.m?.id && !slotError(c, out.mobility, s.i, m));
      if (!opts.length) continue;
      out.mounts[s.i] = opts[Math.floor(rng() * opts.length)].id;
    } else if (r < 0.9) {
      const opts = MOBILITY.filter((mb) => mb.id !== out.mobility && (mb.kind === 'air') === flies && !pairingError(out.chassis, mb.id));
      if (!opts.length) continue;
      out.mobility = opts[Math.floor(rng() * opts.length)].id;
    } else {
      const opts = CHASSIS.filter((x) => x.id !== c.id && x.size === c.size && x.mounts.length >= 1 && !pairingError(x.id, out.mobility));
      if (!opts.length) continue;
      const nc = opts[Math.floor(rng() * opts.length)];
      out.chassis = nc.id;
      out.mounts = nc.mounts.map((_, i) => {
        const m = MODULE_BY_ID.get(d.mounts[i] ?? '');
        return m && !slotError(nc, out.mobility, i, m) ? m.id : null;
      });
    }
    if (poolKey(out) === poolKey(d)) continue;
    try {
      if (!isValidDesign(out) || profile(out).stats.load > 1.1) continue;
      if (roleOf(out) !== role || !tags.every((t) => designTags(out).has(t))) continue;
      if (profile(out).groundDps + profile(out).aaDps + profile(out).heal <= 0) continue;
    } catch { continue; }
    return out;
  }
  return null;
}

/** Both tiers' entries, for lookups and dedupe. */
const allEntries = (pool: AiPool) => [...pool.entries, ...pool.candidates];

/** 5. Mutate the AI's clearly ineffective fielded designs (in place): up to `max` new, deduped variants (across both
 *  tiers) enter the candidate tier with a modest prior, while it holds fewer than MAX_UNPROVEN_MUTANTS mutants.
 *  Seeded by `seed` (e.g. the match id), so a re-run gives the same mutants. Returns the mutants. */
export function mutateWeak(pool: AiPool, m: MatchState, aiSide: Side, scores: DesignPerf[], seed: number, max = MUTANTS_PER_MATCH, now = 0, events?: PoolEvent[]): Design[] {
  const all = allEntries(pool);
  const fielded = aiFielded(m, aiSide, scores);
  const byRole = new Map<Role, number[]>();
  for (const f of fielded) byRole.set(roleOf(f.d), [...(byRole.get(roleOf(f.d)) ?? []), f.s.eff]);
  const weak = fielded
    .filter((f) => {
      const peers = byRole.get(roleOf(f.d))!;
      const ref = peers.length > 1 ? median(peers) : 1;
      return f.s.eff < MUTATE_REL * ref && f.s.eff < MUTATE_ABS && findByKey(all, f.d) !== undefined;
    })
    .sort((a, b) => a.s.eff - b.s.eff || (a.d.id < b.d.id ? -1 : 1))
    .slice(0, 2);
  const rng = makeRng(mixSeed(seed >>> 0, 0x3a7));
  const made: Design[] = [];
  for (const w of weak) {
    if (made.length >= max) break;
    if (pool.candidates.filter((e) => e.mutant).length >= MAX_UNPROVEN_MUTANTS) break;
    const parent = findByKey(all, w.d)!.design;
    const mk = mutateDesign(parent, rng, 'tmp');
    if (!mk) continue;
    const h = hash(poolKey(mk));
    const child: Design = { ...mk, id: `mut-${h.toString(36)}`, name: `${parent.name.replace(/ Mk\d+$/, '').slice(0, 18)} Mk${2 + (h % 7)}` };
    if (findByKey(allEntries(pool), child) || findBySlot(allEntries(pool), child)) continue;
    const dropped = addCandidate(pool, { design: child, score: MUTANT_PRIOR, games: 0, mutant: true, origin: 'mutant', parent: parent.name, addedAt: now });
    if (dropped) events?.push(ev('dropped', dropped, 'candidate', 'candidate tier full'));
    if (dropped?.design === child) continue;
    events?.push(ev('mutated', { design: child } as PoolEntry, 'candidate', `mutant of ${parent.name}`));
    made.push(child);
  }
  return made;
}

/** Put a design on trial (in place). At MAX_CANDIDATES the weakest, then oldest, candidate drops out (returned). */
export function addCandidate(pool: AiPool, e: PoolEntry): PoolEntry | null {
  pool.candidates.push(e);
  if (pool.candidates.length <= MAX_CANDIDATES) return null;
  const out = [...pool.candidates].sort((a, b) => a.score - b.score || (a.addedAt ?? 0) - (b.addedAt ?? 0) || (poolKey(a.design) < poolKey(b.design) ? -1 : 1))[0];
  pool.candidates.splice(pool.candidates.indexOf(out), 1);
  return out;
}

/** A design's verdict in one AI match: clearly bad below BAD_REL x the median effectiveness of the AI's designs of
 *  its role in that match (1 when alone) and below BAD_ABS; good at or above GOOD_REL x that median and GOOD_ABS. */
export const BAD_REL = 0.5;
export const BAD_ABS = 0.6;
export const GOOD_REL = 1;
export const GOOD_ABS = 0.9;
/** a candidate graduates after this many good games (distinct matches) with more good than bad verdicts */
export const PROMOTE_GOOD = 2;
/** any design with this many bad games (distinct matches) among its last VERDICT_WINDOW, and no more good than bad
 *  ones there, is kicked out (a tested design that a role floor protects is demoted in score instead) */
export const KICK_BAD = 2;
/** score multiplier for a protected design that earned a kick */
export const DEMOTE = 0.5;

function addVerdict(e: PoolEntry, matchId: string, good: boolean): void {
  const rec = (e.rec ??= []);
  if (rec.some((v) => v.m === matchId)) return;
  rec.push({ m: matchId, good });
  if (rec.length > VERDICT_WINDOW) rec.splice(0, rec.length - VERDICT_WINDOW);
}
const count = (e: PoolEntry, good: boolean) => (e.rec ?? []).filter((v) => v.good === good).length;

const ev = (kind: PoolEvent['kind'], e: Pick<PoolEntry, 'design'>, tier: PoolEvent['tier'], detail?: string): PoolEvent =>
  ({ kind, key: poolKey(e.design), name: e.design.name, tier, ...(detail ? { detail } : {}) });

/** Per-match options of foldMatch. */
export interface FoldOpts {
  /** the match id (verdicts are per distinct match) */
  matchId: string;
  /** weight of this match in running scores */
  alpha?: number;
  /** may this report add another candidate (e.g. per-reporter daily cap)? Called before each addition. */
  mayAddCandidate?: () => boolean;
  /** the clock for addedAt (server: Date.now(); tests: fixed) */
  now?: number;
  /** mutation seed (default: hash of the match id) */
  seed?: number;
  /** display name credited for adopted designs ('guest' when not signed in) */
  creator?: string;
}

/** What a match changed (for tests / logs). */
export interface FoldResult { candidates: Design[]; promoted: Design[]; kicked: Design[]; demoted: Design[]; mutants: Design[]; events: PoolEvent[] }

/** Fold one scored AI match into a pool (in place):
 *  1. every AI design fielded gets a score update and, if clear, a good / bad verdict for this match;
 *  2. candidates with PROMOTE_GOOD good games (and more good than bad) graduate to the tested tier (quotas permitting);
 *     any design with KICK_BAD bad games in its window (and no more good) is kicked (a tested design a floor protects
 *     is demoted instead);
 *  3. the player's best designs that did well (won, or ADOPT_RATIO x the AI's own of their role) go on trial in the
 *     candidate tier straight away (deduped across both tiers; mayAddCandidate gates each);
 *  4. the AI's clearly ineffective designs spawn a mutant candidate;
 *  5. the weakest tested design may be pruned. */
export function foldMatch(pool: AiPool, m: MatchState, aiSide: Side, scores: DesignPerf[], o: FoldOpts): FoldResult {
  const res: FoldResult = { candidates: [], promoted: [], kicked: [], demoted: [], mutants: [], events: [] };
  const E = res.events;
  const alpha = o.alpha ?? SCORE_ALPHA;
  const now = o.now ?? 0;
  // 1. verdicts
  const fielded = aiFielded(m, aiSide, scores);
  const byRole = new Map<Role, number[]>();
  for (const f of fielded) byRole.set(roleOf(f.d), [...(byRole.get(roleOf(f.d)) ?? []), f.s.eff]);
  const touched = new Set<PoolEntry>();
  for (const f of fielded) {
    const e = findByKey(allEntries(pool), f.d) ?? findBySlot(allEntries(pool), f.d);
    if (!e || touched.has(e)) continue;
    touched.add(e);
    blendScore(e, f.s.eff, alpha);
    const peers = byRole.get(roleOf(f.d))!;
    const ref = peers.length > 1 ? median(peers) : 1;
    if (f.s.eff < BAD_REL * ref && f.s.eff < BAD_ABS) addVerdict(e, o.matchId, false);
    else if (f.s.eff >= GOOD_REL * ref && f.s.eff >= GOOD_ABS) addVerdict(e, o.matchId, true);
  }
  // 2. promotion and kicks
  for (const e of [...touched]) {
    const good = count(e, true), bad = count(e, false);
    const isCand = pool.candidates.includes(e);
    if (bad >= KICK_BAD && good <= bad) {
      const why = `${bad} bad games of its last ${(e.rec ?? []).length}`;
      if (isCand) { pool.candidates.splice(pool.candidates.indexOf(e), 1); res.kicked.push(e.design); E.push(ev('kicked', e, 'candidate', why)); }
      else if (removable(pool.entries, e)) { pool.entries.splice(pool.entries.indexOf(e), 1); res.kicked.push(e.design); E.push(ev('kicked', e, 'tested', why)); }
      else { e.score *= DEMOTE; e.rec = []; res.demoted.push(e.design); E.push(ev('demoted', e, 'tested', `${why}; kept for role coverage, score halved`)); }
      continue;
    }
    if (isCand && good >= PROMOTE_GOOD && good > bad) {
      const removed: PoolEntry[] = [];
      const r = insertEntry(pool.entries, { ...e, promotedAt: now }, e.score, removed);
      if (r === 'added' || r === 'replaced' || r === 'slot' || r === 'merged') {
        pool.candidates.splice(pool.candidates.indexOf(e), 1);
        res.promoted.push(e.design);
        E.push(ev('promoted', e, 'candidate', `${good} good games`));
        for (const x of removed) E.push(ev('replaced', x, 'tested', `made room for ${e.design.name}`));
      }
    }
  }
  // 3. the player's designs that did well go on trial
  for (const c of playerCandidates(allEntries(pool), m, aiSide, scores)) {
    const known = findByKey(allEntries(pool), c.design) ?? findBySlot(allEntries(pool), c.design);
    if (known) { blendScore(known, c.eff, alpha); continue; }
    if (o.mayAddCandidate && !o.mayAddCandidate()) continue;
    const fresh: PoolEntry = { design: c.design, score: Math.max(0.5, Math.min(3, c.eff)), games: 0, learned: true, origin: 'adopted', creator: o.creator ?? 'guest', addedAt: now };
    const dropped = addCandidate(pool, fresh);
    if (dropped) E.push(ev('dropped', dropped, 'candidate', 'candidate tier full'));
    if (dropped !== fresh) { res.candidates.push(c.design); E.push(ev('joined', fresh, 'candidate', `adopted from ${fresh.creator}`)); }
  }
  // 4. mutants of the clearly ineffective; 5. prune
  res.mutants = mutateWeak(pool, m, aiSide, scores, o.seed ?? hash(o.matchId), MUTANTS_PER_MATCH, now, E);
  const pruned = pruneWeakest(pool.entries);
  if (pruned) { res.kicked.push(pruned.design); E.push(ev('pruned', pruned, 'tested', `score ${pruned.score.toFixed(2)} fell well below its role`)); }
  pool.matches++;
  return res;
}

/** Fold a match into a pool locally (tools / tests; the game reports matches to the server's global pool, which
 *  runs foldMatch after re-simulating them). Pure: returns a new pool. `aiSide` = the AI's side (localdriver: 1);
 *  `perf` = scoreMatch(m) when already computed. */
export function evolvePool(pool: AiPool, m: MatchState, aiSide: Side = 1, perf?: DesignPerf[]): AiPool {
  const out = structuredClone(sanitizePool(pool));
  if (!m || !Array.isArray(m.history) || !m.history.length || !m.players?.[0] || !m.players?.[1]) { out.matches++; return out; }
  let scores: DesignPerf[];
  try { scores = perf ?? scoreMatch(m); } catch { out.matches++; return out; }
  foldMatch(out, m, aiSide, scores, { matchId: String(m.id) });
  return out;
}

/** Roles present in a pool (for tests / tooling). */
export function roleCounts(pool: Pick<AiPool, 'entries'>): Record<Role, number> {
  const c = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
  for (const e of pool.entries) c[roleOf(e.design)]++;
  return c;
}
export { classify };

// ---------------------------------------------------------------------------------------------
// Learning from multiplayer games (the AI plays in neither): the server scores every finished PvP game (classic: its
// own resolved rounds; tug of war: a replay of the order log, tugReplay in tug.ts) and puts the two best designs of the
// game on trial in the candidate tier. They graduate or get kicked like any candidate, by how they do in AI matches.

/** a multiplayer design only counts as "best" when it beat the game's average supply efficiency by this much */
export const PVP_MIN_EFF = 1.1;
/** designs taken from one multiplayer game */
export const PVP_PICKS = 2;

/** A design from a multiplayer game that earned a trial (renamed like any adopted design), with who built it. */
export interface PvpCandidate extends Candidate { creator: string; side: Side }

/** The PVP_PICKS best designs of a finished multiplayer game (both sides), each with a real share of its side's
 *  spending behind it and at least PVP_MIN_EFF x the game's average efficiency. `decks` / `names` per side. */
export function pvpCandidates(scores: DesignPerf[], decks: [Design[], Design[]], names: [string, string]): PvpCandidate[] {
  const byId = [new Map(decks[0].map((d) => [d.id, d] as const)), new Map(decks[1].map((d) => [d.id, d] as const))];
  const total = [0, 1].map((s) => scores.filter((p) => p.side === s).reduce((t, p) => t + p.invested, 0));
  const ranked = scores
    .filter((p) => byId[p.side].has(p.designId) && p.invested >= Math.max(1, 0.05 * total[p.side]) && p.eff >= PVP_MIN_EFF)
    .sort((a, b) => b.eff - a.eff || (a.designId < b.designId ? -1 : 1));
  const out: PvpCandidate[] = [];
  const keys = new Set<string>();
  for (const p of ranked) {
    if (out.length >= PVP_PICKS) break;
    const src = byId[p.side].get(p.designId)!;
    if (!validEntryDesign(src)) continue;
    const d = adoptDesign(src);
    if (!isValidDesign(d) || keys.has(poolKey(d))) continue;
    keys.add(poolKey(d));
    out.push({ design: d, eff: p.eff, creator: names[p.side], side: p.side });
  }
  return out;
}

/** Fold a multiplayer game's best designs into a pool (in place): known designs (same parts, or a near-duplicate)
 *  only update their running score; new ones go on trial in the candidate tier. `game` names the source in the log. */
export function foldPvp(pool: AiPool, cands: PvpCandidate[], o: { now?: number; alpha?: number; game: string }): PoolEvent[] {
  const E: PoolEvent[] = [];
  for (const c of cands) {
    const known = findByKey(allEntries(pool), c.design) ?? findBySlot(allEntries(pool), c.design);
    if (known) { blendScore(known, c.eff, o.alpha ?? SCORE_ALPHA); continue; }
    const fresh: PoolEntry = { design: c.design, score: Math.max(0.5, Math.min(3, c.eff)), games: 0, learned: true, origin: 'adopted', creator: c.creator.slice(0, 24), addedAt: o.now ?? 0 };
    const dropped = addCandidate(pool, fresh);
    if (dropped) E.push(ev('dropped', dropped, 'candidate', 'candidate tier full'));
    if (dropped !== fresh) E.push(ev('joined', fresh, 'candidate', `best of a ${o.game} game, by ${fresh.creator}`));
  }
  return E;
}
