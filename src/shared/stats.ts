// Design -> UnitStats, plus design validation.

import { CHASSIS_BY_ID, MOBILITY_BY_ID, MODULE_BY_ID, fitsMount, moduleTier, pairingError, weaponCap } from './parts.ts';
import { hullK, meleeSlots } from './mountgeo.ts';
import { REPAIR_AURA_RANGE } from './types.ts';
import type { ChassisDef, Design, ModuleDef, TuneKey, UnitStats } from './types.ts';

/** Above this load (weight / capacity) a design is illegal. */
export const MAX_LOAD = 1.5;
export const MAX_LEVEL = 3;
/** Per level above 1: +hp and +damage multiplier. */
export const LEVEL_BONUS = 0.3;

/** Speed multiplier from load: light designs get up to +25%, overloaded ones crawl. */
export function loadSpeedFactor(load: number): number {
  if (load <= 1) return 1 + 0.25 * (1 - load);
  return Math.max(0.3, 1 - (load - 1) * 1.2);
}
/** Turn-rate multiplier from load, the same shape as loadSpeedFactor: a light build pivots up to +22% faster, a build at
 *  capacity turns at the drive's base rate, and an overloaded one swings clearly slower (x0.4 at the 1.5 legal cap).
 *  Shared by computeStats (sim) and the designer's Turning row. */
export function loadTurnFactor(load: number): number {
  if (load <= 1) return 1 + 0.22 * (1 - load);
  return Math.max(0.4, 1 - (load - 1) * 1.2);
}

/** Percentage modules stack with diminishing returns: the strongest copy counts fully, the 2nd at 80%, the 3rd at
 *  60%, then 40%, 20% (two targeting computers: +15% + 12% range, not +30%). */
export const STACK_WEIGHTS = [1, 0.8, 0.6, 0.4, 0.2];
export const stackWeight = (i: number) => STACK_WEIGHTS[i] ?? 0;
export function stackBonus(vals: number[]): number {
  return [...vals].filter((v) => v > 0).sort((a, b) => b - a).reduce((t, v, i) => t + v * stackWeight(i), 0);
}
/** most energy damage one unit can shrug off however many mirror coatings it carries */
export const MAX_ENERGY_RESIST = 0.75;
/** Signed stacking: gains and losses of the same kind each stack with diminishing returns (two Short-Barrel Kits:
 *  +25% + 20% damage, -15% - 12% range), then net out. */
export function signedStack(vals: number[]): number {
  return stackBonus(vals.filter((v) => v > 0)) - stackBonus(vals.filter((v) => v < 0).map((v) => -v));
}
/** keys of ModuleDef.tune that stackedBonuses folds into the matching legacy bonus (rangeBonus, speedBonus, fireRateBonus) */
const STACKED_TUNE = new Set<TuneKey>(['range', 'speed', 'fireRate']);
/** Net trade-off tuning of a loadout (ModuleDef.tune), every key but range / speed / fire rate (see stackedBonuses). */
export function tuneOf(mods: ModuleDef[]): Partial<Record<TuneKey, number>> {
  const out: Partial<Record<TuneKey, number>> = {};
  for (const m of mods) for (const k of Object.keys(m.tune ?? {}) as TuneKey[]) {
    if (STACKED_TUNE.has(k) || k in out) continue;
    const v = signedStack(mods.map((x) => x.tune?.[k] ?? 0));
    if (v) out[k] = v;
  }
  return out;
}
/** A weapon as a tuned loadout fires it (shared by the sim and the price, so they agree): damage scaled, armour
 *  penetration moved by whole half-tiers (0 / 0.5 / 1), blast radius widened on projectile weapons that already burst or
 *  hit as solid rounds (not beams, lightning, rails, flame or melee), shells sped up / slowed, turret traverse scaled.
 *  The module itself is returned untouched when nothing applies. */
export function tunedWeapon(w: ModuleDef, t: Partial<Record<TuneKey, number>> | undefined): ModuleDef {
  if (!t || w.kind !== 'weapon' || w.heal) return w;
  const { damage = 0, ap = 0, splash = 0, projSpeed = 0, traverse = 0 } = t;
  if (!damage && !ap && !splash && !projSpeed && !traverse) return w;
  const p = w.projectile;
  const solid = p !== 'beam' && p !== 'lightning' && p !== 'rail' && p !== 'flame' && p !== 'melee';
  const out: ModuleDef = { ...w };
  if (damage && w.damage) out.damage = w.damage * Math.max(0.2, 1 + damage);
  if (ap) out.ap = Math.min(1, Math.max(0, Math.round(((w.ap ?? 0) + ap) * 2) / 2));
  if (splash && solid) out.splash = Math.max(0, (w.splash ?? 0) + splash);
  if (projSpeed && w.projectileSpeed) out.projectileSpeed = w.projectileSpeed * Math.max(0.3, 1 + projSpeed);
  if (traverse && w.spinal == null) out.turretTurn = turretTurnRate(w) * Math.max(0.2, 1 + traverse);
  return out;
}

/** Every percentage bonus of a loadout, stacked (shared by the price model and the sim so they agree). */
export function stackedBonuses(mods: ModuleDef[]): { range: number; spreadCut: number; speed: number; fireRate: number; reload: number; energyResist: number; regen: number } {
  const pick = (f: (m: ModuleDef) => number | undefined) => stackBonus(mods.map((m) => f(m) ?? 0));
  const signed = (f: (m: ModuleDef) => number) => signedStack(mods.map(f));
  return {
    range: signed((m) => (m.rangeBonus ?? 0) + (m.tune?.range ?? 0)),
    spreadCut: pick((m) => (m.spreadMult ? 1 - m.spreadMult : 0)),
    speed: signed((m) => (m.speedBonus ?? 0) + (m.tune?.speed ?? 0)),
    fireRate: signed((m) => (m.fireRateBonus ?? 0) + (m.tune?.fireRate ?? 0)),
    reload: Math.min(0.8, pick((m) => m.reloadBonus)),
    energyResist: Math.min(MAX_ENERGY_RESIST, pick((m) => m.energyResist)),
    regen: pick((m) => m.regen),
  };
}

export function designModules(d: Design): ModuleDef[] {
  const out: ModuleDef[] = [];
  for (const id of d.mounts) {
    if (!id) continue;
    const m = MODULE_BY_ID.get(id);
    if (m) out.push(m);
  }
  return out;
}

/** Sustained dps of one weapon vs 0 armor (no splash/chain multipliers). */
export function weaponDps(w: ModuleDef): number {
  if (w.kind !== 'weapon' || !w.damage || !w.cooldown) return 0;
  const cl = w.cluster ? w.cluster.count * w.cluster.damage : 0; // bomblets released by each shell
  return ((w.damage + cl) * (w.burst ?? 1) * (w.pellets ?? 1)) / cycleTime(w);
}

/** Estimated seconds a bomber spends flying home and back to rearm a resupply (bomb bay) magazine. */
export const RESUPPLY_TRIP = 8;
/** Average seconds per shot including magazine reloads (and, for bomb bays, the flight home to rearm). */
export function cycleTime(w: ModuleDef): number {
  const cd = w.cooldown ?? 1;
  if (!w.magazine || !w.reload) return cd;
  return (cd * (w.magazine - 1) + w.reload + (w.resupply ? RESUPPLY_TRIP : 0)) / w.magazine;
}

/** Alpha of a weapon: damage of one full magazine (clip weapons) or one volley (everything else), vs 0 armor, and the
 *  seconds it takes to deliver it (0 for a single volley). Clip weapons trade sustained dps for this burst. */
export function burstOf(w: ModuleDef): { damage: number; time: number; reload: number } {
  const cl = w.cluster ? w.cluster.count * w.cluster.damage : 0;
  const volley = ((w.damage ?? 0) + cl) * (w.burst ?? 1) * (w.pellets ?? 1);
  const burstT = ((w.burst ?? 1) - 1) * 0.1; // follow-up rounds of a burst go out BURST_GAP (0.1 s) apart
  if (w.magazine && w.reload) return { damage: volley * w.magazine, time: (w.magazine - 1) * (w.cooldown ?? 1) + burstT, reload: w.reload };
  return { damage: volley, time: burstT, reload: w.cooldown ?? 1 };
}

/** Firing pattern label for UI. */
export function firingStyle(w: ModuleDef): 'Sustained' | 'Clip' | 'Salvo' | 'Single shot' {
  if ((w.burst ?? 1) > 1 || (w.pellets ?? 1) > 1) return 'Salvo';
  if (w.magazine && w.reload) return 'Clip';
  return (w.cooldown ?? 1) <= 0.6 ? 'Sustained' : 'Single shot';
}

/** Accuracy rating 0..100 for UI: hitscan/homing are perfect, otherwise from spread & projectile speed. */
export function accuracyRating(w: ModuleDef): number {
  const p = w.projectile;
  if (p === 'beam' || p === 'lightning' || p === 'rail' || p === 'missile' && !w.spread) return 100;
  const spreadPenalty = (w.spread ?? 0) / Math.max(1, (w.range ?? 5) / 5);
  const speedPenalty = p === 'arc' ? 0.25 : w.projectileSpeed ? Math.max(0, 0.3 - w.projectileSpeed / 80) : 0;
  return Math.round(Math.max(5, 100 * (1 - spreadPenalty * 0.8 - speedPenalty)));
}

// ---------------------------------------------------------------------------------------------
// Cost model.
//
// Lanchester's square law: an army's fighting strength ~ N^2 * dps * ehp. For two armies of equal
// SUPPLY to be equally strong, a unit's cost must scale with sqrt(dps * ehp). So:
//
//   offense = sum over weapons of (dps vs a mix of armor) * splash/chain/burn/stun value * range factor * coverage
//   ehp     = (hp + shield) * armor factor * evasion/flight factors
//   power   = sqrt(offense * ehp) * mobility factor
//   cost    = PARTS_WEIGHT * partsCost + POWER_K * power          (rounded to 5)
//
// partsCost keeps "complexity" in the price (twin mounts, exotic parts cost more to field even
// when the model under-rates them); the power term is what keeps army sizes balanced.
// ---------------------------------------------------------------------------------------------

export const PARTS_WEIGHT = 0.3;
export const POWER_K = 0.36;
/** Size-class price factor on the whole unit cost, by chassis size 1..5 (size 1 = per unit of a light squad).
 *  Sim effects that scale with size (overkill, focus fire, chip damage vs a few big targets, squad splash exposure,
 *  retargeting) are not visible to the analytic power term; this one multiplier per class soaks them up. */
