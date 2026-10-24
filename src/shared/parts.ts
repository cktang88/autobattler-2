// Part catalog: 39 chassis covering every role (light → titan, incl. mechs, spiders and odd frames), 13 mobility systems, 108 modules in 5 mount classes. All parts carry role tags.
// Balance numbers live here; stats.ts turns a Design into UnitStats.

import type { ChassisDef, Domain, MobilityDef, ModuleCategory, ModuleDef, MountClass, Role } from './types.ts';

export const CHASSIS: ChassisDef[] = [
  { id: 'scout', name: 'Scout Frame', desc: 'Tiny, cheap and quick. One light mount.', size: 1, hp: 140, armor: 0, weight: 3, cost: 10, mounts: ['S'], agility: 1.3, roles: ['scout', 'raider'], traits: [], shape: 'wedge' },
  { id: 'drone', name: 'Drone Core', desc: 'Featherweight quad-rotor drone core.', size: 1, hp: 140, armor: 0, weight: 1.5, cost: 10, domain: 'heli', mounts: ['S'], agility: 1.4, roles: ['scout', 'flyer'], traits: ['compact'], shape: 'pod' },
  { id: 'raider', name: 'Raider Frame', desc: 'Light skirmisher with twin light mounts.', size: 1, hp: 210, armor: 2, weight: 5, cost: 75, mounts: ['S', 'S'], agility: 1.15, roles: ['raider'], traits: [], shape: 'box' },
  { id: 'warden', name: 'Warden Hull', desc: 'Sturdy medium hull built to hold a line.', size: 2, hp: 560, armor: 6, weight: 14, cost: 115, mounts: ['M', 'S'], agility: 0.95, roles: ['assault', 'tank'], traits: [], shape: 'hex' },
  { id: 'striker', name: 'Striker Frame', desc: 'Aggressive medium frame with three mounts.', size: 2, hp: 430, armor: 4, weight: 12, cost: 160, footprint: [2, 3], mounts: ['M', 'M', 'S'], agility: 1.0, roles: ['skirmisher', 'assault'], traits: [], shape: 'cross' },
  { id: 'longarm', name: 'Longarm Platform', desc: 'Stabilized platform: one heavy mount, +20% weapon range.', size: 2, hp: 360, armor: 3, weight: 12, cost: 250, footprint: [1, 3], mounts: ['M'], agility: 0.85, roles: ['artillery', 'siege'], traits: ['rangeBoost'], shape: 'long' },
  { id: 'aegis', name: 'Aegis Frame', desc: 'Support frame. Field-repairs allies within 30 m (1.2% hp/s; repair auras don\'t stack).', size: 2, hp: 610, armor: 4, weight: 13, cost: 60, mounts: ['M', 'S'], agility: 0.95, roles: ['support'], traits: ['repairAura'], shape: 'round' },
  { id: 'gunship', name: 'Gunship', desc: 'Attack helicopter airframe with stub-wing mounts.', size: 2, hp: 420, armor: 3, weight: 8, cost: 60, footprint: [2, 3], art: [1.8, 2.7], domain: 'heli', mounts: ['M', 'M'], agility: 1.1, roles: ['flyer'], traits: ['airOnly'], shape: 'airframe' },
  { id: 'bastion', name: 'Bastion Hull', desc: 'Massive armored hull. Slow, nearly unbreakable.', size: 3, hp: 1500, armor: 14, weight: 38, cost: 400, art: [2.65, 2.65], mounts: ['M', 'M', 'M'], agility: 0.8, roles: ['tank', 'assault'], traits: [], shape: 'fortress' },
  { id: 'colossus', name: 'Monarch Frame', desc: 'Walking arsenal with four mounts.', size: 3, hp: 1250, armor: 10, weight: 34, cost: 405, footprint: [3, 4], mounts: ['M', 'M', 'M', 'S'], agility: 0.85, roles: ['assault', 'siege'], traits: [], shape: 'titan' },
  // ---- Odd-shaped frames ----
  { id: 'mantis', name: 'Needle Frame', desc: 'Lanky light strider with twin blade-arm mounts.', size: 1, hp: 150, armor: 1, weight: 4, cost: 120, footprint: [1, 2], mounts: ['S', 'S'], agility: 1.35, mobility: ['legs', 'jumpjets', 'spider', 'hover'], roles: ['raider', 'melee'], traits: [], shape: 'mantis' },
  { id: 'strider', name: 'Strider Mech', desc: 'Humanoid mech: arm guns and a shoulder mount. Needs legs.', size: 2, hp: 480, armor: 5, weight: 12, cost: 140, mounts: ['M', 'S', 'S'], agility: 1.05, mobility: ['legs', 'jumpjets', 'spider', 'anchor'], roles: ['skirmisher'], traits: [], shape: 'mech' },
  { id: 'arachnid', name: 'Orbwalker Core', desc: 'Orb-bodied walker pod with twin dorsal mounts. Walks on multi-legs or jump legs.', size: 2, hp: 420, armor: 4, weight: 11, cost: 190, mounts: ['M', 'M'], agility: 1.1, mobility: ['spider', 'jumpjets', 'anchor'], roles: ['skirmisher', 'raider'], traits: [], shape: 'arachnid' },
  { id: 'crab', name: 'Bunker Crawler', desc: 'Wide, low, heavily plated mobile bunker with arm mounts.', size: 2, hp: 600, armor: 8, weight: 15, cost: 240, footprint: [3, 3], art: [3, 2], mounts: ['M', 'M', 'S'], agility: 0.85, mobility: ['spider', 'halftrack', 'treads', 'hover', 'anchor'], roles: ['riot', 'tank'], traits: [], shape: 'crab' },
  { id: 'saucer', name: 'Saucer Disc', desc: 'Round disc hull with an all-round turret ring. Hovers or walks.', size: 2, hp: 400, armor: 4, weight: 10, cost: 210, art: [1.75, 1.75], mounts: ['M', 'M', 'S'], agility: 1.2, mobility: ['hover', 'anchor', 'spider'], roles: ['skirmisher', 'antiair'], traits: [], shape: 'saucer' },
  { id: 'deltawing', name: 'Delta Wing', desc: 'Triangular strike aircraft. Must fly.', size: 2, hp: 420, armor: 3, weight: 8, cost: 75, footprint: [2, 3], domain: 'jet', mounts: ['M', 'S', 'S'], agility: 1.15, roles: ['flyer', 'bomber'], traits: ['airOnly'], shape: 'delta' },
  { id: 'warlord', name: 'Warlord Mech', desc: 'Heavy humanoid mech with a shoulder cannon and arm weapons.', size: 3, hp: 1350, armor: 11, weight: 34, cost: 430, footprint: [4, 3], mounts: ['M', 'M', 'M', 'S'], agility: 0.9, mobility: ['titanlegs', 'spider', 'anchor'], roles: ['assault'], traits: [], shape: 'warlord' },
  { id: 'scorpion', name: 'Tailgun Crawler', desc: 'Armored crawler with a crane-boom heavy weapon over its back and twin arm mounts.', size: 3, hp: 1200, armor: 12, weight: 32, cost: 260, footprint: [3, 5], art: [3, 4], mounts: ['M', 'M', 'M'], agility: 0.95, mobility: ['spider', 'treads', 'anchor'], roles: ['assault', 'siege'], traits: [], shape: 'scorpion' },
  { id: 'centipede', name: 'Landtrain Hull', desc: 'Articulated multi-car land-train with four medium mounts down its spine.', size: 3, hp: 1300, armor: 9, weight: 33, cost: 525, footprint: [2, 5], art: [2, 4.75], mounts: ['M', 'M', 'M', 'M'], agility: 0.8, mobility: ['spider', 'halftrack', 'treads'], roles: ['riot', 'assault'], traits: [], shape: 'centipede' },
  // ---- Role-specialist frames ----
  { id: 'carriage', name: 'Gun Carriage', desc: 'Light, thin-skinned carriage that holds a medium weapon. Cheap artillery or tank-hunter.', size: 1, hp: 110, armor: 0, weight: 3, cost: 40, mounts: ['M'], agility: 0.9, roles: ['artillery', 'skirmisher'], traits: [], shape: 'carriage' },
  { id: 'hunter', name: 'Hunter Frame', desc: 'Fast, lightly armored skirmisher frame. Strikes from range and keeps moving.', size: 2, hp: 360, armor: 2, weight: 9, cost: 80, footprint: [1, 2], mounts: ['M', 'S'], agility: 1.25, roles: ['skirmisher', 'raider'], traits: [], shape: 'hunter' },
  { id: 'riot', name: 'Riot Frame', desc: 'Sloped front armor and twin medium mounts. Built to wade into swarms.', size: 2, hp: 650, armor: 9, weight: 15, cost: 230, footprint: [3, 2], mounts: ['M', 'M'], agility: 0.9, roles: ['riot', 'tank'], traits: [], shape: 'riot' },
  { id: 'interceptor', name: 'Interceptor', desc: 'Light fighter airframe. Must fly.', size: 1, hp: 120, armor: 1, weight: 1.2, cost: 15, footprint: [1, 2], domain: 'jet', mounts: ['S', 'S'], agility: 1.3, roles: ['antiair', 'flyer', 'raider'], traits: ['airOnly'], shape: 'interceptor' },
  { id: 'siegeplat', name: 'Siege Platform', desc: 'Thin-skinned heavy platform carrying two heavy weapons. Pure artillery: keep it behind the line.', size: 3, hp: 800, armor: 3, weight: 22, cost: 265, footprint: [2, 4], art: [1.7, 4], mounts: ['M', 'M'], agility: 0.7, roles: ['artillery', 'siege'], traits: [], shape: 'siegeplat' },
  { id: 'juggernaut', name: 'Monolith Hull', desc: 'A wall of armor with token weapons. Soaks fire for the army behind it.', size: 3, hp: 2100, armor: 18, weight: 40, cost: 250, footprint: [4, 3], mounts: ['M', 'S'], agility: 0.75, roles: ['tank'], traits: [], shape: 'juggernaut' },
  { id: 'bomberhull', name: 'Heavy Bomber', desc: 'Big flying bomb truck with three medium bays. Grav lifters or nothing.', size: 3, hp: 2200, armor: 7, weight: 24, cost: 200, footprint: [3, 4], domain: 'heli', mounts: ['M', 'M', 'M'], agility: 0.7, roles: ['bomber', 'flyer'], traits: ['airOnly'], shape: 'bomber' },
  // ---- Aircraft ----
  { id: 'strikejet', name: 'Strike Jet', desc: 'Multirole fighter-bomber with a centreline and two wing hardpoints.', size: 2, hp: 330, armor: 2, weight: 7, cost: 80, footprint: [2, 3], mounts: ['M', 'S', 'S'], agility: 1.2, domain: 'jet', roles: ['flyer', 'raider', 'antiair'], traits: [], shape: 'strikejet' },
  { id: 'stratobomber', name: 'Strato Bomber', desc: 'Long-range jet bomber with three bomb bays and a tail gun.', size: 3, hp: 1100, armor: 5, weight: 18, cost: 300, footprint: [4, 4], mounts: ['M', 'M', 'M', 'S'], agility: 0.8, domain: 'jet', roles: ['bomber', 'flyer'], traits: [], shape: 'stratobomber' },
  // ---- Heavy bombers (giant / titan class aircraft) ----
  { id: 'strategic', name: 'Strategic Bomber', desc: 'Giant swept-wing jet bomber: four bomb bays down a long belly, chin and tail gun turrets, eight podded engines. Slower and wider-turning than the Strato, but hauls a far bigger load and soaks far more fire.', size: 4, hp: 3600, armor: 9, weight: 40, cost: 500, footprint: [6, 5], art: [6, 4.8], mounts: ['M', 'M', 'M', 'M', 'S', 'S'], agility: 0.7, domain: 'jet', roles: ['bomber', 'flyer'], traits: [], shape: 'strategic' },
  { id: 'superfortress', name: 'Superfortress', desc: 'Titan-class flying fortress: a vast straight wing with ten engines, six bomb bays and four defensive gun blisters. Slow and wide in the turn, it lays carpets of bombs and takes a lot of flak to bring down.', size: 5, hp: 6500, armor: 12, weight: 70, cost: 900, footprint: [8, 6], art: [8, 5.8], mounts: ['M', 'M', 'M', 'M', 'M', 'M', 'S', 'S', 'S', 'S'], agility: 0.6, domain: 'jet', roles: ['bomber', 'flyer'], traits: [], shape: 'superfortress' },
  { id: 'heavyheli', name: 'Heavy Helicopter', desc: 'Tandem-rotor heavy helicopter. Slow, tough, hauls big guns.', size: 3, hp: 1300, armor: 6, weight: 20, cost: 280, footprint: [2, 4], art: [1.9, 3.65], mounts: ['M', 'M', 'S'], agility: 0.85, domain: 'heli', roles: ['flyer', 'assault'], traits: [], shape: 'heavyheli' },
  // ---- Giant class (size 4, 20 m) ----
  { id: 'goliath', name: 'Warhulk Frame', desc: 'Giant assault frame: a giant-class mount backed by two heavies.', size: 4, hp: 4160, armor: 16, weight: 70, cost: 190, footprint: [4, 5], art: [4, 4.8], mounts: ['L', 'M', 'M', 'M'], agility: 0.75, roles: ['assault'], traits: [], shape: 'goliath' },
  { id: 'leviathan', name: 'Leviathan Hull', desc: 'Giant battle hull with twin giant-class mounts.', size: 4, hp: 3800, armor: 20, weight: 82, cost: 725, footprint: [3, 6], art: [3, 5.6], mounts: ['L', 'L', 'M', 'M'], agility: 0.65, roles: ['siege', 'assault'], traits: [], shape: 'leviathan' },
  { id: 'carrier', name: 'Sky Carrier', desc: 'Giant flying hull. Must fly on grav lifters.', size: 4, hp: 4500, armor: 14, weight: 50, cost: 1100, footprint: [6, 4], art: [5.8, 3], domain: 'heli', mounts: ['L', 'M', 'M', 'M'], agility: 0.8, roles: ['flyer', 'bomber'], traits: ['airOnly'], shape: 'carrier' },
  { id: 'broodmother', name: 'Matriarch', desc: 'Giant multi-legged walking fortress with a giant-class dorsal weapon and four more mounts.', size: 4, hp: 3000, armor: 14, weight: 66, cost: 650, footprint: [7, 5], art: [4.9, 3.75], mounts: ['L', 'M', 'M', 'M', 'S'], agility: 0.85, mobility: ['spider', 'anchor'], roles: ['riot', 'assault'], traits: [], shape: 'broodmother' },
  // ---- Titan class (size 5, 25 m) ----
  { id: 'dreadnought', name: 'Dreadnought Airship', desc: 'Titan-class twin-hull grav airship: a heavy bow mount, four keel bays (bombs drop from the keel, guns ride on top) and gun blisters on both gasbags. Very slow, enormously tough. Grav lifters only.', size: 5, hp: 9500, armor: 15, weight: 105, cost: 500, footprint: [5, 8], art: [4.8, 8], domain: 'heli', mounts: ['L', 'M', 'M', 'M', 'M', 'S', 'S'], agility: 0.55, roles: ['bomber', 'flyer'], traits: ['airOnly'], shape: 'airship' },
  { id: 'titan', name: 'Titan Walker', desc: 'The all-rounder titan: a titan mount, a giant mount and three mediums, and field workshops that repair nearby allies.', size: 5, hp: 6500, armor: 22, weight: 120, cost: 955, footprint: [7, 7], art: [6.75, 7], mounts: ['XL', 'L', 'M', 'M', 'M'], agility: 0.7, roles: ['assault', 'siege'], traits: ['repairAura'], shape: 'colossal' },
  { id: 'citadel', name: 'Citadel Fortress', desc: 'Mobile fortress with twin titan mounts and long-range fire control (+20% range). The biggest thing on the field, and the slowest to turn.', size: 5, hp: 8000, armor: 28, weight: 140, cost: 1915, footprint: [8, 7], art: [7.6, 6.75], mounts: ['XL', 'XL', 'L', 'M', 'M', 'S'], agility: 0.45, roles: ['siege', 'tank'], traits: ['rangeBoost'], shape: 'citadel' },
  { id: 'arachne', name: 'Weaver Titan', desc: 'The fast titan: a titan mount and twin giant mounts on many legs. Turns and strides quickly, but carries lighter armour.', size: 5, hp: 6800, armor: 16, weight: 115, cost: 340, footprint: [10, 10], art: [7.1, 7.1], mounts: ['XL', 'L', 'L', 'M'], agility: 1.05, mobility: ['spider', 'anchor'], roles: ['assault'], traits: [], shape: 'arachne' },
  { id: 'lance', name: 'Lance Dreadnought', desc: 'A titan weapon on legs and little else: one titan mount and one medium. Lighter, quicker and cheaper than other titans, but nothing to fall back on if the big gun is the wrong tool.', size: 5, hp: 5000, armor: 20, weight: 78, cost: 520, footprint: [4, 8], art: [4, 8], mounts: ['XL', 'M'], agility: 0.95, roles: ['siege', 'assault'], traits: [], shape: 'lance' },
  { id: 'monolith', name: 'Monolith', desc: 'A walking bunker: enormous hit points and armour, but only a giant and a medium mount. Holds a line no one else can.', size: 5, hp: 13000, armor: 32, weight: 150, cost: 900, footprint: [7, 7], art: [7, 7], mounts: ['L', 'M'], agility: 0.5, roles: ['tank'], traits: [], shape: 'monolith' },
];

