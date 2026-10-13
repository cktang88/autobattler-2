// Part catalog: 10 chassis, 10 mobility systems, 52 mount modules (46 weapons in 11 categories + support + armor).
// Balance numbers live here; stats.ts turns a Design into UnitStats.

import type { ChassisDef, MobilityDef, ModuleCategory, ModuleDef, MountClass } from './types.ts';

export const CHASSIS: ChassisDef[] = [
  { id: 'scout', name: 'Scout Frame', desc: 'Tiny, cheap and quick. One light mount.', size: 1, hp: 140, armor: 0, weight: 3, cost: 25, mounts: ['L'], traits: [], shape: 'wedge' },
  { id: 'drone', name: 'Drone Core', desc: 'Featherweight core. Pairs well with rotors and jets.', size: 1, hp: 90, armor: 0, weight: 1.5, cost: 20, mounts: ['L'], traits: ['compact'], shape: 'pod' },
  { id: 'raider', name: 'Raider Frame', desc: 'Light skirmisher with twin light mounts.', size: 1, hp: 210, armor: 2, weight: 5, cost: 45, mounts: ['L', 'L'], traits: [], shape: 'box' },
  { id: 'warden', name: 'Warden Hull', desc: 'Sturdy medium hull built to hold a line.', size: 2, hp: 560, armor: 6, weight: 14, cost: 100, mounts: ['M', 'L'], traits: [], shape: 'hex' },
  { id: 'striker', name: 'Striker Frame', desc: 'Aggressive medium frame with three mounts.', size: 2, hp: 430, armor: 4, weight: 12, cost: 115, mounts: ['M', 'M', 'L'], traits: [], shape: 'cross' },
  { id: 'longarm', name: 'Longarm Platform', desc: 'Stabilized platform: one heavy mount, +20% weapon range.', size: 2, hp: 360, armor: 3, weight: 12, cost: 105, mounts: ['H'], traits: ['rangeBoost'], shape: 'long' },
  { id: 'aegis', name: 'Aegis Frame', desc: 'Support frame. Field-repairs nearby allies.', size: 2, hp: 470, armor: 4, weight: 13, cost: 135, mounts: ['M', 'L'], traits: ['repairAura'], shape: 'round' },
  { id: 'gunship', name: 'Gunship Airframe', desc: 'Aerodynamic hull. Must fly: rotors or jets only.', size: 2, hp: 380, armor: 3, weight: 8, cost: 120, mounts: ['M', 'M'], traits: ['airOnly'], shape: 'airframe' },
  { id: 'bastion', name: 'Bastion Hull', desc: 'Massive armored hull. Slow, nearly unbreakable.', size: 3, hp: 1500, armor: 14, weight: 38, cost: 240, mounts: ['H', 'M', 'M'], traits: [], shape: 'fortress' },
  { id: 'colossus', name: 'Colossus Frame', desc: 'Walking arsenal with four mounts.', size: 3, hp: 1250, armor: 10, weight: 34, cost: 280, mounts: ['H', 'H', 'M', 'L'], traits: [], shape: 'titan' },
];