// Re-tuned by direct equal-supply sims (light/medium/heavy armies vs each other; giants & titans vs mixed armies):
// bigger hulls concentrate armour and firepower far better than the analytic model credits (flat armour shrugs off
// light weapons, no squad splash exposure), so price rises steeply with class. Previous fit (0.93/0.83 for 4/5) made
// giants and titans win ~100% at equal cost; these values bring them to ~50%. Light squads dropped to 0.85 when bodies
// were scaled down (mountgeo bodyScale: light troopers 0.7, the rest 0.78): size-1 armies fell to ~20% vs size 2.
// Dynamic squads (16 / 8 / 4 by unit price) made mixed armies stronger (their light blocks fight better): giants and
// titans went down to 1.37 / 1.34 (from 1.49) to stay ~50% vs mixed armies.
// Rules 7: fitted together with MODULE_CAL against smart-deployed mixed armies (see there); light squads are worth
// more as a chaff screen (0.85 -> 0.97), heavies less (1.19 -> 0.92), titans more (1.34 -> 1.68).
// The convex armour term (ARMOR_PRICE) and the dearer cannon raised giant and titan prices ~17% / ~25%: giants
// 1.32 -> 1.13 and titans 1.68 -> 1.35 hand it back (both already sat at or below 50%).
export const SIZE_K: number[] = [0.97, 1.04, 0.92, 1.13, 1.35];
/** Per-mobility price factor on the whole unit cost (fitted with scripts/fit_cal.py on plain frames; 1 = analytic).
 *  Soaks up what the analytic mobility term cannot see: how well a drive keeps a hull in the fight (leapers waste
 *  time, anchors and big tracks never leave the front, flyers dodge half the field). */
// Ground drives refitted for the drive rework (rules 6: wheels fast / arc-turning / slow reverse, treads slow and
// pivoting, legs slow, spider omni, hover floating): fit_cal.py (FIT_ONLY_CHASSIS=1, 10 iterations, mean of the last
// 4) for the within-hull contrast, then treads / legs / spider / halftrack / megatracks / titanlegs / wheels nudged
// toward the starter field (balance.ts army 6 starter: rms 20.9 pts vs 21.3 before; wheels kept low enough that the
// Buzzsaw stays a 16-squad); air drives unchanged.
export const MOBILITY_CAL: Record<string, number> = { anchor: 0.97, gravlift: 1.45, halftrack: 1.25, hover: 0.93, jet: 0.7, jumpjets: 0.96, legs: 1.0, megatracks: 1.14, rotor: 1.18, spider: 0.97, titanlegs: 0.92, treads: 1.12, wheels: 0.94 };
/** Extra air-drive price factor on small airframes, by chassis size 1 / 2 (x MOBILITY_CAL): light rotor drones and
 *  gunships, light jets. They pick their fights, dodge, and only anti-air answers them, which the per-drive factor
 *  (fitted on all airframes) under-rates on the small, cheap ones. Fitted with balance.ts army on drone / gunship
 *  rotor designs and interceptor / delta-wing / strike-jet designs (supplies 1000 / 1200 / 1400, 4 seeds): gunships
 *  ~85% -> ~65%, drones ~70% -> ~55%, light jets ~75% -> ~65%; laser-armed flyers still ~80-90%. */
export const SMALL_AIR_CAL: Record<string, number[]> = { rotor: [1.1, 1.3], jet: [1, 1.1] };
/** Hover brawlers: a hovering drive is fast, floats over burning ground and can't be crushed, which is worth far more
 *  to a hull that must close to knife range (melee, flamers, shotguns: reach <= HOVER_BRAWL.reach cells) than to a
 *  gun platform. Price factor 1 + k x (offense share of such weapons) on hover designs. Fitted with balance.ts army:
 *  mantis / scout hover saw, prod and flamer designs won ~80-85% (ranged hover designs ~30-50%); k = 0.45 brings the
 *  hover Gnasher to ~50%. */
export const HOVER_BRAWL = { k: 0.45, reach: 5 };
/** Share of the speed term (mobilityF) lost per unit of reverse penalty (reverse 0.5 -> speed worth 0.5 x REVERSE_W less) */
const REVERSE_W = 0.3;
/** mobilityF bonus of an omnidirectional ('omni') walker */
const OMNI_F = 0.04;
/** ehp factor of a hovering ('hover') drive: burning ground and crush immunity, half damage from ground-burst splash */
const HOVER_EHP = 1.06;
/** Jet price factor for giant / titan airframes, in place of MOBILITY_CAL.jet (fitted on fighters and the strato
 *  bomber, which dodge and slip through the AA): the giant and titan bombers don't jink (no evasion), turn wide and
 *  are big targets, but still fly their runs over everything on the ground. Fitted with `node scripts/op-check.ts`
 *  (one or two of them plus a starter mix vs the mix, ~2x their price per side) and `node scripts/role-check.ts bomber`. */
// (x SIZE_K: 1.05 / 1.17 -> 1.2 / 1.4 when SIZE_K for giants / titans came down with the convex armour term, so the
// bombers' prices hold)
export const GIANT_JET_CAL: Record<number, number> = { 4: 1.2, 5: 1.4 };
/** Convex armour value (rules 7). Flat armour takes a fixed amount off every hit, so a thick hull shrugs off whole
 *  classes of guns (an Ironclad is all but immune to machine guns), while sqrt(offense x ehp) with a linear armour
 *  factor priced that like any other hit points (an armour-stacked bastion with a token gun won ~80% of mixed-army fights).
 *  The hull's ehp is multiplied by 1 + k x max(0, negated - n0)^p, where negated is the share of the field's typical
 *  damage the armour takes off (armorNegation, against REF_HITS): nothing up to ~8 armour (n0), then convex, so the
 *  last points of a thick hull are worth more than the first (armour 13: x1.02, 24: x1.2, 33: x1.5 ehp). Fitted with
 *  balance.ts army (frozen mix, supplies 1000 / 1200 / 1400) on bastion plate stacks and the Ironclad: k = 15 brings
 *  them from ~80% to ~50% (k = 40 overshot to ~10%); SIZE_K for giants and titans scaled back so their prices hold. Mutable for trial runs (QM_SET); k = 0 is the rules-6 price (match.ts). */
export const ARMOR_PRICE = { k: 15, n0: 0.15, p: 2 };
/** The field's typical hits as [damage per hit, armour penetration, share of the field's weapon value]: the starter
 *  weapons (sizes 1-3), each starter weighted equally and split over its guns by weapon value (rules-7 numbers). */
const REF_HITS: readonly (readonly [number, number, number])[] = [
  [3.5, 0, 5], [5, 1, 5], [8, 0, 5.7], [16, 0.5, 3.4], [22, 0, 0.5], [30, 1, 2.6], [32, 0.5, 22.6], [36, 1, 2.4],
  [70, 0.5, 4.5], [70, 0, 5], [75, 0.5, 5], [84, 0, 1.5], [110, 0, 6.8], [110, 0.5, 5], [190, 1, 5.2], [224, 0.5, 1.1],
  [240, 1, 3.9], [272, 1, 5], [420, 1, 4.8], [480, 0.5, 5],
];
const REF_HITS_W = REF_HITS.reduce((t, h) => t + h[2], 0);
/** Share of the field's typical damage (REF_HITS) that flat armour takes off (sim: never more than 85% of a hit). */
export function armorNegation(armor: number): number {
  if (armor <= 0) return 0;
  return REF_HITS.reduce((t, [dmg, ap, w]) => t + w * Math.min(0.85, (armor * (1 - ap)) / dmg), 0) / REF_HITS_W;
}
/** ehp multiplier of the convex armour term (ARMOR_PRICE) */
export const armorConvexF = (armor: number) => 1 + ARMOR_PRICE.k * Math.max(0, armorNegation(armor) - ARMOR_PRICE.n0) ** ARMOR_PRICE.p;
/** reference enemy armor mix used to rate weapons */
const REF_ARMOR = [0, 5, 12];
const RANGE_EXP = 1.0;
/** Extra value of armour penetration beyond REF_ARMOR's 0 / 5 / 12: front lines run 12-37 armour (scripts/teamvalue.ts
 *  found full-AP guns underpriced). Mutable for trial runs (balance.ts BAL_APK). */
export const AP_VALUE = { k: 0 };
/** Range (cells) rated 1.0. Weapon ranges were stretched ~1.3x for the 96 x 92 field (direct fire 6 -> 7.5 cells);
 *  the reference moved with them so a gun's price is unchanged by the stretch. Repair beams kept their range, so
 *  their MODULE_CAL was scaled by 6.5 / 5 to keep their price; weapon MODULE_CAL re-fitted with fit_cal.py. */
const RANGE_REF = 6.5;
/** Share of a bomb bay's value on a hovering (rotor / grav-lift) bomber, next to a jet's: it rearms only over its own
 *  lines and flies there and back at a crawl. Fitted with `node scripts/op-check.ts` / `role-check.ts bomber` (grav
 *  bombers won 4-25% at equal supply at the jet price). */
export const HOVER_BOMB_K = 0.5;
/** Effective-hp floor for long-reach units (see computeStats): ramps in from SHELTER_FROM cells of reach to full
 *  at SHELTER_FROM + SHELTER_SPAN.  Fitted with `node scripts/duels.ts groups` (cheap mortar carts vs tanks). */
export const SHELTER_EHP = 400;
const SHELTER_FROM = 10;
const SHELTER_SPAN = 10;
const RANGE_CAP = 2.8;

// ---------------------------------------------------------------------------------------------
// Damage rules (shared by the sim and every UI text):
//   1. Shields (module shields and dome shields) soak each hit first, at full strength: armour and armour
//      penetration don't matter against a shield.
//   2. Whatever gets past the shield hits the hull. Hull armour takes a flat amount off every hit (armour 10 = -10
//      per hit, never below 15% of the hit), so many small hits lose far more to armour than a few big ones.
//   3. Armour penetration comes in three tiers: none, half (ignores half the armour) and full (ignores all of it).
//   4. Damage types: explosive (shells, rockets, missiles, bombs) is cut by reactive armour; energy (beams, lasers,
//      lightning, rails, flame, plasma) by mirror coating; kinetic (bullets, melee) by neither.
// ---------------------------------------------------------------------------------------------