export const MOBILITY: MobilityDef[] = [
  { id: 'wheels', name: 'Wheels', desc: 'Fast and cheap, but fragile and light-duty.', kind: 'ground', sizes: [1, 2], speed: 3.2, turn: 4, capacity: [8, 24, 0, 0, 0], weight: 1.5, hp: 0, armor: 0, cost: 8, traits: [], roles: ['raider', 'scout'] },
  { id: 'halftrack', name: 'Half-Track', desc: 'Wheels up front, treads behind. Balanced all-rounder.', kind: 'ground', sizes: [1, 2, 3], speed: 2.3, turn: 2.6, capacity: [9, 27, 52, 0, 0], weight: 2.5, hp: 30, armor: 1, cost: 14, traits: [], roles: ['skirmisher', 'assault'] },
  { id: 'treads', name: 'Tank Treads', desc: 'Heavy-duty treads. Slow, tough, carries anything.', kind: 'ground', sizes: [2, 3, 4], speed: 1.6, turn: 1.8, capacity: [0, 32, 66, 125, 0], weight: 4, hp: 60, armor: 3, cost: 22, traits: ['crush'], roles: ['tank', 'assault'] },
  { id: 'legs', name: 'Bipedal Legs', desc: 'Nimble walker. Fires while moving.', kind: 'ground', sizes: [1, 2], speed: 2.0, turn: 3.5, capacity: [9, 24, 0, 0, 0], weight: 2, hp: 20, armor: 0, cost: 14, traits: ['fireOnMove'], roles: ['skirmisher', 'raider'] },
  { id: 'spider', name: 'Spider Legs', desc: 'Six-legged stable walker. Better accuracy, carries heavy loads.', kind: 'ground', sizes: [1, 2, 3, 4, 5], speed: 1.6, turn: 3, capacity: [10, 29, 58, 110, 210], weight: 3.5, hp: 40, armor: 2, cost: 22, traits: ['stable'], roles: ['artillery', 'riot', 'skirmisher'] },
  { id: 'jumpjets', name: 'Jump Legs', desc: 'Leaps over obstacles straight into the fight.', kind: 'ground', sizes: [1, 2], speed: 2.0, turn: 3, capacity: [8, 21, 0, 0, 0], weight: 2.5, hp: 10, armor: 0, cost: 22, traits: ['leap'], roles: ['raider', 'melee'] },
  { id: 'hover', name: 'Hover Skirt', desc: 'Skims the ground. Very fast, hard to hit.', kind: 'ground', sizes: [1, 2], speed: 3.8, turn: 2.4, capacity: [7.5, 22, 0, 0, 0], weight: 1.5, hp: 0, armor: 0, cost: 18, traits: ['evasive'], roles: ['raider', 'scout'] },
  { id: 'rotor', name: 'Rotor', desc: 'Helicopter rotors. Flies over ground units; only anti-air can hit it.', kind: 'air', sizes: [1, 2, 3], speed: 2.8, turn: 3, capacity: [5, 17, 36, 0, 0], weight: 2, hp: 0, armor: 0, cost: 28, domain: 'heli', traits: ['fireOnMove'], roles: ['flyer', 'support'] },
  { id: 'jet', name: 'Jet Thrusters', desc: 'Very fast strafing flyer. Fires on the pass.', kind: 'air', sizes: [1, 2, 3, 4, 5], speed: 7, turn: 1.6, capacity: [4, 14, 30, 62, 112], weight: 1.5, hp: 0, armor: 0, cost: 32, domain: 'jet', traits: ['fireOnMove', 'strafe', 'evasive'], roles: ['flyer', 'raider', 'bomber'] },
  { id: 'megatracks', name: 'Colossal Tracks', desc: 'Quad track assemblies for giant and titan hulls. Crushes anything underfoot.', kind: 'ground', sizes: [4, 5], speed: 1.25, turn: 1.2, capacity: [0, 0, 0, 140, 245], weight: 6, hp: 120, armor: 5, cost: 30, traits: ['crush'], roles: ['tank', 'assault'] },
  { id: 'titanlegs', name: 'Titan Legs', desc: 'Towering walker legs. Fires on the move and stomps smaller units.', kind: 'ground', sizes: [3, 4, 5], speed: 1.4, turn: 1.6, capacity: [0, 0, 62, 122, 220], weight: 5, hp: 80, armor: 3, cost: 30, traits: ['fireOnMove', 'crush'], roles: ['assault'] },
  { id: 'gravlift', name: 'Grav Lifters', desc: 'Anti-gravity lifters that make heavy, giant and titan hulls fly.', kind: 'air', sizes: [3, 4, 5], speed: 2.4, turn: 1.2, capacity: [0, 0, 50, 100, 180], weight: 4, hp: 0, armor: 0, cost: 50, domain: 'heli', traits: ['fireOnMove'], roles: ['flyer', 'bomber'] },
  { id: 'anchor', name: 'Anchor Mount', desc: 'Immobile emplacement. Extra hp, armor and +15% range.', kind: 'static', sizes: [1, 2, 3, 4, 5], speed: 0, turn: 2.5, capacity: [14, 40, 80, 150, 260], weight: 0, hp: 100, armor: 4, cost: 0, traits: ['fortified'], roles: ['siege', 'artillery', 'antiair'] },
];