export const MOBILITY: MobilityDef[] = [
  { id: 'wheels', name: 'Wheels', desc: 'Fast and cheap, but fragile and light-duty.', kind: 'ground', sizes: [1, 2], speed: 3.2, turn: 4, capacity: [8, 24, 0], weight: 1.5, hp: 0, armor: 0, cost: 8, traits: [] },
  { id: 'halftrack', name: 'Half-Track', desc: 'Wheels up front, treads behind. Balanced all-rounder.', kind: 'ground', sizes: [1, 2, 3], speed: 2.3, turn: 2.6, capacity: [9, 27, 52], weight: 2.5, hp: 30, armor: 1, cost: 14, traits: [] },
  { id: 'treads', name: 'Tank Treads', desc: 'Heavy-duty treads. Slow, tough, carries anything.', kind: 'ground', sizes: [2, 3], speed: 1.6, turn: 1.8, capacity: [0, 32, 66], weight: 4, hp: 60, armor: 3, cost: 22, traits: ['crush'] },
  { id: 'legs', name: 'Bipedal Legs', desc: 'Nimble walker. Fires while moving.', kind: 'ground', sizes: [1, 2], speed: 2.0, turn: 3.5, capacity: [9, 24, 0], weight: 2, hp: 20, armor: 0, cost: 14, traits: ['fireOnMove'] },
  { id: 'spider', name: 'Spider Legs', desc: 'Six-legged stable walker. Better accuracy, carries heavy loads.', kind: 'ground', sizes: [1, 2, 3], speed: 1.6, turn: 3, capacity: [10, 29, 58], weight: 3.5, hp: 40, armor: 2, cost: 22, traits: ['stable'] },
  { id: 'jumpjets', name: 'Jump Legs', desc: 'Leaps over obstacles straight into the fight.', kind: 'ground', sizes: [1, 2], speed: 2.0, turn: 3, capacity: [8, 21, 0], weight: 2.5, hp: 10, armor: 0, cost: 22, traits: ['leap'] },
  { id: 'hover', name: 'Hover Skirt', desc: 'Skims the ground. Very fast, hard to hit.', kind: 'ground', sizes: [1, 2], speed: 3.6, turn: 2.2, capacity: [6, 17, 0], weight: 1.5, hp: 0, armor: 0, cost: 18, traits: ['evasive'] },
  { id: 'rotor', name: 'Rotor', desc: 'Helicopter rotors. Flies over ground units; only anti-air can hit it.', kind: 'air', sizes: [1, 2], speed: 2.8, turn: 3, capacity: [5, 17, 0], weight: 2, hp: 0, armor: 0, cost: 28, traits: ['fireOnMove'] },
  { id: 'jet', name: 'Jet Thrusters', desc: 'Very fast strafing flyer. Fires on the pass.', kind: 'air', sizes: [1, 2], speed: 4.6, turn: 1.6, capacity: [4, 14, 0], weight: 1.5, hp: 0, armor: 0, cost: 32, traits: ['fireOnMove', 'strafe', 'evasive'] },
  { id: 'anchor', name: 'Anchor Mount', desc: 'Immobile emplacement. Extra hp, armor and +15% range.', kind: 'static', sizes: [1, 2, 3], speed: 0, turn: 2.5, capacity: [14, 40, 80], weight: 0, hp: 100, armor: 4, cost: 0, traits: ['fortified'] },
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
  { id: 'support', name: 'Support', desc: 'Repair, shields and targeting systems.' },
  { id: 'armor', name: 'Armor', desc: 'Plating: more hp and armor, at the cost of weight.' },
];

type W = Omit<ModuleDef, 'kind'> & { kind?: ModuleDef['kind'] };
const G = { targetsGround: true, targetsAir: false };
const A = { targetsGround: false, targetsAir: true };
const GA = { targetsGround: true, targetsAir: true };
const wpn = (m: W): ModuleDef => ({ kind: 'weapon', ...m }) as ModuleDef;