export type ApTier = 'none' | 'half' | 'full';
export const AP_TIERS: Record<ApTier, { value: number; label: string; short: string; desc: string }> = {
  none: { value: 0, label: 'No penetration', short: 'AP none', desc: "Full armour applies: every hit loses the target's armour value." },
  half: { value: 0.5, label: 'Half penetration', short: 'AP half', desc: "Ignores half the target's armour." },
  full: { value: 1, label: 'Full penetration', short: 'AP full', desc: "Ignores the target's armour completely." },
};
/** Penetration tier of a weapon (parts only use 0 / 0.5 / 1; anything else rounds to the nearest tier). */
export function apTier(mod: Pick<ModuleDef, 'ap'>): ApTier {
  const a = mod.ap ?? 0;
  return a >= 0.75 ? 'full' : a >= 0.25 ? 'half' : 'none';
}
export type DamageKind = 'kinetic' | 'explosive' | 'energy';
/** Damage types of a weapon (plasma orbs are both explosive and energy). */
export function damageKinds(mod: Pick<ModuleDef, 'projectile' | 'category' | 'dmgKind'>): DamageKind[] {
  if (mod.dmgKind) return [mod.dmgKind];
  const k = mod.projectile;
  if (k === 'shell' || k === 'rocket' || k === 'missile' || k === 'arc') return ['explosive'];
  if (k === 'orb') return mod.category === 'energy' ? ['energy', 'explosive'] : ['explosive'];
  if (k === 'beam' || k === 'lightning' || k === 'rail' || k === 'flame') return ['energy'];
  return ['kinetic'];
}

/** Fraction of raw damage that gets through the reference armor mix (sim damage formula). */
export function armorEfficiency(damage: number, ap: number): number {
  let sum = 0;
  for (const a of REF_ARMOR) sum += Math.max(damage * 0.15, damage - a * (1 - ap)) / damage;
  return sum / REF_ARMOR.length;
}

/** Predicted damage-output rating of one weapon (or healing value of a repair module). */
/** Expected fraction of shots that connect with a (mostly engaged, slowly moving) target. Hitscan, homing and
 *  melee never miss; unguided projectiles lose to spread, and a little to flight time: the sim leads moving targets
 *  (constant-velocity intercept), so only targets that turn or stop mid-flight dodge. MODULE_CAL was rescaled when
 *  this went from 0.25 to 0.04 per second of flight, keeping every price unchanged. Lobbed shells and unguided rockets
 *  weigh their flight time FLIGHT_SLOW per second instead: the sim showed a slow howitzer shell (speed 9) losing about
 *  half its value against fast movers next to a quick one (speed 16), which 0.04 / s priced at ~3%. */
export const FLIGHT_FAST = 0.04;
export const FLIGHT_SLOW = 0.15;
export function hitFactor(w: ModuleDef): number {
  const p = w.projectile;
  if (p === 'beam' || p === 'lightning' || p === 'rail' || p === 'melee' || (p === 'missile' && !w.spread)) return 1;
  const spread = (w.spread ?? 0) * 0.7;
  const flight = w.projectileSpeed ? (w.range ?? 5) / w.projectileSpeed : 0;
  // a proximity fuse bursts beside whatever it passes near: it widens the target as far as the fuse reaches
  const target = 0.45 + 0.6 * (w.splash ?? 0) + 1.5 * (w.proximity ?? 0);
  return target / (target + spread + (p === 'arc' || p === 'rocket' ? FLIGHT_SLOW : FLIGHT_FAST) * flight) / 0.7;
}

/** Damage at the rim of a blast, as a share of the centre hit (sim: linear falloff to this at the splash radius). */
export const SPLASH_EDGE = 0.3;
/** Mean damage over a blast's area relative to the default falloff: a flat lethal radius (edge 1) is worth ~1.9x a
 *  sharp centre (edge 0) per unit of splash. Area-weighted mean of a linear falloff = 1/3 + 2 edge / 3. */
export function splashEdgeK(w: Pick<ModuleDef, 'splashEdge'>): number {
  const e = w.splashEdge ?? SPLASH_EDGE;
  return (1 / 3 + (2 * e) / 3) / (1 / 3 + (2 * SPLASH_EDGE) / 3);
}

/** Aiming freedom: a fast turret is rated 1. A slow turret (the sim no longer swings the hull to help it) and a spinal
 *  (fixed-arc) gun, which the whole vehicle must turn to bring on, lose a little: in equal-supply fights the enemy mostly
 *  comes head-on, so a narrow arc only costs against flankers (a spinal and a turreted howitzer scored the same against
 *  hover raiders charging the line). The rest of the trade is left to MODULE_CAL. */
export function traverseFactor(w: ModuleDef): number {
  if (w.projectile === 'melee' || w.heal) return 1;
  if (w.spinal != null) return 0.9 + 0.1 * Math.min(1, w.spinal / 0.6);
  return 0.95 + 0.05 * Math.min(1, turretTurnRate(w) / 1.5);
}

/** Value lost to a minimum range: the share of the reach a weapon can't use, weighted (a dead zone of a third of the
 *  reach costs ~13%, the old flat 10% at a quarter). */
export function minRangeFactor(w: Pick<ModuleDef, 'minRange' | 'range'>): number {
  const q = (w.minRange ?? 0) / Math.max(1, w.range ?? 1);
  return 1 - 0.4 * Math.min(1, q);
}

/** Empirical calibration, fitted with `node scripts/balance.ts` (equal-supply armies of every module vs a reference
 *  field). The analytic terms above give each module a first-order value; sim effects they cannot see (target
 *  drift, overkill, focus fire, how often a stun/aura/cloak really matters in a big fight) are folded into one
 *  multiplier per module id. Weapons: multiplies weaponValue. Utilities: scales the strength of the effect terms
 *  in computeStats (1 = analytic value; low values mean the effect is worth little in mass battles). Re-fit after
 *  changing the sim or the part numbers. */
export const MODULE_CAL: Record<string, number> = {
  // [rules 7: weapon pass, weapon cap, utility remake] re-fitted against SMART-deployed mixed armies on both sides
  // (shared/smartdeploy.ts; balance.ts reserves ~20% of every reference mix for chaff clear):
  //   1. `python3 scripts/fit_cal.py` with BAL_FROZEN (reference mix bought at frozen prices) + FIT_CENTER=abs, then
  //      unfrozen with FIT_CENTER=starters and a trust region (FIT_CALBASE = the price-neutral values, FIT_BOUND=2.5:
  //      the fit corrects the analytic price, it never replaces it); SIZE_K fitted alongside, MOBILITY_CAL held
  //   2. a few starter-targeted nudges (6-seed starter-only runs) to centre the starters near 50%
  //   AA weapons (flak, heavyflak, skyfortress, aamissile, quad20) and the hand-set auras are held at their
  //   price-neutral floor (the ground-army fit can't see their job and drove them near free).
  //   Result (balance.ts army 3, smart): module rms 18.3 (HEAD 19.8), starter rms 15.9 / mean 0.55 (HEAD 20.7).
  //   3. with the convex armour term (ARMOR_PRICE): cannon 1.487 -> 2.4 (a 120 mm on a cheap warden won ~80% of mixed
  //      fights, the Longarm ~65%; 2.4 is the most that keeps the Tankbuster a 2-squad). A cannon on a thick hull
  //      still wins ~70-80% at any cannon price tried (up to 6: dearer cannons also thin the cannons out of the
  //      opposing field), so the Ironclad keeps its autocannons.
  //   4. cannon75 2.951 -> 6.5 (balance.ts, frozen mix: a 75 mm on a warden or bastion won 75-85%; at 6.5 the Aegis
  //      Wall sits near 50%).
  leech: 2.905, prism: 3.272, voidlance: 3.725, entropy: 2.41,
  aamissile: 1.086, ac20: 2.067, ac40: 5.353, aegisT: 1.1, annihilator: 0.868, arclance: 1.62, atgm: 8.757,
  autocannon: 4.001, autoloader: 2.89, avenger: 1.216, barrage: 10.564, bombs: 9.177, bulwarkshield: 1.689, buzzsaw: 0.171,
  cannon: 2.4, cannon75: 6.5, chainsaw: 1.136, claw: 0.918, clusterbombs: 17.296, heavybomb: 6.502, cruise: 10.931, disarm: 0.84,
  dome: 1, domeG: 1, doomsday: 3.879, drill: 0.721, empcannon: 1.545, flak: 0.284, flamer: 0.7, gauss: 11.118,
  gravity: 6.197, grinder: 0.398, guidedrocket: 7.551, gyro: 0.11, hammer: 0.643, hardened: 0.335, heatray: 1.468,
  heavyflak: 1.094, hmg: 3.498, howitzer: 2.271, incendiary: 0.843, inferno: 0.609, jammer: 0.25, laser: 6.042,
  lightrail: 13.806, massdriver: 0.396, mg: 3.044, minigun: 0.885, mirror: 1.18, missilebattery: 1.979, mlrs: 6.561,
  mortar: 4.078, nanite: 0.417, napalm: 0.214, overclock: 0.775, phantom: 0.476, plasma: 3.815, plasmablade: 1.719,
  plasmaorb: 2.49, pointdef: 4.171, quad20: 0.693, railgun: 12.612, ram: 0.32, reactive: 1.574, repair: 13.628,
  repairM: 4, rocketL: 2.387, rockets: 4.04, sam: 8.339, selfdestruct: 2.695, sensor: 1, shield: 2.269,
  shieldH: 2.222, shieldL: 3.093, shockprod: 0.348, shotgun: 0.461, siege240: 1.887, siegeplasma: 0.523, skyfortress: 0.614,
  slowbeam: 6.666, smoke: 3.573, sniper: 10.425, sonic: 0.594, stealth: 1.91, stormcore: 0.539, stormtower: 1.218,
  stungun: 0.89, swarm: 5.064, tactnuke: 3.025, targeting: 5.464, tesla: 0.92, titanfist: 0.711, turbo: 0.315,
  twin120: 2.649, twin30: 3.25, twinlaser: 3.018, twinmg: 2.675, uplink: 0.511,
  clusterhow: 4.798, firebomb: 2.462, flechette: 7.073, grenade: 2.728,
  // [aura balance] aura strengths (uplink, dome, domeG, jammer, sensor above and these two) were set by hand after the
  // radius rework: `node scripts/balance.ts army 3 <id>` (every unit carries the aura -> heavy overlap) lands at a
  // delta of -7..+2, i.e. a little overpriced when massed, and `node scripts/auras.ts field` (ONE carrier escorting a
  // block, no overlap) at roughly even vs the same supply of guns. fit_cal.py holds them fixed (non-stacking makes
  // its all-carrier gradient drift them toward zero). aegisTAura prices the Aegis Field's projected shield only.
  aegisTAura: 1.5, repairAura: 1.5,
  // selfdestruct was 0.14 (fitted on lone carriers, where one 300-damage blast barely matters): a 16-cart block of
  // bare self-destruct carriages cost 70 and won ~90% of equal-supply fights (`node scripts/teamvalue.ts walls`).
  // At 7 such swarms land near 50% (and come 8 to a block).
  // [weapon pass] new bomb bays (stun / EMP control bombs)
  stunbomb: 20.296, empbomb: 22.443, stuncluster: 12.827,
  // [weapon pass] new modules
  shortbarrel: 0.118, longbarrel: 1.754, herounds: 0.745, optics: 1.828, reinforced: 0.67, lightframe: 0.835, berserker: 0.794, ammorack: 0.146, overcharge: 1.75, killrush: 1.518, evasion: 0.9, scrapmine: 1.5, emppop: 0.7, packlink: 2.935, heavyrounds: 0.889, afterburner: 1.248, painter: 1.563, deflector: 1.98,
};
const cal = (id: string) => MODULE_CAL[id] ?? 1;

