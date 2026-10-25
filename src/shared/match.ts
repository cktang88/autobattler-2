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

import { ARMOR_PRICE, GIANT_JET_CAL, SIZE_K, SMALL_AIR_CAL, analyticStats, clearPriceCache, computeStats, dropExtraWeapons, replaceRetiredModules, levelMult, MAX_LEVEL, MOBILITY_CAL, MODULE_CAL, roundPrice, statsWithSquad, validateDesign } from './stats.ts';
import type { BlockShape } from './grid.ts';
import { DEPLOY_D, DEPLOY_W, MAX_SPACING, blockInZone, blocksOverlap, hasSpacing, normSpacing, squadLayout } from './grid.ts';
import { mixSeed } from './rng.ts';
import { MOBILITY, MOBILITY_BY_ID, MODULE_BY_ID, pairingError } from './parts.ts';
import { runBattle } from './sim/battle.ts';
import type { BattleInput } from './sim/types.ts';
import { STANCES, START_DELAYS, TARGET_PRIORITIES } from './types.ts';
import type { Size, DeployAction, Design, MatchMode, MatchState, MobilityDef, Placement, PlayerState, RoundRecord, Side } from './types.ts';

export const DECK_SIZE = 9;
export const START_HP = 100;
/** Supply granted in round 1 and added each further round. Unspent supply carries over. */
export const START_SUPPLY = 600;
/** After this round resolves the match ends regardless; higher hp wins. */
export const MAX_ROUNDS = 15;
/** Hard cap on blocks (placements) per side (60: cheap designs come in squads, so a block is ~1 purchase of 70-200). */
export const MAX_UNITS = 60;
export const MAX_BLOCKS = MAX_UNITS;
/** Hard cap on simulated units per side, counting every unit of every squad (bounds simulation cost). */
export const MAX_SIM_UNITS = 240;
export const MAX_PLAYER_NAME = 24;

/** Rules / price-scale version stamped on every new match (MatchState.rules).
 *  2: prices are raw cost / PRICE_DIV (5) -- supply 600 + 120 per round instead of 3000 + 600.
 *  3: light squads are 16, 8 or 4 units by per-unit price (stats.ts squadFor) instead of always 16.
 *  4: medium (size-2) designs come 4, 2 or 1 to a block by per-unit price, likewise; 60 blocks per side instead of 40.
 *  5: the Anchor Mount is retired (decks repaired, retireParts) and prices are monotone (adding a part never makes a
 *     design cheaper; stats.ts). Squad sizes come from the analytic price, so repricing never reshapes a block.
 *  6: drives got distinct identities (speed, turning, reverse, pivot / omni / hover; parts.ts) and the drive price
 *     factors were refitted: the analytic price moved, so some designs' squads (block shapes) changed.
 *  7: the weapon pass: weapon numbers and their price calibrations (MODULE_CAL) changed, and the price model learned
 *     shell flight time, splash falloff, minimum-range share and turret traverse; some designs' squads changed. Hulls
 *     carry at most 2 weapons (giants 3, titans 4): decks over the cap drop their weakest extra weapons. */
export const RULES_VERSION = 7;
/** First rules version on the / 5 price scale. */
const RESCALED_RULES = 2;
/** Units per light block before rules 3. */
const LEGACY_SQUAD = 16;
/** First rules version with medium squads. */
const MEDIUM_SQUAD_RULES = 4;
/** First rules version with team-value prices. */
const TEAM_VALUE_RULES = 5;
/** First rules version with the reworked drives (new analytic prices, so possibly new squad sizes). */
const DRIVES_RULES = 6;
/** First rules version after the weapon pass (new weapon numbers and prices, so possibly new squad sizes). */
const WEAPONS_RULES = 7;
/** When the price / 5 rescale shipped (commit 4a9c201). An unmarked match created before it ran on 5x supply. */
export const PRICE_RESCALE_AT = Date.UTC(2026, 9, 14, 2, 48, 53);
const OLD_PRICE_DIV = 5;

const ROUND_SUPPLY_BASE = START_SUPPLY;
const ROUND_SUPPLY_GROWTH = 120;

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
  return roundPrice(designCost(design) * (0.4 + 0.1 * level));
}

/** Total supply invested in a placement (design + upgrades up to its level). */
export function placementValue(design: Design, level: number): number {
  let v = designCost(design);
  for (let l = 1; l < level; l++) v += upgradeCost(design, l);
  return v;
}

/** Share of a unit's total investment (purchase + upgrades) refunded when it is sold after fighting. */
export const SELL_REFUND = 0.75;
/** Supply returned for selling a placement at `level`. */
export function sellValue(design: Design, level: number): number {
  return roundPrice(placementValue(design, level) * SELL_REFUND);
}