export const CATEGORIES: { id: ModuleCategory; name: string; desc: string }[] = [
  { id: 'machinegun', name: 'Machine Guns', desc: 'High rate of fire. Great vs light units and aircraft, poor vs armor.' },
  { id: 'autocannon', name: 'Autocannons', desc: 'Rapid mid-caliber guns. Flexible, most can hit aircraft.' },
  { id: 'cannon', name: 'Cannons', desc: 'Armor-piercing shells. Tank killers; ground only.' },
  { id: 'precision', name: 'Sniper & Rail', desc: 'Extreme range, huge single hits, slow to fire.' },
  { id: 'rocket', name: 'Rockets', desc: 'Unguided salvos with splash.' },
  { id: 'missile', name: 'Missiles', desc: 'Homing warheads. Reliable at long range.' },
  { id: 'artillery', name: 'Artillery', desc: 'Lobbed indirect fire over the front line. Has a minimum range.' },
  { id: 'energy', name: 'Energy', desc: 'Beams and plasma. Instant hits, good armor pierce.' },
  { id: 'flame', name: 'Flame', desc: 'Short-range fire that ignores armor and sets targets burning.' },
  { id: 'disruption', name: 'Stun & Disruption', desc: 'Lightning, EMP stuns and slow beams that cripple enemies.' },
  { id: 'antiair', name: 'Flak', desc: 'Dedicated anti-air. Bursting shells shred aircraft.' },
  { id: 'melee', name: 'Melee', desc: 'Saws, claws, hammers and drills. Devastating on contact, but you have to get there.' },
  { id: 'support', name: 'Support', desc: 'Repair beams, shield domes and command uplinks that empower allies.' },
  { id: 'defense', name: 'Defense', desc: 'Shields, point defense, smoke, reactive and resistant coatings.' },
  { id: 'stealth', name: 'Stealth & ECM', desc: 'Cloaks, jammers and sensors. Hide your units or find theirs.' },
  { id: 'systems', name: 'Systems', desc: 'Engines, targeting, stabilizers, autoloaders and other upgrades.' },
  { id: 'armor', name: 'Armor', desc: 'Plating: more hp and armor, at the cost of weight.' },
];

type W = Omit<ModuleDef, 'kind'> & { kind?: ModuleDef['kind'] };
const G = { targetsGround: true, targetsAir: false };
const A = { targetsGround: false, targetsAir: true };
const GA = { targetsGround: true, targetsAir: true };
const MELEE = { targetsGround: true, targetsAir: false, projectile: 'melee' as const };
const util = (m: Omit<ModuleDef, 'kind'>): ModuleDef => ({ kind: 'utility', ...m });
const wpn = (m: W): ModuleDef => ({ kind: 'weapon', ...m }) as ModuleDef;