// [aura balance] Support auras (uplink, domes, jammer, sensor, repair-aura hulls) are priced by what they project onto
// OTHER units, so their value is added to the unit cost directly instead of riding on the carrier's own power term
// (in sqrt(offense * ehp) an aura on a titan cost next to nothing, on a tanky gunless hull a lot).
/** Raw cost (x PRICE_DIV = supply) per analytic aura point at reach 1 (MODULE_CAL then scales each module). */
export const SUPPORT_K = 1;
/** Aura radius (cells, edge to edge) from a size-2 hull (radius 0.9) rated reach 1. */
const AURA_REF_R = 8 + 0.9;
/** Reach is capped: past ~60 m an aura already covers everything near its carrier that matters. */
const AURA_REACH_CAP = 2.5;
/** Expected coverage of an aura of `radius` cells (edge to edge) on a hull of bounding radius `hullR`: covered area
 *  grows with (radius + hullR)^2, relative to the reference, capped. */
export function auraReach(radius: number, hullR: number): number {
  return Math.min(AURA_REACH_CAP, ((radius + hullR) / AURA_REF_R) ** 2);
}
/** Raw cost per point-defense module at cooldown 0.6 s (x MODULE_CAL.pointdef): ~+12 supply on a medium hull, as before. */
const PD_PTS = 23;
/** Auras don't stack, so the carriers of one squad mostly cover the same allies: per unit, a squad's aura is worth
 *  this share of a lone carrier's (the squad's union covers ~2 lone carriers' worth of ground). */
export const auraSquadShare = (squad: number) => (squad > 1 ? Math.min(1, 2 / squad) : 1);

/** Squads: units per block by hull size and per-unit price (supply; the analytic price, before the team-value
 *  correction, so repricing never reshapes a block). Cheap units come in big blocks, pricier ones in
 *  smaller blocks so one purchase stays affordable: per size, [max per-unit price, squad] tiers. Light (size-1) hulls
 *  come 16 / 8 / 4 to a block, medium (size-2) ones 4 / 2 / 1 (a ~30-supply turret is a 4-block, not a 30-supply
 *  single); sizes 3+ are single units. Per-unit stats and price don't depend on the tier (except the SQUAD_K factor
 *  and a support aura's share, see auraSquadShare), so equal supply still buys about the same army; the tier only
 *  changes the purchase granularity and formation (grid.ts). */
/** Price factor per squad count (on the unit value, before support), per hull size: smaller blocks fight better per
 *  unit in the sim (each block picks its own targets and moves on its own; a wide 8 x 2 block bunches up and
 *  overkills), so a unit costs a little more in a smaller squad. Tuned with `node scripts/size-check.ts` and
 *  `node scripts/duels.ts groups`. */
// Medium squads: 2 x 2 / 2 x 1 blocks of the same design vs the same units as singles (9 designs, 48 fights per
// point, mixed armies, 1-cell gaps around every block) break even at 0.94..1.05 singles per squad unit, ~1.0 on
// average for both x4 and x2: a 2-4 unit block barely overkills, so the per-unit price is the single's.
// Tuned (N=24, 48 fights per row) with size-check: light vs medium armies 19% -> 54% (the old always-16 blocks were weak
// for their price), giants/titans vs mixed armies kept where they were by SIZE_K[3..4] x0.92 / x0.9.
export const SQUAD_K: Record<number, Record<number, number>> = { 1: { 16: 1, 8: 1.2, 4: 1.35 }, 2: { 4: 1, 2: 1, 1: 1 } };
export const SQUAD_TIERS: Record<number, readonly (readonly [number, number])[]> = {
  1: [[11, 16], [24, 8], [Infinity, 4]],
  2: [[35, 4], [60, 2], [Infinity, 1]],
};
/** price factor of a `squad`-unit block of a size-`size` hull */
export const squadK = (size: number, squad: number): number => SQUAD_K[size]?.[squad] ?? 1;

/** Units per block for a hull of `size`; `unitPrice(squad)` = one unit's price (supply, unrounded) in that squad. The
 *  biggest squad whose unit price fits its tier wins. Deterministic in the design, so a match's stored designs keep
 *  their squad on server and client. */
export function squadFor(size: number, unitPrice: (squad: number) => number): number {
  const tiers = SQUAD_TIERS[size];
  if (!tiers) return 1;
  for (const [max, sq] of tiers) if (unitPrice(sq) <= max) return sq;
  return tiers[tiers.length - 1][1];
}

/** Share of a fight a weapon gets to fire in, next to the design's longest weapon (`longest`, cells): full within
 *  ~2/3 of that reach (a 40 m and a 60 m gun weigh 50/50), fading to 0.4 at 1/5 of it or less (artillery + a machine
 *  gun weigh ~70/30). Repair beams and non-weapons are unaffected. */
export function engagementShare(w: ModuleDef, longest: number): number {
  if (w.kind !== 'weapon' || w.heal || !(longest > 0)) return 1;
  const q = (w.range ?? 0) / longest;
  return q >= 0.66 ? 1 : q <= 0.2 ? 0.4 : 0.4 + (0.6 * (q - 0.2)) / 0.46;
}

export function weaponValue(w: ModuleDef, rangeMult = 1): number {
  const range = (w.range ?? 0) * rangeMult;
  const rangeF = Math.min(RANGE_CAP, Math.max(0.5, Math.pow(range / RANGE_REF, RANGE_EXP))); // reach decides most fights
  if (w.heal) return w.heal * 1.6 * rangeF * cal(w.id);
  if (w.kind !== 'weapon' || !w.damage || !w.cooldown) return 0;
  const shots = (w.burst ?? 1) * (w.pellets ?? 1);
  const cl = w.cluster;
  const cyc = cycleTime(w);
  let v = (weaponDps(w) - (cl ? (cl.count * cl.damage * shots) / cyc : 0)) * armorEfficiency(w.damage, w.ap ?? 0);
  const edgeK = splashEdgeK(w);
  v *= 1 + 0.6 * (w.splash ?? 0) * edgeK;
  // cluster bomblets: scatter widely, so only part of them land on something
  if (cl) v += ((cl.count * cl.damage * shots) / cyc) * armorEfficiency(cl.damage, w.ap ?? 0) * (1 + 0.6 * cl.splash) * 0.6;
  v *= 1 + 0.45 * (w.chain ?? 0);
  // pierce: rails lose punch per hull and only catch what lines up under a thin slug (wider slugs catch more)
  if (w.pierce) v *= w.projectile === 'rail' ? 1 + (w.pierceKeep ?? 0.6) * (0.5 + (w.beamWidth ?? 0.1)) : 1.5;
  if ((w.pellets ?? 1) > 1) v *= 0.7; // pellets rarely all land
  if (w.falloff != null) v *= 0.3 + 0.7 * w.falloff;
  if (w.spinUp) v *= 0.85; // time lost spinning up at the start of each engagement
  if (w.ramp) v *= 1 + (w.ramp - 1) * 0.5; // average power over a focus
  // burn refreshes rather than stacks: worth ~its dps on each target it keeps alight
  if (w.burn) v += w.burn.dps * Math.min(1, w.burn.duration / cyc) * (1 + 0.6 * (w.splash ?? 0));
  // fire field: burns everyone who stands in (or walks through) the patch while it lasts
  if (w.fireField) v += w.fireField.dps * Math.min(1.5, w.fireField.duration / cyc) * (1 + 0.6 * w.fireField.radius);
  if (w.stun) v += ((w.stun * shots) / cyc) * 22 * (1 + 0.8 * (w.splash ?? 0));
  if (w.slow) v += (w.slow / cyc) * 14;
  if (w.disarm) v += (w.disarm / cyc) * 28;
  if (w.shieldMult && w.shieldMult > 1) v *= 1 + 0.15 * (w.shieldMult - 1); // only matters against shielded targets
  if (w.lifesteal) v *= 1 + 0.6 * w.lifesteal; // sustain: the unit lasts longer the more it hits
  if (w.split && w.split > 1) v *= 1 + 0.55 * (w.split - 1); // extra beams find targets when there are several
  if (w.pctHp) v += ((w.pctHp * 1500) / cyc) * 0.6; // ~1500 hp: the hulls worth pointing it at
  if (w.shred) v += (w.shred / cyc) * 6; // stripped armour helps every other gun on the target
  if (w.impulse) v += (Math.abs(w.impulse) / cyc) * 6 * (1 + 0.6 * (w.splash ?? 0));
  v *= hitFactor(w);
  v *= 1 + AP_VALUE.k * (w.ap ?? 0); // armour penetration vs real front-line armour (see AP_VALUE)
  if (w.projectile === 'missile') v *= 1.1; // homing: rarely misses
  if (w.minRange) v *= minRangeFactor(w);
  v *= traverseFactor(w);
  // versatility costs: a gun that hits both ground and air pays a premium; ground-only or air-only guns get more
  // dps per supply (air-only: x its anti-air bonus, since its dps is counted against ground armour)
  const coverage = w.targetsGround && w.targetsAir ? 1.5 : w.targetsGround ? 0.65 : 1.05 * (w.airBonus ?? 1);
  return v * coverage * rangeF * cal(w.id);
}