/** Base damage the loser of `round` takes, before surviving-unit damage. */
export function baseDamage(round: number): number {
  return 2 + round;
}

/** Survivor divisor: block value (supply) per point of damage. */
const SURVIVOR_DIV = 90; // prices are raw / PRICE_DIV (5)

/** Damage contributed by one surviving enemy block; `fraction` = share of its squad still alive (0..1]. */
export function survivorDamage(design: Design, level: number, fraction = 1): number {
  return (designCost(design) * levelMult(level) * fraction) / SURVIVOR_DIV;
}

/** Was this saved match created under the old 5x price scale? Only unmarked saves can be: those created before the
 *  rescale shipped, or holding more supply than the current rules ever grant (an older client or server made it). */
export function isPreRescaleMatch(m: MatchState): boolean {
  if (m.rules !== undefined) return m.rules < RESCALED_RULES;
  if (m.createdAt > 0 && m.createdAt < PRICE_RESCALE_AT) return true;
  const granted = totalSupplyThrough(m.round);
  return m.players.some((p) => p.supply > granted);
}

/** Bring a saved match up to RULES_VERSION in place; returns true when it changed (the caller should persist it).
 *  - Pre-rescale matches had every supply amount at 5x: unspent supply is divided by 5, so it buys what it bought
 *    before (boards, levels, hp and history need no change; their prices are computed from the designs).
 *  - Before rules 3 every light block was 16 units. A board block of a design that is now an 8- or 4-unit squad is
 *    split into 2 or 4 blocks of the new size covering exactly the old unit positions (same level, orders, spacing,
 *    rotation; the first keeps the uid), so the army is unchanged; any supply the old block cost beyond its pieces
 *    is refunded.
 *  - Before rules 4 every medium block was 1 unit. One unit can't be split into a squad, so a board block of a design
 *    that is now a 2- or 4-unit squad is sold back at the full supply it cost (price + upgrades, single-unit prices)
 *    and leaves the board (escorts of it are dropped); the player rebuys it as squads.
 *  - Before rules 5 prices had no monotone floor. Matches in progress simply take the new prices (no refunds for
 *    the price change, nothing frozen). Squad sizes still come from the analytic price, so repricing reshapes no
 *    block; a block whose shape did change anyway (a deck design moved off a retired drive, retireParts, or a squad
 *    that differs from its analytic one) is re-checked by relegalizeBoard: kept if still legal, else moved to the
 *    nearest free legal spot, else (fits nowhere, or would break MAX_BLOCKS / MAX_SIM_UNITS) sold back at its full
 *    current value (price + upgrades) and dropped from the board (escorts of it are cleared).
 *  - Rules 6 reworked the drives and refitted their price factors: prices simply update. Blocks of designs whose squad
 *    changed with the analytic price (drivesReshaped: squad under the rules-5 drive table vs now) are re-checked by
 *    relegalizeBoard (kept where they are if they still fit, else moved to the nearest free spot, else sold back at
 *    their full value); every other block stays exactly as it was.
 *  - Rules 7 (the weapon pass) changed weapon numbers and prices, and added the weapon cap: deck designs over the cap
 *    drop their weakest extra weapons (capDeckWeapons), and those plus the designs whose squad moved
 *    (weaponsReshaped: squad under the rules-6 weapon numbers and calibrations vs now) get the same re-check.
 *  Past rounds' records are left as they were. */
export function migrateMatch(m: MatchState): boolean {
  if (m.rules !== undefined && m.rules >= RULES_VERSION) return false;
  const from = m.rules ?? 0;
  if (isPreRescaleMatch(m)) for (const p of m.players) p.supply = Math.floor(p.supply / OLD_PRICE_DIV);
  if (m.status !== 'done') for (const p of m.players) {
    if (from < 3) splitLegacySquads(p);
    if (from < MEDIUM_SQUAD_RULES) refundMediumSingles(p);
    if (from < TEAM_VALUE_RULES) relegalizeBoard(p, retireParts(p));
    if (from < DRIVES_RULES) relegalizeBoard(p, drivesReshaped(p));
    if (from < WEAPONS_RULES) {
      // the weapon cap: deck designs over their hull's cap lose their weakest extra weapons (their blocks are re-checked,
      // their shape may have changed); then every block whose squad the weapon pass moved
      const capped = capDeckWeapons(p);
      relegalizeBoard(p, new Set([...capped, ...weaponsReshaped(p)]));
    }
  }
  m.rules = RULES_VERSION;
  return true;
}

