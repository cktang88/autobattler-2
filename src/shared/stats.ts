// Design -> UnitStats, plus design validation.

import { CHASSIS_BY_ID, MOBILITY_BY_ID, MODULE_BY_ID, fitsMount, moduleTier, pairingError } from './parts.ts';
import { hullK, meleeSlots } from './mountgeo.ts';
import { REPAIR_AURA_RANGE } from './types.ts';
import type { ChassisDef, Design, ModuleDef, UnitStats } from './types.ts';

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

/** Percentage modules stack with diminishing returns: the strongest copy counts fully, the 2nd at 80%, the 3rd at
 *  60%, then 40%, 20% (two targeting computers: +15% + 12% range, not +30%). */
export const STACK_WEIGHTS = [1, 0.8, 0.6, 0.4, 0.2];
export const stackWeight = (i: number) => STACK_WEIGHTS[i] ?? 0;
export function stackBonus(vals: number[]): number {
  return [...vals].filter((v) => v > 0).sort((a, b) => b - a).reduce((t, v, i) => t + v * stackWeight(i), 0);
}
/** most energy damage one unit can shrug off however many mirror coatings it carries */
export const MAX_ENERGY_RESIST = 0.75;
/** Every percentage bonus of a loadout, stacked (shared by the price model and the sim so they agree). */
export function stackedBonuses(mods: ModuleDef[]): { range: number; spreadCut: number; speed: number; fireRate: number; reload: number; energyResist: number; regen: number } {
  const pick = (f: (m: ModuleDef) => number | undefined) => stackBonus(mods.map((m) => f(m) ?? 0));
  return {
    range: pick((m) => m.rangeBonus),
    spreadCut: pick((m) => (m.spreadMult ? 1 - m.spreadMult : 0)),
    speed: pick((m) => m.speedBonus),
    fireRate: pick((m) => m.fireRateBonus),
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
export const SIZE_K: number[] = [0.85, 1.11, 1.19, 1.37, 1.34];
/** Per-mobility price factor on the whole unit cost (fitted with scripts/fit_cal.py on plain frames; 1 = analytic).
 *  Soaks up what the analytic mobility term cannot see: how well a drive keeps a hull in the fight (leapers waste
 *  time, anchors and big tracks never leave the front, flyers dodge half the field). */
export const MOBILITY_CAL: Record<string, number> = { anchor: 0.97, gravlift: 1.45, halftrack: 1.17, hover: 0.98, jet: 0.7, jumpjets: 0.93, legs: 1.01, megatracks: 1.14, rotor: 1.18, spider: 1.12, titanlegs: 1.09, treads: 1.14, wheels: 0.96 };
/** Jet price factor for giant / titan airframes, in place of MOBILITY_CAL.jet (fitted on fighters and the strato
 *  bomber, which dodge and slip through the AA): the giant and titan bombers don't jink (no evasion), turn wide and
 *  are big targets, but still fly their runs over everything on the ground. Fitted with `node scripts/op-check.ts`
 *  (one or two of them plus a starter mix vs the mix, ~2x their price per side) and `node scripts/role-check.ts bomber`. */
export const GIANT_JET_CAL: Record<number, number> = { 4: 1.05, 5: 1.17 };
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
export function damageKinds(mod: Pick<ModuleDef, 'projectile' | 'category'>): DamageKind[] {
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
 *  this went from 0.25 to 0.04 per second of flight, keeping every price unchanged. */
export function hitFactor(w: ModuleDef): number {
  const p = w.projectile;
  if (p === 'beam' || p === 'lightning' || p === 'rail' || p === 'melee' || (p === 'missile' && !w.spread)) return 1;
  const spread = (w.spread ?? 0) * 0.7;
  const flight = w.projectileSpeed ? (w.range ?? 5) / w.projectileSpeed : 0;
  const target = 0.45 + 0.6 * (w.splash ?? 0);
  return target / (target + spread + 0.04 * flight) / 0.7;
}

/** Empirical calibration, fitted with `node scripts/balance.ts` (equal-supply armies of every module vs a reference
 *  field). The analytic terms above give each module a first-order value; sim effects they cannot see (target
 *  drift, overkill, focus fire, how often a stun/aura/cloak really matters in a big fight) are folded into one
 *  multiplier per module id. Weapons: multiplies weaponValue. Utilities: scales the strength of the effect terms
 *  in computeStats (1 = analytic value; low values mean the effect is worth little in mass battles). Re-fit after
 *  changing the sim or the part numbers. */
export const MODULE_CAL: Record<string, number> = {
  leech: 1.16, prism: 5.18, voidlance: 1.49, entropy: 1,
  aamissile: 1.26, ac20: 2.83, ac40: 5.01, aegisT: 1.10, annihilator: 2.22, arclance: 2.95, atgm: 8.11,
  autocannon: 2.29, autoloader: 2.89, avenger: 3.10, barrage: 8.26, bombs: 8.69, bulwarkshield: 1.48, buzzsaw: 0.27,
  cannon: 0.88, cannon75: 1.49, chainsaw: 0.60, claw: 0.56, clusterbombs: 14.00, heavybomb: 6.05, cruise: 7.74, disarm: 0.416,
  dome: 1.0, domeG: 1.0, doomsday: 4.66, drill: 0.81, empcannon: 0.53, flak: 0.31, flamer: 0.61, gauss: 4.58,
  gravity: 3.14, grinder: 3.99, guidedrocket: 3.35, gyro: 0.11, hammer: 1.46, hardened: 0.10, heatray: 1.32,
  heavyflak: 1.19, hmg: 1.67, howitzer: 22.16, incendiary: 0.35, inferno: 0.4, jammer: 0.25, laser: 2.3,
  lightrail: 12, massdriver: 0.75, mg: 3, minigun: 0.80, mirror: 0.50, missilebattery: 4.99, mlrs: 6.73,
  mortar: 10.84, nanite: 0.14, napalm: 0.12, overclock: 0.21, phantom: 0.16, plasma: 3.4, plasmablade: 0.69,
  plasmaorb: 0.868, pointdef: 4.00, quad20: 0.66, railgun: 20, ram: 0.86, reactive: 0.78, repair: 12.45,
  repairM: 4.00, rocketL: 1.16, rockets: 1.67, sam: 4.55, selfdestruct: 0.14, sensor: 1.0, shield: 0.81,
  shieldH: 1.05, shieldL: 1.32, shockprod: 0.52, shotgun: 1, siege240: 1.53, siegeplasma: 0.85, skyfortress: 0.62,
  slowbeam: 4.95, smoke: 4.00, sniper: 16.11, sonic: 0.38, stealth: 0.44, stormcore: 0.91, stormtower: 2.55,
  stungun: 0.705, swarm: 3, tactnuke: 3.2, targeting: 4.00, tesla: 0.534, titanfist: 1.8, turbo: 0.14,
  twin120: 1.05, twin30: 1.99, twinlaser: 2.23, twinmg: 0.811, uplink: 0.34,
  clusterhow: 3.48, firebomb: 2.27, flechette: 7.48, grenade: 2.46,
  // [aura balance] aura strengths (uplink, dome, domeG, jammer, sensor above and these two) were set by hand after the
  // radius rework: `node scripts/balance.ts army 3 <id>` (every unit carries the aura -> heavy overlap) lands at a
  // delta of -7..+2, i.e. a little overpriced when massed, and `node scripts/auras.ts field` (ONE carrier escorting a
  // block, no overlap) at roughly even vs the same supply of guns. fit_cal.py holds them fixed (non-stacking makes
  // its all-carrier gradient drift them toward zero). aegisTAura prices the Aegis Field's projected shield only.
  aegisTAura: 1.5, repairAura: 1.5,
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
  v *= 1 + 0.6 * (w.splash ?? 0);
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
  if (w.minRange) v *= 0.9;
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

/** Monotone price floor: price(design) >= price(design minus any module), so adding a weapon (or any part) never
 *  makes a design cheaper. Memoised per chassis / drive / module multiset (mount order doesn't change the price). */
const teamBaseCache = new Map<string, number>();
const priceKey = (d: Design) => `${d.chassis}|${d.mobility}|${d.mounts.filter((x) => x).sort().join(',')}`;
/** Forget memoised prices (scripts that change the price constants at run time call this). */
export function clearPriceCache(): void { teamBaseCache.clear(); }
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
  const { _teamBase, ...s } = statsFor(d);
  void _teamBase;
  return s;
}

/** Stats of a light / medium design forced into a `squad`-unit block (legacy pricing for rules migrations / analysis
 *  scripts); the game itself always lets squadFor decide. */
export function statsWithSquad(d: Design, squad: number): UnitStats {
  const { _teamBase, ...s } = statsFor(d, squad);
  void _teamBase;
  return s;
}

/** Stats under the analytic price alone (no team-value correction, no monotone floor): the rules-4 prices, for the
 *  rules-5 migration (match.ts) and analysis scripts. */
export function analyticStats(d: Design): UnitStats {
  const { _teamBase, ...s } = statsFor(d, undefined, true);
  void _teamBase;
  return s;
}

function statsFor(d: Design, forceSquad?: number, analytic = false): UnitStats & { _teamBase: number } {
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
  const fireRate = 1 + stack.fireRate;
  for (const mod of mods) {
    hp += mod.hp ?? 0;
    armor += mod.armor ?? 0;
    weight += mod.weight;
    partsCost += mod.cost;
    shield += mod.shield ?? 0;
    heal += mod.heal ?? 0;
    dps += weaponDps(mod);
    if (mod.cloak && !traits.includes(mod.cloak)) traits.push(mod.cloak);
    if (mod.hardened && !traits.includes('hardened')) traits.push('hardened');
  }
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
  const turn = m.turn * c.agility * sizeTurn * (load > 1 ? Math.max(0.5, 1 - (load - 1)) : 1);
  const flying = m.kind === 'air';
  const isStatic = m.kind === 'static';

  // ---- cost model ----
  let offense = 0;
  // mixed-range loadouts: a weapon only fires once the enemy is inside its reach, and fights are mostly fought at
  // the reach of the longest gun, so a short gun next to a much longer one counts for less (engagementShare)
  const longest = Math.max(0, ...mods.filter((w) => w.kind === 'weapon' && !w.heal).map((w) => w.range ?? 0));
  // bomb bays rearm only over the own lines: a jet is back for its next run in seconds, a hovering bomber (rotor / grav
  // lift) crawls home and back between loads, so its bays drop far fewer bombs per fight (HOVER_BOMB_K)
  const bombK = flying && !jet ? HOVER_BOMB_K : 1;
  let splashW = 0, airW = 0, airOnlyW = 0, meleeW = 0, apW = 0; // offense-weighted weapon traits (team-value features)
  for (const mod of mods) {
    const wv = weaponValue(mod, rangeMult) * (mod.spread && spreadMult < 1 ? 1 + 0.15 * (1 - spreadMult) : 1) * engagementShare(mod, longest) * (mod.resupply ? bombK : 1);
    offense += wv;
    if (mod.kind !== 'weapon' || mod.heal) continue;
    splashW += wv * Math.min(2, mod.splash ?? 0);
    if (mod.targetsAir) airW += wv;
    if (mod.targetsAir && !mod.targetsGround) airOnlyW += wv;
    apW += wv * (mod.ap ?? 0);
    if (mod.projectile === 'melee') meleeW += wv;
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
    if (mod.deathBlast) offense += mod.deathBlast.damage * 0.06 * u;
    if (mod.regen) ehpMult *= eh(1 + mod.regen * 12 * nth('regen'));
    // [aura balance] point defense: worth its intercept rate, whatever the hull (as an ehp multiplier a titan's PD cost ~300 supply)
    if (mod.pointDefense) interceptors += PD_PTS * (0.6 / mod.pointDefense.cooldown) * u;
    if (mod.smoke) ehpMult *= eh(1.12);
    if (mod.reactive) reactiveHp += mod.reactive * 60 * u;
    if (mod.energyResist) ehpMult *= eh(1 + mod.energyResist * 0.4 * nth('eres'));
    if (mod.hardened) ehpMult *= eh(1.08);
    if (mod.cloak === 'stealth') ehpMult *= eh(1.35);
    if (mod.cloak === 'phantom') ehpMult *= eh(1.5);
  }
  offense = Math.max(offense, 5);
  // shields soak hits at full strength (armour doesn't help them); armour multiplies only the hull's worth
  let ehp = ((hp + reactiveHp) * (1 + armor / 15) + 1.2 * shield * shieldCal) * ehpMult;
  if (traits.includes('evasive')) ehp *= 1.15;
  if (flying) ehp *= 1.2; // only anti-air can answer it
  // long reach shelters a fragile hull: artillery behind a front line is rarely shot, so a paper-thin carriage with a
  // mortar is priced as if it were at least moderately tough (sturdy hulls are already above the floor: no change)
  ehp = Math.max(ehp, SHELTER_EHP * Math.min(1, Math.max(0, (range - SHELTER_FROM) / SHELTER_SPAN)));
  const mobilityF = isStatic ? 0.85 : 1 + 0.08 * speed + (traits.includes('leap') ? 0.05 : 0);
  const power = Math.sqrt(offense * ehp) * mobilityF;
  const classK = (SIZE_K[size - 1] ?? 1) * ((jet ? GIANT_JET_CAL[size] : undefined) ?? MOBILITY_CAL[d.mobility] ?? 1);
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
  let base = rawBase * teamMult;
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
    speed: Math.round(speed * 100) / 100, turn, cost, unitCost: cost / squad, squad,
    priceParts, pricePower: base / PRICE_DIV - priceParts, priceSupport: extra / PRICE_DIV,
    flying, isStatic, range: Math.round(range * 10) / 10,
    dps: Math.round(dps), shield, heal, traits, rangeMult, spreadMult,
    partsCost, offense: Math.round(offense), ehp: Math.round(ehp), power: Math.round(power),
    teamMult: teamBase / rawBase, teamFeatures: features, _teamBase: teamBase,
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
    const why = slotError(c, d.mobility, i, mod);
    if (why) errs.push(why);
    if (mod.kind === 'weapon' || mod.kind === 'utility') weapons++;
  });
  if (weapons === 0) errs.push('Needs at least one weapon or utility module');
  if (errs.length) return errs;
  const s = computeStats(d);
  if (s.load > MAX_LOAD) errs.push(`Overloaded: ${s.weight} / ${s.capacity} weight (max ${Math.round(MAX_LOAD * 100)}%)`);
  return errs;
}

export const isValidDesign = (d: Design) => validateDesign(d, true).length === 0;

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