// ---------------------------------------------------------------------------------------------
// Team value. The power term above prices a unit as if it fought alone. In a real army a unit is worth what it adds
// to the team: a 13k-hp wall with a token gun barely scratches anything alone but lets a gun line behind it win, and
// a cheap hull carrying a heavy gun plus a light one covers every target type. scripts/teamvalue.ts measures what
// ~80 reference designs are worth AS PART OF ~30 context armies (baseball WAR / basketball RAPM style: the supply
// of a stock filler design each one is worth when swapped in, vs a varied set of opponents; synergy with the
// context shared Shapley-style), aggregates each design to
//     price* = mean(context value) + 0.5 * (P80(context value) - mean)
// (halfway between its average-team and best-fit-team value), and distils that into this instant correction:
//     price = analytic price x exp(b0 + sum beta_i * (feature_i - center_i)),   clamped to [min, max]
// fitted by ridge regression of log(price* / analytic) with leave-designs-out CV (shrinks toward 1, the analytic
// price). Features are physical (from the numbers above, before this correction), so any player design gets a price
// at once. Re-fit with `node scripts/teamvalue.ts all` after changing the sim, parts or the analytic model.
// ---------------------------------------------------------------------------------------------

/** typical damage per hit of the guns a unit meets (7.62 mm .. 120 mm), for the armour-block feature */
const TYPICAL_HITS = [8, 16, 32, 55, 95, 190];
/** Team-value features (all from the analytic numbers, u = analytic unit price):
 *  tough ln(ehp / u) · dps ln(offense / u) (their difference is the HP:DPS tankiness ratio) · wall: tankiness
 *  past ehp / offense = 55 (near-weaponless walls) · armorBlock: share of typical hits flat armour takes off ·
 *  range ln(range / 6.5) · splash, aa (can hit air), airOnly (can't hit ground), ap (armour penetration): offense-weighted weapon shares ·
 *  speed (cells/s / 3) · flying, light (size 1), big (size >= 4) · melee: offense share · support: aura share. */
export const TEAM_FEATURES = ['tough', 'dps', 'wall', 'armorBlock', 'range', 'splash', 'aa', 'airOnly', 'ap', 'speed', 'flying', 'light', 'big', 'melee', 'support'] as const;
export type TeamFeature = typeof TEAM_FEATURES[number];
/** Team-value correction switch. OFF in the shipped game: prices are the analytic ones (plus the monotone floor).
 *  The fitted constants below are kept as tooling (scripts/teamvalue.ts, op-check / balance TV_FIT, TV_ON=1). */
export const TEAM_VALUE = { on: false };
/** Fitted team-value constants (scripts/teamvalue.ts fit; written to scripts/teamvalue-fit.json). Used only while
 *  TEAM_VALUE.on. */
export const TEAM_FIT: { b0: number; beta: Record<TeamFeature, number>; center: Record<TeamFeature, number>; min: number; max: number } = {
  b0: 0.0472,
  beta: { tough: 0.1311, dps: -0.1113, wall: 0.0799, armorBlock: -1.6204, range: 0.1697, splash: -0.0192, aa: -0.1204, airOnly: -0.693, ap: 0.2406, speed: 0.0581, flying: 0.2797, light: 0.117, big: -0.1899, melee: -0.9797, support: 1.9516 },
  center: { tough: 3.1717, dps: 0.7399, wall: 0.7348, armorBlock: 0.3316, range: 0.0986, splash: 0.33, aa: 0.5795, airOnly: 0.0188, ap: 0.4256, speed: 0.659, flying: 0.0926, light: 0.1667, big: 0.2407, melee: 0.0096, support: 0.0101 },
  min: 0.6,
  max: 2,
};
/** Team-value multiplier for a feature vector (clamped to [TEAM_FIT.min, TEAM_FIT.max]). */
export function teamMultiplier(f: Record<TeamFeature, number>): number {
  let x = TEAM_FIT.b0;
  for (const k of TEAM_FEATURES) x += TEAM_FIT.beta[k] * (f[k] - TEAM_FIT.center[k]);
  return Math.min(TEAM_FIT.max, Math.max(TEAM_FIT.min, Math.exp(x)));
}
/** Armour-block feature: average share of a typical hit that the hull's flat armour takes off (sim: at most 85%). */
export function armorBlock(armor: number): number {
  return TYPICAL_HITS.reduce((t, h) => t + Math.min(0.85, Math.max(0, armor) / h), 0) / TYPICAL_HITS.length;
}

// ---------------------------------------------------------------------------------------------
// Toughness floor ("wall tax"). sqrt(offense x ehp) prices a hull with no real gun at next to nothing (offense is
// floored at 5): a 13k-hp, 34-armour Monolith wall with a shield and point defense cost 180, and fronting a gun line
// it won most fights. Raw toughness now has a minimum price, a concave curve above a threshold:
//     F = TOUGH.a x max(0, toughness / 1000 - TOUGH.t0)^TOUGH.g   supply per unit
// toughness = (hp + reactive) x (1 + armour / 15) + 1.2 x shields: the hull alone (smoke, cloaks, flight and evasion
// are left out: they already scale the analytic ehp, and taxing them twice made a smoke wall unbuyable).
// A unit pays what its price falls short of F, counting its BARE HULL (the design with its weapons removed) fully
// and its guns at TOUGH.w (half):
//     price = analytic + max(0, F - (bare + w x (analytic - bare)))
// so a wall pays for its toughness, guns on a wall still pay at least half their own price (a token gun isn't free
// up to the floor), and a gun-heavy giant whose guns already cost far more than its hull is untouched. Ordinary hulls
// sit below t0. Tuned with `node scripts/teamvalue.ts walls` (Monolith walls + artillery / riot, massed cheap walls,
// the wall + pokers army) and `node scripts/balance.ts army 2 starter-` (the starters' spread around 50% must not grow).
export const TOUGH = { a: 38.5, g: 0.64, t0: 3, w: 0.5 };
/** analytic raw price of a design's bare hull (weapons removed), memoised */
const bareCache = new Map<string, number>();
function bareRawOf(d: Design): number {
  const bare = { ...d, mounts: d.mounts.map((x) => (x && MODULE_BY_ID.get(x)?.kind === 'weapon' ? null : x)) };
  const k = priceKey(bare);
  let v = bareCache.get(k);
  if (v === undefined) {
    v = statsFor(bare, undefined, true)._rawBase;
    if (bareCache.size > 100000) bareCache.clear();
    bareCache.set(k, v);
  }
  return v;
}

/** Monotone price floor: price(design) >= price(design minus any module), so adding a weapon (or any part) never
 *  makes a design cheaper. Memoised per chassis / drive / module multiset (mount order doesn't change the price). */
const teamBaseCache = new Map<string, number>();
export const priceKey = (d: Design) => `${d.chassis}|${d.mobility}|${d.mounts.filter((x) => x).sort().join(',')}`;
/** Forget memoised prices (scripts that change the price constants at run time call this). */
export function clearPriceCache(): void { teamBaseCache.clear(); bareCache.clear(); }
function teamBaseOf(d: Design): number {
  const k = priceKey(d);
  let v = teamBaseCache.get(k);
  if (v === undefined) {
    v = statsFor(d)._teamBase;
    if (teamBaseCache.size > 100000) teamBaseCache.clear();
    teamBaseCache.set(k, v);
  }
  return v;
}

export function computeStats(d: Design): UnitStats {
  const { _teamBase, _rawBase, ...s } = statsFor(d);
  void _teamBase; void _rawBase;
  return s;
}

/** Stats of a light / medium design forced into a `squad`-unit block (legacy pricing for rules migrations / analysis
 *  scripts); the game itself always lets squadFor decide. */
export function statsWithSquad(d: Design, squad: number): UnitStats {
  const { _teamBase, _rawBase, ...s } = statsFor(d, squad);
  void _teamBase; void _rawBase;
  return s;
}

/** Stats under the analytic price alone (no team-value correction, no toughness floor, no monotone floor): the rules-4 prices, for the
 *  rules-5 migration (match.ts) and analysis scripts. */
export function analyticStats(d: Design): UnitStats {
  const { _teamBase, _rawBase, ...s } = statsFor(d, undefined, true);
  void _teamBase; void _rawBase;
  return s;
}