/** Supply a block cost under rules where the design came `squad` to a block (price + upgrades up to `level`). */
function legacyPlacementValue(d: Design, level: number, squad = LEGACY_SQUAD): number {
  const c = statsWithSquad(d, squad).cost;
  let v = c;
  for (let l = 1; l < level; l++) v += roundPrice(c * (0.4 + 0.1 * l));
  return v;
}

function splitLegacySquads(p: PlayerState): void {
  const designs = new Map(p.deck.map((d) => [d.id, d] as const));
  const out: Placement[] = [];
  let refund = 0;
  for (let i = 0; i < p.board.length; i++) {
    const u = p.board[i];
    const d = designs.get(u.designId);
    const shape = shapeOf(d);
    if (!d || shape.size !== 1 || shape.squad === LEGACY_SQUAD) { out.push(u); continue; }
    const [oc, or] = squadLayout(LEGACY_SQUAD), [nc, nr] = squadLayout(shape.squad);
    const pieces = LEGACY_SQUAD / shape.squad;
    // the old 8 x 2 block cut along its long axis into pieces of the new cols x 2 layout
    const splits = or === nr && oc % nc === 0 && oc / nc === pieces && out.length + (p.board.length - i) + pieces - 1 <= MAX_BLOCKS;
    const value = placementValue(d, u.level);
    refund += Math.max(0, legacyPlacementValue(d, u.level) - (splits ? pieces : 1) * value);
    if (!splits) { out.push(u); continue; }
    const sp = normSpacing(shape, u.spacing);
    const step = nc * ((u.rot ? (shape.fh ?? 1) : (shape.fw ?? 1)) + sp);
    for (let k = 0; k < pieces; k++) {
      const piece: Placement = { ...u, uid: k === 0 ? u.uid : p.nextUid++ };
      if (u.rot) piece.y = u.y + k * step; else piece.x = u.x + k * step;
      out.push(piece);
    }
  }
  p.board = out;
  p.supply += refund;
}

function refundMediumSingles(p: PlayerState): void {
  const designs = new Map(p.deck.map((d) => [d.id, d] as const));
  const gone = new Set<number>();
  for (const u of p.board) {
    const d = designs.get(u.designId);
    const shape = shapeOf(d);
    if (!d || shape.size !== 2 || shape.squad === 1) continue;
    p.supply += legacyPlacementValue(d, u.level, 1);
    gone.add(u.uid);
  }
  if (!gone.size) return;
  p.board = p.board.filter((u) => !gone.has(u.uid));
  for (const u of p.board) if (u.escort !== undefined && gone.has(u.escort)) delete u.escort;
}

/** The ground drives as rules 5 priced them (before the drive rework): what drivesReshaped compares squads against. */
const RULES5_DRIVES: Record<string, { speed: number; turn: number; capacity: [number, number, number, number, number]; hp: number; armor: number; traits: MobilityDef['traits']; cal: number }> = {
  wheels: { speed: 3.2, turn: 4, capacity: [8, 24, 0, 0, 0], hp: 0, armor: 0, traits: [], cal: 0.96 },
  halftrack: { speed: 2.3, turn: 2.6, capacity: [9, 27, 52, 0, 0], hp: 30, armor: 1, traits: [], cal: 1.17 },
  treads: { speed: 1.6, turn: 1.8, capacity: [0, 32, 66, 125, 0], hp: 60, armor: 3, traits: ['crush'], cal: 1.14 },
  legs: { speed: 2.0, turn: 3.5, capacity: [9, 24, 0, 0, 0], hp: 20, armor: 0, traits: [], cal: 1.01 },
  spider: { speed: 1.6, turn: 3, capacity: [10, 29, 58, 110, 210], hp: 40, armor: 2, traits: ['stable'], cal: 1.12 },
  jumpjets: { speed: 2.0, turn: 3, capacity: [8, 21, 0, 0, 0], hp: 10, armor: 0, traits: ['leap'], cal: 0.93 },
  hover: { speed: 3.8, turn: 2.4, capacity: [7.5, 22, 0, 0, 0], hp: 0, armor: 0, traits: ['evasive'], cal: 0.98 },
  megatracks: { speed: 1.25, turn: 1.2, capacity: [0, 0, 0, 140, 245], hp: 120, armor: 5, traits: ['crush'], cal: 1.14 },
  titanlegs: { speed: 1.4, turn: 1.6, capacity: [0, 0, 62, 122, 220], hp: 80, armor: 3, traits: ['crush'], cal: 1.09 },
};