export const MODULES: ModuleDef[] = [
  // ---------------- Machine guns ----------------
  wpn({ id: 'mg', name: '7.62mm Machine Gun', family: '7.62mm', desc: 'Cheap, accurate rapid fire for picking off light units and aircraft. Bounces off armor.', category: 'machinegun', visual: 'gun', caliber: 0.2, mount: 'S', weight: 1, cost: 6,
    damage: 8, cooldown: 0.15, range: 6, ...GA, projectile: 'bullet', projectileSpeed: 22, ap: 0, spread: 0.25 }),
  wpn({ id: 'twinmg', name: 'Suppressor MG', family: 'Twin 7.62mm', desc: 'Suppressive fire: a hail of bullets that pins whatever it keeps hitting, cutting its speed and rate of fire by up to 60%. Little damage of its own.', category: 'machinegun', visual: 'gun', barrels: 2, caliber: 0.2, mount: 'S', weight: 1.8, cost: 11,
    damage: 6, cooldown: 0.075, range: 5.5, ...GA, projectile: 'bullet', projectileSpeed: 22, ap: 0, spread: 0.45, slow: 0.05 }),
  wpn({ id: 'hmg', name: '12.7mm Heavy MG', family: '12.7mm', desc: 'Armor-piercing 12.7mm belts: the light gun that still hurts tanks, and reaches a little further.', category: 'machinegun', visual: 'gun', caliber: 0.4, mount: 'S', weight: 1.6, cost: 10,
    damage: 16, cooldown: 0.22, range: 6.5, ...GA, magazine: 25, reload: 2.5, projectile: 'bullet', projectileSpeed: 24, ap: 0.5, spread: 0.3 }),
  wpn({ id: 'minigun', name: 'Rotary Minigun', family: 'Rotary', desc: 'Spins up: starts at a quarter rate, then a wall of bullets after 1.5 s of fire. Winds down without a target.', category: 'machinegun', visual: 'gatling', barrels: 6, caliber: 0.5, mount: 'M', weight: 3, cost: 22,
    damage: 9, cooldown: 0.05, range: 6, ...GA, projectile: 'bullet', projectileSpeed: 24, ap: 0, spread: 0.65, spinUp: 1.5 }),
  wpn({ id: 'shotgun', name: 'Scattergun', family: 'Scatter', desc: 'Point-blank cone of 8 heavy pellets that knock light units back: shreds whatever is touching it, a quarter damage at its short max range. Useless at a distance.', category: 'machinegun', visual: 'shotgun', caliber: 0.5, mount: 'S', weight: 1.4, cost: 9,
    damage: 24, pellets: 8, cooldown: 1.2, range: 3.5, ...GA, projectile: 'bullet', projectileSpeed: 20, ap: 0, spread: 0.9, falloff: 0.25, impulse: 0.12 }),
  wpn({ id: 'flechette', name: 'Flechette Cannon', family: 'Flechette', desc: 'Cone of 8 steel darts that punch through every unit they hit: shreds packed squads up close.', category: 'machinegun', visual: 'shotgun', caliber: 0.8, mount: 'M', weight: 4, cost: 30,
    damage: 20, pellets: 8, cooldown: 1.5, range: 6, ...GA, projectile: 'bullet', projectileSpeed: 30, pierce: true, ap: 0.5, spread: 1 }),
  // ---------------- Autocannons ----------------
  wpn({ id: 'ac20', name: '20mm Autocannon', family: '20mm', desc: 'Explosive 20mm clip: small blasts splash packed light units; hits air too.', category: 'autocannon', visual: 'gun', caliber: 0.55, mount: 'S', weight: 1.8, cost: 14,
    damage: 18, cooldown: 0.2, range: 7, ...GA, magazine: 10, reload: 2, projectile: 'bullet', projectileSpeed: 20, splash: 0.2, ap: 0, spread: 0.3 }),
  wpn({ id: 'autocannon', name: '30mm Autocannon', family: '30mm', desc: 'Workhorse 30mm: explosive clip rounds, hits ground and air.', category: 'autocannon', visual: 'gun', caliber: 0.5, mount: 'M', weight: 3, cost: 22,
    damage: 32, cooldown: 0.3, range: 7.5, ...GA, magazine: 6, reload: 2, projectile: 'bullet', projectileSpeed: 18, splash: 0.3, ap: 0.5, spread: 0.3 }),
  wpn({ id: 'twin30', name: 'Twin 30mm Burst Gun', family: 'Twin 30mm', desc: 'Alpha strike: dumps a 16-round burst in about a second, then a long reload.', category: 'autocannon', visual: 'gun', barrels: 2, caliber: 0.5, mount: 'M', weight: 5, cost: 38,
    damage: 32, cooldown: 0.07, range: 7.5, ...GA, magazine: 16, reload: 4.5, projectile: 'bullet', projectileSpeed: 18, splash: 0.3, ap: 0.5, spread: 0.35 }),
  wpn({ id: 'ac40', name: '40mm Bofors', family: '40mm', desc: 'Proximity-fused 40mm: long reach, wide blasts, bonus vs aircraft.', category: 'autocannon', visual: 'gun', caliber: 0.8, mount: 'M', weight: 4, cost: 28,
    damage: 55, cooldown: 0.5, range: 9, ...GA, magazine: 4, reload: 2.5, projectile: 'bullet', projectileSpeed: 20, splash: 0.5, ap: 0.5, spread: 0.3, airBonus: 1.3 }),
  wpn({ id: 'quad20', name: 'Quad 20mm AA', family: 'Quad 20mm', desc: 'Air only: four-barrel 20mm hose with a big bonus vs aircraft.', category: 'autocannon', visual: 'gun', barrels: 4, caliber: 0.45, mount: 'M', weight: 4, cost: 26,
    damage: 18, cooldown: 0.05, range: 9, ...A, magazine: 24, reload: 3, projectile: 'bullet', projectileSpeed: 24, splash: 0.2, ap: 0, spread: 0.3, airBonus: 1.4 }),
  // ---------------- Cannons ----------------
  wpn({ id: 'cannon75', name: '75mm Gun', family: '75mm', desc: 'Autoloader: three quick armor-piercing shells, then a long reload.', category: 'cannon', visual: 'cannon', caliber: 0.5, mount: 'M', weight: 5, cost: 32,
    damage: 95, cooldown: 0.7, range: 8.5, ...G, magazine: 3, reload: 4, projectile: 'shell', projectileSpeed: 20, splash: 0.3, ap: 0.5, spread: 0.2 }),
  wpn({ id: 'cannon', name: '120mm Heavy Cannon', family: '120mm', desc: 'Heavy armor-piercing shell: the tank killer, slow to load. Ground only.', category: 'cannon', visual: 'cannon', caliber: 0.8, mount: 'M', weight: 8, cost: 50,
    damage: 190, cooldown: 2.2, range: 9, ...G, projectile: 'shell', projectileSpeed: 20, splash: 0.3, ap: 1, spread: 0.2 }),
  wpn({ id: 'twin120', name: 'Twin 120mm HE Cannon', family: 'Twin 120mm HE', desc: 'High-explosive shells: wide blasts that knock units back, but weaker vs heavy armor.', category: 'cannon', visual: 'cannon', barrels: 2, caliber: 0.8, mount: 'M', weight: 13, cost: 85,
    damage: 150, cooldown: 1.1, range: 9, ...G, projectile: 'shell', projectileSpeed: 20, splash: 1, ap: 0.5, spread: 0.25, impulse: 0.6 }),
  wpn({ id: 'gauss', name: 'Gauss Cannon', family: 'Gauss', desc: 'Magnetic slug punches through every unit in its line and shoves them back.', category: 'cannon', visual: 'gauss', caliber: 0.8, mount: 'M', weight: 10, cost: 75,
    damage: 384, cooldown: 4.16, range: 12, ...GA, projectile: 'shell', projectileSpeed: 34, pierce: true, ap: 1, spread: 0.1, impulse: 0.8 }),
  // ---------------- Sniper & rail ----------------
  wpn({ id: 'sniper', name: 'Sniper Rifle', family: 'Sniper', desc: 'Pinpoint rifle: out-ranges nearly every gun and picks off one target per shot. Slow to fire.', category: 'precision', visual: 'sniper', caliber: 0.4, mount: 'S', weight: 1.5, cost: 20,
    damage: 224, cooldown: 5.6, range: 14, ...G, projectile: 'bullet', projectileSpeed: 60, ap: 0.5, spread: 0 }),
  wpn({ id: 'lightrail', name: 'Rail Rifle', family: 'Light rail', desc: 'Hitscan rail: a needle-thin slug that punches through the hulls in its exact line, losing punch with each.', category: 'precision', visual: 'rail', caliber: 0.5, mount: 'M', weight: 4, cost: 40,
    damage: 240, cooldown: 4.8, range: 14, ...GA, projectile: 'rail', ap: 1, pierce: true, beamWidth: 0.04, pierceKeep: 0.5 }),
  wpn({ id: 'railgun', name: 'Railgun', family: 'Heavy rail', desc: 'Heavy rail: a thin slug at long range that punches through the hulls in its line. Slow to recharge.', category: 'precision', visual: 'rail', caliber: 0.9, mount: 'M', weight: 9, cost: 75,
    damage: 320, cooldown: 5.5, range: 16, ...GA, projectile: 'rail', ap: 1, pierce: true, beamWidth: 0.12, pierceKeep: 0.6 }),
  // ---------------- Rockets ----------------
  wpn({ id: 'rocketL', name: 'Light Rocket Rack', family: '2-tube', desc: 'Two-rocket salvo that lands as a pair of separate blasts.', category: 'rocket', visual: 'rocketPod', barrels: 2, caliber: 0.3, mount: 'S', weight: 1.5, cost: 12,
    damage: 64, burst: 2, cooldown: 6, range: 9, ...G, projectile: 'rocket', projectileSpeed: 11, splash: 0.7, ap: 0, spread: 0.7 }),
  wpn({ id: 'rockets', name: 'Rocket Pod', family: '4-tube', desc: 'Four-rocket salvo that saturates an area with separate blasts.', category: 'rocket', visual: 'rocketPod', barrels: 4, caliber: 0.5, mount: 'M', weight: 3, cost: 30,
    damage: 84, burst: 4, cooldown: 8, range: 10, ...G, projectile: 'rocket', projectileSpeed: 11, splash: 1, ap: 0, spread: 0.8 }),
  wpn({ id: 'incendiary', name: 'Incendiary Rockets', family: 'Napalm 4-tube', desc: 'Rocket salvo with light blasts that set everything caught burning for 9 s, and leave the ground on fire.', category: 'rocket', visual: 'rocketPod', barrels: 4, caliber: 0.5, mount: 'M', weight: 3.2, cost: 34,
    damage: 48, burst: 4, cooldown: 8, range: 10, ...G, projectile: 'rocket', projectileSpeed: 11, splash: 1, ap: 0, spread: 0.8, burn: { dps: 16, duration: 9 }, fireField: { radius: 1.1, duration: 7, dps: 10 } }),
  wpn({ id: 'mlrs', name: 'MLRS Battery', family: '12-tube', desc: 'Ripple-fires 12 rockets across a huge area. Minimum range 30 m.', category: 'rocket', visual: 'rocketPod', barrels: 12, caliber: 0.9, mount: 'M', weight: 10, cost: 70,
    damage: 66, burst: 12, cooldown: 16.2, range: 22, minRange: 6, ...G, projectile: 'rocket', projectileSpeed: 12, splash: 1, ap: 0, spread: 1.6 }),
  // ---------------- Missiles ----------------
  wpn({ id: 'atgm', name: 'ATGM Launcher', family: 'Anti-tank', desc: 'Wire-guided tandem warhead: one slow, homing, very heavy hit that ignores ALL armor. No blast, so it wastes itself on light units. Ground only.', category: 'missile', visual: 'missileRack', barrels: 1, caliber: 0.3, mount: 'S', weight: 1.6, cost: 18,
    damage: 272, cooldown: 8, range: 12, ...G, projectile: 'missile', projectileSpeed: 9, ap: 1 }),
  wpn({ id: 'guidedrocket', name: 'Guided Rocket Launcher', family: 'Dual-role', desc: 'Homing high-explosive rocket for ground and air: a wide blast that scatters light units, but no armor penetration.', category: 'missile', visual: 'missileRack', barrels: 1, caliber: 0.25, mount: 'S', weight: 1.3, cost: 16,
    damage: 110, cooldown: 6, range: 10, ...GA, projectile: 'missile', projectileSpeed: 10, splash: 0.8, ap: 0 }),
  wpn({ id: 'aamissile', name: 'AA Missile Pod', family: 'Anti-air', desc: 'Twin heat-seekers: air only, big bonus vs aircraft.', category: 'missile', visual: 'missileRack', barrels: 2, caliber: 0.3, mount: 'S', weight: 1.4, cost: 16,
    damage: 120, burst: 2, cooldown: 7, range: 13, ...A, projectile: 'missile', projectileSpeed: 11, splash: 0.5, ap: 0, airBonus: 1.5 }),
  wpn({ id: 'sam', name: 'Missile Rack', family: 'Multi-role', desc: 'Homing missiles with long reach and a bonus vs aircraft.', category: 'missile', visual: 'missileRack', barrels: 4, caliber: 0.5, mount: 'M', weight: 3, cost: 34,
    damage: 170, cooldown: 6, range: 13, ...GA, projectile: 'missile', projectileSpeed: 9, splash: 0.6, ap: 0, airBonus: 1.6 }),
  wpn({ id: 'swarm', name: 'Swarm Missiles', family: 'Swarm', desc: 'Eight micro-missiles fan out and spread over the targets: a cloud of small blasts for swarms and aircraft, no armor penetration.', category: 'missile', visual: 'missileRack', barrels: 8, caliber: 0.5, mount: 'M', weight: 3.5, cost: 40,
    damage: 56, burst: 8, cooldown: 12, range: 12, ...GA, projectile: 'missile', projectileSpeed: 10, splash: 0.6, ap: 0, spread: 0.4 }),
  wpn({ id: 'cruise', name: 'Cruise Missile', family: 'Strategic', desc: 'One huge homing warhead with a vast blast. Very slow to reload, minimum range 40 m.', category: 'missile', visual: 'cruise', caliber: 0.9, mount: 'M', weight: 9, cost: 80,
    damage: 300, cooldown: 10, range: 28, minRange: 8, ...G, projectile: 'missile', projectileSpeed: 10, splash: 2.2, ap: 0.5 }),
  // ---------------- Artillery ----------------
  wpn({ id: 'mortar', name: 'Mortar', family: '81mm', desc: 'Lobbed shells arc over the front line onto groups. Minimum range 25 m.', category: 'artillery', visual: 'mortar', caliber: 0.5, mount: 'M', weight: 3.5, cost: 30,
    damage: 108, cooldown: 5.4, range: 20, minRange: 5, ...G, projectile: 'arc', projectileSpeed: 8, splash: 1.2, ap: 0, spread: 0.8 }),
  wpn({ id: 'howitzer', name: 'Howitzer', family: '155mm', desc: 'Long-range shell with a huge blast. Minimum range 40 m.', category: 'artillery', visual: 'artillery', caliber: 0.9, mount: 'M', weight: 10, cost: 75,
    damage: 144, cooldown: 9, range: 30, minRange: 8, ...G, projectile: 'arc', projectileSpeed: 12, splash: 2, ap: 0.5, spread: 1.2 }),
  wpn({ id: 'barrage', name: 'Barrage Cannon', family: 'Scatter artillery', desc: 'Six shells at once that blanket a wide area. Minimum range 30 m.', category: 'artillery', visual: 'artillery', barrels: 3, caliber: 0.8, mount: 'M', weight: 11, cost: 80,
    damage: 48, pellets: 6, cooldown: 5.95, range: 24, minRange: 6, ...G, projectile: 'arc', projectileSpeed: 10, splash: 1, ap: 0, spread: 2 }),
  wpn({ id: 'grenade', name: 'Grenade Launcher', family: '40mm grenade', desc: 'Lobs grenades over the units in front onto whoever is behind: small blasts, short reach. Minimum range 10 m.', category: 'artillery', visual: 'mortar', caliber: 0.3, mount: 'S', weight: 1.6, cost: 14,
    damage: 45, cooldown: 2, range: 8, minRange: 2, ...G, projectile: 'arc', projectileSpeed: 8, splash: 0.9, ap: 0, spread: 0.5 }),
  wpn({ id: 'firebomb', name: 'Firebomb Mortar', family: 'Incendiary mortar', desc: 'Lobbed firebombs leave a burning patch for 6 s: anything standing in it or driving through catches fire. Minimum range 25 m.', category: 'flame', visual: 'mortar', caliber: 0.6, mount: 'M', weight: 4, cost: 34,
    damage: 82, cooldown: 6, range: 18, minRange: 5, ...G, projectile: 'arc', projectileSpeed: 8, splash: 1, ap: 0.5, spread: 0.8, fireField: { radius: 1.8, duration: 6, dps: 30 } }),
  // ---------------- Energy ----------------
  wpn({ id: 'laser', name: 'Pulse Laser', family: 'Pulse', desc: 'Heavy hitscan pulse at mid range: never misses, so it is the answer to fast raiders and jets that bullets keep missing. Slow to recharge; poor against swarms.', category: 'energy', visual: 'laser', caliber: 0.3, mount: 'S', weight: 1.2, cost: 18,
    damage: 75, cooldown: 1.6, range: 9, ...GA, projectile: 'beam', ap: 0.5, airBonus: 1.6 }),
  wpn({ id: 'twinlaser', name: 'Focus Laser', family: 'Focus beam', desc: 'Focusing beam that burns through ALL armor: damage builds to 5x over 2.5 s on the same target, resets when it switches. A tank killer that hates swarms.', category: 'energy', visual: 'laser', barrels: 2, caliber: 0.4, mount: 'M', weight: 2.6, cost: 34,
    damage: 6, cooldown: 0.15, range: 7, ...GA, projectile: 'beam', ap: 1, ramp: 5 }),
  wpn({ id: 'heatray', name: 'Heat Ray', family: 'Thermal', desc: 'Knife-range armor melter: ignores ALL armor and fades to a quarter of its damage at max range. The flamethrower is for infantry; this is for tanks. Ground only.', category: 'energy', visual: 'heatray', caliber: 0.5, mount: 'M', weight: 3.5, cost: 32,
    damage: 42, cooldown: 0.2, range: 6.5, ...G, projectile: 'beam', ap: 1, falloff: 0.3 }),
  wpn({ id: 'plasmaorb', name: 'Plasma Cannon', family: 'Plasma orb', desc: 'Slow plasma ball that bursts on impact: big splash, but fast units dodge it.', category: 'energy', visual: 'plasma', caliber: 0.5, mount: 'M', weight: 4, cost: 36,
    damage: 100, cooldown: 2, range: 8, ...G, projectile: 'orb', projectileSpeed: 8, splash: 1.5, ap: 0.5, spread: 0.4 }),
  wpn({ id: 'leech', name: 'Leech Beam', family: 'Vampiric', desc: 'Vampiric beam: half of the damage it deals flows back into its own hull. A brawler that heals itself by fighting.', category: 'energy', visual: 'laser', barrels: 2, caliber: 0.5, mount: 'M', weight: 3.5, cost: 34,
    damage: 16, cooldown: 0.2, range: 6.5, ...GA, projectile: 'beam', ap: 0.5, lifesteal: 0.5 }),
  wpn({ id: 'prism', name: 'Prism Array', family: 'Prism', desc: 'Every pulse splits into four beams that strike four different targets at once. Built for swarms and drone clouds; weak against one big hull.', category: 'energy', visual: 'laser', barrels: 3, caliber: 0.5, mount: 'M', weight: 3.5, cost: 34,
    damage: 20, cooldown: 0.9, range: 7.5, ...GA, projectile: 'beam', ap: 0, split: 4 }),
  wpn({ id: 'voidlance', name: 'Void Lance', family: 'Void', desc: 'Unmakes matter: each shot also strips 6% of the target\'s MAX hit points, ignoring armor. Pointless against scouts, terrifying against titans.', category: 'energy', visual: 'plasma', caliber: 0.8, mount: 'M', weight: 7, cost: 60,
    damage: 20, cooldown: 2.5, range: 10, ...GA, projectile: 'beam', ap: 1, pctHp: 0.06 }),
  wpn({ id: 'entropy', name: 'Entropy Ray', family: 'Entropy', desc: 'Corrodes armor: every hit strips armor from the target (up to all of it) for as long as the ray keeps on it, so the rest of your army\'s guns stop bouncing off.', category: 'energy', visual: 'heatray', caliber: 0.5, mount: 'M', weight: 3, cost: 30,
    damage: 12, cooldown: 0.25, range: 7, ...GA, projectile: 'beam', ap: 0.5, shred: 0.8 }),
  wpn({ id: 'plasma', name: 'Plasma Lance', family: 'Plasma beam', desc: 'Continuous plasma lance that cuts through every enemy in a line.', category: 'energy', visual: 'plasma', caliber: 0.9, mount: 'M', weight: 8, cost: 65,
    damage: 48, cooldown: 0.25, range: 7.5, ...GA, projectile: 'rail', ap: 0.5, pierce: true }),
  // ---------------- Flame ----------------
  wpn({ id: 'flamer', name: 'Flamethrower', family: 'Light flame', desc: 'Short cone of fire: little direct damage, but everything it touches keeps burning for 6 s, and the ground smoulders.', category: 'flame', visual: 'flamer', caliber: 0.3, mount: 'S', weight: 1.5, cost: 14,
    damage: 5, cooldown: 0.1, range: 3.5, ...G, projectile: 'flame', projectileSpeed: 9, splash: 0.8, ap: 1, burn: { dps: 10, duration: 6 }, fireField: { radius: 0.7, duration: 1.5, dps: 4 } }),
  wpn({ id: 'napalm', name: 'Napalm Projector', family: 'Napalm', desc: 'Sticky gel: a wide cone that barely hurts on contact, but sticks and burns hot for 8 s, and leaves burning pools.', category: 'flame', visual: 'flamer', caliber: 0.6, mount: 'M', weight: 3.2, cost: 30,
    damage: 6, cooldown: 0.15, range: 4.5, ...G, projectile: 'flame', projectileSpeed: 8, splash: 1.2, ap: 1, burn: { dps: 20, duration: 8 }, fireField: { radius: 1.1, duration: 6, dps: 12 } }),
  // ---------------- Stun & disruption ----------------
  wpn({ id: 'tesla', name: 'Tesla Coil', family: 'Chain lightning', desc: 'Lightning that jumps between up to 4 nearby enemies (aircraft too), jolts them, and overloads shields for triple damage. The shield breaker.', category: 'disruption', visual: 'tesla', caliber: 0.5, mount: 'M', weight: 3.5, cost: 32,
    damage: 48, cooldown: 1.2, range: 4.5, ...GA, projectile: 'lightning', chain: 3, ap: 0.5, stun: 0.4, shieldMult: 3 }),
  wpn({ id: 'stungun', name: 'Stun Gun', family: 'Paralyzer', desc: 'Lockdown bolt: freezes a light unit in one or two hits and a tank in a few; frozen units can\'t move or fire while your army kills them. Barely damages anything itself.', category: 'disruption', visual: 'emp', caliber: 0.3, mount: 'S', weight: 1.2, cost: 18,
    damage: 10, cooldown: 1.5, range: 7, ...GA, projectile: 'lightning', chain: 0, ap: 1, stun: 3.5, shieldMult: 2 }),
  wpn({ id: 'empcannon', name: 'EMP Cannon', family: 'EMP burst', desc: 'EMP orb: paralyses everything in the blast and drains shields. A crowd-control opener, not a killer.', category: 'disruption', visual: 'emp', caliber: 0.6, mount: 'M', weight: 3.5, cost: 38,
    damage: 50, cooldown: 2.5, range: 9, ...G, projectile: 'orb', projectileSpeed: 7, splash: 1.2, ap: 1, stun: 3.5, spread: 0.3 }),
  wpn({ id: 'slowbeam', name: 'Slow Beam', family: 'Disruptor', desc: 'Beam that cuts target speed and rate of fire by up to 60% while it holds on.', category: 'disruption', visual: 'slowbeam', caliber: 0.5, mount: 'M', weight: 3, cost: 28,
    damage: 12, cooldown: 0.2, range: 7.5, ...GA, projectile: 'beam', ap: 1, slow: 0.15 }),
  wpn({ id: 'arclance', name: 'Arc Lance', family: 'Storm', desc: 'Heavy lightning that chains through 6 enemies, jolts them and overloads shields (3x).', category: 'disruption', visual: 'tesla', caliber: 0.9, mount: 'M', weight: 9, cost: 75,
    damage: 105, cooldown: 1.6, range: 6.5, ...GA, projectile: 'lightning', chain: 5, ap: 0.5, stun: 0.4, shieldMult: 3 }),
  wpn({ id: 'disarm', name: 'Disarm Ray', family: 'Disarmer', desc: 'Scrambler beam: two or three hits silence a target\'s guns for seconds. Point it at the enemy\'s biggest gun.', category: 'disruption', visual: 'emp', caliber: 0.5, mount: 'M', weight: 3, cost: 34,
    damage: 20, cooldown: 2.5, range: 8, ...GA, projectile: 'beam', ap: 1, disarm: 4 }),
  wpn({ id: 'sonic', name: 'Sonic Pulser', family: 'Riot', desc: 'Concussive blast that hurls light units backwards.', category: 'disruption', visual: 'sonic', caliber: 0.5, mount: 'M', weight: 3.5, cost: 30,
    damage: 50, cooldown: 1.4, range: 4, ...G, projectile: 'orb', projectileSpeed: 14, splash: 1, ap: 0.5, impulse: 1.6 }),
  wpn({ id: 'gravity', name: 'Gravity Gun', family: 'Graviton', desc: 'Tractor beam: yanks enemies toward you, dragging them out of formation.', category: 'disruption', visual: 'gravity', caliber: 0.8, mount: 'M', weight: 8, cost: 60,
    damage: 30, cooldown: 0.8, range: 8.5, ...GA, projectile: 'beam', ap: 1, impulse: -0.9 }),
  // ---------------- Bombs (flyers only) ----------------
  wpn({ id: 'bombs', name: 'Bomb Bay', family: 'Iron bombs', desc: 'Two heavy bombs per pass, released just short of the target. Two passes per load, then the bomber flies home to rearm. Flying designs only.', category: 'artillery', visual: 'charge', caliber: 0.5, mount: 'M', weight: 3.5, cost: 28, requires: 'air',
    damage: 260, burst: 2, cooldown: 1.2, magazine: 2, reload: 5, resupply: true, range: 1, ...G, projectile: 'arc', projectileSpeed: 6, splash: 1.6, ap: 0.5, spread: 0.3 }),
  wpn({ id: 'heavybomb', name: 'Blockbuster Bomb', family: 'Heavy bomb', desc: 'One huge bomb per load that flattens a whole block, then back home to rearm. Flying designs only.', category: 'artillery', visual: 'charge', caliber: 1, mount: 'M', weight: 7, cost: 60, requires: 'air',
    damage: 950, cooldown: 1, magazine: 1, reload: 6, resupply: true, range: 1, ...G, projectile: 'arc', projectileSpeed: 6, splash: 2.4, ap: 1, spread: 0.3, impulse: 1.5 }),
  wpn({ id: 'clusterbombs', name: 'Cluster Dispenser', family: 'Cluster', desc: 'Scatters 12 bomblets over a wide area per pass. Two passes per load, then the bomber flies home to rearm. Flying designs only.', category: 'artillery', visual: 'charge', barrels: 2, caliber: 0.8, mount: 'M', weight: 5, cost: 45, requires: 'air',
    damage: 75, pellets: 12, cooldown: 1.2, magazine: 2, reload: 5, resupply: true, range: 1.5, ...G, projectile: 'arc', projectileSpeed: 6, splash: 1, ap: 0, spread: 1.6 }),
  // ---------------- Flak ----------------
  wpn({ id: 'flak', name: 'Flak Cannon', family: 'Light flak', desc: 'Air only: bursting shells that splash whole groups of aircraft.', category: 'antiair', visual: 'flak', caliber: 0.5, mount: 'M', weight: 3, cost: 24,
    damage: 45, cooldown: 0.45, range: 10, ...A, magazine: 5, reload: 2.5, projectile: 'shell', projectileSpeed: 16, splash: 1.3, ap: 0, airBonus: 1.5 }),
  wpn({ id: 'heavyflak', name: 'Heavy Flak Battery', family: 'Heavy flak', desc: 'Air only: three-gun battery with long reach and huge bursts.', category: 'antiair', visual: 'flak', barrels: 3, caliber: 0.9, mount: 'M', weight: 9, cost: 60,
    damage: 70, burst: 3, cooldown: 2.2, range: 14, ...A, projectile: 'shell', projectileSpeed: 18, splash: 1.8, ap: 0, airBonus: 1.5 }),
  // ---------------- Melee ----------------
  wpn({ id: 'buzzsaw', name: 'Buzzsaw', family: 'Circular saw', desc: 'Contact saw: cheap, fast-cutting melee for light frames.', category: 'melee', visual: 'saw', caliber: 0.4, mount: 'S', weight: 1.4, cost: 10,
    damage: 30, cooldown: 0.25, range: 0.6, ...MELEE, ap: 1 }),
  wpn({ id: 'shockprod', name: 'Shock Prod', family: 'Stun prod', desc: 'Contact spike that builds paralysis with every jab.', category: 'melee', visual: 'prod', caliber: 0.3, mount: 'S', weight: 1, cost: 12,
    damage: 36, cooldown: 1, range: 0.7, ...MELEE, ap: 1, stun: 0.8 }),
  wpn({ id: 'ram', name: 'Spike Ram', family: 'Ram', desc: 'Contact ram: one huge blow that batters targets backwards.', category: 'melee', visual: 'ram', caliber: 0.5, mount: 'S', weight: 2, cost: 10,
    damage: 130, cooldown: 1.5, range: 0.4, ...MELEE, ap: 1, impulse: 1.2 }),
  wpn({ id: 'chainsaw', name: 'Chainsaw Arm', family: 'Chainsaw', desc: 'Relentless teeth: steady damage while locked on.', category: 'melee', visual: 'chainsaw', caliber: 0.6, mount: 'M', weight: 3, cost: 22,
    damage: 30, cooldown: 0.2, range: 0.7, ...MELEE, ap: 1 }),
  wpn({ id: 'claw', name: 'Power Claw', family: 'Hydraulic claw', desc: 'Hydraulic pincer: heavy armor pierce, and every grip jams the target\'s weapons (builds disarm).', category: 'melee', visual: 'claw', caliber: 0.6, mount: 'M', weight: 3.5, cost: 26,
    damage: 95, cooldown: 1, range: 0.8, ...MELEE, ap: 1, disarm: 1 }),
  wpn({ id: 'plasmablade', name: 'Plasma Blade', family: 'Energy blade', desc: 'Sweeping blade that cuts every enemy around its target.', category: 'melee', visual: 'blade', caliber: 0.6, mount: 'M', weight: 2.5, cost: 30,
    damage: 55, cooldown: 0.5, range: 0.9, ...MELEE, splash: 0.8, ap: 1 }),
  wpn({ id: 'hammer', name: 'Siege Hammer', family: 'Ground pound', desc: 'Colossal hammer: shockwave hits and knocks back everything nearby.', category: 'melee', visual: 'hammer', caliber: 0.9, mount: 'M', weight: 9, cost: 55,
    damage: 260, cooldown: 2, range: 0.9, ...MELEE, splash: 1.3, ap: 1, impulse: 1 }),
  wpn({ id: 'drill', name: 'Drill Lance', family: 'Bore drill', desc: 'Armor-boring drill: ignores all armor.', category: 'melee', visual: 'drill', caliber: 0.9, mount: 'M', weight: 8, cost: 50,
    damage: 48, cooldown: 0.15, range: 0.8, ...MELEE, ap: 1 }),
  // ---------------- Support (allies) ----------------
  util({ id: 'repair', name: 'Repair Beam', family: 'Light repair', desc: 'Heals the most damaged ally within 30 m.', category: 'support', visual: 'repair', caliber: 0.3, mount: 'S', weight: 1, cost: 17, heal: 22, range: 6 } /* [aura balance] 4 -> 6, to the target's edge */),
  util({ id: 'repairM', name: 'Repair Array', family: 'Heavy repair', desc: 'Industrial nano-repair array: heals the most damaged ally within 40 m.', category: 'support', visual: 'repair', caliber: 0.6, mount: 'M', weight: 2.5, cost: 40, heal: 55, range: 8 } /* [aura balance] 5 -> 8 */),
  util({ id: 'dome', name: 'Shield Dome', family: 'Area shield', desc: 'Projects a 150-point shield (at most half the ally\'s hp) onto every ally within 30 m. Domes don\'t stack.', category: 'support', visual: 'dome', caliber: 0.8, mount: 'M', weight: 6, cost: 20, shieldAura: { radius: 6, amount: 150 } } /* [aura balance] 3 -> 6, edge to edge */),
  util({ id: 'uplink', name: 'Command Uplink', family: 'Command', desc: 'Allies within 40 m fire 15% faster. Uplinks don\'t stack: more of them only widen the area.', category: 'support', visual: 'uplink', caliber: 0.5, mount: 'M', weight: 2, cost: 6, fireRateAura: { radius: 8, bonus: 0.15 } } /* [aura balance] 4 -> 8, edge to edge */),
  util({ id: 'sensor', name: 'Sensor Mast', family: 'Detection', desc: 'Reveals cloaked enemies within 60 m for your whole army.', category: 'stealth', visual: 'sensor', caliber: 0.4, mount: 'S', weight: 1, cost: 3, detect: 12 } /* [aura balance] 7 -> 12, edge to edge */),
  // ---------------- Defense ----------------
  util({ id: 'shield', name: 'Shield Projector', family: 'Energy shield', desc: 'Personal energy shield that absorbs 260 damage and regenerates.', category: 'defense', visual: 'shield', caliber: 0.5, mount: 'M', weight: 2.5, cost: 32, shield: 260 }),
  util({ id: 'shieldL', name: 'Shield Emitter', family: 'Light shield', desc: 'Small personal shield: absorbs 100 damage, regenerates.', category: 'defense', visual: 'shield', caliber: 0.25, mount: 'S', weight: 1, cost: 14, shield: 100 }),
  util({ id: 'shieldH', name: 'Aegis Barrier', family: 'Heavy shield', desc: 'Massive personal barrier: absorbs 700 damage.', category: 'defense', visual: 'shield', caliber: 0.9, mount: 'M', weight: 6, cost: 60, shield: 700 }),
  util({ id: 'pointdef', name: 'Point Defense Laser', family: 'APS', desc: 'Zaps incoming rockets, missiles and shells within 20 m of its hull, aimed at it or at nearby allies.', category: 'defense', visual: 'pointdef', caliber: 0.4, mount: 'S', weight: 1.2, cost: 24, pointDefense: { range: 4, cooldown: 0.6 } } /* [aura balance] 2.5 from the centre -> 4 from the hull edge */),
  util({ id: 'smoke', name: 'Smoke Launchers', family: 'Obscurant', desc: 'Below 60% hp, pops a smoke screen 10 m around its hull: nothing more than 12 m away can target units inside for 5s.', category: 'defense', visual: 'smoke', caliber: 0.3, mount: 'S', weight: 0.8, cost: 12, smoke: { radius: 2, duration: 5 } }),
  util({ id: 'reactive', name: 'Reactive Armor', family: 'ERA', desc: 'Explosive tiles: the next 6 shell/rocket/missile hits deal 75% less damage.', category: 'defense', visual: 'plate', caliber: 0.5, mount: 'M', weight: 3, cost: 22, reactive: 6, armor: 1 }),
  util({ id: 'mirror', name: 'Mirror Coating', family: 'Reflective', desc: 'Takes 45% less damage from beams, lightning, rails, plasma and flame.', category: 'defense', visual: 'plate', caliber: 0.4, mount: 'S', weight: 1, cost: 8, energyResist: 0.45 }),
  util({ id: 'hardened', name: 'Hardened Systems', family: 'EMP shielding', desc: 'Immune to stun, slow, disarm, burning and knockback.', category: 'defense', visual: 'coolant', caliber: 0.4, mount: 'S', weight: 1.2, cost: 3, hardened: true }),
  util({ id: 'nanite', name: 'Nanite Hull', family: 'Self-repair', desc: 'Regenerates 2.5% max hp per second when out of combat for 2s.', category: 'defense', visual: 'nanite', caliber: 0.4, mount: 'S', weight: 1, cost: 3, regen: 0.025 }),
  // ---------------- Stealth & ECM ----------------
  util({ id: 'stealth', name: 'Stealth Cloak', family: 'Optical cloak', desc: 'Optical cloak: enemies can\'t target it from range. It shows up while any enemy is within 12.5 m of its hull, for 1.5 s after each shot it fires, and inside enemy sensor range.', category: 'stealth', visual: 'cloak', caliber: 0.5, mount: 'M', weight: 2, cost: 15, cloak: 'stealth' }),
  util({ id: 'phantom', name: 'Phase Veil', family: 'Phase cloak', desc: 'Phase cloak: enemies can\'t target it even point-blank. It shows up only for 3 s after each shot it fires, and inside enemy sensor range. Heavier and pricier than the Stealth Cloak.', category: 'stealth', visual: 'cloak', caliber: 0.8, mount: 'M', weight: 4, cost: 20, cloak: 'phantom' }),
  util({ id: 'jammer', name: 'ECM Jammer', family: 'Jammer', desc: 'Enemy missiles lose lock on it and allies within 40 m; enemy guns are half as accurate against them. Jammers don\'t stack.', category: 'stealth', visual: 'jammer', caliber: 0.5, mount: 'M', weight: 2, cost: 5, jammer: 8 } /* [aura balance] 3 -> 8, edge to edge */),
  // ---------------- Systems ----------------
  util({ id: 'targeting', name: 'Targeting Computer', family: 'Fire control', desc: '+15% range for all weapons and tighter spread.', category: 'systems', visual: 'sensor', caliber: 0.3, mount: 'S', weight: 0.8, cost: 8, rangeBonus: 0.15, spreadMult: 0.6 }),
  util({ id: 'turbo', name: 'Turbo Engine', family: 'Engine', desc: '+20% move speed.', category: 'systems', visual: 'engine', caliber: 0.4, mount: 'S', weight: 1.2, cost: 3, speedBonus: 0.2 }),
  util({ id: 'gyro', name: 'Gyro Stabilizer', family: 'Stabilizer', desc: 'All weapons can fire on the move, with tighter spread.', category: 'systems', visual: 'gyro', caliber: 0.3, mount: 'S', weight: 1, cost: 3, gyro: true, spreadMult: 0.85 }),
  util({ id: 'autoloader', name: 'Autoloader', family: 'Ammo feed', desc: 'Clip weapons reload 40% faster.', category: 'systems', visual: 'coolant', caliber: 0.3, mount: 'S', weight: 1, cost: 14, reloadBonus: 0.4 }),
  util({ id: 'overclock', name: 'Overclocked Core', family: 'Overclock', desc: 'All weapons fire 20% faster.', category: 'systems', visual: 'coolant', caliber: 0.5, mount: 'M', weight: 2, cost: 5, fireRateBonus: 0.2 }),
  util({ id: 'selfdestruct', name: 'Self-Destruct Charge', family: 'Demolition', desc: 'Detonates on death for 300 damage up to 10 m beyond its hull.', category: 'systems', visual: 'charge', caliber: 0.4, mount: 'S', weight: 1.5, cost: 3, deathBlast: { damage: 300, radius: 2 } }),
  // ---------------- Giant class (G mounts, size-4 chassis) ----------------
  wpn({ id: 'siege240', name: '240mm Siege Cannon', family: '240mm', desc: 'Giant gun: armor-cracking shells with a wide blast.', category: 'cannon', visual: 'cannon', caliber: 1, mount: 'L', weight: 18, cost: 110,
    damage: 520, cooldown: 3, range: 12, ...G, projectile: 'shell', projectileSpeed: 18, splash: 0.8, ap: 1, spread: 0.2 }),
  wpn({ id: 'avenger', name: 'Hellstorm Rotary Cannon', family: 'Giant rotary', desc: 'Spins up over 2 s into a 30mm torrent that shreds air and ground alike.', category: 'autocannon', visual: 'gatling', barrels: 7, caliber: 1, mount: 'L', weight: 16, cost: 110,
    damage: 32, cooldown: 0.05, range: 9, ...GA, projectile: 'bullet', projectileSpeed: 24, splash: 0.2, ap: 0.5, spread: 0.5, spinUp: 2 }),
  wpn({ id: 'missilebattery', name: 'Missile Battery', family: '16-cell', desc: 'Sixteen homing missiles in one salvo.', category: 'missile', visual: 'missileRack', barrels: 16, caliber: 1, mount: 'L', weight: 17, cost: 120,
    damage: 140, burst: 16, cooldown: 16.2, range: 18, ...GA, projectile: 'missile', projectileSpeed: 10, splash: 0.5, ap: 0.5 }),
  wpn({ id: 'siegeplasma', name: 'Plasma Siege Projector', family: 'Siege plasma', desc: 'Lobs a sun-hot plasma mass that melts everything nearby and leaves a molten pool burning for 6 s.', category: 'energy', visual: 'plasma', caliber: 1, mount: 'L', weight: 18, cost: 115,
    damage: 380, cooldown: 3.5, range: 10, ...G, projectile: 'orb', projectileSpeed: 7, splash: 2, ap: 1, spread: 0.4, fireField: { radius: 2, duration: 6, dps: 30 } }),
  wpn({ id: 'clusterhow', name: 'Cluster Howitzer', family: 'Cluster 203mm', desc: 'Each shell bursts on landing into 10 bomblets that carpet the area around it. Minimum range 40 m.', category: 'artillery', visual: 'artillery', barrels: 2, caliber: 1, mount: 'L', weight: 18, cost: 115,
    damage: 100, cooldown: 6, range: 28, minRange: 8, ...G, projectile: 'arc', projectileSpeed: 12, splash: 1.2, ap: 0.5, spread: 1.2, cluster: { count: 10, radius: 2.6, damage: 60, splash: 0.9 } }),
  wpn({ id: 'skyfortress', name: 'Flak Fortress', family: 'Giant flak', desc: 'Air only: quad heavy flak turret. A no-fly zone on legs.', category: 'antiair', visual: 'flak', barrels: 4, caliber: 1, mount: 'L', weight: 15, cost: 95,
    damage: 90, burst: 4, cooldown: 2, range: 18, ...A, projectile: 'shell', projectileSpeed: 20, splash: 2.2, ap: 0.5, airBonus: 1.5 }),
  wpn({ id: 'stormtower', name: 'Storm Tower', family: 'Giant tesla', desc: 'Lightning that chains through 8 enemies, jolts them and overloads shields (3x).', category: 'disruption', visual: 'tesla', caliber: 1, mount: 'L', weight: 16, cost: 110,
    damage: 160, cooldown: 1.5, range: 7.5, ...GA, projectile: 'lightning', chain: 7, ap: 0.5, stun: 0.4, shieldMult: 3 }),
  wpn({ id: 'inferno', name: 'Inferno Projector', family: 'Giant flame', desc: 'A river of fire: wide cone, ferocious burn, and the ground stays ablaze where it lands.', category: 'flame', visual: 'flamer', caliber: 1, mount: 'L', weight: 15, cost: 95,
    damage: 9, cooldown: 0.1, range: 5.5, ...G, projectile: 'flame', projectileSpeed: 9, splash: 1.8, ap: 1, burn: { dps: 40, duration: 8 }, fireField: { radius: 1.6, duration: 6, dps: 22 } }),
  wpn({ id: 'grinder', name: 'Grinder Wheel', family: 'Giant saw', desc: 'Colossal grinder that sweeps through everything it touches.', category: 'melee', visual: 'saw', caliber: 1, mount: 'L', weight: 15, cost: 85,
    damage: 120, cooldown: 0.3, range: 1, ...MELEE, splash: 1.2, ap: 1 }),
  util({ id: 'bulwarkshield', name: 'Bastion Shield Generator', family: 'Giant shield', desc: 'Personal barrier that absorbs 1800 damage.', category: 'defense', visual: 'shield', caliber: 1, mount: 'L', weight: 12, cost: 90, shield: 1800 }),
  util({ id: 'domeG', name: 'Fortress Dome', family: 'Giant dome', desc: 'Projects a 400-point shield (at most half the ally\'s hp) onto every ally within 45 m. Domes don\'t stack.', category: 'support', visual: 'dome', caliber: 1, mount: 'L', weight: 14, cost: 110, shieldAura: { radius: 9, amount: 400 } } /* [aura balance] 5 -> 9 */),
  { id: 'plateG', name: 'Giant Armor', family: 'Giant plate', desc: '+16 armor, +1200 hp.', category: 'armor', visual: 'plate', caliber: 1, mount: 'L', kind: 'armor', weight: 26, cost: 130, armor: 16, hp: 1200 },
  // ---------------- Titan class (T mounts, size-5 chassis) ----------------
  wpn({ id: 'massdriver', name: 'Spinal Mass Driver', family: 'Titan rail', desc: 'Hull-length railgun. A wide slug that ploughs through a battle line at extreme range, and its shockwave throws and stuns everything it passes. Takes ages to recharge. Barely traverses: the hull must face the target.', category: 'precision', visual: 'rail', turretTurn: 0.05, spinal: 0.05, barrels: 2, caliber: 1, mount: 'XL', weight: 38, cost: 220,
    damage: 1700, cooldown: 9, range: 26, ...GA, projectile: 'rail', ap: 1, pierce: true, beamWidth: 0.45, pierceKeep: 0.75, impulse: 1.5, stun: 0.6 }),
  wpn({ id: 'doomsday', name: 'Doomsday Howitzer', family: 'Titan artillery', desc: 'Twin super-heavy howitzer: each shell blasts units off their feet and leaves a burning crater. Minimum range 50 m.', category: 'artillery', visual: 'artillery', barrels: 2, caliber: 1, mount: 'XL', weight: 40, cost: 230,
    damage: 560, cooldown: 8, range: 40, minRange: 10, ...G, projectile: 'arc', projectileSpeed: 14, splash: 4, ap: 0.5, spread: 1.5, impulse: 1.2, fireField: { radius: 2.5, duration: 8, dps: 25 } }),
  wpn({ id: 'annihilator', name: 'Annihilator Beam', family: 'Titan beam', desc: 'Continuous plasma beam that focuses as it holds: starts weak, and after 2.5 s on one target burns at 4x, melting even titans. Switching targets resets it.', category: 'energy', visual: 'plasma', barrels: 2, caliber: 1, mount: 'XL', weight: 36, cost: 220,
    damage: 60, cooldown: 0.2, range: 11, ...GA, projectile: 'beam', ap: 1, ramp: 4 }),
  wpn({ id: 'tactnuke', name: 'Tactical Nuke Launcher', family: 'Titan strategic', desc: 'One slow missile: an enormous blast whose shockwave hurls units away and knocks out their electronics, then a radioactive zone that eats through any armor for 15 s. Minimum range 50 m.', category: 'missile', visual: 'cruise', caliber: 1, mount: 'XL', weight: 34, cost: 240,
    damage: 1500, cooldown: 20, range: 40, minRange: 10, ...G, projectile: 'missile', projectileSpeed: 7, splash: 5, ap: 0.5, impulse: 2.5, stun: 1.5, fireField: { radius: 5, duration: 15, dps: 60, rad: true } }),
  wpn({ id: 'titanfist', name: 'Titan Fist', family: 'Titan melee', desc: 'A wrecking fist the size of a tank. The quake hurls units away and leaves them stunned.', category: 'melee', visual: 'hammer', caliber: 1, mount: 'XL', weight: 30, cost: 170,
    damage: 1100, cooldown: 2.2, range: 1.2, ...MELEE, splash: 2, ap: 1, impulse: 2, stun: 1.2 }),
  wpn({ id: 'stormcore', name: 'Tempest Core', family: 'Titan tesla', desc: 'Storm reactor: lightning chains through 11 enemies, stuns them and fries their weapons (can\'t fire for a while after).', category: 'disruption', visual: 'tesla', barrels: 3, caliber: 1, mount: 'XL', weight: 36, cost: 220,
    damage: 260, cooldown: 1.2, range: 9.5, ...GA, projectile: 'lightning', chain: 10, ap: 0.5, stun: 0.5, disarm: 1.5, shieldMult: 3 }),
  util({ id: 'aegisT', name: 'Titan Aegis Field', family: 'Titan shield', desc: '3000-point personal barrier plus a 700-point shield (at most half the ally\'s hp) on allies within 60 m. Domes don\'t stack.', category: 'support', visual: 'dome', caliber: 1, mount: 'XL', weight: 30, cost: 200, shield: 3000, shieldAura: { radius: 12, amount: 700 } } /* [aura balance] 8 -> 12 */),
  { id: 'plateT', name: 'Titan Plating', family: 'Titan plate', desc: '+24 armor, +3000 hp.', category: 'armor', visual: 'plate', caliber: 1, mount: 'XL', kind: 'armor', weight: 50, cost: 120, armor: 24, hp: 3000 },
  // ---------------- Armor ----------------
  { id: 'plateL', name: 'Armor Plate', family: 'Light plate', desc: '+3 armor, +60 hp.', category: 'armor', visual: 'plate', caliber: 0.3, mount: 'S', kind: 'armor', weight: 2, cost: 8, armor: 3, hp: 60 },
  { id: 'plateM', name: 'Composite Armor', family: 'Composite', desc: '+6 armor, +150 hp.', category: 'armor', visual: 'plate', caliber: 0.6, mount: 'M', kind: 'armor', weight: 5, cost: 12, armor: 6, hp: 150 },
  { id: 'plateH', name: 'Heavy Armor', family: 'Heavy plate', desc: '+10 armor, +400 hp.', category: 'armor', visual: 'plate', caliber: 0.9, mount: 'M', kind: 'armor', weight: 12, cost: 15, armor: 10, hp: 400 },
];

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((p) => [p.id, p] as const));
export const CHASSIS_BY_ID = byId(CHASSIS);
export const MOBILITY_BY_ID = byId(MOBILITY);
export const MODULE_BY_ID = byId(MODULES);