export const MODULES: ModuleDef[] = [
  // ---------------- Machine guns ----------------
  wpn({ id: 'mg', name: '7.62mm Machine Gun', family: '7.62mm', desc: 'Rapid fire. Shreds light units and aircraft; weak vs armor.', category: 'machinegun', visual: 'gun', caliber: 0.2, mount: 'L', weight: 1, cost: 6,
    damage: 9, cooldown: 0.15, range: 4.5, ...GA, projectile: 'bullet', projectileSpeed: 22, ap: 0, spread: 0.35 }),
  wpn({ id: 'twinmg', name: 'Twin 7.62mm MG', family: 'Twin 7.62mm', desc: 'Two coaxial machine guns on one mount. Double the lead.', category: 'machinegun', visual: 'gun', barrels: 2, caliber: 0.2, mount: 'L', weight: 1.8, cost: 11,
    damage: 9, cooldown: 0.075, range: 4.5, ...GA, projectile: 'bullet', projectileSpeed: 22, ap: 0, spread: 0.45 }),
  wpn({ id: 'hmg', name: '12.7mm Heavy MG', family: '12.7mm', desc: 'Heavier rounds with a little armor pierce and reach.', category: 'machinegun', visual: 'gun', caliber: 0.4, mount: 'L', weight: 1.6, cost: 10,
    damage: 16, cooldown: 0.22, range: 5, ...GA, magazine: 25, reload: 2.5, projectile: 'bullet', projectileSpeed: 24, ap: 0.15, spread: 0.3 }),
  wpn({ id: 'minigun', name: 'Rotary Minigun', family: 'Rotary', desc: 'Six spinning barrels. A wall of bullets at close range.', category: 'machinegun', visual: 'gatling', barrels: 6, caliber: 0.5, mount: 'M', weight: 3, cost: 22,
    damage: 8, cooldown: 0.04, range: 5, ...GA, projectile: 'bullet', projectileSpeed: 24, ap: 0, spread: 0.65 }),
  wpn({ id: 'shotgun', name: 'Scattergun', family: 'Scatter', desc: 'Six-pellet blasts. Brutal up close, useless far away.', category: 'machinegun', visual: 'shotgun', caliber: 0.5, mount: 'L', weight: 1.4, cost: 9,
    damage: 12, pellets: 6, cooldown: 1, range: 3, ...GA, projectile: 'bullet', projectileSpeed: 20, ap: 0.1, spread: 0.9 }),
  // ---------------- Autocannons ----------------
  wpn({ id: 'ac20', name: '20mm Autocannon', family: '20mm', desc: 'Light autocannon. Small explosive rounds.', category: 'autocannon', visual: 'gun', caliber: 0.55, mount: 'L', weight: 1.8, cost: 14,
    damage: 18, cooldown: 0.2, range: 5.5, ...GA, magazine: 10, reload: 2, projectile: 'bullet', projectileSpeed: 20, splash: 0.2, ap: 0.2, spread: 0.3 }),
  wpn({ id: 'autocannon', name: '30mm Autocannon', family: '30mm', desc: 'Versatile mid-caliber gun. Hits ground and air.', category: 'autocannon', visual: 'gun', caliber: 0.5, mount: 'M', weight: 3, cost: 22,
    damage: 32, cooldown: 0.3, range: 6, ...GA, magazine: 6, reload: 2, projectile: 'bullet', projectileSpeed: 18, splash: 0.3, ap: 0.3, spread: 0.3 }),
  wpn({ id: 'twin30', name: 'Twin 30mm Autocannon', family: 'Twin 30mm', desc: 'Two 30mm guns on one mount: double firepower, heavier and pricier.', category: 'autocannon', visual: 'gun', barrels: 2, caliber: 0.5, mount: 'M', weight: 5, cost: 38,
    damage: 32, cooldown: 0.15, range: 6, ...GA, magazine: 12, reload: 2.4, projectile: 'bullet', projectileSpeed: 18, splash: 0.3, ap: 0.3, spread: 0.35 }),
  wpn({ id: 'ac40', name: '40mm Bofors', family: '40mm', desc: 'Long-reach autocannon with proximity rounds, deadly to aircraft.', category: 'autocannon', visual: 'gun', caliber: 0.8, mount: 'M', weight: 4, cost: 28,
    damage: 55, cooldown: 0.5, range: 7.5, ...GA, magazine: 4, reload: 2.5, projectile: 'bullet', projectileSpeed: 20, splash: 0.5, ap: 0.3, spread: 0.3, airBonus: 1.3 }),
  wpn({ id: 'quad20', name: 'Quad 20mm AA', family: 'Quad 20mm', desc: 'Four 20mm barrels slaved to an AA director. Air only.', category: 'autocannon', visual: 'gun', barrels: 4, caliber: 0.45, mount: 'M', weight: 4, cost: 26,
    damage: 18, cooldown: 0.05, range: 6.5, ...A, magazine: 24, reload: 3, projectile: 'bullet', projectileSpeed: 24, splash: 0.2, ap: 0.2, spread: 0.3, airBonus: 1.4 }),
  // ---------------- Cannons ----------------
  wpn({ id: 'cannon75', name: '75mm Gun', family: '75mm', desc: 'Medium tank gun. Solid armor pierce on a medium mount.', category: 'cannon', visual: 'cannon', caliber: 0.5, mount: 'M', weight: 5, cost: 32,
    damage: 95, cooldown: 0.7, range: 6.5, ...G, magazine: 3, reload: 4, projectile: 'shell', projectileSpeed: 20, splash: 0.3, ap: 0.55, spread: 0.2 }),
  wpn({ id: 'cannon', name: '120mm Heavy Cannon', family: '120mm', desc: 'Armor-piercing shells. The tank killer.', category: 'cannon', visual: 'cannon', caliber: 0.8, mount: 'H', weight: 8, cost: 50,
    damage: 190, cooldown: 2.2, range: 7, ...G, projectile: 'shell', projectileSpeed: 20, splash: 0.3, ap: 0.7, spread: 0.2 }),
  wpn({ id: 'twin120', name: 'Twin 120mm Cannon', family: 'Twin 120mm', desc: 'Two heavy cannons in one turret. Twice the punch, huge weight.', category: 'cannon', visual: 'cannon', barrels: 2, caliber: 0.8, mount: 'H', weight: 13, cost: 85,
    damage: 190, cooldown: 1.1, range: 7, ...G, projectile: 'shell', projectileSpeed: 20, splash: 0.3, ap: 0.7, spread: 0.25 }),
  wpn({ id: 'gauss', name: 'Gauss Cannon', family: 'Gauss', desc: 'Magnetic slug that punches through every unit in its path.', category: 'cannon', visual: 'gauss', caliber: 0.8, mount: 'H', weight: 10, cost: 75,
    damage: 240, cooldown: 2.6, range: 9, ...GA, projectile: 'shell', projectileSpeed: 34, pierce: true, ap: 0.8, spread: 0.1 }),
  // ---------------- Sniper & rail ----------------
  wpn({ id: 'sniper', name: 'Sniper Rifle', family: 'Sniper', desc: 'Long-barrel precision rifle. Picks off units from far away.', category: 'precision', visual: 'sniper', caliber: 0.4, mount: 'L', weight: 1.5, cost: 20,
    damage: 140, cooldown: 3.5, range: 10, ...G, projectile: 'bullet', projectileSpeed: 60, ap: 0.6, spread: 0 }),
  wpn({ id: 'lightrail', name: 'Rail Rifle', family: 'Light rail', desc: 'Compact railgun. Pierces a line of enemies.', category: 'precision', visual: 'rail', caliber: 0.5, mount: 'M', weight: 4, cost: 40,
    damage: 150, cooldown: 3, range: 10, ...GA, projectile: 'rail', ap: 0.9, pierce: true }),
  wpn({ id: 'railgun', name: 'Railgun', family: 'Heavy rail', desc: 'Pierces everything in a line. Extreme range.', category: 'precision', visual: 'rail', caliber: 0.9, mount: 'H', weight: 9, cost: 75,
    damage: 320, cooldown: 4.5, range: 12, ...GA, projectile: 'rail', ap: 1, pierce: true }),
  // ---------------- Rockets ----------------
  wpn({ id: 'rocketL', name: 'Light Rocket Rack', family: '2-tube', desc: 'Pair of unguided rockets.', category: 'rocket', visual: 'rocketPod', barrels: 2, caliber: 0.3, mount: 'L', weight: 1.5, cost: 12,
    damage: 32, burst: 2, cooldown: 3, range: 6, ...G, projectile: 'rocket', projectileSpeed: 11, splash: 0.7, ap: 0.2, spread: 0.7 }),
  wpn({ id: 'rockets', name: 'Rocket Pod', family: '4-tube', desc: 'Salvo of 4 unguided rockets with splash.', category: 'rocket', visual: 'rocketPod', barrels: 4, caliber: 0.5, mount: 'M', weight: 3, cost: 30,
    damage: 42, burst: 4, cooldown: 4, range: 7, ...G, projectile: 'rocket', projectileSpeed: 11, splash: 1, ap: 0.2, spread: 0.8 }),
  wpn({ id: 'incendiary', name: 'Incendiary Rockets', family: 'Napalm 4-tube', desc: 'Rockets that leave targets burning.', category: 'rocket', visual: 'rocketPod', barrels: 4, caliber: 0.5, mount: 'M', weight: 3.2, cost: 34,
    damage: 26, burst: 4, cooldown: 4.5, range: 7, ...G, projectile: 'rocket', projectileSpeed: 11, splash: 1, ap: 0.2, spread: 0.8, burn: { dps: 12, duration: 4 } }),
  wpn({ id: 'mlrs', name: 'MLRS Battery', family: '12-tube', desc: 'Ripple-fires 12 rockets across a huge area. Minimum range 3.', category: 'rocket', visual: 'rocketPod', barrels: 12, caliber: 0.9, mount: 'H', weight: 10, cost: 70,
    damage: 45, burst: 12, cooldown: 9, range: 13, minRange: 3, ...G, projectile: 'rocket', projectileSpeed: 10, splash: 1, ap: 0.2, spread: 1.6 }),
  // ---------------- Missiles ----------------
  wpn({ id: 'atgm', name: 'ATGM Launcher', family: 'Anti-tank', desc: 'Wire-guided anti-tank missile on a light mount.', category: 'missile', visual: 'missileRack', barrels: 1, caliber: 0.3, mount: 'L', weight: 1.6, cost: 18,
    damage: 110, cooldown: 4, range: 8, ...G, projectile: 'missile', projectileSpeed: 9, splash: 0.2, ap: 0.8 }),
  wpn({ id: 'aamissile', name: 'AA Missile Pod', family: 'Anti-air', desc: 'Twin heat-seekers. Air only.', category: 'missile', visual: 'missileRack', barrels: 2, caliber: 0.3, mount: 'L', weight: 1.4, cost: 16,
    damage: 60, burst: 2, cooldown: 3.5, range: 9, ...A, projectile: 'missile', projectileSpeed: 11, splash: 0.3, ap: 0.4, airBonus: 1.5 }),
  wpn({ id: 'sam', name: 'Missile Rack', family: 'Multi-role', desc: 'Homing missiles. Long range, bonus vs aircraft.', category: 'missile', visual: 'missileRack', barrels: 4, caliber: 0.5, mount: 'M', weight: 3, cost: 34,
    damage: 85, cooldown: 3, range: 9, ...GA, projectile: 'missile', projectileSpeed: 9, splash: 0.4, ap: 0.5, airBonus: 1.6 }),
  wpn({ id: 'swarm', name: 'Swarm Missiles', family: 'Swarm', desc: 'Eight micro-missiles that spread across targets.', category: 'missile', visual: 'missileRack', barrels: 8, caliber: 0.5, mount: 'M', weight: 3.5, cost: 40,
    damage: 28, burst: 8, cooldown: 6, range: 8.5, ...GA, projectile: 'missile', projectileSpeed: 10, splash: 0.4, ap: 0.3, spread: 0.4 }),
  wpn({ id: 'cruise', name: 'Cruise Missile', family: 'Strategic', desc: 'One enormous long-range warhead. Slow to reload.', category: 'missile', visual: 'cruise', caliber: 0.9, mount: 'H', weight: 9, cost: 80,
    damage: 480, cooldown: 10, range: 18, minRange: 4, ...G, projectile: 'missile', projectileSpeed: 6, splash: 2.2, ap: 0.6 }),
  // ---------------- Artillery ----------------
  wpn({ id: 'mortar', name: 'Mortar', family: '81mm', desc: 'Lobbed shells over the front line. Minimum range 3.', category: 'artillery', visual: 'mortar', caliber: 0.5, mount: 'M', weight: 3.5, cost: 30,
    damage: 60, cooldown: 3, range: 10, minRange: 3, ...G, projectile: 'arc', projectileSpeed: 7, splash: 1.2, ap: 0.2, spread: 0.8 }),
  wpn({ id: 'howitzer', name: 'Howitzer', family: '155mm', desc: 'Long-range artillery with huge splash. Minimum range 5.', category: 'artillery', visual: 'artillery', caliber: 0.9, mount: 'H', weight: 10, cost: 75,
    damage: 150, cooldown: 5, range: 16, minRange: 5, ...G, projectile: 'arc', projectileSpeed: 8, splash: 2, ap: 0.3, spread: 1.2 }),
  wpn({ id: 'barrage', name: 'Barrage Cannon', family: 'Scatter artillery', desc: 'Fires six shells at once that blanket an area. Minimum range 4.', category: 'artillery', visual: 'artillery', barrels: 3, caliber: 0.8, mount: 'H', weight: 11, cost: 80,
    damage: 42, pellets: 6, cooldown: 3.5, range: 12, minRange: 4, ...G, projectile: 'arc', projectileSpeed: 8, splash: 1, ap: 0.2, spread: 2 }),
  // ---------------- Energy ----------------
  wpn({ id: 'laser', name: 'Pulse Laser', family: 'Pulse', desc: 'Accurate hitscan pulses with some armor pierce.', category: 'energy', visual: 'laser', caliber: 0.3, mount: 'L', weight: 1.2, cost: 18,
    damage: 24, cooldown: 0.6, range: 5.5, ...GA, projectile: 'beam', ap: 0.3 }),
  wpn({ id: 'twinlaser', name: 'Twin Pulse Laser', family: 'Twin pulse', desc: 'Two linked pulse emitters on a medium mount.', category: 'energy', visual: 'laser', barrels: 2, caliber: 0.4, mount: 'M', weight: 2.6, cost: 34,
    damage: 24, cooldown: 0.15, range: 5.5, ...GA, magazine: 6, reload: 1.5, projectile: 'beam', ap: 0.3 }),
  wpn({ id: 'heatray', name: 'Heat Ray', family: 'Thermal', desc: 'Continuous ray: melts anything close, fades with distance.', category: 'energy', visual: 'heatray', caliber: 0.5, mount: 'M', weight: 3.5, cost: 32,
    damage: 32, cooldown: 0.2, range: 4.5, ...GA, projectile: 'beam', ap: 0.5, falloff: 0.25 }),
  wpn({ id: 'plasmaorb', name: 'Plasma Cannon', family: 'Plasma orb', desc: 'Slow-moving plasma ball that bursts on impact.', category: 'energy', visual: 'plasma', caliber: 0.5, mount: 'M', weight: 4, cost: 36,
    damage: 85, cooldown: 2, range: 6.5, ...G, projectile: 'orb', projectileSpeed: 6, splash: 1.1, ap: 0.5, spread: 0.4 }),
  wpn({ id: 'plasma', name: 'Plasma Lance', family: 'Plasma beam', desc: 'Searing short-range beam with heavy armor pierce.', category: 'energy', visual: 'plasma', caliber: 0.9, mount: 'H', weight: 8, cost: 65,
    damage: 48, cooldown: 0.25, range: 5, ...GA, projectile: 'beam', ap: 0.6 }),
  // ---------------- Flame ----------------
  wpn({ id: 'flamer', name: 'Flamethrower', family: 'Light flame', desc: 'Short-range cone that ignores most armor.', category: 'flame', visual: 'flamer', caliber: 0.3, mount: 'L', weight: 1.5, cost: 14,
    damage: 10, cooldown: 0.1, range: 3, ...G, projectile: 'flame', projectileSpeed: 9, splash: 0.8, ap: 0.8, burn: { dps: 6, duration: 2 } }),
  wpn({ id: 'napalm', name: 'Napalm Projector', family: 'Napalm', desc: 'Sticky burning gel. Wide cone, long burn.', category: 'flame', visual: 'flamer', caliber: 0.6, mount: 'M', weight: 3.2, cost: 30,
    damage: 14, cooldown: 0.15, range: 4, ...G, projectile: 'flame', projectileSpeed: 8, splash: 1.2, ap: 0.8, burn: { dps: 15, duration: 3 } }),
  // ---------------- Stun & disruption ----------------
  wpn({ id: 'tesla', name: 'Tesla Coil', family: 'Chain lightning', desc: 'Lightning arcs that jump between up to 4 enemies.', category: 'disruption', visual: 'tesla', caliber: 0.5, mount: 'M', weight: 3.5, cost: 32,
    damage: 48, cooldown: 1.2, range: 4, ...GA, projectile: 'lightning', chain: 3, ap: 0.4 }),
  wpn({ id: 'stungun', name: 'Stun Gun', family: 'Paralyzer', desc: 'Electric bolt that paralyzes its target for 1.2s.', category: 'disruption', visual: 'emp', caliber: 0.3, mount: 'L', weight: 1.2, cost: 18,
    damage: 8, cooldown: 1.5, range: 5, ...GA, projectile: 'lightning', chain: 0, ap: 1, stun: 1.2 }),
  wpn({ id: 'empcannon', name: 'EMP Cannon', family: 'EMP burst', desc: 'Electromagnetic orb that stuns everything in the blast.', category: 'disruption', visual: 'emp', caliber: 0.6, mount: 'M', weight: 3.5, cost: 38,
    damage: 20, cooldown: 3.5, range: 7, ...G, projectile: 'orb', projectileSpeed: 7, splash: 1.2, ap: 1, stun: 1.5, spread: 0.3 }),
  wpn({ id: 'slowbeam', name: 'Slow Beam', family: 'Disruptor', desc: 'Beam that cuts target speed and rate of fire by up to 60%.', category: 'disruption', visual: 'slowbeam', caliber: 0.5, mount: 'M', weight: 3, cost: 28,
    damage: 12, cooldown: 0.2, range: 6, ...GA, projectile: 'beam', ap: 1, slow: 0.15 }),
  wpn({ id: 'arclance', name: 'Arc Lance', family: 'Storm', desc: 'Heavy lightning that chains through 6 enemies and jolts them.', category: 'disruption', visual: 'tesla', caliber: 0.9, mount: 'H', weight: 9, cost: 75,
    damage: 105, cooldown: 1.6, range: 5.5, ...GA, projectile: 'lightning', chain: 5, ap: 0.5, stun: 0.3 }),
  wpn({ id: 'disarm', name: 'Disarm Ray', family: 'Disarmer', desc: 'Scrambles weapon systems: target can move but not fire for 2s.', category: 'disruption', visual: 'emp', caliber: 0.5, mount: 'M', weight: 3, cost: 34,
    damage: 15, cooldown: 2.5, range: 6.5, ...GA, projectile: 'beam', ap: 1, disarm: 2 }),
  wpn({ id: 'sonic', name: 'Sonic Pulser', family: 'Riot', desc: 'Concussive blast that hurls light units backwards.', category: 'disruption', visual: 'sonic', caliber: 0.5, mount: 'M', weight: 3.5, cost: 30,
    damage: 40, cooldown: 1.4, range: 3.5, ...G, projectile: 'orb', projectileSpeed: 14, splash: 1, ap: 0.3, impulse: 1.6 }),
  wpn({ id: 'gravity', name: 'Gravity Gun', family: 'Graviton', desc: 'Yanks enemies toward you, dragging them out of formation.', category: 'disruption', visual: 'gravity', caliber: 0.8, mount: 'H', weight: 8, cost: 60,
    damage: 30, cooldown: 0.8, range: 7, ...GA, projectile: 'beam', ap: 1, impulse: -0.9 }),
  // ---------------- Flak ----------------
  wpn({ id: 'flak', name: 'Flak Cannon', family: 'Light flak', desc: 'Anti-air only. Bursting shells wreck aircraft groups.', category: 'antiair', visual: 'flak', caliber: 0.5, mount: 'M', weight: 3, cost: 24,
    damage: 45, cooldown: 0.45, range: 7.5, ...A, magazine: 5, reload: 2.5, projectile: 'shell', projectileSpeed: 16, splash: 1.3, ap: 0.2, airBonus: 1.5 }),
  wpn({ id: 'heavyflak', name: 'Heavy Flak Battery', family: 'Heavy flak', desc: 'Three-gun flak battery. Clears the sky at long range.', category: 'antiair', visual: 'flak', barrels: 3, caliber: 0.9, mount: 'H', weight: 9, cost: 60,
    damage: 70, burst: 3, cooldown: 2.2, range: 10, ...A, projectile: 'shell', projectileSpeed: 18, splash: 1.8, ap: 0.2, airBonus: 1.5 }),
  // ---------------- Support ----------------
  { id: 'repair', name: 'Repair Beam', family: 'Light repair', desc: 'Heals the most damaged ally in range.', category: 'support', visual: 'repair', caliber: 0.3, mount: 'L', kind: 'utility', weight: 1, cost: 20, heal: 22, range: 4 },
  { id: 'repairM', name: 'Repair Array', family: 'Heavy repair', desc: 'Industrial nano-repair array with longer reach.', category: 'support', visual: 'repair', caliber: 0.6, mount: 'M', kind: 'utility', weight: 2.5, cost: 40, heal: 55, range: 5 },
  { id: 'shield', name: 'Shield Projector', family: 'Energy shield', desc: 'Personal energy shield that absorbs 260 damage and regenerates.', category: 'support', visual: 'shield', caliber: 0.5, mount: 'M', kind: 'utility', weight: 2.5, cost: 32, shield: 260 },
  { id: 'targeting', name: 'Targeting Computer', family: 'Sensors', desc: '+15% range for all weapons and tighter spread.', category: 'support', visual: 'sensor', caliber: 0.3, mount: 'L', kind: 'utility', weight: 0.8, cost: 15, rangeBonus: 0.15, spreadMult: 0.6 },
  // ---------------- Armor ----------------
  { id: 'plateL', name: 'Armor Plate', family: 'Light plate', desc: '+3 armor, +60 hp.', category: 'armor', visual: 'plate', caliber: 0.3, mount: 'L', kind: 'armor', weight: 2, cost: 8, armor: 3, hp: 60 },
  { id: 'plateM', name: 'Composite Armor', family: 'Composite', desc: '+6 armor, +150 hp.', category: 'armor', visual: 'plate', caliber: 0.6, mount: 'M', kind: 'armor', weight: 5, cost: 20, armor: 6, hp: 150 },
  { id: 'plateH', name: 'Heavy Armor', family: 'Heavy plate', desc: '+10 armor, +400 hp.', category: 'armor', visual: 'plate', caliber: 0.9, mount: 'H', kind: 'armor', weight: 12, cost: 35, armor: 10, hp: 400 },
];

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((p) => [p.id, p] as const));
export const CHASSIS_BY_ID = byId(CHASSIS);
export const MOBILITY_BY_ID = byId(MOBILITY);
export const MODULE_BY_ID = byId(MODULES);

const RANK: Record<MountClass, number> = { L: 1, M: 2, H: 3 };
/** Can a module of class `module` go in a slot of class `slot`? */
export const fitsMount = (slot: MountClass, module: MountClass) => RANK[module] <= RANK[slot];

/** Is this chassis/mobility pairing legal? Returns a reason string when not. */
export function pairingError(chassisId: string, mobilityId: string): string | null {
  const c = CHASSIS_BY_ID.get(chassisId);
  const m = MOBILITY_BY_ID.get(mobilityId);
  if (!c) return 'Unknown chassis';
  if (!m) return 'Unknown mobility';
  if (!m.sizes.includes(c.size)) return `${m.name} can't carry a size-${c.size} chassis`;
  if (c.traits.includes('airOnly') && m.kind !== 'air') return `${c.name} must fly (rotor or jet)`;
  return null;
}