function statsFor(d: Design, forceSquad?: number, analytic = false): UnitStats & { _teamBase: number; _rawBase: number } {
  const c = CHASSIS_BY_ID.get(d.chassis);
  const m = MOBILITY_BY_ID.get(d.mobility);
  if (!c || !m) throw new Error(`bad design parts: ${d.chassis}/${d.mobility}`);
  const size = c.size;
  const mods = designModules(d);
  let hp = c.hp + m.hp * size;
  let armor = c.armor + m.armor;
  let weight = c.weight + m.weight * size;
  let partsCost = c.cost + m.cost * size;
  let shield = 0;
  let heal = 0;
  let dps = 0;
  // giant and titan jets are far too big to jink: no evasion (they are big, steady targets for flak)
  const traits: string[] = [...c.traits, ...m.traits].filter((t) => t !== 'evasive' || m.kind !== 'air' || size < 4);
  let rangeMult = 1;
  if (traits.includes('rangeBoost')) rangeMult += 0.2;
  if (traits.includes('fortified')) rangeMult += 0.15;
  const stack = stackedBonuses(mods);
  rangeMult += stack.range;
  let spreadMult = (traits.includes('stable') ? 0.5 : 1) * (1 - stack.spreadCut);
  const speedBonus = stack.speed;
  const fireRate = Math.max(0.3, 1 + stack.fireRate);
  const tune = tuneOf(mods);
  for (const mod of mods) {
    hp += mod.hp ?? 0;
    armor += mod.armor ?? 0;
    weight += mod.weight;
    partsCost += mod.cost;
    shield += mod.shield ?? 0;
    heal += mod.heal ?? 0;
    dps += weaponDps(tunedWeapon(mod, tune));
    if (mod.cloak && !traits.includes(mod.cloak)) traits.push(mod.cloak);
    if (mod.hardened && !traits.includes('hardened')) traits.push('hardened');
  }
  // trade-off frames: a reinforced frame adds hull, a light frame sheds weight (and hull)
  if (tune.hp) hp *= Math.max(0.3, 1 + tune.hp);
  if (tune.weight) weight *= Math.max(0.3, 1 + tune.weight);
  const capacity = m.capacity[size - 1] || 1;
  const load = weight / capacity;
  let range = 0;
  for (const mod of mods) if (mod.range && mod.kind === 'weapon') range = Math.max(range, mod.projectile === 'melee' ? mod.range : mod.range * rangeMult);
  // jets barely slow with size up to a strato bomber (it cruises nearly as fast as a fighter) and shrug off half the
  // overload; the giant and titan bombers are clearly slower (they still outrun anything on the ground)
  const jet = d.mobility === 'jet';
  const sizeSpeed = (jet ? [1, 1, 0.95, 0.8, 0.68] : [1, 0.95, 0.85, 0.75, 0.65])[size - 1];
  const loadF = jet && load > 1 ? Math.max(0.5, 1 - (load - 1) * 0.6) : loadSpeedFactor(load);
  // swift frames: +20% move speed
  const speed = m.kind === 'static' ? 0 : m.speed * loadF * sizeSpeed * (1 + speedBonus) * (c.traits.includes('swift') ? 1.2 : 1);
  // body turn rate: mobility base x hull agility x size inertia, slowed when overloaded (heavier armament = slower)
  const sizeTurn = [1, 0.95, 0.85, 0.75, 0.65][size - 1];
  // (jets keep their old curve, only an overload slows the turn: their bombing / strafing runs are tuned to it)
  const turn = m.turn * c.agility * sizeTurn * (jet ? (load > 1 ? Math.max(0.5, 1 - (load - 1)) : 1) : loadTurnFactor(load)) * Math.max(0.3, 1 + (tune.turn ?? 0));
  const flying = m.kind === 'air';
  // backing-up speed factor: omni walkers and flyers have no reverse; ground drives back up at MobilityDef.reverse
  const reverse = flying || traits.includes('omni') ? 1 : m.reverse ?? 1;
  const isStatic = m.kind === 'static';

  // ---- cost model ----
  let offense = 0;
  // mixed-range loadouts: a weapon only fires once the enemy is inside its reach, and fights are mostly fought at
  // the reach of the longest gun, so a short gun next to a much longer one counts for less (engagementShare)
  const longest = Math.max(0, ...mods.filter((w) => w.kind === 'weapon' && !w.heal).map((w) => w.range ?? 0));
  // bomb bays rearm only over the own lines: a jet is back for its next run in seconds, a hovering bomber (rotor / grav
  // lift) crawls home and back between loads, so its bays drop far fewer bombs per fight (HOVER_BOMB_K)
  const bombK = flying && !jet ? HOVER_BOMB_K : 1;
  let splashW = 0, airW = 0, airOnlyW = 0, meleeW = 0, apW = 0, shortW = 0; // offense-weighted weapon traits (team-value features)
  for (const mod of mods) {
    const wv = weaponValue(tunedWeapon(mod, tune), rangeMult) * (mod.spread && spreadMult < 1 ? 1 + 0.15 * (1 - spreadMult) : 1) * engagementShare(mod, longest) * (mod.resupply ? bombK : 1);
    offense += wv;
    if (mod.kind !== 'weapon' || mod.heal) continue;
    splashW += wv * Math.min(2, mod.splash ?? 0);
    if (mod.targetsAir) airW += wv;
    if (mod.targetsAir && !mod.targetsGround) airOnlyW += wv;
    apW += wv * (mod.ap ?? 0);
    if (mod.projectile === 'melee') meleeW += wv;
    if ((mod.range ?? 0) <= HOVER_BRAWL.reach) shortW += wv;
  }
  const weaponW = Math.max(1e-9, offense);
  // utility modules: rate-of-fire boosts multiply offense; ally/defensive effects add value
  offense *= fireRate;
  let reactiveHp = 0;
  const shieldCal = mods.reduce((a, m) => a + (m.shield ?? 0) * cal(m.id), 0) / Math.max(1, shield);
  let ehpMult = 1;
  // [aura balance] support auras: analytic points x coverage x calibration, added to the unit cost below
  const hullR = hullK(size) * Math.sqrt((c.footprint?.[0] ?? size) * (c.footprint?.[1] ?? size));
  let interceptors = 0; // not shared within a squad: every PD shoots down its own projectiles
  let support = traits.includes('repairAura') ? 25 * auraReach(REPAIR_AURA_RANGE, hullR) * cal('repairAura') : 0;
  const copies = new Map<string, number>();
  for (const mod of mods) {
    const u = cal(mod.id); // empirical strength of the utility's effect (1 = analytic value)
    const eh = (mult: number) => 1 + (mult - 1) * u;
    // repeated percentage modules count with the same diminishing returns as in the sim (stackBonus)
    const nth = (k: string) => { const n = copies.get(k) ?? 0; copies.set(k, n + 1); return stackWeight(n); };
    if (mod.reloadBonus) offense *= 1 + 0.25 * u * mod.reloadBonus * nth('reload') * mods.filter((w) => w.magazine).length / Math.max(1, mods.filter((w) => w.kind === 'weapon').length);
    if (mod.shieldAura) support += mod.shieldAura.amount * 0.3 * auraReach(mod.shieldAura.radius, hullR) * (MODULE_CAL[mod.id + 'Aura'] ?? u);
    if (mod.fireRateAura) support += mod.fireRateAura.bonus * 300 * auraReach(mod.fireRateAura.radius, hullR) * u;
    if (mod.detect) support += 12 * auraReach(mod.detect, hullR) * u;
    if (mod.jammer) support += 15 * auraReach(mod.jammer, hullR) * u; // covers its carrier too (counted in the reach)
    if (mod.deathBlast) offense += mod.deathBlast.damage * (mod.deathBlast.friendly ? 0.03 : 0.06) * u; // (one that hurts allies too is worth half)
    if (mod.regen) ehpMult *= eh(1 + mod.regen * 12 * nth('regen'));
    // [aura balance] point defense: worth its intercept rate, whatever the hull (as an ehp multiplier a titan's PD cost ~300 supply)
    if (mod.pointDefense) interceptors += PD_PTS * (0.6 / mod.pointDefense.cooldown) * u;
    if (mod.smoke) ehpMult *= eh(1.12);
    if (mod.reactive) reactiveHp += mod.reactive * 60 * u;
    if (mod.energyResist) ehpMult *= eh(1 + mod.energyResist * 0.4 * nth('eres'));
    if (mod.hardened) ehpMult *= eh(1.08);
    if (mod.cloak === 'stealth') ehpMult *= eh(1.35);
    if (mod.cloak === 'phantom') ehpMult *= eh(1.5);
    // trade-off utilities: conditional gains priced at their typical share of a fight (MODULE_CAL scales each)
    if (mod.berserk) offense *= 1 + 0.45 * mod.berserk.damage * u;
    if (mod.paint) offense *= 1 + 0.9 * mod.paint.bonus * u; // the whole side hits marked targets harder
    if (mod.overcharge) offense *= 1 + 0.15 * mod.overcharge.mult * u;
    if (mod.killRush) offense *= 1 + 0.3 * mod.killRush.fireRate * u;
    if (mod.cloakDamage) offense *= 1 - 0.5 * mod.cloakDamage;
    if (mod.overheat) ehpMult *= Math.max(0.5, 1 - mod.overheat * 15);
    // small-hull utilities: their value tracks what makes them good (light fast hulls, numbers, small hits)
    if (mod.dodge) ehpMult *= 1 + dodgeChance(mod.dodge, size, speed) * (0.7 + 0.4 * (mod.dodgeBullets ?? 0)) * u; // bullets: ~40% of the hits a light hull takes
    if (mod.deflect) ehpMult *= 1 + mod.deflect * 0.03 * u; // most of the hits a unit takes are small ones
    if (mod.pack) offense *= 1 + Math.min(mod.pack.cap, mod.pack.per * (size === 1 ? 4 : size === 2 ? 1.5 : 0.5)) * 0.6 * u; // same-design neighbours: light squads run in packs
    if (mod.deathBlast?.stun) offense += mod.deathBlast.stun * 25 * u;
    if (mod.deathBlast?.slow) offense += mod.deathBlast.slow * 15 * u;
    // pure tuning (range, damage, hull...) is priced through the tuned stats above; its MODULE_CAL is a lever on top
    if (mod.tune && !mod.berserk && !mod.paint) offense *= 1 + (u - 1) * 0.3;
  }
  offense = Math.max(offense, 5);
  // shields soak hits at full strength (armour doesn't help them); armour multiplies only the hull's worth
  // raw toughness (hull, armour, shields): what the toughness floor (TOUGH) prices
  const hullEhp = (hp + reactiveHp) * (1 + armor / 15) * armorConvexF(armor) + 1.2 * shield * shieldCal;
  let ehp = hullEhp * ehpMult;
  if (traits.includes('evasive')) ehp *= 1.15;
  // floating over the ground: no burning ground, no crush, half damage from ground-burst splash
  if (traits.includes('hover')) ehp *= HOVER_EHP;
  if (flying) ehp *= 1.2; // only anti-air can answer it
  // long reach shelters a fragile hull: artillery behind a front line is rarely shot, so a paper-thin carriage with a
  // mortar is priced as if it were at least moderately tough (sturdy hulls are already above the floor: no change)
  ehp = Math.max(ehp, SHELTER_EHP * Math.min(1, Math.max(0, (range - SHELTER_FROM) / SHELTER_SPAN)));
  // speed is worth less on a drive that crawls in reverse (kiting backs away from the enemy); walking any way at full
  // speed is worth a little on top (strafing / kiting without turning)
  const mobilityF = isStatic ? 0.85 : 1 + 0.08 * speed * (1 - REVERSE_W * (1 - reverse)) + (traits.includes('leap') ? 0.05 : 0) + (traits.includes('omni') ? OMNI_F : 0);
  const power = Math.sqrt(offense * ehp) * mobilityF;
  const brawlK = traits.includes('hover') ? 1 + HOVER_BRAWL.k * (shortW / weaponW) : 1;
  const classK = (SIZE_K[size - 1] ?? 1) * ((jet ? GIANT_JET_CAL[size] : undefined) ?? MOBILITY_CAL[d.mobility] ?? 1) * (SMALL_AIR_CAL[d.mobility]?.[size - 1] ?? 1) * brawlK;
  const rawBase = Math.max(10, (PARTS_WEIGHT * partsCost + POWER_K * power) * classK);
  // team value (see TEAM_FIT): features from the analytic numbers, then the monotone floor over every sub-design
  const u0 = rawBase / PRICE_DIV;
  const features: Record<TeamFeature, number> = {
    tough: Math.log(ehp / u0), dps: Math.log(offense / u0), wall: Math.max(0, Math.log(ehp / offense) - 4), armorBlock: armorBlock(armor),
    range: Math.log(Math.max(1, range) / RANGE_REF), splash: splashW / weaponW, aa: airW / weaponW, airOnly: airOnlyW / weaponW, ap: apW / weaponW,
    speed: speed / 3, flying: flying ? 1 : 0, light: size === 1 ? 1 : 0, big: size >= 4 ? 1 : 0,
    melee: meleeW / weaponW, support: 0,
  };
  const supportRaw = SUPPORT_K * (support + interceptors);
  features.support = supportRaw / (supportRaw + rawBase);
  const teamMult = analytic || !TEAM_VALUE.on ? 1 : teamMultiplier(features);
  // toughness floor (TOUGH): what the bare hull's analytic price falls short of F(ehp)
  let toughRaw = 0;
  if (!analytic && TOUGH.a > 0 && hullEhp > TOUGH.t0 * 1000) {
    const bare = bareRawOf(d);
    toughRaw = Math.max(0, PRICE_DIV * TOUGH.a * (hullEhp / 1000 - TOUGH.t0) ** TOUGH.g - (bare + TOUGH.w * Math.max(0, rawBase - bare)));
  }
  let base = rawBase * teamMult + toughRaw;
  if (!analytic) for (let i = 0; i < d.mounts.length; i++) {
    if (!d.mounts[i]) continue;
    const sub = { ...d, mounts: d.mounts.map((x, j) => (j === i ? null : x)) };
    base = Math.max(base, teamBaseOf(sub));
  }
  const teamBase = base;
  const extraFor = (sq: number) => SUPPORT_K * (support * auraSquadShare(sq) + interceptors);
  // the squad tier comes from the ANALYTIC unit price: the team-value correction changes what a block costs, not how
  // many units it holds (squads, block footprints and every board stay as they were; squadK isn't compounded with it)
  const unitRaw = (sq: number) => rawBase * squadK(size, sq) + extraFor(sq);
  const squad = forceSquad && SQUAD_TIERS[size] ? forceSquad : squadFor(size, (sq) => unitRaw(sq) / PRICE_DIV);
  const extra = extraFor(squad);
  base *= squadK(size, squad);
  // the block price is the only rounded number: every per-unit figure below is derived from it or sums to it
  const cost = roundCost((base + extra) * squad);
  // the team correction scales the parts and power rows alike (base / rawBase), so the breakdown still adds up
  const priceParts = Math.min(base, PARTS_WEIGHT * partsCost * classK * (teamBase / rawBase)) / PRICE_DIV;

  return {
    size, fw: c.footprint?.[0] ?? size, fh: c.footprint?.[1] ?? size, hp: Math.round(hp), armor, weight: Math.round(weight * 10) / 10, capacity, load,
    speed: Math.round(speed * 100) / 100, turn, reverse, cost, unitCost: cost / squad, squad,
    priceParts, pricePower: base / PRICE_DIV - priceParts, priceSupport: extra / PRICE_DIV,
    flying, isStatic, range: Math.round(range * 10) / 10,
    dps: Math.round(dps), shield, heal, traits, rangeMult, spreadMult, tune,
    partsCost, offense: Math.round(offense), ehp: Math.round(ehp), power: Math.round(power),
    teamMult: teamBase / rawBase, teamFeatures: features, toughTax: toughRaw / PRICE_DIV, _teamBase: teamBase, _rawBase: rawBase,
  };
}