export const DOMAIN_NAMES: Record<Domain, string> = { ground: 'ground', jet: 'jet aircraft', heli: 'helicopter / VTOL' };
export const DOMAINS: { id: Domain; name: string; desc: string }[] = [
  { id: 'ground', name: 'Ground', desc: 'Tanks, walkers, hovercraft and emplacements.' },
  { id: 'jet', name: 'Jet aircraft', desc: 'Fast fixed-wing fighters and bombers. Fire on strafing passes.' },
  { id: 'heli', name: 'Helicopter / VTOL', desc: 'Rotorcraft and grav-lift VTOLs. Hover over the battle; only anti-air can hit them.' },
];
export const chassisDomain = (c: ChassisDef): Domain => c.domain ?? 'ground';
export const mobilityDomain = (m: MobilityDef): Domain => m.domain ?? 'ground';

export const MOUNT_RANK: Record<MountClass, number> = { S: 1, M: 2, L: 3, XL: 4 };
/** Visual/physical scale tier of a module for rendering & traverse: 1 small, 2 medium, 3 heavy medium (weight >= 6),
 *  4 giant-class (L), 5 titan-class (XL). */
export function moduleTier(m: ModuleDef): 1 | 2 | 3 | 4 | 5 {
  if (m.mount === 'S') return 1;
  if (m.mount === 'M') return m.weight >= 6 ? 3 : 2;
  if (m.mount === 'L') return 4;
  return 5;
}
/** Player-facing socket sizes, T-shirt style: S · M · L (giant-class, giant & titan hulls only) · XL (titan-class, titan hulls only). */
export const MOUNT_LETTER: Record<MountClass, string> = { S: 'S', M: 'M', L: 'L', XL: 'XL' };
export const MOUNT_NAME: Record<MountClass, string> = { S: 'Small', M: 'Medium', L: 'Large (giant-class)', XL: 'Extra large (titan-class)' };
const RANK = MOUNT_RANK;