/** Rules 6 reworked the drives (parts.ts) and refitted their price factors: the analytic price, and with it the squad,
 *  of some designs moved. Returns the ids of the deck designs whose squad differs from their rules-5 one (their
 *  blocks get re-checked); every other block keeps its exact shape and place. */
export function drivesReshaped(p: PlayerState): Set<string> {
  const out = new Set<string>();
  for (const d of p.deck) {
    const old = d && RULES5_DRIVES[d.mobility], m = d && MOBILITY_BY_ID.get(d.mobility);
    if (!old || !m) continue;
    let was = 0, now = 0;
    const keep = { speed: m.speed, turn: m.turn, capacity: m.capacity, hp: m.hp, armor: m.armor, traits: m.traits, reverse: m.reverse, arc: m.arc }, cal = MOBILITY_CAL[m.id];
    try {
      now = analyticStats(d).squad;
      Object.assign(m, { speed: old.speed, turn: old.turn, capacity: old.capacity, hp: old.hp, armor: old.armor, traits: old.traits, reverse: undefined, arc: undefined });
      MOBILITY_CAL[m.id] = old.cal;
      was = analyticStats(d).squad;
    } catch { /* unpriceable: leave it */ } finally {
      Object.assign(m, keep);
      MOBILITY_CAL[m.id] = cal;
    }
    if (was && now && was !== now) out.add(d.id);
  }
  return out;
}