/** fastest turret traverse (rad/s): 300 deg/s */
const MAX_TRAVERSE = (300 * Math.PI) / 180;
const VISUAL_TRAVERSE: Partial<Record<string, number>> = {
  gatling: 1.1, shotgun: 1.2, sniper: 0.6, rail: 0.7, gauss: 0.7, cannon: 0.8, artillery: 0.5, mortar: 0.8, flak: 1.3,
  missileRack: 1.4, cruise: 0.6, rocketPod: 1.1, laser: 1.2, heatray: 1.0, plasma: 0.9, flamer: 1.2, tesla: 1.5, emp: 1.1,
  slowbeam: 1.1, sonic: 1.1, gravity: 0.9, repair: 1.4,
  saw: 1.4, chainsaw: 1.4, hammer: 1.1, claw: 1.4, blade: 1.5, drill: 1.2, prod: 1.5, ram: 1.0,
};
/** Turret traverse speed (rad/s) of a module: explicit turretTurn, else mount-class base x weapon-type factor. */
export function turretTurnRate(mod: ModuleDef): number {
  if (mod.turretTurn != null) return mod.turretTurn;
  // heavier turrets swing slower: 300 deg/s at 1.5 weight, falling with weight^0.45; x the turret-style factor;
  // never above MAX_TRAVERSE (a light missile rack spun at 560 deg/s before this was weight-based)
  const base = MAX_TRAVERSE * Math.min(1, (1.5 / Math.max(0.5, mod.weight)) ** 0.45);
  return Math.min(MAX_TRAVERSE, base * (VISUAL_TRAVERSE[mod.visual] ?? 1));
}

/** Round a supply cost to a friendly number: nearest 50 (min 50). */
/** Player-facing prices are the model's raw cost / PRICE_DIV (raw numbers ran past 10 000; now the biggest titans are ~2000). */
export const PRICE_DIV = 5;
/** Round a raw model cost to a supply price. */
export function roundCost(raw: number): number {
  return roundPrice(raw / PRICE_DIV);
}
/** Display text of a per-unit price share (UnitStats.unitCost, = block price / squad): one decimal below 1000, so that
 *  "≈N each × squad" multiplies back to the block price. */
export function fmtUnitPrice(v: number): string {
  if (Number.isInteger(v) || v >= 1000) return String(Math.round(v));
  return v.toFixed(1).replace(/\.0$/, '');
}
/** Round an already-scaled supply amount: nearest 10 below 1000, nearest 50 above. */
export function roundPrice(v: number): number {
  return v < 1000 ? Math.max(10, Math.round(v / 10) * 10) : Math.round(v / 50) * 50;
}

/** Level multiplier for hp and damage. */
export const levelMult = (level: number) => 1 + LEVEL_BONUS * (Math.max(1, Math.min(MAX_LEVEL, level)) - 1);

/** Why module `mod` can't go in slot `i` of chassis `c` with mobility `mobilityId` (null = legal). Single source of truth
 *  for validateDesign, the garage (socket highlighting, drop messages) and the AI. */
export function slotError(c: ChassisDef, mobilityId: string | null | undefined, i: number, mod: ModuleDef): string | null {
  if (!fitsMount(c.mounts[i], mod.mount)) return `${mod.name} (${mod.mount}) doesn't fit a ${c.mounts[i]} mount`;
  const flies = mobilityId ? MOBILITY_BY_ID.get(mobilityId)?.kind === 'air' : (c.domain ?? 'ground') !== 'ground';
  if (mod.category === 'melee') {
    if (flies || (c.domain ?? 'ground') !== 'ground') return `${mod.name} can't go on aircraft: melee weapons can only go on ground units`;
    if (!meleeSlots(c)[i]) return `${mod.name} can't fit in mount ${i + 1}: melee weapons need a mount near the edge of the chassis`;
  }
  if (mod.requires === 'air' && !flies) return `${mod.name} can only be mounted on flying designs`;
  if (mod.requires === 'ground' && flies) return `${mod.name} can't be mounted on flying designs`;
  return null;
}

/** Returns a list of problems; empty means the design is legal. */
/** `allowRetired`: accept retired parts (the Anchor Mount); only the sim does, so old records and tests still run. */
export function validateDesign(d: Design, allowRetired = false): string[] {
  const errs: string[] = [];
  if (!d || typeof d !== 'object') return ['Not a design'];
  if (typeof d.id !== 'string' || !d.id || d.id.length > 40) errs.push('Bad id');
  if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 24) errs.push('Name must be 1-24 characters');
  const pe = pairingError(d.chassis, d.mobility);
  if (pe) { errs.push(pe); return errs; }
  if (!allowRetired && MOBILITY_BY_ID.get(d.mobility)?.retired) { errs.push(`${MOBILITY_BY_ID.get(d.mobility)!.name} is no longer available`); return errs; }
  const c = CHASSIS_BY_ID.get(d.chassis)!;
  if (!Array.isArray(d.mounts) || d.mounts.length !== c.mounts.length) { errs.push('Mount count mismatch'); return errs; }
  let weapons = 0;
  d.mounts.forEach((id, i) => {
    if (id == null) return;
    const mod = MODULE_BY_ID.get(id);
    if (!mod) { errs.push(`Unknown module ${id}`); return; }
    if (mod.retired && !allowRetired) errs.push(`${mod.name} is no longer available`);
    const why = slotError(c, d.mobility, i, mod);
    if (why) errs.push(why);
    if (mod.kind === 'weapon' || mod.kind === 'utility') weapons++;
  });
  if (weapons === 0) errs.push('Needs at least one weapon or utility module');
  const nw = weaponCount(d), cap = weaponCap(c);
  if (nw > cap) errs.push(`Too many weapons: ${nw}/${cap}. This hull carries at most ${cap} weapons; use the other sockets for utilities.`);
  if (errs.length) return errs;
  const s = computeStats(d);
  if (s.load > MAX_LOAD) errs.push(`Overloaded: ${s.weight} / ${s.capacity} weight (max ${Math.round(MAX_LOAD * 100)}%)`);
  return errs;
}

export const isValidDesign = (d: Design) => validateDesign(d, true).length === 0;

/** Swap retired modules (ModuleDef.retired) in place for their replacement (ModuleDef.replacedBy) where it fits the
 *  socket, else empty the socket. Returns the ids replaced or removed. Used to repair saved designs, match decks
 *  (rules 7) and AI-pool entries. */