export const ROLES: { id: Role; name: string; desc: string }[] = [
  { id: 'raider', name: 'Raider', desc: 'Fast and light. Picks off weak or isolated targets and harasses the back line.' },
  { id: 'skirmisher', name: 'Skirmisher', desc: 'Medium range and mobility. Out-ranges riots, out-runs assaults.' },
  { id: 'riot', name: 'Riot', desc: 'Short-range splash and sustained fire. Shreds swarms and raiders.' },
  { id: 'assault', name: 'Assault', desc: 'Tough, well-armed frontliners that push through defenses.' },
  { id: 'tank', name: 'Tank', desc: 'Huge hp and armor. Soaks damage so the army behind can work.' },
  { id: 'artillery', name: 'Artillery', desc: 'Long range, fragile. Must be protected; punishes clumped or static enemies.' },
  { id: 'antiair', name: 'Anti-air', desc: 'Dedicated to swatting aircraft.' },
  { id: 'support', name: 'Support', desc: 'Repairs, shields and buffs allies.' },
  { id: 'scout', name: 'Scout', desc: 'Cheap and quick. Spots cloaked units and screens.' },
  { id: 'flyer', name: 'Flyer', desc: 'Aircraft: only anti-air can hit them.' },
  { id: 'bomber', name: 'Bomber', desc: 'Aircraft that drop heavy ordnance on ground targets.' },
  { id: 'siege', name: 'Siege', desc: 'Breaks entrenched positions and emplacements from extreme range.' },
  { id: 'stealth', name: 'Stealth', desc: 'Cloaked, ambushes and ECM.' },
  { id: 'melee', name: 'Melee', desc: 'Close-combat brawlers that need to reach their target.' },
];