// WEAPONS_TABLE_START (generated from the rules-6 parts.ts / MODULE_CAL: the old value of every weapon field the weapon
// pass changed, null = the field was absent)
const RULES6_WEAPONS: Record<string, Record<string, unknown>> = {
  mg: { range: 6, projectileSpeed: 22, spread: 0.25 },
  twinmg: { damage: 6, slow: 0.05 },
  hmg: { cooldown: 0.22, range: 6.5, magazine: 25, reload: 2.5 },
  shotgun: { range: 3.5, falloff: 0.25, impulse: 0.12 },
  flechette: { range: 6, spread: 1 },
  ac20: { damage: 18, cooldown: 0.2, magazine: 10, reload: 2, splash: 0.2 },
  autocannon: { cooldown: 0.3, magazine: 6, reload: 2 },
  twin30: { reload: 4.5 },
  ac40: { damage: 55, cooldown: 0.5, range: 9, reload: 2.5, splash: 0.5, proximity: null },
  cannon75: { damage: 95, cooldown: 0.7, reload: 4, projectileSpeed: 20 },
  cannon: { range: 9 },
  twin120: { ap: 0.5 },
  lightrail: { airBonus: null, dmgKind: null },
  railgun: { damage: 320, cooldown: 5.5, range: 16, turretTurn: null, airBonus: null, dmgKind: null },
  gauss: { dmgKind: null },
  massdriver: { dmgKind: null },
  rocketL: { damage: 64, cooldown: 6, range: 9, splash: 0.7 },
  mlrs: { range: 22 },
  aamissile: { damage: 120, cooldown: 7, splash: 0.5, airBonus: 1.5 },
  sam: { range: 13 },
  swarm: { range: 12 },
  cruise: { range: 28 },
  mortar: { damage: 108, cooldown: 5.4, range: 20, minRange: 5, splash: 1.2, stun: null },
  howitzer: { damage: 144, cooldown: 9, range: 30, minRange: 8, projectileSpeed: 12, splash: 2, spread: 1.2, splashEdge: null, spinal: null },
  barrage: { damage: 48, cooldown: 5.95, range: 24, minRange: 6, projectileSpeed: 10, spread: 2, turretTurn: null },
  grenade: { damage: 45, cooldown: 2, range: 8, minRange: 2, projectileSpeed: 8, splash: 0.9, magazine: null, reload: null },
  firebomb: { fireField: { radius: 1.8, duration: 6, dps: 30 } },
  laser: { airBonus: 1.6 },
  twinlaser: { damage: 6 },
  flamer: { range: 3.5, burn: { dps: 10, duration: 6 } },
  napalm: { range: 4.5 },
  tesla: { range: 4.5 },
  sonic: { range: 4 },
  flak: { cooldown: 0.45, range: 10, reload: 2.5, splash: 1.3, proximity: null, turretTurn: null },
  heavyflak: { range: 14, splash: 1.8, proximity: null, turretTurn: null },
  ram: { damage: 130, stun: null },
  chainsaw: { ap: 1 },
  plasmablade: { ap: 1 },
  hammer: { stun: null },
  drill: { shred: null },
  skyfortress: { range: 18, proximity: null },
  // the utility remake (rules 7): the strongest utilities got a downside and lost weight
  shieldH: { weight: 6, cost: 60, tune: null },
  bulwarkshield: { weight: 12, cost: 90, tune: null },
  stealth: { weight: 2, cloakDamage: null },
  phantom: { weight: 4, tune: null },
  overclock: { weight: 2, overheat: null },
  plateH: { weight: 12, tune: null },
  mirror: { deflect: null },
};
const RULES6_CAL: Record<string, number> = {
  mg: 3, twinmg: 0.811, hmg: 1.67, minigun: 0.8, shotgun: 1, flechette: 7.48, ac20: 2.83, autocannon: 2.29,
  twin30: 1.99, ac40: 5.01, quad20: 0.66, cannon75: 1.49, cannon: 0.88, twin120: 1.05, gauss: 4.58, sniper: 16.11,
  lightrail: 12, railgun: 20, rocketL: 1.16, rockets: 1.67, incendiary: 0.35, mlrs: 6.73, atgm: 8.11,
  guidedrocket: 3.35, aamissile: 1.26, sam: 4.55, swarm: 3, cruise: 7.74, mortar: 10.84, howitzer: 22.16,
  barrage: 8.26, grenade: 2.46, firebomb: 2.27, laser: 2.3, twinlaser: 2.23, heatray: 1.32, plasmaorb: 0.868,
  leech: 1.16, prism: 5.18, voidlance: 1.49, entropy: 1, plasma: 3.4, flamer: 0.61, napalm: 0.12, tesla: 0.534,
  stungun: 0.705, empcannon: 0.53, slowbeam: 4.95, arclance: 2.95, disarm: 0.416, sonic: 0.38, gravity: 3.14,
  bombs: 8.69, heavybomb: 6.05, clusterbombs: 14, flak: 0.31, heavyflak: 1.19, buzzsaw: 0.27, shockprod: 0.52,
  ram: 0.86, chainsaw: 0.6, claw: 0.56, plasmablade: 0.69, hammer: 1.46, drill: 0.81, repair: 12.45, uplink: 0.34,
  shield: 0.81, shieldL: 1.32, shieldH: 1.05, pointdef: 4, smoke: 4, reactive: 0.78, mirror: 0.5, hardened: 0.1,
  nanite: 0.14, stealth: 0.44, phantom: 0.16, targeting: 4, turbo: 0.14, overclock: 0.21, selfdestruct: 7,
  siege240: 1.53, avenger: 3.1, missilebattery: 4.99, siegeplasma: 0.85, clusterhow: 3.48, skyfortress: 0.62,
  stormtower: 2.55, inferno: 0.4, grinder: 3.99, bulwarkshield: 1.48, massdriver: 0.75, doomsday: 4.66,
  annihilator: 2.22, tactnuke: 3.2, titanfist: 1.8, stormcore: 0.91,
};
/** the size-class price factors (stats.ts SIZE_K) before the rules-7 re-fit */
const RULES6_SIZEK = [0.85, 1.11, 1.19, 1.37, 1.34];
/** the giant / titan jet price factors (stats.ts GIANT_JET_CAL) before rules 7 */
const RULES6_GIANT_JET: Record<number, number> = { 4: 1.05, 5: 1.17 };
/** the small-airframe drive factors (stats.ts SMALL_AIR_CAL) before rules 7: none */
const RULES6_SMALL_AIR: Record<string, number[]> = { rotor: [1, 1], jet: [1, 1] };
// WEAPONS_TABLE_END

/** Rules 7 added the weapon cap (parts.ts weaponCap): deck designs over it drop their weakest extra weapons
 *  (stats.ts dropExtraWeapons), so the saved deck stays legal. Returns the ids of the designs changed. */
export function capDeckWeapons(p: PlayerState): Set<string> {
  const changed = new Set<string>();
  // (retired parts -- the Autoloader and the Gyro -- swap for their replacement first)
  for (const d of p.deck) if (d && Array.isArray(d.mounts) && replaceRetiredModules(d).length + dropExtraWeapons(d).length) changed.add(d.id);
  return changed;
}

/** Rules 7 (the weapon pass) changed weapon numbers and their price calibrations: some designs' analytic price, and
 *  with it their squad, moved. Returns the ids of the deck designs whose squad differs from their rules-6 one (their
 *  blocks get re-checked by relegalizeBoard); every other block keeps its exact shape and place. (The price model's
 *  new flight-time / falloff / traverse terms are not replayed: they move prices by a few percent at most; the convex
 *  armour term, SIZE_K, GIANT_JET_CAL and SMALL_AIR_CAL are.) */
