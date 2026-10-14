// Part catalog: 33 chassis covering every role (light → titan, incl. mechs, spiders and odd frames), 13 mobility systems, 104 modules in 5 mount classes. All parts carry role tags.
// Balance numbers live here; stats.ts turns a Design into UnitStats.

import type { ChassisDef, Domain, MobilityDef, ModuleCategory, ModuleDef, MountClass, Role } from './types.ts';

export const CHASSIS: ChassisDef[] = [
  { id: 'scout', name: 'Scout Frame', desc: 'Tiny, cheap and quick. One light mount.', size: 1, hp: 140, armor: 0, weight: 3, cost: 10, mounts: ['S'], agility: 1.3, roles: ['scout', 'raider'], traits: [], shape: 'wedge' },
  { id: 'drone', name: 'Drone Core', desc: 'Featherweight quad-rotor drone core.', size: 1, hp: 140, armor: 0, weight: 1.5, cost: 10, domain: 'heli', mounts: ['S'], agility: 1.4, roles: ['scout', 'flyer'], traits: ['compact'], shape: 'pod' },
  { id: 'raider', name: 'Raider Frame', desc: 'Light skirmisher with twin light mounts.', size: 1, hp: 210, armor: 2, weight: 5, cost: 75, mounts: ['S', 'S'], agility: 1.15, roles: ['raider'], traits: [], shape: 'box' },
  { id: 'warden', name: 'Warden Hull', desc: 'Sturdy medium hull built to hold a line.', size: 2, hp: 560, armor: 6, weight: 14, cost: 115, mounts: ['M', 'S'], agility: 0.95, roles: ['assault', 'tank'], traits: [], shape: 'hex' },
  { id: 'striker', name: 'Striker Frame', desc: 'Aggressive medium frame with three mounts.', size: 2, hp: 430, armor: 4, weight: 12, cost: 160, footprint: [2, 3], mounts: ['M', 'M', 'S'], agility: 1.0, roles: ['skirmisher', 'assault'], traits: [], shape: 'cross' },
  { id: 'longarm', name: 'Longarm Platform', desc: 'Stabilized platform: one heavy mount, +20% weapon range.', size: 2, hp: 360, armor: 3, weight: 12, cost: 250, footprint: [1, 3], mounts: ['M'], agility: 0.85, roles: ['artillery', 'siege'], traits: ['rangeBoost'], shape: 'long' },
  { id: 'aegis', name: 'Aegis Frame', desc: 'Support frame. Field-repairs nearby allies.', size: 2, hp: 610, armor: 4, weight: 13, cost: 60, mounts: ['M', 'S'], agility: 0.95, roles: ['support'], traits: ['repairAura'], shape: 'round' },
  { id: 'gunship', name: 'Gunship', desc: 'Attack helicopter airframe with stub-wing mounts.', size: 2, hp: 420, armor: 3, weight: 8, cost: 60, footprint: [2, 3], domain: 'heli', mounts: ['M', 'M'], agility: 1.1, roles: ['flyer'], traits: ['airOnly'], shape: 'airframe' },
  { id: 'bastion', name: 'Bastion Hull', desc: 'Massive armored hull. Slow, nearly unbreakable.', size: 3, hp: 1500, armor: 14, weight: 38, cost: 400, mounts: ['M', 'M', 'M'], agility: 0.8, roles: ['tank', 'assault'], traits: [], shape: 'fortress' },
  { id: 'colossus', name: 'Monarch Frame', desc: 'Walking arsenal with four mounts.', size: 3, hp: 1250, armor: 10, weight: 34, cost: 405, footprint: [3, 4], mounts: ['M', 'M', 'M', 'S'], agility: 0.85, roles: ['assault', 'siege'], traits: [], shape: 'titan' },
  // ---- Odd-shaped frames ----
  { id: 'mantis', name: 'Needle Frame', desc: 'Lanky light strider with twin blade-arm mounts.', size: 1, hp: 185, armor: 1, weight: 4, cost: 35, footprint: [1, 2], mounts: ['S', 'S'], agility: 1.35, mobility: ['legs', 'jumpjets', 'spider', 'hover'], roles: ['raider', 'melee'], traits: [], shape: 'mantis' },
  { id: 'strider', name: 'Strider Mech', desc: 'Humanoid mech: arm guns and a shoulder mount. Needs legs.', size: 2, hp: 480, armor: 5, weight: 12, cost: 140, mounts: ['M', 'S', 'S'], agility: 1.05, mobility: ['legs', 'jumpjets', 'spider', 'anchor'], roles: ['skirmisher'], traits: [], shape: 'mech' },
  { id: 'arachnid', name: 'Orbwalker Core', desc: 'Orb-bodied walker pod with twin dorsal mounts. Walks on multi-legs or jump legs.', size: 2, hp: 420, armor: 4, weight: 11, cost: 190, mounts: ['M', 'M'], agility: 1.1, mobility: ['spider', 'jumpjets', 'anchor'], roles: ['skirmisher', 'raider'], traits: [], shape: 'arachnid' },
  { id: 'crab', name: 'Bunker Crawler', desc: 'Wide, low, heavily plated mobile bunker with arm mounts.', size: 2, hp: 600, armor: 8, weight: 15, cost: 240, footprint: [3, 2], mounts: ['M', 'M', 'S'], agility: 0.85, mobility: ['spider', 'halftrack', 'treads', 'hover', 'anchor'], roles: ['riot', 'tank'], traits: [], shape: 'crab' },
  { id: 'saucer', name: 'Saucer Disc', desc: 'Round disc hull with an all-round turret ring. Hovers or walks.', size: 2, hp: 400, armor: 4, weight: 10, cost: 210, mounts: ['M', 'M', 'S'], agility: 1.2, mobility: ['hover', 'anchor', 'spider'], roles: ['skirmisher', 'antiair'], traits: [], shape: 'saucer' },
  { id: 'deltawing', name: 'Delta Wing', desc: 'Triangular strike aircraft. Must fly.', size: 2, hp: 340, armor: 3, weight: 8, cost: 75, footprint: [2, 3], domain: 'jet', mounts: ['M', 'S', 'S'], agility: 1.15, roles: ['flyer', 'bomber'], traits: ['airOnly'], shape: 'delta' },
  { id: 'warlord', name: 'Warlord Mech', desc: 'Heavy humanoid mech with a shoulder cannon and arm weapons.', size: 3, hp: 1350, armor: 11, weight: 34, cost: 430, footprint: [4, 3], mounts: ['M', 'M', 'M', 'S'], agility: 0.9, mobility: ['titanlegs', 'spider', 'anchor'], roles: ['assault'], traits: [], shape: 'warlord' },
  { id: 'scorpion', name: 'Tailgun Crawler', desc: 'Armored crawler with a crane-boom heavy weapon over its back and twin arm mounts.', size: 3, hp: 1200, armor: 12, weight: 32, cost: 260, footprint: [3, 4], mounts: ['M', 'M', 'M'], agility: 0.95, mobility: ['spider', 'treads', 'anchor'], roles: ['assault', 'siege'], traits: [], shape: 'scorpion' },
  { id: 'centipede', name: 'Landtrain Hull', desc: 'Articulated multi-car land-train with four medium mounts down its spine.', size: 3, hp: 1300, armor: 9, weight: 33, cost: 525, footprint: [2, 5], mounts: ['M', 'M', 'M', 'M'], agility: 0.8, mobility: ['spider', 'halftrack', 'treads'], roles: ['riot', 'assault'], traits: [], shape: 'centipede' },
  // ---- Role-specialist frames ----
  { id: 'carriage', name: 'Gun Carriage', desc: 'Light, thin-skinned carriage that holds a medium weapon. Cheap artillery or tank-hunter.', size: 1, hp: 110, armor: 0, weight: 3, cost: 40, mounts: ['M'], agility: 0.9, roles: ['artillery', 'skirmisher'], traits: [], shape: 'carriage' },
  { id: 'hunter', name: 'Hunter Frame', desc: 'Fast, lightly armored skirmisher frame. Strikes from range and keeps moving.', size: 2, hp: 360, armor: 2, weight: 9, cost: 80, footprint: [1, 2], mounts: ['M', 'S'], agility: 1.25, roles: ['skirmisher', 'raider'], traits: [], shape: 'hunter' },
  { id: 'riot', name: 'Riot Frame', desc: 'Sloped front armor and twin medium mounts. Built to wade into swarms.', size: 2, hp: 650, armor: 9, weight: 15, cost: 230, footprint: [3, 2], mounts: ['M', 'M'], agility: 0.9, roles: ['riot', 'tank'], traits: [], shape: 'riot' },
  { id: 'interceptor', name: 'Interceptor', desc: 'Light fighter airframe. Must fly.', size: 1, hp: 120, armor: 1, weight: 1.2, cost: 15, footprint: [1, 2], domain: 'jet', mounts: ['S', 'S'], agility: 1.3, roles: ['antiair', 'flyer', 'raider'], traits: ['airOnly'], shape: 'interceptor' },
  { id: 'siegeplat', name: 'Siege Platform', desc: 'Thin-skinned heavy platform carrying two heavy weapons. Pure artillery: keep it behind the line.', size: 3, hp: 800, armor: 3, weight: 22, cost: 265, footprint: [2, 4], mounts: ['M', 'M'], agility: 0.7, roles: ['artillery', 'siege'], traits: [], shape: 'siegeplat' },
  { id: 'juggernaut', name: 'Monolith Hull', desc: 'A wall of armor with token weapons. Soaks fire for the army behind it.', size: 3, hp: 2100, armor: 18, weight: 40, cost: 250, footprint: [4, 3], mounts: ['M', 'S'], agility: 0.75, roles: ['tank'], traits: [], shape: 'juggernaut' },
  { id: 'bomberhull', name: 'Heavy Bomber', desc: 'Big flying bomb truck with three medium bays. Grav lifters or nothing.', size: 3, hp: 1170, armor: 5, weight: 24, cost: 200, footprint: [3, 4], domain: 'heli', mounts: ['M', 'M', 'M'], agility: 0.7, roles: ['bomber', 'flyer'], traits: ['airOnly'], shape: 'bomber' },
  // ---- Aircraft ----
  { id: 'strikejet', name: 'Strike Jet', desc: 'Multirole fighter-bomber with a centreline and two wing hardpoints.', size: 2, hp: 330, armor: 2, weight: 7, cost: 80, footprint: [2, 3], mounts: ['M', 'S', 'S'], agility: 1.2, domain: 'jet', roles: ['flyer', 'raider', 'antiair'], traits: [], shape: 'strikejet' },
  { id: 'stratobomber', name: 'Strato Bomber', desc: 'Long-range jet bomber with three bomb bays and a tail gun.', size: 3, hp: 900, armor: 4, weight: 18, cost: 300, footprint: [4, 4], mounts: ['M', 'M', 'M', 'S'], agility: 0.8, domain: 'jet', roles: ['bomber', 'flyer'], traits: [], shape: 'stratobomber' },
  { id: 'heavyheli', name: 'Heavy Helicopter', desc: 'Tandem-rotor heavy helicopter. Slow, tough, hauls big guns.', size: 3, hp: 1000, armor: 6, weight: 20, cost: 280, footprint: [2, 4], mounts: ['M', 'M', 'S'], agility: 0.85, domain: 'heli', roles: ['flyer', 'assault'], traits: [], shape: 'heavyheli' },
  // ---- Giant class (size 4, 20 m) ----
  { id: 'goliath', name: 'Warhulk Frame', desc: 'Giant assault frame: a giant-class mount backed by two heavies.', size: 4, hp: 4160, armor: 16, weight: 70, cost: 190, footprint: [4, 5], mounts: ['L', 'M', 'M', 'M'], agility: 0.75, roles: ['assault'], traits: [], shape: 'goliath' },
  { id: 'leviathan', name: 'Leviathan Hull', desc: 'Giant battle hull with twin giant-class mounts.', size: 4, hp: 3800, armor: 20, weight: 82, cost: 725, footprint: [3, 6], mounts: ['L', 'L', 'M', 'M'], agility: 0.65, roles: ['siege', 'assault'], traits: [], shape: 'leviathan' },
  { id: 'carrier', name: 'Sky Carrier', desc: 'Giant flying hull. Must fly on grav lifters.', size: 4, hp: 2100, armor: 10, weight: 50, cost: 1100, footprint: [6, 3], domain: 'heli', mounts: ['L', 'M', 'M', 'M'], agility: 0.8, roles: ['flyer', 'bomber'], traits: ['airOnly'], shape: 'carrier' },
  { id: 'broodmother', name: 'Matriarch', desc: 'Giant multi-legged walking fortress with a giant-class dorsal weapon and four more mounts.', size: 4, hp: 3000, armor: 14, weight: 66, cost: 650, footprint: [5, 4], mounts: ['L', 'M', 'M', 'M', 'S'], agility: 0.85, mobility: ['spider', 'anchor'], roles: ['riot', 'assault'], traits: [], shape: 'broodmother' },
  // ---- Titan class (size 5, 25 m) ----
  { id: 'titan', name: 'Titan Walker', desc: 'Titan-class war machine with a titan mount and a giant mount.', size: 5, hp: 6500, armor: 22, weight: 120, cost: 955, footprint: [7, 7], mounts: ['XL', 'L', 'M', 'M', 'M'], agility: 0.7, roles: ['assault', 'siege'], traits: [], shape: 'colossal' },
  { id: 'citadel', name: 'Citadel Fortress', desc: 'Mobile fortress with twin titan mounts. The biggest thing on the field.', size: 5, hp: 8000, armor: 28, weight: 140, cost: 1915, footprint: [8, 7], mounts: ['XL', 'XL', 'L', 'M', 'M', 'S'], agility: 0.55, roles: ['siege', 'tank'], traits: [], shape: 'citadel' },
  { id: 'arachne', name: 'Weaver Titan', desc: 'Titan-class walking fortress: a titan mount and twin giant mounts on many legs.', size: 5, hp: 7630, armor: 20, weight: 115, cost: 340, footprint: [8, 8], mounts: ['XL', 'L', 'L', 'M'], agility: 0.75, mobility: ['spider', 'anchor'], roles: ['assault'], traits: [], shape: 'arachne' },
];