const CATEGORY_ROLES: Record<string, Role[]> = {
  machinegun: ['riot', 'antiair', 'raider'], autocannon: ['assault', 'skirmisher', 'antiair'], cannon: ['assault', 'tank'],
  precision: ['skirmisher', 'siege'], rocket: ['riot', 'artillery'], missile: ['skirmisher', 'antiair', 'siege'],
  artillery: ['artillery', 'siege'], energy: ['skirmisher', 'assault'], flame: ['riot', 'melee'],
  disruption: ['riot', 'support', 'skirmisher'], antiair: ['antiair'], melee: ['melee', 'raider'],
  support: ['support'], defense: ['tank', 'support'], stealth: ['stealth', 'scout'], systems: ['skirmisher', 'raider'], armor: ['tank', 'assault'],
};
/** Role tags of a module, derived from its category and characteristics. */
export function moduleRoles(m: ModuleDef): Role[] {
  const r = new Set<Role>(CATEGORY_ROLES[m.category] ?? []);
  if (m.targetsAir && !m.targetsGround) r.add('antiair');
  if (m.requires === 'air') { r.add('bomber'); r.add('flyer'); }
  if ((m.range ?? 0) >= 10) { r.add('artillery'); r.add('siege'); }
  if ((m.splash ?? 0) >= 1 && (m.range ?? 0) <= 6) r.add('riot');
  if (m.detect) r.add('scout');
  if (m.cloak) r.add('stealth');
  return [...r];
}
/** Can a module of class `module` go in a slot of class `slot`? */
export const fitsMount = (slot: MountClass, module: MountClass) => RANK[module] <= RANK[slot];

/** Is this chassis/mobility pairing legal? Returns a reason string when not. */
export function pairingError(chassisId: string, mobilityId: string): string | null {
  const c = CHASSIS_BY_ID.get(chassisId);
  const m = MOBILITY_BY_ID.get(mobilityId);
  if (!c) return 'Unknown chassis';
  if (!m) return 'Unknown mobility';
  if (!m.sizes.includes(c.size)) return `${m.name} can't carry a size-${c.size} chassis`;
  const cd = c.domain ?? 'ground', md = m.domain ?? 'ground';
  if (cd !== md) return `${c.name} is a ${DOMAIN_NAMES[cd]} chassis; ${m.name} is ${DOMAIN_NAMES[md]} mobility`;
  if (c.traits.includes('airOnly') && m.kind !== 'air') return `${c.name} must fly`;
  if (c.mobility && !c.mobility.includes(m.id)) return `${c.name} can't use ${m.name}`;
  return null;
}