export function weaponsReshaped(p: PlayerState): Set<string> {
  const out = new Set<string>();
  // (every deck design: the size-class factors and the convex armour term reach designs without a changed part)
  const touched = p.deck.filter((d) => d && Array.isArray(d.mounts));
  if (!touched.length) return out;
  const now = new Map<string, number>();
  for (const d of touched) { try { now.set(d.id, analyticStats(d).squad); } catch { /* unpriceable: leave it */ } }
  const saved: [Record<string, unknown>, Record<string, unknown>][] = [];
  const savedCal: Record<string, number | undefined> = {};
  const savedSize: number[] = [];
  let savedArmorK: number | undefined, savedJet: Record<number, number> | undefined, savedAir: Record<string, number[]> | undefined;
  try {
    for (const [id, old] of Object.entries(RULES6_WEAPONS)) {
      const m = MODULE_BY_ID.get(id) as unknown as Record<string, unknown> | undefined;
      if (!m) continue;
      const keep: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(old)) { keep[k] = m[k]; if (v === null) delete m[k]; else m[k] = v; }
      saved.push([m, keep]);
    }
    for (const [id, c] of Object.entries(RULES6_CAL)) { savedCal[id] = MODULE_CAL[id]; MODULE_CAL[id] = c; }
    savedSize.push(...SIZE_K);
    SIZE_K.splice(0, RULES6_SIZEK.length, ...RULES6_SIZEK);
    savedArmorK = ARMOR_PRICE.k;
    ARMOR_PRICE.k = 0; // rules 6 had no convex armour term
    savedJet = { ...GIANT_JET_CAL };
    Object.assign(GIANT_JET_CAL, RULES6_GIANT_JET);
    savedAir = { ...SMALL_AIR_CAL };
    Object.assign(SMALL_AIR_CAL, RULES6_SMALL_AIR);
    clearPriceCache();
    for (const d of touched) {
      try { const was = analyticStats(d).squad, n = now.get(d.id); if (n && was !== n) out.add(d.id); } catch { /* unpriceable */ }
    }
  } finally {
    for (const [m, keep] of saved) for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete m[k]; else m[k] = v; }
    for (const [id, c] of Object.entries(savedCal)) { if (c === undefined) delete MODULE_CAL[id]; else MODULE_CAL[id] = c; }
    if (savedSize.length) SIZE_K.splice(0, savedSize.length, ...savedSize);
    if (savedArmorK !== undefined) ARMOR_PRICE.k = savedArmorK;
    if (savedJet) Object.assign(GIANT_JET_CAL, savedJet);
    if (savedAir) Object.assign(SMALL_AIR_CAL, savedAir);
    clearPriceCache();
  }
  return out;
}

/** Rules 5 retired the Anchor Mount: deck designs on a retired drive move to the first legal current one (heaviest
 *  modules dropped while overloaded). Returns the ids of the designs changed (their blocks get re-checked). */
export function retireParts(p: PlayerState): Set<string> {
  const changed = new Set<string>();
  for (const d of p.deck) {
    if (!d || !MOBILITY_BY_ID.get(d.mobility)?.retired) continue;
    const mob = MOBILITY.find((m) => !m.retired && !pairingError(d.chassis, m.id));
    if (!mob) continue;
    d.mobility = mob.id;
    while (validateDesign(d).length) {
      let k = -1;
      d.mounts.forEach((id, i) => { if (id && (k < 0 || (MODULE_BY_ID.get(id)?.weight ?? 0) > (MODULE_BY_ID.get(d.mounts[k]!)?.weight ?? 0))) k = i; });
      if (k < 0 || d.mounts.filter(Boolean).length <= 1) break;
      d.mounts[k] = null;
    }
    changed.add(d.id);
  }
  return changed;
}

/** Make a board legal again under the current block shapes (see migrateMatch, rules 5 and 6). Blocks of designs whose
 *  squad size the repricing changed (or in `force`) are re-checked in board order against every other block: kept
 *  where they are if legal, else moved to the nearest free spot, else sold back. Every other block stays exactly as
 *  it was. */