export const MOBILITY: MobilityDef[] = [
  { id: 'wheels', name: 'Wheels', desc: 'Fast and cheap, but fragile and light-duty.', kind: 'ground', sizes: [1, 2], speed: 3.2, turn: 4, capacity: [8, 24, 0, 0, 0], weight: 1.5, hp: 0, armor: 0, cost: 8, traits: [], roles: ['raider', 'scout'] },
  { id: 'halftrack', name: 'Half-Track', desc: 'Wheels up front, treads behind. Balanced all-rounder.', kind: 'ground', sizes: [1, 2, 3], speed: 2.3, turn: 2.6, capacity: [9, 27, 52, 0, 0], weight: 2.5, hp: 30, armor: 1, cost: 14, traits: [], roles: ['skirmisher', 'assault'] },
  { id: 'treads', name: 'Tank Treads', desc: 'Heavy-duty treads. Slow, tough, carries anything.', kind: 'ground', sizes: [2, 3, 4], speed: 1.6, turn: 1.8, capacity: [0, 32, 66, 125, 0], weight: 4, hp: 60, armor: 3, cost: 22, traits: ['crush'], roles: ['tank', 'assault'] },
  { id: 'legs', name: 'Bipedal Legs', desc: 'Nimble walker. Fires while moving.', kind: 'ground', sizes: [1, 2], speed: 2.0, turn: 3.5, capacity: [9, 24, 0, 0, 0], weight: 2, hp: 20, armor: 0, cost: 14, traits: ['fireOnMove'], roles: ['skirmisher', 'raider'] },
  { id: 'spider', name: 'Spider Legs', desc: 'Six-legged stable walker. Better accuracy, carries heavy loads.', kind: 'ground', sizes: [1, 2, 3, 4, 5], speed: 1.6, turn: 3, capacity: [10, 29, 58, 110, 210], weight: 3.5, hp: 40, armor: 2, cost: 22, traits: ['stable'], roles: ['artillery', 'riot', 'skirmisher'] },
  { id: 'jumpjets', name: 'Jump Legs', desc: 'Leaps over obstacles straight into the fight.', kind: 'ground', sizes: [1, 2], speed: 2.0, turn: 3, capacity: [8, 21, 0, 0, 0], weight: 2.5, hp: 10, armor: 0, cost: 22, traits: ['leap'], roles: ['raider', 'melee'] },
  { id: 'hover', name: 'Hover Skirt', desc: 'Skims the ground. Very fast, hard to hit.', kind: 'ground', sizes: [1, 2], speed: 3.6, turn: 2.2, capacity: [6, 17, 0, 0, 0], weight: 1.5, hp: 0, armor: 0, cost: 18, traits: ['evasive'], roles: ['raider', 'scout'] },
  { id: 'rotor', name: 'Rotor', desc: 'Helicopter rotors. Flies over ground units; only anti-air can hit it.', kind: 'air', sizes: [1, 2, 3], speed: 2.8, turn: 3, capacity: [5, 17, 36, 0, 0], weight: 2, hp: 0, armor: 0, cost: 28, domain: 'heli', traits: ['fireOnMove'], roles: ['flyer', 'support'] },
  { id: 'jet', name: 'Jet Thrusters', desc: 'Very fast strafing flyer. Fires on the pass.', kind: 'air', sizes: [1, 2, 3], speed: 4.6, turn: 1.6, capacity: [4, 14, 30, 0, 0], weight: 1.5, hp: 0, armor: 0, cost: 32, domain: 'jet', traits: ['fireOnMove', 'strafe', 'evasive'], roles: ['flyer', 'raider', 'bomber'] },
  { id: 'megatracks', name: 'Colossal Tracks', desc: 'Quad track assemblies for giant and titan hulls. Crushes anything underfoot.', kind: 'ground', sizes: [4, 5], speed: 1.25, turn: 1.2, capacity: [0, 0, 0, 140, 245], weight: 6, hp: 120, armor: 5, cost: 30, traits: ['crush'], roles: ['tank', 'assault'] },
  { id: 'titanlegs', name: 'Titan Legs', desc: 'Towering walker legs. Fires on the move and stomps smaller units.', kind: 'ground', sizes: [3, 4, 5], speed: 1.4, turn: 1.6, capacity: [0, 0, 62, 122, 220], weight: 5, hp: 80, armor: 3, cost: 30, traits: ['fireOnMove', 'crush'], roles: ['assault'] },
  { id: 'gravlift', name: 'Grav Lifters', desc: 'Anti-gravity lifters that make heavy and giant hulls fly.', kind: 'air', sizes: [3, 4], speed: 1.6, turn: 1.2, capacity: [0, 0, 50, 100, 0], weight: 4, hp: 0, armor: 0, cost: 50, domain: 'heli', traits: ['fireOnMove'], roles: ['flyer', 'bomber'] },
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
  wpn({ id: 'mg', name: '7.62mm Machine Gun', family: '7.62mm', desc: 'Rapid fire. Shreds light units and aircraft; weak vs armor.', category: 'machinegun', visual: 'gun', caliber: 0.2, mount: 'S', weight: 1, cost: 6,
    damage: 9, cooldown: 0.15, range: 5.5, ...GA, projectile: 'bullet', projectileSpeed: 22, ap: 0, spread: 0.35 }),
  wpn({ id: 'twinmg', name: 'Twin 7.62mm MG', family: 'Twin 7.62mm', desc: 'Two coaxial machine guns on one mount. Double the lead.', category: 'machinegun', visual: 'gun', barrels: 2, caliber: 0.2, mount: 'S', weight: 1.8, cost: 11,
    damage: 9, cooldown: 0.075, range: 5.5, ...GA, projectile: 'bullet', projectileSpeed: 22, ap: 0, spread: 0.45 }),
  wpn({ id: 'hmg', name: '12.7mm Heavy MG', family: '12.7mm', desc: 'Heavier rounds with a little armor pierce and reach.', category: 'machinegun', visual: 'gun', caliber: 0.4, mount: 'S', weight: 1.6, cost: 10,
    damage: 16, cooldown: 0.22, range: 6.5, ...GA, magazine: 25, reload: 2.5, projectile: 'bullet', projectileSpeed: 24, ap: 0.15, spread: 0.3 }),
  wpn({ id: 'minigun', name: 'Rotary Minigun', family: 'Rotary', desc: 'Six spinning barrels. A wall of bullets at close range.', category: 'machinegun', visual: 'gatling', barrels: 6, caliber: 0.5, mount: 'M', weight: 3, cost: 22,
    damage: 8, cooldown: 0.04, range: 6, ...GA, projectile: 'bullet', projectileSpeed: 24, ap: 0, spread: 0.65 }),
  wpn({ id: 'shotgun', name: 'Scattergun', family: 'Scatter', desc: 'Six-pellet blasts. Brutal up close, useless far away.', category: 'machinegun', visual: 'shotgun', caliber: 0.5, mount: 'S', weight: 1.4, cost: 9,
    damage: 12, pellets: 6, cooldown: 1, range: 3.5, ...GA, projectile: 'bullet', projectileSpeed: 20, ap: 0.1, spread: 0.9 }),
  // ---------------- Autocannons ----------------
  wpn({ id: 'ac20', name: '20mm Autocannon', family: '20mm', desc: 'Light autocannon. Small explosive rounds.', category: 'autocannon', visual: 'gun', caliber: 0.55, mount: 'S', weight: 1.8, cost: 14,
    damage: 18, cooldown: 0.2, range: 7, ...GA, magazine: 10, reload: 2, projectile: 'bullet', projectileSpeed: 20, splash: 0.2, ap: 0.2, spread: 0.3 }),
  wpn({ id: 'autocannon', name: '30mm Autocannon', family: '30mm', desc: 'Versatile mid-caliber gun. Hits ground and air.', category: 'autocannon', visual: 'gun', caliber: 0.5, mount: 'M', weight: 3, cost: 22,
    damage: 32, cooldown: 0.3, range: 7.5, ...GA, magazine: 6, reload: 2, projectile: 'bullet', projectileSpeed: 18, splash: 0.3, ap: 0.3, spread: 0.3 }),
  wpn({ id: 'twin30', name: 'Twin 30mm Autocannon', family: 'Twin 30mm', desc: 'Two 30mm guns on one mount: double firepower, heavier and pricier.', category: 'autocannon', visual: 'gun', barrels: 2, caliber: 0.5, mount: 'M', weight: 5, cost: 38,
    damage: 32, cooldown: 0.15, range: 7.5, ...GA, magazine: 12, reload: 2.4, projectile: 'bullet', projectileSpeed: 18, splash: 0.3, ap: 0.3, spread: 0.35 }),
  wpn({ id: 'ac40', name: '40mm Bofors', family: '40mm', desc: 'Long-reach autocannon with proximity rounds, deadly to aircraft.', category: 'autocannon', visual: 'gun', caliber: 0.8, mount: 'M', weight: 4, cost: 28,
    damage: 55, cooldown: 0.5, range: 9, ...GA, magazine: 4, reload: 2.5, projectile: 'bullet', projectileSpeed: 20, splash: 0.5, ap: 0.3, spread: 0.3, airBonus: 1.3 }),
  wpn({ id: 'quad20', name: 'Quad 20mm AA', family: 'Quad 20mm', desc: 'Four 20mm barrels slaved to an AA director. Air only.', category: 'autocannon', visual: 'gun', barrels: 4, caliber: 0.45, mount: 'M', weight: 4, cost: 26,
    damage: 18, cooldown: 0.05, range: 9, ...A, magazine: 24, reload: 3, projectile: 'bullet', projectileSpeed: 24, splash: 0.2, ap: 0.2, spread: 0.3, airBonus: 1.4 }),
  // ---------------- Cannons ----------------
  wpn({ id: 'cannon75', name: '75mm Gun', family: '75mm', desc: 'Medium tank gun. Solid armor pierce on a medium mount.', category: 'cannon', visual: 'cannon', caliber: 0.5, mount: 'M', weight: 5, cost: 32,
    damage: 95, cooldown: 0.7, range: 8.5, ...G, magazine: 3, reload: 4, projectile: 'shell', projectileSpeed: 20, splash: 0.3, ap: 0.55, spread: 0.2 }),
  wpn({ id: 'cannon', name: '120mm Heavy Cannon', family: '120mm', desc: 'Armor-piercing shells. The tank killer.', category: 'cannon', visual: 'cannon', caliber: 0.8, mount: 'M', weight: 8, cost: 50,
    damage: 190, cooldown: 2.2, range: 9, ...G, projectile: 'shell', projectileSpeed: 20, splash: 0.3, ap: 0.7, spread: 0.2 }),
  wpn({ id: 'twin120', name: 'Twin 120mm Cannon', family: 'Twin 120mm', desc: 'Two heavy cannons in one turret. Twice the punch, huge weight.', category: 'cannon', visual: 'cannon', barrels: 2, caliber: 0.8, mount: 'M', weight: 13, cost: 85,
    damage: 190, cooldown: 1.1, range: 9, ...G, projectile: 'shell', projectileSpeed: 20, splash: 0.3, ap: 0.7, spread: 0.25 }),
  wpn({ id: 'gauss', name: 'Gauss Cannon', family: 'Gauss', desc: 'Magnetic slug that punches through every unit in its path.', category: 'cannon', visual: 'gauss', caliber: 0.8, mount: 'M', weight: 10, cost: 75,
    damage: 240, cooldown: 2.6, range: 12, ...GA, projectile: 'shell', projectileSpeed: 34, pierce: true, ap: 0.8, spread: 0.1 }),
  // ---------------- Sniper & rail ----------------
  wpn({ id: 'sniper', name: 'Sniper Rifle', family: 'Sniper', desc: 'Long-barrel precision rifle. Picks off units from far away.', category: 'precision', visual: 'sniper', caliber: 0.4, mount: 'S', weight: 1.5, cost: 20,
    damage: 140, cooldown: 3.5, range: 14, ...G, projectile: 'bullet', projectileSpeed: 60, ap: 0.6, spread: 0 }),
  wpn({ id: 'lightrail', name: 'Rail Rifle', family: 'Light rail', desc: 'Compact railgun. Pierces a line of enemies.', category: 'precision', visual: 'rail', caliber: 0.5, mount: 'M', weight: 4, cost: 40,
    damage: 150, cooldown: 3, range: 14, ...GA, projectile: 'rail', ap: 0.9, pierce: true }),
  wpn({ id: 'railgun', name: 'Railgun', family: 'Heavy rail', desc: 'Pierces everything in a line. Extreme range.', category: 'precision', visual: 'rail', caliber: 0.9, mount: 'M', weight: 9, cost: 75,
    damage: 320, cooldown: 4.5, range: 17, ...GA, projectile: 'rail', ap: 1, pierce: true }),
  // ---------------- Rockets ----------------
  wpn({ id: 'rocketL', name: 'Light Rocket Rack', family: '2-tube', desc: 'Pair of unguided rockets.', category: 'rocket', visual: 'rocketPod', barrels: 2, caliber: 0.3, mount: 'S', weight: 1.5, cost: 12,
    damage: 32, burst: 2, cooldown: 3, range: 9, ...G, projectile: 'rocket', projectileSpeed: 11, splash: 0.7, ap: 0.2, spread: 0.7 }),
  wpn({ id: 'rockets', name: 'Rocket Pod', family: '4-tube', desc: 'Salvo of 4 unguided rockets with splash.', category: 'rocket', visual: 'rocketPod', barrels: 4, caliber: 0.5, mount: 'M', weight: 3, cost: 30,
    damage: 42, burst: 4, cooldown: 4, range: 10, ...G, projectile: 'rocket', projectileSpeed: 11, splash: 1, ap: 0.2, spread: 0.8 }),
  wpn({ id: 'incendiary', name: 'Incendiary Rockets', family: 'Napalm 4-tube', desc: 'Rockets that leave targets burning.', category: 'rocket', visual: 'rocketPod', barrels: 4, caliber: 0.5, mount: 'M', weight: 3.2, cost: 34,
    damage: 32, burst: 4, cooldown: 4, range: 10, ...G, projectile: 'rocket', projectileSpeed: 11, splash: 1, ap: 0.2, spread: 0.8, burn: { dps: 12, duration: 4 } }),
  wpn({ id: 'mlrs', name: 'MLRS Battery', family: '12-tube', desc: 'Ripple-fires 12 rockets across a huge area. Minimum range 30 m.', category: 'rocket', visual: 'rocketPod', barrels: 12, caliber: 0.9, mount: 'M', weight: 10, cost: 70,
    damage: 30, burst: 12, cooldown: 9, range: 22, minRange: 6, ...G, projectile: 'rocket', projectileSpeed: 12, splash: 1, ap: 0.2, spread: 1.6 }),
  // ---------------- Missiles ----------------
  wpn({ id: 'atgm', name: 'ATGM Launcher', family: 'Anti-tank', desc: 'Wire-guided anti-tank missile on a light mount.', category: 'missile', visual: 'missileRack', barrels: 1, caliber: 0.3, mount: 'S', weight: 1.6, cost: 18,
    damage: 110, cooldown: 4, range: 12, ...G, projectile: 'missile', projectileSpeed: 9, splash: 0.2, ap: 0.8 }),
  wpn({ id: 'guidedrocket', name: 'Guided Rocket Launcher', family: 'Dual-role', desc: 'Shoulder-sized guided rocket. Hits ground and air.', category: 'missile', visual: 'missileRack', barrels: 1, caliber: 0.25, mount: 'S', weight: 1.3, cost: 16,
    damage: 55, cooldown: 3, range: 10, ...GA, projectile: 'missile', projectileSpeed: 10, splash: 0.3, ap: 0.5 }),
  wpn({ id: 'aamissile', name: 'AA Missile Pod', family: 'Anti-air', desc: 'Twin heat-seekers. Air only.', category: 'missile', visual: 'missileRack', barrels: 2, caliber: 0.3, mount: 'S', weight: 1.4, cost: 16,
    damage: 60, burst: 2, cooldown: 3.5, range: 13, ...A, projectile: 'missile', projectileSpeed: 11, splash: 0.3, ap: 0.4, airBonus: 1.5 }),
  wpn({ id: 'sam', name: 'Missile Rack', family: 'Multi-role', desc: 'Homing missiles. Long range, bonus vs aircraft.', category: 'missile', visual: 'missileRack', barrels: 4, caliber: 0.5, mount: 'M', weight: 3, cost: 34,
    damage: 85, cooldown: 3, range: 13, ...GA, projectile: 'missile', projectileSpeed: 9, splash: 0.4, ap: 0.5, airBonus: 1.6 }),
  wpn({ id: 'swarm', name: 'Swarm Missiles', family: 'Swarm', desc: 'Eight micro-missiles that spread across targets.', category: 'missile', visual: 'missileRack', barrels: 8, caliber: 0.5, mount: 'M', weight: 3.5, cost: 40,
    damage: 28, burst: 8, cooldown: 6, range: 12, ...GA, projectile: 'missile', projectileSpeed: 10, splash: 0.4, ap: 0.3, spread: 0.4 }),
  wpn({ id: 'cruise', name: 'Cruise Missile', family: 'Strategic', desc: 'One enormous long-range warhead. Slow to reload.', category: 'missile', visual: 'cruise', caliber: 0.9, mount: 'M', weight: 9, cost: 80,
    damage: 300, cooldown: 10, range: 28, minRange: 8, ...G, projectile: 'missile', projectileSpeed: 10, splash: 2.2, ap: 0.6 }),
  // ---------------- Artillery ----------------
  wpn({ id: 'mortar', name: 'Mortar', family: '81mm', desc: 'Lobbed shells over the front line. Minimum range 25 m.', category: 'artillery', visual: 'mortar', caliber: 0.5, mount: 'M', weight: 3.5, cost: 30,
    damage: 60, cooldown: 3, range: 20, minRange: 5, ...G, projectile: 'arc', projectileSpeed: 8, splash: 1.2, ap: 0.2, spread: 0.8 }),
  wpn({ id: 'howitzer', name: 'Howitzer', family: '155mm', desc: 'Long-range artillery with huge splash. Minimum range 40 m.', category: 'artillery', visual: 'artillery', caliber: 0.9, mount: 'M', weight: 10, cost: 75,
    damage: 80, cooldown: 5, range: 30, minRange: 8, ...G, projectile: 'arc', projectileSpeed: 12, splash: 2, ap: 0.3, spread: 1.2 }),
  wpn({ id: 'barrage', name: 'Barrage Cannon', family: 'Scatter artillery', desc: 'Fires six shells at once that blanket an area. Minimum range 30 m.', category: 'artillery', visual: 'artillery', barrels: 3, caliber: 0.8, mount: 'M', weight: 11, cost: 80,
    damage: 28, pellets: 6, cooldown: 3.5, range: 24, minRange: 6, ...G, projectile: 'arc', projectileSpeed: 10, splash: 1, ap: 0.1, spread: 2 }),
  // ---------------- Energy ----------------
  wpn({ id: 'laser', name: 'Pulse Laser', family: 'Pulse', desc: 'Accurate hitscan pulses with some armor pierce.', category: 'energy', visual: 'laser', caliber: 0.3, mount: 'S', weight: 1.2, cost: 18,
    damage: 24, cooldown: 0.6, range: 7, ...GA, projectile: 'beam', ap: 0.3 }),
  wpn({ id: 'twinlaser', name: 'Twin Pulse Laser', family: 'Twin pulse', desc: 'Two linked pulse emitters on a medium mount.', category: 'energy', visual: 'laser', barrels: 2, caliber: 0.4, mount: 'M', weight: 2.6, cost: 34,
    damage: 24, cooldown: 0.15, range: 7, ...GA, magazine: 6, reload: 1.5, projectile: 'beam', ap: 0.3 }),
  wpn({ id: 'heatray', name: 'Heat Ray', family: 'Thermal', desc: 'Continuous ray: melts anything close, fades with distance.', category: 'energy', visual: 'heatray', caliber: 0.5, mount: 'M', weight: 3.5, cost: 32,
    damage: 36, cooldown: 0.2, range: 5.5, ...GA, projectile: 'beam', ap: 0.5, falloff: 0.25 }),
  wpn({ id: 'plasmaorb', name: 'Plasma Cannon', family: 'Plasma orb', desc: 'Slow-moving plasma ball that bursts on impact.', category: 'energy', visual: 'plasma', caliber: 0.5, mount: 'M', weight: 4, cost: 36,
    damage: 85, cooldown: 2, range: 8, ...G, projectile: 'orb', projectileSpeed: 6, splash: 1.1, ap: 0.5, spread: 0.4 }),
  wpn({ id: 'plasma', name: 'Plasma Lance', family: 'Plasma beam', desc: 'Searing short-range beam with heavy armor pierce.', category: 'energy', visual: 'plasma', caliber: 0.9, mount: 'M', weight: 8, cost: 65,
    damage: 48, cooldown: 0.25, range: 6.5, ...GA, projectile: 'beam', ap: 0.6 }),
  // ---------------- Flame ----------------
  wpn({ id: 'flamer', name: 'Flamethrower', family: 'Light flame', desc: 'Short-range cone that ignores most armor.', category: 'flame', visual: 'flamer', caliber: 0.3, mount: 'S', weight: 1.5, cost: 14,
    damage: 10, cooldown: 0.1, range: 3.5, ...G, projectile: 'flame', projectileSpeed: 9, splash: 0.8, ap: 0.8, burn: { dps: 6, duration: 2 } }),
  wpn({ id: 'napalm', name: 'Napalm Projector', family: 'Napalm', desc: 'Sticky burning gel. Wide cone, long burn.', category: 'flame', visual: 'flamer', caliber: 0.6, mount: 'M', weight: 3.2, cost: 30,
    damage: 14, cooldown: 0.15, range: 4.5, ...G, projectile: 'flame', projectileSpeed: 8, splash: 1.2, ap: 0.8, burn: { dps: 15, duration: 3 } }),
  // ---------------- Stun & disruption ----------------
  wpn({ id: 'tesla', name: 'Tesla Coil', family: 'Chain lightning', desc: 'Lightning arcs that jump between up to 4 enemies.', category: 'disruption', visual: 'tesla', caliber: 0.5, mount: 'M', weight: 3.5, cost: 32,
    damage: 48, cooldown: 1.2, range: 4.5, ...GA, projectile: 'lightning', chain: 3, ap: 0.4 }),
  wpn({ id: 'stungun', name: 'Stun Gun', family: 'Paralyzer', desc: 'Electric bolt that paralyzes its target for 1.2s.', category: 'disruption', visual: 'emp', caliber: 0.3, mount: 'S', weight: 1.2, cost: 18,
    damage: 8, cooldown: 1.5, range: 6, ...GA, projectile: 'lightning', chain: 0, ap: 1, stun: 1.2 }),
  wpn({ id: 'empcannon', name: 'EMP Cannon', family: 'EMP burst', desc: 'Electromagnetic orb that stuns everything in the blast.', category: 'disruption', visual: 'emp', caliber: 0.6, mount: 'M', weight: 3.5, cost: 38,
    damage: 40, cooldown: 3, range: 9, ...G, projectile: 'orb', projectileSpeed: 7, splash: 1.2, ap: 1, stun: 1.5, spread: 0.3 }),
  wpn({ id: 'slowbeam', name: 'Slow Beam', family: 'Disruptor', desc: 'Beam that cuts target speed and rate of fire by up to 60%.', category: 'disruption', visual: 'slowbeam', caliber: 0.5, mount: 'M', weight: 3, cost: 28,
    damage: 12, cooldown: 0.2, range: 7.5, ...GA, projectile: 'beam', ap: 1, slow: 0.15 }),
  wpn({ id: 'arclance', name: 'Arc Lance', family: 'Storm', desc: 'Heavy lightning that chains through 6 enemies and jolts them.', category: 'disruption', visual: 'tesla', caliber: 0.9, mount: 'M', weight: 9, cost: 75,
    damage: 105, cooldown: 1.6, range: 6.5, ...GA, projectile: 'lightning', chain: 5, ap: 0.5, stun: 0.3 }),
  wpn({ id: 'disarm', name: 'Disarm Ray', family: 'Disarmer', desc: 'Scrambles weapon systems: target can move but not fire for 2s.', category: 'disruption', visual: 'emp', caliber: 0.5, mount: 'M', weight: 3, cost: 34,
    damage: 15, cooldown: 2.5, range: 8, ...GA, projectile: 'beam', ap: 1, disarm: 2 }),
  wpn({ id: 'sonic', name: 'Sonic Pulser', family: 'Riot', desc: 'Concussive blast that hurls light units backwards.', category: 'disruption', visual: 'sonic', caliber: 0.5, mount: 'M', weight: 3.5, cost: 30,
    damage: 50, cooldown: 1.4, range: 4, ...G, projectile: 'orb', projectileSpeed: 14, splash: 1, ap: 0.3, impulse: 1.6 }),
  wpn({ id: 'gravity', name: 'Gravity Gun', family: 'Graviton', desc: 'Yanks enemies toward you, dragging them out of formation.', category: 'disruption', visual: 'gravity', caliber: 0.8, mount: 'M', weight: 8, cost: 60,
    damage: 30, cooldown: 0.8, range: 8.5, ...GA, projectile: 'beam', ap: 1, impulse: -0.9 }),
  // ---------------- Bombs (flyers only) ----------------
  wpn({ id: 'bombs', name: 'Bomb Bay', family: 'Iron bombs', desc: 'Drops bombs on ground units directly below. Flying designs only.', category: 'artillery', visual: 'charge', caliber: 0.5, mount: 'M', weight: 3.5, cost: 28, requires: 'air',
    damage: 110, burst: 2, cooldown: 3, range: 1, ...G, projectile: 'arc', projectileSpeed: 6, splash: 1.2, ap: 0.3, spread: 0.3 }),
  wpn({ id: 'clusterbombs', name: 'Cluster Dispenser', family: 'Cluster', desc: 'Scatters 8 bomblets over a wide area below. Flying designs only.', category: 'artillery', visual: 'charge', barrels: 2, caliber: 0.8, mount: 'M', weight: 5, cost: 45, requires: 'air',
    damage: 55, pellets: 8, cooldown: 4, range: 1.5, ...G, projectile: 'arc', projectileSpeed: 6, splash: 0.9, ap: 0.2, spread: 1.6 }),
  // ---------------- Flak ----------------
  wpn({ id: 'flak', name: 'Flak Cannon', family: 'Light flak', desc: 'Anti-air only. Bursting shells wreck aircraft groups.', category: 'antiair', visual: 'flak', caliber: 0.5, mount: 'M', weight: 3, cost: 24,
    damage: 45, cooldown: 0.45, range: 10, ...A, magazine: 5, reload: 2.5, projectile: 'shell', projectileSpeed: 16, splash: 1.3, ap: 0.2, airBonus: 1.5 }),
  wpn({ id: 'heavyflak', name: 'Heavy Flak Battery', family: 'Heavy flak', desc: 'Three-gun flak battery. Clears the sky at long range.', category: 'antiair', visual: 'flak', barrels: 3, caliber: 0.9, mount: 'M', weight: 9, cost: 60,
    damage: 70, burst: 3, cooldown: 2.2, range: 14, ...A, projectile: 'shell', projectileSpeed: 18, splash: 1.8, ap: 0.2, airBonus: 1.5 }),
  // ---------------- Melee ----------------
  wpn({ id: 'buzzsaw', name: 'Buzzsaw', family: 'Circular saw', desc: 'Spinning blade. Chews through light armor at contact range.', category: 'melee', visual: 'saw', caliber: 0.4, mount: 'S', weight: 1.4, cost: 10,
    damage: 30, cooldown: 0.25, range: 0.6, ...MELEE, ap: 0.3 }),
  wpn({ id: 'shockprod', name: 'Shock Prod', family: 'Stun prod', desc: 'Electrified spike that stuns on contact.', category: 'melee', visual: 'prod', caliber: 0.3, mount: 'S', weight: 1, cost: 12,
    damage: 36, cooldown: 1, range: 0.7, ...MELEE, ap: 0.5, stun: 0.8 }),
  wpn({ id: 'ram', name: 'Spike Ram', family: 'Ram', desc: 'Armored ram that batters targets backwards.', category: 'melee', visual: 'ram', caliber: 0.5, mount: 'S', weight: 2, cost: 10,
    damage: 130, cooldown: 1.5, range: 0.4, ...MELEE, ap: 0.5, impulse: 1.2 }),
  wpn({ id: 'chainsaw', name: 'Chainsaw Arm', family: 'Chainsaw', desc: 'Relentless ripping teeth. Constant damage while locked on.', category: 'melee', visual: 'chainsaw', caliber: 0.6, mount: 'M', weight: 3, cost: 22,
    damage: 30, cooldown: 0.2, range: 0.7, ...MELEE, ap: 0.4 }),
  wpn({ id: 'claw', name: 'Power Claw', family: 'Hydraulic claw', desc: 'Crushing hydraulic pincer with heavy armor pierce.', category: 'melee', visual: 'claw', caliber: 0.6, mount: 'M', weight: 3.5, cost: 26,
    damage: 95, cooldown: 1, range: 0.8, ...MELEE, ap: 0.7 }),
  wpn({ id: 'plasmablade', name: 'Plasma Blade', family: 'Energy blade', desc: 'Superheated blade that sweeps through adjacent enemies.', category: 'melee', visual: 'blade', caliber: 0.6, mount: 'M', weight: 2.5, cost: 30,
    damage: 55, cooldown: 0.5, range: 0.9, ...MELEE, splash: 0.8, ap: 0.8 }),
  wpn({ id: 'hammer', name: 'Siege Hammer', family: 'Ground pound', desc: 'Colossal hammer. Shockwave damages and knocks back everything nearby.', category: 'melee', visual: 'hammer', caliber: 0.9, mount: 'M', weight: 9, cost: 55,
    damage: 260, cooldown: 2, range: 0.9, ...MELEE, splash: 1.3, ap: 0.6, impulse: 1 }),
  wpn({ id: 'drill', name: 'Drill Lance', family: 'Bore drill', desc: 'Armor-boring drill. Ignores all armor.', category: 'melee', visual: 'drill', caliber: 0.9, mount: 'M', weight: 8, cost: 50,
    damage: 48, cooldown: 0.15, range: 0.8, ...MELEE, ap: 1 }),
  // ---------------- Support (allies) ----------------
  util({ id: 'repair', name: 'Repair Beam', family: 'Light repair', desc: 'Heals the most damaged ally in range.', category: 'support', visual: 'repair', caliber: 0.3, mount: 'S', weight: 1, cost: 17, heal: 22, range: 4 }),
  util({ id: 'repairM', name: 'Repair Array', family: 'Heavy repair', desc: 'Industrial nano-repair array with longer reach.', category: 'support', visual: 'repair', caliber: 0.6, mount: 'M', weight: 2.5, cost: 40, heal: 55, range: 5 }),
  util({ id: 'dome', name: 'Shield Dome', family: 'Area shield', desc: 'Projects a 150-point shield onto every ally within 3 cells.', category: 'support', visual: 'dome', caliber: 0.8, mount: 'M', weight: 6, cost: 20, shieldAura: { radius: 3, amount: 150 } }),
  util({ id: 'uplink', name: 'Command Uplink', family: 'Command', desc: 'Allies within 4 cells fire 15% faster.', category: 'support', visual: 'uplink', caliber: 0.5, mount: 'M', weight: 2, cost: 6, fireRateAura: { radius: 4, bonus: 0.15 } }),
  util({ id: 'sensor', name: 'Sensor Mast', family: 'Detection', desc: 'Reveals cloaked enemies within 7 cells for your whole army.', category: 'stealth', visual: 'sensor', caliber: 0.4, mount: 'S', weight: 1, cost: 3, detect: 7 }),
  // ---------------- Defense ----------------
  util({ id: 'shield', name: 'Shield Projector', family: 'Energy shield', desc: 'Personal energy shield that absorbs 260 damage and regenerates.', category: 'defense', visual: 'shield', caliber: 0.5, mount: 'M', weight: 2.5, cost: 32, shield: 260 }),
  util({ id: 'shieldL', name: 'Shield Emitter', family: 'Light shield', desc: 'Small personal shield: absorbs 100 damage, regenerates.', category: 'defense', visual: 'shield', caliber: 0.25, mount: 'S', weight: 1, cost: 14, shield: 100 }),
  util({ id: 'shieldH', name: 'Aegis Barrier', family: 'Heavy shield', desc: 'Massive personal barrier: absorbs 700 damage.', category: 'defense', visual: 'shield', caliber: 0.9, mount: 'M', weight: 6, cost: 60, shield: 700 }),
  util({ id: 'pointdef', name: 'Point Defense Laser', family: 'APS', desc: 'Zaps incoming rockets, missiles and shells within 2.5 cells.', category: 'defense', visual: 'pointdef', caliber: 0.4, mount: 'S', weight: 1.2, cost: 24, pointDefense: { range: 2.5, cooldown: 0.6 } }),
  util({ id: 'smoke', name: 'Smoke Launchers', family: 'Obscurant', desc: 'Below 60% hp, pops a smoke screen: nothing outside 2.5 cells can target units inside for 5s.', category: 'defense', visual: 'smoke', caliber: 0.3, mount: 'S', weight: 0.8, cost: 12, smoke: { radius: 2, duration: 5 } }),
  util({ id: 'reactive', name: 'Reactive Armor', family: 'ERA', desc: 'Explosive tiles: the next 6 shell/rocket/missile hits deal 75% less damage.', category: 'defense', visual: 'plate', caliber: 0.5, mount: 'M', weight: 3, cost: 22, reactive: 6, armor: 1 }),
  util({ id: 'mirror', name: 'Mirror Coating', family: 'Reflective', desc: 'Takes 45% less damage from beams, lightning, rails, plasma and flame.', category: 'defense', visual: 'plate', caliber: 0.4, mount: 'S', weight: 1, cost: 8, energyResist: 0.45 }),
  util({ id: 'hardened', name: 'Hardened Systems', family: 'EMP shielding', desc: 'Immune to stun, slow, disarm, burning and knockback.', category: 'defense', visual: 'coolant', caliber: 0.4, mount: 'S', weight: 1.2, cost: 3, hardened: true }),
  util({ id: 'nanite', name: 'Nanite Hull', family: 'Self-repair', desc: 'Regenerates 2.5% max hp per second when out of combat for 2s.', category: 'defense', visual: 'nanite', caliber: 0.4, mount: 'S', weight: 1, cost: 3, regen: 0.025 }),
  // ---------------- Stealth & ECM ----------------
  util({ id: 'stealth', name: 'Stealth Cloak', family: 'Optical cloak', desc: 'Untargetable unless an enemy comes within 2.5 cells or it has just fired.', category: 'stealth', visual: 'cloak', caliber: 0.5, mount: 'M', weight: 2, cost: 15, cloak: 'stealth' }),
  util({ id: 'phantom', name: 'Phase Veil', family: 'Phase cloak', desc: 'Untargetable at any range, except for 3s after each shot it fires.', category: 'stealth', visual: 'cloak', caliber: 0.8, mount: 'M', weight: 4, cost: 20, cloak: 'phantom' }),
  util({ id: 'jammer', name: 'ECM Jammer', family: 'Jammer', desc: 'Enemy missiles lose lock on allies within 3 cells; enemy guns are half as accurate against them.', category: 'stealth', visual: 'jammer', caliber: 0.5, mount: 'M', weight: 2, cost: 5, jammer: 3 }),
  // ---------------- Systems ----------------
  util({ id: 'targeting', name: 'Targeting Computer', family: 'Fire control', desc: '+15% range for all weapons and tighter spread.', category: 'systems', visual: 'sensor', caliber: 0.3, mount: 'S', weight: 0.8, cost: 8, rangeBonus: 0.15, spreadMult: 0.6 }),
  util({ id: 'turbo', name: 'Turbo Engine', family: 'Engine', desc: '+20% move speed.', category: 'systems', visual: 'engine', caliber: 0.4, mount: 'S', weight: 1.2, cost: 3, speedBonus: 0.2 }),
  util({ id: 'gyro', name: 'Gyro Stabilizer', family: 'Stabilizer', desc: 'All weapons can fire on the move, with tighter spread.', category: 'systems', visual: 'gyro', caliber: 0.3, mount: 'S', weight: 1, cost: 3, gyro: true, spreadMult: 0.85 }),
  util({ id: 'autoloader', name: 'Autoloader', family: 'Ammo feed', desc: 'Clip weapons reload 40% faster.', category: 'systems', visual: 'coolant', caliber: 0.3, mount: 'S', weight: 1, cost: 14, reloadBonus: 0.4 }),
  util({ id: 'overclock', name: 'Overclocked Core', family: 'Overclock', desc: 'All weapons fire 20% faster.', category: 'systems', visual: 'coolant', caliber: 0.5, mount: 'M', weight: 2, cost: 5, fireRateBonus: 0.2 }),
  util({ id: 'selfdestruct', name: 'Self-Destruct Charge', family: 'Demolition', desc: 'Detonates on death for 300 damage in a 2-cell radius.', category: 'systems', visual: 'charge', caliber: 0.4, mount: 'S', weight: 1.5, cost: 3, deathBlast: { damage: 300, radius: 2 } }),
  // ---------------- Giant class (G mounts, size-4 chassis) ----------------
  wpn({ id: 'siege240', name: '240mm Siege Cannon', family: '240mm', desc: 'Giant-class gun. Shells that crack fortresses.', category: 'cannon', visual: 'cannon', caliber: 1, mount: 'L', weight: 18, cost: 110,
    damage: 520, cooldown: 3, range: 12, ...G, projectile: 'shell', projectileSpeed: 18, splash: 0.8, ap: 0.85, spread: 0.2 }),
  wpn({ id: 'avenger', name: 'Hellstorm Rotary Cannon', family: 'Giant rotary', desc: 'Seven-barrel 30mm rotary cannon. Shreds air and ground alike.', category: 'autocannon', visual: 'gatling', barrels: 7, caliber: 1, mount: 'L', weight: 16, cost: 110,
    damage: 30, cooldown: 0.035, range: 9, ...GA, projectile: 'bullet', projectileSpeed: 24, splash: 0.2, ap: 0.45, spread: 0.5 }),
  wpn({ id: 'missilebattery', name: 'Missile Battery', family: '16-cell', desc: 'Sixteen-cell launcher that saturates an area with homing missiles.', category: 'missile', visual: 'missileRack', barrels: 16, caliber: 1, mount: 'L', weight: 17, cost: 120,
    damage: 70, burst: 16, cooldown: 9, range: 18, ...GA, projectile: 'missile', projectileSpeed: 10, splash: 0.5, ap: 0.5 }),
  wpn({ id: 'siegeplasma', name: 'Plasma Siege Projector', family: 'Siege plasma', desc: 'Lobs a sun-hot plasma mass that melts everything nearby.', category: 'energy', visual: 'plasma', caliber: 1, mount: 'L', weight: 18, cost: 115,
    damage: 380, cooldown: 3.5, range: 10, ...G, projectile: 'orb', projectileSpeed: 7, splash: 2, ap: 0.7, spread: 0.4 }),
  wpn({ id: 'skyfortress', name: 'Flak Fortress', family: 'Giant flak', desc: 'Quad heavy flak turret. A no-fly zone on legs.', category: 'antiair', visual: 'flak', barrels: 4, caliber: 1, mount: 'L', weight: 15, cost: 95,
    damage: 90, burst: 4, cooldown: 2, range: 18, ...A, projectile: 'shell', projectileSpeed: 20, splash: 2.2, ap: 0.3, airBonus: 1.5 }),
  wpn({ id: 'stormtower', name: 'Storm Tower', family: 'Giant tesla', desc: 'Lightning that chains through 8 enemies and jolts them.', category: 'disruption', visual: 'tesla', caliber: 1, mount: 'L', weight: 16, cost: 110,
    damage: 160, cooldown: 1.5, range: 7.5, ...GA, projectile: 'lightning', chain: 7, ap: 0.5, stun: 0.3 }),
  wpn({ id: 'inferno', name: 'Inferno Projector', family: 'Giant flame', desc: 'A river of fire. Wide cone, ferocious burn.', category: 'flame', visual: 'flamer', caliber: 1, mount: 'L', weight: 15, cost: 95,
    damage: 22, cooldown: 0.1, range: 5.5, ...G, projectile: 'flame', projectileSpeed: 9, splash: 1.8, ap: 0.9, burn: { dps: 30, duration: 3 } }),
  wpn({ id: 'grinder', name: 'Grinder Wheel', family: 'Giant saw', desc: 'Colossal spinning grinder. Sweeps through everything it touches.', category: 'melee', visual: 'saw', caliber: 1, mount: 'L', weight: 15, cost: 85,
    damage: 120, cooldown: 0.3, range: 1, ...MELEE, splash: 1.2, ap: 0.6 }),
  util({ id: 'bulwarkshield', name: 'Bastion Shield Generator', family: 'Giant shield', desc: 'Personal barrier that absorbs 1800 damage.', category: 'defense', visual: 'shield', caliber: 1, mount: 'L', weight: 12, cost: 90, shield: 1800 }),
  util({ id: 'domeG', name: 'Fortress Dome', family: 'Giant dome', desc: 'Projects a 400-point shield onto every ally within 5 cells.', category: 'support', visual: 'dome', caliber: 1, mount: 'L', weight: 14, cost: 110, shieldAura: { radius: 5, amount: 400 } }),
  { id: 'plateG', name: 'Giant Armor', family: 'Giant plate', desc: '+16 armor, +1200 hp.', category: 'armor', visual: 'plate', caliber: 1, mount: 'L', kind: 'armor', weight: 26, cost: 130, armor: 16, hp: 1200 },
  // ---------------- Titan class (T mounts, size-5 chassis) ----------------
  wpn({ id: 'massdriver', name: 'Spinal Mass Driver', family: 'Titan rail', desc: 'Hull-length railgun. Pierces an entire battle line at extreme range. Barely traverses: the hull must face the target.', category: 'precision', visual: 'rail', turretTurn: 0.5, barrels: 2, caliber: 1, mount: 'XL', weight: 38, cost: 220,
    damage: 1400, cooldown: 6, range: 28, ...GA, projectile: 'rail', ap: 1, pierce: true }),
  wpn({ id: 'doomsday', name: 'Doomsday Howitzer', family: 'Titan artillery', desc: 'Twin super-heavy howitzer. Craters half a company per salvo. Minimum range 50 m.', category: 'artillery', visual: 'artillery', barrels: 2, caliber: 1, mount: 'XL', weight: 40, cost: 230,
    damage: 700, cooldown: 8, range: 40, minRange: 10, ...G, projectile: 'arc', projectileSpeed: 14, splash: 4, ap: 0.5, spread: 1.5 }),
  wpn({ id: 'annihilator', name: 'Annihilator Beam', family: 'Titan beam', desc: 'Continuous plasma beam that cuts through anything.', category: 'energy', visual: 'plasma', barrels: 2, caliber: 1, mount: 'XL', weight: 36, cost: 220,
    damage: 140, cooldown: 0.2, range: 11, ...GA, projectile: 'beam', ap: 0.8 }),
  wpn({ id: 'tactnuke', name: 'Tactical Nuke Launcher', family: 'Titan strategic', desc: 'One slow missile, one enormous blast. Minimum range 50 m.', category: 'missile', visual: 'cruise', caliber: 1, mount: 'XL', weight: 34, cost: 240,
    damage: 2200, cooldown: 20, range: 40, minRange: 10, ...G, projectile: 'missile', projectileSpeed: 7, splash: 5, ap: 0.6 }),
  wpn({ id: 'titanfist', name: 'Titan Fist', family: 'Titan melee', desc: 'A wrecking fist the size of a tank. Shockwave hurls units away.', category: 'melee', visual: 'hammer', caliber: 1, mount: 'XL', weight: 30, cost: 170,
    damage: 1100, cooldown: 2.2, range: 1.2, ...MELEE, splash: 2, ap: 0.8, impulse: 2 }),
  wpn({ id: 'stormcore', name: 'Tempest Core', family: 'Titan tesla', desc: 'Storm reactor: lightning chains through 11 enemies and stuns them.', category: 'disruption', visual: 'tesla', barrels: 3, caliber: 1, mount: 'XL', weight: 36, cost: 220,
    damage: 260, cooldown: 1.2, range: 9.5, ...GA, projectile: 'lightning', chain: 10, ap: 0.6, stun: 0.5 }),
  util({ id: 'aegisT', name: 'Titan Aegis Field', family: 'Titan shield', desc: '3000-point personal barrier plus a 700-point shield on allies within 8 cells.', category: 'support', visual: 'dome', caliber: 1, mount: 'XL', weight: 30, cost: 200, shield: 3000, shieldAura: { radius: 8, amount: 700 } }),
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