export function replaceRetiredModules(d: Design): string[] {
  const c = CHASSIS_BY_ID.get(d.chassis);
  if (!c || !Array.isArray(d.mounts)) return [];
  const out: string[] = [];
  d.mounts.forEach((id, i) => {
    const mod = id ? MODULE_BY_ID.get(id) : undefined;
    if (!mod?.retired) return;
    out.push(mod.id);
    const rep = mod.replacedBy ? MODULE_BY_ID.get(mod.replacedBy) : undefined;
    d.mounts[i] = rep && !rep.retired && !slotError(c, d.mobility, i, rep) ? rep.id : null;
  });
  return out;
}

/** Evasion thrusters' dodge chance on a hull: full on a light hull at 2.5 cells/s, less on bigger or slower ones
 *  (titans get almost nothing). */
export function dodgeChance(base: number, size: number, speed: number): number {
  const sizeF = [1, 0.65, 0.35, 0.12, 0.04][size - 1] ?? 0.04;
  return Math.min(0.6, base * sizeF * Math.min(1.5, speed / 2.5));
}

/** Weapon modules (kind 'weapon': guns, launchers, bomb bays, melee) a design carries; repair beams are utilities. */
export function weaponCount(d: Pick<Design, 'mounts'>): number {
  return (d.mounts ?? []).filter((id) => id && MODULE_BY_ID.get(id)?.kind === 'weapon').length;
}
/** Enforce the hull's weapon cap in place: the lowest-value weapons beyond it (weaponValue, i.e. what they add to the
 *  price) leave their sockets. Returns the ids removed (empty when the design was within the cap or the hull is unknown).
 *  Used to repair saved designs, match decks (rules 7) and AI-pool entries. */
export function dropExtraWeapons(d: Design): string[] {
  const c = CHASSIS_BY_ID.get(d.chassis);
  if (!c || !Array.isArray(d.mounts)) return [];
  const ws = d.mounts.map((id, i) => ({ i, m: id ? MODULE_BY_ID.get(id) : undefined })).filter((x) => x.m?.kind === 'weapon');
  const over = ws.length - weaponCap(c);
  if (over <= 0) return [];
  const worth = (m: ModuleDef) => { try { return weaponValue(m); } catch { return 0; } };
  ws.sort((a, b) => worth(a.m!) - worth(b.m!) || b.i - a.i);
  const out: string[] = [];
  for (const x of ws.slice(0, over)) { out.push(d.mounts[x.i]!); d.mounts[x.i] = null; }
  return out;
}

/** Units bought per block of a design (computeStats().squad; 1 for a design that can't be priced). */
export function squadOf(d: Design): number {
  try { return computeStats(d).squad; } catch { return 1; }
}

/** Effective range (cells, after range bonuses) a kiting-by-default design's main guns must reach: clearly past the
 *  typical frontline guns (autocannons 7.5, cannons 9) so kiting actually keeps it out of their reach. */
export const DEFAULT_KITE_RANGE = 10;
/** Shortest effective range at which focus fire is on by default (shotguns / flamers / sonic stay off). */
export const DEFAULT_FOCUS_RANGE = 5;

/** Air roles: what a flying design is for, decided by its drive and loadout (shared by the sim's air AI and the UI).
 *  - bomber:   carries bomb bays; flies at the most valuable ground targets, rearms at home between runs
 *  - fighter:  air superiority; hunts enemy aircraft first, strafes ground units only when the sky is clear
 *  - harasser: fast jet with ground guns/rockets; raids artillery and support behind the enemy line
 *  - gunship:  hovering rotor / grav-lift gun platform; hangs over the ground fight and keeps firing */
export type AirRole = 'bomber' | 'fighter' | 'harasser' | 'gunship';
export const AIR_ROLE_INFO: Record<AirRole, { label: string; desc: string }> = {
  bomber: { label: 'Bomber', desc: 'Flies at the most valuable ground targets, drops its bombs, and flies home to rearm between runs.' },
  fighter: { label: 'Fighter', desc: 'Air superiority: hunts enemy aircraft first and strafes ground units only when the sky is clear.' },
  harasser: { label: 'Harasser', desc: 'Fast raider: goes for artillery, support and other soft targets behind the enemy line.' },
  gunship: { label: 'Gunship', desc: 'Hovers over the ground fight and keeps its guns firing on the nearest targets.' },
};
const airRoleCache = new Map<string, AirRole | null>();
/** Air role of a design, or null for ground / static designs. */
export function airRole(d: Design): AirRole | null {
  const key = `${d.chassis}|${d.mobility}|${d.mounts.join(',')}`;
  if (airRoleCache.has(key)) return airRoleCache.get(key)!;
  let out: AirRole | null = null;
  try {
    const st = computeStats(d);
    if (st.flying) {
      const mods = designModules(d).filter((m) => m.kind === 'weapon');
      if (mods.some((m) => m.resupply)) out = 'bomber';
      else if (d.mobility !== 'jet') out = 'gunship';
      else {
        let total = 0, aa = 0;
        for (const m of mods) {
          const v = weaponDps(m);
          total += v;
          if (m.targetsAir && (m.targetsGround === false || (m.airBonus ?? 1) > 1)) aa += v;
        }
        out = d.chassis === 'interceptor' || (total > 0 && aa >= 0.4 * total) ? 'fighter' : 'harasser';
      }
    }
  } catch { /* unknown parts */ }
  airRoleCache.set(key, out);
  return out;
}

/** A jet carrying at least this share of its ground-weapon dps in standoff guns (a minimum range, or a reach of
 *  STANDOFF_REACH cells or more) circles its target at standoff range instead of making strafing passes. */
export const STANDOFF_SHARE = 0.5;
export const STANDOFF_REACH = 12;
/** Orbit radius as a share of the standoff guns' reach (sim: never tighter than the jet's turn or the guns' minimum) */
export const STANDOFF_ORBIT = 0.75;
const standoffCache = new Map<string, { range: number; minRange: number } | null>();
/** Standoff guns of a jet design (harassers only: bombers keep their bomb runs, fighters their dogfights): the reach
 *  (effective range, cells) that covers at least half their dps, and the largest minimum range among the guns with
 *  that reach. null: not a standoff jet (it strafes). The sim turns this into an orbit (see Battle.strafeMove). */
export function jetStandoff(d: Design): { range: number; minRange: number } | null {
  const key = `${d.chassis}|${d.mobility}|${d.mounts.join(',')}`;
  if (standoffCache.has(key)) return standoffCache.get(key)!;
  let out: { range: number; minRange: number } | null = null;
  try {
    if (d.mobility === 'jet' && airRole(d) === 'harasser') {
      const s = computeStats(d);
      const ws = designModules(d).filter((m) => m.kind === 'weapon' && !m.heal && m.targetsGround !== false && m.projectile !== 'melee');
      const total = ws.reduce((a, m) => a + weaponDps(m), 0);
      const far = ws.filter((m) => (m.minRange ?? 0) > 0 || (m.range ?? 0) * s.rangeMult >= STANDOFF_REACH).sort((a, b) => (b.range ?? 0) - (a.range ?? 0));
      const farDps = far.reduce((a, m) => a + weaponDps(m), 0);
      if (total > 0 && farDps >= STANDOFF_SHARE * total) {
        let acc = 0, range = 0;
        for (const m of far) { acc += weaponDps(m); range = (m.range ?? 0) * s.rangeMult; if (acc >= 0.5 * farDps) break; }
        const minRange = Math.max(0, ...far.filter((m) => (m.range ?? 0) * s.rangeMult >= range).map((m) => m.minRange ?? 0));
        out = { range, minRange };
      }
    }
  } catch { /* unknown parts */ }
  standoffCache.set(key, out);
  return out;
}

/** Orbit radius (cells) a standoff jet circles its ground goal at (0: it strafes after all): STANDOFF_ORBIT of the
 *  guns' reach, clear of their minimum range plus half the jet's turning circle, never tighter than it can turn
 *  (1.25 x speed / turn, at least 2.5); a jet that would have to circle beyond 90% of the reach keeps strafing.
 *  `speed` / `turn` default to the design's stats (the sim passes its own, identical numbers). */
export function standoffOrbit(d: Design, speed?: number, turn?: number): number {
  const so = jetStandoff(d);
  if (!so) return 0;
  if (speed === undefined || turn === undefined) { const s = computeStats(d); speed = s.speed; turn = s.turn; }
  const turnR = Math.max(2.5, (1.25 * speed) / Math.max(0.5, turn));
  const R = Math.max(STANDOFF_ORBIT * so.range, so.minRange + 0.5 * turnR + 1, turnR);
  return R <= 0.9 * so.range ? R : 0;
}

export interface DefaultOrders { kite: boolean; focus: boolean }
const defaultOrdersCache = new Map<string, DefaultOrders>();

/** Battle orders a design gets when its placement (and Design.behavior) leave them unset. Shared by the sim, client
 *  and AI so all agree; an explicit true/false on a placement always wins.
 *  - kite: mobile ground units (not static, not flying, not giant/titan hulls, which are the front line), no melee
 *    weapons, whose long guns (effective range >= DEFAULT_KITE_RANGE) carry at least half the design's weapon dps:
 *    artillery, snipers, missile carriers, long-range skirmishers. Not brawlers, flamers, or tanks whose main guns
 *    are frontline-range.
 *  - focus: any design with a ranged weapon of effective range >= DEFAULT_FOCUS_RANGE. */
export function defaultOrders(d: Design | undefined): DefaultOrders {
  if (!d || !Array.isArray(d.mounts)) return { kite: false, focus: false };
  const key = `${d.chassis}|${d.mobility}|${d.mounts.join(',')}`;
  const hit = defaultOrdersCache.get(key);
  if (hit) return hit;
  let out: DefaultOrders = { kite: false, focus: false };
  try {
    const s = computeStats(d);
    let melee = false, total = 0, longDps = 0, longest = 0;
    for (const m of designModules(d)) {
      if (m.kind !== 'weapon') continue;
      const dps = weaponDps(m);
      total += dps;
      if (m.projectile === 'melee') { melee = true; continue; }
      const r = (m.range ?? 0) * s.rangeMult;
      longest = Math.max(longest, r);
      if (r >= DEFAULT_KITE_RANGE) longDps += dps;
    }
    out = {
      kite: !s.isStatic && !s.flying && s.size < 4 && !melee && longDps > 0 && longDps >= 0.5 * total,
      focus: longest >= DEFAULT_FOCUS_RANGE,
    };
  } catch { /* unknown parts: no defaults */ }
  defaultOrdersCache.set(key, out);
  return out;
}