export function relegalizeBoard(p: PlayerState, force: ReadonlySet<string> = new Set()): void {
  const designs = new Map(p.deck.map((d) => [d.id, d] as const));
  // only blocks whose squad the repricing changed (or whose design is forced) are touched; every other block stays
  // exactly as it was and is an obstacle for them, wherever it sits in the board order (a grown block must not land
  // on one placed after it)
  const changedOf = (u: Placement): boolean => {
    const d = designs.get(u.designId);
    if (!d) return false;
    try { return force.has(d.id) || analyticStats(d).squad !== shapeOf(d).squad; } catch { return false; /* unpriceable: leave it */ }
  };
  const changed = p.board.map(changedOf);
  const fps: { x: number; y: number; spacing?: number; rot?: boolean; shape: BlockShape }[] = [];
  let units = 0, blocks = 0;
  p.board.forEach((u, i) => {
    if (changed[i]) return;
    const shape = shapeOf(designs.get(u.designId));
    fps.push({ x: u.x, y: u.y, spacing: u.spacing, rot: u.rot, shape });
    units += shape.squad; blocks++;
  });
  const kept: Placement[] = [];
  const gone = new Set<number>();
  p.board.forEach((u, i) => {
    if (!changed[i]) { kept.push(u); return; }
    const d = designs.get(u.designId);
    const shape = shapeOf(d);
    if (!hasSpacing(shape)) { if (u.spacing) u.spacing = 0; if (u.rot) delete u.rot; }
    const fits = (x: number, y: number) => blockInZone(x, y, shape, u.spacing, !!u.rot) && !fps.some((f) => blocksOverlap({ x, y, spacing: u.spacing, rot: u.rot }, shape, f, f.shape));
    let spot: { x: number; y: number } | null = null;
    if (blocks < MAX_BLOCKS && units + shape.squad <= MAX_SIM_UNITS) {
      if (fits(u.x, u.y)) spot = { x: u.x, y: u.y };
      else {
        // nearest free spot (city-block distance, then row, then column: deterministic)
        let best = Infinity;
        for (let y = 0; y < DEPLOY_D; y++) for (let x = 0; x < DEPLOY_W; x++) {
          const dist = Math.abs(x - u.x) + Math.abs(y - u.y);
          if (dist < best && fits(x, y)) { best = dist; spot = { x, y }; }
        }
      }
    }
    if (!spot) {
      gone.add(u.uid);
      if (d) p.supply += placementValue(d, u.level);
      return;
    }
    u.x = spot.x; u.y = spot.y;
    kept.push(u);
    fps.push({ x: u.x, y: u.y, spacing: u.spacing, rot: u.rot, shape });
    units += shape.squad; blocks++;
  });
  p.board = kept;
  if (gone.size) for (const u of p.board) if (u.escort !== undefined && gone.has(u.escort)) delete u.escort;
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
    rules: RULES_VERSION,
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
  const designs = new Map(p.deck.map((d) => [d.id, d] as const));
  // sold units leave before anything new is placed: their room, unit count and refund are usable this turn
  const sold = new Set<number>();
  let refund = 0;
  if (a.sell !== undefined) {
    if (!Array.isArray(a.sell) || a.sell.length > MAX_BLOCKS) return 'Bad sell list';
    for (const uid of a.sell) {
      const u = isInt(uid) ? p.board.find((b) => b.uid === uid) : undefined;
      if (!u) return `Can't sell unknown unit ${String(uid)}`;
      if (sold.has(uid)) return `Unit ${uid} sold twice`;
      const d = designs.get(u.designId);
      if (!d) return 'Unit has unknown design';
      sold.add(uid);
      refund += sellValue(d, u.level);
    }
  }
  const board = p.board.filter((u) => !sold.has(u.uid));
  if (board.length + a.place.length > MAX_BLOCKS) return `Too many blocks (max ${MAX_BLOCKS})`;

  let cost = 0;
  const seenUids = new Set<number>(p.board.map((u) => u.uid)); // sold uids stay used
  // escort may reference any block still on the board or bought in this very action
  const knownUids = new Set<number>(board.map((u) => u.uid));
  for (const pl of a.place) if (pl && typeof pl === 'object' && isInt(pl.uid)) knownUids.add(pl.uid);
  const footprints: { x: number; y: number; spacing?: number; rot?: boolean; shape: BlockShape }[] = board.map((u) =>
    ({ x: u.x, y: u.y, spacing: u.spacing, rot: u.rot, shape: shapeOf(designs.get(u.designId)) }));
  let simUnits = board.reduce((n, u) => n + shapeOf(designs.get(u.designId)).squad, 0);

  for (const pl of a.place) {
    if (!pl || typeof pl !== 'object') return 'Bad placement';
    const d = designs.get(pl.designId);
    if (!d) return `Unknown design ${String(pl.designId)}`;
    if (!isInt(pl.uid) || pl.uid < p.nextUid) return `Bad unit id ${String(pl.uid)}`;
    if (seenUids.has(pl.uid)) return `Duplicate unit id ${pl.uid}`;
    seenUids.add(pl.uid);
    if (pl.level !== 1) return 'New units start at level 1';
    if (pl.round !== m.round) return 'Placement round mismatch';
    const shape = shapeOf(d);
    if (pl.spacing !== undefined) {
      if (!isInt(pl.spacing) || pl.spacing < 0 || pl.spacing > MAX_SPACING) return `Bad spacing for ${d.name}`;
      if (!hasSpacing(shape) && pl.spacing !== 0) return `${d.name} can't be spaced`;
    }
    if (pl.rot !== undefined && typeof pl.rot !== 'boolean') return `Bad rotation for ${d.name}`;
    if (pl.rot && !hasSpacing(shape)) return `${d.name} can't be rotated`;
    const be = behaviorError(behaviorOf(pl));
    if (be) return `${d.name}: ${be}`;
    if (pl.kiteMount !== undefined && !validKiteMount(d, pl.kiteMount, false)) return `${d.name}: Bad kite weapon`;
    if (pl.escort !== undefined && (!isInt(pl.escort) || pl.escort === pl.uid || !knownUids.has(pl.escort))) return `${d.name}: Bad escort target`;
    simUnits += shape.squad;
    if (simUnits > MAX_SIM_UNITS) return `Too many units (max ${MAX_SIM_UNITS})`;
    if (!isInt(pl.x) || !isInt(pl.y) || !blockInZone(pl.x, pl.y, shape, pl.spacing, !!pl.rot)) return `${d.name} is outside the deploy zone`;
    for (const f of footprints) if (blocksOverlap(pl, shape, f, f.shape)) return `${d.name} overlaps another unit`;
    footprints.push({ x: pl.x, y: pl.y, spacing: pl.spacing, rot: pl.rot, shape });
    cost += designCost(d);
  }

  if (a.configure !== undefined) {
    if (!Array.isArray(a.configure) || a.configure.length > 200) return 'Bad configure list';
    for (const c of a.configure) {
      if (!c || typeof c !== 'object' || !isInt(c.uid)) return 'Bad configure entry';
      if (!board.some((u) => u.uid === c.uid)) return `Can't configure unknown unit ${String(c.uid)}`;
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
    const u = board.find((b) => b.uid === uid);
    if (!u) return `Can't upgrade unknown unit ${String(uid)}`;
    const d = designs.get(u.designId);
    if (!d) return 'Unit has unknown design';
    const extra = pending.get(uid) ?? 0;
    const lvl = u.level + extra;
    if (lvl >= MAX_LEVEL) return `${d.name} is already max level`;
    cost += upgradeCost(d, lvl);
    pending.set(uid, extra + 1);
  }

  if (cost > p.supply + refund) return `Not enough supply (${cost} > ${p.supply + refund})`;
  return null;
}

/** Net supply an action spends for `side` (purchases + upgrades - sell refunds; assumes it is valid). */
export function actionCost(m: MatchState, side: Side, a: DeployAction): number {
  const p = m.players[side];
  const designs = new Map(p.deck.map((d) => [d.id, d] as const));
  let cost = 0;
  for (const uid of a.sell ?? []) { const u = p.board.find((b) => b.uid === uid); const d = u && designs.get(u.designId); if (u && d) cost -= sellValue(d, u.level); }
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
  if (a.sell?.length) {
    const sold = new Set(a.sell);
    p.board = p.board.filter((u) => !sold.has(u.uid));
    for (const u of p.board) if (u.escort !== undefined && sold.has(u.escort)) delete u.escort;
  }
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
    const shape = shapeOf(p.deck.find((d) => d.id === pl.designId));
    const b: Placement = { uid: pl.uid, designId: pl.designId, x: pl.x, y: pl.y, level: 1, round: m.round };
    if (hasSpacing(shape)) b.spacing = normSpacing(shape, pl.spacing);
    if (pl.rot && hasSpacing(shape)) b.rot = true;
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
  // the board as it fought last round: hides this round's purchases AND sells
  opp.board = (last ? last.boards[oppSide] : [])
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

/** A design's block shape (size, squad, footprint) from its stats; an unknown or unpriceable design is one 1x1 unit. */
export function shapeOf(d: Design | undefined): BlockShape {
  if (d) try { return computeStats(d); } catch { /* fall through */ }
  return { size: 1, squad: 1 };
}
function clonePlacement(p: Placement): Placement {
  const c: Placement = { uid: p.uid, designId: p.designId, x: p.x, y: p.y, level: p.level, round: p.round };
  if (p.spacing !== undefined) c.spacing = p.spacing;
  if (p.rot) c.rot = true;
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
